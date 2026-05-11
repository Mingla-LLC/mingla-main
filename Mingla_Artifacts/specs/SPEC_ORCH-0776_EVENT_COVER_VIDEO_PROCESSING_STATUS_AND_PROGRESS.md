# SPEC ORCH-0776 — Event Cover Video Processing Status And Progress

**Date:** 2026-05-10  
**Mode:** `$forensics` / SPEC  
**Status:** IMPLEMENTOR-READY after orchestrator review  
**Scope:** Mingla Business event-cover video processing status bridge, Step 4 progress UX, Edge status/webhook hardening, deploy parity, and regression gates.

## 1. Executive Summary

Mingla’s event-cover video upload now reaches the managed-processing phase, but the organiser can still be left staring at `Compressing cover video...` until the app times out. The proven bug is not native trim anymore. It is the missing bridge between **source uploaded to Cloudinary** and **Supabase job state reflects processing progress**.

Current behavior:

```text
native picker -> upload intent -> Cloudinary source upload -> app polls job
```

The job starts as `source_uploading`. After Cloudinary source upload succeeds, Mingla does not mark the job `source_uploaded`, `processing_queued`, or `processing`. Only Cloudinary’s asynchronous webhook can move the job to `ready` or `applied`. If that webhook is late, rejected, or missing, the app waits for 120 seconds and shows `Video is still processing. Try again in a moment.`

This spec makes the processing path observable and durable:

```text
upload intent
-> source upload
-> source-upload acknowledgement
-> status payload with real stage fields
-> polling UI with retry/check/cancel
-> webhook marks ready/applied or failed
-> processed MP4 becomes the only public cover URL
```

No Giphy/Pexels, no brand/profile/ticket media, and no provider expansion are in scope.

## 2. Binding User Promise

For organisers:

1. When they upload a video cover, Mingla clearly shows whether it is preparing, uploading, processing, finalizing, ready, failed, or still processing.
2. The previous cover/hue remains visible until the processed MP4 is ready.
3. A timeout is not a dead end. The organiser can check again, replace the video, or cancel the processing job.
4. Provider or webhook failure becomes a clear failure state, not an infinite spinner.
5. A successful processed video cover is the browser-safe MP4 derivative, never the raw phone file.

For public event visitors:

1. Published video covers still use the existing processed-MP4 contract from ORCH-0770.
2. The public page receives a browser-safe `video/mp4` URL, not raw MOV/HEVC.

## 3. Current Proven Failure

Facts from `reports/INVESTIGATION_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_PROGRESS_STALL.md`:

- `CreatorStep4Cover` creates upload intent, uploads source to Cloudinary, then calls `waitForEventCoverVideoReady()`.
- `event-cover-video-upload-intent` inserts `event_cover_video_jobs.status = 'source_uploading'`.
- After Cloudinary direct upload succeeds, no Mingla function marks the job as source uploaded or processing.
- `event-cover-video-webhook` is the only path that moves the job to `ready` or `applied`.
- `waitForEventCoverVideoReady()` polls for up to 120 seconds, then throws `processing_timeout` with `Video is still processing. Try again in a moment.`
- Step 4 has one boolean spinner and static status copy, not a real progress/status model.
- Remote Edge functions are out of sync: webhook is version 2, but upload-intent/status/apply/cancel are still version 1 in the last observed deploy list.

Current code evidence:

- `mingla-business/src/services/eventCoverVideoProcessingService.ts:364-383` throws the exact timeout copy.
- `supabase/functions/event-cover-video-upload-intent/index.ts:200-215` inserts `source_uploading`.
- `supabase/functions/event-cover-video-status/index.ts:46-58` returns only raw status fields.
- `supabase/functions/event-cover-video-webhook/index.ts:135-168` is the only terminal success/apply path.
- `supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql:12-24` already permits intermediate statuses, but current code does not use most of them.

## 4. Implementation Contract By Layer

### Database / Schema

Implementor must add a monotonic Supabase migration if schema changes are required. The current max local migration is:

```text
20260515000012_orch_0770_event_cover_video_processing.sql
```

Therefore any new migration must start at:

