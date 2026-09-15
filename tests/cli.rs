//! jai-smell コマンドとフックの動作を、リポジトリのサンプルの設定で検証する。

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use serde_json::json;

const BIN: &str = env!("CARGO_BIN_EXE_jai-smell");
const REPOSITORY: &str = env!("CARGO_MANIFEST_DIR");
/// jai-smell init が作成する設定ファイル。exclude は指定していない
const CONFIG: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/config/jai-smell.toml");
/// CONFIG の rule_files に指定したファイル
const RULE_FILES: [&str; 2] = [
    concat!(env!("CARGO_MANIFEST_DIR"), "/config/preset-rules.toml"),
    concat!(env!("CARGO_MANIFEST_DIR"), "/config/custom-rules.toml"),
];
const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/sample.md");
/// サンプルの設定の検証用。1 行ごとに、修正前の文章（検出される）と修正後の文章（検出されない）を記述する
const REWRITE_BEFORE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/rewrite_before.md");
const REWRITE_AFTER: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/rewrite_after.md");

/// tests/sample.md に対する検出結果の位置と表現
const SAMPLE_FINDINGS: [&str; 11] = [
    r#"3:8: "効く""#,
    r#"3:17: "効く""#,
    r#"3:24: "効く""#,
    r#"4:5: "走る""#,
    r#"4:12: "走る""#,
    r#"5:17: "〜に落ちる""#,
    r#"6:4: "崩す""#,
    r#"6:7: "壊れる""#,
    r#"7:4: "穴""#,
    r#"7:9: "落とし穴""#,
    r#"8:4: "見張る""#,
];

/// 検出結果の行から、位置と表現（message の先頭の "…"）のみを抽出する
fn findings(output: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(output)
        .lines()
        .filter_map(|line| line.split_once(" は、").map(|(head, _)| head.to_string()))
        .collect()
}

fn with_path(path: impl AsRef<Path>, positions: &[&str]) -> Vec<String> {
    positions
        .iter()
        .map(|position| format!("{}:{position}", path.as_ref().display()))
        .collect()
}

