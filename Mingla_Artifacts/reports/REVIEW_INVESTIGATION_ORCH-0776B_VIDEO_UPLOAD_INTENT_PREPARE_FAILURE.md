# REVIEW INVESTIGATION ORCH-0776B — Video Upload Intent Prepare Failure

Date: 2026-05-10
Reviewer: orchestrator
Verdict: ACCEPTED / DEPLOY-PROBE NEXT / NOT IMPLEMENTATION-READY

## Plain-English Impact

The latest smoke did not fail because video upload progress is broken. It failed before upload could even start. Mingla is asking Supabase for the signed Cloudinary upload instructions, and that preparation step is failing.

This means we should not keep changing the upload progress UI yet. The next move is to make the backend upload-intent function observable in production, rerun the same smoke, and capture the exact failing gate.

## Evidence Accepted

- Investigation: `reports/INVESTIGATION_ORCH-0776B_VIDEO_UPLOAD_INTENT_PREPARE_FAILURE.md`
- UI boundary: `CreatorStep4Cover.tsx` calls `createEventCoverVideoUploadIntent()` before any source upload/progress state.
- Service boundary: `eventCoverVideoProcessingService.ts` uses fallback `Could not prepare video upload.` for upload-intent edge failures.
- Remote function list proves deploy drift:
  - `event-cover-video-upload-intent` ACTIVE version `1`
  - `event-cover-video-status` ACTIVE version `1`
  - `event-cover-video-apply` ACTIVE version `1`
  - `event-cover-video-cancel` ACTIVE version `1`
  - `event-cover-video-webhook` ACTIVE version `2`
- Cloudinary secret names are present in Supabase secrets.
- Local gates passed:
  - `npm run test:orch-0776a`
  - Deno check for `event-cover-video-upload-intent`

## Findings

### P0 — Failing Stage Is Proven

The failure is pre-source-upload. The app never reaches the new ORCH-0776A byte-progress path because upload-intent does not return usable signed upload fields.

### P0 — Deploy Parity Is Broken

The local upload-intent function contains the diagnostic stages needed to identify the failing gate, but the remote function is still version `1`. Runtime testing against the remote project is therefore not testing the current diagnostic contract.

### P1 — Exact Backend Gate Is Still Unproven

The investigation could not prove whether the live failure is auth/session, gateway, event id, brand id, role/permission, job insert, stale function behavior, or Cloudinary config/signing. The DB job-row query was blocked by Supabase CLI temp-role auth/circuit breaker, and the smoke report did not include the relevant Metro log window.

## Lifecycle Decision

Do not dispatch tester yet.

Do not write a full rework spec yet.

Dispatch a bounded deploy/probe task to make the current upload-intent diagnostics live, then rerun a targeted runtime probe. If the probe proves a code defect, return to orchestrator for an implementation rework prompt.

Next prompt:

`prompts/IMPLEMENTOR_DEPLOY_PROBE_ORCH-0776B_VIDEO_UPLOAD_INTENT_DIAGNOSTICS.md`

## Required Next Evidence

After deployment/probe, Mingla needs:

1. Upload-intent function version updated in Supabase.
2. A fresh failed or successful video upload smoke with Metro logs.
3. Client `clientRequestId` from `[eventCoverVideoProcessingService] upload-intent-request`.
4. Matching upload-intent stage evidence from Edge logs or equivalent.
5. Latest job-row evidence if DB access is available.

Only then can we decide whether the fix is auth/session, permission, event id, DB insert, client error mapping, or provider setup.

