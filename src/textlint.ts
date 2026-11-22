// textlint のルールの実行。textlint 本体（@textlint/kernel）と、次の 2 つのプリセットのルールを使用する。
// - textlint-rule-preset-ja-technical-writing: 技術文書の文章のルール。
// - @textlint-ja/textlint-rule-preset-ai-writing: AI が生成した文章に多い記述のルール。
//
// textlint のコマンドは、設定ファイルに記述された名前からルールのパッケージを実行時に読み込む。
// バイナリにはビルド時に参照が確定したコードのみが含まれるため、ルールを明示的にインポートして kernel に指定する。
import "./kuromojin-dict.ts";
import { TextlintKernel } from "@textlint/kernel";
import markdownPlugin from "@textlint/textlint-plugin-markdown";
import textPlugin from "@textlint/textlint-plugin-text";
import aiWriting from "@textlint-ja/textlint-rule-preset-ai-writing";
import technicalWriting from "textlint-rule-preset-ja-technical-writing";

type Preset = {
  rules: Record<string, unknown>;
  rulesConfig: Record<string, unknown>;
};

// CommonJS のモジュールは、バンドルの方法によって default に格納される場合がある
const unwrap = <T>(module: unknown): T =>
  ((module as { default?: unknown })?.default ?? module) as T;

// ルールの名前は 2 つのプリセットで重複しないため、1 つにまとめて名前だけで指定できるようにする
const PRESETS = [unwrap<Preset>(technicalWriting), unwrap<Preset>(aiWriting)];
const PRESET: Preset = {
  rules: Object.assign({}, ...PRESETS.map(({ rules }) => rules)),
  rulesConfig: Object.assign({}, ...PRESETS.map(({ rulesConfig }) => rulesConfig)),
};

/**
 * 同じ箇所を 2 つのルールが検出する組。後のルールの検出結果を出力しない。
 * 冗長な表現（「〜することが可能」の類）、文末のコロン、変化の程度を数値で示していない表現、
 * リスト項目の先頭の絵文字と太字が該当する
 */
const DUPLICATES = [
  ["ja-no-redundant-expression", "ai-tech-writing-guideline"],
  ["no-ai-colon-continuation", "ja-no-mixed-period"],
  ["no-ai-hype-expressions", "ai-tech-writing-guideline"],
  ["no-ai-list-formatting", "no-ai-emphasis-patterns"],
] as const;

type Span = { start: number; end: number };

/**
 * 2 つの検出結果が同じ箇所を指しているかどうかを返す。
 * 範囲が重なる場合に加えて、同じ行で、開始位置の差がその行のサロゲートペアの数以下の場合も、同じ箇所として扱う。
 * 位置をコードポイントで数えるルールは、絵文字などの後で、報告する位置がその数だけ前にずれるためである
 */
function sameSpot(text: string, a: Span, b: Span): boolean {
  if (a.start < b.end && b.start < a.end) {
    return true;
  }
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  const lineStart = text.lastIndexOf("\n", first.start - 1) + 1;
  const before = text.slice(lineStart, second.start);
  if (before.includes("\n")) {
    return false;
  }
  const surrogatePairs = before.length - [...before].length;
  return second.start - first.start <= surrogatePairs;
}

// ai-tech-writing-guideline のデフォルトのオプション。
// - enableDocumentAnalysis: 文書全体の検出件数の集計を、ファイルの先頭の位置に報告する機能である。
//   特定の箇所の検出結果ではないため、出力しない。
// - disableConsistencyGuidance: 用語と文体の一貫性の分類は、「です」と「である」の混在を検出する。
//   文体の混在は no-mix-dearu-desumasu を有効にした場合にだけ検出するため、この分類は適用しない。
PRESET.rulesConfig["ai-tech-writing-guideline"] = {
  enableDocumentAnalysis: false,
  disableConsistencyGuidance: true,
};

// no-mix-dearu-desumasu のデフォルトのオプション。
// 見出し、本文、箇条書きのそれぞれで、多いほうの文体に統一する。
// プリセットの指定（本文は「ですます」調、箇条書きは「である」調）では、
// 文体が統一されている文書でも、箇条書きが「ですます」調の場合に検出されるためである。
PRESET.rulesConfig["no-mix-dearu-desumasu"] = {
  preferInHeader: "",
  preferInBody: "",
  preferInList: "",
};

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
  const hits = result.messages
    .map((message) => {
      const start = message.range?.[0] ?? message.index;
      return {
        offset: start,
        end: Math.max(message.range?.[1] ?? start + 1, start + 1),
        ruleName: message.ruleId,
        // 複数行のメッセージは、検出結果を 1 行で出力するため、1 行にまとめる
        message: message.message.replace(/\s*\n\s*/g, " "),
      };
    })
    .sort((a, b) => a.offset - b.offset);
  const span = (hit: (typeof hits)[number]): Span => ({ start: hit.offset, end: hit.end });
  return hits
    .filter(
      (hit) =>
        !DUPLICATES.some(
          ([kept, dropped]) =>
            hit.ruleName === dropped &&
            hits.some((other) => other.ruleName === kept && sameSpot(text, span(other), span(hit))),
        ),
    )
    .map(({ offset, ruleName, message }) => ({ offset, ruleName, message }));
}
