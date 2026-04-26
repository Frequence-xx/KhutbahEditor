import pytest

from khutbah_pipeline.detect.phrases import (
    OPENING_AR,
    SECOND_OPENING_AR,
    CLOSINGS,
    find_first_opening,
    find_first_adhan_end,
    find_last_closing,
    find_second_opening,
)


def _ar_words(seq: list[tuple[str, float, float]]) -> list[dict]:
    return [{"word": w, "start": s, "end": e, "lang": "ar"} for w, s, e in seq]


def test_adhan_end_finds_full_takbir_shahada_sequence():
    """The full takbir+shahada is the most specific Part 1 anchor."""
    words = _ar_words([
        ("الله", 100.0, 100.3),
        ("أكبر", 100.4, 100.7),
        ("الله", 100.8, 101.1),
        ("أكبر", 101.2, 101.5),
        ("لا", 101.6, 101.8),
        ("إله", 101.9, 102.2),
        ("إلا", 102.3, 102.5),
        ("الله", 102.6, 103.0),
    ])
    match = find_first_adhan_end(words)
    assert match is not None
    assert match["start_time"] == 100.0
    assert match["end_time"] == 103.0


def test_adhan_end_falls_back_to_shahada_only():
    """When only the tail لا إله إلا الله is transcribed, that still anchors."""
    words = _ar_words([
        ("لا", 60.0, 60.2),
        ("إله", 60.3, 60.5),
        ("إلا", 60.6, 60.8),
        ("الله", 60.9, 61.2),
    ])
    match = find_first_adhan_end(words)
    assert match is not None
    assert match["end_time"] == 61.2


def test_adhan_end_rejects_match_past_position_guard():
    """A late لا إله إلا الله inside the khutbah body must not anchor Part 1."""
    words = _ar_words([
        ("لا", 1500.0, 1500.2),
        ("إله", 1500.3, 1500.5),
        ("إلا", 1500.6, 1500.8),
        ("الله", 1500.9, 1501.2),
    ])
    assert find_first_adhan_end(words, max_position_seconds=600.0) is None


def test_adhan_end_returns_none_when_absent():
    words = [{"word": "بسم", "start": 0, "end": 1, "lang": "ar"}]
    assert find_first_adhan_end(words) is None


def test_find_opening_returns_first_match():
    words = [
        {"word": "بسم", "start": 0.5, "end": 0.9, "lang": "ar"},
        {"word": "إن", "start": 5.0, "end": 5.4, "lang": "ar"},
        {"word": "الحمد", "start": 5.5, "end": 6.0, "lang": "ar"},
        {"word": "لله", "start": 6.1, "end": 6.6, "lang": "ar"},
    ]
    match = find_first_opening(words)
    assert match is not None
    assert match["start_word_idx"] == 1
    assert match["start_time"] == 5.0


def test_find_opening_returns_none_when_absent():
    words = [{"word": "hello", "start": 0, "end": 1, "lang": "en"}]
    assert find_first_opening(words) is None


# Real ASR variants observed on whisper-tiny / whisper-base output for the
# canonical opening "إن الحمد لله". The substring matcher must accept these.
@pytest.mark.parametrize("variant_words", [
    ["بأن", "الحمد", "لله"],   # canonical Iziyi source: tiny gave bāʾ-prefix
    ["وإن", "الحمد", "لله"],   # wāw-prefix (conjunction)
    ["إنّ", "الحمد", "لله"],   # shadda preserved
    ["فإن", "الحمد", "لله"],   # fāʾ-prefix
    ["إنَّ", "الْحَمْدَ", "لِلَّهِ"],  # full diacritics
])
def test_find_opening_accepts_asr_variants(variant_words):
    """Whisper introduces small prefix / diacritic variants on the opening
    phrase. Substring-after-normalisation handles these — lock the behaviour
    so future matcher changes don't silently regress on real ASR output."""
    words = _ar_words([
        ("بسم", 0.5, 0.9),
        (variant_words[0], 5.0, 5.4),
        (variant_words[1], 5.5, 6.0),
        (variant_words[2], 6.1, 6.6),
    ])
    match = find_first_opening(words)
    assert match is not None, f"matcher rejected variant {variant_words!r}"
    assert match["start_word_idx"] == 1


