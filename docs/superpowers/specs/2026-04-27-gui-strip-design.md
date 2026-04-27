# KhutbahEditor — GUI strip & two-pane redesign

**Status:** approved 2026-04-27, supersedes the renderer/UI sections of [2026-04-25-khutbah-editor-design.md](2026-04-25-khutbah-editor-design.md).
**Scope:** renderer (React + Electron) only. The Python pipeline, RPC contract, and Electron main-process supervision stay as-is.

---

## 1. Why this exists

The pipeline is now publish-ready on autopilot. Validated end-to-end on three real sources:

- Iziyi 34-min Arabic khutbah — overall confidence 0.84
- v6yLY17uMQE — Dutch body, Part 1 lands at 3:09
- kIez3BaExFQ — Dutch body, Arabic closing fragment, lipsync "perfect first try" at SyncNet consensus + 50 ms

The original spec said: *"auto-pilot ON by default; editor opens only when confidence < 90 %."* The renderer was built like a primary workspace anyway — custom canvas timeline, marker drag handlers, frame-step keyboard shortcuts, proxy regeneration loop. That UI is no longer load-bearing.

This spec strips the editor down to a thin review surface. The new app is closer in spirit to a project dashboard than a video editor.

Constraints carried over:
- Don't break the Python sidecar's RPC contract (`pipeline.run_full`, `detect.run`, `edit.smart_cut`, `upload.video`, etc.).
- TypeScript strict mode stays on.
- Brand tokens stay sourced from `tailwind.config.js` (no hex values in components).
- Don't tune per-source detection heuristics during the strip — the team's "cuts: good-enough is good-enough" rule still applies (small boundary errors are acceptable; per-source tuning risks regressing other sources).

---

## 2. Architecture & shell

Single Electron window. Two-pane layout: fixed-width sidebar (~240 px) on the left, right pane fills the rest. The sidebar is always visible. The right pane swaps content based on what's selected.

State lives in two Zustand stores:

- **`projects`** (existing, persisted) — extended with three new fields per project: `runState`, `progress?`, `lastError?`, `thumbnailPath?`.
- **`ui`** (new, persisted) — holds `selectedProjectId` and `view: 'review' | 'upload' | 'settings'`. Restored on app start so the user lands back where they left off.

A new singleton **`JobManager`** owns long-running pipeline calls and survives screen switches. It lives in the renderer (the Electron main process is unchanged), wraps `window.khutbah.pipeline.call(...)`, subscribes to `pipeline.onProgress`, and updates the project's `runState` + `progress` in the Zustand store. One job per project at a time; multiple projects can run jobs in parallel. JobManager keeps an internal `Map<projectId, AbortController>` to track in-flight work.

No React Router. The right pane is a switch on `view` + `selectedProject.runState`.

---

## 3. Right pane states

Seven states, switched on `view` + the selected project's `runState`:

1. **Empty / no project selected.** Centered placeholder with the brand mark + a single `+ New khutbah` button. Shown on first launch and when the last selected project is deleted.

