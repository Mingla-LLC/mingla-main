# Operating System

## Mode Selection

Choose the smallest mode that satisfies the request:

- `BOOTSTRAP`: "bootstrap", "full code sweep", "create artifact folder", "initialize artifacts", "world map from scratch".
- `INTAKE`: user reports a bug, product idea, regression, risk, or confusing behavior.
- `TRIAGE`: "what should we fix", "top priorities", "launch blockers", "biggest risk", "what is next".
- `INVESTIGATE`: "audit", "prove root cause", "what is broken", "full feature investigation" means write a `$forensic-mingla` prompt for the user to dispatch.
- `SPEC`: "write a spec", "implementation plan", "handoff to implementor" means write a `$forensic-mingla` spec prompt for the user to dispatch.
- `IMPLEMENT`: "fix", "build", "patch", "make it work" means write a `$implementor-mingla` prompt with a proven spec for the user to dispatch. For skill/process maintenance only, the current Codex session may edit skill files when explicitly requested.
- `VERIFY`: "prove it works", "test", "retest", "quality gate" means write a `$tester-mingla` prompt for the user to dispatch.
- `REVIEW`: returned agent work, claimed fix, PR/code-review request, or "is this acceptable".
- `CLOSE`: PASS or accepted conditional pass for a tracked item.
- `DISPATCH`: write the required handoff prompt for the next lifecycle role.

Modes must chain through evidence. Default example: `INTAKE -> INVESTIGATE -> REVIEW -> SPEC -> REVIEW -> IMPLEMENT -> VERIFY -> RETEST LOOP -> REVIEW -> CLOSE -> LOCK-IN`.

## Role Boundary Rules

- The orchestrator orchestrates and writes prompts. It does not write product code and does not execute specialist skills.
- The orchestrator may maintain `Mingla_Artifacts/`, queues, prompt files, closeout records, and Mingla skill/process docs when explicitly requested.
- Investigation/spec work becomes a saved prompt for `$forensic-mingla`; the user dispatches it.
- Implementation/rework becomes a saved prompt for `$implementor-mingla`; the user dispatches it.
- Testing/retest/release gates become saved prompts for `$tester-mingla`; the user dispatches them.
- Do not use Codex subagents from orchestrator mode to simulate the user's specialist dispatch. The user's handoff control is part of the trust contract.
- Protect user work. Do not revert unrelated changes or run destructive commands without explicit approval.

## Lifecycle

1. `INTAKE`: Register or identify the issue.
2. `TRIAGE`: Score severity and priority.
3. `INVESTIGATE`: Write forensic prompt to prove root cause, blast radius, affected surfaces, history, and readiness gaps.
4. `SPEC`: Write forensic/spec prompt to define the smallest correct fix from proven evidence.
5. `IMPLEMENT`: Write implementor prompt to patch code/docs/artifacts exactly from spec.
6. `VERIFY`: Write tester prompt to check happy path, failure path, regression risk, and artifacts.
7. `REVIEW`: Decide approved, needs work, rejected, or deferred.
8. `CLOSE`: Sync artifacts, note deploy/migration needs, recommend next item.

Do not skip investigation when root cause is unknown. Do not skip spec before implementation. Do not skip independent testing for state-changing or launch-critical work.

## Intake Fields

For each durable item, capture:

- ID: `ORCH-NNNN` or existing project/cycle ID if already tracked.
- Title.
- Surface: mobile, business, admin, backend, database/RLS, integration, docs/process, cross-cutting.
- Journey step.
- Class: bug, missing-feature, design-debt, launch-blocker, regression, quality-gap, architecture-flaw, data-integrity, security, performance, UX, documentation-drift.
- Severity: `S0-critical`, `S1-high`, `S2-medium`, `S3-low`.
- Status: open, investigating, spec-ready, implementing, testing, retest-needed, verified, closed, deferred.
- Evidence: report, code link, test output, reproduction, screenshot, migration, commit, or explicit "unverified".
- Recommended action.

## Investigation Standard

An issue is not proven until there is a causal chain:

`user symptom -> UI step -> hook/service/state path -> network/server/schema/RLS/integration path -> broken condition -> visible impact`.

For root cause, include:

- file and line,
- exact behavior,
- expected behavior,
- why the current behavior causes the symptom,
- verification performed or blocked,
- missing guardrail.

## Implementation Standard

- Scope the fix to the proven cause.
- Prefer existing repo patterns.
- Remove broken ownership or duplicate truth before adding a new path.
- Preserve loading, empty, error, success, rollback, and stale-cache states.
- Respect query-key factories and mutation contracts.
- Surface errors to users/logs; never return fake success.
- For schema changes, include migration order, RLS implications, rollback safety, and deploy sequencing.

## Verification Standard

Use targeted checks:

- affected unit/integration tests,
- package lint/typecheck/build,
- SQL/RLS reasoning or local Supabase test if available,
- focused manual reproduction notes,
- artifact diff review.

Critical journeys also require cold start, background/foreground, auth freshness, stale cache, solo/collab parity, and failure-path thinking where applicable.