def test_find_closing_in_dutch():
    words = [
        {"word": "onze", "start": 100.0, "end": 100.3, "lang": "nl"},
        {"word": "heer", "start": 100.4, "end": 100.7, "lang": "nl"},
        {"word": "geef", "start": 100.8, "end": 101.0, "lang": "nl"},
        {"word": "ons", "start": 101.1, "end": 101.3, "lang": "nl"},
        {"word": "in", "start": 101.4, "end": 101.5, "lang": "nl"},
        {"word": "deze", "start": 101.6, "end": 101.8, "lang": "nl"},
        {"word": "wereld", "start": 101.9, "end": 102.3, "lang": "nl"},
        {"word": "het", "start": 102.4, "end": 102.5, "lang": "nl"},
        {"word": "goede", "start": 102.6, "end": 103.0, "lang": "nl"},
    ]
    match = find_last_closing(words, dominant_lang="nl")
    assert match is not None
    assert match["end_time"] == 103.0


def test_find_closing_arabic_dua_in_dutch_khutbah():
    """Code-switch case: Dutch lecture closes with Arabic dua (typical Al-Himmah)."""
    words = [
        {"word": "deze", "start": 100.0, "end": 100.3, "lang": "nl"},
        {"word": "wereld", "start": 100.4, "end": 100.7, "lang": "nl"},
        # Arabic dua at the end
        {"word": "ربنا", "start": 200.0, "end": 200.5, "lang": "ar"},
        {"word": "اتنا", "start": 200.6, "end": 201.0, "lang": "ar"},
        {"word": "في", "start": 201.1, "end": 201.3, "lang": "ar"},
        {"word": "الدنيا", "start": 201.4, "end": 201.8, "lang": "ar"},
        {"word": "حسنه", "start": 201.9, "end": 202.2, "lang": "ar"},
        {"word": "وفي", "start": 202.3, "end": 202.5, "lang": "ar"},
        {"word": "الاخره", "start": 202.6, "end": 203.0, "lang": "ar"},
        {"word": "حسنه", "start": 203.1, "end": 203.5, "lang": "ar"},
    ]
    # Even if we mistakenly pass dominant_lang="nl", the AR dua should still be found
    match = find_last_closing(words, dominant_lang="nl")
    assert match is not None
    assert "ربنا" in match["matched_phrase"] or "حسنه" in match["matched_phrase"]


def test_find_closing_finds_dutch_closing_when_dominant_is_arabic():
    """Whisper file-level lang says 'ar' but Part 2 is actually Dutch — closing must still be found."""
    words = [
        # earlier Arabic content
        {"word": "بسم", "start": 0.0, "end": 0.5, "lang": "ar"},
        # Dutch closing tagged as 'ar' (Whisper file-level mistake)
        {"word": "onze", "start": 100.0, "end": 100.3, "lang": "ar"},
        {"word": "heer", "start": 100.4, "end": 100.7, "lang": "ar"},
        {"word": "geef", "start": 100.8, "end": 101.0, "lang": "ar"},
        {"word": "ons", "start": 101.1, "end": 101.3, "lang": "ar"},
        {"word": "in", "start": 101.4, "end": 101.5, "lang": "ar"},
        {"word": "deze", "start": 101.6, "end": 101.8, "lang": "ar"},
        {"word": "wereld", "start": 101.9, "end": 102.3, "lang": "ar"},
        {"word": "het", "start": 102.4, "end": 102.5, "lang": "ar"},
        {"word": "goede", "start": 102.6, "end": 103.0, "lang": "ar"},
    ]
    match = find_last_closing(words, dominant_lang="ar")
    assert match is not None
    assert match["end_time"] == 103.0


# --- second-opening (Part 2 start anchor) ----------------------------------

