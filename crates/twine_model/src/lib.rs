#![doc = "Core Twine story, passage, project, and edit data types."]

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, fmt, ops::Index};
use thiserror::Error;

fn default_schema_version() -> u32 {
    1
}

fn default_true() -> bool {
    true
}

fn is_one(value: &f64) -> bool {
    (*value - 1.0).abs() <= f64::EPSILON
}

#[derive(Clone, Debug, Default, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct StoryId(String);

impl StoryId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl AsRef<str> for StoryId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for StoryId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct PassageId(String);

impl PassageId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl AsRef<str> for PassageId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for PassageId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPosition {
    pub height: f64,
    pub left: f64,
    pub top: f64,
    pub width: f64,
}

impl Default for GraphPosition {
    fn default() -> Self {
        Self {
            height: 100.0,
            left: 0.0,
            top: 0.0,
            width: 100.0,
        }
    }
}

pub type Rect = GraphPosition;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Passage {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub custom_attributes: BTreeMap<String, String>,
    pub id: PassageId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<GraphPosition>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_pid: Option<String>,
    pub story: StoryId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default)]
    pub text: String,
}

impl Passage {
    pub fn bounds(&self) -> Option<GraphPosition> {
        self.layout
    }

    pub fn set_bounds(&mut self, bounds: GraphPosition) {
        self.layout = Some(bounds);
    }
}

impl<'de> Deserialize<'de> for Passage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct PassageWire {
            #[serde(default)]
            custom_attributes: BTreeMap<String, String>,
            #[serde(default)]
            height: Option<f64>,
            #[serde(default)]
            id: PassageId,
            #[serde(default)]
            layout: Option<GraphPosition>,
            #[serde(default)]
            left: Option<f64>,
            #[serde(default)]
            metadata: BTreeMap<String, Value>,
            #[serde(default)]
            name: String,
            #[serde(default)]
            source_pid: Option<String>,
            #[serde(default)]
            story: StoryId,
            #[serde(default)]
            tags: Vec<String>,
            #[serde(default)]
            text: String,
            #[serde(default)]
            top: Option<f64>,
            #[serde(default)]
            width: Option<f64>,
        }

        let wire = PassageWire::deserialize(deserializer)?;
        let layout = wire.layout.or_else(|| {
            if wire.left.is_some()
                || wire.top.is_some()
                || wire.width.is_some()
                || wire.height.is_some()
            {
                Some(GraphPosition {
                    height: wire.height.unwrap_or(100.0),
                    left: wire.left.unwrap_or(0.0),
                    top: wire.top.unwrap_or(0.0),
                    width: wire.width.unwrap_or(100.0),
                })
            } else {
                None
            }
        });

        Ok(Self {
            custom_attributes: wire.custom_attributes,
            id: wire.id,
            layout,
            metadata: wire.metadata,
            name: wire.name,
            source_pid: wire.source_pid,
            story: wire.story,
            tags: wire.tags,
            text: wire.text,
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PassageIndex {
    entries: IndexMap<PassageId, Passage>,
    names: BTreeMap<String, PassageId>,
}

impl PassageIndex {
    pub fn clear(&mut self) {
        self.entries.clear();
        self.names.clear();
    }

    pub fn first(&self) -> Option<&Passage> {
        self.entries.values().next()
    }

    pub fn get(&self, id: &PassageId) -> Option<&Passage> {
        self.entries.get(id)
    }

    pub fn get_mut(&mut self, id: &PassageId) -> Option<&mut Passage> {
        self.entries.get_mut(id)
    }

    pub fn id_for_name(&self, name: &str) -> Option<&PassageId> {
        self.names.get(name)
    }

    pub fn insert(&mut self, passage: Passage) {
        let id = passage.id.clone();
        let name = passage.name.clone();

        if let Some(previous) = self.entries.insert(id.clone(), passage) {
            self.names.remove(&previous.name);
        }

        self.names.insert(name, id);
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn iter(&self) -> indexmap::map::Values<'_, PassageId, Passage> {
        self.entries.values()
    }

    pub fn iter_mut(&mut self) -> indexmap::map::ValuesMut<'_, PassageId, Passage> {
        self.entries.values_mut()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn push(&mut self, passage: Passage) {
        self.insert(passage);
    }

    pub fn rebuild_name_index(&mut self) {
        self.names = self
            .entries
            .iter()
            .map(|(id, passage)| (passage.name.clone(), id.clone()))
            .collect();
    }

    pub fn values(&self) -> indexmap::map::Values<'_, PassageId, Passage> {
        self.iter()
    }

    pub fn values_mut(&mut self) -> indexmap::map::ValuesMut<'_, PassageId, Passage> {
        self.iter_mut()
    }
}

