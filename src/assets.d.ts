// バイナリに埋め込むファイル（with { type: "file" }）は、実行時のパスとしてインポートされる
declare module "*.dict" {
  const path: string;
  export default path;
}

// 型定義が同梱されていないため、利用する側（src/textlint.ts）で型を指定する
declare module "textlint-rule-ja-no-redundant-expression" {
  const rule: unknown;
  export default rule;
}

declare module "textlint-rule-max-comma" {
  const rule: unknown;
  export default rule;
}

declare module "textlint-rule-max-ten" {
  const rule: unknown;
  export default rule;
}

declare module "textlint-rule-no-double-negative-ja" {
  const rule: unknown;
  export default rule;
}

declare module "textlint-rule-no-doubled-conjunction" {
  const rule: unknown;
  export default rule;
}

declare module "textlint-rule-no-doubled-conjunctive-particle-ga" {
  const rule: unknown;
  export default rule;
}

declare module "textlint-rule-no-doubled-joshi" {
  const rule: unknown;
  export default rule;
}

declare module "textlint-rule-no-mix-dearu-desumasu" {
  const rule: unknown;
  export default rule;
}

declare module "@textlint-ja/textlint-rule-preset-ai-writing" {
  const preset: unknown;
  export default preset;
}
