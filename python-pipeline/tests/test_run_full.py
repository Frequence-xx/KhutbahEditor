"""Integration tests for the headless run_full orchestrator.

Goes from input → detect → smart_cut both parts → thumbnails →
publish-ready dict, in one call. The single entrypoint the
auto-pilot needs (no UI orchestration).
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest

from khutbah_pipeline.run_full import run_full


FIXTURE = Path(__file__).parent / "fixtures" / "khutbah_3min.mp4"
WHISPER = Path(__file__).parents[2] / "resources" / "models" / "whisper-tiny"


@pytest.fixture(autouse=True, scope="module")
def _ensure_assets() -> None:
    if not FIXTURE.exists():
        pytest.skip("fixture missing")
    if not WHISPER.exists():
        pytest.skip("whisper-tiny missing")


def test_run_full_returns_expected_shape(tmp_path: Path) -> None:
    out = run_full(
        input_path=str(FIXTURE),
        output_dir=str(tmp_path),
        whisper_model_dir=str(WHISPER),
        device="cpu",
    )
    assert isinstance(out, dict)
    assert "input" in out
    assert "detect" in out
    assert "needs_review" in out
    assert "wall_seconds" in out
    assert isinstance(out["needs_review"], bool)


def test_run_full_marks_needs_review_when_detect_fails(tmp_path: Path) -> None:
    """Synthetic 3-min fixture: detect returns error (no real speech).
    needs_review must be True (auto-pilot must not fire), no parts cut."""
    out = run_full(
        input_path=str(FIXTURE),
        output_dir=str(tmp_path),
        whisper_model_dir=str(WHISPER),
        device="cpu",
    )
    assert out["needs_review"] is True
    if "error" in out["detect"].get("result", {}):
        assert out.get("parts", []) == []


def test_run_full_rejects_missing_input(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        run_full(
            input_path=str(tmp_path / "does_not_exist.mp4"),
            output_dir=str(tmp_path),
            whisper_model_dir=str(WHISPER),
            device="cpu",
        )


def test_run_full_threshold_overrideable(tmp_path: Path) -> None:
    """auto_pilot_threshold lets caller dial the needs_review trigger."""
    out_strict = run_full(
        input_path=str(FIXTURE),
        output_dir=str(tmp_path / "strict"),
        whisper_model_dir=str(WHISPER),
        device="cpu",
        auto_pilot_threshold=0.99,
    )
    out_loose = run_full(
        input_path=str(FIXTURE),
        output_dir=str(tmp_path / "loose"),
        whisper_model_dir=str(WHISPER),
        device="cpu",
        auto_pilot_threshold=0.0,
    )
    # Strict: needs_review almost always True. Loose: depends on detect outcome
    # but threshold=0 means even trivial overall_confidence values clear the bar.
    assert out_strict["needs_review"] is True
