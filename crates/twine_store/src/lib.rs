#![doc = "Persistence interfaces, project-folder storage, and JSON fixture loading."]

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{BufReader, Read},
    path::{Component, Path, PathBuf},
    sync::OnceLock,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use twine_export::merge_story_into_twee;
use twine_graph::GraphIndex;
use twine_model::{
    GraphLayout, LibraryMetadata, PROJECT_SCHEMA_VERSION, Passage, PassageId, Project,
    ProjectManifest, ProjectSourceLayout, StoragePolicy, Story, StoryId,
};
use twine_parse::story_from_twee_named;

const MANIFEST_FILE: &str = "twine.toml";
const GRAPH_CACHE_DIR: &str = ".twine/cache/graph";
const GRAPH_LAYOUT_FILE: &str = ".twine/graph.json";
const MANIFEST_CACHE_FILE: &str = ".twine/cache/project-manifest.json";
const MANIFEST_CACHE_FORMAT: &str = "twine.rs/project-manifest-cache";
const MANIFEST_CACHE_VERSION: u32 = 1;
const PARALLEL_SOURCE_THRESHOLD: usize = 128;

static PROJECT_LOAD_POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();

fn project_load_worker_count() -> usize {
    std::env::var("TWINE_NATIVE_LOAD_THREADS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or_else(|| {
            std::thread::available_parallelism()
                .map(usize::from)
                .unwrap_or(1)
                .min(8)
        })
}

