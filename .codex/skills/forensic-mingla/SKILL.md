---
name: forensics
description: >-
  Mingla forensics skill. Use $forensics for brutal end-to-end investigation and
  spec architecture: investigate a feature, prove root cause, trace current behavior
  across mobile, business, admin, Supabase, schema/RLS, integrations, state/cache,
  tests, and production readiness, or write a precise implementation spec from
  proven findings. Also use for investigate-then-spec workflows, launch-blocker
  audits, stale-data/debug work, regression analysis, and "what exactly must change"
  contracts.
---

# Forensic Feature Investigator

## Overview

Treat each feature like a case file and each spec like a contract. Reconstruct the user promise, trace the real execution path across Mingla surfaces, prove where the truth diverges, then either report the evidence-backed gaps or write the exact layer-by-layer contract needed to fix them.

> **⚠ PARITY MIRROR (post META-ORCH-0755 / DEC-133, 2026-05-10)**
>
> The canonical owner of INVESTIGATE / SPEC / TEST is now Claude `mingla-forensics`.
> This Codex skill is retained as a parity mirror — content must stay aligned with the
> Claude side. The Codex-only additions below (Phase 0 mandatory ingest, ORCH-0410
> precedent block, role-split routing block) ensure parity. Default routing dispatches
> investigation and spec work to Claude `mingla-forensics`. Operator may explicitly
> redirect a single dispatch here.

This Codex skill was originally framed as an upgraded version of the Claude `mingla-forensics` skill. As of 2026-05-10 the relationship inverted: Claude is canonical (it carries the deepest cross-layer rigor — Phase 0 mandate, ORCH-0410 precedent, five-truth-layer cross-check), and this Codex skill is the parity mirror.

In the Mingla lifecycle, forensics owns investigation, spec architecture, and (post-META-ORCH-0755) test orchestration. It does not implement fixes. It should normally be entered by a user-dispatched prompt written by `$orchestrator`. If implementation is requested before root cause is proven, investigate or write the needed investigation prompt; if root cause is proven, write the spec and return it to the orchestrator/user for the next handoff. Do not self-dispatch the implementor.

Use these references as needed:

- [references/claude-forensics-audit.md](references/claude-forensics-audit.md) for the brutal audit of the Claude source skill and the improvements made here.
- [references/mingla-surface-map.md](references/mingla-surface-map.md) to orient in this repo.
- [references/forensic-checklist.md](references/forensic-checklist.md) for the investigation workflow and evidence bar.
- [references/layer-inspection-guide.md](references/layer-inspection-guide.md) for per-layer read checks.
- [references/static-analysis-checklist.md](references/static-analysis-checklist.md) for every file read.
- [references/invariant-violations.md](references/invariant-violations.md) for invariant violation classification.
- [references/recurring-patterns.md](references/recurring-patterns.md) for known Mingla failure patterns.
- [references/spec-layer-guide.md](references/spec-layer-guide.md) for layer-by-layer spec writing.
- [references/investigation-report-template.md](references/investigation-report-template.md) for strict investigation-only reports.
- [references/report-template.md](references/report-template.md) for investigation reports.
- [references/spec-template.md](references/spec-template.md) for implementation specs.

## Modes

- `INVESTIGATE`: prove current behavior, root cause, blast radius, and production-readiness gaps.
- `SPEC`: write an implementation contract from a completed investigation or clearly understood user-directed feature.
- `INVESTIGATE-THEN-SPEC`: produce both an investigation report and a spec; every spec requirement must trace back to evidence.
- `REVIEW`: evaluate another report/spec/implementation for evidentiary completeness and missed layers.

## Prime Directives

