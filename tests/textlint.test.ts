// textlint のルールの適用を検証する。
import { expect, test } from "bun:test";
import { RULE_NAMES, resolveRules } from "../src/textlint.ts";
import { edit, textlintFindings, Workspace, withPath, write } from "./helpers.ts";

/** 読点の数（max-ten）と二重否定（no-double-negative-ja）で検出される文章 */
const TEXT = "これは、長い、文で、読点が、多い、文です。\n\n確認できないわけではない。\n";
const FINDINGS = ["1:14: max-ten", "3:11: no-double-negative-ja"];

/** TEXT と同じ文章を、コメントとして記述したソースコード */
const CODE =
  "// これは、長い、文で、読点が、多い、文です。\nfn main() {}\n// 確認できないわけではない。\n";
const CODE_FINDINGS = ["1:17: max-ten", "3:14: no-double-negative-ja"];

/** textlint のルールを有効にする設定 */
const ENABLED = "[textlint]\nenabled = true\n";

test("使用できるルールは、2 つのプリセットの 28 件である", () => {
  expect(RULE_NAMES.length).toBe(28);
  expect(RULE_NAMES).toContain("max-ten");
  expect(RULE_NAMES).toContain("no-doubled-joshi");
  expect(RULE_NAMES).toContain("no-ai-list-formatting");
  expect(RULE_NAMES).toContain("ai-tech-writing-guideline");
});

/** AI が生成した文章に多い記述のルールを、すべて有効にする設定 */
const AI_WRITING = `${ENABLED}[textlint.rules]\n${[
  "no-ai-list-formatting",
  "no-ai-hype-expressions",
  "no-ai-emphasis-patterns",
  "ai-tech-writing-guideline",
  "no-ai-colon-continuation",
]
  .map((name) => `${name} = true\n`)
  .join("")}`;

test("AI が生成した文章に多い記述のルールは、設定で有効にした場合にのみ適用する", () => {
  const workspace = new Workspace("textlint-ai-writing");
  workspace.write("work/jai-smell.toml", ENABLED);
  const doc = workspace.write(
    "work/doc.md",
    [
      "- **重要**: 革命的な技術です。",
      "",
      "次のコマンドを実行します:",
      "",
      "```sh",
      "ls",
      "```",
      "",
      "## **太字**の見出し",
      "",
      "変更する必要があります。",
      "",
    ].join("\n"),
  );
  // 文末のコロンは、ja-no-mixed-period が検出する
  expect(textlintFindings(workspace.run([doc]).stdout)).toEqual(
    withPath(doc, ["3:13: ja-no-mixed-period"]),
  );
  workspace.write("work/jai-smell.toml", AI_WRITING);
  expect(textlintFindings(workspace.run([doc]).stdout)).toEqual(
    withPath(doc, [
      // 太字の接頭辞は no-ai-emphasis-patterns も検出するため、no-ai-list-formatting の検出結果のみを出力する
      "1:1: no-ai-list-formatting",
      "1:11: no-ai-hype-expressions",
      // 文末のコロンは ja-no-mixed-period も検出するため、no-ai-colon-continuation の検出結果のみを出力する
      "3:13: no-ai-colon-continuation",
      "9:4: no-ai-emphasis-patterns",
      "11:3: ai-tech-writing-guideline",
    ]),
  );
});

test("同じ箇所を 2 つのルールが検出する場合は、片方の検出結果のみを出力する", () => {
  const workspace = new Workspace("textlint-duplicates");
  workspace.write("work/jai-smell.toml", AI_WRITING);
  const doc = workspace.write("work/doc.md", "設定することができます。\n");
  expect(textlintFindings(workspace.run([doc]).stdout)).toEqual(
    withPath(doc, ["1:3: ja-no-redundant-expression"]),
  );
  // 片方を無効にした場合は、もう片方の検出結果を出力する
  workspace.write("work/jai-smell.toml", `${AI_WRITING}ja-no-redundant-expression = false\n`);
  expect(textlintFindings(workspace.run([doc]).stdout)).toEqual(
    withPath(doc, ["1:3: ai-tech-writing-guideline"]),
  );
});

test("絵文字の後でルールの報告する位置がずれる場合も、同じ箇所の検出結果を重複して出力しない", () => {
  const workspace = new Workspace("textlint-duplicates-emoji");
  workspace.write("work/jai-smell.toml", AI_WRITING);
  const doc = workspace.write(
    "work/doc.md",
    "- 🚀 **並列実行**: 時間を大幅に短縮することができます。\n",
  );
  expect(textlintFindings(workspace.run([doc]).stdout)).toEqual(
    withPath(doc, [
      "1:3: no-ai-list-formatting",
      "1:18: no-ai-hype-expressions",
      "1:22: ja-no-redundant-expression",
    ]),
  );
});

