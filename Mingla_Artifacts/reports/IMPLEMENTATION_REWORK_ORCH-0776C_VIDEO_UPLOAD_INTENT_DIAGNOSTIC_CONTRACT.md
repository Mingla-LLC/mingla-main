# IMPLEMENTATION REWORK ORCH-0776C - Video Upload Intent Diagnostic Contract

Date: 2026-05-10
Owner: implementor
Status: implemented and verified locally

## Scope

Implemented the narrow ORCH-0776C diagnostic contract for event-cover video upload-intent failures.

This does not guess whether the live failure is auth, payload, permission, DB insert, Cloudinary signing, malformed response, or gateway/network. It makes the next failure preserve enough safe evidence to identify that gate.

## Changed Files

- `mingla-business/src/services/eventCoverVideoProcessingService.ts`
- `mingla-business/src/components/event/CreatorStep4Cover.tsx`
- `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- `supabase/functions/event-cover-video-upload-intent/index.ts`
- `supabase/functions/_shared/eventCoverVideo.ts`

## Diagnostic Contract Now Preserved

Upload-intent failures now carry request-level metadata on thrown errors:

- `requestId`
- `phase`
- `edgeStatus`
- `edgeError`
- `edgeDetail`

For Step 4 video upload-intent failures, the component also attaches/logs:

- `eventId`
- `brandId`
- `applyMode`
- `sourceDurationMs`
- `sourceBytes`

In dev builds, `[CreatorStep4Cover] video processing error` now includes a compact JSON `diagnostic` block that can be copied from Metro logs and matched to Supabase Edge logs.

## Safe Edge Details Added

The upload-intent backend now returns safe details for previously generic internal failures:

- `job_insert_failed`
- `event_read_failed`
- `role_check_failed`
- `role_rank_failed`

These details do not expose secrets, tokens, SQL, service-role data, or private user data.

## User-Facing Behavior

Organiser-facing copy remains safe and short.

Known gates now map to clearer retryable messages where possible, for example:

- `job_insert_failed` -> `Could not create a video processing job. Try again.`
- `role_check_failed` / `role_rank_failed` -> `Could not verify your event permissions before upload. Try again.`
- `event_read_failed` -> `Could not verify this event before upload. Try again.`

The detailed evidence is in dev/operator logs, not production UI clutter.

## Tests Updated

`eventCoverVideoProcessingService.test.ts` now verifies:

- unauthenticated upload-intent responses preserve request id and phase
- validation errors preserve request id, phase, Edge error, and Edge detail
- invoke errors preserve request id, phase, Edge status, Edge error, and Edge detail
- `internal_error` with `job_insert_failed` maps to a distinct retryable message
- `internal_error` with role-check detail maps to a permission-verification message
- malformed upload-intent responses preserve request id and phase
- successful upload-intent still sends `clientRequestId`

`eventCoverMedia.test.ts` now includes a source guard proving Step 4 logs request id, Edge status/error/detail, source duration, source bytes, and a copyable diagnostic JSON block.

## Verification

### ORCH-0776A Regression Gate

Command:

```bash
cd mingla-business
PATH="/opt/homebrew/Cellar/node@22/22.22.2_2/bin:/opt/homebrew/bin:$PATH" /opt/homebrew/bin/npm run test:orch-0776a -- --runInBand
```

Result:

```text
[orch-0776a] video upload progress honesty guard passed
PASS src/services/__tests__/eventCoverVideoProcessingService.test.ts
Test Suites: 1 passed, 1 total
Tests: 9 passed, 9 total
```

Note: watchman emitted the existing recrawl warning; it did not fail the gate.

### Component Guard

Command:

```bash
cd mingla-business
PATH="/opt/homebrew/Cellar/node@22/22.22.2_2/bin:/opt/homebrew/bin:$PATH" /opt/homebrew/bin/npx jest eventCoverMedia.test --runInBand
```

Result:

```text
PASS src/components/ui/__tests__/eventCoverMedia.test.ts
Test Suites: 1 passed, 1 total
Tests: 10 passed, 10 total
```

### TypeScript

Command:

```bash
cd mingla-business
PATH="/opt/homebrew/Cellar/node@22/22.22.2_2/bin:/opt/homebrew/bin:$PATH" /opt/homebrew/bin/npx tsc --noEmit
```

Result: exit code 0, no output.

### Deno Check

Command:

```bash
/Users/sethogieva/.deno/bin/deno check \
  supabase/functions/event-cover-video-upload-intent/index.ts \
  supabase/functions/event-cover-video-status/index.ts \
  supabase/functions/event-cover-video-webhook/index.ts \
  supabase/functions/event-cover-video-apply/index.ts \
  supabase/functions/event-cover-video-cancel/index.ts
```

Result:

```text
Check supabase/functions/event-cover-video-upload-intent/index.ts
Check supabase/functions/event-cover-video-status/index.ts
Check supabase/functions/event-cover-video-webhook/index.ts
Check supabase/functions/event-cover-video-apply/index.ts
Check supabase/functions/event-cover-video-cancel/index.ts
```

### Deno Test

Initial command without env permission failed because `eventCoverVideo.ts` reads `Deno.env` at module load. Rerun with env permission:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/eventCoverVideo.test.ts
```

Result:

```text
ok | 5 passed | 0 failed
```

### Diff Check

Command:

```bash
git diff --check
```

Result: passed.

## Deployment Notes

No database migration was created.

Because Supabase Edge/shared function code changed, the following functions need deployment before runtime testing this contract on device:

- `event-cover-video-upload-intent`
- `event-cover-video-status`
- `event-cover-video-apply`
- `event-cover-video-cancel`

`event-cover-video-webhook` also passed Deno check and may be redeployed as part of the event-cover video function set for parity, though this rework's direct behavior is upload-intent/error diagnostics.

No deployment was performed in this implementation pass.

## Remaining Runtime Manual Gate

After Edge deploy, retry the failed video upload and capture Metro logs from picker through failure/success.

Required evidence:

```text
[CreatorStep4Cover] picked cover asset
[CreatorStep4Cover] upload-intent-start
[eventCoverVideoProcessingService] upload-intent-request
[eventCoverVideoProcessingService] upload-intent-edge-error
[eventCoverVideoProcessingService] edge-error-payload
[eventCoverVideoProcessingService] upload-intent-rejected
[CreatorStep4Cover] video processing error
```

The final Step 4 error log should include a copyable `diagnostic` JSON block with the same `requestId` used by the Edge function.

## Scope Guard Confirmation

Not changed:

- Giphy/Pexels
- public event video playback
- checkout/Stripe/Twilio/Resend
- Cloudinary processing architecture
- raw phone video storage contract
- client writability for `event_cover_video_jobs`
- auth requirements on upload-intent/status/apply/cancel

