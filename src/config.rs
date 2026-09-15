//! 設定ファイルの読み込み。設定ファイルには、チェックの対象とするファイル（include）と対象外とするファイル（exclude）、
//! 検出する表現をまとめたルールセット（rule_sets）を記述する。
//!
//! チェック対象のファイルのディレクトリから上位に向かって探索し、最初に見つかった jai-smell.toml のルールセットを、
//! ユーザー全体の設定 ~/.config/jai-smell/jai-smell.toml のルールセットに追加する。
//! トップレベルの include と exclude は、ユーザー全体の設定ではそのファイルのルールセットに、
//! プロジェクトの設定ではすべてのルールセットに適用する。

use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use globset::{Glob, GlobBuilder, GlobSet, GlobSetBuilder};
use serde::Deserialize;

use crate::dictionary::{Dictionary, Entry};

const PROJECT_FILE: &str = "jai-smell.toml";
const HOME_FILE: &str = ".config/jai-smell/jai-smell.toml";
const SETUP: &str = "jai-smell init で ~/.config/jai-smell/jai-smell.toml を作成するか、チェック対象のファイルと同じディレクトリまたはその上位ディレクトリに jai-smell.toml を配置してください。";

/// ユーザー全体の設定ファイルのパス
pub fn home_file(home: &Path) -> PathBuf {
    home.join(HOME_FILE)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfigFile {
    /// チェックの対象とするファイルの glob。省略した場合は、すべてのファイルを対象とする
    include: Option<Vec<String>>,
    /// チェックの対象外とするファイルの glob
    #[serde(default)]
    exclude: Vec<String>,
    #[serde(default)]
    rule_sets: Vec<RuleSetFile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RuleSetFile {
    /// 設定ファイルのエラーメッセージに表示する名前
    name: String,
    /// このルールセットを適用するファイルの glob。省略した場合は、すべてのファイルに適用する
    include: Option<Vec<String>>,
    /// このルールセットのみ対象外とするファイルの glob
    #[serde(default)]
    exclude: Vec<String>,
    entries: Vec<Entry>,
}

/// 設定ファイルの種類。トップレベルの include と exclude の適用範囲が異なる
#[derive(Clone, Copy, PartialEq)]
enum Scope {
    /// ユーザー全体の設定。そのファイルのルールセットにのみ適用する
    Home,
    /// プロジェクトの設定、または --config で指定された設定。すべてのルールセットに適用する
    Project,
}

/// include と exclude の組
struct Filter {
    /// None の場合は、すべてのファイルを対象とする
    include: Option<GlobSet>,
    exclude: GlobSet,
}

impl Filter {
    fn new(
        include: Option<&[String]>,
        exclude: &[String],
        base: &Path,
        home: Option<&Path>,
    ) -> Result<Self, String> {
        let include = match include {
            None => None,
            Some([]) => {
                return Err("include に空の配列は指定できません。すべてのファイルを対象とする場合は、include を省略してください".into());
            }
            Some(patterns) => Some(glob_set("include", patterns, base, home)?),
        };
        Ok(Self {
            include,
            exclude: glob_set("exclude", exclude, base, home)?,
        })
    }

    fn accepts(&self, file: &Path) -> bool {
        self.include
            .as_ref()
            .is_none_or(|include| matches_path(include, file))
            && !matches_path(&self.exclude, file)
    }
}

/// 検出する表現のまとまりと、その適用先
pub struct RuleSet {
    pub dictionary: Dictionary,
    /// すべての Filter を満たすファイルに適用する
    filters: Vec<Rc<Filter>>,
}

impl RuleSet {
    /// 相対パスはカレントディレクトリを基準とする
    pub fn applies_to(&self, file: &Path) -> bool {
        self.filters.iter().all(|filter| filter.accepts(file))
    }
}

pub struct Config {
    /// 読み込んだ設定ファイルの絶対パス
    pub paths: Vec<PathBuf>,
    pub rule_sets: Vec<RuleSet>,
}

impl Config {
    /// --config で指定されたファイルのみを使用する。jai-smell.toml の探索と、ユーザー全体の設定の読み込みは行わない
    pub fn load(path: &Path) -> Result<Self, String> {
        let path = std::path::absolute(path).map_err(|e| e.to_string())?;
        let file = read(&path)?;
        Self::build(vec![(path, file, Scope::Project)], home().as_deref())
    }

    /// チェック対象のファイルに適用する設定を探索する
    pub fn for_file(file: &Path) -> Result<Self, String> {
        let file = std::path::absolute(file).map_err(|e| e.to_string())?;
        Self::discover(&file, home().as_deref())
    }

    /// file のディレクトリから上位に向かって jai-smell.toml を探索する。file は絶対パス
    fn discover(file: &Path, home: Option<&Path>) -> Result<Self, String> {
        let mut files = Vec::new();
        let dir = file.parent().unwrap_or(Path::new("/"));
        let project = dir
            .ancestors()
            .map(|dir| dir.join(PROJECT_FILE))
            .find(|path| path.is_file());
        // ユーザー全体の設定のディレクトリ内のファイルをチェックする場合は、同じ設定ファイルがプロジェクトの設定としても見つかるため、重複して読み込まない
        let home_file = home
            .map(|home| home.join(HOME_FILE))
            .filter(|path| path.is_file() && project.as_ref() != Some(path));
        if let Some(path) = home_file {
            let config = read(&path)?;
            files.push((path, config, Scope::Home));
        }
        if let Some(path) = project {
            let config = read(&path)?;
            files.push((path, config, Scope::Project));
        }
        if files.is_empty() {
            return Err(format!(
                "{} に適用する設定ファイルが見つかりません。{SETUP}",
                file.display()
            ));
        }
        Self::build(files, home)
    }

    /// 引数の先頭の設定から順に、ルールセットを追加する
    fn build(
        files: Vec<(PathBuf, ConfigFile, Scope)>,
        home: Option<&Path>,
    ) -> Result<Self, String> {
        let context = |path: &Path, e: String| format!("設定ファイル {}: {e}", path.display());
        let base = |path: &Path| path.parent().unwrap_or(Path::new("/")).to_path_buf();
        let mut parsed = Vec::new();
        for (path, file, scope) in files {
            let filter = Filter::new(file.include.as_deref(), &file.exclude, &base(&path), home)
                .map_err(|e| context(&path, e))?;
            parsed.push((path, file.rule_sets, scope, Rc::new(filter)));
        }
        let project_filter = parsed
            .iter()
            .find(|(_, _, scope, _)| *scope == Scope::Project)
            .map(|(_, _, _, filter)| filter.clone());

        let mut paths = Vec::new();
        let mut rule_sets = Vec::new();
        for (path, sets, scope, filter) in parsed {
            for (i, rule_set) in sets.into_iter().enumerate() {
                let RuleSetFile {
                    name,
                    include,
                    exclude,
                    entries,
                } = rule_set;
                let context = |e: String| context(&path, format!("rule_sets[{i}]（{name}）: {e}"));
                let mut filters = vec![filter.clone()];
                // ユーザー全体の設定のルールセットには、プロジェクトの設定のトップレベルの include と exclude も適用する
                if let (Scope::Home, Some(project_filter)) = (scope, &project_filter) {
                    filters.push(project_filter.clone());
                }
                let own = Filter::new(include.as_deref(), &exclude, &base(&path), home)
                    .map_err(context)?;
                filters.push(Rc::new(own));
                rule_sets.push(RuleSet {
                    dictionary: Dictionary::new(entries).map_err(context)?,
                    filters,
                });
            }
            paths.push(path);
        }
        Ok(Self { paths, rule_sets })
    }
}

/// シンボリックリンクの解決前と解決後のいずれかのパスが glob に一致するかどうかを返す。相対パスはカレントディレクトリを基準とする
fn matches_path(globs: &GlobSet, path: &Path) -> bool {
    [std::path::absolute(path).ok(), path.canonicalize().ok()]
        .into_iter()
        .flatten()
        .any(|path| globs.is_match(path))
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn read(path: &Path) -> Result<ConfigFile, String> {
    let text = fs::read_to_string(path)
        .map_err(|e| format!("設定ファイル {} を読み込めません: {e}", path.display()))?;
    toml::from_str(&text)
        .map_err(|e| format!("設定ファイル {} の形式が不正です: {e}", path.display()))
}

fn glob_set(
    field: &str,
    patterns: &[String],
    base: &Path,
    home: Option<&Path>,
) -> Result<GlobSet, String> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(glob(field, pattern, base, home)?);
    }
    builder.build().map_err(|e| e.to_string())
}

/// 設定ファイルに記述された glob を、resolve の規則で絶対パスのパターンに変換して生成する
fn glob(field: &str, pattern: &str, base: &Path, home: Option<&Path>) -> Result<Glob, String> {
    let pattern = resolve(pattern, base, home)?;
    GlobBuilder::new(&pattern)
        .literal_separator(true)
        .build()
        .map_err(|e| format!("{field} の {pattern} は glob として不正です: {e}"))
}

/// 絶対パスはそのまま使用し、~/ から始まるパスはホームディレクトリ、それ以外は設定ファイルのディレクトリを基準とする。
/// 基準のディレクトリ名に glob の記号が含まれていても、リテラルとして扱う
fn resolve(pattern: &str, base: &Path, home: Option<&Path>) -> Result<String, String> {
    let (dir, rest) = if pattern.starts_with('/') {
        return Ok(pattern.to_string());
    } else if let Some(rest) = pattern.strip_prefix("~/") {
        let home = home.ok_or("~/ から始まるパスを指定するには、HOME の設定が必要です")?;
        (home, rest)
    } else {
        (base, pattern)
    };
    let dir = dir
        .to_str()
        .ok_or("ディレクトリ名が UTF-8 ではありません")?;
    Ok(format!(
        "{}/{rest}",
        globset::escape(dir).trim_end_matches('/')
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = "/home/me";
    const HOME_CONFIG: &str = "/home/me/.config/jai-smell/jai-smell.toml";
    const PROJECT_CONFIG: &str = "/repo/jai-smell.toml";

    fn rule_set(name: &str) -> String {
        format!(
            "[[rule_sets]]\nname = \"{name}\"\n\n[[rule_sets.entries]]\nmessage = \"{name}\"\ntokens = [{{ pos = \"名詞\" }}]\n"
        )
    }

    fn file(text: &str) -> ConfigFile {
        toml::from_str(text).unwrap()
    }

    fn single(text: &str) -> Result<Config, String> {
        Config::build(
            vec![(PathBuf::from(PROJECT_CONFIG), file(text), Scope::Project)],
            Some(Path::new(HOME)),
        )
    }

    fn layered(home: &str, project: &str) -> Config {
        Config::build(
            vec![
                (PathBuf::from(HOME_CONFIG), file(home), Scope::Home),
                (PathBuf::from(PROJECT_CONFIG), file(project), Scope::Project),
            ],
            Some(Path::new(HOME)),
        )
        .unwrap()
    }

    /// ファイルに適用するルールセットの名前
    fn applied<'c>(config: &'c Config, file: &str) -> Vec<&'c str> {
        config
            .rule_sets
            .iter()
            .filter(|rule_set| rule_set.applies_to(Path::new(file)))
            .map(|rule_set| rule_set.dictionary.entries[0].message.as_str())
            .collect()
    }

    fn messages(config: &Config) -> Vec<&str> {
        config
            .rule_sets
            .iter()
            .flat_map(|rule_set| &rule_set.dictionary.entries)
            .map(|entry| entry.message.as_str())
            .collect()
    }

    #[test]
    fn resolves_absolute_home_and_relative_patterns() {
        let config = single(&format!(
            "exclude = [\"/abs/**\", \"~/notes/*.md\", \"tests/**\"]\n{}",
            rule_set("r")
        ))
        .unwrap();
        assert!(applied(&config, "/abs/a/b.rs").is_empty());
        assert!(applied(&config, "/home/me/notes/a.md").is_empty());
        assert!(applied(&config, "/repo/tests/cli.rs").is_empty());
        assert_eq!(applied(&config, "/repo/src/main.rs"), ["r"]);
        assert_eq!(applied(&config, "/other/tests/cli.rs"), ["r"]);
        assert_eq!(applied(&config, "/home/me/notes/sub/a.md"), ["r"]);
    }

    #[test]
    fn applies_include_and_exclude_of_rule_set() {
        let config = single(
            r#"
            include = ["docs/**", "src/**"]

            [[rule_sets]]
            name = "docs"
            include = ["docs/**"]
            exclude = ["docs/drafts/**"]

            [[rule_sets.entries]]
            message = "docs"
            tokens = [{ pos = "名詞" }]

            [[rule_sets]]
            name = "all"

            [[rule_sets.entries]]
            message = "all"
            tokens = [{ pos = "名詞" }]
            "#,
        )
        .unwrap();
        assert_eq!(applied(&config, "/repo/docs/a.md"), ["docs", "all"]);
        assert_eq!(applied(&config, "/repo/docs/drafts/a.md"), ["all"]);
        assert_eq!(applied(&config, "/repo/src/a.rs"), ["all"]);
        assert!(applied(&config, "/repo/tests/a.rs").is_empty());
    }

    #[test]
    fn home_filter_applies_only_to_home_rule_sets() {
        let config = layered(
            &format!("exclude = [\"/repo/**\"]\n{}", rule_set("home")),
            &rule_set("project"),
        );
        assert_eq!(messages(&config), ["home", "project"]);
        assert_eq!(applied(&config, "/repo/a.md"), ["project"]);
        assert_eq!(applied(&config, "/other/a.md"), ["home", "project"]);

        let config = layered(
            &format!("include = [\"~/notes/**\"]\n{}", rule_set("home")),
            &rule_set("project"),
        );
        assert_eq!(applied(&config, "/repo/a.md"), ["project"]);
        assert_eq!(applied(&config, "/home/me/notes/a.md"), ["home", "project"]);
    }

    #[test]
    fn project_filter_applies_to_all_rule_sets() {
        let config = layered(
            &rule_set("home"),
            &format!(
                "include = [\"docs/**\"]\nexclude = [\"docs/drafts/**\"]\n{}",
                rule_set("project")
            ),
        );
        assert_eq!(applied(&config, "/repo/docs/a.md"), ["home", "project"]);
        assert!(applied(&config, "/repo/docs/drafts/a.md").is_empty());
        assert!(applied(&config, "/repo/src/a.rs").is_empty());
    }

    #[test]
    fn rejects_invalid_config() {
        assert!(toml::from_str::<ConfigFile>("ignore = []").is_err());
        assert!(toml::from_str::<ConfigFile>("inherit = false").is_err());
        assert!(
            toml::from_str::<ConfigFile>(
                "[[entries]]\nmessage = \"m\"\ntokens = [{ pos = \"名詞\" }]"
            )
            .is_err()
        );
        assert!(
            toml::from_str::<ConfigFile>("[[rule_sets]]\n[[rule_sets.entries]]\nmessage = \"m\"\ntokens = [{ pos = \"名詞\" }]")
                .is_err()
        );
        assert!(single(r#"exclude = ["a/[b"]"#).is_err());
        let error = single("include = []").err().unwrap();
        assert!(error.contains("include に空の配列"), "{error}");
        let error = single(
            "[[rule_sets]]\nname = \"n\"\n\n[[rule_sets.entries]]\nmessage = \"m\"\ntokens = []",
        )
        .err()
        .unwrap();
        assert!(error.contains("rule_sets[0]（n）"), "{error}");
        let error = single(
            "[[rule_sets]]\nname = \"n\"\ninclude = []\n\n[[rule_sets.entries]]\nmessage = \"m\"\ntokens = [{ pos = \"名詞\" }]",
        )
        .err()
        .unwrap();
        assert!(
            error.contains("rule_sets[0]（n）: include に空の配列"),
            "{error}"
        );
        let without_home = Config::build(
            vec![(
                PathBuf::from(PROJECT_CONFIG),
                file(r#"exclude = ["~/a"]"#),
                Scope::Project,
            )],
            None,
        );
        assert!(without_home.is_err());
    }

    /// テストごとの一時ディレクトリに、ユーザー全体の設定とプロジェクトの設定を配置する
    struct Workspace {
        root: PathBuf,
    }

    impl Workspace {
        fn new(name: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("jai-smell-unit-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn write(&self, path: &str, text: &str) {
            let path = self.root.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }

        fn discover(&self, file: &str) -> Result<Config, String> {
            Config::discover(&self.root.join(file), Some(&self.root.join("home")))
        }
    }

    #[test]
    fn discovers_nearest_project_file_over_home() {
        let workspace = Workspace::new("nearest");
        workspace.write("home/.config/jai-smell/jai-smell.toml", &rule_set("home"));
        workspace.write("project/jai-smell.toml", &rule_set("project"));
        workspace.write("project/sub/jai-smell.toml", &rule_set("sub"));

        let config = workspace.discover("project/sub/deep/a.md").unwrap();
        assert_eq!(messages(&config), ["home", "sub"]);
        assert_eq!(config.paths.len(), 2);

        let config = workspace.discover("project/a.md").unwrap();
        assert_eq!(messages(&config), ["home", "project"]);

        let config = workspace.discover("other/a.md").unwrap();
        assert_eq!(messages(&config), ["home"]);
    }

    #[test]
    fn works_with_only_one_of_home_and_project() {
        let workspace = Workspace::new("only-project");
        workspace.write("project/jai-smell.toml", &rule_set("project"));
        let config = workspace.discover("project/a.md").unwrap();
        assert_eq!(messages(&config), ["project"]);

        let error = workspace.discover("other/a.md").err().unwrap();
        assert!(error.contains("jai-smell.toml"), "{error}");
    }

    #[test]
    fn reads_home_file_once_inside_its_directory() {
        let workspace = Workspace::new("home-dir");
        workspace.write("home/.config/jai-smell/jai-smell.toml", &rule_set("home"));
        let config = workspace
            .discover("home/.config/jai-smell/notes.md")
            .unwrap();
        assert_eq!(messages(&config), ["home"]);
        assert_eq!(config.paths.len(), 1);
    }

    #[test]
    fn loads_repository_config() {
        Config::load(Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/examples/jai-smell.toml"
        )))
        .unwrap();
    }
}
