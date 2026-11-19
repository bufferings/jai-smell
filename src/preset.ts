// jai-smell が提供するルールセット（プリセット）。config/preset-rules.toml の内容をバイナリに含める。
import presetText from "../config/preset-rules.toml" with { type: "text" };
import { type Entry, parseEntries } from "./dictionary.ts";

/** プリセットの内容（TOML）。`jai-smell preset` で出力する */
export const PRESET_TEXT = presetText as unknown as string;

export type PresetRuleSet = { name: string; entries: Entry[] };

let cache: PresetRuleSet[] | undefined;

/** プリセットのルールセット。定義順に返す */
export function presetRuleSets(): PresetRuleSet[] {
  cache ??= (
    Bun.TOML.parse(PRESET_TEXT) as { rule_sets: { name: string; entries: unknown }[] }
  ).rule_sets.map(({ name, entries }) => ({ name, entries: parseEntries(entries) }));
  return cache;
}
