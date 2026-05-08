# IMPLEMENTATION ORCH-0753 - Main Supabase Migration Drift Repair

**Date:** 2026-05-07
**Status:** implemented, partially verified
**Spec:** `Mingla_Artifacts/reports/SPEC_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md`
**Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md`

## 1. Verdict

**Implemented, partially verified.**

The ORCH-0737 v8 migration file already existed locally as untracked material and matched the approved ORCH-0753 SQL contract exactly. I staged that exact file so Git now tracks it in the candidate index.

This repair is not fully closeable yet because no candidate commit/PR has been created in this session. Therefore `HEAD` still lacks the file and GitHub Supabase Preview cannot prove the drift is cleared until after commit/push/PR timing.

## 2. Plain-English Summary

The release-provenance fix is in place locally: the migration version Supabase already has remotely, `20260507000003`, is now staged for Git history. No live database command was run, and no runtime/product code was edited for ORCH-0753.

## 3. Files Changed

In-scope ORCH-0753 files:

- `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` - staged as a new Git-tracked migration file.
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` - this implementation report.

Unrelated dirty worktree changes were present before implementation and were left untouched.

## 4. Exact Migration Content Evidence

Pre-stage exact-content comparison:

```bash
diff -u <(printf '%s\n' "BEGIN;" "" "ALTER TABLE public.place_intelligence_trial_runs" "  ADD COLUMN IF NOT EXISTS timing_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb;" "" "COMMENT ON COLUMN public.place_intelligence_trial_runs.timing_diagnostics IS" "  'ORCH-0737 v8: temporary/permanent-safe diagnostic JSON for Flash throughput measurement. Stores per-row score/prep timing, Gemini HTTP retry/status/backoff, collage byte counts, batch identity, and worker elapsed fields. Research/trial-only; production ranking MUST NOT read this column.';" "" "COMMIT;" "" "-- Rollback:" "--   ALTER TABLE public.place_intelligence_trial_runs DROP COLUMN IF EXISTS timing_diagnostics;") supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

Result: exit 0, no diff output.

Staged/index content:

```bash
git show :supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

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

## 5. Verification Command Outputs

### Pre-flight status

```bash
git status --short --branch
```

Key ORCH-0753-relevant line before staging:

```text
?? supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

The full pre-flight status also showed many unrelated modified/untracked artifact, app-mobile, docs, and `run-place-intelligence-trial` files already present in the workspace. They were not touched for ORCH-0753.

### Historical migration ordering context

```bash
ls supabase/migrations | sort | tail -12
```

```text
20260511000001_b2a_v3_country_support.sql
20260511000002_b2a_v3_external_accounts.sql
20260511000003_b2a_v3_notifications.sql
20260511000004_b2a_v3_gdpr_erasure.sql
20260511000005_b2a_v3_tos_acceptance.sql
20260511000006_b2a_v3_account_type_rename.sql
20260511000007_b2a_v3_webhook_retry_count.sql
20260511000008_b2a_v3_payments_webhook_secrets.sql
20260512000001_b2a_v3_mingla_revenue_log.sql
20260513000001_b2a_v3_owner_team_members_backfill.sql
20260513000002_b2a_v3_audit_log_target_id_text.sql
20260514000000_b2a_v3_brand_owner_team_member_trigger.sql
```

Interpretation: this is an intentional historical versioning repair, not a new forward migration. Future new migrations still need a prefix greater than `20260514000000` unless orchestrator approves another out-of-order repair.

### Post-stage status

```bash
git status --short --branch
```

ORCH-0753-relevant line:

```text
A  supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

### Whitespace checks

```bash
git diff --check
git diff --cached --check -- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

Result: both commands exited 0 with no output.

### Git tracking check

```bash
git ls-files --error-unmatch supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

```text
supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

### Candidate index check

```bash
git diff --cached --name-status -- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

```text
A	supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

### HEAD tree checks

```bash
git show HEAD:supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

```text
fatal: path 'supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql' exists on disk, but not in 'HEAD'
```

