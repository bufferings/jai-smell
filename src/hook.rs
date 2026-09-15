//! Claude Code の PostToolUse フックの入力（JSON）から、今回の編集で追加・変更された部分を抽出する。

use serde::Deserialize;

#[derive(Deserialize)]
struct Input {
    tool_input: Option<ToolInput>,
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

/// ファイルの編集で追加・変更された部分。MultiEdit では編集ごとに分かれる
#[derive(Debug, PartialEq)]
pub struct Target {
    pub file_path: String,
    pub parts: Vec<String>,
}

/// 追加・変更された部分がない場合は None を返す
pub fn target(input: &str) -> Result<Option<Target>, String> {
    let input: Input = serde_json::from_str(input)
        .map_err(|e| format!("フックの入力を JSON として解析できません: {e}"))?;
    let Some(ToolInput {
        file_path: Some(file_path),
        content,
        new_string,
        edits,
    }) = input.tool_input
    else {
        return Ok(None);
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
        return Ok(None);
    }
    Ok(Some(Target { file_path, parts }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(input: &str) -> Option<String> {
        target(input)
            .unwrap()
            .map(|target| target.parts.join("\n\n"))
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

    /// 0.1.0 のプラグインは Stop フックでも jai-smell hook を実行するため、Stop の入力では何もしない
    #[test]
    fn ignores_stop_input_from_older_plugin() {
        assert_eq!(
            text(
                r#"{ "hook_event_name": "Stop", "cwd": "/work", "stop_hook_active": false, "last_assistant_message": "返答" }"#
            ),
            None
        );
    }

    #[test]
    fn rejects_invalid_json() {
        assert!(target("not json").is_err());
    }
}
