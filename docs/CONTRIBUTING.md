# Contributing

Follow the implementation plan at `docs/superpowers/plans/2026-04-25-khutbah-editor-implementation.md` task by task. Each task is bite-sized and includes its own tests + commit step.

## Conventions

- TDD where it makes sense (test → fail → implement → pass → commit)
- Commit per task (or per logical sub-step), with conventional-commit style: `feat(scope): description`
- All Node code in TypeScript strict mode
- All Python code typed where reasonable, formatted by `ruff format` (added in a later task)
- Brand colors and fonts come from `tailwind.config.js` — never hard-code hex values in components
