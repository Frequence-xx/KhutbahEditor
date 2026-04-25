# Privacy

KhutbahEditor processes everything locally on your machine. No video, audio, or metadata leaves your device except:

1. **YouTube uploads** — only when you initiate them, only to the YouTube account(s) you sign in with.
2. **YouTube downloads** — only when you paste a YouTube URL.
3. **OAuth refresh tokens** — stored encrypted in your operating system's keychain (macOS Keychain Access, Windows Credential Manager, Linux Secret Service via libsecret). Never sent to any server other than Google's OAuth endpoints.
4. **Auto-update checks** — on launch, the app contacts GitHub Releases to check for updates. No personal information is sent.

We do not run any servers, do not collect telemetry, do not have an analytics pipeline.

## What we store on your device

- Settings (your preferences) — `~/.config/KhutbahEditor/` or platform equivalent
- OAuth refresh tokens — OS keychain, one entry per signed-in YouTube channel
- Library metadata — same settings dir
- Output videos — `~/Movies/KhutbahEditor/` (Mac) or `~/Videos/KhutbahEditor/` (Windows/Linux)
- Whisper model + binaries — inside the app bundle

## Removing all data

Uninstall the app, then:

- Delete `~/Movies/KhutbahEditor/` (or your custom output dir)
- Delete `~/.config/KhutbahEditor/` (Mac/Linux) or `%APPDATA%\KhutbahEditor\` (Windows)
- Open KhutbahEditor's Settings → Sign Out before uninstalling, OR manually clear "KhutbahEditor" entries from your OS keychain

## Privacy policy

A formal privacy policy is hosted at https://alhimmah.nl/khutbaheditor/privacy (required for OAuth verification). The policy mirrors this document.

## Linux note: same-user keychain access

On Linux, libsecret encrypts data with the user's login keyring but does not provide per-application isolation. Other applications running as the same user CAN read KhutbahEditor's stored tokens once the keyring is unlocked. Treat your KhutbahEditor session like any other authenticated app — sign out when you're done if you share the machine.
