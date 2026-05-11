# INVESTIGATION ORCH-0776 — Event Cover Video Processing Progress Stall

**Date:** 2026-05-10  
**Mode:** `$forensics` / INVESTIGATE  
**Scope:** Mingla Business event creator Step 4 video cover upload after ORCH-0775 native trim flow.  
**User symptom:** image/GIF works; video picker/native trim works; source upload appears to start; UI sits on `Compressing cover video...` with spinner/no progress, then eventually shows `Video is still processing. Try again in a moment.`

## Verdict

The remaining blocker is concentrated **after Cloudinary source upload**, in the handoff from Cloudinary processing back to Supabase job status, plus a UX gap that hides the real stage from the organiser.

The exact user-facing timeout is confirmed in code: `waitForEventCoverVideoReady()` polls `event-cover-video-status` for 120 seconds and throws `processing_timeout` with the exact copy `Video is still processing. Try again in a moment.` if the job never becomes `ready` or `applied`.

This means the app is not failing at native trim anymore. It is reaching the processing wait state, then timing out because Supabase never observes a terminal Cloudinary processing result within the client timeout window.

## Intended Happy Path

1. Organiser taps **Video** on Step 4.
2. Native picker opens with `allowsEditing: true`, `videoMaxDuration: 15`, and H.264 export settings.
3. App receives a trimmed/exported video.
4. App validates duration and source size.
5. App calls `event-cover-video-upload-intent`.
6. Edge creates `event_cover_video_jobs` row and returns signed Cloudinary direct-upload fields.
7. App uploads source video directly to Cloudinary.
8. Cloudinary processes the eager MP4 derivative asynchronously.
9. Cloudinary calls `event-cover-video-webhook`.
10. Webhook validates the processed derivative, marks the job `ready` or `applied`, and writes `events.cover_media_url` for `draft_auto`.
11. App polling sees `ready/applied`, updates the preview, and clears the spinner.

## Evidence

### Confirmed Flow

| Layer | Evidence | What it proves |
|---|---|---|
| Step 4 picker | `mingla-business/src/components/event/CreatorStep4Cover.tsx:383-390` | Video picker now uses native editing, 15-second max duration, H.264 1280x720 export preset. |
| Step 4 source upload | `CreatorStep4Cover.tsx:251-290` | The app creates upload intent, uploads the source to Cloudinary, then starts status polling. |
| Timeout source | `mingla-business/src/services/eventCoverVideoProcessingService.ts:364-383` | The exact toast is a 120-second client polling timeout. |
| Job creation | `supabase/functions/event-cover-video-upload-intent/index.ts:200-215` | Upload intent inserts the job as `source_uploading`. |
| Cloudinary async processing | `event-cover-video-upload-intent/index.ts:238-257`, `:280-299` | Intent asks Cloudinary for async eager processing and sets `eager_notification_url` to the Supabase webhook. |
| Webhook terminal update | `supabase/functions/event-cover-video-webhook/index.ts:135-168` | Only webhook moves the job to `ready`/`applied` and writes the processed MP4 URL. |
| Status endpoint | `supabase/functions/event-cover-video-status/index.ts:46-58` | Status simply returns the current job row. It does not infer progress or mark source upload completion. |
| Schema status model | `supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql:12-24` | Schema supports intermediate statuses, but current code barely uses them. |

### Remote Deploy Evidence

`supabase functions list --project-ref gqnoajqerqhnvulmnyvv` shows:

| Function | Remote version | Updated |
|---|---:|---|
| `event-cover-video-upload-intent` | 1 | 2026-05-09 16:54:45 UTC |
| `event-cover-video-status` | 1 | 2026-05-09 16:54:45 UTC |
| `event-cover-video-apply` | 1 | 2026-05-09 16:54:46 UTC |
| `event-cover-video-cancel` | 1 | 2026-05-09 16:54:44 UTC |
| `event-cover-video-webhook` | 2 | 2026-05-09 17:08:05 UTC |

This is a production-readiness gap: the latest local app/service changes are not backed by a fully redeployed matching Edge-function set. In particular, ORCH-0774A diagnostics were documented as requiring deployment, but `event-cover-video-upload-intent` is still active version 1.

