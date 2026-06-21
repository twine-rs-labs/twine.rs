#![doc = "Search indexing interfaces for Twine stories."]

use serde::{Deserialize, Serialize};
use twine_model::{PassageId, Story};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SearchDocument {
    pub passage_id: PassageId,
    pub name: String,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SearchHit {
    pub passage_id: PassageId,
    pub score: f32,
}

pub trait SearchIndex {
    fn replace_all(&mut self, documents: Vec<SearchDocument>);
    fn search(&self, query: &str, limit: usize) -> Vec<SearchHit>;
}

#[derive(Clone, Debug, Default)]
pub struct LinearSearchIndex {
    documents: Vec<SearchDocument>,
}

impl LinearSearchIndex {
    pub fn from_story(story: &Story) -> Self {
        let mut index = Self::default();

        index.replace_all(
            story
                .passages
                .iter()
                .map(|passage| SearchDocument {
                    passage_id: passage.id.clone(),
                    name: passage.name.clone(),
                    text: passage.text.clone(),
                })
                .collect(),
        );
        index
    }
}

impl SearchIndex for LinearSearchIndex {
    fn replace_all(&mut self, documents: Vec<SearchDocument>) {
        self.documents = documents;
    }

    fn search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let query = query.trim().to_lowercase();

        if query.is_empty() || limit == 0 {
            return Vec::new();
        }

        let mut hits = self
            .documents
            .iter()
            .filter_map(|document| {
                let name_match = document.name.to_lowercase().contains(&query);
                let text_match = document.text.to_lowercase().contains(&query);

                if name_match || text_match {
                    Some(SearchHit {
                        passage_id: document.passage_id.clone(),
                        score: if name_match { 1.0 } else { 0.5 },
                    })
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        hits.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.passage_id.cmp(&right.passage_id))
        });
        hits.truncate(limit);
        hits
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_search_returns_limited_hits() {
        let mut index = LinearSearchIndex::default();
        index.replace_all(vec![
            SearchDocument {
                passage_id: PassageId::new("a"),
                name: "Start".into(),
                text: "alpha".into(),
            },
            SearchDocument {
                passage_id: PassageId::new("b"),
                name: "Other".into(),
                text: "start here too".into(),
            },
        ]);

        let hits = index.search("start", 1);

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].passage_id, PassageId::new("a"));
    }
}
