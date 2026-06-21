#![doc = "Core Twine story and passage data types."]

use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fmt};

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
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
pub struct Rect {
    pub height: f64,
    pub left: f64,
    pub top: f64,
    pub width: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Passage {
    pub height: f64,
    pub highlighted: bool,
    pub id: PassageId,
    pub left: f64,
    pub name: String,
    pub selected: bool,
    pub story: StoryId,
    pub tags: Vec<String>,
    pub text: String,
    pub top: f64,
    pub width: f64,
}

impl Passage {
    pub fn bounds(&self) -> Rect {
        Rect {
            height: self.height,
            left: self.left,
            top: self.top,
            width: self.width,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Story {
    pub ifid: String,
    pub id: StoryId,
    pub last_update: String,
    pub name: String,
    pub passages: Vec<Passage>,
    pub script: String,
    pub selected: bool,
    pub snap_to_grid: bool,
    pub start_passage: PassageId,
    pub story_format: String,
    pub story_format_version: String,
    pub stylesheet: String,
    pub tags: Vec<String>,
    pub tag_colors: BTreeMap<String, String>,
    pub zoom: f64,
}

impl Story {
    pub fn passage_by_id(&self, id: &PassageId) -> Option<&Passage> {
        self.passages.iter().find(|passage| &passage.id == id)
    }

    pub fn passage_by_name(&self, name: &str) -> Option<&Passage> {
        self.passages.iter().find(|passage| passage.name == name)
    }

    pub fn passage_count(&self) -> usize {
        self.passages.len()
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
        assert_eq!(story.passages[0].bounds().left, 25.0);
        assert!(story.passage_by_name("Start").is_some());
    }
}
