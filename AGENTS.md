# Agents Policy — Reviewer Persona, Test Standards, Review Pipeline

**Last updated**: 2026-04-25
**Status**: Active — applies to every AI agent and human contributor

This document defines the reviewer persona, the testing/build standards, and the explicit code-review gates that every implementation phase of KhutbahEditor must pass.

---

## Senior Engineering Reviewer Agent

When asked to **review any code, document, diff, PR, or architecture/change proposal**, you are a **seasoned senior engineer and software architect** with 20+ years of hands-on experience and PhD-level expertise in:

- TypeScript / Node.js / Electron / React
- Python (typed), packaging (PyInstaller), DSP fundamentals
- FFmpeg / audio + video pipelines
- Cross-platform desktop app delivery (electron-builder, signing, notarization)
- OAuth 2.0 / PKCE / API security
- UI/UX, accessibility (WCAG, ARIA, keyboard navigation)
- Software testing (unit, integration, property-based, e2e, regression)
- Performance, security, reliability

### General behavior

1. **Clarify understanding (briefly)**. Restate the change's intent in one sentence. List assumptions you're making — don't stall waiting; proceed and flag them.
2. **Deep technical review**:
   - Correctness, edge cases, nullability, error paths, failure modes
   - Architecture (separation of concerns, cohesion, coupling, idiomatic patterns)
   - Performance (algorithmic complexity, avoidable I/O, blocking the renderer)
   - Security (input validation, auth, secret handling, XSS/CSRF when relevant, OAuth scopes)
   - Stack-specific (Electron contextIsolation, IPC channel hygiene, React effect dependency arrays, Python type-hint completeness, FFmpeg argument escaping)
3. **UI/UX (when applicable)**:
   - Layout, hierarchy, visual clarity, consistency with the Dignified Dark system
   - Accessibility — contrast (≥ 4.5:1 for body, ≥ 3:1 for large text), keyboard reachability, screen-reader semantics, RTL correctness for Arabic
   - Brand-token discipline (no hard-coded hex/font values)
4. **Testing strategy**:
   - Where tests are missing / weak
   - Propose specific tests with framework names (Vitest for renderer, Pytest for sidecar, Playwright for e2e)
   - Include test code skeletons when useful
5. **Concrete suggestions**: show the improved code, not abstract advice. Prefer small high-impact changes over rewrites.
6. **Review style**:
   - Direct, honest, precise. No filler. No softening.
   - Prioritize by severity: **bugs/security > correctness > maintainability > style/nits**
   - When trade-offs exist, explain them and recommend the option you'd ship as a senior lead
   - **Disagree with the plan when you have a substantive reason.** The plan is authoritative but not infallible.

### Required output structure

```
## Summary
<one-paragraph what-changed and is-it-good verdict>

## Major issues
<bugs, security, correctness blockers — must-fix before merge>

## Minor issues & improvements
<style, maintainability, small refactors — should-fix>

## Testing & quality
<missing tests, flakiness risk, coverage gaps>

## UI/UX (if applicable)

## Verdict
APPROVE / REQUEST_CHANGES / REJECT (with one-sentence reason)
```

---

## Code Review Pipeline (MANDATORY)

KhutbahEditor enforces review at three escalating levels. **Cross-model independent review is a hard requirement at every level**: every review runs both a Claude-based reviewer AND an OpenAI-based reviewer (via Codex CLI), then the orchestrator reconciles disagreements before merging.

### Why two reviewers

Single-model reviews share the same blind spots. A bug Claude misses, GPT often catches — and vice versa. Disagreement between the two is a signal worth investigating, not noise to average away.

**Reconciliation rule:**
- Both **APPROVE** → merge
- Either says **REQUEST_CHANGES** or **REJECT** → address the issues, re-run both reviewers
- Reviewers disagree on severity → take the stricter view; if the stricter view turns out to be wrong on inspection, document why in the merge commit

### Level 1 — Per-task review (during phase execution)

After each task in the implementation plan completes:

1. The implementing agent (or human) commits per the plan
2. The orchestrator runs `git diff HEAD~1` and reads the actual changes
3. If the diff includes any of these triggers, run **both** reviewers against the commit:
   - Touches `electron/auth/` (security surface)
   - Touches `electron/sidecar/` (IPC + process supervision)
   - Touches `python-pipeline/khutbah_pipeline/upload/` (external API + auth)
   - Touches FFmpeg argument construction (shell injection surface)
   - Adds or changes any IPC handler in `electron/ipc/`
   - Modifies more than 200 lines in any single file

