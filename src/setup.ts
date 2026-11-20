// `jai-smell setup`: Claude Code のプラグインをインストールする。インストール済みの場合は、アップデートする。
//
// Homebrew の formula はインストール時にホームディレクトリへ書き込めないため、利用者がインストールとアップグレードの後に実行する。
// プラグインは brew upgrade ではアップデートされず、バイナリとプラグインのバージョンが異なる状態になるため、同じコマンドでアップデートする。
import { existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

const MARKETPLACE = "bufferings/jai-smell";
const MARKETPLACE_NAME = "jai-smell";
const PLUGIN = "jai-smell@jai-smell";

const INSTALL = [
  ["plugin", "marketplace", "add", MARKETPLACE],
  ["plugin", "install", PLUGIN],
];
const UPDATE = [
  ["plugin", "marketplace", "update", MARKETPLACE_NAME],
  ["plugin", "update", PLUGIN],
];

/** 完了しなかった手順がある場合は false を返す */
export function run(): boolean {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME が設定されていません");
  }
  return installPlugin(home);
}

function installPlugin(home: string): boolean {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const state = pluginState(join(claudeDir, "settings.json"));
  if (state === false) {
    console.log(`Claude Code のプラグイン ${PLUGIN} は無効に設定されているため、変更しません。`);
    return true;
  }
  const [action, steps] = state === true ? ["アップデート", UPDATE] : ["インストール", INSTALL];
  const manual = () =>
    console.log(
      `次のコマンドで${action}してください。\n${steps.map((args) => `  claude ${args.join(" ")}`).join("\n")}`,
    );
  const claude = findClaude(home);
  if (claude === undefined) {
    console.log(`claude コマンドが見つからないため、プラグインを${action}しませんでした。`);
    manual();
    return false;
  }
  for (const args of steps) {
    console.log(`$ claude ${args.join(" ")}`);
    const result = Bun.spawnSync([claude, ...args], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) {
      console.log(`プラグインの${action}に失敗しました。`);
      manual();
      return false;
    }
  }
  console.log(
    `プラグインを${action}しました。起動中の Claude Code のセッションには、次回の起動時から反映されます。`,
  );
  return true;
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
