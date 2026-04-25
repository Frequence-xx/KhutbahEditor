import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Optional

YT_DLP: str = shutil.which("yt-dlp") or "yt-dlp"


def info_only(url: str) -> dict[str, Any]:
    """Probe YouTube URL without downloading. Returns title, duration, thumbnail.

    Raises subprocess.CalledProcessError if yt-dlp fails (e.g., invalid URL,
    private video, network error). The renderer's IPC layer surfaces this
    as a JSON-RPC error.
    """
    r = subprocess.run(
        [YT_DLP, "-J", "--no-warnings", url],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(r.stdout)


def download(
    url: str,
    output_dir: str,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> str:
    """Download best mp4 to output_dir. Returns path to downloaded file.

    Note: yt-dlp's progress events are line-streamed; we parse them for
    optional progress reporting.
    """
    out_template = str(Path(output_dir) / "%(title)s [%(id)s].%(ext)s")
    cmd = [
        YT_DLP, "-f", "best[ext=mp4]/best", "-o", out_template,
        "--no-playlist", url,
    ]
    if progress_cb:
        cmd += [
            "--progress-template",
            "download:%(progress.downloaded_bytes)s/%(progress.total_bytes)s",
        ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out_path: Optional[str] = None
    if proc.stdout is None:
        raise RuntimeError("yt-dlp stdout unavailable")
    for line in proc.stdout:
        if line.startswith("download:"):
            try:
                done_str, total_str = line.replace("download:", "").strip().split("/")
                if progress_cb and total_str != "NA":
                    progress_cb(
                        {"stage": "download", "progress": int(done_str) / int(total_str)}
                    )
            except (ValueError, ZeroDivisionError):
                pass
        if "[download] Destination:" in line:
            out_path = line.split("Destination:", 1)[1].strip()
        if "has already been downloaded" in line:
            out_path = line.split("[download]", 1)[1].split("has already")[0].strip()
    proc.wait()
    if proc.returncode != 0:
        stderr = proc.stderr.read() if proc.stderr else ""
        raise RuntimeError(f"yt-dlp failed (exit {proc.returncode}): {stderr[-500:]}")
    if not out_path:
        raise RuntimeError("yt-dlp completed but did not report a destination path")
    return out_path