test("文体の混在は、no-mix-dearu-desumasu を有効にした場合にのみ検出する", () => {
  const workspace = new Workspace("textlint-style-guideline");
  workspace.write("work/jai-smell.toml", AI_WRITING);
  const doc = workspace.write("work/doc.md", "これは文です。あれは文である。\n");
  expect(workspace.run([doc]).stdout).toBe("");
});

test("「大幅に改善」は、no-ai-hype-expressions の検出結果のみを出力する", () => {
  const workspace = new Workspace("textlint-hype-duplicate");
  workspace.write("work/jai-smell.toml", AI_WRITING);
  const doc = workspace.write("work/doc.md", "性能を大幅に改善します。\n");
  expect(textlintFindings(workspace.run([doc]).stdout)).toEqual(
    withPath(doc, ["1:4: no-ai-hype-expressions"]),
  );
});

test("rules の設定を、プリセットのデフォルトの設定に上書きする", () => {
  const rules = resolveRules({ "max-ten": false, "sentence-length": { max: 120 } });
  expect(rules["max-ten"]).toBe(false);
  expect(rules["sentence-length"]).toEqual({ max: 120 });
  expect(rules["no-doubled-joshi"]).toBeDefined();
  expect(Object.keys(rules).sort()).toEqual([...RULE_NAMES].sort());
  // true を指定したルールは、ルールのデフォルトのオプションで適用する
  expect(resolveRules({ "no-mix-dearu-desumasu": true })["no-mix-dearu-desumasu"]).toEqual({
    preferInHeader: "",
    preferInBody: "",
    preferInList: "",
  });
  expect(resolveRules({ "no-mix-dearu-desumasu": false })["no-mix-dearu-desumasu"]).toBe(false);
  expect(resolveRules({ "no-mix-dearu-desumasu": { preferInList: "ですます" } })).toMatchObject({
    "no-mix-dearu-desumasu": { preferInList: "ですます" },
  });
  // 文書全体の件数の集計と、文体の混在を含む分類は、ルールのデフォルトのオプションでは適用しない
  expect(resolveRules({ "ai-tech-writing-guideline": true })["ai-tech-writing-guideline"]).toEqual({
    enableDocumentAnalysis: false,
    disableConsistencyGuidance: true,
  });
  expect(() => resolveRules({ "no-such-rule": false })).toThrow("使用できるルールではありません");
  expect(() => resolveRules({ "max-ten": 3 })).toThrow("max-ten");
});

test("設定で有効にしていない場合は、ルールを適用しない", () => {
  const workspace = new Workspace("textlint-default");
  const doc = workspace.write("work/doc.md", TEXT);
  const output = workspace.run([doc]);
  expect(output.code).toBe(0);
  expect(output.stdout).toBe("");
});

test("有効にした場合は、デフォルトでは .md と .txt のファイルにルールを適用する", () => {
  const workspace = new Workspace("textlint");
  workspace.write("work/jai-smell.toml", ENABLED);
  const doc = workspace.write("work/doc.md", TEXT);
  const plain = workspace.write("work/notes.txt", TEXT);
  const src = workspace.write("work/a.rs", TEXT);
  const output = workspace.run([doc, plain, src]);
  expect(output.code).toBe(1);
  expect(textlintFindings(output.stdout)).toEqual([
    ...withPath(doc, FINDINGS),
    ...withPath(plain, FINDINGS),
  ]);
});

test("enabled と include で、ルールを適用するファイルを変更できる", () => {
  const workspace = new Workspace("textlint-target");
  workspace.write("work/jai-smell.toml", ENABLED);
  workspace.write("work/drafts/jai-smell.toml", "[textlint]\nenabled = false\n");
  const doc = workspace.write("work/doc.md", TEXT);
  const draft = workspace.write("work/drafts/doc.md", TEXT);
  const src = workspace.write("work/a.rs", CODE);
  let output = workspace.run([doc, draft, src]);
  expect(textlintFindings(output.stdout)).toEqual(withPath(doc, FINDINGS));
  workspace.write("work/jai-smell.toml", `${ENABLED}include = ["**/*.rs"]\n`);
  output = workspace.run([doc, src]);
  expect(textlintFindings(output.stdout)).toEqual(withPath(src, CODE_FINDINGS));
});

test("ソースコードでは、コメントにのみルールを適用する", () => {
  const workspace = new Workspace("textlint-code-comments");
  workspace.write("work/jai-smell.toml", `${ENABLED}include = ["**/*.rs", "**/*.unknown"]\n`);
  const src = workspace.write(
    "work/a.rs",
    [
      // コードの括弧、?、カンマは検出しない
      'fn main() { let x = f(a, b, c, d, e)?; if x { g("確認できないわけではない。") } }',
      // 連続する行コメントは、1 つの文章として扱う。文末の句点がないことは検出しない
      "// 確認できない",
      "// わけではない",
      "",
    ].join("\n"),
  );
  // 言語を判定できないファイルには、ルールを適用しない
  const unknown = workspace.write("work/a.unknown", TEXT);
  const output = workspace.run([src, unknown]);
  expect(textlintFindings(output.stdout)).toEqual(withPath(src, ["3:8: no-double-negative-ja"]));
  // 文末の句点のルールは、設定に記述した場合は、コメントにも適用する
  workspace.write(
    "work/jai-smell.toml",
    `${ENABLED}include = ["**/*.rs"]\n[textlint.rules]\nja-no-mixed-period = true\n`,
  );
  expect(textlintFindings(workspace.run([src]).stdout)).toContain(`${src}:3:9: ja-no-mixed-period`);
});