impl From<Vec<Passage>> for PassageIndex {
    fn from(passages: Vec<Passage>) -> Self {
        let mut index = Self::default();

        for passage in passages {
            index.insert(passage);
        }

        index
    }
}

impl FromIterator<Passage> for PassageIndex {
    fn from_iter<T: IntoIterator<Item = Passage>>(iter: T) -> Self {
        let mut index = Self::default();

        for passage in iter {
            index.insert(passage);
        }

        index
    }
}

impl<'a> IntoIterator for &'a PassageIndex {
    type IntoIter = indexmap::map::Values<'a, PassageId, Passage>;
    type Item = &'a Passage;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<'a> IntoIterator for &'a mut PassageIndex {
    type IntoIter = indexmap::map::ValuesMut<'a, PassageId, Passage>;
    type Item = &'a mut Passage;

    fn into_iter(self) -> Self::IntoIter {
        self.iter_mut()
    }
}

impl Index<usize> for PassageIndex {
    type Output = Passage;

    fn index(&self, index: usize) -> &Self::Output {
        self.entries
            .get_index(index)
            .map(|(_, passage)| passage)
            .expect("passage index out of bounds")
    }
}

impl Serialize for PassageIndex {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.entries
            .values()
            .collect::<Vec<_>>()
            .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for PassageIndex {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Ok(Vec::<Passage>::deserialize(deserializer)?.into())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Story {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub custom_attributes: BTreeMap<String, String>,
    #[serde(default)]
    pub ifid: String,
    pub id: StoryId,
    #[serde(default)]
    pub last_update: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "PassageIndex::is_empty")]
    pub passages: PassageIndex,
    #[serde(default)]
    pub script: String,
    #[serde(default = "default_true")]
    pub snap_to_grid: bool,
    #[serde(default)]
    pub start_passage: PassageId,
    #[serde(default)]
    pub story_format: String,
    #[serde(default)]
    pub story_format_version: String,
    #[serde(default)]
    pub stylesheet: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tag_colors: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub format_options: String,
    #[serde(default = "default_zoom", skip_serializing_if = "is_one")]
    pub zoom: f64,
}

fn default_zoom() -> f64 {
    1.0
}

impl Story {
    pub fn passage_by_id(&self, id: &PassageId) -> Option<&Passage> {
        self.passages.get(id)
    }

    pub fn passage_by_id_mut(&mut self, id: &PassageId) -> Option<&mut Passage> {
        self.passages.get_mut(id)
    }

    pub fn passage_by_name(&self, name: &str) -> Option<&Passage> {
        self.passages
            .id_for_name(name)
            .and_then(|id| self.passages.get(id))
    }

    pub fn passage_count(&self) -> usize {
        self.passages.len()
    }

