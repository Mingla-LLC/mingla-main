# Orchestrator Review: ORCH-0766C Event Cover Media Pipeline Demolition Fix

> Date: 2026-05-09
> Reviewed artifacts:
> - `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0766C_EVENT_COVER_MEDIA_PIPELINE_DEMOLITION_AUDIT.md`
> - `Mingla_Artifacts/specs/SPEC_ORCH-0766C_EVENT_COVER_MEDIA_PIPELINE_DEMOLITION_FIX.md`
> Verdict: APPROVED FOR IMPLEMENTOR

## Plain-English Summary

The forensics report finally explains why this "simple" media feature kept failing after narrow fixes. Mingla was trying to upload React Native `Blob` objects to Supabase Storage, while the installed Supabase Storage client explicitly warns that React Native `Blob`, `File`, and `FormData` uploads do not work as intended. That is enough to explain the zero-byte image object and likely the short-video display failure.

The investigation also proves a second brittle gate: Step 4 logs `asset.type`, but the upload/validation path ignores it and classifies media only from `mimeType` and `fileName`. Expo picker assets can be missing those fields, so a real selected image can be rejected as "unsupported."

This is approved for implementation. Giphy/Pexels must stay paused until this base custom-upload path passes runtime QA.

2026-05-09 product amendment: the over-15-second video recovery path is no longer allowed to be rejection-only. The implementation contract now requires a simple in-app/native trim route where the current platform/runtime can prove it, starting with Expo ImagePicker's video-only `allowsEditing: true` plus `videoMaxDuration: 15` path on iOS. If that path cannot produce a revalidated <=15-second asset, implementor must fail closed and return the blocker or a scoped dependency proposal instead of shipping "trim elsewhere" as the fix.

## Review Findings

### Approved Root Causes

| Root cause | Status | Evidence |
|---|---:|---|
| React Native Blob upload is the wrong Supabase Storage body | APPROVED | `eventCoverMediaService.ts:86-148` uploads a `Blob`; installed `@supabase/storage-js` docs at `StorageFileApi.ts:181-198` recommend ArrayBuffer and warn Blob/File/FormData do not work as intended in React Native. |
| Picker classification ignores `asset.type` and URI/byte evidence | APPROVED | `CreatorStep4Cover.tsx:127-145` logs `asset.type` but does not pass it; `eventCoverMediaRules.ts:112-140` classifies only MIME/file extension. |
| Video UX lacks a real trim/recovery path | APPROVED, AMENDED | Product limit is 15 seconds; operator saw over-limit rejection with no trim path. Amendment requires native/in-app trim proof where the runtime supports it; if Expo picker trim cannot be proven, implementation must return a blocker. |
| Render failure remains too quiet | APPROVED | `EventCoverMedia` falls back to hue after media error; creator surfaces need persistent error state, not only transient toast. |
| Automated tests miss the runtime contract | APPROVED | `test:orch-0758a` and `test:orch-0763` pass while operator runtime fails; current tests mock Blob success and use source-string render checks. |

### Spec Quality

The spec is implementable and correctly bounded:

- It requires a React Native-safe byte reader and ArrayBuffer/Uint8Array upload.
- It requires picker normalization using MIME, filename, URI extension, picker type, and byte sniffing.
- It preserves the existing `event_covers` bucket and avoids DB work unless a new stored MIME type is introduced.
- It keeps the release video limit at 15 seconds, requires a simple in-app/native trim route where provable, and avoids heavy transcoding scope unless orchestrator approves a later dependency amendment.
- It requires regression tests that would fail against the current implementation.
- It requires a runtime QA matrix before close.

### Implementation Guardrails

Implementor must not broaden this into provider/media expansion:

- no Giphy/Pexels;
- no brand cover media;
- no profile media fix except documenting the shared Blob anti-pattern if encountered;
- no ticket-tier media;
- no Stripe/public-share/admin/consumer work.

If a Supabase migration becomes necessary, the migration prefix must be greater than current local head `20260515000008`, so use `20260515000009...` or later unless newer migrations exist at implementation time.

## Lifecycle Decision

Move ORCH-0766C from:

`FORENSICS/SPEC COMPLETE -> ORCHESTRATOR REVIEW`

to:

`SPEC APPROVED -> IMPLEMENTOR DISPATCH READY`

Dispatch prompt:

`Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0766C_EVENT_COVER_MEDIA_PIPELINE_DEMOLITION_FIX.md`

Expected implementation report:

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0766C_EVENT_COVER_MEDIA_PIPELINE_DEMOLITION_FIX.md`
