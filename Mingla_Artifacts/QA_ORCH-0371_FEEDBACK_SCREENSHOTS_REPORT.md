# QA Report: ORCH-0371 — Optional Screenshot Attachments for Beta Feedback

**Verdict: PASS**
**Date:** 2026-04-11
**Mode:** TARGETED (Orchestrator dispatch)
**Spec:** SPEC_ORCH-0371_FEEDBACK_SCREENSHOTS.md
**Implementation Report:** IMPLEMENTATION_ORCH-0371_FEEDBACK_SCREENSHOTS_REPORT.md

---

## Summary

Forensic code audit of all 7 files across 3 domains. All 17 spec success criteria verified
in code. Database migration confirmed applied. Storage bucket confirmed accepting JPEG.
Existing rows backward compatible (NULL screenshot columns). No constitutional violations.
No security issues. No regressions found.

---

## Findings

| # | Severity | File | Finding | Verdict |
|---|----------|------|---------|---------|
| F-01 | P4 | betaFeedbackService.ts:327-351 | `compressScreenshot` properly calculates proportional resize, skips resize when both dims ≤ 1920, and always converts to JPEG 0.7. Clean implementation. | PRAISE |
| F-02 | P4 | betaFeedbackService.ts:355-394 | `uploadFeedbackScreenshots` uses `Promise.all` for parallel upload, shared timestamp for path uniqueness, and throws descriptive per-image errors. Follows exact same `RNFormDataBlob` pattern as audio upload. | PRAISE |
| F-03 | P4 | submit-feedback/index.ts:128-152 | Screenshot validation is thorough: type check (array), length check (≤10), per-element type check (string), ownership check (startsWith userId + "/screenshots/"). Correct 400/403 status codes. | PRAISE |
| F-04 | P4 | BetaFeedbackModal.tsx:268-296 | `pickScreenshots` correctly requests permission, shows graceful warning on denial, uses `selectionLimit: remaining`, and caps with `.slice(0, MAX_SCREENSHOTS)`. Triple enforcement of max limit. | PRAISE |
| F-05 | P4 | BetaFeedbackModal.tsx:99-129 | `resetState` properly clears `selectedScreenshots` and `permissionMessage`. No screenshot state leaks between sessions. | PRAISE |
| F-06 | P4 | FeedbackHistorySheet.tsx:147-173 | Screenshot section guarded by `item.screenshot_urls && item.screenshot_urls.length > 0`. Old entries with null screenshot_urls render without crash. | PRAISE |
| F-07 | P4 | BetaFeedbackPage.jsx:537-538 | Admin screenshot count uses `row.screenshot_paths?.length ?? 0`. Safe for null/undefined on old rows. | PRAISE |
| F-08 | P4 | BetaFeedbackPage.jsx:803 | Admin detail screenshots guarded by `detailItem.screenshot_paths && detailItem.screenshot_paths.length > 0`. | PRAISE |

---

## Spec Compliance Matrix

| SC | Criterion | Code Evidence | Verdict |
|----|-----------|--------------|---------|
| SC-1 | Screenshots step appears after review | BetaFeedbackModal.tsx:456 — review "Next" → `setStep('screenshots')` | PASS |
| SC-2 | Photo picker multi-select | BetaFeedbackModal.tsx:281 — `allowsMultipleSelection: true` | PASS |
| SC-3 | 3-column thumbnail grid with X | BetaFeedbackModal.tsx:464,484-504 — `thumbWidth = (screenWidth - padding) / 3`, grid with remove buttons | PASS |
| SC-4 | Count indicator N/10 | BetaFeedbackModal.tsx:471 — `` `${length}/${MAX_SCREENSHOTS} screenshots` `` | PASS |
| SC-5 | X removes and decrements | BetaFeedbackModal.tsx:298-300 — `filter((_, i) => i !== index)` | PASS |
| SC-6 | Add More when <10, hidden at 10 | BetaFeedbackModal.tsx:507 — conditional on `length < MAX_SCREENSHOTS` | PASS |
| SC-7 | Skip & Submit → NULL | BetaFeedbackModal.tsx:314 — `screenshotPaths` stays `undefined` when `length === 0`, edge function stores `null` | PASS |
| SC-8 | Submit with screenshots uploads then submits | BetaFeedbackModal.tsx:315-320 — uploads before building params | PASS |
| SC-9 | JPEG max 1920px | betaFeedbackService.ts:335-348 — `compressScreenshot` with `SCREENSHOT_MAX_DIMENSION` and `SaveFormat.JPEG` | PASS |
| SC-10 | History shows thumbnails | FeedbackHistorySheet.tsx:147-173 — horizontal ScrollView with 56x56 thumbs | PASS |
| SC-11 | Tap thumbnail → fullscreen | FeedbackHistorySheet.tsx:159,236-258 — `onViewScreenshot` callback → fullscreen Modal | PASS |
| SC-12 | Admin detail shows grid + lightbox | BetaFeedbackPage.jsx:802-813 + ScreenshotThumbnail component with lightbox Modal | PASS |
| SC-13 | Old entries display correctly | All guards use `?.length > 0` or `?? 0`. DB confirms existing rows have NULL. | PASS |
| SC-14 | Permission denied graceful | BetaFeedbackModal.tsx:273-275 — sets `permissionMessage`, does not block submission | PASS |
| SC-15 | Back preserves screenshots | BetaFeedbackModal.tsx:527 — `setStep('review')` only, no state clear | PASS |
| SC-16 | Edge rejects wrong user path | submit-feedback/index.ts:144 — `startsWith(user.id + "/screenshots/")` → 403 | PASS |
| SC-17 | Edge rejects >10 paths | submit-feedback/index.ts:134 — `length > MAX_SCREENSHOTS` → 400 | PASS |

