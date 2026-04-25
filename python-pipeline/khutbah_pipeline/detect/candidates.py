"""Combine VAD speech segments + ffmpeg silencedetect + shot cuts into
ranked boundary candidates.

Pure Python, no I/O — runs in < 1 ms even for hour-long sources.
"""

from __future__ import annotations

from typing import Any


def _shot_proximity_bonus(t: float, shots: list[dict[str, Any]], window: float = 5.0) -> float:
    """Bonus 0..1 if a shot cut sits within `window` seconds of t."""
    nearest = min(
        (abs(s["time"] - t) for s in shots), default=float("inf"),
    )
    if nearest >= window:
        return 0.0
    return (1.0 - nearest / window) * 0.3


def score_part1_start_candidates(
    speech: list[dict[str, float]],
    silences: list[dict[str, float]],
    shots: list[dict[str, Any]],
    duration: float,
    top_n: int = 5,
) -> list[dict[str, Any]]:
    """Rank candidates for the Part 1 start boundary.

    Best candidate: just AFTER a long pre-roll silence and just BEFORE the
    first sustained speech segment. Bonus if a camera cut happens nearby
    (operator switching to the speaker shot).
    """
    if not speech:
        return []
    cands: list[dict[str, Any]] = []
    first_speech_start = speech[0]["start"]
    for s in silences:
        if s["end"] > first_speech_start + 30.0:
            continue
        t = s["end"]
        silence_score = min(s["duration"] / 30.0, 1.0) * 0.5
        proximity_score = max(0.0, 1.0 - abs(t - first_speech_start) / 10.0) * 0.2
        shot_score = _shot_proximity_bonus(t, shots)
        total = silence_score + proximity_score + shot_score
        cands.append({"time": t, "score": total, "kind": "part1_start", "source": "silence_end"})

    cands.append({
        "time": first_speech_start,
        "score": 0.4,
        "kind": "part1_start",
        "source": "first_speech",
    })

    cands.sort(key=lambda c: c["score"], reverse=True)
    return cands[:top_n]


def score_sitdown_candidates(
    speech: list[dict[str, float]],
    silences: list[dict[str, float]],
    shots: list[dict[str, Any]],
    duration: float,
    part1_start: float,
    min_part1_duration: float = 300.0,
    end_guard: float = 300.0,
    top_n: int = 5,
) -> list[dict[str, Any]]:
    """Rank candidates for the sit-down (Part 1 end / Part 2 start)."""
    cands: list[dict[str, Any]] = []
    for s in silences:
        if s["start"] < part1_start + min_part1_duration:
            continue
        if s["end"] > duration - end_guard:
            continue
        silence_score = min(s["duration"] / 60.0, 1.0)
        shot_score = _shot_proximity_bonus(s["start"], shots)
        total = silence_score + shot_score
        cands.append({
            "time_p1_end": s["start"],
            "time_p2_start": s["end"],
            "time": s["start"],
            "duration": s["duration"],
            "score": total,
            "kind": "sitdown",
            "source": "long_silence",
        })
    cands.sort(key=lambda c: c["score"], reverse=True)
    return cands[:top_n]


def score_part2_end_candidates(
    speech: list[dict[str, float]],
    silences: list[dict[str, float]],
    shots: list[dict[str, Any]],
    duration: float,
    part2_start: float,
    top_n: int = 5,
) -> list[dict[str, Any]]:
    """Rank candidates for the Part 2 end boundary (after dua)."""
    if not speech:
        return []
    last_speech_end = max((s["end"] for s in speech if s["start"] >= part2_start), default=part2_start)
    cands: list[dict[str, Any]] = []
    for s in silences:
        if s["start"] < last_speech_end - 5.0:
            continue
        t = s["start"] + 1.0
        score = min(s["duration"] / 5.0, 1.0)
        cands.append({"time": t, "score": score, "kind": "part2_end", "source": "trailing_silence"})

    cands.append({
        "time": last_speech_end + 2.0,
        "score": 0.5,
        "kind": "part2_end",
        "source": "last_speech_plus_buffer",
    })

    cands.sort(key=lambda c: c["score"], reverse=True)
    return cands[:top_n]
