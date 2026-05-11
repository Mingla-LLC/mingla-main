# Retest Report: ORCH-0766B Custom Event Cover Upload Runtime Reliability

> Date: 2026-05-09
> Tester mode: RETEST / SPEC-COMPLIANCE
> Prompt: `Mingla_Artifacts/prompts/TESTER_RETEST_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md`
> Verdict: FAIL

## Plain-English Result

The code now looks materially better than the broken upload path the operator reported. Static inspection and focused automated gates confirm the rework added inline limits, sharper video errors, media-specific storage extensions/content types, public URL verification, render-error callbacks, and stale autosave protection for cover media.

Runtime evidence now reproduces the operator's image symptom. The signed-in simulator has a draft event with `coverMediaUrl` and `coverMediaType: "image"` in local state, but the Supabase public object at that URL is a zero-byte PNG. The public URL returns `HTTP 200` and `content-type: image/png`, so the new public URL verifier would accept it, but `content-length: 0` means there are no image bytes to render. The Home draft card therefore still shows the hue fallback.

ORCH-0766B needs implementor rework before any provider/media expansion.

## Verdict

`FAIL`

The implementation fails the core runtime image path: upload/storage can produce a public object that looks superficially valid but is empty, and the verification layer does not catch it.

## Findings

### P1 Blocker: Uploaded Image URL Points To A Zero-Byte Public Object, So The App Falls Back To Hue

Evidence:

- Booted simulator: `iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)`.
- Signed-in app state shows draft `Party Like it’s 99` / event id `ca365727-01e2-47e8-bb5e-4a87d469cd85`.
- Local draft state contains:
  - `coverMediaUrl`: `https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event_covers/304f90b2-e97e-4365-b221-6f9d161a23ec/ca365727-01e2-47e8-bb5e-4a87d469cd85/moxykcbf-yyq5txhx.png`
  - `coverMediaType`: `image`
  - `coverHue`: `25`
- Simulator screenshot `/tmp/mingla-runtime/home-with-draft-hue.png` shows the draft card still rendering the orange hue fallback, not the uploaded cover.
- `curl -I -L` against the stored public URL returns:
  - `HTTP/2 200`
  - `content-type: image/png`
  - `content-length: 0`
  - `etag: "d41d8cd98f00b204e9800998ecf8427e"`; this is the empty-content hash.
- Downloading the object produced `/tmp/mingla-runtime/uploaded-cover.png`, a 0-byte file.
- Current verifier in `src/utils/eventCoverMediaRules.ts:218-237` accepts any 2xx response whose content type starts with `image/` or `video/`; it does not reject zero-byte content.
- Current upload path in `src/services/eventCoverMediaService.ts:95-105` does not reject `blob.size === 0` before upload.

Impact:

- The original image failure is confirmed: state gets a URL, but the URL cannot render because the uploaded object is empty.
- The user sees hue after an apparent upload success.
- The public URL verification added by this rework is too shallow and can bless a broken/empty object.
- Giphy/Pexels, brand upload, profile upload, and ticket media expansion should remain paused.

Required rework:

- `uploadEventCoverMedia` must reject empty local blobs before storage upload.
- If picker `fileSize` is positive but fetched `blob.size` is zero, treat it as `upload_failed` / local file unreadable and do not update the draft with a URL.
- `verifyEventCoverPublicUrl` must reject `content-length: 0`.
- If `content-length` is absent, verification should use a bounded GET/range response and prove at least one byte exists.
- Add regression tests for zero-byte local blob and zero-byte public URL.
- Re-run runtime image upload after rework and prove the public object has non-zero bytes and renders in the draft card/Step 4.

### P2 Risk: Generic Picker MIME Values Could Still Reject Otherwise Supported Files

Evidence:

