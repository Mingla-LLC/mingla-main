# INVESTIGATION ORCH-0776C - Video Upload Intent Post-Deploy Failure

Date: 2026-05-10
Investigator: forensics
Mode: INVESTIGATE
Verdict: FAILING BOUNDARY PROVEN / EXACT LIVE GATE BLOCKED BY MISSING REQUEST ID

## Plain-English Explanation

The video upload is still failing before the actual video file is uploaded.

The app is getting as far as this step:

```text
Ask Supabase for a signed Cloudinary upload intent
```

That is the "prepare video upload" step. If that step succeeds, the app then starts the real file upload and the ORCH-0776A progress bar can appear. If it fails, the app shows `Could not prepare video upload` or a related processing error.

After the deploy/probe, the old explanation, "the remote function is stale," is no longer enough. The `event-cover-video-upload-intent` Edge function is now deployed as active version 2. Cloudinary secret names are also present. So the remaining failure is inside one of the live upload-intent gates:

- auth/JWT did not reach the function;
- request payload had bad event/brand/duration/size values;
- event/brand permission lookup failed;
- job insert failed;
- Cloudinary signature/config generation failed;
- the client received a malformed or unknown response.

The exact one cannot be proven from the current transcript because the latest failed attempt did not include the required client `requestId` log line or matching Supabase Edge logs.

That is not a soft caveat. It is the blocker. Without the `requestId`, we cannot tie the user's failed tap to a specific Edge-function stage.

## User Promise

For a valid <=15 second phone-trimmed video:

```text
Tap Video
-> native picker / trim returns a video asset
-> app validates duration and file size
-> app requests signed Cloudinary upload intent
-> app receives jobId + signed upload fields
-> source upload starts and shows real byte progress
-> Cloudinary processes the final browser-safe video
```

Current reported behavior:

```text
Tap Video
-> picker works
-> app reports "Could not prepare video upload"
-> source upload does not begin
```

## Exact Failing Stage

Proven:

```text
CreatorStep4Cover.processPickedVideo()
-> createEventCoverVideoUploadIntent()
-> supabase.functions.invoke("event-cover-video-upload-intent")
-> no usable upload intent reaches the client
-> showVideoProcessingError()
```

Not proven:

```text
which live Edge-function gate rejected or failed
```

The current evidence does not prove whether the deployed Edge function body received the request, whether a job row was inserted, or whether Cloudinary signing was reached.

## Evidence Table

| Layer | Evidence | What It Proves |
|---|---|---|
| UI/video entry | `mingla-business/src/components/event/CreatorStep4Cover.tsx:381-405` | Video picker uses `allowsEditing: true`, `videoMaxDuration: 15`, H.264 1280x720 export preset, and high quality. |
| Client validation | `mingla-business/src/components/event/CreatorStep4Cover.tsx:423-450` and `mingla-business/src/utils/eventCoverNativeVideo.ts:37-95` | The app validates URI, duration, and file size before calling upload-intent. If validation fails, it shows a trim/file-size message, not the upload-intent prepare path. |
| Upload-intent boundary | `CreatorStep4Cover.tsx:239-267` | The app sets `Preparing secure video upload...`, logs `upload-intent-start`, then calls `createEventCoverVideoUploadIntent()`. |
| Source upload boundary | `CreatorStep4Cover.tsx:273-285` | `source-upload-start` only runs after upload-intent success. The user's prepare failure is before source upload/progress. |
| Client request id | `mingla-business/src/services/eventCoverVideoProcessingService.ts:301-320` | The service generates a `requestId`, logs `upload-intent-request`, and sends it to the Edge function as `clientRequestId`. This is the key correlation handle. |
| Client error mapping | `eventCoverVideoProcessingService.ts:321-336` and `:248-288` | Edge invocation errors, Edge `{ error }` payloads, and malformed responses all funnel through upload-intent error handling. Some unknown/internal paths can still collapse to fallback copy. |
| Edge auth gate | `supabase/functions/event-cover-video-upload-intent/index.ts:48-52`; shared helper `supabase/functions/_shared/eventCoverVideo.ts:58-71` | The function requires a Bearer token and validates it with Supabase Auth. If this fails, it returns `unauthenticated`. |
| Edge validation gates | `event-cover-video-upload-intent/index.ts:77-153` | Deployed code logs and rejects provider config, invalid UUIDs, source size, source duration, and trim range before permission/job insert. |
| Edge permission gate | `event-cover-video-upload-intent/index.ts:155-177`; shared helper `eventCoverVideo.ts:74-112` | The function reads the event row, checks brand id, and requires effective brand rank >= event manager. |
| Edge job insert | `event-cover-video-upload-intent/index.ts:200-231` | Job insert creates `event_cover_video_jobs` row. If insert fails, function returns `internal_error`. |
| Edge Cloudinary signing | `event-cover-video-upload-intent/index.ts:233-278` | Only after job insert does the function build the Cloudinary eager transformation, generate signature, update provider payload, and return upload fields. |
| Schema/RLS | `supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql:6-84` | `event_cover_video_jobs` enforces UUID refs, status/check constraints, trim <=15s, processed MP4 constraints, and one active job per event. |
| RLS | `20260515000012...sql:94-119` | Clients can select jobs only as event managers; there are no direct client insert/update/delete policies. Edge function must use service role for job writes. |
| Deploy parity | `supabase functions list --project-ref gqnoajqerqhnvulmnyvv` on 2026-05-10 | `event-cover-video-upload-intent`, `status`, `apply`, `cancel`, and `webhook` are all active version 2. |
| Provider secret presence | `supabase secrets list --project-ref gqnoajqerqhnvulmnyvv` | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `CLOUDINARY_URL` exist by name/digest. Values were not exposed or verified. |
| Runtime logs | Latest user report | User reported `Could not prepare video upload`, but did not include `[eventCoverVideoProcessingService] upload-intent-request` or the request id. |
| Edge logs access | Supabase CLI 2.98.2 | `supabase functions logs` is not available in this CLI; Edge stage logs require Supabase dashboard/log drain or another log source. |
| Remote job rows | Local shell | `psql` is unavailable in the current shell, so remote `event_cover_video_jobs` rows were not inspected in this pass. |
| Static gates | Deno check | `deno check` passed for the five event-cover video Edge functions. |
| Regression gate | `PATH=... npm run test:orch-0776a -- --runInBand` | ORCH-0776A service tests pass. This supports that the local post-intent progress path is still code-sound. |

