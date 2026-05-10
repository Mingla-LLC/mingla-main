# IMPLEMENTATION ORCH-0766F - Event Cover Real-Device MOV Storage MIME Fix

> Date: 2026-05-09  
> Mode: Implementor  
> Status: implemented and locally verified; runtime remains gated on `supabase db push` plus real-device MOV retest  
> Source prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0766F_EVENT_COVER_REAL_DEVICE_MOV_STORAGE_MIME_FIX.md`

## Summary

Implemented the proven storage-contract fix for real iPhone MOV event-cover uploads.

The app already accepts and uploads real-device MOV as `video/quicktime`, but Supabase Storage still disallowed that MIME type on `event_covers`. This pass adds a monotonic storage migration that includes `video/quicktime` in the bucket allow-list and adds a strict guard so app MOV support and storage MIME support cannot drift again.

## Files Changed

ORCH-0766F-owned files:

- `supabase/migrations/20260515000010_orch_0766f_event_cover_quicktime_mime.sql`
- `.github/scripts/strict-grep/orch-0766f-event-cover-quicktime-storage.mjs`
- `mingla-business/package.json`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0766F_EVENT_COVER_REAL_DEVICE_MOV_STORAGE_MIME_FIX.md`

Note: the worktree already contains many unrelated ORCH-0766/0769 changes. I did not revert them. The ORCH-0766F package change only adds `test:orch-0766f`; adjacent uncommitted `test:orch-0769` and dependency/package-lock changes were pre-existing in the dirty tree.

## Migration

Added:

```text
supabase/migrations/20260515000010_orch_0766f_event_cover_quicktime_mime.sql
```

Monotonic proof:

- local migration head before this change: `20260515000009`
- linked remote migration head: `20260515000009`
- new migration prefix: `20260515000010`

The migration updates only `storage.buckets` where `id = 'event_covers'`.

It preserves:

- `public = true`
- `file_size_limit = 31457280`
- existing storage RLS policies
- existing `{brandId}/{eventId}/{filename}` object path contract

It adds/preserves this MIME set through an idempotent deduplicating update:

```text
image/jpeg
image/png
image/webp
image/gif
video/mp4
video/webm
video/quicktime
```

## Regression Guard

Added:

```text
.github/scripts/strict-grep/orch-0766f-event-cover-quicktime-storage.mjs
```

Wired:

```text
mingla-business package script: test:orch-0766f
```

The guard asserts:

- the new migration targets `event_covers`;
- the bucket allow-list includes `video/quicktime`;
- MP4/WebM and existing image/GIF MIME types remain present;
- `file_size_limit = 31457280` and `public = true` remain present;
- migration uses `SELECT DISTINCT mime` for idempotent dedupe;
- app rules still classify `.mov` / `video/quicktime`;
- service tests still cover short MOV upload and over-limit MOV rejection.

## Verification

Run from `mingla-business/` unless noted.

```text
/opt/homebrew/bin/npm run test:orch-0766f
PASS - ORCH-0766F strict guard passed.
```

```text
/opt/homebrew/bin/npm run test:orch-0758a -- --runInBand --testNamePattern='cover|video|MOV|QuickTime'
PASS - 6 suites, 33 passed, 20 skipped.
```

```text
/opt/homebrew/bin/npm run test:orch-0763 -- --runInBand --testNamePattern='cover|video|MOV|QuickTime'
PASS - 3 suites passed, 4 skipped; 7 passed, 47 skipped.
```

```text
/opt/homebrew/bin/npx tsc --noEmit
PASS
```

```text
/opt/homebrew/bin/npx eslint src/services/eventCoverMediaService.ts src/utils/eventCoverMediaRules.ts
PASS
```

From repo root:

```text
git diff --check
PASS
```

Known non-blocking warning:

- Jest emitted the existing Watchman recrawl warning. Tests still passed.

## Deployment Gate

This is not runtime-complete until the operator applies the migration:

```bash
/Users/sethogieva/bin/supabase db push
```

No live Supabase mutation was performed by implementor mode.

## Required Runtime Retest

After `supabase db push`, repeat the real-device phone MOV flow:

```text
Event creator Step 4 -> Upload cover -> Video -> select <=15s iPhone MOV
```

Expected logs:

```text
[CreatorStep4Cover] picked cover asset ... "mimeType": "video/quicktime" ... "duration": <15000
[eventCoverMedia] upload-start ... "contentType": "video/quicktime"
[eventCoverMedia] upload-verified ... "mediaType": "video"
[CreatorStep4Cover] cover media draft update queued ... "coverMediaType": "video"
```

Expected UI:

- no failed upload toast;
- cover preview renders the video frame;
- `Replace cover` and `Remove` appear;
- reloading the draft still shows the uploaded cover.

Expected public URL proof:

```text
HEAD -> 200
content-type -> video/quicktime or compatible video/*
content-length -> >0
GET Range bytes=0-0 -> 206 or otherwise non-empty video response
```

## Residual Risk

- Runtime PASS is still unverified until the migration is pushed remotely and the same real-device iPhone MOV path is retested.
- Giphy/Pexels, brand media, profile media, and ticket media remain paused until this base real-device custom cover path passes.
