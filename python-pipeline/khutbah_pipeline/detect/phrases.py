from typing import Optional, Any
from khutbah_pipeline.detect.normalize_arabic import normalize_arabic


# Opening phrase — always Arabic regardless of khutbah language (per spec §4 stage 3).
# Stored already-normalized (no diacritics, unified alef).
OPENING_AR: list[str] = ["ان الحمد لله"]

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


def find_last_closing(
    words: list[dict[str, Any]],
    dominant_lang: str,
    search_from_word: int = 0,
) -> Optional[dict[str, Any]]:
    """Return the LATEST closing-phrase match across the dominant language and Arabic.

    Per spec §4 stage 5: search dominant language first, then Arabic anyway
    (Arabic dua often closes a Dutch/English khutbah — code-switch).
    Pick the latest match.
    """
    candidates: list[dict[str, Any]] = []
    langs_to_check = [dominant_lang] + (["ar"] if dominant_lang != "ar" else [])
    for lang in langs_to_check:
        for phrase in CLOSINGS.get(lang, []):
            m = _find_phrase(words, phrase, start_at=search_from_word)
            if m:
                candidates.append(m)
    if not candidates:
        return None
    return max(candidates, key=lambda x: x["end_time"])
