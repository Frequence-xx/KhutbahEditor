import io
import json
import urllib.error
from unittest.mock import patch, MagicMock
import pytest


def test_initiate_upload_returns_location():
    from khutbah_pipeline.upload.resumable import initiate_upload
    mock_response = MagicMock()
    mock_response.headers = {"Location": "https://upload.youtube.com/upload-uri-12345"}
    mock_response.__enter__ = MagicMock(return_value=mock_response)
    mock_response.__exit__ = MagicMock(return_value=False)
    with patch("khutbah_pipeline.upload.resumable.urllib.request.urlopen", return_value=mock_response):
        url = initiate_upload(
            "fake-token",
            {"title": "x"},
            {"privacyStatus": "unlisted"},
            file_size=1024,
        )
    assert url == "https://upload.youtube.com/upload-uri-12345"


def test_initiate_upload_raises_when_no_location():
    from khutbah_pipeline.upload.resumable import initiate_upload
    mock_response = MagicMock()
    mock_response.headers = {}
    mock_response.__enter__ = MagicMock(return_value=mock_response)
    mock_response.__exit__ = MagicMock(return_value=False)
    with patch("khutbah_pipeline.upload.resumable.urllib.request.urlopen", return_value=mock_response):
        with pytest.raises(RuntimeError, match="upload Location"):
            initiate_upload("fake-token", {}, {}, file_size=1024)


def test_upload_handles_final_chunk_308_via_status_query(tmp_path):
    """Final chunk returns 308 (server processing); status-query retrieves video_id."""
    from khutbah_pipeline.upload import resumable

    # Make a tiny "video" file
    video_file = tmp_path / "test.mp4"
    video_file.write_bytes(b"x" * 100)  # smaller than CHUNK so loop runs once

    # Mock urlopen: chunk PUT returns 308 (no body), then status-query PUT returns 200 with video JSON.
    call_count = {"n": 0}

    def fake_urlopen(req, timeout=None):
        call_count["n"] += 1
        if call_count["n"] == 1:
            # First call: chunk PUT — return 308 to simulate "still processing"
            raise urllib.error.HTTPError(
                url="x", code=308, msg="Resume Incomplete", hdrs=None, fp=None
            )
        # Second call: status-query — return 200 with video JSON
        mock = MagicMock()
        mock.status = 200
        mock.read.return_value = b'{"id": "abc123XYZ"}'
        mock.__enter__ = MagicMock(return_value=mock)
        mock.__exit__ = MagicMock(return_value=False)
        return mock

    with patch("khutbah_pipeline.upload.resumable.urllib.request.urlopen", side_effect=fake_urlopen):
        result = resumable.upload_file(
            "fake-token",
            "https://upload.youtube.com/whatever",
            str(video_file),
        )
    assert result == {"video_id": "abc123XYZ"}


def test_upload_retries_on_5xx_then_succeeds(tmp_path):
    """Chunk PUT returns 500 once, then 200 — retry should fire and upload completes."""
    from khutbah_pipeline.upload import resumable
    from unittest.mock import MagicMock, patch

    video_file = tmp_path / "test.mp4"
    video_file.write_bytes(b"x" * 100)

    call_count = {"n": 0}

    def fake_urlopen(req, timeout=None):
        call_count["n"] += 1
        if call_count["n"] == 1:
            # First chunk attempt: 500 (retryable). Re-raised; retry should fire.
            raise urllib.error.HTTPError(
                url="x", code=500, msg="Server Error", hdrs=None, fp=None,
            )
        # Second attempt: 200 with video JSON
        mock = MagicMock()
        mock.status = 200
        mock.read.return_value = b'{"id": "video_after_retry"}'
        mock.__enter__ = MagicMock(return_value=mock)
        mock.__exit__ = MagicMock(return_value=False)
        return mock

    # Speed up backoff sleep so the test stays under 30s
    with patch("khutbah_pipeline.upload.resumable.time.sleep"), \
         patch("khutbah_pipeline.upload.resumable.urllib.request.urlopen", side_effect=fake_urlopen):
        result = resumable.upload_file(
            "fake-token",
            "https://upload.youtube.com/whatever",
            str(video_file),
        )

    assert result == {"video_id": "video_after_retry"}
    assert call_count["n"] == 2  # First failed with 500, second succeeded


def test_upload_does_not_retry_on_400(tmp_path):
    """Chunk PUT 400 (non-retryable) raises immediately."""
    from khutbah_pipeline.upload import resumable
    import pytest as _pytest

    video_file = tmp_path / "test.mp4"
    video_file.write_bytes(b"x" * 100)

    err_response = urllib.error.HTTPError(
        url="x", code=400, msg="Bad Request", hdrs=None, fp=None,
    )

    with patch("khutbah_pipeline.upload.resumable.urllib.request.urlopen", side_effect=err_response):
        with _pytest.raises(RuntimeError, match="HTTP 400"):
            resumable.upload_file(
                "fake-token",
                "https://upload.youtube.com/whatever",
                str(video_file),
            )


def test_resolve_or_create_playlist_uses_existing_id():
    from khutbah_pipeline.upload.playlists import resolve_or_create_playlist
    # If name_or_id starts with PL, return it directly without API call
    result = resolve_or_create_playlist("fake-token", "PLabcdef123")
    assert result == "PLabcdef123"


def test_resolve_or_create_playlist_returns_none_for_empty():
    from khutbah_pipeline.upload.playlists import resolve_or_create_playlist
    assert resolve_or_create_playlist("fake-token", None) is None
    assert resolve_or_create_playlist("fake-token", "") is None


def test_resolve_or_create_playlist_finds_by_name(monkeypatch):
    from khutbah_pipeline.upload import playlists
    monkeypatch.setattr(
        playlists, "list_playlists",
        lambda _t: [
            {"id": "PLfound1", "snippet": {"title": "Vrijdagkhutbah 2026"}},
            {"id": "PLfound2", "snippet": {"title": "Other Stuff"}},
        ],
    )
    result = playlists.resolve_or_create_playlist("fake-token", "vrijdagkhutbah 2026")  # case-insensitive
    assert result == "PLfound1"


def test_resolve_or_create_playlist_creates_when_missing(monkeypatch):
    from khutbah_pipeline.upload import playlists
    monkeypatch.setattr(playlists, "list_playlists", lambda _t: [])
    monkeypatch.setattr(
        playlists, "create_playlist",
        lambda _t, title, **_kw: {"id": f"PLcreated_{title}", "snippet": {"title": title}},
    )
    result = playlists.resolve_or_create_playlist("fake-token", "New Playlist", auto_create=True)
    assert result == "PLcreated_New Playlist"


def test_resolve_or_create_playlist_returns_none_when_not_found_no_create(monkeypatch):
    from khutbah_pipeline.upload import playlists
    monkeypatch.setattr(playlists, "list_playlists", lambda _t: [])
    result = playlists.resolve_or_create_playlist("fake-token", "Missing", auto_create=False)
    assert result is None
