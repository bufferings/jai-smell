#!/usr/bin/env bun
import {
  CONFIG_FAILED,
  ConfigError,
  checkFile,
  checkWritten,
  configFor,
  FILE_HEADING,
  formatFinding,
  REPLY_NOT_JAPANESE,
  replyLacksJapanese,
} from "./check.ts";
import { reply, target } from "./hook.ts";

const USAGE = `使い方:
  jai-smell [--config <path>] <files...>
      ファイル全体をチェックし、検出結果を path:line:col: message の形式で出力する。検出した場合は exit 1
  jai-smell hook [--config <path>]
      Claude Code のフックの JSON を stdin から読み込む。検出した場合は結果を stderr に出力して exit 2
      設定を読み込めない場合は、エラーメッセージを stderr に出力して exit 2
      PostToolUse フックでは、今回の編集で追加・変更された部分をチェックする。
      Stop フックでは、設定ファイルの replies で有効にした場合に、Claude の返答をチェックする
  jai-smell config [--config <path>] <file>
      ファイルに適用する設定（読み込んだ設定ファイルと、適用するルール）を出力する
  jai-smell expressions
      jai-smell が提供する、表現のルールの内容を出力する
  jai-smell setup
      Claude Code のプラグインをインストールする。インストール済みの場合は、アップデートする

設定ファイルがない場合は、表現のルールをすべてのファイルに適用する。
表現のルールのうち、colloquial（話し言葉）と prefer-hiragana（漢字をひらく）は、設定ファイルの expressions.rules に
true を指定した場合に適用する。
textlint のルール（textlint-rule-preset-ja-technical-writing と @textlint-ja/textlint-rule-preset-ai-writing）は、
設定ファイルの textlint.enabled に true を指定した場合に適用する。適用するファイルのデフォルトは、.md と .txt である。

設定は、~/.config/jai-smell/jai-smell.toml（ユーザー全体の設定）、チェック対象のファイルの上位のディレクトリにある
jai-smell.toml の順に統合し、チェック対象のファイルに近い設定ファイルの指定を優先する。
上位のディレクトリの探索は、.git があるディレクトリで停止する。Git リポジトリの外では、ホームディレクトリの手前で停止する。
--config を指定すると、探索を行わず、指定したファイルのみを使用する。

設定ファイルには、次の内容を記述する。
  exclude: チェックの対象外とするファイルの glob。すべての設定ファイルの指定を合わせて適用する
  rule_sets、rule_files: 追加するルールセットと、ルールセットを記述したファイル
  expressions: 表現のルールの設定（enabled、include、exclude、rules）
  textlint: textlint のルールの設定（enabled、include、exclude、rules）
  replies: Claude の返答のチェックの設定（japanese）。デフォルトでは適用しない

.md は Markdown として解析し、コードブロック、インラインコード、HTML、リンクの URL はチェックの対象外とする。
ソースコードは、コメントと文字列リテラルをチェックする。textlint のルールは、コメントにのみ適用する。
その他のファイルは、プレーンテキストとしてファイル全体をチェックする。
ファイル内に jai-smell-disable-next-line（次の行）、jai-smell-disable（範囲の開始）と jai-smell-enable（範囲の終了）、
jai-smell-disable-file（ファイル全体）を記述すると、その範囲の検出結果をチェックの対象外とする。
コメントの後に空白区切りで表記を記述すると、その表記に一致する箇所のみを対象外とする。
textlint のルールの検出結果は、ルールの名前で指定する。
読み込んだ設定ファイルと rule_files のファイル自体はチェックの対象外とする。`;

type Mode =
  | { kind: "files"; files: string[] }
  | { kind: "hook" }
  | { kind: "config"; file: string }
  | { kind: "expressions" }
  | { kind: "setup" };

const SUBCOMMANDS = ["hook", "config", "expressions", "setup"];

export type Args = {
  mode: Mode;
  /** undefined の場合は、チェック対象のファイルごとに設定ファイルを探索する */
  config: string | undefined;
};

