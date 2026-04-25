# KhutbahEditor

A self-contained desktop app to edit and publish Friday khutbah videos to YouTube.

## Status

Phase 0 (Skeleton) — actively in development. Not yet usable.

## Development

Prerequisites: Node 20, Python 3.11, FFmpeg available on PATH (only needed in dev — bundled in releases).

```bash
git clone git@github.com:Frequence-xx/KhutbahEditor.git
cd KhutbahEditor

# Set up the Python sidecar
cd python-pipeline && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cd ..

# Set up the Node app
npm install

# Run in dev (Vite + Electron together)
npm run dev:full
```

## Project structure

See `docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md` for the full file map and implementation roadmap, and `docs/superpowers/specs/2026-04-25-khutbah-editor-design.md` for the locked design.

## Contributing

See `docs/CONTRIBUTING.md`.

## License

MIT
