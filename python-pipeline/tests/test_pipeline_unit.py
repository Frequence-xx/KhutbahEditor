from khutbah_pipeline.detect.pipeline import run_detection_pipeline


def test_pipeline_finds_boundaries_from_mock_transcript(monkeypatch):
    """Use monkeypatched transcribe + silences for deterministic, fast test."""
    mock_words = (
        [{"word": "بسم", "start": 0, "end": 0.5, "probability": 0.9, "lang": "ar"}]
        + [
            {"word": "إن", "start": 5.0, "end": 5.3, "probability": 0.95, "lang": "ar"},
            {"word": "الحمد", "start": 5.4, "end": 5.8, "probability": 0.95, "lang": "ar"},
            {"word": "لله", "start": 5.9, "end": 6.3, "probability": 0.95, "lang": "ar"},
        ]
        + [{"word": "...", "start": 7, "end": 900, "probability": 0.9, "lang": "ar"}]
        + [
            {"word": "onze", "start": 1000.0, "end": 1000.3, "probability": 0.9, "lang": "nl"},
            {"word": "heer", "start": 1000.4, "end": 1000.7, "probability": 0.9, "lang": "nl"},
            {"word": "geef", "start": 1000.8, "end": 1001.0, "probability": 0.9, "lang": "nl"},
            {"word": "ons", "start": 1001.1, "end": 1001.3, "probability": 0.9, "lang": "nl"},
            {"word": "in", "start": 1001.4, "end": 1001.5, "probability": 0.9, "lang": "nl"},
            {"word": "deze", "start": 1001.6, "end": 1001.8, "probability": 0.9, "lang": "nl"},
            {"word": "wereld", "start": 1001.9, "end": 1002.3, "probability": 0.9, "lang": "nl"},
            {"word": "het", "start": 1002.4, "end": 1002.5, "probability": 0.9, "lang": "nl"},
            {"word": "goede", "start": 1002.6, "end": 1003.0, "probability": 0.9, "lang": "nl"},
        ]
    )
    # Duration must be > 1260 (= 960 + 300 end-guard) for the 950-960 sitting
    # silence to be valid. Plan said 1100 — that's a plan-snippet bug; using 1500.
    # lang_dominant "nl" so that find_last_closing searches the NL closing phrases
    # (the dua words in the mock are Dutch). The Part 1 body is Arabic, but
    # the dominant lang is determined by word count across the full transcript;
    # setting "nl" here makes the NL dua phrase be found and gives part2.end = 1004.0.
    mock_transcript = {"duration": 1500.0, "words": mock_words, "lang_dominant": "nl"}
    mock_silences = [
        {"start": 950.0, "end": 960.0, "duration": 10.0},  # the sitting silence
        {"start": 100.0, "end": 100.5, "duration": 0.5},   # within-speech (filtered)
    ]
    monkeypatch.setattr(
        "khutbah_pipeline.detect.pipeline._transcribe",
        lambda *_a, **_k: mock_transcript,
    )
    monkeypatch.setattr(
        "khutbah_pipeline.detect.pipeline._silences",
        lambda *_a, **_k: mock_silences,
    )

    result = run_detection_pipeline(audio_path="ignored", model_dir="ignored")

    assert result["part1"]["start"] == 0.0  # 5.0 - 5.0 buffer
    assert result["part1"]["end"] == 950.0
    assert result["part2"]["start"] == 960.0
    assert result["part2"]["end"] == 1003.0 + 1.0
    assert result["part1"]["confidence"] > 0.7
    assert result["part1"]["anchor"] == "opening"
    assert result["overall_confidence"] > 0.7


