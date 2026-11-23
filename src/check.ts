// ファイルと、フックの入力のチェック。
import { readFileSync, realpathSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { extract, fileKind } from "./code.ts";
import { Config } from "./config.ts";
import type { Target } from "./hook.ts";
import { textRanges } from "./markdown.ts";
import { find, tokenize } from "./matcher.ts";
import { covers, parse as parseSuppressions } from "./suppress.ts";

/** 設定を読み込めない場合のエラー。利用者が設定ファイルを修正するまで、チェックを実行できない */
export class ConfigError extends Error {}

export const REPLY_NOT_JAPANESE =
  "返答の大部分が日本語ではありません。同じ内容を、日本語で再出力してください。英語の文章の作成を依頼された場合など、英語が正しい箇所は、変更せずに出力してください。";

/** 返答に適用する設定を探索するための、ファイルの名前 */
const REPLY_FILE = "reply.md";

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

/** configPath を指定した場合は、設定ファイルを探索せず、そのファイルのみを組み込みのデフォルトと統合する */
export function configFor(configPath: string | undefined, file: string): Config {
  let config: Config;
  try {
    config = configPath === undefined ? Config.forFile(file) : Config.load(configPath);
  } catch (error) {
    throw new ConfigError((error as Error).message);
  }
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

/** Claude の返答に適用する設定を返す。設定は、作業ディレクトリから探索する */
export function configForReply(configPath: string | undefined, cwd: string): Config {
  return configFor(configPath, join(cwd, REPLY_FILE));
}

/** Claude の返答が、再出力の対象かどうかを返す */
export function replyLacksJapanese(config: Config, text: string): boolean {
  return config.replies.japanese && lacksJapanese(text);
}

/** 日本語の行と判定する、日本語の文字の割合の下限。英語の文に日本語の単語が含まれる行を、英語の行として扱うための値である */
const JAPANESE_LINE_RATIO = 0.1;
/** 日本語の文字は、英字より少ない文字数で同じ量の内容を表すため、行の分量の比較では 2 文字として数える */
const JAPANESE_WEIGHT = 2;

/**
 * 本文の大部分が英語の場合に true を返す。
 * 本文を行に分割し、日本語の文字（ひらがな、カタカナ、漢字）の割合が低い行を、英語の行とする。
 * 英語の行の分量が、その他の行の分量を超える場合に、大部分が英語と判定する。
 * 文字の割合を本文の全体で計算すると、英字の用語を多く含む日本語の文章を、英語と判定するためである。
 * コードブロックとインラインコードは本文に含めないため、コードのみの返答は対象外となる
 */
export function lacksJapanese(text: string): boolean {
  // 行の構成を維持するため、本文ではない部分は、改行だけを残す
  const ranges = textRanges(text);
  let prose = "";
  let position = 0;
  for (const { start, end } of ranges) {
    prose += text.slice(position, start).replace(/[^\n]/g, "") + text.slice(start, end);
    position = end;
  }
  prose += text.slice(position).replace(/[^\n]/g, "");
  let english = 0;
  let others = 0;
  for (const line of prose.split("\n")) {
    const japanese =
      line.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu)?.length ?? 0;
    const latin = line.match(/[A-Za-z]/g)?.length ?? 0;
    const isEnglish =
      /[A-Za-z]{2,}/.test(line) && japanese / (japanese + latin) < JAPANESE_LINE_RATIO;
    if (isEnglish) {
      english += latin;
    } else {
      others += japanese * JAPANESE_WEIGHT + latin;
    }
  }
  return english > others;
}

/**
 * フックの入力の、追加・変更された部分をチェックする。
 * 複数の編集がある場合は空行で連結してチェックするため、行番号は連結後のテキスト内での位置になる
 */
export async function checkWritten(
  config: Config,
  { filePath, parts }: Target,
): Promise<Finding[]> {
  if (skipped(filePath, config)) {
    return [];
  }
  const text = parts.join("\n\n");
  // 除外のコメントは、編集後のファイル全体から読み込む。ファイルを読み込めない場合は、編集された部分から読み込む
  let fileText: string | undefined;
  try {
    fileText = readFileSync(filePath, "utf8");
  } catch {
    // 編集された部分から読み込む
  }
  const hits =
    (fileText === undefined
      ? undefined
      : await findHitsInFile(config, filePath, parts, fileText)) ??
    (await findHits(config, filePath, text));
  fileText ??= text;
  const suppressions = parseSuppressions(fileText);
  return toFindings(
    text,
    hits.filter((hit) => {
      const offset = offsetInFile(parts, fileText, hit.offset);
      return offset === undefined || !covers(suppressions, fileText, offset, hit.ruleName);
    }),
  );
}

/**
 * ソースコードの場合に、編集後のファイル全体をチェックし、編集された部分の検出結果のみを、連結したテキスト内の位置で返す。
 * 編集された部分のみでは、ブロックコメントの途中の行などを、コメントとして判定できないためである。
 * ソースコードではない場合と、編集された部分がファイル内に見つからない場合は、undefined を返す
 */
async function findHitsInFile(
  config: Config,
  filePath: string,
  parts: readonly string[],
  fileText: string,
): Promise<Hit[] | undefined> {
  if (extname(filePath).toLowerCase() === ".md" || fileKind(filePath).kind !== "code") {
    return undefined;
  }
  const located: { inFile: number; inJoined: number; length: number }[] = [];
  let inJoined = 0;
  for (const part of parts) {
    const inFile = fileText.indexOf(part);
    if (inFile === -1) {
      return undefined;
    }
    located.push({ inFile, inJoined, length: part.length });
    inJoined += part.length + "\n\n".length;
  }
  const hits: Hit[] = [];
  for (const hit of await findHits(config, filePath, fileText)) {
    const part = located.find(
      ({ inFile, length }) => hit.offset >= inFile && hit.offset < inFile + length,
    );
    if (part) {
      hits.push({ ...hit, offset: hit.offset - part.inFile + part.inJoined });
    }
  }
  return hits.sort((a, b) => a.offset - b.offset);
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

/** チェックの対象とする文章。offsetOf は、text 内の位置を、ファイルのテキスト内の位置に変換する */
type Part = { text: string; offsetOf: (index: number) => number };

const slice = (source: string, { start, end }: { start: number; end: number }): Part => ({
  text: source.slice(start, end),
  offsetOf: (index) => start + index,
});

/** テキストから、形態素のルールでチェックする部分と、textlint のルールを適用する文章を決定する */
function prepare(
  file: string,
  text: string,
): { parts: Part[]; textlint?: Part & { markdown: boolean; comments: boolean } } {
  const whole = slice(text, { start: 0, end: text.length });
  if (extname(file).toLowerCase() === ".md") {
    return {
      parts: textRanges(text).map((range) => slice(text, range)),
      textlint: { ...whole, markdown: true, comments: false },
    };
  }
  const kind = fileKind(file);
  if (kind.kind === "text") {
    return { parts: [whole], textlint: { ...whole, markdown: false, comments: false } };
  }
  const extracted = kind.kind === "code" ? extract(text, kind.language) : undefined;
  if (extracted === undefined) {
    // 言語を判定できないファイルは、ファイル全体を表現のルールと追加のルールセットのみでチェックする
    return { parts: [whole] };
  }
  const comments: Part[] = extracted.comments.map(({ text, offsets }) => ({
    text,
    offsetOf: (index) => offsets[index] ?? offsets[offsets.length - 1] ?? 0,
  }));
  // textlint のルールには、コメントの段落を空行で区切って連結した文章を指定する
  const separator = "\n\n";
  const starts: number[] = [];
  let length = 0;
  for (const comment of comments) {
    starts.push(length);
    length += comment.text.length + separator.length;
  }
  return {
    parts: [...comments, ...extracted.strings.map((range) => slice(text, range))],
    // 文字列リテラルは文の断片が多いため、textlint のルールはコメントにのみ適用する
    textlint: {
      text: comments.map((comment) => comment.text).join(separator),
      offsetOf: (index) => {
        const i = Math.max(
          0,
          starts.findLastIndex((start) => start <= index),
        );
        return comments[i]?.offsetOf(index - (starts[i] ?? 0)) ?? 0;
      },
      markdown: false,
      comments: true,
    },
  };
}

/** 検出結果を、出現位置の順に返す */
async function findHits(config: Config, file: string, text: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  const entries = config.entriesFor(file);
  const applyTextlint = config.appliesTextlintTo(file);
  if (entries.length === 0 && !applyTextlint) {
    return hits;
  }
  const prepared = prepare(file, text);
  if (entries.length > 0) {
    for (const part of prepared.parts) {
      const seen = new Set<string>();
      for (const hit of find(entries, await tokenize(part.text))) {
        // 同じルールが複数の設定に記述されている場合に、同じ検出結果を重複して出力しない
        const key = `${hit.start}:${hit.entry.message}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({ offset: part.offsetOf(hit.start), message: hit.entry.message });
        }
      }
    }
  }
  if (applyTextlint && prepared.textlint && prepared.textlint.text !== "") {
    // textlint とルールの読み込みには時間を要するため、適用する場合にのみ読み込む
    const textlint = await import("./textlint.ts");
    const rules = textlint.resolveRules(config.textlint.items);
    for (const hit of await textlint.lint(
      prepared.textlint.text,
      prepared.textlint.markdown,
      rules,
    )) {
      hits.push({
        offset: prepared.textlint.offsetOf(hit.offset),
        message: `${hit.message}（textlint: ${hit.ruleName}）`,
        ruleName: hit.ruleName,
      });
    }
  }
  // 安定ソートのため、同じ位置では、表現のルール、利用者が追加したルールセット、textlint のルールの順を維持する
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
