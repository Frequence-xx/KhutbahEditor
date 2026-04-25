import json
import re
import subprocess
from pathlib import Path
import pytest
from khutbah_pipeline.edit.smartcut import smart_cut

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"


def test_smart_cut_produces_video_of_expected_duration(tmp_path):
    out = tmp_path / "part1.mp4"
    smart_cut(str(FIXTURE), str(out), start=10.0, end=15.0,  # 5-second cut
              normalize_audio=True, target_lufs=-14.0)
    assert out.exists()
    info = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_format", "-print_format", "json", str(out)],
        text=True,
    ))
    duration = float(info["format"]["duration"])
    assert 4.5 < duration < 5.5


def test_smart_cut_normalizes_quiet_segment_to_target_lufs(tmp_path):
    """Reproduce codex's finding: a quiet segment must normalize to ~-14 LUFS,
    even when the rest of the source is loud (and would skew a full-source
    measurement)."""
    # Build a 10-second source: 5s quiet sine + 5s loud sine
    quiet = tmp_path / "quiet.wav"
    loud = tmp_path / "loud.wav"
    full = tmp_path / "full.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "sine=f=440:d=5,volume=0.01",
        str(quiet),
    ], check=True, capture_output=True)
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "sine=f=440:d=5",
        str(loud),
    ], check=True, capture_output=True)
    # Concatenate quiet then loud
    listfile = tmp_path / "list.txt"
    listfile.write_text(f"file '{quiet}'\nfile '{loud}'\n")
    concat_audio = tmp_path / "concat.wav"
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(listfile), "-c", "copy", str(concat_audio),
    ], check=True, capture_output=True)
    # Mux with a 10s black video so smart_cut has a video stream too
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=320x180:d=10",
        "-i", str(concat_audio),
        "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-shortest",
        str(full),
    ], check=True, capture_output=True)

    # Cut the FIRST 5 seconds (the quiet portion)
    out = tmp_path / "quiet_part.mp4"
    smart_cut(str(full), str(out), start=0.0, end=5.0,
              normalize_audio=True, target_lufs=-14.0)

    # Re-measure the output
    cmd = [
        "ffmpeg", "-hide_banner", "-i", str(out),
        "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
        "-f", "null", "-",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, check=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr, re.DOTALL)
    assert m, "could not parse loudness measurement"
    measured_i = float(json.loads(m.group(0))["input_i"])
    # The quiet segment should normalize to within ~3 dB of the target.
    # Without the fix, it lands at -47 LUFS or worse.
    assert -17.0 <= measured_i <= -11.0, (
        f"normalized quiet segment measured {measured_i} LUFS, expected near -14"
    )