def test_pipeline_falls_back_to_adhan_end_when_opening_missing(monkeypatch):
    """When إن الحمد لله is absent, adhan-end (الله أكبر … لا إله إلا الله) anchors Part 1."""
    mock_words = (
        # adhan tail at 60-63s
        [
            {"word": "الله", "start": 60.0, "end": 60.3, "probability": 0.92, "lang": "ar"},
            {"word": "أكبر", "start": 60.4, "end": 60.7, "probability": 0.92, "lang": "ar"},
            {"word": "الله", "start": 60.8, "end": 61.1, "probability": 0.92, "lang": "ar"},
            {"word": "أكبر", "start": 61.2, "end": 61.5, "probability": 0.92, "lang": "ar"},
            {"word": "لا", "start": 61.6, "end": 61.8, "probability": 0.92, "lang": "ar"},
            {"word": "إله", "start": 61.9, "end": 62.2, "probability": 0.92, "lang": "ar"},
            {"word": "إلا", "start": 62.3, "end": 62.5, "probability": 0.92, "lang": "ar"},
            {"word": "الله", "start": 62.6, "end": 63.0, "probability": 0.92, "lang": "ar"},
        ]
        # khutbah body without the standard opening phrase
        + [{"word": "محتوى", "start": 70 + i, "end": 70 + i + 0.5, "probability": 0.9, "lang": "ar"} for i in range(900)]
        # Arabic dua tail
        + [
            {"word": "ربنا", "start": 1000.0, "end": 1000.5, "probability": 0.9, "lang": "ar"},
            {"word": "اتنا", "start": 1000.6, "end": 1001.0, "probability": 0.9, "lang": "ar"},
            {"word": "في", "start": 1001.1, "end": 1001.3, "probability": 0.9, "lang": "ar"},
            {"word": "الدنيا", "start": 1001.4, "end": 1001.8, "probability": 0.9, "lang": "ar"},
            {"word": "حسنه", "start": 1001.9, "end": 1002.2, "probability": 0.9, "lang": "ar"},
            {"word": "وفي", "start": 1002.3, "end": 1002.5, "probability": 0.9, "lang": "ar"},
            {"word": "الاخره", "start": 1002.6, "end": 1003.0, "probability": 0.9, "lang": "ar"},
            {"word": "حسنه", "start": 1003.1, "end": 1003.5, "probability": 0.9, "lang": "ar"},
        ]
    )
    mock_transcript = {"duration": 1500.0, "words": mock_words, "lang_dominant": "ar"}
    mock_silences = [{"start": 950.0, "end": 960.0, "duration": 10.0}]
    monkeypatch.setattr(
        "khutbah_pipeline.detect.pipeline._transcribe",
        lambda *_a, **_k: mock_transcript,
    )
    monkeypatch.setattr(
        "khutbah_pipeline.detect.pipeline._silences",
        lambda *_a, **_k: mock_silences,
    )

    result = run_detection_pipeline(audio_path="ignored", model_dir="ignored")

    # Part 1 starts ADHAN_END_BUFFER (3s) after adhan-end (63.0s) → 66.0s.
    assert result["part1"]["start"] == 66.0
    assert result["part1"]["anchor"] == "adhan_end"
    # Confidence is capped to ADHAN_FALLBACK_CONFIDENCE so the user is prompted to verify.
    assert result["part1"]["confidence"] == 0.55
    assert result["overall_confidence"] <= 0.55
    assert "adhan-end fallback" in result["part1"]["transcript_at_start"]


def test_pipeline_returns_opening_not_found_when_neither_anchor_present(monkeypatch):
    """No opening phrase, no adhan tail → still report opening_not_found (not crash)."""
    mock_words = [{"word": "محتوى", "start": i, "end": i + 0.5, "probability": 0.9, "lang": "ar"} for i in range(60)]
    mock_transcript = {"duration": 1500.0, "words": mock_words, "lang_dominant": "ar"}
    monkeypatch.setattr(
        "khutbah_pipeline.detect.pipeline._transcribe",
        lambda *_a, **_k: mock_transcript,
    )
    monkeypatch.setattr(
        "khutbah_pipeline.detect.pipeline._silences",
        lambda *_a, **_k: [],
    )

    result = run_detection_pipeline(audio_path="ignored", model_dir="ignored")
    assert result.get("error") == "opening_not_found"
