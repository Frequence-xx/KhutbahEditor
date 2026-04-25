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

KhutbahEditor supports publishing the same khutbah to multiple YouTube channels in one workflow.

### Adding accounts

In **Settings → Accounts**:
- Click **+ Add account** to sign in with another Google account / channel.
- Each account row shows the channel name + ID, an **auto-publish** toggle (include this account in auto-pilot uploads), a **default playlist** field (name or `PL…` ID), and a **Sign out** button.
- The first account added has auto-publish ON by default; subsequent accounts default to OFF.

### Auto-pilot

Auto-pilot uploads to every account marked **auto-publish**. Per-account default playlists are resolved (or created, if missing and the global "Auto-create missing playlists" toggle is ON).

### Manual upload

The Upload screen shows account selector chips at the top — toggle which accounts to publish this khutbah to (defaults to your auto-publish set). Below, choose between:
- **Shared metadata** (default) — one title/description/tags/visibility/thumbnail per part, applied to all selected accounts.
- **Customize per account** — separate metadata + playlist per (account, part) pair, useful when one channel is Dutch-language and another is Arabic.

Upload progress shows as a matrix: rows are Part 1 / Part 2, columns are each selected account, with a per-cell progress bar. A failure in one cell does not abort the others.

### Per-account template overrides

Each account row in Settings can override the global title/description/tags/visibility templates — useful for a Dutch-only channel that needs a Dutch-only description while another channel uses the global Arabic+Dutch template.

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
