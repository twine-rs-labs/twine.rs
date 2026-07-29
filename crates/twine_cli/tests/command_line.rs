use std::{
    fs,
    path::PathBuf,
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

const USAGE: &str = "usage:
  twine-rs inspect <story-json|twee|html|project-dir>
  twine-rs graph <story-json|twee|html|project-dir> [story-id-or-name]
  twine-rs bench-graph [passage-count]
  twine-rs bench-open <project-dir>
  twine-rs import <story-json|twee|html> <project-dir>
  twine-rs export <project-dir> <json|twee|html|archive> [output-file]
  twine-rs <story-json|twee|html|project-dir>
  twine-rs --help | -h
  twine-rs --version";

struct TempFile(PathBuf);

impl TempFile {
    fn with_contents(extension: &str, contents: &str) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        let sequence = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "twine-rs-cli-{}-{timestamp}-{sequence}.{extension}",
            std::process::id()
        ));

        fs::write(&path, contents).expect("temporary CLI fixture should be writable");
        Self(path)
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_twine-rs"))
        .args(args)
        .output()
        .expect("twine-rs should execute")
}

fn stdout(output: &Output) -> String {
    String::from_utf8(output.stdout.clone()).expect("stdout should be UTF-8")
}

fn stderr(output: &Output) -> String {
    String::from_utf8(output.stderr.clone()).expect("stderr should be UTF-8")
}

#[test]
fn help_options_print_the_complete_usage_to_stdout() {
    for option in ["--help", "-h"] {
        let output = run(&[option]);

        assert!(
            output.status.success(),
            "{option} failed: {}",
            stderr(&output)
        );
        assert_eq!(stdout(&output), format!("{USAGE}\n"));
        assert!(stderr(&output).is_empty());
    }
}

#[test]
fn version_prints_the_binary_and_package_version() {
    let output = run(&["--version"]);

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(
        stdout(&output),
        format!("twine-rs {}\n", env!("CARGO_PKG_VERSION"))
    );
    assert!(stderr(&output).is_empty());
}

#[test]
fn missing_arguments_fail_with_usage() {
    let output = run(&[]);

    assert!(!output.status.success());
    assert!(stderr(&output).contains(USAGE));
}

#[test]
fn unknown_options_fail_with_usage() {
    let output = run(&["--unknown"]);

    assert!(!output.status.success());
    assert!(stderr(&output).contains(USAGE));
    assert!(!stderr(&output).contains("failed to read"));
}

#[test]
fn malformed_known_commands_fail_with_usage() {
    let output = run(&["inspect"]);

    assert!(!output.status.success());
    assert!(stderr(&output).contains(USAGE));
    assert!(!stderr(&output).contains("failed to read"));
}

#[test]
fn one_positional_path_remains_an_inspect_shortcut() {
    let fixture = TempFile::with_contents(
        "twee",
        ":: StoryTitle\nCLI fixture\n\n:: Start\nHello from the CLI.\n",
    );
    let output = Command::new(env!("CARGO_BIN_EXE_twine-rs"))
        .arg(&fixture.0)
        .output()
        .expect("twine-rs should execute");
    let report = stdout(&output);

    assert!(output.status.success(), "{}", stderr(&output));
    assert!(report.contains("stories: 1"));
    assert!(report.contains("story: CLI fixture"));
    assert!(report.contains("passages: 1"));
}
