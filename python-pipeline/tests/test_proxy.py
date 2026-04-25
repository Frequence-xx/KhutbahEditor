import json
import subprocess
from pathlib import Path

import pytest

from khutbah_pipeline.edit.proxy import generate_proxy

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"


def _ffprobe(path: str) -> dict:
    out = subprocess.run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def test_proxy_is_decodable_and_caps_height(tmp_path):
    out = tmp_path / "proxy.mp4"
    generate_proxy(str(FIXTURE), str(out), max_height=360)
    assert out.exists()

    info = _ffprobe(str(out))
    streams = info["streams"]
    video = next((s for s in streams if s["codec_type"] == "video"), None)
    audio = next((s for s in streams if s["codec_type"] == "audio"), None)
    assert video is not None, "proxy must have a video stream"
    assert audio is not None, "proxy must have an audio stream"
    assert video["codec_name"] == "h264", "proxy video must be h264"
    assert audio["codec_name"] == "aac", "proxy audio must be aac"
    # Source is 320x180 (smaller than max_height=360); proxy must NOT upscale
    assert int(video["height"]) == 180, "proxy must not upscale a source smaller than max_height"
    assert int(video["width"]) == 320


def test_proxy_caps_height_when_source_is_larger(tmp_path):
    """Real khutbah sources are 1080p+; proxy should downscale them to max_height=360."""
    big = tmp_path / "big.mp4"
    # Generate a 5s 1280x720 black + sine fixture
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=1280x720:d=5",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
        "-shortest", str(big),
    ], check=True, capture_output=True)

    out = tmp_path / "proxy.mp4"
    generate_proxy(str(big), str(out), max_height=360)

    info = _ffprobe(str(out))
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert int(video["height"]) == 360, "proxy must cap at max_height"
    # Width preserves aspect ratio (1280:720 = 16:9 → 640:360)
    assert int(video["width"]) == 640


# ---------------------------------------------------------------------------
# Task 2.1: 8-bit / baseline-profile / short-GOP tests
# ---------------------------------------------------------------------------


def _ffprobe_streams(path: Path) -> list[dict]:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(r.stdout).get("streams", [])


def _gop_size(path: Path) -> int:
    """Approximate GOP size = frames between consecutive keyframes."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-skip_frame", "nokey",
         "-show_entries", "frame=pts_time", "-select_streams", "v:0",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    times = [float(t.rstrip(",")) for t in r.stdout.strip().split("\n") if t]
    if len(times) < 2:
        return 0
    intervals = [times[i + 1] - times[i] for i in range(len(times) - 1)]
    return int(max(intervals) * 100)


@pytest.fixture
def hidef_10bit_source(tmp_path: Path) -> Path:
    """Synthesise a 10-bit yuv420p10le source — the typical 'broken' input."""
    out = tmp_path / "src.mp4"
    subprocess.run(
        ["ffmpeg", "-y",
         "-f", "lavfi", "-i", "testsrc=duration=15:size=1920x1080:rate=24",
         "-c:v", "libx264", "-pix_fmt", "yuv420p10le", "-profile:v", "high10",
         "-loglevel", "error", str(out)],
        check=True, capture_output=True,
    )
    return out


def test_proxy_is_8bit_yuv420p_for_chromium(hidef_10bit_source: Path, tmp_path: Path) -> None:
    proxy = tmp_path / "proxy.mp4"
    generate_proxy(str(hidef_10bit_source), str(proxy))
    streams = _ffprobe_streams(proxy)
    v = next(s for s in streams if s["codec_type"] == "video")
    assert v["pix_fmt"] == "yuv420p", f"proxy must be 8-bit yuv420p for Chromium, got {v['pix_fmt']}"
    assert v.get("profile", "").lower() in ("baseline", "constrained baseline")


def test_proxy_has_short_gop_for_fast_scrubbing(hidef_10bit_source: Path, tmp_path: Path) -> None:
    proxy = tmp_path / "proxy.mp4"
    generate_proxy(str(hidef_10bit_source), str(proxy))
    interval_x100 = _gop_size(proxy)
    assert interval_x100 <= 150, f"GOP interval too large for snappy scrub: {interval_x100/100:.2f}s"
