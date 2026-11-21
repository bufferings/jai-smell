// jai-smell の Claude Code プラグインの Mod（hooks.json の modules）。
// - /jai-smell-off と /jai-smell-on で、このセッションのチェックを停止、再開する
// - /jai-smell-status で、チェックの状態を表示する
// - 設定を読み込めない間は、プロンプトの下のステータスに表示する。フックは、チェックを実行せずに終了する
import type { EngineInterface, Register } from "claude-code";

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

/** 停止している間は表示しない。利用者が停止したためである。状態は /jai-smell-status で確認できる */
function show($: EngineInterface): void {
  const failed = !state.off && (state.sessionFails || state.fileFails);
  $.ui.status(failed ? CONFIG_FAILED : undefined);
}

function describe(): string {
  if (state.off) {
    return "このセッションのチェックを停止しています。/jai-smell-on で再開できます。";
  }
  if (state.sessionFails || state.fileFails) {
    return `チェックを実行していません。${CONFIG_FAILED}。`;
  }
  return "チェックは有効です。";
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
    await $.command.register({
      name: "jai-smell-status",
      description: "jai-smell のチェックの状態を表示する",
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

  on("command.run", { command: "jai-smell-status" }, async ($) => {
    state.sessionFails = await configFails($, `${await $.session.cwd()}/${REPLY_FILE}`);
    show($);
    return { text: describe() };
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