I could verify function versions, but this Supabase CLI version does not expose `functions logs`; attempting `supabase functions logs event-cover-video-webhook --project-ref ...` failed because the command does not exist. That prevents direct webhook log confirmation from this local session.

## Root Cause Findings

### RC-1 — Confirmed Bug: Job Status Can Remain Stuck in `source_uploading` Until Client Timeout

**File/line:**  
`supabase/functions/event-cover-video-upload-intent/index.ts:200-215` inserts `status: "source_uploading"`.  
`mingla-business/src/services/eventCoverVideoProcessingService.ts:364-383` polls until timeout.  
`supabase/functions/event-cover-video-webhook/index.ts:135-168` is the only path that marks the job `ready` or `applied`.

**Exact code/schema:**  
The upload-intent function creates the job as `source_uploading`; after the client uploads the source to Cloudinary, no Mingla endpoint marks `source_uploaded`, `processing_queued`, or `processing`. The client immediately polls status. If Cloudinary webhook does not arrive, is rejected, or is delayed beyond 120 seconds, the job never reaches `ready/applied`.

**Current behavior:**  
The organiser sees `Compressing cover video...`, waits with no meaningful progress, then gets `Video is still processing. Try again in a moment.`

**Expected behavior:**  
After source upload succeeds, Mingla should persist a real next state and expose it to the UI. If Cloudinary has not called back, the user should see an honest queued/processing state, not a generic timeout. If the webhook fails, Mingla should surface the reason.

**Causal chain:**  
Source upload success -> app polls Supabase -> job row still `source_uploading` or another non-terminal status -> webhook does not update terminal state within 120 seconds -> `waitForEventCoverVideoReady()` throws `processing_timeout`.

**Verification step:**  
For a failing upload, inspect `event_cover_video_jobs` for the latest event/job. If status remains `source_uploading` after app logs `source-upload-success`, RC-1 is proven at runtime. If status is `failed`, inspect `failure_code` and `failure_message`; that would shift the implementation target to derivative validation/provider failure instead of missing webhook.

### RC-2 — Confirmed UX Gap: There Is No Real Processing Progress UI

**File/line:**  
`CreatorStep4Cover.tsx:267-290`, `:520-549`.

**Exact code:**  
The button uses `loading={uploading}` and `disabled={uploading}` for the whole operation. The only user-visible processing copy is a text string: `Uploading video for processing...` and then `Compressing cover video...`.

**Current behavior:**  
The organiser sees one indefinite spinner and static copy. There is no progress bar, no current backend status, no retry/cancel surface, and no distinction between upload, queued processing, processing, webhook wait, ready, failed, or timeout.

**Expected behavior:**  
The UI should show staged progress, even if exact Cloudinary percentage is unavailable:

- Preparing secure upload
- Uploading source
- Processing browser-safe MP4
- Finalizing cover
- Ready / failed / retry

If exact upload progress is available from the upload transport, use it. If Cloudinary processing progress is not available, show an indeterminate processing phase with elapsed time and clear retry behavior.

**Causal chain:**  
The app only has a boolean `uploading` and one `videoStatusText`; status polling does not report intermediate state to the component; the user cannot tell whether upload is progressing, Cloudinary is processing, webhook is missing, or the app has stalled.

**Verification step:**  
Upload a video and watch Step 4. The UI will not show percentage/progress by current job status because no component state carries that data.

### RC-3 — Production-Hardening Gap: Edge Deploy State Is Out of Sync

**Evidence:**  
Remote function list shows upload-intent/status/apply/cancel still at version 1 while webhook is version 2. Local code includes newer diagnostics and native-trim-aligned intent handling, but the deployed function set has not been redeployed as a bundle.

**Impact:**  
Runtime phone tests may not match the code that was just committed. Even if the local repo has the right fix, remote Supabase may still be running old upload-intent/status behavior. This makes “it still fails” hard to interpret because the app and backend are on different generations.

**Fix direction:**  
Deploy all five event-cover video functions together after any video pipeline change:

```bash
/Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-status --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-webhook --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-apply --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-cancel --project-ref gqnoajqerqhnvulmnyvv
```

Then run the phone test again and match the app `clientRequestId`/`jobId` to Edge logs.

### RC-4 — Open Runtime Question: Is Cloudinary Webhook Arriving, Rejected, or Late?

