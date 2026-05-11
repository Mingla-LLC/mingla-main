# Orchestrator Review: ORCH-0766B Zero-Byte Event Cover Upload Retest

> Date: 2026-05-09
> Reviewed artifact: `Mingla_Artifacts/reports/RETEST_REWORK_ORCH-0766B_ZERO_BYTE_EVENT_COVER_UPLOAD.md`
> Verdict: STATIC APPROVED, RUNTIME STILL BLOCKED

## Plain-English Summary

The code fix is doing the right defensive thing on paper: it should no longer let Mingla save an event-cover URL when the selected local file is empty or when Supabase returns a public object with zero bytes.

But the user-facing promise is still not proven. The current draft still shows the orange hue because it is holding an old broken URL that points to a historical 0-byte image object. That explains the visible symptom, but it does not answer the remaining question: what happens when an organiser uploads a fresh image on the current build?

## Evidence Accepted

Tester verified:

- `mingla-business` targeted Jest gates pass:
  - `npm run test:orch-0758a -- --runInBand`: PASS, 6 suites / 45 tests.
  - `npm run test:orch-0763 -- --runInBand`: PASS, 7 suites / 53 tests.
- `npx tsc --noEmit`: PASS.
- targeted ESLint: PASS.
- `git diff --check`: PASS.
- `uploadEventCoverMedia` rejects `blob.size <= 0` before Supabase upload.
- zero-byte public objects are rejected by URL verification.
- missing `content-length` uses byte-proof fallback.
- generic MIME values such as `application/octet-stream` are handled conservatively.

Tester also proved the current saved draft still references the old failed object:

```text
HTTP/2 200
content-type: image/png
content-length: 0
downloaded size: 0 bytes
```

## Lifecycle Decision

ORCH-0766B does not go back to implementor yet.

The right next gate is a user-assisted runtime proof:

1. Operator performs one fresh supported image upload on the signed-in simulator/device.
2. Tester extracts the newly saved `coverMediaUrl`.
3. Tester proves the new object is non-zero and renders on Step 4/Home.
4. If the app rejects the upload, tester records the exact failure and confirms draft state did not update to a bad URL.

## Why Not Close

The implementation could still fail in the real Expo picker/file-read path. Static tests cannot prove whether `fetch(fileUri).blob()` returns valid bytes for the simulator/device asset the organiser selects.

Close requires runtime proof that the current build either:

- accepts a fresh image and stores a renderable non-zero object; or
- rejects an unreadable/empty picker result without mutating the draft to a broken URL.

## Next Prompt

Dispatch:

`Mingla_Artifacts/prompts/TESTER_OPERATOR_ASSISTED_RUNTIME_ORCH-0766B_FRESH_IMAGE_UPLOAD_PROOF.md`

Keep Giphy/Pexels, brand media, profile media, ticket media, and broader provider picker work paused until this base upload path is runtime-cleared.

