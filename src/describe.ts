// `jai-smell config <file>`: ファイルに適用する設定の出力。
//
// 設定は複数の設定ファイルを統合した結果のため、読み込んだ設定ファイルと、統合した結果を確認できるようにする。
import { resolve } from "node:path";
import type { Config } from "./config.ts";
import { expressionRules } from "./expressions.ts";
import { RULE_NAMES, resolveRules } from "./textlint.ts";

const list = (values: readonly string[]) => (values.length > 0 ? values.join("、") : "なし");

export function describe(config: Config, file: string): string {
  const applies = (value: boolean) => (value ? "適用する" : "適用しない");
  return [
    ...describeFile(config, file),
    "",
    "Claude の返答のチェック（replies）:",
    `  japanese（大部分が英語の返答の検出）: ${applies(config.replies.japanese)}`,
  ].join("\n");
}

function describeFile(config: Config, file: string): string[] {
  const lines: string[] = [];
  lines.push("読み込んだ設定ファイル（後のファイルの指定を優先）:");
  if (config.paths.length === 0) {
    lines.push("  なし（組み込みのデフォルトを使用）");
  }
  for (const path of config.paths) {
    lines.push(`  ${path}`);
  }
  lines.push("", `${resolve(file)} に適用する設定:`);
  if (config.excludes(file)) {
    lines.push("  exclude に一致するため、チェックしません。");
    return lines;
  }
  const applied = config.expressionRulesFor(file);
  // 設定で指定する id と、内容を示す日本語の名前を併記する
  const labels = (isApplied: boolean) =>
    expressionRules()
      .filter(({ id }) => applied.includes(id) === isApplied)
      .map(({ id, name }) => `${id}（${name}）`);
  lines.push(
    "  表現のルール:",
    `    適用するルール: ${list(labels(true))}`,
    `    適用しないルール: ${list(labels(false))}${reason(config.expressions, file, applied.length === 0)}`,
    `  追加のルールセット: ${list(config.ruleSetsFor(file).map(({ name }) => name))}`,
  );
  if (!config.appliesTextlintTo(file)) {
    lines.push(`  textlint: 適用しません${reason(config.textlint, file, true)}`);
    return lines;
  }
  const rules = resolveRules(config.textlint.items);
  const off = RULE_NAMES.filter((name) => rules[name] === false);
  const options = Object.entries(config.textlint.items).filter(
    ([, value]) => typeof value === "object",
  );
  lines.push(
    "  textlint:",
    `    適用するルール: ${list(RULE_NAMES.filter((name) => !off.includes(name)))}`,
    `    適用しないルール: ${list(off)}`,
  );
  for (const [name, value] of options) {
    lines.push(`    オプション: ${name} = ${JSON.stringify(value)}`);
  }
  return lines;
}

/** 組み込みのルールを適用しない理由 */
function reason(builtIn: Config["expressions"], file: string, notApplied: boolean): string {
  if (!notApplied) {
    return "";
  }
  if (!builtIn.enabled) {
    return "（enabled = false）";
  }
  if (!builtIn.filter.accepts(file)) {
    const { include, exclude } = builtIn.filter;
    return `（include: ${list(include?.patterns ?? ["すべてのファイル"])}、exclude: ${list(exclude.patterns)}）`;
  }
  return "";
}
