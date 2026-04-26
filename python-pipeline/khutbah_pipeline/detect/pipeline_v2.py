"""V2 detection orchestrator.

Strategy:
  1. ffmpeg silencedetect → silences        (~30 s)
  2. Full-audio scan with whisper-base, lang=ar  (~3-5 min CPU on a 30 min source)
     → all words with timestamps
  3. Phrase match: find first OPENING or first KHUTBATUL_HAAJA → Part 1 start
  4. Sit-down: longest silence in [P1_start + 5min, end - 5min]
     bounded by the next "opening" (Part 2 start = repeat of "ان الحمد لله")
  5. Part 2 end = source duration (closing dua stays in the cut by design;
     trimming it created low-confidence boundaries when ASR missed the dua)

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
    find_first_opening_after_long_silence,
    find_first_khutbatul_haaja,
    find_first_khutbatul_haaja_after_long_silence,
    find_second_opening_after_long_silence,
    find_last_closing,
    HAAJA_STACK_WINDOW_SECONDS,
    KHUTBATUL_HAAJA_BUFFER,
)
from khutbah_pipeline.detect.confidence import anchor_score, combine_confidences
from khutbah_pipeline.util.ffmpeg import ffprobe_json


OPENING_BUFFER = 5.0
CLOSING_TAIL_SECONDS = 5.0   # keep this many seconds of audio AFTER the closing dua's last word
MIN_PART1_DURATION = 300.0   # silences within this window aren't the sitting silence
END_GUARD_SECONDS = 60.0     # silences in the last 60 s are post-roll, not the sit-down


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
    # Use the silence-gated opening matcher so we only accept the bare
    # opening when it's preceded by a long silence (>=10 s) — that's
    # the imam-stepping-up-to-the-minbar moment. Without this gate the
    # matcher false-positives on adhan-tail content where 'الحمد لله'
    # appears as a substring of 'بسم الله الحمد لله...' inside the call.
    opening = find_first_opening_after_long_silence(words, silences)
    anchor_kind = "opening"
    if opening is not None:
        p1_start_word_idx = opening["end_word_idx"]
        p1_start = max(0.0, opening["start_time"] - OPENING_BUFFER)
        # Stack haaja evidence if it fires within HAAJA_STACK_WINDOW after
        # the opening. The bare opening's word probabilities are often low
        # because the imam starts quietly, but the haaja verses 5-15 s
        # later are louder and transcribe more confidently — combining the
        # two pulls Part 1 confidence above the auto-pilot threshold for
        # sources where ASR was uncertain about the opening alone.
        haaja_after_opening = find_first_khutbatul_haaja(
            words,
            threshold=0.5,
            start_at=opening["end_word_idx"] + 1,
        )
        if haaja_after_opening is not None:
            time_gap = haaja_after_opening["start_time"] - opening["end_time"]
            if time_gap > HAAJA_STACK_WINDOW_SECONDS or time_gap < 0:
                haaja_after_opening = None

        if haaja_after_opening is not None:
            anchor_kind = "opening+haaja"
            p1_conf = combine_confidences(
                anchor_score(words, opening),
                anchor_score(words, haaja_after_opening),
            )
            transcript_p1 = " ".join(
                w["word"]
                for w in words[
                    opening["start_word_idx"]:haaja_after_opening["end_word_idx"] + 1
                ]
            )
        else:
            p1_conf = anchor_score(words, opening) or 0.0
            transcript_p1 = " ".join(
                w["word"]
                for w in words[opening["start_word_idx"]:opening["end_word_idx"] + 1]
            )
    else:
        # Fall back to khutbatul-haaja: the three Quranic verses recited
        # straight after the bare opening. Whisper misses the bare opening
        # often (low-volume start, mistranscriptions like 'أحمد' instead of
        # 'إن الحمد'), but the verses are 5-30 s later and louder.
        #
        # Silence-gate the match the same way the bare opening is gated:
        # haaja must be preceded by a long silence (the imam-ready
        # silence) within HAAJA_POST_SILENCE_WINDOW_SECONDS. This kills
        # haaja-shaped false positives in pre-roll Quran recitation
        # without imposing a wall-clock floor — short-pre-roll sources
        # (e.g. v6yLY17uMQE: imam opens at 3:14) anchor correctly.
        haaja = find_first_khutbatul_haaja_after_long_silence(
            words, silences, threshold=0.5,
        )
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
        # Cap at 0.85: haaja-only fallback is weaker evidence than the
        # opening (haaja-like patterns appear inside the khutbah body
        # too), so even a perfect-probability haaja match keeps the
        # source below the 0.90 auto-pilot threshold for manual verify.
        haaja_score = anchor_score(words, haaja) or 0.0
        p1_conf = min(haaja_score, 0.85)
        transcript_p1 = (
            "[khutbatul-haaja] "
            + " ".join(
                w["word"]
                for w in words[haaja["start_word_idx"]:haaja["end_word_idx"] + 1]
            )
        )

    # Stage B: find Part 2 start anchor (the SECOND occurrence of the opening
    # phrase — the imam reopens with "ان الحمد لله" after the sit-down).
    second_opening = find_second_opening_after_long_silence(
        words, silences, after_word_idx=p1_start_word_idx + 5,
    )
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

    # Stage C: trim Part 2 a few seconds after the closing dua. The imam
    # leaves the minbar shortly after the closing — keeping the post-roll
    # adds dead air. If the closing matcher misses, fall back to the source
    # duration (per the 2026-04-26 product direction: include the closing
    # over trimming too aggressively when uncertain).
    p2_start_word_idx = next(
        (i for i, w in enumerate(words) if w["start"] >= p2_start),
        len(words),
    )
    closing = find_last_closing(words, dominant_lang="ar", search_from_word=p2_start_word_idx)
    if closing is not None:
        p2_end = min(duration, closing["end_time"] + CLOSING_TAIL_SECONDS)
        transcript_p2 = " ".join(
            w["word"]
            for w in words[closing["start_word_idx"]:closing["end_word_idx"] + 1]
        )
    else:
        p2_end = duration
        transcript_p2 = " ".join(
            w["word"] for w in words[max(0, len(words) - 12):]
        )

    # Part 2 confidence: stack second_opening + closing when both fire.
    p2_conf = combine_confidences(
        anchor_score(words, second_opening),
        anchor_score(words, closing),
    )

    overall = combine_confidences(p1_conf, p2_conf)

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
