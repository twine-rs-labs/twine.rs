#![doc = "Twine, Twee, HTML, JSON, and story-format parsing primitives."]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use thiserror::Error;
use twine_model::{Passage, PassageId, Story, StoryId};

type MetadataMap = BTreeMap<String, Value>;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct LinkParseOptions {
    pub internal_only: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ParsedLink {
    pub target: String,
}

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("invalid Twee header: {0}")]
    InvalidTweeHeader(String),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn parse_standard_links(text: &str, options: LinkParseOptions) -> Vec<ParsedLink> {
    let mut cursor = 0;
    let mut links = Vec::new();
    let mut seen = HashSet::new();

    while let Some(start_offset) = text[cursor..].find("[[") {
        let content_start = cursor + start_offset + 2;
        let Some(end_offset) = text[content_start..].find("]]") else {
            break;
        };
        let content_end = content_start + end_offset;
        let tag_content = &text[content_start..content_end];
        let target = extract_link_target(remove_setter(tag_content)).trim();

        if !target.is_empty()
            && (!options.internal_only || is_internal_link(target))
            && seen.insert(target.to_owned())
        {
            links.push(ParsedLink {
                target: target.to_owned(),
            });
        }

        cursor = content_end + 2;
    }

    links
}

pub fn story_from_twee(source: &str) -> Result<Story, ParseError> {
    story_from_twee_named(source, "Untitled Story")
}

pub fn story_from_twee_named(source: &str, fallback_name: &str) -> Result<Story, ParseError> {
    let story_id = StoryId::new(stable_id("story", fallback_name, 0));
    let mut story = Story {
        id: story_id.clone(),
        ifid: stable_ifid(source),
        name: fallback_name.to_owned(),
        ..Story::default()
    };
    let mut story_data_start: Option<String> = None;
    let mut passages = Vec::new();

    for (index, section) in split_twee_sections(source).into_iter().enumerate() {
        let mut passage = passage_from_twee_section(&section, &story_id, index)?;

        match passage.name.as_str() {
            "StoryTitle" => {
                let title = passage.text.trim();

                if !title.is_empty() {
                    story.name = title.to_owned();
                }
            }
            "StoryData" => {
                apply_story_data(&mut story, &passage.text, &mut story_data_start)?;
            }
            _ if passage.tags.contains(&"script".to_owned())
                && !passage.tags.contains(&"stylesheet".to_owned()) =>
            {
                append_with_newline(&mut story.script, passage.text.trim());
            }
            _ if passage.tags.contains(&"stylesheet".to_owned())
                && !passage.tags.contains(&"script".to_owned()) =>
            {
                append_with_newline(&mut story.stylesheet, passage.text.trim());
            }
            _ => {
                passage.story = story_id.clone();
                passages.push(passage);
            }
        }
    }

    if let Some(start_name) = story_data_start {
        if let Some(start) = passages.iter().find(|passage| passage.name == start_name) {
            story.start_passage = start.id.clone();
        } else {
            story.metadata.insert(
                "unresolvedStartPassageName".into(),
                Value::String(start_name),
            );
        }
    }

    story.passages = passages.into();
    Ok(story)
}

pub fn stories_from_twine_html(source: &str) -> Result<Vec<Story>, ParseError> {
    let mut stories = find_elements(source, "tw-storydata")
        .into_iter()
        .enumerate()
        .map(|(index, element)| story_from_storydata_element(&element, index))
        .collect::<Result<Vec<_>, _>>()?;

    if stories.is_empty() {
        stories = stories_from_twine1_tiddler_html(source)?;
    }

    Ok(stories)
}

pub fn stories_from_json_interchange(source: &str) -> Result<Vec<Story>, ParseError> {
    let value: Value = serde_json::from_str(source)?;

    stories_from_json_value(value)
}

pub fn stories_from_local_storage_json(source: &str) -> Result<Vec<Story>, ParseError> {
    let value: Value = serde_json::from_str(source)?;

    stories_from_local_storage_value(&value)
}

