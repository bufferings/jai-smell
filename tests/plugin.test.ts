// Claude Code のプラグイン（.claude-plugin/ と plugin/）の内容と、フックから実行する check.sh を検証する。
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPOSITORY, run, Workspace } from "./helpers.ts";

const read = (path: string) => readFileSync(join(REPOSITORY, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

test("マーケットプレイスのプラグインの名前は、init がインストールする名前と一致する", () => {
  const marketplace = readJson(".claude-plugin/marketplace.json");
  const plugin = readJson("plugin/.claude-plugin/plugin.json");
  expect(marketplace.name).toBe("jai-smell");
  expect(marketplace.plugins[0].name).toBe("jai-smell");
  expect(marketplace.plugins[0].source).toBe("./plugin");
  expect(plugin.name).toBe("jai-smell");
  expect(plugin.version).toBe(readJson("package.json").version);
});

test("フックは、ファイルの編集の後と、返答の終了時に check.sh を実行する", () => {
  const hooks = readJson("plugin/hooks/hooks.json");
  expect(Object.keys(hooks.hooks)).toEqual(["PostToolUse", "Stop"]);
  expect(hooks.hooks.Stop[0].hooks[0].command).toBe('"${CLAUDE_PLUGIN_ROOT}"/hooks/check.sh');
  const postToolUse = hooks.hooks.PostToolUse[0];
  expect(postToolUse.matcher).toBe("Edit|Write|MultiEdit");
  expect(postToolUse.hooks[0].command).toBe('"${CLAUDE_PLUGIN_ROOT}"/hooks/check.sh');
});

/** Markdown の先頭の front matter（--- で囲まれた部分）の行を返す */
function frontMatter(path: string): string[] {
  const text = read(path);
  expect(text.startsWith("---\n")).toBe(true);
  return text.slice(4, text.indexOf("\n---\n", 4)).split("\n");
}

test("出力スタイルは、Claude Code の組み込みの指示を保持し、利用者の outputStyle の設定を上書きしない", () => {
  const lines = frontMatter("plugin/output-styles/japanese-replies.md");
  expect(lines).toContain("name: japanese-replies");
  expect(lines).toContain("keep-coding-instructions: true");
  expect(lines.join("\n")).not.toContain("force-for-plugin");
});

test("スキルの名前は、ディレクトリの名前と一致する", () => {
  for (const name of ["japanese-tech-writing", "add-custom-rule", "configure"]) {
    expect(frontMatter(`plugin/skills/${name}/SKILL.md`)).toContain(`name: ${name}`);
  }
});

test("add-custom-rule スキルの probe.toml は、形態素ごとに分割位置と品詞のみを出力する", () => {
  const workspace = new Workspace("probe");
  // 表現のルールが適用されていれば、「走る」も検出される
  workspace.write("example.txt", "正典が走る。\n");
  const output = run(
    ["--config", join(REPOSITORY, "plugin/skills/add-custom-rule/probe.toml"), "example.txt"],
    { cwd: workspace.root },
  );
  expect(output.code).toBe(1);
  expect(output.stdout.split("\n").filter((line) => line !== "")).toEqual([
    "example.txt:1:1: 接頭詞",
    "example.txt:1:2: 名詞",
    "example.txt:1:3: 助詞",
    "example.txt:1:4: 動詞",
    "example.txt:1:6: 記号",
  ]);
});

/** PATH に jai-smell を含めるかどうかを指定して、check.sh を実行する */
function check(withCommand: boolean) {
  const home = join(tmpdir(), `jai-smell-plugin-${process.pid}-${withCommand}`);
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  const dirs = ["/usr/bin", "/bin"];
  if (withCommand) {
    // テストではバイナリの代わりに、ソースコードを実行するスクリプトを jai-smell として配置する
    const bin = join(home, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "jai-smell"),
      `#!/bin/sh\nexec "${process.execPath}" "${join(REPOSITORY, "src/main.ts")}" "$@"\n`,
    );
    chmodSync(join(bin, "jai-smell"), 0o755);
    dirs.unshift(bin);
  }
  const input = {
    tool_name: "Edit",
    tool_input: { file_path: join(home, "doc.md"), old_string: "x", new_string: "CI が走る。" },
  };
  const result = Bun.spawnSync([join(REPOSITORY, "plugin/hooks/check.sh")], {
    env: { HOME: home, PATH: dirs.join(":") },
    stdin: Buffer.from(JSON.stringify(input)),
  });
  return { code: result.exitCode, stderr: result.stderr.toString() };
}

test("check.sh は、jai-smell の終了コードと出力を変更せずに返す", () => {
  const output = check(true);
  expect(output.code).toBe(2);
  expect(output.stderr).toContain('"走る"');
});

test("check.sh は、jai-smell が PATH に存在しない場合は何も実行しない", () => {
  const output = check(false);
  expect(output.code).toBe(0);
  expect(output.stderr).toBe("");
});
