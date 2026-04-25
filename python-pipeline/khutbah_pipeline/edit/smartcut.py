import subprocess
from typing import Any, Callable, Optional

from khutbah_pipeline.util.ffmpeg import FFMPEG
from khutbah_pipeline.edit.loudnorm import measure_loudness, build_loudnorm_filter


def smart_cut(
    src: str,
    dst: str,
    start: float,
    end: float,
    normalize_audio: bool = True,
    target_lufs: float = -14.0,
    target_tp: float = -1.0,
    target_lra: float = 11.0,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> None:
    """Cut [start, end] from src into dst. If normalize_audio, apply EBU R128.

    Two-pass loudnorm: measure the SAME segment that will be exported, then
    apply during the cut. Critical: measuring the full source and applying to
    a trimmed segment produces wrong loudness when source loudness varies.

    If progress_cb is given, emits {"stage": "export", "message": str,
    "progress": float (0..1)} per FFmpeg progress tick. The encode is the
    long-running step (libx264 medium / CRF 18 on a 25-min part takes minutes
    on CPU); without progress the renderer's Export button looks frozen.
    """
    duration = end - start
    audio_filter: list[str] = []
    if normalize_audio:
        if progress_cb:
            progress_cb({
                "stage": "export",
                "message": "Measuring loudness…",
                "progress": 0.0,
            })
        measured = measure_loudness(src, start=start, end=end)
        audio_filter = ["-af", build_loudnorm_filter(measured, target_lufs, target_tp, target_lra)]

    cmd = [
        FFMPEG, "-y", "-ss", str(start), "-t", str(duration), "-i", src,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p",
    ] + audio_filter + [
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        "-async", "1", "-vsync", "cfr",
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
            frac = max(0.0, min(1.0, done_s / duration)) if duration > 0 else 0.0
            progress_cb({
                "stage": "export",
                "message": "Encoding…",
                "progress": frac,
            })
        proc.wait()
        if proc.returncode != 0:
            stderr = proc.stderr.read() if proc.stderr else ""
            raise subprocess.CalledProcessError(proc.returncode, cmd, output="", stderr=stderr)
    finally:
        if proc.poll() is None:
            proc.kill()
