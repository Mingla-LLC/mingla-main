# INVESTIGATION ORCH-0766E - Event Cover Video Clean Runtime Boundary Probe

> Date: 2026-05-09  
> Mode: Forensics / Runtime Probe  
> Surface: `mingla-business` event creator Step 4 cover video upload  
> Verdict: VIDEO PATH PASSES in the clean runtime. The current blocker shown in the console is server draft autosave failing because app code now writes/selects `events.currency`, but the linked Supabase database has not applied migration `20260515000009`.

## Plain-English Verdict

The clean 8-second video test did **not** fail at picker, validation, upload, public URL verification, local draft state, or Step 4 rendering.

The fresh controlled upload passed:

```text
picker payload -> duration validation -> file read -> storage upload -> public URL verification -> local draft update -> Step 4 video preview
```

The ugly red console/toast is a different problem: the app is trying to autosave the draft to the `events.currency` column, but the remote database does not have that column yet. That keeps the wizard in `Unsaved changes - retrying` and can prevent the cover from being durably saved to the server, even though the local preview now works.

Boundary classification from the ORCH-0766E decision tree: `passes` for the media upload/render path, with a separate confirmed `schema_migration_mismatch` for server draft autosave.

## Preconditions

Precondition status: PASSED.

- Booted simulator: `iPhone 17 Pro`, UDID `17091E60-C3B6-4167-980D-60C348E177F6`, iOS `26.4`.
- App bundle: `com.sethogieva.minglabusiness`.
- App container:

```text
/Users/sethogieva/Library/Developer/CoreSimulator/Devices/17091E60-C3B6-4167-980D-60C348E177F6/data/Containers/Data/Application/C509364A-577E-42EE-8306-10422F6BD63B
```

- Metro process: `node /Users/sethogieva/Desktop/mingla-main/mingla-business/node_modules/.bin/expo start --clear`, port `8081`.
- Metro bundle proof: served iOS bundle contains:

```text
EVENT_COVER_UPLOAD_LIMIT_COPY = "Upload an image, GIF, or MP4, MOV, or WebM video up to 15 seconds and 30 MB."
mov: "video/quicktime"
qt: "video/quicktime"
"video/quicktime": "mov"
```

- Step 4 screenshot before the fresh pick:

```text
/tmp/orch0766e-current-now.png
```

Visible inline copy in the screenshot:

```text
Upload an image, GIF, or MP4, MOV, or WebM video up to 15 seconds and 30 MB.
```

The stale `MP4/WebM` runtime condition from ORCH-0766D is gone.

## Fresh Runtime Probe

Fresh video selected:

```text
orch0766d_8s.mp4
```

Captured JS picker payload:

```json
{
  "duration": 7693.333333,
  "fileName": "orch0766d_8s.mp4",
  "fileSize": 8367682,
  "mimeType": "video/mp4",
  "type": "video",
  "uri": "file:///Users/sethogieva/Library/Developer/CoreSimulator/Devices/17091E60-C3B6-4167-980D-60C348E177F6/data/Containers/Data/Application/C509364A-577E-42EE-8306-10422F6BD63B/Library/Caches/ImagePicker/36A0DD4D-FFD3-4B66-ACAE-34F763F3A57C.mp4"
}
```

Interpretation:

- Expo returned duration in milliseconds.
- `7693.333333ms` is `7.693333s`, below the 15-second limit.
- MIME/type/file extension are all supported by current code.
- This disproves the current-runtime theory that an 8-second MP4 is rejected as too long.

## Upload And Public URL Proof

Captured upload-start log:

```json
{
  "contentType": "video/mp4",
  "durationMs": 7693.333333,
  "fileName": "orch0766d_8s.mp4",
  "fileSize": 8367682,
  "mediaType": "video",
  "pickerType": "video",
  "storagePath": "22a18413-bfbf-4087-9ba7-45f70deba0f3/98e880f3-43ef-47ab-a530-deaa117b21a7/moy413ux-dbgw0n0w.mp4"
}
```

Captured upload-verified log:

```json
{
  "mediaType": "video",
  "publicUrl": "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event_covers/22a18413-bfbf-4087-9ba7-45f70deba0f3/98e880f3-43ef-47ab-a530-deaa117b21a7/moy413ux-dbgw0n0w.mp4",
  "storagePath": "22a18413-bfbf-4087-9ba7-45f70deba0f3/98e880f3-43ef-47ab-a530-deaa117b21a7/moy413ux-dbgw0n0w.mp4"
}
```

Public URL HEAD proof:

```text
HTTP/2 200
content-type: video/mp4
content-length: 8367682
accept-ranges: bytes
access-control-allow-origin: *
last-modified: Sat, 09 May 2026 08:56:49 GMT
```

Range proof:

```text
HTTP/2 206
content-type: video/mp4
content-length: 1
content-range: bytes 0-0/8367682
```