fn remove_setter(link: &str) -> &str {
    link.split_once("][").map_or(link, |(before, _)| before)
}

fn extract_link_target(tag_content: &str) -> &str {
    if let Some(index) = tag_content.rfind("->") {
        return &tag_content[index + 2..];
    }

    if let Some(index) = tag_content.find("<-") {
        return &tag_content[..index];
    }

    if let Some(index) = tag_content.rfind('|') {
        return &tag_content[index + 1..];
    }

    tag_content
}

fn is_internal_link(link: &str) -> bool {
    let Some(colon_index) = link.find(':') else {
        return true;
    };
    let scheme = &link[..colon_index];

    if scheme.is_empty() || !scheme.chars().all(is_ascii_word) {
        return true;
    }

    let rest = &link[colon_index + 1..];
    let Some(after_slashes) = rest.strip_prefix("///").or_else(|| rest.strip_prefix("//")) else {
        return true;
    };

    !after_slashes.chars().next().is_some_and(is_ascii_word)
}

fn is_ascii_word(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '_'
}

#[derive(Clone, Debug)]
struct TweeSection {
    body: String,
    header: String,
}

fn split_twee_sections(source: &str) -> Vec<TweeSection> {
    let normalized = source.replace("\r\n", "\n").replace('\r', "\n");
    let mut sections = Vec::new();
    let mut current_header: Option<String> = None;
    let mut current_body = Vec::new();

    for line in normalized.lines() {
        if line.starts_with("::") {
            if let Some(header) = current_header.replace(line.to_owned()) {
                sections.push(TweeSection {
                    body: current_body.join("\n").trim().to_owned(),
                    header,
                });
                current_body.clear();
            }
        } else if current_header.is_some() {
            current_body.push(line.to_owned());
        }
    }

    if let Some(header) = current_header {
        sections.push(TweeSection {
            body: current_body.join("\n").trim().to_owned(),
            header,
        });
    }

    sections
}

fn passage_from_twee_section(
    section: &TweeSection,
    story_id: &StoryId,
    index: usize,
) -> Result<Passage, ParseError> {
    let (name, tags, metadata) = parse_twee_header(&section.header)?;
    let id = PassageId::new(stable_id(
        "passage",
        &format!("{}:{name}", story_id.as_ref()),
        index,
    ));
    let mut passage = Passage {
        id,
        name,
        story: story_id.clone(),
        tags,
        text: unescape_for_twee_text(&section.body),
        ..default_passage()
    };

    apply_passage_metadata(&mut passage, metadata);

    Ok(passage)
}

fn parse_twee_header(header: &str) -> Result<(String, Vec<String>, MetadataMap), ParseError> {
    let Some(rest) = header.strip_prefix("::") else {
        return Err(ParseError::InvalidTweeHeader(header.into()));
    };
    let mut rest = rest.trim().to_owned();
    let metadata = if rest.ends_with('}') {
        if let Some(index) = find_last_unescaped(&rest, '{') {
            let raw_metadata = rest[index..].trim();
            let parsed = serde_json::from_str(raw_metadata).unwrap_or(Value::Null);

            rest.truncate(index);
            match parsed {
                Value::Object(object) => object.into_iter().collect(),
                _ => BTreeMap::new(),
            }
        } else {
            BTreeMap::new()
        }
    } else {
        BTreeMap::new()
    };
    let mut tags = Vec::new();
    let rest_trimmed = rest.trim_end();

    if rest_trimmed.ends_with(']') {
        if let Some(index) = find_last_unescaped(rest_trimmed, '[') {
            let raw_tags = &rest_trimmed[index + 1..rest_trimmed.len() - 1];

            tags = raw_tags
                .split_whitespace()
                .map(unescape_for_twee_header)
                .collect();
            rest = rest_trimmed[..index].trim_end().to_owned();
        }
    }

    let name =
        unescape_for_twee_header(rest.trim().replace("\\ ", " ").trim_matches(char::from(0)));

    if name.trim().is_empty() {
        return Err(ParseError::InvalidTweeHeader(header.into()));
    }

    Ok((name, tags, metadata))
}

