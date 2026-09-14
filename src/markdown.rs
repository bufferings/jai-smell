//! Markdown から、チェックの対象とする文の範囲を抽出する。

use std::ops::Range;

use pulldown_cmark::{Event, LinkType, Options, Parser, Tag, TagEnd};

/// 本文の範囲をバイト位置で返す。コードブロック、インラインコード、HTML、リンクの URL は含めない。
/// 連続するテキストと改行は 1 つの範囲にまとめ、強調やリンクの境界で分割する。
pub fn text_ranges(source: &str) -> Vec<Range<usize>> {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS;
    let mut ranges: Vec<Range<usize>> = Vec::new();
    let mut in_code_block = false;
    // <https://...> の自動リンクは表示テキストが URL と同一のため、チェックの対象外とする
    let mut in_autolink = false;
    // 直前のイベントがテキストまたは改行であり、次のテキストを同じ範囲に連結できる状態
    let mut joinable = false;
    for (event, range) in Parser::new_ext(source, options).into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(_)) => in_code_block = true,
            Event::End(TagEnd::CodeBlock) => in_code_block = false,
            Event::Start(Tag::Link {
                link_type: LinkType::Autolink | LinkType::Email,
                ..
            }) => in_autolink = true,
            Event::End(TagEnd::Link) => in_autolink = false,
            Event::Text(_) if !in_code_block && !in_autolink => {
                match ranges.last_mut() {
                    Some(last) if joinable => last.end = range.end,
                    _ => ranges.push(range),
                }
                joinable = true;
                continue;
            }
            Event::SoftBreak | Event::HardBreak if joinable => continue,
            _ => {}
        }
        joinable = false;
    }
    ranges
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(source: &str) -> Vec<&str> {
        text_ranges(source)
            .into_iter()
            .map(|r| &source[r])
            .collect()
    }

    #[test]
    fn skips_code() {
        let source = "本文`インライン`本文\n\n```rust\nブロック\n```\n\n    インデント\n";
        assert_eq!(texts(source), ["本文", "本文"]);
    }

    #[test]
    fn skips_html_and_urls() {
        let source = "<div>ブロック</div>\n\n前<span>インライン</span>後\n\n[リンク](https://example.com/道 \"題\") <https://example.com/道>\n";
        // インラインの HTML はタグのみを除外し、タグで囲まれた文は対象とする（textlint の Markdown の扱いと同じ）
        assert_eq!(texts(source), ["前", "インライン", "後", "リンク", " "]);
    }

    #[test]
    fn joins_lines_of_a_paragraph() {
        let source = "# 見出し\n\n一行目\n二行目  \n三行目\n\n- 項目\n";
        assert_eq!(
            texts(source),
            ["見出し", "一行目\n二行目  \n三行目", "項目"]
        );
    }

    #[test]
    fn splits_at_emphasis() {
        assert_eq!(texts("前*強調*後"), ["前", "強調", "後"]);
    }
}
