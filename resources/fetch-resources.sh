#!/usr/bin/env bash
# resources/fetch-resources.sh — Phase 0 placeholder, fully implemented in Phase 2.
set -euo pipefail
OS=${1:-Linux}
ARCH=${2:-x64}
echo "Fetching resources for $OS/$ARCH (placeholder — populated in Phase 2)"
mkdir -p "resources/bin/$OS/$ARCH" resources/models
# Phase 2 task adds actual download URLs for FFmpeg, yt-dlp, Whisper model
touch "resources/bin/$OS/$ARCH/.gitkeep"
