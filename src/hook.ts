// Claude Code の PostToolUse フックの入力（JSON）から、今回の編集で追加・変更された部分を抽出する。

/** ファイルの編集で追加・変更された部分。MultiEdit では編集ごとに分かれる */
export type Target = {
  filePath: string;
  parts: string[];
};

const text = (value: unknown): string[] => (typeof value === "string" ? [value] : []);

/** 追加・変更された部分がない場合は undefined を返す */
export function target(input: string): Target | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`フックの入力を JSON として解析できません: ${(error as Error).message}`);
  }
  const toolInput = (parsed as { tool_input?: Record<string, unknown> } | null)?.tool_input;
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
