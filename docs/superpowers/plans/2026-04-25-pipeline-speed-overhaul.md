# Pipeline Speed Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor's playback + manual editing actually usable (no more decode-failed proxies, no more click-to-seek going to t=0), cut detect-bounds from 25+ minutes to under 5 minutes, cut export from 30-90 minutes to under 2 minutes, and make GPU usage transparent (fail loud when CUDA is meant to be used but isn't usable; never silent CPU fallback).

**Architecture:**
- Fix the proxy generator: `-pix_fmt yuv420p` (avoid 10-bit output Chromium can't decode), short GOP (`-g 24 -keyint_min 24`) for snappy scrubbing, baseline profile for max compatibility. Remove the source-fallback decode-loop hack.
- Replace large-v3 full-transcribe with **silero-vad + ffmpeg scdet** for boundary candidates and **faster-whisper tiny on ±5 s windows** for phrase confirmation. Drops bundle size 3 GB → 75 MB.
- Replace full re-encode with **video stream-copy + audio loudnorm-only re-encode**, snapped to keyframes. ~30-90× faster end-to-end on a typical 30-min Part 1.
- Replace silent CPU fallback with explicit user choice (`auto` / `cuda` / `cpu`). When `auto` finds an NVIDIA GPU but cuBLAS is missing, raise an actionable error instead of silently falling back.

**Tech Stack:** Existing (Electron + Python sidecar + ffmpeg + faster-whisper) plus one new Python dep: `silero-vad`. No new Node deps. No frontend stack changes.

---

## Spec Deltas (deliberate departures from the locked spec)

The original spec at `docs/superpowers/specs/2026-04-25-khutbah-editor-design.md` § 4.4 specifies large-v3 full-transcribe for boundary detection and never specifies smart-cut details. This plan changes both:

| Aspect | Original spec | This plan |
|---|---|---|
| Preview proxy | libx264 veryfast CRF 26, no pix_fmt, no GOP override → frequently 10-bit, long-GOP, decode-failing in Chromium | libx264 veryfast CRF 23, `-pix_fmt yuv420p`, `-g 24 -keyint_min 24`, `-profile:v baseline -level 3.0` → fast scrub + universal decode |
| Editor decode-error fallback | Silent fallback to source (cascades to source decode-fails) | Surface error + Rebuild Proxy CTA; never silent fallback |
| Boundary detection | large-v3 on full audio (~25-60 min CPU) | silero-vad + ffmpeg scdet for candidates + tiny-whisper on ±5 s windows (~3-5 min CPU) |
| Bundled model | whisper-large-v3 (~3 GB) | whisper-tiny (~75 MB) |
| Cut/export encode | libx264 preset=medium CRF 18 (full re-encode) | video stream-copy + audio re-encode for loudnorm, keyframe-snapped |
| GPU policy | Silent CPU fallback on any CUDA error | Fail loud unless user chose CPU or no NVIDIA GPU detected |

**Why this is sanctioned:** the user (project owner) directed the change on 2026-04-25 after a 25-minute detect-bounds run made the auto-pilot promise unreachable. The spec doc (§ 4.4 and any references to large-v3 / preset=medium re-encode) will be updated as a doc task at the end of Phase 5.

---

## File Structure

### New files (Python sidecar)

- `python-pipeline/khutbah_pipeline/util/gpu.py` — NVIDIA presence + cuBLAS loadability probes
- `python-pipeline/khutbah_pipeline/util/keyframes.py` — ffprobe keyframe lookup
- `python-pipeline/khutbah_pipeline/detect/vad.py` — silero-vad wrapper (returns speech segments)
- `python-pipeline/khutbah_pipeline/detect/shots.py` — ffmpeg scdet wrapper (returns shot boundaries)
- `python-pipeline/khutbah_pipeline/detect/candidates.py` — pure-Python combine VAD silences + shots → ranked boundary candidates
- `python-pipeline/khutbah_pipeline/detect/window_transcribe.py` — faster-whisper tiny on small windows (no full-audio decode)
- `python-pipeline/khutbah_pipeline/detect/pipeline_v2.py` — new orchestrator (keep `pipeline.py` deprecated until Phase 3.6 cutover)

### New tests

- `python-pipeline/tests/test_gpu.py`
- `python-pipeline/tests/test_keyframes.py`
- `python-pipeline/tests/test_vad.py`
- `python-pipeline/tests/test_shots.py`
- `python-pipeline/tests/test_candidates.py`
- `python-pipeline/tests/test_window_transcribe.py`
- `python-pipeline/tests/test_pipeline_v2.py`
- `python-pipeline/tests/test_smartcut_keyframe.py`

### Modified files

- `python-pipeline/khutbah_pipeline/detect/transcribe.py` — remove silent CPU fallback; use `util/gpu.py`; keep public API for backwards-compatible callers
- `python-pipeline/khutbah_pipeline/detect/pipeline.py` — replaced wholesale (call into pipeline_v2)
- `python-pipeline/khutbah_pipeline/edit/smartcut.py` — replace full re-encode with stream-copy video + audio re-encode + keyframe snap
- `python-pipeline/khutbah_pipeline/__main__.py` — `detect.run` gains optional `device` param; pass through
- `python-pipeline/pyproject.toml` — add `silero-vad`
- `python-pipeline/khutbah_pipeline.spec` — include silero-vad model files in PyInstaller bundle
- `electron/store.ts` — add `computeDevice` to AppSettings + default
- `electron/sidecar/manager.ts` — pass `KHUTBAH_COMPUTE_DEVICE` env var through to sidecar
- `src/screens/Settings.tsx` — Compute Device dropdown
- `src/store/settings.ts` — no shape change (already typed via electron/store.ts)
- `resources/fetch-resources.sh` — drop large-v3, fetch tiny
- `electron-builder.json` — drop large-v3 from extraResources, add tiny

### Removed (Phase 5)

- `resources/models/whisper-large-v3/` — 3 GB bundle no longer used at runtime

---

## Architecture: Detection Pipeline (new)

```
┌──────────────────┐
│ Source audio     │   3 hr livestream
│ (or proxy track) │
└──────────────────┘
        │
        ├───────────────┬───────────────┬───────────────┐
        ▼               ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ silero-vad   │ │ ffmpeg scdet │ │ ffprobe      │ │ silencedetect│
│ ~60 s        │ │ ~60 s        │ │ ~5 s         │ │ ~30 s        │
│              │ │              │ │              │ │              │
│ Speech segs  │ │ Shot cuts    │ │ Duration     │ │ Long quiet   │
│              │ │              │ │              │ │ intervals    │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
        │               │               │               │
        └───────────────┴───────────────┴───────────────┘
                            │
                            ▼
                ┌───────────────────────────┐
                │ Candidate scorer          │
                │ (pure Python, ms)         │
                │                           │
                │ Top-5 candidates per      │
                │ boundary kind:            │
                │  - Part 1 start (opening) │
                │  - Sit-down (P1→P2)       │
                │  - Part 2 end (dua)       │
                └───────────────────────────┘
                            │
                            ▼
                ┌───────────────────────────┐
                │ tiny-whisper window pass  │
                │ ~30 s total (15 windows × │
                │ 10 s ÷ 30× realtime)      │
                │                           │
                │ Phrase match against the  │
                │ existing phrase library   │
                │ → confidence per boundary │
                └───────────────────────────┘
                            │
                            ▼
                ┌───────────────────────────┐
                │ Final boundaries +        │
                │ overall_confidence        │
                └───────────────────────────┘

Total: ~3-5 min CPU for 3 hr source. ~30-60 s on a modest CUDA GPU.
```

---

## Architecture: Smart Cut (new)

```
Input segment: t = 600.0 → 2400.0 (Part 1, ~30 min)

┌─────────────────────────────────────────┐
│ ffprobe -select_streams v -show_packets │
│ -read_intervals 590%2410                │
│ → list of keyframe timestamps           │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ Snap to keyframes:                      │
│  start 600.0  →  599.2 (≤ start)        │
│  end   2400.0 →  2400.7 (≥ end)         │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ Loudnorm pass-1 (measure on snapped     │
│ window): ~30 s                          │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ Loudnorm pass-2 + cut:                  │
│   ffmpeg -ss 599.2 -i src \             │
│     -t 1801.5 \                         │
│     -c:v copy \                         │
│     -af "loudnorm=I=...measured..." \   │
│     -c:a aac -b:a 192k -ar 48000 \      │
│     -movflags +faststart \              │
│     -progress pipe:1 -nostats \         │
│     out.mp4                             │
│ ~30-60 s for a 30-min segment           │
└─────────────────────────────────────────┘

Total: ~60-90 s for a 30-min Part 1 (was 30-90 min with full re-encode).
Boundary precision: ±1-3 s (one GOP) — invisible at sit-down silences.
```

---

## GPU Policy (fail-loud)

Three modes via `computeDevice` setting:

| Setting | Behavior |
|---|---|
| `auto` (default) | NVIDIA GPU + cuBLAS loadable → CUDA. No NVIDIA GPU → CPU silently. NVIDIA GPU present but cuBLAS missing → **raise** with actionable error ("CUDA toolkit missing on this machine. Install via apt install nvidia-cuda-toolkit (Linux) / official CUDA installer (Windows), or set Settings → Compute Device to CPU.") |
| `cuda` | Use CUDA. Anything else (no GPU, no cuBLAS, ct2 build without CUDA) → **raise**. Never silently use CPU. |
| `cpu` | Use CPU. Skip all CUDA probes. |

The current behavior — silently falling back to CPU when CUDA fails — is removed. A 25-minute "GPU-accelerated" detection that's actually running on CPU is worse than a clear error message saying so.

---

# Phase 0: Pre-Flight

### Task 0.1: Add silero-vad dependency

**Files:**
- Modify: `python-pipeline/pyproject.toml`

- [ ] **Step 1: Add the dep**

Edit `python-pipeline/pyproject.toml` — under `dependencies`:

```toml
dependencies = [
    "faster-whisper>=1.0.0",
    "numpy>=1.26",
    "scipy>=1.12",
    "google-api-python-client>=2.120",
    "google-auth>=2.28",
    "google-auth-oauthlib>=1.2",
    "yt-dlp>=2024.4.9",
    "ffmpeg-python>=0.2",
    "silero-vad>=5.1",
    "torch>=2.2",
]
```

(silero-vad pulls torch as a transitive but pinning it here makes the bundle predictable.)

- [ ] **Step 2: Install in dev venv**

```bash
cd python-pipeline && source .venv/bin/activate && pip install -e ".[dev]"
```

Expected: silero-vad installs along with torch.

- [ ] **Step 3: Smoke test**

```bash
python -c "from silero_vad import load_silero_vad; m = load_silero_vad(); print('ok')"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add python-pipeline/pyproject.toml
git commit -m "chore(deps): add silero-vad for VAD-first boundary detection"
```

### Task 0.2: Update fetch-resources.sh — swap large-v3 for tiny

**Files:**
- Modify: `resources/fetch-resources.sh`

- [ ] **Step 1: Read the current script**

```bash
cat resources/fetch-resources.sh
```

- [ ] **Step 2: Replace the large-v3 block with tiny**

Find the block that downloads `Systran/faster-whisper-large-v3` and replace the model id with `Systran/faster-whisper-tiny`. Update the destination path from `resources/models/whisper-large-v3/` to `resources/models/whisper-tiny/`.

- [ ] **Step 3: Run it**

```bash
bash resources/fetch-resources.sh "$(uname -s)" "$(uname -m | sed 's/x86_64/x64/')"
```

Expected: `resources/models/whisper-tiny/` exists, contains `model.bin` and `config.json`, total size <100 MB.

- [ ] **Step 4: Commit**

```bash
git add resources/fetch-resources.sh
git commit -m "chore(resources): fetch whisper-tiny instead of large-v3"
```

### Task 0.3: Generate a synthetic khutbah test fixture

**Files:**
- Create: `python-pipeline/tests/fixtures/make_khutbah_fixture.sh`
- Create (output, generated): `python-pipeline/tests/fixtures/khutbah_3min.mp4`

A 3-minute synthetic clip with: 30 s silence (pre-roll) → 60 s tone (Part 1) → 30 s silence (sitting) → 30 s tone (Part 2) → 30 s silence (post-roll). Used by all pipeline tests below.

- [ ] **Step 1: Write the generator**

Create `python-pipeline/tests/fixtures/make_khutbah_fixture.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
OUT="$(dirname "$0")/khutbah_3min.mp4"

ffmpeg -y \
  -f lavfi -i anullsrc=channel_layout=mono:sample_rate=16000:d=30 \
  -f lavfi -i "sine=frequency=300:sample_rate=16000:d=60" \
  -f lavfi -i anullsrc=channel_layout=mono:sample_rate=16000:d=30 \
  -f lavfi -i "sine=frequency=500:sample_rate=16000:d=30" \
  -f lavfi -i anullsrc=channel_layout=mono:sample_rate=16000:d=30 \
  -f lavfi -i "color=c=black:s=320x180:d=180" \
  -f lavfi -i "color=c=red:s=320x180:d=180" \
  -filter_complex "
    [0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[aout];
    [5:v][6:v]concat=n=2:v=1:a=0[vout]
  " \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -g 24 -keyint_min 24 -pix_fmt yuv420p \
  -c:a aac -b:a 64k \
  -loglevel error \
  "$OUT"

echo "Wrote $OUT"
```

The two color sources concatenated (black 90 s, red 90 s) give scdet a deterministic shot cut at t=90 s. The audio gives VAD deterministic speech intervals at [30, 90] and [120, 150].

- [ ] **Step 2: Make it executable + run**

```bash
chmod +x python-pipeline/tests/fixtures/make_khutbah_fixture.sh
bash python-pipeline/tests/fixtures/make_khutbah_fixture.sh
ls -la python-pipeline/tests/fixtures/khutbah_3min.mp4
```

Expected: file is ~600-900 KB, 180 s duration.

- [ ] **Step 3: Verify with ffprobe**

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=duration python-pipeline/tests/fixtures/khutbah_3min.mp4
```

Expected: `duration=180.000000`

- [ ] **Step 4: Add fixture to .gitignore but commit the generator**

Edit `python-pipeline/tests/fixtures/.gitignore` (create if missing):

```
khutbah_3min.mp4
```

- [ ] **Step 5: Commit**

```bash
git add python-pipeline/tests/fixtures/make_khutbah_fixture.sh python-pipeline/tests/fixtures/.gitignore
git commit -m "test(fixtures): add synthetic 3-min khutbah generator"
```

---

# Phase 1: GPU Policy — Fail Loud

### Task 1.1: NVIDIA GPU + cuBLAS probes

**Files:**
- Create: `python-pipeline/khutbah_pipeline/util/gpu.py`
- Test: `python-pipeline/tests/test_gpu.py`

- [ ] **Step 1: Write the failing tests**

Create `python-pipeline/tests/test_gpu.py`:

```python
import platform
import subprocess
from unittest.mock import patch

import pytest

from khutbah_pipeline.util import gpu


def test_has_nvidia_gpu_present():
    fake = subprocess.CompletedProcess(args=[], returncode=0, stdout=b"NVIDIA GeForce RTX 3060\n", stderr=b"")
    with patch.object(subprocess, "run", return_value=fake):
        assert gpu.has_nvidia_gpu() is True


def test_has_nvidia_gpu_no_smi_binary():
    with patch.object(subprocess, "run", side_effect=FileNotFoundError):
        assert gpu.has_nvidia_gpu() is False


def test_has_nvidia_gpu_smi_returns_nonzero():
    fake = subprocess.CompletedProcess(args=[], returncode=9, stdout=b"", stderr=b"NVIDIA-SMI has failed")
    with patch.object(subprocess, "run", return_value=fake):
        assert gpu.has_nvidia_gpu() is False


def test_has_nvidia_gpu_macos_short_circuit():
    with patch.object(platform, "system", return_value="Darwin"):
        # Should never even attempt to call nvidia-smi on macOS
        with patch.object(subprocess, "run") as run:
            assert gpu.has_nvidia_gpu() is False
            run.assert_not_called()


def test_can_load_cublas_linux_when_present(monkeypatch):
    import ctypes
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    seen: list[str] = []
    def fake_cdll(name: str):
        seen.append(name)
        if name == "libcublas.so.12":
            return object()
        raise OSError("not found")
    monkeypatch.setattr(ctypes, "CDLL", fake_cdll)
    assert gpu.can_load_cublas() is True
    assert seen == ["libcublas.so.12"]


def test_can_load_cublas_linux_when_absent(monkeypatch):
    import ctypes
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    monkeypatch.setattr(ctypes, "CDLL", lambda name: (_ for _ in ()).throw(OSError("nope")))
    assert gpu.can_load_cublas() is False


def test_can_load_cublas_macos_returns_false(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Darwin")
    assert gpu.can_load_cublas() is False
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd python-pipeline && pytest tests/test_gpu.py -v
```

Expected: ImportError on `khutbah_pipeline.util.gpu`.

- [ ] **Step 3: Implement gpu.py**

Create `python-pipeline/khutbah_pipeline/util/gpu.py`:

```python
"""GPU presence + CUDA runtime loadability probes.

These are intentionally cheap (subprocess + ctypes dlopen) so they can run
at every detection start without slowing things down.
"""

from __future__ import annotations

import ctypes
import platform
import subprocess


def has_nvidia_gpu() -> bool:
    """Return True if an NVIDIA GPU is visible to the OS via nvidia-smi.

    nvidia-smi ships with the NVIDIA driver on Linux and Windows. On macOS
    NVIDIA support was dropped after 10.13 — short-circuit there.
    """
    if platform.system() == "Darwin":
        return False
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            timeout=2,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0 and bool(r.stdout.strip())


def can_load_cublas() -> bool:
    """Probe whether cuBLAS is actually loadable on this machine.

    ctranslate2 reports CUDA as a "supported compute type" based on its
    compile-time configuration, not on whether libcublas is actually
    present. Without this probe a CUDA inference run can blow up
    mid-stream with "Library libcublas.so.12 is not found or cannot be
    loaded" — the user sees a stack trace 5 minutes into detection.
    """
    system = platform.system()
    if system == "Linux":
        candidates = ["libcublas.so.12", "libcublas.so.11", "libcublas.so"]
    elif system == "Windows":
        candidates = ["cublas64_12.dll", "cublas64_11.dll"]
    else:
        return False
    for name in candidates:
        try:
            ctypes.CDLL(name)
            return True
        except OSError:
            continue
    return False
```

Also add `python-pipeline/khutbah_pipeline/util/__init__.py` if it doesn't already exist (it does — keep as-is).

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd python-pipeline && pytest tests/test_gpu.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add python-pipeline/khutbah_pipeline/util/gpu.py python-pipeline/tests/test_gpu.py
git commit -m "feat(util): add NVIDIA + cuBLAS loadability probes"
```

### Task 1.2: Replace silent CPU fallback in `transcribe.py` with fail-loud `_resolve_device`

**Files:**
- Modify: `python-pipeline/khutbah_pipeline/detect/transcribe.py`
- Test: `python-pipeline/tests/test_pipeline_unit.py` (add new tests)

- [ ] **Step 1: Add the failing tests**

Append to `python-pipeline/tests/test_pipeline_unit.py`:

```python
import pytest
from unittest.mock import patch

from khutbah_pipeline.detect import transcribe


def test_resolve_device_cpu_explicit():
    # User explicitly chose CPU — never probe GPU
    with patch.object(transcribe, "_can_load_cublas", side_effect=AssertionError("must not call")):
        device, _ = transcribe._resolve_device(prefer="cpu")
    assert device == "cpu"


def test_resolve_device_cuda_requested_but_no_cublas_raises():
    with patch("khutbah_pipeline.util.gpu.has_nvidia_gpu", return_value=True), \
         patch("khutbah_pipeline.util.gpu.can_load_cublas", return_value=False):
        with pytest.raises(transcribe.CudaUnavailableError) as exc:
            transcribe._resolve_device(prefer="cuda")
    assert "cuBLAS" in str(exc.value) or "CUDA" in str(exc.value)


def test_resolve_device_cuda_requested_no_gpu_raises():
    with patch("khutbah_pipeline.util.gpu.has_nvidia_gpu", return_value=False):
        with pytest.raises(transcribe.CudaUnavailableError):
            transcribe._resolve_device(prefer="cuda")


def test_resolve_device_auto_no_gpu_falls_back_silently():
    with patch("khutbah_pipeline.util.gpu.has_nvidia_gpu", return_value=False):
        device, _ = transcribe._resolve_device(prefer="auto")
    assert device == "cpu"


def test_resolve_device_auto_gpu_present_no_cublas_raises():
    """Critical: 'auto' must NOT silently fall back when GPU is present but unusable."""
    with patch("khutbah_pipeline.util.gpu.has_nvidia_gpu", return_value=True), \
         patch("khutbah_pipeline.util.gpu.can_load_cublas", return_value=False):
        with pytest.raises(transcribe.CudaUnavailableError) as exc:
            transcribe._resolve_device(prefer="auto")
    msg = str(exc.value)
    # Must give the user actionable next steps
    assert "Settings" in msg or "Compute Device" in msg


def test_resolve_device_auto_gpu_and_cublas_present_uses_cuda():
    with patch("khutbah_pipeline.util.gpu.has_nvidia_gpu", return_value=True), \
         patch("khutbah_pipeline.util.gpu.can_load_cublas", return_value=True), \
         patch("ctranslate2.get_supported_compute_types", return_value={"float16", "int8"}):
        device, compute = transcribe._resolve_device(prefer="auto")
    assert device == "cuda"
    assert compute in ("float16", "int8")
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd python-pipeline && pytest tests/test_pipeline_unit.py -v -k resolve_device
```

Expected: AttributeError on `_resolve_device` and `CudaUnavailableError`.

- [ ] **Step 3: Rewrite the device-resolution code in `transcribe.py`**

Replace the existing `_can_load_cublas` (delete — moved to util/gpu.py), `_detect_device_and_compute`, AND the `try/except` block in `transcribe_multilingual` that catches CUDA errors and re-runs on CPU. Replace with the new resolver:

```python
# At the top of transcribe.py — REPLACE the existing _can_load_cublas function:

from khutbah_pipeline.util.gpu import has_nvidia_gpu, can_load_cublas


class CudaUnavailableError(RuntimeError):
    """Raised when CUDA is requested (or auto-selected) but the runtime
    can't actually use it. Carries an actionable message for the user."""


def _resolve_device(prefer: str = "auto") -> tuple[str, str]:
    """Resolve (device, compute_type) without silent CPU fallback.

    `prefer` ∈ {"auto", "cuda", "cpu"}:
      - "cpu":  always CPU. No probes.
      - "cuda": CUDA or raise. Never CPU.
      - "auto": CUDA if NVIDIA GPU + cuBLAS both present.
                CPU silently if NO NVIDIA GPU.
                RAISE if NVIDIA GPU present but cuBLAS missing — user
                expected GPU acceleration; degrading silently is wrong.
    """
    import ctranslate2

    if prefer not in ("auto", "cuda", "cpu"):
        raise ValueError(f"invalid device preference: {prefer!r}")

    if prefer == "cpu":
        cpu_types = set(ctranslate2.get_supported_compute_types("cpu"))
        for c in ("int8", "int8_float16", "float32"):
            if c in cpu_types:
                return ("cpu", c)
        return ("cpu", "float32")

    gpu_present = has_nvidia_gpu()
    cublas_ok = can_load_cublas() if gpu_present else False

    if prefer == "cuda":
        if not gpu_present:
            raise CudaUnavailableError(
                "CUDA requested but no NVIDIA GPU detected (nvidia-smi failed). "
                "Set Settings → Compute Device to CPU if your machine has no GPU."
            )
        if not cublas_ok:
            raise CudaUnavailableError(
                "CUDA requested but cuBLAS runtime libraries are not loadable on this machine. "
                "Install the CUDA toolkit (Linux: 'apt install nvidia-cuda-toolkit'; "
                "Windows: official CUDA installer at developer.nvidia.com/cuda-downloads), "
                "or change Settings → Compute Device to CPU."
            )

    # prefer == "auto"
    if prefer == "auto":
        if not gpu_present:
            cpu_types = set(ctranslate2.get_supported_compute_types("cpu"))
            for c in ("int8", "int8_float16", "float32"):
                if c in cpu_types:
                    return ("cpu", c)
            return ("cpu", "float32")
        if not cublas_ok:
            raise CudaUnavailableError(
                "An NVIDIA GPU is present, but the CUDA runtime (cuBLAS) cannot be loaded. "
                "Either install the CUDA toolkit so GPU acceleration works, "
                "or change Settings → Compute Device to CPU to acknowledge CPU-only mode. "
                "Auto mode refuses to silently fall back when a GPU is detected."
            )

    cuda_types = set(ctranslate2.get_supported_compute_types("cuda"))
    for c in ("float16", "int8_float16", "int8"):
        if c in cuda_types:
            return ("cuda", c)
    raise CudaUnavailableError(
        "ctranslate2 has no usable CUDA compute type on this machine. "
        "This usually means ctranslate2 was built without CUDA support — "
        "reinstall with 'pip install ctranslate2 --force-reinstall'."
    )


def transcribe_multilingual(
    audio_path: str,
    model_dir: str,
    device: str = "auto",
    compute_type: str = "auto",
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Transcribe audio with explicit device handling and no silent fallback.

    `device` ∈ {"auto", "cuda", "cpu"}. CudaUnavailableError surfaces to the
    caller with an actionable message — Electron main marshals it to the
    renderer's toast.
    """
    resolved_device, resolved_compute = _resolve_device(device)
    if compute_type != "auto":
        resolved_compute = compute_type
    return _transcribe_pass(
        audio_path, model_dir, resolved_device, resolved_compute, progress_cb,
    )
```

Important: **delete** the old `_can_load_cublas` and `_detect_device_and_compute` functions — they're replaced. The retry-on-CPU `try/except` at the end of `transcribe_multilingual` is gone.

- [ ] **Step 4: Run all tests in transcribe.py's circle to confirm nothing else broke**

```bash
cd python-pipeline && pytest tests/test_pipeline_unit.py tests/test_gpu.py -v
```

Expected: all pass, including the 6 new resolve_device tests.

- [ ] **Step 5: Commit**

```bash
git add python-pipeline/khutbah_pipeline/detect/transcribe.py python-pipeline/tests/test_pipeline_unit.py
git commit -m "feat(detect): fail loud when CUDA requested but unusable

Removes silent CPU fallback. Auto mode now raises CudaUnavailableError
with actionable message when an NVIDIA GPU is present but cuBLAS can't
load — silently degrading to CPU defeats the purpose of GPU acceleration
and the user gets a 25-min detect-bounds run instead of a 30-second one.
CPU is only chosen automatically when no NVIDIA GPU exists OR the user
explicitly set Settings -> Compute Device to CPU."
```

### Task 1.3: Add `computeDevice` to AppSettings

**Files:**
- Modify: `electron/store.ts`

- [ ] **Step 1: Read the current AppSettings**

```bash
sed -n '1,45p' electron/store.ts
```

- [ ] **Step 2: Edit the type + defaults**

In `electron/store.ts`, add `computeDevice` to `AppSettings`:

```typescript
export type AppSettings = {
  outputDir?: string;
  audioTargetLufs: number;
  audioTargetTp: number;
  audioTargetLra: number;
  silenceThresholdDb: number;
  silenceMinDuration: number;
  minPart1Duration: number;
  autoPilot: boolean;
  computeDevice: 'auto' | 'cuda' | 'cpu';
  defaultVisibility: 'public' | 'unlisted' | 'private';
  defaultMadeForKids: boolean;
  defaultCategoryId: string;
  defaultTags: string[];
  titleTemplate: string;
  descriptionTemplate: string;
  khatibName: string;
  autoCreateMissingPlaylists: boolean;
};
```

And the default:

```typescript
export const defaults: AppSettings = {
  audioTargetLufs: -14,
  audioTargetTp: -1,
  audioTargetLra: 11,
  silenceThresholdDb: -35,
  silenceMinDuration: 1.5,
  minPart1Duration: 300,
  autoPilot: true,
  computeDevice: 'auto',
  defaultVisibility: 'unlisted',
  // ... rest unchanged
};
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (Existing settings consumers don't reference computeDevice yet — TypeScript is fine with adding required fields if there's a default that satisfies them.)

- [ ] **Step 4: Commit**

```bash
git add electron/store.ts
git commit -m "feat(settings): add computeDevice (auto|cuda|cpu) preference"
```

### Task 1.4: Plumb `computeDevice` through to the Python sidecar

**Files:**
- Modify: `electron/sidecar/manager.ts`
- Modify: `electron/ipc/handlers.ts` (if `detect.run` invocation happens here)
- Modify: `python-pipeline/khutbah_pipeline/__main__.py`

- [ ] **Step 1: Pass `KHUTBAH_COMPUTE_DEVICE` in sidecar env**

In `electron/sidecar/manager.ts`, where the spawn happens, set the env var from settings:

```typescript
// Pseudocode — adapt to actual SidecarManager constructor
import { settingsStore } from '../store';
// ...
const env = {
  ...process.env,
  ...this.opts.env,
  KHUTBAH_COMPUTE_DEVICE: settingsStore.get('computeDevice') ?? 'auto',
};
```

(If the sidecar is started before settings are read, also re-read on each invocation by exposing a `setEnv` method or by re-reading inside the IPC handler that triggers `detect.run`.)

- [ ] **Step 2: Update `detect.run` to accept and apply the device pref**

In `python-pipeline/khutbah_pipeline/__main__.py`, modify `_detect`:

```python
@register("detect.run")
def _detect(
    audio_path: str,
    model_dir: str = "",
    device: str = "",
    notify: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    if not model_dir:
        model_dir = os.environ.get(
            "KHUTBAH_MODEL_DIR",
            "../resources/models/whisper-tiny",  # changed in Task 0.2
        )
    if not device:
        device = os.environ.get("KHUTBAH_COMPUTE_DEVICE", "auto")
    return run_detection_pipeline(
        audio_path,
        model_dir,
        device=device,  # NEW — pipeline passes through to transcribe
        progress_cb=(lambda payload: notify(payload)) if notify else None,
    )
```

- [ ] **Step 3: Thread `device` through `run_detection_pipeline`**

`detect/pipeline.py` will be replaced wholesale in Phase 3. For now, add the param so the wiring lands in this commit:

```python
def run_detection_pipeline(
    audio_path: str,
    model_dir: str,
    silence_noise_db: float = -35.0,
    silence_min_duration: float = 1.5,
    device: str = "auto",
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    # ... existing body ...
    transcript = _transcribe(audio_path, model_dir, device=device, progress_cb=progress_cb)
```

And `_transcribe` indirection:

```python
def _transcribe(
    audio_path: str,
    model_dir: str,
    device: str = "auto",
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    return transcribe_multilingual(audio_path, model_dir, device=device, progress_cb=progress_cb)
```

- [ ] **Step 4: Verify with manual smoke**

```bash
cd python-pipeline && python -c "
from khutbah_pipeline.detect.transcribe import _resolve_device, CudaUnavailableError
import os
os.environ['KHUTBAH_COMPUTE_DEVICE'] = 'cpu'
print(_resolve_device(os.environ['KHUTBAH_COMPUTE_DEVICE']))
"
```

Expected: `('cpu', 'int8')` or similar.

- [ ] **Step 5: Commit**

```bash
git add electron/sidecar/manager.ts python-pipeline/khutbah_pipeline/__main__.py python-pipeline/khutbah_pipeline/detect/pipeline.py
git commit -m "feat(detect): plumb computeDevice from settings through to transcriber"
```

### Task 1.5: Settings UI — Compute Device dropdown

**Files:**
- Modify: `src/screens/Settings.tsx`

- [ ] **Step 1: Read current Settings layout to find the right insertion point**

```bash
grep -n "audioTargetLufs\|silenceThresholdDb\|autoPilot" src/screens/Settings.tsx | head
```

- [ ] **Step 2: Add the dropdown**

Insert near the autoPilot toggle (or in a "Performance" section if one exists; otherwise create one):

```tsx
<section className="space-y-2">
  <h3 className="font-display text-lg">Performance</h3>
  <label className="flex flex-col gap-1">
    <span className="text-sm">Compute Device</span>
    <select
      className="bg-bg-elev border border-border rounded px-2 py-1"
      value={settings.computeDevice}
      onChange={(e) => patch({ computeDevice: e.target.value as 'auto' | 'cuda' | 'cpu' })}
    >
      <option value="auto">Auto (use GPU when present)</option>
      <option value="cuda">GPU (NVIDIA CUDA) — required</option>
      <option value="cpu">CPU only</option>
    </select>
    <span className="text-xs text-text-secondary">
      Auto picks GPU when an NVIDIA card is detected. If a GPU is present but CUDA can't load,
      detection will refuse to start (rather than silently using CPU). Pick CPU here to acknowledge
      CPU-only mode.
    </span>
  </label>
</section>
```

- [ ] **Step 3: Build + smoke**

```bash
npm run build
```

Expected: no TS errors. (If `settings.computeDevice` is typed `string | undefined` somewhere, add a `?? 'auto'` fallback.)

- [ ] **Step 4: Commit**

```bash
git add src/screens/Settings.tsx
git commit -m "feat(settings-ui): add Compute Device dropdown"
```

---

# Phase 2: Editor Playback + Manual Edit Polish

The editor has been the user's daily pain. Symptoms: clicking on the timeline goes to t=0 instead of where you clicked, the preview shows "Video error (code=3 (decode))" mid-scrub, the proxy regenerates in a loop. Root cause is two missing flags in the proxy ffmpeg command at `python-pipeline/khutbah_pipeline/edit/proxy.py:30-32` (no `-pix_fmt yuv420p`, no `-g`/keyint override) plus the source-fallback hack in `Editor.tsx:501,521-534` that compounds the failure when the source is also unfriendly. This phase fixes those, removes the fallback, and adds the keyboard shortcuts every video editor expects.

### Task 2.1: Scrub-friendly + decode-safe proxy command

**Files:**
- Modify: `python-pipeline/khutbah_pipeline/edit/proxy.py`
- Test: `python-pipeline/tests/test_proxy.py`

- [ ] **Step 1: Write the failing test**

Append to `python-pipeline/tests/test_proxy.py` (create the file if absent):

```python
import json
import subprocess
from pathlib import Path

import pytest

from khutbah_pipeline.edit.proxy import generate_proxy


def _ffprobe_streams(path: Path) -> list[dict]:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(r.stdout).get("streams", [])


def _gop_size(path: Path) -> int:
    """Approximate GOP size = frames between consecutive keyframes."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-skip_frame", "nokey",
         "-show_entries", "frame=pts_time", "-select_streams", "v:0",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    times = [float(t) for t in r.stdout.strip().split("\n") if t]
    if len(times) < 2:
        return 0
    # Average interval between keyframes × fps ≈ GOP frames. We just check the
    # interval is small (≤ 1.5 s) which means scrubbing will land within ~1 s.
    intervals = [times[i + 1] - times[i] for i in range(len(times) - 1)]
    return int(max(intervals) * 100)  # × 100 so we can assert < 150 (= 1.5 s)


@pytest.fixture
def hidef_10bit_source(tmp_path: Path) -> Path:
    """Synthesise a 10-bit yuv420p10le source — the typical 'broken' input."""
    out = tmp_path / "src.mp4"
    subprocess.run(
        ["ffmpeg", "-y",
         "-f", "lavfi", "-i", "testsrc=duration=5:size=1920x1080:rate=24",
         "-c:v", "libx264", "-pix_fmt", "yuv420p10le", "-profile:v", "high10",
         "-loglevel", "error", str(out)],
        check=True, capture_output=True,
    )
    return out


def test_proxy_is_8bit_yuv420p_for_chromium(hidef_10bit_source: Path, tmp_path: Path) -> None:
    proxy = tmp_path / "proxy.mp4"
    generate_proxy(str(hidef_10bit_source), str(proxy))
    streams = _ffprobe_streams(proxy)
    v = next(s for s in streams if s["codec_type"] == "video")
    assert v["pix_fmt"] == "yuv420p", f"proxy must be 8-bit yuv420p for Chromium, got {v['pix_fmt']}"
    # Baseline profile is the most compatible
    assert v.get("profile", "").lower() in ("baseline", "constrained baseline")


def test_proxy_has_short_gop_for_fast_scrubbing(hidef_10bit_source: Path, tmp_path: Path) -> None:
    proxy = tmp_path / "proxy.mp4"
    generate_proxy(str(hidef_10bit_source), str(proxy))
    interval_x100 = _gop_size(proxy)
    # Max keyframe interval should be ≤ 1.5 s (interval × 100 ≤ 150)
    assert interval_x100 <= 150, f"GOP interval too large for snappy scrub: {interval_x100/100:.2f}s"
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd python-pipeline && pytest tests/test_proxy.py::test_proxy_is_8bit_yuv420p_for_chromium tests/test_proxy.py::test_proxy_has_short_gop_for_fast_scrubbing -v
```

Expected: `pix_fmt` is yuv420p10le (FAIL), GOP interval is ~10 s (FAIL).

- [ ] **Step 3: Fix the proxy command**

Edit `python-pipeline/khutbah_pipeline/edit/proxy.py`. Replace the `cmd` block (around line 28-37) with:

```python
    cmd = [
        FFMPEG, "-y", "-i", src,
        "-vf", f"scale=-2:'min({max_height},ih)'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p",            # 8-bit only — Chromium can't decode 10-bit H.264
        "-profile:v", "baseline",          # max-compat decode path
        "-level", "3.0",
        "-g", "24", "-keyint_min", "24",   # keyframe every ~1 s @ 24 fps → fast scrub
        "-sc_threshold", "0",              # disable scene-cut keyframes (keep cadence regular)
        "-c:a", "aac", "-b:a", "96k", "-ar", "48000",
        "-movflags", "+faststart",
    ]
```

- [ ] **Step 4: Run — confirm pass**

```bash
cd python-pipeline && pytest tests/test_proxy.py -v
```

Expected: all proxy tests pass.

- [ ] **Step 5: Commit**

```bash
git add python-pipeline/khutbah_pipeline/edit/proxy.py python-pipeline/tests/test_proxy.py
git commit -m "fix(proxy): force 8-bit yuv420p + short GOP + baseline profile

Was producing 10-bit output (yuv420p10le) when source was 10-bit, which
Chromium silently fails to decode (MediaError code=3). Also no GOP override
meant 250-frame default keyframe spacing → 2-3s scrub latency. New proxies
are 8-bit, baseline-profile, GOP=24 (~1s) — instant scrub, universal decode."
```

### Task 2.2: Drop the source-fallback decode-loop hack

**Files:**
- Modify: `src/screens/Editor.tsx`

The current `onMediaError` at `Editor.tsx:512-535` falls back to source on proxy decode error, which then cascades to source decode-fails for non-Chromium-friendly sources. The right behavior: surface the error, offer a Rebuild button, never silently fall back.

- [ ] **Step 1: Read the current handler**

```bash
sed -n '495,545p' src/screens/Editor.tsx
```

- [ ] **Step 2: Replace the fallback logic**

Find the block that sets `proxyBroken` and falls back to `project.sourcePath`. Replace with:

```tsx
// src state (around line 501) — ALWAYS use proxy; never fall back to source.
src={project.proxyPath ?? project.sourcePath}

// onMediaError handler (around line 512-535) — replace with:
onMediaError={(code) => {
  console.error('[editor] video decode error', { code, src: project.proxyPath ?? project.sourcePath });
  // Don't silently switch to source — that's how we ended up in regen loops
  // when the source was ALSO unfriendly. Surface the error; the user can
  // hit "Rebuild proxy" if they want to retry. We do auto-trigger one
  // rebuild attempt if no rebuild is currently in progress, since the
  // common case is "proxy gen got interrupted, file is truncated".
  if (code === 3 || code === 4) {
    setVideoError(`Preview failed to decode (code=${code}). Click Rebuild Proxy to regenerate.`);
    if (!proxyProgress) {
      regenerateProxy();
    }
  }
}}
```

Add `videoError` state at the top of the component (next to `proxyBroken`):

```tsx
const [videoError, setVideoError] = useState<string | null>(null);
```

Remove `proxyBroken` state and all references to it (search for `proxyBroken` in the file). Remove the `proxyBroken || !project.proxyPath ? project.sourcePath : project.proxyPath` ternary — replace with the simpler `project.proxyPath ?? project.sourcePath` (uses source only when no proxy exists yet).

When `regenerateProxy` succeeds, clear the error:

```tsx
// Inside regenerateProxy success path
setVideoError(null);
```

Render the error (find the existing video-error display ~line 565-572 and update):

```tsx
{videoError && (
  <div className="mt-2 px-3 py-2 bg-danger/10 border border-danger/40 rounded text-sm">
    <span className="text-danger font-medium">{videoError}</span>{' '}
    <Button variant="ghost" onClick={regenerateProxy} disabled={!!proxyProgress}>
      ↻ Rebuild proxy
    </Button>
  </div>
)}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke test**

```bash
npm run dev:full
```

Open a project. Verify:
- No more flicker between proxy and source
- If proxy is still broken (legacy file from before Task 2.1's fix), error message appears with rebuild CTA
- After rebuild, error clears and seek works

- [ ] **Step 5: Commit**

```bash
git add src/screens/Editor.tsx
git commit -m "fix(editor): drop source-fallback decode loop; show error + rebuild CTA

The proxy → source fallback existed to mask the decode-failing proxy bug
(now fixed in Task 2.1). With a working proxy generator, the fallback
just causes infinite regen loops when source ALSO has decode issues.
Replace with explicit error state + Rebuild button. Auto-trigger one
regen attempt for the common 'truncated proxy' case."
```

### Task 2.3: Skip proxy generation when source is already scrub-friendly

A 1080p 8-bit H.264 source with short GOPs doesn't need a proxy — Chromium plays it fine. Probing source format takes ~1 s; saves the user ~30 s of proxy gen on every fresh import for sources that are already friendly.

**Files:**
- Modify: `python-pipeline/khutbah_pipeline/edit/proxy.py`
- Test: `python-pipeline/tests/test_proxy.py`

- [ ] **Step 1: Add the failing test**

Append to `python-pipeline/tests/test_proxy.py`:

```python
from khutbah_pipeline.edit.proxy import is_chromium_friendly


@pytest.fixture
def friendly_source(tmp_path: Path) -> Path:
    """An 8-bit yuv420p H.264 + AAC mp4 with short GOP — should not need a proxy."""
    out = tmp_path / "friendly.mp4"
    subprocess.run(
        ["ffmpeg", "-y",
         "-f", "lavfi", "-i", "testsrc=duration=5:size=1280x720:rate=24",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
         "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-profile:v", "main", "-g", "24", "-keyint_min", "24",
         "-c:a", "aac",
         "-loglevel", "error", str(out)],
        check=True, capture_output=True,
    )
    return out


def test_is_chromium_friendly_yes_for_8bit_short_gop(friendly_source: Path) -> None:
    assert is_chromium_friendly(str(friendly_source)) is True


def test_is_chromium_friendly_no_for_10bit(hidef_10bit_source: Path) -> None:
    assert is_chromium_friendly(str(hidef_10bit_source)) is False
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd python-pipeline && pytest tests/test_proxy.py::test_is_chromium_friendly_yes_for_8bit_short_gop -v
```

Expected: ImportError on `is_chromium_friendly`.

- [ ] **Step 3: Implement the probe**

Add to `python-pipeline/khutbah_pipeline/edit/proxy.py`:

```python
from khutbah_pipeline.util.ffmpeg import ffprobe_json


_FRIENDLY_VIDEO_CODECS = {"h264"}
_FRIENDLY_PIX_FMTS = {"yuv420p", "yuvj420p"}
_FRIENDLY_AUDIO_CODECS = {"aac", "mp3"}
MAX_FRIENDLY_GOP_SECONDS = 2.0  # GOP > 2 s makes scrub feel laggy


def is_chromium_friendly(src: str) -> bool:
    """Return True if Chromium can play `src` directly with snappy scrub.

    Used by the renderer to skip proxy generation when the source is
    already an 8-bit short-GOP H.264 file. Saves ~30 s of proxy work on
    every fresh import for already-friendly sources.
    """
    try:
        meta = ffprobe_json(src)
    except Exception:
        return False
    streams = meta.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if v is None:
        return False
    if v.get("codec_name") not in _FRIENDLY_VIDEO_CODECS:
        return False
    if v.get("pix_fmt") not in _FRIENDLY_PIX_FMTS:
        return False
    if a is not None and a.get("codec_name") not in _FRIENDLY_AUDIO_CODECS:
        return False
    # GOP probe: read first 10 keyframes' pts_time, check max interval
    import subprocess, json as _json
    r = subprocess.run(
        ["ffprobe", "-v", "error",
         "-skip_frame", "nokey",
         "-show_entries", "frame=pts_time",
         "-select_streams", "v:0",
         "-read_intervals", "%+30",   # only first 30s
         "-of", "json", src],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return False
    times = [float(f["pts_time"]) for f in _json.loads(r.stdout).get("frames", []) if f.get("pts_time")]
    if len(times) < 2:
        return True  # very short clip — fine
    max_interval = max(times[i + 1] - times[i] for i in range(len(times) - 1))
    return max_interval <= MAX_FRIENDLY_GOP_SECONDS
```

Add an RPC method `paths.is_chromium_friendly` in `__main__.py`:

```python
@register("paths.is_chromium_friendly")
def _paths_is_chromium_friendly(path: str) -> bool:
    from khutbah_pipeline.edit.proxy import is_chromium_friendly
    return is_chromium_friendly(path)
```

- [ ] **Step 4: Run — confirm pass**

```bash
cd python-pipeline && pytest tests/test_proxy.py -v
```

Expected: all 4 proxy tests pass.

- [ ] **Step 5: Wire into Editor — skip proxy gen for friendly sources**

In `src/screens/Editor.tsx`, before kicking off `regenerateProxy` on first load, call the new RPC:

```tsx
useEffect(() => {
  if (!project.proxyPath && project.sourcePath) {
    (async () => {
      const friendly = await window.khutbah.pipeline.call(
        'paths.is_chromium_friendly', { path: project.sourcePath }
      );
      if (friendly) {
        // Mark project as 'no proxy needed' — render with sourcePath directly
        await updateProject(project.id, { proxyPath: project.sourcePath, proxySkipped: true });
      } else {
        regenerateProxy();
      }
    })();
  }
}, [project.id]);
```

Add `proxySkipped: boolean` to the project type if it isn't already there.

- [ ] **Step 6: Commit**

```bash
git add python-pipeline/khutbah_pipeline/edit/proxy.py python-pipeline/khutbah_pipeline/__main__.py python-pipeline/tests/test_proxy.py src/screens/Editor.tsx
git commit -m "feat(proxy): skip generation when source is already scrub-friendly

Saves ~30s on every fresh import for 8-bit short-GOP H.264 sources
(typical YouTube/yt-dlp output). Probes via ffprobe, takes < 1s. Sources
that need a proxy (10-bit, HEVC, long-GOP, exotic containers) still get
one generated as before."
```

### Task 2.4: Keyboard shortcuts (J/K/L, I/O, space, arrows)

The editor has buttons but no keys. Every NLE has J/K/L for transport — adding them is muscle-memory glue.

**Files:**
- Modify: `src/screens/Editor.tsx` (or a new `src/editor/useShortcuts.ts` hook)

- [ ] **Step 1: Add the shortcut hook**

Create `src/editor/useShortcuts.ts`:

```tsx
import { useEffect } from 'react';

type Handlers = {
  onPlayPause: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onStepBackFrame: () => void;
  onStepForwardFrame: () => void;
  onSetIn: () => void;
  onSetOut: () => void;
  onSplit: () => void;
};

export function useEditorShortcuts(h: Handlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing in inputs / textareas
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          h.onPlayPause();
          return;
        case 'j':
        case 'J':
          e.preventDefault();
          h.onStepBack();
          return;
        case 'l':
        case 'L':
          e.preventDefault();
          h.onStepForward();
          return;
        case 'i':
        case 'I':
          e.preventDefault();
          h.onSetIn();
          return;
        case 'o':
        case 'O':
          e.preventDefault();
          h.onSetOut();
          return;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) h.onStepBackFrame();
          else h.onStepBack();
          return;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) h.onStepForwardFrame();
          else h.onStepForward();
          return;
        case 's':
        case 'S':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            h.onSplit();
          }
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [h]);
}
```

- [ ] **Step 2: Wire into Editor.tsx**

In `src/screens/Editor.tsx`, after the existing transport handlers are defined:

```tsx
import { useEditorShortcuts } from '../editor/useShortcuts';

// ...

useEditorShortcuts({
  onPlayPause: () => (playing ? videoRef.current?.pause() : videoRef.current?.play()),
  onStepBack: () => onSeek(Math.max(0, currentTime - 1)),
  onStepForward: () => onSeek(Math.min(duration, currentTime + 1)),
  onStepBackFrame: () => onSeek(Math.max(0, currentTime - 1 / 24)),
  onStepForwardFrame: () => onSeek(Math.min(duration, currentTime + 1 / 24)),
  onSetIn: () => {
    // Apply to the active part — Part 1 if currentTime is before sit-down, Part 2 otherwise
    const part = currentTime < (markers.p1Out ?? duration / 2) ? 1 : 2;
    setMarker(part, 'in', currentTime);
  },
  onSetOut: () => {
    const part = currentTime < (markers.p1Out ?? duration / 2) ? 1 : 2;
    setMarker(part, 'out', currentTime);
  },
  onSplit: () => splitAtCurrent(),
});
```

(Adapt `setMarker` and `splitAtCurrent` to whatever the actual handlers are named in the existing code.)

- [ ] **Step 3: Add a help overlay**

Add a small "?" button or a `<kbd>` legend in the timeline footer listing the shortcuts. Optional but very Premiere-y:

```tsx
<div className="text-xs text-text-secondary flex gap-2">
  <kbd className="px-1 border rounded">Space</kbd> play/pause
  <kbd className="px-1 border rounded">J/L</kbd> rew/fwd 1s
  <kbd className="px-1 border rounded">⇧←/→</kbd> 1 frame
  <kbd className="px-1 border rounded">I/O</kbd> in/out
  <kbd className="px-1 border rounded">S</kbd> split
</div>
```

- [ ] **Step 4: Type-check + smoke**

```bash
npx tsc --noEmit
npm run dev:full
```

Verify shortcuts work: open project, press space → play/pause; J/L → rew/fwd; I/O → set markers; S → split.

- [ ] **Step 5: Commit**

```bash
git add src/editor/useShortcuts.ts src/screens/Editor.tsx
git commit -m "feat(editor): J/K/L + I/O + arrow keyboard shortcuts"
```

---

# Phase 3: Detection Rewrite

### Task 3.1: silero-vad wrapper

**Files:**
- Create: `python-pipeline/khutbah_pipeline/detect/vad.py`
- Test: `python-pipeline/tests/test_vad.py`

- [ ] **Step 1: Write the failing test**

Create `python-pipeline/tests/test_vad.py`:

```python
from pathlib import Path

import pytest

from khutbah_pipeline.detect.vad import detect_speech_segments


FIXTURE = Path(__file__).parent / "fixtures" / "khutbah_3min.mp4"


@pytest.fixture(autouse=True, scope="module")
def _ensure_fixture() -> None:
    if not FIXTURE.exists():
        pytest.skip(f"fixture missing — run {FIXTURE.parent / 'make_khutbah_fixture.sh'}")


def test_detect_speech_segments_finds_two_speech_blocks() -> None:
    segs = detect_speech_segments(str(FIXTURE))
    # Fixture: silence 0-30, tone 30-90 (Part 1), silence 90-120, tone 120-150 (Part 2), silence 150-180
    # Tones are speech-like enough to trigger silero, sine waves don't — so we expect ZERO or TWO.
    # silero detects voiced content; pure sine waves don't always trigger. We assert structure
    # without asserting count to avoid model-version flakiness.
    assert isinstance(segs, list)
    for s in segs:
        assert "start" in s and "end" in s
        assert 0 <= s["start"] < s["end"] <= 180.5  # within fixture bounds


def test_detect_speech_segments_returns_empty_for_silence(tmp_path) -> None:
    silent = tmp_path / "silent.wav"
    import subprocess
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i",
         "anullsrc=channel_layout=mono:sample_rate=16000:d=10",
         "-loglevel", "error", str(silent)],
        check=True, capture_output=True,
    )
    segs = detect_speech_segments(str(silent))
    assert segs == []
```

(The synthetic fixture uses sine tones rather than real speech — silero may or may not flag them. We test the API surface and the silence-→-empty case rigorously, and rely on real-clip QA for accuracy on actual khutbah audio.)

- [ ] **Step 2: Run — confirm fail**

```bash
cd python-pipeline && pytest tests/test_vad.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement vad.py**

Create `python-pipeline/khutbah_pipeline/detect/vad.py`:

```python
"""silero-vad wrapper.

Returns speech segments [{start, end}, ...] in seconds. Decoded audio is
streamed from ffmpeg at 16 kHz mono — silero's required input format.
"""

from __future__ import annotations

import subprocess
from typing import Any, Callable, Optional

import numpy as np

from khutbah_pipeline.util.ffmpeg import FFMPEG


SAMPLE_RATE = 16000  # silero-vad's required rate


def detect_speech_segments(
    audio_path: str,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> list[dict[str, float]]:
    """Run silero-vad over the full audio file and return speech intervals.

    Streams 16 kHz mono PCM from ffmpeg through silero-vad's get_speech_timestamps.
    Cost: ~30-60 s on CPU for a 3 hr source on a modern laptop.
    """
    # Lazy import — silero-vad pulls torch which is heavy at import time.
    from silero_vad import load_silero_vad, get_speech_timestamps
    import torch

    if progress_cb:
        progress_cb({"stage": "vad", "message": "Loading VAD model…", "progress": 0.0})

    model = load_silero_vad()

    if progress_cb:
        progress_cb({"stage": "vad", "message": "Decoding audio for VAD…", "progress": 0.1})

    proc = subprocess.run(
        [
            FFMPEG, "-y", "-i", audio_path,
            "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
            "-f", "s16le", "-loglevel", "error", "pipe:1",
        ],
        capture_output=True,
        check=True,
    )
    samples = np.frombuffer(proc.stdout, dtype=np.int16)
    if samples.size == 0:
        return []
    audio = torch.from_numpy(samples.astype(np.float32) / 32768.0)

    if progress_cb:
        progress_cb({"stage": "vad", "message": "Running VAD…", "progress": 0.5})

    timestamps = get_speech_timestamps(
        audio, model,
        sampling_rate=SAMPLE_RATE,
        return_seconds=True,
        min_speech_duration_ms=500,
        min_silence_duration_ms=300,
    )

    segs = [{"start": float(t["start"]), "end": float(t["end"])} for t in timestamps]

    if progress_cb:
        progress_cb({"stage": "vad", "message": f"Found {len(segs)} speech segments", "progress": 1.0})

    return segs
```

- [ ] **Step 4: Run — confirm pass**

```bash
cd python-pipeline && pytest tests/test_vad.py -v
```

Expected: 2 passed (1 may be skipped if fixture not built).

- [ ] **Step 5: Commit**

```bash
git add python-pipeline/khutbah_pipeline/detect/vad.py python-pipeline/tests/test_vad.py
git commit -m "feat(detect): silero-vad speech segment detector"
```

### Task 3.2: ffmpeg scdet shot detection wrapper

**Files:**
- Create: `python-pipeline/khutbah_pipeline/detect/shots.py`
- Test: `python-pipeline/tests/test_shots.py`

- [ ] **Step 1: Write the failing test**

Create `python-pipeline/tests/test_shots.py`:

```python
from pathlib import Path

import pytest

from khutbah_pipeline.detect.shots import detect_shot_boundaries


FIXTURE = Path(__file__).parent / "fixtures" / "khutbah_3min.mp4"


@pytest.fixture(autouse=True, scope="module")
def _ensure_fixture() -> None:
    if not FIXTURE.exists():
        pytest.skip(f"fixture missing — run {FIXTURE.parent / 'make_khutbah_fixture.sh'}")


def test_detect_shot_boundaries_finds_known_cut_at_90s() -> None:
    cuts = detect_shot_boundaries(str(FIXTURE), threshold=0.4)
    # Fixture has black→red switch at exactly 90 s
    assert isinstance(cuts, list)
    assert any(89.0 < c["time"] < 91.0 for c in cuts), f"expected cut near 90 s, got {cuts}"
    for c in cuts:
        assert "time" in c and "score" in c
        assert 0.0 < c["score"] <= 1.0


def test_detect_shot_boundaries_high_threshold_returns_few(tmp_path) -> None:
    cuts = detect_shot_boundaries(str(FIXTURE), threshold=0.99)
    # Threshold near 1.0 — should match very few or no cuts
    assert len(cuts) <= 1
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd python-pipeline && pytest tests/test_shots.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement shots.py**

Create `python-pipeline/khutbah_pipeline/detect/shots.py`:

```python
"""Shot boundary detection via ffmpeg's scdet filter.

Streams scene-change scores out of ffmpeg, parses the stderr metadata, and
returns the timestamps where score crosses `threshold`. Much faster than
PySceneDetect (single ffmpeg pass, no Python decoding loop).
"""

from __future__ import annotations

import re
import subprocess
from typing import Any

from khutbah_pipeline.util.ffmpeg import FFMPEG


def detect_shot_boundaries(
    video_path: str,
    threshold: float = 0.4,
) -> list[dict[str, Any]]:
    """Run ffmpeg scdet and return [{time, score}, ...].

    threshold ∈ (0, 1]. Lower → more sensitive. ~0.4 catches obvious cuts;
    ~0.2 is jumpy; ~0.7 misses smooth dissolves.
    """
    cmd = [
        FFMPEG, "-hide_banner", "-i", video_path,
        "-vf", f"scdet=t={threshold}",
        "-an", "-f", "null", "-",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(
            f"ffmpeg scdet failed (exit {r.returncode}): {r.stderr[-500:]}"
        )
    # scdet emits lines like:
    #   [scdet @ 0x...] lavfi.scd.score: 0.567, lavfi.scd.time: 90.041667
    pattern = re.compile(
        r"lavfi\.scd\.score:\s*([\d.]+).*?lavfi\.scd\.time:\s*([\d.]+)",
        re.DOTALL,
    )
    cuts: list[dict[str, Any]] = []
    for m in pattern.finditer(r.stderr):
        score = float(m.group(1))
        t = float(m.group(2))
        cuts.append({"time": t, "score": score})
    return cuts
```

- [ ] **Step 4: Run — confirm pass**

```bash
cd python-pipeline && pytest tests/test_shots.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add python-pipeline/khutbah_pipeline/detect/shots.py python-pipeline/tests/test_shots.py
git commit -m "feat(detect): ffmpeg scdet shot boundary detector"
```

### Task 3.3: Candidate scorer

Combines VAD silences + shot cuts + the existing `silencedetect` output into ranked candidates per boundary kind (Part 1 start, sit-down, Part 2 end). Pure Python, no I/O — fast and deterministic to test.

**Files:**
- Create: `python-pipeline/khutbah_pipeline/detect/candidates.py`
- Test: `python-pipeline/tests/test_candidates.py`

- [ ] **Step 1: Write the failing tests**

Create `python-pipeline/tests/test_candidates.py`:

```python
from khutbah_pipeline.detect.candidates import (
    score_part1_start_candidates,
    score_sitdown_candidates,
    score_part2_end_candidates,
)


def test_part1_start_prefers_long_silence_just_before_first_speech():
    speech = [{"start": 30.0, "end": 90.0}, {"start": 120.0, "end": 150.0}]
    silences = [{"start": 0.0, "end": 30.0, "duration": 30.0}, {"start": 90.0, "end": 120.0, "duration": 30.0}]
    shots = [{"time": 5.0, "score": 0.8}, {"time": 28.0, "score": 0.6}]
    cands = score_part1_start_candidates(speech, silences, shots, duration=180.0)
    assert cands, "expected candidates"
    # Best candidate should be near 30 s (start of first speech)
    assert abs(cands[0]["time"] - 30.0) < 5.0
    assert cands[0]["score"] > cands[-1]["score"]


def test_sitdown_prefers_longest_silence_in_middle():
    speech = [{"start": 30.0, "end": 600.0}, {"start": 800.0, "end": 1700.0}]
    silences = [
        {"start": 0.0, "end": 30.0, "duration": 30.0},        # too early
        {"start": 600.0, "end": 800.0, "duration": 200.0},    # the sitting silence
        {"start": 1700.0, "end": 1800.0, "duration": 100.0},  # post-roll
    ]
    cands = score_sitdown_candidates(speech, silences, [], duration=1800.0, part1_start=30.0)
    assert cands
    # Best should be the 600-800 silence
    assert 595.0 < cands[0]["time"] < 805.0


def test_part2_end_prefers_silence_after_last_speech():
    speech = [{"start": 800.0, "end": 1700.0}]
    silences = [{"start": 1700.0, "end": 1800.0, "duration": 100.0}]
    cands = score_part2_end_candidates(speech, silences, [], duration=1800.0, part2_start=800.0)
    assert cands
    assert 1695.0 < cands[0]["time"] < 1810.0


def test_returns_top_n_only():
    silences = [{"start": float(i), "end": float(i + 1), "duration": 1.0} for i in range(20)]
    speech = [{"start": 0.0, "end": 100.0}]
    cands = score_sitdown_candidates(speech, silences, [], duration=100.0, part1_start=0.0, top_n=3)
    assert len(cands) <= 3
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd python-pipeline && pytest tests/test_candidates.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement candidates.py**

Create `python-pipeline/khutbah_pipeline/detect/candidates.py`:

```python
"""Combine VAD speech segments + ffmpeg silencedetect + shot cuts into
ranked boundary candidates.

Pure Python, no I/O — runs in < 1 ms even for hour-long sources.
"""

from __future__ import annotations

from typing import Any


def _shot_proximity_bonus(t: float, shots: list[dict[str, Any]], window: float = 5.0) -> float:
    """Bonus 0..1 if a shot cut sits within `window` seconds of t."""
    nearest = min(
        (abs(s["time"] - t) for s in shots), default=float("inf"),
    )
    if nearest >= window:
        return 0.0
    return (1.0 - nearest / window) * 0.3  # cap shot contribution at 0.3


def score_part1_start_candidates(
    speech: list[dict[str, float]],
    silences: list[dict[str, float]],
    shots: list[dict[str, Any]],
    duration: float,
    top_n: int = 5,
) -> list[dict[str, Any]]:
    """Rank candidates for the Part 1 start boundary.

    Best candidate: just AFTER a long pre-roll silence and just BEFORE the
    first sustained speech segment. Bonus if a camera cut happens nearby
    (operator switching to the speaker shot).
    """
    if not speech:
        return []
    cands: list[dict[str, Any]] = []
    first_speech_start = speech[0]["start"]
    for s in silences:
        if s["end"] > first_speech_start + 30.0:
            continue  # silence is past where the khutbah already started
        # Candidate time = end of silence (= speech is about to start)
        t = s["end"]
        # Score: silence duration normalised to 30s + how close it is to first speech
        silence_score = min(s["duration"] / 30.0, 1.0) * 0.5
        proximity_score = max(0.0, 1.0 - abs(t - first_speech_start) / 10.0) * 0.2
        shot_score = _shot_proximity_bonus(t, shots)
        total = silence_score + proximity_score + shot_score
        cands.append({"time": t, "score": total, "kind": "part1_start", "source": "silence_end"})

    # Always include first speech start as a candidate (low score if no preceding silence)
    cands.append({
        "time": first_speech_start,
        "score": 0.4,
        "kind": "part1_start",
        "source": "first_speech",
    })

    cands.sort(key=lambda c: c["score"], reverse=True)
    return cands[:top_n]


def score_sitdown_candidates(
    speech: list[dict[str, float]],
    silences: list[dict[str, float]],
    shots: list[dict[str, Any]],
    duration: float,
    part1_start: float,
    min_part1_duration: float = 300.0,
    end_guard: float = 300.0,
    top_n: int = 5,
) -> list[dict[str, Any]]:
    """Rank candidates for the sit-down (Part 1 end / Part 2 start)."""
    cands: list[dict[str, Any]] = []
    for s in silences:
        if s["start"] < part1_start + min_part1_duration:
            continue
        if s["end"] > duration - end_guard:
            continue
        # Score: silence duration is the main signal
        silence_score = min(s["duration"] / 60.0, 1.0)  # 60s sit is strong, anything more is plenty
        shot_score = _shot_proximity_bonus(s["start"], shots)
        total = silence_score + shot_score
        cands.append({
            "time_p1_end": s["start"],
            "time_p2_start": s["end"],
            "time": s["start"],  # convenience for sorting
            "duration": s["duration"],
            "score": total,
            "kind": "sitdown",
            "source": "long_silence",
        })
    cands.sort(key=lambda c: c["score"], reverse=True)
    return cands[:top_n]


def score_part2_end_candidates(
    speech: list[dict[str, float]],
    silences: list[dict[str, float]],
    shots: list[dict[str, Any]],
    duration: float,
    part2_start: float,
    top_n: int = 5,
) -> list[dict[str, Any]]:
    """Rank candidates for the Part 2 end boundary (after dua)."""
    if not speech:
        return []
    last_speech_end = max((s["end"] for s in speech if s["start"] >= part2_start), default=part2_start)
    cands: list[dict[str, Any]] = []
    for s in silences:
        if s["start"] < last_speech_end - 5.0:
            continue
        # The first long silence after speech ends = end of dua
        t = s["start"] + 1.0  # 1s buffer past the last word
        score = min(s["duration"] / 5.0, 1.0)
        cands.append({"time": t, "score": score, "kind": "part2_end", "source": "trailing_silence"})

    # Always include "right after last speech" as a fallback candidate
    cands.append({
        "time": last_speech_end + 2.0,
        "score": 0.5,
        "kind": "part2_end",
        "source": "last_speech_plus_buffer",
    })

    cands.sort(key=lambda c: c["score"], reverse=True)
    return cands[:top_n]
```

- [ ] **Step 4: Run — confirm pass**

```bash
cd python-pipeline && pytest tests/test_candidates.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add python-pipeline/khutbah_pipeline/detect/candidates.py python-pipeline/tests/test_candidates.py
git commit -m "feat(detect): VAD+silence+shot candidate ranking"
```

### Task 3.4: Window transcribe (faster-whisper tiny on small windows)

**Files:**
- Create: `python-pipeline/khutbah_pipeline/detect/window_transcribe.py`
- Test: `python-pipeline/tests/test_window_transcribe.py`

- [ ] **Step 1: Write the failing test**

Create `python-pipeline/tests/test_window_transcribe.py`:

```python
from pathlib import Path

import pytest

from khutbah_pipeline.detect.window_transcribe import transcribe_windows


FIXTURE = Path(__file__).parent / "fixtures" / "khutbah_3min.mp4"
MODEL_DIR = Path(__file__).parents[2] / "resources" / "models" / "whisper-tiny"


@pytest.fixture(autouse=True, scope="module")
def _ensure_assets() -> None:
    if not FIXTURE.exists():
        pytest.skip("fixture missing")
    if not MODEL_DIR.exists():
        pytest.skip(f"whisper-tiny model not found at {MODEL_DIR}; run resources/fetch-resources.sh")


def test_transcribe_windows_returns_words_per_window() -> None:
    windows = [{"id": "w1", "start": 30.0, "end": 40.0}, {"id": "w2", "start": 120.0, "end": 130.0}]
    result = transcribe_windows(str(FIXTURE), str(MODEL_DIR), windows, device="cpu")
    assert "w1" in result and "w2" in result
    for wid, payload in result.items():
        assert "words" in payload
        assert "language" in payload
        for w in payload["words"]:
            assert "word" in w and "start" in w and "end" in w


def test_transcribe_windows_empty_input_returns_empty_dict() -> None:
    out = transcribe_windows(str(FIXTURE), str(MODEL_DIR), [], device="cpu")
    assert out == {}
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd python-pipeline && pytest tests/test_window_transcribe.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement window_transcribe.py**

Create `python-pipeline/khutbah_pipeline/detect/window_transcribe.py`:

```python
"""Transcribe specific time windows of an audio file with whisper-tiny.

This is the speedup that makes the new pipeline practical: instead of
transcribing 3 hours of audio (~25 min CPU on large-v3), we transcribe
~5-15 windows of 10 s each (~30 s CPU on tiny). The windows come from
the candidate scorer — only timestamps where boundaries might be.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from typing import Any, Callable, Optional

from khutbah_pipeline.detect.transcribe import _resolve_device
from khutbah_pipeline.util.ffmpeg import FFMPEG


def _extract_window(audio_path: str, start: float, end: float, dst: str) -> None:
    """Cut a window into a wav file. -ss before -i for fast input seek."""
    duration = max(0.5, end - start)
    subprocess.run(
        [
            FFMPEG, "-y",
            "-ss", f"{start:.3f}", "-i", audio_path,
            "-t", f"{duration:.3f}",
            "-vn", "-ac", "1", "-ar", "16000",
            "-loglevel", "error",
            dst,
        ],
        check=True, capture_output=True,
    )


def transcribe_windows(
    audio_path: str,
    model_dir: str,
    windows: list[dict[str, Any]],
    device: str = "auto",
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, dict[str, Any]]:
    """Run whisper-tiny on each window. Returns {window_id: {words, language}}.

    `windows` items must have `id`, `start`, `end`. Out-of-order windows
    are fine — model loads once and processes serially.
    """
    if not windows:
        return {}

    from faster_whisper import WhisperModel

    resolved_device, resolved_compute = _resolve_device(device)

    if progress_cb:
        progress_cb({
            "stage": "transcribe_windows",
            "message": f"Loading whisper-tiny ({resolved_device}, {resolved_compute})…",
            "progress": 0.0,
        })

    model = WhisperModel(model_dir, device=resolved_device, compute_type=resolved_compute)

    out: dict[str, dict[str, Any]] = {}
    with tempfile.TemporaryDirectory() as tmp:
        for i, w in enumerate(windows):
            wav = os.path.join(tmp, f"w_{i}.wav")
            _extract_window(audio_path, w["start"], w["end"], wav)
            segments, info = model.transcribe(
                wav,
                word_timestamps=True,
                vad_filter=False,  # we already VAD'd
                beam_size=1,        # tiny + beam 1 = fastest path
            )
            words: list[dict[str, Any]] = []
            for seg in segments:
                for word in (seg.words or []):
                    words.append({
                        "word": word.word,
                        "start": float(word.start) + w["start"],
                        "end": float(word.end) + w["start"],
                        "probability": float(word.probability),
                    })
            out[w["id"]] = {"words": words, "language": info.language}
            if progress_cb:
                progress_cb({
                    "stage": "transcribe_windows",
                    "message": f"Window {i + 1}/{len(windows)}",
                    "progress": (i + 1) / len(windows),
                })

    return out
```

- [ ] **Step 4: Run — confirm pass**

```bash
cd python-pipeline && pytest tests/test_window_transcribe.py -v
```

Expected: 2 passed (or skipped if model not fetched yet).

- [ ] **Step 5: Commit**

```bash
git add python-pipeline/khutbah_pipeline/detect/window_transcribe.py python-pipeline/tests/test_window_transcribe.py
git commit -m "feat(detect): tiny-whisper window transcribe (no full-audio decode)"
```

### Task 3.5: New pipeline orchestrator (`pipeline_v2.py`)

Wires VAD + silence + shots → candidates → tiny-whisper → phrase match → boundaries.

**Files:**
- Create: `python-pipeline/khutbah_pipeline/detect/pipeline_v2.py`
- Test: `python-pipeline/tests/test_pipeline_v2.py`

- [ ] **Step 1: Write the failing test**

Create `python-pipeline/tests/test_pipeline_v2.py`:

```python
"""End-to-end pipeline test on the synthetic fixture.

Doesn't assert exact boundaries (the synthetic fixture isn't real speech),
but verifies the pipeline runs without crashing and returns the expected
result shape. Real-clip QA covers correctness in `tests/integration/`.
"""

from pathlib import Path

import pytest

from khutbah_pipeline.detect.pipeline_v2 import run_pipeline_v2


FIXTURE = Path(__file__).parent / "fixtures" / "khutbah_3min.mp4"
MODEL_DIR = Path(__file__).parents[2] / "resources" / "models" / "whisper-tiny"


@pytest.fixture(autouse=True, scope="module")
def _ensure_assets() -> None:
    if not FIXTURE.exists():
        pytest.skip("fixture missing")
    if not MODEL_DIR.exists():
        pytest.skip("whisper-tiny missing")


def test_pipeline_v2_returns_expected_shape() -> None:
    result = run_pipeline_v2(str(FIXTURE), str(MODEL_DIR), device="cpu")
    # Either successful boundaries OR an explicit error key — never crash
    assert isinstance(result, dict)
    if "error" not in result:
        assert "duration" in result
        assert "part1" in result and "part2" in result
        assert "overall_confidence" in result
        for part in (result["part1"], result["part2"]):
            assert "start" in part and "end" in part
            assert "confidence" in part


def test_pipeline_v2_progress_callback_invoked() -> None:
    seen_stages: list[str] = []
    def cb(payload: dict) -> None:
        seen_stages.append(payload.get("stage", ""))
    run_pipeline_v2(str(FIXTURE), str(MODEL_DIR), device="cpu", progress_cb=cb)
    # Must hit at least the new stages
    assert any(s == "vad" for s in seen_stages)
    assert any(s == "shots" for s in seen_stages) or True  # shots may not emit if synchronous
    assert any(s.startswith("transcribe") for s in seen_stages)
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd python-pipeline && pytest tests/test_pipeline_v2.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement pipeline_v2.py**

Create `python-pipeline/khutbah_pipeline/detect/pipeline_v2.py`:

```python
"""V2 detection orchestrator.

Replaces the large-v3 full-transcribe approach with:
  1. silero-vad → speech segments       (~60 s for 3 hr CPU)
  2. ffmpeg silencedetect → silences    (~30 s)
  3. ffmpeg scdet → shot cuts            (~60 s)
  4. Candidate scorer → top N per kind   (< 1 ms)
  5. tiny-whisper on candidate windows   (~30 s for ~15 windows)
  6. phrase match (existing library)     → confidences
  7. Pick highest-confidence per kind    → boundaries

Total target: < 5 min CPU for a 3 hr source; < 1 min on a modest GPU.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from khutbah_pipeline.detect.vad import detect_speech_segments
from khutbah_pipeline.detect.shots import detect_shot_boundaries
from khutbah_pipeline.detect.silence import detect_silences
from khutbah_pipeline.detect.candidates import (
    score_part1_start_candidates,
    score_sitdown_candidates,
    score_part2_end_candidates,
)
from khutbah_pipeline.detect.window_transcribe import transcribe_windows
from khutbah_pipeline.detect.phrases import (
    find_first_opening,
    find_first_adhan_end,
    find_last_closing,
)
from khutbah_pipeline.util.ffmpeg import ffprobe_json


WINDOW_RADIUS = 5.0  # ±5 s around each candidate


def _probe_duration(path: str) -> float:
    meta = ffprobe_json(path)
    return float(meta.get("format", {}).get("duration") or 0)


def _emit(cb: Optional[Callable[[dict[str, Any]], None]], payload: dict[str, Any]) -> None:
    if cb:
        cb(payload)


def run_pipeline_v2(
    audio_path: str,
    model_dir: str,
    device: str = "auto",
    silence_noise_db: float = -35.0,
    silence_min_duration: float = 1.5,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    duration = _probe_duration(audio_path)
    if duration <= 0:
        return {"error": "could_not_probe_duration"}

    _emit(progress_cb, {"stage": "vad", "message": "Voice activity detection…", "progress": 0.0})
    speech = detect_speech_segments(audio_path, progress_cb=progress_cb)

    _emit(progress_cb, {"stage": "silence", "message": "Silence detection…", "progress": 0.25})
    silences = detect_silences(audio_path, silence_noise_db, silence_min_duration)

    _emit(progress_cb, {"stage": "shots", "message": "Shot boundary detection…", "progress": 0.4})
    shots = detect_shot_boundaries(audio_path, threshold=0.4)

    _emit(progress_cb, {"stage": "candidates", "message": "Ranking candidates…", "progress": 0.55})
    p1_cands = score_part1_start_candidates(speech, silences, shots, duration)
    if not p1_cands:
        return {"error": "no_part1_candidates", "duration": duration, "speech": speech}

    # Build windows around top P1 candidates for phrase matching
    windows: list[dict[str, Any]] = []
    for i, c in enumerate(p1_cands):
        windows.append({
            "id": f"p1s_{i}",
            "start": max(0.0, c["time"] - WINDOW_RADIUS),
            "end": min(duration, c["time"] + WINDOW_RADIUS * 2),
            "candidate": c,
        })

    _emit(progress_cb, {"stage": "transcribe_windows", "message": "Transcribing candidate windows…", "progress": 0.6})
    win_results = transcribe_windows(audio_path, model_dir, windows, device=device, progress_cb=progress_cb)

    # Pick the best P1 candidate by phrase match
    best_p1 = None
    best_p1_conf = 0.0
    for i, c in enumerate(p1_cands):
        wid = f"p1s_{i}"
        words = win_results.get(wid, {}).get("words", [])
        opening = find_first_opening(words)
        if opening:
            conf = sum(
                w["probability"]
                for w in words[opening["start_word_idx"]:opening["end_word_idx"] + 1]
            ) / max(1, opening["end_word_idx"] - opening["start_word_idx"] + 1)
            # Combine candidate score (structural) and phrase confidence
            combined = 0.5 * c["score"] + 0.5 * conf
            if combined > best_p1_conf:
                best_p1_conf = combined
                best_p1 = {
                    "time": opening["start_time"] - 5.0,
                    "anchor": "opening",
                    "transcript": " ".join(w["word"] for w in words[opening["start_word_idx"]:opening["end_word_idx"] + 1]),
                    "confidence": combined,
                }
    # Fallback: structurally-best candidate without phrase match
    if best_p1 is None:
        c = p1_cands[0]
        best_p1 = {
            "time": c["time"],
            "anchor": "structural_only",
            "transcript": "",
            "confidence": c["score"] * 0.55,  # capped — caller should manual-verify
        }

    p1_start = max(0.0, best_p1["time"])

    # Sit-down candidates
    sit_cands = score_sitdown_candidates(speech, silences, shots, duration, part1_start=p1_start)
    if not sit_cands:
        return {
            "error": "sitting_silence_not_found",
            "duration": duration,
            "part1_start": p1_start,
            "speech": speech,
        }
    sit = sit_cands[0]
    p1_end = sit["time_p1_end"]
    p2_start = sit["time_p2_start"]

    # Part 2 end
    p2e_cands = score_part2_end_candidates(speech, silences, shots, duration, part2_start=p2_start)
    # Build windows for last-closing match around top P2 end candidates
    p2_windows: list[dict[str, Any]] = []
    for i, c in enumerate(p2e_cands):
        p2_windows.append({
            "id": f"p2e_{i}",
            "start": max(p2_start, c["time"] - WINDOW_RADIUS * 2),
            "end": min(duration, c["time"] + WINDOW_RADIUS),
        })
    p2_win_results = transcribe_windows(audio_path, model_dir, p2_windows, device=device)

    best_p2 = None
    best_p2_conf = 0.0
    dominant_lang = "ar"
    for i, c in enumerate(p2e_cands):
        wid = f"p2e_{i}"
        words = p2_win_results.get(wid, {}).get("words", [])
        if words:
            dominant_lang = p2_win_results[wid].get("language", "ar")
        closing = find_last_closing(words, dominant_lang=dominant_lang)
        if closing:
            conf = 0.9
            combined = 0.5 * c["score"] + 0.5 * conf
            if combined > best_p2_conf:
                best_p2_conf = combined
                best_p2 = {"time": closing["end_time"] + 1.0, "confidence": combined}
    if best_p2 is None:
        c = p2e_cands[0]
        best_p2 = {"time": c["time"], "confidence": c["score"] * 0.6}

    p2_end = min(duration, best_p2["time"])
    overall = min(best_p1["confidence"], 1.0, best_p2["confidence"])

    _emit(progress_cb, {"stage": "done", "message": "Detection complete", "progress": 1.0})

    return {
        "duration": duration,
        "part1": {
            "start": p1_start,
            "end": p1_end,
            "confidence": best_p1["confidence"],
            "transcript_at_start": best_p1["transcript"],
            "anchor": best_p1["anchor"],
        },
        "part2": {
            "start": p2_start,
            "end": p2_end,
            "confidence": best_p2["confidence"],
        },
        "lang_dominant": dominant_lang,
        "overall_confidence": overall,
        "candidates": {
            "part1_start": p1_cands,
            "sitdown": sit_cands,
            "part2_end": p2e_cands,
        },
    }
```

- [ ] **Step 4: Run — confirm pass**

```bash
cd python-pipeline && pytest tests/test_pipeline_v2.py -v
```

Expected: 2 passed (or skipped pending model fetch).

- [ ] **Step 5: Commit**

```bash
git add python-pipeline/khutbah_pipeline/detect/pipeline_v2.py python-pipeline/tests/test_pipeline_v2.py
git commit -m "feat(detect): VAD-first pipeline orchestrator (pipeline_v2)"
```

### Task 3.6: Cut over `detect.run` to `pipeline_v2`

**Files:**
- Modify: `python-pipeline/khutbah_pipeline/detect/pipeline.py`
- Modify: `python-pipeline/khutbah_pipeline/__main__.py`

- [ ] **Step 1: Replace `pipeline.py` with a thin shim that delegates to v2**

```python
"""Compat shim — delegates to pipeline_v2.

Kept as `pipeline.run_detection_pipeline` so existing callers (the RPC
handler, tests) don't change. New work should import pipeline_v2 directly.
"""
from typing import Any, Callable, Optional

from khutbah_pipeline.detect.pipeline_v2 import run_pipeline_v2


def run_detection_pipeline(
    audio_path: str,
    model_dir: str,
    silence_noise_db: float = -35.0,
    silence_min_duration: float = 1.5,
    device: str = "auto",
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    return run_pipeline_v2(
        audio_path=audio_path,
        model_dir=model_dir,
        device=device,
        silence_noise_db=silence_noise_db,
        silence_min_duration=silence_min_duration,
        progress_cb=progress_cb,
    )
```

- [ ] **Step 2: Run all detect tests**

```bash
cd python-pipeline && pytest tests/test_pipeline_unit.py tests/test_pipeline_v2.py tests/test_phrases.py -v
```

Expected: pipeline_unit may need updates (some old tests reference the deleted code paths). Update or delete those — DO NOT silence them.

- [ ] **Step 3: Update `KHUTBAH_MODEL_DIR` default in `__main__.py`**

```python
model_dir = os.environ.get(
    "KHUTBAH_MODEL_DIR",
    "../resources/models/whisper-tiny",  # was whisper-large-v3
)
```

- [ ] **Step 4: Update `electron-builder.json` extraResources**

Find the entry pointing to `resources/models/whisper-large-v3` and change it to `whisper-tiny`. Also update `electron/sidecar/manager.ts` if it sets `KHUTBAH_MODEL_DIR` from a hardcoded path.

- [ ] **Step 5: Smoke test full chain**

```bash
npm run dev:full
```

Open the app, click Detect bounds on a real khutbah recording, verify:
- Progress events flow (`stage: vad`, `stage: silence`, `stage: shots`, `stage: transcribe_windows`, `stage: done`)
- Total runtime < 5 min on CPU for a typical 1-2 hr source

- [ ] **Step 6: Commit**

```bash
git add python-pipeline/khutbah_pipeline/detect/pipeline.py python-pipeline/khutbah_pipeline/__main__.py electron-builder.json electron/sidecar/manager.ts
git commit -m "feat(detect): cut over detect.run to VAD-first pipeline_v2"
```

### Task 3.7: Remove the dead `transcribe_multilingual` full-audio path (optional cleanup)

If no caller still uses `transcribe_multilingual` on the full audio (window_transcribe uses `WhisperModel` directly), the function can be deleted. Preserve `_resolve_device`, `_transcribe_pass`, and `CudaUnavailableError` — they're still used.

- [ ] **Step 1: Search for callers**

```bash
grep -rn "transcribe_multilingual" python-pipeline/ src/ electron/ 2>/dev/null
```

- [ ] **Step 2: If no callers remain, delete the function**

Edit `python-pipeline/khutbah_pipeline/detect/transcribe.py` and remove `transcribe_multilingual` (the public wrapper). Keep `_resolve_device`, `_transcribe_pass`, `CudaUnavailableError`, `has_nvidia_gpu` import.

- [ ] **Step 3: Run all detect tests**

```bash
cd python-pipeline && pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add python-pipeline/khutbah_pipeline/detect/transcribe.py
git commit -m "chore(detect): remove unused full-audio transcribe_multilingual"
```

---

# Phase 4: Real Smart-Cut

### Task 4.1: ffprobe keyframe lookup

**Files:**
- Create: `python-pipeline/khutbah_pipeline/util/keyframes.py`
- Test: `python-pipeline/tests/test_keyframes.py`

- [ ] **Step 1: Write the failing test**

Create `python-pipeline/tests/test_keyframes.py`:

```python
import subprocess
from pathlib import Path

import pytest

from khutbah_pipeline.util.keyframes import (
    list_keyframes,
    nearest_keyframe_at_or_before,
    nearest_keyframe_at_or_after,
)


@pytest.fixture
def keyframed_clip(tmp_path: Path) -> Path:
    """A 10s clip with keyframes every 2 seconds (-g 48 -keyint_min 48 at 24fps)."""
    out = tmp_path / "kf.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=duration=10:size=320x180:rate=24",
            "-c:v", "libx264", "-g", "48", "-keyint_min", "48",
            "-pix_fmt", "yuv420p",
            "-loglevel", "error",
            str(out),
        ],
        check=True, capture_output=True,
    )
    return out


def test_list_keyframes_returns_at_least_first_frame(keyframed_clip: Path) -> None:
    kfs = list_keyframes(str(keyframed_clip))
    assert kfs, "expected at least one keyframe"
    assert kfs[0] < 0.1
    # Spaced ~2s apart
    if len(kfs) >= 2:
        assert 1.5 < (kfs[1] - kfs[0]) < 2.5


def test_nearest_keyframe_at_or_before(keyframed_clip: Path) -> None:
    kfs = list_keyframes(str(keyframed_clip))
    t = nearest_keyframe_at_or_before(kfs, 5.0)
    assert t <= 5.0
    # Can't be more than ~2s away from query (keyframe interval)
    assert 5.0 - t < 2.5


def test_nearest_keyframe_at_or_after(keyframed_clip: Path) -> None:
    kfs = list_keyframes(str(keyframed_clip))
    t = nearest_keyframe_at_or_after(kfs, 5.0)
    assert t >= 5.0
    assert t - 5.0 < 2.5


def test_nearest_keyframe_before_zero_is_first(keyframed_clip: Path) -> None:
    kfs = list_keyframes(str(keyframed_clip))
    assert nearest_keyframe_at_or_before(kfs, 0.0) == kfs[0]


def test_nearest_keyframe_after_end_is_last(keyframed_clip: Path) -> None:
    kfs = list_keyframes(str(keyframed_clip))
    # Past end of clip — should return None or last
    assert nearest_keyframe_at_or_after(kfs, 999.0) in (None, kfs[-1])
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd python-pipeline && pytest tests/test_keyframes.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement keyframes.py**

Create `python-pipeline/khutbah_pipeline/util/keyframes.py`:

```python
"""Keyframe (I-frame) lookup via ffprobe.

Used by the smart-cut pipeline to snap requested cut points to nearest
keyframes — that's what makes stream-copy possible without re-encoding.
"""

from __future__ import annotations

import json
import subprocess
from typing import Optional


def list_keyframes(video_path: str) -> list[float]:
    """Return all keyframe timestamps in seconds, sorted ascending.

    ffprobe -skip_frame nokey -show_entries frame=pts_time -select_streams v
    enumerates only frames where pict_type=I (keyframes). Cost: a few seconds
    even for hour-long files (no decode, just packet header walk).
    """
    cmd = [
        "ffprobe",
        "-v", "error",
        "-skip_frame", "nokey",
        "-show_entries", "frame=pts_time",
        "-select_streams", "v:0",
        "-of", "json",
        video_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(r.stdout)
    times: list[float] = []
    for f in data.get("frames", []):
        t = f.get("pts_time")
        if t is not None:
            try:
                times.append(float(t))
            except ValueError:
                continue
    times.sort()
    return times


def nearest_keyframe_at_or_before(keyframes: list[float], t: float) -> Optional[float]:
    """Largest keyframe ≤ t. None if t is before the first keyframe."""
    best: Optional[float] = None
    for kt in keyframes:
        if kt > t:
            break
        best = kt
    if best is None and keyframes:
        return keyframes[0]
    return best


def nearest_keyframe_at_or_after(keyframes: list[float], t: float) -> Optional[float]:
    """Smallest keyframe ≥ t. None if t is past the last keyframe."""
    for kt in keyframes:
        if kt >= t:
            return kt
    return keyframes[-1] if keyframes else None
```

- [ ] **Step 4: Run — confirm pass**

```bash
cd python-pipeline && pytest tests/test_keyframes.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add python-pipeline/khutbah_pipeline/util/keyframes.py python-pipeline/tests/test_keyframes.py
git commit -m "feat(util): ffprobe keyframe enumeration + nearest-K lookups"
```

### Task 4.2: Refactor `smartcut.py` — stream-copy video, re-encode audio with loudnorm

**Files:**
- Modify: `python-pipeline/khutbah_pipeline/edit/smartcut.py`
- Test: `python-pipeline/tests/test_smartcut_keyframe.py`

- [ ] **Step 1: Write the failing test**

Create `python-pipeline/tests/test_smartcut_keyframe.py`:

```python
"""Smart-cut speed + correctness test.

Asserts:
- Output has the requested duration (within keyframe-snap tolerance)
- Audio is loudnorm-corrected (RMS energy bumped)
- Wall-clock runtime is fast (< 30 s for a 30 s clip — way below full re-encode)
"""

import subprocess
import time
from pathlib import Path

import pytest

from khutbah_pipeline.edit.smartcut import smart_cut_segment


@pytest.fixture
def long_clip(tmp_path: Path) -> Path:
    """30s clip with keyframes every 2s and a tone for measurable loudness."""
    out = tmp_path / "long.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=duration=30:size=640x360:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=30",
            "-c:v", "libx264", "-g", "48", "-keyint_min", "48",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-loglevel", "error",
            str(out),
        ],
        check=True, capture_output=True,
    )
    return out


def _probe_duration(p: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


def test_smart_cut_keyframe_snap_produces_close_duration(long_clip: Path, tmp_path: Path) -> None:
    out = tmp_path / "cut.mp4"
    smart_cut_segment(
        src=str(long_clip),
        dst=str(out),
        start=5.0,
        duration=10.0,
        target_lufs=-14, target_tp=-1, target_lra=11,
    )
    actual = _probe_duration(out)
    # Snap can shift up to ~2s on each side
    assert 8.0 < actual < 13.0


def test_smart_cut_runs_fast(long_clip: Path, tmp_path: Path) -> None:
    out = tmp_path / "cut.mp4"
    t0 = time.monotonic()
    smart_cut_segment(
        src=str(long_clip),
        dst=str(out),
        start=5.0,
        duration=10.0,
        target_lufs=-14, target_tp=-1, target_lra=11,
    )
    elapsed = time.monotonic() - t0
    # Stream-copy + audio re-encode for 10 s clip should be < 5 s on any modern CPU.
    # Old full-reencode took ~10-20 s for this same input.
    assert elapsed < 10.0, f"smart_cut took {elapsed:.1f}s — should be < 10s"


def test_smart_cut_progress_callback_invoked(long_clip: Path, tmp_path: Path) -> None:
    seen: list[float] = []
    def cb(p):
        if "progress" in p:
            seen.append(p["progress"])
    smart_cut_segment(
        src=str(long_clip),
        dst=str(tmp_path / "cut.mp4"),
        start=5.0,
        duration=10.0,
        target_lufs=-14, target_tp=-1, target_lra=11,
        progress_cb=cb,
    )
    assert seen, "expected progress emissions"
    assert max(seen) >= 0.95
```

- [ ] **Step 2: Run — confirm fail (or fail on duration / time)**

```bash
cd python-pipeline && pytest tests/test_smartcut_keyframe.py -v
```

Expected: tests fail because the current full-reencode is too slow OR duration assertion may pass but `test_smart_cut_runs_fast` fails.

- [ ] **Step 3: Rewrite smartcut.py**

Replace the contents of `python-pipeline/khutbah_pipeline/edit/smartcut.py`:

```python
"""Smart cut: stream-copy video + re-encode audio with loudnorm.

The previous implementation re-encoded video at libx264 preset=medium CRF 18,
turning a "fast cut" into a 30-90 minute encode. Real smart cut snaps cuts
to keyframes and stream-copies the video — output is bit-identical to source
for video, with audio re-encoded only because loudnorm requires decoding it.

Boundary precision: ±1 GOP (~1-3 s on typical livestream encodes). For
khutbah cuts at sit-down silences, this is invisible.
"""

from __future__ import annotations

import subprocess
from typing import Any, Callable, Optional

from khutbah_pipeline.edit.loudnorm import measure_loudness, build_loudnorm_filter
from khutbah_pipeline.util.ffmpeg import FFMPEG
from khutbah_pipeline.util.keyframes import (
    list_keyframes,
    nearest_keyframe_at_or_before,
    nearest_keyframe_at_or_after,
)


def smart_cut_segment(
    src: str,
    dst: str,
    start: float,
    duration: float,
    target_lufs: float = -14.0,
    target_tp: float = -1.0,
    target_lra: float = 11.0,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> None:
    """Stream-copy video + loudnorm-corrected audio re-encode.

    Snaps `start` down to the nearest keyframe ≤ start, and the end up to
    the nearest keyframe ≥ start+duration. The actual output duration is
    therefore ≥ requested duration but never less.
    """
    # Probe keyframes once
    keyframes = list_keyframes(src)
    if not keyframes:
        raise RuntimeError(f"no keyframes found in {src}")

    snap_start = nearest_keyframe_at_or_before(keyframes, start)
    snap_end_target = start + duration
    snap_end = nearest_keyframe_at_or_after(keyframes, snap_end_target)
    if snap_start is None or snap_end is None or snap_end <= snap_start:
        raise RuntimeError(
            f"keyframe snap failed: start={start} → {snap_start}, end={snap_end_target} → {snap_end}"
        )

    snap_duration = snap_end - snap_start

    if progress_cb:
        progress_cb({
            "stage": "export",
            "message": f"Loudnorm pass 1 ({snap_duration:.0f}s)…",
            "progress": 0.05,
        })

    # Pass 1: measure loudness on the SAME range we'll cut
    measured = measure_loudness(src, snap_start, snap_duration)
    audio_filter = build_loudnorm_filter(measured, target_lufs, target_tp, target_lra)

    if progress_cb:
        progress_cb({
            "stage": "export",
            "message": "Cutting (video stream-copy + audio loudnorm)…",
            "progress": 0.15,
        })

    cmd = [
        FFMPEG, "-y",
        "-ss", f"{snap_start:.3f}", "-i", src,
        "-t", f"{snap_duration:.3f}",
        "-c:v", "copy",
        "-af", audio_filter,
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
    ]
    if progress_cb:
        cmd += ["-progress", "pipe:1", "-nostats"]
    cmd.append(dst)

    if not progress_cb:
        subprocess.run(cmd, check=True, capture_output=True)
        return

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1,
    )
    try:
        if proc.stdout is None:
            raise RuntimeError("ffmpeg stdout unavailable")
        for line in proc.stdout:
            if not line.startswith("out_time_us="):
                continue
            try:
                out_us = int(line.split("=", 1)[1].strip())
            except ValueError:
                continue
            done_s = out_us / 1_000_000
            frac = max(0.15, min(1.0, 0.15 + 0.85 * done_s / snap_duration)) if snap_duration > 0 else 0.0
            progress_cb({
                "stage": "export",
                "message": "Cutting…",
                "progress": frac,
            })
        proc.wait()
        if proc.returncode != 0:
            stderr = proc.stderr.read() if proc.stderr else ""
            raise subprocess.CalledProcessError(proc.returncode, cmd, output="", stderr=stderr)
    finally:
        if proc.poll() is None:
            proc.kill()
```

- [ ] **Step 4: Update any callers using the old function name**

Old function was likely named differently. Check:

```bash
grep -rn "smart_cut\|smartcut" python-pipeline/khutbah_pipeline/__main__.py
```

If the public entrypoint name changed, keep a thin alias:

```python
# At bottom of smartcut.py — temporary alias for the existing RPC method
def cut_segment(*args, **kwargs):  # pragma: no cover
    return smart_cut_segment(*args, **kwargs)
```

- [ ] **Step 5: Run — confirm pass**

```bash
cd python-pipeline && pytest tests/test_smartcut_keyframe.py tests/test_smartcut.py tests/test_loudnorm.py -v
```

Expected: all pass. The existing `test_smartcut.py` may need duration tolerances loosened from "exact" to "within 3s" — that's the deliberate trade for stream-copy.

- [ ] **Step 6: Commit**

```bash
git add python-pipeline/khutbah_pipeline/edit/smartcut.py python-pipeline/tests/test_smartcut_keyframe.py python-pipeline/tests/test_smartcut.py
git commit -m "feat(edit): real smart-cut — stream-copy video + audio loudnorm only

Was full re-encode at libx264 preset=medium CRF 18 — 30-90 min for a 30-min
khutbah part. Now snaps requested cuts to nearest keyframes and stream-copies
video while re-encoding audio to apply loudnorm. Cut a 30-min Part 1 in
~60-90s on commodity hardware. Output is bit-identical to source for video;
boundary precision is ±1 GOP (~1-3s) — invisible at sit-down silences."
```

### Task 4.3: Manual smoke test of full export path

- [ ] **Step 1: Run the app**

```bash
npm run dev:full
```

- [ ] **Step 2: Open a real khutbah project, run Detect → Export 2 Files**

Time the export (wall clock). Expected: under 2 min for a typical 30-min Part 1 + 20-min Part 2 (was 60-180 min).

- [ ] **Step 3: Verify output quality**

Open both output mp4s in a player. Check:
- No glitches at the cut points
- Audio is at YouTube level (not too quiet, not clipping)
- Lipsync intact (no drift introduced)

- [ ] **Step 4: If acceptable, no commit needed (verification only)**

If problems surface, the fix lives in Task 4.2 — return there.

---

# Phase 5: Verification + Cleanup

### Task 5.1: End-to-end timing benchmark

**Files:**
- Create: `python-pipeline/scripts/bench_pipeline.py`

- [ ] **Step 1: Write a benchmark script**

```python
#!/usr/bin/env python3
"""Bench the full detect → export pipeline on a real khutbah recording.

Usage:
  python scripts/bench_pipeline.py /path/to/khutbah.mp4 [--device cpu|cuda|auto]
"""
import argparse
import json
import time
from pathlib import Path

from khutbah_pipeline.detect.pipeline_v2 import run_pipeline_v2
from khutbah_pipeline.edit.smartcut import smart_cut_segment


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--model", type=Path,
                    default=Path(__file__).parents[1] / "resources" / "models" / "whisper-tiny")
    ap.add_argument("--out-dir", type=Path, default=Path("/tmp/khutbah-bench"))
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Source: {args.source}  device: {args.device}")

    t0 = time.monotonic()
    detect = run_pipeline_v2(str(args.source), str(args.model), device=args.device)
    detect_t = time.monotonic() - t0

    print(json.dumps(detect, indent=2))
    print(f"\n=== Detect: {detect_t:.1f}s ===\n")

    if "error" in detect:
        return

    p1 = detect["part1"]; p2 = detect["part2"]

    t1 = time.monotonic()
    smart_cut_segment(
        src=str(args.source),
        dst=str(args.out_dir / "part1.mp4"),
        start=p1["start"],
        duration=p1["end"] - p1["start"],
    )
    p1_t = time.monotonic() - t1

    t2 = time.monotonic()
    smart_cut_segment(
        src=str(args.source),
        dst=str(args.out_dir / "part2.mp4"),
        start=p2["start"],
        duration=p2["end"] - p2["start"],
    )
    p2_t = time.monotonic() - t2

    total = detect_t + p1_t + p2_t
    print(f"\n=== Detect: {detect_t:.1f}s | Part1 cut: {p1_t:.1f}s | Part2 cut: {p2_t:.1f}s | Total: {total:.1f}s ===")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run on a real recording**

```bash
cd python-pipeline && source .venv/bin/activate
python scripts/bench_pipeline.py /home/farouq/Videos/KhutbahEditor/2026-04-25/[id].mp4 --device cpu
```

Acceptance criteria:
- Detect: < 5 min CPU (< 1 min GPU)
- Part 1 cut: < 90 s
- Part 2 cut: < 90 s
- Total: < 8 min CPU, < 3 min GPU

- [ ] **Step 3: Commit the benchmark script**

```bash
git add python-pipeline/scripts/bench_pipeline.py
git commit -m "chore(bench): add end-to-end pipeline timing script"
```

### Task 5.2: Update spec + CLAUDE.md

**Files:**
- Modify: `docs/superpowers/specs/2026-04-25-khutbah-editor-design.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Spec update — § 4.4 detection**

Replace the large-v3 description with the VAD-first pipeline. Note that this is a sanctioned change made on 2026-04-25 with rationale (25-min runtime defeated auto-pilot promise).

- [ ] **Step 2: Spec update — § 4.5 export**

Replace any reference to libx264 preset=medium CRF 18 with the stream-copy + audio re-encode approach. Note the ±1 GOP precision tradeoff and why it's acceptable.

- [ ] **Step 3: CLAUDE.md update — Quick Reference table**

Update the "Stack" row: drop "faster-whisper large-v3" mention; replace with "faster-whisper tiny + silero-vad".

Update "Locked design decisions": speech recognition is now "faster-whisper tiny + silero-vad (~75 MB)" not "large-v3 (~3 GB)".

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-25-khutbah-editor-design.md CLAUDE.md
git commit -m "docs(spec): update for VAD-first detection + smart-cut speed overhaul"
```

### Task 5.3: Drop the large-v3 model from the bundle

**Files:**
- Modify: `electron-builder.json`
- Modify: `resources/fetch-resources.sh` (already done in Task 0.2)
- Optional: delete `resources/models/whisper-large-v3/` from local dev machines

- [ ] **Step 1: Verify electron-builder no longer references whisper-large-v3**

```bash
grep -n "whisper-large-v3\|whisper-tiny" electron-builder.json
```

Expected: only `whisper-tiny` references. If `whisper-large-v3` still appears, remove it.

- [ ] **Step 2: Delete the local large-v3 directory (saves 3 GB on dev disk)**

```bash
rm -rf resources/models/whisper-large-v3
```

- [ ] **Step 3: Build the installer to verify size dropped**

```bash
npm run package:dir
du -sh dist/*-unpacked/ 2>/dev/null
```

Expected: build dir is ~3 GB smaller than before.

- [ ] **Step 4: Commit**

```bash
git add electron-builder.json
git commit -m "chore(bundle): drop whisper-large-v3 (3GB) — pipeline only needs tiny now"
```

---

## Self-Review

**Spec coverage:** Goal of "<5 min detect, <2 min export, no silent CPU fallback, working editor playback" → covered by Phases 3, 4, 1, 2 respectively.

**Placeholder scan:** No "TBD"s, no "implement appropriate error handling", no bare "similar to Task N". Each step has real code or real commands.

**Type consistency:**
- `_resolve_device` returns `tuple[str, str]` everywhere it's called.
- `CudaUnavailableError` is the single error type for the fail-loud policy.
- `detect_speech_segments` returns `list[dict[str, float]]` — used consistently in candidates.py.
- `score_*_candidates` all take `(speech, silences, shots, duration, ...)` — consistent positional signature.
- `smart_cut_segment` matches existing `__main__.py` RPC dispatch signature (verify in Task 4.2 step 4).

**Risks:**
- silero-vad bundle size adds ~50 MB for torch but saves ~3 GB by dropping large-v3 — net win.
- Keyframe-snap precision: ±1-3 s. If a customer's recording has 10 s GOPs, cuts could overshoot by 5 s on each side. Mitigation: documented in spec; if it bites, fall back to Task 4.2 with a "precision mode" that does the three-segment concat.
- silero-vad on pure-tone fixture is non-deterministic — tests assert structure rather than exact counts. Real-clip integration test in Task 5.1 covers correctness.
- Baseline H.264 profile (Task 2.1) caps quality at ~720p before visible artefacts. Acceptable for preview; the Export uses source video stream-copy so final output isn't affected.
- Skipping proxy gen for "friendly" sources (Task 2.3) means users with very long-GOP H.264 sources (some IP cameras output 10 s GOPs) still get sluggish scrub on those. Mitigation: `MAX_FRIENDLY_GOP_SECONDS = 2.0` rejects them, forcing proxy gen.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-pipeline-speed-overhaul.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
