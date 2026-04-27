# GUI strip & two-pane redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the heavy Electron editor (Timeline + marker drag + proxy regen) with a thin two-pane review surface, backed by a singleton `JobManager` for background per-project work. Renderer-only refactor; the Python sidecar and RPC contract are unchanged.

**Architecture:** Two-pane Electron window — fixed sidebar (project list with status dots) + right pane that swaps between Empty / Detecting / Review / Upload / Settings / Error states. A `JobManager` singleton owns long-running pipeline calls per `projectId` and survives screen switches. `lib/autopilot.ts` is rewired to call `JobManager` instead of inlining RPC calls.

**Tech Stack:** Electron 30, React 18, TypeScript 5 (strict), Tailwind 3, Zustand 4 (with persist middleware), Vitest 1 + @testing-library/react 16 (jsdom), Playwright 1.

**Spec:** `docs/superpowers/specs/2026-04-27-gui-strip-design.md` (commit `ef6113f`).

**Conventions reminder (CLAUDE.md):**
- TDD strict — failing test first, then implement.
- One commit per task with the message at the end of the task. Conventional commits.
- Test timeout: 300 s suite, 30 s per test.
- No mocks of FFmpeg / Whisper. Mock the IPC seam (`window.khutbah.pipeline.call`) only.
- TypeScript strict mode is non-negotiable.
- Brand tokens come from `tailwind.config.js`.
- Don't tune detection heuristics in the pipeline — out of scope.

---

## Phase 1 — Foundation

### Task 1: Extend `Project` with `runState`, `progress`, `lastError`, `thumbnailPath`

**Files:**
- Modify: `src/store/projects.ts`
- Test: `tests/renderer/projects.runState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/projects.runState.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjects } from '../../src/store/projects';

const seed = (overrides = {}) => ({
  id: 'p1',
  sourcePath: '/tmp/src.mp4',
  duration: 120,
  createdAt: 1,
  runState: 'idle' as const,
  ...overrides,
});

describe('projects store — runState fields', () => {
  beforeEach(() => {
    useProjects.setState({ projects: [] });
  });

  it('add() persists a project with runState=idle by default', () => {
    useProjects.getState().add(seed());
    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('idle');
    expect(p.progress).toBeUndefined();
    expect(p.lastError).toBeUndefined();
    expect(p.thumbnailPath).toBeUndefined();
  });

  it('setRunState() updates only runState and clears progress', () => {
    useProjects.getState().add(seed({ runState: 'detecting', progress: 42 }));
    useProjects.getState().setRunState('p1', 'ready');
    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('ready');
    expect(p.progress).toBeUndefined();
  });

  it('setProgress() updates progress without changing runState', () => {
    useProjects.getState().add(seed({ runState: 'detecting' }));
    useProjects.getState().setProgress('p1', 73);
    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('detecting');
    expect(p.progress).toBe(73);
  });

  it('setError() sets runState=error and lastError; clears progress', () => {
    useProjects.getState().add(seed({ runState: 'detecting', progress: 50 }));
    useProjects.getState().setError('p1', 'sidecar crash');
    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('error');
    expect(p.lastError).toBe('sidecar crash');
    expect(p.progress).toBeUndefined();
  });

  it('migration v1: legacy "draft" status maps to runState=idle', () => {
    const persisted = { state: { projects: [{ id: 'old', sourcePath: '/x', duration: 1, createdAt: 1, status: 'draft' }] }, version: 0 };
    const migrated = useProjects.persist.options.migrate!(persisted.state, 0) as { projects: any[] };
    expect(migrated.projects[0].runState).toBe('idle');
    expect(migrated.projects[0].status).toBeUndefined();
  });

  it('migration v1: legacy "uploaded" status maps to runState=uploaded', () => {
    const persisted = { state: { projects: [{ id: 'old', sourcePath: '/x', duration: 1, createdAt: 1, status: 'uploaded' }] }, version: 0 };
    const migrated = useProjects.persist.options.migrate!(persisted.state, 0) as { projects: any[] };
    expect(migrated.projects[0].runState).toBe('uploaded');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/projects.runState.test.ts`
Expected: FAIL — `setRunState`/`setProgress`/`setError` don't exist; `runState` field absent.

- [ ] **Step 3: Implement the changes in `src/store/projects.ts`**

Replace the file's contents:

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type RunState =
  | 'idle'
  | 'detecting'
  | 'cutting'
  | 'needs_review'
  | 'ready'
  | 'uploading'
  | 'uploaded'
  | 'error';

export type PartUploadResult = {
  videoId?: string;
  status: 'pending' | 'uploading' | 'done' | 'failed';
  error?: string;
};

export type Part = {
  start: number;
  end: number;
  confidence?: number;
  transcript?: string;
  outputPath?: string;
  uploads?: Record<string, PartUploadResult>;
  videoId?: string;
};

export type Project = {
  id: string;
  sourcePath: string;
  proxyPath?: string;
  proxySkipped?: boolean;
  duration: number;
  createdAt: number;
  runState: RunState;
  progress?: number;
  lastError?: string;
  thumbnailPath?: string;
  part1?: Part;
  part2?: Part;
};

type State = {
  projects: Project[];
  add: (p: Project) => void;
  update: (id: string, patch: Partial<Project>) => void;
  remove: (id: string) => void;
  setRunState: (id: string, runState: RunState) => void;
  setProgress: (id: string, progress: number) => void;
  setError: (id: string, message: string) => void;
};

const STATUS_TO_RUN_STATE: Record<string, RunState> = {
  draft: 'idle',
  processed: 'ready',
  uploaded: 'uploaded',
  failed: 'error',
};

export const useProjects = create<State>()(
  persist(
    (set) => ({
      projects: [],
      add: (p) => set((s) => ({ projects: [{ runState: 'idle', ...p }, ...s.projects] })),
      update: (id, patch) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      remove: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
      setRunState: (id, runState) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, runState, progress: undefined } : p,
          ),
        })),
      setProgress: (id, progress) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, progress } : p)),
        })),
      setError: (id, message) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id
              ? { ...p, runState: 'error' as const, lastError: message, progress: undefined }
              : p,
          ),
        })),
    }),
    {
      name: 'khutbah-projects',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => {
        if (version === 0) {
          const old = persistedState as { projects?: Array<Record<string, unknown>> };
          const projects = (old.projects ?? []).map((p) => {
            const status = typeof p.status === 'string' ? p.status : undefined;
            const { status: _drop, ...rest } = p;
            void _drop;
            return { ...rest, runState: STATUS_TO_RUN_STATE[status ?? 'draft'] ?? 'idle' };
          });
          return { projects };
        }
        return persistedState;
      },
    },
  ),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/projects.runState.test.ts`
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Run the full renderer suite to confirm no regressions**

Run: `npx vitest run tests/renderer`
Expected: PASS for `eta`, `fileUrl`, `autopilot.authFailure`, `projects.runState`. The two marker tests (Editor.markersFromProject, markersStore) are still passing because we haven't touched the markers store yet.

- [ ] **Step 6: Commit**

```bash
git add src/store/projects.ts tests/renderer/projects.runState.test.ts
git commit -m "$(cat <<'EOF'
feat(store): extend Project with runState/progress/lastError/thumbnailPath

Adds the RunState union and three setters (setRunState, setProgress,
setError). Includes a v0 → v1 persist migration that maps the legacy
status field (draft/processed/uploaded/failed) into the richer runState
union.

Foundational change for the GUI strip — JobManager and ReviewPane will
read these fields directly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create `ui` Zustand store (selectedProjectId + view, persisted)

**Files:**
- Create: `src/store/ui.ts`
- Test: `tests/renderer/ui.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/ui.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useUi } from '../../src/store/ui';

describe('ui store', () => {
  beforeEach(() => {
    useUi.setState({ selectedProjectId: null, view: 'review' });
  });

  it('defaults: no project selected, view=review', () => {
    const s = useUi.getState();
    expect(s.selectedProjectId).toBeNull();
    expect(s.view).toBe('review');
  });

  it('select() sets selectedProjectId and resets view to review', () => {
    useUi.setState({ view: 'settings' });
    useUi.getState().select('proj-1');
    expect(useUi.getState().selectedProjectId).toBe('proj-1');
    expect(useUi.getState().view).toBe('review');
  });

  it('setView() changes view without clearing selectedProjectId', () => {
    useUi.getState().select('proj-1');
    useUi.getState().setView('settings');
    expect(useUi.getState().selectedProjectId).toBe('proj-1');
    expect(useUi.getState().view).toBe('settings');
  });

  it('clearSelection() resets selectedProjectId to null', () => {
    useUi.getState().select('proj-1');
    useUi.getState().clearSelection();
    expect(useUi.getState().selectedProjectId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/ui.test.ts`
Expected: FAIL — module `../../src/store/ui` not found.

- [ ] **Step 3: Implement `src/store/ui.ts`**

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type View = 'review' | 'upload' | 'settings';

type State = {
  selectedProjectId: string | null;
  view: View;
  select: (id: string) => void;
  setView: (view: View) => void;
  clearSelection: () => void;
};

