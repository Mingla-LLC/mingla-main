# QA Report: ORCH-0957 Storage Image Transformation Overage

> Date: 2026-05-25
> Mode: TARGETED + SPEC-COMPLIANCE
> Verdict: CONDITIONAL PASS
> Findings: P0:0 P1:0 P2:0 P3:2 P4:4

## 1. Layman Summary

ORCH-0957 passes the backend QA gate with one accepted deferral: SC-5 is intentionally operator-verified at billing-day +14 because the Supabase billing meter cannot prove a 7-day plateau on deploy day. The implementation now writes thumbnails, rewrites collage reads to non-metered object URLs by default, preserves an emergency legacy fallback, and provides a deployed backfill function without running the historical backfill. Tester added and pushed the mandatory adversarial T-05 regression test at commit `9f91f6448`; it fails when the ORCH-0957 image-collage implementation is reverted.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0957_STORAGE_IMAGE_TRANSFORM_OVERAGE.md`
- Investigation: `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-0957_STORAGE_IMAGE_TRANSFORM_OVERAGE.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0957_STORAGE_IMAGE_TRANSFORM_OVERAGE.md`
- Deploy report: `Mingla_Artifacts/reports/DEPLOY_ORCH-0957_STORAGE_IMAGE_TRANSFORM_OVERAGE.md`
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/0957-[storage-image-transform-overage]`
- Branch: `0957-storage-image-transform-overage`
- Implementation commit under test: `1b32c3c0`
- Tester regression commit: `9f91f6448`

## 3. Targeted 10-Step Protocol Result

| Step | Result | Evidence |
|---|---|---|
| 1. Blast radius | PASS | Backend-only: migration, `_shared/imageCollage.ts`, `_shared/photoStorageService.ts`, new `backfill-place-photo-thumbs`, strict-grep CI. No client surface per spec. |
| 2. Implementation report audit | PASS | Claims cross-checked against code, tests, Supabase SQL, function list, and verify-first-call curl. |
| 3. Forensic code reading | PASS | URL rewrite, fallback path, ingest thumb generation, backfill fetch path, auth gate, and run controls inspected. |
| 4. Constitution enforcement | PASS | No user-facing surface; no silent success on failed thumbs; warnings/logged errors retained; one source of truth remains `place_pool.stored_photo_urls` plus derivable thumb path. |
| 5. Behavioral contract | PASS | Cost-control contract is object endpoint by default; legacy transform exists only behind `USE_PLACE_PHOTO_THUMBS=false` or missing-thumb fallback. |
| 6. Independent test writing | PASS | Added `supabase/functions/_shared/__tests__/imageCollage.thumbFallback.test.ts` with both fallback env settings. |
| 7. Parity | PASS / N/A | Backend-only ORCH; client parity explicitly out of scope by spec and dispatch. |
| 8. UI/UX audit | N/A | No client screen or admin UI changed. |
| 9. Cross-domain impact | PASS | Direct deployed consumers verified: `run-place-intelligence-trial`, `backfill-place-photos`, and new backfill function. |
| 10. Pattern compliance | PASS | New function mirrors `backfill-place-photos` action vocabulary and auth shape; CI allowlist covers backend files. |

## 4. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `supabase/migrations/20260727000001_orch_0957_place_pool_thumbs_backfilled_at.sql` | Column, partial index, monotonic migration ordering, remote baseline count. |
| Edge/RPC | `_shared/imageCollage.ts`, `_shared/photoStorageService.ts`, `backfill-place-photo-thumbs/index.ts` | Auth, URL rewriting, missing-thumb fallback, non-fatal thumb errors, object-only backfill fetches, resumability. |
| Services/Hooks/State | N/A | No client or service-layer change. |
| Components/Screens | N/A | Backend-only, no UI shipped. |
| Business/Admin/Public parity | N/A | No client surface; admin uses existing action invocation pattern. |
| Tests/Build | Deno tests, Deno check, strict-grep scripts, Supabase function list, curls | 19 Deno tests pass; strict-grep gates pass; functions active and reachable. |