    pub fn apply_structural_edit(
        &mut self,
        edit: StructuralEdit,
    ) -> Result<UndoRecord, ModelError> {
        match edit {
            StructuralEdit::RenamePassage { passage_id, name } => {
                if self
                    .passages
                    .id_for_name(&name)
                    .is_some_and(|id| id != &passage_id)
                {
                    return Err(ModelError::DuplicatePassageName(name));
                }

                let passage = self
                    .passage_by_id_mut(&passage_id)
                    .ok_or_else(|| ModelError::PassageNotFound(passage_id.clone()))?;
                let old_name = std::mem::replace(&mut passage.name, name.clone());
                self.passages.rebuild_name_index();
                let undo = StructuralEdit::RenamePassage {
                    passage_id: passage_id.clone(),
                    name: old_name,
                };
                let redo = StructuralEdit::RenamePassage { passage_id, name };

                Ok(UndoRecord {
                    description: "Rename passage".into(),
                    redo,
                    undo,
                })
            }
            StructuralEdit::SetStartPassage { passage_id } => {
                if !passage_id.as_ref().is_empty() && self.passage_by_id(&passage_id).is_none() {
                    return Err(ModelError::PassageNotFound(passage_id));
                }

                let old_start = std::mem::replace(&mut self.start_passage, passage_id.clone());

                Ok(UndoRecord {
                    description: "Set start passage".into(),
                    redo: StructuralEdit::SetStartPassage { passage_id },
                    undo: StructuralEdit::SetStartPassage {
                        passage_id: old_start,
                    },
                })
            }
        }
    }
}

