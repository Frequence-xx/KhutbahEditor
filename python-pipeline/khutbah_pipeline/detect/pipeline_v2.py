"""V2 detection orchestrator.

Strategy:
  1. ffmpeg silencedetect → silences        (~30 s)
  2. Full-audio scan with whisper-base, lang=ar  (~3-5 min CPU on a 30 min source)
     → all words with timestamps
  3. Phrase match: find first OPENING or first KHUTBATUL_HAAJA → Part 1 start
  4. Sit-down: longest silence in [P1_start + 5min, end - 5min]
     bounded by the next "opening" (Part 2 start = repeat of "ان الحمد لله")
  5. Closing dua: find_last_closing in transcript after Part 2 start
  6. Part 2 end = closing match end + 1s buffer

This replaces the silero+candidate-window approach because silero misclassifies
Quran recitation as non-speech, and tiny-whisper is too small for Arabic. The
full-audio scan with whisper-base is slower (~5 min vs 1 min) but reliable —
it finds the actual khutbah opening even when the pre-roll is silent or
recitation-heavy.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from khutbah_pipeline.detect.silence import detect_silences
from khutbah_pipeline.detect.window_transcribe import transcribe_windows
from khutbah_pipeline.detect.phrases import (
    find_first_opening,
    find_first_adhan_end,
    find_first_khutbatul_haaja,
    find_last_closing,
    KHUTBATUL_HAAJA_BUFFER,
    _find_phrase,
    OPENING_AR,
)
from khutbah_pipeline.util.ffmpeg import ffprobe_json


OPENING_BUFFER = 5.0
DUA_END_BUFFER = 1.0
MIN_PART1_DURATION = 300.0   # silences within this window aren't the sitting silence
END_GUARD_SECONDS = 60.0     # silences in the last 60 s are post-roll, not the dua close


def _probe_duration(path: str) -> float:
    meta = ffprobe_json(path)
    return float(meta.get("format", {}).get("duration") or 0)


def _emit(cb: Optional[Callable[[dict[str, Any]], None]], payload: dict[str, Any]) -> None:
    if cb:
        cb(payload)


def _find_second_opening(words: list[dict[str, Any]], after_word_idx: int) -> Optional[dict[str, Any]]:
    """Find the next 'ان الحمد لله' AFTER after_word_idx — Part 2's opening."""
    for phrase in OPENING_AR:
        m = _find_phrase(words, phrase, start_at=after_word_idx)
        if m:
            return m
    return None


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

    _emit(progress_cb, {
        "stage": "silence",
        "message": "Detecting silences…",
        "progress": 0.05,
    })
    silences = detect_silences(audio_path, silence_noise_db, silence_min_duration)

    _emit(progress_cb, {
        "stage": "transcribe",
        "message": f"Transcribing full audio with whisper-base (lang=ar)…",
        "progress": 0.10,
    })
    # Single full-audio window — whisper-base internally chunks into 30s
    # segments. language="ar" because the khutbah opening is always Arabic;
    # forcing the language stops whisper from auto-detecting "Welsh" on
    # quiet audio (real failure mode observed during dev).
    full_window = [{"id": "full", "start": 0.0, "end": duration}]
    win_results = transcribe_windows(
        audio_path, model_dir, full_window,
        device=device, language="ar", progress_cb=progress_cb,
    )
    words = win_results.get("full", {}).get("words", [])
    if not words:
        return {
            "error": "transcript_empty",
            "duration": duration,
            "hint": "whisper produced no words — audio may be silent or unsupported codec",
        }

    _emit(progress_cb, {
        "stage": "detect_boundaries",
        "message": "Locating khutbah opening phrase…",
        "progress": 0.85,
    })

    # Stage A: find Part 1 start anchor.
    # Try the canonical opening "ان الحمد لله" first.
    opening = find_first_opening(words)
    anchor_kind = "opening"
    if opening is not None:
        p1_start_word_idx = opening["end_word_idx"]
        p1_start = max(0.0, opening["start_time"] - OPENING_BUFFER)
        n = max(1, opening["end_word_idx"] - opening["start_word_idx"] + 1)
        p1_conf = sum(
            w["probability"]
            for w in words[opening["start_word_idx"]:opening["end_word_idx"] + 1]
        ) / n
        transcript_p1 = " ".join(
            w["word"] for w in words[opening["start_word_idx"]:opening["end_word_idx"] + 1]
        )
    else:
        # Fall back to khutbatul-haaja: the three Quranic verses recited
        # straight after the bare opening. ASR misses the bare "ان الحمد لله"
        # often (low-volume start), but the verses are 5-15s later and louder.
        # Time-gate: real khutbah opening is never in the first 10 min
        # of a recording — there's always Quran recitation + adhan first.
        # This avoids the fuzzy matcher locking onto adhan content like
        # "أشهد ولا إله إلا الله" which has many particles in common with
        # the haaja verses. We also try the adhan-end gate as a secondary
        # bound (more accurate when find_first_adhan_end actually fires).
        MIN_KHUTBAH_OPENING_TIME = 600.0  # 10 min
        haaja_start_word = next(
            (i for i, w in enumerate(words) if w["start"] >= MIN_KHUTBAH_OPENING_TIME),
            0,
        )
        adhan = find_first_adhan_end(words, max_position_seconds=1200.0)
        if adhan is not None:
            haaja_start_word = max(haaja_start_word, adhan["end_word_idx"] + 1)
        haaja = find_first_khutbatul_haaja(words, threshold=0.5, start_at=haaja_start_word)
        if haaja is None:
            return {
                "error": "opening_not_found",
                "duration": duration,
                "hint": "neither 'ان الحمد لله' nor khutbatul-haaja verses were found in the transcript",
                "transcript_word_count": len(words),
            }
        anchor_kind = "khutbatul_haaja"
        p1_start_word_idx = haaja["end_word_idx"]
        p1_start = max(0.0, haaja["start_time"] - KHUTBATUL_HAAJA_BUFFER)
        n = max(1, haaja["end_word_idx"] - haaja["start_word_idx"] + 1)
        p1_conf = (
            sum(
                w["probability"]
                for w in words[haaja["start_word_idx"]:haaja["end_word_idx"] + 1]
            ) / n
        ) * 0.85  # cap — caller should manually verify
        transcript_p1 = (
            "[khutbatul-haaja] "
            + " ".join(
                w["word"]
                for w in words[haaja["start_word_idx"]:haaja["end_word_idx"] + 1]
            )
        )

    # Stage B: find Part 2 start anchor (the SECOND occurrence of the opening
    # phrase — the imam reopens with "ان الحمد لله" after the sit-down).
    second_opening = _find_second_opening(words, after_word_idx=p1_start_word_idx + 5)
    if second_opening is not None:
        p2_start_anchor = second_opening["start_time"] - OPENING_BUFFER
        # Pick the actual sit-down silence: longest silence in [p1_start+min,
        # second_opening_start]. That's the silence the imam crossed.
        valid = [
            s for s in silences
            if s["start"] >= p1_start + MIN_PART1_DURATION
            and s["end"] <= p2_start_anchor + 5.0
        ]
        if valid:
            longest = max(valid, key=lambda s: s["duration"])
            p1_end = longest["start"]
            p2_start = max(longest["end"], p2_start_anchor)
        else:
            # No silence between — use the second opening as the boundary.
            p1_end = p2_start_anchor - 5.0
            p2_start = p2_start_anchor
        p2_anchor_word_idx = second_opening["end_word_idx"]
    else:
        # No second opening — fall back to longest silence in the middle.
        valid = [
            s for s in silences
            if s["start"] >= p1_start + MIN_PART1_DURATION
            and s["end"] <= duration - END_GUARD_SECONDS
        ]
        if not valid:
            return {
                "error": "sitting_silence_not_found",
                "duration": duration,
                "part1_start": p1_start,
                "all_silences": silences,
            }
        longest = max(valid, key=lambda s: s["duration"])
        p1_end = longest["start"]
        p2_start = longest["end"]
        # No reliable index for closing search — start from p2_start word
        p2_anchor_word_idx = next(
            (i for i, w in enumerate(words) if w["start"] >= p2_start),
            len(words),
        )

    _emit(progress_cb, {
        "stage": "detect_boundaries",
        "message": f"Sit-down at {p1_end:.0f}s; finding closing dua…",
        "progress": 0.92,
    })

    # Stage C: closing dua anchor
    closing = find_last_closing(words, dominant_lang="ar", search_from_word=p2_anchor_word_idx)
    if closing is not None:
        p2_end = min(duration, closing["end_time"] + DUA_END_BUFFER)
        p2_conf = 0.90
        transcript_p2 = " ".join(
            w["word"] for w in words[max(0, len(words) - 12):]
        )
    else:
        # No closing — use last confident word past p2_start
        confident = [
            w for w in words[p2_anchor_word_idx:] if w["probability"] > 0.5
        ]
        p2_end = (confident[-1]["end"] + 2.0) if confident else duration
        p2_conf = 0.5
        transcript_p2 = ""

    overall = min(p1_conf, p2_conf, 1.0)

    _emit(progress_cb, {"stage": "done", "message": "Detection complete", "progress": 1.0})

    return {
        "duration": duration,
        "part1": {
            "start": p1_start,
            "end": p1_end,
            "confidence": p1_conf,
            "transcript_at_start": transcript_p1,
            "anchor": anchor_kind,
        },
        "part2": {
            "start": p2_start,
            "end": p2_end,
            "confidence": p2_conf,
            "transcript_at_end": transcript_p2,
        },
        "lang_dominant": "ar",
        "overall_confidence": overall,
    }
