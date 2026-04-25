import subprocess
from khutbah_pipeline.util.ffmpeg import FFMPEG


def generate_proxy(src: str, dst: str, max_height: int = 360) -> None:
    """Generate a low-bitrate H.264 + AAC preview proxy for smooth scrubbing.

    Cap the output height at max_height OR the source height (no upscaling).
    """
    subprocess.run([
        FFMPEG, "-y", "-i", src,
        "-vf", f"scale=-2:'min({max_height},ih)'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        dst,
    ], check=True, capture_output=True)
