import pytest
import subprocess
from pathlib import Path
from khutbah_pipeline.ingest.local import probe_local, IngestError

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"

def test_probe_returns_duration_and_streams():
    info = probe_local(str(FIXTURE))
    assert info["duration"] == pytest.approx(60.0, abs=0.1)
    assert info["has_audio"] is True
    assert info["has_video"] is True
    assert info["width"] == 320


def test_rejects_file_with_no_audio(tmp_path):
    path = tmp_path / "video_only.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=320x180:d=60",
        "-an", str(path),
    ], check=True, capture_output=True)
    with pytest.raises(IngestError, match="no audio"):
        probe_local(str(path))


def test_rejects_too_short_file(tmp_path):
    path = tmp_path / "short.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=320x180:d=10",
        "-f", "lavfi", "-i", "sine=f=440:d=10",
        "-shortest", str(path),
    ], check=True, capture_output=True)
    with pytest.raises(IngestError, match="too short"):
        probe_local(str(path))
