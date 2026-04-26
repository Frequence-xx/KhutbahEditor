"""Unit tests for the multi-window SyncNet consensus helper.

Single-probe SyncNet returned the wrong answer on v6yLY17uMQE (silent
fallback to 0 ms when one probe was below threshold, masking a real
+600 ms offset that 9/10 windows agreed on). The consensus helper
takes a list of probe results and returns the median offset across
confident samples — or None when too few samples passed the bar.
"""
from __future__ import annotations

import pytest

from khutbah_pipeline.edit.smartcut import _syncnet_consensus


def _s(offset_ms: int, confidence: float) -> dict:
    return {"offset_ms": offset_ms, "confidence": confidence}


def test_consensus_returns_median_offset_across_confident_samples():
    """v6y case: 5 windows agree on +600 ms with confidence above the
    threshold. Consensus must surface 600, not the silent 0 default."""
    samples = [
        _s(600, 5.15), _s(600, 4.94), _s(600, 5.07),
        _s(600, 3.90), _s(600, 2.45),
    ]
    assert _syncnet_consensus(samples) == 600


def test_consensus_filters_low_confidence_samples():
    """Only confident samples count toward the median — a 0 ms outlier
    with confidence 0.5 must not drag the consensus down."""
    samples = [
        _s(600, 4.0), _s(600, 4.0), _s(600, 4.0),
        _s(0, 0.5),  # below threshold, ignored
    ]
    assert _syncnet_consensus(samples) == 600


def test_consensus_returns_none_when_too_few_confident_samples():
    """If fewer than min_consensus samples clear the threshold, we don't
    have enough signal — return None so the caller knows auto-detect failed."""
    samples = [_s(600, 4.0), _s(0, 0.5), _s(0, 0.5)]
    assert _syncnet_consensus(samples, min_consensus=2) is None


def test_consensus_returns_none_when_all_samples_below_threshold():
    samples = [_s(600, 0.5), _s(600, 0.7), _s(600, 0.9)]
    assert _syncnet_consensus(samples) is None


def test_consensus_returns_none_for_empty_input():
    assert _syncnet_consensus([]) is None


def test_consensus_picks_actual_median_not_mode():
    """Three different offsets, all confident: median takes the middle
    (240), not the mode (which doesn't exist anyway)."""
    samples = [_s(120, 4.0), _s(240, 4.0), _s(360, 4.0)]
    assert _syncnet_consensus(samples) == 240


def test_consensus_min_confidence_overrideable():
    """Caller can dial the confidence floor."""
    samples = [_s(600, 1.0), _s(600, 1.0)]
    assert _syncnet_consensus(samples) is None  # default 1.5 too strict
    assert _syncnet_consensus(samples, min_confidence=0.5) == 600


def test_consensus_min_consensus_overrideable():
    """Strict caller can require N samples; loose caller can accept 1."""
    samples = [_s(600, 4.0)]
    assert _syncnet_consensus(samples, min_consensus=1) == 600
    assert _syncnet_consensus(samples, min_consensus=2) is None


# --- Source-wide A/V offset distribution ----------------------------------

from khutbah_pipeline.edit.smartcut import _distribute_probe_starts


def test_distribute_probe_starts_spreads_evenly_in_one_range():
    """5 probes of 6 s in [100, 200]: distribute with 4 s margins so probes
    don't run off the edge."""
    starts = _distribute_probe_starts([(100.0, 200.0)], n_per_range=5, probe_duration=6.0)
    assert len(starts) == 5
    assert all(100.0 + 3.0 <= t <= 200.0 - 3.0 - 6.0 for t in starts), starts


def test_distribute_probe_starts_handles_multiple_ranges():
    """Probes per range, not per source — stays within each range."""
    starts = _distribute_probe_starts(
        [(100.0, 200.0), (1000.0, 1100.0)],
        n_per_range=3, probe_duration=6.0,
    )
    assert len(starts) == 6
    assert all(100.0 <= t <= 200.0 - 6.0 for t in starts[:3]), starts[:3]
    assert all(1000.0 <= t <= 1100.0 - 6.0 for t in starts[3:]), starts[3:]


def test_distribute_probe_starts_skips_too_short_ranges():
    """A range smaller than 2x probe_duration can't fit margins — skip."""
    starts = _distribute_probe_starts(
        [(100.0, 110.0), (1000.0, 1100.0)],
        n_per_range=3, probe_duration=6.0,
    )
    assert len(starts) == 3  # only the second range qualifies
    assert all(1000.0 <= t for t in starts)


def test_distribute_probe_starts_single_probe_centers():
    starts = _distribute_probe_starts([(100.0, 200.0)], n_per_range=1, probe_duration=6.0)
    assert len(starts) == 1
    # single probe sits in the middle
    assert 145.0 <= starts[0] <= 155.0