```bash
git ls-tree -r --name-only HEAD supabase/migrations | rg '20260507000003'
```

Result: exit 1, no output.

Interpretation: expected until a commit exists. Tester must rerun these two commands after the staged migration is committed; they should then return the migration file from `HEAD`.

## 6. Scope Safety

Confirmed for ORCH-0753:

- No `supabase db push`.
- No `supabase migration repair`.
- No function deploy.
- No live SQL mutation.
- No live baseline/smoke run.
- No edits to `supabase/functions/run-place-intelligence-trial/index.ts`.
- No edits to app-mobile, mingla-business, mingla-admin, public web, services, hooks, UI, package dependencies, or unrelated migrations.
- No new monotonic no-op migration.
- ORCH-0737 remains open.

## 7. GitHub / Supabase Check Status

GitHub Supabase Preview/check verification is deferred to tester or orchestrator after commit/push/PR because this implementation session did not create a commit or push a branch.

Required tester gate:

```bash
git show HEAD:supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
git ls-tree -r --name-only HEAD supabase/migrations | rg '20260507000003'
```

Then verify GitHub Supabase Preview/check on the candidate PR or post-merge `main` is green. If the GitHub check is unavailable during tester timing, mark ORCH-0753 conditional with that check as the remaining close blocker.

## 8. Rework Evidence - Index Proof

Orchestrator review found the prior index proof stale: current Git showed the migration and report untracked. This rework re-captured the failing state, re-staged the two scoped files, and re-ran the required proof.

### Pre-rework state

```bash
git status --short --branch -- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md
```

```text
## Seth...origin/Seth
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md
?? supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

```bash
git diff --cached --name-status | rg 'ORCH-0753|20260507000003' || true
```

Result: exit 0, no output.

```bash
git ls-files --error-unmatch supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql; true
```

```text
error: pathspec 'supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql' did not match any file(s) known to git
Did you forget to 'git add'?
```

### Content recheck

```bash
diff -u <(printf '%s\n' "BEGIN;" "" "ALTER TABLE public.place_intelligence_trial_runs" "  ADD COLUMN IF NOT EXISTS timing_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb;" "" "COMMENT ON COLUMN public.place_intelligence_trial_runs.timing_diagnostics IS" "  'ORCH-0737 v8: temporary/permanent-safe diagnostic JSON for Flash throughput measurement. Stores per-row score/prep timing, Gemini HTTP retry/status/backoff, collage byte counts, batch identity, and worker elapsed fields. Research/trial-only; production ranking MUST NOT read this column.';" "" "COMMIT;" "" "-- Rollback:" "--   ALTER TABLE public.place_intelligence_trial_runs DROP COLUMN IF EXISTS timing_diagnostics;") supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

Result: exit 0, no diff output.

### Post-rework state

```bash
git add -- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md
git status --short --branch -- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md
```

```text
## Seth...origin/Seth
A  Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md
A  supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

```bash
git diff --cached --name-status | rg 'ORCH-0753|20260507000003'
```

```text
A	Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md
A	supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

```bash
git diff --cached --check -- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md
```

Result: exit 0, no output.

```bash
git ls-files --error-unmatch supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

```text
supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

```bash
git show :supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

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

Tester still must verify `HEAD` and GitHub Supabase Preview after commit/push. This rework does not create a commit or push.

## 9. ORCH-0737 Remains Open

ORCH-0753 only repairs Git provenance for the already-applied ORCH-0737 v8 migration. It does not close ORCH-0737. ORCH-0737 still owns the separate timing JSON/log coverage and baseline analysis gates.

## 10. Ready-for-Tester Checklist

- [x] Migration staged as Git-tracked file.
- [x] Migration content matches approved SQL contract.
- [x] No live Supabase mutation was performed.
- [x] No runtime/product files were edited for ORCH-0753.
- [x] Whitespace checks passed.
- [x] Implementation report created.
- [x] Rework index proof captured after orchestrator blocker.
- [ ] Candidate commit contains `20260507000003`.
- [ ] GitHub Supabase Preview/check proves migration drift cleared.
