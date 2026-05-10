# Orchestrator Review: ORCH-0766B Custom Event Cover Upload Runtime Reliability

> Date: 2026-05-09
> Reviewed artifact: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md`
> Verdict: APPROVED FOR TESTER RETEST, NOT CLOSED

## Plain-English Summary

The implementation appears to fix the brittle parts of custom event-cover upload: organisers now see limits before upload, invalid videos get clearer errors, uploads keep their file type/content type aligned, and a render failure should no longer quietly turn back into the color hue without telling the organiser.

This is still not ready to call fixed until a real business-app runtime test proves that supported photos, GIFs, and videos actually display after upload. The original operator evidence was runtime-specific: videos failed, and photos appeared to upload but still showed the hue. Automated tests cannot fully prove that path.

## Review Findings

### No Static Blocker Found

The implementor report shows the rework stayed inside the approved ORCH-0766B scope:

- Event creator Step 4 now communicates upload limits inline.
- Picker configuration was updated to the SDK-54 style `["images", "videos"]`.
- GIF preservation was improved by using full picker quality and no editing.
- Missing video duration now has its own `video_duration_unknown` failure instead of pretending the video is too long.
- MOV/QuickTime remains unsupported in this pass, but the unsupported-format copy now points organisers toward MP4/WebM.
- Storage path extension and uploaded content type are now derived from the selected asset.
- Upload success is gated by public URL verification.
- `EventCoverMedia` can notify the upload surface when a media render fails.
- Server-draft stale echo protection now has a cover-media regression guard.

### Runtime Gate Still Required

Do not close ORCH-0766B yet. The following cannot be proven from static tests alone:

- Whether Expo ImagePicker returns real device photo/GIF/video metadata in the exact shape the code expects.
- Whether Supabase Storage public URLs and content-type verification work for real uploaded assets in the target environment.
- Whether the Step 4 preview renders uploaded images/videos instead of falling back to hue.
- Whether publish/edit/public/checkout surfaces keep rendering the uploaded cover after draft autosave, reopen, cold restart, and publish.

### Accepted Limitation

MOV/QuickTime is still not supported. That is acceptable for this bounded reliability rework only if the runtime UX is honest and clear. If organisers commonly upload iPhone camera videos and product wants those to work, the next feature should be a separate media-normalization/transcoding spec.

## Evidence Reviewed

- `Mingla_Artifacts/specs/SPEC_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md`
- Implementor-reported verification:
  - `npm run test:orch-0758a -- --runInBand` PASS
  - `npm run test:orch-0763 -- --runInBand` PASS
  - `npx tsc --noEmit` PASS
  - targeted ESLint PASS
  - `git diff --check` PASS

## Lifecycle Decision

Status moves from:

`SPEC REWORK READY -> IMPLEMENTED`

to:

`IMPLEMENTED -> TESTER RUNTIME RETEST REQUIRED`

Next prompt:

`Mingla_Artifacts/prompts/TESTER_RETEST_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md`

