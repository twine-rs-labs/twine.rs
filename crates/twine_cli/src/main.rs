use anyhow::{Context, Result, bail};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    time::Instant,
};
use twine_export::{
    HtmlExportOptions, archive_to_twine_html, stories_to_json_pretty, story_to_html_document,
    story_to_twee,
};
use twine_graph::{AutoLayoutOptions, GraphIndex, GraphProjectionOptions};
use twine_model::{
    GraphLayout, GraphPosition, LibraryMetadata, Passage, PassageId, Project, ProjectManifest,
    Story, StoryId,
};
use twine_parse::{stories_from_json_interchange, stories_from_twine_html, story_from_twee_named};
use twine_store::{FileProjectStore, SaveOptions, load_project_path};

fn main() -> Result<()> {
    let args = env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .collect::<Vec<_>>();

    match args.as_slice() {
        [] => bail!("{}", usage()),
        [command] if is_command(command, "bench-graph") => bench_graph(50_000),
        [command, path] if is_command(command, "bench-open") => bench_open(path),
        [command, path] if is_command(command, "inspect") => inspect(path),
        [command, path] if is_command(command, "graph") => graph(path, None),
        [command, path, story_id] if is_command(command, "graph") => {
            graph(path, Some(&story_id.to_string_lossy()))
        }
        [command, count] if is_command(command, "bench-graph") => {
            bench_graph(count.to_string_lossy().parse()?)
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
        [path] => inspect(path),
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
  twine-rs bench-graph [passage-count]
  twine-rs bench-open <project-dir>
  twine-rs import <story-json|twee|html> <project-dir>
  twine-rs export <project-dir> <json|twee|html|archive> [output-file]"
}

fn bench_graph(passage_count: usize) -> Result<()> {
    let passage_count = passage_count.max(1);
    let story = synthetic_story(passage_count);
    let layout = GraphLayout::from_story_layout(&story);
    let start = Instant::now();
    let graph = GraphIndex::from_story(&story);
    let index_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let snapshot = graph.layout_snapshot(&story, &layout, &AutoLayoutOptions::default());
    let layout_snapshot_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let projection = graph.canvas_projection_from_snapshot(
        &snapshot,
        &GraphProjectionOptions {
            viewport: Some(
                GraphPosition {
                    height: 1200.0,
                    left: 0.0,
                    top: 0.0,
                    width: 1600.0,
                }
                .into(),
            ),
            ..GraphProjectionOptions::default()
        },
    );
    let projection_ms = start.elapsed().as_secs_f64() * 1000.0;

    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "passages": passage_count,
            "links": projection.stats.links,
            "visibleNodes": projection.nodes.len(),
            "visibleEdges": projection.edges.len(),
            "indexMs": index_ms,
            "layoutSnapshotMs": layout_snapshot_ms,
            "projectionMs": projection_ms
        }))?
    );
    Ok(())
}

fn bench_open(project_dir: &Path) -> Result<()> {
    let start = Instant::now();
    let project = load_project_path(project_dir)
        .with_context(|| format!("failed to load project at {}", project_dir.display()))?;
    let load_ms = start.elapsed().as_secs_f64() * 1000.0;
    let assets = count_asset_files(&project_dir.join("assets"))?;
    let passages = project
        .stories
        .iter()
        .map(Story::passage_count)
        .sum::<usize>();
    let mut links = 0;
    let mut visible_nodes = 0;
    let mut visible_edges = 0;
    let start = Instant::now();
    let graphs = project
        .stories
        .iter()
        .map(|story| {
            let graph = GraphIndex::from_story(story);

            links += graph.stats().links;
            graph
        })
        .collect::<Vec<_>>();
    let index_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let layouts = project
        .stories
        .iter()
        .zip(&graphs)
        .map(|(story, graph)| {
            graph.layout_snapshot(story, &project.layout, &AutoLayoutOptions::default())
        })
        .collect::<Vec<_>>();
    let layout_snapshot_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();

    for (graph, layout) in graphs.iter().zip(&layouts) {
        let projection = graph.canvas_projection_from_snapshot(
            layout,
            &GraphProjectionOptions {
                viewport: Some(
                    GraphPosition {
                        height: 1200.0,
                        left: 0.0,
                        top: 0.0,
                        width: 1600.0,
                    }
                    .into(),
                ),
                ..GraphProjectionOptions::default()
            },
        );

        visible_nodes += projection.nodes.len();
        visible_edges += projection.edges.len();
    }

    let projection_ms = start.elapsed().as_secs_f64() * 1000.0;

    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "assets": assets,
            "indexMs": index_ms,
            "layoutSnapshotMs": layout_snapshot_ms,
            "links": links,
            "loadMs": load_ms,
            "passages": passages,
            "projectionMs": projection_ms,
            "stories": project.stories.len(),
            "visibleEdges": visible_edges,
            "visibleNodes": visible_nodes
        }))?
    );
    Ok(())
}

fn count_asset_files(asset_root: &Path) -> Result<usize> {
    if !asset_root.exists() {
        return Ok(0);
    }

    let mut count = 0;
    let mut stack = vec![asset_root.to_path_buf()];

    while let Some(path) = stack.pop() {
        for entry in fs::read_dir(&path)? {
            let entry = entry?;
            let file_type = entry.file_type()?;

            if file_type.is_dir() {
                stack.push(entry.path());
            } else if file_type.is_file() {
                count += 1;
            }
        }
    }

    Ok(count)
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

fn synthetic_story(passage_count: usize) -> Story {
    let story_id = StoryId::new("bench-story");
    let passages = (0..passage_count)
        .map(|index| {
            let name = format!("P{index}");
            let text = if index + 1 < passage_count {
                format!("[[P{}]]", index + 1)
            } else {
                String::new()
            };

            Passage {
                custom_attributes: BTreeMap::new(),
                id: PassageId::new(format!("p-{index}")),
                layout: Some(GraphPosition {
                    height: 100.0,
                    left: (index % 250) as f64 * 180.0,
                    top: (index / 250) as f64 * 140.0,
                    width: 140.0,
                }),
                metadata: BTreeMap::new(),
                name,
                source_pid: None,
                story: story_id.clone(),
                tags: Vec::new(),
                text,
            }
        })
        .collect::<Vec<_>>();

    Story {
        id: story_id,
        ifid: "bench-ifid".into(),
        name: "Graph Benchmark".into(),
        passages: passages.into(),
        start_passage: PassageId::new("p-0"),
        story_format: "Harlowe".into(),
        story_format_version: "3.3.9".into(),
        ..Story::default()
    }
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