def test_find_second_opening_matches_fatiha_style_open():
    """Many imams start Part 2 with 'الحمد لله رب العالمين' (fātiḥa-style)
    rather than repeating the bare 'إن الحمد لله'. The canonical Iziyi
    source is one of these — this anchor is what makes Part 2 detectable."""
    words = _ar_words([
        ("الحمد", 1500.0, 1500.4),
        ("لله", 1500.5, 1500.8),
        ("رب", 1500.9, 1501.1),
        ("العالمين", 1501.2, 1501.7),
    ])
    match = find_second_opening(words, after_word_idx=0)
    assert match is not None
    assert match["start_word_idx"] == 0


def test_find_second_opening_matches_repeat_of_bare_opening():
    """Imams who do repeat 'إن الحمد لله' must still anchor."""
    words = _ar_words([
        ("إن", 1500.0, 1500.3),
        ("الحمد", 1500.4, 1500.7),
        ("لله", 1500.8, 1501.0),
    ])
    match = find_second_opening(words, after_word_idx=0)
    assert match is not None
    assert match["start_word_idx"] == 0


def test_find_second_opening_respects_after_word_idx():
    """Must not match the FIRST opening — only later ones (Part 2 happens
    after Part 1)."""
    words = _ar_words([
        ("إن", 50.0, 50.3),       # Part 1 opening (must be skipped)
        ("الحمد", 50.4, 50.7),
        ("لله", 50.8, 51.0),
        ("filler", 100.0, 100.5),
        ("الحمد", 1500.0, 1500.4),  # Part 2 fātiḥa-style opening
        ("لله", 1500.5, 1500.8),
        ("رب", 1500.9, 1501.1),
        ("العالمين", 1501.2, 1501.7),
    ])
    match = find_second_opening(words, after_word_idx=3)
    assert match is not None
    assert match["start_time"] >= 1500.0


def test_find_second_opening_returns_none_when_absent():
    words = _ar_words([
        ("filler", 100.0, 100.5),
        ("more", 200.0, 200.5),
    ])
    assert find_second_opening(words, after_word_idx=0) is None


# --- Part 1 evidence stacking ----------------------------------------------

from khutbah_pipeline.detect.phrases import find_part1_anchors


def test_part1_anchors_returns_opening_alone_when_haaja_too_far():
    """If haaja matches but is far from the opening, treat them as
    unrelated — only the opening anchors Part 1."""
    words = _ar_words([
        ("إن", 100.0, 100.3),
        ("الحمد", 100.4, 100.7),
        ("لله", 100.8, 101.0),
        # 200s gap (way past the 30s window)
        ("اتقوا", 300.0, 300.3),
        ("الله", 300.4, 300.7),
        ("حق", 300.8, 301.0),
        ("تقاته", 301.1, 301.5),
        ("ولا", 301.6, 301.8),
        ("تموتن", 301.9, 302.2),
        ("الا", 302.3, 302.5),
        ("وانتم", 302.6, 302.9),
        ("مسلمون", 303.0, 303.5),
    ])
    anchors = find_part1_anchors(words)
    assert anchors["opening"] is not None
    assert anchors["haaja"] is None  # Out of window — not stacked


def test_part1_anchors_stacks_opening_and_haaja_when_close():
    """When opening AND haaja both match within 30s of each other, stack
    them — that's two independent confirmations of Part 1 start."""
    words = _ar_words([
        ("إن", 100.0, 100.3),
        ("الحمد", 100.4, 100.7),
        ("لله", 100.8, 101.0),
        # 5s later — well within window
        ("اتقوا", 106.0, 106.3),
        ("الله", 106.4, 106.7),
        ("حق", 106.8, 107.0),
        ("تقاته", 107.1, 107.5),
        ("ولا", 107.6, 107.8),
        ("تموتن", 107.9, 108.2),
        ("الا", 108.3, 108.5),
        ("وانتم", 108.6, 108.9),
        ("مسلمون", 109.0, 109.5),
    ])
    anchors = find_part1_anchors(words)
    assert anchors["opening"] is not None
    assert anchors["haaja"] is not None


