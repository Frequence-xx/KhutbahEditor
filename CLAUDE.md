# KhutbahEditor — Claude Developer Guide

Self-contained cross-platform desktop app (macOS .dmg, Windows .exe, Linux .AppImage/.deb) for editing Friday khutbah videos and publishing them to YouTube.

> **Required reading before any work:**
> - [docs/superpowers/specs/2026-04-25-khutbah-editor-design.md](docs/superpowers/specs/2026-04-25-khutbah-editor-design.md) — locked design spec
> - [docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md](docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md) — implementation plan (46 TDD tasks across 6 phases)
> - [AGENTS.md](AGENTS.md) — review persona + test policy + quality gates

---

## 🛠️ DEVELOPMENT WORKFLOW (MANDATORY)

1. **Read the plan first.** Find your task in `docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md`. The plan is authoritative — every task lists files, code, commands, and the commit message.
2. **TDD-strict.** For every task with a test step: write the failing test, run it, confirm it fails for the right reason, *then* implement.
3. **One task at a time.** Complete the current task (including the commit step) before moving to the next.
4. **Commit per task.** Use the commit message provided in the plan. Conventional-commit style (`feat(scope): …`, `fix(scope): …`, etc.). Don't batch multiple tasks into one commit.
5. **Trust but verify.** After any change — yours or a subagent's — run `git diff` and read the actual code. A summary describes intent, not what the file actually contains.
6. **DO NOT BE LAZY. NEVER BE LAZY.** Find root causes and fix them. No temporary fixes, no `// TODO: handle this later`, no swallowed errors.
7. **Don't deviate from the plan without escalation.** If you think a task is wrong, *say so* and propose the change — don't silently implement something different.

---

## ❌ ANTI-SYCOPHANCY (MANDATORY)

This project rejects sycophantic behavior. Read this carefully:

### Banned filler phrases

