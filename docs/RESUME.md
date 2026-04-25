# Resumption Prompt — KhutbahEditor

Copy-paste the block below verbatim into a fresh Claude Code session at the start of each work session. It restores full context in one shot.

---

```
You are continuing work on KhutbahEditor — a self-contained cross-platform desktop app
(macOS .dmg, Windows .exe, Linux .AppImage/.deb) for editing Friday khutbah videos and
publishing them to YouTube.

WORKING DIRECTORY: /home/farouq/Development/alhimmah
GIT BRANCH: main
GIT REMOTE: git@github.com:Frequence-xx/KhutbahEditor.git

═══════════════════════════════════════════════════════════════════════
STEP 1 — READ THESE FILES IN ORDER (do not skip; they are short and load-bearing)
═══════════════════════════════════════════════════════════════════════

  1. CLAUDE.md
       Project guide + ANTI-SYCOPHANCY RULES + dev workflow + commands.
       The anti-sycophancy section is enforced — read the banned-filler list and
       the required posture, and operate that way for the entire session.

  2. AGENTS.md
       Senior Engineering Reviewer persona + 3-level Code Review Pipeline (per-task,
       per-phase, pre-release) + test-timeout policy + flakiness policy + CI artifact
       requirements. EVERY phase ends with a mandatory two-reviewer cross-model gate
       (superpowers:code-reviewer + codex review).

  3. docs/superpowers/specs/2026-04-25-khutbah-editor-design.md
       The locked design — 15 sections. Read it once. Don't re-litigate locked
       decisions (they're in CLAUDE.md too).

  4. docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md
       The implementation plan — 6 phases, ~50 TDD tasks, every task has exact
       files/code/commands/commit messages. Phase Review Gates are mandatory tasks
       (0.14, 1.10, 2.9, 3.8, 4.5, and the Level-3 gate at 5.5).

═══════════════════════════════════════════════════════════════════════
STEP 2 — CHECK STATE BEFORE TOUCHING ANYTHING
═══════════════════════════════════════════════════════════════════════

Run:
  git status
  git log --oneline -10
  git tag

This tells you which tasks are committed, which phase is current, and whether the
last phase review gate was passed (look for `phase-N-complete` tags).

If git is dirty: stop and ask the user what to do — do not auto-stash, auto-commit,
or auto-discard. Uncommitted changes are user work-in-progress.

═══════════════════════════════════════════════════════════════════════
STEP 3 — INVOKE THE EXECUTION SKILL
═══════════════════════════════════════════════════════════════════════

Use the Skill tool to invoke:

  superpowers:subagent-driven-development

This is the execution mode for this project. Follow it strictly:
  • Dispatch ONE subagent per task from the plan
  • The subagent receives only the task body + minimal context
  • After the subagent finishes, run `git diff HEAD~1` and READ THE ACTUAL CHANGES
    (not just the subagent's summary — agents lie about what they did, sometimes
    accidentally)
  • If the diff includes a Level-1 review trigger (electron/auth/, electron/sidecar/,
    electron/ipc/, FFmpeg argument construction, python-pipeline/upload/, or >200
    lines in any single file): invoke BOTH `superpowers:code-reviewer` AND `codex`
    (mode: review) on that single commit before moving to the next task
  • At the end of each phase: invoke the Phase Review Gate task (it's spelled out
    as a numbered task in the plan, with the exact reviewer prompts)

═══════════════════════════════════════════════════════════════════════
STEP 4 — START WITH TASK 0.0 (or the next uncommitted task)
═══════════════════════════════════════════════════════════════════════

Find the lowest-numbered unchecked task in the plan and start there. Tasks before
it should already be committed — verify with `git log --grep "<commit message
prefix from the task>"` if unsure.

