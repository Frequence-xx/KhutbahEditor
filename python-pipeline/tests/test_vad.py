from pathlib import Path

import pytest

from khutbah_pipeline.detect.vad import detect_speech_segments


FIXTURE = Path(__file__).parent / "fixtures" / "khutbah_3min.mp4"


@pytest.fixture(autouse=True, scope="module")
def _ensure_fixture() -> None:
    if not FIXTURE.exists():
        pytest.skip(f"fixture missing — run {FIXTURE.parent / 'make_khutbah_fixture.sh'}")


def test_detect_speech_segments_finds_two_speech_blocks() -> None:
    segs = detect_speech_segments(str(FIXTURE))
    assert isinstance(segs, list)
    for s in segs:
        assert "start" in s and "end" in s
        assert 0 <= s["start"] < s["end"] <= 180.5


def test_detect_speech_segments_returns_empty_for_silence(tmp_path) -> None:
    silent = tmp_path / "silent.wav"
    import subprocess
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i",
         "anullsrc=channel_layout=mono:sample_rate=16000:d=10",
         "-loglevel", "error", str(silent)],
        check=True, capture_output=True,
    )
    segs = detect_speech_segments(str(silent))
    assert segs == []
