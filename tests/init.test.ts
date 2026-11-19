// `jai-smell init` を、一時ディレクトリを HOME とし、claude を差し替えた PATH で検証する。
import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Output, REPOSITORY, run } from "./helpers.ts";

/** jai-smell init が作成するファイル */
const FILES = ["jai-smell.toml", "custom-rules.toml"];
const MANUAL = "claude plugin marketplace add bufferings/jai-smell";
const BUN_DIR = dirname(process.execPath);

const source = (name: string) => readFileSync(join(REPOSITORY, "config", name), "utf8");

class Home {
  readonly root: string;

  constructor(name: string) {
    this.root = join(tmpdir(), `jai-smell-init-${process.pid}-${name}`);
    rmSync(this.root, { recursive: true, force: true });
    mkdirSync(this.root, { recursive: true });
  }

  config(name: string): string {
    return readFileSync(join(this.root, ".config/jai-smell", name), "utf8");
  }

  write(path: string, text: string): string {
    const full = join(this.root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    return full;
  }

  /** 受け取った引数を $HOME/claude.log に記録し、exitCode で終了する claude を配置する */
  fakeClaude(exitCode: number): string {
    const path = this.write(
      "bin/claude",
      `#!/bin/sh\necho "$@" >> "$HOME/claude.log"\nexit ${exitCode}\n`,
    );
    chmodSync(path, 0o755);
    return dirname(path);
  }

  init(pathDirs: string[]): Output {
    const env: Record<string, string> = {
      HOME: this.root,
      // テストではソースコードを実行するため、bun のディレクトリを PATH に含める
      PATH: [...pathDirs, BUN_DIR, "/usr/bin", "/bin"].join(":"),
      CLAUDE_CONFIG_DIR: "",
    };
    return run(["init"], { env });
  }

  claudeLog(): string {
    const path = join(this.root, "claude.log");
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  }
}

test("設定ファイルを作成し、claude がない場合はプラグインのインストール手順を出力する", () => {
  const home = new Home("no-claude");
  const output = home.init([]);
  expect(output.code).toBe(1);
  for (const name of FILES) {
    expect(home.config(name)).toBe(source(name));
  }
  expect(output.stdout).toContain(MANUAL);
});

test("すでに存在する設定ファイルは変更しない", () => {
  const home = new Home("existing");
  for (const name of FILES) {
    home.write(`.config/jai-smell/${name}`, "# 既存の内容\n");
  }
  const output = home.init([]);
  for (const name of FILES) {
    expect(home.config(name)).toBe("# 既存の内容\n");
  }
  expect(output.stdout).toContain("jai-smell.toml はすでに存在するため");
  // プリセットはバイナリに含まれるため、ファイルとして作成しない
  expect(existsSync(join(home.root, ".config/jai-smell/preset-rules.toml"))).toBe(false);
});

test("claude がある場合は、プラグインをインストールする", () => {
  const home = new Home("claude");
  const output = home.init([home.fakeClaude(0)]);
  expect(output.code).toBe(0);
  expect(home.claudeLog()).toBe(
    "plugin marketplace add bufferings/jai-smell\nplugin install jai-smell@jai-smell\n",
  );
});

test("claude が失敗した場合は、プラグインのインストール手順を出力する", () => {
  const home = new Home("claude-fails");
  const output = home.init([home.fakeClaude(1)]);
  expect(output.code).toBe(1);
  expect(home.claudeLog()).toBe("plugin marketplace add bufferings/jai-smell\n");
  expect(output.stdout).toContain(MANUAL);
});

test("プラグインが有効または無効に設定されている場合は、変更しない", () => {
  for (const enabled of [true, false]) {
    const home = new Home(`plugin-${enabled}`);
    home.write(
      ".claude/settings.json",
      `{ "enabledPlugins": { "jai-smell@jai-smell": ${enabled} } }`,
    );
    const output = home.init([home.fakeClaude(0)]);
    expect(output.code).toBe(0);
    expect(home.claudeLog()).toBe("");
  }
});
