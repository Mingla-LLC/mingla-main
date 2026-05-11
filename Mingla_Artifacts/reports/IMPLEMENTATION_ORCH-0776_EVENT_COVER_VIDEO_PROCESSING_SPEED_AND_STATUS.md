# IMPLEMENTATION ORCH-0776 — Event Cover Video Processing Speed And Status Bridge

Date: 2026-05-11
Owner: Codex `implementor-mingla`
Status: implemented, partially verified
Working tree: `.worktrees/orch-0776-event-cover-video-processing-speed/`

## Summary

Implemented the ORCH-0776 event-cover video processing status bridge across Mingla Business and Supabase Edge. The app now acknowledges successful Cloudinary source upload back to Mingla, reads enriched job status payloads, carries last known status through client polling timeouts, and renders inline recovery actions instead of the old toast-only dead end.

REWORK on 2026-05-11 addressed the mingla-tester FAIL findings: the webhook ready update no longer writes the non-live `processed_at` column, the flaky timeout test no longer asserts an exact one-millisecond polling count, and the ORCH-0776 strict-grep guard is registered in CI. Runtime live-fire speed proof is not complete in this implementation turn because the new Edge function is not deployed from an unmerged worktree, and the deploy split requires the branch to be merged/closed before production Edge deployment. Static, TypeScript, Jest, and Deno gates pass; tester must run the real phone/video/provider journey after deploy.

## Files Changed

Baseline event-cover video files restored into this ORCH worktree because it was created from `origin/main`, which did not contain the local event-cover video baseline that the approved ORCH-0776 spec cites:

