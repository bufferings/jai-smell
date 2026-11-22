// Claude Code のフックの入力（JSON）から、チェックの対象を抽出する。
// PostToolUse フックでは、今回の編集で追加・変更された部分を、Stop フックでは、Claude の返答を対象とする。
// 検出した場合の、フックの出力（JSON）も作成する。

/** ファイルの編集で追加・変更された部分。MultiEdit では編集ごとに分かれる */
export type Target = {
  filePath: string;
  parts: string[];
};

/** Claude の返答。cwd は、適用する設定の探索に使用する */
export type Reply = {
  cwd: string;
  text: string;
};

const text = (value: unknown): string[] => (typeof value === "string" ? [value] : []);

function parse(input: string): Record<string, unknown> | null {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`フックの入力を JSON として解析できません: ${(error as Error).message}`);
  }
}

/**
 * Stop フックの入力から、Claude の返答を抽出する。Stop フックの入力ではない場合と、返答がない場合は undefined を返す。
 * stop_hook_active が true の場合（Stop フックの指示で再出力した返答）も undefined を返す。
 * 再出力した返答を再度チェックすると、検出が続く限り、返答が終了しないためである
 */
export function reply(input: string): Reply | undefined {
  const parsed = parse(input);
  if (parsed?.hook_event_name !== "Stop" || parsed.stop_hook_active === true) {
    return undefined;
  }
  const message = parsed.last_assistant_message;
  if (typeof message !== "string" || message.trim() === "") {
    return undefined;
  }
  return { cwd: typeof parsed.cwd === "string" ? parsed.cwd : process.cwd(), text: message };
}

/** 追加・変更された部分がない場合は undefined を返す */
export function target(input: string): Target | undefined {
  const toolInput = (parse(input) as { tool_input?: Record<string, unknown> } | null)?.tool_input;
  if (typeof toolInput?.file_path !== "string") {
    return undefined;
  }
  const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
  const parts = [
    // Write
    ...text(toolInput.content),
    // Edit
    ...text(toolInput.new_string),
    // MultiEdit
    ...edits.flatMap((edit) => text((edit as { new_string?: unknown })?.new_string)),
  ];
  if (parts.every((part) => part === "")) {
    return undefined;
  }
  return { filePath: toolInput.file_path, parts };
}

/**
 * additionalContext の文字数の上限。
 * Claude Code は、10,000 文字を超える additionalContext をファイルに保存し、Claude には先頭の一部だけを渡す。
 * 検出結果の全体を Claude に渡すため、上限に収まる件数だけを出力する
 */
const CONTEXT_LIMIT = 9000;

/**
 * PostToolUse フックの出力を返す。lines は、検出結果の行である。
 * additionalContext は Claude にだけ届き、systemMessage は利用者の画面にだけ表示される。
 * 検出結果の詳細を使用するのは Claude のため、利用者の画面には件数だけを表示する。
 * additionalContext は、命令ではなく事実として記述する。命令の形式の文章は、Claude が、フックの出力ではなく
 * 外部からの指示として扱う場合があるためである
 */
export function writtenContext(lines: readonly string[]): string {
  const heading = `jai-smell が、今回の編集で追加・変更された部分から、修正の候補となる表現を ${lines.length} 件検出しました。行番号は、追加・変更された部分の中での位置です。文脈に該当しない箇所は、修正の対象外です。`;
  const shown: string[] = [];
  let length = heading.length;
  for (const line of lines) {
    length += line.length + 1;
    if (length > CONTEXT_LIMIT) {
      break;
    }
    shown.push(line);
  }
  const omitted = lines.length - shown.length;
  const context = [
    heading,
    ...shown,
    ...(omitted > 0 ? [`残りの ${omitted} 件は、出力の上限のため省略しました。`] : []),
  ].join("\n");
  return JSON.stringify({
    systemMessage: `jai-smell: ${lines.length} 件を検出し、Claude に通知しました`,
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context },
  });
}

/** Stop フックの出力を返す。Claude は、返答を終了せず、reason に従って処理を継続する。reason は利用者の画面にも表示される */
export function replyBlock(reason: string): string {
  return JSON.stringify({ decision: "block", reason });
}
