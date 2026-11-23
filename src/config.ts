// 設定ファイルの読み込み。
//
// 設定は、次の順に統合する。後の層の指定を優先する。
//   1. 組み込みのデフォルト: 表現のルールをすべてのファイルに適用する。textlint のルールは適用しない
//      （textlint.enabled に true を指定した場合は、.md と .txt に適用する）
//   2. ユーザー全体の設定: ~/.config/jai-smell/jai-smell.toml
//   3. チェック対象のファイルの上位のディレクトリにある jai-smell.toml。上位のディレクトリから順に統合する
//
// 3 の探索は、チェック対象のファイルのディレクトリから上位に向かって行い、.git があるディレクトリで停止する。
// Git リポジトリの外では、ホームディレクトリの手前で停止する。リポジトリ内の worktree や、
// ホームディレクトリの直下に配置された jai-smell.toml が、意図せず読み込まれないようにするためである。
//
// 設定の統合の方法は、次の 3 種類である。
//   - exclude: すべての層の指定を合わせて、すべてのチェックに適用する
//   - rule_sets と rule_files: すべての層のルールセットを追加する
//   - expressions と textlint: キーごと、およびルールの名前ごとに、後の層の値を使用する
//   - replies: キーごとに、後の層の値を使用する
//
// 相対パスの glob は、ユーザー全体の設定では / を、その他の設定ではその設定ファイルのディレクトリを基準とする。
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { type Entry, parseEntries, rejectUnknownKeys } from "./dictionary.ts";
import { expressionRules } from "./expressions.ts";
import { escapeGlob, globToRegExp } from "./glob.ts";

const PROJECT_FILE = "jai-smell.toml";
const HOME_FILE = ".config/jai-smell/jai-smell.toml";
const HOME_REQUIRED = "~/ から始まるパスを指定するには、HOME の設定が必要です";

/** preset を記述した設定ファイルに、修正の方法を示す。不明なフィールドのエラーでは、修正の方法を特定できないためである */
const PRESET_RENAMED =
  'preset は使用できません。claude "/jai-smell:configure" を実行すると、設定ファイルを修正できます';

/** textlint のルールを有効にした場合の、適用するファイルのデフォルト。ルールは文章を対象としているためである */
const TEXTLINT_INCLUDE = ["**/*.md", "**/*.txt"];
/**
 * 表現のルールのうち、設定で有効にした場合にのみ適用するもの。
 * 文体の方針（硬い文体への統一、表記の統一）を適用するルールで、適用するかどうかは文書によって異なるためである。
 * その他のルールは、AI が生成した文章に多い表現を対象としており、デフォルトで適用する
 */
const EXPRESSION_RULES: Record<string, unknown> = { colloquial: false, "prefer-hiragana": false };

/**
 * textlint のルールのうち、設定で有効にした場合にのみ適用するもの。
 * 人間が記述した技術文書でも一般的な記述を検出するためである。対象は、「- **項目**: 説明」の形式のリスト、
 * 見出しの中の太字、コードブロックの前のコロンである。その他のルールは、textlint を有効にすると適用する
 */
const TEXTLINT_RULES: Record<string, unknown> = {
  "no-ai-list-formatting": false,
  "no-ai-emphasis-patterns": false,
  "no-ai-colon-continuation": false,
};

/** ユーザー全体の設定ファイルのパス */
export function homeFile(home: string): string {
  return join(home, HOME_FILE);
}

type Table = Record<string, unknown>;

/** 設定ファイルの内容。形式の検証は build で行う */
export type ConfigFile = Table;

/** 統合する設定ファイル。base は、相対パスの glob の基準とするディレクトリ */
export type Layer = { path: string; file: ConfigFile; base: string };

const isTable = (value: unknown): value is Table =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** include と exclude の組 */
class Filter {
  constructor(
    /** undefined の場合は、すべてのファイルを対象とする */
    readonly include: Globs | undefined,
    readonly exclude: Globs,
  ) {}

