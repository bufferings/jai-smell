# jai-smell

Claude Code が作成した日本語の文章から、修正を検討すべき表現を検出するツールです。Claude Code のフックとして動作し、ファイルの編集内容をチェックして、検出結果を Claude にフィードバックします。Claude はフィードバックの内容に基づいて、該当箇所を修正します。

プラグインには、日本語の文章規範も含まれています。Claude の返答に適用する出力スタイル `japanese-replies` と、技術文書の作成・推敲に使用するスキル `japanese-tech-writing` です。検出する表現を追加する場合は、スキル `add-custom-rule` を使用できます。設定ファイルは、スキル `configure` で作成できます。

jai-smell は、次の 5 つの「表現のルール」を提供しています。表現のルールはバイナリに含まれており、`jai-smell expressions` で内容を出力できます。

| 名前 | 検出する表現 | デフォルト |
| --- | --- | --- |
| `translationese`（不自然な日本語化） | 英語の表現を日本語に置き換えた不自然な表現（`既定では`、`走る` など） | 適用します |
| `metaphor`（比喩） | 物事を別のものにたとえた表現（`落とし穴`、`土台` など） | 適用します |
| `unusual-terms`（技術文書で一般的ではない用語） | 他の分野の用語のうち、技術文書には適さない表現（`地の文` など） | 適用します |
| `colloquial`（話し言葉） | 文書では用いない話し言葉（`見る`、`使う` など） | 設定で有効にした場合に適用します |
| `prefer-hiragana`（漢字をひらく） | 漢字ではなく、ひらがなで記述する表記（`無い`、`紐づけ` など） | 設定で有効にした場合に適用します |

