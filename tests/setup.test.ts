// `jai-smell setup` を、一時ディレクトリを HOME とし、claude を差し替えた PATH で検証する。
import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Output, run } from "./helpers.ts";

const MANUAL = "claude plugin marketplace add bufferings/jai-smell";
const BUN_DIR = dirname(process.execPath);

class Home {
  readonly root: string;

  constructor(name: string) {
    this.root = join(tmpdir(), `jai-smell-setup-${process.pid}-${name}`);
    rmSync(this.root, { recursive: true, force: true });
    mkdirSync(this.root, { recursive: true });
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

  setup(pathDirs: string[]): Output {
    const env: Record<string, string> = {
      HOME: this.root,
      // テストではソースコードを実行するため、bun のディレクトリを PATH に含める
      PATH: [...pathDirs, BUN_DIR, "/usr/bin", "/bin"].join(":"),
      CLAUDE_CONFIG_DIR: "",
    };
    return run(["setup"], { env });
  }

  claudeLog(): string {
    const path = join(this.root, "claude.log");
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  }
}

test("claude がない場合は、プラグインのインストール手順を出力する", () => {
  const home = new Home("no-claude");
  const output = home.setup([]);
  expect(output.code).toBe(1);
  expect(output.stdout).toContain(MANUAL);
});

test("claude がある場合は、プラグインをインストールする", () => {
  const home = new Home("claude");
  const output = home.setup([home.fakeClaude(0)]);
  expect(output.code).toBe(0);
  expect(home.claudeLog()).toBe(
    "plugin marketplace add bufferings/jai-smell\nplugin install jai-smell@jai-smell\n",
  );
});

test("claude が失敗した場合は、プラグインのインストール手順を出力する", () => {
  const home = new Home("claude-fails");
  const output = home.setup([home.fakeClaude(1)]);
  expect(output.code).toBe(1);
  expect(home.claudeLog()).toBe("plugin marketplace add bufferings/jai-smell\n");
  expect(output.stdout).toContain(MANUAL);
});

const settings = (enabled: boolean) =>
  `{ "enabledPlugins": { "jai-smell@jai-smell": ${enabled} } }`;
const UPDATE = "plugin marketplace update jai-smell\nplugin update jai-smell@jai-smell\n";

test("プラグインがインストール済みの場合は、アップデートする", () => {
  const home = new Home("plugin-installed");
  home.write(".claude/settings.json", settings(true));
  const output = home.setup([home.fakeClaude(0)]);
  expect(output.code).toBe(0);
  expect(home.claudeLog()).toBe(UPDATE);
  expect(output.stdout).toContain("プラグインをアップデートしました");
});

test("インストール済みで claude がない場合は、プラグインのアップデート手順を出力する", () => {
  const home = new Home("plugin-installed-no-claude");
  home.write(".claude/settings.json", settings(true));
  const output = home.setup([]);
  expect(output.code).toBe(1);
  expect(output.stdout).toContain("claude plugin update jai-smell@jai-smell");
});

test("プラグインが無効に設定されている場合は、変更しない", () => {
  const home = new Home("plugin-disabled");
  home.write(".claude/settings.json", settings(false));
  const output = home.setup([home.fakeClaude(0)]);
  expect(output.code).toBe(0);
  expect(home.claudeLog()).toBe("");
});
