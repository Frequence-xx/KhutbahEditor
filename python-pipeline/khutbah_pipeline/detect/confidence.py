"""Confidence math for detection anchors.

Pure helpers — given the word list whisper produced and a matched anchor
span (start_word_idx / end_word_idx), derive a per-anchor confidence
score. Multiple anchor scores combine via geometric mean so a single
weak anchor visibly drags the overall score down.

Used by pipeline_v2 to replace the prior hardcoded 0.5 / 0.90 Part 2
confidence with real ASR-derived evidence.
"""

from __future__ import annotations

import math
from typing import Optional


def anchor_confidence(words, anchor) -> Optional[float]:
    if anchor is None:
        return None
    s = int(anchor["start_word_idx"])
    e = int(anchor["end_word_idx"])
    if e < s:
        raise ValueError(f"invalid anchor span: end_word_idx {e} < start_word_idx {s}")
    span = words[s:e + 1]
    n = max(1, len(span))
    return sum(float(w["probability"]) for w in span) / n


def combine_confidences(*scores, low_default: float = 0.3) -> float:
    present = [float(s) for s in scores if s is not None]
    if not present:
        return low_default
    log_sum = sum(math.log(s) for s in present)
    return math.exp(log_sum / len(present))
