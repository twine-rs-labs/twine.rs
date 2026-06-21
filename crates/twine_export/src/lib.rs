#![doc = "Export interfaces for story and project data."]

use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use thiserror::Error;
use twine_model::{Passage, PassageId, Story};
use twine_parse::{escape_for_twee_header, escape_for_twee_text};

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("starting passage does not exist: {0}")]
    MissingStartPassage(PassageId),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HtmlExportOptions {
    pub creator: String,
    pub creator_version: String,
    pub format_options: String,
    pub preserve_source_pids: bool,
    pub start_id: Option<PassageId>,
    pub start_optional: bool,
}

impl Default for HtmlExportOptions {
    fn default() -> Self {
        Self {
            creator: "twine.rs".into(),
            creator_version: env!("CARGO_PKG_VERSION").into(),
            format_options: String::new(),
            preserve_source_pids: true,
            start_id: None,
            start_optional: false,
        }
    }
}

pub fn story_to_json_pretty(story: &Story) -> Result<String, ExportError> {
    Ok(serde_json::to_string_pretty(story)?)
}

pub fn stories_to_json_pretty(stories: &[Story]) -> Result<String, ExportError> {
    Ok(serde_json::to_string_pretty(stories)?)
}

pub fn passage_to_twee(passage: &Passage) -> Result<String, ExportError> {
    let escaped_name = escape_twee_passage_name(&passage.name);
    let tags = if passage.tags.is_empty() {
        String::new()
    } else {
        format!(
            " [{}]",
            passage
                .tags
                .iter()
                .map(|tag| escape_for_twee_header(tag))
                .collect::<Vec<_>>()
                .join(" ")
        )
    };
    let metadata = passage_twee_metadata(passage)?
        .map(|metadata| format!(" {metadata}"))
        .unwrap_or_default();

    Ok(format!(
        ":: {escaped_name}{tags}{metadata}\n{}\n",
        escape_for_twee_text(&passage.text)
    ))
}

pub fn story_to_twee(story: &Story) -> Result<String, ExportError> {
    let mut output = String::new();

    output.push_str(":: StoryTitle\n");
    output.push_str(&escape_for_twee_text(&story.name));
    output.push_str("\n\n\n:: StoryData\n");
    output.push_str(&serde_json::to_string_pretty(&story_data_for_twee(story))?);
    output.push_str("\n\n\n");

    for (index, passage) in story.passages.iter().enumerate() {
        if index > 0 {
            output.push_str("\n\n");
        }

        output.push_str(&passage_to_twee(passage)?);
    }

    let passage_names = story
        .passages
        .iter()
        .map(|passage| passage.name.as_str())
        .collect::<Vec<_>>();

    if !story.script.trim().is_empty() {
        output.push_str("\n\n:: ");
        output.push_str(&unused_name("StoryScript", &passage_names));
        output.push_str(" [script]\n");
        output.push_str(&escape_for_twee_text(story.script.trim()));
    }

    if !story.stylesheet.trim().is_empty() {
        output.push_str("\n\n:: ");
        output.push_str(&unused_name("StoryStylesheet", &passage_names));
        output.push_str(" [stylesheet]\n");
        output.push_str(&escape_for_twee_text(story.stylesheet.trim()));
    }

    Ok(output)
}

