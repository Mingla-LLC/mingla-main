# SPEC ORCH-0766F - Real-Device MOV Event Cover Storage MIME Fix

> Date: 2026-05-09  
> Mode: Forensics / SPEC  
> Source investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0766E_EVENT_COVER_VIDEO_CLEAN_RUNTIME_BOUNDARY_PROBE.md`  
> Status: Ready for implementor. Root cause is proven for real-device iPhone MOV uploads.

## Plain-English Contract

Short iPhone-shot cover videos fail because the app now correctly accepts MOV/QuickTime, but the Supabase Storage bucket still only allows MP4/WebM video MIME types.

Fix the storage contract so `event_covers` accepts:

```text
video/quicktime
```

Then retest the same real-device 8-second `IMG_0154.MOV` path.

## Proven Evidence

Real-device picker payload:

```json
{
  "duration": 7665,
  "fileName": "IMG_0154.MOV",
  "fileSize": 26448972,
  "mimeType": "video/quicktime",
  "type": "video"
}
```

Real-device upload-start:

```json
{
  "contentType": "video/quicktime",
  "durationMs": 7665,
  "fileName": "IMG_0154.MOV",
  "fileSize": 26448972,
  "mediaType": "video",
  "pickerType": "video",
  "storagePath": "22a18413-bfbf-4087-9ba7-45f70deba0f3/98e880f3-43ef-47ab-a530-deaa117b21a7/moy49jl3-fbonypvw.mov"
}
```

Public object probe for that path:

```text
HTTP/2 400
{"statusCode":"404","error":"not_found","message":"Object not found"}
```

Current source accepts `video/quicktime`:

- `mingla-business/src/utils/eventCoverMediaRules.ts` maps `.mov`, `.qt`, and `video/quicktime`.
- `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts` already verifies short MOV upload behavior at service level.

Current storage migration does not accept `video/quicktime`:

- `supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql` allows only `video/mp4` and `video/webm` for videos.

Current linked remote migration head is:

```text
20260515000009
```

Therefore the new migration prefix must be greater than both local and remote heads:

```text
20260515000010
```

## Scope

In:

- Supabase Storage bucket `event_covers`.
- `allowed_mime_types` update for `video/quicktime`.
- Regression guard that prevents the repo from reintroducing app/storage MIME drift.
- Manual real-device retest contract.

Out:

- No Giphy/Pexels.
- No new media dependency.
- No broad video trimmer rewrite.
- No changes to file-size limit, path shape, RLS ownership, public read policy, or event draft UI unless a test guard requires a tiny source assertion.
- No edits to already-applied migrations unless the implementor explicitly documents why. Use a new monotonic migration.

## Implementation Requirements

### Database / Storage

Create a new migration:

```text
supabase/migrations/20260515000010_orch_0766f_event_cover_quicktime_mime.sql
```

The migration must update the existing `event_covers` bucket so the final allow-list contains all existing values plus `video/quicktime`:

```text
image/jpeg
image/png
image/webp
image/gif
video/mp4
video/webm
video/quicktime
```

It must preserve:

- `public = true`;
- `file_size_limit = 31457280`;
- existing public read policy;
- existing event-manager insert/update/delete RLS policies;
- existing `{brandId}/{eventId}/{filename}` path contract.

The migration should be idempotent. It should not duplicate MIME entries if rerun.

Suggested shape:

```sql
UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT ARRAY(
    SELECT DISTINCT mime
    FROM unnest(
      COALESCE(allowed_mime_types, ARRAY[]::text[])
      || ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'video/mp4',
        'video/webm',
        'video/quicktime'
      ]::text[]
    ) AS mime
    ORDER BY mime
  )
),
file_size_limit = 31457280,
public = true
WHERE id = 'event_covers';
```

If the implementor chooses a different SQL shape, it must still be idempotent and preserve the full bucket contract.

### App Code

No app behavior change is expected unless verification reveals a fresh mismatch.

The existing app code should continue to:

- classify MOV/QuickTime as `mediaType: "video"`;
- infer content type as `video/quicktime`;
- use `.mov` storage extension for `video/quicktime`;
- enforce 15 seconds and 30 MB before upload;
- call `verifyEventCoverPublicUrl` after upload.

### Tests / Guards

Add or update a repo-running guard so this exact bug cannot return.

Required coverage:

1. A static migration guard asserts a migration path after `20260515000009` contains `video/quicktime` for `event_covers`.
2. Existing service tests continue to prove short `video/quicktime` uploads use content type `video/quicktime` and `.mov`.
3. Existing service tests continue to prove over-15-second MOV is rejected before upload.
4. No test should weaken the 30 MB file-size limit.

Acceptable locations:

- a targeted Jest guard under `mingla-business/src/**/__tests__/`;
- or a strict-grep script under `.github/scripts/strict-grep/` plus package script wiring, matching existing repo patterns.

## Verification Commands

From `mingla-business/`, run the relevant existing gates:

```bash
/opt/homebrew/bin/npm run test:orch-0758a -- --runInBand --testNamePattern='cover|video|MOV|QuickTime'
/opt/homebrew/bin/npm run test:orch-0763 -- --runInBand --testNamePattern='cover|video|MOV|QuickTime'
/opt/homebrew/bin/npx tsc --noEmit
/opt/homebrew/bin/npx eslint src/services/eventCoverMediaService.ts src/utils/eventCoverMediaRules.ts
```

Also run any new strict-grep/Jest guard added for `video/quicktime` storage coverage.

Run:

```bash
git diff --check
```

## Deployment Gate

After implementation, the operator must apply the new migration to the linked Supabase project:

```bash
/Users/sethogieva/bin/supabase db push
```

Do not mark this ready from local tests alone. This bug is a storage deployment contract bug.

## Manual Runtime Retest

On the real phone, using the same flow:

```text
Event creator Step 4 -> Upload cover -> Video -> select phone-shot <=15s MOV
```

Expected logs:

```text
[CreatorStep4Cover] picked cover asset ... "mimeType": "video/quicktime" ... "duration": <15000
[eventCoverMedia] upload-start ... "contentType": "video/quicktime"
[eventCoverMedia] upload-verified ... "mediaType": "video"
[CreatorStep4Cover] cover media draft update queued ... "coverMediaType": "video"
```

Expected UI:

- No failed upload toast.
- Cover preview renders the video frame.
- `Replace cover` and `Remove` appear.
- Draft autosave reaches saved or no longer shows a schema-cache failure.
- Reloading the draft still shows the cover.

Expected public URL:

```text
HEAD -> 200
content-type -> video/quicktime or compatible video/*
content-length -> >0
GET Range bytes=0-0 -> 206 or otherwise non-empty video response
```

## Rollback Safety

This is additive at the storage-bucket contract level. Allowing `video/quicktime` matches current app code and user-facing copy. If app code rolls back to MP4/WebM-only, the broader bucket allow-list is harmless but should be tracked as a product contract decision.

## Success Criteria

This work is complete only when:

1. New monotonic migration exists with prefix `20260515000010` or later.
2. `event_covers.allowed_mime_types` includes `video/quicktime` after remote deploy.
3. Existing MP4/WebM/image/GIF behavior remains unchanged.
4. Real-device iPhone MOV under 15 seconds uploads and verifies.
5. Step 4 renders the uploaded MOV cover.
6. A regression guard fails if storage MIME support and app MOV support drift again.
