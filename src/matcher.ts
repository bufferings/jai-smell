// 形態素解析と、形態素の並びと entries の比較。
import "./kuromojin-dict.ts";
import { tokenize as kuromojinTokenize } from "kuromojin";
import { type Entry, TOKEN_FIELDS, type TokenField, type TokenPattern } from "./dictionary.ts";

/** 1 つの形態素。フィールド名は entries の条件と同一 */
export type Token = Record<TokenField, string> & {
  /** 形態素解析の対象のテキスト内での位置（UTF-16 のコード単位） */
  start: number;
};

/**
 * テキストを形態素に分割する。空白と改行のみの形態素は含めない。
 * 空白をはさんだ形態素の並び（「A の 版」）を、連続する並びとして比較するためである
 */
export async function tokenize(text: string): Promise<Token[]> {
  const offsets = codePointOffsets(text);
  const tokens: Token[] = [];
  for (const token of await kuromojinTokenize(text)) {
    if (token.surface_form.trim() === "") {
      continue;
    }
    // word_position は、1 始まりのコードポイント単位の位置
    const index = token.word_position - 1;
    const start = offsets ? (offsets[index] ?? text.length) : index;
    const fields = {} as Record<TokenField, string>;
    for (const field of TOKEN_FIELDS) {
      fields[field] = String(token[field] ?? "*");
    }
    tokens.push({ ...fields, start });
  }
  return tokens;
}

/** サロゲートペアを含むテキストの場合に、コードポイントの位置から UTF-16 の位置への対応を返す */
function codePointOffsets(text: string): number[] | undefined {
  if (!/[\uD800-\uDBFF]/.test(text)) {
    return undefined;
  }
  const offsets: number[] = [];
  let offset = 0;
  for (const char of text) {
    offsets.push(offset);
    offset += char.length;
  }
  return offsets;
}

export type Hit = {
  /** 並びの先頭の形態素の位置 */
  start: number;
  entry: Entry;
};

/** 各 entry の tokens に一致する、連続する形態素の並びを探索する。結果は出現位置の順に返す */
export function find(entries: readonly Entry[], tokens: readonly Token[]): Hit[] {
  const hits: Hit[] = [];
  for (const entry of entries) {
    const length = entry.tokens.length;
    let i = 0;
    while (i + length <= tokens.length) {
      const matched = entry.tokens.every((pattern, k) => matches(pattern, tokens[i + k] as Token));
      if (matched) {
        hits.push({ start: (tokens[i] as Token).start, entry });
        i += length;
      } else {
        i += 1;
      }
    }
  }
  // Array.prototype.sort は安定ソートのため、同じ位置では entries の定義順を維持する
  return hits.sort((a, b) => a.start - b.start);
}

function matches(pattern: TokenPattern, token: Token): boolean {
  return TOKEN_FIELDS.every((field) => {
    const condition = pattern[field];
    if (condition === undefined) {
      return true;
    }
    return Array.isArray(condition) ? condition.includes(token[field]) : condition === token[field];
  });
}
