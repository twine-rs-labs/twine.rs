#![doc = "Persistence interfaces, project-folder storage, and JSON fixture loading."]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::BufReader,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
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

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("project manifest not found: {0}")]
    ProjectManifestNotFound(PathBuf),

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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SaveReport {
    pub backup_path: Option<PathBuf>,
    pub changed_files: Vec<PathBuf>,
    pub dirty: bool,
    pub storage_message: String,
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
    let root = root.as_ref();
    let manifest_path = root.join(MANIFEST_FILE);

    if !manifest_path.exists() {
        return Err(StoreError::ProjectManifestNotFound(manifest_path));
    }

    let manifest: ProjectFile = toml::from_str(&fs::read_to_string(&manifest_path)?)?;

    manifest.into_project(root)
}

pub fn save_project_path(
    root: impl AsRef<Path>,
    project: &Project,
    options: &SaveOptions,
) -> Result<SaveReport, StoreError> {
    let root = root.as_ref();
    let temp_root = temp_project_path(root);
    let old_files = collect_files(root)?;

    if temp_root.exists() {
        fs::remove_dir_all(&temp_root)?;
    }

    write_project_to_dir(&temp_root, project, options)?;

    let new_files = collect_files(&temp_root)?;
    let dirty = !file_sets_equal(root, &old_files, &temp_root, &new_files)?;
    let changed_files = changed_files(root, &old_files, &temp_root, &new_files)?;
    let storage_message = project.manifest.storage.message.clone();

    if !dirty {
        fs::remove_dir_all(&temp_root)?;
        return Ok(SaveReport {
            backup_path: None,
            changed_files,
            dirty: false,
            storage_message,
        });
    }

    let mut backup_path = None;
    let retired_path = root.with_extension(format!("retired-{}", timestamp()));

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

    Ok(SaveReport {
        backup_path,
        changed_files,
        dirty: true,
        storage_message,
    })
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

    if !project.layout.passages.is_empty()
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

    fn into_project(self, root: &Path) -> Result<Project, StoreError> {
        let layout = if root.join(GRAPH_LAYOUT_FILE).exists() {
            serde_json::from_str(&fs::read_to_string(root.join(GRAPH_LAYOUT_FILE))?)?
        } else {
            GraphLayout::default()
        };
        let mut stories = self
            .stories
            .into_iter()
            .map(|story| story.into_story(root))
            .collect::<Result<Vec<_>, _>>()?;

        for story in &mut stories {
            layout.apply_to_story(story);
        }

        Ok(Project {
            layout,
            library: self.library.into_library(),
            manifest: ProjectManifest {
                app_version: self.app_version,
                name: self.name,
                schema_version: self.schema_version,
                storage: self.storage,
            },
            stories,
        })
    }
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

    fn into_story(self, root: &Path) -> Result<Story, StoreError> {
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
            script: read_optional(root, &self.script)?,
            snap_to_grid: self.snap_to_grid,
            start_passage: self.start_passage,
            story_format: self.story_format,
            story_format_version: self.story_format_version,
            stylesheet: read_optional(root, &self.stylesheet)?,
            tags: self.tags,
            tag_colors: self.tag_colors,
            zoom: self.zoom,
        };

        story.passages = self
            .passages
            .into_iter()
            .map(|passage| passage.into_passage(root, &story.id))
            .collect::<Result<Vec<_>, _>>()?
            .into();

        Ok(story)
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

    fn into_passage(self, root: &Path, story_id: &StoryId) -> Result<Passage, StoreError> {
        Ok(Passage {
            custom_attributes: self.custom_attributes,
            id: self.id,
            layout: None,
            metadata: metadata_from_json(self.metadata_json),
            name: self.name,
            source_pid: self.source_pid,
            story: story_id.clone(),
            tags: self.tags,
            text: read_optional(root, &self.file)?,
        })
    }
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

fn read_optional(root: &Path, relative: &str) -> Result<String, StoreError> {
    if relative.is_empty() {
        return Ok(String::new());
    }

    let relative = safe_project_relative_path(relative)?;

    match fs::read_to_string(root.join(relative)) {
        Ok(value) => Ok(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(StoreError::Io(error)),
    }
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
