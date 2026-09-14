//! 除外のコメントの解析。行内に次の文字列を記述すると、その範囲の検出結果をチェックの対象外とする。
//!
//! - jai-smell-disable-next-line: 次の行
//! - jai-smell-disable と jai-smell-enable: 2 つのコメントのあいだの行（jai-smell-enable がない場合は、ファイルの末尾まで）
//! - jai-smell-disable-file: ファイル全体
//!
//! コメントの後に空白区切りで表記を記述すると、その表記に一致する箇所のみを対象外とする。
//! コメントの記法は問わない。除外のコメントを記述した行自体も、チェックの対象外とする。

use std::ops::Range;

const NEXT_LINE: &str = "jai-smell-disable-next-line";
const FILE: &str = "jai-smell-disable-file";
const DISABLE: &str = "jai-smell-disable";
const ENABLE: &str = "jai-smell-enable";

enum Marker {
    NextLine,
    File,
    Disable,
    Enable,
}

pub struct Suppression {
    range: Range<usize>,
    /// 空の場合は、範囲内のすべての検出結果を対象外とする
    words: Vec<String>,
}

/// テキスト内の除外の範囲を、バイト位置で返す
pub fn parse(text: &str) -> Vec<Suppression> {
    let lines = line_ranges(text);
    let mut suppressions = Vec::new();
    let mut opened: Vec<(usize, Vec<String>)> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let Some((marker, words)) = marker(&text[line.clone()]) else {
            continue;
        };
        suppressions.push(Suppression {
            range: line.clone(),
            words: Vec::new(),
        });
        match marker {
            Marker::NextLine => {
                if let Some(next) = lines.get(i + 1) {
                    suppressions.push(Suppression {
                        range: next.clone(),
                        words,
                    });
                }
            }
            Marker::File => suppressions.push(Suppression {
                range: 0..text.len(),
                words,
            }),
            Marker::Disable => opened.push((line.end, words)),
            Marker::Enable => {
                for (start, words) in opened.drain(..) {
                    suppressions.push(Suppression {
                        range: start..line.start,
                        words,
                    });
                }
            }
        }
    }
    for (start, words) in opened {
        suppressions.push(Suppression {
            range: start..text.len(),
            words,
        });
    }
    suppressions
}

/// offset の位置の検出結果が、除外の範囲に含まれるかどうかを返す
pub fn covers(suppressions: &[Suppression], text: &str, offset: usize) -> bool {
    suppressions.iter().any(|suppression| {
        let range = &suppression.range;
        range.contains(&offset)
            && (suppression.words.is_empty()
                || suppression.words.iter().any(|word| {
                    text[range.clone()]
                        .match_indices(word.as_str())
                        .any(|(i, _)| {
                            (range.start + i..range.start + i + word.len()).contains(&offset)
                        })
                }))
    })
}

/// 行内の除外のコメントと、その後に記述された表記を返す
fn marker(line: &str) -> Option<(Marker, Vec<String>)> {
    let rest = &line[line.find("jai-smell-")?..];
    let markers = [
        (NEXT_LINE, Marker::NextLine),
        (FILE, Marker::File),
        (ENABLE, Marker::Enable),
        (DISABLE, Marker::Disable),
    ];
    for (name, marker) in markers {
        let Some(after) = rest.strip_prefix(name) else {
            continue;
        };
        // 「jai-smell-disabled」や、バッククォートで囲まれた言及は、除外のコメントとして扱わない
        let boundary = after.is_empty()
            || after.starts_with(char::is_whitespace)
            || after.starts_with("-->")
            || after.starts_with("*/");
        if !boundary {
            continue;
        }
        let after = after.split("-->").next().unwrap_or_default();
        let after = after.split("*/").next().unwrap_or_default();
        let words = after
            .split(|c: char| c.is_whitespace() || c == ',' || c == '、')
            .filter(|word| !word.is_empty())
            .map(str::to_string)
            .collect();
        return Some((marker, words));
    }
    None
}

/// 各行の範囲を、改行を含めたバイト位置で返す
fn line_ranges(text: &str) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut start = 0;
    for (i, _) in text.match_indices('\n') {
        ranges.push(start..i + 1);
        start = i + 1;
    }
    if start < text.len() {
        ranges.push(start..text.len());
    }
    ranges
}

#[cfg(test)]
mod tests;
