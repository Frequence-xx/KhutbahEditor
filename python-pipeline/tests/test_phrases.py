from khutbah_pipeline.detect.phrases import (
    OPENING_AR,
    CLOSINGS,
    find_first_opening,
    find_last_closing,
)


def test_find_opening_returns_first_match():
    words = [
        {"word": "بسم", "start": 0.5, "end": 0.9, "lang": "ar"},
        {"word": "إن", "start": 5.0, "end": 5.4, "lang": "ar"},
        {"word": "الحمد", "start": 5.5, "end": 6.0, "lang": "ar"},
        {"word": "لله", "start": 6.1, "end": 6.6, "lang": "ar"},
    ]
    match = find_first_opening(words)
    assert match is not None
    assert match["start_word_idx"] == 1
    assert match["start_time"] == 5.0


def test_find_opening_returns_none_when_absent():
    words = [{"word": "hello", "start": 0, "end": 1, "lang": "en"}]
    assert find_first_opening(words) is None


def test_find_closing_in_dutch():
    words = [
        {"word": "onze", "start": 100.0, "end": 100.3, "lang": "nl"},
        {"word": "heer", "start": 100.4, "end": 100.7, "lang": "nl"},
        {"word": "geef", "start": 100.8, "end": 101.0, "lang": "nl"},
        {"word": "ons", "start": 101.1, "end": 101.3, "lang": "nl"},
        {"word": "in", "start": 101.4, "end": 101.5, "lang": "nl"},
        {"word": "deze", "start": 101.6, "end": 101.8, "lang": "nl"},
        {"word": "wereld", "start": 101.9, "end": 102.3, "lang": "nl"},
        {"word": "het", "start": 102.4, "end": 102.5, "lang": "nl"},
        {"word": "goede", "start": 102.6, "end": 103.0, "lang": "nl"},
    ]
    match = find_last_closing(words, dominant_lang="nl")
    assert match is not None
    assert match["end_time"] == 103.0


def test_find_closing_arabic_dua_in_dutch_khutbah():
    """Code-switch case: Dutch lecture closes with Arabic dua (typical Al-Himmah)."""
    words = [
        {"word": "deze", "start": 100.0, "end": 100.3, "lang": "nl"},
        {"word": "wereld", "start": 100.4, "end": 100.7, "lang": "nl"},
        # Arabic dua at the end
        {"word": "ربنا", "start": 200.0, "end": 200.5, "lang": "ar"},
        {"word": "اتنا", "start": 200.6, "end": 201.0, "lang": "ar"},
        {"word": "في", "start": 201.1, "end": 201.3, "lang": "ar"},
        {"word": "الدنيا", "start": 201.4, "end": 201.8, "lang": "ar"},
        {"word": "حسنه", "start": 201.9, "end": 202.2, "lang": "ar"},
        {"word": "وفي", "start": 202.3, "end": 202.5, "lang": "ar"},
        {"word": "الاخره", "start": 202.6, "end": 203.0, "lang": "ar"},
        {"word": "حسنه", "start": 203.1, "end": 203.5, "lang": "ar"},
    ]
    # Even if we mistakenly pass dominant_lang="nl", the AR dua should still be found
    match = find_last_closing(words, dominant_lang="nl")
    assert match is not None
    assert "ربنا" in match["matched_phrase"] or "حسنه" in match["matched_phrase"]


def test_find_closing_finds_dutch_closing_when_dominant_is_arabic():
    """Whisper file-level lang says 'ar' but Part 2 is actually Dutch — closing must still be found."""
    words = [
        # earlier Arabic content
        {"word": "بسم", "start": 0.0, "end": 0.5, "lang": "ar"},
        # Dutch closing tagged as 'ar' (Whisper file-level mistake)
        {"word": "onze", "start": 100.0, "end": 100.3, "lang": "ar"},
        {"word": "heer", "start": 100.4, "end": 100.7, "lang": "ar"},
        {"word": "geef", "start": 100.8, "end": 101.0, "lang": "ar"},
        {"word": "ons", "start": 101.1, "end": 101.3, "lang": "ar"},
        {"word": "in", "start": 101.4, "end": 101.5, "lang": "ar"},
        {"word": "deze", "start": 101.6, "end": 101.8, "lang": "ar"},
        {"word": "wereld", "start": 101.9, "end": 102.3, "lang": "ar"},
        {"word": "het", "start": 102.4, "end": 102.5, "lang": "ar"},
        {"word": "goede", "start": 102.6, "end": 103.0, "lang": "ar"},
    ]
    match = find_last_closing(words, dominant_lang="ar")
    assert match is not None
    assert match["end_time"] == 103.0
