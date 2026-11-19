# jai-smell

Claude Code が作成した日本語の文章から、修正を検討すべき表現を検出するツールです。Claude Code のフックとして動作し、ファイルの編集内容をチェックして、検出結果を Claude にフィードバックします。Claude はフィードバックの内容に基づいて、該当箇所を修正します。

プラグインには、日本語の文章規範も含まれています。Claude の返答に適用する出力スタイル `japanese-replies` と、技術文書の作成・推敲に使用するスキル `japanese-tech-writing` です。

jai-smell が提供するプリセットには、次の 4 つのルールセットを収録しています。プリセットはバイナリに含まれており、`jai-smell preset` で内容を出力できます。

- 不自然な日本語化：英語の表現を日本語に置き換えた不自然な表現（`既定では`、`走る` など）
- 比喩：物事を別のものにたとえた表現（`落とし穴`、`土台` など）
- 話し言葉：文書では用いない話し言葉（`見る`、`使う` など）
- 技術文書で一般的ではない用語：他の分野の用語のうち、技術文書には適さない表現（`地の文` など）

文章を形態素解析（[kuromoji](https://github.com/takuyaa/kuromoji.js) と IPADIC）によって分割した後に条件と比較するため、たとえば `穴` を検出対象に設定しても、`落とし穴` は検出されません。

ルールセットに加えて、[textlint](https://textlint.org/) のルール（[textlint-rule-preset-ja-technical-writing](https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing)）も、設定で有効にすると適用できます。同じ助詞の重複、1 文の長さ、読点の数、二重否定などを検出します。textlint とルールは jai-smell のバイナリに含まれているため、Node.js と textlint のインストールは不要です。

ファイルの編集に対するフィードバックの例を示します。

```
修正を検討すべき表現の候補を検出しました。チェック対象は今回の編集で追加・変更された部分のみです（行番号はその部分の中での位置を示します）。各箇所を確認し、該当する場合のみ修正してください。
docs/ci.md:3:12: "走る" は、英語の表現を日本語に置き換えた不自然な表現です。定着したカタカナ語や一般的な表現に言い換えてください。例: 「実行される」「動作する」。例が文脈に適さない場合は、例を使用せずに文の構成を見直してください。
docs/ci.md:5:11: "見る" は、文書では用いない話し言葉です。文脈に応じて、「確認する」「参照する」「対象とする」などの書き言葉に言い換えてください。
```

## 参考にした情報源

プリセットは、次の情報源を参考に作成しています。

- [p1ass/textlint-rule-preset-ai-words-ja](https://github.com/p1ass/textlint-rule-preset-ai-words-ja)（MIT License）
  - 「不自然な日本語化」と「比喩」の多くの項目と、その条件の記述は、このプリセットの辞書を元にしています。プリセットでは、該当する項目に「出典: p1ass」と記載しています。 <!-- jai-smell-disable-next-line 変わった -->
- [生成AI以前と以後でエンジニアの文章はどう変わったのか: Qiitaの7万記事を数えてみた話](https://nyosegawa.com/posts/qiita-writing-before-after-ai/)（逆瀬川ちゃんのブログ）
  - p1ass/textlint-rule-preset-ai-words-ja の辞書の元になった分析です。

プラグインの出力スタイルとスキルは、次の文書を元に、jai-smell の方針（技術文書で一般的な表現、日本語ドキュメントの訳語）に合わせて調整しています。

- [japanese-tech-writing/SKILL](https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d)（k16shikano 氏、Unlicense）

textlint のルールは、次のプロジェクトのものを変更せずに使用しています。

- [textlint](https://github.com/textlint/textlint)（MIT License）
- [textlint-ja/textlint-rule-preset-ja-technical-writing](https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing)（MIT License）

## 動作環境

- macOS（Apple Silicon）。ビルド済みバイナリは、この環境向けのみ提供しています。その他の環境では、ソースからビルドしてください。
- バイナリのサイズは約 106 MB です。JavaScript の実行環境（Bun）、textlint とルール、形態素解析の辞書を含みます。
- フックとして利用する場合は、[Claude Code](https://docs.claude.com/ja/docs/claude-code/overview) が必要です。

## インストール

### Homebrew

```sh
brew install bufferings/tap/jai-smell
jai-smell init
```

`jai-smell init` は、次の処理を実行します。

- `~/.config/jai-smell/` に、次の 2 つの設定ファイルを作成します。すでに存在する場合は変更しません。
  - `jai-smell.toml`：ユーザー全体の設定。設定の説明と記述例をコメントとして記載しています。
  - `custom-rules.toml`：利用者が追加するルールセット。
- Claude Code のプラグイン `jai-smell@jai-smell` をインストールします。`claude` コマンドが見つからない場合は、インストール手順を表示します。

設定ファイルがなくても、プリセットは適用されます。設定を変更しない場合は、プラグインのインストールのみが必要です。Homebrew の formula はインストール時にホームディレクトリへ書き込めないため、`brew install` の後に `jai-smell init` を実行してください。起動中の Claude Code のセッションには、次回の起動時から反映されます。

### ソースからのインストール

[Bun](https://bun.com/) が必要です。ビルドしたバイナリ（`dist/jai-smell`）を、PATH に含まれるディレクトリへ配置します。

```sh
git clone https://github.com/bufferings/jai-smell
cd jai-smell
bun install --frozen-lockfile
bun run build
cp dist/jai-smell ~/.local/bin/
jai-smell init
```

### プラグインの手動インストール

`jai-smell init` を使用しない場合は、次のコマンドでプラグインをインストールします。

```sh
claude plugin marketplace add bufferings/jai-smell
claude plugin install jai-smell@jai-smell
```

プラグインは、Claude Code がファイルを編集した際（Write、Edit、MultiEdit）に、`jai-smell hook` を実行します。`jai-smell` が PATH に存在しない場合は、何も実行しません。プラグインに含まれる出力スタイルとスキルについては、[出力スタイルとスキルを使用する](#出力スタイルとスキルを使用する)を参照してください。

### アップデート

```sh
brew upgrade jai-smell
claude plugin marketplace update jai-smell
claude plugin update jai-smell@jai-smell
```

- プリセットと textlint のルールはバイナリに含まれているため、`brew upgrade` で更新されます。検出結果は、ルールの追加や変更によって、アップグレードの前後で異なる場合があります。
- プラグインは `brew upgrade` ではアップデートされないため、`claude plugin` コマンドでアップデートしてください。

## 使い方

### Claude Code のフックとして使用する

インストール後の設定は不要です。

- Claude Code がファイルを編集するたびに（PostToolUse フック）、その編集で追加・変更された部分のみをチェックします。編集前からファイルに存在していた文章は、チェックの対象外です。
- 検出した場合は、終了コード 2 で終了し、検出結果を Claude にフィードバックします。
- Claude の返答はチェックしません。返答の表現は、プラグインに含まれる出力スタイル `japanese-replies` で指示します。

設定ファイルの読み込みに失敗した場合など、jai-smell 自体の処理が失敗した場合は、終了コード 1 で終了します。この場合、Claude へのフィードバックは行わず、Claude の処理も中断しません。

### 出力スタイルとスキルを使用する

プラグインには、次の文章規範が含まれています。`jai-smell` コマンドがインストールされていなくても使用できます。

| 種類 | 名前 | 内容 |
| --- | --- | --- |
| 出力スタイル | `japanese-replies` | Claude の返答に適用する規範。結論を先に述べ、技術文書で一般的な表現で記述するよう指示します |
| スキル | `japanese-tech-writing` | 日本語の技術文書を作成・推敲するときの規範。段落と論証の構成、用語と表現、翻訳調の比喩と擬人化の禁止などを定めます |

**出力スタイル**

- 自動では適用されません。`/config` を実行し、**Output style** で `japanese-replies` を選択してください。選択内容は `.claude/settings.local.json` に保存されます。
- `keep-coding-instructions: true` を指定しているため、Claude Code の組み込みのソフトウェアエンジニアリングの指示は保持されます。
- 指示はすべてのリクエストで送信されるため、その分のトークンを消費します。

**スキル**

- 日本語の技術文書を作成・推敲する際に、Claude が必要に応じて読み込みます。
- 明示的に使用する場合は、`/jai-smell:japanese-tech-writing` を実行します。

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

`--config <path>` を指定すると、ユーザー全体の設定と上位のディレクトリの `jai-smell.toml` を読み込まず、指定したファイルのみを組み込みのデフォルトと統合して使用します。

その他のコマンドは、次のとおりです。

| コマンド | 内容 |
| --- | --- |
| `jai-smell config <file>` | 読み込んだ設定ファイルと、ファイルに適用する設定を出力します |
| `jai-smell preset` | プリセットの内容を出力します |
| `jai-smell init` | 設定ファイルのひな形を作成し、Claude Code のプラグインをインストールします |

### チェック対象

- `.md` ファイルは、Markdown として解析します。コードブロック、インラインコード、HTML、リンクの URL はチェックの対象外です。
- その他のファイル（`.ts` など）は、プレーンテキストとしてファイル全体をチェックします。コード中の日本語のコメントや文字列リテラルもチェックの対象です。
- プリセットと追加のルールセットは、デフォルトではすべてのファイルに適用します。
- textlint のルールは、設定で有効にした場合のみ適用します。適用するファイルのデフォルトは、`.md` と `.txt` です。
- 設定の `exclude` に一致するファイルと、読み込んだ設定ファイルおよび `rule_files` に指定したファイル自体は、チェックの対象外です。

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

textlint のルールの検出結果は、ルールの名前で指定します。ルールの名前は、検出結果の末尾に `（textlint: max-ten）` の形式で出力されます。

```markdown
<!-- jai-smell-disable-next-line max-ten -->
この機能は、利用者が、設定を、変更した、場合に、再起動します。
```

- 除外のコメントを記述した行自体も、チェックの対象外です。
- フックでは、編集後のファイル全体から除外のコメントを読み込みます。

## 設定

設定ファイルがない場合は、組み込みのデフォルトを使用します。

| チェック | デフォルト |
| --- | --- |
| プリセット | すべてのファイルに、すべてのルールセットを適用します |
| textlint のルール | 適用しません。[textlint](#textlint) の `enabled` に `true` を指定した場合に適用します |

デフォルトを変更する場合と、ルールセットを追加する場合に、設定ファイルを作成します。

### 設定ファイルの配置と優先順位

設定ファイルは、次の場所に配置できます。

| 配置場所 | 用途 |
| --- | --- |
| `~/.config/jai-smell/jai-smell.toml` | ユーザー全体の設定。すべてのファイルに適用します。`jai-smell init` で作成できます |
| リポジトリのルート、またはその下位のディレクトリの `jai-smell.toml` | そのディレクトリ以下のファイルに適用する設定 |

設定は、組み込みのデフォルト、ユーザー全体の設定、上位のディレクトリの `jai-smell.toml`、下位のディレクトリの `jai-smell.toml` の順に統合します。同じ項目を複数の設定ファイルに記述した場合は、チェック対象のファイルに近い設定ファイルの指定を優先します。

```
~/.config/jai-smell/jai-smell.toml   # すべてのファイルに適用
repo/jai-smell.toml                  # repo 以下のファイルに適用
repo/docs/blog/jai-smell.toml        # repo/docs/blog 以下のファイルに適用
```

項目の種類によって、統合の方法が異なります。

| 項目 | 統合の方法 |
| --- | --- |
| `exclude` | すべての設定ファイルの指定を合わせて適用します |
| `rule_sets`、`rule_files` | すべての設定ファイルのルールセットを追加します |
| `preset`、`textlint` | キーごと、およびルールセットとルールの名前ごとに、チェック対象のファイルに近い設定ファイルの値を使用します |

`jai-smell.toml` の探索は、チェック対象のファイルのディレクトリから上位に向かって行い、`.git` があるディレクトリで停止します。リポジトリの外にある `jai-smell.toml` は読み込みません。リポジトリ内に作成した worktree では、元のリポジトリの `jai-smell.toml` も読み込みません。Git リポジトリの外のファイルでは、ホームディレクトリの手前で停止します。ホームディレクトリの直下の `jai-smell.toml` は読み込まないため、すべてのファイルに適用する設定は、ユーザー全体の設定に記述してください。

`--config <path>` を指定した場合は、ユーザー全体の設定と上位のディレクトリの `jai-smell.toml` を読み込まず、指定したファイルのみを組み込みのデフォルトと統合します。

### 適用される設定の確認

`jai-smell config <file>` は、読み込んだ設定ファイルと、そのファイルに適用する設定を出力します。

```
$ jai-smell config docs/blog/post.md
読み込んだ設定ファイル（後のファイルの指定を優先）:
  /Users/example/.config/jai-smell/custom-rules.toml
  /Users/example/.config/jai-smell/jai-smell.toml
  /Users/example/src/repo/jai-smell.toml
  /Users/example/src/repo/docs/blog/jai-smell.toml

/Users/example/src/repo/docs/blog/post.md に適用する設定:
  プリセット:
    適用するルールセット: 不自然な日本語化、比喩、技術文書で一般的ではない用語
    適用しないルールセット: 話し言葉
  追加のルールセット: 表記の統一
  textlint:
    適用するルール: sentence-length、max-comma、…
    適用しないルール: no-mix-dearu-desumasu
    オプション: sentence-length = {"max":150}
```

### glob の形式

`exclude` と `include` には、ファイルを glob で指定します。

- 絶対パス、`~/` から始まるパス、相対パスで指定できます。
- 相対パスは、ユーザー全体の設定では `/` を、その他の `jai-smell.toml` ではその設定ファイルのディレクトリを基準とします。ユーザー全体の設定の `**/*.md` は、すべてのディレクトリの `.md` ファイルに一致します。
- `*` はディレクトリの区切りをまたがず、`**` はまたぎます。

### exclude

チェックの対象外とするファイルを指定します。一致するファイルには、プリセット、追加のルールセット、textlint のルールのいずれも適用しません。

```toml
exclude = ["tests/**", "vendor/**"]
```

- すべての設定ファイルの `exclude` を合わせて適用します。上位のディレクトリの設定ファイルやユーザー全体の設定で対象外としたファイルを、下位のディレクトリの設定ファイルで対象に戻すことはできません。
- 一部のチェックのみを対象外とする場合は、`preset`、`textlint`、またはルールセットの `exclude` を使用します。

### preset

プリセットの設定を指定します。

```toml
[preset]
include = ["**/*.md"]

[preset.rule_sets]
"比喩" = false
```

| フィールド | 内容 |
| --- | --- |
| `enabled` | `false` を指定すると、プリセットを適用しません |
| `include` | プリセットを適用するファイル。省略した場合は、すべてのファイルに適用します。空の配列は指定できません |
| `exclude` | プリセットのみ対象外とするファイル |
| `rule_sets` | プリセットのルールセットの名前ごとの設定。`false` を指定したルールセットは適用しません |

- どのフィールドも、チェック対象のファイルに近い設定ファイルの値を使用します。`include` と `exclude` は、配列全体を置き換えます。
- 上位のディレクトリの設定ファイルで `enabled = false` または `"比喩" = false` を指定した場合も、下位のディレクトリの設定ファイルで `true` を指定すると、再度適用できます。
- プリセットの個別のルールを適用しない場合は、[除外のコメント](#除外のコメント)を使用します。
- プリセットのルールを変更して使用する場合は、該当するルールセットを `jai-smell preset` の出力から `custom-rules.toml` へコピーして変更します。あわせて、プリセットのルールセットに `false` を指定します。

### rule_files

追加するルールセットを記述したファイルを指定します。`jai-smell init` が作成する `jai-smell.toml` には、次のように記述されています。

```toml
rule_files = ["custom-rules.toml"]
```

- 絶対パス、`~/` から始まるパス、設定ファイルのディレクトリからの相対パスで指定できます。
- 記述した順序で読み込みます。設定ファイルに直接記述した `rule_sets` は、その後に読み込みます。
- 指定したファイルには、`rule_sets` のみを記述できます。
- 複数の設定ファイルが同じファイルを指定した場合は、1 回のみ読み込みます。

### rule_sets

プリセットに追加する表現を、ルールセットとしてまとめて指定します。設定ファイル、または `rule_files` で指定したファイルに記述します。

```toml
[[rule_sets]]
name = "話し言葉"
include = ["docs/**", "README.md"]
exclude = ["docs/drafts/**"]

[[rule_sets.entries]]
message = "\"見る\" は、文書では用いない話し言葉です。文脈に応じて、「確認する」「参照する」「対象とする」などの書き言葉に言い換えてください。"
tokens = [{ pos = "動詞", pos_detail_1 = "自立", basic_form = "見る" }]
```

| フィールド | 内容 |
| --- | --- |
| `name` | ルールセットの名前。設定ファイルのエラーメッセージに表示します |
| `include` | このルールセットを適用するファイル。省略した場合は、すべてのファイルに適用します |
| `exclude` | このルールセットのみ対象外とするファイル |
| `entries` | 検出する表現 |

- すべての設定ファイルのルールセットを追加します。上位のディレクトリの設定ファイルやユーザー全体の設定のルールセットを、下位のディレクトリの設定ファイルで適用しないようにする手段はありません。
- `rule_files` に指定したファイルのルールセットの相対パスの glob は、指定した設定ファイルと同じ基準を使用します。
- 同じ位置で同じメッセージの検出結果は、1 件にまとめて出力します。

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

### textlint

textlint のルール（`textlint-rule-preset-ja-technical-writing`）の設定を指定します。textlint のルールは、`enabled` に `true` を指定した場合にのみ適用します。文体の好みに依存するルールを含むことと、文章ではない `.txt` のファイルでも検出することが理由です。

```toml
[textlint]
enabled = true
```

適用するファイルとルールを変更する場合は、次のように記述します。

```toml
[textlint]
enabled = true
include = ["**/*.md", "**/*.txt", "**/*.mdx"]

[textlint.rules]
sentence-length = { max = 120 }
no-exclamation-question-mark = false
no-mix-dearu-desumasu = true
```

| フィールド | 内容 |
| --- | --- |
| `enabled` | `true` を指定すると、textlint のルールを適用します。デフォルトは `false` です |
| `include` | textlint のルールを適用するファイル。省略した場合は、`.md` と `.txt` のファイルに適用します。空の配列は指定できません |
| `exclude` | textlint のルールのみ対象外とするファイル |
| `rules` | ルールの名前ごとの設定。`false` を指定したルールは適用しません。`true` を指定したルールは、ルールのデフォルトのオプションで適用します。テーブルを指定した場合は、ルールのオプションとして使用します |

- どのフィールドも、チェック対象のファイルに近い設定ファイルの値を使用します。`include` と `exclude` は配列全体を、`rules` のオプションはルールごとにテーブル全体を置き換えます。
- `include` を記述した場合は、デフォルトの `.md` と `.txt` に代えて使用します。`.md` 以外のファイルは、プレーンテキストとして処理します。
- `no-mix-dearu-desumasu`（「である」調と「ですます」調の統一）は、`true` またはオプションを指定した場合にのみ適用します。統一する文体は文書によって異なるためです。
- ルールの名前とオプションは、[textlint-rule-preset-ja-technical-writing の README](https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing#readme) を参照してください。
- ルールは文章を対象としているため、ソースコードに適用すると、コードの記述も検出されます。
- 使用できるルールは、バイナリに含まれているものに限られます。textlint の他のルールは追加できません。

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

- バイナリに含まれる Bun の実行環境と、Bun が静的にリンクしている JavaScriptCore と WebKit（LGPL-2）。変更した JavaScriptCore を使用して jai-smell をビルドする方法も記載しています
- バイナリに含まれる IPADIC
- バイナリに含まれる npm のパッケージ（textlint、textlint のルール、kuromoji など）
- プリセットの記述にあたって参考にした [p1ass/textlint-rule-preset-ai-words-ja](https://github.com/p1ass/textlint-rule-preset-ai-words-ja)
