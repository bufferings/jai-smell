// jai-smell コマンドとフックの動作を、表現のルールで検証する。
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  edit,
  findings,
  hook,
  REPOSITORY,
  RULES_ONLY,
  run,
  Workspace,
  withPath,
  write,
} from "./helpers.ts";

const SAMPLE = join(REPOSITORY, "tests/sample.md");
/** 表現のルールの検証用。1 行ごとに、修正前の文章（検出される）と修正後の文章（検出されない）を記述する */
const REWRITE_BEFORE = join(REPOSITORY, "tests/rewrite_before.md");
const REWRITE_AFTER = join(REPOSITORY, "tests/rewrite_after.md");

/** tests/sample.md に対する検出結果の位置と表現 */
const SAMPLE_FINDINGS = [
  '3:8: "効く"',
  '3:17: "効く"',
  '3:24: "効く"',
  '4:5: "走る"',
  '4:12: "走る"',
  '5:17: "〜に落ちる"',
  '6:4: "崩す"',
  '6:7: "壊れる"',
  '7:4: "穴"',
  '7:9: "落とし穴"',
  '8:4: "見張る"',
];

const TEST_RULE_SET = `
[[rule_sets]]
name = "テスト"
[[rule_sets.entries]]
message = "\\"注意\\" は、テスト用の表現です。"
tokens = [{ basic_form = "注意" }]
`;

test("サンプルの検出結果を出力する", () => {
  // 設定ファイルの相対パスは、カレントディレクトリを基準とする
  const output = run(["--config", "tests/rules-only.toml", "tests/sample.md"]);
  expect(output.code).toBe(1);
  expect(findings(output.stdout)).toEqual(withPath("tests/sample.md", SAMPLE_FINDINGS));
});

test("設定ファイルがない場合は、組み込みのデフォルトを適用する", () => {
  const workspace = new Workspace("no-config");
  const sample = workspace.write("work/sample.md", readFileSync(SAMPLE, "utf8"));
  const output = workspace.run([sample]);
  expect(output.code).toBe(1);
  expect(findings(output.stdout)).toEqual(withPath(sample, SAMPLE_FINDINGS));
});

test("プロジェクトの設定がない場合は、ユーザー全体の設定を使用する", () => {
  const workspace = new Workspace("home").withHomeConfig();
  const sample = workspace.write("work/sample.md", readFileSync(SAMPLE, "utf8"));
  const output = workspace.run([sample]);
  expect(output.code).toBe(1);
  expect(findings(output.stdout)).toEqual(withPath(sample, SAMPLE_FINDINGS));
});

test("ユーザー全体の設定に、プロジェクトの設定を追加する", () => {
  const workspace = new Workspace("layers").withHomeConfig();
  const project = workspace.write("work/jai-smell.toml", `exclude = ["skip/**"]\n${TEST_RULE_SET}`);
  const text = readFileSync(SAMPLE, "utf8");
  const sample = workspace.write("work/docs/sample.md", text);
  const skipped = workspace.write("work/skip/sample.md", text);
  const output = workspace.run([sample, skipped, project]);
  expect(output.code).toBe(1);
  const expected = [...SAMPLE_FINDINGS];
  expected.splice(
    expected.findIndex((finding) => finding.startsWith("8:")),
    0,
    '7:14: "注意"',
  );
  // skip 配下のファイルと、設定ファイル自体はチェックの対象外とする
  expect(findings(output.stdout)).toEqual(withPath(sample, expected));
});

test("ユーザー全体の設定の exclude に一致するファイルは、チェックしない", () => {
  const workspace = new Workspace("home-exclude").withHomeConfig();
  workspace.write(
    "home/.config/jai-smell/jai-smell.toml",
    `exclude = ["${workspace.path("work")}/skip/**"]\n`,
  );
  workspace.write("work/jai-smell.toml", TEST_RULE_SET);
  const text = readFileSync(SAMPLE, "utf8");
  const sample = workspace.write("work/skip/sample.md", text);
  expect(workspace.run([sample]).stdout).toBe("");
});

