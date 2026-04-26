"""End-to-end run of detect → smart_cut on the canonical 34.5-min khutbah.

Reports timing, anchor type, confidence, SyncNet offset, gain, and any errors.
Not a pytest — invoked directly to expose what auto-pilot produces today.
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python-pipeline"))

from khutbah_pipeline.detect.pipeline import run_detection_pipeline
from khutbah_pipeline.edit.smartcut import smart_cut

SRC = "/home/farouq/Videos/KhutbahEditor/2026-04-25/الحي القيومVrijdagpreek ｜ De Eeuwig Levende, De Zelfstandige｜ Ustaadh Iziyi [QGxYiaz45Co].mp4"
OUT_DIR = Path("/tmp/khutbah_e2e")
OUT_DIR.mkdir(parents=True, exist_ok=True)

WHISPER = os.environ.get("WHISPER", str(REPO / "resources/models/whisper-tiny"))


def progress_print(payload: dict) -> None:
    stage = payload.get("stage", "?")
    msg = payload.get("message", "")
    pct = payload.get("progress", 0.0)
    print(f"  [{stage:>20s}] {pct*100:5.1f}% {msg}", flush=True)


def main() -> int:
    if not os.path.exists(SRC):
        print(f"FATAL: source not found: {SRC}")
        return 2

    report: dict = {"src": SRC}
    print(f"\n=== detect.run on canonical source ===")
    print(f"src: {SRC}")
    print(f"whisper model: {WHISPER}")
    t0 = time.time()
    try:
        det = run_detection_pipeline(
            SRC,
            WHISPER,
            device=os.environ.get("KHUTBAH_COMPUTE_DEVICE", "auto"),
            progress_cb=progress_print,
        )
    except Exception as e:
        report["detect"] = {"error": str(e), "trace": traceback.format_exc()}
        print(f"\nFATAL during detect: {e}\n{traceback.format_exc()}")
        return 3
    dt_detect = time.time() - t0
    report["detect"] = {"wall_seconds": round(dt_detect, 1), "result": det}

    print(f"\n--- detect.run finished in {dt_detect:.1f}s ---")
    print(json.dumps(det, indent=2, ensure_ascii=False))

    if det.get("error"):
        print("\nDetect returned error — skipping smart_cut.")
        Path("/tmp/khutbah_e2e/report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
        return 4

    parts = []
    if "part1" in det and det["part1"]:
        parts.append(("part1", det["part1"]))
    if "part2" in det and det["part2"]:
        parts.append(("part2", det["part2"]))

    for name, part in parts:
        start = float(part["start"])
        end = float(part["end"])
        dst = str(OUT_DIR / f"{name}.mp4")
        print(f"\n=== smart_cut {name} [{start:.2f}, {end:.2f}] ({end-start:.1f}s) ===")
        t0 = time.time()
        try:
            cut = smart_cut(
                SRC, dst,
                start, end,
                normalize_audio=True,
                audio_offset_ms=None,  # auto SyncNet
                progress_cb=progress_print,
            )
        except Exception as e:
            report.setdefault("cuts", {})[name] = {"error": str(e), "trace": traceback.format_exc()}
            print(f"smart_cut {name} FAILED: {e}\n{traceback.format_exc()}")
            continue
        dt_cut = time.time() - t0
        size_mb = os.path.getsize(dst) / 1e6 if os.path.exists(dst) else None
        report.setdefault("cuts", {})[name] = {
            "wall_seconds": round(dt_cut, 1),
            "size_mb": round(size_mb, 2) if size_mb else None,
            "result": cut,
        }
        print(f"--- {name} cut in {dt_cut:.1f}s, {size_mb:.1f} MB ---")
        print(json.dumps(cut, indent=2, ensure_ascii=False))

    Path("/tmp/khutbah_e2e/report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False)
    )
    print("\n=== full report written to /tmp/khutbah_e2e/report.json ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
