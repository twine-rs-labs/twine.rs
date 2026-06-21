use anyhow::{Context, Result, bail};
use std::{env, path::PathBuf};
use twine_graph::GraphIndex;
use twine_store::load_story_json_path;

fn main() -> Result<()> {
    let Some(path) = env::args_os().nth(1).map(PathBuf::from) else {
        bail!("usage: cargo run -p twine_cli -- <path-to-story-json>");
    };

    let story = load_story_json_path(&path)
        .with_context(|| format!("failed to load story fixture at {}", path.display()))?;
    let graph = GraphIndex::from_story(&story);
    let stats = graph.stats();

    println!("story: {}", story.name);
    println!("passages: {}", stats.passages);
    println!("links: {}", stats.links);
    println!("resolved_links: {}", stats.resolved_links);
    println!("self_links: {}", stats.self_links);
    println!("broken_links: {}", stats.broken_links);

    Ok(())
}