fn apply_story_data(
    story: &mut Story,
    source: &str,
    story_data_start: &mut Option<String>,
) -> Result<(), ParseError> {
    let Value::Object(data) = serde_json::from_str(source)? else {
        return Ok(());
    };
    let mut unknown = serde_json::Map::new();

    for (key, value) in data {
        match (key.as_str(), value) {
            ("ifid", Value::String(value)) => story.ifid = value,
            ("format", Value::String(value)) => story.story_format = value,
            ("format-version", Value::String(value)) => story.story_format_version = value,
            ("start", Value::String(value)) => *story_data_start = Some(value),
            ("tag-colors", Value::Object(colors)) => {
                for (tag, color) in colors {
                    if let Value::String(color) = color {
                        story.tag_colors.insert(tag, color);
                    } else {
                        story
                            .metadata
                            .insert(format!("invalidTagColor:{tag}"), color);
                    }
                }
            }
            ("zoom", Value::Number(value)) => {
                if let Some(zoom) = value.as_f64() {
                    story.zoom = zoom;
                }
            }
            (key, value) => {
                unknown.insert(key.to_owned(), value);
            }
        }
    }

    if !unknown.is_empty() {
        story
            .metadata
            .insert("storyData".into(), Value::Object(unknown));
    }

    Ok(())
}

fn apply_passage_metadata(passage: &mut Passage, metadata: BTreeMap<String, Value>) {
    for (key, value) in metadata {
        match (key.as_str(), value) {
            ("position", Value::String(value)) => {
                if let Some((left, top)) = parse_pair(&value) {
                    let mut layout = passage.layout.unwrap_or_default();

                    layout.left = left;
                    layout.top = top;
                    passage.layout = Some(layout);
                } else {
                    passage.metadata.insert(key, Value::String(value));
                }
            }
            ("size", Value::String(value)) => {
                if let Some((width, height)) = parse_pair(&value) {
                    let mut layout = passage.layout.unwrap_or_default();

                    layout.width = width;
                    layout.height = height;
                    passage.layout = Some(layout);
                } else {
                    passage.metadata.insert(key, Value::String(value));
                }
            }
            (key, value) => {
                passage.metadata.insert(key.to_owned(), value);
            }
        }
    }
}

fn parse_pair(value: &str) -> Option<(f64, f64)> {
    let (left, right) = value.split_once(',')?;
    let left = left.trim().parse().ok()?;
    let right = right.trim().parse().ok()?;

    Some((left, right))
}

fn append_with_newline(target: &mut String, value: &str) {
    if value.is_empty() {
        return;
    }

    if !target.is_empty() {
        target.push('\n');
    }

    target.push_str(value);
}

#[derive(Clone, Debug)]
struct HtmlElement {
    attrs: BTreeMap<String, String>,
    inner: String,
}

