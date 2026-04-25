from typing import Any, Callable, Optional
from khutbah_pipeline.detect.transcribe import transcribe_multilingual
from khutbah_pipeline.detect.silence import detect_silences
from khutbah_pipeline.detect.phrases import find_first_opening, find_last_closing


OPENING_BUFFER = 5.0
DUA_END_BUFFER = 1.0
MIN_PART1_DURATION = 300.0   # 5 min — silences within this window aren't the sitting silence
END_GUARD_SECONDS = 300.0    # 5 min from end — silences past this aren't the sitting silence


# Indirection so tests can monkeypatch
def _transcribe(audio_path: str, model_dir: str) -> dict[str, Any]:
    return transcribe_multilingual(audio_path, model_dir)


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
        progress_cb({"stage": "transcribe", "progress": 0.0})
    transcript = _transcribe(audio_path, model_dir)
    duration: float = transcript["duration"]
    words: list[dict[str, Any]] = transcript["words"]
    dominant: str = transcript["lang_dominant"]
    if progress_cb:
        progress_cb({"stage": "detect_boundaries", "progress": 0.7})

    # Stage 3: opening (إن الحمد لله — always Arabic)
    opening = find_first_opening(words)
    if opening is None:
        return {"error": "opening_not_found", "duration": duration, "words": words}

    part1_start = max(0.0, opening["start_time"] - OPENING_BUFFER)
    n_opening_words = max(1, opening["end_word_idx"] - opening["start_word_idx"] + 1)
    part1_start_conf = sum(
        w["probability"] for w in words[opening["start_word_idx"]:opening["end_word_idx"] + 1]
    ) / n_opening_words

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
    return {
        "duration": duration,
        "part1": {
            "start": part1_start,
            "end": part1_end,
            "confidence": part1_start_conf,
            "transcript_at_start": " ".join(
                w["word"] for w in words[opening["start_word_idx"]:opening["end_word_idx"] + 1]
            ),
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
