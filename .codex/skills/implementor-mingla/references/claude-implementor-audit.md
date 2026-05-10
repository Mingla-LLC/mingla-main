# Claude Implementor Skill Audit

## Source Inspected

- `.claude/skills/implementor-mingla/SKILL.md`
- `.claude/skills/implementor-mingla/references/code-patterns.md`
- `.claude/skills/implementor-mingla/references/error-handling-contracts.md`
- `.claude/skills/implementor-mingla/references/query-key-discipline.md`
- `.claude/skills/implementor-mingla/references/invariant-checklist.md`
- `.claude/skills/implementor-mingla/references/constitutional-quick-check.md`
- `.claude/skills/implementor-mingla/references/report-template.md`

## What The Claude Skill Got Right

- It is execution-oriented, not merely advisory.
- It requires reading files and local patterns before editing.
- It treats specs and test reports as binding contracts.
- It forces blast-radius thinking: direct changes, cascade changes, parity, cache, and state boundaries.
- It has strong Mingla-specific rules for React Query factories, Zustand boundaries, error handling, UI states, migrations/RLS, and custom navigation.
- It requires pre-flight and post-flight invariant checks.
- It uses old-to-new receipts, which are excellent for reviewer/tester traceability.
- It distinguishes verified, partially verified, unverified, and investigated-only outcomes.
- It captures side discoveries instead of quietly expanding scope.
- It has good rework discipline: fix failed criteria only.

## What Was Brittle Or Wrong For Codex

- **Stale stack facts:** It hardcodes old counts and AI model details. Current truth must come from `README.md`, package files, schema, and live repo evidence.
- **Missing `mingla-business/`:** The business app is a major product surface and must be part of implementation blast radius for organiser, Stripe, ticketing, QR, orders, permissions, and finance.
- **Too much mandatory report ceremony:** "Every implementation produces exactly two things" is excessive for small Codex edits and conflicts with lightweight workflows. Durable reports remain required for ORCH/spec/launch-critical/risky work.
- **Pre-code evidence gate is required:** Mingla's current process requires investigation and spec before product implementation. Direct implementation is reserved for explicit skill/process maintenance or already-proven rework prompts.
- **No explicit Codex editing constraints:** It does not mention dirty worktrees, `apply_patch`, not reverting user changes, no destructive commands, or focused verification command selection.
- **Migrations rule too Claude/MCP-specific:** "Never deploy migrations" is right in spirit here, but the Codex skill should say write migrations, do not apply/deploy unless explicitly asked and safe.
- **Overconfident "single execution engine" language:** Implementation still composes with forensics and orchestrator. If root cause is unknown, investigate first instead of thrashing code.
- **Pattern examples can drift:** Query factories and counts must be checked in the current repo before use.

## Improvements In The Codex Skill

- Adds Codex-native execution within the implementor role: execute evidence-backed specs/rework prompts, block when proof is missing, and protect user work.
- Adds `mingla-business/` as a first-class implementation surface.
- Replaces stale stack facts with "read current repo docs and files."
- Makes report writing proportional to risk while preserving detailed reports for durable work.
- Adds latest-migration discipline before DB/RLS edits.
- Adds deploy-path awareness: migration, edge function, mobile OTA/native, business/admin web, env vars.
- Adds stronger verification honesty and focused command strategy.
- Adds explicit skill composition: use forensics when root cause is unknown and orchestrator for program-state/artifact lifecycle.

## Bottom Line

Claude's implementor skill has excellent engineering instincts but too much fixed ceremony and stale Mingla context. The Codex version keeps the rigor, adds current surfaces, requires proven specs before product edits, and aligns execution with the Mingla investigate -> spec -> implement -> test -> close lifecycle.
