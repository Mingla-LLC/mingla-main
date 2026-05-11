# Implementation Report: Event Cover Video cancelled_at Schema Repair (ORCH-0776D)

> Date: 2026-05-10
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0776D_EVENT_COVER_VIDEO_JOBS_CANCEL_AT_AND_DETAIL_DEPLOY.md`
> Status: implemented, partially verified

## 1. Layman Summary

Added the missing `event_cover_video_jobs.cancelled_at` schema migration, a stuck-row backfill, a CI guard so edge functions cannot keep writing a missing column, and a regression test for the deployed-v2 no-detail error shape. This prepares the production unblock for organiser Step 4 cover-video uploads, but the live DB push and edge-function deploy are still pending under the standing deploy split.

## 2. Request And Context

- **Request:** Execute ORCH-0776D as Codex `implementor-mingla`.
- **Source:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0776D_EVENT_COVER_VIDEO_JOBS_CANCEL_AT_AND_DETAIL_DEPLOY.md`
- **Affected surfaces:** Supabase migration chain, event-cover video edge schema contract, strict-grep workflow, Mingla Business event-cover video service tests.
- **Related issues/artifacts:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0776D_EVENT_COVER_VIDEO_CANCEL_AT_MISSING_COLUMN.md`

## 3. Scope

- **In scope:** Add migration `20260515000014`, add strict-grep guard/job, add `test:orch-0776d`, add regression test for no-detail v2 fallback, run required local gates.
- **Out of scope:** ORCH-0776A progress UX, Giphy/Pexels, ticket checkout, public playback, brand/profile media, index contract changes.
- **Assumptions:** The operator will run `supabase db push --linked`; Codex/agent deploy of edge functions should happen only after DB migration confirmation.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0776D_EVENT_COVER_VIDEO_JOBS_CANCEL_AT_AND_DETAIL_DEPLOY.md` | Dispatch contract | Required migration, backfill, strict-grep, tests, deploy evidence. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0776D_EVENT_COVER_VIDEO_CANCEL_AT_MISSING_COLUMN.md` | Root-cause proof | Production misses `cancelled_at`; deployed functions are v2. |
| `supabase/functions/event-cover-video-upload-intent/index.ts` | Edge writer | Already writes `cancelled_at`; no code change required. |
| `supabase/functions/event-cover-video-cancel/index.ts` | Edge writer | Already writes `cancelled_at`; no code change required. |
| `supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql` | Current table source | Table had `completed_at` and `applied_at`, no `cancelled_at`. |
| `mingla-business/src/services/eventCoverVideoProcessingService.ts` | Client error mapping | Existing `job_insert_failed` maps to specific retry copy; unknown detail falls back to prepare copy. |
| `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts` | Regression target | Existing tests covered detail shape; added no-detail fallback. |
| `.github/workflows/strict-grep-mingla-business.yml` | CI registry | Added one modular strict-grep job. |
| `mingla-business/package.json` | Package gate registry | Added `test:orch-0776d`. |

## 5. Blast Radius

- **Direct changes:** One migration, one strict-grep script/job, one business test case, one package script.
- **Cascade changes:** Remote DB must receive migration before edge functions are redeployed.
- **Parity surfaces:** Mingla Business only for client error copy regression; Supabase edge schema for all event-cover video functions.
- **Cache impact:** None.
- **State boundaries:** DB owns job terminal/non-terminal truth; React Query/Zustand untouched.
- **Auth/RLS/security:** No RLS policy changes; service-role edge functions continue to mutate job rows.
- **Deploy path:** Operator runs `supabase db push --linked`, then event-cover video functions can be redeployed.

## 6. Old To New Receipts

### `supabase/migrations/20260515000014_orch_0776d_event_cover_video_cancelled_at.sql`

- **Before:** `event_cover_video_jobs` had no `cancelled_at` column despite two edge writers.
- **After:** Adds nullable `cancelled_at`, column comment, and backfills old non-terminal rows older than 10 minutes to `cancelled`.
- **Why:** Releases the active-job partial unique index by allowing cancel/supersede writes to succeed.
- **Approx lines changed:** 21 added.

### `.github/scripts/strict-grep/orch-0776d-cancelled-at-schema.mjs`

- **Before:** No CI guard tied `cancelled_at:` edge writes to a table declaration.
- **After:** Scans `supabase/functions/**/*.ts` for `cancelled_at:` and fails unless a migration declares `cancelled_at` on `event_cover_video_jobs`.
- **Why:** Prevents future schema/code drift on this launch-blocking contract.
- **Approx lines changed:** 68 added.

### `.github/workflows/strict-grep-mingla-business.yml`

- **Before:** Strict-grep registry did not include ORCH-0776D.
- **After:** Adds registry comment and job `orch-0776d-cancelled-at-schema`.
- **Why:** Runs the new parity guard in CI.
- **Approx lines changed:** 12 added.

### `mingla-business/package.json`

- **Before:** No `test:orch-0776d` command.
- **After:** Adds strict-grep plus focused Jest command.
- **Why:** Gives implementor/tester a repo-running regression gate.
- **Approx lines changed:** 1 script added.

### `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts`

- **Before:** Detail-bearing `job_insert_failed` behavior was covered; no-detail v2 fallback was not explicitly locked.
- **After:** Adds test for `{ error: "internal_error" }` with no detail and `context.status = 500`.
- **Why:** Preserves fallback copy while deployed v2 functions remain live.
- **Approx lines changed:** 34 added.

## 7. Implementation Details

- **Architecture decisions:** Left edge function writers unchanged per prompt; fixed schema-side contract.
- **Data flow:** Supersede/cancel updates can now set `status='cancelled'` and `cancelled_at`, then new upload-intent inserts can proceed.
- **Mutation/query behavior:** No client query changes.
- **State handling:** No local state changes.
- **Error handling:** Tests now cover both `detail: "job_insert_failed"` and no-detail internal errors.
- **Copy/accessibility:** No UI copy changes.
- **Analytics/notifications/realtime:** Not touched.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Add migration `20260515000014` | Yes | File created; local/remote migration list shows local row only. | Partial |
| Backfill stuck non-terminal rows | Yes in migration | Not run remotely; row count pending DB push output. | Pending live gate |
| Do not change upload-intent/cancel writers | Yes | Read files; no edits made to those functions in this slice. | Passed |
| Redeploy five event-cover video functions | No | Blocked by standing deploy split until DB push confirmation. | Pending live gate |
| Add regression tests | Yes | `npm run test:orch-0776a`, `npm run test:orch-0776d` pass. | Passed |
| Add strict-grep guard/job | Yes | Guard passes locally and is wired into workflow. | Passed |
| Run required gates | Mostly | Jest, strict-grep, tsc, diff check, Deno check passed. | Partial because live DB/deploy SQL gates pending |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| One DB truth for persisted job status | Yes | Yes | Migration updates persisted job rows directly. |
| No silent failures | Yes | Yes | Schema fix enables existing cancel writes; test covers diagnostic fallback. |
| React Query owns server cache | No | Yes | No cache changes. |
| RLS/security | Yes | Yes | No direct client mutation policies added. |
| Monotonic migration | Yes | Yes | Local max was `20260515000013`; new prefix is `20260515000014`. Remote list also shows `20260515000014` absent. |

## 10. Parity Check

- **Mobile:** Mingla Business service tests pass.
- **Business app:** `test:orch-0776d` added and passed.
- **Admin:** Not affected.
- **Public/web:** Not affected.
- **Solo/collab:** Not affected.
- **Gaps:** Live dev-build Step 4 upload still requires DB push and edge deploy before manual validation.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** DB gains nullable `cancelled_at`; edge writers already send this field.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** No app startup changes.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| ORCH-0776A regression | `cd mingla-business && npm run test:orch-0776a` | PASS | 10 tests passed; Watchman recrawl warning only. |
| ORCH-0776D regression | `cd mingla-business && npm run test:orch-0776d` | PASS | Strict-grep passed; 10 tests passed. |
| TypeScript | `cd mingla-business && npx tsc --noEmit` | PASS | No output. |
| Diff whitespace | `git diff --check` | PASS | No output. |
| Deno edge check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-upload-intent/index.ts supabase/functions/event-cover-video-cancel/index.ts supabase/functions/event-cover-video-status/index.ts supabase/functions/event-cover-video-apply/index.ts supabase/functions/event-cover-video-webhook/index.ts` | PASS | All five files checked. |
| Linked migration list | `/Users/sethogieva/bin/supabase migration list --linked` | READ PASS | Shows `20260515000014` local only; not remote. |
| Functions pre-deploy list | `/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv` | READ PASS | All five event-cover video functions are still v2. |

