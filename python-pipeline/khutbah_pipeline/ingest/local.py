from typing import Any
from khutbah_pipeline.util.ffmpeg import ffprobe_json


def probe_local(path: str) -> dict[str, Any]:
    info = ffprobe_json(path)
    duration = float(info["format"].get("duration", 0))
    streams = info.get("streams", [])
    audio = next((s for s in streams if s["codec_type"] == "audio"), None)
    video = next((s for s in streams if s["codec_type"] == "video"), None)
    return {
        "path": path,
        "duration": duration,
        "size_bytes": int(info["format"].get("size", 0)),
        "has_audio": audio is not None,
        "has_video": video is not None,
        "width": video["width"] if video else 0,
        "height": video["height"] if video else 0,
        "audio_codec": audio["codec_name"] if audio else None,
        "video_codec": video["codec_name"] if video else None,
    }
