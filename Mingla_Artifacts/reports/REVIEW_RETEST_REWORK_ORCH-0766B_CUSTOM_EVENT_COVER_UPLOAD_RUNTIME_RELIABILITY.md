# Orchestrator Review: ORCH-0766B Runtime Retest Failure

> Date: 2026-05-09
> Reviewed artifact: `Mingla_Artifacts/reports/RETEST_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md`
> Verdict: TESTER FAIL ACCEPTED; IMPLEMENTOR REWORK NEXT

## Plain-English Summary

Tester proved the image-cover symptom is still real. The app has a custom cover URL in the draft, but the Supabase Storage object behind that URL is empty. The URL looks valid enough to pass the current verifier because it returns `HTTP 200` and `content-type: image/png`, but it has `content-length: 0`, so there is no image to render. The event falls back to the hue.

This means the upload path is still not a safe foundation for Giphy, Pexels, brand covers, profile photos, or ticket media.

## Accepted Evidence

Runtime fixture:

- Simulator: `iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)`
- Draft: `Party Like it’s 99`
- Event id: `ca365727-01e2-47e8-bb5e-4a87d469cd85`
- Brand id: `304f90b2-e97e-4365-b221-6f9d161a23ec`
- Stored URL: `https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event_covers/304f90b2-e97e-4365-b221-6f9d161a23ec/ca365727-01e2-47e8-bb5e-4a87d469cd85/moxykcbf-yyq5txhx.png`
- Public URL response:
  - `HTTP/2 200`
  - `content-type: image/png`
  - `content-length: 0`
  - empty-content `etag`
- Downloaded object: 0 bytes
- Screenshot evidence: `/tmp/mingla-runtime/home-with-draft-hue.png`

## Lifecycle Decision

Status moves from:

`IMPLEMENTED -> TESTER RUNTIME RETEST`

to:

`TESTER FAIL -> IMPLEMENTOR REWORK REQUIRED`

Next prompt:

`Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0766B_ZERO_BYTE_EVENT_COVER_UPLOAD.md`

## Rework Scope

Implementor should not restart broad media work. The rework is focused:

- Reject empty local blobs before Supabase upload.
- Reject zero-byte public objects during verification.
- When content length is missing, prove at least one byte exists via bounded GET/range validation.
- Do not update draft state with a public URL unless the stored object is non-empty and media-typed.
- Add regression tests for zero-byte local blob and zero-byte public URL.
- Preserve the existing inline copy, video-duration copy, MOV/QuickTime unsupported decision, storage bucket/path shape, and draft autosave guard behavior.

## Close Guard

ORCH-0766B cannot close until `$tester` reruns runtime QA and proves a newly uploaded supported image produces a non-zero public object and renders instead of hue. Video/GIF runtime proof is still required before provider expansion.

