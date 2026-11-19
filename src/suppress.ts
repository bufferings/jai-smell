// 除外のコメントの解析。行内に次の文字列を記述すると、その範囲の検出結果をチェックの対象外とする。
//
// - jai-smell-disable-next-line: 次の行
// - jai-smell-disable と jai-smell-enable: 2 つのコメントのあいだの行（jai-smell-enable がない場合は、ファイルの末尾まで）
// - jai-smell-disable-file: ファイル全体
//
// コメントの後に空白区切りで表記を記述すると、その表記に一致する箇所のみを対象外とする。
// textlint のルールの検出結果は、ルールの名前で指定する。
// コメントの記法は問わない。除外のコメントを記述した行自体も、チェックの対象外とする。

type Marker = "next-line" | "file" | "disable" | "enable";

const MARKERS: [string, Marker][] = [
  ["jai-smell-disable-next-line", "next-line"],
  ["jai-smell-disable-file", "file"],
  ["jai-smell-enable", "enable"],
  ["jai-smell-disable", "disable"],
];

export type Suppression = {
  start: number;
  end: number;
  /** 空の場合は、範囲内のすべての検出結果を対象外とする */
  words: string[];
};

/** テキスト内の除外の範囲を返す */
export function parse(text: string): Suppression[] {
  const lines = lineRanges(text);
  const suppressions: Suppression[] = [];
  let opened: { start: number; words: string[] }[] = [];
  lines.forEach((line, i) => {
    const found = marker(text.slice(line.start, line.end));
    if (!found) {
      return;
    }
    suppressions.push({ ...line, words: [] });
    switch (found.marker) {
      case "next-line": {
        const next = lines[i + 1];
        if (next) {
          suppressions.push({ ...next, words: found.words });
        }
        break;
      }
      case "file":
        suppressions.push({ start: 0, end: text.length, words: found.words });
        break;
      case "disable":
        opened.push({ start: line.end, words: found.words });
        break;
      case "enable":
        for (const { start, words } of opened) {
          suppressions.push({ start, end: line.start, words });
        }
        opened = [];
        break;
    }
  });
  for (const { start, words } of opened) {
    suppressions.push({ start, end: text.length, words });
  }
  return suppressions;
}

/**
 * offset の位置の検出結果が、除外の範囲に含まれるかどうかを返す。
 * ruleName は、textlint のルールの検出結果の場合に指定する
 */
export function covers(
  suppressions: readonly Suppression[],
  text: string,
  offset: number,
  ruleName?: string,
): boolean {
  return suppressions.some(({ start, end, words }) => {
    if (offset < start || offset >= end) {
      return false;
    }
    if (words.length === 0) {
      return true;
    }
    if (ruleName !== undefined && words.includes(ruleName)) {
      return true;
    }
    const range = text.slice(start, end);
    return words.some((word) => {
      for (let i = range.indexOf(word); i !== -1; i = range.indexOf(word, i + 1)) {
        if (offset >= start + i && offset < start + i + word.length) {
          return true;
        }
      }
      return false;
    });
  });
}

/** 行内の除外のコメントと、その後に記述された表記を返す */
function marker(line: string): { marker: Marker; words: string[] } | undefined {
  const index = line.indexOf("jai-smell-");
  if (index === -1) {
    return undefined;
  }
  const rest = line.slice(index);
  for (const [name, found] of MARKERS) {
    if (!rest.startsWith(name)) {
      continue;
    }
    const after = rest.slice(name.length);
    // 「jai-smell-disabled」や、バッククォートで囲まれた言及は、除外のコメントとして扱わない
    const boundary =
      after === "" || /^\s/.test(after) || after.startsWith("-->") || after.startsWith("*/");
    if (!boundary) {
      continue;
    }
    const body = (after.split("-->")[0] ?? "").split("*/")[0] ?? "";
    const words = body.split(/[\s,、]+/).filter((word) => word !== "");
    return { marker: found, words };
  }
  return undefined;
}

/** 各行の範囲を、改行を含めて返す */
function lineRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", start)) {
    ranges.push({ start, end: i + 1 });
    start = i + 1;
  }
  if (start < text.length) {
    ranges.push({ start, end: text.length });
  }
  return ranges;
}
