mod config;
mod dictionary;
mod hook;
mod init;
mod markdown;
mod matcher;
mod suppress;

use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use config::{Config, RuleSet};
use hook::Target;
use matcher::Tokenizer;

const FILE_HEADING: &str = "修正を検討すべき表現の候補を検出しました。チェック対象は今回の編集で追加・変更された部分のみです（行番号はその部分の中での位置を示します）。各箇所を確認し、該当する場合のみ修正してください。";

const USAGE: &str = "\
使い方:
  jai-smell [--config <path>] <files...>
      ファイル全体をチェックし、検出結果を path:line:col: message の形式で出力する。検出した場合は exit 1
  jai-smell hook [--config <path>]
      Claude Code の PostToolUse フックの JSON を stdin から読み込み、今回の編集で追加・変更された部分をチェックする。
      検出した場合は結果を stderr に出力して exit 2
  jai-smell init
      ~/.config/jai-smell/ に設定ファイルを作成し、Claude Code のプラグインをインストールする。
      jai-smell.toml と custom-rules.toml は存在しない場合のみ作成し、preset-rules.toml は常に最新の内容で上書きする

設定ファイルには、チェックの対象とするファイル（include）と対象外とするファイル（exclude）、
検出する表現をまとめたルールセット（rule_sets）を記述する。ルールセットごとにも include と exclude を指定できる。
ルールセットは、rule_files に指定したファイルに記述することもできる。
チェック対象のファイルのディレクトリから上位に向かって探索し、
最初に見つかった jai-smell.toml のルールセットを ~/.config/jai-smell/jai-smell.toml のルールセットに追加する。
トップレベルの include と exclude は、~/.config/jai-smell/jai-smell.toml ではそのファイルのルールセットに、
jai-smell.toml ではすべてのルールセットに適用する。
--config を指定すると、指定したファイルのみを設定として使用する。

.md は Markdown として解析し、コードブロック、インラインコード、HTML、リンクの URL はチェックの対象外とする。
その他のファイルは、プレーンテキストとしてファイル全体をチェックする。
ファイル内に jai-smell-disable-next-line（次の行）、jai-smell-disable（範囲の開始）と jai-smell-enable（範囲の終了）、
jai-smell-disable-file（ファイル全体）を記述すると、その範囲の検出結果をチェックの対象外とする。
コメントの後に空白区切りで表記を記述すると、その表記に一致する箇所のみを対象外とする。
読み込んだ設定ファイルと rule_files のファイル自体はチェックの対象外とする。";

enum Mode {
    Files(Vec<PathBuf>),
    Hook,
    Init,
}

struct Args {
    mode: Mode,
    /// None の場合は、チェック対象のファイルごとに設定ファイルを探索する
    config: Option<PathBuf>,
}

/// --help が指定された場合は None を返す
fn parse_args(args: impl Iterator<Item = String>) -> Result<Option<Args>, String> {
    let mut args = args.peekable();
    let subcommand = args
        .next_if(|arg| arg == "hook" || arg == "init")
        .unwrap_or_default();
    let mut config = None;
    let mut files = Vec::new();
    let mut options_ended = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            _ if options_ended => files.push(arg.into()),
            "-h" | "--help" => return Ok(None),
            "--config" => {
                let path = args
                    .next()
                    .ok_or("--config に設定ファイルのパスを指定してください")?;
                config = Some(PathBuf::from(path));
            }
            "--" => options_ended = true,
            _ if arg.starts_with('-') => return Err(format!("不明なオプションです: {arg}")),
            _ => files.push(arg.into()),
        }
    }
    let mode = match subcommand.as_str() {
        "" if files.is_empty() => return Err("ファイルを指定してください".into()),
        "" => Mode::Files(files),
        _ if !files.is_empty() => {
            return Err(format!("{subcommand} にはファイルを指定できません"));
        }
        "init" if config.is_some() => return Err("init には --config を指定できません".into()),
        "init" => Mode::Init,
        _ => Mode::Hook,
    };
    Ok(Some(Args { mode, config }))
}

