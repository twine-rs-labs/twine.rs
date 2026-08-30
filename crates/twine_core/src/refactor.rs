//! Immutable, Rust-owned refactor plans.
//!
//! Executable changes are intentionally Rust-only. Public callers can inspect
//! bounded descriptions and submit only an opaque plan identity plus a compact
//! selection expression.

use crate::{PassageSnapshot, PatchBatch, StoryMetadataPatch, replace_link_content_target};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use ts_rs::TS;
use twine_model::{Passage, PassageId, PassageIndex, PassageLayout, Project, Story, StoryId};
use web_time::{Duration, Instant, SystemTime};

pub const MAX_REFACTOR_PLANS: usize = 8;
pub const MAX_REFACTOR_PLAN_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_REFACTOR_PLAN_BYTES_50K: usize = 128 * 1024 * 1024;
pub const MAX_REFACTOR_SELECTION_IDS: usize = 50_000;
pub const MAX_REFACTOR_SELECTION_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_REFACTOR_DETAIL_CHANGES: usize = 200;
pub const MAX_REFACTOR_DETAIL_BYTES: usize = 256 * 1024;
pub const MAX_REFACTOR_SUMMARY_BYTES: usize = 64 * 1024;
pub const MAX_REFACTOR_PLANNING_TASKS: usize = 1;
/// Versioned cross-boundary ceiling for passage-rename request strings.
pub const MAX_PASSAGE_RENAME_REQUEST_STRING_BYTES_V1: usize = 64 * 1024;
const RENAME_PLANNING_BATCH_PASSAGES: usize = 128;
const PLAN_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_PLAN_TOMBSTONES: usize = MAX_REFACTOR_PLANS * 4;
static NEXT_REFACTOR_STORE_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_REFACTOR_TASK_STORE_ID: AtomicU64 = AtomicU64::new(1);

