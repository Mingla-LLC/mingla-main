> Parity note: ported from `.codex/skills/orchestrator-mingla/references/artifact-system.md` during META-ORCH-0755-B so Claude orchestrator can load Codex’s consolidated artifact-system and sync rules.

# Artifact System

## Canonical Directory

`Mingla_Artifacts/` is the durable program memory. Create missing files only when needed; do not overwrite existing artifacts casually.

Required baseline:

- `WORLD_MAP.md`
- `PRIORITY_BOARD.md`
- `PRODUCT_SNAPSHOT.md`
- `MASTER_BUG_LIST.md`
- `ROOT_CAUSE_REGISTER.md`
- `OPEN_INVESTIGATIONS.md`
- `SPEC_QUEUE.md`
- `IMPLEMENTATION_QUEUE.md`
- `TEST_QUEUE.md`
- `RETEST_LEDGER.md`
- `DECISION_LOG.md`
- `INVARIANT_REGISTRY.md`
- `AGENT_HANDOFFS.md`
- `COVERAGE_MAP.md`
- `prompts/`

Existing repo artifacts may also include `reports/`, `specs/`, `github/`, handoffs, or imported Claude artifacts. Preserve their history; cross-link instead of duplicating when possible.

## Current Documentation Placement

- `README.md` is the repo front-door snapshot, not the full artifact ledger.
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md` is the artifact classification and archive authority.
- `Mingla_Artifacts/reports/` holds durable investigations, implementation reports, QA reports, audits, and evidence.
- `Mingla_Artifacts/specs/` holds durable implementation specs.
- `Mingla_Artifacts/prompts/` holds user-dispatched prompt files and remains private/ignored unless a later ORCH explicitly versions a prompt.
- `Mingla_Artifacts/archive/` holds historical evidence. Archive files are not current operating instructions.
- Root `outputs/` and root `clade transfer/` are legacy locations. Do not create new current work there.

## Bootstrap Procedure

1. Check whether `Mingla_Artifacts/` exists.
2. Create only missing baseline files/directories.
3. Ingest, in order:
   - `README.md`
   - `docs/DOMAIN_ADRS.md`
   - `docs/MUTATION_CONTRACT.md`
   - `docs/QUERY_KEY_REGISTRY.md`
   - `docs/IMPLEMENTATION_GATES.md`
   - `docs/TRANSITIONAL_ITEMS_REGISTRY.md`
   - `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
   - `Mingla_Artifacts/archive/README.md`
   - `Mingla_Artifacts/reports/*.md`
   - `Mingla_Artifacts/specs/*.md`
   - manifest-mapped historical archive files when relevant
4. Populate World Map first as index, then Priority Board, Coverage Map, Product Snapshot, queues, and logs.
5. Mark stale or conflicting evidence with dates instead of silently merging it.

## World Map Schema

Use these sections:

- Product surface inventory.
- User journey.
- Issue registry.
- Launch readiness by surface.
- Active investigations.
- Spec backlog.
- Implementation backlog.
- Test/retest ledger.
- Top priorities.
- Invariant registry index.
- Decision log index.
- Open questions.
- Deferred items.
- Unresolved operational risks.

Issue registry columns:

`ID | Title | Surface | Flow | Severity | Class | Status | Grade | Verified | Evidence | Owner/Agent | Notes`

## Priority Board Schema

Columns:

`Rank | ID | Title | Score | Surface | Severity | Recommended Action | Rationale | Evidence`

Top 20 should be renumbered after closes or severity changes.

## Master Bug List Schema

Sections:

- Active issues.
- Recently closed.
- Deferred.
- Regressions.
- Needs evidence.

Columns:

`ID | Title | Surface | Severity | Classification | Status | Grade | Discovered | Source | Evidence`

## Root Cause Register Schema

For each root cause:

- ID: `RC-NNN`.
- Discovery date.
- Proof link.
- Symptoms caused.
- Causal chain.
- Structural fix.
- Status.
- Invariant violated.
- Regression guardrail.

## Coverage Map Schema

Columns:

`Surface | Total Items | A | B | C | D | F | % Unaudited | % Stale | Confidence`

Confidence:

- `strong`: recent evidence across happy path and failure path.
- `partial`: happy path or static evidence only.
- `weak`: old, indirect, or incomplete evidence.
- `unaudited`: no meaningful evidence.

## Artifact Sync Rules

- New durable issue: update World Map and Master Bug List; update Priority Board if it enters top 20.
- New proven root cause: update Root Cause Register and link affected ORCH IDs.
- New spec: update Spec Queue and World Map.
- Implementation started/done: update Implementation Queue and Agent Handoffs if a handoff was involved.
- Test/retest done: update Test Queue or Retest Ledger and attach evidence.
- Verified close: update World Map, Master Bug List, Coverage Map, Product Snapshot, Priority Board, and any queue the item occupied.
- Decision accepted: update Decision Log with alternatives, tradeoff, and revisit condition.
- Transitional workaround: update `docs/TRANSITIONAL_ITEMS_REGISTRY.md` and World Map.

Use proportional updates: do not touch every artifact for a tiny untracked note, but do update every relevant artifact for tracked item state changes.

## Evidence Rules

- Code/schema/tests with current dates beat old reports.
- Historical reports remain evidence but must not override live code.
- "Unverified" is valid. "Works" without proof is not.
- If evidence conflicts, preserve both and state the conflict.
