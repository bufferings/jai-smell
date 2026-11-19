// Markdown から、チェックの対象とする文の範囲を抽出する。
import type { TxtNode, TxtParentNode } from "@textlint/ast-node-types";
import { parse } from "@textlint/markdown-to-ast";

export type Range = { start: number; end: number };

/**
 * 本文の範囲を返す。コードブロック、インラインコード、HTML、リンクの URL は含めない。
 * 連続するテキストと改行は 1 つの範囲にまとめ、強調やリンクの境界で分割する。
 */
export function textRanges(source: string): Range[] {
  const ranges: Range[] = [];
  const visit = (node: TxtNode): void => {
    // <https://...> の自動リンクは表示テキストが URL と同一のため、チェックの対象外とする
    if (node.type === "Link" && source[node.range[0]] === "<") {
      return;
    }
    const children = (node as TxtParentNode).children;
    if (!Array.isArray(children)) {
      return;
    }
    // 直前の子がテキストまたは改行であり、次のテキストを同じ範囲に連結できる状態
    let joinable = false;
    for (const child of children) {
      if (child.type === "Str") {
        const last = ranges[ranges.length - 1];
        if (joinable && last) {
          last.end = child.range[1];
        } else {
          ranges.push({ start: child.range[0], end: child.range[1] });
        }
        joinable = true;
        continue;
      }
      if (child.type === "Break" && joinable) {
        continue;
      }
      joinable = false;
      visit(child);
    }
  };
  visit(parse(source));
  return ranges;
}