fn story_from_storydata_element(element: &HtmlElement, index: usize) -> Result<Story, ParseError> {
    let name = element
        .attrs
        .get("name")
        .cloned()
        .unwrap_or_else(|| "Untitled Story".into());
    let story_id = StoryId::new(stable_id("story", &name, index));
    let mut story = Story {
        id: story_id.clone(),
        ifid: element
            .attrs
            .get("ifid")
            .cloned()
            .unwrap_or_else(|| stable_ifid(&element.inner)),
        name,
        story_format: element.attrs.get("format").cloned().unwrap_or_default(),
        story_format_version: element
            .attrs
            .get("format-version")
            .cloned()
            .unwrap_or_default(),
        format_options: element.attrs.get("options").cloned().unwrap_or_default(),
        tags: split_tags(element.attrs.get("tags").map(String::as_str).unwrap_or("")),
        zoom: element
            .attrs
            .get("zoom")
            .and_then(|value| value.parse().ok())
            .unwrap_or(1.0),
        custom_attributes: custom_attrs(
            &element.attrs,
            &[
                "format",
                "format-version",
                "ifid",
                "name",
                "options",
                "startnode",
                "tags",
                "zoom",
            ],
        ),
        ..Story::default()
    };

    for style in find_elements(&element.inner, "style") {
        if is_role(&style, "stylesheet")
            || style
                .attrs
                .get("id")
                .is_some_and(|id| id == "twine-user-stylesheet")
        {
            append_with_newline(
                &mut story.stylesheet,
                decode_html_entities(&style.inner).trim(),
            );
        }
    }

    for script in find_elements(&element.inner, "script") {
        if is_role(&script, "script")
            || script
                .attrs
                .get("id")
                .is_some_and(|id| id == "twine-user-script")
        {
            append_with_newline(
                &mut story.script,
                decode_html_entities(&script.inner).trim(),
            );
        }
    }

    for tag in find_elements(&element.inner, "tw-tag") {
        if let (Some(name), Some(color)) = (tag.attrs.get("name"), tag.attrs.get("color")) {
            story.tag_colors.insert(name.clone(), color.clone());
        }
    }

    let startnode = element.attrs.get("startnode").cloned();

    for (passage_index, passage_element) in find_elements(&element.inner, "tw-passagedata")
        .into_iter()
        .enumerate()
    {
        let mut passage =
            passage_from_passagedata_element(&passage_element, &story_id, passage_index);

        if passage
            .source_pid
            .as_ref()
            .zip(startnode.as_ref())
            .is_some_and(|(pid, startnode)| pid == startnode)
        {
            story.start_passage = passage.id.clone();
        }

        passage.story = story_id.clone();
        story.passages.push(passage);
    }

    Ok(story)
}

fn passage_from_passagedata_element(
    element: &HtmlElement,
    story_id: &StoryId,
    index: usize,
) -> Passage {
    let name = element
        .attrs
        .get("name")
        .cloned()
        .unwrap_or_else(|| format!("Untitled Passage {}", index + 1));
    let mut passage = Passage {
        custom_attributes: custom_attrs(
            &element.attrs,
            &["name", "pid", "position", "size", "tags"],
        ),
        id: PassageId::new(stable_id(
            "passage",
            &format!("{}:{name}", story_id.as_ref()),
            index,
        )),
        name,
        source_pid: element.attrs.get("pid").cloned(),
        story: story_id.clone(),
        tags: split_tags(element.attrs.get("tags").map(String::as_str).unwrap_or("")),
        text: decode_html_entities(&element.inner),
        ..default_passage()
    };

    if let Some((left, top)) = element
        .attrs
        .get("position")
        .and_then(|value| parse_pair(value))
    {
        let mut layout = passage.layout.unwrap_or_default();

        layout.left = left;
        layout.top = top;
        passage.layout = Some(layout);
    }

    if let Some((width, height)) = element
        .attrs
        .get("size")
        .and_then(|value| parse_pair(value))
    {
        let mut layout = passage.layout.unwrap_or_default();

        layout.width = width;
        layout.height = height;
        passage.layout = Some(layout);
    }

    passage
}