## 13. Regression Surface

1. Event-cover video upload intent superseding active jobs.
2. Manual event-cover video cancel.
3. Event-cover video partial unique index release.
4. Client upload-intent error copy and request-id diagnostics.
5. Strict-grep CI runtime for migration/function drift.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| DB migration not pushed | Production remains blocked until `cancelled_at` exists and stuck rows are backfilled. | Operator runs `/Users/sethogieva/bin/supabase db push --linked` and confirms `20260515000014` remote. | `supabase/migrations/20260515000014_orch_0776d_event_cover_video_cancelled_at.sql` |
| Edge functions not redeployed | Diagnostic detail slugs remain stale v2 in production. | Deploy all five event-cover video functions after DB push. | `supabase/functions/event-cover-video-*` |
| Backfill row count unavailable | Cannot prove stuck production rows changed. | Capture `supabase db push` migration output and run status count SQL. | Live DB |

## 15. Discoveries For Orchestrator

- The worktree already contained broad unrelated ORCH-0776A/0777 and artifact edits before this slice. This implementation avoided reverting or normalizing them.

## 16. Deploy Notes

- **Migrations:** Pending operator command: `/Users/sethogieva/bin/supabase db push --linked`, then `/Users/sethogieva/bin/supabase migration list --linked` must show `20260515000014` on remote.
- **Edge functions:** After DB push, deploy:
  - `/Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv`
  - `/Users/sethogieva/bin/supabase functions deploy event-cover-video-status --project-ref gqnoajqerqhnvulmnyvv`
  - `/Users/sethogieva/bin/supabase functions deploy event-cover-video-apply --project-ref gqnoajqerqhnvulmnyvv`
  - `/Users/sethogieva/bin/supabase functions deploy event-cover-video-cancel --project-ref gqnoajqerqhnvulmnyvv`
  - `/Users/sethogieva/bin/supabase functions deploy event-cover-video-webhook --project-ref gqnoajqerqhnvulmnyvv`
