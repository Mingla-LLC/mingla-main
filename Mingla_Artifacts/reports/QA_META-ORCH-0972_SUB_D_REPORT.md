# QA Report: META-ORCH-0972 Sub-D PASS Verification

> Date: 2026-05-26
> Mode: SPEC-COMPLIANCE / TARGETED / SECURITY
> Verdict: FAIL
> Findings: P0:0 P1:1 P2:1 P3:0 P4:2

## 1. Layman Summary

Sub-D's local CI gates, tester adversarial regression, deploy version checks, and edge reachability smoke are green enough for the strict-grep and deploy parts of the phase. The release cannot close because the prior Sub-C authenticated-only owner-count RPC is currently callable by anonymous clients on the live Supabase project. That violates the Sub-C/Sub-D close contract and leaks per-brand published offering counts through the public REST RPC path.

## 2. Inputs Reviewed

| Input | Result |
|---|---|
| `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_D.md` | Read. Claims independently spot-checked against code, tests, deploy metadata, and live calls. |
| `Mingla_Artifacts/reports/REVIEW_META-ORCH-0972_SUB_D.md` | Read. Version bump claims confirmed remotely. |
| `Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` Sub-spec D | Read SC-D-1 through SC-D-9 and T-45 through T-54. |
| `Mingla_Artifacts/reports/REVIEW_META-ORCH-0972_SUB_C.md` | Read for prior migration remote contract and close carry-forwards. |
| `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql` | Read. Local SQL intends `pg_brand_offering_counts` to be authenticated-only. |
| `COMMS_LEDGER.md` | COMMS-0002, COMMS-0003, COMMS-0004 acknowledged on anchor main commit `9c1aa1af1`. |

## 3. Verdict Finding

### P1-001: `pg_brand_offering_counts` is executable by `anon` on remote

**Evidence:**

