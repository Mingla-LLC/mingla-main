# QA Report: META-ORCH-0972 Sub-D Grant Rework Retest

> Date: 2026-05-26
> Mode: RETEST / SECURITY / TARGETED
> Verdict: PASS
> Severity counts: P0:0 P1:0 P2:0 P3:0 P4:2
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`
> Branch: `meta-orch-0972-brand-kind-decommission-universal-features`
> Commit verified: `77604c7c521895767313da2f1927c7b3c9cf1667`

## 1. Layman Summary

The prior Sub-D release blocker is fixed. The live Supabase project now denies anonymous REST execution of `pg_brand_offering_counts(uuid)`, while the authenticated database role still has EXECUTE. The new grant-only migration, repo-running Deno regression, SQL privilege probe, and focused Sub-D gates all verify the corrected security posture.

## 2. Inputs Reviewed

| Input | Result |
|---|---|
| `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_D_GRANT_REWORK.md` | Read; implementation claims retested independently. |
| `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_D_REPORT.md` | Read; prior P1-001 was the target of this retest. |
| Commit `77604c7c5` | Verified as worktree `HEAD` and `origin/meta-orch-0972-brand-kind-decommission-universal-features`. |
| `supabase/migrations/20260729000001_meta_orch_0972_pg_brand_offering_counts_grants.sql` | Read; explicitly revokes `PUBLIC` and `anon`, grants only `authenticated`. |
| `supabase/migrations/__tests__/pg_brand_offering_counts_grants.test.ts` | Read and run; pins the grant repair contract. |
| `supabase/migrations/__tests__/pg_brand_offering_counts_privilege_probe.sql` | Read; probe asserts `anon=false` and `authenticated=true`. |
| `COMMS_LEDGER.md` | COMMS-0002, COMMS-0003, and COMMS-0004 were acknowledged for this retest on anchor commit `4ed70e55b`. |

## 3. Prior Fail Retest

### P1-001: `pg_brand_offering_counts` executable by `anon`

**Retest verdict: RESOLVED.**

Evidence:

| Check | Evidence | Result |
|---|---|---|
| Local migration repair | `20260729000001` lines 7-9 revoke `PUBLIC`, revoke `anon`, and grant `authenticated`. | PASS |
| Live migration applied | Supabase CLI `migration list --linked` and Supabase MCP `list_migrations` both include `20260729000001 meta_orch_0972_pg_brand_offering_counts_grants`. | PASS |
| Live privilege probe | Supabase MCP SQL returned `anon_can_execute=false`, `authenticated_can_execute=true`, `proacl="{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}"`. | PASS |
| Anonymous REST denial | `POST /rest/v1/rpc/pg_brand_offering_counts` with only the anon key returned HTTP 401 and `permission denied for function pg_brand_offering_counts`. | PASS |
| Authenticated privilege posture | `has_function_privilege('authenticated', 'public.pg_brand_offering_counts(uuid)', 'execute') = true`. | PASS |

## 4. Commit Scope

`git show --name-status 77604c7c5` contains only:

| Path | Status | QA note |
|---|---|---|
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | Modified | Adds the three scoped grant-rework backend files to the META-ORCH-0972 allowlist. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_D_GRANT_REWORK.md` | Added | Implementation report only. |
| `supabase/migrations/20260729000001_meta_orch_0972_pg_brand_offering_counts_grants.sql` | Added | Grant-only migration. |
| `supabase/migrations/__tests__/pg_brand_offering_counts_grants.test.ts` | Added | Repo-running grant regression. |
| `supabase/migrations/__tests__/pg_brand_offering_counts_privilege_probe.sql` | Added | Live/local SQL privilege probe. |

No edge function source, package file, deploy tag, PR state, or Stage 4 `brands.kind` drop scope was changed by the verified commit. A scoped grep for `DROP COLUMN kind` / `ALTER TABLE public.brands ... DROP` returned no matches.

## 5. Migration Ordering

| Check | Result |
|---|---|
| Local max migration | `20260729000001_meta_orch_0972_pg_brand_offering_counts_grants.sql` is the local max migration. |
| Remote max migration | Remote migration list includes `20260729000001` as applied. |
| Monotonicity | `20260729000001` correctly follows `20260729000000_meta_orch_0972_universal_authoring.sql`. |

## 6. Automated Gates

| Gate | Command | Result |
|---|---|---|
| No brand-kind reads strict-grep | `node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs` | PASS: N1-N4 |
| Data-driven tabs strict-grep | `node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs` | PASS: D1-D4 |
| ORCH-0963 RPC/route segregation | `node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs` | PASS: 2/2 assertions |
| ORCH-0863 backend allowlist | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS: C1-C7 |
| New Deno grant regression | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/migrations/__tests__/pg_brand_offering_counts_grants.test.ts` | PASS: 3/3 tests |
| Sub-D Jest strict-grep tests | `cd mingla-business && npx jest --runInBand __tests__/strictGrep/noBrandKindReads.test.ts __tests__/strictGrep/noBrandKindReadsAppCoverage.test.ts` | PASS: 2 suites / 2 tests |
| Deno edge checks | `/Users/sethogieva/.deno/bin/deno check supabase/functions/parse-restaurant-menu/index.ts supabase/functions/parse-play-activities/index.ts supabase/functions/agent-chat/index.ts supabase/functions/agent-confirm-action/index.ts` | PASS |
| Deno edge tests | `/Users/sethogieva/.deno/bin/deno test supabase/functions/parse-restaurant-menu supabase/functions/parse-play-activities supabase/functions/agent-chat supabase/functions/agent-confirm-action` | P4 NOTE: command returned `No test modules found`; unchanged prior limitation. |
| Scoped diff whitespace | `git diff --check -- <grant-rework touched files>` | PASS |

## 7. Regression Coverage

The new Deno regression is sufficient for the grant-rework contract because it fails if the repair migration is absent, if `anon` or `PUBLIC` receive EXECUTE again, if `authenticated` is not the only grant target in the repair migration, or if the SQL probe stops asserting the expected `anon=false` / `authenticated=true` posture.

The live probe supplies the runtime proof that source-level SQL assertions alone cannot provide: the linked Supabase project now has the repaired ACL and public REST callers are denied before function execution.

## 8. Residual Notes

| ID | Severity | Note | Release impact |
|---|---|---|---|
| N-1 | P4 | No real user JWT was available for an authenticated PostgREST 200 response smoke. The authenticated role grant was verified directly through Postgres catalog privilege. | Non-blocking. |
| N-2 | P4 | The four checked edge-function directories still contain no Deno test modules. `deno check` passes, and this retest did not change edge function source. | Non-blocking. |

## 9. Verdict

PASS.

The prior P1 anon-execute blocker is resolved, authenticated EXECUTE posture is preserved, the live migration is present, anon REST denial is proven, and the focused strict-grep/Jest/Deno gates pass. Route to Codex `orchestrator-mingla` for CLOSE, and keep the final CLOSE PR squash note:

```text
[TEST-MOD-APPROVED META-ORCH-0972]
```
