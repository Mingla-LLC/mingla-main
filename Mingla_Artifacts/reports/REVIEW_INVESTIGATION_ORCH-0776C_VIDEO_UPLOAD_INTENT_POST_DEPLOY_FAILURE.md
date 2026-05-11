# REVIEW INVESTIGATION ORCH-0776C - Video Upload Intent Post-Deploy Failure

Date: 2026-05-10
Owner: orchestrator
Reviewed artifact: `reports/INVESTIGATION_ORCH-0776C_VIDEO_UPLOAD_INTENT_POST_DEPLOY_FAILURE.md`
Verdict: ACCEPTED / IMPLEMENTOR DIAGNOSTIC REWORK NEXT

## Plain-English Read

The investigation proves where the video upload is breaking, but not yet which backend gate is the exact culprit.

The app fails before the video file starts uploading to Cloudinary. It fails while asking Supabase for the signed Cloudinary upload instructions. That means the progress bar and source-upload implementation are not the current blocker.

The deploy-drift theory is now cleared: the event-cover video functions are active version 2, and Cloudinary secret names exist. The remaining problem is that the app still hides the exact live failure behind `Could not prepare video upload`, unless someone manually captures the `requestId` and matches it to Edge logs.

## Accepted Findings

- Failing boundary is proven: pre-source-upload, inside `createEventCoverVideoUploadIntent()`.
- `source-upload-start` cannot run until upload-intent succeeds.
- Current deployed functions are version 2, so stale Edge deploy is no longer sufficient explanation.
- Cloudinary secret names are present, so missing secret names are no longer the strongest theory.
- Exact live gate is still blocked because the failed run lacked:
  - `[eventCoverVideoProcessingService] upload-intent-request`
  - the generated `requestId`
  - matching Supabase Edge stage logs
  - job-row evidence
- There is a confirmed diagnosability gap: known and internal upload-intent failures can still collapse into generic prepare-failure copy.

## Lifecycle Decision

Move to a narrow `$implementor` rework.

This is not a speculative functional fix for auth, permissions, Cloudinary, or job insert. The next fix is an observability/error-contract repair so the next failure identifies itself without another forensic loop.

Required next prompt:

```text
Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0776C_VIDEO_UPLOAD_INTENT_DIAGNOSTIC_CONTRACT.md
```

Expected output:

```text
Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0776C_VIDEO_UPLOAD_INTENT_DIAGNOSTIC_CONTRACT.md
```

## Scope Guard

Do not implement Giphy/Pexels.
Do not redesign video processing.
Do not change raw/processed storage model.
Do not make job rows client-writable.
Do not disable auth on upload-intent/status/apply/cancel.
Do not chase ORCH-0777 checkout in this prompt.

## Why This Is The Correct Next Move

The operator has already been forced through too many "try again and paste logs" loops. The product should carry its own evidence: request id, phase, Edge status, Edge error, Edge detail, event id, brand id, and whether source upload started.

Once that lands, the next failed smoke can point directly to one of:

- auth/JWT
- invalid payload
- event/brand not found
- permission/RLS role path
- job insert
- Cloudinary signing/config
- malformed response
- network/gateway