The code strongly narrows the failure point, but one runtime fact remains unproven from this session: what happens to the actual Cloudinary webhook for the failing job.

Possible states:

| Runtime state | Meaning | Expected job row |
|---|---|---|
| Webhook never arrives | Cloudinary did not send callback or callback URL/provider config is wrong | `source_uploading` forever |
| Webhook rejected | Signature/timestamp/header issue, gateway/config issue | `source_uploading` forever, webhook 4xx in logs |
| Webhook arrives with provider failure | Cloudinary processing failed | `failed`, `failure_code=provider_failed` |
| Webhook arrives but derivative validation fails | Processed file exceeds size/duration or metadata missing | `failed`, derivative failure code |
| Webhook arrives and applies | Pipeline healthy | `applied`, `processed_url` set |

Without live job-row data and webhook logs, the exact bucket is still an open runtime proof item. The current code and user symptom make “job stuck waiting for webhook terminal update” the best-supported diagnosis.

## Tests / Guardrails Missing

There is no regression test that proves the polling path surfaces intermediate status or avoids an opaque timeout. Existing service tests cover upload-intent mapping and status failure mapping, but no test covers:

- `waitForEventCoverVideoReady()` timing out after non-terminal statuses.
- Step 4 showing staged progress while polling.
- Source upload success followed by status polling with a non-terminal job.
- Webhook missing/rejected behavior.
- Edge deploy parity for all event-cover video functions.

Per repo policy, any implementation must add or update a repo-running regression test in the same scoped commit/push. If automated Cloudinary webhook runtime cannot be fully simulated, define a tester manual gate with job-row and log evidence.

## Recommended Fix Contract

### Backend / Edge

1. Add a post-source-upload acknowledgement endpoint or extend `event-cover-video-status`/new endpoint so the app can mark the job `source_uploaded` or `processing_queued` after Cloudinary upload succeeds.
2. Add explicit function logs across:
   - upload intent returned
   - source uploaded / acknowledged
   - webhook received
   - webhook verified or rejected
   - derivative validation passed/failed
   - event cover applied
3. Return status payload with user-facing stage fields:
   - `status`
   - `stageLabel`
   - `isTerminal`
   - `canRetry`
   - `failureCode`
   - `failureMessage`
   - `elapsedMs` or timestamps
4. On webhook success, populate all relevant processed fields, including public id/asset id where available, not only URL/bytes/duration.
5. On webhook failure, always persist `failed` with a durable failure code/message. Never let provider failure become an endless `source_uploading` wait.

### Client / UX

1. Replace one boolean spinner with a staged upload-processing state machine.
2. Show source-upload progress if the platform transport supports it. If not, show step-based progress:
   - 10% preparing
   - 35% source upload complete
   - 70% processing
   - 90% finalizing
   - 100% ready
3. Poll status and update visible stage text from the actual job status.
4. If timeout occurs, keep the job visible as `Still processing`, provide `Check again`, `Try another video`, and `Cancel`/`Replace` instead of a dead-end toast.
5. Preserve the previous cover until the processed MP4 is ready.

### Deployment

Deploy all five Edge functions as one unit after implementation. The deployment report must include a fresh `supabase functions list` showing updated versions for all five video functions.

### Runtime Verification Gate

For the next test, collect:

1. App logs:
   - picked asset
   - upload-intent request/success with `requestId`
   - source-upload-start/success
   - status poll snapshots
2. Job row:
   - `id`
   - `status`
   - `failure_code`
   - `failure_message`
   - `processed_url`
   - `provider_payload`
   - `updated_at`
3. Edge logs:
   - upload-intent stages for matching `requestId`
   - webhook received/rejected/applied for matching `jobId`
4. Public event page:
   - browser loads processed MP4 URL
   - app public page loops video and exposes reachable mute control

## User Impact in Plain English

The phone video is getting past the picker and into the upload pipeline. The app then waits for Cloudinary to finish compressing and tell Supabase “the browser-safe MP4 is ready.” Right now, Mingla does not show the organiser what is happening in that waiting room, and if the callback does not update the job fast enough, the app gives up after two minutes.

The fix is not more native trimming. The fix is to make the processing bridge observable and durable: record each stage, surface the real stage in the UI, catch webhook failures as failures, deploy the whole Edge-function bundle together, and test with the actual job row plus webhook evidence.