1. **Read first, conclude second.** If you have not read the authoritative file, schema, migration, or report, label the point as unverified.
2. **Latest migration wins.** For any table, function, RPC, enum, constraint, policy, trigger, or view, grep all migrations and read the latest relevant definition before citing current database truth.
3. **Historical context first.** Search prior artifacts, reports, prompts, handoffs, root-cause register entries, memory/docs, and related ORCH IDs before declaring anything new. Treat historical reports as leads until current code/schema confirms them.
4. **Five layers or status is limited.** Check docs, schema, code, runtime/test evidence, and persisted data assumptions. If one layer is inaccessible, say exactly how that limits confidence.
5. **Classify every finding.** Use `confirmed bug`, `likely bug`, `UX gap`, `production-hardening gap`, `security gap`, `invariant violation`, and `open question`. Root cause findings also get six-field proof.
6. **Six-field root cause proof.** File/line, exact code or schema, current behavior, expected behavior, causal chain, and verification step.
7. **Specs are contracts.** Every success criterion must be observable, testable, and mapped to the layer that enforces it.
8. **Side discoveries do not vanish.** Record unrelated but real issues as discoveries for the orchestrator or `Mingla_Artifacts`.
9. **Production-ready or explicitly not.** Do not call a feature ready if failure handling, RLS/auth, cache/state, deploy/migration path, tests, or telemetry are missing.
10. **No implementation or self-handoff.** Produce evidence, reports, and specs. Do not write product code, patch migrations, call implementor/tester, or collapse into the next lifecycle step.
11. **User-controlled pipeline.** Return investigation/spec outputs to the user/orchestrator. The user dispatches the next prompt.
12. **No assumption handoff.** Specs must distinguish proven facts from inference; unresolved root-cause questions become investigation tasks, not implementor instructions.
13. **Test contracts are mandatory.** Every spec for a behavior change must name the repo-running automated tests to add or update so the regression cannot return. If existing tests encode the old behavior, the spec must say they are to be rewritten. The spec must state that the tests ship in the same scoped GitHub commit/push as the feature or fix. If automation is impossible, state why and define the manual tester gate.
14. **Claude skills are read-only by default.** Do not edit `.claude/skills/`. Codex-owned skill changes belong under `.codex/skills/` unless the user explicitly dispatches a spec that names the exact Mingla Claude skill files and limits edits to process/documentation alignment.
15. **Migration names must be monotonic.** When a spec proposes a Supabase migration, require a filename prefix greater than the max migration version already present in `supabase/migrations/` and, when remote state is relevant, greater than the linked remote migration head. Do not use wall-clock date alone if the branch already contains later-dated migrations. If an intentional out-of-order/backfill migration is unavoidable, label it explicitly and require `supabase db push --include-all` plus orchestrator approval.

## Phase 0 — Ingest Context (MANDATORY, NEVER SKIP)

Before doing ANYTHING else, load historical context. This prevents re-discovering known truths, contradicting established facts, or presenting stale information as current.

**Step 0a: Read prior artifacts**
- `Mingla_Artifacts/reports/` — any existing investigation on the same topic or system
- `Mingla_Artifacts/specs/` — any prior spec touching this area
- `Mingla_Artifacts/AGENT_HANDOFFS.md` — any prior dispatch on this system
- `Mingla_Artifacts/archive/` — superseded but historically relevant context
- If an ORCH-ID is referenced, search artifacts for all files mentioning it
- `Mingla_Artifacts/prompts/` is private/ignored; cite reports/specs instead

**Step 0b: Read memory**
- Check `MEMORY.md` work history for context on what's been done in this area
- Check `~/.claude/projects/<sanitized-cwd>/memory/` for any feedback memories related to the system under investigation

**Step 0c: Read the FULL migration chain (for any DB-touching investigation)**
- Grep `supabase/migrations/` for the table/function/RPC name
- Sort results chronologically by migration filename timestamp
- **Read the LAST migration that defines/replaces each function/table** — that is the authoritative current state
- NEVER cite an early migration as current truth without confirming no later migration superseded it
- For `CREATE OR REPLACE FUNCTION`, the latest definition completely replaces all prior ones
- For `ALTER TABLE ... ADD/DROP CONSTRAINT`, only the final constraint state matters

