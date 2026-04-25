from pathlib import Path

import pytest

from khutbah_pipeline.detect.shots import detect_shot_boundaries


FIXTURE = Path(__file__).parent / "fixtures" / "khutbah_3min.mp4"


@pytest.fixture(autouse=True, scope="module")
def _ensure_fixture() -> None:
    if not FIXTURE.exists():
        pytest.skip(f"fixture missing — run {FIXTURE.parent / 'make_khutbah_fixture.sh'}")


def test_detect_shot_boundaries_finds_known_cut_at_90s() -> None:
    cuts = detect_shot_boundaries(str(FIXTURE), threshold=10.0)
    assert isinstance(cuts, list)
    assert any(89.0 < c["time"] < 91.0 for c in cuts), f"expected cut near 90 s, got {cuts}"
    for c in cuts:
        assert "time" in c and "score" in c
        assert 0.0 < c["score"] <= 1.0


def test_detect_shot_boundaries_high_threshold_returns_few() -> None:
    # threshold=50 — only enormous changes match.
    cuts = detect_shot_boundaries(str(FIXTURE), threshold=50.0)
    assert len(cuts) <= 1
