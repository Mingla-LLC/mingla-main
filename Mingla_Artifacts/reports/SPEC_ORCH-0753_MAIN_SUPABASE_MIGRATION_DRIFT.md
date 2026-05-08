# SPEC ORCH-0753 - Main Supabase Migration Drift Repair

**Date:** 2026-05-07
**Mode:** SPEC
**Status:** SPEC READY
**Source investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md`
**Root cause:** RC-0753-1 - remote-applied ORCH-0737 v8 migration was never versioned on `main`

## 1. Status

**SPEC READY.**

The repair is intentionally small: version the exact migration file that is already present in the linked Supabase remote migration ledger. This is a Git-history/provenance repair, not a database change.

No implementor should run `supabase db push`, `supabase migration repair`, or deploy `run-place-intelligence-trial` for ORCH-0753.

## 2. Source Evidence

| Evidence | Finding |
|---|---|
| `INVESTIGATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` | Confirms `main` Supabase Preview failed on commit `6a49a798a1b9f1a45272828b4c799df80aa52497` with `Remote migration versions not found in local migrations directory.` |
| Successful linked migration ledger read | Remote contains `20260507000003`; comparison found exactly one missing remote-applied version from `origin/main`. |
| `git ls-tree` / `git show origin/main` evidence in investigation | `origin/main` does not contain `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`. |
| Local `git status` evidence | The migration exists only as untracked local material. |
| `SPEC_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH.md` | ORCH-0737 v8 required this exact migration to add `place_intelligence_trial_runs.timing_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb`. |
| `IMPLEMENTATION_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH_REPORT.md` | Implementor reported the migration as part of the ORCH-0737 v8 measurement patch. |
| `TEST_REPORT_ORCH-0737_V8_DENO_GATE_RETEST.md` | Tester verified the migration shape and verified no app-mobile, mingla-business, or mingla-admin code path reads `timing_diagnostics`. |
| `OPEN_INVESTIGATIONS.md` and `AGENT_HANDOFFS.md` ORCH-0737 entries | Operator applied the migration live with `supabase db push --include-all`; live schema later showed `timing_diagnostics | jsonb | '{}'::jsonb | NO`. |

## 3. Scope / Non-goals

**In scope**

1. Add/track exactly `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`.
2. Ensure the file content exactly matches the ORCH-0737 v8 migration contract in this spec.
3. Write an implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md`.
4. Record verification evidence proving the candidate branch contains `20260507000003`.
5. Route final GitHub Supabase Preview/check verification to implementor if available, otherwise to tester after push/PR timing permits.

**Non-goals**

1. Do not edit `supabase/functions/run-place-intelligence-trial/index.ts`.
2. Do not edit app-mobile, mingla-business, mingla-admin, public web, backend runtime code, or service code.
3. Do not edit unrelated migrations.
4. Do not introduce a new monotonic no-op migration unless a later investigation proves checksum/content mismatch.
5. Do not run `supabase db push`, `supabase migration repair`, function deploys, live SQL mutations, or live baseline runs.
6. Do not close ORCH-0737. ORCH-0737 remains open for runtime timing logs and baseline analysis.

**Assumptions**

1. The linked remote ledger evidence from ORCH-0753 remains authoritative: remote already contains version `20260507000003`.
2. The migration file content currently present in the local workspace is intended ORCH-0737 v8 material, but implementor must still verify exact content before staging/tracking it.
3. Supabase CLI may still be circuit-blocked from recent polling, so GitHub check evidence is acceptable as the runtime drift-clearance gate if direct CLI comparison is unavailable.

## 4. Exact File Contract

The implementor must add/track exactly this file:

`supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`

The file content must be exactly:

```sql
BEGIN;

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS timing_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.place_intelligence_trial_runs.timing_diagnostics IS
  'ORCH-0737 v8: temporary/permanent-safe diagnostic JSON for Flash throughput measurement. Stores per-row score/prep timing, Gemini HTTP retry/status/backoff, collage byte counts, batch identity, and worker elapsed fields. Research/trial-only; production ranking MUST NOT read this column.';

COMMIT;

-- Rollback:
--   ALTER TABLE public.place_intelligence_trial_runs DROP COLUMN IF EXISTS timing_diagnostics;
```

No checksum rewrite, comment alteration, whitespace cleanup, or rollback-text change is needed. Exact provenance matters more than prettiness here.

