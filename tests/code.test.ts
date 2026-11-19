import { expect, test } from "bun:test";
import { extract, fileKind } from "../src/code.ts";

test("ファイル名から、ファイルの種類を判定する", () => {
  for (const file of [
    "a.ts",
    "a.tsx",
    "a.py",
    "a.rs",
    "a.go",
    "a.sh",
    "a.sql",
    "Makefile",
    "Dockerfile",
  ]) {
    expect(fileKind(file).kind).toBe("code");
  }
  for (const file of ["a.txt", "a.yml", "a.yaml", "a.toml", "a.json", "a.html", "a.tex"]) {
    expect(fileKind(file).kind).toBe("text");
  }
  for (const file of ["a.unknown", "LICENSE", ".gitignore"]) {
    expect(fileKind(file).kind).toBe("unknown");
  }
});

/** 抽出したコメントの段落と、文字列リテラルを返す */
function extracted(text: string, language: string) {
  const result = extract(text, language);
  if (result === undefined) {
    throw new Error("抽出できません");
  }
  return {
    comments: result.comments.map((comment) => comment.text),
    strings: result.strings.map(({ start, end }) => text.slice(start, end)),
  };
}

test("連結した文章の各文字を、元のテキスト内の位置に対応付ける", () => {
  const text = "// 設定を\n// 読み込む\nconst x = 1; /* 値 */\n";
  const [first, second] = extract(text, "ts")?.comments ?? [];
  expect(first?.text).toBe("設定を読み込む");
  expect(first?.offsets.map((offset) => text[offset]).join("")).toBe("設定を読み込む");
  expect(second?.text).toBe("値");
  expect(second?.offsets).toEqual([text.indexOf("値")]);
});

test("連続する行コメントとブロックコメントは、1 つの段落にまとめる", () => {
  const text = [
    "// 設定を読み込む。存在しない場合は",
    "// デフォルトを使用する",
    "const x = 1; // 行末のコメント",
    "// 次のコメント",
    "",
    "/**",
    " * ブロックコメントの",
    " * 説明",
    " */",
    "",
  ].join("\n");
  expect(extracted(text, "ts").comments).toEqual([
    "設定を読み込む。存在しない場合はデフォルトを使用する",
    "行末のコメント",
    "次のコメント",
    "ブロックコメントの説明",
  ]);
});

test("文字列リテラルの中のコメントの記号は、コメントとして扱わない", () => {
  expect(extracted('const url = "http://example.com/a//b"; // 末尾\n', "ts")).toMatchObject({
    comments: ["末尾"],
    strings: ['"http://example.com/a//b"'],
  });
  expect(extracted("url = 'http://example.com/#a'  # 末尾\n", "py")).toMatchObject({
    comments: ["末尾"],
    strings: ["'http://example.com/#a'"],
  });
  expect(extracted('echo "# 文字列" # 末尾\n', "sh")).toMatchObject({
    comments: ["末尾"],
    strings: ['"# 文字列"'],
  });
  expect(extracted("SELECT '-- 文字列' /* ブロック */ FROM t; -- 末尾\n", "sql")).toMatchObject({
    comments: ["ブロック", "末尾"],
    strings: ["'-- 文字列'"],
  });
});

test("英数字で終わる行と英数字で始まる行のあいだには、空白を挿入する", () => {
  expect(extracted("// run the job when\n// cache misses\n", "ts").comments).toEqual([
    "run the job when cache misses",
  ]);
});

test("箇条書きの項目と、字下げが異なる行は、連結せずに改行で区切る", () => {
  const text = [
    "// 次の順に統合する。",
    "//   1. 組み込みのデフォルト",
    "//      （設定で変更できる）",
    "//   2. ユーザー全体の設定",
    "// - 次の行",
    "// - 範囲",
    "/**",
    " * 説明の",
    " * 続き",
    " * - 項目",
    " */",
    "",
  ].join("\n");
  expect(extracted(text, "ts").comments).toEqual([
    "次の順に統合する。\n1. 組み込みのデフォルト\n（設定で変更できる）\n2. ユーザー全体の設定\n次の行\n範囲",
    "説明の続き\n項目",
  ]);
});

test("各言語のコメントを抽出する", () => {
  expect(extracted("//! モジュールの説明\n/// 関数の説明\nfn main() {}\n", "rs").comments).toEqual([
    "モジュールの説明関数の説明",
  ]);
  expect(extracted("# 設定を読み込む\nx = 1\n", "py").comments).toEqual(["設定を読み込む"]);
  expect(extracted("#!/bin/sh\n# バイナリを確認する\n", "sh").comments).toEqual([
    "バイナリを確認する",
  ]);
  expect(extracted("# ビルドする\nall:\n\techo\n", "makefile").comments).toEqual(["ビルドする"]);
});
