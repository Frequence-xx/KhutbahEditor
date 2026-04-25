# Resumption Prompt — KhutbahEditor

Copy-paste the block below verbatim into a fresh Claude Code session at the start of each work session. It restores full context in one shot.

---

```
You are continuing work on KhutbahEditor — a self-contained cross-platform desktop app
(macOS .dmg, Windows .exe, Linux .AppImage/.deb) for editing Friday khutbah videos and
publishing them to YouTube.

WORKING DIRECTORY: /home/farouq/Development/alhimmah
GIT BRANCH: main
GIT REMOTE: git@github.com-frequencexx:Frequence-xx/KhutbahEditor.git
              ↑ uses an SSH alias (~/.ssh/config Host github.com-frequencexx →
                ~/.ssh/id_ed25519_frequencexx). The default github.com still
                routes to the talibfitrah identity for other repos. Push works.

ENV FILE: .env exists at repo root (gitignored) with GOOGLE_OAUTH_CLIENT_ID
          already populated for the Frequence-xx Desktop OAuth client. Verify
          with `grep GOOGLE_OAUTH_CLIENT_ID .env` — if empty, copy from
          .env.example and check the lockbox the user keeps it in.

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
  • YouTube auth: shared OAuth client (Frequence-xx Google Cloud), loopback + PKCE,
    MULTI-ACCOUNT (N signed-in YouTube channels per install — same khutbah often
    published to multiple Al-Himmah channels)
  • OAuth consent screen state: Testing (NOT Production). 7-day refresh-token
    lifetime is INTENTIONAL — do not "fix" by pressing Publish app, that would
    block all sign-ins for 4-6 weeks pending Google's verification + YouTube
    API services audit. v1 stays in Testing. The app handles invalid_grant
    per-account gracefully with a re-auth toast.
  • Playlist support: per-account default playlist; auto-create if missing
    on that channel (toggleable in Settings)
  • Per-upload metadata: shared by default, "Customize per account" toggle
    splits into per-(account, part) metadata panels
  • Distribution: unsigned on all platforms (Mac/Windows/Linux), README documents bypass
  • Auto-pilot: ON by default; Editor opens only when confidence < 90%

═══════════════════════════════════════════════════════════════════════
OPEN ITEMS the user handles out-of-band when execution reaches them
═══════════════════════════════════════════════════════════════════════

  ✓ DONE — Frequence-xx Google Cloud OAuth Client ID provisioned. The Client
    ID is in .env (gitignored) as GOOGLE_OAUTH_CLIENT_ID. OAuth consent screen
    is in Testing state with the user's Google account(s) added as test users.

  • Phase 3 — when Phase 3 testing begins, confirm with the user which test
    user emails are added to the consent screen. If a sign-in fails with
    "App is not verified — only test users allowed," the user needs to add
    that Google account email under OAuth consent → Test users.

  • Phase 5 — alhimmah.nl/khutbaheditor/privacy must be a real 200-OK page
    before any production-mode work (which is out of v1 scope anyway). For
    Testing-mode v1 release a placeholder page suffices.

  • Pre-release — when the user is eventually ready to scale beyond ~100
    test users, that's a separate ~4-6 week workstream: submit for app
    verification + YouTube API services audit. Out of scope for v1.

When you reach these gates, pause and prompt the user — don't try to provision
external accounts on their behalf.

═══════════════════════════════════════════════════════════════════════
ONE-SHOT EXECUTION MANDATE
═══════════════════════════════════════════════════════════════════════

This is a ONE-SHOT execution session. You have STANDING AUTHORIZATION to execute
the entire plan from the next uncommitted task all the way through tagging the
release, in a single session, without asking permission task-by-task.

You do not ask "should I proceed?", "ready for the next task?", "want me to run
the review now?", or any other permission-seeking question. The plan is the
authorization. Execute it.

═══════════════════════════════════════════════════════════════════════
THE 95% CERTAINTY RULE — HOW DECISIONS GET MADE
═══════════════════════════════════════════════════════════════════════

Every decision point during execution gets one of three outcomes:

  ACT      — you are ≥95% certain of the right call. Do it. No question.

  RESEARCH — you are <95% certain. Do not act yet, do not escalate yet.
             Instead: read more code, run more commands, check spec/plan
             cross-references, search the docs, read the library source,
             run a small experiment, write a probe test, fetch upstream
             docs via context7 or web search, inspect git blame, read
             prior commits — whatever it takes to RAISE your certainty
             to ≥95%. Iterate the research loop until you cross the bar.

  ESCALATE — only if you've exhausted research and still can't reach 95%
             (genuinely ambiguous spec, missing external info that only
             the user has, conflicting authoritative sources). Surface
             ONE clear question with the research you've already done
             and the specific blocker. Wait for an answer.

Default to RESEARCH, not ESCALATE. A long research loop that reaches a confident
decision is always better than a quick escalation that interrupts the user.
A wrong action is worse than research that takes time.

Concrete examples:

  • Subagent's diff doesn't match the task spec
       → RESEARCH (read both, re-run the spec's test, run `git diff`,
         understand the deviation) → ACT (either accept the better
         implementation if you can prove it's actually better, or send
         the subagent back with a precise correction).
       Don't escalate to user unless the deviation is a deliberate
       design departure that requires user judgment.

  • Two reviewers disagree on a Level-1 review verdict
       → RESEARCH (read the code yourself, read both reviews, identify
         the substantive technical claim under each) → ACT (take the
         stricter view per AGENTS.md reconciliation rule, document the
         call in the next commit).

  • A library's API surface differs from the plan's example code
       → RESEARCH (use context7 or fetch the library's current docs,
         check the installed version with `npm ls X` or `pip show X`)
         → ACT (update the call site to match real API, note the
         deviation in commit body).

  • A test is flaky on the second consecutive run
       → RESEARCH (read the test, identify the timing/state dependency
         per AGENTS.md flakiness section) → ACT (fix the root cause,
         not the symptom; if you can't find root cause after thorough
         investigation, then ESCALATE).

  • Auto-pilot fails on the canonical test khutbah
       → RESEARCH (capture the failing stage's error, inspect the
         intermediate artifacts, check Whisper output, check silence
         detection output) → ACT (fix forward) OR ESCALATE only if the
         issue points to something requiring user account access.

The bar is 95% certainty about the RIGHT CALL, not 95% certainty about the
outcome. You can be 95% sure that "send the subagent back with this
correction" is right even if you're 60% sure whether the corrected
implementation will pass on the first try. Research sufficiently to know
the right action, then take it.

═══════════════════════════════════════════════════════════════════════
ESCALATION POINTS — THE ONLY REASONS TO STOP
═══════════════════════════════════════════════════════════════════════

Stop and prompt the user only on:

  1. Open external-setup item the user has to do themselves
     (Phase 3: Frequence-xx Google Cloud OAuth client provisioning;
      Phase 5: alhimmah.nl/khutbaheditor/privacy page hosting).
     Stop, surface the requirement clearly, wait.

  2. A Phase Review Gate verdict of REJECT after good-faith research-and-fix
     iteration — i.e., you genuinely cannot get the gate to APPROVE without
     re-architecting something the user previously locked.

  3. A locked design decision that you are ≥95% certain is actually wrong
     and that affects the current task. Don't silently change it.
     Surface the issue, your evidence, and your recommended replacement.

  4. A genuine ambiguity in the spec or plan that no amount of research
     resolves (rare — most "ambiguities" yield to careful reading).

  5. Destructive operations the user must authorize:
       • git push --force, git reset --hard, git branch -D
       • rm -rf outside of build/dist/node_modules dirs
       • git config --global changes
       • paid API calls beyond the canonical test khutbah
       • OAuth account changes
       • Public PR comments / external messages

  6. The user explicitly interrupts.

That's the full list. Everything else: RESEARCH → ACT.

═══════════════════════════════════════════════════════════════════════
START NOW
═══════════════════════════════════════════════════════════════════════

Do this in order, without prompting between steps:

  1. Run Steps 1-3 (read the four files, check git state, invoke the
     subagent-driven-development skill).
  2. Identify the next uncommitted task from the plan.
  3. Briefly state (one line each): current phase, next task number, any
     state issues. No questions.
  4. Dispatch the first subagent for that task. Continue executing the
     plan, applying the 95% certainty rule, until you hit one of the
     six escalation points or the v1.0.0 tag is pushed.

Do NOT ask the user "should I begin?", "ready to start?", "want me to
proceed?", or any equivalent. Begin.
```

---

## How to use this prompt

- **Save it locally** outside the repo (a notes app or password manager) so you can paste it even when the repo isn't checked out
- **One copy lives here in `docs/RESUME.md`** so future-you (or future-AI) can find it inside the repo
- **Update it** when locked decisions change, when phases complete, or when the open-items list changes