**17/17 PASS**

---

## Constitutional Compliance

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | All buttons wired: Add from Library, X remove, Back, Skip & Submit, Submit, fullscreen close |
| 2 | One owner per truth | PASS | Screenshot state owned solely by BetaFeedbackModal; no duplicate stores |
| 3 | No silent failures | PASS | Upload errors throw → caught in handleSubmit → error step with message |
| 4 | One key per entity | N/A | No new query keys added |
| 5 | Server state server-side | PASS | Screenshots are local URIs until uploaded; no Zustand involvement |
| 6 | Logout clears everything | PASS | Modal resetState clears all screenshot state; React Query invalidation on logout handles history cache |
| 7 | Label temporary | PASS | No temporary code — all production-ready |
| 8 | Subtract before adding | PASS | No broken code layered over — clean additive feature |
| 9 | No fabricated data | PASS | Screenshots are real user images, not fabricated |
| 10 | Currency-aware | N/A | No currency involved |
| 11 | One auth instance | PASS | Edge function uses existing auth pattern unchanged |
| 12 | Validate at right time | PASS | Permission checked on picker open, paths validated on submit |
| 13 | Exclusion consistency | N/A | Not applicable to feedback |
| 14 | Persisted-state startup | PASS | No persisted screenshot state; modal starts fresh on open |

---

## Security Audit

| Check | Verdict | Evidence |
|-------|---------|----------|
| Storage path injection | PASS | Edge function validates each path starts with `{userId}/screenshots/` |
| Storage RLS | PASS | `(storage.foldername(name))[1] = auth.uid()::text` confirmed returns userId for screenshot paths |
| Auth check | PASS | Edge function auth + beta tester verification unchanged |
| Max upload limit | PASS | 10 max enforced at picker, client array, and edge function |
| MIME type restriction | PASS | Bucket allows only specific audio types + `image/jpeg` |
| Data exposure | PASS | Signed URLs expire in 1 hour; no permanent public URLs |

---

## Database Verification

| Check | Result |
|-------|--------|
| `screenshot_paths` column exists | YES — ARRAY type, nullable, no default |
| `screenshot_urls` column exists | YES — ARRAY type, nullable, no default |
| Storage bucket MIME types | `['audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/aac', 'image/jpeg']` — all audio types preserved, JPEG added |
| Existing rows unaffected | YES — 3 most recent rows confirmed NULL for both columns |
| Storage `foldername` test | `abc-123/screenshots/feedback_x.jpg` → first folder = `abc-123` — RLS covers subfolder |

---

## Regression Analysis

| Area | Risk | Verdict | Evidence |
|------|------|---------|----------|
| Audio recording | Could break from new imports/state | PASS | Recording logic untouched (lines 157-208 identical to pre-change) |
| Audio upload | MIME type update could reject audio | PASS | All 4 audio MIME types explicitly preserved in bucket update |
| Review step navigation | "Submit" → "Next" could confuse flow | PASS | Button text changed, target changed to `screenshots`, all other review behavior preserved |
| Error recovery | Error → Try Again target changed | PASS | Now goes to `screenshots` (preserves screenshot selections) instead of `review` — intentional improvement |
| Modal close/reset | New state could leak | PASS | `resetState` clears `selectedScreenshots` and `permissionMessage` |
| History view | New props could break FlatList | PASS | `onViewScreenshot` prop added to FeedbackItem; old data renders via null guard |
| Admin table | New column could break layout | PASS | Column uses optional chaining `?.length ?? 0`; renders dash for null |

---

## Parity Check

Not applicable — feedback flow is single-mode only (no solo/collab).

---

## Verdict

**PASS** — P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 8 (all praise)

All 17 spec criteria verified in code. Database migration confirmed. Security clean.
No regressions. Constitutional compliance full. Ready to ship.

**Device testing note:** Image picker UX and actual upload to Supabase Storage require
physical device verification. The code is structurally sound — no runtime issues expected
based on the patterns used (identical to the proven audio upload path).

---

## Discoveries for Orchestrator

None. Implementation is clean and follows spec exactly.
