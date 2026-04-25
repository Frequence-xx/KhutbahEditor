"""Resumable YouTube video upload (8 MB chunks).

Implements the protocol from https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
without the Google SDK to keep dependencies minimal.
"""
import json
import os
import socket
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Optional


CHUNK = 8 * 1024 * 1024
DEFAULT_TIMEOUT = 120  # seconds per request — protects against silent hangs
RETRYABLE_STATUSES = {500, 502, 503, 504}
MAX_RETRIES = 3


def _retry_with_backoff(fn: Callable[[], Any], op_name: str) -> Any:
    """Run fn() with exponential backoff on retryable HTTP/network errors."""
    last_err: Optional[Exception] = None
    for attempt in range(MAX_RETRIES):
        try:
            return fn()
        except urllib.error.HTTPError as e:
            if e.code in RETRYABLE_STATUSES and attempt < MAX_RETRIES - 1:
                last_err = e
                time.sleep(2 ** attempt)
                continue
            raise
        except (socket.timeout, urllib.error.URLError) as e:
            if attempt < MAX_RETRIES - 1:
                last_err = e
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"{op_name} failed after {MAX_RETRIES} attempts: {e}") from e
    if last_err:
        raise RuntimeError(f"{op_name} exhausted retries: {last_err}")


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

    def _do() -> str:
        req = urllib.request.Request(
            "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
            data=body, method="POST", headers=headers,
        )
        with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as r:
            location = r.headers.get("Location")
            if not location:
                raise RuntimeError("YouTube did not return upload Location header")
            return location

    return _retry_with_backoff(_do, "initiate_upload")


def _query_upload_status(access_token: str, upload_url: str, file_size: int) -> Optional[str]:
    """Query upload status to retrieve the video_id when the final-chunk PUT
    returned 308 (server still processing).

    Per https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol:
    a PUT with empty body and `Content-Range: bytes */{size}` returns 200/201 with
    the video resource if the server has fully processed the upload, or 308 with
    a `Range` header indicating the highest received byte if more chunks are needed.
    """
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Length": "0",
        "Content-Range": f"bytes */{file_size}",
    }
    req = urllib.request.Request(upload_url, data=b"", method="PUT", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as r:
            if r.status in (200, 201):
                body = r.read().decode("utf-8")
                try:
                    return str(json.loads(body)["id"])
                except (KeyError, json.JSONDecodeError):
                    return None
            return None  # still processing or other non-final status
    except urllib.error.HTTPError as e:
        if e.code == 308:
            # Still incomplete — the upload is broken (we sent everything but
            # server says it didn't get it all). Caller will need to retry.
            return None
        raise


def upload_file(
    access_token: str,
    upload_url: str,
    file_path: str,
    mime: str = "video/mp4",
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Upload `file_path` to the resumable upload URL in 8 MB chunks.

    Handles the final-chunk-308 case (server still processing) by issuing
    a status-query PUT after the loop exits to retrieve the video_id.

    Raises with context on persistent failure. Includes timeout + 5xx retry
    on each chunk.
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
            chunk_headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": mime,
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {sent}-{end}/{file_size}",
            }

            def _do_chunk() -> Optional[str]:
                req = urllib.request.Request(upload_url, data=chunk, method="PUT", headers=chunk_headers)
                try:
                    with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as r:
                        if r.status in (200, 201):
                            body = r.read().decode("utf-8")
                            return str(json.loads(body)["id"])
                        return None
                except urllib.error.HTTPError as e:
                    if e.code == 308:
                        return None  # resume incomplete — chunk accepted, continue
                    if e.code == 401:
                        raise RuntimeError("token_expired:401") from e
                    body = e.read().decode("utf-8", errors="replace") if e.fp else ""
                    raise RuntimeError(
                        f"YouTube upload chunk failed (HTTP {e.code}): {body[:500]}"
                    ) from e

            chunk_video_id = _retry_with_backoff(_do_chunk, "upload_chunk")
            if chunk_video_id:
                video_id = chunk_video_id
            sent = end + 1
            if progress_cb:
                progress_cb({"sent": sent, "total": file_size})

    # Final-chunk 308 case: the loop exited normally but YouTube acknowledged
    # the last chunk with 308 (still processing). Query the upload URL to
    # retrieve the video_id.
    if not video_id:
        video_id = _query_upload_status(access_token, upload_url, file_size)

    if not video_id:
        raise RuntimeError(
            "Upload finished without receiving video id; "
            "YouTube may still be processing — retry the status-query in a few seconds."
        )
    return {"video_id": video_id}
