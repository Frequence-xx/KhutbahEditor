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


def test_unifies_alef_wasla():
    # ٱ (U+0671) appears in Quranic-script transcripts
    assert normalize_arabic("ٱلحمد") == "الحمد"
    assert normalize_arabic("ٱن") == "ان"


def test_strips_tatweel():
    # ـ (U+0640) is a kashida elongation character
    assert normalize_arabic("الـحـمـد") == "الحمد"


def test_full_quranic_opening_normalizes():
    # The opening as it might appear in a Quranic-style transcription
    assert normalize_arabic("إِنَّ ٱلْحَمْدَ لِلَّهِ") == "ان الحمد لله"
