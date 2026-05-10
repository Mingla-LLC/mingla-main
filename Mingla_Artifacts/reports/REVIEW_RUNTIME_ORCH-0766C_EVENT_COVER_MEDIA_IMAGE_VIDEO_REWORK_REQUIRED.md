# Runtime Review: ORCH-0766C Event Cover Media Rework Required

> Date: 2026-05-09
> Reviewed artifacts:
> - `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0766C_EVENT_COVER_MEDIA_PIPELINE_DEMOLITION_FIX.md`
> - `Mingla_Artifacts/specs/SPEC_ORCH-0766C_EVENT_COVER_MEDIA_PIPELINE_DEMOLITION_FIX.md`
> - Operator runtime evidence from signed-in Mingla Business build
> Verdict: FAIL RUNTIME / IMPLEMENTOR REWORK REQUIRED

## Plain-English Summary

The last implementation moved the architecture in the right direction, but the real app is still not usable for organisers. Users now see the split **Image or GIF** and **Video** choices, and the video path opens trimming, but selected photos still do not render and valid short videos still get rejected.

That means ORCH-0766C is not ready for tester close or Giphy/Pexels expansion. The base custom upload promise is still broken.

## Runtime Evidence

Operator reported after the ORCH-0766C implementation:

- The picker split is visible: **Image or GIF** and **Video** now appear.
- Pictures still do not render.
- Picture upload shows the `Choose a JPEG, PNG, WebP, or GIF.` toast.
- Videos are trimmed by the native picker.
- A trimmed/selected video still gets a toast saying it should be shorter or should be up to 15 seconds.
- An approximately 8-second video also gets rejected, even though the intended limit is 15 seconds max.

## Review Findings

| Finding | Severity | Evidence | Likely mechanism |
|---|---:|---|---|
| Ordinary photos can still be rejected before upload/render | P1 | Runtime toast is the unsupported-image copy; code rejects HEIC/HEIF in `eventCoverMediaRules.ts`; image picker options do not request iOS compatible representation. | iOS photo library may return HEIC/HEIF or another unsupported representation instead of JPEG/PNG/WebP/GIF. |
| Trimmed/short videos can still be rejected | P1 | Runtime trim UI appears, but trimmed video and an 8-second video still get limit/format copy. | Native iOS picker may return QuickTime/MOV even after trim, or duration metadata may be missing/misread after trim; validator still only allows MP4/WebM and requires duration metadata. |
| Code-level tests overstate readiness | P1 | Implementation report correctly marked trim as runtime pending, but current tests only assert source options and mocked bytes. | Tests did not encode real iOS picker output shapes: HEIC image, QuickTime trimmed video, seconds-vs-ms duration normalization, missing post-trim duration fallback. |

## Approved Rework Direction

Rework should stay scoped to ORCH-0766C event-cover custom upload only.

Required behavior:

1. A normal photo selected from iOS Photos must either upload/render or be converted/requested as a supported JPEG/PNG/WebP representation before validation.
2. The app must not tell users to choose JPEG/PNG/WebP/GIF when they selected a normal supported phone photo from the photo library.
3. A native-trimmed video that is <=15 seconds must upload/render if the current runtime can supply or produce a supported video asset.
4. An 8-second video must never fail with “shorter than 15 seconds” or “up to 15 seconds” copy unless it is a genuinely unsupported format and the copy says that exact format problem.
5. Over-15-second videos must still be rejected or kept in trim flow before upload; the draft media URL must not mutate on rejection.

Recommended implementation probes:

- Add or inspect dev logging for the exact picked asset metadata in the failing runtime: `uri`, `mimeType`, `fileName`, `fileSize`, `duration`, `type`.
- For images, use Expo ImagePicker's iOS `preferredAssetRepresentationMode` compatible setting where supported. If that does not return JPEG/PNG/WebP/GIF in runtime, implementor must stop and report whether a small first-party Expo image conversion dependency is needed rather than faking success.
- For videos, determine whether the trimmed output is MOV/QuickTime or whether duration is missing/mis-scaled. If output is QuickTime, the rework must either coerce/export to a supported MP4-compatible representation using current picker options, add an approved narrow conversion path, or return a blocker. Do not leave valid <=15s iOS videos rejected as “too long.”
- Normalize duration defensively only with evidence. Expo docs say `ImagePickerAsset.duration` is milliseconds, while web picker code returns seconds. Native runtime evidence should decide whether a seconds-to-ms guard is needed.

## Lifecycle Decision

Move ORCH-0766C from:

`IMPLEMENTED, PARTIALLY VERIFIED`

to:

`RUNTIME FAIL -> IMPLEMENTOR REWORK READY`

Dispatch prompt:

`Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0766C_EVENT_COVER_MEDIA_IMAGE_VIDEO_RUNTIME_FIX.md`

Expected output:

`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0766C_EVENT_COVER_MEDIA_IMAGE_VIDEO_RUNTIME_FIX.md`

