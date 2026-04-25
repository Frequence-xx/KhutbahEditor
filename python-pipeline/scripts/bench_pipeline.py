#!/usr/bin/env python3
"""Bench the full detect → export pipeline on a real khutbah recording.

Usage:
  python scripts/bench_pipeline.py /path/to/khutbah.mp4 [--device cpu|cuda|auto]

Targets after Phase 3 + 4 land:
  - Detect bounds: < 5 min CPU, < 1 min GPU on a 3 hr source
  - Each part cut: < 90 s
  - Total compute: < 8 min CPU, < 3 min GPU
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from khutbah_pipeline.detect.pipeline_v2 import run_pipeline_v2
from khutbah_pipeline.edit.smartcut import smart_cut


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path, help="Path to a real khutbah .mp4")
    ap.add_argument("--device", default="auto", help="auto | cuda | cpu")
    ap.add_argument(
        "--model",
        type=Path,
        default=Path(__file__).parents[2] / "resources" / "models" / "whisper-tiny",
        help="Path to whisper-tiny CTranslate2 model dir",
    )
    ap.add_argument(
        "--out-dir", type=Path, default=Path("/tmp/khutbah-bench"),
        help="Where to write the cut output mp4s",
    )
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Source: {args.source}")
    print(f"Device: {args.device}")
    print(f"Model:  {args.model}")
    print()

    t0 = time.monotonic()
    detect = run_pipeline_v2(str(args.source), str(args.model), device=args.device)
    detect_t = time.monotonic() - t0

    print(json.dumps(detect, indent=2, default=str))
    print(f"\n=== Detect: {detect_t:.1f} s ===\n")

    if "error" in detect:
        print(f"Detection failed: {detect['error']} — stopping")
        return

    p1 = detect["part1"]
    p2 = detect["part2"]

    t1 = time.monotonic()
    smart_cut(
        src=str(args.source),
        dst=str(args.out_dir / "part1.mp4"),
        start=p1["start"],
        end=p1["end"],
    )
    p1_t = time.monotonic() - t1

    t2 = time.monotonic()
    smart_cut(
        src=str(args.source),
        dst=str(args.out_dir / "part2.mp4"),
        start=p2["start"],
        end=p2["end"],
    )
    p2_t = time.monotonic() - t2

    total = detect_t + p1_t + p2_t
    print(
        f"\n=== Detect: {detect_t:.1f} s | "
        f"Part1 cut: {p1_t:.1f} s | "
        f"Part2 cut: {p2_t:.1f} s | "
        f"Total: {total:.1f} s ==="
    )
    print(f"\nOutput files in {args.out_dir}:")
    for p in sorted(args.out_dir.glob("part*.mp4")):
        sz = p.stat().st_size / (1024 * 1024)
        print(f"  {p.name}  {sz:.1f} MB")


if __name__ == "__main__":
    main()