- `src/utils/eventCoverMediaRules.ts:63-73` returns a non-empty `mimeType` directly in `eventCoverContentType`.
- `src/utils/eventCoverMediaRules.ts:96-124` can classify media from filename extension even when MIME is not one of the allowed image/video MIME values.
- `src/services/eventCoverMediaService.ts:96-105` prefers the picker MIME over `blob.type` when building upload content type.
- If a real picker asset provides `mimeType: "application/octet-stream"` with `fileName: "cover.jpg"`, classification can pass by extension, but upload content type can remain `application/octet-stream`; `verifyEventCoverPublicUrl` then rejects it because the public response content type does not start with `image/` or `video/`.

Impact:

- This is not proven to happen in the current runtime, but it is a plausible native metadata edge case.
- If runtime tester sees a supported image fail with `display_failed`, inspect picker `mimeType`, `blob.type`, storage content type, and public URL response headers first.

Recommended rework only if runtime reproduces it:

- Treat generic/unknown MIME values as absent and prefer known extension or `blob.type` when deriving upload content type.

### P2 Coverage Gap: Render-Error Callback Is Guarded Mostly By Source Inspection

Evidence:

- `src/components/ui/__tests__/eventCoverMedia.test.ts:57-63` checks source text for `onMediaError`, `handleMediaError("image"`, and `handleMediaError("video"`.
- The production implementation does call `onMediaError` before fallback in `src/components/ui/EventCoverMedia.tsx:122-143`.

Impact:

- The behavior is present in code, but a future refactor could satisfy string checks while changing runtime behavior.

Recommended future hardening:

- Add a component-level test or focused render test that invokes image/video error paths and asserts the callback fires before fallback state is set.

## Claim Verification

| Claim | Status | Evidence |
|---|---|---|
| Step 4 uses SDK-safe picker media types | Verified | `src/components/event/CreatorStep4Cover.tsx:119-124` uses `mediaTypes: ["images", "videos"]`, `allowsEditing: false`, `quality: 1`, `videoMaxDuration: 15`. |
| Step 4 shows inline upload limits | Verified | `src/components/event/CreatorStep4Cover.tsx:232-234`; constant in `src/utils/eventCoverMediaRules.ts:3-6`. |
| Missing duration has precise error | Verified | `src/utils/eventCoverMediaRules.ts:148-153`; Step 4 toast at `CreatorStep4Cover.tsx:70-74`. |
| MOV/QuickTime is rejected with MP4/WebM copy | Verified statically | Test at `src/services/__tests__/eventCoverMediaService.test.ts:97-110`; rule rejects unsupported types at `eventCoverMediaRules.ts:132-138`. Runtime copy still needs manual observation. |
| Upload path uses media-specific extension/content type | Verified with caveat | Extension helper at `eventCoverMediaRules.ts:76-94`; upload path at `eventCoverMediaService.ts:54-65,95-125`. Generic MIME caveat noted above. |
| Upload success waits for public URL verification | Verified | `src/services/eventCoverMediaService.ts:131-146`; verifier at `eventCoverMediaRules.ts:218-237`. |
| Render failures are surfaced to parent | Verified statically | `src/components/ui/EventCoverMedia.tsx:122-143`; Step 4 handler at `CreatorStep4Cover.tsx:178-188`. |
| Remove remains available after render failure | Verified statically | Remove button is keyed from `draft.coverMediaUrl !== null` at `CreatorStep4Cover.tsx:220-230`, not render state. |
| Stale server draft cannot overwrite dirty uploaded cover | Verified by test | `src/utils/__tests__/serverDraftAutosaveGuards.test.ts:71-87`; `npm run test:orch-0763 -- --runInBand` passed. |
| Published edit uses shared Step 4 | Verified | `src/components/event/EditPublishedScreen.tsx:575-598`; `coverMediaEventId` passes `liveEvent.serverEventId` at `EditPublishedScreen.tsx:578-588`. |
| Published media save retains row-count proof | Verified | `src/services/eventCoverMediaService.ts:160-180` uses `.select("id").maybeSingle()` and errors on `data === null`. |

