import { expect, test } from "bun:test";
import { parseEntries } from "../src/dictionary.ts";
import { find, tokenize } from "../src/matcher.ts";

const KIKU = `
[[entries]]
message = "効く"
tokens = [{ pos = "動詞", pos_detail_1 = "自立", basic_form = "効く" }]
`;
const HASHIRU = `
[[entries]]
message = "走る"
tokens = [
  { pos = "動詞", pos_detail_1 = "自立", surface_form = ["走る", "走っ", "走り", "走ら", "走れ", "走ろ"] },
]
`;
const NI_OCHIRU = `
[[entries]]
message = "に落ちる"
tokens = [
  { pos = "助詞", pos_detail_1 = "格助詞", surface_form = "に" },
  { pos = "動詞", pos_detail_1 = "自立", basic_form = "落ちる" },
]
`;
const ANA = `
[[entries]]
message = "穴"
tokens = [{ pos = "名詞", basic_form = "穴" }]
`;

/** 一致した位置を、テキスト内の文字列として返す */
async function hits(dictionary: string, text: string): Promise<string[]> {
  const entries = parseEntries((Bun.TOML.parse(dictionary) as { entries: unknown }).entries);
  return find(entries, await tokenize(text)).map(
    (hit) => `${hit.entry.message}@${text.slice(hit.start)}`,
  );
}

test("活用形に一致する", async () => {
  expect(await hits(KIKU, "キャッシュが効きます")).toEqual(["効く@効きます"]);
  expect(await hits(KIKU, "薬が効かない")).toEqual(["効く@効かない"]);
  expect(await hits(HASHIRU, "ジョブが走った")).toEqual(["走る@走った"]);
});

test("対象ではない用法は検出しない", async () => {
  expect(await hits(HASHIRU, "自走するロボット")).toEqual([]);
  expect(await hits(NI_OCHIRU, "階段から落ちた")).toEqual([]);
  expect(await hits(ANA, "落とし穴に注意")).toEqual([]);
  expect(await hits(ANA, "設計に穴がある")).toEqual(["穴@穴がある"]);
});

test("配列の条件は、いずれかの値に一致する", async () => {
  const dictionary = '[[entries]]\nmessage = "m"\ntokens = [{ basic_form = ["穴", "見張る"] }]';
  expect(await hits(dictionary, "穴を見張る")).toEqual(["m@穴を見張る", "m@見張る"]);
});

test("条件の並びは、連続する形態素に一致する", async () => {
  expect(await hits(NI_OCHIRU, "キャッシュがないとフォールバックに落ちる")).toEqual([
    "に落ちる@に落ちる",
  ]);
  expect(await hits(NI_OCHIRU, "に階段から落ちる")).toEqual([]);
});

test("複数の entry の結果を、出現位置の順に返す", async () => {
  expect(await hits(`${ANA}\n${KIKU}`, "よく効くが穴もある")).toEqual([
    "効く@効くが穴もある",
    "穴@穴もある",
  ]);
});

test("空白をはさんだ形態素を、連続する並びとして比較する", async () => {
  const dictionary =
    '[[entries]]\nmessage = "m"\ntokens = [{ surface_form = "CI" }, { surface_form = "が" }]';
  expect(await hits(dictionary, "CI が走る")).toEqual(["m@CI が走る"]);
});

test("サロゲートペアの後の位置を、UTF-16 の位置で返す", async () => {
  expect(await hits(ANA, "𠮷野家の設計に穴がある")).toEqual(["穴@穴がある"]);
});