- Supabase SQL privilege probe:
  - `has_function_privilege('anon','public.pg_brand_offering_counts(uuid)','execute') = true`
  - `proacl = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
- Public REST probe with only anon key:
  - `POST /rest/v1/rpc/pg_brand_offering_counts`
  - body `{"p_brand_id":"22a18413-bfbf-4087-9ba7-45f70deba0f3"}`
  - returned HTTP 200 with `[{"events":13,"trips":0,"experiences":0}]`

**Why it blocks:** SPEC Sub-C SC-C-6 and the Sub-C review both state `pg_brand_offering_counts` is authenticated-only. The live remote grant posture contradicts that contract, and this QA pass was explicitly asked to confirm Sub-C migration posture still survives the brand-kind world.

**Required fix:** Add a narrowly scoped migration that explicitly revokes anon execution:

```sql
REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_brand_offering_counts(uuid) TO authenticated;
```

Retest with both catalog privilege probes and REST calls: anon must return 401/403 or function-not-executable behavior, while an authenticated user path still succeeds.

## 4. Focused Gate Results

| Check | Command | Result |
|---|---|---|
| No brand kind reads gate | `node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs` | PASS: `N1-N4` |
| Data-driven tabs gate | `node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs` | PASS: `D1-D4` |
| ORCH-0963 renamed gate | `node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs` | PASS: C2/C4 preserved |
| ORCH-0863 backend allowlist | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS: C7 zero offenders |
| Dispatch literal Jest command | `npx jest --runInBand mingla-business/__tests__/strictGrep/noBrandKindReads.test.ts` from worktree root | BLOCKED by repo layout: root has no Jest config |
| Package-correct Jest command | `cd mingla-business && npx jest --runInBand __tests__/strictGrep/noBrandKindReads.test.ts` | PASS: 1 suite / 1 test |
| Deno check, 4 functions | `deno check` against each deployed function entrypoint | PASS: all exit 0 |
| Deno test, 4 function dirs | `deno test supabase/functions/<fn>` | N/A: each returned `No test modules found` |

## 5. Tester Adversarial Regression

| Item | Evidence |
|---|---|
| New test path | `mingla-business/__tests__/strictGrep/noBrandKindReadsAppCoverage.test.ts` |
| Commit hash | `bd49d6aeef12ac0555bdec541ce9e645863cfd53` |
| Angle | Plants `brand.kind === 'physical'` under `mingla-business/app/(tabs)/hub/BadAppFixture.tsx`, not `mingla-business/src/`, proving the gate covers active Expo route files. |
| Solo pass output | `PASS __tests__/strictGrep/noBrandKindReadsAppCoverage.test.ts`; 1 suite / 1 test |
| Combined pass output | `PASS __tests__/strictGrep/noBrandKindReadsAppCoverage.test.ts`; `PASS __tests__/strictGrep/noBrandKindReads.test.ts`; 2 suites / 2 tests |

## 6. Fails-On-Revert Verification

| Target | Method | Result |
|---|---|---|
| Implementor `noBrandKindReads.test.ts` | Temporarily moved `.github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs` aside, ran the test, restored the script, reran the test. | PASS as a reversion detector: the temporary removal made the test fail because expected `N1` output disappeared; after restoration the test passed again. |
| Worktree restoration | `git status --short .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs` | Clean for the gate script after restore. |

## 7. Edge Deploy And Smoke

Remote versions from `mcp__supabase__list_edge_functions`:

| Function | Expected bump | Remote version | `verify_jwt` | Result |
|---|---:|---:|---:|---|
| `parse-restaurant-menu` | 38 -> 39 | 39 | true | PASS |
| `parse-play-activities` | 37 -> 38 | 38 | true | PASS |
| `agent-chat` | 71 -> 72 | 72 | true | PASS |
| `agent-confirm-action` | 66 -> 67 | 67 | true | PASS |

Curl smoke results using the project anon JWT as bearer, with typed invalid-session validation expected from the function bodies:

| Function | HTTP | Body |
|---|---:|---|
| `parse-restaurant-menu` | 401 | `{"kind":"error","code":"UNAUTHORIZED","message":"Invalid or expired session"}` |
| `parse-play-activities` | 401 | `{"kind":"error","code":"UNAUTHORIZED","message":"Invalid or expired session"}` |
| `agent-chat` | 401 | `{"kind":"error","code":"UNAUTHORIZED","message":"Invalid or expired session"}` |
| `agent-confirm-action` | 401 | `{"kind":"error","code":"UNAUTHORIZED","message":"Invalid or expired session"}` |

Supabase edge logs confirmed the requests hit the deployed versions, not stale bundles:

- `parse-restaurant-menu`: POST 401, version 39
- `parse-play-activities`: POST 401, version 38
- `agent-chat`: POST 401, version 72
- `agent-confirm-action`: POST 401, version 67

Limitation: no live user access token was available in the QA environment, so SC-D-9's stronger popup-brand 200 parsed-JSON path was not executed. The non-404 deployed reachability and typed validation path were verified.

## 8. Gemini Prompt Inspection

The edge logs do not include Gemini request bodies or `systemInstruction` text. Remote deployed bundle inspection via `mcp__supabase__get_edge_function(function_slug="parse-restaurant-menu")` confirmed that the active version 39 bundle includes:

```ts
systemInstruction: {
  parts: [{ text: `You are parsing a ${temporaryCategory} menu.\n\n${SYSTEM_PROMPT}` }],
}
```

The same remote bundle includes `const temporaryCategory = "restaurant";` at the live parse call site. This proves the deployed function version contains the Q15 prompt-layer write-through, but it is not a literal Gemini provider log inspection.

## 9. Sub-C Remote Presence

Remote objects present:

| Object | Status |
|---|---|
| `business_public_brands_view` | PRESENT |
| `business_public_events_view` | PRESENT |
| `claimed_venues_public_view` | PRESENT |
| `pg_brand_offering_counts(p_brand_id uuid)` | PRESENT |
| `pg_public_brand_upcoming(p_brand_slug text, p_cursor_at timestamptz, p_limit integer)` | PRESENT |
| `pg_public_experiences_by_brand(p_brand_slug text)` | PRESENT |
| `pg_public_trips_by_brand(p_brand_slug text)` | PRESENT |
| `biz_create_venue_brand_pending_review(...)` | PRESENT |
| `biz_review_venue_claim(p_brand_id uuid, p_action text, p_rejection_reason text)` | PRESENT |

Remote posture failure: `pg_brand_offering_counts` is also executable by `anon`, which violates the authenticated-only grant contract.

## 10. SC-D Traceability

| Criterion | Status | Evidence |
|---|---|---|
| SC-D-1 | PASS | Remote versions 39/38/72/67; all `verify_jwt: true`; curl smokes non-404. |
| SC-D-2 | PASS | ORCH-0855 workflow reference absent; old A-07/A-13 not running in CI. |
| SC-D-3 | PASS | `orch-0963-public-trip-rpc-and-route-segregation.mjs` passes; C2/C4 preserved. |
| SC-D-4 | PASS | `meta-orch-0972-data-driven-tabs.mjs` exists, workflow-wired per review, and passes locally. |
| SC-D-5 | PASS | `meta-orch-0972-no-brand-kind-reads.mjs` exists, workflow-wired per review, and passes locally. |
| SC-D-6 | PASS | ORCH-0863 gate passes at branch HEAD. |
| SC-D-7 | PASS | Local source and remote deployed bundle contain restaurant/play `temporaryCategory` prompt context; no `UPDATE brands SET venue_category` found in parser source. |
| SC-D-8 | PASS | Implementor test passes; fails-on-revert probe independently verified. |
| SC-D-9 | PARTIAL | Deployed reachability and typed validation verified for all 4 functions; full authenticated popup-brand 200 parse was not run due missing live user JWT. |

## 11. D.5 Test Case Trace

| ID | Status | Notes |
|---|---|---|
| T-45 | PARTIAL | `parse-restaurant-menu` reached v39 and returned typed 401 with anon JWT; no popup-brand authenticated 200 run. |
| T-46 | PARTIAL | `parse-play-activities` reached v38 and returned typed 401 with anon JWT; no popup-brand authenticated 200 run. |
| T-47 | PARTIAL | `agent-chat` and `agent-confirm-action` reached v72/v67 and returned typed 401 validation; no authenticated tool execution run. |
| T-48 | PASS | Implementor fixture under `src/` and tester fixture under `app/` both make the no-kind gate return non-zero. |
| T-49 | PASS | No-kind gate passes clean at branch HEAD. |
| T-50 | PASS | Data-driven-tabs gate forbids `isTripBrand`; local gate passes at HEAD. |
| T-51 | PASS | Data-driven-tabs gate passes clean at branch HEAD. |
| T-52 | PASS | ORCH-0863 backend allowlist gate passes at branch HEAD. |
| T-53 | PASS | ORCH-0963 gate still enforces `pg_public_trips_by_brand` call. |
| T-54 | PASS | ORCH-0963 gate still enforces route segregation. |

## 12. Branch Protection Check Names

`gh api repos/Mingla-LLC/mingla-main/branches/main/protection/required_status_checks` returned `Branch not protected`. Repository rulesets list only an active `general security` branch ruleset with no required status-check rules. No pinned old `ORCH-0963: public brand page kind-branched` required check was found, and no orphaned old check pin needs orchestrator action based on current GitHub API state.

## 13. Final PR Squash Body Note

The final META-ORCH-0972 close PR squash body MUST contain:

```text
[TEST-MOD-APPROVED META-ORCH-0972]
```

This is cumulative across 13 pre-existing test-file modifications from Sub-B plus Sub-C. Without it, the tests-append-only gate is expected to reject the final close merge.

## 14. Required Rework

1. Fix the live and local Sub-C migration grant posture for `pg_brand_offering_counts(uuid)` so `anon` cannot execute it.
2. Add or update a regression test/probe that fails if `anon` retains EXECUTE on `pg_brand_offering_counts`.
3. Rerun this QA pass's focused gates plus anon/authenticated REST privilege probes.

## 15. Routing

Verdict is FAIL. Route to Codex `implementor-mingla` for narrowly scoped Sub-C grant rework before any final META-ORCH-0972 CLOSE sequencing or Stage 4 `DROP COLUMN brands.kind` decision.
