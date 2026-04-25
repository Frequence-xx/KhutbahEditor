"""V2 detection orchestrator.

Replaces the large-v3 full-transcribe approach with:
  1. silero-vad → speech segments       (~60 s for 3 hr CPU)
  2. ffmpeg silencedetect → silences    (~30 s)
  3. ffmpeg scdet → shot cuts            (~60 s)
  4. Candidate scorer → top N per kind   (< 1 ms)
  5. tiny-whisper on candidate windows   (~30 s for ~15 windows)
  6. phrase match (existing library)     → confidences
  7. Pick highest-confidence per kind    → boundaries

Total target: < 5 min CPU for a 3 hr source; < 1 min on a modest GPU.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from khutbah_pipeline.detect.vad import detect_speech_segments
from khutbah_pipeline.detect.shots import detect_shot_boundaries
from khutbah_pipeline.detect.silence import detect_silences
from khutbah_pipeline.detect.candidates import (
    score_part1_start_candidates,
    score_sitdown_candidates,
    score_part2_end_candidates,
)
from khutbah_pipeline.detect.window_transcribe import transcribe_windows
from khutbah_pipeline.detect.phrases import (
    find_first_opening,
    find_last_closing,
)
from khutbah_pipeline.util.ffmpeg import ffprobe_json


WINDOW_RADIUS = 5.0
SHOT_THRESHOLD = 10.0  # see shots.py — 0-100 range, ~10 catches obvious cuts


def _probe_duration(path: str) -> float:
    meta = ffprobe_json(path)
    return float(meta.get("format", {}).get("duration") or 0)


def _emit(cb: Optional[Callable[[dict[str, Any]], None]], payload: dict[str, Any]) -> None:
    if cb:
        cb(payload)


def run_pipeline_v2(
    audio_path: str,
    model_dir: str,
    device: str = "auto",
    silence_noise_db: float = -35.0,
    silence_min_duration: float = 1.5,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    duration = _probe_duration(audio_path)
    if duration <= 0:
        return {"error": "could_not_probe_duration"}

    _emit(progress_cb, {"stage": "vad", "message": "Voice activity detection…", "progress": 0.0})
    speech = detect_speech_segments(audio_path, progress_cb=progress_cb)

    _emit(progress_cb, {"stage": "silence", "message": "Silence detection…", "progress": 0.25})
    silences = detect_silences(audio_path, silence_noise_db, silence_min_duration)

    _emit(progress_cb, {"stage": "shots", "message": "Shot boundary detection…", "progress": 0.4})
    try:
        shots = detect_shot_boundaries(audio_path, threshold=SHOT_THRESHOLD)
    except RuntimeError:
        shots = []  # audio-only file or no video stream — non-fatal

    _emit(progress_cb, {"stage": "candidates", "message": "Ranking candidates…", "progress": 0.55})
    p1_cands = score_part1_start_candidates(speech, silences, shots, duration)
    if not p1_cands:
        return {"error": "no_part1_candidates", "duration": duration, "speech": speech}

    windows: list[dict[str, Any]] = []
    for i, c in enumerate(p1_cands):
        windows.append({
            "id": f"p1s_{i}",
            "start": max(0.0, c["time"] - WINDOW_RADIUS),
            "end": min(duration, c["time"] + WINDOW_RADIUS * 2),
            "candidate": c,
        })

    _emit(progress_cb, {"stage": "transcribe_windows", "message": "Transcribing candidate windows…", "progress": 0.6})
    win_results = transcribe_windows(audio_path, model_dir, windows, device=device, progress_cb=progress_cb)

    best_p1 = None
    best_p1_conf = 0.0
    for i, c in enumerate(p1_cands):
        wid = f"p1s_{i}"
        words = win_results.get(wid, {}).get("words", [])
        opening = find_first_opening(words)
        if opening:
            n = max(1, opening["end_word_idx"] - opening["start_word_idx"] + 1)
            conf = sum(
                w["probability"]
                for w in words[opening["start_word_idx"]:opening["end_word_idx"] + 1]
            ) / n
            combined = 0.5 * c["score"] + 0.5 * conf
            if combined > best_p1_conf:
                best_p1_conf = combined
                best_p1 = {
                    "time": opening["start_time"] - 5.0,
                    "anchor": "opening",
                    "transcript": " ".join(
                        w["word"]
                        for w in words[opening["start_word_idx"]:opening["end_word_idx"] + 1]
                    ),
                    "confidence": combined,
                }
    if best_p1 is None:
        c = p1_cands[0]
        best_p1 = {
            "time": c["time"],
            "anchor": "structural_only",
            "transcript": "",
            "confidence": c["score"] * 0.55,
        }

    p1_start = max(0.0, best_p1["time"])

    sit_cands = score_sitdown_candidates(speech, silences, shots, duration, part1_start=p1_start)
    if not sit_cands:
        return {
            "error": "sitting_silence_not_found",
            "duration": duration,
            "part1_start": p1_start,
            "speech": speech,
        }
    sit = sit_cands[0]
    p1_end = sit["time_p1_end"]
    p2_start = sit["time_p2_start"]

    p2e_cands = score_part2_end_candidates(speech, silences, shots, duration, part2_start=p2_start)
    p2_windows: list[dict[str, Any]] = []
    for i, c in enumerate(p2e_cands):
        p2_windows.append({
            "id": f"p2e_{i}",
            "start": max(p2_start, c["time"] - WINDOW_RADIUS * 2),
            "end": min(duration, c["time"] + WINDOW_RADIUS),
        })
    p2_win_results = transcribe_windows(audio_path, model_dir, p2_windows, device=device)

    best_p2 = None
    best_p2_conf = 0.0
    dominant_lang = "ar"
    for i, c in enumerate(p2e_cands):
        wid = f"p2e_{i}"
        words = p2_win_results.get(wid, {}).get("words", [])
        if words:
            dominant_lang = p2_win_results[wid].get("language", "ar")
        closing = find_last_closing(words, dominant_lang=dominant_lang)
        if closing:
            conf = 0.9
            combined = 0.5 * c["score"] + 0.5 * conf
            if combined > best_p2_conf:
                best_p2_conf = combined
                best_p2 = {"time": closing["end_time"] + 1.0, "confidence": combined}
    if best_p2 is None:
        c = p2e_cands[0]
        best_p2 = {"time": c["time"], "confidence": c["score"] * 0.6}

    p2_end = min(duration, best_p2["time"])
    overall = min(best_p1["confidence"], 1.0, best_p2["confidence"])

    _emit(progress_cb, {"stage": "done", "message": "Detection complete", "progress": 1.0})

    return {
        "duration": duration,
        "part1": {
            "start": p1_start,
            "end": p1_end,
            "confidence": best_p1["confidence"],
            "transcript_at_start": best_p1["transcript"],
            "anchor": best_p1["anchor"],
        },
        "part2": {
            "start": p2_start,
            "end": p2_end,
            "confidence": best_p2["confidence"],
        },
        "lang_dominant": dominant_lang,
        "overall_confidence": overall,
        "candidates": {
            "part1_start": p1_cands,
            "sitdown": sit_cands,
            "part2_end": p2e_cands,
        },
    }