export const useUi = create<State>()(
  persist(
    (set) => ({
      selectedProjectId: null,
      view: 'review',
      select: (id) => set({ selectedProjectId: id, view: 'review' }),
      setView: (view) => set({ view }),
      clearSelection: () => set({ selectedProjectId: null }),
    }),
    { name: 'khutbah-ui', storage: createJSONStorage(() => localStorage) },
  ),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/ui.ts tests/renderer/ui.test.ts
git commit -m "feat(store): add ui store for selectedProjectId + view (persisted)

Tracks the active project and the right-pane view (review/upload/settings)
across app restarts. Used by Shell to drive the right-pane swap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: JobManager skeleton (types + class shell + factory)

**Files:**
- Create: `src/jobs/types.ts`
- Create: `src/jobs/JobManager.ts`
- Test: `tests/renderer/JobManager.skeleton.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/JobManager.skeleton.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import type { Bridge } from '../../src/jobs/types';
import { useProjects } from '../../src/store/projects';

const makeBridge = (): Bridge => ({
  call: vi.fn(),
  onProgress: vi.fn(() => () => {}),
});

describe('JobManager — skeleton', () => {
  beforeEach(() => {
    useProjects.setState({ projects: [] });
  });

  it('exposes startDetect / startCut / startUpload / retry / cancel methods', () => {
    const jm = new JobManager(makeBridge());
    expect(typeof jm.startDetect).toBe('function');
    expect(typeof jm.startCut).toBe('function');
    expect(typeof jm.startUpload).toBe('function');
    expect(typeof jm.retry).toBe('function');
    expect(typeof jm.cancel).toBe('function');
  });

  it('isRunning(projectId) returns false when no job is in flight', () => {
    const jm = new JobManager(makeBridge());
    expect(jm.isRunning('proj-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/JobManager.skeleton.test.ts`
Expected: FAIL — `JobManager` and `Bridge` not found.

- [ ] **Step 3: Implement `src/jobs/types.ts`**

```ts
export type JobKind = 'detect' | 'cut' | 'upload';

export type Boundary = 'p1Start' | 'p1End' | 'p2Start' | 'p2End';

export type UploadOpts = {
  channelId: string;
  playlistId?: string;
  title: string;
  thumbnailPath?: string;
};

export type ProgressEvent = {
  projectId: string;
  stage: string;
  pct: number;
};

export interface Bridge {
  call<T>(method: string, params?: unknown): Promise<T>;
  onProgress(listener: (ev: ProgressEvent) => void): () => void;
}
```

- [ ] **Step 4: Implement `src/jobs/JobManager.ts`**

```ts
import type { Boundary, Bridge, JobKind, UploadOpts } from './types';

type InFlight = {
  kind: JobKind;
  abort: AbortController;
};

export class JobManager {
  private inFlight = new Map<string, InFlight>();
  constructor(private bridge: Bridge) {}

  startDetect(_projectId: string): void {
    throw new Error('not implemented');
  }
  startCut(_projectId: string, _boundary: Boundary, _deltaSec: number): void {
    throw new Error('not implemented');
  }
  startUpload(_projectId: string, _opts: UploadOpts): void {
    throw new Error('not implemented');
  }
  retry(_projectId: string): void {
    throw new Error('not implemented');
  }
  cancel(projectId: string): void {
    const job = this.inFlight.get(projectId);
    if (job) {
      job.abort.abort();
      this.inFlight.delete(projectId);
    }
  }
  isRunning(projectId: string): boolean {
    return this.inFlight.has(projectId);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/renderer/JobManager.skeleton.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/jobs/types.ts src/jobs/JobManager.ts tests/renderer/JobManager.skeleton.test.ts
git commit -m "feat(jobs): JobManager skeleton + types

Empty class shape with methods that throw 'not implemented' (cancel +
isRunning are real). Subsequent tasks implement startDetect, startCut,
startUpload, retry, and the progress wiring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — JobManager core

### Task 4: `JobManager.startDetect` — happy path + error path

**Files:**
- Modify: `src/jobs/JobManager.ts`
- Test: `tests/renderer/JobManager.startDetect.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/JobManager.startDetect.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import type { Bridge, ProgressEvent } from '../../src/jobs/types';
import { useProjects } from '../../src/store/projects';

const seed = () =>
  useProjects.setState({
    projects: [
      { id: 'p1', sourcePath: '/tmp/src.mp4', duration: 120, createdAt: 1, runState: 'idle' },
    ],
  });

describe('JobManager.startDetect', () => {
  beforeEach(() => {
    seed();
  });

  it('transitions runState idle → detecting → ready when overall_confidence >= 0.9', async () => {
    let resolve!: (v: unknown) => void;
    const callPromise = new Promise((r) => { resolve = r; });
    const bridge: Bridge = {
      call: vi.fn(() => callPromise),
      onProgress: vi.fn(() => () => {}),
    };
    const jm = new JobManager(bridge);

    jm.startDetect('p1');
    expect(useProjects.getState().projects[0].runState).toBe('detecting');

    resolve({
      duration: 200,
      part1: { start: 10, end: 100, confidence: 0.95 },
      part2: { start: 110, end: 200, confidence: 0.92 },
      lang_dominant: 'ar',
      overall_confidence: 0.93,
    });
    await Promise.resolve();
    await Promise.resolve();

    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('ready');
    expect(p.part1?.confidence).toBe(0.95);
    expect(p.part2?.confidence).toBe(0.92);
  });

  it('transitions to needs_review when overall_confidence < 0.9', async () => {
    const bridge: Bridge = {
      call: vi.fn(() =>
        Promise.resolve({
          duration: 200,
          part1: { start: 10, end: 100, confidence: 0.95 },
          part2: { start: 110, end: 200, confidence: 0.71 },
          lang_dominant: 'ar',
          overall_confidence: 0.71,
        }),
      ),
      onProgress: vi.fn(() => () => {}),
    };
    const jm = new JobManager(bridge);

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));

    expect(useProjects.getState().projects[0].runState).toBe('needs_review');
  });

  it('transitions to error and stores lastError when call rejects', async () => {
    const bridge: Bridge = {
      call: vi.fn(() => Promise.reject(new Error('sidecar crash'))),
      onProgress: vi.fn(() => () => {}),
    };
    const jm = new JobManager(bridge);

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));

    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('error');
    expect(p.lastError).toBe('sidecar crash');
  });

  it('forwards progress events for the same projectId to setProgress', async () => {
    let listener!: (ev: ProgressEvent) => void;
    const bridge: Bridge = {
      call: vi.fn(() => new Promise(() => {})),
      onProgress: vi.fn((l) => {
        listener = l;
        return () => {};
      }),
    };
    const jm = new JobManager(bridge);
    jm.startDetect('p1');

    listener({ projectId: 'p1', stage: 'transcribe', pct: 42 });
    expect(useProjects.getState().projects[0].progress).toBe(42);

    listener({ projectId: 'other', stage: 'transcribe', pct: 99 });
    expect(useProjects.getState().projects[0].progress).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/JobManager.startDetect.test.ts`
Expected: FAIL — `startDetect` throws `not implemented`.

- [ ] **Step 3: Implement `startDetect` in `src/jobs/JobManager.ts`**

Replace the `startDetect` body and add the `DetectionResult` type. The full file becomes:

```ts
import type { Boundary, Bridge, JobKind, ProgressEvent, UploadOpts } from './types';
import { useProjects } from '../store/projects';

type InFlight = {
  kind: JobKind;
  abort: AbortController;
  unsubscribe: () => void;
};

type DetectionPart = {
  start: number;
  end: number;
  confidence: number;
  transcript_at_start?: string;
  transcript_at_end?: string;
};

type DetectionResult =
  | {
      duration: number;
      part1: DetectionPart;
      part2: DetectionPart;
      lang_dominant: string;
      overall_confidence: number;
    }
  | { error: string; duration?: number };

const REVIEW_THRESHOLD = 0.9;

export class JobManager {
  private inFlight = new Map<string, InFlight>();
  constructor(private bridge: Bridge) {}

  startDetect(projectId: string): void {
    this.cancel(projectId);

    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    const abort = new AbortController();
    const unsubscribe = this.bridge.onProgress((ev: ProgressEvent) => {
      if (ev.projectId === projectId) {
        useProjects.getState().setProgress(projectId, ev.pct);
      }
    });
    this.inFlight.set(projectId, { kind: 'detect', abort, unsubscribe });

    useProjects.getState().setRunState(projectId, 'detecting');

    this.bridge
      .call<DetectionResult>('detect.run', { audio_path: project.sourcePath })
      .then((res) => {
        if (abort.signal.aborted) return;
        if ('error' in res) {
          useProjects.getState().setError(projectId, res.error);
          return;
        }
        useProjects.getState().update(projectId, { part1: res.part1, part2: res.part2 });
        useProjects
          .getState()
          .setRunState(projectId, res.overall_confidence < REVIEW_THRESHOLD ? 'needs_review' : 'ready');
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        useProjects.getState().setError(projectId, msg);
      })
      .finally(() => {
        unsubscribe();
        if (this.inFlight.get(projectId)?.abort === abort) this.inFlight.delete(projectId);
      });
  }

  startCut(_projectId: string, _boundary: Boundary, _deltaSec: number): void {
    throw new Error('not implemented');
  }
  startUpload(_projectId: string, _opts: UploadOpts): void {
    throw new Error('not implemented');
  }
  retry(_projectId: string): void {
    throw new Error('not implemented');
  }
  cancel(projectId: string): void {
    const job = this.inFlight.get(projectId);
    if (job) {
      job.abort.abort();
      job.unsubscribe();
      this.inFlight.delete(projectId);
    }
  }
  isRunning(projectId: string): boolean {
    return this.inFlight.has(projectId);
  }
}
```

Contract notes (verified against `python-pipeline/khutbah_pipeline/__main__.py:122-152` and the existing caller `src/lib/autopilot.ts:7-17, 86-100`):

- The renderer passes only `{ audio_path }`. `device` flows via the `KHUTBAH_COMPUTE_DEVICE` env var that `electron/main.ts` sets at sidecar startup — passing it as a kwarg here would silently change the precedence model.
- `projectId` is a renderer concept; the sidecar does not know about projects.
- The response is a discriminated union: success has `overall_confidence`; failure has `{ error: string }`. Use `overall_confidence` (the sidecar's combined value) — do NOT recompute as `Math.min(part1.confidence, part2.confidence)`.
- The `find(project)` check must happen BEFORE listener subscription, otherwise an unknown projectId leaks both the `bridge.onProgress` subscription and the `inFlight` map entry.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/JobManager.startDetect.test.ts`
Expected: PASS — all cases green (4 happy/error/progress + 3 contract guards: unknown projectId, sidecar-error response, cancel-during-detection).

- [ ] **Step 5: Run the full renderer suite**

Run: `npx vitest run tests/renderer`
Expected: PASS, no regressions in the existing tests.

- [ ] **Step 6: Commit**

```bash
git add src/jobs/JobManager.ts tests/renderer/JobManager.startDetect.test.ts
git commit -m "feat(jobs): JobManager.startDetect with progress + needs_review threshold

Wires detect.run via the IPC bridge, subscribes to progress events,
transitions runState idle → detecting → ready or needs_review based on
the sidecar's overall_confidence (threshold 0.9). Errors — both rejected
promises and { error } responses from the sidecar — transition to
runState=error with lastError set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4b: `JobManager.startDetect` generates a thumbnail as its first step

**Files:**
- Modify: `src/jobs/JobManager.ts`
- Test: `tests/renderer/JobManager.thumbnail.test.ts`

Spec §6 requires `thumbnailPath` to be populated as the first step of `startDetect` (or after `ingest.youtube_download` for remote sources, since the file isn't yet on disk). Sidebar rows render a neutral placeholder while it's undefined.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import { useProjects } from '../../src/store/projects';

describe('JobManager.startDetect — thumbnail', () => {
  beforeEach(() => {
    useProjects.setState({
      projects: [{ id: 'p1', sourcePath: '/tmp/src.mp4', duration: 1, createdAt: 1, runState: 'idle' }],
    });
  });

  it('calls edit.thumbnails for the source before detect.run resolves', async () => {
    const calls: string[] = [];
    const call = vi.fn((method: string) => {
      calls.push(method);
      if (method === 'edit.thumbnails') return Promise.resolve({ path: '/cache/thumb.jpg' });
      if (method === 'detect.run') return Promise.resolve({
        part1: { start: 0, end: 1, confidence: 0.95 },
        part2: { start: 1, end: 2, confidence: 0.95 },
      });
      return Promise.reject(new Error('unexpected method ' + method));
    });
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.indexOf('edit.thumbnails')).toBeLessThan(calls.indexOf('detect.run'));
    expect(useProjects.getState().projects[0].thumbnailPath).toBe('/cache/thumb.jpg');
  });

  it('a thumbnail failure does not block detection', async () => {
    const call = vi.fn((method: string) => {
      if (method === 'edit.thumbnails') return Promise.reject(new Error('ffmpeg fail'));
      if (method === 'detect.run') return Promise.resolve({
        part1: { start: 0, end: 1, confidence: 0.95 },
        part2: { start: 1, end: 2, confidence: 0.95 },
      });
      return Promise.reject(new Error('unexpected ' + method));
    });
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 5));

    expect(useProjects.getState().projects[0].runState).toBe('ready');
    expect(useProjects.getState().projects[0].thumbnailPath).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/renderer/JobManager.thumbnail.test.ts`
Expected: FAIL — `edit.thumbnails` is not called.

- [ ] **Step 3: Update `startDetect` in `src/jobs/JobManager.ts`** to extract the thumbnail before `detect.run`:

Inside `startDetect`, replace the `useProjects.getState().setRunState(projectId, 'detecting');` line with:

```ts
useProjects.getState().setRunState(projectId, 'detecting');

// Best-effort thumbnail extraction (spec §6). Failure must not block detection.
this.bridge
  .call<{ path: string }>('edit.thumbnails', {
    projectId,
    sourcePath: project.sourcePath,
    timestampSec: 30,
  })
  .then((res) => {
    useProjects.getState().update(projectId, { thumbnailPath: res.path });
  })
  .catch(() => { /* ignore thumbnail failures */ });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/JobManager.thumbnail.test.ts tests/renderer/JobManager.startDetect.test.ts`
Expected: PASS for both files.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/JobManager.ts tests/renderer/JobManager.thumbnail.test.ts
git commit -m "feat(jobs): JobManager.startDetect populates thumbnailPath best-effort

Calls edit.thumbnails for the source's 30s mark and writes the result
into project.thumbnailPath. Failures are swallowed silently so detect.run
proceeds regardless. Per spec §6 'Thumbnail generation'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `JobManager.startCut` — per-boundary nudge with debounce

**Files:**
- Modify: `src/jobs/JobManager.ts`
- Test: `tests/renderer/JobManager.startCut.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/JobManager.startCut.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import type { Bridge } from '../../src/jobs/types';
import { useProjects } from '../../src/store/projects';

const seed = () =>
  useProjects.setState({
    projects: [
      {
        id: 'p1',
        sourcePath: '/tmp/src.mp4',
        duration: 200,
        createdAt: 1,
        runState: 'ready',
        part1: { start: 10, end: 100, confidence: 0.95 },
        part2: { start: 110, end: 195, confidence: 0.92 },
      },
    ],
  });

describe('JobManager.startCut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seed();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces rapid clicks, only one cut fires after settle', () => {
    const call = vi.fn(() => new Promise(() => {}));
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startCut('p1', 'p1Start', +5);
    jm.startCut('p1', 'p1Start', +5);
    jm.startCut('p1', 'p1Start', +5);

    vi.advanceTimersByTime(249);
    expect(call).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('passes the new boundary value (start + delta) to edit.smart_cut', () => {
    const call = vi.fn(() => new Promise(() => {}));
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startCut('p1', 'p1Start', +5);
    vi.advanceTimersByTime(260);

    expect(call).toHaveBeenCalledWith('edit.smart_cut', expect.objectContaining({
      projectId: 'p1',
      part1: expect.objectContaining({ start: 15, end: 100 }),
      part2: expect.objectContaining({ start: 110, end: 195 }),
    }));
  });

  it('updates runState to cutting while in flight', () => {
    const call = vi.fn(() => new Promise(() => {}));
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startCut('p1', 'p2End', -3);
    vi.advanceTimersByTime(260);

    expect(useProjects.getState().projects[0].runState).toBe('cutting');
  });

  it('on success applies the new boundary to the project and returns to ready', async () => {
    let resolve!: (v: unknown) => void;
    const call = vi.fn(() => new Promise((r) => { resolve = r; }));
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startCut('p1', 'p2End', -3);
    vi.advanceTimersByTime(260);
    resolve({ part1Path: '/out/part1.mp4', part2Path: '/out/part2.mp4' });

    await vi.waitFor(() => {
      expect(useProjects.getState().projects[0].runState).toBe('ready');
    });

    const p = useProjects.getState().projects[0];
    expect(p.part2?.end).toBe(192);
    expect(p.part2?.outputPath).toBe('/out/part2.mp4');
    expect(p.part1?.outputPath).toBe('/out/part1.mp4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/JobManager.startCut.test.ts`
Expected: FAIL — `startCut` throws `not implemented`.

- [ ] **Step 3: Implement `startCut` in `src/jobs/JobManager.ts`**

Add a private debounce map and replace the `startCut` body:

```ts
// Add to class fields:
private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
private static readonly NUDGE_DEBOUNCE_MS = 250;

startCut(projectId: string, boundary: Boundary, deltaSec: number): void {
  const existing = this.debounceTimers.get(projectId);
  if (existing) clearTimeout(existing);

  const project = useProjects.getState().projects.find((p) => p.id === projectId);
  if (!project) return;

  // Apply pending boundary mutation eagerly so successive nudges accumulate.
  const part1 = { ...(project.part1 ?? { start: 0, end: 0 }) };
  const part2 = { ...(project.part2 ?? { start: 0, end: 0 }) };
  if (boundary === 'p1Start') part1.start += deltaSec;
  if (boundary === 'p1End') part1.end += deltaSec;
  if (boundary === 'p2Start') part2.start += deltaSec;
  if (boundary === 'p2End') part2.end += deltaSec;
  useProjects.getState().update(projectId, { part1, part2 });

  const timer = setTimeout(() => {
    this.debounceTimers.delete(projectId);
    this.fireCut(projectId);
  }, JobManager.NUDGE_DEBOUNCE_MS);
  this.debounceTimers.set(projectId, timer);
}

private fireCut(projectId: string): void {
  this.cancel(projectId);
  const abort = new AbortController();
  const unsubscribe = this.bridge.onProgress((ev) => {
    if (ev.projectId === projectId) {
      useProjects.getState().setProgress(projectId, ev.pct);
    }
  });
  this.inFlight.set(projectId, { kind: 'cut', abort, unsubscribe });

  const project = useProjects.getState().projects.find((p) => p.id === projectId);
  if (!project) return;
  useProjects.getState().setRunState(projectId, 'cutting');

  this.bridge
    .call<{ part1Path: string; part2Path: string }>('edit.smart_cut', {
      projectId,
      sourcePath: project.sourcePath,
      part1: project.part1,
      part2: project.part2,
    })
    .then((res) => {
      if (abort.signal.aborted) return;
      useProjects.getState().update(projectId, {
        part1: project.part1 ? { ...project.part1, outputPath: res.part1Path } : undefined,
        part2: project.part2 ? { ...project.part2, outputPath: res.part2Path } : undefined,
      });
      useProjects.getState().setRunState(projectId, 'ready');
    })
    .catch((err: unknown) => {
      if (abort.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      useProjects.getState().setError(projectId, msg);
    })
    .finally(() => {
      unsubscribe();
      if (this.inFlight.get(projectId)?.abort === abort) this.inFlight.delete(projectId);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/JobManager.startCut.test.ts`
Expected: PASS — 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/JobManager.ts tests/renderer/JobManager.startCut.test.ts
git commit -m "feat(jobs): JobManager.startCut with 250ms debounce + boundary mutation

Successive nudges on the same project accumulate boundary deltas and
debounce — only one edit.smart_cut RPC fires per click burst. runState
flips to cutting while in flight, returns to ready on success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `JobManager.startUpload` — Part 1 then Part 2 sequencing

**Files:**
- Modify: `src/jobs/JobManager.ts`
- Test: `tests/renderer/JobManager.startUpload.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/JobManager.startUpload.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import { useProjects } from '../../src/store/projects';

const seed = () =>
  useProjects.setState({
    projects: [
      {
        id: 'p1',
        sourcePath: '/tmp/src.mp4',
        duration: 200,
        createdAt: 1,
        runState: 'ready',
        part1: { start: 10, end: 100, confidence: 0.95, outputPath: '/out/p1.mp4' },
        part2: { start: 110, end: 195, confidence: 0.92, outputPath: '/out/p2.mp4' },
      },
    ],
  });

describe('JobManager.startUpload', () => {
  beforeEach(() => {
    seed();
  });

  it('uploads part1 then part2 in sequence; transitions to uploaded on success', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ videoId: 'vid-1' })
      .mockResolvedValueOnce({ videoId: 'vid-2' });
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startUpload('p1', { channelId: 'ch1', title: 'Khutbah' });
    expect(useProjects.getState().projects[0].runState).toBe('uploading');

    await vi.waitFor(() => {
      expect(useProjects.getState().projects[0].runState).toBe('uploaded');
    });

    expect(call).toHaveBeenNthCalledWith(1, 'upload.video', expect.objectContaining({
      videoPath: '/out/p1.mp4',
      title: 'Khutbah — Part 1',
      channelId: 'ch1',
    }));
    expect(call).toHaveBeenNthCalledWith(2, 'upload.video', expect.objectContaining({
      videoPath: '/out/p2.mp4',
      title: 'Khutbah — Part 2',
      channelId: 'ch1',
    }));

    const p = useProjects.getState().projects[0];
    expect(p.part1?.videoId).toBe('vid-1');
    expect(p.part2?.videoId).toBe('vid-2');
  });

  it('on Part 1 failure: does not attempt Part 2; sets error with Part 1 message', async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error('quota exceeded'));
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startUpload('p1', { channelId: 'ch1', title: 'Khutbah' });

    await vi.waitFor(() => {
      expect(useProjects.getState().projects[0].runState).toBe('error');
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(useProjects.getState().projects[0].lastError).toBe('quota exceeded');
  });

  it('on Part 2 failure after Part 1 success: preserves part1.videoId for retry resume', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ videoId: 'vid-1' })
      .mockRejectedValueOnce(new Error('network down'));
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startUpload('p1', { channelId: 'ch1', title: 'Khutbah' });

    await vi.waitFor(() => {
      expect(useProjects.getState().projects[0].runState).toBe('error');
    });

    const p = useProjects.getState().projects[0];
    expect(p.part1?.videoId).toBe('vid-1');
    expect(p.part2?.videoId).toBeUndefined();
    expect(p.lastError).toBe('network down');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/JobManager.startUpload.test.ts`
Expected: FAIL — `startUpload` throws `not implemented`.

- [ ] **Step 3: Implement `startUpload` in `src/jobs/JobManager.ts`**

Replace the `startUpload` body:

```ts
async startUpload(projectId: string, opts: UploadOpts): Promise<void> {
  this.cancel(projectId);
  const abort = new AbortController();
  const unsubscribe = this.bridge.onProgress((ev) => {
    if (ev.projectId === projectId) {
      useProjects.getState().setProgress(projectId, ev.pct);
    }
  });
  this.inFlight.set(projectId, { kind: 'upload', abort, unsubscribe });
  useProjects.getState().setRunState(projectId, 'uploading');

  try {
    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    if (!project.part1?.videoId && project.part1?.outputPath) {
      const res1 = await this.bridge.call<{ videoId: string }>('upload.video', {
        projectId,
        videoPath: project.part1.outputPath,
        title: `${opts.title} — Part 1`,
        channelId: opts.channelId,
        playlistId: opts.playlistId,
        thumbnailPath: opts.thumbnailPath,
      });
      if (abort.signal.aborted) return;
      useProjects.getState().update(projectId, {
        part1: { ...project.part1, videoId: res1.videoId },
      });
    }

    const projectAfter = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!projectAfter?.part2?.videoId && projectAfter?.part2?.outputPath) {
      const res2 = await this.bridge.call<{ videoId: string }>('upload.video', {
        projectId,
        videoPath: projectAfter.part2.outputPath,
        title: `${opts.title} — Part 2`,
        channelId: opts.channelId,
        playlistId: opts.playlistId,
        thumbnailPath: opts.thumbnailPath,
      });
      if (abort.signal.aborted) return;
      useProjects.getState().update(projectId, {
        part2: { ...projectAfter.part2, videoId: res2.videoId },
      });
    }

    if (!abort.signal.aborted) {
      useProjects.getState().setRunState(projectId, 'uploaded');
    }
  } catch (err) {
    if (abort.signal.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    useProjects.getState().setError(projectId, msg);
  } finally {
    unsubscribe();
    if (this.inFlight.get(projectId)?.abort === abort) this.inFlight.delete(projectId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/JobManager.startUpload.test.ts`
Expected: PASS — 3 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/JobManager.ts tests/renderer/JobManager.startUpload.test.ts
git commit -m "feat(jobs): JobManager.startUpload — Part 1 then Part 2 with resume

Skips an already-uploaded part (videoId set) so Retry resumes from the
failed part. Part 1 failure halts the sequence; Part 2 failure leaves
Part 1's videoId on the project.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `JobManager.retry` — resume from last failed kind

**Files:**
- Modify: `src/jobs/JobManager.ts` and `src/store/projects.ts`
- Test: `tests/renderer/JobManager.retry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/JobManager.retry.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import { useProjects } from '../../src/store/projects';

describe('JobManager.retry', () => {
  beforeEach(() => {
    useProjects.setState({ projects: [] });
  });

  it('after failed detect: retry calls detect.run again', async () => {
    useProjects.setState({
      projects: [{
        id: 'p1', sourcePath: '/x', duration: 1, createdAt: 1,
        runState: 'error', lastError: 'crash', lastFailedKind: 'detect',
      }],
    });
    const call = vi.fn(() => Promise.resolve({
      part1: { start: 0, end: 1, confidence: 0.95 },
      part2: { start: 1, end: 2, confidence: 0.95 },
    }));
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.retry('p1');
    await new Promise((r) => setTimeout(r, 0));

    expect(call).toHaveBeenCalledWith('detect.run', expect.anything());
  });

  it('after failed upload: retry calls upload.video again', async () => {
    useProjects.setState({
      projects: [{
        id: 'p1', sourcePath: '/x', duration: 1, createdAt: 1,
        runState: 'error', lastError: 'net', lastFailedKind: 'upload',
        lastUploadOpts: { channelId: 'c1', title: 'K' },
        part1: { start: 0, end: 1, confidence: 0.95, outputPath: '/p1.mp4' },
        part2: { start: 1, end: 2, confidence: 0.95, outputPath: '/p2.mp4' },
      }],
    });
    const call = vi.fn(() => Promise.resolve({ videoId: 'v1' }));
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.retry('p1');
    await new Promise((r) => setTimeout(r, 0));

    expect(call).toHaveBeenCalledWith('upload.video', expect.anything());
  });

  it('without lastFailedKind: noop', () => {
    useProjects.setState({
      projects: [{ id: 'p1', sourcePath: '/x', duration: 1, createdAt: 1, runState: 'error', lastError: '?' }],
    });
    const call = vi.fn();
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });
    jm.retry('p1');
    expect(call).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/JobManager.retry.test.ts`
Expected: FAIL — `retry` throws; `lastFailedKind` / `lastUploadOpts` not on Project.

- [ ] **Step 3: Add fields to `Project` and write helpers**

In `src/store/projects.ts`, extend the `Project` type:

```ts
export type Project = {
  // ... existing fields ...
  lastFailedKind?: 'detect' | 'cut' | 'upload';
  lastUploadOpts?: { channelId: string; title: string; playlistId?: string; thumbnailPath?: string };
};
```

Update `setError` to accept an optional `kind`:

```ts
setError: (id, message, kind?) =>
  set((s) => ({
    projects: s.projects.map((p) =>
      p.id === id
        ? { ...p, runState: 'error' as const, lastError: message, lastFailedKind: kind, progress: undefined }
        : p,
    ),
  })),
```

And update its type in `State`:

```ts
setError: (id: string, message: string, kind?: 'detect' | 'cut' | 'upload') => void;
```

Update `JobManager`'s three `start*` methods to call `setError(projectId, msg, '<kind>')` with their kind. (Search-and-replace `setError(projectId, msg)` to include the kind.)

Update `JobManager.startUpload` to also persist `opts` for retry resume:

```ts
useProjects.getState().update(projectId, { lastUploadOpts: opts });
useProjects.getState().setRunState(projectId, 'uploading');
```

- [ ] **Step 4: Implement `retry` in `JobManager`**

```ts
retry(projectId: string): void {
  const project = useProjects.getState().projects.find((p) => p.id === projectId);
  if (!project?.lastFailedKind) return;
  switch (project.lastFailedKind) {
    case 'detect':
      this.startDetect(projectId);
      break;
    case 'cut':
      // Re-fire from current boundary state — no debounce.
      this.fireCut(projectId);
      break;
    case 'upload':
      if (project.lastUploadOpts) this.startUpload(projectId, project.lastUploadOpts);
      break;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/renderer/JobManager.retry.test.ts tests/renderer/JobManager.startDetect.test.ts tests/renderer/JobManager.startUpload.test.ts tests/renderer/projects.runState.test.ts`
Expected: PASS — all four files green.

- [ ] **Step 6: Commit**

```bash
git add src/jobs/JobManager.ts src/store/projects.ts tests/renderer/JobManager.retry.test.ts
git commit -m "feat(jobs): JobManager.retry resumes from lastFailedKind

Stores lastFailedKind on Project when a job errors, plus lastUploadOpts
when an upload begins, so Retry can call back into the right method
with the original arguments.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Components

For all component tests in this phase, the test file MUST start with:

```ts
// @vitest-environment jsdom
```

This switches that file from the default `node` env to `jsdom` so React renders.

### Task 8: `StatusDot` component

**Files:**
- Create: `src/components/StatusDot.tsx`
- Test: `tests/renderer/StatusDot.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/StatusDot.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusDot } from '../../src/components/StatusDot';

describe('StatusDot', () => {
  it('renders a green dot for ready', () => {
    render(<StatusDot runState="ready" />);
    const dot = screen.getByLabelText('Status: ready');
    expect(dot.className).toMatch(/bg-emerald|bg-green/);
  });

  it('renders an amber dot for needs_review', () => {
    render(<StatusDot runState="needs_review" />);
    const dot = screen.getByLabelText('Status: needs review');
    expect(dot.className).toMatch(/bg-amber/);
  });

  it('renders a red dot for error', () => {
    render(<StatusDot runState="error" />);
    const dot = screen.getByLabelText('Status: error');
    expect(dot.className).toMatch(/bg-red/);
  });

  it('renders a pulsing gold dot for detecting', () => {
    render(<StatusDot runState="detecting" />);
    const dot = screen.getByLabelText('Status: detecting');
    expect(dot.className).toMatch(/animate-pulse/);
  });

  it('renders a blue dot for uploaded', () => {
    render(<StatusDot runState="uploaded" />);
    const dot = screen.getByLabelText('Status: uploaded');
    expect(dot.className).toMatch(/bg-blue/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/StatusDot.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/StatusDot.tsx`**

```tsx
import type { RunState } from '../store/projects';

const COLOR_BY_STATE: Record<RunState, string> = {
  idle: 'bg-slate-500',
  detecting: 'bg-amber-400 animate-pulse',
  cutting: 'bg-amber-400 animate-pulse',
  needs_review: 'bg-amber-500',
  ready: 'bg-emerald-500',
  uploading: 'bg-amber-400 animate-pulse',
  uploaded: 'bg-blue-500',
  error: 'bg-red-500',
};

const LABEL_BY_STATE: Record<RunState, string> = {
  idle: 'idle',
  detecting: 'detecting',
  cutting: 'cutting',
  needs_review: 'needs review',
  ready: 'ready',
  uploading: 'uploading',
  uploaded: 'uploaded',
  error: 'error',
};

export function StatusDot({ runState }: { runState: RunState }) {
  return (
    <span
      role="img"
      aria-label={`Status: ${LABEL_BY_STATE[runState]}`}
      className={`inline-block w-2 h-2 rounded-full ${COLOR_BY_STATE[runState]}`}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/StatusDot.test.tsx`
Expected: PASS — 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/components/StatusDot.tsx tests/renderer/StatusDot.test.tsx
git commit -m "feat(ui): StatusDot component keyed off RunState

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `EmptyState` component

**Files:**
- Create: `src/components/EmptyState.tsx`
- Test: `tests/renderer/EmptyState.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '../../src/components/EmptyState';

describe('EmptyState', () => {
  it('renders the brand mark + a New khutbah button', () => {
    render(<EmptyState onNew={() => {}} />);
    expect(screen.getByRole('button', { name: /new khutbah/i })).toBeTruthy();
  });

  it('clicking the button calls onNew', () => {
    const onNew = vi.fn();
    render(<EmptyState onNew={onNew} />);
    fireEvent.click(screen.getByRole('button', { name: /new khutbah/i }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/renderer/EmptyState.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/EmptyState.tsx`**

```tsx
import { Logo } from './Logo';

export function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 text-center px-8">
      <Logo className="w-24 h-24 opacity-80" />
      <h2 className="font-display text-2xl text-amber-300">No khutbah selected</h2>
      <p className="text-slate-400 max-w-sm">
        Pick a project from the sidebar, or start a new one.
      </p>
      <button
        onClick={onNew}
        className="px-5 py-2 rounded bg-amber-400 text-slate-900 font-semibold hover:bg-amber-300"
      >
        + New khutbah
      </button>
    </div>
  );
}
```

(If `Logo` is at a different path, adjust the import accordingly. Read `src/components/Logo.tsx` to confirm.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/EmptyState.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/EmptyState.tsx tests/renderer/EmptyState.test.tsx
git commit -m "feat(ui): EmptyState — first-launch placeholder pane

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `NewKhutbahModal` (lift from `src/screens/NewKhutbah.tsx`)

**Files:**
- Read: `src/screens/NewKhutbah.tsx` (full file — understand the 3-tab structure)
- Create: `src/components/NewKhutbahModal.tsx`
- Test: `tests/renderer/NewKhutbahModal.test.tsx`

- [ ] **Step 1: Read `src/screens/NewKhutbah.tsx`** to understand the existing 3-tab form (YouTube URL / Local file / Dual-file). The modal version mirrors the same handlers but renders inside an overlay.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewKhutbahModal } from '../../src/components/NewKhutbahModal';

describe('NewKhutbahModal', () => {
  const noop = () => {};

  it('renders 3 tabs: YouTube / Local file / Dual-file', () => {
    render(<NewKhutbahModal open onClose={noop} onSubmitYoutube={noop} onSubmitLocal={noop} onSubmitDual={noop} />);
    expect(screen.getByRole('tab', { name: /youtube/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /local/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /dual/i })).toBeTruthy();
  });

  it('submitting the YouTube tab calls onSubmitYoutube with the URL', () => {
    const onSubmitYoutube = vi.fn();
    render(<NewKhutbahModal open onClose={noop} onSubmitYoutube={onSubmitYoutube} onSubmitLocal={noop} onSubmitDual={noop} />);
    const input = screen.getByPlaceholderText(/youtube url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(onSubmitYoutube).toHaveBeenCalledWith('https://youtu.be/abc');
  });

  it('clicking outside the modal calls onClose', () => {
    const onClose = vi.fn();
    render(<NewKhutbahModal open onClose={onClose} onSubmitYoutube={noop} onSubmitLocal={noop} onSubmitDual={noop} />);
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('open=false renders nothing', () => {
    const { container } = render(<NewKhutbahModal open={false} onClose={noop} onSubmitYoutube={noop} onSubmitLocal={noop} onSubmitDual={noop} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/renderer/NewKhutbahModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/components/NewKhutbahModal.tsx`**

```tsx
import { useState } from 'react';

type Tab = 'youtube' | 'local' | 'dual';

export type NewKhutbahModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmitYoutube: (url: string) => void;
  onSubmitLocal: (path: string) => void;
  onSubmitDual: (audioPath: string, videoPath: string) => void;
};

export function NewKhutbahModal({ open, onClose, onSubmitYoutube, onSubmitLocal, onSubmitDual }: NewKhutbahModalProps) {
  const [tab, setTab] = useState<Tab>('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [dualAudio, setDualAudio] = useState('');
  const [dualVideo, setDualVideo] = useState('');

  if (!open) return null;

  const submit = () => {
    if (tab === 'youtube' && youtubeUrl) onSubmitYoutube(youtubeUrl);
    if (tab === 'local' && localPath) onSubmitLocal(localPath);
    if (tab === 'dual' && dualAudio && dualVideo) onSubmitDual(dualAudio, dualVideo);
  };

  const pickLocal = async () => {
    const path = await window.khutbah?.dialog.openVideo();
    if (path) setLocalPath(path);
  };

  const pickDualAudio = async () => {
    const path = await window.khutbah?.dialog.openAudio();
    if (path) setDualAudio(path);
  };

  const pickDualVideo = async () => {
    const path = await window.khutbah?.dialog.openVideo();
    if (path) setDualVideo(path);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      data-testid="modal-backdrop"
      onClick={onClose}
    >
      <div className="bg-slate-800 rounded-lg p-6 w-[480px]" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl text-amber-300 mb-4">New khutbah</h2>
        <div role="tablist" className="flex gap-2 mb-4">
          <button role="tab" aria-selected={tab === 'youtube'} onClick={() => setTab('youtube')} className={tab === 'youtube' ? 'px-3 py-1 bg-amber-400 text-slate-900 rounded' : 'px-3 py-1 bg-slate-700 text-slate-200 rounded'}>YouTube</button>
          <button role="tab" aria-selected={tab === 'local'} onClick={() => setTab('local')} className={tab === 'local' ? 'px-3 py-1 bg-amber-400 text-slate-900 rounded' : 'px-3 py-1 bg-slate-700 text-slate-200 rounded'}>Local file</button>
          <button role="tab" aria-selected={tab === 'dual'} onClick={() => setTab('dual')} className={tab === 'dual' ? 'px-3 py-1 bg-amber-400 text-slate-900 rounded' : 'px-3 py-1 bg-slate-700 text-slate-200 rounded'}>Dual file</button>
        </div>

        {tab === 'youtube' && (
          <input
            type="url"
            placeholder="YouTube URL"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 rounded"
          />
        )}

        {tab === 'local' && (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="No file selected"
              value={localPath}
              readOnly
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 rounded"
            />
            <button onClick={pickLocal} className="px-3 py-2 bg-slate-700 text-slate-100 rounded">Browse</button>
          </div>
        )}

        {tab === 'dual' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input type="text" placeholder="Audio file" value={dualAudio} readOnly className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 rounded" />
              <button onClick={pickDualAudio} className="px-3 py-2 bg-slate-700 text-slate-100 rounded">Browse</button>
            </div>
            <div className="flex gap-2">
              <input type="text" placeholder="Video file" value={dualVideo} readOnly className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 rounded" />
              <button onClick={pickDualVideo} className="px-3 py-2 bg-slate-700 text-slate-100 rounded">Browse</button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-slate-100">Cancel</button>
          <button onClick={submit} className="px-4 py-2 bg-emerald-500 text-slate-900 rounded font-semibold">Start</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/renderer/NewKhutbahModal.test.tsx`
Expected: PASS — 4 cases green.

- [ ] **Step 6: Commit**

```bash
git add src/components/NewKhutbahModal.tsx tests/renderer/NewKhutbahModal.test.tsx
git commit -m "feat(ui): NewKhutbahModal — 3-tab source input as a modal overlay

Backdrop click closes; preserves the previously selected project so the
user can keep reviewing while a new project's detection runs in the
background.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `DetectingPane` (lift progress UI from `Processing.tsx`)

**Files:**
- Read: `src/screens/Processing.tsx` (understand the stage labels + ETA)
- Create: `src/components/DetectingPane.tsx`
- Test: `tests/renderer/DetectingPane.test.tsx`

- [ ] **Step 1: Read `src/screens/Processing.tsx`** to lift the stage label + ETA logic. Most of the file's RPC orchestration is now in JobManager; only the progress UI is needed.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetectingPane } from '../../src/components/DetectingPane';

describe('DetectingPane', () => {
  it('renders the project name and progress percent', () => {
    render(<DetectingPane projectName="Iziyi 25-04-26" progress={42} stage="Transcribe" />);
    expect(screen.getByText(/Iziyi 25-04-26/)).toBeTruthy();
    expect(screen.getByText(/42%/)).toBeTruthy();
    expect(screen.getByText(/Transcribe/)).toBeTruthy();
  });

  it('handles undefined progress as indeterminate', () => {
    render(<DetectingPane projectName="K" stage="Audio extraction" />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/renderer/DetectingPane.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/components/DetectingPane.tsx`**

```tsx
export type DetectingPaneProps = {
  projectName: string;
  progress?: number;
  stage: string;
};

export function DetectingPane({ projectName, progress, stage }: DetectingPaneProps) {
  const pct = progress ?? 0;
  return (
    <div className="h-full flex flex-col items-center justify-center px-12">
      <h2 className="font-display text-xl text-amber-300 mb-2">{projectName}</h2>
      <p className="text-slate-400 mb-6">{stage}</p>
      <div className="w-full max-w-md h-2 bg-slate-800 rounded overflow-hidden">
        <div
          role="progressbar"
          aria-valuenow={progress ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-full bg-amber-400 transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress !== undefined && (
        <p className="text-slate-300 text-sm mt-3">{progress}%</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/renderer/DetectingPane.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/DetectingPane.tsx tests/renderer/DetectingPane.test.tsx
git commit -m "feat(ui): DetectingPane — inline progress bar for in-flight detection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `ReviewPane` — player + Part 1/Part 2 tabs

**Files:**
- Create: `src/components/ReviewPane.tsx`
- Test: `tests/renderer/ReviewPane.tabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewPane } from '../../src/components/ReviewPane';

const project = {
  id: 'p1',
  sourcePath: '/src.mp4',
  duration: 200,
  createdAt: 1,
  runState: 'ready' as const,
  part1: { start: 10, end: 100, confidence: 0.95, outputPath: '/out/part1.mp4' },
  part2: { start: 110, end: 195, confidence: 0.71, outputPath: '/out/part2.mp4' },
};

describe('ReviewPane — tabs', () => {
  it('renders both tabs and a video element with part1 by default if both >= 0.9', () => {
    const ready = { ...project, part2: { ...project.part2, confidence: 0.95 } };
    render(<ReviewPane project={ready} onAccept={() => {}} onNudge={() => {}} />);
    expect(screen.getByRole('tab', { name: /part 1/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /part 2/i })).toBeTruthy();
    const video = screen.getByTestId('preview') as HTMLVideoElement;
    expect(video.src).toContain('part1.mp4');
  });

  it('defaults the active tab to the lower-confidence part when needs_review', () => {
    render(<ReviewPane project={project} onAccept={() => {}} onNudge={() => {}} />);
    const video = screen.getByTestId('preview') as HTMLVideoElement;
    expect(video.src).toContain('part2.mp4');
  });

  it('clicking Part 2 tab swaps the video src', () => {
    const ready = { ...project, part2: { ...project.part2, confidence: 0.95 } };
    render(<ReviewPane project={ready} onAccept={() => {}} onNudge={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /part 2/i }));
    const video = screen.getByTestId('preview') as HTMLVideoElement;
    expect(video.src).toContain('part2.mp4');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/renderer/ReviewPane.tabs.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/ReviewPane.tsx`**

```tsx
import { useState } from 'react';
import type { Project, Part } from '../store/projects';
import type { Boundary } from '../jobs/types';

const REVIEW_THRESHOLD = 0.9;

const fileUrl = (path?: string) => (path ? `file://${path}` : undefined);

export type ReviewPaneProps = {
  project: Project;
  onAccept: () => void;
  onNudge: (boundary: Boundary, deltaSec: number) => void;
};

export function ReviewPane({ project, onAccept, onNudge }: ReviewPaneProps) {
  const part1Conf = project.part1?.confidence ?? 1;
  const part2Conf = project.part2?.confidence ?? 1;
  const lowerIsPart2 = part2Conf < part1Conf && part2Conf < REVIEW_THRESHOLD;
  const [active, setActive] = useState<'part1' | 'part2'>(lowerIsPart2 ? 'part2' : 'part1');
  const part: Part | undefined = active === 'part1' ? project.part1 : project.part2;
  const src = fileUrl(part?.outputPath);

  return (
    <div className="h-full p-4 flex flex-col gap-4">
      <div className="aspect-video bg-black rounded overflow-hidden">
        {src && (
          <video data-testid="preview" key={src} src={src} controls className="w-full h-full" />
        )}
      </div>
      <div role="tablist" className="flex gap-2">
        <button
          role="tab"
          aria-selected={active === 'part1'}
          onClick={() => setActive('part1')}
          className={`flex-1 py-2 rounded ${active === 'part1' ? 'bg-amber-400 text-slate-900 font-semibold' : 'bg-slate-800 text-slate-200'}`}
        >
          Part 1
        </button>
        <button
          role="tab"
          aria-selected={active === 'part2'}
          onClick={() => setActive('part2')}
          className={`flex-1 py-2 rounded ${active === 'part2' ? 'bg-amber-400 text-slate-900 font-semibold' : 'bg-slate-800 text-slate-200'}`}
        >
          Part 2
        </button>
      </div>
      <ReviewDetailCard
        partLabel={active === 'part1' ? 'Part 1' : 'Part 2'}
        part={part}
        boundaryPrefix={active}
        onNudge={onNudge}
      />
      <div className="flex justify-end">
        <button onClick={onAccept} className="px-4 py-2 bg-emerald-500 text-slate-900 rounded font-semibold">
          Accept &amp; upload
        </button>
      </div>
    </div>
  );
}

function ReviewDetailCard({
  partLabel,
  part,
  boundaryPrefix,
  onNudge,
}: {
  partLabel: string;
  part?: Part;
  boundaryPrefix: 'part1' | 'part2';
  onNudge: (boundary: Boundary, deltaSec: number) => void;
}) {
  if (!part) return null;
  const conf = (part.confidence ?? 0) * 100;
  const review = (part.confidence ?? 0) < REVIEW_THRESHOLD;
  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };
  const startKey: Boundary = boundaryPrefix === 'part1' ? 'p1Start' : 'p2Start';
  const endKey: Boundary = boundaryPrefix === 'part1' ? 'p1End' : 'p2End';

  return (
    <div className="bg-slate-800 rounded p-3 space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-slate-400">{partLabel}</span>
        <span className={review ? 'text-amber-400' : 'text-emerald-400'}>
          {Math.round(conf)}% {review ? 'review' : '✓'}
        </span>
      </div>
      <div className="font-mono text-xs text-slate-300">{fmt(part.start)} → {fmt(part.end)}</div>
      <div className="flex gap-2 text-xs">
        <button onClick={() => onNudge(startKey, -5)} className="flex-1 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200">Start −5s</button>
        <button onClick={() => onNudge(startKey, +5)} className="flex-1 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200">Start +5s</button>
        <button onClick={() => onNudge(endKey, -5)} className="flex-1 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200">End −5s</button>
        <button onClick={() => onNudge(endKey, +5)} className="flex-1 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200">End +5s</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/ReviewPane.tabs.test.tsx`
Expected: PASS — 3 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReviewPane.tsx tests/renderer/ReviewPane.tabs.test.tsx
git commit -m "feat(ui): ReviewPane skeleton with player, tabs, detail card, Accept

Defaults active tab to the lower-confidence part when needs_review.
Nudge buttons + Accept call back to caller (Shell wires to JobManager).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `ReviewPane` — wire Nudge + Accept callbacks under test

**Files:**
- Test: `tests/renderer/ReviewPane.actions.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewPane } from '../../src/components/ReviewPane';

const project = {
  id: 'p1',
  sourcePath: '/s',
  duration: 200,
  createdAt: 1,
  runState: 'ready' as const,
  part1: { start: 10, end: 100, confidence: 0.95, outputPath: '/p1.mp4' },
  part2: { start: 110, end: 195, confidence: 0.95, outputPath: '/p2.mp4' },
};

describe('ReviewPane — actions', () => {
  it('clicking Start +5s on Part 1 calls onNudge("p1Start", +5)', () => {
    const onNudge = vi.fn();
    render(<ReviewPane project={project} onAccept={() => {}} onNudge={onNudge} />);
    fireEvent.click(screen.getByRole('button', { name: /start \+5s/i }));
    expect(onNudge).toHaveBeenCalledWith('p1Start', 5);
  });

  it('clicking End −5s on Part 2 calls onNudge("p2End", -5)', () => {
    const onNudge = vi.fn();
    render(<ReviewPane project={project} onAccept={() => {}} onNudge={onNudge} />);
    fireEvent.click(screen.getByRole('tab', { name: /part 2/i }));
    fireEvent.click(screen.getByRole('button', { name: /end −5s/i }));
    expect(onNudge).toHaveBeenCalledWith('p2End', -5);
  });

  it('clicking Accept & upload calls onAccept', () => {
    const onAccept = vi.fn();
    render(<ReviewPane project={project} onAccept={onAccept} onNudge={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /accept & upload/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/renderer/ReviewPane.actions.test.tsx`
Expected: PASS — the implementation from Task 12 already wires these. If a case fails, fix the wiring in `ReviewPane.tsx`.

- [ ] **Step 3: Commit**

```bash
git add tests/renderer/ReviewPane.actions.test.tsx
git commit -m "test(ui): ReviewPane action callbacks (Nudge + Accept)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: `UploadPane` — adapted from `src/screens/Upload.tsx`

**Files:**
- Read: `src/screens/Upload.tsx` (full file — understand account picker + playlist + upload flow)
- Create: `src/components/UploadPane.tsx`
- Test: `tests/renderer/UploadPane.test.tsx`

- [ ] **Step 1: Read `src/screens/Upload.tsx`** to lift account/playlist/title/thumbnail handling. The renderer test mocks `window.khutbah.auth.*` and `JobManager.startUpload` at the seam.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UploadPane } from '../../src/components/UploadPane';

const project = {
  id: 'p1', sourcePath: '/s.mp4', duration: 200, createdAt: 1, runState: 'ready' as const,
  part1: { start: 10, end: 100, confidence: 0.95, outputPath: '/p1.mp4' },
  part2: { start: 110, end: 195, confidence: 0.95, outputPath: '/p2.mp4' },
};

describe('UploadPane', () => {
  beforeEach(() => {
    Object.assign(window, {
      khutbah: {
        auth: {
          listAccounts: vi.fn(() => Promise.resolve([{ channelId: 'ch-1', name: 'Frequence' }])),
          accessToken: vi.fn(() => Promise.resolve('tkn')),
        },
        pipeline: { call: vi.fn(() => Promise.resolve([])) }, // for playlists.list
      },
    });
  });

  it('pre-fills the title input from project name + suffix', async () => {
    render(<UploadPane project={project} projectName="Iziyi" onStart={() => {}} />);
    const input = await screen.findByDisplayValue(/Iziyi/);
    expect(input).toBeTruthy();
  });

  it('clicking Upload calls onStart with channelId, title, playlistId, thumbnailPath', async () => {
    const onStart = vi.fn();
    render(<UploadPane project={project} projectName="Iziyi" onStart={onStart} />);
    await screen.findByRole('button', { name: /upload/i });
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'ch-1',
      title: expect.stringContaining('Iziyi'),
    }));
  });

  it('disables the Upload button while project.runState is uploading', async () => {
    render(
      <UploadPane
        project={{ ...project, runState: 'uploading' }}
        projectName="Iziyi"
        onStart={() => {}}
      />,
    );
    const btn = await screen.findByRole('button', { name: /upload/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/renderer/UploadPane.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/components/UploadPane.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { Project } from '../store/projects';
import type { UploadOpts } from '../jobs/types';

type Account = { channelId: string; name: string };
type Playlist = { id: string; title: string };

export type UploadPaneProps = {
  project: Project;
  projectName: string;
  onStart: (opts: UploadOpts) => void;
};

export function UploadPane({ project, projectName, onStart }: UploadPaneProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [channelId, setChannelId] = useState<string>('');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistId, setPlaylistId] = useState<string>('');
  const [title, setTitle] = useState(projectName || 'Khutbah');
  const [thumbnailPath, setThumbnailPath] = useState<string>('');

  useEffect(() => {
    window.khutbah?.auth.listAccounts().then((a) => {
      setAccounts(a);
      if (a[0]) setChannelId(a[0].channelId);
    });
  }, []);

  useEffect(() => {
    if (!channelId) return;
    window.khutbah?.pipeline
      .call<Playlist[]>('playlists.list', { channelId })
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, [channelId]);

  const inFlight = project.runState === 'uploading';

  return (
    <div className="h-full p-4 flex flex-col gap-3 overflow-auto">
      <h2 className="font-display text-xl text-amber-300">Upload to YouTube</h2>

      <label className="text-sm text-slate-300">Account</label>
      <select
        value={channelId}
        onChange={(e) => setChannelId(e.target.value)}
        className="px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 rounded"
      >
        {accounts.map((a) => (
          <option key={a.channelId} value={a.channelId}>{a.name}</option>
        ))}
      </select>

      <label className="text-sm text-slate-300">Title</label>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 rounded"
      />

      <label className="text-sm text-slate-300">Playlist (optional)</label>
      <select
        value={playlistId}
        onChange={(e) => setPlaylistId(e.target.value)}
        className="px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 rounded"
      >
        <option value="">— none —</option>
        {playlists.map((p) => (
          <option key={p.id} value={p.id}>{p.title}</option>
        ))}
      </select>

      <label className="text-sm text-slate-300">Thumbnail (optional)</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={thumbnailPath}
          readOnly
          placeholder="No thumbnail"
          className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 rounded"
        />
        <button
          onClick={async () => {
            const path = await window.khutbah?.dialog.openVideo();
            if (path) setThumbnailPath(path);
          }}
          className="px-3 py-2 bg-slate-700 text-slate-100 rounded"
        >
          Browse
        </button>
      </div>

      <div className="flex justify-end mt-4">
        <button
          disabled={inFlight || !channelId}
          onClick={() => onStart({ channelId, playlistId: playlistId || undefined, title, thumbnailPath: thumbnailPath || undefined })}
          className="px-4 py-2 bg-emerald-500 text-slate-900 rounded font-semibold disabled:opacity-50"
        >
          {inFlight ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {inFlight && project.progress !== undefined && (
        <p className="text-slate-300 text-sm">Progress: {project.progress}%</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/renderer/UploadPane.test.tsx`
Expected: PASS — 3 cases green.

- [ ] **Step 6: Commit**

```bash
git add src/components/UploadPane.tsx tests/renderer/UploadPane.test.tsx
git commit -m "feat(ui): UploadPane — account/title/playlist/thumbnail picker

Adapted from src/screens/Upload.tsx as a pane (no internal navigation).
Calls back to caller via onStart so the Shell can route to JobManager.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: `SettingsPane` — adapted from `Settings.tsx` + `AccountsSection.tsx`

**Files:**
- Read: `src/screens/Settings.tsx` and `src/screens/AccountsSection.tsx`
- Create: `src/components/SettingsPane.tsx`
- Test: `tests/renderer/SettingsPane.test.tsx`

- [ ] **Step 1: Read both files** — settings device picker, output dir, OAuth account list. Lift verbatim into a single component.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPane } from '../../src/components/SettingsPane';
import { useSettings } from '../../src/store/settings';

describe('SettingsPane', () => {
  beforeEach(() => {
    Object.assign(window, {
      khutbah: {
        auth: {
          listAccounts: vi.fn(() => Promise.resolve([])),
          signIn: vi.fn(() => Promise.resolve()),
          signOut: vi.fn(() => Promise.resolve()),
        },
        settings: {
          get: vi.fn(() => Promise.resolve({ computeDevice: 'auto', outputDir: '/out' })),
          set: vi.fn(() => Promise.resolve()),
        },
        dialog: { openVideo: vi.fn(), openAudio: vi.fn() },
      },
    });
    useSettings.setState({ computeDevice: 'auto', outputDir: '/out' });
  });

  it('renders the compute device selector with current value', async () => {
    render(<SettingsPane />);
    const select = await screen.findByLabelText(/compute device/i);
    expect((select as HTMLSelectElement).value).toBe('auto');
  });

  it('changing the device calls settings.set and updates the store', async () => {
    render(<SettingsPane />);
    const select = await screen.findByLabelText(/compute device/i);
    fireEvent.change(select, { target: { value: 'cuda' } });
    expect(window.khutbah!.settings.set).toHaveBeenCalledWith({ computeDevice: 'cuda' });
  });

  it('clicking Sign in calls auth.signIn', async () => {
    render(<SettingsPane />);
    const btn = await screen.findByRole('button', { name: /sign in/i });
    fireEvent.click(btn);
    expect(window.khutbah!.auth.signIn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/renderer/SettingsPane.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/components/SettingsPane.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useSettings } from '../store/settings';

type Account = { channelId: string; name: string };

export function SettingsPane() {
  const { computeDevice, outputDir } = useSettings();
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    window.khutbah?.settings.get().then((s) => {
      useSettings.setState({ computeDevice: s.computeDevice ?? 'auto', outputDir: s.outputDir });
    });
    window.khutbah?.auth.listAccounts().then(setAccounts);
  }, []);

  const setDevice = (d: 'auto' | 'cpu' | 'cuda') => {
    useSettings.setState({ computeDevice: d });
    window.khutbah?.settings.set({ computeDevice: d });
  };

  const setOutDir = (path: string) => {
    useSettings.setState({ outputDir: path });
    window.khutbah?.settings.set({ outputDir: path });
  };

  return (
    <div className="h-full p-4 flex flex-col gap-4 overflow-auto">
      <h2 className="font-display text-xl text-amber-300">Settings</h2>

      <div>
        <label htmlFor="device" className="text-sm text-slate-300 block mb-1">Compute device</label>
        <select
          id="device"
          value={computeDevice ?? 'auto'}
          onChange={(e) => setDevice(e.target.value as 'auto' | 'cpu' | 'cuda')}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 rounded"
        >
          <option value="auto">Auto</option>
          <option value="cpu">CPU</option>
          <option value="cuda">CUDA (GPU)</option>
        </select>
      </div>

      <div>
        <label className="text-sm text-slate-300 block mb-1">Output directory</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={outputDir ?? ''}
            readOnly
            className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 rounded"
          />
          <button
            onClick={async () => {
              const dir = await window.khutbah?.dialog.openVideo();
              if (dir) setOutDir(dir);
            }}
            className="px-3 py-2 bg-slate-700 text-slate-100 rounded"
          >
            Browse
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm text-slate-300 mb-2">YouTube accounts</h3>
        <ul className="space-y-1">
          {accounts.map((a) => (
            <li key={a.channelId} className="flex items-center justify-between bg-slate-800 px-3 py-2 rounded">
              <span className="text-slate-200">{a.name}</span>
              <button
                onClick={() => window.khutbah?.auth.signOut(a.channelId).then(() => window.khutbah?.auth.listAccounts().then(setAccounts))}
                className="text-xs text-slate-400 hover:text-red-400"
              >
                Sign out
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => window.khutbah?.auth.signIn().then(() => window.khutbah?.auth.listAccounts().then(setAccounts))}
          className="mt-2 px-3 py-2 bg-amber-400 text-slate-900 rounded font-semibold"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/renderer/SettingsPane.test.tsx`
Expected: PASS — 3 cases green.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsPane.tsx tests/renderer/SettingsPane.test.tsx
git commit -m "feat(ui): SettingsPane — device, output dir, YouTube accounts

Adapted from Settings.tsx + AccountsSection.tsx into a single pane.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: `ErrorPane` — error/interrupted state with Retry

**Files:**
- Create: `src/components/ErrorPane.tsx`
- Test: `tests/renderer/ErrorPane.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorPane } from '../../src/components/ErrorPane';

describe('ErrorPane', () => {
  it('renders the error message and a Retry button', () => {
    render(<ErrorPane message="sidecar crashed" onRetry={() => {}} />);
    expect(screen.getByText(/sidecar crashed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('clicking Retry calls onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorPane message="x" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/renderer/ErrorPane.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/ErrorPane.tsx`**

```tsx
export function ErrorPane({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-12 gap-4">
      <h2 className="font-display text-xl text-red-400">Something went wrong</h2>
      <p className="text-slate-300 text-sm max-w-md text-center">{message}</p>
      <button onClick={onRetry} className="px-5 py-2 bg-amber-400 text-slate-900 rounded font-semibold">
        Retry
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/ErrorPane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ErrorPane.tsx tests/renderer/ErrorPane.test.tsx
git commit -m "feat(ui): ErrorPane — error state with Retry callback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: `Toaster` — bottom-right notifications

**Files:**
- Create: `src/components/Toaster.tsx`
- Create: `src/store/toasts.ts`
- Test: `tests/renderer/Toaster.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Toaster } from '../../src/components/Toaster';
import { useToasts } from '../../src/store/toasts';

describe('Toaster', () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when no toasts', () => {
    const { container } = render(<Toaster />);
    expect(container.querySelectorAll('[role="status"]').length).toBe(0);
  });

  it('shows a toast pushed via store', () => {
    render(<Toaster />);
    act(() => {
      useToasts.getState().push({ id: 't1', kind: 'success', message: 'Done!' });
    });
    expect(screen.getByText('Done!')).toBeTruthy();
  });

  it('auto-dismisses after 5 seconds', () => {
    render(<Toaster />);
    act(() => {
      useToasts.getState().push({ id: 't1', kind: 'success', message: 'Done!' });
    });
    expect(screen.queryByText('Done!')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(5001); });
    expect(screen.queryByText('Done!')).toBeNull();
  });

  it('clicking dismisses immediately', () => {
    render(<Toaster />);
    act(() => {
      useToasts.getState().push({ id: 't1', kind: 'success', message: 'Done!' });
    });
    fireEvent.click(screen.getByText('Done!'));
    expect(screen.queryByText('Done!')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/renderer/Toaster.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/store/toasts.ts`**

```ts
import { create } from 'zustand';

export type Toast = { id: string; kind: 'success' | 'error'; message: string };

type State = {
  toasts: Toast[];
  push: (t: Toast) => void;
  dismiss: (id: string) => void;
};

export const useToasts = create<State>((set) => ({
  toasts: [],
  push: (t) => set((s) => ({ toasts: [...s.toasts, t] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
```

- [ ] **Step 4: Implement `src/components/Toaster.tsx`**

```tsx
import { useEffect } from 'react';
import { useToasts } from '../store/toasts';

const AUTO_DISMISS_MS = 5000;

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className={`px-4 py-2 rounded shadow-lg cursor-pointer text-sm ${t.kind === 'success' ? 'bg-emerald-500 text-slate-900' : 'bg-red-500 text-white'}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/renderer/Toaster.test.tsx`
Expected: PASS — 4 cases green.

- [ ] **Step 6: Commit**

```bash
git add src/components/Toaster.tsx src/store/toasts.ts tests/renderer/Toaster.test.tsx
git commit -m "feat(ui): Toaster + toasts store for background notifications

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Wire JobManager success/error events to Toaster

**Files:**
- Modify: `src/jobs/JobManager.ts`
- Test: `tests/renderer/JobManager.toasts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import { useProjects } from '../../src/store/projects';
import { useToasts } from '../../src/store/toasts';
import { useUi } from '../../src/store/ui';

describe('JobManager — toast emission', () => {
  beforeEach(() => {
    useProjects.setState({
      projects: [{ id: 'p1', sourcePath: '/x', duration: 1, createdAt: 1, runState: 'idle' }],
    });
    useToasts.setState({ toasts: [] });
    useUi.setState({ selectedProjectId: null, view: 'review' });
  });

  it('on background detection success: pushes a success toast', async () => {
    const call = vi.fn(() =>
      Promise.resolve({
        part1: { start: 0, end: 1, confidence: 0.95 },
        part2: { start: 1, end: 2, confidence: 0.95 },
      }),
    );
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));

    const toasts = useToasts.getState().toasts;
    expect(toasts.some((t) => t.kind === 'success' && /detection/i.test(t.message))).toBe(true);
  });

  it('on detection success when project IS selected: no toast', async () => {
    useUi.setState({ selectedProjectId: 'p1', view: 'review' });
    const call = vi.fn(() =>
      Promise.resolve({
        part1: { start: 0, end: 1, confidence: 0.95 },
        part2: { start: 1, end: 2, confidence: 0.95 },
      }),
    );
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));

    expect(useToasts.getState().toasts.length).toBe(0);
  });

  it('on any failure: pushes an error toast (selected or not)', async () => {
    useUi.setState({ selectedProjectId: 'p1', view: 'review' });
    const call = vi.fn(() => Promise.reject(new Error('boom')));
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));

    const toasts = useToasts.getState().toasts;
    expect(toasts.some((t) => t.kind === 'error' && /boom/.test(t.message))).toBe(true);
  });

  it('on upload success: always toasts (selected or not)', async () => {
    useUi.setState({ selectedProjectId: 'p1', view: 'upload' });
    useProjects.setState({
      projects: [{
        id: 'p1', sourcePath: '/x', duration: 1, createdAt: 1, runState: 'ready',
        part1: { start: 0, end: 1, confidence: 0.95, outputPath: '/p1.mp4' },
        part2: { start: 1, end: 2, confidence: 0.95, outputPath: '/p2.mp4' },
      }],
    });
    const call = vi.fn().mockResolvedValueOnce({ videoId: 'v1' }).mockResolvedValueOnce({ videoId: 'v2' });
    const jm = new JobManager({ call, onProgress: vi.fn(() => () => {}) });

    jm.startUpload('p1', { channelId: 'c', title: 'K' });
    await new Promise((r) => setTimeout(r, 10));

    const toasts = useToasts.getState().toasts;
    expect(toasts.some((t) => t.kind === 'success' && /upload/i.test(t.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/JobManager.toasts.test.ts`
Expected: FAIL — no toasts emitted.

- [ ] **Step 3: Add toast emission to `JobManager`**

In `src/jobs/JobManager.ts`, add a private helper:

```ts
private toast(projectId: string, kind: 'success' | 'error', message: string, alwaysShow = false): void {
  const ui = useUi.getState();
  const isSelected = ui.selectedProjectId === projectId && ui.view === 'review';
  if (kind === 'error' || alwaysShow || !isSelected) {
    useToasts.getState().push({
      id: `${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      message,
    });
  }
}
```

Add the imports at the top of the file:

```ts
import { useUi } from '../store/ui';
import { useToasts } from '../store/toasts';
```

In `startDetect` success branch, before transitioning to ready/needs_review:

```ts
this.toast(projectId, 'success', `Detection complete for ${project.sourcePath.split('/').pop()}`);
```

In all three method's catch branches:

```ts
this.toast(projectId, 'error', msg);
```

In `startUpload` success branch (after setting `runState = 'uploaded'`):

```ts
this.toast(projectId, 'success', `Upload complete: ${opts.title}`, /* alwaysShow */ true);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/JobManager.toasts.test.ts`
Expected: PASS — 4 cases green.

- [ ] **Step 5: Run the full JobManager + UI suite**

Run: `npx vitest run tests/renderer/JobManager*.test.ts tests/renderer/Toaster.test.tsx tests/renderer/ui.test.ts`
Expected: PASS for all.

- [ ] **Step 6: Commit**

```bash
git add src/jobs/JobManager.ts tests/renderer/JobManager.toasts.test.ts
git commit -m "feat(jobs): JobManager emits toasts on background success + all failures

Background success toasts only fire when the project isn't currently
selected (so the user notices the work that completed off-screen).
Errors always toast. Upload success always toasts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: `Sidebar` — project list with status dots

**Files:**
- Create: `src/components/Sidebar.tsx`
- Test: `tests/renderer/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { useProjects } from '../../src/store/projects';

describe('Sidebar', () => {
  beforeEach(() => {
    useProjects.setState({
      projects: [
        { id: 'a', sourcePath: '/a.mp4', duration: 1, createdAt: 2, runState: 'detecting', progress: 78 },
        { id: 'b', sourcePath: '/b.mp4', duration: 1, createdAt: 1, runState: 'uploaded' },
      ],
    });
  });

  it('renders rows newest-first and shows status dots', () => {
    render(<Sidebar selectedId={null} onSelect={() => {}} onNew={() => {}} onSettings={() => {}} />);
    const rows = screen.getAllByRole('button', { name: /a\.mp4|b\.mp4/ });
    expect(rows[0].textContent).toContain('a.mp4');
    expect(screen.getByLabelText(/Status: detecting/)).toBeTruthy();
    expect(screen.getByLabelText(/Status: uploaded/)).toBeTruthy();
  });

  it('clicking a row calls onSelect', () => {
    const onSelect = vi.fn();
    render(<Sidebar selectedId={null} onSelect={onSelect} onNew={() => {}} onSettings={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /a\.mp4/ }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('clicking + New khutbah calls onNew', () => {
    const onNew = vi.fn();
    render(<Sidebar selectedId={null} onSelect={() => {}} onNew={onNew} onSettings={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ new khutbah/i }));
    expect(onNew).toHaveBeenCalled();
  });

  it('clicking Settings calls onSettings', () => {
    const onSettings = vi.fn();
    render(<Sidebar selectedId={null} onSelect={() => {}} onNew={() => {}} onSettings={onSettings} />);
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(onSettings).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/renderer/Sidebar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/Sidebar.tsx`**

```tsx
import { useProjects } from '../store/projects';
import { StatusDot } from './StatusDot';

export type SidebarProps = {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
};

const subtitleFor = (p: ReturnType<typeof useProjects.getState>['projects'][number]): string => {
  switch (p.runState) {
    case 'detecting':
      return p.progress !== undefined ? `Detecting · ${p.progress}%` : 'Detecting…';
    case 'cutting':
      return 'Cutting…';
    case 'uploading':
      return p.progress !== undefined ? `Uploading · ${p.progress}%` : 'Uploading…';
    case 'needs_review':
      return 'Needs review';
    case 'ready':
      return 'Ready to upload';
    case 'uploaded':
      return 'Uploaded';
    case 'error':
      return p.lastError ?? 'Error';
    case 'idle':
    default:
      return 'Idle';
  }
};

export function Sidebar({ selectedId, onSelect, onNew, onSettings }: SidebarProps) {
  const projects = useProjects((s) => s.projects);
  const sorted = [...projects].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <aside className="w-60 bg-slate-950 border-r border-slate-800 flex flex-col">
      <div className="px-4 py-4 border-b border-slate-800 text-amber-300 font-display">
        KhutbahEditor
      </div>
      <button
        onClick={onNew}
        className="m-2 px-3 py-2 bg-amber-400 text-slate-900 rounded font-semibold text-sm"
      >
        + New khutbah
      </button>
      <div className="flex-1 overflow-auto px-1.5">
        {sorted.map((p) => {
          const name = p.sourcePath.split('/').pop() ?? p.id;
          const isActive = p.id === selectedId;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded mb-1 text-left ${isActive ? 'bg-slate-800' : 'hover:bg-slate-900'}`}
            >
              <div className="relative w-12 h-8 bg-slate-700 rounded flex-shrink-0">
                {p.thumbnailPath && (
                  <img src={`file://${p.thumbnailPath}`} alt="" className="w-full h-full object-cover rounded" />
                )}
                <span className="absolute -top-0.5 -right-0.5 ring-1 ring-slate-950 rounded-full">
                  <StatusDot runState={p.runState} />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-slate-100 text-xs truncate">{name}</div>
                <div className="text-slate-500 text-[10px] truncate">{subtitleFor(p)}</div>
              </div>
            </button>
          );
        })}
      </div>
      <button
        onClick={onSettings}
        className="m-2 px-3 py-2 bg-transparent text-slate-400 border border-slate-700 rounded text-sm"
      >
        ⚙ Settings
      </button>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/Sidebar.test.tsx`
Expected: PASS — 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx tests/renderer/Sidebar.test.tsx
git commit -m "feat(ui): Sidebar with thumbnail rows + status dots

Newest project first; row shows thumbnail, status dot, name, subtitle.
+ New khutbah at top; ⚙ Settings at bottom.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Shell + wire-up

### Task 20: `Shell` — two-pane layout that owns view + selectedProjectId

**Files:**
- Create: `src/screens/Shell.tsx`
- Test: `tests/renderer/Shell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Shell } from '../../src/screens/Shell';
import { useProjects } from '../../src/store/projects';
import { useUi } from '../../src/store/ui';

const ready = {
  id: 'p1',
  sourcePath: '/p1.mp4',
  duration: 200,
  createdAt: 1,
  runState: 'ready' as const,
  part1: { start: 10, end: 100, confidence: 0.95, outputPath: '/p1-out.mp4' },
  part2: { start: 110, end: 195, confidence: 0.95, outputPath: '/p2-out.mp4' },
};

describe('Shell', () => {
  beforeEach(() => {
    Object.assign(window, {
      khutbah: {
        auth: { listAccounts: vi.fn(() => Promise.resolve([])) },
        settings: { get: vi.fn(() => Promise.resolve({ computeDevice: 'auto', outputDir: '/o' })), set: vi.fn() },
        pipeline: { call: vi.fn(() => Promise.resolve([])), onProgress: vi.fn(() => () => {}) },
        dialog: { openVideo: vi.fn(), openAudio: vi.fn() },
      },
    });
  });

  it('with no project selected: shows EmptyState', () => {
    useProjects.setState({ projects: [] });
    useUi.setState({ selectedProjectId: null, view: 'review' });
    render(<Shell />);
    expect(screen.getByRole('button', { name: /new khutbah/i })).toBeTruthy();
  });

  it('with a ready project selected: shows ReviewPane', () => {
    useProjects.setState({ projects: [ready] });
    useUi.setState({ selectedProjectId: 'p1', view: 'review' });
    render(<Shell />);
    expect(screen.getByRole('tab', { name: /part 1/i })).toBeTruthy();
  });

  it('view=settings: shows SettingsPane', async () => {
    useProjects.setState({ projects: [ready] });
    useUi.setState({ selectedProjectId: 'p1', view: 'settings' });
    render(<Shell />);
    expect(await screen.findByLabelText(/compute device/i)).toBeTruthy();
  });

  it('view=upload: shows UploadPane', async () => {
    useProjects.setState({ projects: [ready] });
    useUi.setState({ selectedProjectId: 'p1', view: 'upload' });
    render(<Shell />);
    expect(await screen.findByText(/Upload to YouTube/i)).toBeTruthy();
  });

  it('clicking + New khutbah opens the modal', () => {
    useProjects.setState({ projects: [] });
    useUi.setState({ selectedProjectId: null, view: 'review' });
    render(<Shell />);
    fireEvent.click(screen.getAllByRole('button', { name: /\+ new khutbah/i })[0]);
    expect(screen.getByRole('tab', { name: /youtube/i })).toBeTruthy();
  });

  it('error state: shows ErrorPane with Retry', () => {
    useProjects.setState({ projects: [{ ...ready, runState: 'error', lastError: 'boom' }] });
    useUi.setState({ selectedProjectId: 'p1', view: 'review' });
    render(<Shell />);
    expect(screen.getByText(/boom/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('detecting state: shows DetectingPane with progress', () => {
    useProjects.setState({ projects: [{ ...ready, runState: 'detecting', progress: 42 }] });
    useUi.setState({ selectedProjectId: 'p1', view: 'review' });
    render(<Shell />);
    expect(screen.getByText(/42%/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/renderer/Shell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/screens/Shell.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useProjects } from '../store/projects';
import { useUi } from '../store/ui';
import { Sidebar } from '../components/Sidebar';
import { EmptyState } from '../components/EmptyState';
import { NewKhutbahModal } from '../components/NewKhutbahModal';
import { ReviewPane } from '../components/ReviewPane';
import { DetectingPane } from '../components/DetectingPane';
import { ErrorPane } from '../components/ErrorPane';
import { UploadPane } from '../components/UploadPane';
import { SettingsPane } from '../components/SettingsPane';
import { Toaster } from '../components/Toaster';
import { JobManager } from '../jobs/JobManager';

const bridge = {
  call: <T,>(method: string, params?: unknown) => window.khutbah!.pipeline.call<T>(method, params),
  onProgress: (l: (ev: { projectId: string; stage: string; pct: number }) => void) =>
    window.khutbah!.pipeline.onProgress((ev) => l(ev as { projectId: string; stage: string; pct: number })),
};

export function Shell() {
  const [modalOpen, setModalOpen] = useState(false);
  const projects = useProjects((s) => s.projects);
  const { selectedProjectId, view, select, setView } = useUi();
  const project = useMemo(() => projects.find((p) => p.id === selectedProjectId), [projects, selectedProjectId]);
  const jm = useMemo(() => new JobManager(bridge), []);

  const handleSubmitYoutube = (url: string) => {
    const id = `proj-${Date.now()}`;
    useProjects.getState().add({
      id, sourcePath: url, duration: 0, createdAt: Date.now(), runState: 'idle',
    });
    select(id);
    jm.startDetect(id);
    setModalOpen(false);
  };
  const handleSubmitLocal = (path: string) => {
    const id = `proj-${Date.now()}`;
    useProjects.getState().add({
      id, sourcePath: path, duration: 0, createdAt: Date.now(), runState: 'idle',
    });
    select(id);
    jm.startDetect(id);
    setModalOpen(false);
  };
  const handleSubmitDual = (audioPath: string, videoPath: string) => {
    const id = `proj-${Date.now()}`;
    useProjects.getState().add({
      id, sourcePath: videoPath, duration: 0, createdAt: Date.now(), runState: 'idle',
    });
    select(id);
    // dual-file alignment + detect; relies on the alignment RPC inside autopilot.ts
    void window.khutbah!.pipeline.call('align.dual_file', { id, audioPath, videoPath })
      .then(() => jm.startDetect(id));
    setModalOpen(false);
  };

  let rightPane;
  if (!project) {
    rightPane = <EmptyState onNew={() => setModalOpen(true)} />;
  } else if (view === 'settings') {
    rightPane = <SettingsPane />;
  } else if (view === 'upload') {
    rightPane = <UploadPane project={project} projectName={project.sourcePath.split('/').pop() ?? ''} onStart={(opts) => jm.startUpload(project.id, opts)} />;
  } else if (project.runState === 'error') {
    rightPane = <ErrorPane message={project.lastError ?? 'Unknown error'} onRetry={() => jm.retry(project.id)} />;
  } else if (project.runState === 'detecting' || project.runState === 'cutting') {
    rightPane = <DetectingPane projectName={project.sourcePath.split('/').pop() ?? ''} progress={project.progress} stage={project.runState === 'detecting' ? 'Detecting boundaries' : 'Re-cutting'} />;
  } else {
    rightPane = <ReviewPane project={project} onAccept={() => setView('upload')} onNudge={(b, d) => jm.startCut(project.id, b, d)} />;
  }

  return (
    <div className="h-screen flex bg-slate-900 text-slate-100">
      <Sidebar
        selectedId={selectedProjectId}
        onSelect={select}
        onNew={() => setModalOpen(true)}
        onSettings={() => setView('settings')}
      />
      <main className="flex-1 min-w-0">{rightPane}</main>
      <NewKhutbahModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmitYoutube={handleSubmitYoutube}
        onSubmitLocal={handleSubmitLocal}
        onSubmitDual={handleSubmitDual}
      />
      <Toaster />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/Shell.test.tsx`
Expected: PASS — 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Shell.tsx tests/renderer/Shell.test.tsx
git commit -m "feat(ui): Shell — two-pane layout switching on view + runState

Single component owns the right-pane swap. JobManager instance is
created per Shell mount and reused for all start*/retry calls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: Update `App.tsx` to render `<Shell />`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Read `src/App.tsx`** to see what needs to be preserved (`maybeAutoPilot()` entry point, top-level effects).

- [ ] **Step 2: Replace `App.tsx` content**

```tsx
import { useEffect } from 'react';
import { Shell } from './screens/Shell';
import { maybeAutoPilot } from './lib/autopilot';

export default function App() {
  useEffect(() => {
    void maybeAutoPilot();
  }, []);

  return <Shell />;
}
```

If `App.tsx` has any other top-level effects (e.g., notification setup, RPC bridge initialization), preserve them. Read the full file first; only the routing logic should disappear.

- [ ] **Step 3: Run the renderer suite**

Run: `npx vitest run tests/renderer`
Expected: PASS — Shell + components + JobManager + ui + projects.runState all green. The two marker tests still exist but pass (they import from files we haven't deleted yet).

- [ ] **Step 4: Run dev server smoke test**

Run: `npm run dev:full`
Expected: Electron window opens, sidebar visible, EmptyState renders. Manually click + New khutbah → modal opens → cancel → modal closes. (No auto-detection runs because no source is given.)
Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(app): App.tsx now renders <Shell /> only

Routing/state moved to Shell. maybeAutoPilot() entry point preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: Rewire `lib/autopilot.ts` to use JobManager

**Files:**
- Modify: `src/lib/autopilot.ts`
- Test: existing `tests/renderer/autopilot.authFailure.test.ts` (must continue to pass)

- [ ] **Step 1: Read `src/lib/autopilot.ts`** in full. Identify the inlined RPC sequence (detect → smart_cut → upload).

- [ ] **Step 2: Refactor `maybeAutoPilot()` and the orchestration helpers** to import and call `JobManager` instead of inlining `window.khutbah.pipeline.call(...)`. The detection / cut / upload calls funnel through `JobManager` so the same Toaster + status-badge updates apply.

Sketch (adapt to actual structure of the file):

```ts
import { JobManager } from '../jobs/JobManager';

const bridge = {
  call: <T,>(method: string, params?: unknown) => window.khutbah!.pipeline.call<T>(method, params),
  onProgress: (l: (ev: { projectId: string; stage: string; pct: number }) => void) =>
    window.khutbah!.pipeline.onProgress((ev) => l(ev as never)),
};

const jm = new JobManager(bridge);

export async function maybeAutoPilot(/* ... */): Promise<void> {
  // ... existing pre-flight checks ...
  jm.startDetect(projectId);
  // detection completion is observed via project.runState — autopilot can poll
  // or subscribe; if it currently inlines an await, replace with a small helper
  // that resolves when runState transitions out of 'detecting'.
}
```

- [ ] **Step 3: Run the existing autopilot test**

Run: `npx vitest run tests/renderer/autopilot.authFailure.test.ts`
Expected: PASS. If the test fails because the test mocked the inline RPC sequence, update the test to mock the same `window.khutbah.pipeline.call` seam — JobManager calls through it identically.

- [ ] **Step 4: Run the full renderer suite**

Run: `npx vitest run tests/renderer`
Expected: PASS for everything.

- [ ] **Step 5: Commit**

```bash
git add src/lib/autopilot.ts tests/renderer/autopilot.authFailure.test.ts
git commit -m "refactor(autopilot): route detection + upload through JobManager

Same RPC contract; autopilot now uses the same orchestration as the
Shell so status badges and Toaster fire identically for autopilot runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Cleanup

### Task 23: Delete `src/editor/*`

**Files:**
- Delete: `src/editor/Timeline.tsx`, `src/editor/VideoPreview.tsx`, `src/editor/PartInspector.tsx`, `src/editor/markersStore.ts`, `src/editor/useShortcuts.ts`
- Delete: `tests/renderer/Editor.markersFromProject.test.ts`, `tests/renderer/markersStore.test.ts`

- [ ] **Step 1: Confirm no remaining imports**

Run: `grep -r "from.*src/editor" src tests electron 2>/dev/null; grep -r "editor/markersStore\|editor/Timeline\|editor/VideoPreview\|editor/PartInspector\|editor/useShortcuts" src tests electron 2>/dev/null`
Expected: no output.

If any usage remains, the importer was missed in earlier tasks — fix those first before continuing.

- [ ] **Step 2: Delete the files**

```bash
git rm src/editor/Timeline.tsx src/editor/VideoPreview.tsx src/editor/PartInspector.tsx src/editor/markersStore.ts src/editor/useShortcuts.ts tests/renderer/Editor.markersFromProject.test.ts tests/renderer/markersStore.test.ts
rmdir src/editor 2>/dev/null || true
```

- [ ] **Step 3: Type-check + run renderer suite**

Run: `npm run build` (this also runs tsc) — Expected: type-check passes.
Run: `npx vitest run tests/renderer` — Expected: PASS for all remaining tests.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(editor): delete legacy editor (Timeline, VideoPreview, markersStore, etc.)

Replaced by ReviewPane + native <video>. ~870 LoC removed plus 80 lines
of editor-specific tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: Delete obsolete `src/screens/*`

**Files:**
- Delete: `src/screens/Editor.tsx`, `src/screens/Welcome.tsx`, `src/screens/Library.tsx`, `src/screens/NewKhutbah.tsx`, `src/screens/Processing.tsx`

- [ ] **Step 1: Confirm no remaining imports**

Run: `grep -rn "from.*screens/Editor\|screens/Welcome\|screens/Library\|screens/NewKhutbah\|screens/Processing" src tests electron 2>/dev/null`
Expected: no output. If a hit, fix the importer first.

- [ ] **Step 2: Delete the files**

```bash
git rm src/screens/Editor.tsx src/screens/Welcome.tsx src/screens/Library.tsx src/screens/NewKhutbah.tsx src/screens/Processing.tsx
```

(Keep `src/screens/Settings.tsx` and `src/screens/AccountsSection.tsx` and `src/screens/Upload.tsx` for now — they're superseded by the new Pane components, but `Upload.tsx` may have logic the new pane doesn't fully cover. Read the original files; if they're now dead code, delete them in this same task.)

- [ ] **Step 3: Decide on the three remaining screens**

Run: `grep -rn "from.*screens/Settings\|screens/AccountsSection\|screens/Upload" src tests electron 2>/dev/null`
- If no hits remain (because Shell only imports the new Pane components), delete them too:
  ```bash
  git rm src/screens/Settings.tsx src/screens/AccountsSection.tsx src/screens/Upload.tsx
  ```
- If a hit remains, leave the file and note it for follow-up.

- [ ] **Step 4: Type-check + tests**

Run: `npm run build && npx vitest run tests/renderer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(screens): delete legacy screens (Welcome/Library/Editor/NewKhutbah/Processing/etc.)

All routing is now in Shell + per-state Pane components.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: Final renderer suite + lint

**Files:** none (verification only)

- [ ] **Step 1: Run all renderer tests**

Run: `npx vitest run tests/renderer`
Expected: PASS — every new component test, the projects + ui store tests, all 5 JobManager tests, the existing eta + fileUrl + autopilot tests.

- [ ] **Step 2: Run all electron tests**

Run: `npx vitest run tests/electron`
Expected: PASS (no regression — we didn't touch electron/).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean. Fix any issues found.

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Commit (only if lint/build needed touch-ups)**

If steps 3 or 4 required source edits:

```bash
git add -A
git commit -m "chore: lint + tsc cleanup after editor removal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If no edits were needed, skip this step — no empty commits.

---

## Phase 6 — E2E

### Task 26: Playwright smoke test for the new shell

**Files:**
- Create: `tests/e2e/shell.spec.ts`

- [ ] **Step 1: Read existing Playwright tests** in `tests/e2e/` (if any) to learn the project's pattern for launching Electron under Playwright. If none exist, the first run also bootstraps the directory.

- [ ] **Step 2: Write the smoke test**

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';

test('shell smoke: sidebar + right-pane state transitions', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../dist/electron/main.cjs')],
    env: {
      ...process.env,
      KHUTBAH_FIXTURE_PROJECTS: JSON.stringify([
        { id: 'ready1', sourcePath: '/fixture/ready.mp4', duration: 200, createdAt: 3, runState: 'ready', part1: { start: 10, end: 100, confidence: 0.95, outputPath: '/fixture/p1.mp4' }, part2: { start: 110, end: 195, confidence: 0.95, outputPath: '/fixture/p2.mp4' } },
        { id: 'err1', sourcePath: '/fixture/err.mp4', duration: 1, createdAt: 2, runState: 'error', lastError: 'sidecar crashed' },
        { id: 'up1', sourcePath: '/fixture/up.mp4', duration: 1, createdAt: 1, runState: 'uploaded' },
      ]),
    },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // 3 sidebar rows
  await expect(window.locator('aside button').filter({ hasText: /\.mp4/ })).toHaveCount(3);

  // Click ready project → ReviewPane visible
  await window.locator('aside').getByRole('button', { name: /ready\.mp4/ }).click();
  await expect(window.getByRole('tab', { name: /part 1/i })).toBeVisible();

  // + New khutbah opens modal
  await window.getByRole('button', { name: /\+ new khutbah/i }).click();
  await expect(window.getByRole('tab', { name: /youtube/i })).toBeVisible();
  await window.getByRole('button', { name: /cancel/i }).click();
  await expect(window.getByRole('tab', { name: /youtube/i })).not.toBeVisible();

  // Settings → SettingsPane
  await window.getByRole('button', { name: /settings/i }).click();
  await expect(window.getByLabelText(/compute device/i)).toBeVisible();

  // Click any project → ReviewPane returns
  await window.locator('aside').getByRole('button', { name: /ready\.mp4/ }).click();
  await expect(window.getByRole('tab', { name: /part 1/i })).toBeVisible();

  await app.close();
});
```

The fixture envelope `KHUTBAH_FIXTURE_PROJECTS` is read by `electron/main.ts` (or by the renderer on bootstrap) to pre-seed the projects store before render. If that hook doesn't exist, add it:

In `src/main.tsx` (or wherever the React tree is bootstrapped), before `<App />` mounts:

```ts
const fixture = (window as unknown as { KHUTBAH_FIXTURE_PROJECTS?: string }).KHUTBAH_FIXTURE_PROJECTS;
if (fixture) {
  try {
    const projects = JSON.parse(fixture);
    useProjects.setState({ projects });
  } catch { /* ignore */ }
}
```

And in `electron/preload.ts`, expose `process.env.KHUTBAH_FIXTURE_PROJECTS` on `window`:

```ts
contextBridge.exposeInMainWorld('KHUTBAH_FIXTURE_PROJECTS', process.env.KHUTBAH_FIXTURE_PROJECTS);
```

- [ ] **Step 3: Build + run Playwright**

Run: `npm run build && npx playwright test tests/e2e/shell.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/shell.spec.ts src/main.tsx electron/preload.ts
git commit -m "test(e2e): Playwright smoke for the new two-pane shell

Pre-seeds three fixture projects via KHUTBAH_FIXTURE_PROJECTS env var,
then asserts sidebar + right-pane transitions through Review / Modal /
Settings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review (run after writing — checklist for the engineer)

After all 26 tasks land:

1. **Spec coverage check.** Open `docs/superpowers/specs/2026-04-27-gui-strip-design.md` next to this plan. For each numbered section, point to the task that implements it:
   - §2 Architecture — Tasks 1, 2, 3, 20, 21
   - §3 Right pane states — Tasks 9, 10, 11, 12, 14, 15, 16, 20
   - §4 Sidebar — Task 19
   - §5 Component map — covered cumulatively by Tasks 8–22; deletions in Tasks 23–24
   - §6 Data flow / JobManager — Tasks 1, 3, 4, 4b, 5, 6, 7, 18
   - §6 Thumbnail generation — Task 4b
   - §7 Testing — every task has tests; aggregated in Task 25
   - §8 Out of scope — confirm no task added external-editor or detection-param UI

2. **Placeholder scan.** Search for `TODO`, `TBD`, `implement later`, vague "add validation". Fix or open follow-up tasks.

3. **Type consistency.** `Boundary` is `'p1Start' | 'p1End' | 'p2Start' | 'p2End'` in every task. `RunState` is the same union in tests and source. `UploadOpts` shape matches between JobManager and UploadPane.

4. **Open follow-ups identified during implementation:**
   - Thumbnail generation in `JobManager.startDetect` (cf. spec §6 "Thumbnail generation"). If not implemented in Task 4, file a follow-up task.
   - `Logo` import path in `EmptyState` may need adjustment depending on actual file location.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-27-gui-strip-implementation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
