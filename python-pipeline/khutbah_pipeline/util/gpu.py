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
