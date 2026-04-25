from unittest.mock import patch, MagicMock
import pytest
from khutbah_pipeline.ingest import youtube


def test_rejects_leading_dash_url():
    """yt-dlp option injection: URLs starting with '-' would be parsed as flags."""
    with pytest.raises(ValueError, match="cannot start with"):
        youtube.info_only("--exec=sh -c 'pwn'")


def test_rejects_non_youtube_host():
    """URL must be a YouTube domain."""
    with pytest.raises(ValueError, match="YouTube domain"):
        youtube.info_only("https://evil.com/watch?v=123")


def test_accepts_youtube_dot_com():
    """Standard YouTube URLs pass validation."""
    mock_run = MagicMock(return_value=MagicMock(stdout='{"id":"abc"}', returncode=0))
    with patch("khutbah_pipeline.ingest.youtube.subprocess.run", mock_run):
        youtube.info_only("https://www.youtube.com/watch?v=abc")


def test_accepts_youtu_dot_be_short_url():
    """Short youtu.be URLs pass validation."""
    mock_run = MagicMock(return_value=MagicMock(stdout='{"id":"abc"}', returncode=0))
    with patch("khutbah_pipeline.ingest.youtube.subprocess.run", mock_run):
        youtube.info_only("https://youtu.be/abc")


def test_info_only_returns_parsed_json():
    fake_yt_dlp_output = '{"title": "Test Video", "duration": 1234, "id": "abc"}'
    mock_run = MagicMock()
    mock_run.return_value = MagicMock(stdout=fake_yt_dlp_output, returncode=0)
    with patch("khutbah_pipeline.ingest.youtube.subprocess.run", mock_run):
        result = youtube.info_only("https://www.youtube.com/watch?v=abc")
    assert result["title"] == "Test Video"
    assert result["duration"] == 1234


def test_info_only_raises_on_yt_dlp_failure():
    """Non-zero returncode must raise RuntimeError with yt-dlp's stderr message."""
    mock_run = MagicMock(return_value=MagicMock(
        stdout='',
        stderr='ERROR: This video is not available',
        returncode=1,
    ))
    with patch("khutbah_pipeline.ingest.youtube.subprocess.run", mock_run):
        with pytest.raises(RuntimeError, match="This video is not available"):
            youtube.info_only("https://www.youtube.com/watch?v=invalid")


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
            youtube.download("https://www.youtube.com/watch?v=invalid", "/tmp")


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
        result = youtube.download("https://www.youtube.com/watch?v=abc", "/tmp")
    assert result == "/tmp/Test [abc].mp4"


def test_info_only_includes_js_runtime_flag():
    """Verify yt-dlp gets the JS-runtime flag for n-challenge solving."""
    fake_yt_dlp_output = '{"title": "X", "duration": 100, "id": "abc"}'
    mock_run = MagicMock()
    mock_run.return_value = MagicMock(stdout=fake_yt_dlp_output, returncode=0)
    with patch('khutbah_pipeline.ingest.youtube.subprocess.run', mock_run):
        youtube.info_only('https://www.youtube.com/watch?v=abc')
    args = mock_run.call_args.args[0]
    assert '--js-runtimes' in args
    assert '--remote-components' in args
    # Verify the URL still ends the argv (after --)
    assert args[-2] == '--'
    assert args[-1] == 'https://www.youtube.com/watch?v=abc'


def test_download_includes_js_runtime_flag():
    """Verify yt-dlp download path also gets the JS-runtime flag."""
    output_lines = ["[download] Destination: /tmp/Test [abc].mp4\n"]
    mock_proc = MagicMock()
    mock_proc.stdout = iter(output_lines)
    mock_proc.stderr = MagicMock()
    mock_proc.wait = MagicMock()
    mock_proc.returncode = 0
    with patch('khutbah_pipeline.ingest.youtube.subprocess.Popen', return_value=mock_proc) as mock_popen:
        youtube.download('https://www.youtube.com/watch?v=abc', '/tmp')
    cmd = mock_popen.call_args.args[0]
    assert '--js-runtimes' in cmd
    assert '--remote-components' in cmd
