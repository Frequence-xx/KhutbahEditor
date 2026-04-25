#!/usr/bin/env bash
# Generates tests/fixtures/khutbah_3min.mp4 — synthetic 180s clip with
# deterministic structure used by VAD/shots/candidates/pipeline_v2 tests.
#
# Layout:
#   0-30s:    silence (pre-roll)
#   30-90s:   sine 300Hz (Part 1)
#   90-120s:  silence (sitting)
#   120-150s: sine 500Hz (Part 2)
#   150-180s: silence (post-roll)
#
# Video: black 0-90s, red 90-180s — gives ffmpeg scdet a clean cut at t=90s.

set -euo pipefail
OUT="$(dirname "$0")/khutbah_3min.mp4"

ffmpeg -y \
  -f lavfi -i anullsrc=channel_layout=mono:sample_rate=16000:d=30 \
  -f lavfi -i "sine=frequency=300:sample_rate=16000:d=60" \
  -f lavfi -i anullsrc=channel_layout=mono:sample_rate=16000:d=30 \
  -f lavfi -i "sine=frequency=500:sample_rate=16000:d=30" \
  -f lavfi -i anullsrc=channel_layout=mono:sample_rate=16000:d=30 \
  -f lavfi -i "color=c=black:s=320x180:d=90" \
  -f lavfi -i "color=c=red:s=320x180:d=90" \
  -filter_complex "
    [0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[aout];
    [5:v][6:v]concat=n=2:v=1:a=0[vout]
  " \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -g 24 -keyint_min 24 -pix_fmt yuv420p \
  -c:a aac -b:a 64k \
  -loglevel error \
  "$OUT"

echo "Wrote $OUT"
