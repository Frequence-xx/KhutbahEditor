"""Unit tests for the cuBLAS probe.

The probe must accept current pip-installed cuBLAS layouts (libcublas.so.13
under <venv>/lib/.../nvidia/cu13/lib/), not just the hardcoded .so.12 / .so.11
that the bundled CUDA toolkit ships with.
"""
from __future__ import annotations

import sys
from unittest.mock import patch

import pytest

from khutbah_pipeline.util import gpu


def test_cublas_candidate_paths_targets_ct2_required_major():
    """Probe must check libcublas matching ctranslate2's compiled-against
    major version. ABI breaks across cuBLAS majors — loading .so.13 when
    ct2 wants .so.12 is a false positive that fails mid-detection."""
    paths = gpu._cublas_candidate_paths()
    major = gpu.CT2_REQUIRED_CUBLAS_MAJOR
    assert any(f"libcublas.so.{major}" in p for p in paths), (
        f"probe missing libcublas.so.{major} — ctranslate2 links against this major"
    )
    # Sanity: must NOT include foreign majors
    foreign = 13 if major == 12 else 12
    assert not any(f"libcublas.so.{foreign}" in p for p in paths), (
        f"probe must not lie about .so.{foreign} when ct2 needs .so.{major}"
    )


def test_cublas_candidate_paths_includes_venv_pip_path():
    """Pip-installed nvidia-cublas-cu<MAJOR> lives at site-packages/nvidia/cu<MAJOR>/lib/.
    The probe must include this path so users who pip-install cuBLAS
    don't need to set LD_LIBRARY_PATH manually."""
    paths = gpu._cublas_candidate_paths()
    major = gpu.CT2_REQUIRED_CUBLAS_MAJOR
    # Even if the file doesn't exist on this machine, the candidate pattern
    # should expand for any installed nvidia/cu<MAJOR> tree. We just check the
    # bare name is present and the pattern is composed correctly by
    # exercising _cublas_candidate_paths on a fake sys.prefix.
    import os, sys, tempfile
    with tempfile.TemporaryDirectory() as fake_prefix:
        lib_dir = os.path.join(
            fake_prefix, "lib", "python3.12", "site-packages",
            "nvidia", f"cu{major}", "lib",
        )
        os.makedirs(lib_dir)
        fake_lib = os.path.join(lib_dir, f"libcublas.so.{major}")
        open(fake_lib, "w").close()
        with patch.object(sys, "prefix", fake_prefix):
            paths2 = gpu._cublas_candidate_paths()
        assert fake_lib in paths2, (
            "probe must discover pip-installed cuBLAS via venv glob"
        )


def test_can_load_cublas_returns_true_when_any_candidate_loads():
    fake_paths = ["/fake/libcublas.so.13", "/fake/libcublas.so.12"]
    with patch.object(gpu, "_cublas_candidate_paths", return_value=fake_paths), \
         patch("ctypes.CDLL", side_effect=[OSError("nope"), object()]):
        assert gpu.can_load_cublas() is True


def test_can_load_cublas_returns_false_when_no_candidate_loads():
    fake_paths = ["/fake/a", "/fake/b"]
    with patch.object(gpu, "_cublas_candidate_paths", return_value=fake_paths), \
         patch("ctypes.CDLL", side_effect=OSError("nope")):
        assert gpu.can_load_cublas() is False


def test_cublas_candidate_paths_returns_empty_on_macos():
    with patch("platform.system", return_value="Darwin"):
        assert gpu._cublas_candidate_paths() == []