```text
20260515000013_orch_0776_event_cover_video_processing_state.sql
```

Required schema contract:

1. Preserve existing `event_cover_video_jobs` table and RLS posture.
2. Add timestamp columns only if current columns are insufficient for status payload:
   - `source_uploaded_at timestamptz`
   - `processing_started_at timestamptz`
   - `last_status_checked_at timestamptz` is optional and not required unless implementor uses it for observability.
3. Existing `completed_at` must be written for terminal `ready`, `failed`, `cancelled`, or `applied` outcomes if the implementation chooses to use it.
4. Existing `provider_payload` may continue to hold sanitized Cloudinary payloads.
5. Do not loosen processed derivative constraints:
   - `processed_bytes <= 26214400`
   - `processed_duration_ms <= 15000`
   - `processed_mime_type = 'video/mp4'`
6. Do not add direct client insert/update/delete policies for `event_cover_video_jobs`.

If implementor can satisfy the status contract using existing `updated_at`, `processed_at`, `applied_at`, `cancelled_at`, and `provider_payload`, no migration is required. If no migration is required, implementation report must explicitly state why.

### Supabase Edge Functions

Add one new Edge function:

```text
event-cover-video-source-uploaded
```

Rationale: source upload acknowledgement is a mutation, not a read. Overloading `event-cover-video-status` would blur ownership and create a read endpoint with write side effects. A small dedicated function keeps the contract auditable.

The function must:

1. Require a valid Supabase user session.
2. Require event-manager permission using the same `requireEventManager` helper.
3. Accept:

```ts
{
  jobId: string;
  eventId: string;
  brandId: string;
  providerUploadResponse?: {
    asset_id?: string;
    public_id?: string;
    bytes?: number;
    duration?: number;
    format?: string;
    resource_type?: string;
  } | null;
  clientRequestId?: string;
}
```

4. Validate that `jobId`, `eventId`, and `brandId` are UUIDs.
5. Read the job by `jobId`.
6. Verify job `event_id`, `brand_id`, and requester/manager permission.
7. If job status is `source_uploading`, update it to `source_uploaded` and set `source_uploaded_at` if available.
8. Store sanitized provider upload metadata in `provider_payload.source_upload` or merge into `provider_payload` without logging/saving secrets or signed fields.
9. If the job is already `source_uploaded`, `processing_queued`, `processing`, `ready`, or `applied`, return the current status idempotently.
10. If the job is `failed`, `cancelled`, or belongs to another event/brand, return a typed error.
11. Never write a raw Cloudinary source URL into `events.cover_media_url`.

Update `event-cover-video-status` to return an enriched status payload. It must remain a read-only status function.

Update `event-cover-video-upload-intent` to:

1. Continue creating `source_uploading` jobs.
2. Return enough non-secret metadata for the client to call source-upload acknowledgement.
3. Continue using `clientRequestId` logs.
4. Log intent creation with `jobId`, `eventId`, `brandId`, `applyMode`, source metadata, and trim metadata.

Update `event-cover-video-webhook` to:

1. Log sanitized `webhook_received` before or immediately after signature verification when safe.
2. Log `webhook_rejected` with verification code when signature/timestamp validation fails.
3. On provider failure, set:
   - `status = 'failed'`
   - `failure_code = 'provider_failed'`
   - `failure_message` with Cloudinary/provider message when safe
   - `completed_at = now()`
4. On derivative validation failure, set:
   - `status = 'failed'`
   - derivative failure code/message
   - `completed_at = now()`
5. On valid derivative:
   - set processed URL/bytes/duration/MIME and codec fields where available;
   - set `status = 'ready'`;
   - set `processed_at = now()`;
   - set `completed_at = now()` only if implementation treats `ready` as terminal for `published_manual`; otherwise keep `completed_at` for `applied/failed/cancelled`.
6. For `draft_auto`, update `events.cover_media_url/type`, then mark job `applied` with `applied_at`.
7. If event update fails, leave job `ready` with failure telemetry instead of falsely marking `applied`.

Update `event-cover-video-cancel` to support cancelling `source_uploading`, `source_uploaded`, `processing_queued`, and `processing` jobs. It must set:

