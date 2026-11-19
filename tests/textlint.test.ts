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

test("使用できるルールは、プリセットの 23 件である", () => {
  expect(RULE_NAMES.length).toBe(23);
  expect(RULE_NAMES).toContain("max-ten");
  expect(RULE_NAMES).toContain("no-doubled-joshi");
});

test("rules の設定を、プリセットのデフォルトの設定に上書きする", () => {
  const rules = resolveRules({ "max-ten": false, "sentence-length": { max: 120 } });
  expect(rules["max-ten"]).toBe(false);
  expect(rules["sentence-length"]).toEqual({ max: 120 });
  expect(rules["no-doubled-joshi"]).toBeDefined();
  expect(Object.keys(rules).sort()).toEqual([...RULE_NAMES].sort());
  // true を指定したルールは、ルールのデフォルトのオプションで適用する
  expect(resolveRules({ "no-mix-dearu-desumasu": true })["no-mix-dearu-desumasu"]).not.toBe(true);
  expect(resolveRules({ "no-mix-dearu-desumasu": false })["no-mix-dearu-desumasu"]).toBe(false);
  expect(resolveRules({ "no-mix-dearu-desumasu": { preferInList: "ですます" } })).toMatchObject({
    "no-mix-dearu-desumasu": { preferInList: "ですます" },
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
  const doc = workspace.write("work/doc.md", "本文です。\n\n- 項目です。\n");
  expect(workspace.run([doc]).stdout).toBe("");
  workspace.write(
    "work/jai-smell.toml",
    `${ENABLED}[textlint.rules]\nno-mix-dearu-desumasu = true\n`,
  );
  expect(textlintFindings(workspace.run([doc]).stdout)).toEqual(
    withPath(doc, ["3:5: no-mix-dearu-desumasu"]),
  );
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
