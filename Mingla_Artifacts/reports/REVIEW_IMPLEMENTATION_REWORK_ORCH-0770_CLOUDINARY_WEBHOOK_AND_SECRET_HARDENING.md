# REVIEW IMPLEMENTATION REWORK ORCH-0770 — Cloudinary Webhook + Secret Hardening

## Verdict

ACCEPTED FOR TESTER RUNTIME VERIFICATION.

Plain-English impact: the previous blocker was not the organiser UI anymore; it was the callback bridge between Cloudinary and Mingla. Cloudinary could process a video, but Mingla could miss the completion callback because the webhook was blocked by Supabase JWT auth and then would have failed Cloudinary signature verification. The rework evidence shows that bridge has been repaired enough to return to end-to-end runtime testing.

## Evidence Reviewed

- Implementation report: `reports/IMPLEMENTATION_REWORK_ORCH-0770_CLOUDINARY_WEBHOOK_AND_SECRET_HARDENING.md`
- Failed tester report that drove the rework: `reports/TEST_REPORT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION_RUNTIME.md`
- Tester prompt ready for rerun: `prompts/TESTER_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION_RUNTIME.md`
- Root cause entry: `ROOT_CAUSE_REGISTER.md` entry `RC-0770`

## Accepted Findings

1. **Webhook gateway blocker fixed.**
   - `supabase/config.toml` now configures `[functions.event-cover-video-webhook] verify_jwt = false`.
   - Remote unsigned smoke no longer returns Supabase gateway `401 UNAUTHORIZED_NO_AUTH_HEADER`.
   - It now reaches function code and returns `403 missing_signature`, which is the correct behavior for an unsigned probe.

2. **Cloudinary signature verification corrected.**
   - Verification now requires `x-cld-signature`, `x-cld-timestamp`, and `CLOUDINARY_API_SECRET`.
   - Implemented signature material is `raw body + timestamp + api secret`.
   - Missing/stale/invalid signatures are rejected with explicit JSON errors.

3. **Regression guard coverage added.**
   - Deno signature tests cover Cloudinary-style valid signature, old body-only failure, missing timestamp, stale timestamp, and invalid signature.
   - ORCH-0770 strict guard now checks for webhook no-JWT config and timestamp-aware verification.

4. **Secret hygiene improved.**
   - `Mingla_Artifacts/cloudinary_details.md` was added to `.gitignore`.
   - The plaintext local credential file was removed from the workspace.
   - Recommendation to rotate Cloudinary API secret is accepted because the secret was previously present in local/chat context.

## Verification Evidence

- `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-webhook/index.ts`
  - PASS, no output.
- `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/eventCoverVideo.test.ts`
  - PASS, `5 passed, 0 failed`.
- `cd mingla-business && npm run test:orch-0770`
  - PASS, `[orch-0770] event cover video processing guard passed`.
- Deploy command:
  - `/Users/sethogieva/bin/supabase functions deploy event-cover-video-webhook --project-ref gqnoajqerqhnvulmnyvv`
  - PASS, function deployed as active version 2.
- Remote unsigned smoke:
  - `HTTP/2 403`
  - body: `{"error":"forbidden","detail":"missing_signature","message":"Cloudinary signature is missing."}`

## Remaining Risks

- The full phone-video journey is not closed until tester proves a real upload can move through Cloudinary processing, webhook callback, job readiness/apply, and public browser playback.
- Cloudinary secret rotation remains an operator security task.
- Existing unrelated dirty work is present in the repo; close/commit must scope files carefully after tester PASS.

## Lifecycle Decision

Move ORCH-0770 from **IMPLEMENTATION REWORK** to **TESTING / RETEST**.

Dispatch:

`[$tester] Mingla_Artifacts/prompts/TESTER_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION_RUNTIME.md`

