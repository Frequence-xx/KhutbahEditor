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

Add multiple YouTube channels in **Settings → Accounts → + Add account**. Auto-pilot uploads to every channel marked "auto-publish" simultaneously, with per-channel metadata templates if you've configured overrides.

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

- **"Detection confidence below 90%"**: detection failed on this khutbah. The Editor opens with markers pre-placed at sensible defaults — drag them to the right positions and click Upload manually.

- **"App is not verified — only test users allowed"**: your Google account isn't on the OAuth consent screen's test-users list. Contact the app administrator (alhimmah.nl) to be added.
