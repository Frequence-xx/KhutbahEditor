from pathlib import Path
from khutbah_pipeline.edit.loudnorm import measure_loudness, build_loudnorm_filter

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"


def test_measure_loudness_returns_lufs():
    measured = measure_loudness(str(FIXTURE))
    assert "input_i" in measured
    assert "input_tp" in measured
    assert "input_lra" in measured
    # Sine tone @ 440 Hz produces a loud signal in the LUFS scale.
    # Allow a wide tolerance — we only need to confirm a number was parsed.
    assert -50 < float(measured["input_i"]) < 5


def test_filter_string_is_valid():
    measured = measure_loudness(str(FIXTURE))
    f = build_loudnorm_filter(measured, target_i=-14.0, target_tp=-1.0, target_lra=11.0)
    assert "loudnorm=" in f
    assert "I=-14" in f
    assert "linear=true" in f
