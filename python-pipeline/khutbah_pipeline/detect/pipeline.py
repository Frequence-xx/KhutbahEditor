from typing import Any, Callable, Optional
from khutbah_pipeline.detect.transcribe import transcribe_multilingual
from khutbah_pipeline.detect.silence import detect_silences
from khutbah_pipeline.detect.phrases import (
    find_first_opening,
    find_first_adhan_end,
    find_last_closing,
)


OPENING_BUFFER = 5.0
ADHAN_END_BUFFER = 3.0       # 3s pause typically separates adhan-end from khutbah-start
DUA_END_BUFFER = 1.0
MIN_PART1_DURATION = 300.0   # 5 min — silences within this window aren't the sitting silence
END_GUARD_SECONDS = 300.0    # 5 min from end — silences past this aren't the sitting silence
ADHAN_FALLBACK_CONFIDENCE = 0.55  # capped — caller should manual-verify when this fires


# Indirection so tests can monkeypatch
def _transcribe(audio_path: str, model_dir: str, progress_cb: Optional[Callable[[dict[str, Any]], None]] = None) -> dict[str, Any]:
    return transcribe_multilingual(audio_path, model_dir, progress_cb=progress_cb)


def _silences(audio_path: str, noise_db: float, min_duration: float) -> list[dict[str, Any]]:
    return detect_silences(audio_path, noise_db, min_duration)


def run_detection_pipeline(
    audio_path: str,
    model_dir: str,
    silence_noise_db: float = -35.0,
    silence_min_duration: float = 1.5,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Run the 7-stage khutbah detection pipeline.

    Returns a dict with `part1`/`part2` boundary times + confidences and
    `overall_confidence`. On a hard stage failure returns an `error` key
    per spec §4.7 ("Defensive paths").
    """
    if progress_cb:
        progress_cb({"stage": "transcribe", "message": "Starting transcription…", "progress": 0.0})
    transcript = _transcribe(audio_path, model_dir, progress_cb=progress_cb)
    duration: float = transcript["duration"]
    words: list[dict[str, Any]] = transcript["words"]
    dominant: str = transcript["lang_dominant"]
    if progress_cb:
        progress_cb({"stage": "detect_boundaries", "message": "Locating khutbah opening phrase…", "progress": 0.7})

    # Stage 3a: opening phrase (إن الحمد لله — always Arabic)
    opening = find_first_opening(words)
    anchor_kind = "opening"
    anchor: Optional[dict[str, Any]] = opening

    # Stage 3b fallback: adhan end (الله أكبر … لا إله إلا الله) — for the rare
    # case the khateeb skips the standard opening. The adhan immediately
    # precedes the khutbah, so its end is a usable Part 1 anchor with reduced
    # confidence so the renderer prompts the user to verify.
    if anchor is None:
        anchor = find_first_adhan_end(words)
        anchor_kind = "adhan_end"

    if anchor is None:
        return {"error": "opening_not_found", "duration": duration, "words": words}

    if anchor_kind == "opening":
        part1_start = max(0.0, anchor["start_time"] - OPENING_BUFFER)
        n_anchor_words = max(1, anchor["end_word_idx"] - anchor["start_word_idx"] + 1)
        part1_start_conf = sum(
            w["probability"] for w in words[anchor["start_word_idx"]:anchor["end_word_idx"] + 1]
        ) / n_anchor_words
    else:
        # Adhan-end fallback: Part 1 starts shortly AFTER the adhan ends.
        part1_start = min(duration, anchor["end_time"] + ADHAN_END_BUFFER)
        part1_start_conf = ADHAN_FALLBACK_CONFIDENCE

    if progress_cb:
        anchor_label = "opening phrase" if anchor_kind == "opening" else "adhan end (fallback)"
        progress_cb({
            "stage": "detect_boundaries",
            "message": f"Found {anchor_label} at {part1_start:.0f}s; finding sitting silence…",
            "progress": 0.85,
        })

    # Stage 4: sitting silence — longest silence in [part1_start + 5min, duration - 5min]
    silences = _silences(audio_path, silence_noise_db, silence_min_duration)
    valid = [
        s for s in silences
        if s["start"] >= part1_start + MIN_PART1_DURATION
        and s["end"] <= duration - END_GUARD_SECONDS
    ]
    if not valid:
        return {
            "error": "sitting_silence_not_found",
            "duration": duration,
            "part1_start": part1_start,
            "all_silences": silences,
        }
    longest = max(valid, key=lambda s: s["duration"])
    part1_end = longest["start"]
    part2_start = longest["end"]
    silence_conf = min(longest["duration"] / 3.0, 1.0)

    if progress_cb:
        progress_cb({
            "stage": "detect_boundaries",
            "message": f"Found sitting silence at {part1_end:.0f}s; finding dua close…",
            "progress": 0.95,
        })

    # Stage 5: dua end
    p2_first_idx = next(
        (i for i, w in enumerate(words) if w["start"] >= part2_start),
        len(words),
    )
    closing = find_last_closing(words, dominant_lang=dominant, search_from_word=p2_first_idx)
    if closing:
        part2_end = closing["end_time"] + DUA_END_BUFFER
        end_conf = 0.95
    else:
        confident = [w for w in words[p2_first_idx:] if w["probability"] > 0.5]
        part2_end = (confident[-1]["end"] + 2.0) if confident else duration
        end_conf = 0.6

    overall = min(part1_start_conf, silence_conf, end_conf)
    transcript_at_start = " ".join(
        w["word"] for w in words[anchor["start_word_idx"]:anchor["end_word_idx"] + 1]
    )
    if anchor_kind == "adhan_end":
        transcript_at_start = f"[adhan-end fallback] {transcript_at_start}"
    return {
        "duration": duration,
        "part1": {
            "start": part1_start,
            "end": part1_end,
            "confidence": part1_start_conf,
            "transcript_at_start": transcript_at_start,
            "anchor": anchor_kind,
        },
        "part2": {
            "start": part2_start,
            "end": part2_end,
            "confidence": end_conf,
            "transcript_at_end": " ".join(w["word"] for w in words[max(0, len(words) - 12):]),
        },
        "all_silences": silences,
        "lang_dominant": dominant,
        "overall_confidence": overall,
    }
