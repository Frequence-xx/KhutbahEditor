# Using KhutbahEditor

## Quick start (auto-pilot)

1. Open KhutbahEditor.
2. First time: sign in with Google (one-time per machine, stored in OS keychain).
3. Click **+ New Khutbah** → paste a YouTube URL or pick a local video file → click Start.
4. Walk away. The app downloads (if needed), transcribes, detects boundaries, exports two normalized .mp4 files, and uploads both to YouTube.
5. You'll get a desktop notification when both parts are live.

## What auto-pilot does

For each khutbah:

- Detects when the khatib starts with `إن الحمد لله` (start of Part 1)
- Detects the sitting silence (end of Part 1 / start of Part 2)
- Detects the end of the dua (end of Part 2)
- Cuts both parts with frame-accurate boundaries
- Normalizes audio to YouTube's loudness standard (-14 LUFS)
- Uploads with title, description, tags, thumbnail (auto-picked scene-change frame), and visibility (default: Unlisted)

## Multi-account uploads

Auto-pilot supports multi-account uploads — sign in with multiple YouTube channels (each new sign-in adds an account record), and auto-pilot will publish both parts to every account marked `autoPublish: true`.

For v1, the multi-account UI in Settings is simplified:
- The Welcome / Sign-in flow adds the first account with `autoPublish: true`.
- Subsequent accounts (added by signing in again with a different Google account) start with `autoPublish: false`.
- To toggle auto-publish per account, edit `~/.config/KhutbahEditor/youtube-accounts.json` directly.
- The manual Upload screen uploads to the first signed-in account only.

A Settings → Accounts UI panel with per-account configuration (auto-publish toggles, default playlists, metadata template overrides) ships in v1.1.

## Manual review

If detection confidence is below 90 %, the app opens the Editor with markers pre-placed. Drag any marker to fine-tune, preview, then click **Upload to YouTube**.

## Dual-file mode

Use **+ New Khutbah → Dual file** when you have a separate audio recording (e.g., lapel mic) alongside camera video. KhutbahEditor will FFT-align the audio to the video, mux them into a single source, then continue with the normal flow.

## Settings

Open the gear icon (top-right) to configure:

- Title, description, and tag templates
- Default visibility (Public / Unlisted / Private)
- Khatib name
- Audio normalization target
- Auto-pilot on/off

## Troubleshooting

- **"Sign-in expired" toast**: in Testing-mode OAuth (which KhutbahEditor v1 uses), Google's refresh tokens expire after 7 days. Re-authenticate in Settings → Accounts. v2 will move to Production-mode OAuth (long-lived refresh tokens) after Google's app verification process.

- ```token_expired:401``` during a single upload: if your access token expires DURING a resumable upload (long videos on slow connections), the upload surfaces ```token_expired:401``` and stops. v1 does not transparently refresh mid-upload; v1.1 will. Workaround: retry the upload from the Library — auto-pilot fetches a fresh token at the start of each upload, and tokens are valid for 1 hour, so on a typical connection a single khutbah part fits within one token lifetime.

- **"Detection confidence below 90%"**: detection failed on this khutbah. The Editor opens with markers pre-placed at sensible defaults — drag them to the right positions and click Upload manually.

- **"App is not verified — only test users allowed"**: your Google account isn't on the OAuth consent screen's test-users list. Contact the app administrator (alhimmah.nl) to be added.
