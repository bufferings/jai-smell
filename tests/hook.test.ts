import { expect, test } from "bun:test";
import { target } from "../src/hook.ts";

const text = (input: string) => target(input)?.parts.join("\n\n");

test("各ツールの入力から、追加・変更された部分を抽出する", () => {
  expect(
    text(
      '{ "hook_event_name": "PostToolUse", "tool_name": "Write", "tool_input": { "file_path": "a.md", "content": "本文" } }',
    ),
  ).toBe("本文");
  expect(
    text(
      '{ "tool_name": "Edit", "tool_input": { "file_path": "a.md", "old_string": "前", "new_string": "後" } }',
    ),
  ).toBe("後");
  expect(
    text(`{ "tool_name": "MultiEdit", "tool_input": { "file_path": "a.md", "edits": [
      { "old_string": "1", "new_string": "一" },
      { "old_string": "2", "new_string": "二" }
    ] } }`),
  ).toBe("一\n\n二");
});

test("file_path またはテキストがない場合は undefined を返す", () => {
  expect(text('{ "tool_name": "Bash", "tool_input": { "command": "ls" } }')).toBeUndefined();
  expect(text('{ "tool_input": { "file_path": "a.md", "new_string": "" } }')).toBeUndefined();
  expect(text("{}")).toBeUndefined();
});

test("JSON として解析できない入力はエラーにする", () => {
  expect(() => target("not json")).toThrow();
});
