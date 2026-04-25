import pytest
from pathlib import Path
from khutbah_pipeline.detect.silence import detect_silences

FIXTURE = Path(__file__).parent / "fixtures" / "silence_test.wav"


def test_detects_known_silence():
    silences = detect_silences(str(FIXTURE), noise_db=-30, min_duration=2.0)
    assert len(silences) >= 1
    s = silences[0]
    assert 11 < s["start"] < 13
    assert 14 < s["end"] < 16
    assert s["duration"] > 2


def test_raises_on_missing_file():
    with pytest.raises(RuntimeError, match="silencedetect failed"):
        detect_silences("/nonexistent/file.wav")
