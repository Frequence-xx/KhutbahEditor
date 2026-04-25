from khutbah_pipeline.detect.normalize_arabic import normalize_arabic


def test_strips_diacritics():
    assert normalize_arabic("إِنَّ الْحَمْدَ لِلَّهِ") == "ان الحمد لله"


def test_unifies_alef_forms():
    assert normalize_arabic("إن") == "ان"
    assert normalize_arabic("أن") == "ان"
    assert normalize_arabic("آن") == "ان"


def test_collapses_whitespace():
    assert normalize_arabic("  ان  الحمد   لله  ") == "ان الحمد لله"


def test_passes_through_non_arabic():
    assert normalize_arabic("Hello World") == "hello world"
