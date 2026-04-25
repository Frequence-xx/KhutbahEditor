import subprocess
from pathlib import Path

import pytest

from khutbah_pipeline.edit.waveform import compute_waveform
from khutbah_pipeline.util.ffmpeg import FFMPEG


@pytest.fixture
def silent_clip(tmp_path: Path) -> Path:
    """3s mono mp4 with a 440Hz tone for the first second, silence after."""
    out = tmp_path / "tone.mp4"
    subprocess.run(
        [
            FFMPEG, "-y",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=8000",
            "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=8000",
            "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1",
            "-c:a", "aac", "-b:a", "64k",
            "-t", "3",
            "-loglevel", "error",
            str(out),
        ],
        check=True,
        capture_output=True,
    )
    return out


def test_compute_waveform_returns_normalised_peaks(silent_clip: Path) -> None:
    result = compute_waveform(str(silent_clip), peaks_count=30)
    assert result["sample_rate"] == 2000
    assert 2.5 < result["duration"] < 3.5
    assert len(result["peaks"]) == 30
    assert all(0.0 <= p <= 1.0 for p in result["peaks"])
    # Tone in the first third should produce noticeably higher amplitude than
    # the silent tail. Use a generous gap to tolerate AAC encode noise.
    head_max = max(result["peaks"][:10])
    tail_max = max(result["peaks"][-5:])
    assert head_max > tail_max + 0.1


def test_compute_waveform_empty_audio(tmp_path: Path) -> None:
    """Tolerates a near-empty file without crashing."""
    out = tmp_path / "empty.mp4"
    subprocess.run(
        [
            FFMPEG, "-y",
            "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=8000",
            "-t", "0.001",
            "-loglevel", "error",
            str(out),
        ],
        check=True,
        capture_output=True,
    )
    result = compute_waveform(str(out), peaks_count=10)
    # Either zero-length peaks or a few near-zero — must not raise.
    assert all(p < 0.01 for p in result["peaks"])