- `status = 'cancelled'`
- `cancelled_at = now()`
- `completed_at = now()` if that column is used for terminal closure
- `failure_code = 'user_cancelled'` or `superseded`
- `failure_message` with a safe user-readable reason.

### Client Service Layer

Update `mingla-business/src/services/eventCoverVideoProcessingService.ts`.

Required API shape:

```ts
export interface EventCoverVideoStatus {
  jobId: string;
  eventId: string;
  brandId: string;
  status:
    | "source_uploading"
    | "source_uploaded"
    | "processing_queued"
    | "processing"
    | "ready"
    | "failed"
    | "cancelled"
    | "applied";
  applyMode: "draft_auto" | "published_manual";
  stageLabel: string;
  progressKind: "determinate" | "indeterminate" | "terminal";
  progressPercent: number | null;
  isTerminal: boolean;
  canRetry: boolean;
  canCheckAgain: boolean;
  processedUrl: string | null;
  processedMimeType: string | null;
  processedBytes: number | null;
  processedDurationMs: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  sourceUploadedAt: string | null;
  processedAt: string | null;
  appliedAt: string | null;
}
```

Add:

```ts
acknowledgeEventCoverVideoSourceUploaded(input): Promise<EventCoverVideoStatus>
cancelEventCoverVideoJob(jobId): Promise<EventCoverVideoStatus>
waitForEventCoverVideoReady(jobId, options): Promise<EventCoverVideoStatus>
```

`waitForEventCoverVideoReady` must no longer only return or throw. It must support progress callbacks:

```ts
waitForEventCoverVideoReady(jobId, {
  timeoutMs,
  pollIntervalMs,
  onStatus,
})
```

Timeout behavior:

1. If timeout expires while job is non-terminal, throw `EventCoverVideoProcessingError` with code `processing_timeout`.
2. The error must include the last known `EventCoverVideoStatus` so the component can show `Still processing` and `Check again`.
3. Timeout copy must not imply failure:
   - preferred: `Your video is still processing. You can check again in a moment.`
4. True `failed`/`cancelled` must still throw immediately with the job failure message.

Source upload:

1. `uploadEventCoverVideoSource` should parse the Cloudinary direct-upload response when possible.
2. After upload succeeds, client must call `acknowledgeEventCoverVideoSourceUploaded`.
3. Only after acknowledgement should the UI move from uploading to processing.

### Creator Step 4 UI

Update `mingla-business/src/components/event/CreatorStep4Cover.tsx`.

Replace the single `uploading` boolean as the only UX truth with a small state machine. The component can still use a boolean for button disabled/loading, but user-visible state must be richer.

Recommended local type:

```ts
type VideoCoverProcessingState =
  | { kind: "idle" }
  | { kind: "preparing"; label: string; percent: 10 }
  | { kind: "uploading"; label: string; percent: number | null }
  | { kind: "processing"; label: string; percent: number | null; jobId: string }
  | { kind: "timeout"; label: string; jobId: string; lastStatus: EventCoverVideoStatus }
  | { kind: "failed"; label: string; jobId?: string; canRetry: boolean }
  | { kind: "ready"; label: string };
```

Required UI behavior:

1. While preparing intent: show `Preparing secure upload...`.
2. While source uploading: show `Uploading video...`.
3. After source upload acknowledgement: show status label from backend, e.g. `Processing browser-safe MP4...`.
4. Show a progress bar or staged progress row:
   - 10% preparing
   - 35% uploading/source uploaded
   - 70% processing
   - 90% finalizing
   - 100% ready
5. If exact source upload progress is technically available via the selected transport, use it. If not, use staged progress and `progressKind = indeterminate` during provider processing.
6. Keep old cover or hue preview visible until `processedUrl` exists.
7. Do not update `draft.coverMediaUrl` to the video URL until status is `ready` or `applied` and `processedUrl` is non-null.
8. On `processing_timeout`, show persistent inline recovery:
   - `Your video is still processing. You can check again in a moment.`
   - Button: `Check again`
   - Button: `Replace video`
   - Optional button/link: `Cancel processing`
