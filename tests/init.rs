//! `jai-smell init` を、一時ディレクトリを HOME とし、claude を差し替えた PATH で検証する。

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const BIN: &str = env!("CARGO_BIN_EXE_jai-smell");
/// jai-smell init が作成するファイル
const CONFIG_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/config");
const FILES: [&str; 3] = ["jai-smell.toml", "preset-rules.toml", "custom-rules.toml"];
const MANUAL: &str = "claude plugin marketplace add bufferings/jai-smell";

struct Home {
    root: PathBuf,
}

impl Home {
    fn new(name: &str) -> Self {
        let root =
            std::env::temp_dir().join(format!("jai-smell-init-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        Self { root }
    }

    fn config(&self, name: &str) -> String {
        fs::read_to_string(self.root.join(".config/jai-smell").join(name)).unwrap()
    }

    fn write(&self, path: &str, text: &str) -> PathBuf {
        let path = self.root.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, text).unwrap();
        path
    }

    /// 受け取った引数を $HOME/claude.log に記録し、exit_code で終了する claude を配置する
    fn fake_claude(&self, exit_code: i32) -> PathBuf {
        let path = self.write(
            "bin/claude",
            &format!("#!/bin/sh\necho \"$@\" >> \"$HOME/claude.log\"\nexit {exit_code}\n"),
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path.parent().unwrap().to_path_buf()
    }

    fn init(&self, path_dirs: &[&Path]) -> Output {
        let path = std::env::join_paths(
            path_dirs
                .iter()
                .map(|dir| dir.to_path_buf())
                .chain([PathBuf::from("/usr/bin"), PathBuf::from("/bin")]),
        )
        .unwrap();
        Command::new(BIN)
            .arg("init")
            .env("HOME", &self.root)
            .env("PATH", path)
            .env_remove("CLAUDE_CONFIG_DIR")
            .output()
            .unwrap()
    }

    fn claude_log(&self) -> String {
        fs::read_to_string(self.root.join("claude.log")).unwrap_or_default()
    }
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

#[test]
fn writes_config_files_and_explains_plugin_install_without_claude() {
    let home = Home::new("no-claude");
    let output = home.init(&[]);
    assert_eq!(output.status.code(), Some(1));
    for name in FILES {
        assert_eq!(
            home.config(name),
            fs::read_to_string(Path::new(CONFIG_DIR).join(name)).unwrap(),
            "{name}"
        );
    }
    assert!(stdout(&output).contains(MANUAL), "{}", stdout(&output));
}

/// 利用者が記述するファイルは変更せず、プリセットのみを最新の内容で上書きする
#[test]
fn keeps_user_files_and_overwrites_preset() {
    let home = Home::new("existing");
    for name in FILES {
        home.write(&format!(".config/jai-smell/{name}"), "# 既存の内容\n");
    }
    let output = home.init(&[]);
    assert_eq!(home.config("jai-smell.toml"), "# 既存の内容\n");
    assert_eq!(home.config("custom-rules.toml"), "# 既存の内容\n");
    let preset = fs::read_to_string(Path::new(CONFIG_DIR).join("preset-rules.toml")).unwrap();
    assert_eq!(home.config("preset-rules.toml"), preset);
    assert!(
        stdout(&output).contains("preset-rules.toml を更新しました"),
        "{}",
        stdout(&output)
    );

    let output = home.init(&[]);
    assert!(
        stdout(&output).contains("preset-rules.toml は最新のため"),
        "{}",
        stdout(&output)
    );
}

#[test]
fn installs_plugin_with_claude() {
    let home = Home::new("claude");
    let bin = home.fake_claude(0);
    let output = home.init(&[&bin]);
    assert_eq!(output.status.code(), Some(0), "{}", stdout(&output));
    assert_eq!(
        home.claude_log(),
        "plugin marketplace add bufferings/jai-smell\nplugin install jai-smell@jai-smell\n"
    );
}

#[test]
fn explains_manual_install_when_claude_fails() {
    let home = Home::new("claude-fails");
    let bin = home.fake_claude(1);
    let output = home.init(&[&bin]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        home.claude_log(),
        "plugin marketplace add bufferings/jai-smell\n"
    );
    assert!(stdout(&output).contains(MANUAL), "{}", stdout(&output));
}

#[test]
fn leaves_plugin_already_enabled_or_disabled() {
    for enabled in [true, false] {
        let home = Home::new(&format!("plugin-{enabled}"));
        home.write(
            ".claude/settings.json",
            &format!(r#"{{ "enabledPlugins": {{ "jai-smell@jai-smell": {enabled} }} }}"#),
        );
        let bin = home.fake_claude(0);
        let output = home.init(&[&bin]);
        assert_eq!(output.status.code(), Some(0), "{}", stdout(&output));
        assert_eq!(home.claude_log(), "");
    }
}
