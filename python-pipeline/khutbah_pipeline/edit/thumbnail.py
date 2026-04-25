import subprocess
from pathlib import Path
from khutbah_pipeline.util.ffmpeg import FFMPEG


def extract_candidates(src: str, output_dir: str, count: int = 6) -> list[str]:
    """Extract `count` scene-change candidate frames as 1280x720 JPEGs.

    Uses ffmpeg's scene-detection filter (`select='gt(scene,0.3)'`) to pick
    high-change frames, then scales each to 1280x720 with letterboxing as
    needed. Returns a sorted list of output paths.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_template = str(out_dir / "thumb-%02d.jpg")
    subprocess.run([
        FFMPEG, "-y", "-i", src,
        "-vf",
        f"select='gt(scene,0.3)',"
        f"scale=1280:720:force_original_aspect_ratio=decrease,"
        f"pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
        "-vsync", "vfr", "-frames:v", str(count), "-q:v", "2",
        out_template,
    ], check=True, capture_output=True)
    return sorted(str(p) for p in out_dir.glob("thumb-*.jpg"))
