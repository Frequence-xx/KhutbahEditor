from typing import Optional, Any
from khutbah_pipeline.detect.normalize_arabic import normalize_arabic


# Opening phrase — always Arabic regardless of khutbah language (per spec §4 stage 3).
# Stored already-normalized (no diacritics, unified alef).
OPENING_AR: list[str] = ["ان الحمد لله"]


# Part 2 second-opening: imams either repeat the bare opening "إن الحمد لله"
# OR launch with the fātiḥa-style "الحمد لله رب العالمين" / variants. The
# canonical Iziyi source uses the second form, so the bare-opening list alone
# misses Part 2 entirely. Listed in normalized form, longest-first so the
# more specific phrase preempts a partial match of the shorter one.
SECOND_OPENING_AR: list[str] = [
    "الحمد لله رب العالمين",
    "ان الحمد لله",
]


# Khutbatul-haaja: three Quranic verses recited straight after "إن الحمد لله".
# Universal markers for "khateeb just opened the khutbah" — used as a fallback
# anchor when whisper missed the bare opening (often the case with low-volume
# pre-roll where ASR misses the first few seconds). The actual "إن الحمد لله"
# sits 5-15s BEFORE these verses fire, so we subtract a buffer when using
# these as the Part 1 start anchor. Distinctive fragments — pre-normalized.
# Khutbah introduction phrases — these come together right after "إن الحمد لله"
# and are far more reliably transcribed than the bare opening (which whisper
# often misses on low-volume starts). All listed in PRE-NORMALIZED form
# (no diacritics, unified alef). Matched FUZZILY (≥50% similarity) since
# whisper introduces small transcription errors on these long verses.
KHUTBATUL_HAAJA_AR: list[str] = [
    # Khutbatul-haaja's three Quranic verses — use longer fragments so
    # fuzzy matching has enough signal to lock on.
    "اتقوا الله حق تقاته ولا تموتن الا وانتم مسلمون",
    "اتقوا ربكم الذي خلقكم من نفس واحده",
    "اتقوا الله وقولوا قولا سديدا",
    # Standard "amma ba'd" transition + the hadith that follows. Whisper
    # transcribes this segment more reliably than the verses themselves
    # because it's plain prose, not stylized recitation.
    "اما بعد فان اصدق الحديث كتاب الله",
    "اصدق الحديث كتاب الله وخير الهدي هدي محمد",
    # Final hadith of the standard intro. Distinctive due to the unique
    # combination of "بدعه" + "ضلاله" + "النار".
    "كل بدعه ضلاله وكل ضلاله في النار",
]
KHUTBATUL_HAAJA_BUFFER = 18.0  # seconds to rewind from haaja match to opening

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


def _fuzzy_find_phrase(
    words: list[dict[str, Any]],
    phrase: str,
    threshold: float = 0.5,
    start_at: int = 0,
) -> Optional[dict[str, Any]]:
    """Find the EARLIEST sliding window of words whose normalized text
    has SequenceMatcher ratio >= threshold against the normalized phrase.

    Used for whisper-transcribed text that has small misspellings / merged
    or split tokens but is largely correct. Threshold 0.5 catches cases
    where ~half the characters match — empirically robust for Arabic
    recitation transcribed by whisper-base.
    """
    from difflib import SequenceMatcher
    norm_phrase = _normalize(phrase)
    n_words = max(1, len(norm_phrase.split()))
    best: Optional[dict[str, Any]] = None
    best_ratio = 0.0
    for i in range(start_at, len(words) - n_words + 1):
        candidate = _join_words(words, i, n_words)
        ratio = SequenceMatcher(None, norm_phrase, candidate).ratio()
        if ratio >= threshold and ratio > best_ratio:
            best_ratio = ratio
            best = {
                "start_word_idx": i,
                "end_word_idx": i + n_words - 1,
                "start_time": words[i]["start"],
                "end_time": words[i + n_words - 1]["end"],
                "matched_phrase": phrase,
                "similarity": ratio,
            }
            # If ratio is very high, accept immediately — no need to keep scanning
            if ratio >= 0.85:
                return best
    return best


def find_first_khutbatul_haaja(
    words: list[dict[str, Any]],
    threshold: float = 0.5,
    start_at: int = 0,
) -> Optional[dict[str, Any]]:
    """Return the EARLIEST khutbatul-haaja / khutbah-intro match.

    Tries each phrase in KHUTBATUL_HAAJA_AR with FUZZY matching at the
    given threshold (default 0.5). The phrases come together at the start
    of every khutbah, so any single match is sufficient to anchor Part 1.
    Returns the match with the EARLIEST start_time across all phrases —
    the earliest hit anchors closer to the actual opening.

    Caller should subtract KHUTBATUL_HAAJA_BUFFER from start_time to get
    the Part 1 start (these phrases come 5-20s after the bare opening).
    """
    candidates: list[dict[str, Any]] = []
    for phrase in KHUTBATUL_HAAJA_AR:
        m = _fuzzy_find_phrase(words, phrase, threshold=threshold, start_at=start_at)
        if m:
            candidates.append(m)
    if not candidates:
        return None
    return min(candidates, key=lambda x: x["start_time"])


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


def find_second_opening(
    words: list[dict[str, Any]],
    after_word_idx: int,
) -> Optional[dict[str, Any]]:
    """Find the next Part-2 opener AFTER after_word_idx.

    Tries SECOND_OPENING_AR phrases in declaration order (longest-first so
    'الحمد لله رب العالمين' preempts the substring match of 'ان الحمد لله').
    """
    for phrase in SECOND_OPENING_AR:
        m = _find_phrase(words, phrase, start_at=after_word_idx)
        if m:
            return m
    return None


HAAJA_STACK_WINDOW_SECONDS = 30.0


def find_part1_anchors(
    words: list[dict[str, Any]],
) -> dict[str, Optional[dict[str, Any]]]:
    """Return both Part-1 anchors that match — opening AND/OR haaja.

    The bare "إن الحمد لله" and the khutbatul-haaja verses appear together
    at the start of every khutbah (haaja sits 5-20 s after the bare opening).
    When BOTH match within HAAJA_STACK_WINDOW_SECONDS of each other, the
    pipeline can stack their confidences as two independent ASR
    confirmations of Part 1 start. When only one matches, that's the
    sole anchor (haaja's downstream confidence stays capped — see
    pipeline_v2 caller for the cap rationale).

    Returns {"opening": <match or None>, "haaja": <match or None>}.
    """
    opening = find_first_opening(words)

    if opening is not None:
        # Haaja by definition comes AFTER the opening — start the search past
        # the opening's last word so the fuzzy matcher can't lock onto a
        # window that overlaps the opening itself (the trailing "لله" from
        # "إن الحمد لله" matches the haaja prefix and trips the early-exit
        # at ratio >= 0.85).
        haaja = find_first_khutbatul_haaja(
            words,
            threshold=0.5,
            start_at=opening["end_word_idx"] + 1,
        )
        if haaja is not None:
            time_gap = haaja["start_time"] - opening["end_time"]
            if time_gap > HAAJA_STACK_WINDOW_SECONDS:
                haaja = None
        return {"opening": opening, "haaja": haaja}

    haaja = find_first_khutbatul_haaja(words, threshold=0.5)
    return {"opening": None, "haaja": haaja}
