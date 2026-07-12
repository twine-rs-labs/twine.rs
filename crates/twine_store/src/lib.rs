#![doc = "Persistence interfaces, project-folder storage, and JSON fixture loading."]

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{BufReader, Read},
    path::{Component, Path, PathBuf},
    sync::OnceLock,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use twine_graph::GraphIndex;
use twine_model::{
    GraphLayout, LibraryMetadata, Passage, PassageId, Project, ProjectManifest, StoragePolicy,
    Story, StoryId,
};

const MANIFEST_FILE: &str = "twine.toml";
const GRAPH_CACHE_DIR: &str = ".twine/cache/graph";
const GRAPH_LAYOUT_FILE: &str = ".twine/graph.json";
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

    #[error("story not found: {0}")]
    StoryNotFound(StoryId),

    #[error("TOML decode error: {0}")]
    TomlDecode(#[from] toml::de::Error),

    #[error("TOML encode error: {0}")]
    TomlEncode(#[from] toml::ser::Error),
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
    pub manifest_parse_us: u64,
    pub manifest_read_us: u64,
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
    let started = Instant::now();
    let manifest: ProjectFile = toml::from_str(&manifest_source)?;
    timings.manifest_parse_us = elapsed_us(started);
    let project = manifest.into_project(root, options, &mut files, &mut timings)?;

    Ok(LoadedProject {
        files,
        project,
        timings,
    })
}

pub fn save_project_path(
    root: impl AsRef<Path>,
    project: &Project,
    options: &SaveOptions,
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
    write_project_to_dir(&temp_root, project, options)?;
    timings.write_temp_project_us = elapsed_us(started);
    let started = Instant::now();
    copy_existing_assets(root, &temp_root)?;
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

    let mut backup_path = None;
    let retired_path = root.with_extension(format!("retired-{}", timestamp()));
    let started = Instant::now();

    if root.exists() {
        if options.create_backup {
            let backup = backup_project(root)?;
            backup_path = Some(backup);
            prune_backups(root, options.max_backups)?;
        } else {
            fs::rename(root, &retired_path)?;
        }
    } else if let Some(parent) = root.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::rename(&temp_root, root)?;

    if retired_path.exists() {
        fs::remove_dir_all(retired_path)?;
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
) -> Result<(), StoreError> {
    fs::create_dir_all(root)?;
    fs::create_dir_all(root.join("passages"))?;
    fs::create_dir_all(root.join("scripts"))?;
    fs::create_dir_all(root.join("styles"))?;
    fs::create_dir_all(root.join("assets"))?;
    fs::create_dir_all(root.join(".twine"))?;

    if options.write_generated_indexes {
        fs::create_dir_all(root.join(GRAPH_CACHE_DIR))?;
    }

    let mut project_file = ProjectFile::from_project(project);

    for story in &project.stories {
        let story_slug = unique_component(&story.name, story.id.as_ref());
        let script_path = PathBuf::from("scripts").join(format!("{story_slug}.js"));
        let stylesheet_path = PathBuf::from("styles").join(format!("{story_slug}.css"));

        fs::write(root.join(&script_path), &story.script)?;
        fs::write(root.join(&stylesheet_path), &story.stylesheet)?;

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

        if let Some(story_file) = project_file
            .stories
            .iter_mut()
            .find(|story_file| story_file.id == story.id)
        {
            story_file.script = path_string(&script_path);
            story_file.stylesheet = path_string(&stylesheet_path);
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

    fs::write(
        root.join(MANIFEST_FILE),
        toml::to_string_pretty(&project_file)?,
    )?;

    Ok(())
}

fn copy_existing_assets(source_root: &Path, target_root: &Path) -> Result<(), StoreError> {
    let source_assets = source_root.join("assets");

    if !source_assets.exists() {
        return Ok(());
    }

    copy_dir_contents(&source_assets, &target_root.join("assets"))
}

fn copy_dir_contents(source: &Path, target: &Path) -> Result<(), StoreError> {
    fs::create_dir_all(target)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            copy_dir_contents(&source_path, &target_path)?;
        } else if file_type.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }

            fs::copy(&source_path, &target_path)?;
        }
    }

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

fn schema_version() -> u32 {
    1
}

impl ProjectFile {
    fn from_project(project: &Project) -> Self {
        Self {
            app_version: project.manifest.app_version.clone(),
            library: LibraryFile::from_library(&project.library),
            name: project.manifest.name.clone(),
            schema_version: project.manifest.schema_version,
            storage: project.manifest.storage.clone(),
            stories: project.stories.iter().map(StoryFile::from_story).collect(),
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
        let source_count = story_files
            .iter()
            .map(|story| story.passages.len() + 2)
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
        let (layout, layout_files, graph_layout_us) = layout_result?;
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

fn default_zoom() -> f64 {
    1.0
}

impl StoryFile {
    fn from_story(story: &Story) -> Self {
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
            .chain(self.passages.iter().map(|passage| passage.file.as_str()))
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
        let parallel = options.loads_full_content() && passage_count >= PARALLEL_SOURCE_THRESHOLD;
        let passage_sources_started = Instant::now();
        let passage_results = if parallel {
            project_load_pool().install(|| {
                self.passages
                    .into_par_iter()
                    .map(|passage| passage.into_passage(root, &story.id, options))
                    .collect::<Vec<_>>()
            })
        } else {
            self.passages
                .into_iter()
                .map(|passage| passage.into_passage(root, &story.id, options))
                .collect::<Vec<_>>()
        };
        let mut passages = Vec::with_capacity(passage_results.len());
        let mut passage_source_count = 0;

        for result in passage_results {
            let loaded = result?;

            passage_source_count += loaded.files.len();
            files.extend(loaded.files);
            passages.push(loaded.passage);
        }
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
    #[serde(default)]
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
}

struct LoadedPassage {
    files: Vec<LoadedProjectFile>,
    passage: Passage,
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

fn backup_project(root: &Path) -> Result<PathBuf, StoreError> {
    let backup = backup_dir(root).join(timestamp());

    fs::create_dir_all(backup.parent().expect("backup path should have parent"))?;
    fs::rename(root, &backup)?;
    Ok(backup)
}

fn backup_dir(root: &Path) -> PathBuf {
    let parent = root.parent().unwrap_or_else(|| Path::new("."));
    let name = root
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| "twine-project".into());

    parent.join(format!(".{name}.backups"))
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

fn collect_files_inner(
    root: &Path,
    current: &Path,
    files: &mut BTreeSet<PathBuf>,
) -> Result<(), StoreError> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            collect_files_inner(root, &path, files)?;
        } else if path.is_file() {
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
        if fs::read(left_root.join(file))? != fs::read(right_root.join(file))? {
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
        let is_changed = match (left.exists(), right.exists()) {
            (true, true) => fs::read(&left)? != fs::read(&right)?,
            (false, false) => false,
            _ => true,
        };

        if is_changed {
            changed.insert(file.clone());
        }
    }

    Ok(changed.into_iter().collect())
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

        let clean_report = save_project_path(&root, &project, &SaveOptions::default())
            .expect("unchanged project should save");

        assert!(!clean_report.dirty);

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
}