test("表現のルールを適用しない場合も、追加のルールセットは適用する", () => {
  const workspace = new Workspace("preset-off").withHomeConfig();
  workspace.write("work/jai-smell.toml", `${TEST_RULE_SET}\n[expressions]\nenabled = false\n`);
  const sample = workspace.write("work/sample.md", readFileSync(SAMPLE, "utf8"));
  const output = workspace.run([sample]);
  expect(findings(output.stdout)).toEqual(withPath(sample, ['7:14: "注意"']));
});

test("下位のディレクトリの設定は、上位のディレクトリの設定と統合する", () => {
  const workspace = new Workspace("nested").withHomeConfig();
  workspace.write(
    "work/jai-smell.toml",
    `${TEST_RULE_SET}\n[expressions]\ninclude = ["docs/**"]\n`,
  );
  workspace.write("work/docs/blog/jai-smell.toml", "[expressions.rules]\nmetaphor = false\n");
  const text = readFileSync(SAMPLE, "utf8");
  const doc = workspace.write("work/docs/sample.md", text);
  const blog = workspace.write("work/docs/blog/sample.md", text);
  const src = workspace.write("work/src/sample.md", text);
  const output = workspace.run([doc, blog, src]);
  const withNote = [...SAMPLE_FINDINGS];
  withNote.splice(
    withNote.findIndex((finding) => finding.startsWith("8:")),
    0,
    '7:14: "注意"',
  );
  const metaphors = ['6:4: "崩す"', '7:4: "穴"', '7:9: "落とし穴"'];
  expect(findings(output.stdout)).toEqual([
    ...withPath(doc, withNote),
    // 上位のディレクトリの設定の追加のルールセットと include は、下位のディレクトリにも適用する
    ...withPath(
      blog,
      withNote.filter((finding) => !metaphors.includes(finding)),
    ),
    ...withPath(src, ['7:14: "注意"']),
  ]);
});

test("config は、読み込んだ設定ファイルと、ファイルに適用する設定を出力する", () => {
  const workspace = new Workspace("describe").withHomeConfig();
  const project = workspace.write(
    "work/jai-smell.toml",
    `exclude = ["skip/**"]\n${TEST_RULE_SET}\n[expressions.rules]\nmetaphor = false\n[textlint]\nenabled = true\n[textlint.rules]\nmax-ten = false\n`,
  );
  let output = workspace.run(["config", workspace.path("work/doc.md")]);
  expect(output.code).toBe(0);
  expect(output.stdout).toContain(workspace.path("home/.config/jai-smell/jai-smell.toml"));
  expect(output.stdout).toContain(project);
  expect(output.stdout).toContain("適用しないルール: metaphor（比喩）");
  expect(output.stdout).toContain("追加のルールセット: テスト");
  expect(output.stdout).toContain("適用しないルール: max-ten、no-mix-dearu-desumasu");
  output = workspace.run(["config", workspace.path("work/a.rs")]);
  expect(output.stdout).toContain("textlint: 適用しません");
  output = workspace.run(["config", workspace.path("work/skip/doc.md")]);
  expect(output.stdout).toContain("exclude に一致するため、チェックしません。");
});

test("expressions は、表現のルールの内容を、rule_files に指定できる形式で出力する", () => {
  const workspace = new Workspace("expressions");
  const output = workspace.run(["expressions"]);
  expect(output.code).toBe(0);
  expect(output.stdout).toBe(
    readFileSync(join(REPOSITORY, "config/expression-rules.toml"), "utf8"),
  );
  // 表現のルールと同じ内容を rule_files で読み込んだ場合も、同じ検出結果を重複して出力しない
  workspace.write("work/preset.toml", output.stdout);
  workspace.write("work/jai-smell.toml", 'rule_files = ["preset.toml"]');
  const sample = workspace.write("work/sample.md", readFileSync(SAMPLE, "utf8"));
  expect(findings(workspace.run([sample]).stdout)).toEqual(withPath(sample, SAMPLE_FINDINGS));
});

