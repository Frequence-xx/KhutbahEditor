import json
import subprocess
from pathlib import Path
import pytest
from khutbah_pipeline.edit.smartcut import smart_cut

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"


@pytest.mark.timeout(60)
def test_smart_cut_produces_video_of_expected_duration(tmp_path):
    out = tmp_path / "part1.mp4"
    smart_cut(
        str(FIXTURE),
        str(out),
        start=10.0,
        end=30.0,
        normalize_audio=True,
        target_lufs=-14.0,
    )
    assert out.exists()
    info = json.loads(
        subprocess.check_output(
            [
                "ffprobe", "-v", "error", "-show_format", "-print_format", "json", str(out),
            ],
            text=True,
        )
    )
    duration = float(info["format"]["duration"])
    assert 19.5 < duration < 20.5
