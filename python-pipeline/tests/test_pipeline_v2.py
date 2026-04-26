"""End-to-end pipeline test on the synthetic fixture.

Doesn't assert exact boundaries (the synthetic fixture isn't real speech),
but verifies the pipeline runs without crashing and returns the expected
result shape. Real-clip QA covers correctness via bench_pipeline.py.
"""

from pathlib import Path

import pytest

from khutbah_pipeline.detect.pipeline_v2 import run_pipeline_v2


FIXTURE = Path(__file__).parent / "fixtures" / "khutbah_3min.mp4"
MODEL_DIR = Path(__file__).parents[2] / "resources" / "models" / "whisper-tiny"


@pytest.fixture(autouse=True, scope="module")
def _ensure_assets() -> None:
    if not FIXTURE.exists():
        pytest.skip("fixture missing")
    if not MODEL_DIR.exists():
        pytest.skip("whisper-tiny missing")


def test_pipeline_v2_returns_expected_shape() -> None:
    result = run_pipeline_v2(str(FIXTURE), str(MODEL_DIR), device="cpu")
    assert isinstance(result, dict)
    if "error" not in result:
        assert "duration" in result
        assert "part1" in result and "part2" in result
        assert "overall_confidence" in result
        for part in (result["part1"], result["part2"]):
            assert "start" in part and "end" in part
            assert "confidence" in part


def test_pipeline_v2_progress_callback_invoked() -> None:
    seen_stages: list[str] = []
    def cb(payload: dict) -> None:
        seen_stages.append(payload.get("stage", ""))
    run_pipeline_v2(str(FIXTURE), str(MODEL_DIR), device="cpu", progress_cb=cb)
    # Current pipeline_v2 stages (post-VAD-removal, see commit 4be15df):
    # silence → transcribe → detect_boundaries → done. The synthetic
    # fixture won't anchor anything (no real speech), but silence and
    # transcribe always fire before any boundary work. The full happy path
    # is exercised by scripts/e2e_canonical.py against a real source.
    assert any(s == "silence" for s in seen_stages)
    assert any(s == "transcribe" for s in seen_stages)