test("expressions.rules の不明な名前は、警告を出力してチェックを継続する", () => {
  const workspace = new Workspace("warning");
  workspace.write("work/jai-smell.toml", '[expressions.rules]\n"存在しない" = false\n');
  const sample = workspace.write("work/sample.md", readFileSync(SAMPLE, "utf8"));
  const output = workspace.run([sample]);
  expect(output.code).toBe(1);
  expect(output.stderr).toContain("存在しない");
  expect(findings(output.stdout)).toEqual(withPath(sample, SAMPLE_FINDINGS));
});

test("設定ファイルに誤りがある場合は、exit 2 で終了する", () => {
  const workspace = new Workspace("invalid");
  const project = workspace.write("work/jai-smell.toml", 'include = ["docs/**"]');
  const sample = workspace.write("work/sample.md", "本文");
  const output = workspace.run([sample]);
  expect(output.code).toBe(2);
  expect(output.stderr).toContain(project);
});

test("読み込めないファイルがある場合は、残りのファイルをチェックして exit 2 で終了する", () => {
  const output = run(["--config", RULES_ONLY, "tests/missing.md", "tests/sample.md"]);
  expect(output.code).toBe(2);
  expect(output.stderr).toContain("tests/missing.md");
  expect(findings(output.stdout)).toEqual(withPath("tests/sample.md", SAMPLE_FINDINGS));
});

/** 検出される表現を記述した、設定ファイルと rule_files のファイルを配置する */
function configFiles(name: string): { workspace: Workspace; config: string; rules: string } {
  const workspace = new Workspace(name);
  const config = workspace.write(
    "work/jai-smell.toml",
    '# "効く" は検出される表現\nrule_files = ["rules.toml"]\n',
  );
  const rules = workspace.write("work/rules.toml", `# "効く" は検出される表現\n${TEST_RULE_SET}`);
  return { workspace, config, rules };
}

test("設定ファイルと rule_files のファイル自体は、チェックの対象外とする", () => {
  const { workspace, config, rules } = configFiles("config-files");
  const output = workspace.run(["--config", config, config, rules]);
  expect(output.code).toBe(0);
  expect(output.stdout).toBe("");
});

test("リポジトリの jai-smell.toml は、テストデータを対象外とする", () => {
  const workspace = new Workspace("repository").withHomeConfig();
  const output = workspace.run([SAMPLE]);
  expect(output.code).toBe(0);
  expect(output.stdout).toBe("");
});

test("フック: Edit で追加された表現を検出する", () => {
  const output = hook(edit("/work/doc.md", "CI が走る。"));
  expect(output.code).toBe(2);
  expect(output.stderr).toStartWith("修正を検討すべき表現の候補を検出しました。");
  expect(findings(output.stderr)).toEqual(['/work/doc.md:1:5: "走る"']);
});

test("フック: 検出対象の表現がない場合は、何も出力しない", () => {
  const output = hook(edit("/work/doc.md", "ビルドが速くなる。"));
  expect(output.code).toBe(0);
  expect(output.stderr).toBe("");
});

test("フック: Write で追加された表現を検出する", () => {
  const output = hook(write("/work/new.md", "# 見出し\n\nログを見張る。\n"));
  expect(output.code).toBe(2);
  expect(findings(output.stderr)).toEqual(['/work/new.md:3:4: "見張る"']);
});

test("フック: MultiEdit で追加された表現を検出する", () => {
  const output = hook({
    tool_name: "MultiEdit",
    tool_input: {
      file_path: "/work/doc.md",
      edits: [
        { old_string: "a", new_string: "前提を崩す。" },
        { old_string: "b", new_string: "普通の文。" },
      ],
    },
  });
  expect(output.code).toBe(2);
  expect(findings(output.stderr)).toEqual(['/work/doc.md:1:4: "崩す"']);
});

test("フック: ソースコードはプレーンテキストとしてチェックする", () => {
  const cases: [unknown, string][] = [
    [
      edit("/work/app.ts", "// 保存のたびに同期処理が走る\nconst run = () => sync();"),
      '/work/app.ts:1:15: "走る"',
    ],
    [
      write(
        "/work/cache.py",
        'def get():\n    """キャッシュが効いているときは速い"""\n    return 1\n',
      ),
      '/work/cache.py:2:14: "効く"',
    ],
    [edit("/work/Makefile", "# ログを見張るターゲット"), '/work/Makefile:1:6: "見張る"'],
  ];
  for (const [input, expected] of cases) {
    const output = hook(input);
    expect(output.code).toBe(2);
    expect(findings(output.stderr)).toEqual([expected]);
  }
});

