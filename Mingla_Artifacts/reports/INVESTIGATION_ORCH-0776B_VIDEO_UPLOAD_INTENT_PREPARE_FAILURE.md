# INVESTIGATION ORCH-0776B — Video Upload Intent Prepare Failure

Date: 2026-05-10
Investigator: forensics
Verdict: ROOT CAUSE NOT FULLY PROVEN / FAILING STAGE PROVEN

## Plain-English Explanation

The smoke failure happened before the new ORCH-0776A upload progress code can help.

`Could not prepare video upload` is not a Cloudinary source-upload progress problem. It means Mingla did not successfully get a signed Cloudinary upload intent from Supabase. In normal language: before the app can upload the video, it asks the backend for permission and upload instructions. That preparation request is failing or returning a shape the app cannot use.

The exact failing backend gate is not proven from the available evidence because the failed smoke did not include the surrounding Metro logs or a Supabase job row, and the CLI could not read the remote database job table. However, the investigation proves two hard facts:

1. The failure is pre-source-upload.
2. The deployed `event-cover-video-upload-intent` function is still version `1`, so the current local upload-intent diagnostics are not active in the remote function the phone hit.

## Exact Failing Stage

Proven stage:

```text
Step 4 video picker
-> native-trimmed video validation
-> createEventCoverVideoUploadIntent()
-> event-cover-video-upload-intent fails/rejects/malformed/errors
-> UI shows "Could not prepare video upload"
```

Not proven from current evidence:

- whether the Edge function body received the request;
- whether the gateway rejected the request before function code;
- whether a job row was created;
- whether the failing gate was auth, permission, event id, DB insert, or Cloudinary signing/config.

## Evidence Table

