import json
import re
import subprocess
from typing import Any, Optional
from khutbah_pipeline.util.ffmpeg import FFMPEG


def measure_loudness(
    src: str,
    start: Optional[float] = None,
    end: Optional[float] = None,
) -> dict[str, Any]:
    """Pass 1: measure integrated loudness, true peak, LRA, threshold, offset.

    If start/end are provided, measure ONLY that segment (the same one that will
    be exported by smart_cut). Measuring the full source and applying to a
    segment produces wrong loudness when source loudness varies across regions.
    """
    cmd = [FFMPEG, "-hide_banner"]
    if start is not None:
        cmd += ["-ss", str(start)]
    if start is not None and end is not None:
        cmd += ["-t", str(end - start)]
    cmd += [
        "-i", src,
        "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
        "-f", "null", "-",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, check=True)
    text = r.stderr
    # The JSON block is delimited by braces but may have other ffmpeg output before it.
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", text, re.DOTALL)
    if not m:
        raise RuntimeError(f"loudnorm measurement parse failed:\n{text}")
    return json.loads(m.group(0))


def build_loudnorm_filter(
    measured: dict[str, Any],
    target_i: float = -14.0,
    target_tp: float = -1.0,
    target_lra: float = 11.0,
) -> str:
    """Build a low-latency loudness-correction filter chain.

    We DO NOT use the `loudnorm` filter for the apply pass — it has a
    multi-second internal buffer that introduces ~400-600ms of audio
    drift versus stream-copied video, observed in the field. Instead:

      1. volume=<gain>dB  — static gain to bring measured_I to target_I.
                            Sample-accurate, zero buffer.
      2. alimiter=limit=  — peak limiter to keep dBTP under target.
                            ~5 ms lookahead, negligible for sync.

    The trade-off vs proper EBU R128: no LRA shaping, no per-section
    dynamic adjustment. For khutbah audio (mostly single-speaker, fairly
    consistent dynamics) the static gain + limiter produces output
    indistinguishable from loudnorm at YouTube-delivery quality.
    `target_lra` is accepted for API stability and silently ignored.
    """
    _ = target_lra  # noqa: F841 — see docstring
    measured_i = float(measured["input_i"])
    gain_db = target_i - measured_i
    # alimiter limit is in linear units (0..1). Convert from dB.
    # 10**(target_tp/20) — target_tp is negative dB, so limit < 1.0.
    limit = 10 ** (target_tp / 20.0)
    return f"volume={gain_db:.3f}dB,alimiter=limit={limit:.4f}:level=disabled"