  accepts(file: string): boolean {
    return (
      (this.include === undefined || this.include.matches(file)) && !this.exclude.matches(file)
    );
  }
}

/** glob の並び。記述と、絶対パスに解決した結果を保持する */
class Globs {
  private readonly regexps: RegExp[];

  constructor(
    field: string,
    /** 絶対パスに解決した glob */
    readonly patterns: string[],
  ) {
    this.regexps = patterns.map((pattern) => {
      try {
        return globToRegExp(pattern);
      } catch (error) {
        throw new Error(
          `${field} の ${pattern} は glob として不正です: ${(error as Error).message}`,
        );
      }
    });
  }

  /** シンボリックリンクの解決前と解決後のいずれかのパスが一致するかどうかを返す。相対パスはカレントディレクトリを基準とする */
  matches(path: string): boolean {
    const candidates = [resolvePath(path)];
    try {
      candidates.push(realpathSync(path));
    } catch {
      // 存在しないファイルは、解決前のパスのみで判定する
    }
    return candidates.some((candidate) => this.regexps.some((regexp) => regexp.test(candidate)));
  }
}

/** 利用者が追加したルールセットと、その適用先 */
export class RuleSet {
  constructor(
    readonly name: string,
    readonly entries: Entry[],
    private readonly filter: Filter,
  ) {}

  /** 相対パスはカレントディレクトリを基準とする */
  appliesTo(file: string): boolean {
    return this.filter.accepts(file);
  }
}

/** 組み込みのルール（表現のルール、textlint のルール）の設定 */
export class BuiltIn {
  constructor(
    readonly enabled: boolean,
    readonly filter: Filter,
    /** ルールセットまたはルールの名前ごとの設定 */
    readonly items: Record<string, unknown>,
  ) {}

  appliesTo(file: string): boolean {
    return this.enabled && this.filter.accepts(file);
  }
}

/** Claude の返答のチェックの設定 */
export type Replies = {
  /** 大部分が英語の返答を検出する */
  japanese: boolean;
};

const REPLIES_KEYS = ["japanese"] as const;

export class Config {
  private constructor(
    /** 読み込んだ設定ファイルと rule_files のファイルの絶対パス。読み込んだ順 */
    readonly paths: string[],
    /** すべての層の exclude */
    private readonly exclude: Globs,
    /** 利用者が追加したルールセット */
    readonly ruleSets: RuleSet[],
    /** 表現のルールの設定。items は、ルールの id ごとの true または false */
    readonly expressions: BuiltIn,
    /** textlint の設定。items は、ルールの名前ごとの true、false、またはオプション */
    readonly textlint: BuiltIn,
    readonly replies: Replies,
    /** 設定の誤りのうち、チェックを継続できるもの */
    readonly warnings: string[],
  ) {}

  /** exclude に一致するファイルには、どのチェックも適用しない */
  excludes(file: string): boolean {
    return this.exclude.matches(file);
  }

  /** ファイルに適用する、利用者が追加したルールセット */
  ruleSetsFor(file: string): RuleSet[] {
    return this.excludes(file) ? [] : this.ruleSets.filter((ruleSet) => ruleSet.appliesTo(file));
  }

  /** ファイルに適用する、表現のルールの id */
  expressionRulesFor(file: string): string[] {
    if (this.excludes(file) || !this.expressions.appliesTo(file)) {
      return [];
    }
    return expressionRules()
      .map(({ id }) => id)
      .filter((id) => this.expressions.items[id] !== false);
  }

  /** ファイルに適用する entries。表現のルール、利用者が追加したルールセットの順に返す */
  entriesFor(file: string): Entry[] {
    const ids = this.expressionRulesFor(file);
    return [
      ...expressionRules()
        .filter(({ id }) => ids.includes(id))
        .flatMap(({ entries }) => entries),
      ...this.ruleSetsFor(file).flatMap(({ entries }) => entries),
    ];
  }

