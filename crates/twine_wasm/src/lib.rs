#![doc = "WASM bindings for the renderer-side Twine core session."]

use std::collections::BTreeMap;
use twine_core::{
    CoreAssetInventoryEntry, CoreAssetsQuery, CoreBacklinksQuery, CoreContentsQuery,
    CoreDiagnosticsQuery, CoreDiagnosticsSummaryQuery, CoreDocumentQuery, CoreExternalDelta,
    CoreExternalIngestMode, CoreGraphProjectionOptions, CoreSearchQuery, CoreSourceKind,
    CoreStoryIndexOptions, PassageSnapshot, PlanPassageRenameBeginResult, PlanPassageRenameRequest,
    PlanProjectReplaceBeginResult, PlanProjectReplaceRequest, ProjectSession, ProjectSnapshot,
    RefactorPlanApplyRequest, RefactorPlanApplyResult, RefactorPlanCursor,
    RefactorPlanDetailResult, RefactorPlanningTaskHandle, RefactorRuntimeState, StoryCommand,
    StorySnapshot,
};
use twine_model::{
    GraphLayout, GraphPosition, LibraryMetadata, Passage, PassageId, PassageIndex, PassageLayout,
    Project, ProjectManifest, Story, StoryId,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct TwineWasmProjectSession {
    session: ProjectSession,
    refactor_runtime: Option<RefactorRuntimeState>,
}

/// Incrementally assembles the initial project snapshot inside WASM so large
/// passage bodies never need to coexist in one worker request.
#[wasm_bindgen]
pub struct TwineWasmProjectBootstrap {
    snapshot: ProjectSnapshot,
}

#[wasm_bindgen]
impl TwineWasmProjectBootstrap {
    #[wasm_bindgen(constructor)]
    pub fn new(snapshot: JsValue) -> Result<TwineWasmProjectBootstrap, JsValue> {
        Ok(Self {
            snapshot: from_js::<ProjectSnapshot>(snapshot)?,
        })
    }

    pub fn append_passages(&mut self, story_id: String, passages: JsValue) -> Result<(), JsValue> {
        let passages = from_js::<Vec<PassageSnapshot>>(passages)?;
        let story = self
            .snapshot
            .stories
            .iter_mut()
            .find(|story| story.id == story_id)
            .ok_or_else(|| JsValue::from_str("Bootstrap passage referenced an unknown story."))?;
        story.passages.extend(passages);
        Ok(())
    }

    pub fn finish(self) -> TwineWasmProjectSession {
        TwineWasmProjectSession {
            session: ProjectSession::new(project_from_snapshot(self.snapshot)),
            refactor_runtime: None,
        }
    }
}

#[wasm_bindgen]
impl TwineWasmProjectSession {
    #[wasm_bindgen(constructor)]
    pub fn new(snapshot: JsValue) -> Result<TwineWasmProjectSession, JsValue> {
        let snapshot = from_js::<ProjectSnapshot>(snapshot)?;

        Ok(Self {
            session: ProjectSession::new(project_from_snapshot(snapshot)),
            refactor_runtime: None,
        })
    }

    pub fn apply(&mut self, command: JsValue, record_history: bool) -> Result<JsValue, JsValue> {
        let command = from_js::<StoryCommand>(command)?;
        let batch = self
            .session
            .apply_with_history(command, record_history)
            .map_err(core_error)?;

        to_js(&batch)
    }

    pub fn undo(&mut self) -> Result<JsValue, JsValue> {
        to_js(&self.session.undo())
    }

    pub fn redo(&mut self) -> Result<JsValue, JsValue> {
        to_js(&self.session.redo())
    }

    pub fn acknowledge_saved(&mut self, revision: u32) -> Result<JsValue, JsValue> {
        to_js(&self.session.acknowledge_saved(revision as u64))
    }

    pub fn apply_external_delta(&mut self, delta: JsValue) -> Result<JsValue, JsValue> {
        let delta = from_js::<CoreExternalDelta>(delta)?;
        let batch = self
            .session
            .apply_external_delta(delta)
            .map_err(core_error)?;

        to_js(&batch)
    }

    pub fn ingest_external_delta(
        &mut self,
        delta: JsValue,
        force: bool,
    ) -> Result<JsValue, JsValue> {
        let delta = from_js::<CoreExternalDelta>(delta)?;
        let result = self
            .session
            .ingest_external_delta(
                delta,
                if force {
                    CoreExternalIngestMode::Force
                } else {
                    CoreExternalIngestMode::Auto
                },
            )
            .map_err(core_error)?;

        to_js(&result)
    }

    pub fn set_asset_inventory(&mut self, inventory: JsValue) -> Result<(), JsValue> {
        self.session
            .set_asset_inventory(from_js::<Vec<CoreAssetInventoryEntry>>(inventory)?);
        Ok(())
    }

    pub fn can_undo(&self) -> bool {
        self.session.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.session.can_redo()
    }

    pub fn revision(&self) -> u32 {
        self.session.revision().min(u32::MAX as u64) as u32
    }

    pub fn set_revision(&mut self, revision: u32) {
        self.session.set_revision(revision as u64);
    }

    pub fn status(&self) -> Result<JsValue, JsValue> {
        to_js(&self.session.status())
    }

    pub fn performance_diagnostics(&self) -> Result<JsValue, JsValue> {
        to_js(&self.session.performance_diagnostics())
    }

    pub fn query_refactor_plan_detail(&mut self, cursor: JsValue) -> Result<JsValue, JsValue> {
        let cursor = from_js::<RefactorPlanCursor>(cursor)?;
        to_js(&query_refactor_plan_detail_result(
            &mut self.session,
            &cursor,
        ))
    }

    pub fn sync_refactor_runtime(&mut self, runtime: JsValue) -> Result<(), JsValue> {
        self.refactor_runtime = Some(from_js::<RefactorRuntimeState>(runtime)?);
        Ok(())
    }

    pub fn begin_passage_rename_plan(&mut self, request: JsValue) -> Result<JsValue, JsValue> {
        let request = from_js::<PlanPassageRenameRequest>(request)?;
        let result = match self.refactor_runtime.clone() {
            Some(runtime) => match self.session.begin_passage_rename_plan(request, runtime) {
                Ok(task) => PlanPassageRenameBeginResult::Begun { task },
                Err(failure) => PlanPassageRenameBeginResult::Failure { failure },
            },
            None => PlanPassageRenameBeginResult::Failure {
                failure: missing_refactor_runtime_failure(),
            },
        };
        to_js(&result)
    }

    pub fn continue_passage_rename_plan(&mut self, task: JsValue) -> Result<JsValue, JsValue> {
        let task = from_js::<RefactorPlanningTaskHandle>(task)?;
        to_js(&self.session.continue_passage_rename_plan(&task))
    }

    pub fn cancel_passage_rename_plan(&mut self, task: JsValue) -> Result<bool, JsValue> {
        let task = from_js::<RefactorPlanningTaskHandle>(task)?;
        Ok(self.session.cancel_passage_rename_plan(&task))
    }

    pub fn begin_project_replace_plan(&mut self, request: JsValue) -> Result<JsValue, JsValue> {
        let request = from_js::<PlanProjectReplaceRequest>(request)?;
        let result = match self.refactor_runtime.clone() {
            Some(runtime) => match self.session.begin_project_replace_plan(request, runtime) {
                Ok(task) => PlanProjectReplaceBeginResult::Begun { task },
                Err(failure) => PlanProjectReplaceBeginResult::Failure { failure },
            },
            None => PlanProjectReplaceBeginResult::Failure {
                failure: missing_refactor_runtime_failure(),
            },
        };
        to_js(&result)
    }

    pub fn continue_project_replace_plan(&mut self, task: JsValue) -> Result<JsValue, JsValue> {
        let task = from_js::<RefactorPlanningTaskHandle>(task)?;
        to_js(&self.session.continue_project_replace_plan(&task))
    }

    pub fn cancel_project_replace_plan(&mut self, task: JsValue) -> Result<bool, JsValue> {
        let task = from_js::<RefactorPlanningTaskHandle>(task)?;
        Ok(self.session.cancel_project_replace_plan(&task))
    }

    pub fn apply_refactor_plan(&mut self, request: JsValue) -> Result<JsValue, JsValue> {
        let request = from_js::<RefactorPlanApplyRequest>(request)?;
        let runtime = self.refactor_runtime.as_ref().ok_or_else(|| {
            JsValue::from_str("Refactor runtime has not been synchronized for this session.")
        })?;
        to_js(&apply_refactor_plan_result(
            &mut self.session,
            &request,
            &runtime,
        ))
    }

    pub fn query_graph_projection(
        &mut self,
        story_id: String,
        options: JsValue,
    ) -> Result<JsValue, JsValue> {
        let options = from_js::<CoreGraphProjectionOptions>(options)?;
        let projection = self
            .session
            .graph_projection(&story_id, options)
            .map_err(core_error)?;

        to_js(&projection)
    }

    pub fn query_story_index(
        &mut self,
        story_id: String,
        options: JsValue,
    ) -> Result<JsValue, JsValue> {
        let options = from_js::<CoreStoryIndexOptions>(options)?;
        let index = self
            .session
            .story_index(&story_id, options)
            .map_err(core_error)?;

        to_js(&index)
    }

    pub fn query_story_summary(&mut self, story_id: String) -> Result<JsValue, JsValue> {
        to_js(&self.session.story_summary(&story_id).map_err(core_error)?)
    }

    pub fn query_diagnostics_summary(
        &mut self,
        story_id: String,
        query: JsValue,
    ) -> Result<JsValue, JsValue> {
        let query = from_js::<CoreDiagnosticsSummaryQuery>(query)?;
        to_js(
            &self
                .session
                .diagnostics_summary(&story_id, query)
                .map_err(core_error)?,
        )
    }

    pub fn query_story_word_count(&self, story_id: String) -> Result<usize, JsValue> {
        self.session.story_word_count(&story_id).map_err(core_error)
    }

    pub fn query_contents_page(
        &mut self,
        story_id: String,
        query: JsValue,
    ) -> Result<JsValue, JsValue> {
        let query = from_js::<CoreContentsQuery>(query)?;

        to_js(
            &self
                .session
                .contents_page(&story_id, query)
                .map_err(core_error)?,
        )
    }

    pub fn query_search_page(
        &mut self,
        story_id: String,
        query: JsValue,
    ) -> Result<JsValue, JsValue> {
        let query = from_js::<CoreSearchQuery>(query)?;

        to_js(
            &self
                .session
                .search_page(&story_id, query)
                .map_err(core_error)?,
        )
    }

    pub fn query_diagnostics_page(
        &mut self,
        story_id: String,
        query: JsValue,
    ) -> Result<JsValue, JsValue> {
        let query = from_js::<CoreDiagnosticsQuery>(query)?;

        to_js(
            &self
                .session
                .diagnostics_page(&story_id, query)
                .map_err(core_error)?,
        )
    }

    pub fn query_assets_page(
        &mut self,
        story_id: String,
        query: JsValue,
    ) -> Result<JsValue, JsValue> {
        let query = from_js::<CoreAssetsQuery>(query)?;

        to_js(
            &self
                .session
                .assets_page(&story_id, query)
                .map_err(core_error)?,
        )
    }

    pub fn query_passage_facts(
        &mut self,
        story_id: String,
        passage_id: String,
    ) -> Result<JsValue, JsValue> {
        to_js(
            &self
                .session
                .passage_facts(&story_id, &passage_id)
                .map_err(core_error)?,
        )
    }

    pub fn query_passage_local_facts(
        &mut self,
        story_id: String,
        passage_id: String,
    ) -> Result<JsValue, JsValue> {
        to_js(
            &self
                .session
                .passage_local_facts(&story_id, &passage_id)
                .map_err(core_error)?,
        )
    }

    pub fn query_backlinks_page(
        &mut self,
        story_id: String,
        passage_id: String,
        query: JsValue,
    ) -> Result<JsValue, JsValue> {
        let query = from_js::<CoreBacklinksQuery>(query)?;
        to_js(
            &self
                .session
                .backlinks_page(&story_id, &passage_id, query)
                .map_err(core_error)?,
        )
    }

    pub fn query_passage_document(
        &self,
        story_id: String,
        passage_id: String,
    ) -> Result<JsValue, JsValue> {
        to_js(
            &self
                .session
                .passage_document(&story_id, &passage_id)
                .map_err(core_error)?,
        )
    }

    pub fn query_source_document(
        &self,
        story_id: String,
        kind: String,
    ) -> Result<JsValue, JsValue> {
        let kind = match kind.as_str() {
            "script" => CoreSourceKind::Script,
            "stylesheet" => CoreSourceKind::Stylesheet,
            _ => return Err(JsValue::from_str("Unsupported story source kind.")),
        };
        to_js(
            &self
                .session
                .source_document(&story_id, kind)
                .map_err(core_error)?,
        )
    }

    pub fn query_document_page(
        &self,
        story_id: String,
        query: JsValue,
    ) -> Result<JsValue, JsValue> {
        let query = from_js::<CoreDocumentQuery>(query)?;
        to_js(
            &self
                .session
                .document_page(&story_id, query)
                .map_err(core_error)?,
        )
    }

    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        to_js(&self.session.snapshot())
    }
}

