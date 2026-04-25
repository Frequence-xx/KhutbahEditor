from typing import Any
from khutbah_pipeline.util.ffmpeg import ffprobe_json


class IngestError(Exception):
    """Raised when an ingest source fails spec §12 validation."""


def probe_local(path: str) -> dict[str, Any]:
    info = ffprobe_json(path)
    duration = float(info["format"].get("duration", 0))
    streams = info.get("streams", [])
    audio = next((s for s in streams if s["codec_type"] == "audio"), None)
    video = next((s for s in streams if s["codec_type"] == "video"), None)

    if audio is None:
        raise IngestError("File has no audio stream — cannot process khutbah without audio.")
    if duration < 30.0:
        raise IngestError(f"File too short ({duration:.1f}s); minimum 30s required.")

    return {
        "path": path,
        "duration": duration,
        "size_bytes": int(info["format"].get("size", 0)),
        "has_audio": True,
        "has_video": video is not None,
        "width": video["width"] if video else 0,
        "height": video["height"] if video else 0,
        "audio_codec": audio["codec_name"],
        "video_codec": video["codec_name"] if video else None,
    }
