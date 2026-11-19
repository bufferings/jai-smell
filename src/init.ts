// `jai-smell init`: ユーザー全体の設定ファイルを作成し、Claude Code のプラグインをインストールする。
//
// Homebrew の formula はインストール時にホームディレクトリへ書き込めないため、利用者がインストール後に実行する。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
// 作成するファイル。内容はリポジトリの config/ の同名のファイルと同一
import customRules from "../config/custom-rules.toml" with { type: "text" };
import config from "../config/jai-smell.toml" with { type: "text" };
import { homeFile } from "./config.ts";

const MARKETPLACE = "bufferings/jai-smell";
const PLUGIN = "jai-smell@jai-smell";

/** 完了しなかった手順がある場合は false を返す */
export function run(): boolean {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME が設定されていません");
  }
  const configFile = homeFile(home);
  const dir = dirname(configFile);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new Error(`${dir} を作成できません: ${(error as Error).message}`);
  }
  // 利用者が記述するファイルは上書きしない
  createNew(configFile, config as unknown as string);
  createNew(join(dir, "custom-rules.toml"), customRules as unknown as string);
  return installPlugin(home);
}

/** すでに存在する場合は上書きしない */
function createNew(path: string, content: string): void {
  try {
    writeFileSync(path, content, { flag: "wx" });
    console.log(`設定ファイル ${path} を作成しました。`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new Error(`${path} を作成できません: ${(error as Error).message}`);
    }
    console.log(`設定ファイル ${path} はすでに存在するため、変更しません。`);
  }
}

function installPlugin(home: string): boolean {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const state = pluginState(join(claudeDir, "settings.json"));
  if (state === true) {
    console.log(`Claude Code のプラグイン ${PLUGIN} はすでにインストールされています。`);
    return true;
  }
  if (state === false) {
    console.log(`Claude Code のプラグイン ${PLUGIN} は無効に設定されているため、変更しません。`);
    return true;
  }
  const claude = findClaude(home);
  if (claude === undefined) {
    console.log("claude コマンドが見つからないため、プラグインをインストールしませんでした。");
    printManualInstall();
    return false;
  }
  const steps = [
    ["plugin", "marketplace", "add", MARKETPLACE],
    ["plugin", "install", PLUGIN],
  ];
  for (const args of steps) {
    console.log(`$ claude ${args.join(" ")}`);
    const result = Bun.spawnSync([claude, ...args], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) {
      console.log("プラグインのインストールに失敗しました。");
      printManualInstall();
      return false;
    }
  }
  console.log(
    "プラグインをインストールしました。起動中の Claude Code のセッションには、次回の起動時から反映されます。",
  );
  return true;
}

function printManualInstall(): void {
  console.log(
    `次のコマンドでインストールしてください。\n  claude plugin marketplace add ${MARKETPLACE}\n  claude plugin install ${PLUGIN}`,
  );
}

/**
 * settings.json の enabledPlugins にこのプラグインが含まれている場合は、有効かどうかを返す。
 * true 以外の値は、利用者が無効に設定したものとして扱う
 */
function pluginState(settings: string): boolean | undefined {
  try {
    const parsed = JSON.parse(readFileSync(settings, "utf8"));
    const value = parsed?.enabledPlugins?.[PLUGIN];
    return value === undefined ? undefined : value === true;
  } catch {
    return undefined;
  }
}

/** PATH に存在しない場合も、Claude Code の公式インストーラーが配置する ~/.local/bin/claude を確認する */
function findClaude(home: string): string | undefined {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter((dir) => dir !== "");
  return [...dirs.map((dir) => join(dir, "claude")), join(home, ".local/bin/claude")].find(
    (path) => existsSync(path) && statSync(path).isFile(),
  );
}
