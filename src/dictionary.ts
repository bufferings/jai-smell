// 検出する表現（設定ファイルの entries）の定義と検証。

/** 条件に指定できるフィールド。IPADIC の項目で、フィールド名は kuromoji に準拠している */
export const TOKEN_FIELDS = [
  "surface_form",
  "pos",
  "pos_detail_1",
  "pos_detail_2",
  "pos_detail_3",
  "conjugated_type",
  "conjugated_form",
  "basic_form",
  "reading",
  "pronunciation",
] as const;

export type TokenField = (typeof TOKEN_FIELDS)[number];

/** 条件の値。配列の場合は、いずれかの値に一致すれば条件を満たす */
export type Condition = string | string[];

/** 1 つの形態素に対する条件。指定したすべてのフィールドが一致した場合に条件を満たす */
export type TokenPattern = Partial<Record<TokenField, Condition>>;

export type Entry = {
  message: string;
  /** 連続する形態素の並びと比較する条件 */
  tokens: TokenPattern[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 許可していないキーが含まれる場合は、エラーにする */
export function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `不明なフィールドです: ${key}（指定できるフィールド: ${allowed.join(", ")}）`,
      );
    }
  }
}

function parseCondition(value: unknown, where: string): Condition {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    if (value.length === 0) {
      throw new Error(`${where} に空の配列があります`);
    }
    return value;
  }
  throw new Error(`${where}: 条件の値には、文字列または文字列の配列を指定してください`);
}

/**
 * entries を検証する。形式が正しくても、どの形態素にも一致しない条件や、
 * すべての形態素に一致する条件はエラーにする
 */
export function parseEntries(value: unknown): Entry[] {
  if (!Array.isArray(value)) {
    throw new Error("entries には配列を指定してください");
  }
  return value.map((entry, i) => {
    const where = `entries[${i}]`;
    if (!isRecord(entry)) {
      throw new Error(`${where} にはテーブルを指定してください`);
    }
    try {
      rejectUnknownKeys(entry, ["message", "tokens"]);
    } catch (error) {
      throw new Error(`${where}: ${(error as Error).message}`);
    }
    if (typeof entry.message !== "string") {
      throw new Error(`${where} の message には文字列を指定してください`);
    }
    if (!Array.isArray(entry.tokens)) {
      throw new Error(`${where} の tokens には配列を指定してください`);
    }
    if (entry.tokens.length === 0) {
      throw new Error(`${where} の tokens が空です`);
    }
    const tokens = entry.tokens.map((token, j) => {
      const tokenWhere = `${where}.tokens[${j}]`;
      if (!isRecord(token)) {
        throw new Error(`${tokenWhere} にはテーブルを指定してください`);
      }
      try {
        rejectUnknownKeys(token, TOKEN_FIELDS);
      } catch (error) {
        throw new Error(`${tokenWhere}: ${(error as Error).message}`);
      }
      const pattern: TokenPattern = {};
      for (const field of TOKEN_FIELDS) {
        if (token[field] !== undefined) {
          pattern[field] = parseCondition(token[field], tokenWhere);
        }
      }
      if (Object.keys(pattern).length === 0) {
        throw new Error(`${tokenWhere} に条件がありません`);
      }
      return pattern;
    });
    return { message: entry.message, tokens };
  });
}