test("文体の統一のルールは、設定で有効にした場合にのみ適用する", () => {
  const workspace = new Workspace("textlint-style");
  workspace.write("work/jai-smell.toml", ENABLED);
  const doc = workspace.write(
    "work/doc.md",
    "本文です。\n\n- 項目です。\n- 項目です。\n- 項目である。\n",
  );
  expect(workspace.run([doc]).stdout).toBe("");
  workspace.write(
    "work/jai-smell.toml",
    `${ENABLED}[textlint.rules]\nno-mix-dearu-desumasu = true\n`,
  );
  expect(textlintFindings(workspace.run([doc]).stdout)).toEqual(
    withPath(doc, ["5:5: no-mix-dearu-desumasu"]),
  );
});

test("文体の統一のルールは、箇条書きの文体が本文と同じ文書を検出しない", () => {
  const workspace = new Workspace("textlint-style-unified");
  workspace.write(
    "work/jai-smell.toml",
    `${ENABLED}[textlint.rules]\nno-mix-dearu-desumasu = true\n`,
  );
  const doc = workspace.write("work/doc.md", "本文です。\n\n- 項目です。\n- 項目です。\n");
  expect(workspace.run([doc]).stdout).toBe("");
});

test("rules で、ルールの無効化とオプションの指定ができる", () => {
  const workspace = new Workspace("textlint-rules");
  workspace.write(
    "work/jai-smell.toml",
    `${ENABLED}[textlint.rules]\nno-double-negative-ja = false\nmax-ten = { max = 5 }\n`,
  );
  const doc = workspace.write("work/doc.md", TEXT);
  expect(workspace.run([doc]).stdout).toBe("");
  workspace.write("work/jai-smell.toml", `${ENABLED}[textlint.rules]\nno-such-rule = false\n`);
  const output = workspace.run([doc]);
  expect(output.code).toBe(2);
  expect(output.stderr).toContain("no-such-rule");
});

test("Markdown のコードブロックには、ルールを適用しない", () => {
  const workspace = new Workspace("textlint-code");
  workspace.write("work/jai-smell.toml", ENABLED);
  const doc = workspace.write("work/doc.md", `本文です。\n\n\`\`\`\n${TEXT}\`\`\`\n`);
  expect(workspace.run([doc]).stdout).toBe("");
});

test("除外のコメントに、ルールの名前を指定できる", () => {
  const workspace = new Workspace("textlint-disable");
  workspace.write("work/jai-smell.toml", ENABLED);
  const doc = workspace.write(
    "work/doc.md",
    `<!-- jai-smell-disable-next-line max-ten -->\n${TEXT}`,
  );
  const output = workspace.run([doc]);
  expect(textlintFindings(output.stdout)).toEqual(withPath(doc, ["4:11: no-double-negative-ja"]));
  workspace.write("work/doc.md", `<!-- jai-smell-disable-file -->\n\n${TEXT}`);
  expect(workspace.run([doc]).stdout).toBe("");
});

test("ルールセットの検出結果と、出現位置の順に出力する", () => {
  const workspace = new Workspace("textlint-order").withHomeConfig();
  workspace.write("work/jai-smell.toml", ENABLED);
  const doc = workspace.write("work/doc.md", "確認できないわけではない。\n\nCI が走る。\n");
  const output = workspace.run([doc]);
  const lines = output.stdout.trim().split("\n");
  expect(lines.length).toBe(2);
  expect(lines[0]).toContain(`${doc}:1:11: `);
  expect(lines[0]).toEndWith("（textlint: no-double-negative-ja）");
  expect(lines[1]).toStartWith(`${doc}:3:5: "走る"`);
});

test("フック: 追加・変更された部分に、ルールを適用する", () => {
  const workspace = new Workspace("textlint-hook").withHomeConfig();
  workspace.write("work/jai-smell.toml", ENABLED);
  let output = workspace.hook(write(workspace.path("work/doc.md"), TEXT));
  expect(output.code).toBe(2);
  expect(textlintFindings(output.stderr)).toEqual(
    withPath(workspace.path("work/doc.md"), FINDINGS),
  );
  output = workspace.hook(edit(workspace.path("work/a.rs"), `// ${TEXT}`));
  expect(output.code).toBe(0);
  expect(output.stderr).toBe("");
});
