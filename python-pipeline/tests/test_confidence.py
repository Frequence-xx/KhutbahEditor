"""Unit tests for detection confidence helpers.

These cover the pure math used by pipeline_v2 to derive part-level
confidence from whisper word probabilities and matched anchor spans.
The pipeline previously hardcoded Part 2 confidence as 0.5 / 0.90 — that
ignored the actual ASR evidence. These helpers make the math explicit.
"""

from __future__ import annotations

import math

import pytest

from khutbah_pipeline.detect.confidence import (
    anchor_confidence,
    combine_confidences,
)


def _w(start: float, end: float, prob: float, word: str = "x") -> dict:
    return {"start": start, "end": end, "probability": prob, "word": word}


# --- anchor_confidence -----------------------------------------------------

def test_anchor_confidence_averages_word_probs() -> None:
    words = [_w(0, 1, 0.9), _w(1, 2, 0.8), _w(2, 3, 0.7), _w(3, 4, 0.6)]
    anchor = {"start_word_idx": 0, "end_word_idx": 2}
    assert anchor_confidence(words, anchor) == pytest.approx(0.8)


def test_anchor_confidence_single_word() -> None:
    words = [_w(0, 1, 0.42)]
    anchor = {"start_word_idx": 0, "end_word_idx": 0}
    assert anchor_confidence(words, anchor) == pytest.approx(0.42)


def test_anchor_confidence_uses_inclusive_end_idx() -> None:
    """end_word_idx is inclusive (matches _find_phrase return shape)."""
    words = [_w(0, 1, 1.0), _w(1, 2, 0.5)]
    anchor = {"start_word_idx": 0, "end_word_idx": 1}
    assert anchor_confidence(words, anchor) == pytest.approx(0.75)


def test_anchor_confidence_returns_none_for_missing_anchor() -> None:
    """Caller may pass None when no match was found."""
    assert anchor_confidence([_w(0, 1, 0.9)], None) is None


def test_anchor_confidence_raises_on_invalid_span() -> None:
    """end_word_idx < start_word_idx is a programming error."""
    words = [_w(0, 1, 0.9)]
    with pytest.raises(ValueError):
        anchor_confidence(words, {"start_word_idx": 1, "end_word_idx": 0})


# --- combine_confidences ---------------------------------------------------

def test_combine_geomean_when_both_present() -> None:
    """Two anchors → geometric mean (penalises one weak anchor more than
    arithmetic mean would)."""
    out = combine_confidences(0.9, 0.5)
    assert out == pytest.approx(math.sqrt(0.9 * 0.5))


def test_combine_returns_single_present() -> None:
    assert combine_confidences(0.9, None) == pytest.approx(0.9)
    assert combine_confidences(None, 0.4) == pytest.approx(0.4)


def test_combine_returns_low_default_when_none_present() -> None:
    assert combine_confidences(None, None) == pytest.approx(0.3)


def test_combine_low_default_overrideable() -> None:
    assert combine_confidences(None, None, low_default=0.1) == pytest.approx(0.1)


def test_combine_handles_three_or_more() -> None:
    out = combine_confidences(0.9, 0.5, 0.8)
    assert out == pytest.approx((0.9 * 0.5 * 0.8) ** (1 / 3))


def test_combine_skips_none_among_many() -> None:
    out = combine_confidences(0.9, None, 0.5, None)
    assert out == pytest.approx(math.sqrt(0.9 * 0.5))


# --- anchor_score: credit substring match ---------------------------------

from khutbah_pipeline.detect.confidence import anchor_score


def test_anchor_score_floors_at_half_for_matched_anchor():
    """A matched anchor (substring containment is deterministic) gets 0.5
    baseline credit even when whisper's per-word probabilities are zero.
    Word probability quantifies whisper's uncertainty about its own
    characters within the matched span — it's a lift, not the full score."""
    words = [_w(0, 1, 0.0), _w(1, 2, 0.0)]
    anchor = {"start_word_idx": 0, "end_word_idx": 1}
    assert anchor_score(words, anchor) == pytest.approx(0.5)


def test_anchor_score_full_credit_for_high_word_probs():
    """Perfect word probs → score reaches 1.0 (capped)."""
    words = [_w(0, 1, 1.0), _w(1, 2, 1.0)]
    anchor = {"start_word_idx": 0, "end_word_idx": 1}
    assert anchor_score(words, anchor) == pytest.approx(1.0)


def test_anchor_score_linear_lift_from_word_probs():
    """0.5 baseline + 0.5 * raw avg word prob."""
    words = [_w(0, 1, 0.6), _w(1, 2, 0.4)]
    anchor = {"start_word_idx": 0, "end_word_idx": 1}
    assert anchor_score(words, anchor) == pytest.approx(0.75)


def test_anchor_score_returns_none_for_missing_anchor():
    """No match → no score (caller decides what to do with absence)."""
    assert anchor_score([_w(0, 1, 0.9)], None) is None
