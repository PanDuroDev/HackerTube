from pipeline.normalize import has_keyword, normalize_ar


def test_hamza_and_teh_marbuta_unified():
    assert normalize_ar("أحمد") == normalize_ar("احمد")
    assert normalize_ar("إسراء") == normalize_ar("اسراء")
    assert normalize_ar("برمجة") == normalize_ar("برمجه")
    assert normalize_ar("على") == normalize_ar("علي")


def test_tashkeel_and_tatweel_removed():
    assert normalize_ar("مُحَمَّد") == "محمد"
    assert normalize_ar("مـرحـبـا") == "مرحبا"


def test_latin_and_code_terms_kept():
    assert normalize_ar("Node.JS") == "node.js"
    assert normalize_ar("C++") == "c++"
    assert normalize_ar("C#") == "c#"


def test_punctuation_collapsed():
    assert normalize_ar("  تعلم   البرمجة!!  ") == "تعلم البرمجه"


def test_keyword_matches_whole_word_only():
    text = normalize_ar("دورة جافاسكربت للمبتدئين")
    assert has_keyword(text, "جافاسكربت")
    assert not has_keyword(text, "جافا")
    assert not has_keyword(normalize_ar("email marketing"), "ai")
