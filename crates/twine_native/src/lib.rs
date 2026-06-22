#![doc = "Native Node/Electron bridge for project-folder I/O and inventory scans."]

use napi_derive::napi;
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use twine_model::{GraphPosition, Passage, Story};
use twine_store::{load_project_path_with_options, LoadProjectOptions};

const IMPORT_ASSET_EXTENSIONS: &[&str] = &[
    "apng", "avif", "css", "gif", "jpeg", "jpg", "js", "m4a", "mp3", "mp4", "oga", "ogg",
    "otf", "png", "svg", "ttf", "wav", "webm", "webp", "woff", "woff2",
];
const OBVIOUS_IMPORT_ASSET_DIRECTORIES: &[&str] = &[
    "asset", "assets", "audio", "font", "fonts", "image", "images", "img", "media", "music",
    "picture", "pictures", "sound", "sounds", "video", "videos",
];

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
    passage_text_loaded: bool,
    root_path: String,
    stories: Vec<NativeStory>,
    story_ids: Vec<String>,
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
    html_file_path: String,
    html_source: String,
    source_kind: String,
    source_path: String,
}

#[napi(js_name = "healthJson")]
pub fn health_json() -> String {
    json_string(&HealthReport {
        features: vec![
            "project-load",
            "asset-scan",
            "file-manifest",
            "manifest-diff",
            "html-import-assets",
        ],
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
    })
    .unwrap_or_else(|_| "{\"ok\":false}".into())
}

#[napi(js_name = "loadProjectFolderJson")]
pub fn load_project_folder_json(
    root_path: String,
    load_passage_text: Option<bool>,
) -> NativeResult<String> {
    let root = PathBuf::from(&root_path);
    let passage_text_loaded = load_passage_text.unwrap_or(true);
    let project = load_project_path_with_options(
        &root,
        LoadProjectOptions {
            load_passage_text: passage_text_loaded,
        },
    )
    .map_err(native_error)?;
    let stories = project
        .stories
        .iter()
        .map(NativeStory::from_story)
        .collect::<Vec<_>>();
    let story_ids = stories.iter().map(|story| story.id.clone()).collect();

    json_string(&NativeProjectFolderResult {
        passage_text_loaded,
        root_path,
        stories,
        story_ids,
    })
    .map_err(native_error)
}

#[napi(js_name = "listProjectAssetsJson")]
pub fn list_project_assets_json(root_path: String) -> NativeResult<String> {
    let assets = list_project_assets(Path::new(&root_path)).map_err(native_error)?;

    json_string(&assets).map_err(native_error)
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
    let files = project_file_manifest(Path::new(&root_path), assets.as_deref()).map_err(native_error)?;

    json_string(&files).map_err(native_error)
}

#[napi(js_name = "diffProjectFileManifestJson")]
pub fn diff_project_file_manifest_json(
    previous_files_json: String,
    current_files_json: String,
) -> NativeResult<String> {
    let previous = serde_json::from_str::<Vec<NativeProjectFileEntry>>(&previous_files_json)
        .map_err(native_error)?;
    let current =
        serde_json::from_str::<Vec<NativeProjectFileEntry>>(&current_files_json).map_err(native_error)?;
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
    let html_path = PathBuf::from(&html_file_path);
    let html_source = fs::read_to_string(&html_path).map_err(native_error)?;
    let source_root = html_path.parent().unwrap_or_else(|| Path::new("."));
    let assets = discover_project_import_assets(source_root, &html_path, &html_source)
        .map_err(native_error)?;
    let html_source = rewrite_project_import_asset_references(&html_source, &assets)
        .map_err(native_error)?;

    json_string(&NativeProjectImportSource {
        assets,
        html_file_path,
        html_source,
        source_kind,
        source_path,
    })
    .map_err(native_error)
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

    if let Some(assets) = assets {
        files.extend(assets.iter().filter_map(asset_project_file_entry));
    } else {
        scan_project_files(root, "assets", "asset", &mut files)?;
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
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
        fingerprint: format!("{mtime_ms}:{}", stats.len()),
        kind: kind.to_owned(),
        modified_at: system_time_to_iso(mtime),
        mtime_ms,
        path: project_path,
        size_bytes: stats.len(),
    }
}

fn asset_project_file_entry(asset: &CoreAssetInventoryEntry) -> Option<NativeProjectFileEntry> {
    let size = asset.size_bytes?;
    let modified_at = asset.modified_at.as_ref()?;
    let mtime_ms = parse_iso_to_ms(modified_at).unwrap_or(0.0);

    Some(NativeProjectFileEntry {
        fingerprint: format!("{mtime_ms}:{size}"),
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
            && is_obvious_import_asset_directory(&entry.file_name().to_string_lossy(), &html_base_name)
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
                format!("{}{target_root}/", captures.get(1).map_or("", |value| value.as_str()))
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

    Some(format!("file://{}", percent_encode_file_path(&absolute_path)))
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
    path.replace('\\', "/")
        .trim_start_matches("./")
        .to_lowercase()
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
    let normalized = reference.replace('\\', "/").trim_start_matches("./").to_owned();

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

    String::from_utf8(decoded).unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned())
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

    #[test]
    fn asset_kind_matches_typescript_mapping() {
        assert_eq!(asset_kind_for_path("assets/cover.png"), "image");
        assert_eq!(asset_kind_for_path("assets/theme.css"), "stylesheet");
        assert_eq!(asset_kind_for_path("assets/click.wav"), "audio");
        assert_eq!(asset_kind_for_path("assets/readme.txt"), "file");
    }

    #[test]
    fn import_asset_target_paths_are_project_local() {
        assert_eq!(import_asset_target_path("images/cover.png"), "assets/images/cover.png");
        assert_eq!(import_asset_target_path("assets/cover.png"), "assets/cover.png");
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