fn project_load_pool() -> &'static rayon::ThreadPool {
    PROJECT_LOAD_POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(project_load_worker_count())
            .thread_name(|index| format!("twine-project-load-{index}"))
            .build()
            .expect("bounded project load pool should build")
    })
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("project manifest not found: {0}")]
    ProjectManifestNotFound(PathBuf),

    #[error("failed to read project file {path}: {source}")]
    ProjectFileRead {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("project-relative path is unsafe: {0}")]
    UnsafeProjectPath(PathBuf),

    #[error("unmanaged project file conflicts with an app-owned path: {0}")]
    UnmanagedFileConflict(PathBuf),

    #[error("unsupported unmanaged project entry: {0}")]
    UnsupportedUnmanagedProjectEntry(PathBuf),

    #[error(
        "failed to install the prepared project at {root}: {install_error}; failed to restore the original project from {recovery_path}: {rollback_error}"
    )]
    ProjectInstallRollback {
        root: PathBuf,
        recovery_path: PathBuf,
        install_error: std::io::Error,
        rollback_error: std::io::Error,
    },

    #[error("story not found: {0}")]
    StoryNotFound(StoryId),

    #[error("TOML decode error: {0}")]
    TomlDecode(#[from] toml::de::Error),

    #[error("TOML encode error: {0}")]
    TomlEncode(#[from] toml::ser::Error),

    #[error("Twee parse error: {0}")]
    TweeParse(#[from] twine_parse::ParseError),

    #[error("Twee export error: {0}")]
    TweeExport(#[from] twine_export::ExportError),
}

pub trait StoryStore {
    fn load_story(&self, id: &StoryId) -> Result<Story, StoreError>;
    fn save_story(&self, story: &Story) -> Result<(), StoreError>;
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SaveOptions {
    pub create_backup: bool,
    pub max_backups: usize,
    pub write_generated_indexes: bool,
}

impl Default for SaveOptions {
    fn default() -> Self {
        Self {
            create_backup: true,
            max_backups: 10,
            write_generated_indexes: true,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectLoadProfile {
    Full,
    Shell,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LoadProjectOptions {
    pub profile: ProjectLoadProfile,
}

impl LoadProjectOptions {
    pub const fn full() -> Self {
        Self {
            profile: ProjectLoadProfile::Full,
        }
    }

    pub const fn shell() -> Self {
        Self {
            profile: ProjectLoadProfile::Shell,
        }
    }

    pub const fn loads_full_content(self) -> bool {
        matches!(self.profile, ProjectLoadProfile::Full)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoadedProjectFile {
    pub kind: &'static str,
    pub modified_at: SystemTime,
    pub passage_id: Option<String>,
    pub path: PathBuf,
    pub size_bytes: u64,
    pub story_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LoadedProject {
    pub files: Vec<LoadedProjectFile>,
    pub project: Project,
    pub timings: ProjectLoadTimings,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProjectLoadTimings {
    pub graph_layout_us: u64,
    pub manifest_cache_bytes: u64,
    pub manifest_cache_decode_us: u64,
    pub manifest_cache_hit: bool,
    pub manifest_cache_miss_reason: Option<String>,
    pub manifest_cache_read_us: u64,
    pub manifest_digest: Option<String>,
    pub manifest_hash_us: u64,
    pub manifest_parse_us: u64,
    pub manifest_read_us: u64,
    pub manifest_toml_parse_us: u64,
    pub parallel: bool,
    pub passage_source_count: usize,
    pub passage_source_us: u64,
    pub source_bytes: u64,
    pub source_job_prepare_us: u64,
    pub story_source_count: usize,
    pub story_source_us: u64,
    pub worker_count: usize,
}

impl Default for LoadProjectOptions {
    fn default() -> Self {
        Self::full()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SaveReport {
    pub backup_path: Option<PathBuf>,
    pub changed_files: Vec<PathBuf>,
    pub dirty: bool,
    pub storage_message: String,
    pub timings: SaveTimings,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct SaveTimings {
    pub changed_file_plan_us: u64,
    pub collect_new_files_us: u64,
    pub collect_old_files_us: u64,
    pub copy_assets_us: u64,
    pub dirty_compare_us: u64,
    pub root_swap_us: u64,
    pub total_us: u64,
    pub write_temp_project_us: u64,
}

#[derive(Clone, Debug)]
pub struct FileProjectStore {
    root: PathBuf,
}

impl FileProjectStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn load_project(&self) -> Result<Project, StoreError> {
        load_project_path(&self.root)
    }

    pub fn save_project(
        &self,
        project: &Project,
        options: &SaveOptions,
    ) -> Result<SaveReport, StoreError> {
        save_project_path(&self.root, project, options)
    }
}

impl StoryStore for FileProjectStore {
    fn load_story(&self, id: &StoryId) -> Result<Story, StoreError> {
        self.load_project()?
            .stories
            .into_iter()
            .find(|story| &story.id == id)
            .ok_or_else(|| StoreError::StoryNotFound(id.clone()))
    }

    fn save_story(&self, story: &Story) -> Result<(), StoreError> {
        let mut project = if self.root.join(MANIFEST_FILE).exists() {
            self.load_project()?
        } else {
            Project::default()
        };

        if let Some(existing) = project
            .stories
            .iter_mut()
            .find(|existing| existing.id == story.id)
        {
            *existing = story.clone();
        } else {
            project.stories.push(story.clone());
            project.library.sort_order.push(story.id.clone());
        }

        self.save_project(&project, &SaveOptions::default())?;
        Ok(())
    }
}

pub fn load_story_json_path(path: impl AsRef<Path>) -> Result<Story, StoreError> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);

    Ok(serde_json::from_reader(reader)?)
}

pub fn save_story_json_path(path: impl AsRef<Path>, story: &Story) -> Result<(), StoreError> {
    let file = File::create(path)?;

    Ok(serde_json::to_writer_pretty(file, story)?)
}

pub fn load_project_path(root: impl AsRef<Path>) -> Result<Project, StoreError> {
    load_project_path_with_options(root, LoadProjectOptions::default())
}

pub fn load_project_path_with_options(
    root: impl AsRef<Path>,
    options: LoadProjectOptions,
) -> Result<Project, StoreError> {
    Ok(load_project_path_with_receipt(root, options)?.project)
}

pub fn load_project_path_with_receipt(
    root: impl AsRef<Path>,
    options: LoadProjectOptions,
) -> Result<LoadedProject, StoreError> {
    let root = root.as_ref();
    let manifest_path = root.join(MANIFEST_FILE);

    if !manifest_path.exists() {
        return Err(StoreError::ProjectManifestNotFound(manifest_path));
    }

    let mut files = Vec::new();
    let mut timings = ProjectLoadTimings::default();
    let started = Instant::now();
    let manifest_source =
        read_project_file(root, MANIFEST_FILE, "manifest", None, None, &mut files)?
            .ok_or_else(|| StoreError::ProjectManifestNotFound(manifest_path.clone()))?;
    timings.manifest_read_us = elapsed_us(started);
    let hash_started = Instant::now();
    let manifest_hash = manifest_digest(manifest_source.as_bytes());

    timings.manifest_hash_us = elapsed_us(hash_started);
    timings.manifest_digest = Some(manifest_hash.clone());
    let manifest = match read_compiled_project_manifest(
        root,
        &manifest_hash,
        manifest_source.len(),
        &mut timings,
    )? {
        Some(project_file) => project_file,
        None => {
            let started = Instant::now();
            let project_file = toml::from_str(&manifest_source)?;

            timings.manifest_toml_parse_us = elapsed_us(started);
            timings.manifest_parse_us = timings.manifest_toml_parse_us;
            project_file
        }
    };
    let project = manifest.into_project(root, options, &mut files, &mut timings)?;

    Ok(LoadedProject {
        files,
        project,
        timings,
    })
}

fn manifest_digest(source: &[u8]) -> String {
    let digest = Sha256::digest(source);
    let mut encoded = String::with_capacity(digest.len() * 2);

    for byte in digest {
        use std::fmt::Write;

        let _ = write!(encoded, "{byte:02x}");
    }
    encoded
}

fn read_compiled_project_manifest(
    root: &Path,
    manifest_hash: &str,
    manifest_size: usize,
    timings: &mut ProjectLoadTimings,
) -> Result<Option<ProjectFile>, StoreError> {
    let started = Instant::now();
    let source = match fs::read(root.join(MANIFEST_CACHE_FILE)) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            timings.manifest_cache_read_us = elapsed_us(started);
            timings.manifest_cache_miss_reason = Some("missing".into());
            return Ok(None);
        }
        Err(_) => {
            timings.manifest_cache_read_us = elapsed_us(started);
            timings.manifest_cache_miss_reason = Some("invalidCache".into());
            return Ok(None);
        }
    };

    timings.manifest_cache_read_us = elapsed_us(started);
    timings.manifest_cache_bytes = source.len().try_into().unwrap_or(u64::MAX);
    let started = Instant::now();
    let cache = match serde_json::from_slice::<CompiledProjectManifest>(&source) {
        Ok(cache) => cache,
        Err(_) => {
            timings.manifest_cache_decode_us = elapsed_us(started);
            timings.manifest_cache_miss_reason = Some("invalidCache".into());
            return Ok(None);
        }
    };

    timings.manifest_cache_decode_us = elapsed_us(started);
    let miss_reason = if cache.format != MANIFEST_CACHE_FORMAT {
        Some("invalidCache")
    } else if cache.version != MANIFEST_CACHE_VERSION {
        Some("versionMismatch")
    } else if cache.app_version != env!("CARGO_PKG_VERSION") {
        Some("versionMismatch")
    } else if cache.project_schema_version != cache.project.schema_version {
        Some("schemaMismatch")
    } else if cache.manifest_size != manifest_size as u64 || cache.manifest_hash != manifest_hash {
        Some("hashMismatch")
    } else {
        None
    };

    if let Some(reason) = miss_reason {
        timings.manifest_cache_miss_reason = Some(reason.into());
        return Ok(None);
    }

    timings.manifest_cache_hit = true;
    timings.manifest_parse_us = timings.manifest_cache_decode_us;
    Ok(Some(cache.project))
}

pub fn save_project_path(
    root: impl AsRef<Path>,
    project: &Project,
    options: &SaveOptions,
) -> Result<SaveReport, StoreError> {
    save_project_path_with_prepared_sidecar(root, project, options, None)
}

pub fn save_project_path_with_prepared_sidecar(
    root: impl AsRef<Path>,
    project: &Project,
    options: &SaveOptions,
    prepared_sidecar: Option<&[u8]>,
) -> Result<SaveReport, StoreError> {
    let total_started = Instant::now();
    let mut timings = SaveTimings::default();
    let root = root.as_ref();
    let temp_root = temp_project_path(root);
    let started = Instant::now();
    let old_files = collect_files(root)?;
    timings.collect_old_files_us = elapsed_us(started);

    if temp_root.exists() {
        fs::remove_dir_all(&temp_root)?;
    }

    let started = Instant::now();
    write_project_to_dir(&temp_root, project, options, Some(root))?;
    if let Some(prepared_sidecar) = prepared_sidecar {
        fs::write(temp_root.join(".twine/project.json"), prepared_sidecar)?;
    }
    timings.write_temp_project_us = elapsed_us(started);
    let started = Instant::now();
    if let Err(error) = copy_unmanaged_project_files(root, &temp_root, prepared_sidecar.is_some()) {
        let _ = fs::remove_dir_all(&temp_root);
        return Err(error);
    }
    timings.copy_assets_us = elapsed_us(started);

    let started = Instant::now();
    let new_files = collect_files(&temp_root)?;
    timings.collect_new_files_us = elapsed_us(started);
    let started = Instant::now();
    let dirty = !file_sets_equal(root, &old_files, &temp_root, &new_files)?;
    timings.dirty_compare_us = elapsed_us(started);
    let started = Instant::now();
    let changed_files = changed_files(root, &old_files, &temp_root, &new_files)?;
    timings.changed_file_plan_us = elapsed_us(started);
    let storage_message = project.manifest.storage.message.clone();

    if !dirty {
        fs::remove_dir_all(&temp_root)?;
        timings.total_us = elapsed_us(total_started);
        return Ok(SaveReport {
            backup_path: None,
            changed_files,
            dirty: false,
            storage_message,
            timings,
        });
    }

    let root_existed = root.exists();
    let (displaced_path, keep_displaced) = if root_existed && options.create_backup {
        let backup = backup_dir(root).join(timestamp());

        fs::create_dir_all(backup.parent().expect("backup path should have parent"))?;
        (backup, true)
    } else {
        (
            root.with_extension(format!("retired-{}", timestamp())),
            false,
        )
    };
    let started = Instant::now();

    install_prepared_project_root(
        root,
        &temp_root,
        &displaced_path,
        keep_displaced,
        |source, target| fs::rename(source, target),
    )?;
    let backup_path = (root_existed && keep_displaced).then_some(displaced_path);

    if backup_path.is_some() {
        prune_backups(root, options.max_backups)?;
    }
    timings.root_swap_us = elapsed_us(started);
    timings.total_us = elapsed_us(total_started);

    Ok(SaveReport {
        backup_path,
        changed_files,
        dirty: true,
        storage_message,
        timings,
    })
}

fn elapsed_us(started: Instant) -> u64 {
    started.elapsed().as_micros().try_into().unwrap_or(u64::MAX)
}

fn write_project_to_dir(
    root: &Path,
    project: &Project,
    options: &SaveOptions,
    previous_root: Option<&Path>,
) -> Result<(), StoreError> {
    fs::create_dir_all(root)?;
    if project.stories.iter().any(|story| {
        project.manifest.source_layout_for(&story.id) == ProjectSourceLayout::PassageFiles
    }) {
        fs::create_dir_all(root.join("passages"))?;
    }
    fs::create_dir_all(root.join("scripts"))?;
    fs::create_dir_all(root.join("styles"))?;
    fs::create_dir_all(root.join("assets"))?;
    fs::create_dir_all(root.join(".twine"))?;

    if options.write_generated_indexes {
        fs::create_dir_all(root.join(GRAPH_CACHE_DIR))?;
    }

    let previous_project_file = previous_root.and_then(read_existing_project_file);
    let mut project_file = ProjectFile::from_project(project);
    let single_story_count = project
        .stories
        .iter()
        .filter(|story| {
            project.manifest.source_layout_for(&story.id) == ProjectSourceLayout::SingleTwee
        })
        .count();
    let story_components =
        unique_story_components(&project.stories, previous_project_file.as_ref());
    let mut used_single_sources = BTreeSet::new();

    for (story, story_slug) in project.stories.iter().zip(story_components) {
        let script_path = PathBuf::from("scripts").join(format!("{story_slug}.js"));
        let stylesheet_path = PathBuf::from("styles").join(format!("{story_slug}.css"));
        let source_layout = project.manifest.source_layout_for(&story.id);

        fs::write(root.join(&script_path), &story.script)?;
        fs::write(root.join(&stylesheet_path), &story.stylesheet)?;

        let previous_story_file = previous_project_file.as_ref().and_then(|project_file| {
            project_file
                .stories
                .iter()
                .find(|candidate| candidate.id == story.id)
        });
        let (source, passage_files) = match source_layout {
            ProjectSourceLayout::PassageFiles => {
                let story_dir = PathBuf::from("passages").join(&story_slug);

                fs::create_dir_all(root.join(&story_dir))?;

                let mut used_files = BTreeSet::new();
                let passage_files = story
                    .passages
                    .iter()
                    .enumerate()
                    .map(|(index, passage)| {
                        let file = unique_passage_file(index, passage, &mut used_files);
                        let relative = story_dir.join(file);

                        fs::write(root.join(&relative), &passage.text)?;

                        Ok(PassageFile::from_passage(passage, relative))
                    })
                    .collect::<Result<Vec<_>, StoreError>>()?;

                (String::new(), passage_files)
            }
            ProjectSourceLayout::SingleTwee => {
                let preferred_source = previous_story_file
                    .filter(|story_file| {
                        story_file.source_layout == ProjectSourceLayout::SingleTwee
                            && !story_file.source.is_empty()
                    })
                    .map(|story_file| PathBuf::from(&story_file.source))
                    .unwrap_or_else(|| {
                        if single_story_count == 1 {
                            PathBuf::from("story.twee")
                        } else {
                            PathBuf::from(format!("{story_slug}.twee"))
                        }
                    });
                let source_path =
                    unique_source_path(preferred_source, &story_slug, &mut used_single_sources)?;
                let existing_source = previous_root
                    .and_then(|previous_root| {
                        fs::read_to_string(previous_root.join(&source_path)).ok()
                    })
                    .unwrap_or_default();
                let previous_passage_names = previous_story_file
                    .map(|story_file| {
                        story_file
                            .passages
                            .iter()
                            .map(|passage| passage.name.clone())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let source =
                    merge_story_into_twee(&existing_source, story, &previous_passage_names)?;

                if let Some(parent) = root.join(&source_path).parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(root.join(&source_path), source)?;

                (
                    path_string(&source_path),
                    story
                        .passages
                        .iter()
                        .map(|passage| PassageFile::from_passage(passage, PathBuf::new()))
                        .collect(),
                )
            }
        };

        if let Some(story_file) = project_file
            .stories
            .iter_mut()
            .find(|story_file| story_file.id == story.id)
        {
            story_file.script = path_string(&script_path);
            story_file.stylesheet = path_string(&stylesheet_path);
            story_file.source = source;
            story_file.passages = passage_files;
        }

        if options.write_generated_indexes {
            let graph_path = root
                .join(GRAPH_CACHE_DIR)
                .join(format!("{story_slug}.graph.json"));
            let graph = GraphIndex::from_story(story);

            fs::write(graph_path, serde_json::to_string_pretty(&graph)?)?;
        }
    }

    if !project.layout.annotations.is_empty()
        || !project.layout.passages.is_empty()
        || !project.layout.groups.is_empty()
        || !project.layout.saved_layouts.is_empty()
        || !project.layout.metadata.is_empty()
    {
        fs::create_dir_all(root.join(".twine"))?;
        fs::write(
            root.join(GRAPH_LAYOUT_FILE),
            serde_json::to_string_pretty(&project.layout)?,
        )?;
    }

    let manifest_source = toml::to_string_pretty(&project_file)?;

    fs::write(root.join(MANIFEST_FILE), &manifest_source)?;
    if options.write_generated_indexes {
        let cache = CompiledProjectManifest {
            app_version: env!("CARGO_PKG_VERSION").into(),
            format: MANIFEST_CACHE_FORMAT.into(),
            manifest_hash: manifest_digest(manifest_source.as_bytes()),
            manifest_size: manifest_source.len().try_into().unwrap_or(u64::MAX),
            project_schema_version: project_file.schema_version,
            project: project_file,
            version: MANIFEST_CACHE_VERSION,
        };

        fs::write(root.join(MANIFEST_CACHE_FILE), serde_json::to_vec(&cache)?)?;
    }

    Ok(())
}

fn read_existing_project_file(root: &Path) -> Option<ProjectFile> {
    fs::read_to_string(root.join(MANIFEST_FILE))
        .ok()
        .and_then(|source| toml::from_str(&source).ok())
}

fn unique_source_path(
    preferred: PathBuf,
    story_slug: &str,
    used: &mut BTreeSet<String>,
) -> Result<PathBuf, StoreError> {
    safe_project_relative_path(&path_string(&preferred))?;
    if used.insert(project_path_collision_key(&preferred)) {
        return Ok(preferred);
    }

    let mut suffix = 2;
    loop {
        let candidate = PathBuf::from(format!("{story_slug}-{suffix}.twee"));

        if used.insert(project_path_collision_key(&candidate)) {
            return Ok(candidate);
        }
        suffix += 1;
    }
}

fn copy_unmanaged_project_files(
    source_root: &Path,
    target_root: &Path,
    replaces_prepared_sidecar: bool,
) -> Result<(), StoreError> {
    if !source_root.exists() {
        return Ok(());
    }

    let existing_files = collect_files(source_root)?;
    let existing_directories = collect_directories(source_root)?;
    let ownership = existing_project_ownership(source_root, replaces_prepared_sidecar);

    copy_unmanaged_directory_contents(
        source_root,
        source_root,
        target_root,
        &ownership,
        &existing_files,
        &existing_directories,
    )
}

fn copy_unmanaged_directory_contents(
    source_root: &Path,
    source_directory: &Path,
    target_root: &Path,
    ownership: &ProjectOwnership,
    existing_files: &BTreeSet<PathBuf>,
    existing_directories: &BTreeSet<PathBuf>,
) -> Result<(), StoreError> {
    for entry in fs::read_dir(source_directory)? {
        let entry = entry?;
        let source = entry.path();
        let relative = source
            .strip_prefix(source_root)
            .expect("project entry should be under its root");
        let target = target_root.join(relative);
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            let owned = project_directory_is_owned(relative, ownership, existing_directories);
            let target_existed = match fs::symlink_metadata(&target) {
                Ok(metadata) if metadata.file_type().is_dir() => true,
                Ok(_)
                    if owned
                        && !directory_contains_unmanaged_entries(
                            source_root,
                            &source,
                            ownership,
                            existing_files,
                            existing_directories,
                        )? =>
                {
                    continue;
                }
                Ok(_) => return Err(StoreError::UnmanagedFileConflict(relative.to_path_buf())),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
                Err(error) => return Err(error.into()),
            };

            if !target_existed {
                fs::create_dir_all(&target)?;
            }
            copy_unmanaged_directory_contents(
                source_root,
                &source,
                target_root,
                ownership,
                existing_files,
                existing_directories,
            )?;

            if owned && !target_existed && fs::read_dir(&target)?.next().transpose()?.is_none() {
                fs::remove_dir(&target)?;
            }
            continue;
        }

        if project_file_is_owned(relative, ownership, existing_files, existing_directories) {
            continue;
        }
        if !file_type.is_file() && !file_type.is_symlink() {
            return Err(StoreError::UnsupportedUnmanagedProjectEntry(
                relative.to_path_buf(),
            ));
        }

        if fs::symlink_metadata(&target).is_ok() {
            return Err(StoreError::UnmanagedFileConflict(relative.to_path_buf()));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }

        copy_file_or_symlink(&source, &target)?;
    }

    Ok(())
}

fn directory_contains_unmanaged_entries(
    source_root: &Path,
    source_directory: &Path,
    ownership: &ProjectOwnership,
    existing_files: &BTreeSet<PathBuf>,
    existing_directories: &BTreeSet<PathBuf>,
) -> Result<bool, StoreError> {
    for entry in fs::read_dir(source_directory)? {
        let entry = entry?;
        let source = entry.path();
        let relative = source
            .strip_prefix(source_root)
            .expect("project entry should be under its root");
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            if !project_directory_is_owned(relative, ownership, existing_directories)
                || directory_contains_unmanaged_entries(
                    source_root,
                    &source,
                    ownership,
                    existing_files,
                    existing_directories,
                )?
            {
                return Ok(true);
            }
        } else if !project_file_is_owned(relative, ownership, existing_files, existing_directories)
        {
            return Ok(true);
        }
    }

    Ok(false)
}

#[derive(Default)]
struct ProjectOwnership {
    directories: BTreeMap<String, Vec<PathBuf>>,
    directory_paths: BTreeSet<PathBuf>,
    files: BTreeMap<String, Vec<PathBuf>>,
    file_paths: BTreeSet<PathBuf>,
}

impl ProjectOwnership {
    fn add_directory(&mut self, path: PathBuf) {
        if self.directory_paths.insert(path.clone()) {
            self.directories
                .entry(project_path_collision_key(&path))
                .or_default()
                .push(path);
        }
    }

    fn add_file(&mut self, path: PathBuf) {
        if self.file_paths.insert(path.clone()) {
            self.files
                .entry(project_path_collision_key(&path))
                .or_default()
                .push(path.clone());
        }

        let mut parent = path.parent();
        while let Some(path) = parent.filter(|path| !path.as_os_str().is_empty()) {
            self.add_directory(path.to_path_buf());
            parent = path.parent();
        }
    }
}

fn existing_project_ownership(root: &Path, replaces_prepared_sidecar: bool) -> ProjectOwnership {
    let mut ownership = ProjectOwnership::default();

    for directory in ["passages", "scripts", "styles", "assets", ".twine"] {
        ownership.add_directory(PathBuf::from(directory));
    }
    for file in [MANIFEST_FILE, GRAPH_LAYOUT_FILE, MANIFEST_CACHE_FILE] {
        ownership.add_file(PathBuf::from(file));
    }

    if replaces_prepared_sidecar {
        ownership.add_file(PathBuf::from(".twine/project.json"));
    }

    if let Some(project) = read_existing_project_file(root) {
        for story in project.stories {
            for relative in std::iter::once(story.script)
                .chain(std::iter::once(story.stylesheet))
                .chain(std::iter::once(story.source))
                .chain(story.passages.into_iter().map(|passage| passage.file))
                .filter(|relative| !relative.is_empty())
            {
                let relative = PathBuf::from(relative);

                if safe_project_relative_path(&path_string(&relative)).is_ok() {
                    ownership.add_file(relative);
                }
            }
        }
    }

    ownership
}

fn project_file_is_owned(
    relative: &Path,
    ownership: &ProjectOwnership,
    existing_files: &BTreeSet<PathBuf>,
    existing_directories: &BTreeSet<PathBuf>,
) -> bool {
    if path_matches_owned_entry(
        relative,
        &ownership.file_paths,
        &ownership.files,
        existing_files,
    ) {
        return true;
    }

    path_matches_owned_prefix(
        relative,
        Path::new(GRAPH_CACHE_DIR),
        existing_files
            .iter()
            .any(|existing| existing.starts_with(GRAPH_CACHE_DIR))
            || existing_directories
                .iter()
                .any(|existing| existing.starts_with(GRAPH_CACHE_DIR)),
    )
}

fn project_directory_is_owned(
    relative: &Path,
    ownership: &ProjectOwnership,
    existing_directories: &BTreeSet<PathBuf>,
) -> bool {
    if path_matches_owned_entry(
        relative,
        &ownership.directory_paths,
        &ownership.directories,
        existing_directories,
    ) {
        return true;
    }

    path_matches_owned_prefix(
        relative,
        Path::new(GRAPH_CACHE_DIR),
        existing_directories
            .iter()
            .any(|existing| existing.starts_with(GRAPH_CACHE_DIR)),
    )
}

fn path_matches_owned_entry(
    relative: &Path,
    owned_paths: &BTreeSet<PathBuf>,
    owned_by_key: &BTreeMap<String, Vec<PathBuf>>,
    existing_paths: &BTreeSet<PathBuf>,
) -> bool {
    if owned_paths.contains(relative) {
        return true;
    }

    owned_by_key
        .get(&project_path_collision_key(relative))
        .is_some_and(|candidates| {
            !candidates
                .iter()
                .any(|candidate| existing_paths.contains(candidate))
        })
}

fn path_matches_owned_prefix(
    relative: &Path,
    owned_prefix: &Path,
    exact_prefix_exists: bool,
) -> bool {
    if relative.starts_with(owned_prefix) {
        return true;
    }

    let relative_key = project_path_collision_key(relative);
    let prefix_key = project_path_collision_key(owned_prefix);
    let has_normalized_prefix = relative_key == prefix_key
        || relative_key
            .strip_prefix(&prefix_key)
            .is_some_and(|suffix| suffix.starts_with('/'));

    has_normalized_prefix && !exact_prefix_exists
}

#[cfg(unix)]
fn copy_file_or_symlink(source: &Path, target: &Path) -> Result<(), StoreError> {
    let file_type = fs::symlink_metadata(source)?.file_type();

    if file_type.is_symlink() {
        std::os::unix::fs::symlink(fs::read_link(source)?, target)?;
    } else {
        fs::copy(source, target)?;
    }

    Ok(())
}

#[cfg(windows)]
fn copy_file_or_symlink(source: &Path, target: &Path) -> Result<(), StoreError> {
    let file_type = fs::symlink_metadata(source)?.file_type();

    if file_type.is_symlink() {
        let link_target = fs::read_link(source)?;
        use std::os::windows::fs::FileTypeExt;

        if file_type.is_symlink_dir() {
            std::os::windows::fs::symlink_dir(link_target, target)?;
        } else {
            std::os::windows::fs::symlink_file(link_target, target)?;
        }
    } else {
        fs::copy(source, target)?;
    }

    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn copy_file_or_symlink(source: &Path, target: &Path) -> Result<(), StoreError> {
    fs::copy(source, target)?;
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ProjectFile {
    #[serde(default)]
    app_version: String,
    #[serde(default)]
    library: LibraryFile,
    #[serde(default)]
    name: String,
    #[serde(default = "schema_version")]
    schema_version: u32,
    #[serde(default)]
    storage: StoragePolicy,
    #[serde(default)]
    stories: Vec<StoryFile>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct CompiledProjectManifest {
    app_version: String,
    format: String,
    manifest_hash: String,
    manifest_size: u64,
    project: ProjectFile,
    project_schema_version: u32,
    version: u32,
}

fn schema_version() -> u32 {
    1
}

impl ProjectFile {
    fn from_project(project: &Project) -> Self {
        Self {
            app_version: project.manifest.app_version.clone(),
            library: LibraryFile::from_library(&project.library),
            name: project.manifest.name.clone(),
            schema_version: project.manifest.schema_version.max(PROJECT_SCHEMA_VERSION),
            storage: project.manifest.storage.clone(),
            stories: project
                .stories
                .iter()
                .map(|story| {
                    StoryFile::from_story(story, project.manifest.source_layout_for(&story.id))
                })
                .collect(),
        }
    }

    fn into_project(
        self,
        root: &Path,
        options: LoadProjectOptions,
        files: &mut Vec<LoadedProjectFile>,
        timings: &mut ProjectLoadTimings,
    ) -> Result<Project, StoreError> {
        let ProjectFile {
            app_version,
            library,
            name,
            schema_version,
            storage,
            stories: story_files,
        } = self;
        let source_layouts = story_files
            .iter()
            .filter(|story| story.source_layout != ProjectSourceLayout::PassageFiles)
            .map(|story| (story.id.clone(), story.source_layout))
            .collect();
        let source_count = story_files
            .iter()
            .map(|story| {
                if story.source_layout == ProjectSourceLayout::SingleTwee {
                    3
                } else {
                    story.passages.len() + 2
                }
            })
            .sum::<usize>();
        let parallel = options.loads_full_content() && source_count >= PARALLEL_SOURCE_THRESHOLD;
        let load_layout = || -> Result<_, StoreError> {
            let started = Instant::now();
            let mut layout_files = Vec::new();
            let layout = if options.loads_full_content() {
                read_project_file(
                    root,
                    GRAPH_LAYOUT_FILE,
                    "graph",
                    None,
                    None,
                    &mut layout_files,
                )?
                .map(|source| serde_json::from_str(&source))
                .transpose()?
                .unwrap_or_default()
            } else {
                GraphLayout::default()
            };

            Ok((layout, layout_files, elapsed_us(started)))
        };
        let load_stories = || {
            story_files
                .into_iter()
                .map(|story| story.into_story(root, options))
                .collect::<Result<Vec<_>, _>>()
        };
        let (layout_result, stories_result) = if parallel {
            project_load_pool().install(|| rayon::join(load_layout, load_stories))
        } else {
            (load_layout(), load_stories())
        };
        let (mut layout, layout_files, graph_layout_us) = layout_result?;
        let loaded_stories = stories_result?;

        files.extend(layout_files);
        timings.graph_layout_us = graph_layout_us;
        timings.parallel |= parallel;
        timings.worker_count = if parallel {
            project_load_pool().current_num_threads()
        } else {
            1
        };
        let mut stories = Vec::with_capacity(loaded_stories.len());

        for loaded in loaded_stories {
            timings.parallel |= loaded.parallel;
            timings.passage_source_count += loaded.passage_source_count;
            timings.passage_source_us += loaded.passage_source_us;
            timings.source_bytes += loaded.source_bytes;
            timings.source_job_prepare_us += loaded.source_job_prepare_us;
            timings.story_source_count += loaded.story_source_count;
            timings.story_source_us += loaded.story_source_us;
            timings.worker_count = timings.worker_count.max(loaded.worker_count);
            files.extend(loaded.files);
            stories.push(loaded.story);
        }

        layout.passages.migrate_legacy(&stories);
        // PassageLayouts always serializes with the story-scoped schema, even
        // when it is empty, so the project manifest must gate older readers.
        let schema_version = schema_version.max(PROJECT_SCHEMA_VERSION);

        for story in &mut stories {
            layout.apply_to_story(story);
        }

        Ok(Project {
            layout,
            library: library.into_library(),
            manifest: ProjectManifest {
                app_version,
                name,
                schema_version,
                source_layouts,
                storage,
            },
            stories,
        })
    }
}

struct LoadedStory {
    files: Vec<LoadedProjectFile>,
    parallel: bool,
    passage_source_count: usize,
    passage_source_us: u64,
    source_bytes: u64,
    source_job_prepare_us: u64,
    story: Story,
    story_source_count: usize,
    story_source_us: u64,
    worker_count: usize,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct LibraryFile {
    #[serde(default)]
    colors: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    metadata_json: Option<String>,
    #[serde(default)]
    sort_order: Vec<StoryId>,
}

impl LibraryFile {
    fn from_library(library: &LibraryMetadata) -> Self {
        Self {
            colors: library
                .colors
                .iter()
                .map(|(id, color)| (id.as_ref().to_owned(), color.clone()))
                .collect(),
            metadata_json: metadata_to_json(&library.metadata),
            sort_order: library.sort_order.clone(),
        }
    }

    fn into_library(self) -> LibraryMetadata {
        LibraryMetadata {
            colors: self
                .colors
                .into_iter()
                .map(|(id, color)| (StoryId::new(id), color))
                .collect(),
            metadata: metadata_from_json(self.metadata_json),
            sort_order: self.sort_order,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoryFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(default)]
    custom_attributes: BTreeMap<String, String>,
    #[serde(default)]
    format_options: String,
    #[serde(default)]
    id: StoryId,
    #[serde(default)]
    ifid: String,
    #[serde(default)]
    last_update: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    metadata_json: Option<String>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    passages: Vec<PassageFile>,
    #[serde(default)]
    script: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    source: String,
    #[serde(default, skip_serializing_if = "is_passage_files_layout")]
    source_layout: ProjectSourceLayout,
    #[serde(default = "default_true")]
    snap_to_grid: bool,
    #[serde(default)]
    start_passage: PassageId,
    #[serde(default)]
    story_format: String,
    #[serde(default)]
    story_format_version: String,
    #[serde(default)]
    stylesheet: String,
    #[serde(default)]
    tag_colors: BTreeMap<String, String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default = "default_zoom")]
    zoom: f64,
}

fn default_true() -> bool {
    true
}

fn is_passage_files_layout(layout: &ProjectSourceLayout) -> bool {
    *layout == ProjectSourceLayout::PassageFiles
}

fn default_zoom() -> f64 {
    1.0
}

impl StoryFile {
    fn from_story(story: &Story, source_layout: ProjectSourceLayout) -> Self {
        Self {
            color: story.color.clone(),
            custom_attributes: story.custom_attributes.clone(),
            format_options: story.format_options.clone(),
            id: story.id.clone(),
            ifid: story.ifid.clone(),
            last_update: story.last_update.clone(),
            metadata_json: metadata_to_json(&story.metadata),
            name: story.name.clone(),
            passages: Vec::new(),
            script: String::new(),
            source: String::new(),
            source_layout,
            snap_to_grid: story.snap_to_grid,
            start_passage: story.start_passage.clone(),
            story_format: story.story_format.clone(),
            story_format_version: story.story_format_version.clone(),
            stylesheet: String::new(),
            tag_colors: story.tag_colors.clone(),
            tags: story.tags.clone(),
            zoom: story.zoom,
        }
    }

    fn into_story(
        self,
        root: &Path,
        options: LoadProjectOptions,
    ) -> Result<LoadedStory, StoreError> {
        let source_story_id = self.id.as_ref().to_owned();
        let preparation_started = Instant::now();

        for relative in std::iter::once(self.script.as_str())
            .chain(std::iter::once(self.stylesheet.as_str()))
            .chain(
                (self.source_layout == ProjectSourceLayout::SingleTwee)
                    .then_some(self.source.as_str()),
            )
            .chain(
                (self.source_layout == ProjectSourceLayout::PassageFiles)
                    .then_some(self.passages.iter().map(|passage| passage.file.as_str()))
                    .into_iter()
                    .flatten(),
            )
            .filter(|relative| !relative.is_empty())
        {
            safe_project_relative_path(relative)?;
        }
        let source_job_prepare_us = elapsed_us(preparation_started);
        let mut files = Vec::new();
        let story_sources_started = Instant::now();
        let script = if options.loads_full_content() {
            read_project_file(
                root,
                &self.script,
                "script",
                Some(&source_story_id),
                None,
                &mut files,
            )?
            .unwrap_or_default()
        } else {
            String::new()
        };
        let stylesheet = if options.loads_full_content() {
            read_project_file(
                root,
                &self.stylesheet,
                "stylesheet",
                Some(&source_story_id),
                None,
                &mut files,
            )?
            .unwrap_or_default()
        } else {
            String::new()
        };
        let story_source_us = elapsed_us(story_sources_started);
        let story_source_count = files.len();
        let mut story = Story {
            color: self.color,
            custom_attributes: self.custom_attributes,
            format_options: self.format_options,
            id: self.id,
            ifid: self.ifid,
            last_update: self.last_update,
            metadata: metadata_from_json(self.metadata_json),
            name: self.name,
            passages: Vec::new().into(),
            script,
            snap_to_grid: self.snap_to_grid,
            start_passage: self.start_passage,
            story_format: self.story_format,
            story_format_version: self.story_format_version,
            stylesheet,
            tags: self.tags,
            tag_colors: self.tag_colors,
            zoom: self.zoom,
        };

        let passage_count = self.passages.len();
        let parallel = self.source_layout == ProjectSourceLayout::PassageFiles
            && options.loads_full_content()
            && passage_count >= PARALLEL_SOURCE_THRESHOLD;
        let passage_sources_started = Instant::now();
        let (passages, passage_files) = match self.source_layout {
            ProjectSourceLayout::PassageFiles if parallel => {
                let passage_results = project_load_pool().install(|| {
                    self.passages
                        .into_par_iter()
                        .map(|passage| passage.into_passage(root, &story.id, options))
                        .collect::<Vec<_>>()
                });

                collect_loaded_passages(passage_results)?
            }
            ProjectSourceLayout::PassageFiles => {
                let passage_results = self
                    .passages
                    .into_iter()
                    .map(|passage| passage.into_passage(root, &story.id, options))
                    .collect::<Vec<_>>();

                collect_loaded_passages(passage_results)?
            }
            ProjectSourceLayout::SingleTwee if options.loads_full_content() => {
                let mut source_files = Vec::with_capacity(1);
                let source = read_project_file(
                    root,
                    &self.source,
                    "passage",
                    Some(story.id.as_ref()),
                    None,
                    &mut source_files,
                )?
                .unwrap_or_default();
                let parsed_story = story_from_twee_named(&source, &story.name)?;

                (
                    apply_single_twee_story(&mut story, self.passages, parsed_story),
                    source_files,
                )
            }
            ProjectSourceLayout::SingleTwee => (
                self.passages
                    .into_iter()
                    .map(|passage| passage.into_shell_passage(&story.id))
                    .collect(),
                Vec::new(),
            ),
        };
        let passage_source_count = passage_files.len();

        files.extend(passage_files);
        let passage_source_us = if options.loads_full_content() {
            elapsed_us(passage_sources_started)
        } else {
            0
        };
        let source_bytes = files.iter().map(|file| file.size_bytes).sum();

        story.passages = passages.into();

        Ok(LoadedStory {
            files,
            parallel,
            passage_source_count,
            passage_source_us,
            source_bytes,
            source_job_prepare_us,
            story,
            story_source_count,
            story_source_us,
            worker_count: if parallel {
                project_load_pool().current_num_threads()
            } else {
                1
            },
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct PassageFile {
    #[serde(default)]
    custom_attributes: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    file: String,
    #[serde(default)]
    id: PassageId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    metadata_json: Option<String>,
    #[serde(default)]
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_pid: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
}

impl PassageFile {
    fn from_passage(passage: &Passage, file: PathBuf) -> Self {
        Self {
            custom_attributes: passage.custom_attributes.clone(),
            file: path_string(&file),
            id: passage.id.clone(),
            metadata_json: metadata_to_json(&passage.metadata),
            name: passage.name.clone(),
            source_pid: passage.source_pid.clone(),
            tags: passage.tags.clone(),
        }
    }

    fn into_passage(
        self,
        root: &Path,
        story_id: &StoryId,
        options: LoadProjectOptions,
    ) -> Result<LoadedPassage, StoreError> {
        let source_passage_id = self.id.as_ref().to_owned();
        let mut files = Vec::with_capacity(1);
        let passage = Passage {
            custom_attributes: self.custom_attributes,
            id: self.id,
            layout: None,
            metadata: metadata_from_json(self.metadata_json),
            name: self.name,
            source_pid: self.source_pid,
            story: story_id.clone(),
            tags: self.tags,
            text: if options.loads_full_content() {
                read_project_file(
                    root,
                    &self.file,
                    "passage",
                    Some(story_id.as_ref()),
                    Some(&source_passage_id),
                    &mut files,
                )?
                .unwrap_or_default()
            } else {
                String::new()
            },
        };

        Ok(LoadedPassage { files, passage })
    }

    fn into_shell_passage(self, story_id: &StoryId) -> Passage {
        Passage {
            custom_attributes: self.custom_attributes,
            id: self.id,
            layout: None,
            metadata: metadata_from_json(self.metadata_json),
            name: self.name,
            source_pid: self.source_pid,
            story: story_id.clone(),
            tags: self.tags,
            text: String::new(),
        }
    }
}

struct LoadedPassage {
    files: Vec<LoadedProjectFile>,
    passage: Passage,
}

fn collect_loaded_passages(
    passage_results: Vec<Result<LoadedPassage, StoreError>>,
) -> Result<(Vec<Passage>, Vec<LoadedProjectFile>), StoreError> {
    let mut passages = Vec::with_capacity(passage_results.len());
    let mut files = Vec::with_capacity(passage_results.len());

    for result in passage_results {
        let loaded = result?;

        files.extend(loaded.files);
        passages.push(loaded.passage);
    }

    Ok((passages, files))
}

fn apply_single_twee_story(
    story: &mut Story,
    manifest_passages: Vec<PassageFile>,
    parsed_story: Story,
) -> Vec<Passage> {
    let parsed_start_name = parsed_story
        .passage_by_id(&parsed_story.start_passage)
        .map(|passage| passage.name.clone());
    let Story {
        ifid,
        metadata,
        name,
        passages,
        story_format,
        story_format_version,
        tag_colors,
        zoom,
        ..
    } = parsed_story;
    let mut parsed_passages = passages.iter().cloned().collect::<Vec<_>>();
    let mut manifest_passages = manifest_passages.into_iter().map(Some).collect::<Vec<_>>();

    story.ifid = ifid;
    story.metadata.extend(metadata);
    story.name = name;
    story.story_format = story_format;
    story.story_format_version = story_format_version;
    story.tag_colors = tag_colors;
    story.zoom = zoom;

    for (index, passage) in parsed_passages.iter_mut().enumerate() {
        passage.story = story.id.clone();
        let mapping_index = manifest_passages
            .iter()
            .position(|mapping| {
                mapping
                    .as_ref()
                    .is_some_and(|mapping| mapping.name == passage.name)
            })
            .or_else(|| {
                manifest_passages
                    .get(index)
                    .is_some_and(Option::is_some)
                    .then_some(index)
            });
        let Some(mapping_index) = mapping_index else {
            continue;
        };
        let mapping = manifest_passages[mapping_index]
            .take()
            .expect("matched passage mapping should exist");
        let mut metadata = metadata_from_json(mapping.metadata_json);

        metadata.extend(std::mem::take(&mut passage.metadata));
        passage.custom_attributes = mapping.custom_attributes;
        passage.id = mapping.id;
        passage.metadata = metadata;
        passage.source_pid = mapping.source_pid;
    }

    if let Some(start_name) = parsed_start_name
        && let Some(start) = parsed_passages
            .iter()
            .find(|passage| passage.name == start_name)
    {
        story.start_passage = start.id.clone();
    }

    parsed_passages
}

fn metadata_to_json(metadata: &BTreeMap<String, Value>) -> Option<String> {
    if metadata.is_empty() {
        None
    } else {
        serde_json::to_string(metadata).ok()
    }
}

fn metadata_from_json(value: Option<String>) -> BTreeMap<String, Value> {
    value
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

fn read_project_file(
    root: &Path,
    relative: &str,
    kind: &'static str,
    story_id: Option<&str>,
    passage_id: Option<&str>,
    files: &mut Vec<LoadedProjectFile>,
) -> Result<Option<String>, StoreError> {
    if relative.is_empty() {
        return Ok(None);
    }

    let relative = safe_project_relative_path(relative)?;
    let path = root.join(&relative);
    let mut file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(StoreError::ProjectFileRead {
                path: relative,
                source: error,
            });
        }
    };
    let metadata = file
        .metadata()
        .map_err(|source| StoreError::ProjectFileRead {
            path: relative.clone(),
            source,
        })?;
    let mut value = String::new();

    file.read_to_string(&mut value)
        .map_err(|source| StoreError::ProjectFileRead {
            path: relative.clone(),
            source,
        })?;
    files.push(LoadedProjectFile {
        kind,
        modified_at: metadata.modified().unwrap_or(UNIX_EPOCH),
        passage_id: passage_id.map(str::to_owned),
        path: relative,
        size_bytes: metadata.len(),
        story_id: story_id.map(str::to_owned),
    });
    Ok(Some(value))
}

fn safe_project_relative_path(relative: &str) -> Result<PathBuf, StoreError> {
    let path = Path::new(relative);
    let mut safe_path = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Normal(value) => safe_path.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(StoreError::UnsafeProjectPath(path.to_path_buf()));
            }
        }
    }

    Ok(safe_path)
}

fn unique_passage_file(
    index: usize,
    passage: &Passage,
    used_files: &mut BTreeSet<String>,
) -> String {
    let base = format!("{:04}-{}.twee", index + 1, slugify(&passage.name));
    let mut candidate = base.clone();

    for suffix in 1.. {
        if used_files.insert(candidate.clone()) {
            return candidate;
        }

        candidate = format!("{:04}-{}-{suffix}.twee", index + 1, slugify(&passage.name));
    }

    unreachable!("infinite iterator should return");
}

fn unique_component(name: &str, id: &str) -> String {
    let slug = slugify(name);

    if slug == "untitled" || slug == "item" {
        slugify(id)
    } else {
        slug
    }
}

fn unique_story_components(
    stories: &[Story],
    previous_project_file: Option<&ProjectFile>,
) -> Vec<String> {
    let mut used = BTreeSet::new();
    let mut components = stories
        .iter()
        .map(|story| {
            previous_project_file
                .and_then(|project_file| {
                    project_file
                        .stories
                        .iter()
                        .find(|candidate| candidate.id == story.id)
                })
                .and_then(existing_story_component)
                .filter(|component| used.insert(component.to_ascii_lowercase()))
        })
        .collect::<Vec<_>>();

    for (story, component) in stories.iter().zip(&mut components) {
        if component.is_some() {
            continue;
        }

        *component = Some({
            let base = unique_component(&story.name, story.id.as_ref());

            if used.insert(base.to_ascii_lowercase()) {
                base
            } else {
                let digest = Sha256::digest(story.id.as_ref().as_bytes());
                let suffix = digest[..6]
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>();
                let max_base_len = 64usize.saturating_sub(suffix.len() + 1);
                let shortened = base[..base.len().min(max_base_len)].trim_end_matches('-');
                let collision_base = format!("{shortened}-{suffix}");
                let mut candidate = collision_base.clone();
                let mut sequence = 2;

                loop {
                    if used.insert(candidate.to_ascii_lowercase()) {
                        break candidate;
                    }

                    candidate = format!("{collision_base}-{sequence}");
                    sequence += 1;
                }
            }
        });
    }

    components
        .into_iter()
        .map(|component| component.expect("every story component should be assigned"))
        .collect()
}

fn existing_story_component(story: &StoryFile) -> Option<String> {
    let path = Path::new(&story.script);

    if path.parent() != Some(Path::new("scripts"))
        || !path.extension()?.to_str()?.eq_ignore_ascii_case("js")
    {
        return None;
    }

    let component = path.file_stem()?.to_str()?;

    (!component.is_empty()).then(|| component.to_owned())
}

fn project_path_collision_key(path: &Path) -> String {
    path_string(path).to_ascii_lowercase()
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();

    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }

        if slug.len() >= 64 {
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

fn path_string(path: &Path) -> String {
    path.iter()
        .map(|component| component.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn temp_project_path(root: &Path) -> PathBuf {
    let parent = root.parent().unwrap_or_else(|| Path::new("."));
    let name = root
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| "twine-project".into());

    parent.join(format!(".{name}.save-{}", timestamp()))
}

fn backup_dir(root: &Path) -> PathBuf {
    let parent = root.parent().unwrap_or_else(|| Path::new("."));
    let name = root
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| "twine-project".into());

    parent.join(format!(".{name}.backups"))
}

fn install_prepared_project_root<F>(
    root: &Path,
    prepared_root: &Path,
    displaced_root: &Path,
    keep_displaced: bool,
    mut rename: F,
) -> Result<(), StoreError>
where
    F: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    let root_existed = root.exists();

    if root_existed {
        rename(root, displaced_root)?;
    } else if let Some(parent) = root.parent() {
        fs::create_dir_all(parent)?;
    }

    if let Err(install_error) = rename(prepared_root, root) {
        if root_existed && let Err(rollback_error) = rename(displaced_root, root) {
            return Err(StoreError::ProjectInstallRollback {
                root: root.to_path_buf(),
                recovery_path: displaced_root.to_path_buf(),
                install_error,
                rollback_error,
            });
        }

        if prepared_root.exists() {
            let _ = fs::remove_dir_all(prepared_root);
        }
        return Err(StoreError::Io(install_error));
    }

    if root_existed && !keep_displaced && displaced_root.exists() {
        fs::remove_dir_all(displaced_root)?;
    }

    Ok(())
}

fn prune_backups(root: &Path, max_backups: usize) -> Result<(), StoreError> {
    let backup_dir = backup_dir(root);

    if max_backups == 0 || !backup_dir.exists() {
        return Ok(());
    }

    let mut backups = fs::read_dir(&backup_dir)?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .collect::<Vec<_>>();

    backups.sort_by_key(|entry| entry.file_name());

    while backups.len() > max_backups {
        let entry = backups.remove(0);

        fs::remove_dir_all(entry.path())?;
    }

    Ok(())
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}

fn collect_files(root: &Path) -> Result<BTreeSet<PathBuf>, StoreError> {
    let mut files = BTreeSet::new();

    if !root.exists() {
        return Ok(files);
    }

    collect_files_inner(root, root, &mut files)?;
    Ok(files)
}

fn collect_directories(root: &Path) -> Result<BTreeSet<PathBuf>, StoreError> {
    let mut directories = BTreeSet::new();

    if root.exists() {
        collect_directories_inner(root, root, &mut directories)?;
    }

    Ok(directories)
}

fn collect_directories_inner(
    root: &Path,
    current: &Path,
    directories: &mut BTreeSet<PathBuf>,
) -> Result<(), StoreError> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;

        if entry.file_type()?.is_dir() {
            let path = entry.path();

            directories.insert(
                path.strip_prefix(root)
                    .expect("collected directory should be under root")
                    .to_path_buf(),
            );
            collect_directories_inner(root, &path, directories)?;
        }
    }

    Ok(())
}

fn collect_files_inner(
    root: &Path,
    current: &Path,
    files: &mut BTreeSet<PathBuf>,
) -> Result<(), StoreError> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            collect_files_inner(root, &path, files)?;
        } else if file_type.is_file() || file_type.is_symlink() {
            files.insert(
                path.strip_prefix(root)
                    .expect("collected file should be under root")
                    .to_path_buf(),
            );
        }
    }

    Ok(())
}

fn file_sets_equal(
    left_root: &Path,
    left_files: &BTreeSet<PathBuf>,
    right_root: &Path,
    right_files: &BTreeSet<PathBuf>,
) -> Result<bool, StoreError> {
    if left_files != right_files {
        return Ok(false);
    }

    for file in left_files {
        if !project_entries_equal(&left_root.join(file), &right_root.join(file))? {
            return Ok(false);
        }
    }

    Ok(true)
}

fn changed_files(
    left_root: &Path,
    left_files: &BTreeSet<PathBuf>,
    right_root: &Path,
    right_files: &BTreeSet<PathBuf>,
) -> Result<Vec<PathBuf>, StoreError> {
    let mut changed = BTreeSet::new();

    for file in left_files.union(right_files) {
        let left = left_root.join(file);
        let right = right_root.join(file);
        let left_exists = fs::symlink_metadata(&left).is_ok();
        let right_exists = fs::symlink_metadata(&right).is_ok();
        let is_changed = match (left_exists, right_exists) {
            (true, true) => !project_entries_equal(&left, &right)?,
            (false, false) => false,
            _ => true,
        };

        if is_changed {
            changed.insert(file.clone());
        }
    }

    Ok(changed.into_iter().collect())
}

fn project_entries_equal(left: &Path, right: &Path) -> Result<bool, StoreError> {
    let left_type = fs::symlink_metadata(left)?.file_type();
    let right_type = fs::symlink_metadata(right)?.file_type();

    if left_type.is_dir() || right_type.is_dir() {
        return Ok(left_type.is_dir() && right_type.is_dir());
    }
    if left_type.is_symlink() || right_type.is_symlink() {
        return Ok(left_type.is_symlink()
            && right_type.is_symlink()
            && project_symlink_kinds_equal(&left_type, &right_type)
            && fs::read_link(left)? == fs::read_link(right)?);
    }
    if !left_type.is_file() || !right_type.is_file() {
        return Ok(false);
    }

    Ok(fs::read(left)? == fs::read(right)?)
}

#[cfg(windows)]
fn project_symlink_kinds_equal(left: &fs::FileType, right: &fs::FileType) -> bool {
    use std::os::windows::fs::FileTypeExt;

    left.is_symlink_dir() == right.is_symlink_dir()
        && left.is_symlink_file() == right.is_symlink_file()
}

#[cfg(not(windows))]
fn project_symlink_kinds_equal(_left: &fs::FileType, _right: &fs::FileType) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "twine-{label}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ))
    }

    fn story() -> Story {
        serde_json::from_str(
            r#"{
				"ifid": "IFID",
				"id": "story-1",
				"lastUpdate": "2026-01-01T00:00:00.000Z",
				"name": "Example",
				"passages": [{
					"height": 100,
					"highlighted": false,
					"id": "passage-1",
					"left": 25,
					"name": "Start",
					"selected": false,
					"story": "story-1",
					"tags": ["hub"],
					"text": "[[Next]]",
					"top": 25,
					"width": 100
				}],
				"script": "alert(1)",
				"selected": false,
				"snapToGrid": true,
				"startPassage": "passage-1",
				"storyFormat": "Harlowe",
				"storyFormatVersion": "3.3.9",
				"stylesheet": "body {}",
				"tags": ["benchmark"],
				"tagColors": {},
				"zoom": 1
			}"#,
        )
        .expect("story should deserialize")
    }

    #[test]
    fn loads_story_json_from_path() {
        let path = temp_path("story-json").with_extension("json");

        fs::write(
            &path,
            r#"{
				"ifid": "IFID",
				"id": "story-1",
				"lastUpdate": "2026-01-01T00:00:00.000Z",
				"name": "Example",
				"passages": [],
				"script": "",
				"selected": false,
				"snapToGrid": true,
				"startPassage": "",
				"storyFormat": "Harlowe",
				"storyFormatVersion": "3.3.9",
				"stylesheet": "",
				"tags": [],
				"tagColors": {},
				"zoom": 1
			}"#,
        )
        .expect("temp story should be written");

        let story = load_story_json_path(&path).expect("story should load");

        fs::remove_file(path).expect("temp story should be removed");
        assert_eq!(story.name, "Example");
    }

    #[test]
    fn saves_and_loads_canonical_project_layout() {
        let root = temp_path("project");
        let story = story();
        let mut project = Project::from_story(story.clone());

        project.manifest.storage.message = "local only".into();

        let report = save_project_path(&root, &project, &SaveOptions::default())
            .expect("project should save");

        assert!(report.dirty);
        assert_eq!(report.storage_message, "local only");
        assert!(root.join("twine.toml").exists());
        assert!(root.join("passages/example/0001-start.twee").exists());
        assert!(root.join("scripts/example.js").exists());
        assert!(root.join("styles/example.css").exists());
        assert!(root.join("assets").is_dir());
        assert!(root.join(".twine/cache/graph/example.graph.json").exists());
        assert!(root.join(MANIFEST_CACHE_FILE).exists());
        assert!(root.join(".twine/graph.json").exists());

        let loaded = load_project_path(&root).expect("project should load");

        assert_eq!(loaded.stories.len(), 1);
        assert_eq!(loaded.stories[0].script, story.script);
        assert_eq!(loaded.stories[0].stylesheet, story.stylesheet);
        assert_eq!(loaded.stories[0].passages[0].text, story.passages[0].text);
        assert_eq!(
            loaded.stories[0].passages[0].layout.expect("layout").left,
            25.0
        );

        let loaded_with_receipt =
            load_project_path_with_receipt(&root, LoadProjectOptions::default())
                .expect("project and receipt should load");
        let receipt_paths = loaded_with_receipt
            .files
            .iter()
            .map(|file| (file.kind, path_string(&file.path)))
            .collect::<BTreeSet<_>>();

        assert!(receipt_paths.contains(&("manifest", "twine.toml".into())));
        assert!(receipt_paths.contains(&("passage", "passages/example/0001-start.twee".into())));
        assert!(receipt_paths.contains(&("script", "scripts/example.js".into())));
        assert!(receipt_paths.contains(&("stylesheet", "styles/example.css".into())));
        assert!(receipt_paths.contains(&("graph", ".twine/graph.json".into())));
        assert!(!loaded_with_receipt.timings.parallel);
        assert_eq!(loaded_with_receipt.timings.worker_count, 1);
        assert!(loaded_with_receipt.timings.manifest_cache_hit);
        assert_eq!(loaded_with_receipt.timings.manifest_toml_parse_us, 0);

        let clean_report = save_project_path(&root, &project, &SaveOptions::default())
            .expect("unchanged project should save");

        assert!(!clean_report.dirty);

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn direct_save_promotes_manifest_before_writing_scoped_layouts() {
        let root = temp_path("direct-save-schema-promotion");
        let mut project = Project::from_story(story());

        project.manifest.schema_version = 1;
        save_project_path(&root, &project, &SaveOptions::default())
            .expect("direct project save should succeed");
        let manifest = fs::read_to_string(root.join(MANIFEST_FILE)).expect("manifest should read");
        let graph: Value = serde_json::from_str(
            &fs::read_to_string(root.join(GRAPH_LAYOUT_FILE)).expect("graph should read"),
        )
        .expect("graph should parse");

        assert!(manifest.contains(&format!("schema_version = {PROJECT_SCHEMA_VERSION}")));
        assert_eq!(graph["passages"]["schema"], 2);

        fs::remove_dir_all(root).expect("direct-save fixture cleanup");
    }

    #[test]
    fn writes_exact_source_files_for_both_project_layouts() {
        let passage_root = temp_path("passage-layout-files");
        let single_root = temp_path("single-layout-files");
        let mut source_story = story();

        source_story
            .passages
            .get_mut(&PassageId::new("passage-1"))
            .expect("start passage")
            .layout = None;
        let passage_project = Project::from_story(source_story.clone());
        let mut single_project = Project::from_story(source_story);

        single_project
            .manifest
            .set_source_layout(StoryId::new("story-1"), ProjectSourceLayout::SingleTwee);
        let options = SaveOptions {
            create_backup: false,
            max_backups: 0,
            write_generated_indexes: false,
        };

        save_project_path(&passage_root, &passage_project, &options)
            .expect("passage-files project should save");
        save_project_path(&single_root, &single_project, &options)
            .expect("single-twee project should save");

        assert_eq!(
            collect_files(&passage_root).expect("passage file set"),
            BTreeSet::from([
                PathBuf::from("passages/example/0001-start.twee"),
                PathBuf::from("scripts/example.js"),
                PathBuf::from("styles/example.css"),
                PathBuf::from("twine.toml"),
            ])
        );
        assert_eq!(
            collect_files(&single_root).expect("single file set"),
            BTreeSet::from([
                PathBuf::from("scripts/example.js"),
                PathBuf::from("story.twee"),
                PathBuf::from("styles/example.css"),
                PathBuf::from("twine.toml"),
            ])
        );
        assert!(!single_root.join("passages").exists());

        let passage_manifest =
            fs::read_to_string(passage_root.join("twine.toml")).expect("passage manifest");
        let single_manifest =
            fs::read_to_string(single_root.join("twine.toml")).expect("single manifest");

        assert!(!passage_manifest.contains("source_layout = "));
        assert!(!passage_manifest.contains("\nsource = "));
        assert!(single_manifest.contains("source_layout = \"single-twee\""));
        assert!(single_manifest.contains("source = \"story.twee\""));

        fs::remove_dir_all(passage_root).expect("passage project cleanup");
        fs::remove_dir_all(single_root).expect("single project cleanup");
    }

    #[test]
    fn single_twee_roundtrips_standard_story_and_retains_layout_on_resave() {
        let root = temp_path("single-roundtrip");
        let original = story();
        let original_passage_id = original.passages[0].id.clone();
        let mut project = Project::from_story(original.clone());

        project
            .manifest
            .set_source_layout(original.id.clone(), ProjectSourceLayout::SingleTwee);
        save_project_path(&root, &project, &SaveOptions::default())
            .expect("single-twee project should save");
        let source = fs::read_to_string(root.join("story.twee")).expect("aggregate source");

        assert!(source.contains(":: StoryTitle\nExample"));
        assert!(source.contains(":: StoryData\n"));
        assert!(source.contains(r#""ifid": "IFID""#));
        assert!(source.contains(r#""format": "Harlowe""#));
        assert!(source.contains(r#""format-version": "3.3.9""#));
        assert!(source.contains(r#""start": "Start""#));
        assert!(!source.contains("alert(1)"));
        assert!(!source.contains("body {}"));

        let mut loaded = load_project_path(&root).expect("single-twee project should load");

        assert_eq!(
            loaded.manifest.source_layout_for(&original.id),
            ProjectSourceLayout::SingleTwee
        );
        assert_eq!(loaded.stories[0].passages[0].id, original_passage_id);
        assert_eq!(loaded.stories[0].passages[0].story, original.id);
        assert_eq!(loaded.stories[0].script, original.script);
        assert_eq!(loaded.stories[0].stylesheet, original.stylesheet);
        loaded.stories[0]
            .passages
            .get_mut(&original_passage_id)
            .expect("loaded start passage")
            .text = "Changed after load".into();

        save_project_path(&root, &loaded, &SaveOptions::default())
            .expect("loaded project should resave");
        let manifest = fs::read_to_string(root.join("twine.toml")).expect("manifest");

        assert!(manifest.contains("source_layout = \"single-twee\""));
        assert!(manifest.contains("source = \"story.twee\""));
        assert!(!root.join("passages").exists());
        assert!(
            fs::read_to_string(root.join("story.twee"))
                .expect("resaved source")
                .contains("Changed after load")
        );

        fs::remove_dir_all(root).expect("single project cleanup");
    }

    #[test]
    fn single_twee_preserves_custom_sections_and_stabilizes_external_passage_ids() {
        let root = temp_path("single-preservation");
        let mut project = Project::from_story(story());

        project
            .manifest
            .set_source_layout(StoryId::new("story-1"), ProjectSourceLayout::SingleTwee);
        save_project_path(&root, &project, &SaveOptions::default())
            .expect("single-twee project should save");

        let mut source = fs::read_to_string(root.join("story.twee")).expect("aggregate source");

        source.push_str(
            "\n\n:: External Notes {\"tool\":{\"version\":7}}\nKeep  spacing exactly  \n\
             \n:: External Script [script]\nwindow.external = true;\n\
             \n:: Added Externally [external] {\"reviewed\":true}\nNew passage\n",
        );
        fs::write(root.join("story.twee"), source).expect("external edit should write");

        let mut loaded = load_project_path(&root).expect("externally edited source should load");
        let added_id = loaded.stories[0]
            .passages
            .iter()
            .find(|passage| passage.name == "Added Externally")
            .expect("external passage should load")
            .id
            .clone();

        assert_eq!(
            loaded.stories[0]
                .passages
                .iter()
                .find(|passage| passage.name == "Added Externally")
                .expect("external passage")
                .story,
            StoryId::new("story-1")
        );
        loaded.stories[0]
            .passages
            .get_mut(&PassageId::new("passage-1"))
            .expect("start passage")
            .text = "Changed modeled body".into();
        save_project_path(&root, &loaded, &SaveOptions::default())
            .expect("externally edited project should resave");
        let resaved = fs::read_to_string(root.join("story.twee")).expect("resaved source");

        assert!(
            resaved
                .contains(":: External Notes {\"tool\":{\"version\":7}}\nKeep  spacing exactly  ")
        );
        assert!(resaved.contains(":: External Script [script]\nwindow.external = true;"));
        assert!(
            resaved.contains(":: Added Externally [external] {\"reviewed\":true}\nNew passage")
        );

        let reloaded = load_project_path(&root).expect("resaved project should reload");
        let reloaded_added = reloaded.stories[0]
            .passages
            .iter()
            .find(|passage| passage.name == "Added Externally")
            .expect("external passage should remain");

        assert_eq!(reloaded_added.id, added_id);
        assert_eq!(reloaded_added.metadata["reviewed"], Value::Bool(true));

        fs::remove_dir_all(root).expect("single project cleanup");
    }

    #[test]
    fn legacy_manifest_defaults_to_passage_files() {
        let root = temp_path("legacy-layout-default");

        fs::create_dir_all(root.join("passages/example"))
            .expect("legacy passage directory should create");
        fs::write(root.join("passages/example/start.twee"), "Legacy body")
            .expect("legacy passage should write");
        fs::write(
            root.join("twine.toml"),
            r#"
name = "Legacy"

[[stories]]
id = "story-1"
name = "Example"
start_passage = "passage-1"

[[stories.passages]]
id = "passage-1"
name = "Start"
file = "passages/example/start.twee"
"#,
        )
        .expect("legacy manifest should write");

        let loaded = load_project_path(&root).expect("legacy project should load");

        assert_eq!(
            loaded.manifest.source_layout_for(&StoryId::new("story-1")),
            ProjectSourceLayout::PassageFiles
        );
        assert_eq!(loaded.stories[0].passages[0].text, "Legacy body");

        fs::remove_dir_all(root).expect("legacy project cleanup");
    }

    #[test]
    fn migrates_legacy_flat_layouts_for_colliding_passage_ids() {
        let root = temp_path("legacy-scoped-layout");
        let first = story();
        let mut second = story();

        second.id = StoryId::new("story-2");
        second.name = "Second".into();
        for passage in &mut second.passages {
            passage.story = second.id.clone();
            passage.name = "Second Start".into();
        }

        let mut project = Project::from_story(first.clone());
        project
            .layout
            .passages
            .append(GraphLayout::from_story_layout(&second).passages);
        project.stories.push(second.clone());
        project.manifest.schema_version = 1;
        save_project_path(&root, &project, &SaveOptions::default())
            .expect("two-story project should save");
        fs::write(
            root.join(GRAPH_LAYOUT_FILE),
            r#"{
                "passages": {
                    "passage-1": {
                        "bounds": {"height": 100, "left": 432, "top": 25, "width": 100}
                    },
                    "deleted-passage": {
                        "bounds": {"height": 100, "left": 999, "top": 25, "width": 100}
                    }
                }
            }"#,
        )
        .expect("legacy graph layout should write");

        let loaded = load_project_path(&root).expect("legacy graph layout should migrate");

        assert_eq!(loaded.manifest.schema_version, PROJECT_SCHEMA_VERSION);
        assert_eq!(loaded.layout.passages.len(), 2);
        for story_id in [&first.id, &second.id] {
            assert_eq!(
                loaded
                    .layout
                    .passages
                    .get(story_id, &PassageId::new("passage-1"))
                    .expect("matching legacy layout should be scoped")
                    .bounds
                    .left,
                432.0
            );
        }

        save_project_path(&root, &loaded, &SaveOptions::default())
            .expect("migrated project should save");
        let graph: Value = serde_json::from_str(
            &fs::read_to_string(root.join(GRAPH_LAYOUT_FILE)).expect("migrated graph should read"),
        )
        .expect("migrated graph should parse");

        assert!(graph["passages"]["byStory"]["story-1"]["passage-1"].is_object());
        assert!(graph["passages"]["byStory"]["story-2"]["passage-1"].is_object());
        assert!(graph["passages"].get("legacy").is_none());

        fs::remove_dir_all(root).expect("legacy scoped project cleanup");
    }

    #[test]
    fn upgrades_schema_before_an_empty_layout_uses_scoped_serialization() {
        let root = temp_path("empty-scoped-layout");
        let mut project = Project::from_story(story());

        project.layout.passages.clear();
        project.manifest.schema_version = 1;
        save_project_path(&root, &project, &SaveOptions::default())
            .expect("schema-one empty-layout fixture should save");

        let loaded = load_project_path(&root).expect("empty layout project should load");

        assert_eq!(loaded.manifest.schema_version, PROJECT_SCHEMA_VERSION);
        assert!(loaded.layout.passages.is_empty());

        save_project_path(&root, &loaded, &SaveOptions::default())
            .expect("upgraded empty layout should save");
        let manifest = fs::read_to_string(root.join(MANIFEST_FILE)).expect("manifest should read");

        assert!(manifest.contains(&format!("schema_version = {PROJECT_SCHEMA_VERSION}")));

        fs::remove_dir_all(root).expect("empty scoped project cleanup");
    }

    #[test]
    fn compiled_manifest_cache_is_validated_and_never_bypasses_path_safety() {
        let root = temp_path("manifest-cache");
        let project = Project::from_story(story());

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        let cache_path = root.join(MANIFEST_CACHE_FILE);
        let manifest_path = root.join(MANIFEST_FILE);
        let valid_cache = fs::read(&cache_path).expect("cache should be readable");
        let original_manifest = fs::read_to_string(&manifest_path).expect("manifest should read");

        fs::write(&cache_path, b"not json").expect("corrupt cache should write");
        let corrupt = load_project_path_with_receipt(&root, LoadProjectOptions::shell())
            .expect("corrupt cache should fall back to TOML");

        assert!(!corrupt.timings.manifest_cache_hit);
        assert_eq!(
            corrupt.timings.manifest_cache_miss_reason.as_deref(),
            Some("invalidCache")
        );
        assert!(corrupt.timings.manifest_toml_parse_us > 0);

        fs::write(&cache_path, &valid_cache).expect("valid cache should be restored");
        let changed_manifest =
            original_manifest.replacen("name = \"Example\"", "name = \"Changed\"", 1);

        assert_eq!(changed_manifest.len(), original_manifest.len());
        fs::write(&manifest_path, &changed_manifest).expect("changed manifest should write");
        let changed = load_project_path_with_receipt(&root, LoadProjectOptions::shell())
            .expect("same-size manifest change should parse authoritative TOML");

        assert!(!changed.timings.manifest_cache_hit);
        assert_eq!(
            changed.timings.manifest_cache_miss_reason.as_deref(),
            Some("hashMismatch")
        );

        fs::write(&manifest_path, &original_manifest).expect("manifest should be restored");
        let mut unsafe_cache: CompiledProjectManifest =
            serde_json::from_slice(&valid_cache).expect("valid cache should parse");

        unsafe_cache.project.stories[0].passages[0].file = "../outside.twee".into();
        fs::write(
            &cache_path,
            serde_json::to_vec(&unsafe_cache).expect("unsafe cache should serialize"),
        )
        .expect("unsafe cache should write");
        let error = load_project_path_with_receipt(&root, LoadProjectOptions::full())
            .expect_err("unsafe cached path should be rejected");

        assert!(matches!(error, StoreError::UnsafeProjectPath(_)));

        fs::remove_file(&cache_path).expect("cache should be removed");
        let missing = load_project_path_with_receipt(&root, LoadProjectOptions::shell())
            .expect("missing cache should fall back");

        assert_eq!(
            missing.timings.manifest_cache_miss_reason.as_deref(),
            Some("missing")
        );

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn source_only_project_does_not_write_graph_layout() {
        let root = temp_path("source-only-project");
        let story: Story = serde_json::from_str(
            r#"{
                "ifid": "IFID",
                "id": "story-1",
                "name": "Example",
                "passages": [{
                    "id": "passage-1",
                    "name": "Start",
                    "story": "story-1",
                    "text": "Plain text source"
                }],
                "startPassage": "passage-1",
                "storyFormat": "Harlowe",
                "storyFormatVersion": "3.3.9"
            }"#,
        )
        .expect("story should deserialize");
        let project = Project::from_story(story);

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");

        assert!(!root.join(".twine/graph.json").exists());

        let loaded = load_project_path(&root).expect("project should load");

        assert!(loaded.stories[0].passages[0].layout.is_none());

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn can_load_project_shell_without_passage_bodies() {
        let root = temp_path("project-shell");
        let story = story();
        let project = Project::from_story(story.clone());

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");

        let loaded = load_project_path_with_options(&root, LoadProjectOptions::shell())
            .expect("project shell should load");

        assert_eq!(loaded.stories.len(), 1);
        assert!(loaded.stories[0].script.is_empty());
        assert!(loaded.stories[0].stylesheet.is_empty());
        assert_eq!(loaded.stories[0].passages.len(), 1);
        assert_eq!(loaded.stories[0].passages[0].text, "");
        assert!(loaded.stories[0].passages[0].layout.is_none());

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn bounded_parallel_load_preserves_passage_order_and_receipts() {
        let root = temp_path("parallel-project");
        let mut story = story();
        let prototype = story.passages[0].clone();
        let passages = (0..256)
            .map(|index| {
                let mut passage = prototype.clone();

                passage.id = PassageId::new(format!("passage-{index:04}"));
                passage.name = format!("Passage {index:04}");
                passage.text = format!("Source {index:04}");
                passage
            })
            .collect::<Vec<_>>();

        story.start_passage = passages[0].id.clone();
        story.passages = passages.into();
        let project = Project::from_story(story.clone());

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        let loaded = load_project_path_with_receipt(&root, LoadProjectOptions::full())
            .expect("parallel project should load");

        assert!(loaded.timings.parallel);
        assert!(loaded.timings.worker_count <= 8);
        assert_eq!(loaded.timings.passage_source_count, 256);
        assert_eq!(loaded.project.stories[0].passages.len(), 256);
        for (index, passage) in loaded.project.stories[0].passages.iter().enumerate() {
            assert_eq!(passage.name, format!("Passage {index:04}"));
            assert_eq!(passage.text, format!("Source {index:04}"));
        }
        assert_eq!(
            loaded
                .files
                .iter()
                .filter(|file| file.kind == "passage")
                .count(),
            256
        );

        let passage_paths = loaded
            .files
            .iter()
            .filter(|file| file.kind == "passage")
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        fs::write(root.join(&passage_paths[0]), [0xff])
            .expect("first invalid source should be written");
        fs::write(root.join(&passage_paths[100]), [0xff])
            .expect("later invalid source should be written");

        for _ in 0..3 {
            let error = load_project_path_with_receipt(&root, LoadProjectOptions::full())
                .expect_err("invalid source encoding should fail");

            assert!(error.to_string().contains(&path_string(&passage_paths[0])));
        }

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn project_save_preserves_existing_asset_files() {
        let root = temp_path("project-assets");
        let mut project = Project::from_story(story());

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        fs::create_dir_all(root.join("assets/ui")).expect("asset directory should be created");
        fs::write(root.join("assets/cover.png"), b"cover").expect("asset should be written");
        fs::write(root.join("assets/ui/click.wav"), b"sound")
            .expect("nested asset should be written");

        project.stories[0]
            .passages
            .iter_mut()
            .next()
            .expect("story should have a passage")
            .text = "Changed".into();
        save_project_path(&root, &project, &SaveOptions::default()).expect("project should resave");

        assert_eq!(
            fs::read(root.join("assets/cover.png")).expect("asset should remain"),
            b"cover"
        );
        assert_eq!(
            fs::read(root.join("assets/ui/click.wav")).expect("nested asset should remain"),
            b"sound"
        );

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn project_save_preserves_unmanaged_root_and_nested_files() {
        let root = temp_path("project-unmanaged-files");
        let mut project = Project::from_story(story());

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        fs::create_dir_all(root.join(".git/hooks")).expect("nested metadata directory");
        fs::write(root.join("README.md"), b"Project notes\n").expect("readme should write");
        fs::write(root.join(".gitignore"), b"dist/\n").expect("gitignore should write");
        fs::write(root.join("build.toml"), b"target = 'web'\n").expect("config should write");
        fs::write(root.join(".git/config"), b"[core]\n\tbare = false\n")
            .expect("nested metadata should write");
        fs::write(root.join(".git/hooks/pre-commit"), b"#!/bin/sh\n").expect("hook should write");

        project.stories[0].name = "Changed".into();
        let report = save_project_path(
            &root,
            &project,
            &SaveOptions {
                create_backup: false,
                max_backups: 0,
                write_generated_indexes: true,
            },
        )
        .expect("project should resave");

        assert_eq!(
            fs::read(root.join("README.md")).unwrap(),
            b"Project notes\n"
        );
        assert_eq!(fs::read(root.join(".gitignore")).unwrap(), b"dist/\n");
        assert_eq!(
            fs::read(root.join("build.toml")).unwrap(),
            b"target = 'web'\n"
        );
        assert_eq!(
            fs::read(root.join(".git/config")).unwrap(),
            b"[core]\n\tbare = false\n"
        );
        assert_eq!(
            fs::read(root.join(".git/hooks/pre-commit")).unwrap(),
            b"#!/bin/sh\n"
        );
        assert!(!report.changed_files.contains(&PathBuf::from("README.md")));
        assert!(!report.changed_files.contains(&PathBuf::from(".gitignore")));
        assert!(!report.changed_files.contains(&PathBuf::from("build.toml")));
        assert!(!report.changed_files.contains(&PathBuf::from(".git/config")));

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn project_save_preserves_unmanaged_empty_directories() {
        let root = temp_path("project-unmanaged-empty-directory");
        let mut project = Project::from_story(story());

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        fs::create_dir_all(root.join("notes/drafts")).expect("empty directory should be created");

        project.stories[0].script = "changed".into();
        save_project_path(
            &root,
            &project,
            &SaveOptions {
                create_backup: false,
                max_backups: 0,
                write_generated_indexes: true,
            },
        )
        .expect("project should resave");

        assert!(root.join("notes/drafts").is_dir());

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn project_save_rejects_unmanaged_special_files_without_opening_them() {
        use std::process::Command;

        let root = temp_path("project-unmanaged-fifo");
        let mut project = Project::from_story(story());
        let fifo = root.join("external-events");

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        assert!(
            Command::new("mkfifo")
                .arg(&fifo)
                .status()
                .unwrap()
                .success()
        );

        project.stories[0].script = "changed".into();
        let result = save_project_path(&root, &project, &SaveOptions::default());

        assert!(matches!(
            result,
            Err(StoreError::UnsupportedUnmanagedProjectEntry(path))
                if path == PathBuf::from("external-events")
        ));
        assert!(fs::symlink_metadata(&fifo).is_ok());

        fs::remove_file(fifo).expect("fifo should be removed");
        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn project_save_replaces_an_owned_fifo_without_opening_it() {
        use std::process::Command;

        let root = temp_path("project-owned-fifo");
        let mut project = Project::from_story(story());
        let script = root.join("scripts/example.js");

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        fs::remove_file(&script).expect("owned script should be removed");
        assert!(
            Command::new("mkfifo")
                .arg(&script)
                .status()
                .unwrap()
                .success()
        );

        project.stories[0].script = "changed".into();
        save_project_path(
            &root,
            &project,
            &SaveOptions {
                create_backup: false,
                max_backups: 0,
                write_generated_indexes: true,
            },
        )
        .expect("owned fifo should be replaced without opening it");

        assert_eq!(fs::read_to_string(&script).unwrap(), "changed");

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn project_save_recognizes_case_only_changes_to_owned_paths() {
        let root = temp_path("project-owned-path-case-change");
        let mut project = Project::from_story(story());
        let canonical = PathBuf::from("scripts/example.js");
        let case_changed = PathBuf::from("scripts/EXAMPLE.js");

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        fs::rename(root.join(&canonical), root.join(&case_changed))
            .expect("owned script should accept a case-only rename");

        project.stories[0].script = "changed".into();
        save_project_path(
            &root,
            &project,
            &SaveOptions {
                create_backup: false,
                max_backups: 0,
                write_generated_indexes: true,
            },
        )
        .expect("case-only owned path change should not conflict");

        let matching_scripts = collect_files(&root)
            .expect("project files should collect")
            .into_iter()
            .filter(|path| {
                project_path_collision_key(path) == project_path_collision_key(&canonical)
            })
            .collect::<Vec<_>>();

        assert_eq!(matching_scripts.len(), 1);
        assert_eq!(
            fs::read_to_string(root.join(&canonical)).unwrap(),
            "changed"
        );

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn project_save_preserves_case_distinct_files_beside_an_empty_owned_cache() {
        let root = temp_path("project-case-distinct-cache");
        let mut project = Project::from_story(story());
        let options = SaveOptions {
            create_backup: false,
            max_backups: 0,
            write_generated_indexes: false,
        };

        save_project_path(&root, &project, &options).expect("project should save");
        fs::create_dir_all(root.join(GRAPH_CACHE_DIR)).expect("owned cache should be created");
        fs::create_dir_all(root.join(".TWINE/cache/graph"))
            .expect("case-distinct directory should be created");
        fs::write(root.join(".TWINE/cache/graph/notes"), b"unmanaged")
            .expect("case-distinct file should write");

        project.stories[0].script = "changed".into();
        save_project_path(&root, &project, &options).expect("project should resave");

        assert_eq!(
            fs::read(root.join(".TWINE/cache/graph/notes")).unwrap(),
            b"unmanaged"
        );

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn project_save_removes_stale_app_owned_files() {
        let root = temp_path("project-stale-owned-files");
        let project = Project::from_story(story());

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        let source_path = PathBuf::from("passages/example/0001-start.twee");

        assert!(root.join(&source_path).exists());

        let empty_project = Project::default();
        let report = save_project_path(
            &root,
            &empty_project,
            &SaveOptions {
                create_backup: false,
                max_backups: 0,
                write_generated_indexes: true,
            },
        )
        .expect("empty project should replace the prior project");

        assert!(!root.join(&source_path).exists());
        assert!(report.changed_files.contains(&source_path));

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn project_save_allows_an_owned_directory_to_become_an_owned_file() {
        let root = temp_path("project-owned-directory-transition");
        let mut original_project = Project::from_story(story());

        original_project
            .manifest
            .set_source_layout(StoryId::new("story-1"), ProjectSourceLayout::SingleTwee);
        save_project_path(&root, &original_project, &SaveOptions::default())
            .expect("single-source project should save");

        let source = fs::read_to_string(root.join("story.twee")).expect("story source should read");
        fs::remove_file(root.join("story.twee")).expect("flat source should be removed");
        fs::create_dir(root.join("story.twee")).expect("owned source directory should be created");
        fs::write(root.join("story.twee/old.twee"), source)
            .expect("nested owned source should write");
        let mut project_file = read_existing_project_file(&root).expect("manifest should parse");

        project_file.stories[0].source = "story.twee/old.twee".into();
        fs::write(
            root.join(MANIFEST_FILE),
            toml::to_string_pretty(&project_file).expect("manifest should encode"),
        )
        .expect("manifest should update");

        let mut replacement_story = story();
        replacement_story.id = StoryId::new("story-2");
        replacement_story.ifid = "IFID-2".into();
        replacement_story.name = "Replacement".into();
        let mut replacement_project = Project::from_story(replacement_story);

        replacement_project
            .manifest
            .set_source_layout(StoryId::new("story-2"), ProjectSourceLayout::SingleTwee);
        save_project_path(
            &root,
            &replacement_project,
            &SaveOptions {
                create_backup: false,
                max_backups: 0,
                write_generated_indexes: true,
            },
        )
        .expect("owned directory should transition to an owned file");

        assert!(root.join("story.twee").is_file());
        assert_eq!(
            load_project_path(&root).unwrap().stories[0].id,
            StoryId::new("story-2")
        );

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn project_save_rejects_an_unmanaged_file_that_would_become_app_owned() {
        let root = temp_path("project-unmanaged-conflict");
        let mut project = Project::from_story(story());

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        fs::write(root.join("scripts/second.js"), b"externally managed")
            .expect("unmanaged script should write");

        let mut second_story = story();
        second_story.id = StoryId::new("story-2");
        second_story.ifid = "IFID-2".into();
        second_story.name = "Second".into();
        project.stories.push(second_story);
        let result = save_project_path(&root, &project, &SaveOptions::default());

        assert!(matches!(
            result,
            Err(StoreError::UnmanagedFileConflict(path))
                if path == PathBuf::from("scripts/second.js")
        ));
        assert_eq!(
            fs::read(root.join("scripts/second.js")).unwrap(),
            b"externally managed"
        );
        assert_eq!(
            load_project_path(&root)
                .expect("original project should remain loadable")
                .stories
                .len(),
            1
        );

        fs::remove_dir_all(&root).expect("project should be removed");
        let backups = backup_dir(&root);
        if backups.exists() {
            fs::remove_dir_all(backups).expect("backups should be removed");
        }
    }

    #[test]
    fn project_save_rejects_an_unmanaged_directory_that_would_become_a_file() {
        let root = temp_path("project-unmanaged-directory-conflict");
        let mut project = Project::from_story(story());

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        fs::create_dir(root.join("scripts/second.js"))
            .expect("unmanaged empty directory should be created");

        let mut second_story = story();
        second_story.id = StoryId::new("story-2");
        second_story.ifid = "IFID-2".into();
        second_story.name = "Second".into();
        project.stories.push(second_story);
        let result = save_project_path(&root, &project, &SaveOptions::default());

        assert!(matches!(
            result,
            Err(StoreError::UnmanagedFileConflict(path))
                if path == PathBuf::from("scripts/second.js")
        ));
        assert!(root.join("scripts/second.js").is_dir());
        assert_eq!(
            load_project_path(&root)
                .expect("original project should remain loadable")
                .stories
                .len(),
            1
        );

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn story_owned_paths_separate_normalized_name_collisions_and_stay_stable() {
        let root = temp_path("story-path-collisions");
        let long_upper = format!("{}:One", "A".repeat(70));
        let long_lower = format!("{}?Two", "a".repeat(70));
        let names = [
            long_upper.clone(),
            long_lower,
            long_upper.clone(),
            format!("{}!FOUR", "A".repeat(70)),
        ];
        let stories = names
            .into_iter()
            .enumerate()
            .map(|(index, name)| {
                serde_json::from_value::<Story>(serde_json::json!({
                    "ifid": format!("IFID-{index}"),
                    "id": format!("story-{index}"),
                    "name": name,
                    "passages": [{
                        "id": format!("passage-{index}"),
                        "name": "Same Passage Name",
                        "story": format!("story-{index}"),
                        "text": format!("body-{index}")
                    }],
                    "script": format!("script-{index}"),
                    "startPassage": format!("passage-{index}"),
                    "stylesheet": format!("style-{index}")
                }))
                .expect("collision story should deserialize")
            })
            .collect::<Vec<_>>();
        let mut project = Project::from_story(stories[0].clone());

        project.stories = stories;
        project.library.sort_order = project
            .stories
            .iter()
            .map(|story| story.id.clone())
            .collect();
        for story in project.stories.iter().skip(2) {
            project
                .manifest
                .set_source_layout(story.id.clone(), ProjectSourceLayout::SingleTwee);
        }

        save_project_path(&root, &project, &SaveOptions::default())
            .expect("colliding stories should save without overwrites");
        let first_manifest: ProjectFile = toml::from_str(
            &fs::read_to_string(root.join(MANIFEST_FILE)).expect("manifest should read"),
        )
        .expect("manifest should parse");
        let script_paths = first_manifest
            .stories
            .iter()
            .map(|story| story.script.clone())
            .collect::<BTreeSet<_>>();
        let stylesheet_paths = first_manifest
            .stories
            .iter()
            .map(|story| story.stylesheet.clone())
            .collect::<BTreeSet<_>>();
        let passage_roots = first_manifest.stories[..2]
            .iter()
            .map(|story| {
                Path::new(&story.passages[0].file)
                    .parent()
                    .expect("passage should have a parent")
                    .to_path_buf()
            })
            .collect::<BTreeSet<_>>();
        let single_sources = first_manifest.stories[2..]
            .iter()
            .map(|story| story.source.clone())
            .collect::<BTreeSet<_>>();

        assert_eq!(script_paths.len(), 4);
        assert_eq!(stylesheet_paths.len(), 4);
        assert_eq!(passage_roots.len(), 2);
        assert_eq!(single_sources.len(), 2);

        let loaded = load_project_path(&root).expect("collision project should load");
        for (index, story) in loaded.stories.iter().enumerate() {
            assert_eq!(story.script, format!("script-{index}"));
            assert_eq!(story.stylesheet, format!("style-{index}"));
            assert_eq!(story.passages[0].text, format!("body-{index}"));
        }

        project.stories[0].name = "Renamed Without Collision".into();
        save_project_path(&root, &project, &SaveOptions::default())
            .expect("collision project should resave");
        let second_manifest: ProjectFile = toml::from_str(
            &fs::read_to_string(root.join(MANIFEST_FILE)).expect("resaved manifest should read"),
        )
        .expect("resaved manifest should parse");

        for (before, after) in first_manifest.stories.iter().zip(&second_manifest.stories) {
            assert_eq!(after.script, before.script);
            assert_eq!(after.stylesheet, before.stylesheet);
            if before.source_layout == ProjectSourceLayout::SingleTwee {
                assert_eq!(after.source, before.source);
            } else {
                assert_eq!(after.passages[0].file, before.passages[0].file);
            }
        }

        fs::remove_dir_all(&root).expect("collision project should be removed");
        let backups = backup_dir(&root);
        if backups.exists() {
            fs::remove_dir_all(backups).expect("collision backups should be removed");
        }
    }

    #[test]
    fn graph_annotations_are_sidecar_metadata() {
        let root = temp_path("graph-annotation-project");
        let story: Story = serde_json::from_str(
            r#"{
                "ifid": "IFID",
                "id": "story-1",
                "name": "Example",
                "passages": [{
                    "id": "passage-1",
                    "name": "Start",
                    "story": "story-1",
                    "text": "Plain text source"
                }],
                "startPassage": "passage-1",
                "storyFormat": "Harlowe",
                "storyFormatVersion": "3.3.9"
            }"#,
        )
        .expect("story should deserialize");
        let mut project = Project::from_story(story);

        project.layout.annotations.insert(
            "note-1".into(),
            twine_model::GraphAnnotation {
                id: "note-1".into(),
                bounds: twine_model::GraphPosition {
                    height: 120.0,
                    left: 40.0,
                    top: 80.0,
                    width: 240.0,
                },
                text: "Act break".into(),
                ..twine_model::GraphAnnotation::default()
            },
        );

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");

        assert!(root.join(".twine/graph.json").exists());

        let loaded = load_project_path(&root).expect("project should load");

        assert_eq!(loaded.layout.annotations["note-1"].text, "Act break");
        assert!(loaded.stories[0].passages[0].layout.is_none());

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn rejects_manifest_paths_outside_project_root() {
        let root = temp_path("unsafe-project-path");

        fs::create_dir_all(&root).expect("project directory should be created");
        fs::write(
            root.join("twine.toml"),
            r#"
name = "Unsafe"

[[stories]]
id = "story-1"
name = "Example"

[[stories.passages]]
id = "passage-1"
name = "Start"
file = "../outside.twee"
"#,
        )
        .expect("manifest should be written");

        let error = load_project_path(&root).expect_err("project path should be rejected");

        assert!(matches!(
            error,
            StoreError::UnsafeProjectPath(path) if path == PathBuf::from("../outside.twee")
        ));

        fs::remove_dir_all(&root).expect("project should be removed");
    }

    #[test]
    fn prepared_sidecar_is_atomic_and_sidecar_only_changes_create_backups() {
        let root = temp_path("prepared-sidecar-transaction");
        let project = Project::from_story(story());
        let initial_sidecar = br#"{"version":1,"stories":[{"id":"story-1","selected":false}]}
"#;
        let changed_sidecar = br#"{"version":1,"stories":[{"id":"story-1","selected":true}]}
"#;

        let initial = save_project_path_with_prepared_sidecar(
            &root,
            &project,
            &SaveOptions {
                create_backup: false,
                max_backups: 0,
                write_generated_indexes: true,
            },
            Some(initial_sidecar),
        )
        .expect("project and prepared sidecar should save together");

        assert!(initial.dirty);
        assert_eq!(
            fs::read(root.join(".twine/project.json")).expect("initial sidecar should read"),
            initial_sidecar
        );

        let changed = save_project_path_with_prepared_sidecar(
            &root,
            &project,
            &SaveOptions {
                create_backup: true,
                max_backups: 2,
                write_generated_indexes: true,
            },
            Some(changed_sidecar),
        )
        .expect("sidecar-only change should commit atomically");
        let backup = changed
            .backup_path
            .as_ref()
            .expect("sidecar-only change should create a backup");

        assert!(changed.dirty);
        assert!(
            changed
                .changed_files
                .contains(&PathBuf::from(".twine/project.json"))
        );
        assert_eq!(
            fs::read(root.join(".twine/project.json")).expect("changed sidecar should read"),
            changed_sidecar
        );
        assert_eq!(
            fs::read(backup.join(".twine/project.json")).expect("backup sidecar should read"),
            initial_sidecar
        );
        assert_eq!(
            fs::read(root.join(MANIFEST_FILE)).expect("current manifest should read"),
            fs::read(backup.join(MANIFEST_FILE)).expect("backup manifest should read")
        );

        fs::remove_dir_all(&root).expect("prepared-sidecar project should be removed");
        let backups = backup_dir(&root);
        if backups.exists() {
            fs::remove_dir_all(backups).expect("prepared-sidecar backups should be removed");
        }
    }

    #[test]
    fn creates_backup_on_dirty_resave() {
        let root = temp_path("project-backup");
        let mut project = Project::from_story(story());

        save_project_path(&root, &project, &SaveOptions::default()).expect("project should save");
        project.stories[0].name = "Changed".into();

        let report = save_project_path(
            &root,
            &project,
            &SaveOptions {
                max_backups: 2,
                ..SaveOptions::default()
            },
        )
        .expect("project should resave");

        assert!(
            report
                .backup_path
                .as_ref()
                .is_some_and(|path| path.exists())
        );

        fs::remove_dir_all(&root).expect("project should be removed");
        if let Some(backup_dir) = backup_dir(&root).parent() {
            let _ = backup_dir;
        }
        let backups = backup_dir(&root);
        if backups.exists() {
            fs::remove_dir_all(backups).expect("backups should be removed");
        }
    }

    #[test]
    fn failed_prepared_root_install_restores_original_project() {
        let root = temp_path("project-install-rollback");
        let prepared_root = temp_path("project-install-rollback-prepared");
        let retired_root = temp_path("project-install-rollback-retired");

        fs::create_dir_all(&root).expect("original root should be created");
        fs::write(root.join("marker"), b"original").expect("original marker should write");
        fs::create_dir_all(&prepared_root).expect("prepared root should be created");
        fs::write(prepared_root.join("marker"), b"prepared").expect("prepared marker should write");

        let mut rename_count = 0;
        let result = install_prepared_project_root(
            &root,
            &prepared_root,
            &retired_root,
            false,
            |source, target| {
                rename_count += 1;
                if rename_count == 2 {
                    Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "injected prepared-root install failure",
                    ))
                } else {
                    fs::rename(source, target)
                }
            },
        );

        assert!(matches!(result, Err(StoreError::Io(_))));
        assert_eq!(rename_count, 3);
        assert_eq!(fs::read(root.join("marker")).unwrap(), b"original");
        assert!(!prepared_root.exists());
        assert!(!retired_root.exists());

        fs::remove_dir_all(&root).expect("restored root should be removed");
    }

    #[test]
    fn failed_install_and_rollback_retain_both_recovery_trees() {
        let root = temp_path("project-double-failure");
        let prepared_root = temp_path("project-double-failure-prepared");
        let retired_root = temp_path("project-double-failure-retired");

        fs::create_dir_all(&root).expect("original root should be created");
        fs::write(root.join("marker"), b"original").expect("original marker should write");
        fs::create_dir_all(&prepared_root).expect("prepared root should be created");
        fs::write(prepared_root.join("marker"), b"prepared").expect("prepared marker should write");

        let mut rename_count = 0;
        let result = install_prepared_project_root(
            &root,
            &prepared_root,
            &retired_root,
            false,
            |source, target| {
                rename_count += 1;
                if rename_count >= 2 {
                    Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "injected rename failure",
                    ))
                } else {
                    fs::rename(source, target)
                }
            },
        );

        assert!(matches!(
            result,
            Err(StoreError::ProjectInstallRollback {
                recovery_path,
                ..
            }) if recovery_path == retired_root
        ));
        assert!(!root.exists());
        assert_eq!(fs::read(retired_root.join("marker")).unwrap(), b"original");
        assert_eq!(fs::read(prepared_root.join("marker")).unwrap(), b"prepared");

        fs::remove_dir_all(&retired_root).expect("retired root should be removed");
        fs::remove_dir_all(&prepared_root).expect("prepared root should be removed");
    }

    #[cfg(windows)]
    #[test]
    fn windows_copy_preserves_dangling_directory_symlink_kind() {
        use std::os::windows::fs::{FileTypeExt, symlink_dir, symlink_file};

        let root = temp_path("project-windows-directory-symlink");
        let source = root.join("source-link");
        let copy = root.join("copied-link");
        let wrong_kind = root.join("file-link");
        let missing_target = root.join("missing-target");

        fs::create_dir_all(&root).expect("test root should be created");
        symlink_dir(&missing_target, &source).expect("directory symlink should be created");
        copy_file_or_symlink(&source, &copy).expect("directory symlink should copy");
        symlink_file(&missing_target, &wrong_kind).expect("file symlink should be created");

        assert!(
            fs::symlink_metadata(&copy)
                .expect("copied link metadata")
                .file_type()
                .is_symlink_dir()
        );
        assert!(project_entries_equal(&source, &copy).unwrap());
        assert!(!project_entries_equal(&source, &wrong_kind).unwrap());

        fs::remove_file(&source).expect("source link should be removed");
        fs::remove_file(&copy).expect("copied link should be removed");
        fs::remove_file(&wrong_kind).expect("file link should be removed");
        fs::remove_dir_all(&root).expect("test root should be removed");
    }
}