Do not write or speak any of these (or close paraphrases):
- "Good question" / "Great question" / "Excellent question"
- "Got it" / "Sure thing" / "Absolutely" / "Of course"
- "You're right" (use only if you've verified — and even then prefer "Verified — you're right because X")
- "I'd be happy to" / "I'd love to"
- "That's a great point" / "Excellent point" / "Nice catch" / "Good catch"
- "Let me know if…" (when the next step is obvious)
- Trailing summaries that just restate the diff ("To summarize, I added X, Y, Z…")
- Apologies for things that aren't your fault ("Sorry for the confusion")

### Required posture

- **Be direct.** State what you did, what you found, what's broken. No softening.
- **Disagree when you have a substantive reason.** If a request is technically wrong, say so and explain why. The user prefers a corrected plan over a polite agreement.
- **Push back on bad ideas.** "That will break X because Y. I recommend Z instead." Better than implementing the bad idea silently.
- **One short status line per major step.** "Done. Test passing. Committed as `abc1234`." — not three paragraphs.
- **Don't restate the user's request before answering.** Just answer.
- **End-of-turn summary**: one or two sentences. What changed, what's next. Not a recap.

### When to use affirmation

If something is genuinely correct or well-done, *describe what's good* concretely instead of generic praise:
- ❌ "Great refactor!"
- ✅ "The new `SidecarManager.start()` correctly handles the startup-timeout race that the previous version missed."

---

## Quick Reference

| Aspect | Details |
|--------|---------|
| **Stack** | Electron 30 + Vite 5 + React 18 + TypeScript 5 + Tailwind 3 + Python 3.11 + faster-whisper + FFmpeg + yt-dlp |
| **Status** | Pre-implementation. Spec + plan committed. Phase 0 not started. |
| **Languages handled** | Arabic (Part 1 always), Dutch + English (Part 2 sometimes) |
| **i18n in UI** | English (interface), Arabic strings displayed as content |
| **Distribution** | Unsigned, direct download, auto-updater via GitHub Releases |

### Critical Policies

- **Test timeout**: 300 s max for any test suite; 30 s per individual test (matches our `vitest.config.ts` and `pytest.ini`)
- **Documentation**: DO NOT create new `.md` files in the repo unless the plan or user explicitly requests one. Use existing files (`CLAUDE.md`, `AGENTS.md`, `README.md`, the spec, the plan).
- **No mocks of FFmpeg/Whisper in unit tests.** They're integration boundaries — test the wrapper logic against the real binaries with small fixture clips. Mock only at the RPC seam between Electron and Python.
- **Brand tokens come from `tailwind.config.js`** — never hard-code hex values, fonts, or font-sizes in components.
- **TypeScript strict mode is non-negotiable.** Every file compiles with `strict: true`, `noUnusedLocals`, `noUnusedParameters`.
- **Python type hints** on all function signatures in `python-pipeline/khutbah_pipeline/`.
- **No silent error swallowing.** Every `try`/`except` must either re-raise, log, or surface to the renderer.

---

## Build Commands

### Renderer + Electron (Node side)
```bash
npm run dev          # Vite dev server only (port 5173)
npm run dev:full     # Vite + Electron together (waits for Vite then launches Electron)
npm run build        # build:web + build:electron
npm test             # Vitest run (300 s timeout)
npm run test:e2e     # Playwright e2e
npm run lint         # ESLint
npm run format       # Prettier write
npm run package      # electron-builder for current host OS
npm run package:dir  # electron-builder unpacked (no installer, fast)
```

### Python sidecar
```bash
cd python-pipeline
source .venv/bin/activate           # macOS / Linux
# or .venv\Scripts\activate         # Windows
pytest -v                            # all tests
pytest tests/test_X.py -v            # one file
pytest --timeout=30                  # enforce per-test timeout (configured in pytest.ini)
ruff check .                         # lint
ruff format .                        # format
pyinstaller --noconfirm khutbah_pipeline.spec   # bundle the sidecar binary
```

### Resource fetcher (one-time per dev machine + per CI run)
```bash
bash resources/fetch-resources.sh "$(uname -s)" "$(uname -m | sed 's/x86_64/x64/')"
```

---

## Architecture (one-paragraph version)

Three layers in one Electron app: **(1) Electron main process** — window management, native menus, file/dialog/notification handlers, OAuth loopback flow, OS-keychain refresh-token storage via `keytar`, supervises the Python sidecar lifecycle. **(2) React renderer** — Vite + TypeScript + Tailwind, single window, screens routed via local state, all heavy work delegated via `window.khutbah.pipeline.call(method, params)`. **(3) Python sidecar** — long-running child process started at app launch, JSON-RPC over stdio, modules: `ingest/` (yt-dlp + ffprobe), `align/` (FFT cross-correlation), `detect/` (faster-whisper + multilingual phrase library + silence detection), `edit/` (FFmpeg smart-cut + EBU R128 loudnorm + thumbnail extraction), `upload/` (YouTube Data API v3 with resumable uploads).

Full architecture in `docs/superpowers/specs/2026-04-25-khutbah-editor-design.md`, sections 3 and 4.

---

## Locked design decisions (don't re-litigate)

| Decision | Choice |
|----------|--------|
| Speech recognition | Bundled `faster-whisper` `large-v3` (~3 GB), multilingual |
| Stack | Electron + Vite + React + TypeScript + Tailwind + Python sidecar |
| UI | "Dignified Dark" — `#0C1118`/`#1A2332` + amber `#E8B73C` + green `#7BA05B` |
| Fonts | Cinzel (display) + Open Sans (body) + Amiri (Arabic) — all OFL/Apache 2.0 |
| Audio | -14 LUFS / -1 dBTP / 11 LU (EBU R128, two-pass loudnorm) |
| YouTube auth | Shared OAuth client (Frequence-xx Google Cloud), loopback redirect, PKCE |
| Distribution | Unsigned on all platforms, README documents per-OS bypass |
| Auto-pilot | ON by default; Editor opens only when confidence < 90 % |

If you have a substantive technical reason to revisit one of these, surface it as a discussion, don't quietly change it.

---

## Git Conventions

### Commit format
```
<type>(<scope>): <subject>

<body — what changed, why>

Co-Authored-By: <agent or human>
```

**Types**: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`

### Branches
- `main`: only working code, all tests passing locally
- Feature branches optional for solo dev; mandatory if more than one engineer

### Per-task commits
The plan provides a commit message for every task. Use it. If you deviate, justify in the body.

---

## Common Workarounds

**Python sidecar fails to start in dev:**
```bash
cd python-pipeline && source .venv/bin/activate && pip install -e ".[dev]"
```

**Vitest can't find `electron` module:**
The Electron module is mocked in `tests/setup.ts`. If a test imports from `electron/...` it should run in node env, not jsdom — check `vitest.config.ts`.

**`keytar` build fails on Windows:**
Install Windows Build Tools: `npm install --global windows-build-tools` (one-time, admin shell).

**Whisper model not found in dev:**
Run `bash resources/fetch-resources.sh` once. It downloads to `resources/models/whisper-large-v3/` (~3 GB, gitignored).

**Port 5173 in use:**
```bash
lsof -ti:5173 | xargs kill -9   # Mac/Linux
# Windows: netstat -ano | findstr :5173 then taskkill /PID <pid> /F
```

---

## Documentation Links

| Category | File |
|----------|------|
| **Spec (locked design)** | [docs/superpowers/specs/2026-04-25-khutbah-editor-design.md](docs/superpowers/specs/2026-04-25-khutbah-editor-design.md) |
| **Implementation plan** | [docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md](docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md) |
| **Reviewer persona + test policy** | [AGENTS.md](AGENTS.md) |
| **Install / bypass per OS** | [docs/INSTALL.md](docs/INSTALL.md) (created in Phase 5) |
| **Usage guide** | [docs/USAGE.md](docs/USAGE.md) (created in Phase 5) |
| **Privacy** | [docs/PRIVACY.md](docs/PRIVACY.md) (created in Phase 5) |
| **Resume work** | [docs/RESUME.md](docs/RESUME.md) — context-restoration prompt for fresh sessions |
