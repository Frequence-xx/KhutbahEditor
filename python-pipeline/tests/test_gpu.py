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
