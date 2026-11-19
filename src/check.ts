// ファイルと、フックの入力のチェック。
import { readFileSync, realpathSync } from "node:fs";
import { extname, resolve } from "node:path";
import { Config } from "./config.ts";
import type { Target } from "./hook.ts";
import { textRanges } from "./markdown.ts";
import { find, tokenize } from "./matcher.ts";
import { covers, parse as parseSuppressions } from "./suppress.ts";

export const FILE_HEADING =
  "修正を検討すべき表現の候補を検出しました。チェック対象は今回の編集で追加・変更された部分のみです（行番号はその部分の中での位置を示します）。各箇所を確認し、該当する場合のみ修正してください。";

/** 検出結果 */
type Hit = {
  /** テキスト内の位置（UTF-16 のコード単位） */
  offset: number;
  message: string;
  /** textlint のルールの検出結果の場合は、ルールの名前 */
  ruleName?: string;
};

export type Finding = { line: number; column: number; message: string };

export const formatFinding = (path: string, finding: Finding): string =>
  `${path}:${finding.line}:${finding.column}: ${finding.message}`;

/** configPath を指定した場合は、探索を行わず、そのファイルのみを組み込みのデフォルトと統合する */
export function configFor(configPath: string | undefined, file: string): Config {
  const config = configPath === undefined ? Config.forFile(file) : Config.load(configPath);
  for (const warning of config.warnings) {
    if (!warned.has(warning)) {
      warned.add(warning);
      console.error(`jai-smell: ${warning}`);
    }
  }
  return config;
}

/** 出力済みの警告。複数のファイルをチェックする場合に、同じ警告を重複して出力しない */
const warned = new Set<string>();

/** ファイル全体をチェックする。チェックの対象外のファイルの場合は、空の配列を返す */
export async function checkFile(configPath: string | undefined, file: string): Promise<Finding[]> {
  const config = configFor(configPath, file);
  if (skipped(file, config)) {
    return [];
  }
  const text = readFileSync(file, "utf8");
  const suppressions = parseSuppressions(text);
  const hits = (await findHits(config, file, text)).filter(
    (hit) => !covers(suppressions, text, hit.offset, hit.ruleName),
  );
  return toFindings(text, hits);
}

/**
 * フックの入力の、追加・変更された部分をチェックする。
 * 複数の編集がある場合は空行で連結してチェックするため、行番号は連結後のテキスト内での位置になる
 */
export async function checkWritten(
  configPath: string | undefined,
  { filePath, parts }: Target,
): Promise<Finding[]> {
  const config = configFor(configPath, filePath);
  if (skipped(filePath, config)) {
    return [];
  }
  const text = parts.join("\n\n");
  const hits = await findHits(config, filePath, text);
  // 除外のコメントは、編集後のファイル全体から読み込む。ファイルを読み込めない場合は、編集された部分から読み込む
  let fileText = text;
  try {
    fileText = readFileSync(filePath, "utf8");
  } catch {
    // 編集された部分から読み込む
  }
  const suppressions = parseSuppressions(fileText);
  return toFindings(
    text,
    hits.filter((hit) => {
      const offset = offsetInFile(parts, fileText, hit.offset);
      return offset === undefined || !covers(suppressions, fileText, offset, hit.ruleName);
    }),
  );
}

/** 連結したテキスト内の位置を、編集後のファイル内の位置に変換する。編集された部分がファイル内に見つからない場合は undefined を返す */
export function offsetInFile(
  parts: readonly string[],
  fileText: string,
  offset: number,
): number | undefined {
  let start = 0;
  for (const part of parts) {
    if (offset < start + part.length) {
      const found = fileText.indexOf(part);
      return found === -1 ? undefined : found + offset - start;
    }
    start += part.length + "\n\n".length;
  }
  return undefined;
}

/** 読み込んだ設定ファイル自体（検出対象の表現そのものを含む）はチェックの対象外とする */
function skipped(file: string, config: Config): boolean {
  return config.paths.some((path) => sameFile(file, path));
}

/** 検出結果を、出現位置の順に返す */
async function findHits(config: Config, file: string, text: string): Promise<Hit[]> {
  const markdown = extname(file).toLowerCase() === ".md";
  const hits: Hit[] = [];
  const entries = config.entriesFor(file);
  if (entries.length > 0) {
    const ranges = markdown ? textRanges(text) : [{ start: 0, end: text.length }];
    for (const range of ranges) {
      const tokens = await tokenize(text.slice(range.start, range.end));
      const seen = new Set<string>();
      for (const hit of find(entries, tokens)) {
        // 同じルールが複数の設定に記述されている場合に、同じ検出結果を重複して出力しない
        const key = `${hit.start}:${hit.entry.message}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({ offset: range.start + hit.start, message: hit.entry.message });
        }
      }
    }
  }
  if (config.appliesTextlintTo(file)) {
    // textlint とルールの読み込みには時間を要するため、適用する場合にのみ読み込む
    const textlint = await import("./textlint.ts");
    const rules = textlint.resolveRules(config.textlint.items);
    for (const hit of await textlint.lint(text, markdown, rules)) {
      hits.push({
        offset: hit.offset,
        message: `${hit.message}（textlint: ${hit.ruleName}）`,
        ruleName: hit.ruleName,
      });
    }
  }
  // 安定ソートのため、同じ位置では、プリセット、利用者が追加したルールセット、textlint のルールの順を維持する
  return hits.sort((a, b) => a.offset - b.offset);
}

function toFindings(text: string, hits: readonly Hit[]): Finding[] {
  return hits.map((hit) => ({ ...position(text, hit.offset), message: hit.message }));
}

/** テキスト内の位置を、1 始まりの行番号と文字単位の列番号に変換する */
export function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return {
    line: before.split("\n").length,
    column: [...before.slice(lineStart)].length + 1,
  };
}

function sameFile(a: string, b: string): boolean {
  const real = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  return real(a) === real(b);
}
