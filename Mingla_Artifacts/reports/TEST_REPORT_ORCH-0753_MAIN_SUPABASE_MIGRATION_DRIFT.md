# TEST REPORT ORCH-0753 - Main Supabase Migration Drift Repair

**Date:** 2026-05-07
**Mode:** TARGETED + SPEC-COMPLIANCE
**Verdict:** PASS
**Findings:** P0:0 P1:0 P2:0 P3:1 P4:2

## 1. Verdict

**PASS.**

ORCH-0753's Git-provenance repair is verified. Current `HEAD` / `origin/Seth` commit `54553cb8` contains the missing migration file `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`, the SQL content exactly matches the approved ORCH-0753 spec, and GitHub's migration-specific check `Migrations apply cleanly from baseline` is `completed success`.

No ORCH-0753 runtime/product file changes were found. No live Supabase mutation, migration repair, function deploy, or live SQL action was required or observed in this tester pass.

Plain-English impact: the database release-trust problem that made Git unable to account for remote migration `20260507000003` is repaired in the branch. ORCH-0753 is close-ready from QA. ORCH-0737 remains open for separate timing-log/baseline evidence.

## 2. Files Reviewed

- `Mingla_Artifacts/prompts/TESTER_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md`
- `Mingla_Artifacts/reports/SPEC_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md`
- `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`
- `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` ORCH-0753 and ORCH-0737 entries

## 3. Commands Run

| Check | Command | Result |
|---|---|---|
| Scoped status | `git status --short --branch -- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` | PASS: clean for both paths |
| Current commit | `git log -1 --oneline --decorate` | PASS: `54553cb8 (HEAD -> Seth, origin/Seth) docs: register ORCH-0752 RevenueCat config` |
| Commit file list | `git show --name-status --oneline HEAD \| sed -n '1,120p'` | PASS: includes ORCH-0753 implementation report and migration |
| Migration content | `git show HEAD:supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` | PASS: exact approved SQL |
| Migration tree presence | `git ls-tree -r --name-only HEAD supabase/migrations \| rg '20260507000003'` | PASS: returns the migration file |
| Whitespace | `git diff --check -- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` | PASS: exit 0, no output |
| GitHub check runs | `/opt/homebrew/bin/gh api repos/Mingla-LLC/mingla-main/commits/54553cb8/check-runs --paginate --jq '.check_runs[] \| [.name,.status,.conclusion] \| @tsv'` | PASS for migration gate |
| GitHub statuses | `/opt/homebrew/bin/gh api repos/Mingla-LLC/mingla-main/commits/54553cb8/status --jq '.statuses[] \| [.context,.state] \| @tsv'` | Product Vercel contexts mostly green/pending; not ORCH-0753 migration scope |
| Product path scan | `git show --name-status --oneline HEAD \| rg 'app-mobile\|mingla-business\|mingla-admin\|supabase/functions\|package.json\|package-lock\|pnpm-lock\|yarn.lock' \|\| true` | PASS: no output |

## 4. Command Outputs

Scoped status:

```text
## Seth...origin/Seth
```

Current commit:

```text
54553cb8 (HEAD -> Seth, origin/Seth) docs: register ORCH-0752 RevenueCat config
```

Commit file list:

```text
54553cb8 docs: register ORCH-0752 RevenueCat config
M	Mingla_Artifacts/AGENT_HANDOFFS.md
M	Mingla_Artifacts/OPEN_INVESTIGATIONS.md
M	Mingla_Artifacts/PRIORITY_BOARD.md
A	Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md
A	supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

Migration tree presence:

```text
supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

GitHub check runs:

```text
Vercel Preview Comments	completed	success
Deno unit tests for Stripe shared modules	completed	success
Migrations apply cleanly from baseline	completed	success
Supabase Preview	completed	skipped
```

GitHub commit statuses:

```text
Vercel - mingla-business	pending
Vercel - mingla-admin	success
Vercel - mingla-marketing	success
```

Product/runtime path scan:

```text
<no output>
```

