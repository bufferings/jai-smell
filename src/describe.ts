// `jai-smell config <file>`: ファイルに適用する設定の出力。
//
// 設定は複数の設定ファイルを統合した結果のため、読み込んだ設定ファイルと、統合した結果を確認できるようにする。
import { resolve } from "node:path";
import type { Config } from "./config.ts";
import { presetRuleSets } from "./preset.ts";
import { RULE_NAMES, resolveRules } from "./textlint.ts";

const list = (values: readonly string[]) => (values.length > 0 ? values.join("、") : "なし");

export function describe(config: Config, file: string): string {
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
    return lines.join("\n");
  }
  const preset = config.presetRuleSetsFor(file);
  const disabled = presetRuleSets()
    .map(({ name }) => name)
    .filter((name) => !preset.includes(name));
  lines.push(
    "  プリセット:",
    `    適用するルールセット: ${list(preset)}`,
    `    適用しないルールセット: ${list(disabled)}${reason(config.preset, file, preset.length === 0)}`,
    `  追加のルールセット: ${list(config.ruleSetsFor(file).map(({ name }) => name))}`,
  );
  if (!config.appliesTextlintTo(file)) {
    lines.push(`  textlint: 適用しません${reason(config.textlint, file, true)}`);
    return lines.join("\n");
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
  return lines.join("\n");
}

/** 組み込みのルールを適用しない理由 */
function reason(builtIn: Config["preset"], file: string, notApplied: boolean): string {
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
