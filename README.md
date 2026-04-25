# KhutbahEditor

Self-contained desktop app to edit and publish Friday khutbah videos to YouTube.

- 📥 [Install instructions](docs/INSTALL.md)
- 📖 [Usage guide](docs/USAGE.md)
- 🔒 [Privacy](docs/PRIVACY.md)
- 🛠 [Contributing](docs/CONTRIBUTING.md)

## Status

v1.0.0 — first stable release. Cross-platform (macOS, Windows, Linux), unsigned. See [INSTALL.md](docs/INSTALL.md) for one-time per-OS bypass instructions.

## Features

- **Auto-pilot**: paste YouTube URL or pick local file → walk away → both parts published to YouTube with thumbnails, metadata, and notifications when complete
- **Multilingual**: Arabic / Dutch / English detection via bundled Whisper large-v3 (offline, no API calls)
- **Multi-account**: configure N YouTube channels per install; auto-pilot uploads to every "auto-publish" account
- **Audio normalization**: EBU R128 / -14 LUFS for YouTube standard
- **Dual-file mode**: FFT-align separate audio/video tracks (lapel mic + camera) before processing
- **Privacy-first**: all media stays on your machine. Only YouTube uploads + OAuth go to the network.

## Development

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for setup + the implementation plan in `docs/superpowers/plans/`.

## License

MIT
