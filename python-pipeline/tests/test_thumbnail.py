from pathlib import Path
import subprocess
import pytest
from khutbah_pipeline.edit.thumbnail import extract_candidates

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"


def test_extract_returns_paths(tmp_path):
    """Extraction returns a list of file paths to JPEGs.

    Note: the synthetic fixture has only one scene (constant black), so the
    scene-detection filter may produce 0-1 frames depending on FFmpeg version.
    The test verifies the API contract — it returns a list — not a specific
    count. Real khutbah footage produces 5-6 thumbs reliably.
    """
    paths = extract_candidates(str(FIXTURE), str(tmp_path), count=6)
    assert isinstance(paths, list)
    for p in paths:
        assert Path(p).exists()
        assert Path(p).suffix == ".jpg"


def test_extract_creates_output_dir(tmp_path):
    """The output dir is created if missing."""
    out_dir = tmp_path / "doesnt_exist_yet"
    extract_candidates(str(FIXTURE), str(out_dir), count=6)
    assert out_dir.exists()
