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
    assert result["overall_confidence"] > 0.7
