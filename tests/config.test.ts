import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Config, type ConfigFile } from "../src/config.ts";

const HOME = "/home/me";
const HOME_CONFIG = "/home/me/.config/jai-smell/jai-smell.toml";
const PROJECT_CONFIG = "/repo/jai-smell.toml";
const DOCS_CONFIG = "/repo/docs/jai-smell.toml";
/** デフォルトで適用する、表現のルール */
const DEFAULTS = ["translationese", "metaphor", "unusual-terms"];
/** 設定で有効にした場合にのみ適用する、表現のルール */
const OPT_IN = ["colloquial", "prefer-hiragana"];
/** 表現のルールの定義の順序 */
const ALL = ["translationese", "metaphor", "colloquial", "unusual-terms", "prefer-hiragana"];

/** デフォルトでは無効にする textlint のルール */
const TEXTLINT_OFF = {
  "no-mix-dearu-desumasu": false,
  "no-ai-list-formatting": false,
  "no-ai-hype-expressions": false,
  "no-ai-emphasis-patterns": false,
  "ai-tech-writing-guideline": false,
  "no-ai-colon-continuation": false,
};

const ruleSet = (name: string, extra = "") =>
  `[[rule_sets]]\nname = "${name}"\n${extra}\n[[rule_sets.entries]]\nmessage = "${name}"\ntokens = [{ pos = "名詞" }]\n`;

const file = (text: string) => Bun.TOML.parse(text) as ConfigFile;

/** ユーザー全体の設定は / を、その他の設定はそのディレクトリを、相対パスの glob の基準とする */
const layer = (path: string, text: string) => ({
  path,
  file: file(text),
  base: path === HOME_CONFIG ? "/" : dirname(path),
});

const single = (text: string) => Config.build([layer(PROJECT_CONFIG, text)], HOME);

const layered = (home: string, project: string, docs?: string) =>
  Config.build(
    [
      layer(HOME_CONFIG, home),
      layer(PROJECT_CONFIG, project),
      ...(docs === undefined ? [] : [layer(DOCS_CONFIG, docs)]),
    ],
    HOME,
  );

/** ファイルに適用する、利用者が追加したルールセットの名前 */
const applied = (config: Config, path: string) => config.ruleSetsFor(path).map(({ name }) => name);

test("設定ファイルがない場合は、組み込みのデフォルトを使用する", () => {
  const config = Config.build([], HOME);
  expect(config.paths).toEqual([]);
  // 文体の方針を適用するルールセットは、設定で有効にした場合にのみ適用する
  expect(config.expressionRulesFor("/work/a.rs")).toEqual(DEFAULTS);
  expect(config.entriesFor("/work/a.rs").length).toBeGreaterThan(50);
  const enabled = single(
    `[expressions.rules]\n${OPT_IN.map((name) => `${name} = true\n`).join("")}`,
  );
  expect(enabled.expressionRulesFor("/repo/a.rs")).toEqual(ALL);
  expect(enabled.entriesFor("/repo/a.rs").length).toBeGreaterThan(100);
  // textlint のルールは、設定で有効にした場合にのみ適用する
  expect(config.appliesTextlintTo("/work/a.md")).toBe(false);
  expect(config.textlint.items).toEqual(TEXTLINT_OFF);
});

test("textlint を有効にした場合は、デフォルトでは .md と .txt のファイルに適用する", () => {
  const config = single("[textlint]\nenabled = true\n");
  expect(config.appliesTextlintTo("/work/a.md")).toBe(true);
  expect(config.appliesTextlintTo("/work/notes.txt")).toBe(true);
  expect(config.appliesTextlintTo("/work/a.rs")).toBe(false);
});

test("絶対パス、~/ から始まるパス、相対パスの glob を解決する", () => {
  const config = single(`exclude = ["/abs/**", "~/notes/*.md", "tests/**"]\n${ruleSet("r")}`);
  expect(applied(config, "/abs/a/b.rs")).toEqual([]);
  expect(applied(config, "/home/me/notes/a.md")).toEqual([]);
  expect(applied(config, "/repo/tests/cli.rs")).toEqual([]);
  expect(applied(config, "/repo/src/main.rs")).toEqual(["r"]);
  expect(applied(config, "/other/tests/cli.rs")).toEqual(["r"]);
  expect(applied(config, "/home/me/notes/sub/a.md")).toEqual(["r"]);
});

