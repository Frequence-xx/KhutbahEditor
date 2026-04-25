import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlparse

YT_DLP: str = shutil.which("yt-dlp") or "yt-dlp"


def _semver_key(dirname: str) -> tuple[int, int, int]:
    """Sort key for nvm version dirs like 'v22.20.0' → (22, 20, 0)."""
    s = dirname.lstrip('v').split('-')[0]
    parts = s.split('.')
    out: list[int] = []
    for p in parts[:3]:
        try:
            out.append(int(p))
        except ValueError:
            out.append(0)
    while len(out) < 3:
        out.append(0)
    return (out[0], out[1], out[2])


def _discover_js_runtime() -> Optional[str]:
    """Locate a Node.js binary for yt-dlp's n-challenge solver.

    Cross-platform search order:
      1. KHUTBAH_JS_RUNTIME env override (developer / packaged-app override)
      2. shutil.which('node')   — covers system, brew, choco, scoop, and any
                                  shell whose PATH already includes nvm's shim
      3. ~/.nvm/versions/node/<version>/bin/node    (nvm POSIX)
      4. %APPDATA%/nvm/<version>/node.exe           (nvm-windows)
      5. /opt/homebrew/bin/node, /usr/local/bin/node (brew on Apple Silicon /
                                                     Intel Macs not on PATH)

    Returns absolute path, or None — yt-dlp will then run without n-challenge
    bypass and fail loudly on protected videos rather than silently misbehave.
    """
    override = os.environ.get('KHUTBAH_JS_RUNTIME')
    if override and Path(override).is_file():
        return override

    on_path = shutil.which("node")
    if on_path:
        return on_path

    candidates: list[Path] = []

    nvm_root = Path.home() / '.nvm' / 'versions' / 'node'
    if nvm_root.is_dir():
        for ver_dir in sorted(nvm_root.iterdir(), key=lambda p: _semver_key(p.name), reverse=True):
            if ver_dir.is_dir():
                candidates.append(ver_dir / 'bin' / 'node')

    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if appdata:
            nvm_win = Path(appdata) / 'nvm'
            if nvm_win.is_dir():
                for ver_dir in sorted(nvm_win.iterdir(), key=lambda p: _semver_key(p.name), reverse=True):
                    if ver_dir.is_dir():
                        candidates.append(ver_dir / 'node.exe')

    if sys.platform == "darwin":
        candidates.extend([Path('/opt/homebrew/bin/node'), Path('/usr/local/bin/node')])

    for c in candidates:
        if c.is_file():
            return str(c)

    return None


JS_RUNTIME: Optional[str] = _discover_js_runtime()


def _bot_bypass_flags() -> list[str]:
    """Build yt-dlp's bot-bypass argv. Empty when no Node runtime was found.

    --js-runtimes <name>:<path> tells yt-dlp 2026.03.17+ which JS engine to use
    for the YouTube n-challenge. --remote-components ejs:github lets it
    auto-download the EJS solver lib on first use.
    """
    if not JS_RUNTIME:
        return []
    return [
        '--js-runtimes', f'node:{JS_RUNTIME}',
        '--remote-components', 'ejs:github',
    ]


YT_DLP_BOT_BYPASS_FLAGS: list[str] = _bot_bypass_flags()

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