  /** ファイルに textlint のルールを適用するかどうかを返す */
  appliesTextlintTo(file: string): boolean {
    return !this.excludes(file) && this.textlint.appliesTo(file);
  }

  /** --config で指定されたファイルのみを、組み込みのデフォルトと統合する。jai-smell.toml の探索と、ユーザー全体の設定の読み込みは行わない */
  static load(path: string): Config {
    const absolute = resolvePath(path);
    return Config.build(
      [{ path: absolute, file: read(absolute), base: dirname(absolute) }],
      home(),
    );
  }

  /** チェック対象のファイルに適用する設定を探索する。同じディレクトリのファイルには、読み込み済みの設定を使用する */
  static forFile(file: string): Config {
    const absolute = resolvePath(file);
    const key = dirname(absolute);
    let config = cache.get(key);
    if (config === undefined) {
      config = Config.discover(absolute, home());
      cache.set(key, config);
    }
    return config;
  }

  /** file のディレクトリから上位に向かって jai-smell.toml を探索する。file は絶対パス */
  static discover(file: string, home: string | undefined): Config {
    const homePath = home === undefined ? undefined : join(home, HOME_FILE);
    const layers: Layer[] = [];
    for (let dir = dirname(file); dir !== home; dir = dirname(dir)) {
      const candidate = join(dir, PROJECT_FILE);
      // ユーザー全体の設定のディレクトリ内のファイルをチェックする場合に、同じ設定ファイルを重複して読み込まない
      if (candidate !== homePath && isFile(candidate)) {
        layers.unshift({ path: candidate, file: read(candidate), base: dir });
      }
      if (existsSync(join(dir, ".git")) || dir === dirname(dir)) {
        break;
      }
    }
    if (homePath !== undefined && isFile(homePath)) {
      layers.unshift({ path: homePath, file: read(homePath), base: "/" });
    }
    return Config.build(layers, home);
  }

