# Implementation: ORCH-0774A Video Upload-Intent Diagnostics

Status: implemented and verified locally  
Date: 2026-05-10  
Scope: diagnostic logging only for Step 4 video upload preparation

## Plain-English Summary

Added a matched client/server diagnostic trail for the current blocker: short videos failing with `Could not prepare video upload`. The next failed upload should identify the exact failing gate instead of collapsing everything into one generic message.

This does not change the picker architecture or switch to native trimming yet. It instruments the current path so the next runtime attempt can prove whether the failure is event id, brand id, auth, source size/duration, trim range, permissions, active-job cancellation, job insert, provider config, or malformed Edge response.

## Files Changed

- `mingla-business/src/components/event/CreatorStep4Cover.tsx`
  - Logs picked video metadata with `eventId`, event id source, `brandId`, auth-ready state, MIME type, duration, and size.
  - Logs `upload-intent-start`, `upload-intent-success`, `source-upload-start`, `source-upload-success`, and `status-poll-start`.
  - Logs video processing errors with typed code/message in dev builds.

- `mingla-business/src/services/eventCoverVideoProcessingService.ts`
  - Adds a generated `clientRequestId` to every `event-cover-video-upload-intent` call.
  - Logs sanitized upload-intent request details in dev builds.
  - Logs Edge error payloads, HTTP status, error code, and detail when available.
  - Does not log auth tokens or signed Cloudinary fields.

- `supabase/functions/event-cover-video-upload-intent/index.ts`
  - Accepts `clientRequestId` for log correlation.
  - Logs sanitized stages:
    - `received`
    - `provider_not_configured`
    - `event_id_invalid_uuid`
    - `brand_id_invalid_uuid`
    - `source_size_out_of_range`
    - `source_duration_out_of_range`
    - `trim_range_rejected`
    - `validation_pass`
    - `permission_rejected`
    - `permission_pass`
    - `active_job_cancel_failed`
    - `active_jobs_cancelled`
    - `job_insert_failed`
    - `job_insert_pass`
    - `cloudinary_signature_generated`
    - `provider_payload_update_failed`
    - `returned`
  - Logs Supabase insert/cancel/update error code, message, details, and hint where relevant.

## Verification

Run from `mingla-business`:

```bash
npm run test:orch-0774a
```

Result: PASS. 5 suites, 41 tests.

```bash
npm run test:orch-0770
```

Result: PASS. Strict guard plus TypeScript.

```bash
npx tsc --noEmit
```

Result: PASS.

Run from repo root:

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-upload-intent/index.ts
```

Result: PASS.

```bash
git diff --check
```

Result: PASS.

Note: Jest emitted the existing Watchman recrawl warning. It did not fail the gate.

## Runtime Notes

Client-side logs will appear immediately in Metro/dev console after rebuilding/reloading the business app.

Server-side Edge Function logs require deploying the updated function before a phone/device test against remote Supabase can show the new `event-cover-video-upload-intent` stages:

```bash
/Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv
```

That deploy was not run in this implementation pass.

## What To Watch On The Next Failed Upload

Match the `clientRequestId` from:

```text
[eventCoverVideoProcessingService] upload-intent-request
```

to the Edge Function log:

```text
[event-cover-video-upload-intent] {"requestId":"...","stage":"..."}
```

The decisive stage will tell the next fix:

- `event_id_invalid_uuid`: Step 4 is sending a local draft id instead of a server event UUID.
- `brand_id_invalid_uuid`: brand state is corrupt or stale.
- `source_size_out_of_range`: picker/file metadata exceeds the source cap or reports zero bytes.
- `source_duration_out_of_range`: picker duration is zero/invalid/over 5 minutes.
- `trim_range_rejected`: custom trim values are invalid; native trim should bypass this by sending `0 -> duration`.
- `permission_rejected`: logged-in user/brand/event permission mismatch.
- `active_job_cancel_failed`: old active job or RLS/service issue is blocking replacement.
- `job_insert_failed`: DB constraint/policy/one-active-job issue is blocking new jobs.
- `provider_not_configured`: Cloudinary env is unavailable to the deployed function.
- no Edge log with matching request id: the client never reached the remote function or auth invocation failed before body parse.