fn stories_from_twine1_tiddler_html(source: &str) -> Result<Vec<Story>, ParseError> {
    let mut tiddlers = find_elements(source, "div")
        .into_iter()
        .filter(|element| element.attrs.contains_key("tiddler"))
        .collect::<Vec<_>>();

    if tiddlers.is_empty() {
        return Ok(Vec::new());
    }

    let title = find_title(source)
        .or_else(|| {
            tiddlers
                .iter()
                .find(|element| {
                    element
                        .attrs
                        .get("tiddler")
                        .is_some_and(|name| name == "StoryTitle")
                })
                .map(|element| decode_html_entities(&element.inner).trim().to_owned())
        })
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| "Imported Twine 1 Story".into());
    let story_id = StoryId::new(stable_id("story", &title, 0));
    let mut story = Story {
        id: story_id.clone(),
        ifid: stable_ifid(source),
        name: title,
        story_format: "Twine 1".into(),
        ..Story::default()
    };

    tiddlers.sort_by(|left, right| {
        left.attrs
            .get("tiddler")
            .cmp(&right.attrs.get("tiddler"))
            .then_with(|| left.inner.cmp(&right.inner))
    });

    for (index, element) in tiddlers.into_iter().enumerate() {
        let Some(name) = element.attrs.get("tiddler") else {
            continue;
        };

        if name == "StoryTitle" {
            continue;
        }

        let mut passage = Passage {
            custom_attributes: custom_attrs(&element.attrs, &["tags", "tiddler"]),
            id: PassageId::new(stable_id(
                "passage",
                &format!("{}:{name}", story_id.as_ref()),
                index,
            )),
            name: name.clone(),
            story: story_id.clone(),
            tags: split_tags(element.attrs.get("tags").map(String::as_str).unwrap_or("")),
            text: decode_html_entities(&element.inner),
            ..default_passage()
        };

        for (key, value) in &element.attrs {
            if matches!(key.as_str(), "created" | "modified" | "modifier") {
                passage
                    .metadata
                    .insert(key.clone(), Value::String(value.clone()));
            }
        }

        story.passages.push(passage);
    }

    if let Some(first) = story.passages.first() {
        story.start_passage = first.id.clone();
    }

    Ok(vec![story])
}

fn find_elements(source: &str, tag: &str) -> Vec<HtmlElement> {
    let lower = source.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut cursor = 0;
    let mut elements = Vec::new();

    while let Some(offset) = lower[cursor..].find(&open) {
        let start = cursor + offset;

        if lower[start + open.len()..]
            .chars()
            .next()
            .is_some_and(|value| !value.is_whitespace() && value != '>' && value != '/')
        {
            cursor = start + open.len();
            continue;
        }

        let Some(tag_end) = find_tag_end(source, start) else {
            break;
        };
        let raw_tag = &source[start + open.len()..tag_end];
        let attrs = parse_attrs(raw_tag.trim_end_matches('/'));

        if raw_tag.trim_end().ends_with('/') {
            elements.push(HtmlElement {
                attrs,
                inner: String::new(),
            });
            cursor = tag_end + 1;
            continue;
        }

        let content_start = tag_end + 1;
        let Some(close_offset) = lower[content_start..].find(&close) else {
            elements.push(HtmlElement {
                attrs,
                inner: String::new(),
            });
            cursor = content_start;
            continue;
        };
        let content_end = content_start + close_offset;

        elements.push(HtmlElement {
            attrs,
            inner: source[content_start..content_end].to_owned(),
        });
        cursor = content_end + close.len();
    }

    elements
}

fn find_tag_end(source: &str, start: usize) -> Option<usize> {
    let mut quote: Option<char> = None;

    for (offset, value) in source[start..].char_indices() {
        match (quote, value) {
            (Some(current), value) if value == current => quote = None,
            (None, '"' | '\'') => quote = Some(value),
            (None, '>') => return Some(start + offset),
            _ => {}
        }
    }

    None
}

fn parse_attrs(source: &str) -> BTreeMap<String, String> {
    let mut attrs = BTreeMap::new();
    let bytes = source.as_bytes();
    let mut cursor = 0;

    while cursor < bytes.len() {
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }

        if cursor >= bytes.len() {
            break;
        }

        let key_start = cursor;
        while cursor < bytes.len()
            && !bytes[cursor].is_ascii_whitespace()
            && bytes[cursor] != b'='
            && bytes[cursor] != b'/'
        {
            cursor += 1;
        }
        let key = source[key_start..cursor].to_ascii_lowercase();

        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }

        if cursor >= bytes.len() || bytes[cursor] != b'=' {
            attrs.insert(key, String::new());
            continue;
        }

        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }

        if cursor >= bytes.len() {
            attrs.insert(key, String::new());
            break;
        }

        let value = if bytes[cursor] == b'"' || bytes[cursor] == b'\'' {
            let quote = bytes[cursor];
            cursor += 1;
            let value_start = cursor;

            while cursor < bytes.len() && bytes[cursor] != quote {
                cursor += 1;
            }

            let value = source[value_start..cursor].to_owned();
            cursor += usize::from(cursor < bytes.len());
            value
        } else {
            let value_start = cursor;

            while cursor < bytes.len() && !bytes[cursor].is_ascii_whitespace() {
                cursor += 1;
            }

            source[value_start..cursor].to_owned()
        };

        attrs.insert(key, decode_html_entities(&value));
    }

    attrs
}

