# Implementation Report: ORCH-0978 IMPLEMENT-3 Webhook job_id Recovery

> Date: 2026-05-27
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` §SPEC AMENDMENT 5
> Status: implemented and verified

## 1. Layman Summary

Cloudinary can now finish business event-cover video uploads even when its eager callback omits `context`. The webhook recovers the job id from the last UUID segment of `public_id`, so processed videos can reach `ready` instead of staying stuck at `source_uploaded`.

## 2. Request And Context

- **Request:** Execute IMPLEMENT-3 for ORCH-0978 per SPEC AMENDMENT 5.
- **Source:** Approved orchestrator review `Mingla_Artifacts/reports/REVIEW_ORCH-0978_SPEC_AMENDMENT_5.md`.
- **Affected surfaces:** Supabase edge function webhook, strict-grep CI, Deno regression tests.
- **Related artifacts:** `INVESTIGATION_ORCH-0978_WEBHOOK_400.md`, `QA_ORCH-0978_IMPLEMENT_2_LIVE_FIRE.md`.

## 3. Scope

- **In scope:** Backend webhook fallback, strict-grep C5, Deno regression test, backend allowlist.
- **Out of scope:** Client code, SPEC edits, migrations, Supabase deploy, PR open, database push.
- **Assumptions:** Orchestrator owns the six-function deploy and post-deploy curl probe.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Required entry scan | COMMS-0002/0003/0004 WARN entries acknowledged for this pass. |
| `SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | Binding contract | AMENDMENT 5 requires public_id fallback, C5 strict-grep, 5-scenario Deno test. |
| `INVESTIGATION_ORCH-0978_WEBHOOK_400.md` | Root cause | Eager callback omits context; `public_id` contains the job UUID. |
| `QA_ORCH-0978_IMPLEMENT_2_LIVE_FIRE.md` | Failing evidence | Job `dde19eac-...` stuck at `source_uploaded`; webhook returned 400. |
| `REVIEW_ORCH-0978_SPEC_AMENDMENT_5.md` | Review guidance | Consolidate `isValidUuid` import; credit UUID hardening. |
| `event-cover-video-webhook/index.ts` | Change site | Existing helper trusted context only. |
| `event-cover-video-upload-intent/index.ts` | Public_id contract | Template is `event-covers/raw/${brandId}/${eventId}/${job.id}`. |
| `orch-0978-video-cap-29s.mjs` | C5 gate target | Existing C1-C4 extended in-place. |
| `orch-0863-marketing-hub-phase-b.mjs` | Backend allowlist | Webhook source and new test were not allowlisted before this pass. |

## 5. Blast Radius

- **Direct changes:** Webhook job id extraction; strict-grep scripts; new Deno test.
- **Cascade changes:** Orchestrator must redeploy all six event-cover-video functions.
- **Parity surfaces:** Business iOS/Android/Web benefit through the server path; no client code changed.
- **Cache impact:** None.
- **State boundaries:** Webhook remains the only writer for processed video job completion.
- **Auth/RLS/security:** Cloudinary signature verification path preserved; webhook `verify_jwt = false` preserved in `supabase/config.toml`.
- **Deploy path:** Orchestrator-owned edge deploy only; no migration.

## 6. Old To New Receipts

### `supabase/functions/event-cover-video-webhook/index.ts`

- **Before:** `contextValue(payload, "job_id")` returned 400 when eager callbacks omitted `context`.
- **After:** `recoverJobIdFromPayload` validates context UUID first, then falls back to the last UUID segment of `payload.public_id`.
- **Why:** Cloudinary eager callbacks include `public_id` but not the context field this webhook was depending on.
- **Approx lines changed:** +39 / -5.

### `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`

- **Before:** C1-C4 covered video duration cap invariants only.
- **After:** C5 enforces upload-intent public_id template and webhook parser alignment.
- **Why:** Prevents future template/parser drift.
- **Approx lines changed:** +19.

### `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts`

- **Before:** No webhook-specific regression test existed.
- **After:** Five Deno scenarios cover public_id fallback, context precedence, malformed public_id, missing identifiers, and legacy pipe context.
- **Why:** Fails on the exact old behavior and passes on the new recovery path.
- **Approx lines changed:** +213.

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

