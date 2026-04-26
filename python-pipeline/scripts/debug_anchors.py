"""Diagnostic: dump raw whisper transcript around expected anchor regions.

Helps figure out WHY a phrase matcher missed an anchor: maybe whisper
transcribed it with characters the normaliser didn't fold, maybe an
extra word split a token, etc. Run on the canonical source and inspect
what the matcher saw for Part 1 opening, Part 2 second-opening, and the
closing dua.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python-pipeline"))

from khutbah_pipeline.detect.window_transcribe import transcribe_windows
from khutbah_pipeline.detect.normalize_arabic import normalize_arabic

SRC = "/home/farouq/Videos/KhutbahEditor/2026-04-25/الحي القيومVrijdagpreek ｜ De Eeuwig Levende, De Zelfstandige｜ Ustaadh Iziyi [QGxYiaz45Co].mp4"
WHISPER = os.environ.get("WHISPER", str(REPO / "resources/models/whisper-base"))


def dump_window(words: list[dict], start_t: float, end_t: float, label: str) -> None:
    print(f"\n--- {label} ({start_t:.1f}-{end_t:.1f}s) ---")
    in_window = [w for w in words if start_t <= w["start"] <= end_t]
    if not in_window:
        print("  (no words in window)")
        return
    text = " ".join(w["word"] for w in in_window)
    norm = normalize_arabic(text)
    avg_p = sum(w["probability"] for w in in_window) / len(in_window)
    print(f"  raw    : {text}")
    print(f"  norm   : {norm}")
    print(f"  n_words: {len(in_window)}  avg_prob: {avg_p:.3f}")


def main() -> int:
    print(f"src: {SRC}")
    print(f"model: {WHISPER}")
    t0 = time.time()
    win = [{"id": "full", "start": 0.0, "end": 9999.0}]
    res = transcribe_windows(SRC, WHISPER, win, device="cpu", language="ar")
    words = res.get("full", {}).get("words", [])
    print(f"transcribed {len(words)} words in {time.time()-t0:.1f}s")
    if not words:
        print("FATAL: no words")
        return 1
    print(f"first word @ {words[0]['start']:.1f}s, last @ {words[-1]['end']:.1f}s")

    # Approx regions where each anchor should fire on canonical Iziyi source
    dump_window(words, 1015, 1075, "Expected Part 1 opening")
    dump_window(words, 1480, 1540, "Expected Part 2 second-opening")
    dump_window(words, 2030, 2072, "Expected closing dua")
    return 0


if __name__ == "__main__":
    sys.exit(main())
