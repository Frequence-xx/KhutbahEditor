import subprocess
from typing import Any, Callable, Optional

from khutbah_pipeline.util.ffmpeg import FFMPEG, ffprobe_json


def _probe_duration(path: str) -> Optional[float]:
    try:
        meta = ffprobe_json(path)
        return float(meta.get("format", {}).get("duration") or 0) or None
    except (subprocess.CalledProcessError, ValueError, KeyError):
        return None


def generate_proxy(
    src: str,
    dst: str,
    max_height: int = 360,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> None:
    """Generate a low-bitrate H.264 + AAC preview proxy for smooth scrubbing.

    Cap the output height at max_height OR the source height (no upscaling).

    If progress_cb is given, emits {"stage": "proxy", "message": str,
    "progress": float (0..1) | None} per FFmpeg progress tick.
    """
    duration = _probe_duration(src) if progress_cb else None

    cmd = [
        FFMPEG, "-y", "-i", src,
        "-vf", f"scale=-2:'min({max_height},ih)'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
    ]
    if progress_cb:
        cmd += ["-progress", "pipe:1", "-nostats"]
    cmd.append(dst)

    if not progress_cb:
        subprocess.run(cmd, check=True, capture_output=True)
        return

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
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
            payload: dict[str, Any] = {
                "stage": "proxy",
                "message": f"Generating preview proxy… {done_s:.0f}s",
            }
            if duration:
                frac = max(0.0, min(1.0, done_s / duration))
                payload["progress"] = frac
                payload["message"] = (
                    f"Generating preview proxy… {done_s:.0f}/{duration:.0f}s"
                )
            progress_cb(payload)
        proc.wait()
        if proc.returncode != 0:
            stderr = proc.stderr.read() if proc.stderr else ""
            raise subprocess.CalledProcessError(proc.returncode, cmd, output="", stderr=stderr)
    finally:
        if proc.poll() is None:
            proc.kill()
