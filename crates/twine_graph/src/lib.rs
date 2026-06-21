#![doc = "Incremental story graph indexing primitives."]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use twine_model::{PassageId, Story};
use twine_parse::{LinkParseOptions, parse_standard_links};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LinkEdge {
    pub source: PassageId,
    pub target: Option<PassageId>,
    pub target_name: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BrokenLink {
    pub source: PassageId,
    pub target_name: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct GraphStats {
    pub broken_links: usize,
    pub links: usize,
    pub passages: usize,
    pub resolved_links: usize,
    pub self_links: usize,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct GraphIndex {
    backlinks: HashMap<PassageId, Vec<PassageId>>,
    broken_links: Vec<BrokenLink>,
    outgoing: HashMap<PassageId, Vec<LinkEdge>>,
    passage_names: HashMap<String, PassageId>,
    self_links: Vec<PassageId>,
    stats: GraphStats,
}

impl GraphIndex {
    pub fn from_story(story: &Story) -> Self {
        let passage_names = story
            .passages
            .iter()
            .map(|passage| (passage.name.clone(), passage.id.clone()))
            .collect::<HashMap<_, _>>();
        let mut graph = Self {
            passage_names,
            stats: GraphStats {
                passages: story.passage_count(),
                ..GraphStats::default()
            },
            ..Self::default()
        };

        for passage in &story.passages {
            let links = parse_standard_links(
                &passage.text,
                LinkParseOptions {
                    internal_only: true,
                },
            );

            for link in links {
                graph.stats.links += 1;

                if link.target == passage.name {
                    graph.stats.self_links += 1;
                    graph.self_links.push(passage.id.clone());
                    graph
                        .outgoing
                        .entry(passage.id.clone())
                        .or_default()
                        .push(LinkEdge {
                            source: passage.id.clone(),
                            target: Some(passage.id.clone()),
                            target_name: link.target,
                        });
                    continue;
                }

                if let Some(target_id) = graph.passage_names.get(&link.target) {
                    graph.stats.resolved_links += 1;
                    graph
                        .backlinks
                        .entry(target_id.clone())
                        .or_default()
                        .push(passage.id.clone());
                    graph
                        .outgoing
                        .entry(passage.id.clone())
                        .or_default()
                        .push(LinkEdge {
                            source: passage.id.clone(),
                            target: Some(target_id.clone()),
                            target_name: link.target,
                        });
                } else {
                    graph.stats.broken_links += 1;
                    graph.broken_links.push(BrokenLink {
                        source: passage.id.clone(),
                        target_name: link.target.clone(),
                    });
                    graph
                        .outgoing
                        .entry(passage.id.clone())
                        .or_default()
                        .push(LinkEdge {
                            source: passage.id.clone(),
                            target: None,
                            target_name: link.target,
                        });
                }
            }
        }

        graph
    }

    pub fn backlinks_to(&self, id: &PassageId) -> &[PassageId] {
        self.backlinks.get(id).map_or(&[], Vec::as_slice)
    }

    pub fn broken_links(&self) -> &[BrokenLink] {
        &self.broken_links
    }

    pub fn links_from(&self, id: &PassageId) -> &[LinkEdge] {
        self.outgoing.get(id).map_or(&[], Vec::as_slice)
    }

    pub fn stats(&self) -> &GraphStats {
        &self.stats
    }
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
            "passages": [
                {
                    "height": 100,
                    "highlighted": false,
                    "id": "a",
                    "left": 0,
                    "name": "A",
                    "selected": false,
                    "story": "story-1",
                    "tags": [],
                    "text": "[[B]] [[Missing]]",
                    "top": 0,
                    "width": 100
                },
                {
                    "height": 100,
                    "highlighted": false,
                    "id": "b",
                    "left": 125,
                    "name": "B",
                    "selected": false,
                    "story": "story-1",
                    "tags": [],
                    "text": "[[B]]",
                    "top": 0,
                    "width": 100
                }
            ],
            "script": "",
            "selected": false,
            "snapToGrid": true,
            "startPassage": "a",
            "storyFormat": "Harlowe",
            "storyFormatVersion": "3.3.9",
            "stylesheet": "",
            "tags": [],
            "tagColors": {},
            "zoom": 1
        }))
        .expect("story json should deserialize")
    }

    #[test]
    fn builds_story_graph() {
        let story = story();
        let graph = GraphIndex::from_story(&story);

        assert_eq!(
            graph.stats(),
            &GraphStats {
                broken_links: 1,
                links: 3,
                passages: 2,
                resolved_links: 1,
                self_links: 1
            }
        );
        assert_eq!(graph.broken_links()[0].target_name, "Missing");
        assert_eq!(
            graph.backlinks_to(&PassageId::new("b")),
            &[PassageId::new("a")]
        );
    }
}
