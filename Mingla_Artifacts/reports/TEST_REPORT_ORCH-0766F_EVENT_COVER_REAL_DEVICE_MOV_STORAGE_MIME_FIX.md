# TEST REPORT ORCH-0766F: Event Cover Real-Device MOV Storage MIME Fix

Date: 2026-05-09  
Tester: Codex `$tester`  
Verdict: CONDITIONAL PASS

## Scope

Retest the ORCH-0766F fix for real-device iPhone MOV/QuickTime event cover uploads. The proven prior failure was an iPhone-shot `.MOV` file accepted by the app and sent to Supabase as `video/quicktime`, but rejected or not persisted by the `event_covers` bucket because the storage MIME allow-list did not include `video/quicktime`.

This report verifies the shipped migration, static guard, regression tests, and build/lint gates. Runtime real-device proof is still required before orchestrator closes the issue.

## Verdict Rationale

CONDITIONAL PASS because:

- PASS: the linked Supabase migration list shows `20260515000010` applied remotely.
- PASS: the migration updates only `storage.buckets` for `event_covers`, preserves existing image/video MIME types, adds `video/quicktime`, keeps `file_size_limit = 31457280`, keeps `public = true`, and deduplicates MIME entries.
- PASS: app-side rules still classify `.mov` and `video/quicktime` as video and still enforce 15 seconds and 30 MB before upload.
- PASS: regression tests prove short iOS MOV uploads use `contentType: "video/quicktime"` and over-limit MOV videos are rejected before upload.
- PASS: focused Jest, TypeScript, ESLint, strict guard, and whitespace gates pass.
- CONDITION: a fresh real iPhone upload must still prove the runtime chain: `upload-start` -> `upload-verified` -> cover media draft update -> visible video cover render.

## Evidence

### Remote Migration

Command:

```bash
/Users/sethogieva/bin/supabase migration list --linked | tail -25
```

Result:

```text
20260515000010 | 20260515000010 | 2026-05-15 00:00:10
```

Interpretation: the DB push gate for this migration is satisfied.

### Migration Contract

File: `supabase/migrations/20260515000010_orch_0766f_event_cover_quicktime_mime.sql`

Verified:

- Targets `storage.buckets`.
- Restricts the update to `WHERE id = 'event_covers'`.
- Adds/preserves:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
  - `image/gif`
  - `video/mp4`
  - `video/webm`
  - `video/quicktime`
- Keeps `file_size_limit = 31457280`.
- Keeps `public = true`.
- Uses `SELECT DISTINCT mime`, making repeated application idempotent.

### App-Side Rules

File: `mingla-business/src/utils/eventCoverMediaRules.ts`

Verified:

- `EVENT_COVER_MAX_BYTES = 30 * 1024 * 1024`.
- `EVENT_COVER_MAX_VIDEO_DURATION_MS = 15_000`.
- Upload copy says images/GIF/MP4/MOV/WebM up to 15 seconds and 30 MB.
- `.mov` maps to `video/quicktime`.
- `video/quicktime` maps to `.mov`.
- `classifyEventCoverMedia` accepts `video/quicktime`, `.mov`, and `.qt` as video.
- `validateEventCoverAsset` rejects videos over 15 seconds before upload.
- Public URL verification accepts `video/*` responses and checks positive content length or byte-range/body proof.

### Upload Service

File: `mingla-business/src/services/eventCoverMediaService.ts`

Verified:

- Reads local file bytes before upload.
- Rejects zero-byte reads.
- Rejects files over 30 MB before upload.
- Normalizes media from bytes, MIME, filename, picker type, and URI.
- Uploads to `event_covers` using the inferred/normalized `contentType`.
- Verifies the public URL before returning success.
- Logs `upload-start` and `upload-verified` in dev.

### Regression Tests

File: `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts`

Verified tests include:

- `keeps 15-second enforcement for iOS MOV videos before upload`
- `uploads short iOS MOV videos with QuickTime content type`

The short MOV test asserts:

- media resolves as `video`
- public URL resolves
- storage path ends with `.mov`
- upload uses `contentType: "video/quicktime"`

## Commands Run

From `mingla-business`:

```bash
/opt/homebrew/bin/npm run test:orch-0766f
```

Result: PASS

```bash
/opt/homebrew/bin/npm run test:orch-0758a -- --runInBand --testNamePattern='cover|video|MOV|QuickTime'
```

Result: PASS  
Suites: 6 passed  
Tests: 33 passed, 20 skipped

```bash
/opt/homebrew/bin/npm run test:orch-0763 -- --runInBand --testNamePattern='cover|video|MOV|QuickTime'
```

Result: PASS  
Suites: 3 passed, 4 skipped  
Tests: 7 passed, 47 skipped

```bash
/opt/homebrew/bin/npx tsc --noEmit
```

Result: PASS

```bash
/opt/homebrew/bin/npx eslint src/services/eventCoverMediaService.ts src/utils/eventCoverMediaRules.ts
```

Result: PASS

From repo root:

```bash
git diff --check
```

Result: PASS

## Findings

No P0/P1 blocker found in the ORCH-0766F implementation.

### P2: Runtime Real-Device Proof Still Required

The exact user-facing failure happened on a real iPhone with an actual `file://.../ImagePicker/...MOV` asset. Static tests and migration proof strongly support the fix, but they cannot prove that the physical device now reaches `upload-verified`, updates the draft state, and renders the video cover.

Required runtime proof:

1. Open Mingla Business on the real iPhone.
2. Go to the event creator cover step.
3. Upload a real iPhone-shot `.MOV` video that is 15 seconds or shorter and 30 MB or smaller.
4. Capture Metro logs from the picker through verification.
5. Expected logs:

```text
[CreatorStep4Cover] picked cover asset ... "mimeType":"video/quicktime" ...
[eventCoverMedia] upload-start ... "contentType":"video/quicktime" ...
[eventCoverMedia] upload-verified ... "mediaType":"video" ...
```

6. Confirm the cover preview displays the uploaded video, not the hue fallback.

If the fresh runtime test fails:

- No `upload-verified`: storage/network/public URL verification is still failing.
- `upload-verified` present but no preview: renderer/state/draft update path is failing.
- Toast says video is over 15 seconds for a short video: picker duration normalization is wrong.
- Toast says unsupported type for `.MOV`: MIME/type normalization regressed.

## Worktree Note

The worktree contains many unrelated modified/untracked ORCH files. Tester did not revert or modify product code.