## 5. Migration Content Comparison

`git show HEAD:supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` produced:

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

This exactly matches the ORCH-0753 spec contract. The migration is intentionally out-of-order/historical because the linked remote had already applied `20260507000003`; this is a versioning repair, not a new forward migration.

## 6. GitHub Check Status

The key ORCH-0753 gate is green:

- `Migrations apply cleanly from baseline`: **completed success**

`Supabase Preview` is `completed skipped`. In this context, that is acceptable because the migration-specific baseline gate succeeded and no newer failing Supabase/migration check appears on commit `54553cb8`.

Vercel status context `mingla-business` was still `pending` at test time, while `mingla-admin` and `mingla-marketing` were `success`. This is not an ORCH-0753 blocker because ORCH-0753 is a migration-provenance repair with no product/runtime path changes. Orchestrator may still choose to wait for all repository status contexts before close if it wants a globally green commit posture.

## 7. Scope Isolation

`HEAD` changed five files:

```text
M	Mingla_Artifacts/AGENT_HANDOFFS.md
M	Mingla_Artifacts/OPEN_INVESTIGATIONS.md
M	Mingla_Artifacts/PRIORITY_BOARD.md
A	Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md
A	supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

ORCH-0753 implementation scope is limited to:

- `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md`

The three modified orchestration artifacts are program metadata in the same commit. They are not product/runtime code.

No product/runtime paths were changed in `HEAD` for ORCH-0753. The product path scan returned no `app-mobile`, `mingla-business`, `mingla-admin`, `supabase/functions`, package, or lockfile hits.

## 8. Live-State / Deploy Safety

Tester did not run:

- `supabase db push`
- `supabase migration repair`
- function deploys
- live SQL mutations
- live baseline/smoke runs

No evidence in the implementation report or Git history indicates ORCH-0753 required live state mutation. That is correct because the linked remote already contained migration version `20260507000003`; the repair is Git provenance only.

## 9. Implementation Report Stale Wording

### P3-001: Implementation report contains stale staged-only wording

- **Severity:** P3 low
- **Evidence:** `IMPLEMENTATION_ORCH-0753_MAIN_SUPABASE_MIGRATION_DRIFT.md` still says `HEAD` lacks the file and that tester must verify after commit/push. Current tester evidence proves `HEAD` at `54553cb8` does contain the migration and implementation report.
- **Impact:** Non-blocking documentation staleness. The report's later rework section and this tester report supersede the stale staged-only statements.
- **Recommendation:** Orchestrator may leave as historical audit trail or clean it during close if desired. Do not reopen implementation for this alone.

## 10. Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

None.

### P3 Low

- P3-001: implementation report contains stale staged-only wording. Non-blocking.

### P4 Notes

- P4-001: The baseline migration check succeeding is stronger evidence than the skipped Supabase Preview context for this specific drift repair.
- P4-002: ORCH-0753 does not close ORCH-0737. ORCH-0737 still owns timing JSON/log coverage and baseline analysis.

## 11. ORCH-0737 Remains Open

Verified from `OPEN_INVESTIGATIONS.md`: ORCH-0737 v8 remains open for Raleigh/full-city baseline evidence, timing JSON coverage, row/batch percentile SQL, and log evidence. ORCH-0753 only repairs the missing Git migration provenance.

## 12. Close Readiness

ORCH-0753 is ready for orchestrator close from QA.

Minimum close evidence now exists:

1. Investigation confirmed the exact missing remote-applied migration.
2. Spec locked the safe remediation to Git provenance only.
3. Implementation report exists.
4. `HEAD` contains the exact migration.
5. `Migrations apply cleanly from baseline` is green on `54553cb8`.
6. No runtime/product file changes belong to ORCH-0753.
7. No live Supabase mutation was performed for ORCH-0753.
8. ORCH-0737 remains open for separate runtime/baseline work.

Residual optional gate: wait for `Vercel - mingla-business` to leave pending if orchestrator wants all commit statuses settled before close, even though it is outside ORCH-0753's migration scope.