## Static Gate Results

Commands were run from `mingla-business`.

| Gate | Result | Evidence |
|---|---:|---|
| `npm run test:orch-0758a -- --runInBand` | PASS | 6 suites passed, 40 tests passed. Watchman recrawl warning only. |
| `npm run test:orch-0763 -- --runInBand` | PASS | 7 suites passed, 53 tests passed. Watchman recrawl warning only. |
| `npx tsc --noEmit` | PASS | Exit 0, no output. |
| Targeted ESLint on touched files | PASS | Exit 0, no output. |
| `git diff --check` | PASS | Exit 0, no output. |

Note: the ORCH-0763 suite now reports 53 tests, not the implementor report's 48 tests. The current run is the source of truth for this retest.

## Runtime Test Matrix

| Runtime case | Result | Notes |
|---|---:|---|
| Existing uploaded image URL displays instead of hue | FAIL | Local draft has `coverMediaUrl`/`coverMediaType: image`, but Home card shows hue. Public object is 0 bytes. |
| Public uploaded image URL has usable image bytes | FAIL | `HTTP 200 image/png content-length: 0`; downloaded file is 0 bytes. |
| Inline upload copy visible before picker | UNVERIFIED | Did not navigate into Step 4 due limited simulator automation. |
| JPEG upload displays immediately instead of hue | FAIL/PARTIAL | The current draft's uploaded PNG image path reproduces the original image symptom. Fresh picker upload still needs rework retest. |
| PNG/WebP upload displays immediately | UNVERIFIED | Requires app runtime. |
| GIF upload displays and animation behavior is acceptable | UNVERIFIED | Requires app runtime and GIF fixture. |
| MP4 <= 15 seconds uploads and displays | UNVERIFIED | Core original failure path. |
| MP4 > 15 seconds fails with precise copy | UNVERIFIED | Requires app runtime and over-duration fixture. |
| Oversized > 30 MB fails with precise copy | UNVERIFIED | Requires app runtime and oversized fixture. |
| MOV/QuickTime fails with clear unsupported copy | UNVERIFIED | Requires app runtime and MOV fixture. |
| Replace/remove behavior | UNVERIFIED | Requires app runtime. |
| Close/reopen/cold restart persistence | UNVERIFIED | Requires authenticated server-backed draft. |
| Publish to organiser/public/checkout/order surfaces | UNVERIFIED | Requires safe publish fixture. |
| Published-event edit cover replacement | UNVERIFIED | Requires editable published event fixture. |

## Worktree Notes

The repository is dirty with multiple unrelated concurrent changes, including ORCH-0767/public-brand/social-preview files. This retest did not modify product code. The report only evaluates ORCH-0766B-relevant files and gates.

## Required Next Step

Do not close ORCH-0766B yet.

Dispatch `$implementor` for focused rework of the zero-byte upload/verification gap. Minimum acceptance criteria:

- Empty local blobs fail before upload.
- Public URL verification fails on `content-length: 0`.
- Public URL verification proves non-empty bytes when content length is absent.
- Draft state is not updated with a public URL when upload verification fails.
- Tests cover zero-byte local blob and zero-byte public object.
- Runtime retest proves a newly uploaded supported image creates a non-zero public object and renders instead of hue.

After rework, rerun the full runtime matrix from `Mingla_Artifacts/prompts/TESTER_RETEST_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md` on a real Mingla Business app session with:

- authenticated organiser,
- valid brand,
- server-backed event draft,
- JPEG/PNG/WebP/GIF fixture,
- MP4 under 15 seconds,
- MP4 over 15 seconds,
- optional oversized file,
- optional MOV/QuickTime fixture.

If supported JPEG/GIF/MP4 works and persists, this can move toward conditional/pass close. If supported media still shows hue or videos still fail, keep ORCH-0766B failed and return exact runtime logs and stored URL/header evidence.
