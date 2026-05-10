# Tester Retest Report: ORCH-0766B Zero-Byte Event Cover Upload Rework

> Date: 2026-05-09
> Mode: Tester
> Prompt: `Mingla_Artifacts/prompts/TESTER_RETEST_REWORK_ORCH-0766B_ZERO_BYTE_EVENT_COVER_UPLOAD.md`
> Verdict: BLOCKED / RUNTIME UNVERIFIED

## Executive Verdict

Static verification passes. The rework does block the proven zero-byte acceptance path in code and tests:

- local `blob.size <= 0` is rejected before Supabase upload;
- empty local blob failure cannot return `publicUrl`;
- public URLs with `content-length: 0` are rejected;
- missing content length falls back to a bounded byte-proof request;
- generic MIME values such as `application/octet-stream` are treated as absent.

However, ORCH-0766B cannot close yet. I did not obtain a fresh post-rework image upload from the runtime picker, so I cannot prove that real simulator/device assets now produce a non-zero Supabase object and render instead of hue.

## Static Gate Results

Commands run from `mingla-business`:

| Gate | Result |
|---|---:|
| `npm run test:orch-0758a -- --runInBand` | PASS: 6 suites / 45 tests |
| `npm run test:orch-0763 -- --runInBand` | PASS: 7 suites / 53 tests |
| `npx tsc --noEmit` | PASS |
| `npx eslint src/components/event/CreatorStep4Cover.tsx src/components/ui/EventCoverMedia.tsx src/services/eventCoverMediaService.ts src/utils/eventCoverMediaRules.ts src/components/ui/__tests__/eventCoverMedia.test.ts src/services/__tests__/eventCoverMediaService.test.ts src/utils/__tests__/serverDraftAutosaveGuards.test.ts` | PASS |
| `git diff --check` | PASS |

Watchman recrawl warnings appeared during Jest, but the test runs passed.

## Static Code Findings

| Requirement | Tester Result | Evidence |
|---|---:|---|
| Reject empty local blobs before Supabase upload | PASS | `mingla-business/src/services/eventCoverMediaService.ts` checks `blob.size <= 0` immediately after reading the selected URI and throws `EventCoverMediaError("upload_failed", ...)`. |
| Empty local blob cannot return public URL | PASS | The throw occurs before `storage.upload(...)`; the regression test asserts storage upload is not called. |
| Reject `content-length: 0` public objects | PASS | `mingla-business/src/utils/eventCoverMediaRules.ts` rejects zero-byte public responses with `display_failed`; test coverage exists. |
| Missing length requires byte proof | PASS | Public URL verification falls back to a bounded `GET` / `Range: bytes=0-0` style proof path and rejects zero-byte fallback responses. |
| Generic MIME handling | PASS | `application/octet-stream` and `binary/octet-stream` are filtered out before deriving upload content type. |
| Existing ORCH-0766B guardrails | PASS static | Covered by the passing `orch-0758a` / `orch-0763` suites and targeted ESLint/typecheck. |

## Runtime Evidence Collected

The Mingla Business simulator launched successfully:

- bundle id: `com.sethogieva.minglabusiness`
- screenshot captured: `/tmp/mingla-runtime/orch0766b-zero-retest-current.png`
- visible draft: `Party Like it’s 99`, Step 4 of 7
- Home card still displayed the orange hue fallback.

The draft persisted in AsyncStorage still points to the historical failed URL:

```text
coverMediaUrl=https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event_covers/304f90b2-e97e-4365-b221-6f9d161a23ec/ca365727-01e2-47e8-bb5e-4a87d469cd85/moxykcbf-yyq5txhx.png
coverMediaType=image
coverHue=25
```

That historical URL remains a zero-byte object:

```text
HTTP/2 200
content-type: image/png
content-length: 0
etag: "d41d8cd98f00b204e9800998ecf8427e"
downloaded size: 0 bytes
```

This proves the old broken object still exists and explains the current hue fallback. It does not prove the new upload path failed, because no fresh post-rework upload URL was generated during this retest.

## Runtime Checks Not Completed

The required PASS checks were not fully completed:

| Required runtime check | Result |
|---|---:|
| Upload fresh supported image from Step 4 | NOT VERIFIED |
| Step 4 preview shows uploaded image, not hue | NOT VERIFIED |
| Home card shows uploaded image, not hue | NOT VERIFIED |
| Extract new `coverMediaUrl` | NOT VERIFIED |
| `curl -I -L` new URL shows non-zero object | NOT VERIFIED |
| Download new URL proves non-zero bytes | NOT VERIFIED |
| Close/reopen draft and cover persists | NOT VERIFIED |
| Zero-byte runtime picker/file-read shows failure and does not update draft URL | NOT VERIFIED |

## Release Decision

Do not close ORCH-0766B yet.

The implementation is approved statically, but the release gate remains runtime-blocked until a tester or operator performs one fresh image upload on the current build and records the new public URL headers plus downloaded byte size.

## Next Required Retest Step

Use the signed-in simulator/device draft `Party Like it’s 99`:

1. Open the draft and go to Step 4 cover.
2. Upload a fresh supported image.
3. If the app shows an upload failure, record the message and confirm the old `coverMediaUrl` did not change.
4. If the app accepts the upload, extract the new `coverMediaUrl`.
5. Run `curl -I -L` on the new URL and download it.
6. PASS only if the new object has a valid image content type, positive byte size, and Step 4/Home render the uploaded image instead of hue.