fn missing_refactor_runtime_failure() -> twine_core::RefactorPlanFailure {
    twine_core::RefactorPlanFailure {
        code: twine_core::RefactorPlanFailureCode::StaleProjectRevision,
        message: "Refactor runtime has not been synchronized for this session.".into(),
    }
}

#[wasm_bindgen]
pub fn query_graph_projection(
    snapshot: JsValue,
    story_id: String,
    options: JsValue,
) -> Result<JsValue, JsValue> {
    let mut session = TwineWasmProjectSession::new(snapshot)?;

    session.query_graph_projection(story_id, options)
}

#[wasm_bindgen]
pub fn query_story_index(
    snapshot: JsValue,
    story_id: String,
    options: JsValue,
) -> Result<JsValue, JsValue> {
    let mut session = TwineWasmProjectSession::new(snapshot)?;

    session.query_story_index(story_id, options)
}

fn from_js<T>(value: JsValue) -> Result<T, JsValue>
where
    T: serde::de::DeserializeOwned,
{
    serde_wasm_bindgen::from_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn to_js<T>(value: &T) -> Result<JsValue, JsValue>
where
    T: serde::Serialize,
{
    serde::Serialize::serialize(value, &serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

fn core_error(error: twine_core::CoreError) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn query_refactor_plan_detail_result(
    session: &mut ProjectSession,
    cursor: &RefactorPlanCursor,
) -> RefactorPlanDetailResult {
    match session.refactor_plan_detail_page(cursor) {
        Ok(page) => RefactorPlanDetailResult::Page { page },
        Err(failure) => RefactorPlanDetailResult::Failure { failure },
    }
}

fn apply_refactor_plan_result(
    session: &mut ProjectSession,
    request: &RefactorPlanApplyRequest,
    runtime: &RefactorRuntimeState,
) -> RefactorPlanApplyResult {
    match session.apply_refactor_plan_with_receipt(request, runtime) {
        Ok((batch, receipt)) => RefactorPlanApplyResult::Applied { batch, receipt },
        Err(failure) => RefactorPlanApplyResult::Failure { failure },
    }
}

fn project_from_snapshot(snapshot: ProjectSnapshot) -> Project {
    let stories = snapshot
        .stories
        .into_iter()
        .map(story_from_snapshot)
        .collect::<Vec<_>>();
    let mut library = LibraryMetadata::default();
    let mut layout = GraphLayout::default();

    for story in &stories {
        library.sort_order.push(story.id.clone());

        for passage in story.passages.iter() {
            if let Some(bounds) = passage.layout {
                layout.passages.insert(
                    story.id.clone(),
                    passage.id.clone(),
                    PassageLayout {
                        bounds,
                        ..PassageLayout::default()
                    },
                );
            }
        }
    }

    Project {
        layout,
        library,
        manifest: ProjectManifest {
            name: snapshot.name,
            schema_version: snapshot.schema_version,
            ..ProjectManifest::default()
        },
        stories,
    }
}

fn story_from_snapshot(snapshot: StorySnapshot) -> Story {
    let story_id = StoryId::new(snapshot.id);
    let passages = snapshot
        .passages
        .into_iter()
        .map(|passage| passage_from_snapshot(passage, &story_id))
        .collect::<Vec<_>>();

    Story {
        id: story_id,
        ifid: snapshot.ifid,
        name: snapshot.name,
        passages: PassageIndex::from(passages),
        script: snapshot.script,
        snap_to_grid: snapshot.snap_to_grid,
        start_passage: PassageId::new(snapshot.start_passage_id),
        story_format: snapshot.story_format,
        story_format_version: snapshot.story_format_version,
        stylesheet: snapshot.stylesheet,
        tags: snapshot.tags,
        tag_colors: snapshot.tag_colors,
        zoom: snapshot.zoom,
        ..Story::default()
    }
}

fn passage_from_snapshot(snapshot: PassageSnapshot, story_id: &StoryId) -> Passage {
    Passage {
        custom_attributes: BTreeMap::new(),
        id: PassageId::new(snapshot.id),
        layout: snapshot.layout.map(GraphPosition::from),
        metadata: BTreeMap::new(),
        name: snapshot.name,
        source_pid: None,
        story: story_id.clone(),
        tags: snapshot.tags,
        text: snapshot.text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use twine_core::{PlanPassageRenameRequest, RefactorPlanSelection};

    fn snapshot() -> ProjectSnapshot {
        ProjectSnapshot {
            dirty: false,
            name: "Fixture Project".into(),
            schema_version: twine_model::PROJECT_SCHEMA_VERSION,
            stories: vec![StorySnapshot {
                id: "story-1".into(),
                ifid: "IFID".into(),
                name: "Fixture".into(),
                passages: vec![
                    PassageSnapshot {
                        id: "start".into(),
                        layout: Some(twine_core::CoreRect {
                            height: 100.0,
                            left: 0.0,
                            top: 0.0,
                            width: 160.0,
                        }),
                        name: "Start".into(),
                        story_id: "story-1".into(),
                        tags: vec!["scene".into()],
                        text: "[[Next]]".into(),
                    },
                    PassageSnapshot {
                        id: "next".into(),
                        layout: Some(twine_core::CoreRect {
                            height: 100.0,
                            left: 220.0,
                            top: 0.0,
                            width: 160.0,
                        }),
                        name: "Next".into(),
                        story_id: "story-1".into(),
                        tags: Vec::new(),
                        text: String::new(),
                    },
                ],
                script: String::new(),
                snap_to_grid: false,
                start_passage_id: "start".into(),
                story_format: "Harlowe".into(),
                story_format_version: "3.3.9".into(),
                stylesheet: String::new(),
                tags: Vec::new(),
                tag_colors: BTreeMap::from([("scene".into(), "red".into())]),
                zoom: 0.75,
            }],
        }
    }

    #[test]
    fn project_snapshot_preserves_renderer_story_fields() {
        let project = project_from_snapshot(snapshot());
        let story = &project.stories[0];

        assert_eq!(project.manifest.name, "Fixture Project");
        assert_eq!(story.id.as_ref(), "story-1");
        assert!(!story.snap_to_grid);
        assert_eq!(story.tag_colors.get("scene"), Some(&"red".to_string()));
        assert_eq!(story.zoom, 0.75);
        assert_eq!(project.layout.passages.len(), 2);
    }

    #[test]
    fn project_session_queries_graph_and_index_from_snapshot() {
        let mut session = ProjectSession::new(project_from_snapshot(snapshot()));
        let graph = session
            .graph_projection("story-1", CoreGraphProjectionOptions::default())
            .unwrap();
        let index = session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .unwrap();

        assert_eq!(graph.stats.links, 1);
        assert_eq!(index.tag_entries[0].color, Some("red".into()));
    }

    #[test]
    fn refactor_boundary_uses_operation_specific_public_types() {
        let mut session = ProjectSession::new(project_from_snapshot(snapshot()));
        let runtime = RefactorRuntimeState {
            project_revision: 1,
            buffers: Vec::new(),
            external: None,
            provider: None,
        };
        let task = session
            .begin_passage_rename_plan(
                PlanPassageRenameRequest {
                    story_id: "story-1".into(),
                    passage_id: "next".into(),
                    after_name: "After".into(),
                },
                runtime.clone(),
            )
            .expect("plan task");
        let summary = loop {
            match session.continue_passage_rename_plan(&task) {
                twine_core::PlanPassageRenameResult::Pending { .. } => continue,
                twine_core::PlanPassageRenameResult::Complete { summary } => break summary,
                result => panic!("unexpected planning result: {result:?}"),
            }
        };
        let result = apply_refactor_plan_result(
            &mut session,
            &RefactorPlanApplyRequest {
                plan_id: summary.plan_id,
                expected_project_revision: 1,
                selection: RefactorPlanSelection::All,
            },
            &runtime,
        );

        assert!(matches!(result, RefactorPlanApplyResult::Applied { .. }));
        assert_eq!(session.revision(), 2);
        assert_eq!(
            session.project().stories[0]
                .passage_by_id(&PassageId::new("next"))
                .unwrap()
                .name,
            "After"
        );
    }

    #[test]
    fn project_replace_boundary_uses_opaque_plan_and_compact_selection_types() {
        let mut session = ProjectSession::new(project_from_snapshot(snapshot()));
        let runtime = RefactorRuntimeState {
            project_revision: 1,
            buffers: Vec::new(),
            external: None,
            provider: None,
        };
        let task = session
            .begin_project_replace_plan(
                PlanProjectReplaceRequest {
                    story_id: "story-1".into(),
                    query: "Next".into(),
                    replacement: "After".into(),
                    include_passage_names: false,
                    include_passage_text: true,
                    include_script: false,
                    include_stylesheet: false,
                    match_case: true,
                    use_regexes: false,
                },
                runtime.clone(),
            )
            .expect("project replace task");
        let summary = loop {
            match session.continue_project_replace_plan(&task) {
                twine_core::PlanProjectReplaceResult::Pending { .. } => continue,
                twine_core::PlanProjectReplaceResult::Complete { summary } => break summary,
                result => panic!("unexpected project replace result: {result:?}"),
            }
        };
        assert_eq!(summary.operation_kind, "project-replace");
        let result = apply_refactor_plan_result(
            &mut session,
            &RefactorPlanApplyRequest {
                plan_id: summary.plan_id,
                expected_project_revision: 1,
                selection: RefactorPlanSelection::All,
            },
            &runtime,
        );

        assert!(matches!(result, RefactorPlanApplyResult::Applied { .. }));
        assert_eq!(session.revision(), 2);
        assert_eq!(
            session.project().stories[0]
                .passage_by_id(&PassageId::new("start"))
                .unwrap()
                .text,
            "[[After]]"
        );
    }
}