## Root Cause Classification

Primary classification:

```text
Blocked because request id / runtime Edge-stage evidence is missing.
```

This is the only evidence-honest classification for the exact live failure.

Confirmed boundary:

```text
pre-source-upload / upload-intent preparation
```

Confirmed production-hardening gap:

```text
The current runtime error path can still leave the operator with generic prepare-failure copy unless the developer console captures the request id and Edge payload.
```

## Six-Field Root Cause Proof

### Confirmed Boundary - Source upload never starts unless upload-intent succeeds

1. File/line: `mingla-business/src/components/event/CreatorStep4Cover.tsx:257-285`.
2. Exact code: `createEventCoverVideoUploadIntent()` is awaited before `setVideoStatusText("Uploading video for processing...")`, before `source-upload-start`, and before `uploadEventCoverVideoSource()`.
3. Current behavior: user sees `Could not prepare video upload`.
4. Expected behavior: valid trimmed video returns intent `{ jobId, upload }`, then source upload begins.
5. Causal chain: upload-intent fails/errors/malformed -> exception reaches `showVideoProcessingError()` -> source upload code is never reached -> progress bar cannot appear.
6. Verification step: collect logs; if no `source-upload-start` after `upload-intent-request`, failure is confirmed pre-source-upload.

Classification: confirmed bug boundary.

### Confirmed Diagnosability Gap - Generic upload-intent fallback still hides the exact gate

1. File/line: `mingla-business/src/services/eventCoverVideoProcessingService.ts:321-336`, `:248-288`; Edge job insert fallback at `supabase/functions/event-cover-video-upload-intent/index.ts:218-230`.
2. Exact code: invocation errors throw `edgeError(error, "Could not prepare video upload.")`; unknown string errors use `payload.detail ?? fallback`; job insert failure returns only `{ error: "internal_error" }`.
3. Current behavior: operator still sees `Could not prepare video upload` and provided no request-stage payload.
4. Expected behavior: runtime failure should preserve a visible/copyable correlation id and stage-specific developer/operator evidence.
5. Causal chain: Edge or gateway failure happens -> client maps to generic fallback or non-actionable copy -> user cannot tell whether this is auth, validation, permission, DB, provider, or malformed response -> repeated back-and-forth continues.
6. Verification step: simulate `internal_error`, gateway error without JSON, validation errors, and forbidden/not_found; assert UI/dev state includes request id and actionable detail.

Classification: production-hardening gap / UX gap.

## What Is Not The Primary Failure

These are less likely or already separated by evidence:

- **Cloudinary source upload progress**: not reached until after upload-intent success.
- **ORCH-0776A progress implementation**: tests pass and code sits after upload-intent.
- **Stale deployed function**: version 2 deploy parity is now proven.
- **Missing Cloudinary secret names**: secret names exist, though value correctness is not visible.
- **Native picker validation**: if this failed, user should see trim/file-size/duration copy from `validateNativeTrimmedEventCoverVideo()`, not upload-intent prepare copy.

## Candidate Live Gates Still Open

The exact live rejection is one of these until logs prove otherwise:

1. Auth/session/JWT unavailable or stale at `supabase.functions.invoke`.
2. Gateway/network failure before Edge body executes.
3. Invalid `eventId` or `brandId`.
4. Valid UUID but event row not found or brand mismatch.
5. User lacks `event_manager` rank for that event/brand.
6. Role RPC/event read failure.
7. `event_cover_video_jobs` active-job cancel or insert failure.
8. Cloudinary signature generation/config response issue.
9. Edge returns a valid error but client maps it too generically.
10. Edge returns malformed payload.

## Whether The Request Reached The Deployed Edge Function

Unproven.

Evidence needed:

