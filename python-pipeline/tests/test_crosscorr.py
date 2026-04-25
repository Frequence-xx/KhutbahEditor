import pytest

# Skip the entire module if numpy/scipy aren't installed (e.g., dev venv with
# --no-deps install). Phase 5 packaging will ensure they're present.
np = pytest.importorskip("numpy")
sp = pytest.importorskip("scipy")

from khutbah_pipeline.align.crosscorr import align_audio_arrays


def test_align_recovers_known_offset():
    """Insert a 1.5s delay into a known signal; cross-correlation should recover it."""
    sr = 16000
    duration = 10
    t = np.linspace(0, duration, sr * duration, endpoint=False)
    base = np.sin(2 * np.pi * 440 * t).astype(np.float32)
    # Insert 1.5s offset by zero-padding the front of the delayed signal
    offset_samples = int(1.5 * sr)
    delayed = np.concatenate([np.zeros(offset_samples, dtype=np.float32), base])[:len(base)]
    detected, conf = align_audio_arrays(delayed, base, sr=sr)
    assert abs(detected - 1.5) < 0.01, f"Expected ~1.5s offset, got {detected}"
    assert conf > 5.0, f"Expected confidence > 5, got {conf}"
