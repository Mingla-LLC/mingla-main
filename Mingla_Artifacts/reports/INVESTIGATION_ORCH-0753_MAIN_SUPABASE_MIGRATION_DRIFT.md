# INVESTIGATION ORCH-0753 - Main Supabase Migration Drift

**Date:** 2026-05-07
**Mode:** INVESTIGATE
**Verdict:** CONFIRMED
**Scope:** GitHub/Supabase migration ledger integrity on `main` after PR #67
**Non-goals:** no migration edits, no `supabase db push`, no `migration repair`, no implementation

## 1. Verdict

`main` is in a real Supabase migration-ledger drift state.

The linked remote migration ledger contains `20260507000003`, but `origin/main` does not contain any migration file with that version. Mechanical comparison found exactly one remote-applied version missing from `origin/main`:

```text
remote_not_in_origin_main:
20260507000003
origin_main_not_in_remote:
```

The missing version corresponds to `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`, which exists in the dirty local workspace as an untracked file and matches the ORCH-0737 v8 spec/test-approved shape. It has never been committed on any local reachable branch: `git log --all --oneline -- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` returned no commits.

## 2. Plain-English Impact

The docs cleanup itself is not broken. PR #67 passed its docs regression and Vercel/GitGuardian checks, and its PR-side Supabase Preview was skipped.

The problem is database release trust: Supabase sees a migration applied remotely that Git cannot find on `main`. Until the missing migration file is versioned, future Supabase Preview / branch / push checks can fail even for unrelated docs or app changes.

This is not currently a user-facing app runtime failure. It is a release-pipeline blocker and provenance gap for a live-applied schema change.

## 3. Timeline

| Time / SHA | Evidence | Meaning |
|---|---|---|
| PR #66 head `733a9cf` | `gh pr view 66` shows docs, GitGuardian, Supabase Preview, Vercel checks all success | PR #66 ultimately merged green. |
| PR #66 merge `c06f7c2` at 2026-05-07 22:28:09 UTC | `gh pr view 66` | First docs lock-in merge. |
| PR #67 head `326a053` | `gh pr view 67` shows docs success, GitGuardian success, Supabase Preview skipped, Vercel statuses success | PR #67 did not fail Supabase on the PR branch. |
| PR #67 merge `6a49a798` at 2026-05-07 23:18:30 UTC | `gh pr view 67` | Latest merged docs link-burndown PR. |
| Main post-merge check run `74925968861` | GitHub API check-run output says Supabase Preview conclusion `failure`, summary `Remote migration versions not found in local migrations directory.` | Real `main` Supabase failure. |
| Docs post-merge Action `25527364829` | `gh run view` / `gh run list` shows docs-artifact-regression success on `main` | Docs gate is green; failure is Supabase app check, not docs CI. |

## 4. Migration Ledger Comparison

### `origin/main`

`git ls-tree -r --name-only origin/main supabase/migrations | sort | tail -40` includes:

```text
20260507000000_orch_0734_rls_returning_owner_gap_fix.sql
20260507000002_orch_0737_v4_prep_status.sql
20260508000000_b2a_stripe_connect_onboarding.sql
...
20260514000000_b2a_v3_brand_owner_team_member_trigger.sql
```

It does **not** include `20260507000003`.

`git show origin/main:supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` fails with:

```text
fatal: path 'supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql' exists on disk, but not in 'origin/main'
```

### Local Dirty Workspace

`git status --short --branch` shows the file exists only as untracked local material:

