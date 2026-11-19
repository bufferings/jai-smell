#!/bin/sh
# ビルドしたバイナリ（dist/jai-smell）が、node_modules を参照せずに単体で動作することを確認する。
#
# kuromoji の辞書などの実行時に読み込むファイルがバイナリに埋め込まれていない場合、バイナリはビルドした環境の
# node_modules を参照するため、ビルドした環境では動作し、配布先では起動に失敗する。
# node_modules を一時的に別の名前に変更した状態で実行し、この誤りをリリース前に検出する。
set -eu

cd "$(dirname "$0")/.."
root="$PWD"
binary="$root/dist/jai-smell"
work="$(mktemp -d)"

mv "$root/node_modules" "$root/node_modules.smoke-test"
trap 'mv "$root/node_modules.smoke-test" "$root/node_modules"; rm -rf "$work"' EXIT

# プリセットと textlint のルールの両方を実行する。プリセットは、設定に記述しなくても適用される
printf '[textlint]\nenabled = true\n' > "$work/jai-smell.toml"
printf 'これは、長い、文で、読点が、多い、文です。\n\nログを見張る。\n' > "$work/a.md"

cd "$work"
status=0
actual="$(env -i HOME="$work" PATH=/usr/bin:/bin "$binary" a.md)" || status=$?
# メッセージの文言の変更で失敗しないように、位置と、ルールを識別できる部分のみを比較する
positions="$(printf '%s\n' "$actual" | sed 's/^\(a\.md:[0-9]*:[0-9]*\): .*/\1/')"
expected='a.md:1:14
a.md:3:4'

if [ "$status" -ne 1 ] || [ "$positions" != "$expected" ] ||
    ! printf '%s\n' "$actual" | grep -q 'textlint: max-ten' ||
    ! printf '%s\n' "$actual" | grep -q '"見張る"'; then
    echo "バイナリの動作が想定と異なります（終了コード: ${status}）" >&2
    echo "$actual" >&2
    exit 1
fi
echo "バイナリの動作を確認しました。"