impl Default for Story {
    fn default() -> Self {
        Self {
            color: None,
            custom_attributes: BTreeMap::new(),
            ifid: String::new(),
            id: StoryId::new(""),
            last_update: String::new(),
            metadata: BTreeMap::new(),
            name: String::new(),
            passages: PassageIndex::default(),
            script: String::new(),
            snap_to_grid: true,
            start_passage: PassageId::new(""),
            story_format: String::new(),
            story_format_version: String::new(),
            stylesheet: String::new(),
            tags: Vec::new(),
            tag_colors: BTreeMap::new(),
            format_options: String::new(),
            zoom: 1.0,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum StructuralEdit {
    RenamePassage { passage_id: PassageId, name: String },
    SetStartPassage { passage_id: PassageId },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoRecord {
    pub description: String,
    pub redo: StructuralEdit,
    pub undo: StructuralEdit,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum ModelError {
    #[error("duplicate passage name: {0}")]
    DuplicatePassageName(String),

    #[error("passage not found: {0}")]
    PassageNotFound(PassageId),
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageLayout {
    #[serde(default)]
    pub bounds: GraphPosition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphGroup {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub passages: Vec<PassageId>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedLayout {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub passages: BTreeMap<PassageId, PassageLayout>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphAnnotation {
    pub id: String,
    #[serde(default)]
    pub bounds: GraphPosition,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
    #[serde(default)]
    pub text: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLayout {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub annotations: BTreeMap<String, GraphAnnotation>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub groups: BTreeMap<String, GraphGroup>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub passages: BTreeMap<PassageId, PassageLayout>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub saved_layouts: BTreeMap<String, SavedLayout>,
}

impl GraphLayout {
    pub fn from_story_layout(story: &Story) -> Self {
        Self {
            passages: story
                .passages
                .iter()
                .filter_map(|passage| {
                    passage.layout.map(|bounds| {
                        (
                            passage.id.clone(),
                            PassageLayout {
                                bounds,
                                ..PassageLayout::default()
                            },
                        )
                    })
                })
                .collect(),
            ..Self::default()
        }
    }

    pub fn from_story_bounds(story: &Story) -> Self {
        Self::from_story_layout(story)
    }

    pub fn apply_to_story(&self, story: &mut Story) {
        for passage in &mut story.passages {
            if let Some(layout) = self.passages.get(&passage.id) {
                passage.set_bounds(layout.bounds);
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePolicy {
    #[serde(default = "default_true")]
    pub local_only: bool,
    #[serde(default = "default_max_backups")]
    pub max_backups: usize,
    #[serde(default = "default_storage_message")]
    pub message: String,
}

fn default_max_backups() -> usize {
    10
}

fn default_storage_message() -> String {
    "This project is stored in a user-selected local folder. Cloud sync only happens if that folder is managed by another service.".into()
}

impl Default for StoragePolicy {
    fn default() -> Self {
        Self {
            local_only: true,
            max_backups: default_max_backups(),
            message: default_storage_message(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub storage: StoragePolicy,
}

impl Default for ProjectManifest {
    fn default() -> Self {
        Self {
            app_version: String::new(),
            name: String::new(),
            schema_version: default_schema_version(),
            storage: StoragePolicy::default(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMetadata {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub colors: BTreeMap<StoryId, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sort_order: Vec<StoryId>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    #[serde(default)]
    pub layout: GraphLayout,
    #[serde(default)]
    pub library: LibraryMetadata,
    #[serde(default)]
    pub manifest: ProjectManifest,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stories: Vec<Story>,
}

impl Project {
    pub fn from_story(story: Story) -> Self {
        let mut library = LibraryMetadata::default();

        library.sort_order.push(story.id.clone());
        if let Some(color) = &story.color {
            library.colors.insert(story.id.clone(), color.clone());
        }

        Self {
            layout: GraphLayout::from_story_layout(&story),
            library,
            manifest: ProjectManifest {
                name: story.name.clone(),
                ..ProjectManifest::default()
            },
            stories: vec![story],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_story_json_shape() {
        let story: Story = serde_json::from_str(
            r#"{
				"ifid": "IFID",
				"id": "story-1",
				"lastUpdate": "2026-01-01T00:00:00.000Z",
				"name": "Example",
				"passages": [{
					"height": 100,
					"highlighted": false,
					"id": "passage-1",
					"left": 25,
					"name": "Start",
					"selected": false,
					"story": "story-1",
					"tags": ["hub"],
					"text": "[[Next]]",
					"top": 25,
					"width": 100
				}],
				"script": "",
				"selected": false,
				"snapToGrid": true,
				"startPassage": "passage-1",
				"storyFormat": "Harlowe",
				"storyFormatVersion": "3.3.9",
				"stylesheet": "",
				"tags": ["benchmark"],
				"tagColors": {},
				"zoom": 1
			}"#,
        )
        .expect("story should deserialize");

        assert_eq!(story.passage_count(), 1);
        assert_eq!(story.passages[0].bounds().expect("layout").left, 25.0);
        assert!(story.passage_by_name("Start").is_some());
    }

    #[test]
    fn preserves_lossless_metadata_fields() {
        let story: Story = serde_json::from_str(
            r#"{
                "id": "story-1",
                "name": "Example",
                "customAttributes": {"data-x": "1"},
                "metadata": {"unknown": {"nested": true}},
                "passages": [{
                    "id": "passage-1",
                    "name": "Start",
                    "story": "story-1",
                    "sourcePid": "7",
                    "customAttributes": {"data-y": "2"},
                    "metadata": {"positionSource": "html"}
                }]
            }"#,
        )
        .expect("story should deserialize");

        assert_eq!(story.custom_attributes["data-x"], "1");
        assert_eq!(story.passages[0].source_pid.as_deref(), Some("7"));
        assert_eq!(story.passages[0].custom_attributes["data-y"], "2");
        assert_eq!(story.metadata["unknown"]["nested"], Value::Bool(true));
    }

    #[test]
    fn structural_edits_return_undo_records() {
        let mut story: Story = serde_json::from_str(
            r#"{
                "id": "story-1",
                "name": "Example",
                "startPassage": "a",
                "passages": [
                    {"id": "a", "name": "Start", "story": "story-1"},
                    {"id": "b", "name": "End", "story": "story-1"}
                ]
            }"#,
        )
        .expect("story should deserialize");

        let undo = story
            .apply_structural_edit(StructuralEdit::RenamePassage {
                passage_id: PassageId::new("a"),
                name: "Beginning".into(),
            })
            .expect("rename should apply");

        assert_eq!(story.passages[0].name, "Beginning");
        story
            .apply_structural_edit(undo.undo)
            .expect("undo should apply");
        assert_eq!(story.passages[0].name, "Start");

        let undo = story
            .apply_structural_edit(StructuralEdit::SetStartPassage {
                passage_id: PassageId::new("b"),
            })
            .expect("start change should apply");

        assert_eq!(story.start_passage, PassageId::new("b"));
        story
            .apply_structural_edit(undo.undo)
            .expect("start undo should apply");
        assert_eq!(story.start_passage, PassageId::new("a"));
    }
}
