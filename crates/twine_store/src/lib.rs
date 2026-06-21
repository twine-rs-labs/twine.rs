#![doc = "Persistence interfaces and baseline JSON fixture loading."]

use std::{fs::File, io::BufReader, path::Path};
use thiserror::Error;
use twine_model::{Story, StoryId};

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("story not found: {0}")]
    StoryNotFound(StoryId),
}

pub trait StoryStore {
    fn load_story(&self, id: &StoryId) -> Result<Story, StoreError>;
    fn save_story(&self, story: &Story) -> Result<(), StoreError>;
}

pub fn load_story_json_path(path: impl AsRef<Path>) -> Result<Story, StoreError> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);

    Ok(serde_json::from_reader(reader)?)
}

pub fn save_story_json_path(path: impl AsRef<Path>, story: &Story) -> Result<(), StoreError> {
    let file = File::create(path)?;

    Ok(serde_json::to_writer_pretty(file, story)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn loads_story_json_from_path() {
        let path = std::env::temp_dir().join(format!(
            "twine-story-{}.json",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ));
        fs::write(
            &path,
            r#"{
				"ifid": "IFID",
				"id": "story-1",
				"lastUpdate": "2026-01-01T00:00:00.000Z",
				"name": "Example",
				"passages": [],
				"script": "",
				"selected": false,
				"snapToGrid": true,
				"startPassage": "",
				"storyFormat": "Harlowe",
				"storyFormatVersion": "3.3.9",
				"stylesheet": "",
				"tags": [],
				"tagColors": {},
				"zoom": 1
			}"#,
        )
        .expect("temp story should be written");

        let story = load_story_json_path(&path).expect("story should load");

        fs::remove_file(path).expect("temp story should be removed");
        assert_eq!(story.name, "Example");
    }
}
