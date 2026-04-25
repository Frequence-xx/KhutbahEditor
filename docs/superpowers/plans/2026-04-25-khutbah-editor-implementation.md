# KhutbahEditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build KhutbahEditor — a self-contained cross-platform desktop app (macOS .dmg, Windows .exe, Linux .AppImage/.deb) that ingests a khutbah recording (YouTube URL or local media file), auto-detects the two khutbah parts using bundled multilingual Whisper, normalizes audio to YouTube standard, and uploads both parts with full metadata + thumbnails to YouTube.

**Architecture:** Electron shell (Node.js main process) + React renderer (Vite + TypeScript + Tailwind) + Python sidecar (long-running child process, JSON-RPC over stdio) carrying FFmpeg, yt-dlp, and bundled `faster-whisper` large-v3 model. Auto-pilot is the default workflow; the visual editor is a confirmation surface for the rare exception.

**Tech Stack:** Node.js 20 / Electron 30 / Vite 5 / React 18 / TypeScript 5 / Tailwind 3 / Python 3.11 / faster-whisper / FFmpeg 6 / yt-dlp / electron-builder / Vitest / Playwright / Pytest / GitHub Actions

**Spec:** `docs/superpowers/specs/2026-04-25-khutbah-editor-design.md`

---

## File Structure (target end-state)

```
alhimmah/
├── .github/workflows/build.yml             # Cross-platform CI matrix
├── assets/
│   ├── fonts/                              # Cinzel, Open Sans, Amiri (.ttf)
│   ├── icons/                              # icon.icns, icon.ico, icon.png
│   └── logo.png                            # Already present
├── electron/                               # Main process
│   ├── main.ts                             # App entry, window mgmt
│   ├── preload.ts                          # contextBridge to renderer
│   ├── menu.ts                             # Native menus
│   ├── sidecar/
│   │   ├── manager.ts                      # Spawn/supervise Python sidecar
│   │   └── rpc.ts                          # JSON-RPC client over stdio
│   ├── auth/
│   │   ├── youtube-oauth.ts                # OAuth loopback flow
│   │   └── keychain.ts                     # keytar wrapper
│   └── ipc/
│       ├── handlers.ts                     # Renderer → main IPC handlers
│       └── types.ts                        # Shared IPC type definitions
├── src/                                    # React renderer
│   ├── main.tsx                            # React entry
│   ├── App.tsx                             # Router root
│   ├── styles/
│   │   ├── globals.css                     # Tailwind + @font-face + theme tokens
│   │   └── theme.ts                        # Color/spacing tokens
│   ├── components/
│   │   ├── ui/                             # Button, Input, Toggle, Pill, etc.
│   │   ├── TitleBar.tsx
│   │   ├── Logo.tsx
│   │   └── ArabicText.tsx                  # RTL Amiri wrapper
│   ├── screens/
│   │   ├── Library.tsx
│   │   ├── NewKhutbah.tsx
│   │   ├── Processing.tsx
│   │   ├── Editor.tsx
│   │   ├── Upload.tsx
│   │   └── Settings.tsx
│   ├── editor/
│   │   ├── Timeline.tsx                    # Waveform + segments
│   │   ├── Marker.tsx                      # Draggable marker
│   │   ├── PartInspector.tsx
│   │   └── VideoPreview.tsx
│   ├── upload/
│   │   ├── ThumbnailPicker.tsx
│   │   ├── MetadataForm.tsx
│   │   └── UploadProgress.tsx
│   ├── hooks/
│   │   ├── useIpc.ts
│   │   ├── usePipeline.ts
│   │   └── useAuth.ts
│   ├── store/                              # Zustand stores
│   │   ├── projects.ts
│   │   ├── settings.ts
│   │   └── currentProject.ts
│   └── lib/
│       ├── time.ts                         # Format timestamps
│       ├── language.ts                     # AR/NL/EN helpers
│       └── templates.ts                    # Title/desc placeholder substitution
├── python-pipeline/
│   ├── pyproject.toml
│   ├── khutbah_pipeline.spec               # PyInstaller spec
│   ├── khutbah_pipeline/
│   │   ├── __init__.py
│   │   ├── __main__.py                     # Entry: starts JSON-RPC server
│   │   ├── rpc.py                          # JSON-RPC over stdio
│   │   ├── ingest/
│   │   │   ├── youtube.py                  # yt-dlp wrapper
│   │   │   └── local.py                    # ffprobe wrapper
│   │   ├── align/
│   │   │   └── crosscorr.py                # FFT cross-correlation
│   │   ├── detect/
│   │   │   ├── transcribe.py               # faster-whisper wrapper
│   │   │   ├── phrases.py                  # Multilingual phrase library
│   │   │   ├── normalize_arabic.py         # Diacritic strip etc.
│   │   │   ├── silence.py                  # FFmpeg silencedetect parser
│   │   │   └── pipeline.py                 # 7-stage orchestrator
│   │   ├── edit/
│   │   │   ├── loudnorm.py                 # Two-pass EBU R128
│   │   │   ├── smartcut.py                 # Stream-copy + re-encode hybrid
│   │   │   └── thumbnail.py                # Scene-extraction
│   │   ├── upload/
│   │   │   ├── youtube_api.py              # API client
│   │   │   └── resumable.py                # Resumable upload
│   │   └── util/
│   │       ├── ffmpeg.py                   # subprocess wrapper
│   │       └── progress.py                 # Progress event emitter
│   └── tests/
│       ├── conftest.py
│       ├── fixtures/
│       │   └── short_khutbah.mp4           # 60 s sample for fast tests
│       └── test_*.py
├── resources/                              # gitignored bundled binaries
│   ├── bin/                                # ffmpeg, ffprobe, yt-dlp per OS
│   ├── models/                             # whisper-large-v3.bin
│   └── fetch-resources.sh                  # Setup script
├── tests/                                  # TS-side tests
│   ├── electron/
│   └── e2e/
├── docs/
│   ├── README.md
│   ├── INSTALL.md                          # Per-OS install + bypass instructions
│   ├── USAGE.md
│   ├── PRIVACY.md
│   └── superpowers/
│       ├── specs/2026-04-25-khutbah-editor-design.md
│       └── plans/2026-04-25-khutbah-editor-implementation.md  ← this file
├── .gitignore
├── .nvmrc                                  # 20
├── .python-version                         # 3.11
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── electron-builder.json
├── eslint.config.js
├── prettier.config.js
├── vitest.config.ts
├── playwright.config.ts
└── README.md
```

---

## Setup Prerequisites

Engineer must have installed locally before starting:
- Node.js 20 (use `nvm install 20 && nvm use 20`)
- Python 3.11 (use `pyenv install 3.11 && pyenv local 3.11`)
- Git
- A working C compiler (Xcode Command Line Tools on Mac, Build Tools on Windows, build-essential on Linux) — required by some npm native modules (`keytar`)
- ~10 GB free disk space (Whisper model + dev artifacts)

---

# PHASE 0 — SKELETON (~3-5 days)

Goal: a "Hello, KhutbahEditor" app that runs `npm run dev` on Mac/Windows/Linux, shows the brand-correct title bar with logo and Cinzel wordmark, has a working Python sidecar reachable via JSON-RPC, and produces unsigned dev builds via `npm run build`. CI runs on every push.

### Task 0.0: Read project rules before any code

**Files:**
- Read: `CLAUDE.md` (anti-sycophancy + dev workflow + commands)
- Read: `AGENTS.md` (reviewer persona + test policy + 3-level review pipeline)
- Read: `docs/superpowers/specs/2026-04-25-khutbah-editor-design.md` (locked design)

- [ ] **Step 1: Confirm both rule docs exist at the repo root**

```bash
ls CLAUDE.md AGENTS.md docs/superpowers/specs/*.md docs/superpowers/plans/*.md
```
Expected: all four files present.

- [ ] **Step 2: Read CLAUDE.md fully — adhere to its anti-sycophancy rules from Task 0.1 onward**

- [ ] **Step 3: Read AGENTS.md fully — note the three review levels (per-task, per-phase, pre-release) you'll be invoking**

No commit — these files were committed when the plan was committed.

### Task 0.1: Initialize Node project

**Files:**
- Create: `package.json`, `.nvmrc`, `.python-version`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "khutbah-editor",
  "productName": "KhutbahEditor",
  "version": "0.1.0",
  "description": "Self-contained khutbah video editor",
  "main": "dist-electron/main.js",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "vite",
    "build:web": "vite build",
    "build:electron": "tsc -p tsconfig.node.json",
    "build": "npm run build:web && npm run build:electron",
    "package": "npm run build && electron-builder",
    "package:dir": "npm run build && electron-builder --dir",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "author": "Stichting Al-Himmah <info@alhimmah.nl>",
  "license": "MIT"
}
```

- [ ] **Step 2: Pin Node and Python versions**

```bash
echo "20" > .nvmrc
echo "3.11" > .python-version
```

- [ ] **Step 3: Commit**

```bash
git add package.json .nvmrc .python-version
git commit -m "chore: init Node project with package.json and version pins"
```

### Task 0.2: TypeScript + Vite + React + Tailwind setup

**Files:**
- Create: `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles/globals.css`

- [ ] **Step 1: Install dependencies**

```bash
npm install --save react react-dom zustand
npm install --save-dev typescript@5 vite@5 @vitejs/plugin-react \
  @types/react @types/react-dom \
  tailwindcss@3 postcss autoprefixer \
  vitest @testing-library/react @testing-library/jest-dom jsdom \
  electron@30 electron-builder \
  eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin \
  prettier eslint-config-prettier \
  playwright @playwright/test
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "tests"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Create tsconfig.node.json (for Electron + Vite config)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist-electron",
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["electron", "vite.config.ts"]
}
```

- [ ] **Step 4: Create vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist-web', emptyOutDir: true },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173, strictPort: true },
});
```

- [ ] **Step 5: Create tailwind.config.js + postcss.config.js**

```js
// tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { 0: '#050810', 1: '#0C1118', 2: '#0F1721', 3: '#1A2332' },
        border: { DEFAULT: '#1F2A38', strong: '#243242', slate: '#2D3E50' },
        text: { DEFAULT: '#E8E3D6', strong: '#F5E9C8', muted: '#6A7788', dim: '#A4AFC2' },
        amber: { DEFAULT: '#E8B73C', dark: '#C4932F', glow: '#F5E9C8' },
        green: { DEFAULT: '#7BA05B', light: '#9BC27A' },
      },
      fontFamily: {
        display: ['Cinzel', 'Trajan Pro 3', 'serif'],
        body: ['Open Sans', 'system-ui', 'sans-serif'],
        arabic: ['Amiri', 'Noto Naskh Arabic', 'serif'],
      },
    },
  },
  plugins: [],
};
```

```js
// postcss.config.js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 6: Create index.html + src/main.tsx + src/App.tsx + src/styles/globals.css**

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>KhutbahEditor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
);
```

```tsx
// src/App.tsx
export default function App() {
  return (
    <div className="min-h-screen bg-bg-1 text-text font-body flex items-center justify-center">
      <h1 className="font-display text-3xl tracking-widest text-text-strong">KHUTBAH EDITOR</h1>
    </div>
  );
}
```

```css
/* src/styles/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* @font-face declarations added in Task 0.4 after fonts are downloaded */

html, body, #root { height: 100%; margin: 0; }
body { font-family: theme('fontFamily.body'); background: theme('colors.bg.1'); color: theme('colors.text.DEFAULT'); }
```

- [ ] **Step 7: Verify dev server starts**

```bash
npm run dev
```
Expected: Vite dev server prints `Local:   http://localhost:5173/` and the page shows "KHUTBAH EDITOR".

- [ ] **Step 8: Commit**

```bash
git add tsconfig.json tsconfig.node.json vite.config.ts tailwind.config.js postcss.config.js index.html src/ package.json package-lock.json
git commit -m "feat(scaffold): vite + react + ts + tailwind boilerplate with brand tokens"
```

### Task 0.3: Bundle Cinzel + Open Sans + Amiri fonts

**Files:**
- Create: `assets/fonts/*.ttf`, update `src/styles/globals.css`

- [ ] **Step 1: Download font files (one-time, manual or scripted)**

```bash
mkdir -p assets/fonts
cd assets/fonts

# Cinzel (OFL — Google Fonts)
curl -L "https://github.com/google/fonts/raw/main/ofl/cinzel/Cinzel%5Bwght%5D.ttf" -o Cinzel-Variable.ttf

# Open Sans (Apache 2.0 — Google Fonts)
curl -L "https://github.com/google/fonts/raw/main/ofl/opensans/OpenSans%5Bwdth,wght%5D.ttf" -o OpenSans-Variable.ttf

# Amiri (OFL)
curl -L "https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf" -o Amiri-Regular.ttf
curl -L "https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Bold.ttf" -o Amiri-Bold.ttf

cd ../..
ls -la assets/fonts/
```

- [ ] **Step 2: Add @font-face to globals.css**

Replace `src/styles/globals.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@font-face {
  font-family: 'Cinzel';
  src: url('/assets/fonts/Cinzel-Variable.ttf') format('truetype-variations');
  font-weight: 400 900;
  font-display: swap;
}
@font-face {
  font-family: 'Open Sans';
  src: url('/assets/fonts/OpenSans-Variable.ttf') format('truetype-variations');
  font-weight: 300 800;
  font-display: swap;
}
@font-face {
  font-family: 'Amiri';
  src: url('/assets/fonts/Amiri-Regular.ttf') format('truetype');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Amiri';
  src: url('/assets/fonts/Amiri-Bold.ttf') format('truetype');
  font-weight: 700;
  font-display: swap;
}

html, body, #root { height: 100%; margin: 0; }
body { font-family: theme('fontFamily.body'); background: theme('colors.bg.1'); color: theme('colors.text.DEFAULT'); }
```