## 5. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Ingest writes original plus thumb and stamps `thumbs_backfilled_at` when thumbs succeed | `photoStorageService.ts:50-60`, `101-150`, `168-178`; `photoStorageService.test.ts:60-85` | Verified source + unit | Production fresh-place mutation not run by tester. |
| Thumb generation failure is non-fatal and keeps place pending | `photoStorageService.ts:130-142`, `171-174`; `photoStorageService.test.ts:87-110` | Verified | Original URL still stored; `thumbs_backfilled_at` remains unset. |
| Supabase object URL defaults to `_thumb.jpg` with no transform params | `imageCollage.ts:70-111`; `imageCollage.test.ts:24-68` | Verified | Default uses object endpoint and strips query strings. |
| Legacy mode still restores render endpoint | `imageCollage.ts:88-111`; `imageCollage.test.ts:49-55` | Verified | Required emergency revert lever. |
| Missing thumb fallback obeys `THUMB_404_FALLBACK_TO_TRANSFORM` | `imageCollage.ts:128-190`; T-05 at `imageCollage.thumbFallback.test.ts:43-122` | Verified | New tester-owned adversarial regression. |
| Backfill fetches originals only via object endpoint | `backfill-place-photo-thumbs/index.ts:59-194`; `index.test.ts:70-101` | Verified | No `/render/image/` in backfill fetch path. |
| Backfill action vocabulary exists | `backfill-place-photo-thumbs/index.ts:552-619` | Verified | Includes preview, create, run, status, active, pause, resume, cancel, retry, skip. |
| Remote migration applied | Supabase SQL probe | Verified | Column exists, partial index exists, pending count is 18,560. |
| Required functions deployed | Supabase CLI function list and curl | Verified | 3 functions active; unauthenticated POST returns 401 not 404. |
| SC-5 billing meter drop | Spec defers to billing-day +14 | Deferred accepted | Does not block this verdict per dispatch. |

## 6. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Deno type gate | `/Users/sethogieva/.deno/bin/deno check ...` | PASS | Checked `imageCollage.ts`, `photoStorageService.ts`, `backfill-place-photo-thumbs/index.ts`, and T-05 test file. |
| Deno tests | `/Users/sethogieva/.deno/bin/deno test --allow-net --allow-env ...` | PASS | 19 passed, 0 failed. |
| ORCH-0957 strict-grep | `node .github/scripts/strict-grep/orch-0957-no-metered-place-photo-reads.mjs` | PASS | No render endpoint outside allowlisted fallback. |
| ORCH-0863 backend allowlist gate | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | C7 passes with ORCH-0957 backend files allowlisted. |
| Migration list | `/Users/sethogieva/bin/supabase migration list --linked` | PASS | Local and remote include `20260727000001`; no remote-only gap shown. |
| Remote column | Supabase MCP SQL | PASS | `thumbs_backfilled_at`, `timestamp with time zone`, nullable YES. |
| Remote partial index | Supabase MCP SQL | PASS | `place_pool_thumbs_backfill_pending_idx` exists with pending-thumb predicate. |
| Pending baseline | Supabase MCP SQL | PASS | `pending_thumbs = 18560`. |
| Edge functions active | `supabase functions list --project-ref gqnoajqerqhnvulmnyvv` | PASS | `backfill-place-photo-thumbs` v1, `run-place-intelligence-trial` v157, `backfill-place-photos` v192 active. |
| Verify-first-call | 3 unauthenticated curls | PASS | All returned HTTP 401 with `UNAUTHORIZED_NO_AUTH_HEADER`, not 404. |
| T-05 fails-on-revert | Temp worktree at `9f91f6448`, checkout `1b32c3c0^ -- imageCollage.ts`, run T-05 | PASS | Expected FAIL observed: both T-05 cases failed because reverted code produced direct render URLs. |

## 7. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| SC-1 - new ingest writes original + thumb and stamps DB | PASS (source + unit) | `photoStorageService.ts:101-150`, `168-178`; test `photoStorageService.test.ts:60-85` | No production ingest mutation run by tester. |
| SC-2 - default transform helper returns object thumb URL | PASS | `imageCollage.ts:81-100`; tests `imageCollage.test.ts:24-68` | None. |
| SC-3 - `USE_PLACE_PHOTO_THUMBS=false` restores legacy render | PASS | `imageCollage.ts:88-111`; test `imageCollage.test.ts:49-55` | None. |
| SC-4 - backfill fetches object endpoint only | PASS | `backfill-place-photo-thumbs/index.ts:149-158`; test `index.test.ts:70-101` | None. |
| SC-5 - billing meter under 100 after 7-day window | DEFERRED ACCEPTED | Spec and dispatch explicitly defer to billing-day +14 | Operator billing dashboard check; not a blocker. |
| SC-6 - compose avoids memory crash on thumbs | PASS (structural) / runtime deferred | `imageCollage.ts:160-245` serial decode + thumb URL rewrite; Deno tests exercise compose | 100-run production memory log check deferred until after operator backfill creates a known backfilled 16-photo target. |
| SC-7 - missing thumb does not crash; fallback obeys env | PASS | `imageCollage.ts:166-178`; T-05 `imageCollage.thumbFallback.test.ts:43-122` | Runtime delete-thumb test intentionally not run on production storage. |
| SC-8 - remote column/index and baseline exist | PASS | Supabase MCP SQL | Pending baseline 18,560; monotonic decrease is post-backfill operator check. |