2. **New khutbah modal** (overlay over whatever's in the right pane). Three tabs: YouTube URL / Local file / Dual-file. Submitting closes the modal, creates the project in the sidebar (status: detecting, gold pulse), and kicks off `detect.run` via JobManager. The right pane stays where it was — the user can keep reviewing the previously-selected project.

3. **Detecting** (`runState: 'detecting'`). Inline progress bar in the right pane: Audio extraction → Transcribe → Detect boundaries, with ETA. Same UI pattern as the current `Processing.tsx`, but inline rather than full-screen.

4. **Review** (`runState: 'needs_review' | 'ready'`). The focused-player layout:
   - 16:9 player at the top showing `part1.mp4` (default) or `part2.mp4`.
   - Tab row: `[Part 1] [Part 2]` — gold = active.
   - Detail card: confidence badge, time range (`mm:ss → mm:ss`), per-boundary nudge buttons (`Start −5s` / `Start +5s` / `End −5s` / `End +5s`).
   - Bottom-right: `[Accept & upload]` (green primary).
   - If `runState: 'needs_review'` (one or both parts < 90% confidence), the low-confidence part's confidence badge is amber and the active tab defaults to the lower-confidence part.

5. **Upload** (triggered by `Accept & upload`, `runState: 'uploading'`). Right pane swaps to upload UI: account picker, playlist picker, title (pre-filled from project name + Part 1/2 suffix), thumbnail picker, Upload button. Both parts uploaded in sequence; progress shown inline. The user can navigate away mid-upload — JobManager keeps it running, sidebar badge becomes blue when done.

6. **Error / interrupted** (`runState: 'error'`). Error card showing what failed (detection / cut / upload), the underlying message, and a `[Retry]` button. Retry resumes from the failed stage.

7. **Settings** (`view: 'settings'`). Right pane swaps to Settings: compute device, output dir, YouTube account list (sign in / sign out), default playlist, default title template. Going back: click any sidebar project.

**Nudge action.** Clicking `Start +5s` on Part 1 calls `JobManager.startCut(projectId, 'p1Start', +5)`, which calls `edit.smart_cut` with the new boundary, replaces `part1.mp4`, and reloads the inline player. Debounced ~250 ms so rapid clicks don't thrash. While a cut is in flight the project's `runState` is `'cutting'` (sidebar dot pulses gold).

---

## 4. Sidebar

Thumbnail rows, newest project first. Each row:

- 48×32 thumbnail (extracted from source on project creation, stored as `thumbnailPath`).
- Colored status dot in the top-right corner of the thumbnail, keyed off `runState`:
  - gray = `idle`
  - gold (pulsing) = `detecting`, `cutting`, `uploading`
  - amber = `needs_review`
  - green = `ready`
  - blue = `uploaded`
  - red = `error`
- Project name (truncated with ellipsis).
- One-line subtitle: e.g., `Detecting · 78%`, `Uploaded · 2h ago`, `Idle · 5d ago`.

Above the list: a single `+ New khutbah` primary button. Below the list: a small `⚙ Settings` button (low-emphasis, sets `view: 'settings'`).

Project deletion: hover row → a small × appears on the right; clicking opens a confirm dialog (`Delete "<name>"? This removes the project and its produced files.`). Cannot delete a project while it has an in-flight job.

---

## 5. Component map

### New files (renderer)

| File | Purpose | LOC est. |
|---|---|---|
| `src/screens/Shell.tsx` | Two-pane shell, owns `selectedProjectId` + `view`. Replaces App.tsx routing. | ~120 |
| `src/components/Sidebar.tsx` | Project list, `+ New khutbah`, Settings button. | ~140 |
| `src/components/StatusDot.tsx` | Colored dot keyed off `runState`. | ~30 |
| `src/components/NewKhutbahModal.tsx` | 3-tab input modal lifted from current `NewKhutbah.tsx`. | ~110 |
| `src/components/ReviewPane.tsx` | Player + Part 1/2 tabs + detail card + Accept button. | ~180 |
| `src/components/UploadPane.tsx` | Account / playlist / title / thumbnail / Upload — adapted from current `Upload.tsx`. | ~250 |
| `src/components/SettingsPane.tsx` | Settings — adapted from current `Settings.tsx` + `AccountsSection.tsx`. | ~180 |
| `src/components/EmptyState.tsx` | First-launch empty pane. | ~30 |
| `src/components/ErrorPane.tsx` | Error/interrupted state with Retry. | ~50 |
| `src/components/DetectingPane.tsx` | Inline detection progress (lifted from `Processing.tsx`). | ~80 |
| `src/components/Toaster.tsx` | Bottom-right toast for background-job completion + errors. | ~60 |
| `src/jobs/JobManager.ts` | Singleton: per-project job tracking, progress subscription, runState updates. | ~150 |
| `src/jobs/types.ts` | `JobKind`, `JobState`, etc. | ~30 |
| `src/store/ui.ts` | `selectedProjectId`, `view`, persisted. | ~40 |

### Files modified

| File | Change |
|---|---|
| `src/App.tsx` (353 → ~80) | Rendered tree shrinks to `<Shell />`. Most logic moves to Shell + JobManager. Keeps `maybeAutoPilot()` entry point. |
| `src/store/projects.ts` | Add `runState`, `progress`, `lastError`, `thumbnailPath` to `Project`. Add `setRunState`, `setProgress`, `setError` setters. |
| `src/lib/autopilot.ts` | Calls `JobManager.startDetect → onComplete → startUpload` instead of inline RPC sequence. |

### Files deleted

| File | LOC | Reason |
|---|---|---|
| `src/editor/Timeline.tsx` | 523 | Custom canvas timeline + scrubber + marker drag. Replaced by inline `<video>`. |
| `src/editor/VideoPreview.tsx` | 186 | Custom proxy player. Replaced by native `<video>` of part1.mp4 / part2.mp4. |
| `src/editor/PartInspector.tsx` | 44 | Inline marker editor. Replaced by detail card in ReviewPane. |
| `src/editor/markersStore.ts` | 48 | Marker state + clamp logic. Boundaries now live on the project, not in a transient store. |
| `src/editor/useShortcuts.ts` | 70 | Frame-step keyboard shortcuts. Not needed without scrubber. |
| `src/screens/Editor.tsx` | 826 | The whole editor screen. runDetection / regenerateProxy / exportBoth move into JobManager + ReviewPane. |
| `src/screens/Processing.tsx` | 168 | Replaced by `DetectingPane.tsx` (inline, simpler). |
| `src/screens/Welcome.tsx` | 22 | Replaced by `EmptyState`. |
| `src/screens/Library.tsx` | 36 | Replaced by `Sidebar`. |
| `src/screens/NewKhutbah.tsx` | 74 | Replaced by `NewKhutbahModal`. |
| `tests/renderer/Editor.markersFromProject.test.ts` | 45 | Marker store gone. |
| `tests/renderer/markersStore.test.ts` | 35 | Marker store gone. |

**Net code change.** Roughly **−2 100 LOC** of editor/screen code, **+1 350 LOC** of new shell/components/JobManager. Net **−750 LOC** in the renderer with sharper boundaries.

**RPC surface unchanged.** All the same `pipeline.call(...)` methods. The Python sidecar contract is untouched.

---

## 6. Data flow & job lifecycle

### Project shape (extended)

```ts
type RunState =
  | 'idle'         // never run
  | 'detecting'    // detect.run in flight
  | 'cutting'      // edit.smart_cut in flight (after a nudge)
  | 'needs_review' // detection done, one or both parts < 90% confidence
  | 'ready'        // detection done, both parts ≥ 90%
  | 'uploading'    // upload.video in flight
  | 'uploaded'     // both parts uploaded successfully
  | 'error'        // last job failed; lastError holds the message

interface Project {
  // ...existing fields (id, sourcePath, part1, part2, etc.)
  runState: RunState
  progress?: number       // 0–100, only valid while runState ends in -ing
  lastError?: string      // human-readable, cleared on next successful job
  thumbnailPath?: string  // ~120×80 jpg for the sidebar row
}
```

### JobManager API

```ts
class JobManager {
  startDetect(projectId): void
  startCut(projectId, boundary, deltaSec): void   // for nudges
  startUpload(projectId, opts): void
  retry(projectId): void                          // resumes from project.lastFailedKind
  cancel(projectId): void                         // for in-flight jobs
}
```

Each `start*` call:

1. Sets `project.runState` to the in-flight state and `progress = 0`.
2. Calls the RPC and subscribes to `pipeline.onProgress` for that project.
3. On progress event, updates `project.progress` (Zustand setter; sidebar dot + DetectingPane re-render automatically).
4. On success, transitions to the next `runState` (e.g. `detecting → needs_review | ready`) and writes results to the project.
5. On failure, sets `runState = 'error'` and `lastError = err.message`. Toast notifies if the project isn't currently selected.

### Concurrency rules

- One job per project. Starting a new job on a project with one already in flight cancels the previous one (debounced ~250 ms for nudges).
- Multiple projects can run jobs in parallel — there is no global serialization.
- `JobManager.cancel(projectId)` aborts the in-flight job and reverts `runState` to the prior stable state (e.g. `'detecting'` → `'idle'`).

### Selection & view persistence

`selectedProjectId` and `view` live in the new `ui` Zustand store and are persisted to disk. Re-opening the app restores both.

### Toasts

A `Toaster` at bottom-right. Three triggers:

- A background job finishes successfully on a non-selected project.
- Any job errors (selected or not).
- Successful upload completion always notifies (even on the active project).

### Auto-pilot path

`lib/autopilot.ts` calls `JobManager.startDetect → onComplete → startUpload`. The same UI receives progress updates whether triggered manually or by autopilot. The autopilot entry point in `App.tsx` (`maybeAutoPilot()`) is preserved.

### Settings impact on running jobs

Compute device is read at job-start time, not at app-start. Changing it in Settings affects the *next* job, not jobs already running.

### Thumbnail generation

`thumbnailPath` is populated by `JobManager.startDetect` as its first step (before audio extraction): a single call to `edit.thumbnails` (or equivalent ffmpeg one-shot) on the source at the 30-second mark, written to the project cache dir. Cheap (~100 ms). If the source file isn't yet available (YouTube source mid-download), the thumbnail is generated after `ingest.youtube_download` finishes. Sidebar rows render a neutral placeholder while `thumbnailPath` is undefined.

### Upload sequencing

`startUpload` uploads Part 1, then Part 2. If Part 1 fails, Part 2 is not attempted; `runState = 'error'`, `lastError` carries Part 1's message, and Retry resumes from Part 1. If Part 1 succeeds and Part 2 fails, Retry resumes from Part 2 only (Part 1's `videoId` is preserved on the project so it isn't re-uploaded).

---

## 7. Testing strategy

**Renderer unit tests (Vitest, jsdom)** — one per non-trivial component:

| Test file | What it covers |
|---|---|
| `tests/renderer/JobManager.test.ts` | runState transitions for each start* method; failure paths set runState=error + lastError; nudge debounce cancels in-flight cut; concurrent jobs across two projects don't collide. |
| `tests/renderer/Sidebar.test.tsx` | Renders projects newest-first; status dot color matches runState; clicking a row calls `select(projectId)`; pulse animation only on detecting/cutting/uploading. |
| `tests/renderer/StatusDot.test.tsx` | Each runState produces the right color + accessible label. |
| `tests/renderer/ReviewPane.test.tsx` | Tab switch swaps the `<video src>`; clicking a nudge button calls `JobManager.startCut` with the right delta + boundary; Accept calls `setView('upload')`. |
| `tests/renderer/NewKhutbahModal.test.tsx` | YouTube tab submits with URL; Local tab submits with file path; Dual-file requires both audio + video; closing the modal preserves the previously selected project. |
| `tests/renderer/UploadPane.test.tsx` | Title pre-fill from project name; Upload triggers `JobManager.startUpload`; in-flight upload disables the button; account picker calls `auth.listAccounts`. |
| `tests/renderer/SettingsPane.test.tsx` | Compute device persisted via `settings.set`; OAuth sign-in / sign-out calls; default-playlist persisted. |
| `tests/renderer/EmptyState.test.tsx` | Brand mark + `+ New khutbah` button render; clicking opens the modal. |
| `tests/renderer/ErrorPane.test.tsx` | Renders lastError; Retry calls `JobManager.retry`. |
| `tests/renderer/projects.runState.test.ts` | Project store: `setRunState`, `setProgress`, `setError` setters; persisted shape includes the new fields. |
| `tests/renderer/Toaster.test.tsx` | Toast appears on background-job completion when project isn't selected; auto-dismisses after N seconds; click dismisses immediately. |

**Tests deleted**

- `tests/renderer/Editor.markersFromProject.test.ts` — marker store gone.
- `tests/renderer/markersStore.test.ts` — marker store gone.

**Tests kept as-is**

- `tests/renderer/autopilot.authFailure.test.ts` (works against the new JobManager once `autopilot.ts` is updated).
- `tests/renderer/eta.test.ts` (pure function, unchanged).
- `tests/renderer/fileUrl.test.ts` (unchanged).

**E2E (Playwright)** — one smoke test for the new shell:

- Launch Electron with a fixture-prefilled project store containing one `ready` project + one `error` project + one `uploaded` project.
- Verify sidebar renders 3 rows with the right status dots.
- Click the `ready` project → ReviewPane visible with player + tabs.
- Click `+ New khutbah` → modal opens; cancel closes it; previous project still selected.
- Click Settings → SettingsPane visible; click any sidebar project → returns to that project.

**Pipeline tests.** No changes — Python sidecar isn't touched.

**Test policy.** 300 s suite timeout, 30 s per test (matches `vitest.config.ts`). No mocking of FFmpeg/Whisper. The renderer tests mock the RPC bridge (`window.khutbah.pipeline.call`) at the seam, not the sidecar.

---

## 8. Out of scope

- **Pipeline changes.** No detection heuristic tuning, no new sidecar modules. The pipeline is validated; leave it alone.
- **External-editor handoff.** Dropped — the in-app player + nudges + Retry cover the cases that matter. If a user wants to edit in DaVinci/Final Cut they can find the source file themselves.
- **Detection-parameter UI.** No exposing VAD thresholds, silence windows, or compute-graph knobs in Settings. We agreed not to chase per-source perfection.
- **Multi-window.** Single window stays. No sub-windows for editor vs library vs settings.
- **Frame-accurate scrubbing.** No timeline scrubber; the in-app player is just the native HTML5 `<video>` element on the produced part1.mp4 / part2.mp4 files.
- **i18n of the UI.** English remains the only UI language; Arabic strings are content (titles, etc.).

---

## 9. Open questions

None at spec time. If implementation surfaces new questions (e.g., concrete debounce duration, exact thumbnail dimensions, toast auto-dismiss timeout), the implementation plan resolves them inline rather than re-opening this spec.

---

## 10. References

- [2026-04-25-khutbah-editor-design.md](2026-04-25-khutbah-editor-design.md) — original design (pipeline + RPC contract sections still authoritative).
- `CLAUDE.md` — project conventions, anti-sycophancy posture, test policy.
- `AGENTS.md` — reviewer persona + quality gates.
- Memories: `gui_strip_plan.md`, `cuts_good_enough_is_good_enough.md`, `khutbah_av_sync_lessons.md`.
