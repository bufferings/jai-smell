# jai-smell

Claude Code が作成した日本語の文章から、修正を検討すべき表現を検出するツールです。Claude Code のフックとして動作し、ファイルの編集内容と Claude の返答をチェックして、検出結果を Claude にフィードバックします。Claude はフィードバックの内容に基づいて、該当箇所を修正します。

設定ファイルのサンプルには、次の 3 つのルールセットを収録しています。

- 不自然な日本語化：英語の表現を日本語に置き換えた不自然な表現（`既定では`、`走る` など）
- 比喩：物事を別のものにたとえた表現（`落とし穴`、`土台` など）
- 話し言葉：文書では用いない話し言葉（`見る`、`使う` など）

文章を形態素解析（[Lindera](https://github.com/lindera/lindera) と IPADIC）で分割したうえで条件と比較するため、たとえば `穴` を検出対象に設定しても、`落とし穴` は検出されません。

ファイルの編集に対するフィードバックの例:

```
修正を検討すべき表現の候補を検出しました。チェック対象は今回の編集で追加・変更された部分のみです（行番号はその部分の中での位置を示します）。各箇所を確認し、該当する場合のみ修正してください。
docs/ci.md:3:12: "走る" は、英語の表現を日本語に置き換えた不自然な表現です。定着したカタカナ語や一般的な表現に言い換えてください。例: 「実行される」「動作する」。例が文脈に適さない場合は、例を使用せずに文の構成を見直してください。
docs/ci.md:5:11: "見る" は、文書では用いない話し言葉です。文脈に応じて、「確認する」「参照する」「対象とする」などの書き言葉に言い換えてください。
```

## 参考にした情報源

設定ファイルのサンプルは、次の情報源を参考に作成しています。

- [p1ass/textlint-rule-preset-ai-words-ja](https://github.com/p1ass/textlint-rule-preset-ai-words-ja)（MIT License）
  - 「不自然な日本語化」と「比喩」の多くの項目と、その条件の記述は、このプリセットの辞書を元にしています。サンプルでは、該当する項目に「出典: p1ass」と記載しています。 <!-- jai-smell-disable-next-line 変わった -->
- [生成AI以前と以後でエンジニアの文章はどう変わったのか: Qiitaの7万記事を数えてみた話](https://nyosegawa.com/posts/qiita-writing-before-after-ai/)（逆瀬川ちゃんのブログ）
  - p1ass/textlint-rule-preset-ai-words-ja の辞書の元になった分析です。

## 動作環境

- macOS（Apple Silicon）。ビルド済みバイナリは、この環境向けのみ提供しています。その他の環境では、ソースからビルドしてください。
- フックとして利用する場合は、[Claude Code](https://docs.claude.com/ja/docs/claude-code/overview) が必要です。

## インストール

### Homebrew

```sh
brew install bufferings/tap/jai-smell
jai-smell init
```

`jai-smell init` は、次の処理を実行します。

- `~/.config/jai-smell/jai-smell.toml` が存在しない場合は、設定ファイルのサンプルを作成します。すでに存在する場合は変更しません。
- Claude Code のプラグイン `jai-smell@jai-smell` をインストールします。`claude` コマンドが見つからない場合は、インストール手順を表示します。

Homebrew の formula はインストール時にホームディレクトリへ書き込めないため、`brew install` の後に `jai-smell init` を実行してください。起動中の Claude Code のセッションには、次回の起動時から反映されます。

### ソースからのインストール

Rust のツールチェーンが必要です。

```sh
cargo install --git https://github.com/bufferings/jai-smell
jai-smell init
```

### プラグインの手動インストール

`jai-smell init` を使用しない場合は、次のコマンドでプラグインをインストールします。

```sh
claude plugin marketplace add bufferings/jai-smell
claude plugin install jai-smell@jai-smell
```

プラグインは、Claude Code がファイルを編集した際（Write、Edit、MultiEdit）と、Claude の返答が完了した際に、`jai-smell hook` を実行します。`jai-smell` が PATH に存在しない場合は、何も実行しません。

### アップデート

```sh
brew upgrade jai-smell
claude plugin marketplace update jai-smell
claude plugin update jai-smell@jai-smell
```

プラグインは `brew upgrade` ではアップデートされないため、`claude plugin` コマンドでアップデートしてください。

## 使い方

### Claude Code のフックとして使用する

インストール後の設定は不要です。

**ファイルの編集（PostToolUse フック）**

- Claude Code がファイルを編集するたびに、その編集で追加・変更された部分のみをチェックします。編集前からファイルに存在していた文章は、チェックの対象外です。
- 検出した場合は、終了コード 2 で終了し、検出結果を Claude にフィードバックします。

**Claude の返答（Stop フック）**

- Claude の返答が完了するたびに、そのターンの最後の返答をチェックします。ツールの実行前に出力された途中の返答は、チェックの対象外です。
- 検出した場合は、検出結果を `additionalContext` として Claude にフィードバックします。元の返答はすでに表示されているため、Claude は修正後の文章を続けて出力します。
- フィードバックを受けて出力された返答は、フィードバックの繰り返しを防ぐため、チェックしません。
- 設定ファイルは、Claude Code の作業ディレクトリから上位に向かって探索します。

設定ファイルの読み込みに失敗した場合など、jai-smell 自体の処理が失敗した場合は、終了コード 1 で終了します。この場合、Claude へのフィードバックは行わず、Claude の処理も中断しません。

### コマンドとして使用する

```sh
jai-smell docs/*.md
```

ファイル全体をチェックし、検出結果を `path:line:col: message` の形式で標準出力に出力します。終了コードは次のとおりです。

| 終了コード | 意味 |
| --- | --- |
| 0 | 検出なし |
| 1 | 検出あり |
| 2 | 読み込めないファイルがあった場合や、設定ファイルに誤りがある場合など |

`--config <path>` を指定すると、指定したファイルのみを設定として使用します。

### チェック対象

- `.md` ファイルと Claude の返答は、Markdown として解析します。コードブロック、インラインコード、HTML、リンクの URL はチェックの対象外です。
- その他のファイル（`.ts` など）は、プレーンテキストとしてファイル全体をチェックします。コード中の日本語のコメントや文字列リテラルもチェックの対象です。
- 設定の `exclude` に一致するファイル（`include` を指定した場合は、一致しないファイルも）と、読み込んだ設定ファイル自体は、チェックの対象外です。

### 除外のコメント

ファイル内に次の文字列を記述すると、その範囲の検出結果をチェックの対象外にできます。コメントの記法（`<!-- -->`、`//`、`#` など）は問いません。

| 記述 | 対象外とする範囲 |
| --- | --- |
| `jai-smell-disable-next-line` | 次の行 |
| `jai-smell-disable` と `jai-smell-enable` | 2 つのコメントのあいだの行。`jai-smell-enable` がない場合は、ファイルの末尾まで |
| `jai-smell-disable-file` | ファイル全体 |

コメントの後に文章中の表記を空白区切りで記述すると、その表記に一致する箇所のみを対象外にします。活用形が異なる場合は、それぞれの表記を記述してください。

```markdown
<!-- jai-smell-disable-next-line 変わった -->
生成AI以前と以後でエンジニアの文章はどう変わったのか
```

- 除外のコメントを記述した行自体も、チェックの対象外です。
- フックでは、編集後のファイル全体から除外のコメントを読み込みます。
- Claude の返答には適用されません。

## 設定

設定ファイルは、次の 2 か所に配置できます。

| 配置場所 | 用途 |
| --- | --- |
| `~/.config/jai-smell/jai-smell.toml` | ユーザー全体の設定。`jai-smell init` でサンプルを作成できます |
| チェック対象のファイルと同じディレクトリ、またはその上位ディレクトリの `jai-smell.toml` | プロジェクトごとの設定 |

チェック対象のファイルのディレクトリ（Claude の返答の場合は Claude Code の作業ディレクトリ）から上位に向かって探索し、最初に見つかった `jai-smell.toml` のルールセットを、ユーザー全体の設定のルールセットに追加します。どちらの設定ファイルも見つからない場合は、エラーになります。

設定ファイルのサンプルは、[examples/jai-smell.toml](examples/jai-smell.toml) を参照してください。

### include と exclude

チェックの対象とするファイル（`include`）と、対象外とするファイル（`exclude`）を glob で指定します。

```toml
include = ["docs/**", "README.md"]
exclude = ["docs/drafts/**"]
```

- `include` を省略した場合は、すべてのファイルが対象です。空の配列は指定できません。
- `exclude` は、`include` に一致するファイルにも優先して適用します。
- 絶対パス、`~/` から始まるパス、設定ファイルのディレクトリからの相対パスで指定できます。
- `*` はディレクトリの区切りをまたがず、`**` はまたぎます。
- Claude の返答には適用されません。

トップレベルの `include` と `exclude` は、記述した設定ファイルによって適用範囲が異なります。

| 記述した設定ファイル | 適用範囲 |
| --- | --- |
| ユーザー全体の設定 | ユーザー全体の設定のルールセットのみ |
| プロジェクトの設定 | ユーザー全体の設定のルールセットを含む、すべてのルールセット |

たとえば、ユーザー全体の設定に `exclude = ["~/src/team-project/**"]` を記述すると、そのプロジェクトではユーザー全体の設定のルールセットが適用されなくなります。プロジェクトの設定のルールセットは、引き続き適用されます。

### rule_sets

検出する表現を、ルールセットとしてまとめて指定します。

```toml
[[rule_sets]]
name = "話し言葉"
include = ["docs/**", "README.md"]
exclude = ["docs/drafts/**"]
conversation = true

[[rule_sets.entries]]
message = "\"見る\" は、文書では用いない話し言葉です。文脈に応じて、「確認する」「参照する」「対象とする」などの書き言葉に言い換えてください。"
tokens = [{ pos = "動詞", pos_detail_1 = "自立", basic_form = "見る" }]
```

| フィールド | 内容 |
| --- | --- |
| `name` | ルールセットの名前。設定ファイルのエラーメッセージに表示します |
| `include` | このルールセットを適用するファイル。形式はトップレベルの `include` と同じです。省略した場合は、すべてのファイルに適用します |
| `exclude` | このルールセットのみ対象外とするファイル。形式はトップレベルの `exclude` と同じです |
| `conversation` | Claude の返答に適用するかどうか。省略した場合は適用します |
| `entries` | 検出する表現 |

ルールセットは、適用範囲に含まれるトップレベルの `include` と `exclude`、およびルールセット自身の `include` と `exclude` の条件をすべて満たすファイルに適用します。

### entries

検出する表現を指定します。連続する形態素が `tokens` に指定した条件の並びと一致した場合に、`message` を出力します。

```toml
[[rule_sets.entries]]
message = "\"〜に落ちる\" は、英語の表現を日本語に置き換えた不自然な表現です。定着したカタカナ語や一般的な表現に言い換えてください。例: 「〜にフォールバックする」「代わりに〜を使用する」。例が文脈に適さない場合は、例を使用せずに文の構成を見直してください。"
# 「落ちる」のみを条件にすると「階段から落ちた」も検出されるため、直前の「に」を条件に含める
tokens = [
  { pos = "助詞", pos_detail_1 = "格助詞", surface_form = "に" },
  { pos = "動詞", pos_detail_1 = "自立", basic_form = "落ちる" },
]
```

条件には、IPADIC の次の項目を指定できます。フィールド名は kuromoji に準拠しています。

| フィールド | 項目 |
| --- | --- |
| `surface_form` | 表層形 |
| `pos` | 品詞 |
| `pos_detail_1`, `pos_detail_2`, `pos_detail_3` | 品詞細分類 1〜3 |
| `conjugated_type` | 活用型 |
| `conjugated_form` | 活用形 |
| `basic_form` | 基本形 |
| `reading` | 読み |
| `pronunciation` | 発音 |

- 1 つの条件に指定したすべてのフィールドが一致した場合に、その条件を満たします。
- 値には、文字列または文字列の配列を指定します。配列の場合は、いずれかの値に一致すれば条件を満たします。

## アンインストール

```sh
claude plugin uninstall jai-smell@jai-smell
claude plugin marketplace remove jai-smell
brew uninstall jai-smell
rm -r ~/.config/jai-smell
```

## ライセンス

MIT License です（[LICENSE](LICENSE)）。

次のライセンスは、[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) に記載しています。

- バイナリに含まれる IPADIC
- バイナリに含まれる Rust のクレート
- 設定ファイルのサンプルの記述にあたって参考にした [p1ass/textlint-rule-preset-ai-words-ja](https://github.com/p1ass/textlint-rule-preset-ai-words-ja)
