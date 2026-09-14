//! 検出する表現（設定ファイルの entries）の定義と検証。

use serde::Deserialize;

pub struct Dictionary {
    pub entries: Vec<Entry>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub message: String,
    /// 連続する形態素の並びと比較する条件
    pub tokens: Vec<TokenPattern>,
}

/// 1 つの形態素に対する条件。指定したすべてのフィールドが一致した場合に条件を満たす。
/// フィールド名は kuromoji に準拠している。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TokenPattern {
    pub surface_form: Option<Condition>,
    pub pos: Option<Condition>,
    pub pos_detail_1: Option<Condition>,
    pub pos_detail_2: Option<Condition>,
    pub pos_detail_3: Option<Condition>,
    pub conjugated_type: Option<Condition>,
    pub conjugated_form: Option<Condition>,
    pub basic_form: Option<Condition>,
    pub reading: Option<Condition>,
    pub pronunciation: Option<Condition>,
}

/// 条件の値。配列の場合は、いずれかの値に一致すれば条件を満たす。
#[derive(Debug, Deserialize)]
#[serde(
    untagged,
    expecting = "条件の値には、文字列または文字列の配列を指定してください"
)]
pub enum Condition {
    One(String),
    Any(Vec<String>),
}

impl Condition {
    pub fn matches(&self, value: &str) -> bool {
        match self {
            Condition::One(expected) => expected == value,
            Condition::Any(expected) => expected.iter().any(|e| e == value),
        }
    }
}

impl TokenPattern {
    fn conditions(&self) -> impl Iterator<Item = &Condition> {
        [
            &self.surface_form,
            &self.pos,
            &self.pos_detail_1,
            &self.pos_detail_2,
            &self.pos_detail_3,
            &self.conjugated_type,
            &self.conjugated_form,
            &self.basic_form,
            &self.reading,
            &self.pronunciation,
        ]
        .into_iter()
        .flatten()
    }
}

impl Dictionary {
    /// 形式が正しくても、どの形態素にも一致しない条件や、すべての形態素に一致する条件はエラーとする
    pub fn new(entries: Vec<Entry>) -> Result<Self, String> {
        for (i, entry) in entries.iter().enumerate() {
            if entry.tokens.is_empty() {
                return Err(format!("entries[{i}] の tokens が空です"));
            }
            for (j, token) in entry.tokens.iter().enumerate() {
                if token.conditions().next().is_none() {
                    return Err(format!("entries[{i}].tokens[{j}] に条件がありません"));
                }
                if token
                    .conditions()
                    .any(|c| matches!(c, Condition::Any(v) if v.is_empty()))
                {
                    return Err(format!("entries[{i}].tokens[{j}] に空の配列があります"));
                }
            }
        }
        Ok(Self { entries })
    }

    /// テスト用に、entries のみを記述した TOML から生成する
    #[cfg(test)]
    pub fn from_toml(text: &str) -> Result<Self, String> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct File {
            entries: Vec<Entry>,
        }
        let file: File = toml::from_str(text).map_err(|e| e.to_string())?;
        Self::new(file.entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_string_and_array_conditions() {
        let dictionary = Dictionary::from_toml(
            r#"
            [[entries]]
            message = "m"
            tokens = [{ pos = "動詞", surface_form = ["a", "b"] }]
            "#,
        )
        .unwrap();
        let token = &dictionary.entries[0].tokens[0];
        assert!(token.pos.as_ref().unwrap().matches("動詞"));
        assert!(token.surface_form.as_ref().unwrap().matches("b"));
        assert!(!token.surface_form.as_ref().unwrap().matches("c"));
    }

    #[test]
    fn rejects_unknown_fields() {
        let cases = [
            "[[entries]]\nmessage = \"m\"\nexpected = \"e\"\ntokens = [{ pos = \"名詞\" }]",
            "[[entries]]\nmessage = \"m\"\ntokens = [{ basic_fom = \"名詞\" }]",
        ];
        for text in cases {
            let error = Dictionary::from_toml(text).err().unwrap();
            assert!(error.contains("unknown field"), "{text}: {error}");
        }
    }

    #[test]
    fn rejects_patterns_that_never_or_always_match() {
        let cases = [
            "tokens = []",
            "tokens = [{}]",
            "tokens = [{ pos = [] }]",
            "tokens = [{ pos = 1 }]",
        ];
        for tokens in cases {
            let text = format!("[[entries]]\nmessage = \"m\"\n{tokens}");
            assert!(Dictionary::from_toml(&text).is_err(), "{tokens}");
        }
    }
}
