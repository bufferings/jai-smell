// 設定ファイルの include と exclude に記述する glob の比較。
//
// 記号の意味は、次のとおりである。
//   - **: ディレクトリの区切りを含む文字に一致する
//   - * と ?: ディレクトリの区切り以外の文字に一致する
//   - [...]: 文字の集合
//   - {a,b}: 選択
//   - \: 次の文字のエスケープ
// ファイル名の先頭の . も、他の文字と同様に扱う。

/** glob の記号をエスケープし、リテラルとして扱う文字列を返す */
export function escapeGlob(literal: string): string {
  return literal.replace(/[\\*?[\]{}]/g, "\\$&");
}

/** glob を、パス全体と比較する正規表現に変換する */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  let braces = 0;
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i] as string;
    if (char === "\\") {
      const next = pattern[i + 1];
      if (next === undefined) {
        throw new Error("\\ の後に文字がありません");
      }
      source += escapeRegExp(next);
      i += 2;
    } else if (char === "*") {
      if (pattern[i + 1] === "*") {
        const atStart = i === 0 || pattern[i - 1] === "/";
        const rest = pattern.slice(i + 2);
        if (!atStart || (rest !== "" && !rest.startsWith("/"))) {
          throw new Error("** は、パスの 1 つの要素として記述してください");
        }
        if (rest === "") {
          source += ".*";
          i += 2;
        } else {
          // 「**/」は、0 個以上のディレクトリに一致する
          source += "(?:.*/)?";
          i += 3;
        }
      } else {
        source += "[^/]*";
        i += 1;
      }
    } else if (char === "?") {
      source += "[^/]";
      i += 1;
    } else if (char === "[") {
      const close = pattern.indexOf("]", i + 2);
      if (close === -1) {
        throw new Error("[ に対応する ] がありません");
      }
      let body = pattern.slice(i + 1, close);
      const negated = body.startsWith("!") || body.startsWith("^");
      if (negated) {
        body = body.slice(1);
      }
      source += `[${negated ? "^" : ""}${body.replace(/[\\\]^]/g, "\\$&")}]`;
      i = close + 1;
    } else if (char === "{") {
      braces += 1;
      source += "(?:";
      i += 1;
    } else if (char === "}" && braces > 0) {
      braces -= 1;
      source += ")";
      i += 1;
    } else if (char === "," && braces > 0) {
      source += "|";
      i += 1;
    } else {
      source += escapeRegExp(char);
      i += 1;
    }
  }
  if (braces > 0) {
    throw new Error("{ に対応する } がありません");
  }
  return new RegExp(`^${source}$`, "u");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
