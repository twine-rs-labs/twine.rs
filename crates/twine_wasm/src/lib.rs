#![doc = "WASM bindings for the renderer-side Twine core session."]

use std::collections::BTreeMap;
use twine_core::{
    CoreExternalDelta, CoreGraphProjectionOptions, CoreStoryIndexOptions, PassageSnapshot,
    ProjectSession, ProjectSnapshot, StoryCommand, StorySnapshot,
};
use twine_model::{
    GraphLayout, GraphPosition, LibraryMetadata, Passage, PassageId, PassageIndex, PassageLayout,
    Project, ProjectManifest, Story, StoryId,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct TwineWasmProjectSession {
    session: ProjectSession,
}

#[wasm_bindgen]
impl TwineWasmProjectSession {
    #[wasm_bindgen(constructor)]
    pub fn new(snapshot: JsValue) -> Result<TwineWasmProjectSession, JsValue> {
        let snapshot = from_js::<ProjectSnapshot>(snapshot)?;

        Ok(Self {
            session: ProjectSession::new(project_from_snapshot(snapshot)),
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

    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        to_js(&self.session.snapshot())
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

    fn snapshot() -> ProjectSnapshot {
        ProjectSnapshot {
            dirty: false,
            name: "Fixture Project".into(),
            schema_version: 1,
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
}