/// The narrow public input for the Rust-owned passage rename operation.
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct PlanPassageRenameRequest {
    pub story_id: String,
    pub passage_id: String,
    pub after_name: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorPlanningTaskHandle {
    pub task_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorPlanningProgress {
    pub scanned_passage_count: usize,
    pub total_passage_count: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum PlanPassageRenameBeginResult {
    Begun { task: RefactorPlanningTaskHandle },
    Failure { failure: RefactorPlanFailure },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum PlanPassageRenameResult {
    Pending {
        task: RefactorPlanningTaskHandle,
        progress: RefactorPlanningProgress,
    },
    Complete {
        summary: RefactorPlanSummary,
    },
    Cancelled,
    Failure {
        failure: RefactorPlanFailure,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorPlanCursor {
    pub plan_id: String,
    pub plan_digest: String,
    pub position: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum RefactorPlanSelection {
    All,
    AllExcept {
        change_ids: Vec<String>,
    },
    Only {
        change_ids: Vec<String>,
    },
    Groups {
        group_ids: Vec<String>,
        exclusions: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorPlanApplyRequest {
    pub plan_id: String,
    pub expected_project_revision: u32,
    pub selection: RefactorPlanSelection,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorBufferPrecondition {
    pub buffer_id: String,
    pub registration_id: String,
    pub generation: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorExternalPrecondition {
    pub session_instance_id: String,
    pub generation: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorProviderPrecondition {
    pub identifier: String,
    pub format_version: String,
    pub capability_revision: u32,
}

/// Trusted runtime state captured by the project host. Review components never
/// construct this value directly.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorRuntimeState {
    pub project_revision: u32,
    #[serde(default)]
    pub buffers: Vec<RefactorBufferPrecondition>,
    #[serde(default)]
    pub external: Option<RefactorExternalPrecondition>,
    #[serde(default)]
    pub provider: Option<RefactorProviderPrecondition>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorSelectionCapabilities {
    pub all: bool,
    pub exclusions: bool,
    pub groups: bool,
    pub only: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorPlanSummary {
    pub plan_id: String,
    pub plan_digest: String,
    pub project_revision: u32,
    pub operation_kind: String,
    pub affected_entity_count: usize,
    pub change_count: usize,
    pub validation_failures: Vec<String>,
    pub coverage: String,
    pub selection_capabilities: RefactorSelectionCapabilities,
    pub first_detail_cursor: RefactorPlanCursor,
    /// JavaScript-safe epoch milliseconds.
    pub expires_at_epoch_ms: f64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum RefactorPlanChangeKind {
    TextEdit,
    RenamePassage,
    AddPassage,
    RemovePassage,
    SetStartPassage,
    UpdateStoryMetadata,
    UpdateProjectMetadata,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum RefactorAffectedEntityKind {
    Passage,
    Story,
    Project,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorAffectedEntity {
    pub kind: RefactorAffectedEntityKind,
    #[serde(default)]
    pub story_id: Option<String>,
    pub entity_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum RefactorSourceKind {
    Passage,
    Script,
    Stylesheet,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum RefactorRangeEncoding {
    Utf16CodeUnits,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorSourceSpan {
    pub encoding: RefactorRangeEncoding,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorSourceLocation {
    pub story_id: String,
    pub source_kind: RefactorSourceKind,
    pub source_id: String,
    pub revision: u32,
    pub span: RefactorSourceSpan,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum RefactorPlanValue {
    Text { value: String },
    PassageName { value: String },
    PassageId { value: String },
    Passage { passage: PassageSnapshot },
    StoryMetadata { value: StoryMetadataPatch },
    ProjectName { value: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorPlanDetail {
    pub change_id: String,
    #[serde(default)]
    pub group_id: Option<String>,
    pub kind: RefactorPlanChangeKind,
    pub affected_entity: RefactorAffectedEntity,
    pub description: String,
    #[serde(default)]
    pub before: Option<RefactorPlanValue>,
    #[serde(default)]
    pub after: Option<RefactorPlanValue>,
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub location: Option<RefactorSourceLocation>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorPlanDetailPage {
    pub changes: Vec<RefactorPlanDetail>,
    pub next_cursor: Option<RefactorPlanCursor>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum RefactorPlanFailureCode {
    StaleProjectRevision,
    BufferChanged,
    PlanExpired,
    PlanEvicted,
    ProviderChanged,
    PersistenceConflict,
    InvalidSelection,
    SelectionTooLarge,
    PlanTooLarge,
    InvalidPlan,
    DigestMismatch,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorPlanFailure {
    pub code: RefactorPlanFailureCode,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum RefactorPlanDetailResult {
    Page { page: RefactorPlanDetailPage },
    Failure { failure: RefactorPlanFailure },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum RefactorPlanApplyResult {
    Applied {
        batch: PatchBatch,
        receipt: RefactorApplyReceipt,
    },
    Failure {
        failure: RefactorPlanFailure,
    },
}

/// Exact selected text edits, emitted only after a successful atomic apply.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorApplyReceipt {
    pub text_edits: Vec<RefactorAppliedTextEdit>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct RefactorAppliedTextEdit {
    pub expected_text: String,
    pub replacement_text: String,
    pub source: RefactorSourceLocation,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub(crate) enum CanonicalSourceIdentity {
    Passage {
        story_id: String,
        passage_id: String,
    },
    Script {
        story_id: String,
    },
    Stylesheet {
        story_id: String,
    },
}

impl CanonicalSourceIdentity {
    fn story_id(&self) -> &str {
        match self {
            Self::Passage { story_id, .. }
            | Self::Script { story_id }
            | Self::Stylesheet { story_id } => story_id,
        }
    }

    fn source<'a>(&self, project: &'a Project) -> Result<&'a str, RefactorPlanFailure> {
        let story = project
            .stories
            .iter()
            .find(|story| story.id.as_ref() == self.story_id())
            .ok_or_else(|| invalid_plan("Canonical source story does not exist."))?;

        match self {
            Self::Passage { passage_id, .. } => story
                .passage_by_id(&PassageId::new(passage_id))
                .map(|passage| passage.text.as_str())
                .ok_or_else(|| invalid_plan("Canonical source passage does not exist.")),
            Self::Script { .. } => Ok(&story.script),
            Self::Stylesheet { .. } => Ok(&story.stylesheet),
        }
    }

    fn review_identity(&self) -> (RefactorSourceKind, String) {
        match self {
            Self::Passage { passage_id, .. } => (RefactorSourceKind::Passage, passage_id.clone()),
            Self::Script { .. } => (RefactorSourceKind::Script, "script".into()),
            Self::Stylesheet { .. } => (RefactorSourceKind::Stylesheet, "stylesheet".into()),
        }
    }
}

/// Half-open byte range over exact UTF-8 source bytes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RefactorTextRange {
    pub start_utf8_byte: usize,
    pub end_utf8_byte: usize,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum CanonicalProjectMetadataField {
    Name,
}

/// Rust-only executable payload. Review DTOs deliberately do not expose it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub(crate) enum CanonicalPlanChange {
    TextEdit {
        source: CanonicalSourceIdentity,
        range: RefactorTextRange,
        expected_text: String,
        replacement_text: String,
    },
    RenamePassage {
        story_id: String,
        passage_id: String,
        before_name: String,
        after_name: String,
    },
    AddPassage {
        story_id: String,
        passage: Passage,
        layout: Option<PassageLayout>,
    },
    RemovePassage {
        story_id: String,
        passage: Passage,
        layout: Option<PassageLayout>,
    },
    SetStartPassage {
        story_id: String,
        before_passage_id: String,
        after_passage_id: String,
    },
    UpdateStoryMetadata {
        story_id: String,
        before: StoryMetadataPatch,
        after: StoryMetadataPatch,
    },
    UpdateProjectMetadata {
        story_id: String,
        field: CanonicalProjectMetadataField,
        before: String,
        after: String,
    },
}

/// A fully validated, non-structural passage mutation suitable for applying
/// directly to a session and storing as a sparse history delta.
#[derive(Clone, Debug)]
pub(crate) struct SparsePassageRefactorDelta {
    pub after: Passage,
    pub before: Passage,
    pub index: usize,
    pub passage_id: PassageId,
    pub story_id: String,
}

impl CanonicalPlanChange {
    fn kind(&self) -> RefactorPlanChangeKind {
        match self {
            Self::TextEdit { .. } => RefactorPlanChangeKind::TextEdit,
            Self::RenamePassage { .. } => RefactorPlanChangeKind::RenamePassage,
            Self::AddPassage { .. } => RefactorPlanChangeKind::AddPassage,
            Self::RemovePassage { .. } => RefactorPlanChangeKind::RemovePassage,
            Self::SetStartPassage { .. } => RefactorPlanChangeKind::SetStartPassage,
            Self::UpdateStoryMetadata { .. } => RefactorPlanChangeKind::UpdateStoryMetadata,
            Self::UpdateProjectMetadata { .. } => RefactorPlanChangeKind::UpdateProjectMetadata,
        }
    }

    fn entity(&self) -> RefactorAffectedEntity {
        match self {
            Self::TextEdit { source, .. } => match source {
                CanonicalSourceIdentity::Passage {
                    story_id,
                    passage_id,
                } => RefactorAffectedEntity {
                    kind: RefactorAffectedEntityKind::Passage,
                    story_id: Some(story_id.clone()),
                    entity_id: passage_id.clone(),
                },
                CanonicalSourceIdentity::Script { story_id } => RefactorAffectedEntity {
                    kind: RefactorAffectedEntityKind::Story,
                    story_id: Some(story_id.clone()),
                    entity_id: "script".into(),
                },
                CanonicalSourceIdentity::Stylesheet { story_id } => RefactorAffectedEntity {
                    kind: RefactorAffectedEntityKind::Story,
                    story_id: Some(story_id.clone()),
                    entity_id: "stylesheet".into(),
                },
            },
            Self::RenamePassage {
                story_id,
                passage_id,
                ..
            } => RefactorAffectedEntity {
                kind: RefactorAffectedEntityKind::Passage,
                story_id: Some(story_id.clone()),
                entity_id: passage_id.clone(),
            },
            Self::AddPassage {
                story_id,
                passage: Passage { id: passage_id, .. },
                ..
            }
            | Self::RemovePassage {
                story_id,
                passage: Passage { id: passage_id, .. },
                ..
            } => RefactorAffectedEntity {
                kind: RefactorAffectedEntityKind::Passage,
                story_id: Some(story_id.clone()),
                entity_id: passage_id.as_ref().to_owned(),
            },
            Self::SetStartPassage { story_id, .. } | Self::UpdateStoryMetadata { story_id, .. } => {
                RefactorAffectedEntity {
                    kind: RefactorAffectedEntityKind::Story,
                    story_id: Some(story_id.clone()),
                    entity_id: story_id.clone(),
                }
            }
            Self::UpdateProjectMetadata { story_id, .. } => RefactorAffectedEntity {
                kind: RefactorAffectedEntityKind::Project,
                story_id: Some(story_id.clone()),
                entity_id: "project".into(),
            },
        }
    }

    fn detail(
        &self,
        project: &Project,
        revision: u32,
    ) -> Result<RefactorPlanDetail, RefactorPlanFailure> {
        let (description, before, after, location) = match self {
            Self::TextEdit {
                source,
                range,
                expected_text,
                replacement_text,
            } => {
                let source_text = source.source(project)?;
                validate_text_range(source_text, range, expected_text)?;
                let (source_kind, source_id) = source.review_identity();
                let start = source_text[..range.start_utf8_byte].encode_utf16().count();
                let end = source_text[..range.end_utf8_byte].encode_utf16().count();
                (
                    "Edit source text".into(),
                    Some(RefactorPlanValue::Text {
                        value: expected_text.clone(),
                    }),
                    Some(RefactorPlanValue::Text {
                        value: replacement_text.clone(),
                    }),
                    Some(RefactorSourceLocation {
                        story_id: source.story_id().into(),
                        source_kind,
                        source_id,
                        revision,
                        span: RefactorSourceSpan {
                            encoding: RefactorRangeEncoding::Utf16CodeUnits,
                            start,
                            end,
                        },
                    }),
                )
            }
            Self::RenamePassage {
                before_name,
                after_name,
                ..
            } => (
                "Rename passage".into(),
                Some(RefactorPlanValue::PassageName {
                    value: before_name.clone(),
                }),
                Some(RefactorPlanValue::PassageName {
                    value: after_name.clone(),
                }),
                None,
            ),
            Self::AddPassage { passage, .. } => (
                "Add passage".into(),
                None,
                Some(RefactorPlanValue::Passage {
                    passage: PassageSnapshot::from(passage),
                }),
                None,
            ),
            Self::RemovePassage { passage, .. } => (
                "Remove passage".into(),
                Some(RefactorPlanValue::Passage {
                    passage: PassageSnapshot::from(passage),
                }),
                None,
                None,
            ),
            Self::SetStartPassage {
                before_passage_id,
                after_passage_id,
                ..
            } => (
                "Set start passage".into(),
                Some(RefactorPlanValue::PassageId {
                    value: before_passage_id.clone(),
                }),
                Some(RefactorPlanValue::PassageId {
                    value: after_passage_id.clone(),
                }),
                None,
            ),
            Self::UpdateStoryMetadata { before, after, .. } => (
                "Update story metadata".into(),
                Some(RefactorPlanValue::StoryMetadata {
                    value: before.clone(),
                }),
                Some(RefactorPlanValue::StoryMetadata {
                    value: after.clone(),
                }),
                None,
            ),
            Self::UpdateProjectMetadata { before, after, .. } => (
                "Update project metadata".into(),
                Some(RefactorPlanValue::ProjectName {
                    value: before.clone(),
                }),
                Some(RefactorPlanValue::ProjectName {
                    value: after.clone(),
                }),
                None,
            ),
        };
        Ok(RefactorPlanDetail {
            change_id: String::new(),
            group_id: None,
            kind: self.kind(),
            affected_entity: self.entity(),
            description,
            before,
            after,
            dependencies: Vec::new(),
            location,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct CanonicalPlanDraft {
    pub operation_kind: String,
    pub coverage: String,
    pub preconditions: RefactorRuntimeState,
    pub changes: Vec<CanonicalPlanDraftChange>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct CanonicalPlanDraftChange {
    /// Draft-local key. It is never exposed as the final stable change ID.
    pub key: String,
    /// A shared key makes every member a required atomic group.
    pub group_key: Option<String>,
    pub dependencies: Vec<String>,
    pub change: CanonicalPlanChange,
}

#[derive(Clone, Debug)]
struct PassageRenamePlanningTask {
    request: PlanPassageRenameRequest,
    before_name: String,
    next_passage_index: usize,
    expected_revision: u32,
    preconditions: RefactorRuntimeState,
    changes: Vec<CanonicalPlanDraftChange>,
    estimated_bytes: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct RefactorPlanningTaskStore {
    tasks: BTreeMap<String, PassageRenamePlanningTask>,
    next_id: u64,
    store_id: String,
}

impl Default for RefactorPlanningTaskStore {
    fn default() -> Self {
        Self {
            tasks: BTreeMap::new(),
            next_id: 0,
            store_id: next_refactor_task_store_id(),
        }
    }
}

impl RefactorPlanningTaskStore {
    pub(crate) fn diagnostics(&self) -> (usize, usize) {
        let retained_bytes = self
            .tasks
            .iter()
            .map(|(task_id, task)| {
                // This is deliberately an estimate: it captures retained string/vector
                // capacities plus the planner's monotonic draft estimate without
                // serializing a frontend payload while a task is pending.
                task_id
                    .capacity()
                    .saturating_add(task.before_name.capacity())
                    .saturating_add(task.request.story_id.capacity())
                    .saturating_add(task.request.passage_id.capacity())
                    .saturating_add(task.request.after_name.capacity())
                    .saturating_add(
                        task.changes
                            .capacity()
                            .saturating_mul(std::mem::size_of::<CanonicalPlanDraftChange>()),
                    )
                    .saturating_add(task.estimated_bytes)
            })
            .sum();

        (self.tasks.len(), retained_bytes)
    }

    pub(crate) fn begin(
        &mut self,
        request: PlanPassageRenameRequest,
        mut runtime: RefactorRuntimeState,
        project: &Project,
    ) -> Result<RefactorPlanningTaskHandle, RefactorPlanFailure> {
        if passage_rename_request_string_bytes(&request)
            > MAX_PASSAGE_RENAME_REQUEST_STRING_BYTES_V1
        {
            return Err(plan_too_large(
                "Passage rename request strings exceed the 64 KiB limit.",
            ));
        }
        if self.tasks.len() >= MAX_REFACTOR_PLANNING_TASKS {
            return Err(plan_too_large(
                "Too many refactor planning tasks are active.",
            ));
        }
        normalize_runtime_state(&mut runtime)?;
        let story = project
            .stories
            .iter()
            .find(|story| story.id.as_ref() == request.story_id)
            .ok_or_else(|| invalid_plan("Passage rename story does not exist."))?;
        let passage = story
            .passage_by_id(&PassageId::new(&request.passage_id))
            .ok_or_else(|| invalid_plan("Passage rename target does not exist."))?;
        if request.after_name.trim().is_empty() {
            return Err(invalid_plan(
                "Passage rename target name must not be empty.",
            ));
        }
        if request.after_name == passage.name {
            return Err(invalid_plan("Passage rename must change the exact name."));
        }
        if story
            .passage_by_name(&request.after_name)
            .is_some_and(|existing| existing.id != passage.id)
        {
            return Err(invalid_plan(
                "Passage rename target name is already in use.",
            ));
        }

        self.next_id = self.next_id.saturating_add(1);
        let task_id = format!("rpt-{}-{:016x}", self.store_id, self.next_id);
        self.tasks.insert(
            task_id.clone(),
            PassageRenamePlanningTask {
                before_name: passage.name.clone(),
                changes: vec![CanonicalPlanDraftChange {
                    key: "rename-passage".into(),
                    group_key: Some("passage-rename".into()),
                    dependencies: Vec::new(),
                    change: CanonicalPlanChange::RenamePassage {
                        story_id: request.story_id.clone(),
                        passage_id: request.passage_id.clone(),
                        before_name: passage.name.clone(),
                        after_name: request.after_name.clone(),
                    },
                }],
                estimated_bytes: 1024 + passage.name.len() + request.after_name.len(),
                expected_revision: runtime.project_revision,
                next_passage_index: 0,
                preconditions: runtime,
                request,
            },
        );
        Ok(RefactorPlanningTaskHandle { task_id })
    }

    pub(crate) fn cancel(&mut self, task_id: &str) -> bool {
        self.tasks.remove(task_id).is_some()
    }

    pub(crate) fn continue_task(
        &mut self,
        task_id: &str,
        current_revision: u32,
        project: &Project,
        plans: &mut RefactorPlanStore,
        clock: RefactorPlanClock,
    ) -> PlanPassageRenameResult {
        let Some(mut task) = self.tasks.remove(task_id) else {
            return PlanPassageRenameResult::Cancelled;
        };
        if task.expected_revision != current_revision {
            return PlanPassageRenameResult::Failure {
                failure: fail(
                    RefactorPlanFailureCode::StaleProjectRevision,
                    "Passage rename planning project revision is stale.",
                ),
            };
        }
        let Some(story) = project
            .stories
            .iter()
            .find(|story| story.id.as_ref() == task.request.story_id)
        else {
            return PlanPassageRenameResult::Failure {
                failure: invalid_plan("Passage rename story no longer exists."),
            };
        };
        let total_passage_count = story.passages.len();
        let end = task
            .next_passage_index
            .saturating_add(RENAME_PLANNING_BATCH_PASSAGES)
            .min(total_passage_count);
        let max_bytes = plan_store_byte_limit(total_passage_count);
        for passage in story
            .passages
            .iter()
            .skip(task.next_passage_index)
            .take(end - task.next_passage_index)
        {
            for (range, expected_text, replacement_text) in passage_rename_link_edits(
                &passage.text,
                &task.before_name,
                &task.request.after_name,
            ) {
                task.estimated_bytes = task.estimated_bytes.saturating_add(
                    1024 + expected_text.len().saturating_mul(3)
                        + replacement_text.len().saturating_mul(3),
                );
                if task.estimated_bytes > max_bytes {
                    return PlanPassageRenameResult::Failure {
                        failure: plan_too_large("Passage rename plan exceeds its planning budget."),
                    };
                }
                let ordinal = task.changes.len();
                task.changes.push(CanonicalPlanDraftChange {
                    key: format!("link-target-{ordinal:08}"),
                    group_key: Some("passage-rename".into()),
                    dependencies: vec!["rename-passage".into()],
                    change: CanonicalPlanChange::TextEdit {
                        source: CanonicalSourceIdentity::Passage {
                            story_id: task.request.story_id.clone(),
                            passage_id: passage.id.as_ref().to_owned(),
                        },
                        range,
                        expected_text,
                        replacement_text,
                    },
                });
            }
        }
        task.next_passage_index = end;
        let progress = RefactorPlanningProgress {
            scanned_passage_count: end,
            total_passage_count,
        };
        if end < total_passage_count {
            self.tasks.insert(task_id.into(), task);
            return PlanPassageRenameResult::Pending {
                task: RefactorPlanningTaskHandle {
                    task_id: task_id.into(),
                },
                progress,
            };
        }
        match plans.insert(
            CanonicalPlanDraft {
                operation_kind: "passage-rename".into(),
                coverage: "standard-links-only".into(),
                preconditions: task.preconditions,
                changes: task.changes,
            },
            project,
            clock,
        ) {
            Ok(summary) => PlanPassageRenameResult::Complete { summary },
            Err(failure) => PlanPassageRenameResult::Failure { failure },
        }
    }
}

pub fn passage_rename_request_string_bytes(request: &PlanPassageRenameRequest) -> usize {
    request
        .story_id
        .len()
        .saturating_add(request.passage_id.len())
        .saturating_add(request.after_name.len())
}

fn passage_rename_link_edits(
    text: &str,
    old_name: &str,
    new_name: &str,
) -> Vec<(RefactorTextRange, String, String)> {
    let mut edits = Vec::new();
    let mut cursor = 0;
    while let Some(open_offset) = text[cursor..].find("[[") {
        let content_start = cursor + open_offset + 2;
        let Some(close_offset) = text[content_start..].find("]]") else {
            break;
        };
        let content_end = content_start + close_offset;
        let content = &text[content_start..content_end];
        let parsed = twine_parse::parse_standard_links(
            &format!("[[{content}]]"),
            twine_parse::LinkParseOptions {
                internal_only: false,
            },
        );
        if parsed.first().is_some_and(|link| link.target == old_name) {
            let rewritten = replace_link_content_target(content, old_name, new_name);
            if rewritten != content {
                let prefix = content
                    .chars()
                    .zip(rewritten.chars())
                    .take_while(|(before, after)| before == after)
                    .map(|(character, _)| character.len_utf8())
                    .sum::<usize>();
                let suffix = content[prefix..]
                    .chars()
                    .rev()
                    .zip(rewritten[prefix..].chars().rev())
                    .take_while(|(before, after)| before == after)
                    .map(|(character, _)| character.len_utf8())
                    .sum::<usize>();
                let end = content.len() - suffix;
                let replacement_end = rewritten.len() - suffix;
                edits.push((
                    RefactorTextRange {
                        start_utf8_byte: content_start + prefix,
                        end_utf8_byte: content_start + end,
                    },
                    content[prefix..end].into(),
                    rewritten[prefix..replacement_end].into(),
                ));
            }
        }
        cursor = content_end + 2;
    }
    edits
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct CanonicalPlanEntry {
    id: String,
    group_id: Option<String>,
    dependencies: Vec<String>,
    change: CanonicalPlanChange,
    detail: RefactorPlanDetail,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct StoredPlanPayload {
    operation_kind: String,
    coverage: String,
    preconditions: RefactorRuntimeState,
    entries: Vec<CanonicalPlanEntry>,
}

#[derive(Clone, Debug)]
struct StoredPlan {
    payload: StoredPlanPayload,
    summary: RefactorPlanSummary,
    created: Instant,
    bytes: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PlanTombstone {
    Expired,
    Evicted,
}

#[derive(Clone, Debug)]
struct RefactorPlanLimits {
    max_plans: usize,
    max_bytes: usize,
    ttl: Duration,
}

impl Default for RefactorPlanLimits {
    fn default() -> Self {
        Self {
            max_plans: MAX_REFACTOR_PLANS,
            max_bytes: MAX_REFACTOR_PLAN_BYTES,
            ttl: PLAN_TTL,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct RefactorPlanClock {
    pub instant: Instant,
    pub epoch_ms: f64,
}

impl RefactorPlanClock {
    pub(crate) fn now() -> Self {
        let epoch_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map_or(0.0, |duration| duration.as_secs_f64() * 1_000.0);

        Self {
            instant: Instant::now(),
            epoch_ms,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct PreparedRefactorPlan {
    pub plan_id: String,
    pub operation_kind: String,
    pub changes: Vec<CanonicalPlanChange>,
}

#[derive(Clone, Debug)]
pub(crate) struct RefactorPlanStore {
    plans: BTreeMap<String, StoredPlan>,
    lru: VecDeque<String>,
    tombstones: BTreeMap<String, PlanTombstone>,
    tombstone_lru: VecDeque<String>,
    bytes: usize,
    next_id: u64,
    store_id: String,
    limits: RefactorPlanLimits,
}

impl Default for RefactorPlanStore {
    fn default() -> Self {
        Self {
            plans: BTreeMap::new(),
            lru: VecDeque::new(),
            tombstones: BTreeMap::new(),
            tombstone_lru: VecDeque::new(),
            bytes: 0,
            next_id: 0,
            store_id: next_refactor_store_id(),
            limits: RefactorPlanLimits::default(),
        }
    }
}

impl RefactorPlanStore {
    pub(crate) fn for_project(project: &Project) -> Self {
        let passage_count = project
            .stories
            .iter()
            .map(|story| story.passages.len())
            .sum::<usize>();
        let mut store = Self::default();
        store.limits.max_bytes = plan_store_byte_limit(passage_count);
        store
    }

    pub(crate) fn insert(
        &mut self,
        draft: CanonicalPlanDraft,
        project: &Project,
        clock: RefactorPlanClock,
    ) -> Result<RefactorPlanSummary, RefactorPlanFailure> {
        self.prune(clock.instant);
        let payload = build_payload(draft, project)?;
        let encoded = encode(&payload)?;
        if encoded.len() > self.limits.max_bytes || self.limits.max_plans == 0 {
            return Err(plan_too_large("Plan exceeds the live plan-store limit."));
        }

        self.next_id = self.next_id.saturating_add(1);
        let plan_id = format!("rp-{}-{:016x}", self.store_id, self.next_id);
        let plan_digest = hex_digest(&encoded);
        let first_detail_cursor = RefactorPlanCursor {
            plan_id: plan_id.clone(),
            plan_digest: plan_digest.clone(),
            position: 0,
        };
        let affected_entity_count = payload
            .entries
            .iter()
            .map(|entry| entry.detail.affected_entity.clone())
            .collect::<BTreeSet<_>>()
            .len();
        let summary = RefactorPlanSummary {
            plan_id: plan_id.clone(),
            plan_digest,
            project_revision: payload.preconditions.project_revision,
            operation_kind: payload.operation_kind.clone(),
            affected_entity_count,
            change_count: payload.entries.len(),
            validation_failures: Vec::new(),
            coverage: payload.coverage.clone(),
            selection_capabilities: RefactorSelectionCapabilities {
                all: true,
                exclusions: true,
                groups: payload.entries.iter().any(|entry| entry.group_id.is_some()),
                only: true,
            },
            first_detail_cursor,
            expires_at_epoch_ms: clock.epoch_ms + self.limits.ttl.as_secs_f64() * 1_000.0,
        };
        if encode(&summary)?.len() > MAX_REFACTOR_SUMMARY_BYTES {
            return Err(plan_too_large("Plan summary exceeds 64 KiB."));
        }
        validate_detail_page_sizes(&plan_id, &summary.plan_digest, &payload.entries)?;

        while self.plans.len() >= self.limits.max_plans
            || self.bytes.saturating_add(encoded.len()) > self.limits.max_bytes
        {
            if !self.evict_oldest(PlanTombstone::Evicted) {
                return Err(plan_too_large("Plan cannot fit in the live plan store."));
            }
        }
        self.bytes += encoded.len();
        self.touch(&plan_id);
        self.plans.insert(
            plan_id,
            StoredPlan {
                payload,
                summary: summary.clone(),
                created: clock.instant,
                bytes: encoded.len(),
            },
        );
        Ok(summary)
    }

    pub(crate) fn detail_page(
        &mut self,
        cursor: &RefactorPlanCursor,
        clock: RefactorPlanClock,
    ) -> Result<RefactorPlanDetailPage, RefactorPlanFailure> {
        self.prune(clock.instant);
        self.verify_live_digest(&cursor.plan_id, &cursor.plan_digest)?;
        let plan = self.live_plan(&cursor.plan_id)?;
        if cursor.position > plan.payload.entries.len() {
            return Err(fail(
                RefactorPlanFailureCode::DigestMismatch,
                "Plan cursor position is invalid.",
            ));
        }
        let mut changes = Vec::new();
        for entry in plan
            .payload
            .entries
            .iter()
            .skip(cursor.position)
            .take(MAX_REFACTOR_DETAIL_CHANGES)
        {
            let mut candidate = changes.clone();
            candidate.push(entry.detail.clone());
            let next_position = cursor.position + candidate.len();
            let candidate_page = RefactorPlanDetailPage {
                changes: candidate.clone(),
                next_cursor: (next_position < plan.payload.entries.len()).then(|| {
                    RefactorPlanCursor {
                        plan_id: cursor.plan_id.clone(),
                        plan_digest: cursor.plan_digest.clone(),
                        position: next_position,
                    }
                }),
            };
            if encode(&candidate_page)?.len() > MAX_REFACTOR_DETAIL_BYTES {
                break;
            }
            changes = candidate;
        }
        let next_position = cursor.position + changes.len();
        let page = RefactorPlanDetailPage {
            changes,
            next_cursor: (next_position < plan.payload.entries.len()).then(|| RefactorPlanCursor {
                plan_id: cursor.plan_id.clone(),
                plan_digest: cursor.plan_digest.clone(),
                position: next_position,
            }),
        };
        self.touch(&cursor.plan_id);
        Ok(page)
    }

    pub(crate) fn prepare_apply(
        &mut self,
        request: &RefactorPlanApplyRequest,
        runtime: &RefactorRuntimeState,
        clock: RefactorPlanClock,
    ) -> Result<PreparedRefactorPlan, RefactorPlanFailure> {
        validate_selection_limits(&request.selection)?;
        self.prune(clock.instant);
        let digest = self
            .live_plan(&request.plan_id)?
            .summary
            .plan_digest
            .clone();
        self.verify_live_digest(&request.plan_id, &digest)?;
        let plan = self.live_plan(&request.plan_id)?;
        validate_runtime_preconditions(
            &plan.payload.preconditions,
            runtime,
            request.expected_project_revision,
        )?;
        let selected = select_entries(&plan.payload.entries, &request.selection)?;
        let prepared = PreparedRefactorPlan {
            plan_id: request.plan_id.clone(),
            operation_kind: plan.payload.operation_kind.clone(),
            changes: selected
                .into_iter()
                .map(|entry| entry.change.clone())
                .collect(),
        };
        self.touch(&request.plan_id);
        Ok(prepared)
    }

    pub(crate) fn remove(&mut self, plan_id: &str) {
        if let Some(plan) = self.plans.remove(plan_id) {
            self.bytes = self.bytes.saturating_sub(plan.bytes);
            self.lru.retain(|id| id != plan_id);
        }
    }

    pub(crate) fn diagnostics(&self) -> (usize, usize, String) {
        let mut fingerprint = Sha256::new();
        for (plan_id, plan) in &self.plans {
            fingerprint.update(plan_id.as_bytes());
            fingerprint.update(plan.summary.plan_digest.as_bytes());
        }
        (
            self.plans.len(),
            self.bytes,
            format!("{:x}", fingerprint.finalize()),
        )
    }

    fn live_plan(&self, plan_id: &str) -> Result<&StoredPlan, RefactorPlanFailure> {
        if let Some(plan) = self.plans.get(plan_id) {
            return Ok(plan);
        }
        Err(match self.tombstones.get(plan_id) {
            Some(PlanTombstone::Expired) => fail(
                RefactorPlanFailureCode::PlanExpired,
                "Refactor plan expired.",
            ),
            _ => fail(
                RefactorPlanFailureCode::PlanEvicted,
                "Refactor plan is not live in this session.",
            ),
        })
    }

    fn verify_live_digest(
        &self,
        plan_id: &str,
        supplied_digest: &str,
    ) -> Result<(), RefactorPlanFailure> {
        let plan = self.live_plan(plan_id)?;
        let actual = hex_digest(&encode(&plan.payload)?);
        if actual != plan.summary.plan_digest || supplied_digest != actual {
            return Err(fail(
                RefactorPlanFailureCode::DigestMismatch,
                "Refactor plan digest does not match its immutable payload.",
            ));
        }
        Ok(())
    }

    fn prune(&mut self, now: Instant) {
        let expired = self
            .plans
            .iter()
            .filter(|(_, plan)| now.duration_since(plan.created) >= self.limits.ttl)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in expired {
            self.remove_with_tombstone(&id, PlanTombstone::Expired);
        }
    }

    fn touch(&mut self, plan_id: &str) {
        self.lru.retain(|id| id != plan_id);
        self.lru.push_back(plan_id.to_owned());
    }

    fn evict_oldest(&mut self, tombstone: PlanTombstone) -> bool {
        let Some(id) = self.lru.front().cloned() else {
            return false;
        };
        self.remove_with_tombstone(&id, tombstone);
        true
    }

    fn remove_with_tombstone(&mut self, plan_id: &str, tombstone: PlanTombstone) {
        self.remove(plan_id);
        self.tombstones.insert(plan_id.to_owned(), tombstone);
        self.tombstone_lru.retain(|id| id != plan_id);
        self.tombstone_lru.push_back(plan_id.to_owned());
        while self.tombstone_lru.len() > MAX_PLAN_TOMBSTONES {
            if let Some(expired) = self.tombstone_lru.pop_front() {
                self.tombstones.remove(&expired);
            }
        }
    }
}

fn plan_store_byte_limit(passage_count: usize) -> usize {
    if passage_count >= 50_000 {
        MAX_REFACTOR_PLAN_BYTES_50K
    } else {
        MAX_REFACTOR_PLAN_BYTES
    }
}

fn next_refactor_store_id() -> String {
    let ordinal = NEXT_REFACTOR_STORE_ID.fetch_add(1, Ordering::Relaxed);
    let epoch_nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    short_digest(format!("{epoch_nanos}:{ordinal}").as_bytes())
}

fn next_refactor_task_store_id() -> String {
    let ordinal = NEXT_REFACTOR_TASK_STORE_ID.fetch_add(1, Ordering::Relaxed);
    let epoch_nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    short_digest(format!("{epoch_nanos}:{ordinal}").as_bytes())
}

fn build_payload(
    mut draft: CanonicalPlanDraft,
    project: &Project,
) -> Result<StoredPlanPayload, RefactorPlanFailure> {
    if draft.operation_kind.trim().is_empty()
        || draft.coverage.trim().is_empty()
        || draft.changes.is_empty()
    {
        return Err(invalid_plan(
            "Plan identity, coverage, and changes are required.",
        ));
    }
    normalize_runtime_state(&mut draft.preconditions)?;

    let mut keys = BTreeSet::new();
    let mut canonical_hashes = BTreeSet::new();
    let mut ids_by_key = BTreeMap::new();
    let mut group_ids = BTreeMap::new();
    for (ordinal, change) in draft.changes.iter().enumerate() {
        if change.key.trim().is_empty() || !keys.insert(change.key.clone()) {
            return Err(invalid_plan(
                "Draft change keys must be non-empty and unique.",
            ));
        }
        let canonical = encode(&change.change)?;
        if !canonical_hashes.insert(hex_digest(&canonical)) {
            return Err(invalid_plan("Plan contains a duplicate canonical change."));
        }
        ids_by_key.insert(
            change.key.clone(),
            format!("change-{ordinal:08}-{}", short_digest(&canonical)),
        );
        if let Some(group_key) = &change.group_key {
            if group_key.trim().is_empty() {
                return Err(invalid_plan("Atomic group keys must be non-empty."));
            }
            group_ids
                .entry(group_key.clone())
                .or_insert_with(|| format!("group-{}", short_digest(group_key.as_bytes())));
        }
    }

    let mut entries = Vec::with_capacity(draft.changes.len());
    for draft_change in draft.changes {
        let id = ids_by_key
            .get(&draft_change.key)
            .expect("draft key was indexed")
            .clone();
        let dependencies = draft_change
            .dependencies
            .iter()
            .map(|key| {
                ids_by_key
                    .get(key)
                    .cloned()
                    .ok_or_else(|| invalid_plan("Plan dependency refers to an unknown change."))
            })
            .collect::<Result<Vec<_>, _>>()?;
        if dependencies.iter().collect::<BTreeSet<_>>().len() != dependencies.len() {
            return Err(invalid_plan("Plan change contains duplicate dependencies."));
        }
        let group_id = draft_change
            .group_key
            .as_ref()
            .and_then(|key| group_ids.get(key))
            .cloned();
        let mut detail = draft_change
            .change
            .detail(project, draft.preconditions.project_revision)?;
        detail.change_id = id.clone();
        detail.group_id = group_id.clone();
        detail.dependencies = dependencies.clone();
        entries.push(CanonicalPlanEntry {
            id,
            group_id,
            dependencies,
            change: draft_change.change,
            detail,
        });
    }
    validate_dependencies(&entries)?;
    validate_change_compatibility(&entries)?;
    let entries = topological_entries(entries)?;
    let complete_changes = entries
        .iter()
        .map(|entry| entry.change.clone())
        .collect::<Vec<_>>();
    apply_canonical_changes(project, &complete_changes)?;
    Ok(StoredPlanPayload {
        operation_kind: draft.operation_kind,
        coverage: draft.coverage,
        preconditions: draft.preconditions,
        entries,
    })
}

fn validate_text_range(
    source: &str,
    range: &RefactorTextRange,
    expected_text: &str,
) -> Result<(), RefactorPlanFailure> {
    if range.start_utf8_byte > range.end_utf8_byte
        || range.end_utf8_byte > source.len()
        || !source.is_char_boundary(range.start_utf8_byte)
        || !source.is_char_boundary(range.end_utf8_byte)
        || source.get(range.start_utf8_byte..range.end_utf8_byte) != Some(expected_text)
    {
        return Err(invalid_plan(
            "Text edit does not match its exact half-open UTF-8 source range.",
        ));
    }
    Ok(())
}

fn validate_dependencies(entries: &[CanonicalPlanEntry]) -> Result<(), RefactorPlanFailure> {
    let ids = entries
        .iter()
        .map(|entry| entry.id.as_str())
        .collect::<BTreeSet<_>>();
    if entries.iter().any(|entry| {
        entry
            .dependencies
            .iter()
            .any(|dependency| dependency == &entry.id || !ids.contains(dependency.as_str()))
    }) {
        return Err(invalid_plan("Plan contains an invalid dependency."));
    }
    topological_entries(entries.to_vec()).map(|_| ())
}

fn topological_entries(
    entries: Vec<CanonicalPlanEntry>,
) -> Result<Vec<CanonicalPlanEntry>, RefactorPlanFailure> {
    let mut remaining = entries;
    let mut emitted = BTreeSet::new();
    let mut ordered = Vec::with_capacity(remaining.len());
    while !remaining.is_empty() {
        let Some(index) = remaining.iter().position(|entry| {
            entry
                .dependencies
                .iter()
                .all(|dependency| emitted.contains(dependency))
        }) else {
            return Err(invalid_plan("Plan dependencies contain a cycle."));
        };
        let entry = remaining.remove(index);
        emitted.insert(entry.id.clone());
        ordered.push(entry);
    }
    Ok(ordered)
}

fn validate_change_compatibility(
    entries: &[CanonicalPlanEntry],
) -> Result<(), RefactorPlanFailure> {
    let mut text_ranges = BTreeMap::<CanonicalSourceIdentity, Vec<&RefactorTextRange>>::new();
    let mut passage_structural = BTreeSet::<(String, String)>::new();
    let mut start_stories = BTreeSet::new();
    let mut metadata_stories = BTreeSet::new();
    let mut project_fields = BTreeSet::new();
    for entry in entries {
        match &entry.change {
            CanonicalPlanChange::TextEdit { source, range, .. } => {
                text_ranges.entry(source.clone()).or_default().push(range);
            }
            CanonicalPlanChange::RenamePassage {
                story_id,
                passage_id,
                ..
            } => {
                if !passage_structural.insert((story_id.clone(), passage_id.clone())) {
                    return Err(invalid_plan(
                        "Plan contains incompatible changes for one passage.",
                    ));
                }
            }
            CanonicalPlanChange::AddPassage {
                story_id,
                passage: Passage { id: passage_id, .. },
                ..
            }
            | CanonicalPlanChange::RemovePassage {
                story_id,
                passage: Passage { id: passage_id, .. },
                ..
            } => {
                if !passage_structural.insert((story_id.clone(), passage_id.as_ref().to_owned())) {
                    return Err(invalid_plan(
                        "Plan contains incompatible changes for one passage.",
                    ));
                }
            }
            CanonicalPlanChange::SetStartPassage { story_id, .. } => {
                if !start_stories.insert(story_id) {
                    return Err(invalid_plan("Plan sets one story start more than once."));
                }
            }
            CanonicalPlanChange::UpdateStoryMetadata { story_id, .. } => {
                if !metadata_stories.insert(story_id) {
                    return Err(invalid_plan(
                        "Plan updates one story's metadata more than once.",
                    ));
                }
            }
            CanonicalPlanChange::UpdateProjectMetadata { field, .. } => {
                if !project_fields.insert(field) {
                    return Err(invalid_plan(
                        "Plan updates one project metadata field more than once.",
                    ));
                }
            }
        }
    }
    for ranges in text_ranges.values_mut() {
        ranges.sort_by_key(|range| (range.start_utf8_byte, range.end_utf8_byte));
        for pair in ranges.windows(2) {
            let left = pair[0];
            let right = pair[1];
            if left.end_utf8_byte > right.start_utf8_byte
                || (left.start_utf8_byte == left.end_utf8_byte
                    && left.start_utf8_byte == right.start_utf8_byte)
            {
                return Err(invalid_plan(
                    "Plan contains overlapping or order-dependent text edits.",
                ));
            }
        }
    }

    for (source, _) in text_ranges {
        if let CanonicalSourceIdentity::Passage {
            story_id,
            passage_id,
        } = source
            && entries.iter().any(|entry| {
                matches!(
                    &entry.change,
                    CanonicalPlanChange::RemovePassage {
                        story_id: removed_story_id,
                        passage,
                        ..
                    } if removed_story_id == &story_id && passage.id.as_ref() == passage_id
                )
            })
        {
            return Err(invalid_plan(
                "A plan cannot both edit and remove the same passage source.",
            ));
        }
    }
    Ok(())
}

pub(crate) fn apply_canonical_changes(
    project: &Project,
    changes: &[CanonicalPlanChange],
) -> Result<Project, RefactorPlanFailure> {
    apply_canonical_changes_with_injected_child(project, changes, None)
}

/// Recognize and validate the one shape that can be represented without a
/// project clone: one passage rename plus zero or more passage text edits in
/// that same story. All observations happen before the caller mutates state.
/// Other plans deliberately use the generic candidate-project path below.
pub(crate) fn sparse_passage_rename_delta(
    project: &Project,
    operation_kind: &str,
    changes: &[CanonicalPlanChange],
    injected_failure_child: Option<usize>,
) -> Result<Option<Vec<SparsePassageRefactorDelta>>, RefactorPlanFailure> {
    if operation_kind != "passage-rename" {
        return Ok(None);
    }

    let mut rename = None;
    let mut edits = BTreeMap::<String, Vec<(&RefactorTextRange, &str, &str)>>::new();

    for change in changes {
        match change {
            CanonicalPlanChange::RenamePassage { .. } if rename.is_none() => rename = Some(change),
            CanonicalPlanChange::RenamePassage { .. } => return Ok(None),
            CanonicalPlanChange::TextEdit {
                source:
                    CanonicalSourceIdentity::Passage {
                        story_id,
                        passage_id,
                    },
                range,
                expected_text,
                replacement_text,
            } => {
                if expected_text == replacement_text {
                    return Err(invalid_plan("Canonical text edits must change the source."));
                }
                edits.entry(passage_id.clone()).or_default().push((
                    range,
                    expected_text,
                    replacement_text,
                ));
                if let Some(CanonicalPlanChange::RenamePassage {
                    story_id: rename_story_id,
                    ..
                }) = rename
                    && story_id != rename_story_id
                {
                    return Ok(None);
                }
            }
            _ => return Ok(None),
        }
    }

    let Some(CanonicalPlanChange::RenamePassage {
        story_id,
        passage_id,
        before_name,
        after_name,
    }) = rename
    else {
        return Ok(None);
    };
    if before_name == after_name || after_name.trim().is_empty() {
        return Err(invalid_plan("Passage rename is empty or has no effect."));
    }
    let story = project
        .stories
        .iter()
        .find(|story| story.id.as_ref() == story_id)
        .ok_or_else(|| invalid_plan("Canonical change story does not exist."))?;
    if changes.iter().any(|change| {
        matches!(
            change,
            CanonicalPlanChange::TextEdit {
                source: CanonicalSourceIdentity::Passage { story_id: edit_story_id, .. },
                ..
            } if edit_story_id != story_id
        )
    }) {
        return Ok(None);
    }
    let target_id = PassageId::new(passage_id);
    let target_index = story
        .passages
        .iter()
        .position(|passage| passage.id == target_id)
        .ok_or_else(|| invalid_plan("Passage rename target does not exist."))?;
    let target = story
        .passage_by_id(&target_id)
        .ok_or_else(|| invalid_plan("Passage rename target does not exist."))?;
    if target.name != *before_name {
        return Err(invalid_plan(
            "Passage rename before-name no longer matches.",
        ));
    }
    if story
        .passage_by_name(after_name)
        .is_some_and(|passage| passage.id != target_id)
    {
        return Err(invalid_plan("Passage rename creates a duplicate name."));
    }

    let mut deltas = BTreeMap::<PassageId, SparsePassageRefactorDelta>::new();
    for (edited_id, source_edits) in edits {
        let edited_id = PassageId::new(&edited_id);
        let index = story
            .passages
            .iter()
            .position(|passage| passage.id == edited_id)
            .ok_or_else(|| invalid_plan("Canonical source passage does not exist."))?;
        let before = story
            .passage_by_id(&edited_id)
            .ok_or_else(|| invalid_plan("Canonical source passage does not exist."))?;
        for (range, expected, _) in &source_edits {
            validate_text_range(&before.text, range, expected)?;
        }
        let mut after = before.clone();
        let mut descending = source_edits;
        descending.sort_by_key(|(range, _, _)| {
            std::cmp::Reverse((range.start_utf8_byte, range.end_utf8_byte))
        });
        for (range, _, replacement) in descending {
            after
                .text
                .replace_range(range.start_utf8_byte..range.end_utf8_byte, replacement);
        }
        deltas.insert(
            edited_id.clone(),
            SparsePassageRefactorDelta {
                after,
                before: before.clone(),
                index,
                passage_id: edited_id,
                story_id: story_id.clone(),
            },
        );
    }

    let target_delta =
        deltas
            .entry(target_id.clone())
            .or_insert_with(|| SparsePassageRefactorDelta {
                after: target.clone(),
                before: target.clone(),
                index: target_index,
                passage_id: target_id.clone(),
                story_id: story_id.clone(),
            });
    target_delta.after.name.clone_from(after_name);

    // Match the generic path's injected-child contract while keeping every
    // ordinary validation above mutation-free.
    if injected_failure_child.is_some_and(|index| index < changes.len()) {
        return Err(invalid_plan("Injected canonical child-change failure."));
    }

    Ok(Some(deltas.into_values().collect()))
}

pub(crate) fn apply_canonical_changes_with_injected_child(
    project: &Project,
    changes: &[CanonicalPlanChange],
    injected_failure_child: Option<usize>,
) -> Result<Project, RefactorPlanFailure> {
    let mut candidate = project.clone();
    let mut text_edits =
        BTreeMap::<CanonicalSourceIdentity, Vec<(&RefactorTextRange, &str, &str)>>::new();

    for change in changes {
        if let CanonicalPlanChange::TextEdit {
            source,
            range,
            expected_text,
            replacement_text,
        } = change
        {
            if expected_text == replacement_text {
                return Err(invalid_plan("Canonical text edits must change the source."));
            }
            text_edits.entry(source.clone()).or_default().push((
                range,
                expected_text,
                replacement_text,
            ));
        }
    }

    for (source, edits) in text_edits {
        let original = source.source(project)?;
        for (range, expected, _) in &edits {
            validate_text_range(original, range, expected)?;
        }
        let mut rewritten = original.to_owned();
        let mut descending = edits;
        descending.sort_by_key(|(range, _, _)| {
            std::cmp::Reverse((range.start_utf8_byte, range.end_utf8_byte))
        });
        for (range, _, replacement) in descending {
            rewritten.replace_range(range.start_utf8_byte..range.end_utf8_byte, replacement);
        }
        replace_source(&mut candidate, &source, rewritten)?;
    }

    for (change_index, change) in changes.iter().enumerate() {
        if injected_failure_child == Some(change_index) {
            return Err(invalid_plan("Injected canonical child-change failure."));
        }
        match change {
            CanonicalPlanChange::TextEdit { .. } => {}
            CanonicalPlanChange::RenamePassage {
                story_id,
                passage_id,
                before_name,
                after_name,
            } => {
                if before_name == after_name || after_name.trim().is_empty() {
                    return Err(invalid_plan("Passage rename is empty or has no effect."));
                }
                let story = story_mut(&mut candidate, story_id)?;
                let passage_id = PassageId::new(passage_id);
                if story
                    .passage_by_name(after_name)
                    .is_some_and(|passage| passage.id != passage_id)
                {
                    return Err(invalid_plan("Passage rename creates a duplicate name."));
                }
                let passage = story
                    .passage_by_id_mut(&passage_id)
                    .ok_or_else(|| invalid_plan("Passage rename target does not exist."))?;
                if passage.name != *before_name {
                    return Err(invalid_plan(
                        "Passage rename before-name no longer matches.",
                    ));
                }
                passage.name.clone_from(after_name);
                story.passages.rebuild_name_index();
            }
            CanonicalPlanChange::AddPassage {
                story_id,
                passage,
                layout,
            } => {
                if passage.story.as_ref() != story_id || passage.name.trim().is_empty() {
                    return Err(invalid_plan("Added passage identity is invalid."));
                }
                let story_model_id = StoryId::new(story_id);
                let passage_id = passage.id.clone();
                if candidate
                    .layout
                    .passages
                    .get(&story_model_id, &passage_id)
                    .is_some()
                {
                    return Err(invalid_plan("Added passage already exists by ID or name."));
                }
                let story = story_mut(&mut candidate, story_id)?;
                if story.passage_by_id(&passage_id).is_some()
                    || story.passage_by_name(&passage.name).is_some()
                {
                    return Err(invalid_plan("Added passage already exists by ID or name."));
                }
                story.passages.insert(passage.clone());
                if let Some(layout) = layout {
                    candidate
                        .layout
                        .passages
                        .insert(story_model_id, passage_id, layout.clone());
                }
            }
            CanonicalPlanChange::RemovePassage {
                story_id,
                passage,
                layout,
            } => {
                let story_model_id = StoryId::new(story_id);
                let actual_layout = candidate
                    .layout
                    .passages
                    .get(&story_model_id, &passage.id)
                    .cloned();
                if actual_layout != *layout {
                    return Err(invalid_plan("Removed passage layout no longer matches."));
                }
                let story = story_mut(&mut candidate, story_id)?;
                if story.passage_by_id(&passage.id) != Some(passage) {
                    return Err(invalid_plan("Removed passage snapshot no longer matches."));
                }
                story.passages = story
                    .passages
                    .iter()
                    .filter(|current| current.id != passage.id)
                    .cloned()
                    .collect::<PassageIndex>();
                candidate
                    .layout
                    .passages
                    .remove(&story_model_id, &passage.id);
            }
            CanonicalPlanChange::SetStartPassage {
                story_id,
                before_passage_id,
                after_passage_id,
            } => {
                if before_passage_id == after_passage_id {
                    return Err(invalid_plan("Start-passage change has no effect."));
                }
                let story = story_mut(&mut candidate, story_id)?;
                if story.start_passage.as_ref() != before_passage_id {
                    return Err(invalid_plan(
                        "Start-passage before value no longer matches.",
                    ));
                }
                let after_id = PassageId::new(after_passage_id);
                if !after_passage_id.is_empty() && story.passage_by_id(&after_id).is_none() {
                    return Err(invalid_plan("New start passage does not exist."));
                }
                story.start_passage = after_id;
            }
            CanonicalPlanChange::UpdateStoryMetadata {
                story_id,
                before,
                after,
            } => {
                if before == after || !story_metadata_masks_match(before, after) {
                    return Err(invalid_plan(
                        "Story metadata change is empty or has mismatched fields.",
                    ));
                }
                let next_name = after.name.as_deref();
                if next_name.is_some_and(|name| name.trim().is_empty()) {
                    return Err(invalid_plan("Story name cannot be empty."));
                }
                if let Some(next_name) = next_name
                    && candidate
                        .stories
                        .iter()
                        .any(|story| story.id.as_ref() != story_id && story.name == next_name)
                {
                    return Err(invalid_plan("Story metadata creates a duplicate name."));
                }
                let story = story_mut(&mut candidate, story_id)?;
                if !story_metadata_matches(story, before) {
                    return Err(invalid_plan(
                        "Story metadata before values no longer match.",
                    ));
                }
                apply_story_metadata(story, after);
            }
            CanonicalPlanChange::UpdateProjectMetadata {
                story_id,
                field,
                before,
                after,
            } => {
                if before == after
                    || !candidate
                        .stories
                        .iter()
                        .any(|story| story.id.as_ref() == story_id)
                {
                    return Err(invalid_plan(
                        "Project metadata change is empty or lacks a live story scope.",
                    ));
                }
                match field {
                    CanonicalProjectMetadataField::Name => {
                        if candidate.manifest.name != *before {
                            return Err(invalid_plan(
                                "Project metadata before value no longer matches.",
                            ));
                        }
                        candidate.manifest.name.clone_from(after);
                    }
                }
            }
        }
    }

    for story in &candidate.stories {
        if !story.start_passage.as_ref().is_empty()
            && story.passage_by_id(&story.start_passage).is_none()
        {
            return Err(invalid_plan(
                "Canonical changes leave a story with a missing start passage.",
            ));
        }
        if story
            .passages
            .iter()
            .any(|passage| passage.story != story.id)
        {
            return Err(invalid_plan(
                "Canonical changes leave a passage in the wrong story.",
            ));
        }
    }
    if candidate == *project {
        return Err(invalid_plan("Canonical plan produces no project mutation."));
    }

    Ok(candidate)
}

fn replace_source(
    project: &mut Project,
    source: &CanonicalSourceIdentity,
    value: String,
) -> Result<(), RefactorPlanFailure> {
    let story = story_mut(project, source.story_id())?;
    match source {
        CanonicalSourceIdentity::Passage { passage_id, .. } => {
            story
                .passage_by_id_mut(&PassageId::new(passage_id))
                .ok_or_else(|| invalid_plan("Canonical source passage does not exist."))?
                .text = value;
        }
        CanonicalSourceIdentity::Script { .. } => story.script = value,
        CanonicalSourceIdentity::Stylesheet { .. } => story.stylesheet = value,
    }
    Ok(())
}

pub(crate) fn apply_receipt_for_changes(
    project: &Project,
    changes: &[CanonicalPlanChange],
    revision: u32,
) -> Result<RefactorApplyReceipt, RefactorPlanFailure> {
    let mut text_edits = Vec::new();
    for change in changes {
        let CanonicalPlanChange::TextEdit {
            source,
            range,
            expected_text,
            replacement_text,
        } = change
        else {
            continue;
        };
        let document = source.source(project)?;
        validate_text_range(document, range, expected_text)?;
        let start = document[..range.start_utf8_byte].encode_utf16().count();
        let end = document[..range.end_utf8_byte].encode_utf16().count();
        let (source_kind, source_id) = source.review_identity();
        text_edits.push(RefactorAppliedTextEdit {
            expected_text: expected_text.clone(),
            replacement_text: replacement_text.clone(),
            source: RefactorSourceLocation {
                story_id: source.story_id().to_owned(),
                source_kind,
                source_id,
                revision,
                span: RefactorSourceSpan {
                    encoding: RefactorRangeEncoding::Utf16CodeUnits,
                    start,
                    end,
                },
            },
        });
    }
    text_edits.sort_by(|left, right| {
        (
            &left.source.story_id,
            &left.source.source_kind,
            &left.source.source_id,
            left.source.span.start,
        )
            .cmp(&(
                &right.source.story_id,
                &right.source.source_kind,
                &right.source.source_id,
                right.source.span.start,
            ))
    });
    for pair in text_edits.windows(2) {
        if pair[0].source.story_id == pair[1].source.story_id
            && pair[0].source.source_kind == pair[1].source.source_kind
            && pair[0].source.source_id == pair[1].source.source_id
            && pair[0].source.span.end > pair[1].source.span.start
        {
            return Err(invalid_plan("Selected canonical text edits overlap."));
        }
    }
    Ok(RefactorApplyReceipt { text_edits })
}

fn story_mut<'a>(
    project: &'a mut Project,
    story_id: &str,
) -> Result<&'a mut Story, RefactorPlanFailure> {
    project
        .stories
        .iter_mut()
        .find(|story| story.id.as_ref() == story_id)
        .ok_or_else(|| invalid_plan("Canonical change story does not exist."))
}

fn story_metadata_masks_match(before: &StoryMetadataPatch, after: &StoryMetadataPatch) -> bool {
    before.ifid.is_some() == after.ifid.is_some()
        && before.name.is_some() == after.name.is_some()
        && before.snap_to_grid.is_some() == after.snap_to_grid.is_some()
        && before.story_format.is_some() == after.story_format.is_some()
        && before.story_format_version.is_some() == after.story_format_version.is_some()
        && before.tag_colors.is_some() == after.tag_colors.is_some()
        && before.tags.is_some() == after.tags.is_some()
        && before.zoom.is_some() == after.zoom.is_some()
}

fn story_metadata_matches(story: &Story, patch: &StoryMetadataPatch) -> bool {
    patch.ifid.as_ref().is_none_or(|value| &story.ifid == value)
        && patch.name.as_ref().is_none_or(|value| &story.name == value)
        && patch
            .snap_to_grid
            .is_none_or(|value| story.snap_to_grid == value)
        && patch
            .story_format
            .as_ref()
            .is_none_or(|value| &story.story_format == value)
        && patch
            .story_format_version
            .as_ref()
            .is_none_or(|value| &story.story_format_version == value)
        && patch
            .tag_colors
            .as_ref()
            .is_none_or(|value| &story.tag_colors == value)
        && patch.tags.as_ref().is_none_or(|value| &story.tags == value)
        && patch.zoom.is_none_or(|value| story.zoom == value)
}

fn apply_story_metadata(story: &mut Story, patch: &StoryMetadataPatch) {
    if let Some(value) = &patch.ifid {
        story.ifid.clone_from(value);
    }
    if let Some(value) = &patch.name {
        story.name.clone_from(value);
    }
    if let Some(value) = patch.snap_to_grid {
        story.snap_to_grid = value;
    }
    if let Some(value) = &patch.story_format {
        story.story_format.clone_from(value);
    }
    if let Some(value) = &patch.story_format_version {
        story.story_format_version.clone_from(value);
    }
    if let Some(value) = &patch.tag_colors {
        story.tag_colors.clone_from(value);
    }
    if let Some(value) = &patch.tags {
        story.tags.clone_from(value);
    }
    if let Some(value) = patch.zoom {
        story.zoom = value;
    }
}

fn validate_runtime_preconditions(
    expected: &RefactorRuntimeState,
    current: &RefactorRuntimeState,
    request_revision: u32,
) -> Result<(), RefactorPlanFailure> {
    let mut current = current.clone();
    normalize_runtime_state(&mut current)?;
    if request_revision != expected.project_revision
        || current.project_revision != expected.project_revision
    {
        return Err(fail(
            RefactorPlanFailureCode::StaleProjectRevision,
            "Project revision changed after planning.",
        ));
    }
    if current.buffers != expected.buffers {
        return Err(fail(
            RefactorPlanFailureCode::BufferChanged,
            "An affected editor buffer changed after planning.",
        ));
    }
    if current.external != expected.external {
        return Err(fail(
            RefactorPlanFailureCode::PersistenceConflict,
            "The external project generation changed after planning.",
        ));
    }
    if current.provider != expected.provider {
        return Err(fail(
            RefactorPlanFailureCode::ProviderChanged,
            "The exact format provider capability changed after planning.",
        ));
    }
    Ok(())
}

fn normalize_runtime_state(state: &mut RefactorRuntimeState) -> Result<(), RefactorPlanFailure> {
    state.buffers.sort_by(|left, right| {
        (&left.buffer_id, &left.registration_id).cmp(&(&right.buffer_id, &right.registration_id))
    });
    let mut registration_ids = BTreeSet::new();
    if state
        .buffers
        .iter()
        .any(|buffer| !registration_ids.insert(buffer.registration_id.as_str()))
    {
        return Err(invalid_plan(
            "Runtime state contains duplicate buffer registrations.",
        ));
    }
    Ok(())
}

fn validate_selection_limits(selection: &RefactorPlanSelection) -> Result<(), RefactorPlanFailure> {
    let (ids, duplicate) = match selection {
        RefactorPlanSelection::All => (0, false),
        RefactorPlanSelection::AllExcept { change_ids }
        | RefactorPlanSelection::Only { change_ids } => (
            change_ids.len(),
            change_ids.iter().collect::<BTreeSet<_>>().len() != change_ids.len(),
        ),
        RefactorPlanSelection::Groups {
            group_ids,
            exclusions,
        } => (
            group_ids.len() + exclusions.len(),
            group_ids.iter().collect::<BTreeSet<_>>().len() != group_ids.len()
                || exclusions.iter().collect::<BTreeSet<_>>().len() != exclusions.len(),
        ),
    };
    if ids > MAX_REFACTOR_SELECTION_IDS || encode(selection)?.len() > MAX_REFACTOR_SELECTION_BYTES {
        return Err(fail(
            RefactorPlanFailureCode::SelectionTooLarge,
            "Selection exceeds configured ID or serialized-byte limits.",
        ));
    }
    if duplicate {
        return Err(fail(
            RefactorPlanFailureCode::InvalidSelection,
            "Selection contains duplicate identities.",
        ));
    }
    Ok(())
}

fn select_entries<'a>(
    entries: &'a [CanonicalPlanEntry],
    selection: &RefactorPlanSelection,
) -> Result<Vec<&'a CanonicalPlanEntry>, RefactorPlanFailure> {
    let known_ids = entries
        .iter()
        .map(|entry| entry.id.as_str())
        .collect::<BTreeSet<_>>();
    let known_groups = entries
        .iter()
        .filter_map(|entry| entry.group_id.as_deref())
        .collect::<BTreeSet<_>>();
    let selected_ids = match selection {
        RefactorPlanSelection::All => known_ids.clone(),
        RefactorPlanSelection::AllExcept { change_ids } => {
            if change_ids.iter().any(|id| !known_ids.contains(id.as_str())) {
                return Err(invalid_selection("Selection excludes an unknown change."));
            }
            let excluded = change_ids
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            known_ids.difference(&excluded).copied().collect()
        }
        RefactorPlanSelection::Only { change_ids } => {
            if change_ids.iter().any(|id| !known_ids.contains(id.as_str())) {
                return Err(invalid_selection("Selection contains an unknown change."));
            }
            change_ids.iter().map(String::as_str).collect()
        }
        RefactorPlanSelection::Groups {
            group_ids,
            exclusions,
        } => {
            if group_ids
                .iter()
                .any(|group| !known_groups.contains(group.as_str()))
                || exclusions.iter().any(|id| !known_ids.contains(id.as_str()))
            {
                return Err(invalid_selection(
                    "Selection contains an unknown group or exclusion.",
                ));
            }
            let groups = group_ids
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            let excluded = exclusions
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            entries
                .iter()
                .filter(|entry| {
                    entry
                        .group_id
                        .as_deref()
                        .is_some_and(|group| groups.contains(group))
                        && !excluded.contains(entry.id.as_str())
                })
                .map(|entry| entry.id.as_str())
                .collect()
        }
    };
    if selected_ids.is_empty() {
        return Err(invalid_selection("Selection contains no changes."));
    }
    for entry in entries
        .iter()
        .filter(|entry| selected_ids.contains(entry.id.as_str()))
    {
        if entry
            .dependencies
            .iter()
            .any(|dependency| !selected_ids.contains(dependency.as_str()))
        {
            return Err(invalid_selection("Selection is not dependency-closed."));
        }
        if let Some(group_id) = &entry.group_id
            && entries.iter().any(|other| {
                other.group_id.as_ref() == Some(group_id)
                    && !selected_ids.contains(other.id.as_str())
            })
        {
            return Err(invalid_selection(
                "Selection splits a required atomic group.",
            ));
        }
    }
    Ok(entries
        .iter()
        .filter(|entry| selected_ids.contains(entry.id.as_str()))
        .collect())
}

fn validate_detail_page_sizes(
    plan_id: &str,
    digest: &str,
    entries: &[CanonicalPlanEntry],
) -> Result<(), RefactorPlanFailure> {
    for (position, entry) in entries.iter().enumerate() {
        let page = RefactorPlanDetailPage {
            changes: vec![entry.detail.clone()],
            next_cursor: (position + 1 < entries.len()).then(|| RefactorPlanCursor {
                plan_id: plan_id.into(),
                plan_digest: digest.into(),
                position: position + 1,
            }),
        };
        if encode(&page)?.len() > MAX_REFACTOR_DETAIL_BYTES {
            return Err(plan_too_large(
                "One review detail exceeds the 256 KiB page limit.",
            ));
        }
    }
    Ok(())
}

fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, RefactorPlanFailure> {
    serde_json::to_vec(value).map_err(|_| invalid_plan("Plan value cannot be encoded."))
}

fn short_digest(bytes: &[u8]) -> String {
    hex_digest(bytes)[..16].to_owned()
}

fn hex_digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn fail(code: RefactorPlanFailureCode, message: &str) -> RefactorPlanFailure {
    RefactorPlanFailure {
        code,
        message: message.into(),
    }
}

fn invalid_plan(message: &str) -> RefactorPlanFailure {
    fail(RefactorPlanFailureCode::InvalidPlan, message)
}

fn invalid_selection(message: &str) -> RefactorPlanFailure {
    fail(RefactorPlanFailureCode::InvalidSelection, message)
}

fn plan_too_large(message: &str) -> RefactorPlanFailure {
    fail(RefactorPlanFailureCode::PlanTooLarge, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CoreRect;
    use twine_model::{
        GraphLayout, LibraryMetadata, PassageIndex, ProjectManifest, Story, StoryId,
    };

    fn project() -> Project {
        let story_id = StoryId::new("story");
        let passage = PassageSnapshot {
            id: "start".into(),
            layout: Some(CoreRect::default()),
            name: "Start".into(),
            story_id: "story".into(),
            tags: vec!["scene".into()],
            text: "A😀e\u{301}\r\nКирилл Latin".into(),
        }
        .into_passage(&story_id);
        let removed = PassageSnapshot {
            id: "removed".into(),
            layout: None,
            name: "Removed".into(),
            story_id: "story".into(),
            tags: Vec::new(),
            text: "Old".into(),
        }
        .into_passage(&story_id);
        let story = Story {
            id: story_id,
            ifid: "IFID".into(),
            name: "Story".into(),
            passages: PassageIndex::from(vec![passage, removed]),
            script: "const answer = 42;".into(),
            snap_to_grid: true,
            start_passage: PassageId::new("start"),
            story_format: "Harlowe".into(),
            story_format_version: "3.3.9".into(),
            stylesheet: "body {}".into(),
            ..Story::default()
        };
        Project {
            layout: GraphLayout::default(),
            library: LibraryMetadata::default(),
            manifest: ProjectManifest {
                name: "Project".into(),
                ..ProjectManifest::default()
            },
            stories: vec![story],
        }
    }

    fn runtime() -> RefactorRuntimeState {
        RefactorRuntimeState {
            project_revision: 1,
            buffers: vec![RefactorBufferPrecondition {
                buffer_id: "passage:start".into(),
                registration_id: "registration-1".into(),
                generation: 2,
            }],
            external: Some(RefactorExternalPrecondition {
                session_instance_id: "native-1".into(),
                generation: 4,
            }),
            provider: Some(RefactorProviderPrecondition {
                identifier: "harlowe-3.3.9".into(),
                format_version: "3.3.9".into(),
                capability_revision: 1,
            }),
        }
    }

    fn draft(change: CanonicalPlanChange) -> CanonicalPlanDraft {
        CanonicalPlanDraft {
            operation_kind: "test".into(),
            coverage: "exact".into(),
            preconditions: runtime(),
            changes: vec![CanonicalPlanDraftChange {
                key: "first".into(),
                group_key: None,
                dependencies: Vec::new(),
                change,
            }],
        }
    }

    fn rename(after: &str) -> CanonicalPlanChange {
        CanonicalPlanChange::RenamePassage {
            story_id: "story".into(),
            passage_id: "start".into(),
            before_name: "Start".into(),
            after_name: after.into(),
        }
    }

    fn clock(base: Instant, milliseconds: u64) -> RefactorPlanClock {
        RefactorPlanClock {
            instant: base + Duration::from_millis(milliseconds),
            epoch_ms: 1_000.0 + milliseconds as f64,
        }
    }

    #[test]
    fn text_ranges_convert_exact_utf8_bytes_to_utf16_review_units() {
        let project = project();
        let source = &project.stories[0].passages[0].text;
        let expected = "😀e\u{301}\r\nК";
        let start = source.find('😀').unwrap();
        let end = start + expected.len();
        let payload = build_payload(
            draft(CanonicalPlanChange::TextEdit {
                source: CanonicalSourceIdentity::Passage {
                    story_id: "story".into(),
                    passage_id: "start".into(),
                },
                range: RefactorTextRange {
                    start_utf8_byte: start,
                    end_utf8_byte: end,
                },
                expected_text: expected.into(),
                replacement_text: "😀É\nK".into(),
            }),
            &project,
        )
        .unwrap();
        let detail = &payload.entries[0].detail;
        let span = &detail.location.as_ref().unwrap().span;

        assert_eq!(span.encoding, RefactorRangeEncoding::Utf16CodeUnits);
        assert_eq!(span.start, 1);
        assert_eq!(span.end, source[..end].encode_utf16().count());
        assert_eq!(
            detail.before,
            Some(RefactorPlanValue::Text {
                value: expected.into(),
            })
        );
        assert_eq!(
            detail.after,
            Some(RefactorPlanValue::Text {
                value: "😀É\nK".into(),
            })
        );
    }

    #[test]
    fn apply_receipt_uses_only_explicit_utf16_spans_for_unicode_crlf_and_normalization() {
        let project = project();
        let source = &project.stories[0].passages[0].text;
        let expected = "😀e\u{301}\r\nК";
        let start = source.find('😀').unwrap();
        let end = start + expected.len();
        let receipt = apply_receipt_for_changes(
            &project,
            &[CanonicalPlanChange::TextEdit {
                source: CanonicalSourceIdentity::Passage {
                    story_id: "story".into(),
                    passage_id: "start".into(),
                },
                range: RefactorTextRange {
                    start_utf8_byte: start,
                    end_utf8_byte: end,
                },
                expected_text: expected.into(),
                // NFC differs deliberately from the source's combining sequence.
                replacement_text: "😀é\r\nК".into(),
            }],
            7,
        )
        .unwrap();
        let edit = &receipt.text_edits[0];

        assert_eq!(
            edit.source.span.encoding,
            RefactorRangeEncoding::Utf16CodeUnits
        );
        assert_eq!(
            edit.source.span.start,
            source[..start].encode_utf16().count()
        );
        assert_eq!(edit.source.span.end, source[..end].encode_utf16().count());
        assert_eq!(edit.expected_text, &source[start..end]);
        assert_eq!(edit.replacement_text, "😀é\r\nК");
    }

    #[test]
    fn text_ranges_reject_non_boundaries_mismatches_and_overlaps() {
        let project = project();
        let invalid = CanonicalPlanChange::TextEdit {
            source: CanonicalSourceIdentity::Passage {
                story_id: "story".into(),
                passage_id: "start".into(),
            },
            range: RefactorTextRange {
                start_utf8_byte: 2,
                end_utf8_byte: 3,
            },
            expected_text: "x".into(),
            replacement_text: "y".into(),
        };
        assert_eq!(
            build_payload(draft(invalid), &project).unwrap_err().code,
            RefactorPlanFailureCode::InvalidPlan
        );

        let source = &project.stories[0].passages[0].text;
        let mut overlapping = draft(CanonicalPlanChange::TextEdit {
            source: CanonicalSourceIdentity::Passage {
                story_id: "story".into(),
                passage_id: "start".into(),
            },
            range: RefactorTextRange {
                start_utf8_byte: 0,
                end_utf8_byte: 1,
            },
            expected_text: source[0..1].into(),
            replacement_text: "B".into(),
        });
        overlapping.changes.push(CanonicalPlanDraftChange {
            key: "second".into(),
            group_key: None,
            dependencies: Vec::new(),
            change: CanonicalPlanChange::TextEdit {
                source: CanonicalSourceIdentity::Passage {
                    story_id: "story".into(),
                    passage_id: "start".into(),
                },
                range: RefactorTextRange {
                    start_utf8_byte: 0,
                    end_utf8_byte: source.find('😀').unwrap() + '😀'.len_utf8(),
                },
                expected_text: source[..source.find('😀').unwrap() + '😀'.len_utf8()].into(),
                replacement_text: "C".into(),
            },
        });
        assert_eq!(
            build_payload(overlapping, &project).unwrap_err().code,
            RefactorPlanFailureCode::InvalidPlan
        );
    }

    #[test]
    fn plan_ids_digests_and_change_ids_are_stable_and_cursor_tampering_fails() {
        let base = Instant::now();
        let mut first = RefactorPlanStore::default();
        let mut second = RefactorPlanStore::default();
        let one = first
            .insert(draft(rename("Next")), &project(), clock(base, 0))
            .unwrap();
        let two = second
            .insert(draft(rename("Next")), &project(), clock(base, 0))
            .unwrap();
        let first_page = first
            .detail_page(&one.first_detail_cursor, clock(base, 1))
            .unwrap();
        let second_page = second
            .detail_page(&two.first_detail_cursor, clock(base, 1))
            .unwrap();

        assert_eq!(one.plan_digest, two.plan_digest);
        assert_ne!(one.plan_id, two.plan_id);
        assert!(one.plan_id.starts_with("rp-"));
        assert_eq!(
            first_page.changes[0].change_id,
            second_page.changes[0].change_id
        );
        let mut tampered = one.first_detail_cursor;
        tampered.plan_digest.push('0');
        assert_eq!(
            first
                .detail_page(&tampered, clock(base, 2))
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::DigestMismatch
        );
    }

    #[test]
    fn store_distinguishes_expiry_from_true_lru_eviction() {
        let base = Instant::now();
        let mut store = RefactorPlanStore::default();
        store.limits.max_plans = 2;
        let first = store
            .insert(draft(rename("One")), &project(), clock(base, 0))
            .unwrap();
        let second = store
            .insert(draft(rename("Two")), &project(), clock(base, 1))
            .unwrap();
        store
            .detail_page(&first.first_detail_cursor, clock(base, 2))
            .unwrap();
        let _third = store
            .insert(draft(rename("Three")), &project(), clock(base, 3))
            .unwrap();

        assert_eq!(
            store
                .detail_page(&second.first_detail_cursor, clock(base, 4))
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::PlanEvicted
        );
        assert_eq!(
            store
                .detail_page(&first.first_detail_cursor, clock(base, 600_002))
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::PlanExpired
        );
    }

    #[test]
    fn plan_store_uses_the_versioned_10k_and_50k_byte_budgets() {
        assert_eq!(plan_store_byte_limit(10_000), MAX_REFACTOR_PLAN_BYTES);
        assert_eq!(plan_store_byte_limit(49_999), MAX_REFACTOR_PLAN_BYTES);
        assert_eq!(plan_store_byte_limit(50_000), MAX_REFACTOR_PLAN_BYTES_50K);
    }

    #[test]
    fn selections_enforce_dependencies_groups_limits_and_runtime_preconditions() {
        let base = Instant::now();
        let mut store = RefactorPlanStore::default();
        let mut plan = draft(rename("One"));
        plan.changes[0].group_key = Some("rename".into());
        plan.changes.push(CanonicalPlanDraftChange {
            key: "rewrite".into(),
            group_key: Some("rename".into()),
            dependencies: vec!["first".into()],
            change: CanonicalPlanChange::TextEdit {
                source: CanonicalSourceIdentity::Script {
                    story_id: "story".into(),
                },
                range: RefactorTextRange {
                    start_utf8_byte: 6,
                    end_utf8_byte: 12,
                },
                expected_text: "answer".into(),
                replacement_text: "result".into(),
            },
        });
        let summary = store.insert(plan, &project(), clock(base, 0)).unwrap();
        let page = store
            .detail_page(&summary.first_detail_cursor, clock(base, 1))
            .unwrap();
        let only_first = RefactorPlanApplyRequest {
            plan_id: summary.plan_id.clone(),
            expected_project_revision: 1,
            selection: RefactorPlanSelection::Only {
                change_ids: vec![page.changes[0].change_id.clone()],
            },
        };
        assert_eq!(
            store
                .prepare_apply(&only_first, &runtime(), clock(base, 2))
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::InvalidSelection
        );

        let mut changed = runtime();
        changed.buffers[0].generation += 1;
        let all = RefactorPlanApplyRequest {
            plan_id: summary.plan_id,
            expected_project_revision: 1,
            selection: RefactorPlanSelection::All,
        };
        assert_eq!(
            store
                .prepare_apply(&all, &changed, clock(base, 3))
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::BufferChanged
        );
        let mut changed = runtime();
        changed.external.as_mut().unwrap().generation += 1;
        assert_eq!(
            store
                .prepare_apply(&all, &changed, clock(base, 3))
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::PersistenceConflict
        );
        let mut changed = runtime();
        changed.provider.as_mut().unwrap().capability_revision += 1;
        assert_eq!(
            store
                .prepare_apply(&all, &changed, clock(base, 3))
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::ProviderChanged
        );
        let mut changed = runtime();
        changed.project_revision += 1;
        assert_eq!(
            store
                .prepare_apply(&all, &changed, clock(base, 3))
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::StaleProjectRevision
        );
        assert_eq!(
            store
                .prepare_apply(&all, &runtime(), clock(base, 4))
                .unwrap()
                .changes
                .len(),
            2
        );

        let too_many = RefactorPlanSelection::Only {
            change_ids: (0..=MAX_REFACTOR_SELECTION_IDS)
                .map(|index| index.to_string())
                .collect(),
        };
        assert_eq!(
            validate_selection_limits(&too_many).unwrap_err().code,
            RefactorPlanFailureCode::SelectionTooLarge
        );
    }

    #[test]
    fn runtime_state_allows_duplicate_source_buffers_but_rejects_registration_reuse() {
        let mut duplicate_editor = runtime();
        duplicate_editor.buffers.push(RefactorBufferPrecondition {
            buffer_id: "passage:start".into(),
            registration_id: "registration-2".into(),
            generation: 7,
        });
        normalize_runtime_state(&mut duplicate_editor).expect("second editor registration");
        assert_eq!(duplicate_editor.buffers.len(), 2);

        duplicate_editor.buffers.push(RefactorBufferPrecondition {
            buffer_id: "passage:other".into(),
            registration_id: "registration-1".into(),
            generation: 1,
        });
        assert_eq!(
            normalize_runtime_state(&mut duplicate_editor)
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::InvalidPlan
        );
    }

    #[test]
    fn compact_selection_limits_cover_exact_and_one_over_id_and_byte_boundaries() {
        let exact_ids = (0..MAX_REFACTOR_SELECTION_IDS)
            .map(|index| format!("id-{index:05}"))
            .collect::<Vec<_>>();
        let exact = RefactorPlanSelection::Only {
            change_ids: exact_ids,
        };
        assert!(encode(&exact).unwrap().len() <= MAX_REFACTOR_SELECTION_BYTES);
        validate_selection_limits(&exact).expect("50,000 compact IDs are permitted");

        let one_over = RefactorPlanSelection::AllExcept {
            change_ids: (0..=MAX_REFACTOR_SELECTION_IDS)
                .map(|index| format!("id-{index:05}"))
                .collect(),
        };
        assert_eq!(
            validate_selection_limits(&one_over).unwrap_err().code,
            RefactorPlanFailureCode::SelectionTooLarge
        );

        let byte_over = RefactorPlanSelection::Only {
            change_ids: (0..MAX_REFACTOR_SELECTION_IDS)
                .map(|index| format!("{index:05}-{}", "x".repeat(96)))
                .collect(),
        };
        assert!(encode(&byte_over).unwrap().len() > MAX_REFACTOR_SELECTION_BYTES);
        assert_eq!(
            validate_selection_limits(&byte_over).unwrap_err().code,
            RefactorPlanFailureCode::SelectionTooLarge
        );
    }

    #[test]
    fn dependency_cycles_and_oversize_review_values_are_rejected() {
        let project = project();
        let mut cycle = draft(rename("One"));
        cycle.changes[0].dependencies = vec!["second".into()];
        cycle.changes.push(CanonicalPlanDraftChange {
            key: "second".into(),
            group_key: None,
            dependencies: vec!["first".into()],
            change: CanonicalPlanChange::SetStartPassage {
                story_id: "story".into(),
                before_passage_id: "start".into(),
                after_passage_id: "start".into(),
            },
        });
        assert_eq!(
            build_payload(cycle, &project).unwrap_err().code,
            RefactorPlanFailureCode::InvalidPlan
        );

        let mut store = RefactorPlanStore::default();
        let base = Instant::now();
        let huge = CanonicalPlanChange::AddPassage {
            story_id: "story".into(),
            passage: PassageSnapshot {
                id: "huge".into(),
                layout: None,
                name: "Huge".into(),
                story_id: "story".into(),
                tags: Vec::new(),
                text: "x".repeat(MAX_REFACTOR_DETAIL_BYTES),
            }
            .into_passage(&StoryId::new("story")),
            layout: None,
        };
        assert_eq!(
            store
                .insert(draft(huge), &project, clock(base, 0))
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::PlanTooLarge
        );
    }

    #[test]
    fn every_canonical_change_kind_produces_non_executable_review_details() {
        let project = project();
        let changes = vec![
            rename("Renamed"),
            CanonicalPlanChange::AddPassage {
                story_id: "story".into(),
                passage: PassageSnapshot {
                    id: "added".into(),
                    layout: None,
                    name: "Added".into(),
                    story_id: "story".into(),
                    tags: Vec::new(),
                    text: "Text".into(),
                }
                .into_passage(&StoryId::new("story")),
                layout: None,
            },
            CanonicalPlanChange::RemovePassage {
                story_id: "story".into(),
                passage: PassageSnapshot {
                    id: "removed".into(),
                    layout: None,
                    name: "Removed".into(),
                    story_id: "story".into(),
                    tags: Vec::new(),
                    text: "Old".into(),
                }
                .into_passage(&StoryId::new("story")),
                layout: None,
            },
            CanonicalPlanChange::SetStartPassage {
                story_id: "story".into(),
                before_passage_id: "start".into(),
                after_passage_id: "added".into(),
            },
            CanonicalPlanChange::UpdateStoryMetadata {
                story_id: "story".into(),
                before: StoryMetadataPatch {
                    name: Some("Story".into()),
                    ..StoryMetadataPatch::default()
                },
                after: StoryMetadataPatch {
                    name: Some("Updated".into()),
                    ..StoryMetadataPatch::default()
                },
            },
            CanonicalPlanChange::UpdateProjectMetadata {
                story_id: "story".into(),
                field: CanonicalProjectMetadataField::Name,
                before: "Project".into(),
                after: "Updated Project".into(),
            },
            CanonicalPlanChange::TextEdit {
                source: CanonicalSourceIdentity::Stylesheet {
                    story_id: "story".into(),
                },
                range: RefactorTextRange {
                    start_utf8_byte: 0,
                    end_utf8_byte: 4,
                },
                expected_text: "body".into(),
                replacement_text: "html".into(),
            },
        ];
        let mut plan = draft(changes[0].clone());
        plan.changes = changes
            .into_iter()
            .enumerate()
            .map(|(index, change)| CanonicalPlanDraftChange {
                key: format!("change-{index}"),
                group_key: None,
                dependencies: Vec::new(),
                change,
            })
            .collect();
        let payload = build_payload(plan, &project).unwrap();

        assert_eq!(payload.entries.len(), 7);
        assert!(payload.entries.iter().all(|entry| {
            !entry.detail.change_id.is_empty() && !entry.detail.description.is_empty()
        }));
        assert!(
            serde_json::to_string(&payload.entries[6].detail)
                .unwrap()
                .contains("utf16-code-units")
        );
    }

    #[test]
    fn detail_pages_are_count_bounded_and_summary_size_is_enforced() {
        let base = Instant::now();
        let mut store = RefactorPlanStore::default();
        let mut plan = draft(rename("Renamed"));
        plan.changes = (0..=MAX_REFACTOR_DETAIL_CHANGES)
            .map(|index| CanonicalPlanDraftChange {
                key: format!("add-{index}"),
                group_key: None,
                dependencies: Vec::new(),
                change: CanonicalPlanChange::AddPassage {
                    story_id: "story".into(),
                    passage: PassageSnapshot {
                        id: format!("added-{index}"),
                        layout: None,
                        name: format!("Added {index}"),
                        story_id: "story".into(),
                        tags: Vec::new(),
                        text: String::new(),
                    }
                    .into_passage(&StoryId::new("story")),
                    layout: None,
                },
            })
            .collect();
        let summary = store.insert(plan, &project(), clock(base, 0)).unwrap();
        let page = store
            .detail_page(&summary.first_detail_cursor, clock(base, 1))
            .unwrap();
        assert_eq!(page.changes.len(), MAX_REFACTOR_DETAIL_CHANGES);
        assert!(encode(&page).unwrap().len() <= MAX_REFACTOR_DETAIL_BYTES);
        assert!(page.next_cursor.is_some());

        let mut oversize_summary = draft(rename("Again"));
        oversize_summary.operation_kind = "x".repeat(MAX_REFACTOR_SUMMARY_BYTES);
        assert_eq!(
            store
                .insert(oversize_summary, &project(), clock(base, 2))
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::PlanTooLarge
        );
    }

    #[test]
    fn passage_rename_link_edits_keep_utf8_ranges_on_character_boundaries() {
        let text = "\r\n[[Показать->Мир😀]] [[Мир😀<-Назад]]";
        let edits = passage_rename_link_edits(text, "Мир😀", "Мір😁");

        assert_eq!(edits.len(), 2);
        for (range, expected, replacement) in edits {
            assert!(text.is_char_boundary(range.start_utf8_byte));
            assert!(text.is_char_boundary(range.end_utf8_byte));
            assert_eq!(&text[range.start_utf8_byte..range.end_utf8_byte], expected);
            let rewritten = format!(
                "{}{}{}",
                &text[..range.start_utf8_byte],
                replacement,
                &text[range.end_utf8_byte..]
            );
            assert!(rewritten.contains("Мір😁"));
        }
    }
}