test("ソースコードは、コメントと文字列リテラルをチェックする", () => {
  const workspace = new Workspace("code");
  const src = workspace.write(
    "work/app.ts",
    [
      "// 保存のたびに同期処理が",
      "// 走る",
      'const url = "http://example.com/走る"; // 設定を見張る',
      "const 走る = 1;",
      'throw new Error("キャッシュが効かない");',
      "",
    ].join("\n"),
  );
  const output = workspace.run([src]);
  expect(findings(output.stdout)).toEqual(
    withPath(src, [
      // 連続する行コメントは、1 つの文章としてチェックする
      '2:4: "走る"',
      // 文字列リテラルの中の // は、コメントとして扱わない
      '3:33: "走る"',
      '3:44: "見張る"',
      '5:24: "効く"',
    ]),
  );
});

test("言語を判定できないファイルと、データを記述するファイルは、ファイル全体をチェックする", () => {
  const workspace = new Workspace("whole-text");
  const unknown = workspace.write("work/notes.unknown", "CI が走る。\n");
  const yaml = workspace.write("work/a.yml", "title: CI が走る\n");
  const output = workspace.run([unknown, yaml]);
  expect(findings(output.stdout)).toEqual([
    ...withPath(unknown, ['1:5: "走る"']),
    ...withPath(yaml, ['1:12: "走る"']),
  ]);
});

test("フック: ソースコードは、編集後のファイル全体からコメントを判定する", () => {
  const workspace = new Workspace("hook-code");
  const file = workspace.write(
    "work/app.ts",
    "/**\n * 設定を読み込む。\n * ログを見張る。\n */\nconst 見張る = 1;\n",
  );
  // 編集された部分のみでは、ブロックコメントの途中の行をコメントとして判定できない
  let output = workspace.hook(edit(file, " * ログを見張る。\n"));
  expect(output.code).toBe(2);
  expect(findings(output.stderr)).toEqual([`${file}:1:7: "見張る"`]);
  output = workspace.hook(edit(file, "const 見張る = 1;\n"));
  expect(output.code).toBe(0);
});

test("フック: 日本語を含まないコードは検出しない", () => {
  const output = hook(
    write(
      "/work/util.ts",
      "export const add = (a: number, b: number) => a + b;\n// run the job when cache misses\n",
    ),
  );
  expect(output.code).toBe(0);
  expect(output.stderr).toBe("");
});

test("フック: 設定ファイルと rule_files のファイル自体は、チェックの対象外とする", () => {
  const { config, rules } = configFiles("hook-config-files");
  for (const file of [config, rules]) {
    const output = hook(edit(file, '"効く" は'), config);
    expect(output.code).toBe(0);
    expect(output.stderr).toBe("");
  }
});

test("フック: 編集されたファイルの位置から、プロジェクトの設定を探索する", () => {
  const workspace = new Workspace("hook").withHomeConfig();
  workspace.write("work/jai-smell.toml", 'exclude = ["tests/**"]');
  let output = workspace.hook(edit(workspace.path("work/tests/a.rs"), "// CI が走る。"));
  expect(output.code).toBe(0);
  expect(output.stderr).toBe("");
  output = workspace.hook(edit(workspace.path("work/src/a.rs"), "// CI が走る。"));
  expect(output.code).toBe(2);
});

test("フック: コードは Markdown の場合にのみ対象外とする", () => {
  const text = "```\nCI が走る\n```\n\n`効く`\n";
  expect(hook(write("/work/doc.md", text)).code).toBe(0);
  const output = hook(write("/work/doc.txt", text));
  expect(findings(output.stderr)).toEqual([
    '/work/doc.txt:2:5: "走る"',
    '/work/doc.txt:5:2: "効く"',
  ]);
});