9. On provider/validation failure, show persistent inline failure:
   - e.g. `Video processing failed. Try another clip.`
   - Include specific safe failure detail when available.
10. Do not rely on toast-only failure for video processing.
11. Clear stale processing copy after failed/cancelled/ready.
12. `onCoverVideoProcessingChange` must accurately block leaving/publishing only while a job is actively preparing/uploading/polling, not after timeout if user can safely check again later.

### Public Page

No broad redesign in this spec.

Required invariant:

- Public pages must continue to render only processed `video/mp4` URLs for event covers after this fix.
- Regression QA must prove the processed URL still plays in browser/app for at least one runtime event.

## 5. Data / Schema Contract

### Job State Ownership

One source of truth: `event_cover_video_jobs.status`.

Status writer contract:

| Status | Writer | When |
| --- | --- | --- |
| `source_uploading` | `event-cover-video-upload-intent` | Signed direct-upload payload returned; source upload expected but not yet acknowledged. |
| `source_uploaded` | `event-cover-video-source-uploaded` | Client has successfully uploaded source to Cloudinary and notified Mingla. |
| `processing_queued` | `event-cover-video-source-uploaded` or webhook/status helper | Optional if implementor wants separate queued state; use when provider accepted source and async eager transform is pending. |
| `processing` | `event-cover-video-source-uploaded` or status/webhook evidence | Use when processing is known to be active. If Cloudinary cannot provide active processing status, `processing_queued` may be the durable state and UI can label it as processing. |
| `ready` | `event-cover-video-webhook` | Processed derivative verified and ready for manual apply/save. |
| `applied` | `event-cover-video-webhook` for `draft_auto`, `event-cover-video-apply` for `published_manual` | Processed derivative written to `events.cover_media_url/type`. |
| `failed` | webhook/source-uploaded/apply/cancel as appropriate | Provider failure, validation failure, permission mismatch, malformed provider state, or unrecoverable apply failure. |
| `cancelled` | `event-cover-video-cancel` or superseding upload intent | User cancelled or replacement superseded old active job. |

Important: `source_uploaded`, `processing_queued`, and `processing` may be implemented as distinct stored statuses only if useful. The schema already allows them. The status endpoint must still map them into honest user-facing labels.

### Failure Codes

Required failure codes:

- `source_upload_failed`
- `provider_failed`
- `webhook_signature_invalid`
- `webhook_timestamp_invalid`
- `processed_url_invalid`
- `processed_mime_invalid`
- `processed_size_invalid`
- `processed_duration_invalid`
- `processed_codec_invalid`
- `processed_audio_invalid`
- `apply_failed`
- `user_cancelled`
- `superseded`
- `processing_timeout_client` must not be written as job `failed`; it is a client polling condition unless backend has proof of failure.

### Provider Payload Hygiene

May store:

- `public_id`
- `asset_id`
- transformation/eager settings
- provider status payload
- processed derivative metadata
- non-secret request ids

Must not store:

- Cloudinary API secret
- signed upload signature
- Supabase access token
- raw auth headers
- sensitive user tokens.

## 6. Edge Function Contract

### New Function: `event-cover-video-source-uploaded`

Add `supabase/functions/event-cover-video-source-uploaded/index.ts`.