- **Before:** ORCH_0978_BACKEND_ALLOWLIST omitted webhook source and test path.
- **After:** Both paths are allowlisted.
- **Why:** Keeps the global backend-touch gate green for this scoped backend fix.
- **Approx lines changed:** +2.

## 7. Implementation Details

Helper shape shipped verbatim:

```ts
export const recoverJobIdFromPayload = (payload: Record<string, unknown>): string | null => {
  const fromContext = contextValue(payload, "job_id");
  if (fromContext !== null && isValidUuid(fromContext)) return fromContext;

  const publicId = typeof payload.public_id === "string" ? payload.public_id : null;
  if (publicId === null) return null;
  const lastSegment = publicId.split("/").at(-1) ?? null;
  if (lastSegment === null) return null;
  return isValidUuid(lastSegment) ? lastSegment : null;
};
```

Context wins over `public_id`, preserving the old contract. The new UUID validation also hardens the old context path: malformed context job ids now get the clean `job_id_missing` 400 path instead of reaching a DB lookup that would fail later.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Item 1 webhook public_id fallback | Yes | Deno scenario 1 PASS | PASS |
| Item 2 failed-derivative path intact | Yes, no new code needed | Deno scenario 2 writes failed status with `processed_url_invalid` | PASS |
| Item 3 strict-grep C5 | Yes | `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` PASS C1-C5 | PASS |
| Item 4 five-scenario Deno test | Yes | `deno test --allow-env ...job-id-recovery.test.ts` 5/5 PASS | PASS |
| Item 5 historical cleanup probe | Re-probed | `stuck_count = 1`, known tester job only | PASS, cleanup not mutated |
| Item 6 deploy discipline | Not deployed by implementor | Current versions recorded for orchestrator | READY FOR ORCH |
| Item 7 regression-test contract | Yes | Fails-on-revert PASS/FAIL/PASS documented below | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| No silent failures | Yes | Yes | Missing identifiers now log `job_id_extraction_failed`. |
| One owner per truth | Yes | Yes | Webhook remains sole processed-job writer; C5 guards parser/template coupling. |
| External API docs verified | Yes | Yes | Spec cited Cloudinary notification/eager docs; code follows eager payload shape. |
| Preserve user work | Yes | Yes | Pre-existing dirty client files were not staged or modified. |
| Backend-only scope | Yes | Yes | No `app-mobile/`, `mingla-business/src/`, or `mingla-admin/` changes in IMPLEMENT-3 commits. |

## 10. Parity Check