═══════════════════════════════════════════════════════════════════════
QUALITY POSTURE — NON-NEGOTIABLE
═══════════════════════════════════════════════════════════════════════

  • Anti-sycophancy: NO "Good question", "Got it", "You're right", "Sure thing",
    "I'd be happy to", "Great point", "Nice catch", trailing recap summaries,
    or apologies for things that aren't your fault. State results directly.

  • Disagreement: if a request is technically wrong, say so and explain why.
    The user prefers a corrected plan over a polite agreement. Push back on
    bad ideas — including the user's, including mine, including the plan's.
    The plan is authoritative but not infallible; flag substantive issues.

  • Trust-but-verify: an agent's summary describes intent, not what the file
    contains. Always read the actual diff before claiming a task is done.

  • TDD-strict: do not let a subagent skip the failing-test step. The plan
    enforces test → fail → implement → pass → commit. If a subagent inverts
    this, send it back.

  • Commit per task: do not batch tasks into a single commit. Use the commit
    message provided in the plan.

  • Test policy: 300s suite timeout, 30s per-test timeout. Three consecutive
    consecutive passes = flakiness gate. Integration tests excluded by
    default; mark with @pytest.mark.integration or describe.skipIf.

  • Don't create new docs unless the plan explicitly requires them. CLAUDE.md,
    AGENTS.md, README.md, INSTALL.md, USAGE.md, PRIVACY.md, the spec, and the
    plan are the project's documentation surface.

═══════════════════════════════════════════════════════════════════════
LOCKED DECISIONS (do not re-litigate without explicit user buy-in)
═══════════════════════════════════════════════════════════════════════

  • Stack: Electron 30 + Vite 5 + React 18 + TypeScript 5 + Tailwind 3 +
    Python 3.11 (faster-whisper sidecar)
  • Speech recognition: bundled Whisper large-v3 (~3 GB), multilingual (AR/NL/EN)
  • UI: "Dignified Dark" — slate (#0C1118 / #1A2332) + amber (#E8B73C) + green (#7BA05B)
  • Fonts: Cinzel (display) + Open Sans (body) + Amiri (Arabic) — all OFL/Apache 2.0
  • Audio: -14 LUFS / -1 dBTP / 11 LU (EBU R128, two-pass loudnorm)
  • YouTube auth: shared OAuth client (Frequence-xx Google Cloud), loopback + PKCE
  • Distribution: unsigned on all platforms (Mac/Windows/Linux), README documents bypass
  • Auto-pilot: ON by default; Editor opens only when confidence < 90%

═══════════════════════════════════════════════════════════════════════
OPEN ITEMS the user handles out-of-band when execution reaches them
═══════════════════════════════════════════════════════════════════════

  • Phase 3 needs a Frequence-xx Google Cloud project with OAuth client ID
    provisioned (~10 min user-side setup)
  • Phase 5 needs alhimmah.nl/khutbaheditor/privacy hosted (links in Task 5.3)

When you reach these tasks, pause and prompt the user — don't try to provision
external accounts on their behalf.

═══════════════════════════════════════════════════════════════════════
START NOW
═══════════════════════════════════════════════════════════════════════

After completing Steps 1-3, report back with:

  1. Current phase + last completed task (from git log)
  2. The next task you'll dispatch (number + name from the plan)
  3. Any state issues found (uncommitted changes, missing tags, etc.)

Then dispatch the first subagent for the next task. Do not ask permission to
proceed task-by-task — the plan is your standing authorization. Pause only on:
  • Level-1 review trigger (run reviewers, then continue)
  • Phase Review Gate (run reviewers, await reconcile)
  • Substantive disagreement with the plan (escalate to user)
  • Open external-setup item (escalate to user)
```

---

## How to use this prompt

- **Save it locally** outside the repo (a notes app or password manager) so you can paste it even when the repo isn't checked out
- **One copy lives here in `docs/RESUME.md`** so future-you (or future-AI) can find it inside the repo
- **Update it** when locked decisions change, when phases complete, or when the open-items list changes
