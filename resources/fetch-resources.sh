#!/usr/bin/env bash
# resources/fetch-resources.sh — fetches the bundled binaries (FFmpeg, ffprobe,
# yt-dlp) per OS/arch and the Whisper tiny CTranslate2 model.
#
# Usage:
#   bash resources/fetch-resources.sh "$(uname -s)" "$(uname -m | sed 's/x86_64/x64/')"
#
# Skip the Whisper model download by setting:
#   SKIP_WHISPER_MODEL=1 bash resources/fetch-resources.sh ...
#
# The new VAD-first pipeline (Phase 3) only needs whisper-tiny (~75 MB) for
# phrase confirmation on candidate windows. Boundary detection itself uses
# silero-vad + ffmpeg scdet. The previous large-v3 (3 GB) is no longer used.

set -euo pipefail
OS=${1:-Linux}
ARCH=${2:-x64}
SKIP_WHISPER_MODEL=${SKIP_WHISPER_MODEL:-0}

echo "==> Fetching resources for $OS/$ARCH"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN_DIR="$ROOT/resources/bin/$OS/$ARCH"
MODELS_DIR="$ROOT/resources/models"
TMP=${TMPDIR:-/tmp}
mkdir -p "$BIN_DIR" "$MODELS_DIR"

# --- FFmpeg + ffprobe ---
case "$OS-$ARCH" in
  macOS-arm64|Darwin-arm64)
    URL="https://www.osxexperts.net/ffmpeg711arm.zip"
    curl -L "$URL" -o "$TMP/ffmpeg.zip"
    unzip -o "$TMP/ffmpeg.zip" -d "$BIN_DIR"
    ;;
  macOS-x64|Darwin-x64)
    URL="https://www.osxexperts.net/ffmpeg711intel.zip"
    curl -L "$URL" -o "$TMP/ffmpeg.zip"
    unzip -o "$TMP/ffmpeg.zip" -d "$BIN_DIR"
    ;;
  Windows-x64|MINGW*-x64|MSYS_NT*-x64)
    URL="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    curl -L "$URL" -o "$TMP/ffmpeg.zip"
    rm -rf "$TMP/ffmpeg-extracted"
    unzip -o "$TMP/ffmpeg.zip" -d "$TMP/ffmpeg-extracted"
    cp "$TMP"/ffmpeg-extracted/ffmpeg-*/bin/ffmpeg.exe "$BIN_DIR/"
    cp "$TMP"/ffmpeg-extracted/ffmpeg-*/bin/ffprobe.exe "$BIN_DIR/"
    ;;
  Linux-x64|ubuntu*x64)
    URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
    curl -L "$URL" -o "$TMP/ffmpeg.tar.xz"
    rm -rf "$TMP/ffmpeg-extracted"
    mkdir -p "$TMP/ffmpeg-extracted"
    tar -xf "$TMP/ffmpeg.tar.xz" -C "$TMP/ffmpeg-extracted" --strip-components=1
    cp "$TMP/ffmpeg-extracted/ffmpeg" "$BIN_DIR/"
    cp "$TMP/ffmpeg-extracted/ffprobe" "$BIN_DIR/"
    ;;
  *)
    echo "ERROR: unsupported OS/arch combination: $OS/$ARCH" >&2
    exit 1
    ;;
esac
chmod +x "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe" 2>/dev/null || true

# --- yt-dlp ---
case "$OS-$ARCH" in
  Windows-*|MINGW*|MSYS_NT*)
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe \
      -o "$BIN_DIR/yt-dlp.exe"
    ;;
  *)
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
      -o "$BIN_DIR/yt-dlp"
    chmod +x "$BIN_DIR/yt-dlp"
    ;;
esac

# --- Whisper tiny (faster-whisper / CTranslate2 format) ---
MODEL_PATH="$MODELS_DIR/whisper-tiny"
if [ "$SKIP_WHISPER_MODEL" = "1" ]; then
  echo "==> Skipping Whisper model download (SKIP_WHISPER_MODEL=1)"
elif [ -d "$MODEL_PATH" ] && [ -f "$MODEL_PATH/model.bin" ]; then
  echo "==> Whisper model already present at $MODEL_PATH (skipping download)"
else
  echo "==> Downloading Whisper tiny (~75 MB)..."
  pip install --quiet huggingface_hub
  python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id='Systran/faster-whisper-tiny',
    local_dir='$MODEL_PATH',
)
"
fi

echo "==> Done."
echo "    resources/bin/$OS/$ARCH/ contents:"
ls -la "$BIN_DIR"
if [ -d "$MODEL_PATH" ]; then
  echo "    Model dir size:"
  du -sh "$MODEL_PATH" 2>/dev/null || true
fi

# --- SyncNet A/V offset detector (Oxford VGG, ~53 MB) ---
# Used for automatic lipsync correction in smart-cut. Beat human ear-tuning
# in real-world tests: detects sub-frame offset in 5s on CPU. See
# python-pipeline/khutbah_pipeline/util/syncnet_offset.py.
SYNCNET_PATH="$MODELS_DIR/syncnet_v2.model"
if [ ! -f "$SYNCNET_PATH" ]; then
  echo "==> Downloading SyncNet model (~53 MB)..."
  curl -L -o "$SYNCNET_PATH" \
    http://www.robots.ox.ac.uk/~vgg/software/lipsync/data/syncnet_v2.model
fi

# --- MediaPipe FaceLandmarker (~3.6 MB) ---
# Provides face crops + lip landmarks for SyncNet's input pipeline (and for
# the lip-aperture fallback detector in lipsync.py).
FACE_PATH="$MODELS_DIR/face_landmarker.task"
if [ ! -f "$FACE_PATH" ]; then
  echo "==> Downloading FaceLandmarker (~3.6 MB)..."
  curl -L -o "$FACE_PATH" \
    https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
fi