Required Deno gate:

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-source-uploaded/index.ts
```

It must share helpers from `_shared/eventCoverVideo.ts`.

It must be JWT-protected by default. Do not add `verify_jwt = false` in `supabase/config.toml` for this function.

### Existing Function Updates

`event-cover-video-status`:

- must return enriched status payload;
- must remain JWT-protected;
- must not mutate state;
- must allow lookup by `jobId` and latest `eventId` as current code does;
- must reject non-manager users.

`event-cover-video-upload-intent`:

- must cancel/supersede existing active jobs before creating a new job, as current code does;
- must avoid cancelling an already ready manual job unless replacement is explicitly requested;
- must return `jobId` and upload fields;
- must not claim processing started before source-upload acknowledgement.

`event-cover-video-webhook`:

- must remain `verify_jwt = false`;
- must authenticate Cloudinary signed notifications;
- must log enough stage evidence to reconstruct every callback;
- must write `failed` for rejected provider outcomes after a valid webhook;
- rejected webhook verification cannot update a job unless job id is safely available and the request is trusted enough; at minimum it must log the rejection reason.

`event-cover-video-apply`:

- for `published_manual`, must apply only `ready` jobs with valid `processed_url`;
- if not ready, return typed `job_not_ready` with current status payload if safe;
- if event update fails, do not mark job `applied`.

`event-cover-video-cancel`:

- must support cancellation from timeout UI and replacement flow;
- must reject wrong actor/brand/event;
- must be idempotent for already terminal jobs.

## 7. Client / UX Contract

### Processing Status Copy

Use concise organiser-facing copy:

| Backend status | Stage label |
| --- | --- |
| `source_uploading` | `Uploading video...` |
| `source_uploaded` | `Upload complete. Preparing processing...` |
| `processing_queued` | `Processing browser-safe video...` |
| `processing` | `Processing browser-safe video...` |
| `ready` | `Video ready.` |
| `applied` | `Cover video updated.` |
| `failed` | `Video processing failed.` plus safe detail |
| `cancelled` | `Video processing cancelled.` |

Timeout copy:

```text
Your video is still processing. You can check again in a moment.
```

Do not use:

```text
Video is still processing. Try again in a moment.
```

as a toast-only dead end.

### Buttons

During active processing:

- primary upload/replace button disabled or shows progress;
- no duplicate upload starts.

On timeout:

- `Check again`
- `Replace video`
- `Cancel processing` if a job is active and cancellable.

On failure:

- `Replace video`
- optional `Try again` only if retrying creates a fresh job with the same local file still available; if local file URI may be gone, use `Replace video`.

### Draft / Published Behavior

`draft_auto`:

- webhook may apply processed URL directly to event draft and mark job `applied`;
- client can update preview when polling sees `applied`;
- previous cover remains until that moment.

`published_manual`:

- processing can produce `ready`;
- client preview may show processed URL locally;
- user must still Save changes to publish the new cover;
- `event-cover-video-apply` or existing save path must be the only server write that marks the live event cover changed.

If current published-manual flow already has a Save button path, implementor must preserve it and ensure the processed URL is recognized as a dirty change.

## 8. Deployment Contract

Implementation must deploy the event-cover video Edge functions as one bundle after code is accepted and after any migration is pushed by the operator.

Deploy list:

```bash
/Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-source-uploaded --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-status --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-webhook --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-apply --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-cancel --project-ref gqnoajqerqhnvulmnyvv
```

Post-deploy evidence:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv
```

Implementation report must include the function list with updated versions for all six functions above. If implementor chooses not to add the new function and can justify a safer equivalent, the report must list the actual deployed function set and why.

Standing deploy split:

- Codex/implementor runs Deno/static/test gates.
- Operator runs `supabase db push` if migration is required.
- Codex deploys Edge functions only after migration success/authorization.

## 9. Tests And Manual Gates

### Automated Tests

All tests must ship in the same scoped commit/push as the implementation.

Required app tests:

1. `eventCoverVideoProcessingService`:
   - maps enriched status payload;
   - `waitForEventCoverVideoReady` calls `onStatus`;
   - non-terminal statuses do not immediately throw;
   - timeout throws `processing_timeout` with last status;
   - failed status throws failure code/message;
   - source-upload acknowledgement is called after source upload success.

2. `CreatorStep4Cover` or focused component test:
   - previous cover/hue remains until processed URL is ready/applied;
   - processing state shows staged progress/status text;
   - timeout shows inline `Check again` recovery, not toast-only failure;
   - failed provider state shows persistent inline error and replacement path;
   - successful ready/applied updates draft to processed URL only.

3. Existing ORCH-0770 guard:
   - update strict grep guard to require new source-upload acknowledgement call after `uploadEventCoverVideoSource`;
   - require status payload fields or service typing;
   - continue blocking raw video cover URL application.

Required Edge/Deno tests or checks:

1. Deno check all video functions:

