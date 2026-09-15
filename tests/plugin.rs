//! Claude Code のプラグイン（.claude-plugin/ と plugin/）の内容と、フックから実行する check.sh を検証する。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use serde_json::{Value, json};

const BIN: &str = env!("CARGO_BIN_EXE_jai-smell");
const REPOSITORY: &str = env!("CARGO_MANIFEST_DIR");
/// jai-smell init が作成するファイル
const CONFIG_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/config");

fn read_json(path: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(Path::new(REPOSITORY).join(path)).unwrap()).unwrap()
}

#[test]
fn marketplace_lists_plugin_with_the_name_init_installs() {
    let marketplace = read_json(".claude-plugin/marketplace.json");
    let plugin = read_json("plugin/.claude-plugin/plugin.json");
    assert_eq!(marketplace["name"], "jai-smell");
    assert_eq!(marketplace["plugins"][0]["name"], "jai-smell");
    assert_eq!(marketplace["plugins"][0]["source"], "./plugin");
    assert_eq!(plugin["name"], "jai-smell");
    assert_eq!(plugin["version"], env!("CARGO_PKG_VERSION"));
}

#[test]
fn hooks_run_check_script_only_after_writes() {
    let hooks = read_json("plugin/hooks/hooks.json");
    let events: Vec<&String> = hooks["hooks"].as_object().unwrap().keys().collect();
    assert_eq!(events, ["PostToolUse"]);
    let post_tool_use = &hooks["hooks"]["PostToolUse"][0];
    assert_eq!(post_tool_use["matcher"], "Edit|Write|MultiEdit");
    assert_eq!(
        post_tool_use["hooks"][0]["command"],
        "\"${CLAUDE_PLUGIN_ROOT}\"/hooks/check.sh"
    );
}

/// Markdown の先頭の frontmatter（--- で囲まれた部分）を返す
fn frontmatter(path: &str) -> String {
    let text = fs::read_to_string(Path::new(REPOSITORY).join(path)).unwrap();
    let rest = text.strip_prefix("---\n").unwrap();
    rest.split_once("\n---\n").unwrap().0.to_string()
}

/// 出力スタイルは、Claude Code の組み込みの指示を保持し、利用者の outputStyle の設定を上書きしない
#[test]
fn output_style_keeps_coding_instructions_without_forcing() {
    let frontmatter = frontmatter("plugin/output-styles/japanese-replies.md");
    let lines: Vec<&str> = frontmatter.lines().collect();
    assert!(lines.contains(&"name: japanese-replies"));
    assert!(lines.contains(&"keep-coding-instructions: true"));
    assert!(!frontmatter.contains("force-for-plugin"));
}

#[test]
fn skill_name_matches_its_directory() {
    let frontmatter = frontmatter("plugin/skills/japanese-tech-writing/SKILL.md");
    assert!(
        frontmatter
            .lines()
            .any(|line| line == "name: japanese-tech-writing")
    );
}

/// PATH に jai-smell を含めるかどうかを切り替えて、check.sh を実行する
fn check(with_binary: bool) -> Output {
    let home = std::env::temp_dir().join(format!(
        "jai-smell-plugin-{}-{with_binary}",
        std::process::id()
    ));
    let config_dir = home.join(".config/jai-smell");
    fs::create_dir_all(&config_dir).unwrap();
    for name in ["jai-smell.toml", "preset-rules.toml", "custom-rules.toml"] {
        fs::copy(Path::new(CONFIG_DIR).join(name), config_dir.join(name)).unwrap();
    }

    let mut dirs: Vec<PathBuf> = vec!["/usr/bin".into(), "/bin".into()];
    if with_binary {
        dirs.insert(0, Path::new(BIN).parent().unwrap().to_path_buf());
    }
    let mut child = Command::new(Path::new(REPOSITORY).join("plugin/hooks/check.sh"))
        .env("HOME", &home)
        .env("PATH", std::env::join_paths(dirs).unwrap())
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let input = json!({
        "tool_name": "Edit",
        "tool_input": { "file_path": home.join("doc.md"), "old_string": "x", "new_string": "CI が走る。" }
    });
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn check_script_passes_exit_code_through() {
    let output = check(true);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("\"走る\""));
}

#[test]
fn check_script_does_nothing_without_binary() {
    let output = check(false);
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty());
}