- `.github/scripts/strict-grep/orch-0770-event-cover-video-processing.mjs`
- `.github/scripts/strict-grep/orch-0776a-video-upload-progress-honesty.mjs`
- `.github/scripts/strict-grep/orch-0776d-cancelled-at-schema.mjs`
- `.github/workflows/strict-grep-mingla-business.yml`
- `mingla-business/package.json`
- `mingla-business/package-lock.json`
- `mingla-business/src/components/event/CreatorStep4Cover.tsx`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/src/components/event/types.ts`
- `mingla-business/src/components/ui/EventCoverMedia.tsx`
- `mingla-business/src/components/ui/Icon.tsx`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- `mingla-business/src/context/AuthContext.tsx`
- `mingla-business/src/services/eventCoverFileReader.ts`
- `mingla-business/src/services/eventCoverMediaService.ts`
- `mingla-business/src/services/eventCoverVideoProcessingService.ts`
- `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts`
- `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts`
- `mingla-business/src/utils/authReadiness.ts`
- `mingla-business/src/utils/eventCoverMediaRules.ts`
- `mingla-business/src/utils/eventCoverNativeVideo.ts`
- `mingla-business/src/utils/__tests__/authReadiness.test.ts`
- `mingla-business/src/utils/__tests__/eventCoverNativeVideo.test.ts`
- `supabase/config.toml`
- `supabase/functions/_shared/eventCoverVideo.ts`
- `supabase/functions/_shared/eventCoverVideo.test.ts`
- `supabase/functions/event-cover-video-apply/index.ts`
- `supabase/functions/event-cover-video-cancel/index.ts`
- `supabase/functions/event-cover-video-status/index.ts`
- `supabase/functions/event-cover-video-upload-intent/index.ts`
- `supabase/functions/event-cover-video-webhook/index.ts`
- `supabase/migrations/20260515000010_orch_0766f_event_cover_quicktime_mime.sql`
- `supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql`
- `supabase/migrations/20260515000014_orch_0776d_event_cover_video_cancelled_at.sql`

New/updated ORCH-0776 status-bridge files:

- `supabase/functions/event-cover-video-source-uploaded/index.ts`
- `supabase/functions/_shared/eventCoverVideo.ts`
- `supabase/functions/event-cover-video-status/index.ts`
- `supabase/functions/event-cover-video-webhook/index.ts`
- `supabase/functions/event-cover-video-apply/index.ts`
- `supabase/functions/event-cover-video-cancel/index.ts`
- `mingla-business/src/services/eventCoverVideoProcessingService.ts`
- `mingla-business/src/components/event/CreatorStep4Cover.tsx`
- `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts`
- `.github/scripts/strict-grep/orch-0776-video-processing-status-bridge.mjs`
- `mingla-business/package.json`
- `.github/workflows/strict-grep-mingla-business.yml`

REWORK-specific changes:

- `supabase/functions/_shared/eventCoverVideo.ts` removes `processedAt`/`processed_at` from the status payload and adds `eventCoverVideoReadyUpdate()` as the single ready-update column set.
- `supabase/functions/event-cover-video-webhook/index.ts` uses `eventCoverVideoReadyUpdate()` and no longer writes `processed_at`.
- `supabase/functions/_shared/eventCoverVideo.test.ts` adds a Deno harness test that uses `serviceRoleClient()` to validate the ready-update column set against the live table shape when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are exported.
- `mingla-business/src/services/eventCoverVideoProcessingService.ts` removes `processedAt` from the client status contract and mapper.
- `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts` removes the stale `processedAt` fixture and replaces the flaky exact callback-count assertion with `seen.length >= 1` plus the retained `lastStatus` assertion.
- `.github/workflows/strict-grep-mingla-business.yml` registers `orch-0776-video-processing-status-bridge.mjs` in the strict-grep CI registry and job list.

## Why The Old Failure Happened

The old path created an `event_cover_video_jobs` row as `source_uploading`, uploaded the source file directly to Cloudinary, then immediately polled Supabase for a terminal job. Mingla never durably acknowledged that the source upload had completed, so if Cloudinary’s asynchronous webhook was late, rejected, or not visible to Supabase quickly, `waitForEventCoverVideoReady()` timed out and showed `Video is still processing. Try again in a moment.` as a dead-end toast.

## New State-Machine Contract

Job status remains the source of truth in `event_cover_video_jobs.status`.

| Status | User-facing behavior |
| --- | --- |
| `source_uploading` | Determinate source upload when byte progress is available. |
| `source_uploaded` | Source upload is acknowledged by Mingla; UI shows post-upload preparation. |
| `processing_queued` / `processing` | Honest indeterminate provider processing; no fake Cloudinary percentage. |
| `ready` | Processed browser-safe MP4 is ready for manual apply/save. |
| `applied` | Processed MP4 has been written to the event cover. |
| `failed` | Persistent inline failure with safe failure code/message. |
| `cancelled` | Persistent inline cancellation state. |

Timeout is now a client-side recoverable condition. `waitForEventCoverVideoReady()` throws `processing_timeout` with the last known `EventCoverVideoStatus`, and Step 4 renders `Your video is still processing. You can check again in a moment.` with `Check again`, `Replace video`, and `Cancel processing` when the job remains cancellable.

## Backend / Edge Changes

- Added `event-cover-video-source-uploaded`, a JWT-protected mutation endpoint that validates user/event/brand/job ownership, stores sanitized Cloudinary source upload metadata under `provider_payload.source_upload`, and moves `source_uploading` jobs to `source_uploaded`.
- Added shared `mapEventCoverVideoStatus()` to return stage labels, progress kind, terminal flags, retry/check/cancel affordances, processed metadata, failure metadata, and timestamps.
- Updated `event-cover-video-status` to remain read-only while returning the enriched payload.
- Updated `event-cover-video-cancel` to return enriched terminal status and persist `cancelled_at`, `completed_at`, `user_cancelled`, and safe message.
- Updated `event-cover-video-apply` to return current status for `job_not_ready` and mark `completed_at` on apply.
- Updated `event-cover-video-webhook` to log received/rejected callbacks, persist provider/derivative failures with `completed_at`, ignore late callbacks for cancelled/superseded jobs, and avoid falsely marking `applied` if the event update fails.
- REWORK removed the invalid `processed_at` write from the webhook ready update. `processedAt` is no longer part of the shared or business status payload; `updated_at`, `completed_at`, `applied_at`, and `cancelled_at` remain the durable timestamps.

No new migration was required. Existing ORCH-0770 schema already supports `source_uploaded`, `processing_queued`, `processing`, `completed_at`, and `provider_payload`; ORCH-0776D already supplies `cancelled_at`.

## Client / UX Changes

- `uploadEventCoverVideoSource()` now returns sanitized Cloudinary upload response metadata in addition to real byte progress.
- Added `acknowledgeEventCoverVideoSourceUploaded()` and `cancelEventCoverVideoJob()`.
- Expanded `EventCoverVideoStatus` to match the enriched Edge payload.
- `waitForEventCoverVideoReady()` now accepts `{ timeoutMs, pollIntervalMs, onStatus }`, calls status callbacks, and attaches `lastStatus` on timeout/failure errors.
- Step 4 now drives video processing from a local state machine: preparing, uploading, processing, timeout, failed, ready.
- Previous cover/hue remains visible until `ready`/`applied` returns a processed MP4 URL.
- Timeout is inline and recoverable; the old dead-end copy is removed from service behavior.

## Regression Tests

Added/updated repo-running regression coverage:

- `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts`
  - source-upload acknowledgement call and enriched status mapping
  - `waitForEventCoverVideoReady()` status callbacks
  - timeout error carrying `lastStatus`
  - cancel returning enriched terminal status
  - prior upload-progress and provider-error tests retained
- `supabase/functions/_shared/eventCoverVideo.test.ts`
  - enriched status mapping for active source-uploaded job
  - terminal applied MP4 mapping
- `.github/scripts/strict-grep/orch-0776-video-processing-status-bridge.mjs`
  - guards source-upload acknowledgement, enriched read-only status, timeout recovery actions, no old dead-end copy, no source URL persistence, failure persistence, and cancelled late-webhook handling
- `.github/workflows/strict-grep-mingla-business.yml`
  - registers the ORCH-0776 strict-grep guard as a pull-request CI job
- `.github/scripts/strict-grep/orch-0776a-video-upload-progress-honesty.mjs`
  - updated to accept backend stage labels after acknowledgement while still forbidding fake processing percentage
- `supabase/functions/_shared/eventCoverVideo.test.ts`
  - adds live-schema drift coverage for the webhook ready-update column set via `serviceRoleClient()` when Supabase service-role env is present; the query targets the zero UUID so it validates accepted columns without mutating a real job row

## Verification

REWORK verification on 2026-05-11:

Passed:

```bash
cd mingla-business
npm run test:orch-0770 && npm run test:orch-0776a && npm run test:orch-0776 && npx tsc --noEmit
```

Result: ORCH-0770 strict guard passed; Jest `eventCoverMedia.test`, `eventCoverNativeVideo.test`, and `eventCoverVideoProcessingService.test` passed, 26/26 tests; ORCH-0776A strict guard passed and Jest `eventCoverVideoProcessingService.test` passed, 13/13 tests; ORCH-0776 strict guard passed and Jest `eventCoverVideoProcessingService.test` passed, 13/13 tests; TypeScript completed cleanly. Jest emitted local Watchman recrawl warnings only.

Passed:

```bash
git diff --check
```

Result: clean.

Passed:

```bash
/Users/sethogieva/.deno/bin/deno check \
  supabase/functions/event-cover-video-upload-intent/index.ts \
  supabase/functions/event-cover-video-source-uploaded/index.ts \
  supabase/functions/event-cover-video-status/index.ts \
  supabase/functions/event-cover-video-webhook/index.ts \
  supabase/functions/event-cover-video-apply/index.ts \
  supabase/functions/event-cover-video-cancel/index.ts
