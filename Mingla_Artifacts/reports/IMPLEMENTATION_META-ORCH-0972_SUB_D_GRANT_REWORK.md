# Implementation Report: META-ORCH-0972 Sub-D Grant Rework

> Date: 2026-05-26
> Mode: Rework
> Spec: User-directed rework from `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_D_REPORT.md`
> Status: implemented and verified

## 1. Layman Summary

The owner-side brand offering count RPC is no longer callable by anonymous clients on the live Supabase project. Anonymous REST calls now fail with a permission error, while the authenticated database role retains EXECUTE, so the Sub-C/Sub-D security contract is restored without changing edge functions, packages, public brand kind removal scope, or Stage 4.

## 2. Request And Context

- **Request:** Fix only the live/local grant posture for `public.pg_brand_offering_counts(uuid)` so `anon` cannot execute it.
- **Source:** QA FAIL report `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_D_REPORT.md`, finding P1-001.
- **Affected surfaces:** Supabase migration chain, SQL privilege probe, ORCH-0863 backend allowlist gate.
- **Related issues/artifacts:** META-ORCH-0972 [brand kind decommission universal features] Sub-C/Sub-D grant posture; final close PR squash body must keep `[TEST-MOD-APPROVED META-ORCH-0972]`.

## 3. Scope

- **In scope:** Add a grant-only migration; apply it to the linked live Supabase project; add a repo-running anon-vs-authenticated regression/probe; keep existing focused QA gates green.
- **Out of scope:** Edge function source changes, package changes, PR creation, `[deploy]` tag, Stage 4 `brands.kind` drop.
- **Assumptions:** Authenticated REST user-token smoke remains tester-owned because no live user JWT was available in this implementor environment; catalog privilege and anon REST denial were verified live.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry scan | COMMS-0002/0003/0004 applied as WARN context and were acknowledged on anchor main commit `14692dd43`. |
| `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_D_REPORT.md` | Rework source | P1-001 required explicit anon revoke and anon/auth retest. |
| `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql` | Existing RPC definition | It revoked `PUBLIC` but did not explicitly revoke `anon`. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | Backend allowlist guard | New migration/probe files must be allowlisted for C7 once committed. |
| `supabase/migrations/__tests__/*` | Local Deno migration-test pattern | Existing tests use source-level SQL contract assertions without requiring a local DB harness. |

## 5. Blast Radius

- **Direct changes:** One grant-only migration; one Deno regression test; one read-only SQL probe; one strict-grep allowlist update.
- **Cascade changes:** Live migration history now includes `20260729000001`.
- **Parity surfaces:** No app UI behavior changed.
- **Cache impact:** None.
- **State boundaries:** None.
- **Auth/RLS/security:** Restores authenticated-only EXECUTE posture for `pg_brand_offering_counts(uuid)`.
- **Deploy path:** `supabase db push --linked` was run from the per-ORCH worktree after confirming no remote-only migration versions.

## 6. Old To New Receipts

### `supabase/migrations/20260729000001_meta_orch_0972_pg_brand_offering_counts_grants.sql`

- **Before:** Live `proacl` included `anon=X/postgres`; anon REST returned HTTP 200 with counts.
- **After:** Migration revokes `PUBLIC`, explicitly revokes `anon`, and grants EXECUTE only to `authenticated`.
- **Why:** Supabase default function grants can leave explicit anon EXECUTE even after `REVOKE ... FROM PUBLIC`.
- **Approx lines changed:** 11 added.

### `supabase/migrations/__tests__/pg_brand_offering_counts_grants.test.ts`

- **Before:** No repo-running regression pinned the RPC privilege posture.
- **After:** Deno test asserts the grant repair revokes anon/PUBLIC, preserves authenticated, and carries the expected probe shape.
- **Why:** Fails before this rework because the repair migration/probe is absent, and fails if anon EXECUTE is restored in the migration.
- **Approx lines changed:** 65 added.

### `supabase/migrations/__tests__/pg_brand_offering_counts_privilege_probe.sql`

- **Before:** QA used an ad hoc catalog probe only.
- **After:** Repo contains a read-only SQL probe for `anon_can_execute=false` and `authenticated_can_execute=true`.
- **Why:** Gives tester a stable probe to rerun against live/local DBs.
- **Approx lines changed:** 15 added.

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

- **Before:** C7 would block committed new backend migration/test/probe files unless they were in the META-ORCH-0972 allowlist.
- **After:** Adds the three scoped grant-rework files to `ORCH_0972_BACKEND_ALLOWLIST`.
- **Why:** Keeps the unrelated ORCH-0863 backend guard green without weakening its checks.
- **Approx lines changed:** 3 added.

## 7. Implementation Details

- **Architecture decisions:** Used a follow-up migration instead of editing edge functions or app code.
- **Data flow:** No data rows changed; only function EXECUTE grants changed.
- **Mutation/query behavior:** Existing authenticated owner-side calls keep using the same RPC; anon callers are blocked before execution.
- **State handling:** Not applicable.
- **Error handling:** PostgREST now returns permission denied for anon RPC calls.
- **Copy/accessibility:** Not applicable.
- **Analytics/notifications/realtime:** Not applicable.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Anon cannot execute `pg_brand_offering_counts(uuid)` | Yes | Live catalog: `anon_can_execute=false`; anon REST: HTTP 401 permission denied. | PASS |
| Authenticated retains execute posture | Yes | Live catalog: `authenticated_can_execute=true`; `proacl` includes authenticated and excludes anon. | PASS |
| Add repo-running regression/probe | Yes | `deno test --allow-read supabase/migrations/__tests__/pg_brand_offering_counts_grants.test.ts` passed 3/3. | PASS |
| Preserve ancestor commits | Yes | `git merge-base --is-ancestor` passed for `411925909`, `fee178634`, `a1c1d7f70`, `7c7da04b8`, `bd49d6aee`, `cb538a11e`. | PASS |
| No edge/package/PR/deploy-tag/Stage-4 work | Yes | Scoped diff contains only migration/test/probe/strict-grep/report. | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| Least-privilege RPC grants | Yes | Yes | Anon EXECUTE removed; authenticated retained. |
| Tests move with behavior | Yes | Yes | Deno regression and SQL probe added with the migration. |
| Worktree-per-ORCH | Yes | Yes | Work performed in `/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/` on branch `meta-orch-0972-brand-kind-decommission-universal-features`. |
| No Stage 4 drop | Yes | Yes | No `DROP COLUMN brands.kind` migration added or applied. |
| No edge function source change | Yes | Yes | Edge sources untouched; Deno checks run only as verification. |

