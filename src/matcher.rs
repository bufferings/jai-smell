//! 形態素の並びと辞書のマッチング。

use std::borrow::Cow;

use lindera::dictionary::load_dictionary;
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;

use crate::dictionary::{Dictionary, Entry, TokenPattern};

/// 1 つの形態素。フィールド名は辞書の条件と同一。
#[derive(Debug)]
pub struct Token {
    /// 分かち書きの対象テキスト内でのバイト位置
    pub byte_start: usize,
    pub surface_form: String,
    pub pos: String,
    pub pos_detail_1: String,
    pub pos_detail_2: String,
    pub pos_detail_3: String,
    pub conjugated_type: String,
    pub conjugated_form: String,
    pub basic_form: String,
    pub reading: String,
    pub pronunciation: String,
}

pub struct Tokenizer {
    segmenter: Segmenter,
}

impl Tokenizer {
    pub fn new() -> Result<Self, String> {
        let dictionary = load_dictionary("embedded://ipadic")
            .map_err(|e| format!("IPADIC を読み込めません: {e}"))?;
        Ok(Self {
            segmenter: Segmenter::new(Mode::Normal, dictionary, None),
        })
    }

    pub fn tokenize(&self, text: &str) -> Result<Vec<Token>, String> {
        let mut tokens = self
            .segmenter
            .segment(Cow::Borrowed(text))
            .map_err(|e| format!("分かち書きに失敗しました: {e}"))?;
        Ok(tokens
            .iter_mut()
            .map(|token| {
                let byte_start = token.byte_start;
                let surface_form = token.surface.to_string();
                // IPADIC の並び: 品詞, 品詞細分類1〜3, 活用型, 活用形, 基本形, 読み, 発音
                let details = token.details();
                let detail = |i: usize| details.get(i).copied().unwrap_or("*").to_string();
                Token {
                    byte_start,
                    surface_form,
                    pos: detail(0),
                    pos_detail_1: detail(1),
                    pos_detail_2: detail(2),
                    pos_detail_3: detail(3),
                    conjugated_type: detail(4),
                    conjugated_form: detail(5),
                    basic_form: detail(6),
                    reading: detail(7),
                    pronunciation: detail(8),
                }
            })
            .collect())
    }
}

pub struct Hit<'d> {
    /// 並びの先頭の形態素のバイト位置
    pub byte_start: usize,
    pub entry: &'d Entry,
}

/// 各エントリの tokens に一致する、連続する形態素の並びを探索する。結果は出現位置の順に返す。
pub fn find<'d>(dictionary: &'d Dictionary, tokens: &[Token]) -> Vec<Hit<'d>> {
    let mut hits = Vec::new();
    for entry in &dictionary.entries {
        let len = entry.tokens.len();
        let mut i = 0;
        while i + len <= tokens.len() {
            if entry
                .tokens
                .iter()
                .zip(&tokens[i..])
                .all(|(p, t)| matches(p, t))
            {
                hits.push(Hit {
                    byte_start: tokens[i].byte_start,
                    entry,
                });
                i += len;
            } else {
                i += 1;
            }
        }
    }
    // 安定ソートのため、同じ位置では辞書での定義順を維持する
    hits.sort_by_key(|hit| hit.byte_start);
    hits
}

fn matches(pattern: &TokenPattern, token: &Token) -> bool {
    [
        (&pattern.surface_form, &token.surface_form),
        (&pattern.pos, &token.pos),
        (&pattern.pos_detail_1, &token.pos_detail_1),
        (&pattern.pos_detail_2, &token.pos_detail_2),
        (&pattern.pos_detail_3, &token.pos_detail_3),
        (&pattern.conjugated_type, &token.conjugated_type),
        (&pattern.conjugated_form, &token.conjugated_form),
        (&pattern.basic_form, &token.basic_form),
        (&pattern.reading, &token.reading),
        (&pattern.pronunciation, &token.pronunciation),
    ]
    .into_iter()
    .all(|(condition, value)| condition.as_ref().is_none_or(|c| c.matches(value)))
}

#[cfg(test)]
mod tests;