fn stories_from_json_value(value: Value) -> Result<Vec<Story>, ParseError> {
    match value {
        Value::Array(values) => values
            .into_iter()
            .map(serde_json::from_value)
            .collect::<Result<Vec<Story>, _>>()
            .map_err(ParseError::Json),
        Value::Object(object) if object.contains_key("twine-stories") => {
            stories_from_local_storage_value(&Value::Object(object))
        }
        Value::Object(mut object) => {
            if let Some(stories) = object.remove("stories") {
                stories_from_json_value(stories)
            } else if let Some(story) = object.remove("story") {
                stories_from_json_value(Value::Array(vec![story]))
            } else {
                serde_json::from_value(Value::Object(object))
                    .map(|story| vec![story])
                    .map_err(ParseError::Json)
            }
        }
        other => serde_json::from_value(other)
            .map(|story| vec![story])
            .map_err(ParseError::Json),
    }
}

fn stories_from_local_storage_value(value: &Value) -> Result<Vec<Story>, ParseError> {
    let Some(object) = value.as_object() else {
        return Ok(Vec::new());
    };
    let story_ids = local_storage_string(object, "twine-stories")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let passage_ids = local_storage_string(object, "twine-passages")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut stories = BTreeMap::<String, Story>::new();

    for id in story_ids {
        let key = format!("twine-stories-{id}");
        let Some(raw) = local_storage_raw_json(object, &key) else {
            continue;
        };
        let mut story: Story = serde_json::from_str(&raw)?;

        story.passages.clear();
        stories.insert(story.id.as_ref().to_owned(), story);
    }

    for id in passage_ids {
        let key = format!("twine-passages-{id}");
        let Some(raw) = local_storage_raw_json(object, &key) else {
            continue;
        };
        let passage: Passage = serde_json::from_str(&raw)?;

        if let Some(story) = stories.get_mut(passage.story.as_ref()) {
            story.passages.push(passage);
        }
    }

    Ok(stories.into_values().collect())
}

fn local_storage_string(object: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    match object.get(key) {
        Some(Value::String(value)) => Some(value.clone()),
        Some(value) => Some(value.to_string()),
        None => None,
    }
}

fn local_storage_raw_json(object: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    match object.get(key) {
        Some(Value::String(value)) => Some(value.clone()),
        Some(value) => Some(value.to_string()),
        None => None,
    }
}

fn is_role(element: &HtmlElement, role: &str) -> bool {
    element
        .attrs
        .get("role")
        .is_some_and(|value| value.eq_ignore_ascii_case(role))
}

