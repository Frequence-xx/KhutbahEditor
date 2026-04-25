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