## 10. Parity Check

- **Mobile:** No runtime/UI change.
- **Business app:** Owner-side RPC privilege preserved for authenticated role.
- **Admin:** No change.
- **Public/web:** Anonymous public REST access to the owner-count RPC is now denied.
- **Solo/collab:** Not applicable.
- **Gaps:** Authenticated REST with a real user JWT was not run in this environment; tester should run it if a live user token is available.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Unchanged.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Remote migration history before push | `/Users/sethogieva/bin/supabase migration list --linked` | PASS | No remote-only versions; remote head was `20260729000000`. |
| Apply grant migration live | `/Users/sethogieva/bin/supabase db push --linked` | PASS | Applied `20260729000001_meta_orch_0972_pg_brand_offering_counts_grants.sql`. |
| Remote migration history after push | `/Users/sethogieva/bin/supabase migration list --linked \| tail -20` | PASS | Remote now includes `20260729000001`. |
| Pre-fix live catalog probe | Supabase MCP `execute_sql` | REPRODUCED | `anon_can_execute=true`, `authenticated_can_execute=true`, `proacl={postgres,anon,authenticated,service_role}`. |
| Post-fix live catalog probe | Supabase MCP `execute_sql` | PASS | `anon_can_execute=false`, `authenticated_can_execute=true`, `proacl={postgres,authenticated,service_role}`. |
| Anon REST denial | `curl POST /rest/v1/rpc/pg_brand_offering_counts` with anon key | PASS | HTTP 401, `permission denied for function pg_brand_offering_counts`. |
| New Deno regression | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/migrations/__tests__/pg_brand_offering_counts_grants.test.ts` | PASS | 3 tests passed. |
| No brand kind reads | `node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs` | PASS | N1-N4. |
| Data-driven tabs | `node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs` | PASS | D1-D4. |
| ORCH-0963 RPC/route gate | `node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs` | PASS | 2/2 assertions. |
| ORCH-0863 backend allowlist | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | C1-C7. |
| Sub-D Jest strict-grep tests | `cd mingla-business && npx jest --runInBand __tests__/strictGrep/noBrandKindReads.test.ts __tests__/strictGrep/noBrandKindReadsAppCoverage.test.ts` | PASS | 2 suites / 2 tests. |
| Deno check edge entries | `/Users/sethogieva/.deno/bin/deno check supabase/functions/{parse-restaurant-menu,parse-play-activities,agent-chat,agent-confirm-action}/index.ts` | PASS | All 4 exited 0; no edge source changed. |
| Deno test edge dirs | `/Users/sethogieva/.deno/bin/deno test supabase/functions/<fn>` | N/A | Each returned `No test modules found`, matching prior QA limitation. |
| Scoped diff whitespace | `git diff --check -- <touched grant rework files>` | PASS | Full `git diff --check` still reports pre-existing unrelated trailing whitespace in `QA_META-ORCH-0972_SUB_B_REPORT.md`. |

## 13. Regression Surface

1. Public REST callers can no longer use this owner-count RPC anonymously; this is intended.
2. Authenticated owner-side calls continue to require the same RPC signature and result shape.
3. ORCH-0863 C7 remains sensitive to committed backend diffs; new files are explicitly allowlisted under META-ORCH-0972.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Authenticated REST user-token smoke not run | Catalog proves grant, but no live authenticated JWT was available for PostgREST user-call proof. | Tester reruns with a real authenticated user token if available. | QA retest |
| Existing unrelated dirty QA artifacts | Worktree had pre-existing Sub-B report/evidence changes; full diff-check is noisy. | Leave untouched or have owning phase clean/stage separately. | Worktree status |

## 15. Discoveries For Orchestrator

- None requiring a new COMMS entry. The grant issue is fully in this rework scope.

## 16. Deploy Notes

- **Migrations:** Live DB was updated by running:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]" && /Users/sethogieva/bin/supabase db push --linked
```

- **Edge functions:** No edge source changes and no edge deploy.
- **Mobile OTA/native:** None.
- **Business/admin web:** None.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
META-ORCH-0972 Sub-D grant rework

Restores authenticated-only EXECUTE posture for pg_brand_offering_counts.
Adds Deno grant regression and SQL privilege probe.
Evidence: IMPLEMENTATION_META-ORCH-0972_SUB_D_GRANT_REWORK.md.
```

## Ready-To-Test Checklist

1. Run the catalog probe in `supabase/migrations/__tests__/pg_brand_offering_counts_privilege_probe.sql`; expect `anon_can_execute=false` and `authenticated_can_execute=true`.
2. POST to `/rest/v1/rpc/pg_brand_offering_counts` with the anon key; expect HTTP 401/403 permission denied.
3. POST to the same RPC with a real authenticated user JWT; expect the count row to return.
4. Keep `[TEST-MOD-APPROVED META-ORCH-0972]` in the final CLOSE PR squash body.