fn split_tags(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .filter(|tag| !tag.trim().is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn custom_attrs(attrs: &BTreeMap<String, String>, known: &[&str]) -> BTreeMap<String, String> {
    attrs
        .iter()
        .filter(|(key, _)| !known.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn find_last_unescaped(value: &str, needle: char) -> Option<usize> {
    let mut escaped = false;
    let mut found = None;

    for (index, character) in value.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }

        if character == '\\' {
            escaped = true;
            continue;
        }

        if character == needle {
            found = Some(index);
        }
    }

    found
}

pub fn escape_for_twee_header(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
        .replace('{', "\\{")
        .replace('}', "\\}")
}

pub fn unescape_for_twee_header(value: &str) -> String {
    let mut result = String::new();
    let mut chars = value.chars();

    while let Some(character) = chars.next() {
        if character == '\\' {
            if let Some(next) = chars.next() {
                result.push(next);
            }
        } else {
            result.push(character);
        }
    }

    result
}

pub fn escape_for_twee_text(value: &str) -> String {
    value
        .replace("\n::", "\n\\::")
        .strip_prefix("::")
        .map_or_else(
            || value.replace("\n::", "\n\\::"),
            |rest| format!("\\::{rest}"),
        )
}

pub fn unescape_for_twee_text(value: &str) -> String {
    value
        .replace("\n\\::", "\n::")
        .strip_prefix("\\::")
        .map_or_else(|| value.to_owned(), |rest| format!("::{rest}"))
}

fn decode_html_entities(value: &str) -> String {
    let mut result = String::new();
    let mut cursor = 0;

    while let Some(offset) = value[cursor..].find('&') {
        let entity_start = cursor + offset;

        result.push_str(&value[cursor..entity_start]);

        let Some(end_offset) = value[entity_start..].find(';') else {
            result.push_str(&value[entity_start..]);
            return result;
        };
        let entity_end = entity_start + end_offset;
        let entity = &value[entity_start + 1..entity_end];

        match entity {
            "amp" => result.push('&'),
            "lt" => result.push('<'),
            "gt" => result.push('>'),
            "quot" => result.push('"'),
            "apos" | "#39" => result.push('\''),
            _ if entity.starts_with("#x") => {
                if let Ok(value) = u32::from_str_radix(&entity[2..], 16) {
                    if let Some(character) = char::from_u32(value) {
                        result.push(character);
                    }
                }
            }
            _ if entity.starts_with('#') => {
                if let Ok(value) = entity[1..].parse::<u32>() {
                    if let Some(character) = char::from_u32(value) {
                        result.push(character);
                    }
                }
            }
            _ => {
                result.push('&');
                result.push_str(entity);
                result.push(';');
            }
        }

        cursor = entity_end + 1;
    }

    result.push_str(&value[cursor..]);
    result
}

fn find_title(source: &str) -> Option<String> {
    find_elements(source, "title")
        .into_iter()
        .next()
        .map(|element| decode_html_entities(&element.inner).trim().to_owned())
}

fn default_passage() -> Passage {
    Passage {
        custom_attributes: BTreeMap::new(),
        id: PassageId::new(""),
        layout: None,
        metadata: BTreeMap::new(),
        name: String::new(),
        source_pid: None,
        story: StoryId::new(""),
        tags: Vec::new(),
        text: String::new(),
    }
}

fn stable_id(prefix: &str, seed: &str, index: usize) -> String {
    let slug = slugify(seed);
    let hash = stable_hash(&format!("{prefix}:{seed}:{index}"));

    format!("{prefix}-{slug}-{hash:08x}")
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();

    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }

        if slug.len() >= 40 {
            break;
        }
    }

    let slug = slug.trim_matches('-');

    if slug.is_empty() {
        "item".into()
    } else {
        slug.into()
    }
}

