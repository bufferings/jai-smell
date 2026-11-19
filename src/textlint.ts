// textlint のルールの実行。textlint 本体（@textlint/kernel）と textlint-rule-preset-ja-technical-writing のルールを使用する。
//
// textlint のコマンドは、設定ファイルに記述された名前からルールのパッケージを実行時に読み込む。
// バイナリにはビルド時に参照が確定したコードのみが含まれるため、ルールを明示的にインポートして kernel に指定する。
import "./kuromoji-dict.ts";
import { TextlintKernel } from "@textlint/kernel";
import markdownPlugin from "@textlint/textlint-plugin-markdown";
import textPlugin from "@textlint/textlint-plugin-text";
import preset from "textlint-rule-preset-ja-technical-writing";

type Preset = {
  rules: Record<string, unknown>;
  rulesConfig: Record<string, unknown>;
};

// CommonJS のモジュールは、バンドルの方法によって default に格納される場合がある
const unwrap = <T>(module: unknown): T =>
  ((module as { default?: unknown })?.default ?? module) as T;

const PRESET = unwrap<Preset>(preset);

/** 使用できるルールの名前 */
export const RULE_NAMES: readonly string[] = Object.keys(PRESET.rules);

export type TextlintHit = {
  /** テキスト内の位置（UTF-16 のコード単位） */
  offset: number;
  ruleName: string;
  message: string;
};

/**
 * 設定ファイルの rules を検証し、デフォルトの設定に上書きした結果を返す。
 * 値が false のルールは無効、true のルールはプリセットのデフォルトの設定、テーブルのルールはそのオプションで実行する
 */
export function resolveRules(rules: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...PRESET.rulesConfig };
  for (const name of RULE_NAMES) {
    resolved[name] ??= true;
  }
  for (const [name, value] of Object.entries(rules)) {
    if (!RULE_NAMES.includes(name)) {
      throw new Error(
        `textlint.rules の ${name} は、使用できるルールではありません（使用できるルール: ${RULE_NAMES.join(", ")}）`,
      );
    }
    const isOptions = typeof value === "object" && value !== null && !Array.isArray(value);
    if (typeof value !== "boolean" && !isOptions) {
      throw new Error(
        `textlint.rules の ${name} には、true、false、またはオプションのテーブルを指定してください`,
      );
    }
    resolved[name] = value === true ? (PRESET.rulesConfig[name] ?? true) : value;
  }
  return resolved;
}

/** テキストに textlint のルールを適用する。結果は出現位置の順に返す */
export async function lint(
  text: string,
  markdown: boolean,
  rules: Record<string, unknown>,
): Promise<TextlintHit[]> {
  const kernel = new TextlintKernel();
  const result = await kernel.lintText(text, {
    ext: markdown ? ".md" : ".txt",
    plugins: [
      { pluginId: "markdown", plugin: unwrap(markdownPlugin) },
      { pluginId: "text", plugin: unwrap(textPlugin) },
    ],
    rules: Object.entries(rules)
      .filter(([, options]) => options !== false)
      .map(([ruleId, options]) => ({
        ruleId,
        rule: unwrap(PRESET.rules[ruleId]),
        options,
      })),
  } as Parameters<TextlintKernel["lintText"]>[1]);
  return result.messages
    .map((message) => ({
      offset: message.range?.[0] ?? message.index,
      ruleName: message.ruleId,
      // 複数行のメッセージは、検出結果を 1 行で出力するため、1 行にまとめる
      message: message.message.replace(/\s*\n\s*/g, " "),
    }))
    .sort((a, b) => a.offset - b.offset);
}