def test_part1_anchors_returns_haaja_only_when_opening_missing():
    """When the bare opening isn't transcribed (low-volume start), the
    haaja anchor is still found and used as fallback."""
    words = _ar_words([
        ("filler", 50.0, 50.3),
        # No opening — straight to haaja
        ("اتقوا", 106.0, 106.3),
        ("الله", 106.4, 106.7),
        ("حق", 106.8, 107.0),
        ("تقاته", 107.1, 107.5),
        ("ولا", 107.6, 107.8),
        ("تموتن", 107.9, 108.2),
        ("الا", 108.3, 108.5),
        ("وانتم", 108.6, 108.9),
        ("مسلمون", 109.0, 109.5),
    ])
    anchors = find_part1_anchors(words)
    assert anchors["opening"] is None
    assert anchors["haaja"] is not None


def test_part1_anchors_returns_none_when_neither_matches():
    words = _ar_words([("filler", 50.0, 50.3), ("more", 100.0, 100.5)])
    anchors = find_part1_anchors(words)
    assert anchors["opening"] is None
    assert anchors["haaja"] is None


# --- Closing dua: real Iziyi-source endings ---------------------------------

def test_find_closing_subhanaka():
    """Standard tasbīḥ al-majlis ending — extremely common khutbah close."""
    words = _ar_words([
        ("بارك", 100.0, 100.3),
        ("الله", 100.4, 100.7),
        ("فيكم", 100.8, 101.2),
        ("سبحانك", 101.3, 101.7),
        ("اللهم", 101.8, 102.1),
        ("وبحمدك", 102.2, 102.7),
    ])
    match = find_last_closing(words, dominant_lang="ar")
    assert match is not None
    assert match["end_time"] >= 102.7


def test_find_closing_baarakallaahu_feekum():
    """Imam's closing 'بارك الله فيكم' — common transition out."""
    words = _ar_words([
        ("والحمد", 100.0, 100.3),
        ("لله", 100.4, 100.7),
        ("بارك", 105.0, 105.3),
        ("الله", 105.4, 105.7),
        ("فيكم", 105.8, 106.2),
    ])
    match = find_last_closing(words, dominant_lang="ar")
    assert match is not None
    assert match["end_time"] >= 106.2


def test_find_closing_astaghfiruka_wa_atubu():
    """The continuation of subḥānaka — '(أشهد أن لا إله إلا أنت) أستغفرك
    وأتوب إليك'. Often the very last spoken phrase before the imam steps
    down."""
    words = _ar_words([
        ("استغفرك", 200.0, 200.4),
        ("واتوب", 200.5, 200.9),
        ("اليك", 201.0, 201.4),
    ])
    match = find_last_closing(words, dominant_lang="ar")
    assert match is not None
    assert match["end_time"] >= 201.4


def test_find_closing_final_salam():
    """Final 'والسلام عليكم ورحمة الله' — universal end-of-talk marker."""
    words = _ar_words([
        ("والسلام", 300.0, 300.4),
        ("عليكم", 300.5, 300.9),
        ("ورحمه", 301.0, 301.4),
        ("الله", 301.5, 301.9),
    ])
    match = find_last_closing(words, dominant_lang="ar")
    assert match is not None
    assert match["end_time"] >= 301.9


def test_find_closing_subhanaka_with_allah_not_allahumma():
    """Whisper sometimes transcribes 'اللهم' as 'الله' — both should match."""
    words = _ar_words([
        ("سبحانك", 100.0, 100.3),
        ("الله", 100.4, 100.7),
        ("وبحمدك", 100.8, 101.2),
    ])
    match = find_last_closing(words, dominant_lang="ar")
    assert match is not None
    assert match["end_time"] >= 101.2


# --- Silence-gated opening matcher ----------------------------------------

from khutbah_pipeline.detect.phrases import find_first_opening_after_long_silence