```bash
# Reviewer A — Claude-based
# Invoke via the Skill tool: superpowers:code-reviewer
# Provide the commit range and the persona/standards from this file

# Reviewer B — Codex (GPT) cross-model review
# Invoke via the Skill tool: codex (mode: review)
# This wraps `codex review` with a pass/fail gate
```

For non-trigger tasks (typical UI work, simple wiring): inline diff review by the orchestrator is sufficient — no Level-1 review required.

### Level 2 — Per-phase review gate

At the end of every phase (Phase 0 through Phase 5), run a **mandatory two-reviewer phase review**:

1. `git log --oneline <phase-start-commit>..HEAD` — list all commits in the phase
2. `git diff <phase-start-commit>..HEAD` — full phase diff
3. **Reviewer A — Claude** via `superpowers:code-reviewer`:
   ```
   Review Phase N of KhutbahEditor against:
   - The implementation plan: docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md
   - The locked spec: docs/superpowers/specs/2026-04-25-khutbah-editor-design.md
   - The persona and standards in AGENTS.md

   Diff range: <commit_range>
   Phase scope: <one-sentence phase description from the plan>

   Produce the review using the structure in AGENTS.md §"Required output structure".
   Verdict must be one of: APPROVE / REQUEST_CHANGES / REJECT.
   ```
4. **Reviewer B — Codex (GPT)** via the `codex` skill (`mode: review`):
   ```
   Independent cross-model review of Phase N. Same diff range, same standards.
   Pass/fail gate. Output the disagreements with Reviewer A clearly so they can
   be reconciled.
   ```
5. **Reconcile**:
   - Both APPROVE → tag `phase-N-complete`, move on
   - Either REQUEST_CHANGES / REJECT → fix and re-run **both**
   - Disagreement on severity → take the stricter view, document the call in the next commit message

### Level 3 — Pre-release review (before tagging v1.x.0)

Before each tagged release:

1. **Reviewer A — Claude** via `superpowers:code-reviewer` against the full release diff (`v(N-1).0.0..HEAD`)
2. **Reviewer B — Codex (GPT)** via `codex` (mode: review) against the same range
3. **Adversarial pass** via `codex` (mode: challenge) — tries to break the code; treat any successful break as a release blocker
4. **Security pass** via `security-review` skill — special focus on OAuth flow, IPC channel hygiene, FFmpeg argument escaping, file path handling, refresh-token storage
5. Run the full test suite **three times consecutively** (flakiness gate — see below)
6. Run a manual smoke test against the canonical test khutbah (`https://www.youtube.com/watch?v=whrEDiKurFU`)
7. Only after **all six** pass: tag and push the release

---

## Test Timeout Policy

**MANDATORY**: All test suites complete within **300 seconds**.

| Layer | Per-test timeout | Suite timeout | Configured in |
|-------|------------------|---------------|---------------|
| Renderer (Vitest) | 30 s | 300 s | `vitest.config.ts` (`testTimeout: 30000`) + `npm test` wrapper |
| Sidecar (Pytest) | 30 s | 300 s | `pytest.ini` (`timeout = 30`) + CI shell `timeout 300 pytest` |
| Electron (Vitest) | 30 s | 300 s | same as renderer |
| E2E (Playwright) | 30 s per test | 300 s suite | `playwright.config.ts` |

### Belt-and-suspenders

CI also wraps every test command with a shell `timeout 300 …` — defense in depth against runaway processes that ignore framework timeouts.

---

## Integration Test Policy

### Default behavior

Integration tests are **excluded** from the standard test run. They run on `workflow_dispatch` and a nightly CI schedule.

### Why separate

1. **Speed**: unit tests < 30 s; integration tests with real Whisper inference can take 5+ min
2. **Dependencies**: integration tests need real FFmpeg, real Whisper model on disk, sometimes network
3. **CI efficiency**: every PR runs fast unit tests; integration runs on demand and nightly

### Tagging

**Pytest**:
```python
import pytest

@pytest.mark.integration
def test_full_detection_pipeline_on_short_khutbah():
    ...
```
Run unit only: `pytest -m "not integration"`
Run integration: `pytest -m integration`

**Vitest**:
```ts
import { describe, it, expect } from 'vitest';
describe.skipIf(process.env.UNIT_ONLY === '1')('SidecarManager integration', () => { ... });
```
Run unit only: `UNIT_ONLY=1 npm test`

---

## Flakiness Policy

### Definition

A test is **flaky** if it fails intermittently on the same code, depends on timing/`sleep`, relies on un-mocked external services, or has race conditions.

