import json as _json
import subprocess
from typing import Any, Callable, Optional

from khutbah_pipeline.util.ffmpeg import FFMPEG, FFPROBE, ffprobe_json


_FRIENDLY_VIDEO_CODECS = {"h264"}
_FRIENDLY_PIX_FMTS = {"yuv420p", "yuvj420p"}
_FRIENDLY_AUDIO_CODECS = {"aac", "mp3"}
MAX_FRIENDLY_GOP_SECONDS = 2.0  # GOP > 2 s makes scrub feel laggy


def is_chromium_friendly(src: str) -> bool:
    """Return True if Chromium can play `src` directly with snappy scrub.

    Used by the renderer to skip proxy generation when the source is
    already an 8-bit short-GOP H.264 file. Saves ~30 s of proxy work on
    every fresh import for already-friendly sources.
    """
    try:
        meta = ffprobe_json(src)
    except Exception:
        return False
    streams = meta.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if v is None:
        return False
    if v.get("codec_name") not in _FRIENDLY_VIDEO_CODECS:
        return False
    if v.get("pix_fmt") not in _FRIENDLY_PIX_FMTS:
        return False
    if a is not None and a.get("codec_name") not in _FRIENDLY_AUDIO_CODECS:
        return False
    r = subprocess.run(
        [FFPROBE, "-v", "error",
         "-skip_frame", "nokey",
         "-show_entries", "frame=pts_time",
         "-select_streams", "v:0",
         "-read_intervals", "%+30",
         "-of", "json", src],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return False
    times = [
        float(f["pts_time"])
        for f in _json.loads(r.stdout).get("frames", [])
        if f.get("pts_time")
    ]
    if len(times) < 2:
        return True
    max_interval = max(times[i + 1] - times[i] for i in range(len(times) - 1))
    return max_interval <= MAX_FRIENDLY_GOP_SECONDS


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
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p",            # 8-bit only — Chromium can't decode 10-bit H.264
        "-profile:v", "baseline",          # max-compat decode path
        "-level", "3.0",
        "-g", "24", "-keyint_min", "24",   # keyframe every ~1 s @ 24 fps → fast scrub
        "-sc_threshold", "0",              # disable scene-cut keyframes (keep cadence regular)
        "-c:a", "aac", "-b:a", "96k", "-ar", "48000",
        "-movflags", "+faststart",
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
            payload: dict[str, Any] = {
                "stage": "proxy",
                "message": "Generating preview proxy…",
            }
            if duration:
                frac = max(0.0, min(1.0, done_s / duration))
                payload["progress"] = frac
            progress_cb(payload)
        proc.wait()
        if proc.returncode != 0:
            stderr = proc.stderr.read() if proc.stderr else ""
            raise subprocess.CalledProcessError(proc.returncode, cmd, output="", stderr=stderr)
    finally:
        if proc.poll() is None:
            proc.kill()
