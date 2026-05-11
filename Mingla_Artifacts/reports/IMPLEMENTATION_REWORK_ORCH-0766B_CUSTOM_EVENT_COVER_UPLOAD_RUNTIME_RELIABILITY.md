# Implementation Report: Custom Event Cover Upload Runtime Reliability (ORCH-0766B)

> Date: 2026-05-09
> Mode: Rework
> Spec: `Mingla_Artifacts/specs/SPEC_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md`
> Status: implemented, partially verified

## 1. Layman Summary

Event cover upload is now less fragile and more honest. Organisers see the size/length/format limits before picking media, image/video render failures are surfaced instead of silently becoming the hue fallback, video duration failures have a precise error, and uploaded files now keep storage extensions/content types aligned with the actual media.

Runtime native QA is still required because the original failure was device/media-library behavior.

## 2. Request And Context

- **Request:** Implement ORCH-0766B custom event cover upload reliability rework.
- **Source:** User-dispatched `$implementor` after forensics spec.
- **Affected surfaces:** Mingla Business event creator Step 4, published event cover edit through shared Step 4, event cover media renderer, upload service, validation rules, tests.
- **Related artifacts:** `INVESTIGATION_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_FAILURE.md`, `REVIEW_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_FAILURE.md`, `SPEC_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md`.

## 3. Scope

