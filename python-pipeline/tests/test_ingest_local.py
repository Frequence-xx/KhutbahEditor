import pytest
from pathlib import Path
from khutbah_pipeline.ingest.local import probe_local

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"

def test_probe_returns_duration_and_streams():
    info = probe_local(str(FIXTURE))
    assert info["duration"] == pytest.approx(60.0, abs=0.1)
    assert info["has_audio"] is True
    assert info["has_video"] is True
    assert info["width"] == 320