## 5. Implementation Steps

1. Run `git status --short --branch` and record the pre-flight state in the implementation report.
2. Inspect `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`.
3. If the file exists untracked and exactly matches this spec, stage/track it as the sole migration repair.
4. If the file is missing or content differs, recreate or correct only this file to match the exact contract above, then stage/track it.
5. Do not edit `supabase/functions/run-place-intelligence-trial/index.ts` or any app/admin/business runtime surface.
6. Do not run any live Supabase mutation command.
7. Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` with changed files, non-changes, verification outputs, and any unresolved GitHub/Supabase timing gate.

## 6. Verification Commands

Implementation must record these commands and outputs:

```bash
git status --short --branch
git diff --check
git ls-files --error-unmatch supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
git show HEAD:supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
git ls-tree -r --name-only HEAD supabase/migrations | rg '20260507000003'
```

The `git show HEAD:...` command is required after the repair is committed or otherwise evaluated against the candidate commit. If implementation is not committing in-session, the implementation report must say so and provide the equivalent staged/working-tree content evidence plus the exact command for tester to run after commit.

Implementation must also provide one of:

1. GitHub PR/main Supabase Preview/check evidence showing the drift is cleared, or
2. A tester gate explicitly requiring post-push/post-PR verification of the Supabase Preview/check.

## 7. Tester Gates

Tester must independently verify:

1. The candidate branch tracks `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`.
2. The file content exactly matches the SQL contract in this spec.
3. `git ls-tree -r --name-only HEAD supabase/migrations | rg '20260507000003'` returns the file.
4. No runtime/product files changed for ORCH-0753.
5. No `supabase db push`, `migration repair`, function deploy, or live SQL mutation was performed as part of ORCH-0753.
6. GitHub Supabase Preview/check on the PR or post-merge `main` is green. If direct GitHub timing is not available during tester execution, tester must mark ORCH-0753 conditional and name that check as the remaining close blocker.
7. ORCH-0737 remains open until its separate timing-log and baseline gates are verified.

## 8. Deployment / Live-State Policy

No live deployment is authorized for ORCH-0753.

The linked remote already contains migration version `20260507000003`; applying the same migration again is unnecessary for this repair and may introduce avoidable live-state risk. The correct action is to restore repository history so Supabase can reconcile remote migration provenance against Git.

If implementor or tester discovers evidence that the remote ledger does not contain `20260507000003`, or that Supabase reports a checksum/content mismatch instead of a missing local version, stop and return to orchestrator. That would be a new investigation, not an implementor choice.

## 9. Migration Ordering Note

This is an intentional historical versioning repair for an already-applied remote migration. It is not a new forward migration.

Standing rule remains:

1. Any future new Supabase migration must use a prefix greater than the max local and linked remote migration version.
2. Investigation-time max was `20260514000000`.
3. Do not use wall-clock date alone when the branch already contains later-dated migrations.
4. Do not introduce a new monotonic no-op migration unless a proven checksum/content mismatch requires one and orchestrator approves that plan.

## 10. Risks / Rollback

**Primary risk:** accidentally broadening the repair into live Supabase mutation or ORCH-0737 runtime changes. This spec forbids that.

**Secondary risk:** committing a file whose content does not match the already-applied migration. Tester must compare exact content before approval.

**Rollback:** if the Git-history repair is wrong before push, remove the candidate file from the commit and return to orchestrator with the contradictory evidence. If already pushed and proven wrong, revert the Git commit only after orchestrator review. Do not mutate the linked remote migration ledger as rollback for ORCH-0753.

## 11. Success Criteria

1. `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` is tracked in Git on the candidate branch.
2. The file content exactly matches the ORCH-0737 v8 contract in this spec.
3. No runtime/product files changed for ORCH-0753.
4. No live Supabase mutation was performed.
5. The candidate branch migration tree contains `20260507000003`.
6. GitHub Supabase Preview/check is green, or explicitly deferred to tester as the required post-push/post-PR verification gate.
7. ORCH-0737 remains open for its separate timing-log and baseline gates.

## 12. Handoff To Implementor

Implement only the Git-history repair: track `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` with the exact SQL above, then write the implementation report. Do not run Supabase live commands, deploy functions, or modify runtime code. The final proof is repository presence plus GitHub/Supabase Preview clearing the missing-remote-version failure.
