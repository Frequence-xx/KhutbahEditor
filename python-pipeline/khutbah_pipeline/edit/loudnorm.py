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
    """Pass 2: build the filter string with measured values + targets."""
    return (
        f"loudnorm=I={target_i}:TP={target_tp}:LRA={target_lra}"
        f":measured_I={measured['input_i']}"
        f":measured_TP={measured['input_tp']}"
        f":measured_LRA={measured['input_lra']}"
        f":measured_thresh={measured['input_thresh']}"
        f":offset={measured['target_offset']}"
        f":linear=true:print_format=summary"
    )
