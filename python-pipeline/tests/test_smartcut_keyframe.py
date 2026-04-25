"""Smart-cut speed + correctness tests.

Asserts:
- Output has approximately the requested duration (within keyframe-snap tolerance)
- Wall-clock runtime is fast (<<10 s for a 10 s clip — way below full re-encode)
- Progress callback fires with sensible values
"""

import subprocess
import time
from pathlib import Path

import pytest

from khutbah_pipeline.edit.smartcut import smart_cut


@pytest.fixture
def long_clip(tmp_path: Path) -> Path:
    """30s clip with keyframes every 2s and a tone for measurable loudness."""
    out = tmp_path / "long.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=duration=30:size=640x360:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=30",
            "-c:v", "libx264", "-g", "48", "-keyint_min", "48",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-loglevel", "error",
            str(out),
        ],
        check=True, capture_output=True,
    )
    return out


def _probe_duration(p: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


def test_smart_cut_keyframe_snap_produces_close_duration(long_clip: Path, tmp_path: Path) -> None:
    out = tmp_path / "cut.mp4"
    smart_cut(
        src=str(long_clip),
        dst=str(out),
        start=5.0,
        end=15.0,
        target_lufs=-14, target_tp=-1, target_lra=11,
    )
    actual = _probe_duration(out)
    # Snap can shift up to ~2s on each side
    assert 8.0 < actual < 13.0


def test_smart_cut_runs_fast(long_clip: Path, tmp_path: Path) -> None:
    out = tmp_path / "cut.mp4"
    t0 = time.monotonic()
    smart_cut(
        src=str(long_clip),
        dst=str(out),
        start=5.0,
        end=15.0,
        target_lufs=-14, target_tp=-1, target_lra=11,
    )
    elapsed = time.monotonic() - t0
    # Stream-copy + audio loudnorm 2-pass for a 10s clip should be < 10s.
    # Old full-reencode took 10-20+ s for this same input.
    assert elapsed < 10.0, f"smart_cut took {elapsed:.1f}s — should be < 10s"


def test_smart_cut_progress_callback_invoked(long_clip: Path, tmp_path: Path) -> None:
    seen: list[float] = []
    def cb(p):
        if "progress" in p:
            seen.append(p["progress"])
    smart_cut(
        src=str(long_clip),
        dst=str(tmp_path / "cut.mp4"),
        start=5.0,
        end=15.0,
        target_lufs=-14, target_tp=-1, target_lra=11,
        progress_cb=cb,
    )
    assert seen, "expected progress emissions"
    assert max(seen) >= 0.95


def test_smart_cut_without_normalize_audio(long_clip: Path, tmp_path: Path) -> None:
    """When normalize_audio=False, skip loudnorm pass 1 entirely."""
    out = tmp_path / "raw.mp4"
    t0 = time.monotonic()
    smart_cut(
        src=str(long_clip),
        dst=str(out),
        start=5.0,
        end=15.0,
        normalize_audio=False,
    )
    elapsed = time.monotonic() - t0
    assert _probe_duration(out) > 8.0
    # Without loudnorm, even faster
    assert elapsed < 8.0, f"smart_cut without loudnorm took {elapsed:.1f}s"
