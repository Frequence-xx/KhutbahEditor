"""Resumable YouTube video upload (8 MB chunks).

Implements the protocol from https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
without the Google SDK to keep dependencies minimal.
"""
import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable, Optional


CHUNK = 8 * 1024 * 1024   # 8 MB per chunk


def initiate_upload(
    access_token: str,
    snippet: dict[str, Any],
    status: dict[str, Any],
    file_size: int,
    mime: str = "video/mp4",
) -> str:
    """Initiate a resumable upload session. Returns the upload URL to PUT chunks to."""
    body = json.dumps({"snippet": snippet, "status": status}).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": str(file_size),
        "X-Upload-Content-Type": mime,
    }
    req = urllib.request.Request(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        data=body, method="POST", headers=headers,
    )
    with urllib.request.urlopen(req) as r:
        location = r.headers.get("Location")
        if not location:
            raise RuntimeError("YouTube did not return upload Location header")
        return location


def upload_file(
    access_token: str,
    upload_url: str,
    file_path: str,
    mime: str = "video/mp4",
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Upload `file_path` to the resumable upload URL in 8 MB chunks.

    Returns: {"video_id": <id>}
    Raises on persistent failure.
    """
    file_size = os.path.getsize(file_path)
    sent = 0
    video_id: Optional[str] = None

    with open(file_path, "rb") as f:
        while sent < file_size:
            chunk = f.read(CHUNK)
            if not chunk:
                break
            end = sent + len(chunk) - 1
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": mime,
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {sent}-{end}/{file_size}",
            }
            req = urllib.request.Request(upload_url, data=chunk, method="PUT", headers=headers)
            try:
                with urllib.request.urlopen(req) as r:
                    if r.status in (200, 201):
                        body = r.read().decode("utf-8")
                        try:
                            video_id = json.loads(body)["id"]
                        except (KeyError, json.JSONDecodeError) as e:
                            raise RuntimeError(f"YouTube upload completed but body unparseable: {body}") from e
                    sent = end + 1
            except urllib.error.HTTPError as e:
                if e.code == 308:
                    # Resume Incomplete — chunk accepted, continue.
                    sent = end + 1
                else:
                    body = e.read().decode("utf-8", errors="replace") if e.fp else ""
                    raise RuntimeError(
                        f"YouTube upload chunk failed (HTTP {e.code}): {body[:500]}"
                    ) from e

            if progress_cb:
                progress_cb({"sent": sent, "total": file_size})

    if not video_id:
        raise RuntimeError("Upload finished without receiving video id from YouTube")
    return {"video_id": video_id}
