# RUNTIME QA ORCH-0770 — Full Phone Video Transcode + Compression

## Verdict: BLOCKED

This operator-assisted runtime QA pass cannot verify ORCH-0770 because the required operator inputs were not available in this tester session.

Plain-English impact: the code/deploy layer is ready to try the real flow, but we still have not proven the user-facing promise: an organiser picks a normal phone video, Mingla processes it into a browser-safe MP4, and the public event page plays it instead of showing black/frozen media.

## P0/P1 Findings

No new P0/P1 implementation defect is proven in this pass.

This is blocked by missing runtime inputs, not by a newly observed failure.

## Required Inputs Missing

The dispatched prompt requires all of the following:

- signed-in `mingla-business` runtime session with a brand/event-manager account;
- one real image or GIF picker upload;
- one real phone-shot video under 15 seconds;
- one real phone-shot video over 15 seconds;
- event id used during testing;
- public event URL used for browser playback verification;
- operator observations/screenshots/logs for the picker and playback steps.

None of those runtime artifacts were provided in this turn, so the tester cannot truthfully mark any runtime case passed.

## Evidence Already Accepted From Prior Gate

This runtime QA inherits the prior static/deploy evidence from:

- `reports/TEST_REPORT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION_RUNTIME.md`
- `reports/REVIEW_TEST_REPORT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION_RUNTIME.md`

Accepted prior evidence:

- migration `20260515000012` is applied remotely;
- `event_cover_video_jobs` exists remotely with MP4, 15s, 25 MB constraints and manager SELECT policy;
- all five event-cover video functions are deployed;
- Cloudinary secret names are configured;
- webhook returns function-level `403 missing_signature`, not gateway `401`;
- invalid signature and missing timestamp are rejected;
- `npm run test:orch-0770` passed;
- Jest media tests passed: 27/27;
- Deno edge-function check passed;
- Deno signature tests passed: 5/5.

These prove deployment and static correctness, but not runtime success.

## Runtime Matrix

| Case | Verdict | Evidence |
|---|---:|---|
| Image/GIF regression control | BLOCKED | No operator image/GIF upload result, event id, screenshot/log, or job-row comparison provided. |
| Short phone video under 15s | BLOCKED | No real short-video picker attempt, job id, job row, Cloudinary callback evidence, or public URL provided. |
| Long phone video trim | BLOCKED | No real long-video picker attempt, trim UI observation, job id, job row, or processed output evidence provided. |
| Published event replacement safety | BLOCKED | No already-live event id or replacement attempt provided. |
| Public browser playback + audio control | BLOCKED | No public event URL or browser playback observation provided. |

## Data Proof

No successful processed runtime job was captured in this pass.

Still required:

- `event_cover_video_jobs.id`
- `status`
- `apply_mode`
- `event_id`
- `brand_id`
- `source_mime_type`
- `source_bytes`
- `source_duration_ms`
- `trim_start_ms`
- `trim_end_ms`
- `processed_url`
- `processed_mime_type`
- `processed_bytes`
- `processed_duration_ms`
- `failure_code`
- `failure_message`
- `created_at`
- `updated_at`
- `processed_at`
- `applied_at`
- event row `cover_media_type`
- event row `cover_media_url`

## Public Browser Proof

Not available.

Still required:

- public event URL;
- proof the hero cover uses the processed MP4 URL, not raw MOV/QuickTime;
- proof video is not black;
- proof video loops;
- proof video resumes after share-sheet close while still on page;
- proof sound can be enabled/muted;
- proof mute control is reachable and not hidden under close/share/safe-area chrome.

## Recommendation

Repeat this same runtime QA after the operator performs the five runtime cases in the signed-in app.

Minimum evidence to return with:

1. event id;
2. public event URL;
3. console logs from image upload, short-video upload, and long-video trim/upload;
4. a note saying what was visible in the app after each step;
5. a browser observation for the public page;
6. permission for tester to inspect the latest `event_cover_video_jobs` rows for that event.

Do not close ORCH-0770 and do not start Giphy/Pexels, brand/profile media, or ticket media until this runtime proof passes.