  /** 組み込みのデフォルトに、引数の先頭の設定から順に統合する */
  static build(layers: Layer[], home: string | undefined): Config {
    const paths: string[] = [];
    const loadedRuleFiles = new Set<string>();
    const exclude: string[] = [];
    const ruleSets: RuleSet[] = [];
    const warnings: string[] = [];
    const expressions = new Merged("expressions", "rules", true);
    Object.assign(expressions.items, EXPRESSION_RULES);
    // textlint のルールは、文体の好みに依存する部分が大きく、文章ではないファイルも検出するため、設定で有効にした場合にのみ適用する
    const textlint = new Merged("textlint", "rules", false);
    textlint.include = new Globs("include", resolveGlobs(TEXTLINT_INCLUDE, "/", home));
    Object.assign(textlint.items, TEXTLINT_RULES);
    // 返答のチェックは、検出のたびに返答の再出力を伴うため、設定で有効にした場合にのみ適用する
    const replies: Replies = { japanese: false };

    for (const { path, file, base } of layers) {
      const context = (error: unknown) =>
        new Error(`設定ファイル ${path}: ${(error as Error).message}`);
      // 設定ファイルに記述したルールセットと、rule_files のファイルのルールセットを、読み込む順に並べる
      const sources: { path: string; sets: unknown[] }[] = [];
      try {
        if (file.preset !== undefined) {
          throw new Error(PRESET_RENAMED);
        }
        rejectUnknownKeys(file, [
          "exclude",
          "rule_files",
          "rule_sets",
          "expressions",
          "textlint",
          "replies",
        ]);
        exclude.push(...resolveGlobs(stringArray("exclude", file.exclude ?? []), base, home));
        // 不正な glob は、記述した設定ファイルのエラーとして報告する
        new Globs("exclude", exclude);
        for (const ruleFile of stringArray("rule_files", file.rule_files ?? [])) {
          try {
            const rulePath = resolveFile(ruleFile, dirname(path), home);
            const content = read(rulePath);
            try {
              rejectUnknownKeys(content, ["rule_sets"]);
            } catch (error) {
              throw new Error(
                `設定ファイル ${rulePath} の形式が不正です: ${(error as Error).message}`,
              );
            }
            // 複数の層が同じファイルを指定した場合は、最初の 1 回のみ読み込む
            const real = realPath(rulePath);
            if (!loadedRuleFiles.has(real)) {
              loadedRuleFiles.add(real);
              sources.push({ path: rulePath, sets: ruleSetArray(content.rule_sets) });
            }
          } catch (error) {
            throw new Error(`rule_files: ${(error as Error).message}`);
          }
        }
        sources.push({ path, sets: ruleSetArray(file.rule_sets) });
        expressions.merge(file.expressions, base, home);
        textlint.merge(file.textlint, base, home);
        mergeReplies(replies, file.replies);
      } catch (error) {
        throw context(error);
      }
      for (const { path: sourcePath, sets } of sources) {
        sets.forEach((raw, i) => {
          const name = isTable(raw) && typeof raw.name === "string" ? raw.name : "";
          try {
            if (!isTable(raw)) {
              throw new Error("テーブルを指定してください");
            }
            // id は表現のルールが使用する。jai-smell expressions の出力を rule_files で読み込めるように、記述を許可する
            rejectUnknownKeys(raw, ["id", "name", "include", "exclude", "entries"]);
            if (typeof raw.name !== "string") {
              throw new Error("name には文字列を指定してください");
            }
            ruleSets.push(
              new RuleSet(
                raw.name,
                parseEntries(raw.entries),
                new Filter(
                  includeGlobs(raw.include, base, home),
                  new Globs(
                    "exclude",
                    resolveGlobs(stringArray("exclude", raw.exclude ?? []), base, home),
                  ),
                ),
              ),
            );
          } catch (error) {
            throw new Error(
              `設定ファイル ${sourcePath}: rule_sets[${i}]（${name}）: ${(error as Error).message}`,
            );
          }
        });
        paths.push(sourcePath);
      }
    }

    const names = expressionRules().map(({ id }) => id);
    for (const [name, value] of Object.entries(expressions.items)) {
      if (typeof value !== "boolean") {
        throw new Error(`expressions.rules の ${name} には、true または false を指定してください`);
      }
      // 表現のルールの名前は、バージョンによって異なる場合があるため、エラーにせずチェックを継続する
      if (!names.includes(name)) {
        warnings.push(
          `expressions.rules の ${name} は、表現のルールの名前ではありません（表現のルール: ${names.join("、")}）`,
        );
      }
    }
    return new Config(
      paths,
      new Globs("exclude", exclude),
      ruleSets,
      expressions.toBuiltIn(),
      textlint.toBuiltIn(),
      replies,
      warnings,
    );
  }
}

/** 同じディレクトリのファイルに使用する設定 */
const cache = new Map<string, Config>();

/** 組み込みのルールの設定を、層ごとに統合する。キーごと、および名前ごとに、後の層の値を使用する */
class Merged {
  include: Globs | undefined;
  exclude: Globs = new Globs("exclude", []);
  readonly items: Record<string, unknown> = {};

  constructor(
    private readonly section: string,
    /** ルールセットまたはルールの名前ごとの設定を記述するキー */
    private readonly itemsKey: string,
    /** 設定に記述していない場合に、適用するかどうか */
    public enabled: boolean,
  ) {}