test("ユーザー全体の設定の相対パスの glob は、/ を基準とする", () => {
  const config = layered(
    `exclude = ["**/CHANGELOG.md"]\n${ruleSet("home", 'include = ["**/*.md"]')}`,
    "",
  );
  expect(applied(config, "/repo/docs/a.md")).toEqual(["home"]);
  expect(applied(config, "/repo/src/a.rs")).toEqual([]);
  expect(config.excludes("/repo/CHANGELOG.md")).toBe(true);
});

test("exclude は、すべての設定ファイルの指定を合わせて、すべてのチェックに適用する", () => {
  const config = layered(
    `exclude = ["/repo/vendor/**"]\n${ruleSet("home")}`,
    `exclude = ["tests/**"]\n${ruleSet("project")}`,
    'exclude = ["drafts/**"]',
  );
  expect(applied(config, "/repo/a.md")).toEqual(["home", "project"]);
  for (const path of ["/repo/vendor/a.md", "/repo/tests/a.md", "/repo/docs/drafts/a.md"]) {
    expect(config.excludes(path)).toBe(true);
    expect(config.entriesFor(path)).toEqual([]);
    expect(config.appliesTextlintTo(path)).toBe(false);
  }
  // 相対パスは、記述した設定ファイルのディレクトリを基準とする
  expect(config.excludes("/repo/drafts/a.md")).toBe(false);
});

test("追加のルールセットは、すべての設定ファイルのものを、include と exclude に一致するファイルに適用する", () => {
  const config = layered(
    ruleSet("home"),
    ruleSet("docs", 'include = ["docs/**"]\nexclude = ["docs/drafts/**"]'),
    ruleSet("inner"),
  );
  expect(config.ruleSets.map(({ name }) => name)).toEqual(["home", "docs", "inner"]);
  expect(applied(config, "/repo/docs/a.md")).toEqual(["home", "docs", "inner"]);
  expect(applied(config, "/repo/docs/drafts/a.md")).toEqual(["home", "inner"]);
  expect(applied(config, "/repo/src/a.rs")).toEqual(["home", "inner"]);
});

test("expressions は、キーごと、およびルールの名前ごとに、後の設定ファイルの値を使用する", () => {
  let config = layered(
    '[expressions]\ninclude = ["**/*.md"]\n[expressions.rules]\nmetaphor = false\ncolloquial = false\n',
    "[expressions.rules]\ncolloquial = true\n",
  );
  expect(config.expressionRulesFor("/repo/a.md")).toEqual([
    "translationese",
    "colloquial",
    "unusual-terms",
  ]);
  expect(config.expressionRulesFor("/repo/a.rs")).toEqual([]);
  config = layered("[expressions]\nenabled = false\n", "", "[expressions]\nenabled = true\n");
  expect(config.expressionRulesFor("/repo/docs/a.md")).toEqual(DEFAULTS);
  config = layered("[expressions]\nenabled = false\n", "");
  expect(config.expressionRulesFor("/repo/a.md")).toEqual([]);
  // exclude も、後の設定ファイルの値に置き換える
  config = layered(
    '[expressions]\nexclude = ["**/CHANGELOG.md"]\n',
    '[expressions]\nexclude = ["drafts/**"]\n',
  );
  expect(config.expressionRulesFor("/repo/CHANGELOG.md")).toEqual(DEFAULTS);
  expect(config.expressionRulesFor("/repo/drafts/a.md")).toEqual([]);
});

test("expressions.rules の不明な名前は、警告としてチェックを継続する", () => {
  const config = single('[expressions.rules]\n"存在しない" = false\n');
  expect(config.warnings.length).toBe(1);
  expect(config.warnings[0]).toContain("存在しない");
  expect(config.expressionRulesFor("/repo/a.md")).toEqual(DEFAULTS);
});