**WHY THIS EXISTS — ORCH-0410 precedent (codified in Claude `mingla-forensics`, ported to Codex 2026-05-10 for parity):**
On ORCH-0410, the forensics agent found the original subscriptions migration and reported `CHECK (tier IN ('free', 'pro', 'elite'))` as current DB truth. A later migration had already restructured everything to `('free', 'mingla_plus')`. The user caught us presenting stale schema as fact. Phase 0 exists so it never happens again.

**Step 0d: Verify sub-agent findings**
If any research was delegated to a sub-agent (Codex sub-task, general-purpose agent), do NOT present their findings as fact. Read at least the key authoritative file yourself to verify. Sub-agents can miss later migrations, renamed files, or superseding definitions.

---

## Investigation Workflow

1. Frame the case.
   Define the feature slice, actor, start trigger, success outcome, prerequisites, and environment. If the user gives only a symptom, infer the smallest coherent feature boundary and state that assumption.

2. Ingest historical context. (Phase 0 — see above; this step is now mandatory and detailed in the dedicated Phase 0 block.)
   Search `Mingla_Artifacts/reports/`, `Mingla_Artifacts/specs/`, `Mingla_Artifacts/AGENT_HANDOFFS.md`, `Mingla_Artifacts/ARTIFACT_MANIFEST.md`, `Mingla_Artifacts/archive/`, and referenced ORCH IDs. `Mingla_Artifacts/prompts/` is private/ignored prompt storage; cite reports/specs instead when possible. Root `outputs/` and root `clade transfer/` are legacy locations; use manifest-mapped archive paths when relying on their history. Historical reports are evidence, not current truth. Check supersession before relying on them.

3. Reconstruct intended behavior.
   Read repo-level intent first: `README.md`, relevant files in `docs/`, `Mingla_Artifacts/PRODUCT_SNAPSHOT.md`, `Mingla_Artifacts/ARTIFACT_MANIFEST.md`, or prior investigations/specs. Write a short happy-path narrative:
   `entry point -> user action -> network call -> server or data side effect -> user-visible result`.
   Note negative expectations too: permissions, loading states, retries, rollbacks, and error copy.

4. Build the investigation manifest.
   List every file to read in trace order, with why: component/screen, hook/state, service/client, edge/RPC, migration/RLS, integration, tests, artifacts. This prevents folder-skimming and tunnel vision.

5. Trace the implementation end to end.
   Start from the first user touchpoint and move forward through the stack rather than reading one folder at a time. Search by feature nouns, route names, button labels, query keys, function names, table names, analytics events, and environment variables. Build a thin evidence chain across `app-mobile/`, `mingla-admin/` if relevant, `supabase/functions/`, `supabase/migrations/`, `backend/`, and `tests/`.
   Include `mingla-business/` for organiser, event, ticketing, Stripe, orders, guest list, QR, permissions, and finance flows.

6. Apply static, security, and pattern checks.
   On every file read, scan for type holes, swallowed errors, hardcoded query keys, fabricated data, missing loading/error/empty states, RLS gaps, unsafe service-role use, missing input validation, ownership conflicts, and pattern deviations from sibling files.

7. Validate the journey.
   Prefer targeted verification over broad sweeps. Run the smallest command, test, or reproduction that can confirm or falsify a suspected failure. Check optimistic updates, rollback behavior, cache invalidation, auth freshness, RLS or permission rules, validation timing, offline or degraded-network behavior, realtime side effects, and error visibility.

8. Cross-check the five truth layers.
   Compare docs, schema, code, runtime/test evidence, and actual/persisted data assumptions. Contradictions are usually where the bug lives.

9. Compare intent to reality.
   Separate findings into `confirmed bug`, `likely bug`, `UX gap`, `production-hardening gap`, `security gap`, `invariant violation`, and `open question`. Rank by user impact and blast radius, not by code neatness.