- [ ] **Step 3: Update vite.config.ts to serve assets/ at /assets/**

In `vite.config.ts` add:
```ts
publicDir: 'assets',
```

Wait — that conflicts with the existing `assets/` purpose. Use a different approach: copy fonts to `public/fonts/` for Vite's public dir, or use the `?url` import. Use **publicDir set to a separate dir**:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: 'public',
  build: { outDir: 'dist-web', emptyOutDir: true },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173, strictPort: true },
});
```

Then symlink or copy fonts into `public/`:
```bash
mkdir -p public/fonts
cp assets/fonts/*.ttf public/fonts/
```

Update `globals.css` paths to `/fonts/` (no `/assets/` prefix).

- [ ] **Step 4: Verify fonts render**

Update `src/App.tsx`:
```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-bg-1 text-text font-body flex flex-col items-center justify-center gap-6">
      <h1 className="font-display text-4xl tracking-widest text-text-strong">KHUTBAH EDITOR</h1>
      <p className="font-body text-text-dim">A self-contained khutbah video editor</p>
      <p className="font-arabic text-2xl text-amber" dir="rtl">إن الحمد لله نحمده ونستعينه</p>
    </div>
  );
}
```

Run `npm run dev`, confirm three different fonts visibly render.

- [ ] **Step 5: Commit**

```bash
git add assets/fonts public/fonts src/styles/globals.css src/App.tsx vite.config.ts
git commit -m "feat(brand): bundle Cinzel + Open Sans + Amiri fonts"
```

### Task 0.4: Logo and TitleBar component

**Files:**
- Copy: `public/logo.png` (from `assets/logo.png`)
- Create: `src/components/Logo.tsx`, `src/components/TitleBar.tsx`

- [ ] **Step 1: Copy logo to public dir**

```bash
cp assets/logo.png public/logo.png
```

- [ ] **Step 2: Create Logo component**

```tsx
// src/components/Logo.tsx
type Props = { className?: string };
export function Logo({ className = 'h-8 w-auto' }: Props) {
  return <img src="/logo.png" alt="Al-Himmah" className={className} />;
}
```

- [ ] **Step 3: Create TitleBar component**

```tsx
// src/components/TitleBar.tsx
import { Logo } from './Logo';

type Props = { project?: string; right?: React.ReactNode };
export function TitleBar({ project, right }: Props) {
  return (
    <header className="flex items-center gap-4 px-4 py-3 bg-gradient-to-b from-bg-3 to-[#151c27] border-b border-border-strong">
      <Logo className="h-8 w-auto" />
      <span className="font-display text-base tracking-wider text-text-strong">KHUTBAH EDITOR</span>
      {project && <span className="text-text-muted text-sm">— {project}</span>}
      <div className="ml-auto flex items-center gap-3 text-text-muted text-sm">{right}</div>
    </header>
  );
}
```

- [ ] **Step 4: Use TitleBar in App.tsx**

```tsx
// src/App.tsx
import { TitleBar } from './components/TitleBar';

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-bg-1 text-text">
      <TitleBar project="Hello World" />
      <main className="flex-1 flex items-center justify-center">
        <p className="font-arabic text-3xl text-amber" dir="rtl">السلام عليكم ورحمة الله</p>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Verify and commit**

```bash
npm run dev   # Confirm logo + wordmark render
git add public/logo.png src/components/ src/App.tsx
git commit -m "feat(ui): logo + TitleBar with brand wordmark"
```

### Task 0.5: Electron main process + preload

**Files:**
- Create: `electron/main.ts`, `electron/preload.ts`, `electron/menu.ts`

- [ ] **Step 1: Create electron/main.ts**

```ts
// electron/main.ts
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#0C1118',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist-web/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
```

- [ ] **Step 2: Create electron/preload.ts**

```ts
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('khutbah', {
  ping: () => ipcRenderer.invoke('ping'),
});
```

- [ ] **Step 3: Update package.json scripts to launch Electron in dev**

Add to `package.json` scripts:
```json
"dev:electron": "npm run build:electron && electron dist-electron/main.js",
"dev:full": "concurrently -k \"npm run dev\" \"wait-on http://localhost:5173 && npm run dev:electron\""
```

Install `concurrently` and `wait-on`:
```bash
npm install --save-dev concurrently wait-on
```

- [ ] **Step 4: Add a basic IPC handler in main.ts**

After `app.whenReady().then(createWindow);`, add:
```ts
import { ipcMain } from 'electron';
ipcMain.handle('ping', () => ({ ok: true, ts: Date.now() }));
```

- [ ] **Step 5: Verify Electron window opens**

```bash
npm run build:electron
npm run dev:full
```
Expected: a native window opens displaying the React app with Dignified Dark background, logo, TitleBar.

- [ ] **Step 6: Commit**

```bash
git add electron/ package.json package-lock.json
git commit -m "feat(electron): main process + preload, app window opens"
```

### Task 0.6: Python sidecar package skeleton

**Files:**
- Create: `python-pipeline/pyproject.toml`, `python-pipeline/khutbah_pipeline/__init__.py`, `python-pipeline/khutbah_pipeline/__main__.py`, `python-pipeline/khutbah_pipeline/rpc.py`, `python-pipeline/tests/conftest.py`, `python-pipeline/tests/test_rpc.py`

- [ ] **Step 1: Create pyproject.toml**

```toml
# python-pipeline/pyproject.toml
[project]
name = "khutbah-pipeline"
version = "0.1.0"
description = "KhutbahEditor Python sidecar"
requires-python = ">=3.11"
dependencies = [
    "faster-whisper>=1.0.0",
    "numpy>=1.26",
    "scipy>=1.12",
    "google-api-python-client>=2.120",
    "google-auth>=2.28",
    "google-auth-oauthlib>=1.2",
    "yt-dlp>=2024.4.9",
    "ffmpeg-python>=0.2",
]

[project.optional-dependencies]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "pyinstaller>=6.5",
]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["."]
include = ["khutbah_pipeline*"]
```

- [ ] **Step 2: Create the package init**

```python
# python-pipeline/khutbah_pipeline/__init__.py
__version__ = "0.1.0"
```

- [ ] **Step 3: Write the failing RPC test**

```python
# python-pipeline/tests/test_rpc.py
import io
import json
from khutbah_pipeline.rpc import RpcServer, register

@register("ping")
def ping():
    return {"ok": True}

def test_rpc_handles_single_request():
    stdin = io.StringIO(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}) + "\n")
    stdout = io.StringIO()
    server = RpcServer(stdin, stdout)
    server.run_one()
    response = json.loads(stdout.getvalue().strip())
    assert response == {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}

def test_rpc_handles_unknown_method():
    stdin = io.StringIO(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "nope"}) + "\n")
    stdout = io.StringIO()
    server = RpcServer(stdin, stdout)
    server.run_one()
    response = json.loads(stdout.getvalue().strip())
    assert response["error"]["code"] == -32601  # method not found
```

- [ ] **Step 4: Run test to confirm it fails**

```bash
cd python-pipeline
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/test_rpc.py -v
```
Expected: ImportError or ModuleNotFoundError for `khutbah_pipeline.rpc`.

- [ ] **Step 5: Implement RPC module**

```python
# python-pipeline/khutbah_pipeline/rpc.py
"""Minimal JSON-RPC 2.0 server over a line-oriented stream (stdin/stdout)."""
import json
import sys
import traceback
from typing import Callable, Any

_METHODS: dict[str, Callable[..., Any]] = {}

def register(name: str):
    def deco(fn: Callable[..., Any]) -> Callable[..., Any]:
        _METHODS[name] = fn
        return fn
    return deco

class RpcServer:
    def __init__(self, in_stream=sys.stdin, out_stream=sys.stdout):
        self.in_ = in_stream
        self.out = out_stream

    def _write(self, payload: dict):
        self.out.write(json.dumps(payload) + "\n")
        self.out.flush()

    def _handle(self, req: dict):
        rid = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}
        if method not in _METHODS:
            return {"jsonrpc": "2.0", "id": rid,
                    "error": {"code": -32601, "message": f"Method not found: {method}"}}
        try:
            result = _METHODS[method](**params) if isinstance(params, dict) else _METHODS[method](*params)
            return {"jsonrpc": "2.0", "id": rid, "result": result}
        except Exception as e:
            return {"jsonrpc": "2.0", "id": rid,
                    "error": {"code": -32000, "message": str(e), "data": traceback.format_exc()}}

    def run_one(self) -> bool:
        line = self.in_.readline()
        if not line:
            return False
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            self._write({"jsonrpc": "2.0", "id": None,
                         "error": {"code": -32700, "message": "Parse error"}})
            return True
        self._write(self._handle(req))
        return True

    def run_forever(self):
        while self.run_one():
            pass
```

- [ ] **Step 6: Run tests, confirm pass**

```bash
pytest tests/test_rpc.py -v
```
Expected: 2 passed.

- [ ] **Step 7: Add the entry point**

```python
# python-pipeline/khutbah_pipeline/__main__.py
"""Entry point — starts the JSON-RPC server on stdin/stdout."""
from khutbah_pipeline.rpc import RpcServer, register

@register("ping")
def ping():
    return {"ok": True, "version": __import__("khutbah_pipeline").__version__}

if __name__ == "__main__":
    RpcServer().run_forever()
```

- [ ] **Step 8: Commit**

```bash
cd ..  # back to repo root
git add python-pipeline/
git commit -m "feat(pipeline): Python sidecar skeleton with JSON-RPC server"
```

### Task 0.7: Sidecar manager in Electron

**Files:**
- Create: `electron/sidecar/manager.ts`, `electron/sidecar/rpc.ts`, `tests/electron/sidecar.test.ts`

- [ ] **Step 1: Write the failing manager test**

```ts
// tests/electron/sidecar.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SidecarManager } from '../../electron/sidecar/manager';
import path from 'path';

describe('SidecarManager', () => {
  let mgr: SidecarManager;

  beforeAll(async () => {
    // Use the dev Python interpreter (assumes venv at python-pipeline/.venv)
    const py = path.resolve('python-pipeline/.venv/bin/python');
    mgr = new SidecarManager({
      pythonExecutable: py,
      moduleEntry: 'khutbah_pipeline',
      cwd: path.resolve('python-pipeline'),
    });
    await mgr.start();
  });

  afterAll(async () => { await mgr.stop(); });

  it('responds to ping RPC', async () => {
    const result = await mgr.call('ping');
    expect(result).toMatchObject({ ok: true });
  });

  it('rejects unknown methods with code -32601', async () => {
    await expect(mgr.call('nonexistent')).rejects.toMatchObject({ code: -32601 });
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npm test -- tests/electron/sidecar.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement RPC client**

```ts
// electron/sidecar/rpc.ts
import { Writable, Readable } from 'stream';
import readline from 'readline';

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

export class StdioRpc {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private rl: readline.Interface;

  constructor(private stdin: Writable, stdout: Readable) {
    this.rl = readline.createInterface({ input: stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => this.handleLine(line));
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(msg.error);
    else p.resolve(msg.result);
  }

  call<T = unknown>(method: string, params?: object): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as any, reject });
      this.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  close() { this.rl.close(); }
}
```

- [ ] **Step 4: Implement manager**

```ts
// electron/sidecar/manager.ts
import { spawn, ChildProcess } from 'child_process';
import { StdioRpc } from './rpc';

export type SidecarOpts = {
  pythonExecutable: string;
  moduleEntry: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

export class SidecarManager {
  private child: ChildProcess | null = null;
  private rpc: StdioRpc | null = null;

  constructor(private opts: SidecarOpts) {}

  async start(): Promise<void> {
    this.child = spawn(
      this.opts.pythonExecutable,
      ['-m', this.opts.moduleEntry],
      { cwd: this.opts.cwd, env: { ...process.env, ...this.opts.env }, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    this.child.stderr?.on('data', (chunk) => process.stderr.write(`[sidecar] ${chunk}`));
    this.child.on('exit', (code) => { console.error(`[sidecar] exited with code ${code}`); });
    if (!this.child.stdin || !this.child.stdout) throw new Error('Sidecar stdio unavailable');
    this.rpc = new StdioRpc(this.child.stdin, this.child.stdout);
    // Sanity ping with timeout
    await Promise.race([
      this.call('ping'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Sidecar startup timeout')), 5000)),
    ]);
  }

  call<T = unknown>(method: string, params?: object): Promise<T> {
    if (!this.rpc) throw new Error('Sidecar not started');
    return this.rpc.call<T>(method, params);
  }

  async stop(): Promise<void> {
    this.rpc?.close();
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
      await new Promise<void>((res) => setTimeout(() => { this.child?.kill('SIGKILL'); res(); }, 1000));
    }
    this.child = null;
    this.rpc = null;
  }
}
```

- [ ] **Step 5: Add vitest config**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 6: Run tests, confirm pass**

```bash
npm test -- tests/electron/sidecar.test.ts
```
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add electron/sidecar/ tests/electron/sidecar.test.ts vitest.config.ts
git commit -m "feat(sidecar): manager + RPC client over stdio with tests"
```

### Task 0.8: Wire sidecar into Electron main + IPC bridge to renderer

**Files:**
- Modify: `electron/main.ts`, `electron/preload.ts`
- Create: `electron/ipc/handlers.ts`, `electron/ipc/types.ts`, `src/hooks/useIpc.ts`

- [ ] **Step 1: Define shared IPC types**

```ts
// electron/ipc/types.ts
export type IpcChannels = {
  'pipeline:call': { method: string; params?: object };
  'pipeline:result': unknown;
};
```

- [ ] **Step 2: Create handlers wiring Electron IPC → sidecar**

```ts
// electron/ipc/handlers.ts
import { ipcMain } from 'electron';
import { SidecarManager } from '../sidecar/manager';

export function registerIpcHandlers(sidecar: SidecarManager) {
  ipcMain.handle('pipeline:call', async (_e, args: { method: string; params?: object }) => {
    return sidecar.call(args.method, args.params);
  });
  ipcMain.handle('ping', () => ({ ok: true, ts: Date.now() }));
}
```

- [ ] **Step 3: Update main.ts to start sidecar at app launch**

```ts
// electron/main.ts — additions
import { SidecarManager } from './sidecar/manager';
import { registerIpcHandlers } from './ipc/handlers';
import path from 'path';

let sidecar: SidecarManager;

app.whenReady().then(async () => {
  const isDev = !app.isPackaged;
  sidecar = new SidecarManager(
    isDev
      ? {
          pythonExecutable: path.resolve('python-pipeline/.venv/bin/python'),
          moduleEntry: 'khutbah_pipeline',
          cwd: path.resolve('python-pipeline'),
        }
      : {
          pythonExecutable: path.join(process.resourcesPath, 'python-pipeline/khutbah_pipeline'),
          moduleEntry: '',  // packaged binary
          cwd: process.resourcesPath,
        }
  );
  await sidecar.start();
  registerIpcHandlers(sidecar);
  createWindow();
});

app.on('before-quit', async () => { await sidecar?.stop(); });
```

- [ ] **Step 4: Expose pipeline.call to renderer via preload**

```ts
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('khutbah', {
  ping: () => ipcRenderer.invoke('ping'),
  pipeline: {
    call: <T = unknown>(method: string, params?: object) =>
      ipcRenderer.invoke('pipeline:call', { method, params }) as Promise<T>,
  },
});

declare global {
  interface Window {
    khutbah: {
      ping: () => Promise<{ ok: boolean; ts: number }>;
      pipeline: { call: <T = unknown>(m: string, p?: object) => Promise<T> };
    };
  }
}
```

- [ ] **Step 5: Create useIpc hook in renderer**

```ts
// src/hooks/useIpc.ts
import { useEffect, useState } from 'react';

export function useIpcOnce<T>(method: string, params?: object) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    window.khutbah.pipeline.call<T>(method, params)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e : new Error(JSON.stringify(e))));
  }, [method, JSON.stringify(params)]);
  return { data, error };
}
```

- [ ] **Step 6: Verify end-to-end ping**

Update `src/App.tsx`:
```tsx
import { TitleBar } from './components/TitleBar';
import { useIpcOnce } from './hooks/useIpc';

export default function App() {
  const { data, error } = useIpcOnce<{ ok: boolean; version: string }>('ping');
  return (
    <div className="min-h-screen flex flex-col bg-bg-1 text-text">
      <TitleBar project="Hello World" right={
        <span className={data?.ok ? 'text-green' : 'text-text-muted'}>
          {data?.ok ? `● Pipeline v${data.version}` : error ? '✕ Pipeline error' : '… connecting'}
        </span>
      } />
      <main className="flex-1 flex items-center justify-center font-arabic text-3xl text-amber" dir="rtl">
        السلام عليكم ورحمة الله
      </main>
    </div>
  );
}
```

Run `npm run dev:full`. Expected: title bar shows "● Pipeline v0.1.0" within 2-3 seconds.

- [ ] **Step 7: Commit**

```bash
git add electron/ src/
git commit -m "feat(ipc): renderer ↔ main ↔ python sidecar end-to-end ping"
```

### Task 0.9: PyInstaller bundle of the Python sidecar

**Files:**
- Create: `python-pipeline/khutbah_pipeline.spec`

- [ ] **Step 1: Create PyInstaller spec**

```python
# python-pipeline/khutbah_pipeline.spec
# -*- mode: python ; coding: utf-8 -*-
block_cipher = None

a = Analysis(
    ['khutbah_pipeline/__main__.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'faster_whisper',
        'ctranslate2',
        'tokenizers',
        'numpy',
        'scipy.signal',
        'google.auth',
        'googleapiclient',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='khutbah_pipeline',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # keep stdio
)
coll = COLLECT(
    exe, a.binaries, a.zipfiles, a.datas,
    strip=False, upx=False, name='khutbah_pipeline'
)
```

- [ ] **Step 2: Add build script to package.json**

```json
"scripts": {
  ...
  "build:pipeline": "cd python-pipeline && pyinstaller --noconfirm khutbah_pipeline.spec",
  ...
}
```

- [ ] **Step 3: Verify build produces a runnable binary**

```bash
cd python-pipeline && source .venv/bin/activate && pip install pyinstaller
cd ..
npm run build:pipeline
ls python-pipeline/dist/khutbah_pipeline/   # Should contain khutbah_pipeline executable + libs
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | python-pipeline/dist/khutbah_pipeline/khutbah_pipeline
```
Expected output: `{"jsonrpc": "2.0", "id": 1, "result": {"ok": true, "version": "0.1.0"}}`

- [ ] **Step 4: Commit**

```bash
git add python-pipeline/khutbah_pipeline.spec package.json
echo "python-pipeline/build/" >> .gitignore
echo "python-pipeline/dist/" >> .gitignore
git add .gitignore
git commit -m "feat(pipeline): pyinstaller bundle spec produces standalone sidecar binary"
```

### Task 0.10: electron-builder config for all 3 platforms

**Files:**
- Create: `electron-builder.json`, `build/entitlements.mac.plist`

- [ ] **Step 1: Create electron-builder config**

```json
// electron-builder.json
{
  "appId": "nl.alhimmah.khutbaheditor",
  "productName": "KhutbahEditor",
  "copyright": "Copyright © 2026 Stichting Al-Himmah",
  "directories": { "output": "release", "buildResources": "build" },
  "files": [
    "dist-electron/**/*",
    "dist-web/**/*",
    "package.json"
  ],
  "extraResources": [
    { "from": "python-pipeline/dist/khutbah_pipeline", "to": "python-pipeline" },
    { "from": "resources/bin/${os}/${arch}", "to": "bin", "filter": ["**/*"] },
    { "from": "resources/models", "to": "models", "filter": ["whisper-large-v3.bin"] }
  ],
  "asar": true,
  "asarUnpack": ["**/*.{node,dll,dylib,so}"],
  "mac": {
    "target": [{ "target": "dmg", "arch": ["x64", "arm64"] }],
    "category": "public.app-category.video",
    "icon": "build/icon.icns",
    "hardenedRuntime": false,
    "gatekeeperAssess": false
  },
  "win": {
    "target": [{ "target": "nsis", "arch": ["x64"] }],
    "icon": "build/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "KhutbahEditor"
  },
  "linux": {
    "target": [
      { "target": "AppImage", "arch": ["x64"] },
      { "target": "deb",      "arch": ["x64"] }
    ],
    "category": "AudioVideo",
    "icon": "build/icon.png",
    "synopsis": "Self-contained khutbah video editor"
  }
}
```

- [ ] **Step 2: Create platform icons**

```bash
mkdir -p build resources/bin resources/models
cp assets/logo.png build/icon.png
# Mac .icns and Windows .ico generated separately:
# Mac: iconutil -c icns icon.iconset/   (need to create iconset)
# Windows: use ImageMagick:  convert assets/logo.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
# For now, electron-builder will accept the .png and warn (acceptable for Phase 0).
```

- [ ] **Step 3: Add empty resources placeholder**

```bash
touch resources/.gitkeep
echo "resources/bin/" >> .gitignore
echo "resources/models/" >> .gitignore
echo "release/" >> .gitignore
git add .gitignore resources/.gitkeep build/
```

- [ ] **Step 4: Verify a `--dir` build (no installer, just unpacked)**

```bash
npm run build:pipeline   # ensure pipeline binary is in python-pipeline/dist
npm run package:dir
ls release/   # Should contain mac-unpacked/, win-unpacked/, or linux-unpacked/ depending on host
```

- [ ] **Step 5: Commit**

```bash
git add electron-builder.json build/
git commit -m "feat(build): electron-builder config for mac/win/linux"
```

### Task 0.11: GitHub Actions CI matrix (with artifact upload + integration split)

**Files:**
- Create: `.github/workflows/build.yml`
- Create: `python-pipeline/pytest.ini` (pytest timeout config)

- [ ] **Step 1: Create pytest.ini for per-test timeout**

```ini
# python-pipeline/pytest.ini
[pytest]
timeout = 30
markers =
    integration: tests requiring real FFmpeg + Whisper model + large fixtures (run on workflow_dispatch + nightly only)
addopts = -v --tb=short --strict-markers
```

Install the timeout plugin:
```bash
cd python-pipeline && source .venv/bin/activate && pip install pytest-timeout
```

Add `pytest-timeout>=2.3` to `pyproject.toml` `[project.optional-dependencies] dev`.

- [ ] **Step 2: Create CI workflow with three jobs (unit, integration, package)**

```yaml
# .github/workflows/build.yml
name: Build
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
  workflow_dispatch:                           # manual trigger for integration tests
  schedule:
    - cron: '0 2 * * *'                        # nightly integration run at 02:00 UTC
  release: { types: [created] }

