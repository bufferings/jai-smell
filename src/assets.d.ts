// バイナリに埋め込むファイル（with { type: "file" }）は、実行時のパスとしてインポートされる
declare module "*.gz" {
  const path: string;
  export default path;
}

// 型定義が同梱されていないため、利用する側（src/textlint.ts）で型を指定する
declare module "textlint-rule-preset-ja-technical-writing" {
  const preset: unknown;
  export default preset;
}
