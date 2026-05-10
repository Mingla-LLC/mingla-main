# Claude Forensics Skill Audit

## Source Inspected

- `.claude/skills/mingla-forensics/SKILL.md`
- `.claude/skills/mingla-forensics/references/layer-inspection-guide.md`
- `.claude/skills/mingla-forensics/references/spec-layer-guide.md`
- `.claude/skills/mingla-forensics/references/investigation-report-template.md`
- `.claude/skills/mingla-forensics/references/spec-template.md`
- `.claude/skills/mingla-forensics/references/static-analysis-checklist.md`
- `.claude/skills/mingla-forensics/references/invariant-violations.md`
- `.claude/skills/mingla-forensics/references/recurring-patterns.md`

## What The Claude Skill Got Right

- It treats investigation as proof, not vibes.
- It has two clear modes: investigate and spec.
- It forces historical context intake so old reports, prompts, and ORCH IDs are not ignored.
- It includes a critical migration-chain rule: latest definition wins, especially for `CREATE OR REPLACE FUNCTION`, constraints, policies, and table shape.
- It requires an investigation manifest before reading files.
- It insists on reading trace order: user symptom, component, hook, service, edge/RPC, database/RLS, migration.
- It cross-checks docs, schema, code, runtime, and data.
- It classifies findings into root cause, contributing factor, hidden flaw, and observation.
- It demands six-field root cause proof.
- It maps blast radius across solo/collab, admin, query keys, invariants, and recurring patterns.
- It treats specs as contracts with database, edge, service, hook, component, realtime, tests, implementation order, and rollback safety.
- It includes static analysis and security checks that catch real production failures tests miss.

## What Was Brittle Or Wrong For Codex

- **Role boundary must be explicit:** The source correctly separated investigation/spec from implementation; Mingla's current process preserves that boundary so forensics does not patch product code.
- **Stale stack facts:** It hardcodes old counts like 72 edge functions, 293 migrations, and GPT-4o-mini for card validation. Current truth must come from `README.md` and live repo evidence.
- **Missing business app:** It omits `mingla-business/`, now a critical surface for organiser, Stripe Connect, tickets, orders, QR, permissions, and finance.
- **Overbroad trigger list:** The trigger language is useful but too grabby. This Codex skill should activate for forensic/spec work, while orchestration belongs to `orchestrator-mingla`.
- **Legacy outputs assumption:** The source skill allowed durable reports in `outputs/`. Mingla's current durable investigations/specs belong in `Mingla_Artifacts/reports/` and `Mingla_Artifacts/specs/`; root `outputs/` is legacy residue only.
- **Five-layer absolutism can overstate uncertainty:** Runtime/data access is not always available. This skill keeps the five-layer bar but requires confidence labels when a layer is blocked.
- **Spec can become too heavy for small fixes:** The Claude template is excellent for launch-critical work but excessive for tiny repairs. Codex should scale spec detail to risk while preserving the contract sections for important work.

## Improvements In The Codex Skill

- Adds `INVESTIGATE-THEN-SPEC` and `REVIEW`; implementation handoff belongs to orchestrator and `$implementor-mingla`.
- Adds `mingla-business/` as a first-class investigation and spec surface.
- Makes `README.md` and live files the authority for volatile stack facts.
- Keeps latest-migration discipline and expands it to RLS policies, triggers, views, enums, and decommissioned concepts.
- Adds explicit production-readiness checks for deploy path, telemetry, env vars, OTA/native/web implications, and artifact sync.
- Keeps static/security scans but makes them evidence inputs rather than noisy automatic blockers.
- Adds confidence labels: proven, probable, suspected, inconclusive.
- Makes spec depth proportional to risk while retaining exact contracts for database, edge, service, hook, component, realtime, tests, and rollback.

## Bottom Line

Claude's forensics skill is the best raw investigator/spec skeleton in the repo. The Codex upgrade keeps its brutality, corrects stale knowledge, adds missing Mingla surfaces, and hands proven specs to the implementor/tester lifecycle instead of merging roles.
