//! Claude Code のフックの入力（JSON）から、チェック対象の文章を抽出する。
//! PostToolUse では今回の編集で追加・変更された部分、Stop では Claude の最後の返答を対象とする。

use serde::Deserialize;

#[derive(Deserialize)]
struct Input {
    hook_event_name: Option<String>,
    cwd: Option<String>,
    tool_input: Option<ToolInput>,
    /// Stop
    last_assistant_message: Option<String>,
    /// Stop。Stop フックのフィードバックによって Claude が継続している場合は true
    #[serde(default)]
    stop_hook_active: bool,
}

#[derive(Deserialize)]
struct ToolInput {
    file_path: Option<String>,
    /// Write
    content: Option<String>,
    /// Edit
    new_string: Option<String>,
    /// MultiEdit
    edits: Option<Vec<Edit>>,
}

#[derive(Deserialize)]
struct Edit {
    new_string: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum Target {
    /// ファイルの編集で追加・変更された部分。MultiEdit では編集ごとに分かれる
    Written {
        file_path: String,
        parts: Vec<String>,
    },
    /// Claude の返答。cwd は設定ファイルの探索の起点
    Reply { cwd: String, text: String },
}

/// チェック対象がない場合は None を返す
pub fn target(input: &str) -> Result<Option<Target>, String> {
    let input: Input = serde_json::from_str(input)
        .map_err(|e| format!("フックの入力を JSON として解析できません: {e}"))?;
    if input.hook_event_name.as_deref() == Some("Stop") {
        return Ok(reply(input));
    }
    Ok(written(input))
}

/// Stop フックのフィードバックによって継続した返答はチェックしない。修正後の返答に対して、フィードバックが繰り返されることを防ぐため
fn reply(input: Input) -> Option<Target> {
    if input.stop_hook_active {
        return None;
    }
    let text = input
        .last_assistant_message
        .filter(|text| !text.is_empty())?;
    let cwd = input.cwd.unwrap_or_else(|| ".".to_string());
    Some(Target::Reply { cwd, text })
}

/// 追加・変更された部分がない場合は None を返す
fn written(input: Input) -> Option<Target> {
    let Some(ToolInput {
        file_path: Some(file_path),
        content,
        new_string,
        edits,
    }) = input.tool_input
    else {
        return None;
    };
    let parts: Vec<String> = [content, new_string]
        .into_iter()
        .flatten()
        .chain(
            edits
                .into_iter()
                .flatten()
                .filter_map(|edit| edit.new_string),
        )
        .collect();
    if parts.iter().all(String::is_empty) {
        return None;
    }
    Some(Target::Written { file_path, parts })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(input: &str) -> Option<String> {
        target(input).unwrap().map(|target| match target {
            Target::Written { parts, .. } => parts.join("\n\n"),
            Target::Reply { text, .. } => text,
        })
    }

    #[test]
    fn takes_written_parts_of_each_tool() {
        assert_eq!(
            text(
                r#"{ "hook_event_name": "PostToolUse", "tool_name": "Write", "tool_input": { "file_path": "a.md", "content": "本文" } }"#
            ),
            Some("本文".into())
        );
        assert_eq!(
            text(
                r#"{ "tool_name": "Edit", "tool_input": { "file_path": "a.md", "old_string": "前", "new_string": "後" } }"#
            ),
            Some("後".into())
        );
        assert_eq!(
            text(
                r#"{ "tool_name": "MultiEdit", "tool_input": { "file_path": "a.md", "edits": [
                { "old_string": "1", "new_string": "一" },
                { "old_string": "2", "new_string": "二" }
            ] } }"#
            ),
            Some("一\n\n二".into())
        );
    }

    #[test]
    fn takes_last_reply_on_stop() {
        assert_eq!(
            target(
                r#"{ "hook_event_name": "Stop", "cwd": "/work", "stop_hook_active": false, "last_assistant_message": "返答" }"#
            )
            .unwrap(),
            Some(Target::Reply {
                cwd: "/work".into(),
                text: "返答".into()
            })
        );
    }

    #[test]
    fn skips_reply_continued_by_stop_hook_or_without_text() {
        assert_eq!(
            text(
                r#"{ "hook_event_name": "Stop", "cwd": "/work", "stop_hook_active": true, "last_assistant_message": "返答" }"#
            ),
            None
        );
        assert_eq!(
            text(r#"{ "hook_event_name": "Stop", "cwd": "/work", "stop_hook_active": false }"#),
            None
        );
    }

    #[test]
    fn returns_none_without_file_path_or_text() {
        assert_eq!(
            text(r#"{ "tool_name": "Bash", "tool_input": { "command": "ls" } }"#),
            None
        );
        assert_eq!(
            text(r#"{ "tool_input": { "file_path": "a.md", "new_string": "" } }"#),
            None
        );
        assert_eq!(text(r#"{}"#), None);
    }

    #[test]
    fn rejects_invalid_json() {
        assert!(target("not json").is_err());
    }
}
