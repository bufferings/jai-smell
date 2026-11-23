import { expect, test } from "bun:test";
import { covers, parse } from "../src/suppress.ts";

/** target が出現する位置ごとに、除外の範囲に含まれるかどうかを返す */
function covered(text: string, target: string, ruleName?: string): boolean[] {
  const suppressions = parse(text);
  const result: boolean[] = [];
  for (let i = text.indexOf(target); i !== -1; i = text.indexOf(target, i + 1)) {
    result.push(covers(suppressions, text, i, ruleName));
  }
  return result;
}

test("次の行を対象外とする", () => {
  const text = "見る\n<!-- jai-smell-disable-next-line -->\n見る\n見る\n";
  expect(covered(text, "見る")).toEqual([false, true, false]);
});

test("指定した表記のみを対象外とする", () => {
  const text = "// jai-smell-disable-next-line 変わった、使う\n変わった。見る。使う。\n";
  expect(covered(text, "変わった")).toEqual([true, true]);
  expect(covered(text, "使う")).toEqual([true, true]);
  expect(covered(text, "見る")).toEqual([false]);
});

test("jai-smell-enable またはテキストの末尾までの範囲を対象外とする", () => {
  const text =
    "見る\n# jai-smell-disable\n見る\n# jai-smell-enable\n見る\n# jai-smell-disable\n見る\n";
  expect(covered(text, "見る")).toEqual([false, true, false, true]);
});

test("ファイル全体を対象外とする", () => {
  const text = "見る\n/* jai-smell-disable-file 見る */\n使う\n見る";
  expect(covered(text, "見る")).toEqual([true, true, true]);
  expect(covered(text, "使う")).toEqual([false]);
});

test("除外のコメントに類似した文字列は、除外のコメントとして扱わない", () => {
  const text = "jai-smell-disabled\n見る\n`jai-smell-disable-next-line` の説明\n見る\n";
  expect(covered(text, "見る")).toEqual([false, false]);
});

test("textlint のルールの検出結果は、ルールの名前で対象外とする", () => {
  const text = "<!-- jai-smell-disable-next-line max-ten -->\n一、二、三、四、五。\n";
  expect(covered(text, "一", "max-ten")).toEqual([true]);
  expect(covered(text, "一", "max-comma")).toEqual([false]);
  expect(covered(text, "一")).toEqual([false]);
});