test("textlint は、キーごと、およびルールの名前ごとに、後の設定ファイルの値を使用する", () => {
  let config = layered(
    "[textlint.rules]\nmax-ten = false\nsentence-length = { max = 120 }\n",
    '[textlint]\nenabled = true\ninclude = ["docs/**"]\n[textlint.rules]\nsentence-length = { skipPatterns = [] }\n',
  );
  expect(config.textlint.items).toEqual({
    ...TEXTLINT_OFF,
    "max-ten": false,
    "sentence-length": { skipPatterns: [] },
  });
  // include を記述した場合は、デフォルトの .md と .txt に代えて使用する
  expect(config.appliesTextlintTo("/repo/docs/a.rs")).toBe(true);
  expect(config.appliesTextlintTo("/repo/a.md")).toBe(false);
  config = layered("[textlint]\nenabled = true\n", "[textlint]\nenabled = false\n");
  expect(config.appliesTextlintTo("/repo/docs/a.md")).toBe(false);
  config = layered(
    "[textlint]\nenabled = true\n",
    "[textlint]\nenabled = false\n",
    "[textlint]\nenabled = true\n",
  );
  expect(config.appliesTextlintTo("/repo/docs/a.md")).toBe(true);
});

test("不正な設定はエラーにする", () => {
  expect(() => single('include = ["docs/**"]')).toThrow("不明なフィールド");
  expect(() => single("inherit = false")).toThrow("不明なフィールド");
  expect(() => single('[[entries]]\nmessage = "m"\ntokens = [{ pos = "名詞" }]')).toThrow();
  expect(() =>
    single('[[rule_sets]]\n[[rule_sets.entries]]\nmessage = "m"\ntokens = [{ pos = "名詞" }]'),
  ).toThrow("name");
  expect(() => single('exclude = ["a/[b"]')).toThrow("glob として不正");
  expect(() =>
    single('[[rule_sets]]\nname = "n"\n\n[[rule_sets.entries]]\nmessage = "m"\ntokens = []'),
  ).toThrow("rule_sets[0]（n）");
  expect(() => single(ruleSet("n", "include = []"))).toThrow(
    "rule_sets[0]（n）: include に空の配列",
  );
  expect(() => single("[textlint]\nunknown = 1")).toThrow("textlint: 不明なフィールド");
  expect(() => single("[textlint]\ninclude = []")).toThrow("textlint: include に空の配列");
  expect(() => single('[expressions]\nenabled = "no"')).toThrow("expressions: enabled");
  expect(() => single('[expressions.rules]\nmetaphor = "off"')).toThrow("metaphor");
  expect(() => Config.build([layer(PROJECT_CONFIG, 'exclude = ["~/a"]')], undefined)).toThrow(
    "HOME",
  );
});

/** テストごとの一時ディレクトリに、ユーザー全体の設定とプロジェクトの設定を配置する */
class Workspace {
  readonly root: string;

  constructor(name: string) {
    this.root = join(tmpdir(), `jai-smell-unit-${process.pid}-${name}`);
    rmSync(this.root, { recursive: true, force: true });
    mkdirSync(this.root, { recursive: true });
  }

