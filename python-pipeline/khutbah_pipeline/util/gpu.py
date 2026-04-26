"""GPU presence + CUDA runtime loadability probes.

These are intentionally cheap (subprocess + ctypes dlopen) so they can run
at every detection start without slowing things down.
"""

from __future__ import annotations

import ctypes
import glob
import os
import platform
import subprocess
import sys


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


CT2_REQUIRED_CUBLAS_MAJOR = 12  # ctranslate2 4.x links against CUDA 12


def _cublas_candidate_paths() -> list[str]:
    """Return cuBLAS candidate names + absolute paths the probe should try.

    Probes ONLY the major version ctranslate2 actually links against
    (CT2_REQUIRED_CUBLAS_MAJOR). Loading some other major version (e.g.
    libcublas.so.13 when ctranslate2 wants .so.12) is a false positive —
    ctranslate2 dlopens .so.<MAJOR> by name and ABI breaks across majors.

    Order matters: bare names first (loader path / system CUDA), then
    absolute paths from the venv's nvidia-cublas-cu<MAJOR> pip install
    (which places the lib under nvidia/cu<MAJOR>/lib/ — not on the
    default loader path).
    """
    system = platform.system()
    major = CT2_REQUIRED_CUBLAS_MAJOR
    if system == "Linux":
        bare = [f"libcublas.so.{major}"]
        site = os.path.join(
            sys.prefix, "lib", "python*", "site-packages",
            "nvidia", f"cu{major}", "lib", f"libcublas.so.{major}",
        )
    elif system == "Windows":
        bare = [f"cublas64_{major}.dll"]
        site = os.path.join(
            sys.prefix, "Lib", "site-packages",
            "nvidia", f"cu{major}", "bin", f"cublas64_{major}.dll",
        )
    else:
        return []
    return bare + sorted(glob.glob(site))


def can_load_cublas() -> bool:
    """Probe whether cuBLAS is actually loadable on this machine.

    ctranslate2 reports CUDA as a "supported compute type" based on its
    compile-time configuration, not on whether libcublas is actually
    present. Without this probe a CUDA inference run can blow up
    mid-stream with "Library libcublas.so.<N> is not found or cannot be
    loaded" — the user sees a stack trace 5 minutes into detection.

    Successful CDLL preloads the library so subsequent ctranslate2 dlopens
    find the same handle — that's how pip-installed cuBLAS at a non-loader
    path becomes usable without setting LD_LIBRARY_PATH.
    """
    for p in _cublas_candidate_paths():
        try:
            ctypes.CDLL(p)
            return True
        except OSError:
            continue
    return False