```

Result: all six functions checked clean.

Passed, with live-column probe skipped due missing shell env:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/_shared/eventCoverVideo.test.ts
```

Result: 8/8 Deno tests passed. The new `serviceRoleClient()` live-schema test skipped because this shell did not have `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` exported; when those env vars are present, the same test validates the real ready-update column set against `public.event_cover_video_jobs` using the zero UUID and would fail on a non-existent column such as `processed_at`.

Passed:

```bash
cd mingla-business
npm run test:orch-0776
```

Result: strict guard passed; Jest `eventCoverVideoProcessingService.test` passed, 13/13 tests.

Passed:

```bash
cd mingla-business
npm run test:orch-0776a
```

Result: strict guard passed; Jest `eventCoverVideoProcessingService.test` passed, 13/13 tests.

Passed:

```bash
cd mingla-business
npx tsc --noEmit
```

Result: clean.

Passed:

```bash
/Users/sethogieva/.deno/bin/deno check \
  supabase/functions/event-cover-video-upload-intent/index.ts \
  supabase/functions/event-cover-video-source-uploaded/index.ts \
  supabase/functions/event-cover-video-status/index.ts \
  supabase/functions/event-cover-video-webhook/index.ts \
  supabase/functions/event-cover-video-apply/index.ts \
  supabase/functions/event-cover-video-cancel/index.ts
```

