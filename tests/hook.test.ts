import { expect, test } from "bun:test";
import { lacksJapanese } from "../src/check.ts";
import { reply, target } from "../src/hook.ts";
import { Workspace } from "./helpers.ts";

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

const stop = (message: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    hook_event_name: "Stop",
    cwd: "/Users/example/work",
    last_assistant_message: message,
    ...extra,
  });

test("Stop フックの入力から、返答を抽出する", () => {
  expect(reply(stop("返答です。"))).toEqual({ cwd: "/Users/example/work", text: "返答です。" });
});

test("Stop フックの入力ではない場合と、返答がない場合は undefined を返す", () => {
  expect(reply('{ "hook_event_name": "PostToolUse", "last_assistant_message": "返答" }')).toBe(
    undefined,
  );
  expect(reply(stop(""))).toBeUndefined();
  expect(reply(stop(undefined))).toBeUndefined();
});

test("Stop フックの指示で再出力した返答は、チェックしない", () => {
  expect(reply(stop("返答です。", { stop_hook_active: true }))).toBeUndefined();
});

test("本文の大部分が英語の返答を判定する", () => {
  expect(lacksJapanese("The build succeeded.")).toBe(true);
  expect(lacksJapanese("ビルドは成功しました。")).toBe(false);
  expect(lacksJapanese("Build は成功しました。")).toBe(false);
  // コードのみの返答と、記号や数字のみの返答は対象外とする
  expect(lacksJapanese("```sh\nbun run build\n```\n")).toBe(false);
  expect(lacksJapanese("`jai-smell`")).toBe(false);
  expect(lacksJapanese("42")).toBe(false);
  // 英字の用語を多く含む日本語の文は、日本語の行として扱う
  expect(
    lacksJapanese("Homebrew の formula と GitHub Actions の workflow を update しました。"),
  ).toBe(false);
  // 日本語の単語を含む英語の文は、英語の行として扱う
  expect(lacksJapanese("The build 成功 and all of the tests passed without errors.")).toBe(true);
  // 英語の行の分量が、日本語の行の分量を超える場合に判定する
  const english = "The build succeeded and all of the tests passed.";
  expect(lacksJapanese(`完了です。\n\n${english}\n\n${english}\n`)).toBe(true);
  expect(lacksJapanese(`ビルドは成功しました。英語の文案は次のとおりです。\n\n${english}\n`)).toBe(
    false,
  );
});

/** 返答のチェックの設定を指定して、Stop フックを実行する */
function stopHook(name: string, config: string | undefined, message: string) {
  const workspace = new Workspace(name);
  if (config !== undefined) {
    workspace.write("work/jai-smell.toml", config);
  }
  return workspace.hook({
    hook_event_name: "Stop",
    cwd: workspace.path("work"),
    last_assistant_message: message,
  });
}

test("返答のチェックは、設定で有効にした場合にのみ適用する", () => {
  expect(stopHook("stop-default", undefined, "The build succeeded.").code).toBe(0);
});

test("replies.japanese を有効にした場合は、大部分が英語の返答を検出する", () => {
  const config = "[replies]\njapanese = true\n";
  const output = stopHook("stop-japanese", config, "The build succeeded.");
  expect(output.code).toBe(2);
  expect(output.stderr).toContain("日本語で再出力してください");
  expect(stopHook("stop-japanese-ok", config, "ビルドは成功しました。").code).toBe(0);
});

test("設定を読み込めない場合は、チェックを実行していないことを exit 2 で Claude に通知する", () => {
  for (const [name, config, message] of [
    ["stop-unknown", "[replies]\nenglish = true\n", "english"],
    ["stop-type", '[replies]\njapanese = "yes"\n', "japanese には、true または false"],
    ["stop-preset", "[preset]\nenabled = false\n", "preset は使用できません"],
  ] as const) {
    const output = stopHook(name, config, "返答です。");
    expect(output.code).toBe(2);
    expect(output.stderr).toContain("チェックを実行していません");
    expect(output.stderr).toContain('claude "/jai-smell:configure"');
    expect(output.stderr).toContain(message);
  }
});