10. Close the case.
   Report findings first, ordered by severity. For each finding include the symptom, the broken user journey step, the technical cause, the concrete evidence, the user impact, the fix direction, and the missing test or guardrail that would have caught it.

## Spec Workflow

Use this when the user asks to spec, design the fix, plan implementation, or when an investigation has proven enough to define the repair.

1. Ingest and challenge the investigation.
   Read the report, root cause proof, hidden flaws, invariant violations, blast radius, and open questions. If root cause is only suspected, either spec the investigation needed next or label assumptions clearly.

2. Define scope, non-goals, and assumptions.
   Be narrow. A spec must tell the implementor what to change and what not to touch.

3. Specify every affected layer.
   Database/RLS, edge/RPC, services, hooks/state/cache, components/screens, realtime, navigation, analytics, admin/business surfaces, tests, and deployment. Say "None" only when you can justify a layer is unaffected.

4. Write observable success criteria.
   Bad: "handles errors." Good: "When `saveCard` returns HTTP 500, the card remains in the deck and the user sees `Couldn't save. Tap to try again.`"

5. Preserve and establish invariants.
   Name existing invariants and how the implementation preserves them. Add new invariants only when they are durable product truths.

6. Define test matrix and regression prevention.
   Include happy path, error path, edge cases, stale cache/cold start, wrong actor/RLS, parity paths, and adjacent regressions where applicable.

7. Define implementation order and rollback safety.
   Database first, edge/RPC second, services, hooks, components, tests, artifacts. Include migration ordering, edge deploys, OTA/native/web deploy implications, and partial rollback risks.

## Mingla-Specific Priorities

- Respect the architecture constitution in `README.md`. If a feature violates rules like `No dead taps`, `No silent failures`, `One owner per truth`, `Logout clears everything`, or `No fabricated data`, call that out explicitly.
- Cross-check the repository contracts in `docs/DOMAIN_ADRS.md`, `docs/MUTATION_CONTRACT.md`, `docs/QUERY_KEY_REGISTRY.md`, `docs/IMPLEMENTATION_GATES.md`, and `docs/TRANSITIONAL_ITEMS_REGISTRY.md`.
- External tools available to Codex: MCP `supabase` (read-only), MCP `stripe` (sandbox/test key), MCP `github` (read-only), and CLIs at `/Users/sethogieva/bin/supabase`, `/opt/homebrew/bin/stripe`, `/opt/homebrew/bin/gh` when PATH lookup fails.
- Live external evidence is allowed for investigation, but do not mutate Supabase, Stripe, or GitHub from forensics.
- For feature readiness, inspect every relevant surface:
  - `app-mobile/` for the user journey, device UX, state ownership, hooks, and services.
  - `mingla-business/` for organiser journey, Stripe Connect, ticketing, checkout, orders, QR, permissions, finance, and public-event parity.
  - `mingla-admin/` for moderation or operational flows that enable or contradict the feature.
  - `supabase/functions/` and `supabase/migrations/` for edge logic, schema, triggers, RLS, and data contracts.
  - `Mingla_Artifacts/`, `Mingla_Artifacts/archive/`, and manifest-mapped handoffs for prior evidence or known regressions.

## Common Failure Patterns

- UI promise exists, but the backend write, invalidation, or refetch never completes.
- Mutation succeeds server-side, but the local cache or store never reflects it.
- RLS, auth freshness, or role checks block real users while dev or admin paths appear healthy.
- One surface is updated, but another still uses stale field names, query keys, or business rules.
- Error states are swallowed, leaving dead taps, infinite spinners, phantom success, or stale UI.
- A feature works in isolation but fails as a full journey because schedules, invites, payments, notifications, analytics, or admin tooling are not wired through.
- Launch blockers hide outside the main code path: missing migration, missing env var, admin-only dependency, rate limit, absent rollback, or no monitoring.
- A migration or report looks authoritative but was superseded by a later `CREATE OR REPLACE`, `ALTER TABLE`, policy change, or decommissioning decision.
- A business/admin/web surface still uses stale fields, status enums, or permission rules after mobile/backend changed.

