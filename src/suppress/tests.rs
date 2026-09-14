use super::*;

/// target が出現する位置ごとに、除外の範囲に含まれるかどうかを返す
fn covered(text: &str, target: &str) -> Vec<bool> {
    let suppressions = parse(text);
    text.match_indices(target)
        .map(|(offset, _)| covers(&suppressions, text, offset))
        .collect()
}

#[test]
fn disables_next_line() {
    let text = "見る\n<!-- jai-smell-disable-next-line -->\n見る\n見る\n";
    assert_eq!(covered(text, "見る"), [false, true, false]);
}

#[test]
fn disables_only_listed_words() {
    let text = "// jai-smell-disable-next-line 変わった、使う\n変わった。見る。使う。\n";
    assert_eq!(covered(text, "変わった"), [true, true]);
    assert_eq!(covered(text, "使う"), [true, true]);
    assert_eq!(covered(text, "見る"), [false]);
}

#[test]
fn disables_range_until_enable_or_end_of_text() {
    let text =
        "見る\n# jai-smell-disable\n見る\n# jai-smell-enable\n見る\n# jai-smell-disable\n見る\n";
    assert_eq!(covered(text, "見る"), [false, true, false, true]);
}

#[test]
fn disables_whole_file() {
    let text = "見る\n/* jai-smell-disable-file 見る */\n使う\n見る";
    assert_eq!(covered(text, "見る"), [true, true, true]);
    assert_eq!(covered(text, "使う"), [false]);
}

#[test]
fn ignores_marker_like_text() {
    let text = "jai-smell-disabled\n見る\n`jai-smell-disable-next-line` の説明\n見る\n";
    assert_eq!(covered(text, "見る"), [false, false]);
}