| Layer | Evidence | What It Proves |
|---|---|---|
| UI trigger | `mingla-business/src/components/event/CreatorStep4Cover.tsx:239-267` | Step 4 sets `Preparing secure video upload...` and calls `createEventCoverVideoUploadIntent()` before source upload begins. |
| Source upload boundary | `CreatorStep4Cover.tsx:273-290` | `source-upload-start` and upload progress only happen after intent success. If the user sees `Could not prepare video upload`, the new progress path was not reached. |
| Client upload-intent call | `mingla-business/src/services/eventCoverVideoProcessingService.ts:301-320` | The service generates `clientRequestId`, logs request fields in dev, and invokes `event-cover-video-upload-intent`. |
| Generic fallback | `eventCoverVideoProcessingService.ts:321-328`, `:248-288` | The exact fallback copy `Could not prepare video upload.` is used when the edge invocation errors and no more specific mapped payload is surfaced. |
| Edge returned error payload | `eventCoverVideoProcessingService.ts:330-336`, `:79-125` | If the function returns `{ error, detail }`, known errors map to better copy. Unknown errors with no detail can collapse to the same generic prepare failure. |
| Local Edge validation gates | `supabase/functions/event-cover-video-upload-intent/index.ts:48-172` | The function can reject auth, JSON, provider config, event id, brand id, source size/duration, trim, and event-manager permission before creating a job. |
| Local DB insert gate | `event-cover-video-upload-intent/index.ts:200-230` | If job insert fails, the function returns `{ error: "internal_error" }` without a client-safe `detail`, which the app can surface as generic `Could not prepare video upload.` |
| Local Cloudinary config gate | `supabase/functions/_shared/eventCoverVideo.ts:115-121` | Provider is considered configured only when provider is Cloudinary and all three Cloudinary secrets exist. |
| Remote secrets | `supabase secrets list --project-ref gqnoajqerqhnvulmnyvv` | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `EVENT_COVER_VIDEO_PROVIDER` are present by name/digest. This lowers likelihood of `provider_not_configured`, but does not prove their values are semantically correct. |
| Remote deploy parity | `supabase functions list --project-ref gqnoajqerqhnvulmnyvv` | `event-cover-video-upload-intent`, `status`, `apply`, and `cancel` are still ACTIVE version `1`; webhook is version `2`. Upload-intent diagnostics from local code are not deployed. |
| Local static gate | `npm run test:orch-0776a` | The local upload-progress regression suite passes; local progress implementation is not the failing point for this symptom. |
| Local Edge check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-upload-intent/index.ts` | Local upload-intent source type-checks. |
| Remote DB evidence | `supabase db query --linked ...event_cover_video_jobs...` | Blocked by CLI temp-role auth failure: `Circuit breaker open: Too many authentication errors`; no job-row proof available from this session. |

## Root Cause Proof Status

### Confirmed Bug 1 — Runtime is hitting stale upload-intent deployment

Six-field proof:

1. File/line: local diagnostics live in `supabase/functions/event-cover-video-upload-intent/index.ts:24-38`, `:77-87`, `:147-177`, `:218-231`.
2. Exact code: local function logs structured stages such as `received`, `validation_pass`, `permission_pass`, `job_insert_pass`, and `cloudinary_signature_generated`.
3. Current behavior: remote `event-cover-video-upload-intent` is ACTIVE version `1`, updated `2026-05-09 16:54:45 UTC`; the diagnostic implementation report already warned deployment was required before phone tests could correlate `clientRequestId`.
4. Expected behavior: remote upload-intent should run the current diagnostic/function contract before runtime QA, so a failed upload exposes the failing gate.
5. Causal chain: operator hits generic prepare failure -> local code can generate `clientRequestId` -> remote function version remains old -> server-side staged logs may be absent or stale -> exact gate cannot be proven from current runtime smoke.
6. Verification step: deploy current `event-cover-video-upload-intent`, rerun the same smoke, collect `[eventCoverVideoProcessingService] upload-intent-request` client `requestId` and matching `[event-cover-video-upload-intent]` stage logs.

Classification: production-hardening gap / confirmed deploy-parity bug.

### Confirmed Bug 2 — Some upload-intent failures still collapse to generic copy

Six-field proof:

1. File/line: `eventCoverVideoProcessingService.ts:119-125`, `event-cover-video-upload-intent/index.ts:218-230`.
2. Exact code: unknown string errors use `payload.detail ?? fallback`; job insert failure returns only `{ error: "internal_error" }`.
3. Current behavior: an internal upload-intent failure with no detail can become `Could not prepare video upload.`.
4. Expected behavior: user-facing copy should identify a retryable backend-prep failure, and dev logs should preserve the request id and failing stage.
5. Causal chain: Edge returns `{ error: "internal_error" }` or invocation error with no parseable payload -> client maps to fallback -> operator sees generic toast without knowing auth/permission/DB/provider boundary.
6. Verification step: add tests for upload-intent `internal_error` and gateway error payloads, and runtime test with current deployed diagnostics.

Classification: UX gap / production-hardening gap.

## Not Proven

The exact live failing gate is not proven. These remain candidates:

- Gateway/JWT rejection before function body.
- Auth/session unavailable at invocation time.
- Event id is not a durable server UUID or does not exist in remote `events`.
- Brand id is invalid or mismatched.
- User lacks `event_manager` effective rank for the brand/event.
- Role RPC or event read returns internal error.
- `event_cover_video_jobs` insert fails.
- Remote function is stale and does not match current client request/error contract.
- Cloudinary config value is wrong despite secret names being present.

Provider-not-configured is less likely because required Cloudinary secret names are present, but it is not impossible because secret value correctness is not exposed by `secrets list`.

## Causal Chain

Observed:

```text
operator selects video
-> app reaches upload preparation
-> upload intent does not return usable signed upload fields
-> app surfaces "Could not prepare video upload"
-> no source-upload progress can appear
```

Code-backed:

```text
CreatorStep4Cover.processPickedVideo()
-> createEventCoverVideoUploadIntent()
-> supabase.functions.invoke("event-cover-video-upload-intent")
-> error/data.error/malformed response
-> EventCoverVideoProcessingError or BusinessAuthNotReadyError
-> showVideoProcessingError()
```

## Did ORCH-0776A Cause This?

No evidence shows ORCH-0776A caused the prepare failure.

ORCH-0776A changed the source-upload transport after upload-intent succeeds. This smoke failure happens before that boundary. The local `test:orch-0776a` suite still passes.

More likely classification: pre-existing or parallel upload-intent/deploy/auth/backend-prep problem exposed while attempting to test ORCH-0776A.

## Blast Radius

Affected:

- Mingla Business Step 4 event video cover upload.
- Draft-auto video cover processing.
- Published-manual cover edit if it uses the same Step 4 upload-intent path.
- Tester runtime verification for ORCH-0776A.
- Broader ORCH-0776/ORCH-0770 video-cover pipeline.

Not directly implicated by this symptom:

- Image/GIF cover upload.
- Cloudinary direct source upload progress.
- Public event video playback.
- Giphy/Pexels provider browsing.
- Ticket checkout.

## What Must Change

Before implementation rework is safe, the team needs one of these evidence paths:

1. Deploy current upload-intent diagnostics and rerun the same smoke with logs.
2. Capture the current client Metro logs around failure, especially:
   - `[CreatorStep4Cover] picked cover asset`
   - `[CreatorStep4Cover] upload-intent-start`
   - `[eventCoverVideoProcessingService] upload-intent-request`
   - `[eventCoverVideoProcessingService] upload-intent-edge-error`
   - `[eventCoverVideoProcessingService] edge-error-payload`
   - `[eventCoverVideoProcessingService] upload-intent-rejected`
   - `[CreatorStep4Cover] video processing error`
3. Read the latest `event_cover_video_jobs` rows for the attempted event once DB read access works. If no row exists, failure is before/at job insert. If row exists, inspect status/failure fields.

If this moves to a rework spec after proof, it should likely require:

- deployed upload-intent/status/apply/cancel parity;
- stage-specific upload-intent error details for auth, permission, invalid event/brand, validation, provider config, role RPC, event read, job insert;
- client tests that prevent generic fallback for known upload-intent details;
- runtime tester gate with client `requestId` matched to Edge logs or job row.

## What Must Not Change

- Do not touch Giphy/Pexels.
- Do not redesign the video processing provider.
- Do not change the ORCH-0776A source-upload progress implementation based on this symptom alone.
- Do not write raw phone video URLs to `events.cover_media_url`.
- Do not make `event_cover_video_jobs` directly client-writable.
- Do not disable auth on upload-intent/status/apply; only webhook should be public with Cloudinary signature verification.

## Regression Tests / Manual Gates Required

Automated tests needed if a rework follows:

- `eventCoverVideoProcessingService.test.ts`
  - maps upload-intent `internal_error` with no detail to a stage-specific retry message, not generic prepare copy;
  - preserves/matches known details: `event_id_invalid_uuid`, `brand_id_invalid_uuid`, `source_size_out_of_range`, `source_duration_out_of_range`, `trim_invalid`, `permission_denied`, `event_not_found`, `provider_not_configured`;
  - proves a valid 8-second native-trimmed clip sends `trimStartMs=0`, `trimEndMs=duration`, valid `sourceBytes`, `eventId`, `brandId`, and `clientRequestId`.
- Edge function Deno tests or checks:
  - unauthenticated;
  - invalid UUID;
  - not found;
  - permission denied;
  - job insert failure returns diagnostic detail safe enough for client/dev logs;
  - provider not configured.
- Runtime manual gate:
  - pick <=15s phone video;
  - record client `requestId`;
  - match request id to upload-intent function stage logs;
  - confirm source-upload begins or exact rejected stage is visible;
  - if source upload begins, then return to ORCH-0776A tester flow.

## Single Probe That Closes The Remaining Gap

Deploy the current `event-cover-video-upload-intent` function, then rerun the same smoke and collect:

1. Metro logs from picker through error.
2. Supabase upload-intent logs for the same `clientRequestId`.
3. Latest `event_cover_video_jobs` row for the event.

Without that, the exact root cause remains below the proof bar.

