//! `jai-smell init`: ユーザー全体の設定ファイルを作成し、Claude Code のプラグインをインストールする。
//!
//! Homebrew の formula はインストール時にホームディレクトリへ書き込めないため、利用者がインストール後に実行する。

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::config;

/// 作成するファイル。内容はリポジトリの config/ の同名のファイルと同一
const CONFIG: &str = include_str!("../config/jai-smell.toml");
const PRESET_RULES: (&str, &str) = (
    "preset-rules.toml",
    include_str!("../config/preset-rules.toml"),
);
const CUSTOM_RULES: (&str, &str) = (
    "custom-rules.toml",
    include_str!("../config/custom-rules.toml"),
);
const MARKETPLACE: &str = "bufferings/jai-smell";
const PLUGIN: &str = "jai-smell@jai-smell";

/// 完了しなかった手順がある場合は false を返す
pub fn run() -> Result<bool, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("HOME が設定されていません")?;
    let config_file = config::home_file(&home);
    let dir = config_file.parent().unwrap_or(Path::new("/"));
    fs::create_dir_all(dir).map_err(|e| format!("{} を作成できません: {e}", dir.display()))?;
    // 利用者が記述するファイルは上書きしない。プリセットは利用者が変更しない前提のため、常に最新の内容にする
    create_new(&config_file, CONFIG)?;
    write_preset(&dir.join(PRESET_RULES.0), PRESET_RULES.1)?;
    create_new(&dir.join(CUSTOM_RULES.0), CUSTOM_RULES.1)?;
    Ok(install_plugin(&home))
}

/// すでに存在する場合は上書きしない
fn create_new(path: &Path, content: &str) -> Result<(), String> {
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut file) => {
            file.write_all(content.as_bytes())
                .map_err(|e| format!("{} に書き込めません: {e}", path.display()))?;
            println!("設定ファイル {} を作成しました。", path.display());
        }
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {
            println!(
                "設定ファイル {} はすでに存在するため、変更しません。",
                path.display()
            );
        }
        Err(e) => return Err(format!("{} を作成できません: {e}", path.display())),
    }
    Ok(())
}

/// 内容が異なる場合は上書きする
fn write_preset(path: &Path, content: &str) -> Result<(), String> {
    let message = match fs::read_to_string(path) {
        Ok(current) if current == content => {
            println!(
                "設定ファイル {} は最新のため、変更しません。",
                path.display()
            );
            return Ok(());
        }
        Ok(_) => "更新しました",
        Err(e) if e.kind() == ErrorKind::NotFound => "作成しました",
        Err(e) => return Err(format!("{} を読み込めません: {e}", path.display())),
    };
    fs::write(path, content).map_err(|e| format!("{} に書き込めません: {e}", path.display()))?;
    println!("設定ファイル {} を{message}。", path.display());
    Ok(())
}

fn install_plugin(home: &Path) -> bool {
    let claude_dir = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"));
    match plugin_state(&claude_dir.join("settings.json")) {
        Some(true) => {
            println!("Claude Code のプラグイン {PLUGIN} はすでにインストールされています。");
            return true;
        }
        Some(false) => {
            println!(
                "Claude Code のプラグイン {PLUGIN} は無効に設定されているため、変更しません。"
            );
            return true;
        }
        None => {}
    }
    let Some(claude) = find_claude(home) else {
        println!("claude コマンドが見つからないため、プラグインをインストールしませんでした。");
        print_manual_install();
        return false;
    };
    let steps: [&[&str]; 2] = [
        &["plugin", "marketplace", "add", MARKETPLACE],
        &["plugin", "install", PLUGIN],
    ];
    for args in steps {
        println!("$ claude {}", args.join(" "));
        let succeeded = Command::new(&claude)
            .args(args)
            .status()
            .is_ok_and(|status| status.success());
        if !succeeded {
            println!("プラグインのインストールに失敗しました。");
            print_manual_install();
            return false;
        }
    }
    println!(
        "プラグインをインストールしました。起動中の Claude Code のセッションには、次回の起動時から反映されます。"
    );
    true
}

fn print_manual_install() {
    println!(
        "次のコマンドでインストールしてください。\n  claude plugin marketplace add {MARKETPLACE}\n  claude plugin install {PLUGIN}"
    );
}

/// settings.json の enabledPlugins にこのプラグインが含まれている場合は、有効かどうかを返す。
/// true 以外の値は、利用者が無効に設定したものとして扱う
fn plugin_state(settings: &Path) -> Option<bool> {
    let text = fs::read_to_string(settings).ok()?;
    let settings: serde_json::Value = serde_json::from_str(&text).ok()?;
    let value = settings.get("enabledPlugins")?.get(PLUGIN)?;
    Some(value.as_bool() == Some(true))
}

/// PATH に存在しない場合も、Claude Code の公式インストーラーが配置する ~/.local/bin/claude を確認する
fn find_claude(home: &Path) -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .map(|dir| dir.join("claude"))
        .chain([home.join(".local/bin/claude")])
        .find(|path| path.is_file())
}
