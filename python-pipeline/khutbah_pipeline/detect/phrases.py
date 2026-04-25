from typing import Optional, Any
from khutbah_pipeline.detect.normalize_arabic import normalize_arabic


# Opening phrase — always Arabic regardless of khutbah language (per spec §4 stage 3).
# Stored already-normalized (no diacritics, unified alef).
OPENING_AR: list[str] = ["ان الحمد لله"]

# Adhan-end fallback for when OPENING_AR is missing (rare — happens when the
# khateeb skips the standard opening). The adhan immediately precedes the
# khutbah, so its ending phrase is a reliable anchor for Part 1 start.
# Listed longest-first so we prefer the most specific match.
# Pre-normalized — match normalize_arabic() output (no diacritics, unified alef).
ADHAN_END_AR: list[str] = [
    "الله اكبر الله اكبر لا اله الا الله",
    "لا اله الا الله",
]

# Closing phrase library per language (per spec §4 stage 5).
# All entries are pre-normalized to match the normalize_arabic() output.
CLOSINGS: dict[str, list[str]] = {
    "ar": [
        "ربنا اتنا في الدنيا حسنه وفي الاخره حسنه",
        "واخر دعوانا ان الحمد لله رب العالمين",
        "سبحان ربك رب العزه عما يصفون",
        "اقم الصلاه",
    ],
    "nl": [
        "onze heer geef ons in deze wereld het goede",
        "heer der werelden",
        "verricht het gebed",
    ],
    "en": [
        "our lord give us in this world",
        "lord of the worlds",
        "establish the prayer",
    ],
}


def _normalize(text: str) -> str:
    return normalize_arabic(text)


def _join_words(words: list[dict[str, Any]], i: int, n: int) -> str:
    return _normalize(" ".join(w["word"] for w in words[i:i + n]))


def _find_phrase(
    words: list[dict[str, Any]],
    phrase: str,
    start_at: int = 0,
) -> Optional[dict[str, Any]]:
    norm_phrase = _normalize(phrase)
    n_phrase = len(norm_phrase.split())
    if n_phrase == 0:
        return None
    for i in range(start_at, len(words) - n_phrase + 1):
        candidate = _join_words(words, i, n_phrase)
        if norm_phrase in candidate:
            return {
                "start_word_idx": i,
                "end_word_idx": i + n_phrase - 1,
                "start_time": words[i]["start"],
                "end_time": words[i + n_phrase - 1]["end"],
                "matched_phrase": phrase,
            }
    return None


def find_first_opening(words: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Return the first match of any OPENING_AR phrase in the word list."""
    for phrase in OPENING_AR:
        m = _find_phrase(words, phrase)
        if m:
            return m
    return None


def find_first_adhan_end(
    words: list[dict[str, Any]],
    max_position_seconds: float = 600.0,
) -> Optional[dict[str, Any]]:
    """Return the earliest adhan-end match before max_position_seconds.

    Tries longest/most-specific phrase first so a full
    "الله أكبر الله أكبر لا إله إلا الله" match wins over the bare
    "لا إله إلا الله" tail (the latter can also appear in the khutbah body).

    The position guard rejects matches past max_position_seconds — adhans
    don't occur 20 minutes into a recording. Default 10 min is generous;
    real adhans typically end within 4–5 min of recording start.
    """
    for phrase in ADHAN_END_AR:
        m = _find_phrase(words, phrase)
        if m and m["end_time"] <= max_position_seconds:
            return m
    return None


def find_last_closing(
    words: list[dict[str, Any]],
    dominant_lang: str = "ar",   # informational; kept for API stability
    search_from_word: int = 0,
) -> Optional[dict[str, Any]]:
    """Return the LATEST closing-phrase match across all configured languages.

    Per spec §4 stage 5: search dominant language first, then Arabic anyway
    (code-switch case). We simplify by searching ALL languages and returning
    the latest match — equivalent in result, more robust to per-word language
    tagging issues (e.g., when whisper assigns a single file-level lang to
    every word, dominant_lang doesn't reflect Part 2's actual language).

    The dominant_lang parameter is retained for API stability and is unused
    today; future per-segment language detection may use it as a heuristic.
    """
    _ = dominant_lang  # noqa: F841 — see docstring
    candidates: list[dict[str, Any]] = []
    for lang in CLOSINGS:
        for phrase in CLOSINGS[lang]:
            m = _find_phrase(words, phrase, start_at=search_from_word)
            if m:
                candidates.append(m)
    if not candidates:
        return None
    return max(candidates, key=lambda x: x["end_time"])