test("フック: フックの入力を解析できない場合は、Claude の処理を中断しない", () => {
  expect(hook("not json").code).toBe(1);
});

test("フック: 設定を読み込めない場合は、チェックを実行していないことを systemMessage で利用者に表示する", () => {
  const workspace = new Workspace("hook-invalid");
  workspace.write("work/jai-smell.toml", "unknown = 1");
  const output = workspace.hook(edit(workspace.path("work/doc.md"), "CI が走る。"));
  expect(output.code).toBe(0);
  expect(output.stderr).toBe("");
  const { systemMessage } = JSON.parse(output.stdout);
  expect(systemMessage).toContain("チェックを実行していません");
  expect(systemMessage).toContain("unknown");
  expect(systemMessage).toContain('claude "/jai-smell:configure"');
  expect(systemMessage).not.toContain("走る");
});

test("表現のルールは、修正前の文章のすべての行を検出する", () => {
  const output = run(["--config", RULES_ONLY, REWRITE_BEFORE]);
  const detected = new Set(
    output.stdout.split("\n").map((line) => Number(line.split(".md:")[1]?.split(":")[0])),
  );
  readFileSync(REWRITE_BEFORE, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (line !== "") {
        expect(detected.has(i + 1), `検出されない行: ${line}`).toBe(true);
      }
    });
});

test("表現のルールは、修正後の文章を検出しない", () => {
  const output = run(["--config", RULES_ONLY, REWRITE_AFTER]);
  expect(output.stdout).toBe("");
  expect(output.code).toBe(0);
});

test("ルールセットは、include と exclude に一致するファイルにのみ適用する", () => {
  const workspace = new Workspace("scope");
  workspace.write(
    "work/jai-smell.toml",
    `
[[rule_sets]]
name = "ドキュメント"
include = ["docs/**"]
exclude = ["docs/drafts/**"]
[[rule_sets.entries]]
message = "\\"注意\\" は、テスト用の表現です。"
tokens = [{ basic_form = "注意" }]
`,
  );
  const doc = workspace.write("work/docs/a.md", "注意する。");
  const draft = workspace.write("work/docs/drafts/a.md", "注意する。");
  const src = workspace.write("work/src/a.rs", "// 注意する。");
  const output = workspace.run([doc, draft, src]);
  expect(findings(output.stdout)).toEqual(withPath(doc, ['1:1: "注意"']));
});

test("除外のコメントの範囲の検出結果は出力しない", () => {
  const workspace = new Workspace("disable").withHomeConfig();
  const doc = workspace.write(
    "work/doc.md",
    "<!-- jai-smell-disable-next-line 変わった -->\n文章はどう変わったのか。設定を変える。\n\n設定が変わった。\n",
  );
  const src = workspace.write("work/a.rs", "// jai-smell-disable-file\n// 設定を見る。\n");
  const output = workspace.run([doc, src]);
  expect(findings(output.stdout)).toEqual(withPath(doc, ['2:16: "変える"', '4:4: "変わる"']));
});

test("フック: 除外のコメントは、編集後のファイル全体から読み込む", () => {
  const workspace = new Workspace("hook-disable").withHomeConfig();
  const file = workspace.write(
    "work/a.rs",
    "// jai-smell-disable 見る\n// 設定を見る。\n// jai-smell-enable\n// ログを見る。\n",
  );
  let output = workspace.hook(edit(file, "// 設定を見る。\n"));
  expect(output.code).toBe(0);
  expect(output.stderr).toBe("");
  output = workspace.hook(edit(file, "// ログを見る。\n"));
  expect(output.code).toBe(2);
});

test("--version と -V は、package.json のバージョンを出力する", () => {
  const { version } = JSON.parse(readFileSync(join(REPOSITORY, "package.json"), "utf8"));
  for (const option of ["--version", "-V"]) {
    const output = run([option]);
    expect(output.code).toBe(0);
    expect(output.stdout).toBe(`${version}\n`);
  }
});

test("--help と -h は、使い方を出力する", () => {
  for (const option of ["--help", "-h"]) {
    const output = run([option]);
    expect(output.code).toBe(0);
    expect(output.stdout).toContain("jai-smell --version");
  }
});
