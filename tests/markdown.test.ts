import { expect, test } from "bun:test";
import { textRanges } from "../src/markdown.ts";

const texts = (source: string) =>
  textRanges(source).map(({ start, end }) => source.slice(start, end));

test("コードは対象外とする", () => {
  const source = "本文`インライン`本文\n\n```rust\nブロック\n```\n\n    インデント\n";
  expect(texts(source)).toEqual(["本文", "本文"]);
});

test("HTML と URL は対象外とする", () => {
  const source =
    '<div>ブロック</div>\n\n前<span>インライン</span>後\n\n[リンク](https://example.com/道 "題") <https://example.com/道>\n';
  // インラインの HTML はタグのみを対象外とし、タグで囲まれた文は対象とする（textlint の Markdown の扱いと同じ）
  expect(texts(source)).toEqual(["前", "インライン", "後", "リンク", " "]);
});

test("段落内の行は 1 つの範囲にまとめる", () => {
  const source = "# 見出し\n\n一行目\n二行目  \n三行目\n\n- 項目\n";
  expect(texts(source)).toEqual(["見出し", "一行目\n二行目  \n三行目", "項目"]);
});

test("強調の境界で分割する", () => {
  expect(texts("前*強調*後")).toEqual(["前", "強調", "後"]);
});

test("front matter は対象外とする", () => {
  expect(texts("---\ntitle: 題\n---\n\n本文\n")).toEqual(["本文"]);
});
