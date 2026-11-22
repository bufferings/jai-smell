#!/bin/sh
# jai-smell の Claude Code プラグインのフック（hooks.json の PostToolUse と Stop）から実行する。
# 処理はすべて `jai-smell hook` が行い、このスクリプトは stdin をそのまま引き渡す。
# 検出結果は、stdout の JSON で Claude にフィードバックされるため、終了コードと出力は変更せずに返す。
# jai-smell が PATH に存在しない場合は、Claude Code の処理を妨げないよう、何もせずに終了する。

if ! command -v jai-smell >/dev/null 2>&1; then
    exit 0
fi

# /jai-smell-off で、このセッションのチェックを停止している場合は、何もせずに終了する。
# 停止を示すファイルは、Mod（status.ts）が作成する。
if [ -n "${CLAUDE_PLUGIN_DATA:-}" ] && [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] &&
    [ -e "$CLAUDE_PLUGIN_DATA/off/$CLAUDE_CODE_SESSION_ID" ]; then
    exit 0
fi

exec jai-smell hook
