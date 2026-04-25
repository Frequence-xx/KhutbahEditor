import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlparse

YT_DLP: str = shutil.which("yt-dlp") or "yt-dlp"

# YouTube bot-detection / n-challenge bypass requires a JS runtime + the EJS
# challenge-solver lib. yt-dlp 2026.03.17+ supports both via these flags.
# - --js-runtimes points at a Node.js binary (or deno/bun/quickjs)
# - --remote-components ejs:github auto-downloads the solver lib on first run
# Override the JS runtime path via KHUTBAH_JS_RUNTIME env var; default below
# is the nvm Node on the developer's primary machine.
_DEFAULT_JS_RUNTIME = '/home/farouq/.nvm/versions/node/v22.20.0/bin/node'
JS_RUNTIME: str = os.environ.get('KHUTBAH_JS_RUNTIME', _DEFAULT_JS_RUNTIME)
YT_DLP_BOT_BYPASS_FLAGS: list[str] = [
    '--js-runtimes', f'node:{JS_RUNTIME}',
    '--remote-components', 'ejs:github',
]

ALLOWED_HOSTS = {"www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"}


def _validate_youtube_url(url: str) -> None:
    """Reject URLs that aren't standard YouTube + reject leading-dash strings.

    Defense against yt-dlp option-flag injection: a URL like '--exec=sh -c ...'
    would be parsed by yt-dlp as a flag rather than a URL, allowing arbitrary
    command execution. We reject leading dashes outright and require a YouTube
    host.
    """
    if not url or url.startswith("-"):
        raise ValueError(
            f"Invalid YouTube URL (cannot start with '-' to prevent option injection): {url[:50]}"
        )
    try:
        parsed = urlparse(url)
    except (ValueError, TypeError) as e:
        raise ValueError(f"Cannot parse URL: {e}") from e
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"URL must use http or https scheme, got: {parsed.scheme}")
    if parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError(
            f"URL host must be a YouTube domain ({sorted(ALLOWED_HOSTS)}), got: {parsed.hostname}"
        )


def info_only(url: str) -> dict[str, Any]:
    """Probe YouTube URL without downloading. Validates URL is YouTube + non-injecting."""
    _validate_youtube_url(url)
    # `--` separator marks end of options; subsequent args are positional URLs.
    # Defense in depth even though _validate_youtube_url already rejects -prefixed URLs.
    r = subprocess.run(
        [YT_DLP, '-J', '--no-warnings', *YT_DLP_BOT_BYPASS_FLAGS, '--', url],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if r.returncode != 0:
        # Surface yt-dlp's actual error message ("This video is not available",
        # "Sign in to confirm your age", "Private video", network failure, etc.)
        # rather than the bare CalledProcessError that hides the cause.
        stderr = (r.stderr or '').strip()
        # Strip the leading 'ERROR: ' prefix yt-dlp adds for cleaner UI display.
        if stderr.startswith('ERROR: '):
            stderr = stderr[len('ERROR: '):]
        raise RuntimeError(stderr or f'yt-dlp exited with code {r.returncode}')
    return json.loads(r.stdout)


def download(
    url: str,
    output_dir: str,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> str:
    """Download best mp4 to output_dir. Validates URL is YouTube + non-injecting."""
    _validate_youtube_url(url)
    out_template = str(Path(output_dir) / "%(title)s [%(id)s].%(ext)s")
    cmd = [
        YT_DLP, '-f', 'best[ext=mp4]/best', '-o', out_template,
        '--no-playlist',
        *YT_DLP_BOT_BYPASS_FLAGS,
    ]
    if progress_cb:
        cmd += [
            "--progress-template",
            "download:%(progress.downloaded_bytes)s/%(progress.total_bytes)s",
        ]
    # `--` separator before the URL.
    cmd += ["--", url]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out_path: Optional[str] = None
    if proc.stdout is None:
        raise RuntimeError("yt-dlp stdout unavailable")
    for line in proc.stdout:
        if line.startswith("download:"):
            try:
                done_str, total_str = line.replace("download:", "").strip().split("/")
                if progress_cb and total_str != "NA":
                    done = int(done_str)
                    total = int(total_str)
                    progress_cb({
                        "stage": "download",
                        "message": f"Downloading {done // (1024 * 1024)} / {total // (1024 * 1024)} MB",
                        "progress": done / total,
                        "current": done,
                        "total": total,
                    })
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
