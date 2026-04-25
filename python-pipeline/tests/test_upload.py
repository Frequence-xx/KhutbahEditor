import io
import json
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
