import { expect, test } from "bun:test";
import { parseEntries } from "../src/dictionary.ts";

const entries = (toml: string) =>
  parseEntries((Bun.TOML.parse(toml) as { entries: unknown }).entries);

test("文字列と配列の条件を読み込む", () => {
  const [entry] = entries(
    '[[entries]]\nmessage = "m"\ntokens = [{ pos = "動詞", surface_form = ["a", "b"] }]',
  );
  expect(entry?.tokens[0]).toEqual({ pos: "動詞", surface_form: ["a", "b"] });
});

test("不明なフィールドはエラーにする", () => {
  const cases = [
    '[[entries]]\nmessage = "m"\nexpected = "e"\ntokens = [{ pos = "名詞" }]',
    '[[entries]]\nmessage = "m"\ntokens = [{ basic_fom = "名詞" }]',
  ];
  for (const text of cases) {
    expect(() => entries(text)).toThrow("不明なフィールド");
  }
});

test("どの形態素にも一致しない条件と、すべての形態素に一致する条件はエラーにする", () => {
  const cases = [
    "tokens = []",
    "tokens = [{}]",
    "tokens = [{ pos = [] }]",
    "tokens = [{ pos = 1 }]",
  ];
  for (const tokens of cases) {
    expect(() => entries(`[[entries]]\nmessage = "m"\n${tokens}`)).toThrow();
  }
});
