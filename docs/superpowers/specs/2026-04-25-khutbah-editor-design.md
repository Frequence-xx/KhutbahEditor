# KhutbahEditor — Design Specification

**Date:** 2026-04-25
**Author:** Farouq Aliyu (alhimmah.nl) with Claude
**Status:** Approved (pending user spec review)
**GitHub repo:** `git@github.com:Frequence-xx/KhutbahEditor.git`

---

## 1. Purpose

KhutbahEditor is a self-contained desktop application that takes a Friday khutbah recording — either a YouTube URL or a local media file — and produces two upload-ready video files (Part 1 and Part 2 of the khutbah), then publishes them to YouTube with full metadata and thumbnail. The app runs fully offline for processing, requiring internet only for YouTube ingest and upload. Auto-pilot is the default workflow; manual intervention is the rare exception.

The app is built for the Al-Himmah Moskee (alhimmah.nl) and shares its visual identity.

## 2. Locked design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Speech recognition | Bundled local `faster-whisper` with `tiny` model (~75 MB) on small candidate windows + silero-vad for speech/silence segmentation | Auto-pilot < 5 min on CPU; offline; large-v3 was retired 2026-04-25 because full-audio transcription took 25+ min and defeated the auto-pilot promise. See docs/superpowers/plans/2026-04-25-pipeline-speed-overhaul.md. |
| Stack | Electron + Vite + React + TypeScript + Tailwind, with Python sidecar | Most mature cross-platform desktop stack, best fit for the modern UI requirement |
| UI aesthetic | "Dignified Dark" — slate (`#2D3E50`/`#1A2332`) base with amber (`#E8B73C`) accents | Matches Al-Himmah palette; video-editor-native; calm and focused |
| Typography | Cinzel (headings) + Open Sans (body) + Amiri (Arabic) — all OFL/Apache 2.0 | Cinzel substitutes for Trajan Pro (Adobe-licensed, can't bundle); Open Sans matches website; Amiri is the canonical free Arabic Naskh |
| Languages handled | Arabic, Dutch, English (Whisper multilingual) | Reflects khutbah reality: Part 1 usually Arabic; Part 2 often Dutch, sometimes Arabic, rarely English |
| Audio normalization target | -14 LUFS integrated, -1 dBTP true peak (EBU R128, two-pass loudnorm) | YouTube standard — anything louder gets attenuated by their player |
| Review UX | Auto-pilot first; Editor opens only when confidence < 90 %; markers draggable as safety net | "Manual work is extremely exceptional" |
| YouTube auth | Shared Frequence-xx Google Cloud app credentials embedded in app, OAuth loopback flow, **multi-account** (N signed-in YouTube channels per app installation) | Same khutbah often published to multiple Al-Himmah channels (e.g., NL-language and AR-language); refresh tokens stored per account in OS keychain |
| Per-upload account selection | User picks one or more signed-in accounts per upload; auto-pilot uploads to all accounts marked "auto-publish" in Settings | Variable target set per khutbah; defaults configurable |
| Per-account metadata override | Default: shared metadata (single title/description/thumbnail across selected accounts). Override: "Customize per account" toggle on upload screen splits metadata into one panel per account; per-account templates configurable in Settings | Account A might be NL-language, Account B AR-only — different descriptions wanted |
| Playlist support | Per-account default playlist configurable in Settings; uploaded video auto-added to the playlist; if the playlist doesn't exist on that channel, auto-create it (toggleable) | "Vrijdagkhutbah 2026" on Channel A, "Friday Sermons 2026" on Channel B |
| Audio↔video sync | Single-file (default) preserves sync via FFmpeg stream-copy; **dual-file mode** uses FFT cross-correlation to align separate audio + video before processing | Both single-source and lapel-mic-plus-camera workflows supported |
| Code signing | **Not used.** App ships unsigned. Documented bypass instructions in README. | Zero infrastructure cost; acceptable for pilot |
| Platforms | macOS (x64 + arm64 .dmg), Windows (x64 .exe NSIS), Linux (x64 .AppImage + .deb) | Cross-platform parity |
| Distribution | Direct download from `releases.alhimmah.nl` (or GitHub Releases mirror), with `electron-updater` auto-update | No app store, no review delays |

## 3. System architecture

Three layers running in a single Electron app:

### 3.1 Electron shell (Node.js main process)

- Window, native menus, file dialogs, app lifecycle
- Spawns and supervises the Python sidecar (auto-restart on crash)
- OAuth token storage in OS keychain via `keytar`:
  - macOS: Keychain Access (service `nl.alhimmah.khutbaheditor`)
  - Windows: Credential Manager (Generic Credentials)
  - Linux: libsecret (Secret Service API)
- IPC bridge between renderer and Python sidecar
- Auto-update via `electron-updater`

### 3.2 React renderer (UI)

- Vite + React 18 + TypeScript + Tailwind CSS
- Single-window app with screens: Library → Editor → Upload → Settings
- Video preview = HTML5 `<video>` playing a low-bitrate FFmpeg-encoded proxy (`-b:v 1M -vf scale=640:-2`) so scrubbing stays smooth on a multi-GB source
- All slow work delegated to Python via `ipcRenderer`

### 3.3 Python sidecar (long-running child process)

- One process started at app launch, JSON-RPC over stdio
- Submodules:
  - `ingest/` — `yt-dlp` (YouTube), `ffprobe` (local files)
  - `align/` — `scipy.signal` FFT cross-correlation for dual-file audio↔video alignment
  - `detect/` — `faster-whisper` Arabic/Dutch/English transcription, multilingual phrase matching, silence detection
  - `edit/` — FFmpeg cut (smart-cut hybrid: stream-copy bulk, re-encode boundaries) + EBU R128 loudness normalization
  - `upload/` — YouTube Data API v3 client (resumable uploads, thumbnails, metadata edits)
- Packaged with PyInstaller into a single platform-specific binary, bundled as `extraResource` by electron-builder

### 3.4 Bundled binaries (per platform, in `resources/bin/`)

| Binary | Approx. size | Purpose |
|--------|--------------|---------|
| `ffmpeg` + `ffprobe` | ~80 MB | All audio/video processing |
| `yt-dlp` (single static binary) | ~20 MB | YouTube downloads |
| `khutbah-pipeline` (PyInstaller bundle) | ~150 MB | The Python sidecar with all deps frozen |
| `models/whisper-large-v3.bin` (GGUF) | ~3 GB | Speech recognition model |

**Total install size:** ~3.3-3.4 GB per platform.

### 3.5 Data flow

```
[User picks input]
        │
        ▼
[Renderer] ── ipc ──► [Main] ── RPC ──► [Python sidecar]
                                              │
                                              │  ingest → align (if dual) →
                                              │  transcribe (Whisper, multilingual) →
                                              │  detect boundaries →
                                              │  emit progress events ↑
                                              ▼
[Renderer] receives boundary timestamps, transcript snippets, confidence
        │
        │  if all confidence ≥ 90 % AND auto-pilot ON:
        │      → skip Editor, proceed to Export
        │  else:
        │      → open Editor with markers pre-placed (safety net for tweaks)
        ▼
[User confirms or adjusts] → ipc → [Python] cut + normalize → 2 output .mp4 files
        │
        ▼
[Main] OAuth (system browser, loopback redirect) → [Python] resumable upload + thumbnail set
        │
        ▼
[Renderer] shows upload progress per part; notification when complete
```

## 4. Detection pipeline (the algorithm)

Runs entirely in the Python sidecar after ingest.

### Stage 1 — audio extraction

```bash
ffmpeg -i source.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le tmp/audio16k.wav
```
Mono, 16 kHz PCM (Whisper's native format).

### Stage 2 — multilingual Whisper transcription

- Engine: `faster-whisper` (CTranslate2 backend, 4× faster than vanilla Whisper)
- Model: standard multilingual `large-v3` (~3 GB)
- Two-pass strategy:
  - Pass A: VAD-segment audio into ~30 s chunks; run `detect_language()` per chunk
  - Pass B: re-transcribe each chunk with locked detected language for accuracy
- Settings: `word_timestamps=True`, `vad_filter=True`
- Output: list of `{word, start, end, probability, lang}` for the full audio
- Time: ~5-7 min per 30-min khutbah on modern CPU; ~30-60 s with CUDA (auto-detected if available)

### Stage 3 — Part 1 start: phrase `إن الحمد لله`

- The formal opening is **always Arabic** regardless of khutbah language (canonical hutbah opening)
- Normalize transcript: strip diacritics (tashkeel), unify alif forms (`إ`/`أ`/`ا`), collapse whitespace
- Match normalized variants: `إن الحمد لله`, `إنّ الحمد لله`, `ان الحمد لله`
- Pick the **first** occurrence
- `part1_start = phrase_word.start − 5.0 seconds`
- Confidence = mean Whisper word-probability across the matched phrase

### Stage 4 — sitting silence: Part 1 end / Part 2 start

```bash
ffmpeg -i tmp/audio16k.wav -af "silencedetect=noise=-35dB:duration=1.5" -f null -
```
- Parse `silence_start` / `silence_end` events
- Filter to silences AFTER `part1_start + 5 minutes` (Part 1 has a minimum sensible duration)
- AND BEFORE the natural ending (5 min buffer at end so we don't pick post-khutbah silence)
- Pick the **longest** silence in window — the sitting moment is meaningfully longer than within-speech pauses
- `part1_end = silence_start`
- `part2_start = silence_end`
- Confidence = `min(silence_duration / 3.0, 1.0)` (3+ seconds = full confidence)

### Stage 5 — Part 2 end: dua closing

Multilingual closing-phrase library (configurable in Settings):
```python
CLOSINGS = {
    "ar": [
        "ربنا آتنا في الدنيا حسنة وفي الآخرة حسنة",
        "وآخر دعوانا أن الحمد لله رب العالمين",
        "سبحان ربك رب العزة عما يصفون",
        "أقم الصلاة",
    ],
    "nl": [
        "onze heer geef ons in deze wereld het goede",
        "heer der werelden",
        "verricht het gebed",
    ],
    "en": [
        "our lord give us in this world",
        "lord of the worlds",
        "establish the prayer",
    ],
}
```

Strategy:
1. Detect Part 2's dominant language (mode of `lang` tags between `part2_start` and end)
2. Search closings in dominant language **first**, then check Arabic anyway (Arabic dua often closes a Dutch/English khutbah — code-switch)
3. Pick the **latest match** across all languages
4. `part2_end = closing_phrase_word.end + 1.0 second` (breath buffer)
5. Fallback if no closing phrase found: `part2_end = last_word_with_prob>0.5.end + 2.0 seconds`, confidence = 0.6

### Stage 6 — confidence aggregation

| Overall confidence | Auto-pilot behavior |
|--------------------|---------------------|
| ≥ 90 % (all boundaries strong) | Skip editor, go straight to export + upload |
| 70-89 % | Open editor with green status banner, default action = upload |
| < 70 % | Open editor with amber warning, recommend manual review |

### Stage 7 — emit results to renderer

```json
{
  "duration": 2292.3,
  "part1": {
    "start": 84.2, "end": 956.4, "confidence": 0.97,
    "transcript_at_start": "...إن الحمد لله نحمده ونستعينه...",
    "lang": "ar"
  },
  "part2": {
    "start": 962.1, "end": 1604.8, "confidence": 0.95,
    "transcript_at_end": "...ربنا آتنا في الدنيا حسنة...",
    "lang": "nl"
  },
  "all_silences": [{"start": 956.4, "end": 962.1, "duration": 5.7}, ...],
  "overall_confidence": 0.95
}
```

### Defensive paths (the "extremely exceptional" manual cases)

- Stage 3 fails (no `إن الحمد لله` found anywhere): pipeline does NOT guess. Surfaces error, opens editor with the full waveform so user can mark Part 1 start manually.
- Stage 4 fails (no silence > 1.5 s in window): same — editor open, manual placement of part1_end / part2_start markers.
- Stage 5 fails (no closing phrase AND no clean speech-end): same — editor open, manual placement of part2_end marker.

## 5. Audio & video processing

### 5.1 Audio normalization (EBU R128 / loudnorm)

YouTube standard:
- **Integrated:** -14 LUFS
- **True peak:** -1 dBTP
- **Loudness range:** 11 LU

**Two-pass FFmpeg loudnorm** (single pass causes audible pumping on speech — unacceptable):

Pass 1 (measure):
```bash
ffmpeg -i source.mp4 -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null -
```

Pass 2 (apply with measured values, linear):
```bash
ffmpeg -ss <part_start> -to <part_end> -i source.mp4 \
  -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=...:measured_TP=...:measured_LRA=...:measured_thresh=...:offset=...:linear=true" \
  -c:v <see below> -c:a aac -b:a 192k -movflags +faststart \
  part1.mp4
```

### 5.2 Video cut — "smart cut" hybrid

Stream-copy is instant and lossless but only works at keyframes; re-encoding is frame-accurate but slow. We do both:

1. **Stream-copy the bulk** between nearest keyframes inside the requested range
2. **Re-encode only the head and tail seconds** (typically 1-3 s) to land on exact frame boundaries
3. **Concatenate** with `ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4`

A 15-min Part 1 export takes ~20-30 s instead of 4-6 min for full re-encode, while still being frame-accurate.

### 5.3 Codec choices (locked for YouTube optimal)

- Video: **H.264 High Profile**, CRF 18, preset medium (re-encoded segments only)
- Audio: **AAC LC** 192 kbps stereo at 48 kHz
- Container: **MP4** with `+faststart` (moov atom at front, enables streaming during upload)

### 5.4 Lipsync preservation

- `-async 1` and `-vsync cfr` only when re-encoding (forces audio-video sync at cuts)
- Stream-copy preserves PTS naturally
- Post-export validation: `ffprobe -show_streams` confirms audio/video duration match within 1 frame (~33 ms at 30 fps)
- If drift detected: re-export with full re-encode as fallback

### 5.5 Dual-file alignment (separate audio + video)

When user provides a separate audio track (e.g., lapel mic) alongside camera video:

```python
# 1. Extract video's embedded audio + load separate track, both as mono 16 kHz PCM
ref = ffmpeg_extract_audio(video_path, sr=16000, mono=True)   # camera audio
sig = ffmpeg_load_audio(audio_path, sr=16000, mono=True)      # lapel mic

# 2. Bandpass filter both (200-3400 Hz speech band)
ref_f = bandpass(ref, 200, 3400, sr=16000)
sig_f = bandpass(sig, 200, 3400, sr=16000)

# 3. FFT-based cross-correlation
xcorr = scipy.signal.correlate(sig_f, ref_f, mode='full', method='fft')
peak = np.argmax(np.abs(xcorr))
offset_samples = peak - (len(ref_f) - 1)
offset_seconds = offset_samples / 16000.0   # negative = audio leads video
```

- Speed: ~3-5 s for two 30-min audio tracks
- Accuracy: ±1 sample at 16 kHz = ±0.0625 ms (well within ±40 ms lipsync tolerance)
- Confidence check: peak amplitude / median(|xcorr|); if ratio < 5, fall back to manual offset slider in editor

Application:
```bash
ffmpeg -i video.mp4 -itsoffset <offset_seconds> -i audio.wav \
  -map 0:v -map 1:a -c:v copy -c:a copy aligned.mp4
```
Then the rest of the pipeline treats `aligned.mp4` as a normal single-file source.

## 6. UI screens (Dignified Dark)

### 6.1 Visual system

- **Palette:** background `#0C1118` / `#1A2332` (slate-near-black), accent `#E8B73C` (amber), success `#7BA05B` (green), text `#E8E3D6` / `#F5E9C8`, muted `#6A7788`
- **Typography:**
  - Headings + brand wordmark: **Cinzel** (Google Fonts, OFL) — Trajan-inspired Roman caps, used for `KHUTBAH EDITOR`, section titles, primary CTAs
  - Body, forms, microcopy: **Open Sans** (Apache 2.0) — same as alhimmah.nl
  - Arabic text: **Amiri** (OFL) — proper Naskh with RTL
  - All three fonts bundled in `assets/fonts/` and loaded via `@font-face` (no CDN dependency)
- **Spacing:** 4 / 8 / 12 / 16 / 24 / 32 px scale (Tailwind defaults aligned)
- **Border radius:** 4 px (small), 6 px (cards), 10 px (app shell)
- **Shadows:** subtle, `box-shadow: 0 30px 80px rgba(0,0,0,0.5)` for raised app shell

### 6.2 Screen list

| Screen | Purpose |
|--------|---------|
| **Library** (home) | Recent khutbahs grouped by week, status pills (uploaded ✓ / draft / failed), prominent "+ New Khutbah" CTA |
| **New Khutbah** (input) | Three tabs: paste YouTube URL · pick local file · dual-file (video + separate audio). Big drop-zone for files. |
| **Processing** | Live stages with checkmarks (download → extract audio → detect language → transcribe → detect boundaries → cut + normalize → upload). Progress bar on the live stage. ETA. Cancel button. |
| **Editor** | Opens only if confidence < 90 % or auto-pilot is OFF. Video preview (left), part inspector with transcript snippets and confidence bars (right), waveform timeline with draggable markers (bottom), action bar with primary "Upload to YouTube" CTA. |
| **Upload** | **Multi-account aware:** top of screen lets user toggle which signed-in accounts to upload to (defaults to "auto-publish" set from Settings). Per-part metadata: title, description (with cross-link to other part), thumbnail picker (5 auto-extracted scene-change frames + custom upload), tags, category (default Education), visibility, made-for-kids toggle, **playlist field per account** (typed name with autocomplete from account's existing playlists, or "+ create new"). "Customize per account" toggle splits metadata into one panel per selected account. Progress matrix: rows = parts, columns = accounts. Edits during upload apply via YouTube API. |
| **Settings** | **Accounts section** at top — list of signed-in YouTube channels with avatar, "Sign out" per account, "+ Add account" button, per-account default playlist (typed/picked), "Auto-publish" toggle, optional per-account title/description/tags/visibility template overrides. Below: title/description/tag templates with placeholders (`{date}`, `{khatib}`, `{part_number}`, `{language}`), default thumbnail strategy, default output folder, audio normalization target, auto-pilot toggle, "Auto-create missing playlists" toggle, model preferences. |

### 6.3 Key UX principles

- **Auto-pilot is the path.** The Editor is a confirmation, not a workshop. Manual marker tweaks are the safety net for the rare exception.
- **All metadata pre-fills from Settings templates.** User configures defaults once, then every khutbah uploads with sensible defaults.
- **Edits never block.** Upload starts immediately with template defaults; field edits apply during/after via YouTube's update API.
- **Errors are honest.** When detection fails, we say so and open the manual editor — we never guess silently.
- **OS-native completion notifications.** When auto-pilot finishes uploading, a system notification fires (so the user can paste a URL and walk away).

## 7. YouTube OAuth & upload

### 7.0 Multi-account model

The app maintains **N signed-in YouTube accounts** (typically 1-3 in practice). Each account is uniquely identified by its **YouTube channel ID** (not the Google account email — a single Google account can own multiple YouTube brand channels, and we treat each channel as a separate "account").

**Account record (stored in `electron-store`):**
```ts
type YouTubeAccount = {
  channelId: string;          // UCxxxxxx — primary key
  channelTitle: string;       // "Al-Himmah NL"
  thumbnailUrl: string;       // for UI avatar
  signedInAt: number;
  defaultPlaylistId?: string; // user's chosen playlist for this channel
  autoPublish: boolean;       // included in auto-pilot uploads
  titleTemplateOverride?: string;
  descriptionTemplateOverride?: string;
  tagsOverride?: string[];
  defaultVisibilityOverride?: 'public' | 'unlisted' | 'private';
};
```

Refresh tokens are stored separately, keyed by channel ID (`keytar` service `nl.alhimmah.khutbaheditor`, account `youtube-refresh-token:<channelId>`).

**Sign-in flow extension:** after OAuth completes, call `youtube.channels.list?part=snippet&mine=true` with the access token, retrieve all channels owned by the Google account, and let the user pick which one(s) to add. Each picked channel becomes an account record. (Most users have one channel per Google account; brand-account holders may have several.)

**Adding another account:** user clicks "+ Add account" in Settings → fresh OAuth loopback flow → repeat. Google's OAuth UI handles the account-switching prompt naturally.

**Sign-out per account:** removes the account record from `electron-store` and the matching keychain entry.

### 7.1 OAuth 2.0 — desktop app, loopback redirect, PKCE

Registered Google Cloud project type: "Desktop app". Embedded credentials: `client_id` (no secret needed for desktop with PKCE).

**Flow:**
1. User clicks "Sign in with Google" in Settings
2. Electron main spawns a local HTTP server on an ephemeral port (e.g., `127.0.0.1:53431`)
3. Open user's default browser:
   ```
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=<our_app_id>
     &redirect_uri=http://127.0.0.1:53431/callback
     &response_type=code
     &scope=https://www.googleapis.com/auth/youtube.upload
            https://www.googleapis.com/auth/youtube
     &code_challenge=<PKCE>&code_challenge_method=S256
     &access_type=offline&prompt=consent
   ```
4. User authenticates in browser; Google redirects to `127.0.0.1:53431/callback?code=...`
5. Local server captures code, returns a "✓ Signed in to KhutbahEditor — you can close this window" HTML page
6. Electron exchanges code + PKCE verifier for `access_token` (1 h TTL) + `refresh_token` (long-lived)
7. Store `refresh_token` in OS keychain via `keytar`
8. Shut down local server

### 7.2 Token lifecycle

- Access token in memory only (1 h TTL from Google)
- Refresh token in OS keychain only (per `channelId`)
- Before each API call: if access_token expires < 60 s, refresh it
- If refresh fails with `invalid_grant` (revoked or expired): clear that channel's keychain entry, mark the account as `needs_reauth`, surface a non-blocking toast in the renderer (`"Sign-in expired for <channelTitle> — click to re-authenticate"`), and route the OAuth flow back through `signInWithGoogle()` for that account

### 7.2.1 Testing-mode 7-day refresh-token reality (operational note)

While the OAuth consent screen is in **Testing** state (which is the v1 plan — see §11), Google issues refresh tokens that expire after **7 days**. This affects auto-pilot UX:

- Weekly khutbah workflow: upload Friday → refresh token expires roughly the following Friday → user re-auths before next upload. Workable but requires user action ~weekly.
- Multi-account: each account's refresh token has its own 7-day clock from its sign-in time. They expire independently.
- Auto-pilot behavior on expired refresh: the orchestrator detects `invalid_grant` for a specific account, surfaces a clear toast (`"Sign-in expired for <channelTitle> — re-authenticate to publish"`), proceeds with all other accounts whose tokens are still valid, and surfaces a "1 of N uploads needs re-auth" notification at the end.
- Once the OAuth consent screen is moved to **In production** (which requires Google's app verification + YouTube API services audit, a 4-6 week external process), refresh tokens become long-lived and this 7-day cycle goes away. v1 stays in Testing mode.

This is a deliberate Google policy and cannot be bypassed in Testing mode. The app must handle it gracefully — never lose user data, never block other uploads, always surface a one-click path back to re-auth.

### 7.3 Resumable upload

```
POST https://www.googleapis.com/upload/youtube/v3/videos
     ?uploadType=resumable&part=snippet,status
Authorization: Bearer <access_token>
X-Upload-Content-Length: <file_size_bytes>
X-Upload-Content-Type: video/mp4
Body: { snippet: {title, description, tags, categoryId, defaultLanguage},
        status: {privacyStatus, selfDeclaredMadeForKids, embeddable, publicStatsViewable} }
```

Then PUT 8 MB chunks to the returned upload URL with `Content-Range` headers. Track byte offset per part for resumability.

On network failure: query upload status (`PUT` with `Content-Range: bytes */<file_size>`), continue from returned `Range: bytes=0-X`.

### 7.4 Thumbnail upload (after video upload completes)

```
POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=<id>
Body: <jpeg bytes, 1280×720, ≤ 2 MB>
```

Thumbnail extraction: FFmpeg scene-detection on each part:
```bash
ffmpeg -i part1.mp4 -vf "select='gt(scene,0.3)',scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p" \
       -vsync vfr -frames:v 6 -q:v 2 thumb-%02d.jpg
```
Pick the highest-scene-change frame after the 30 % mark as auto-default. Show all 6 + "upload custom" tile in the picker.

### 7.5 Metadata edits during/after upload

YouTube allows editing `snippet` and `status` after upload via:
```
PUT https://www.googleapis.com/youtube/v3/videos?part=snippet,status
```

Field edits in the Upload screen are queued and applied when the upload completes (videoId now known) or immediately if upload is already done.

### 7.6 Quota

- Upload costs ~1600 units; thumbnail set ~50 units; metadata update ~50 units
- Default daily quota per Google Cloud project: 10,000 units = ~6 uploads/day
- For Al-Himmah weekly khutbahs (~2 uploads/week) this is fine
- For pilot at 100 users, may need quota raise (usually granted for legitimate use)

### 7.6.5 Multi-account upload orchestration

For each part being published:

1. Determine the target account set:
   - Manual: user-selected accounts on the Upload screen
   - Auto-pilot: every account with `autoPublish: true`
2. For each `(part, account)` pair:
   - Resolve effective metadata: shared metadata, with per-account overrides applied if present (override fields: `titleTemplateOverride`, `descriptionTemplateOverride`, `tagsOverride`, `defaultVisibilityOverride`)
   - Apply title/description templates with the account-specific render context
   - Resolve target playlist (see §7.7)
   - Initiate resumable upload (§7.3)
   - Set thumbnail (§7.4)
   - Add to playlist (§7.7)
3. Render per-pair progress in the UI as a matrix:
   - Rows: Part 1, Part 2
   - Columns: Account A, Account B, …
   - Each cell shows progress bar + final video link

**Failure isolation:** an upload failure in one `(part, account)` pair does not abort other pairs. Each runs independently; failures are surfaced per cell with retry option.

### 7.7 Playlist management

Each account record may carry a `defaultPlaylistId`. On upload:

1. If `defaultPlaylistId` is set: use it directly.
2. Else if the upload screen has a per-upload playlist override: use that.
3. Else: skip playlist (video uploaded but not added to any playlist).

**Playlist resolution at upload time** (Python sidecar):

```python
# python-pipeline/khutbah_pipeline/upload/playlists.py — sketch
def resolve_or_create_playlist(access_token, channel_id, requested_name_or_id, *, auto_create=True, visibility='unlisted'):
    """If requested_name_or_id looks like a playlist ID (starts with 'PL'), use directly.
       Otherwise treat as a name: list user's playlists, find a match.
       If no match and auto_create=True, create a new playlist on this channel."""
    if requested_name_or_id.startswith('PL'):
        return requested_name_or_id
    # List existing
    existing = list_playlists_for_channel(access_token)
    match = next((p for p in existing if p['snippet']['title'].lower() == requested_name_or_id.lower()), None)
    if match:
        return match['id']
    if not auto_create:
        return None
    return create_playlist(access_token, requested_name_or_id, visibility=visibility)
```

**Add to playlist:**
```
POST https://www.googleapis.com/youtube/v3/playlistItems?part=snippet
{
  "snippet": {
    "playlistId": "PLxxxxxx",
    "resourceId": { "kind": "youtube#video", "videoId": "<uploaded video id>" }
  }
}
```

**Quota cost:** `playlists.list` = 1 unit, `playlists.insert` = 50 units, `playlistItems.insert` = 50 units. Per upload total adds ~50-100 units on top of the 1700-unit upload — easily within the 10K/day quota.

### 7.7.5 Settings screen extensions for multi-account + playlists

In the **Accounts** section of Settings, each account row shows:

```
[avatar] Al-Himmah NL                                    [Sign out]
         channel: UCxxxxx · signed in 2 weeks ago
         Default playlist:  [Vrijdagkhutbah 2026 ▾]   [+ create new]
         Auto-publish:      [✓]   include in auto-pilot uploads
         Override metadata: [Configure templates →]   per-account title/desc/tags/visibility
```

Plus a global `[+ Add account]` button that triggers the multi-account OAuth flow.

A global toggle: **Auto-create missing playlists** (default ON) — controls whether the app creates a playlist on a channel if the configured name doesn't exist there.

### 7.8 Error matrix

| Status | Action |
|--------|--------|
| 401 | Refresh access_token, retry once |
| 403 quotaExceeded | Surface "Daily upload limit reached, retry tomorrow" with YouTube Studio link |
| 403 forbidden (other) | Re-auth with consent prompt |
| 5xx | Exponential backoff (1s, 2s, 4s, 8s, 16s) up to 5 retries |
| Network drop mid-upload | Resumable upload handles automatically |

## 8. Packaging & distribution

### 8.1 electron-builder configuration

```json
{
  "appId": "nl.alhimmah.khutbaheditor",
  "productName": "KhutbahEditor",
  "extraResources": [
    { "from": "resources/bin/${os}/${arch}",             "to": "bin"            },
    { "from": "resources/models/whisper-large-v3.bin",   "to": "models"         },
    { "from": "resources/python-pipeline/${os}/${arch}", "to": "python-pipeline"}
  ],
  "mac": { "target": [{ "target": "dmg", "arch": ["x64", "arm64"] }],
           "category": "public.app-category.video" },
  "win": { "target": [{ "target": "nsis", "arch": ["x64"] }] },
  "linux": { "target": [
              { "target": "AppImage", "arch": ["x64"] },
              { "target": "deb",      "arch": ["x64"] }
            ],
            "category": "AudioVideo" }
}
```

### 8.2 Build artifacts (per release)

- `KhutbahEditor-X.Y.Z-mac-x64.dmg`
- `KhutbahEditor-X.Y.Z-mac-arm64.dmg`
- `KhutbahEditor-X.Y.Z-win-x64.exe`
- `KhutbahEditor-X.Y.Z-linux-x64.AppImage`
- `KhutbahEditor-X.Y.Z-linux-x64.deb`

All ~3.3-3.4 GB (dominated by Whisper model).

### 8.3 Code signing — NOT used

App ships unsigned on all platforms. README documents the bypass:

- **macOS:** right-click the `.app` → Open → Open in confirmation dialog (one time per app)
- **Windows:** click "More info" on SmartScreen warning → "Run anyway"
- **Linux AppImage:** `chmod +x KhutbahEditor-X.Y.Z-linux-x64.AppImage` then double-click

### 8.4 CI/CD

GitHub Actions matrix on tagged releases:
```yaml
matrix:
  os: [macos-13, macos-14, windows-2022, ubuntu-22.04]
```

Each runner builds, packages, uploads to GitHub Release. No signing or notarization steps.

### 8.5 Auto-update

`electron-updater` reads from GitHub Releases. App checks on launch, downloads in background, prompts to install on next quit.

### 8.6 Privacy & legal

- Privacy policy hosted at `alhimmah.nl/khutbaheditor/privacy` (required for OAuth verification when we eventually pursue it)
- Basic terms of service
- GDPR: no remote data collection. Only OAuth refresh token in OS keychain. All media stays on user's machine.

## 9. Implementation phasing

| Phase | Scope | Time |
|-------|-------|------|
| **0. Skeleton** | Electron + Vite + React + TypeScript + Tailwind boilerplate, Python sidecar with stub JSON-RPC, electron-builder config producing unsigned dev builds for all 3 OSes, CI scaffold | 3-5 days |
| **1. Local file → manual editor → local export** | Library + Editor + Settings UIs (Cinzel/Open Sans/Amiri integrated), HTML5 preview with proxy generation, manual marker placement, FFmpeg cut + EBU R128 normalization. Ships an offline editor. | 1.5 weeks |
| **2. Auto-detection** | Bundle Whisper large-v3, faster-whisper integration, multilingual phrase matching (AR/NL/EN), silence detection, confidence scoring. Editor opens pre-marked. | 1.5 weeks |
| **3. YouTube ingest + upload** | yt-dlp integration, OAuth loopback flow, resumable upload, thumbnail picker (auto scene-extraction), full upload screen with metadata templates and made-for-kids toggle | 1 week |
| **4. Auto-pilot + dual-file + Settings** | Auto-pilot mode (skip editor at ≥90 % confidence), Settings with all template defaults, dual-file alignment (FFT cross-correlation), OS-native completion notifications | 1 week |
| **5. Cross-platform builds, polish, ship** | Linux AppImage + .deb targets verified, README with bypass instructions, error/empty states, README + user docs, brand polish pass, auto-updater | 1 week |

**Total: ~6-8 weeks** for one experienced full-time engineer; ~4-5 weeks for two engineers in parallel.

## 10. Out of scope (for v1)

- Multi-mosque / multi-tenant features
- Speaker identification / multiple khatib profiles
- Subtitle generation / SRT export (Whisper transcripts could enable this in a later version)
- Live streaming / real-time processing
- iOS / Android apps
- Apple App Store / Microsoft Store distribution
- Custom intro / outro overlays
- Color correction / image enhancement
- Watermarking
- Web-based version

## 11. Defaults (configurable in Settings)

These are the chosen defaults — all overridable in Settings, but the app ships with these out of the box:

| Setting | Default | Notes |
|---------|---------|-------|
| **Default visibility** | **Unlisted** | Safest first publish; user can flip to Public per-upload from the upload screen, or change the global default in Settings |
| **Khatib name** | empty | Lives in Settings as a single text field; if set, fills the `{khatib}` placeholder in title/description templates. If empty, placeholder is silently dropped from output. Not auto-detected. |
| **Output folder** | `~/Movies/KhutbahEditor/{YYYY-MM-DD}/` (macOS), `~/Videos/KhutbahEditor/{YYYY-MM-DD}/` (Windows + Linux) | Configurable. The dated subfolder ensures multiple runs on the same day don't overwrite each other. |
| **Auto-pilot** | **ON** | Default behavior is paste URL / pick file → walk away → desktop notification when both parts are uploaded. Toggle in Settings to switch to "always open Editor for review". |
| **Default category** | Education (YouTube category id 27) | Most appropriate for religious educational content |
| **Default tags** | `khutbah, friday, sermon, jumma, alhimmah` (plus per-language: `arabisch`/`nederlands`/`english`) | Editable in template |
| **Title template** | `Khutbah {date} — Deel {n}{lang_suffix}` where `{lang_suffix}` expands to ` (Arabisch)`, ` (Nederlands)`, ` (English)`, or empty if Part 2 dominant lang matches Part 1 | |
| **Description template** | Multi-line (see Section 6.2 Upload screen mockup), includes cross-link to the other part's URL after both upload | Editable in Settings |
| **Made-for-kids** | `false` (No) | Khutbahs are general adult religious content. COPPA-required field. |
| **Auto-create missing playlists** | `true` | When a configured playlist name doesn't exist on a channel, create it automatically rather than failing the upload. Disable for stricter behavior. |
| **Default account auto-publish flag** | `true` for the first account added, `false` for subsequently added accounts | Auto-pilot uploads to every account where this is `true`. Edit per-account in Settings → Accounts. |
| **Per-upload "Customize per account" toggle default** | `OFF` (shared metadata) | Upload screen starts with one shared metadata form; user opts in to per-account override only when needed. |
| **Whisper model** | `large-v3` (bundled, ~3 GB) | No alternative offered initially; Settings exposes a "model info" page only |
| **Audio normalization** | -14 LUFS / -1 dBTP / 11 LU | YouTube standard. Configurable for users who upload to other platforms. |
| **Silence threshold (sitting)** | 1.5 s @ -35 dBFS | Configurable in Advanced Settings |
| **Min Part 1 duration** | 5 minutes | Sanity guard — silences before this don't count as the sitting moment |

## 12. Supported input formats

**Video containers:** `.mp4`, `.mov`, `.mkv`, `.webm`, `.avi`, `.flv`, `.wmv` — anything FFmpeg can demux.

**Audio-only files (for the audio-side of dual-file mode):** `.wav`, `.mp3`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus`.

**YouTube URLs:** any URL `yt-dlp` recognizes — full videos, shorts (technically supported but unlikely for khutbahs), unlisted videos (if user has access), playlist URLs are rejected (single video only).

**Validation:** at ingest time, `ffprobe` confirms the file has at least one audio stream of usable length (≥ 30 s). Anything shorter or with no audio is rejected with a clear error.

## 13. Test fixtures

**First test khutbah** (committed for Phase 2 validation): `https://www.youtube.com/watch?v=whrEDiKurFU` — used as the canonical regression case for detection accuracy.

## 14. Items the user should confirm during spec review

- The defaults table in Section 11 looks right (especially: Unlisted as default visibility, ON as default auto-pilot, output folders)
- The YouTube channel that Phase 3 OAuth will sign into for upload testing
- The Frequence-xx Google Cloud project will be created and OAuth client credentials provisioned before Phase 3 begins (this is a one-time setup outside the app code)

## 15. Repository

`git@github.com:Frequence-xx/KhutbahEditor.git` — local working copy initialized in `/home/farouq/Development/alhimmah/`. Remote `origin` to be added in Phase 0 setup.
