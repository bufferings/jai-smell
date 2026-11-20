import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const REPOSITORY = join(import.meta.dir, "..");
/** 表現のルールのすべてを適用し、textlint のルールは適用しない設定ファイル */
export const RULES_ONLY = join(REPOSITORY, "tests/rules-only.toml");

export type Output = { code: number; stdout: string; stderr: string };

/** jai-smell コマンドを実行する。テストでは、バイナリではなくソースコードを実行する */
export function run(
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; stdin?: string } = {},
): Output {
  const result = Bun.spawnSync(["bun", join(REPOSITORY, "src/main.ts"), ...args], {
    cwd: options.cwd ?? REPOSITORY,
    env: { ...process.env, ...options.env },
    stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/** ルールセットの検出結果の行から、位置と表現（message の先頭の "…"）のみを抽出する */
export function findings(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => !line.includes("（textlint: ") && line.includes(" は、"))
    .map((line) => line.slice(0, line.indexOf(" は、")));
}

/** textlint のルールの検出結果の行から、位置とルールの名前のみを抽出する */
export function textlintFindings(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.match(/^(.*?:\d+:\d+): .*（textlint: (.+)）$/))
    .flatMap((match) => (match ? [`${match[1]}: ${match[2]}`] : []));
}

export const withPath = (path: string, positions: readonly string[]) =>
  positions.map((position) => `${path}:${position}`);

/** テストごとの一時ディレクトリ。リポジトリの外にあるため、リポジトリの jai-smell.toml は読み込まれない */
export class Workspace {
  readonly root: string;

  constructor(name: string) {
    this.root = join(tmpdir(), `jai-smell-cli-${process.pid}-${name}`);
    rmSync(this.root, { recursive: true, force: true });
    mkdirSync(this.root, { recursive: true });
  }

  path(path: string): string {
    return join(this.root, path);
  }

  write(path: string, text: string): string {
    const full = this.path(path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    return full;
  }

  /** ユーザー全体の設定として、表現のルールのすべてを適用し、ルールセットのファイルを読み込む設定ファイルを配置する */
  withHomeConfig(): this {
    this.write(
      "home/.config/jai-smell/jai-smell.toml",
      'rule_files = ["custom-rules.toml"]\n[expressions.rules]\ncolloquial = true\nprefer-hiragana = true\n',
    );
    this.write("home/.config/jai-smell/custom-rules.toml", "");
    return this;
  }

  run(args: string[], stdin?: string): Output {
    return run(args, { env: { HOME: this.path("home") }, stdin });
  }

  hook(input: unknown): Output {
    return this.run(["hook"], JSON.stringify(input));
  }
}

export const edit = (filePath: string, newString: string) => ({
  tool_name: "Edit",
  tool_input: { file_path: filePath, old_string: "x", new_string: newString },
});

export const write = (filePath: string, content: string) => ({
  tool_name: "Write",
  tool_input: { file_path: filePath, content },
});

/** 指定した設定ファイルのみを使用して、フックを実行する */
export const hook = (input: unknown, config: string = RULES_ONLY): Output =>
  run(["hook", "--config", config], {
    stdin: typeof input === "string" ? input : JSON.stringify(input),
  });