jobs:
  unit-tests:
    name: Unit tests (${{ matrix.os }})
    strategy:
      matrix:
        os: [macos-14, windows-2022, ubuntu-22.04]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 8                          # 300s shell timeout × 2 layers + buffer
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - name: Install Node deps
        run: npm ci
      - name: Install Python pipeline (dev)
        working-directory: python-pipeline
        shell: bash
        run: |
          python -m venv .venv
          if [ "${{ runner.os }}" = "Windows" ]; then source .venv/Scripts/activate; else source .venv/bin/activate; fi
          pip install -e ".[dev]"
      - name: Lint (ESLint)
        run: timeout 60 npm run lint
      - name: TypeScript tests (Vitest, unit only, 300s wrapper)
        run: timeout 300 npm test
      - name: Python tests (Pytest, unit only — exclude @pytest.mark.integration, 300s wrapper)
        working-directory: python-pipeline
        shell: bash
        run: |
          if [ "${{ runner.os }}" = "Windows" ]; then source .venv/Scripts/activate; else source .venv/bin/activate; fi
          timeout 300 pytest -m "not integration"
      - name: Upload test artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: test-reports-${{ matrix.os }}
          path: |
            tests/reports/
            python-pipeline/tests/reports/
            playwright-report/
          retention-days: 14

  integration-tests:
    name: Integration tests (Linux only, on-demand + nightly)
    runs-on: ubuntu-22.04
    timeout-minutes: 30                         # Whisper model download + inference
    if: github.event_name == 'workflow_dispatch' || github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: npm ci
      - name: Install Python pipeline (dev)
        working-directory: python-pipeline
        run: |
          python -m venv .venv
          source .venv/bin/activate
          pip install -e ".[dev]"
      - name: Fetch resources (FFmpeg + yt-dlp + Whisper model)
        run: bash resources/fetch-resources.sh Linux x64
      - name: Run integration tests (real FFmpeg + Whisper)
        working-directory: python-pipeline
        run: |
          source .venv/bin/activate
          timeout 1500 pytest -m integration
      - name: Upload integration artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: integration-test-reports
          path: python-pipeline/tests/reports/
          retention-days: 14

  package:
    needs: test
    if: github.event_name == 'release'
    strategy:
      matrix:
        include:
          - os: macos-13
            arch: x64
          - os: macos-14
            arch: arm64
          - os: windows-2022
            arch: x64
          - os: ubuntu-22.04
            arch: x64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: npm ci
      - name: Build pipeline binary
        working-directory: python-pipeline
        run: |
          python -m venv .venv
          ${{ runner.os == 'Windows' && '.venv\Scripts\activate' || 'source .venv/bin/activate' }}
          pip install -e ".[dev]"
          pyinstaller --noconfirm khutbah_pipeline.spec
        shell: bash
      - name: Fetch resources
        run: bash resources/fetch-resources.sh ${{ runner.os }} ${{ matrix.arch }}
      - name: Build app
        run: npm run package -- --${{ matrix.arch }}
      - name: Upload to release
        uses: softprops/action-gh-release@v2
        with:
          files: release/*.{dmg,exe,AppImage,deb}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Create resource-fetch script (placeholder, fully implemented in Phase 2)**

```bash
# resources/fetch-resources.sh
#!/usr/bin/env bash
set -euo pipefail
OS=${1:-Linux}
ARCH=${2:-x64}
echo "Fetching resources for $OS/$ARCH (placeholder — populated in Phase 2)"
mkdir -p resources/bin/$OS/$ARCH resources/models
# Phase 2 task adds actual download URLs for FFmpeg, yt-dlp, Whisper model
touch resources/bin/$OS/$ARCH/.gitkeep
```
```bash
chmod +x resources/fetch-resources.sh
```

- [ ] **Step 3: Commit**

```bash
git add .github/ resources/fetch-resources.sh
git commit -m "ci: cross-platform build + test matrix on push and release"
```

### Task 0.12: ESLint + Prettier + initial smoke e2e

**Files:**
- Create: `eslint.config.js`, `prettier.config.js`, `playwright.config.ts`, `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Configure ESLint**

```js
// eslint.config.js
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  { ignores: ['dist-*/**', 'release/**', 'python-pipeline/**', 'resources/**', 'public/**', 'build/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsparser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
```

- [ ] **Step 2: Configure Prettier**

```js
// prettier.config.js
export default {
  semi: true, singleQuote: true, trailingComma: 'all',
  printWidth: 100, tabWidth: 2,
};
```

- [ ] **Step 3: Configure Playwright + smoke test**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
});
```

```ts
// tests/e2e/smoke.spec.ts
import { test, expect } from '@playwright/test';
test('app renders title bar with brand wordmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=KHUTBAH EDITOR')).toBeVisible();
  await expect(page.locator('img[alt="Al-Himmah"]')).toBeVisible();
});
```

- [ ] **Step 4: Run lint, tests**

```bash
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
```

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js prettier.config.js playwright.config.ts tests/
git commit -m "chore(quality): eslint + prettier + playwright smoke test"
```

### Task 0.13: README and CONTRIBUTING

**Files:**
- Create/update: `README.md`, `docs/INSTALL.md`, `docs/CONTRIBUTING.md`

- [ ] **Step 1: Write README.md**

```markdown
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
```

- [ ] **Step 2: Write minimal CONTRIBUTING.md**

```markdown
# Contributing

Follow the implementation plan at `docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md` task by task. Each task is bite-sized and includes its own tests + commit step.

## Conventions

- TDD where it makes sense (test → fail → implement → pass → commit)
- Commit per task (or per logical sub-step), with conventional-commit style: `feat(scope): description`
- All Node code in TypeScript strict mode
- All Python code typed where reasonable, formatted by `ruff format` (added in a later task)
- Brand colors and fonts come from `tailwind.config.js` — never hard-code hex values in components
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/CONTRIBUTING.md docs/INSTALL.md
git commit -m "docs: README + CONTRIBUTING for Phase 0 onboarding"
```

### Task 0.14: Phase 0 Review Gate (MANDATORY before Phase 1)

Per AGENTS.md §"Code Review Pipeline" Level 2, run two-reviewer cross-model review of Phase 0.

- [ ] **Step 1: Capture Phase 0 commit range**

```bash
PHASE_START=$(git rev-list --max-parents=0 HEAD)   # root commit
git log --oneline "$PHASE_START..HEAD"
git diff --stat "$PHASE_START..HEAD"
```

- [ ] **Step 2: Reviewer A — Claude (`superpowers:code-reviewer`)**

Invoke via the Skill tool with the prompt template in AGENTS.md §"Level 2". Phase scope: *"Electron + Vite + React + TypeScript + Tailwind + Python sidecar skeleton with brand-aligned UI; cross-platform packaging config; CI matrix; first dev build runs."*

- [ ] **Step 3: Reviewer B — Codex GPT (`codex`, mode `review`)**

Invoke via the Skill tool, mode `review`, same diff range, same standards. Surface any disagreements with Reviewer A.

- [ ] **Step 4: Reconcile**

- Both APPROVE → tag and proceed:
  ```bash
  git tag phase-0-complete
  ```
- Either REQUEST_CHANGES / REJECT → address every major issue, re-run both reviewers
- Disagreement on severity → take the stricter view, document the call in a follow-up commit (`docs(review): phase-0 reconciliation note`)

- [ ] **Step 5: No further commits in Phase 0 after the tag**

---

# PHASE 1 — LOCAL EDITOR + EXPORT (~1.5 weeks)

Goal: A user can pick a local video file, see it in the Editor with a waveform timeline, place 4 markers manually (Part 1 start/end, Part 2 start/end), preview, and export two normalized .mp4 files. No auto-detection, no YouTube. End-to-end editing flow.

### Task 1.1: ffprobe wrapper + LocalIngest RPC

**Files:**
- Create: `python-pipeline/khutbah_pipeline/util/ffmpeg.py`, `python-pipeline/khutbah_pipeline/ingest/local.py`, `python-pipeline/tests/test_ingest_local.py`, `python-pipeline/tests/fixtures/short_khutbah.mp4`

- [ ] **Step 1: Generate a 60-second test fixture**

```bash
# Use ffmpeg to create a deterministic test fixture (silent video with sine tone audio)
mkdir -p python-pipeline/tests/fixtures
ffmpeg -y -f lavfi -i color=c=black:s=320x180:d=60 \
       -f lavfi -i sine=frequency=440:duration=60 \
       -shortest python-pipeline/tests/fixtures/short_khutbah.mp4
```

- [ ] **Step 2: Write the failing ingest test**

```python
# python-pipeline/tests/test_ingest_local.py
from pathlib import Path
from khutbah_pipeline.ingest.local import probe_local

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"

def test_probe_returns_duration_and_streams():
    info = probe_local(str(FIXTURE))
    assert info["duration"] == pytest.approx(60.0, abs=0.1)
    assert info["has_audio"] is True
    assert info["has_video"] is True
    assert info["width"] == 320

import pytest
```

- [ ] **Step 3: Run, confirm fail**

```bash
cd python-pipeline && pytest tests/test_ingest_local.py -v
```
Expected: ImportError.

- [ ] **Step 4: Implement ffmpeg util**

```python
# python-pipeline/khutbah_pipeline/util/ffmpeg.py
import json
import subprocess
import shutil
from typing import Optional

FFPROBE = shutil.which("ffprobe") or "ffprobe"
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"

def ffprobe_json(path: str, args: Optional[list[str]] = None) -> dict:
    cmd = [FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams"]
    if args:
        cmd += args
    cmd.append(path)
    out = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return json.loads(out.stdout)
```

- [ ] **Step 5: Implement local ingest**

```python
# python-pipeline/khutbah_pipeline/ingest/local.py
from khutbah_pipeline.util.ffmpeg import ffprobe_json

def probe_local(path: str) -> dict:
    info = ffprobe_json(path)
    duration = float(info["format"].get("duration", 0))
    streams = info.get("streams", [])
    audio = next((s for s in streams if s["codec_type"] == "audio"), None)
    video = next((s for s in streams if s["codec_type"] == "video"), None)
    return {
        "path": path,
        "duration": duration,
        "size_bytes": int(info["format"].get("size", 0)),
        "has_audio": audio is not None,
        "has_video": video is not None,
        "width": video["width"] if video else 0,
        "height": video["height"] if video else 0,
        "audio_codec": audio["codec_name"] if audio else None,
        "video_codec": video["codec_name"] if video else None,
    }
```

- [ ] **Step 6: Register the RPC method**

```python
# python-pipeline/khutbah_pipeline/__main__.py — add this
from khutbah_pipeline.ingest.local import probe_local

@register("ingest.probe_local")
def _probe(path: str):
    return probe_local(path)
```

- [ ] **Step 7: Run tests, confirm pass**

```bash
pytest tests/test_ingest_local.py -v
```
Expected: 1 passed.

- [ ] **Step 8: Commit**

```bash
git add python-pipeline/
git commit -m "feat(ingest): probe_local via ffprobe + RPC method"
```

### Task 1.2: Preview proxy generation

**Files:**
- Create: `python-pipeline/khutbah_pipeline/edit/proxy.py`, `python-pipeline/tests/test_proxy.py`

- [ ] **Step 1: Write the failing proxy test**

```python
# python-pipeline/tests/test_proxy.py
from pathlib import Path
import os
from khutbah_pipeline.edit.proxy import generate_proxy

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"

def test_proxy_generates_smaller_file(tmp_path):
    out = tmp_path / "proxy.mp4"
    generate_proxy(str(FIXTURE), str(out))
    assert out.exists()
    # Proxy must be smaller than source for our scaling target
    assert os.path.getsize(out) <= os.path.getsize(FIXTURE)
```

- [ ] **Step 2: Implement proxy generator**

```python
# python-pipeline/khutbah_pipeline/edit/proxy.py
import subprocess
from khutbah_pipeline.util.ffmpeg import FFMPEG

def generate_proxy(src: str, dst: str, max_height: int = 360):
    """Generate a low-bitrate H.264 + AAC preview proxy for smooth scrubbing."""
    subprocess.run([
        FFMPEG, "-y", "-i", src,
        "-vf", f"scale=-2:{max_height}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        dst,
    ], check=True, capture_output=True)
```

- [ ] **Step 3: Register RPC + test pass + commit**

```python
# in __main__.py
from khutbah_pipeline.edit.proxy import generate_proxy

@register("edit.generate_proxy")
def _proxy(src: str, dst: str):
    generate_proxy(src, dst)
    return {"path": dst}
```

```bash
pytest tests/test_proxy.py -v   # 1 passed
git add python-pipeline/
git commit -m "feat(edit): preview proxy generation for smooth scrubbing"
```

### Task 1.3: Library screen + file picker

**Files:**
- Create: `src/screens/Library.tsx`, `src/screens/NewKhutbah.tsx`, `src/store/projects.ts`, `src/components/ui/Button.tsx`

- [ ] **Step 1: Create Button primitive**

```tsx
// src/components/ui/Button.tsx
import { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'upload';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode };

const styles: Record<Variant, string> = {
  primary: 'bg-amber text-bg-3 hover:bg-amber-dark font-display tracking-wider uppercase',
  ghost: 'bg-transparent text-text-dim border border-border-slate hover:border-amber hover:text-amber',
  danger: 'bg-transparent text-[#d97757] border border-[#5a3a30] hover:bg-[#5a3a30]/30',
  upload: 'bg-gradient-to-br from-amber to-amber-dark text-bg-3 shadow-lg shadow-amber/30 font-display tracking-wider uppercase',
};

export function Button({ variant = 'primary', className = '', children, ...rest }: Props) {
  return (
    <button {...rest} className={`px-4 py-2.5 rounded-md font-semibold text-sm transition-colors ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Create projects store**

```ts
// src/store/projects.ts
import { create } from 'zustand';

export type Project = {
  id: string;            // path-derived hash
  sourcePath: string;
  proxyPath?: string;
  duration: number;
  createdAt: number;
  status: 'draft' | 'processed' | 'uploaded' | 'failed';
  part1?: { start: number; end: number; outputPath?: string; videoId?: string };
  part2?: { start: number; end: number; outputPath?: string; videoId?: string };
};

type State = {
  projects: Project[];
  add: (p: Project) => void;
  update: (id: string, patch: Partial<Project>) => void;
  remove: (id: string) => void;
};

export const useProjects = create<State>((set) => ({
  projects: [],
  add: (p) => set((s) => ({ projects: [p, ...s.projects] })),
  update: (id, patch) => set((s) => ({ projects: s.projects.map((p) => p.id === id ? { ...p, ...patch } : p) })),
  remove: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
}));
```

- [ ] **Step 3: Add IPC handler for native file picker**

```ts
// electron/ipc/handlers.ts — additions
import { dialog } from 'electron';

export function registerIpcHandlers(sidecar: SidecarManager) {
  // ... existing
  ipcMain.handle('dialog:openVideo', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return r.canceled ? null : r.filePaths[0];
  });
}
```

- [ ] **Step 4: Expose in preload**

```ts
// electron/preload.ts — add to khutbah api
dialog: {
  openVideo: () => ipcRenderer.invoke('dialog:openVideo') as Promise<string | null>,
},
```

- [ ] **Step 5: Create Library + NewKhutbah screens**

```tsx
// src/screens/Library.tsx
import { useProjects } from '../store/projects';
import { Button } from '../components/ui/Button';

type Props = { onNewProject: () => void; onOpen: (id: string) => void };
export function Library({ onNewProject, onOpen }: Props) {
  const projects = useProjects((s) => s.projects);
  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <h2 className="font-display text-2xl tracking-wider text-text-strong mb-1">LIBRARY</h2>
        <p className="text-text-muted text-sm mb-6">Your khutbah projects</p>

        <button onClick={onNewProject}
          className="w-full bg-gradient-to-br from-amber/10 to-green/5 border border-dashed border-amber text-amber p-6 rounded-lg font-display tracking-wider uppercase hover:bg-amber/15 transition">
          + New Khutbah
        </button>

        {projects.length === 0 ? (
          <p className="text-text-muted text-sm text-center mt-12">No khutbahs yet. Add your first.</p>
        ) : (
          <div className="mt-8 space-y-2">
            {projects.map((p) => (
              <button key={p.id} onClick={() => onOpen(p.id)}
                className="w-full bg-bg-3 border border-border-strong rounded-md p-3 flex gap-3 text-left hover:border-amber/50 transition">
                <div className="w-16 h-10 bg-bg-0 rounded flex items-center justify-center text-text-muted">▶</div>
                <div className="flex-1">
                  <div className="text-text-strong font-semibold text-sm">{p.sourcePath.split('/').pop()}</div>
                  <div className="text-text-muted text-xs">{Math.round(p.duration)}s · {p.status}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

```tsx
// src/screens/NewKhutbah.tsx
import { Button } from '../components/ui/Button';

type Props = { onPickFile: () => void; onCancel: () => void };
export function NewKhutbah({ onPickFile, onCancel }: Props) {
  return (
    <div className="flex-1 p-8 flex items-center justify-center">
      <div className="max-w-xl w-full bg-bg-2 border border-border-strong rounded-lg p-8">
        <h2 className="font-display text-xl tracking-wider text-text-strong mb-1">NEW KHUTBAH</h2>
        <p className="text-text-muted text-sm mb-8">Choose your input source</p>
        <div className="space-y-3">
          <button onClick={onPickFile}
            className="w-full bg-bg-3 border border-border-strong p-6 rounded-md text-left hover:border-amber transition">
            <div className="font-semibold text-text-strong">Pick local file</div>
            <div className="text-text-muted text-sm mt-1">MP4, MOV, MKV, WebM, etc.</div>
          </button>
          <div className="bg-bg-3 border border-border-strong p-6 rounded-md text-left opacity-50">
            <div className="font-semibold text-text-muted">YouTube URL</div>
            <div className="text-text-muted text-sm mt-1">Coming in Phase 3</div>
          </div>
          <div className="bg-bg-3 border border-border-strong p-6 rounded-md text-left opacity-50">
            <div className="font-semibold text-text-muted">Dual file (video + separate audio)</div>
            <div className="text-text-muted text-sm mt-1">Coming in Phase 4</div>
          </div>
        </div>
        <div className="mt-8 flex justify-end">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Update App.tsx with simple routing**

```tsx
// src/App.tsx
import { useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Library } from './screens/Library';
import { NewKhutbah } from './screens/NewKhutbah';
import { useProjects } from './store/projects';
import { useIpcOnce } from './hooks/useIpc';

type Screen = { name: 'library' } | { name: 'new' } | { name: 'editor'; projectId: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' });
  const addProject = useProjects((s) => s.add);
  const { data } = useIpcOnce<{ ok: boolean; version: string }>('ping');

  async function pickAndCreate() {
    const path = await window.khutbah.dialog.openVideo();
    if (!path) return;
    const probe = await window.khutbah.pipeline.call<{ duration: number }>('ingest.probe_local', { path });
    const id = path.replace(/[^a-z0-9]/gi, '_');
    addProject({ id, sourcePath: path, duration: probe.duration, createdAt: Date.now(), status: 'draft' });
    setScreen({ name: 'editor', projectId: id });
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg-1 text-text">
      <TitleBar right={<span className={data?.ok ? 'text-green' : 'text-text-muted'}>{data?.ok ? '● Pipeline ready' : '… connecting'}</span>} />
      {screen.name === 'library' && <Library onNewProject={() => setScreen({ name: 'new' })} onOpen={(id) => setScreen({ name: 'editor', projectId: id })} />}
      {screen.name === 'new' && <NewKhutbah onPickFile={pickAndCreate} onCancel={() => setScreen({ name: 'library' })} />}
      {screen.name === 'editor' && <div className="flex-1 p-8"><h2 className="font-display text-xl">EDITOR (next task)</h2><p className="text-text-muted">Project: {screen.projectId}</p></div>}
    </div>
  );
}

declare global {
  interface Window {
    khutbah: {
      ping: () => Promise<{ ok: boolean; ts: number }>;
      pipeline: { call: <T = unknown>(m: string, p?: object) => Promise<T> };
      dialog: { openVideo: () => Promise<string | null> };
    };
  }
}
```

- [ ] **Step 7: Verify and commit**

```bash
npm run dev:full   # Test: click "+ New Khutbah" → "Pick local file" → choose a video → land on Editor stub
git add src/ electron/
git commit -m "feat(ui): library, new-khutbah picker, basic routing"
```

### Task 1.4: Editor screen — Video preview component

**Files:**
- Create: `src/screens/Editor.tsx`, `src/editor/VideoPreview.tsx`

- [ ] **Step 1: Create VideoPreview**

```tsx
// src/editor/VideoPreview.tsx
import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

export type VideoHandle = { play: () => void; pause: () => void; seek: (t: number) => void; el: HTMLVideoElement | null };

type Props = {
  src: string;        // file:// URL of proxy
  onTimeUpdate?: (t: number) => void;
  onLoadedMetadata?: (duration: number) => void;
};

export const VideoPreview = forwardRef<VideoHandle, Props>(function VideoPreview(
  { src, onTimeUpdate, onLoadedMetadata }, ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useImperativeHandle(ref, () => ({
    play: () => videoRef.current?.play(),
    pause: () => videoRef.current?.pause(),
    seek: (t: number) => { if (videoRef.current) videoRef.current.currentTime = t; },
    el: videoRef.current,
  }), []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => onTimeUpdate?.(v.currentTime);
    const onMeta = () => onLoadedMetadata?.(v.duration);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
    };
  }, [onTimeUpdate, onLoadedMetadata]);

  return (
    <div className="bg-black rounded-md aspect-video relative border border-border-strong overflow-hidden">
      <video ref={videoRef} src={src} className="w-full h-full" controls preload="metadata" />
    </div>
  );
});
```

- [ ] **Step 2: Create Editor screen with proxy generation flow**

```tsx
// src/screens/Editor.tsx
import { useEffect, useRef, useState } from 'react';
import { useProjects } from '../store/projects';
import { VideoPreview, VideoHandle } from '../editor/VideoPreview';
import { Button } from '../components/ui/Button';

type Props = { projectId: string; onBack: () => void };
export function Editor({ projectId, onBack }: Props) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useProjects((s) => s.update);
  const [proxyReady, setProxyReady] = useState(!!project?.proxyPath);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<VideoHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    if (!project || project.proxyPath) return;
    (async () => {
      try {
        const proxyPath = project.sourcePath + '.proxy.mp4';
        await window.khutbah.pipeline.call('edit.generate_proxy', { src: project.sourcePath, dst: proxyPath });
        updateProject(project.id, { proxyPath });
        setProxyReady(true);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [project?.id]);

  if (!project) return <div className="p-8">Project not found</div>;

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 py-3 border-b border-border-strong flex items-center gap-3">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <span className="text-text-muted text-sm">{project.sourcePath.split('/').pop()}</span>
      </div>
      <div className="flex-1 p-6 grid grid-cols-[1fr_280px] gap-0">
        <div className="bg-bg-0 p-4 rounded-l-lg border border-border-strong">
          {error && <div className="text-[#d97757] text-sm">Proxy generation failed: {error}</div>}
          {!proxyReady && !error && <div className="text-text-muted text-sm">Generating preview proxy…</div>}
          {proxyReady && project.proxyPath && (
            <VideoPreview ref={videoRef} src={`file://${project.proxyPath}`} onTimeUpdate={setCurrentTime} />
          )}
          <div className="mt-3 text-text-muted text-xs font-mono">Time: {currentTime.toFixed(2)} s</div>
        </div>
        <div className="bg-bg-2 p-4 rounded-r-lg border-y border-r border-border-strong">
          <div className="text-text-muted uppercase text-xs tracking-wider mb-3">Markers (next task)</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire Editor into App.tsx routing**

Replace the editor stub in App.tsx with `<Editor projectId={screen.projectId} onBack={() => setScreen({ name: 'library' })} />`.

- [ ] **Step 4: Verify and commit**

```bash
npm run dev:full   # Pick a video → Editor opens → proxy generates → video preview shows
git add src/
git commit -m "feat(editor): video preview with auto-generated proxy for smooth playback"
```

### Task 1.5: Timeline with draggable markers

**Files:**
- Create: `src/editor/Timeline.tsx`, `src/editor/Marker.tsx`, `src/editor/markersStore.ts`

- [ ] **Step 1: Create markers store**

```ts
// src/editor/markersStore.ts
import { create } from 'zustand';

export type MarkerKey = 'p1Start' | 'p1End' | 'p2Start' | 'p2End';

type State = {
  markers: Record<MarkerKey, number>;
  duration: number;
  setMarker: (k: MarkerKey, t: number) => void;
  setDuration: (d: number) => void;
  reset: (d: number) => void;
};

export const useMarkers = create<State>((set) => ({
  markers: { p1Start: 0, p1End: 0, p2Start: 0, p2End: 0 },
  duration: 0,
  setMarker: (k, t) => set((s) => ({ markers: { ...s.markers, [k]: Math.max(0, Math.min(s.duration, t)) } })),
  setDuration: (d) => set({ duration: d }),
  reset: (d) => set({
    duration: d,
    markers: { p1Start: d * 0.05, p1End: d * 0.45, p2Start: d * 0.50, p2End: d * 0.95 },
  }),
}));
```

- [ ] **Step 2: Create Timeline component**

```tsx
// src/editor/Timeline.tsx
import { useRef, MouseEvent } from 'react';
import { useMarkers, MarkerKey } from './markersStore';

type Props = { currentTime: number; onSeek: (t: number) => void };

const COLORS: Record<MarkerKey, string> = {
  p1Start: 'bg-amber', p1End: 'bg-amber',
  p2Start: 'bg-green', p2End: 'bg-green',
};

export function Timeline({ currentTime, onSeek }: Props) {
  const { markers, duration, setMarker } = useMarkers();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<MarkerKey | null>(null);

  function pctOf(t: number) { return duration > 0 ? (t / duration) * 100 : 0; }

  function onTrackClick(e: MouseEvent<HTMLDivElement>) {
    if (dragging.current) return;
    const rect = trackRef.current!.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    onSeek(t);
  }

  function onMarkerMouseDown(e: MouseEvent, key: MarkerKey) {
    e.stopPropagation();
    dragging.current = key;
    const onMove = (ev: globalThis.MouseEvent) => {
      const rect = trackRef.current!.getBoundingClientRect();
      const t = ((ev.clientX - rect.left) / rect.width) * duration;
      setMarker(key, t);
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const part1Width = pctOf(markers.p1End - markers.p1Start);
  const part2Width = pctOf(markers.p2End - markers.p2Start);

  return (
    <div className="bg-bg-0 border-y border-border-strong p-3 select-none">
      <div className="flex items-center gap-3 mb-2 text-text-muted text-xs">
        <span className="uppercase tracking-wider font-bold">Timeline</span>
        <span className="ml-auto font-mono">{currentTime.toFixed(1)}s / {duration.toFixed(1)}s</span>
      </div>
      <div ref={trackRef} onClick={onTrackClick}
           className="relative h-14 bg-bg-1 border border-border-strong rounded-md cursor-pointer overflow-visible">
        {/* Part 1 segment */}
        <div className="absolute top-0 h-full bg-amber/40 border border-amber rounded"
             style={{ left: `${pctOf(markers.p1Start)}%`, width: `${part1Width}%` }}>
          <span className="absolute top-1/2 -translate-y-1/2 left-2 text-bg-3 text-xs font-bold">Part 1</span>
        </div>
        {/* Part 2 segment */}
        <div className="absolute top-0 h-full bg-green/40 border border-green rounded"
             style={{ left: `${pctOf(markers.p2Start)}%`, width: `${part2Width}%` }}>
          <span className="absolute top-1/2 -translate-y-1/2 left-2 text-bg-3 text-xs font-bold">Part 2</span>
        </div>
        {/* Markers */}
        {(['p1Start', 'p1End', 'p2Start', 'p2End'] as MarkerKey[]).map((key) => (
          <div key={key}
               onMouseDown={(e) => onMarkerMouseDown(e, key)}
               className="absolute -top-1 -bottom-1 w-1 cursor-ew-resize"
               style={{ left: `${pctOf(markers[key])}%` }}>
            <div className={`absolute -left-1.5 -top-0.5 w-3 h-3 rounded-sm border-2 border-bg-3 ${COLORS[key]}`}></div>
          </div>
        ))}
        {/* Playhead */}
        <div className="absolute -top-2 -bottom-2 w-px bg-amber pointer-events-none"
             style={{ left: `${pctOf(currentTime)}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire Timeline into Editor**

Update `src/screens/Editor.tsx` to include Timeline below the video:

```tsx
import { Timeline } from '../editor/Timeline';
import { useMarkers } from '../editor/markersStore';

// inside Editor component
const { reset, markers } = useMarkers();
useEffect(() => {
  // Reset markers to sensible defaults when project loads
  if (project) reset(project.duration);
}, [project?.id]);

// In the render below the grid:
<Timeline currentTime={currentTime} onSeek={(t) => videoRef.current?.seek(t)} />
```

- [ ] **Step 4: Verify markers drag and segments update**

```bash
npm run dev:full   # Open a project → drag markers → confirm visual feedback + segment widths update
git add src/editor/ src/screens/Editor.tsx
git commit -m "feat(editor): draggable timeline markers for Part 1/Part 2 boundaries"
```

### Task 1.6: Two-pass loudnorm (audio normalization)

**Files:**
- Create: `python-pipeline/khutbah_pipeline/edit/loudnorm.py`, `python-pipeline/tests/test_loudnorm.py`

- [ ] **Step 1: Write the failing test**

```python
# python-pipeline/tests/test_loudnorm.py
from pathlib import Path
import subprocess
import json
from khutbah_pipeline.edit.loudnorm import measure_loudness, build_loudnorm_filter

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"

def test_measure_loudness_returns_lufs(tmp_path):
    measured = measure_loudness(str(FIXTURE))
    assert "input_i" in measured
    assert "input_tp" in measured
    assert "input_lra" in measured
    # Sine tone @ 440 Hz should be quite loud (sine wave around -3 to 0 LUFS depending on sample rate)
    assert -50 < float(measured["input_i"]) < 5

def test_filter_string_is_valid(tmp_path):
    measured = measure_loudness(str(FIXTURE))
    f = build_loudnorm_filter(measured, target_i=-14.0, target_tp=-1.0, target_lra=11.0)
    assert "loudnorm=" in f
    assert "I=-14" in f
    assert "linear=true" in f
```

- [ ] **Step 2: Implement loudnorm**

```python
# python-pipeline/khutbah_pipeline/edit/loudnorm.py
import json
import subprocess
import re
from khutbah_pipeline.util.ffmpeg import FFMPEG

def measure_loudness(src: str) -> dict:
    """Pass 1: measure integrated loudness, true peak, LRA, threshold, offset."""
    cmd = [
        FFMPEG, "-hide_banner", "-i", src,
        "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
        "-f", "null", "-",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, check=True)
    # FFmpeg writes the JSON block to stderr at the end
    text = r.stderr
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", text, re.DOTALL)
    if not m:
        raise RuntimeError(f"loudnorm measurement parse failed:\n{text}")
    return json.loads(m.group(0))

def build_loudnorm_filter(measured: dict, target_i: float = -14.0,
                          target_tp: float = -1.0, target_lra: float = 11.0) -> str:
    return (
        f"loudnorm=I={target_i}:TP={target_tp}:LRA={target_lra}"
        f":measured_I={measured['input_i']}"
        f":measured_TP={measured['input_tp']}"
        f":measured_LRA={measured['input_lra']}"
        f":measured_thresh={measured['input_thresh']}"
        f":offset={measured['target_offset']}"
        f":linear=true:print_format=summary"
    )
```

- [ ] **Step 3: Run, confirm pass**

```bash
pytest tests/test_loudnorm.py -v   # 2 passed
```

- [ ] **Step 4: Commit**

```bash
git add python-pipeline/
git commit -m "feat(edit): two-pass EBU R128 loudness measurement and filter builder"
```

### Task 1.7: Smart-cut export (stream-copy + boundary re-encode)

**Files:**
- Create: `python-pipeline/khutbah_pipeline/edit/smartcut.py`, `python-pipeline/tests/test_smartcut.py`

- [ ] **Step 1: Write the failing test**

```python
# python-pipeline/tests/test_smartcut.py
from pathlib import Path
from khutbah_pipeline.edit.smartcut import smart_cut

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"

def test_smart_cut_produces_video_of_expected_duration(tmp_path):
    out = tmp_path / "part1.mp4"
    smart_cut(str(FIXTURE), str(out), start=10.0, end=30.0,
              normalize_audio=True, target_lufs=-14.0)
    assert out.exists()
    # Verify duration with ffprobe
    import subprocess, json
    info = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_format", "-print_format", "json", str(out),
    ], text=True))
    duration = float(info["format"]["duration"])
    assert 19.5 < duration < 20.5
