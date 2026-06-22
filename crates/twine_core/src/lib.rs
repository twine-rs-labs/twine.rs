#![doc = "Command, patch, transaction, and snapshot spine for the Twine core."]

use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};
use thiserror::Error;
use ts_rs::TS;
use twine_graph::{
    AutoLayoutOptions, GraphDirection, GraphEdgeKind, GraphFocus, GraphIndex, GraphLayoutSnapshot,
    GraphLayoutSource, GraphLayoutState, GraphProjectionOptions, GraphViewport, LinkLayerOptions,
};
use twine_model::{
    GraphPosition, Passage, PassageId, PassageIndex, PassageLayout, Project, Story, StoryId,
};

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreRect {
    pub height: f64,
    pub left: f64,
    pub top: f64,
    pub width: f64,
}

impl From<GraphPosition> for CoreRect {
    fn from(value: GraphPosition) -> Self {
        Self {
            height: value.height,
            left: value.left,
            top: value.top,
            width: value.width,
        }
    }
}

impl From<CoreRect> for GraphPosition {
    fn from(value: CoreRect) -> Self {
        Self {
            height: value.height,
            left: value.left,
            top: value.top,
            width: value.width,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct PassageSnapshot {
    pub id: String,
    #[serde(default)]
    pub layout: Option<CoreRect>,
    pub name: String,
    pub story_id: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub text: String,
}

impl PassageSnapshot {
    fn into_passage(self, story_id: &StoryId) -> Passage {
        Passage {
            custom_attributes: BTreeMap::new(),
            id: PassageId::new(self.id),
            layout: self.layout.map(GraphPosition::from),
            metadata: BTreeMap::new(),
            name: self.name,
            source_pid: None,
            story: story_id.clone(),
            tags: self.tags,
            text: self.text,
        }
    }
}

impl From<&Passage> for PassageSnapshot {
    fn from(value: &Passage) -> Self {
        Self {
            id: value.id.as_ref().to_owned(),
            layout: value.layout.map(CoreRect::from),
            name: value.name.clone(),
            story_id: value.story.as_ref().to_owned(),
            tags: value.tags.clone(),
            text: value.text.clone(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct StorySnapshot {
    pub id: String,
    pub ifid: String,
    pub name: String,
    pub passages: Vec<PassageSnapshot>,
    pub script: String,
    #[serde(default = "default_true")]
    pub snap_to_grid: bool,
    pub start_passage_id: String,
    pub story_format: String,
    pub story_format_version: String,
    pub stylesheet: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub tag_colors: BTreeMap<String, String>,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreSourceKind {
    Passage,
    Script,
    Stylesheet,
    StoryMetadata,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreSourceFile {
    pub character_count: usize,
    pub id: String,
    pub kind: CoreSourceKind,
    pub line_count: usize,
    pub name: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreSearchScope {
    PassageName,
    PassageText,
    PassageTag,
    Script,
    Stylesheet,
    Variable,
    Asset,
    Metadata,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreSearchHit {
    #[serde(default)]
    pub after: Option<String>,
    #[serde(default)]
    pub before: Option<String>,
    pub end: usize,
    pub excerpt: String,
    pub line: usize,
    pub match_text: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    pub rank: f32,
    #[serde(default)]
    pub replacement: Option<String>,
    pub scope: CoreSearchScope,
    pub source_id: String,
    pub source_name: String,
    pub start: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreSymbolKind {
    Variable,
    TemporaryVariable,
    Hook,
    StoryMetadata,
    StoryFormat,
    Asset,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreSymbol {
    pub end: usize,
    pub excerpt: String,
    pub kind: CoreSymbolKind,
    pub line: usize,
    pub name: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    pub scope: CoreSearchScope,
    pub source_id: String,
    pub source_name: String,
    pub start: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreAssetReference {
    pub end: usize,
    pub kind: String,
    pub line: usize,
    #[serde(default)]
    pub passage_id: Option<String>,
    pub path: String,
    pub source_id: String,
    pub source_name: String,
    pub start: usize,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreAssetSnippet {
    pub label: String,
    pub media_type: String,
    pub text: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreAssetPublishRule {
    pub copy: bool,
    pub output_path: String,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreAssetInventoryEntry {
    #[serde(default)]
    pub duration_ms: Option<usize>,
    #[serde(default)]
    pub exists: Option<bool>,
    #[serde(default)]
    pub height: Option<usize>,
    pub kind: String,
    pub missing: bool,
    #[serde(default)]
    pub modified_at: Option<String>,
    pub normalized_path: String,
    pub path: String,
    #[serde(default)]
    pub preview_url: Option<String>,
    #[serde(default)]
    pub publish: CoreAssetPublishRule,
    pub reference_count: usize,
    #[serde(default)]
    pub references: Vec<CoreAssetReference>,
    #[serde(default)]
    pub size_bytes: Option<usize>,
    #[serde(default)]
    pub snippet: CoreAssetSnippet,
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    pub unused: bool,
    #[serde(default)]
    pub width: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreTagEntry {
    #[serde(default)]
    pub color: Option<String>,
    pub count: usize,
    pub name: String,
    pub passage_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreContentsEntryKind {
    Metadata,
    Passage,
    Script,
    Stylesheet,
    Tag,
    Variable,
    Asset,
    Diagnostic,
    EntryPoint,
    Orphan,
    BrokenLink,
    Group,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreContentsEntry {
    pub count: usize,
    #[serde(default)]
    pub detail: Option<String>,
    pub id: String,
    pub kind: CoreContentsEntryKind,
    pub label: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    #[serde(default)]
    pub severity: Option<CoreDiagnosticSeverity>,
    #[serde(default)]
    pub source_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreReplacePreview {
    pub after: String,
    pub before: String,
    pub end: usize,
    pub line: usize,
    pub match_text: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    pub replacement: String,
    pub scope: CoreSearchScope,
    pub source_id: String,
    pub source_name: String,
    pub start: usize,
}

impl CoreReplacePreview {
    fn from_hit(hit: &CoreSearchHit) -> Option<Self> {
        Some(Self {
            after: hit.after.clone()?,
            before: hit.before.clone()?,
            end: hit.end,
            line: hit.line,
            match_text: hit.match_text.clone(),
            passage_id: hit.passage_id.clone(),
            replacement: hit.replacement.clone()?,
            scope: hit.scope.clone(),
            source_id: hit.source_id.clone(),
            source_name: hit.source_name.clone(),
            start: hit.start,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreDiagnostic {
    pub code: String,
    pub end: usize,
    pub line: usize,
    pub message: String,
    #[serde(default)]
    pub passage_id: Option<String>,
    #[serde(default)]
    pub quick_fixes: Vec<CoreQuickFix>,
    pub severity: CoreDiagnosticSeverity,
    pub source_id: String,
    pub start: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreQuickFix {
    pub command: String,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreStoryIndexOptions {
    #[serde(default)]
    pub fuzzy: bool,
    #[serde(default = "default_true")]
    pub include_assets: bool,
    #[serde(default = "default_true")]
    pub include_contents: bool,
    #[serde(default = "default_true")]
    pub include_diagnostics: bool,
    #[serde(default = "default_true")]
    pub include_files: bool,
    #[serde(default = "default_true")]
    pub include_graph: bool,
    #[serde(default = "default_true")]
    pub include_passage_names: bool,
    #[serde(default = "default_true")]
    pub include_passage_text: bool,
    #[serde(default = "default_true")]
    pub include_script: bool,
    #[serde(default = "default_true")]
    pub include_stylesheet: bool,
    #[serde(default = "default_true")]
    pub include_tags: bool,
    #[serde(default = "default_true")]
    pub include_variables: bool,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub replacement: Option<String>,
    #[serde(default)]
    pub use_regexes: bool,
    #[serde(default)]
    pub known_assets: Vec<CoreAssetInventoryEntry>,
}

impl Default for CoreStoryIndexOptions {
    fn default() -> Self {
        Self {
            fuzzy: false,
            include_assets: true,
            include_contents: true,
            include_diagnostics: true,
            include_files: true,
            include_graph: true,
            include_passage_names: true,
            include_passage_text: true,
            include_script: true,
            include_stylesheet: true,
            include_tags: true,
            include_variables: true,
            match_case: false,
            query: None,
            replacement: None,
            use_regexes: false,
            known_assets: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreStoryIndex {
    #[serde(default)]
    pub asset_inventory: Vec<CoreAssetInventoryEntry>,
    #[serde(default)]
    pub assets: Vec<CoreAssetReference>,
    #[serde(default)]
    pub contents: Vec<CoreContentsEntry>,
    pub diagnostics: Vec<CoreDiagnostic>,
    pub files: Vec<CoreSourceFile>,
    pub graph: CoreGraphStats,
    #[serde(default)]
    pub replace_previews: Vec<CoreReplacePreview>,
    pub search_hits: Vec<CoreSearchHit>,
    pub story_id: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub tag_entries: Vec<CoreTagEntry>,
    #[serde(default)]
    pub symbols: Vec<CoreSymbol>,
}

impl From<&Story> for StorySnapshot {
    fn from(value: &Story) -> Self {
        Self {
            id: value.id.as_ref().to_owned(),
            ifid: value.ifid.clone(),
            name: value.name.clone(),
            passages: value.passages.iter().map(PassageSnapshot::from).collect(),
            script: value.script.clone(),
            snap_to_grid: value.snap_to_grid,
            start_passage_id: value.start_passage.as_ref().to_owned(),
            story_format: value.story_format.clone(),
            story_format_version: value.story_format_version.clone(),
            stylesheet: value.stylesheet.clone(),
            tags: value.tags.clone(),
            tag_colors: value.tag_colors.clone(),
            zoom: value.zoom,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct ProjectSnapshot {
    pub dirty: bool,
    pub name: String,
    pub schema_version: u32,
    pub stories: Vec<StorySnapshot>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct PassageMove {
    pub passage_id: String,
    pub bounds: CoreRect,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct PassagePatch {
    #[serde(default)]
    pub layout: Option<CoreRect>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreGraphDirection {
    Incoming,
    Outgoing,
    Both,
}

impl From<CoreGraphDirection> for GraphDirection {
    fn from(value: CoreGraphDirection) -> Self {
        match value {
            CoreGraphDirection::Incoming => Self::Incoming,
            CoreGraphDirection::Outgoing => Self::Outgoing,
            CoreGraphDirection::Both => Self::Both,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreGraphEdgeKind {
    Resolved,
    Broken,
    SelfLink,
}

impl From<GraphEdgeKind> for CoreGraphEdgeKind {
    fn from(value: GraphEdgeKind) -> Self {
        match value {
            GraphEdgeKind::Resolved => Self::Resolved,
            GraphEdgeKind::Broken => Self::Broken,
            GraphEdgeKind::SelfLink => Self::SelfLink,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreGraphLayoutSource {
    Saved,
    Generated,
}

impl From<GraphLayoutSource> for CoreGraphLayoutSource {
    fn from(value: GraphLayoutSource) -> Self {
        match value {
            GraphLayoutSource::Saved => Self::Saved,
            GraphLayoutSource::Generated => Self::Generated,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum CoreGraphLayoutState {
    Saved,
    Generated,
    Mixed,
    Partial,
    Missing,
}

impl From<GraphLayoutState> for CoreGraphLayoutState {
    fn from(value: GraphLayoutState) -> Self {
        match value {
            GraphLayoutState::Saved => Self::Saved,
            GraphLayoutState::Generated => Self::Generated,
            GraphLayoutState::Mixed => Self::Mixed,
            GraphLayoutState::Partial => Self::Partial,
            GraphLayoutState::Missing => Self::Missing,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreLinkLayerOptions {
    #[serde(default = "default_true")]
    pub broken: bool,
    #[serde(default = "default_true")]
    pub resolved: bool,
    #[serde(default = "default_true")]
    pub self_links: bool,
}

impl From<CoreLinkLayerOptions> for LinkLayerOptions {
    fn from(value: CoreLinkLayerOptions) -> Self {
        Self {
            broken: value.broken,
            resolved: value.resolved,
            self_links: value.self_links,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphFocus {
    pub direction: CoreGraphDirection,
    pub passage_ids: Vec<String>,
    pub radius: usize,
}

impl From<CoreGraphFocus> for GraphFocus {
    fn from(value: CoreGraphFocus) -> Self {
        Self {
            direction: value.direction.into(),
            passage_ids: value.passage_ids.into_iter().map(PassageId::new).collect(),
            radius: value.radius,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphProjectionOptions {
    #[serde(default)]
    pub focus: Option<CoreGraphFocus>,
    #[serde(default)]
    pub layers: CoreLinkLayerOptions,
    #[serde(default)]
    pub viewport: Option<CoreRect>,
}

impl From<CoreGraphProjectionOptions> for GraphProjectionOptions {
    fn from(value: CoreGraphProjectionOptions) -> Self {
        Self {
            focus: value.focus.map(GraphFocus::from),
            layers: value.layers.into(),
            viewport: value.viewport.map(GraphViewport::from),
            ..GraphProjectionOptions::default()
        }
    }
}

impl From<CoreRect> for GraphViewport {
    fn from(value: CoreRect) -> Self {
        Self {
            height: value.height,
            left: value.left,
            top: value.top,
            width: value.width,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphNode {
    pub bounds: CoreRect,
    pub broken_link_count: usize,
    pub id: String,
    pub incoming_count: usize,
    pub is_empty: bool,
    pub is_orphan: bool,
    pub is_start: bool,
    pub is_unreachable: bool,
    pub layout_source: CoreGraphLayoutSource,
    pub name: String,
    pub outgoing_count: usize,
    pub self_link_count: usize,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphEdge {
    pub kind: CoreGraphEdgeKind,
    pub source_bounds: CoreRect,
    pub source_id: String,
    #[serde(default)]
    pub target_bounds: Option<CoreRect>,
    #[serde(default)]
    pub target_id: Option<String>,
    pub target_name: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphStats {
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

impl From<twine_graph::GraphStats> for CoreGraphStats {
    fn from(value: twine_graph::GraphStats) -> Self {
        Self {
            broken_links: value.broken_links,
            empty_passages: value.empty_passages,
            links: value.links,
            orphan_passages: value.orphan_passages,
            passages: value.passages,
            resolved_links: value.resolved_links,
            self_links: value.self_links,
            tagged_passages: value.tagged_passages,
            unreachable_passages: value.unreachable_passages,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct CoreGraphProjection {
    #[serde(default)]
    pub bounds: Option<CoreRect>,
    pub edges: Vec<CoreGraphEdge>,
    pub layout_state: CoreGraphLayoutState,
    pub nodes: Vec<CoreGraphNode>,
    pub stats: CoreGraphStats,
}

impl From<twine_graph::GraphProjection> for CoreGraphProjection {
    fn from(value: twine_graph::GraphProjection) -> Self {
        Self {
            bounds: value.bounds.map(CoreRect::from),
            edges: value
                .edges
                .into_iter()
                .map(|edge| CoreGraphEdge {
                    kind: edge.kind.into(),
                    source_bounds: edge.source_bounds.into(),
                    source_id: edge.source.as_ref().to_owned(),
                    target_bounds: edge.target_bounds.map(CoreRect::from),
                    target_id: edge.target.map(|id| id.as_ref().to_owned()),
                    target_name: edge.target_name,
                })
                .collect(),
            layout_state: value.layout_state.into(),
            nodes: value
                .nodes
                .into_iter()
                .map(|node| CoreGraphNode {
                    bounds: node.bounds.into(),
                    broken_link_count: node.broken_link_count,
                    id: node.id.as_ref().to_owned(),
                    incoming_count: node.incoming_count,
                    is_empty: node.is_empty,
                    is_orphan: node.is_orphan,
                    is_start: node.is_start,
                    is_unreachable: node.is_unreachable,
                    layout_source: node.layout_source.into(),
                    name: node.name,
                    outgoing_count: node.outgoing_count,
                    self_link_count: node.self_link_count,
                    tags: node.tags,
                })
                .collect(),
            stats: value.stats.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum StoryCommand {
    Batch {
        commands: Vec<StoryCommand>,
    },
    CopyAssetSnippet {
        path: String,
        #[serde(default)]
        snippet: Option<String>,
        story_id: String,
    },
    CreatePassage {
        #[serde(default)]
        id: Option<String>,
        #[serde(default)]
        layout: Option<CoreRect>,
        #[serde(default)]
        name: Option<String>,
        story_id: String,
        #[serde(default)]
        tags: Vec<String>,
        #[serde(default)]
        text: String,
    },
    DeletePassages {
        passage_ids: Vec<String>,
        story_id: String,
    },
    DeleteAsset {
        path: String,
        #[serde(default)]
        remove_references: bool,
        story_id: String,
    },
    ImportAsset {
        #[serde(default)]
        overwrite: bool,
        source_path: String,
        story_id: String,
        #[serde(default)]
        target_path: Option<String>,
    },
    InsertAssetSnippet {
        passage_id: Option<String>,
        path: String,
        position: usize,
        #[serde(default)]
        snippet: Option<String>,
        source_id: String,
        story_id: String,
    },
    MarkSaved,
    MovePassages {
        moves: Vec<PassageMove>,
        story_id: String,
    },
    QueryGraphProjection {
        options: CoreGraphProjectionOptions,
        story_id: String,
    },
    QueryStoryIndex {
        options: CoreStoryIndexOptions,
        story_id: String,
    },
    RenamePassage {
        name: String,
        passage_id: String,
        story_id: String,
        #[serde(default = "default_true")]
        update_references: bool,
    },
    RenameStory {
        name: String,
        story_id: String,
    },
    RenameAsset {
        new_path: String,
        path: String,
        story_id: String,
        #[serde(default = "default_true")]
        update_references: bool,
    },
    ReplaceAsset {
        path: String,
        source_path: String,
        story_id: String,
    },
    RevealAsset {
        path: String,
        story_id: String,
    },
    RestorePassages {
        passages: Vec<PassageSnapshot>,
        story_id: String,
    },
    SetPassageTags {
        passage_id: String,
        story_id: String,
        tags: Vec<String>,
    },
    SetStartPassage {
        passage_id: String,
        story_id: String,
    },
    SetStoryFormat {
        story_format: String,
        story_format_version: String,
        story_id: String,
    },
    SetStorySnapToGrid {
        enabled: bool,
        story_id: String,
    },
    SetStoryZoom {
        story_id: String,
        zoom: f64,
    },
    SaveGeneratedLayout {
        story_id: String,
    },
    UpdatePassageText {
        passage_id: String,
        story_id: String,
        text: String,
    },
    UpdateStoryScript {
        script: String,
        story_id: String,
    },
    UpdateStoryStylesheet {
        story_id: String,
        stylesheet: String,
    },
    ValidateAssetReferences {
        story_id: String,
    },
}

impl StoryCommand {
    fn label(&self) -> &'static str {
        match self {
            Self::Batch { .. } => "Batch",
            Self::CopyAssetSnippet { .. } => "Copy Asset Snippet",
            Self::CreatePassage { .. } => "New Passage",
            Self::DeleteAsset { .. } => "Delete Asset",
            Self::DeletePassages { .. } => "Delete Passages",
            Self::ImportAsset { .. } => "Import Asset",
            Self::InsertAssetSnippet { .. } => "Insert Asset Snippet",
            Self::MarkSaved => "Mark Saved",
            Self::MovePassages { .. } => "Move Passages",
            Self::QueryGraphProjection { .. } => "Query Graph",
            Self::QueryStoryIndex { .. } => "Query Story Index",
            Self::RenameAsset { .. } => "Rename Asset",
            Self::RenamePassage { .. } => "Rename Passage",
            Self::RenameStory { .. } => "Rename Story",
            Self::ReplaceAsset { .. } => "Replace Asset",
            Self::RestorePassages { .. } => "Restore Passages",
            Self::RevealAsset { .. } => "Reveal Asset",
            Self::SaveGeneratedLayout { .. } => "Save Layout",
            Self::SetPassageTags { .. } => "Set Passage Tags",
            Self::SetStartPassage { .. } => "Set Start Passage",
            Self::SetStoryFormat { .. } => "Set Story Format",
            Self::SetStorySnapToGrid { .. } => "Set Story Snap To Grid",
            Self::SetStoryZoom { .. } => "Set Story Zoom",
            Self::UpdatePassageText { .. } => "Update Passage Text",
            Self::UpdateStoryScript { .. } => "Update Story JavaScript",
            Self::UpdateStoryStylesheet { .. } => "Update Story Stylesheet",
            Self::ValidateAssetReferences { .. } => "Validate Asset References",
        }
    }

    fn mutates_project(&self) -> bool {
        !matches!(
            self,
            Self::CopyAssetSnippet { .. }
                | Self::QueryGraphProjection { .. }
                | Self::QueryStoryIndex { .. }
                | Self::RevealAsset { .. }
                | Self::ValidateAssetReferences { .. }
        )
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub enum Patch {
    AssetDeleted {
        path: String,
        story_id: String,
    },
    AssetImported {
        asset: CoreAssetInventoryEntry,
        story_id: String,
    },
    AssetInventoryUpdated {
        inventory: Vec<CoreAssetInventoryEntry>,
        story_id: String,
    },
    AssetRenamed {
        new_path: String,
        old_path: String,
        story_id: String,
    },
    AssetReplaced {
        asset: CoreAssetInventoryEntry,
        story_id: String,
    },
    AssetRevealed {
        path: String,
        reveal_path: String,
        story_id: String,
    },
    AssetSnippetCopied {
        path: String,
        snippet: String,
        story_id: String,
    },
    AssetSnippetInserted {
        path: String,
        snippet: String,
        source_id: String,
        story_id: String,
    },
    DirtyStateChanged {
        dirty: bool,
    },
    GraphProjectionUpdated {
        projection: CoreGraphProjection,
        story_id: String,
    },
    LayoutSaved {
        projection: CoreGraphProjection,
        story_id: String,
    },
    PassageCreated {
        passage: PassageSnapshot,
        story_id: String,
    },
    PassageDeleted {
        passage_id: String,
        story_id: String,
    },
    PassageUpdated {
        changes: PassagePatch,
        passage_id: String,
        story_id: String,
    },
    ProjectSnapshotReplaced {
        snapshot: ProjectSnapshot,
    },
    StartPassageChanged {
        passage_id: String,
        story_id: String,
    },
    StoryIndexUpdated {
        index: CoreStoryIndex,
        story_id: String,
    },
    StoryScriptUpdated {
        script: String,
        story_id: String,
    },
    StoryStylesheetUpdated {
        story_id: String,
        stylesheet: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/core/bindings/")]
pub struct PatchBatch {
    pub label: String,
    pub patches: Vec<Patch>,
    pub transaction_id: u64,
}

#[derive(Clone, Debug, Error, PartialEq)]
pub enum CoreError {
    #[error("asset already exists: {0}")]
    AssetAlreadyExists(String),

    #[error("asset file not found: {0}")]
    AssetFileNotFound(String),

    #[error("asset host is not configured")]
    AssetHostUnavailable,

    #[error("duplicate passage name: {0}")]
    DuplicatePassageName(String),

    #[error("I/O error: {0}")]
    Io(String),

    #[error("passage not found: {0}")]
    PassageNotFound(String),

    #[error("story not found: {0}")]
    StoryNotFound(String),

    #[error("unsupported command: {0}")]
    UnsupportedCommand(String),

    #[error("unsafe asset path: {0}")]
    UnsafeAssetPath(String),
}

#[derive(Clone, Debug)]
struct Transaction {
    after: Project,
    before: Project,
    dirty_after: bool,
    dirty_before: bool,
    id: u64,
    label: String,
}

#[derive(Clone, Debug)]
struct GraphSessionCache {
    graph: GraphIndex,
    layout: GraphLayoutSnapshot,
}

#[derive(Clone, Debug)]
pub struct ProjectSession {
    asset_root: Option<PathBuf>,
    dirty: bool,
    graph_cache: BTreeMap<StoryId, GraphSessionCache>,
    next_transaction_id: u64,
    project: Project,
    redo_stack: Vec<Transaction>,
    undo_stack: Vec<Transaction>,
}

impl ProjectSession {
    pub fn new(project: Project) -> Self {
        Self {
            asset_root: None,
            dirty: false,
            graph_cache: BTreeMap::new(),
            next_transaction_id: 1,
            project,
            redo_stack: Vec::new(),
            undo_stack: Vec::new(),
        }
    }

    pub fn with_project_root(project: Project, project_root: impl Into<PathBuf>) -> Self {
        let mut session = Self::new(project);

        session.set_project_root(project_root);
        session
    }

    pub fn set_project_root(&mut self, project_root: impl Into<PathBuf>) {
        self.asset_root = Some(project_root.into().join("assets"));
    }

    pub fn apply(&mut self, command: StoryCommand) -> Result<PatchBatch, CoreError> {
        let before = self.project.clone();
        let dirty_before = self.dirty;
        let redo_before = self.redo_stack.clone();
        let undo_before = self.undo_stack.clone();
        let transaction_id = self.next_transaction_id;
        self.next_transaction_id += 1;
        let mut patches = match self.apply_without_transaction(command.clone()) {
            Ok(patches) => patches,
            Err(error) => {
                self.project = before;
                self.dirty = dirty_before;
                self.graph_cache.clear();
                self.next_transaction_id = transaction_id;
                self.redo_stack = redo_before;
                self.undo_stack = undo_before;
                return Err(error);
            }
        };

        if command.mutates_project() {
            self.graph_cache.clear();
            self.dirty = !matches!(command, StoryCommand::MarkSaved);
            push_dirty_patch(&mut patches, dirty_before, self.dirty);
            self.undo_stack.push(Transaction {
                after: self.project.clone(),
                before,
                dirty_after: self.dirty,
                dirty_before,
                id: transaction_id,
                label: command.label().into(),
            });
            self.redo_stack.clear();
        }

        Ok(PatchBatch {
            label: command.label().into(),
            patches,
            transaction_id,
        })
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn dirty(&self) -> bool {
        self.dirty
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn redo(&mut self) -> Option<PatchBatch> {
        let transaction = self.redo_stack.pop()?;

        self.project = transaction.after.clone();
        self.dirty = transaction.dirty_after;
        self.graph_cache.clear();
        self.undo_stack.push(transaction.clone());
        Some(PatchBatch {
            label: transaction.label,
            patches: vec![Patch::ProjectSnapshotReplaced {
                snapshot: self.snapshot(),
            }],
            transaction_id: transaction.id,
        })
    }

    pub fn snapshot(&self) -> ProjectSnapshot {
        ProjectSnapshot {
            dirty: self.dirty,
            name: self.project.manifest.name.clone(),
            schema_version: self.project.manifest.schema_version,
            stories: self
                .project
                .stories
                .iter()
                .map(StorySnapshot::from)
                .collect(),
        }
    }

    pub fn undo(&mut self) -> Option<PatchBatch> {
        let transaction = self.undo_stack.pop()?;

        self.project = transaction.before.clone();
        self.dirty = transaction.dirty_before;
        self.graph_cache.clear();
        self.redo_stack.push(transaction.clone());
        Some(PatchBatch {
            label: format!("Undo {}", transaction.label),
            patches: vec![Patch::ProjectSnapshotReplaced {
                snapshot: self.snapshot(),
            }],
            transaction_id: transaction.id,
        })
    }

    fn apply_without_transaction(
        &mut self,
        command: StoryCommand,
    ) -> Result<Vec<Patch>, CoreError> {
        let mutates_project = command.mutates_project();

        if mutates_project {
            self.graph_cache.clear();
        }

        let result = match command {
            StoryCommand::Batch { commands } => {
                let mut patches = Vec::new();

                for command in commands {
                    patches.extend(self.apply_without_transaction(command)?);
                }

                Ok(patches)
            }
            StoryCommand::CopyAssetSnippet {
                path,
                snippet,
                story_id,
            } => self.copy_asset_snippet(&story_id, &path, snippet),
            StoryCommand::CreatePassage {
                id,
                layout,
                name,
                story_id,
                tags,
                text,
            } => self.create_passage(story_id, id, name, text, tags, layout),
            StoryCommand::DeletePassages {
                story_id,
                passage_ids,
            } => self.delete_passages(&story_id, &passage_ids),
            StoryCommand::DeleteAsset {
                path,
                remove_references,
                story_id,
            } => self.delete_asset(&story_id, &path, remove_references),
            StoryCommand::ImportAsset {
                overwrite,
                source_path,
                story_id,
                target_path,
            } => self.import_asset(&story_id, &source_path, target_path, overwrite),
            StoryCommand::InsertAssetSnippet {
                passage_id,
                path,
                position,
                snippet,
                source_id,
                story_id,
            } => self.insert_asset_snippet(
                &story_id,
                &path,
                &source_id,
                passage_id.as_deref(),
                position,
                snippet,
            ),
            StoryCommand::MarkSaved => {
                self.dirty = false;
                Ok(Vec::new())
            }
            StoryCommand::MovePassages { story_id, moves } => self.move_passages(&story_id, moves),
            StoryCommand::QueryGraphProjection { story_id, options } => {
                let projection = self.graph_projection(&story_id, options)?;

                Ok(vec![Patch::GraphProjectionUpdated {
                    projection,
                    story_id,
                }])
            }
            StoryCommand::QueryStoryIndex { story_id, options } => {
                let index = self.story_index(&story_id, options)?;

                Ok(vec![Patch::StoryIndexUpdated { index, story_id }])
            }
            StoryCommand::RenamePassage {
                name,
                passage_id,
                story_id,
                update_references,
            } => self.rename_passage(&story_id, &passage_id, name, update_references),
            StoryCommand::RenameStory { name, story_id } => self.rename_story(&story_id, name),
            StoryCommand::RenameAsset {
                new_path,
                path,
                story_id,
                update_references,
            } => self.rename_asset(&story_id, &path, &new_path, update_references),
            StoryCommand::ReplaceAsset {
                path,
                source_path,
                story_id,
            } => self.replace_asset(&story_id, &path, &source_path),
            StoryCommand::RevealAsset { path, story_id } => self.reveal_asset(&story_id, &path),
            StoryCommand::RestorePassages { story_id, passages } => {
                self.restore_passages(&story_id, passages)
            }
            StoryCommand::SaveGeneratedLayout { story_id } => self.save_generated_layout(&story_id),
            StoryCommand::SetPassageTags {
                passage_id,
                story_id,
                tags,
            } => self.set_passage_tags(&story_id, &passage_id, tags),
            StoryCommand::SetStartPassage {
                passage_id,
                story_id,
            } => self.set_start_passage(&story_id, &passage_id),
            StoryCommand::SetStoryFormat {
                story_format,
                story_format_version,
                story_id,
            } => self.set_story_format(&story_id, story_format, story_format_version),
            StoryCommand::SetStorySnapToGrid { enabled, story_id } => {
                self.set_story_snap_to_grid(&story_id, enabled)
            }
            StoryCommand::SetStoryZoom { story_id, zoom } => self.set_story_zoom(&story_id, zoom),
            StoryCommand::UpdatePassageText {
                passage_id,
                story_id,
                text,
            } => self.update_passage_text(&story_id, &passage_id, text),
            StoryCommand::UpdateStoryScript { script, story_id } => {
                self.update_story_script(&story_id, script)
            }
            StoryCommand::UpdateStoryStylesheet {
                story_id,
                stylesheet,
            } => self.update_story_stylesheet(&story_id, stylesheet),
            StoryCommand::ValidateAssetReferences { story_id } => {
                self.validate_asset_references(&story_id)
            }
        };

        if mutates_project && result.is_ok() {
            self.graph_cache.clear();
        }

        result
    }

    fn create_passage(
        &mut self,
        story_id: String,
        id: Option<String>,
        name: Option<String>,
        text: String,
        tags: Vec<String>,
        layout: Option<CoreRect>,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(&story_id)?;
        let id = PassageId::new(id.unwrap_or_else(|| next_passage_id(story)));
        let name = name.unwrap_or_else(|| unique_passage_name(story, "Untitled Passage"));

        if story.passages.id_for_name(&name).is_some() {
            return Err(CoreError::DuplicatePassageName(name));
        }

        let passage = Passage {
            custom_attributes: BTreeMap::new(),
            id: id.clone(),
            layout: layout.map(GraphPosition::from),
            metadata: BTreeMap::new(),
            name,
            source_pid: None,
            story: story.id.clone(),
            tags,
            text,
        };

        story.passages.insert(passage.clone());
        if story.start_passage.as_ref().is_empty() {
            story.start_passage = id;
        }

        Ok(vec![Patch::PassageCreated {
            passage: PassageSnapshot::from(&passage),
            story_id,
        }])
    }

    fn delete_passages(
        &mut self,
        story_id: &str,
        passage_ids: &[String],
    ) -> Result<Vec<Patch>, CoreError> {
        let ids = passage_ids
            .iter()
            .map(PassageId::new)
            .collect::<BTreeSet<_>>();
        let story = self.story_mut(story_id)?;
        let existing_ids = story
            .passages
            .iter()
            .map(|passage| passage.id.clone())
            .collect::<BTreeSet<_>>();

        if let Some(missing) = ids.iter().find(|id| !existing_ids.contains(*id)) {
            return Err(CoreError::PassageNotFound(missing.as_ref().to_owned()));
        }

        let remaining = story
            .passages
            .iter()
            .filter(|passage| !ids.contains(&passage.id))
            .cloned()
            .collect::<Vec<_>>();

        story.passages = PassageIndex::from(remaining);

        if ids.contains(&story.start_passage) {
            story.start_passage = story
                .passages
                .first()
                .map(|passage| passage.id.clone())
                .unwrap_or_default();
        }

        Ok(passage_ids
            .iter()
            .map(|passage_id| Patch::PassageDeleted {
                passage_id: passage_id.clone(),
                story_id: story_id.to_owned(),
            })
            .collect())
    }

    fn graph_projection(
        &mut self,
        story_id: &str,
        options: CoreGraphProjectionOptions,
    ) -> Result<CoreGraphProjection, CoreError> {
        let story_id = StoryId::new(story_id);

        if !self.graph_cache.contains_key(&story_id) {
            let (graph, layout) = {
                let story = self.story(story_id.as_ref())?;
                let graph = GraphIndex::from_story(story);
                let layout = graph.layout_snapshot(
                    story,
                    &self.project.layout,
                    &AutoLayoutOptions::default(),
                );

                (graph, layout)
            };

            self.graph_cache
                .insert(story_id.clone(), GraphSessionCache { graph, layout });
        }

        let cache = self
            .graph_cache
            .get(&story_id)
            .expect("graph cache should be populated");
        let projection = cache
            .graph
            .canvas_projection_from_snapshot(&cache.layout, &options.into());

        Ok(projection.into())
    }

    fn save_generated_layout(&mut self, story_id: &str) -> Result<Vec<Patch>, CoreError> {
        let snapshot = {
            let story = self.story(story_id)?;
            let graph = GraphIndex::from_story(story);

            graph.layout_snapshot(story, &self.project.layout, &AutoLayoutOptions::default())
        };
        let mut patches = Vec::new();

        for (passage_id, entry) in snapshot.passages {
            self.project.layout.passages.insert(
                passage_id.clone(),
                PassageLayout {
                    bounds: entry.bounds,
                    ..PassageLayout::default()
                },
            );

            {
                let story = self.story_mut(story_id)?;
                let passage = story
                    .passage_by_id_mut(&passage_id)
                    .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;

                if passage.layout == Some(entry.bounds) {
                    continue;
                }

                passage.layout = Some(entry.bounds);
            }

            patches.push(Patch::PassageUpdated {
                changes: PassagePatch {
                    layout: Some(entry.bounds.into()),
                    ..PassagePatch::default()
                },
                passage_id: passage_id.as_ref().to_owned(),
                story_id: story_id.to_owned(),
            });
        }

        let projection = self.graph_projection(story_id, CoreGraphProjectionOptions::default())?;

        patches.push(Patch::LayoutSaved {
            projection,
            story_id: story_id.to_owned(),
        });
        Ok(patches)
    }

    fn move_passages(
        &mut self,
        story_id: &str,
        moves: Vec<PassageMove>,
    ) -> Result<Vec<Patch>, CoreError> {
        let mut patches = Vec::new();

        for passage_move in moves {
            let passage_id = PassageId::new(&passage_move.passage_id);
            let bounds = GraphPosition::from(passage_move.bounds);

            {
                let story = self.story_mut(story_id)?;
                let passage = story
                    .passage_by_id_mut(&passage_id)
                    .ok_or_else(|| CoreError::PassageNotFound(passage_move.passage_id.clone()))?;

                passage.layout = Some(bounds);
            }

            self.project.layout.passages.insert(
                passage_id,
                PassageLayout {
                    bounds,
                    ..PassageLayout::default()
                },
            );
            patches.push(Patch::PassageUpdated {
                changes: PassagePatch {
                    layout: Some(bounds.into()),
                    ..PassagePatch::default()
                },
                passage_id: passage_move.passage_id,
                story_id: story_id.to_owned(),
            });
        }

        Ok(patches)
    }

    fn rename_passage(
        &mut self,
        story_id: &str,
        passage_id: &str,
        name: String,
        update_references: bool,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;
        let passage_id = PassageId::new(passage_id);

        if story
            .passages
            .id_for_name(&name)
            .is_some_and(|existing_id| existing_id != &passage_id)
        {
            return Err(CoreError::DuplicatePassageName(name));
        }

        let passage = story
            .passage_by_id_mut(&passage_id)
            .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;
        let old_name = std::mem::replace(&mut passage.name, name.clone());
        let mut patches = vec![Patch::PassageUpdated {
            changes: PassagePatch {
                name: Some(name.clone()),
                ..PassagePatch::default()
            },
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.to_owned(),
        }];

        story.passages.rebuild_name_index();

        if update_references {
            for passage in story.passages.iter_mut() {
                let rewritten = replace_standard_link_targets(&passage.text, &old_name, &name);

                if rewritten != passage.text {
                    passage.text = rewritten;
                    patches.push(Patch::PassageUpdated {
                        changes: PassagePatch {
                            text: Some(passage.text.clone()),
                            ..PassagePatch::default()
                        },
                        passage_id: passage.id.as_ref().to_owned(),
                        story_id: story_id.to_owned(),
                    });
                }
            }
        }

        Ok(patches)
    }

    fn restore_passages(
        &mut self,
        story_id: &str,
        passages: Vec<PassageSnapshot>,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;
        let story_id_model = story.id.clone();
        let mut patches = Vec::new();

        for passage in passages {
            let restored = passage.into_passage(&story_id_model);

            story.passages.insert(restored.clone());
            patches.push(Patch::PassageCreated {
                passage: PassageSnapshot::from(&restored),
                story_id: story_id.to_owned(),
            });
        }

        Ok(patches)
    }

    fn set_passage_tags(
        &mut self,
        story_id: &str,
        passage_id: &str,
        tags: Vec<String>,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;
        let passage_id = PassageId::new(passage_id);
        let passage = story
            .passage_by_id_mut(&passage_id)
            .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;

        passage.tags = tags.clone();
        Ok(vec![Patch::PassageUpdated {
            changes: PassagePatch {
                tags: Some(tags),
                ..PassagePatch::default()
            },
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.to_owned(),
        }])
    }

    fn set_start_passage(
        &mut self,
        story_id: &str,
        passage_id: &str,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;
        let passage_id = PassageId::new(passage_id);

        if story.passage_by_id(&passage_id).is_none() {
            return Err(CoreError::PassageNotFound(passage_id.as_ref().to_owned()));
        }

        story.start_passage = passage_id.clone();
        Ok(vec![Patch::StartPassageChanged {
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.to_owned(),
        }])
    }

    fn rename_story(&mut self, story_id: &str, name: String) -> Result<Vec<Patch>, CoreError> {
        {
            let story = self.story_mut(story_id)?;

            story.name = name;
        }

        Ok(vec![Patch::ProjectSnapshotReplaced {
            snapshot: self.snapshot(),
        }])
    }

    fn set_story_format(
        &mut self,
        story_id: &str,
        story_format: String,
        story_format_version: String,
    ) -> Result<Vec<Patch>, CoreError> {
        {
            let story = self.story_mut(story_id)?;

            story.story_format = story_format;
            story.story_format_version = story_format_version;
        }

        Ok(vec![Patch::ProjectSnapshotReplaced {
            snapshot: self.snapshot(),
        }])
    }

    fn set_story_snap_to_grid(
        &mut self,
        story_id: &str,
        enabled: bool,
    ) -> Result<Vec<Patch>, CoreError> {
        {
            let story = self.story_mut(story_id)?;

            story.snap_to_grid = enabled;
        }

        Ok(vec![Patch::ProjectSnapshotReplaced {
            snapshot: self.snapshot(),
        }])
    }

    fn set_story_zoom(&mut self, story_id: &str, zoom: f64) -> Result<Vec<Patch>, CoreError> {
        {
            let story = self.story_mut(story_id)?;

            story.zoom = zoom;
        }

        Ok(vec![Patch::ProjectSnapshotReplaced {
            snapshot: self.snapshot(),
        }])
    }

    fn story_index(
        &self,
        story_id: &str,
        options: CoreStoryIndexOptions,
    ) -> Result<CoreStoryIndex, CoreError> {
        let story = self.story(story_id)?;
        let graph =
            (options.include_graph || options.include_diagnostics || options.include_contents)
                .then(|| GraphIndex::from_story(story));
        let metadata_source_id = format!("{}:metadata", story.id.as_ref());
        let script_source_id = format!("{}:script", story.id.as_ref());
        let stylesheet_source_id = format!("{}:stylesheet", story.id.as_ref());
        let search_enabled = has_search_query(&options);
        let search_pattern = search_pattern(&options);
        let mut diagnostics = Vec::new();
        let mut files = Vec::new();
        let mut tag_usage = BTreeMap::<String, BTreeSet<String>>::new();
        let mut search_hits = Vec::new();
        let mut symbols = Vec::new();
        let mut assets = Vec::new();

        for passage in story.passages.iter() {
            for tag in &passage.tags {
                tag_usage
                    .entry(tag.clone())
                    .or_default()
                    .insert(passage.id.as_ref().to_owned());
            }

            if options.include_files {
                files.push(CoreSourceFile {
                    character_count: passage.text.len(),
                    id: passage.id.as_ref().to_owned(),
                    kind: CoreSourceKind::Passage,
                    line_count: line_count(&passage.text),
                    name: passage.name.clone(),
                    passage_id: Some(passage.id.as_ref().to_owned()),
                    tags: passage.tags.clone(),
                });
            }

            if search_enabled && options.include_passage_names {
                search_hits.extend(search_hits_in_source(
                    &options,
                    search_pattern.as_ref(),
                    passage.id.as_ref(),
                    &passage.name,
                    &passage.name,
                    CoreSearchScope::PassageName,
                    Some(passage.id.as_ref()),
                ));
            }

            if search_enabled && options.include_passage_text {
                search_hits.extend(search_hits_in_source(
                    &options,
                    search_pattern.as_ref(),
                    passage.id.as_ref(),
                    &passage.name,
                    &passage.text,
                    CoreSearchScope::PassageText,
                    Some(passage.id.as_ref()),
                ));
            }

            if search_enabled && options.include_tags {
                for tag in &passage.tags {
                    search_hits.extend(search_hits_in_source(
                        &options,
                        search_pattern.as_ref(),
                        passage.id.as_ref(),
                        &passage.name,
                        tag,
                        CoreSearchScope::PassageTag,
                        Some(passage.id.as_ref()),
                    ));
                }
            }

            if options.include_variables {
                symbols.extend(symbols_in_source(
                    passage.id.as_ref(),
                    &passage.name,
                    &passage.text,
                    CoreSearchScope::PassageText,
                    Some(passage.id.as_ref()),
                ));
            }

            if options.include_assets {
                assets.extend(asset_references_in_source(
                    passage.id.as_ref(),
                    &passage.name,
                    &passage.text,
                    Some(passage.id.as_ref()),
                ));
            }
        }

        if options.include_files {
            files.push(CoreSourceFile {
                character_count: story.script.len(),
                id: script_source_id.clone(),
                kind: CoreSourceKind::Script,
                line_count: line_count(&story.script),
                name: "Story JavaScript".into(),
                passage_id: None,
                tags: Vec::new(),
            });
            files.push(CoreSourceFile {
                character_count: story.stylesheet.len(),
                id: stylesheet_source_id.clone(),
                kind: CoreSourceKind::Stylesheet,
                line_count: line_count(&story.stylesheet),
                name: "Story Stylesheet".into(),
                passage_id: None,
                tags: Vec::new(),
            });
        }

        if search_enabled && options.include_diagnostics {
            if let Err(error) = &search_pattern {
                diagnostics.push(CoreDiagnostic {
                    code: "invalid-search-regex".into(),
                    end: options.query.as_ref().map_or(0, String::len),
                    line: 1,
                    message: format!("Search regular expression is invalid: {error}"),
                    passage_id: None,
                    quick_fixes: vec![CoreQuickFix {
                        command: "disable-regex-search".into(),
                        title: "Turn off regular expressions".into(),
                    }],
                    severity: CoreDiagnosticSeverity::Error,
                    source_id: metadata_source_id.clone(),
                    start: 0,
                });
            }
        }

        if search_enabled {
            let metadata_source = story_metadata_source(story);
            search_hits.extend(search_hits_in_source(
                &options,
                search_pattern.as_ref(),
                &metadata_source_id,
                "Story Metadata",
                &metadata_source,
                CoreSearchScope::Metadata,
                None,
            ));
        }

        if search_enabled && options.include_script {
            search_hits.extend(search_hits_in_source(
                &options,
                search_pattern.as_ref(),
                &script_source_id,
                "Story JavaScript",
                &story.script,
                CoreSearchScope::Script,
                None,
            ));
        }

        if search_enabled && options.include_stylesheet {
            search_hits.extend(search_hits_in_source(
                &options,
                search_pattern.as_ref(),
                &stylesheet_source_id,
                "Story Stylesheet",
                &story.stylesheet,
                CoreSearchScope::Stylesheet,
                None,
            ));
        }

        if options.include_variables {
            symbols.extend(symbols_in_source(
                &script_source_id,
                "Story JavaScript",
                &story.script,
                CoreSearchScope::Script,
                None,
            ));
            symbols.extend(symbols_in_source(
                &stylesheet_source_id,
                "Story Stylesheet",
                &story.stylesheet,
                CoreSearchScope::Stylesheet,
                None,
            ));
        }

        if options.include_assets {
            assets.extend(asset_references_in_source(
                &script_source_id,
                "Story JavaScript",
                &story.script,
                None,
            ));
            assets.extend(asset_references_in_source(
                &stylesheet_source_id,
                "Story Stylesheet",
                &story.stylesheet,
                None,
            ));
        }

        let mut asset_inventory = if options.include_assets {
            let known_assets = self.known_asset_inventory(&options.known_assets)?;

            asset_inventory_from_references(&assets, known_assets, self.asset_root.is_some())
        } else {
            Vec::new()
        };

        if search_enabled && options.include_variables {
            for symbol in &symbols {
                search_hits.extend(search_hits_in_source(
                    &options,
                    search_pattern.as_ref(),
                    &symbol.source_id,
                    &symbol.source_name,
                    &symbol.name,
                    CoreSearchScope::Variable,
                    symbol.passage_id.as_deref(),
                ));
            }
        }

        if search_enabled && options.include_assets {
            for asset in &asset_inventory {
                let location = asset_search_location(story, asset);

                search_hits.extend(search_hits_in_source(
                    &options,
                    search_pattern.as_ref(),
                    &location.source_id,
                    &location.source_name,
                    &asset.path,
                    CoreSearchScope::Asset,
                    location.passage_id.as_deref(),
                ));
            }
        }

        if options.include_diagnostics {
            if let Some(graph) = &graph {
                for broken_link in graph.broken_links() {
                    let (line, start, end) = story
                        .passage_by_id(&broken_link.source)
                        .and_then(|passage| {
                            locate_link_target(&passage.text, &broken_link.target_name)
                        })
                        .unwrap_or((1, 0, broken_link.target_name.len()));

                    diagnostics.push(CoreDiagnostic {
                        code: "broken-link".into(),
                        end,
                        line,
                        message: format!("Broken link to \"{}\"", broken_link.target_name),
                        passage_id: Some(broken_link.source.as_ref().to_owned()),
                        quick_fixes: vec![
                            CoreQuickFix {
                                command: format!("create-passage:{}", broken_link.target_name),
                                title: format!("Create \"{}\"", broken_link.target_name),
                            },
                            CoreQuickFix {
                                command: "rename-link-target".into(),
                                title: "Change link target".into(),
                            },
                        ],
                        severity: CoreDiagnosticSeverity::Warning,
                        source_id: broken_link.source.as_ref().to_owned(),
                        start,
                    });
                }
            }

            for duplicate in duplicate_passage_names(story) {
                diagnostics.push(CoreDiagnostic {
                    code: "duplicate-passage-name".into(),
                    end: duplicate.name.len(),
                    line: 1,
                    message: format!("Duplicate passage name \"{}\"", duplicate.name),
                    passage_id: Some(duplicate.passage_id.clone()),
                    quick_fixes: vec![CoreQuickFix {
                        command: "rename-passage".into(),
                        title: "Rename passage".into(),
                    }],
                    severity: CoreDiagnosticSeverity::Error,
                    source_id: duplicate.passage_id,
                    start: 0,
                });
            }

            if story.passage_by_id(&story.start_passage).is_none() {
                diagnostics.push(CoreDiagnostic {
                    code: "missing-start-passage".into(),
                    end: 0,
                    line: 1,
                    message: "Story start passage is missing".into(),
                    passage_id: None,
                    quick_fixes: vec![CoreQuickFix {
                        command: "set-start-passage".into(),
                        title: "Choose a start passage".into(),
                    }],
                    severity: CoreDiagnosticSeverity::Error,
                    source_id: metadata_source_id.clone(),
                    start: 0,
                });
            }

            diagnostics.extend(asset_diagnostics(
                story,
                &metadata_source_id,
                &asset_inventory,
            ));
        }

        asset_inventory.sort_by(|left, right| left.path.cmp(&right.path));

        search_hits.sort_by(|left, right| {
            right
                .rank
                .total_cmp(&left.rank)
                .then_with(|| left.source_name.cmp(&right.source_name))
                .then_with(|| left.line.cmp(&right.line))
                .then_with(|| left.start.cmp(&right.start))
        });
        search_hits.truncate(MAX_SEARCH_HITS);

        let replace_previews = search_hits
            .iter()
            .filter_map(CoreReplacePreview::from_hit)
            .collect::<Vec<_>>();
        let tag_entries = tag_entries(story, tag_usage);
        let tags = tag_entries
            .iter()
            .map(|entry| entry.name.clone())
            .collect::<Vec<_>>();
        let contents = if options.include_contents {
            contents_entries(
                story,
                &files,
                &tag_entries,
                &symbols,
                &asset_inventory,
                &diagnostics,
                graph
                    .as_ref()
                    .expect("graph index should exist when contents are included"),
                &metadata_source_id,
            )
        } else {
            Vec::new()
        };
        let graph_stats = if options.include_graph {
            graph
                .as_ref()
                .map(|graph| graph.stats().clone().into())
                .unwrap_or_default()
        } else {
            CoreGraphStats::default()
        };

        Ok(CoreStoryIndex {
            asset_inventory,
            assets,
            contents,
            diagnostics,
            files,
            graph: graph_stats,
            replace_previews,
            search_hits,
            story_id: story_id.to_owned(),
            tags,
            tag_entries,
            symbols,
        })
    }

    fn asset_root(&self) -> Result<&Path, CoreError> {
        self.asset_root
            .as_deref()
            .ok_or(CoreError::AssetHostUnavailable)
    }

    fn known_asset_inventory(
        &self,
        extra_assets: &[CoreAssetInventoryEntry],
    ) -> Result<Vec<CoreAssetInventoryEntry>, CoreError> {
        let mut assets = extra_assets.to_vec();

        if let Some(asset_root) = &self.asset_root {
            assets.extend(file_asset_inventory(asset_root)?);
        }

        Ok(assets)
    }

    fn asset_inventory_patch(&self, story_id: &str) -> Result<Patch, CoreError> {
        let index = self.story_index(story_id, CoreStoryIndexOptions::default())?;

        Ok(Patch::AssetInventoryUpdated {
            inventory: index.asset_inventory,
            story_id: story_id.to_owned(),
        })
    }

    fn copy_asset_snippet(
        &self,
        story_id: &str,
        path: &str,
        snippet: Option<String>,
    ) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let snippet = snippet.unwrap_or_else(|| {
            let kind = asset_kind_for_path(path);

            asset_snippet(path, &kind).text
        });

        Ok(vec![Patch::AssetSnippetCopied {
            path: path.to_owned(),
            snippet,
            story_id: story_id.to_owned(),
        }])
    }

    fn delete_asset(
        &mut self,
        story_id: &str,
        path: &str,
        remove_references: bool,
    ) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let asset_root = self.asset_root()?.to_path_buf();
        let asset_path = AssetPath::parse(path)?;
        let disk_path = asset_path.disk_path(&asset_root);

        if !disk_path.is_file() {
            return Err(CoreError::AssetFileNotFound(asset_path.project_path));
        }

        fs::remove_file(&disk_path).map_err(core_io_error)?;

        let mut patches = vec![Patch::AssetDeleted {
            path: asset_path.project_path.clone(),
            story_id: story_id.to_owned(),
        }];

        if remove_references {
            patches.extend(self.replace_asset_references(
                story_id,
                &asset_path.project_path,
                "",
            )?);
        }

        patches.push(self.asset_inventory_patch(story_id)?);
        Ok(patches)
    }

    fn import_asset(
        &mut self,
        story_id: &str,
        source_path: &str,
        target_path: Option<String>,
        overwrite: bool,
    ) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let asset_root = self.asset_root()?.to_path_buf();
        let source = PathBuf::from(source_path);

        if !source.is_file() {
            return Err(CoreError::AssetFileNotFound(source_path.into()));
        }

        let target = match target_path {
            Some(path) => AssetPath::parse(&path)?,
            None => {
                let Some(file_name) = source.file_name().and_then(|name| name.to_str()) else {
                    return Err(CoreError::UnsafeAssetPath(source_path.into()));
                };

                AssetPath::parse(file_name)?
            }
        };
        let disk_path = target.disk_path(&asset_root);

        if disk_path.exists() && !overwrite {
            return Err(CoreError::AssetAlreadyExists(target.project_path));
        }

        if let Some(parent) = disk_path.parent() {
            fs::create_dir_all(parent).map_err(core_io_error)?;
        }

        fs::copy(&source, &disk_path).map_err(core_io_error)?;

        let asset = file_asset_inventory_entry(&asset_root, &disk_path)?;

        Ok(vec![
            Patch::AssetImported {
                asset,
                story_id: story_id.to_owned(),
            },
            self.asset_inventory_patch(story_id)?,
        ])
    }

    fn insert_asset_snippet(
        &mut self,
        story_id: &str,
        path: &str,
        source_id: &str,
        passage_id: Option<&str>,
        position: usize,
        snippet: Option<String>,
    ) -> Result<Vec<Patch>, CoreError> {
        let snippet = snippet.unwrap_or_else(|| {
            let kind = asset_kind_for_path(path);

            asset_snippet(path, &kind).text
        });
        let mut patches =
            self.insert_source_text(story_id, source_id, passage_id, position, &snippet)?;

        patches.push(Patch::AssetSnippetInserted {
            path: path.into(),
            snippet,
            source_id: source_id.into(),
            story_id: story_id.into(),
        });
        Ok(patches)
    }

    fn rename_asset(
        &mut self,
        story_id: &str,
        path: &str,
        new_path: &str,
        update_references: bool,
    ) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let asset_root = self.asset_root()?.to_path_buf();
        let old_asset = AssetPath::parse(path)?;
        let new_asset = AssetPath::parse(new_path)?;
        let old_disk_path = old_asset.disk_path(&asset_root);
        let new_disk_path = new_asset.disk_path(&asset_root);

        if !old_disk_path.is_file() {
            return Err(CoreError::AssetFileNotFound(old_asset.project_path));
        }

        if new_disk_path.exists() {
            return Err(CoreError::AssetAlreadyExists(new_asset.project_path));
        }

        if let Some(parent) = new_disk_path.parent() {
            fs::create_dir_all(parent).map_err(core_io_error)?;
        }

        fs::rename(&old_disk_path, &new_disk_path).map_err(core_io_error)?;

        let mut patches = vec![Patch::AssetRenamed {
            new_path: new_asset.project_path.clone(),
            old_path: old_asset.project_path.clone(),
            story_id: story_id.to_owned(),
        }];

        if update_references {
            patches.extend(self.replace_asset_references(
                story_id,
                &old_asset.project_path,
                &new_asset.project_path,
            )?);
        }

        patches.push(self.asset_inventory_patch(story_id)?);
        Ok(patches)
    }

    fn replace_asset(
        &mut self,
        story_id: &str,
        path: &str,
        source_path: &str,
    ) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let asset_root = self.asset_root()?.to_path_buf();
        let asset = AssetPath::parse(path)?;
        let disk_path = asset.disk_path(&asset_root);
        let source = PathBuf::from(source_path);

        if !disk_path.is_file() {
            return Err(CoreError::AssetFileNotFound(asset.project_path));
        }

        if !source.is_file() {
            return Err(CoreError::AssetFileNotFound(source_path.into()));
        }

        fs::copy(source, &disk_path).map_err(core_io_error)?;

        let asset = file_asset_inventory_entry(&asset_root, &disk_path)?;

        Ok(vec![
            Patch::AssetReplaced {
                asset,
                story_id: story_id.to_owned(),
            },
            self.asset_inventory_patch(story_id)?,
        ])
    }

    fn reveal_asset(&self, story_id: &str, path: &str) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        let asset_root = self.asset_root()?.to_path_buf();
        let asset = AssetPath::parse(path)?;
        let disk_path = asset.disk_path(&asset_root);

        if !disk_path.is_file() {
            return Err(CoreError::AssetFileNotFound(asset.project_path));
        }

        Ok(vec![Patch::AssetRevealed {
            path: asset.project_path,
            reveal_path: disk_path.to_string_lossy().into_owned(),
            story_id: story_id.into(),
        }])
    }

    fn validate_asset_references(&self, story_id: &str) -> Result<Vec<Patch>, CoreError> {
        self.story(story_id)?;

        Ok(vec![self.asset_inventory_patch(story_id)?])
    }

    fn story(&self, story_id: &str) -> Result<&Story, CoreError> {
        self.project
            .stories
            .iter()
            .find(|story| story.id.as_ref() == story_id)
            .ok_or_else(|| CoreError::StoryNotFound(story_id.to_owned()))
    }

    fn story_mut(&mut self, story_id: &str) -> Result<&mut Story, CoreError> {
        self.project
            .stories
            .iter_mut()
            .find(|story| story.id.as_ref() == story_id)
            .ok_or_else(|| CoreError::StoryNotFound(story_id.to_owned()))
    }

    fn insert_source_text(
        &mut self,
        story_id: &str,
        source_id: &str,
        passage_id: Option<&str>,
        position: usize,
        text: &str,
    ) -> Result<Vec<Patch>, CoreError> {
        let source_id_passage = passage_id
            .map(PassageId::new)
            .or_else(|| Some(PassageId::new(source_id)));

        if let Some(passage_id) = source_id_passage {
            let story = self.story_mut(story_id)?;

            if let Some(passage) = story.passage_by_id_mut(&passage_id) {
                let position = clamped_char_boundary(&passage.text, position);

                passage.text.insert_str(position, text);
                return Ok(vec![Patch::PassageUpdated {
                    changes: PassagePatch {
                        text: Some(passage.text.clone()),
                        ..PassagePatch::default()
                    },
                    passage_id: passage_id.as_ref().to_owned(),
                    story_id: story_id.to_owned(),
                }]);
            }
        }

        if source_id.ends_with(":script") {
            let story = self.story_mut(story_id)?;
            let position = clamped_char_boundary(&story.script, position);

            story.script.insert_str(position, text);
            return Ok(vec![Patch::StoryScriptUpdated {
                script: story.script.clone(),
                story_id: story_id.to_owned(),
            }]);
        }

        if source_id.ends_with(":stylesheet") {
            let story = self.story_mut(story_id)?;
            let position = clamped_char_boundary(&story.stylesheet, position);

            story.stylesheet.insert_str(position, text);
            return Ok(vec![Patch::StoryStylesheetUpdated {
                story_id: story_id.to_owned(),
                stylesheet: story.stylesheet.clone(),
            }]);
        }

        Err(CoreError::PassageNotFound(source_id.to_owned()))
    }

    fn replace_asset_references(
        &mut self,
        story_id: &str,
        old_path: &str,
        new_path: &str,
    ) -> Result<Vec<Patch>, CoreError> {
        let old_normalized = normalized_asset_path(old_path);
        let story = self.story_mut(story_id)?;
        let mut patches = Vec::new();

        for passage in story.passages.iter_mut() {
            let replaced =
                replace_asset_references_in_source(&passage.text, &old_normalized, new_path);

            if replaced != passage.text {
                passage.text = replaced.clone();
                patches.push(Patch::PassageUpdated {
                    changes: PassagePatch {
                        text: Some(replaced),
                        ..PassagePatch::default()
                    },
                    passage_id: passage.id.as_ref().to_owned(),
                    story_id: story_id.to_owned(),
                });
            }
        }

        let script = replace_asset_references_in_source(&story.script, &old_normalized, new_path);

        if script != story.script {
            story.script = script.clone();
            patches.push(Patch::StoryScriptUpdated {
                script,
                story_id: story_id.to_owned(),
            });
        }

        let stylesheet =
            replace_asset_references_in_source(&story.stylesheet, &old_normalized, new_path);

        if stylesheet != story.stylesheet {
            story.stylesheet = stylesheet.clone();
            patches.push(Patch::StoryStylesheetUpdated {
                story_id: story_id.to_owned(),
                stylesheet,
            });
        }

        Ok(patches)
    }

    fn update_passage_text(
        &mut self,
        story_id: &str,
        passage_id: &str,
        text: String,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;
        let passage_id = PassageId::new(passage_id);
        let passage = story
            .passage_by_id_mut(&passage_id)
            .ok_or_else(|| CoreError::PassageNotFound(passage_id.as_ref().to_owned()))?;

        if passage.text == text {
            return Ok(Vec::new());
        }

        passage.text = text.clone();
        Ok(vec![Patch::PassageUpdated {
            changes: PassagePatch {
                text: Some(text),
                ..PassagePatch::default()
            },
            passage_id: passage_id.as_ref().to_owned(),
            story_id: story_id.to_owned(),
        }])
    }

    fn update_story_script(
        &mut self,
        story_id: &str,
        script: String,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;

        if story.script == script {
            return Ok(Vec::new());
        }

        story.script = script.clone();
        Ok(vec![Patch::StoryScriptUpdated {
            script,
            story_id: story_id.to_owned(),
        }])
    }

    fn update_story_stylesheet(
        &mut self,
        story_id: &str,
        stylesheet: String,
    ) -> Result<Vec<Patch>, CoreError> {
        let story = self.story_mut(story_id)?;

        if story.stylesheet == stylesheet {
            return Ok(Vec::new());
        }

        story.stylesheet = stylesheet.clone();
        Ok(vec![Patch::StoryStylesheetUpdated {
            story_id: story_id.to_owned(),
            stylesheet,
        }])
    }
}

fn default_true() -> bool {
    true
}

fn default_zoom() -> f64 {
    1.0
}

fn next_passage_id(story: &Story) -> String {
    let mut suffix = story.passage_count() + 1;

    loop {
        let candidate = format!("passage-{suffix}");

        if story
            .passages
            .iter()
            .all(|passage| passage.id.as_ref() != candidate)
        {
            return candidate;
        }

        suffix += 1;
    }
}

fn push_dirty_patch(patches: &mut Vec<Patch>, before: bool, after: bool) {
    if before != after {
        patches.push(Patch::DirtyStateChanged { dirty: after });
    }
}

fn core_io_error(error: std::io::Error) -> CoreError {
    CoreError::Io(error.to_string())
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AssetPath {
    asset_relative_path: PathBuf,
    project_path: String,
}

impl AssetPath {
    fn parse(path: &str) -> Result<Self, CoreError> {
        let Some(normalized) = local_asset_reference_path(path) else {
            return Err(CoreError::UnsafeAssetPath(path.into()));
        };
        let normalized = normalized
            .strip_prefix("assets/")
            .expect("local asset reference path should use assets/ prefix");

        if normalized.trim().is_empty() {
            return Err(CoreError::UnsafeAssetPath(path.into()));
        }

        let mut asset_relative_path = PathBuf::new();

        for component in Path::new(normalized).components() {
            match component {
                Component::Normal(value) => asset_relative_path.push(value),
                Component::CurDir => {}
                Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                    return Err(CoreError::UnsafeAssetPath(path.into()));
                }
            }
        }

        if asset_relative_path.as_os_str().is_empty() || asset_relative_path.file_name().is_none() {
            return Err(CoreError::UnsafeAssetPath(path.into()));
        }

        Ok(Self {
            project_path: format!("assets/{}", path_string(&asset_relative_path)),
            asset_relative_path,
        })
    }

    fn disk_path(&self, asset_root: &Path) -> PathBuf {
        asset_root.join(&self.asset_relative_path)
    }
}

fn path_string(path: &Path) -> String {
    path.iter()
        .map(|component| component.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn file_url(path: &Path) -> String {
    let mut path = path.to_string_lossy().replace('\\', "/");

    if !path.starts_with('/') {
        path = format!("/{path}");
    }

    format!("file://{}", percent_encode_file_path(&path))
}

fn percent_encode_file_path(path: &str) -> String {
    let mut output = String::new();

    for byte in path.bytes() {
        let is_unreserved =
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/' | b':');

        if is_unreserved {
            output.push(char::from(byte));
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }

    output
}

fn file_asset_inventory(asset_root: &Path) -> Result<Vec<CoreAssetInventoryEntry>, CoreError> {
    let mut entries = Vec::new();

    if !asset_root.exists() {
        return Ok(entries);
    }

    collect_file_asset_inventory(asset_root, asset_root, &mut entries)?;
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

fn collect_file_asset_inventory(
    asset_root: &Path,
    current: &Path,
    entries: &mut Vec<CoreAssetInventoryEntry>,
) -> Result<(), CoreError> {
    for entry in fs::read_dir(current).map_err(core_io_error)? {
        let entry = entry.map_err(core_io_error)?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(core_io_error)?;

        if file_type.is_dir() {
            collect_file_asset_inventory(asset_root, &path, entries)?;
        } else if file_type.is_file() {
            entries.push(file_asset_inventory_entry(asset_root, &path)?);
        }
    }

    Ok(())
}

fn file_asset_inventory_entry(
    asset_root: &Path,
    disk_path: &Path,
) -> Result<CoreAssetInventoryEntry, CoreError> {
    let relative = disk_path
        .strip_prefix(asset_root)
        .map_err(|_| CoreError::UnsafeAssetPath(disk_path.to_string_lossy().into_owned()))?;
    let path = format!("assets/{}", path_string(relative));
    let kind = asset_kind_for_path(&path);
    let metadata = fs::metadata(disk_path).map_err(core_io_error)?;
    let missing = false;
    let dimensions = image_dimensions(disk_path);
    let preview_url = Some(file_url(disk_path));
    let thumbnail_url = if kind == "image" {
        preview_url.clone()
    } else {
        None
    };

    Ok(CoreAssetInventoryEntry {
        duration_ms: None,
        exists: Some(true),
        height: dimensions.map(|(_, height)| height),
        kind: kind.clone(),
        missing,
        modified_at: metadata_modified_at(&metadata),
        normalized_path: normalized_asset_path(&path),
        path: path.clone(),
        preview_url,
        publish: asset_publish_rule(&path, missing),
        reference_count: 0,
        references: Vec::new(),
        size_bytes: usize::try_from(metadata.len()).ok(),
        snippet: asset_snippet(&path, &kind),
        thumbnail_url,
        unused: true,
        width: dimensions.map(|(width, _)| width),
    })
}

fn metadata_modified_at(metadata: &fs::Metadata) -> Option<String> {
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;

    Some(duration.as_millis().to_string())
}

fn image_dimensions(path: &Path) -> Option<(usize, usize)> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();

    match extension.as_str() {
        "gif" => gif_dimensions(path),
        "jpg" | "jpeg" => jpeg_dimensions(path),
        "png" => png_dimensions(path),
        "svg" => svg_dimensions(path),
        _ => None,
    }
}

fn png_dimensions(path: &Path) -> Option<(usize, usize)> {
    let mut bytes = [0; 24];
    let mut file = fs::File::open(path).ok()?;

    file.read_exact(&mut bytes).ok()?;

    if &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }

    Some((
        u32::from_be_bytes(bytes[16..20].try_into().ok()?) as usize,
        u32::from_be_bytes(bytes[20..24].try_into().ok()?) as usize,
    ))
}

fn gif_dimensions(path: &Path) -> Option<(usize, usize)> {
    let mut bytes = [0; 10];
    let mut file = fs::File::open(path).ok()?;

    file.read_exact(&mut bytes).ok()?;

    if &bytes[0..3] != b"GIF" {
        return None;
    }

    Some((
        u16::from_le_bytes(bytes[6..8].try_into().ok()?) as usize,
        u16::from_le_bytes(bytes[8..10].try_into().ok()?) as usize,
    ))
}

fn jpeg_dimensions(path: &Path) -> Option<(usize, usize)> {
    let bytes = fs::read(path).ok()?;

    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }

    let mut index = 2;

    while index + 9 < bytes.len() {
        if bytes[index] != 0xff {
            index += 1;
            continue;
        }

        while index < bytes.len() && bytes[index] == 0xff {
            index += 1;
        }

        if index >= bytes.len() {
            return None;
        }

        let marker = bytes[index];
        index += 1;

        if marker == 0xda || marker == 0xd9 {
            return None;
        }

        if index + 2 > bytes.len() {
            return None;
        }

        let length = u16::from_be_bytes(bytes[index..index + 2].try_into().ok()?) as usize;

        if length < 2 || index + length > bytes.len() {
            return None;
        }

        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) && length >= 7
        {
            let height = u16::from_be_bytes(bytes[index + 3..index + 5].try_into().ok()?) as usize;
            let width = u16::from_be_bytes(bytes[index + 5..index + 7].try_into().ok()?) as usize;

            return Some((width, height));
        }

        index += length;
    }

    None
}

fn svg_dimensions(path: &Path) -> Option<(usize, usize)> {
    let source = fs::read_to_string(path).ok()?;

    Some((
        svg_dimension(&source, "width")?,
        svg_dimension(&source, "height")?,
    ))
}

fn svg_dimension(source: &str, attribute: &str) -> Option<usize> {
    let regex = regex::Regex::new(&format!(r#"{attribute}\s*=\s*["']([0-9]+)"#)).ok()?;
    let value = regex.captures(source)?.get(1)?.as_str();

    value.parse().ok()
}

fn clamped_char_boundary(text: &str, position: usize) -> usize {
    let mut position = position.min(text.len());

    while !text.is_char_boundary(position) {
        position -= 1;
    }

    position
}

fn replace_asset_references_in_source(
    source: &str,
    old_normalized: &str,
    new_path: &str,
) -> String {
    let references = asset_references_in_source("", "", source, None);
    let mut output = String::with_capacity(source.len());
    let mut cursor = 0;
    let mut changed = false;

    for reference in references {
        if normalized_asset_path(&reference.path) != old_normalized {
            continue;
        }

        output.push_str(&source[cursor..reference.start]);
        output.push_str(new_path);
        cursor = reference.end;
        changed = true;
    }

    if !changed {
        return source.into();
    }

    output.push_str(&source[cursor..]);
    output
}

fn line_count(text: &str) -> usize {
    text.lines().count().max(1)
}

const MAX_SEARCH_HITS: usize = 500;

fn has_search_query(options: &CoreStoryIndexOptions) -> bool {
    options
        .query
        .as_deref()
        .is_some_and(|query| !query.trim().is_empty())
}

fn search_hits_in_source(
    options: &CoreStoryIndexOptions,
    search_pattern: Result<&regex::Regex, &String>,
    source_id: &str,
    source_name: &str,
    source: &str,
    scope: CoreSearchScope,
    passage_id: Option<&str>,
) -> Vec<CoreSearchHit> {
    let query = options.query.as_deref().unwrap_or_default().trim();

    if query.is_empty() || search_pattern.is_err() {
        return Vec::new();
    }

    let Ok(regex) = search_pattern else {
        return Vec::new();
    };
    let mut hits = Vec::new();

    for captures in regex.captures_iter(source).take(MAX_SEARCH_HITS) {
        let Some(matched) = captures.get(0) else {
            continue;
        };

        if matched.start() == matched.end() {
            continue;
        }

        hits.push(search_hit(
            options,
            Some(&captures),
            source_id,
            source_name,
            source,
            scope.clone(),
            passage_id,
            matched.start(),
            matched.end(),
            scope_rank(&scope) + exact_rank_bonus(matched.start()),
        ));
    }

    if hits.is_empty() && options.fuzzy {
        if let Some((start, end, score)) = fuzzy_match(source, query, options.match_case) {
            hits.push(search_hit(
                options,
                None,
                source_id,
                source_name,
                source,
                scope.clone(),
                passage_id,
                start,
                end,
                scope_rank(&scope) * 0.7 + score,
            ));
        }
    }

    hits
}

#[allow(clippy::too_many_arguments)]
fn search_hit(
    options: &CoreStoryIndexOptions,
    captures: Option<&regex::Captures<'_>>,
    source_id: &str,
    source_name: &str,
    source: &str,
    scope: CoreSearchScope,
    passage_id: Option<&str>,
    start: usize,
    end: usize,
    rank: f32,
) -> CoreSearchHit {
    let replacement = options.replacement.as_ref().map(|replacement| {
        if options.use_regexes {
            let mut expanded = String::new();

            if let Some(captures) = captures {
                captures.expand(replacement, &mut expanded);
            } else {
                expanded.push_str(replacement);
            }

            expanded
        } else {
            replacement.clone()
        }
    });
    let (before, after) = replacement
        .as_ref()
        .map(|replacement| replacement_preview(source, start, end, replacement))
        .map_or((None, None), |(before, after)| (Some(before), Some(after)));

    CoreSearchHit {
        after,
        before,
        end,
        excerpt: excerpt_around(source, start, end.saturating_sub(start)),
        line: line_number_at(source, start),
        match_text: source[start..end].to_owned(),
        passage_id: passage_id.map(str::to_owned),
        rank,
        replacement,
        scope,
        source_id: source_id.to_owned(),
        source_name: source_name.to_owned(),
        start,
    }
}

fn search_pattern(options: &CoreStoryIndexOptions) -> Result<regex::Regex, String> {
    let query = options.query.as_deref().unwrap_or_default().trim();

    if query.is_empty() {
        return regex::Regex::new("$^").map_err(|error| error.to_string());
    }

    let pattern = if options.use_regexes {
        query.to_owned()
    } else {
        regex::escape(query)
    };

    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!options.match_case)
        .build()
        .map_err(|error| error.to_string())
}

fn scope_rank(scope: &CoreSearchScope) -> f32 {
    match scope {
        CoreSearchScope::PassageName => 100.0,
        CoreSearchScope::PassageTag => 88.0,
        CoreSearchScope::Variable => 82.0,
        CoreSearchScope::Metadata => 78.0,
        CoreSearchScope::PassageText => 70.0,
        CoreSearchScope::Script => 62.0,
        CoreSearchScope::Stylesheet => 58.0,
        CoreSearchScope::Asset => 52.0,
    }
}

fn exact_rank_bonus(start: usize) -> f32 {
    1.0 / (1.0 + start as f32)
}

fn fuzzy_match(source: &str, query: &str, match_case: bool) -> Option<(usize, usize, f32)> {
    let searchable = if match_case {
        source.to_owned()
    } else {
        source.to_lowercase()
    };
    let needle = if match_case {
        query.to_owned()
    } else {
        query.to_lowercase()
    };
    let mut needle_chars = needle.chars();
    let mut current = needle_chars.next()?;
    let mut start = None;
    let mut end;
    let mut matched = 0usize;

    for (index, character) in searchable.char_indices() {
        if character == current {
            start.get_or_insert(index);
            end = index + character.len_utf8();
            matched += 1;

            if let Some(next) = needle_chars.next() {
                current = next;
            } else {
                let span = end.saturating_sub(start.unwrap_or(0)).max(1);
                let density = matched as f32 / span as f32;

                return Some((start.unwrap_or(0), end, density));
            }
        }
    }

    None
}

fn replacement_preview(
    source: &str,
    start: usize,
    end: usize,
    replacement: &str,
) -> (String, String) {
    let line_start = source[..start].rfind('\n').map_or(0, |index| index + 1);
    let line_end = source[start..]
        .find('\n')
        .map_or(source.len(), |index| start + index);
    let before = source[line_start..line_end].trim().to_owned();
    let mut after = String::new();

    after.push_str(&source[line_start..start]);
    after.push_str(replacement);
    after.push_str(&source[end..line_end]);

    (before, after.trim().to_owned())
}

fn line_number_at(source: &str, start: usize) -> usize {
    source[..start]
        .chars()
        .filter(|character| *character == '\n')
        .count()
        + 1
}

fn excerpt_around(source: &str, start: usize, length: usize) -> String {
    let line_start = source[..start].rfind('\n').map_or(0, |index| index + 1);
    let line_end = source[start..]
        .find('\n')
        .map_or(source.len(), |index| start + index);
    let excerpt = source[line_start..line_end].trim();

    if excerpt.len() <= 140 {
        return excerpt.into();
    }

    let window_start = start.saturating_sub(48).max(line_start);
    let window_end = (start + length + 48).min(line_end);
    let mut result = String::new();

    if window_start > line_start {
        result.push_str("...");
    }

    result.push_str(source[window_start..window_end].trim());

    if window_end < line_end {
        result.push_str("...");
    }

    result
}

fn story_metadata_source(story: &Story) -> String {
    format!(
        "Name: {}\nIFID: {}\nStory format: {} {}\nStory tags: {}",
        story.name,
        story.ifid,
        story.story_format,
        story.story_format_version,
        story.tags.join(", ")
    )
}

fn symbols_in_source(
    source_id: &str,
    source_name: &str,
    source: &str,
    scope: CoreSearchScope,
    passage_id: Option<&str>,
) -> Vec<CoreSymbol> {
    let mut symbols = Vec::new();
    let bytes = source.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        let prefix = bytes[index];

        if (prefix == b'$' || prefix == b'_')
            && (index == 0 || !is_identifier_byte(bytes[index.saturating_sub(1)]))
            && bytes
                .get(index + 1)
                .is_some_and(|byte| is_identifier_start(*byte))
        {
            let start = index;

            index += 2;
            while bytes
                .get(index)
                .is_some_and(|byte| is_identifier_byte(*byte))
            {
                index += 1;
            }

            symbols.push(CoreSymbol {
                end: index,
                excerpt: excerpt_around(source, start, index - start),
                kind: if prefix == b'$' {
                    CoreSymbolKind::Variable
                } else {
                    CoreSymbolKind::TemporaryVariable
                },
                line: line_number_at(source, start),
                name: source[start..index].to_owned(),
                passage_id: passage_id.map(str::to_owned),
                scope: scope.clone(),
                source_id: source_id.to_owned(),
                source_name: source_name.to_owned(),
                start,
            });
            continue;
        }

        if (prefix == b'|' || prefix == b'?')
            && bytes
                .get(index + 1)
                .is_some_and(|byte| is_identifier_start(*byte))
        {
            let start = index;

            index += 2;
            while bytes
                .get(index)
                .is_some_and(|byte| is_identifier_byte(*byte))
            {
                index += 1;
            }

            if prefix == b'?' || bytes.get(index) == Some(&b'>') {
                let end = if prefix == b'|' { index + 1 } else { index };

                symbols.push(CoreSymbol {
                    end,
                    excerpt: excerpt_around(source, start, end - start),
                    kind: CoreSymbolKind::Hook,
                    line: line_number_at(source, start),
                    name: source[start..end].to_owned(),
                    passage_id: passage_id.map(str::to_owned),
                    scope: scope.clone(),
                    source_id: source_id.to_owned(),
                    source_name: source_name.to_owned(),
                    start,
                });
            }
        }

        index += 1;
    }

    symbols
}

fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn asset_references_in_source(
    source_id: &str,
    source_name: &str,
    source: &str,
    passage_id: Option<&str>,
) -> Vec<CoreAssetReference> {
    let Ok(regex) = regex::RegexBuilder::new(
        r#"(?x)
        (?P<path>
            [A-Za-z0-9_./~%:@?&=+\-]+
            \.
            (?P<ext>png|jpe?g|gif|svg|webp|mp3|m4a|ogg|wav|mp4|webm|css|js)
        )
    "#,
    )
    .case_insensitive(true)
    .build() else {
        return Vec::new();
    };

    regex
        .captures_iter(source)
        .filter_map(|captures| {
            let path = captures.name("path")?;
            let extension = captures.name("ext")?.as_str();
            let path_string = local_asset_reference_path(path.as_str())?;

            Some(CoreAssetReference {
                end: path.end(),
                kind: asset_kind(extension).into(),
                line: line_number_at(source, path.start()),
                passage_id: passage_id.map(str::to_owned),
                path: path_string,
                source_id: source_id.to_owned(),
                source_name: source_name.to_owned(),
                start: path.start(),
            })
        })
        .collect()
}

fn asset_kind(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" => "image",
        "mp3" | "m4a" | "ogg" | "wav" => "audio",
        "mp4" | "webm" => "video",
        "css" => "stylesheet",
        "js" => "script",
        _ => "file",
    }
}

fn asset_kind_for_path(path: &str) -> String {
    path.rsplit_once('.')
        .map(|(_, extension)| asset_kind(extension).into())
        .unwrap_or_else(|| "file".into())
}

fn normalized_asset_path(path: &str) -> String {
    local_asset_reference_path(path)
        .unwrap_or_else(|| path.replace('\\', "/").trim_start_matches("./").into())
        .to_ascii_lowercase()
}

fn local_asset_reference_path(path: &str) -> Option<String> {
    let mut normalized = path.replace('\\', "/");

    while let Some(stripped) = normalized.strip_prefix("./") {
        normalized = stripped.into();
    }

    if has_url_scheme(&normalized) || normalized.starts_with("//") {
        return None;
    }

    let segments = normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let asset_segments = segments
        .iter()
        .position(|segment| segment.eq_ignore_ascii_case("assets"))
        .map(|index| &segments[index + 1..])
        .unwrap_or(segments.as_slice());

    if asset_segments.is_empty()
        || asset_segments
            .iter()
            .any(|segment| *segment == "." || *segment == "..")
    {
        return None;
    }

    Some(format!("assets/{}", asset_segments.join("/")))
}

fn has_url_scheme(path: &str) -> bool {
    let Some((scheme, _)) = path.split_once(':') else {
        return false;
    };

    let mut bytes = scheme.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };

    first.is_ascii_alphabetic()
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
}

fn asset_snippet(path: &str, kind: &str) -> CoreAssetSnippet {
    let text = match kind {
        "image" => format!(r#"<img src="{path}" alt="">"#),
        "audio" => format!(r#"<audio src="{path}" controls></audio>"#),
        "video" => format!(r#"<video src="{path}" controls></video>"#),
        "stylesheet" => format!(r#"<link rel="stylesheet" href="{path}">"#),
        "script" => format!(r#"<script src="{path}"></script>"#),
        _ => path.to_owned(),
    };

    CoreAssetSnippet {
        label: "Insert asset reference".into(),
        media_type: kind.into(),
        text,
    }
}

fn asset_publish_rule(path: &str, missing: bool) -> CoreAssetPublishRule {
    CoreAssetPublishRule {
        copy: !missing,
        output_path: path.into(),
        reason: if missing {
            "Referenced file is missing".into()
        } else {
            "Copy asset into published output".into()
        },
    }
}

fn asset_inventory_entry(
    path: String,
    kind: String,
    exists: Option<bool>,
    references: Vec<CoreAssetReference>,
) -> CoreAssetInventoryEntry {
    let missing = exists == Some(false) && !references.is_empty();
    let unused = exists == Some(true) && references.is_empty();

    CoreAssetInventoryEntry {
        duration_ms: None,
        exists,
        height: None,
        kind: kind.clone(),
        missing,
        modified_at: None,
        normalized_path: normalized_asset_path(&path),
        path: path.clone(),
        preview_url: None,
        publish: asset_publish_rule(&path, missing),
        reference_count: references.len(),
        references,
        size_bytes: None,
        snippet: asset_snippet(&path, &kind),
        thumbnail_url: None,
        unused,
        width: None,
    }
}

fn asset_inventory_from_references(
    references: &[CoreAssetReference],
    known_assets: Vec<CoreAssetInventoryEntry>,
    file_backed: bool,
) -> Vec<CoreAssetInventoryEntry> {
    let mut references_by_path = BTreeMap::<String, Vec<CoreAssetReference>>::new();

    for reference in references {
        references_by_path
            .entry(normalized_asset_path(&reference.path))
            .or_default()
            .push(reference.clone());
    }

    let mut inventory = BTreeMap::<String, CoreAssetInventoryEntry>::new();

    for mut asset in known_assets {
        let normalized = if asset.normalized_path.is_empty() {
            normalized_asset_path(&asset.path)
        } else {
            normalized_asset_path(&asset.normalized_path)
        };
        let asset_references = references_by_path.remove(&normalized).unwrap_or_default();
        let references = if asset_references.is_empty() {
            asset.references.clone()
        } else {
            asset_references
        };

        if asset.kind.is_empty() {
            asset.kind = asset_kind_for_path(&asset.path);
        }

        asset.normalized_path = normalized.clone();
        asset.reference_count = references.len();
        asset.references = references;
        asset.missing = asset.exists == Some(false) && asset.reference_count > 0;
        asset.unused = asset.exists == Some(true) && asset.reference_count == 0;

        if asset.snippet.text.is_empty() {
            asset.snippet = asset_snippet(&asset.path, &asset.kind);
        }

        if asset.missing {
            asset.publish.copy = false;
            asset.publish.reason = "Referenced file is missing".into();
        }

        if asset.publish.output_path.is_empty() {
            asset.publish = asset_publish_rule(&asset.path, asset.missing);
        }

        inventory.insert(normalized, asset);
    }

    for (_, references) in references_by_path {
        let Some(first) = references.first() else {
            continue;
        };

        inventory.insert(
            normalized_asset_path(&first.path),
            asset_inventory_entry(
                first.path.clone(),
                first.kind.clone(),
                if file_backed { Some(false) } else { None },
                references,
            ),
        );
    }

    inventory.into_values().collect()
}

struct AssetSearchLocation {
    passage_id: Option<String>,
    source_id: String,
    source_name: String,
}

fn asset_search_location(story: &Story, asset: &CoreAssetInventoryEntry) -> AssetSearchLocation {
    if let Some(reference) = asset.references.first() {
        return AssetSearchLocation {
            passage_id: reference.passage_id.clone(),
            source_id: reference.source_id.clone(),
            source_name: reference.source_name.clone(),
        };
    }

    AssetSearchLocation {
        passage_id: None,
        source_id: format!("{}:assets", story.id.as_ref()),
        source_name: "Assets".into(),
    }
}

fn asset_diagnostics(
    story: &Story,
    metadata_source_id: &str,
    inventory: &[CoreAssetInventoryEntry],
) -> Vec<CoreDiagnostic> {
    let mut diagnostics = Vec::new();

    for asset in inventory {
        if asset.missing {
            let location = asset.references.first();

            diagnostics.push(CoreDiagnostic {
                code: "missing-asset".into(),
                end: location.map_or(asset.path.len(), |reference| reference.end),
                line: location.map_or(1, |reference| reference.line),
                message: format!("Referenced asset \"{}\" is missing", asset.path),
                passage_id: location.and_then(|reference| reference.passage_id.clone()),
                quick_fixes: vec![CoreQuickFix {
                    command: format!("import-asset:{}", asset.path),
                    title: "Import or relink asset".into(),
                }],
                severity: CoreDiagnosticSeverity::Error,
                source_id: location
                    .map(|reference| reference.source_id.clone())
                    .unwrap_or_else(|| metadata_source_id.into()),
                start: location.map_or(0, |reference| reference.start),
            });
        }

        if asset.unused {
            diagnostics.push(CoreDiagnostic {
                code: "unused-asset".into(),
                end: asset.path.len(),
                line: 1,
                message: format!("Asset \"{}\" is not referenced", asset.path),
                passage_id: None,
                quick_fixes: vec![CoreQuickFix {
                    command: format!("delete-asset:{}", asset.path),
                    title: "Delete unused asset".into(),
                }],
                severity: CoreDiagnosticSeverity::Info,
                source_id: format!("{}:assets", story.id.as_ref()),
                start: 0,
            });
        }
    }

    diagnostics
}

fn locate_link_target(text: &str, target: &str) -> Option<(usize, usize, usize)> {
    let start = text.find(target)?;
    let end = start + target.len();

    Some((line_number_at(text, start), start, end))
}

struct DuplicatePassageName {
    name: String,
    passage_id: String,
}

fn duplicate_passage_names(story: &Story) -> Vec<DuplicatePassageName> {
    let mut names = BTreeMap::<String, Vec<String>>::new();

    for passage in &story.passages {
        names
            .entry(passage.name.clone())
            .or_default()
            .push(passage.id.as_ref().to_owned());
    }

    names
        .into_iter()
        .filter(|(_, passage_ids)| passage_ids.len() > 1)
        .flat_map(|(name, passage_ids)| {
            passage_ids
                .into_iter()
                .map(move |passage_id| DuplicatePassageName {
                    name: name.clone(),
                    passage_id,
                })
        })
        .collect()
}

fn tag_entries(story: &Story, tag_usage: BTreeMap<String, BTreeSet<String>>) -> Vec<CoreTagEntry> {
    tag_usage
        .into_iter()
        .map(|(name, passage_ids)| CoreTagEntry {
            color: story.tag_colors.get(&name).cloned(),
            count: passage_ids.len(),
            name,
            passage_ids: passage_ids.into_iter().collect(),
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn contents_entries(
    story: &Story,
    files: &[CoreSourceFile],
    tag_entries: &[CoreTagEntry],
    symbols: &[CoreSymbol],
    asset_inventory: &[CoreAssetInventoryEntry],
    diagnostics: &[CoreDiagnostic],
    graph: &GraphIndex,
    metadata_source_id: &str,
) -> Vec<CoreContentsEntry> {
    let mut entries = vec![
        CoreContentsEntry {
            count: story.passages.len(),
            detail: Some(story.name.clone()),
            id: format!("metadata:{}", story.id.as_ref()),
            kind: CoreContentsEntryKind::Metadata,
            label: "Story metadata".into(),
            passage_id: None,
            severity: None,
            source_id: Some(metadata_source_id.into()),
        },
        CoreContentsEntry {
            count: 1,
            detail: Some(format!(
                "{} {}",
                story.story_format, story.story_format_version
            )),
            id: format!("format:{}", story.id.as_ref()),
            kind: CoreContentsEntryKind::Metadata,
            label: "Story format".into(),
            passage_id: None,
            severity: None,
            source_id: Some(metadata_source_id.into()),
        },
    ];

    if let Some(start) = story.passage_by_id(&story.start_passage) {
        entries.push(CoreContentsEntry {
            count: 1,
            detail: Some(start.name.clone()),
            id: format!("entry:{}", start.id.as_ref()),
            kind: CoreContentsEntryKind::EntryPoint,
            label: "Start passage".into(),
            passage_id: Some(start.id.as_ref().to_owned()),
            severity: None,
            source_id: Some(start.id.as_ref().to_owned()),
        });
    }

    for file in files {
        entries.push(CoreContentsEntry {
            count: file.line_count,
            detail: Some(format!("{} characters", file.character_count)),
            id: format!("source:{}", file.id),
            kind: match &file.kind {
                CoreSourceKind::Passage => CoreContentsEntryKind::Passage,
                CoreSourceKind::Script => CoreContentsEntryKind::Script,
                CoreSourceKind::Stylesheet => CoreContentsEntryKind::Stylesheet,
                CoreSourceKind::StoryMetadata => CoreContentsEntryKind::Metadata,
            },
            label: file.name.clone(),
            passage_id: file.passage_id.clone(),
            severity: None,
            source_id: Some(file.id.clone()),
        });
    }

    for tag in tag_entries {
        entries.push(CoreContentsEntry {
            count: tag.count,
            detail: tag.color.clone(),
            id: format!("tag:{}", tag.name),
            kind: group_kind(&tag.name),
            label: tag.name.clone(),
            passage_id: tag.passage_ids.first().cloned(),
            severity: None,
            source_id: tag.passage_ids.first().cloned(),
        });
    }

    for (name, source) in symbol_entries(symbols) {
        entries.push(CoreContentsEntry {
            count: source.count,
            detail: None,
            id: format!("symbol:{name}"),
            kind: CoreContentsEntryKind::Variable,
            label: name,
            passage_id: source.passage_id,
            severity: None,
            source_id: Some(source.source_id),
        });
    }

    for asset in asset_inventory {
        let location = asset.references.first();

        entries.push(CoreContentsEntry {
            count: asset.reference_count,
            detail: Some(if asset.missing {
                "missing".into()
            } else if asset.unused {
                "unused".into()
            } else {
                asset.kind.clone()
            }),
            id: format!("asset:{}", asset.path),
            kind: CoreContentsEntryKind::Asset,
            label: asset.path.clone(),
            passage_id: location.and_then(|reference| reference.passage_id.clone()),
            severity: asset_status_severity(asset),
            source_id: Some(
                location
                    .map(|reference| reference.source_id.clone())
                    .unwrap_or_else(|| format!("{}:assets", story.id.as_ref())),
            ),
        });
    }

    for diagnostic in diagnostics {
        entries.push(CoreContentsEntry {
            count: 1,
            detail: Some(diagnostic.message.clone()),
            id: format!(
                "diagnostic:{}:{}:{}",
                diagnostic.code, diagnostic.source_id, diagnostic.start
            ),
            kind: match diagnostic.code.as_str() {
                "broken-link" => CoreContentsEntryKind::BrokenLink,
                _ => CoreContentsEntryKind::Diagnostic,
            },
            label: diagnostic.code.clone(),
            passage_id: diagnostic.passage_id.clone(),
            severity: Some(diagnostic.severity.clone()),
            source_id: Some(diagnostic.source_id.clone()),
        });
    }

    for node in graph.nodes().filter(|node| node.is_orphan) {
        entries.push(CoreContentsEntry {
            count: 1,
            detail: Some(node.name.clone()),
            id: format!("orphan:{}", node.id.as_ref()),
            kind: CoreContentsEntryKind::Orphan,
            label: "Orphan passage".into(),
            passage_id: Some(node.id.as_ref().to_owned()),
            severity: Some(CoreDiagnosticSeverity::Info),
            source_id: Some(node.id.as_ref().to_owned()),
        });
    }

    entries
}

fn group_kind(tag_name: &str) -> CoreContentsEntryKind {
    let normalized = tag_name.to_ascii_lowercase();

    if normalized.starts_with("chapter")
        || normalized.starts_with("section")
        || normalized.starts_with("group")
    {
        CoreContentsEntryKind::Group
    } else {
        CoreContentsEntryKind::Tag
    }
}

struct IndexedContentSource {
    count: usize,
    passage_id: Option<String>,
    source_id: String,
}

fn symbol_entries(symbols: &[CoreSymbol]) -> BTreeMap<String, IndexedContentSource> {
    let mut result = BTreeMap::new();

    for symbol in symbols {
        result
            .entry(symbol.name.clone())
            .and_modify(|entry: &mut IndexedContentSource| entry.count += 1)
            .or_insert_with(|| IndexedContentSource {
                count: 1,
                passage_id: symbol.passage_id.clone(),
                source_id: symbol.source_id.clone(),
            });
    }

    result
}

fn asset_status_severity(asset: &CoreAssetInventoryEntry) -> Option<CoreDiagnosticSeverity> {
    if asset.missing {
        Some(CoreDiagnosticSeverity::Error)
    } else if asset.unused {
        Some(CoreDiagnosticSeverity::Info)
    } else {
        None
    }
}

fn unique_passage_name(story: &Story, base: &str) -> String {
    if story.passages.id_for_name(base).is_none() {
        return base.into();
    }

    for suffix in 2.. {
        let candidate = format!("{base} {suffix}");

        if story.passages.id_for_name(&candidate).is_none() {
            return candidate;
        }
    }

    unreachable!("infinite iterator should return");
}

fn replace_standard_link_targets(text: &str, old_name: &str, new_name: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut cursor = 0;

    while let Some(open_offset) = text[cursor..].find("[[") {
        let open = cursor + open_offset;
        let content_start = open + 2;
        let Some(close_offset) = text[content_start..].find("]]") else {
            break;
        };
        let close = content_start + close_offset;
        let content = &text[content_start..close];

        result.push_str(&text[cursor..open]);
        result.push_str("[[");
        result.push_str(&replace_link_content_target(content, old_name, new_name));
        result.push_str("]]");
        cursor = close + 2;
    }

    result.push_str(&text[cursor..]);
    result
}

fn replace_link_content_target(content: &str, old_name: &str, new_name: &str) -> String {
    let (editable, setter) = content
        .split_once("][")
        .map_or((content, ""), |(editable, setter)| (editable, setter));
    let setter = if setter.is_empty() {
        String::new()
    } else {
        format!("][{setter}")
    };

    if let Some((label, target)) = editable.rsplit_once("->") {
        if target.trim() == old_name {
            return format!(
                "{label}->{}{}",
                replace_preserving_padding(target, new_name),
                setter
            );
        }
    }

    if let Some((target, label)) = editable.split_once("<-") {
        if target.trim() == old_name {
            return format!(
                "{}<-{label}{setter}",
                replace_preserving_padding(target, new_name)
            );
        }
    }

    if let Some((label, target)) = editable.rsplit_once('|') {
        if target.trim() == old_name {
            return format!(
                "{label}|{}{}",
                replace_preserving_padding(target, new_name),
                setter
            );
        }
    }

    if editable.trim() == old_name {
        return format!(
            "{}{}",
            replace_preserving_padding(editable, new_name),
            setter
        );
    }

    content.into()
}

fn replace_preserving_padding(value: &str, replacement: &str) -> String {
    let leading = value.len() - value.trim_start().len();
    let trailing = value.len() - value.trim_end().len();

    format!(
        "{}{}{}",
        &value[..leading],
        replacement,
        &value[value.len() - trailing..]
    )
}

impl Default for CoreLinkLayerOptions {
    fn default() -> Self {
        Self {
            broken: true,
            resolved: true,
            self_links: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use twine_model::{GraphLayout, ProjectManifest, StoragePolicy};

    const DEFAULT_CARD_WIDTH: f64 = 100.0;
    const DEFAULT_CARD_HEIGHT: f64 = 100.0;

    fn passage(id: &str, name: &str, text: &str, left: f64) -> Passage {
        Passage {
            custom_attributes: BTreeMap::new(),
            id: PassageId::new(id),
            layout: Some(GraphPosition {
                height: DEFAULT_CARD_HEIGHT,
                left,
                top: 0.0,
                width: DEFAULT_CARD_WIDTH,
            }),
            metadata: BTreeMap::new(),
            name: name.into(),
            source_pid: None,
            story: StoryId::new("story-1"),
            tags: Vec::new(),
            text: text.into(),
        }
    }

    fn story() -> Story {
        Story {
            id: StoryId::new("story-1"),
            ifid: "ifid".into(),
            name: "Example".into(),
            passages: vec![
                passage("a", "Start", "[[Next]] [[Label->Next]] [[Next<-Back]]", 0.0),
                passage("b", "Next", "[[Missing]]", 200.0),
                passage("c", "Loose", "", 400.0),
            ]
            .into(),
            start_passage: PassageId::new("a"),
            story_format: "Harlowe".into(),
            story_format_version: "3.3.9".into(),
            ..Story::default()
        }
    }

    fn session() -> ProjectSession {
        ProjectSession::new(Project {
            manifest: ProjectManifest {
                name: "Example".into(),
                storage: StoragePolicy::default(),
                ..ProjectManifest::default()
            },
            stories: vec![story()],
            layout: GraphLayout::from_story_layout(&story()),
            ..Project::default()
        })
    }

    fn source_only_session() -> ProjectSession {
        let mut story = story();
        let passages = story
            .passages
            .iter()
            .cloned()
            .map(|mut passage| {
                passage.layout = None;
                passage
            })
            .collect::<Vec<_>>();

        story.passages = PassageIndex::from(passages);

        ProjectSession::new(Project {
            manifest: ProjectManifest {
                name: "Example".into(),
                storage: StoragePolicy::default(),
                ..ProjectManifest::default()
            },
            stories: vec![story],
            ..Project::default()
        })
    }

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "twine-core-{label}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ))
    }

    fn tiny_png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();

        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes.extend([8, 6, 0, 0, 0, 0, 0, 0, 0]);
        bytes
    }

    #[test]
    fn applies_text_edit_as_minimal_patch() {
        let mut session = session();
        let batch = session
            .apply(StoryCommand::UpdatePassageText {
                story_id: "story-1".into(),
                passage_id: "b".into(),
                text: "[[Start]]".into(),
            })
            .expect("text update should apply");

        assert_eq!(batch.label, "Update Passage Text");
        assert!(session.dirty());
        assert_eq!(batch.patches.len(), 2);
        assert_eq!(
            batch.patches[0],
            Patch::PassageUpdated {
                story_id: "story-1".into(),
                passage_id: "b".into(),
                changes: PassagePatch {
                    text: Some("[[Start]]".into()),
                    ..PassagePatch::default()
                }
            }
        );
    }

    #[test]
    fn rolls_back_batch_when_child_command_fails() {
        let mut session = session();
        let error = session
            .apply(StoryCommand::Batch {
                commands: vec![
                    StoryCommand::UpdatePassageText {
                        story_id: "story-1".into(),
                        passage_id: "a".into(),
                        text: "Changed".into(),
                    },
                    StoryCommand::SetStartPassage {
                        story_id: "story-1".into(),
                        passage_id: "missing".into(),
                    },
                ],
            })
            .expect_err("batch should fail");

        assert!(matches!(error, CoreError::PassageNotFound(_)));
        assert_eq!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .text,
            "[[Next]] [[Label->Next]] [[Next<-Back]]"
        );
        assert!(!session.dirty());
        assert!(!session.can_undo());
        assert!(!session.can_redo());

        let follow_up = session
            .apply(StoryCommand::QueryStoryIndex {
                story_id: "story-1".into(),
                options: CoreStoryIndexOptions::default(),
            })
            .expect("follow-up query should apply");

        assert_eq!(follow_up.transaction_id, 1);
    }

    #[test]
    fn rolls_back_move_passages_when_one_move_fails() {
        let mut session = session();
        let error = session
            .apply(StoryCommand::MovePassages {
                story_id: "story-1".into(),
                moves: vec![
                    PassageMove {
                        passage_id: "a".into(),
                        bounds: CoreRect {
                            height: DEFAULT_CARD_HEIGHT,
                            left: 50.0,
                            top: 60.0,
                            width: DEFAULT_CARD_WIDTH,
                        },
                    },
                    PassageMove {
                        passage_id: "missing".into(),
                        bounds: CoreRect {
                            height: DEFAULT_CARD_HEIGHT,
                            left: 70.0,
                            top: 80.0,
                            width: DEFAULT_CARD_WIDTH,
                        },
                    },
                ],
            })
            .expect_err("move should fail");

        assert!(matches!(error, CoreError::PassageNotFound(_)));
        assert_eq!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .layout
                .expect("layout")
                .left,
            0.0
        );
        assert_eq!(
            session
                .project
                .layout
                .passages
                .get(&PassageId::new("a"))
                .expect("project layout")
                .bounds
                .left,
            0.0
        );
        assert!(!session.dirty());
        assert!(!session.can_undo());
        assert!(!session.can_redo());
    }

    #[test]
    fn renames_passage_and_standard_references_in_one_transaction() {
        let mut session = session();
        let batch = session
            .apply(StoryCommand::RenamePassage {
                story_id: "story-1".into(),
                passage_id: "b".into(),
                name: "Renamed".into(),
                update_references: true,
            })
            .expect("rename should apply");

        assert_eq!(batch.label, "Rename Passage");
        assert_eq!(batch.patches.len(), 3);
        assert_eq!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .text,
            "[[Renamed]] [[Label->Renamed]] [[Renamed<-Back]]"
        );

        session.undo().expect("undo should be available");
        assert_eq!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("b"))
                .expect("passage")
                .name,
            "Next"
        );

        session.redo().expect("redo should be available");
        assert_eq!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("b"))
                .expect("passage")
                .name,
            "Renamed"
        );
    }

    #[test]
    fn updates_story_sources_as_minimal_patches() {
        let mut session = session();
        let script_batch = session
            .apply(StoryCommand::UpdateStoryScript {
                story_id: "story-1".into(),
                script: "window.storyReady = true;".into(),
            })
            .expect("script update should apply");
        let stylesheet_batch = session
            .apply(StoryCommand::UpdateStoryStylesheet {
                story_id: "story-1".into(),
                stylesheet: "tw-story { color: red; }".into(),
            })
            .expect("stylesheet update should apply");

        assert_eq!(
            script_batch.patches[0],
            Patch::StoryScriptUpdated {
                story_id: "story-1".into(),
                script: "window.storyReady = true;".into(),
            }
        );
        assert_eq!(
            stylesheet_batch.patches[0],
            Patch::StoryStylesheetUpdated {
                story_id: "story-1".into(),
                stylesheet: "tw-story { color: red; }".into(),
            }
        );
    }

    #[test]
    fn updates_story_metadata_through_commands() {
        let mut session = session();

        session
            .apply(StoryCommand::RenameStory {
                story_id: "story-1".into(),
                name: "Renamed Story".into(),
            })
            .expect("story rename should apply");
        session
            .apply(StoryCommand::SetStoryFormat {
                story_id: "story-1".into(),
                story_format: "Chapbook".into(),
                story_format_version: "2.2.0".into(),
            })
            .expect("story format should apply");
        session
            .apply(StoryCommand::SetStorySnapToGrid {
                story_id: "story-1".into(),
                enabled: false,
            })
            .expect("snap-to-grid should apply");
        let zoom_batch = session
            .apply(StoryCommand::SetStoryZoom {
                story_id: "story-1".into(),
                zoom: 0.6,
            })
            .expect("zoom should apply");
        let story = session.story("story-1").expect("story");

        assert_eq!(story.name, "Renamed Story");
        assert_eq!(story.story_format, "Chapbook");
        assert_eq!(story.story_format_version, "2.2.0");
        assert!(!story.snap_to_grid);
        assert_eq!(story.zoom, 0.6);
        assert_eq!(zoom_batch.label, "Set Story Zoom");
        assert!(matches!(
            zoom_batch.patches[0],
            Patch::ProjectSnapshotReplaced { .. }
        ));
    }

    #[test]
    fn returns_graph_projection_patch_without_marking_dirty() {
        let mut session = session();
        let batch = session
            .apply(StoryCommand::QueryGraphProjection {
                story_id: "story-1".into(),
                options: CoreGraphProjectionOptions {
                    viewport: Some(CoreRect {
                        height: 150.0,
                        left: 0.0,
                        top: 0.0,
                        width: 250.0,
                    }),
                    ..CoreGraphProjectionOptions::default()
                },
            })
            .expect("projection should apply");

        assert!(!session.dirty());
        assert_eq!(batch.patches.len(), 1);

        let Patch::GraphProjectionUpdated { projection, .. } = &batch.patches[0] else {
            panic!("expected projection patch");
        };

        assert_eq!(projection.layout_state, CoreGraphLayoutState::Saved);
        assert!(projection.nodes.iter().any(|node| node.id == "a"));
        assert!(
            projection
                .edges
                .iter()
                .any(|edge| edge.target_name == "Next")
        );
    }

    #[test]
    fn returns_story_index_patch_without_marking_dirty() {
        let mut session = session();
        let batch = session
            .apply(StoryCommand::QueryStoryIndex {
                story_id: "story-1".into(),
                options: CoreStoryIndexOptions {
                    query: Some("missing".into()),
                    ..CoreStoryIndexOptions::default()
                },
            })
            .expect("index query should apply");

        assert!(!session.dirty());
        assert_eq!(batch.patches.len(), 1);

        let Patch::StoryIndexUpdated { index, .. } = &batch.patches[0] else {
            panic!("expected story index patch");
        };

        assert_eq!(index.files.len(), 5);
        assert_eq!(index.graph.broken_links, 1);
        assert!(
            index
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "broken-link")
        );
        assert!(
            !index
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "unreachable-passage")
        );
        assert!(
            index
                .search_hits
                .iter()
                .any(|hit| hit.source_name == "Next")
        );
    }

    #[test]
    fn story_index_includes_m4_project_intelligence() {
        let mut session = session();

        {
            let story = session.story_mut("story-1").expect("story");
            let passage = story
                .passage_by_id_mut(&PassageId::new("a"))
                .expect("passage");

            passage.text = "Set $score. assets/cover.png [[Next]]".into();
            passage.tags = vec!["chapter-one".into(), "scene".into()];
            story.tag_colors.insert("scene".into(), "red".into());
            story.script = "const coin = 1;".into();
        }

        let batch = session
            .apply(StoryCommand::QueryStoryIndex {
                story_id: "story-1".into(),
                options: CoreStoryIndexOptions {
                    query: Some("coin".into()),
                    replacement: Some("gem".into()),
                    ..CoreStoryIndexOptions::default()
                },
            })
            .expect("index query should apply");

        let Patch::StoryIndexUpdated { index, .. } = &batch.patches[0] else {
            panic!("expected story index patch");
        };

        assert!(index.symbols.iter().any(|symbol| symbol.name == "$score"));
        assert!(
            index
                .assets
                .iter()
                .any(|asset| asset.path == "assets/cover.png")
        );
        assert!(index.tag_entries.iter().any(|tag| {
            tag.name == "scene" && tag.count == 1 && tag.color.as_deref() == Some("red")
        }));
        assert!(index.replace_previews.iter().any(|preview| {
            preview.before == "const coin = 1;" && preview.after == "const gem = 1;"
        }));
        assert!(index.contents.iter().any(|entry| {
            entry.kind == CoreContentsEntryKind::Group && entry.label == "chapter-one"
        }));
        assert!(index.contents.iter().any(|entry| {
            entry.kind == CoreContentsEntryKind::Asset && entry.label == "assets/cover.png"
        }));
        assert!(index.contents.iter().any(|entry| {
            entry.kind == CoreContentsEntryKind::Asset
                && entry.label == "assets/cover.png"
                && entry.passage_id.as_deref() == Some("a")
                && entry.source_id.as_deref() == Some("a")
        }));
        assert!(index.contents.iter().any(|entry| {
            entry.kind == CoreContentsEntryKind::Variable
                && entry.label == "$score"
                && entry.passage_id.as_deref() == Some("a")
                && entry.source_id.as_deref() == Some("a")
        }));

        let variable_batch = session
            .apply(StoryCommand::QueryStoryIndex {
                story_id: "story-1".into(),
                options: CoreStoryIndexOptions {
                    query: Some("$score".into()),
                    ..CoreStoryIndexOptions::default()
                },
            })
            .expect("variable index query should apply");
        let Patch::StoryIndexUpdated {
            index: variable_index,
            ..
        } = &variable_batch.patches[0]
        else {
            panic!("expected story index patch");
        };

        assert!(
            variable_index
                .search_hits
                .iter()
                .any(|hit| hit.scope == CoreSearchScope::Variable)
        );
    }

    #[test]
    fn story_index_merges_file_backed_asset_inventory_contract() {
        let mut session = session();

        {
            let story = session.story_mut("story-1").expect("story");
            let passage = story
                .passage_by_id_mut(&PassageId::new("a"))
                .expect("passage");

            passage.text = r#"<img src="assets/missing.png">"#.into();
        }

        let batch = session
            .apply(StoryCommand::QueryStoryIndex {
                story_id: "story-1".into(),
                options: CoreStoryIndexOptions {
                    known_assets: vec![
                        asset_inventory_entry(
                            "assets/missing.png".into(),
                            "image".into(),
                            Some(false),
                            Vec::new(),
                        ),
                        asset_inventory_entry(
                            "assets/unused.png".into(),
                            "image".into(),
                            Some(true),
                            Vec::new(),
                        ),
                    ],
                    ..CoreStoryIndexOptions::default()
                },
            })
            .expect("index query should apply");

        let Patch::StoryIndexUpdated { index, .. } = &batch.patches[0] else {
            panic!("expected story index patch");
        };

        assert!(index.asset_inventory.iter().any(|asset| {
            asset.path == "assets/missing.png"
                && asset.missing
                && asset.reference_count == 1
                && !asset.unused
        }));
        assert!(index.asset_inventory.iter().any(|asset| {
            asset.path == "assets/unused.png"
                && !asset.missing
                && asset.reference_count == 0
                && asset.unused
        }));
        assert!(index.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "missing-asset"
                && diagnostic.severity == CoreDiagnosticSeverity::Error
        }));
        assert!(index.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "unused-asset" && diagnostic.severity == CoreDiagnosticSeverity::Info
        }));
        assert!(index.contents.iter().any(|entry| {
            entry.kind == CoreContentsEntryKind::Asset
                && entry.label == "assets/unused.png"
                && entry.severity == Some(CoreDiagnosticSeverity::Info)
        }));
    }

    #[test]
    fn story_index_ignores_external_asset_urls_and_normalizes_local_asset_references() {
        let mut session = session();

        {
            let story = session.story_mut("story-1").expect("story");
            let passage = story
                .passage_by_id_mut(&PassageId::new("a"))
                .expect("passage");

            passage.text = r#"<img src="https://cdn.example.com/cover.png"> <img src="/assets/local.png"> <img src="../assets/icon.svg"> poster.jpg"#.into();
        }

        let index = session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .expect("index should build");
        let asset_paths = index
            .asset_inventory
            .iter()
            .map(|asset| asset.path.as_str())
            .collect::<Vec<_>>();

        assert!(!asset_paths.iter().any(|path| path.starts_with("https://")));
        assert!(asset_paths.contains(&"assets/local.png"));
        assert!(asset_paths.contains(&"assets/icon.svg"));
        assert!(asset_paths.contains(&"assets/poster.jpg"));
    }

    #[test]
    fn asset_commands_require_file_backed_project_root() {
        let mut session = session();
        let error = session
            .apply(StoryCommand::ImportAsset {
                overwrite: false,
                source_path: "/tmp/cover.png".into(),
                story_id: "story-1".into(),
                target_path: None,
            })
            .expect_err("asset commands need a project root");

        assert!(matches!(error, CoreError::AssetHostUnavailable));
        assert!(!session.dirty());
    }

    #[test]
    fn file_backed_asset_inventory_tracks_files_references_and_metadata() {
        let root = temp_path("asset-inventory");
        let cover = root.join("assets/cover.png");
        let unused = root.join("assets/ui/unused.gif");
        let mut session = session();

        fs::create_dir_all(cover.parent().expect("asset should have parent"))
            .expect("asset directory should be created");
        fs::create_dir_all(unused.parent().expect("asset should have parent"))
            .expect("nested asset directory should be created");
        fs::write(&cover, tiny_png(320, 200)).expect("cover should be written");
        fs::write(&unused, b"GIF89a\x01\0\x02\0\0\0").expect("gif should be written");
        session.set_project_root(&root);

        {
            let story = session.story_mut("story-1").expect("story");
            let passage = story
                .passage_by_id_mut(&PassageId::new("a"))
                .expect("passage");

            passage.text =
                r#"<img src="assets/cover.png"> <audio src="assets/missing.mp3">"#.into();
        }

        let index = session
            .story_index("story-1", CoreStoryIndexOptions::default())
            .expect("index should build");
        let cover_asset = index
            .asset_inventory
            .iter()
            .find(|asset| asset.path == "assets/cover.png")
            .expect("cover should be indexed");
        let missing_asset = index
            .asset_inventory
            .iter()
            .find(|asset| asset.path == "assets/missing.mp3")
            .expect("missing asset should be indexed");
        let unused_asset = index
            .asset_inventory
            .iter()
            .find(|asset| asset.path == "assets/ui/unused.gif")
            .expect("unused asset should be indexed");

        assert_eq!(cover_asset.exists, Some(true));
        assert_eq!(cover_asset.reference_count, 1);
        assert_eq!(cover_asset.width, Some(320));
        assert_eq!(cover_asset.height, Some(200));
        assert!(cover_asset
            .thumbnail_url
            .as_deref()
            .is_some_and(|url| url.starts_with("file://") && url.ends_with("/assets/cover.png")));
        assert_eq!(missing_asset.exists, Some(false));
        assert!(missing_asset.missing);
        assert!(unused_asset.unused);
        assert_eq!(unused_asset.width, Some(1));
        assert_eq!(unused_asset.height, Some(2));
        assert!(
            index
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "missing-asset")
        );
        assert!(
            index
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "unused-asset")
        );

        fs::remove_dir_all(root).expect("temp project should be removed");
    }

    #[test]
    fn asset_commands_import_insert_rename_and_delete_files_and_references() {
        let root = temp_path("asset-commands");
        let source = root.join("incoming.png");
        let mut session = session();

        fs::create_dir_all(&root).expect("temp project should be created");
        fs::write(&source, tiny_png(64, 32)).expect("source asset should be written");
        session.set_project_root(&root);

        let import = session
            .apply(StoryCommand::ImportAsset {
                overwrite: false,
                source_path: source.to_string_lossy().into_owned(),
                story_id: "story-1".into(),
                target_path: Some("assets/media/cover.png".into()),
            })
            .expect("asset should import");

        assert!(root.join("assets/media/cover.png").is_file());
        assert!(
            import
                .patches
                .iter()
                .any(|patch| matches!(patch, Patch::AssetImported { .. }))
        );

        session
            .apply(StoryCommand::InsertAssetSnippet {
                passage_id: Some("a".into()),
                path: "assets/media/cover.png".into(),
                position: 0,
                snippet: None,
                source_id: "a".into(),
                story_id: "story-1".into(),
            })
            .expect("snippet should insert");

        assert!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .text
                .starts_with(r#"<img src="assets/media/cover.png" alt="">"#)
        );

        session
            .apply(StoryCommand::RenameAsset {
                new_path: "assets/media/hero.png".into(),
                path: "assets/media/cover.png".into(),
                story_id: "story-1".into(),
                update_references: true,
            })
            .expect("asset should rename");

        assert!(!root.join("assets/media/cover.png").exists());
        assert!(root.join("assets/media/hero.png").is_file());
        assert!(
            session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .text
                .contains("assets/media/hero.png")
        );

        session
            .apply(StoryCommand::DeleteAsset {
                path: "assets/media/hero.png".into(),
                remove_references: true,
                story_id: "story-1".into(),
            })
            .expect("asset should delete");

        assert!(!root.join("assets/media/hero.png").exists());
        assert!(
            !session
                .story("story-1")
                .expect("story")
                .passage_by_id(&PassageId::new("a"))
                .expect("passage")
                .text
                .contains("assets/media/hero.png")
        );

        fs::remove_dir_all(root).expect("temp project should be removed");
    }

    #[test]
    fn saves_generated_layout_only_on_explicit_command() {
        let mut session = source_only_session();
        let query = session
            .apply(StoryCommand::QueryGraphProjection {
                story_id: "story-1".into(),
                options: CoreGraphProjectionOptions::default(),
            })
            .expect("projection should apply");

        let Patch::GraphProjectionUpdated { projection, .. } = &query.patches[0] else {
            panic!("expected projection patch");
        };

        assert_eq!(projection.layout_state, CoreGraphLayoutState::Generated);
        assert!(session.project.layout.passages.is_empty());

        let save = session
            .apply(StoryCommand::SaveGeneratedLayout {
                story_id: "story-1".into(),
            })
            .expect("layout save should apply");

        assert!(session.dirty());
        assert_eq!(session.project.layout.passages.len(), 3);
        assert!(save.patches.iter().any(|patch| {
            matches!(
                patch,
                Patch::LayoutSaved {
                    projection: CoreGraphProjection {
                        layout_state: CoreGraphLayoutState::Saved,
                        ..
                    },
                    ..
                }
            )
        }));
    }

    #[test]
    fn replaces_link_targets_without_touching_display_text_or_setters() {
        assert_eq!(
            replace_standard_link_targets(
                "[[Old]] [[Display->Old][$x = 1]] [[ Old <-Back]] [[Display|Old]]",
                "Old",
                "New",
            ),
            "[[New]] [[Display->New][$x = 1]] [[ New <-Back]] [[Display|New]]"
        );
    }
}
