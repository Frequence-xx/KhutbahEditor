"""YouTube Data API v3 helpers — upload video, set thumbnail, update metadata."""
import json
import os
import urllib.request
from typing import Any, Callable, Optional
from khutbah_pipeline.upload.resumable import initiate_upload, upload_file


def upload_video(
    access_token: str,
    file_path: str,
    title: str,
    description: str,
    tags: list[str],
    category_id: str = "27",
    privacy_status: str = "unlisted",
    self_declared_made_for_kids: bool = False,
    default_audio_language: str = "ar",
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Upload a video file via resumable upload. Returns {"video_id": <id>}."""
    snippet: dict[str, Any] = {
        "title": title[:100],
        "description": description[:5000],
        "tags": tags[:30],
        "categoryId": category_id,
        "defaultLanguage": default_audio_language,
        "defaultAudioLanguage": default_audio_language,
    }
    status: dict[str, Any] = {
        "privacyStatus": privacy_status,
        "selfDeclaredMadeForKids": self_declared_made_for_kids,
        "embeddable": True,
        "publicStatsViewable": True,
    }
    file_size = os.path.getsize(file_path)
    upload_url = initiate_upload(access_token, snippet, status, file_size)
    return upload_file(access_token, upload_url, file_path, progress_cb=progress_cb)


def set_thumbnail(access_token: str, video_id: str, thumbnail_path: str) -> dict[str, Any]:
    """Set a custom thumbnail for the uploaded video."""
    with open(thumbnail_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(
        f"https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={video_id}",
        data=data, method="POST",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "image/jpeg"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def update_metadata(
    access_token: str,
    video_id: str,
    snippet: Optional[dict[str, Any]] = None,
    status: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Update an uploaded video's snippet/status fields."""
    body: dict[str, Any] = {"id": video_id}
    parts: list[str] = []
    if snippet is not None:
        body["snippet"] = snippet
        parts.append("snippet")
    if status is not None:
        body["status"] = status
        parts.append("status")
    if not parts:
        raise ValueError("update_metadata requires at least snippet or status")
    req = urllib.request.Request(
        f"https://www.googleapis.com/youtube/v3/videos?part={','.join(parts)}",
        data=json.dumps(body).encode("utf-8"), method="PUT",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