Downloaded object proof:

```text
/tmp/orch0766e-fresh-video.mp4: ISO Media, Apple QuickTime movie, Apple QuickTime (.MOV/QT)
size: 8367682 bytes
duration_seconds=7.693333
```

The `file` command labels the container as QuickTime/ISO Media even though storage serves it as `video/mp4`. That did not break upload verification or Step 4 rendering in this run.

## Draft State And Renderer Proof

Captured draft update log:

```json
{
  "coverMediaType": "video",
  "coverMediaUrl": "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event_covers/22a18413-bfbf-4087-9ba7-45f70deba0f3/98e880f3-43ef-47ab-a530-deaa117b21a7/moy413ux-dbgw0n0w.mp4",
  "storagePath": "22a18413-bfbf-4087-9ba7-45f70deba0f3/98e880f3-43ef-47ab-a530-deaa117b21a7/moy413ux-dbgw0n0w.mp4"
}
```

AsyncStorage draft proof after the fresh upload:

```json
{
  "version": 9,
  "draft": {
    "id": "98e880f3-43ef-47ab-a530-deaa117b21a7",
    "coverMediaUrl": "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event_covers/22a18413-bfbf-4087-9ba7-45f70deba0f3/98e880f3-43ef-47ab-a530-deaa117b21a7/moy413ux-dbgw0n0w.mp4",
    "coverMediaType": "video",
    "currency": null,
    "clientRevision": 150,
    "lastStepReached": 3,
    "updatedAt": "2026-05-09T08:56:48.913Z"
  }
}
```

Step 4 screenshot after fresh upload:

```text
/tmp/orch0766e-after-fresh-8s.png
```

The screenshot shows:

- hue fallback is no longer shown in the main cover preview;
- `Replace cover` and `Remove` are visible;
- the video frame is rendered in the cover area;
- the red autosave toast is still visible.

No `[EventCoverMedia] media render failed` or `[CreatorStep4Cover] cover media render failed` log appeared after the fresh upload.

Renderer classification: passed for this fresh 8-second public video URL.

## App-Container File Proof

Files modified around the fresh run:

```text
2026-05-09 04:56:48 .../RCTAsyncLocalStorage_V1/manifest.json
2026-05-09 04:56:48 .../RCTAsyncLocalStorage_V1/99e676cd6acf14936cf089023a1fcfb1
2026-05-09 04:56:48 .../Library/HTTPStorages/.../httpstorages.sqlite-wal
2026-05-09 04:56:50 .../Library/Caches/.../Cache.db-wal
```

The ImagePicker source URI for the fresh asset was:

```text
.../Library/Caches/ImagePicker/36A0DD4D-FFD3-4B66-ACAE-34F763F3A57C.mp4
```

The draft persisted locally immediately after upload.

## Confirmed Separate Root Cause: Server Draft Autosave Schema Mismatch

Console error after the otherwise-successful upload:

```json
{
  "code": "PGRST204",
  "details": null,
  "hint": null,
  "message": "Could not find the 'currency' column of 'events' in the schema cache"
}
```

Migration state:

```text
Local          | Remote
20260515000009 |
```

Local migration `supabase/migrations/20260515000009_orch_0769_app_wide_currency.sql` adds:

```sql
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS currency char(3) NOT NULL DEFAULT 'GBP';
```

Current app code now selects and writes `currency` for drafts:

- `mingla-business/src/services/eventDrafts.ts` includes `currency` in `EVENT_DRAFT_SELECT`.
- `mingla-business/src/utils/serverDraftEventMapper.ts` includes `currency: draft.currency` in both `draftToServerInsert` and `draftToServerUpdate`.
- `mingla-business/src/hooks/useServerDraftEvents.ts` logs autosave mutation failures as `[useServerDraftAutosave] Operation failed:`.

### Six-Field Proof

- File/line: `mingla-business/src/services/eventDrafts.ts` `EVENT_DRAFT_SELECT`; `mingla-business/src/utils/serverDraftEventMapper.ts` `draftToServerUpdate`; `supabase/migrations/20260515000009_orch_0769_app_wide_currency.sql`.
- Exact code/schema: the client selects/writes `events.currency`; the local migration adds `events.currency`; the linked remote migration list shows `20260515000009` missing remotely.
- Current behavior: after the successful cover upload, server autosave fails with `PGRST204: Could not find the 'currency' column of 'events' in the schema cache`.
- Expected behavior: server draft autosave should update `cover_media_url`, `cover_media_type`, and other draft fields without a schema-cache error.
- Causal chain: ORCH-0769 app code expects `events.currency` -> remote DB has not applied ORCH-0769 migration -> PostgREST rejects select/update involving `currency` -> autosave mutation fails -> wizard shows `Unsaved changes - retrying` even though local media preview works.
- Verification step: apply/push migration `20260515000009`, restart/reload the app or wait for PostgREST schema cache refresh, then repeat a small draft edit and confirm no `PGRST204` and no `Unsaved changes - retrying`.