def test_opening_after_long_silence_accepts_match_after_long_silence():
    """The right opening — preceded by a 16s silence (imam stepping up
    to the minbar). Must accept."""
    words = _ar_words([
        ("filler", 100.0, 100.5),
        ("ان", 1050.0, 1050.3),
        ("الحمد", 1050.4, 1050.7),
        ("لله", 1050.8, 1051.0),
    ])
    silences = [
        {"start": 1033.0, "end": 1049.0, "duration": 16.0},
    ]
    match = find_first_opening_after_long_silence(words, silences)
    assert match is not None
    assert match["start_time"] == 1050.0


def test_opening_after_long_silence_rejects_false_positive_in_adhan_tail():
    """The Iziyi false-positive: 'بأن الحمد لله' at 1024s was preceded
    only by a 3.18s silence (continuous adhan content). Must reject and
    keep searching."""
    words = _ar_words([
        ("بأن", 1024.5, 1024.8),
        ("الحمد", 1024.9, 1025.2),
        ("لله", 1025.3, 1025.6),
        # The real opening 25s later, after a long silence
        ("ان", 1050.0, 1050.3),
        ("الحمد", 1050.4, 1050.7),
        ("لله", 1050.8, 1051.0),
    ])
    silences = [
        {"start": 1018.9, "end": 1022.1, "duration": 3.2},   # too short
        {"start": 1033.8, "end": 1049.9, "duration": 16.1},  # the imam-ready silence
    ]
    match = find_first_opening_after_long_silence(words, silences)
    assert match is not None
    assert match["start_time"] == 1050.0, (
        "must skip the adhan-tail false-positive and pick the post-silence opening"
    )


def test_opening_after_long_silence_returns_none_when_no_match_qualifies():
    """No opening preceded by a long silence → None (caller falls back to
    haaja)."""
    words = _ar_words([
        ("ان", 100.0, 100.3),
        ("الحمد", 100.4, 100.7),
        ("لله", 100.8, 101.0),
    ])
    silences = [{"start": 95.0, "end": 99.0, "duration": 4.0}]  # too short
    assert find_first_opening_after_long_silence(words, silences) is None


def test_opening_after_long_silence_silence_must_end_close_to_match():
    """A 30s silence ending 60s BEFORE the candidate doesn't count — that's
    a separate event (e.g., between adhan segments), not the imam-ready
    silence right before the opening."""
    words = _ar_words([
        ("ان", 1100.0, 1100.3),
        ("الحمد", 1100.4, 1100.7),
        ("لله", 1100.8, 1101.0),
    ])
    silences = [{"start": 1010.0, "end": 1040.0, "duration": 30.0}]  # 60s before
    assert find_first_opening_after_long_silence(words, silences) is None


def test_opening_after_long_silence_min_silence_overrideable():
    """Caller can dial the silence-gate threshold."""
    words = _ar_words([
        ("ان", 100.0, 100.3),
        ("الحمد", 100.4, 100.7),
        ("لله", 100.8, 101.0),
    ])
    silences = [{"start": 90.0, "end": 99.0, "duration": 9.0}]
    # Default min=10 → rejected
    assert find_first_opening_after_long_silence(words, silences) is None
    # Lower bar → accepted
    assert find_first_opening_after_long_silence(
        words, silences, min_silence_seconds=5.0
    ) is not None


def test_opening_after_long_silence_tolerates_silencedetect_lag():
    """ffmpeg silencedetect can flag the silence as ending slightly AFTER
    the imam's actual word-start (whisper word_timestamps are tighter than
    energy-based silence detection). Real Iziyi v6yLY17uMQE source: imam
    starts at 193.92 s, silencedetect says silence ends 194.32 s — a 0.4 s
    inversion. The gate must tolerate this kind of detector lag."""
    words = _ar_words([
        ("ان", 193.92, 194.20),
        ("الحمد", 194.48, 194.80),
        ("لله", 194.88, 195.20),
    ])
    silences = [{"start": 162.22, "end": 194.32, "duration": 32.10}]
    match = find_first_opening_after_long_silence(words, silences)
    assert match is not None, (
        "silence ending 0.4 s after the candidate word-start is the same"
        " event — silencedetect just lagged"
    )