- **Confirmation SQL:** Run after DB push:
  `SELECT status, count(*) FROM event_cover_video_jobs GROUP BY status;`
- **Mobile OTA/native:** None.
- **Business/admin web:** No deploy required beyond normal app/test lifecycle.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
supabase: restore event cover video cancellation column

Resolves: ORCH-0776D
Evidence: npm run test:orch-0776a; npm run test:orch-0776d; npx tsc --noEmit; git diff --check; deno check event-cover video functions
Deploy: operator must push migration 20260515000014, then redeploy five event-cover video edge functions
```

## Ready-To-Test Checklist

1. Operator runs `/Users/sethogieva/bin/supabase db push --linked`; expected migration output includes `20260515000014` and stuck-row backfill count.
2. Operator runs `/Users/sethogieva/bin/supabase migration list --linked`; expected remote column includes `20260515000014`.
3. Deploy five event-cover video functions; expected functions list shows event-cover-video upload/status/apply/cancel at v3 and webhook bumped if deploy creates a new version.
4. Run `SELECT status, count(*) FROM event_cover_video_jobs GROUP BY status;`; expected old stuck non-terminal rows older than 10 minutes are now `cancelled`.
5. Run Step 4 video upload on the dev build; expected logs reach `upload-intent-ready`, `source-upload-start`, real progress 0 to 100%, then provider-processing copy with no valid-clip prepare toast.
