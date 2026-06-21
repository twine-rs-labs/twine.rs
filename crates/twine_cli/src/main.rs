use anyhow::{Context, Result, bail};
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use twine_export::{
    HtmlExportOptions, archive_to_twine_html, stories_to_json_pretty, story_to_html_document,
    story_to_twee,
};
use twine_graph::{AutoLayoutOptions, GraphIndex, GraphProjectionOptions};
use twine_model::{GraphLayout, LibraryMetadata, Project, ProjectManifest, Story};
use twine_parse::{stories_from_json_interchange, stories_from_twine_html, story_from_twee_named};
use twine_store::{FileProjectStore, SaveOptions, load_project_path};

fn main() -> Result<()> {
    let args = env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .collect::<Vec<_>>();

    match args.as_slice() {
        [] => bail!("{}", usage()),
        [path] => inspect(path),
        [command, path] if is_command(command, "inspect") => inspect(path),
        [command, path] if is_command(command, "graph") => graph(path, None),
        [command, path, story_id] if is_command(command, "graph") => {
            graph(path, Some(&story_id.to_string_lossy()))
        }
        [command, source, project_dir] if is_command(command, "import") => {
            import_project(source, project_dir)
        }
        [command, project_dir, format, output] if is_command(command, "export") => {
            export_project(project_dir, format, Some(output))
        }
        [command, project_dir, format] if is_command(command, "export") => {
            export_project(project_dir, format, None)
        }
        _ => bail!("{}", usage()),
    }
}

fn is_command(path: &Path, expected: &str) -> bool {
    path.as_os_str() == expected
}

fn usage() -> &'static str {
    "usage:
  twine-rs inspect <story-json|twee|html|project-dir>
  twine-rs graph <story-json|twee|html|project-dir> [story-id-or-name]
  twine-rs import <story-json|twee|html> <project-dir>
  twine-rs export <project-dir> <json|twee|html|archive> [output-file]"
}

fn inspect(path: &Path) -> Result<()> {
    let stories = load_stories(path)?;

    print_story_report(&stories);
    Ok(())
}

fn import_project(source: &Path, project_dir: &Path) -> Result<()> {
    let stories = load_stories(source)?;
    let project = project_from_stories(stories);
    let store = FileProjectStore::new(project_dir);
    let report = store
        .save_project(&project, &SaveOptions::default())
        .with_context(|| format!("failed to save project at {}", project_dir.display()))?;

    println!("saved project: {}", project_dir.display());
    println!("dirty: {}", report.dirty);
    println!("changed_files: {}", report.changed_files.len());
    if let Some(backup_path) = report.backup_path {
        println!("backup: {}", backup_path.display());
    }
    println!("{}", report.storage_message);

    Ok(())
}

fn graph(path: &Path, requested_story: Option<&str>) -> Result<()> {
    let (stories, layout) = load_stories_with_layout(path)?;
    let mut reports = Vec::new();

    for story in &stories {
        if requested_story.is_some_and(|requested| {
            requested != story.id.as_ref() && requested != story.name.as_str()
        }) {
            continue;
        }

        let graph = GraphIndex::from_story(story);
        let projection = graph.canvas_projection(
            story,
            &layout,
            &AutoLayoutOptions::default(),
            &GraphProjectionOptions::default(),
        );

        reports.push(serde_json::json!({
            "storyId": story.id,
            "storyName": story.name,
            "projection": projection
        }));
    }

    if reports.is_empty() {
        if let Some(requested_story) = requested_story {
            bail!("story not found: {requested_story}");
        }

        bail!("no stories found");
    }

    println!("{}", serde_json::to_string_pretty(&reports)?);
    Ok(())
}

fn export_project(project_dir: &Path, format: &Path, output: Option<&PathBuf>) -> Result<()> {
    let project = load_project_path(project_dir)
        .with_context(|| format!("failed to load project at {}", project_dir.display()))?;
    let format = format.to_string_lossy();
    let rendered = match format.as_ref() {
        "json" => stories_to_json_pretty(&project.stories)?,
        "twee" => project
            .stories
            .iter()
            .map(story_to_twee)
            .collect::<Result<Vec<_>, _>>()?
            .join("\n\n"),
        "html" => {
            let Some(story) = project.stories.first() else {
                bail!("project has no stories");
            };

            story_to_html_document(
                story,
                &HtmlExportOptions {
                    start_optional: true,
                    ..HtmlExportOptions::default()
                },
            )?
        }
        "archive" => archive_to_twine_html(
            &project.stories,
            &HtmlExportOptions {
                start_optional: true,
                ..HtmlExportOptions::default()
            },
        )?,
        _ => bail!("unknown export format: {format}"),
    };

    if let Some(output) = output {
        fs::write(output, rendered)
            .with_context(|| format!("failed to write {}", output.display()))?;
    } else {
        print!("{rendered}");
    }

    Ok(())
}

fn load_stories_with_layout(path: &Path) -> Result<(Vec<Story>, GraphLayout)> {
    if path.is_dir() {
        let project = load_project_path(path)
            .with_context(|| format!("failed to load project at {}", path.display()))?;

        return Ok((project.stories, project.layout));
    }

    Ok((load_stories(path)?, GraphLayout::default()))
}

fn load_stories(path: &Path) -> Result<Vec<Story>> {
    if path.is_dir() {
        return Ok(load_project_path(path)
            .with_context(|| format!("failed to load project at {}", path.display()))?
            .stories);
    }

    let source =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let stories = match extension.as_str() {
        "twee" | "tw" => {
            let fallback = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Untitled Story");

            vec![story_from_twee_named(&source, fallback)?]
        }
        "html" | "htm" => stories_from_twine_html(&source)?,
        "json" => stories_from_json_interchange(&source)?,
        _ => {
            if source.contains("<tw-storydata") {
                stories_from_twine_html(&source)?
            } else if source.trim_start().starts_with("::") {
                vec![story_from_twee_named(&source, "Untitled Story")?]
            } else {
                stories_from_json_interchange(&source)?
            }
        }
    };

    Ok(stories)
}

fn project_from_stories(stories: Vec<Story>) -> Project {
    let mut layout = GraphLayout::default();
    let mut library = LibraryMetadata::default();
    let name = if stories.len() == 1 {
        stories[0].name.clone()
    } else {
        "Twine Project".into()
    };

    for story in &stories {
        library.sort_order.push(story.id.clone());
        if let Some(color) = &story.color {
            library.colors.insert(story.id.clone(), color.clone());
        }
        layout
            .passages
            .extend(GraphLayout::from_story_layout(story).passages);
    }

    Project {
        layout,
        library,
        manifest: ProjectManifest {
            name,
            app_version: env!("CARGO_PKG_VERSION").into(),
            ..ProjectManifest::default()
        },
        stories,
    }
}

fn print_story_report(stories: &[Story]) {
    println!("stories: {}", stories.len());

    for story in stories {
        let graph = GraphIndex::from_story(story);
        let stats = graph.stats();

        println!("story: {}", story.name);
        println!("  id: {}", story.id);
        println!("  ifid: {}", story.ifid);
        println!(
            "  format: {} {}",
            story.story_format, story.story_format_version
        );
        println!("  passages: {}", stats.passages);
        println!("  links: {}", stats.links);
        println!("  resolved_links: {}", stats.resolved_links);
        println!("  self_links: {}", stats.self_links);
        println!("  broken_links: {}", stats.broken_links);
    }
}
