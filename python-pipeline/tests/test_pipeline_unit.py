"""Tests for the fail-loud device resolver (Phase 1.2).

The V1 pipeline tests (mock-transcribe → boundaries) were removed when
detect/pipeline.py was replaced with a thin shim delegating to pipeline_v2
on 2026-04-25. The new pipeline's behaviour is exercised in test_pipeline_v2.py
plus the per-component tests (test_vad, test_shots, test_candidates,
test_window_transcribe). What remains here is the device-resolution unit
tests that target khutbah_pipeline.detect.transcribe._resolve_device.
"""

import pytest
from unittest.mock import patch

from khutbah_pipeline.detect import transcribe




def test_resolve_device_cpu_explicit():
    # User explicitly chose CPU — never probe GPU
    with patch("khutbah_pipeline.detect.transcribe.can_load_cublas", side_effect=AssertionError("must not call")), \
         patch("khutbah_pipeline.detect.transcribe.has_nvidia_gpu", side_effect=AssertionError("must not call")):
        device, _ = transcribe._resolve_device(prefer="cpu")
    assert device == "cpu"


def test_resolve_device_cuda_requested_but_no_cublas_raises():
    with patch("khutbah_pipeline.detect.transcribe.has_nvidia_gpu", return_value=True), \
         patch("khutbah_pipeline.detect.transcribe.can_load_cublas", return_value=False):
        with pytest.raises(transcribe.CudaUnavailableError) as exc:
            transcribe._resolve_device(prefer="cuda")
    assert "cuBLAS" in str(exc.value) or "CUDA" in str(exc.value)


def test_resolve_device_cuda_requested_no_gpu_raises():
    with patch("khutbah_pipeline.detect.transcribe.has_nvidia_gpu", return_value=False):
        with pytest.raises(transcribe.CudaUnavailableError):
            transcribe._resolve_device(prefer="cuda")


def test_resolve_device_auto_no_gpu_falls_back_silently():
    with patch("khutbah_pipeline.detect.transcribe.has_nvidia_gpu", return_value=False):
        device, _ = transcribe._resolve_device(prefer="auto")
    assert device == "cpu"


def test_resolve_device_auto_gpu_present_no_cublas_raises():
    """Critical: 'auto' must NOT silently fall back when GPU is present but unusable."""
    with patch("khutbah_pipeline.detect.transcribe.has_nvidia_gpu", return_value=True), \
         patch("khutbah_pipeline.detect.transcribe.can_load_cublas", return_value=False):
        with pytest.raises(transcribe.CudaUnavailableError) as exc:
            transcribe._resolve_device(prefer="auto")
    msg = str(exc.value)
    # Must give the user actionable next steps
    assert "Settings" in msg or "Compute Device" in msg


def test_resolve_device_auto_gpu_and_cublas_present_uses_cuda():
    with patch("khutbah_pipeline.detect.transcribe.has_nvidia_gpu", return_value=True), \
         patch("khutbah_pipeline.detect.transcribe.can_load_cublas", return_value=True), \
         patch("ctranslate2.get_supported_compute_types", return_value={"float16", "int8"}):
        device, compute = transcribe._resolve_device(prefer="auto")
    assert device == "cuda"
    assert compute in ("float16", "int8")
