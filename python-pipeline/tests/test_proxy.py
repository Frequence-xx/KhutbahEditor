import json
import subprocess
from pathlib import Path
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