Classification: confirmed bug / deployment-state mismatch / launch blocker for durable server draft saves. It is not the root cause of the fresh media upload/render path.

## Weird Console Logs

Classified as follows:

- `PGRST204 currency`: causal for autosave failure and red toast; not causal for picker/upload/public URL/local preview.
- `allowsFullscreen prop is deprecated`: unrelated hardening warning from `expo-video`; not causal in this run.
- Require-cycle warnings: unrelated pre-existing architecture warnings; not causal in this run.
- No video render failure payload appeared after the fresh upload.

## What Is Possible Right Now

In this clean runtime, for the tested draft and seeded 7.69-second MP4:

- User can pick a video.
- App receives a valid duration.
- App enforces the 15-second limit correctly.
- App uploads video bytes to Supabase Storage.
- Public URL verifies.
- Local draft state receives `coverMediaUrl` and `coverMediaType: "video"`.
- Step 4 preview renders the uploaded video frame.

## What Is Not Reliable Right Now

- Server autosave is not reliable until `events.currency` exists remotely.
- Because autosave fails, the uploaded cover may remain local-only from the organiser's point of view until the migration is applied.
- Cross-device draft recovery, server refetch, and publish paths should not be trusted from this dirty schema/app state without retesting after the migration is applied.

## Real-Device Addendum

After this report, the operator tested on a real phone and supplied Metro logs for an 8-second phone-shot MOV:

```json
{
  "duration": 7665,
  "fileName": "IMG_0154.MOV",
  "fileSize": 26448972,
  "mimeType": "video/quicktime",
  "type": "video",
  "uri": "file:///var/mobile/Containers/Data/Application/13F1AE87-3D4E-4FC1-A954-870E2867F58C/Library/Caches/ImagePicker/DC5D0E0A-1701-4749-9E1F-D7D3974F3778.MOV"
}
```

Upload-start emitted:

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

No upload-verified log followed. Public URL probe for that exact storage path returned:

```text
HTTP/2 400
{"statusCode":"404","error":"not_found","message":"Object not found"}
```

This changes the real-device verdict for iPhone MOV uploads:

- Picker passed.
- Duration passed: `7665ms`, below 15 seconds.
- File size passed: `26,448,972` bytes, below 30 MB.
- Local file read passed, because upload-start logs only after bytes are read.
- App media classification passed: `mediaType: "video"`.
- Storage upload did not create an object.

Root cause is now proven for phone-shot MOV: storage bucket MIME policy is stale.

The app now sends `contentType: "video/quicktime"`, but `supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql` configured `event_covers.allowed_mime_types` as:

```sql
ARRAY[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm'
]
```

It does not include:

```text
video/quicktime
```

That explains why the simulator MP4 probe passed while the real iPhone MOV probe failed. The app-side MOV acceptance was fixed, but the Supabase Storage bucket contract was not updated to match it.

### Six-Field Proof

- File/line: `supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql` bucket `allowed_mime_types`; `mingla-business/src/services/eventCoverMediaService.ts` storage upload uses the inferred content type.
- Exact code/schema: app uploads real iPhone MOV as `video/quicktime`; bucket allowed MIME list omits `video/quicktime`.
- Current behavior: real phone logs upload-start with `contentType: "video/quicktime"`, but no upload-verified log appears and the public object path returns object-not-found.
- Expected behavior: short iPhone MOV should upload and verify exactly like short MP4.
- Causal chain: iPhone picker returns MOV/QuickTime -> app correctly accepts MOV -> app uploads with `video/quicktime` -> bucket MIME allow-list rejects or prevents object creation -> no public object -> user sees failed cover upload.
- Verification step: add/apply a monotonic Supabase migration that includes `video/quicktime` in `event_covers.allowed_mime_types`; retry the same phone-shot MOV; expect upload-verified, public HEAD 200, local draft media fields, and Step 4 render.

Updated boundary classification for real-device phone MOV: `upload_failed`, specifically storage MIME allow-list mismatch.

## Final Decision

Do not send another broad custom-upload video rework from this probe.

The simulator MP4 path is passing. The real-device iPhone MOV path fails because Supabase Storage still disallows `video/quicktime`. There is also a separate ORCH-0769 schema/app mismatch: local code is ahead of the linked Supabase database for `events.currency`.

Fix deployment/schema state first:

1. Apply/push the missing `events.currency` migration.
2. Add/apply a monotonic storage migration that updates `event_covers.allowed_mime_types` to include `video/quicktime`.
3. Run one narrow retest:

```text
Step 4 -> choose same 8-second phone MOV -> confirm upload-verified -> confirm no PGRST204 -> confirm autosave leaves "Saved" state -> reload draft -> cover still renders
```

Giphy/Pexels should remain paused until that durable server-save retest passes.
