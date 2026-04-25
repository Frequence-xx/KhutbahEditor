from khutbah_pipeline.detect.candidates import (
    score_part1_start_candidates,
    score_sitdown_candidates,
    score_part2_end_candidates,
)


def test_part1_start_prefers_long_silence_just_before_first_speech():
    speech = [{"start": 30.0, "end": 90.0}, {"start": 120.0, "end": 150.0}]
    silences = [{"start": 0.0, "end": 30.0, "duration": 30.0}, {"start": 90.0, "end": 120.0, "duration": 30.0}]
    shots = [{"time": 5.0, "score": 0.8}, {"time": 28.0, "score": 0.6}]
    cands = score_part1_start_candidates(speech, silences, shots, duration=180.0)
    assert cands, "expected candidates"
    assert abs(cands[0]["time"] - 30.0) < 5.0
    assert cands[0]["score"] > cands[-1]["score"]


def test_sitdown_prefers_longest_silence_in_middle():
    speech = [{"start": 30.0, "end": 600.0}, {"start": 800.0, "end": 1700.0}]
    silences = [
        {"start": 0.0, "end": 30.0, "duration": 30.0},
        {"start": 600.0, "end": 800.0, "duration": 200.0},
        {"start": 1700.0, "end": 1800.0, "duration": 100.0},
    ]
    cands = score_sitdown_candidates(speech, silences, [], duration=1800.0, part1_start=30.0)
    assert cands
    assert 595.0 < cands[0]["time"] < 805.0


def test_part2_end_prefers_silence_after_last_speech():
    speech = [{"start": 800.0, "end": 1700.0}]
    silences = [{"start": 1700.0, "end": 1800.0, "duration": 100.0}]
    cands = score_part2_end_candidates(speech, silences, [], duration=1800.0, part2_start=800.0)
    assert cands
    assert 1695.0 < cands[0]["time"] < 1810.0


def test_returns_top_n_only():
    silences = [{"start": float(i), "end": float(i + 1), "duration": 1.0} for i in range(20)]
    speech = [{"start": 0.0, "end": 100.0}]
    cands = score_sitdown_candidates(speech, silences, [], duration=100.0, part1_start=0.0, top_n=3)
    assert len(cands) <= 3
