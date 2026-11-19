// THIRD-PARTY-NOTICES.txt を生成する。次のコマンドで実行する。
//   bun run notices
// CI では再生成し、コミット済みのファイルとの差分がないことを確認する。
//
// package.json の dependencies から依存関係を取得し、バイナリに含まれる可能性のあるパッケージを列挙する。
// パッケージごとに、ライセンスと、同梱されている LICENSE と NOTICE のファイルの内容を出力する。
// devDependencies は、バイナリに含まれないため対象外とする。
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// npm のパッケージ以外の記載（Bun の実行環境、IPADIC、プリセットの記述で参考にしたプロジェクト）。
// scripts/licenses/ には、取得したライセンスのファイルを変更せずに配置している。
// 取得元は、Bun のリポジトリ（.bun-version のバージョンのタグ）と、Bun が使用する WebKit のリポジトリである。
// Bun のバージョンを変更した場合は、再度取得する。
const license = (name: string) =>
  readFileSync(join(import.meta.dir, "licenses", name), "utf8")
    .replace(/\r\n?/g, "\n")
    .trim();
const HEADER = readFileSync(join(import.meta.dir, "notices-header.txt"), "utf8")
  .replace("{{BUN_LICENSE}}", () => license("bun-LICENSE.md"))
  .replace("{{JAVASCRIPTCORE_LICENSE}}", () => license("JavaScriptCore-COPYING.LIB.txt"));

type Manifest = {
  name: string;
  version: string;
  license?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const readManifest = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;

/** from のディレクトリから上位に向かって、node_modules 内のパッケージを探索する */
function resolvePackage(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    if (dir === ROOT || dir === dirname(dir)) {
      return undefined;
    }
  }
}

const packages = new Map<string, { dir: string; manifest: Manifest }>();
const queue = Object.keys(readManifest(ROOT).dependencies ?? {}).map((name) => ({
  name,
  from: ROOT,
}));
for (let item = queue.shift(); item; item = queue.shift()) {
  const dir = resolvePackage(item.name, item.from);
  if (dir === undefined) {
    // optionalDependencies は、インストールされていない場合がある
    continue;
  }
  const manifest = readManifest(dir);
  const key = `${manifest.name}@${manifest.version}`;
  if (packages.has(key)) {
    continue;
  }
  packages.set(key, { dir, manifest });
  for (const name of Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  })) {
    queue.push({ name, from: dir });
  }
}

const sections = [...packages.entries()]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([key, { dir, manifest }]) => {
    const files = readdirSync(dir)
      .filter((file) => /^(licen[sc]e|notice|copying)/i.test(file))
      .sort();
    const license =
      typeof manifest.license === "string" ? manifest.license : JSON.stringify(manifest.license);
    const texts = files.map((file) =>
      // 改行コードの違いで差分が発生しないように、LF に統一する
      readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n").trim(),
    );
    if (texts.length === 0) {
      texts.push("(The package does not include a license file.)");
    }
    return [
      "===========================================================================",
      key,
      `License: ${license ?? "(not specified in package.json)"}`,
      "===========================================================================",
      "",
      texts.join(
        "\n\n---------------------------------------------------------------------------\n\n",
      ),
      "",
    ].join("\n");
  });

writeFileSync(join(ROOT, "THIRD-PARTY-NOTICES.txt"), `${HEADER}\n${sections.join("\n")}`);
console.log(
  `${packages.size} 件のパッケージのライセンスを THIRD-PARTY-NOTICES.txt に出力しました。`,
);