- **In scope:** Event-cover upload validation, storage path/content-type, public URL verification, preview render failure feedback, inline upload limits, draft/autosave regression tests.
- **Out of scope:** Giphy/Pexels, brand cover upload, profile upload, ticket media, admin moderation, native transcoding dependencies.
- **Assumptions:** MOV/QuickTime remains unsupported in this pass and now fails with explicit MP4/WebM copy; no migration is needed because stored MIME types remain inside the existing `event_covers` allowlist.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_REWORK_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_RELIABILITY.md` | Contract | Required narrow event-cover reliability rework. |
| `src/components/event/CreatorStep4Cover.tsx` | Upload entry point | Picker used old media type enum, no inline limits, render errors were not surfaced. |
| `src/components/ui/EventCoverMedia.tsx` | Renderer | Image/video errors only set fallback state. |
| `src/utils/eventCoverMediaRules.ts` | Validation | Missing video duration reused `video_too_long`; no display error code. |
| `src/services/eventCoverMediaService.ts` | Storage upload | Path extension forced image to jpg/video to mp4 and public URL was not verified. |
| `src/store/draftEventStore.ts` / `serverDraftAutosaveGuards.ts` | Draft state safety | Existing revision guards protect dirty local media edits from stale server echoes. |
| `src/utils/serverDraftEventMapper.ts` | Persistence | Cover media fields already map to/from `events.cover_media_url/type`. |
| `src/components/event/EditPublishedScreen.tsx` | Published parity | Published cover edit reuses `CreatorStep4Cover`, so shared Step 4 fixes apply. |

## 5. Blast Radius

- **Direct changes:** Event cover rules/service, Step 4 UI, `EventCoverMedia`, focused tests.
- **Cascade changes:** Published edit cover section receives inline limits and render-error feedback through shared `CreatorStep4Cover`.
- **Parity surfaces:** Preview/public/checkout render through `EventCoverMedia`; renderer error behavior now has optional parent callback and preserves existing fallback behavior when no callback is supplied.
- **Cache impact:** No React Query key changes.
- **State boundaries:** Draft cover media still lives in `DraftEvent`/server draft mapper; added stale-response test for uploaded media.
- **Auth/RLS/security:** No policy/schema changes; storage path remains `{brandId}/{eventId}/{file}`.
- **Deploy path:** OTA/JS-safe; no migration, no edge function, no native dependency.

## 6. Old To New Receipts

### `src/utils/eventCoverMediaRules.ts`

- **Before:** Missing video duration threw `video_too_long`; no inline copy constant; no display failure code; no public URL verification helper.
- **After:** Adds upload limit copy, `video_duration_unknown`, `display_failed`, content-type/extension helpers, and public URL verification.
- **Why:** Distinguish real media failure causes and stop old tests from accepting misleading errors.
- **Approx lines changed:** +100 / -2.

### `src/services/eventCoverMediaService.ts`

- **Before:** Storage paths used `.jpg` for all images and `.mp4` for all videos; upload returned public URL without checking it.
- **After:** Path extension and `contentType` derive from MIME/file extension, upload verifies public URL/content type before returning success, dev diagnostics log upload metadata.
- **Why:** Prevent "uploaded but cannot render" from being treated as success.
- **Approx lines changed:** +45 / -12.

### `src/components/ui/EventCoverMedia.tsx`

- **Before:** Image/video errors silently set `hasMediaError` and fell back to hue.
- **After:** Adds typed `onMediaError` callback and dev log before fallback.
- **Why:** Parent surfaces can tell users the uploaded media failed to display.
- **Approx lines changed:** +35 / -2.

### `src/components/event/CreatorStep4Cover.tsx`

- **Before:** No inline upload limits; old picker enum; quality `0.92`; generic video/upload errors; no render error handler.
- **After:** Shows inline limits, uses `mediaTypes: ["images", "videos"]`, uses `quality: 1` for GIF preservation, adds specific duration/display failure copy, logs dev diagnostics, handles renderer errors.
- **Why:** Match SDK-54 pattern, communicate limits before upload, and make failures visible.
- **Approx lines changed:** +50 / -5.

### Tests

- **Before:** ORCH-0758A had 35 passing tests but encoded old missing-duration rejection and no public URL/render failure checks.
- **After:** ORCH-0758A has 40 passing tests, including extension alignment, duration-unknown error, QuickTime unsupported behavior, public URL verification, inline limits, render callback guard, and stale cover-media autosave guard.
- **Why:** Make old brittle behavior fail.
- **Approx lines changed:** +90.

## 7. Implementation Details

- **Architecture decisions:** No migration and no new native dependency. MOV/QuickTime is explicitly unsupported in this pass rather than silently failing or adding a risky transcoding dependency.
- **Data flow:** Picker asset -> validation -> blob read -> content type/path resolution -> Supabase upload -> public URL verification -> draft update -> renderer.
- **Mutation/query behavior:** No query changes.
- **State handling:** Existing local revision guard remains; new tests prove stale server echoes do not overwrite uploaded cover media.
- **Error handling:** Added typed `video_duration_unknown` and `display_failed`; Step 4 maps both to user-facing copy.
- **Copy/accessibility:** Inline limit copy appears near upload controls: "Upload an image, GIF, or MP4/WebM video up to 15 seconds and 30 MB."
- **Analytics/notifications/realtime:** None.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Inline upload limits | Yes | Source test + ORCH-0758A | PASS |
| SDK-safe picker media types | Yes | TypeScript | PASS |
| GIF preservation consideration | Yes, quality set to `1`, editing false remains | TypeScript/static | PASS |
| Missing duration not `video_too_long` | Yes | Jest | PASS |
| MOV/QuickTime explicit strategy | Yes, unsupported with MP4/WebM copy | Jest | PASS |
| Extension/content-type alignment | Yes | Jest | PASS |
| Public URL verification | Yes | Jest | PASS |
| Render failure not silent | Yes, callback + toast/dev log | Source test + TypeScript | PASS |
| Draft/autosave cover guard | Yes | ORCH-0763 test bundle | PASS |
| Runtime media QA | Not run | Needs tester/device | PENDING |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| No silent failures | Yes | Yes | Render failure now calls parent and toasts in Step 4. |
| One owner per truth | Yes | Yes | `events.cover_media_url/type` and draft mapper unchanged as canonical persisted fields. |
| No dead taps | Yes | Yes | Picker errors produce specific toast states. |
| Uploaded media canonical, hue fallback only fallback | Yes | Improved | Hue can still visually fallback after render error, but no longer silently. |

## 10. Parity Check

- **Mobile:** Not touched.
- **Business app:** Event creator and published edit cover section updated through shared Step 4.
- **Admin:** Not touched.
- **Public/web:** Renderer callback is optional; existing render surfaces continue to fallback if no parent handler is supplied.
- **Solo/collab:** Not relevant.
- **Gaps:** Native runtime proof still required for real JPEG/PNG/GIF/MP4/MOV device assets.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** No schema shape change; new local error codes only.
- **AsyncStorage/Zustand impact:** No migration. Tests cover stale server draft protection for uploaded cover media.
- **Cold start behavior:** Expected unchanged; uploaded cover persists through existing server draft mapper.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| ORCH-0758A focused media/draft gate | `npm run test:orch-0758a -- --runInBand` | PASS | 6 suites / 40 tests. Watchman recrawl warning only. |
| TypeScript | `npx tsc --noEmit` | PASS | No output. |
| ORCH-0763 event lifecycle regression gate | `npm run test:orch-0763 -- --runInBand` | PASS | 7 suites / 48 tests. Watchman recrawl warning only. |
| Targeted ESLint | `npx eslint ...touched files...` | PASS | No output. |
| Diff whitespace | `git diff --check` | PASS | No output. |

## 13. Regression Surface

1. **Supabase Storage public URL HEAD behavior:** If Storage/CDN does not return content type on HEAD, helper falls back to ranged GET.
2. **GIF picker behavior:** `quality: 1` preserves Android GIF behavior per Expo docs but may increase image bytes; 30 MB cap remains.
3. **Public render surfaces:** They still receive fallback behavior unless a parent opts into `onMediaError`; Step 4 is the user-facing upload surface and now opts in.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| MOV/QuickTime unsupported | iPhone videos may still be rejected, but no longer generically | Future media normalization/transcoding spec if product wants MOV acceptance | `eventCoverMediaRules.ts` |
| Runtime device behavior unverified | Original failure was native picker/storage/render runtime | `$tester` native QA with real media fixture | ORCH-0766B tester pass |

## 15. Discoveries For Orchestrator

- None beyond the intentional MOV/QuickTime limitation documented above.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** JS-only; no new native dependency.
- **Business/admin web:** Business app bundle/OTA required to ship.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
fix(business): harden event cover media upload

Resolves: ORCH-0766B
Evidence: test:orch-0758a, test:orch-0763, tsc, targeted eslint, diff-check
Deploy: JS-only business app update; no migration
```

## Ready-To-Test Checklist

1. In Mingla Business, open a server-backed event draft and Step 4.
2. Confirm helper text shows image/GIF/MP4-WebM, 15-second, and 30 MB limits before upload.
3. Upload JPEG, PNG, WebP, GIF, MP4 <= 15s, MP4 > 15s, oversized file, and MOV/QuickTime.
4. Confirm supported media displays immediately; unsupported/invalid media shows precise toast.
5. Replace and remove uploaded media.
6. Close/reopen draft and cold restart; confirm cover persists.
7. Publish and confirm organiser detail/public/checkout/order cover surfaces render expected media or explicit fallback.
