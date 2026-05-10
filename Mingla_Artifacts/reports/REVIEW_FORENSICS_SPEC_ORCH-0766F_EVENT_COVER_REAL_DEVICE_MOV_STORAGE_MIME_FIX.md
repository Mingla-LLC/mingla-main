# REVIEW FORENSICS/SPEC ORCH-0766F - Event Cover Real-Device MOV Storage MIME Fix

> Date: 2026-05-09  
> Mode: Orchestrator Review  
> Reviewed inputs:
> - `reports/INVESTIGATION_ORCH-0766E_EVENT_COVER_VIDEO_CLEAN_RUNTIME_BOUNDARY_PROBE.md`
> - `specs/SPEC_ORCH-0766F_EVENT_COVER_REAL_DEVICE_MOV_STORAGE_MIME_FIX.md`
> - `prompts/IMPLEMENTOR_ORCH-0766F_EVENT_COVER_REAL_DEVICE_MOV_STORAGE_MIME_FIX.md`
> Verdict: APPROVED for `$implementor` dispatch.

## Plain-English Decision

This is no longer a broad mystery about video upload.

The simulator MP4 path passed. The user's real phone MOV path failed after `upload-start`, and the reason is now specific: the app sends iPhone videos as `video/quicktime`, but the Supabase `event_covers` bucket was originally configured to allow only `video/mp4` and `video/webm` for videos.

The correct next move is a narrow storage migration plus a regression guard. Do not restart a broad event-cover rewrite.

## Evidence Accepted

- Real-device picker payload was valid: `duration: 7665`, `fileName: IMG_0154.MOV`, `fileSize: 26448972`, `mimeType: video/quicktime`.
- App passed local validation and byte reading because `[eventCoverMedia] upload-start` logged with `contentType: video/quicktime`.
- Public probe of the exact storage path returned object-not-found, and no `upload-verified` log followed.
- Current app code accepts `video/quicktime`.
- Existing storage migration `20260515000002_orch_0758a_event_cover_storage.sql` omits `video/quicktime` from `allowed_mime_types`.
- Linked remote migration head is currently `20260515000009`, so the required storage migration must be `20260515000010` or later.

## Scope Decision

Approved implementation scope:

- Add monotonic migration `20260515000010_orch_0766f_event_cover_quicktime_mime.sql`.
- Update `event_covers.allowed_mime_types` idempotently to include `video/quicktime`.
- Preserve public bucket status, 30 MB file limit, RLS policies, and storage path structure.
- Add a repo-running guard so app MOV support and storage MIME support cannot drift again.

Explicit non-goals:

- No Giphy/Pexels.
- No brand/profile/ticket media expansion.
- No trimmer rewrite.
- No new media dependency.
- No broad event-cover pipeline rewrite.

## Deployment Gate

This cannot close from local implementation alone. After implementor returns:

1. Operator runs `/Users/sethogieva/bin/supabase db push`.
2. Real-device retest repeats the same <=15s iPhone MOV flow.
3. Tester or operator evidence must show `upload-verified`, rendered preview, and durable draft/server save behavior.

## Next Dispatch

Dispatch:

```text
[$implementor](/Users/sethogieva/Desktop/mingla-main/.codex/skills/implementor-mingla/SKILL.md) take over
```

Use prompt:

```text
Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0766F_EVENT_COVER_REAL_DEVICE_MOV_STORAGE_MIME_FIX.md
```
