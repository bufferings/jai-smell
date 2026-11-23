# 開発の手順

jai-smell の変更とリリースの手順を記載する。

## セットアップ

Bun のバージョンは `.bun-version` で固定している。依存関係は、次のコマンドでインストールする。

```sh
bun install --frozen-lockfile
```

## チェックのコマンド

```sh
bun run check              # フォーマット、lint、型チェック
bun test                   # テスト
bun run build              # dist/jai-smell をビルドする
sh scripts/smoke-test.sh   # バイナリが node_modules を参照せずに動作することを確認する
bun run notices            # THIRD-PARTY-NOTICES.txt を再生成する
```

依存関係を変更した場合は、`bun run notices` を実行し、再生成した `THIRD-PARTY-NOTICES.txt` をコミットに含める。CI は、再生成した結果とコミット済みのファイルに差分がある場合に失敗する。

`patches/` には、依存するパッケージに適用するパッチを配置している。`bun install` が、`package.json` の `patchedDependencies` に従って適用する。パッチの対象のパッケージを更新する場合は、修正が更新後のバージョンに含まれているかを確認し、含まれている場合はパッチを削除する。

| パッチ | 内容 |
| --- | --- |
| `textlint-rule-ja-no-redundant-expression@4.0.2.patch` | 表現のマッチを段落ごとに初期化する。適用しない場合は、段落の末尾の「することができる」と、次の段落の先頭の単語を、1 つの表現として検出する |

## 変更の手順

main への変更は、すべてプルリクエストでマージする。main に直接コミットしない。リリースのバージョンの更新と、ドキュメントだけの変更も、同じ手順に従う。CI はプルリクエストごとに実行されるため、この手順では、CI に成功したコミットだけが main にマージされる。

GitHub の ruleset `protect-main`（対象はデフォルトブランチ）で、この手順を強制している。ルールは次のとおりである。バイパスできる対象を指定していないため、管理者にも適用される。

- マージの前に、プルリクエストを必須とする。必要な承認の数は 0 である
- マージの前に、CI の `test` ジョブの成功を必須とする
- 強制プッシュと、ブランチの削除を禁止する

1. main からブランチを作成する。1 つのブランチには、1 つの目的の変更だけを含める
2. 変更し、「チェックのコマンド」の `bun run check`、`bun test`、`bun run build`、`sh scripts/smoke-test.sh` が成功することを確認する
3. コミットする。コミットメッセージは日本語で記述し、変更の内容と理由を記述する
4. ブランチをプッシュし、プルリクエストを作成する。タイトルと本文は日本語で記述する。本文には、変更の概要、動作の変更、実施した確認を記述する。出力の比較や計測を実施した場合は、その結果も記述する
5. CI（`.github/workflows/ci.yml`）の成功を確認する
6. マージコミットを作成する方法でマージし、リモートとローカルのブランチを削除する

コミットメッセージとプルリクエストを日本語で記述する理由は、変更の内容に日本語の表現とその判断の理由が含まれ、README とリリースノートも日本語のためである。

コミット、プッシュ、マージは、リポジトリの所有者が承認した場合に実行する。リポジトリは公開されており、プッシュした内容は公開される。

## リリースの手順

1. バージョンを更新するプルリクエストを作成する。`package.json` の `version` と、`plugin/.claude-plugin/plugin.json` の `version` を、同じ番号に更新する。コミットメッセージは、タグのメッセージと同じ `Release X.Y.Z` とする。Claude Code は、プラグインのバージョンが変更されない場合に、キャッシュしたプラグインを使用するため、プラグインを変更していないリリースでも両方を更新する
2. プルリクエストの差分、コミットメッセージ、前のタグからのコミットに、個人の情報が含まれていないことを確認する
3. 「変更の手順」に従ってマージする
4. マージ後の main に、注釈付きのタグ `vX.Y.Z` を作成してプッシュする。`.github/workflows/release.yml` が、タグと `package.json` の `version` の一致を確認し、テストとビルドを実行して、`jai-smell-X.Y.Z-arm64.tar.gz` を添付した下書きのリリースを作成する

   ```sh
   git tag -a vX.Y.Z -m "Release X.Y.Z"
   git push origin vX.Y.Z
   ```

5. 下書きのリリースの tar.gz をダウンロードし、バイナリの動作を確認する
6. 下書きのリリースノートを記述する。`## 変更` の見出しの下に、利用者に関係する変更を記述する。互換性のない変更は、ここに記述する。`## アップデートの方法` の見出しの下に、アップデートのコマンドを記述する
7. リリースを公開する。公開すると、`.github/workflows/bump-formula.yml` が `bufferings/homebrew-tap` の formula を更新する

   ```sh
   gh release edit vX.Y.Z --draft=false --latest
   ```

8. Homebrew でアップデートし、インストールされたバージョンと、formula のテストを確認する

   ```sh
   brew upgrade bufferings/tap/jai-smell
   jai-smell --version
   brew test bufferings/tap/jai-smell
   ```

GitHub の ruleset `protect-release-tags` で、`v` で始まるタグの削除と更新を禁止している。公開したリリースのタグが、配布した tar.gz と異なるコミットを指さないようにするためである。誤ったタグをプッシュした場合は、ruleset を一時的に無効にして削除する。

`release.yml` を手動（workflow_dispatch）で実行すると、下書きのリリースを作成せずに、tar.gz をワークフローの成果物としてアップロードする。タグをプッシュする前に、リリースの処理を確認する場合に使用する。