fn main() -> ExitCode {
    let args = match parse_args(std::env::args().skip(1)) {
        Ok(Some(args)) => args,
        Ok(None) => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Err(error) => {
            eprintln!("jai-smell: {error}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    match &args.mode {
        Mode::Files(files) => run_files(&args, files).unwrap_or_else(|error| {
            eprintln!("jai-smell: {error}");
            ExitCode::from(2)
        }),
        Mode::Hook => run_hook(&args).unwrap_or_else(|error| {
            // exit 2 は Claude へのフィードバックとして扱われるため、フック自体の失敗は exit 1 とする
            eprintln!("jai-smell: {error}");
            ExitCode::from(1)
        }),
        Mode::Init => match init::run() {
            Ok(true) => ExitCode::SUCCESS,
            Ok(false) => ExitCode::from(1),
            Err(error) => {
                eprintln!("jai-smell: {error}");
                ExitCode::from(1)
            }
        },
    }
}

fn config_for(args: &Args, file: &Path) -> Result<Config, String> {
    match &args.config {
        Some(path) => Config::load(path),
        None => Config::for_file(file),
    }
}

fn run_files(args: &Args, files: &[PathBuf]) -> Result<ExitCode, String> {
    let tokenizer = Tokenizer::new()?;
    let mut found = false;
    let mut failed = false;
    for file in files {
        let config = config_for(args, file)?;
        if skipped(file, &config) {
            continue;
        }
        let text = match fs::read_to_string(file) {
            Ok(text) => text,
            Err(error) => {
                eprintln!("jai-smell: {}: {error}", file.display());
                failed = true;
                continue;
            }
        };
        let suppressions = suppress::parse(&text);
        let hits = find_hits(
            &applicable(&config, file),
            &tokenizer,
            &text,
            is_markdown(file),
        )?
        .into_iter()
        .filter(|(offset, _)| !suppress::covers(&suppressions, &text, *offset));
        for finding in to_findings(&text, hits) {
            println!("{}:{finding}", file.display());
            found = true;
        }
    }
    Ok(ExitCode::from(if failed {
        2
    } else if found {
        1
    } else {
        0
    }))
}

/// ファイルに適用するルールセット
fn applicable<'c>(config: &'c Config, file: &Path) -> Vec<&'c RuleSet> {
    config
        .rule_sets
        .iter()
        .filter(|rule_set| rule_set.applies_to(file))
        .collect()
}

fn run_hook(args: &Args) -> Result<ExitCode, String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|e| format!("stdin を読み込めません: {e}"))?;
    match hook::target(&input)? {
        None => Ok(ExitCode::SUCCESS),
        Some(Target { file_path, parts }) => check_written(args, &file_path, &parts),
    }
}

/// 検出した場合は、exit 2 と stderr で Claude にフィードバックする。
/// 複数の編集がある場合は空行で連結してチェックするため、行番号は連結後のテキスト内での位置になる
fn check_written(args: &Args, file_path: &str, parts: &[String]) -> Result<ExitCode, String> {
    let path = Path::new(file_path);
    let config = config_for(args, path)?;
    if skipped(path, &config) {
        return Ok(ExitCode::SUCCESS);
    }
    let rule_sets = applicable(&config, path);
    if rule_sets.is_empty() {
        return Ok(ExitCode::SUCCESS);
    }
    let text = parts.join("\n\n");
    let hits = find_hits(&rule_sets, &Tokenizer::new()?, &text, is_markdown(path))?;
    // 除外のコメントは、編集後のファイル全体から読み込む。ファイルを読み込めない場合は、編集された部分から読み込む
    let file_text = fs::read_to_string(path).unwrap_or_else(|_| text.clone());
    let suppressions = suppress::parse(&file_text);
    let hits = hits.into_iter().filter(|(offset, _)| {
        offset_in_file(parts, &file_text, *offset)
            .is_none_or(|offset| !suppress::covers(&suppressions, &file_text, offset))
    });
    let findings = to_findings(&text, hits);
    if findings.is_empty() {
        return Ok(ExitCode::SUCCESS);
    }
    eprintln!("{FILE_HEADING}");
    for finding in findings {
        eprintln!("{file_path}:{finding}");
    }
    Ok(ExitCode::from(2))
}

