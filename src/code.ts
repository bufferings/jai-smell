// ソースコードから、チェックの対象とする部分（コメントと文字列リテラル）を抽出する。
//
// 構文ハイライトのライブラリ（highlight.js）でソースコードをトークンに分割し、コメントと文字列リテラルの位置を取得する。
// 文字列リテラルの中のコメントの記号（"http://example.com" の //）をコメントとして扱わないようにするためである。
import { basename, extname } from "node:path";
import hljs from "highlight.js";
import type { Range } from "./markdown.ts";

/**
 * 文章またはデータを記述する言語。コメントと文字列リテラルを抽出せず、ファイル全体をチェックする。
 * 引用符で囲まれていない値（YAML の値など）は、文字列リテラルとして抽出されないためである
 */
const WHOLE_TEXT_LANGUAGES = new Set([
  "plaintext",
  "markdown",
  "asciidoc",
  "latex",
  "xml",
  "json",
  "yaml",
  "ini",
  "properties",
]);

/** 拡張子がない、ファイル名で言語を判定するファイル */
const FILE_NAMES: Record<string, string> = {
  Makefile: "makefile",
  Dockerfile: "dockerfile",
};

export type FileKind =
  /** コメントと文字列リテラルを抽出する言語 */
  | { kind: "code"; language: string }
  /** ファイル全体をチェックする、文章またはデータを記述する言語 */
  | { kind: "text" }
  /** 言語を判定できないファイル */
  | { kind: "unknown" };

/** ファイル名から、ファイルの種類を判定する */
export function fileKind(file: string): FileKind {
  const name = FILE_NAMES[basename(file)] ?? extname(file).slice(1).toLowerCase();
  const language = name === "" ? undefined : hljs.getLanguage(name)?.name;
  if (language === undefined) {
    return { kind: "unknown" };
  }
  // getLanguage は別名（ts など）も受け付けるため、言語の定義の名前ではなく、判定に使用した名前でトークンに分割する
  return WHOLE_TEXT_LANGUAGES.has(canonical(name))
    ? { kind: "text" }
    : { kind: "code", language: name };
}

/** 別名を、highlight.js に登録されている言語の名前に変換する */
function canonical(name: string): string {
  return (
    hljs
      .listLanguages()
      .find((language) => hljs.getLanguage(language) === hljs.getLanguage(name)) ?? name
  );
}

/** 元のテキストから抽出して連結した文章。offsets は、text の各文字の、元のテキスト内での位置 */
export type Passage = { text: string; offsets: number[] };

export type Extracted = {
  /**
   * コメントの段落。連続する行のコメントは、コメントの記号と改行を除いて連結し、1 つの段落にする。
   * 複数の行に折り返して記述された文を、1 つの文としてチェックするためである
   */
  comments: Passage[];
  /** 文字列リテラルの範囲 */
  strings: Range[];
};

type Node = string | { scope?: string; children?: Node[] };

/** トークンに分割できない場合は undefined を返す */
export function extract(text: string, language: string): Extracted | undefined {
  let root: Node;
  try {
    // _emitter は公開されている仕様ではないため、highlight.js のバージョンを固定し、テストで動作を確認している
    const result = hljs.highlight(text, { language, ignoreIllegals: true }) as unknown as {
      _emitter: { rootNode: Node };
    };
    root = result._emitter.rootNode;
  } catch {
    return undefined;
  }
  const comments: Range[] = [];
  const strings: Range[] = [];
  let offset = 0;
  const walk = (node: Node, inside: boolean): void => {
    if (typeof node === "string") {
      offset += node.length;
      return;
    }
    const scope = node.scope ?? "";
    const target = !inside && (scope === "comment" || scope === "string");
    const start = offset;
    for (const child of node.children ?? []) {
      walk(child, inside || target);
    }
    if (target) {
      (scope === "comment" ? comments : strings).push({ start, end: offset });
    }
  };
  walk(root, false);
  if (offset !== text.length) {
    return undefined;
  }

  // コメントの本文の、行ごとの範囲。行の先頭と末尾のコメントの記号は、文章の一部ではないため含めない
  const pieces: Line[] = [];
  for (const { start, end } of comments) {
    let lineStart = start;
    while (lineStart < end) {
      const newline = text.indexOf("\n", lineStart);
      const lineEnd = newline === -1 || newline > end ? end : newline;
      const line = text.slice(lineStart, lineEnd);
      const leading = line.match(LEADING_MARKERS)?.[0].length ?? 0;
      const trailing = line.slice(leading).match(TRAILING_MARKERS)?.[0].length ?? 0;
      if (lineStart + leading < lineEnd - trailing) {
        // コメントの記号を除いた後に、箇条書きの記号（-、1. など）で始まる行
        const marker = lineStart === start ? OPENING_MARKER : CONTINUATION_MARKER;
        const prefix = line.slice(0, leading).replace(marker, "");
        const listItem = BULLET.test(prefix) || NUMBERED.test(line.slice(leading));
        pieces.push({ start: lineStart + leading, end: lineEnd - trailing, listItem });
      }
      lineStart = lineEnd + 1;
    }
  }
  return { comments: paragraphs(pieces, text).map((lines) => join(lines, text)), strings };
}