```text
?? supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

`git ls-files --error-unmatch supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` fails:

```text
error: pathspec ... did not match any file(s) known to git
Did you forget to 'git add'?
```

### Linked Remote

`/Users/sethogieva/bin/supabase migration list --linked` succeeded once and showed aligned local/remote rows including:

```text
Local          | Remote
20260507000002 | 20260507000002
20260507000003 | 20260507000003
20260508000000 | 20260508000000
...
20260514000000 | 20260514000000
```

Important limitation: this command was run from the dirty local workspace, so its `Local` column could see the untracked `20260507000003` file. The `Remote` column still proves the linked remote ledger contains version `20260507000003`.

A later parallel comparison attempt retried the Supabase CLI enough to trip the temp-role circuit breaker:

```text
FATAL: Circuit breaker open: Too many authentication errors
Connect to your database by setting the env var correctly: SUPABASE_DB_PASSWORD
```

No further Supabase CLI polling was attempted after that.

## 5. Historical Context

ORCH-0737 v8 intentionally introduced this migration. The spec says to create `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` and add `place_intelligence_trial_runs.timing_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb`; it also states no mobile/business/admin/production-ranking path should read it and no live baseline should start without operator lock.

Implementation report `IMPLEMENTATION_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH_REPORT.md` lists the migration as a changed file, says it adds the `timing_diagnostics` JSONB column, and says it was implemented but not deployed/baseline-run at that point.

Tester retest `TEST_REPORT_ORCH-0737_V8_DENO_GATE_RETEST.md` reviewed the migration file, verified shape as `jsonb NOT NULL DEFAULT '{}'::jsonb`, and found no app-mobile/mingla-business/mingla-admin code reader.

Later orchestrator history says the operator applied `20260507000003_orch_0737_v8_timing_diagnostics.sql` using `supabase db push --include-all` because it was older than remote head; Codex then deployed `run-place-intelligence-trial`, and live schema showed `timing_diagnostics | jsonb | '{}'::jsonb | NO`. The same entry explicitly notes that future migration names must be monotonic above max local+remote migration version.

ORCH-0750B implementation history already captured this file as untracked in `git status`, and its active migration inventory included `20260507000003`. That proves the file existed locally before PR #67 and was not introduced by PR #67.

ORCH-0750E tester report separates docs health from Supabase health: PR #67 docs checks passed, and Supabase Preview on PR #67 was skipped, not failed.

## 6. Root Cause

### Finding RC-0753-1: remote-applied ORCH-0737 v8 migration was never versioned on `main`

- **Classification:** confirmed bug / production-hardening gap / release-pipeline integrity gap
- **File/line:** missing from `origin/main`; present untracked at `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`
- **Exact code/schema:** linked remote migration ledger includes version `20260507000003`; `origin/main` migration list jumps from `20260507000002` to `20260508000000`
- **Current behavior:** GitHub Supabase Preview on `main` fails with `Remote migration versions not found in local migrations directory.`
- **Expected behavior:** every remote-applied migration version exists in `supabase/migrations/` on `main`, so Supabase can reconcile remote ledger to repository history
- **Causal chain:** ORCH-0737 v8 migration was authored locally -> operator applied it live with `--include-all` because it was backdated behind later `20260508+` migrations -> the file remained untracked and never reached `origin/main` -> PR #67 pushed `main` and Supabase compared remote ledger against `main` contents -> remote version `20260507000003` was not found locally -> Supabase Preview failed
- **Verification step:** `comm` comparison between successful remote ledger list and `origin/main` migration versions produced only `20260507000003` under `remote_not_in_origin_main`; `git log --all --oneline -- <file>` returned no commits

## 7. Blast Radius

| Surface | Impact |
|---|---|
| GitHub checks | `main` Supabase Preview is red. Docs/Vercel statuses are green. |
| Supabase branch/previews | Future branch/main checks may keep failing until migration ledger and Git history align. |
| Production/live DB | Live DB already has `timing_diagnostics`; no evidence of schema runtime failure from this investigation. |
| Edge function | ORCH-0737 deployed function may write `timing_diagnostics`; live schema support exists per prior orchestrator evidence. |
| Mobile / business / admin | No direct code reader of `timing_diagnostics` per prior tester scan; no app runtime blast detected. |
| ORCH-0737 close | Still not closed. Baseline/runtime timing evidence remains pending; this drift is an additional release hygiene blocker. |
| Documentation PR #67 | Not the root cause. It surfaced the drift on the next main push. |

## 8. Safe Remediation Options

### Option A - Version the exact already-applied migration file as-is

**Recommendation:** highest confidence, minimal blast.

Contract:

1. Add `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` to Git with the exact content already present locally and specified by ORCH-0737.
2. Do not run `supabase db push` for this remediation unless a later spec/test gate explicitly requires it; the remote ledger already contains this version.
3. Push a PR/commit and verify GitHub Supabase Preview on `main` or a controlled PR returns green.
4. Re-run docs gates if docs/artifact files are touched by the implementation report.

Why this is safe: the missing remote version is exactly the version Git needs to know about. A new monotonic migration alone would not satisfy "remote migration versions not found" for `20260507000003`.

### Option B - Commit file plus a monotonic no-op/repair note migration

Not recommended unless a later check proves checksum/content mismatch or another hidden Supabase requirement. It adds noise and does not remove the need to version `20260507000003`.

### Option C - Supabase migration repair / mark reverted

Not recommended. The remote schema and deployed function depend on the column. Marking the remote migration reverted would lie about a live-applied schema change and may create worse drift.

## 9. Required SPEC / IMPLEMENTOR Contract

If orchestrator advances to SPEC/IMPLEMENTOR, the contract should require:

1. Scope limited to versioning `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` and an implementation report/artifact sync.
2. The migration file content must match the ORCH-0737 v8 spec:

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

3. No edits to `supabase/functions/run-place-intelligence-trial/index.ts` unless a later spec proves source drift from deployed behavior.
4. No `supabase db push`, `migration repair`, or function deploy in implementation. This is a Git-history repair first.
5. Implementation report must record:
   - `git status --short --branch` before/after,
   - `git diff --check`,
   - `git ls-files --error-unmatch supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`,
   - `git show HEAD:supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`,
   - comparison proving `origin/main` / PR head now contains `20260507000003`.
6. Spec must explicitly preserve the monotonic migration rule for future new migrations: any new migration after this repair must use a prefix greater than max local+remote head (`20260514000000` at investigation time), unless orchestrator approves an intentional backfill with `--include-all`.

## 10. Required Tester / Verification Gates

Tester should verify:

1. The migration file is tracked in Git on the candidate branch.
2. File content exactly matches ORCH-0737 v8 schema/comment/rollback contract.
3. `origin/main` or PR head migration list includes `20260507000003`.
4. Remote ledger comparison has no `remote_not_in_origin_main` gaps. If Supabase CLI is circuit-blocked, use GitHub Supabase check result as the runtime gate.
5. GitHub Supabase Preview/check on the PR or post-merge `main` is green.
6. Docs regression remains green if artifact/report docs changed.
7. No product/runtime files were changed.
8. ORCH-0737 remains open until timing logs/baseline evidence are separately verified; do not close ORCH-0737 merely because migration history is repaired.

## 11. Appendix - Command Evidence

### Required commands run

```bash
git fetch origin main Seth orch-0750e-link-burndown --prune
git status --short --branch
git ls-tree -r --name-only origin/main supabase/migrations | sort | tail -40
git ls-tree -r --name-only origin/main supabase/migrations | rg '20260507000003|20260514|20260513|20260512|20260511|20260510|20260509|20260508' || true
git log --all --oneline -- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
/Users/sethogieva/bin/supabase migration list --linked
/opt/homebrew/bin/gh api repos/Mingla-LLC/mingla-main/commits/6a49a798a1b9f1a45272828b4c799df80aa52497/check-runs --paginate
/opt/homebrew/bin/gh api repos/Mingla-LLC/mingla-main/check-runs/74925968861
```

### Notable outputs

`git status --short --branch`:

```text
## Seth...origin/Seth [ahead 98, behind 3]
...
?? supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