```

- [ ] **Step 2: Implement smart-cut**

```python
# python-pipeline/khutbah_pipeline/edit/smartcut.py
import subprocess
import tempfile
import os
from pathlib import Path
from khutbah_pipeline.util.ffmpeg import FFMPEG
from khutbah_pipeline.edit.loudnorm import measure_loudness, build_loudnorm_filter

def smart_cut(src: str, dst: str, start: float, end: float,
              normalize_audio: bool = True,
              target_lufs: float = -14.0,
              target_tp: float = -1.0,
              target_lra: float = 11.0):
    """Cut [start, end] from src into dst. If normalize_audio, apply EBU R128."""
    duration = end - start
    audio_filter = []
    if normalize_audio:
        # Two-pass loudnorm: measure on the full source, apply during cut.
        # (Measuring on the cut region is more accurate but doubles the work.)
        measured = measure_loudness(src)
        audio_filter = ["-af", build_loudnorm_filter(measured, target_lufs, target_tp, target_lra)]

    cmd = [
        FFMPEG, "-y", "-ss", str(start), "-t", str(duration), "-i", src,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p",
    ] + audio_filter + [
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        "-async", "1", "-vsync", "cfr",
        dst,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
```

> Note: this is the simpler "always re-encode" path. The keyframe-aware stream-copy hybrid is an optimization added in Task 1.10.

- [ ] **Step 3: Run, confirm pass**

```bash
pytest tests/test_smartcut.py -v   # 1 passed (slow — ~30s due to encoding)
```

- [ ] **Step 4: Register RPC + commit**

```python
# in __main__.py
from khutbah_pipeline.edit.smartcut import smart_cut

@register("edit.smart_cut")
def _smart_cut(src: str, dst: str, start: float, end: float, normalize_audio: bool = True):
    smart_cut(src, dst, start, end, normalize_audio=normalize_audio)
    return {"output": dst}
```

```bash
git add python-pipeline/
git commit -m "feat(edit): smart_cut with optional EBU R128 audio normalization"
```

### Task 1.8: Wire Export action in Editor

**Files:**
- Modify: `src/screens/Editor.tsx`, `electron/ipc/handlers.ts`, `electron/preload.ts`
- Create: `src/components/ui/ProgressBar.tsx`

- [ ] **Step 1: Add output dir picker to IPC**

```ts
// electron/ipc/handlers.ts — additions
import os from 'os';
import path from 'path';

ipcMain.handle('paths:defaultOutputDir', () => {
  const home = os.homedir();
  const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  const base = process.platform === 'darwin' ? 'Movies' : 'Videos';
  return path.join(home, base, 'KhutbahEditor', today);
});

ipcMain.handle('paths:ensureDir', async (_e, dir: string) => {
  const fs = await import('fs/promises');
  await fs.mkdir(dir, { recursive: true });
  return dir;
});
```

- [ ] **Step 2: Expose in preload + add ProgressBar component**

```ts
// preload.ts additions
paths: {
  defaultOutputDir: () => ipcRenderer.invoke('paths:defaultOutputDir') as Promise<string>,
  ensureDir: (d: string) => ipcRenderer.invoke('paths:ensureDir', d) as Promise<string>,
},
```

```tsx
// src/components/ui/ProgressBar.tsx
type Props = { value: number; label?: string };
export function ProgressBar({ value, label }: Props) {
  return (
    <div className="space-y-1">
      {label && <div className="text-text-muted text-xs">{label}</div>}
      <div className="h-1 bg-border-strong rounded overflow-hidden">
        <div className="h-full bg-gradient-to-r from-amber to-amber-dark transition-all"
             style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add Export button + flow to Editor**

```tsx
// src/screens/Editor.tsx — add at the top of the component
const [exporting, setExporting] = useState<{ p1: number; p2: number } | null>(null);

async function exportBoth() {
  if (!project) return;
  setExporting({ p1: 0, p2: 0 });
  const dir = await window.khutbah.paths.defaultOutputDir();
  await window.khutbah.paths.ensureDir(dir);
  const base = `${project.id}-${Date.now()}`;
  const p1Out = `${dir}/${base}-deel-1.mp4`;
  const p2Out = `${dir}/${base}-deel-2.mp4`;

  await window.khutbah.pipeline.call('edit.smart_cut', {
    src: project.sourcePath, dst: p1Out, start: markers.p1Start, end: markers.p1End,
  });
  setExporting({ p1: 100, p2: 0 });

  await window.khutbah.pipeline.call('edit.smart_cut', {
    src: project.sourcePath, dst: p2Out, start: markers.p2Start, end: markers.p2End,
  });
  setExporting({ p1: 100, p2: 100 });
  updateProject(project.id, {
    status: 'processed',
    part1: { start: markers.p1Start, end: markers.p1End, outputPath: p1Out },
    part2: { start: markers.p2Start, end: markers.p2End, outputPath: p2Out },
  });
}

// In the JSX action bar:
<div className="px-6 py-3 border-t border-border-strong flex items-center gap-3">
  <span className="text-text-muted text-xs">{exporting ? 'Exporting…' : 'Ready to export'}</span>
  {exporting && <ProgressBar value={(exporting.p1 + exporting.p2) / 2} />}
  <div className="ml-auto flex gap-2">
    <Button variant="ghost" onClick={() => alert('Re-analyze coming in Phase 2')}>↻ Re-analyze</Button>
    <Button variant="primary" onClick={exportBoth}>Export 2 files</Button>
  </div>
</div>
```

- [ ] **Step 4: Verify end-to-end**

```bash
npm run dev:full
# Pick a video, place markers, click Export, confirm two .mp4 files appear in ~/Movies/KhutbahEditor/<date>/
git add src/ electron/
git commit -m "feat(editor): export 2 normalized parts to default output dir"
```

### Task 1.9: Settings persistence (electron-store)

**Files:**
- Create: `electron/store.ts`, `src/screens/Settings.tsx`, `src/store/settings.ts`
- Install: `electron-store`

- [ ] **Step 1: Install electron-store**

```bash
npm install electron-store
```

- [ ] **Step 2: Create main-side settings store**

```ts
// electron/store.ts
import Store from 'electron-store';

export type AppSettings = {
  outputDir?: string;             // override default
  audioTargetLufs: number;
  audioTargetTp: number;
  audioTargetLra: number;
  silenceThresholdDb: number;
  silenceMinDuration: number;
  minPart1Duration: number;
  autoPilot: boolean;
  defaultVisibility: 'public' | 'unlisted' | 'private';
  defaultMadeForKids: boolean;
  defaultCategoryId: string;
  defaultTags: string[];
  titleTemplate: string;
  descriptionTemplate: string;
  khatibName: string;
};

export const defaults: AppSettings = {
  audioTargetLufs: -14, audioTargetTp: -1, audioTargetLra: 11,
  silenceThresholdDb: -35, silenceMinDuration: 1.5, minPart1Duration: 300,
  autoPilot: true,
  defaultVisibility: 'unlisted',
  defaultMadeForKids: false,
  defaultCategoryId: '27',
  defaultTags: ['khutbah', 'friday', 'sermon', 'jumma', 'alhimmah'],
  titleTemplate: 'Khutbah {date} — Deel {n}{lang_suffix}',
  descriptionTemplate: `Vrijdagkhutbah van Al-Himmah Moskee, {date}.

Deel {n}{lang_suffix}{khatib_line}
{other_part_link}

Bezoek ons: alhimmah.nl`,
  khatibName: '',
};

export const settingsStore = new Store<AppSettings>({ defaults });
```

- [ ] **Step 3: Add IPC + preload**

```ts
// electron/ipc/handlers.ts additions
import { settingsStore, AppSettings } from '../store';

ipcMain.handle('settings:get', () => settingsStore.store);
ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
  for (const [k, v] of Object.entries(patch)) settingsStore.set(k as keyof AppSettings, v as never);
  return settingsStore.store;
});
```

```ts
// preload.ts additions
settings: {
  get: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  set: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', patch) as Promise<AppSettings>,
},
```

- [ ] **Step 4: Create Settings screen + zustand cache**

```ts
// src/store/settings.ts
import { create } from 'zustand';
import type { AppSettings } from '../../electron/store';

type State = {
  settings: AppSettings | null;
  load: () => Promise<void>;
  patch: (p: Partial<AppSettings>) => Promise<void>;
};

export const useSettings = create<State>((set) => ({
  settings: null,
  load: async () => set({ settings: await window.khutbah.settings.get() }),
  patch: async (p) => set({ settings: await window.khutbah.settings.set(p) }),
}));
```

```tsx
// src/screens/Settings.tsx
import { useEffect } from 'react';
import { useSettings } from '../store/settings';
import { Button } from '../components/ui/Button';

type Props = { onBack: () => void };
export function Settings({ onBack }: Props) {
  const { settings, load, patch } = useSettings();
  useEffect(() => { load(); }, [load]);
  if (!settings) return <div className="p-8 text-text-muted">Loading…</div>;

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" onClick={onBack}>← Back</Button>
          <h2 className="font-display text-2xl tracking-wider text-text-strong">SETTINGS</h2>
        </div>

        <Section title="Workflow">
          <Toggle label="Auto-pilot" desc="Skip the editor for high-confidence detections; auto-export and upload"
                  value={settings.autoPilot} onChange={(v) => patch({ autoPilot: v })} />
        </Section>

        <Section title="Brand & metadata">
          <Field label="Khatib name (optional)" value={settings.khatibName}
                 onChange={(v) => patch({ khatibName: v })} placeholder="e.g. Imam Mohammed" />
          <Field label="Title template" value={settings.titleTemplate}
                 onChange={(v) => patch({ titleTemplate: v })} mono />
          <TextareaField label="Description template" value={settings.descriptionTemplate}
                          onChange={(v) => patch({ descriptionTemplate: v })} rows={6} mono />
        </Section>

        <Section title="Audio normalization">
          <NumberField label="Target LUFS" value={settings.audioTargetLufs}
                       onChange={(v) => patch({ audioTargetLufs: v })} />
          <NumberField label="Target true peak (dBTP)" value={settings.audioTargetTp}
                       onChange={(v) => patch({ audioTargetTp: v })} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h3 className="text-text-muted uppercase tracking-wider text-xs font-bold mb-3">{title}</h3>
      <div className="space-y-3 bg-bg-2 border border-border-strong rounded-lg p-4">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono }: {label:string;value:string;onChange:(v:string)=>void;placeholder?:string;mono?:boolean}) {
  return (
    <label className="block">
      <span className="text-text-muted text-xs">{label}</span>
      <input className={`w-full mt-1 bg-bg-0 border border-border-strong rounded p-2 text-text ${mono ? 'font-mono text-xs' : 'text-sm'}`}
             value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function TextareaField({ label, value, onChange, rows, mono }: {label:string;value:string;onChange:(v:string)=>void;rows:number;mono?:boolean}) {
  return (
    <label className="block">
      <span className="text-text-muted text-xs">{label}</span>
      <textarea rows={rows}
                className={`w-full mt-1 bg-bg-0 border border-border-strong rounded p-2 text-text ${mono ? 'font-mono text-xs' : 'text-sm'}`}
                value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function NumberField({ label, value, onChange }: {label:string;value:number;onChange:(v:number)=>void}) {
  return (
    <label className="block">
      <span className="text-text-muted text-xs">{label}</span>
      <input type="number" step={0.1}
             className="w-32 mt-1 bg-bg-0 border border-border-strong rounded p-2 text-text text-sm"
             value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Toggle({ label, desc, value, onChange }: {label:string;desc:string;value:boolean;onChange:(v:boolean)=>void}) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={() => onChange(!value)}
              className={`w-9 h-5 rounded-full relative transition-colors ${value ? 'bg-amber/40' : 'bg-border-strong'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${value ? 'left-4 bg-amber' : 'left-0.5 bg-text-muted'}`}></span>
      </button>
      <div>
        <div className="text-text-strong text-sm font-semibold">{label}</div>
        <div className="text-text-muted text-xs">{desc}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add Settings link to TitleBar + commit**

```tsx
// src/App.tsx — add screen 'settings' and a TitleBar right-side button
{/* in TitleBar right slot: */}
<button onClick={() => setScreen({ name: 'settings' })} className="text-text-muted hover:text-text-strong">⚙</button>

// in screen routing
{screen.name === 'settings' && <Settings onBack={() => setScreen({ name: 'library' })} />}
```

```bash
git add electron/store.ts electron/ipc/ electron/preload.ts src/screens/Settings.tsx src/store/settings.ts src/App.tsx package.json
git commit -m "feat(settings): persistent settings store + Settings screen"
```

### Task 1.10: Phase 1 Review Gate (MANDATORY before Phase 2)

Two-reviewer cross-model review of Phase 1 per AGENTS.md §"Code Review Pipeline" Level 2.

- [ ] **Step 1: Capture diff**

```bash
git log --oneline phase-0-complete..HEAD
git diff --stat phase-0-complete..HEAD
```

- [ ] **Step 2: Reviewer A — `superpowers:code-reviewer`**

Phase scope: *"Local file ingest, preview proxy generation, draggable timeline markers, two-pass EBU R128 normalization, smart-cut export, Settings persistence — fully manual editor end-to-end."*

- [ ] **Step 3: Reviewer B — `codex` (mode `review`)**

Same diff, same standards, same prompt structure.

- [ ] **Step 4: Reconcile + tag**

```bash
# After both APPROVE
git tag phase-1-complete
```

If either reviewer flags FFmpeg argument construction issues, audio sync drift in `smart_cut`, or non-deterministic test data: address before tagging.

---

# PHASE 2 — AUTO-DETECTION (~1.5 weeks)

Goal: User picks a video → app auto-detects Part 1 (إن الحمد لله) start, sitting silence, and dua end → opens Editor with markers pre-placed and confidence indicators. Pipeline handles Arabic + Dutch + English.

### Task 2.1: Bundle Whisper large-v3 + FFmpeg + yt-dlp via fetch-resources script

**Files:**
- Update: `resources/fetch-resources.sh`

- [ ] **Step 1: Implement fetch-resources.sh**

```bash
#!/usr/bin/env bash
# resources/fetch-resources.sh
set -euo pipefail
OS=${1:-Linux}
ARCH=${2:-x64}

echo "==> Fetching resources for $OS/$ARCH"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN_DIR="$ROOT/resources/bin/$OS/$ARCH"
MODELS_DIR="$ROOT/resources/models"
mkdir -p "$BIN_DIR" "$MODELS_DIR"

# --- FFmpeg + ffprobe ---
case "$OS-$ARCH" in
  macOS-*|Darwin-*)
    URL="https://www.osxexperts.net/ffmpeg711arm.zip"   # placeholder; pick a known-good source
    curl -L "$URL" -o /tmp/ffmpeg.zip
    unzip -o /tmp/ffmpeg.zip -d "$BIN_DIR"
    ;;
  Windows-*)
    URL="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    curl -L "$URL" -o /tmp/ffmpeg.zip
    unzip -o /tmp/ffmpeg.zip -d /tmp/ffmpeg-extracted
    cp /tmp/ffmpeg-extracted/ffmpeg-*/bin/ffmpeg.exe "$BIN_DIR/"
    cp /tmp/ffmpeg-extracted/ffmpeg-*/bin/ffprobe.exe "$BIN_DIR/"
    ;;
  Linux-*|ubuntu*)
    URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
    curl -L "$URL" -o /tmp/ffmpeg.tar.xz
    mkdir -p /tmp/ffmpeg-extracted && tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-extracted --strip-components=1
    cp /tmp/ffmpeg-extracted/ffmpeg "$BIN_DIR/"
    cp /tmp/ffmpeg-extracted/ffprobe "$BIN_DIR/"
    ;;
esac
chmod +x "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe" 2>/dev/null || true

# --- yt-dlp ---
case "$OS-$ARCH" in
  Windows-*) curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe -o "$BIN_DIR/yt-dlp.exe" ;;
  *)         curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "$BIN_DIR/yt-dlp" && chmod +x "$BIN_DIR/yt-dlp" ;;