# --- Silence-gated haaja matcher (drops the 600s hard floor) -------------

from khutbah_pipeline.detect.phrases import find_first_khutbatul_haaja_after_long_silence


def test_haaja_after_long_silence_accepts_short_preroll_source():
    """v6y source: imam-ready silence at 2:42-3:14 (32s), haaja first
    verse at ~3:47. The haaja anchor must lock here, not at 13:00 — the
    prior MIN_KHUTBAH_OPENING_TIME=600s floor was wrong for short-preroll
    sources."""
    words = _ar_words([
        # Some pre-roll noise
        ("recitation", 30.0, 31.0),
        # Imam opens at 194s (whisper mistranscribed, no opening match)
        ("احمد", 194.41, 194.81),
        ("الله", 194.81, 195.20),
        # Haaja at 227s — first verse "اتقوا الله حق تقاته ولا تموتن الا وانتم مسلمون"
        ("اتقوا", 227.65, 228.07),
        ("الله", 228.07, 228.43),
        ("حق", 228.43, 228.93),
        ("تقاته", 228.93, 229.71),
        ("ولا", 229.71, 230.00),
        ("تموتن", 230.00, 230.40),
        ("الا", 230.40, 230.70),
        ("وانتم", 230.70, 231.10),
        ("مسلمون", 231.10, 231.60),
    ])
    silences = [
        {"start": 162.22, "end": 194.32, "duration": 32.10},  # the imam-ready silence
    ]
    match = find_first_khutbatul_haaja_after_long_silence(words, silences)
    assert match is not None
    assert match["start_time"] >= 227.0


def test_haaja_after_long_silence_rejects_false_match_in_recitation():
    """A haaja-like fuzzy match in pre-roll Quran recitation (no preceding
    long silence) must be rejected."""
    words = _ar_words([
        # Pre-roll Quran recitation has phrases similar to haaja
        ("اتقوا", 100.0, 100.4),
        ("الله", 100.4, 100.7),
        ("حق", 100.8, 101.1),
        ("تقاته", 101.1, 101.5),
        ("ولا", 101.5, 101.8),
        ("تموتن", 101.8, 102.2),
        ("الا", 102.2, 102.5),
        ("وانتم", 102.5, 102.9),
        ("مسلمون", 102.9, 103.3),
    ])
    silences = [{"start": 95.0, "end": 99.5, "duration": 4.5}]  # too short
    assert find_first_khutbatul_haaja_after_long_silence(words, silences) is None


def test_haaja_after_long_silence_window_includes_imam_opening_pause():
    """The haaja sits 5-30s after the bare opening (which is right after
    the silence end). So the gate must allow up to ~45s between silence
    end and haaja start."""
    words = _ar_words([
        ("اتقوا", 230.0, 230.4),
        ("الله", 230.4, 230.7),
        ("حق", 230.8, 231.1),
        ("تقاته", 231.1, 231.5),
        ("ولا", 231.5, 231.8),
        ("تموتن", 231.8, 232.2),
        ("الا", 232.2, 232.5),
        ("وانتم", 232.5, 232.9),
        ("مسلمون", 232.9, 233.3),
    ])
    silences = [{"start": 162.22, "end": 194.32, "duration": 32.10}]
    # haaja_start - silence_end = 230 - 194.32 = 35.68 s — within window
    match = find_first_khutbatul_haaja_after_long_silence(words, silences)
    assert match is not None