Result: all six functions checked clean.

Initial Deno test attempt without env permission failed as expected:

```bash
/Users/sethogieva/.deno/bin/deno test supabase/functions/_shared/eventCoverVideo.test.ts
```

Result: failed because shared helper reads env defaults at module load and Deno requires `--allow-env`.

Passed:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/eventCoverVideo.test.ts
```

Result: 7/7 Deno tests passed.

Passed:

```bash
cd mingla-business
npm run test:orch-0770
```

Result: strict guard passed; Jest `eventCoverMedia.test`, `eventCoverNativeVideo.test`, and `eventCoverVideoProcessingService.test` passed, 26/26 tests; `npx tsc --noEmit` passed.

Passed:

```bash
cd mingla-business
npm run test:orch-0776d
```

Result: strict guard passed; Jest `eventCoverVideoProcessingService.test` passed, 13/13 tests.

Passed:

```bash
git diff --check
```

Result: clean.

## Runtime Speed Evidence Matrix

| Probe | Evidence |
| --- | --- |
| Upload intent | Blocked for this turn. New branch is not deployed; no authenticated runtime source-video journey was run against these exact functions. Prior ORCH-0776D live direct function evidence showed upload-intent v4 HTTP 200 in 588ms, but that does not include the new source-uploaded bridge. |
| Source upload | Blocked for this turn. No real phone video source upload was run against this unmerged worktree. Unit coverage confirms real byte progress and sanitized provider response parsing. |
| Source acknowledgement | Blocked for runtime. New `event-cover-video-source-uploaded` Deno check passes and Jest verifies the client invokes it with provider upload metadata, but production deployment is required for live elapsed-ms evidence. |
| Status polling | Partially verified by Jest. `waitForEventCoverVideoReady()` emits status snapshots through `onStatus` and carries last known status on timeout. Runtime timestamps require post-deploy tester. |
| Webhook/provider | Partially verified by Deno/static gates. Webhook failure persistence and cancelled late-webhook handling are guarded statically; real provider callback evidence requires deploy and Cloudinary runtime. |
| UI recovery | Partially verified by strict guard. Step 4 contains inline `Check again`, `Replace video`, and `Cancel processing` timeout recovery. Screenshot/device proof remains tester gate. |
| Public playback | Blocked for this turn. ORCH-0770 public-page guard and tests pass, but processed MP4 playback against a new runtime job requires post-deploy tester. |

Runtime speed proof blocker: the implementation adds a new Edge function and changes five existing video functions. Per Mingla deploy split and worktree discipline, implementor does not deploy Edge functions from an unmerged ORCH branch; deployment must happen from `main` after CLOSE/merge or after explicit operator authorization. No secrets, JWT, signed upload payloads, or private source URLs were used or recorded.

## Deployment Notes

No DB migration was added in this implementation, so there is no new `supabase db push` gate for ORCH-0776 itself. The existing ORCH-0776D `cancelled_at` migration remains required baseline and is included in this worktree because the approved QA report proves it is already live.

After merge/authorization, deploy the event-cover video Edge bundle together:

```bash
/Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-source-uploaded --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-status --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-webhook --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-apply --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-cancel --project-ref gqnoajqerqhnvulmnyvv
```

Then capture:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv
```

## Risks And Follow-Up

- Runtime provider behavior is still the key unknown: tester must prove whether Cloudinary webhook arrives quickly, late, rejected, or fails derivative validation for a real phone upload.
- The new `event-cover-video-source-uploaded` function must be deployed with the rest of the bundle; partial deploy would leave the client calling a missing function.
- This worktree had to import local event-cover baseline files because remote `origin/main` was behind the local Mingla baseline. Tester/orchestrator should review the final diff with that context and avoid treating restored ORCH-0770/0776A/0776D baseline files as new product scope.
- `watchman` emitted recrawl warnings during Jest runs; tests still passed. This is local tooling noise, not a product failure.

## Next Routing

Route to Claude `mingla-forensics` TEST mode for independent QA against this implementation report, the approved spec, and the prior investigation/QA evidence. After PASS or accepted conditional evidence, route to Codex `orchestrator-mingla` for CLOSE.