esac

# --- Whisper large-v3 GGUF (CTranslate2 format used by faster-whisper) ---
MODEL_PATH="$MODELS_DIR/whisper-large-v3"
if [ ! -d "$MODEL_PATH" ]; then
  echo "==> Downloading Whisper large-v3 (~3 GB)..."
  pip install --quiet huggingface_hub
  python -c "
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id='Systran/faster-whisper-large-v3',
    local_dir='$MODEL_PATH',
    local_dir_use_symlinks=False,
)
"
fi

echo "==> Done. resources/bin/$OS/$ARCH/ contents:"
ls -la "$BIN_DIR"
echo "Model dir size:"
du -sh "$MODEL_PATH" 2>/dev/null || true
```

- [ ] **Step 2: Run locally (Linux/Mac dev) and verify**

```bash
bash resources/fetch-resources.sh "$(uname -s)" "$(uname -m | sed 's/x86_64/x64/')"
ls resources/bin/$(uname -s)/x64/
ls resources/models/whisper-large-v3/
```

- [ ] **Step 3: Commit**

```bash
git add resources/fetch-resources.sh
git commit -m "build: cross-platform fetch script for ffmpeg, yt-dlp, whisper-large-v3"
```

### Task 2.2: Arabic text normalization

**Files:**
- Create: `python-pipeline/khutbah_pipeline/detect/normalize_arabic.py`, `python-pipeline/tests/test_normalize_arabic.py`

- [ ] **Step 1: Write the failing test**

```python
# python-pipeline/tests/test_normalize_arabic.py
from khutbah_pipeline.detect.normalize_arabic import normalize_arabic

def test_strips_diacritics():
    assert normalize_arabic("إِنَّ الْحَمْدَ لِلَّهِ") == "ان الحمد لله"

def test_unifies_alef_forms():
    assert normalize_arabic("إن") == "ان"
    assert normalize_arabic("أن") == "ان"
    assert normalize_arabic("آن") == "ان"

def test_collapses_whitespace():
    assert normalize_arabic("  ان  الحمد   لله  ") == "ان الحمد لله"

def test_passes_through_non_arabic():
    assert normalize_arabic("Hello World") == "hello world"
```

- [ ] **Step 2: Implement**

```python
# python-pipeline/khutbah_pipeline/detect/normalize_arabic.py
import re
import unicodedata

# Unicode ranges for Arabic diacritics (tashkeel)
DIACRITICS = re.compile(r"[ً-ٰٟۖ-ۭ]")
ALEF_VARIANTS = re.compile(r"[آأإ]")  # آ أ إ → ا
WHITESPACE = re.compile(r"\s+")

def normalize_arabic(text: str) -> str:
    s = unicodedata.normalize("NFC", text)
    s = DIACRITICS.sub("", s)
    s = ALEF_VARIANTS.sub("ا", s)  # unify all alef forms to bare alef
    s = s.replace("ة", "ه")    # ة → ه (taa marbuta to haa)
    s = s.replace("ى", "ي")    # ى → ي (alef maqsura to yaa)
    s = s.lower()
    s = WHITESPACE.sub(" ", s).strip()
    return s
```

- [ ] **Step 3: Run, confirm pass + commit**

```bash
pytest tests/test_normalize_arabic.py -v   # 4 passed
git add python-pipeline/
git commit -m "feat(detect): Arabic text normalization (diacritics, alef forms, whitespace)"
```

### Task 2.3: Multilingual phrase library

**Files:**
- Create: `python-pipeline/khutbah_pipeline/detect/phrases.py`, `python-pipeline/tests/test_phrases.py`

- [ ] **Step 1: Write tests**

```python
# python-pipeline/tests/test_phrases.py
from khutbah_pipeline.detect.phrases import (
    OPENING_AR, CLOSINGS, find_first_opening, find_last_closing,
)

def test_find_opening_returns_first_match():
    words = [
        {"word": "بسم", "start": 0.5, "end": 0.9, "lang": "ar"},
        {"word": "إن", "start": 5.0, "end": 5.4, "lang": "ar"},
        {"word": "الحمد", "start": 5.5, "end": 6.0, "lang": "ar"},
        {"word": "لله", "start": 6.1, "end": 6.6, "lang": "ar"},
    ]
    match = find_first_opening(words)
    assert match is not None
    assert match["start_word_idx"] == 1
    assert match["start_time"] == 5.0

def test_find_opening_returns_none_when_absent():
    words = [{"word": "hello", "start": 0, "end": 1, "lang": "en"}]
    assert find_first_opening(words) is None

def test_find_closing_in_dutch():
    words = [
        {"word": "onze", "start": 100.0, "end": 100.3, "lang": "nl"},
        {"word": "heer", "start": 100.4, "end": 100.7, "lang": "nl"},
        {"word": "geef", "start": 100.8, "end": 101.0, "lang": "nl"},
        {"word": "ons", "start": 101.1, "end": 101.3, "lang": "nl"},
        {"word": "in", "start": 101.4, "end": 101.5, "lang": "nl"},
        {"word": "deze", "start": 101.6, "end": 101.8, "lang": "nl"},
        {"word": "wereld", "start": 101.9, "end": 102.3, "lang": "nl"},
        {"word": "het", "start": 102.4, "end": 102.5, "lang": "nl"},
        {"word": "goede", "start": 102.6, "end": 103.0, "lang": "nl"},
    ]
    match = find_last_closing(words, dominant_lang="nl")
    assert match is not None
    assert match["end_time"] == 103.0
```

- [ ] **Step 2: Implement**

```python
# python-pipeline/khutbah_pipeline/detect/phrases.py
from khutbah_pipeline.detect.normalize_arabic import normalize_arabic

OPENING_AR = ["ان الحمد لله"]   # already-normalized