/// テストごとの一時ディレクトリ。リポジトリの外にあるため、リポジトリの jai-smell.toml は読み込まれない
struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn new(name: &str) -> Self {
        let root =
            std::env::temp_dir().join(format!("jai-smell-cli-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        Self { root }
    }

    fn path(&self, path: &str) -> PathBuf {
        self.root.join(path)
    }

    fn write(&self, path: &str, text: &str) -> PathBuf {
        let path = self.path(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, text).unwrap();
        path
    }

    /// ユーザー全体の設定として、jai-smell init が作成するファイルを配置する
    fn with_home_config(self) -> Self {
        for source in [CONFIG].iter().chain(&RULE_FILES) {
            let name = Path::new(source).file_name().unwrap().to_str().unwrap();
            self.write(
                &format!("home/.config/jai-smell/{name}"),
                &fs::read_to_string(source).unwrap(),
            );
        }
        self
    }

    fn command(&self) -> Command {
        let mut command = Command::new(BIN);
        command.env("HOME", self.path("home"));
        command
    }

    fn hook(&self, input: serde_json::Value) -> Output {
        run_hook(self.command().arg("hook"), input.to_string())
    }
}

fn files(args: &[&str]) -> Output {
    Command::new(BIN)
        .current_dir(REPOSITORY)
        .args(args)
        .output()
        .unwrap()
}

fn run_hook(command: &mut Command, input: String) -> Output {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

fn hook(input: serde_json::Value) -> Output {
    hook_with_config(CONFIG, input.to_string())
}

fn hook_with_config(config: &str, input: String) -> Output {
    run_hook(Command::new(BIN).args(["hook", "--config", config]), input)
}

fn edit(file_path: impl AsRef<Path>, new_string: &str) -> serde_json::Value {
    json!({
        "tool_name": "Edit",
        "tool_input": { "file_path": file_path.as_ref(), "old_string": "x", "new_string": new_string }
    })
}

fn write(file_path: &str, content: &str) -> serde_json::Value {
    json!({
        "tool_name": "Write",
        "tool_input": { "file_path": file_path, "content": content }
    })
}

#[test]
fn files_reports_findings_in_sample() {
    // 設定ファイルの相対パスは、カレントディレクトリを基準とする
    let output = files(&["--config", "config/jai-smell.toml", "tests/sample.md"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        findings(&output.stdout),
        with_path("tests/sample.md", &SAMPLE_FINDINGS)
    );
}

#[test]
fn files_uses_home_config_without_project_file() {
    let workspace = Workspace::new("home").with_home_config();
    let sample = workspace.write("work/sample.md", &fs::read_to_string(SAMPLE).unwrap());
    let output = workspace.command().arg(&sample).output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        findings(&output.stdout),
        with_path(&sample, &SAMPLE_FINDINGS)
    );
}

#[test]
fn files_layers_project_file_on_home_config() {
    let workspace = Workspace::new("layers").with_home_config();
    let project = workspace.write(
        "work/jai-smell.toml",
        r#"
        exclude = ["skip/**"]

        [[rule_sets]]
        name = "テスト"

        [[rule_sets.entries]]
        message = "\"注意\" は、テスト用の表現です。"
        tokens = [{ basic_form = "注意" }]
        "#,
    );
    let text = fs::read_to_string(SAMPLE).unwrap();
    let sample = workspace.write("work/docs/sample.md", &text);
    let skipped = workspace.write("work/skip/sample.md", &text);

    let output = workspace
        .command()
        .args([&sample, &skipped, &project])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let mut expected = SAMPLE_FINDINGS.to_vec();
    let line_8 = expected
        .iter()
        .position(|finding| finding.starts_with("8:"))
        .unwrap();
    expected.insert(line_8, r#"7:14: "注意""#);
    // skip 配下のファイルと、設定ファイル自体はチェックの対象外とする
    assert_eq!(findings(&output.stdout), with_path(&sample, &expected));
}

#[test]
fn home_exclude_skips_only_home_rule_sets() {
    let workspace = Workspace::new("home-exclude").with_home_config();
    workspace.write(
        "home/.config/jai-smell/jai-smell.toml",
        &format!(
            "exclude = [\"{}/**\"]\n{}",
            workspace.path("work").display(),
            fs::read_to_string(CONFIG).unwrap()
        ),
    );
    workspace.write(
        "work/jai-smell.toml",
        r#"
        [[rule_sets]]
        name = "テスト"

        [[rule_sets.entries]]
        message = "\"注意\" は、テスト用の表現です。"
        tokens = [{ basic_form = "注意" }]
        "#,
    );
    let sample = workspace.write("work/sample.md", &fs::read_to_string(SAMPLE).unwrap());
    let output = workspace.command().arg(&sample).output().unwrap();
    assert_eq!(
        findings(&output.stdout),
        with_path(&sample, &[r#"7:14: "注意""#])
    );
}

#[test]
fn project_include_limits_all_rule_sets() {
    let workspace = Workspace::new("project-include").with_home_config();
    workspace.write("work/jai-smell.toml", r#"include = ["docs/**"]"#);
    let text = fs::read_to_string(SAMPLE).unwrap();
    let doc = workspace.write("work/docs/sample.md", &text);
    let src = workspace.write("work/src/sample.md", &text);
    let output = workspace.command().args([&doc, &src]).output().unwrap();
    assert_eq!(findings(&output.stdout), with_path(&doc, &SAMPLE_FINDINGS));
}

#[test]
fn files_explains_missing_config() {
    let workspace = Workspace::new("missing");
    let sample = workspace.write("work/sample.md", "本文");
    let output = workspace.command().arg(&sample).output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("jai-smell.toml"), "{stderr}");
}

#[test]
fn files_skips_config_and_rule_files_themselves() {
    let output = files(&["--config", CONFIG, CONFIG, RULE_FILES[0], RULE_FILES[1]]);
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stdout.is_empty());
}

#[test]
fn repository_project_file_excludes_test_data() {
    let workspace = Workspace::new("repository").with_home_config();
    let output = workspace.command().arg(SAMPLE).output().unwrap();
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stdout.is_empty());
}

#[test]
fn hook_reports_word_written_by_edit() {
    let output = hook(edit("/work/doc.md", "CI が走る。"));
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.starts_with("修正を検討すべき表現の候補を検出しました。"),
        "{stderr}"
    );
    assert_eq!(findings(&output.stderr), [r#"/work/doc.md:1:5: "走る""#]);
}

#[test]
fn hook_ignores_words_outside_written_part() {
    let output = hook(edit("/work/doc.md", "ビルドが速くなる。"));
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty());
}

#[test]
fn hook_reports_word_written_by_write() {
    let output = hook(write("/work/new.md", "# 見出し\n\nログを見張る。\n"));
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(findings(&output.stderr), [r#"/work/new.md:3:4: "見張る""#]);
}

#[test]
fn hook_reports_words_written_by_multi_edit() {
    let output = hook(json!({
        "tool_name": "MultiEdit",
        "tool_input": {
            "file_path": "/work/doc.md",
            "edits": [
                { "old_string": "a", "new_string": "前提を崩す。" },
                { "old_string": "b", "new_string": "普通の文。" }
            ]
        }
    }));
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(findings(&output.stderr), [r#"/work/doc.md:1:4: "崩す""#]);
}

#[test]
fn hook_reads_source_code_as_plain_text() {
    let cases = [
        (
            edit(
                "/work/app.ts",
                "// 保存のたびに同期処理が走る\nconst run = () => sync();",
            ),
            r#"/work/app.ts:1:15: "走る""#,
        ),
        (
            write(
                "/work/cache.py",
                "def get():\n    \"\"\"キャッシュが効いているときは速い\"\"\"\n    return 1\n",
            ),
            r#"/work/cache.py:2:14: "効く""#,
        ),
        (
            edit("/work/Makefile", "# ログを見張るターゲット"),
            r#"/work/Makefile:1:6: "見張る""#,
        ),
    ];
    for (input, expected) in cases {
        let output = hook(input);
        assert_eq!(output.status.code(), Some(2), "{expected}");
        assert_eq!(findings(&output.stderr), [expected]);
    }
}

#[test]
fn hook_passes_code_without_japanese() {
    let output = hook(write(
        "/work/util.ts",
        "export const add = (a: number, b: number) => a + b;\n// run the job when cache misses\n",
    ));
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty());
}

#[test]
fn hook_skips_config_and_rule_files_themselves() {
    for file in [CONFIG].iter().chain(&RULE_FILES) {
        let output = hook(edit(file, "\"効く\" は"));
        assert_eq!(output.status.code(), Some(0), "{file}");
        assert!(output.stderr.is_empty(), "{file}");
    }
}

#[test]
fn hook_discovers_project_file_from_written_file() {
    let workspace = Workspace::new("hook").with_home_config();
    workspace.write("work/jai-smell.toml", r#"exclude = ["tests/**"]"#);

    let output = workspace.hook(edit(workspace.path("work/tests/a.rs"), "CI が走る。"));
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty());

    let output = workspace.hook(edit(workspace.path("work/src/a.rs"), "CI が走る。"));
    assert_eq!(output.status.code(), Some(2));
}

#[test]
fn hook_skips_code_only_in_markdown() {
    let text = "```\nCI が走る\n```\n\n`効く`\n";
    let output = hook(write("/work/doc.md", text));
    assert_eq!(output.status.code(), Some(0));
    let output = hook(write("/work/doc.txt", text));
    assert_eq!(
        findings(&output.stderr),
        [
            r#"/work/doc.txt:2:5: "走る""#,
            r#"/work/doc.txt:5:2: "効く""#
        ]
    );
}

#[test]
fn hook_does_not_block_on_its_own_failure() {
    let output = hook_with_config(CONFIG, "not json".into());
    assert_eq!(output.status.code(), Some(1));

    let workspace = Workspace::new("hook-missing");
    let output = workspace.hook(edit(workspace.path("work/doc.md"), "CI が走る。"));
    assert_eq!(output.status.code(), Some(1));
}

#[test]
fn sample_rules_detect_every_line_before_rewrite() {
    let output = files(&["--config", CONFIG, REWRITE_BEFORE]);
    let detected: HashSet<usize> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.rsplit_once(".md:")?.1.split(':').next()?.parse().ok())
        .collect();
    let text = fs::read_to_string(REWRITE_BEFORE).unwrap();
    for (i, line) in text.lines().enumerate() {
        assert!(detected.contains(&(i + 1)), "検出されない行: {line}");
    }
}

#[test]
fn sample_rules_pass_rewritten_text() {
    let output = files(&["--config", CONFIG, REWRITE_AFTER]);
    assert_eq!(
        output.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
}

#[test]
fn files_applies_rule_sets_only_to_matching_files() {
    let workspace = Workspace::new("scope");
    workspace.write(
        "work/jai-smell.toml",
        r#"
        [[rule_sets]]
        name = "ドキュメント"
        include = ["docs/**"]
        exclude = ["docs/drafts/**"]

        [[rule_sets.entries]]
        message = "\"注意\" は、テスト用の表現です。"
        tokens = [{ basic_form = "注意" }]
        "#,
    );
    let doc = workspace.write("work/docs/a.md", "注意する。");
    let draft = workspace.write("work/docs/drafts/a.md", "注意する。");
    let src = workspace.write("work/src/a.rs", "// 注意する。");
    let output = workspace
        .command()
        .args([&doc, &draft, &src])
        .output()
        .unwrap();
    assert_eq!(
        findings(&output.stdout),
        with_path(&doc, &[r#"1:1: "注意""#])
    );
}

#[test]
fn files_skip_findings_disabled_by_comments() {
    let workspace = Workspace::new("disable").with_home_config();
    let doc = workspace.write(
        "work/doc.md",
        "<!-- jai-smell-disable-next-line 変わった -->\n文章はどう変わったのか。設定を変える。\n\n設定が変わった。\n",
    );
    let src = workspace.write("work/a.rs", "// jai-smell-disable-file\n// 設定を見る。\n");
    let output = workspace.command().args([&doc, &src]).output().unwrap();
    assert_eq!(
        findings(&output.stdout),
        with_path(&doc, &[r#"2:16: "変える""#, r#"4:4: "変わる""#])
    );
}

#[test]
fn hook_reads_disable_comments_from_whole_file() {
    let workspace = Workspace::new("hook-disable").with_home_config();
    let file = workspace.write(
        "work/a.rs",
        "// jai-smell-disable 見る\n// 設定を見る。\n// jai-smell-enable\n// ログを見る。\n",
    );
    let output = workspace.hook(edit(&file, "// 設定を見る。\n"));
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty());

    let output = workspace.hook(edit(&file, "// ログを見る。\n"));
    assert_eq!(output.status.code(), Some(2));
}