## 8. Security

| Check | Severity | Evidence | Result |
|---|---|---|---|
| Backfill function requires auth before actions | P0 gate | `backfill-place-photo-thumbs/index.ts:567-585`; unauthenticated curl returned 401 | PASS |
| Admin access required | P0 gate | Active `admin_users` lookup at `index.ts:577-585` | PASS |
| Service-role DB/storage use server-side only | P0 gate | `index.ts:556-560`; no client surface changed | PASS |
| No secret/PII logging introduced | P2 | Logs include paths/errors, not tokens/API keys | PASS |
| RLS inheritance | P2 | New nullable column on `place_pool`, service-role updates only; no new public policy | PASS |

## 9. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | N/A | No UI. |
| One owner per truth | PASS | Original URL remains stored; thumb URL is derivable convention. |
| No silent failures | PASS | Thumb and fetch failures warn; failed place stays pending. |
| One key per entity | N/A | No cache keys. |
| Server state server-side | PASS | Entire change is backend. |
| Logout clears everything | N/A | No persisted client state. |
| Label temporary | PASS | ORCH comments explain cost-control purpose and fallback. |
| Subtract before adding | PASS | Metered default path removed before new backfill operation. |
| No fabricated data | PASS | No user data surfaced. |
| Currency-aware | N/A | No money display. |
| One auth instance | PASS | Edge function uses Supabase auth plus admin check. |
| Validate at right time | PASS | Missing action and auth fail before privileged actions. |
| Exclusion consistency | N/A | Not affected. |
| Persisted-state startup | N/A | Not affected. |

## 10. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Supabase backend | Yes | PASS | Only in-scope surface. |
| Mobile iOS/Android | No | N/A | Backend-only per spec and dispatch. |
| Business iOS/Android/Web | No | N/A | No client reads or writes `place-photos`. |
| Admin Web | No | N/A | No dedicated screen added; function callable through existing run tooling or curl. |
| Solo/collab | No | N/A | Server-side place intelligence has no solo/collab dimension. |

## 11. Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

None.

### P3 Low

**P3-001: SC-5 is time-gated and accepted as deferred.**
- Evidence: Spec SC-5 requires billing-day +14 dashboard verification; dispatch explicitly says do not block PASS on SC-5.
- Impact: Close can proceed, but cost-control is not financially proven until the next billing observation window.
- Required action: Operator checks Supabase Storage Image Transformations at billing-day +14 after deploy/backfill completion.

**P3-002: Production 100-run memory proof was not executed before backfill.**
- Evidence: SC-6 requires a 16-photo backfilled place and 100 consecutive compose runs; historical backfill was explicitly not to be run by tester.
- Impact: Structural evidence is strong, but production log proof remains a post-backfill confidence check.
- Required action: After backfill, run the SC-6/T-09 log check against a known 16-photo place if orchestrator wants runtime proof beyond source/tests.

### P4 Notes

- T-05 was added in a separate tester commit `9f91f6448` and pushed to `origin/0957-storage-image-transform-overage`.
- The T-05 fails-on-revert proof used `1b32c3c0^` for `imageCollage.ts`; both T-05 cases failed as expected.
- COMMS-0002 was factored in: ORCH-0863 backend allowlist gate passes locally.
- COMMS-0003 was factored in: D-1 metering-doc invariant broadening remains for orchestrator CLOSE.

## 12. Required Actions

None for implementor. No P0/P1/P2 rework required.

## 13. Conditional / Operator Actions

1. SC-5: Operator verifies the Supabase Storage Image Transformations meter at billing-day +14; accepted deferral, not a close blocker.
2. Historical backfill: Operator runs `backfill-place-photo-thumbs` after this CONDITIONAL PASS; tester did not execute the ~5 hour operation.
3. SC-8 post-backfill: Confirm pending count decreases monotonically from 18,560 during batches.
4. Optional SC-6/T-09 runtime confidence: After backfill, run compose against a known 16-photo place and confirm no `WORKER_RESOURCE_LIMIT 546` in edge logs.

## 14. Discoveries For Orchestrator

- D-1 from investigation remains valid: broaden `I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED` to include "metering" as part of CLOSE.
- No new cross-ORCH comms-ledger entry was needed.

## 15. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| Missing tester-owned adversarial T-05 | Yes | `supabase/functions/_shared/__tests__/imageCollage.thumbFallback.test.ts`; commit `9f91f6448` | Fails on revert verified. |

Retest cycle: N/A.