  merge(table: unknown, base: string, home: string | undefined): void {
    if (table === undefined) {
      return;
    }
    try {
      if (!isTable(table)) {
        throw new Error("テーブルを指定してください");
      }
      rejectUnknownKeys(table, ["enabled", "include", "exclude", this.itemsKey]);
      if (table.enabled !== undefined) {
        if (typeof table.enabled !== "boolean") {
          throw new Error("enabled には、true または false を指定してください");
        }
        this.enabled = table.enabled;
      }
      if (table.include !== undefined) {
        this.include = includeGlobs(table.include, base, home);
      }
      if (table.exclude !== undefined) {
        this.exclude = new Globs(
          "exclude",
          resolveGlobs(stringArray("exclude", table.exclude), base, home),
        );
      }
      const items = table[this.itemsKey] ?? {};
      if (!isTable(items)) {
        throw new Error(`${this.itemsKey} にはテーブルを指定してください`);
      }
      Object.assign(this.items, items);
    } catch (error) {
      throw new Error(`${this.section}: ${(error as Error).message}`);
    }
  }

  toBuiltIn(): BuiltIn {
    return new BuiltIn(this.enabled, new Filter(this.include, this.exclude), this.items);
  }
}

function mergeReplies(replies: Replies, table: unknown): void {
  if (table === undefined) {
    return;
  }
  try {
    if (!isTable(table)) {
      throw new Error("テーブルを指定してください");
    }
    rejectUnknownKeys(table, [...REPLIES_KEYS]);
    for (const key of REPLIES_KEYS) {
      const value = table[key];
      if (value === undefined) {
        continue;
      }
      if (typeof value !== "boolean") {
        throw new Error(`${key} には、true または false を指定してください`);
      }
      replies[key] = value;
    }
  } catch (error) {
    throw new Error(`replies: ${(error as Error).message}`);
  }
}

function includeGlobs(value: unknown, base: string, home: string | undefined): Globs | undefined {
  if (value === undefined) {
    return undefined;
  }
  const patterns = stringArray("include", value);
  if (patterns.length === 0) {
    throw new Error(
      "include に空の配列は指定できません。すべてのファイルを対象とする場合は、include を省略してください",
    );
  }
  return new Globs("include", resolveGlobs(patterns, base, home));
}

function ruleSetArray(value: unknown): unknown[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("rule_sets には配列を指定してください");
  }
  return value;
}

function stringArray(field: string, value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`${field} には文字列の配列を指定してください`);
  }
  return value;
}

function home(): string | undefined {
  return process.env.HOME || undefined;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolvePath(path);
  }
}

function read(path: string): ConfigFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`設定ファイル ${path} を読み込めません: ${(error as Error).message}`);
  }
  try {
    return Bun.TOML.parse(text) as ConfigFile;
  } catch (error) {
    throw new Error(`設定ファイル ${path} の形式が不正です: ${(error as Error).message}`);
  }
}

/**
 * rule_files に記述されたパスを解決する。絶対パスはそのまま使用し、~/ から始まるパスはホームディレクトリ、
 * それ以外は設定ファイルのディレクトリを基準とする
 */
function resolveFile(path: string, dir: string, home: string | undefined): string {
  if (path.startsWith("~/")) {
    if (home === undefined) {
      throw new Error(HOME_REQUIRED);
    }
    return join(home, path.slice(2));
  }
  return isAbsolute(path) ? path : join(dir, path);
}

/**
 * 設定ファイルに記述された glob を、絶対パスのパターンに変換する。
 * 絶対パスはそのまま使用し、~/ から始まるパスはホームディレクトリ、それ以外は base を基準とする。
 * 基準のディレクトリ名に glob の記号が含まれていても、リテラルとして扱う
 */
function resolveGlobs(patterns: string[], base: string, home: string | undefined): string[] {
  return patterns.map((pattern) => {
    if (pattern.startsWith("/")) {
      return pattern;
    }
    let dir = base;
    let rest = pattern;
    if (pattern.startsWith("~/")) {
      if (home === undefined) {
        throw new Error(HOME_REQUIRED);
      }
      dir = home;
      rest = pattern.slice(2);
    }
    return `${escapeGlob(dir).replace(/\/+$/, "")}/${rest}`;
  });
}