```bash
/Users/sethogieva/.deno/bin/deno check \
  supabase/functions/event-cover-video-upload-intent/index.ts \
  supabase/functions/event-cover-video-source-uploaded/index.ts \
  supabase/functions/event-cover-video-status/index.ts \
  supabase/functions/event-cover-video-webhook/index.ts \
  supabase/functions/event-cover-video-apply/index.ts \
  supabase/functions/event-cover-video-cancel/index.ts
```

2. If there is an existing Deno test harness for `_shared/eventCoverVideo.ts`, extend it for status mapping/failure validation. If none exists, `deno check` plus app unit tests is acceptable, but tester must manually gate webhook behavior.

Required package scripts:

- Update `npm run test:orch-0770` or add `npm run test:orch-0776` and include it in implementation report.
- Existing `npm run test:orch-0774a` must still pass if Step 4 auth readiness is touched.
- `npx tsc --noEmit` must pass.
- `git diff --check` must pass.

### Manual Runtime Gates

Tester must run at least one real video cover journey after deploy.

Evidence required:

1. App logs:
   - picked asset metadata;
   - upload-intent request/success with `clientRequestId`;
   - source-upload-start/success;
   - source-upload acknowledgement success;
   - status poll snapshots with job statuses;
   - ready/applied or failed terminal state.

2. Job row evidence:
   - `id`
   - `status`
   - `source_uploaded_at` if added
   - `failure_code`
   - `failure_message`
   - `processed_url`
   - `processed_bytes`
   - `processed_duration_ms`
   - `processed_mime_type`
   - `provider_payload`
   - `updated_at`

3. Edge/provider evidence:
   - upload-intent logs for matching `clientRequestId`;
   - source-upload acknowledgement logs for matching `jobId`;
   - webhook received/applied or webhook failed/rejected logs for matching `jobId`;
   - if Supabase CLI still cannot fetch logs, collect equivalent evidence from Supabase dashboard or Cloudinary notification logs.

4. User-facing proof:
   - Step 4 shows progress/stage text during processing;
   - timeout, if simulated, shows `Check again` not dead-end toast;
   - successful processed video appears in preview;
   - public event browser page plays processed MP4.

## 10. Non-Goals

This spec does not authorize:

- Giphy integration.
- Pexels integration.
- brand page media upload expansion.
- profile media upload expansion.
- ticket media upload expansion.
- public page redesign.
- changing the final processed derivative budget above 25 MB.
- encoding video inside Supabase Edge Functions.
- replacing Cloudinary unless implementor proves current Cloudinary path cannot meet the contract and returns for orchestrator review.
- ticket checkout/order fixes.
- Stripe onboarding/currency fixes.

## 11. Rollback / Partial Failure Handling

Rollback-safe behavior:

1. Previous event cover remains active until processed URL is ready/applied.
2. If source upload acknowledgement fails, show retryable source-upload acknowledgement error and do not mutate cover URL.
3. If webhook never arrives, job remains non-terminal and UI offers `Check again`, `Replace video`, or `Cancel processing`.
4. If webhook marks failed, UI shows failure and keeps previous cover.
5. If deploy is partial, implementation must not close. All video functions must be deployed together.
6. If DB migration is required but not pushed, implementor must stop before Edge deploy and report the exact migration gate.

Superseded jobs:

- Starting a new upload cancels any active non-terminal job for the event.
- Cancelled/superseded jobs must not later apply to the event if their webhook arrives late.
- Webhook handler must check current job status before applying. If the job is `cancelled` or superseded, it should record/log late webhook receipt but must not mutate `events.cover_media_url`.

## 12. Open Questions

No root-cause questions block implementation.

Runtime proof still needed after implementation:

1. Whether Cloudinary webhook is currently arriving, late, rejected, or failing derivative validation for the operator’s real job.
2. Whether Supabase logs are available through dashboard/CLI after deploy.
3. Whether Cloudinary provider payload includes all metadata needed to populate codec/public-id fields. If not, implementation may store null for codec fields but must still validate MIME, duration, size, and URL.

These are tester/runtime gates, not reasons for implementor to skip the state/progress repair.

