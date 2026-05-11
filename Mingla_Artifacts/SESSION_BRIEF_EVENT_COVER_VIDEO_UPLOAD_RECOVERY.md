# Session Brief - Event Cover Video Upload Recovery

Date: 2026-05-10
Owner model split: Claude for investigation/testing, Codex for implementation/closing

## What We Are Trying To Achieve

We are trying to make Mingla event cover video uploads reliable, understandable, and shippable.

The organiser should be able to:

1. Open the event creator or live-event edit flow.
2. Pick a video from their phone.
3. Use the native phone picker/trim flow for videos over the cover limit.
4. Have Mingla prepare a secure Cloudinary upload.
5. See honest upload/progress states.
6. Get a processed browser-safe video cover applied to the event.
7. See clear, actionable errors if any step fails.

Right now, image/GIF cover upload appears to work, but video upload still fails at the **prepare upload** stage with `Could not prepare video upload`.

## Current Known State

**RESOLVED 2026-05-10 — root cause proven as ORCH-0776D.** Full evidence in
`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0776D_EVENT_COVER_VIDEO_CANCEL_AT_MISSING_COLUMN.md`.

What is proven:

- The failure happens **before source upload starts** — at the upload-intent
  stage (job INSERT into `event_cover_video_jobs`).
- The exact failing gate: **unique-constraint violation on
  `idx_event_cover_video_jobs_one_active_per_event` (partial unique on
  `event_id` WHERE status not terminal).** Postgres ERROR fires 28 ms before
  the Edge 500.
- Why the constraint trips: every prior upload attempt left a `source_uploading`
  row behind. The upload-intent function tries to cancel it via
  `UPDATE … SET cancelled_at = now()` (line 183), but
  **`event_cover_video_jobs.cancelled_at` does not exist** in the production
  schema. The UPDATE silently fails with `42703 column does not exist`, the
  warn-and-continue branch logs and falls through, the INSERT then collides.
- The same schema-drift bug also lives in `event-cover-video-cancel:47`.
- **Stuck row in production**: `d39903e0-5319-4eef-ab82-fbfc2194addb` on event
  `09b4ece6-eabc-4734-8ce3-3a25d90417e4`, stuck in `source_uploading` since
  2026-05-10 19:05 UTC. Every retry has been colliding with it.
- Secondary bug (visibility): deployed v2 of upload-intent + shared helper
  returns bare `{ error: "internal_error" }` without the `detail` slugs that
  the local source already has (ORCH-0776C work was committed but not yet
  deployed).

Candidates ruled out by this proof:

- ~~auth/session/JWT not available~~ (function executed 740 ms, reached DB)
- ~~bad event/brand/duration/size payload~~ (validation passed; values logged
  by client are valid)
- ~~event/brand permission lookup fails~~ (would return 403 `forbidden`,
  not 500)
- ~~Cloudinary signing/config fails~~ (function never reached signing —
  it died at INSERT)
- ~~malformed response~~ (response is the labeled 500)
- ~~client error mapping~~ (mapping is correct given the bare payload)

Fix: ORCH-0776D — see `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0776D_EVENT_COVER_VIDEO_JOBS_CANCEL_AT_AND_DETAIL_DEPLOY.md`.
Canonical owner: Codex `implementor-mingla`.

## Key Artifacts

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0776C_VIDEO_UPLOAD_INTENT_POST_DEPLOY_FAILURE.md`
- `Mingla_Artifacts/reports/DEPLOY_PROBE_ORCH-0776B_VIDEO_UPLOAD_INTENT_DIAGNOSTICS.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0776A_EVENT_COVER_UPLOAD_PROGRESS_AND_HONEST_PROCESSING.md`
- `Mingla_Artifacts/prompts/FORENSICS_RUNTIME_ORCH-0776C_VIDEO_UPLOAD_INTENT_POST_DEPLOY_FAILURE.md`
- `Mingla_Artifacts/PRIORITY_BOARD.md`
- `Mingla_Artifacts/MASTER_BUG_LIST.md`
- `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`

## Claude Role

Claude will own investigation and testing.

Use Claude for:

- forensic runtime investigation;
- proving the exact upload-intent failure gate;
- reading Metro/device logs;
- matching client `requestId` to Supabase Edge logs;
- validating whether the failure is auth, payload, permission, job insert, Cloudinary signing, malformed response, or client mapping;
- independent tester verification after Codex implements;
- PASS/FAIL verdicts with evidence.

Claude should not implement product code for this track.

## Codex Role

Codex will own implementation and closing.

Use Codex for:

- implementing the evidence-backed fix after Claude proves the root cause;
- adding or updating regression tests;
- improving diagnostic logging/error mapping if needed;
- running local gates;
- preparing close evidence;
- committing and pushing scoped changes;
- updating Mingla artifacts for lifecycle closure.

Codex should not guess the backend gate without the forensic evidence.

## Immediate Next Step

Run a failed video-upload attempt and capture the Metro logs from picker through failure.

The most important line is:

```text
[eventCoverVideoProcessingService] upload-intent-request
```

That line contains the `requestId`.

Claude then needs to match that `requestId` to Supabase Edge logs for:

```text
received
provider_not_configured
event_id_invalid_uuid
brand_id_invalid_uuid
source_size_out_of_range
source_duration_out_of_range
trim_range_rejected
validation_pass
permission_rejected
permission_pass
active_jobs_cancelled
job_insert_failed
job_insert_pass
cloudinary_signature_generated
returned
```

## Success Criteria

This session is successful when:

- the exact failing gate is proven;
- the fix is implemented against that proven gate;
- organisers no longer see a generic `Could not prepare video upload` without actionable detail;
- valid <=15s phone videos reach source upload and show progress;
- processed Cloudinary MP4 covers can be applied;
- tests prevent regression;
- Claude independently verifies the fix;
- Codex commits, pushes, and closes the scoped work.

## Scope Guard

Do not move to Giphy/Pexels until this base custom Mingla upload path is stable.

Do not broaden into ticket checkout, Stripe, Twilio, Resend, public-page redesign, or brand/profile/ticket media during this track.

