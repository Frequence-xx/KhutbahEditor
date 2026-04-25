from pathlib import Path

import pytest

from khutbah_pipeline.detect.window_transcribe import transcribe_windows


FIXTURE = Path(__file__).parent / "fixtures" / "khutbah_3min.mp4"
MODEL_DIR = Path(__file__).parents[2] / "resources" / "models" / "whisper-tiny"


@pytest.fixture(autouse=True, scope="module")
def _ensure_assets() -> None:
    if not FIXTURE.exists():
        pytest.skip("fixture missing")
    if not MODEL_DIR.exists():
        pytest.skip(f"whisper-tiny model not found at {MODEL_DIR}; run resources/fetch-resources.sh")


def test_transcribe_windows_returns_words_per_window() -> None:
    windows = [{"id": "w1", "start": 30.0, "end": 40.0}, {"id": "w2", "start": 120.0, "end": 130.0}]
    result = transcribe_windows(str(FIXTURE), str(MODEL_DIR), windows, device="cpu")
    assert "w1" in result and "w2" in result
    for wid, payload in result.items():
        assert "words" in payload
        assert "language" in payload
        for w in payload["words"]:
            assert "word" in w and "start" in w and "end" in w


def test_transcribe_windows_empty_input_returns_empty_dict() -> None:
    out = transcribe_windows(str(FIXTURE), str(MODEL_DIR), [], device="cpu")
    assert out == {}
