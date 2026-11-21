// jai-smell の Claude Code プラグインの Mod（hooks.json の modules）。
// チェックを実行していない状態を、プロンプトの下のステータスに表示する。対象は次の 2 つである。
// - /jai-smell-off で、このセッションのチェックを停止している
// - 設定を読み込めない。フックは、チェックを実行せずに終了する
import type { EngineInterface, Register } from "claude-code";

const OFF = "off（/jai-smell-on で再開）";
const CONFIG_FAILED = "設定を読み込めません。/jai-smell:configure で修正してください";

/** 返答に適用する設定の探索に、フックが使用するファイルの名前 */
const REPLY_FILE = "reply.md";

const state = {
  /** このセッションのチェックを停止している */
  off: false,
  /** 作業ディレクトリに適用する設定を読み込めない */
  sessionFails: false,
  /** 最後に編集したファイルに適用する設定を読み込めない。下位のディレクトリの設定ファイルは、そのディレクトリのファイルの編集で読み込まれる */
  fileFails: false,
};

function show($: EngineInterface): void {
  if (state.off) {
    $.ui.status(OFF);
  } else {
    $.ui.status(state.sessionFails || state.fileFails ? CONFIG_FAILED : undefined);
  }
}

/**
 * ファイルに適用する設定を読み込めない場合は true を返す。
 * jai-smell を実行できない場合は false を返す。フックも、チェックを実行せずに終了するためである
 */
async function configFails($: EngineInterface, file: string): Promise<boolean> {
  try {
    const { exitCode } = await $.process.run(["jai-smell", "config", file], { timeoutMs: 5000 });
    return exitCode !== 0;
  } catch {
    return false;
  }
}

/** チェックの停止を示すファイル。check.sh が、このファイルの有無を確認する */
async function offFile($: EngineInterface): Promise<string> {
  const env = await $.process.hookEnv();
  return `${env.CLAUDE_PLUGIN_DATA}/off/${env.CLAUDE_CODE_SESSION_ID}`;
}

async function removeOffFile($: EngineInterface): Promise<void> {
  await $.process.run(["rm", "-f", await offFile($)]);
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "jai-smell-off",
      description: "このセッションの jai-smell のチェックを停止する",
    });
    await $.command.register({
      name: "jai-smell-on",
      description: "このセッションの jai-smell のチェックを再開する",
    });
    const started = await next(e);
    state.off = await $.fs.exists(await offFile($));
    state.sessionFails = await configFails($, `${e.cwd}/${REPLY_FILE}`);
    show($);
    return started;
  });

  on("command.run", { command: "jai-smell-off" }, async ($) => {
    await $.fs.write(await offFile($), "");
    state.off = true;
    show($);
    return { text: "このセッションのチェックを停止しました。" };
  });

  on("command.run", { command: "jai-smell-on" }, async ($) => {
    await removeOffFile($);
    state.off = false;
    show($);
    return { text: "チェックを再開しました。" };
  });

  // 停止は、セッションの中だけで有効とする
  on("session.end", async ($, e, next) => {
    await removeOffFile($);
    return next(e);
  });

  // 利用者が設定ファイルを修正した後に、表示を消去する
  on("prompt.submit", async ($, e, next) => {
    state.sessionFails = await configFails($, `${await $.session.cwd()}/${REPLY_FILE}`);
    show($);
    return next(e);
  });

  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    const ran = await next(e);
    state.fileFails = await configFails($, e.file_path);
    show($);
    return ran;
  });

  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    const ran = await next(e);
    state.fileFails = await configFails($, e.file_path);
    show($);
    return ran;
  });
};