fn stable_ifid(seed: &str) -> String {
    let a = stable_hash(seed);
    let b = stable_hash(&format!("ifid:{seed}"));

    format!(
        "{:08X}-{:04X}-4{:03X}-8{:03X}-{:012X}",
        (a >> 32) as u32,
        (a >> 16) as u16,
        a & 0x0fff,
        (b >> 48) & 0x0fff,
        b & 0x0000_ffff_ffff
    )
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;

    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }

    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets(text: &str) -> Vec<String> {
        parse_standard_links(text, LinkParseOptions::default())
            .into_iter()
            .map(|link| link.target)
            .collect()
    }

    #[test]
    fn parses_standard_twine_links() {
        assert_eq!(targets("[[link]]"), ["link"]);
        assert_eq!(targets("[[display|link]]"), ["link"]);
        assert_eq!(targets("[[display->link]]"), ["link"]);
        assert_eq!(targets("[[link<-display]]"), ["link"]);
        assert_eq!(targets("[[link][setter]]"), ["link"]);
    }

    #[test]
    fn preserves_first_seen_order_and_removes_duplicates() {
        assert_eq!(targets("[[b]][[a]][[b]]"), ["b", "a"]);
    }

    #[test]
    fn can_filter_external_links() {
        let links = parse_standard_links(
            "[[local]] [[https://example.com]]",
            LinkParseOptions {
                internal_only: true,
            },
        );

        assert_eq!(
            links,
            [ParsedLink {
                target: "local".into()
            }]
        );
    }

    #[test]
    fn parses_twee_story_data_and_fallback_title() {
        let story = story_from_twee_named(
            r#":: Start [hub] {"position":"25,50","size":"150,175","unknown":true}
Hello [[Next]]

:: StoryData
{"ifid":"IFID","format":"Harlowe","format-version":"3.3.9","start":"Start","tag-colors":{"hub":"green"},"extra":1}
"#,
            "file-name",
        )
        .expect("twee should parse");

        assert_eq!(story.name, "file-name");
        assert_eq!(story.ifid, "IFID");
        assert_eq!(story.story_format, "Harlowe");
        assert_eq!(story.start_passage, story.passages[0].id);
        let layout = story.passages[0].layout.expect("position metadata");
        assert_eq!(layout.left, 25.0);
        assert_eq!(layout.height, 175.0);
        assert_eq!(story.passages[0].metadata["unknown"], Value::Bool(true));
        assert_eq!(
            story.metadata["storyData"]["extra"],
            Value::Number(1.into())
        );
    }

    #[test]
    fn parses_script_stylesheet_without_inventing_layout() {
        let story = story_from_twee(
            r#":: StoryTitle
Example

:: 0
zero

:: 1
one

:: StoryScript [script]
alert(1)

:: StoryStylesheet [stylesheet]
body {}
"#,
        )
        .expect("twee should parse");

        assert_eq!(story.name, "Example");
        assert_eq!(story.script, "alert(1)");
        assert_eq!(story.stylesheet, "body {}");
        assert!(story.passages[0].layout.is_none());
        assert!(story.passages[1].layout.is_none());
    }

    #[test]
    fn parses_twine_html_storydata() {
        let html = r#"
<tw-storydata name="Test" startnode="1" zoom="1.5" creator="Twine" creator-version="2.0.11" ifid="IFID" format="SugarCube" options="debug" hidden>
<tw-tag name="my-tag" color="purple" />
<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">* { color: red }</style>
<script role="script" id="twine-user-script" type="text/twine-javascript">alert('hi');</script>
<tw-passagedata pid="1" name="Untitled Passage" tags="foo bar" position="450,250" size="100,100" data-extra="kept">This is &lt;&lt;text&gt;&gt;.</tw-passagedata>
</tw-storydata>
"#;
        let stories = stories_from_twine_html(html).expect("html should parse");

        assert_eq!(stories.len(), 1);
        assert_eq!(stories[0].name, "Test");
        assert_eq!(stories[0].ifid, "IFID");
        assert_eq!(stories[0].format_options, "debug");
        assert_eq!(stories[0].custom_attributes["creator"], "Twine");
        assert_eq!(stories[0].passages[0].text, "This is <<text>>.");
        assert_eq!(stories[0].passages[0].source_pid.as_deref(), Some("1"));
        assert_eq!(
            stories[0].passages[0].layout.expect("html layout").left,
            450.0
        );
        assert_eq!(
            stories[0].passages[0].custom_attributes["data-extra"],
            "kept"
        );
        assert_eq!(stories[0].start_passage, stories[0].passages[0].id);
    }

    #[test]
    fn parses_json_and_local_storage_shapes() {
        let local_storage = r#"{
            "twine-stories": "story-1",
            "twine-passages": "passage-1",
            "twine-stories-story-1": "{\"id\":\"story-1\",\"name\":\"Example\"}",
            "twine-passages-passage-1": "{\"id\":\"passage-1\",\"name\":\"Start\",\"story\":\"story-1\",\"text\":\"Hi\"}"
        }"#;
        let stories =
            stories_from_json_interchange(local_storage).expect("local storage should parse");

        assert_eq!(stories.len(), 1);
        assert_eq!(stories[0].passages.len(), 1);
        assert_eq!(stories[0].passages[0].name, "Start");
    }
}