/** --help が指定された場合は undefined を返す */
export function parseArgs(argv: readonly string[]): Args | undefined {
  const args = [...argv];
  const subcommand = SUBCOMMANDS.includes(args[0] ?? "") ? args.shift() : undefined;
  let config: string | undefined;
  const files: string[] = [];
  let optionsEnded = false;
  while (args.length > 0) {
    const arg = args.shift() as string;
    if (optionsEnded) {
      files.push(arg);
    } else if (arg === "-h" || arg === "--help") {
      return undefined;
    } else if (arg === "--config") {
      config = args.shift();
      if (config === undefined) {
        throw new Error("--config に設定ファイルのパスを指定してください");
      }
    } else if (arg === "--") {
      optionsEnded = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`不明なオプションです: ${arg}`);
    } else {
      files.push(arg);
    }
  }
  if (subcommand === undefined) {
    if (files.length === 0) {
      throw new Error("ファイルを指定してください");
    }
    return { mode: { kind: "files", files }, config };
  }
  if (subcommand === "config") {
    const [file, ...rest] = files;
    if (file === undefined || rest.length > 0) {
      throw new Error("config にはファイルを 1 つ指定してください");
    }
    return { mode: { kind: "config", file }, config };
  }
  if (files.length > 0) {
    throw new Error(`${subcommand} にはファイルを指定できません`);
  }
  if (subcommand === "hook") {
    return { mode: { kind: "hook" }, config };
  }
  if (config !== undefined) {
    throw new Error(`${subcommand} には --config を指定できません`);
  }
  return { mode: { kind: subcommand as "expressions" | "setup" }, config };
}

async function runFiles(config: string | undefined, files: string[]): Promise<number> {
  let found = false;
  let failed = false;
  for (const file of files) {
    let findings: Awaited<ReturnType<typeof checkFile>>;
    try {
      findings = await checkFile(config, file);
    } catch (error) {
      // ファイルを読み込めない場合は、残りのファイルのチェックを継続する
      if ((error as NodeJS.ErrnoException).path === file) {
        console.error(`jai-smell: ${file}: ${(error as Error).message}`);
        failed = true;
        continue;
      }
      throw error;
    }
    for (const finding of findings) {
      console.log(formatFinding(file, finding));
      found = true;
    }
  }
  return failed ? 2 : found ? 1 : 0;
}

/**
 * 検出した場合は、exit 2 と stderr で Claude にフィードバックする。
 * 設定を読み込めない場合も、同じ方法で Claude に通知する。exit 1 は Claude に通知されず、チェックを実行していないことを利用者が確認できないためである
 */
async function runHook(config: string | undefined): Promise<number> {
  try {
    return await checkHookInput(config);
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      throw error;
    }
    console.error(`${CONFIG_FAILED}\n${error.message}`);
    return 2;
  }
}

async function checkHookInput(config: string | undefined): Promise<number> {
  const input = await Bun.stdin.text();
  const replied = reply(input);
  if (replied !== undefined) {
    if (!replyLacksJapanese(config, replied)) {
      return 0;
    }
    console.error(REPLY_NOT_JAPANESE);
    return 2;
  }
  const written = target(input);
  if (written === undefined) {
    return 0;
  }
  const findings = await checkWritten(config, written);
  if (findings.length === 0) {
    return 0;
  }
  console.error(FILE_HEADING);
  for (const finding of findings) {
    console.error(formatFinding(written.filePath, finding));
  }
  return 2;
}

async function main(): Promise<number> {
  let args: Args | undefined;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`jai-smell: ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args === undefined) {
    console.log(USAGE);
    return 0;
  }
  const { mode, config } = args;
  // exit 2 は Claude へのフィードバックとして扱われるため、設定の読み込みを除くフックの失敗は exit 1 とする
  const failure = mode.kind === "files" ? 2 : 1;
  try {
    switch (mode.kind) {
      case "files":
        return await runFiles(config, mode.files);
      case "hook":
        return await runHook(config);
      case "config": {
        const { describe } = await import("./describe.ts");
        console.log(describe(configFor(config, mode.file), mode.file));
        return 0;
      }
      case "expressions": {
        const { EXPRESSIONS_TEXT } = await import("./expressions.ts");
        process.stdout.write(EXPRESSIONS_TEXT);
        return 0;
      }
      case "setup": {
        const { run } = await import("./setup.ts");
        return run() ? 0 : 1;
      }
    }
  } catch (error) {
    console.error(`jai-smell: ${(error as Error).message}`);
    return failure;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
