# Implementation Report: ORCH-0766B Zero-Byte Event Cover Upload Rework

> Date: 2026-05-09
> Mode: Implementor rework
> Prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0766B_ZERO_BYTE_EVENT_COVER_UPLOAD.md`
> Status: implemented and statically verified; runtime retest still required

## Plain-English Summary

Mingla Business will no longer accept an empty uploaded cover as a successful custom event cover. The upload service now rejects empty local blobs before Supabase Storage upload, and public URL verification now rejects zero-byte public objects instead of accepting `HTTP 200 image/png` as enough proof.

This directly addresses tester's runtime failure where the draft held a cover URL but the Supabase object was a 0-byte PNG, causing the UI to fall back to the hue.

## Files Changed

| File | Change |
|---|---|
| `mingla-business/src/utils/eventCoverMediaRules.ts` | Added generic-MIME handling, byte-aware public URL verification, zero-byte rejection, and GET/range byte proof fallback. |
| `mingla-business/src/services/eventCoverMediaService.ts` | Rejects empty local blobs before storage upload and derives content type using picker MIME, file extension, and blob MIME safely. |
| `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts` | Restored/expanded ORCH-0766B contract tests and added zero-byte local/public object regression coverage. |

## Exact Root Cause Fixed

Tester proved the app could save a `coverMediaUrl` whose public Supabase object was empty:

- `HTTP 200`
- `content-type: image/png`
- `content-length: 0`
- downloaded object: 0 bytes

The old verifier accepted that because it only required an OK response and media-looking content type. The upload service also did not reject `blob.size === 0` before calling Supabase upload.

## Implementation Details

### Empty Local Blob Rejection

`uploadEventCoverMedia` now checks `blob.size <= 0` immediately after reading the selected local file. If empty:

- dev diagnostics log `local-blob-empty` with file name, expected file size, MIME, and URI;
- an `EventCoverMediaError("upload_failed", ...)` is thrown;
- Supabase Storage upload is not called;
- no public URL is returned;
- Step 4 therefore cannot update `coverMediaUrl` through the normal upload path.

### Zero-Byte Public Object Rejection

`verifyEventCoverPublicUrl` now proves bytes, not just headers:

- `content-length: 0` fails with `display_failed`;
- positive `content-length` with expected media type passes;
- missing content length falls back to bounded `GET` with `Range: bytes=0-0`;
- `206`/range responses pass only with valid media type and positive byte evidence;
- `200` fallback GET responses pass only if body/blob/arrayBuffer proves at least one byte.

### Generic MIME Handling

`eventCoverContentType` now treats generic MIME values such as `application/octet-stream` as absent. It prefers:

1. supported picker MIME;
2. supported filename extension;
3. supported blob MIME;
4. media-type fallback.

This prevents a valid `cover.jpg` picked with a generic MIME from being uploaded as `application/octet-stream`.

## Spec Traceability

| Requirement | Status | Evidence |
|---|---:|---|
| Empty local blobs fail before upload | PASS | `eventCoverMediaService.ts` checks `blob.size <= 0`; test asserts storage upload is not called. |
| Zero-byte public object fails verification | PASS | `eventCoverMediaRules.ts`; test rejects `content-length: 0`. |
| Missing content length requires byte proof | PASS | GET/range fallback plus tests for zero-byte and non-empty fallback responses. |
| Draft cannot be updated with zero-byte URL through normal path | PASS statically | Upload throws before returning `publicUrl`; Step 4 only updates draft after `uploadEventCoverMedia` resolves. |
| Generic MIME is handled conservatively | PASS | `eventCoverContentType` ignores `application/octet-stream`; test covers extension/blob fallback. |
| No scope expansion | PASS | No Giphy/Pexels, brand/profile/ticket media, migration, native dependency, MOV support, Stripe, or public-brand changes. |

## Verification

Commands run from `mingla-business`:

| Gate | Result |
|---|---:|
| `npm run test:orch-0758a -- --runInBand` | PASS: 6 suites / 45 tests |
| `npm run test:orch-0763 -- --runInBand` | PASS: 7 suites / 53 tests |
| `npx tsc --noEmit` | PASS |
| `npx eslint src/components/event/CreatorStep4Cover.tsx src/components/ui/EventCoverMedia.tsx src/services/eventCoverMediaService.ts src/utils/eventCoverMediaRules.ts src/components/ui/__tests__/eventCoverMedia.test.ts src/services/__tests__/eventCoverMediaService.test.ts src/utils/__tests__/serverDraftAutosaveGuards.test.ts` | PASS |
| `git diff --check` | PASS |

Watchman recrawl warnings appeared during Jest only; tests passed.

## Runtime Notes For Tester

Tester should rerun the ORCH-0766B runtime matrix on the signed-in simulator/device:

1. Upload a fresh supported image.
2. Confirm the new Supabase public object has non-zero bytes.
3. Confirm Step 4/Home preview renders uploaded media instead of hue.
4. Confirm zero-byte/broken public objects no longer get accepted as upload success.
5. Continue GIF and MP4 runtime checks before provider expansion.

The old failed URL may still point to a historical 0-byte object; the fix prevents new successful uploads from creating/accepting that state through the normal path.

## Residual Risk

- Real Expo ImagePicker blob behavior still needs runtime proof. If `fetch(fileUri).blob()` returns zero for valid simulator/device assets, the user will now get a failure instead of a false success, but a deeper picker/file-read strategy may be needed.
- Video/GIF runtime coverage remains required before Giphy/Pexels or broader media expansion resumes.