- client `requestId` from `[eventCoverVideoProcessingService] upload-intent-request`
- matching Supabase Edge log line `[event-cover-video-upload-intent] {"requestId":"...","stage":"received",...}`

If there is a client `requestId` but no Edge `received`, suspect gateway/JWT/network before function body. If Edge `received` exists, the stage log will identify the gate.

## Whether A Job Row Was Inserted

Unproven.

Evidence needed:

- Edge stage `job_insert_pass`, or
- latest row in `event_cover_video_jobs` for the tested event id.

If there is no job row and Edge reached `validation_pass`, suspect permission/job insert. If there is a row with `source_uploading`, then upload-intent likely succeeded and the reported toast may be from a later path or stale UI.

## Whether Cloudinary Signing Was Reached

Unproven.

Evidence needed:

```text
[event-cover-video-upload-intent] {"stage":"cloudinary_signature_generated",...}
```

If this stage exists, the prepare step likely returned signed upload fields unless the final response was malformed/intercepted.

## Whether Source Upload Started

Not proven in the latest failed attempt.

The current report says the user saw the prepare error. The code requires `upload-intent-success` before `source-upload-start`, so source upload probably did not start, but the exact logs were not provided.

Evidence needed:

```text
[CreatorStep4Cover] upload-intent-success
[CreatorStep4Cover] source-upload-start
```

## Minimal Fix Contract For Implementor

Do not guess the backend gate in product code. Fix the observability hole first and preserve the exact runtime failure.

Required implementation contract:

1. Add request-id propagation to the client error object.
   - `createEventCoverVideoUploadIntent()` already creates `requestId`.
   - Any thrown `EventCoverVideoProcessingError` from upload-intent should carry `requestId`, raw Edge status when present, Edge `error`, and Edge `detail`.

2. Add a developer/operator-visible debug log at final catch.
   - `CreatorStep4Cover.showVideoProcessingError()` should log:
     - request id
     - error code
     - raw Edge error/detail/status
     - event id
     - brand id
     - apply mode
     - source duration/bytes if available

3. Replace generic prepare failure for known upload-intent gates.
   - `internal_error` should become a retryable backend-prep message and preserve request id in dev logs.
   - `forbidden`, `not_found`, invalid UUID, source validation, provider config, and auth should each remain distinct.

4. Add Edge-stage detail for internal failures.
   - Job insert failure should return safe `detail: "job_insert_failed"` rather than only `{ error: "internal_error" }`.
   - Role RPC/event read failures should return safe details such as `event_read_failed`, `role_check_failed`, `role_rank_failed`.
   - Do not expose secrets, SQL text, or private data.

5. Add a one-tap copy/debug string only in development builds or behind a debug flag.
   - The user should be able to paste one compact evidence block containing request id, event id, brand id, code, detail, and phase.

6. Preserve security.
   - Do not make `event_cover_video_jobs` client-writable.
   - Do not disable auth on upload-intent/status/apply/cancel.
   - Do not expose service-role or Cloudinary secrets.

## Regression Tests Required

Add or update tests in the same scoped commit/push as the fix.

Required automated tests:

- `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts`
  - upload-intent gateway error carries request id.
  - upload-intent `{ error: "internal_error", detail: "job_insert_failed" }` maps to a distinct retryable backend-prep error.
  - upload-intent known validation details remain distinct.
  - successful intent still sends `clientRequestId`, `trimStartMs=0`, and `trimEndMs=duration`.

- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` or a Step 4 source guard test
  - Step 4 catch path logs/preserves upload-intent request id for video processing errors.

- Deno/shared Edge tests if local harness exists:
  - invalid auth returns `unauthenticated`.
  - invalid event/brand UUID returns exact detail.
  - job insert failure returns safe exact detail.
  - provider not configured returns exact detail.

Manual runtime gate:

1. Pick a <=15s phone video.
2. Capture:
   - `[CreatorStep4Cover] picked cover asset`
   - `[CreatorStep4Cover] upload-intent-start`
   - `[eventCoverVideoProcessingService] upload-intent-request`
   - any upload-intent error/rejection/malformed log
3. Copy the `requestId`.
4. Match it in Supabase Edge logs.
5. Prove one of:
   - Edge stage `returned` and client starts source upload, or
   - exact Edge rejection stage is visible and mapped correctly.

## Recommended Next Action

Because the exact gate is blocked by missing runtime evidence, there are two valid next moves:

1. **Fastest proof path:** operator reruns the failed upload and pastes Metro logs from picker through error, especially `upload-intent-request`.
2. **Most durable product path:** dispatch `$implementor` for an observability rework that makes the app preserve/copy the request id and exact upload-intent detail whenever this fails.

Given the repeated back-and-forth, I recommend the second path even before a broad feature fix. The system should not require the operator to manually fish through noisy Metro output to know why a core upload failed.

## Confidence

- High confidence on failure boundary: pre-source-upload / upload-intent.
- High confidence that stale Edge deploy is no longer the sufficient explanation.
- Medium confidence that the remaining issue is auth/payload/permission/job-insert/provider-signing/client-parser rather than source upload.
- Low confidence on the exact live gate because the failed run's `requestId` and Edge logs are missing.

