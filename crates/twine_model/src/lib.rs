#![doc = "Core Twine story, passage, project, and edit data types."]

use indexmap::IndexMap;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::{collections::BTreeMap, fmt, ops::Index};
use thiserror::Error;

pub const PROJECT_SCHEMA_VERSION: u32 = 2;

fn default_schema_version() -> u32 {
    PROJECT_SCHEMA_VERSION
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

    pub fn get_at(&self, index: usize) -> Option<&Passage> {
        self.entries.get_index(index).map(|(_, passage)| passage)
    }

    pub fn rank_of(&self, id: &PassageId) -> Option<usize> {
        self.entries.get_index_of(id)
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

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageLayout {
    #[serde(default)]
    pub bounds: GraphPosition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
}

impl<'de> Deserialize<'de> for PassageLayout {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct PassageLayoutWire {
            #[serde(default)]
            bounds: Option<GraphPosition>,
            #[serde(default)]
            group: Option<String>,
            #[serde(default)]
            height: Option<f64>,
            #[serde(default)]
            left: Option<f64>,
            #[serde(default)]
            metadata: BTreeMap<String, Value>,
            #[serde(default)]
            top: Option<f64>,
            #[serde(default)]
            width: Option<f64>,
        }

        let wire = PassageLayoutWire::deserialize(deserializer)?;
        let bounds = wire.bounds.or_else(|| {
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
            bounds: bounds.unwrap_or_default(),
            group: wire.group,
            metadata: wire.metadata,
        })
    }
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

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PassageLayouts {
    by_story: BTreeMap<StoryId, BTreeMap<PassageId, PassageLayout>>,
    legacy: BTreeMap<PassageId, PassageLayout>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScopedPassageLayoutsWire {
    schema: u32,
    by_story: BTreeMap<StoryId, BTreeMap<PassageId, PassageLayout>>,
    #[serde(default)]
    legacy: BTreeMap<PassageId, PassageLayout>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum PassageLayoutsWire {
    Scoped(ScopedPassageLayoutsWire),
    Legacy(BTreeMap<PassageId, PassageLayout>),
}

impl<'de> Deserialize<'de> for PassageLayouts {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(match PassageLayoutsWire::deserialize(deserializer)? {
            PassageLayoutsWire::Scoped(wire) => {
                if wire.schema != 2 {
                    return Err(D::Error::custom(format!(
                        "unsupported passage layout schema {}",
                        wire.schema
                    )));
                }

                Self {
                    by_story: wire.by_story,
                    legacy: wire.legacy,
                }
            }
            PassageLayoutsWire::Legacy(legacy) => Self {
                by_story: BTreeMap::new(),
                legacy,
            },
        })
    }
}

impl Serialize for PassageLayouts {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Wire<'a> {
            schema: u32,
            by_story: &'a BTreeMap<StoryId, BTreeMap<PassageId, PassageLayout>>,
            #[serde(skip_serializing_if = "BTreeMap::is_empty")]
            legacy: &'a BTreeMap<PassageId, PassageLayout>,
        }

        Wire {
            schema: 2,
            by_story: &self.by_story,
            legacy: &self.legacy,
        }
        .serialize(serializer)
    }
}

impl PassageLayouts {
    pub fn append(&mut self, other: Self) {
        for (story_id, layouts) in other.by_story {
            self.extend_story(story_id, layouts);
        }
        self.legacy.extend(other.legacy);
    }

    pub fn clear(&mut self) {
        self.by_story.clear();
        self.legacy.clear();
    }

    pub fn extend_story(
        &mut self,
        story_id: StoryId,
        layouts: impl IntoIterator<Item = (PassageId, PassageLayout)>,
    ) {
        let mut layouts = layouts.into_iter().peekable();

        if layouts.peek().is_some() {
            self.by_story.entry(story_id).or_default().extend(layouts);
        }
    }

    pub fn get(&self, story_id: &StoryId, passage_id: &PassageId) -> Option<&PassageLayout> {
        self.by_story
            .get(story_id)
            .and_then(|layouts| layouts.get(passage_id))
            .or_else(|| self.legacy.get(passage_id))
    }

    pub fn insert(
        &mut self,
        story_id: StoryId,
        passage_id: PassageId,
        layout: PassageLayout,
    ) -> Option<PassageLayout> {
        self.by_story
            .entry(story_id)
            .or_default()
            .insert(passage_id, layout)
    }

    pub fn set_bounds(&mut self, story_id: StoryId, passage_id: PassageId, bounds: GraphPosition) {
        self.by_story
            .entry(story_id)
            .or_default()
            .entry(passage_id)
            .or_default()
            .bounds = bounds;
    }

    pub fn is_empty(&self) -> bool {
        self.by_story.values().all(BTreeMap::is_empty) && self.legacy.is_empty()
    }

    pub fn uses_scoped_schema(&self) -> bool {
        !self.by_story.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&StoryId, &PassageId, &PassageLayout)> {
        self.by_story.iter().flat_map(|(story_id, layouts)| {
            layouts
                .iter()
                .map(move |(passage_id, layout)| (story_id, passage_id, layout))
        })
    }

    pub fn len(&self) -> usize {
        self.by_story.values().map(BTreeMap::len).sum::<usize>() + self.legacy.len()
    }

    pub fn migrate_legacy(&mut self, stories: &[Story]) -> bool {
        if self.legacy.is_empty() {
            return false;
        }

        let legacy = std::mem::take(&mut self.legacy);

        for story in stories {
            for passage in &story.passages {
                if let Some(layout) = legacy.get(&passage.id) {
                    self.by_story
                        .entry(story.id.clone())
                        .or_default()
                        .entry(passage.id.clone())
                        .or_insert_with(|| layout.clone());
                }
            }
        }

        true
    }

    pub fn remove(&mut self, story_id: &StoryId, passage_id: &PassageId) -> Option<PassageLayout> {
        let (removed, empty) = self
            .by_story
            .get_mut(story_id)
            .map_or((None, false), |layouts| {
                let removed = layouts.remove(passage_id);
                (removed, layouts.is_empty())
            });

        if empty {
            self.by_story.remove(story_id);
        }

        removed
    }

    pub fn remove_story(&mut self, story_id: &StoryId) {
        self.by_story.remove(story_id);
    }

    pub fn retain_story(
        &mut self,
        story_id: &StoryId,
        mut predicate: impl FnMut(&PassageId, &PassageLayout) -> bool,
    ) {
        let empty = self.by_story.get_mut(story_id).is_some_and(|layouts| {
            layouts.retain(|passage_id, layout| predicate(passage_id, layout));
            layouts.is_empty()
        });

        if empty {
            self.by_story.remove(story_id);
        }
    }

    pub fn story(&self, story_id: &StoryId) -> Option<&BTreeMap<PassageId, PassageLayout>> {
        self.by_story.get(story_id)
    }
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
    #[serde(default, skip_serializing_if = "PassageLayouts::is_empty")]
    pub passages: PassageLayouts,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub saved_layouts: BTreeMap<String, SavedLayout>,
}

impl GraphLayout {
    pub fn from_story_layout(story: &Story) -> Self {
        let mut passages = PassageLayouts::default();

        passages.extend_story(
            story.id.clone(),
            story.passages.iter().filter_map(|passage| {
                passage.layout.map(|bounds| {
                    (
                        passage.id.clone(),
                        PassageLayout {
                            bounds,
                            ..PassageLayout::default()
                        },
                    )
                })
            }),
        );

        Self {
            passages,
            ..Self::default()
        }
    }

    pub fn from_story_bounds(story: &Story) -> Self {
        Self::from_story_layout(story)
    }

    pub fn apply_to_story(&self, story: &mut Story) {
        for passage in &mut story.passages {
            if let Some(layout) = self.passages.get(&story.id, &passage.id) {
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

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectSourceLayout {
    #[default]
    PassageFiles,
    SingleTwee,
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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub source_layouts: BTreeMap<StoryId, ProjectSourceLayout>,
}

impl Default for ProjectManifest {
    fn default() -> Self {
        Self {
            app_version: String::new(),
            name: String::new(),
            schema_version: default_schema_version(),
            storage: StoragePolicy::default(),
            source_layouts: BTreeMap::new(),
        }
    }
}

impl ProjectManifest {
    pub fn source_layout_for(&self, story_id: &StoryId) -> ProjectSourceLayout {
        self.source_layouts
            .get(story_id)
            .copied()
            .unwrap_or_default()
    }

    pub fn set_source_layout(&mut self, story_id: StoryId, layout: ProjectSourceLayout) {
        if layout == ProjectSourceLayout::default() {
            self.source_layouts.remove(&story_id);
        } else {
            self.source_layouts.insert(story_id, layout);
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
    fn project_source_layout_defaults_to_passage_files() {
        let manifest = ProjectManifest::default();
        let story_id = StoryId::new("story-1");

        assert_eq!(
            manifest.source_layout_for(&story_id),
            ProjectSourceLayout::PassageFiles
        );
    }

    #[test]
    fn project_manifest_tracks_only_non_default_source_layouts() {
        let mut manifest = ProjectManifest::default();
        let story_id = StoryId::new("story-1");

        manifest.set_source_layout(story_id.clone(), ProjectSourceLayout::SingleTwee);
        assert_eq!(
            manifest.source_layout_for(&story_id),
            ProjectSourceLayout::SingleTwee
        );
        assert_eq!(
            serde_json::to_value(&manifest)
                .expect("manifest should serialize")
                .pointer("/sourceLayouts/story-1"),
            Some(&Value::String("single-twee".into()))
        );

        manifest.set_source_layout(story_id.clone(), ProjectSourceLayout::PassageFiles);
        assert_eq!(
            manifest.source_layout_for(&story_id),
            ProjectSourceLayout::PassageFiles
        );
        assert!(!manifest.source_layouts.contains_key(&story_id));
    }

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
    fn deserializes_legacy_flat_graph_layout_positions() {
        let layout: GraphLayout = serde_json::from_str(
            r#"{
                "passages": {
                    "passage-1": {
                        "height": 120,
                        "left": 3250,
                        "top": 10950,
                        "width": 180
                    }
                }
            }"#,
        )
        .expect("legacy flat graph layout should deserialize");
        let bounds = layout
            .passages
            .get(&StoryId::new("story-1"), &PassageId::new("passage-1"))
            .expect("passage layout")
            .bounds;

        assert_eq!(bounds.left, 3250.0);
        assert_eq!(bounds.top, 10950.0);
        assert_eq!(bounds.width, 180.0);
        assert_eq!(bounds.height, 120.0);
    }

    #[test]
    fn deserializes_canonical_graph_layout_bounds() {
        let layout: GraphLayout = serde_json::from_str(
            r#"{
                "passages": {
                    "schema": 2,
                    "byStory": {
                        "story-1": {
                            "passage-1": {
                                "bounds": {
                                    "height": 120,
                                    "left": 3250,
                                    "top": 10950,
                                    "width": 180
                                }
                            }
                        }
                    }
                }
            }"#,
        )
        .expect("canonical graph layout should deserialize");
        let bounds = layout
            .passages
            .get(&StoryId::new("story-1"), &PassageId::new("passage-1"))
            .expect("passage layout")
            .bounds;

        assert_eq!(bounds.left, 3250.0);
        assert_eq!(bounds.top, 10950.0);
        assert_eq!(bounds.width, 180.0);
        assert_eq!(bounds.height, 120.0);
    }

    #[test]
    fn migrates_legacy_layouts_to_every_matching_story() {
        let mut layout: GraphLayout = serde_json::from_str(
            r#"{
                "passages": {
                    "shared": {"left": 25},
                    "deleted": {"left": 900}
                }
            }"#,
        )
        .expect("legacy graph layout should deserialize");
        let stories: Vec<Story> = serde_json::from_str(
            r#"[
                {
                    "id": "story-1",
                    "passages": [{"id": "shared", "story": "story-1"}]
                },
                {
                    "id": "story-2",
                    "passages": [{"id": "shared", "story": "story-2"}]
                }
            ]"#,
        )
        .expect("stories should deserialize");

        assert!(layout.passages.migrate_legacy(&stories));
        assert_eq!(layout.passages.len(), 2);
        assert_eq!(
            layout
                .passages
                .get(&StoryId::new("story-1"), &PassageId::new("shared"))
                .expect("first scoped layout")
                .bounds
                .left,
            25.0
        );
        assert_eq!(
            layout
                .passages
                .get(&StoryId::new("story-2"), &PassageId::new("shared"))
                .expect("second scoped layout")
                .bounds
                .left,
            25.0
        );

        let serialized = serde_json::to_value(&layout).expect("layout should serialize");
        assert!(serialized["passages"]["byStory"]["story-1"]["shared"].is_object());
        assert!(serialized["passages"].get("legacy").is_none());
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