CLOSINGS = {
    "ar": [
        "ربنا اتنا في الدنيا حسنه وفي الاخره حسنه",
        "واخر دعوانا ان الحمد لله رب العالمين",
        "سبحان ربك رب العزه عما يصفون",
        "اقم الصلاه",
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

def _normalize(text: str) -> str:
    return normalize_arabic(text)

def _join_words(words: list[dict], i: int, n: int) -> str:
    return _normalize(" ".join(w["word"] for w in words[i:i+n]))

def _find_phrase(words: list[dict], phrase: str, start_at: int = 0):
    norm_phrase = _normalize(phrase)
    n_phrase = len(norm_phrase.split())
    for i in range(start_at, len(words) - n_phrase + 1):
        candidate = _join_words(words, i, n_phrase)
        if norm_phrase in candidate:
            return {
                "start_word_idx": i,
                "end_word_idx": i + n_phrase - 1,
                "start_time": words[i]["start"],
                "end_time": words[i + n_phrase - 1]["end"],
                "matched_phrase": phrase,
            }
    return None

def find_first_opening(words: list[dict]):
    for phrase in OPENING_AR:
        m = _find_phrase(words, phrase)
        if m: return m
    return None

def find_last_closing(words: list[dict], dominant_lang: str, search_from_word: int = 0):
    """Search dominant lang first, then Arabic; return latest match across all."""
    candidates = []
    langs_to_check = [dominant_lang] + (["ar"] if dominant_lang != "ar" else [])
    for lang in langs_to_check:
        for phrase in CLOSINGS.get(lang, []):
            m = _find_phrase(words, phrase, start_at=search_from_word)
            if m: candidates.append(m)
    if not candidates: return None
    return max(candidates, key=lambda x: x["end_time"])
```

- [ ] **Step 3: Run, pass, commit**

```bash
pytest tests/test_phrases.py -v   # 3 passed
git add python-pipeline/
git commit -m "feat(detect): multilingual opening/closing phrase matcher (AR/NL/EN)"
```

### Task 2.4: Silence detection

**Files:**
- Create: `python-pipeline/khutbah_pipeline/detect/silence.py`, `python-pipeline/tests/test_silence.py`

- [ ] **Step 1: Generate fixture with known silences**

```bash
# Create a 30s clip with a 3s silence in the middle
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=30,volume=0.5" \
       -af "volume=enable='between(t,12,15)':volume=0" \
       python-pipeline/tests/fixtures/silence_test.wav
```

- [ ] **Step 2: Write the failing test**

```python
# python-pipeline/tests/test_silence.py
from pathlib import Path
from khutbah_pipeline.detect.silence import detect_silences

FIXTURE = Path(__file__).parent / "fixtures" / "silence_test.wav"

def test_detects_known_silence():
    silences = detect_silences(str(FIXTURE), noise_db=-30, min_duration=2.0)
    assert len(silences) >= 1
    s = silences[0]
    assert 11 < s["start"] < 13
    assert 14 < s["end"] < 16
    assert s["duration"] > 2
```

- [ ] **Step 3: Implement**

```python
# python-pipeline/khutbah_pipeline/detect/silence.py
import re
import subprocess
from khutbah_pipeline.util.ffmpeg import FFMPEG

def detect_silences(audio_path: str, noise_db: float = -35.0, min_duration: float = 1.5) -> list[dict]:
    """Run ffmpeg silencedetect filter and parse silence_start/silence_end events."""
    cmd = [
        FFMPEG, "-hide_banner", "-i", audio_path,
        "-af", f"silencedetect=noise={noise_db}dB:duration={min_duration}",
        "-f", "null", "-",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    text = r.stderr
    starts = [float(m.group(1)) for m in re.finditer(r"silence_start: (\d+\.?\d*)", text)]
    ends = [float(m.group(1)) for m in re.finditer(r"silence_end: (\d+\.?\d*)", text)]
    durations = [float(m.group(1)) for m in re.finditer(r"silence_duration: (\d+\.?\d*)", text)]
    return [
        {"start": s, "end": e, "duration": d}
        for s, e, d in zip(starts, ends, durations)
    ]
```

- [ ] **Step 4: Run, pass, commit**

```bash
pytest tests/test_silence.py -v   # 1 passed
git add python-pipeline/
git commit -m "feat(detect): ffmpeg silencedetect parser"
```

### Task 2.5: faster-whisper transcription wrapper

**Files:**
- Create: `python-pipeline/khutbah_pipeline/detect/transcribe.py`

- [ ] **Step 1: Implement transcribe (no test — too slow for unit test, manual verify)**

```python
# python-pipeline/khutbah_pipeline/detect/transcribe.py
from pathlib import Path
from typing import Optional
from collections import Counter

def transcribe_multilingual(
    audio_path: str,
    model_dir: str,
    device: str = "auto",   # "cuda" if available else "cpu"
    compute_type: str = "auto",
    progress_cb=None,
) -> dict:
    """Two-pass: detect language per chunk, then transcribe with locked language.

    Returns:
      {
        "duration": <seconds>,
        "words": [{"word", "start", "end", "probability", "lang"}],
        "lang_dominant": "ar" | "nl" | "en" | "...",
      }
    """
    from faster_whisper import WhisperModel

    if device == "auto":
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"

    model = WhisperModel(model_dir, device=device, compute_type=compute_type if compute_type != "auto" else "default")
    # Pass 1+2 combined: faster-whisper supports multilingual auto-detect per segment with language=None
    segments, info = model.transcribe(
        audio_path,
        language=None,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    words = []
    lang_counter: Counter[str] = Counter()
    for seg in segments:
        # faster-whisper sets info.language at the file level; for finer granularity
        # we'd run separate detect per chunk, but for now use the file-level lang for all words.
        seg_lang = info.language or "ar"
        for w in (seg.words or []):
            words.append({
                "word": w.word.strip(),
                "start": w.start,
                "end": w.end,
                "probability": w.probability,
                "lang": seg_lang,
            })
            lang_counter[seg_lang] += 1
        if progress_cb:
            progress_cb(seg.end / info.duration if info.duration else 0)
    dominant = lang_counter.most_common(1)[0][0] if lang_counter else "ar"
    return {"duration": info.duration, "words": words, "lang_dominant": dominant}
```

- [ ] **Step 2: Manual verify with the test fixture (downloads model on first run)**

```bash
cd python-pipeline
source .venv/bin/activate
python -c "
from khutbah_pipeline.detect.transcribe import transcribe_multilingual
out = transcribe_multilingual('tests/fixtures/short_khutbah.mp4', '../resources/models/whisper-large-v3')
print(f'lang={out[\"lang_dominant\"]}, words={len(out[\"words\"])}')"
```
Expected: prints language and word count (probably nonsense words for the sine-tone fixture, but no crash).

- [ ] **Step 3: Commit**

```bash
git add python-pipeline/
git commit -m "feat(detect): faster-whisper multilingual transcribe wrapper"
```

### Task 2.6: Detection pipeline orchestrator

**Files:**
- Create: `python-pipeline/khutbah_pipeline/detect/pipeline.py`, `python-pipeline/tests/test_pipeline_unit.py`

- [ ] **Step 1: Write unit test for the pipeline using mock transcript**

```python
# python-pipeline/tests/test_pipeline_unit.py
from khutbah_pipeline.detect.pipeline import run_detection_pipeline

def test_pipeline_finds_boundaries_from_mock_transcript(monkeypatch):
    # Mock transcribe + silence detection so the test is deterministic and fast
    mock_words = (
        [{"word": "بسم", "start": 0, "end": 0.5, "probability": 0.9, "lang": "ar"}]
        + [{"word": "إن", "start": 5.0, "end": 5.3, "probability": 0.95, "lang": "ar"},
           {"word": "الحمد", "start": 5.4, "end": 5.8, "probability": 0.95, "lang": "ar"},
           {"word": "لله", "start": 5.9, "end": 6.3, "probability": 0.95, "lang": "ar"}]
        + [{"word": "...", "start": 7, "end": 900, "probability": 0.9, "lang": "ar"}]
        + [{"word": "onze", "start": 1000.0, "end": 1000.3, "probability": 0.9, "lang": "nl"},
           {"word": "heer", "start": 1000.4, "end": 1000.7, "probability": 0.9, "lang": "nl"},
           {"word": "geef", "start": 1000.8, "end": 1001.0, "probability": 0.9, "lang": "nl"},
           {"word": "ons", "start": 1001.1, "end": 1001.3, "probability": 0.9, "lang": "nl"},
           {"word": "in", "start": 1001.4, "end": 1001.5, "probability": 0.9, "lang": "nl"},
           {"word": "deze", "start": 1001.6, "end": 1001.8, "probability": 0.9, "lang": "nl"},
           {"word": "wereld", "start": 1001.9, "end": 1002.3, "probability": 0.9, "lang": "nl"},
           {"word": "het", "start": 1002.4, "end": 1002.5, "probability": 0.9, "lang": "nl"},
           {"word": "goede", "start": 1002.6, "end": 1003.0, "probability": 0.9, "lang": "nl"}]
    )
    mock_transcript = {"duration": 1100.0, "words": mock_words, "lang_dominant": "ar"}
    mock_silences = [
        {"start": 950.0, "end": 960.0, "duration": 10.0},  # the sitting silence
        {"start": 100.0, "end": 100.5, "duration": 0.5},   # within-speech
    ]
    monkeypatch.setattr("khutbah_pipeline.detect.pipeline._transcribe", lambda *_, **__: mock_transcript)
    monkeypatch.setattr("khutbah_pipeline.detect.pipeline._silences", lambda *_, **__: mock_silences)

    result = run_detection_pipeline(audio_path="ignored", model_dir="ignored")

    assert result["part1"]["start"] == 5.0 - 5.0   # 5s before إن الحمد لله
    assert result["part1"]["end"] == 950.0
    assert result["part2"]["start"] == 960.0
    assert result["part2"]["end"] == 1003.0 + 1.0
    assert result["part1"]["confidence"] > 0.7
    assert result["overall_confidence"] > 0.7
```

- [ ] **Step 2: Implement pipeline**

```python
# python-pipeline/khutbah_pipeline/detect/pipeline.py
from typing import Optional
from khutbah_pipeline.detect.transcribe import transcribe_multilingual
from khutbah_pipeline.detect.silence import detect_silences
from khutbah_pipeline.detect.phrases import find_first_opening, find_last_closing

OPENING_BUFFER = 5.0
DUA_END_BUFFER = 1.0
MIN_PART1_DURATION = 300.0   # 5 min
END_GUARD_SECONDS = 300.0    # 5 min from end ignored for sitting silence

# Indirection so tests can monkeypatch
def _transcribe(audio_path: str, model_dir: str): return transcribe_multilingual(audio_path, model_dir)
def _silences(audio_path: str, noise_db: float, min_duration: float): return detect_silences(audio_path, noise_db, min_duration)

def run_detection_pipeline(
    audio_path: str,
    model_dir: str,
    silence_noise_db: float = -35.0,
    silence_min_duration: float = 1.5,
    progress_cb: Optional[callable] = None,
) -> dict:
    if progress_cb: progress_cb({"stage": "transcribe", "progress": 0})
    transcript = _transcribe(audio_path, model_dir)
    duration = transcript["duration"]
    words = transcript["words"]
    dominant = transcript["lang_dominant"]
    if progress_cb: progress_cb({"stage": "detect_boundaries", "progress": 0.7})

    # Stage 3: opening
    opening = find_first_opening(words)
    if opening is None:
        return {"error": "opening_not_found", "duration": duration, "words": words}

    part1_start = max(0.0, opening["start_time"] - OPENING_BUFFER)
    part1_start_conf = sum(w["probability"] for w in words[opening["start_word_idx"]:opening["end_word_idx"]+1]) / max(1, opening["end_word_idx"] - opening["start_word_idx"] + 1)

    # Stage 4: sitting silence
    silences = _silences(audio_path, silence_noise_db, silence_min_duration)
    valid = [s for s in silences if s["start"] >= part1_start + MIN_PART1_DURATION
                                   and s["end"] <= duration - END_GUARD_SECONDS]
    if not valid:
        return {"error": "sitting_silence_not_found", "duration": duration,
                "part1_start": part1_start, "all_silences": silences}
    longest = max(valid, key=lambda s: s["duration"])
    part1_end = longest["start"]
    part2_start = longest["end"]
    silence_conf = min(longest["duration"] / 3.0, 1.0)

    # Stage 5: dua end
    # Find the index of the first word at/after part2_start
    p2_first_idx = next((i for i, w in enumerate(words) if w["start"] >= part2_start), len(words))
    closing = find_last_closing(words, dominant_lang=dominant, search_from_word=p2_first_idx)
    if closing:
        part2_end = closing["end_time"] + DUA_END_BUFFER
        end_conf = 0.95
    else:
        # Fallback: end of last confident word
        confident = [w for w in words[p2_first_idx:] if w["probability"] > 0.5]
        part2_end = (confident[-1]["end"] + 2.0) if confident else duration
        end_conf = 0.6

    overall = min(part1_start_conf, silence_conf, end_conf)
    return {
        "duration": duration,
        "part1": {"start": part1_start, "end": part1_end, "confidence": part1_start_conf,
                  "transcript_at_start": " ".join(w["word"] for w in words[opening["start_word_idx"]:opening["end_word_idx"]+1])},
        "part2": {"start": part2_start, "end": part2_end, "confidence": end_conf,
                  "transcript_at_end": " ".join(w["word"] for w in words[max(0, len(words)-12):])},
        "all_silences": silences,
        "lang_dominant": dominant,
        "overall_confidence": overall,
    }
```

- [ ] **Step 3: Run, pass, register RPC, commit**

```bash
pytest tests/test_pipeline_unit.py -v   # 1 passed
```

```python
# in __main__.py
from khutbah_pipeline.detect.pipeline import run_detection_pipeline
import os

@register("detect.run")
def _detect(audio_path: str, model_dir: str = ""):
    if not model_dir:
        # default to bundled model location
        model_dir = os.environ.get("KHUTBAH_MODEL_DIR", "../resources/models/whisper-large-v3")
    return run_detection_pipeline(audio_path, model_dir)
```

```bash
git add python-pipeline/
git commit -m "feat(detect): pipeline orchestrator with confidence aggregation"
```

### Task 2.7: Wire detection into Processing screen

**Files:**
- Create: `src/screens/Processing.tsx`

- [ ] **Step 1: Implement Processing screen**

```tsx
// src/screens/Processing.tsx
import { useEffect, useState } from 'react';
import { useProjects } from '../store/projects';
import { useMarkers } from '../editor/markersStore';

type Stage = 'extract_audio' | 'transcribe' | 'detect_boundaries' | 'done';
type Props = { projectId: string; onDone: () => void; onError: (msg: string) => void };

export function Processing({ projectId, onDone, onError }: Props) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useProjects((s) => s.update);
  const setMarker = useMarkers((s) => s.setMarker);
  const reset = useMarkers((s) => s.reset);
  const [stage, setStage] = useState<Stage>('extract_audio');

  useEffect(() => {
    if (!project) return;
    (async () => {
      try {
        setStage('transcribe');
        // Detection pipeline does its own audio extraction inside Whisper; pass source path
        const result = await window.khutbah.pipeline.call<any>('detect.run', { audio_path: project.sourcePath });
        if (result.error === 'opening_not_found') {
          onError('Could not find إن الحمد لله in this audio. Open the editor to mark Part 1 manually.');
          return;
        }
        if (result.error === 'sitting_silence_not_found') {
          onError('Could not detect a clear sitting silence. Open the editor to mark boundaries manually.');
          return;
        }
        setStage('detect_boundaries');
        reset(result.duration);
        setMarker('p1Start', result.part1.start);
        setMarker('p1End', result.part1.end);
        setMarker('p2Start', result.part2.start);
        setMarker('p2End', result.part2.end);
        updateProject(project.id, {
          status: 'processed',
          part1: { start: result.part1.start, end: result.part1.end },
          part2: { start: result.part2.start, end: result.part2.end },
        });
        setStage('done');
        onDone();
      } catch (e) {
        onError(String(e));
      }
    })();
  }, [project?.id]);

  const stages: { key: Stage; label: string }[] = [
    { key: 'extract_audio', label: 'Extracting audio' },
    { key: 'transcribe', label: 'Transcribing (Whisper large-v3)' },
    { key: 'detect_boundaries', label: 'Detecting boundaries' },
  ];
  const stageIdx = stages.findIndex((s) => s.key === stage);

  return (
    <div className="flex-1 p-8 flex items-center justify-center">
      <div className="max-w-md w-full bg-bg-2 border border-border-strong rounded-lg p-6">
        <h2 className="font-display text-xl tracking-wider text-text-strong mb-4">PROCESSING</h2>
        <div className="space-y-3">
          {stages.map((s, i) => (
            <div key={s.key} className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs ${
                i < stageIdx ? 'bg-green/20 border-green text-green' :
                i === stageIdx ? 'bg-amber/20 border-amber text-amber animate-pulse' :
                'bg-bg-3 border-border-strong text-text-muted'
              }`}>{i < stageIdx ? '✓' : i === stageIdx ? '⟳' : '·'}</div>
              <span className={i === stageIdx ? 'text-text-strong' : 'text-text-muted'}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into App routing — after picking a file, go through Processing**

```tsx
// src/App.tsx — add 'processing' screen, change pickAndCreate to land on it
type Screen = ... | { name: 'processing'; projectId: string } | ...;

async function pickAndCreate() {
  const path = await window.khutbah.dialog.openVideo();
  if (!path) return;
  const probe = await window.khutbah.pipeline.call<{ duration: number }>('ingest.probe_local', { path });
  const id = path.replace(/[^a-z0-9]/gi, '_');
  addProject({ id, sourcePath: path, duration: probe.duration, createdAt: Date.now(), status: 'draft' });
  setScreen({ name: 'processing', projectId: id });
}

// In render:
{screen.name === 'processing' && (
  <Processing
    projectId={screen.projectId}
    onDone={() => setScreen({ name: 'editor', projectId: screen.projectId })}
    onError={(msg) => { alert(msg); setScreen({ name: 'editor', projectId: screen.projectId }); }}
  />
)}
```

- [ ] **Step 3: Manual end-to-end on the test khutbah**

```bash
# Download the test khutbah locally first (Phase 3 will automate this)
yt-dlp -f mp4 https://www.youtube.com/watch?v=whrEDiKurFU -o /tmp/test-khutbah.mp4
npm run dev:full
# Pick /tmp/test-khutbah.mp4 → wait for Processing → land in Editor with markers placed
```

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat(processing): run detection pipeline and pre-fill editor markers"
```

### Task 2.8: Confidence badge + transcript snippet UI in Editor

**Files:**
- Modify: `src/screens/Editor.tsx`
- Create: `src/editor/PartInspector.tsx`

- [ ] **Step 1: Create PartInspector**

```tsx
// src/editor/PartInspector.tsx
type Part = { start: number; end: number; confidence?: number; transcript?: string };
type Props = { p1?: Part; p2?: Part };

export function PartInspector({ p1, p2 }: Props) {
  return (
    <div className="space-y-3">
      <PartCard color="amber" label="الخطبة الأولى" data={p1} />
      <PartCard color="green" label="الخطبة الثانية" data={p2} />
    </div>
  );
}

function PartCard({ color, label, data }: { color: 'amber' | 'green'; label: string; data?: Part }) {
  const dur = data ? data.end - data.start : 0;
  const colorClass = color === 'amber' ? 'border-l-amber' : 'border-l-green';
  return (
    <div className={`bg-bg-3 border border-border-strong border-l-4 ${colorClass} rounded p-3`}>
      <div className="flex items-baseline gap-2">
        <span className="font-arabic text-text-strong text-base" dir="rtl">{label}</span>
        <span className="ml-auto text-text-muted text-xs font-mono">{Math.floor(dur / 60)}:{String(Math.floor(dur % 60)).padStart(2, '0')}</span>
      </div>
      {data?.confidence !== undefined && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-green text-xs">{Math.round(data.confidence * 100)}%</span>
          <div className="flex-1 h-1 bg-border-strong rounded overflow-hidden">
            <div className="h-full bg-green" style={{ width: `${data.confidence * 100}%` }} />
          </div>
        </div>
      )}
      {data?.transcript && (
        <div className="mt-2 bg-bg-0 border border-border-strong rounded p-2 font-arabic text-xs text-text-dim leading-relaxed" dir="rtl">
          {data.transcript}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Use in Editor**

Read confidence + transcript out of project meta (extend `Project` type to carry these from Phase 2 detection results) and render `<PartInspector p1={...} p2={...} />` in the right column.

Update `src/store/projects.ts`:
```ts
export type Project = {
  // existing fields...
  part1?: { start: number; end: number; confidence?: number; transcript?: string; outputPath?: string; videoId?: string };
  part2?: { start: number; end: number; confidence?: number; transcript?: string; outputPath?: string; videoId?: string };
};
```

In Processing.tsx, also save `confidence` and `transcript_at_start`/`_at_end`:
```ts
updateProject(project.id, {
  status: 'processed',
  part1: { start: result.part1.start, end: result.part1.end, confidence: result.part1.confidence, transcript: result.part1.transcript_at_start },
  part2: { start: result.part2.start, end: result.part2.end, confidence: result.part2.confidence, transcript: result.part2.transcript_at_end },
});
```

In Editor.tsx, replace the right column placeholder with:
```tsx
import { PartInspector } from '../editor/PartInspector';
<PartInspector p1={project.part1} p2={project.part2} />
```

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "feat(editor): per-part confidence + transcript snippet UI"
```

### Task 2.9: Phase 2 Review Gate (MANDATORY before Phase 3)

Two-reviewer cross-model review of Phase 2 per AGENTS.md §"Code Review Pipeline" Level 2.

- [ ] **Step 1: Capture diff**

```bash
git log --oneline phase-1-complete..HEAD
git diff --stat phase-1-complete..HEAD
```

- [ ] **Step 2: Reviewer A — `superpowers:code-reviewer`**

Phase scope: *"Bundled Whisper large-v3 + multilingual detection pipeline (AR/NL/EN), Arabic text normalization, opening/closing phrase library, silence detection, confidence scoring, Editor pre-fill from auto-detection."*

Particular focus: correctness of Arabic normalization (diacritics, alef forms), phrase-matching boundaries, fallback behavior when opening/closing not found.

- [ ] **Step 3: Reviewer B — `codex` (mode `review`)**

Same diff, same standards.

- [ ] **Step 4: Manual integration check + tag**

Run the canonical test khutbah end-to-end:
```bash
yt-dlp -f mp4 https://www.youtube.com/watch?v=whrEDiKurFU -o /tmp/test-khutbah.mp4
cd python-pipeline && source .venv/bin/activate
python -c "
from khutbah_pipeline.detect.pipeline import run_detection_pipeline
result = run_detection_pipeline('/tmp/test-khutbah.mp4', '../resources/models/whisper-large-v3')
print(f'p1: {result[\"part1\"][\"start\"]:.1f}-{result[\"part1\"][\"end\"]:.1f} (conf={result[\"part1\"][\"confidence\"]:.2f})')
print(f'p2: {result[\"part2\"][\"start\"]:.1f}-{result[\"part2\"][\"end\"]:.1f} (conf={result[\"part2\"][\"confidence\"]:.2f})')
print(f'overall: {result[\"overall_confidence\"]:.2f}, lang: {result[\"lang_dominant\"]}')"
```

Expected: both parts detected with confidence > 0.7. If lower, dig into transcript quality before tagging.

```bash
git tag phase-2-complete
```

---

# PHASE 3 — YOUTUBE INGEST + UPLOAD (~1 week)

Goal: User pastes a YouTube URL → app downloads via yt-dlp → continues into the existing detection + editor pipeline. After export, user clicks "Upload to YouTube" → OAuth (first time) → resumable upload of both parts with thumbnail + full metadata.

### Task 3.1: yt-dlp wrapper

**Files:**
- Create: `python-pipeline/khutbah_pipeline/ingest/youtube.py`, `python-pipeline/tests/test_ingest_youtube.py`

- [ ] **Step 1: Implement (no live test — uses yt-dlp's own URL parser; mock the binary call)**

```python
# python-pipeline/khutbah_pipeline/ingest/youtube.py
import subprocess
import json
import shutil
from pathlib import Path

YT_DLP = shutil.which("yt-dlp") or "yt-dlp"

def info_only(url: str) -> dict:
    """Probe YouTube URL without downloading. Returns title, duration, thumbnail."""
    r = subprocess.run([YT_DLP, "-J", "--no-warnings", url], check=True, capture_output=True, text=True)
    return json.loads(r.stdout)

def download(url: str, output_dir: str, progress_cb=None) -> str:
    """Download best mp4 to output_dir. Returns path to downloaded file."""
    out_template = str(Path(output_dir) / "%(title)s [%(id)s].%(ext)s")
    cmd = [YT_DLP, "-f", "best[ext=mp4]/best", "-o", out_template, "--no-playlist", url]
    if progress_cb:
        cmd += ["--progress-template", "download:%(progress.downloaded_bytes)s/%(progress.total_bytes)s"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out_path = None
    for line in proc.stdout or []:
        if line.startswith("download:"):
            try:
                done, total = line.replace("download:", "").strip().split("/")
                if progress_cb and total != "NA":
                    progress_cb({"stage": "download", "progress": int(done) / int(total)})
            except (ValueError, ZeroDivisionError):
                pass
        if "[download] Destination:" in line:
            out_path = line.split("Destination:", 1)[1].strip()
        if "has already been downloaded" in line:
            out_path = line.split("[download]", 1)[1].split("has already")[0].strip()
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {(proc.stderr.read() if proc.stderr else '')}")
    return out_path or ""
```

- [ ] **Step 2: Register RPC + manual verify with the test khutbah**

```python
# in __main__.py
from khutbah_pipeline.ingest.youtube import info_only, download

@register("ingest.youtube_info")
def _yt_info(url: str): return info_only(url)

@register("ingest.youtube_download")
def _yt_dl(url: str, output_dir: str): return {"path": download(url, output_dir)}
```

```bash
cd python-pipeline && source .venv/bin/activate
python -c "from khutbah_pipeline.ingest.youtube import info_only; print(info_only('https://www.youtube.com/watch?v=whrEDiKurFU')['title'])"
```

- [ ] **Step 3: Commit**

```bash
git add python-pipeline/
git commit -m "feat(ingest): yt-dlp wrapper for YouTube URL info + download"
```

### Task 3.2: NewKhutbah YouTube tab

**Files:**
- Modify: `src/screens/NewKhutbah.tsx`

- [ ] **Step 1: Add YouTube URL input**

```tsx
// src/screens/NewKhutbah.tsx — replace stubs with active tabs
import { useState } from 'react';
import { Button } from '../components/ui/Button';

type Tab = 'youtube' | 'local' | 'dual';
type Props = { onPickFile: () => void; onYoutubeUrl: (url: string) => void; onCancel: () => void };

export function NewKhutbah({ onPickFile, onYoutubeUrl, onCancel }: Props) {
  const [tab, setTab] = useState<Tab>('youtube');
  const [url, setUrl] = useState('');
  const valid = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url);

  return (
    <div className="flex-1 p-8 flex items-center justify-center">
      <div className="max-w-xl w-full bg-bg-2 border border-border-strong rounded-lg p-8">
        <h2 className="font-display text-xl tracking-wider text-text-strong mb-1">NEW KHUTBAH</h2>
        <p className="text-text-muted text-sm mb-6">Choose your input source</p>
        <div className="flex gap-2 mb-6">
          {(['youtube', 'local', 'dual'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} disabled={t === 'dual'}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-semibold ${
                tab === t ? 'bg-amber/15 text-amber border border-amber' :
                'bg-bg-3 text-text-muted border border-border-strong hover:text-text disabled:opacity-50'
              }`}>
              {t === 'youtube' ? 'YouTube URL' : t === 'local' ? 'Local file' : 'Dual file (Phase 4)'}
            </button>
          ))}
        </div>

        {tab === 'youtube' && (
          <div className="space-y-3">
            <input className="w-full bg-bg-0 border border-border-strong rounded p-3 text-text font-mono text-sm"
                   placeholder="https://www.youtube.com/watch?v=..."
                   value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button variant="primary" disabled={!valid} onClick={() => onYoutubeUrl(url)}>
              Start
            </Button>
          </div>
        )}
        {tab === 'local' && (
          <Button variant="primary" onClick={onPickFile}>Pick local file…</Button>
        )}
        <div className="mt-8 flex justify-end">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire YouTube path in App.tsx**

```tsx
async function startFromYoutube(url: string) {
  const id = url.replace(/[^a-z0-9]/gi, '_').slice(-32);
  // Probe info first to populate duration
  const info = await window.khutbah.pipeline.call<any>('ingest.youtube_info', { url });
  // Reserve a temp folder for the download
  const dir = await window.khutbah.paths.defaultOutputDir();
  await window.khutbah.paths.ensureDir(dir);
  const dl = await window.khutbah.pipeline.call<{ path: string }>('ingest.youtube_download', { url, output_dir: dir });
  addProject({ id, sourcePath: dl.path, duration: info.duration, createdAt: Date.now(), status: 'draft' });
  setScreen({ name: 'processing', projectId: id });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "feat(ingest): YouTube URL input that downloads via yt-dlp"
```

### Task 3.3: keytar OAuth token storage

**Files:**
- Create: `electron/auth/keychain.ts`
- Install: `keytar`

- [ ] **Step 1: Install + implement**

```bash
npm install keytar
```

```ts
// electron/auth/keychain.ts
import keytar from 'keytar';

const SERVICE = 'nl.alhimmah.khutbaheditor';
const ACCOUNT = 'youtube-refresh-token';

export const tokens = {
  async getRefreshToken(): Promise<string | null> {
    return keytar.getPassword(SERVICE, ACCOUNT);
  },
  async setRefreshToken(token: string): Promise<void> {
    await keytar.setPassword(SERVICE, ACCOUNT, token);
  },
  async clear(): Promise<void> {
    await keytar.deletePassword(SERVICE, ACCOUNT);
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add electron/ package.json package-lock.json
git commit -m "feat(auth): keytar wrapper for OS keychain refresh-token storage"
```

### Task 3.4: OAuth loopback flow

**Files:**
- Create: `electron/auth/youtube-oauth.ts`

- [ ] **Step 1: Implement OAuth**

```ts
// electron/auth/youtube-oauth.ts
import { shell } from 'electron';
import http from 'http';
import crypto from 'crypto';
import { URL } from 'url';
import { tokens } from './keychain';

// Embedded — public client id is fine for desktop OAuth (no secret needed with PKCE)
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || 'PLACEHOLDER_CLIENT_ID.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
].join(' ');

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export type OAuthTokens = { accessToken: string; expiresAt: number };

export async function signInWithGoogle(): Promise<OAuthTokens> {
  const { verifier, challenge } = pkce();
  const port = await new Promise<number>((res) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => res((s.address() as any).port));
    s.close();
  });
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  const code: string = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (u.pathname !== '/callback') {
        res.writeHead(404); res.end(); return;
      }
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html><body style="font-family:system-ui;background:#0C1118;color:#F5E9C8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div><h1>${err ? '✕ Sign-in failed' : '✓ Signed in to KhutbahEditor'}</h1><p>You can close this window.</p></div>
      </body></html>`);
      server.close();
      if (err) reject(new Error(err));
      else if (c) resolve(c);
      else reject(new Error('No code received'));
    });
    server.listen(port, '127.0.0.1');
    shell.openExternal(authUrl.toString());
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
  const t = await tokenRes.json();
  await tokens.setRefreshToken(t.refresh_token);
  return { accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
}

export async function ensureAccessToken(): Promise<OAuthTokens> {
  const refresh = await tokens.getRefreshToken();
  if (!refresh) throw new Error('not_signed_in');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refresh,
    }),
  });
  if (!r.ok) throw new Error(`Refresh failed: ${await r.text()}`);
  const t = await r.json();
  return { accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
}

export async function signOut(): Promise<void> { await tokens.clear(); }
```

- [ ] **Step 2: Wire IPC + preload**

```ts
// electron/ipc/handlers.ts
import { signInWithGoogle, ensureAccessToken, signOut } from '../auth/youtube-oauth';
import { tokens } from '../auth/keychain';

ipcMain.handle('auth:signIn', () => signInWithGoogle());
ipcMain.handle('auth:status', async () => ({ signedIn: !!(await tokens.getRefreshToken()) }));
ipcMain.handle('auth:signOut', () => signOut());
ipcMain.handle('auth:accessToken', () => ensureAccessToken());
```

```ts
// preload.ts additions
auth: {
  signIn: () => ipcRenderer.invoke('auth:signIn') as Promise<{ accessToken: string; expiresAt: number }>,
  status: () => ipcRenderer.invoke('auth:status') as Promise<{ signedIn: boolean }>,
  signOut: () => ipcRenderer.invoke('auth:signOut') as Promise<void>,
  accessToken: () => ipcRenderer.invoke('auth:accessToken') as Promise<{ accessToken: string; expiresAt: number }>,
},
```

- [ ] **Step 3: Commit (cannot e2e test without real OAuth client id)**

```bash
git add electron/
git commit -m "feat(auth): Google OAuth loopback flow with PKCE for YouTube scope"
```

### Task 3.5: YouTube API client + resumable upload

**Files:**
- Create: `python-pipeline/khutbah_pipeline/upload/youtube_api.py`, `python-pipeline/khutbah_pipeline/upload/resumable.py`

- [ ] **Step 1: Implement resumable upload (single file, chunked)**

```python
# python-pipeline/khutbah_pipeline/upload/resumable.py
import os
import json
import urllib.request
import urllib.error

CHUNK = 8 * 1024 * 1024   # 8 MB per chunk

def _request_json(url: str, method: str, headers: dict, body: bytes | None = None):
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req) as r:
        return r.status, dict(r.headers), (r.read() if r.length else b"")

def initiate_upload(access_token: str, snippet: dict, status: dict, file_size: int, mime: str = "video/mp4") -> str:
    """Returns the upload URL to PUT chunks to."""
    body = json.dumps({"snippet": snippet, "status": status}).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": str(file_size),
        "X-Upload-Content-Type": mime,
    }
    req = urllib.request.Request(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        data=body, method="POST", headers=headers,
    )
    with urllib.request.urlopen(req) as r:
        return r.headers["Location"]

