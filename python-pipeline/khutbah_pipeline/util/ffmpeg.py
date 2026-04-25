import json
import subprocess
import shutil
from typing import Optional, Any

FFPROBE: str = shutil.which("ffprobe") or "ffprobe"
FFMPEG: str = shutil.which("ffmpeg") or "ffmpeg"


def ffprobe_json(path: str, args: Optional[list[str]] = None) -> dict[str, Any]:
    cmd = [FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams"]
    if args:
        cmd += args
    cmd.append(path)
    out = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return json.loads(out.stdout)
