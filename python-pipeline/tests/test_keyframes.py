import subprocess
from pathlib import Path

import pytest

from khutbah_pipeline.util.keyframes import (
    list_keyframes,
    nearest_keyframe_at_or_before,
    nearest_keyframe_at_or_after,
)


@pytest.fixture
def keyframed_clip(tmp_path: Path) -> Path:
    """A 10s clip with keyframes every 2 seconds (-g 48 -keyint_min 48 at 24fps)."""
    out = tmp_path / "kf.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=duration=10:size=320x180:rate=24",
            "-c:v", "libx264", "-g", "48", "-keyint_min", "48",
            "-pix_fmt", "yuv420p",
            "-loglevel", "error",
            str(out),
        ],
        check=True, capture_output=True,
    )
    return out


def test_list_keyframes_returns_at_least_first_frame(keyframed_clip: Path) -> None:
    kfs = list_keyframes(str(keyframed_clip))
    assert kfs, "expected at least one keyframe"
    assert kfs[0] < 0.1
    if len(kfs) >= 2:
        assert 1.5 < (kfs[1] - kfs[0]) < 2.5


def test_nearest_keyframe_at_or_before(keyframed_clip: Path) -> None:
    kfs = list_keyframes(str(keyframed_clip))
    t = nearest_keyframe_at_or_before(kfs, 5.0)
    assert t is not None
    assert t <= 5.0
    assert 5.0 - t < 2.5


def test_nearest_keyframe_at_or_after(keyframed_clip: Path) -> None:
    kfs = list_keyframes(str(keyframed_clip))
    t = nearest_keyframe_at_or_after(kfs, 5.0)
    assert t is not None
    assert t >= 5.0
    assert t - 5.0 < 2.5


def test_nearest_keyframe_before_zero_is_first(keyframed_clip: Path) -> None:
    kfs = list_keyframes(str(keyframed_clip))
    assert nearest_keyframe_at_or_before(kfs, 0.0) == kfs[0]


def test_nearest_keyframe_after_end_is_last(keyframed_clip: Path) -> None:
    kfs = list_keyframes(str(keyframed_clip))
    assert nearest_keyframe_at_or_after(kfs, 999.0) in (None, kfs[-1])