- **Mobile:** Business iOS/Android benefit through backend; consumer app untouched.
- **Business app:** No client edit; poller should now see webhook-ready jobs after deploy.
- **Admin:** No change.
- **Public/web:** Buyer surfaces only consume the resulting processed URL.
- **Solo/collab:** N/A.
- **Gaps:** Physical-device and live Cloudinary retest remain tester/orchestrator responsibilities after deploy.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Edge handler remains stateless.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-webhook/index.ts supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts` | PASS | No type errors. |
| Deno regression | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts` | PASS | 5 passed, 0 failed. |
| Strict-grep ORCH-0978 | `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | PASS | C1-C5 all green. |
| Strict-grep ORCH-0863 | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | C7 green with 76 changed files in branch diff. |
| Whitespace | `git diff --check` | PASS | No output. |
| Zero-touch event-cover functions | `git diff --name-only HEAD~2..HEAD -- event-cover-video-source-uploaded/status/apply/cancel/upload-intent index.ts` | PASS | Empty output; only webhook source changed. |
| Client zero-touch | `git diff --name-only HEAD~2..HEAD -- app-mobile mingla-business/src mingla-admin supabase/config.toml` | PASS | Empty output. |
| Webhook verify_jwt | `rg -n "event-cover-video-webhook|verify_jwt" supabase/config.toml` | PASS | `[functions.event-cover-video-webhook] verify_jwt = false`; config not touched. |
| F-5 re-probe | Supabase MCP read-only SQL | PASS | `stuck_count = 1`; row is known job `dde19eac-9810-4e0d-b8f6-63fe235fc5af`. |
| Edge inventory | Supabase MCP `list_edge_functions` | PASS | Current: upload-intent v95 true, source-uploaded v81 true, status v93 true, apply v91 true, cancel v91 true, webhook v120 false. |

### Five-scenario Deno results

1. Eager notification without context and valid public_id: PASS, HTTP 200, lookup used parsed job UUID, ready update path reached.
2. Eager notification with context plus conflicting public_id: PASS, context UUID won, existing failed-derivative status write stayed intact.
3. Malformed public_id: PASS, HTTP 400 `job_id_missing`, `job_id_extraction_failed` warning fired.
4. Missing context and public_id: PASS, HTTP 400 `job_id_missing`.
5. Legacy pipe-delimited context: PASS, HTTP 200, ready update path reached.

### Fails-on-revert proof

| Phase | Git hash at local phase | Command | Result |
|---|---|---|---|
| PASS fixed code | `7728cddee204c5b1c3d8b25d1c9daf16ce0e2abc` | `deno test --allow-env ...job-id-recovery.test.ts` | PASS, 5/5 |
| FAIL with fallback removed | `7728cddee204c5b1c3d8b25d1c9daf16ce0e2abc` | Temporarily replaced public_id fallback branch with `return null`, then reran test | FAIL, scenario 1 expected 200 and received 400 |
| PASS restored | `7728cddee204c5b1c3d8b25d1c9daf16ce0e2abc` | Restored public_id branch and reran test | PASS, 5/5 |

The same hash appears for the three local phases because the revert was intentionally uncommitted to preserve the required two-commit landing pattern. The committed test carrier is `4d2896d3293fcc2767a4729d94f462cd709efa10`.

## 13. Regression Surface

1. Webhook context parsing: context still wins and legacy pipe-delimited context still works.
2. Malformed callbacks: invalid/missing job ids remain HTTP 400 but now emit a diagnostic stage.
3. Failed derivative handling: existing status=`failed` update path remains intact when job id is identifiable.
4. Strict-grep CI: ORCH-0978 C5 and ORCH-0863 C7 now cover this backend touch.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Live deploy pending | Production webhook remains v120 until orchestrator deploys | Batch deploy all six event-cover-video functions | Orchestrator |
| Known stuck tester job | `dde19eac-...` remains `source_uploaded` | Orchestrator/tester may cancel or supersede during retest | Supabase data |
| Live happy path untested after deploy | Deno proves logic, not live Cloudinary callback | Tester T-1 through T-5 after deploy | Tester |

## 15. Discoveries For Orchestrator

- F-5 re-probe now returns `stuck_count = 1`, not zero; the single row is the known tester live-fire job `dde19eac-9810-4e0d-b8f6-63fe235fc5af`. I left it untouched because cleanup was optional in the dispatch and this pass did not require live mutation or Cloudinary destroy to prove the fix.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** Orchestrator should deploy all six event-cover-video functions exactly as SPEC §D Item 6 says. Expected bumps from current inventory: upload-intent v95→v96, source-uploaded v81→v82, status v93→v94, apply v91→v92, cancel v91→v92, webhook v120→v121. Preserve `verify_jwt`: webhook false, the other five true.
- **Mobile OTA/native:** No IMPLEMENT-3 client changes; ORCH close still owns EAS OTA because prior IMPLEMENT phases touched business client.
- **Business/admin web:** No IMPLEMENT-3 web/client changes.
- **Env vars/secrets:** No changes.
- **Post-deploy probe:** Send the SPEC curl with valid HMAC, missing context, and missing public_id; confirm v121 logs `stage: "job_id_extraction_failed"`.

## Commit Summary

```text
7728cddee204c5b1c3d8b25d1c9daf16ce0e2abc
ORCH-0978 IMPLEMENT-3 step 1: recover webhook job id from Cloudinary public_id
2 files changed, 53 insertions(+), 5 deletions(-)

4d2896d3293fcc2767a4729d94f462cd709efa10
ORCH-0978 IMPLEMENT-3 step 2: cover webhook job-id recovery with Deno tests
2 files changed, 215 insertions(+)
```

## Ready-To-Test Checklist

1. Orchestrator reviews this report and the two commits.
2. Orchestrator deploys all six event-cover-video functions and confirms webhook remains `verify_jwt = false`.
3. Orchestrator runs the one webhook v121 diagnostic curl probe for `job_id_extraction_failed`.
4. Tester retests T-1 through T-5, plus Seth physical iPhone and one adversarial test from SPEC §D Item 7.