def upload_file(access_token: str, upload_url: str, file_path: str, mime: str = "video/mp4", progress_cb=None) -> dict:
    file_size = os.path.getsize(file_path)
    sent = 0
    video_id = None
    with open(file_path, "rb") as f:
        while sent < file_size:
            chunk = f.read(CHUNK)
            if not chunk: break
            end = sent + len(chunk) - 1
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": mime,
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {sent}-{end}/{file_size}",
            }
            req = urllib.request.Request(upload_url, data=chunk, method="PUT", headers=headers)
            try:
                with urllib.request.urlopen(req) as r:
                    if r.status in (200, 201):
                        video_id = json.loads(r.read())["id"]
                    sent = end + 1
            except urllib.error.HTTPError as e:
                if e.code == 308:  # resume incomplete — that's fine, continue
                    sent = end + 1
                else:
                    raise
            if progress_cb:
                progress_cb({"sent": sent, "total": file_size})
    if not video_id:
        raise RuntimeError("Upload finished without receiving video id")
    return {"video_id": video_id}
```

```python
# python-pipeline/khutbah_pipeline/upload/youtube_api.py
import json
import urllib.request
from khutbah_pipeline.upload.resumable import initiate_upload, upload_file

def upload_video(
    access_token: str,
    file_path: str,
    title: str,
    description: str,
    tags: list[str],
    category_id: str = "27",
    privacy_status: str = "unlisted",
    self_declared_made_for_kids: bool = False,
    default_audio_language: str = "ar",
    progress_cb=None,
) -> dict:
    snippet = {
        "title": title[:100],
        "description": description[:5000],
        "tags": tags[:30],
        "categoryId": category_id,
        "defaultLanguage": default_audio_language,
        "defaultAudioLanguage": default_audio_language,
    }
    status = {
        "privacyStatus": privacy_status,
        "selfDeclaredMadeForKids": self_declared_made_for_kids,
        "embeddable": True,
        "publicStatsViewable": True,
    }
    file_size = __import__("os").path.getsize(file_path)
    upload_url = initiate_upload(access_token, snippet, status, file_size)
    return upload_file(access_token, upload_url, file_path, progress_cb=progress_cb)

def set_thumbnail(access_token: str, video_id: str, thumbnail_path: str) -> dict:
    with open(thumbnail_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(
        f"https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={video_id}",
        data=data, method="POST",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "image/jpeg"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def update_metadata(access_token: str, video_id: str, snippet: dict | None = None, status: dict | None = None) -> dict:
    body = {"id": video_id}
    parts = []
    if snippet: body["snippet"] = snippet; parts.append("snippet")
    if status: body["status"] = status; parts.append("status")
    req = urllib.request.Request(
        f"https://www.googleapis.com/youtube/v3/videos?part={','.join(parts)}",
        data=json.dumps(body).encode("utf-8"), method="PUT",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

- [ ] **Step 2: Register RPC + commit**

```python
# in __main__.py
from khutbah_pipeline.upload.youtube_api import upload_video, set_thumbnail, update_metadata

@register("upload.video")
def _upload(access_token: str, file_path: str, title: str, description: str,
            tags: list, category_id: str = "27", privacy_status: str = "unlisted",
            self_declared_made_for_kids: bool = False, default_audio_language: str = "ar"):
    return upload_video(access_token, file_path, title, description, tags,
                        category_id, privacy_status, self_declared_made_for_kids, default_audio_language)

@register("upload.thumbnail")
def _thumb(access_token: str, video_id: str, thumbnail_path: str):
    return set_thumbnail(access_token, video_id, thumbnail_path)

@register("upload.update_metadata")
def _update(access_token: str, video_id: str, snippet: dict = None, status: dict = None):
    return update_metadata(access_token, video_id, snippet, status)
```

```bash
git add python-pipeline/
git commit -m "feat(upload): YouTube resumable upload + thumbnail + metadata edit RPCs"
```

### Task 3.6: Thumbnail extraction

**Files:**
- Create: `python-pipeline/khutbah_pipeline/edit/thumbnail.py`, `python-pipeline/tests/test_thumbnail.py`

- [ ] **Step 1: Implement**

```python
# python-pipeline/khutbah_pipeline/edit/thumbnail.py
import subprocess
from pathlib import Path
from khutbah_pipeline.util.ffmpeg import FFMPEG

def extract_candidates(src: str, output_dir: str, count: int = 6) -> list[str]:
    """Extract `count` scene-change candidate frames as 1280x720 JPEGs."""
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_template = str(out_dir / "thumb-%02d.jpg")
    subprocess.run([
        FFMPEG, "-y", "-i", src,
        "-vf", f"select='gt(scene,0.3)',scale=1280:720:force_original_aspect_ratio=decrease,"
               f"pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
        "-vsync", "vfr", "-frames:v", str(count), "-q:v", "2",
        out_template,
    ], check=True, capture_output=True)
    return sorted(str(p) for p in out_dir.glob("thumb-*.jpg"))
```

- [ ] **Step 2: Register RPC + commit**

```python
# in __main__.py
from khutbah_pipeline.edit.thumbnail import extract_candidates

@register("edit.thumbnails")
def _thumbs(src: str, output_dir: str, count: int = 6):
    return {"paths": extract_candidates(src, output_dir, count)}
```

```bash
git add python-pipeline/
git commit -m "feat(edit): scene-change thumbnail extraction"
```

### Task 3.7: Upload screen with metadata + thumbnail picker

**Files:**
- Create: `src/screens/Upload.tsx`, `src/upload/ThumbnailPicker.tsx`, `src/upload/MetadataForm.tsx`, `src/lib/templates.ts`

- [ ] **Step 1: Template engine**

```ts
// src/lib/templates.ts
export type TemplateVars = {
  date: string;          // YYYY-MM-DD
  n: number;             // 1 or 2
  lang_suffix: string;   // " (Arabisch)" / " (Nederlands)" / ...
  khatib: string;        // empty string if not set
  other_part_link: string;
};

export function applyTemplate(template: string, vars: TemplateVars): string {
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  // Handle conditional placeholders (drop empty lines)
  s = s.replaceAll('{khatib_line}', vars.khatib ? `\nKhatib: ${vars.khatib}` : '');
  return s;
}

export function langSuffix(lang: 'ar' | 'nl' | 'en' | string): string {
  return { ar: ' (Arabisch)', nl: ' (Nederlands)', en: ' (English)' }[lang as 'ar'] ?? '';
}
```

- [ ] **Step 2: ThumbnailPicker**

```tsx
// src/upload/ThumbnailPicker.tsx
type Props = { paths: string[]; selectedIdx: number; onSelect: (i: number) => void; onUpload: () => void };
export function ThumbnailPicker({ paths, selectedIdx, onSelect, onUpload }: Props) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {paths.map((p, i) => (
        <button key={p} onClick={() => onSelect(i)}
          className={`aspect-video rounded overflow-hidden border-2 ${i === selectedIdx ? 'border-amber shadow-lg shadow-amber/20' : 'border-transparent'}`}>
          <img src={`file://${p}`} alt="" className="w-full h-full object-cover" />
        </button>
      ))}
      <button onClick={onUpload}
        className="aspect-video rounded border border-dashed border-border-slate text-text-muted hover:text-amber hover:border-amber">+</button>
    </div>
  );
}
```

- [ ] **Step 3: Upload screen**

```tsx
// src/screens/Upload.tsx
import { useEffect, useState } from 'react';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ThumbnailPicker } from '../upload/ThumbnailPicker';
import { applyTemplate, langSuffix } from '../lib/templates';

type Props = { projectId: string; onBack: () => void };
type PartUpload = {
  title: string;
  description: string;
  tags: string[];
  visibility: 'public' | 'unlisted' | 'private';
  madeForKids: boolean;
  thumbs: string[];
  thumbIdx: number;
  uploading: boolean;
  videoId?: string;
  progress: number;
  error?: string;
};

