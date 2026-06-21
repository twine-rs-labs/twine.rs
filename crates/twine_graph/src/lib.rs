#![doc = "Native story graph facts, layout, and viewport query primitives."]

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use twine_model::{GraphLayout, GraphPosition, PassageId, PassageLayout, Story};
use twine_parse::{LinkParseOptions, parse_standard_links};

fn default_true() -> bool {
    true
}

fn default_card_width() -> f64 {
    160.0
}

fn default_card_height() -> f64 {
    110.0
}

fn default_column_gap() -> f64 {
    240.0
}

fn default_row_gap() -> f64 {
    160.0
}

fn default_component_gap() -> f64 {
    260.0
}

fn default_overscan() -> f64 {
    256.0
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkEdge {
    pub source: PassageId,
    pub target: Option<PassageId>,
    pub target_name: String,
}

impl LinkEdge {
    pub fn kind(&self) -> GraphEdgeKind {
        match &self.target {
            Some(target) if target == &self.source => GraphEdgeKind::SelfLink,
            Some(_) => GraphEdgeKind::Resolved,
            None => GraphEdgeKind::Broken,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenLink {
    pub source: PassageId,
    pub target_name: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphStats {
    pub broken_links: usize,
    pub empty_passages: usize,
    pub links: usize,
    pub orphan_passages: usize,
    pub passages: usize,
    pub resolved_links: usize,
    pub self_links: usize,
    pub tagged_passages: usize,
    pub unreachable_passages: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub broken_link_count: usize,
    pub id: PassageId,
    pub incoming_count: usize,
    pub is_empty: bool,
    pub is_orphan: bool,
    pub is_start: bool,
    pub is_unreachable: bool,
    pub name: String,
    pub outgoing_count: usize,
    pub self_link_count: usize,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct GraphIndex {
    backlinks: BTreeMap<PassageId, Vec<PassageId>>,
    broken_links: Vec<BrokenLink>,
    nodes: BTreeMap<PassageId, GraphNode>,
    outgoing: BTreeMap<PassageId, Vec<LinkEdge>>,
    passage_names: BTreeMap<String, PassageId>,
    self_links: Vec<PassageId>,
    stats: GraphStats,
    story_order: Vec<PassageId>,
}

impl GraphIndex {
    pub fn from_story(story: &Story) -> Self {
        let passage_names = story
            .passages
            .iter()
            .map(|passage| (passage.name.clone(), passage.id.clone()))
            .collect::<BTreeMap<_, _>>();
        let story_order = story
            .passages
            .iter()
            .map(|passage| passage.id.clone())
            .collect::<Vec<_>>();
        let mut graph = Self {
            passage_names,
            stats: GraphStats {
                empty_passages: story
                    .passages
                    .iter()
                    .filter(|passage| passage.text.trim().is_empty())
                    .count(),
                passages: story.passage_count(),
                tagged_passages: story
                    .passages
                    .iter()
                    .filter(|passage| !passage.tags.is_empty())
                    .count(),
                ..GraphStats::default()
            },
            story_order,
            ..Self::default()
        };

        for passage in &story.passages {
            graph.nodes.insert(
                passage.id.clone(),
                GraphNode {
                    broken_link_count: 0,
                    id: passage.id.clone(),
                    incoming_count: 0,
                    is_empty: passage.text.trim().is_empty(),
                    is_orphan: false,
                    is_start: passage.id == story.start_passage,
                    is_unreachable: false,
                    name: passage.name.clone(),
                    outgoing_count: 0,
                    self_link_count: 0,
                    tags: passage.tags.clone(),
                },
            );
        }

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
                    graph.record_outgoing(LinkEdge {
                        source: passage.id.clone(),
                        target: Some(passage.id.clone()),
                        target_name: link.target,
                    });
                    graph.increment_self_link_count(&passage.id);
                    continue;
                }

                if let Some(target_id) = graph.passage_names.get(&link.target).cloned() {
                    graph.stats.resolved_links += 1;
                    graph
                        .backlinks
                        .entry(target_id.clone())
                        .or_default()
                        .push(passage.id.clone());
                    graph.increment_incoming_count(&target_id);
                    graph.record_outgoing(LinkEdge {
                        source: passage.id.clone(),
                        target: Some(target_id),
                        target_name: link.target,
                    });
                } else {
                    graph.stats.broken_links += 1;
                    graph.broken_links.push(BrokenLink {
                        source: passage.id.clone(),
                        target_name: link.target.clone(),
                    });
                    graph.increment_broken_link_count(&passage.id);
                    graph.record_outgoing(LinkEdge {
                        source: passage.id.clone(),
                        target: None,
                        target_name: link.target,
                    });
                }
            }
        }

        graph.mark_reachability(&story.start_passage);
        graph.mark_orphans(&story.start_passage);
        graph
    }

    pub fn backlinks_to(&self, id: &PassageId) -> &[PassageId] {
        self.backlinks.get(id).map_or(&[], Vec::as_slice)
    }

    pub fn broken_links(&self) -> &[BrokenLink] {
        &self.broken_links
    }

    pub fn canvas_projection(
        &self,
        story: &Story,
        saved_layout: &GraphLayout,
        layout_options: &AutoLayoutOptions,
        projection_options: &GraphProjectionOptions,
    ) -> GraphProjection {
        let layout = self.layout_snapshot(story, saved_layout, layout_options);
        let focus_ids = projection_options.focus.as_ref().and_then(|focus| {
            if focus.passage_ids.is_empty() {
                None
            } else {
                Some(self.neighborhood(&focus.passage_ids, focus.radius, focus.direction))
            }
        });
        let viewport = projection_options
            .viewport
            .map(|viewport| expand_rect(viewport, projection_options.overscan));
        let mut visible_ids = BTreeSet::new();
        let mut nodes = Vec::new();

        for id in &self.story_order {
            if focus_ids
                .as_ref()
                .is_some_and(|focused_ids| !focused_ids.contains(id))
            {
                continue;
            }

            let Some(layout_entry) = layout.passages.get(id) else {
                continue;
            };

            if viewport.is_some_and(|viewport| !rects_intersect(viewport, layout_entry.bounds)) {
                continue;
            }

            let Some(node) = self.nodes.get(id) else {
                continue;
            };

            visible_ids.insert(id.clone());
            nodes.push(GraphCanvasNode {
                broken_link_count: node.broken_link_count,
                bounds: layout_entry.bounds,
                id: node.id.clone(),
                incoming_count: node.incoming_count,
                is_empty: node.is_empty,
                is_orphan: node.is_orphan,
                is_start: node.is_start,
                is_unreachable: node.is_unreachable,
                layout_source: layout_entry.source,
                name: node.name.clone(),
                outgoing_count: node.outgoing_count,
                self_link_count: node.self_link_count,
                tags: node.tags.clone(),
            });
        }

        let edges = self.project_edges(
            &layout,
            &visible_ids,
            focus_ids.as_ref(),
            &projection_options.layers,
        );

        GraphProjection {
            bounds: layout.bounds,
            edges,
            layout_state: layout.state,
            nodes,
            stats: self.stats.clone(),
        }
    }

    pub fn layout_snapshot(
        &self,
        story: &Story,
        saved_layout: &GraphLayout,
        options: &AutoLayoutOptions,
    ) -> GraphLayoutSnapshot {
        let mut generated = None;
        let mut passages = BTreeMap::new();
        let mut saved_count = 0;
        let mut generated_count = 0;

        for passage in &story.passages {
            let saved_bounds = saved_layout
                .passages
                .get(&passage.id)
                .map(|layout| layout.bounds)
                .or(passage.layout);
            let (bounds, source) = if let Some(bounds) = saved_bounds {
                saved_count += 1;
                (bounds, GraphLayoutSource::Saved)
            } else {
                let generated =
                    generated.get_or_insert_with(|| self.generate_ephemeral_layout(options));

                if let Some(layout) = generated.passages.get(&passage.id) {
                    generated_count += 1;
                    (layout.bounds, GraphLayoutSource::Generated)
                } else {
                    continue;
                }
            };

            passages.insert(passage.id.clone(), GraphLayoutEntry { bounds, source });
        }

        let state = match (saved_count, generated_count, story.passage_count()) {
            (0, 0, _) => GraphLayoutState::Missing,
            (0, _, _) => GraphLayoutState::Generated,
            (_, 0, count) if saved_count == count => GraphLayoutState::Saved,
            (_, 0, _) => GraphLayoutState::Partial,
            _ => GraphLayoutState::Mixed,
        };
        let bounds = graph_bounds(passages.values().map(|entry| entry.bounds));

        GraphLayoutSnapshot {
            bounds,
            passages,
            state,
        }
    }

    pub fn generate_ephemeral_layout(&self, options: &AutoLayoutOptions) -> GraphLayout {
        let mut layout = GraphLayout::default();
        let components = self.layout_components();
        let mut component_top = options.origin_top;

        for component in components {
            let mut levels = BTreeMap::<usize, Vec<PassageId>>::new();

            for (id, level) in component {
                levels.entry(level).or_default().push(id);
            }

            let max_rows = levels.values().map(Vec::len).max().unwrap_or(0);

            for (level, mut ids) in levels {
                ids.sort_by_key(|id| self.story_order_index(id));

                for (row, id) in ids.into_iter().enumerate() {
                    layout.passages.insert(
                        id,
                        PassageLayout {
                            bounds: GraphPosition {
                                height: options.card_height,
                                left: options.origin_left
                                    + level as f64 * (options.card_width + options.column_gap),
                                top: component_top
                                    + row as f64 * (options.card_height + options.row_gap),
                                width: options.card_width,
                            },
                            ..PassageLayout::default()
                        },
                    );
                }
            }

            component_top += max_rows.max(1) as f64 * (options.card_height + options.row_gap)
                + options.component_gap;
        }

        layout
    }

    pub fn links_from(&self, id: &PassageId) -> &[LinkEdge] {
        self.outgoing.get(id).map_or(&[], Vec::as_slice)
    }

    pub fn node(&self, id: &PassageId) -> Option<&GraphNode> {
        self.nodes.get(id)
    }

    pub fn nodes(&self) -> impl Iterator<Item = &GraphNode> {
        self.nodes.values()
    }

    pub fn passage_id_for_name(&self, name: &str) -> Option<&PassageId> {
        self.passage_names.get(name)
    }

    pub fn stats(&self) -> &GraphStats {
        &self.stats
    }

    pub fn neighborhood(
        &self,
        seeds: &[PassageId],
        radius: usize,
        direction: GraphDirection,
    ) -> BTreeSet<PassageId> {
        let mut result = BTreeSet::new();
        let mut queue = VecDeque::new();

        for seed in seeds {
            if self.nodes.contains_key(seed) && result.insert(seed.clone()) {
                queue.push_back((seed.clone(), 0));
            }
        }

        while let Some((id, depth)) = queue.pop_front() {
            if depth >= radius {
                continue;
            }

            for neighbor in self.neighbors(&id, direction) {
                if result.insert(neighbor.clone()) {
                    queue.push_back((neighbor, depth + 1));
                }
            }
        }

        result
    }

    fn increment_broken_link_count(&mut self, id: &PassageId) {
        if let Some(node) = self.nodes.get_mut(id) {
            node.broken_link_count += 1;
        }
    }

    fn increment_incoming_count(&mut self, id: &PassageId) {
        if let Some(node) = self.nodes.get_mut(id) {
            node.incoming_count += 1;
        }
    }

    fn increment_self_link_count(&mut self, id: &PassageId) {
        if let Some(node) = self.nodes.get_mut(id) {
            node.self_link_count += 1;
        }
    }

    fn layout_components(&self) -> Vec<Vec<(PassageId, usize)>> {
        let mut components = Vec::new();
        let mut visited = BTreeSet::new();

        for seed in &self.story_order {
            if visited.contains(seed) {
                continue;
            }

            let mut component = Vec::new();
            let mut queue = VecDeque::from([(seed.clone(), 0)]);

            visited.insert(seed.clone());

            while let Some((id, level)) = queue.pop_front() {
                component.push((id.clone(), level));

                for neighbor in self.neighbors(&id, GraphDirection::Outgoing) {
                    if visited.insert(neighbor.clone()) {
                        queue.push_back((neighbor, level + 1));
                    }
                }
            }

            components.push(component);
        }

        components
    }

    fn mark_orphans(&mut self, start_passage: &PassageId) {
        for node in self.nodes.values_mut() {
            node.is_orphan = node.id != *start_passage && node.incoming_count == 0;

            if node.is_orphan {
                self.stats.orphan_passages += 1;
            }
        }
    }

    fn mark_reachability(&mut self, start_passage: &PassageId) {
        let mut reachable = BTreeSet::new();
        let mut queue = VecDeque::new();

        if self.nodes.contains_key(start_passage) {
            reachable.insert(start_passage.clone());
            queue.push_back(start_passage.clone());
        } else if let Some(first) = self.story_order.first() {
            reachable.insert(first.clone());
            queue.push_back(first.clone());
        }

        while let Some(id) = queue.pop_front() {
            for neighbor in self.neighbors(&id, GraphDirection::Outgoing) {
                if reachable.insert(neighbor.clone()) {
                    queue.push_back(neighbor);
                }
            }
        }

        for node in self.nodes.values_mut() {
            node.is_unreachable = !reachable.contains(&node.id);

            if node.is_unreachable {
                self.stats.unreachable_passages += 1;
            }
        }
    }

    fn neighbors(&self, id: &PassageId, direction: GraphDirection) -> Vec<PassageId> {
        let mut neighbors = BTreeSet::new();

        if matches!(direction, GraphDirection::Outgoing | GraphDirection::Both) {
            for edge in self.links_from(id) {
                if let Some(target) = &edge.target
                    && target != id
                {
                    neighbors.insert(target.clone());
                }
            }
        }

        if matches!(direction, GraphDirection::Incoming | GraphDirection::Both) {
            for source in self.backlinks_to(id) {
                if source != id {
                    neighbors.insert(source.clone());
                }
            }
        }

        neighbors.into_iter().collect()
    }

    fn project_edges(
        &self,
        layout: &GraphLayoutSnapshot,
        visible_ids: &BTreeSet<PassageId>,
        focus_ids: Option<&BTreeSet<PassageId>>,
        layers: &LinkLayerOptions,
    ) -> Vec<GraphCanvasEdge> {
        let mut edges = Vec::new();

        for source_id in &self.story_order {
            if focus_ids.is_some_and(|focused_ids| !focused_ids.contains(source_id)) {
                continue;
            }

            let Some(source_layout) = layout.passages.get(source_id) else {
                continue;
            };

            for edge in self.links_from(source_id) {
                let kind = edge.kind();

                if !layers.includes(kind) {
                    continue;
                }

                if let Some(focused_ids) = focus_ids
                    && edge
                        .target
                        .as_ref()
                        .is_some_and(|target_id| !focused_ids.contains(target_id))
                {
                    continue;
                }

                let target_layout = edge
                    .target
                    .as_ref()
                    .and_then(|id| layout.passages.get(id))
                    .map(|layout| layout.bounds);
                let touches_visible_node = visible_ids.contains(source_id)
                    || edge
                        .target
                        .as_ref()
                        .is_some_and(|target_id| visible_ids.contains(target_id));

                if !touches_visible_node {
                    continue;
                }

                edges.push(GraphCanvasEdge {
                    kind,
                    source: edge.source.clone(),
                    source_bounds: source_layout.bounds,
                    target: edge.target.clone(),
                    target_bounds: target_layout,
                    target_name: edge.target_name.clone(),
                });
            }
        }

        edges
    }

    fn record_outgoing(&mut self, edge: LinkEdge) {
        if let Some(node) = self.nodes.get_mut(&edge.source) {
            node.outgoing_count += 1;
        }

        self.outgoing
            .entry(edge.source.clone())
            .or_default()
            .push(edge);
    }

    fn story_order_index(&self, id: &PassageId) -> usize {
        self.story_order
            .iter()
            .position(|entry| entry == id)
            .unwrap_or(usize::MAX)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphDirection {
    Incoming,
    Outgoing,
    Both,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphEdgeKind {
    Resolved,
    Broken,
    SelfLink,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphLayoutSource {
    Saved,
    Generated,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphLayoutState {
    Saved,
    Generated,
    Mixed,
    Partial,
    Missing,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLayoutOptions {
    #[serde(default = "default_card_height")]
    pub card_height: f64,
    #[serde(default = "default_card_width")]
    pub card_width: f64,
    #[serde(default = "default_column_gap")]
    pub column_gap: f64,
    #[serde(default = "default_component_gap")]
    pub component_gap: f64,
    #[serde(default)]
    pub origin_left: f64,
    #[serde(default)]
    pub origin_top: f64,
    #[serde(default = "default_row_gap")]
    pub row_gap: f64,
}

impl Default for AutoLayoutOptions {
    fn default() -> Self {
        Self {
            card_height: default_card_height(),
            card_width: default_card_width(),
            column_gap: default_column_gap(),
            component_gap: default_component_gap(),
            origin_left: 0.0,
            origin_top: 0.0,
            row_gap: default_row_gap(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLayoutEntry {
    pub bounds: GraphPosition,
    pub source: GraphLayoutSource,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLayoutSnapshot {
    pub bounds: Option<GraphPosition>,
    pub passages: BTreeMap<PassageId, GraphLayoutEntry>,
    pub state: GraphLayoutState,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphViewport {
    pub height: f64,
    pub left: f64,
    pub top: f64,
    pub width: f64,
}

impl From<GraphPosition> for GraphViewport {
    fn from(value: GraphPosition) -> Self {
        Self {
            height: value.height,
            left: value.left,
            top: value.top,
            width: value.width,
        }
    }
}

impl From<GraphViewport> for GraphPosition {
    fn from(value: GraphViewport) -> Self {
        Self {
            height: value.height,
            left: value.left,
            top: value.top,
            width: value.width,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkLayerOptions {
    #[serde(default = "default_true")]
    pub broken: bool,
    #[serde(default = "default_true")]
    pub resolved: bool,
    #[serde(default = "default_true")]
    pub self_links: bool,
}

impl LinkLayerOptions {
    pub fn includes(&self, kind: GraphEdgeKind) -> bool {
        match kind {
            GraphEdgeKind::Resolved => self.resolved,
            GraphEdgeKind::Broken => self.broken,
            GraphEdgeKind::SelfLink => self.self_links,
        }
    }
}

impl Default for LinkLayerOptions {
    fn default() -> Self {
        Self {
            broken: true,
            resolved: true,
            self_links: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphFocus {
    #[serde(default)]
    pub direction: GraphDirection,
    #[serde(default)]
    pub passage_ids: Vec<PassageId>,
    #[serde(default)]
    pub radius: usize,
}

impl Default for GraphFocus {
    fn default() -> Self {
        Self {
            direction: GraphDirection::Both,
            passage_ids: Vec::new(),
            radius: 1,
        }
    }
}

impl Default for GraphDirection {
    fn default() -> Self {
        Self::Both
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphProjectionOptions {
    #[serde(default)]
    pub focus: Option<GraphFocus>,
    #[serde(default)]
    pub layers: LinkLayerOptions,
    #[serde(default = "default_overscan")]
    pub overscan: f64,
    #[serde(default)]
    pub viewport: Option<GraphViewport>,
}

impl Default for GraphProjectionOptions {
    fn default() -> Self {
        Self {
            focus: None,
            layers: LinkLayerOptions::default(),
            overscan: default_overscan(),
            viewport: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCanvasNode {
    pub broken_link_count: usize,
    pub bounds: GraphPosition,
    pub id: PassageId,
    pub incoming_count: usize,
    pub is_empty: bool,
    pub is_orphan: bool,
    pub is_start: bool,
    pub is_unreachable: bool,
    pub layout_source: GraphLayoutSource,
    pub name: String,
    pub outgoing_count: usize,
    pub self_link_count: usize,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCanvasEdge {
    pub kind: GraphEdgeKind,
    pub source: PassageId,
    pub source_bounds: GraphPosition,
    pub target: Option<PassageId>,
    pub target_bounds: Option<GraphPosition>,
    pub target_name: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphProjection {
    pub bounds: Option<GraphPosition>,
    pub edges: Vec<GraphCanvasEdge>,
    pub layout_state: GraphLayoutState,
    pub nodes: Vec<GraphCanvasNode>,
    pub stats: GraphStats,
}

fn expand_rect(viewport: GraphViewport, amount: f64) -> GraphPosition {
    GraphPosition {
        height: viewport.height + amount * 2.0,
        left: viewport.left - amount,
        top: viewport.top - amount,
        width: viewport.width + amount * 2.0,
    }
}

fn graph_bounds(bounds: impl IntoIterator<Item = GraphPosition>) -> Option<GraphPosition> {
    let mut iterator = bounds.into_iter();
    let first = iterator.next()?;
    let mut left = first.left;
    let mut top = first.top;
    let mut right = first.left + first.width;
    let mut bottom = first.top + first.height;

    for bounds in iterator {
        left = left.min(bounds.left);
        top = top.min(bounds.top);
        right = right.max(bounds.left + bounds.width);
        bottom = bottom.max(bounds.top + bounds.height);
    }

    Some(GraphPosition {
        height: bottom - top,
        left,
        top,
        width: right - left,
    })
}

fn rects_intersect(left: GraphPosition, right: GraphPosition) -> bool {
    left.left <= right.left + right.width
        && left.left + left.width >= right.left
        && left.top <= right.top + right.height
        && left.top + left.height >= right.top
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
                    "tags": ["hub"],
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
                },
                {
                    "height": 100,
                    "highlighted": false,
                    "id": "c",
                    "left": 250,
                    "name": "C",
                    "selected": false,
                    "story": "story-1",
                    "tags": [],
                    "text": "",
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
                empty_passages: 1,
                links: 3,
                orphan_passages: 1,
                passages: 3,
                resolved_links: 1,
                self_links: 1,
                tagged_passages: 1,
                unreachable_passages: 1
            }
        );
        assert_eq!(graph.broken_links()[0].target_name, "Missing");
        assert_eq!(
            graph.backlinks_to(&PassageId::new("b")),
            &[PassageId::new("a")]
        );

        let start = graph.node(&PassageId::new("a")).expect("start node");

        assert!(start.is_start);
        assert_eq!(start.outgoing_count, 2);
        assert_eq!(start.broken_link_count, 1);
        assert!(!start.is_orphan);
    }

    #[test]
    fn generates_non_destructive_layout_for_source_only_stories() {
        let mut story = story();

        for passage in &mut story.passages {
            passage.layout = None;
        }

        let graph = GraphIndex::from_story(&story);
        let snapshot = graph.layout_snapshot(
            &story,
            &GraphLayout::default(),
            &AutoLayoutOptions::default(),
        );

        assert_eq!(snapshot.state, GraphLayoutState::Generated);
        assert_eq!(snapshot.passages.len(), 3);
        assert_eq!(
            snapshot.passages[&PassageId::new("a")].source,
            GraphLayoutSource::Generated
        );
        assert!(
            story
                .passages
                .iter()
                .all(|passage| passage.layout.is_none())
        );
    }

    #[test]
    fn projects_viewport_nodes_and_layered_edges() {
        let story = story();
        let graph = GraphIndex::from_story(&story);
        let projection = graph.canvas_projection(
            &story,
            &GraphLayout::from_story_layout(&story),
            &AutoLayoutOptions::default(),
            &GraphProjectionOptions {
                layers: LinkLayerOptions {
                    broken: false,
                    ..LinkLayerOptions::default()
                },
                overscan: 0.0,
                viewport: Some(GraphViewport {
                    height: 150.0,
                    left: 0.0,
                    top: 0.0,
                    width: 150.0,
                }),
                ..GraphProjectionOptions::default()
            },
        );

        assert_eq!(projection.layout_state, GraphLayoutState::Saved);
        assert_eq!(
            projection
                .nodes
                .iter()
                .map(|node| node.id.clone())
                .collect::<Vec<_>>(),
            vec![PassageId::new("a"), PassageId::new("b")]
        );
        assert!(
            projection
                .edges
                .iter()
                .all(|edge| edge.kind != GraphEdgeKind::Broken)
        );
        assert!(
            projection
                .edges
                .iter()
                .any(|edge| edge.kind == GraphEdgeKind::Resolved)
        );
    }

    #[test]
    fn focused_projection_excludes_edges_outside_the_neighborhood() {
        let mut story = story();

        for passage in &mut story.passages {
            if passage.id == PassageId::new("a") {
                passage.text = "[[B]] [[C]]".into();
            }
        }

        let graph = GraphIndex::from_story(&story);
        let projection = graph.canvas_projection(
            &story,
            &GraphLayout::from_story_layout(&story),
            &AutoLayoutOptions::default(),
            &GraphProjectionOptions {
                focus: Some(GraphFocus {
                    direction: GraphDirection::Incoming,
                    passage_ids: vec![PassageId::new("b")],
                    radius: 1,
                }),
                overscan: 0.0,
                ..GraphProjectionOptions::default()
            },
        );

        assert_eq!(
            projection
                .nodes
                .iter()
                .map(|node| node.id.clone())
                .collect::<Vec<_>>(),
            vec![PassageId::new("a"), PassageId::new("b")]
        );
        assert!(
            projection
                .edges
                .iter()
                .all(|edge| edge.target.as_ref() != Some(&PassageId::new("c")))
        );
    }

    #[test]
    fn selects_focus_neighborhoods() {
        let story = story();
        let graph = GraphIndex::from_story(&story);
        let neighborhood = graph.neighborhood(&[PassageId::new("b")], 1, GraphDirection::Incoming);

        assert_eq!(
            neighborhood.into_iter().collect::<Vec<_>>(),
            vec![PassageId::new("a"), PassageId::new("b")]
        );
    }
}
