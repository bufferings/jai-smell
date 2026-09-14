//! `jai-smell init` を、一時ディレクトリを HOME とし、claude を差し替えた PATH で検証する。

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const BIN: &str = env!("CARGO_BIN_EXE_jai-smell");
const EXAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/examples/jai-smell.toml");
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

    fn config(&self) -> PathBuf {
        self.root.join(".config/jai-smell/jai-smell.toml")
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
fn writes_example_config_and_explains_plugin_install_without_claude() {
    let home = Home::new("no-claude");
    let output = home.init(&[]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        fs::read_to_string(home.config()).unwrap(),
        fs::read_to_string(EXAMPLE).unwrap()
    );
    assert!(stdout(&output).contains(MANUAL), "{}", stdout(&output));
}

#[test]
fn keeps_existing_config() {
    let home = Home::new("existing");
    home.write(".config/jai-smell/jai-smell.toml", "# 利用者の設定\n");
    home.init(&[]);
    assert_eq!(
        fs::read_to_string(home.config()).unwrap(),
        "# 利用者の設定\n"
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
