#![doc = "Export interfaces for story data."]

use thiserror::Error;
use twine_model::Story;

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn story_to_json_pretty(story: &Story) -> Result<String, ExportError> {
    Ok(serde_json::to_string_pretty(story)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use twine_model::Story;

    #[test]
    fn exports_json() {
        let story: Story = serde_json::from_str(
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
        .expect("story should deserialize");

        assert!(
            story_to_json_pretty(&story)
                .expect("story should export")
                .contains("Example")
        );
    }
}
