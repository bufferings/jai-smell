// Claude Code のフックの入力（JSON）から、チェックの対象を抽出する。
// PostToolUse フックでは、今回の編集で追加・変更された部分を、Stop フックでは、Claude の返答を対象とする。

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
