"""YouTube playlist management — list, create, add-video, resolve-by-name-or-id."""
import json
import urllib.request
from typing import Any, Optional
from khutbah_pipeline.upload.resumable import DEFAULT_TIMEOUT


def list_playlists(access_token: str) -> list[dict[str, Any]]:
    """Return all playlists owned by the authenticated user (paginates)."""
    out: list[dict[str, Any]] = []
    page_token: Optional[str] = None
    params = "part=snippet,contentDetails&mine=true&maxResults=50"
    while True:
        url = f"https://www.googleapis.com/youtube/v3/playlists?{params}"
        if page_token:
            url += f"&pageToken={page_token}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
        with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as r:
            data = json.loads(r.read())
        out.extend(data.get("items", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            return out


def create_playlist(
    access_token: str,
    title: str,
    description: str = "",
    privacy: str = "unlisted",
) -> dict[str, Any]:
    """Create a new playlist. Returns the new playlist resource."""
    body = json.dumps({
        "snippet": {"title": title[:150], "description": description[:5000]},
        "status": {"privacyStatus": privacy},
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://www.googleapis.com/youtube/v3/playlists?part=snippet,status",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as r:
        return json.loads(r.read())


def add_video_to_playlist(access_token: str, playlist_id: str, video_id: str) -> dict[str, Any]:
    """Add `video_id` to `playlist_id`."""
    body = json.dumps({
        "snippet": {
            "playlistId": playlist_id,
            "resourceId": {"kind": "youtube#video", "videoId": video_id},
        }
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as r:
        return json.loads(r.read())


def resolve_or_create_playlist(
    access_token: str,
    name_or_id: Optional[str],
    auto_create: bool = True,
    visibility: str = "unlisted",
) -> Optional[str]:
    """Resolve `name_or_id` to a YouTube playlist ID.

    Per spec §7.7: if it starts with 'PL', treat as a playlist ID directly.
    Otherwise treat as a name; lookup in the user's playlists; create if
    missing and auto_create=True.

    Returns the playlist ID, or None if `name_or_id` is empty / not found and
    auto_create is False.
    """
    if not name_or_id:
        return None
    if name_or_id.startswith("PL"):
        return name_or_id
    existing = list_playlists(access_token)
    match = next(
        (p for p in existing if p["snippet"]["title"].lower() == name_or_id.lower()),
        None,
    )
    if match:
        return match["id"]
    if not auto_create:
        return None
    created = create_playlist(access_token, name_or_id, visibility=visibility)
    return created["id"]
