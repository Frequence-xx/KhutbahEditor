import subprocess
from khutbah_pipeline.util.ffmpeg import FFMPEG


def generate_proxy(src: str, dst: str, max_height: int = 360) -> None:
    """Generate a low-bitrate H.264 + AAC preview proxy for smooth scrubbing."""
    subprocess.run([
        FFMPEG, "-y", "-i", src,
        "-vf", f"scale=-2:{max_height}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "32",
        "-c:a", "aac", "-b:a", "64k",
        "-movflags", "+faststart",
        dst,
    ], check=True, capture_output=True)