def test_haaja_after_long_silence_rejects_match_far_from_any_silence():
    """If haaja matches but the nearest prior silence ended >60s before,
    that's not an imam-ready silence."""
    words = _ar_words([
        ("اتقوا", 1000.0, 1000.4),
        ("الله", 1000.4, 1000.7),
        ("حق", 1000.8, 1001.1),
        ("تقاته", 1001.1, 1001.5),
        ("ولا", 1001.5, 1001.8),
        ("تموتن", 1001.8, 1002.2),
        ("الا", 1002.2, 1002.5),
        ("وانتم", 1002.5, 1002.9),
        ("مسلمون", 1002.9, 1003.3),
    ])
    # Long silence 200s before haaja — too far
    silences = [{"start": 700.0, "end": 800.0, "duration": 100.0}]
    assert find_first_khutbatul_haaja_after_long_silence(words, silences) is None


# --- Silence-gated second-opening (Part 2 sit-down marker) ---------------

from khutbah_pipeline.detect.phrases import find_second_opening_after_long_silence


def test_second_opening_after_long_silence_picks_post_sitdown_match():
    """The imam ends Part 1, sits silently, opens Part 2. The bare second
    opening matcher can lock onto a transitional utterance (e.g. 'بسم الله'
    while settling) before the actual Part 2 opening — which puts the cut
    boundary too early. The right anchor is preceded by the sit-down
    silence (5+ s)."""
    words = _ar_words([
        # Part 1 closing
        ("بارك", 7195.0, 7195.4),
        ("الله", 7195.4, 7195.7),
        # Brief 'الحمد لله' transitional utterance — should be ignored
        ("الحمد", 7212.0, 7212.4),
        ("لله", 7212.4, 7212.7),
        # Sit-down silence: 7213 → 7222 (9 s)
        # Real Part 2 second opening — preceded by the sit-down silence
        ("الحمد", 7222.0, 7222.4),
        ("لله", 7222.4, 7222.7),
        ("رب", 7222.8, 7223.1),
        ("العالمين", 7223.2, 7223.7),
    ])
    silences = [{"start": 7213.0, "end": 7222.0, "duration": 9.0}]
    match = find_second_opening_after_long_silence(words, silences, after_word_idx=2)
    assert match is not None
    assert match["start_time"] >= 7222.0


def test_second_opening_after_long_silence_rejects_match_with_no_silence_before():
    """If no qualifying silence precedes the candidate, reject."""
    words = _ar_words([
        ("الحمد", 7210.0, 7210.4),
        ("لله", 7210.4, 7210.7),
        ("رب", 7210.8, 7211.1),
        ("العالمين", 7211.2, 7211.7),
    ])
    silences = [{"start": 7200.0, "end": 7202.0, "duration": 2.0}]  # too short
    assert find_second_opening_after_long_silence(words, silences, after_word_idx=0) is None


def test_second_opening_after_long_silence_uses_lower_silence_threshold():
    """Sit-down silence is shorter than the imam-ready silence (5 s vs 10 s)."""
    words = _ar_words([
        ("الحمد", 7222.0, 7222.4),
        ("لله", 7222.4, 7222.7),
        ("رب", 7222.8, 7223.1),
        ("العالمين", 7223.2, 7223.7),
    ])
    silences = [{"start": 7213.0, "end": 7221.0, "duration": 8.0}]  # 8 s sit-down
    match = find_second_opening_after_long_silence(words, silences, after_word_idx=0)
    assert match is not None  # 8 s ≥ 5 s default


def test_second_opening_after_long_silence_respects_after_word_idx():
    """Must skip Part 1's bare opening (the FIRST opening) and only consider
    matches after the given index."""
    words = _ar_words([
        # Part 1 opening (must be skipped)
        ("ان", 50.0, 50.3),
        ("الحمد", 50.4, 50.7),
        ("لله", 50.8, 51.0),
        # Sit-down silence: 7213 → 7222
        # Part 2 opening
        ("الحمد", 7222.0, 7222.4),
        ("لله", 7222.4, 7222.7),
        ("رب", 7222.8, 7223.1),
        ("العالمين", 7223.2, 7223.7),
    ])
    silences = [{"start": 7213.0, "end": 7222.0, "duration": 9.0}]
    match = find_second_opening_after_long_silence(words, silences, after_word_idx=3)
    assert match is not None
    assert match["start_time"] >= 7222.0
