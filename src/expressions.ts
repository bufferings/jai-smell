// jai-smell が提供する、表現のルール。config/expression-rules.toml の内容をバイナリに含める。
import expressionsText from "../config/expression-rules.toml" with { type: "text" };
import { type Entry, parseEntries } from "./dictionary.ts";

/** 表現のルールの内容（TOML）。`jai-smell expressions` で出力する */
export const EXPRESSIONS_TEXT = expressionsText as unknown as string;

/** id は、設定ファイルの expressions.rules で指定する名前。name は、説明に使用する日本語の名前 */
export type ExpressionRule = { id: string; name: string; entries: Entry[] };

let cache: ExpressionRule[] | undefined;

/** 表現のルール。定義順に返す */
export function expressionRules(): ExpressionRule[] {
  cache ??= (
    Bun.TOML.parse(EXPRESSIONS_TEXT) as {
      rule_sets: { id: string; name: string; entries: unknown }[];
    }
  ).rule_sets.map(({ id, name, entries }) => ({ id, name, entries: parseEntries(entries) }));
  return cache;
}