export function Upload({ projectId, onBack }: Props) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useProjects((s) => s.update);
  const { settings, load } = useSettings();
  const [signedIn, setSignedIn] = useState(false);
  const [parts, setParts] = useState<{ p1: PartUpload; p2: PartUpload } | null>(null);

  useEffect(() => { load(); window.khutbah.auth.status().then((s) => setSignedIn(s.signedIn)); }, [load]);

  // Initialize per-part upload state from templates + extract thumbnails
  useEffect(() => {
    if (!project || !settings || !project.part1?.outputPath || !project.part2?.outputPath) return;
    (async () => {
      const date = new Date(project.createdAt).toISOString().slice(0, 10);
      const thumbsDir1 = project.part1!.outputPath! + '.thumbs';
      const thumbsDir2 = project.part2!.outputPath! + '.thumbs';
      const t1 = await window.khutbah.pipeline.call<{ paths: string[] }>('edit.thumbnails', { src: project.part1!.outputPath, output_dir: thumbsDir1, count: 6 });
      const t2 = await window.khutbah.pipeline.call<{ paths: string[] }>('edit.thumbnails', { src: project.part2!.outputPath, output_dir: thumbsDir2, count: 6 });
      const lang1 = 'ar'; const lang2 = 'nl';   // wire to detection result later
      const mkPart = (n: 1 | 2, lang: string, thumbs: string[], otherLink: string): PartUpload => {
        const vars = { date, n, lang_suffix: langSuffix(lang), khatib: settings.khatibName, other_part_link: otherLink };
        return {
          title: applyTemplate(settings.titleTemplate, vars),
          description: applyTemplate(settings.descriptionTemplate, vars),
          tags: [...settings.defaultTags, lang === 'ar' ? 'arabisch' : lang === 'nl' ? 'nederlands' : 'english'],
          visibility: settings.defaultVisibility,
          madeForKids: settings.defaultMadeForKids,
          thumbs,
          thumbIdx: Math.min(2, thumbs.length - 1),
          uploading: false,
          progress: 0,
        };
      };
      setParts({
        p1: mkPart(1, lang1, t1.paths, ''),
        p2: mkPart(2, lang2, t2.paths, ''),
      });
    })();
  }, [project?.id, settings]);

  async function uploadOne(which: 'p1' | 'p2') {
    if (!parts) return;
    const filePart = which === 'p1' ? project!.part1! : project!.part2!;
    const meta = parts[which];
    setParts((p) => p && ({ ...p, [which]: { ...p[which], uploading: true, progress: 0, error: undefined } }));
    try {
      const { accessToken } = await window.khutbah.auth.accessToken();
      const r = await window.khutbah.pipeline.call<{ video_id: string }>('upload.video', {
        access_token: accessToken,
        file_path: filePart.outputPath,
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        category_id: settings!.defaultCategoryId,
        privacy_status: meta.visibility,
        self_declared_made_for_kids: meta.madeForKids,
        default_audio_language: which === 'p1' ? 'ar' : 'nl',
      });
      // Upload thumbnail
      await window.khutbah.pipeline.call('upload.thumbnail', {
        access_token: accessToken, video_id: r.video_id,
        thumbnail_path: meta.thumbs[meta.thumbIdx],
      });
      setParts((p) => p && ({ ...p, [which]: { ...p[which], uploading: false, progress: 100, videoId: r.video_id } }));
      updateProject(project!.id, {
        [which === 'p1' ? 'part1' : 'part2']: { ...filePart, videoId: r.video_id } as any,
        status: 'uploaded',
      });
    } catch (e) {
      setParts((p) => p && ({ ...p, [which]: { ...p[which], uploading: false, error: String(e) } }));
    }
  }

  if (!project || !settings || !parts) return <div className="p-8 text-text-muted">Preparing upload…</div>;
  if (!signedIn) return (
    <div className="p-8">
      <p className="mb-4">Sign in with Google to upload to YouTube.</p>
      <Button variant="primary" onClick={async () => { await window.khutbah.auth.signIn(); setSignedIn(true); }}>Sign in with Google</Button>
    </div>
  );

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" onClick={onBack}>← Back</Button>
          <h2 className="font-display text-2xl tracking-wider text-text-strong">UPLOAD TO YOUTUBE</h2>
        </div>
        <div className="grid grid-cols-2 gap-6">
          {(['p1', 'p2'] as const).map((k) => {
            const m = parts[k];
            return (
              <div key={k} className="bg-bg-2 border border-border-strong rounded-lg p-4 space-y-3">
                <div className="font-arabic text-text-strong" dir="rtl">{k === 'p1' ? 'الخطبة الأولى' : 'الخطبة الثانية'}</div>
                <input className="w-full bg-bg-0 border border-border-strong rounded p-2 text-text-strong text-sm font-semibold"
                       value={m.title} onChange={(e) => setParts((p) => p && ({ ...p, [k]: { ...p[k], title: e.target.value } }))} />
                <textarea rows={5} className="w-full bg-bg-0 border border-border-strong rounded p-2 text-text text-sm"
                          value={m.description} onChange={(e) => setParts((p) => p && ({ ...p, [k]: { ...p[k], description: e.target.value } }))} />
                <ThumbnailPicker paths={m.thumbs} selectedIdx={m.thumbIdx}
                  onSelect={(i) => setParts((p) => p && ({ ...p, [k]: { ...p[k], thumbIdx: i } }))}
                  onUpload={() => alert('Custom upload coming next')} />
                <div className="flex gap-2 text-xs">
                  {(['public', 'unlisted', 'private'] as const).map((v) => (
                    <button key={v} onClick={() => setParts((p) => p && ({ ...p, [k]: { ...p[k], visibility: v } }))}
                      className={`flex-1 px-2 py-1 rounded ${m.visibility === v ? 'bg-amber/15 text-amber border border-amber' : 'bg-bg-0 border border-border-strong text-text-muted'}`}>{v}</button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-text-muted">
                  <input type="checkbox" checked={m.madeForKids} onChange={(e) => setParts((p) => p && ({ ...p, [k]: { ...p[k], madeForKids: e.target.checked } }))} />
                  Made for kids (COPPA)
                </label>
                {m.error && <div className="text-[#d97757] text-xs">{m.error}</div>}
                {m.uploading && <ProgressBar value={m.progress} label="Uploading…" />}
                {m.videoId && <div className="text-green text-xs">✓ Uploaded · <a href={`https://youtube.com/watch?v=${m.videoId}`} target="_blank" rel="noreferrer">View</a></div>}
                {!m.videoId && <Button variant="upload" onClick={() => uploadOne(k)}>↑ Upload</Button>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add navigation entry from Editor + commit**

In `src/screens/Editor.tsx` add an "Upload to YouTube ↑" button in the action bar that sets the screen to `{ name: 'upload', projectId }`. Wire that screen in App.tsx routing.

```bash
git add src/
git commit -m "feat(upload): UI with metadata, thumbnail picker, and per-part resumable upload"
```

### Task 3.8: Phase 3 Review Gate (MANDATORY before Phase 4)

Two-reviewer cross-model review of Phase 3 per AGENTS.md §"Code Review Pipeline" Level 2.

This phase touches **two security-sensitive surfaces** (OAuth flow, YouTube API client). Both reviewers must specifically address:

- OAuth loopback redirect security (port binding to 127.0.0.1 only, PKCE verifier handling, state parameter)
- Refresh-token storage in keychain (no logging, no plain-text fallback)
- YouTube API error handling matrix (401 refresh, 403 quota, 5xx backoff)
- yt-dlp argument escaping (URL is user input — must not allow injection)

- [ ] **Step 1: Capture diff**

```bash
git log --oneline phase-2-complete..HEAD
git diff --stat phase-2-complete..HEAD
```

- [ ] **Step 2: Reviewer A — `superpowers:code-reviewer`**

Phase scope: *"yt-dlp YouTube ingest, OAuth loopback flow with PKCE, keytar refresh-token storage, resumable YouTube upload, scene-extraction thumbnails, full Upload screen with metadata templates."*

- [ ] **Step 3: Reviewer B — `codex` (mode `review`)**

Same diff, same standards. Particularly value Codex's perspective on the OAuth state machine.

- [ ] **Step 4: Codex adversarial pass (`codex` mode `challenge`)**

Run an adversarial pass specifically against `electron/auth/youtube-oauth.ts` and `python-pipeline/khutbah_pipeline/upload/`. Treat any successful break as blocking.

- [ ] **Step 5: Reconcile + tag**

```bash
git tag phase-3-complete
```

---

# PHASE 4 — AUTO-PILOT + DUAL-FILE + SETTINGS POLISH (~1 week)

Goal: Settings-driven auto-pilot end-to-end (URL → notification with two YouTube links). Dual-file mode for separate audio/video alignment.

### Task 4.1: Auto-pilot orchestrator

**Files:**
- Create: `src/lib/autopilot.ts`, modify `src/App.tsx`

- [ ] **Step 1: Implement orchestrator**

```ts
// src/lib/autopilot.ts
import { Project } from '../store/projects';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { applyTemplate, langSuffix } from './templates';

export async function runAutoPilot(project: Project, onStage: (stage: string, progress?: number) => void) {
  onStage('detect', 0);
  const detection = await window.khutbah.pipeline.call<any>('detect.run', { audio_path: project.sourcePath });
  if (detection.error) throw new Error(detection.error);

  if (detection.overall_confidence < 0.9) {
    return { mode: 'manual_review', detection };
  }

  // Export both parts
  onStage('export', 0);
  const dir = await window.khutbah.paths.defaultOutputDir();
  await window.khutbah.paths.ensureDir(dir);
  const base = `${project.id}-${Date.now()}`;
  const p1Out = `${dir}/${base}-deel-1.mp4`;
  const p2Out = `${dir}/${base}-deel-2.mp4`;
  await window.khutbah.pipeline.call('edit.smart_cut', {
    src: project.sourcePath, dst: p1Out, start: detection.part1.start, end: detection.part1.end,
  });
  onStage('export', 50);
  await window.khutbah.pipeline.call('edit.smart_cut', {
    src: project.sourcePath, dst: p2Out, start: detection.part2.start, end: detection.part2.end,
  });
  onStage('export', 100);

  // Upload
  const settings = useSettings.getState().settings!;
  const { accessToken } = await window.khutbah.auth.accessToken();
  const date = new Date(project.createdAt).toISOString().slice(0, 10);
  const langs = ['ar', detection.lang_dominant];
  onStage('upload', 0);
  const ids: { p1?: string; p2?: string } = {};
  for (const [n, out, lang] of [[1, p1Out, langs[0]], [2, p2Out, langs[1]]] as const) {
    const vars = { date, n, lang_suffix: langSuffix(lang), khatib: settings.khatibName, other_part_link: '' };
    const r = await window.khutbah.pipeline.call<{ video_id: string }>('upload.video', {
      access_token: accessToken,
      file_path: out,
      title: applyTemplate(settings.titleTemplate, vars),
      description: applyTemplate(settings.descriptionTemplate, vars),
      tags: settings.defaultTags,
      category_id: settings.defaultCategoryId,
      privacy_status: settings.defaultVisibility,
      self_declared_made_for_kids: settings.defaultMadeForKids,
      default_audio_language: lang,
    });
    if (n === 1) ids.p1 = r.video_id; else ids.p2 = r.video_id;
    onStage('upload', n === 1 ? 50 : 100);
  }

  // Update store
  useProjects.getState().update(project.id, {
    status: 'uploaded',
    part1: { start: detection.part1.start, end: detection.part1.end, outputPath: p1Out, videoId: ids.p1 },
    part2: { start: detection.part2.start, end: detection.part2.end, outputPath: p2Out, videoId: ids.p2 },
  });
  return { mode: 'auto_complete', ids };
}
```

- [ ] **Step 2: Wire Auto-pilot path in App.tsx**

After `pickAndCreate` / `startFromYoutube`, if `settings.autoPilot`, run `runAutoPilot(project, ...)` from the Processing screen. If it returns `manual_review`, fall through to Editor; if `auto_complete`, jump to a "Done" toast with YouTube links.

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "feat(autopilot): end-to-end ingest → detect → export → upload orchestrator"
```

### Task 4.2: OS-native completion notification

**Files:**
- Modify: `electron/main.ts` (handler), `electron/ipc/handlers.ts`

- [ ] **Step 1: Add notification handler**

```ts
// electron/ipc/handlers.ts
import { Notification } from 'electron';
ipcMain.handle('notify', (_e, args: { title: string; body: string; clickUrl?: string }) => {
  const n = new Notification({ title: args.title, body: args.body });
  if (args.clickUrl) n.on('click', () => require('electron').shell.openExternal(args.clickUrl!));
  n.show();
});
```

- [ ] **Step 2: Preload + use in autopilot**

```ts
// preload.ts
notify: (args: { title: string; body: string; clickUrl?: string }) => ipcRenderer.invoke('notify', args),
```

In `runAutoPilot` after success:
```ts
await window.khutbah.notify({
  title: 'KhutbahEditor — both parts uploaded',
  body: `Part 1 + Part 2 are live on YouTube.`,
  clickUrl: ids.p1 ? `https://youtube.com/watch?v=${ids.p1}` : undefined,
});
```

- [ ] **Step 3: Commit**

```bash
git add electron/ src/
git commit -m "feat(autopilot): native completion notification with YouTube link"
```

### Task 4.3: FFT cross-correlation alignment

**Files:**
- Create: `python-pipeline/khutbah_pipeline/align/crosscorr.py`, `python-pipeline/tests/test_crosscorr.py`

- [ ] **Step 1: Write tests with synthetic offset**

```python
# python-pipeline/tests/test_crosscorr.py
import numpy as np
from khutbah_pipeline.align.crosscorr import align_audio_arrays

def test_align_recovers_known_offset():
    sr = 16000
    duration = 10
    t = np.linspace(0, duration, sr * duration, endpoint=False)
    base = np.sin(2 * np.pi * 440 * t).astype(np.float32)
    # Insert 1.5s offset
    offset_samples = int(1.5 * sr)
    delayed = np.concatenate([np.zeros(offset_samples, dtype=np.float32), base])[:len(base)]
    detected, conf = align_audio_arrays(delayed, base, sr=sr)
    assert abs(detected - 1.5) < 0.01
    assert conf > 5.0
```

- [ ] **Step 2: Implement**

```python
# python-pipeline/khutbah_pipeline/align/crosscorr.py
import numpy as np
import scipy.signal
import scipy.io.wavfile as wav
import subprocess
from khutbah_pipeline.util.ffmpeg import FFMPEG

def _bandpass(x: np.ndarray, sr: int, low: float = 200, high: float = 3400) -> np.ndarray:
    sos = scipy.signal.butter(4, [low, high], btype='band', fs=sr, output='sos')
    return scipy.signal.sosfilt(sos, x).astype(np.float32)

def align_audio_arrays(sig: np.ndarray, ref: np.ndarray, sr: int = 16000) -> tuple[float, float]:
    """Returns (offset_seconds, confidence_ratio).
    Positive offset means `sig` lags `ref` by that many seconds."""
    sig_f = _bandpass(sig, sr)
    ref_f = _bandpass(ref, sr)
    xcorr = scipy.signal.correlate(sig_f, ref_f, mode='full', method='fft')
    peak = int(np.argmax(np.abs(xcorr)))
    offset_samples = peak - (len(ref_f) - 1)
    confidence = float(np.abs(xcorr[peak]) / max(1e-9, np.median(np.abs(xcorr))))
    return offset_samples / sr, confidence

def _extract_pcm16k(path: str) -> np.ndarray:
    out = subprocess.run([
        FFMPEG, "-hide_banner", "-i", path, "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", "-f", "wav", "-",
    ], check=True, capture_output=True)
    import io
    sr, data = wav.read(io.BytesIO(out.stdout))
    return data.astype(np.float32) / 32768.0

def align_files(video_path: str, audio_path: str) -> dict:
    ref = _extract_pcm16k(video_path)
    sig = _extract_pcm16k(audio_path)
    # Trim to common length to keep arrays manageable
    n = min(len(ref), len(sig))
    offset, conf = align_audio_arrays(sig[:n], ref[:n])
    return {"offset_seconds": offset, "confidence": conf}
```

- [ ] **Step 3: Pass test, register RPC, commit**

```bash
pytest tests/test_crosscorr.py -v   # 1 passed
```

```python
# in __main__.py
from khutbah_pipeline.align.crosscorr import align_files

@register("align.dual_file")
def _align(video_path: str, audio_path: str): return align_files(video_path, audio_path)
```

```bash
git add python-pipeline/
git commit -m "feat(align): FFT cross-correlation for dual-file audio↔video sync"
```

### Task 4.4: Dual-file UI + mux

**Files:**
- Modify: `src/screens/NewKhutbah.tsx`, add IPC for second file picker
- Create: `python-pipeline/khutbah_pipeline/edit/mux.py`

- [ ] **Step 1: Mux helper**

```python
# python-pipeline/khutbah_pipeline/edit/mux.py
import subprocess
from khutbah_pipeline.util.ffmpeg import FFMPEG

def apply_offset_and_mux(video_path: str, audio_path: str, offset_seconds: float, dst: str):
    """Mux video + offset-shifted audio, dropping the original camera audio."""
    args = [FFMPEG, "-y", "-i", video_path]
    if offset_seconds >= 0:
        args += ["-itsoffset", str(offset_seconds), "-i", audio_path]
    else:
        args += ["-ss", str(-offset_seconds), "-i", audio_path]
    args += ["-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", dst]
    subprocess.run(args, check=True, capture_output=True)
```

- [ ] **Step 2: Register RPC + dialog handler for audio file**

```ts
// electron/ipc/handlers.ts
ipcMain.handle('dialog:openAudio', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
```

```python
# in __main__.py
from khutbah_pipeline.edit.mux import apply_offset_and_mux

@register("edit.apply_offset_mux")
def _mux(video_path: str, audio_path: str, offset_seconds: float, dst: str):
    apply_offset_and_mux(video_path, audio_path, offset_seconds, dst)
    return {"path": dst}
```

- [ ] **Step 3: Enable Dual-file tab in NewKhutbah, wire to App.tsx**

In NewKhutbah enable the third tab, add two file pickers (video + audio), and a "Start" button. App handler:

```ts
async function startDualFile(videoPath: string, audioPath: string) {
  const dir = await window.khutbah.paths.defaultOutputDir();
  await window.khutbah.paths.ensureDir(dir);
  const aligned = `${dir}/aligned-${Date.now()}.mp4`;
  const align = await window.khutbah.pipeline.call<{ offset_seconds: number; confidence: number }>('align.dual_file', { video_path: videoPath, audio_path: audioPath });
  if (align.confidence < 5) {
    alert(`Alignment confidence low (${align.confidence.toFixed(1)}). Will use offset ${align.offset_seconds.toFixed(2)}s; you can adjust in editor.`);
  }
  await window.khutbah.pipeline.call('edit.apply_offset_mux', { video_path: videoPath, audio_path: audioPath, offset_seconds: align.offset_seconds, dst: aligned });
  const probe = await window.khutbah.pipeline.call<{ duration: number }>('ingest.probe_local', { path: aligned });
  const id = aligned.replace(/[^a-z0-9]/gi, '_').slice(-32);
  addProject({ id, sourcePath: aligned, duration: probe.duration, createdAt: Date.now(), status: 'draft' });
  setScreen({ name: 'processing', projectId: id });
}
```

- [ ] **Step 4: Commit**

```bash
git add electron/ src/ python-pipeline/
git commit -m "feat(align): dual-file mode UI + automatic alignment + mux"
```

### Task 4.5: Phase 4 Review Gate (MANDATORY before Phase 5)

Two-reviewer cross-model review of Phase 4 per AGENTS.md §"Code Review Pipeline" Level 2.

- [ ] **Step 1: Capture diff**

```bash
git log --oneline phase-3-complete..HEAD
git diff --stat phase-3-complete..HEAD
```

- [ ] **Step 2: Reviewer A — `superpowers:code-reviewer`**

Phase scope: *"Auto-pilot end-to-end orchestrator (URL/file → notification with YouTube links), OS-native completion notifications, FFT cross-correlation alignment for dual-file mode, Settings polish."*

Particular focus: race conditions in the auto-pilot orchestrator, FFT correlation correctness, error propagation when auto-pilot encounters partial failures (export succeeded but upload failed, etc.).

- [ ] **Step 3: Reviewer B — `codex` (mode `review`)**

Same diff, same standards.

- [ ] **Step 4: Manual smoke test of auto-pilot end-to-end**

```bash
# Sign in to a test YouTube account, paste the canonical test khutbah URL,
# click Start, walk away, confirm desktop notification fires with YouTube links
# Check: both videos exist on YouTube, correct visibility, correct titles, correct thumbnails
```

- [ ] **Step 5: Reconcile + tag**

```bash
git tag phase-4-complete
```

---

# PHASE 5 — CROSS-PLATFORM BUILDS, POLISH, SHIP (~1 week)

Goal: All three platforms produce installable artifacts. README documents bypass for unsigned apps. electron-updater wired up. v1.0.0 tagged.

### Task 5.1: First-run welcome + sign-in to YouTube

**Files:**
- Create: `src/screens/Welcome.tsx`

- [ ] **Step 1: Implement Welcome screen**

```tsx
// src/screens/Welcome.tsx
import { Logo } from '../components/Logo';
import { Button } from '../components/ui/Button';

type Props = { onSignIn: () => void; onSkip: () => void };
export function Welcome({ onSignIn, onSkip }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <Logo className="h-24 mx-auto mb-6" />
        <h1 className="font-display text-3xl tracking-widest text-text-strong mb-3">WELCOME</h1>
        <p className="text-text-muted mb-8">Sign in with your YouTube account to enable one-click publishing.</p>
        <div className="flex gap-3 justify-center">
          <Button variant="ghost" onClick={onSkip}>Skip for now</Button>
          <Button variant="upload" onClick={onSignIn}>Sign in with Google</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Show on first run**

In `App.tsx`, on mount check `await window.khutbah.auth.status()`; if `!signedIn` AND no projects exist, show Welcome. Otherwise normal Library.

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "feat(welcome): first-run sign-in screen"
```

### Task 5.2: electron-updater integration

**Files:**
- Modify: `electron/main.ts`
- Install: `electron-updater`

- [ ] **Step 1: Install + wire**

```bash
npm install electron-updater
```

```ts
// electron/main.ts
import { autoUpdater } from 'electron-updater';

app.whenReady().then(async () => {
  // ... existing
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => console.error('autoUpdater error', e));
  }
});
```

Configure publish target in `electron-builder.json`:
```json
"publish": [{ "provider": "github", "owner": "Frequence-xx", "repo": "KhutbahEditor" }]
```

- [ ] **Step 2: Commit**

```bash
git add electron/ electron-builder.json package.json package-lock.json
git commit -m "feat(updater): electron-updater wired to GitHub Releases"
```

### Task 5.3: Documentation (README + INSTALL + USAGE + PRIVACY)

**Files:**
- Update: `README.md`
- Create: `docs/INSTALL.md`, `docs/USAGE.md`, `docs/PRIVACY.md`

- [ ] **Step 1: Write INSTALL.md**

```markdown
# Installing KhutbahEditor

KhutbahEditor ships unsigned, so each OS shows a one-time security warning. Here's how to bypass each.

## macOS (.dmg)

1. Download `KhutbahEditor-X.Y.Z-mac-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel) from the [Releases page](https://github.com/Frequence-xx/KhutbahEditor/releases).
2. Open the DMG and drag KhutbahEditor.app into your Applications folder.
3. **First launch only:** right-click (or Control-click) KhutbahEditor.app → click **Open** → confirm in the dialog.
4. After this, double-click works normally.

## Windows (.exe)

1. Download `KhutbahEditor-X.Y.Z-win-x64.exe` from the [Releases page](https://github.com/Frequence-xx/KhutbahEditor/releases).
2. Double-click. Windows SmartScreen will warn "Windows protected your PC".
3. Click **More info** → **Run anyway**.
4. The installer wizard will guide you the rest of the way.

## Linux

### AppImage (universal)
1. Download `KhutbahEditor-X.Y.Z-linux-x64.AppImage`.
2. Make it executable: `chmod +x KhutbahEditor-*.AppImage`.
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

This is intentional — KhutbahEditor runs fully offline for processing.
```

- [ ] **Step 2: Write USAGE.md**

```markdown
# Using KhutbahEditor

## Quick start (auto-pilot)

1. Open KhutbahEditor.
2. First time: sign in with Google (one-time per machine, stored in OS keychain).
3. Click **+ New Khutbah** → paste a YouTube URL or pick a local video file → click Start.
4. Walk away. The app downloads (if needed), transcribes, detects boundaries, exports two normalized .mp4 files, and uploads both to YouTube.
5. You'll get a desktop notification when both parts are live.

## What the auto-pilot does

For each khutbah:
- Detects when the khatib starts with `إن الحمد لله` (start of Part 1)
- Detects the sitting silence (end of Part 1 / start of Part 2)
- Detects the end of the dua (end of Part 2)
- Cuts both parts with frame-accurate boundaries
- Normalizes audio to YouTube's loudness standard (-14 LUFS)
- Uploads with title, description, tags, thumbnail (auto-picked scene-change frame), and visibility (default: Unlisted)

## Manual review

If detection confidence is below 90 %, the app opens the Editor with markers pre-placed. Drag any marker to fine-tune, preview, then click **Upload to YouTube**.

## Settings

Open the gear icon (top-right) to configure:
- Title, description, and tag templates
- Default visibility (Public / Unlisted / Private)
- Khatib name
- Audio normalization target
- Auto-pilot on/off
```

- [ ] **Step 3: Write PRIVACY.md**

```markdown
# Privacy

KhutbahEditor processes everything locally on your machine. No video, audio, or metadata leaves your device except:

1. **YouTube uploads** — only when you initiate them, only to the YouTube account you sign in with.
2. **YouTube downloads** — only when you paste a YouTube URL.
3. **OAuth refresh tokens** — stored encrypted in your operating system's keychain (macOS Keychain Access, Windows Credential Manager, Linux Secret Service via libsecret). Never sent to any server other than Google's OAuth endpoints.

We do not run any servers, do not collect telemetry, do not have an analytics pipeline.

## What we store on your device

- Settings (your preferences) — `~/.config/KhutbahEditor/` or platform equivalent
- OAuth refresh token — OS keychain
- Library metadata — same settings dir
- Output videos — `~/Movies/KhutbahEditor/` (Mac) or `~/Videos/KhutbahEditor/` (Windows/Linux)
- Whisper model + binaries — inside the app bundle

## Removing all data

Uninstall the app, then:
- Delete `~/Movies/KhutbahEditor/` (or your custom output dir)
- Delete `~/.config/KhutbahEditor/` (Mac/Linux) or `%APPDATA%\KhutbahEditor\` (Windows)
- Open KhutbahEditor's Settings → Sign Out before uninstalling, or manually clear "KhutbahEditor" entries from your OS keychain
```

- [ ] **Step 4: Update README.md to link to these docs**

```markdown
# KhutbahEditor

Self-contained desktop app to edit and publish Friday khutbah videos to YouTube.

- 📥 [Install instructions](docs/INSTALL.md)
- 📖 [Usage guide](docs/USAGE.md)
- 🔒 [Privacy](docs/PRIVACY.md)
- 🛠 [Contributing](docs/CONTRIBUTING.md)

## Status

v1.0.0 — first stable release. Cross-platform (macOS, Windows, Linux), unsigned. See [INSTALL.md](docs/INSTALL.md) for one-time per-OS bypass instructions.

## Development

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs/
git commit -m "docs: install + usage + privacy + README polish for v1.0.0"
```

### Task 5.4: Cross-platform build verification

**Files:** none new — verifies build matrix works.

- [ ] **Step 1: Build all 3 platforms locally where possible**

```bash
# Mac (on Mac)
npm run package -- --mac --x64 --arm64

# Windows (on Windows or via electron-builder Linux Wine setup)
npm run package -- --win --x64

# Linux (on Linux)
npm run package -- --linux AppImage deb --x64
```

Verify each artifact in `release/` opens and runs.

- [ ] **Step 2: Test the bypass instructions on each OS**

Use the steps in `docs/INSTALL.md` exactly as a fresh user would. Confirm app opens on first launch.

- [ ] **Step 3: Push to git, trigger CI**

```bash
git push origin main
```

Watch GitHub Actions: confirm matrix builds pass, artifacts upload to a test release.

- [ ] **Step 4: No code commit needed if everything passes — verification step.**

### Task 5.5: Phase 5 + Pre-release review gate (Level 3)

This is the **most rigorous** gate — six checks, all must pass before tagging v1.0.0. Per AGENTS.md §"Level 3 — Pre-release review".

- [ ] **Step 1: Capture release diff**

```bash
git log --oneline phase-4-complete..HEAD
git diff --stat phase-4-complete..HEAD
# For full release diff (after first release: vN-1..HEAD)
```

- [ ] **Step 2: Reviewer A — `superpowers:code-reviewer`** against the full Phase 5 diff

Phase scope: *"First-run welcome screen, electron-updater integration, full documentation set (INSTALL/USAGE/PRIVACY/README), cross-platform build verification."*

- [ ] **Step 3: Reviewer B — `codex` (mode `review`)** against the same diff

- [ ] **Step 4: Adversarial pass — `codex` (mode `challenge`)**

Try to break: OAuth flow, file path handling, IPC argument validation, FFmpeg command construction, AppImage / .dmg / .exe extraction. Any successful break is a release blocker.

- [ ] **Step 5: `security-review` skill**

Run against the full release diff. Particular focus on:
- OAuth: token storage, scope minimization, redirect-URI validation
- IPC: every `ipcMain.handle` validates inputs from the renderer
- FFmpeg: argument escaping (yt-dlp URL is user input)
- File paths: no path traversal in output dir construction

- [ ] **Step 6: Flakiness gate — full suite × 3 consecutive runs**

```bash
for i in 1 2 3; do
  echo "=== Run $i ==="
  npm test || exit 1
  cd python-pipeline && timeout 300 pytest -m "not integration" || exit 1
  cd ..
done
echo "✓ Three consecutive passes — flakiness gate cleared"
```

### Task 5.6: Tag v1.0.0 release

**Files:** none — release tag.

- [ ] **Step 1: Final manual QA on the canonical test khutbah**

```bash
# Open KhutbahEditor (any platform), paste https://www.youtube.com/watch?v=whrEDiKurFU
# Confirm: download → detect → export → upload → notification with YouTube links
# Visit YouTube, confirm both parts uploaded with correct titles/thumbnails/visibility=Unlisted
```

- [ ] **Step 2: Tag and push**

```bash
git tag -a v1.0.0 -m "KhutbahEditor v1.0.0 — first release

Self-contained khutbah video editor for macOS, Windows, Linux.
Auto-detects Part 1 (إن الحمد لله) and Part 2 (dua end), normalizes
audio to -14 LUFS, uploads both parts to YouTube.

Multilingual: Arabic + Dutch + English."
git push origin v1.0.0
```

- [ ] **Step 3: Wait for CI release job, verify Releases page shows all 5 artifacts**

```
KhutbahEditor-1.0.0-mac-x64.dmg
KhutbahEditor-1.0.0-mac-arm64.dmg
KhutbahEditor-1.0.0-win-x64.exe
KhutbahEditor-1.0.0-linux-x64.AppImage
KhutbahEditor-1.0.0-linux-x64.deb
```

- [ ] **Step 4: Announce on alhimmah.nl with link to releases**

(Out of scope for this plan — coordinate with mosque comms.)

---

## Self-Review Notes

### Spec coverage check

| Spec section | Plan coverage |
|---|---|
| §3 Architecture | Phase 0 (Tasks 0.5, 0.6, 0.7, 0.8, 0.10) |
| §4 Detection pipeline | Phase 2 (Tasks 2.2-2.7) |
| §5 Audio/video processing | Phase 1 (Tasks 1.6, 1.7) |
| §5.5 Dual-file alignment | Phase 4 (Tasks 4.3, 4.4) |
| §6 UI screens | Library/NewKhutbah/Editor (Phase 1), Processing (2.7), Upload (3.7), Settings (1.9), Welcome (5.1) |
| §7 OAuth + upload | Phase 3 (Tasks 3.3-3.7) |
| §8 Packaging | Phase 0 (0.10), Phase 5 (5.4, 5.5) |
| §11 Defaults | Settings store (Task 1.9) — defaults match spec defaults table |
| §12 Input formats | Local file picker filter (Task 1.3), audio picker filter (Task 4.4) |

### Type consistency

- `Project.part1`/`part2` fields used consistently across `store/projects.ts`, `Editor`, `Upload`, `autopilot.ts`
- `MarkerKey` in `markersStore.ts` matches the four boundaries used by Timeline and Editor
- Python: `transcribe_multilingual` returns `{duration, words[], lang_dominant}` consumed identically by `pipeline.py` and the `detect.run` RPC
- IPC channels: every `ipcRenderer.invoke('X:Y')` has a matching `ipcMain.handle('X:Y', ...)` and `contextBridge.exposeInMainWorld` entry

### Known gaps (acceptable)

- **No live OAuth integration test** in CI — would require a test Google account with OAuth client. Manual verification flagged in Task 3.4.
- **No live YouTube upload integration test** in CI — same reason, plus quota cost. Manual verification flagged in Task 3.7 and Task 5.5.
- **Whisper model verification on the actual test khutbah** is manual (Task 2.7 step 3, Task 2.9 step 4, Task 5.6 step 1) — running large-v3 in CI would balloon CI time.
- **Code signing** intentionally absent (per spec §8.3, §11).
- **Phase review gates** (Tasks 0.14, 1.10, 2.9, 3.8, 4.5) are mandatory two-reviewer cross-model checks per AGENTS.md §"Code Review Pipeline" — they are the structural backbone of code quality on this project.

These manual-verification gates are appropriate for a Phase 5 release process; automating them is a future hardening task.
