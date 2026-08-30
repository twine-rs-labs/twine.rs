#![doc = "Command, patch, transaction, and snapshot spine for the Twine core."]

mod refactor;
pub use refactor::*;

use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque, btree_map::Entry},
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::UNIX_EPOCH,
};
use thiserror::Error;
use ts_rs::TS;
use twine_graph::{
    AutoLayoutOptions, GraphDirection, GraphEdgeKind, GraphFocus, GraphIndex, GraphLayoutSnapshot,
    GraphLayoutSource, GraphLayoutState, GraphProjectionOptions, GraphViewport, LinkEdge,
    LinkLayerOptions, passage_link_edges,
};
use twine_model::{
    GraphLayout, GraphPosition, PROJECT_SCHEMA_VERSION, Passage, PassageId, PassageIndex,
    PassageLayout, Project, Story, StoryId,
};
use twine_parse::{LinkParseOptions, parse_standard_links};
use web_atoms::{C1_REPLACEMENTS, NAMED_ENTITIES};
use web_time::Instant;

#[cfg(test)]
thread_local! {
    static ASSET_ENTITY_PROJECTION_STEPS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static DIAGNOSTIC_IDENTITY_SERIALIZATIONS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn record_asset_entity_projection_step() {
    ASSET_ENTITY_PROJECTION_STEPS.with(|steps| steps.set(steps.get() + 1));
}

const MAX_HISTORY_ENTRIES: usize = 200;
const MAX_HISTORY_BYTES: usize = 64 * 1024 * 1024;
const MAX_BACKLINK_CACHE_ENTRIES: usize = 16;
const MAX_BACKLINK_CACHE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreRect {
    pub height: f64,
    pub left: f64,
    pub top: f64,
    pub width: f64,
}

impl From<GraphPosition> for CoreRect {
    fn from(value: GraphPosition) -> Self {
        Self {
            height: value.height,
            left: value.left,
            top: value.top,
            width: value.width,
        }
    }
}

impl From<CoreRect> for GraphPosition {
    fn from(value: CoreRect) -> Self {
        Self {
            height: value.height,
            left: value.left,
            top: value.top,
            width: value.width,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct PassageSnapshot {
    pub id: String,
    #[serde(default)]
    pub layout: Option<CoreRect>,
    pub name: String,
    pub story_id: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub text: String,
}

impl PassageSnapshot {
    fn into_passage(self, story_id: &StoryId) -> Passage {
        Passage {
            custom_attributes: BTreeMap::new(),
            id: PassageId::new(self.id),
            layout: self.layout.map(GraphPosition::from),
            metadata: BTreeMap::new(),
            name: self.name,
            source_pid: None,
            story: story_id.clone(),
            tags: self.tags,
            text: self.text,
        }
    }
}

impl From<&Passage> for PassageSnapshot {
    fn from(value: &Passage) -> Self {
        Self {
            id: value.id.as_ref().to_owned(),
            layout: value.layout.map(CoreRect::from),
            name: value.name.clone(),
            story_id: value.story.as_ref().to_owned(),
            tags: value.tags.clone(),
            text: value.text.clone(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct StorySnapshot {
    pub id: String,
    pub ifid: String,
    pub name: String,
    pub passages: Vec<PassageSnapshot>,
    pub script: String,
    #[serde(default = "default_true")]
    pub snap_to_grid: bool,
    pub start_passage_id: String,
    pub story_format: String,
    pub story_format_version: String,
    pub stylesheet: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub tag_colors: BTreeMap<String, String>,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreHistoryKind {
    Batch,
    CreateStory,
    NewPassage,
    DeleteAsset,
    DeletePassage,
    DeleteStory,
    EditPassage,
    ExternalChanges,
    ImportAsset,
    InsertAsset,
    MovePassage,
    RenameAsset,
    RenamePassage,
    RenameStory,
    RenameTag,
    Refactor,
    ReplaceAsset,
    SaveLayout,
    SetStartPassage,
    StoryDetails,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreSessionStatus {
    pub can_redo: bool,
    pub can_undo: bool,
    pub dirty: bool,
    pub redo_kind: Option<CoreHistoryKind>,
    pub revision: u32,
    pub undo_kind: Option<CoreHistoryKind>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreExternalIngestMode {
    Auto,
    Force,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreExternalIngestOutcome {
    Applied,
    Conflict,
    NoOp,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreExternalConflict {
    pub field: String,
    pub message: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub story_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreExternalChange {
    DeleteAsset {
        path: String,
    },
    DeletePassage {
        passage_id: String,
        story_id: String,
    },
    DeleteStory {
        story_id: String,
    },
    UpsertPassage {
        passage: PassageSnapshot,
        story_id: String,
    },
    UpsertAsset {
        asset: CoreAssetInventoryEntry,
    },
    UpsertStory {
        story: StorySnapshot,
    },
    UpdatePassage {
        changes: PassagePatch,
        passage_id: String,
        story_id: String,
    },
    UpdatePassageLayout {
        #[serde(default)]
        layout: Option<CoreRect>,
        passage_id: String,
        story_id: String,
    },
    UpdateProjectLayout {
        layout_json: String,
    },
    UpdateStoryMetadata {
        changes: StoryMetadataPatch,
        story_id: String,
    },
    UpdateStoryStartPassage {
        passage_id: String,
        story_id: String,
    },
    UpdateStoryScript {
        script: String,
        story_id: String,
    },
    UpdateStoryStylesheet {
        story_id: String,
        stylesheet: String,
    },
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreExternalDelta {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub changes: Vec<CoreExternalChange>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreExternalIngestResult {
    #[serde(default)]
    pub batch: Option<PatchBatch>,
    #[serde(default)]
    pub conflicts: Vec<CoreExternalConflict>,
    pub history_recorded: bool,
    pub outcome: CoreExternalIngestOutcome,
    pub status: CoreSessionStatus,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreSourceKind {
    Passage,
    Script,
    Stylesheet,
    StoryMetadata,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreSourceFile {
    pub character_count: usize,
    pub id: String,
    pub kind: CoreSourceKind,
    pub line_count: usize,
    pub name: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreSearchScope {
    PassageName,
    PassageText,
    PassageTag,
    Script,
    Stylesheet,
    Variable,
    Asset,
    Metadata,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreSearchHit {
    #[serde(default)]
    pub after: Option<String>,
    #[serde(default)]
    pub before: Option<String>,
    pub end: usize,
    pub excerpt: String,
    pub line: usize,
    pub match_text: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    pub rank: f32,
    #[serde(default)]
    pub replacement: Option<String>,
    pub scope: CoreSearchScope,
    pub source_id: String,
    pub source_name: String,
    pub start: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreSymbolKind {
    Variable,
    TemporaryVariable,
    Hook,
    StoryMetadata,
    StoryFormat,
    Asset,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreSymbol {
    pub end: usize,
    pub excerpt: String,
    pub kind: CoreSymbolKind,
    pub line: usize,
    pub name: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    pub scope: CoreSearchScope,
    pub source_id: String,
    pub source_name: String,
    pub start: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreAssetReference {
    #[serde(default)]
    pub context: String,
    pub end: usize,
    #[serde(default)]
    pub fragment: Option<String>,
    pub kind: String,
    pub line: usize,
    #[serde(default)]
    pub original: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    pub path: String,
    #[serde(default)]
    pub query: Option<String>,
    pub source_id: String,
    pub source_name: String,
    pub start: usize,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreAssetSnippet {
    pub label: String,
    pub media_type: String,
    pub text: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreAssetPublishRule {
    pub copy: bool,
    pub output_path: String,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreAssetInventoryEntry {
    #[serde(default)]
    pub duration_ms: Option<usize>,
    #[serde(default)]
    pub exists: Option<bool>,
    #[serde(default)]
    pub height: Option<usize>,
    pub kind: String,
    pub missing: bool,
    #[serde(default)]
    pub modified_at: Option<String>,
    pub normalized_path: String,
    pub path: String,
    #[serde(default)]
    pub preview_url: Option<String>,
    #[serde(default)]
    pub publish: CoreAssetPublishRule,
    pub reference_count: usize,
    #[serde(default)]
    pub references: Vec<CoreAssetReference>,
    #[serde(default)]
    pub size_bytes: Option<usize>,
    #[serde(default)]
    pub snippet: CoreAssetSnippet,
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    pub unused: bool,
    #[serde(default)]
    pub width: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreTagEntry {
    #[serde(default)]
    pub color: Option<String>,
    pub count: usize,
    pub name: String,
    pub passage_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreContentsEntryKind {
    Metadata,
    Passage,
    Script,
    Stylesheet,
    Tag,
    Variable,
    Asset,
    Diagnostic,
    EntryPoint,
    Orphan,
    BrokenLink,
    Group,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreContentsEntry {
    pub count: usize,
    #[serde(default)]
    pub detail: Option<String>,
    pub id: String,
    pub kind: CoreContentsEntryKind,
    pub label: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    #[serde(default)]
    pub severity: Option<CoreDiagnosticSeverity>,
    #[serde(default)]
    pub source_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreReplacePreview {
    pub after: String,
    pub before: String,
    pub end: usize,
    pub line: usize,
    pub match_text: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    pub replacement: String,
    pub scope: CoreSearchScope,
    pub source_id: String,
    pub source_name: String,
    pub start: usize,
}

impl CoreReplacePreview {
    fn from_hit(hit: &CoreSearchHit) -> Option<Self> {
        Some(Self {
            after: hit.after.clone()?,
            before: hit.before.clone()?,
            end: hit.end,
            line: hit.line,
            match_text: hit.match_text.clone(),
            passage_id: hit.passage_id.clone(),
            replacement: hit.replacement.clone()?,
            scope: hit.scope.clone(),
            source_id: hit.source_id.clone(),
            source_name: hit.source_name.clone(),
            start: hit.start,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreDiagnostic {
    pub code: String,
    pub end: usize,
    pub line: usize,
    pub message: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    #[serde(default)]
    pub quick_fixes: Vec<CoreQuickFix>,
    pub severity: CoreDiagnosticSeverity,
    pub source_id: String,
    pub start: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreQuickFix {
    pub command: String,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreStoryIndexOptions {
    #[serde(default)]
    pub asset_scan_complete: bool,
    #[serde(default)]
    pub fuzzy: bool,
    #[serde(default = "default_true")]
    pub include_assets: bool,
    #[serde(default = "default_true")]
    pub include_contents: bool,
    #[serde(default = "default_true")]
    pub include_diagnostics: bool,
    #[serde(default = "default_true")]
    pub include_files: bool,
    #[serde(default = "default_true")]
    pub include_graph: bool,
    #[serde(default = "default_true")]
    pub include_passage_names: bool,
    #[serde(default = "default_true")]
    pub include_passage_text: bool,
    #[serde(default = "default_true")]
    pub include_script: bool,
    #[serde(default = "default_true")]
    pub include_stylesheet: bool,
    #[serde(default = "default_true")]
    pub include_tags: bool,
    #[serde(default = "default_true")]
    pub include_variables: bool,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub replacement: Option<String>,
    #[serde(default)]
    pub use_regexes: bool,
    #[serde(default)]
    pub known_assets: Vec<CoreAssetInventoryEntry>,
}

impl Default for CoreStoryIndexOptions {
    fn default() -> Self {
        Self {
            asset_scan_complete: false,
            fuzzy: false,
            include_assets: true,
            include_contents: true,
            include_diagnostics: true,
            include_files: true,
            include_graph: true,
            include_passage_names: true,
            include_passage_text: true,
            include_script: true,
            include_stylesheet: true,
            include_tags: true,
            include_variables: true,
            match_case: false,
            query: None,
            replacement: None,
            use_regexes: false,
            known_assets: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreStoryIndex {
    #[serde(default)]
    pub asset_inventory: Vec<CoreAssetInventoryEntry>,
    #[serde(default)]
    pub assets: Vec<CoreAssetReference>,
    #[serde(default)]
    pub contents: Vec<CoreContentsEntry>,
    pub diagnostics: Vec<CoreDiagnostic>,
    pub files: Vec<CoreSourceFile>,
    pub graph: CoreGraphStats,
    #[serde(default)]
    pub replace_previews: Vec<CoreReplacePreview>,
    pub search_hits: Vec<CoreSearchHit>,
    pub story_id: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub tag_entries: Vec<CoreTagEntry>,
    #[serde(default)]
    pub symbols: Vec<CoreSymbol>,
}

/// Compact, always-bounded story facts for shell and route chrome.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreStorySummary {
    pub asset_count: usize,
    pub character_count: usize,
    pub diagnostic_count: usize,
    pub error_count: usize,
    pub graph: CoreGraphStats,
    pub missing_asset_count: usize,
    pub passage_count: usize,
    pub revision: u32,
    pub story_id: String,
    pub tag_count: usize,
    pub warning_count: usize,
    pub word_count: usize,
}

/// Compact diagnostic counts for status chrome, after applying UI dismissals.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreDiagnosticsSummary {
    pub diagnostic_count: usize,
    pub dismissed_count: usize,
    pub error_count: usize,
    pub info_count: usize,
    pub revision: u32,
    pub story_id: String,
    pub warning_count: usize,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreContentsFilter {
    #[default]
    All,
    Asset,
    Diagnostics,
    EntryPoint,
    Group,
    Metadata,
    Passage,
    Problems,
    Script,
    Stylesheet,
    Tag,
    Variable,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreContentsSort {
    #[default]
    Group,
    Issues,
    Name,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreContentsQuery {
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub filter: CoreContentsFilter,
    #[serde(default = "default_read_model_page_limit")]
    pub limit: usize,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub sort: CoreContentsSort,
}

impl Default for CoreContentsQuery {
    fn default() -> Self {
        Self {
            cursor: None,
            filter: CoreContentsFilter::All,
            limit: default_read_model_page_limit(),
            query: None,
            sort: CoreContentsSort::Group,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreContentsFacets {
    pub all: usize,
    pub asset: usize,
    pub diagnostics: usize,
    pub entry_point: usize,
    pub group: usize,
    // False when only source-metadata facets are available. Expensive
    // intelligence facets are populated after an on-demand filtered query.
    pub intelligence_complete: bool,
    pub metadata: usize,
    pub passage: usize,
    pub problems: usize,
    pub script: usize,
    pub stylesheet: usize,
    pub tag: usize,
    pub variable: usize,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreContentsPage {
    #[serde(default)]
    pub assets: Vec<CoreAssetInventoryEntry>,
    pub entries: Vec<CoreContentsEntry>,
    pub facets: CoreContentsFacets,
    #[serde(default)]
    pub next_cursor: Option<String>,
    pub revision: u32,
    pub story_id: String,
    pub total_count: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreSearchQuery {
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub fuzzy: bool,
    #[serde(default = "default_read_model_page_limit")]
    pub limit: usize,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub replacement: Option<String>,
    #[serde(default = "default_true")]
    pub include_passage_names: bool,
    #[serde(default = "default_true")]
    pub include_passage_text: bool,
    #[serde(default = "default_true")]
    pub include_script: bool,
    #[serde(default = "default_true")]
    pub include_stylesheet: bool,
    #[serde(default)]
    pub use_regexes: bool,
}

impl Default for CoreSearchQuery {
    fn default() -> Self {
        Self {
            cursor: None,
            fuzzy: false,
            limit: default_read_model_page_limit(),
            match_case: false,
            query: String::new(),
            replacement: None,
            include_passage_names: true,
            include_passage_text: true,
            include_script: true,
            include_stylesheet: true,
            use_regexes: false,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreSearchPage {
    #[serde(default)]
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub replace_previews: Vec<CoreReplacePreview>,
    pub revision: u32,
    #[serde(default)]
    pub search_hits: Vec<CoreSearchHit>,
    pub story_id: String,
    pub total_count: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreDiagnosticsQuery {
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default = "default_read_model_page_limit")]
    pub limit: usize,
    #[serde(default)]
    pub severity: Option<CoreDiagnosticSeverity>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreDiagnosticsSummaryQuery {
    #[serde(default)]
    pub dismissed_ids: Vec<String>,
}

impl Default for CoreDiagnosticsQuery {
    fn default() -> Self {
        Self {
            cursor: None,
            limit: default_read_model_page_limit(),
            severity: None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreDiagnosticsPage {
    pub diagnostics: Vec<CoreDiagnostic>,
    #[serde(default)]
    pub next_cursor: Option<String>,
    pub revision: u32,
    pub story_id: String,
    pub total_count: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreAssetsQuery {
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default = "default_read_model_page_limit")]
    pub limit: usize,
    #[serde(default)]
    pub query: Option<String>,
}

impl Default for CoreAssetsQuery {
    fn default() -> Self {
        Self {
            cursor: None,
            limit: default_read_model_page_limit(),
            query: None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreAssetsPage {
    pub assets: Vec<CoreAssetInventoryEntry>,
    #[serde(default)]
    pub next_cursor: Option<String>,
    pub revision: u32,
    pub story_id: String,
    pub total_count: usize,
}

/// A bounded, revision-consistent snapshot for the story workbench docks.
///
/// The renderer must not request a complete `CoreStoryIndex` merely to fill
/// navigation and inspector chrome. Each collection is deliberately capped;
/// dedicated routes can continue pagination when the user asks for more.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreWorkbenchDockModel {
    pub assets: CoreAssetsPage,
    pub contents: CoreContentsPage,
    pub diagnostics: CoreDiagnosticsPage,
    pub revision: u32,
    pub story_id: String,
    pub summary: CoreStorySummary,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CorePassageLinkFact {
    pub broken: bool,
    pub source_id: String,
    pub target_id: Option<String>,
    pub target_name: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CorePassageFacts {
    #[serde(default)]
    pub asset_references: Vec<CoreAssetReference>,
    #[serde(default)]
    pub backlinks: Vec<CorePassageLinkFact>,
    pub character_count: usize,
    #[serde(default)]
    pub diagnostics: Vec<CoreDiagnostic>,
    pub excerpt: String,
    pub is_empty: bool,
    pub line_count: usize,
    #[serde(default)]
    pub links: Vec<CorePassageLinkFact>,
    pub passage_id: String,
    pub revision: u32,
    pub story_id: String,
    #[serde(default)]
    pub symbols: Vec<CoreSymbol>,
    pub word_count: usize,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CorePassageLocalFacts {
    #[serde(default)]
    pub asset_references: Vec<CoreAssetReference>,
    pub character_count: usize,
    #[serde(default)]
    pub diagnostics: Vec<CoreDiagnostic>,
    pub excerpt: String,
    pub is_empty: bool,
    pub line_count: usize,
    #[serde(default)]
    pub links: Vec<CorePassageLinkFact>,
    pub passage_id: String,
    pub revision: u32,
    pub story_id: String,
    #[serde(default)]
    pub symbols: Vec<CoreSymbol>,
    pub word_count: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreBacklinksQuery {
    pub cursor: Option<String>,
    #[serde(default = "default_backlinks_page_limit")]
    pub limit: usize,
}

impl Default for CoreBacklinksQuery {
    fn default() -> Self {
        Self {
            cursor: None,
            limit: default_backlinks_page_limit(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreBacklinksPage {
    #[serde(default)]
    pub backlinks: Vec<CorePassageLinkFact>,
    pub next_cursor: Option<String>,
    pub passage_id: String,
    pub revision: u32,
    pub story_id: String,
    pub total_count: usize,
}

/// A revision-bound passage body. Persisted text stays session-owned; callers
/// request only the document they are actively displaying.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CorePassageDocument {
    pub passage_id: String,
    pub revision: u32,
    pub story_id: String,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreSourceDocument {
    pub kind: CoreSourceKind,
    pub revision: u32,
    pub story_id: String,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreDocumentKind {
    Passage,
    Script,
    Stylesheet,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreDocumentQuery {
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default = "default_read_model_page_limit")]
    pub limit: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreDocumentEntry {
    pub kind: CoreDocumentKind,
    #[serde(default)]
    pub passage_id: Option<String>,
    pub text: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreDocumentPage {
    pub documents: Vec<CoreDocumentEntry>,
    #[serde(default)]
    pub next_cursor: Option<String>,
    pub revision: u32,
    pub story_id: String,
    pub total_count: usize,
}

impl From<&Story> for StorySnapshot {
    fn from(value: &Story) -> Self {
        Self {
            id: value.id.as_ref().to_owned(),
            ifid: value.ifid.clone(),
            name: value.name.clone(),
            passages: value.passages.iter().map(PassageSnapshot::from).collect(),
            script: value.script.clone(),
            snap_to_grid: value.snap_to_grid,
            start_passage_id: value.start_passage.as_ref().to_owned(),
            story_format: value.story_format.clone(),
            story_format_version: value.story_format_version.clone(),
            stylesheet: value.stylesheet.clone(),
            tags: value.tags.clone(),
            tag_colors: value.tag_colors.clone(),
            zoom: value.zoom,
        }
    }
}

impl StorySnapshot {
    fn into_story(self) -> Story {
        let story_id = StoryId::new(self.id);
        let passages = self
            .passages
            .into_iter()
            .map(|passage| passage.into_passage(&story_id))
            .collect::<Vec<_>>();

        Story {
            id: story_id,
            ifid: self.ifid,
            name: self.name,
            passages: PassageIndex::from(passages),
            script: self.script,
            snap_to_grid: self.snap_to_grid,
            start_passage: PassageId::new(self.start_passage_id),
            story_format: self.story_format,
            story_format_version: self.story_format_version,
            stylesheet: self.stylesheet,
            tags: self.tags,
            tag_colors: self.tag_colors,
            zoom: self.zoom,
            ..Story::default()
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct ProjectSnapshot {
    pub dirty: bool,
    pub name: String,
    pub schema_version: u32,
    pub stories: Vec<StorySnapshot>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct PassageMove {
    pub passage_id: String,
    pub bounds: CoreRect,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct PassagePatch {
    #[serde(default)]
    pub layout: Option<CoreRect>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct StoryMetadataPatch {
    #[serde(default)]
    pub ifid: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub snap_to_grid: Option<bool>,
    #[serde(default)]
    pub story_format: Option<String>,
    #[serde(default)]
    pub story_format_version: Option<String>,
    #[serde(default)]
    pub tag_colors: Option<BTreeMap<String, String>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub zoom: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct ProjectMetadataPatch {
    #[serde(default)]
    pub name: Option<String>,
}

impl StoryMetadataPatch {
    fn is_empty(&self) -> bool {
        self.ifid.is_none()
            && self.name.is_none()
            && self.snap_to_grid.is_none()
            && self.story_format.is_none()
            && self.story_format_version.is_none()
            && self.tag_colors.is_none()
            && self.tags.is_none()
            && self.zoom.is_none()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreGraphDirection {
    Incoming,
    Outgoing,
    Both,
}

impl From<CoreGraphDirection> for GraphDirection {
    fn from(value: CoreGraphDirection) -> Self {
        match value {
            CoreGraphDirection::Incoming => Self::Incoming,
            CoreGraphDirection::Outgoing => Self::Outgoing,
            CoreGraphDirection::Both => Self::Both,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreGraphEdgeKind {
    Resolved,
    Broken,
    SelfLink,
}

impl From<GraphEdgeKind> for CoreGraphEdgeKind {
    fn from(value: GraphEdgeKind) -> Self {
        match value {
            GraphEdgeKind::Resolved => Self::Resolved,
            GraphEdgeKind::Broken => Self::Broken,
            GraphEdgeKind::SelfLink => Self::SelfLink,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreGraphLayoutSource {
    Saved,
    Generated,
}

impl From<GraphLayoutSource> for CoreGraphLayoutSource {
    fn from(value: GraphLayoutSource) -> Self {
        match value {
            GraphLayoutSource::Saved => Self::Saved,
            GraphLayoutSource::Generated => Self::Generated,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreGraphLayoutState {
    Saved,
    Generated,
    Mixed,
    Partial,
    Missing,
}

impl From<GraphLayoutState> for CoreGraphLayoutState {
    fn from(value: GraphLayoutState) -> Self {
        match value {
            GraphLayoutState::Saved => Self::Saved,
            GraphLayoutState::Generated => Self::Generated,
            GraphLayoutState::Mixed => Self::Mixed,
            GraphLayoutState::Partial => Self::Partial,
            GraphLayoutState::Missing => Self::Missing,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreLinkLayerOptions {
    #[serde(default = "default_true")]
    pub broken: bool,
    #[serde(default = "default_true")]
    pub resolved: bool,
    #[serde(default = "default_true")]
    pub self_links: bool,
}

impl From<CoreLinkLayerOptions> for LinkLayerOptions {
    fn from(value: CoreLinkLayerOptions) -> Self {
        Self {
            broken: value.broken,
            resolved: value.resolved,
            self_links: value.self_links,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphFocus {
    pub direction: CoreGraphDirection,
    pub passage_ids: Vec<String>,
    pub radius: usize,
}

impl From<CoreGraphFocus> for GraphFocus {
    fn from(value: CoreGraphFocus) -> Self {
        Self {
            direction: value.direction.into(),
            passage_ids: value.passage_ids.into_iter().map(PassageId::new).collect(),
            radius: value.radius,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphProjectionOptions {
    #[serde(default)]
    pub focus: Option<CoreGraphFocus>,
    #[serde(default)]
    pub layers: CoreLinkLayerOptions,
    #[serde(default)]
    pub viewport: Option<CoreRect>,
}

impl From<CoreGraphProjectionOptions> for GraphProjectionOptions {
    fn from(value: CoreGraphProjectionOptions) -> Self {
        Self {
            focus: value.focus.map(GraphFocus::from),
            layers: value.layers.into(),
            viewport: value.viewport.map(GraphViewport::from),
            ..GraphProjectionOptions::default()
        }
    }
}

impl From<CoreRect> for GraphViewport {
    fn from(value: CoreRect) -> Self {
        Self {
            height: value.height,
            left: value.left,
            top: value.top,
            width: value.width,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphNode {
    pub bounds: CoreRect,
    pub broken_link_count: usize,
    pub excerpt: String,
    pub id: String,
    pub incoming_count: usize,
    pub is_empty: bool,
    pub is_orphan: bool,
    pub is_start: bool,
    pub is_unreachable: bool,
    pub layout_source: CoreGraphLayoutSource,
    pub name: String,
    pub outgoing_count: usize,
    pub self_link_count: usize,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphEdge {
    pub kind: CoreGraphEdgeKind,
    pub source_bounds: CoreRect,
    pub source_id: String,
    #[serde(default)]
    pub target_bounds: Option<CoreRect>,
    #[serde(default)]
    pub target_id: Option<String>,
    pub target_name: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphStats {
    pub broken_links: usize,
    pub empty_passages: usize,
    pub links: usize,
    pub orphan_passages: usize,
    pub passages: usize,
    pub resolved_links: usize,
    pub self_links: usize,
    pub tagged_passages: usize,
    pub unreachable_passages: usize,
}

impl From<twine_graph::GraphStats> for CoreGraphStats {
    fn from(value: twine_graph::GraphStats) -> Self {
        Self {
            broken_links: value.broken_links,
            empty_passages: value.empty_passages,
            links: value.links,
            orphan_passages: value.orphan_passages,
            passages: value.passages,
            resolved_links: value.resolved_links,
            self_links: value.self_links,
            tagged_passages: value.tagged_passages,
            unreachable_passages: value.unreachable_passages,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphProjection {
    #[serde(default)]
    pub bounds: Option<CoreRect>,
    pub edges: Vec<CoreGraphEdge>,
    pub layout_state: CoreGraphLayoutState,
    pub nodes: Vec<CoreGraphNode>,
    pub stats: CoreGraphStats,
}

impl From<twine_graph::GraphProjection> for CoreGraphProjection {
    fn from(value: twine_graph::GraphProjection) -> Self {
        Self {
            bounds: value.bounds.map(CoreRect::from),
            edges: value
                .edges
                .into_iter()
                .map(|edge| CoreGraphEdge {
                    kind: edge.kind.into(),
                    source_bounds: edge.source_bounds.into(),
                    source_id: edge.source.as_ref().to_owned(),
                    target_bounds: edge.target_bounds.map(CoreRect::from),
                    target_id: edge.target.map(|id| id.as_ref().to_owned()),
                    target_name: edge.target_name,
                })
                .collect(),
            layout_state: value.layout_state.into(),
            nodes: value
                .nodes
                .into_iter()
                .map(|node| CoreGraphNode {
                    bounds: node.bounds.into(),
                    broken_link_count: node.broken_link_count,
                    excerpt: node.excerpt,
                    id: node.id.as_ref().to_owned(),
                    incoming_count: node.incoming_count,
                    is_empty: node.is_empty,
                    is_orphan: node.is_orphan,
                    is_start: node.is_start,
                    is_unreachable: node.is_unreachable,
                    layout_source: node.layout_source.into(),
                    name: node.name,
                    outgoing_count: node.outgoing_count,
                    self_link_count: node.self_link_count,
                    tags: node.tags,
                })
                .collect(),
            stats: value.stats.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum StoryCommand {
    Batch {
        commands: Vec<StoryCommand>,
    },
    CopyAssetSnippet {
        path: String,
        #[serde(default)]
        snippet: Option<String>,
        story_id: String,
    },
    CreateStory {
        story: StorySnapshot,
    },
    CreatePassage {
        #[serde(default)]
        id: Option<String>,
        #[serde(default)]
        layout: Option<CoreRect>,
        #[serde(default)]
        name: Option<String>,
        story_id: String,
        #[serde(default)]
        tags: Vec<String>,
        #[serde(default)]
        text: String,
    },
    DeletePassages {
        passage_ids: Vec<String>,
        story_id: String,
    },
    DeleteStory {
        story_id: String,
    },
    DeleteAsset {
        path: String,
        #[serde(default)]
        remove_references: bool,
        story_id: String,
    },
    ImportAsset {
        #[serde(default)]
        overwrite: bool,
        source_path: String,
        story_id: String,
        #[serde(default)]
        target_path: Option<String>,
    },
    InsertAssetSnippet {
        passage_id: Option<String>,
        path: String,
        position: usize,
        #[serde(default)]
        snippet: Option<String>,
        source_id: String,
        story_id: String,
    },
    MovePassages {
        moves: Vec<PassageMove>,
        story_id: String,
    },
    QueryGraphProjection {
        options: CoreGraphProjectionOptions,
        story_id: String,
    },
    QueryStoryIndex {
        options: CoreStoryIndexOptions,
        story_id: String,
    },
    RenamePassage {
        name: String,
        passage_id: String,
        story_id: String,
        #[serde(default = "default_true")]
        update_references: bool,
    },
    RenamePassageTag {
        new_name: String,
        old_name: String,
        story_id: String,
    },
    RenameStory {
        name: String,
        story_id: String,
    },
    RenameStoryTag {
        new_name: String,
        old_name: String,
    },
    RenameAsset {
        new_path: String,
        path: String,
        story_id: String,
        #[serde(default = "default_true")]
        update_references: bool,
    },
    ReplaceAsset {
        path: String,
        source_path: String,
        story_id: String,
    },
    ReplaceAllText {
        query: CoreSearchQuery,
        story_id: String,
    },
    ReplaceStory {
        story: StorySnapshot,
        story_id: String,
    },
    RevealAsset {
        path: String,
        story_id: String,
    },
    RestorePassages {
        passages: Vec<PassageSnapshot>,
        story_id: String,
    },
    SetPassageTags {
        passage_id: String,
        story_id: String,
        tags: Vec<String>,
    },
    SetStartPassage {
        passage_id: String,
        story_id: String,
    },
    SetStoryTagColor {
        #[serde(default)]
        color: Option<String>,
        name: String,
        story_id: String,
    },
    SetStoryTags {
        story_id: String,
        tags: Vec<String>,
    },
    SetStoryFormat {
        story_format: String,
        story_format_version: String,
        story_id: String,
    },
    SetStorySnapToGrid {
        enabled: bool,
        story_id: String,
    },
    SetStoryZoom {
        story_id: String,
        zoom: f64,
    },
    SaveGeneratedLayout {
        story_id: String,
    },
    UpdatePassageText {
        passage_id: String,
        story_id: String,
        text: String,
    },
    UpdatePassage {
        changes: PassagePatch,
        passage_id: String,
        story_id: String,
        #[serde(default = "default_true")]
        update_references: bool,
    },
    UpdateStoryScript {
        script: String,
        story_id: String,
    },
    UpdateStoryStylesheet {
        story_id: String,
        stylesheet: String,
    },
    ValidateAssetReferences {
        story_id: String,
    },
}

impl StoryCommand {
    fn label(&self) -> &'static str {
        match self {
            Self::Batch { .. } => "Batch",
            Self::CopyAssetSnippet { .. } => "Copy Asset Snippet",
            Self::CreateStory { .. } => "New Story",
            Self::CreatePassage { .. } => "New Passage",
            Self::DeleteAsset { .. } => "Delete Asset",
            Self::DeletePassages { .. } => "Delete Passages",
            Self::DeleteStory { .. } => "Delete Story",
            Self::ImportAsset { .. } => "Import Asset",
            Self::InsertAssetSnippet { .. } => "Insert Asset Snippet",
            Self::MovePassages { .. } => "Move Passages",
            Self::QueryGraphProjection { .. } => "Query Graph",
            Self::QueryStoryIndex { .. } => "Query Story Index",
            Self::RenameAsset { .. } => "Rename Asset",
            Self::RenamePassage { .. } => "Rename Passage",
            Self::RenamePassageTag { .. } => "Rename Passage Tag",
            Self::RenameStory { .. } => "Rename Story",
            Self::RenameStoryTag { .. } => "Rename Story Tag",
            Self::ReplaceAsset { .. } => "Replace Asset",
            Self::ReplaceAllText { .. } => "Replace All Text",
            Self::ReplaceStory { .. } => "Replace Story",
            Self::RestorePassages { .. } => "Restore Passages",
            Self::RevealAsset { .. } => "Reveal Asset",
            Self::SaveGeneratedLayout { .. } => "Save Layout",
            Self::SetPassageTags { .. } => "Set Passage Tags",
            Self::SetStartPassage { .. } => "Set Start Passage",
            Self::SetStoryFormat { .. } => "Set Story Format",
            Self::SetStorySnapToGrid { .. } => "Set Story Snap To Grid",
            Self::SetStoryTagColor { .. } => "Set Story Tag Color",
            Self::SetStoryTags { .. } => "Set Story Tags",
            Self::SetStoryZoom { .. } => "Set Story Zoom",
            Self::UpdatePassage { .. } => "Update Passage",
            Self::UpdatePassageText { .. } => "Update Passage Text",
            Self::UpdateStoryScript { .. } => "Update Story JavaScript",
            Self::UpdateStoryStylesheet { .. } => "Update Story Stylesheet",
            Self::ValidateAssetReferences { .. } => "Validate Asset References",
        }
    }

    fn mutates_project(&self) -> bool {
        !matches!(
            self,
            Self::CopyAssetSnippet { .. }
                | Self::QueryGraphProjection { .. }
                | Self::QueryStoryIndex { .. }
                | Self::RevealAsset { .. }
                | Self::ValidateAssetReferences { .. }
        )
    }

    fn has_external_effect(&self) -> bool {
        matches!(
            self,
            Self::DeleteAsset { .. }
                | Self::ImportAsset { .. }
                | Self::RenameAsset { .. }
                | Self::ReplaceAsset { .. }
        )
    }

    fn history_kind(&self) -> CoreHistoryKind {
        match self {
            Self::Batch { .. } => CoreHistoryKind::Batch,
            Self::CreateStory { .. } => CoreHistoryKind::CreateStory,
            Self::CreatePassage { .. } | Self::RestorePassages { .. } => {
                CoreHistoryKind::NewPassage
            }
            Self::DeleteAsset { .. } => CoreHistoryKind::DeleteAsset,
            Self::DeletePassages { .. } => CoreHistoryKind::DeletePassage,
            Self::DeleteStory { .. } => CoreHistoryKind::DeleteStory,
            Self::ImportAsset { .. } => CoreHistoryKind::ImportAsset,
            Self::InsertAssetSnippet { .. } => CoreHistoryKind::InsertAsset,
            Self::MovePassages { .. } => CoreHistoryKind::MovePassage,
            Self::RenameAsset { .. } => CoreHistoryKind::RenameAsset,
            Self::RenamePassage { .. } => CoreHistoryKind::RenamePassage,
            Self::RenameStory { .. } => CoreHistoryKind::RenameStory,
            Self::RenamePassageTag { .. } | Self::RenameStoryTag { .. } => {
                CoreHistoryKind::RenameTag
            }
            Self::ReplaceAsset { .. } => CoreHistoryKind::ReplaceAsset,
            Self::ReplaceAllText { .. } => CoreHistoryKind::EditPassage,
            Self::ReplaceStory { .. } => CoreHistoryKind::StoryDetails,
            Self::SaveGeneratedLayout { .. } => CoreHistoryKind::SaveLayout,
            Self::SetStartPassage { .. } => CoreHistoryKind::SetStartPassage,
            Self::SetPassageTags { .. }
            | Self::SetStoryFormat { .. }
            | Self::SetStorySnapToGrid { .. }
            | Self::SetStoryTagColor { .. }
            | Self::SetStoryTags { .. }
            | Self::SetStoryZoom { .. } => CoreHistoryKind::StoryDetails,
            Self::UpdatePassage { .. }
            | Self::UpdatePassageText { .. }
            | Self::UpdateStoryScript { .. }
            | Self::UpdateStoryStylesheet { .. } => CoreHistoryKind::EditPassage,
            Self::CopyAssetSnippet { .. }
            | Self::QueryGraphProjection { .. }
            | Self::QueryStoryIndex { .. }
            | Self::RevealAsset { .. }
            | Self::ValidateAssetReferences { .. } => CoreHistoryKind::Batch,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum Patch {
    AssetDeleted {
        path: String,
        story_id: String,
    },
    AssetImported {
        asset: CoreAssetInventoryEntry,
        story_id: String,
    },
    AssetInventoryUpdated {
        inventory: Vec<CoreAssetInventoryEntry>,
        story_id: String,
    },
    AssetRenamed {
        new_path: String,
        old_path: String,
        story_id: String,
    },
    AssetReplaced {
        asset: CoreAssetInventoryEntry,
        story_id: String,
    },
    AssetRevealed {
        path: String,
        reveal_path: String,
        story_id: String,
    },
    AssetSnippetCopied {
        path: String,
        snippet: String,
        story_id: String,
    },
    AssetSnippetInserted {
        path: String,
        snippet: String,
        source_id: String,
        story_id: String,
    },
    DirtyStateChanged {
        dirty: bool,
    },
    GraphProjectionUpdated {
        projection: CoreGraphProjection,
        story_id: String,
    },
    LayoutSaved {
        projection: CoreGraphProjection,
        story_id: String,
    },
    PassageCreated {
        passage: PassageSnapshot,
        story_id: String,
    },
    PassageDeleted {
        passage_id: String,
        story_id: String,
    },
    PassageUpdated {
        changes: PassagePatch,
        passage_id: String,
        story_id: String,
    },
    ProjectSnapshotReplaced {
        snapshot: ProjectSnapshot,
    },
    ProjectMetadataUpdated {
        changes: ProjectMetadataPatch,
        story_id: String,
    },
    StartPassageChanged {
        passage_id: String,
        story_id: String,
    },
    StoryCreated {
        story: StorySnapshot,
    },
    StoryDeleted {
        story_id: String,
    },
    StoryIndexUpdated {
        index: CoreStoryIndex,
        story_id: String,
    },
    StoryMetadataUpdated {
        changes: StoryMetadataPatch,
        story_id: String,
    },
    StoryScriptUpdated {
        script: String,
        story_id: String,
    },
    StoryStylesheetUpdated {
        story_id: String,
        stylesheet: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct PatchBatch {
    pub label: String,
    pub patches: Vec<Patch>,
    pub transaction_id: u64,
}

#[derive(Clone, Debug, Error, PartialEq)]
pub enum CoreError {
    #[error("asset already exists: {0}")]
    AssetAlreadyExists(String),

    #[error("asset file not found: {0}")]
    AssetFileNotFound(String),

    #[error("asset host is not configured")]
    AssetHostUnavailable,

    #[error("duplicate passage name: {0}")]
    DuplicatePassageName(String),

    #[error("duplicate story id: {0}")]
    DuplicateStoryId(String),

    #[error("duplicate story name: {0}")]
    DuplicateStoryName(String),

    #[error("I/O error: {0}")]
    Io(String),

    #[error("passage not found: {0}")]
    PassageNotFound(String),

    #[error("story not found: {0}")]
    StoryNotFound(String),

    #[error("unsupported command: {0}")]
    UnsupportedCommand(String),

    #[error("unsafe asset path: {0}")]
    UnsafeAssetPath(String),

    #[error("stale read-model cursor")]
    StaleReadModelCursor,
}

#[derive(Clone, Debug, Serialize)]
struct IndexedStory {
    index: usize,
    value: Story,
}

#[derive(Clone, Debug, Serialize)]
struct IndexedPassage {
    index: usize,
    value: Passage,
}

#[derive(Clone, Debug, Serialize)]
struct PassageDelta {
    after: Option<IndexedPassage>,
    before: Option<IndexedPassage>,
    passage_id: PassageId,
}

#[derive(Clone, Debug, Serialize)]
enum StoryDelta {
    Replace {
        after: Option<IndexedStory>,
        before: Option<IndexedStory>,
        story_id: StoryId,
    },
    Update {
        after: Story,
        before: Story,
        passages: Vec<PassageDelta>,
        story_id: StoryId,
    },
}

#[derive(Clone, Debug, Default, Serialize)]
struct ProjectDelta {
    layout_passages: Vec<ProjectLayoutPassageDelta>,
    project_layout: Option<ProjectLayoutDelta>,
    project_scope_story_id: Option<StoryId>,
    top_after: Option<Project>,
    top_before: Option<Project>,
    stories: Vec<StoryDelta>,
}

#[derive(Clone, Debug, Serialize)]
struct ProjectLayoutPassageDelta {
    after: Option<PassageLayout>,
    before: Option<PassageLayout>,
    passage_id: PassageId,
    story_id: StoryId,
}

#[derive(Clone, Debug, Serialize)]
struct ProjectLayoutDelta {
    after: GraphLayout,
    before: GraphLayout,
}

#[derive(Clone, Debug, Serialize)]
struct AssetInventoryDelta {
    after: Option<CoreAssetInventoryEntry>,
    before: Option<CoreAssetInventoryEntry>,
    normalized_path: String,
}

fn asset_inventory_delta(
    before: &[CoreAssetInventoryEntry],
    after: &[CoreAssetInventoryEntry],
) -> Vec<AssetInventoryDelta> {
    let before = before
        .iter()
        .map(|asset| (asset.normalized_path.clone(), asset))
        .collect::<BTreeMap<_, _>>();
    let after = after
        .iter()
        .map(|asset| (asset.normalized_path.clone(), asset))
        .collect::<BTreeMap<_, _>>();

    before
        .keys()
        .chain(after.keys())
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter_map(|normalized_path| {
            let before = before.get(&normalized_path).copied().cloned();
            let after = after.get(&normalized_path).copied().cloned();

            (before != after).then_some(AssetInventoryDelta {
                after,
                before,
                normalized_path,
            })
        })
        .collect()
}

fn apply_asset_inventory_delta(
    inventory: &mut Vec<CoreAssetInventoryEntry>,
    delta: &[AssetInventoryDelta],
    forward: bool,
) {
    let paths = delta
        .iter()
        .map(|change| &change.normalized_path)
        .collect::<BTreeSet<_>>();

    inventory.retain(|asset| !paths.contains(&asset.normalized_path));
    inventory.extend(delta.iter().filter_map(|change| {
        if forward {
            change.after.clone()
        } else {
            change.before.clone()
        }
    }));
    inventory.sort_by(|left, right| left.path.cmp(&right.path));
}

impl ProjectDelta {
    fn between(before: &Project, after: &Project) -> Self {
        let mut before_top = before.clone();
        let mut after_top = after.clone();
        let project_scope_story_id = after
            .stories
            .first()
            .or_else(|| before.stories.first())
            .map(|story| story.id.clone());
        let layout_passages = before
            .layout
            .passages
            .iter()
            .map(|(story_id, passage_id, _)| (story_id.clone(), passage_id.clone()))
            .chain(
                after
                    .layout
                    .passages
                    .iter()
                    .map(|(story_id, passage_id, _)| (story_id.clone(), passage_id.clone())),
            )
            .collect::<BTreeSet<_>>()
            .into_iter()
            .filter_map(|(story_id, passage_id)| {
                let before = before.layout.passages.get(&story_id, &passage_id).cloned();
                let after = after.layout.passages.get(&story_id, &passage_id).cloned();

                (before != after).then_some(ProjectLayoutPassageDelta {
                    after,
                    before,
                    passage_id,
                    story_id,
                })
            })
            .collect::<Vec<_>>();

        before_top.stories.clear();
        after_top.stories.clear();
        before_top.layout.passages.clear();
        after_top.layout.passages.clear();
        let top_changed = before_top != after_top;
        let before_by_id = before
            .stories
            .iter()
            .enumerate()
            .map(|(index, story)| (story.id.clone(), (index, story)))
            .collect::<BTreeMap<_, _>>();
        let after_by_id = after
            .stories
            .iter()
            .enumerate()
            .map(|(index, story)| (story.id.clone(), (index, story)))
            .collect::<BTreeMap<_, _>>();
        let story_ids = before_by_id
            .keys()
            .chain(after_by_id.keys())
            .cloned()
            .collect::<BTreeSet<_>>();
        let mut stories = Vec::new();

        for story_id in story_ids {
            let before_story = before_by_id.get(&story_id);
            let after_story = after_by_id.get(&story_id);

            match (before_story, after_story) {
                (Some((_, before_story)), Some((_, after_story))) => {
                    let mut before_shell = (*before_story).clone();
                    let mut after_shell = (*after_story).clone();

                    before_shell.passages.clear();
                    after_shell.passages.clear();
                    let before_passages = before_story
                        .passages
                        .iter()
                        .enumerate()
                        .map(|(index, passage)| (passage.id.clone(), (index, passage)))
                        .collect::<BTreeMap<_, _>>();
                    let after_passages = after_story
                        .passages
                        .iter()
                        .enumerate()
                        .map(|(index, passage)| (passage.id.clone(), (index, passage)))
                        .collect::<BTreeMap<_, _>>();
                    let passage_ids = before_passages
                        .keys()
                        .chain(after_passages.keys())
                        .cloned()
                        .collect::<BTreeSet<_>>();
                    let passages = passage_ids
                        .into_iter()
                        .filter_map(|passage_id| {
                            let before =
                                before_passages.get(&passage_id).map(|(index, passage)| {
                                    IndexedPassage {
                                        index: *index,
                                        value: (*passage).clone(),
                                    }
                                });
                            let after = after_passages.get(&passage_id).map(|(index, passage)| {
                                IndexedPassage {
                                    index: *index,
                                    value: (*passage).clone(),
                                }
                            });

                            (before.as_ref().map(|value| &value.value)
                                != after.as_ref().map(|value| &value.value))
                            .then_some(PassageDelta {
                                after,
                                before,
                                passage_id,
                            })
                        })
                        .collect::<Vec<_>>();

                    if before_shell != after_shell || !passages.is_empty() {
                        stories.push(StoryDelta::Update {
                            after: after_shell,
                            before: before_shell,
                            passages,
                            story_id,
                        });
                    }
                }
                (before_story, after_story) => {
                    stories.push(StoryDelta::Replace {
                        after: after_story.map(|(index, story)| IndexedStory {
                            index: *index,
                            value: (*story).clone(),
                        }),
                        before: before_story.map(|(index, story)| IndexedStory {
                            index: *index,
                            value: (*story).clone(),
                        }),
                        story_id,
                    });
                }
            }
        }

        Self {
            layout_passages,
            project_layout: None,
            project_scope_story_id,
            top_after: top_changed.then_some(after_top),
            top_before: top_changed.then_some(before_top),
            stories,
        }
    }

    fn apply_non_structural_passage_updates(&self, project: &mut Project, forward: bool) -> bool {
        if self.top_before.is_some()
            || self.top_after.is_some()
            || self.project_layout.is_some()
            || !self.layout_passages.is_empty()
            || self.stories.is_empty()
        {
            return false;
        }

        let mut updates = Vec::<(usize, Vec<(usize, PassageId, Passage)>)>::new();
        for delta in &self.stories {
            let StoryDelta::Update {
                after,
                before,
                passages,
                story_id,
            } = delta
            else {
                return false;
            };
            if before != after || passages.is_empty() {
                return false;
            }
            let Some(story_index) = project
                .stories
                .iter()
                .position(|story| &story.id == story_id)
            else {
                return false;
            };
            let mut seen = BTreeSet::new();
            let mut passage_updates = Vec::with_capacity(passages.len());

            for passage_delta in passages {
                let values = if forward {
                    (&passage_delta.before, &passage_delta.after)
                } else {
                    (&passage_delta.after, &passage_delta.before)
                };
                let (Some(before), Some(after)) = values else {
                    return false;
                };
                if before.index != after.index
                    || before.value.id != passage_delta.passage_id
                    || after.value.id != passage_delta.passage_id
                    || !seen.insert(passage_delta.passage_id.clone())
                    || project.stories[story_index]
                        .passages
                        .iter()
                        .nth(before.index)
                        .is_none_or(|passage| passage.id != passage_delta.passage_id)
                {
                    return false;
                }
                passage_updates.push((
                    before.index,
                    passage_delta.passage_id.clone(),
                    after.value.clone(),
                ));
            }
            updates.push((story_index, passage_updates));
        }

        for (story_index, passage_updates) in updates {
            let story = &mut project.stories[story_index];
            for (_, passage_id, value) in passage_updates {
                story
                    .passage_by_id_mut(&passage_id)
                    .expect("validated non-structural passage delta")
                    .clone_from(&value);
            }
            story.passages.rebuild_name_index();
        }
        true
    }

    fn apply(&self, project: &mut Project, forward: bool) {
        if self.apply_non_structural_passage_updates(project, forward) {
            return;
        }
        if let Some(top) = if forward {
            self.top_after.as_ref()
        } else {
            self.top_before.as_ref()
        } {
            let passage_layouts = std::mem::take(&mut project.layout.passages);
            project.layout = top.layout.clone();
            project.layout.passages = passage_layouts;
            project.library = top.library.clone();
            project.manifest = top.manifest.clone();
        }

        if let Some(delta) = &self.project_layout {
            let value = if forward { &delta.after } else { &delta.before };

            project.layout.annotations.clone_from(&value.annotations);
            project.layout.groups.clone_from(&value.groups);
            project.layout.metadata.clone_from(&value.metadata);
            project
                .layout
                .saved_layouts
                .clone_from(&value.saved_layouts);
        }

        for delta in &self.layout_passages {
            let value = if forward {
                delta.after.as_ref()
            } else {
                delta.before.as_ref()
            };

            if let Some(value) = value {
                project.layout.passages.insert(
                    delta.story_id.clone(),
                    delta.passage_id.clone(),
                    value.clone(),
                );
            } else {
                project
                    .layout
                    .passages
                    .remove(&delta.story_id, &delta.passage_id);
            }
        }

        let replacement_ids = self
            .stories
            .iter()
            .filter_map(|delta| match delta {
                StoryDelta::Replace { story_id, .. } => Some(story_id),
                StoryDelta::Update { .. } => None,
            })
            .collect::<BTreeSet<_>>();

        project
            .stories
            .retain(|story| !replacement_ids.contains(&story.id));
        let mut story_inserts = self
            .stories
            .iter()
            .filter_map(|delta| match delta {
                StoryDelta::Replace { after, before, .. } => {
                    if forward {
                        after.as_ref()
                    } else {
                        before.as_ref()
                    }
                }
                StoryDelta::Update { .. } => None,
            })
            .cloned()
            .collect::<Vec<_>>();

        story_inserts.sort_by_key(|story| story.index);
        for story in story_inserts {
            project
                .stories
                .insert(story.index.min(project.stories.len()), story.value);
        }

        for delta in &self.stories {
            let StoryDelta::Update {
                after,
                before,
                passages,
                story_id,
            } = delta
            else {
                continue;
            };
            let Some(story_index) = project
                .stories
                .iter()
                .position(|story| &story.id == story_id)
            else {
                continue;
            };
            let current_passages = &project.stories[story_index].passages;
            let passage_ids = passages
                .iter()
                .map(|delta| &delta.passage_id)
                .collect::<BTreeSet<_>>();
            let mut next_passages = current_passages
                .iter()
                .filter(|passage| !passage_ids.contains(&passage.id))
                .cloned()
                .collect::<Vec<_>>();
            let mut passage_inserts = passages
                .iter()
                .filter_map(|delta| {
                    if forward {
                        delta.after.as_ref()
                    } else {
                        delta.before.as_ref()
                    }
                })
                .cloned()
                .collect::<Vec<_>>();

            passage_inserts.sort_by_key(|passage| passage.index);
            for passage in passage_inserts {
                next_passages.insert(passage.index.min(next_passages.len()), passage.value);
            }

            let mut next_story = if forward {
                after.clone()
            } else {
                before.clone()
            };

            next_story.passages = PassageIndex::from(next_passages);
            project.stories[story_index] = next_story;
        }
    }

    fn graph_facts_changed(delta: &StoryDelta) -> bool {
        match delta {
            StoryDelta::Replace { .. } => true,
            StoryDelta::Update {
                after,
                before,
                passages,
                ..
            } => {
                before.start_passage != after.start_passage
                    || passages
                        .iter()
                        .any(|delta| match (&delta.before, &delta.after) {
                            (Some(before), Some(after)) => {
                                before.value.name != after.value.name
                                    || before.value.tags != after.value.tags
                                    || before.value.text != after.value.text
                            }
                            _ => true,
                        })
            }
        }
    }

    fn patches(&self, forward: bool) -> Vec<Patch> {
        let mut patches = Vec::new();

        if let (Some(before), Some(after)) = (&self.top_before, &self.top_after) {
            let (from, to) = if forward {
                (before, after)
            } else {
                (after, before)
            };
            if from.manifest.name != to.manifest.name {
                let story_id = self
                    .project_scope_story_id
                    .as_ref()
                    .map(|story_id| story_id.as_ref().to_owned());
                if let Some(story_id) = story_id {
                    patches.push(Patch::ProjectMetadataUpdated {
                        changes: ProjectMetadataPatch {
                            name: Some(to.manifest.name.clone()),
                        },
                        story_id,
                    });
                }
            }
        }

        for story_delta in &self.stories {
            match story_delta {
                StoryDelta::Replace {
                    after,
                    before,
                    story_id,
                } => {
                    let (from, to) = if forward {
                        (before, after)
                    } else {
                        (after, before)
                    };

                    match (from, to) {
                        (None, Some(story)) => patches.push(Patch::StoryCreated {
                            story: StorySnapshot::from(&story.value),
                        }),
                        (Some(_), None) => patches.push(Patch::StoryDeleted {
                            story_id: story_id.as_ref().to_owned(),
                        }),
                        _ => {}
                    }
                }
                StoryDelta::Update {
                    after,
                    before,
                    passages,
                    story_id,
                } => {
                    let (from_story, to_story) = if forward {
                        (before, after)
                    } else {
                        (after, before)
                    };
                    let story_id = story_id.as_ref().to_owned();

                    for passage in passages {
                        let (from, to) = if forward {
                            (&passage.before, &passage.after)
                        } else {
                            (&passage.after, &passage.before)
                        };

                        match (from, to) {
                            (None, Some(passage)) => {
                                patches.push(Patch::PassageCreated {
                                    passage: PassageSnapshot::from(&passage.value),
                                    story_id: story_id.clone(),
                                });
                            }
                            (Some(_), None) => patches.push(Patch::PassageDeleted {
                                passage_id: passage.passage_id.as_ref().to_owned(),
                                story_id: story_id.clone(),
                            }),
                            (Some(from), Some(to)) => {
                                let changes = passage_diff_patch(&from.value, &to.value);

                                if !passage_patch_is_empty(&changes) {
                                    patches.push(Patch::PassageUpdated {
                                        changes,
                                        passage_id: passage.passage_id.as_ref().to_owned(),
                                        story_id: story_id.clone(),
                                    });
                                }
                            }
                            (None, None) => {}
                        }
                    }

                    if from_story.start_passage != to_story.start_passage {
                        patches.push(Patch::StartPassageChanged {
                            passage_id: to_story.start_passage.as_ref().to_owned(),
                            story_id: story_id.clone(),
                        });
                    }
                    let metadata = story_metadata_diff_patch(from_story, to_story);

                    if !metadata.is_empty() {
                        patches.push(Patch::StoryMetadataUpdated {
                            changes: metadata,
                            story_id: story_id.clone(),
                        });
                    }
                    if from_story.script != to_story.script {
                        patches.push(Patch::StoryScriptUpdated {
                            script: to_story.script.clone(),
                            story_id: story_id.clone(),
                        });
                    }
                    if from_story.stylesheet != to_story.stylesheet {
                        patches.push(Patch::StoryStylesheetUpdated {
                            story_id,
                            stylesheet: to_story.stylesheet.clone(),
                        });
                    }
                }
            }
        }

        patches
    }
}

fn story_shell_without_passages(story: &Story) -> Story {
    Story {
        color: story.color.clone(),
        custom_attributes: story.custom_attributes.clone(),
        format_options: story.format_options.clone(),
        ifid: story.ifid.clone(),
        id: story.id.clone(),
        last_update: story.last_update.clone(),
        metadata: story.metadata.clone(),
        name: story.name.clone(),
        passages: PassageIndex::default(),
        script: story.script.clone(),
        snap_to_grid: story.snap_to_grid,
        start_passage: story.start_passage.clone(),
        story_format: story.story_format.clone(),
        story_format_version: story.story_format_version.clone(),
        stylesheet: story.stylesheet.clone(),
        tag_colors: story.tag_colors.clone(),
        tags: story.tags.clone(),
        zoom: story.zoom,
    }
}

fn project_layout_shell_without_passages(layout: &GraphLayout) -> GraphLayout {
    GraphLayout {
        annotations: layout.annotations.clone(),
        groups: layout.groups.clone(),
        metadata: layout.metadata.clone(),
        saved_layouts: layout.saved_layouts.clone(),
        ..GraphLayout::default()
    }
}

fn sync_fingerprints_for_delta(
    project: &Project,
    values: &mut BTreeMap<String, u64>,
    delta: &ProjectDelta,
) -> BTreeSet<String> {
    let mut touched = BTreeSet::new();

    if delta.top_before.is_some() || delta.top_after.is_some() {
        touched.extend([
            "project:manifest".to_owned(),
            "project:library".to_owned(),
            "project:layout".to_owned(),
        ]);
        insert_project_fingerprints(values, project);
    }
    if delta.project_layout.is_some() {
        touched.insert("project:layout".to_owned());
        values.insert(
            "project:layout".into(),
            fingerprint(&project_layout_shell_without_passages(&project.layout)),
        );
    }

    for story_delta in &delta.stories {
        match story_delta {
            StoryDelta::Replace { story_id, .. } => {
                let story_prefix = format!("story:{}:", story_id.as_ref());
                let passage_prefix = format!("passage:{}:", story_id.as_ref());
                let removed = values
                    .keys()
                    .filter(|field| {
                        field.starts_with(&story_prefix) || field.starts_with(&passage_prefix)
                    })
                    .cloned()
                    .collect::<Vec<_>>();

                for field in removed {
                    values.remove(&field);
                    touched.insert(field);
                }
                if let Some(story) = project.stories.iter().find(|story| story.id == *story_id) {
                    let before = values.keys().cloned().collect::<BTreeSet<_>>();

                    insert_story_fingerprints(values, story, true);
                    touched.extend(
                        values
                            .keys()
                            .filter(|field| !before.contains(*field))
                            .cloned(),
                    );
                }
            }
            StoryDelta::Update {
                passages, story_id, ..
            } => {
                let Some(story) = project.stories.iter().find(|story| story.id == *story_id) else {
                    continue;
                };
                let story_id_value = story_id.as_ref();
                touched.extend([
                    format!("story:{story_id_value}:exists"),
                    format!("story:{story_id_value}:ifid"),
                    format!("story:{story_id_value}:name"),
                    format!("story:{story_id_value}:snapToGrid"),
                    format!("story:{story_id_value}:startPassage"),
                    format!("story:{story_id_value}:storyFormat"),
                    format!("story:{story_id_value}:storyFormatVersion"),
                    format!("story:{story_id_value}:tagColors"),
                    format!("story:{story_id_value}:tags"),
                    format!("story:{story_id_value}:zoom"),
                    format!("story:{story_id_value}:script"),
                    format!("story:{story_id_value}:stylesheet"),
                ]);
                insert_story_fingerprints(values, story, false);

                for passage_delta in passages {
                    let prefix = format!(
                        "passage:{}:{}:",
                        story_id.as_ref(),
                        passage_delta.passage_id.as_ref()
                    );
                    let fields = [
                        format!("{prefix}exists"),
                        format!("{prefix}layout"),
                        format!("{prefix}name"),
                        format!("{prefix}tags"),
                        format!("{prefix}text"),
                    ];

                    for field in &fields {
                        values.remove(field);
                        touched.insert(field.clone());
                    }
                    if let Some(passage) = story.passage_by_id(&passage_delta.passage_id) {
                        insert_passage_fingerprints(values, story_id.as_ref(), passage);
                    }
                }
            }
        }
    }

    touched
}

#[derive(Clone, Debug)]
struct Transaction {
    after_state_id: u64,
    assets: Vec<AssetInventoryDelta>,
    before_state_id: u64,
    byte_size: usize,
    delta: ProjectDelta,
    kind: CoreHistoryKind,
    label: String,
}

#[derive(Clone, Debug)]
struct GraphSessionCache {
    graph: GraphIndex,
    layout: GraphLayoutSnapshot,
}

#[derive(Clone, Debug)]
struct BacklinkCacheEntry {
    byte_size: usize,
    revision: u64,
    source_ranks: Vec<usize>,
    target_name: String,
}

/// Source-metadata-only Contents records. Building this catalog never parses a
/// source or initializes the graph, so the default Contents route can return a
/// bounded useful page before the expensive intelligence indexes are needed.
#[derive(Clone, Debug)]
struct StoryContentsCatalog {
    contents: BTreeMap<String, CoreContentsEntry>,
    facets: CoreContentsFacets,
    revision: u64,
    tag_usage: BTreeMap<String, BTreeSet<String>>,
}

/// Compact server-side read records shared by Contents, diagnostics, assets,
/// and shell summary queries. This deliberately excludes files, symbols,
/// search hits, previews, and the complete compatibility `CoreStoryIndex`:
/// retaining that object was a measurable 50k memory regression.
#[derive(Clone, Debug)]
struct StoryReadModelCache {
    asset_inventory: Vec<CoreAssetInventoryEntry>,
    asset_entry_ids: BTreeSet<String>,
    assets_by_source: BTreeMap<String, Vec<CoreAssetReference>>,
    character_count: usize,
    contents: BTreeMap<String, CoreContentsEntry>,
    diagnostic_entry_ids: BTreeSet<String>,
    diagnostics: Vec<CoreDiagnostic>,
    entry_point_id: Option<String>,
    graph: CoreGraphStats,
    orphan_entry_ids: BTreeSet<String>,
    revision: u64,
    symbol_entry_ids: BTreeSet<String>,
    symbols_by_source: BTreeMap<String, Vec<CoreSymbol>>,
    tag_count: usize,
    tag_usage: BTreeMap<String, BTreeSet<String>>,
    word_count: usize,
}

#[derive(Clone, Debug)]
struct SourceAnalysisCache {
    assets: Vec<CoreAssetReference>,
    file: CoreSourceFile,
    name: String,
    source_fingerprint: u64,
    symbols: Vec<CoreSymbol>,
    tags: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreSessionPerformanceDiagnostics {
    pub analysis_cache_source_count: usize,
    pub backlink_cache_bytes: usize,
    pub backlink_cache_entry_count: usize,
    pub backlink_cache_hit_count: usize,
    pub backlink_scan_count: usize,
    pub backlink_scanned_source_count: usize,
    pub fingerprint_entry_count: usize,
    pub graph_cache_story_count: usize,
    pub history_bytes: usize,
    #[serde(default)]
    pub last_mutation: Option<CoreMutationStageTimings>,
    pub parsed_source_count: usize,
    pub passage_count: usize,
    pub project_document_bytes: usize,
    pub refactor_planning_task_bytes: usize,
    pub refactor_planning_task_count: usize,
    pub refactor_plan_store_bytes: usize,
    pub refactor_plan_store_entry_count: usize,
    pub refactor_plan_store_fingerprint: String,
    pub read_model_cache_story_count: usize,
    pub read_model_full_build_count: usize,
    pub read_model_incremental_update_count: usize,
    pub read_model_last_touched_source_count: usize,
    pub redo_entry_count: usize,
    pub undo_entry_count: usize,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreMutationStageTimings {
    pub analysis_ms: f64,
    pub delta_id: String,
    pub fingerprint_ms: f64,
    pub graph_ms: f64,
    pub graph_parsed_source_count: usize,
    pub history_ms: f64,
    pub lookup_and_delta_ms: f64,
    pub operation: String,
    pub patch_finalize_ms: f64,
    pub project_mutation_ms: f64,
    pub read_model_ms: f64,
    pub revision: u64,
    pub savepoint_ms: f64,
    pub topology_changed: bool,
    pub total_ms: f64,
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1_000.0
}

fn fingerprint(value: &impl Serialize) -> u64 {
    let mut hasher = DefaultHasher::new();

    serde_json::to_string(value)
        .unwrap_or_default()
        .hash(&mut hasher);
    hasher.finish()
}

fn source_fingerprint(source: &str) -> u64 {
    let mut hasher = DefaultHasher::new();

    source.hash(&mut hasher);
    hasher.finish()
}

fn project_fingerprints(project: &Project) -> BTreeMap<String, u64> {
    let mut values = BTreeMap::new();

    insert_project_fingerprints(&mut values, project);

    for story in &project.stories {
        insert_story_fingerprints(&mut values, story, true);
    }

    values
}

fn insert_project_fingerprints(values: &mut BTreeMap<String, u64>, project: &Project) {
    values.insert("project:manifest".into(), fingerprint(&project.manifest));
    values.insert("project:library".into(), fingerprint(&project.library));
    values.insert(
        "project:layout".into(),
        fingerprint(&project_layout_shell_without_passages(&project.layout)),
    );
}

fn insert_story_fingerprints(
    values: &mut BTreeMap<String, u64>,
    story: &Story,
    include_passages: bool,
) {
    let story_id = story.id.as_ref();

    values.insert(format!("story:{story_id}:exists"), fingerprint(&true));
    values.insert(format!("story:{story_id}:ifid"), fingerprint(&story.ifid));
    values.insert(format!("story:{story_id}:name"), fingerprint(&story.name));
    values.insert(
        format!("story:{story_id}:snapToGrid"),
        fingerprint(&story.snap_to_grid),
    );
    values.insert(
        format!("story:{story_id}:startPassage"),
        fingerprint(&story.start_passage),
    );
    values.insert(
        format!("story:{story_id}:storyFormat"),
        fingerprint(&story.story_format),
    );
    values.insert(
        format!("story:{story_id}:storyFormatVersion"),
        fingerprint(&story.story_format_version),
    );
    values.insert(
        format!("story:{story_id}:tagColors"),
        fingerprint(&story.tag_colors),
    );
    values.insert(format!("story:{story_id}:tags"), fingerprint(&story.tags));
    values.insert(format!("story:{story_id}:zoom"), fingerprint(&story.zoom));
    values.insert(
        format!("story:{story_id}:script"),
        fingerprint(&story.script),
    );
    values.insert(
        format!("story:{story_id}:stylesheet"),
        fingerprint(&story.stylesheet),
    );

    if include_passages {
        for passage in story.passages.iter() {
            insert_passage_fingerprints(values, story_id, passage);
        }
    }
}

fn insert_passage_fingerprints(
    values: &mut BTreeMap<String, u64>,
    story_id: &str,
    passage: &Passage,
) {
    let passage_id = passage.id.as_ref();
    let prefix = format!("passage:{story_id}:{passage_id}");

    values.insert(format!("{prefix}:exists"), fingerprint(&true));
    values.insert(format!("{prefix}:layout"), fingerprint(&passage.layout));
    values.insert(format!("{prefix}:name"), fingerprint(&passage.name));
    values.insert(format!("{prefix}:tags"), fingerprint(&passage.tags));
    values.insert(format!("{prefix}:text"), fingerprint(&passage.text));
}

fn normalized_asset_inventory(
    inventory: Vec<CoreAssetInventoryEntry>,
) -> Vec<CoreAssetInventoryEntry> {
    let by_path = inventory
        .into_iter()
        .map(|asset| (asset.normalized_path.clone(), asset))
        .collect::<BTreeMap<_, _>>();
    let mut inventory = by_path.into_values().collect::<Vec<_>>();

    inventory.sort_by(|left, right| left.path.cmp(&right.path));
    inventory
}

fn field_matches_pattern(field: &str, pattern: &str) -> bool {
    pattern
        .strip_suffix('*')
        .map_or(field == pattern, |prefix| field.starts_with(prefix))
}

fn external_change_field_patterns(change: &CoreExternalChange) -> Vec<String> {
    match change {
        CoreExternalChange::DeleteAsset { path } => vec![format!("asset:{path}")],
        CoreExternalChange::DeletePassage {
            passage_id,
            story_id,
        }
        | CoreExternalChange::UpsertPassage {
            passage: PassageSnapshot { id: passage_id, .. },
            story_id,
        } => vec![format!("passage:{story_id}:{passage_id}:*")],
        CoreExternalChange::DeleteStory { story_id } => vec![
            format!("story:{story_id}:*"),
            format!("passage:{story_id}:*"),
        ],
        CoreExternalChange::UpsertAsset { asset } => {
            vec![format!("asset:{}", asset.normalized_path)]
        }
        CoreExternalChange::UpsertStory { story } => vec![
            format!("story:{}:*", story.id),
            format!("passage:{}:*", story.id),
        ],
        CoreExternalChange::UpdatePassage {
            changes,
            passage_id,
            story_id,
        } => {
            let prefix = format!("passage:{story_id}:{passage_id}");
            let mut fields = Vec::new();

            if changes.layout.is_some() {
                fields.push(format!("{prefix}:layout"));
            }
            if changes.name.is_some() {
                fields.push(format!("{prefix}:name"));
            }
            if changes.tags.is_some() {
                fields.push(format!("{prefix}:tags"));
            }
            if changes.text.is_some() {
                fields.push(format!("{prefix}:text"));
            }
            fields
        }
        CoreExternalChange::UpdatePassageLayout {
            passage_id,
            story_id,
            ..
        } => vec![format!("passage:{story_id}:{passage_id}:layout")],
        CoreExternalChange::UpdateProjectLayout { .. } => vec!["project:layout".into()],
        CoreExternalChange::UpdateStoryMetadata { changes, story_id } => {
            let prefix = format!("story:{story_id}");
            let mut fields = Vec::new();

            if changes.ifid.is_some() {
                fields.push(format!("{prefix}:ifid"));
            }
            if changes.name.is_some() {
                fields.push(format!("{prefix}:name"));
            }
            if changes.snap_to_grid.is_some() {
                fields.push(format!("{prefix}:snapToGrid"));
            }
            if changes.story_format.is_some() {
                fields.push(format!("{prefix}:storyFormat"));
            }
            if changes.story_format_version.is_some() {
                fields.push(format!("{prefix}:storyFormatVersion"));
            }
            if changes.tag_colors.is_some() {
                fields.push(format!("{prefix}:tagColors"));
            }
            if changes.tags.is_some() {
                fields.push(format!("{prefix}:tags"));
            }
            if changes.zoom.is_some() {
                fields.push(format!("{prefix}:zoom"));
            }
            fields
        }
        CoreExternalChange::UpdateStoryScript { story_id, .. } => {
            vec![format!("story:{story_id}:script")]
        }
        CoreExternalChange::UpdateStoryStartPassage { story_id, .. } => {
            vec![format!("story:{story_id}:startPassage")]
        }
        CoreExternalChange::UpdateStoryStylesheet { story_id, .. } => {
            vec![format!("story:{story_id}:stylesheet")]
        }
    }
}

fn external_change_identity(change: &CoreExternalChange) -> (Option<String>, Option<String>) {
    match change {
        CoreExternalChange::DeletePassage {
            passage_id,
            story_id,
        }
        | CoreExternalChange::UpdatePassage {
            passage_id,
            story_id,
            ..
        } => (Some(story_id.clone()), Some(passage_id.clone())),
        CoreExternalChange::UpdatePassageLayout {
            passage_id,
            story_id,
            ..
        } => (Some(story_id.clone()), Some(passage_id.clone())),
        CoreExternalChange::UpsertPassage { passage, story_id } => {
            (Some(story_id.clone()), Some(passage.id.clone()))
        }
        CoreExternalChange::DeleteStory { story_id }
        | CoreExternalChange::UpdateStoryMetadata { story_id, .. }
        | CoreExternalChange::UpdateStoryStartPassage { story_id, .. }
        | CoreExternalChange::UpdateStoryScript { story_id, .. }
        | CoreExternalChange::UpdateStoryStylesheet { story_id, .. } => {
            (Some(story_id.clone()), None)
        }
        CoreExternalChange::UpsertStory { story } => (Some(story.id.clone()), None),
        CoreExternalChange::DeleteAsset { .. } | CoreExternalChange::UpsertAsset { .. } => {
            (None, None)
        }
        CoreExternalChange::UpdateProjectLayout { .. } => (None, None),
    }
}

fn compact_external_delta_supported(changes: &[CoreExternalChange]) -> bool {
    changes.iter().all(|change| {
        matches!(
            change,
            CoreExternalChange::UpdatePassage { .. }
                | CoreExternalChange::UpdatePassageLayout { .. }
                | CoreExternalChange::UpdateProjectLayout { .. }
                | CoreExternalChange::UpdateStoryMetadata { .. }
                | CoreExternalChange::UpdateStoryScript { .. }
                | CoreExternalChange::UpdateStoryStartPassage { .. }
                | CoreExternalChange::UpdateStoryStylesheet { .. }
        )
    })
}

#[derive(Default)]
struct CompactExternalPlan {
    candidate_fingerprints: BTreeMap<String, u64>,
    project_layouts: BTreeMap<usize, GraphLayout>,
}

#[cfg(test)]
fn diagnostic_identity(diagnostic: &CoreDiagnostic) -> String {
    DIAGNOSTIC_IDENTITY_SERIALIZATIONS.with(|count| count.set(count.get() + 1));

    serde_json::to_string(&(
        &diagnostic.code,
        &diagnostic.source_id,
        &diagnostic.passage_id,
        diagnostic.start,
        diagnostic.end,
        &diagnostic.message,
    ))
    .expect("diagnostic identities contain only JSON-safe fields")
}

#[derive(Debug, Deserialize)]
struct ParsedDiagnosticIdentity(String, String, Option<String>, usize, usize, String);

impl ParsedDiagnosticIdentity {
    fn hash(&self) -> u64 {
        diagnostic_identity_hash(&self.0, &self.1, self.2.as_deref(), self.3, self.4, &self.5)
    }

    fn matches(&self, diagnostic: &CoreDiagnostic) -> bool {
        self.0 == diagnostic.code
            && self.1 == diagnostic.source_id
            && self.2.as_deref() == diagnostic.passage_id.as_deref()
            && self.3 == diagnostic.start
            && self.4 == diagnostic.end
            && self.5 == diagnostic.message
    }
}

fn diagnostic_identity_hash(
    code: &str,
    source_id: &str,
    passage_id: Option<&str>,
    start: usize,
    end: usize,
    message: &str,
) -> u64 {
    let mut hasher = DefaultHasher::new();

    code.hash(&mut hasher);
    source_id.hash(&mut hasher);
    passage_id.hash(&mut hasher);
    start.hash(&mut hasher);
    end.hash(&mut hasher);
    message.hash(&mut hasher);
    hasher.finish()
}

fn parsed_diagnostic_identities(
    dismissed_ids: Vec<String>,
) -> BTreeMap<u64, Vec<ParsedDiagnosticIdentity>> {
    let mut parsed = BTreeMap::<u64, Vec<ParsedDiagnosticIdentity>>::new();

    for dismissed_id in dismissed_ids {
        if let Ok(identity) = serde_json::from_str::<ParsedDiagnosticIdentity>(&dismissed_id) {
            parsed.entry(identity.hash()).or_default().push(identity);
        }
    }

    parsed
}

fn diagnostic_is_dismissed(
    diagnostic: &CoreDiagnostic,
    dismissed_identities: &BTreeMap<u64, Vec<ParsedDiagnosticIdentity>>,
) -> bool {
    if dismissed_identities.is_empty() {
        return false;
    }

    let hash = diagnostic_identity_hash(
        &diagnostic.code,
        &diagnostic.source_id,
        diagnostic.passage_id.as_deref(),
        diagnostic.start,
        diagnostic.end,
        &diagnostic.message,
    );

    dismissed_identities.get(&hash).is_some_and(|identities| {
        identities
            .iter()
            .any(|identity| identity.matches(diagnostic))
    })
}

#[derive(Clone, Debug)]
pub struct ProjectSession {
    analysis_cache: BTreeMap<StoryId, BTreeMap<String, SourceAnalysisCache>>,
    analysis_parse_count: usize,
    applied_external_delta_ids: VecDeque<String>,
    asset_inventory: Vec<CoreAssetInventoryEntry>,
    asset_root: Option<PathBuf>,
    backlink_cache: BTreeMap<StoryId, BTreeMap<PassageId, BacklinkCacheEntry>>,
    backlink_cache_lru: VecDeque<(StoryId, PassageId)>,
    backlink_cache_hit_count: usize,
    backlink_scan_count: usize,
    backlink_scanned_source_count: usize,
    contents_catalog_cache: BTreeMap<StoryId, StoryContentsCatalog>,
    current_fingerprints: BTreeMap<String, u64>,
    read_model_cache: BTreeMap<StoryId, StoryReadModelCache>,
    read_model_full_build_count: usize,
    read_model_incremental_update_count: usize,
    read_model_last_touched_source_count: usize,
    dirty: bool,
    dirty_fields: BTreeSet<String>,
    graph_cache: BTreeMap<StoryId, GraphSessionCache>,
    history_bytes: usize,
    last_mutation_stage_timings: Option<CoreMutationStageTimings>,
    current_state_id: u64,
    next_transaction_id: u64,
    project: Project,
    refactor_plans: refactor::RefactorPlanStore,
    refactor_planning_tasks: refactor::RefactorPlanningTaskStore,
    redo_stack: Vec<Transaction>,
    saved_fingerprints: BTreeMap<String, u64>,
    saved_state_id: u64,
    undo_stack: Vec<Transaction>,
    #[cfg(test)]
    refactor_failure_injection: Option<RefactorFailureInjection>,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RefactorFailureInjection {
    Child(usize),
    Derived(DerivedRefactorFailureStage),
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DerivedRefactorFailureStage {
    PassageNameIndex,
    Fingerprints,
    GraphCache,
    BacklinkCache,
    ContentsCatalog,
    AnalysisCache,
    ReadModelCache,
}

impl ProjectSession {
    pub fn new(mut project: Project) -> Self {
        project.layout.passages.migrate_legacy(&project.stories);
        // PassageLayouts always serializes with the story-scoped schema, even
        // before the first passage receives saved coordinates.
        project.manifest.schema_version =
            project.manifest.schema_version.max(PROJECT_SCHEMA_VERSION);
        let saved_fingerprints = project_fingerprints(&project);
        let refactor_plans = refactor::RefactorPlanStore::for_project(&project);

        Self {
            analysis_cache: BTreeMap::new(),
            analysis_parse_count: 0,
            applied_external_delta_ids: VecDeque::new(),
            asset_inventory: Vec::new(),
            asset_root: None,
            backlink_cache: BTreeMap::new(),
            backlink_cache_lru: VecDeque::new(),
            backlink_cache_hit_count: 0,
            backlink_scan_count: 0,
            backlink_scanned_source_count: 0,
            contents_catalog_cache: BTreeMap::new(),
            current_fingerprints: saved_fingerprints.clone(),
            read_model_cache: BTreeMap::new(),
            read_model_full_build_count: 0,
            read_model_incremental_update_count: 0,
            read_model_last_touched_source_count: 0,
            dirty: false,
            dirty_fields: BTreeSet::new(),
            graph_cache: BTreeMap::new(),
            history_bytes: 0,
            last_mutation_stage_timings: None,
            current_state_id: 0,
            next_transaction_id: 1,
            project,
            refactor_plans,
            refactor_planning_tasks: refactor::RefactorPlanningTaskStore::default(),
            redo_stack: Vec::new(),
            saved_fingerprints,
            saved_state_id: 0,
            undo_stack: Vec::new(),
            #[cfg(test)]
            refactor_failure_injection: None,
        }
    }

    pub fn new_at_revision(project: Project, next_transaction_id: u64) -> Self {
        let mut session = Self::new(project);

        session.set_revision(next_transaction_id);
        session
    }

    pub fn with_project_root(project: Project, project_root: impl Into<PathBuf>) -> Self {
        let mut session = Self::new(project);

        session.set_project_root(project_root);
        session
    }

    pub fn set_project_root(&mut self, project_root: impl Into<PathBuf>) {
        self.asset_root = Some(project_root.into().join("assets"));
    }

    pub fn set_asset_inventory(&mut self, inventory: Vec<CoreAssetInventoryEntry>) {
        self.asset_inventory = normalized_asset_inventory(inventory);
        self.read_model_cache.clear();
    }

    pub fn asset_inventory(&self) -> &[CoreAssetInventoryEntry] {
        &self.asset_inventory
    }

    pub(crate) fn plan_refactor(
        &mut self,
        draft: CanonicalPlanDraft,
    ) -> Result<RefactorPlanSummary, RefactorPlanFailure> {
        let current_revision = self.refactor_revision()?;
        if draft.preconditions.project_revision != current_revision {
            return Err(RefactorPlanFailure {
                code: RefactorPlanFailureCode::StaleProjectRevision,
                message: "Planning runtime state does not match the project revision.".into(),
            });
        }
        self.refactor_plans
            .insert(draft, &self.project, refactor::RefactorPlanClock::now())
    }

    pub fn begin_passage_rename_plan(
        &mut self,
        request: PlanPassageRenameRequest,
        runtime: RefactorRuntimeState,
    ) -> Result<RefactorPlanningTaskHandle, RefactorPlanFailure> {
        if refactor::passage_rename_request_string_bytes(&request)
            > refactor::MAX_PASSAGE_RENAME_REQUEST_STRING_BYTES_V1
        {
            return Err(RefactorPlanFailure {
                code: RefactorPlanFailureCode::PlanTooLarge,
                message: "Passage rename request strings exceed the 64 KiB limit.".into(),
            });
        }
        let current_revision = self.refactor_revision()?;
        if runtime.project_revision != current_revision {
            return Err(RefactorPlanFailure {
                code: RefactorPlanFailureCode::StaleProjectRevision,
                message: "Planning runtime state does not match the project revision.".into(),
            });
        }
        self.refactor_planning_tasks
            .begin(request, runtime, &self.project)
    }

    pub fn continue_passage_rename_plan(
        &mut self,
        task: &RefactorPlanningTaskHandle,
    ) -> PlanPassageRenameResult {
        let current_revision = match self.refactor_revision() {
            Ok(revision) => revision,
            Err(failure) => return PlanPassageRenameResult::Failure { failure },
        };
        self.refactor_planning_tasks.continue_task(
            &task.task_id,
            current_revision,
            &self.project,
            &mut self.refactor_plans,
            refactor::RefactorPlanClock::now(),
        )
    }

    pub fn cancel_passage_rename_plan(&mut self, task: &RefactorPlanningTaskHandle) -> bool {
        self.refactor_planning_tasks.cancel(&task.task_id)
    }

    pub fn refactor_plan_detail_page(
        &mut self,
        cursor: &RefactorPlanCursor,
    ) -> Result<RefactorPlanDetailPage, RefactorPlanFailure> {
        self.refactor_plans
            .detail_page(cursor, refactor::RefactorPlanClock::now())
    }

    pub fn apply_refactor_plan(
        &mut self,
        request: &RefactorPlanApplyRequest,
        runtime: &RefactorRuntimeState,
    ) -> Result<PatchBatch, RefactorPlanFailure> {
        self.apply_refactor_plan_with_receipt(request, runtime)
            .map(|(batch, _)| batch)
    }

    pub fn apply_refactor_plan_with_receipt(
        &mut self,
        request: &RefactorPlanApplyRequest,
        runtime: &RefactorRuntimeState,
    ) -> Result<(PatchBatch, RefactorApplyReceipt), RefactorPlanFailure> {
        let current_revision = self.refactor_revision()?;
        if runtime.project_revision != current_revision {
            return Err(RefactorPlanFailure {
                code: RefactorPlanFailureCode::StaleProjectRevision,
                message: "Apply runtime state does not match the project revision.".into(),
            });
        }
        let prepared = self.refactor_plans.prepare_apply(
            request,
            runtime,
            refactor::RefactorPlanClock::now(),
        )?;
        #[cfg(test)]
        let failure_injection = self.refactor_failure_injection.take();
        #[cfg(test)]
        let injected_child = match failure_injection {
            Some(RefactorFailureInjection::Child(index)) => Some(index),
            _ => None,
        };
        #[cfg(test)]
        let injected_derived = match failure_injection {
            Some(RefactorFailureInjection::Derived(stage)) => Some(stage),
            _ => None,
        };
        #[cfg(not(test))]
        let injected_child: Option<usize> = None;
        #[cfg(test)]
        let mut rollback_session = injected_derived.is_some().then(|| self.clone());
        let before = std::mem::take(&mut self.project);
        let receipt =
            match refactor::apply_receipt_for_changes(&before, &prepared.changes, current_revision)
            {
                Ok(receipt) => receipt,
                Err(error) => {
                    self.project = before;
                    return Err(error);
                }
            };
        let sparse_refactor_delta = match refactor::sparse_passage_rename_delta(
            &before,
            &prepared.operation_kind,
            &prepared.changes,
            injected_child,
        ) {
            Ok(delta) => delta,
            Err(error) => {
                self.project = before;
                return Err(error);
            }
        };
        let (candidate, delta) = if let Some(sparse_refactor_delta) = sparse_refactor_delta {
            let mut candidate = before;
            let story_id = StoryId::new(&sparse_refactor_delta[0].story_id);
            let story_index = candidate
                .stories
                .iter()
                .position(|story| story.id == story_id)
                .expect("validated sparse refactor story");
            let shell = story_shell_without_passages(&candidate.stories[story_index]);
            let passage_deltas = sparse_refactor_delta
                .iter()
                .map(|change| PassageDelta {
                    after: Some(IndexedPassage {
                        index: change.index,
                        value: change.after.clone(),
                    }),
                    before: Some(IndexedPassage {
                        index: change.index,
                        value: change.before.clone(),
                    }),
                    passage_id: change.passage_id.clone(),
                })
                .collect();
            let story = &mut candidate.stories[story_index];
            for change in &sparse_refactor_delta {
                story
                    .passage_by_id_mut(&change.passage_id)
                    .expect("validated sparse refactor passage")
                    .clone_from(&change.after);
            }
            #[cfg(test)]
            self.fail_refactor_derived_stage(
                injected_derived,
                &mut rollback_session,
                DerivedRefactorFailureStage::PassageNameIndex,
            )?;
            story.passages.rebuild_name_index();
            (
                candidate,
                ProjectDelta {
                    stories: vec![StoryDelta::Update {
                        after: shell.clone(),
                        before: shell,
                        passages: passage_deltas,
                        story_id,
                    }],
                    ..ProjectDelta::default()
                },
            )
        } else {
            let candidate = match refactor::apply_canonical_changes_with_injected_child(
                &before,
                &prepared.changes,
                injected_child,
            ) {
                Ok(candidate) => candidate,
                Err(error) => {
                    self.project = before;
                    return Err(error);
                }
            };
            let delta = ProjectDelta::between(&before, &candidate);
            (candidate, delta)
        };

        let transaction_id = self.next_transaction_id;
        let before_state_id = self.current_state_id;
        let dirty_before = self.dirty;
        let label = format!("Refactor {}", prepared.operation_kind);
        let mut patches = delta.patches(true);

        self.project = candidate;
        self.next_transaction_id += 1;
        self.current_state_id = transaction_id;
        #[cfg(test)]
        self.fail_refactor_derived_stage(
            injected_derived,
            &mut rollback_session,
            DerivedRefactorFailureStage::Fingerprints,
        )?;
        self.sync_fingerprints(&delta);
        push_dirty_patch(&mut patches, dirty_before, self.dirty);
        #[cfg(test)]
        self.fail_refactor_derived_stage(
            injected_derived,
            &mut rollback_session,
            DerivedRefactorFailureStage::GraphCache,
        )?;
        self.update_graph_cache(&delta);
        #[cfg(test)]
        self.fail_refactor_derived_stage(
            injected_derived,
            &mut rollback_session,
            DerivedRefactorFailureStage::BacklinkCache,
        )?;
        self.update_backlink_cache(&delta);
        #[cfg(test)]
        self.fail_refactor_derived_stage(
            injected_derived,
            &mut rollback_session,
            DerivedRefactorFailureStage::ContentsCatalog,
        )?;
        self.update_contents_catalog_cache(&delta);
        #[cfg(test)]
        self.fail_refactor_derived_stage(
            injected_derived,
            &mut rollback_session,
            DerivedRefactorFailureStage::AnalysisCache,
        )?;
        self.update_analysis_cache(&delta);
        #[cfg(test)]
        self.fail_refactor_derived_stage(
            injected_derived,
            &mut rollback_session,
            DerivedRefactorFailureStage::ReadModelCache,
        )?;
        self.update_read_model_cache(&delta);
        self.clear_redo();
        self.push_undo(Transaction {
            after_state_id: self.current_state_id,
            assets: Vec::new(),
            before_state_id,
            byte_size: 0,
            delta,
            kind: CoreHistoryKind::Refactor,
            label: label.clone(),
        });
        self.refactor_plans.remove(&prepared.plan_id);

        Ok((
            PatchBatch {
                label,
                patches,
                transaction_id,
            },
            receipt,
        ))
    }

    fn refactor_revision(&self) -> Result<u32, RefactorPlanFailure> {
        u32::try_from(self.revision()).map_err(|_| RefactorPlanFailure {
            code: RefactorPlanFailureCode::StaleProjectRevision,
            message: "Project revision exceeds the v1 refactor protocol range.".into(),
        })
    }

    #[cfg(test)]
    fn inject_refactor_failure(&mut self, failure: RefactorFailureInjection) {
        self.refactor_failure_injection = Some(failure);
    }

    #[cfg(test)]
    fn fail_refactor_derived_stage(
        &mut self,
        injected_stage: Option<DerivedRefactorFailureStage>,
        rollback_session: &mut Option<ProjectSession>,
        stage: DerivedRefactorFailureStage,
    ) -> Result<(), RefactorPlanFailure> {
        if injected_stage == Some(stage) {
            *self = rollback_session
                .take()
                .expect("derived refactor failures capture a rollback session");
            return Err(RefactorPlanFailure {
                code: RefactorPlanFailureCode::InvalidPlan,
                message: format!("Injected refactor derived-stage failure: {stage:?}."),
            });
        }

        Ok(())
    }

    pub fn apply(&mut self, command: StoryCommand) -> Result<PatchBatch, CoreError> {
        self.apply_with_history(command, true)
    }

    pub fn apply_with_history(
        &mut self,
        command: StoryCommand,
        record_history: bool,
    ) -> Result<PatchBatch, CoreError> {
        if let StoryCommand::UpdatePassageText {
            passage_id,
            story_id,
            text,
        } = command
        {
            return self.apply_passage_text_incremental(
                &story_id,
                &passage_id,
                text,
                record_history,
            );
        }
        if let StoryCommand::UpdatePassage {
            ref changes,
            ref passage_id,
            ref story_id,
            update_references,
        } = command
        {
            // A rename that rewrites references can touch arbitrary sources and
            // still uses the compatibility transaction below. Ordinary passage
            // field edits have one entity delta and never need a project clone.
            if changes.name.is_none() || !update_references {
                return self.apply_passage_patch_incremental(
                    story_id,
                    passage_id,
                    changes.clone(),
                    record_history,
                    "Update Passage",
                    CoreHistoryKind::EditPassage,
                );
            }
        }
        if let StoryCommand::SetPassageTags {
            ref passage_id,
            ref story_id,
            ref tags,
        } = command
        {
            return self.apply_passage_patch_incremental(
                story_id,
                passage_id,
                PassagePatch {
                    tags: Some(tags.clone()),
                    ..PassagePatch::default()
                },
                record_history,
                "Set Passage Tags",
                CoreHistoryKind::StoryDetails,
            );
        }
        if let StoryCommand::SetStartPassage {
            ref passage_id,
            ref story_id,
        } = command
        {
            return self.apply_start_passage_incremental(story_id, passage_id, record_history);
        }
        if let StoryCommand::MovePassages {
            ref moves,
            ref story_id,
        } = command
        {
            return self.apply_move_passages_incremental(story_id, moves, record_history);
        }
        if let StoryCommand::UpdateStoryScript {
            ref script,
            ref story_id,
        } = command
        {
            return self.apply_story_source_incremental(story_id, script, true, record_history);
        }
        if let StoryCommand::UpdateStoryStylesheet {
            ref story_id,
            ref stylesheet,
        } = command
        {
            return self.apply_story_source_incremental(
                story_id,
                stylesheet,
                false,
                record_history,
            );
        }
        if let Some(story_id) = match &command {
            StoryCommand::RenameStory { story_id, .. }
            | StoryCommand::SetStoryFormat { story_id, .. }
            | StoryCommand::SetStorySnapToGrid { story_id, .. }
            | StoryCommand::SetStoryTagColor { story_id, .. }
            | StoryCommand::SetStoryTags { story_id, .. }
            | StoryCommand::SetStoryZoom { story_id, .. } => Some(story_id.clone()),
            _ => None,
        } {
            return self.apply_story_metadata_incremental(command, &story_id, record_history);
        }

        let before = self.project.clone();
        let asset_before = self.asset_inventory.clone();
        let dirty_before = self.dirty;
        let redo_before = self.redo_stack.clone();
        let undo_before = self.undo_stack.clone();
        let transaction_id = self.next_transaction_id;
        let mut patches = match self.apply_without_transaction(command.clone()) {
            Ok(patches) => patches,
            Err(error) => {
                self.project = before;
                self.asset_inventory = asset_before;
                self.dirty = dirty_before;
                self.redo_stack = redo_before;
                self.undo_stack = undo_before;
                return Err(error);
            }
        };

        let project_changed = command.mutates_project()
            && (self.project != before
                || self.asset_inventory != asset_before
                || command.has_external_effect());

        if project_changed {
            self.next_transaction_id += 1;
            let before_state_id = self.current_state_id;
            self.current_state_id = transaction_id;
            let delta = ProjectDelta::between(&before, &self.project);
            self.sync_fingerprints(&delta);
            push_dirty_patch(&mut patches, dirty_before, self.dirty);

            self.update_session_caches(&delta);
            self.clear_redo();
            if record_history {
                self.push_undo(Transaction {
                    after_state_id: self.current_state_id,
                    assets: asset_inventory_delta(&asset_before, &self.asset_inventory),
                    before_state_id,
                    byte_size: 0,
                    delta,
                    kind: command.history_kind(),
                    label: command.label().into(),
                });
            }
        }

        Ok(PatchBatch {
            label: command.label().into(),
            patches,
            transaction_id,
        })
    }

    fn apply_passage_text_incremental(
        &mut self,
        story_id: &str,
        passage_id: &str,
        text: String,
        record_history: bool,
    ) -> Result<PatchBatch, CoreError> {
        self.last_mutation_stage_timings = None;
        let total_started = Instant::now();
        let transaction_id = self.next_transaction_id;
        let story_id = StoryId::new(story_id);
        let passage_id = PassageId::new(passage_id);
        let mut timings = CoreMutationStageTimings {
            operation: "localPassageText".into(),
            ..CoreMutationStageTimings::default()
        };
        let (
            before,
            before_index,
            before_shell,
            newly_linked_names,
            orphaned_passages,
            linked_layouts,
        ) = {
            let story = self.story(story_id.as_ref())?;
            let before_index = story
                .passages
                .rank_of(&passage_id)
                .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;
            let before = story
                .passage_by_id(&passage_id)
                .expect("passage index should resolve")
                .clone();

            if before.text == text {
                return Ok(PatchBatch {
                    label: "Update Passage Text".into(),
                    patches: Vec::new(),
                    transaction_id,
                });
            }

            let old_links = standard_link_names(&before.text);
            let new_links = standard_link_names(&text);
            let old_link_names = old_links.iter().cloned().collect::<BTreeSet<_>>();
            let new_link_names = new_links.iter().cloned().collect::<BTreeSet<_>>();
            let orphaned_passages = old_links
                .iter()
                .filter(|name| !new_link_names.contains(*name))
                .filter_map(|name| story.passage_by_name(name))
                .filter(|candidate| {
                    candidate.id != story.start_passage
                        && passage_is_untouched(candidate)
                        && !story.passages.iter().any(|source| {
                            source.id != passage_id
                                && standard_link_names(&source.text)
                                    .iter()
                                    .any(|target| target == &candidate.name)
                        })
                })
                .filter_map(|candidate| {
                    story
                        .passages
                        .rank_of(&candidate.id)
                        .map(|index| (index, candidate.clone()))
                })
                .collect::<Vec<_>>();
            let orphaned_ids = orphaned_passages
                .iter()
                .map(|(_, passage)| passage.id.clone())
                .collect::<BTreeSet<_>>();
            let newly_linked_names = new_links
                .into_iter()
                .filter(|name| !old_link_names.contains(name))
                .filter(|name| story.passages.id_for_name(name).is_none())
                .collect::<Vec<_>>();
            let linked_layouts =
                linked_passage_layouts(story, &before, newly_linked_names.len(), &orphaned_ids);

            (
                before,
                before_index,
                story_shell_without_passages(story),
                newly_linked_names,
                orphaned_passages,
                linked_layouts,
            )
        };
        let orphaned_ids = orphaned_passages
            .iter()
            .map(|(_, passage)| passage.id.clone())
            .collect::<BTreeSet<_>>();
        timings.lookup_and_delta_ms = elapsed_ms(total_started);
        let stage_started = Instant::now();
        let (after_shell, passage_deltas) = {
            let story = self.story_mut(story_id.as_ref())?;

            if !orphaned_ids.is_empty() {
                story.passages = story
                    .passages
                    .iter()
                    .filter(|passage| !orphaned_ids.contains(&passage.id))
                    .cloned()
                    .collect();
            }
            let source = story
                .passage_by_id_mut(&passage_id)
                .expect("passage index should resolve after orphan cleanup");
            source.text = text;
            let after = source.clone();
            let after_index = story
                .passages
                .rank_of(&passage_id)
                .expect("updated passage should remain indexed");
            let mut passage_deltas = vec![PassageDelta {
                after: Some(IndexedPassage {
                    index: after_index,
                    value: after,
                }),
                before: Some(IndexedPassage {
                    index: before_index,
                    value: before,
                }),
                passage_id: passage_id.clone(),
            }];

            passage_deltas.extend(orphaned_passages.into_iter().map(|(index, passage)| {
                PassageDelta {
                    after: None,
                    before: Some(IndexedPassage {
                        index,
                        value: passage.clone(),
                    }),
                    passage_id: passage.id,
                }
            }));

            for (name, layout) in newly_linked_names.into_iter().zip(linked_layouts) {
                let id = PassageId::new(next_passage_id(story));
                let passage = Passage {
                    custom_attributes: BTreeMap::new(),
                    id: id.clone(),
                    layout: Some(layout),
                    metadata: BTreeMap::new(),
                    name,
                    source_pid: None,
                    story: story.id.clone(),
                    tags: Vec::new(),
                    text: String::new(),
                };

                story.passages.insert(passage.clone());
                passage_deltas.push(PassageDelta {
                    after: Some(IndexedPassage {
                        index: story.passages.len() - 1,
                        value: passage,
                    }),
                    before: None,
                    passage_id: id,
                });
            }

            (story_shell_without_passages(story), passage_deltas)
        };
        timings.project_mutation_ms = elapsed_ms(stage_started);
        let stage_started = Instant::now();
        let delta = ProjectDelta {
            stories: vec![StoryDelta::Update {
                after: after_shell,
                before: before_shell,
                passages: passage_deltas,
                story_id: story_id.clone(),
            }],
            ..ProjectDelta::default()
        };
        timings.lookup_and_delta_ms += elapsed_ms(stage_started);
        let dirty_before = self.dirty;
        let before_state_id = self.current_state_id;

        self.next_transaction_id += 1;
        self.current_state_id = transaction_id;

        let stage_started = Instant::now();
        self.sync_fingerprints(&delta);
        timings.fingerprint_ms = elapsed_ms(stage_started);

        let stage_started = Instant::now();
        self.update_graph_cache(&delta);
        self.update_backlink_cache(&delta);
        timings.graph_ms = elapsed_ms(stage_started);
        if let Some(graph) = self.graph_cache.get(&story_id).map(|cache| &cache.graph) {
            timings.graph_parsed_source_count = graph.last_incremental_parse_count();
            timings.topology_changed = graph.last_topology_changed();
        }

        let stage_started = Instant::now();
        self.update_contents_catalog_cache(&delta);
        self.update_analysis_cache(&delta);
        timings.analysis_ms = elapsed_ms(stage_started);

        let stage_started = Instant::now();
        self.update_read_model_cache(&delta);
        timings.read_model_ms = elapsed_ms(stage_started);

        let stage_started = Instant::now();
        self.clear_redo();
        timings.history_ms = elapsed_ms(stage_started);

        let stage_started = Instant::now();
        let mut patches = delta.patches(true);
        timings.patch_finalize_ms = elapsed_ms(stage_started);
        if record_history {
            let stage_started = Instant::now();
            self.push_undo(Transaction {
                after_state_id: self.current_state_id,
                assets: Vec::new(),
                before_state_id,
                byte_size: 0,
                delta,
                kind: CoreHistoryKind::EditPassage,
                label: "Update Passage Text".into(),
            });
            timings.history_ms += elapsed_ms(stage_started);
        }

        let stage_started = Instant::now();
        push_dirty_patch(&mut patches, dirty_before, self.dirty);
        timings.patch_finalize_ms += elapsed_ms(stage_started);
        let result = PatchBatch {
            label: "Update Passage Text".into(),
            patches,
            transaction_id,
        };
        timings.revision = self.revision();
        timings.total_ms = elapsed_ms(total_started);
        self.last_mutation_stage_timings = Some(timings);

        Ok(result)
    }

    fn apply_passage_patch_incremental(
        &mut self,
        story_id: &str,
        passage_id: &str,
        changes: PassagePatch,
        record_history: bool,
        label: &str,
        kind: CoreHistoryKind,
    ) -> Result<PatchBatch, CoreError> {
        if changes.name.is_some() {
            // `update_references: false` from the caller is represented by the
            // direct field patch below. A referenced rename stays on the broad
            // compatibility path in `apply_with_history`.
        }
        let transaction_id = self.next_transaction_id;
        let story_id = StoryId::new(story_id);
        let passage_id = PassageId::new(passage_id);
        let (passage_index, before, story_shell) = {
            let story = self.story(story_id.as_ref())?;
            let passage_index = story
                .passages
                .iter()
                .position(|passage| passage.id == passage_id)
                .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;
            let before = story
                .passage_by_id(&passage_id)
                .expect("passage index should resolve")
                .clone();

            (passage_index, before, story_shell_without_passages(story))
        };
        let mut applied = PassagePatch::default();
        let after = {
            let passage = self
                .story_mut(story_id.as_ref())?
                .passage_by_id_mut(&passage_id)
                .expect("passage index should resolve");

            if let Some(name) = changes.name
                && passage.name != name
            {
                passage.name = name.clone();
                applied.name = Some(name);
            }
            if let Some(text) = changes.text
                && passage.text != text
            {
                passage.text = text.clone();
                applied.text = Some(text);
            }
            if let Some(tags) = changes.tags
                && passage.tags != tags
            {
                passage.tags = tags.clone();
                applied.tags = Some(tags);
            }
            if let Some(layout) = changes.layout
                && passage.layout.map(CoreRect::from) != Some(layout)
            {
                passage.layout = Some(GraphPosition::from(layout));
                applied.layout = Some(layout);
            }
            passage.clone()
        };

        if passage_patch_is_empty(&applied) {
            return Ok(PatchBatch {
                label: label.into(),
                patches: Vec::new(),
                transaction_id,
            });
        }

        let delta = ProjectDelta {
            stories: vec![StoryDelta::Update {
                after: story_shell.clone(),
                before: story_shell,
                passages: vec![PassageDelta {
                    after: Some(IndexedPassage {
                        index: passage_index,
                        value: after,
                    }),
                    before: Some(IndexedPassage {
                        index: passage_index,
                        value: before,
                    }),
                    passage_id: passage_id.clone(),
                }],
                story_id: story_id.clone(),
            }],
            ..ProjectDelta::default()
        };
        let dirty_before = self.dirty;
        let before_state_id = self.current_state_id;

        self.next_transaction_id += 1;
        self.current_state_id = transaction_id;
        self.sync_fingerprints(&delta);
        self.update_session_caches(&delta);
        self.clear_redo();
        if record_history {
            self.push_undo(Transaction {
                after_state_id: self.current_state_id,
                assets: Vec::new(),
                before_state_id,
                byte_size: 0,
                delta,
                kind,
                label: label.into(),
            });
        }

        let mut patches = vec![Patch::PassageUpdated {
            changes: applied,
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.as_ref().to_owned(),
        }];
        push_dirty_patch(&mut patches, dirty_before, self.dirty);
        Ok(PatchBatch {
            label: label.into(),
            patches,
            transaction_id,
        })
    }

    fn apply_start_passage_incremental(
        &mut self,
        story_id: &str,
        passage_id: &str,
        record_history: bool,
    ) -> Result<PatchBatch, CoreError> {
        let transaction_id = self.next_transaction_id;
        let story_id = StoryId::new(story_id);
        let passage_id = PassageId::new(passage_id);
        let before = {
            let story = self.story(story_id.as_ref())?;

            if story.passage_by_id(&passage_id).is_none() {
                return Err(CoreError::PassageNotFound(passage_id.as_ref().to_owned()));
            }
            if story.start_passage == passage_id {
                return Ok(PatchBatch {
                    label: "Set Start Passage".into(),
                    patches: Vec::new(),
                    transaction_id,
                });
            }

            story_shell_without_passages(story)
        };
        let after = {
            let story = self.story_mut(story_id.as_ref())?;

            story.start_passage = passage_id.clone();
            story_shell_without_passages(story)
        };
        let delta = ProjectDelta {
            stories: vec![StoryDelta::Update {
                after,
                before,
                passages: Vec::new(),
                story_id: story_id.clone(),
            }],
            ..ProjectDelta::default()
        };
        let dirty_before = self.dirty;
        let before_state_id = self.current_state_id;

        self.next_transaction_id += 1;
        self.current_state_id = transaction_id;
        self.sync_fingerprints(&delta);
        self.update_session_caches(&delta);
        self.clear_redo();
        if record_history {
            self.push_undo(Transaction {
                after_state_id: self.current_state_id,
                assets: Vec::new(),
                before_state_id,
                byte_size: 0,
                delta,
                kind: CoreHistoryKind::SetStartPassage,
                label: "Set Start Passage".into(),
            });
        }

        let mut patches = vec![Patch::StartPassageChanged {
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.as_ref().to_owned(),
        }];
        push_dirty_patch(&mut patches, dirty_before, self.dirty);
        Ok(PatchBatch {
            label: "Set Start Passage".into(),
            patches,
            transaction_id,
        })
    }

    fn apply_move_passages_incremental(
        &mut self,
        story_id: &str,
        moves: &[PassageMove],
        record_history: bool,
    ) -> Result<PatchBatch, CoreError> {
        let transaction_id = self.next_transaction_id;
        let story_id = StoryId::new(story_id);
        let requested = moves
            .iter()
            .map(|passage_move| {
                (
                    PassageId::new(&passage_move.passage_id),
                    GraphPosition::from(passage_move.bounds),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let (story_shell, before_passages) = {
            let story = self.story(story_id.as_ref())?;
            let mut before_passages = Vec::new();

            for (passage_id, bounds) in &requested {
                let index = story
                    .passages
                    .iter()
                    .position(|passage| &passage.id == passage_id)
                    .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;
                let passage = story
                    .passage_by_id(passage_id)
                    .expect("validated passage should resolve");

                if passage.layout != Some(*bounds)
                    || self
                        .project
                        .layout
                        .passages
                        .get(&story_id, passage_id)
                        .map(|layout| layout.bounds)
                        != Some(*bounds)
                {
                    before_passages.push((index, passage.clone()));
                }
            }

            (story_shell_without_passages(story), before_passages)
        };

        if before_passages.is_empty() {
            return Ok(PatchBatch {
                label: "Move Passages".into(),
                patches: Vec::new(),
                transaction_id,
            });
        }

        let mut passage_deltas = Vec::with_capacity(before_passages.len());
        let mut layout_passages = Vec::with_capacity(before_passages.len());
        let mut patches = Vec::with_capacity(before_passages.len() + 1);

        for (index, before) in before_passages {
            let passage_id = before.id.clone();
            let bounds = *requested
                .get(&passage_id)
                .expect("validated move should retain its bounds");
            let layout_before = self
                .project
                .layout
                .passages
                .get(&story_id, &passage_id)
                .cloned();
            let after = {
                let passage = self
                    .story_mut(story_id.as_ref())?
                    .passage_by_id_mut(&passage_id)
                    .expect("validated passage should resolve");

                passage.layout = Some(bounds);
                passage.clone()
            };
            let mut layout_after = layout_before.clone().unwrap_or_default();

            layout_after.bounds = bounds;

            self.project.layout.passages.insert(
                story_id.clone(),
                passage_id.clone(),
                layout_after.clone(),
            );
            passage_deltas.push(PassageDelta {
                after: Some(IndexedPassage {
                    index,
                    value: after,
                }),
                before: Some(IndexedPassage {
                    index,
                    value: before,
                }),
                passage_id: passage_id.clone(),
            });
            layout_passages.push(ProjectLayoutPassageDelta {
                after: Some(layout_after),
                before: layout_before,
                passage_id: passage_id.clone(),
                story_id: story_id.clone(),
            });
            patches.push(Patch::PassageUpdated {
                changes: PassagePatch {
                    layout: Some(bounds.into()),
                    ..PassagePatch::default()
                },
                passage_id: passage_id.as_ref().to_owned(),
                story_id: story_id.as_ref().to_owned(),
            });
        }

        let delta = ProjectDelta {
            layout_passages,
            stories: vec![StoryDelta::Update {
                after: story_shell.clone(),
                before: story_shell,
                passages: passage_deltas,
                story_id: story_id.clone(),
            }],
            ..ProjectDelta::default()
        };
        let dirty_before = self.dirty;
        let before_state_id = self.current_state_id;

        self.next_transaction_id += 1;
        self.current_state_id = transaction_id;
        self.sync_fingerprints(&delta);
        self.update_session_caches(&delta);
        self.clear_redo();
        if record_history {
            self.push_undo(Transaction {
                after_state_id: self.current_state_id,
                assets: Vec::new(),
                before_state_id,
                byte_size: 0,
                delta,
                kind: CoreHistoryKind::MovePassage,
                label: "Move Passages".into(),
            });
        }
        push_dirty_patch(&mut patches, dirty_before, self.dirty);

        Ok(PatchBatch {
            label: "Move Passages".into(),
            patches,
            transaction_id,
        })
    }

    fn apply_story_source_incremental(
        &mut self,
        story_id: &str,
        source: &str,
        script: bool,
        record_history: bool,
    ) -> Result<PatchBatch, CoreError> {
        let transaction_id = self.next_transaction_id;
        let story_id = StoryId::new(story_id);
        let label = if script {
            "Update Story JavaScript"
        } else {
            "Update Story Stylesheet"
        };
        let before = {
            let story = self.story(story_id.as_ref())?;
            let unchanged = if script {
                story.script == source
            } else {
                story.stylesheet == source
            };

            if unchanged {
                return Ok(PatchBatch {
                    label: label.into(),
                    patches: Vec::new(),
                    transaction_id,
                });
            }

            story_shell_without_passages(story)
        };
        let after = {
            let story = self.story_mut(story_id.as_ref())?;

            if script {
                story.script = source.into();
            } else {
                story.stylesheet = source.into();
            }
            story_shell_without_passages(story)
        };
        let delta = ProjectDelta {
            stories: vec![StoryDelta::Update {
                after,
                before,
                passages: Vec::new(),
                story_id: story_id.clone(),
            }],
            ..ProjectDelta::default()
        };
        let dirty_before = self.dirty;
        let before_state_id = self.current_state_id;

        self.next_transaction_id += 1;
        self.current_state_id = transaction_id;
        self.sync_fingerprints(&delta);
        self.update_session_caches(&delta);
        self.clear_redo();
        if record_history {
            self.push_undo(Transaction {
                after_state_id: self.current_state_id,
                assets: Vec::new(),
                before_state_id,
                byte_size: 0,
                delta,
                kind: CoreHistoryKind::EditPassage,
                label: label.into(),
            });
        }

        let mut patches = if script {
            vec![Patch::StoryScriptUpdated {
                script: source.into(),
                story_id: story_id.as_ref().to_owned(),
            }]
        } else {
            vec![Patch::StoryStylesheetUpdated {
                story_id: story_id.as_ref().to_owned(),
                stylesheet: source.into(),
            }]
        };
        push_dirty_patch(&mut patches, dirty_before, self.dirty);
        Ok(PatchBatch {
            label: label.into(),
            patches,
            transaction_id,
        })
    }

    fn apply_story_metadata_incremental(
        &mut self,
        command: StoryCommand,
        story_id: &str,
        record_history: bool,
    ) -> Result<PatchBatch, CoreError> {
        let transaction_id = self.next_transaction_id;
        let story_id = StoryId::new(story_id);
        let before = story_shell_without_passages(self.story(story_id.as_ref())?);
        let dirty_before = self.dirty;
        let mut patches = self.apply_without_transaction(command.clone())?;

        if patches.is_empty() {
            return Ok(PatchBatch {
                label: command.label().into(),
                patches,
                transaction_id,
            });
        }

        let after = story_shell_without_passages(self.story(story_id.as_ref())?);
        let delta = ProjectDelta {
            stories: vec![StoryDelta::Update {
                after,
                before,
                passages: Vec::new(),
                story_id,
            }],
            ..ProjectDelta::default()
        };
        let before_state_id = self.current_state_id;

        self.next_transaction_id += 1;
        self.current_state_id = transaction_id;
        self.sync_fingerprints(&delta);
        self.update_session_caches(&delta);
        self.clear_redo();
        if record_history {
            self.push_undo(Transaction {
                after_state_id: self.current_state_id,
                assets: Vec::new(),
                before_state_id,
                byte_size: 0,
                delta,
                kind: command.history_kind(),
                label: command.label().into(),
            });
        }
        push_dirty_patch(&mut patches, dirty_before, self.dirty);

        Ok(PatchBatch {
            label: command.label().into(),
            patches,
            transaction_id,
        })
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn dirty(&self) -> bool {
        self.dirty
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn revision(&self) -> u64 {
        self.next_transaction_id
    }

    pub fn performance_diagnostics(&self) -> CoreSessionPerformanceDiagnostics {
        let (
            refactor_plan_store_entry_count,
            refactor_plan_store_bytes,
            refactor_plan_store_fingerprint,
        ) = self.refactor_plans.diagnostics();
        let (refactor_planning_task_count, refactor_planning_task_bytes) =
            self.refactor_planning_tasks.diagnostics();
        CoreSessionPerformanceDiagnostics {
            analysis_cache_source_count: self.analysis_cache.values().map(BTreeMap::len).sum(),
            backlink_cache_bytes: self
                .backlink_cache
                .values()
                .flat_map(BTreeMap::values)
                .map(|entry| entry.byte_size)
                .sum(),
            backlink_cache_entry_count: self.backlink_cache.values().map(BTreeMap::len).sum(),
            backlink_cache_hit_count: self.backlink_cache_hit_count,
            backlink_scan_count: self.backlink_scan_count,
            backlink_scanned_source_count: self.backlink_scanned_source_count,
            fingerprint_entry_count: self.current_fingerprints.len()
                + self.saved_fingerprints.len(),
            graph_cache_story_count: self.graph_cache.len(),
            history_bytes: self.history_bytes,
            last_mutation: self.last_mutation_stage_timings.clone(),
            parsed_source_count: self.analysis_parse_count,
            passage_count: self
                .project
                .stories
                .iter()
                .map(|story| story.passages.len())
                .sum(),
            project_document_bytes: self
                .project
                .stories
                .iter()
                .map(|story| {
                    story.script.len()
                        + story.stylesheet.len()
                        + story
                            .passages
                            .iter()
                            .map(|passage| passage.text.len())
                            .sum::<usize>()
                })
                .sum::<usize>(),
            refactor_planning_task_bytes,
            refactor_planning_task_count,
            refactor_plan_store_bytes,
            refactor_plan_store_entry_count,
            refactor_plan_store_fingerprint,
            read_model_cache_story_count: self.read_model_cache.len(),
            read_model_full_build_count: self.read_model_full_build_count,
            read_model_incremental_update_count: self.read_model_incremental_update_count,
            read_model_last_touched_source_count: self.read_model_last_touched_source_count,
            redo_entry_count: self.redo_stack.len(),
            undo_entry_count: self.undo_stack.len(),
        }
    }

    pub fn set_revision(&mut self, next_transaction_id: u64) {
        self.next_transaction_id = next_transaction_id.max(1);
    }

    pub fn redo(&mut self) -> Option<PatchBatch> {
        let transaction = self.redo_stack.pop()?;
        let dirty_before = self.dirty;
        let operation_id = self.next_transaction_id;
        let mut patches = transaction.delta.patches(true);

        transaction.delta.apply(&mut self.project, true);
        if !transaction.assets.is_empty() {
            apply_asset_inventory_delta(&mut self.asset_inventory, &transaction.assets, true);
            patches.extend(self.asset_inventory_patches().ok()?);
        }
        self.current_state_id = transaction.after_state_id;
        self.sync_fingerprints(&transaction.delta);
        self.next_transaction_id += 1;
        self.update_session_caches(&transaction.delta);
        self.undo_stack.push(transaction.clone());

        push_dirty_patch(&mut patches, dirty_before, self.dirty);
        Some(PatchBatch {
            label: transaction.label,
            patches,
            transaction_id: operation_id,
        })
    }

    pub fn snapshot(&self) -> ProjectSnapshot {
        ProjectSnapshot {
            dirty: self.dirty,
            name: self.project.manifest.name.clone(),
            schema_version: self.project.manifest.schema_version,
            stories: self
                .project
                .stories
                .iter()
                .map(StorySnapshot::from)
                .collect(),
        }
    }

    pub fn undo(&mut self) -> Option<PatchBatch> {
        let transaction = self.undo_stack.pop()?;
        let dirty_before = self.dirty;
        let operation_id = self.next_transaction_id;
        let mut patches = transaction.delta.patches(false);

        transaction.delta.apply(&mut self.project, false);
        if !transaction.assets.is_empty() {
            apply_asset_inventory_delta(&mut self.asset_inventory, &transaction.assets, false);
            patches.extend(self.asset_inventory_patches().ok()?);
        }
        self.current_state_id = transaction.before_state_id;
        self.sync_fingerprints(&transaction.delta);
        self.next_transaction_id += 1;
        self.update_session_caches(&transaction.delta);
        self.redo_stack.push(transaction.clone());

        push_dirty_patch(&mut patches, dirty_before, self.dirty);
        Some(PatchBatch {
            label: format!("Undo {}", transaction.label),
            patches,
            transaction_id: operation_id,
        })
    }

    pub fn acknowledge_saved(&mut self, revision: u64) -> PatchBatch {
        let dirty_before = self.dirty;

        if revision == self.revision() {
            self.saved_state_id = self.current_state_id;
            self.accept_current_fingerprints_as_saved();
            self.dirty = false;
        }

        let mut patches = Vec::new();
        push_dirty_patch(&mut patches, dirty_before, self.dirty);
        PatchBatch {
            label: "Mark Saved".into(),
            patches,
            transaction_id: self.next_transaction_id,
        }
    }

    pub fn status(&self) -> CoreSessionStatus {
        CoreSessionStatus {
            can_redo: self.can_redo(),
            can_undo: self.can_undo(),
            dirty: self.dirty,
            redo_kind: self
                .redo_stack
                .last()
                .map(|transaction| transaction.kind.clone()),
            revision: self.revision().min(u32::MAX as u64) as u32,
            undo_kind: self
                .undo_stack
                .last()
                .map(|transaction| transaction.kind.clone()),
        }
    }

    fn refresh_dirty(&mut self) {
        self.dirty = !self.dirty_fields.is_empty();
    }

    fn accept_current_fingerprints_as_saved(&mut self) {
        for field in std::mem::take(&mut self.dirty_fields) {
            match self.current_fingerprints.get(&field).copied() {
                Some(value) => match self.saved_fingerprints.entry(field) {
                    Entry::Occupied(mut entry) => *entry.get_mut() = value,
                    Entry::Vacant(entry) => {
                        entry.insert(value);
                    }
                },
                None => {
                    self.saved_fingerprints.remove(&field);
                }
            }
        }

        debug_assert_eq!(self.saved_fingerprints, self.current_fingerprints);
    }

    fn refresh_dirty_fields(&mut self, touched: impl IntoIterator<Item = String>) {
        for field in touched {
            if self.current_fingerprints.get(&field) == self.saved_fingerprints.get(&field) {
                self.dirty_fields.remove(&field);
            } else {
                self.dirty_fields.insert(field);
            }
        }
        self.refresh_dirty();
    }

    fn sync_fingerprints(&mut self, delta: &ProjectDelta) {
        let touched =
            sync_fingerprints_for_delta(&self.project, &mut self.current_fingerprints, delta);

        self.refresh_dirty_fields(touched);
    }

    fn plan_compact_external_changes(
        &self,
        changes: &[CoreExternalChange],
    ) -> Result<CompactExternalPlan, CoreError> {
        let mut plan = CompactExternalPlan::default();
        let mut planned_names = BTreeMap::<(String, String), String>::new();

        for (index, change) in changes.iter().enumerate() {
            match change {
                CoreExternalChange::UpdatePassage {
                    changes,
                    passage_id,
                    story_id,
                } => {
                    let story = self.story(story_id)?;
                    let passage_id_model = PassageId::new(passage_id);
                    if story.passage_by_id(&passage_id_model).is_none() {
                        return Err(CoreError::PassageNotFound(passage_id.clone()));
                    }
                    let prefix = format!("passage:{story_id}:{passage_id}");

                    if let Some(layout) = &changes.layout {
                        plan.candidate_fingerprints.insert(
                            format!("{prefix}:layout"),
                            fingerprint(&Some(GraphPosition::from(*layout))),
                        );
                    }
                    if let Some(name) = &changes.name {
                        let duplicate_planned = planned_names.iter().any(
                            |((planned_story_id, planned_passage_id), planned_name)| {
                                planned_story_id == story_id
                                    && planned_passage_id != passage_id
                                    && planned_name == name
                            },
                        );
                        let duplicate_existing = story
                            .passages
                            .id_for_name(name)
                            .filter(|existing_id| existing_id.as_ref() != passage_id)
                            .is_some_and(|existing_id| {
                                planned_names
                                    .get(&(story_id.clone(), existing_id.as_ref().to_owned()))
                                    .is_none_or(|planned_name| planned_name == name)
                            });
                        if duplicate_planned || duplicate_existing {
                            return Err(CoreError::DuplicatePassageName(name.clone()));
                        }
                        planned_names.insert((story_id.clone(), passage_id.clone()), name.clone());
                        plan.candidate_fingerprints
                            .insert(format!("{prefix}:name"), fingerprint(name));
                    }
                    if let Some(tags) = &changes.tags {
                        plan.candidate_fingerprints
                            .insert(format!("{prefix}:tags"), fingerprint(tags));
                    }
                    if let Some(text) = &changes.text {
                        plan.candidate_fingerprints
                            .insert(format!("{prefix}:text"), fingerprint(text));
                    }
                }
                CoreExternalChange::UpdatePassageLayout {
                    layout,
                    passage_id,
                    story_id,
                } => {
                    let story = self.story(story_id)?;
                    if story.passage_by_id(&PassageId::new(passage_id)).is_none() {
                        return Err(CoreError::PassageNotFound(passage_id.clone()));
                    }
                    plan.candidate_fingerprints.insert(
                        format!("passage:{story_id}:{passage_id}:layout"),
                        fingerprint(&(*layout).map(GraphPosition::from)),
                    );
                }
                CoreExternalChange::UpdateProjectLayout { layout_json } => {
                    let mut layout = serde_json::from_str::<GraphLayout>(layout_json)
                        .map_err(|error| CoreError::UnsupportedCommand(error.to_string()))?;
                    layout.passages.clear();
                    plan.candidate_fingerprints
                        .insert("project:layout".into(), fingerprint(&layout));
                    plan.project_layouts.insert(index, layout);
                }
                CoreExternalChange::UpdateStoryMetadata { changes, story_id } => {
                    self.story(story_id)?;
                    let prefix = format!("story:{story_id}");

                    if let Some(value) = &changes.ifid {
                        plan.candidate_fingerprints
                            .insert(format!("{prefix}:ifid"), fingerprint(value));
                    }
                    if let Some(value) = &changes.name {
                        plan.candidate_fingerprints
                            .insert(format!("{prefix}:name"), fingerprint(value));
                    }
                    if let Some(value) = changes.snap_to_grid {
                        plan.candidate_fingerprints
                            .insert(format!("{prefix}:snapToGrid"), fingerprint(&value));
                    }
                    if let Some(value) = &changes.story_format {
                        plan.candidate_fingerprints
                            .insert(format!("{prefix}:storyFormat"), fingerprint(value));
                    }
                    if let Some(value) = &changes.story_format_version {
                        plan.candidate_fingerprints
                            .insert(format!("{prefix}:storyFormatVersion"), fingerprint(value));
                    }
                    if let Some(value) = &changes.tag_colors {
                        plan.candidate_fingerprints
                            .insert(format!("{prefix}:tagColors"), fingerprint(value));
                    }
                    if let Some(value) = &changes.tags {
                        plan.candidate_fingerprints
                            .insert(format!("{prefix}:tags"), fingerprint(value));
                    }
                    if let Some(value) = changes.zoom {
                        plan.candidate_fingerprints
                            .insert(format!("{prefix}:zoom"), fingerprint(&value));
                    }
                }
                CoreExternalChange::UpdateStoryStartPassage {
                    passage_id,
                    story_id,
                } => {
                    let story = self.story(story_id)?;
                    if !passage_id.is_empty()
                        && story.passage_by_id(&PassageId::new(passage_id)).is_none()
                    {
                        return Err(CoreError::PassageNotFound(passage_id.clone()));
                    }
                    plan.candidate_fingerprints.insert(
                        format!("story:{story_id}:startPassage"),
                        fingerprint(&PassageId::new(passage_id)),
                    );
                }
                CoreExternalChange::UpdateStoryScript { script, story_id } => {
                    self.story(story_id)?;
                    plan.candidate_fingerprints
                        .insert(format!("story:{story_id}:script"), fingerprint(script));
                }
                CoreExternalChange::UpdateStoryStylesheet {
                    story_id,
                    stylesheet,
                } => {
                    self.story(story_id)?;
                    plan.candidate_fingerprints.insert(
                        format!("story:{story_id}:stylesheet"),
                        fingerprint(stylesheet),
                    );
                }
                _ => {
                    return Err(CoreError::UnsupportedCommand(
                        "external change is not compact-ingest compatible".into(),
                    ));
                }
            }
        }

        Ok(plan)
    }

    fn compact_external_conflicts(
        &self,
        changes: &[CoreExternalChange],
        candidate_fingerprints: &BTreeMap<String, u64>,
    ) -> Vec<CoreExternalConflict> {
        let mut conflicts = Vec::new();

        for change in changes {
            for field in external_change_field_patterns(change) {
                if !self.dirty_fields.contains(&field)
                    || self.current_fingerprints.get(&field) == candidate_fingerprints.get(&field)
                {
                    continue;
                }
                let (story_id, passage_id) = external_change_identity(change);

                conflicts.push(CoreExternalConflict {
                    field: field.clone(),
                    message: format!("{field} changed both locally and on disk."),
                    passage_id,
                    path: None,
                    story_id,
                });
            }
        }

        conflicts.sort_by(|left, right| left.field.cmp(&right.field));
        conflicts.dedup_by(|left, right| left.field == right.field);
        conflicts
    }

    fn external_conflicts(
        &self,
        changes: &[CoreExternalChange],
        candidate: &ProjectSession,
    ) -> Vec<CoreExternalConflict> {
        let mut conflicts = Vec::new();

        for change in changes {
            if let CoreExternalChange::DeleteAsset { path }
            | CoreExternalChange::UpsertAsset {
                asset: CoreAssetInventoryEntry { path, .. },
            } = change
            {
                conflicts.push(CoreExternalConflict {
                    field: format!("asset:{path}"),
                    message: format!("{path} changed outside twine.rs and requires review."),
                    passage_id: None,
                    path: Some(path.clone()),
                    story_id: None,
                });
                continue;
            }

            for pattern in external_change_field_patterns(change) {
                for field in self
                    .dirty_fields
                    .iter()
                    .filter(|field| field_matches_pattern(field, &pattern))
                {
                    if self.current_fingerprints.get(field)
                        == candidate.current_fingerprints.get(field)
                    {
                        continue;
                    }

                    let (story_id, passage_id) = external_change_identity(change);

                    conflicts.push(CoreExternalConflict {
                        field: field.clone(),
                        message: format!("{field} changed both locally and on disk."),
                        passage_id,
                        path: None,
                        story_id,
                    });
                }
            }
        }

        conflicts.sort_by(|left, right| left.field.cmp(&right.field));
        conflicts.dedup_by(|left, right| left.field == right.field);
        conflicts
    }

    fn accept_external_fingerprints(&mut self, changes: &[CoreExternalChange]) {
        for pattern in changes.iter().flat_map(external_change_field_patterns) {
            let fields = if pattern.ends_with('*') {
                self.current_fingerprints
                    .keys()
                    .chain(self.saved_fingerprints.keys())
                    .filter(|field| field_matches_pattern(field, &pattern))
                    .cloned()
                    .collect::<BTreeSet<_>>()
            } else {
                BTreeSet::from([pattern])
            };

            for field in fields {
                if let Some(value) = self.current_fingerprints.get(&field) {
                    self.saved_fingerprints.insert(field.clone(), *value);
                } else {
                    self.saved_fingerprints.remove(&field);
                }
                self.dirty_fields.remove(&field);
            }
        }
        self.refresh_dirty();
    }

    fn remember_external_delta(&mut self, id: String) {
        if id.is_empty() {
            return;
        }

        self.applied_external_delta_ids.push_back(id);
        while self.applied_external_delta_ids.len() > MAX_HISTORY_ENTRIES {
            self.applied_external_delta_ids.pop_front();
        }
    }

    pub fn ingest_external_delta(
        &mut self,
        delta: CoreExternalDelta,
        mode: CoreExternalIngestMode,
    ) -> Result<CoreExternalIngestResult, CoreError> {
        self.last_mutation_stage_timings = None;
        if !delta.id.is_empty() && self.applied_external_delta_ids.contains(&delta.id) {
            return Ok(CoreExternalIngestResult {
                batch: None,
                conflicts: Vec::new(),
                history_recorded: false,
                outcome: CoreExternalIngestOutcome::NoOp,
                status: self.status(),
            });
        }

        if let [
            CoreExternalChange::UpdatePassage {
                changes,
                passage_id,
                story_id,
            },
        ] = delta.changes.as_slice()
            && changes.text.is_some()
            && changes.layout.is_none()
            && changes.name.is_none()
            && changes.tags.is_none()
        {
            return self.ingest_external_passage_text(
                delta.id,
                mode,
                story_id,
                passage_id,
                changes.text.clone().expect("text change should be present"),
            );
        }

        if compact_external_delta_supported(&delta.changes) {
            return self.ingest_compact_external_delta(delta, mode);
        }

        let mut candidate = self.clone();

        for change in delta.changes.iter().cloned() {
            candidate.apply_external_change(change)?;
        }
        let candidate_delta = ProjectDelta::between(&self.project, &candidate.project);

        candidate.sync_fingerprints(&candidate_delta);

        let conflicts = self.external_conflicts(&delta.changes, &candidate);

        if mode == CoreExternalIngestMode::Auto && !conflicts.is_empty() {
            return Ok(CoreExternalIngestResult {
                batch: None,
                conflicts,
                history_recorded: false,
                outcome: CoreExternalIngestOutcome::Conflict,
                status: self.status(),
            });
        }

        let before = self.project.clone();
        let before_assets = self.asset_inventory.clone();
        let dirty_before = self.dirty;
        let before_state_id = self.current_state_id;
        let operation_id = self.next_transaction_id;

        for change in delta.changes.iter().cloned() {
            if let Err(error) = self.apply_external_change(change) {
                self.project = before;
                self.asset_inventory = before_assets;
                return Err(error);
            }
        }

        let project_changed = self.project != before;
        let assets_changed = self.asset_inventory != before_assets;
        let transaction_delta = ProjectDelta::between(&before, &self.project);

        if project_changed {
            self.sync_fingerprints(&transaction_delta);
        }
        self.accept_external_fingerprints(&delta.changes);
        self.remember_external_delta(delta.id);

        if !project_changed && !assets_changed {
            let mut patches = Vec::new();

            push_dirty_patch(&mut patches, dirty_before, self.dirty);
            let batch = PatchBatch {
                label: "External Changes".into(),
                patches,
                transaction_id: operation_id,
            };

            return Ok(CoreExternalIngestResult {
                batch: Some(batch),
                conflicts: Vec::new(),
                history_recorded: false,
                outcome: CoreExternalIngestOutcome::NoOp,
                status: self.status(),
            });
        }

        self.next_transaction_id += 1;
        let mut patches = project_diff_patches(&before, &self.project);

        if assets_changed {
            patches.extend(self.asset_inventory_patches()?);
        }
        push_dirty_patch(&mut patches, dirty_before, self.dirty);

        if project_changed {
            self.current_state_id = operation_id;
            self.update_session_caches(&transaction_delta);
            self.clear_redo();
            self.push_undo(Transaction {
                after_state_id: self.current_state_id,
                assets: Vec::new(),
                before_state_id,
                byte_size: 0,
                delta: transaction_delta,
                kind: CoreHistoryKind::ExternalChanges,
                label: "External Changes".into(),
            });
        }

        let batch = PatchBatch {
            label: "External Changes".into(),
            patches,
            transaction_id: operation_id,
        };

        Ok(CoreExternalIngestResult {
            batch: Some(batch),
            conflicts: Vec::new(),
            history_recorded: project_changed,
            outcome: CoreExternalIngestOutcome::Applied,
            status: self.status(),
        })
    }

    fn ingest_compact_external_delta(
        &mut self,
        delta: CoreExternalDelta,
        mode: CoreExternalIngestMode,
    ) -> Result<CoreExternalIngestResult, CoreError> {
        let mut plan = self.plan_compact_external_changes(&delta.changes)?;
        let conflicts =
            self.compact_external_conflicts(&delta.changes, &plan.candidate_fingerprints);

        if mode == CoreExternalIngestMode::Auto && !conflicts.is_empty() {
            return Ok(CoreExternalIngestResult {
                batch: None,
                conflicts,
                history_recorded: false,
                outcome: CoreExternalIngestOutcome::Conflict,
                status: self.status(),
            });
        }

        let mut touched_story_ids = BTreeSet::<StoryId>::new();
        let mut touched_passage_ids = BTreeSet::<(StoryId, PassageId)>::new();
        let mut touched_project_passage_layouts = BTreeSet::<(StoryId, PassageId)>::new();
        let mut renamed_story_ids = BTreeSet::<StoryId>::new();

        for change in &delta.changes {
            match change {
                CoreExternalChange::UpdatePassage {
                    changes,
                    passage_id,
                    story_id,
                } => {
                    let story_id = StoryId::new(story_id);
                    let passage_id = PassageId::new(passage_id);
                    touched_story_ids.insert(story_id.clone());
                    touched_passage_ids.insert((story_id.clone(), passage_id.clone()));
                    if changes.layout.is_some() {
                        touched_project_passage_layouts.insert((story_id.clone(), passage_id));
                    }
                    if changes.name.is_some() {
                        renamed_story_ids.insert(story_id);
                    }
                }
                CoreExternalChange::UpdatePassageLayout {
                    passage_id,
                    story_id,
                    ..
                } => {
                    let story_id = StoryId::new(story_id);
                    let passage_id = PassageId::new(passage_id);
                    touched_story_ids.insert(story_id.clone());
                    touched_passage_ids.insert((story_id.clone(), passage_id.clone()));
                    touched_project_passage_layouts.insert((story_id, passage_id));
                }
                CoreExternalChange::UpdateStoryMetadata { story_id, .. }
                | CoreExternalChange::UpdateStoryScript { story_id, .. }
                | CoreExternalChange::UpdateStoryStartPassage { story_id, .. }
                | CoreExternalChange::UpdateStoryStylesheet { story_id, .. } => {
                    touched_story_ids.insert(StoryId::new(story_id));
                }
                CoreExternalChange::UpdateProjectLayout { .. } => {}
                _ => unreachable!("compact external changes were prevalidated"),
            }
        }

        let before_story_shells = touched_story_ids
            .iter()
            .map(|story_id| {
                Ok((
                    story_id.clone(),
                    story_shell_without_passages(self.story(story_id.as_ref())?),
                ))
            })
            .collect::<Result<BTreeMap<_, _>, CoreError>>()?;
        let before_passages = touched_passage_ids
            .iter()
            .map(|(story_id, passage_id)| {
                let story = self.story(story_id.as_ref())?;
                let index = story
                    .passages
                    .rank_of(passage_id)
                    .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;
                let value = story
                    .passage_by_id(passage_id)
                    .expect("passage rank should resolve")
                    .clone();

                Ok((
                    (story_id.clone(), passage_id.clone()),
                    IndexedPassage { index, value },
                ))
            })
            .collect::<Result<BTreeMap<_, _>, CoreError>>()?;
        let before_project_passage_layouts = touched_project_passage_layouts
            .iter()
            .map(|(story_id, passage_id)| {
                (
                    (story_id.clone(), passage_id.clone()),
                    self.project
                        .layout
                        .passages
                        .get(story_id, passage_id)
                        .cloned(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let before_project_layout = (!plan.project_layouts.is_empty())
            .then(|| project_layout_shell_without_passages(&self.project.layout));

        for (index, change) in delta.changes.iter().enumerate() {
            match change {
                CoreExternalChange::UpdatePassage {
                    changes,
                    passage_id,
                    story_id,
                } => {
                    let passage_id_model = PassageId::new(passage_id);
                    {
                        let passage = self
                            .story_mut(story_id)?
                            .passage_by_id_mut(&passage_id_model)
                            .expect("compact external passage was prevalidated");

                        if let Some(name) = &changes.name {
                            passage.name.clone_from(name);
                        }
                        if let Some(text) = &changes.text {
                            passage.text.clone_from(text);
                        }
                        if let Some(tags) = &changes.tags {
                            passage.tags.clone_from(tags);
                        }
                        if let Some(layout) = &changes.layout {
                            passage.layout = Some(GraphPosition::from(*layout));
                        }
                    }
                    if let Some(layout) = &changes.layout {
                        self.project.layout.passages.set_bounds(
                            StoryId::new(story_id),
                            passage_id_model,
                            GraphPosition::from(*layout),
                        );
                    }
                }
                CoreExternalChange::UpdatePassageLayout {
                    layout,
                    passage_id,
                    story_id,
                } => {
                    let story_id_model = StoryId::new(story_id);
                    let passage_id_model = PassageId::new(passage_id);
                    let bounds = (*layout).map(GraphPosition::from);

                    self.story_mut(story_id)?
                        .passage_by_id_mut(&passage_id_model)
                        .expect("compact external passage was prevalidated")
                        .layout = bounds;
                    if let Some(bounds) = bounds {
                        self.project.layout.passages.set_bounds(
                            story_id_model,
                            passage_id_model,
                            bounds,
                        );
                    } else {
                        self.project
                            .layout
                            .passages
                            .remove(&story_id_model, &passage_id_model);
                    }
                }
                CoreExternalChange::UpdateProjectLayout { .. } => {
                    let layout = plan
                        .project_layouts
                        .remove(&index)
                        .expect("compact project layout was prevalidated");
                    self.project.layout.annotations = layout.annotations;
                    self.project.layout.groups = layout.groups;
                    self.project.layout.metadata = layout.metadata;
                    self.project.layout.saved_layouts = layout.saved_layouts;
                }
                CoreExternalChange::UpdateStoryMetadata { changes, story_id } => {
                    let story = self.story_mut(story_id)?;

                    if let Some(value) = &changes.ifid {
                        story.ifid.clone_from(value);
                    }
                    if let Some(value) = &changes.name {
                        story.name.clone_from(value);
                    }
                    if let Some(value) = changes.snap_to_grid {
                        story.snap_to_grid = value;
                    }
                    if let Some(value) = &changes.story_format {
                        story.story_format.clone_from(value);
                    }
                    if let Some(value) = &changes.story_format_version {
                        story.story_format_version.clone_from(value);
                    }
                    if let Some(value) = &changes.tag_colors {
                        story.tag_colors.clone_from(value);
                    }
                    if let Some(value) = &changes.tags {
                        story.tags.clone_from(value);
                    }
                    if let Some(value) = changes.zoom {
                        story.zoom = value;
                    }
                }
                CoreExternalChange::UpdateStoryScript { script, story_id } => {
                    self.story_mut(story_id)?.script.clone_from(script);
                }
                CoreExternalChange::UpdateStoryStartPassage {
                    passage_id,
                    story_id,
                } => {
                    self.story_mut(story_id)?.start_passage = PassageId::new(passage_id);
                }
                CoreExternalChange::UpdateStoryStylesheet {
                    story_id,
                    stylesheet,
                } => {
                    self.story_mut(story_id)?.stylesheet.clone_from(stylesheet);
                }
                _ => unreachable!("compact external changes were prevalidated"),
            }
        }
        for story_id in renamed_story_ids {
            self.story_mut(story_id.as_ref())?
                .passages
                .rebuild_name_index();
        }

        let mut story_deltas = Vec::new();
        for story_id in touched_story_ids {
            let before = before_story_shells
                .get(&story_id)
                .expect("touched story shell was captured")
                .clone();
            let story = self.story(story_id.as_ref())?;
            let after = story_shell_without_passages(story);
            let passages = touched_passage_ids
                .iter()
                .filter(|(candidate_story_id, _)| candidate_story_id == &story_id)
                .filter_map(|key| {
                    let before = before_passages
                        .get(key)
                        .expect("touched passage was captured")
                        .clone();
                    let after = IndexedPassage {
                        index: story
                            .passages
                            .rank_of(&key.1)
                            .expect("touched passage should remain present"),
                        value: story
                            .passage_by_id(&key.1)
                            .expect("touched passage should remain present")
                            .clone(),
                    };

                    (before.value != after.value).then_some(PassageDelta {
                        after: Some(after),
                        before: Some(before),
                        passage_id: key.1.clone(),
                    })
                })
                .collect::<Vec<_>>();

            if before != after || !passages.is_empty() {
                story_deltas.push(StoryDelta::Update {
                    after,
                    before,
                    passages,
                    story_id,
                });
            }
        }
        let layout_passages = before_project_passage_layouts
            .into_iter()
            .filter_map(|((story_id, passage_id), before)| {
                let after = self
                    .project
                    .layout
                    .passages
                    .get(&story_id, &passage_id)
                    .cloned();

                (before != after).then_some(ProjectLayoutPassageDelta {
                    after,
                    before,
                    passage_id,
                    story_id,
                })
            })
            .collect::<Vec<_>>();
        let project_layout = before_project_layout.and_then(|before| {
            let after = project_layout_shell_without_passages(&self.project.layout);

            (before != after).then_some(ProjectLayoutDelta { after, before })
        });
        let transaction_delta = ProjectDelta {
            layout_passages,
            project_layout,
            stories: story_deltas,
            ..ProjectDelta::default()
        };
        let project_changed = !transaction_delta.stories.is_empty()
            || !transaction_delta.layout_passages.is_empty()
            || transaction_delta.project_layout.is_some();
        let dirty_before = self.dirty;
        let before_state_id = self.current_state_id;
        let operation_id = self.next_transaction_id;

        if project_changed {
            self.sync_fingerprints(&transaction_delta);
        }
        self.accept_external_fingerprints(&delta.changes);
        self.remember_external_delta(delta.id);

        if !project_changed {
            let mut patches = Vec::new();
            push_dirty_patch(&mut patches, dirty_before, self.dirty);

            return Ok(CoreExternalIngestResult {
                batch: Some(PatchBatch {
                    label: "External Changes".into(),
                    patches,
                    transaction_id: operation_id,
                }),
                conflicts: Vec::new(),
                history_recorded: false,
                outcome: CoreExternalIngestOutcome::NoOp,
                status: self.status(),
            });
        }

        self.next_transaction_id += 1;
        self.current_state_id = operation_id;
        let mut patches = transaction_delta.patches(true);
        self.update_session_caches(&transaction_delta);
        self.clear_redo();
        self.push_undo(Transaction {
            after_state_id: self.current_state_id,
            assets: Vec::new(),
            before_state_id,
            byte_size: 0,
            delta: transaction_delta,
            kind: CoreHistoryKind::ExternalChanges,
            label: "External Changes".into(),
        });
        push_dirty_patch(&mut patches, dirty_before, self.dirty);
        let batch = PatchBatch {
            label: "External Changes".into(),
            patches,
            transaction_id: operation_id,
        };

        Ok(CoreExternalIngestResult {
            batch: Some(batch),
            conflicts: Vec::new(),
            history_recorded: true,
            outcome: CoreExternalIngestOutcome::Applied,
            status: self.status(),
        })
    }

    fn ingest_external_passage_text(
        &mut self,
        delta_id: String,
        mode: CoreExternalIngestMode,
        story_id: &str,
        passage_id: &str,
        text: String,
    ) -> Result<CoreExternalIngestResult, CoreError> {
        self.last_mutation_stage_timings = None;
        let total_started = Instant::now();
        let delta_id_for_timings = delta_id.clone();
        let field = format!("passage:{story_id}:{passage_id}:text");
        let passage_id = PassageId::new(passage_id);
        let story_id = StoryId::new(story_id);
        let (passage_index, before, story_shell) = {
            let story = self.story(story_id.as_ref())?;
            let passage_index = story
                .passages
                .iter()
                .position(|passage| passage.id == passage_id)
                .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;
            let before = story
                .passage_by_id(&passage_id)
                .expect("passage index should resolve")
                .clone();

            if mode == CoreExternalIngestMode::Auto
                && self.dirty_fields.contains(&field)
                && before.text != text
            {
                return Ok(CoreExternalIngestResult {
                    batch: None,
                    conflicts: vec![CoreExternalConflict {
                        field,
                        message: format!(
                            "passage:{}:{}:text changed both locally and on disk.",
                            story_id.as_ref(),
                            passage_id.as_ref()
                        ),
                        passage_id: Some(passage_id.as_ref().to_owned()),
                        path: None,
                        story_id: Some(story_id.as_ref().to_owned()),
                    }],
                    history_recorded: false,
                    outcome: CoreExternalIngestOutcome::Conflict,
                    status: self.status(),
                });
            }

            (passage_index, before, story_shell_without_passages(story))
        };
        let dirty_before = self.dirty;
        let before_state_id = self.current_state_id;
        let operation_id = self.next_transaction_id;
        if before.text == text {
            self.accept_external_fingerprints(&[CoreExternalChange::UpdatePassage {
                changes: PassagePatch {
                    text: Some(text),
                    ..PassagePatch::default()
                },
                passage_id: passage_id.as_ref().to_owned(),
                story_id: story_id.as_ref().to_owned(),
            }]);
            self.remember_external_delta(delta_id);
            let mut patches = Vec::new();

            push_dirty_patch(&mut patches, dirty_before, self.dirty);
            return Ok(CoreExternalIngestResult {
                batch: Some(PatchBatch {
                    label: "External Changes".into(),
                    patches,
                    transaction_id: operation_id,
                }),
                conflicts: Vec::new(),
                history_recorded: false,
                outcome: CoreExternalIngestOutcome::NoOp,
                status: self.status(),
            });
        }
        let after = {
            let passage = self
                .story_mut(story_id.as_ref())?
                .passage_by_id_mut(&passage_id)
                .expect("passage index should resolve");

            passage.text = text.clone();
            passage.clone()
        };
        let transaction_delta = ProjectDelta {
            stories: vec![StoryDelta::Update {
                after: story_shell.clone(),
                before: story_shell,
                passages: vec![PassageDelta {
                    after: Some(IndexedPassage {
                        index: passage_index,
                        value: after,
                    }),
                    before: Some(IndexedPassage {
                        index: passage_index,
                        value: before,
                    }),
                    passage_id: passage_id.clone(),
                }],
                story_id: story_id.clone(),
            }],
            ..ProjectDelta::default()
        };
        let mut timings = CoreMutationStageTimings {
            delta_id: delta_id_for_timings,
            lookup_and_delta_ms: elapsed_ms(total_started),
            operation: "externalPassageText".into(),
            ..CoreMutationStageTimings::default()
        };

        let stage_started = Instant::now();
        self.sync_fingerprints(&transaction_delta);
        timings.fingerprint_ms = elapsed_ms(stage_started);
        let change = CoreExternalChange::UpdatePassage {
            changes: PassagePatch {
                text: Some(text.clone()),
                ..PassagePatch::default()
            },
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.as_ref().to_owned(),
        };

        let stage_started = Instant::now();
        self.accept_external_fingerprints(&[change]);
        self.remember_external_delta(delta_id);
        timings.savepoint_ms = elapsed_ms(stage_started);
        self.next_transaction_id += 1;
        self.current_state_id = operation_id;

        let stage_started = Instant::now();
        self.update_graph_cache(&transaction_delta);
        self.update_backlink_cache(&transaction_delta);
        timings.graph_ms = elapsed_ms(stage_started);
        if let Some(graph) = self.graph_cache.get(&story_id).map(|cache| &cache.graph) {
            timings.graph_parsed_source_count = graph.last_incremental_parse_count();
            timings.topology_changed = graph.last_topology_changed();
        }

        let stage_started = Instant::now();
        self.update_contents_catalog_cache(&transaction_delta);
        self.update_analysis_cache(&transaction_delta);
        timings.analysis_ms = elapsed_ms(stage_started);

        let stage_started = Instant::now();
        self.update_read_model_cache(&transaction_delta);
        timings.read_model_ms = elapsed_ms(stage_started);

        let stage_started = Instant::now();
        self.clear_redo();
        self.push_undo(Transaction {
            after_state_id: self.current_state_id,
            assets: Vec::new(),
            before_state_id,
            byte_size: 0,
            delta: transaction_delta,
            kind: CoreHistoryKind::ExternalChanges,
            label: "External Changes".into(),
        });
        timings.history_ms = elapsed_ms(stage_started);

        let stage_started = Instant::now();
        let mut patches = vec![Patch::PassageUpdated {
            changes: PassagePatch {
                text: Some(text),
                ..PassagePatch::default()
            },
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.as_ref().to_owned(),
        }];

        push_dirty_patch(&mut patches, dirty_before, self.dirty);
        let result = CoreExternalIngestResult {
            batch: Some(PatchBatch {
                label: "External Changes".into(),
                patches,
                transaction_id: operation_id,
            }),
            conflicts: Vec::new(),
            history_recorded: true,
            outcome: CoreExternalIngestOutcome::Applied,
            status: self.status(),
        };
        timings.patch_finalize_ms = elapsed_ms(stage_started);
        timings.revision = self.revision();
        timings.total_ms = elapsed_ms(total_started);
        self.last_mutation_stage_timings = Some(timings);

        Ok(result)
    }

    pub fn apply_external_delta(
        &mut self,
        delta: CoreExternalDelta,
    ) -> Result<PatchBatch, CoreError> {
        self.ingest_external_delta(delta, CoreExternalIngestMode::Force)?
            .batch
            .ok_or_else(|| CoreError::UnsupportedCommand("external delta produced no batch".into()))
    }

    fn apply_external_change(&mut self, change: CoreExternalChange) -> Result<(), CoreError> {
        match change {
            CoreExternalChange::DeleteAsset { path } => {
                let normalized = normalized_asset_path(&path);

                self.asset_inventory
                    .retain(|asset| asset.normalized_path != normalized);
            }
            CoreExternalChange::DeletePassage {
                passage_id,
                story_id,
            } => {
                self.delete_passages(&story_id, &[passage_id])?;
            }
            CoreExternalChange::DeleteStory { story_id } => {
                self.delete_story(&story_id)?;
            }
            CoreExternalChange::UpsertPassage { passage, story_id } => {
                let story_id_model = self.story(&story_id)?.id.clone();
                let passage = passage.into_passage(&story_id_model);
                let passage_id = passage.id.clone();
                let bounds = passage.layout;

                self.story_mut(&story_id)?.passages.insert(passage);
                if let Some(bounds) = bounds {
                    self.project
                        .layout
                        .passages
                        .set_bounds(story_id_model, passage_id, bounds);
                } else {
                    self.project
                        .layout
                        .passages
                        .remove(&story_id_model, &passage_id);
                }
            }
            CoreExternalChange::UpsertAsset { asset } => {
                let normalized = asset.normalized_path.clone();

                self.asset_inventory
                    .retain(|existing| existing.normalized_path != normalized);
                self.asset_inventory.push(asset);
                self.asset_inventory =
                    normalized_asset_inventory(std::mem::take(&mut self.asset_inventory));
            }
            CoreExternalChange::UpsertStory { story } => {
                if self
                    .project
                    .stories
                    .iter()
                    .any(|candidate| candidate.id.as_ref() == story.id)
                {
                    self.replace_story(&story.id.clone(), story)?;
                } else {
                    self.create_story(story)?;
                }
            }
            CoreExternalChange::UpdatePassage {
                changes,
                passage_id,
                story_id,
            } => {
                self.update_passage(&story_id, &passage_id, changes, false)?;
            }
            CoreExternalChange::UpdatePassageLayout {
                layout,
                passage_id,
                story_id,
            } => {
                let story_id_model = StoryId::new(&story_id);
                let passage_id_model = PassageId::new(&passage_id);
                let bounds = layout.map(GraphPosition::from);
                let story = self.story_mut(&story_id)?;
                let passage = story
                    .passages
                    .get_mut(&passage_id_model)
                    .ok_or(CoreError::PassageNotFound(passage_id))?;

                passage.layout = bounds;
                if let Some(bounds) = bounds {
                    self.project.layout.passages.set_bounds(
                        story_id_model,
                        passage_id_model,
                        bounds,
                    );
                } else {
                    self.project
                        .layout
                        .passages
                        .remove(&story_id_model, &passage_id_model);
                }
            }
            CoreExternalChange::UpdateProjectLayout { layout_json } => {
                let layout = serde_json::from_str::<twine_model::GraphLayout>(&layout_json)
                    .map_err(|error| CoreError::UnsupportedCommand(error.to_string()))?;

                self.project.layout.annotations = layout.annotations;
                self.project.layout.groups = layout.groups;
                self.project.layout.metadata = layout.metadata;
                self.project.layout.saved_layouts = layout.saved_layouts;
            }
            CoreExternalChange::UpdateStoryMetadata { changes, story_id } => {
                let story = self.story_mut(&story_id)?;

                if let Some(value) = changes.ifid {
                    story.ifid = value;
                }
                if let Some(name) = changes.name {
                    story.name = name;
                }
                if let Some(value) = changes.snap_to_grid {
                    story.snap_to_grid = value;
                }
                if let Some(value) = changes.story_format {
                    story.story_format = value;
                }
                if let Some(value) = changes.story_format_version {
                    story.story_format_version = value;
                }
                if let Some(value) = changes.tag_colors {
                    story.tag_colors = value;
                }
                if let Some(value) = changes.tags {
                    story.tags = value;
                }
                if let Some(value) = changes.zoom {
                    story.zoom = value;
                }
            }
            CoreExternalChange::UpdateStoryScript { script, story_id } => {
                self.update_story_script(&story_id, script)?;
            }
            CoreExternalChange::UpdateStoryStartPassage {
                passage_id,
                story_id,
            } => {
                self.set_start_passage(&story_id, &passage_id)?;
            }
            CoreExternalChange::UpdateStoryStylesheet {
                story_id,
                stylesheet,
            } => {
                self.update_story_stylesheet(&story_id, stylesheet)?;
            }
        }

        Ok(())
    }

    fn push_undo(&mut self, mut transaction: Transaction) {
        transaction.byte_size = serde_json::to_vec(&(&transaction.delta, &transaction.assets))
            .map_or(0, |delta| delta.len());
        self.history_bytes += transaction.byte_size;
        self.undo_stack.push(transaction);

        while self.undo_stack.len() > MAX_HISTORY_ENTRIES || self.history_bytes > MAX_HISTORY_BYTES
        {
            let removed = self.undo_stack.remove(0);
            self.history_bytes = self.history_bytes.saturating_sub(removed.byte_size);
        }
    }

    fn clear_redo(&mut self) {
        for transaction in self.redo_stack.drain(..) {
            self.history_bytes = self.history_bytes.saturating_sub(transaction.byte_size);
        }
    }

    fn refresh_graph_layout(&mut self, story_id: &StoryId) {
        let Some(cache) = self.graph_cache.get(story_id) else {
            return;
        };
        let Some(story) = self
            .project
            .stories
            .iter()
            .find(|story| &story.id == story_id)
        else {
            self.graph_cache.remove(story_id);
            return;
        };
        let layout =
            cache
                .graph
                .layout_snapshot(story, &self.project.layout, &AutoLayoutOptions::default());

        if let Some(cache) = self.graph_cache.get_mut(story_id) {
            cache.layout = layout;
        }
    }

    fn update_graph_cache(&mut self, delta: &ProjectDelta) {
        let top_layout_changed = delta.project_layout.is_some()
            || delta
                .top_before
                .as_ref()
                .zip(delta.top_after.as_ref())
                .is_some_and(|(before, after)| before.layout != after.layout);
        for story_delta in &delta.stories {
            let story_id = match story_delta {
                StoryDelta::Replace { story_id, .. } | StoryDelta::Update { story_id, .. } => {
                    story_id.clone()
                }
            };

            if ProjectDelta::graph_facts_changed(story_delta) {
                if let StoryDelta::Update { passages, .. } = story_delta
                    && let Some(story) = self
                        .project
                        .stories
                        .iter()
                        .find(|story| story.id == story_id)
                    && let Some(cache) = self.graph_cache.get_mut(&story_id)
                {
                    let changed_passage_ids = passages
                        .iter()
                        .map(|passage| passage.passage_id.clone())
                        .collect::<BTreeSet<_>>();
                    let changed_source_ids = passages
                        .iter()
                        .filter(|passage| match (&passage.before, &passage.after) {
                            (Some(before), Some(after)) => before.value.text != after.value.text,
                            _ => true,
                        })
                        .map(|passage| passage.passage_id.clone())
                        .collect::<BTreeSet<_>>();
                    let changed_target_names = passages
                        .iter()
                        .flat_map(|passage| match (&passage.before, &passage.after) {
                            (Some(before), Some(after))
                                if before.value.name == after.value.name =>
                            {
                                [None, None]
                            }
                            (before, after) => [
                                before.as_ref().map(|value| value.value.name.clone()),
                                after.as_ref().map(|value| value.value.name.clone()),
                            ],
                        })
                        .flatten()
                        .collect::<BTreeSet<_>>();

                    cache.graph.apply_story_delta(
                        story,
                        &changed_passage_ids,
                        &changed_source_ids,
                        &changed_target_names,
                    );
                    if cache.graph.last_topology_changed() {
                        cache.layout = cache.graph.layout_snapshot(
                            story,
                            &self.project.layout,
                            &AutoLayoutOptions::default(),
                        );
                    }
                } else {
                    self.graph_cache.remove(&story_id);
                }
            } else {
                self.refresh_graph_layout(&story_id);
            }
        }
        if top_layout_changed {
            let cached_story_ids = self.graph_cache.keys().cloned().collect::<Vec<_>>();

            for story_id in cached_story_ids {
                self.refresh_graph_layout(&story_id);
            }
        }
        if !delta.layout_passages.is_empty() && delta.stories.is_empty() {
            let cached_story_ids = self.graph_cache.keys().cloned().collect::<Vec<_>>();

            for story_id in cached_story_ids {
                self.refresh_graph_layout(&story_id);
            }
        }
    }

    fn update_analysis_cache(&mut self, delta: &ProjectDelta) {
        for story_delta in &delta.stories {
            match story_delta {
                StoryDelta::Replace { story_id, .. } => {
                    self.analysis_cache.remove(story_id);
                }
                StoryDelta::Update {
                    after,
                    before,
                    passages,
                    story_id,
                } => {
                    if !self.analysis_cache.contains_key(story_id) {
                        continue;
                    }

                    for passage_delta in passages {
                        if let (Some(before), Some(after)) =
                            (&passage_delta.before, &passage_delta.after)
                            && before.value.name == after.value.name
                            && before.value.text == after.value.text
                        {
                            if before.value.tags != after.value.tags
                                && let Some(analysis) =
                                    self.analysis_cache.get_mut(story_id).and_then(|sources| {
                                        sources.get_mut(passage_delta.passage_id.as_ref())
                                    })
                            {
                                analysis.tags.clone_from(&after.value.tags);
                                analysis.file.tags.clone_from(&after.value.tags);
                            }
                            continue;
                        }
                        let passage = self
                            .project
                            .stories
                            .iter()
                            .find(|story| &story.id == story_id)
                            .and_then(|story| story.passage_by_id(&passage_delta.passage_id))
                            .cloned();

                        if let Some(passage) = passage {
                            self.source_analysis(
                                story_id,
                                passage.id.as_ref(),
                                &passage.name,
                                &passage.text,
                                CoreSourceKind::Passage,
                                Some(passage.id.as_ref()),
                                &passage.tags,
                                CoreSearchScope::PassageText,
                            );
                        } else if let Some(cache) = self.analysis_cache.get_mut(story_id) {
                            cache.remove(passage_delta.passage_id.as_ref());
                        }
                    }

                    if before.script != after.script {
                        let Some(script) = self
                            .project
                            .stories
                            .iter()
                            .find(|story| &story.id == story_id)
                            .map(|story| story.script.clone())
                        else {
                            continue;
                        };
                        let source_id = format!("{}:script", story_id.as_ref());

                        self.source_analysis(
                            story_id,
                            &source_id,
                            "Story JavaScript",
                            &script,
                            CoreSourceKind::Script,
                            None,
                            &[],
                            CoreSearchScope::Script,
                        );
                    }
                    if before.stylesheet != after.stylesheet {
                        let Some(stylesheet) = self
                            .project
                            .stories
                            .iter()
                            .find(|story| &story.id == story_id)
                            .map(|story| story.stylesheet.clone())
                        else {
                            continue;
                        };
                        let source_id = format!("{}:stylesheet", story_id.as_ref());

                        self.source_analysis(
                            story_id,
                            &source_id,
                            "Story Stylesheet",
                            &stylesheet,
                            CoreSourceKind::Stylesheet,
                            None,
                            &[],
                            CoreSearchScope::Stylesheet,
                        );
                    }
                }
            }
        }
    }

    fn update_contents_catalog_cache(&mut self, delta: &ProjectDelta) {
        let revision = self.revision();

        for story_delta in &delta.stories {
            let (after, before, passages, story_id) = match story_delta {
                StoryDelta::Replace { story_id, .. } => {
                    self.contents_catalog_cache.remove(story_id);
                    continue;
                }
                StoryDelta::Update {
                    after,
                    before,
                    passages,
                    story_id,
                } => (after, before, passages, story_id),
            };
            let Some(mut catalog) = self.contents_catalog_cache.remove(story_id) else {
                continue;
            };
            let Some(story) = self
                .project
                .stories
                .iter()
                .find(|story| &story.id == story_id)
            else {
                continue;
            };
            let mut touched_tags = BTreeSet::new();

            for passage in passages {
                if let Some(before) = &passage.before {
                    catalog
                        .contents
                        .remove(&format!("source:{}", before.value.id.as_ref()));
                    for tag in &before.value.tags {
                        touched_tags.insert(tag.clone());
                        let remove_tag =
                            catalog.tag_usage.get_mut(tag).is_some_and(|passage_ids| {
                                passage_ids.remove(before.value.id.as_ref());
                                passage_ids.is_empty()
                            });
                        if remove_tag {
                            catalog.tag_usage.remove(tag);
                        }
                    }
                }
                if let Some(after) = &passage.after {
                    let entry = basic_source_contents_entry(
                        after.value.id.as_ref(),
                        &after.value.name,
                        &after.value.text,
                        CoreContentsEntryKind::Passage,
                        Some(after.value.id.as_ref()),
                    );
                    catalog.contents.insert(entry.id.clone(), entry);
                    for tag in &after.value.tags {
                        touched_tags.insert(tag.clone());
                        catalog
                            .tag_usage
                            .entry(tag.clone())
                            .or_default()
                            .insert(after.value.id.as_ref().to_owned());
                    }
                }
            }

            if before.script != after.script {
                let source_id = format!("{}:script", story.id.as_ref());
                let entry = basic_source_contents_entry(
                    &source_id,
                    "Story JavaScript",
                    &story.script,
                    CoreContentsEntryKind::Script,
                    None,
                );
                catalog.contents.insert(entry.id.clone(), entry);
            }
            if before.stylesheet != after.stylesheet {
                let source_id = format!("{}:stylesheet", story.id.as_ref());
                let entry = basic_source_contents_entry(
                    &source_id,
                    "Story Stylesheet",
                    &story.stylesheet,
                    CoreContentsEntryKind::Stylesheet,
                    None,
                );
                catalog.contents.insert(entry.id.clone(), entry);
            }

            for entry in basic_story_metadata_contents_entries(story) {
                catalog.contents.insert(entry.id.clone(), entry);
            }
            catalog
                .contents
                .remove(&format!("entry:{}", before.start_passage.as_ref()));
            catalog
                .contents
                .remove(&format!("entry:{}", after.start_passage.as_ref()));
            if let Some(entry) = basic_story_entry_point(story) {
                catalog.contents.insert(entry.id.clone(), entry);
            }

            if before.tag_colors != after.tag_colors {
                touched_tags.extend(catalog.tag_usage.keys().cloned());
            }
            for tag in touched_tags {
                catalog.contents.remove(&format!("tag:{tag}"));
                if let Some(passage_ids) = catalog.tag_usage.get(&tag) {
                    let entry = basic_tag_contents_entry(story, &tag, passage_ids);
                    catalog.contents.insert(entry.id.clone(), entry);
                }
            }

            catalog.facets = contents_facets(catalog.contents.values());
            catalog.revision = revision;
            self.contents_catalog_cache
                .insert(story_id.clone(), catalog);
        }

        if (delta.top_before.is_some()
            || delta.project_layout.is_some()
            || !delta.layout_passages.is_empty())
            && delta.stories.is_empty()
        {
            for catalog in self.contents_catalog_cache.values_mut() {
                catalog.revision = revision;
            }
        }
    }

    fn update_read_model_cache(&mut self, delta: &ProjectDelta) {
        let revision = self.revision();

        for story_delta in &delta.stories {
            let graph_facts_changed = ProjectDelta::graph_facts_changed(story_delta);
            let (after, before, passages, story_id) = match story_delta {
                StoryDelta::Replace { story_id, .. } => {
                    self.read_model_cache.remove(story_id);
                    continue;
                }
                StoryDelta::Update {
                    after,
                    before,
                    passages,
                    story_id,
                } => (after, before, passages, story_id),
            };
            let Some(mut cache) = self.read_model_cache.remove(story_id) else {
                continue;
            };

            if !read_model_delta_is_incremental(after, before, passages) {
                self.read_model_last_touched_source_count = 0;
                continue;
            }

            let Some(story) = self
                .project
                .stories
                .iter()
                .find(|story| &story.id == story_id)
            else {
                continue;
            };
            let mut touched_source_ids = passages
                .iter()
                .map(|passage| passage.passage_id.as_ref().to_owned())
                .collect::<BTreeSet<_>>();
            let touched_passage_source_ids = passages
                .iter()
                .filter(|passage| match (&passage.before, &passage.after) {
                    (Some(before), Some(after)) => before.value.text != after.value.text,
                    _ => true,
                })
                .map(|passage| passage.passage_id.as_ref().to_owned())
                .collect::<BTreeSet<_>>();

            if before.script != after.script {
                touched_source_ids.insert(format!("{}:script", story_id.as_ref()));
            }
            if before.stylesheet != after.stylesheet {
                touched_source_ids.insert(format!("{}:stylesheet", story_id.as_ref()));
            }
            let mut assets_changed = false;
            let mut symbols_changed = false;

            for passage in passages {
                if let Some(before) = &passage.before {
                    cache.character_count = cache
                        .character_count
                        .saturating_sub(utf16_len(&before.value.text));
                    cache.word_count = cache
                        .word_count
                        .saturating_sub(before.value.text.split_whitespace().count());
                }
                if let Some(after) = &passage.after {
                    cache.character_count += utf16_len(&after.value.text);
                    cache.word_count += after.value.text.split_whitespace().count();
                }
            }

            let mut touched_tags = BTreeSet::new();
            for passage in passages {
                let (Some(before), Some(after)) = (&passage.before, &passage.after) else {
                    continue;
                };
                if before.value.tags == after.value.tags {
                    continue;
                }
                let passage_id = passage.passage_id.as_ref().to_owned();

                for tag in &before.value.tags {
                    touched_tags.insert(tag.clone());
                    let remove_tag = if let Some(passage_ids) = cache.tag_usage.get_mut(tag) {
                        passage_ids.remove(&passage_id);
                        passage_ids.is_empty()
                    } else {
                        false
                    };
                    if remove_tag {
                        cache.tag_usage.remove(tag);
                    }
                }
                for tag in &after.value.tags {
                    touched_tags.insert(tag.clone());
                    cache
                        .tag_usage
                        .entry(tag.clone())
                        .or_default()
                        .insert(passage_id.clone());
                }
            }

            for source_id in &touched_source_ids {
                let previous_assets = cache.assets_by_source.get(source_id).cloned();
                let previous_symbols = cache.symbols_by_source.get(source_id).cloned();
                let Some(analysis) = self
                    .analysis_cache
                    .get(story_id)
                    .and_then(|sources| sources.get(source_id))
                    .cloned()
                else {
                    cache.contents.remove(&format!("source:{source_id}"));
                    assets_changed |= cache.assets_by_source.remove(source_id).is_some();
                    symbols_changed |= cache.symbols_by_source.remove(source_id).is_some();
                    continue;
                };

                let file = &analysis.file;
                cache.contents.insert(
                    format!("source:{}", file.id),
                    CoreContentsEntry {
                        count: file.line_count,
                        detail: Some(format!("{} characters", file.character_count)),
                        id: format!("source:{}", file.id),
                        kind: match &file.kind {
                            CoreSourceKind::Passage => CoreContentsEntryKind::Passage,
                            CoreSourceKind::Script => CoreContentsEntryKind::Script,
                            CoreSourceKind::Stylesheet => CoreContentsEntryKind::Stylesheet,
                            CoreSourceKind::StoryMetadata => CoreContentsEntryKind::Metadata,
                        },
                        label: file.name.clone(),
                        passage_id: file.passage_id.clone(),
                        severity: None,
                        source_id: Some(file.id.clone()),
                    },
                );
                if analysis.assets.is_empty() {
                    cache.assets_by_source.remove(source_id);
                } else {
                    cache
                        .assets_by_source
                        .insert(source_id.clone(), analysis.assets);
                }
                assets_changed |= previous_assets != cache.assets_by_source.get(source_id).cloned();
                if analysis.symbols.is_empty() {
                    cache.symbols_by_source.remove(source_id);
                } else {
                    cache
                        .symbols_by_source
                        .insert(source_id.clone(), analysis.symbols);
                }
                symbols_changed |=
                    previous_symbols != cache.symbols_by_source.get(source_id).cloned();
            }

            for tag in touched_tags {
                cache.contents.remove(&format!("tag:{tag}"));
                if let Some(passage_ids) = cache.tag_usage.get(&tag) {
                    let entry = CoreContentsEntry {
                        count: passage_ids.len(),
                        detail: story.tag_colors.get(&tag).cloned(),
                        id: format!("tag:{tag}"),
                        kind: group_kind(&tag),
                        label: tag,
                        passage_id: passage_ids.first().cloned(),
                        severity: None,
                        source_id: passage_ids.first().cloned(),
                    };
                    cache.contents.insert(entry.id.clone(), entry);
                }
            }
            cache.tag_count = cache.tag_usage.len();
            cache.contents.insert(
                format!("metadata:{}", story.id.as_ref()),
                CoreContentsEntry {
                    count: story.passages.len(),
                    detail: Some(story.name.clone()),
                    id: format!("metadata:{}", story.id.as_ref()),
                    kind: CoreContentsEntryKind::Metadata,
                    label: "Story metadata".into(),
                    passage_id: None,
                    severity: None,
                    source_id: Some(format!("{}:metadata", story.id.as_ref())),
                },
            );
            cache.contents.insert(
                format!("format:{}", story.id.as_ref()),
                CoreContentsEntry {
                    count: 1,
                    detail: Some(format!(
                        "{} {}",
                        story.story_format, story.story_format_version
                    )),
                    id: format!("format:{}", story.id.as_ref()),
                    kind: CoreContentsEntryKind::Metadata,
                    label: "Story format".into(),
                    passage_id: None,
                    severity: None,
                    source_id: Some(format!("{}:metadata", story.id.as_ref())),
                },
            );
            for (tag, passage_ids) in &cache.tag_usage {
                let entry = CoreContentsEntry {
                    count: passage_ids.len(),
                    detail: story.tag_colors.get(tag).cloned(),
                    id: format!("tag:{tag}"),
                    kind: group_kind(tag),
                    label: tag.clone(),
                    passage_id: passage_ids.first().cloned(),
                    severity: None,
                    source_id: passage_ids.first().cloned(),
                };
                cache.contents.insert(entry.id.clone(), entry);
            }

            let graph_cache = self.graph_cache.get(story_id);
            let topology_changed = graph_facts_changed
                && graph_cache.is_some_and(|graph_cache| graph_cache.graph.last_topology_changed());

            refresh_read_model_aggregates(
                story,
                &mut cache,
                graph_cache,
                topology_changed,
                &touched_passage_source_ids,
                assets_changed,
                symbols_changed,
            );
            cache.revision = revision;
            self.read_model_incremental_update_count += 1;
            self.read_model_last_touched_source_count = touched_source_ids.len();
            self.read_model_cache.insert(story_id.clone(), cache);
        }

        if (delta.top_before.is_some()
            || delta.project_layout.is_some()
            || !delta.layout_passages.is_empty())
            && delta.stories.is_empty()
        {
            for cache in self.read_model_cache.values_mut() {
                cache.revision = revision;
            }
            self.read_model_last_touched_source_count = 0;
        }
    }

    fn update_session_caches(&mut self, delta: &ProjectDelta) {
        self.update_graph_cache(delta);
        self.update_backlink_cache(delta);
        self.update_contents_catalog_cache(delta);
        self.update_analysis_cache(delta);
        self.update_read_model_cache(delta);
    }

    fn update_backlink_cache(&mut self, delta: &ProjectDelta) {
        let revision = self.revision();

        for story_delta in &delta.stories {
            let (story_id, passages) = match story_delta {
                StoryDelta::Replace { story_id, .. } => {
                    self.backlink_cache.remove(story_id);
                    self.backlink_cache_lru
                        .retain(|(cached_story_id, _)| cached_story_id != story_id);
                    continue;
                }
                StoryDelta::Update {
                    story_id, passages, ..
                } => (story_id, passages),
            };
            if !self.backlink_cache.contains_key(story_id) {
                continue;
            }
            let structural_or_name_change =
                passages
                    .iter()
                    .any(|passage| match (&passage.before, &passage.after) {
                        (Some(before), Some(after)) => before.value.name != after.value.name,
                        _ => true,
                    });
            if structural_or_name_change {
                self.backlink_cache.remove(story_id);
                self.backlink_cache_lru
                    .retain(|(cached_story_id, _)| cached_story_id != story_id);
                continue;
            }

            let changed_source_ids = passages
                .iter()
                .filter(|passage| match (&passage.before, &passage.after) {
                    (Some(before), Some(after)) => before.value.text != after.value.text,
                    _ => true,
                })
                .map(|passage| passage.passage_id.clone())
                .collect::<BTreeSet<_>>();
            if changed_source_ids.is_empty() {
                if let Some(entries) = self.backlink_cache.get_mut(story_id) {
                    for entry in entries.values_mut() {
                        entry.revision = revision;
                    }
                }
                continue;
            }

            let (replacements, changed_ranks) = {
                let Some(story) = self
                    .project
                    .stories
                    .iter()
                    .find(|story| &story.id == story_id)
                else {
                    self.backlink_cache.remove(story_id);
                    continue;
                };
                let target_entries = self
                    .backlink_cache
                    .get(story_id)
                    .expect("backlink cache exists")
                    .iter()
                    .map(|(id, entry)| (id.clone(), entry.target_name.clone()))
                    .collect::<Vec<_>>();
                let target_ids = target_entries
                    .iter()
                    .map(|(target_id, _)| target_id.clone())
                    .collect::<BTreeSet<_>>();
                let changed_sources = changed_source_ids
                    .iter()
                    .filter_map(|source_id| {
                        Some((
                            story.passages.rank_of(source_id)?,
                            story.passage_by_id(source_id)?,
                        ))
                    })
                    .collect::<Vec<_>>();
                let changed_ranks = changed_sources
                    .iter()
                    .map(|(rank, _)| *rank)
                    .collect::<BTreeSet<_>>();
                let mut additions = BTreeMap::<PassageId, Vec<usize>>::new();

                for (source_rank, source) in changed_sources {
                    for edge in passage_link_edges(story, source) {
                        let Some(target_id) = edge.target else {
                            continue;
                        };
                        if edge.source != target_id && target_ids.contains(&target_id) {
                            additions.entry(target_id).or_default().push(source_rank);
                        }
                    }
                }
                (
                    target_entries
                        .into_iter()
                        .map(|(target_id, target_name)| {
                            let additions = additions.remove(&target_id).unwrap_or_default();
                            (target_id, target_name, additions)
                        })
                        .collect::<Vec<_>>(),
                    changed_ranks,
                )
            };

            if let Some(entries) = self.backlink_cache.get_mut(story_id) {
                for (target_id, target_name, additions) in replacements {
                    let Some(entry) = entries.get_mut(&target_id) else {
                        continue;
                    };
                    entry
                        .source_ranks
                        .retain(|source_rank| !changed_ranks.contains(source_rank));
                    entry.source_ranks.extend(additions);
                    entry.source_ranks.sort_unstable();
                    entry.byte_size = entry.source_ranks.len() * std::mem::size_of::<usize>();
                    entry.revision = revision;
                    entry.target_name = target_name;
                }
            }
        }
    }

    fn replace_all_text(
        &mut self,
        story_id: &str,
        query: CoreSearchQuery,
    ) -> Result<Vec<Patch>, CoreError> {
        if query.query.is_empty() {
            return Err(CoreError::UnsupportedCommand(
                "cannot replace an empty string".to_owned(),
            ));
        }
        if query.fuzzy {
            return Err(CoreError::UnsupportedCommand(
                "replace-all text does not support fuzzy replacement".to_owned(),
            ));
        }

        let pattern = if query.use_regexes {
            query.query.clone()
        } else {
            regex::escape(&query.query)
        };
        let pattern = regex::RegexBuilder::new(&pattern)
            .case_insensitive(!query.match_case)
            .build()
            .map_err(|error| CoreError::UnsupportedCommand(error.to_string()))?;
        let replacement = query.replacement.unwrap_or_default();
        let replace = |source: &str| {
            if query.use_regexes {
                pattern
                    .replace_all(source, replacement.as_str())
                    .into_owned()
            } else {
                pattern
                    .replace_all(source, |_: &regex::Captures<'_>| replacement.as_str())
                    .into_owned()
            }
        };
        let story = self
            .project
            .stories
            .iter()
            .find(|story| story.id.as_ref() == story_id)
            .ok_or_else(|| CoreError::StoryNotFound(story_id.to_owned()))?
            .clone();
        let mut commands = Vec::new();

        if query.include_passage_names {
            let renamed = story
                .passages
                .iter()
                .map(|passage| (passage.id.as_ref().to_owned(), replace(&passage.name)))
                .collect::<Vec<_>>();
            let mut names = BTreeSet::new();

            for (_, name) in &renamed {
                if name.trim().is_empty() {
                    return Err(CoreError::UnsupportedCommand(
                        "replacement would create an empty passage name".to_owned(),
                    ));
                }
                if !names.insert(name.clone()) {
                    return Err(CoreError::DuplicatePassageName(name.clone()));
                }
            }
            for (passage_id, name) in renamed {
                let passage = story
                    .passages
                    .iter()
                    .find(|passage| passage.id.as_ref() == passage_id)
                    .expect("replacement passage should exist");

                if name != passage.name {
                    commands.push(StoryCommand::RenamePassage {
                        name,
                        passage_id,
                        story_id: story_id.to_owned(),
                        update_references: true,
                    });
                }
            }
        }

        if query.include_passage_text {
            for passage in story.passages.iter() {
                let text = replace(&passage.text);

                if text != passage.text {
                    commands.push(StoryCommand::UpdatePassageText {
                        passage_id: passage.id.as_ref().to_owned(),
                        story_id: story_id.to_owned(),
                        text,
                    });
                }
            }
        }
        if query.include_script {
            let script = replace(&story.script);

            if script != story.script {
                commands.push(StoryCommand::UpdateStoryScript {
                    script,
                    story_id: story_id.to_owned(),
                });
            }
        }
        if query.include_stylesheet {
            let stylesheet = replace(&story.stylesheet);

            if stylesheet != story.stylesheet {
                commands.push(StoryCommand::UpdateStoryStylesheet {
                    story_id: story_id.to_owned(),
                    stylesheet,
                });
            }
        }

        self.apply_without_transaction(StoryCommand::Batch { commands })
    }

    fn apply_without_transaction(
        &mut self,
        command: StoryCommand,
    ) -> Result<Vec<Patch>, CoreError> {
        match command {
            StoryCommand::Batch { commands } => {
                let mut patches = Vec::new();

                for command in commands {
                    patches.extend(self.apply_without_transaction(command)?);
                }

                Ok(patches)
            }
            StoryCommand::CopyAssetSnippet {
                path,
                snippet,
                story_id,
            } => self.copy_asset_snippet(&story_id, &path, snippet),
            StoryCommand::CreateStory { story } => self.create_story(story),
            StoryCommand::CreatePassage {
                id,
                layout,
                name,
                story_id,
                tags,
                text,
            } => self.create_passage(story_id, id, name, text, tags, layout),
            StoryCommand::DeletePassages {
                story_id,
                passage_ids,
            } => self.delete_passages(&story_id, &passage_ids),
            StoryCommand::DeleteStory { story_id } => self.delete_story(&story_id),
            StoryCommand::DeleteAsset {
                path,
                remove_references,
                story_id,
            } => self.delete_asset(&story_id, &path, remove_references),
            StoryCommand::ImportAsset {
                overwrite,
                source_path,
                story_id,
                target_path,
            } => self.import_asset(&story_id, &source_path, target_path, overwrite),
            StoryCommand::InsertAssetSnippet {
                passage_id,
                path,
                position,
                snippet,
                source_id,
                story_id,
            } => self.insert_asset_snippet(
                &story_id,
                &path,
                &source_id,
                passage_id.as_deref(),
                position,
                snippet,
            ),
            StoryCommand::MovePassages { story_id, moves } => self.move_passages(&story_id, moves),
            StoryCommand::QueryGraphProjection { story_id, options } => {
                let projection = self.graph_projection(&story_id, options)?;

                Ok(vec![Patch::GraphProjectionUpdated {
                    projection,
                    story_id,
                }])
            }
            StoryCommand::QueryStoryIndex { story_id, options } => {
                let index = self.story_index(&story_id, options)?;

                Ok(vec![Patch::StoryIndexUpdated { index, story_id }])
            }
            StoryCommand::RenamePassage {
                name,
                passage_id,
                story_id,
                update_references,
            } => self.rename_passage(&story_id, &passage_id, name, update_references),
            StoryCommand::RenamePassageTag {
                new_name,
                old_name,
                story_id,
            } => self.rename_passage_tag(&story_id, &old_name, new_name),
            StoryCommand::RenameStory { name, story_id } => self.rename_story(&story_id, name),
            StoryCommand::RenameStoryTag { new_name, old_name } => {
                self.rename_story_tag(&old_name, new_name)
            }
            StoryCommand::RenameAsset {
                new_path,
                path,
                story_id,
                update_references,
            } => self.rename_asset(&story_id, &path, &new_path, update_references),
            StoryCommand::ReplaceAsset {
                path,
                source_path,
                story_id,
            } => self.replace_asset(&story_id, &path, &source_path),
            StoryCommand::ReplaceAllText { query, story_id } => {
                self.replace_all_text(&story_id, query)
            }
            StoryCommand::ReplaceStory { story, story_id } => self.replace_story(&story_id, story),
            StoryCommand::RevealAsset { path, story_id } => self.reveal_asset(&story_id, &path),
            StoryCommand::RestorePassages { story_id, passages } => {
                self.restore_passages(&story_id, passages)
            }
            StoryCommand::SaveGeneratedLayout { story_id } => self.save_generated_layout(&story_id),
            StoryCommand::SetPassageTags {
                passage_id,
                story_id,
                tags,
            } => self.set_passage_tags(&story_id, &passage_id, tags),
            StoryCommand::SetStartPassage {
                passage_id,
                story_id,
            } => self.set_start_passage(&story_id, &passage_id),
            StoryCommand::SetStoryTagColor {
                color,
                name,
                story_id,
            } => self.set_story_tag_color(&story_id, name, color),
            StoryCommand::SetStoryTags { story_id, tags } => self.set_story_tags(&story_id, tags),
            StoryCommand::SetStoryFormat {
                story_format,
                story_format_version,
                story_id,
            } => self.set_story_format(&story_id, story_format, story_format_version),
            StoryCommand::SetStorySnapToGrid { enabled, story_id } => {
                self.set_story_snap_to_grid(&story_id, enabled)
            }
            StoryCommand::SetStoryZoom { story_id, zoom } => self.set_story_zoom(&story_id, zoom),
            StoryCommand::UpdatePassageText {
                passage_id,
                story_id,
                text,
            } => self.update_passage_text(&story_id, &passage_id, text),
            StoryCommand::UpdatePassage {
                changes,
                passage_id,
                story_id,
                update_references,
            } => self.update_passage(&story_id, &passage_id, changes, update_references),
            StoryCommand::UpdateStoryScript { script, story_id } => {
                self.update_story_script(&story_id, script)
            }
            StoryCommand::UpdateStoryStylesheet {
                story_id,
                stylesheet,
            } => self.update_story_stylesheet(&story_id, stylesheet),
            StoryCommand::ValidateAssetReferences { story_id } => {
                self.validate_asset_references(&story_id)
            }
        }
    }

    fn create_passage(
        &mut self,
        story_id: String,
        id: Option<String>,
        name: Option<String>,
        text: String,
        tags: Vec<String>,
        layout: Option<CoreRect>,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(&story_id)?;
        let story_id_model = story.id.clone();
        let id = PassageId::new(id.unwrap_or_else(|| next_passage_id(story)));
        let name = name.unwrap_or_else(|| unique_passage_name(story, "Untitled Passage"));
        let bounds = layout.map(GraphPosition::from);

        if story.passages.id_for_name(&name).is_some() {
            return Err(CoreError::DuplicatePassageName(name));
        }

        let passage = Passage {
            custom_attributes: BTreeMap::new(),
            id: id.clone(),
            layout: bounds,
            metadata: BTreeMap::new(),
            name,
            source_pid: None,
            story: story.id.clone(),
            tags,
            text,
        };

        story.passages.insert(passage.clone());
        if story.start_passage.as_ref().is_empty() {
            story.start_passage = id;
        }

        if let Some(bounds) = bounds {
            self.project
                .layout
                .passages
                .set_bounds(story_id_model, passage.id.clone(), bounds);
        }

        Ok(vec![Patch::PassageCreated {
            passage: PassageSnapshot::from(&passage),
            story_id,
        }])
    }

    fn create_story(&mut self, story: StorySnapshot) -> Result<Vec<Patch>, CoreError> {
        if self
            .project
            .stories
            .iter()
            .any(|existing| existing.id.as_ref() == story.id)
        {
            return Err(CoreError::DuplicateStoryId(story.id));
        }

        if self
            .project
            .stories
            .iter()
            .any(|existing| existing.name.eq_ignore_ascii_case(&story.name))
        {
            return Err(CoreError::DuplicateStoryName(story.name));
        }

        let story = story.into_story();
        let snapshot = StorySnapshot::from(&story);
        let story_layout = GraphLayout::from_story_layout(&story).passages;

        self.project.stories.push(story);
        self.project.layout.passages.append(story_layout);
        Ok(vec![Patch::StoryCreated { story: snapshot }])
    }

    fn delete_story(&mut self, story_id: &str) -> Result<Vec<Patch>, CoreError> {
        let initial_len = self.project.stories.len();
        let story_id_model = StoryId::new(story_id);

        self.project
            .stories
            .retain(|story| story.id.as_ref() != story_id);

        if self.project.stories.len() == initial_len {
            return Err(CoreError::StoryNotFound(story_id.to_owned()));
        }

        self.project.layout.passages.remove_story(&story_id_model);

        Ok(vec![Patch::StoryDeleted {
            story_id: story_id.to_owned(),
        }])
    }

    fn replace_story(
        &mut self,
        story_id: &str,
        story: StorySnapshot,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = story.into_story();
        let before = self.project.clone();
        let replacement = Story {
            id: StoryId::new(story_id),
            passages: story
                .passages
                .iter()
                .cloned()
                .map(|mut passage| {
                    passage.story = StoryId::new(story_id);
                    passage
                })
                .collect(),
            ..story
        };
        let replacement_layout = GraphLayout::from_story_layout(&replacement).passages;

        *self.story_mut(story_id)? = replacement;
        self.project
            .layout
            .passages
            .remove_story(&StoryId::new(story_id));
        self.project.layout.passages.append(replacement_layout);

        Ok(project_diff_patches(&before, &self.project))
    }

    fn delete_passages(
        &mut self,
        story_id: &str,
        passage_ids: &[String],
    ) -> Result<Vec<Patch>, CoreError> {
        let ids = passage_ids
            .iter()
            .map(PassageId::new)
            .collect::<BTreeSet<_>>();
        let story = self.story_mut(story_id)?;
        let existing_ids = story
            .passages
            .iter()
            .map(|passage| passage.id.clone())
            .collect::<BTreeSet<_>>();

        if let Some(missing) = ids.iter().find(|id| !existing_ids.contains(*id)) {
            return Err(CoreError::PassageNotFound(missing.as_ref().to_owned()));
        }

        let remaining = story
            .passages
            .iter()
            .filter(|passage| !ids.contains(&passage.id))
            .cloned()
            .collect::<Vec<_>>();

        story.passages = PassageIndex::from(remaining);

        if ids.contains(&story.start_passage) {
            story.start_passage = story
                .passages
                .first()
                .map(|passage| passage.id.clone())
                .unwrap_or_default();
        }

        let story_id_model = StoryId::new(story_id);

        for passage_id in &ids {
            self.project
                .layout
                .passages
                .remove(&story_id_model, passage_id);
        }

        Ok(passage_ids
            .iter()
            .map(|passage_id| Patch::PassageDeleted {
                passage_id: passage_id.clone(),
                story_id: story_id.to_owned(),
            })
            .collect())
    }

    pub fn graph_projection(
        &mut self,
        story_id: &str,
        options: CoreGraphProjectionOptions,
    ) -> Result<CoreGraphProjection, CoreError> {
        let story_id = StoryId::new(story_id);

        if !self.graph_cache.contains_key(&story_id) {
            let (graph, layout) = {
                let story = self.story(story_id.as_ref())?;
                let graph = GraphIndex::from_story(story);
                let layout = graph.layout_snapshot(
                    story,
                    &self.project.layout,
                    &AutoLayoutOptions::default(),
                );

                (graph, layout)
            };

            self.graph_cache
                .insert(story_id.clone(), GraphSessionCache { graph, layout });
        }

        let cache = self
            .graph_cache
            .get(&story_id)
            .expect("graph cache should be populated");
        let projection = cache
            .graph
            .canvas_projection_from_snapshot(&cache.layout, &options.into());

        Ok(projection.into())
    }

    fn save_generated_layout(&mut self, story_id: &str) -> Result<Vec<Patch>, CoreError> {
        let snapshot = {
            let story = self.story(story_id)?;
            let graph = GraphIndex::from_story(story);

            graph.layout_snapshot(story, &self.project.layout, &AutoLayoutOptions::default())
        };
        let mut patches = Vec::new();

        for (passage_id, entry) in snapshot.passages {
            self.project.layout.passages.set_bounds(
                StoryId::new(story_id),
                passage_id.clone(),
                entry.bounds,
            );

            {
                let story = self.story_mut(story_id)?;
                let passage = story
                    .passage_by_id_mut(&passage_id)
                    .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;

                if passage.layout == Some(entry.bounds) {
                    continue;
                }

                passage.layout = Some(entry.bounds);
            }

            patches.push(Patch::PassageUpdated {
                changes: PassagePatch {
                    layout: Some(entry.bounds.into()),
                    ..PassagePatch::default()
                },
                passage_id: passage_id.as_ref().to_owned(),
                story_id: story_id.to_owned(),
            });
        }

        self.refresh_graph_layout(&StoryId::new(story_id));
        let projection = self.graph_projection(story_id, CoreGraphProjectionOptions::default())?;

        patches.push(Patch::LayoutSaved {
            projection,
            story_id: story_id.to_owned(),
        });
        Ok(patches)
    }

    fn move_passages(
        &mut self,
        story_id: &str,
        moves: Vec<PassageMove>,
    ) -> Result<Vec<Patch>, CoreError> {
        let mut patches = Vec::new();

        for passage_move in moves {
            let passage_id = PassageId::new(&passage_move.passage_id);
            let bounds = GraphPosition::from(passage_move.bounds);

            {
                let story = self.story_mut(story_id)?;
                let passage = story
                    .passage_by_id_mut(&passage_id)
                    .ok_or_else(|| CoreError::PassageNotFound(passage_move.passage_id.clone()))?;

                passage.layout = Some(bounds);
            }

            self.project
                .layout
                .passages
                .set_bounds(StoryId::new(story_id), passage_id, bounds);
            patches.push(Patch::PassageUpdated {
                changes: PassagePatch {
                    layout: Some(bounds.into()),
                    ..PassagePatch::default()
                },
                passage_id: passage_move.passage_id,
                story_id: story_id.to_owned(),
            });
        }

        Ok(patches)
    }

    fn rename_passage(
        &mut self,
        story_id: &str,
        passage_id: &str,
        name: String,
        update_references: bool,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;
        let passage_id = PassageId::new(passage_id);

        if story
            .passages
            .id_for_name(&name)
            .is_some_and(|existing_id| existing_id != &passage_id)
        {
            return Err(CoreError::DuplicatePassageName(name));
        }

        let passage = story
            .passage_by_id_mut(&passage_id)
            .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;
        let old_name = std::mem::replace(&mut passage.name, name.clone());
        let mut patches = vec![Patch::PassageUpdated {
            changes: PassagePatch {
                name: Some(name.clone()),
                ..PassagePatch::default()
            },
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.to_owned(),
        }];

        story.passages.rebuild_name_index();

        if update_references {
            for passage in story.passages.iter_mut() {
                let rewritten = replace_standard_link_targets(&passage.text, &old_name, &name);

                if rewritten != passage.text {
                    passage.text = rewritten;
                    patches.push(Patch::PassageUpdated {
                        changes: PassagePatch {
                            text: Some(passage.text.clone()),
                            ..PassagePatch::default()
                        },
                        passage_id: passage.id.as_ref().to_owned(),
                        story_id: story_id.to_owned(),
                    });
                }
            }
        }

        Ok(patches)
    }

    fn update_passage(
        &mut self,
        story_id: &str,
        passage_id: &str,
        changes: PassagePatch,
        update_references: bool,
    ) -> Result<Vec<Patch>, CoreError> {
        let mut patches = Vec::new();

        if let Some(name) = changes.name {
            patches.extend(self.rename_passage(story_id, passage_id, name, update_references)?);
        }

        if let Some(text) = changes.text {
            patches.extend(self.update_passage_text(story_id, passage_id, text)?);
        }

        if let Some(tags) = changes.tags {
            patches.extend(self.set_passage_tags(story_id, passage_id, tags)?);
        }

        if let Some(layout) = changes.layout {
            patches.extend(self.move_passages(
                story_id,
                vec![PassageMove {
                    bounds: layout,
                    passage_id: passage_id.to_owned(),
                }],
            )?);
        }

        Ok(patches)
    }

    fn restore_passages(
        &mut self,
        story_id: &str,
        passages: Vec<PassageSnapshot>,
    ) -> Result<Vec<Patch>, CoreError> {
        let story_id_model = self.story(story_id)?.id.clone();
        let mut patches = Vec::new();

        for passage in passages {
            let restored = passage.into_passage(&story_id_model);
            let bounds = restored.layout;

            self.story_mut(story_id)?.passages.insert(restored.clone());
            if let Some(bounds) = bounds {
                self.project.layout.passages.set_bounds(
                    story_id_model.clone(),
                    restored.id.clone(),
                    bounds,
                );
            } else {
                self.project
                    .layout
                    .passages
                    .remove(&story_id_model, &restored.id);
            }
            patches.push(Patch::PassageCreated {
                passage: PassageSnapshot::from(&restored),
                story_id: story_id.to_owned(),
            });
        }

        Ok(patches)
    }

    fn set_passage_tags(
        &mut self,
        story_id: &str,
        passage_id: &str,
        tags: Vec<String>,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;
        let passage_id = PassageId::new(passage_id);
        let passage = story
            .passage_by_id_mut(&passage_id)
            .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;

        passage.tags = tags.clone();
        Ok(vec![Patch::PassageUpdated {
            changes: PassagePatch {
                tags: Some(tags),
                ..PassagePatch::default()
            },
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.to_owned(),
        }])
    }

    fn set_start_passage(
        &mut self,
        story_id: &str,
        passage_id: &str,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;
        let passage_id = PassageId::new(passage_id);

        if story.passage_by_id(&passage_id).is_none() {
            return Err(CoreError::PassageNotFound(passage_id.as_ref().to_owned()));
        }

        story.start_passage = passage_id.clone();
        Ok(vec![Patch::StartPassageChanged {
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.to_owned(),
        }])
    }

    fn rename_story(&mut self, story_id: &str, name: String) -> Result<Vec<Patch>, CoreError> {
        {
            let story = self.story_mut(story_id)?;

            if story.name == name {
                return Ok(Vec::new());
            }

            story.name = name.clone();
        }

        Ok(vec![Patch::StoryMetadataUpdated {
            changes: StoryMetadataPatch {
                name: Some(name),
                ..StoryMetadataPatch::default()
            },
            story_id: story_id.to_owned(),
        }])
    }

    fn rename_passage_tag(
        &mut self,
        story_id: &str,
        old_name: &str,
        new_name: String,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;
        let mut patches = Vec::new();

        for passage in story.passages.iter_mut() {
            if passage.tags.iter().any(|tag| tag == old_name) {
                passage.tags = passage
                    .tags
                    .iter()
                    .map(|tag| {
                        if tag == old_name {
                            new_name.clone()
                        } else {
                            tag.clone()
                        }
                    })
                    .collect();
                patches.push(Patch::PassageUpdated {
                    changes: PassagePatch {
                        tags: Some(passage.tags.clone()),
                        ..PassagePatch::default()
                    },
                    passage_id: passage.id.as_ref().to_owned(),
                    story_id: story_id.to_owned(),
                });
            }
        }

        if !patches.is_empty() && story.tag_colors.contains_key(old_name) {
            let mut tag_colors = story.tag_colors.clone();

            if let Some(color) = tag_colors.remove(old_name) {
                tag_colors.insert(new_name, color);
            }

            story.tag_colors = tag_colors.clone();
            patches.push(Patch::StoryMetadataUpdated {
                changes: StoryMetadataPatch {
                    tag_colors: Some(tag_colors),
                    ..StoryMetadataPatch::default()
                },
                story_id: story_id.to_owned(),
            });
        }

        Ok(patches)
    }

    fn rename_story_tag(
        &mut self,
        old_name: &str,
        new_name: String,
    ) -> Result<Vec<Patch>, CoreError> {
        let mut patches = Vec::new();

        for story in &mut self.project.stories {
            if story.tags.iter().any(|tag| tag == old_name) {
                story.tags = story
                    .tags
                    .iter()
                    .map(|tag| {
                        if tag == old_name {
                            new_name.clone()
                        } else {
                            tag.clone()
                        }
                    })
                    .collect();
                patches.push(Patch::StoryMetadataUpdated {
                    changes: StoryMetadataPatch {
                        tags: Some(story.tags.clone()),
                        ..StoryMetadataPatch::default()
                    },
                    story_id: story.id.as_ref().to_owned(),
                });
            }
        }

        Ok(patches)
    }

    fn set_story_format(
        &mut self,
        story_id: &str,
        story_format: String,
        story_format_version: String,
    ) -> Result<Vec<Patch>, CoreError> {
        {
            let story = self.story_mut(story_id)?;

            if story.story_format == story_format
                && story.story_format_version == story_format_version
            {
                return Ok(Vec::new());
            }

            story.story_format = story_format.clone();
            story.story_format_version = story_format_version.clone();
        }

        Ok(vec![Patch::StoryMetadataUpdated {
            changes: StoryMetadataPatch {
                story_format: Some(story_format),
                story_format_version: Some(story_format_version),
                ..StoryMetadataPatch::default()
            },
            story_id: story_id.to_owned(),
        }])
    }

    fn set_story_snap_to_grid(
        &mut self,
        story_id: &str,
        enabled: bool,
    ) -> Result<Vec<Patch>, CoreError> {
        {
            let story = self.story_mut(story_id)?;

            if story.snap_to_grid == enabled {
                return Ok(Vec::new());
            }

            story.snap_to_grid = enabled;
        }

        Ok(vec![Patch::StoryMetadataUpdated {
            changes: StoryMetadataPatch {
                snap_to_grid: Some(enabled),
                ..StoryMetadataPatch::default()
            },
            story_id: story_id.to_owned(),
        }])
    }

    fn set_story_tag_color(
        &mut self,
        story_id: &str,
        name: String,
        color: Option<String>,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;
        let mut tag_colors = story.tag_colors.clone();

        match color {
            Some(color) => {
                tag_colors.insert(name, color);
            }
            None => {
                tag_colors.remove(&name);
            }
        }

        if story.tag_colors == tag_colors {
            return Ok(Vec::new());
        }

        story.tag_colors = tag_colors.clone();
        Ok(vec![Patch::StoryMetadataUpdated {
            changes: StoryMetadataPatch {
                tag_colors: Some(tag_colors),
                ..StoryMetadataPatch::default()
            },
            story_id: story_id.to_owned(),
        }])
    }

    fn set_story_tags(
        &mut self,
        story_id: &str,
        tags: Vec<String>,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;

        if story.tags == tags {
            return Ok(Vec::new());
        }

        story.tags = tags.clone();
        Ok(vec![Patch::StoryMetadataUpdated {
            changes: StoryMetadataPatch {
                tags: Some(tags),
                ..StoryMetadataPatch::default()
            },
            story_id: story_id.to_owned(),
        }])
    }

    fn set_story_zoom(&mut self, story_id: &str, zoom: f64) -> Result<Vec<Patch>, CoreError> {
        {
            let story = self.story_mut(story_id)?;

            if (story.zoom - zoom).abs() <= f64::EPSILON {
                return Ok(Vec::new());
            }

            story.zoom = zoom;
        }

        Ok(vec![Patch::StoryMetadataUpdated {
            changes: StoryMetadataPatch {
                zoom: Some(zoom),
                ..StoryMetadataPatch::default()
            },
            story_id: story_id.to_owned(),
        }])
    }

    #[allow(clippy::too_many_arguments)]
    fn source_analysis(
        &mut self,
        story_id: &StoryId,
        source_id: &str,
        name: &str,
        source: &str,
        kind: CoreSourceKind,
        passage_id: Option<&str>,
        tags: &[String],
        scope: CoreSearchScope,
    ) -> SourceAnalysisCache {
        let story_cache = self.analysis_cache.entry(story_id.clone()).or_default();
        let source_fingerprint = source_fingerprint(source);

        if let Some(cached) = story_cache.get(source_id)
            && cached.name == name
            && cached.source_fingerprint == source_fingerprint
            && cached.tags == tags
        {
            return cached.clone();
        }

        let analysis = SourceAnalysisCache {
            assets: asset_references_in_source(source_id, name, source, passage_id),
            file: CoreSourceFile {
                character_count: utf16_len(source),
                id: source_id.to_owned(),
                kind,
                line_count: line_count(source),
                name: name.to_owned(),
                passage_id: passage_id.map(str::to_owned),
                tags: tags.to_vec(),
            },
            name: name.to_owned(),
            source_fingerprint,
            symbols: symbols_in_source(source_id, name, source, scope, passage_id),
            tags: tags.to_vec(),
        };

        story_cache.insert(source_id.to_owned(), analysis.clone());
        self.analysis_parse_count += 1;
        analysis
    }

    pub fn story_index(
        &mut self,
        story_id: &str,
        options: CoreStoryIndexOptions,
    ) -> Result<CoreStoryIndex, CoreError> {
        let story = self.story(story_id)?.clone();
        let graph_required =
            options.include_graph || options.include_diagnostics || options.include_contents;
        let metadata_source_id = format!("{}:metadata", story.id.as_ref());
        let script_source_id = format!("{}:script", story.id.as_ref());
        let stylesheet_source_id = format!("{}:stylesheet", story.id.as_ref());
        let search_enabled = has_search_query(&options);
        let search_pattern = search_pattern(&options);
        let mut diagnostics = Vec::new();
        let mut files = Vec::new();
        let mut tag_usage = BTreeMap::<String, BTreeSet<String>>::new();
        let mut search_hits = Vec::new();
        let mut symbols = Vec::new();
        let mut assets = Vec::new();

        let mut active_source_ids = BTreeSet::new();

        for passage in story.passages.iter() {
            active_source_ids.insert(passage.id.as_ref().to_owned());
            let analysis = self.source_analysis(
                &story.id,
                passage.id.as_ref(),
                &passage.name,
                &passage.text,
                CoreSourceKind::Passage,
                Some(passage.id.as_ref()),
                &passage.tags,
                CoreSearchScope::PassageText,
            );

            for tag in &passage.tags {
                tag_usage
                    .entry(tag.clone())
                    .or_default()
                    .insert(passage.id.as_ref().to_owned());
            }

            if options.include_files {
                files.push(analysis.file.clone());
            }

            if search_enabled && options.include_passage_names {
                search_hits.extend(search_hits_in_source(
                    &options,
                    search_pattern.as_ref(),
                    passage.id.as_ref(),
                    &passage.name,
                    &passage.name,
                    CoreSearchScope::PassageName,
                    Some(passage.id.as_ref()),
                ));
            }

            if search_enabled && options.include_passage_text {
                search_hits.extend(search_hits_in_source(
                    &options,
                    search_pattern.as_ref(),
                    passage.id.as_ref(),
                    &passage.name,
                    &passage.text,
                    CoreSearchScope::PassageText,
                    Some(passage.id.as_ref()),
                ));
            }

            if search_enabled && options.include_tags {
                for tag in &passage.tags {
                    search_hits.extend(search_hits_in_source(
                        &options,
                        search_pattern.as_ref(),
                        passage.id.as_ref(),
                        &passage.name,
                        tag,
                        CoreSearchScope::PassageTag,
                        Some(passage.id.as_ref()),
                    ));
                }
            }

            if options.include_variables {
                symbols.extend(analysis.symbols.clone());
            }

            if options.include_assets {
                assets.extend(analysis.assets);
            }
        }

        active_source_ids.insert(script_source_id.clone());
        active_source_ids.insert(stylesheet_source_id.clone());
        let script_analysis = self.source_analysis(
            &story.id,
            &script_source_id,
            "Story JavaScript",
            &story.script,
            CoreSourceKind::Script,
            None,
            &[],
            CoreSearchScope::Script,
        );
        let stylesheet_analysis = self.source_analysis(
            &story.id,
            &stylesheet_source_id,
            "Story Stylesheet",
            &story.stylesheet,
            CoreSourceKind::Stylesheet,
            None,
            &[],
            CoreSearchScope::Stylesheet,
        );
        if let Some(cache) = self.analysis_cache.get_mut(&story.id) {
            cache.retain(|source_id, _| active_source_ids.contains(source_id));
        }

        if options.include_files {
            files.push(script_analysis.file.clone());
            files.push(stylesheet_analysis.file.clone());
        }

        if search_enabled
            && options.include_diagnostics
            && let Err(error) = &search_pattern
        {
            diagnostics.push(CoreDiagnostic {
                code: "invalid-search-regex".into(),
                end: options.query.as_ref().map_or(0, String::len),
                line: 1,
                message: format!("Search regular expression is invalid: {error}"),
                passage_id: None,
                quick_fixes: vec![CoreQuickFix {
                    command: "disable-regex-search".into(),
                    title: "Turn off regular expressions".into(),
                }],
                severity: CoreDiagnosticSeverity::Error,
                source_id: metadata_source_id.clone(),
                start: 0,
            });
        }

        if search_enabled {
            let metadata_source = story_metadata_source(&story);
            search_hits.extend(search_hits_in_source(
                &options,
                search_pattern.as_ref(),
                &metadata_source_id,
                "Story Metadata",
                &metadata_source,
                CoreSearchScope::Metadata,
                None,
            ));
        }

        if search_enabled && options.include_script {
            search_hits.extend(search_hits_in_source(
                &options,
                search_pattern.as_ref(),
                &script_source_id,
                "Story JavaScript",
                &story.script,
                CoreSearchScope::Script,
                None,
            ));
        }

        if search_enabled && options.include_stylesheet {
            search_hits.extend(search_hits_in_source(
                &options,
                search_pattern.as_ref(),
                &stylesheet_source_id,
                "Story Stylesheet",
                &story.stylesheet,
                CoreSearchScope::Stylesheet,
                None,
            ));
        }

        if options.include_variables {
            symbols.extend(script_analysis.symbols.clone());
            symbols.extend(stylesheet_analysis.symbols.clone());
        }

        if options.include_assets {
            assets.extend(script_analysis.assets);
            assets.extend(stylesheet_analysis.assets);
        }

        if graph_required {
            self.ensure_graph_cache(&story.id)?;
        }
        let graph = graph_required
            .then(|| self.graph_cache.get(&story.id).map(|cache| &cache.graph))
            .flatten();

        let mut asset_inventory = if options.include_assets {
            let known_assets = self.known_asset_inventory(&options.known_assets)?;

            asset_inventory_from_references(
                &assets,
                known_assets,
                self.asset_root.is_some() || options.asset_scan_complete,
            )
        } else {
            Vec::new()
        };

        if search_enabled && options.include_variables {
            for symbol in &symbols {
                search_hits.extend(search_hits_in_source(
                    &options,
                    search_pattern.as_ref(),
                    &symbol.source_id,
                    &symbol.source_name,
                    &symbol.name,
                    CoreSearchScope::Variable,
                    symbol.passage_id.as_deref(),
                ));
            }
        }

        if search_enabled && options.include_assets {
            for asset in &asset_inventory {
                let location = asset_search_location(&story, asset);

                search_hits.extend(search_hits_in_source(
                    &options,
                    search_pattern.as_ref(),
                    &location.source_id,
                    &location.source_name,
                    &asset.path,
                    CoreSearchScope::Asset,
                    location.passage_id.as_deref(),
                ));
            }
        }

        if options.include_diagnostics {
            if let Some(graph) = &graph {
                for broken_link in graph.broken_links() {
                    let (line, start, end) = story
                        .passage_by_id(&broken_link.source)
                        .and_then(|passage| {
                            locate_link_target(&passage.text, &broken_link.target_name)
                        })
                        .unwrap_or((1, 0, broken_link.target_name.len()));

                    diagnostics.push(CoreDiagnostic {
                        code: "broken-link".into(),
                        end,
                        line,
                        message: format!("Broken link to \"{}\"", broken_link.target_name),
                        passage_id: Some(broken_link.source.as_ref().to_owned()),
                        quick_fixes: vec![
                            CoreQuickFix {
                                command: format!("create-passage:{}", broken_link.target_name),
                                title: format!("Create \"{}\"", broken_link.target_name),
                            },
                            CoreQuickFix {
                                command: "rename-link-target".into(),
                                title: "Change link target".into(),
                            },
                        ],
                        severity: CoreDiagnosticSeverity::Warning,
                        source_id: broken_link.source.as_ref().to_owned(),
                        start,
                    });
                }
            }

            for duplicate in duplicate_passage_names(&story) {
                diagnostics.push(CoreDiagnostic {
                    code: "duplicate-passage-name".into(),
                    end: duplicate.name.len(),
                    line: 1,
                    message: format!("Duplicate passage name \"{}\"", duplicate.name),
                    passage_id: Some(duplicate.passage_id.clone()),
                    quick_fixes: vec![CoreQuickFix {
                        command: "rename-passage".into(),
                        title: "Rename passage".into(),
                    }],
                    severity: CoreDiagnosticSeverity::Error,
                    source_id: duplicate.passage_id,
                    start: 0,
                });
            }

            if story.passage_by_id(&story.start_passage).is_none() {
                diagnostics.push(CoreDiagnostic {
                    code: "missing-start-passage".into(),
                    end: 0,
                    line: 1,
                    message: "Story start passage is missing".into(),
                    passage_id: None,
                    quick_fixes: vec![CoreQuickFix {
                        command: "set-start-passage".into(),
                        title: "Choose a start passage".into(),
                    }],
                    severity: CoreDiagnosticSeverity::Error,
                    source_id: metadata_source_id.clone(),
                    start: 0,
                });
            }

            diagnostics.extend(asset_diagnostics(
                &story,
                &metadata_source_id,
                &asset_inventory,
            ));
        }

        asset_inventory.sort_by(|left, right| left.path.cmp(&right.path));

        search_hits.sort_by(|left, right| {
            right
                .rank
                .total_cmp(&left.rank)
                .then_with(|| left.source_name.cmp(&right.source_name))
                .then_with(|| left.line.cmp(&right.line))
                .then_with(|| left.start.cmp(&right.start))
        });
        search_hits.truncate(MAX_SEARCH_HITS);

        let replace_previews = search_hits
            .iter()
            .filter_map(CoreReplacePreview::from_hit)
            .collect::<Vec<_>>();
        let tag_entries = tag_entries(&story, tag_usage);
        let tags = tag_entries
            .iter()
            .map(|entry| entry.name.clone())
            .collect::<Vec<_>>();
        let contents = if options.include_contents {
            contents_entries(
                &story,
                &files,
                &tag_entries,
                &symbols,
                &asset_inventory,
                &diagnostics,
                graph
                    .as_ref()
                    .expect("graph index should exist when contents are included"),
                &metadata_source_id,
            )
        } else {
            Vec::new()
        };
        let graph_stats = if options.include_graph {
            graph
                .as_ref()
                .map(|graph| graph.stats().clone().into())
                .unwrap_or_default()
        } else {
            CoreGraphStats::default()
        };

        Ok(CoreStoryIndex {
            asset_inventory,
            assets,
            contents,
            diagnostics,
            files,
            graph: graph_stats,
            replace_previews,
            search_hits,
            story_id: story_id.to_owned(),
            tags,
            tag_entries,
            symbols,
        })
    }

    /// Lazily builds source-metadata-only Contents records. The catalog is
    /// compact relative to source analysis and is updated from mutation deltas.
    fn contents_catalog(&mut self, story_id: &str) -> Result<&StoryContentsCatalog, CoreError> {
        let story_id = StoryId::new(story_id);
        let revision = self.revision();
        let current = self
            .contents_catalog_cache
            .get(&story_id)
            .is_some_and(|catalog| catalog.revision == revision);

        if !current {
            let catalog = basic_story_contents_catalog(self.story(story_id.as_ref())?, revision);
            self.contents_catalog_cache
                .insert(story_id.clone(), catalog);
        }

        Ok(self
            .contents_catalog_cache
            .get(&story_id)
            .expect("contents catalog was initialized"))
    }

    /// Lazily builds the bounded read model from source and graph caches. It
    /// never creates a `CoreStoryIndex`; that compatibility type remains for
    /// explicit callers only and is too large to retain for a 50k story.
    fn read_model(&mut self, story_id: &str) -> Result<&StoryReadModelCache, CoreError> {
        let story_id = StoryId::new(story_id);
        let revision = self.revision();
        let current = self
            .read_model_cache
            .get(&story_id)
            .is_some_and(|cache| cache.revision == revision);

        if !current {
            let story = self.story(story_id.as_ref())?.clone();
            let metadata_source_id = format!("{}:metadata", story.id.as_ref());
            let script_source_id = format!("{}:script", story.id.as_ref());
            let stylesheet_source_id = format!("{}:stylesheet", story.id.as_ref());
            let mut active_source_ids = BTreeSet::new();
            let mut assets = Vec::new();
            let mut assets_by_source = BTreeMap::new();
            let mut files = Vec::new();
            let mut symbols = Vec::new();
            let mut symbols_by_source = BTreeMap::new();
            let mut tag_usage = BTreeMap::<String, BTreeSet<String>>::new();

            for passage in &story.passages {
                active_source_ids.insert(passage.id.as_ref().to_owned());
                let analysis = self.source_analysis(
                    &story.id,
                    passage.id.as_ref(),
                    &passage.name,
                    &passage.text,
                    CoreSourceKind::Passage,
                    Some(passage.id.as_ref()),
                    &passage.tags,
                    CoreSearchScope::PassageText,
                );

                if !analysis.assets.is_empty() {
                    assets.extend(analysis.assets.clone());
                    assets_by_source.insert(passage.id.as_ref().to_owned(), analysis.assets);
                }
                files.push(analysis.file);
                if !analysis.symbols.is_empty() {
                    symbols.extend(analysis.symbols.clone());
                    symbols_by_source.insert(passage.id.as_ref().to_owned(), analysis.symbols);
                }
                for tag in &passage.tags {
                    tag_usage
                        .entry(tag.clone())
                        .or_default()
                        .insert(passage.id.as_ref().to_owned());
                }
            }

            active_source_ids.insert(script_source_id.clone());
            active_source_ids.insert(stylesheet_source_id.clone());
            let script_analysis = self.source_analysis(
                &story.id,
                &script_source_id,
                "Story JavaScript",
                &story.script,
                CoreSourceKind::Script,
                None,
                &[],
                CoreSearchScope::Script,
            );
            let stylesheet_analysis = self.source_analysis(
                &story.id,
                &stylesheet_source_id,
                "Story Stylesheet",
                &story.stylesheet,
                CoreSourceKind::Stylesheet,
                None,
                &[],
                CoreSearchScope::Stylesheet,
            );
            if !script_analysis.assets.is_empty() {
                assets.extend(script_analysis.assets.clone());
                assets_by_source.insert(script_source_id.clone(), script_analysis.assets);
            }
            if !stylesheet_analysis.assets.is_empty() {
                assets.extend(stylesheet_analysis.assets.clone());
                assets_by_source.insert(stylesheet_source_id.clone(), stylesheet_analysis.assets);
            }
            files.push(script_analysis.file);
            files.push(stylesheet_analysis.file);
            if !script_analysis.symbols.is_empty() {
                symbols.extend(script_analysis.symbols.clone());
                symbols_by_source.insert(script_source_id, script_analysis.symbols);
            }
            if !stylesheet_analysis.symbols.is_empty() {
                symbols.extend(stylesheet_analysis.symbols.clone());
                symbols_by_source.insert(stylesheet_source_id, stylesheet_analysis.symbols);
            }
            if let Some(cache) = self.analysis_cache.get_mut(&story.id) {
                cache.retain(|source_id, _| active_source_ids.contains(source_id));
            }

            let known_assets = self.known_asset_inventory(&[])?;
            let asset_inventory =
                asset_inventory_from_references(&assets, known_assets, self.asset_root.is_some());
            let tag_entries = tag_entries(&story, tag_usage.clone());
            self.ensure_graph_cache(&story.id)?;
            let graph = &self
                .graph_cache
                .get(&story.id)
                .expect("graph cache was initialized")
                .graph;
            let mut diagnostics = Vec::new();

            for broken_link in graph.broken_links() {
                let (line, start, end) = story
                    .passage_by_id(&broken_link.source)
                    .and_then(|passage| locate_link_target(&passage.text, &broken_link.target_name))
                    .unwrap_or((1, 0, broken_link.target_name.len()));

                diagnostics.push(CoreDiagnostic {
                    code: "broken-link".into(),
                    end,
                    line,
                    message: format!("Broken link to \"{}\"", broken_link.target_name),
                    passage_id: Some(broken_link.source.as_ref().to_owned()),
                    quick_fixes: vec![
                        CoreQuickFix {
                            command: format!("create-passage:{}", broken_link.target_name),
                            title: format!("Create \"{}\"", broken_link.target_name),
                        },
                        CoreQuickFix {
                            command: "rename-link-target".into(),
                            title: "Change link target".into(),
                        },
                    ],
                    severity: CoreDiagnosticSeverity::Warning,
                    source_id: broken_link.source.as_ref().to_owned(),
                    start,
                });
            }
            for duplicate in duplicate_passage_names(&story) {
                diagnostics.push(CoreDiagnostic {
                    code: "duplicate-passage-name".into(),
                    end: duplicate.name.len(),
                    line: 1,
                    message: format!("Duplicate passage name \"{}\"", duplicate.name),
                    passage_id: Some(duplicate.passage_id.clone()),
                    quick_fixes: vec![CoreQuickFix {
                        command: "rename-passage".into(),
                        title: "Rename passage".into(),
                    }],
                    severity: CoreDiagnosticSeverity::Error,
                    source_id: duplicate.passage_id,
                    start: 0,
                });
            }
            if story.passage_by_id(&story.start_passage).is_none() {
                diagnostics.push(CoreDiagnostic {
                    code: "missing-start-passage".into(),
                    end: 0,
                    line: 1,
                    message: "Story start passage is missing".into(),
                    passage_id: None,
                    quick_fixes: vec![CoreQuickFix {
                        command: "set-start-passage".into(),
                        title: "Choose a start passage".into(),
                    }],
                    severity: CoreDiagnosticSeverity::Error,
                    source_id: metadata_source_id.clone(),
                    start: 0,
                });
            }
            diagnostics.extend(asset_diagnostics(
                &story,
                &metadata_source_id,
                &asset_inventory,
            ));
            let content_entries = contents_entries(
                &story,
                &files,
                &tag_entries,
                &symbols,
                &asset_inventory,
                &diagnostics,
                graph,
                &metadata_source_id,
            );
            let asset_entry_ids = content_entries
                .iter()
                .filter(|entry| entry.kind == CoreContentsEntryKind::Asset)
                .map(|entry| entry.id.clone())
                .collect();
            let diagnostic_entry_ids = content_entries
                .iter()
                .filter(|entry| {
                    matches!(
                        entry.kind,
                        CoreContentsEntryKind::BrokenLink | CoreContentsEntryKind::Diagnostic
                    )
                })
                .map(|entry| entry.id.clone())
                .collect();
            let orphan_entry_ids = content_entries
                .iter()
                .filter(|entry| entry.kind == CoreContentsEntryKind::Orphan)
                .map(|entry| entry.id.clone())
                .collect();
            let entry_point_id = content_entries
                .iter()
                .find(|entry| entry.kind == CoreContentsEntryKind::EntryPoint)
                .map(|entry| entry.id.clone());
            let symbol_entry_ids = content_entries
                .iter()
                .filter(|entry| entry.kind == CoreContentsEntryKind::Variable)
                .map(|entry| entry.id.clone())
                .collect();
            let contents = content_entries
                .into_iter()
                .map(|entry| (entry.id.clone(), entry))
                .collect();

            self.read_model_cache.insert(
                story_id.clone(),
                StoryReadModelCache {
                    asset_inventory,
                    asset_entry_ids,
                    assets_by_source,
                    character_count: story
                        .passages
                        .iter()
                        .map(|passage| utf16_len(&passage.text))
                        .sum(),
                    contents,
                    diagnostic_entry_ids,
                    diagnostics,
                    entry_point_id,
                    graph: graph.stats().clone().into(),
                    orphan_entry_ids,
                    revision,
                    symbol_entry_ids,
                    symbols_by_source,
                    tag_count: tag_entries.len(),
                    tag_usage,
                    word_count: story
                        .passages
                        .iter()
                        .map(|passage| passage.text.split_whitespace().count())
                        .sum(),
                },
            );
            self.read_model_full_build_count += 1;
            self.read_model_last_touched_source_count = story.passages.len() + 2;
        }

        Ok(self
            .read_model_cache
            .get(&story_id)
            .expect("read model was initialized"))
    }

    pub fn story_summary(&mut self, story_id: &str) -> Result<CoreStorySummary, CoreError> {
        let passage_count = self.story(story_id)?.passage_count();
        let revision = self.revision().min(u32::MAX as u64) as u32;
        let read_model = self.read_model(story_id)?;

        Ok(CoreStorySummary {
            asset_count: read_model.asset_inventory.len(),
            character_count: read_model.character_count,
            diagnostic_count: read_model.diagnostics.len(),
            error_count: read_model
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.severity == CoreDiagnosticSeverity::Error)
                .count(),
            graph: read_model.graph.clone(),
            missing_asset_count: read_model
                .asset_inventory
                .iter()
                .filter(|asset| asset.missing)
                .count(),
            passage_count,
            revision,
            story_id: story_id.to_owned(),
            tag_count: read_model.tag_count,
            warning_count: read_model
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.severity == CoreDiagnosticSeverity::Warning)
                .count(),
            word_count: read_model.word_count,
        })
    }

    pub fn diagnostics_summary(
        &mut self,
        story_id: &str,
        query: CoreDiagnosticsSummaryQuery,
    ) -> Result<CoreDiagnosticsSummary, CoreError> {
        let revision = self.revision().min(u32::MAX as u64) as u32;
        let dismissed_identities = parsed_diagnostic_identities(query.dismissed_ids);
        let diagnostics = &self.read_model(story_id)?.diagnostics;
        let mut summary = CoreDiagnosticsSummary {
            revision,
            story_id: story_id.to_owned(),
            ..CoreDiagnosticsSummary::default()
        };

        for diagnostic in diagnostics {
            if diagnostic_is_dismissed(diagnostic, &dismissed_identities) {
                summary.dismissed_count += 1;
                continue;
            }

            summary.diagnostic_count += 1;
            match diagnostic.severity {
                CoreDiagnosticSeverity::Error => summary.error_count += 1,
                CoreDiagnosticSeverity::Info => summary.info_count += 1,
                CoreDiagnosticSeverity::Warning => summary.warning_count += 1,
            }
        }

        Ok(summary)
    }

    pub fn story_word_count(&self, story_id: &str) -> Result<usize, CoreError> {
        Ok(self
            .story(story_id)?
            .passages
            .iter()
            .map(|passage| passage.text.split_whitespace().count())
            .sum())
    }

    pub fn contents_page(
        &mut self,
        story_id: &str,
        query: CoreContentsQuery,
    ) -> Result<CoreContentsPage, CoreError> {
        let revision = self.revision().min(u32::MAX as u64) as u32;
        let cursor_fingerprint = read_model_query_fingerprint(&query, |query| {
            query.cursor = None;
        });
        let offset = read_model_page_offset(query.cursor.as_deref(), revision, cursor_fingerprint)?;
        if contents_query_uses_basic_catalog(&query) {
            let catalog = self.contents_catalog(story_id)?;

            return Ok(contents_page_from_records(
                story_id,
                revision,
                cursor_fingerprint,
                offset,
                &query,
                &catalog.contents,
                catalog.facets.clone(),
                &[],
            ));
        }

        let read_model = self.read_model(story_id)?;
        let mut facets = contents_facets(read_model.contents.values());
        facets.intelligence_complete = true;
        Ok(contents_page_from_records(
            story_id,
            revision,
            cursor_fingerprint,
            offset,
            &query,
            &read_model.contents,
            facets,
            &read_model.asset_inventory,
        ))
    }

    pub fn search_page(
        &mut self,
        story_id: &str,
        query: CoreSearchQuery,
    ) -> Result<CoreSearchPage, CoreError> {
        let revision = self.revision().min(u32::MAX as u64) as u32;
        let cursor_fingerprint = read_model_query_fingerprint(&query, |query| {
            query.cursor = None;
        });
        let offset = read_model_page_offset(query.cursor.as_deref(), revision, cursor_fingerprint)?;
        let options = CoreStoryIndexOptions {
            fuzzy: query.fuzzy,
            include_assets: false,
            include_contents: false,
            include_diagnostics: false,
            include_files: false,
            include_graph: false,
            include_passage_names: query.include_passage_names,
            include_passage_text: query.include_passage_text,
            include_script: query.include_script,
            include_stylesheet: query.include_stylesheet,
            include_tags: false,
            include_variables: false,
            match_case: query.match_case,
            query: Some(query.query),
            replacement: query.replacement,
            use_regexes: query.use_regexes,
            ..CoreStoryIndexOptions::default()
        };
        let pattern = search_pattern(&options);
        let story = self.story(story_id)?;
        let mut hits = Vec::new();

        for passage in story.passages.iter() {
            if options.include_passage_names {
                hits.extend(search_hits_in_source(
                    &options,
                    pattern.as_ref(),
                    passage.id.as_ref(),
                    &passage.name,
                    &passage.name,
                    CoreSearchScope::PassageName,
                    Some(passage.id.as_ref()),
                ));
            }
            if options.include_passage_text {
                hits.extend(search_hits_in_source(
                    &options,
                    pattern.as_ref(),
                    passage.id.as_ref(),
                    &passage.name,
                    &passage.text,
                    CoreSearchScope::PassageText,
                    Some(passage.id.as_ref()),
                ));
            }
        }

        if options.include_script {
            let source_id = format!("{}:script", story.id.as_ref());

            hits.extend(search_hits_in_source(
                &options,
                pattern.as_ref(),
                &source_id,
                "Story JavaScript",
                &story.script,
                CoreSearchScope::Script,
                None,
            ));
        }
        if options.include_stylesheet {
            let source_id = format!("{}:stylesheet", story.id.as_ref());

            hits.extend(search_hits_in_source(
                &options,
                pattern.as_ref(),
                &source_id,
                "Story Stylesheet",
                &story.stylesheet,
                CoreSearchScope::Stylesheet,
                None,
            ));
        }

        hits.sort_by(|left, right| {
            right
                .rank
                .total_cmp(&left.rank)
                .then_with(|| left.source_name.cmp(&right.source_name))
                .then_with(|| left.line.cmp(&right.line))
                .then_with(|| left.start.cmp(&right.start))
        });
        hits.truncate(MAX_SEARCH_HITS);
        let total_count = hits.len();
        let (search_hits, next_cursor) =
            read_model_page(hits, offset, query.limit, revision, cursor_fingerprint);
        let replace_previews = search_hits
            .iter()
            .filter_map(CoreReplacePreview::from_hit)
            .collect();

        Ok(CoreSearchPage {
            next_cursor,
            replace_previews,
            revision,
            search_hits,
            story_id: story_id.to_owned(),
            total_count,
        })
    }

    pub fn diagnostics_page(
        &mut self,
        story_id: &str,
        query: CoreDiagnosticsQuery,
    ) -> Result<CoreDiagnosticsPage, CoreError> {
        let revision = self.revision().min(u32::MAX as u64) as u32;
        let cursor_fingerprint = read_model_query_fingerprint(&query, |query| {
            query.cursor = None;
        });
        let offset = read_model_page_offset(query.cursor.as_deref(), revision, cursor_fingerprint)?;
        let diagnostics = self
            .read_model(story_id)?
            .diagnostics
            .iter()
            .filter(|diagnostic| {
                query
                    .severity
                    .as_ref()
                    .is_none_or(|severity| diagnostic.severity == *severity)
            })
            .collect::<Vec<_>>();
        let total_count = diagnostics.len();
        let (diagnostics, next_cursor) = read_model_page_refs(
            diagnostics,
            offset,
            query.limit,
            revision,
            cursor_fingerprint,
        );

        Ok(CoreDiagnosticsPage {
            diagnostics,
            next_cursor,
            revision,
            story_id: story_id.to_owned(),
            total_count,
        })
    }

    pub fn assets_page(
        &mut self,
        story_id: &str,
        query: CoreAssetsQuery,
    ) -> Result<CoreAssetsPage, CoreError> {
        let revision = self.revision().min(u32::MAX as u64) as u32;
        let cursor_fingerprint = read_model_query_fingerprint(&query, |query| {
            query.cursor = None;
        });
        let offset = read_model_page_offset(query.cursor.as_deref(), revision, cursor_fingerprint)?;
        let mut assets = self
            .read_model(story_id)?
            .asset_inventory
            .iter()
            .collect::<Vec<_>>();
        if let Some(search) = normalized_read_model_query(query.query.as_deref()) {
            assets.retain(|asset| asset.path.to_lowercase().contains(&search));
        }
        let total_count = assets.len();
        let (assets, next_cursor) =
            read_model_page_refs(assets, offset, query.limit, revision, cursor_fingerprint);

        Ok(CoreAssetsPage {
            assets,
            next_cursor,
            revision,
            story_id: story_id.to_owned(),
            total_count,
        })
    }

    pub fn passage_local_facts(
        &mut self,
        story_id: &str,
        passage_id: &str,
    ) -> Result<CorePassageLocalFacts, CoreError> {
        let passage_id = PassageId::new(passage_id);
        let (story_id, passage_name, passage_text, passage_tags, duplicate_name, edges) = {
            let story = self.story(story_id)?;
            let passage = story
                .passage_by_id(&passage_id)
                .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;

            (
                story.id.clone(),
                passage.name.clone(),
                passage.text.clone(),
                passage.tags.clone(),
                story
                    .passages
                    .iter()
                    .filter(|candidate| candidate.name == passage.name)
                    .nth(1)
                    .is_some(),
                passage_link_edges(story, passage),
            )
        };
        let analysis = self.source_analysis(
            &story_id,
            passage_id.as_ref(),
            &passage_name,
            &passage_text,
            CoreSourceKind::Passage,
            Some(passage_id.as_ref()),
            &passage_tags,
            CoreSearchScope::PassageText,
        );
        let mut diagnostics = edges
            .iter()
            .filter(|edge| edge.target.is_none())
            .map(|edge| {
                let (line, start, end) = locate_link_target(&passage_text, &edge.target_name)
                    .unwrap_or((1, 0, edge.target_name.len()));

                CoreDiagnostic {
                    code: "broken-link".into(),
                    end,
                    line,
                    message: format!("Broken link to \"{}\"", edge.target_name),
                    passage_id: Some(passage_id.as_ref().to_owned()),
                    quick_fixes: vec![
                        CoreQuickFix {
                            command: format!("create-passage:{}", edge.target_name),
                            title: format!("Create \"{}\"", edge.target_name),
                        },
                        CoreQuickFix {
                            command: "rename-link-target".into(),
                            title: "Change link target".into(),
                        },
                    ],
                    severity: CoreDiagnosticSeverity::Warning,
                    source_id: passage_id.as_ref().to_owned(),
                    start,
                }
            })
            .collect::<Vec<_>>();
        if duplicate_name {
            diagnostics.push(CoreDiagnostic {
                code: "duplicate-passage-name".into(),
                end: passage_name.len(),
                line: 1,
                message: format!("Duplicate passage name \"{passage_name}\""),
                passage_id: Some(passage_id.as_ref().to_owned()),
                quick_fixes: vec![CoreQuickFix {
                    command: "rename-passage".into(),
                    title: "Rename passage".into(),
                }],
                severity: CoreDiagnosticSeverity::Error,
                source_id: passage_id.as_ref().to_owned(),
                start: 0,
            });
        }

        Ok(CorePassageLocalFacts {
            asset_references: analysis.assets,
            character_count: utf16_len(&passage_text),
            diagnostics,
            excerpt: passage_text.chars().take(400).collect(),
            is_empty: passage_text.trim().is_empty(),
            line_count: line_count(&passage_text),
            links: edges.iter().map(core_passage_link_fact).collect(),
            passage_id: passage_id.as_ref().to_owned(),
            revision: self.revision().min(u32::MAX as u64) as u32,
            story_id: story_id.as_ref().to_owned(),
            symbols: analysis.symbols,
            word_count: passage_text.split_whitespace().count(),
        })
    }

    fn ensure_backlink_cache(
        &mut self,
        story_id: &StoryId,
        passage_id: &PassageId,
    ) -> Result<(), CoreError> {
        let revision = self.revision();
        let current = self
            .backlink_cache
            .get(story_id)
            .and_then(|entries| entries.get(passage_id))
            .is_some_and(|entry| entry.revision == revision);
        if current {
            self.backlink_cache_hit_count += 1;
            self.touch_backlink_cache(story_id, passage_id);
            return Ok(());
        }

        let (target_name, source_ranks, scanned_sources) = {
            let story = self.story(story_id.as_ref())?;
            let target = story
                .passage_by_id(passage_id)
                .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;
            let mut source_ranks = Vec::new();

            for (rank, source) in story.passages.iter().enumerate() {
                source_ranks.extend(
                    passage_link_edges(story, source)
                        .into_iter()
                        .filter(|edge| {
                            edge.source != *passage_id && edge.target.as_ref() == Some(passage_id)
                        })
                        .map(|_| rank),
                );
            }
            (target.name.clone(), source_ranks, story.passage_count())
        };
        let byte_size = source_ranks.len() * std::mem::size_of::<usize>();

        self.backlink_scan_count += 1;
        self.backlink_scanned_source_count += scanned_sources;
        self.backlink_cache
            .entry(story_id.clone())
            .or_default()
            .insert(
                passage_id.clone(),
                BacklinkCacheEntry {
                    byte_size,
                    revision,
                    source_ranks,
                    target_name,
                },
            );
        self.touch_backlink_cache(story_id, passage_id);
        self.prune_backlink_cache();
        Ok(())
    }

    fn touch_backlink_cache(&mut self, story_id: &StoryId, passage_id: &PassageId) {
        self.backlink_cache_lru
            .retain(|key| key != &(story_id.clone(), passage_id.clone()));
        self.backlink_cache_lru
            .push_back((story_id.clone(), passage_id.clone()));
    }

    fn prune_backlink_cache(&mut self) {
        loop {
            let entry_count = self
                .backlink_cache
                .values()
                .map(BTreeMap::len)
                .sum::<usize>();
            let byte_count = self
                .backlink_cache
                .values()
                .flat_map(BTreeMap::values)
                .map(|entry| entry.byte_size)
                .sum::<usize>();
            if entry_count <= MAX_BACKLINK_CACHE_ENTRIES && byte_count <= MAX_BACKLINK_CACHE_BYTES {
                break;
            }
            let Some((story_id, passage_id)) = self.backlink_cache_lru.pop_front() else {
                break;
            };
            if let Some(entries) = self.backlink_cache.get_mut(&story_id) {
                entries.remove(&passage_id);
                if entries.is_empty() {
                    self.backlink_cache.remove(&story_id);
                }
            }
        }
    }

    pub fn backlinks_page(
        &mut self,
        story_id: &str,
        passage_id: &str,
        query: CoreBacklinksQuery,
    ) -> Result<CoreBacklinksPage, CoreError> {
        let story_id = StoryId::new(story_id);
        let passage_id = PassageId::new(passage_id);
        let revision = self.revision().min(u32::MAX as u64) as u32;
        let cursor_fingerprint = read_model_query_fingerprint(&query, |query| {
            query.cursor = None;
        }) ^ fingerprint(&(story_id.as_ref(), passage_id.as_ref()));
        let offset = read_model_page_offset(query.cursor.as_deref(), revision, cursor_fingerprint)?;
        self.ensure_backlink_cache(&story_id, &passage_id)?;
        let entry = self
            .backlink_cache
            .get(&story_id)
            .and_then(|entries| entries.get(&passage_id))
            .expect("backlink cache was initialized");
        let total_count = entry.source_ranks.len();
        let target_name = entry.target_name.clone();
        let (source_ranks, next_cursor) = read_model_page_refs(
            entry.source_ranks.iter().collect(),
            offset,
            query.limit.min(MAX_READ_MODEL_PAGE_LIMIT),
            revision,
            cursor_fingerprint,
        );
        let story = self.story(story_id.as_ref())?;
        let backlinks = source_ranks
            .into_iter()
            .filter_map(|source_rank| story.passages.get_at(source_rank))
            .map(|source| CorePassageLinkFact {
                broken: false,
                source_id: source.id.as_ref().to_owned(),
                target_id: Some(passage_id.as_ref().to_owned()),
                target_name: target_name.clone(),
            })
            .collect();

        Ok(CoreBacklinksPage {
            backlinks,
            next_cursor,
            passage_id: passage_id.as_ref().to_owned(),
            revision,
            story_id: story_id.as_ref().to_owned(),
            total_count,
        })
    }

    /// Compatibility composition for non-product callers. Product routes use
    /// `passage_local_facts` and the bounded backlink page independently.
    pub fn passage_facts(
        &mut self,
        story_id: &str,
        passage_id: &str,
    ) -> Result<CorePassageFacts, CoreError> {
        let local = self.passage_local_facts(story_id, passage_id)?;
        let story_id_key = StoryId::new(story_id);
        let passage_id_key = PassageId::new(passage_id);
        self.ensure_backlink_cache(&story_id_key, &passage_id_key)?;
        let (target_name, source_ranks) = {
            let entry = self
                .backlink_cache
                .get(&story_id_key)
                .and_then(|entries| entries.get(&passage_id_key));
            entry
                .map(|entry| (entry.target_name.clone(), entry.source_ranks.clone()))
                .unwrap_or_default()
        };
        let story = self.story(story_id)?;
        let backlinks = source_ranks
            .into_iter()
            .filter_map(|source_rank| story.passages.get_at(source_rank))
            .map(|source| CorePassageLinkFact {
                broken: false,
                source_id: source.id.as_ref().to_owned(),
                target_id: Some(passage_id.to_owned()),
                target_name: target_name.clone(),
            })
            .collect();

        Ok(CorePassageFacts {
            asset_references: local.asset_references,
            backlinks,
            character_count: local.character_count,
            diagnostics: local.diagnostics,
            excerpt: local.excerpt,
            is_empty: local.is_empty,
            line_count: local.line_count,
            links: local.links,
            passage_id: local.passage_id,
            revision: local.revision,
            story_id: local.story_id,
            symbols: local.symbols,
            word_count: local.word_count,
        })
    }

    pub fn passage_document(
        &self,
        story_id: &str,
        passage_id: &str,
    ) -> Result<CorePassageDocument, CoreError> {
        let passage_id = PassageId::new(passage_id);
        let story = self.story(story_id)?;
        let passage = story
            .passage_by_id(&passage_id)
            .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;

        Ok(CorePassageDocument {
            passage_id: passage_id.as_ref().to_owned(),
            revision: self.revision().min(u32::MAX as u64) as u32,
            story_id: story.id.as_ref().to_owned(),
            text: passage.text.clone(),
        })
    }

    pub fn source_document(
        &self,
        story_id: &str,
        kind: CoreSourceKind,
    ) -> Result<CoreSourceDocument, CoreError> {
        let story = self.story(story_id)?;
        let text = match kind {
            CoreSourceKind::Script => story.script.clone(),
            CoreSourceKind::Stylesheet => story.stylesheet.clone(),
            CoreSourceKind::Passage | CoreSourceKind::StoryMetadata => {
                return Err(CoreError::UnsupportedCommand(
                    "passage sources require passage_document".into(),
                ));
            }
        };
        Ok(CoreSourceDocument {
            kind,
            revision: self.revision().min(u32::MAX as u64) as u32,
            story_id: story.id.as_ref().to_owned(),
            text,
        })
    }

    pub fn document_page(
        &self,
        story_id: &str,
        query: CoreDocumentQuery,
    ) -> Result<CoreDocumentPage, CoreError> {
        let revision = self.revision().min(u32::MAX as u64) as u32;
        let cursor_fingerprint = read_model_query_fingerprint(&query, |query| {
            query.cursor = None;
        });
        let offset = read_model_page_offset(query.cursor.as_deref(), revision, cursor_fingerprint)?;
        let story = self.story(story_id)?;
        let total_count = story.passage_count() + 2;
        let limit = query.limit.clamp(1, MAX_READ_MODEL_PAGE_LIMIT);
        let end = (offset + limit).min(total_count);
        let mut documents = Vec::with_capacity(end.saturating_sub(offset));

        for passage in story
            .passages
            .iter()
            .skip(offset.min(story.passage_count()))
            .take(end.saturating_sub(offset).min(story.passage_count()))
        {
            documents.push(CoreDocumentEntry {
                kind: CoreDocumentKind::Passage,
                passage_id: Some(passage.id.as_ref().to_owned()),
                text: passage.text.clone(),
            });
        }
        for source_index in story.passage_count().max(offset)..end {
            documents.push(if source_index == story.passage_count() {
                CoreDocumentEntry {
                    kind: CoreDocumentKind::Script,
                    passage_id: None,
                    text: story.script.clone(),
                }
            } else {
                CoreDocumentEntry {
                    kind: CoreDocumentKind::Stylesheet,
                    passage_id: None,
                    text: story.stylesheet.clone(),
                }
            });
        }
        let next_cursor =
            (end < total_count).then(|| format!("{revision}:{cursor_fingerprint}:{end}"));

        Ok(CoreDocumentPage {
            documents,
            next_cursor,
            revision,
            story_id: story.id.as_ref().to_owned(),
            total_count,
        })
    }

    /// Lazily initializes topology once for bounded graph and passage-fact reads.
    /// Mutations update this cache through `update_graph_cache`, so focused reads
    /// never construct a second graph from the complete story.
    fn ensure_graph_cache(&mut self, story_id: &StoryId) -> Result<(), CoreError> {
        if self.graph_cache.contains_key(story_id) {
            return Ok(());
        }

        let story = self.story(story_id.as_ref())?.clone();
        let graph = GraphIndex::from_story(&story);
        let layout =
            graph.layout_snapshot(&story, &self.project.layout, &AutoLayoutOptions::default());

        self.graph_cache
            .insert(story_id.clone(), GraphSessionCache { graph, layout });
        Ok(())
    }

    fn asset_root(&self) -> Result<&Path, CoreError> {
        self.asset_root
            .as_deref()
            .ok_or(CoreError::AssetHostUnavailable)
    }

    fn known_asset_inventory(
        &self,
        extra_assets: &[CoreAssetInventoryEntry],
    ) -> Result<Vec<CoreAssetInventoryEntry>, CoreError> {
        let mut assets = self.asset_inventory.clone();

        assets.extend_from_slice(extra_assets);

        if let Some(asset_root) = &self.asset_root {
            assets.extend(file_asset_inventory(asset_root)?);
        }

        Ok(normalized_asset_inventory(assets))
    }

    fn asset_inventory_patches(&mut self) -> Result<Vec<Patch>, CoreError> {
        let story_ids = self
            .project
            .stories
            .iter()
            .map(|story| story.id.as_ref().to_owned())
            .collect::<Vec<_>>();

        story_ids
            .iter()
            .map(|story_id| self.asset_inventory_patch(story_id))
            .collect()
    }

    fn asset_inventory_patch(&mut self, story_id: &str) -> Result<Patch, CoreError> {
        let index = self.story_index(story_id, CoreStoryIndexOptions::default())?;

        Ok(Patch::AssetInventoryUpdated {
            inventory: index.asset_inventory,
            story_id: story_id.to_owned(),
        })
    }

    fn copy_asset_snippet(
        &self,
        story_id: &str,
        path: &str,
        snippet: Option<String>,
    ) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let snippet = snippet.unwrap_or_else(|| {
            let kind = asset_kind_for_path(path);

            asset_snippet(path, &kind).text
        });

        Ok(vec![Patch::AssetSnippetCopied {
            path: path.to_owned(),
            snippet,
            story_id: story_id.to_owned(),
        }])
    }

    fn delete_asset(
        &mut self,
        story_id: &str,
        path: &str,
        remove_references: bool,
    ) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let asset_path = AssetPath::parse(path)?;
        let Some(asset_root) = self.asset_root.clone() else {
            self.asset_inventory.retain(|asset| {
                asset.normalized_path != normalized_asset_path(&asset_path.project_path)
            });
            let mut patches = vec![Patch::AssetDeleted {
                path: asset_path.project_path.clone(),
                story_id: story_id.to_owned(),
            }];

            if remove_references {
                patches.extend(self.replace_asset_references(
                    story_id,
                    &asset_path.project_path,
                    "",
                )?);
            }
            return Ok(patches);
        };
        let disk_path = asset_path.disk_path(&asset_root);

        if !disk_path.is_file() {
            return Err(CoreError::AssetFileNotFound(asset_path.project_path));
        }

        fs::remove_file(&disk_path).map_err(core_io_error)?;

        let mut patches = vec![Patch::AssetDeleted {
            path: asset_path.project_path.clone(),
            story_id: story_id.to_owned(),
        }];

        if remove_references {
            patches.extend(self.replace_asset_references(
                story_id,
                &asset_path.project_path,
                "",
            )?);
        }

        patches.push(self.asset_inventory_patch(story_id)?);
        Ok(patches)
    }

    fn import_asset(
        &mut self,
        story_id: &str,
        source_path: &str,
        target_path: Option<String>,
        overwrite: bool,
    ) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let target = match target_path {
            Some(path) => AssetPath::parse(&path)?,
            None => {
                let source = PathBuf::from(source_path);
                let Some(file_name) = source.file_name().and_then(|name| name.to_str()) else {
                    return Err(CoreError::UnsafeAssetPath(source_path.into()));
                };

                AssetPath::parse(file_name)?
            }
        };
        let Some(asset_root) = self.asset_root.clone() else {
            let kind = asset_kind_for_path(&target.project_path);
            let asset = asset_inventory_entry(target.project_path, kind, Some(true), Vec::new());

            self.asset_inventory
                .retain(|existing| existing.normalized_path != asset.normalized_path);
            self.asset_inventory.push(asset.clone());
            self.asset_inventory =
                normalized_asset_inventory(std::mem::take(&mut self.asset_inventory));
            return Ok(vec![Patch::AssetImported {
                asset,
                story_id: story_id.to_owned(),
            }]);
        };
        let source = PathBuf::from(source_path);

        if !source.is_file() {
            return Err(CoreError::AssetFileNotFound(source_path.into()));
        }
        let disk_path = target.disk_path(&asset_root);

        if disk_path.exists() && !overwrite {
            return Err(CoreError::AssetAlreadyExists(target.project_path));
        }

        if let Some(parent) = disk_path.parent() {
            fs::create_dir_all(parent).map_err(core_io_error)?;
        }

        fs::copy(&source, &disk_path).map_err(core_io_error)?;

        let asset = file_asset_inventory_entry(&asset_root, &disk_path)?;

        Ok(vec![
            Patch::AssetImported {
                asset,
                story_id: story_id.to_owned(),
            },
            self.asset_inventory_patch(story_id)?,
        ])
    }

    fn insert_asset_snippet(
        &mut self,
        story_id: &str,
        path: &str,
        source_id: &str,
        passage_id: Option<&str>,
        position: usize,
        snippet: Option<String>,
    ) -> Result<Vec<Patch>, CoreError> {
        let snippet = snippet.unwrap_or_else(|| {
            let kind = asset_kind_for_path(path);

            asset_snippet(path, &kind).text
        });
        let mut patches =
            self.insert_source_text(story_id, source_id, passage_id, position, &snippet)?;

        patches.push(Patch::AssetSnippetInserted {
            path: path.into(),
            snippet,
            source_id: source_id.into(),
            story_id: story_id.into(),
        });
        Ok(patches)
    }

    fn rename_asset(
        &mut self,
        story_id: &str,
        path: &str,
        new_path: &str,
        update_references: bool,
    ) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let old_asset = AssetPath::parse(path)?;
        let new_asset = AssetPath::parse(new_path)?;
        let Some(asset_root) = self.asset_root.clone() else {
            let old_normalized = normalized_asset_path(&old_asset.project_path);
            let new_kind = asset_kind_for_path(&new_asset.project_path);
            let mut renamed = self
                .asset_inventory
                .iter()
                .find(|asset| asset.normalized_path == old_normalized)
                .cloned()
                .unwrap_or_else(|| {
                    asset_inventory_entry(
                        new_asset.project_path.clone(),
                        new_kind.clone(),
                        Some(true),
                        Vec::new(),
                    )
                });

            renamed.path = new_asset.project_path.clone();
            renamed.normalized_path = normalized_asset_path(&renamed.path);
            renamed.kind = new_kind;
            self.asset_inventory
                .retain(|asset| asset.normalized_path != old_normalized);
            self.asset_inventory.push(renamed);
            self.asset_inventory =
                normalized_asset_inventory(std::mem::take(&mut self.asset_inventory));
            let mut patches = vec![Patch::AssetRenamed {
                new_path: new_asset.project_path.clone(),
                old_path: old_asset.project_path.clone(),
                story_id: story_id.to_owned(),
            }];

            if update_references {
                patches.extend(self.replace_asset_references(
                    story_id,
                    &old_asset.project_path,
                    &new_asset.project_path,
                )?);
            }
            return Ok(patches);
        };
        let old_disk_path = old_asset.disk_path(&asset_root);
        let new_disk_path = new_asset.disk_path(&asset_root);

        if !old_disk_path.is_file() {
            return Err(CoreError::AssetFileNotFound(old_asset.project_path));
        }

        if new_disk_path.exists() {
            return Err(CoreError::AssetAlreadyExists(new_asset.project_path));
        }

        if let Some(parent) = new_disk_path.parent() {
            fs::create_dir_all(parent).map_err(core_io_error)?;
        }

        fs::rename(&old_disk_path, &new_disk_path).map_err(core_io_error)?;

        let mut patches = vec![Patch::AssetRenamed {
            new_path: new_asset.project_path.clone(),
            old_path: old_asset.project_path.clone(),
            story_id: story_id.to_owned(),
        }];

        if update_references {
            patches.extend(self.replace_asset_references(
                story_id,
                &old_asset.project_path,
                &new_asset.project_path,
            )?);
        }

        patches.push(self.asset_inventory_patch(story_id)?);
        Ok(patches)
    }

    fn replace_asset(
        &mut self,
        story_id: &str,
        path: &str,
        source_path: &str,
    ) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let asset = AssetPath::parse(path)?;
        let Some(asset_root) = self.asset_root.clone() else {
            let kind = asset_kind_for_path(&asset.project_path);
            let asset = asset_inventory_entry(asset.project_path, kind, Some(true), Vec::new());

            self.asset_inventory
                .retain(|existing| existing.normalized_path != asset.normalized_path);
            self.asset_inventory.push(asset.clone());
            self.asset_inventory =
                normalized_asset_inventory(std::mem::take(&mut self.asset_inventory));
            return Ok(vec![Patch::AssetReplaced {
                asset,
                story_id: story_id.to_owned(),
            }]);
        };
        let disk_path = asset.disk_path(&asset_root);
        let source = PathBuf::from(source_path);

        if !disk_path.is_file() {
            return Err(CoreError::AssetFileNotFound(asset.project_path));
        }

        if !source.is_file() {
            return Err(CoreError::AssetFileNotFound(source_path.into()));
        }

        fs::copy(source, &disk_path).map_err(core_io_error)?;

        let asset = file_asset_inventory_entry(&asset_root, &disk_path)?;

        Ok(vec![
            Patch::AssetReplaced {
                asset,
                story_id: story_id.to_owned(),
            },
            self.asset_inventory_patch(story_id)?,
        ])
    }

    fn reveal_asset(&self, story_id: &str, path: &str) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let asset_root = self.asset_root()?.to_path_buf();
        let asset = AssetPath::parse(path)?;
        let disk_path = asset.disk_path(&asset_root);

        if !disk_path.is_file() {
            return Err(CoreError::AssetFileNotFound(asset.project_path));
        }

        Ok(vec![Patch::AssetRevealed {
            path: asset.project_path,
            reveal_path: disk_path.to_string_lossy().into_owned(),
            story_id: story_id.into(),
        }])
    }

    fn validate_asset_references(&mut self, story_id: &str) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        Ok(vec![self.asset_inventory_patch(story_id)?])
    }

    fn story(&self, story_id: &str) -> Result<&Story, CoreError> {
        self.project
            .stories
            .iter()
            .find(|story| story.id.as_ref() == story_id)
            .ok_or_else(|| CoreError::StoryNotFound(story_id.to_owned()))
    }

    fn story_mut(&mut self, story_id: &str) -> Result<&mut Story, CoreError> {
        self.project
            .stories
            .iter_mut()
            .find(|story| story.id.as_ref() == story_id)
            .ok_or_else(|| CoreError::StoryNotFound(story_id.to_owned()))
    }

    fn insert_source_text(
        &mut self,
        story_id: &str,
        source_id: &str,
        passage_id: Option<&str>,
        position: usize,
        text: &str,
    ) -> Result<Vec<Patch>, CoreError> {
        let source_id_passage = passage_id
            .map(PassageId::new)
            .or_else(|| Some(PassageId::new(source_id)));

        if let Some(passage_id) = source_id_passage {
            let story = self.story_mut(story_id)?;

            if let Some(passage) = story.passage_by_id_mut(&passage_id) {
                let position = clamped_char_boundary(&passage.text, position);

                passage.text.insert_str(position, text);
                return Ok(vec![Patch::PassageUpdated {
                    changes: PassagePatch {
                        text: Some(passage.text.clone()),
                        ..PassagePatch::default()
                    },
                    passage_id: passage_id.as_ref().to_owned(),
                    story_id: story_id.to_owned(),
                }]);
            }
        }

        if source_id.ends_with(":script") {
            let story = self.story_mut(story_id)?;
            let position = clamped_char_boundary(&story.script, position);

            story.script.insert_str(position, text);
            return Ok(vec![Patch::StoryScriptUpdated {
                script: story.script.clone(),
                story_id: story_id.to_owned(),
            }]);
        }

        if source_id.ends_with(":stylesheet") {
            let story = self.story_mut(story_id)?;
            let position = clamped_char_boundary(&story.stylesheet, position);

            story.stylesheet.insert_str(position, text);
            return Ok(vec![Patch::StoryStylesheetUpdated {
                story_id: story_id.to_owned(),
                stylesheet: story.stylesheet.clone(),
            }]);
        }

        Err(CoreError::PassageNotFound(source_id.to_owned()))
    }

    fn replace_asset_references(
        &mut self,
        story_id: &str,
        old_path: &str,
        new_path: &str,
    ) -> Result<Vec<Patch>, CoreError> {
        let old_normalized = normalized_asset_path(old_path);
        let story = self.story_mut(story_id)?;
        let mut patches = Vec::new();

        for passage in story.passages.iter_mut() {
            let replaced =
                replace_asset_references_in_source(&passage.text, &old_normalized, new_path, false);

            if replaced != passage.text {
                passage.text = replaced.clone();
                patches.push(Patch::PassageUpdated {
                    changes: PassagePatch {
                        text: Some(replaced),
                        ..PassagePatch::default()
                    },
                    passage_id: passage.id.as_ref().to_owned(),
                    story_id: story_id.to_owned(),
                });
            }
        }

        let script = replace_asset_references_in_source_with_mode(
            &story.script,
            &old_normalized,
            new_path,
            false,
            true,
        );

        if script != story.script {
            story.script = script.clone();
            patches.push(Patch::StoryScriptUpdated {
                script,
                story_id: story_id.to_owned(),
            });
        }

        let stylesheet =
            replace_asset_references_in_source(&story.stylesheet, &old_normalized, new_path, true);

        if stylesheet != story.stylesheet {
            story.stylesheet = stylesheet.clone();
            patches.push(Patch::StoryStylesheetUpdated {
                story_id: story_id.to_owned(),
                stylesheet,
            });
        }

        Ok(patches)
    }

    fn update_passage_text(
        &mut self,
        story_id: &str,
        passage_id: &str,
        text: String,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;
        let passage_id = PassageId::new(passage_id);
        let passage = story
            .passage_by_id_mut(&passage_id)
            .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;

        if passage.text == text {
            return Ok(Vec::new());
        }

        passage.text = text.clone();
        Ok(vec![Patch::PassageUpdated {
            changes: PassagePatch {
                text: Some(text),
                ..PassagePatch::default()
            },
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.to_owned(),
        }])
    }

    fn update_story_script(
        &mut self,
        story_id: &str,
        script: String,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;

        if story.script == script {
            return Ok(Vec::new());
        }

        story.script = script.clone();
        Ok(vec![Patch::StoryScriptUpdated {
            script,
            story_id: story_id.to_owned(),
        }])
    }

    fn update_story_stylesheet(
        &mut self,
        story_id: &str,
        stylesheet: String,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;

        if story.stylesheet == stylesheet {
            return Ok(Vec::new());
        }

        story.stylesheet = stylesheet.clone();
        Ok(vec![Patch::StoryStylesheetUpdated {
            story_id: story_id.to_owned(),
            stylesheet,
        }])
    }
}

fn project_diff_patches(before: &Project, after: &Project) -> Vec<Patch> {
    let before_by_id = before
        .stories
        .iter()
        .map(|story| (story.id.as_ref().to_owned(), story))
        .collect::<BTreeMap<_, _>>();
    let after_by_id = after
        .stories
        .iter()
        .map(|story| (story.id.as_ref().to_owned(), story))
        .collect::<BTreeMap<_, _>>();
    let mut patches = Vec::new();

    for (story_id, before_story) in &before_by_id {
        match after_by_id.get(story_id) {
            Some(after_story) => patches.extend(story_diff_patches(before_story, after_story)),
            None => patches.push(Patch::StoryDeleted {
                story_id: story_id.clone(),
            }),
        }
    }

    for (story_id, after_story) in &after_by_id {
        if !before_by_id.contains_key(story_id) {
            patches.push(Patch::StoryCreated {
                story: StorySnapshot::from(*after_story),
            });
        }
    }

    patches
}

fn story_diff_patches(before: &Story, after: &Story) -> Vec<Patch> {
    let story_id = after.id.as_ref().to_owned();
    let before_by_id = before
        .passages
        .iter()
        .map(|passage| (passage.id.as_ref().to_owned(), passage))
        .collect::<BTreeMap<_, _>>();
    let after_by_id = after
        .passages
        .iter()
        .map(|passage| (passage.id.as_ref().to_owned(), passage))
        .collect::<BTreeMap<_, _>>();
    let mut patches = Vec::new();

    for (passage_id, before_passage) in &before_by_id {
        match after_by_id.get(passage_id) {
            Some(after_passage) => {
                let changes = passage_diff_patch(before_passage, after_passage);

                if !passage_patch_is_empty(&changes) {
                    patches.push(Patch::PassageUpdated {
                        changes,
                        passage_id: passage_id.clone(),
                        story_id: story_id.clone(),
                    });
                }
            }
            None => patches.push(Patch::PassageDeleted {
                passage_id: passage_id.clone(),
                story_id: story_id.clone(),
            }),
        }
    }

    for (passage_id, after_passage) in &after_by_id {
        if !before_by_id.contains_key(passage_id) {
            patches.push(Patch::PassageCreated {
                passage: PassageSnapshot::from(*after_passage),
                story_id: story_id.clone(),
            });
        }
    }

    if before.start_passage != after.start_passage {
        patches.push(Patch::StartPassageChanged {
            passage_id: after.start_passage.as_ref().to_owned(),
            story_id: story_id.clone(),
        });
    }

    let metadata = story_metadata_diff_patch(before, after);

    if !metadata.is_empty() {
        patches.push(Patch::StoryMetadataUpdated {
            changes: metadata,
            story_id: story_id.clone(),
        });
    }

    if before.script != after.script {
        patches.push(Patch::StoryScriptUpdated {
            script: after.script.clone(),
            story_id: story_id.clone(),
        });
    }

    if before.stylesheet != after.stylesheet {
        patches.push(Patch::StoryStylesheetUpdated {
            story_id,
            stylesheet: after.stylesheet.clone(),
        });
    }

    patches
}

fn passage_diff_patch(before: &Passage, after: &Passage) -> PassagePatch {
    PassagePatch {
        layout: (before.layout != after.layout)
            .then(|| after.layout.map(CoreRect::from))
            .flatten(),
        name: (before.name != after.name).then(|| after.name.clone()),
        tags: (before.tags != after.tags).then(|| after.tags.clone()),
        text: (before.text != after.text).then(|| after.text.clone()),
    }
}

fn passage_patch_is_empty(patch: &PassagePatch) -> bool {
    patch.layout.is_none() && patch.name.is_none() && patch.tags.is_none() && patch.text.is_none()
}

fn story_metadata_diff_patch(before: &Story, after: &Story) -> StoryMetadataPatch {
    StoryMetadataPatch {
        ifid: (before.ifid != after.ifid).then(|| after.ifid.clone()),
        name: (before.name != after.name).then(|| after.name.clone()),
        snap_to_grid: (before.snap_to_grid != after.snap_to_grid).then_some(after.snap_to_grid),
        story_format: (before.story_format != after.story_format)
            .then(|| after.story_format.clone()),
        story_format_version: (before.story_format_version != after.story_format_version)
            .then(|| after.story_format_version.clone()),
        tag_colors: (before.tag_colors != after.tag_colors).then(|| after.tag_colors.clone()),
        tags: (before.tags != after.tags).then(|| after.tags.clone()),
        zoom: ((before.zoom - after.zoom).abs() > f64::EPSILON).then_some(after.zoom),
    }
}

fn default_true() -> bool {
    true
}

fn default_read_model_page_limit() -> usize {
    100
}

fn default_backlinks_page_limit() -> usize {
    8
}

const MAX_READ_MODEL_PAGE_LIMIT: usize = 250;

fn read_model_query_fingerprint<T>(query: &T, clear_cursor: impl FnOnce(&mut T)) -> u64
where
    T: Clone + Serialize,
{
    let mut normalized = query.clone();

    clear_cursor(&mut normalized);
    fingerprint(&normalized)
}

fn read_model_page_offset(
    cursor: Option<&str>,
    revision: u32,
    query_fingerprint: u64,
) -> Result<usize, CoreError> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    let mut parts = cursor.split(':');
    let (Some(cursor_revision), Some(cursor_fingerprint), Some(offset), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(CoreError::StaleReadModelCursor);
    };

    match (
        cursor_revision.parse::<u32>(),
        cursor_fingerprint.parse::<u64>(),
        offset.parse::<usize>(),
    ) {
        (Ok(cursor_revision), Ok(cursor_fingerprint), Ok(offset))
            if cursor_revision == revision && cursor_fingerprint == query_fingerprint =>
        {
            Ok(offset)
        }
        _ => Err(CoreError::StaleReadModelCursor),
    }
}

fn read_model_page<T>(
    values: Vec<T>,
    offset: usize,
    requested_limit: usize,
    revision: u32,
    query_fingerprint: u64,
) -> (Vec<T>, Option<String>) {
    let limit = requested_limit.clamp(1, MAX_READ_MODEL_PAGE_LIMIT);
    let offset = offset.min(values.len());
    let end = (offset + limit).min(values.len());
    let next_cursor = (end < values.len()).then(|| format!("{revision}:{query_fingerprint}:{end}"));

    (
        values.into_iter().skip(offset).take(end - offset).collect(),
        next_cursor,
    )
}

/// Pages a borrowed cache without cloning every cached record first. The
/// temporary vector contains references only; the response owns at most the
/// requested page size.
fn read_model_page_refs<T: Clone>(
    values: Vec<&T>,
    offset: usize,
    requested_limit: usize,
    revision: u32,
    query_fingerprint: u64,
) -> (Vec<T>, Option<String>) {
    let limit = requested_limit.clamp(1, MAX_READ_MODEL_PAGE_LIMIT);
    let offset = offset.min(values.len());
    let end = (offset + limit).min(values.len());
    let next_cursor = (end < values.len()).then(|| format!("{revision}:{query_fingerprint}:{end}"));

    (
        values[offset..end]
            .iter()
            .map(|value| (*value).clone())
            .collect(),
        next_cursor,
    )
}

fn normalized_read_model_query(query: Option<&str>) -> Option<String> {
    query
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .map(str::to_lowercase)
}

fn contents_group(kind: &CoreContentsEntryKind) -> &'static str {
    match kind {
        CoreContentsEntryKind::Passage => "Passages",
        CoreContentsEntryKind::Group | CoreContentsEntryKind::Tag => "Tags",
        CoreContentsEntryKind::Variable => "Variables",
        CoreContentsEntryKind::Asset => "Assets",
        CoreContentsEntryKind::BrokenLink
        | CoreContentsEntryKind::Diagnostic
        | CoreContentsEntryKind::Orphan => "Diagnostics",
        CoreContentsEntryKind::EntryPoint
        | CoreContentsEntryKind::Metadata
        | CoreContentsEntryKind::Script
        | CoreContentsEntryKind::Stylesheet => "Project",
    }
}

fn contents_query_uses_basic_catalog(query: &CoreContentsQuery) -> bool {
    match query.filter {
        CoreContentsFilter::All => {
            matches!(query.sort, CoreContentsSort::Group | CoreContentsSort::Name)
        }
        CoreContentsFilter::EntryPoint
        | CoreContentsFilter::Group
        | CoreContentsFilter::Metadata
        | CoreContentsFilter::Passage
        | CoreContentsFilter::Script
        | CoreContentsFilter::Stylesheet
        | CoreContentsFilter::Tag => true,
        CoreContentsFilter::Asset
        | CoreContentsFilter::Diagnostics
        | CoreContentsFilter::Problems
        | CoreContentsFilter::Variable => false,
    }
}

#[allow(clippy::too_many_arguments)]
fn contents_page_from_records(
    story_id: &str,
    revision: u32,
    cursor_fingerprint: u64,
    offset: usize,
    query: &CoreContentsQuery,
    records: &BTreeMap<String, CoreContentsEntry>,
    facets: CoreContentsFacets,
    asset_inventory: &[CoreAssetInventoryEntry],
) -> CoreContentsPage {
    let mut matching = records
        .values()
        .filter(|entry| contents_filter_matches(entry, &query.filter))
        .collect::<Vec<_>>();
    if let Some(search) = normalized_read_model_query(query.query.as_deref()) {
        matching.retain(|entry| {
            entry.label.to_lowercase().contains(&search)
                || entry
                    .detail
                    .as_deref()
                    .is_some_and(|detail| detail.to_lowercase().contains(&search))
        });
    }
    sort_contents_entry_refs(&mut matching, &query.sort);
    let total_count = matching.len();
    let (entries, next_cursor) =
        read_model_page_refs(matching, offset, query.limit, revision, cursor_fingerprint);
    let asset_paths = entries
        .iter()
        .filter(|entry| entry.kind == CoreContentsEntryKind::Asset)
        .map(|entry| entry.label.as_str())
        .collect::<BTreeSet<_>>();
    let assets = asset_inventory
        .iter()
        .filter(|asset| asset_paths.contains(asset.path.as_str()))
        .cloned()
        .collect();

    CoreContentsPage {
        assets,
        entries,
        facets,
        next_cursor,
        revision,
        story_id: story_id.to_owned(),
        total_count,
    }
}

fn contents_filter_matches(entry: &CoreContentsEntry, filter: &CoreContentsFilter) -> bool {
    match filter {
        CoreContentsFilter::All => true,
        CoreContentsFilter::Asset => entry.kind == CoreContentsEntryKind::Asset,
        CoreContentsFilter::Diagnostics => matches!(
            entry.kind,
            CoreContentsEntryKind::BrokenLink
                | CoreContentsEntryKind::Diagnostic
                | CoreContentsEntryKind::Orphan
        ),
        CoreContentsFilter::EntryPoint => entry.kind == CoreContentsEntryKind::EntryPoint,
        CoreContentsFilter::Group => entry.kind == CoreContentsEntryKind::Group,
        CoreContentsFilter::Metadata => entry.kind == CoreContentsEntryKind::Metadata,
        CoreContentsFilter::Passage => entry.kind == CoreContentsEntryKind::Passage,
        CoreContentsFilter::Problems => entry.severity.is_some(),
        CoreContentsFilter::Script => entry.kind == CoreContentsEntryKind::Script,
        CoreContentsFilter::Stylesheet => entry.kind == CoreContentsEntryKind::Stylesheet,
        CoreContentsFilter::Tag => entry.kind == CoreContentsEntryKind::Tag,
        CoreContentsFilter::Variable => entry.kind == CoreContentsEntryKind::Variable,
    }
}

fn contents_facets<'a>(
    entries: impl IntoIterator<Item = &'a CoreContentsEntry>,
) -> CoreContentsFacets {
    let entries = entries.into_iter();
    let mut facets = CoreContentsFacets {
        all: entries.size_hint().0,
        ..CoreContentsFacets::default()
    };

    for entry in entries {
        match entry.kind {
            CoreContentsEntryKind::Asset => facets.asset += 1,
            CoreContentsEntryKind::BrokenLink
            | CoreContentsEntryKind::Diagnostic
            | CoreContentsEntryKind::Orphan => facets.diagnostics += 1,
            CoreContentsEntryKind::EntryPoint => facets.entry_point += 1,
            CoreContentsEntryKind::Group => facets.group += 1,
            CoreContentsEntryKind::Metadata => facets.metadata += 1,
            CoreContentsEntryKind::Passage => facets.passage += 1,
            CoreContentsEntryKind::Script => facets.script += 1,
            CoreContentsEntryKind::Stylesheet => facets.stylesheet += 1,
            CoreContentsEntryKind::Tag => facets.tag += 1,
            CoreContentsEntryKind::Variable => facets.variable += 1,
        }
        if entry.severity.is_some() {
            facets.problems += 1;
        }
    }

    facets
}

fn sort_contents_entry_refs(entries: &mut [&CoreContentsEntry], sort: &CoreContentsSort) {
    entries.sort_by(|left, right| match sort {
        CoreContentsSort::Group => contents_group(&left.kind)
            .cmp(contents_group(&right.kind))
            .then_with(|| left.label.cmp(&right.label)),
        CoreContentsSort::Issues => right
            .severity
            .is_some()
            .cmp(&left.severity.is_some())
            .then_with(|| contents_group(&left.kind).cmp(contents_group(&right.kind)))
            .then_with(|| left.label.cmp(&right.label)),
        CoreContentsSort::Name => left.label.cmp(&right.label),
    });
}

fn core_passage_link_fact(edge: &LinkEdge) -> CorePassageLinkFact {
    CorePassageLinkFact {
        broken: edge.target.is_none(),
        source_id: edge.source.as_ref().to_owned(),
        target_id: edge
            .target
            .as_ref()
            .map(|target| target.as_ref().to_owned()),
        target_name: edge.target_name.clone(),
    }
}

fn default_zoom() -> f64 {
    1.0
}

fn next_passage_id(story: &Story) -> String {
    let mut suffix = story.passage_count() + 1;

    loop {
        let candidate = format!("passage-{suffix}");

        if story
            .passages
            .iter()
            .all(|passage| passage.id.as_ref() != candidate)
        {
            return candidate;
        }

        suffix += 1;
    }
}

fn standard_link_names(text: &str) -> Vec<String> {
    parse_standard_links(
        text,
        LinkParseOptions {
            internal_only: false,
        },
    )
    .into_iter()
    .map(|link| link.target)
    .collect()
}

fn passage_is_untouched(passage: &Passage) -> bool {
    let layout = passage.layout.unwrap_or_default();

    passage.text.is_empty()
        && passage.tags.is_empty()
        && layout.width == 100.0
        && layout.height == 100.0
}

fn graph_rects_intersect(left: GraphPosition, right: GraphPosition) -> bool {
    !(right.left > left.left + left.width
        || right.left + right.width < left.left
        || right.top > left.top + left.height
        || right.top + right.height < left.top)
}

fn linked_passage_layouts(
    story: &Story,
    source: &Passage,
    count: usize,
    ignored_passage_ids: &BTreeSet<PassageId>,
) -> Vec<GraphPosition> {
    if count == 0 {
        return Vec::new();
    }

    let defaults = GraphPosition::default();
    let source = source.layout.unwrap_or_default();
    let gap = 25.0;
    let total_width = count as f64 * defaults.width + count.saturating_sub(1) as f64 * gap;
    let step = defaults.width + gap;
    let mut block = GraphPosition {
        height: defaults.height,
        left: source.left + (source.width - total_width) / 2.0,
        top: source.top + source.height + gap,
        width: total_width,
    };
    let intersects_existing = |candidate: GraphPosition| {
        story
            .passages
            .iter()
            .filter(|passage| !ignored_passage_ids.contains(&passage.id))
            .any(|passage| graph_rects_intersect(passage.layout.unwrap_or_default(), candidate))
    };

    while intersects_existing(block) {
        block.left += step;

        if !intersects_existing(block) {
            break;
        }

        block.left -= step * 2.0;

        if !intersects_existing(block) {
            break;
        }

        block.left += step;
        block.top += defaults.height + gap;
    }

    (0..count)
        .map(|index| GraphPosition {
            left: block.left + index as f64 * step,
            top: block.top,
            ..defaults
        })
        .collect()
}

fn push_dirty_patch(patches: &mut Vec<Patch>, before: bool, after: bool) {
    if before != after {
        patches.push(Patch::DirtyStateChanged { dirty: after });
    }
}

fn core_io_error(error: std::io::Error) -> CoreError {
    CoreError::Io(error.to_string())
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AssetPath {
    asset_relative_path: PathBuf,
    project_path: String,
}

impl AssetPath {
    fn parse(path: &str) -> Result<Self, CoreError> {
        let mut normalized = path.replace('\\', "/");

        while let Some(without_prefix) = normalized.strip_prefix("./") {
            normalized = without_prefix.into();
        }
        if normalized.starts_with('/') || normalized.contains('\0') || has_url_scheme(&normalized) {
            return Err(CoreError::UnsafeAssetPath(path.into()));
        }
        let mut segments = normalized.split('/').collect::<Vec<_>>();

        if segments
            .first()
            .is_some_and(|segment| segment.eq_ignore_ascii_case("assets"))
        {
            segments.remove(0);
        }
        if segments.is_empty()
            || segments.iter().any(|segment| {
                segment.is_empty() || matches!(*segment, "." | "..") || segment.contains(':')
            })
        {
            return Err(CoreError::UnsafeAssetPath(path.into()));
        }

        let mut asset_relative_path = PathBuf::new();

        for segment in segments {
            asset_relative_path.push(segment);
        }

        if asset_relative_path.as_os_str().is_empty() || asset_relative_path.file_name().is_none() {
            return Err(CoreError::UnsafeAssetPath(path.into()));
        }

        Ok(Self {
            project_path: format!("assets/{}", path_string(&asset_relative_path)),
            asset_relative_path,
        })
    }

    fn disk_path(&self, asset_root: &Path) -> PathBuf {
        asset_root.join(&self.asset_relative_path)
    }
}

fn path_string(path: &Path) -> String {
    path.iter()
        .map(|component| component.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn file_url(path: &Path) -> String {
    let mut path = path.to_string_lossy().replace('\\', "/");

    if !path.starts_with('/') {
        path = format!("/{path}");
    }

    format!("file://{}", percent_encode_file_path(&path))
}

fn percent_encode_file_path(path: &str) -> String {
    let mut output = String::new();

    for byte in path.bytes() {
        let is_unreserved =
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/' | b':');

        if is_unreserved {
            output.push(char::from(byte));
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }

    output
}

fn percent_encode_asset_reference_path(path: &str) -> String {
    let mut output = String::new();

    for byte in path.bytes() {
        let is_unreserved =
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/');

        if is_unreserved {
            output.push(char::from(byte));
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }

    output
}

fn file_asset_inventory(asset_root: &Path) -> Result<Vec<CoreAssetInventoryEntry>, CoreError> {
    let mut entries = Vec::new();

    if !asset_root.exists() {
        return Ok(entries);
    }

    collect_file_asset_inventory(asset_root, asset_root, &mut entries)?;
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

fn collect_file_asset_inventory(
    asset_root: &Path,
    current: &Path,
    entries: &mut Vec<CoreAssetInventoryEntry>,
) -> Result<(), CoreError> {
    for entry in fs::read_dir(current).map_err(core_io_error)? {
        let entry = entry.map_err(core_io_error)?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(core_io_error)?;

        if file_type.is_dir() {
            collect_file_asset_inventory(asset_root, &path, entries)?;
        } else if file_type.is_file() {
            entries.push(file_asset_inventory_entry(asset_root, &path)?);
        }
    }

    Ok(())
}

fn file_asset_inventory_entry(
    asset_root: &Path,
    disk_path: &Path,
) -> Result<CoreAssetInventoryEntry, CoreError> {
    let relative = disk_path
        .strip_prefix(asset_root)
        .map_err(|_| CoreError::UnsafeAssetPath(disk_path.to_string_lossy().into_owned()))?;
    let path = format!("assets/{}", path_string(relative));
    let kind = asset_kind_for_path(&path);
    let metadata = fs::metadata(disk_path).map_err(core_io_error)?;
    let missing = false;
    let dimensions = image_dimensions(disk_path);
    let preview_url = Some(file_url(disk_path));
    let thumbnail_url = if kind == "image" {
        preview_url.clone()
    } else {
        None
    };

    Ok(CoreAssetInventoryEntry {
        duration_ms: None,
        exists: Some(true),
        height: dimensions.map(|(_, height)| height),
        kind: kind.clone(),
        missing,
        modified_at: metadata_modified_at(&metadata),
        normalized_path: normalized_asset_path(&path),
        path: path.clone(),
        preview_url,
        publish: asset_publish_rule(&path, missing),
        reference_count: 0,
        references: Vec::new(),
        size_bytes: usize::try_from(metadata.len()).ok(),
        snippet: asset_snippet(&path, &kind),
        thumbnail_url,
        unused: true,
        width: dimensions.map(|(width, _)| width),
    })
}

fn metadata_modified_at(metadata: &fs::Metadata) -> Option<String> {
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;

    Some(duration.as_millis().to_string())
}

fn image_dimensions(path: &Path) -> Option<(usize, usize)> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();

    match extension.as_str() {
        "gif" => gif_dimensions(path),
        "jpg" | "jpeg" => jpeg_dimensions(path),
        "png" => png_dimensions(path),
        "svg" => svg_dimensions(path),
        _ => None,
    }
}

fn png_dimensions(path: &Path) -> Option<(usize, usize)> {
    let mut bytes = [0; 24];
    let mut file = fs::File::open(path).ok()?;

    file.read_exact(&mut bytes).ok()?;

    if &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }

    Some((
        u32::from_be_bytes(bytes[16..20].try_into().ok()?) as usize,
        u32::from_be_bytes(bytes[20..24].try_into().ok()?) as usize,
    ))
}

fn gif_dimensions(path: &Path) -> Option<(usize, usize)> {
    let mut bytes = [0; 10];
    let mut file = fs::File::open(path).ok()?;

    file.read_exact(&mut bytes).ok()?;

    if &bytes[0..3] != b"GIF" {
        return None;
    }

    Some((
        u16::from_le_bytes(bytes[6..8].try_into().ok()?) as usize,
        u16::from_le_bytes(bytes[8..10].try_into().ok()?) as usize,
    ))
}

fn jpeg_dimensions(path: &Path) -> Option<(usize, usize)> {
    let bytes = fs::read(path).ok()?;

    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }

    let mut index = 2;

    while index + 9 < bytes.len() {
        if bytes[index] != 0xff {
            index += 1;
            continue;
        }

        while index < bytes.len() && bytes[index] == 0xff {
            index += 1;
        }

        if index >= bytes.len() {
            return None;
        }

        let marker = bytes[index];
        index += 1;

        if marker == 0xda || marker == 0xd9 {
            return None;
        }

        if index + 2 > bytes.len() {
            return None;
        }

        let length = u16::from_be_bytes(bytes[index..index + 2].try_into().ok()?) as usize;

        if length < 2 || index + length > bytes.len() {
            return None;
        }

        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) && length >= 7
        {
            let height = u16::from_be_bytes(bytes[index + 3..index + 5].try_into().ok()?) as usize;
            let width = u16::from_be_bytes(bytes[index + 5..index + 7].try_into().ok()?) as usize;

            return Some((width, height));
        }

        index += length;
    }

    None
}

fn svg_dimensions(path: &Path) -> Option<(usize, usize)> {
    let source = fs::read_to_string(path).ok()?;

    Some((
        svg_dimension(&source, "width")?,
        svg_dimension(&source, "height")?,
    ))
}

fn svg_dimension(source: &str, attribute: &str) -> Option<usize> {
    let regex = regex::Regex::new(&format!(r#"{attribute}\s*=\s*["']([0-9]+)"#)).ok()?;
    let value = regex.captures(source)?.get(1)?.as_str();

    value.parse().ok()
}

fn clamped_char_boundary(text: &str, position: usize) -> usize {
    let mut position = position.min(text.len());

    while !text.is_char_boundary(position) {
        position -= 1;
    }

    position
}

fn replace_asset_references_in_source(
    source: &str,
    old_normalized: &str,
    new_path: &str,
    full_css_source: bool,
) -> String {
    replace_asset_references_in_source_with_mode(
        source,
        old_normalized,
        new_path,
        full_css_source,
        false,
    )
}

fn replace_asset_references_in_source_with_mode(
    source: &str,
    old_normalized: &str,
    new_path: &str,
    full_css_source: bool,
    full_script_source: bool,
) -> String {
    let source_id = if full_css_source {
        "story:stylesheet"
    } else if full_script_source {
        "story:script"
    } else {
        ""
    };
    let (references, _) = asset_reference_matches_in_source(source_id, "", source, None);
    let mut output = String::with_capacity(source.len());
    let encoded_new_path = percent_encode_asset_reference_path(new_path);
    let mut cursor = 0;
    let mut changed = false;

    for matched in references {
        let reference = matched.reference;

        if normalized_asset_path(&reference.path) != old_normalized {
            continue;
        }

        output.push_str(&source[cursor..matched.byte_start]);
        output.push_str(&encoded_new_path);
        if let Some(query) = &reference.query {
            output.push_str(query);
        }
        if let Some(fragment) = &reference.fragment {
            output.push_str(fragment);
        }
        cursor = matched.byte_end;
        changed = true;
    }

    if !changed {
        return source.into();
    }

    output.push_str(&source[cursor..]);
    output
}

/// Renderer-facing text metrics follow JavaScript and CodeMirror: characters
/// are UTF-16 code units, and a trailing newline creates an empty editor line.
fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn line_count(text: &str) -> usize {
    text.bytes().filter(|byte| *byte == b'\n').count() + 1
}

const MAX_SEARCH_HITS: usize = 500;

fn has_search_query(options: &CoreStoryIndexOptions) -> bool {
    options
        .query
        .as_deref()
        .is_some_and(|query| !query.trim().is_empty())
}

fn search_hits_in_source(
    options: &CoreStoryIndexOptions,
    search_pattern: Result<&regex::Regex, &String>,
    source_id: &str,
    source_name: &str,
    source: &str,
    scope: CoreSearchScope,
    passage_id: Option<&str>,
) -> Vec<CoreSearchHit> {
    let query = options.query.as_deref().unwrap_or_default().trim();

    if query.is_empty() || search_pattern.is_err() {
        return Vec::new();
    }

    let Ok(regex) = search_pattern else {
        return Vec::new();
    };
    let mut hits = Vec::new();

    for captures in regex.captures_iter(source).take(MAX_SEARCH_HITS) {
        let Some(matched) = captures.get(0) else {
            continue;
        };

        if matched.start() == matched.end() {
            continue;
        }

        hits.push(search_hit(
            options,
            Some(&captures),
            source_id,
            source_name,
            source,
            scope.clone(),
            passage_id,
            matched.start(),
            matched.end(),
            scope_rank(&scope) + exact_rank_bonus(matched.start()),
        ));
    }

    if hits.is_empty()
        && options.fuzzy
        && let Some((start, end, score)) = fuzzy_match(source, query, options.match_case)
    {
        hits.push(search_hit(
            options,
            None,
            source_id,
            source_name,
            source,
            scope.clone(),
            passage_id,
            start,
            end,
            scope_rank(&scope) * 0.7 + score,
        ));
    }

    hits
}

#[allow(clippy::too_many_arguments)]
fn search_hit(
    options: &CoreStoryIndexOptions,
    captures: Option<&regex::Captures<'_>>,
    source_id: &str,
    source_name: &str,
    source: &str,
    scope: CoreSearchScope,
    passage_id: Option<&str>,
    start: usize,
    end: usize,
    rank: f32,
) -> CoreSearchHit {
    let replacement = options.replacement.as_ref().map(|replacement| {
        if options.use_regexes {
            let mut expanded = String::new();

            if let Some(captures) = captures {
                captures.expand(replacement, &mut expanded);
            } else {
                expanded.push_str(replacement);
            }

            expanded
        } else {
            replacement.clone()
        }
    });
    let (before, after) = replacement
        .as_ref()
        .map(|replacement| replacement_preview(source, start, end, replacement))
        .map_or((None, None), |(before, after)| (Some(before), Some(after)));

    CoreSearchHit {
        after,
        before,
        end: utf16_offset_at(source, end),
        excerpt: excerpt_around(source, start, end.saturating_sub(start)),
        line: line_number_at(source, start),
        match_text: source[start..end].to_owned(),
        passage_id: passage_id.map(str::to_owned),
        rank,
        replacement,
        scope,
        source_id: source_id.to_owned(),
        source_name: source_name.to_owned(),
        start: utf16_offset_at(source, start),
    }
}

fn search_pattern(options: &CoreStoryIndexOptions) -> Result<regex::Regex, String> {
    let query = options.query.as_deref().unwrap_or_default().trim();

    if query.is_empty() {
        return regex::Regex::new("$^").map_err(|error| error.to_string());
    }

    let pattern = if options.use_regexes {
        query.to_owned()
    } else {
        regex::escape(query)
    };

    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!options.match_case)
        .build()
        .map_err(|error| error.to_string())
}

fn scope_rank(scope: &CoreSearchScope) -> f32 {
    match scope {
        CoreSearchScope::PassageName => 100.0,
        CoreSearchScope::PassageTag => 88.0,
        CoreSearchScope::Variable => 82.0,
        CoreSearchScope::Metadata => 78.0,
        CoreSearchScope::PassageText => 70.0,
        CoreSearchScope::Script => 62.0,
        CoreSearchScope::Stylesheet => 58.0,
        CoreSearchScope::Asset => 52.0,
    }
}

fn exact_rank_bonus(start: usize) -> f32 {
    1.0 / (1.0 + start as f32)
}

fn fuzzy_match(source: &str, query: &str, match_case: bool) -> Option<(usize, usize, f32)> {
    let needle = if match_case {
        query.chars().collect::<Vec<_>>()
    } else {
        query.chars().flat_map(char::to_lowercase).collect()
    };
    if needle.is_empty() {
        return None;
    }

    let mut needle_index = 0;
    let mut start = None;
    let mut end = 0usize;
    let mut matched = 0usize;
    let mut consider = |character, original_start, original_end| {
        if character != needle[needle_index] {
            return None;
        }

        start.get_or_insert(original_start);
        end = original_end;
        matched += 1;
        needle_index += 1;

        if needle_index == needle.len() {
            let span = end.saturating_sub(start.unwrap_or(0)).max(1);
            let density = matched as f32 / span as f32;

            Some((start.unwrap_or(0), end, density))
        } else {
            None
        }
    };

    for (original_start, character) in source.char_indices() {
        let original_end = original_start + character.len_utf8();

        if match_case {
            if let Some(result) = consider(character, original_start, original_end) {
                return Some(result);
            }
        } else {
            for normalized_character in character.to_lowercase() {
                if let Some(result) = consider(normalized_character, original_start, original_end) {
                    return Some(result);
                }
            }
        }
    }

    None
}

fn replacement_preview(
    source: &str,
    start: usize,
    end: usize,
    replacement: &str,
) -> (String, String) {
    let line_start = source[..start].rfind('\n').map_or(0, |index| index + 1);
    let line_end = source[start..]
        .find('\n')
        .map_or(source.len(), |index| start + index);
    let before = source[line_start..line_end].trim().to_owned();
    let mut after = String::new();

    after.push_str(&source[line_start..start]);
    after.push_str(replacement);
    after.push_str(&source[end..line_end]);

    (before, after.trim().to_owned())
}

fn line_number_at(source: &str, start: usize) -> usize {
    source[..start]
        .chars()
        .filter(|character| *character == '\n')
        .count()
        + 1
}

fn excerpt_around(source: &str, start: usize, length: usize) -> String {
    let line_start = source[..start].rfind('\n').map_or(0, |index| index + 1);
    let line_end = source[start..]
        .find('\n')
        .map_or(source.len(), |index| start + index);
    let excerpt = source[line_start..line_end].trim();

    if excerpt.len() <= 140 {
        return excerpt.into();
    }

    let window_start = clamped_char_boundary(source, start.saturating_sub(48)).max(line_start);
    let window_end = clamped_char_boundary(
        source,
        start
            .saturating_add(length)
            .saturating_add(48)
            .min(line_end),
    );
    let mut result = String::new();

    if window_start > line_start {
        result.push_str("...");
    }

    result.push_str(source[window_start..window_end].trim());

    if window_end < line_end {
        result.push_str("...");
    }

    result
}

fn story_metadata_source(story: &Story) -> String {
    format!(
        "Name: {}\nIFID: {}\nStory format: {} {}\nStory tags: {}",
        story.name,
        story.ifid,
        story.story_format,
        story.story_format_version,
        story.tags.join(", ")
    )
}

fn symbols_in_source(
    source_id: &str,
    source_name: &str,
    source: &str,
    scope: CoreSearchScope,
    passage_id: Option<&str>,
) -> Vec<CoreSymbol> {
    let mut symbols = Vec::new();
    let bytes = source.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        let prefix = bytes[index];

        if prefix == b'$'
            && (index == 0 || !is_identifier_byte(bytes[index.saturating_sub(1)]))
            && bytes
                .get(index + 1)
                .is_some_and(|byte| is_identifier_start(*byte))
        {
            let start = index;

            index += 2;
            while bytes
                .get(index)
                .is_some_and(|byte| is_identifier_byte(*byte))
            {
                index += 1;
            }

            while bytes.get(index) == Some(&b'.')
                && bytes
                    .get(index + 1)
                    .is_some_and(|byte| is_identifier_start(*byte))
            {
                index += 2;
                while bytes
                    .get(index)
                    .is_some_and(|byte| is_identifier_byte(*byte))
                {
                    index += 1;
                }
            }

            if symbol_name_has_identifier_body(&source[start + 1..index]) {
                symbols.push(CoreSymbol {
                    end: index,
                    excerpt: excerpt_around(source, start, index - start),
                    kind: CoreSymbolKind::Variable,
                    line: line_number_at(source, start),
                    name: source[start..index].to_owned(),
                    passage_id: passage_id.map(str::to_owned),
                    scope: scope.clone(),
                    source_id: source_id.to_owned(),
                    source_name: source_name.to_owned(),
                    start,
                });
            }
            continue;
        }

        index += 1;
    }

    symbols
}

fn symbol_name_has_identifier_body(name_without_sigil: &str) -> bool {
    name_without_sigil
        .bytes()
        .any(|byte| byte.is_ascii_alphanumeric())
}

fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

struct AssetReferenceMatch {
    byte_end: usize,
    byte_start: usize,
    reference: CoreAssetReference,
}

#[derive(Clone, Copy, Default)]
struct SourceRangeMetrics {
    end_utf16: usize,
    line: usize,
    start_utf16: usize,
}

fn source_range_metrics(
    source: &str,
    ranges: &[(usize, usize)],
) -> (Vec<Option<SourceRangeMetrics>>, usize) {
    let mut boundaries = Vec::with_capacity(ranges.len() * 2);
    let mut valid = vec![false; ranges.len()];

    for (index, (start, end)) in ranges.iter().copied().enumerate() {
        if start > end
            || end > source.len()
            || !source.is_char_boundary(start)
            || !source.is_char_boundary(end)
        {
            continue;
        }
        valid[index] = true;
        boundaries.push((start, index, false));
        boundaries.push((end, index, true));
    }
    boundaries.sort_unstable_by_key(|(offset, _, _)| *offset);

    let mut metrics = vec![SourceRangeMetrics::default(); ranges.len()];
    let mut byte_cursor = 0;
    let mut line = 1;
    let mut scanned_characters = 0;
    let mut utf16_offset = 0;

    for (offset, range_index, is_end) in boundaries {
        for character in source[byte_cursor..offset].chars() {
            utf16_offset += character.len_utf16();
            line += usize::from(character == '\n');
            scanned_characters += 1;
        }
        byte_cursor = offset;
        if is_end {
            metrics[range_index].end_utf16 = utf16_offset;
        } else {
            metrics[range_index].line = line;
            metrics[range_index].start_utf16 = utf16_offset;
        }
    }

    (
        metrics
            .into_iter()
            .zip(valid)
            .map(|(metrics, valid)| valid.then_some(metrics))
            .collect(),
        scanned_characters,
    )
}

fn asset_reference_matches_in_source(
    source_id: &str,
    source_name: &str,
    source: &str,
    passage_id: Option<&str>,
) -> (Vec<AssetReferenceMatch>, usize) {
    #[derive(Clone, Debug)]
    struct Candidate {
        context: &'static str,
        end: usize,
        semantic: Option<String>,
        semantic_entities: Vec<HtmlEntitySegment>,
        start: usize,
    }

    #[derive(Clone, Debug)]
    struct HtmlEntitySegment {
        decoded_end: usize,
        decoded_start: usize,
        raw_end: usize,
        raw_start: usize,
    }

    #[derive(Clone, Debug)]
    struct DecodedSourceValue {
        end: usize,
        entities: Vec<HtmlEntitySegment>,
        start: usize,
        value: String,
    }

    fn first_entity_ending_at_or_after(entities: &[HtmlEntitySegment], offset: usize) -> usize {
        let mut low = 0;
        let mut high = entities.len();

        while low < high {
            let middle = low + (high - low) / 2;
            #[cfg(test)]
            record_asset_entity_projection_step();
            if entities[middle].decoded_end < offset {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        low
    }

    fn first_entity_ending_after(entities: &[HtmlEntitySegment], offset: usize) -> usize {
        let mut low = 0;
        let mut high = entities.len();

        while low < high {
            let middle = low + (high - low) / 2;
            #[cfg(test)]
            record_asset_entity_projection_step();
            if entities[middle].decoded_end <= offset {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        low
    }

    fn first_entity_starting_at_or_after(entities: &[HtmlEntitySegment], offset: usize) -> usize {
        let mut low = 0;
        let mut high = entities.len();

        while low < high {
            let middle = low + (high - low) / 2;
            #[cfg(test)]
            record_asset_entity_projection_step();
            if entities[middle].decoded_start < offset {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        low
    }

    fn decoded_boundary_to_raw(value: &DecodedSourceValue, offset: usize) -> Option<usize> {
        let index = first_entity_ending_at_or_after(&value.entities, offset);
        let delta = if index == 0 {
            value.start
        } else {
            value.entities[index - 1]
                .raw_end
                .checked_sub(value.entities[index - 1].decoded_end)?
        };
        let Some(entity) = value.entities.get(index) else {
            return delta.checked_add(offset);
        };

        if offset < entity.decoded_start {
            return delta.checked_add(offset);
        }
        if offset == entity.decoded_start {
            return Some(entity.raw_start);
        }
        if offset < entity.decoded_end {
            return None;
        }
        Some(entity.raw_end)
    }

    fn project_decoded_source_value(
        value: &DecodedSourceValue,
        start: usize,
        end: usize,
    ) -> Option<DecodedSourceValue> {
        if start > end || !value.value.is_char_boundary(start) || !value.value.is_char_boundary(end)
        {
            return None;
        }
        let raw_start = decoded_boundary_to_raw(value, start)?;
        let raw_end = decoded_boundary_to_raw(value, end)?;
        let entity_start = first_entity_ending_after(&value.entities, start);
        let entity_end = first_entity_starting_at_or_after(&value.entities, end);
        let entities = value.entities[entity_start..entity_end]
            .iter()
            .cloned()
            .map(|mut entity| {
                entity.decoded_start -= start;
                entity.decoded_end -= start;
                entity
            })
            .collect();

        Some(DecodedSourceValue {
            end: raw_end,
            entities,
            start: raw_start,
            value: value.value[start..end].into(),
        })
    }

    fn numeric_html_reference(code: u32) -> char {
        let code = if code == 0 || code > 0x10_ffff || (0xd800..=0xdfff).contains(&code) {
            0xfffd
        } else if (0x80..=0x9f).contains(&code) {
            C1_REPLACEMENTS[(code - 0x80) as usize]
                .map(u32::from)
                .unwrap_or(code)
        } else {
            code
        };

        char::from_u32(code).unwrap_or('\u{fffd}')
    }

    fn html_character_reference(raw: &str, cursor: usize) -> Option<(String, usize)> {
        let bytes = raw.as_bytes();
        if bytes.get(cursor) != Some(&b'&') {
            return None;
        }
        if bytes.get(cursor + 1) == Some(&b'#') {
            let mut index = cursor + 2;
            let hexadecimal = bytes
                .get(index)
                .is_some_and(|byte| matches!(*byte, b'x' | b'X'));
            if hexadecimal {
                index += 1;
            }
            let digit_start = index;
            let mut value = 0_u32;
            let mut overflow = false;

            while let Some(byte) = bytes.get(index).copied() {
                let digit = if hexadecimal {
                    byte.to_ascii_lowercase()
                        .checked_sub(b'0')
                        .and_then(|digit| {
                            if digit <= 9 {
                                Some(u32::from(digit))
                            } else if (b'a'..=b'f').contains(&byte.to_ascii_lowercase()) {
                                Some(u32::from(byte.to_ascii_lowercase() - b'a' + 10))
                            } else {
                                None
                            }
                        })
                } else {
                    byte.is_ascii_digit().then_some(u32::from(byte - b'0'))
                };
                let Some(digit) = digit else {
                    break;
                };
                value = value
                    .checked_mul(if hexadecimal { 16 } else { 10 })
                    .and_then(|value| value.checked_add(digit))
                    .unwrap_or_else(|| {
                        overflow = true;
                        0x11_0000
                    });
                index += 1;
            }
            if index == digit_start {
                return None;
            }
            if bytes.get(index) == Some(&b';') {
                index += 1;
            }
            let character = numeric_html_reference(if overflow { 0x11_0000 } else { value });

            return Some((character.to_string(), index - cursor));
        }

        let name_start = cursor + 1;
        let mut index = name_start;
        let mut matched = None;
        while index < bytes.len() && index - name_start <= 64 {
            let byte = bytes[index];
            if byte.is_ascii_alphanumeric() {
                index += 1;
            } else if byte == b';' {
                index += 1;
                if let Some(&(first, second)) = NAMED_ENTITIES
                    .get(&raw[name_start..index])
                    .filter(|(first, _)| *first != 0)
                {
                    matched = Some((index, first, second));
                }
                break;
            } else {
                break;
            }
            if let Some(&(first, second)) = NAMED_ENTITIES
                .get(&raw[name_start..index])
                .filter(|(first, _)| *first != 0)
            {
                matched = Some((index, first, second));
            }
        }
        let (end, first, second) = matched?;
        if bytes.get(end - 1) != Some(&b';')
            && bytes
                .get(end)
                .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'=')
        {
            return None;
        }
        let mut decoded = String::new();
        decoded.push(char::from_u32(first).unwrap_or('\u{fffd}'));
        if second != 0 {
            decoded.push(char::from_u32(second).unwrap_or('\u{fffd}'));
        }

        Some((decoded, end - cursor))
    }

    fn decode_html_attribute_value(raw: &str, raw_start: usize) -> DecodedSourceValue {
        if !raw.contains('&') {
            return DecodedSourceValue {
                end: raw_start + raw.len(),
                entities: Vec::new(),
                start: raw_start,
                value: raw.into(),
            };
        }
        let mut cursor = 0;
        let mut decoded = String::new();
        let mut entities = Vec::new();

        while cursor < raw.len() {
            let Some(relative_ampersand) = raw[cursor..].find('&') else {
                decoded.push_str(&raw[cursor..]);
                break;
            };
            let ampersand = cursor + relative_ampersand;
            decoded.push_str(&raw[cursor..ampersand]);
            cursor = ampersand;
            if let Some((entity, consumed)) = html_character_reference(raw, cursor) {
                let decoded_start = decoded.len();
                decoded.push_str(&entity);
                entities.push(HtmlEntitySegment {
                    decoded_end: decoded.len(),
                    decoded_start,
                    raw_end: raw_start + cursor + consumed,
                    raw_start: raw_start + cursor,
                });
                cursor += consumed;
            } else {
                decoded.push('&');
                cursor += 1;
            }
        }

        DecodedSourceValue {
            end: raw_start + raw.len(),
            entities,
            start: raw_start,
            value: decoded,
        }
    }

    fn candidate_from_decoded(value: DecodedSourceValue, context: &'static str) -> Candidate {
        Candidate {
            context,
            end: value.end,
            semantic: Some(value.value),
            semantic_entities: value.entities,
            start: value.start,
        }
    }

    fn candidate_raw_boundary(candidate: &Candidate, offset: usize) -> Option<usize> {
        let mut delta = candidate.start;

        for entity in &candidate.semantic_entities {
            if offset < entity.decoded_start {
                return delta.checked_add(offset);
            }
            if offset == entity.decoded_start {
                return Some(entity.raw_start);
            }
            if offset < entity.decoded_end {
                return None;
            }
            if offset == entity.decoded_end {
                return Some(entity.raw_end);
            }
            delta = entity.raw_end.checked_sub(entity.decoded_end)?;
        }
        delta.checked_add(offset)
    }

    fn trimmed_candidate(value: &DecodedSourceValue, context: &'static str) -> Option<Candidate> {
        let (start, end) = url_trimmed_bounds(&value.value);
        let trimmed = &value.value[start..end];
        let projected = project_decoded_source_value(value, start, end)?;

        (!trimmed.is_empty()).then(|| candidate_from_decoded(projected, context))
    }

    fn html_space(byte: u8) -> bool {
        matches!(byte, b'\t' | b'\n' | 0x0c | b'\r' | b' ')
    }

    fn declarative_refresh_url_range(input: &str) -> Option<(usize, usize)> {
        let bytes = input.as_bytes();
        let mut cursor = 0;

        while bytes.get(cursor).is_some_and(|byte| html_space(*byte)) {
            cursor += 1;
        }
        let integer_start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        if cursor == integer_start && bytes.get(cursor) != Some(&b'.') {
            return None;
        }
        while bytes
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_digit() || *byte == b'.')
        {
            cursor += 1;
        }
        let separator = *bytes.get(cursor)?;
        if !matches!(separator, b';' | b',') && !html_space(separator) {
            return None;
        }
        while bytes.get(cursor).is_some_and(|byte| html_space(*byte)) {
            cursor += 1;
        }
        if bytes
            .get(cursor)
            .is_some_and(|byte| matches!(*byte, b';' | b','))
        {
            cursor += 1;
        }
        while bytes.get(cursor).is_some_and(|byte| html_space(*byte)) {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            return None;
        }

        let original_start = cursor;
        if bytes[cursor].eq_ignore_ascii_case(&b'u') {
            let mut url_cursor = cursor + 1;

            if !bytes
                .get(url_cursor)
                .is_some_and(|byte| byte.eq_ignore_ascii_case(&b'r'))
            {
                return Some((original_start, bytes.len()));
            }
            url_cursor += 1;
            if !bytes
                .get(url_cursor)
                .is_some_and(|byte| byte.eq_ignore_ascii_case(&b'l'))
            {
                return Some((original_start, bytes.len()));
            }
            url_cursor += 1;
            while bytes.get(url_cursor).is_some_and(|byte| html_space(*byte)) {
                url_cursor += 1;
            }
            if bytes.get(url_cursor) != Some(&b'=') {
                return Some((original_start, bytes.len()));
            }
            cursor = url_cursor + 1;
            while bytes.get(cursor).is_some_and(|byte| html_space(*byte)) {
                cursor += 1;
            }
        }

        let quote = bytes
            .get(cursor)
            .copied()
            .filter(|byte| matches!(*byte, b'\'' | b'"'));
        if quote.is_some() {
            cursor += 1;
        }
        let end = quote
            .and_then(|quote| bytes[cursor..].iter().position(|byte| *byte == quote))
            .map_or(bytes.len(), |offset| cursor + offset);

        Some((cursor, end))
    }

    fn srcset_candidates(value: &DecodedSourceValue) -> Vec<Candidate> {
        let mut candidates = Vec::new();
        let bytes = value.value.as_bytes();
        let mut cursor = 0;

        while cursor < bytes.len() {
            while bytes
                .get(cursor)
                .is_some_and(|byte| html_space(*byte) || *byte == b',')
            {
                cursor += 1;
            }
            if cursor >= bytes.len() {
                break;
            }

            let start = cursor;
            while bytes.get(cursor).is_some_and(|byte| !html_space(*byte)) {
                cursor += 1;
            }
            let mut end = cursor;
            let mut trailing_comma = false;
            while end > start && bytes[end - 1] == b',' {
                trailing_comma = true;
                end -= 1;
            }
            if !trailing_comma {
                enum DescriptorState {
                    AfterDescriptor,
                    InDescriptor,
                    InParens,
                }
                let mut state = DescriptorState::InDescriptor;

                while let Some(byte) = bytes.get(cursor).copied() {
                    match state {
                        DescriptorState::InParens => {
                            cursor += 1;
                            if byte == b')' {
                                state = DescriptorState::InDescriptor;
                            }
                        }
                        DescriptorState::AfterDescriptor if html_space(byte) => cursor += 1,
                        DescriptorState::AfterDescriptor => {
                            state = DescriptorState::InDescriptor;
                        }
                        DescriptorState::InDescriptor if byte == b',' => {
                            cursor += 1;
                            break;
                        }
                        DescriptorState::InDescriptor => {
                            cursor += 1;
                            if byte == b'(' {
                                state = DescriptorState::InParens;
                            } else if html_space(byte) {
                                state = DescriptorState::AfterDescriptor;
                            }
                        }
                    }
                }
            }
            if end == start {
                continue;
            }
            let token = &value.value[start..end];
            let ignored = token.get(..5).is_some_and(|prefix| {
                prefix.eq_ignore_ascii_case("data:") || prefix.eq_ignore_ascii_case("blob:")
            });

            if !ignored && let Some(projected) = project_decoded_source_value(value, start, end) {
                candidates.push(candidate_from_decoded(projected, "html-srcset"));
            }
        }

        candidates
    }

    fn explicitly_managed_asset_reference(value: &str) -> bool {
        let preprocessed = url_preprocessed_value(value);
        let (source_path, _, _) = asset_reference_parts(&preprocessed);

        parsed_local_asset_path(source_path)
            .is_some_and(|(_, explicitly_managed)| explicitly_managed)
    }

    fn context_supports_arbitrary_asset(context: &str, original: &str) -> bool {
        matches!(
            context,
            "css-import"
                | "css-url"
                | "html-background"
                | "html-poster"
                | "html-src"
                | "html-srcset"
                | "html-href"
                | "html-data"
                | "html-refresh"
        ) || explicitly_managed_asset_reference(original)
    }

    fn css_name_byte(byte: u8) -> bool {
        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
    }

    fn css_whitespace(byte: u8) -> bool {
        matches!(byte, b'\t' | b'\n' | 0x0c | b'\r' | b' ')
    }

    fn css_comment_end(bytes: &[u8], start: usize) -> Option<usize> {
        let mut cursor = start + 2;

        while cursor + 1 < bytes.len() {
            if bytes[cursor] == b'*' && bytes[cursor + 1] == b'/' {
                return Some(cursor + 2);
            }
            cursor += 1;
        }
        None
    }

    fn skip_css_trivia(
        bytes: &[u8],
        start: usize,
        ignored_spans: &mut Vec<(usize, usize)>,
    ) -> Option<usize> {
        let mut cursor = start;

        while cursor < bytes.len() {
            if css_whitespace(bytes[cursor]) {
                cursor += 1;
                continue;
            }
            if bytes[cursor] == b'/' && bytes.get(cursor + 1) == Some(&b'*') {
                let Some(end) = css_comment_end(bytes, cursor) else {
                    ignored_spans.push((cursor, bytes.len()));
                    return None;
                };
                ignored_spans.push((cursor, end));
                cursor = end;
                continue;
            }
            break;
        }

        Some(cursor)
    }

    #[derive(Default)]
    struct SortedSpanCursor {
        index: usize,
    }

    impl SortedSpanCursor {
        fn overlaps(&mut self, start: usize, end: usize, spans: &[(usize, usize)]) -> bool {
            while spans
                .get(self.index)
                .is_some_and(|(_, span_end)| *span_end <= start)
            {
                self.index += 1;
            }

            spans
                .get(self.index)
                .is_some_and(|(span_start, span_end)| start < *span_end && end > *span_start)
        }
    }

    #[derive(Default)]
    struct CssLexicalRanges {
        complete: bool,
        ignored_spans: Vec<(usize, usize)>,
        import_ranges: Vec<(usize, usize)>,
        url_ranges: Vec<(usize, usize)>,
    }

    #[derive(Clone, Debug)]
    struct SemanticSourceRange {
        end: usize,
        semantic: Option<String>,
        semantic_entities: Vec<HtmlEntitySegment>,
        start: usize,
    }

    #[derive(Default)]
    struct CssSourceRanges {
        complete: bool,
        context_spans: Vec<(usize, usize)>,
        ignored_spans: Vec<(usize, usize)>,
        import_ranges: Vec<SemanticSourceRange>,
        url_ranges: Vec<SemanticSourceRange>,
    }

    #[derive(Clone, Debug)]
    struct HtmlAssetAttribute {
        attribute: String,
        value: DecodedSourceValue,
    }

    #[derive(Default)]
    struct HtmlLexicalScan {
        attributes: Vec<HtmlAssetAttribute>,
        complete: bool,
        ignored_fallback_spans: Vec<(usize, usize)>,
        style_attributes: Vec<DecodedSourceValue>,
        style_contents: Vec<(usize, usize)>,
    }

    fn lexical_css_url_ranges(source: &str) -> CssLexicalRanges {
        const MAX_CSS_FUNCTION_DEPTH: usize = 256;

        struct CssFunctionContext {
            image_set: bool,
            option_start: bool,
        }

        let bytes = source.as_bytes();
        let mut ignored_spans = Vec::new();
        let mut import_ranges = Vec::new();
        let mut ranges = Vec::new();
        let mut functions: Vec<CssFunctionContext> = Vec::new();
        let mut complete = true;
        let mut cursor = 0;

        'scan: while cursor < bytes.len() {
            if bytes[cursor] == b'/' && bytes.get(cursor + 1) == Some(&b'*') {
                let Some(end) = css_comment_end(bytes, cursor) else {
                    ignored_spans.push((cursor, bytes.len()));
                    break;
                };
                ignored_spans.push((cursor, end));
                cursor = end;
                continue;
            }
            let quote = bytes[cursor];
            if quote == b'\\' {
                complete = false;
                cursor = (cursor + 2).min(bytes.len());
                continue;
            }
            if bytes[cursor] == b'@'
                && bytes
                    .get(cursor + 1)
                    .is_some_and(|byte| css_name_byte(*byte))
            {
                if let Some(context) = functions.last_mut()
                    && context.image_set
                    && context.option_start
                {
                    context.option_start = false;
                }
                let mut name = Vec::new();
                let mut name_end = cursor + 1;
                let mut name_complete = true;

                while name_end < bytes.len() {
                    if css_name_byte(bytes[name_end]) {
                        name.push(bytes[name_end]);
                        name_end += 1;
                        continue;
                    }
                    if bytes[name_end] == b'/' && bytes.get(name_end + 1) == Some(&b'*') {
                        let Some(end) = css_comment_end(bytes, name_end) else {
                            ignored_spans.push((name_end, bytes.len()));
                            name_complete = false;
                            name_end = bytes.len();
                            break;
                        };
                        ignored_spans.push((name_end, end));
                        name_end = end;
                        continue;
                    }
                    if bytes[name_end] == b'\\' {
                        complete = false;
                        break 'scan;
                    }
                    break;
                }
                if !name_complete {
                    complete = false;
                    break;
                }
                if name.eq_ignore_ascii_case(b"import") {
                    let Some(quote_start) = skip_css_trivia(bytes, name_end, &mut ignored_spans)
                    else {
                        complete = false;
                        break;
                    };
                    if bytes
                        .get(quote_start)
                        .is_some_and(|byte| matches!(*byte, b'\'' | b'"'))
                    {
                        let import_quote = bytes[quote_start];
                        let mut end = quote_start + 1;
                        let mut valid = true;

                        while end < bytes.len() && bytes[end] != import_quote {
                            if bytes[end] == b'\\' {
                                valid = false;
                                complete = false;
                                end = (end + 2).min(bytes.len());
                            } else {
                                end += 1;
                            }
                        }
                        let closed = bytes.get(end) == Some(&import_quote);

                        ignored_spans
                            .push((quote_start, if closed { end + 1 } else { bytes.len() }));
                        if valid && closed && end > quote_start + 1 {
                            import_ranges.push((quote_start + 1, end));
                        }
                        cursor = if closed { end + 1 } else { bytes.len() };
                        continue;
                    }
                }
                cursor = name_end.max(cursor + 1);
                continue;
            }
            let apostrophe_in_word = quote == b'\''
                && source[..cursor]
                    .chars()
                    .next_back()
                    .is_some_and(|character| character.is_alphanumeric() || character == '_');

            if matches!(quote, b'\'' | b'"' | b'`') && !apostrophe_in_word {
                let start = cursor;
                let image_set_option = matches!(quote, b'\'' | b'"')
                    && functions
                        .last()
                        .is_some_and(|context| context.image_set && context.option_start);
                let mut escaped = false;

                cursor += 1;
                while cursor < bytes.len() {
                    if bytes[cursor] == b'\\' {
                        escaped = true;
                        cursor = (cursor + 2).min(bytes.len());
                        continue;
                    }
                    let current = bytes[cursor];
                    cursor += 1;
                    if current == quote {
                        break;
                    }
                }
                ignored_spans.push((start, cursor));
                if image_set_option && escaped {
                    complete = false;
                }
                if image_set_option
                    && !escaped
                    && cursor > start + 2
                    && bytes.get(cursor - 1) == Some(&quote)
                {
                    ranges.push((start + 1, cursor - 1));
                }
                if let Some(context) = functions.last_mut()
                    && context.image_set
                {
                    context.option_start = false;
                }
                continue;
            }
            if bytes[cursor] == b'(' {
                if let Some(context) = functions.last_mut()
                    && context.image_set
                    && context.option_start
                {
                    context.option_start = false;
                }
                if functions.len() >= MAX_CSS_FUNCTION_DEPTH {
                    complete = false;
                    break 'scan;
                }
                functions.push(CssFunctionContext {
                    image_set: false,
                    option_start: false,
                });
                cursor += 1;
                continue;
            }
            if bytes[cursor] == b')' {
                functions.pop();
                cursor += 1;
                continue;
            }
            if bytes[cursor] == b',' {
                if let Some(context) = functions.last_mut()
                    && context.image_set
                {
                    context.option_start = true;
                }
                cursor += 1;
                continue;
            }
            if css_name_byte(bytes[cursor]) && (cursor == 0 || !css_name_byte(bytes[cursor - 1])) {
                let mut name = Vec::new();
                let mut name_end = cursor;
                let mut name_complete = true;

                while name_end < bytes.len() {
                    if css_name_byte(bytes[name_end]) {
                        name.push(bytes[name_end]);
                        name_end += 1;
                        continue;
                    }
                    if bytes[name_end] == b'/' && bytes.get(name_end + 1) == Some(&b'*') {
                        let Some(end) = css_comment_end(bytes, name_end) else {
                            ignored_spans.push((name_end, bytes.len()));
                            name_complete = false;
                            name_end = bytes.len();
                            break;
                        };
                        ignored_spans.push((name_end, end));
                        name_end = end;
                        continue;
                    }
                    if bytes[name_end] == b'\\' {
                        complete = false;
                        break 'scan;
                    }
                    break;
                }
                if !name_complete {
                    complete = false;
                    break;
                }
                let Some(open) = skip_css_trivia(bytes, name_end, &mut ignored_spans) else {
                    complete = false;
                    break;
                };
                if bytes.get(open) != Some(&b'(') {
                    if let Some(context) = functions.last_mut()
                        && context.image_set
                        && context.option_start
                    {
                        context.option_start = false;
                    }
                    cursor = name_end.max(cursor + 1);
                    continue;
                }
                if !name.eq_ignore_ascii_case(b"url") {
                    if let Some(context) = functions.last_mut()
                        && context.image_set
                        && context.option_start
                    {
                        context.option_start = false;
                    }
                    let image_set = name.eq_ignore_ascii_case(b"image-set")
                        || name.eq_ignore_ascii_case(b"-webkit-image-set");

                    if functions.len() >= MAX_CSS_FUNCTION_DEPTH {
                        complete = false;
                        break 'scan;
                    }
                    functions.push(CssFunctionContext {
                        image_set,
                        option_start: image_set,
                    });
                    cursor = open + 1;
                    continue;
                }
                if let Some(context) = functions.last_mut()
                    && context.image_set
                    && context.option_start
                {
                    context.option_start = false;
                }
                let Some(mut value_start) = skip_css_trivia(bytes, open + 1, &mut ignored_spans)
                else {
                    complete = false;
                    break;
                };
                let mut value_end = value_start;
                let mut end = value_start;
                let mut valid = true;

                if bytes
                    .get(value_start)
                    .is_some_and(|byte| matches!(*byte, b'\'' | b'"'))
                {
                    let value_quote = bytes[value_start];
                    value_start += 1;
                    end = value_start;
                    while end < bytes.len() && bytes[end] != value_quote {
                        if bytes[end] == b'\\' {
                            valid = false;
                            complete = false;
                            end = (end + 2).min(bytes.len());
                        } else {
                            end += 1;
                        }
                    }
                    value_end = end;
                    let closed = bytes.get(end) == Some(&value_quote);
                    if closed {
                        end += 1;
                    }
                    let Some(trivia_end) = skip_css_trivia(bytes, end, &mut ignored_spans) else {
                        complete = false;
                        break;
                    };
                    end = trivia_end;
                    valid = valid && closed && bytes.get(end) == Some(&b')');
                } else {
                    while end < bytes.len() && bytes[end] != b')' {
                        if css_whitespace(bytes[end])
                            || (bytes[end] == b'/' && bytes.get(end + 1) == Some(&b'*'))
                        {
                            value_end = end;
                            let Some(trivia_end) = skip_css_trivia(bytes, end, &mut ignored_spans)
                            else {
                                valid = false;
                                complete = false;
                                end = bytes.len();
                                break;
                            };
                            end = trivia_end;
                            valid = valid && bytes.get(end) == Some(&b')');
                            break;
                        }
                        if matches!(bytes[end], b'\\' | b'\'' | b'"')
                            || (bytes[end] == b'/' && bytes.get(end + 1) == Some(&b'*'))
                        {
                            valid = false;
                            if bytes[end] == b'\\' {
                                complete = false;
                            }
                        }
                        end += 1;
                    }
                    if value_end == value_start {
                        value_end = end;
                    }
                    valid = valid && bytes.get(end) == Some(&b')');
                }
                while value_start < value_end && css_whitespace(bytes[value_start]) {
                    value_start += 1;
                }
                while value_end > value_start && css_whitespace(bytes[value_end - 1]) {
                    value_end -= 1;
                }
                if valid && value_end > value_start {
                    ranges.push((value_start, value_end));
                }
                cursor = if bytes.get(end) == Some(&b')') {
                    end + 1
                } else {
                    end.max(open + 1)
                };
                continue;
            }
            if let Some(context) = functions.last_mut()
                && context.image_set
                && context.option_start
                && !css_whitespace(bytes[cursor])
            {
                context.option_start = false;
            }
            cursor += 1;
        }

        CssLexicalRanges {
            complete,
            ignored_spans,
            import_ranges,
            url_ranges: ranges,
        }
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum HtmlNamespace {
        Html,
        Math,
        Svg,
    }

    struct HtmlOpenElement {
        html_integration_point: bool,
        math_text_integration_point: bool,
        namespace: HtmlNamespace,
        tag: String,
    }

    struct ParsedHtmlAttribute {
        name: String,
        value: Option<DecodedSourceValue>,
    }

    #[derive(Default)]
    struct LinkRelationClassification {
        href: bool,
        imagesrcset: bool,
        unknown: bool,
    }

    fn classify_html_link_relations(rel: &str, as_value: &str) -> LinkRelationClassification {
        let mut preload = false;
        let mut resource = false;
        let mut unknown = false;

        for relation in rel.split(['\t', '\n', '\u{000C}', '\r', ' ']) {
            if relation.is_empty() {
                continue;
            }
            let relation = relation.to_ascii_lowercase();
            if matches!(
                relation.as_str(),
                "apple-touch-icon"
                    | "apple-touch-icon-precomposed"
                    | "compression-dictionary"
                    | "dns-prefetch"
                    | "icon"
                    | "manifest"
                    | "mask-icon"
                    | "modulepreload"
                    | "pingback"
                    | "preconnect"
                    | "prefetch"
                    | "preload"
                    | "stylesheet"
            ) {
                resource = true;
                preload |= relation == "preload";
            } else if !matches!(
                relation.as_str(),
                "alternate"
                    | "author"
                    | "bookmark"
                    | "canonical"
                    | "expect"
                    | "external"
                    | "help"
                    | "license"
                    | "next"
                    | "nofollow"
                    | "noopener"
                    | "noreferrer"
                    | "opener"
                    | "prev"
                    | "privacy-policy"
                    | "search"
                    | "shortcut"
                    | "sponsored"
                    | "tag"
                    | "terms-of-service"
                    | "ugc"
            ) {
                unknown = true;
            }
        }
        LinkRelationClassification {
            href: resource,
            imagesrcset: preload && as_value.eq_ignore_ascii_case("image"),
            unknown: unknown && !resource,
        }
    }

    fn decoded_html_attribute(name: &str) -> bool {
        matches!(
            name,
            "as" | "background"
                | "clip-path"
                | "content"
                | "cursor"
                | "data"
                | "encoding"
                | "fill"
                | "filter"
                | "href"
                | "http-equiv"
                | "imagesrcset"
                | "marker"
                | "marker-end"
                | "marker-mid"
                | "marker-start"
                | "mask"
                | "poster"
                | "rel"
                | "src"
                | "srcset"
                | "stroke"
                | "style"
                | "type"
                | "xlink:href"
        )
    }

    fn svg_css_presentation_attribute(name: &str) -> bool {
        matches!(
            name,
            "clip-path"
                | "cursor"
                | "fill"
                | "filter"
                | "marker"
                | "marker-end"
                | "marker-mid"
                | "marker-start"
                | "mask"
                | "stroke"
        )
    }

    fn html_asset_attribute(tag: &str, attribute: &str, input_type: &str) -> bool {
        let tag = if tag == "image" { "img" } else { tag };

        if attribute == "background"
            && matches!(
                tag,
                "body" | "table" | "tbody" | "td" | "tfoot" | "th" | "thead" | "tr"
            )
        {
            return true;
        }
        if attribute == "data" && tag == "object" {
            return true;
        }
        if attribute == "poster" && tag == "video" {
            return true;
        }
        if attribute == "srcset" && matches!(tag, "img" | "source") {
            return true;
        }
        if attribute != "src" {
            return false;
        }
        matches!(
            tag,
            "audio"
                | "embed"
                | "frame"
                | "iframe"
                | "img"
                | "script"
                | "source"
                | "track"
                | "video"
        ) || (tag == "input" && input_type.eq_ignore_ascii_case("image"))
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum SvgHrefDisposition {
        Navigation,
        Resource,
        Structural,
    }

    fn svg_href_disposition(tag: &str) -> Option<SvgHrefDisposition> {
        match tag {
            "a" => Some(SvgHrefDisposition::Navigation),
            "feimage" | "image" | "lineargradient" | "mpath" | "pattern" | "radialgradient"
            | "script" | "textpath" | "use" => Some(SvgHrefDisposition::Resource),
            "animate" | "animatemotion" | "animatetransform" | "set" => {
                Some(SvgHrefDisposition::Structural)
            }
            _ => None,
        }
    }

    fn parsed_html_attribute<'a>(
        attributes: &'a [ParsedHtmlAttribute],
        name: &str,
    ) -> Option<&'a DecodedSourceValue> {
        attributes
            .iter()
            .find(|attribute| attribute.name == name)
            .and_then(|attribute| attribute.value.as_ref())
    }

    fn html_tag_end(source: &str, start: usize) -> Option<usize> {
        let bytes = source.as_bytes();
        let mut quote = None;
        let mut cursor = start;

        while let Some(byte) = bytes.get(cursor).copied() {
            if let Some(expected) = quote {
                if byte == expected {
                    quote = None;
                }
            } else if matches!(byte, b'\'' | b'"') {
                quote = Some(byte);
            } else if byte == b'>' {
                return Some(cursor + 1);
            }
            cursor += 1;
        }
        None
    }

    fn html_comment_end(source: &str, start: usize) -> usize {
        let bytes = source.as_bytes();
        let mut cursor = start + 4;
        if bytes.get(cursor) == Some(&b'>') {
            return cursor + 1;
        }
        if bytes.get(cursor..cursor + 2) == Some(b"->") {
            return cursor + 2;
        }
        while cursor < bytes.len() {
            if bytes.get(cursor..cursor + 3) == Some(b"-->") {
                return cursor + 3;
            }
            if bytes.get(cursor..cursor + 4) == Some(b"--!>") {
                return cursor + 4;
            }
            cursor += 1;
        }
        bytes.len()
    }

    fn appropriate_raw_end_tag(source: &str, start: usize, tag: &str) -> bool {
        let bytes = source.as_bytes();
        bytes.get(start) == Some(&b'<')
            && bytes.get(start + 1) == Some(&b'/')
            && source
                .get(start + 2..start + 2 + tag.len())
                .is_some_and(|candidate| candidate.eq_ignore_ascii_case(tag))
            && bytes
                .get(start + 2 + tag.len())
                .is_some_and(|byte| matches!(*byte, b'/' | b'>') || html_space(*byte))
    }

    fn raw_text_end(source: &str, start: usize, tag: &str) -> usize {
        let mut cursor = start;

        while let Some(offset) = source[cursor..].find("</") {
            cursor += offset;
            if appropriate_raw_end_tag(source, cursor, tag) {
                return cursor;
            }
            cursor += 2;
        }
        source.len()
    }

    fn script_text_end(source: &str, start: usize) -> usize {
        #[derive(Clone, Copy)]
        enum State {
            Data,
            Double,
            DoubleDash,
            DoubleDashDash,
            Escaped,
            EscapedDash,
            EscapedDashDash,
        }

        fn escaped_less_than(source: &str, cursor: &mut usize) -> Option<State> {
            if appropriate_raw_end_tag(source, *cursor, "script") {
                return None;
            }
            let bytes = source.as_bytes();
            if !bytes.get(*cursor + 1).is_some_and(u8::is_ascii_alphabetic) {
                return Some(State::Escaped);
            }
            let mut end = *cursor + 1;
            while bytes.get(end).is_some_and(u8::is_ascii_alphabetic) {
                end += 1;
            }
            let delimiter = bytes
                .get(end)
                .is_some_and(|byte| matches!(*byte, b'/' | b'>') || html_space(*byte));
            let double = source[*cursor + 1..end].eq_ignore_ascii_case("script") && delimiter;
            *cursor = if delimiter {
                end
            } else {
                end.saturating_sub(1)
            };
            Some(if double {
                State::Double
            } else {
                State::Escaped
            })
        }

        fn double_less_than(source: &str, cursor: &mut usize) -> State {
            let bytes = source.as_bytes();
            if bytes.get(*cursor + 1) != Some(&b'/') {
                return State::Double;
            }
            let mut end = *cursor + 2;
            while bytes.get(end).is_some_and(u8::is_ascii_alphabetic) {
                end += 1;
            }
            let delimiter = bytes
                .get(end)
                .is_some_and(|byte| matches!(*byte, b'/' | b'>') || html_space(*byte));
            let escaped = source[*cursor + 2..end].eq_ignore_ascii_case("script") && delimiter;
            *cursor = if delimiter {
                end
            } else {
                end.saturating_sub(1)
            };
            if escaped {
                State::Escaped
            } else {
                State::Double
            }
        }

        let bytes = source.as_bytes();
        let mut cursor = start;
        let mut state = State::Data;
        while cursor < bytes.len() {
            let byte = bytes[cursor];
            state = match state {
                State::Data => {
                    if appropriate_raw_end_tag(source, cursor, "script") {
                        return cursor;
                    }
                    if bytes.get(cursor..cursor + 4) == Some(b"<!--") {
                        state = State::EscapedDashDash;
                        cursor += 4;
                        continue;
                    }
                    State::Data
                }
                State::Escaped if byte == b'-' => State::EscapedDash,
                State::Escaped if byte == b'<' => {
                    let Some(next) = escaped_less_than(source, &mut cursor) else {
                        return cursor;
                    };
                    next
                }
                State::Escaped => State::Escaped,
                State::EscapedDash if byte == b'-' => State::EscapedDashDash,
                State::EscapedDash if byte == b'<' => {
                    let Some(next) = escaped_less_than(source, &mut cursor) else {
                        return cursor;
                    };
                    next
                }
                State::EscapedDash => State::Escaped,
                State::EscapedDashDash if byte == b'<' => {
                    let Some(next) = escaped_less_than(source, &mut cursor) else {
                        return cursor;
                    };
                    next
                }
                State::EscapedDashDash if byte == b'>' => State::Data,
                State::EscapedDashDash if byte == b'-' => State::EscapedDashDash,
                State::EscapedDashDash => State::Escaped,
                State::Double if byte == b'-' => State::DoubleDash,
                State::Double if byte == b'<' => double_less_than(source, &mut cursor),
                State::Double => State::Double,
                State::DoubleDash if byte == b'-' => State::DoubleDashDash,
                State::DoubleDash if byte == b'<' => double_less_than(source, &mut cursor),
                State::DoubleDash => State::Double,
                State::DoubleDashDash if byte == b'<' => double_less_than(source, &mut cursor),
                State::DoubleDashDash if byte == b'>' => State::Data,
                State::DoubleDashDash if byte == b'-' => State::DoubleDashDash,
                State::DoubleDashDash => State::Double,
            };
            cursor += 1;
        }
        source.len()
    }

    fn html_children_use_html(stack: &[HtmlOpenElement], next_tag: Option<&str>) -> bool {
        let Some(current) = stack.last() else {
            return true;
        };
        current.namespace == HtmlNamespace::Html
            || current.html_integration_point
            || (current.namespace == HtmlNamespace::Math
                && current.tag == "annotation-xml"
                && next_tag == Some("svg"))
            || (current.math_text_integration_point
                && !matches!(next_tag, Some("mglyph" | "malignmark")))
    }

    fn html_void_element(tag: &str) -> bool {
        matches!(
            tag,
            "area"
                | "base"
                | "basefont"
                | "bgsound"
                | "br"
                | "col"
                | "embed"
                | "frame"
                | "hr"
                | "image"
                | "img"
                | "input"
                | "keygen"
                | "link"
                | "meta"
                | "param"
                | "source"
                | "track"
                | "wbr"
        )
    }

    fn html_foreign_breakout(tag: &str) -> bool {
        matches!(
            tag,
            "b" | "big"
                | "blockquote"
                | "body"
                | "br"
                | "center"
                | "code"
                | "dd"
                | "div"
                | "dl"
                | "dt"
                | "em"
                | "embed"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "head"
                | "hr"
                | "i"
                | "img"
                | "li"
                | "listing"
                | "menu"
                | "meta"
                | "nobr"
                | "ol"
                | "p"
                | "pre"
                | "ruby"
                | "s"
                | "small"
                | "span"
                | "strike"
                | "strong"
                | "sub"
                | "sup"
                | "table"
                | "tt"
                | "u"
                | "ul"
                | "var"
        )
    }

    fn html_lexical_scan(source: &str) -> HtmlLexicalScan {
        let bytes = source.as_bytes();
        let mut result = HtmlLexicalScan {
            complete: true,
            ..HtmlLexicalScan::default()
        };
        let mut stack = Vec::<HtmlOpenElement>::new();
        let mut cursor = 0;

        while cursor < bytes.len() {
            if bytes.get(cursor..cursor + 4) == Some(b"<!--") {
                let resume = html_comment_end(source, cursor);
                result.ignored_fallback_spans.push((cursor, resume));
                cursor = resume;
                continue;
            }
            if bytes.get(cursor..cursor + 9) == Some(b"<![CDATA[")
                && !html_children_use_html(&stack, None)
            {
                let resume = source[cursor + 9..]
                    .find("]]>")
                    .map_or(bytes.len(), |offset| cursor + 9 + offset + 3);
                result.ignored_fallback_spans.push((cursor, resume));
                cursor = resume;
                continue;
            }
            if bytes[cursor] != b'<' {
                cursor += 1;
                continue;
            }
            if matches!(bytes.get(cursor + 1), Some(b'!' | b'?')) {
                let resume = source[cursor + 2..]
                    .find('>')
                    .map_or(bytes.len(), |offset| cursor + 2 + offset + 1);
                result.ignored_fallback_spans.push((cursor, resume));
                cursor = resume;
                continue;
            }
            if bytes.get(cursor + 1) == Some(&b'/') {
                if !bytes.get(cursor + 2).is_some_and(u8::is_ascii_alphabetic) {
                    if bytes.get(cursor + 2) == Some(&b'>') {
                        cursor += 3;
                        continue;
                    }
                    let resume = source[cursor + 2..]
                        .find('>')
                        .map_or(bytes.len(), |offset| cursor + 2 + offset + 1);
                    result.ignored_fallback_spans.push((cursor, resume));
                    cursor = resume;
                    continue;
                }
                let mut name_end = cursor + 2;
                while bytes
                    .get(name_end)
                    .is_some_and(|byte| !html_space(*byte) && !matches!(*byte, b'/' | b'>'))
                {
                    name_end += 1;
                }
                let tag = source[cursor + 2..name_end].to_ascii_lowercase();
                let Some(end) = html_tag_end(source, name_end) else {
                    cursor = bytes.len();
                    continue;
                };
                if let Some(stack_index) = stack.iter().rposition(|item| item.tag == tag) {
                    stack.truncate(stack_index);
                }
                cursor = end;
                continue;
            }

            if !bytes.get(cursor + 1).is_some_and(u8::is_ascii_alphabetic) {
                cursor += 1;
                continue;
            }
            let mut index = cursor + 1;
            while bytes
                .get(index)
                .is_some_and(|byte| !html_space(*byte) && !matches!(*byte, b'/' | b'>'))
            {
                index += 1;
            }
            let tag = source[cursor + 1..index].to_ascii_lowercase();
            if tag.is_empty() {
                cursor += 1;
                continue;
            }
            let mut tag_attributes = Vec::<ParsedHtmlAttribute>::new();
            let mut seen_attributes = BTreeSet::new();
            let mut closed = false;
            let mut self_closing = false;
            while index < bytes.len() {
                while bytes.get(index).is_some_and(|byte| html_space(*byte)) {
                    index += 1;
                }
                if bytes.get(index) == Some(&b'>') {
                    index += 1;
                    closed = true;
                    break;
                }
                if bytes.get(index) == Some(&b'/') && bytes.get(index + 1) == Some(&b'>') {
                    index += 2;
                    closed = true;
                    self_closing = true;
                    break;
                }
                let name_start = index;
                while bytes
                    .get(index)
                    .is_some_and(|byte| !html_space(*byte) && !matches!(*byte, b'=' | b'>' | b'/'))
                {
                    index += 1;
                }
                let name = source[name_start..index].to_ascii_lowercase();
                while bytes.get(index).is_some_and(|byte| html_space(*byte)) {
                    index += 1;
                }
                if name.is_empty() || bytes.get(index) != Some(&b'=') {
                    if !name.is_empty() && seen_attributes.insert(name.clone()) {
                        tag_attributes.push(ParsedHtmlAttribute { name, value: None });
                    }
                    if index == name_start {
                        index += 1;
                    }
                    continue;
                }
                index += 1;
                while bytes.get(index).is_some_and(|byte| html_space(*byte)) {
                    index += 1;
                }
                let (value_start, value_end) = if let Some(quote) = bytes
                    .get(index)
                    .copied()
                    .filter(|byte| matches!(*byte, b'\'' | b'"'))
                {
                    let value_start = index + 1;
                    index = value_start;
                    while bytes.get(index).is_some_and(|byte| *byte != quote) {
                        index += 1;
                    }
                    if index >= bytes.len() {
                        break;
                    }
                    let value_end = index;
                    index += 1;
                    (value_start, value_end)
                } else {
                    let value_start = index;
                    while bytes
                        .get(index)
                        .is_some_and(|byte| !html_space(*byte) && *byte != b'>')
                    {
                        index += 1;
                    }
                    (value_start, index)
                };
                if seen_attributes.insert(name.clone()) {
                    let decoded_attribute = decoded_html_attribute(&name);
                    let raw_value = &source[value_start..value_end];
                    if decoded_attribute && raw_value.contains('\0') {
                        result.complete = false;
                    }
                    let value = decoded_attribute
                        .then(|| decode_html_attribute_value(raw_value, value_start));
                    tag_attributes.push(ParsedHtmlAttribute { name, value });
                }
            }
            if !closed {
                cursor = (cursor + 1).max(index);
                continue;
            }
            // Parsed start tags are authoritative. Generic filename heuristics apply only to
            // free source text, never to labels, metadata, or other attributes.
            result.ignored_fallback_spans.push((cursor, index));

            let mut html_context = html_children_use_html(&stack, Some(&tag));
            let top_namespace = stack
                .last()
                .map_or(HtmlNamespace::Html, |item| item.namespace);
            let font_breakout = tag == "font"
                && tag_attributes
                    .iter()
                    .any(|item| matches!(item.name.as_str(), "color" | "face" | "size"));
            if !html_context && (html_foreign_breakout(&tag) || font_breakout) {
                while !stack.is_empty() && !html_children_use_html(&stack, Some(&tag)) {
                    stack.pop();
                }
                html_context = true;
            }
            let namespace = if html_context {
                match tag.as_str() {
                    "svg" => HtmlNamespace::Svg,
                    "math" => HtmlNamespace::Math,
                    _ => HtmlNamespace::Html,
                }
            } else {
                top_namespace
            };
            if let Some(style) = parsed_html_attribute(&tag_attributes, "style") {
                result.style_attributes.push(style.clone());
            }
            if namespace == HtmlNamespace::Svg {
                result.style_attributes.extend(
                    tag_attributes
                        .iter()
                        .filter(|item| svg_css_presentation_attribute(&item.name))
                        .filter_map(|item| item.value.clone()),
                );
            }
            let has_download = tag_attributes
                .iter()
                .any(|attribute| attribute.name == "download");
            let input_type = parsed_html_attribute(&tag_attributes, "type")
                .map_or("", |value| value.value.as_str());
            let svg_href = if namespace == HtmlNamespace::Svg {
                svg_href_disposition(&tag)
            } else {
                None
            };
            let has_svg_href = tag_attributes
                .iter()
                .any(|attribute| attribute.name == "href");
            let link_relation = (namespace == HtmlNamespace::Html && tag == "link").then(|| {
                classify_html_link_relations(
                    parsed_html_attribute(&tag_attributes, "rel")
                        .map_or("", |value| value.value.as_str()),
                    parsed_html_attribute(&tag_attributes, "as")
                        .map_or("", |value| value.value.as_str()),
                )
            });
            if link_relation
                .as_ref()
                .is_some_and(|relation| relation.unknown)
                && (parsed_html_attribute(&tag_attributes, "href").is_some()
                    || parsed_html_attribute(&tag_attributes, "imagesrcset").is_some())
            {
                result.complete = false;
            }
            if namespace == HtmlNamespace::Html
                && tag == "meta"
                && parsed_html_attribute(&tag_attributes, "http-equiv")
                    .is_some_and(|value| value.value.eq_ignore_ascii_case("refresh"))
                && let Some(content) = parsed_html_attribute(&tag_attributes, "content")
                && let Some((start, end)) = declarative_refresh_url_range(&content.value)
            {
                if let Some(projected) = project_decoded_source_value(content, start, end) {
                    result.attributes.push(HtmlAssetAttribute {
                        attribute: "refresh".into(),
                        value: projected,
                    });
                } else {
                    result.complete = false;
                }
            }
            for item in &tag_attributes {
                let Some(value) = &item.value else {
                    continue;
                };
                let svg_reference = svg_href.is_some_and(|disposition| {
                    disposition == SvgHrefDisposition::Resource
                        || (disposition == SvgHrefDisposition::Navigation && has_download)
                }) && (item.name == "href"
                    || (item.name == "xlink:href" && !has_svg_href));
                let link_resource = tag == "link"
                    && namespace == HtmlNamespace::Html
                    && ((item.name == "href"
                        && link_relation.as_ref().is_some_and(|relation| relation.href))
                        || (item.name == "imagesrcset"
                            && link_relation
                                .as_ref()
                                .is_some_and(|relation| relation.imagesrcset)));
                let html_download_href = namespace == HtmlNamespace::Html
                    && matches!(tag.as_str(), "a" | "area")
                    && has_download
                    && item.name == "href";
                let html_resource = namespace == HtmlNamespace::Html
                    && html_asset_attribute(&tag, &item.name, input_type);
                let structured_asset_attribute =
                    html_resource || svg_reference || link_resource || html_download_href;
                if structured_asset_attribute {
                    result.attributes.push(HtmlAssetAttribute {
                        attribute: item.name.clone(),
                        value: value.clone(),
                    });
                }
            }

            let encoding = parsed_html_attribute(&tag_attributes, "encoding")
                .map(|value| value.value.to_ascii_lowercase());
            let html_integration_point = (namespace == HtmlNamespace::Svg
                && matches!(tag.as_str(), "desc" | "foreignobject" | "title"))
                || (namespace == HtmlNamespace::Math
                    && tag == "annotation-xml"
                    && encoding.as_deref().is_some_and(|encoding| {
                        matches!(encoding, "text/html" | "application/xhtml+xml")
                    }));
            let should_push = if namespace == HtmlNamespace::Html {
                !html_void_element(&tag)
            } else {
                !self_closing
            };
            if should_push {
                if stack.len() >= 512 {
                    result.complete = false;
                } else {
                    stack.push(HtmlOpenElement {
                        html_integration_point,
                        math_text_integration_point: namespace == HtmlNamespace::Math
                            && matches!(tag.as_str(), "mi" | "mn" | "mo" | "ms" | "mtext"),
                        namespace,
                        tag: tag.clone(),
                    });
                }
            }
            if namespace != HtmlNamespace::Html {
                cursor = index;
                continue;
            }
            match tag.as_str() {
                "plaintext" => {
                    result.ignored_fallback_spans.push((index, source.len()));
                    cursor = source.len();
                }
                "script" => {
                    let end = script_text_end(source, index);
                    result.ignored_fallback_spans.push((index, end));
                    cursor = end;
                }
                "style" => {
                    let end = raw_text_end(source, index, &tag);
                    result.style_contents.push((index, end));
                    result.ignored_fallback_spans.push((index, end));
                    cursor = end;
                }
                "iframe" | "noembed" | "noframes" | "noscript" | "title" | "textarea" | "xmp" => {
                    let end = raw_text_end(source, index, &tag);
                    result.ignored_fallback_spans.push((index, end));
                    cursor = end;
                }
                _ => cursor = index,
            }
        }
        result
    }

    fn semantic_source_range(value: DecodedSourceValue) -> SemanticSourceRange {
        SemanticSourceRange {
            end: value.end,
            semantic: Some(value.value),
            semantic_entities: value.entities,
            start: value.start,
        }
    }

    fn lexical_css_url_ranges_in_source(
        source: &str,
        full_css_source: bool,
        html: &HtmlLexicalScan,
    ) -> CssSourceRanges {
        let lexical = if full_css_source {
            lexical_css_url_ranges(source)
        } else {
            CssLexicalRanges {
                complete: true,
                ..CssLexicalRanges::default()
            }
        };
        let mut result = CssSourceRanges {
            complete: lexical.complete,
            context_spans: if full_css_source {
                vec![(0, source.len())]
            } else {
                Vec::new()
            },
            ignored_spans: lexical.ignored_spans,
            import_ranges: lexical
                .import_ranges
                .into_iter()
                .map(|(start, end)| SemanticSourceRange {
                    end,
                    semantic: None,
                    semantic_entities: Vec::new(),
                    start,
                })
                .collect(),
            url_ranges: lexical
                .url_ranges
                .into_iter()
                .map(|(start, end)| SemanticSourceRange {
                    end,
                    semantic: None,
                    semantic_entities: Vec::new(),
                    start,
                })
                .collect(),
        };

        if !full_css_source {
            for (content_start, content_end) in &html.style_contents {
                let nested = lexical_css_url_ranges(&source[*content_start..*content_end]);
                result.complete &= nested.complete;
                result.context_spans.push((*content_start, *content_end));
                result
                    .url_ranges
                    .extend(nested.url_ranges.into_iter().map(|(start, end)| {
                        SemanticSourceRange {
                            end: content_start + end,
                            semantic: None,
                            semantic_entities: Vec::new(),
                            start: content_start + start,
                        }
                    }));
                result
                    .import_ranges
                    .extend(nested.import_ranges.into_iter().map(|(start, end)| {
                        SemanticSourceRange {
                            end: content_start + end,
                            semantic: None,
                            semantic_entities: Vec::new(),
                            start: content_start + start,
                        }
                    }));
                result.ignored_spans.extend(
                    nested
                        .ignored_spans
                        .into_iter()
                        .map(|(start, end)| (content_start + start, content_start + end)),
                );
            }
            for value in &html.style_attributes {
                let nested = lexical_css_url_ranges(&value.value);
                result.complete &= nested.complete;
                result.context_spans.push((value.start, value.end));
                for (start, end) in nested.url_ranges {
                    if let Some(projected) = project_decoded_source_value(value, start, end) {
                        result.url_ranges.push(semantic_source_range(projected));
                    } else {
                        result.complete = false;
                    }
                }
                for (start, end) in nested.import_ranges {
                    if let Some(projected) = project_decoded_source_value(value, start, end) {
                        result.import_ranges.push(semantic_source_range(projected));
                    } else {
                        result.complete = false;
                    }
                }
                for (start, end) in nested.ignored_spans {
                    if let Some(projected) = project_decoded_source_value(value, start, end) {
                        result.ignored_spans.push((projected.start, projected.end));
                    } else {
                        result.complete = false;
                    }
                }
            }
            result
                .ignored_spans
                .extend(html.ignored_fallback_spans.iter().copied());
        }
        result
            .url_ranges
            .sort_unstable_by_key(|range| (range.start, range.end));
        result
            .import_ranges
            .sort_unstable_by_key(|range| (range.start, range.end));
        result.ignored_spans.sort_unstable();
        result.context_spans.sort_unstable();
        result
    }
    let full_css_source = source_id.to_ascii_lowercase().ends_with(":stylesheet")
        || source_name.eq_ignore_ascii_case("Story Stylesheet");
    let full_script_source = source_id.to_ascii_lowercase().ends_with(":script")
        || source_name.eq_ignore_ascii_case("Story JavaScript");
    let html = if full_css_source || full_script_source {
        HtmlLexicalScan {
            complete: true,
            ..HtmlLexicalScan::default()
        }
    } else {
        html_lexical_scan(source)
    };
    let css_ranges = lexical_css_url_ranges_in_source(source, full_css_source, &html);
    let mut candidates = Vec::new();
    for attribute in if full_css_source {
        &[]
    } else {
        html.attributes.as_slice()
    } {
        if attribute.attribute.eq_ignore_ascii_case("srcset")
            || attribute.attribute.eq_ignore_ascii_case("imagesrcset")
        {
            candidates.extend(srcset_candidates(&attribute.value));
        } else {
            let context = if attribute.attribute.eq_ignore_ascii_case("src") {
                "html-src"
            } else if attribute.attribute.eq_ignore_ascii_case("href")
                || attribute.attribute.eq_ignore_ascii_case("xlink:href")
            {
                "html-href"
            } else if attribute.attribute.eq_ignore_ascii_case("data") {
                "html-data"
            } else if attribute.attribute.eq_ignore_ascii_case("refresh") {
                "html-refresh"
            } else if attribute.attribute.eq_ignore_ascii_case("background") {
                "html-background"
            } else {
                "html-poster"
            };

            if let Some(candidate) = trimmed_candidate(&attribute.value, context) {
                candidates.push(candidate);
            }
        }
    }

    for range in &css_ranges.url_ranges {
        candidates.push(Candidate {
            context: "css-url",
            end: range.end,
            semantic: range.semantic.clone(),
            semantic_entities: range.semantic_entities.clone(),
            start: range.start,
        });
    }
    for range in &css_ranges.import_ranges {
        candidates.push(Candidate {
            context: "css-import",
            end: range.end,
            semantic: range.semantic.clone(),
            semantic_entities: range.semantic_entities.clone(),
            start: range.start,
        });
    }
    candidates.sort_by_key(|candidate| (candidate.start, candidate.end));
    let structured_candidate_spans = candidates
        .iter()
        .map(|candidate| (candidate.start, candidate.end))
        .collect::<Vec<_>>();
    let mut quoted_candidate_cursor = SortedSpanCursor::default();

    // Keep every quoted or template span out of the fallback matcher. Escaped
    // and interpolated strings are not safe source ranges unless a format-aware
    // parser proves their runtime URL, so they deliberately remain external.
    let mut quoted_spans = Vec::new();
    let bytes = source.as_bytes();
    let mut quote_start = 0;
    let mut comment_index = 0;
    while quote_start < bytes.len() {
        while css_ranges
            .ignored_spans
            .get(comment_index)
            .is_some_and(|(_, end)| *end <= quote_start)
        {
            comment_index += 1;
        }
        if let Some((start, end)) = css_ranges.ignored_spans.get(comment_index)
            && quote_start >= *start
        {
            quote_start = *end;
            continue;
        }
        let quote = bytes[quote_start];
        if !matches!(quote, b'\'' | b'"' | b'`')
            || (quote == b'\''
                && source[..quote_start]
                    .chars()
                    .next_back()
                    .is_some_and(|character| character.is_alphanumeric() || character == '_'))
        {
            quote_start += 1;
            continue;
        }

        let content_start = quote_start + 1;
        let mut cursor = content_start;
        let mut safe_static_literal = true;
        let mut closed = false;
        while cursor < bytes.len() {
            if bytes[cursor] == b'\\' {
                safe_static_literal = false;
                cursor = (cursor + 2).min(bytes.len());
                continue;
            }
            if quote == b'`' && bytes[cursor] == b'$' && bytes.get(cursor + 1) == Some(&b'{') {
                safe_static_literal = false;
            }
            if bytes[cursor] == quote {
                quoted_spans.push((content_start, cursor));
                closed = true;
                break;
            }
            cursor += 1;
        }

        if !closed {
            quoted_spans.push((content_start, bytes.len()));
            break;
        }

        let value = &source[content_start..cursor];
        let (start, end) = url_trimmed_bounds(value);
        let trimmed = &value[start..end];
        let candidate = Candidate {
            context: "literal",
            end: content_start + end,
            semantic: None,
            semantic_entities: Vec::new(),
            start: content_start + start,
        };
        if quoted_candidate_cursor.overlaps(
            candidate.start,
            candidate.end,
            &structured_candidate_spans,
        ) {
            quote_start = cursor + 1;
            continue;
        }
        let supported = safe_static_literal
            && !trimmed.is_empty()
            && parsed_local_asset_reference(trimmed).is_some_and(|(path, _, _)| {
                Path::new(&path)
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .and_then(reference_asset_kind)
                    .is_some()
                    || explicitly_managed_asset_reference(trimmed)
            });

        if supported {
            candidates.push(candidate);
        }
        quote_start = cursor + 1;
    }

    // Preserve the literal detection used by passages and Story JavaScript.
    // Structured candidates above deliberately take precedence so quoted URLs
    // can contain spaces and srcset descriptors can be excluded from ranges.
    static LITERALS: OnceLock<regex::Regex> = OnceLock::new();
    let literals = LITERALS.get_or_init(|| {
        regex::RegexBuilder::new(
            r#"(?P<path>[^\s\"'<>(),;=:#?]+\.(?:png|jpe?g|gif|svg|webp|mp3|m4a|ogg|wav|mp4|webm|css|js)(?:\?[^\s\"'<>(),;#]*)?(?:#[^\s\"'<>(),;]*)?)"#,
        )
        .case_insensitive(true)
        .build()
        .expect("asset literal regex should compile")
    });
    candidates.sort_by_key(|candidate| (candidate.start, candidate.end));
    let literal_candidate_spans = candidates
        .iter()
        .map(|candidate| (candidate.start, candidate.end))
        .collect::<Vec<_>>();
    let mut literal_candidate_cursor = SortedSpanCursor::default();
    let mut literal_quote_cursor = SortedSpanCursor::default();
    let mut literal_ignored_cursor = SortedSpanCursor::default();
    for path in literals
        .captures_iter(source)
        .filter_map(|captures| captures.name("path"))
    {
        if literal_ignored_cursor.overlaps(path.start(), path.end(), &css_ranges.ignored_spans)
            || literal_candidate_cursor.overlaps(path.start(), path.end(), &literal_candidate_spans)
            || literal_quote_cursor.overlaps(path.start(), path.end(), &quoted_spans)
        {
            continue;
        }

        candidates.push(Candidate {
            context: "literal",
            end: path.end(),
            semantic: None,
            semantic_entities: Vec::new(),
            start: path.start(),
        });
    }

    candidates.sort_by_key(|candidate| (candidate.start, candidate.end));
    let candidate_ranges = candidates
        .iter()
        .map(|candidate| (candidate.start, candidate.end))
        .collect::<Vec<_>>();
    let (candidate_metrics, scanned_characters) = source_range_metrics(source, &candidate_ranges);
    let mut references = Vec::new();

    for (candidate, metrics) in candidates.into_iter().zip(candidate_metrics) {
        let Some(metrics) = metrics else {
            continue;
        };
        let original = &source[candidate.start..candidate.end];
        let semantic = candidate.semantic.as_deref().unwrap_or(original);
        let Some(path) = local_asset_reference_path(semantic) else {
            continue;
        };
        let extension = Path::new(&path)
            .extension()
            .and_then(|value| value.to_str());
        let known_kind = extension.and_then(reference_asset_kind);
        if known_kind.is_none() && !context_supports_arbitrary_asset(candidate.context, semantic) {
            continue;
        }
        let kind = known_kind
            .or_else(|| extension.map(asset_kind))
            .unwrap_or("file");
        let fragment_start = semantic.find('#');
        let before_fragment = fragment_start.map_or(semantic, |start| &semantic[..start]);
        let query_start = before_fragment.find('?');
        let raw_query_start = if let Some(start) = query_start {
            let Some(raw) = candidate_raw_boundary(&candidate, start) else {
                continue;
            };
            Some(raw)
        } else {
            None
        };
        let raw_fragment_start = if let Some(start) = fragment_start {
            let Some(raw) = candidate_raw_boundary(&candidate, start) else {
                continue;
            };
            Some(raw)
        } else {
            None
        };
        let query = raw_query_start
            .map(|start| source[start..raw_fragment_start.unwrap_or(candidate.end)].to_owned());
        let fragment = raw_fragment_start.map(|start| source[start..candidate.end].to_owned());

        references.push(AssetReferenceMatch {
            byte_end: candidate.end,
            byte_start: candidate.start,
            reference: CoreAssetReference {
                context: candidate.context.into(),
                end: metrics.end_utf16,
                fragment,
                kind: kind.into(),
                line: metrics.line,
                original: original.into(),
                passage_id: passage_id.map(str::to_owned),
                path,
                query,
                source_id: source_id.to_owned(),
                source_name: source_name.to_owned(),
                start: metrics.start_utf16,
            },
        });
    }

    (references, scanned_characters)
}

fn asset_references_in_source(
    source_id: &str,
    source_name: &str,
    source: &str,
    passage_id: Option<&str>,
) -> Vec<CoreAssetReference> {
    asset_reference_matches_in_source(source_id, source_name, source, passage_id)
        .0
        .into_iter()
        .map(|matched| matched.reference)
        .collect()
}

fn reference_asset_kind(extension: &str) -> Option<&'static str> {
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "svg"
            | "webp"
            | "mp3"
            | "m4a"
            | "ogg"
            | "wav"
            | "mp4"
            | "webm"
            | "css"
            | "js"
    )
    .then_some(asset_kind(extension))
}

fn utf16_offset_at(source: &str, byte_offset: usize) -> usize {
    source[..byte_offset].encode_utf16().count()
}

#[cfg(test)]
fn utf16_offset_to_byte(source: &str, offset: usize) -> Option<usize> {
    if offset == 0 {
        return Some(0);
    }

    let mut utf16_offset = 0;
    for (byte_offset, character) in source.char_indices() {
        if utf16_offset == offset {
            return Some(byte_offset);
        }
        utf16_offset += character.len_utf16();
        if utf16_offset > offset {
            return None;
        }
    }

    (utf16_offset == offset).then_some(source.len())
}

fn asset_kind(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" => "image",
        "mp3" | "m4a" | "ogg" | "wav" => "audio",
        "mp4" | "webm" => "video",
        "css" => "stylesheet",
        "js" => "script",
        _ => "file",
    }
}

fn asset_kind_for_path(path: &str) -> String {
    path.rsplit_once('.')
        .map(|(_, extension)| asset_kind(extension).into())
        .unwrap_or_else(|| "file".into())
}

fn normalized_asset_path(path: &str) -> String {
    let logical = path.replace('\\', "/");
    let logical = logical.trim_start_matches("./");

    if logical
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("assets/"))
    {
        format!("assets/{}", &logical[7..])
    } else {
        local_asset_reference_path(path).unwrap_or_else(|| logical.into())
    }
}

fn local_asset_reference_path(path: &str) -> Option<String> {
    parsed_local_asset_reference(path).map(|(path, _, _)| path)
}

fn url_trimmed_bounds(value: &str) -> (usize, usize) {
    let bytes = value.as_bytes();
    let mut start = 0;
    let mut end = bytes.len();

    while bytes
        .get(start)
        .is_some_and(|byte| *byte > 0 && *byte <= 0x20)
    {
        start += 1;
    }
    while end > start && bytes[end - 1] > 0 && bytes[end - 1] <= 0x20 {
        end -= 1;
    }
    (start, end)
}

fn url_preprocessed_value(value: &str) -> String {
    let (start, end) = url_trimmed_bounds(value);

    value[start..end]
        .chars()
        .filter(|character| !matches!(*character, '\t' | '\n' | '\r'))
        .collect()
}

fn parsed_local_asset_path(path: &str) -> Option<(String, bool)> {
    let mut normalized = path.replace('\\', "/");

    if has_url_scheme(&normalized) || normalized.starts_with("//") {
        return None;
    }
    let absolute = normalized.starts_with('/');
    if absolute {
        normalized.remove(0);
    }
    let raw_segments = normalized.split('/').collect::<Vec<_>>();
    if raw_segments.iter().any(|segment| segment.is_empty()) {
        return None;
    }
    let mut segments = Vec::with_capacity(raw_segments.len());
    for raw_segment in raw_segments {
        let segment = percent_decode_path(raw_segment)?;
        if segment.contains(['/', '\\', '\0']) {
            return None;
        }
        segments.push(segment);
    }
    while segments.first().is_some_and(|segment| segment == ".") {
        segments.remove(0);
    }
    let explicitly_managed = segments
        .first()
        .is_some_and(|segment| segment.eq_ignore_ascii_case("assets"));
    if absolute && !explicitly_managed {
        return None;
    }
    let asset_segments = if explicitly_managed {
        &segments[1..]
    } else {
        segments.as_slice()
    };
    if asset_segments.is_empty()
        || asset_segments
            .iter()
            .any(|segment| segment == "." || segment == "..")
    {
        return None;
    }

    Some((
        format!("assets/{}", asset_segments.join("/")),
        explicitly_managed,
    ))
}

fn parsed_local_asset_reference(path: &str) -> Option<(String, Option<String>, Option<String>)> {
    let preprocessed = url_preprocessed_value(path);
    let (source_path, query, fragment) = asset_reference_parts(&preprocessed);
    let (normalized, _) = parsed_local_asset_path(source_path)?;

    Some((
        normalized,
        query.map(str::to_owned),
        fragment.map(str::to_owned),
    ))
}

fn asset_reference_parts(path: &str) -> (&str, Option<&str>, Option<&str>) {
    let fragment_start = path.find('#').unwrap_or(path.len());
    let before_fragment = &path[..fragment_start];
    let query_start = before_fragment.find('?').unwrap_or(before_fragment.len());
    let query = (query_start < before_fragment.len()).then_some(&before_fragment[query_start..]);
    let fragment = (fragment_start < path.len()).then_some(&path[fragment_start..]);

    (&before_fragment[..query_start], query, fragment)
}

fn percent_decode_path(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = bytes.get(index + 1).and_then(|byte| hex_value(*byte))?;
            let low = bytes.get(index + 2).and_then(|byte| hex_value(*byte))?;
            decoded.push(high * 16 + low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }

    String::from_utf8(decoded).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn has_url_scheme(path: &str) -> bool {
    let Some((scheme, _)) = path.split_once(':') else {
        return false;
    };

    let mut bytes = scheme.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };

    first.is_ascii_alphabetic()
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
}

fn asset_snippet(path: &str, kind: &str) -> CoreAssetSnippet {
    let reference_path = percent_encode_asset_reference_path(path);
    let text = match kind {
        "image" => format!(r#"<img src="{reference_path}" alt="">"#),
        "audio" => format!(r#"<audio src="{reference_path}" controls></audio>"#),
        "video" => format!(r#"<video src="{reference_path}" controls></video>"#),
        "stylesheet" => format!(r#"<link rel="stylesheet" href="{reference_path}">"#),
        "script" => format!(r#"<script src="{reference_path}"></script>"#),
        _ => reference_path,
    };

    CoreAssetSnippet {
        label: "Insert asset reference".into(),
        media_type: kind.into(),
        text,
    }
}

fn asset_publish_rule(path: &str, missing: bool) -> CoreAssetPublishRule {
    CoreAssetPublishRule {
        copy: !missing,
        output_path: path.into(),
        reason: if missing {
            "Referenced file is missing".into()
        } else {
            "Copy asset into published output".into()
        },
    }
}

fn asset_inventory_entry(
    path: String,
    kind: String,
    exists: Option<bool>,
    references: Vec<CoreAssetReference>,
) -> CoreAssetInventoryEntry {
    let missing = exists == Some(false) && !references.is_empty();
    let unused = exists == Some(true) && references.is_empty();

    CoreAssetInventoryEntry {
        duration_ms: None,
        exists,
        height: None,
        kind: kind.clone(),
        missing,
        modified_at: None,
        normalized_path: normalized_asset_path(&path),
        path: path.clone(),
        preview_url: None,
        publish: asset_publish_rule(&path, missing),
        reference_count: references.len(),
        references,
        size_bytes: None,
        snippet: asset_snippet(&path, &kind),
        thumbnail_url: None,
        unused,
        width: None,
    }
}

fn asset_inventory_from_references(
    references: &[CoreAssetReference],
    known_assets: Vec<CoreAssetInventoryEntry>,
    file_backed: bool,
) -> Vec<CoreAssetInventoryEntry> {
    let mut references_by_path = BTreeMap::<String, Vec<CoreAssetReference>>::new();

    for reference in references {
        references_by_path
            .entry(normalized_asset_path(&reference.path))
            .or_default()
            .push(reference.clone());
    }

    let mut inventory = BTreeMap::<String, CoreAssetInventoryEntry>::new();

    for mut asset in known_assets {
        let normalized = if asset.normalized_path.is_empty() {
            normalized_asset_path(&asset.path)
        } else {
            normalized_asset_path(&asset.normalized_path)
        };
        let asset_references = references_by_path.remove(&normalized).unwrap_or_default();
        let references = if asset_references.is_empty() {
            asset.references.clone()
        } else {
            asset_references
        };

        if asset.kind.is_empty() {
            asset.kind = asset_kind_for_path(&asset.path);
        }

        asset.normalized_path = normalized.clone();
        asset.reference_count = references.len();
        asset.references = references;
        asset.missing = asset.exists == Some(false) && asset.reference_count > 0;
        asset.unused = asset.exists == Some(true) && asset.reference_count == 0;

        if asset.snippet.text.is_empty() {
            asset.snippet = asset_snippet(&asset.path, &asset.kind);
        }

        if asset.missing {
            asset.publish.copy = false;
            asset.publish.reason = "Referenced file is missing".into();
        }

        if asset.publish.output_path.is_empty() {
            asset.publish = asset_publish_rule(&asset.path, asset.missing);
        }

        inventory.insert(normalized, asset);
    }

    for (_, references) in references_by_path {
        let Some(first) = references.first() else {
            continue;
        };

        inventory.insert(
            normalized_asset_path(&first.path),
            asset_inventory_entry(
                first.path.clone(),
                first.kind.clone(),
                if file_backed { Some(false) } else { None },
                references,
            ),
        );
    }

    inventory.into_values().collect()
}

struct AssetSearchLocation {
    passage_id: Option<String>,
    source_id: String,
    source_name: String,
}

fn asset_search_location(story: &Story, asset: &CoreAssetInventoryEntry) -> AssetSearchLocation {
    if let Some(reference) = asset.references.first() {
        return AssetSearchLocation {
            passage_id: reference.passage_id.clone(),
            source_id: reference.source_id.clone(),
            source_name: reference.source_name.clone(),
        };
    }

    AssetSearchLocation {
        passage_id: None,
        source_id: format!("{}:assets", story.id.as_ref()),
        source_name: "Assets".into(),
    }
}

fn asset_diagnostics(
    story: &Story,
    metadata_source_id: &str,
    inventory: &[CoreAssetInventoryEntry],
) -> Vec<CoreDiagnostic> {
    let mut diagnostics = Vec::new();

    for asset in inventory {
        if asset.missing {
            let location = asset.references.first();

            diagnostics.push(CoreDiagnostic {
                code: "missing-asset".into(),
                end: location.map_or(asset.path.len(), |reference| reference.end),
                line: location.map_or(1, |reference| reference.line),
                message: format!("Referenced asset \"{}\" is missing", asset.path),
                passage_id: location.and_then(|reference| reference.passage_id.clone()),
                quick_fixes: vec![CoreQuickFix {
                    command: format!("import-asset:{}", asset.path),
                    title: "Import or relink asset".into(),
                }],
                severity: CoreDiagnosticSeverity::Error,
                source_id: location
                    .map(|reference| reference.source_id.clone())
                    .unwrap_or_else(|| metadata_source_id.into()),
                start: location.map_or(0, |reference| reference.start),
            });
        }

        if asset.unused {
            diagnostics.push(CoreDiagnostic {
                code: "unused-asset".into(),
                end: asset.path.len(),
                line: 1,
                message: format!("Asset \"{}\" is not referenced", asset.path),
                passage_id: None,
                quick_fixes: vec![CoreQuickFix {
                    command: format!("delete-asset:{}", asset.path),
                    title: "Delete unused asset".into(),
                }],
                severity: CoreDiagnosticSeverity::Info,
                source_id: format!("{}:assets", story.id.as_ref()),
                start: 0,
            });
        }
    }

    diagnostics
}

fn locate_link_target(text: &str, target: &str) -> Option<(usize, usize, usize)> {
    let start = text.find(target)?;
    let end = start + target.len();

    Some((line_number_at(text, start), start, end))
}

struct DuplicatePassageName {
    name: String,
    passage_id: String,
}

fn duplicate_passage_names(story: &Story) -> Vec<DuplicatePassageName> {
    let mut names = BTreeMap::<String, Vec<String>>::new();

    for passage in &story.passages {
        names
            .entry(passage.name.clone())
            .or_default()
            .push(passage.id.as_ref().to_owned());
    }

    names
        .into_iter()
        .filter(|(_, passage_ids)| passage_ids.len() > 1)
        .flat_map(|(name, passage_ids)| {
            passage_ids
                .into_iter()
                .map(move |passage_id| DuplicatePassageName {
                    name: name.clone(),
                    passage_id,
                })
        })
        .collect()
}

fn tag_entries(story: &Story, tag_usage: BTreeMap<String, BTreeSet<String>>) -> Vec<CoreTagEntry> {
    tag_usage
        .into_iter()
        .map(|(name, passage_ids)| CoreTagEntry {
            color: story.tag_colors.get(&name).cloned(),
            count: passage_ids.len(),
            name,
            passage_ids: passage_ids.into_iter().collect(),
        })
        .collect()
}

fn basic_source_contents_entry(
    source_id: &str,
    name: &str,
    source: &str,
    kind: CoreContentsEntryKind,
    passage_id: Option<&str>,
) -> CoreContentsEntry {
    CoreContentsEntry {
        count: line_count(source),
        detail: Some(format!("{} characters", utf16_len(source))),
        id: format!("source:{source_id}"),
        kind,
        label: name.to_owned(),
        passage_id: passage_id.map(str::to_owned),
        severity: None,
        source_id: Some(source_id.to_owned()),
    }
}

fn basic_story_metadata_contents_entries(story: &Story) -> [CoreContentsEntry; 2] {
    let metadata_source_id = format!("{}:metadata", story.id.as_ref());

    [
        CoreContentsEntry {
            count: story.passages.len(),
            detail: Some(story.name.clone()),
            id: format!("metadata:{}", story.id.as_ref()),
            kind: CoreContentsEntryKind::Metadata,
            label: "Story metadata".into(),
            passage_id: None,
            severity: None,
            source_id: Some(metadata_source_id.clone()),
        },
        CoreContentsEntry {
            count: 1,
            detail: Some(format!(
                "{} {}",
                story.story_format, story.story_format_version
            )),
            id: format!("format:{}", story.id.as_ref()),
            kind: CoreContentsEntryKind::Metadata,
            label: "Story format".into(),
            passage_id: None,
            severity: None,
            source_id: Some(metadata_source_id),
        },
    ]
}

fn basic_story_entry_point(story: &Story) -> Option<CoreContentsEntry> {
    let start = story.passage_by_id(&story.start_passage)?;

    Some(CoreContentsEntry {
        count: 1,
        detail: Some(start.name.clone()),
        id: format!("entry:{}", start.id.as_ref()),
        kind: CoreContentsEntryKind::EntryPoint,
        label: "Start passage".into(),
        passage_id: Some(start.id.as_ref().to_owned()),
        severity: None,
        source_id: Some(start.id.as_ref().to_owned()),
    })
}

fn basic_tag_contents_entry(
    story: &Story,
    tag: &str,
    passage_ids: &BTreeSet<String>,
) -> CoreContentsEntry {
    CoreContentsEntry {
        count: passage_ids.len(),
        detail: story.tag_colors.get(tag).cloned(),
        id: format!("tag:{tag}"),
        kind: group_kind(tag),
        label: tag.to_owned(),
        passage_id: passage_ids.first().cloned(),
        severity: None,
        source_id: passage_ids.first().cloned(),
    }
}

fn basic_story_contents_catalog(story: &Story, revision: u64) -> StoryContentsCatalog {
    let mut contents = BTreeMap::new();
    let mut tag_usage = BTreeMap::<String, BTreeSet<String>>::new();

    for entry in basic_story_metadata_contents_entries(story) {
        contents.insert(entry.id.clone(), entry);
    }
    if let Some(entry) = basic_story_entry_point(story) {
        contents.insert(entry.id.clone(), entry);
    }
    for passage in &story.passages {
        let entry = basic_source_contents_entry(
            passage.id.as_ref(),
            &passage.name,
            &passage.text,
            CoreContentsEntryKind::Passage,
            Some(passage.id.as_ref()),
        );
        contents.insert(entry.id.clone(), entry);
        for tag in &passage.tags {
            tag_usage
                .entry(tag.clone())
                .or_default()
                .insert(passage.id.as_ref().to_owned());
        }
    }

    let script_source_id = format!("{}:script", story.id.as_ref());
    let script = basic_source_contents_entry(
        &script_source_id,
        "Story JavaScript",
        &story.script,
        CoreContentsEntryKind::Script,
        None,
    );
    contents.insert(script.id.clone(), script);
    let stylesheet_source_id = format!("{}:stylesheet", story.id.as_ref());
    let stylesheet = basic_source_contents_entry(
        &stylesheet_source_id,
        "Story Stylesheet",
        &story.stylesheet,
        CoreContentsEntryKind::Stylesheet,
        None,
    );
    contents.insert(stylesheet.id.clone(), stylesheet);

    for (tag, passage_ids) in &tag_usage {
        let entry = basic_tag_contents_entry(story, tag, passage_ids);
        contents.insert(entry.id.clone(), entry);
    }

    StoryContentsCatalog {
        facets: contents_facets(contents.values()),
        contents,
        revision,
        tag_usage,
    }
}

#[allow(clippy::too_many_arguments)]
fn contents_entries(
    story: &Story,
    files: &[CoreSourceFile],
    tag_entries: &[CoreTagEntry],
    symbols: &[CoreSymbol],
    asset_inventory: &[CoreAssetInventoryEntry],
    diagnostics: &[CoreDiagnostic],
    graph: &GraphIndex,
    metadata_source_id: &str,
) -> Vec<CoreContentsEntry> {
    let mut entries = vec![
        CoreContentsEntry {
            count: story.passages.len(),
            detail: Some(story.name.clone()),
            id: format!("metadata:{}", story.id.as_ref()),
            kind: CoreContentsEntryKind::Metadata,
            label: "Story metadata".into(),
            passage_id: None,
            severity: None,
            source_id: Some(metadata_source_id.into()),
        },
        CoreContentsEntry {
            count: 1,
            detail: Some(format!(
                "{} {}",
                story.story_format, story.story_format_version
            )),
            id: format!("format:{}", story.id.as_ref()),
            kind: CoreContentsEntryKind::Metadata,
            label: "Story format".into(),
            passage_id: None,
            severity: None,
            source_id: Some(metadata_source_id.into()),
        },
    ];

    if let Some(start) = story.passage_by_id(&story.start_passage) {
        entries.push(CoreContentsEntry {
            count: 1,
            detail: Some(start.name.clone()),
            id: format!("entry:{}", start.id.as_ref()),
            kind: CoreContentsEntryKind::EntryPoint,
            label: "Start passage".into(),
            passage_id: Some(start.id.as_ref().to_owned()),
            severity: None,
            source_id: Some(start.id.as_ref().to_owned()),
        });
    }

    for file in files {
        entries.push(CoreContentsEntry {
            count: file.line_count,
            detail: Some(format!("{} characters", file.character_count)),
            id: format!("source:{}", file.id),
            kind: match &file.kind {
                CoreSourceKind::Passage => CoreContentsEntryKind::Passage,
                CoreSourceKind::Script => CoreContentsEntryKind::Script,
                CoreSourceKind::Stylesheet => CoreContentsEntryKind::Stylesheet,
                CoreSourceKind::StoryMetadata => CoreContentsEntryKind::Metadata,
            },
            label: file.name.clone(),
            passage_id: file.passage_id.clone(),
            severity: None,
            source_id: Some(file.id.clone()),
        });
    }

    for tag in tag_entries {
        entries.push(CoreContentsEntry {
            count: tag.count,
            detail: tag.color.clone(),
            id: format!("tag:{}", tag.name),
            kind: group_kind(&tag.name),
            label: tag.name.clone(),
            passage_id: tag.passage_ids.first().cloned(),
            severity: None,
            source_id: tag.passage_ids.first().cloned(),
        });
    }

    for (name, source) in symbol_entries(symbols) {
        entries.push(CoreContentsEntry {
            count: source.count,
            detail: None,
            id: format!("symbol:{name}"),
            kind: CoreContentsEntryKind::Variable,
            label: name,
            passage_id: source.passage_id,
            severity: None,
            source_id: Some(source.source_id),
        });
    }

    for asset in asset_inventory {
        let location = asset.references.first();

        entries.push(CoreContentsEntry {
            count: asset.reference_count,
            detail: Some(if asset.missing {
                "missing".into()
            } else if asset.unused {
                "unused".into()
            } else {
                asset.kind.clone()
            }),
            id: format!("asset:{}", asset.path),
            kind: CoreContentsEntryKind::Asset,
            label: asset.path.clone(),
            passage_id: location.and_then(|reference| reference.passage_id.clone()),
            severity: asset_status_severity(asset),
            source_id: Some(
                location
                    .map(|reference| reference.source_id.clone())
                    .unwrap_or_else(|| format!("{}:assets", story.id.as_ref())),
            ),
        });
    }

    for diagnostic in diagnostics {
        entries.push(CoreContentsEntry {
            count: 1,
            detail: Some(diagnostic.message.clone()),
            id: format!(
                "diagnostic:{}:{}:{}",
                diagnostic.code, diagnostic.source_id, diagnostic.start
            ),
            kind: match diagnostic.code.as_str() {
                "broken-link" => CoreContentsEntryKind::BrokenLink,
                _ => CoreContentsEntryKind::Diagnostic,
            },
            label: diagnostic.code.clone(),
            passage_id: diagnostic.passage_id.clone(),
            severity: Some(diagnostic.severity.clone()),
            source_id: Some(diagnostic.source_id.clone()),
        });
    }

    for node in graph.nodes().filter(|node| node.is_orphan) {
        entries.push(CoreContentsEntry {
            count: 1,
            detail: Some(node.name.clone()),
            id: format!("orphan:{}", node.id.as_ref()),
            kind: CoreContentsEntryKind::Orphan,
            label: "Orphan passage".into(),
            passage_id: Some(node.id.as_ref().to_owned()),
            severity: Some(CoreDiagnosticSeverity::Info),
            source_id: Some(node.id.as_ref().to_owned()),
        });
    }

    entries
}

fn read_model_delta_is_incremental(
    after: &Story,
    before: &Story,
    passages: &[PassageDelta],
) -> bool {
    if before.id != after.id {
        return false;
    }

    passages
        .iter()
        .all(|delta| match (&delta.before, &delta.after) {
            (Some(before), Some(after)) => {
                before.value.id == after.value.id && before.value.name == after.value.name
            }
            _ => false,
        })
}

fn refresh_read_model_aggregates(
    story: &Story,
    cache: &mut StoryReadModelCache,
    graph_cache: Option<&GraphSessionCache>,
    topology_changed: bool,
    touched_passage_source_ids: &BTreeSet<String>,
    assets_changed: bool,
    symbols_changed: bool,
) {
    let metadata_source_id = format!("{}:metadata", story.id.as_ref());
    if assets_changed {
        let mut known_assets = cache.asset_inventory.clone();

        for asset in &mut known_assets {
            asset.reference_count = 0;
            asset.references.clear();
        }
        let references = cache
            .assets_by_source
            .values()
            .flatten()
            .cloned()
            .collect::<Vec<_>>();
        cache.asset_inventory = asset_inventory_from_references(
            &references,
            known_assets,
            !cache.asset_inventory.is_empty(),
        );
    }

    cache.diagnostics.retain(|diagnostic| {
        diagnostic.code == "duplicate-passage-name"
            || (!assets_changed
                && matches!(diagnostic.code.as_str(), "missing-asset" | "unused-asset"))
            || (!topology_changed
                && diagnostic.code == "broken-link"
                && !touched_passage_source_ids.contains(&diagnostic.source_id))
    });
    if story.passage_by_id(&story.start_passage).is_none() {
        cache.diagnostics.push(CoreDiagnostic {
            code: "missing-start-passage".into(),
            end: 0,
            line: 1,
            message: "Story start passage is missing".into(),
            passage_id: None,
            quick_fixes: vec![CoreQuickFix {
                command: "set-start-passage".into(),
                title: "Choose a start passage".into(),
            }],
            severity: CoreDiagnosticSeverity::Error,
            source_id: metadata_source_id.clone(),
            start: 0,
        });
    }
    if assets_changed {
        cache.diagnostics.extend(asset_diagnostics(
            story,
            &metadata_source_id,
            &cache.asset_inventory,
        ));
    }

    if let Some(graph_cache) = graph_cache {
        for broken_link in graph_cache
            .graph
            .broken_links()
            .iter()
            .filter(|broken_link| {
                topology_changed || touched_passage_source_ids.contains(broken_link.source.as_ref())
            })
        {
            let (line, start, end) = story
                .passage_by_id(&broken_link.source)
                .and_then(|passage| locate_link_target(&passage.text, &broken_link.target_name))
                .unwrap_or((1, 0, broken_link.target_name.len()));

            cache.diagnostics.push(CoreDiagnostic {
                code: "broken-link".into(),
                end,
                line,
                message: format!("Broken link to \"{}\"", broken_link.target_name),
                passage_id: Some(broken_link.source.as_ref().to_owned()),
                quick_fixes: vec![
                    CoreQuickFix {
                        command: format!("create-passage:{}", broken_link.target_name),
                        title: format!("Create \"{}\"", broken_link.target_name),
                    },
                    CoreQuickFix {
                        command: "rename-link-target".into(),
                        title: "Change link target".into(),
                    },
                ],
                severity: CoreDiagnosticSeverity::Warning,
                source_id: broken_link.source.as_ref().to_owned(),
                start,
            });
        }
        cache.graph = graph_cache.graph.stats().clone().into();
    }

    if assets_changed {
        for id in std::mem::take(&mut cache.asset_entry_ids) {
            cache.contents.remove(&id);
        }
    }
    for id in std::mem::take(&mut cache.diagnostic_entry_ids) {
        cache.contents.remove(&id);
    }
    if symbols_changed {
        for id in std::mem::take(&mut cache.symbol_entry_ids) {
            cache.contents.remove(&id);
        }
    }
    if topology_changed {
        for id in std::mem::take(&mut cache.orphan_entry_ids) {
            cache.contents.remove(&id);
        }
    }
    if let Some(id) = cache.entry_point_id.take() {
        cache.contents.remove(&id);
    }

    if let Some(start) = story.passage_by_id(&story.start_passage) {
        let entry = CoreContentsEntry {
            count: 1,
            detail: Some(start.name.clone()),
            id: format!("entry:{}", start.id.as_ref()),
            kind: CoreContentsEntryKind::EntryPoint,
            label: "Start passage".into(),
            passage_id: Some(start.id.as_ref().to_owned()),
            severity: None,
            source_id: Some(start.id.as_ref().to_owned()),
        };
        cache.entry_point_id = Some(entry.id.clone());
        cache.contents.insert(entry.id.clone(), entry);
    }

    if symbols_changed {
        let symbols = cache
            .symbols_by_source
            .values()
            .flatten()
            .cloned()
            .collect::<Vec<_>>();
        for (name, source) in symbol_entries(&symbols) {
            let entry = CoreContentsEntry {
                count: source.count,
                detail: None,
                id: format!("symbol:{name}"),
                kind: CoreContentsEntryKind::Variable,
                label: name,
                passage_id: source.passage_id,
                severity: None,
                source_id: Some(source.source_id),
            };
            cache.symbol_entry_ids.insert(entry.id.clone());
            cache.contents.insert(entry.id.clone(), entry);
        }
    }

    if assets_changed {
        for asset in &cache.asset_inventory {
            let location = asset.references.first();
            let entry = CoreContentsEntry {
                count: asset.reference_count,
                detail: Some(if asset.missing {
                    "missing".into()
                } else if asset.unused {
                    "unused".into()
                } else {
                    asset.kind.clone()
                }),
                id: format!("asset:{}", asset.path),
                kind: CoreContentsEntryKind::Asset,
                label: asset.path.clone(),
                passage_id: location.and_then(|reference| reference.passage_id.clone()),
                severity: asset_status_severity(asset),
                source_id: Some(
                    location
                        .map(|reference| reference.source_id.clone())
                        .unwrap_or_else(|| format!("{}:assets", story.id.as_ref())),
                ),
            };
            cache.asset_entry_ids.insert(entry.id.clone());
            cache.contents.insert(entry.id.clone(), entry);
        }
    }

    for diagnostic in &cache.diagnostics {
        let entry = CoreContentsEntry {
            count: 1,
            detail: Some(diagnostic.message.clone()),
            id: format!(
                "diagnostic:{}:{}:{}",
                diagnostic.code, diagnostic.source_id, diagnostic.start
            ),
            kind: if diagnostic.code == "broken-link" {
                CoreContentsEntryKind::BrokenLink
            } else {
                CoreContentsEntryKind::Diagnostic
            },
            label: diagnostic.code.clone(),
            passage_id: diagnostic.passage_id.clone(),
            severity: Some(diagnostic.severity.clone()),
            source_id: Some(diagnostic.source_id.clone()),
        };
        cache.diagnostic_entry_ids.insert(entry.id.clone());
        cache.contents.insert(entry.id.clone(), entry);
    }

    if topology_changed && let Some(graph_cache) = graph_cache {
        for node in graph_cache.graph.nodes().filter(|node| node.is_orphan) {
            let entry = CoreContentsEntry {
                count: 1,
                detail: Some(node.name.clone()),
                id: format!("orphan:{}", node.id.as_ref()),
                kind: CoreContentsEntryKind::Orphan,
                label: "Orphan passage".into(),
                passage_id: Some(node.id.as_ref().to_owned()),
                severity: Some(CoreDiagnosticSeverity::Info),
                source_id: Some(node.id.as_ref().to_owned()),
            };
            cache.orphan_entry_ids.insert(entry.id.clone());
            cache.contents.insert(entry.id.clone(), entry);
        }
    }
}

fn group_kind(tag_name: &str) -> CoreContentsEntryKind {
    let normalized = tag_name.to_ascii_lowercase();

    if normalized.starts_with("chapter")
        || normalized.starts_with("section")
        || normalized.starts_with("group")
    {
        CoreContentsEntryKind::Group
    } else {
        CoreContentsEntryKind::Tag
    }
}

struct IndexedContentSource {
    count: usize,
    passage_id: Option<String>,
    source_id: String,
}

fn symbol_entries(symbols: &[CoreSymbol]) -> BTreeMap<String, IndexedContentSource> {
    let mut result = BTreeMap::new();

    for symbol in symbols {
        result
            .entry(symbol.name.clone())
            .and_modify(|entry: &mut IndexedContentSource| entry.count += 1)
            .or_insert_with(|| IndexedContentSource {
                count: 1,
                passage_id: symbol.passage_id.clone(),
                source_id: symbol.source_id.clone(),
            });
    }

    result
}

fn asset_status_severity(asset: &CoreAssetInventoryEntry) -> Option<CoreDiagnosticSeverity> {
    if asset.missing {
        Some(CoreDiagnosticSeverity::Error)
    } else if asset.unused {
        Some(CoreDiagnosticSeverity::Info)
    } else {
        None
    }
}

fn unique_passage_name(story: &Story, base: &str) -> String {
    if story.passages.id_for_name(base).is_none() {
        return base.into();
    }

    for suffix in 2.. {
        let candidate = format!("{base} {suffix}");

        if story.passages.id_for_name(&candidate).is_none() {
            return candidate;
        }
    }

    unreachable!("infinite iterator should return");
}

fn replace_standard_link_targets(text: &str, old_name: &str, new_name: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut cursor = 0;

    while let Some(open_offset) = text[cursor..].find("[[") {
        let open = cursor + open_offset;
        let content_start = open + 2;
        let Some(close_offset) = text[content_start..].find("]]") else {
            break;
        };
        let close = content_start + close_offset;
        let content = &text[content_start..close];

        result.push_str(&text[cursor..open]);
        result.push_str("[[");
        result.push_str(&replace_link_content_target(content, old_name, new_name));
        result.push_str("]]");
        cursor = close + 2;
    }

    result.push_str(&text[cursor..]);
    result
}

fn replace_link_content_target(content: &str, old_name: &str, new_name: &str) -> String {
    let (editable, setter) = content
        .split_once("][")
        .map_or((content, ""), |(editable, setter)| (editable, setter));
    let setter = if setter.is_empty() {
        String::new()
    } else {
        format!("][{setter}")
    };

    if let Some((label, target)) = editable.rsplit_once("->")
        && target.trim() == old_name
    {
        return format!(
            "{label}->{}{}",
            replace_preserving_padding(target, new_name),
            setter
        );
    }

    if let Some((target, label)) = editable.split_once("<-")
        && target.trim() == old_name
    {
        return format!(
            "{}<-{label}{setter}",
            replace_preserving_padding(target, new_name)
        );
    }

    if let Some((label, target)) = editable.rsplit_once('|')
        && target.trim() == old_name
    {
        return format!(
            "{label}|{}{}",
            replace_preserving_padding(target, new_name),
            setter
        );
    }

    if editable.trim() == old_name {
        return format!(
            "{}{}",
            replace_preserving_padding(editable, new_name),
            setter
        );
    }

    content.into()
}

fn replace_preserving_padding(value: &str, replacement: &str) -> String {
    let leading = value.len() - value.trim_start().len();
    let trailing = value.len() - value.trim_end().len();

    format!(
        "{}{}{}",
        &value[..leading],
        replacement,
        &value[value.len() - trailing..]
    )
}

impl Default for CoreLinkLayerOptions {
    fn default() -> Self {
        Self {
            broken: true,
            resolved: true,
            self_links: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use twine_model::{GraphLayout, ProjectManifest, StoragePolicy};

    const DEFAULT_CARD_WIDTH: f64 = 100.0;
    const DEFAULT_CARD_HEIGHT: f64 = 100.0;

    fn passage(id: &str, name: &str, text: &str, left: f64) -> Passage {
        Passage {
            custom_attributes: BTreeMap::new(),
            id: PassageId::new(id),
            layout: Some(GraphPosition {
                height: DEFAULT_CARD_HEIGHT,
                left,
                top: 0.0,
                width: DEFAULT_CARD_WIDTH,
            }),
            metadata: BTreeMap::new(),
            name: name.into(),
            source_pid: None,
            story: StoryId::new("story-1"),
            tags: Vec::new(),
            text: text.into(),
        }
    }

    fn story() -> Story {
        Story {
            id: StoryId::new("story-1"),
            ifid: "ifid".into(),
            name: "Example".into(),
            passages: vec![
                passage("a", "Start", "[[Next]] [[Label->Next]] [[Next<-Back]]", 0.0),
                passage("b", "Next", "[[Missing]]", 200.0),
                passage("c", "Loose", "", 400.0),
            ]
            .into(),
            start_passage: PassageId::new("a"),
            story_format: "Harlowe".into(),
            story_format_version: "3.3.9".into(),
            ..Story::default()
        }
    }

    fn session() -> ProjectSession {
        ProjectSession::new(Project {
            manifest: ProjectManifest {
                name: "Example".into(),
                storage: StoragePolicy::default(),
                ..ProjectManifest::default()
            },
            stories: vec![story()],
            layout: GraphLayout::from_story_layout(&story()),
            ..Project::default()
        })
    }

    fn source_only_session() -> ProjectSession {
        let mut story = story();
        let passages = story
            .passages
            .iter()
            .cloned()
            .map(|mut passage| {
                passage.layout = None;
                passage
            })
            .collect::<Vec<_>>();

        story.passages = PassageIndex::from(passages);

        ProjectSession::new(Project {
            manifest: ProjectManifest {
                name: "Example".into(),
                storage: StoragePolicy::default(),
                ..ProjectManifest::default()
            },
            stories: vec![story],
            ..Project::default()
        })
    }

    fn refactor_runtime(session: &ProjectSession) -> RefactorRuntimeState {
        RefactorRuntimeState {
            project_revision: u32::try_from(session.revision()).expect("test revision fits u32"),
            buffers: vec![RefactorBufferPrecondition {
                buffer_id: "passage:a".into(),
                registration_id: "editor-a".into(),
                generation: 7,
            }],
            external: Some(RefactorExternalPrecondition {
                session_instance_id: "native-session".into(),
                generation: 3,
            }),
            provider: Some(RefactorProviderPrecondition {
                identifier: "harlowe".into(),
                format_version: "3.3.9".into(),
                capability_revision: 2,
            }),
        }
    }

    fn canonical_refactor_changes(session: &ProjectSession) -> Vec<CanonicalPlanChange> {
        let story = &session.project.stories[0];
        let removed = story
            .passage_by_id(&PassageId::new("c"))
            .expect("removed passage")
            .clone();
        let removed_layout = session
            .project
            .layout
            .passages
            .get(&story.id, &removed.id)
            .cloned();
        let added = Passage {
            custom_attributes: BTreeMap::new(),
            id: PassageId::new("d"),
            layout: None,
            metadata: BTreeMap::new(),
            name: "Destination".into(),
            source_pid: None,
            story: story.id.clone(),
            tags: Vec::new(),
            text: "Arrived".into(),
        };

        vec![
            CanonicalPlanChange::TextEdit {
                source: CanonicalSourceIdentity::Passage {
                    story_id: story.id.as_ref().to_owned(),
                    passage_id: "a".into(),
                },
                range: RefactorTextRange {
                    start_utf8_byte: 2,
                    end_utf8_byte: 6,
                },
                expected_text: "Next".into(),
                replacement_text: "Continue".into(),
            },
            CanonicalPlanChange::RenamePassage {
                story_id: story.id.as_ref().to_owned(),
                passage_id: "b".into(),
                before_name: "Next".into(),
                after_name: "Continue".into(),
            },
            CanonicalPlanChange::AddPassage {
                story_id: story.id.as_ref().to_owned(),
                passage: added,
                layout: None,
            },
            CanonicalPlanChange::SetStartPassage {
                story_id: story.id.as_ref().to_owned(),
                before_passage_id: "a".into(),
                after_passage_id: "d".into(),
            },
            CanonicalPlanChange::RemovePassage {
                story_id: story.id.as_ref().to_owned(),
                passage: removed,
                layout: removed_layout,
            },
            CanonicalPlanChange::UpdateStoryMetadata {
                story_id: story.id.as_ref().to_owned(),
                before: StoryMetadataPatch {
                    name: Some("Example".into()),
                    ..StoryMetadataPatch::default()
                },
                after: StoryMetadataPatch {
                    name: Some("Revised".into()),
                    ..StoryMetadataPatch::default()
                },
            },
            CanonicalPlanChange::UpdateProjectMetadata {
                story_id: story.id.as_ref().to_owned(),
                field: CanonicalProjectMetadataField::Name,
                before: "Example".into(),
                after: "Revised Project".into(),
            },
        ]
    }

    fn refactor_draft(
        session: &ProjectSession,
        changes: Vec<CanonicalPlanChange>,
    ) -> CanonicalPlanDraft {
        CanonicalPlanDraft {
            operation_kind: "test-project-operation".into(),
            coverage: "exact-test-coverage".into(),
            preconditions: refactor_runtime(session),
            changes: changes
                .into_iter()
                .enumerate()
                .map(|(index, change)| CanonicalPlanDraftChange {
                    key: format!("change-{index}"),
                    group_key: None,
                    dependencies: (index == 3)
                        .then(|| "change-2".into())
                        .into_iter()
                        .collect(),
                    change,
                })
                .collect(),
        }
    }

    fn session_with_warm_refactor_caches() -> ProjectSession {
        let mut project = session().project;
        let mut untouched_story = story();
        untouched_story.id = StoryId::new("story-2");
        untouched_story.name = "Untouched".into();
        for passage in untouched_story.passages.iter_mut() {
            passage.story = untouched_story.id.clone();
        }
        project.stories.push(untouched_story);
        let mut session = ProjectSession::new(project);

        for story_id in ["story-1", "story-2"] {
            session
                .contents_page(
                    story_id,
                    CoreContentsQuery {
                        filter: CoreContentsFilter::Diagnostics,
                        ..CoreContentsQuery::default()
                    },
                )
                .expect("warm graph, contents, analysis, and read-model caches");
            session
                .backlinks_page(story_id, "b", CoreBacklinksQuery::default())
                .expect("warm backlink cache");
            session
                .backlinks_page(story_id, "b", CoreBacklinksQuery::default())
                .expect("record backlink cache hit");
        }

        session
    }

    fn sparse_refactor_draft(session: &ProjectSession) -> CanonicalPlanDraft {
        let mut draft = refactor_draft(
            session,
            vec![CanonicalPlanChange::RenamePassage {
                story_id: "story-1".into(),
                passage_id: "b".into(),
                before_name: "Next".into(),
                after_name: "Continue".into(),
            }],
        );
        draft.operation_kind = "passage-rename".into();
        draft
    }

    #[test]
    fn canonical_refactor_apply_is_one_atomic_undoable_session_transaction() {
        let mut session = session();
        let before = session.project.clone();
        let runtime = refactor_runtime(&session);
        let summary = session
            .plan_refactor(refactor_draft(
                &session,
                canonical_refactor_changes(&session),
            ))
            .expect("plan");
        assert_eq!(
            session
                .performance_diagnostics()
                .refactor_plan_store_entry_count,
            1
        );
        let mut request = RefactorPlanApplyRequest {
            plan_id: summary.plan_id,
            expected_project_revision: runtime.project_revision,
            selection: RefactorPlanSelection::All,
        };
        let batch = session
            .apply_refactor_plan(&request, &runtime)
            .expect("atomic apply");

        assert_eq!(session.revision(), 2);
        assert_eq!(session.undo_stack.len(), 1);
        assert_eq!(session.undo_stack[0].kind, CoreHistoryKind::Refactor);
        assert_eq!(session.project.manifest.name, "Revised Project");
        let story = &session.project.stories[0];
        assert_eq!(story.name, "Revised");
        assert_eq!(story.start_passage.as_ref(), "d");
        assert_eq!(
            story.passage_by_id(&PassageId::new("b")).unwrap().name,
            "Continue"
        );
        assert_eq!(
            story.passage_by_id(&PassageId::new("a")).unwrap().text,
            "[[Continue]] [[Label->Next]] [[Next<-Back]]"
        );
        assert!(story.passage_by_id(&PassageId::new("c")).is_none());
        assert!(story.passage_by_id(&PassageId::new("d")).is_some());
        assert!(
            batch
                .patches
                .iter()
                .any(|patch| matches!(patch, Patch::ProjectMetadataUpdated { .. }))
        );
        assert_eq!(
            session
                .performance_diagnostics()
                .refactor_plan_store_entry_count,
            0
        );
        request.expected_project_revision = 2;
        let mut current_runtime = runtime;
        current_runtime.project_revision = 2;
        assert_eq!(
            session
                .apply_refactor_plan(&request, &current_runtime)
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::PlanEvicted
        );

        let applied = session.project.clone();
        session.undo().expect("undo refactor");
        assert_eq!(session.project, before);
        assert_eq!(session.revision(), 3);
        session.redo().expect("redo refactor");
        assert_eq!(session.project, applied);
        assert_eq!(session.revision(), 4);
    }

    #[test]
    fn passage_rename_planning_is_chunked_atomic_and_undoable() {
        let mut story = story();
        story.passages = (0..130)
            .map(|index| {
                passage(
                    &format!("extra-{index}"),
                    &format!("Extra {index}"),
                    "",
                    600.0 + index as f64,
                )
            })
            .chain(story.passages.iter().cloned())
            .collect::<Vec<_>>()
            .into();
        story.passage_by_id_mut(&PassageId::new("a")).unwrap().text =
            "Before\r\n[[ Показать -> Next ][set: $x to \"😀\"]] [[Next<-Назад]] [[Label|Next]]"
                .into();
        let project = Project {
            manifest: ProjectManifest {
                name: "Example".into(),
                storage: StoragePolicy::default(),
                ..ProjectManifest::default()
            },
            layout: GraphLayout::from_story_layout(&story),
            stories: vec![story],
            ..Project::default()
        };
        let mut session = ProjectSession::new(project);
        let runtime = refactor_runtime(&session);
        let task = session
            .begin_passage_rename_plan(
                PlanPassageRenameRequest {
                    story_id: "story-1".into(),
                    passage_id: "b".into(),
                    after_name: "Néxt🚀".into(),
                },
                runtime.clone(),
            )
            .expect("begin rename planning");
        assert!(matches!(
            session.continue_passage_rename_plan(&task),
            PlanPassageRenameResult::Pending { progress, .. }
                if progress.scanned_passage_count == 128 && progress.total_passage_count == 133
        ));
        let summary = match session.continue_passage_rename_plan(&task) {
            PlanPassageRenameResult::Complete { summary } => summary,
            result => panic!("expected completed rename plan, got {result:?}"),
        };
        assert_eq!(summary.operation_kind, "passage-rename");
        assert_eq!(summary.coverage, "standard-links-only");
        assert_eq!(summary.change_count, 4);
        let details = session
            .refactor_plan_detail_page(&summary.first_detail_cursor)
            .expect("details");
        assert!(
            details
                .changes
                .iter()
                .all(|detail| detail.group_id.is_some())
        );
        let rename = details
            .changes
            .iter()
            .find(|detail| detail.kind == RefactorPlanChangeKind::RenamePassage)
            .expect("rename detail");
        assert!(
            session
                .apply_refactor_plan(
                    &RefactorPlanApplyRequest {
                        plan_id: summary.plan_id.clone(),
                        expected_project_revision: runtime.project_revision,
                        selection: RefactorPlanSelection::Only {
                            change_ids: vec![rename.change_id.clone()],
                        },
                    },
                    &runtime,
                )
                .is_err()
        );
        let before = session.project.clone();
        session
            .apply_refactor_plan(
                &RefactorPlanApplyRequest {
                    plan_id: summary.plan_id,
                    expected_project_revision: runtime.project_revision,
                    selection: RefactorPlanSelection::All,
                },
                &runtime,
            )
            .expect("apply atomic rename");
        assert_eq!(
            session.project.stories[0]
                .passage_by_id(&PassageId::new("a"))
                .unwrap()
                .text,
            "Before\r\n[[ Показать -> Néxt🚀 ][set: $x to \"😀\"]] [[Néxt🚀<-Назад]] [[Label|Néxt🚀]]"
        );
        assert_eq!(
            session.project.stories[0]
                .passage_by_id(&PassageId::new("b"))
                .unwrap()
                .name,
            "Néxt🚀"
        );
        let applied = session.project.clone();
        session.undo().expect("single undo");
        assert_eq!(session.project, before);
        session.redo().expect("single redo");
        assert_eq!(session.project, applied);
    }

    #[test]
    fn sparse_passage_rename_combines_target_edits_and_preserves_indexes_history_and_failures() {
        let mut session = session();
        let after_name = "Néxt🚀";
        let source_text = "😀\r\n[[Next]] [[Label->Next]] [[Next<-Back]]";
        let target_text = "Target\r\n[[Next]]";
        session.project.stories[0]
            .passage_by_id_mut(&PassageId::new("a"))
            .unwrap()
            .text = source_text.into();
        session.project.stories[0]
            .passage_by_id_mut(&PassageId::new("b"))
            .unwrap()
            .text = target_text.into();
        let changes = source_text
            .match_indices("Next")
            .map(|(start_utf8_byte, _)| CanonicalPlanChange::TextEdit {
                source: CanonicalSourceIdentity::Passage {
                    story_id: "story-1".into(),
                    passage_id: "a".into(),
                },
                range: RefactorTextRange {
                    start_utf8_byte,
                    end_utf8_byte: start_utf8_byte + "Next".len(),
                },
                expected_text: "Next".into(),
                replacement_text: after_name.into(),
            })
            .chain(std::iter::once(CanonicalPlanChange::TextEdit {
                source: CanonicalSourceIdentity::Passage {
                    story_id: "story-1".into(),
                    passage_id: "b".into(),
                },
                range: RefactorTextRange {
                    start_utf8_byte: target_text.find("Next").unwrap(),
                    end_utf8_byte: target_text.find("Next").unwrap() + "Next".len(),
                },
                expected_text: "Next".into(),
                replacement_text: after_name.into(),
            }))
            .chain(std::iter::once(CanonicalPlanChange::RenamePassage {
                story_id: "story-1".into(),
                passage_id: "b".into(),
                before_name: "Next".into(),
                after_name: after_name.into(),
            }))
            .collect::<Vec<_>>();
        let sparse = refactor::sparse_passage_rename_delta(
            &session.project,
            "passage-rename",
            &changes,
            None,
        )
        .expect("validated sparse delta")
        .expect("specialized rename shape");
        assert_eq!(sparse.len(), 2, "target rename and edit share one snapshot");
        assert!(sparse.iter().any(|change| {
            change.passage_id == PassageId::new("b")
                && change.after.name == after_name
                && change.after.text == "Target\r\n[[Néxt🚀]]"
        }));
        let runtime = refactor_runtime(&session);
        let summary = session
            .plan_refactor(refactor_draft(&session, changes))
            .expect("plan sparse rename");
        let before = session.project.clone();
        session
            .apply_refactor_plan(
                &RefactorPlanApplyRequest {
                    plan_id: summary.plan_id,
                    expected_project_revision: runtime.project_revision,
                    selection: RefactorPlanSelection::All,
                },
                &runtime,
            )
            .expect("apply sparse rename");
        let story = &session.project.stories[0];
        assert_eq!(
            story.passage_by_id(&PassageId::new("a")).unwrap().text,
            "😀\r\n[[Néxt🚀]] [[Label->Néxt🚀]] [[Néxt🚀<-Back]]"
        );
        assert_eq!(
            story.passage_by_id(&PassageId::new("b")).unwrap().text,
            "Target\r\n[[Néxt🚀]]"
        );
        assert_eq!(
            story.passage_by_name(after_name).unwrap().id,
            PassageId::new("b")
        );
        assert!(story.passage_by_name("Next").is_none());
        assert_eq!(story.passage_by_id(&PassageId::new("c")).unwrap().text, "");
        assert_eq!(
            story
                .passages
                .iter()
                .map(|passage| passage.id.as_ref())
                .collect::<Vec<_>>(),
            vec!["a", "b", "c"],
            "sparse apply must not reorder passages"
        );
        let applied = session.project.clone();
        session.undo().expect("undo sparse rename");
        assert_eq!(session.project, before);
        session.redo().expect("redo sparse rename");
        assert_eq!(session.project, applied);
    }

    #[test]
    fn sparse_refactor_injected_failure_and_mixed_plan_fallback_leave_state_contracts_intact() {
        let mut session = session();
        let sparse_changes = vec![CanonicalPlanChange::RenamePassage {
            story_id: "story-1".into(),
            passage_id: "b".into(),
            before_name: "Next".into(),
            after_name: "Continue".into(),
        }];
        let runtime = refactor_runtime(&session);
        let summary = session
            .plan_refactor(refactor_draft(&session, sparse_changes))
            .expect("plan sparse rename");
        let before = session.clone();
        session.inject_refactor_failure(RefactorFailureInjection::Child(0));
        assert_eq!(
            session
                .apply_refactor_plan(
                    &RefactorPlanApplyRequest {
                        plan_id: summary.plan_id.clone(),
                        expected_project_revision: runtime.project_revision,
                        selection: RefactorPlanSelection::All,
                    },
                    &runtime,
                )
                .expect_err("injected sparse failure")
                .code,
            RefactorPlanFailureCode::InvalidPlan
        );
        assert_eq!(format!("{session:#?}"), format!("{before:#?}"));

        let mixed = canonical_refactor_changes(&session);
        assert!(
            refactor::sparse_passage_rename_delta(
                &session.project,
                "passage-rename",
                &mixed,
                None,
            )
                .expect("mixed plan remains valid")
                .is_none(),
            "structural plans must retain the generic candidate-project path"
        );

        let same_shape_different_operation = vec![CanonicalPlanChange::RenamePassage {
            story_id: "story-1".into(),
            passage_id: "b".into(),
            before_name: "Next".into(),
            after_name: "Continue".into(),
        }];
        assert!(
            refactor::sparse_passage_rename_delta(
                &session.project,
                "test-project-operation",
                &same_shape_different_operation,
                None,
            )
            .expect("same-shape non-rename remains valid")
            .is_none(),
            "only the attributed passage-rename operation may use the sparse path"
        );

        let mut stale_session = ProjectSession::new(session.project.clone());
        let stale_changes = vec![CanonicalPlanChange::RenamePassage {
            story_id: "story-1".into(),
            passage_id: "b".into(),
            before_name: "Next".into(),
            after_name: "Continue".into(),
        }];
        assert!(
            refactor::sparse_passage_rename_delta(
                &stale_session.project,
                "passage-rename",
                &stale_changes,
                None,
            )
            .expect("validate sparse stale plan")
            .is_some()
        );
        let stale_runtime = refactor_runtime(&stale_session);
        let stale_summary = stale_session
            .plan_refactor(refactor_draft(&stale_session, stale_changes))
            .expect("plan sparse stale rename");
        stale_session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "c".into(),
                text: "unrelated committed edit".into(),
            })
            .expect("unrelated mutation");
        let after_unrelated = stale_session.project.clone();
        assert_eq!(
            stale_session
                .apply_refactor_plan(
                    &RefactorPlanApplyRequest {
                        plan_id: stale_summary.plan_id,
                        expected_project_revision: stale_runtime.project_revision,
                        selection: RefactorPlanSelection::All,
                    },
                    &stale_runtime,
                )
                .expect_err("stale sparse plan")
                .code,
            RefactorPlanFailureCode::StaleProjectRevision
        );
        assert_eq!(stale_session.project, after_unrelated);
    }

    #[test]
    fn passage_rename_planning_cancellation_staleness_and_session_isolation() {
        let mut original = session();
        let runtime = refactor_runtime(&original);
        let task = original
            .begin_passage_rename_plan(
                PlanPassageRenameRequest {
                    story_id: "story-1".into(),
                    passage_id: "b".into(),
                    after_name: "next".into(),
                },
                runtime.clone(),
            )
            .expect("case-only rename is distinct");
        let pending_diagnostics = original.performance_diagnostics();
        assert_eq!(pending_diagnostics.refactor_planning_task_count, 1);
        assert!(pending_diagnostics.refactor_planning_task_bytes > 0);
        assert!(original.cancel_passage_rename_plan(&task));
        let cancelled_diagnostics = original.performance_diagnostics();
        assert_eq!(cancelled_diagnostics.refactor_planning_task_count, 0);
        assert_eq!(cancelled_diagnostics.refactor_planning_task_bytes, 0);
        assert!(matches!(
            original.continue_passage_rename_plan(&task),
            PlanPassageRenameResult::Cancelled
        ));

        let stale_task = original
            .begin_passage_rename_plan(
                PlanPassageRenameRequest {
                    story_id: "story-1".into(),
                    passage_id: "b".into(),
                    after_name: "Néxt".into(),
                },
                runtime,
            )
            .expect("begin stale task");
        original
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "changed between planning chunks".into(),
            })
            .expect("unrelated mutation");
        assert!(matches!(
            original.continue_passage_rename_plan(&stale_task),
            PlanPassageRenameResult::Failure { failure }
                if failure.code == RefactorPlanFailureCode::StaleProjectRevision
        ));

        let mut replacement = session();
        assert!(matches!(
            replacement.continue_passage_rename_plan(&stale_task),
            PlanPassageRenameResult::Cancelled
        ));
        let decomposed = "Ne\u{301}xt";
        replacement.project.stories[0].passages = vec![
            passage("a", "Start", "", 0.0),
            passage("b", "Next", "", 200.0),
            passage("d", decomposed, "", 400.0),
        ]
        .into();
        let replacement_runtime = refactor_runtime(&replacement);
        assert!(
            replacement
                .begin_passage_rename_plan(
                    PlanPassageRenameRequest {
                        story_id: "story-1".into(),
                        passage_id: "b".into(),
                        after_name: "Néxt".into(),
                    },
                    replacement_runtime,
                )
                .is_ok()
        );
    }

    #[test]
    fn passage_rename_request_string_limit_is_utf8_exact_and_retains_no_task() {
        let mut session = session();
        let runtime = refactor_runtime(&session);
        let fixed_bytes = "story-1".len() + "b".len();
        let exact_after_name = "😀".repeat(
            (refactor::MAX_PASSAGE_RENAME_REQUEST_STRING_BYTES_V1 - fixed_bytes) / "😀".len(),
        );
        let exact = PlanPassageRenameRequest {
            story_id: "story-1".into(),
            passage_id: "b".into(),
            after_name: exact_after_name.clone(),
        };
        assert_eq!(
            refactor::passage_rename_request_string_bytes(&exact),
            refactor::MAX_PASSAGE_RENAME_REQUEST_STRING_BYTES_V1
        );
        let task = session
            .begin_passage_rename_plan(exact, runtime.clone())
            .expect("exact UTF-8 request limit is accepted");
        assert!(session.cancel_passage_rename_plan(&task));

        let oversized = PlanPassageRenameRequest {
            story_id: "story-1".into(),
            passage_id: "b".into(),
            after_name: format!("{exact_after_name}x"),
        };
        assert_eq!(
            refactor::passage_rename_request_string_bytes(&oversized),
            refactor::MAX_PASSAGE_RENAME_REQUEST_STRING_BYTES_V1 + 1
        );
        assert_eq!(
            session
                .begin_passage_rename_plan(oversized, runtime)
                .expect_err("one UTF-8 character over the limit")
                .code,
            RefactorPlanFailureCode::PlanTooLarge
        );
        let diagnostics = session.performance_diagnostics();
        assert_eq!(diagnostics.refactor_planning_task_count, 0);
        assert_eq!(diagnostics.refactor_planning_task_bytes, 0);
    }

    #[test]
    fn passage_rename_planner_releases_the_sole_task_for_staleness_and_later_planning() {
        let mut session = session();
        let runtime = refactor_runtime(&session);
        let first = session
            .begin_passage_rename_plan(
                PlanPassageRenameRequest {
                    story_id: "story-1".into(),
                    passage_id: "b".into(),
                    after_name: "First".into(),
                },
                runtime.clone(),
            )
            .expect("first planner starts");
        assert_eq!(
            session
                .begin_passage_rename_plan(
                    PlanPassageRenameRequest {
                        story_id: "story-1".into(),
                        passage_id: "b".into(),
                        after_name: "Second".into(),
                    },
                    runtime.clone(),
                )
                .expect_err("only one planner is retained")
                .code,
            RefactorPlanFailureCode::PlanTooLarge
        );
        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "planner invalidated".into(),
            })
            .expect("project mutation");
        assert!(matches!(
            session.continue_passage_rename_plan(&first),
            PlanPassageRenameResult::Failure { failure }
                if failure.code == RefactorPlanFailureCode::StaleProjectRevision
        ));
        assert_eq!(
            session
                .performance_diagnostics()
                .refactor_planning_task_count,
            0
        );
        let later = session
            .begin_passage_rename_plan(
                PlanPassageRenameRequest {
                    story_id: "story-1".into(),
                    passage_id: "b".into(),
                    after_name: "Later".into(),
                },
                refactor_runtime(&session),
            )
            .expect("later planner starts after stale task removal");
        assert!(session.cancel_passage_rename_plan(&later));
        let diagnostics = session.performance_diagnostics();
        assert_eq!(diagnostics.refactor_planning_task_count, 0);
        assert_eq!(diagnostics.refactor_planning_task_bytes, 0);
    }

    #[test]
    fn canonical_refactor_failures_at_each_child_and_derived_stage_roll_back_fully() {
        let change_count = canonical_refactor_changes(&session()).len();
        for failure in (0..change_count)
            .map(RefactorFailureInjection::Child)
            .chain(
                [
                    DerivedRefactorFailureStage::PassageNameIndex,
                    DerivedRefactorFailureStage::Fingerprints,
                    DerivedRefactorFailureStage::GraphCache,
                    DerivedRefactorFailureStage::BacklinkCache,
                    DerivedRefactorFailureStage::ContentsCatalog,
                    DerivedRefactorFailureStage::AnalysisCache,
                    DerivedRefactorFailureStage::ReadModelCache,
                ]
                .into_iter()
                .map(RefactorFailureInjection::Derived),
            )
        {
            let mut session = session_with_warm_refactor_caches();
            let sparse_refactor = matches!(failure, RefactorFailureInjection::Derived(_));
            let before = session.project.clone();
            let untouched_story_id = StoryId::new("story-2");
            let untouched_graph = format!("{:#?}", session.graph_cache.get(&untouched_story_id));
            let untouched_backlinks =
                format!("{:#?}", session.backlink_cache.get(&untouched_story_id));
            let untouched_contents = format!(
                "{:#?}",
                session.contents_catalog_cache.get(&untouched_story_id)
            );
            let untouched_analysis =
                format!("{:#?}", session.analysis_cache.get(&untouched_story_id));
            let untouched_read_model =
                format!("{:#?}", session.read_model_cache.get(&untouched_story_id));
            let untouched_backlink_lru = session
                .backlink_cache_lru
                .iter()
                .filter(|(story_id, _)| story_id == &untouched_story_id)
                .cloned()
                .collect::<Vec<_>>();
            let backlink_cache_hit_count = session.backlink_cache_hit_count;
            let runtime = refactor_runtime(&session);
            let summary = session
                .plan_refactor(if sparse_refactor {
                    sparse_refactor_draft(&session)
                } else {
                    refactor_draft(&session, canonical_refactor_changes(&session))
                })
                .expect("plan");
            session.inject_refactor_failure(failure);
            let mut expected_session = session.clone();
            expected_session.refactor_failure_injection = None;
            let result = session.apply_refactor_plan(
                &RefactorPlanApplyRequest {
                    plan_id: summary.plan_id.clone(),
                    expected_project_revision: runtime.project_revision,
                    selection: RefactorPlanSelection::All,
                },
                &runtime,
            );

            assert_eq!(
                result.unwrap_err().code,
                RefactorPlanFailureCode::InvalidPlan
            );
            assert_eq!(session.project, before);
            assert_eq!(session.revision(), 1);
            assert!(session.undo_stack.is_empty());
            assert!(session.redo_stack.is_empty());
            assert!(!session.dirty);
            assert_eq!(format!("{session:#?}"), format!("{expected_session:#?}"));
            assert_eq!(
                format!("{:#?}", session.graph_cache.get(&untouched_story_id)),
                untouched_graph
            );
            assert_eq!(
                format!("{:#?}", session.backlink_cache.get(&untouched_story_id)),
                untouched_backlinks
            );
            assert_eq!(
                format!(
                    "{:#?}",
                    session.contents_catalog_cache.get(&untouched_story_id)
                ),
                untouched_contents
            );
            assert_eq!(
                format!("{:#?}", session.analysis_cache.get(&untouched_story_id)),
                untouched_analysis
            );
            assert_eq!(
                format!("{:#?}", session.read_model_cache.get(&untouched_story_id)),
                untouched_read_model
            );
            assert_eq!(
                session
                    .backlink_cache_lru
                    .iter()
                    .filter(|(story_id, _)| story_id == &untouched_story_id)
                    .cloned()
                    .collect::<Vec<_>>(),
                untouched_backlink_lru
            );
            assert_eq!(session.backlink_cache_hit_count, backlink_cache_hit_count);
            assert_eq!(
                session
                    .performance_diagnostics()
                    .refactor_plan_store_entry_count,
                1
            );
            let batch = session
                .apply_refactor_plan(
                    &RefactorPlanApplyRequest {
                        plan_id: summary.plan_id,
                        expected_project_revision: runtime.project_revision,
                        selection: RefactorPlanSelection::All,
                    },
                    &runtime,
                )
                .expect("retry after injected failure");
            assert!(session.dirty);
            assert!(
                batch
                    .patches
                    .iter()
                    .any(|patch| matches!(patch, Patch::DirtyStateChanged { dirty: true }))
            );
            assert!(batch.patches.iter().any(|patch| matches!(
                patch,
                Patch::PassageUpdated {
                    changes,
                    passage_id,
                    story_id,
                } if story_id == "story-1"
                    && passage_id == "b"
                    && changes.name.as_deref() == Some("Continue")
            )));
            if !sparse_refactor {
                assert!(batch.patches.iter().any(|patch| matches!(
                    patch,
                    Patch::PassageUpdated {
                        changes,
                        passage_id,
                        story_id,
                    } if story_id == "story-1"
                        && passage_id == "a"
                        && changes.text.as_deref()
                            == Some("[[Continue]] [[Label->Next]] [[Next<-Back]]")
                )));
                assert!(batch.patches.iter().any(|patch| matches!(
                    patch,
                    Patch::PassageCreated { passage, story_id }
                        if story_id == "story-1" && passage.id == "d" && passage.name == "Destination"
                )));
                assert!(batch.patches.iter().any(|patch| matches!(
                    patch,
                    Patch::PassageDeleted { passage_id, story_id }
                        if story_id == "story-1" && passage_id == "c"
                )));
                assert!(batch.patches.iter().any(|patch| matches!(
                    patch,
                    Patch::StartPassageChanged { passage_id, story_id }
                        if story_id == "story-1" && passage_id == "d"
                )));
                assert!(batch.patches.iter().any(|patch| matches!(
                    patch,
                    Patch::StoryMetadataUpdated { changes, story_id }
                        if story_id == "story-1" && changes.name.as_deref() == Some("Revised")
                )));
                assert!(batch.patches.iter().any(|patch| matches!(
                    patch,
                    Patch::ProjectMetadataUpdated { changes, story_id }
                        if story_id == "story-1" && changes.name.as_deref() == Some("Revised Project")
                )));
            }
            assert_eq!(
                session.project.stories[0]
                    .passage_by_id(&PassageId::new("b"))
                    .expect("renamed passage")
                    .name,
                "Continue"
            );
            if !sparse_refactor {
                assert_eq!(
                    session.project.stories[0]
                        .passage_by_id(&PassageId::new("a"))
                        .expect("edited passage")
                        .text,
                    "[[Continue]] [[Label->Next]] [[Next<-Back]]"
                );
            }
            session
                .contents_page("story-1", CoreContentsQuery::default())
                .expect("affected contents catalog rebuild");
            session
                .contents_page(
                    "story-1",
                    CoreContentsQuery {
                        filter: CoreContentsFilter::Diagnostics,
                        ..CoreContentsQuery::default()
                    },
                )
                .expect("affected derived caches rebuild");
            assert!(session.graph_cache.contains_key(&StoryId::new("story-1")));
            assert!(
                session
                    .contents_catalog_cache
                    .contains_key(&StoryId::new("story-1"))
            );
            assert!(
                session
                    .analysis_cache
                    .contains_key(&StoryId::new("story-1"))
            );
            assert!(
                session
                    .read_model_cache
                    .contains_key(&StoryId::new("story-1"))
            );
            assert_eq!(
                session
                    .backlinks_page("story-1", "b", CoreBacklinksQuery::default())
                    .expect("affected backlink cache rebuild")
                    .total_count,
                usize::from(!sparse_refactor)
            );
            assert_eq!(
                format!("{:#?}", session.graph_cache.get(&untouched_story_id)),
                untouched_graph
            );
            assert_eq!(
                format!("{:#?}", session.backlink_cache.get(&untouched_story_id)),
                untouched_backlinks
            );
            assert_eq!(
                format!(
                    "{:#?}",
                    session.contents_catalog_cache.get(&untouched_story_id)
                ),
                untouched_contents
            );
            assert_eq!(
                format!("{:#?}", session.analysis_cache.get(&untouched_story_id)),
                untouched_analysis
            );
            assert_eq!(
                format!("{:#?}", session.read_model_cache.get(&untouched_story_id)),
                untouched_read_model
            );
            assert_eq!(session.backlink_cache_hit_count, backlink_cache_hit_count);
            let applied = session.project.clone();
            session.undo().expect("undo retried refactor");
            assert_eq!(session.project, before);
            session.redo().expect("redo retried refactor");
            assert_eq!(session.project, applied);
            assert_eq!(
                session
                    .backlinks_page("story-1", "b", CoreBacklinksQuery::default())
                    .expect("redo affected backlink cache")
                    .total_count,
                usize::from(!sparse_refactor)
            );
            assert_eq!(
                format!("{:#?}", session.graph_cache.get(&untouched_story_id)),
                untouched_graph
            );
            assert_eq!(session.backlink_cache_hit_count, backlink_cache_hit_count);
        }
    }

    #[test]
    fn canonical_refactor_stale_revision_rejects_after_an_unrelated_mutation() {
        let mut session = session();
        let planned_runtime = refactor_runtime(&session);
        let draft = refactor_draft(&session, canonical_refactor_changes(&session));
        let summary = session.plan_refactor(draft).expect("plan");
        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "b".into(),
                story_id: "story-1".into(),
                text: "unrelated committed edit".into(),
            })
            .expect("unrelated mutation");
        let after_unrelated = session.project.clone();
        let mut current_runtime = planned_runtime;
        current_runtime.project_revision = 2;
        let error = session
            .apply_refactor_plan(
                &RefactorPlanApplyRequest {
                    plan_id: summary.plan_id,
                    expected_project_revision: 1,
                    selection: RefactorPlanSelection::All,
                },
                &current_runtime,
            )
            .unwrap_err();

        assert_eq!(error.code, RefactorPlanFailureCode::StaleProjectRevision);
        assert_eq!(session.project, after_unrelated);
        assert_eq!(session.revision(), 2);
        assert_eq!(session.undo_stack.len(), 1);
    }

    #[test]
    fn canonical_refactor_handles_do_not_resolve_after_session_replacement() {
        let mut original = session();
        let original_runtime = refactor_runtime(&original);
        let original_draft = refactor_draft(&original, canonical_refactor_changes(&original));
        let old_summary = original.plan_refactor(original_draft).expect("old plan");

        let mut replacement = session();
        let replacement_runtime = refactor_runtime(&replacement);
        let replacement_draft =
            refactor_draft(&replacement, canonical_refactor_changes(&replacement));
        let replacement_summary = replacement
            .plan_refactor(replacement_draft)
            .expect("replacement plan");
        let before = replacement.project.clone();

        assert_ne!(old_summary.plan_id, replacement_summary.plan_id);
        assert_eq!(old_summary.plan_digest, replacement_summary.plan_digest);
        assert_eq!(
            original_runtime.project_revision,
            replacement_runtime.project_revision
        );
        assert_eq!(
            replacement
                .apply_refactor_plan(
                    &RefactorPlanApplyRequest {
                        plan_id: old_summary.plan_id,
                        expected_project_revision: replacement_runtime.project_revision,
                        selection: RefactorPlanSelection::All,
                    },
                    &replacement_runtime,
                )
                .unwrap_err()
                .code,
            RefactorPlanFailureCode::PlanEvicted
        );
        assert_eq!(replacement.project, before);
        assert_eq!(replacement.revision(), 1);
    }

    #[test]
    fn word_count_query_does_not_build_analysis_or_read_model_caches() {
        let session = session();

        assert_eq!(session.story_word_count("story-1").unwrap(), 4);
        let diagnostics = session.performance_diagnostics();
        assert_eq!(diagnostics.analysis_cache_source_count, 0);
        assert_eq!(diagnostics.graph_cache_story_count, 0);
        assert_eq!(diagnostics.read_model_cache_story_count, 0);
        assert!(diagnostics.last_mutation.is_none());
    }

    #[test]
    fn replace_all_text_is_one_incremental_session_transaction() {
        let mut session = session();
        session.project.stories[0].script = "const target = 'Next';".into();
        session.project.stories[0].stylesheet = ".Next { color: red; }".into();

        let batch = session
            .apply(StoryCommand::ReplaceAllText {
                query: CoreSearchQuery {
                    include_passage_names: false,
                    match_case: true,
                    query: "Next".into(),
                    replacement: Some("After".into()),
                    ..CoreSearchQuery::default()
                },
                story_id: "story-1".into(),
            })
            .expect("replace-all should apply");

        assert_eq!(session.undo_stack.len(), 1);
        assert!(batch.patches.iter().any(|patch| matches!(
            patch,
            Patch::PassageUpdated { changes, .. }
                if changes.text.as_deref().is_some_and(|text| text.contains("After"))
        )));
        assert!(batch
            .patches
            .iter()
            .any(|patch| matches!(patch, Patch::StoryScriptUpdated { script, .. } if script.contains("After"))));
        assert!(batch.patches.iter().any(
            |patch| matches!(patch, Patch::StoryStylesheetUpdated { stylesheet, .. } if stylesheet.contains("After"))
        ));

        session
            .undo()
            .expect("replace-all should undo as one entry");
        assert!(session.project.stories[0].script.contains("Next"));
        assert!(session.project.stories[0].stylesheet.contains("Next"));
    }

    #[test]
    fn literal_replace_all_treats_dollar_signs_literally() {
        let mut session = session();
        session
            .apply(StoryCommand::ReplaceAllText {
                query: CoreSearchQuery {
                    include_passage_names: false,
                    include_script: false,
                    include_stylesheet: false,
                    query: "Next".into(),
                    replacement: Some("$1".into()),
                    ..CoreSearchQuery::default()
                },
                story_id: "story-1".into(),
            })
            .expect("literal replacement should apply");

        assert!(
            session.project.stories[0]
                .passages
                .iter()
                .next()
                .expect("passage")
                .text
                .contains("$1")
        );
    }

    #[test]
    fn replace_all_renames_passages_and_updates_links_atomically() {
        let mut session = session();
        let batch = session
            .apply(StoryCommand::ReplaceAllText {
                query: CoreSearchQuery {
                    include_passage_text: false,
                    include_script: false,
                    include_stylesheet: false,
                    match_case: true,
                    query: "Next".into(),
                    replacement: Some("After".into()),
                    ..CoreSearchQuery::default()
                },
                story_id: "story-1".into(),
            })
            .expect("passage-name replacement should apply");

        assert_eq!(session.undo_stack.len(), 1);
        assert_eq!(
            session.project.stories[0]
                .passages
                .id_for_name("After")
                .map(|id| id.as_ref()),
            Some("b")
        );
        assert!(batch.patches.iter().any(|patch| matches!(
            patch,
            Patch::PassageUpdated { changes, passage_id, .. }
                if passage_id == "b" && changes.name.as_deref() == Some("After")
        )));
        assert!(
            session.project.stories[0]
                .passages
                .iter()
                .next()
                .expect("start passage")
                .text
                .contains("[[After]]")
        );
    }

    #[test]
    fn revision_bound_documents_follow_session_mutations() {
        let mut session = session();
        let initial = session
            .passage_document("story-1", "a")
            .expect("passage document");
        assert_eq!(initial.text, "[[Next]] [[Label->Next]] [[Next<-Back]]");

        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: "updated".into(),
            })
            .expect("text update");
        let updated = session
            .passage_document("story-1", "a")
            .expect("updated passage document");
        assert_eq!(updated.text, "updated");
        assert!(updated.revision > initial.revision);
    }

    #[test]
    fn passage_text_updates_create_and_clean_up_linked_passages_atomically() {
        let mut session = session();
        let created = session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: "[[Next]] [[New One]] [[Label->New Two]]".into(),
            })
            .expect("linked passages should be created");

        assert_eq!(session.project.stories[0].passages.len(), 5);
        assert!(
            session.project.stories[0]
                .passage_by_name("New One")
                .is_some()
        );
        assert!(
            session.project.stories[0]
                .passage_by_name("New Two")
                .is_some()
        );
        assert_eq!(
            created
                .patches
                .iter()
                .filter(|patch| matches!(patch, Patch::PassageCreated { .. }))
                .count(),
            2
        );
        assert_eq!(session.undo_stack.len(), 1);

        let removed = session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: "[[Next]]".into(),
            })
            .expect("untouched linked passages should be removed");

        assert_eq!(session.project.stories[0].passages.len(), 3);
        assert!(
            session.project.stories[0]
                .passage_by_name("New One")
                .is_none()
        );
        assert!(
            session.project.stories[0]
                .passage_by_name("New Two")
                .is_none()
        );
        assert_eq!(
            removed
                .patches
                .iter()
                .filter(|patch| matches!(patch, Patch::PassageDeleted { .. }))
                .count(),
            2
        );

        session.undo().expect("cleanup should be undoable");
        assert_eq!(session.project.stories[0].passages.len(), 5);
        assert_eq!(
            session.project.stories[0]
                .passage_by_id(&PassageId::new("a"))
                .expect("source passage")
                .text,
            "[[Next]] [[New One]] [[Label->New Two]]"
        );
    }

    #[test]
    fn linked_passage_cleanup_preserves_passages_the_author_touched_or_relinked() {
        let mut session = session();

        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: "[[Next]] [[Keep Tagged]] [[Keep Linked]]".into(),
            })
            .expect("linked passages should be created");
        let tagged_id = session.project.stories[0]
            .passage_by_name("Keep Tagged")
            .expect("tagged target")
            .id
            .as_ref()
            .to_owned();

        session
            .apply(StoryCommand::SetPassageTags {
                passage_id: tagged_id,
                story_id: "story-1".into(),
                tags: vec!["kept".into()],
            })
            .expect("target should be tagged");
        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "c".into(),
                story_id: "story-1".into(),
                text: "[[Keep Linked]]".into(),
            })
            .expect("second backlink should be created");
        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: "[[Next]]".into(),
            })
            .expect("source links should be removed");

        assert!(
            session.project.stories[0]
                .passage_by_name("Keep Tagged")
                .is_some()
        );
        assert!(
            session.project.stories[0]
                .passage_by_name("Keep Linked")
                .is_some()
        );
    }

    #[test]
    fn document_pages_are_bounded_complete_and_revision_bound() {
        let mut session = session();
        let first = session
            .document_page(
                "story-1",
                CoreDocumentQuery {
                    cursor: None,
                    limit: 2,
                },
            )
            .expect("first document page");
        assert_eq!(first.documents.len(), 2);
        assert_eq!(first.total_count, 5);
        let cursor = first.next_cursor.expect("next cursor");
        let second = session
            .document_page(
                "story-1",
                CoreDocumentQuery {
                    cursor: Some(cursor.clone()),
                    limit: 2,
                },
            )
            .expect("second document page");
        assert_eq!(second.documents.len(), 2);

        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: "changed".into(),
            })
            .expect("mutation");
        assert_eq!(
            session.document_page(
                "story-1",
                CoreDocumentQuery {
                    cursor: Some(cursor),
                    limit: 2,
                }
            ),
            Err(CoreError::StaleReadModelCursor)
        );
    }

    fn dense_source_only_session(target_count: usize) -> ProjectSession {
        let target_passages = (0..target_count)
            .map(|index| Passage {
                custom_attributes: BTreeMap::new(),
                id: PassageId::new(format!("target-{index}")),
                layout: None,
                metadata: BTreeMap::new(),
                name: format!("Target {index}"),
                source_pid: None,
                story: StoryId::new("story-1"),
                tags: Vec::new(),
                text: String::new(),
            })
            .collect::<Vec<_>>();
        let target_links = (0..target_count)
            .map(|index| format!("[[Target {index}]]"))
            .collect::<Vec<_>>()
            .join(" ");
        let mut passages = vec![Passage {
            custom_attributes: BTreeMap::new(),
            id: PassageId::new("start"),
            layout: None,
            metadata: BTreeMap::new(),
            name: "Start".into(),
            source_pid: None,
            story: StoryId::new("story-1"),
            tags: Vec::new(),
            text: target_links,
        }];

        passages.extend(target_passages);

        ProjectSession::new(Project {
            manifest: ProjectManifest {
                name: "Dense Layout".into(),
                storage: StoragePolicy::default(),
                ..ProjectManifest::default()
            },
            stories: vec![Story {
                id: StoryId::new("story-1"),
                ifid: "ifid".into(),
                name: "Dense Layout".into(),
                passages: PassageIndex::from(passages),
                start_passage: PassageId::new("start"),
                story_format: "Harlowe".into(),
                story_format_version: "3.3.9".into(),
                ..Story::default()
            }],
            ..Project::default()
        })
    }

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "twine-core-{label}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ))
    }

    fn tiny_png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();

        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes.extend([8, 6, 0, 0, 0, 0, 0, 0, 0]);
        bytes
    }

    fn touched_story_ids(patches: &[Patch]) -> BTreeSet<String> {
        patches
            .iter()
            .filter_map(|patch| match patch {
                Patch::AssetDeleted { story_id, .. }
                | Patch::AssetImported { story_id, .. }
                | Patch::AssetInventoryUpdated { story_id, .. }
                | Patch::AssetRenamed { story_id, .. }
                | Patch::AssetReplaced { story_id, .. }
                | Patch::AssetRevealed { story_id, .. }
                | Patch::AssetSnippetCopied { story_id, .. }
                | Patch::AssetSnippetInserted { story_id, .. }
                | Patch::GraphProjectionUpdated { story_id, .. }
                | Patch::LayoutSaved { story_id, .. }
                | Patch::PassageCreated { story_id, .. }
                | Patch::PassageDeleted { story_id, .. }
                | Patch::PassageUpdated { story_id, .. }
                | Patch::ProjectMetadataUpdated { story_id, .. }
                | Patch::StartPassageChanged { story_id, .. }
                | Patch::StoryDeleted { story_id }
                | Patch::StoryIndexUpdated { story_id, .. }
                | Patch::StoryMetadataUpdated { story_id, .. }
                | Patch::StoryScriptUpdated { story_id, .. }
                | Patch::StoryStylesheetUpdated { story_id, .. } => Some(story_id.clone()),
                Patch::StoryCreated { story } => Some(story.id.clone()),
                Patch::DirtyStateChanged { .. } | Patch::ProjectSnapshotReplaced { .. } => None,
            })
            .collect()
    }

    fn touched_passage_ids(patches: &[Patch]) -> BTreeSet<String> {
        patches
            .iter()
            .filter_map(|patch| match patch {
                Patch::PassageCreated { passage, .. } => Some(passage.id.clone()),
                Patch::PassageDeleted { passage_id, .. }
                | Patch::PassageUpdated { passage_id, .. } => Some(passage_id.clone()),
                _ => None,
            })
            .collect()
    }

    fn assert_no_snapshot_replacement(patches: &[Patch]) {
        assert!(
            !patches
                .iter()
                .any(|patch| matches!(patch, Patch::ProjectSnapshotReplaced { .. })),
            "patch batch should not contain ProjectSnapshotReplaced: {patches:#?}"
        );
    }

    #[test]
    fn applies_text_edit_as_minimal_patch() {
        let mut session = session();
        let batch = session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "b".into(),
                text: "[[Start]]".into(),
            })
            .expect("text update should apply");

        assert_eq!(batch.label, "Update Passage Text");
        assert!(session.dirty());
        assert_eq!(batch.patches.len(), 2);
        assert_no_snapshot_replacement(&batch.patches);
        assert_eq!(
            touched_story_ids(&batch.patches),
            BTreeSet::from(["story-1".into()])
        );
        assert_eq!(
            touched_passage_ids(&batch.patches),
            BTreeSet::from(["b".into()])
        );
        assert_eq!(
            batch.patches[0],
            Patch::PassageUpdated {
                story_id: "story-1".into(),
                passage_id: "b".into(),
                changes: PassagePatch {
                    text: Some("[[Start]]".into()),
                    ..PassagePatch::default()
                }
            }
        );
    }

    #[test]
    fn ordinary_text_edit_preserves_index_order_history_and_timing() {
        let mut session = session();
        let before = session.project.clone();
        let before_order = session.project.stories[0]
            .passages
            .iter()
            .map(|passage| passage.id.clone())
            .collect::<Vec<_>>();
        let unrelated_passages = ["b", "c"].map(|id| {
            session.project.stories[0]
                .passage_by_id(&PassageId::new(id))
                .expect("unrelated passage")
                .clone()
        });

        let batch = session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "ordinary local edit".into(),
            })
            .expect("ordinary text update should apply");

        assert_no_snapshot_replacement(&batch.patches);
        assert_eq!(
            touched_passage_ids(&batch.patches),
            BTreeSet::from(["a".into()])
        );
        let story = &session.project.stories[0];
        assert_eq!(
            story
                .passages
                .iter()
                .map(|passage| passage.id.clone())
                .collect::<Vec<_>>(),
            before_order
        );
        assert_eq!(
            story.passage_by_name("Start").map(|passage| &passage.id),
            Some(&PassageId::new("a"))
        );
        assert_eq!(
            story.passage_by_name("Next").map(|passage| &passage.id),
            Some(&PassageId::new("b"))
        );
        assert_eq!(
            story.passage_by_name("Loose").map(|passage| &passage.id),
            Some(&PassageId::new("c"))
        );
        assert_eq!(story.passages.rank_of(&PassageId::new("a")), Some(0));
        assert_eq!(story.passages.rank_of(&PassageId::new("b")), Some(1));
        assert_eq!(story.passages.rank_of(&PassageId::new("c")), Some(2));
        assert_eq!(
            story.passage_by_id(&PassageId::new("b")),
            Some(&unrelated_passages[0])
        );
        assert_eq!(
            story.passage_by_id(&PassageId::new("c")),
            Some(&unrelated_passages[1])
        );
        let timing = session
            .performance_diagnostics()
            .last_mutation
            .expect("ordinary text update should record timing");
        assert_eq!(timing.operation, "localPassageText");
        assert_eq!(timing.revision, session.revision());
        assert!(timing.project_mutation_ms.is_finite());
        assert!(timing.project_mutation_ms >= 0.0);

        let applied = session.project.clone();
        session.undo().expect("ordinary text update should undo");
        assert_eq!(session.project, before);
        session.redo().expect("ordinary text update should redo");
        assert_eq!(session.project, applied);
    }

    #[test]
    fn local_passage_text_reports_incremental_stage_timings_without_stale_no_op_data() {
        let mut session = session();

        let initial_backlinks = session
            .backlinks_page("story-1", "b", CoreBacklinksQuery::default())
            .expect("initial backlink page");
        assert_eq!(initial_backlinks.total_count, 1);
        session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Diagnostics,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("initial page should populate source and read-model caches");
        let initial_parse_count = session.analysis_parse_count;

        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "Local edit".into(),
            })
            .expect("local text update should apply");

        let timing = session
            .performance_diagnostics()
            .last_mutation
            .expect("local text update should expose stage timings");
        assert_eq!(timing.operation, "localPassageText");
        assert_eq!(timing.revision, session.revision());
        assert_eq!(timing.graph_parsed_source_count, 1);
        let stage_values = [
            timing.total_ms,
            timing.lookup_and_delta_ms,
            timing.project_mutation_ms,
            timing.fingerprint_ms,
            timing.graph_ms,
            timing.analysis_ms,
            timing.read_model_ms,
            timing.history_ms,
            timing.patch_finalize_ms,
        ];
        assert!(
            stage_values
                .iter()
                .all(|value| value.is_finite() && *value >= 0.0)
        );
        let stage_sum = timing.lookup_and_delta_ms
            + timing.project_mutation_ms
            + timing.fingerprint_ms
            + timing.graph_ms
            + timing.analysis_ms
            + timing.read_model_ms
            + timing.history_ms
            + timing.patch_finalize_ms;
        assert!(stage_sum <= timing.total_ms + 0.1);
        assert_eq!(session.analysis_parse_count, initial_parse_count + 1);
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_incremental_update_count, 1);
        assert_eq!(session.read_model_last_touched_source_count, 1);
        assert!(session.can_undo());

        let updated_backlinks = session
            .backlinks_page("story-1", "b", CoreBacklinksQuery::default())
            .expect("updated backlink page");
        assert_eq!(updated_backlinks.total_count, 0);
        session.undo().expect("local text update should undo");
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_incremental_update_count, 2);

        let original_text = session
            .story("story-1")
            .expect("story")
            .passage_by_id(&PassageId::new("a"))
            .expect("passage")
            .text
            .clone();
        let no_op = session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: original_text,
            })
            .expect("no-op local text update should succeed");
        assert!(no_op.patches.is_empty());
        assert!(session.performance_diagnostics().last_mutation.is_none());
    }

    #[test]
    fn no_op_commands_do_not_change_history_revision_or_dirty_state() {
        let mut session = session();
        let original_text = session
            .story("story-1")
            .expect("story")
            .passage_by_id(&PassageId::new("a"))
            .expect("passage")
            .text
            .clone();
        let batch = session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: original_text,
            })
            .expect("no-op update should succeed");

        assert!(batch.patches.is_empty());
        assert_eq!(session.revision(), 1);
        assert!(!session.dirty());
        assert!(!session.can_undo());
        assert!(!session.can_redo());
    }

    #[test]
    fn skipped_history_mutations_advance_revision_without_becoming_undoable() {
        let mut session = session();
        let batch = session
            .apply_with_history(
                StoryCommand::UpdatePassageText {
                    story_id: "story-1".into(),
                    passage_id: "a".into(),
                    text: "automatic initialization".into(),
                },
                false,
            )
            .expect("automatic mutation should apply");

        assert_eq!(batch.transaction_id, 1);
        assert_eq!(session.revision(), 2);
        assert!(session.dirty());
        assert!(!session.can_undo());
    }

    #[test]
    fn savepoints_survive_undo_redo_and_branching_history() {
        let mut session = session();

        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "saved".into(),
            })
            .expect("first edit");
        session.acknowledge_saved(session.revision());
        assert!(!session.status().dirty);

        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "later".into(),
            })
            .expect("second edit");
        assert!(session.status().dirty);

        let undo = session.undo().expect("undo second edit");
        assert_eq!(undo.transaction_id, 3);
        assert!(!session.status().dirty);

        let redo = session.redo().expect("redo second edit");
        assert_eq!(redo.transaction_id, 4);
        assert!(session.status().dirty);

        session.undo().expect("return to savepoint");
        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "branched".into(),
            })
            .expect("branch edit");
        assert!(!session.can_redo());
        assert!(session.status().dirty);
        session.undo().expect("undo branch");
        assert!(!session.status().dirty);
    }

    #[test]
    fn save_acknowledgement_updates_only_dirty_fingerprints() {
        let mut session = session();
        let untouched_field = "passage:story-1:b:text";
        let untouched_key_pointer = session
            .saved_fingerprints
            .get_key_value(untouched_field)
            .expect("untouched saved fingerprint")
            .0
            .as_ptr();

        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "saved without cloning every fingerprint".into(),
            })
            .expect("text edit");
        assert_eq!(
            session.dirty_fields,
            BTreeSet::from(["passage:story-1:a:text".into()])
        );

        session.acknowledge_saved(session.revision());

        assert!(!session.dirty());
        assert!(session.dirty_fields.is_empty());
        assert_eq!(session.saved_fingerprints, session.current_fingerprints);
        assert_eq!(
            session
                .saved_fingerprints
                .get_key_value(untouched_field)
                .expect("untouched saved fingerprint")
                .0
                .as_ptr(),
            untouched_key_pointer
        );
    }

    #[test]
    fn save_acknowledgement_merges_created_and_deleted_fingerprints() {
        let mut session = session();

        session
            .apply(StoryCommand::CreatePassage {
                id: Some("created".into()),
                layout: None,
                name: Some("Created".into()),
                story_id: "story-1".into(),
                tags: vec![],
                text: "New passage".into(),
            })
            .expect("create passage");
        session.acknowledge_saved(session.revision());
        assert_eq!(session.saved_fingerprints, session.current_fingerprints);
        assert!(
            session
                .saved_fingerprints
                .contains_key("passage:story-1:created:text")
        );

        session
            .apply(StoryCommand::DeletePassages {
                passage_ids: vec!["created".into()],
                story_id: "story-1".into(),
            })
            .expect("delete passage");
        session.acknowledge_saved(session.revision());
        assert_eq!(session.saved_fingerprints, session.current_fingerprints);
        assert!(
            session
                .saved_fingerprints
                .keys()
                .all(|field| !field.starts_with("passage:story-1:created:"))
        );
    }

    #[test]
    fn stale_save_acknowledgement_does_not_mark_newer_state_clean() {
        let mut session = session();

        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "first".into(),
            })
            .expect("first edit");
        let persisted_revision = session.revision();
        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "newer".into(),
            })
            .expect("newer edit");
        let saved_before = session.saved_fingerprints.clone();
        let dirty_before = session.dirty_fields.clone();

        session.acknowledge_saved(persisted_revision);
        assert!(session.status().dirty);
        assert_eq!(session.saved_fingerprints, saved_before);
        assert_eq!(session.dirty_fields, dirty_before);
    }

    #[test]
    fn accepted_external_delta_is_undoable_and_redo_returns_clean() {
        let mut session = session();
        let original = session
            .story("story-1")
            .expect("story")
            .passage_by_id(&PassageId::new("a"))
            .expect("passage");
        let delta = CoreExternalDelta {
            changes: vec![CoreExternalChange::UpsertPassage {
                passage: PassageSnapshot {
                    id: original.id.as_ref().into(),
                    layout: original.layout.map(CoreRect::from),
                    name: original.name.clone(),
                    story_id: "story-1".into(),
                    tags: original.tags.clone(),
                    text: "from disk".into(),
                },
                story_id: "story-1".into(),
            }],
            ..CoreExternalDelta::default()
        };

        session
            .apply_external_delta(delta)
            .expect("external delta should apply");
        assert!(!session.status().dirty);
        assert_eq!(
            session.status().undo_kind,
            Some(CoreHistoryKind::ExternalChanges)
        );

        session.undo().expect("external delta should undo");
        assert!(session.status().dirty);
        session.redo().expect("external delta should redo");
        assert!(!session.status().dirty);
    }

    #[test]
    fn external_ingest_merges_disjoint_fields_and_preserves_local_dirty_state() {
        let mut session = session();

        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "local text".into(),
            })
            .expect("local edit should apply");
        let result = session
            .ingest_external_delta(
                CoreExternalDelta {
                    changes: vec![CoreExternalChange::UpdatePassage {
                        changes: PassagePatch {
                            tags: Some(vec!["disk".into()]),
                            ..PassagePatch::default()
                        },
                        passage_id: "a".into(),
                        story_id: "story-1".into(),
                    }],
                    id: "disk-tags".into(),
                },
                CoreExternalIngestMode::Auto,
            )
            .expect("disjoint disk edit should merge");

        assert_eq!(result.outcome, CoreExternalIngestOutcome::Applied);
        assert!(result.conflicts.is_empty());
        assert!(session.status().dirty);
        assert_eq!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .tags,
            vec!["disk"]
        );
    }

    #[test]
    fn external_ingest_blocks_overlapping_local_fields() {
        let mut session = session();

        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "local text".into(),
            })
            .expect("local edit should apply");
        let result = session
            .ingest_external_delta(
                CoreExternalDelta {
                    changes: vec![CoreExternalChange::UpdatePassage {
                        changes: PassagePatch {
                            text: Some("disk text".into()),
                            ..PassagePatch::default()
                        },
                        passage_id: "a".into(),
                        story_id: "story-1".into(),
                    }],
                    id: "disk-text".into(),
                },
                CoreExternalIngestMode::Auto,
            )
            .expect("overlap should be reported");

        assert_eq!(result.outcome, CoreExternalIngestOutcome::Conflict);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(session.revision(), 2);
    }

    #[test]
    fn compact_external_same_value_accepts_dirty_field_without_conflict() {
        let mut session = session();

        session
            .apply(StoryCommand::UpdateStoryScript {
                script: "local script".into(),
                story_id: "story-1".into(),
            })
            .expect("local script edit");
        assert!(session.dirty());
        let revision = session.revision();
        let result = session
            .ingest_external_delta(
                CoreExternalDelta {
                    changes: vec![CoreExternalChange::UpdateStoryScript {
                        script: "local script".into(),
                        story_id: "story-1".into(),
                    }],
                    id: "same-script".into(),
                },
                CoreExternalIngestMode::Auto,
            )
            .expect("same incoming value should be accepted");

        assert_eq!(result.outcome, CoreExternalIngestOutcome::NoOp);
        assert!(result.conflicts.is_empty());
        assert!(!result.history_recorded);
        assert!(!session.dirty());
        assert_eq!(session.revision(), revision);
    }

    #[test]
    fn compact_external_mixed_batch_is_bounded_undoable_and_idempotent() {
        let mut large_story = story();
        large_story.passages = (0..5_000)
            .map(|index| {
                passage(
                    &format!("passage-{index:05}"),
                    &format!("Passage {index:05}"),
                    "body",
                    index as f64,
                )
            })
            .collect::<Vec<_>>()
            .into();
        large_story.start_passage = PassageId::new("passage-00000");
        let original_ifid = large_story.ifid.clone();
        let original_name = large_story.name.clone();
        let original_start = large_story.start_passage.clone();
        let mut project = Project {
            layout: GraphLayout::from_story_layout(&large_story),
            stories: vec![large_story],
            ..Project::default()
        };
        for passage_id in ["passage-00001", "passage-00003"] {
            let passage_id = PassageId::new(passage_id);
            let mut layout = project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &passage_id)
                .cloned()
                .expect("fixture layout");

            layout.group = Some("chapter-one".into());
            layout
                .metadata
                .insert("locked".into(), serde_json::json!(true));
            project
                .layout
                .passages
                .insert(StoryId::new("story-1"), passage_id, layout);
        }
        let mut session = ProjectSession::new(project);
        let mut disk_layout = GraphLayout::default();
        disk_layout
            .metadata
            .insert("source".into(), serde_json::json!("disk"));
        let delta = CoreExternalDelta {
            changes: vec![
                CoreExternalChange::UpdatePassage {
                    changes: PassagePatch {
                        layout: Some(CoreRect {
                            height: 120.0,
                            left: 900.0,
                            top: 40.0,
                            width: 160.0,
                        }),
                        name: Some("Renamed Passage".into()),
                        tags: Some(vec!["disk".into()]),
                        text: Some("disk body".into()),
                    },
                    passage_id: "passage-00001".into(),
                    story_id: "story-1".into(),
                },
                CoreExternalChange::UpdatePassageLayout {
                    layout: None,
                    passage_id: "passage-00002".into(),
                    story_id: "story-1".into(),
                },
                CoreExternalChange::UpdatePassageLayout {
                    layout: Some(CoreRect {
                        height: 100.0,
                        left: 1_200.0,
                        top: 80.0,
                        width: 100.0,
                    }),
                    passage_id: "passage-00003".into(),
                    story_id: "story-1".into(),
                },
                CoreExternalChange::UpdateStoryMetadata {
                    changes: StoryMetadataPatch {
                        ifid: Some("DISK-IFID".into()),
                        name: Some("Disk Story".into()),
                        zoom: Some(1.5),
                        ..StoryMetadataPatch::default()
                    },
                    story_id: "story-1".into(),
                },
                CoreExternalChange::UpdateStoryStartPassage {
                    passage_id: "passage-00004".into(),
                    story_id: "story-1".into(),
                },
                CoreExternalChange::UpdateStoryScript {
                    script: "const disk = true;".into(),
                    story_id: "story-1".into(),
                },
                CoreExternalChange::UpdateStoryStylesheet {
                    story_id: "story-1".into(),
                    stylesheet: ".disk {}".into(),
                },
                CoreExternalChange::UpdateProjectLayout {
                    layout_json: serde_json::to_string(&disk_layout).expect("layout json"),
                },
            ],
            id: "compact-mixed".into(),
        };

        let result = session
            .ingest_external_delta(delta.clone(), CoreExternalIngestMode::Force)
            .expect("compact mixed batch");

        assert_eq!(result.outcome, CoreExternalIngestOutcome::Applied);
        assert!(result.history_recorded);
        assert!(!session.dirty());
        assert_eq!(session.undo_stack.len(), 1);
        let transaction = session.undo_stack.last().expect("external transaction");
        assert_eq!(transaction.delta.stories.len(), 1);
        let StoryDelta::Update {
            after,
            before,
            passages,
            ..
        } = &transaction.delta.stories[0]
        else {
            panic!("expected compact story delta");
        };
        assert!(before.passages.is_empty());
        assert!(after.passages.is_empty());
        assert_eq!(passages.len(), 3);
        assert_eq!(transaction.delta.layout_passages.len(), 3);
        let project_layout = transaction
            .delta
            .project_layout
            .as_ref()
            .expect("compact project layout delta");
        assert!(project_layout.before.passages.is_empty());
        assert!(project_layout.after.passages.is_empty());
        assert!(transaction.byte_size < 100_000);
        let diagnostics = session.performance_diagnostics();
        assert_eq!(diagnostics.analysis_cache_source_count, 0);
        assert_eq!(diagnostics.graph_cache_story_count, 0);
        assert_eq!(diagnostics.read_model_cache_story_count, 0);
        assert!(diagnostics.last_mutation.is_none());
        assert_eq!(
            session.current_fingerprints.get("project:layout"),
            session.saved_fingerprints.get("project:layout")
        );
        assert_eq!(
            session.project.layout.metadata.get("source"),
            Some(&serde_json::json!("disk"))
        );
        assert_eq!(
            session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new("passage-00001"))
                .expect("updated external layout")
                .bounds
                .left,
            900.0
        );
        assert!(
            session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new("passage-00002"))
                .is_none()
        );
        assert_eq!(
            session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new("passage-00003"))
                .expect("added external layout")
                .bounds
                .left,
            1_200.0
        );
        for passage_id in ["passage-00001", "passage-00003"] {
            let layout = session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new(passage_id))
                .expect("moved external layout should retain metadata");

            assert_eq!(layout.group.as_deref(), Some("chapter-one"));
            assert_eq!(
                layout.metadata.get("locked"),
                Some(&serde_json::json!(true))
            );
        }

        session.undo().expect("undo compact external batch");
        assert!(session.dirty());
        assert_eq!(session.story("story-1").unwrap().ifid, original_ifid);
        assert_eq!(session.story("story-1").unwrap().name, original_name);
        assert_eq!(
            session.story("story-1").unwrap().start_passage,
            original_start
        );
        assert!(!session.project.layout.metadata.contains_key("source"));
        assert_eq!(
            session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new("passage-00002"))
                .expect("removed layout should restore")
                .bounds
                .left,
            2.0
        );
        session.redo().expect("redo compact external batch");
        assert!(!session.dirty());
        assert_eq!(session.story("story-1").unwrap().ifid, "DISK-IFID");
        assert_eq!(session.story("story-1").unwrap().name, "Disk Story");
        assert_eq!(
            session.project.layout.metadata.get("source"),
            Some(&serde_json::json!("disk"))
        );
        assert!(
            session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new("passage-00002"))
                .is_none()
        );
        let revision = session.revision();
        let duplicate = session
            .ingest_external_delta(delta, CoreExternalIngestMode::Force)
            .expect("duplicate compact delta");
        assert_eq!(duplicate.outcome, CoreExternalIngestOutcome::NoOp);
        assert_eq!(session.revision(), revision);
    }

    #[test]
    fn compact_external_batch_conflicts_and_validation_do_not_partially_apply() {
        let mut session = session();

        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: "local text".into(),
            })
            .expect("local text");
        session
            .apply(StoryCommand::UpdateStoryScript {
                script: "local script".into(),
                story_id: "story-1".into(),
            })
            .expect("local script");
        let revision = session.revision();
        let incoming = CoreExternalDelta {
            changes: vec![
                CoreExternalChange::UpdateStoryMetadata {
                    changes: StoryMetadataPatch {
                        name: Some("Disk Story".into()),
                        ..StoryMetadataPatch::default()
                    },
                    story_id: "story-1".into(),
                },
                CoreExternalChange::UpdateStoryScript {
                    script: "disk script".into(),
                    story_id: "story-1".into(),
                },
            ],
            id: "compact-conflict".into(),
        };
        let conflict = session
            .ingest_external_delta(incoming.clone(), CoreExternalIngestMode::Auto)
            .expect("compact conflict");

        assert_eq!(conflict.outcome, CoreExternalIngestOutcome::Conflict);
        assert_eq!(conflict.conflicts.len(), 1);
        assert_eq!(conflict.conflicts[0].field, "story:story-1:script");
        assert_eq!(session.revision(), revision);
        assert_eq!(session.story("story-1").unwrap().name, "Example");
        assert_eq!(session.story("story-1").unwrap().script, "local script");

        let forced = session
            .ingest_external_delta(incoming, CoreExternalIngestMode::Force)
            .expect("force compact batch");
        assert_eq!(forced.outcome, CoreExternalIngestOutcome::Applied);
        assert_eq!(session.story("story-1").unwrap().name, "Disk Story");
        assert_eq!(session.story("story-1").unwrap().script, "disk script");
        assert!(
            session.dirty(),
            "unrelated local passage text remains dirty"
        );

        let revision = session.revision();
        let undo_count = session.undo_stack.len();
        let error = session.ingest_external_delta(
            CoreExternalDelta {
                changes: vec![
                    CoreExternalChange::UpdateStoryMetadata {
                        changes: StoryMetadataPatch {
                            name: Some("Must Not Apply".into()),
                            ..StoryMetadataPatch::default()
                        },
                        story_id: "story-1".into(),
                    },
                    CoreExternalChange::UpdateProjectLayout {
                        layout_json: "not json".into(),
                    },
                ],
                id: "compact-invalid".into(),
            },
            CoreExternalIngestMode::Force,
        );
        assert!(matches!(error, Err(CoreError::UnsupportedCommand(_))));
        assert_eq!(session.revision(), revision);
        assert_eq!(session.undo_stack.len(), undo_count);
        assert_eq!(session.story("story-1").unwrap().name, "Disk Story");
    }

    #[test]
    fn external_assets_require_review_and_force_without_history() {
        let mut session = session();
        let asset = asset_inventory_entry(
            "assets/cover.png".into(),
            "image".into(),
            Some(true),
            Vec::new(),
        );
        let delta = CoreExternalDelta {
            changes: vec![CoreExternalChange::UpsertAsset {
                asset: asset.clone(),
            }],
            id: "asset-change".into(),
        };

        let review = session
            .ingest_external_delta(delta.clone(), CoreExternalIngestMode::Auto)
            .expect("asset review should be returned");

        assert_eq!(review.outcome, CoreExternalIngestOutcome::Conflict);
        assert!(!session.can_undo());

        let accepted = session
            .ingest_external_delta(delta.clone(), CoreExternalIngestMode::Force)
            .expect("asset should be accepted");

        assert_eq!(accepted.outcome, CoreExternalIngestOutcome::Applied);
        assert_eq!(session.asset_inventory(), &[asset]);
        assert!(!session.can_undo());
        assert!(!session.dirty());
        let revision = session.revision();

        let duplicate = session
            .ingest_external_delta(delta, CoreExternalIngestMode::Force)
            .expect("duplicate should be idempotent");

        assert_eq!(duplicate.outcome, CoreExternalIngestOutcome::NoOp);
        assert_eq!(session.revision(), revision);
    }

    #[test]
    fn passage_history_retains_only_the_changed_entity() {
        let mut session = session();

        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "incremental".into(),
            })
            .expect("edit should apply");

        let transaction = session.undo_stack.last().expect("history entry");
        let StoryDelta::Update { passages, .. } = &transaction.delta.stories[0] else {
            panic!("passage edit should use an incremental story delta");
        };

        assert_eq!(transaction.delta.stories.len(), 1);
        assert_eq!(passages.len(), 1);
        assert_eq!(passages[0].passage_id, PassageId::new("a"));
    }

    #[test]
    fn layout_edits_and_undo_reuse_parsed_graph_facts() {
        let mut session = session();

        session
            .graph_projection("story-1", CoreGraphProjectionOptions::default())
            .expect("graph should build");
        assert!(session.graph_cache.contains_key(&StoryId::new("story-1")));

        session
            .apply(StoryCommand::MovePassages {
                story_id: "story-1".into(),
                moves: vec![PassageMove {
                    bounds: CoreRect {
                        height: 100.0,
                        left: 250.0,
                        top: 125.0,
                        width: 100.0,
                    },
                    passage_id: "a".into(),
                }],
            })
            .expect("layout edit should apply");
        assert!(session.graph_cache.contains_key(&StoryId::new("story-1")));

        session.undo().expect("layout edit should undo");
        assert!(session.graph_cache.contains_key(&StoryId::new("story-1")));

        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "topology changed [[Start]]".into(),
            })
            .expect("text edit should apply");
        assert!(session.graph_cache.contains_key(&StoryId::new("story-1")));
        assert_eq!(
            session
                .graph_cache
                .get(&StoryId::new("story-1"))
                .expect("incremental graph")
                .graph
                .links_from(&PassageId::new("a"))
                .len(),
            1
        );
        assert_eq!(
            session
                .graph_cache
                .get(&StoryId::new("story-1"))
                .expect("incremental graph")
                .graph
                .last_incremental_parse_count(),
            1
        );
    }

    #[test]
    fn passage_layouts_are_isolated_between_stories_with_matching_ids() {
        let first = story();
        let mut second = story();

        second.id = StoryId::new("story-2");
        second.name = "Second".into();
        for passage in &mut second.passages {
            passage.story = second.id.clone();
            if let Some(layout) = &mut passage.layout {
                layout.left += 1_000.0;
            }
        }

        let mut project = Project::from_story(first);
        project
            .layout
            .passages
            .append(GraphLayout::from_story_layout(&second).passages);
        project.stories.push(second);
        for (story_id, group) in [("story-1", "first"), ("story-2", "second")] {
            let story_id = StoryId::new(story_id);
            let passage_id = PassageId::new("a");
            let mut layout = project
                .layout
                .passages
                .get(&story_id, &passage_id)
                .cloned()
                .expect("fixture layout");

            layout.group = Some(group.into());
            layout
                .metadata
                .insert("locked".into(), serde_json::json!(true));
            project.layout.passages.insert(story_id, passage_id, layout);
        }
        let mut session = ProjectSession::new(project);

        for (story_id, left) in [("story-1", 125.0), ("story-2", 825.0)] {
            session
                .apply(StoryCommand::MovePassages {
                    story_id: story_id.into(),
                    moves: vec![PassageMove {
                        bounds: CoreRect {
                            height: DEFAULT_CARD_HEIGHT,
                            left,
                            top: 75.0,
                            width: DEFAULT_CARD_WIDTH,
                        },
                        passage_id: "a".into(),
                    }],
                })
                .expect("story-scoped move should apply");
        }

        assert_eq!(
            session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new("a"))
                .expect("first story layout")
                .bounds
                .left,
            125.0
        );
        assert_eq!(
            session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-2"), &PassageId::new("a"))
                .expect("second story layout")
                .bounds
                .left,
            825.0
        );

        for (story_id, left) in [("story-1", 125.0), ("story-2", 825.0)] {
            let projection = session
                .graph_projection(story_id, CoreGraphProjectionOptions::default())
                .expect("story graph should project");
            let passage = projection
                .nodes
                .iter()
                .find(|node| node.id == "a")
                .expect("matching passage should project");

            assert_eq!(passage.bounds.left, left);
            let saved = session
                .project
                .layout
                .passages
                .get(&StoryId::new(story_id), &PassageId::new("a"))
                .expect("saved passage layout");

            assert_eq!(
                saved.group.as_deref(),
                Some(if story_id == "story-1" {
                    "first"
                } else {
                    "second"
                })
            );
            assert_eq!(saved.metadata.get("locked"), Some(&serde_json::json!(true)));
        }
    }

    #[test]
    fn deleting_a_passage_removes_its_saved_layout_before_recreation() {
        let mut session = session();

        session
            .apply(StoryCommand::MovePassages {
                story_id: "story-1".into(),
                moves: vec![PassageMove {
                    bounds: CoreRect {
                        height: DEFAULT_CARD_HEIGHT,
                        left: 777.0,
                        top: 222.0,
                        width: DEFAULT_CARD_WIDTH,
                    },
                    passage_id: "a".into(),
                }],
            })
            .expect("layout move should apply");
        session
            .apply(StoryCommand::DeletePassages {
                passage_ids: vec!["a".into()],
                story_id: "story-1".into(),
            })
            .expect("passage delete should apply");

        assert!(
            session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new("a"))
                .is_none()
        );

        session
            .apply(StoryCommand::CreatePassage {
                id: Some("a".into()),
                layout: None,
                name: Some("Recreated".into()),
                story_id: "story-1".into(),
                tags: vec![],
                text: String::new(),
            })
            .expect("passage recreation should apply");
        let projection = session
            .graph_projection("story-1", CoreGraphProjectionOptions::default())
            .expect("recreated graph should project");
        let recreated = projection
            .nodes
            .iter()
            .find(|node| node.id == "a")
            .expect("recreated passage should project");

        assert_eq!(recreated.layout_source, CoreGraphLayoutSource::Generated);
        assert_ne!(recreated.bounds.left, 777.0);
    }

    #[test]
    fn replacing_a_story_rebuilds_its_scoped_layouts() {
        let mut session = session();
        let mut replacement = story();
        let mut reused = replacement
            .passage_by_id(&PassageId::new("a"))
            .expect("replacement passage")
            .clone();

        reused.layout = None;
        replacement.passages = vec![reused].into();
        replacement.start_passage = PassageId::new("a");

        session
            .apply(StoryCommand::ReplaceStory {
                story: StorySnapshot::from(&replacement),
                story_id: "story-1".into(),
            })
            .expect("story replacement should apply");

        assert!(
            session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new("a"))
                .is_none()
        );
        assert!(
            session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new("b"))
                .is_none()
        );
        let projection = session
            .graph_projection("story-1", CoreGraphProjectionOptions::default())
            .expect("replacement graph should project");
        let reused = projection
            .nodes
            .iter()
            .find(|node| node.id == "a")
            .expect("reused passage should project");

        assert_eq!(reused.layout_source, CoreGraphLayoutSource::Generated);
    }

    #[test]
    fn story_analysis_reparses_only_changed_sources() {
        let mut session = session();

        session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .expect("initial index");
        let initial_parse_count = session.analysis_parse_count;

        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "changed source".into(),
            })
            .expect("passage edit");
        session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .expect("updated index");
        assert_eq!(session.analysis_parse_count, initial_parse_count + 1);

        session
            .apply(StoryCommand::MovePassages {
                story_id: "story-1".into(),
                moves: vec![PassageMove {
                    bounds: CoreRect {
                        height: 100.0,
                        left: 400.0,
                        top: 300.0,
                        width: 100.0,
                    },
                    passage_id: "a".into(),
                }],
            })
            .expect("layout edit");
        session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .expect("layout-only index");
        assert_eq!(session.analysis_parse_count, initial_parse_count + 1);

        session
            .apply(StoryCommand::UpdateStoryScript {
                script: "window.changed = true;".into(),
                story_id: "story-1".into(),
            })
            .expect("script edit");
        session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .expect("script index");
        assert_eq!(session.analysis_parse_count, initial_parse_count + 2);
    }

    #[test]
    fn history_evicts_oldest_complete_transactions() {
        let mut session = session();

        for index in 0..=MAX_HISTORY_ENTRIES {
            session
                .apply(StoryCommand::UpdatePassageText {
                    story_id: "story-1".into(),
                    passage_id: "a".into(),
                    text: format!("edit {index}"),
                })
                .expect("edit should apply");
        }

        assert_eq!(session.undo_stack.len(), MAX_HISTORY_ENTRIES);
        assert!(session.history_bytes <= MAX_HISTORY_BYTES);
    }

    #[test]
    fn rolls_back_batch_when_child_command_fails() {
        let mut session = session();
        let error = session
            .apply(StoryCommand::Batch {
                commands: vec![
                    StoryCommand::UpdatePassageText {
                        story_id: "story-1".into(),
                        passage_id: "a".into(),
                        text: "Changed".into(),
                    },
                    StoryCommand::SetStartPassage {
                        story_id: "story-1".into(),
                        passage_id: "missing".into(),
                    },
                ],
            })
            .expect_err("batch should fail");

        assert!(matches!(error, CoreError::PassageNotFound(_)));
        assert_eq!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .text,
            "[[Next]] [[Label->Next]] [[Next<-Back]]"
        );
        assert!(!session.dirty());
        assert!(!session.can_undo());
        assert!(!session.can_redo());

        let follow_up = session
            .apply(StoryCommand::QueryStoryIndex {
                story_id: "story-1".into(),
                options: CoreStoryIndexOptions::default(),
            })
            .expect("follow-up query should apply");

        assert_eq!(follow_up.transaction_id, 1);
    }

    #[test]
    fn sessions_can_be_seeded_at_a_renderer_revision() {
        let mut session = ProjectSession::new_at_revision(session().project().clone(), 42);

        assert_eq!(session.revision(), 42);

        let batch = session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "a".into(),
                text: "Renderer revision aligned".into(),
            })
            .expect("command should apply");

        assert_eq!(batch.transaction_id, 42);
        assert_eq!(session.revision(), 43);
    }

    #[test]
    fn direct_graph_and_index_queries_do_not_consume_revisions() {
        let mut session = session();

        assert_eq!(session.revision(), 1);
        session
            .graph_projection("story-1", CoreGraphProjectionOptions::default())
            .expect("graph should query");
        session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .expect("index should query");
        assert_eq!(session.revision(), 1);
    }

    #[test]
    fn rolls_back_move_passages_when_one_move_fails() {
        let mut session = session();
        let error = session
            .apply(StoryCommand::MovePassages {
                story_id: "story-1".into(),
                moves: vec![
                    PassageMove {
                        passage_id: "a".into(),
                        bounds: CoreRect {
                            height: DEFAULT_CARD_HEIGHT,
                            left: 50.0,
                            top: 60.0,
                            width: DEFAULT_CARD_WIDTH,
                        },
                    },
                    PassageMove {
                        passage_id: "missing".into(),
                        bounds: CoreRect {
                            height: DEFAULT_CARD_HEIGHT,
                            left: 70.0,
                            top: 80.0,
                            width: DEFAULT_CARD_WIDTH,
                        },
                    },
                ],
            })
            .expect_err("move should fail");

        assert!(matches!(error, CoreError::PassageNotFound(_)));
        assert_eq!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .layout
                .expect("layout")
                .left,
            0.0
        );
        assert_eq!(
            session
                .project
                .layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new("a"))
                .expect("project layout")
                .bounds
                .left,
            0.0
        );
        assert!(!session.dirty());
        assert!(!session.can_undo());
        assert!(!session.can_redo());
    }

    #[test]
    fn renames_passage_and_standard_references_in_one_transaction() {
        let mut session = session();
        let batch = session
            .apply(StoryCommand::RenamePassage {
                story_id: "story-1".into(),
                passage_id: "b".into(),
                name: "Renamed".into(),
                update_references: true,
            })
            .expect("rename should apply");

        assert_eq!(batch.label, "Rename Passage");
        assert_eq!(batch.patches.len(), 3);
        assert_eq!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .text,
            "[[Renamed]] [[Label->Renamed]] [[Renamed<-Back]]"
        );

        session.undo().expect("undo should be available");
        assert_eq!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("b"))
                .expect("passage")
                .name,
            "Next"
        );

        session.redo().expect("redo should be available");
        assert_eq!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("b"))
                .expect("passage")
                .name,
            "Renamed"
        );
    }

    #[test]
    fn updates_story_sources_as_minimal_patches() {
        let mut session = session();
        let script_batch = session
            .apply(StoryCommand::UpdateStoryScript {
                story_id: "story-1".into(),
                script: "window.storyReady = true;".into(),
            })
            .expect("script update should apply");
        let stylesheet_batch = session
            .apply(StoryCommand::UpdateStoryStylesheet {
                story_id: "story-1".into(),
                stylesheet: "tw-story { color: red; }".into(),
            })
            .expect("stylesheet update should apply");

        assert_eq!(
            script_batch.patches[0],
            Patch::StoryScriptUpdated {
                story_id: "story-1".into(),
                script: "window.storyReady = true;".into(),
            }
        );
        assert_eq!(
            stylesheet_batch.patches[0],
            Patch::StoryStylesheetUpdated {
                story_id: "story-1".into(),
                stylesheet: "tw-story { color: red; }".into(),
            }
        );
    }

    #[test]
    fn updates_story_metadata_through_commands() {
        let mut session = session();

        session
            .apply(StoryCommand::RenameStory {
                story_id: "story-1".into(),
                name: "Renamed Story".into(),
            })
            .expect("story rename should apply");
        session
            .apply(StoryCommand::SetStoryFormat {
                story_id: "story-1".into(),
                story_format: "Chapbook".into(),
                story_format_version: "2.2.0".into(),
            })
            .expect("story format should apply");
        session
            .apply(StoryCommand::SetStorySnapToGrid {
                story_id: "story-1".into(),
                enabled: false,
            })
            .expect("snap-to-grid should apply");
        let zoom_batch = session
            .apply(StoryCommand::SetStoryZoom {
                story_id: "story-1".into(),
                zoom: 0.6,
            })
            .expect("zoom should apply");
        let story = session.story("story-1").expect("story");

        assert_eq!(story.name, "Renamed Story");
        assert_eq!(story.story_format, "Chapbook");
        assert_eq!(story.story_format_version, "2.2.0");
        assert!(!story.snap_to_grid);
        assert_eq!(story.zoom, 0.6);
        assert_eq!(zoom_batch.label, "Set Story Zoom");
        assert_eq!(
            zoom_batch.patches[0],
            Patch::StoryMetadataUpdated {
                changes: StoryMetadataPatch {
                    zoom: Some(0.6),
                    ..StoryMetadataPatch::default()
                },
                story_id: "story-1".into(),
            }
        );
        assert_no_snapshot_replacement(&zoom_batch.patches);
        assert_eq!(
            touched_story_ids(&zoom_batch.patches),
            BTreeSet::from(["story-1".into()])
        );
        assert!(touched_passage_ids(&zoom_batch.patches).is_empty());
    }

    #[test]
    fn generic_passage_update_returns_only_touched_passage_patch() {
        let mut session = session();
        let batch = session
            .apply(StoryCommand::UpdatePassage {
                changes: PassagePatch {
                    layout: Some(CoreRect {
                        height: 120.0,
                        left: 15.0,
                        top: 25.0,
                        width: 180.0,
                    }),
                    tags: Some(vec!["scene".into()]),
                    ..PassagePatch::default()
                },
                passage_id: "a".into(),
                story_id: "story-1".into(),
                update_references: true,
            })
            .expect("generic passage update should apply");

        assert_no_snapshot_replacement(&batch.patches);
        assert_eq!(
            touched_story_ids(&batch.patches),
            BTreeSet::from(["story-1".into()])
        );
        assert_eq!(
            touched_passage_ids(&batch.patches),
            BTreeSet::from(["a".into()])
        );
        assert!(batch.patches.iter().any(|patch| {
            matches!(
                patch,
                Patch::PassageUpdated {
                    changes: PassagePatch {
                        layout: Some(_),
                        ..
                    },
                    passage_id,
                    ..
                } if passage_id == "a"
            )
        }));
    }

    #[test]
    fn undo_redo_return_touched_id_patches_only() {
        let mut session = session();

        session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "b".into(),
                text: "Changed".into(),
            })
            .expect("text update should apply");

        let undo = session.undo().expect("undo should be available");
        assert_no_snapshot_replacement(&undo.patches);
        assert_eq!(
            touched_story_ids(&undo.patches),
            BTreeSet::from(["story-1".into()])
        );
        assert_eq!(
            touched_passage_ids(&undo.patches),
            BTreeSet::from(["b".into()])
        );
        assert_eq!(
            undo.patches[0],
            Patch::PassageUpdated {
                changes: PassagePatch {
                    text: Some("[[Missing]]".into()),
                    ..PassagePatch::default()
                },
                passage_id: "b".into(),
                story_id: "story-1".into(),
            }
        );

        let redo = session.redo().expect("redo should be available");
        assert_no_snapshot_replacement(&redo.patches);
        assert_eq!(
            touched_story_ids(&redo.patches),
            BTreeSet::from(["story-1".into()])
        );
        assert_eq!(
            touched_passage_ids(&redo.patches),
            BTreeSet::from(["b".into()])
        );
        assert_eq!(
            redo.patches[0],
            Patch::PassageUpdated {
                changes: PassagePatch {
                    text: Some("Changed".into()),
                    ..PassagePatch::default()
                },
                passage_id: "b".into(),
                story_id: "story-1".into(),
            }
        );
    }

    #[test]
    fn returns_graph_projection_patch_without_marking_dirty() {
        let mut session = session();
        let batch = session
            .apply(StoryCommand::QueryGraphProjection {
                story_id: "story-1".into(),
                options: CoreGraphProjectionOptions {
                    viewport: Some(CoreRect {
                        height: 150.0,
                        left: 0.0,
                        top: 0.0,
                        width: 250.0,
                    }),
                    ..CoreGraphProjectionOptions::default()
                },
            })
            .expect("projection should apply");

        assert!(!session.dirty());
        assert_eq!(batch.patches.len(), 1);

        let Patch::GraphProjectionUpdated { projection, .. } = &batch.patches[0] else {
            panic!("expected projection patch");
        };

        assert_eq!(projection.layout_state, CoreGraphLayoutState::Saved);
        assert!(projection.nodes.iter().any(|node| node.id == "a"));
        assert!(
            projection
                .edges
                .iter()
                .any(|edge| edge.target_name == "Next")
        );
    }

    #[test]
    fn returns_story_index_patch_without_marking_dirty() {
        let mut session = session();
        let batch = session
            .apply(StoryCommand::QueryStoryIndex {
                story_id: "story-1".into(),
                options: CoreStoryIndexOptions {
                    query: Some("missing".into()),
                    ..CoreStoryIndexOptions::default()
                },
            })
            .expect("index query should apply");

        assert!(!session.dirty());
        assert_eq!(batch.patches.len(), 1);

        let Patch::StoryIndexUpdated { index, .. } = &batch.patches[0] else {
            panic!("expected story index patch");
        };

        assert_eq!(index.files.len(), 5);
        assert_eq!(index.graph.broken_links, 1);
        assert!(
            index
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "broken-link")
        );
        assert!(
            !index
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "unreachable-passage")
        );
        assert!(
            index
                .search_hits
                .iter()
                .any(|hit| hit.source_name == "Next")
        );
    }

    #[test]
    fn read_model_pages_are_bounded_and_revision_bound() {
        let mut session = session();
        let first = session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    limit: 1,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("first contents page");

        assert_eq!(first.entries.len(), 1);
        assert!(first.total_count > first.entries.len());
        assert!(first.facets.all >= first.total_count);
        let cursor = first.next_cursor.expect("second contents page cursor");
        let second = session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    cursor: Some(cursor.clone()),
                    limit: 1,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("second contents page");

        assert_eq!(second.entries.len(), 1);
        assert_ne!(first.entries[0].id, second.entries[0].id);
        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: "changed".into(),
            })
            .expect("mutation should apply");
        assert_eq!(
            session.contents_page(
                "story-1",
                CoreContentsQuery {
                    cursor: Some(cursor),
                    limit: 1,
                    ..CoreContentsQuery::default()
                }
            ),
            Err(CoreError::StaleReadModelCursor)
        );
    }

    #[test]
    fn cold_basic_contents_page_is_bounded_without_analysis_graph_or_read_model() {
        let mut large_story = story();
        large_story.passages = (0..5_000)
            .map(|index| {
                passage(
                    &format!("passage-{index:05}"),
                    &format!("Passage {index:05}"),
                    "A compact passage body.",
                    index as f64,
                )
            })
            .collect::<Vec<_>>()
            .into();
        large_story.start_passage = PassageId::new("passage-00000");
        let mut session = ProjectSession::new(Project {
            stories: vec![large_story],
            ..Project::default()
        });

        let page = session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    limit: 32,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("cold basic contents page");

        assert_eq!(page.entries.len(), 32);
        assert_eq!(page.facets.passage, 5_000);
        assert_eq!(page.facets.metadata, 2);
        assert_eq!(page.facets.entry_point, 1);
        assert_eq!(page.facets.script, 1);
        assert_eq!(page.facets.stylesheet, 1);
        assert_eq!(page.facets.asset, 0);
        assert_eq!(page.facets.diagnostics, 0);
        assert_eq!(page.facets.variable, 0);
        assert!(!page.facets.intelligence_complete);
        assert_eq!(page.total_count, 5_005);
        assert!(page.next_cursor.is_some());
        assert!(
            page.entries
                .iter()
                .all(|entry| entry.kind == CoreContentsEntryKind::Passage)
        );

        let diagnostics = session.performance_diagnostics();
        assert_eq!(diagnostics.analysis_cache_source_count, 0);
        assert_eq!(diagnostics.parsed_source_count, 0);
        assert_eq!(diagnostics.graph_cache_story_count, 0);
        assert_eq!(diagnostics.read_model_cache_story_count, 0);
        assert_eq!(diagnostics.read_model_full_build_count, 0);
        assert_eq!(session.contents_catalog_cache.len(), 1);
        assert_eq!(
            session
                .contents_catalog_cache
                .get(&StoryId::new("story-1"))
                .map(|catalog| catalog.contents.len()),
            Some(5_005)
        );

        let passage_page = session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Passage,
                    limit: 5,
                    query: Some("Passage 04999".into()),
                    sort: CoreContentsSort::Name,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("catalog passage search");
        assert_eq!(passage_page.total_count, 1);
        assert_eq!(passage_page.entries[0].label, "Passage 04999");
        assert_eq!(session.performance_diagnostics().parsed_source_count, 0);
        assert!(session.graph_cache.is_empty());
        assert!(session.read_model_cache.is_empty());

        let all_search = session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    query: Some("Passage 04999".into()),
                    sort: CoreContentsSort::Name,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("catalog All-filter search");
        assert_eq!(all_search.total_count, 1);
        assert_eq!(all_search.entries[0].label, "Passage 04999");
        assert!(!all_search.facets.intelligence_complete);
        let diagnostics = session.performance_diagnostics();
        assert_eq!(diagnostics.analysis_cache_source_count, 0);
        assert_eq!(diagnostics.graph_cache_story_count, 0);
        assert_eq!(diagnostics.read_model_cache_story_count, 0);
        assert_eq!(diagnostics.read_model_full_build_count, 0);
    }

    #[test]
    fn expensive_contents_filters_build_intelligence_only_on_demand() {
        let mut story = story();
        story
            .passage_by_id_mut(&PassageId::new("a"))
            .expect("start passage")
            .text = "Set $score. assets/cover.png [[Missing]]".into();
        let mut session = ProjectSession::new(Project {
            stories: vec![story],
            ..Project::default()
        });

        session
            .contents_page("story-1", CoreContentsQuery::default())
            .expect("basic page");
        assert_eq!(session.analysis_parse_count, 0);
        assert!(session.graph_cache.is_empty());
        assert!(session.read_model_cache.is_empty());

        let variables = session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Variable,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("variable page");
        assert!(
            variables
                .entries
                .iter()
                .any(|entry| entry.label == "$score")
        );
        assert!(variables.facets.intelligence_complete);
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_cache.len(), 1);
        assert_eq!(session.graph_cache.len(), 1);
        assert_eq!(session.analysis_cache.len(), 1);

        let diagnostics = session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Diagnostics,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("diagnostics page");
        assert!(diagnostics.entries.iter().any(|entry| {
            entry.kind == CoreContentsEntryKind::BrokenLink
                && entry
                    .detail
                    .as_deref()
                    .is_some_and(|detail| detail.contains("Missing"))
        }));

        let assets = session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Asset,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("assets page");
        assert!(
            assets
                .entries
                .iter()
                .any(|entry| entry.label == "assets/cover.png")
        );
        assert_eq!(session.read_model_full_build_count, 1);
    }

    #[test]
    fn basic_contents_catalog_updates_incrementally_across_mutations() {
        let mut session = session();

        session
            .contents_page("story-1", CoreContentsQuery::default())
            .expect("initialize basic catalog");
        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: "one\ntwo".into(),
            })
            .expect("text edit");
        session
            .apply(StoryCommand::SetPassageTags {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                tags: vec!["chapter-one".into()],
            })
            .expect("tag edit");

        let passages = session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Passage,
                    query: Some("Start".into()),
                    ..CoreContentsQuery::default()
                },
            )
            .expect("updated passage catalog");
        let start = passages
            .entries
            .iter()
            .find(|entry| entry.source_id.as_deref() == Some("a"))
            .expect("start catalog entry");
        assert_eq!(start.count, 2);
        assert_eq!(start.detail.as_deref(), Some("7 characters"));

        let groups = session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Group,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("updated group catalog");
        assert_eq!(groups.total_count, 1);
        assert_eq!(groups.entries[0].label, "chapter-one");
        assert_eq!(groups.entries[0].count, 1);
        assert_eq!(groups.revision, session.revision() as u32);

        let diagnostics = session.performance_diagnostics();
        assert_eq!(diagnostics.analysis_cache_source_count, 0);
        assert_eq!(diagnostics.parsed_source_count, 0);
        assert_eq!(diagnostics.graph_cache_story_count, 0);
        assert_eq!(diagnostics.read_model_cache_story_count, 0);
        assert_eq!(diagnostics.read_model_full_build_count, 0);
    }

    #[test]
    fn direct_search_page_does_not_build_a_compatibility_index() {
        let mut session = session();
        let baseline_parse_count = session.analysis_parse_count;

        let page = session
            .search_page(
                "story-1",
                CoreSearchQuery {
                    include_passage_names: true,
                    include_passage_text: true,
                    query: "missing".into(),
                    ..CoreSearchQuery::default()
                },
            )
            .expect("search page should query source text directly");

        assert!(!page.search_hits.is_empty());
        assert_eq!(session.analysis_parse_count, baseline_parse_count);
        assert!(session.analysis_cache.is_empty());
    }

    #[test]
    fn search_ranges_use_utf16_editor_offsets() {
        let mut unicode_story = story();
        unicode_story
            .passages
            .iter_mut()
            .find(|passage| passage.id.as_ref() == "a")
            .expect("start passage")
            .text = "😀 café alpha".into();
        let mut session = ProjectSession::new(Project {
            stories: vec![unicode_story],
            ..Project::default()
        });
        let exact = session
            .search_page(
                "story-1",
                CoreSearchQuery {
                    include_passage_names: false,
                    include_script: false,
                    include_stylesheet: false,
                    query: "alpha".into(),
                    replacement: Some("omega".into()),
                    ..CoreSearchQuery::default()
                },
            )
            .expect("exact search");
        let exact_hit = exact
            .search_hits
            .iter()
            .find(|hit| hit.passage_id.as_deref() == Some("a"))
            .expect("exact passage hit");

        assert_eq!(exact_hit.start, 8);
        assert_eq!(exact_hit.end, 13);
        assert_eq!(exact_hit.match_text, "alpha");
        assert!(exact.replace_previews.iter().any(|preview| {
            preview.passage_id.as_deref() == Some("a") && preview.start == 8 && preview.end == 13
        }));

        let fuzzy = session
            .search_page(
                "story-1",
                CoreSearchQuery {
                    fuzzy: true,
                    include_passage_names: false,
                    include_script: false,
                    include_stylesheet: false,
                    query: "cfa".into(),
                    ..CoreSearchQuery::default()
                },
            )
            .expect("fuzzy search");
        let fuzzy_hit = fuzzy
            .search_hits
            .iter()
            .find(|hit| hit.passage_id.as_deref() == Some("a"))
            .expect("fuzzy passage hit");

        assert_eq!(fuzzy_hit.start, 3);
        assert_eq!(fuzzy_hit.end, 9);
        assert_eq!(fuzzy_hit.match_text, "café a");

        let mut expanding_story = story();
        expanding_story
            .passages
            .iter_mut()
            .find(|passage| passage.id.as_ref() == "a")
            .expect("start passage")
            .text = "İxzt".into();
        let mut expanding_session = ProjectSession::new(Project {
            stories: vec![expanding_story],
            ..Project::default()
        });
        let expanding = expanding_session
            .search_page(
                "story-1",
                CoreSearchQuery {
                    fuzzy: true,
                    include_passage_names: false,
                    include_script: false,
                    include_stylesheet: false,
                    query: "xt".into(),
                    ..CoreSearchQuery::default()
                },
            )
            .expect("expanding lowercase search");
        let expanding_hit = expanding
            .search_hits
            .iter()
            .find(|hit| hit.passage_id.as_deref() == Some("a"))
            .expect("expanding lowercase hit");

        assert_eq!(expanding_hit.start, 1);
        assert_eq!(expanding_hit.end, 4);
        assert_eq!(expanding_hit.match_text, "xzt");

        let mut long_story = story();
        long_story
            .passages
            .iter_mut()
            .find(|passage| passage.id.as_ref() == "a")
            .expect("start passage")
            .text = format!("é{}MATCH{}", "a".repeat(47), "b".repeat(100));
        let mut long_session = ProjectSession::new(Project {
            stories: vec![long_story],
            ..Project::default()
        });
        let long_line = long_session
            .search_page(
                "story-1",
                CoreSearchQuery {
                    include_passage_names: false,
                    include_script: false,
                    include_stylesheet: false,
                    query: "MATCH".into(),
                    ..CoreSearchQuery::default()
                },
            )
            .expect("long Unicode line search");
        let long_line_hit = long_line
            .search_hits
            .iter()
            .find(|hit| hit.passage_id.as_deref() == Some("a"))
            .expect("long line hit");

        assert_eq!(long_line_hit.start, 48);
        assert_eq!(long_line_hit.end, 53);
        assert!(long_line_hit.excerpt.contains("MATCH"));
    }

    #[test]
    fn text_metrics_match_javascript_utf16_and_editor_lines() {
        let mut story = story();
        story
            .passages
            .iter_mut()
            .find(|passage| passage.id.as_ref() == "b")
            .expect("passage")
            .text = "é😀\n".into();
        let mut session = ProjectSession::new(Project {
            stories: vec![story],
            ..Project::default()
        });
        let contents = session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Passage,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("contents page");
        let entry = contents
            .entries
            .iter()
            .find(|entry| entry.passage_id.as_deref() == Some("b"))
            .expect("passage contents entry");

        assert_eq!(entry.count, 2);
        assert_eq!(entry.detail.as_deref(), Some("4 characters"));

        let index = session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .expect("story index");
        let file = index
            .files
            .iter()
            .find(|file| file.passage_id.as_deref() == Some("b"))
            .expect("passage source file");

        assert_eq!(file.character_count, 4);
        assert_eq!(file.line_count, 2);

        let facts = session
            .passage_local_facts("story-1", "b")
            .expect("passage facts");

        assert_eq!(facts.character_count, 4);
        assert_eq!(facts.line_count, 2);

        let before = session.story_summary("story-1").expect("initial summary");
        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "b".into(),
                story_id: "story-1".into(),
                text: "x".into(),
            })
            .expect("text edit");
        let after = session.story_summary("story-1").expect("updated summary");

        assert_eq!(after.character_count, before.character_count - 3);
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_incremental_update_count, 1);
    }

    #[test]
    fn read_model_keeps_bounded_records_and_revisions_them() {
        let mut session = session();

        session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Diagnostics,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("contents page should initialize cache");
        let story_id = StoryId::new("story-1");
        let initial_revision = session.revision();
        let cache = session
            .read_model_cache
            .get(&story_id)
            .expect("read model cache should exist");

        assert_eq!(cache.revision, initial_revision);
        assert!(!cache.contents.is_empty());
        assert!(cache.asset_inventory.is_empty());
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_incremental_update_count, 0);

        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: "changed".into(),
            })
            .expect("mutation should apply");
        session
            .contents_page("story-1", CoreContentsQuery::default())
            .expect("contents page should reuse the incrementally updated cache");
        assert_eq!(
            session
                .read_model_cache
                .get(&story_id)
                .expect("read model cache should refresh")
                .revision,
            session.revision()
        );
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_incremental_update_count, 1);
        assert_eq!(session.read_model_last_touched_source_count, 1);

        session.undo().expect("text edit should undo");
        session.redo().expect("text edit should redo");
        session
            .contents_page("story-1", CoreContentsQuery::default())
            .expect("contents page should stay current across undo and redo");
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_incremental_update_count, 3);
        assert_eq!(session.read_model_last_touched_source_count, 1);
    }

    #[test]
    fn layout_only_edits_preserve_read_model_without_parsing_sources() {
        let mut session = session();

        session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Diagnostics,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("contents page should initialize cache");
        let parse_count = session.analysis_parse_count;

        session
            .apply(StoryCommand::MovePassages {
                story_id: "story-1".into(),
                moves: vec![PassageMove {
                    bounds: CoreRect {
                        height: 100.0,
                        left: 200.0,
                        top: 100.0,
                        width: 100.0,
                    },
                    passage_id: "a".into(),
                }],
            })
            .expect("layout edit should apply");

        assert_eq!(session.analysis_parse_count, parse_count);
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_incremental_update_count, 1);
        assert_eq!(session.read_model_last_touched_source_count, 1);
        let transaction = session.undo_stack.last().expect("layout history entry");
        assert!(transaction.delta.top_before.is_none());
        assert!(transaction.delta.top_after.is_none());
        assert_eq!(transaction.delta.layout_passages.len(), 1);
        assert_eq!(transaction.delta.stories.len(), 1);
    }

    #[test]
    fn passage_tag_edits_update_read_model_without_reparsing_text() {
        let mut session = session();

        session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Diagnostics,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("contents page should initialize cache");
        let parse_count = session.analysis_parse_count;

        session
            .apply(StoryCommand::SetPassageTags {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                tags: vec!["chapter-one".into()],
            })
            .expect("tag edit should apply");
        let cache = session
            .read_model_cache
            .get(&StoryId::new("story-1"))
            .expect("read model should stay resident");

        assert_eq!(session.analysis_parse_count, parse_count);
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_incremental_update_count, 1);
        assert_eq!(cache.tag_count, 1);
        assert_eq!(
            cache
                .contents
                .get("tag:chapter-one")
                .map(|entry| (&entry.kind, entry.count)),
            Some((&CoreContentsEntryKind::Group, 1))
        );
    }

    #[test]
    fn story_metadata_edits_keep_entity_history_and_resident_read_model() {
        let mut session = session();

        session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Diagnostics,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("contents page should initialize cache");
        let parse_count = session.analysis_parse_count;

        session
            .apply(StoryCommand::RenameStory {
                name: "Renamed Story".into(),
                story_id: "story-1".into(),
            })
            .expect("story rename should apply");
        let cache = session
            .read_model_cache
            .get(&StoryId::new("story-1"))
            .expect("read model should stay resident");
        let transaction = session.undo_stack.last().expect("metadata history entry");

        assert_eq!(session.analysis_parse_count, parse_count);
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_incremental_update_count, 1);
        assert_eq!(session.read_model_last_touched_source_count, 0);
        assert!(transaction.delta.top_before.is_none());
        assert!(transaction.delta.top_after.is_none());
        assert!(transaction.delta.layout_passages.is_empty());
        assert_eq!(transaction.delta.stories.len(), 1);
        assert_eq!(
            cache
                .contents
                .get("metadata:story-1")
                .and_then(|entry| entry.detail.as_deref()),
            Some("Renamed Story")
        );
    }

    #[test]
    fn read_model_passage_facts_use_cached_source_analysis() {
        let mut session = session();
        let baseline = session.analysis_parse_count;

        let facts = session
            .passage_facts("story-1", "b")
            .expect("passage facts should load");

        assert_eq!(facts.passage_id, "b");
        assert_eq!(facts.character_count, 11);
        assert_eq!(facts.word_count, 1);
        assert_eq!(facts.line_count, 1);
        assert_eq!(facts.excerpt, "[[Missing]]");
        assert!(!facts.is_empty);
        assert!(facts.links.iter().any(|link| link.target_name == "Missing"));
        assert!(
            facts
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "broken-link")
        );
        assert!(session.analysis_parse_count > baseline);
    }

    #[test]
    fn local_passage_facts_do_not_build_graph_or_read_model() {
        let mut session = session();
        let baseline = session.analysis_parse_count;

        let facts = session
            .passage_local_facts("story-1", "b")
            .expect("local passage facts should load");

        assert_eq!(facts.passage_id, "b");
        assert!(facts.links.iter().any(|link| link.target_name == "Missing"));
        assert!(
            facts
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "broken-link")
        );
        assert_eq!(session.analysis_parse_count, baseline + 1);
        assert!(session.graph_cache.is_empty());
        assert!(session.read_model_cache.is_empty());
    }

    #[test]
    fn backlinks_are_bounded_cached_and_revision_bound() {
        let mut session = session();
        let story = session
            .project
            .stories
            .iter_mut()
            .find(|story| story.id.as_ref() == "story-1")
            .expect("story");
        story
            .passages
            .push(passage("d", "Fourth", "[[Next]]", 600.0));
        story
            .passages
            .push(passage("e", "Fifth", "[[Next]]", 800.0));
        let first = session
            .backlinks_page(
                "story-1",
                "b",
                CoreBacklinksQuery {
                    cursor: None,
                    limit: 2,
                },
            )
            .expect("first backlink page");

        assert_eq!(first.backlinks.len(), 2);
        assert_eq!(first.total_count, 3);
        assert!(first.next_cursor.is_some());
        assert!(session.graph_cache.is_empty());
        assert_eq!(session.backlink_scan_count, 1);
        assert_eq!(session.backlink_scanned_source_count, 5);

        let second = session
            .backlinks_page(
                "story-1",
                "b",
                CoreBacklinksQuery {
                    cursor: first.next_cursor.clone(),
                    limit: 2,
                },
            )
            .expect("second backlink page");
        assert_eq!(second.backlinks.len(), 1);
        assert_eq!(session.backlink_scan_count, 1);
        assert_eq!(session.backlink_cache_hit_count, 1);

        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: String::new(),
            })
            .expect("text edit should update the resident backlink cache");
        let updated = session
            .backlinks_page("story-1", "b", CoreBacklinksQuery::default())
            .expect("updated backlinks");
        assert_eq!(updated.total_count, 2);
        assert_eq!(session.backlink_scan_count, 1);

        session.undo().expect("undo");
        assert_eq!(
            session
                .backlinks_page("story-1", "b", CoreBacklinksQuery::default())
                .expect("undo backlinks")
                .total_count,
            3
        );
        session.redo().expect("redo");
        assert_eq!(
            session
                .backlinks_page("story-1", "b", CoreBacklinksQuery::default())
                .expect("redo backlinks")
                .total_count,
            2
        );
        assert_eq!(session.backlink_scan_count, 1);

        let stale = session.backlinks_page(
            "story-1",
            "b",
            CoreBacklinksQuery {
                cursor: first.next_cursor,
                limit: 2,
            },
        );
        assert_eq!(stale, Err(CoreError::StaleReadModelCursor));
    }

    #[test]
    fn story_summary_counts_update_incrementally_with_passage_text() {
        let mut session = session();
        let before = session.story_summary("story-1").expect("initial summary");
        let full_build_count = session.read_model_full_build_count;
        let old_text = session
            .story("story-1")
            .expect("story")
            .passage_by_id(&PassageId::new("a"))
            .expect("passage")
            .text
            .clone();

        session
            .apply(StoryCommand::UpdatePassageText {
                passage_id: "a".into(),
                story_id: "story-1".into(),
                text: "one two three".into(),
            })
            .expect("text edit should apply");
        let after = session.story_summary("story-1").expect("updated summary");

        assert_eq!(
            after.character_count,
            before.character_count - old_text.len() + 13
        );
        assert_eq!(
            after.word_count,
            before.word_count - old_text.split_whitespace().count() + 3
        );
        assert_eq!(session.read_model_full_build_count, full_build_count);
        assert_eq!(session.read_model_last_touched_source_count, 1);
    }

    #[test]
    fn diagnostics_summary_excludes_dismissed_identities_from_severity_counts() {
        let mut missing_start_story = story();
        missing_start_story.start_passage = PassageId::new("missing-start");
        let mut session = ProjectSession::new(Project {
            stories: vec![missing_start_story],
            ..Project::default()
        });
        let page = session
            .diagnostics_page(
                "story-1",
                CoreDiagnosticsQuery {
                    limit: 250,
                    ..CoreDiagnosticsQuery::default()
                },
            )
            .expect("diagnostics page");
        let dismissed_identity = r#"["missing-start-passage","story-1:metadata",null,0,0,"Story start passage is missing"]"#;
        assert!(page.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "missing-start-passage"
                && diagnostic_identity(diagnostic) == dismissed_identity
        }));
        let before = session
            .diagnostics_summary("story-1", CoreDiagnosticsSummaryQuery::default())
            .expect("diagnostics summary");
        let after = session
            .diagnostics_summary(
                "story-1",
                CoreDiagnosticsSummaryQuery {
                    dismissed_ids: vec![dismissed_identity.into(), "stale-dismissal".into()],
                },
            )
            .expect("filtered diagnostics summary");

        assert_eq!(before.diagnostic_count, page.total_count);
        assert_eq!(after.diagnostic_count, before.diagnostic_count - 1);
        assert_eq!(after.dismissed_count, 1);
        assert_eq!(after.revision, page.revision);
        assert_eq!(after.error_count, before.error_count - 1);
    }

    #[test]
    fn diagnostic_identity_matches_renderer_json_contract() {
        let diagnostic = CoreDiagnostic {
            code: "code\"".into(),
            end: 9,
            line: 1,
            message: "Quoted \"line\"\nnext".into(),
            passage_id: None,
            quick_fixes: Vec::new(),
            severity: CoreDiagnosticSeverity::Info,
            source_id: "story\\source".into(),
            start: 3,
        };

        assert_eq!(
            diagnostic_identity(&diagnostic),
            r#"["code\"","story\\source",null,3,9,"Quoted \"line\"\nnext"]"#
        );
    }

    #[test]
    fn diagnostics_summary_does_not_serialize_each_diagnostic_for_dismissals() {
        let mut large_story = story();
        let passages = (0..4_096)
            .map(|index| {
                passage(
                    &format!("passage-{index}"),
                    &format!("Passage {index}"),
                    &format!("[[Missing {index}]]"),
                    index as f64,
                )
            })
            .collect::<Vec<_>>();

        large_story.start_passage = passages[0].id.clone();
        large_story.passages = PassageIndex::from(passages);
        let mut session = ProjectSession::new(Project {
            stories: vec![large_story],
            ..Project::default()
        });
        let page = session
            .diagnostics_page(
                "story-1",
                CoreDiagnosticsQuery {
                    limit: 1,
                    ..CoreDiagnosticsQuery::default()
                },
            )
            .expect("diagnostics page");
        let dismissed_identity = diagnostic_identity(&page.diagnostics[0]);

        DIAGNOSTIC_IDENTITY_SERIALIZATIONS.with(|count| count.set(0));
        let summary = session
            .diagnostics_summary(
                "story-1",
                CoreDiagnosticsSummaryQuery {
                    dismissed_ids: vec![dismissed_identity],
                },
            )
            .expect("diagnostics summary");

        assert_eq!(summary.dismissed_count, 1);
        assert_eq!(summary.diagnostic_count + 1, page.total_count);
        DIAGNOSTIC_IDENTITY_SERIALIZATIONS.with(|count| assert_eq!(count.get(), 0));
    }

    #[test]
    fn external_passage_text_reuses_incremental_cache_and_history() {
        let mut session = session();

        let initial_backlinks = session
            .backlinks_page("story-1", "b", CoreBacklinksQuery::default())
            .expect("initial backlink page");
        assert_eq!(initial_backlinks.total_count, 1);
        session
            .contents_page(
                "story-1",
                CoreContentsQuery {
                    filter: CoreContentsFilter::Diagnostics,
                    ..CoreContentsQuery::default()
                },
            )
            .expect("initial page should populate source and read-model caches");
        let initial_parse_count = session.analysis_parse_count;
        let result = session
            .ingest_external_delta(
                CoreExternalDelta {
                    changes: vec![CoreExternalChange::UpdatePassage {
                        changes: PassagePatch {
                            text: Some("Disk edit".into()),
                            ..PassagePatch::default()
                        },
                        passage_id: "a".into(),
                        story_id: "story-1".into(),
                    }],
                    id: "external-passage-text".into(),
                },
                CoreExternalIngestMode::Auto,
            )
            .expect("external text delta should apply");

        assert_eq!(result.outcome, CoreExternalIngestOutcome::Applied);
        assert!(result.history_recorded);
        let timing = session
            .performance_diagnostics()
            .last_mutation
            .expect("external ingestion should expose stage timings");
        assert_eq!(timing.operation, "externalPassageText");
        assert_eq!(timing.delta_id, "external-passage-text");
        assert_eq!(timing.revision, session.revision());
        assert_eq!(timing.graph_parsed_source_count, 1);
        let stage_sum = timing.lookup_and_delta_ms
            + timing.fingerprint_ms
            + timing.savepoint_ms
            + timing.graph_ms
            + timing.analysis_ms
            + timing.read_model_ms
            + timing.history_ms
            + timing.patch_finalize_ms;
        assert!(stage_sum <= timing.total_ms + 0.1);
        assert_eq!(session.analysis_parse_count, initial_parse_count + 1);
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_incremental_update_count, 1);
        assert_eq!(session.read_model_last_touched_source_count, 1);
        let updated_backlinks = session
            .backlinks_page("story-1", "b", CoreBacklinksQuery::default())
            .expect("updated backlink page");
        assert_eq!(updated_backlinks.total_count, 0);
        assert_eq!(session.backlink_scan_count, 1);
        assert_eq!(
            session
                .project()
                .stories
                .iter()
                .find(|story| story.id == StoryId::new("story-1"))
                .and_then(|story| story.passage_by_id(&PassageId::new("a")))
                .map(|passage| passage.text.as_str()),
            Some("Disk edit")
        );
        session.undo().expect("external text delta should undo");
        assert_eq!(session.read_model_full_build_count, 1);
        assert_eq!(session.read_model_incremental_update_count, 2);
        assert_eq!(
            session
                .project()
                .stories
                .iter()
                .find(|story| story.id == StoryId::new("story-1"))
                .and_then(|story| story.passage_by_id(&PassageId::new("a")))
                .map(|passage| passage.text.as_str()),
            Some("[[Next]] [[Label->Next]] [[Next<-Back]]")
        );
    }

    #[test]
    fn story_index_includes_m4_project_intelligence() {
        let mut session = session();

        {
            let story = session.story_mut("story-1").expect("story");
            let passage = story
                .passage_by_id_mut(&PassageId::new("a"))
                .expect("passage");

            passage.text = "Set $score and $player.score. _turn ?sidebar $____ $__.__ $valid._ $_.valid assets/cover.png [[Next]]".into();
            passage.tags = vec!["chapter-one".into(), "scene".into()];
            story.tag_colors.insert("scene".into(), "red".into());
            story.script = "const coin = 1;".into();
        }

        let batch = session
            .apply(StoryCommand::QueryStoryIndex {
                story_id: "story-1".into(),
                options: CoreStoryIndexOptions {
                    query: Some("coin".into()),
                    replacement: Some("gem".into()),
                    ..CoreStoryIndexOptions::default()
                },
            })
            .expect("index query should apply");

        let Patch::StoryIndexUpdated { index, .. } = &batch.patches[0] else {
            panic!("expected story index patch");
        };

        assert!(index.symbols.iter().any(|symbol| symbol.name == "$score"));
        assert!(
            index
                .symbols
                .iter()
                .any(|symbol| symbol.name == "$player.score")
        );
        assert!(!index.symbols.iter().any(|symbol| symbol.name == "_turn"));
        assert!(!index.symbols.iter().any(|symbol| symbol.name == "?sidebar"));
        assert!(!index.symbols.iter().any(|symbol| symbol.name == "$____"));
        assert!(!index.symbols.iter().any(|symbol| symbol.name == "$__.__"));
        assert!(index.symbols.iter().any(|symbol| symbol.name == "$valid._"));
        assert!(index.symbols.iter().any(|symbol| symbol.name == "$_.valid"));
        assert!(
            index
                .assets
                .iter()
                .any(|asset| asset.path == "assets/cover.png")
        );
        assert!(index.tag_entries.iter().any(|tag| {
            tag.name == "scene" && tag.count == 1 && tag.color.as_deref() == Some("red")
        }));
        assert!(index.replace_previews.iter().any(|preview| {
            preview.before == "const coin = 1;" && preview.after == "const gem = 1;"
        }));
        assert!(index.contents.iter().any(|entry| {
            entry.kind == CoreContentsEntryKind::Group && entry.label == "chapter-one"
        }));
        assert!(index.contents.iter().any(|entry| {
            entry.kind == CoreContentsEntryKind::Asset && entry.label == "assets/cover.png"
        }));
        assert!(index.contents.iter().any(|entry| {
            entry.kind == CoreContentsEntryKind::Asset
                && entry.label == "assets/cover.png"
                && entry.passage_id.as_deref() == Some("a")
                && entry.source_id.as_deref() == Some("a")
        }));
        assert!(index.contents.iter().any(|entry| {
            entry.kind == CoreContentsEntryKind::Variable
                && entry.label == "$score"
                && entry.passage_id.as_deref() == Some("a")
                && entry.source_id.as_deref() == Some("a")
        }));

        let variable_batch = session
            .apply(StoryCommand::QueryStoryIndex {
                story_id: "story-1".into(),
                options: CoreStoryIndexOptions {
                    query: Some("$score".into()),
                    ..CoreStoryIndexOptions::default()
                },
            })
            .expect("variable index query should apply");
        let Patch::StoryIndexUpdated {
            index: variable_index,
            ..
        } = &variable_batch.patches[0]
        else {
            panic!("expected story index patch");
        };

        assert!(
            variable_index
                .search_hits
                .iter()
                .any(|hit| hit.scope == CoreSearchScope::Variable)
        );
    }

    #[test]
    fn story_index_merges_file_backed_asset_inventory_contract() {
        let mut session = session();

        {
            let story = session.story_mut("story-1").expect("story");
            let passage = story
                .passage_by_id_mut(&PassageId::new("a"))
                .expect("passage");

            passage.text = r#"<img src="assets/missing.png">"#.into();
        }

        let batch = session
            .apply(StoryCommand::QueryStoryIndex {
                story_id: "story-1".into(),
                options: CoreStoryIndexOptions {
                    known_assets: vec![
                        asset_inventory_entry(
                            "assets/missing.png".into(),
                            "image".into(),
                            Some(false),
                            Vec::new(),
                        ),
                        asset_inventory_entry(
                            "assets/unused.png".into(),
                            "image".into(),
                            Some(true),
                            Vec::new(),
                        ),
                    ],
                    ..CoreStoryIndexOptions::default()
                },
            })
            .expect("index query should apply");

        let Patch::StoryIndexUpdated { index, .. } = &batch.patches[0] else {
            panic!("expected story index patch");
        };

        assert!(index.asset_inventory.iter().any(|asset| {
            asset.path == "assets/missing.png"
                && asset.missing
                && asset.reference_count == 1
                && !asset.unused
        }));
        assert!(index.asset_inventory.iter().any(|asset| {
            asset.path == "assets/unused.png"
                && !asset.missing
                && asset.reference_count == 0
                && asset.unused
        }));
        assert!(index.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "missing-asset"
                && diagnostic.severity == CoreDiagnosticSeverity::Error
        }));
        assert!(index.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "unused-asset" && diagnostic.severity == CoreDiagnosticSeverity::Info
        }));
        assert!(index.contents.iter().any(|entry| {
            entry.kind == CoreContentsEntryKind::Asset
                && entry.label == "assets/unused.png"
                && entry.severity == Some(CoreDiagnosticSeverity::Info)
        }));
    }

    #[test]
    fn completed_asset_scan_marks_referenced_unscanned_assets_missing() {
        let mut session = session();

        {
            let story = session.story_mut("story-1").expect("story");
            let passage = story
                .passage_by_id_mut(&PassageId::new("a"))
                .expect("passage");

            passage.text = r#"<img src="assets/missing.png">"#.into();
        }

        let unknown_index = session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .expect("index should build");
        let unknown_asset = unknown_index
            .asset_inventory
            .iter()
            .find(|asset| asset.path == "assets/missing.png")
            .expect("referenced asset should be indexed");

        assert_eq!(unknown_asset.exists, None);
        assert!(!unknown_asset.missing);

        let scanned_index = session
            .story_index(
                "story-1",
                CoreStoryIndexOptions {
                    asset_scan_complete: true,
                    ..CoreStoryIndexOptions::default()
                },
            )
            .expect("index should build");
        let scanned_asset = scanned_index
            .asset_inventory
            .iter()
            .find(|asset| asset.path == "assets/missing.png")
            .expect("referenced asset should be indexed");

        assert_eq!(scanned_asset.exists, Some(false));
        assert!(scanned_asset.missing);
        assert!(
            scanned_index
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "missing-asset")
        );
    }

    #[test]
    fn story_index_ignores_external_asset_urls_and_normalizes_local_asset_references() {
        let mut session = session();

        {
            let story = session.story_mut("story-1").expect("story");
            let passage = story
                .passage_by_id_mut(&PassageId::new("a"))
                .expect("passage");

            passage.text = r#"<img src="https://cdn.example.com/cover.png"> <img src="/assets/local.png"> <img src="../assets/icon.svg"> poster.jpg"#.into();
        }

        let index = session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .expect("index should build");
        let asset_paths = index
            .asset_inventory
            .iter()
            .map(|asset| asset.path.as_str())
            .collect::<Vec<_>>();

        assert!(!asset_paths.iter().any(|path| path.starts_with("https://")));
        assert!(asset_paths.contains(&"assets/local.png"));
        assert!(!asset_paths.contains(&"assets/icon.svg"));
        assert!(asset_paths.contains(&"assets/poster.jpg"));
    }

    #[test]
    fn asset_references_include_context_suffixes_canonical_paths_and_utf16_ranges() {
        let source = concat!(
            "😀 <img src=\" /assets/Hero image.png?v=1#face \">\n",
            "<video poster='./assets/video poster.webp'></video>\n",
            "<source srcset=\"./assets/small%20cat.webp 1x, assets/猫.webp?density=2 2x\">\n",
            "<style>.hero { background: url('assets/background image.svg#icon'); }</style>\n",
            "setupAudio(\"assets/sound.ogg?cache=yes\");\n",
            "(audio: \"assets/spoken intro.m4a\")",
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(references.len(), 7);
        assert_eq!(references[0].context, "html-src");
        assert_eq!(references[0].path, "assets/Hero image.png");
        assert_eq!(references[0].original, "/assets/Hero image.png?v=1#face");
        assert_eq!(references[0].query.as_deref(), Some("?v=1"));
        assert_eq!(references[0].fragment.as_deref(), Some("#face"));
        assert_eq!(references[0].passage_id.as_deref(), Some("a"));
        assert_eq!(references[0].source_id, "passage-a");
        assert_eq!(references[0].source_name, "Start");

        let start = utf16_offset_to_byte(source, references[0].start).expect("valid start");
        let end = utf16_offset_to_byte(source, references[0].end).expect("valid end");
        assert_eq!(&source[start..end], references[0].original);
        assert_eq!(
            references[0].start,
            "😀 <img src=\" ".encode_utf16().count()
        );

        assert_eq!(references[1].context, "html-poster");
        assert_eq!(references[1].path, "assets/video poster.webp");
        assert_eq!(references[2].context, "html-srcset");
        assert_eq!(references[2].path, "assets/small cat.webp");
        assert_eq!(references[3].context, "html-srcset");
        assert_eq!(references[3].path, "assets/猫.webp");
        assert_eq!(references[4].context, "css-url");
        assert_eq!(references[4].path, "assets/background image.svg");
        assert_eq!(references[4].fragment.as_deref(), Some("#icon"));
        assert_eq!(references[5].context, "literal");
        assert_eq!(references[5].path, "assets/sound.ogg");
        assert_eq!(references[6].context, "literal");
        assert_eq!(references[6].path, "assets/spoken intro.m4a");
    }

    #[test]
    fn asset_reference_discovery_rejects_external_and_unsafe_urls() {
        let source = concat!(
            r#"<img src="https://example.com/assets/remote.png">"#,
            r#"<img src="data:image/png;base64,AAAA">"#,
            r#"<img src="blob:https://example.com/id">"#,
            r#"<img src="../assets/traversal.png">"#,
            r#"<img src="assets/%2e%2e/encoded.png">"#,
            r#"<img src="/outside.png">"#,
        );

        assert!(asset_references_in_source("", "", source, None).is_empty());
    }

    #[test]
    fn asset_reference_discovery_indexes_arbitrary_structured_and_managed_files() {
        let mut references = asset_references_in_source(
            "story:stylesheet",
            "Story Stylesheet",
            r#"@font-face { src: url("font.woff2") format("woff2"); }"#,
            None,
        );
        references.extend(asset_references_in_source(
            "passage-a",
            "Start",
            r#"<img src="assets/config.json">"#,
            Some("a"),
        ));
        references.extend(asset_references_in_source(
            "story:script",
            "Story JavaScript",
            r#"const module = "assets/runtime.wasm"; const note = "notes.txt";"#,
            None,
        ));

        assert_eq!(
            references
                .iter()
                .map(|reference| (reference.path.as_str(), reference.kind.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("assets/font.woff2", "file"),
                ("assets/config.json", "file"),
                ("assets/runtime.wasm", "file"),
            ]
        );
    }

    #[test]
    fn asset_reference_discovery_lexes_css_urls_outside_strings_and_comments() {
        let source = concat!(
            r#"<div style="background: url('inline.woff2')"></div>"#,
            "\n<style>\n",
            r#"a::after { content: "url(string.woff2)"; }"#,
            "\n",
            r#"/* url(comment.woff2) url(comment.png) */"#,
            "\n",
            r#"@font-face { src: u/**/rl("font.woff2"); }"#,
            "\n</style>",
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(
            references
                .iter()
                .map(|reference| (reference.path.as_str(), reference.context.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("assets/inline.woff2", "css-url"),
                ("assets/font.woff2", "css-url"),
            ]
        );
    }

    #[test]
    fn asset_reference_discovery_indexes_svg_presentation_attribute_urls() {
        let source = concat!(
            r#"<svg><rect filter="url(filters.svg#blur)" fill="url(paints.svg#gradient)""#,
            r#" clip-path="url(#local-clip)" marker-end="url(markers.svg#end)"></rect></svg>"#,
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(
            references
                .iter()
                .map(|reference| {
                    let start = utf16_offset_to_byte(source, reference.start).expect("valid start");
                    let end = utf16_offset_to_byte(source, reference.end).expect("valid end");
                    (
                        reference.path.as_str(),
                        reference.context.as_str(),
                        &source[start..end],
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                ("assets/filters.svg", "css-url", "filters.svg#blur"),
                ("assets/paints.svg", "css-url", "paints.svg#gradient"),
                ("assets/markers.svg", "css-url", "markers.svg#end"),
            ]
        );
        assert!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/filters.svg"),
                "assets/final filters.svg",
                false,
            )
            .contains(r#"filter="url(assets/final%20filters.svg#blur)""#)
        );
    }

    #[test]
    fn asset_reference_discovery_ignores_parsed_nonresource_attributes() {
        let source = concat!(
            r#"<img src="actual.png" alt="hero.png">"#,
            r#"<div title="hero.png" data-example=hero.png class="icon.png"></div>"#,
            r#""free.png""#,
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(
            references
                .iter()
                .map(|reference| (reference.path.as_str(), reference.context.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("assets/actual.png", "html-src"),
                ("assets/free.png", "literal"),
            ]
        );
        assert_eq!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/hero.png"),
                "assets/replaced.png",
                false,
            ),
            source
        );
    }

    #[test]
    fn asset_reference_discovery_indexes_legacy_html_background_urls() {
        let source = concat!(
            r#"<body background="body&amp;hero.png?rev=1#top">"#,
            r#"<table background="table.png"><thead background="head.png">"#,
            r#"<tbody background="body-rows.png"><tfoot background="foot.png">"#,
            r#"<tr background="row.png"><td background="cell.png">"#,
            r#"<th background="header.png">"#,
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(
            references
                .iter()
                .map(|reference| (reference.path.as_str(), reference.context.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("assets/body&hero.png", "html-background"),
                ("assets/table.png", "html-background"),
                ("assets/head.png", "html-background"),
                ("assets/body-rows.png", "html-background"),
                ("assets/foot.png", "html-background"),
                ("assets/row.png", "html-background"),
                ("assets/cell.png", "html-background"),
                ("assets/header.png", "html-background"),
            ]
        );
        assert!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/body&hero.png"),
                "assets/final hero.png",
                false,
            )
            .contains(r#"background="assets/final%20hero.png?rev=1#top""#)
        );
    }

    #[test]
    fn asset_reference_discovery_qualifies_native_html_resource_attributes() {
        let source = concat!(
            r#"<div src="div.png" srcset="div-small.png 1x" poster="div-poster.png"></div>"#,
            r#"<custom-label src="custom.png" srcset="custom-small.png 1x" poster="custom-poster.png"></custom-label>"#,
            r#"<audio src="sound.ogg" poster="audio-poster.png" srcset="audio-small.png 1x"></audio>"#,
            r#"<img src="actual.png" srcset="small.png 1x, large.png 2x" poster="img-poster.png">"#,
            r#"<image src="legacy.png" srcset="legacy-small.png 1x">"#,
            r#"<video src="movie.mp4" srcset="video-small.png 1x" poster="cover.png"></video>"#,
            r#"<frame src="frame.html">"#,
            r#"<input type="text" src="text-input.png"><input type="IMAGE" src="button.png">"#,
            r#"<input type=" IMAGE" src="spaced-type.png">"#,
            r#"<svg><rect src="svg.png" srcset="svg-small.png 1x" poster="svg-poster.png"></rect></svg>"#,
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(
            references
                .iter()
                .map(|reference| (reference.path.as_str(), reference.context.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("assets/sound.ogg", "html-src"),
                ("assets/actual.png", "html-src"),
                ("assets/small.png", "html-srcset"),
                ("assets/large.png", "html-srcset"),
                ("assets/legacy.png", "html-src"),
                ("assets/legacy-small.png", "html-srcset"),
                ("assets/movie.mp4", "html-src"),
                ("assets/cover.png", "html-poster"),
                ("assets/frame.html", "html-src"),
                ("assets/button.png", "html-src"),
            ]
        );
        assert_eq!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/div.png"),
                "assets/replaced.png",
                false,
            ),
            source
        );
    }

    #[test]
    fn asset_reference_discovery_classifies_svg_href_elements() {
        let source = concat!(
            r#"<svg><linearGradient href="gradients.svg#base"></linearGradient>"#,
            r#"<radialGradient xlink:href="radial.svg#base"></radialGradient>"#,
            r#"<pattern href="patterns.svg#base"></pattern><script href="runtime.js"></script>"#,
            r#"<textPath href="paths.svg#curve"></textPath>"#,
            r#"<image href="preferred.png" xlink:href="ignored.png"></image>"#,
            r#"<feImage href="filters.exr"></feImage><use href="symbols.svg#check"></use>"#,
            r#"<use href xlink:href="empty-fallback.svg"></use>"#,
            r#"<a href="navigation.svg">Navigate</a><a download href="download.svg">Save</a>"#,
            r#"<a download href xlink:href="download-fallback.svg">Empty</a>"#,
            r#"<animate href="animation-target.svg#node"></animate>"#,
            r#"<mpath href="motion.svg#curve"></mpath><filter href="legacy-filter.svg#base"></filter>"#,
            r#"<rect href="rect.svg"></rect><g xlink:href="group.svg"></g></svg>"#,
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(
            references
                .iter()
                .map(|reference| reference.path.as_str())
                .collect::<Vec<_>>(),
            vec![
                "assets/gradients.svg",
                "assets/radial.svg",
                "assets/patterns.svg",
                "assets/runtime.js",
                "assets/paths.svg",
                "assets/preferred.png",
                "assets/filters.exr",
                "assets/symbols.svg",
                "assets/download.svg",
                "assets/motion.svg",
            ]
        );
    }

    #[test]
    fn asset_reference_discovery_indexes_image_set_string_options() {
        let source = concat!(
            r#"<div style="background-image:image-set('inline.webp')"></div>"#,
            "\n<style>\n",
            r#".hero { background-image: image-set("hero image.webp?rev=2#face" type("image/webp") 2x, url("fallback.webp") type("image/avif") 1x); }"#,
            "\n",
            r#".legacy { background-image: -webkit-image-/**/set /**/(/* lead */'legacy.webp', linear-gradient(red, blue) 2x); }"#,
            "\n",
            r#"a::after { content: "ghost.webp"; } /* image-set("comment.webp") */"#,
            "\n</style>",
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(
            references
                .iter()
                .map(|reference| {
                    let start = utf16_offset_to_byte(source, reference.start).expect("valid start");
                    let end = utf16_offset_to_byte(source, reference.end).expect("valid end");
                    (
                        reference.path.as_str(),
                        reference.context.as_str(),
                        &source[start..end],
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                ("assets/inline.webp", "css-url", "inline.webp"),
                (
                    "assets/hero image.webp",
                    "css-url",
                    "hero image.webp?rev=2#face",
                ),
                ("assets/fallback.webp", "css-url", "fallback.webp"),
                ("assets/legacy.webp", "css-url", "legacy.webp"),
            ]
        );
        assert!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/hero image.webp"),
                "assets/hero final.webp",
                false,
            )
            .contains(r#""assets/hero%20final.webp?rev=2#face" type("image/webp")"#)
        );
    }

    #[test]
    fn asset_reference_rewrite_encodes_logical_destination_paths() {
        let logical_path = "assets/a#b%2F c.png";
        let source = r#"<img src="old.png"><style>.hero{background:url("old.png")}</style>"#;
        let rewritten = replace_asset_references_in_source(
            source,
            &normalized_asset_path("assets/old.png"),
            logical_path,
            false,
        );

        assert_eq!(
            rewritten,
            r#"<img src="assets/a%23b%252F%20c.png"><style>.hero{background:url("assets/a%23b%252F%20c.png")}</style>"#
        );
        assert_eq!(
            asset_references_in_source("passage-a", "Start", &rewritten, Some("a"))
                .iter()
                .map(|reference| reference.path.as_str())
                .collect::<Vec<_>>(),
            vec![logical_path, logical_path]
        );
        assert_eq!(
            asset_snippet(logical_path, "image").text,
            r#"<img src="assets/a%23b%252F%20c.png" alt="">"#
        );
        assert_eq!(
            AssetPath::parse(logical_path)
                .expect("portable logical path")
                .project_path,
            logical_path
        );
        assert!(AssetPath::parse("assets/C:evil.png").is_err());
        assert!(AssetPath::parse("assets/C:/evil.png").is_err());
    }

    #[test]
    fn asset_reference_discovery_scopes_css_comments_to_css_content() {
        let passage_source = r#"<div>/*</div><img src="hero.png"><div>*/</div>"#;
        let passage_references =
            asset_references_in_source("passage-a", "Start", passage_source, Some("a"));

        assert_eq!(passage_references.len(), 1);
        assert_eq!(passage_references[0].path, "assets/hero.png");

        let stylesheet = concat!(
            r#"/* <img src="comment.png"> url(comment.png) */"#,
            "\n",
            r#"a::after { content: " <img src='ghost.png'> "; }"#,
            "\n",
            r#"body { background: url("real.png"); }"#,
        );
        let stylesheet_references =
            asset_references_in_source("story:stylesheet", "Story Stylesheet", stylesheet, None);

        assert_eq!(stylesheet_references.len(), 1);
        assert_eq!(stylesheet_references[0].path, "assets/real.png");
        assert_eq!(
            replace_asset_references_in_source(
                stylesheet,
                &normalized_asset_path("assets/comment.png"),
                "assets/replaced.png",
                true,
            ),
            stylesheet
        );

        let mixed_css_contexts = concat!(
            r#"<style>a::after { content: " <img src='style-ghost.png'> "; }</style>"#,
            "\n",
            r#"<div style="--markup: <img src='inline-ghost.png'>;"></div>"#,
            "\n",
            r#"<img src="visible.png">"#,
        );
        let mixed_references =
            asset_references_in_source("passage-a", "Start", mixed_css_contexts, Some("a"));

        assert_eq!(mixed_references.len(), 1);
        assert_eq!(mixed_references[0].path, "assets/visible.png");
    }

    #[test]
    fn asset_reference_discovery_handles_dense_css_comment_spans() {
        let source = r#"/*.png*/"""#.repeat(1_000);

        assert!(
            asset_references_in_source("story:stylesheet", "Story Stylesheet", &source, None,)
                .is_empty()
        );
    }

    #[test]
    fn asset_reference_discovery_handles_dense_data_srcsets_linearly() {
        let source = format!(
            r#"<img srcset="data:image/png;base64,{}AAAA, assets/real.png 2x">"#,
            ",".repeat(65_536)
        );
        let references =
            asset_references_in_source("passage-a", "Start", &source, Some("passage-a"));

        assert_eq!(references.len(), 1);
        assert_eq!(references[0].path, "assets/real.png");
    }

    #[test]
    fn asset_reference_discovery_projects_entity_dense_srcsets_logarithmically() {
        let candidate_count = 512;
        let source = format!(
            r#"<img srcset="{}">"#,
            (0..candidate_count)
                .map(|index| format!("image-{index}&amp;retina.png 1x"))
                .collect::<Vec<_>>()
                .join(",")
        );
        ASSET_ENTITY_PROJECTION_STEPS.with(|steps| steps.set(0));
        let references =
            asset_references_in_source("passage-a", "Start", &source, Some("passage-a"));
        let projection_steps = ASSET_ENTITY_PROJECTION_STEPS.with(std::cell::Cell::get);

        assert!(
            projection_steps < candidate_count * 64,
            "entity projection used {projection_steps} indexed comparisons"
        );
        assert_eq!(references.len(), candidate_count);
        assert_eq!(references[0].path, "assets/image-0&retina.png");
        assert_eq!(references[0].original, "image-0&amp;retina.png");
        assert_eq!(references[511].path, "assets/image-511&retina.png");
        assert_eq!(references[511].original, "image-511&amp;retina.png");
    }

    #[test]
    fn asset_reference_discovery_preserves_srcset_commas_and_link_candidates() {
        let source = concat!(
            "😀",
            r#"<img srcset="hero,retina.png?rev=1#face 2x, fallback.png 3x">"#,
            "\n",
            r#"<link rel="preload" as="image" imagesrcset="small.png 400w, large.png 800w" imagesizes="100vw">"#,
            "\n",
            r#"<img srcset="data:image/gif;base64,AA== ((x), recovered.png 2x">"#,
            "\n",
            r#"<meta http-equiv="refresh" content="0; URL='next page.html?rev=5#start'">"#,
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(
            references
                .iter()
                .map(|reference| {
                    let start = utf16_offset_to_byte(source, reference.start).expect("valid start");
                    let end = utf16_offset_to_byte(source, reference.end).expect("valid end");
                    (
                        reference.path.as_str(),
                        reference.context.as_str(),
                        &source[start..end],
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                (
                    "assets/hero,retina.png",
                    "html-srcset",
                    "hero,retina.png?rev=1#face",
                ),
                ("assets/fallback.png", "html-srcset", "fallback.png"),
                ("assets/small.png", "html-srcset", "small.png"),
                ("assets/large.png", "html-srcset", "large.png"),
                ("assets/recovered.png", "html-srcset", "recovered.png"),
                (
                    "assets/next page.html",
                    "html-refresh",
                    "next page.html?rev=5#start",
                ),
            ]
        );
        assert!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/hero,retina.png"),
                "assets/hero,retina@2x.png",
                false,
            )
            .contains("assets/hero%2Cretina%402x.png?rev=1#face 2x")
        );
        assert!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/next page.html"),
                "assets/next final.html",
                false,
            )
            .contains("URL='assets/next%20final.html?rev=5#start'")
        );
    }

    #[test]
    fn asset_reference_discovery_decodes_entities_with_raw_ranges_and_suffixes() {
        let source = concat!(
            "😀",
            r#"<img class="ordinary multi character value" src="hero&amp;retina.png&#63;rev=1&amp;x=2&num;face">"#,
            r#"<img srcset="hero&comma;retina.webp 2x">"#,
            r#"<img src="price&#x80;.png">"#,
            r#"<img src="unknown&NotARealEntity;.png">"#,
            r#"<img src="folder\hero.png">"#,
            r#"<img src="folder&bsol;hero.png">"#,
            r#"<img src="folder&#92;hero.png">"#,
            r#"<source srcset="folder\hero.png 1x, folder&#x5c;hero.png 2x">"#,
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(
            references
                .iter()
                .map(|reference| {
                    let start = utf16_offset_to_byte(source, reference.start).expect("valid start");
                    let end = utf16_offset_to_byte(source, reference.end).expect("valid end");
                    (
                        reference.path.as_str(),
                        reference.query.as_deref(),
                        reference.fragment.as_deref(),
                        &source[start..end],
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                (
                    "assets/hero&retina.png",
                    Some("&#63;rev=1&amp;x=2"),
                    Some("&num;face"),
                    "hero&amp;retina.png&#63;rev=1&amp;x=2&num;face",
                ),
                (
                    "assets/hero,retina.webp",
                    None,
                    None,
                    "hero&comma;retina.webp",
                ),
                ("assets/price€.png", None, None, "price&#x80;.png"),
                (
                    "assets/unknown&NotARealEntity;.png",
                    None,
                    None,
                    "unknown&NotARealEntity;.png",
                ),
                ("assets/folder/hero.png", None, None, r#"folder\hero.png"#),
                ("assets/folder/hero.png", None, None, "folder&bsol;hero.png",),
                ("assets/folder/hero.png", None, None, "folder&#92;hero.png",),
                ("assets/folder/hero.png", None, None, r#"folder\hero.png"#),
                ("assets/folder/hero.png", None, None, "folder&#x5c;hero.png",),
            ]
        );
        assert!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/hero&retina.png"),
                "assets/final.png",
                false,
            )
            .contains(r#"src="assets/final.png&#63;rev=1&amp;x=2&num;face""#)
        );
        assert_eq!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/folder/hero.png"),
                "assets/replaced.png",
                false,
            )
            .matches(r#"src="assets/replaced.png""#)
            .count(),
            3
        );
        assert!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/folder/hero.png"),
                "assets/replaced.png",
                false,
            )
            .contains(r#"srcset="assets/replaced.png 1x, assets/replaced.png 2x""#)
        );
    }

    #[test]
    fn asset_reference_discovery_matches_html_entity_edge_cases() {
        let source = concat!(
            r#"<img src="legacy&copy.png">"#,
            r#"<img src="blocked&ampx.png">"#,
            r#"<img src="multi&NotEqualTilde;mark.png">"#,
            r#"<img src="null&#0;.png">"#,
            r#"<img src="surrogate&#xD800;.png">"#,
            r#"<img src="large&#x110000;.png">"#,
            r#"<div style="background:url(hero&amp;retina.png&#63;x=1&num;f)"></div>"#,
            r#"<meta http-equiv="ref&#114;esh" content="0; URL=next&amp;page.bin&#63;x=1&num;f">"#,
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(
            references
                .iter()
                .map(|reference| (
                    reference.path.as_str(),
                    reference.context.as_str(),
                    reference.query.as_deref(),
                    reference.fragment.as_deref(),
                ))
                .collect::<Vec<_>>(),
            vec![
                ("assets/legacy©.png", "html-src", None, None),
                ("assets/blocked&ampx.png", "html-src", None, None),
                ("assets/multi≂̸mark.png", "html-src", None, None),
                ("assets/null�.png", "html-src", None, None),
                ("assets/surrogate�.png", "html-src", None, None),
                ("assets/large�.png", "html-src", None, None),
                (
                    "assets/hero&retina.png",
                    "css-url",
                    Some("&#63;x=1"),
                    Some("&num;f"),
                ),
                (
                    "assets/next&page.bin",
                    "html-refresh",
                    Some("&#63;x=1"),
                    Some("&num;f"),
                ),
            ]
        );
    }

    #[test]
    fn asset_reference_discovery_matches_url_preprocessing_and_segment_boundaries() {
        let source = concat!(
            "<img src=\"x\ty.png\">",
            "<img src=\"x\ny.png\">",
            "<img src=\"x\ry.png\">",
            r#"<img src="x&Tab;y.png">"#,
            r#"<img src="x&NewLine;y.png">"#,
            r#"<img src="x&#13;y.png">"#,
            r#"<img src="x%09y.png">"#,
            r#"<img src="&nbsp;hero.png">"#,
            r#"<img src="&#1;edge.png">"#,
            r#"<img src="hero.png ?rev=1">"#,
            r#"<img src="a//b.png">"#,
            r#"<img src="a&sol;&sol;b.png">"#,
            r#"<img src="/assets//b.png">"#,
            r#"<img src="a%2Fb.png">"#,
            r#"<img src="a%5Cb.png">"#,
            r#"<img src="assets%2Fhero.png">"#,
            r#"<img src="a&percnt;2Fb.png">"#,
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));

        assert_eq!(
            references
                .iter()
                .map(|reference| reference.path.as_str())
                .collect::<Vec<_>>(),
            vec![
                "assets/xy.png",
                "assets/xy.png",
                "assets/xy.png",
                "assets/xy.png",
                "assets/xy.png",
                "assets/xy.png",
                "assets/x\ty.png",
                "assets/ hero.png",
                "assets/edge.png",
                "assets/hero.png ",
            ]
        );
        assert_eq!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/xy.png"),
                "assets/clean.png",
                false,
            )
            .matches("assets/clean.png")
            .count(),
            6
        );
        let literal_null = "<img src=\"\0hero.png\">";
        assert!(
            asset_references_in_source("passage-a", "Start", literal_null, Some("a")).is_empty()
        );
    }

    #[test]
    fn asset_reference_discovery_preserves_non_c0_literal_whitespace() {
        let source = "const first = \" hero.png\"; const second = \"﻿cover.webp\"; const unmanaged = \" assets/data.bin\";";

        assert_eq!(
            asset_references_in_source("passage-a", "Start", source, Some("a"))
                .iter()
                .map(|reference| reference.path.as_str())
                .collect::<Vec<_>>(),
            vec!["assets/ hero.png", "assets/﻿cover.webp"]
        );
    }

    #[test]
    fn asset_reference_discovery_respects_html_text_states_and_foreign_content() {
        for tag in [
            "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript",
        ] {
            let source = format!(
                r#"<{tag}/><img src="ghost.png"> bare.png</{tag} data-close=">"><img src="real.png">"#
            );
            let references = asset_references_in_source("passage-a", "Start", &source, Some("a"));
            assert_eq!(
                references
                    .iter()
                    .map(|reference| reference.path.as_str())
                    .collect::<Vec<_>>(),
                vec!["assets/real.png"]
            );
            assert_eq!(
                replace_asset_references_in_source(
                    &source,
                    &normalized_asset_path("assets/ghost.png"),
                    "assets/replaced.png",
                    false,
                ),
                source
            );
        }

        let script = r#"<script><!--<script></script><img src="ghost.png"> bare.png</script><img src="real.png">"#;
        assert_eq!(
            asset_references_in_source("passage-a", "Start", script, Some("a"))
                .iter()
                .map(|reference| reference.path.as_str())
                .collect::<Vec<_>>(),
            vec!["assets/real.png"]
        );
        let abruptly_closed_escaped_script =
            r#"<script><!--><script></script><img src="recovered.png">"#;
        assert_eq!(
            asset_references_in_source(
                "passage-a",
                "Start",
                abruptly_closed_escaped_script,
                Some("a"),
            )
            .iter()
            .map(|reference| reference.path.as_str())
            .collect::<Vec<_>>(),
            vec!["assets/recovered.png"]
        );
        for (source, expected) in [
            (
                r#"<script><!--<foo</script><img src="after-foo.png">"#,
                "assets/after-foo.png",
            ),
            (
                r#"<script><!--<scriptX</script><img src="after-script-x.png">"#,
                "assets/after-script-x.png",
            ),
        ] {
            assert_eq!(
                asset_references_in_source("passage-a", "Start", source, Some("a"))
                    .iter()
                    .map(|reference| reference.path.as_str())
                    .collect::<Vec<_>>(),
                vec![expected]
            );
        }
        let bogus_end_tag = r#"</<!--foo><img src="after-bogus-end.png">"#;
        assert_eq!(
            asset_references_in_source("passage-a", "Start", bogus_end_tag, Some("a"))
                .iter()
                .map(|reference| reference.path.as_str())
                .collect::<Vec<_>>(),
            vec!["assets/after-bogus-end.png"]
        );
        assert!(
            asset_references_in_source(
                "passage-a",
                "Start",
                r#"<plaintext><img src="ghost.png"> bare.png<img src="never.png">"#,
                Some("a"),
            )
            .is_empty()
        );
        let story_script = r#"const opening = "<textarea>"; const image = "assets/safe.png"; const fake = '<img src="ghost.png">';"#;
        assert_eq!(
            asset_references_in_source("story:script", "Story JavaScript", story_script, None,)
                .iter()
                .map(|reference| (reference.path.as_str(), reference.context.as_str()))
                .collect::<Vec<_>>(),
            vec![("assets/safe.png", "literal")]
        );
        assert!(
            replace_asset_references_in_source_with_mode(
                story_script,
                &normalized_asset_path("assets/safe.png"),
                "assets/renamed.png",
                false,
                true,
            )
            .contains(r#"const image = "assets/renamed.png""#)
        );

        let foreign = concat!(
            r#"<svg><title><img src="svg-title.png"></title>"#,
            r#"<script><image href="svg-script.bin"></script>"#,
            r#"<style><image href="svg-style.bin"></style>"#,
            r#"<foreignObject><title><img src="html-title-ghost.png"></title></foreignObject>"#,
            r#"</svg>"#,
            r#"<math><annotation-xml><svg><foreignObject><title><img src="math-svg-ghost.png"></title></foreignObject></svg></annotation-xml></math>"#,
            r#"<img src="real.png">"#,
        );
        assert_eq!(
            asset_references_in_source("passage-a", "Start", foreign, Some("a"))
                .iter()
                .map(|reference| reference.path.as_str())
                .collect::<Vec<_>>(),
            vec![
                "assets/svg-title.png",
                "assets/svg-script.bin",
                "assets/svg-style.bin",
                "assets/real.png",
            ]
        );
    }

    #[test]
    fn asset_reference_discovery_classifies_link_relations_and_malformed_comments() {
        let source = concat!(
            r#"<link rel="canonical" href="canonical.png">"#,
            r#"<link rel="expect" href="expect.png">"#,
            r#"<link href="bare.png">"#,
            r#"<link rel="future" href="unknown.png">"#,
            r#"<link rel="future stylesheet" href="mixed.bin">"#,
            r#"<link rel="icon" imagesrcset="ignored.png 1x">"#,
            r#"<link rel="preload" as="script" imagesrcset="ignored-too.png 1x">"#,
            r#"<link rel="preload" as="image" imagesrcset="small.png 1x, large.png 2x">"#,
            r#"<svg><link href="foreign.png"></link></svg>"#,
            r#"<div title="title.png" data-art="custom.png"></div>"#,
            r#"<!-- bad --!><img src="after-bang.png">"#,
            r#"<!--><img src="after-abrupt.png">"#,
            r#"<!---><img src="after-start-dash.png">"#,
            r#"<!bogus " ><img src="after-bogus.png">"#,
            r#"<?bogus " ><img src="after-pi.png">"#,
            r#"<style.foo><img src="style-child.png"></style.foo>"#,
            r#"<script.foo><img src="script-child.png"></script.foo>"#,
            r#"<1 src="ghost.png">"#,
        );
        assert_eq!(
            asset_references_in_source("passage-a", "Start", source, Some("a"))
                .iter()
                .map(|reference| reference.path.as_str())
                .collect::<Vec<_>>(),
            vec![
                "assets/mixed.bin",
                "assets/small.png",
                "assets/large.png",
                "assets/after-bang.png",
                "assets/after-abrupt.png",
                "assets/after-start-dash.png",
                "assets/after-bogus.png",
                "assets/after-pi.png",
                "assets/style-child.png",
                "assets/script-child.png",
                "assets/ghost.png",
            ]
        );
        assert_eq!(
            asset_references_in_source("passage-a", "Start", source, Some("a"))
                .last()
                .map(|reference| reference.context.as_str()),
            Some("literal")
        );
    }

    #[test]
    fn asset_reference_discovery_uses_ascii_only_html_matching() {
        let source = concat!(
            r#"<linK rel="stylesheet" href="kelvin.bin">"#,
            r#"<svg><image xlinK:href="kelvin-attribute.bin"></image></svg>"#,
            r#"<link rel="masK-icon" href="mask.png">"#,
            r#"<link rel="&nbsp;stylesheet" href="nbsp.png">"#,
            r#"<link rel="preload" as="&nbsp;image" imagesrcset="nbsp-image.png 1x">"#,
            r#"<meta http-equiv=" refresh " content="0;URL=spaced-refresh.png">"#,
            r#"<meta http-equiv="&nbsp;refresh" content="0;URL=nbsp-refresh.png">"#,
            r#"<math><annotation-xml encoding="&nbsp;text/html"><title><img src="math-live.png"></title></annotation-xml></math>"#,
            r#"<math><annotation-xml encoding=" text/html "><title><img src="math-spaced-live.png"></title></annotation-xml></math>"#,
            r#"<LINK REL=" STYLESHEET " HREF="valid.bin">"#,
        );

        assert_eq!(
            asset_references_in_source("passage-a", "Start", source, Some("a"))
                .iter()
                .map(|reference| reference.path.as_str())
                .collect::<Vec<_>>(),
            vec![
                "assets/math-live.png",
                "assets/math-spaced-live.png",
                "assets/valid.bin",
            ]
        );
    }

    #[test]
    fn asset_reference_discovery_handles_large_irrelevant_and_plain_attributes() {
        let source = format!(
            r#"<img class="{}" src="plain-multi-character.png"><img src="hero&amp;retina.png">"#,
            "x".repeat(200_000)
        );
        assert_eq!(
            asset_references_in_source("passage-a", "Start", &source, Some("a"))
                .iter()
                .map(|reference| reference.path.as_str())
                .collect::<Vec<_>>(),
            vec!["assets/plain-multi-character.png", "assets/hero&retina.png",]
        );
    }

    #[test]
    fn asset_reference_metrics_and_rewrite_scan_dense_references_once() {
        let source = "😀 assets/shared.png\n".repeat(5_000);
        let (matches, scanned_characters) =
            asset_reference_matches_in_source("story:script", "Story JavaScript", &source, None);

        assert_eq!(matches.len(), 5_000);
        assert!(scanned_characters <= source.chars().count());
        assert_eq!(matches[0].reference.start, 3);
        assert_eq!(matches[0].reference.line, 1);
        assert_eq!(matches[4_999].reference.line, 5_000);

        let (overlapping, overlap_scan_count) =
            source_range_metrics(&source, &[(0, source.len()), (4, source.len() - 1)]);
        assert_eq!(overlap_scan_count, source.chars().count());
        assert_eq!(
            overlapping[1].expect("valid overlapping range").start_utf16,
            2
        );

        let replaced = replace_asset_references_in_source(
            &source,
            &normalized_asset_path("assets/shared.png"),
            "assets/replaced.png",
            false,
        );
        assert_eq!(replaced.matches("assets/replaced.png").count(), 5_000);
        assert!(!replaced.contains("assets/shared.png"));
    }

    #[test]
    fn asset_reference_discovery_indexes_and_rewrites_static_css_imports() {
        let stylesheet = concat!(
            r#"@im/**/port /* lead */ "theme.css";"#,
            "\n",
            "@import /* one *//**/'print.css';",
            "\n",
            r#"@import /* a *//**/"tokens";"#,
            "\n",
            r#"body { background: url(/* before */ "assets/theme.bin" /* after */); }"#,
            "\n",
            r#"a::after { content: "ignored.css"; }"#,
        );
        let references =
            asset_references_in_source("story:stylesheet", "Story Stylesheet", stylesheet, None);

        assert_eq!(
            references
                .iter()
                .map(|reference| (reference.path.as_str(), reference.context.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("assets/theme.css", "css-import"),
                ("assets/print.css", "css-import"),
                ("assets/tokens", "css-import"),
                ("assets/theme.bin", "css-url"),
            ]
        );
        assert!(
            replace_asset_references_in_source(
                stylesheet,
                &normalized_asset_path("assets/tokens"),
                "assets/replaced.tokens",
                true,
            )
            .contains(r#"@import /* a *//**/"assets/replaced.tokens";"#)
        );

        let passage_references = asset_references_in_source(
            "passage-a",
            "Start",
            r#"<style>@import /* c */ "passage.tokens"; .x { background: url(/**/ "passage.bin" /**/) }</style>"#,
            Some("a"),
        );
        assert_eq!(passage_references.len(), 2);
        assert_eq!(passage_references[0].path, "assets/passage.tokens");
        assert_eq!(passage_references[1].path, "assets/passage.bin");
    }

    #[test]
    fn asset_reference_discovery_leaves_escaped_and_dynamic_literals_unchanged() {
        let source = concat!(
            r#"const escaped = "assets/a.png?label=\"hero\"";"#,
            "\n",
            r#"const dynamic = `assets/${name}.png`;"#,
        );

        assert!(
            asset_references_in_source("story:script", "Story JavaScript", source, None).is_empty()
        );
        assert_eq!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/a.png"),
                "assets/replaced.png",
                false,
            ),
            source
        );
    }

    #[test]
    fn asset_reference_discovery_handles_prose_and_rejects_ambiguous_structured_values() {
        let prose = "café's image is here: assets/hero.png";
        let references = asset_references_in_source("passage-a", "Start", prose, Some("a"));

        assert_eq!(references.len(), 1);
        assert_eq!(references[0].original, "assets/hero.png");

        for source in [
            r#".x { background: url("assets/a.svg?label=\"hero\""); }"#,
            r#"<img srcset="data:image/svg+xml,assets/foo.png 1x">"#,
        ] {
            assert!(asset_references_in_source("passage-a", "Start", source, Some("a")).is_empty());
            assert_eq!(
                replace_asset_references_in_source(
                    source,
                    &normalized_asset_path("assets/a.svg"),
                    "assets/replaced.svg",
                    false,
                ),
                source
            );
        }

        let source = concat!(
            r#"<img srcset="data:image/png;base64,AAAA 1x, assets/猫%20cover.png?x=1#hero 2x">"#,
            r#"<source srcset="blob:https://example.test/id, assets/sound.ogg 1x">"#,
            r#"<source srcset="data:image/png;base64,AAAA, hero.webp 2x">"#,
            r#"<link rel="preload" href="theme.bin?rev=2#main"><link rel="manifest" href="site.webmanifest"><link rel="canonical" href="canonical.bin"><link href="bare.tokens"><object data="model.glb"></object>"#,
            r#"<svg><image href="icon.bin"></image><use xlink:href="sprite.bin#x"></use><feImage href="filter.exr"></feImage></svg>"#,
            r#"<a download href="archive.zip">x</a><a href="later.zip" download>x</a><svg><a download xlink:href="vector-download.bin">x</a></svg><a href="navigation.bin">x</a>"#,
            r#"<!-- <link href="comment.bin"> --><link title=">" rel="preload" href="after.bin"><link rel=icon href=unquoted.bin>"#,
        );
        let references = asset_references_in_source("passage-a", "Start", source, Some("a"));
        assert_eq!(
            references
                .iter()
                .map(|reference| (reference.path.as_str(), reference.context.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("assets/猫 cover.png", "html-srcset"),
                ("assets/sound.ogg", "html-srcset"),
                ("assets/hero.webp", "html-srcset"),
                ("assets/theme.bin", "html-href"),
                ("assets/site.webmanifest", "html-href"),
                ("assets/model.glb", "html-data"),
                ("assets/icon.bin", "html-href"),
                ("assets/sprite.bin", "html-href"),
                ("assets/filter.exr", "html-href"),
                ("assets/archive.zip", "html-href"),
                ("assets/later.zip", "html-href"),
                ("assets/vector-download.bin", "html-href"),
                ("assets/after.bin", "html-href"),
                ("assets/unquoted.bin", "html-href"),
            ]
        );
        let cat = &references[0];
        let start = utf16_offset_to_byte(source, cat.start).expect("valid start");
        let end = utf16_offset_to_byte(source, cat.end).expect("valid end");
        assert_eq!(&source[start..end], "assets/猫%20cover.png?x=1#hero");
        assert!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/theme.bin"),
                "assets/replaced.bin",
                false,
            )
            .contains(r#"href="assets/replaced.bin?rev=2#main""#)
        );
    }

    #[test]
    fn asset_reference_discovery_keeps_repeated_and_overlapping_names_exact() {
        let source = concat!(
            r#"<link rel="stylesheet" href="assets/theme.css"> "#,
            r#"assets/icon.png assets/icon.png assets/icon-large.png"#,
        );
        let references =
            asset_references_in_source("story:script", "Story JavaScript", source, None);

        assert_eq!(references.len(), 4);
        assert_eq!(references[0].context, "literal");
        assert_eq!(references[0].path, "assets/theme.css");
        assert_eq!(references[1].original, "assets/icon.png");
        assert_eq!(references[2].original, "assets/icon.png");
        assert_eq!(references[3].original, "assets/icon-large.png");

        for reference in references {
            let start = utf16_offset_to_byte(source, reference.start).expect("valid start");
            let end = utf16_offset_to_byte(source, reference.end).expect("valid end");
            assert_eq!(&source[start..end], reference.original);
        }
    }

    #[test]
    fn asset_inventory_keeps_case_distinct_project_paths_separate() {
        let references = asset_references_in_source(
            "passage-a",
            "Start",
            r#"<img src="assets/Foo.png"><img src="assets/foo.png">"#,
            Some("a"),
        );
        let inventory = asset_inventory_from_references(&references, Vec::new(), true);

        assert_eq!(inventory.len(), 2);
        assert!(inventory.iter().any(|asset| asset.path == "assets/Foo.png"));
        assert!(inventory.iter().any(|asset| asset.path == "assets/foo.png"));
    }

    #[test]
    fn asset_rename_uses_utf16_ranges_and_preserves_url_suffixes() {
        let source = "😀 <img src=\"assets/old%20name.png?v=7#preview\">";

        assert_eq!(
            replace_asset_references_in_source(
                source,
                &normalized_asset_path("assets/old name.png"),
                "assets/new name.png",
                false,
            ),
            "😀 <img src=\"assets/new%20name.png?v=7#preview\">"
        );
    }

    #[test]
    fn renderer_asset_commands_apply_model_side_without_filesystem_access() {
        let mut session = session();
        let batch = session
            .apply(StoryCommand::ImportAsset {
                overwrite: false,
                source_path: "/tmp/cover.png".into(),
                story_id: "story-1".into(),
                target_path: None,
            })
            .expect("renderer session should accept the native effect");

        assert!(
            batch
                .patches
                .iter()
                .any(|patch| matches!(patch, Patch::AssetImported { .. }))
        );
        assert!(!session.dirty());
        assert!(session.can_undo());
        session.undo().expect("asset import should undo");
        assert!(session.asset_inventory().is_empty());
    }

    #[test]
    fn file_backed_asset_inventory_tracks_files_references_and_metadata() {
        let root = temp_path("asset-inventory");
        let cover = root.join("assets/cover.png");
        let unused = root.join("assets/ui/unused.gif");
        let mut session = session();

        fs::create_dir_all(cover.parent().expect("asset should have parent"))
            .expect("asset directory should be created");
        fs::create_dir_all(unused.parent().expect("asset should have parent"))
            .expect("nested asset directory should be created");
        fs::write(&cover, tiny_png(320, 200)).expect("cover should be written");
        fs::write(&unused, b"GIF89a\x01\0\x02\0\0\0").expect("gif should be written");
        session.set_project_root(&root);

        {
            let story = session.story_mut("story-1").expect("story");
            let passage = story
                .passage_by_id_mut(&PassageId::new("a"))
                .expect("passage");

            passage.text =
                r#"<img src="assets/cover.png"> <audio src="assets/missing.mp3">"#.into();
        }

        let index = session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .expect("index should build");
        let cover_asset = index
            .asset_inventory
            .iter()
            .find(|asset| asset.path == "assets/cover.png")
            .expect("cover should be indexed");
        let missing_asset = index
            .asset_inventory
            .iter()
            .find(|asset| asset.path == "assets/missing.mp3")
            .expect("missing asset should be indexed");
        let unused_asset = index
            .asset_inventory
            .iter()
            .find(|asset| asset.path == "assets/ui/unused.gif")
            .expect("unused asset should be indexed");

        assert_eq!(cover_asset.exists, Some(true));
        assert_eq!(cover_asset.reference_count, 1);
        assert_eq!(cover_asset.width, Some(320));
        assert_eq!(cover_asset.height, Some(200));
        assert!(cover_asset
            .thumbnail_url
            .as_deref()
            .is_some_and(|url| url.starts_with("file://") && url.ends_with("/assets/cover.png")));
        assert_eq!(missing_asset.exists, Some(false));
        assert!(missing_asset.missing);
        assert!(unused_asset.unused);
        assert_eq!(unused_asset.width, Some(1));
        assert_eq!(unused_asset.height, Some(2));
        assert!(
            index
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "missing-asset")
        );
        assert!(
            index
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "unused-asset")
        );

        fs::remove_dir_all(root).expect("temp project should be removed");
    }

    #[test]
    fn asset_commands_import_insert_rename_and_delete_files_and_references() {
        let root = temp_path("asset-commands");
        let source = root.join("incoming.png");
        let mut session = session();

        fs::create_dir_all(&root).expect("temp project should be created");
        fs::write(&source, tiny_png(64, 32)).expect("source asset should be written");
        session.set_project_root(&root);

        let import = session
            .apply(StoryCommand::ImportAsset {
                overwrite: false,
                source_path: source.to_string_lossy().into_owned(),
                story_id: "story-1".into(),
                target_path: Some("assets/media/cover.png".into()),
            })
            .expect("asset should import");

        assert!(root.join("assets/media/cover.png").is_file());
        assert!(
            import
                .patches
                .iter()
                .any(|patch| matches!(patch, Patch::AssetImported { .. }))
        );

        session
            .apply(StoryCommand::InsertAssetSnippet {
                passage_id: Some("a".into()),
                path: "assets/media/cover.png".into(),
                position: 0,
                snippet: None,
                source_id: "a".into(),
                story_id: "story-1".into(),
            })
            .expect("snippet should insert");

        assert!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .text
                .starts_with(r#"<img src="assets/media/cover.png" alt="">"#)
        );

        session
            .apply(StoryCommand::RenameAsset {
                new_path: "assets/media/hero.png".into(),
                path: "assets/media/cover.png".into(),
                story_id: "story-1".into(),
                update_references: true,
            })
            .expect("asset should rename");

        assert!(!root.join("assets/media/cover.png").exists());
        assert!(root.join("assets/media/hero.png").is_file());
        assert!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .text
                .contains("assets/media/hero.png")
        );

        session
            .apply(StoryCommand::DeleteAsset {
                path: "assets/media/hero.png".into(),
                remove_references: true,
                story_id: "story-1".into(),
            })
            .expect("asset should delete");

        assert!(!root.join("assets/media/hero.png").exists());
        assert!(
            !session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .text
                .contains("assets/media/hero.png")
        );

        fs::remove_dir_all(root).expect("temp project should be removed");
    }

    #[test]
    fn saves_generated_layout_only_on_explicit_command() {
        let mut session = source_only_session();
        let query = session
            .apply(StoryCommand::QueryGraphProjection {
                story_id: "story-1".into(),
                options: CoreGraphProjectionOptions::default(),
            })
            .expect("projection should apply");

        let Patch::GraphProjectionUpdated { projection, .. } = &query.patches[0] else {
            panic!("expected projection patch");
        };

        assert_eq!(projection.layout_state, CoreGraphLayoutState::Generated);
        assert!(session.project.layout.passages.is_empty());

        let save = session
            .apply(StoryCommand::SaveGeneratedLayout {
                story_id: "story-1".into(),
            })
            .expect("layout save should apply");

        assert!(session.dirty());
        assert_eq!(session.project.layout.passages.len(), 3);
        assert!(save.patches.iter().any(|patch| {
            matches!(
                patch,
                Patch::LayoutSaved {
                    projection: CoreGraphProjection {
                        layout_state: CoreGraphLayoutState::Saved,
                        ..
                    },
                    ..
                }
            )
        }));
    }

    #[test]
    fn saves_dense_generated_layout_blocks_through_core_command() {
        let target_count = 12;
        let mut session = dense_source_only_session(target_count);
        let save = session
            .apply(StoryCommand::SaveGeneratedLayout {
                story_id: "story-1".into(),
            })
            .expect("layout save should apply");
        let layout_saved = save
            .patches
            .iter()
            .find(|patch| matches!(patch, Patch::LayoutSaved { .. }))
            .expect("save should include a layout projection");
        let Patch::LayoutSaved { projection, .. } = layout_saved else {
            panic!("expected layout saved patch");
        };
        let story = session.story("story-1").expect("story should exist");
        let target_bounds = (0..target_count)
            .map(|index| {
                story
                    .passage_by_id(&PassageId::new(format!("target-{index}")))
                    .expect("target passage should exist")
                    .layout
                    .expect("target layout should be saved")
            })
            .collect::<Vec<_>>();
        let target_lefts = target_bounds
            .iter()
            .map(|bounds| bounds.left as i64)
            .collect::<BTreeSet<_>>();
        let target_tops = target_bounds
            .iter()
            .map(|bounds| bounds.top as i64)
            .collect::<BTreeSet<_>>();

        assert_eq!(projection.layout_state, CoreGraphLayoutState::Saved);
        assert_eq!(session.project.layout.passages.len(), target_count + 1);
        assert_eq!(target_lefts.len(), 3);
        assert_eq!(target_tops.len(), 4);
    }

    #[test]
    fn replaces_link_targets_without_touching_display_text_or_setters() {
        assert_eq!(
            replace_standard_link_targets(
                "[[Old]] [[Display->Old][$x = 1]] [[ Old <-Back]] [[Display|Old]]",
                "Old",
                "New",
            ),
            "[[New]] [[Display->New][$x = 1]] [[ New <-Back]] [[Display|New]]"
        );
    }
}
