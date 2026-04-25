from unittest.mock import patch, MagicMock
import pytest
from khutbah_pipeline.ingest import youtube


def test_info_only_returns_parsed_json():
    fake_yt_dlp_output = '{"title": "Test Video", "duration": 1234, "id": "abc"}'
    mock_run = MagicMock()
    mock_run.return_value = MagicMock(stdout=fake_yt_dlp_output, returncode=0)
    with patch("khutbah_pipeline.ingest.youtube.subprocess.run", mock_run):
        result = youtube.info_only("https://www.youtube.com/watch?v=abc")
    assert result["title"] == "Test Video"
    assert result["duration"] == 1234


def test_info_only_raises_on_yt_dlp_failure():
    import subprocess
    mock_run = MagicMock(side_effect=subprocess.CalledProcessError(1, ["yt-dlp"]))
    with patch("khutbah_pipeline.ingest.youtube.subprocess.run", mock_run):
        with pytest.raises(subprocess.CalledProcessError):
            youtube.info_only("https://invalid")


def test_download_raises_on_nonzero_exit():
    """yt-dlp non-zero exit must raise (not silent return)."""
    mock_proc = MagicMock()
    mock_proc.stdout = iter([])  # empty output
    mock_proc.stderr = MagicMock()
    mock_proc.stderr.read = MagicMock(return_value="error: video unavailable")
    mock_proc.wait = MagicMock()
    mock_proc.returncode = 1
    with patch("khutbah_pipeline.ingest.youtube.subprocess.Popen", return_value=mock_proc):
        with pytest.raises(RuntimeError, match="yt-dlp failed"):
            youtube.download("https://invalid", "/tmp")


def test_download_returns_destination_path():
    """Happy path: yt-dlp prints Destination: line, we capture it."""
    output_lines = [
        "[download] Destination: /tmp/Test [abc].mp4\n",
    ]
    mock_proc = MagicMock()
    mock_proc.stdout = iter(output_lines)
    mock_proc.stderr = MagicMock()
    mock_proc.wait = MagicMock()
    mock_proc.returncode = 0
    with patch("khutbah_pipeline.ingest.youtube.subprocess.Popen", return_value=mock_proc):
        result = youtube.download("https://test", "/tmp")
    assert result == "/tmp/Test [abc].mp4"
