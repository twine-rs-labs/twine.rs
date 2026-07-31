#![doc = "Native Node/Electron bridge for project-folder I/O and inventory scans."]

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use napi::{
    Env, Status, Task,
    bindgen_prelude::{AsyncTask, Buffer},
};
use napi_derive::napi;
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io,
    io::ErrorKind,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use twine_model::{
    GraphPosition, PROJECT_SCHEMA_VERSION, Passage, PassageId, Project, ProjectSourceLayout,
    StoragePolicy, Story, StoryId,
};
#[cfg(test)]
use twine_store::save_project_path;
use twine_store::{
    LoadProjectOptions, LoadedProjectFile, SaveOptions, StoreError, load_project_path_with_options,
    load_project_path_with_receipt, save_project_path_with_prepared_sidecar,
    save_project_path_with_prepared_sidecar_and_preinstall,
    save_project_path_with_prepared_sidecar_and_story_id_mapping,
};

const IMPORT_ASSET_EXTENSIONS: &[&str] = &[
    "apng", "avif", "css", "gif", "jpeg", "jpg", "js", "m4a", "mp3", "mp4", "oga", "ogg", "otf",
    "png", "svg", "ttf", "wav", "webm", "webp", "woff", "woff2",
];
const OBVIOUS_IMPORT_ASSET_DIRECTORIES: &[&str] = &[
    "asset", "assets", "audio", "font", "fonts", "image", "images", "img", "media", "music",
    "picture", "pictures", "sound", "sounds", "video", "videos",
];
const NATIVE_ASSET_MAX_FILE_COUNT: u32 = 25;
const NATIVE_ASSET_MAX_ENCODED_BYTES: u32 = 25 * 1024 * 1024;
const NATIVE_ASSET_PAYLOAD_MAX_REQUEST_COUNT: usize = 25;
const NATIVE_ASSET_DIGEST_MAX_REQUEST_COUNT: usize = 100;
const NATIVE_ASSET_MAX_PATH_BYTES: usize = 4096;
const NATIVE_PREVIEW_ASSET_MAX_FILE_COUNT: u32 = 1000;
const NATIVE_PREVIEW_ASSET_MAX_ENCODED_BYTES: u32 = 50 * 1024 * 1024;
const NATIVE_PREVIEW_ASSET_MAX_REQUEST_COUNT: usize = 1000;
const MAX_RENDERER_PROJECT_SIDECAR_BYTES: usize = 2 * 1024 * 1024;
const MAX_IMPORT_SOURCE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_IMPORT_ASSETS: usize = 1_000;
const MAX_IMPORT_ASSET_SCAN_ENTRIES: usize = 10_000;
const MAX_IMPORT_ASSET_SCAN_DEPTH: usize = 32;
const MAX_IMPORT_ASSET_PATH_COMPONENT_CHARACTERS: usize = 255;

#[derive(Clone, Copy)]
struct ZipImportLimits {
    max_archive_bytes: u64,
    max_compression_ratio: u64,
    max_entries: usize,
    max_entry_bytes: u64,
    max_expanded_bytes: u64,
    max_nesting_depth: usize,
}

const ZIP_IMPORT_LIMITS: ZipImportLimits = ZipImportLimits {
    max_archive_bytes: 100 * 1024 * 1024,
    max_compression_ratio: 200,
    max_entries: 10_000,
    max_entry_bytes: 100 * 1024 * 1024,
    max_expanded_bytes: 500 * 1024 * 1024,
    max_nesting_depth: 32,
};

#[derive(Default)]
struct ImportAssetBudget {
    reference_matches: usize,
    scanned_entries: usize,
    total_bytes: u64,
}

#[derive(Default)]
struct ImportAssetRewriteTrie {
    children: BTreeMap<char, ImportAssetRewriteTrie>,
    target_root: Option<String>,
}

// Keep fallible #[napi] return types spelled as napi::Result<T>. napi-derive
// recognizes this form syntactically; hiding it behind an alias returns a
// JavaScript Error as a normal value instead of throwing it.

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthReport {
    features: Vec<&'static str>,
    ok: bool,
    version: &'static str,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectFolderResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    baseline_receipt: Option<NativeProjectBaselineReceipt>,
    #[serde(default)]
    graph_layout_loaded: bool,
    passage_text_loaded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    load_performance_timings: Option<NativeProjectLoadTimings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    performance_timings: Option<NativeProjectSaveTimings>,
    root_path: String,
    #[serde(default)]
    story_sources_loaded: bool,
    stories: Vec<NativeStory>,
    story_ids: Vec<String>,
}