pub fn story_to_twine_html(
    story: &Story,
    options: &HtmlExportOptions,
) -> Result<String, ExportError> {
    let start_id = options.start_id.as_ref().unwrap_or(&story.start_passage);
    let pid_by_passage = exported_pid_map(story, options.preserve_source_pids);
    let startnode = if start_id.as_ref().is_empty() {
        String::new()
    } else if let Some(pid) = pid_by_passage.get(start_id) {
        pid.clone()
    } else if options.start_optional {
        String::new()
    } else {
        return Err(ExportError::MissingStartPassage(start_id.clone()));
    };
    let format_options = if options.format_options.is_empty() {
        &story.format_options
    } else {
        &options.format_options
    };
    let mut attrs = story.custom_attributes.clone();

    attrs.insert("name".into(), story.name.clone());
    attrs.insert("startnode".into(), startnode);
    attrs.insert("creator".into(), options.creator.clone());
    attrs.insert("creator-version".into(), options.creator_version.clone());
    attrs.insert("format".into(), story.story_format.clone());
    attrs.insert("format-version".into(), story.story_format_version.clone());
    attrs.insert("ifid".into(), story.ifid.clone());
    attrs.insert("options".into(), format_options.clone());
    attrs.insert("tags".into(), story.tags.join(" "));
    attrs.insert("zoom".into(), story.zoom.to_string());

    let mut output = String::new();

    output.push_str("<tw-storydata");
    output.push_str(&attrs_to_html(&attrs));
    output.push_str(" hidden>");
    output
        .push_str(r#"<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">"#);
    output.push_str(&escape_html_text(&story.stylesheet));
    output.push_str("</style>");
    output
        .push_str(r#"<script role="script" id="twine-user-script" type="text/twine-javascript">"#);
    output.push_str(&escape_html_text(&story.script));
    output.push_str("</script>");

    for (tag, color) in &story.tag_colors {
        output.push_str("<tw-tag");
        output.push_str(&attrs_to_html(&BTreeMap::from([
            ("name".into(), tag.clone()),
            ("color".into(), color.clone()),
        ])));
        output.push_str("></tw-tag>");
    }

    for (index, passage) in story.passages.iter().enumerate() {
        let pid = pid_by_passage
            .get(&passage.id)
            .cloned()
            .unwrap_or_else(|| (index + 1).to_string());

        output.push_str(&passage_to_twine_html(passage, &pid));
    }

    output.push_str("</tw-storydata>");
    Ok(output)
}

pub fn story_to_html_document(
    story: &Story,
    options: &HtmlExportOptions,
) -> Result<String, ExportError> {
    Ok(format!(
        "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>{}</title></head><body>\n{}\n</body></html>\n",
        escape_html_text(&story.name),
        story_to_twine_html(story, options)?
    ))
}

pub fn archive_to_twine_html(
    stories: &[Story],
    options: &HtmlExportOptions,
) -> Result<String, ExportError> {
    let mut output = String::new();

    for (index, story) in stories.iter().enumerate() {
        if index > 0 {
            output.push_str("\n\n");
        }

        let mut story_options = options.clone();

        story_options.start_optional = true;
        output.push_str(&story_to_twine_html(story, &story_options)?);
    }

    Ok(output)
}

pub fn story_with_format_source(
    story: &Story,
    format_source: &str,
    options: &HtmlExportOptions,
) -> Result<String, ExportError> {
    Ok(format_source
        .replace("{{STORY_NAME}}", &escape_html_text(&story.name))
        .replace("{{STORY_DATA}}", &story_to_twine_html(story, options)?))
}

fn passage_to_twine_html(passage: &Passage, pid: &str) -> String {
    let mut attrs = passage.custom_attributes.clone();

    attrs.insert("pid".into(), pid.into());
    attrs.insert("name".into(), passage.name.clone());
    attrs.insert("tags".into(), passage.tags.join(" "));

    if let Some(layout) = passage.layout {
        attrs.insert("position".into(), format!("{},{}", layout.left, layout.top));
        attrs.insert("size".into(), format!("{},{}", layout.width, layout.height));
    }

    format!(
        "<tw-passagedata{}>{}</tw-passagedata>",
        attrs_to_html(&attrs),
        escape_html_text(&passage.text)
    )
}

fn story_data_for_twee(story: &Story) -> Value {
    let mut data = Map::new();

    data.insert("ifid".into(), Value::String(story.ifid.clone()));
    data.insert("format".into(), Value::String(story.story_format.clone()));
    data.insert(
        "format-version".into(),
        Value::String(story.story_format_version.clone()),
    );

    if let Some(start) = story.passage_by_id(&story.start_passage) {
        data.insert("start".into(), Value::String(start.name.clone()));
    }

    if !story.tag_colors.is_empty() {
        data.insert(
            "tag-colors".into(),
            Value::Object(
                story
                    .tag_colors
                    .iter()
                    .map(|(tag, color)| (tag.clone(), Value::String(color.clone())))
                    .collect(),
            ),
        );
    }

    data.insert(
        "zoom".into(),
        serde_json::Number::from_f64(story.zoom)
            .map(Value::Number)
            .unwrap_or(Value::Null),
    );

    if let Some(Value::Object(extra)) = story.metadata.get("storyData") {
        for (key, value) in extra {
            data.entry(key.clone()).or_insert_with(|| value.clone());
        }
    }

    Value::Object(data)
}

fn passage_twee_metadata(passage: &Passage) -> Result<Option<String>, ExportError> {
    let mut metadata = Map::new();

    if let Some(layout) = passage.layout {
        metadata.insert(
            "position".into(),
            Value::String(format!("{},{}", layout.left, layout.top)),
        );
        metadata.insert(
            "size".into(),
            Value::String(format!("{},{}", layout.width, layout.height)),
        );
    }

    for (key, value) in &passage.metadata {
        metadata.entry(key.clone()).or_insert_with(|| value.clone());
    }

    if metadata.is_empty() {
        Ok(None)
    } else {
        Ok(Some(serde_json::to_string(&Value::Object(metadata))?))
    }
}

fn exported_pid_map(story: &Story, preserve_source_pids: bool) -> HashMap<PassageId, String> {
    let mut seen = HashSet::new();
    let mut result = HashMap::new();

    for (index, passage) in story.passages.iter().enumerate() {
        let candidate = passage
            .source_pid
            .as_ref()
            .filter(|pid| preserve_source_pids && !pid.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| (index + 1).to_string());
        let pid = if seen.insert(candidate.clone()) {
            candidate
        } else {
            let fallback = (index + 1).to_string();

            seen.insert(fallback.clone());
            fallback
        };

        result.insert(passage.id.clone(), pid);
    }

    result
}

fn escape_twee_passage_name(value: &str) -> String {
    let escaped = escape_for_twee_header(value);
    let escaped = if escaped.starts_with(char::is_whitespace) {
        let count = escaped
            .chars()
            .take_while(|value| value.is_whitespace())
            .count();
        format!("{}{}", "\\ ".repeat(count), escaped.trim_start())
    } else {
        escaped
    };

    if escaped.ends_with(char::is_whitespace) {
        let count = escaped
            .chars()
            .rev()
            .take_while(|value| value.is_whitespace())
            .count();
        format!("{}{}", escaped.trim_end(), "\\ ".repeat(count))
    } else {
        escaped
    }
}

fn unused_name(base: &str, names: &[&str]) -> String {
    if !names.contains(&base) {
        return base.into();
    }

    for index in 1.. {
        let candidate = format!("{base} {index}");

        if !names.contains(&candidate.as_str()) {
            return candidate;
        }
    }

    unreachable!("infinite iterator should return");
}

fn attrs_to_html(attrs: &BTreeMap<String, String>) -> String {
    attrs
        .iter()
        .map(|(key, value)| format!(" {key}=\"{}\"", escape_html_attr(value)))
        .collect::<String>()
}

fn escape_html_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_html_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use twine_model::Story;

    fn story() -> Story {
        serde_json::from_value(json!({
            "ifid": "IFID",
            "id": "story-1",
            "lastUpdate": "2026-01-01T00:00:00.000Z",
            "name": "Example",
            "passages": [{
                "height": 100,
                "id": "passage-1",
                "left": 25,
                "name": "Start",
                "sourcePid": "7",
                "story": "story-1",
                "tags": ["hub"],
                "text": "[[Next]] <raw>",
                "top": 25,
                "width": 100,
                "customAttributes": {"data-extra": "kept"},
                "metadata": {"unknown": true}
            }],
            "script": "alert(1)",
            "snapToGrid": true,
            "startPassage": "passage-1",
            "storyFormat": "Harlowe",
            "storyFormatVersion": "3.3.9",
            "stylesheet": "body {}",
            "tags": ["benchmark"],
            "tagColors": {"hub": "green"},
            "zoom": 1,
            "metadata": {"storyData": {"extra": 1}}
        }))
        .expect("story json should deserialize")
    }

    #[test]
    fn exports_json() {
        assert!(
            story_to_json_pretty(&story())
                .expect("story should export")
                .contains("Example")
        );
    }

    #[test]
    fn exports_twee_with_story_data_and_assets() {
        let output = story_to_twee(&story()).expect("twee should export");

        assert!(output.contains(":: StoryTitle\nExample"));
        assert!(output.contains(r#""start": "Start""#));
        assert!(output.contains(r#""extra": 1"#));
        assert!(output.contains(r#""unknown":true"#));
        assert!(output.contains(":: StoryScript [script]\nalert(1)"));
        assert!(output.contains(":: StoryStylesheet [stylesheet]\nbody {}"));
    }

    #[test]
    fn exports_twine_html_preserving_source_pid_and_attrs() {
        let output =
            story_to_twine_html(&story(), &HtmlExportOptions::default()).expect("html exports");

        assert!(output.contains(r#"startnode="7""#));
        assert!(output.contains(r#"pid="7""#));
        assert!(output.contains(r#"data-extra="kept""#));
        assert!(output.contains("&lt;"));
    }

    #[test]
    fn can_bind_story_format_source() {
        let output = story_with_format_source(
            &story(),
            "{{STORY_NAME}} {{STORY_DATA}}",
            &HtmlExportOptions {
                start_optional: true,
                ..HtmlExportOptions::default()
            },
        )
        .expect("format binding exports");

        assert!(output.contains("Example"));
        assert!(output.contains("<tw-storydata"));
    }
}