/**
 * コメントの本文の行を、段落ごとにまとめる。コメントのみの行が連続する場合は、1 つの段落にする。
 * コードと同じ行に記述されたコメント（行末のコメントなど）は、前後の行のコメントとは別の文章のため、単独の段落とする
 */
function paragraphs(pieces: readonly Line[], text: string): Line[][] {
  const result: Line[][] = [];
  /** 直前の、コメントのみの行の段落と、その行の末尾の位置 */
  let current: { lines: Line[]; lineEnd: number } | undefined;
  for (const piece of pieces) {
    const lineStart = text.lastIndexOf("\n", piece.start - 1) + 1;
    const newline = text.indexOf("\n", piece.end);
    const lineEnd = newline === -1 ? text.length : newline;
    const standalone =
      MARKERS_ONLY.test(text.slice(lineStart, piece.start)) &&
      MARKERS_ONLY.test(text.slice(piece.end, lineEnd));
    if (standalone && current && current.lineEnd + 1 === lineStart) {
      current.lines.push(piece);
      current.lineEnd = lineEnd;
      continue;
    }
    const lines = [piece];
    result.push(lines);
    current = standalone ? { lines, lineEnd } : undefined;
  }
  return result;
}

/**
 * 段落の各行を連結する。
 * 直前の行と同じ桁から始まり、どちらも箇条書きの項目ではない行は、折り返された文の続きとして、改行を除いて連結する。
 * 英数字で終わる行と英数字で始まる行のあいだには、単語が連結されないように空白を挿入する。
 * その他の行（箇条書きの項目、字下げが異なる行）は、別の文として、改行で区切る
 */
function join(lines: readonly Line[], text: string): Passage {
  const column = (line: Line) => line.start - (text.lastIndexOf("\n", line.start - 1) + 1);
  let joined = "";
  const offsets: number[] = [];
  lines.forEach((line, i) => {
    const previous = lines[i - 1];
    if (previous) {
      const wrapped = !previous.listItem && !line.listItem && column(previous) === column(line);
      const separator = !wrapped
        ? "\n"
        : ASCII_WORD.test(joined.slice(-1)) && ASCII_WORD.test(text[line.start] ?? "")
          ? " "
          : "";
      if (separator !== "") {
        joined += separator;
        offsets.push(line.start);
      }
    }
    joined += text.slice(line.start, line.end);
    for (let offset = line.start; offset < line.end; offset++) {
      offsets.push(offset);
    }
  });
  return { text: joined, offsets };
}

/** コメントの本文の 1 行 */
type Line = Range & { listItem: boolean };

const ASCII_WORD = /^[0-9A-Za-z]$/;
const LEADING_MARKERS = /^[\s/*#\-!;%<>|=~+"']*/;
const TRAILING_MARKERS = /[\s*/>-]*$/;
/** 空白とコメントの記号のみで構成される文字列 */
const MARKERS_ONLY = /^[\s/*#\-!;%<>|=~+"']*$/;
/** コメントの最初の行の、コメントの開始の記号 */
const OPENING_MARKER = /^\s*(?:\/\/+[!/]?|\/\*+!?|#+!?|--+|;+|%+|<!--+)/;
/** ブロックコメントの 2 行目以降の、行の先頭の装飾 */
const CONTINUATION_MARKER = /^\s*\*+(?!\/)/;
const BULLET = /^\s*[-+*]\s+$/;
const NUMBERED = /^\d+[.)]\s/;