`origin/main` relevant migration grep:

```text
supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql
...
supabase/migrations/20260514000000_b2a_v3_brand_owner_team_member_trigger.sql
```

No `20260507000003` appeared.

`git log --all --oneline -- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`:

```text
<no output>
```

GitHub check run `74925968861`:

```text
name: Supabase Preview
head_sha: 6a49a798a1b9f1a45272828b4c799df80aa52497
conclusion: failure
summary: Remote migration versions not found in local migrations directory.
```

Docs action on the same main commit:

```text
workflowName: Docs Artifact Regression
headSha: 6a49a798a1b9f1a45272828b4c799df80aa52497
conclusion: success
```

Manual comparison using successful remote list:

```text
remote_not_in_origin_main:
20260507000003
origin_main_not_in_remote:
```

## 12. Five-Layer Check

| Layer | Evidence | Status |
|---|---|---|
| Docs/artifacts | ORCH-0737 spec/implementation/test reports define and verify the migration; ORCH-0750E tester confirms docs PR scope/checks green | PASS |
| Schema/migrations | Remote ledger contains `20260507000003`; `origin/main` lacks it; local untracked file matches schema contract | FAIL in Git provenance |
| Code | Edge function changed in ORCH-0737 to write diagnostics; no app/business/admin reader per tester scans | PASS / unaffected |
| Runtime/checks | GitHub Supabase check on `main` fails; Vercel/docs checks pass | FAIL only in Supabase release check |
| Persisted data assumptions | Prior orchestrator live schema proof says column exists; current live polling limited after CLI circuit breaker | PASS with prior evidence, current verification limited |
