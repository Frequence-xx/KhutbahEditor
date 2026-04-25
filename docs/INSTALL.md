# Installing KhutbahEditor

KhutbahEditor ships unsigned, so each OS shows a one-time security warning. Here's how to bypass each.

## macOS (.dmg)

1. Download `KhutbahEditor-X.Y.Z-mac-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel) from the [Releases page](https://github.com/Frequence-xx/KhutbahEditor/releases).
2. Open the DMG and drag KhutbahEditor.app into your Applications folder.
3. **First launch only:** right-click (or Control-click) KhutbahEditor.app → click **Open** → confirm in the dialog.
4. After this, double-click works normally.

If macOS still blocks: System Settings → Privacy & Security → scroll to the "KhutbahEditor was blocked..." message → click **Open Anyway**.

## Windows (.exe)

1. Download `KhutbahEditor-X.Y.Z-win-x64.exe` from the [Releases page](https://github.com/Frequence-xx/KhutbahEditor/releases).
2. Double-click. Windows SmartScreen will warn "Windows protected your PC".
3. Click **More info** → **Run anyway**.
4. The installer wizard will guide you the rest of the way.

## Linux

### AppImage (universal)

1. Download `KhutbahEditor-X.Y.Z-linux-x64.AppImage`.
2. Make it executable:
   ```bash
   chmod +x KhutbahEditor-*.AppImage
   ```
3. Double-click or run from terminal.

### Debian/Ubuntu (.deb)

```bash
sudo dpkg -i KhutbahEditor-X.Y.Z-linux-x64.deb
sudo apt install -f   # if dependencies missing
```

## After install

The app is ~3.4 GB on disk because it bundles:

- The Whisper large-v3 multilingual speech recognition model (~3 GB)
- FFmpeg, ffprobe, and yt-dlp binaries (~150 MB)

This is intentional — KhutbahEditor runs fully offline for video processing.

## Linux note: keychain access

KhutbahEditor stores your YouTube refresh token in your OS keychain (libsecret on Linux, Keychain Access on macOS, Credential Manager on Windows). On Linux, libsecret provides per-user encryption but does NOT isolate access between applications running as the same user. Treat this app like any other Linux app you'd trust with API tokens — don't run it alongside untrusted software.

## Auto-updates

KhutbahEditor checks for updates on launch via [electron-updater](https://www.electron.build/auto-update). If a new version is available, you'll see a prompt to install it on next quit.
