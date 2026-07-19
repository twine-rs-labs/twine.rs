#![doc = "Export interfaces for story and project data."]

use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};
use thiserror::Error;
use twine_model::{Passage, PassageId, Story};
use twine_parse::{escape_for_twee_header, escape_for_twee_text, passages_from_twee};

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
    pub include_story_graph: bool,
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
            include_story_graph: false,
            preserve_source_pids: true,
            start_id: None,
            start_optional: false,
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TweeExportOptions {
    pub include_story_graph: bool,
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

/// Updates a standard Twee story source while retaining original bytes for
/// modeled sections whose contents have not changed.
///
/// `previous_passage_names` identifies sections written by the prior save.
/// Unmatched prior modeled sections are removed, while unrelated custom
/// sections that were not in the prior manifest are retained.
pub fn merge_story_into_twee(
    existing_source: &str,
    story: &Story,
    previous_passage_names: &[String],
) -> Result<String, ExportError> {
    let ranges = twee_section_ranges(existing_source);

    if ranges.is_empty() {
        return story_source_to_twee(story);
    }

    let source_story_id = twine_model::StoryId::new("source");
    let existing_passages = ranges
        .iter()
        .map(|(start, end)| {
            passages_from_twee(&existing_source[*start..*end], &source_story_id)
                .ok()
                .and_then(|mut passages| passages.pop())
        })
        .collect::<Vec<_>>();
    let mut passage_used = vec![false; story.passages.len()];
    let mut previous_used = vec![false; previous_passage_names.len()];
    let mut saw_story_title = false;
    let mut saw_story_data = false;

    let mut output = String::with_capacity(existing_source.len());
    let first_start = ranges[0].0;

    output.push_str(&existing_source[..first_start]);
    if !existing_passages
        .iter()
        .flatten()
        .any(|passage| passage.name == "StoryTitle")
    {
        append_twee_section(&mut output, &story_title_to_twee(story));
    }
    if !existing_passages
        .iter()
        .flatten()
        .any(|passage| passage.name == "StoryData")
    {
        append_twee_section(&mut output, &story_data_to_twee(story)?);
    }

    for (section_index, (start, end)) in ranges.iter().copied().enumerate() {
        let raw = &existing_source[start..end];
        let Some(existing) = existing_passages[section_index].as_ref() else {
            output.push_str(raw);
            continue;
        };

        if existing.name == "StoryTitle" && !saw_story_title {
            saw_story_title = true;
            if existing.text.trim() == story.name {
                output.push_str(raw);
            } else {
                let mut title = existing.clone();

                title.text = story.name.clone();
                rewrite_twee_section(&mut output, raw, &passage_to_twee(&title)?);
            }
            continue;
        }

        if existing.name == "StoryData" && !saw_story_data {
            saw_story_data = true;
            let expected = merged_story_data(existing, story);
            let unchanged =
                serde_json::from_str::<Value>(&existing.text).is_ok_and(|value| value == expected);

            if unchanged {
                output.push_str(raw);
            } else {
                rewrite_twee_section(&mut output, raw, &story_data_value_to_twee(&expected)?);
            }
            continue;
        }

        if existing
            .tags
            .iter()
            .any(|tag| tag == "script" || tag == "stylesheet")
        {
            output.push_str(raw);
            continue;
        }

        let previous_index = previous_passage_names
            .iter()
            .enumerate()
            .find(|(index, name)| !previous_used[*index] && **name == existing.name)
            .map(|(index, _)| index);

        let Some(previous_index) = previous_index else {
            let current_index = story
                .passages
                .iter()
                .enumerate()
                .find(|(index, passage)| !passage_used[*index] && passage.name == existing.name)
                .map(|(index, _)| index);

            if let Some(current_index) = current_index {
                passage_used[current_index] = true;
                let passage = &story.passages[current_index];

                if twee_passage_contents_equal(existing, passage) {
                    output.push_str(raw);
                } else {
                    rewrite_twee_section(
                        &mut output,
                        raw,
                        &passage_to_twee_preserving_unknown(existing, passage)?,
                    );
                }
            } else {
                output.push_str(raw);
            }
            continue;
        };
        previous_used[previous_index] = true;

        let passage_index = story
            .passages
            .iter()
            .enumerate()
            .find(|(index, passage)| !passage_used[*index] && passage.name == existing.name)
            .map(|(index, _)| index)
            .or_else(|| {
                story
                    .passages
                    .get_at(previous_index)
                    .filter(|_| !passage_used[previous_index])
                    .map(|_| previous_index)
            });
        let Some(passage_index) = passage_index else {
            continue;
        };
        passage_used[passage_index] = true;
        let passage = &story.passages[passage_index];

        if twee_passage_contents_equal(existing, passage) {
            output.push_str(raw);
        } else {
            rewrite_twee_section(
                &mut output,
                raw,
                &passage_to_twee_preserving_unknown(existing, passage)?,
            );
        }
    }

    for (index, passage) in story.passages.iter().enumerate() {
        if passage_used[index] {
            continue;
        }
        append_twee_section(&mut output, &passage_to_twee(passage)?);
    }

    Ok(output)
}

pub fn story_source_to_twee(story: &Story) -> Result<String, ExportError> {
    let mut output = String::new();

    output.push_str(&story_title_to_twee(story));
    output.push_str("\n\n");
    output.push_str(&story_data_to_twee(story)?);
    for passage in &story.passages {
        append_twee_section(&mut output, &passage_to_twee(passage)?);
    }

    Ok(output)
}

fn story_title_to_twee(story: &Story) -> String {
    format!(":: StoryTitle\n{}\n", escape_for_twee_text(&story.name))
}

fn story_data_to_twee(story: &Story) -> Result<String, ExportError> {
    story_data_value_to_twee(&story_data_for_twee(story, false))
}

fn story_data_value_to_twee(story_data: &Value) -> Result<String, ExportError> {
    Ok(format!(
        ":: StoryData\n{}\n",
        serde_json::to_string_pretty(story_data)?
    ))
}

fn merged_story_data(existing: &Passage, story: &Story) -> Value {
    let mut expected = story_data_for_twee(story, false);

    if let (Value::Object(expected), Ok(Value::Object(existing))) =
        (&mut expected, serde_json::from_str::<Value>(&existing.text))
    {
        for (key, value) in existing {
            expected.entry(key).or_insert(value);
        }
    }

    expected
}

fn passage_to_twee_preserving_unknown(
    existing: &Passage,
    passage: &Passage,
) -> Result<String, ExportError> {
    let mut passage = passage.clone();

    if passage.layout.is_none() {
        passage.layout = existing.layout;
    }
    for (key, value) in &existing.metadata {
        passage
            .metadata
            .entry(key.clone())
            .or_insert_with(|| value.clone());
    }

    passage_to_twee(&passage)
}

fn append_twee_section(output: &mut String, section: &str) {
    if !output.is_empty() && !output.ends_with('\n') {
        output.push('\n');
    }
    if !output.trim_end().is_empty() {
        output.push_str("\n\n");
    }
    output.push_str(section);
}

fn rewrite_twee_section(output: &mut String, raw: &str, rewritten: &str) {
    let trailing_start = raw.trim_end_matches(char::is_whitespace).len();
    let trailing = &raw[trailing_start..];

    output.push_str(rewritten.trim_end_matches(char::is_whitespace));
    output.push_str(if trailing.is_empty() { "\n" } else { trailing });
}

fn twee_passage_contents_equal(left: &Passage, right: &Passage) -> bool {
    left.layout == right.layout
        && left.metadata == right.metadata
        && left.name == right.name
        && left.tags == right.tags
        && left.text == right.text
}

fn twee_section_ranges(source: &str) -> Vec<(usize, usize)> {
    let mut starts = Vec::new();
    let mut offset = 0;

    for line in source.split_inclusive('\n') {
        if line.starts_with("::") {
            starts.push(offset);
        }
        offset += line.len();
    }
    if offset < source.len() && source[offset..].starts_with("::") {
        starts.push(offset);
    }

    starts
        .iter()
        .enumerate()
        .map(|(index, start)| {
            (
                *start,
                starts.get(index + 1).copied().unwrap_or(source.len()),
            )
        })
        .collect()
}

pub fn story_to_twee(story: &Story) -> Result<String, ExportError> {
    story_to_twee_with_options(story, &TweeExportOptions::default())
}

pub fn story_to_twee_with_options(
    story: &Story,
    options: &TweeExportOptions,
) -> Result<String, ExportError> {
    let mut output = String::new();

    output.push_str(":: StoryTitle\n");
    output.push_str(&escape_for_twee_text(&story.name));
    output.push_str("\n\n\n:: StoryData\n");
    output.push_str(&serde_json::to_string_pretty(&story_data_for_twee(
        story,
        options.include_story_graph,
    ))?);
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

    if options.include_story_graph {
        attrs.insert(
            "data-twine-rs-story-graph".into(),
            serde_json::to_string(&story_graph_metadata(story))?,
        );
    }

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

fn story_data_for_twee(story: &Story, include_story_graph: bool) -> Value {
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

    if include_story_graph {
        let mut twine_rs = data
            .remove("twine.rs")
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();

        twine_rs.insert("storyGraph".into(), story_graph_metadata(story));
        data.insert("twine.rs".into(), Value::Object(twine_rs));
    }

    Value::Object(data)
}

fn story_graph_metadata(story: &Story) -> Value {
    let mut passages = Map::new();
    let mut sorted_passages = story.passages.iter().collect::<Vec<_>>();

    sorted_passages.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.id.as_ref().cmp(right.id.as_ref()))
    });

    for passage in sorted_passages {
        if let Some(bounds) = passage.layout {
            passages.insert(
                passage.id.to_string(),
                json!({
                    "bounds": {
                        "height": bounds.height,
                        "left": bounds.left,
                        "top": bounds.top,
                        "width": bounds.width
                    },
                    "id": passage.id,
                    "name": passage.name,
                    "tags": passage.tags
                }),
            );
        }
    }

    json!({
        "compatibility": {
            "passagePositions": "mirrored-to-standard-metadata",
            "precedence": "storydata-over-passage-position-metadata"
        },
        "graph": {
            "annotations": {},
            "groups": {},
            "metadata": {},
            "passages": passages,
            "savedLayouts": {}
        },
        "kind": "storyGraph",
        "schema": "twine.rs/story-graph/v1",
        "storyId": story.id
    })
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
        assert!(!output.contains(r#""twine.rs""#));
        assert!(output.contains(r#""unknown":true"#));
        assert!(output.contains(":: StoryScript [script]\nalert(1)"));
        assert!(output.contains(":: StoryStylesheet [stylesheet]\nbody {}"));
    }

    #[test]
    fn aggregate_story_merge_preserves_unrelated_sections_and_removes_deleted_passages() {
        let mut story = story();
        let story_data =
            serde_json::to_string(&story_data_for_twee(&story, false)).expect("story data");
        let start = story
            .passages
            .get_mut(&PassageId::new("passage-1"))
            .expect("start passage");

        start.name = "Beginning".into();
        start.text = "Changed body".into();
        story.name = "Renamed Example".into();
        story.metadata.clear();
        let existing = format!(
            "preamble\n:: StoryTitle {{\"owner\":\"external\"}}\nExample\n\n:: StoryData\n{story_data}\n\n\
             :: Start [hub] {{\"unknown\":true}}\nOld body\n\n\
             :: Tool Notes {{\"owner\":\"external\"}}\nKeep exactly  \n\n\
             :: Legacy Script [script]\nwindow.external = true;\n\n\
             :: Deleted\nRemove me\n"
        );
        let output = merge_story_into_twee(&existing, &story, &["Start".into(), "Deleted".into()])
            .expect("aggregate source should merge");

        assert!(output.contains(":: StoryTitle {\"owner\":\"external\"}\nRenamed Example"));
        assert!(output.contains(r#""start": "Beginning""#));
        assert!(output.contains(r#""extra": 1"#));
        assert!(output.contains(":: Beginning [hub] {"));
        assert!(output.contains(r#""unknown":true"#));
        assert!(output.contains("Changed body"));
        assert!(output.contains(":: Tool Notes {\"owner\":\"external\"}\nKeep exactly  "));
        assert!(output.contains(":: Legacy Script [script]\nwindow.external = true;"));
        assert!(!output.contains(":: Deleted"));
        assert!(!output.contains(":: Start [hub]"));
        assert!(!output.contains("Old body"));
    }

    #[test]
    fn exports_story_graph_metadata_inside_story_data_when_requested() {
        let output = story_to_twee_with_options(
            &story(),
            &TweeExportOptions {
                include_story_graph: true,
            },
        )
        .expect("twee should export");

        assert!(output.contains(r#""twine.rs": {"#));
        assert!(output.contains(r#""schema": "twine.rs/story-graph/v1""#));
        assert!(output.contains(r#""passagePositions": "mirrored-to-standard-metadata""#));
    }

    #[test]
    fn exports_twine_html_preserving_source_pid_and_attrs() {
        let output =
            story_to_twine_html(&story(), &HtmlExportOptions::default()).expect("html exports");

        assert!(output.contains(r#"startnode="7""#));
        assert!(output.contains(r#"pid="7""#));
        assert!(output.contains(r#"data-extra="kept""#));
        assert!(!output.contains("data-twine-rs-story-graph"));
        assert!(output.contains("&lt;"));
    }

    #[test]
    fn exports_story_graph_metadata_on_storydata_html_when_requested() {
        let output = story_to_twine_html(
            &story(),
            &HtmlExportOptions {
                include_story_graph: true,
                ..HtmlExportOptions::default()
            },
        )
        .expect("html exports");

        assert!(output.contains("data-twine-rs-story-graph="));
        assert!(output.contains("twine.rs/story-graph/v1"));
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