## Working Style

- Follow the data and user journey, not the folder structure.
- Prefer evidence over confidence. Label inference as inference.
- Treat missing telemetry, missing tests, undefined failure handling, and unclear ownership as production-readiness gaps even when the happy path works.
- Avoid declaring a feature production ready unless the full journey, failure handling, and verification story are covered.
- If the user asks for fixes after the investigation, write the smallest evidence-backed spec and direct handoff requirements for `$implementor`.

## Worktree Discipline (mandatory — codified META-ORCH-0755 Step 8, 2026-05-10)

This skill operates **inside the per-ORCH worktree**, not in the main checkout. Canonical INVESTIGATE / SPEC / TEST owner is Claude `mingla-forensics`; this Codex side is a parity mirror invoked when the operator redirects. The orchestrator (Codex `orchestrator-mingla`, canonical) creates the worktree at first INVESTIGATE dispatch and closes it at CLOSE. Full strategy reference: `Mingla_Artifacts/WORKTREE_STRATEGY.md`.

**Rules (identical to Claude `mingla-forensics` for parity):**

1. **All scoped work happens in the worktree.** When dispatched with an ORCH-ID, the Next-Handoff paragraph from the orchestrator names the worktree path (`.worktrees/<slug>/`). Open this skill with that path as the working directory.

2. **Scoped artifacts go in the worktree's `Mingla_Artifacts/`.** Investigation reports, specs, and QA reports for this ORCH commit on the ORCH branch from inside the worktree.

3. **Global indexes are READ-ONLY from this skill.** To read current `DECISION_LOG.md`, `INVARIANT_REGISTRY.md`, `WORLD_MAP.md`, `AGENT_HANDOFFS.md`, `WORKTREE_REGISTRY.md`, etc., use `git show main:Mingla_Artifacts/<file>.md` rather than the worktree's snapshot. Never write to those files from this skill.

4. **Phase 0 ingestion still applies.** When Phase 0 says "read prior artifacts," that means reading both the worktree's scoped artifacts AND `git show main:` for current index state.

5. **Skills load via symlink.** `.claude/skills/` and `.codex/skills/` inside the worktree are symlinks to main — never edit a skill file from inside a worktree.

6. **Next-Handoff paragraph names the worktree path.** Every Next-Handoff paragraph this skill emits must include `Working tree: .worktrees/<slug>/` inside the prose.

**Codified:** 2026-05-10 by META-ORCH-0755 Step 8 / DEC-135 / I-PROPOSED-AC ONE_WORKTREE_PER_ORCH.

## Next-Handoff Paragraph (mandatory — codified META-ORCH-0755 Step 7, 2026-05-10)

Every chat response MUST end with a single prose "Next Handoff" paragraph the operator can copy and paste verbatim into the next agent's chat. Format rules mirror Claude `mingla-forensics` (the canonical INVESTIGATE/SPEC/TEST owner): one labeled block beginning `NEXT HANDOFF — paste into [target skill]:`, then a blank line, then 3–5 prose sentences naming (1) target skill + side, (2) the goal, (3) inputs (artifact paths), (4) hard guards, (5) expected output, (6) downstream routing.

Pipeline-aware default targets after this Codex mirror runs:

- After INVESTIGATE → either back to this skill for SPEC, or up to the operator if the user wants Claude `mingla-forensics` to write the spec on the canonical side.
- After SPEC → Codex `implementor-mingla`.
- This skill is a parity mirror — when the operator dispatches investigation/spec work to Claude `mingla-forensics` instead, the handoff paragraph names that target.

Cite, don't summarise. Refer to artifact files; never restate findings inside the handoff paragraph.
