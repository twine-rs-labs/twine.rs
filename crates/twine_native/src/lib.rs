#![doc = "Native Node/Electron bridge for project-folder I/O and inventory scans."]

use napi::{
    Env, Status, Task,
    bindgen_prelude::{AsyncTask, Buffer},
};
use napi_derive::napi;
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
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
use twine_model::{GraphPosition, Passage, Project, ProjectSourceLayout, StoragePolicy, Story};
use twine_store::{
    LoadProjectOptions, LoadedProjectFile, SaveOptions, load_project_path_with_options,
    load_project_path_with_receipt, save_project_path,
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
const NATIVE_ASSET_MAX_REQUEST_COUNT: usize = 100;
const NATIVE_ASSET_MAX_PATH_BYTES: usize = 4096;

type NativeResult<T> = napi::Result<T>;

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
pub fn hydration_memory_diagnostics_json() -> NativeResult<String> {
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
    pub path: String,
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
) -> NativeResult<String> {
    json_string(&load_project_folder(root_path, load_profile)?).map_err(native_error)
}

fn load_project_folder(
    root_path: String,
    load_profile: Option<String>,
) -> NativeResult<NativeProjectFolderResult> {
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
) -> NativeResult<String> {
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
) -> NativeResult<String> {
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
pub fn finish_project_folder_hydration(hydration_id: String) -> NativeResult<()> {
    hydration_leases()
        .lock()
        .map_err(|_| napi::Error::from_reason("Native hydration lease lock was poisoned."))?
        .remove(&hydration_id);
    Ok(())
}

fn parse_project_source_layout(source_layout: &str) -> NativeResult<ProjectSourceLayout> {
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
) -> NativeResult<String> {
    let total_started = Instant::now();
    let mut timings = NativeProjectSaveTimings::default();
    let root = PathBuf::from(&root_path);
    let started = Instant::now();
    let story_value =
        serde_json::from_str::<serde_json::Value>(&story_json).map_err(native_error)?;
    let story = serde_json::from_value::<Story>(story_value.clone()).map_err(native_error)?;
    timings.json_parse_us = elapsed_us(started);
    let started = Instant::now();
    let mut project = Project::from_story(story.clone());

    project.manifest.app_version = "twine.rs-desktop".into();
    project.manifest.storage = StoragePolicy {
        message: "Native twine.rs desktop project folder".into(),
        ..StoragePolicy::default()
    };
    if root.join("twine.toml").exists() {
        let existing = load_project_path_with_options(&root, LoadProjectOptions::shell())
            .map_err(native_error)?;
        if existing
            .stories
            .iter()
            .any(|existing_story| existing_story.id == story.id)
        {
            let existing_layout = existing.manifest.source_layout_for(&story.id);

            project
                .manifest
                .set_source_layout(story.id.clone(), existing_layout);
        } else if let Some(source_layout) = source_layout.as_deref() {
            let source_layout = parse_project_source_layout(source_layout)?;

            project
                .manifest
                .set_source_layout(story.id.clone(), source_layout);
        }
    } else if let Some(source_layout) = source_layout.as_deref() {
        let source_layout = parse_project_source_layout(source_layout)?;

        project
            .manifest
            .set_source_layout(story.id.clone(), source_layout);
    }
    timings.project_build_us = elapsed_us(started);

    let started = Instant::now();
    let save_report = save_project_path(
        &root,
        &project,
        &SaveOptions {
            create_backup: false,
            max_backups: project.manifest.storage.max_backups,
            write_generated_indexes: true,
        },
    )
    .map_err(native_error)?;
    timings.save_project_path_us = elapsed_us(started);
    timings.changed_file_plan_us = save_report.timings.changed_file_plan_us;
    timings.collect_new_files_us = save_report.timings.collect_new_files_us;
    timings.collect_old_files_us = save_report.timings.collect_old_files_us;
    timings.copy_assets_us = save_report.timings.copy_assets_us;
    timings.dirty_compare_us = save_report.timings.dirty_compare_us;
    timings.root_swap_us = save_report.timings.root_swap_us;
    timings.write_temp_project_us = save_report.timings.write_temp_project_us;
    let started = Instant::now();
    write_renderer_project_sidecar(&root, story_value).map_err(native_error)?;
    timings.sidecar_us = elapsed_us(started);
    timings.total_us = elapsed_us(total_started);

    json_string(&NativeProjectFolderResult {
        baseline_receipt: None,
        graph_layout_loaded: true,
        passage_text_loaded: true,
        load_performance_timings: None,
        performance_timings: performance_timings(timings),
        root_path,
        story_sources_loaded: true,
        stories: vec![NativeStory::from_story(&story)],
        story_ids: vec![story.id.as_ref().to_owned()],
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
) -> NativeResult<String> {
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
pub fn forget_project_folder_json(index_path: String, root_path: String) -> NativeResult<String> {
    let index_path = PathBuf::from(index_path);
    let mut index = read_project_library_index(&index_path).map_err(native_error)?;

    index
        .projects
        .retain(|project| project.root_path != root_path);
    write_project_library_index(&index_path, &index).map_err(native_error)?;

    json_string(&index.projects).map_err(native_error)
}

#[napi(js_name = "listRememberedProjectFoldersJson")]
pub fn list_remembered_project_folders_json(index_path: String) -> NativeResult<String> {
    let index = read_project_library_index(Path::new(&index_path)).map_err(native_error)?;

    json_string(&index.projects).map_err(native_error)
}

#[napi(js_name = "listProjectAssetsJson")]
pub fn list_project_assets_json(root_path: String) -> NativeResult<String> {
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
        root_path,
        requests,
        max_file_encoded_bytes,
        max_file_count,
        max_total_encoded_bytes,
    })
}

pub struct ReadProjectAssetPayloadsTask {
    root_path: String,
    requests: Vec<NativeProjectAssetReadRequest>,
    max_file_encoded_bytes: u32,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
}

impl Task for ReadProjectAssetPayloadsTask {
    type Output = NativeProjectAssetPayloadBatch;
    type JsValue = NativeProjectAssetPayloadBatch;

    fn compute(&mut self) -> NativeResult<Self::Output> {
        read_project_asset_payload_requests_impl(
            Path::new(&self.root_path),
            std::mem::take(&mut self.requests),
            self.max_file_encoded_bytes,
            self.max_file_count,
            self.max_total_encoded_bytes,
        )
        .map_err(|message| napi::Error::new(Status::InvalidArg, message))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> NativeResult<Self::JsValue> {
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
                path,
            })
            .collect(),
        max_file_encoded_bytes,
        max_file_count,
        max_total_encoded_bytes,
    )
}

fn read_project_asset_payload_requests_impl(
    root: &Path,
    requests: Vec<NativeProjectAssetReadRequest>,
    max_file_encoded_bytes: u32,
    max_file_count: u32,
    max_total_encoded_bytes: u32,
) -> Result<NativeProjectAssetPayloadBatch, String> {
    if requests.len() > NATIVE_ASSET_MAX_REQUEST_COUNT {
        return Err(format!(
            "Asset request count exceeds the native limit {NATIVE_ASSET_MAX_REQUEST_COUNT}."
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

    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Project root could not be resolved: {error}"))?;
    if !canonical_root.is_dir() {
        return Err("Project root must be a directory.".into());
    }

    validate_native_project_manifest(&canonical_root)?;

    let assets_path = canonical_root.join("assets");
    let canonical_assets = match assets_path.canonicalize() {
        Ok(path) if path.is_dir() && path.starts_with(&canonical_root) => Some(path),
        Ok(path) if !path.starts_with(&canonical_root) => {
            return Err("Project assets root resolves outside the project root.".into());
        }
        Ok(_) => return Err("Project assets root must be a directory.".into()),
        Err(error) if error.kind() == ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "Project assets root could not be resolved: {error}"
            ));
        }
    };
    let mut seen = BTreeSet::new();
    let mut payloads = Vec::new();
    let mut failures = Vec::new();
    let mut total_encoded_bytes = 0_u64;
    let mut total_source_bytes = 0_u64;
    let max_file_encoded_bytes = max_file_encoded_bytes.min(NATIVE_ASSET_MAX_ENCODED_BYTES);
    let max_file_count = max_file_count.min(NATIVE_ASSET_MAX_FILE_COUNT);
    let max_total_encoded_bytes = max_total_encoded_bytes.min(NATIVE_ASSET_MAX_ENCODED_BYTES);
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
        let Some(media_type) = supported_asset_media_type(&path) else {
            failures.push(asset_payload_failure(
                path,
                "unsupported-type",
                "Asset file type is not supported for media embedding.",
            ));
            continue;
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
        let Some(canonical_assets) = canonical_assets.as_ref() else {
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
        let candidate = canonical_assets.join(relative_asset_path);
        let resolved = match candidate.canonicalize() {
            Ok(path) => path,
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
                failures.push(asset_payload_failure(
                    path,
                    "unreadable",
                    format!("Asset could not be resolved: {error}"),
                ));
                continue;
            }
        };

        if resolved == *canonical_assets || !resolved.starts_with(canonical_assets) {
            failures.push(asset_payload_failure(
                path,
                "symlink-escape",
                "Asset resolves outside the project assets root.",
            ));
            continue;
        }

        let before = match fs::metadata(&resolved) {
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

        let mut file = match File::open(&resolved) {
            Ok(file) => file,
            Err(error) => {
                failures.push(asset_payload_failure(
                    path,
                    if error.kind() == ErrorKind::NotFound {
                        "missing"
                    } else {
                        "unreadable"
                    },
                    format!("Asset could not be opened: {error}"),
                ));
                continue;
            }
        };
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

        match candidate.canonicalize() {
            Ok(current) if current == resolved => {}
            Ok(current) if !current.starts_with(canonical_assets) => {
                failures.push(asset_payload_failure(
                    path,
                    "symlink-escape",
                    "Asset resolved outside the project assets root while it was read.",
                ));
                continue;
            }
            Ok(_) => {
                failures.push(asset_payload_failure(
                    path,
                    "changed",
                    "Asset path changed while it was being read.",
                ));
                continue;
            }
            Err(error) => {
                failures.push(asset_payload_failure(
                    path,
                    "changed",
                    format!("Asset path disappeared while it was read: {error}"),
                ));
                continue;
            }
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

fn validate_native_project_manifest(canonical_root: &Path) -> Result<(), String> {
    let manifest_path = canonical_root.join("twine.toml");
    let metadata = manifest_path
        .symlink_metadata()
        .map_err(|error| format!("Project root must contain a regular twine.toml: {error}"))?;

    if !metadata.file_type().is_file() {
        return Err("Project root must contain a regular twine.toml.".into());
    }

    let canonical_manifest = manifest_path
        .canonicalize()
        .map_err(|error| format!("Project manifest could not be resolved: {error}"))?;
    if canonical_manifest.parent() != Some(canonical_root) {
        return Err("Project manifest must remain directly below the project root.".into());
    }

    Ok(())
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
) -> NativeResult<String> {
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
pub fn prepare_project_import_json(source_path: String) -> NativeResult<String> {
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
) -> NativeResult<String> {
    let previous = serde_json::from_str::<Vec<NativeProjectFileEntry>>(&previous_files_json)
        .map_err(native_error)?;
    let current = serde_json::from_str::<Vec<NativeProjectFileEntry>>(&current_files_json)
        .map_err(native_error)?;
    let conflicts = project_session_conflicts(&previous, &current);

    json_string(&conflicts).map_err(native_error)
}

#[napi(js_name = "findTwineHtmlFilesJson")]
pub fn find_twine_html_files_json(root_path: String) -> NativeResult<String> {
    let files = find_twine_html_files(Path::new(&root_path)).map_err(native_error)?;

    json_string(&files).map_err(native_error)
}

#[napi(js_name = "prepareHtmlImportJson")]
pub fn prepare_html_import_json(
    source_path: String,
    html_file_path: String,
    source_kind: String,
) -> NativeResult<String> {
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

    fs::create_dir_all(&cleanup_path)?;
    extract_zip_archive(source_path, &cleanup_path)?;

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
        Some(cleanup_path),
    )
}

fn prepare_html_import(
    source_path: &Path,
    html_file_path: &Path,
    source_kind: &str,
    cleanup_path: Option<PathBuf>,
) -> Result<NativeProjectImportSource, NativeBoxError> {
    let html_source = fs::read_to_string(html_file_path)?;
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

fn extract_zip_archive(source_path: &Path, target_root: &Path) -> Result<(), NativeBoxError> {
    let file = File::open(source_path)?;
    let mut archive = zip::ZipArchive::new(file)?;

    for index in 0..archive.len() {
        let mut zipped_file = archive.by_index(index)?;
        let Some(enclosed_name) = zipped_file.enclosed_name() else {
            continue;
        };
        let target_path = target_root.join(enclosed_name);

        if zipped_file.is_dir() {
            fs::create_dir_all(&target_path)?;
            continue;
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut output = File::create(&target_path)?;

        io::copy(&mut zipped_file, &mut output)?;
    }

    Ok(())
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

fn write_renderer_project_sidecar(
    root: &Path,
    story: serde_json::Value,
) -> Result<(), NativeBoxError> {
    let sidecar_dir = root.join(".twine");
    let sidecar_path = sidecar_dir.join("project.json");
    let temp_path = sidecar_dir.join(format!("project.json.{}.tmp", timestamp_nanos()));
    let payload = serde_json::json!({
        "schema": "twine.rs/renderer-project",
        "version": 1,
        "stories": [renderer_project_metadata(story)]
    });

    fs::create_dir_all(&sidecar_dir)?;
    fs::write(
        &temp_path,
        format!("{}\n", serde_json::to_string(&payload)?),
    )?;

    if sidecar_path.exists() {
        fs::remove_file(&sidecar_path)?;
    }

    fs::rename(temp_path, sidecar_path)?;
    Ok(())
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

                let path = slash_path(path.strip_prefix(root).ok()?);

                Some(native_project_file_entry(path, kind, &stats))
            })
            .collect::<Vec<_>>();

        files.append(&mut entries);
        return Ok(());
    }

    if stats.is_file() {
        files.push(native_project_file_entry(
            project_path.replace('\\', "/"),
            kind,
            &stats,
        ));
    }

    Ok(())
}

fn native_project_file_entry(
    project_path: String,
    kind: &str,
    stats: &fs::Metadata,
) -> NativeProjectFileEntry {
    let mtime = stats.modified().unwrap_or(UNIX_EPOCH);
    let mtime_ms = system_time_to_ms(mtime);

    NativeProjectFileEntry {
        fingerprint: format!("{}:{}", mtime_ms.trunc() as u64, stats.len()),
        kind: kind.to_owned(),
        modified_at: system_time_to_iso(mtime),
        mtime_ms,
        path: project_path,
        size_bytes: stats.len(),
    }
}

fn native_project_file_entry_from_loaded(file: LoadedProjectFile) -> NativeProjectFileEntry {
    let mtime_ms = system_time_to_ms(file.modified_at);

    NativeProjectFileEntry {
        fingerprint: format!("{}:{}", mtime_ms.trunc() as u64, file.size_bytes),
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

    Some(NativeProjectFileEntry {
        fingerprint: format!("{}:{size}", mtime_ms.trunc() as u64),
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
            Some(previous_file) if previous_file.fingerprint != current_file.fingerprint => {
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

fn discover_project_import_assets(
    source_root: &Path,
    html_file_path: &Path,
    html_source: &str,
) -> Result<Vec<NativeProjectImportAsset>, std::io::Error> {
    let mut assets = BTreeMap::new();
    let html_base_name = html_file_path
        .file_stem()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();

    let Ok(names) = fs::read_dir(source_root) else {
        return Ok(Vec::new());
    };

    for entry in names {
        let entry = entry?;
        let path = entry.path();

        if entry.file_type()?.is_dir()
            && is_obvious_import_asset_directory(
                &entry.file_name().to_string_lossy(),
                &html_base_name,
            )
        {
            scan_import_asset_directory(&mut assets, source_root, &path)?;
        }
    }

    add_referenced_import_assets(&mut assets, source_root, html_source)?;

    Ok(assets.into_values().collect())
}

fn scan_import_asset_directory(
    assets: &mut BTreeMap<String, NativeProjectImportAsset>,
    source_root: &Path,
    directory: &Path,
) -> Result<(), std::io::Error> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            scan_import_asset_directory(assets, source_root, &path)?;
        } else if file_type.is_file() {
            add_import_asset(assets, source_root, &path);
        }
    }

    Ok(())
}

fn add_referenced_import_assets(
    assets: &mut BTreeMap<String, NativeProjectImportAsset>,
    source_root: &Path,
    html_source: &str,
) -> Result<(), std::io::Error> {
    let regex = Regex::new(
        r"(?i)([A-Za-z0-9_./~%:@?&=+-]+\.(?:apng|avif|css|gif|jpe?g|js|m4a|mp3|mp4|oga|ogg|otf|png|svg|ttf|wav|webm|webp|woff2?))",
    )
    .expect("import asset regex should compile");

    for capture in regex.captures_iter(html_source) {
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

        match absolute_path.metadata() {
            Ok(stats) if stats.is_file() => add_import_asset(assets, source_root, &absolute_path),
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
) {
    let Ok(relative_source_path) = source_path.strip_prefix(source_root) else {
        return;
    };
    let relative_source_path = slash_path(relative_source_path);

    if relative_source_path.is_empty()
        || relative_source_path.starts_with("..")
        || !is_import_asset_file(&relative_source_path)
    {
        return;
    }

    let target_path = import_asset_target_path(&relative_source_path);

    assets.insert(
        target_path.to_lowercase(),
        NativeProjectImportAsset {
            original_path: relative_source_path,
            source_path: source_path.to_string_lossy().into_owned(),
            target_path,
        },
    );
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

    let mut ordered_roots = roots.into_values().collect::<Vec<_>>();

    ordered_roots.sort_by(|left, right| right.0.len().cmp(&left.0.len()));

    let mut source = html_source.to_owned();

    for (original_root, target_root) in ordered_roots {
        let regex = Regex::new(&format!(
            r"(?i)(^|[^A-Za-z0-9_./~%:-])(\./)?{}/",
            regex::escape(&original_root)
        ))?;

        source = regex
            .replace_all(&source, |captures: &regex::Captures<'_>| {
                format!(
                    "{}{target_root}/",
                    captures.get(1).map_or("", |value| value.as_str())
                )
            })
            .into_owned();
    }

    Ok(source)
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

        let source = fs::read_to_string(&absolute_path)?;

        if source.to_lowercase().contains("<tw-storydata")
            || source.to_lowercase().contains("<tw-storydata ")
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
    use std::time::{SystemTime, UNIX_EPOCH};

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
        assert_eq!(reasons["assets/folder.png"], "not-file");
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
        let mut paths = (0..25)
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
            25
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
                path: "assets/a.png".into(),
            }],
            100,
            25,
            100,
        )
        .expect("changed baseline batch");

        assert!(changed.payloads.is_empty());
        assert_eq!(changed.failures[0].reason, "changed-since-index");

        let unbounded = (0..=NATIVE_ASSET_MAX_REQUEST_COUNT)
            .map(|index| NativeProjectAssetReadRequest {
                enforce_baseline: true,
                expected_exists: false,
                expected_modified_at_ms: None,
                expected_size_bytes: None,
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
        paths.extend((1..=25).map(|index| format!("assets/missing-{index}.png")));

        let batch = read_project_asset_payloads_impl(&root, paths, u32::MAX, u32::MAX, u32::MAX)
            .expect("hard-limit batch");

        assert!(batch.payloads.is_empty());
        assert_eq!(batch.failures[0].reason, "file-too-large");
        assert_eq!(batch.failures.last().unwrap().reason, "file-count-exceeded");
        assert_eq!(batch.failures.len(), 26);

        fs::remove_dir_all(root).expect("hard-limit project cleanup");
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

        fs::remove_dir_all(root).expect("symlink project cleanup");
        fs::remove_file(outside).expect("outside payload cleanup");
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

        save_project_folder_json(root.to_string_lossy().into_owned(), story.to_string(), None)
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

        save_project_folder_json(
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

        save_project_folder_json(
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

        save_project_folder_json(
            root.to_string_lossy().into_owned(),
            replacement.to_string(),
            Some("single-twee".into()),
        )
        .expect("explicit single layout should win for a new colliding story");

        let manifest = fs::read_to_string(root.join("twine.toml")).expect("manifest");

        assert!(manifest.contains("id = \"new-story\""));
        assert!(manifest.contains("source_layout = \"single-twee\""));
        assert!(manifest.contains("source = \"story.twee\""));
        assert!(root.join("story.twee").exists());
        assert!(!root.join("passages").exists());

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
                fingerprint: "1:10".into(),
                kind: "manifest".into(),
                modified_at: "2026-01-01T00:00:00Z".into(),
                mtime_ms: 1.0,
                path: "twine.toml".into(),
                size_bytes: 10,
            },
            NativeProjectFileEntry {
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
                fingerprint: "2:10".into(),
                kind: "manifest".into(),
                modified_at: "2026-01-01T00:00:01Z".into(),
                mtime_ms: 2.0,
                path: "twine.toml".into(),
                size_bytes: 10,
            },
            NativeProjectFileEntry {
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
}
