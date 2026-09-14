use std::sync::OnceLock;

use super::*;

const KIKU: &str = r#"
        [[entries]]
        message = "効く"
        tokens = [{ pos = "動詞", pos_detail_1 = "自立", basic_form = "効く" }]
    "#;

const HASHIRU: &str = r#"
        [[entries]]
        message = "走る"
        tokens = [
          { pos = "動詞", pos_detail_1 = "自立", surface_form = ["走る", "走っ", "走り", "走ら", "走れ", "走ろ"] },
        ]
    "#;

const NI_OCHIRU: &str = r#"
        [[entries]]
        message = "に落ちる"
        tokens = [
          { pos = "助詞", pos_detail_1 = "格助詞", surface_form = "に" },
          { pos = "動詞", pos_detail_1 = "自立", basic_form = "落ちる" },
        ]
    "#;

const ANA: &str = r#"
        [[entries]]
        message = "穴"
        tokens = [{ pos = "名詞", basic_form = "穴" }]
    "#;

fn tokenizer() -> &'static Tokenizer {
    static TOKENIZER: OnceLock<Tokenizer> = OnceLock::new();
    TOKENIZER.get_or_init(|| Tokenizer::new().unwrap())
}

/// 一致した位置を、テキスト内の文字列として返す
fn hits(dictionary: &str, text: &str) -> Vec<String> {
    let dictionary = Dictionary::from_toml(dictionary).unwrap();
    let tokens = tokenizer().tokenize(text).unwrap();
    find(&dictionary, &tokens)
        .iter()
        .map(|hit| format!("{}@{}", hit.entry.message, &text[hit.byte_start..]))
        .collect()
}

#[test]
fn matches_conjugated_forms() {
    assert_eq!(hits(KIKU, "キャッシュが効きます"), ["効く@効きます"]);
    assert_eq!(hits(KIKU, "薬が効かない"), ["効く@効かない"]);
    assert_eq!(hits(HASHIRU, "ジョブが走った"), ["走る@走った"]);
}

#[test]
fn ignores_ordinary_usage() {
    assert!(hits(HASHIRU, "自走するロボット").is_empty());
    assert!(hits(NI_OCHIRU, "階段から落ちた").is_empty());
    assert!(hits(ANA, "落とし穴に注意").is_empty());
    assert_eq!(hits(ANA, "設計に穴がある"), ["穴@穴がある"]);
}

#[test]
fn array_condition_matches_any_value() {
    let dictionary = r#"
            [[entries]]
            message = "m"
            tokens = [{ basic_form = ["穴", "見張る"] }]
        "#;
    assert_eq!(hits(dictionary, "穴を見張る"), ["m@穴を見張る", "m@見張る"]);
}

#[test]
fn sequence_matches_consecutive_tokens() {
    assert_eq!(
        hits(NI_OCHIRU, "キャッシュがないとフォールバックに落ちる"),
        ["に落ちる@に落ちる"]
    );
    assert!(hits(NI_OCHIRU, "に階段から落ちる").is_empty());
}

#[test]
fn reports_in_text_order_across_entries() {
    let dictionary = format!("{ANA}\n{KIKU}");
    assert_eq!(
        hits(&dictionary, "よく効くが穴もある"),
        ["効く@効くが穴もある", "穴@穴もある"]
    );
}