デフォルトで適用する 3 つは、AI が生成した文章に多い表現を対象としています。`colloquial` と `prefer-hiragana` は、文書を硬い文体と表記に統一するためのルールです。統一するかどうかは文書の方針によるため、[設定](#expressions)で有効にした場合にのみ適用します。

文章を形態素解析（[kuromoji](https://github.com/takuyaa/kuromoji.js) と IPADIC）によって分割した後に条件と比較するため、たとえば `穴` を検出対象に設定しても、`落とし穴` は検出されません。

表現のルールに加えて、[textlint](https://textlint.org/) のルールも、設定で有効にすると適用できます。textlint の次の 2 つのプリセットのルールを使用できます。

- [textlint-rule-preset-ja-technical-writing](https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing)：同じ助詞の重複、1 文の長さ、読点の数、二重否定などを検出します。
- [@textlint-ja/textlint-rule-preset-ai-writing](https://github.com/textlint-ja/textlint-rule-preset-ai-writing)：AI が生成した文章に多い記述を検出します。リスト項目の先頭の太字と絵文字、誇張表現、コロンで終わる文などが対象です。ルールごとに、設定で有効にした場合にのみ適用します。

textlint とルールは jai-smell のバイナリに含まれているため、Node.js と textlint のインストールは不要です。

ファイルの編集に対するフィードバックの例を示します。

```
修正を検討すべき表現の候補を検出しました。チェック対象は今回の編集で追加・変更された部分のみです（行番号はその部分の中での位置を示します）。各箇所を確認し、該当する場合のみ修正してください。
docs/ci.md:3:12: "走る" は、英語の表現を日本語に置き換えた不自然な表現です。定着したカタカナ語や一般的な表現に言い換えてください。例: 「実行される」「動作する」。例が文脈に適さない場合は、例を使用せずに文の構成を見直してください。
docs/ci.md:5:9: "落とし穴" は、物事を別のものにたとえた比喩的な表現です。比喩を使用せず、対象と状態を具体的に記述してください。例: 「注意点」「問題点」。例が文脈に適さない場合は、例を使用せずに文の構成を見直してください。
```

## 参考にした情報源

表現のルールは、次の情報源を参考に作成しています。

- [p1ass/textlint-rule-preset-ai-words-ja](https://github.com/p1ass/textlint-rule-preset-ai-words-ja)（MIT License）
  - 「不自然な日本語化」と「比喩」の多くの項目と、その条件の記述は、この textlint のプリセットの辞書を元にしています。表現のルールでは、該当する項目に「出典: p1ass」と記載しています。 <!-- jai-smell-disable-next-line 変わった -->
- [生成AI以前と以後でエンジニアの文章はどう変わったのか: Qiitaの7万記事を数えてみた話](https://nyosegawa.com/posts/qiita-writing-before-after-ai/)（逆瀬川ちゃんのブログ）
  - p1ass/textlint-rule-preset-ai-words-ja の辞書の元になった分析です。

プラグインの出力スタイルとスキルは、次の文書を元に、jai-smell の方針（技術文書で一般的な表現、日本語ドキュメントの訳語）に合わせて調整しています。

- [japanese-tech-writing/SKILL](https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d)（k16shikano 氏、Unlicense）

ソースコードのコメントと文字列リテラルの抽出には、[highlight.js](https://github.com/highlightjs/highlight.js)（BSD 3-Clause License）を使用しています。

textlint のルールは、次のプロジェクトのものを変更せずに使用しています。

- [textlint](https://github.com/textlint/textlint)（MIT License）
- [textlint-ja/textlint-rule-preset-ja-technical-writing](https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing)（MIT License）
- [textlint-ja/textlint-rule-preset-ai-writing](https://github.com/textlint-ja/textlint-rule-preset-ai-writing)（MIT License）

## 動作環境

- macOS（Apple Silicon）。ビルド済みバイナリは、この環境向けのみ提供しています。その他の環境では、ソースからビルドしてください。
- バイナリのサイズは約 114 MB です。JavaScript の実行環境（Bun）、textlint とルール、形態素解析の辞書を含みます。
- フックとして利用する場合は、[Claude Code](https://docs.claude.com/ja/docs/claude-code/overview) が必要です。

## インストール

### Homebrew

```sh
brew install bufferings/tap/jai-smell
jai-smell init
```

`jai-smell init` は、Claude Code のプラグイン `jai-smell@jai-smell` をインストールします。`claude` コマンドが見つからない場合は、インストール手順を表示します。Homebrew の formula はインストール時にホームディレクトリへ書き込めないため、`brew install` の後に実行してください。起動中の Claude Code のセッションには、次回の起動時から反映されます。

設定ファイルがない場合は、デフォルトの表現のルールをすべてのファイルに適用します。

検出する内容を変更する場合は、Claude Code でスキル `configure` を実行します。

```sh
claude "/jai-smell:configure"
```

Claude が、検出する内容の一覧（表現のルールと、textlint のルール）を提示します。利用者が選択した項目から、設定ファイルを作成します。設定ファイルを直接記述する場合は、[設定](#設定)を参照してください。

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

- 表現のルールと textlint のルールはバイナリに含まれているため、`brew upgrade` で更新されます。検出結果は、ルールの追加や変更によって、アップグレードの前後で異なる場合があります。
- プラグインは `brew upgrade` ではアップデートされないため、`claude plugin` コマンドでアップデートしてください。

## 使い方

### Claude Code のフックとして使用する

インストール後の設定は不要です。

- Claude Code がファイルを編集するたびに（PostToolUse フック）、その編集で追加・変更された部分のみをチェックします。編集前からファイルに存在していた文章は、チェックの対象外です。
- 検出した場合は、終了コード 2 で終了し、検出結果を Claude にフィードバックします。
- Claude の返答は、デフォルトではチェックしません。設定ファイルの [replies](#replies) で有効にすると、返答の終了時（Stop フック）にチェックします。返答の表現は、出力スタイル `japanese-replies` でも指示できます。

設定ファイルの読み込みに失敗した場合など、jai-smell 自体の処理が失敗した場合は、終了コード 1 で終了します。この場合、Claude へのフィードバックは行わず、Claude の処理も中断しません。

### 出力スタイルとスキルを使用する

プラグインには、次の出力スタイルとスキルが含まれています。`japanese-replies` と `japanese-tech-writing` は、`jai-smell` コマンドがインストールされていなくても使用できます。

| 種類 | 名前 | 内容 |
| --- | --- | --- |
| 出力スタイル | `japanese-replies` | Claude の返答に適用する規範。結論を先に述べ、技術文書で一般的な表現で記述するよう指示します |
| スキル | `japanese-tech-writing` | 日本語の技術文書を作成・推敲する際の規範。段落と論証の構成、用語と表現、翻訳調の比喩と擬人化の禁止などを定めます |
| スキル | `add-custom-rule` | 検出する表現のルールを `custom-rules.toml` に登録する手順。形態素の条件を `jai-smell` コマンドで検証し、jai-smell が提供する表現のルールとの重複を確認します |
| スキル | `configure` | 設定ファイル（`jai-smell.toml`）を作成・変更する手順。検出する内容の一覧から項目を選択し、利用者の文書での検出件数を確認して調整します |

**出力スタイル**

- 自動では適用されません。`/config` を実行し、**Output style** で `japanese-replies` を選択してください。選択内容は `.claude/settings.local.json` に保存されます。
- `keep-coding-instructions: true` を指定しているため、Claude Code の組み込みのソフトウェアエンジニアリングの指示は保持されます。
- 指示はすべてのリクエストで送信されるため、その分のトークンを消費します。

**スキル**

- `japanese-tech-writing` は、日本語の技術文書を作成・推敲する際に、Claude が自動で読み込みます。明示的に使用する場合は、`/jai-smell:japanese-tech-writing` を実行します。
- `add-custom-rule` は、検出する表現の追加を依頼した際に、Claude が自動で読み込みます。明示的に使用する場合は、`/jai-smell:add-custom-rule 検出する表現` を実行します。Claude は、検出すべき例文と検出してはならない例文を作成し、候補の条件を `jai-smell --config` で検証します。検証した条件は、`~/.config/jai-smell/custom-rules.toml` に登録します。
- `configure` は、jai-smell の設定を依頼した際に、Claude が自動で読み込みます。明示的に使用する場合は、`/jai-smell:configure` を実行します。Claude は、検出する内容の一覧（表現のルールと、textlint のルール）を、内容の説明と現在の設定とあわせて提示します。利用者が番号で選択した項目から、設定ファイルを作成します。その後に、利用者の文書での検出件数を提示し、件数の多い項目の扱いを質問します。

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
| `jai-smell expressions` | jai-smell が提供する、表現のルールの内容を出力します |
| `jai-smell init` | Claude Code のプラグインをインストールします |

### チェック対象

- `.md` ファイルは、Markdown として解析します。コードブロック、インラインコード、HTML、リンクの URL はチェックの対象外です。
- ソースコード（`.ts`、`.py`、`.rs` など）は、コメントと文字列リテラルをチェックします。詳細は[ソースコードのチェック](#ソースコードのチェック)を参照してください。
- その他のファイル（`.txt`、`.yml` など）は、プレーンテキストとしてファイル全体をチェックします。
- 表現のルールと追加のルールセットは、デフォルトではすべてのファイルに適用します。
- textlint のルールは、設定で有効にした場合のみ適用します。適用するファイルのデフォルトは、`.md` と `.txt` です。
- 設定の `exclude` に一致するファイルと、読み込んだ設定ファイルおよび `rule_files` に指定したファイル自体は、チェックの対象外です。

### ソースコードのチェック

ソースコードは、[highlight.js](https://highlightjs.org/) で構文を解析し、コメントと文字列リテラルを抽出してチェックします。識別子などのコードの記述と、文字列リテラルの中のコメントの記号（`"http://example.com"` の `//`）は、チェックの対象外です。

| 対象 | 表現のルールと追加のルールセット | textlint のルール |
| --- | --- | --- |
| コメント | 適用します | `include` にファイルを指定した場合に適用します |
| 文字列リテラル | 適用します | 適用しません。文の断片が多いためです |

- 言語は、拡張子から判定します。対応する言語は、highlight.js が対応する言語です。
- 連続する行コメントとブロックコメントは、コメントの記号（`//`、`*`、`#` など）を除いて、1 つの段落として扱います。同じ桁から始まる行は、折り返された文の続きとして連結します。箇条書きの項目と、字下げが異なる行は、別の文として扱います。
- コードと同じ行に記述されたコメントは、前後の行のコメントとは別の段落として扱います。
- フックでは、編集後のファイル全体からコメントを判定し、追加・変更された部分の検出結果のみを出力します。
- 文章またはデータを記述するファイル（`.txt`、`.yml`、`.toml`、`.json`、`.html` など）と、言語を判定できないファイルは、ファイル全体をチェックします。言語を判定できないファイルには、textlint のルールを適用しません。
- 言語によっては、コメントとして判定されない記述があります。たとえば、Python のドキュメント文字列は文字列リテラルとして扱い、Makefile のターゲットと同じ行のコメントは抽出しません。

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
| 表現のルール | すべてのファイルに適用します。`colloquial`（話し言葉）と `prefer-hiragana`（漢字をひらく）は、[expressions](#expressions) の `rules` に `true` を指定した場合に適用します |
| textlint のルール | 適用しません。[textlint](#textlint) の `enabled` に `true` を指定した場合に適用します |
| Claude の返答のチェック | 適用しません。[replies](#replies) の `japanese` または `check` に `true` を指定した場合に適用します |

デフォルトを変更する場合と、ルールセットを追加する場合に、設定ファイルを作成します。Claude Code では、スキル `configure` を使用すると、検出する内容の一覧から項目を選択して、設定ファイルを作成できます。

すべての項目を記述した例を示します。必要な項目だけを記述してください。各項目の詳細は、以降の節を参照してください。

```toml
# チェックの対象外とするファイル
exclude = ["**/CHANGELOG.md"]

# 追加するルールセットを記述したファイル
rule_files = ["custom-rules.toml"]

# 表現のルールの設定
[expressions]
enabled = true
include = ["**/*.md"]
exclude = ["docs/archive/**"]

[expressions.rules]
colloquial = true
metaphor = false

# textlint のルールの設定
[textlint]
enabled = true
include = ["**/*.md", "**/*.txt", "**/*.ts"]
exclude = ["docs/archive/**"]

[textlint.rules]
sentence-length = { max = 120 }
no-exclamation-question-mark = false
no-ai-list-formatting = true

# Claude の返答のチェックの設定
[replies]
japanese = true
check = true

# この設定ファイルに直接記述するルールセット
[[rule_sets]]
name = "表記の統一"

[[rule_sets.entries]]
message = "\"サーバ\" は、表記を統一するため、「サーバー」と記述してください。"
tokens = [{ pos = "名詞", surface_form = "サーバ" }]
```

### 設定ファイルの配置と優先順位

設定ファイルは、次の場所に配置できます。

| 配置場所 | 用途 |
| --- | --- |
| `~/.config/jai-smell/jai-smell.toml` | ユーザー全体の設定。すべてのファイルに適用します |
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
| `expressions`、`textlint` | キーごと、およびルールの名前ごとに、チェック対象のファイルに近い設定ファイルの値を使用します |
| `replies` | キーごとに、作業ディレクトリに近い設定ファイルの値を使用します |

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
  表現のルール:
    適用するルール: translationese（不自然な日本語化）、colloquial（話し言葉）、unusual-terms（技術文書で一般的ではない用語）
    適用しないルール: metaphor（比喩）、prefer-hiragana（漢字をひらく）
  追加のルールセット: 表記の統一
  textlint:
    適用するルール: sentence-length、max-comma、…
    適用しないルール: no-mix-dearu-desumasu
    オプション: sentence-length = {"max":150}

Claude の返答のチェック（replies）:
  japanese（日本語が含まれない返答の検出）: 適用しない
  check（表現のルール、追加のルールセット、textlint のルールの適用）: 適用しない
```

### glob の形式

`exclude` と `include` には、ファイルを glob で指定します。

- 絶対パス、`~/` から始まるパス、相対パスで指定できます。
- 相対パスは、ユーザー全体の設定では `/` を、その他の `jai-smell.toml` ではその設定ファイルのディレクトリを基準とします。ユーザー全体の設定の `**/*.md` は、すべてのディレクトリの `.md` ファイルに一致します。
- `*` はディレクトリの区切りをまたがず、`**` はまたぎます。

### exclude

チェックの対象外とするファイルを指定します。一致するファイルには、表現のルール、追加のルールセット、textlint のルールのいずれも適用しません。

```toml
exclude = ["tests/**", "vendor/**"]
```

- すべての設定ファイルの `exclude` を合わせて適用します。上位のディレクトリの設定ファイルやユーザー全体の設定で対象外としたファイルを、下位のディレクトリの設定ファイルで対象に戻すことはできません。
- 一部のチェックのみを対象外とする場合は、`expressions`、`textlint`、またはルールセットの `exclude` を使用します。

### expressions

jai-smell が提供する、表現のルールの設定を指定します。

```toml
[expressions]
include = ["**/*.md"]

[expressions.rules]
colloquial = true
prefer-hiragana = true
metaphor = false
```

| フィールド | 内容 |
| --- | --- |
| `enabled` | `false` を指定すると、表現のルールを適用しません |
| `include` | 表現のルールを適用するファイル。省略した場合は、すべてのファイルに適用します。空の配列は指定できません |
| `exclude` | 表現のルールのみ対象外とするファイル |
| `rules` | ルールの名前ごとの設定。`true` を指定したルールは適用し、`false` を指定したルールは適用しません。指定しない場合は、`colloquial` と `prefer-hiragana` を適用せず、その他のルールを適用します |

- どのフィールドも、チェック対象のファイルに近い設定ファイルの値を使用します。`include` と `exclude` は、配列全体を置き換えます。
- 上位のディレクトリの設定ファイルで `false` を指定した `enabled` とルールは、下位のディレクトリの設定ファイルで `true` を指定すると、再度適用できます。
- ルールの中の個別の表現を適用しない場合は、[除外のコメント](#除外のコメント)を使用します。
- ルールの内容を変更して使用する場合は、`jai-smell expressions` の出力から、該当するルールセットをコピーします。コピー先は、`rule_files` に指定したファイルです。あわせて、`rules` で元のルールに `false` を指定します。

### rule_files

追加するルールセットを記述したファイルを指定します。

```toml
rule_files = ["custom-rules.toml"]
```

- 絶対パス、`~/` から始まるパス、設定ファイルのディレクトリからの相対パスで指定できます。
- 記述した順序で読み込みます。設定ファイルに直接記述した `rule_sets` は、その後に読み込みます。
- 指定したファイルには、`rule_sets` のみを記述できます。
- 複数の設定ファイルが同じファイルを指定した場合は、1 回のみ読み込みます。
- Claude Code では、スキル `add-custom-rule` でルールを追加できます。スキルは、`~/.config/jai-smell/custom-rules.toml` にルールを登録し、ユーザー全体の設定の `rule_files` にこのファイルを追加します。

### rule_sets

jai-smell が提供する表現のルールに追加する表現を、ルールセットとしてまとめて指定します。設定ファイル、または `rule_files` で指定したファイルに記述します。

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

textlint のルールの設定を指定します。使用できるルールは、textlint の次の 2 つのプリセットのルールです。

- `textlint-rule-preset-ja-technical-writing`
- `@textlint-ja/textlint-rule-preset-ai-writing`

textlint のルールは、`enabled` に `true` を指定した場合にのみ適用します。文体の好みに依存するルールを含むことと、文章ではない `.txt` のファイルでも検出することが理由です。

```toml
[textlint]
enabled = true
```

適用するファイルとルールを変更する場合は、次のように記述します。

```toml
[textlint]
enabled = true
include = ["**/*.md", "**/*.txt", "**/*.ts", "**/*.py"]

[textlint.rules]
sentence-length = { max = 120 }
no-exclamation-question-mark = false
no-mix-dearu-desumasu = true
no-ai-list-formatting = true
no-ai-hype-expressions = { allows = ["完全に"] }
```

| フィールド | 内容 |
| --- | --- |
| `enabled` | `true` を指定すると、textlint のルールを適用します。デフォルトは `false` です |
| `include` | textlint のルールを適用するファイル。省略した場合は、`.md` と `.txt` のファイルに適用します。空の配列は指定できません |
| `exclude` | textlint のルールのみ対象外とするファイル |
| `rules` | ルールの名前ごとの設定。`false` を指定したルールは適用しません。`true` を指定したルールは、ルールのデフォルトのオプションで適用します。テーブルを指定した場合は、ルールのオプションとして使用します |

- どのフィールドも、チェック対象のファイルに近い設定ファイルの値を使用します。`include` と `exclude` は配列全体を、`rules` のオプションはルールごとにテーブル全体を置き換えます。
- `include` を記述した場合は、デフォルトの `.md` と `.txt` に代えて使用します。
- ソースコードを `include` に指定した場合は、コメントに適用します。文末の句点のルール（`ja-no-mixed-period`）は、`rules` に記述した場合にのみ、コメントに適用します。コメントでは、文末の句点を省略する書き方が一般的なためです。
- `no-mix-dearu-desumasu`（「である」調と「ですます」調の混在）は、`true` またはオプションを指定した場合にのみ適用します。`true` を指定した場合は、見出し、本文、箇条書きのそれぞれで、多いほうの文体に統一します（`preferInHeader = ""`、`preferInBody = ""`、`preferInList = ""`）。文体を固定する場合は、オプションに `"である"` または `"ですます"` を指定します。
- AI が生成した文章に多い記述のルールも、`true` またはオプションを指定した場合にのみ適用します。コードブロックの前のコロンや `- **項目**: 説明` の形式のリストなど、人間が記述した技術文書でも一般的な記述を多く検出するためです。対象は次の 5 件です。
  - `no-ai-list-formatting`
  - `no-ai-hype-expressions`
  - `no-ai-emphasis-patterns`
  - `ai-tech-writing-guideline`
  - `no-ai-colon-continuation`
- `ai-tech-writing-guideline` に `true` を指定した場合は、`enableDocumentAnalysis = false` と `disableConsistencyGuidance = true` を指定して適用します。文書全体の検出件数の集計は、特定の箇所の検出結果ではないため、出力しません。文体の混在は、`no-mix-dearu-desumasu` を有効にした場合にのみ検出します。
- 同じ箇所を 2 つのルールが検出する場合は、片方の検出結果のみを出力します。`することができます` は、`ja-no-redundant-expression` の検出結果を出力します。文末のコロンは、`no-ai-colon-continuation` の検出結果を出力します。`大幅に改善` などの定量化されていない表現は、`no-ai-hype-expressions` の検出結果を出力します。リスト項目の先頭の絵文字と太字は、`no-ai-list-formatting` の検出結果を出力します。
- ルールの名前とオプションは、[textlint-rule-preset-ja-technical-writing の README](https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing#readme) を参照してください。AI が生成した文章に多い記述のルールは、[@textlint-ja/textlint-rule-preset-ai-writing の README](https://github.com/textlint-ja/textlint-rule-preset-ai-writing#readme) を参照してください。ルールの名前は、プリセットの名前を付けずに記述します。
- 使用できるルールは、バイナリに含まれているものに限られます。textlint の他のルールは追加できません。

### replies

Claude Code が返答を終了した時点で（Stop フック）、返答の本文をチェックします。検出した場合は、終了コード 2 で終了し、Claude に返答の再出力を指示します。

```toml
[replies]
# 日本語が含まれない返答を検出し、日本語での再出力を指示する
japanese = true
# 返答に、表現のルール、追加のルールセット、textlint のルールを適用する
check = true
```

| キー | デフォルト | 内容 |
| --- | --- | --- |
| `japanese` | `false` | 本文に英字の単語があり、ひらがな、カタカナ、漢字がない返答を検出します。コードブロックとインラインコードは本文に含めないため、コードのみの返答は検出しません |
| `check` | `false` | 返答を Markdown として解析し、表現のルール、追加のルールセット、textlint のルールを適用します |

- 設定は、Claude Code の作業ディレクトリから探索した設定ファイルを使用します。`check` で適用するルールは、作業ディレクトリの Markdown のファイル（`reply.md`）に適用される設定と同じです。textlint のルールは、`textlint.enabled` が `true` の場合に適用します。
- チェックは、返答が表示された後に実行します。検出した場合は、元の返答、検出結果、再出力した返答の順に表示されます。
- 再出力した返答は、再度チェックしません。検出が続く場合に、返答の終了を妨げないためです。

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
- バイナリに含まれる npm のパッケージ（textlint、textlint のルール、kuromoji、highlight.js など）
- プリセットの記述にあたって参考にした [p1ass/textlint-rule-preset-ai-words-ja](https://github.com/p1ass/textlint-rule-preset-ai-words-ja)
