# REVIEW DEPLOY PROBE ORCH-0776B - Video Upload Intent Diagnostics

Date: 2026-05-10
Owner: orchestrator
Reviewed artifact: `reports/DEPLOY_PROBE_ORCH-0776B_VIDEO_UPLOAD_INTENT_DIAGNOSTICS.md`
Verdict: ACCEPTED AS DEPLOY-PARITY FIX / RUNTIME FAILURE STILL OPEN

## Plain-English Read

The stale-backend possibility has been cleared.

Before this deploy/probe, the app was calling an old `event-cover-video-upload-intent` function, so the investigation could not tell whether the latest diagnostic code would explain `Could not prepare video upload`.

Now the five event-cover video functions are deployed and active on version 2. That means if the user still sees `Could not prepare video upload`, the blocker is no longer simply "we forgot to deploy the diagnostics." The live upload-intent request is still being rejected, failing, or being parsed as failed.

## Accepted Evidence

- `event-cover-video-upload-intent` is now active version 2 on project `gqnoajqerqhnvulmnyvv`.
- `event-cover-video-status`, `event-cover-video-apply`, and `event-cover-video-cancel` are also active version 2.
- `event-cover-video-webhook` remains active version 2.
- Deno checks passed for the event-cover video Edge functions.
- `npm run test:orch-0776a` passed.
- `git diff --check` passed.

## Remaining Blocker

The operator still reports `Could not prepare video upload`.

That message belongs to the upload-intent preparation phase, before Cloudinary source upload starts. The next investigation must prove the exact live failure gate with request-level evidence.

The required evidence is the `requestId` emitted by:

```text
[eventCoverVideoProcessingService] upload-intent-request
```

Then forensics must connect that `requestId` to one of:

- client auth/session missing or stale JWT
- bad event id / brand id / draft id payload
- source duration or file size validation rejection
- permission/role failure
- job insert failure
- Cloudinary signing/config failure
- malformed Edge response or client parser mismatch
- network/gateway failure before the function body runs

## Lifecycle Decision

ORCH-0776B remains open.

Next dispatch: `$forensics` with `prompts/FORENSICS_RUNTIME_ORCH-0776C_VIDEO_UPLOAD_INTENT_POST_DEPLOY_FAILURE.md`.

Do not send this to tester yet. Tester can only confirm the same failure; forensics must extract the request id, Edge/runtime logs, and exact rejection gate first.

