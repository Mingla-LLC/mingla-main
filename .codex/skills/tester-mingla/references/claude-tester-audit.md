# Claude Tester Skill Audit

## Source Inspected

- `.claude/skills/tester-mingla/SKILL.md`
- `.claude/skills/tester-mingla/references/targeted-protocol.md`
- `.claude/skills/tester-mingla/references/security-protocol.md`
- `.claude/skills/tester-mingla/references/ux-coherence-protocol.md`
- `.claude/skills/tester-mingla/references/pre-release-protocol.md`
- `.claude/skills/tester-mingla/references/production-verification.md`
- `.claude/skills/tester-mingla/references/report-template.md`

## What The Claude Skill Got Right

- It insists on independent verification rather than trusting implementor claims.
- It separates modes: targeted, spec compliance, pre-release, security, retest, full sweep.
- It requires blast-radius mapping from changed files to dependents.
- It audits implementation reports as claims to verify.
- It checks every layer: DB/RLS, edge, services, hooks, components, state, types, UX, security, platform readiness.
- It elevates constitution violations and security findings to blockers.
- It includes a serious UX coherence protocol, not just "does it render."
- It includes production verification for real schema, RLS, edge responses, cache, auth, realtime, notifications, payments, offline, and cross-device behavior.
- It has strong retest discipline and flags repeated loops.
- It produces severity-ranked findings and exact rework instructions.

## What Was Brittle Or Wrong For Codex

- **Unavailable triage dependency:** It mandates `ask_user_input_v0`, which is not a Codex tool. Codex should infer mode and ask concise questions only when genuinely blocked.
- **Stale stack facts:** It hardcodes old counts like 72 edge functions, 293 migrations, 14 admin pages. Current truth must come from `README.md`, package files, schema, and live repo evidence.
- **Missing business app:** It omits `mingla-business/`, a critical surface for organiser, Stripe Connect, tickets, checkout/orders, guest list, QR, permissions, and finance.
- **Always-write report ceremony:** A durable QA report is valuable for ORCH/spec/launch-critical work, but too heavy for small sanity checks.
- **"Zero defects" rhetoric can hide practical verdicts:** Real QA needs precise `PASS`, `CONDITIONAL PASS`, `FAIL`, or `BLOCKED/UNVERIFIED` with residual risk, not theatrical absolutism.
- **Independent test writing is over-mandated:** Sometimes code reading, focused existing tests, build/lint, and manual test instructions are the right evidence. New tests are required when risk warrants them.
- **Store/pre-release requirements age quickly:** Platform rules change. Current store/privacy requirements should be verified against current project config and, when high-stakes, current official docs.

## Improvements In The Codex Skill

- Adds Codex-native triage without fake tools.
- Adds `mingla-business/` and public/web parity checks.
- Makes report output proportional to risk while retaining full reports for durable work.
- Adds explicit `BLOCKED/UNVERIFIED` verdict.
- Replaces stale facts with live repo/source checks.
- Emphasizes focused verification commands and honest manual-test gaps.
- Keeps security, UX, pre-release, production verification, spec compliance, and retest rigor.
- Aligns with Codex worktree rules: do not mutate implementation under tester mode unless the user asks for fixes; report rework instructions first.

## Bottom Line

Claude's tester skill is a strong release-gate skeleton, but it is too tool-specific, stale in repo context, and over-ceremonial for small checks. The Codex version keeps the adversarial evidence bar while making the workflow practical, current, and integrated with the Mingla skill suite.