/// 連結したテキスト内の位置を、編集後のファイル内の位置に変換する。編集された部分がファイル内に見つからない場合は None を返す
fn offset_in_file(parts: &[String], file_text: &str, offset: usize) -> Option<usize> {
    let mut start = 0;
    for part in parts {
        if offset < start + part.len() {
            return file_text
                .find(part.as_str())
                .map(|found| found + offset - start);
        }
        start += part.len() + "\n\n".len();
    }
    None
}

/// 読み込んだ設定ファイル自体（検出対象の表現そのものを含む）はチェックの対象外とする
fn skipped(file: &Path, config: &Config) -> bool {
    config.paths.iter().any(|path| same_file(file, path))
}

struct Finding {
    line: usize,
    column: usize,
    message: String,
}

impl std::fmt::Display for Finding {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}:{}: {}", self.line, self.column, self.message)
    }
}

/// 検出結果を、テキスト内のバイト位置とメッセージの組で返す
fn find_hits<'r>(
    rule_sets: &[&'r RuleSet],
    tokenizer: &Tokenizer,
    text: &str,
    markdown: bool,
) -> Result<Vec<(usize, &'r str)>, String> {
    let ranges = if markdown {
        markdown::text_ranges(text)
    } else {
        std::iter::once(0..text.len()).collect()
    };
    let mut hits = Vec::new();
    for range in ranges {
        let tokens = tokenizer.tokenize(&text[range.clone()])?;
        for rule_set in rule_sets {
            for hit in matcher::find(&rule_set.dictionary, &tokens) {
                hits.push((range.start + hit.byte_start, hit.entry.message.as_str()));
            }
        }
    }
    // 複数のルールセットの検出結果を出現位置の順に並べる。安定ソートのため、同じ位置ではルールセットの定義順を維持する
    hits.sort_by_key(|(offset, _)| *offset);
    Ok(hits)
}

fn to_findings<'m>(text: &str, hits: impl IntoIterator<Item = (usize, &'m str)>) -> Vec<Finding> {
    hits.into_iter()
        .map(|(offset, message)| {
            let (line, column) = position(text, offset);
            Finding {
                line,
                column,
                message: message.to_string(),
            }
        })
        .collect()
}

/// バイト位置を、1 始まりの行番号と文字単位の列番号に変換する
fn position(text: &str, offset: usize) -> (usize, usize) {
    let before = &text[..offset];
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    (
        before.matches('\n').count() + 1,
        before[line_start..].chars().count() + 1,
    )
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_counts_characters_from_one() {
        let text = "一行目\nあいう漢字";
        assert_eq!(position(text, 0), (1, 1));
        assert_eq!(position(text, text.find("漢").unwrap()), (2, 4));
    }

    #[test]
    fn maps_offsets_of_joined_parts_to_file() {
        let parts = ["一".to_string(), "二".to_string()];
        let file_text = "前\n二\n後\n一\n";
        let joined = parts.join("\n\n");
        assert_eq!(
            offset_in_file(&parts, file_text, joined.find("一").unwrap()),
            file_text.find("一")
        );
        assert_eq!(
            offset_in_file(&parts, file_text, joined.find("二").unwrap()),
            file_text.find("二")
        );
        assert_eq!(offset_in_file(&["三".to_string()], file_text, 0), None);
    }

    fn mode(args: &[&str]) -> Result<Option<Args>, String> {
        parse_args(args.iter().map(|arg| arg.to_string()))
    }

    #[test]
    fn parses_subcommands() {
        assert!(matches!(
            mode(&["a.md"]),
            Ok(Some(Args {
                mode: Mode::Files(_),
                config: None
            }))
        ));
        assert!(matches!(
            mode(&["hook", "--config", "c.toml"]),
            Ok(Some(Args {
                mode: Mode::Hook,
                config: Some(_)
            }))
        ));
        assert!(matches!(
            mode(&["init"]),
            Ok(Some(Args {
                mode: Mode::Init,
                ..
            }))
        ));
        assert!(matches!(mode(&["--help"]), Ok(None)));
        assert!(mode(&[]).is_err());
        assert!(mode(&["hook", "a.md"]).is_err());
        assert!(mode(&["init", "--config", "c.toml"]).is_err());
        assert!(mode(&["--unknown", "a.md"]).is_err());
    }
}