  write(path: string, text: string): void {
    const full = join(this.root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }

  discover(path: string): Config {
    return Config.discover(join(this.root, path), join(this.root, "home"));
  }
}

const names = (config: Config) => config.ruleSets.map(({ name }) => name);

test("ユーザー全体の設定に、上位のディレクトリから順に jai-smell.toml を統合する", () => {
  const workspace = new Workspace("layers");
  workspace.write("home/.config/jai-smell/jai-smell.toml", ruleSet("home"));
  workspace.write("project/jai-smell.toml", ruleSet("project"));
  workspace.write("project/sub/jai-smell.toml", ruleSet("sub"));
  let config = workspace.discover("project/sub/deep/a.md");
  expect(names(config)).toEqual(["home", "project", "sub"]);
  expect(config.paths.length).toBe(3);
  config = workspace.discover("project/a.md");
  expect(names(config)).toEqual(["home", "project"]);
  config = workspace.discover("other/a.md");
  expect(names(config)).toEqual(["home"]);
});

test(".git があるディレクトリより上位の jai-smell.toml は読み込まない", () => {
  const workspace = new Workspace("git");
  workspace.write("outer/jai-smell.toml", ruleSet("outer"));
  workspace.write("outer/repo/.git/HEAD", "");
  workspace.write("outer/repo/jai-smell.toml", ruleSet("repo"));
  workspace.write("outer/repo/docs/jai-smell.toml", ruleSet("docs"));
  // worktree とサブモジュールでは、.git はファイルである
  workspace.write("outer/repo/.claude/worktrees/x/.git", "gitdir: ../../../.git/worktrees/x\n");
  workspace.write("outer/repo/.claude/worktrees/x/jai-smell.toml", ruleSet("worktree"));
  expect(names(workspace.discover("outer/repo/docs/a.md"))).toEqual(["repo", "docs"]);
  expect(names(workspace.discover("outer/repo/.claude/worktrees/x/docs/a.md"))).toEqual([
    "worktree",
  ]);
  expect(names(workspace.discover("outer/notes/a.md"))).toEqual(["outer"]);
});

test("Git リポジトリの外では、ホームディレクトリとその上位の jai-smell.toml は読み込まない", () => {
  const workspace = new Workspace("home-boundary");
  workspace.write("jai-smell.toml", ruleSet("above-home"));
  workspace.write("home/jai-smell.toml", ruleSet("home-dir"));
  workspace.write("home/notes/jai-smell.toml", ruleSet("notes"));
  expect(names(workspace.discover("home/notes/sub/a.md"))).toEqual(["notes"]);
  expect(names(workspace.discover("home/a.md"))).toEqual([]);
});

test("rule_files のルールセットを、設定ファイルのルールセットより先に読み込む", () => {
  const workspace = new Workspace("rule-files");
  const root = workspace.root;
  workspace.write(
    "home/.config/jai-smell/jai-smell.toml",
    `rule_files = ["custom.toml", "~/rules/shared.toml"]\nexclude = ["${root}/skip/**"]\n${ruleSet("own")}`,
  );
  workspace.write("home/.config/jai-smell/custom.toml", ruleSet("custom"));
  workspace.write("home/rules/shared.toml", ruleSet("shared", 'include = ["**/notes/**"]'));
  // 複数の設定ファイルが同じファイルを指定した場合は、1 回のみ読み込む
  workspace.write(
    "project/jai-smell.toml",
    `rule_files = ["${root}/home/rules/shared.toml", "rules.toml"]`,
  );
  workspace.write("project/rules.toml", ruleSet("project-rules", 'include = ["docs/**"]'));
  const config = workspace.discover("project/a.md");
  expect(names(config)).toEqual(["custom", "shared", "own", "project-rules"]);
  expect(config.paths.length).toBe(5);
  // rule_files のルールセットの相対パスの glob は、指定した設定ファイルと同じ基準を使用する
  expect(applied(config, `${root}/project/notes/a.md`)).toEqual(["custom", "shared", "own"]);
  expect(applied(config, `${root}/project/docs/a.md`)).toEqual(["custom", "own", "project-rules"]);
  expect(applied(config, `${root}/skip/a.md`)).toEqual([]);
});

test("存在しない rule_files と、形式が不正な rule_files はエラーにする", () => {
  const workspace = new Workspace("invalid-rule-files");
  workspace.write("project/jai-smell.toml", 'rule_files = ["missing.toml"]');
  expect(() => workspace.discover("project/a.md")).toThrow(
    /rule_files: 設定ファイル .*missing\.toml を読み込めません/,
  );
  workspace.write("project/jai-smell.toml", 'rule_files = ["rules.toml"]');
  workspace.write("project/rules.toml", 'exclude = ["a/**"]');
  expect(() => workspace.discover("project/a.md")).toThrow("rules.toml の形式が不正です");
});

test("ユーザー全体の設定のディレクトリ内のファイルでは、設定を重複して読み込まない", () => {
  const workspace = new Workspace("home-dir");
  workspace.write("home/.config/jai-smell/jai-smell.toml", ruleSet("home"));
  const config = workspace.discover("home/.config/jai-smell/notes.md");
  expect(names(config)).toEqual(["home"]);
  expect(config.paths.length).toBe(1);
});