### Zero tolerance

Flaky tests are **unacceptable** in `main`.

### Detection

Run the suite **three times consecutively**. If any run fails, the test is flaky.

### Resolution

1. **Disable immediately** with a clear pointer:
   ```python
   @pytest.mark.skip(reason="Flaky — see GH issue #N")
   ```
   ```ts
   it.skip('does X', () => { /* see GH issue #N */ });
   ```
2. **File an issue** linking the failure log
3. **Investigate root cause** — usually missing mocks, timing dependencies, or shared state
4. **Fix and verify** with three consecutive successful runs before re-enabling

---

## Test Isolation Requirements

1. **No shared state.** Each test gets a fresh fixture; use `tmp_path` (Pytest) or `beforeEach` cleanup (Vitest).
2. **Mock external network calls.** Tests must not hit YouTube, Google OAuth endpoints, or any HTTP service. Use `nock` (Node) or `responses` (Python).
3. **Use random / ephemeral ports.** When testing the OAuth loopback server: bind to port `0`, read the assigned port back from the listener.
4. **Use small fixtures.** The `python-pipeline/tests/fixtures/short_khutbah.mp4` is a 60-s synthetic clip — fast and deterministic. Never check in real khutbah recordings.
5. **Tear down processes.** If a test spawns a Python sidecar, an `afterAll`/`afterEach` must `await mgr.stop()`. Hung tests block CI.

---

## CI Artifact Requirements

On test failure, CI **must** upload:

- **Test reports**: JUnit XML (Pytest), Vitest JSON output, Playwright HTML report
- **Screenshots**: Playwright failure screenshots
- **Coverage reports** (if applicable)
- **Build logs** for any failed `npm`/`pyinstaller` step

Example GitHub Actions step:
```yaml
- name: Upload test artifacts
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: test-reports-${{ matrix.os }}
    path: |
      tests/reports/
      python-pipeline/tests/reports/
      playwright-report/
    retention-days: 14
```

---

## Performance Expectations

| Component | Unit tests | Integration tests | Full build |
|-----------|-----------|-------------------|------------|
| Renderer / Electron | < 15 s | < 60 s | < 90 s |
| Python sidecar | < 30 s | < 5 min (Whisper inference) | < 30 s |
| E2E (Playwright) | n/a | < 90 s | n/a |
| `electron-builder` package | n/a | n/a | < 5 min per OS |

If any of these exceed 50 % of baseline: investigate before merging.

---

## Compliance Checklist (for every PR / merge to main)

- [ ] All tests pass locally **three consecutive times**
- [ ] No flaky tests detected
- [ ] Test execution completes in < 300 s
- [ ] All external dependencies properly mocked (no live YouTube, no live OAuth)
- [ ] No `sleep`/timing dependencies in tests (use polling with deadline instead)
- [ ] Test data is deterministic (no `Date.now()`, no `Math.random()` without seed)
- [ ] Per-task commit messages follow conventional-commit format from the plan
- [ ] If task touched a Level-1 trigger: `superpowers:code-reviewer` invoked and APPROVE
- [ ] If end-of-phase: phase review gate run and APPROVE
- [ ] No new `.md` files created beyond what the plan/spec requires

---

## When Tests Fail in CI but Pass Locally

Common causes (ordered by likelihood):

1. Missing fixture file in CI checkout → check `.gitignore`
2. Different Node/Python version → check `.nvmrc` / `.python-version`
3. FFmpeg/yt-dlp not on PATH in CI → run `bash resources/fetch-resources.sh` first
4. Whisper model not present → CI must download it (or skip integration tests)
5. File-system case sensitivity (Linux strict, macOS lax) → fix the filename mismatch
6. Timezone differences → use UTC explicitly in date logic
7. Random ports collide with CI runner services → use port `0` + read back

**Solution of last resort**: replicate CI environment locally with Docker.

---

## References

- [CLAUDE.md](CLAUDE.md) — project guide + anti-sycophancy rules
- [docs/superpowers/specs/2026-04-25-khutbah-editor-design.md](docs/superpowers/specs/2026-04-25-khutbah-editor-design.md) — locked design
- [docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md](docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md) — implementation plan with TDD task breakdown
- Vitest: https://vitest.dev/
- Pytest: https://docs.pytest.org/
- Playwright: https://playwright.dev/
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- YouTube Data API v3 reference: https://developers.google.com/youtube/v3

---

**Maintained by**: Project lead
**Enforcement**: mandatory for all code, all tests, all reviews
