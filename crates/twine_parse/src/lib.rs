#![doc = "Twine and story-format parsing primitives."]

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct LinkParseOptions {
    pub internal_only: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ParsedLink {
    pub target: String,
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
}