#[derive(Debug)]
struct NativeHydrationLease {
    passages: Vec<(String, NativePassage)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeHydrationStart {
    hydration_id: String,
    passage_count: usize,
    #[serde(flatten)]
    project: NativeProjectFolderResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeHydrationPassage {
    passage: NativePassage,
    story_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeHydrationChunk {
    done: bool,
    next_cursor: usize,
    passages: Vec<NativeHydrationPassage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeHydrationMemoryDiagnostics {
    active_lease_count: usize,
    passage_count: usize,
    text_capacity_bytes: usize,
    text_length_bytes: usize,
}

static HYDRATION_LEASES: OnceLock<Mutex<BTreeMap<String, NativeHydrationLease>>> = OnceLock::new();
static NEXT_HYDRATION_ID: AtomicU64 = AtomicU64::new(1);

fn hydration_leases() -> &'static Mutex<BTreeMap<String, NativeHydrationLease>> {
    HYDRATION_LEASES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

#[napi(js_name = "hydrationMemoryDiagnosticsJson")]
pub fn hydration_memory_diagnostics_json() -> napi::Result<String> {
    let leases = hydration_leases()
        .lock()
        .map_err(|_| napi::Error::from_reason("Native hydration lease lock was poisoned."))?;
    let mut passage_count = 0;
    let mut text_capacity_bytes = 0;
    let mut text_length_bytes = 0;

    for lease in leases.values() {
        passage_count += lease.passages.len();
        for (_, passage) in &lease.passages {
            text_capacity_bytes += passage.text.capacity();
            text_length_bytes += passage.text.len();
        }
    }

    json_string(&NativeHydrationMemoryDiagnostics {
        active_lease_count: leases.len(),
        passage_count,
        text_capacity_bytes,
        text_length_bytes,
    })
    .map_err(native_error)
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectLoadTimings {
    asset_scan_us: u64,
    baseline_receipt_us: u64,
    graph_layout_us: u64,
    load_profile: String,
    manifest_cache_bytes: u64,
    manifest_cache_decode_us: u64,
    manifest_cache_hit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    manifest_cache_miss_reason: Option<String>,
    manifest_cache_read_us: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    manifest_digest: Option<String>,
    manifest_hash_us: u64,
    manifest_parse_us: u64,
    manifest_read_us: u64,
    manifest_toml_parse_us: u64,
    model_build_us: u64,
    native_story_conversion_us: u64,
    parallel: bool,
    passage_source_count: usize,
    passage_source_us: u64,
    source_bytes: u64,
    source_job_prepare_us: u64,
    story_source_count: usize,
    story_source_us: u64,
    worker_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectBaselineReceipt {
    assets: Vec<CoreAssetInventoryEntry>,
    completed_at: String,
    files: Vec<NativeProjectBaselineFile>,
    id: String,
    layout_data_json: String,
    root_path: String,
    schema_version: u32,
    started_at: String,
    story_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectBaselineFile {
    #[serde(flatten)]
    file: NativeProjectFileEntry,
    #[serde(skip_serializing_if = "Option::is_none")]
    passage_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    story_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectSaveTimings {
    changed_file_plan_us: u64,
    collect_new_files_us: u64,
    collect_old_files_us: u64,
    copy_assets_us: u64,
    dirty_compare_us: u64,
    json_parse_us: u64,
    project_build_us: u64,
    root_swap_us: u64,
    save_project_path_us: u64,
    sidecar_us: u64,
    total_us: u64,
    write_temp_project_us: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeRememberedProjectFolder {
    root_path: String,
    story_ids: Vec<String>,
    updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectLibraryIndex {
    version: u32,
    projects: Vec<NativeRememberedProjectFolder>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectStoryReplacement {
    passage_ids: Vec<NativeProjectPassageIdReplacement>,
    source_story_id: String,
    story: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectPassageIdReplacement {
    duplicate_passage_id: String,
    source_passage_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeStory {
    ifid: String,
    id: String,
    last_update: String,
    name: String,
    passages: Vec<NativePassage>,
    script: String,
    selected: bool,
    snap_to_grid: bool,
    start_passage: String,
    story_format: String,
    story_format_version: String,
    stylesheet: String,
    tag_colors: BTreeMap<String, String>,
    tags: Vec<String>,
    zoom: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePassage {
    height: f64,
    highlighted: bool,
    id: String,
    left: f64,
    name: String,
    selected: bool,
    story: String,
    tags: Vec<String>,
    text: String,
    top: f64,
    width: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreAssetInventoryEntry {
    duration_ms: Option<f64>,
    exists: Option<bool>,
    height: Option<f64>,
    kind: String,
    missing: bool,
    modified_at: Option<String>,
    normalized_path: String,
    path: String,
    preview_url: Option<String>,
    publish: CoreAssetPublishRule,
    reference_count: usize,
    references: Vec<serde_json::Value>,
    size_bytes: Option<u64>,
    snippet: CoreAssetSnippet,
    thumbnail_url: Option<String>,
    unused: bool,
    width: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreAssetPublishRule {
    copy: bool,
    output_path: String,
    reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreAssetSnippet {
    label: String,
    media_type: String,
    text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectFileEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    content_digest: Option<String>,
    fingerprint: String,
    kind: String,
    modified_at: String,
    mtime_ms: f64,
    path: String,
    size_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectSessionConflict {
    change: String,
    current: Option<NativeProjectFileEntry>,
    id: String,
    kind: String,
    message: String,
    path: String,
    previous: Option<NativeProjectFileEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectImportAsset {
    original_path: String,
    source_path: String,
    target_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectImportSource {
    assets: Vec<NativeProjectImportAsset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cleanup_path: Option<String>,
    html_file_path: String,
    html_source: String,
    source_kind: String,
    source_path: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeProjectAssetReadRequest {
    pub enforce_baseline: bool,
    pub expected_exists: bool,
    pub expected_modified_at_ms: Option<f64>,
    pub expected_size_bytes: Option<f64>,
    pub expected_content_digest: Option<String>,
    pub path: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeProjectAssetDigestRequest {
    pub expected_modified_at_ms: f64,
    pub expected_size_bytes: f64,
    pub path: String,
}

#[napi(object)]
pub struct NativeProjectAssetDigest {
    pub content_digest: String,
    pub path: String,
}

#[napi(object)]
pub struct NativeProjectAssetDigestBatch {
    pub digests: Vec<NativeProjectAssetDigest>,
    pub failures: Vec<NativeProjectAssetPayloadFailure>,
    pub total_source_bytes: u32,
}

#[napi(object)]
pub struct NativeProjectAssetPayload {
    pub bytes: Buffer,
    pub encoded_size_bytes: u32,
    pub media_type: String,
    pub modified_at_ms: f64,
    pub path: String,
    pub size_bytes: u32,
}

#[napi(object)]
pub struct NativeProjectAssetPayloadFailure {
    pub message: String,
    pub path: String,
    pub reason: String,
}

#[napi(object)]
pub struct NativeProjectAssetPayloadBatch {
    pub failures: Vec<NativeProjectAssetPayloadFailure>,
    pub payloads: Vec<NativeProjectAssetPayload>,
    pub total_encoded_bytes: u32,
    pub total_source_bytes: u32,
}

#[napi(js_name = "healthJson")]
pub fn health_json() -> String {
    json_string(&HealthReport {
        features: vec![
            "project-load",
            "asset-scan",
            "asset-payload-reader",
            "file-manifest",
            "manifest-diff",
            "html-import-assets",
            "zip-import",
            "project-save",
            "project-library-index",
        ],
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
    })
    .unwrap_or_else(|_| "{\"ok\":false}".into())
}

#[napi(js_name = "loadProjectFolderJson")]
pub fn load_project_folder_json(
    root_path: String,
    load_profile: Option<String>,
) -> napi::Result<String> {
    json_string(&load_project_folder(root_path, load_profile)?).map_err(native_error)
}

fn load_project_folder(
    root_path: String,
    load_profile: Option<String>,
) -> napi::Result<NativeProjectFolderResult> {
    let collect_timings = std::env::var("TWINE_PERF").is_ok_and(|value| value == "1");
    let root = PathBuf::from(&root_path);
    let passage_text_loaded = load_profile.as_deref() != Some("shell");
    let load_options = if passage_text_loaded {
        LoadProjectOptions::full()
    } else {
        LoadProjectOptions::shell()
    };
    let load_started_at = SystemTime::now();
    let started = Instant::now();
    let loaded = load_project_path_with_receipt(&root, load_options).map_err(native_error)?;
    let model_build_us = elapsed_us(started);
    let store_timings = loaded.timings.clone();
    let project = loaded.project;
    let started = Instant::now();
    let stories = project
        .stories
        .iter()
        .map(NativeStory::from_story)
        .collect::<Vec<_>>();
    let native_story_conversion_us = elapsed_us(started);
    let story_ids: Vec<String> = stories.iter().map(|story| story.id.clone()).collect();
    let receipt_started = Instant::now();
    let mut asset_scan_us = 0;
    let baseline_receipt = if passage_text_loaded {
        let mut layout_data = project.layout.clone();
        layout_data.passages.clear();
        let layout_data_json = json_string(&layout_data).map_err(native_error)?;
        let asset_scan_started = Instant::now();
        let assets = list_project_assets(&root).map_err(native_error)?;
        asset_scan_us = elapsed_us(asset_scan_started);
        let mut files = loaded
            .files
            .into_iter()
            .map(|file| {
                let passage_id = file.passage_id.clone();
                let story_id = file.story_id.clone();

                NativeProjectBaselineFile {
                    file: native_project_file_entry_from_loaded(file),
                    passage_id,
                    story_id,
                }
            })
            .collect::<Vec<_>>();
        let mut supplemental_files = Vec::new();
        scan_project_files(
            &root,
            ".twine/project.json",
            "metadata",
            &mut supplemental_files,
        )
        .map_err(native_error)?;
        supplemental_files.extend(assets.iter().filter_map(asset_project_file_entry));
        files.extend(
            supplemental_files
                .into_iter()
                .map(|file| NativeProjectBaselineFile {
                    file,
                    passage_id: None,
                    story_id: None,
                }),
        );
        files.sort_by(|left, right| left.file.path.cmp(&right.file.path));
        files.dedup_by(|left, right| left.file.path == right.file.path);
        let completed_at = SystemTime::now();

        Some(NativeProjectBaselineReceipt {
            assets,
            completed_at: system_time_to_iso(completed_at),
            files,
            id: format!("load-{}", system_time_to_ms(completed_at)),
            layout_data_json,
            root_path: root_path.clone(),
            schema_version: project.manifest.schema_version,
            started_at: system_time_to_iso(load_started_at),
            story_ids: story_ids.clone(),
        })
    } else {
        None
    };
    let baseline_receipt_us = elapsed_us(receipt_started);

    Ok(NativeProjectFolderResult {
        baseline_receipt,
        graph_layout_loaded: passage_text_loaded,
        passage_text_loaded,
        load_performance_timings: collect_timings.then_some(NativeProjectLoadTimings {
            asset_scan_us,
            baseline_receipt_us,
            graph_layout_us: store_timings.graph_layout_us,
            load_profile: if passage_text_loaded { "full" } else { "shell" }.into(),
            manifest_cache_bytes: store_timings.manifest_cache_bytes,
            manifest_cache_decode_us: store_timings.manifest_cache_decode_us,
            manifest_cache_hit: store_timings.manifest_cache_hit,
            manifest_cache_miss_reason: store_timings.manifest_cache_miss_reason,
            manifest_cache_read_us: store_timings.manifest_cache_read_us,
            manifest_digest: store_timings.manifest_digest,
            manifest_hash_us: store_timings.manifest_hash_us,
            manifest_parse_us: store_timings.manifest_parse_us,
            manifest_read_us: store_timings.manifest_read_us,
            manifest_toml_parse_us: store_timings.manifest_toml_parse_us,
            model_build_us,
            native_story_conversion_us,
            parallel: store_timings.parallel,
            passage_source_count: store_timings.passage_source_count,
            passage_source_us: store_timings.passage_source_us,
            source_bytes: store_timings.source_bytes,
            source_job_prepare_us: store_timings.source_job_prepare_us,
            story_source_count: store_timings.story_source_count,
            story_source_us: store_timings.story_source_us,
            worker_count: store_timings.worker_count,
        }),
        performance_timings: None,
        root_path,
        story_sources_loaded: passage_text_loaded,
        stories,
        story_ids,
    })
}

#[napi(js_name = "beginProjectFolderHydrationJson")]
pub fn begin_project_folder_hydration_json(
    root_path: String,
    story_ids_json: Option<String>,
) -> napi::Result<String> {
    let story_ids = story_ids_json
        .map(|source| serde_json::from_str::<Vec<String>>(&source).map_err(native_error))
        .transpose()?;
    let mut project = load_project_folder(root_path, Some("full".into()))?;
    if let Some(story_ids) = story_ids.as_ref().filter(|ids| !ids.is_empty()) {
        project
            .stories
            .retain(|story| story_ids.contains(&story.id));
        project.story_ids = project
            .stories
            .iter()
            .map(|story| story.id.clone())
            .collect();
    }

    let mut passages = Vec::new();
    for story in &mut project.stories {
        for passage in &mut story.passages {
            let text = std::mem::take(&mut passage.text);
            let mut leased = passage.clone();
            leased.text = text;
            passages.push((story.id.clone(), leased));
        }
    }
    let passage_count = passages.len();
    let hydration_id = format!(
        "native-hydration-{}",
        NEXT_HYDRATION_ID.fetch_add(1, Ordering::Relaxed)
    );
    hydration_leases()
        .lock()
        .map_err(|_| napi::Error::from_reason("Native hydration lease lock was poisoned."))?
        .insert(hydration_id.clone(), NativeHydrationLease { passages });

    json_string(&NativeHydrationStart {
        hydration_id,
        passage_count,
        project,
    })
    .map_err(native_error)
}

#[napi(js_name = "readProjectFolderHydrationChunkJson")]
pub fn read_project_folder_hydration_chunk_json(
    hydration_id: String,
    cursor: u32,
    limit: u32,
) -> napi::Result<String> {
    let leases = hydration_leases()
        .lock()
        .map_err(|_| napi::Error::from_reason("Native hydration lease lock was poisoned."))?;
    let lease = leases
        .get(&hydration_id)
        .ok_or_else(|| napi::Error::from_reason("Unknown or expired native hydration lease."))?;
    let cursor = (cursor as usize).min(lease.passages.len());
    let limit = (limit as usize).clamp(1, 1000);
    let next_cursor = (cursor + limit).min(lease.passages.len());
    let passages = lease.passages[cursor..next_cursor]
        .iter()
        .cloned()
        .map(|(story_id, passage)| NativeHydrationPassage { passage, story_id })
        .collect();

    json_string(&NativeHydrationChunk {
        done: next_cursor >= lease.passages.len(),
        next_cursor,
        passages,
    })
    .map_err(native_error)
}

#[napi(js_name = "finishProjectFolderHydration")]
pub fn finish_project_folder_hydration(hydration_id: String) -> napi::Result<()> {
    hydration_leases()
        .lock()
        .map_err(|_| napi::Error::from_reason("Native hydration lease lock was poisoned."))?
        .remove(&hydration_id);
    Ok(())
}

fn parse_project_source_layout(source_layout: &str) -> napi::Result<ProjectSourceLayout> {
    match source_layout {
        "passage-files" => Ok(ProjectSourceLayout::PassageFiles),
        "single-twee" => Ok(ProjectSourceLayout::SingleTwee),
        _ => Err(native_error(format!(
            "Unknown project source layout: {source_layout}"
        ))),
    }
}

#[napi(js_name = "saveProjectFolderJson")]
pub fn save_project_folder_json(
    root_path: String,
    story_json: String,
    source_layout: Option<String>,
) -> napi::Result<String> {
    save_project_folder_json_inner(root_path, story_json, source_layout, false, None)
}

#[napi(js_name = "saveProjectFolderJsonGuarded")]
pub fn save_project_folder_json_guarded(
    root_path: String,
    story_json: String,
    source_layout: Option<String>,
    expected_files_json: String,
) -> napi::Result<String> {
    let expected_files = serde_json::from_str::<Vec<NativeProjectFileEntry>>(&expected_files_json)
        .map_err(native_error)?;

    if expected_files.is_empty() {
        return Err(native_error(
            "Conflict-checked project saves require a non-empty file baseline.",
        ));
    }

    save_project_folder_json_inner(
        root_path,
        story_json,
        source_layout,
        false,
        Some(expected_files),
    )
}

#[napi(js_name = "createProjectFolderJson")]
pub fn create_project_folder_json(
    root_path: String,
    story_json: String,
    source_layout: Option<String>,
) -> napi::Result<String> {
    save_project_folder_json_inner(root_path, story_json, source_layout, true, None)
}

#[napi(js_name = "replaceProjectFolderStoriesJson")]
pub fn replace_project_folder_stories_json(
    root_path: String,
    replacements_json: String,
) -> napi::Result<String> {
    replace_project_folder_stories_json_inner(root_path, replacements_json)
}

#[napi(js_name = "installProjectFolderNoReplace")]
pub fn install_project_folder_no_replace(
    staging_root_path: String,
    destination_root_path: String,
) -> napi::Result<String> {
    install_project_folder_no_replace_inner(staging_root_path, destination_root_path)
        .map(|installed| installed.to_string())
}

fn install_project_folder_no_replace_inner(
    staging_root_path: String,
    destination_root_path: String,
) -> napi::Result<bool> {
    let staging_root = PathBuf::from(staging_root_path);
    let destination_root = PathBuf::from(destination_root_path);

    if !staging_root.is_absolute() || !destination_root.is_absolute() {
        return Err(native_error(
            "Project-folder installation requires absolute paths.",
        ));
    }
    if !staging_root.is_dir() || !staging_root.join("twine.toml").is_file() {
        return Err(native_error(
            "Project-folder installation requires a complete staged project.",
        ));
    }
    if destination_root
        .file_name()
        .and_then(|name| name.to_str())
        .is_none_or(|name| !name.ends_with(".twine.rs"))
    {
        return Err(native_error(
            "Project-folder installation requires a destination ending with .twine.rs.",
        ));
    }

    let staging_parent = staging_root
        .parent()
        .ok_or_else(|| native_error("The staged project requires a parent folder."))?;
    let destination_parent = destination_root
        .parent()
        .ok_or_else(|| native_error("The destination project requires a parent folder."))?;
    if fs::canonicalize(staging_parent).map_err(native_error)?
        != fs::canonicalize(destination_parent).map_err(native_error)?
    {
        return Err(native_error(
            "The staged and destination project folders must be siblings.",
        ));
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    let install_result = rustix::fs::renameat_with(
        rustix::fs::CWD,
        &staging_root,
        rustix::fs::CWD,
        &destination_root,
        rustix::fs::RenameFlags::NOREPLACE,
    )
    .map_err(io::Error::from);
    #[cfg(target_os = "windows")]
    let install_result = fs::rename(&staging_root, &destination_root);
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    let install_result = Err(io::Error::new(
        ErrorKind::Unsupported,
        "Atomic project-folder installation is unsupported on this platform.",
    ));

    match install_result {
        Ok(()) => Ok(true),
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::AlreadyExists | ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(false)
        }
        Err(error) => Err(native_error(error)),
    }
}

fn reserve_new_project_root(root: &Path) -> napi::Result<()> {
    if let Some(parent) = root.parent() {
        fs::create_dir_all(parent).map_err(native_error)?;
    }

    match fs::create_dir(root) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Err(native_error(
            "A new project cannot replace an existing filesystem entry.",
        )),
        Err(error) => Err(native_error(error)),
    }
}

fn replace_project_folder_stories_json_inner(
    root_path: String,
    replacements_json: String,
) -> napi::Result<String> {
    let requested_root = PathBuf::from(&root_path);

    if !requested_root.is_absolute() {
        return Err(native_error("Project roots must be absolute paths."));
    }
    if !requested_root.is_dir() || !requested_root.join("twine.toml").is_file() {
        return Err(native_error(
            "Project duplication requires an existing project folder with twine.toml.",
        ));
    }

    let root = fs::canonicalize(&requested_root).map_err(native_error)?;
    let root_path = root.to_string_lossy().into_owned();
    let replacements =
        serde_json::from_str::<Vec<NativeProjectStoryReplacement>>(&replacements_json)
            .map_err(native_error)?;
    let mut project =
        load_project_path_with_options(&root, LoadProjectOptions::full()).map_err(native_error)?;

    if replacements.len() != project.stories.len() {
        return Err(native_error(format!(
            "Project duplication requires replacements for all {} stories.",
            project.stories.len()
        )));
    }

    let existing_metadata = read_renderer_project_sidecar_stories(&root).map_err(native_error)?;
    let metadata_by_id = existing_metadata
        .into_iter()
        .filter_map(|story| {
            let id = story.get("id")?.as_str()?.to_owned();
            Some((id, story))
        })
        .collect::<BTreeMap<_, _>>();
    let mut replacements_by_source = BTreeMap::new();
    let mut new_story_ids = BTreeSet::new();
    let mut new_ifids = BTreeSet::new();

    for replacement in replacements {
        if replacements_by_source
            .insert(replacement.source_story_id.clone(), replacement)
            .is_some()
        {
            return Err(native_error(
                "Project duplication received a duplicate source story ID.",
            ));
        }
    }

    let original_stories = project.stories.clone();
    let original_manifest_name = project.manifest.name.clone();
    let original_story_ids = original_stories
        .iter()
        .map(|story| story.id.clone())
        .collect::<BTreeSet<_>>();
    let original_ifids = original_stories
        .iter()
        .map(|story| story.ifid.clone())
        .collect::<BTreeSet<_>>();
    let original_passage_ids = original_stories
        .iter()
        .flat_map(|story| story.passages.iter().map(|passage| passage.id.clone()))
        .collect::<BTreeSet<_>>();
    let mut story_id_mapping = BTreeMap::<StoryId, StoryId>::new();
    let mut passage_id_mapping = BTreeMap::<PassageId, Vec<PassageId>>::new();
    let mut new_passage_ids = BTreeSet::new();
    let mut replacement_metadata = Vec::with_capacity(original_stories.len());
    let mut duplicated_stories = Vec::with_capacity(original_stories.len());
    let mut remapped_layouts = Vec::with_capacity(original_stories.len());

    for original in &original_stories {
        let Some(replacement) = replacements_by_source.remove(original.id.as_ref()) else {
            return Err(native_error(format!(
                "Project duplication is missing source story {}.",
                original.id
            )));
        };
        let passage_replacements = replacement.passage_ids;
        let incoming_metadata = renderer_project_metadata(replacement.story.clone());
        let mut duplicate =
            serde_json::from_value::<Story>(replacement.story).map_err(native_error)?;

        if duplicate.id.as_ref().is_empty()
            || original_story_ids.contains(&duplicate.id)
            || !new_story_ids.insert(duplicate.id.clone())
            || duplicate.ifid.trim().is_empty()
            || original_ifids.contains(&duplicate.ifid)
            || !new_ifids.insert(duplicate.ifid.clone())
        {
            return Err(native_error(
                "Duplicated stories require new, unique, nonempty story IDs and IFIDs.",
            ));
        }
        if duplicate.passages.len() != original.passages.len() {
            return Err(native_error(format!(
                "Duplicated story {} must preserve the source passage count.",
                original.id
            )));
        }
        if passage_replacements.len() != original.passages.len() {
            return Err(native_error(format!(
                "Duplicated story {} requires a passage ID mapping for every source passage.",
                original.id
            )));
        }

        duplicate.color = original.color.clone();
        duplicate.custom_attributes = original.custom_attributes.clone();
        duplicate.format_options = original.format_options.clone();
        duplicate.metadata = original.metadata.clone();

        let duplicate_story_id = duplicate.id.clone();
        let source_passage_ids = original
            .passages
            .iter()
            .map(|passage| passage.id.as_ref())
            .collect::<BTreeSet<_>>();
        let incoming_duplicate_passage_ids = duplicate
            .passages
            .iter()
            .map(|passage| passage.id.as_ref())
            .collect::<BTreeSet<_>>();
        let mut mapped_source_passage_ids = BTreeSet::new();
        let mut mapped_duplicate_passage_ids = BTreeSet::new();
        let mut source_to_duplicate_passage = BTreeMap::new();
        let mut duplicate_to_source_passage = BTreeMap::new();

        for passage_replacement in &passage_replacements {
            if passage_replacement.source_passage_id.is_empty()
                || passage_replacement.duplicate_passage_id.is_empty()
                || !mapped_source_passage_ids.insert(passage_replacement.source_passage_id.as_str())
                || !mapped_duplicate_passage_ids
                    .insert(passage_replacement.duplicate_passage_id.as_str())
            {
                return Err(native_error(
                    "Duplicated story passage mappings must be a nonempty bijection.",
                ));
            }
            source_to_duplicate_passage.insert(
                passage_replacement.source_passage_id.as_str(),
                passage_replacement.duplicate_passage_id.as_str(),
            );
            duplicate_to_source_passage.insert(
                passage_replacement.duplicate_passage_id.as_str(),
                passage_replacement.source_passage_id.as_str(),
            );
        }
        if mapped_source_passage_ids != source_passage_ids
            || mapped_duplicate_passage_ids != incoming_duplicate_passage_ids
        {
            return Err(native_error(
                "Duplicated story passage mappings must exactly cover the source and duplicate passages.",
            ));
        }

        let mut story_layouts = Vec::with_capacity(original.passages.len());
        let mut duplicate_passage_ids = BTreeSet::new();
        for duplicate_passage in &mut duplicate.passages {
            if duplicate_passage.id.as_ref().is_empty()
                || original_passage_ids.contains(&duplicate_passage.id)
                || !duplicate_passage_ids.insert(duplicate_passage.id.clone())
                || !new_passage_ids.insert(duplicate_passage.id.clone())
            {
                return Err(native_error(
                    "Duplicated passages require new, unique, nonempty passage IDs.",
                ));
            }
            let source_passage_id = duplicate_to_source_passage
                .get(duplicate_passage.id.as_ref())
                .expect("validated passage mapping");
            let source_passage = original
                .passages
                .iter()
                .find(|passage| passage.id.as_ref() == *source_passage_id)
                .expect("validated source passage mapping");
            passage_id_mapping
                .entry(source_passage.id.clone())
                .or_default()
                .push(duplicate_passage.id.clone());
            if duplicate_passage.story != duplicate_story_id {
                return Err(native_error(
                    "Duplicated passage parent IDs must match the duplicated story ID.",
                ));
            }

            duplicate_passage.custom_attributes = source_passage.custom_attributes.clone();
            duplicate_passage.metadata = source_passage.metadata.clone();
            duplicate_passage.source_pid = source_passage.source_pid.clone();

            let mut layout = project
                .layout
                .passages
                .get(&original.id, &source_passage.id)
                .cloned()
                .unwrap_or_default();
            if let Some(bounds) = duplicate_passage.layout {
                layout.bounds = bounds;
            }
            story_layouts.push((duplicate_passage.id.clone(), layout));
        }
        let expected_start_passage = if original.start_passage.as_ref().is_empty() {
            ""
        } else {
            source_to_duplicate_passage
                .get(original.start_passage.as_ref())
                .copied()
                .ok_or_else(|| {
                    native_error(
                        "The source story start passage is absent from its passage ID mapping.",
                    )
                })?
        };
        if duplicate.start_passage.as_ref() != expected_start_passage {
            return Err(native_error(
                "Duplicated story start passage must match the mapped source start passage.",
            ));
        }

        story_id_mapping.insert(duplicate.id.clone(), original.id.clone());
        remapped_layouts.push((original.id.clone(), duplicate.id.clone(), story_layouts));
        replacement_metadata.push(
            metadata_by_id
                .get(original.id.as_ref())
                .map(|existing| merge_renderer_story_metadata(existing, &incoming_metadata))
                .unwrap_or(incoming_metadata),
        );
        duplicated_stories.push(duplicate);
    }

    if !replacements_by_source.is_empty() {
        return Err(native_error(
            "Project duplication received an unknown source story ID.",
        ));
    }

    for (source_story_id, duplicate_story_id, layouts) in remapped_layouts {
        project.layout.passages.remove_story(&source_story_id);
        project
            .layout
            .passages
            .extend_story(duplicate_story_id, layouts);
    }
    for group in project.layout.groups.values_mut() {
        group.passages = std::mem::take(&mut group.passages)
            .into_iter()
            .flat_map(|passage_id| {
                passage_id_mapping
                    .get(&passage_id)
                    .cloned()
                    .unwrap_or_else(|| vec![passage_id])
            })
            .collect();
    }
    for saved_layout in project.layout.saved_layouts.values_mut() {
        saved_layout.passages = std::mem::take(&mut saved_layout.passages)
            .into_iter()
            .flat_map(|(passage_id, layout)| {
                passage_id_mapping.get(&passage_id).map_or_else(
                    || vec![(passage_id, layout.clone())],
                    |duplicate_ids| {
                        duplicate_ids
                            .iter()
                            .cloned()
                            .map(|duplicate_id| (duplicate_id, layout.clone()))
                            .collect()
                    },
                )
            })
            .collect();
    }

    let source_to_duplicate = story_id_mapping
        .iter()
        .map(|(duplicate, source)| (source.clone(), duplicate.clone()))
        .collect::<BTreeMap<_, _>>();
    for story_id in &mut project.library.sort_order {
        if let Some(duplicate_id) = source_to_duplicate.get(story_id) {
            *story_id = duplicate_id.clone();
        }
    }
    project.library.colors = std::mem::take(&mut project.library.colors)
        .into_iter()
        .map(|(story_id, color)| {
            (
                source_to_duplicate
                    .get(&story_id)
                    .cloned()
                    .unwrap_or(story_id),
                color,
            )
        })
        .collect();
    project.manifest.source_layouts = std::mem::take(&mut project.manifest.source_layouts)
        .into_iter()
        .map(|(story_id, layout)| {
            (
                source_to_duplicate
                    .get(&story_id)
                    .cloned()
                    .unwrap_or(story_id),
                layout,
            )
        })
        .collect();
    if original_stories.len() == 1 && original_manifest_name == original_stories[0].name {
        project.manifest.name = duplicated_stories[0].name.clone();
    }
    project.stories = duplicated_stories;

    let prepared_sidecar =
        renderer_project_sidecar_bytes(&replacement_metadata).map_err(native_error)?;
    save_project_path_with_prepared_sidecar_and_story_id_mapping(
        &root,
        &project,
        &SaveOptions {
            create_backup: false,
            max_backups: project.manifest.storage.max_backups,
            write_generated_indexes: true,
        },
        Some(&prepared_sidecar),
        Some(&story_id_mapping),
    )
    .map_err(native_error)?;

    let stories = project
        .stories
        .iter()
        .zip(&replacement_metadata)
        .map(|(story, metadata)| NativeStory::from_story_and_metadata(story, metadata))
        .collect::<Vec<_>>();
    let story_ids = stories.iter().map(|story| story.id.clone()).collect();

    json_string(&NativeProjectFolderResult {
        baseline_receipt: None,
        graph_layout_loaded: true,
        passage_text_loaded: true,
        load_performance_timings: None,
        performance_timings: None,
        root_path,
        story_sources_loaded: true,
        stories,
        story_ids,
    })
    .map_err(native_error)
}

fn save_project_folder_json_inner(
    root_path: String,
    story_json: String,
    source_layout: Option<String>,
    allow_create: bool,
    expected_files: Option<Vec<NativeProjectFileEntry>>,
) -> napi::Result<String> {
    let total_started = Instant::now();
    let mut timings = NativeProjectSaveTimings::default();
    let requested_root = PathBuf::from(&root_path);

    if !requested_root.is_absolute() {
        return Err(native_error("Project roots must be absolute paths."));
    }

    let root = if allow_create {
        requested_root
    } else {
        if !requested_root.is_dir() || !requested_root.join("twine.toml").is_file() {
            return Err(native_error(
                "Project saves require an existing project folder with twine.toml.",
            ));
        }

        fs::canonicalize(&requested_root).map_err(native_error)?
    };
    let root_path = root.to_string_lossy().into_owned();
    let started = Instant::now();
    let story_value =
        serde_json::from_str::<serde_json::Value>(&story_json).map_err(native_error)?;
    let story = serde_json::from_value::<Story>(story_value.clone()).map_err(native_error)?;
    timings.json_parse_us = elapsed_us(started);
    let started = Instant::now();
    let incoming_metadata = renderer_project_metadata(story_value);
    let existing_metadata = if allow_create {
        Vec::new()
    } else {
        read_renderer_project_sidecar_stories(&root).map_err(native_error)?
    };
    let project = if allow_create {
        let mut project = Project::from_story(story.clone());

        project.manifest.app_version = "twine.rs-desktop".into();
        project.manifest.storage = StoragePolicy {
            message: "Native twine.rs desktop project folder".into(),
            ..StoragePolicy::default()
        };
        if let Some(source_layout) = source_layout.as_deref() {
            project.manifest.set_source_layout(
                story.id.clone(),
                parse_project_source_layout(source_layout)?,
            );
        }

        project
    } else {
        let mut project = load_project_path_with_options(&root, LoadProjectOptions::full())
            .map_err(native_error)?;
        let existing_index = project
            .stories
            .iter()
            .position(|existing_story| existing_story.id == story.id);
        let existing_layout = existing_index.map(|_| project.manifest.source_layout_for(&story.id));
        let incoming_project = Project::from_story(story.clone());
        let merged_layouts = incoming_project
            .layout
            .passages
            .iter()
            .map(|(_, passage_id, incoming)| {
                let mut merged = project
                    .layout
                    .passages
                    .get(&story.id, passage_id)
                    .cloned()
                    .unwrap_or_default();

                merged.bounds = incoming.bounds;
                (passage_id.clone(), merged)
            })
            .collect::<Vec<_>>();

        project.layout.passages.remove_story(&story.id);
        project
            .layout
            .passages
            .extend_story(story.id.clone(), merged_layouts);
        project.manifest.schema_version =
            project.manifest.schema_version.max(PROJECT_SCHEMA_VERSION);

        if let Some(color) = &story.color {
            project
                .library
                .colors
                .insert(story.id.clone(), color.clone());
        } else {
            project.library.colors.remove(&story.id);
        }

        if let Some(index) = existing_index {
            project.stories[index] = story.clone();
        } else {
            project.stories.push(story.clone());
            if !project.library.sort_order.contains(&story.id) {
                project.library.sort_order.push(story.id.clone());
            }
        }

        if let Some(existing_layout) = existing_layout {
            project
                .manifest
                .set_source_layout(story.id.clone(), existing_layout);
        } else if let Some(source_layout) = source_layout.as_deref() {
            project.manifest.set_source_layout(
                story.id.clone(),
                parse_project_source_layout(source_layout)?,
            );
        }

        project
    };
    let merged_metadata = merge_renderer_project_metadata(
        &project,
        story.id.as_ref(),
        incoming_metadata,
        existing_metadata,
    );
    let sidecar_started = Instant::now();
    let prepared_sidecar =
        renderer_project_sidecar_bytes(&merged_metadata).map_err(native_error)?;
    timings.sidecar_us = elapsed_us(sidecar_started);
    timings.project_build_us = elapsed_us(started);

    if allow_create {
        // The create itself is the exclusivity check. This closes the race
        // between checking the target and handing it to the project writer.
        reserve_new_project_root(&root)?;
    }

    let started = Instant::now();
    let save_options = SaveOptions {
        create_backup: !allow_create,
        max_backups: project.manifest.storage.max_backups,
        write_generated_indexes: true,
    };
    let save_report = if let Some(expected_files) = expected_files {
        save_project_path_with_prepared_sidecar_and_preinstall(
            &root,
            &project,
            &save_options,
            Some(&prepared_sidecar),
            |current_root| validate_project_file_baseline(current_root, &expected_files),
        )
    } else {
        save_project_path_with_prepared_sidecar(
            &root,
            &project,
            &save_options,
            Some(&prepared_sidecar),
        )
    }
    .map_err(native_error)?;
    timings.save_project_path_us = elapsed_us(started);
    timings.changed_file_plan_us = save_report.timings.changed_file_plan_us;
    timings.collect_new_files_us = save_report.timings.collect_new_files_us;
    timings.collect_old_files_us = save_report.timings.collect_old_files_us;
    timings.copy_assets_us = save_report.timings.copy_assets_us;
    timings.dirty_compare_us = save_report.timings.dirty_compare_us;
    timings.root_swap_us = save_report.timings.root_swap_us;
    timings.write_temp_project_us = save_report.timings.write_temp_project_us;
    timings.total_us = elapsed_us(total_started);

    let stories = project
        .stories
        .iter()
        .zip(&merged_metadata)
        .map(|(story, metadata)| NativeStory::from_story_and_metadata(story, metadata))
        .collect::<Vec<_>>();
    let story_ids = stories.iter().map(|story| story.id.clone()).collect();

    json_string(&NativeProjectFolderResult {
        baseline_receipt: None,
        graph_layout_loaded: true,
        passage_text_loaded: true,
        load_performance_timings: None,
        performance_timings: performance_timings(timings),
        root_path,
        story_sources_loaded: true,
        stories,
        story_ids,
    })
    .map_err(native_error)
}

fn performance_timings(timings: NativeProjectSaveTimings) -> Option<NativeProjectSaveTimings> {
    (std::env::var("TWINE_PERF").ok().as_deref() == Some("1")).then_some(timings)
}

fn elapsed_us(started: Instant) -> u64 {
    started.elapsed().as_micros().try_into().unwrap_or(u64::MAX)
}

#[napi(js_name = "rememberProjectFolderJson")]
pub fn remember_project_folder_json(
    index_path: String,
    project_json: String,
) -> napi::Result<String> {
    let index_path = PathBuf::from(index_path);
    let project =
        serde_json::from_str::<NativeProjectFolderResult>(&project_json).map_err(native_error)?;
    let story_ids = if project.story_ids.is_empty() {
        project
            .stories
            .iter()
            .map(|story| story.id.clone())
            .collect::<Vec<_>>()
    } else {
        project.story_ids
    };
    let mut index = read_project_library_index(&index_path).map_err(native_error)?;
    let entry = NativeRememberedProjectFolder {
        root_path: project.root_path,
        story_ids,
        updated_at: now_iso(),
    };

    index
        .projects
        .retain(|project| project.root_path != entry.root_path);
    index.projects.push(entry.clone());
    index
        .projects
        .sort_by(|left, right| left.root_path.cmp(&right.root_path));
    write_project_library_index(&index_path, &index).map_err(native_error)?;

    json_string(&entry).map_err(native_error)
}

#[napi(js_name = "forgetProjectFolderJson")]
pub fn forget_project_folder_json(index_path: String, root_path: String) -> napi::Result<String> {
    let index_path = PathBuf::from(index_path);
    let mut index = read_project_library_index(&index_path).map_err(native_error)?;

    index
        .projects
        .retain(|project| project.root_path != root_path);
    write_project_library_index(&index_path, &index).map_err(native_error)?;

    json_string(&index.projects).map_err(native_error)
}

#[napi(js_name = "listRememberedProjectFoldersJson")]
pub fn list_remembered_project_folders_json(index_path: String) -> napi::Result<String> {
    let index = read_project_library_index(Path::new(&index_path)).map_err(native_error)?;

    json_string(&index.projects).map_err(native_error)
}

#[napi(js_name = "listProjectAssetsJson")]
pub fn list_project_assets_json(root_path: String) -> napi::Result<String> {
    let assets = list_project_assets(Path::new(&root_path)).map_err(native_error)?;

    json_string(&assets).map_err(native_error)
}

/// Reads only supported media below a project's canonical `assets/` root.
/// The byte limits apply to eventual base64-encoded sizes, and native hard
/// ceilings constrain encoded bytes and unique path count regardless of the
/// caller's requested limits.
#[napi(js_name = "readProjectAssetPayloads")]
pub fn read_project_asset_payloads(
    root_path: String,
    requests: Vec<NativeProjectAssetReadRequest>,
    max_file_encoded_bytes: u32,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
) -> AsyncTask<ReadProjectAssetPayloadsTask> {
    AsyncTask::new(ReadProjectAssetPayloadsTask {
        allow_any_file_type: false,
        hard_max_encoded_bytes: NATIVE_ASSET_MAX_ENCODED_BYTES,
        hard_max_file_count: NATIVE_ASSET_MAX_FILE_COUNT,
        hard_max_request_count: NATIVE_ASSET_PAYLOAD_MAX_REQUEST_COUNT,
        root_path,
        requests,
        require_content_digest: true,
        max_file_encoded_bytes,
        max_file_count,
        max_total_encoded_bytes,
    })
}

/// Reads bounded preview assets through the same anchored, no-follow project
/// capability as media embedding, while permitting non-media support files.
#[napi(js_name = "readProjectPreviewAssetPayloads")]
pub fn read_project_preview_asset_payloads(
    root_path: String,
    requests: Vec<NativeProjectAssetReadRequest>,
    max_file_encoded_bytes: u32,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
) -> AsyncTask<ReadProjectAssetPayloadsTask> {
    AsyncTask::new(ReadProjectAssetPayloadsTask {
        allow_any_file_type: true,
        hard_max_encoded_bytes: NATIVE_PREVIEW_ASSET_MAX_ENCODED_BYTES,
        hard_max_file_count: NATIVE_PREVIEW_ASSET_MAX_FILE_COUNT,
        hard_max_request_count: NATIVE_PREVIEW_ASSET_MAX_REQUEST_COUNT,
        root_path,
        requests,
        require_content_digest: false,
        max_file_encoded_bytes,
        max_file_count,
        max_total_encoded_bytes,
    })
}

pub struct ReadProjectAssetPayloadsTask {
    allow_any_file_type: bool,
    hard_max_encoded_bytes: u32,
    hard_max_file_count: u32,
    hard_max_request_count: usize,
    root_path: String,
    requests: Vec<NativeProjectAssetReadRequest>,
    require_content_digest: bool,
    max_file_encoded_bytes: u32,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
}

#[napi(js_name = "captureProjectAssetDigests")]
pub fn capture_project_asset_digests(
    root_path: String,
    requests: Vec<NativeProjectAssetDigestRequest>,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
) -> AsyncTask<CaptureProjectAssetDigestsTask> {
    AsyncTask::new(CaptureProjectAssetDigestsTask {
        root_path,
        requests,
        max_file_count,
        max_total_encoded_bytes,
    })
}

pub struct CaptureProjectAssetDigestsTask {
    root_path: String,
    requests: Vec<NativeProjectAssetDigestRequest>,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
}

impl Task for CaptureProjectAssetDigestsTask {
    type Output = NativeProjectAssetDigestBatch;
    type JsValue = NativeProjectAssetDigestBatch;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        capture_project_asset_digests_impl(
            Path::new(&self.root_path),
            std::mem::take(&mut self.requests),
            self.max_file_count,
            self.max_total_encoded_bytes,
        )
        .map_err(|message| napi::Error::new(Status::InvalidArg, message))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

impl Task for ReadProjectAssetPayloadsTask {
    type Output = NativeProjectAssetPayloadBatch;
    type JsValue = NativeProjectAssetPayloadBatch;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        read_project_asset_payload_requests_with_policy(
            Path::new(&self.root_path),
            std::mem::take(&mut self.requests),
            self.max_file_encoded_bytes,
            self.max_file_count,
            self.max_total_encoded_bytes,
            self.hard_max_request_count,
            self.hard_max_file_count,
            self.hard_max_encoded_bytes,
            self.allow_any_file_type,
            self.require_content_digest,
        )
        .map_err(|message| napi::Error::new(Status::InvalidArg, message))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

#[cfg(test)]
fn read_project_asset_payloads_impl(
    root: &Path,
    paths: Vec<String>,
    max_file_encoded_bytes: u32,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
) -> Result<NativeProjectAssetPayloadBatch, String> {
    read_project_asset_payload_requests_impl(
        root,
        paths
            .into_iter()
            .map(|path| NativeProjectAssetReadRequest {
                enforce_baseline: false,
                expected_exists: false,
                expected_modified_at_ms: None,
                expected_size_bytes: None,
                expected_content_digest: None,
                path,
            })
            .collect(),
        max_file_encoded_bytes,
        max_file_count,
        max_total_encoded_bytes,
    )
}

#[cfg(test)]
fn read_project_preview_asset_payloads_impl(
    root: &Path,
    paths: Vec<String>,
    max_file_encoded_bytes: u32,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
) -> Result<NativeProjectAssetPayloadBatch, String> {
    read_project_asset_payload_requests_with_policy(
        root,
        paths
            .into_iter()
            .map(|path| NativeProjectAssetReadRequest {
                enforce_baseline: false,
                expected_exists: false,
                expected_modified_at_ms: None,
                expected_size_bytes: None,
                expected_content_digest: None,
                path,
            })
            .collect(),
        max_file_encoded_bytes,
        max_file_count,
        max_total_encoded_bytes,
        NATIVE_PREVIEW_ASSET_MAX_REQUEST_COUNT,
        NATIVE_PREVIEW_ASSET_MAX_FILE_COUNT,
        NATIVE_PREVIEW_ASSET_MAX_ENCODED_BYTES,
        true,
        false,
    )
}

#[cfg(test)]
fn read_project_asset_payload_requests_impl(
    root: &Path,
    requests: Vec<NativeProjectAssetReadRequest>,
    max_file_encoded_bytes: u32,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
) -> Result<NativeProjectAssetPayloadBatch, String> {
    read_project_asset_payload_requests_with_policy(
        root,
        requests,
        max_file_encoded_bytes,
        max_file_count,
        max_total_encoded_bytes,
        NATIVE_ASSET_PAYLOAD_MAX_REQUEST_COUNT,
        NATIVE_ASSET_MAX_FILE_COUNT,
        NATIVE_ASSET_MAX_ENCODED_BYTES,
        false,
        true,
    )
}

#[allow(clippy::too_many_arguments)]
fn read_project_asset_payload_requests_with_policy(
    root: &Path,
    requests: Vec<NativeProjectAssetReadRequest>,
    max_file_encoded_bytes: u32,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
    hard_max_request_count: usize,
    hard_max_file_count: u32,
    hard_max_encoded_bytes: u32,
    allow_any_file_type: bool,
    require_content_digest: bool,
) -> Result<NativeProjectAssetPayloadBatch, String> {
    if requests.len() > hard_max_request_count {
        return Err(format!(
            "Asset request count exceeds the native limit {hard_max_request_count}."
        ));
    }
    if requests
        .iter()
        .any(|request| request.path.len() > NATIVE_ASSET_MAX_PATH_BYTES)
    {
        return Err(format!(
            "Asset request path exceeds the native limit {NATIVE_ASSET_MAX_PATH_BYTES} bytes."
        ));
    }

    let assets_dir = open_project_assets_dir(root)?;
    let mut seen = BTreeSet::new();
    let mut payloads = Vec::new();
    let mut failures = Vec::new();
    let mut total_encoded_bytes = 0_u64;
    let mut total_source_bytes = 0_u64;
    let max_file_encoded_bytes = max_file_encoded_bytes.min(hard_max_encoded_bytes);
    let max_file_count = max_file_count.min(hard_max_file_count);
    let max_total_encoded_bytes = max_total_encoded_bytes.min(hard_max_encoded_bytes);
    let mut requested_file_count = 0_u32;

    for request in requests {
        let path = request.path;
        if !seen.insert(path.clone()) {
            continue;
        }

        let Some(relative_asset_path) = canonical_asset_request_path(&path) else {
            failures.push(asset_payload_failure(
                path,
                "invalid-path",
                "Asset path must be a canonical assets/... project-relative path.",
            ));
            continue;
        };
        let media_type = match supported_asset_media_type(&path) {
            Some(media_type) => media_type,
            None if allow_any_file_type => "application/octet-stream",
            None => {
                failures.push(asset_payload_failure(
                    path,
                    "unsupported-type",
                    "Asset file type is not supported for media embedding.",
                ));
                continue;
            }
        };
        requested_file_count = requested_file_count.saturating_add(1);
        if requested_file_count > max_file_count {
            failures.push(asset_payload_failure(
                path,
                "file-count-exceeded",
                format!("Asset request exceeds the file-count limit {max_file_count}."),
            ));
            continue;
        }
        let Some(assets_dir) = assets_dir.as_ref() else {
            failures.push(asset_payload_failure(
                path,
                if request.expected_exists {
                    "changed-since-index"
                } else {
                    "missing"
                },
                if request.expected_exists {
                    "Indexed asset disappeared before it could be read."
                } else {
                    "Project assets directory does not exist."
                },
            ));
            continue;
        };
        let mut file = match open_project_asset_file(assets_dir, &relative_asset_path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                failures.push(asset_payload_failure(
                    path,
                    if request.expected_exists {
                        "changed-since-index"
                    } else {
                        "missing"
                    },
                    if request.expected_exists {
                        "Indexed asset disappeared before it could be read."
                    } else {
                        "Asset does not exist."
                    },
                ));
                continue;
            }
            Err(error) => {
                let reason = if error.kind() == ErrorKind::PermissionDenied {
                    "unreadable"
                } else {
                    "symlink-escape"
                };
                failures.push(asset_payload_failure(
                    path,
                    reason,
                    format!("Asset could not be opened without following links: {error}"),
                ));
                continue;
            }
        };
        let before = match file.metadata() {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => {
                failures.push(asset_payload_failure(
                    path,
                    "not-file",
                    "Asset path is not a regular file.",
                ));
                continue;
            }
            Err(error) => {
                failures.push(asset_payload_failure(
                    path,
                    if error.kind() == ErrorKind::NotFound && request.expected_exists {
                        "changed-since-index"
                    } else if error.kind() == ErrorKind::NotFound {
                        "missing"
                    } else {
                        "unreadable"
                    },
                    format!("Asset metadata could not be read: {error}"),
                ));
                continue;
            }
        };
        if !request.expected_exists
            && (request.expected_size_bytes.is_some() || request.expected_modified_at_ms.is_some())
        {
            return Err("Invalid asset baseline expectation.".into());
        }
        if request.enforce_baseline
            && request.expected_exists
            && (request.expected_size_bytes.is_none() || request.expected_modified_at_ms.is_none())
        {
            return Err("Indexed asset baseline is incomplete.".into());
        }
        if request.enforce_baseline && !request.expected_exists {
            failures.push(asset_payload_failure(
                path,
                "changed-since-index",
                "Asset appeared after project indexing.",
            ));
            continue;
        } else if request.enforce_baseline {
            let observed_modified_at_ms =
                system_time_to_ms(before.modified().unwrap_or(UNIX_EPOCH));
            let size_changed = request
                .expected_size_bytes
                .is_some_and(|expected| expected != before.len() as f64);
            let modified_changed = request
                .expected_modified_at_ms
                .is_some_and(|expected| expected.trunc() != observed_modified_at_ms.trunc());

            if size_changed || modified_changed {
                failures.push(asset_payload_failure(
                    path,
                    "changed-since-index",
                    "Asset size or modification time changed after project indexing.",
                ));
                continue;
            }
        }
        let Some(observed_encoded_size) = encoded_size_bytes(before.len()) else {
            failures.push(asset_payload_failure(
                path,
                "file-too-large",
                "Asset size cannot be represented safely.",
            ));
            continue;
        };

        if observed_encoded_size > u64::from(max_file_encoded_bytes) {
            failures.push(asset_payload_failure(
                path,
                "file-too-large",
                format!(
                    "Encoded asset size {observed_encoded_size} exceeds the per-file limit {max_file_encoded_bytes}."
                ),
            ));
            continue;
        }
        if total_encoded_bytes.saturating_add(observed_encoded_size)
            > u64::from(max_total_encoded_bytes)
        {
            failures.push(asset_payload_failure(
                path,
                "total-limit-exceeded",
                format!("Encoded asset would exceed the total limit {max_total_encoded_bytes}."),
            ));
            continue;
        }

        let remaining_total =
            u64::from(max_total_encoded_bytes).saturating_sub(total_encoded_bytes);
        let raw_read_limit = raw_bytes_for_encoded_limit(u64::from(max_file_encoded_bytes))
            .min(raw_bytes_for_encoded_limit(remaining_total));
        let mut bytes = Vec::with_capacity(
            usize::try_from(before.len().min(raw_read_limit)).unwrap_or_default(),
        );
        let read_result = file
            .by_ref()
            .take(raw_read_limit.saturating_add(1))
            .read_to_end(&mut bytes);

        if let Err(error) = read_result {
            failures.push(asset_payload_failure(
                path,
                "unreadable",
                format!("Asset could not be read: {error}"),
            ));
            continue;
        }
        let Some(encoded_size) = encoded_size_bytes(bytes.len() as u64) else {
            failures.push(asset_payload_failure(
                path,
                "file-too-large",
                "Asset size cannot be represented safely.",
            ));
            continue;
        };
        if encoded_size > u64::from(max_file_encoded_bytes) {
            failures.push(asset_payload_failure(
                path,
                "file-too-large",
                "Asset grew beyond the per-file encoded-size limit while it was read.",
            ));
            continue;
        }
        if total_encoded_bytes.saturating_add(encoded_size) > u64::from(max_total_encoded_bytes) {
            failures.push(asset_payload_failure(
                path,
                "total-limit-exceeded",
                "Asset grew beyond the total encoded-size limit while it was read.",
            ));
            continue;
        }

        let after = match file.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                failures.push(asset_payload_failure(
                    path,
                    "changed",
                    format!("Asset metadata changed while it was read: {error}"),
                ));
                continue;
            }
        };
        if bytes.len() as u64 != before.len() || file_metadata_changed(&before, &after) {
            failures.push(asset_payload_failure(
                path,
                "changed",
                "Asset changed while it was being read.",
            ));
            continue;
        }
        if request.enforce_baseline {
            let digest_is_valid = request
                .expected_content_digest
                .as_ref()
                .is_some_and(|digest| {
                    digest.len() == 64
                        && digest
                            .bytes()
                            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                });
            if require_content_digest && !digest_is_valid {
                failures.push(asset_payload_failure(
                    path,
                    "changed-since-index",
                    "A trusted content digest was not captured for this indexed asset.",
                ));
                continue;
            }
            let observed_digest = digest_is_valid.then(|| format!("{:x}", Sha256::digest(&bytes)));
            if observed_digest.as_deref().is_some_and(|observed| {
                request.expected_content_digest.as_deref() != Some(observed)
            }) {
                failures.push(asset_payload_failure(
                    path,
                    "changed-since-index",
                    "Asset content changed after project indexing.",
                ));
                continue;
            }
        }

        let Ok(size_bytes) = u32::try_from(bytes.len()) else {
            failures.push(asset_payload_failure(
                path,
                "file-too-large",
                "Asset source size is too large to return.",
            ));
            continue;
        };
        let encoded_size_bytes = encoded_size as u32;
        total_source_bytes += u64::from(size_bytes);
        total_encoded_bytes += encoded_size;
        payloads.push(NativeProjectAssetPayload {
            bytes: bytes.into(),
            encoded_size_bytes,
            media_type: media_type.into(),
            modified_at_ms: system_time_to_ms(after.modified().unwrap_or(UNIX_EPOCH)),
            path,
            size_bytes,
        });
    }

    Ok(NativeProjectAssetPayloadBatch {
        failures,
        payloads,
        total_encoded_bytes: total_encoded_bytes as u32,
        total_source_bytes: total_source_bytes as u32,
    })
}

fn capture_project_asset_digests_impl(
    root: &Path,
    requests: Vec<NativeProjectAssetDigestRequest>,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
) -> Result<NativeProjectAssetDigestBatch, String> {
    if requests.len() > NATIVE_ASSET_DIGEST_MAX_REQUEST_COUNT {
        return Err(format!(
            "Asset digest request count exceeds the native limit {NATIVE_ASSET_DIGEST_MAX_REQUEST_COUNT}."
        ));
    }
    if requests
        .iter()
        .any(|request| request.path.len() > NATIVE_ASSET_MAX_PATH_BYTES)
    {
        return Err(format!(
            "Asset digest path exceeds the native limit {NATIVE_ASSET_MAX_PATH_BYTES} bytes."
        ));
    }

    let assets_dir = open_project_assets_dir(root)?;
    let max_file_count = max_file_count.min(NATIVE_ASSET_DIGEST_MAX_REQUEST_COUNT as u32);
    let max_total_encoded_bytes = max_total_encoded_bytes.min(NATIVE_ASSET_MAX_ENCODED_BYTES);
    let mut seen = BTreeSet::new();
    let mut digests = Vec::new();
    let mut failures = Vec::new();
    let mut total_source_bytes = 0_u64;
    let mut total_encoded_bytes = 0_u64;
    let mut requested_file_count = 0_u32;

    for request in requests {
        let path = request.path;
        if !seen.insert(path.clone()) {
            continue;
        }
        let Some(relative_path) = canonical_asset_request_path(&path) else {
            failures.push(asset_payload_failure(
                path,
                "invalid-path",
                "Asset path must be a canonical assets/... project-relative path.",
            ));
            continue;
        };
        if supported_asset_media_type(&path).is_none() {
            failures.push(asset_payload_failure(
                path,
                "unsupported-type",
                "Asset file type is not supported for media embedding.",
            ));
            continue;
        }
        requested_file_count = requested_file_count.saturating_add(1);
        if requested_file_count > max_file_count {
            failures.push(asset_payload_failure(
                path,
                "file-count-exceeded",
                format!("Asset digest request exceeds the file-count limit {max_file_count}."),
            ));
            continue;
        }
        let Some(assets_dir) = assets_dir.as_ref() else {
            failures.push(asset_payload_failure(
                path,
                "changed-since-index",
                "Indexed asset disappeared before its digest could be captured.",
            ));
            continue;
        };
        let mut file = match open_project_asset_file(assets_dir, &relative_path) {
            Ok(file) => file,
            Err(error) => {
                let reason = match error.kind() {
                    ErrorKind::NotFound => "changed-since-index",
                    ErrorKind::PermissionDenied => "unreadable",
                    _ => "symlink-escape",
                };
                failures.push(asset_payload_failure(
                    path,
                    reason,
                    format!("Asset could not be opened safely for digest capture: {error}"),
                ));
                continue;
            }
        };
        let before = match file.metadata() {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => {
                failures.push(asset_payload_failure(
                    path,
                    "not-file",
                    "Asset is not a regular file.",
                ));
                continue;
            }
            Err(error) => {
                failures.push(asset_payload_failure(
                    path,
                    "unreadable",
                    format!("Asset metadata could not be read: {error}"),
                ));
                continue;
            }
        };
        let observed_modified_at_ms = system_time_to_ms(before.modified().unwrap_or(UNIX_EPOCH));
        if request.expected_size_bytes != before.len() as f64
            || request.expected_modified_at_ms.trunc() != observed_modified_at_ms.trunc()
        {
            failures.push(asset_payload_failure(
                path,
                "changed-since-index",
                "Asset size or modification time changed before digest capture.",
            ));
            continue;
        }
        let Some(encoded_size) = encoded_size_bytes(before.len()) else {
            failures.push(asset_payload_failure(
                path,
                "file-too-large",
                "Asset size cannot be represented safely.",
            ));
            continue;
        };
        if encoded_size > u64::from(max_total_encoded_bytes) {
            failures.push(asset_payload_failure(
                path,
                "file-too-large",
                "Asset exceeds the digest encoded-size limit.",
            ));
            continue;
        }
        if total_encoded_bytes.saturating_add(encoded_size) > u64::from(max_total_encoded_bytes) {
            failures.push(asset_payload_failure(
                path,
                "total-limit-exceeded",
                "Asset would exceed the digest encoded-size limit.",
            ));
            continue;
        }

        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        let mut read_bytes = 0_u64;
        let read_result = (|| -> io::Result<()> {
            loop {
                let count = file.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                read_bytes = read_bytes.saturating_add(count as u64);
                if read_bytes > before.len() {
                    return Err(io::Error::other("asset grew beyond the digest byte limit"));
                }
                hasher.update(&buffer[..count]);
            }
            Ok(())
        })();
        if let Err(error) = read_result {
            failures.push(asset_payload_failure(
                path,
                "unreadable",
                format!("Asset could not be hashed: {error}"),
            ));
            continue;
        }
        let after = match file.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                failures.push(asset_payload_failure(
                    path,
                    "changed",
                    format!("Asset metadata changed during digest capture: {error}"),
                ));
                continue;
            }
        };
        if read_bytes != before.len() || file_metadata_changed(&before, &after) {
            failures.push(asset_payload_failure(
                path,
                "changed",
                "Asset changed during digest capture.",
            ));
            continue;
        }
        total_source_bytes += read_bytes;
        total_encoded_bytes += encoded_size;
        digests.push(NativeProjectAssetDigest {
            content_digest: format!("{:x}", hasher.finalize()),
            path,
        });
    }

    Ok(NativeProjectAssetDigestBatch {
        digests,
        failures,
        total_source_bytes: total_source_bytes as u32,
    })
}

fn open_project_assets_dir(root: &Path) -> Result<Option<Dir>, String> {
    open_project_assets_dir_after_canonicalize(root, |_| {})
}

fn open_project_assets_dir_after_canonicalize<F>(
    root: &Path,
    after_canonicalize: F,
) -> Result<Option<Dir>, String>
where
    F: FnOnce(&Path),
{
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Project root could not be resolved: {error}"))?;
    after_canonicalize(&canonical_root);
    let project_dir = open_canonical_directory_nofollow(&canonical_root)
        .map_err(|error| format!("Project root must be a directory: {error}"))?;
    validate_native_project_manifest(&project_dir)?;

    match project_dir.open_dir_nofollow("assets") {
        Ok(dir) => Ok(Some(dir)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "Project assets root must be a regular directory and may not be a link: {error}"
        )),
    }
}

fn open_canonical_directory_nofollow(canonical_path: &Path) -> io::Result<Dir> {
    if !canonical_path.is_absolute() {
        return Err(io::Error::new(
            ErrorKind::InvalidInput,
            "canonical directory path must be absolute",
        ));
    }
    let anchor = canonical_path
        .ancestors()
        .last()
        .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, "directory path has no anchor"))?;
    let mut directory = Dir::open_ambient_dir(anchor, ambient_authority())?;
    let relative = canonical_path
        .strip_prefix(anchor)
        .map_err(|_| io::Error::new(ErrorKind::InvalidInput, "invalid directory anchor"))?;

    for component in relative.components() {
        let std::path::Component::Normal(name) = component else {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "canonical directory contains an invalid component",
            ));
        };
        directory = directory.open_dir_nofollow(name)?;
    }

    Ok(directory)
}

fn validate_native_project_manifest(project_dir: &Dir) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let manifest = project_dir
        .open_with("twine.toml", &options)
        .map_err(|error| format!("Project root must contain a regular twine.toml: {error}"))?;
    let metadata = manifest
        .metadata()
        .map_err(|error| format!("Project manifest metadata could not be read: {error}"))?;
    if !metadata.is_file() {
        return Err("Project root must contain a regular twine.toml.".into());
    }
    Ok(())
}

fn open_project_asset_file(assets_dir: &Dir, relative_path: &Path) -> io::Result<File> {
    let components = relative_path.components().collect::<Vec<_>>();
    let mut parent = assets_dir.try_clone()?;

    for component in &components[..components.len().saturating_sub(1)] {
        let std::path::Component::Normal(name) = component else {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "invalid asset path",
            ));
        };
        parent = parent.open_dir_nofollow(name)?;
    }

    let Some(std::path::Component::Normal(file_name)) = components.last() else {
        return Err(io::Error::new(
            ErrorKind::InvalidInput,
            "invalid asset path",
        ));
    };
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    parent
        .open_with(file_name, &options)
        .map(|file| file.into_std())
}

fn canonical_asset_request_path(path: &str) -> Option<PathBuf> {
    if path.contains('\\') || path.contains('\0') {
        return None;
    }
    let relative_path = path.strip_prefix("assets/")?;
    if relative_path.is_empty()
        || relative_path
            .split('/')
            .any(|component| component.is_empty() || matches!(component, "." | ".."))
    {
        return None;
    }
    let mut relative = PathBuf::new();

    for component in Path::new(relative_path).components() {
        match component {
            std::path::Component::Normal(value) => relative.push(value),
            _ => return None,
        }
    }

    (!relative.as_os_str().is_empty() && relative.file_name().is_some()).then_some(relative)
}

fn supported_asset_media_type(path: &str) -> Option<&'static str> {
    let extension = Path::new(path)
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase();

    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "webp" => Some("image/webp"),
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/mp4"),
        "ogg" => Some("audio/ogg"),
        "wav" => Some("audio/wav"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        _ => None,
    }
}

fn encoded_size_bytes(source_size: u64) -> Option<u64> {
    source_size.checked_add(2)?.checked_div(3)?.checked_mul(4)
}

fn raw_bytes_for_encoded_limit(encoded_limit: u64) -> u64 {
    encoded_limit / 4 * 3
}

fn file_metadata_changed(before: &fs::Metadata, after: &fs::Metadata) -> bool {
    before.len() != after.len()
        || matches!(
            (before.modified(), after.modified()),
            (Ok(before), Ok(after)) if before != after
        )
        || file_identity_changed(before, after)
}

#[cfg(unix)]
fn file_identity_changed(before: &fs::Metadata, after: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;

    before.dev() != after.dev() || before.ino() != after.ino()
}

#[cfg(not(unix))]
fn file_identity_changed(_before: &fs::Metadata, _after: &fs::Metadata) -> bool {
    false
}

fn asset_payload_failure(
    path: String,
    reason: impl Into<String>,
    message: impl Into<String>,
) -> NativeProjectAssetPayloadFailure {
    NativeProjectAssetPayloadFailure {
        message: message.into(),
        path,
        reason: reason.into(),
    }
}

#[napi(js_name = "projectFileManifestJson")]
pub fn project_file_manifest_json(
    root_path: String,
    assets_json: Option<String>,
) -> napi::Result<String> {
    let assets = assets_json
        .as_deref()
        .map(serde_json::from_str::<Vec<CoreAssetInventoryEntry>>)
        .transpose()
        .map_err(native_error)?;
    let files =
        project_file_manifest(Path::new(&root_path), assets.as_deref()).map_err(native_error)?;

    json_string(&files).map_err(native_error)
}

#[napi(js_name = "prepareProjectImportJson")]
pub fn prepare_project_import_json(source_path: String) -> napi::Result<String> {
    let source_path = PathBuf::from(source_path);
    let extension = path_extension(&source_path);

    let source = if extension == "zip" {
        prepare_zip_import(&source_path).map_err(native_error)?
    } else if extension == "html" || extension == "htm" {
        prepare_html_import(&source_path, &source_path, "html", None).map_err(native_error)?
    } else {
        return Err(native_error(
            "Project import must be a Twine HTML file or a zip archive.",
        ));
    };

    json_string(&source).map_err(native_error)
}

#[napi(js_name = "diffProjectFileManifestJson")]
pub fn diff_project_file_manifest_json(
    previous_files_json: String,
    current_files_json: String,
) -> napi::Result<String> {
    let previous = serde_json::from_str::<Vec<NativeProjectFileEntry>>(&previous_files_json)
        .map_err(native_error)?;
    let current = serde_json::from_str::<Vec<NativeProjectFileEntry>>(&current_files_json)
        .map_err(native_error)?;
    let conflicts = project_session_conflicts(&previous, &current);

    json_string(&conflicts).map_err(native_error)
}

#[napi(js_name = "findTwineHtmlFilesJson")]
pub fn find_twine_html_files_json(root_path: String) -> napi::Result<String> {
    let files = find_twine_html_files(Path::new(&root_path)).map_err(native_error)?;

    json_string(&files).map_err(native_error)
}

#[napi(js_name = "prepareHtmlImportJson")]
pub fn prepare_html_import_json(
    source_path: String,
    html_file_path: String,
    source_kind: String,
) -> napi::Result<String> {
    let source = prepare_html_import(
        Path::new(&source_path),
        Path::new(&html_file_path),
        &source_kind,
        None,
    )
    .map_err(native_error)?;

    json_string(&source).map_err(native_error)
}

impl NativeStory {
    fn from_story(story: &Story) -> Self {
        Self {
            ifid: story.ifid.clone(),
            id: story.id.as_ref().to_owned(),
            last_update: nonempty_or_now(&story.last_update),
            name: story.name.clone(),
            passages: story
                .passages
                .iter()
                .map(NativePassage::from_passage)
                .collect(),
            script: story.script.clone(),
            selected: false,
            snap_to_grid: story.snap_to_grid,
            start_passage: story.start_passage.as_ref().to_owned(),
            story_format: story.story_format.clone(),
            story_format_version: story.story_format_version.clone(),
            stylesheet: story.stylesheet.clone(),
            tag_colors: story.tag_colors.clone(),
            tags: story.tags.clone(),
            zoom: story.zoom,
        }
    }

    fn from_story_and_metadata(story: &Story, metadata: &serde_json::Value) -> Self {
        let mut native = Self::from_story(story);

        native.selected = metadata
            .get("selected")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(native.selected);
        let passage_metadata = metadata
            .get("passages")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|passage| Some((passage.get("id")?.as_str()?, passage)))
            .collect::<BTreeMap<_, _>>();

        for passage in &mut native.passages {
            let Some(metadata) = passage_metadata.get(passage.id.as_str()) else {
                continue;
            };
            let use_metadata_layout = passage.left == 0.0
                && passage.top == 0.0
                && passage.width == 100.0
                && passage.height == 100.0;

            passage.highlighted = metadata
                .get("highlighted")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(passage.highlighted);
            passage.selected = metadata
                .get("selected")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(passage.selected);
            if use_metadata_layout {
                passage.height = metadata
                    .get("height")
                    .and_then(serde_json::Value::as_f64)
                    .unwrap_or(passage.height);
                passage.left = metadata
                    .get("left")
                    .and_then(serde_json::Value::as_f64)
                    .unwrap_or(passage.left);
                passage.top = metadata
                    .get("top")
                    .and_then(serde_json::Value::as_f64)
                    .unwrap_or(passage.top);
                passage.width = metadata
                    .get("width")
                    .and_then(serde_json::Value::as_f64)
                    .unwrap_or(passage.width);
            }
        }

        native
    }
}

impl NativePassage {
    fn from_passage(passage: &Passage) -> Self {
        let GraphPosition {
            height,
            left,
            top,
            width,
        } = passage.layout.unwrap_or_default();

        Self {
            height,
            highlighted: false,
            id: passage.id.as_ref().to_owned(),
            left,
            name: passage.name.clone(),
            selected: false,
            story: passage.story.as_ref().to_owned(),
            tags: passage.tags.clone(),
            text: passage.text.clone(),
            top,
            width,
        }
    }
}

type NativeBoxError = Box<dyn std::error::Error + Send + Sync + 'static>;

fn prepare_zip_import(source_path: &Path) -> Result<NativeProjectImportSource, NativeBoxError> {
    let cleanup_path = std::env::temp_dir().join(format!("twine-import-{}", timestamp_nanos()));

    prepare_zip_import_at(source_path, cleanup_path, ZIP_IMPORT_LIMITS)
}

fn prepare_zip_import_at(
    source_path: &Path,
    cleanup_path: PathBuf,
    limits: ZipImportLimits,
) -> Result<NativeProjectImportSource, NativeBoxError> {
    fs::create_dir(&cleanup_path)?;

    let result = (|| {
        extract_zip_archive_with_limits(source_path, &cleanup_path, limits)?;

        let html_files = find_twine_html_files(&cleanup_path)?;

        if html_files.is_empty() {
            return Err("No Twine HTML story was found in the zip archive.".into());
        }

        let html_file_path = best_twine_html_file(&cleanup_path, source_path, &html_files)
            .ok_or("No Twine HTML story was found in the zip archive.")?;

        prepare_html_import(
            source_path,
            Path::new(&html_file_path),
            "zip",
            Some(cleanup_path.clone()),
        )
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&cleanup_path);
    }

    result
}

fn prepare_html_import(
    source_path: &Path,
    html_file_path: &Path,
    source_kind: &str,
    cleanup_path: Option<PathBuf>,
) -> Result<NativeProjectImportSource, NativeBoxError> {
    let html_source = read_bounded_utf8_file(
        html_file_path,
        MAX_IMPORT_SOURCE_BYTES,
        "Import HTML source",
    )?;
    let source_root = html_file_path.parent().unwrap_or_else(|| Path::new("."));
    let assets = discover_project_import_assets(source_root, html_file_path, &html_source)?;
    let html_source = rewrite_project_import_asset_references(&html_source, &assets)?;

    Ok(NativeProjectImportSource {
        assets,
        cleanup_path: cleanup_path.map(|path| path.to_string_lossy().into_owned()),
        html_file_path: html_file_path.to_string_lossy().into_owned(),
        html_source,
        source_kind: source_kind.into(),
        source_path: source_path.to_string_lossy().into_owned(),
    })
}

fn extract_zip_archive_with_limits(
    source_path: &Path,
    target_root: &Path,
    limits: ZipImportLimits,
) -> Result<(), NativeBoxError> {
    let file = File::open(source_path)?;
    let metadata = file.metadata()?;

    if !metadata.is_file() {
        return Err("Project import source must be a regular file.".into());
    }
    if metadata.len() > limits.max_archive_bytes {
        return Err(format!(
            "Zip import exceeds the {} MiB compressed-size limit.",
            limits.max_archive_bytes / (1024 * 1024)
        )
        .into());
    }

    let mut archive = zip::ZipArchive::new(file)?;

    if archive.len() > limits.max_entries {
        return Err(format!(
            "Zip import contains more than {} entries.",
            limits.max_entries
        )
        .into());
    }

    let mut declared_compressed_bytes = 0_u64;
    let mut declared_expanded_bytes = 0_u64;
    let mut written_expanded_bytes = 0_u64;

    for index in 0..archive.len() {
        let mut zipped_file = archive.by_index(index)?;
        let enclosed_name = zipped_file
            .enclosed_name()
            .ok_or("Zip import contains an unsafe entry path.")?;
        let nesting_depth = zipped_file
            .name()
            .split(['/', '\\'])
            .filter(|component| !component.is_empty())
            .count();

        if nesting_depth > limits.max_nesting_depth {
            return Err(format!(
                "Zip import entry nesting exceeds {} levels.",
                limits.max_nesting_depth
            )
            .into());
        }

        let compressed_bytes = zipped_file.compressed_size();
        let expanded_bytes = zipped_file.size();

        if expanded_bytes > limits.max_entry_bytes {
            return Err(format!(
                "Zip import entry exceeds the {} MiB expanded-size limit.",
                limits.max_entry_bytes / (1024 * 1024)
            )
            .into());
        }
        declared_compressed_bytes = declared_compressed_bytes
            .checked_add(compressed_bytes)
            .ok_or("Zip import compressed-size total overflowed.")?;
        declared_expanded_bytes = declared_expanded_bytes
            .checked_add(expanded_bytes)
            .ok_or("Zip import expanded-size total overflowed.")?;
        if declared_expanded_bytes > limits.max_expanded_bytes {
            return Err(format!(
                "Zip import exceeds the {} MiB cumulative expanded-size limit.",
                limits.max_expanded_bytes / (1024 * 1024)
            )
            .into());
        }
        if expanded_bytes
            > compressed_bytes
                .max(1)
                .saturating_mul(limits.max_compression_ratio)
            || declared_expanded_bytes
                > declared_compressed_bytes
                    .max(1)
                    .saturating_mul(limits.max_compression_ratio)
        {
            return Err(format!(
                "Zip import exceeds the {}:1 compression-ratio limit.",
                limits.max_compression_ratio
            )
            .into());
        }

        let target_path = target_root.join(enclosed_name);

        if zipped_file.is_dir() {
            fs::create_dir_all(&target_path)?;
            continue;
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut output = File::create(&target_path)?;
        let remaining_expanded_bytes = limits
            .max_expanded_bytes
            .saturating_sub(written_expanded_bytes);
        let stream_limit = limits
            .max_entry_bytes
            .min(remaining_expanded_bytes)
            .saturating_add(1);
        let written = io::copy(&mut zipped_file.by_ref().take(stream_limit), &mut output)?;

        if written != expanded_bytes {
            return Err("Zip import entry did not match its declared expanded size.".into());
        }
        written_expanded_bytes = written_expanded_bytes
            .checked_add(written)
            .ok_or("Zip import expanded-size total overflowed.")?;
    }

    Ok(())
}

fn read_bounded_utf8_file(
    path: &Path,
    max_bytes: u64,
    label: &str,
) -> Result<String, NativeBoxError> {
    let mut file = File::open(path)?;
    let metadata = file.metadata()?;

    if !metadata.is_file() {
        return Err(format!("{label} must be a regular file.").into());
    }
    if metadata.len() > max_bytes {
        return Err(format!(
            "{label} exceeds the {} MiB limit.",
            max_bytes / (1024 * 1024)
        )
        .into());
    }

    let mut source = Vec::with_capacity(metadata.len().min(max_bytes) as usize);

    file.by_ref()
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut source)?;
    if source.len() as u64 > max_bytes {
        return Err(format!(
            "{label} exceeds the {} MiB limit.",
            max_bytes / (1024 * 1024)
        )
        .into());
    }

    String::from_utf8(source).map_err(Into::into)
}

fn best_twine_html_file(
    root_path: &Path,
    source_path: &Path,
    html_files: &[String],
) -> Option<String> {
    let source_base_name = source_path
        .file_stem()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default()
        .trim_end_matches(".zip")
        .to_owned();
    let mut candidates = html_files.to_vec();

    candidates.sort_by(|left, right| {
        let left_path = Path::new(left);
        let right_path = Path::new(right);
        let left_base = left_path
            .file_stem()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let right_base = right_path
            .file_stem()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let left_relative = slash_path(left_path.strip_prefix(root_path).unwrap_or(left_path));
        let right_relative = slash_path(right_path.strip_prefix(root_path).unwrap_or(right_path));
        let left_score = [
            if left_base == source_base_name { 0 } else { 1 },
            if left_base.contains(&source_base_name) {
                0
            } else {
                1
            },
            left_relative.split('/').count(),
            left_relative.len(),
        ];
        let right_score = [
            if right_base == source_base_name { 0 } else { 1 },
            if right_base.contains(&source_base_name) {
                0
            } else {
                1
            },
            right_relative.split('/').count(),
            right_relative.len(),
        ];

        left_score
            .cmp(&right_score)
            .then_with(|| left_relative.cmp(&right_relative))
    });

    candidates.into_iter().next()
}

fn read_renderer_project_sidecar_stories(
    root: &Path,
) -> Result<Vec<serde_json::Value>, NativeBoxError> {
    let path = root.join(".twine/project.json");
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut source = Vec::new();

    file.take((MAX_RENDERER_PROJECT_SIDECAR_BYTES + 1) as u64)
        .read_to_end(&mut source)?;
    if source.len() > MAX_RENDERER_PROJECT_SIDECAR_BYTES {
        return Err(format!(
            "Renderer project sidecar exceeds the {} byte limit: {}",
            MAX_RENDERER_PROJECT_SIDECAR_BYTES,
            path.display()
        )
        .into());
    }

    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&source) else {
        return Ok(Vec::new());
    };

    Ok(payload
        .get("stories")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default())
}

fn merge_renderer_project_metadata(
    project: &Project,
    target_story_id: &str,
    incoming: serde_json::Value,
    existing: Vec<serde_json::Value>,
) -> Vec<serde_json::Value> {
    let existing_by_id = existing
        .into_iter()
        .filter_map(|story| {
            let id = story.get("id")?.as_str()?.to_owned();

            Some((id, renderer_project_metadata(story)))
        })
        .collect::<BTreeMap<_, _>>();

    project
        .stories
        .iter()
        .map(|story| {
            if story.id.as_ref() == target_story_id {
                return incoming.clone();
            }

            existing_by_id
                .get(story.id.as_ref())
                .cloned()
                .unwrap_or_else(|| {
                    renderer_project_metadata(
                        serde_json::to_value(NativeStory::from_story(story))
                            .expect("native story metadata should serialize"),
                    )
                })
        })
        .collect()
}

fn renderer_project_sidecar_bytes(
    stories: &[serde_json::Value],
) -> Result<Vec<u8>, NativeBoxError> {
    let payload = serde_json::json!({
        "schema": "twine.rs/renderer-project",
        "version": 1,
        "stories": stories
    });
    let mut source = serde_json::to_vec(&payload)?;

    source.push(b'\n');
    if source.len() > MAX_RENDERER_PROJECT_SIDECAR_BYTES {
        return Err(format!(
            "Renderer project sidecar output exceeds the {MAX_RENDERER_PROJECT_SIDECAR_BYTES} byte limit."
        )
        .into());
    }

    Ok(source)
}

fn default_project_library_index() -> NativeProjectLibraryIndex {
    NativeProjectLibraryIndex {
        version: 1,
        projects: Vec::new(),
    }
}

fn read_project_library_index(path: &Path) -> Result<NativeProjectLibraryIndex, NativeBoxError> {
    match fs::read_to_string(path) {
        Ok(source) => {
            let mut index =
                serde_json::from_str::<NativeProjectLibraryIndex>(&source).map_err(native_error)?;

            index
                .projects
                .sort_by(|left, right| left.root_path.cmp(&right.root_path));
            Ok(index)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(default_project_library_index()),
        Err(error) => Err(error.into()),
    }
}

fn write_project_library_index(
    path: &Path,
    index: &NativeProjectLibraryIndex,
) -> Result<(), NativeBoxError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| "native-projects.json".into());
    let temp_path = path.with_file_name(format!("{file_name}.{}.tmp", timestamp_nanos()));

    fs::write(&temp_path, format!("{}\n", json_string(index)?))?;

    if path.exists() {
        fs::remove_file(path)?;
    }

    fs::rename(temp_path, path)?;
    Ok(())
}

fn renderer_project_metadata(mut story: serde_json::Value) -> serde_json::Value {
    if let Some(passages) = story
        .get_mut("passages")
        .and_then(serde_json::Value::as_array_mut)
    {
        for passage in passages {
            if let Some(passage) = passage.as_object_mut() {
                passage.remove("text");
            }
        }
    }

    story
}

fn merge_renderer_story_metadata(
    existing: &serde_json::Value,
    incoming: &serde_json::Value,
) -> serde_json::Value {
    let mut merged = existing.clone();

    if let (Some(merged), Some(incoming)) = (merged.as_object_mut(), incoming.as_object()) {
        merged.extend(incoming.clone());
    } else {
        merged = incoming.clone();
    }

    renderer_project_metadata(merged)
}

fn list_project_assets(root: &Path) -> Result<Vec<CoreAssetInventoryEntry>, std::io::Error> {
    let assets_root = root.join("assets");

    if !assets_root.exists() {
        return Ok(Vec::new());
    }

    let files = collect_files(&assets_root)?;
    let mut assets = files
        .par_iter()
        .filter_map(|path| {
            let stats = path.metadata().ok()?;

            if !stats.is_file() {
                return None;
            }

            let relative = slash_path(path.strip_prefix(&assets_root).ok()?);
            let asset_path = format!("assets/{relative}");

            Some(project_asset_inventory_entry(&asset_path, path, &stats))
        })
        .collect::<Vec<_>>();

    assets.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(assets)
}

fn project_asset_inventory_entry(
    project_path: &str,
    absolute_path: &Path,
    stats: &fs::Metadata,
) -> CoreAssetInventoryEntry {
    let kind = asset_kind_for_path(project_path).to_owned();
    let preview_url = file_url_for_path(&absolute_path.to_string_lossy());
    let thumbnail_url = if kind == "image" {
        preview_url.clone()
    } else {
        None
    };

    CoreAssetInventoryEntry {
        duration_ms: None,
        exists: Some(true),
        height: None,
        kind: kind.clone(),
        missing: false,
        modified_at: Some(system_time_to_iso(stats.modified().unwrap_or(UNIX_EPOCH))),
        normalized_path: normalized_asset_path(project_path),
        path: project_path.to_owned(),
        preview_url,
        publish: CoreAssetPublishRule {
            copy: true,
            output_path: project_path.to_owned(),
            reason: "Copy asset into published output".into(),
        },
        reference_count: 0,
        references: Vec::new(),
        size_bytes: Some(stats.len()),
        snippet: asset_snippet(project_path, &kind),
        thumbnail_url,
        unused: true,
        width: None,
    }
}

fn project_file_manifest(
    root: &Path,
    assets: Option<&[CoreAssetInventoryEntry]>,
) -> Result<Vec<NativeProjectFileEntry>, std::io::Error> {
    let mut files = Vec::new();

    scan_project_files(root, "twine.toml", "manifest", &mut files)?;
    scan_project_files(root, ".twine/project.json", "metadata", &mut files)?;
    scan_project_files(root, ".twine/graph.json", "graph", &mut files)?;
    scan_project_files(root, "passages", "passage", &mut files)?;
    scan_project_files(root, "scripts", "script", &mut files)?;
    scan_project_files(root, "styles", "stylesheet", &mut files)?;
    for source in declared_single_twee_sources(root)? {
        scan_project_files(root, &source, "passage", &mut files)?;
    }

    if let Some(assets) = assets {
        files.extend(assets.iter().filter_map(asset_project_file_entry));
    } else {
        scan_project_files(root, "assets", "asset", &mut files)?;
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    files.dedup_by(|left, right| left.path == right.path);
    Ok(files)
}

#[derive(Deserialize)]
struct NativeProjectSourceManifest {
    #[serde(default)]
    stories: Vec<NativeStorySourceManifest>,
}

#[derive(Deserialize)]
struct NativeStorySourceManifest {
    #[serde(default)]
    source: String,
    #[serde(default)]
    source_layout: ProjectSourceLayout,
}

fn declared_single_twee_sources(root: &Path) -> Result<Vec<String>, std::io::Error> {
    let source = match fs::read_to_string(root.join("twine.toml")) {
        Ok(source) => source,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let manifest = toml::from_str::<NativeProjectSourceManifest>(&source)
        .map_err(|error| io::Error::new(ErrorKind::InvalidData, error))?;
    let mut sources = Vec::new();

    for story in manifest.stories {
        if story.source_layout != ProjectSourceLayout::SingleTwee || story.source.is_empty() {
            continue;
        }
        let path = Path::new(&story.source);
        let safe = !path.is_absolute()
            && path.components().all(|component| {
                matches!(
                    component,
                    std::path::Component::Normal(_) | std::path::Component::CurDir
                )
            });

        if !safe {
            return Err(io::Error::new(
                ErrorKind::InvalidData,
                format!("Unsafe aggregate Twee source path: {}", story.source),
            ));
        }
        sources.push(story.source);
    }

    Ok(sources)
}

fn scan_project_files(
    root: &Path,
    project_path: &str,
    kind: &str,
    files: &mut Vec<NativeProjectFileEntry>,
) -> Result<(), std::io::Error> {
    let absolute = root.join(project_path);
    let Ok(stats) = absolute.metadata() else {
        return Ok(());
    };

    if stats.is_dir() {
        let nested = collect_files(&absolute)?;
        let mut entries = nested
            .par_iter()
            .filter_map(|path| {
                let stats = path.metadata().ok()?;

                if !stats.is_file() {
                    return None;
                }

                let project_path = slash_path(path.strip_prefix(root).ok()?);

                Some(native_project_file_entry(project_path, kind, path, &stats))
            })
            .collect::<Result<Vec<_>, _>>()?;

        files.append(&mut entries);
        return Ok(());
    }

    if stats.is_file() {
        files.push(native_project_file_entry(
            project_path.replace('\\', "/"),
            kind,
            &absolute,
            &stats,
        )?);
    }

    Ok(())
}

fn native_project_file_entry(
    project_path: String,
    kind: &str,
    absolute_path: &Path,
    stats: &fs::Metadata,
) -> Result<NativeProjectFileEntry, io::Error> {
    let (entry_stats, content_digest) = if kind == "asset" {
        (stats.clone(), None)
    } else {
        let (stats, digest) = project_source_content_digest(absolute_path)?;

        (stats, Some(digest))
    };
    let mtime = entry_stats.modified().unwrap_or(UNIX_EPOCH);
    let mtime_ms = system_time_to_ms(mtime);

    Ok(NativeProjectFileEntry {
        content_digest,
        fingerprint: format!("{}:{}", system_time_to_millis(mtime), entry_stats.len()),
        kind: kind.to_owned(),
        modified_at: system_time_to_iso(mtime),
        mtime_ms,
        path: project_path,
        size_bytes: entry_stats.len(),
    })
}

fn project_source_content_digest(path: &Path) -> Result<(fs::Metadata, String), io::Error> {
    let mut file = File::open(path)?;
    let before = file.metadata()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut read_bytes = 0_u64;

    loop {
        let count = file.read(&mut buffer)?;

        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        read_bytes += count as u64;
    }

    let after = file.metadata()?;

    if read_bytes != before.len() || file_metadata_changed(&before, &after) {
        return Err(io::Error::other(format!(
            "{} changed while its content digest was captured",
            path.display()
        )));
    }

    Ok((before, format!("{:x}", hasher.finalize())))
}

fn native_project_file_entry_from_loaded(file: LoadedProjectFile) -> NativeProjectFileEntry {
    let mtime_ms = system_time_to_ms(file.modified_at);

    NativeProjectFileEntry {
        content_digest: Some(file.content_digest),
        fingerprint: format!(
            "{}:{}",
            system_time_to_millis(file.modified_at),
            file.size_bytes
        ),
        kind: file.kind.to_owned(),
        modified_at: system_time_to_iso(file.modified_at),
        mtime_ms,
        path: slash_path(&file.path),
        size_bytes: file.size_bytes,
    }
}

fn asset_project_file_entry(asset: &CoreAssetInventoryEntry) -> Option<NativeProjectFileEntry> {
    let size = asset.size_bytes?;
    let modified_at = asset.modified_at.as_ref()?;
    let mtime_ms = parse_iso_to_ms(modified_at).unwrap_or(0.0);
    let mtime_millis = parse_iso_to_millis(modified_at).unwrap_or_default();

    Some(NativeProjectFileEntry {
        content_digest: None,
        fingerprint: format!("{mtime_millis}:{size}"),
        kind: "asset".into(),
        modified_at: modified_at.clone(),
        mtime_ms,
        path: asset.path.clone(),
        size_bytes: size,
    })
}

fn project_session_conflicts(
    previous_files: &[NativeProjectFileEntry],
    current_files: &[NativeProjectFileEntry],
) -> Vec<NativeProjectSessionConflict> {
    let previous = previous_files
        .iter()
        .map(|file| (&file.path, file))
        .collect::<BTreeMap<_, _>>();
    let current = current_files
        .iter()
        .map(|file| (&file.path, file))
        .collect::<BTreeMap<_, _>>();
    let mut conflicts = Vec::new();

    for (path, current_file) in &current {
        match previous.get(path) {
            None => conflicts.push(NativeProjectSessionConflict {
                change: "added".into(),
                current: Some((*current_file).clone()),
                id: format!("added:{path}"),
                kind: current_file.kind.clone(),
                message: format!("{path} was added outside twine.rs."),
                path: (*path).clone(),
                previous: None,
            }),
            Some(previous_file) if !project_file_entries_match(previous_file, current_file) => {
                conflicts.push(NativeProjectSessionConflict {
                    change: "modified".into(),
                    current: Some((*current_file).clone()),
                    id: format!("modified:{path}"),
                    kind: current_file.kind.clone(),
                    message: format!("{path} changed outside twine.rs."),
                    path: (*path).clone(),
                    previous: Some((*previous_file).clone()),
                });
            }
            _ => {}
        }
    }

    for (path, previous_file) in &previous {
        if !current.contains_key(path) {
            conflicts.push(NativeProjectSessionConflict {
                change: "removed".into(),
                current: None,
                id: format!("removed:{path}"),
                kind: previous_file.kind.clone(),
                message: format!("{path} was removed outside twine.rs."),
                path: (*path).clone(),
                previous: Some((*previous_file).clone()),
            });
        }
    }

    conflicts.sort_by(|left, right| left.path.cmp(&right.path));
    conflicts
}

fn validate_project_file_baseline(
    root: &Path,
    expected_files: &[NativeProjectFileEntry],
) -> Result<(), StoreError> {
    let current_files = project_file_manifest(root, None)?;

    if let Some(conflict) = project_session_conflicts(expected_files, &current_files).first() {
        return Err(StoreError::ProjectConflict(format!(
            "{} Verification diagnostics: {}.",
            conflict.message,
            project_file_conflict_diagnostics(conflict)
        )));
    }

    Ok(())
}

fn project_file_entry_diagnostics(file: &NativeProjectFileEntry) -> serde_json::Value {
    serde_json::json!({
        "contentDigestPresent": file.content_digest.is_some(),
        "fingerprint": file.fingerprint,
        "mtimeMs": file.mtime_ms,
        "sizeBytes": file.size_bytes,
    })
}

fn project_file_conflict_diagnostics(conflict: &NativeProjectSessionConflict) -> String {
    let content_digest_matches = match (&conflict.previous, &conflict.current) {
        (Some(previous), Some(current)) => {
            match (&previous.content_digest, &current.content_digest) {
                (Some(previous), Some(current)) => Some(previous == current),
                _ => None,
            }
        }
        _ => None,
    };

    serde_json::json!({
        "contentDigestMatches": content_digest_matches,
        "expected": conflict.previous.as_ref().map(project_file_entry_diagnostics),
        "observed": conflict.current.as_ref().map(project_file_entry_diagnostics),
        "stage": "native-baseline-compare",
    })
    .to_string()
}

fn project_file_entries_match(
    previous: &NativeProjectFileEntry,
    current: &NativeProjectFileEntry,
) -> bool {
    match (&previous.content_digest, &current.content_digest) {
        (Some(previous_digest), Some(current_digest)) => {
            previous.size_bytes == current.size_bytes && previous_digest == current_digest
        }
        (None, None) => previous.fingerprint == current.fingerprint,
        _ => false,
    }
}

fn discover_project_import_assets(
    source_root: &Path,
    html_file_path: &Path,
    html_source: &str,
) -> Result<Vec<NativeProjectImportAsset>, std::io::Error> {
    let mut assets = BTreeMap::new();
    let mut budget = ImportAssetBudget::default();
    let html_base_name = html_file_path
        .file_stem()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();

    let Ok(names) = fs::read_dir(source_root) else {
        return Ok(Vec::new());
    };

    for entry in names {
        let entry = entry?;
        budget.scanned_entries += 1;
        if budget.scanned_entries > MAX_IMPORT_ASSET_SCAN_ENTRIES {
            return Err(io::Error::other(format!(
                "Project import asset scan exceeds {MAX_IMPORT_ASSET_SCAN_ENTRIES} entries."
            )));
        }
        let path = entry.path();

        if entry.file_type()?.is_dir()
            && is_obvious_import_asset_directory(
                &entry.file_name().to_string_lossy(),
                &html_base_name,
            )
        {
            if !is_path_inside(source_root, &path) {
                return Err(io::Error::other(
                    "Project import asset escaped its source directory.",
                ));
            }
            scan_import_asset_directory(&mut assets, source_root, &path, 1, &mut budget)?;
        }
    }

    add_referenced_import_assets(&mut assets, source_root, html_source, &mut budget)?;

    Ok(assets.into_values().collect())
}

fn scan_import_asset_directory(
    assets: &mut BTreeMap<String, NativeProjectImportAsset>,
    source_root: &Path,
    directory: &Path,
    depth: usize,
    budget: &mut ImportAssetBudget,
) -> Result<(), std::io::Error> {
    if depth > MAX_IMPORT_ASSET_SCAN_DEPTH {
        return Err(io::Error::other(format!(
            "Project import asset nesting exceeds {MAX_IMPORT_ASSET_SCAN_DEPTH} levels."
        )));
    }

    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        budget.scanned_entries += 1;
        if budget.scanned_entries > MAX_IMPORT_ASSET_SCAN_ENTRIES {
            return Err(io::Error::other(format!(
                "Project import asset scan exceeds {MAX_IMPORT_ASSET_SCAN_ENTRIES} entries."
            )));
        }
        let path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            if !is_path_inside(source_root, &path) {
                return Err(io::Error::other(
                    "Project import asset escaped its source directory.",
                ));
            }
            scan_import_asset_directory(assets, source_root, &path, depth + 1, budget)?;
        } else if file_type.is_file() {
            let metadata = entry.metadata()?;

            add_import_asset(assets, source_root, &path, metadata.len(), budget)?;
        }
    }

    Ok(())
}

fn add_referenced_import_assets(
    assets: &mut BTreeMap<String, NativeProjectImportAsset>,
    source_root: &Path,
    html_source: &str,
    budget: &mut ImportAssetBudget,
) -> Result<(), std::io::Error> {
    let regex = Regex::new(
        r"(?i)([A-Za-z0-9_./~%:@?&=+-]+\.(?:apng|avif|css|gif|jpe?g|js|m4a|mp3|mp4|oga|ogg|otf|png|svg|ttf|wav|webm|webp|woff2?))",
    )
    .expect("import asset regex should compile");

    for capture in regex.captures_iter(html_source) {
        budget.reference_matches += 1;
        if budget.reference_matches > MAX_IMPORT_ASSET_SCAN_ENTRIES {
            return Err(io::Error::other(format!(
                "Project import asset references exceed {MAX_IMPORT_ASSET_SCAN_ENTRIES} entries."
            )));
        }
        let Some(reference) = capture.get(1) else {
            continue;
        };
        let Some(reference_path) = import_asset_reference_path(reference.as_str()) else {
            continue;
        };
        let absolute_path = source_root.join(reference_path);

        if !is_path_inside(source_root, &absolute_path) {
            continue;
        }

        match absolute_path.symlink_metadata() {
            Ok(stats) if stats.file_type().is_symlink() => {}
            Ok(stats) if stats.is_file() && is_path_inside(source_root, &absolute_path) => {
                add_import_asset(assets, source_root, &absolute_path, stats.len(), budget)?;
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }

    Ok(())
}

fn add_import_asset(
    assets: &mut BTreeMap<String, NativeProjectImportAsset>,
    source_root: &Path,
    source_path: &Path,
    size_bytes: u64,
    budget: &mut ImportAssetBudget,
) -> Result<(), std::io::Error> {
    let Ok(relative_source_path) = source_path.strip_prefix(source_root) else {
        return Ok(());
    };
    let relative_source_path = slash_path(relative_source_path);

    if relative_source_path.is_empty()
        || relative_source_path.starts_with("..")
        || !is_import_asset_file(&relative_source_path)
    {
        return Ok(());
    }

    let target_path = import_asset_target_path(&relative_source_path);
    let target_key = target_path.to_lowercase();

    if assets.contains_key(&target_key) {
        return Ok(());
    }
    if assets.len() >= MAX_IMPORT_ASSETS {
        return Err(io::Error::other(format!(
            "Project import contains more than {MAX_IMPORT_ASSETS} assets."
        )));
    }
    if size_bytes > ZIP_IMPORT_LIMITS.max_entry_bytes {
        return Err(io::Error::other(format!(
            "Project import asset exceeds the {} MiB size limit.",
            ZIP_IMPORT_LIMITS.max_entry_bytes / (1024 * 1024)
        )));
    }
    budget.total_bytes = budget.total_bytes.saturating_add(size_bytes);
    if budget.total_bytes > ZIP_IMPORT_LIMITS.max_expanded_bytes {
        return Err(io::Error::other(format!(
            "Project import assets exceed the {} MiB cumulative size limit.",
            ZIP_IMPORT_LIMITS.max_expanded_bytes / (1024 * 1024)
        )));
    }

    assets.insert(
        target_key,
        NativeProjectImportAsset {
            original_path: relative_source_path,
            source_path: source_path.to_string_lossy().into_owned(),
            target_path,
        },
    );

    Ok(())
}

fn rewrite_project_import_asset_references(
    html_source: &str,
    assets: &[NativeProjectImportAsset],
) -> Result<String, regex::Error> {
    let mut roots = BTreeMap::<String, (String, String)>::new();

    for asset in assets {
        let Some(original_root) = asset.original_path.split('/').next() else {
            continue;
        };
        let target_segments = asset.target_path.split('/').collect::<Vec<_>>();

        if original_root.is_empty()
            || original_root.eq_ignore_ascii_case("assets")
            || target_segments.len() < 2
        {
            continue;
        }

        roots.insert(
            original_root.to_lowercase(),
            (
                original_root.to_owned(),
                format!("{}/{}", target_segments[0], target_segments[1]),
            ),
        );
    }

    if roots.is_empty() {
        return Ok(html_source.to_owned());
    }
    let mut root_trie = ImportAssetRewriteTrie::default();

    for (original_root, target_root) in roots.values() {
        let mut node = &mut root_trie;

        if original_root.chars().count() > MAX_IMPORT_ASSET_PATH_COMPONENT_CHARACTERS {
            continue;
        }

        for character in original_root.chars().rev() {
            node = node
                .children
                .entry(character.to_lowercase().next().unwrap_or(character))
                .or_default();
        }
        node.target_root = Some(target_root.clone());
    }
    let mut rewritten = String::with_capacity(html_source.len());
    let mut cursor = 0;
    let mut unchanged_start = 0;

    while let Some(relative_slash) = html_source[cursor..].find('/') {
        let slash = cursor + relative_slash;
        let mut node = &root_trie;
        let mut matched = None;

        for (root_start, character) in html_source[..slash]
            .char_indices()
            .rev()
            .take(MAX_IMPORT_ASSET_PATH_COMPONENT_CHARACTERS)
        {
            let Some(child) = node
                .children
                .get(&character.to_lowercase().next().unwrap_or(character))
            else {
                break;
            };
            node = child;

            if let Some(target_root) = node.target_root.as_ref() {
                let previous = html_source[..root_start].chars().next_back();
                let mut replace_start = root_start;
                let mut has_boundary = previous.is_none_or(|character| {
                    !character.is_ascii_alphanumeric()
                        && !matches!(character, '%' | '-' | '.' | '/' | ':' | '_' | '~')
                });

                if !has_boundary
                    && root_start >= 2
                    && html_source.as_bytes().get(root_start - 2..root_start) == Some(b"./")
                {
                    let relative_previous = html_source[..root_start - 2].chars().next_back();

                    has_boundary = relative_previous.is_none_or(|character| {
                        !character.is_ascii_alphanumeric()
                            && !matches!(character, '%' | '-' | '.' | '/' | ':' | '_' | '~')
                    });
                    if has_boundary {
                        replace_start = root_start - 2;
                    }
                }
                if has_boundary {
                    matched = Some((replace_start, target_root));
                }
            }
        }

        if let Some((root_start, target_root)) = matched {
            rewritten.push_str(&html_source[unchanged_start..root_start]);
            rewritten.push_str(target_root);
            unchanged_start = slash;
        }
        cursor = slash + 1;
    }

    if unchanged_start == 0 {
        return Ok(html_source.to_owned());
    }
    rewritten.push_str(&html_source[unchanged_start..]);

    Ok(rewritten)
}

fn find_twine_html_files(root: &Path) -> Result<Vec<String>, std::io::Error> {
    let mut files = Vec::new();

    find_twine_html_files_inner(root, &mut files)?;
    files.sort();
    Ok(files)
}

fn find_twine_html_files_inner(
    directory: &Path,
    files: &mut Vec<String>,
) -> Result<(), std::io::Error> {
    let Ok(names) = fs::read_dir(directory) else {
        return Ok(());
    };

    for entry in names {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();

        if name.eq_ignore_ascii_case("__macosx") {
            continue;
        }

        let absolute_path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            find_twine_html_files_inner(&absolute_path, files)?;
            continue;
        }

        if !file_type.is_file() || !matches_extension(&name, &["html", "htm"]) {
            continue;
        }

        let metadata = entry.metadata()?;

        if metadata.len() > MAX_IMPORT_SOURCE_BYTES {
            continue;
        }
        let source = read_bounded_utf8_file(
            &absolute_path,
            MAX_IMPORT_SOURCE_BYTES,
            "Import HTML candidate",
        )
        .map_err(io::Error::other)?;

        if source
            .as_bytes()
            .windows(b"<tw-storydata".len())
            .any(|window| window.eq_ignore_ascii_case(b"<tw-storydata"))
        {
            files.push(absolute_path.to_string_lossy().into_owned());
        }
    }

    Ok(())
}

fn collect_files(root: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut files = Vec::new();

    collect_files_inner(root, &mut files)?;
    Ok(files)
}

fn collect_files_inner(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), std::io::Error> {
    let Ok(entries) = fs::read_dir(root) else {
        return Ok(());
    };

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            collect_files_inner(&path, files)?;
        } else if file_type.is_file() {
            files.push(path);
        }
    }

    Ok(())
}

fn asset_kind_for_path(path: &str) -> &'static str {
    let extension = path.rsplit('.').next().unwrap_or_default().to_lowercase();

    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" => "image",
        "mp3" | "m4a" | "ogg" | "wav" => "audio",
        "mp4" | "webm" => "video",
        "css" => "stylesheet",
        "js" => "script",
        _ => "file",
    }
}

fn asset_snippet(path: &str, kind: &str) -> CoreAssetSnippet {
    let text = match kind {
        "image" => format!("<img src=\"{path}\" alt=\"\">"),
        "audio" => format!("<audio src=\"{path}\" controls></audio>"),
        "video" => format!("<video src=\"{path}\" controls></video>"),
        "stylesheet" => format!("<link rel=\"stylesheet\" href=\"{path}\">"),
        "script" => format!("<script src=\"{path}\"></script>"),
        _ => path.to_owned(),
    };

    CoreAssetSnippet {
        label: "Insert asset reference".into(),
        media_type: kind.into(),
        text,
    }
}

fn file_url_for_path(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let is_windows_absolute_path = Regex::new(r"^[A-Za-z]:/")
        .expect("windows path regex should compile")
        .is_match(&normalized);

    if path_looks_like_url(&normalized) && !is_windows_absolute_path {
        return normalized
            .to_lowercase()
            .starts_with("file:")
            .then_some(normalized);
    }

    let absolute_path = if normalized.starts_with('/') || is_windows_absolute_path {
        format!("/{}", normalized.trim_start_matches('/'))
    } else {
        format!("/{normalized}")
    };

    Some(format!(
        "file://{}",
        percent_encode_file_path(&absolute_path)
    ))
}

fn percent_encode_file_path(path: &str) -> String {
    let mut encoded = String::new();

    for character in path.chars() {
        if character.is_ascii_alphanumeric() || "-._~/:".contains(character) {
            encoded.push(character);
        } else {
            let mut bytes = [0; 4];

            for byte in character.encode_utf8(&mut bytes).as_bytes() {
                encoded.push('%');
                encoded.push_str(&format!("{byte:02X}"));
            }
        }
    }

    encoded
}

fn normalized_asset_path(path: &str) -> String {
    path.replace('\\', "/").trim_start_matches("./").into()
}

fn system_time_to_iso(time: SystemTime) -> String {
    OffsetDateTime::from(time)
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

fn system_time_to_ms(time: SystemTime) -> f64 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or_default()
}

fn system_time_to_millis(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn timestamp_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn parse_iso_to_ms(value: &str) -> Option<f64> {
    OffsetDateTime::parse(value, &Rfc3339)
        .ok()
        .and_then(|date| date.unix_timestamp_nanos().to_string().parse::<f64>().ok())
        .map(|nanos| nanos / 1_000_000.0)
}

fn parse_iso_to_millis(value: &str) -> Option<u128> {
    OffsetDateTime::parse(value, &Rfc3339)
        .ok()
        .and_then(|date| u128::try_from(date.unix_timestamp_nanos()).ok())
        .map(|nanos| nanos / 1_000_000)
}

fn now_iso() -> String {
    system_time_to_iso(SystemTime::now())
}

fn nonempty_or_now(value: &str) -> String {
    if value.trim().is_empty() {
        now_iso()
    } else {
        value.to_owned()
    }
}

fn slash_path(path: &Path) -> String {
    path.iter()
        .map(|component| component.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn path_extension(path: &Path) -> String {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn is_import_asset_file(path: &str) -> bool {
    let extension = path.rsplit_once('.').map(|(_, ext)| ext.to_lowercase());

    extension.is_some_and(|extension| IMPORT_ASSET_EXTENSIONS.contains(&extension.as_str()))
}

fn is_obvious_import_asset_directory(name: &str, html_base_name: &str) -> bool {
    let lower = name.to_lowercase();
    let compact = compact_asset_name(&lower);
    let html_compact = compact_asset_name(&html_base_name.to_lowercase());

    if lower.starts_with('.') || lower == "__macosx" {
        return false;
    }

    OBVIOUS_IMPORT_ASSET_DIRECTORIES.contains(&lower.as_str())
        || compact.ends_with("-assets")
        || compact.ends_with("-media")
        || compact == format!("{html_compact}-files")
}

fn compact_asset_name(value: &str) -> String {
    let mut output = String::new();
    let mut last_was_dash = false;

    for character in value.chars() {
        if matches!(character, ' ' | '.' | '_' | '-') {
            if !last_was_dash {
                output.push('-');
                last_was_dash = true;
            }
        } else {
            output.push(character);
            last_was_dash = false;
        }
    }

    output
}

fn import_asset_target_path(relative_source_path: &str) -> String {
    let normalized = relative_source_path
        .replace('\\', "/")
        .trim_start_matches("./")
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/");

    if normalized.to_lowercase().starts_with("assets/") {
        normalized
    } else {
        format!("assets/{normalized}")
    }
}

fn import_asset_reference_path(reference: &str) -> Option<PathBuf> {
    let normalized = reference
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_owned();

    if normalized.starts_with('/')
        || path_looks_like_url(&normalized)
        || normalized.split('/').any(|segment| segment == "..")
    {
        return None;
    }

    Some(PathBuf::from(percent_decode_lossy(&normalized)))
}

fn percent_decode_lossy(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = hex_value(bytes[index + 1]);
            let low = hex_value(bytes[index + 2]);

            if let (Some(high), Some(low)) = (high, low) {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }

        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8(decoded)
        .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned())
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn is_path_inside(root_path: &Path, candidate_path: &Path) -> bool {
    candidate_path
        .canonicalize()
        .ok()
        .and_then(|candidate| {
            root_path
                .canonicalize()
                .ok()
                .map(|root| candidate.starts_with(root))
        })
        .unwrap_or(false)
}

fn path_looks_like_url(path: &str) -> bool {
    path.starts_with("//")
        || path
            .split_once(':')
            .is_some_and(|(scheme, _)| is_url_scheme(scheme))
}

fn is_url_scheme(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };

    first.is_ascii_alphabetic()
        && chars.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '.' | '-')
        })
}

fn matches_extension(path: &str, extensions: &[&str]) -> bool {
    path.rsplit_once('.')
        .is_some_and(|(_, extension)| extensions.contains(&extension.to_lowercase().as_str()))
}

fn json_string<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string(value)
}

fn native_error(error: impl std::fmt::Display) -> napi::Error {
    napi::Error::from_reason(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::io::Write;
    use std::sync::{Arc, Barrier};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "twine-native-{label}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ))
    }

    #[test]
    fn integer_milliseconds_do_not_round_up_at_submillisecond_boundaries() {
        let expected_millis = 1_785_358_295_000;

        for (nanoseconds, timestamp) in [
            (999_809, "2026-07-29T20:51:35.000999809Z"),
            (999_900, "2026-07-29T20:51:35.000999900Z"),
        ] {
            let time = UNIX_EPOCH + Duration::new(1_785_358_295, nanoseconds);

            assert_eq!(system_time_to_millis(time), expected_millis);
            assert_eq!(parse_iso_to_millis(timestamp), Some(expected_millis));
        }
    }

    fn write_test_zip(
        path: &Path,
        entries: &[(&str, &[u8])],
        compression_method: zip::CompressionMethod,
    ) {
        let zip_file = File::create(path).expect("test zip should be created");
        let mut zip = zip::ZipWriter::new(zip_file);
        let options =
            zip::write::SimpleFileOptions::default().compression_method(compression_method);

        for (name, contents) in entries {
            zip.start_file(*name, options)
                .expect("test zip entry should start");
            zip.write_all(contents)
                .expect("test zip entry should be written");
        }

        zip.finish().expect("test zip should finish");
    }

    fn permissive_test_zip_limits() -> ZipImportLimits {
        ZipImportLimits {
            max_archive_bytes: 1024 * 1024,
            max_compression_ratio: 1000,
            max_entries: 10,
            max_entry_bytes: 1024 * 1024,
            max_expanded_bytes: 2 * 1024 * 1024,
            max_nesting_depth: 10,
        }
    }

    fn project_backup_root(root: &Path) -> PathBuf {
        root.parent().expect("project parent").join(format!(
            ".{}.backups",
            root.file_name()
                .expect("project file name")
                .to_string_lossy()
        ))
    }

    fn validation_story(selected: bool, text: &str) -> serde_json::Value {
        serde_json::json!({
            "ifid": "VALIDATION-IFID",
            "id": "validation-story",
            "lastUpdate": "2026-07-22T00:00:00Z",
            "name": "Validation",
            "passages": [{
                "height": 100,
                "highlighted": false,
                "id": "validation-passage",
                "left": 0,
                "name": "Start",
                "selected": selected,
                "story": "validation-story",
                "text": text,
                "top": 0,
                "width": 100
            }],
            "script": "validation script",
            "selected": selected,
            "startPassage": "validation-passage",
            "stylesheet": "validation style"
        })
    }

    #[cfg(windows)]
    #[derive(Default)]
    struct WindowsJunctionFixture {
        directories: Vec<PathBuf>,
        junctions: Vec<PathBuf>,
    }

    #[cfg(windows)]
    impl WindowsJunctionFixture {
        fn track_directory(&mut self, path: PathBuf) -> PathBuf {
            self.directories.push(path.clone());
            path
        }

        fn create_junction(&mut self, junction: &Path, target: &Path) {
            let output = std::process::Command::new("cmd.exe")
                .args(["/d", "/c", "mklink", "/j"])
                .arg(junction)
                .arg(target)
                .output()
                .expect("cmd.exe should create a directory junction");
            assert!(
                output.status.success(),
                "mklink /J failed for {} -> {}: stdout={} stderr={}",
                junction.display(),
                target.display(),
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            self.junctions.push(junction.to_path_buf());
            assert_eq!(
                fs::canonicalize(junction).expect("junction should resolve"),
                fs::canonicalize(target).expect("junction target should resolve")
            );
        }
    }

    #[cfg(windows)]
    impl Drop for WindowsJunctionFixture {
        fn drop(&mut self) {
            for junction in self.junctions.iter().rev() {
                let _ = fs::remove_dir(junction);
            }
            for directory in self.directories.iter().rev() {
                let _ = fs::remove_dir_all(directory);
            }
        }
    }

    #[test]
    fn asset_kind_matches_typescript_mapping() {
        assert_eq!(asset_kind_for_path("assets/cover.png"), "image");
        assert_eq!(asset_kind_for_path("assets/theme.css"), "stylesheet");
        assert_eq!(asset_kind_for_path("assets/click.wav"), "audio");
        assert_eq!(asset_kind_for_path("assets/readme.txt"), "file");
    }

    #[test]
    fn project_asset_payload_reader_returns_buffers_mime_types_and_deduplicates_paths() {
        let root = temp_path("asset-payloads");
        let asset = root.join("assets/nested/猫 image.png");
        let audio = root.join("assets/sound.mp3");

        fs::create_dir_all(asset.parent().expect("asset parent")).expect("asset directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(&asset, [1_u8, 2, 3]).expect("image payload");
        fs::write(&audio, [4_u8, 5, 6, 7]).expect("audio payload");

        let batch = read_project_asset_payloads_impl(
            &root,
            vec![
                "assets/nested/猫 image.png".into(),
                "assets/nested/猫 image.png".into(),
                "assets/sound.mp3".into(),
            ],
            16,
            25,
            4,
        )
        .expect("payload batch");

        assert_eq!(batch.payloads.len(), 1);
        assert_eq!(batch.payloads[0].path, "assets/nested/猫 image.png");
        assert_eq!(batch.payloads[0].media_type, "image/png");
        assert_eq!(batch.payloads[0].bytes.as_ref(), &[1, 2, 3]);
        assert_eq!(batch.payloads[0].size_bytes, 3);
        assert_eq!(batch.payloads[0].encoded_size_bytes, 4);
        assert_eq!(batch.total_source_bytes, 3);
        assert_eq!(batch.total_encoded_bytes, 4);
        assert_eq!(batch.failures.len(), 1);
        assert_eq!(batch.failures[0].path, "assets/sound.mp3");
        assert_eq!(batch.failures[0].reason, "total-limit-exceeded");

        fs::remove_dir_all(root).expect("payload project cleanup");
    }

    #[test]
    fn project_asset_payload_reader_reports_invalid_missing_directory_unsupported_and_oversized() {
        let root = temp_path("asset-payload-failures");

        fs::create_dir_all(root.join("assets/folder.png")).expect("asset directories");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(root.join("assets/readme.txt"), b"text").expect("unsupported asset");
        fs::write(root.join("assets/large.webp"), b"1234").expect("oversized asset");

        let batch = read_project_asset_payloads_impl(
            &root,
            vec![
                "/assets/absolute.png".into(),
                "assets/../outside.png".into(),
                "assets//not-canonical.png".into(),
                "assets/missing.png".into(),
                "assets/folder.png".into(),
                "assets/readme.txt".into(),
                "assets/large.webp".into(),
            ],
            4,
            25,
            100,
        )
        .expect("failure batch");
        let reasons = batch
            .failures
            .iter()
            .map(|failure| (failure.path.as_str(), failure.reason.as_str()))
            .collect::<BTreeMap<_, _>>();

        assert!(batch.payloads.is_empty());
        assert_eq!(reasons["/assets/absolute.png"], "invalid-path");
        assert_eq!(reasons["assets/../outside.png"], "invalid-path");
        assert_eq!(reasons["assets//not-canonical.png"], "invalid-path");
        assert_eq!(reasons["assets/missing.png"], "missing");
        #[cfg(not(windows))]
        assert_eq!(reasons["assets/folder.png"], "not-file");
        #[cfg(windows)]
        assert_eq!(reasons["assets/folder.png"], "unreadable");
        assert_eq!(reasons["assets/readme.txt"], "unsupported-type");
        assert_eq!(reasons["assets/large.webp"], "file-too-large");

        fs::remove_dir_all(root).expect("failure project cleanup");
    }

    #[test]
    fn project_asset_payload_reader_requires_manifest_and_enforces_file_count() {
        let root = temp_path("asset-payload-file-count");

        fs::create_dir_all(root.join("assets")).expect("assets directory");
        assert!(
            read_project_asset_payloads_impl(&root, vec!["assets/a.png".into()], 100, 25, 100,)
                .is_err()
        );

        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(root.join("assets/a.png"), b"a").expect("first asset");
        fs::write(root.join("assets/b.png"), b"b").expect("second asset");
        let batch = read_project_asset_payloads_impl(
            &root,
            vec![
                "assets/a.png".into(),
                "assets/a.png".into(),
                "assets/b.png".into(),
            ],
            100,
            1,
            100,
        )
        .expect("file-count batch");

        assert_eq!(batch.payloads.len(), 1);
        assert_eq!(batch.payloads[0].path, "assets/a.png");
        assert_eq!(batch.failures.len(), 1);
        assert_eq!(batch.failures[0].path, "assets/b.png");
        assert_eq!(batch.failures[0].reason, "file-count-exceeded");

        fs::remove_dir_all(root).expect("file-count project cleanup");
    }

    #[test]
    fn unsupported_requests_do_not_consume_supported_file_quota() {
        let root = temp_path("asset-payload-supported-quota");

        fs::create_dir_all(root.join("assets")).expect("assets directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(root.join("assets/valid.svg"), b"<svg/>").expect("valid asset");
        let mut paths = (0..24)
            .map(|index| format!("assets/unsupported-{index}.css"))
            .collect::<Vec<_>>();
        paths.push("assets/valid.svg".into());

        let batch = read_project_asset_payloads_impl(&root, paths, 100, 1, 100)
            .expect("supported quota batch");

        assert_eq!(batch.payloads.len(), 1);
        assert_eq!(batch.payloads[0].path, "assets/valid.svg");
        assert_eq!(
            batch
                .failures
                .iter()
                .filter(|failure| failure.reason == "unsupported-type")
                .count(),
            24
        );
        assert!(
            batch
                .failures
                .iter()
                .all(|failure| failure.reason != "file-count-exceeded")
        );

        fs::remove_dir_all(root).expect("supported quota project cleanup");
    }

    #[test]
    fn project_asset_payload_reader_rejects_changed_index_baseline_and_unbounded_requests() {
        let root = temp_path("asset-payload-index-baseline");
        let asset_path = root.join("assets/a.png");

        fs::create_dir_all(asset_path.parent().expect("asset parent")).expect("assets directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(&asset_path, b"new bytes").expect("asset payload");
        let metadata = fs::metadata(&asset_path).expect("asset metadata");
        let changed = read_project_asset_payload_requests_impl(
            &root,
            vec![NativeProjectAssetReadRequest {
                enforce_baseline: true,
                expected_exists: true,
                expected_modified_at_ms: Some(system_time_to_ms(
                    metadata.modified().unwrap_or(UNIX_EPOCH),
                )),
                expected_size_bytes: Some(3.0),
                expected_content_digest: Some("0".repeat(64)),
                path: "assets/a.png".into(),
            }],
            100,
            25,
            100,
        )
        .expect("changed baseline batch");

        assert!(changed.payloads.is_empty());
        assert_eq!(changed.failures[0].reason, "changed-since-index");

        let unbounded = (0..=NATIVE_ASSET_PAYLOAD_MAX_REQUEST_COUNT)
            .map(|index| NativeProjectAssetReadRequest {
                enforce_baseline: true,
                expected_exists: false,
                expected_modified_at_ms: None,
                expected_size_bytes: None,
                expected_content_digest: None,
                path: format!("assets/{index}.png"),
            })
            .collect();

        assert!(read_project_asset_payload_requests_impl(&root, unbounded, 100, 25, 100).is_err());

        fs::remove_dir_all(root).expect("baseline project cleanup");
    }

    #[test]
    fn project_asset_payload_reader_applies_hard_encoded_size_and_count_ceilings() {
        let root = temp_path("asset-payload-hard-limits");

        fs::create_dir_all(root.join("assets")).expect("assets directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        let large = File::create(root.join("assets/large.mp4")).expect("large asset");
        large
            .set_len(raw_bytes_for_encoded_limit(u64::from(NATIVE_ASSET_MAX_ENCODED_BYTES)) + 1)
            .expect("sparse large asset");
        let mut paths = vec!["assets/large.mp4".into()];
        paths.extend((1..=24).map(|index| format!("assets/missing-{index}.png")));

        let batch = read_project_asset_payloads_impl(&root, paths, u32::MAX, u32::MAX, u32::MAX)
            .expect("hard-limit batch");

        assert!(batch.payloads.is_empty());
        assert_eq!(batch.failures[0].reason, "file-too-large");
        assert_eq!(batch.failures.len(), 25);

        fs::remove_dir_all(root).expect("hard-limit project cleanup");
    }

    #[test]
    fn digest_capture_accepts_one_hundred_requests_while_payloads_remain_capped_at_twenty_five() {
        let root = temp_path("asset-digest-request-limit");

        fs::create_dir_all(root.join("assets")).expect("assets directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        let mut digest_requests = Vec::new();
        for index in 0..NATIVE_ASSET_DIGEST_MAX_REQUEST_COUNT {
            let path = format!("assets/{index}.png");
            let absolute_path = root.join(&path);
            fs::write(&absolute_path, [index as u8]).expect("tiny digest asset");
            let metadata = fs::metadata(&absolute_path).expect("tiny digest metadata");

            digest_requests.push(NativeProjectAssetDigestRequest {
                expected_modified_at_ms: system_time_to_ms(
                    metadata.modified().expect("tiny digest mtime"),
                ),
                expected_size_bytes: 1.0,
                path,
            });
        }
        let digest_batch = capture_project_asset_digests_impl(
            &root,
            digest_requests,
            u32::MAX,
            NATIVE_ASSET_MAX_ENCODED_BYTES,
        )
        .expect("one hundred digest requests should be admitted");

        assert!(digest_batch.failures.is_empty());
        assert_eq!(
            digest_batch.digests.len(),
            NATIVE_ASSET_DIGEST_MAX_REQUEST_COUNT
        );
        assert_eq!(
            digest_batch.total_source_bytes,
            NATIVE_ASSET_DIGEST_MAX_REQUEST_COUNT as u32
        );

        let payload_requests = (0..=NATIVE_ASSET_PAYLOAD_MAX_REQUEST_COUNT)
            .map(|index| NativeProjectAssetReadRequest {
                enforce_baseline: false,
                expected_exists: false,
                expected_modified_at_ms: None,
                expected_size_bytes: None,
                expected_content_digest: None,
                path: format!("assets/{index}.png"),
            })
            .collect();

        assert!(
            read_project_asset_payload_requests_impl(
                &root,
                payload_requests,
                u32::MAX,
                u32::MAX,
                NATIVE_ASSET_MAX_ENCODED_BYTES,
            )
            .is_err()
        );
        fs::remove_dir_all(root).expect("digest request-limit project cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn project_asset_payload_reader_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = temp_path("asset-payload-symlink");
        let outside = temp_path("asset-payload-outside");

        fs::create_dir_all(root.join("assets")).expect("assets directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(&outside, b"outside").expect("outside payload");
        symlink(&outside, root.join("assets/escape.png")).expect("asset symlink");

        let batch =
            read_project_asset_payloads_impl(&root, vec!["assets/escape.png".into()], 100, 25, 100)
                .expect("symlink batch");

        assert!(batch.payloads.is_empty());
        assert_eq!(batch.failures.len(), 1);
        assert_eq!(batch.failures[0].reason, "symlink-escape");

        let digest_batch = capture_project_asset_digests_impl(
            &root,
            vec![NativeProjectAssetDigestRequest {
                expected_modified_at_ms: 0.0,
                expected_size_bytes: 7.0,
                path: "assets/escape.png".into(),
            }],
            25,
            100,
        )
        .expect("digest symlink batch");
        assert!(digest_batch.digests.is_empty());
        assert_eq!(digest_batch.failures[0].reason, "symlink-escape");

        fs::remove_dir_all(root).expect("symlink project cleanup");
        fs::remove_file(outside).expect("outside payload cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn project_asset_payload_reader_rejects_intermediate_symlink() {
        use std::os::unix::fs::symlink;

        let root = temp_path("asset-payload-intermediate-symlink");
        let outside = temp_path("asset-payload-intermediate-outside");
        fs::create_dir_all(root.join("assets")).expect("assets directory");
        fs::create_dir_all(&outside).expect("outside directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(outside.join("escape.png"), b"outside").expect("outside payload");
        symlink(&outside, root.join("assets/nested")).expect("intermediate symlink");

        let batch = read_project_asset_payloads_impl(
            &root,
            vec!["assets/nested/escape.png".into()],
            100,
            25,
            100,
        )
        .expect("intermediate symlink batch");

        assert!(batch.payloads.is_empty());
        assert_eq!(batch.failures[0].reason, "symlink-escape");
        fs::remove_dir_all(root).expect("project cleanup");
        fs::remove_dir_all(outside).expect("outside cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn opened_assets_capability_survives_namespace_swap_without_escape() {
        use std::os::unix::fs::symlink;

        let root = temp_path("asset-capability-swap");
        let outside = temp_path("asset-capability-swap-outside");
        fs::create_dir_all(root.join("assets/nested")).expect("assets directory");
        fs::create_dir_all(outside.join("nested")).expect("outside directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(root.join("assets/nested/safe.png"), b"trusted").expect("trusted payload");
        fs::write(outside.join("nested/safe.png"), b"outside").expect("outside payload");
        let assets = open_project_assets_dir(&root)
            .expect("assets capability")
            .expect("assets directory");

        fs::rename(root.join("assets"), root.join("assets-old")).expect("swap assets root");
        symlink(&outside, root.join("assets")).expect("replacement symlink");
        let mut file = open_project_asset_file(&assets, Path::new("nested/safe.png"))
            .expect("open through retained capability");
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).expect("read trusted payload");

        assert_eq!(bytes, b"trusted");
        fs::remove_file(root.join("assets")).expect("replacement cleanup");
        fs::remove_dir_all(root).expect("project cleanup");
        fs::remove_dir_all(outside).expect("outside cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn project_root_swap_after_canonicalization_cannot_open_outside_assets() {
        use std::os::unix::fs::symlink;

        let root = temp_path("project-root-canonical-swap");
        let displaced = root.with_extension("displaced");
        let outside = temp_path("project-root-canonical-swap-outside");
        fs::create_dir_all(root.join("assets")).expect("project assets");
        fs::create_dir_all(outside.join("assets")).expect("outside assets");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(root.join("assets/safe.png"), b"trusted").expect("trusted payload");
        fs::write(outside.join("twine.toml"), "version = 1\n").expect("outside manifest");
        fs::write(outside.join("assets/safe.png"), b"outside").expect("outside payload");

        let result = open_project_assets_dir_after_canonicalize(&root, |_| {
            fs::rename(&root, &displaced).expect("displace canonical project root");
            symlink(&outside, &root).expect("replace project root with symlink");
        });

        assert!(result.is_err());
        fs::remove_file(&root).expect("replacement symlink cleanup");
        fs::remove_dir_all(displaced).expect("displaced project cleanup");
        fs::remove_dir_all(outside).expect("outside cleanup");
    }

    #[cfg(windows)]
    #[test]
    fn windows_project_asset_reader_rejects_intermediate_directory_junction() {
        let mut fixture = WindowsJunctionFixture::default();
        let root = fixture.track_directory(temp_path("asset-payload-intermediate-junction"));
        let outside =
            fixture.track_directory(temp_path("asset-payload-intermediate-junction-outside"));
        let outside_asset = outside.join("escape.png");

        fs::create_dir_all(root.join("assets")).expect("assets directory");
        fs::create_dir_all(&outside).expect("outside directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(&outside_asset, b"outside").expect("outside payload");
        fixture.create_junction(&root.join("assets").join("nested"), &outside);

        let payload_batch = read_project_asset_payloads_impl(
            &root,
            vec!["assets/nested/escape.png".into()],
            100,
            25,
            100,
        )
        .expect("intermediate junction payload batch");
        assert!(payload_batch.payloads.is_empty());
        assert_eq!(payload_batch.failures.len(), 1);
        assert_eq!(payload_batch.failures[0].reason, "symlink-escape");

        let metadata = fs::metadata(&outside_asset).expect("outside payload metadata");
        let digest_batch = capture_project_asset_digests_impl(
            &root,
            vec![NativeProjectAssetDigestRequest {
                expected_modified_at_ms: system_time_to_ms(
                    metadata.modified().expect("outside payload mtime"),
                ),
                expected_size_bytes: metadata.len() as f64,
                path: "assets/nested/escape.png".into(),
            }],
            25,
            100,
        )
        .expect("intermediate junction digest batch");
        assert!(digest_batch.digests.is_empty());
        assert_eq!(digest_batch.failures.len(), 1);
        assert_eq!(digest_batch.failures[0].reason, "symlink-escape");
    }

    #[cfg(windows)]
    #[test]
    fn windows_project_asset_reader_rejects_assets_root_directory_junction() {
        let mut fixture = WindowsJunctionFixture::default();
        let root = fixture.track_directory(temp_path("asset-root-junction"));
        let outside = fixture.track_directory(temp_path("asset-root-junction-outside"));
        let outside_asset = outside.join("escape.png");

        fs::create_dir_all(&root).expect("project directory");
        fs::create_dir_all(&outside).expect("outside directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(&outside_asset, b"outside").expect("outside payload");
        fixture.create_junction(&root.join("assets"), &outside);

        assert!(
            read_project_asset_payloads_impl(
                &root,
                vec!["assets/escape.png".into()],
                100,
                25,
                100,
            )
            .is_err()
        );

        let metadata = fs::metadata(&outside_asset).expect("outside payload metadata");
        assert!(
            capture_project_asset_digests_impl(
                &root,
                vec![NativeProjectAssetDigestRequest {
                    expected_modified_at_ms: system_time_to_ms(
                        metadata.modified().expect("outside payload mtime"),
                    ),
                    expected_size_bytes: metadata.len() as f64,
                    path: "assets/escape.png".into(),
                }],
                25,
                100,
            )
            .is_err()
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_retained_assets_capability_rejects_namespace_swap() {
        let mut fixture = WindowsJunctionFixture::default();
        let root = fixture.track_directory(temp_path("asset-capability-junction-swap"));
        let outside = fixture.track_directory(temp_path("asset-capability-junction-swap-outside"));

        fs::create_dir_all(root.join("assets/nested")).expect("assets directory");
        fs::create_dir_all(&outside).expect("outside directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(root.join("assets/nested/safe.png"), b"trusted").expect("trusted payload");
        fs::write(outside.join("safe.png"), b"outside").expect("outside payload");
        let assets = open_project_assets_dir(&root)
            .expect("assets capability")
            .expect("assets directory");

        fs::rename(root.join("assets/nested"), root.join("assets/nested-old"))
            .expect("swap nested assets directory");
        fixture.create_junction(&root.join("assets").join("nested"), &outside);
        let result = open_project_asset_file(&assets, Path::new("nested/safe.png"));

        assert!(result.is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_project_root_swap_after_canonicalization_fails_closed() {
        let mut fixture = WindowsJunctionFixture::default();
        let root = fixture.track_directory(temp_path("project-root-canonical-junction-swap"));
        let displaced = fixture.track_directory(root.with_extension("displaced"));
        let outside =
            fixture.track_directory(temp_path("project-root-canonical-junction-swap-outside"));

        fs::create_dir_all(root.join("assets")).expect("project assets");
        fs::create_dir_all(outside.join("assets")).expect("outside assets");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(root.join("assets/safe.png"), b"trusted").expect("trusted payload");
        fs::write(outside.join("twine.toml"), "version = 1\n").expect("outside manifest");
        fs::write(outside.join("assets/safe.png"), b"outside").expect("outside payload");

        let result = open_project_assets_dir_after_canonicalize(&root, |_| {
            fs::rename(&root, &displaced).expect("displace canonical project root");
            fixture.create_junction(&root, &outside);
        });

        assert!(result.is_err());
    }

    #[test]
    fn project_asset_digest_rejects_same_size_rewrite_with_restored_mtime() {
        let root = temp_path("asset-digest-rewrite");
        let asset = root.join("assets/a.png");
        fs::create_dir_all(asset.parent().expect("asset parent")).expect("assets directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(&asset, b"abc").expect("initial payload");
        let initial_metadata = fs::metadata(&asset).expect("initial metadata");
        let initial_mtime = initial_metadata.modified().expect("initial mtime");
        let expected_modified_at_ms = system_time_to_ms(initial_mtime);
        let digest_batch = capture_project_asset_digests_impl(
            &root,
            vec![NativeProjectAssetDigestRequest {
                expected_modified_at_ms,
                expected_size_bytes: 3.0,
                path: "assets/a.png".into(),
            }],
            25,
            100,
        )
        .expect("digest batch");
        assert!(digest_batch.failures.is_empty());
        assert_eq!(
            digest_batch.digests[0].content_digest,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );

        fs::write(&asset, b"xyz").expect("rewritten payload");
        fs::OpenOptions::new()
            .write(true)
            .open(&asset)
            .expect("rewritten file")
            .set_times(fs::FileTimes::new().set_modified(initial_mtime))
            .expect("restore mtime");
        let payload_batch = read_project_asset_payload_requests_impl(
            &root,
            vec![NativeProjectAssetReadRequest {
                enforce_baseline: true,
                expected_exists: true,
                expected_modified_at_ms: Some(expected_modified_at_ms),
                expected_size_bytes: Some(3.0),
                expected_content_digest: Some(digest_batch.digests[0].content_digest.clone()),
                path: "assets/a.png".into(),
            }],
            100,
            25,
            100,
        )
        .expect("payload batch");

        assert!(payload_batch.payloads.is_empty());
        assert_eq!(payload_batch.failures[0].reason, "changed-since-index");
        fs::remove_dir_all(root).expect("project cleanup");
    }

    #[test]
    fn project_asset_payload_reader_fails_closed_without_digest() {
        let root = temp_path("asset-missing-digest");
        let asset = root.join("assets/a.png");
        fs::create_dir_all(asset.parent().expect("asset parent")).expect("assets directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(&asset, b"abc").expect("asset payload");
        let metadata = fs::metadata(&asset).expect("metadata");
        let batch = read_project_asset_payload_requests_impl(
            &root,
            vec![NativeProjectAssetReadRequest {
                enforce_baseline: true,
                expected_exists: true,
                expected_modified_at_ms: Some(system_time_to_ms(
                    metadata.modified().unwrap_or(UNIX_EPOCH),
                )),
                expected_size_bytes: Some(3.0),
                expected_content_digest: None,
                path: "assets/a.png".into(),
            }],
            100,
            25,
            100,
        )
        .expect("missing digest batch");

        assert!(batch.payloads.is_empty());
        assert_eq!(batch.failures[0].reason, "changed-since-index");
        fs::remove_dir_all(root).expect("project cleanup");
    }

    #[test]
    fn supported_project_asset_media_types_are_exact() {
        assert_eq!(
            supported_asset_media_type("assets/a.png"),
            Some("image/png")
        );
        assert_eq!(
            supported_asset_media_type("assets/a.JPEG"),
            Some("image/jpeg")
        );
        assert_eq!(
            supported_asset_media_type("assets/a.svg"),
            Some("image/svg+xml")
        );
        assert_eq!(
            supported_asset_media_type("assets/a.mp3"),
            Some("audio/mpeg")
        );
        assert_eq!(
            supported_asset_media_type("assets/a.m4a"),
            Some("audio/mp4")
        );
        assert_eq!(
            supported_asset_media_type("assets/a.ogg"),
            Some("audio/ogg")
        );
        assert_eq!(
            supported_asset_media_type("assets/a.wav"),
            Some("audio/wav")
        );
        assert_eq!(
            supported_asset_media_type("assets/a.mp4"),
            Some("video/mp4")
        );
        assert_eq!(
            supported_asset_media_type("assets/a.webm"),
            Some("video/webm")
        );
        assert_eq!(supported_asset_media_type("assets/a.css"), None);
    }

    #[test]
    fn project_preview_asset_reader_accepts_bounded_non_media_files() {
        let root = temp_path("preview-asset-support-file");
        let asset = root.join("assets/style.css");

        fs::create_dir_all(asset.parent().expect("asset parent")).expect("assets directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(&asset, b"body {}").expect("preview asset");
        let batch = read_project_preview_asset_payloads_impl(
            &root,
            vec!["assets/style.css".into()],
            100,
            25,
            100,
        )
        .expect("preview payload batch");

        assert!(batch.failures.is_empty());
        assert_eq!(batch.payloads.len(), 1);
        assert_eq!(batch.payloads[0].bytes.as_ref(), b"body {}");
        fs::remove_dir_all(root).expect("project cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn project_preview_asset_reader_rejects_non_media_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = temp_path("preview-asset-symlink");
        let outside = temp_path("preview-asset-outside");

        fs::create_dir_all(root.join("assets")).expect("assets directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(&outside, b"outside").expect("outside payload");
        symlink(&outside, root.join("assets/escape.css")).expect("asset symlink");
        let batch = read_project_preview_asset_payloads_impl(
            &root,
            vec!["assets/escape.css".into()],
            100,
            25,
            100,
        )
        .expect("preview symlink batch");

        assert!(batch.payloads.is_empty());
        assert_eq!(batch.failures[0].reason, "symlink-escape");
        fs::remove_dir_all(root).expect("project cleanup");
        fs::remove_file(outside).expect("outside cleanup");
    }

    #[test]
    fn import_asset_target_paths_are_project_local() {
        assert_eq!(
            import_asset_target_path("images/cover.png"),
            "assets/images/cover.png"
        );
        assert_eq!(
            import_asset_target_path("assets/cover.png"),
            "assets/cover.png"
        );
    }

    #[test]
    fn import_asset_discovery_enforces_count_scan_depth_and_byte_quotas() {
        let root = temp_path("import-asset-quotas");
        let asset_directory = root.join("images");

        fs::create_dir_all(&asset_directory).expect("asset directory should be created");
        fs::write(asset_directory.join("cover.png"), b"x").expect("asset should be written");

        let mut assets = BTreeMap::new();
        let mut budget = ImportAssetBudget::default();

        for index in 0..MAX_IMPORT_ASSETS {
            add_import_asset(
                &mut assets,
                &root,
                &root.join(format!("images/{index}.png")),
                1,
                &mut budget,
            )
            .expect("asset boundary should be accepted");
        }
        let count_error = add_import_asset(
            &mut assets,
            &root,
            &root.join("images/overflow.png"),
            1,
            &mut budget,
        )
        .expect_err("asset count overflow should be rejected");

        assert!(count_error.to_string().contains("more than 1000 assets"));

        let mut scan_budget = ImportAssetBudget {
            scanned_entries: MAX_IMPORT_ASSET_SCAN_ENTRIES,
            ..ImportAssetBudget::default()
        };
        let scan_error = scan_import_asset_directory(
            &mut BTreeMap::new(),
            &root,
            &asset_directory,
            1,
            &mut scan_budget,
        )
        .expect_err("asset scan overflow should be rejected");

        assert!(scan_error.to_string().contains("scan exceeds"));

        let depth_error = scan_import_asset_directory(
            &mut BTreeMap::new(),
            &root,
            &asset_directory,
            MAX_IMPORT_ASSET_SCAN_DEPTH + 1,
            &mut ImportAssetBudget::default(),
        )
        .expect_err("asset nesting overflow should be rejected");

        assert!(depth_error.to_string().contains("nesting exceeds"));

        let entry_error = add_import_asset(
            &mut BTreeMap::new(),
            &root,
            &root.join("images/large.png"),
            ZIP_IMPORT_LIMITS.max_entry_bytes + 1,
            &mut ImportAssetBudget::default(),
        )
        .expect_err("oversized asset should be rejected");

        assert!(entry_error.to_string().contains("asset exceeds"));

        let total_error = add_import_asset(
            &mut BTreeMap::new(),
            &root,
            &root.join("images/total.png"),
            1,
            &mut ImportAssetBudget {
                total_bytes: ZIP_IMPORT_LIMITS.max_expanded_bytes,
                ..ImportAssetBudget::default()
            },
        )
        .expect_err("cumulative asset overflow should be rejected");

        assert!(total_error.to_string().contains("cumulative size limit"));
        fs::remove_dir_all(root).expect("asset quota root should be removed");
    }

    #[test]
    fn import_asset_rewrite_handles_spaced_roots_and_large_nonmatches_linearly() {
        let long_root = format!("{}x", "a ".repeat(127));
        let assets = vec![
            NativeProjectImportAsset {
                original_path: "Ä Files/cover.png".into(),
                source_path: "/imports/Ä Files/cover.png".into(),
                target_path: "assets/Ä Files/cover.png".into(),
            },
            NativeProjectImportAsset {
                original_path: format!("{long_root}/cover.png"),
                source_path: format!("/imports/{long_root}/cover.png"),
                target_path: format!("assets/{long_root}/cover.png"),
            },
        ];
        let rewritten =
            rewrite_project_import_asset_references(r#"<img src="ä files/cover.png">"#, &assets)
                .expect("spaced asset root should rewrite");

        assert!(rewritten.contains(r#"src="assets/Ä Files/cover.png""#));

        let component = format!("{}y/", "a ".repeat(127));
        let adversarial = component.repeat((10_usize * 1024 * 1024).div_ceil(component.len()));
        let started_at = Instant::now();

        rewrite_project_import_asset_references(&adversarial, &assets)
            .expect("large nonmatching components should remain bounded");
        assert!(
            started_at.elapsed().as_secs_f64() < 2.0,
            "asset rewrite exceeded its linear-time budget: {:?}",
            started_at.elapsed()
        );
    }

    #[cfg(unix)]
    #[test]
    fn referenced_import_asset_discovery_skips_symlinks() {
        use std::os::unix::fs::symlink;

        let root = temp_path("import-asset-symlink");
        let outside = temp_path("import-asset-symlink-outside");

        fs::create_dir_all(&root).expect("asset root should be created");
        fs::write(&outside, b"outside").expect("outside file should be written");
        symlink(&outside, root.join("escape.png")).expect("asset symlink should be created");

        let mut assets = BTreeMap::new();

        add_referenced_import_assets(
            &mut assets,
            &root,
            r#"<img src="escape.png">"#,
            &mut ImportAssetBudget::default(),
        )
        .expect("symlink reference should be skipped safely");
        assert!(assets.is_empty());

        fs::remove_dir_all(root).expect("asset root should be removed");
        fs::remove_file(outside).expect("outside file should be removed");
    }

    #[test]
    fn save_rejects_non_project_directories_without_modifying_them() {
        let root = temp_path("reject-non-project-save");

        fs::create_dir_all(&root).expect("test directory should be created");
        fs::write(root.join("keep.txt"), "untouched").expect("sentinel should be written");

        let error =
            save_project_folder_json(root.to_string_lossy().into_owned(), "{}".into(), None)
                .expect_err("an ordinary directory must not be accepted as a project");

        assert!(error.reason.contains("existing project folder"));
        assert_eq!(
            fs::read_to_string(root.join("keep.txt")).expect("sentinel should remain"),
            "untouched"
        );
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn create_rejects_an_existing_filesystem_entry() {
        let root = temp_path("reject-existing-project-create");

        fs::create_dir_all(&root).expect("test directory should be created");

        let error = reserve_new_project_root(&root)
            .expect_err("project creation must not replace an existing directory");

        assert!(error.reason.contains("cannot replace"));
        assert!(root.is_dir());
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn create_rejects_replacing_a_populated_project_without_modifying_it() {
        let root = temp_path("reject-populated-project-create");
        let first_story = serde_json::json!({
            "ifid": "FIRST-IFID",
            "id": "first-story",
            "lastUpdate": "2026-01-01T00:00:00.000Z",
            "name": "First Story",
            "passages": [{
                "height": 100,
                "highlighted": false,
                "id": "first-passage",
                "left": 25,
                "name": "Start",
                "selected": true,
                "story": "first-story",
                "tags": [],
                "text": "Original passage text",
                "top": 25,
                "width": 100
            }],
            "script": "",
            "selected": true,
            "snapToGrid": true,
            "startPassage": "first-passage",
            "storyFormat": "Harlowe",
            "storyFormatVersion": "3.3.9",
            "stylesheet": "",
            "tags": [],
            "tagColors": {},
            "zoom": 1
        });
        let second_story = serde_json::json!({
            "ifid": "SECOND-IFID",
            "id": "second-story",
            "lastUpdate": "2026-01-02T00:00:00.000Z",
            "name": "Second Story",
            "passages": [{
                "height": 100,
                "highlighted": false,
                "id": "second-passage",
                "left": 25,
                "name": "Replacement",
                "selected": true,
                "story": "second-story",
                "tags": [],
                "text": "Replacement passage text",
                "top": 25,
                "width": 100
            }],
            "script": "",
            "selected": true,
            "snapToGrid": true,
            "startPassage": "second-passage",
            "storyFormat": "Harlowe",
            "storyFormatVersion": "3.3.9",
            "stylesheet": "",
            "tags": [],
            "tagColors": {},
            "zoom": 1
        });

        create_project_folder_json(
            root.to_string_lossy().into_owned(),
            first_story.to_string(),
            None,
        )
        .expect("first project should be created");

        let manifest_path = root.join("twine.toml");
        let passage_path = root.join("passages/first-story/0001-start.twee");
        let sidecar_path = root.join(".twine/project.json");
        let sentinel_path = root.join("unmanaged-sentinel.txt");
        let original_manifest = fs::read(&manifest_path).expect("manifest should be readable");
        let original_passage = fs::read(&passage_path).expect("passage should be readable");
        let original_sidecar = fs::read(&sidecar_path).expect("sidecar should be readable");
        fs::write(&sentinel_path, b"unmanaged and untouched").expect("sentinel should be written");

        let error = create_project_folder_json(
            root.to_string_lossy().into_owned(),
            second_story.to_string(),
            None,
        )
        .expect_err("second project must not replace the first");

        assert!(error.reason.contains("cannot replace"));
        assert_eq!(
            fs::read(&manifest_path).expect("manifest should remain readable"),
            original_manifest
        );
        assert_eq!(
            fs::read(&passage_path).expect("passage should remain readable"),
            original_passage
        );
        assert_eq!(
            fs::read(&sidecar_path).expect("sidecar should remain readable"),
            original_sidecar
        );
        assert_eq!(
            fs::read(&sentinel_path).expect("sentinel should remain readable"),
            b"unmanaged and untouched"
        );
        assert!(!root.join("passages/second-story").exists());
        assert!(!String::from_utf8_lossy(&original_manifest).contains("second-story"));
        assert!(!String::from_utf8_lossy(&original_sidecar).contains("second-story"));

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn concurrent_project_root_reservations_have_one_winner() {
        let root = Arc::new(temp_path("concurrent-project-create"));
        let barrier = Arc::new(Barrier::new(2));
        let attempts = (0..2)
            .map(|_| {
                let root = Arc::clone(&root);
                let barrier = Arc::clone(&barrier);

                std::thread::spawn(move || {
                    barrier.wait();
                    reserve_new_project_root(&root).is_ok()
                })
            })
            .collect::<Vec<_>>();
        let successes = attempts
            .into_iter()
            .map(|attempt| usize::from(attempt.join().expect("reservation thread should finish")))
            .sum::<usize>();

        assert_eq!(successes, 1);
        assert!(root.is_dir());
        fs::remove_dir_all(root.as_ref()).expect("test directory should be removed");
    }

    #[test]
    fn staged_project_install_is_atomic_and_never_overwrites() {
        let parent = temp_path("staged-project-install");
        let staging = parent.join(".twine-rs-duplicate-staging");
        let occupied = parent.join("occupied.twine.rs");
        let destination = parent.join("installed.twine.rs");

        fs::create_dir_all(staging.join("assets")).expect("staging project");
        fs::write(staging.join("twine.toml"), "schema_version = 1").expect("manifest");
        fs::write(staging.join("assets/cover.bin"), b"asset bytes").expect("asset");
        fs::create_dir_all(&occupied).expect("occupied destination");
        fs::write(occupied.join("sentinel.txt"), "do not replace").expect("sentinel");

        assert!(
            !install_project_folder_no_replace_inner(
                staging.to_string_lossy().into_owned(),
                occupied.to_string_lossy().into_owned(),
            )
            .expect("collision should be reported")
        );
        assert!(staging.is_dir());
        assert_eq!(
            fs::read_to_string(occupied.join("sentinel.txt")).expect("sentinel"),
            "do not replace"
        );
        assert!(
            install_project_folder_no_replace_inner(
                staging.to_string_lossy().into_owned(),
                destination.to_string_lossy().into_owned(),
            )
            .expect("staged project should install")
        );
        assert!(!staging.exists());
        assert_eq!(
            fs::read(destination.join("assets/cover.bin")).expect("installed asset"),
            b"asset bytes"
        );

        fs::remove_dir_all(parent).expect("test directory should be removed");
    }

    #[test]
    fn duplicated_project_replaces_identity_and_preserves_files_and_custom_source_path() {
        let root = temp_path("duplicate-project-folder");
        let original = serde_json::json!({
            "ifid": "ORIGINAL-IFID",
            "id": "original-story",
            "name": "Original Story",
            "passages": [{
                "height": 120,
                "id": "original-passage",
                "left": 25,
                "name": "Start",
                "story": "original-story",
                "tags": [],
                "text": "Original passage text",
                "top": 50,
                "width": 140
            }],
            "script": "window.original = true;",
            "startPassage": "original-passage",
            "stylesheet": ".original {}"
        });

        create_project_folder_json(
            root.to_string_lossy().into_owned(),
            original.to_string(),
            Some("single-twee".into()),
        )
        .expect("source project should be created");

        let manifest_path = root.join("twine.toml");
        let manifest = fs::read_to_string(&manifest_path)
            .expect("source manifest")
            .replace(
                "source = \"story.twee\"",
                "source = \"narrative/main.twee\"",
            );

        fs::create_dir_all(root.join("narrative")).expect("custom source parent");
        fs::rename(root.join("story.twee"), root.join("narrative/main.twee"))
            .expect("custom source move");
        fs::write(&manifest_path, manifest).expect("custom source manifest");
        fs::write(root.join("assets/cover.bin"), b"asset bytes").expect("asset");
        fs::write(root.join("notes.txt"), "unmanaged notes").expect("unmanaged file");

        let duplicate = serde_json::json!({
            "ifid": "DUPLICATE-IFID",
            "id": "duplicate-story",
            "name": "Original Story 1",
            "passages": [{
                "height": 125,
                "id": "duplicate-passage",
                "left": 30,
                "name": "Start",
                "story": "duplicate-story",
                "tags": [],
                "text": "Original passage text",
                "top": 55,
                "width": 145
            }],
            "script": "window.original = true;",
            "startPassage": "duplicate-passage",
            "stylesheet": ".original {}"
        });
        let result = replace_project_folder_stories_json(
            root.to_string_lossy().into_owned(),
            serde_json::json!([{
                "passageIds": [{
                    "duplicatePassageId": "duplicate-passage",
                    "sourcePassageId": "original-passage"
                }],
                "sourceStoryId": "original-story",
                "story": duplicate
            }])
            .to_string(),
        )
        .expect("project identities should be replaced");
        let result: NativeProjectFolderResult =
            serde_json::from_str(&result).expect("duplicate result");
        let duplicated_manifest = fs::read_to_string(&manifest_path).expect("duplicate manifest");

        assert_eq!(result.story_ids, ["duplicate-story"]);
        assert!(duplicated_manifest.contains("id = \"duplicate-story\""));
        assert!(!duplicated_manifest.contains("id = \"original-story\""));
        assert!(duplicated_manifest.contains("source = \"narrative/main.twee\""));
        assert!(root.join("narrative/main.twee").is_file());
        assert_eq!(
            fs::read(root.join("assets/cover.bin")).expect("copied asset"),
            b"asset bytes"
        );
        assert_eq!(
            fs::read_to_string(root.join("notes.txt")).expect("unmanaged file"),
            "unmanaged notes"
        );

        fs::remove_dir_all(root).expect("duplicated project should be removed");
    }

    #[test]
    fn duplicated_project_uses_explicit_passage_mapping_and_validates_start() {
        let root = temp_path("duplicate-project-passage-mapping");
        let original = serde_json::json!({
            "ifid": "ORIGINAL-MAPPING-IFID",
            "id": "original-mapping-story",
            "name": "Original Mapping Story",
            "passages": [
                {
                    "height": 111,
                    "id": "source-a",
                    "left": 10,
                    "name": "A",
                    "story": "original-mapping-story",
                    "text": "A",
                    "top": 20,
                    "width": 121
                },
                {
                    "height": 222,
                    "id": "source-b",
                    "left": 30,
                    "name": "B",
                    "story": "original-mapping-story",
                    "text": "B",
                    "top": 40,
                    "width": 232
                }
            ],
            "startPassage": "source-a"
        });

        create_project_folder_json(
            root.to_string_lossy().into_owned(),
            original.to_string(),
            Some("passage-files".into()),
        )
        .expect("source project should be created");

        let replacement = |start_passage: &str| {
            serde_json::json!([{
                "passageIds": [
                    {
                        "duplicatePassageId": "duplicate-a",
                        "sourcePassageId": "source-a"
                    },
                    {
                        "duplicatePassageId": "duplicate-b",
                        "sourcePassageId": "source-b"
                    }
                ],
                "sourceStoryId": "original-mapping-story",
                "story": {
                    "ifid": "DUPLICATE-MAPPING-IFID",
                    "id": "duplicate-mapping-story",
                    "name": "Original Mapping Story 1",
                    "passages": [
                        {
                            "id": "duplicate-b",
                            "name": "B",
                            "story": "duplicate-mapping-story",
                            "text": "B"
                        },
                        {
                            "id": "duplicate-a",
                            "name": "A",
                            "story": "duplicate-mapping-story",
                            "text": "A"
                        }
                    ],
                    "startPassage": start_passage
                }
            }])
        };

        let invalid_error = replace_project_folder_stories_json(
            root.to_string_lossy().into_owned(),
            replacement("duplicate-b").to_string(),
        )
        .expect_err("incorrect mapped start passage should be rejected");

        assert!(
            invalid_error
                .reason
                .contains("start passage must match the mapped source")
        );

        replace_project_folder_stories_json(
            root.to_string_lossy().into_owned(),
            replacement("duplicate-a").to_string(),
        )
        .expect("explicit passage mapping should permit reordered passages");
        let duplicated =
            load_project_path_with_options(&root, LoadProjectOptions::full()).expect("duplicate");
        let story = &duplicated.stories[0];
        let duplicate_a = story
            .passages
            .iter()
            .find(|passage| passage.id.as_ref() == "duplicate-a")
            .expect("duplicate A");
        let duplicate_b = story
            .passages
            .iter()
            .find(|passage| passage.id.as_ref() == "duplicate-b")
            .expect("duplicate B");

        assert_eq!(story.start_passage.as_ref(), "duplicate-a");
        assert_eq!(
            duplicated
                .layout
                .passages
                .get(&story.id, &duplicate_a.id)
                .expect("A layout")
                .bounds
                .height,
            111.0
        );
        assert_eq!(
            duplicated
                .layout
                .passages
                .get(&story.id, &duplicate_b.id)
                .expect("B layout")
                .bounds
                .height,
            222.0
        );

        fs::remove_dir_all(root).expect("duplicated project should be removed");
    }

    #[test]
    fn duplicated_multi_story_project_replaces_every_story_identity() {
        let root = temp_path("duplicate-multi-story-project");
        let story = |id: &str, ifid: &str, name: &str, passage_id: &str| {
            serde_json::json!({
                "ifid": ifid,
                "id": id,
                "name": name,
                "passages": [{
                    "id": passage_id,
                    "name": "Start",
                    "story": id,
                    "text": format!("{name} body")
                }],
                "startPassage": passage_id
            })
        };
        let first = story("first-story", "FIRST-IFID", "First", "shared-passage");
        let second = story("second-story", "SECOND-IFID", "Second", "shared-passage");

        create_project_folder_json(
            root.to_string_lossy().into_owned(),
            first.to_string(),
            Some("passage-files".into()),
        )
        .expect("first source story");
        save_project_folder_json(
            root.to_string_lossy().into_owned(),
            second.to_string(),
            Some("single-twee".into()),
        )
        .expect("second source story");
        fs::write(
            root.join(".twine/graph.json"),
            serde_json::json!({
                "groups": {
                    "shared-group": {
                        "id": "shared-group",
                        "name": "Shared Group",
                        "passages": ["shared-passage"]
                    }
                },
                "passages": {
                    "schema": 2,
                    "byStory": {
                        "first-story": {
                            "shared-passage": {
                                "bounds": {"height": 100, "left": 10, "top": 20, "width": 120}
                            }
                        },
                        "second-story": {
                            "shared-passage": {
                                "bounds": {"height": 110, "left": 30, "top": 40, "width": 130}
                            }
                        }
                    }
                },
                "savedLayouts": {
                    "shared-layout": {
                        "id": "shared-layout",
                        "name": "Shared Layout",
                        "passages": {
                            "shared-passage": {
                                "bounds": {"height": 90, "left": 5, "top": 15, "width": 115}
                            }
                        }
                    }
                }
            })
            .to_string(),
        )
        .expect("source graph metadata");

        let first_duplicate = story(
            "first-duplicate",
            "FIRST-DUPLICATE-IFID",
            "First 1",
            "first-duplicate-passage",
        );
        let second_duplicate = story(
            "second-duplicate",
            "SECOND-DUPLICATE-IFID",
            "Second 1",
            "second-duplicate-passage",
        );
        let result = replace_project_folder_stories_json(
            root.to_string_lossy().into_owned(),
            serde_json::json!([
                {
                    "passageIds": [{
                        "duplicatePassageId": "first-duplicate-passage",
                        "sourcePassageId": "shared-passage"
                    }],
                    "sourceStoryId": "first-story",
                    "story": first_duplicate
                },
                {
                    "passageIds": [{
                        "duplicatePassageId": "second-duplicate-passage",
                        "sourcePassageId": "shared-passage"
                    }],
                    "sourceStoryId": "second-story",
                    "story": second_duplicate
                }
            ])
            .to_string(),
        )
        .expect("all project identities should be replaced");
        let result: NativeProjectFolderResult =
            serde_json::from_str(&result).expect("duplicate result");
        let manifest = fs::read_to_string(root.join("twine.toml")).expect("manifest");
        let graph: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(root.join(".twine/graph.json")).expect("graph layout"),
        )
        .expect("graph JSON");

        assert_eq!(result.story_ids, ["first-duplicate", "second-duplicate"]);
        assert!(!manifest.contains("id = \"first-story\""));
        assert!(!manifest.contains("id = \"second-story\""));
        assert!(manifest.contains("id = \"first-duplicate\""));
        assert!(manifest.contains("id = \"second-duplicate\""));
        assert!(manifest.contains("source_layout = \"single-twee\""));
        assert!(root.join("story.twee").is_file());
        assert_eq!(
            graph["groups"]["shared-group"]["passages"],
            serde_json::json!(["first-duplicate-passage", "second-duplicate-passage"])
        );
        assert!(
            graph["savedLayouts"]["shared-layout"]["passages"]
                .get("first-duplicate-passage")
                .is_some()
        );
        assert!(
            graph["savedLayouts"]["shared-layout"]["passages"]
                .get("second-duplicate-passage")
                .is_some()
        );

        fs::remove_dir_all(root).expect("duplicated project should be removed");
    }

    #[test]
    fn saves_project_folder_and_slim_renderer_sidecar() {
        let root = temp_path("save-project");
        let story = serde_json::json!({
            "ifid": "IFID",
            "id": "story-1",
            "lastUpdate": "2026-01-01T00:00:00.000Z",
            "name": "Native Save",
            "passages": [{
                "height": 100,
                "highlighted": true,
                "id": "passage-1",
                "left": 25,
                "name": "Start",
                "selected": true,
                "story": "story-1",
                "tags": ["hub"],
                "text": "A very important passage body",
                "top": 25,
                "width": 100
            }],
            "script": "",
            "selected": true,
            "snapToGrid": true,
            "startPassage": "passage-1",
            "storyFormat": "Harlowe",
            "storyFormatVersion": "3.3.9",
            "stylesheet": "",
            "tags": [],
            "tagColors": {"hub": "#f00"},
            "zoom": 1
        });

        create_project_folder_json(root.to_string_lossy().into_owned(), story.to_string(), None)
            .expect("project should save");

        let sidecar = fs::read_to_string(root.join(".twine/project.json"))
            .expect("sidecar should be written");

        assert!(root.join("twine.toml").exists());
        assert!(root.join("passages/native-save/0001-start.twee").exists());
        assert!(sidecar.contains("\"highlighted\":true"));
        assert!(sidecar.contains("\"selected\":true"));
        assert!(!sidecar.contains("A very important passage body"));

        let loaded =
            load_project_folder_json(root.to_string_lossy().into_owned(), Some("full".into()))
                .expect("project should load with a receipt");
        let loaded: NativeProjectFolderResult =
            serde_json::from_str(&loaded).expect("native load result should parse");
        let receipt = loaded
            .baseline_receipt
            .expect("full native load should include a baseline receipt");

        assert!(
            receipt
                .files
                .iter()
                .any(|file| file.file.path == "passages/native-save/0001-start.twee")
        );
        assert!(
            receipt
                .files
                .iter()
                .any(|file| file.file.path == "twine.toml")
        );

        let shell =
            load_project_folder_json(root.to_string_lossy().into_owned(), Some("shell".into()))
                .expect("project shell should load");
        let shell: NativeProjectFolderResult =
            serde_json::from_str(&shell).expect("native shell should parse");

        assert!(!shell.passage_text_loaded);
        assert!(!shell.story_sources_loaded);
        assert!(!shell.graph_layout_loaded);
        assert!(shell.baseline_receipt.is_none());
        assert!(shell.stories[0].script.is_empty());
        assert!(shell.stories[0].stylesheet.is_empty());
        assert!(shell.stories[0].passages[0].text.is_empty());

        let hydration = begin_project_folder_hydration_json(
            root.to_string_lossy().into_owned(),
            Some("[\"story-1\"]".into()),
        )
        .expect("native hydration should begin");
        let hydration: serde_json::Value =
            serde_json::from_str(&hydration).expect("hydration start should parse");
        let hydration_id = hydration["hydrationId"]
            .as_str()
            .expect("hydration should have an ID");
        assert_eq!(hydration["passageCount"], 1);
        assert_eq!(hydration["stories"][0]["passages"][0]["text"], "");
        assert!(hydration["baselineReceipt"].is_object());
        let retained: serde_json::Value = serde_json::from_str(
            &hydration_memory_diagnostics_json().expect("memory diagnostics should load"),
        )
        .expect("memory diagnostics should parse");
        assert_eq!(retained["activeLeaseCount"], 1);
        assert_eq!(retained["passageCount"], 1);
        assert!(retained["textLengthBytes"].as_u64().unwrap_or_default() > 0);

        let chunk = read_project_folder_hydration_chunk_json(hydration_id.into(), 0, 100)
            .expect("hydration chunk should load");
        let chunk: serde_json::Value =
            serde_json::from_str(&chunk).expect("hydration chunk should parse");
        assert_eq!(
            chunk["passages"][0]["passage"]["text"],
            "A very important passage body"
        );
        assert_eq!(chunk["done"], true);
        finish_project_folder_hydration(hydration_id.into()).expect("hydration should finish");
        assert!(read_project_folder_hydration_chunk_json(hydration_id.into(), 0, 1).is_err());
        let released: serde_json::Value = serde_json::from_str(
            &hydration_memory_diagnostics_json().expect("memory diagnostics should load"),
        )
        .expect("memory diagnostics should parse");
        assert_eq!(released["activeLeaseCount"], 0);
        assert_eq!(released["textLengthBytes"], 0);

        fs::remove_dir_all(root).expect("project should be removed");
    }

    #[test]
    fn renderer_sidecar_reader_handles_missing_malformed_oversize_and_io_errors() {
        let root = temp_path("sidecar-reader-policy");
        let sidecar_path = root.join(".twine/project.json");

        fs::create_dir_all(root.join(".twine")).expect("sidecar directory should be created");
        assert!(
            read_renderer_project_sidecar_stories(&root)
                .expect("missing sidecar should be empty")
                .is_empty()
        );

        fs::write(&sidecar_path, "{ malformed").expect("malformed sidecar fixture should write");
        assert!(
            read_renderer_project_sidecar_stories(&root)
                .expect("malformed sidecar should fall back")
                .is_empty()
        );

        fs::write(&sidecar_path, r#"{"stories":{"not":"an array"}}"#)
            .expect("invalid-shape sidecar fixture should write");
        assert!(
            read_renderer_project_sidecar_stories(&root)
                .expect("invalid sidecar shape should fall back")
                .is_empty()
        );

        fs::write(
            &sidecar_path,
            vec![b'x'; MAX_RENDERER_PROJECT_SIDECAR_BYTES + 1],
        )
        .expect("oversized sidecar fixture should write");
        let oversized = read_renderer_project_sidecar_stories(&root)
            .expect_err("oversized sidecar should be rejected");

        assert!(oversized.to_string().contains("exceeds"));

        fs::remove_file(&sidecar_path).expect("oversized sidecar should be removed");
        fs::create_dir(&sidecar_path).expect("sidecar path directory should be created");
        let io_error = read_renderer_project_sidecar_stories(&root)
            .expect_err("sidecar read errors should propagate");

        assert!(!io_error.to_string().is_empty());
        fs::remove_dir_all(root).expect("sidecar reader fixture should be removed");
    }

    #[test]
    fn native_sidecar_preflight_read_failures_leave_canonical_project_unchanged() {
        let root = temp_path("sidecar-read-no-mutation");
        let story = validation_story(false, "canonical body");

        create_project_folder_json(root.to_string_lossy().into_owned(), story.to_string(), None)
            .expect("validation project should be created");
        let manifest_before = fs::read(root.join("twine.toml")).expect("manifest should read");
        let passage_before = fs::read(root.join("passages/validation/0001-start.twee"))
            .expect("passage should read");
        let sidecar_path = root.join(".twine/project.json");
        let oversized_sidecar = vec![b'x'; MAX_RENDERER_PROJECT_SIDECAR_BYTES + 1];

        fs::write(&sidecar_path, &oversized_sidecar)
            .expect("oversized sidecar fixture should write");
        let mut changed_story = story.clone();
        changed_story["passages"][0]["text"] = serde_json::json!("must not commit");
        let oversized_error = save_project_folder_json(
            root.to_string_lossy().into_owned(),
            changed_story.to_string(),
            None,
        )
        .expect_err("oversized existing sidecar should fail before save");

        assert!(oversized_error.reason.contains("exceeds"));
        assert_eq!(fs::read(root.join("twine.toml")).unwrap(), manifest_before);
        assert_eq!(
            fs::read(root.join("passages/validation/0001-start.twee")).unwrap(),
            passage_before
        );
        assert_eq!(fs::read(&sidecar_path).unwrap(), oversized_sidecar);
        assert!(!project_backup_root(&root).exists());

        fs::remove_file(&sidecar_path).expect("oversized sidecar should be removed");
        fs::create_dir(&sidecar_path).expect("sidecar path directory should be created");
        let io_error = save_project_folder_json(
            root.to_string_lossy().into_owned(),
            changed_story.to_string(),
            None,
        )
        .expect_err("existing sidecar I/O error should fail before save");

        assert!(!io_error.reason.is_empty());
        assert_eq!(fs::read(root.join("twine.toml")).unwrap(), manifest_before);
        assert_eq!(
            fs::read(root.join("passages/validation/0001-start.twee")).unwrap(),
            passage_before
        );
        assert!(sidecar_path.is_dir());
        assert!(!project_backup_root(&root).exists());

        fs::remove_dir_all(root).expect("sidecar read failure project should be removed");
    }

    #[test]
    fn native_rejects_oversized_serialized_sidecar_before_save_or_reservation() {
        let root = temp_path("serialized-sidecar-no-mutation");
        let create_root = temp_path("serialized-sidecar-no-reservation");
        let story = validation_story(false, "canonical body");

        create_project_folder_json(root.to_string_lossy().into_owned(), story.to_string(), None)
            .expect("validation project should be created");
        let manifest_before = fs::read(root.join("twine.toml")).expect("manifest should read");
        let passage_before = fs::read(root.join("passages/validation/0001-start.twee"))
            .expect("passage should read");
        let sidecar_before =
            fs::read(root.join(".twine/project.json")).expect("sidecar should read");
        let mut oversized_story = story;

        oversized_story["editorState"] =
            serde_json::json!("x".repeat(MAX_RENDERER_PROJECT_SIDECAR_BYTES));
        let save_error = save_project_folder_json(
            root.to_string_lossy().into_owned(),
            oversized_story.to_string(),
            None,
        )
        .expect_err("oversized serialized sidecar should fail before save");

        assert!(save_error.reason.contains("output exceeds"));
        assert_eq!(fs::read(root.join("twine.toml")).unwrap(), manifest_before);
        assert_eq!(
            fs::read(root.join("passages/validation/0001-start.twee")).unwrap(),
            passage_before
        );
        assert_eq!(
            fs::read(root.join(".twine/project.json")).unwrap(),
            sidecar_before
        );
        assert!(!project_backup_root(&root).exists());

        let create_error = create_project_folder_json(
            create_root.to_string_lossy().into_owned(),
            oversized_story.to_string(),
            None,
        )
        .expect_err("oversized output should fail before reserving create root");

        assert!(create_error.reason.contains("output exceeds"));
        assert!(!create_root.exists());

        fs::remove_dir_all(root).expect("serialized-sidecar project should be removed");
    }

    #[test]
    fn native_sidecar_only_change_is_backed_up_and_swapped_atomically() {
        let root = temp_path("sidecar-only-transaction");
        let initial_story = validation_story(false, "unchanged body");

        create_project_folder_json(
            root.to_string_lossy().into_owned(),
            initial_story.to_string(),
            None,
        )
        .expect("sidecar-only project should be created");
        let manifest_before = fs::read(root.join("twine.toml")).expect("manifest should read");
        let mut changed_story = initial_story;

        changed_story["selected"] = serde_json::json!(true);
        changed_story["passages"][0]["selected"] = serde_json::json!(true);
        save_project_folder_json(
            root.to_string_lossy().into_owned(),
            changed_story.to_string(),
            None,
        )
        .expect("sidecar-only change should save");

        let backup_root = project_backup_root(&root);
        let backups = fs::read_dir(&backup_root)
            .expect("sidecar-only backup directory should exist")
            .map(|entry| entry.expect("backup entry").path())
            .collect::<Vec<_>>();

        assert_eq!(backups.len(), 1);
        let current_sidecar: serde_json::Value = serde_json::from_slice(
            &fs::read(root.join(".twine/project.json")).expect("current sidecar should read"),
        )
        .expect("current sidecar should parse");
        let backup_sidecar: serde_json::Value = serde_json::from_slice(
            &fs::read(backups[0].join(".twine/project.json")).expect("backup sidecar should read"),
        )
        .expect("backup sidecar should parse");

        assert_eq!(current_sidecar["stories"][0]["selected"], true);
        assert_eq!(
            current_sidecar["stories"][0]["passages"][0]["selected"],
            true
        );
        assert_eq!(backup_sidecar["stories"][0]["selected"], false);
        assert_eq!(
            fs::read(root.join("twine.toml")).expect("current manifest should read"),
            manifest_before
        );
        assert_eq!(
            fs::read(backups[0].join("twine.toml")).expect("backup manifest should read"),
            manifest_before
        );

        fs::remove_dir_all(root).expect("sidecar-only project should be removed");
        fs::remove_dir_all(backup_root).expect("sidecar-only backups should be removed");
    }

    #[test]
    fn guarded_full_save_preserves_an_external_edit_after_incremental_fallback() {
        let root = temp_path("guarded-full-save-conflict");
        let original_story = validation_story(false, "Original body");

        create_project_folder_json(
            root.to_string_lossy().into_owned(),
            original_story.to_string(),
            None,
        )
        .expect("guarded-save project should be created");

        // This is the trusted baseline retained when incremental CAS reports
        // that same-directory hard links are unavailable.
        let expected_files =
            project_file_manifest(&root, None).expect("project baseline should scan");
        let mut app_story = original_story;

        app_story["passages"][0]["text"] = serde_json::json!("App replacement");
        let passage_path = root.join("passages/validation/0001-start.twee");

        fs::write(&passage_path, "External edit")
            .expect("external passage edit should be injected");

        let error = save_project_folder_json_guarded(
            root.to_string_lossy().into_owned(),
            app_story.to_string(),
            None,
            serde_json::to_string(&expected_files).expect("baseline should serialize"),
        )
        .expect_err("guarded full save should reject the external edit");

        assert!(
            error
                .reason
                .contains("passages/validation/0001-start.twee changed outside twine.rs"),
            "unexpected guarded-save error: {}",
            error.reason
        );
        assert!(
            error
                .reason
                .contains(r#""stage":"native-baseline-compare""#),
            "guarded-save diagnostics should identify the native baseline stage: {}",
            error.reason
        );
        assert_eq!(
            fs::read_to_string(&passage_path).expect("external edit should remain readable"),
            "External edit"
        );

        fs::remove_dir_all(&root).expect("guarded-save project should be removed");
        let backup_root = project_backup_root(&root);
        if backup_root.exists() {
            fs::remove_dir_all(backup_root)
                .expect("empty guarded-save backup root should be removed");
        }
    }

    #[test]
    fn guarded_full_save_accepts_mtime_only_baseline_differences() {
        let root = temp_path("guarded-full-save-mtime-only");
        let original_story = validation_story(false, "Original body");

        create_project_folder_json(
            root.to_string_lossy().into_owned(),
            original_story.to_string(),
            None,
        )
        .expect("guarded-save project should be created");
        let mut expected_files =
            project_file_manifest(&root, None).expect("project baseline should scan");

        for file in &mut expected_files {
            file.fingerprint = format!("stale:{}", file.size_bytes);
            file.mtime_ms += 1.0;
        }
        let mut app_story = original_story;

        app_story["passages"][0]["text"] = serde_json::json!("App replacement");
        save_project_folder_json_guarded(
            root.to_string_lossy().into_owned(),
            app_story.to_string(),
            None,
            serde_json::to_string(&expected_files).expect("baseline should serialize"),
        )
        .expect("mtime-only baseline differences should not block a guarded save");

        assert!(
            fs::read_to_string(root.join("passages/validation/0001-start.twee"))
                .expect("saved passage should remain readable")
                .contains("App replacement")
        );

        fs::remove_dir_all(&root).expect("guarded-save project should be removed");
        let backup_root = project_backup_root(&root);
        if backup_root.exists() {
            fs::remove_dir_all(backup_root).expect("guarded-save backup root should be removed");
        }
    }

    #[test]
    fn native_save_selects_single_twee_on_creation_and_preserves_it() {
        let root = temp_path("save-single-project");
        let mut story = serde_json::json!({
            "ifid": "IFID",
            "id": "story-1",
            "name": "Native Single",
            "passages": [{
                "id": "passage-1",
                "name": "Start",
                "story": "story-1",
                "text": "Initial body"
            }],
            "script": "window.storyScript = true;",
            "startPassage": "passage-1",
            "storyFormat": "Harlowe",
            "storyFormatVersion": "3.3.9",
            "stylesheet": "body { color: black; }"
        });

        create_project_folder_json(
            root.to_string_lossy().into_owned(),
            story.to_string(),
            Some("single-twee".into()),
        )
        .expect("single-twee native project should save");

        assert!(root.join("story.twee").exists());
        assert!(!root.join("passages").exists());
        assert!(
            fs::read_to_string(root.join("story.twee"))
                .expect("aggregate source")
                .contains(":: StoryData")
        );
        assert_eq!(
            fs::read_to_string(root.join("scripts/native-single.js")).expect("external script"),
            "window.storyScript = true;"
        );
        assert_eq!(
            fs::read_to_string(root.join("styles/native-single.css")).expect("external stylesheet"),
            "body { color: black; }"
        );

        story["passages"][0]["text"] = serde_json::Value::String("Second body".into());
        save_project_folder_json(root.to_string_lossy().into_owned(), story.to_string(), None)
            .expect("subsequent native save should preserve layout");
        let manifest = fs::read_to_string(root.join("twine.toml")).expect("manifest");

        assert!(manifest.contains("source_layout = \"single-twee\""));
        assert!(manifest.contains("source = \"story.twee\""));
        assert!(!root.join("passages").exists());
        assert!(
            fs::read_to_string(root.join("story.twee"))
                .expect("resaved source")
                .contains("Second body")
        );

        let files = project_file_manifest(&root, None).expect("project file manifest");

        assert!(
            files
                .iter()
                .any(|file| file.path == "story.twee" && file.kind == "passage")
        );

        fs::remove_dir_all(root).expect("native single project should be removed");
    }

    #[test]
    fn native_save_merges_target_and_preserves_sibling_project_metadata_and_backup() {
        let root = temp_path("save-multi-story-merge");
        let first_value = serde_json::json!({
            "color": "red",
            "ifid": "FIRST-IFID",
            "id": "first-story",
            "lastUpdate": "2026-01-01T00:00:00Z",
            "name": "First Story",
            "passages": [{
                "height": 110,
                "id": "first-passage",
                "left": 20,
                "name": "First Start",
                "story": "first-story",
                "text": "First original body",
                "top": 30,
                "width": 120
            }],
            "script": "window.firstOriginal = true;",
            "startPassage": "first-passage",
            "stylesheet": ".first { color: red; }"
        });
        let second_value = serde_json::json!({
            "color": "green",
            "ifid": "SECOND-IFID",
            "id": "second-story",
            "lastUpdate": "2026-01-02T00:00:00Z",
            "name": "Second Story",
            "passages": [{
                "height": 130,
                "id": "first-passage",
                "left": 80,
                "name": "Second Start",
                "story": "second-story",
                "text": "Second sibling body",
                "top": 90,
                "width": 140
            }],
            "script": "window.secondSibling = true;",
            "startPassage": "first-passage",
            "stylesheet": ".second { color: green; }"
        });
        let first: Story =
            serde_json::from_value(first_value.clone()).expect("first story should deserialize");
        let second: Story =
            serde_json::from_value(second_value.clone()).expect("second story should deserialize");
        let mut project = Project::from_story(first.clone());

        project.stories.push(second.clone());
        project.library.sort_order.push(second.id.clone());
        project
            .library
            .colors
            .insert(second.id.clone(), "green".into());
        project
            .library
            .metadata
            .insert("library-mode".into(), serde_json::json!("manual"));
        project
            .layout
            .passages
            .append(Project::from_story(second.clone()).layout.passages);
        let mut first_layout = project
            .layout
            .passages
            .get(&first.id, &first.passages[0].id)
            .cloned()
            .expect("first story layout");

        first_layout.group = Some("opening".into());
        first_layout
            .metadata
            .insert("locked".into(), serde_json::json!(true));
        project.layout.passages.insert(
            first.id.clone(),
            first.passages[0].id.clone(),
            first_layout,
        );
        project
            .layout
            .metadata
            .insert("viewport".into(), serde_json::json!({"x": 17}));
        project.layout.annotations.insert(
            "note-1".into(),
            twine_model::GraphAnnotation {
                id: "note-1".into(),
                text: "Preserve this project annotation".into(),
                ..twine_model::GraphAnnotation::default()
            },
        );
        project.manifest.app_version = "existing-app".into();
        project.manifest.name = "Existing Project Name".into();
        project.manifest.storage.max_backups = 3;
        project.manifest.storage.message = "existing storage message".into();
        project
            .manifest
            .set_source_layout(second.id.clone(), ProjectSourceLayout::SingleTwee);

        save_project_path(
            &root,
            &project,
            &SaveOptions {
                create_backup: false,
                max_backups: 0,
                write_generated_indexes: true,
            },
        )
        .expect("two-story fixture should save");
        let sidecar_stories = vec![
            renderer_project_metadata(first_value.clone()),
            renderer_project_metadata(serde_json::json!({
                "editorPane": "right",
                "id": "second-story",
                "name": "Second Story",
                "passages": [{
                    "highlighted": true,
                    "id": "first-passage",
                    "selected": true,
                    "text": "must not persist"
                }],
                "selected": true
            })),
        ];
        fs::write(
            root.join(".twine/project.json"),
            renderer_project_sidecar_bytes(&sidecar_stories)
                .expect("initial sidecar should serialize"),
        )
        .expect("initial sidecar should save");

        let incoming = serde_json::json!({
            "color": "blue",
            "ifid": "FIRST-IFID",
            "id": "first-story",
            "lastUpdate": "2026-07-22T00:00:00Z",
            "name": "First Story Renamed",
            "passages": [{
                "height": 160,
                "highlighted": true,
                "id": "first-passage",
                "left": 200,
                "name": "First Start Renamed",
                "selected": true,
                "story": "first-story",
                "text": "First updated body",
                "top": 210,
                "width": 170
            }],
            "script": "window.firstUpdated = true;",
            "selected": true,
            "startPassage": "first-passage",
            "stylesheet": ".first { color: blue; }"
        });
        let result = save_project_folder_json(
            root.to_string_lossy().into_owned(),
            incoming.to_string(),
            Some("single-twee".into()),
        )
        .expect("target story should merge into existing project");
        let result: NativeProjectFolderResult =
            serde_json::from_str(&result).expect("save result should parse");

        assert_eq!(result.story_ids, ["first-story", "second-story"]);
        assert_eq!(result.stories.len(), 2);
        assert!(result.stories[0].selected);
        assert!(result.stories[0].passages[0].selected);
        assert!(result.stories[0].passages[0].highlighted);
        assert!(result.stories[1].selected);
        assert!(result.stories[1].passages[0].selected);
        assert!(result.stories[1].passages[0].highlighted);
        assert_eq!(result.stories[1].passages[0].text, "Second sibling body");

        let loaded = load_project_path_with_options(&root, LoadProjectOptions::full())
            .expect("merged project should load");

        assert_eq!(loaded.stories.len(), 2);
        assert_eq!(loaded.stories[0].name, "First Story Renamed");
        assert_eq!(loaded.stories[0].passages[0].text, "First updated body");
        assert_eq!(loaded.stories[0].script, "window.firstUpdated = true;");
        assert_eq!(loaded.stories[0].stylesheet, ".first { color: blue; }");
        assert_eq!(loaded.stories[1].name, "Second Story");
        assert_eq!(loaded.stories[1].passages[0].text, "Second sibling body");
        assert_eq!(loaded.stories[1].script, "window.secondSibling = true;");
        assert_eq!(loaded.stories[1].stylesheet, ".second { color: green; }");
        assert_eq!(loaded.manifest.name, "Existing Project Name");
        assert_eq!(loaded.manifest.app_version, "existing-app");
        assert_eq!(loaded.manifest.storage.max_backups, 3);
        assert_eq!(loaded.manifest.storage.message, "existing storage message");
        assert_eq!(
            loaded.manifest.source_layout_for(&first.id),
            ProjectSourceLayout::PassageFiles
        );
        assert_eq!(
            loaded.manifest.source_layout_for(&second.id),
            ProjectSourceLayout::SingleTwee
        );
        assert_eq!(
            loaded.library.sort_order,
            [first.id.clone(), second.id.clone()]
        );
        assert_eq!(loaded.library.colors[&first.id], "blue");
        assert_eq!(loaded.library.colors[&second.id], "green");
        assert_eq!(loaded.library.metadata["library-mode"], "manual");
        assert_eq!(loaded.layout.metadata["viewport"]["x"], 17);
        assert_eq!(
            loaded.layout.annotations["note-1"].text,
            "Preserve this project annotation"
        );
        assert_eq!(
            loaded
                .layout
                .passages
                .get(&second.id, &second.passages[0].id)
                .expect("second story layout")
                .bounds
                .left,
            80.0
        );
        assert_eq!(
            loaded
                .layout
                .passages
                .get(&first.id, &first.passages[0].id)
                .expect("first story layout")
                .bounds
                .left,
            200.0
        );
        let first_layout = loaded
            .layout
            .passages
            .get(&first.id, &first.passages[0].id)
            .expect("first story layout metadata");

        assert_eq!(first_layout.group.as_deref(), Some("opening"));
        assert_eq!(
            first_layout.metadata.get("locked"),
            Some(&serde_json::json!(true))
        );
        assert_eq!(
            fs::read_to_string(root.join("passages/first-story/0001-first-start-renamed.twee"))
                .expect("renamed target passage should use its existing story directory"),
            "First updated body"
        );
        assert!(
            fs::read_to_string(root.join("story.twee"))
                .expect("sibling single-twee source should remain")
                .contains("Second sibling body")
        );

        let sidecar: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(root.join(".twine/project.json"))
                .expect("merged sidecar should read"),
        )
        .expect("merged sidecar should parse");

        assert_eq!(sidecar["stories"].as_array().map(Vec::len), Some(2));
        assert_eq!(sidecar["stories"][0]["selected"], true);
        assert_eq!(sidecar["stories"][0]["passages"][0]["highlighted"], true);
        assert_eq!(sidecar["stories"][1]["editorPane"], "right");
        assert_eq!(sidecar["stories"][1]["selected"], true);
        assert!(sidecar["stories"][0]["passages"][0].get("text").is_none());
        assert!(sidecar["stories"][1]["passages"][0].get("text").is_none());

        let backup_root = root.parent().expect("project parent").join(format!(
            ".{}.backups",
            root.file_name()
                .expect("project file name")
                .to_string_lossy()
        ));
        let backups = fs::read_dir(&backup_root)
            .expect("backup directory should exist")
            .map(|entry| entry.expect("backup entry").path())
            .collect::<Vec<_>>();

        assert_eq!(backups.len(), 1);
        assert!(
            fs::read_to_string(backups[0].join("twine.toml"))
                .expect("backup manifest should read")
                .contains("name = \"First Story\"")
        );
        assert_eq!(
            fs::read_to_string(backups[0].join("passages/first-story/0001-first-start.twee"))
                .expect("backup target passage should read"),
            "First original body"
        );
        assert_eq!(
            fs::read_to_string(backups[0].join("scripts/second-story.js"))
                .expect("backup sibling script should read"),
            "window.secondSibling = true;"
        );
        assert!(
            fs::read_to_string(backups[0].join(".twine/project.json"))
                .expect("backup sidecar should read")
                .contains("editorPane")
        );

        fs::remove_dir_all(root).expect("merged project should be removed");
        fs::remove_dir_all(backup_root).expect("merged project backups should be removed");
    }

    #[test]
    fn native_save_recovers_corrupt_sidecar_with_slim_model_fallbacks() {
        let root = temp_path("save-corrupt-sidecar");
        let first_value = serde_json::json!({
            "ifid": "FIRST-IFID",
            "id": "first-story",
            "name": "First",
            "passages": [{
                "id": "first-passage",
                "name": "Start",
                "story": "first-story",
                "text": "first original"
            }],
            "startPassage": "first-passage"
        });
        let second_value = serde_json::json!({
            "ifid": "SECOND-IFID",
            "id": "second-story",
            "name": "Second",
            "passages": [{
                "id": "second-passage",
                "name": "Start",
                "story": "second-story",
                "text": "second body"
            }],
            "script": "second script",
            "startPassage": "second-passage",
            "stylesheet": "second style"
        });
        let first: Story =
            serde_json::from_value(first_value.clone()).expect("first story should deserialize");
        let second: Story =
            serde_json::from_value(second_value).expect("second story should deserialize");
        let mut project = Project::from_story(first);

        project.stories.push(second);
        save_project_path(
            &root,
            &project,
            &SaveOptions {
                create_backup: false,
                max_backups: 0,
                write_generated_indexes: true,
            },
        )
        .expect("corrupt-sidecar fixture should save");
        fs::write(root.join(".twine/project.json"), "{ definitely not json")
            .expect("sidecar should be corrupted");

        let mut incoming = first_value;
        incoming["passages"][0]["text"] = serde_json::json!("first updated");
        save_project_folder_json(
            root.to_string_lossy().into_owned(),
            incoming.to_string(),
            None,
        )
        .expect("corrupt metadata must not block canonical save");

        let loaded = load_project_path_with_options(&root, LoadProjectOptions::full())
            .expect("canonical project should remain readable");

        assert_eq!(loaded.stories.len(), 2);
        assert_eq!(loaded.stories[0].passages[0].text, "first updated");
        assert_eq!(loaded.stories[1].passages[0].text, "second body");
        assert_eq!(loaded.stories[1].script, "second script");
        assert_eq!(loaded.stories[1].stylesheet, "second style");

        let sidecar: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(root.join(".twine/project.json"))
                .expect("recovered sidecar should read"),
        )
        .expect("recovered sidecar should parse");

        assert_eq!(sidecar["stories"].as_array().map(Vec::len), Some(2));
        assert_eq!(sidecar["stories"][0]["id"], "first-story");
        assert_eq!(sidecar["stories"][1]["id"], "second-story");
        assert!(sidecar["stories"][0]["passages"][0].get("text").is_none());
        assert!(sidecar["stories"][1]["passages"][0].get("text").is_none());

        let backup_root = root.parent().expect("project parent").join(format!(
            ".{}.backups",
            root.file_name()
                .expect("project file name")
                .to_string_lossy()
        ));
        fs::remove_dir_all(root).expect("corrupt-sidecar project should be removed");
        fs::remove_dir_all(backup_root).expect("corrupt-sidecar backups should be removed");
    }

    #[test]
    fn native_save_honors_explicit_layout_when_existing_folder_has_another_story() {
        let root = temp_path("save-layout-name-collision");
        let original = serde_json::json!({
            "ifid": "OLD-IFID",
            "id": "old-story",
            "name": "Colliding Name",
            "passages": [{
                "id": "old-passage",
                "name": "Start",
                "story": "old-story",
                "text": "Old body"
            }],
            "startPassage": "old-passage"
        });

        create_project_folder_json(
            root.to_string_lossy().into_owned(),
            original.to_string(),
            Some("passage-files".into()),
        )
        .expect("initial passage-files project should save");

        let replacement = serde_json::json!({
            "ifid": "NEW-IFID",
            "id": "new-story",
            "name": "Colliding Name",
            "passages": [{
                "id": "new-passage",
                "name": "Start",
                "story": "new-story",
                "text": "New body"
            }],
            "startPassage": "new-passage"
        });

        let result = save_project_folder_json(
            root.to_string_lossy().into_owned(),
            replacement.to_string(),
            Some("single-twee".into()),
        )
        .expect("explicit single layout should win for a new colliding story");
        let result: NativeProjectFolderResult =
            serde_json::from_str(&result).expect("save result should parse");

        let manifest = fs::read_to_string(root.join("twine.toml")).expect("manifest");

        assert_eq!(result.story_ids, ["old-story", "new-story"]);
        assert_eq!(result.stories.len(), 2);
        assert!(manifest.contains("id = \"old-story\""));
        assert!(manifest.contains("id = \"new-story\""));
        assert!(manifest.contains("source_layout = \"single-twee\""));
        assert!(manifest.contains("source = \"story.twee\""));
        assert!(root.join("story.twee").exists());
        assert_eq!(
            fs::read_to_string(root.join("passages/colliding-name/0001-start.twee"))
                .expect("original passage should survive append"),
            "Old body"
        );

        fs::remove_dir_all(root).expect("collision project should be removed");
    }

    #[test]
    fn remembers_project_folders_in_native_library_index() {
        let root = temp_path("project-library-index");
        let index_path = root.join(".twine/native-projects.json");
        let first_project = serde_json::json!({
            "passageTextLoaded": true,
            "rootPath": "/projects/b.twine.rs",
            "stories": [],
            "storyIds": ["story-b"]
        });
        let second_project = serde_json::json!({
            "passageTextLoaded": true,
            "rootPath": "/projects/a.twine.rs",
            "stories": [],
            "storyIds": ["story-a"]
        });
        let updated_first_project = serde_json::json!({
            "passageTextLoaded": true,
            "rootPath": "/projects/b.twine.rs",
            "stories": [],
            "storyIds": ["story-b2"]
        });

        remember_project_folder_json(
            index_path.to_string_lossy().into_owned(),
            first_project.to_string(),
        )
        .expect("first project should be remembered");
        remember_project_folder_json(
            index_path.to_string_lossy().into_owned(),
            second_project.to_string(),
        )
        .expect("second project should be remembered");
        remember_project_folder_json(
            index_path.to_string_lossy().into_owned(),
            updated_first_project.to_string(),
        )
        .expect("project should be updated");

        let listed =
            list_remembered_project_folders_json(index_path.to_string_lossy().into_owned())
                .expect("remembered project list should load");
        let listed: Vec<NativeRememberedProjectFolder> =
            serde_json::from_str(&listed).expect("remembered project list should parse");

        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].root_path, "/projects/a.twine.rs");
        assert_eq!(listed[1].root_path, "/projects/b.twine.rs");
        assert_eq!(listed[1].story_ids, vec!["story-b2"]);

        let listed = forget_project_folder_json(
            index_path.to_string_lossy().into_owned(),
            "/projects/a.twine.rs".into(),
        )
        .expect("project should be forgotten");
        let listed: Vec<NativeRememberedProjectFolder> =
            serde_json::from_str(&listed).expect("remembered project list should parse");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].root_path, "/projects/b.twine.rs");

        fs::remove_dir_all(root).expect("index root should be removed");
    }

    #[test]
    fn bounded_html_reader_accepts_the_boundary_and_rejects_growth() {
        let root = temp_path("bounded-html-import");
        let html_path = root.join("story.html");

        fs::create_dir_all(&root).expect("bounded-reader root should be created");
        fs::write(&html_path, b"12345678").expect("boundary source should be written");

        assert_eq!(
            read_bounded_utf8_file(&html_path, 8, "Test import")
                .expect("boundary source should be accepted"),
            "12345678"
        );

        fs::write(&html_path, b"123456789").expect("oversized source should be written");
        let error = read_bounded_utf8_file(&html_path, 8, "Test import")
            .expect_err("oversized source should be rejected");

        assert!(error.to_string().contains("exceeds"));
        fs::remove_dir_all(root).expect("bounded-reader root should be removed");
    }

    #[test]
    fn html_discovery_skips_oversized_nonselected_candidates() {
        let root = temp_path("bounded-html-discovery");
        let valid_path = root.join("story.html");
        let oversized_path = root.join("decoy.html");

        fs::create_dir_all(&root).expect("discovery root should be created");
        fs::write(&valid_path, b"<tw-storydata name=\"Story\"></tw-storydata>")
            .expect("valid candidate should be written");
        File::create(&oversized_path)
            .expect("oversized candidate should be created")
            .set_len(MAX_IMPORT_SOURCE_BYTES + 1)
            .expect("oversized candidate should be sparse");

        let files = find_twine_html_files(&root).expect("discovery should remain bounded");

        assert_eq!(files, vec![valid_path.to_string_lossy().into_owned()]);
        fs::remove_dir_all(root).expect("discovery root should be removed");
    }

    #[test]
    fn zip_extraction_enforces_size_count_depth_and_ratio_quotas() {
        let root = temp_path("zip-import-quotas");
        let zip_path = root.join("quota.zip");
        let extract_path = root.join("extract");

        fs::create_dir_all(&root).expect("quota root should be created");
        write_test_zip(
            &zip_path,
            &[("a/b/story.html", b"1234"), ("asset.bin", b"5678")],
            zip::CompressionMethod::Stored,
        );
        let archive_bytes = fs::metadata(&zip_path)
            .expect("quota zip metadata should load")
            .len();
        let mut limits = permissive_test_zip_limits();

        limits.max_archive_bytes = archive_bytes;
        limits.max_entries = 2;
        limits.max_entry_bytes = 4;
        limits.max_expanded_bytes = 8;
        limits.max_nesting_depth = 3;
        limits.max_compression_ratio = 1;
        extract_zip_archive_with_limits(&zip_path, &extract_path, limits)
            .expect("exact quota boundaries should be accepted");
        fs::remove_dir_all(&extract_path).expect("boundary extraction should be removed");

        for (label, restrictive_limits, expected) in [
            (
                "archive",
                ZipImportLimits {
                    max_archive_bytes: archive_bytes - 1,
                    ..limits
                },
                "compressed-size limit",
            ),
            (
                "entries",
                ZipImportLimits {
                    max_entries: 1,
                    ..limits
                },
                "more than 1 entries",
            ),
            (
                "entry-size",
                ZipImportLimits {
                    max_entry_bytes: 3,
                    ..limits
                },
                "entry exceeds",
            ),
            (
                "expanded-total",
                ZipImportLimits {
                    max_expanded_bytes: 7,
                    ..limits
                },
                "cumulative expanded-size limit",
            ),
            (
                "depth",
                ZipImportLimits {
                    max_nesting_depth: 2,
                    ..limits
                },
                "nesting exceeds 2",
            ),
        ] {
            let error = extract_zip_archive_with_limits(
                &zip_path,
                &root.join(format!("extract-{label}")),
                restrictive_limits,
            )
            .expect_err("restrictive quota should reject the archive");

            assert!(
                error.to_string().contains(expected),
                "unexpected {label} quota error: {error}"
            );
        }

        let ratio_zip_path = root.join("ratio.zip");
        let compressible = vec![b'x'; 4096];

        write_test_zip(
            &ratio_zip_path,
            &[("story.html", compressible.as_slice())],
            zip::CompressionMethod::Deflated,
        );
        let ratio_error = extract_zip_archive_with_limits(
            &ratio_zip_path,
            &root.join("extract-ratio"),
            ZipImportLimits {
                max_compression_ratio: 1,
                ..permissive_test_zip_limits()
            },
        )
        .expect_err("excessive compression ratio should be rejected");

        assert!(ratio_error.to_string().contains("compression-ratio limit"));
        fs::remove_dir_all(root).expect("quota root should be removed");
    }

    #[test]
    fn failed_zip_preparation_removes_partial_extraction() {
        let root = temp_path("zip-import-cleanup");
        let zip_path = root.join("cleanup.zip");
        let cleanup_path = root.join("partial");

        fs::create_dir_all(&root).expect("cleanup root should be created");
        write_test_zip(
            &zip_path,
            &[("story.html", b"12345")],
            zip::CompressionMethod::Stored,
        );
        let error = prepare_zip_import_at(
            &zip_path,
            cleanup_path.clone(),
            ZipImportLimits {
                max_entry_bytes: 4,
                ..permissive_test_zip_limits()
            },
        )
        .expect_err("failed preparation should return its quota error");

        assert!(error.to_string().contains("entry exceeds"));
        assert!(!cleanup_path.exists());
        fs::remove_dir_all(root).expect("cleanup root should be removed");
    }

    #[test]
    fn prepares_zip_import_with_rewritten_assets() {
        let root = temp_path("zip-import");
        let zip_path = root.join("Archive Story.zip");

        fs::create_dir_all(&root).expect("temp root should be created");

        let zip_file = File::create(&zip_path).expect("zip should be created");
        let mut zip = zip::ZipWriter::new(zip_file);
        let options = zip::write::SimpleFileOptions::default();

        zip.start_file("Archive Story.html", options)
            .expect("html entry should start");
        zip.write_all(
            br#"<tw-storydata name="Archive Story" hidden><tw-passagedata pid="1" name="Start">images/cover.png</tw-passagedata></tw-storydata>"#,
        )
        .expect("html should write");
        zip.start_file("images/cover.png", options)
            .expect("asset entry should start");
        zip.write_all(b"cover").expect("asset should write");
        zip.finish().expect("zip should finish");

        let prepared = prepare_project_import_json(zip_path.to_string_lossy().into_owned())
            .expect("zip import should prepare");
        let prepared: serde_json::Value =
            serde_json::from_str(&prepared).expect("prepared import should parse");
        let cleanup_path = prepared
            .get("cleanupPath")
            .and_then(serde_json::Value::as_str)
            .expect("zip import should return cleanup path")
            .to_owned();

        assert_eq!(prepared["sourceKind"], "zip");
        assert_eq!(
            prepared["assets"][0]["targetPath"],
            "assets/images/cover.png"
        );
        assert!(
            prepared["htmlSource"]
                .as_str()
                .expect("html source should be a string")
                .contains("assets/images/cover.png")
        );

        fs::remove_dir_all(cleanup_path).expect("cleanup path should be removed");
        fs::remove_dir_all(root).expect("temp root should be removed");
    }

    #[test]
    fn manifest_diff_reports_add_modify_remove() {
        let previous = vec![
            NativeProjectFileEntry {
                content_digest: None,
                fingerprint: "1:10".into(),
                kind: "manifest".into(),
                modified_at: "2026-01-01T00:00:00Z".into(),
                mtime_ms: 1.0,
                path: "twine.toml".into(),
                size_bytes: 10,
            },
            NativeProjectFileEntry {
                content_digest: None,
                fingerprint: "1:20".into(),
                kind: "asset".into(),
                modified_at: "2026-01-01T00:00:00Z".into(),
                mtime_ms: 1.0,
                path: "assets/old.png".into(),
                size_bytes: 20,
            },
        ];
        let current = vec![
            NativeProjectFileEntry {
                content_digest: None,
                fingerprint: "2:10".into(),
                kind: "manifest".into(),
                modified_at: "2026-01-01T00:00:01Z".into(),
                mtime_ms: 2.0,
                path: "twine.toml".into(),
                size_bytes: 10,
            },
            NativeProjectFileEntry {
                content_digest: None,
                fingerprint: "1:30".into(),
                kind: "asset".into(),
                modified_at: "2026-01-01T00:00:00Z".into(),
                mtime_ms: 1.0,
                path: "assets/new.png".into(),
                size_bytes: 30,
            },
        ];

        let changes = project_session_conflicts(&previous, &current)
            .into_iter()
            .map(|conflict| conflict.change)
            .collect::<BTreeSet<_>>();

        assert_eq!(
            changes,
            BTreeSet::from(["added".into(), "modified".into(), "removed".into()])
        );
    }

    #[test]
    fn source_entries_match_by_size_and_digest_while_assets_use_fingerprints() {
        let source = NativeProjectFileEntry {
            content_digest: Some("a".repeat(64)),
            fingerprint: "1:5".into(),
            kind: "passage".into(),
            modified_at: "2026-07-29T20:51:35.001Z".into(),
            mtime_ms: 1.0,
            path: "passages/story/start.twee".into(),
            size_bytes: 5,
        };
        let asset = NativeProjectFileEntry {
            content_digest: None,
            fingerprint: "1:5".into(),
            kind: "asset".into(),
            modified_at: "2026-07-29T20:51:35.001Z".into(),
            mtime_ms: 1.0,
            path: "assets/image.png".into(),
            size_bytes: 5,
        };

        assert!(project_file_entries_match(
            &source,
            &NativeProjectFileEntry {
                fingerprint: "2:5".into(),
                ..source.clone()
            }
        ));
        assert!(!project_file_entries_match(
            &source,
            &NativeProjectFileEntry {
                content_digest: Some("b".repeat(64)),
                ..source.clone()
            }
        ));
        assert!(!project_file_entries_match(
            &source,
            &NativeProjectFileEntry {
                size_bytes: 6,
                ..source.clone()
            }
        ));
        assert!(!project_file_entries_match(
            &source,
            &NativeProjectFileEntry {
                content_digest: None,
                ..source.clone()
            }
        ));
        assert!(!project_file_entries_match(
            &NativeProjectFileEntry {
                content_digest: None,
                ..source.clone()
            },
            &source
        ));
        assert!(project_file_entries_match(&asset, &asset));
        assert!(!project_file_entries_match(
            &asset,
            &NativeProjectFileEntry {
                fingerprint: "2:5".into(),
                ..asset.clone()
            }
        ));
    }

    #[test]
    fn manifest_diff_reports_same_size_rewrite_with_restored_mtime() {
        let root = temp_path("manifest-content-digest-rewrite");
        let passage = root.join("passages/story/start.twee");

        fs::create_dir_all(passage.parent().expect("passage parent")).expect("passage directory");
        fs::write(root.join("twine.toml"), "version = 1\n").expect("project manifest");
        fs::write(&passage, b"Synthetic").expect("initial passage");
        let initial_mtime = fs::metadata(&passage)
            .and_then(|metadata| metadata.modified())
            .expect("initial passage mtime");
        let previous = project_file_manifest(&root, None).expect("initial manifest");

        fs::write(&passage, b"SynthetiX").expect("rewritten passage");
        fs::OpenOptions::new()
            .write(true)
            .open(&passage)
            .expect("rewritten passage handle")
            .set_times(fs::FileTimes::new().set_modified(initial_mtime))
            .expect("restore passage mtime");

        let current = project_file_manifest(&root, None).expect("current manifest");
        let previous_passage = previous
            .iter()
            .find(|file| file.path == "passages/story/start.twee")
            .expect("previous passage entry");
        let current_passage = current
            .iter()
            .find(|file| file.path == "passages/story/start.twee")
            .expect("current passage entry");

        assert_eq!(previous_passage.fingerprint, current_passage.fingerprint);
        assert_ne!(
            previous_passage.content_digest,
            current_passage.content_digest
        );
        assert!(
            project_session_conflicts(&previous, &current)
                .iter()
                .any(|conflict| conflict.path == "passages/story/start.twee"
                    && conflict.change == "modified")
        );

        fs::remove_dir_all(root).expect("project cleanup");
    }
}
