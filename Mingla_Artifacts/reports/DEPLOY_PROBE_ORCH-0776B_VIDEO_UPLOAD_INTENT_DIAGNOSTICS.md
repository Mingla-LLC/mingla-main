# DEPLOY PROBE ORCH-0776B — Video Upload Intent Diagnostics

Date: 2026-05-10
Owner: implementor
Verdict: DEPLOYED / RUNTIME PROBE STILL REQUIRED

## Scope

This was a bounded deploy/probe task for ORCH-0776B. No product code was changed in this task.

Goal:

- make current event-cover video upload-intent diagnostics live in Supabase
- restore event-cover video function deploy parity
- give the operator/tester a clean runtime probe path for the next video upload attempt

Out of scope:

- no Giphy/Pexels
- no checkout
- no event-cover UI redesign
- no schema migration
- no public video playback/audio work

## Pre-Deploy Function Versions

```text
event-cover-video-cancel          ACTIVE version 1  updated 2026-05-09 16:54:44 UTC
event-cover-video-upload-intent   ACTIVE version 1  updated 2026-05-09 16:54:45 UTC
event-cover-video-status          ACTIVE version 1  updated 2026-05-09 16:54:45 UTC
event-cover-video-apply           ACTIVE version 1  updated 2026-05-09 16:54:46 UTC
event-cover-video-webhook         ACTIVE version 2  updated 2026-05-09 17:08:05 UTC
```

## Gates Run

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

Exit code: 0

### ORCH-0776A Regression Gate

Command:

```bash
cd mingla-business
npm run test:orch-0776a
```

Result:

```text
[orch-0776a] video upload progress honesty guard passed
PASS src/services/__tests__/eventCoverVideoProcessingService.test.ts
Test Suites: 1 passed, 1 total
Tests: 7 passed, 7 total
```

Exit code: 0

Note: watchman emitted the existing recrawl warning; it did not fail the test.

### Diff Check

Command:

```bash
git diff --check
```

Result: passed.

## Deployment Commands

```bash
/Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-status --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-webhook --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-apply --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-cancel --project-ref gqnoajqerqhnvulmnyvv
```

Deploy result:

```text
Deployed Functions on project gqnoajqerqhnvulmnyvv: event-cover-video-upload-intent
Deployed Functions on project gqnoajqerqhnvulmnyvv: event-cover-video-status
No change found in Function: event-cover-video-webhook
Deployed Functions on project gqnoajqerqhnvulmnyvv: event-cover-video-webhook
Deployed Functions on project gqnoajqerqhnvulmnyvv: event-cover-video-apply
Deployed Functions on project gqnoajqerqhnvulmnyvv: event-cover-video-cancel
```

## Post-Deploy Function Versions

```text
event-cover-video-cancel          ACTIVE version 2  updated 2026-05-10 20:16:53 UTC
event-cover-video-upload-intent   ACTIVE version 2  updated 2026-05-10 20:16:46 UTC
event-cover-video-status          ACTIVE version 2  updated 2026-05-10 20:16:48 UTC
event-cover-video-apply           ACTIVE version 2  updated 2026-05-10 20:16:51 UTC
event-cover-video-webhook         ACTIVE version 2  updated 2026-05-09 17:08:05 UTC
```

## Code / Migration Notes

- Product code changed in this task: no.
- Migration required: no.
- Edge functions deployed: yes.
- Secrets changed: no.
- Database writes performed directly by Codex: no.

## Runtime Probe Instructions

Run the same video cover smoke again in Mingla Business.

During the attempt, capture the Metro/device logs from picker through either source-upload start or failure. Required log lines:

```text
[CreatorStep4Cover] picked cover asset
[CreatorStep4Cover] upload-intent-start
[eventCoverVideoProcessingService] upload-intent-request
[eventCoverVideoProcessingService] upload-intent-edge-error
[eventCoverVideoProcessingService] edge-error-payload
[eventCoverVideoProcessingService] upload-intent-rejected
[eventCoverVideoProcessingService] upload-intent-ready
[CreatorStep4Cover] upload-intent-success
[CreatorStep4Cover] source-upload-start
```

If it succeeds:

- upload-intent should log `upload-intent-ready`
- Step 4 should reach `source-upload-start`
- then ORCH-0776A progress verification can resume

If it fails:

- the key evidence is the `requestId` from `[eventCoverVideoProcessingService] upload-intent-request`
- use that request id to inspect the deployed Edge function stages in Supabase dashboard logs:
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
  - `active_jobs_cancelled`
  - `job_insert_failed`
  - `job_insert_pass`
  - `cloudinary_signature_generated`
  - `returned`

## Classification Guide For Next Result

- `upload-intent success, source upload begins`: return to ORCH-0776A tester verification.
- `gateway/auth failure`: route to auth/session readiness or token propagation rework.
- `edge validation failure`: fix client payload/validation or server validation copy.
- `permission/not-found failure`: fix event id/brand id/role/source-of-truth handoff.
- `job insert/internal failure`: inspect DB constraint/service-role/RPC edge path.
- `malformed response`: fix edge response shape/client parser.
- `unknown`: collect missing request id, Edge logs, and job-row evidence before changing code.

## Remaining Status

ORCH-0776B is not closed.

The deploy parity bug is fixed. The original runtime failure still needs one fresh smoke to identify whether the upload-intent now succeeds or which precise backend gate rejects it.

