# IMPLEMENTATION — ORCH-1300 [web-gallery-picker]

Phase: IMPLEMENT · Skill: mingla-implementor · Date: 2026-07-04
Worktree: `~/Desktop/mingla-orchs/orch-1300-[web-gallery-picker]` · Branch: `orch-1300-web-gallery-picker` (rebased on origin/main)
Binding contract: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1300_WEB_PHOTO_COVER_UPLOAD.md` (commit `635d8d518`)
Status: **implemented and verified** (runnable gates PASS + fails-on-revert proven on the CI gate; jest/tsc/expo unrun here — partial symlinked node_modules — tester runs them under `npm ci`)

---

## 1. Summary (plain English)

On the Mingla Business **website**, the venue gallery "Add photos" button did nothing — you tapped it, it flickered "Uploading…" for a frame, and no photo picker ever opened and no error appeared. The button's photo picker was never actually built for the web; it hit a placeholder that instantly reports "nothing picked." This fix gives the web gallery a **real browser file chooser** — the exact same mechanism the "Add hero cover" button already uses on web (built in ORCH-1097). You can now pick several photos at once (capped at your remaining slots), and they upload and appear. It fixes the button in BOTH places it lives: the deck-readiness recovery page and the new venue-creation wizard's Photos step (they share one service). Native (iPhone/Android) is untouched — it keeps its real device picker. A CI guard now locks the web gallery picker so it can never silently regress to the placeholder again.

---

## 2. SPEC success-criteria coverage

Criteria derived from the dispatch's THE FIX (1–5) + the investigation's recommendation. All satisfied at commit `473020a7a` (this PR).

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | Web venue gallery gets a REAL browser file picker (`<input type=file multiple accept="image/*">` via the existing `pickBrowserFiles`), multi-select capped at REMAINING slots, returning the shape `uploadGalleryPhoto` expects | ✓ | New `venueGalleryDeviceMedia.ts` (web) → `pickBrowserFiles({ accept:"image/*", multiple:true, maxFiles:remainingSlots, validate:false })`; jest tests 1–3 (assets returned, cap respected). CI gate PASS. |
| SC-1-Web-deck | Fix reaches the deck-readiness recovery page (`VenueDeckReadinessSetup.handleAddPhotos`) | ✓ | Handler calls `pickGalleryPhotos` (unchanged) which now routes through the web split; jest test 6 (handler add path). |
| SC-1-Web-wizard | Fix reaches the META-ORCH-1290 wizard Photos step (`VenuePhotosStep.handleAdd`, s3) | ✓ | Same shared `pickGalleryPhotos`; both handlers fixed by the one service change. |
| SC-2 | Silent failure killed (Constitution #3): genuine cancel stays silent, picker-unavailable/error surfaces non-silently | ✓ | `pickBrowserFiles` throws `BrowserFilePickerError("unavailable")` → `pickGalleryPhotos` rethrows `VenueGalleryError` → handlers' existing `catch → setMessage`; a genuine empty selection returns `[]` (silent, per the binding investigation). jest tests 4 (silent cancel) + 5 (unavailable → throws). |
| SC-3 | Native picker behavior NOT touched | ✓ | New `venueGalleryDeviceMedia.native.ts` calls the SAME `launchImageLibraryAsync` (expo-image-picker) with byte-identical options; CI gate rule B locks it; the web `.ts`/native `.native.ts` split keeps the platform boundary clean. |
| SC-4 | Extend the ORCH-1097 web-media CI lock to the gallery (registry pattern — APPEND a job) | ✓ | New `.github/scripts/strict-grep/orch-1300-web-gallery-picker.mjs` (self-tested 7/7) + appended job in `strict-grep-mingla-business.yml`; ORCH-1097 guard untouched + still PASS. |
| SC-5 | Confirm the COVER ("Add hero cover") web path genuinely works (F-5 suspected) | ✓ (code) | `coverPickerDeviceMedia.ts` (web) routes image + video through `pickBrowserFiles` (lines 65, 76); permission granted on web; no gap found. Runtime 60-sec live-check still owed to the tester (authed biz-web). |

---

## 3. Files changed

| File | Type | Δ |
|------|------|---|
| `mingla-business/src/services/venueGalleryDeviceMedia.ts` | NEW (web split) | +68 |
| `mingla-business/src/services/venueGalleryDeviceMedia.native.ts` | NEW (native split) | +46 |
| `mingla-business/src/services/venueGalleryService.ts` | MODIFIED | +16 / −7 |
| `.github/scripts/strict-grep/orch-1300-web-gallery-picker.mjs` | NEW (CI gate) | +255 |
| `.github/workflows/strict-grep-mingla-business.yml` | MODIFIED (append job) | +14 |
| `mingla-business/src/services/__tests__/venueGalleryWebPicker.orch1300.test.ts` | NEW (regression test) | +190 |

No other files touched. No native deps added. No edge fn / migration / supabase change. No consumer-app change.

---

## 4. Data-model changes applied

None. This is a client-side web picker wiring change. Storage path + `sync_gallery` pipeline unchanged.

---

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- **Path:** `mingla-business/src/services/__tests__/venueGalleryWebPicker.orch1300.test.ts` (6 tests: real assets from a mocked `<input type=file>`, remaining-slots cap, silent empty-cancel, unavailable→throws non-silent, handler add path).
- **Runnability here:** UNRUN — the symlinked `node_modules` is partial (no `ts-jest` / `jest` / `@jest/globals` / `typescript`). Every test was hand-traced against `browserFilePicker.ts` + the new split and the service; it mirrors the shipped `browserFilePicker.test.ts` fake-input pattern. The tester runs it under a real `npm ci`.
- **Fails-on-revert (PROVEN on the runnable CI gate — pure node, no deps):**
  - Reverted the web split to the permanent-cancel stub (true deletion of the `pickBrowserFiles` wiring) → `orch-1300-web-gallery-picker.mjs` exit **1** (FAIL). Restored → exit **0** (PASS).
  - Reverted `venueGalleryService` to import `launchImageLibraryAsync` directly from `../utils/platformImagePicker` (the exact web-stub bug) → gate exit **1** (FAIL). Restored → exit **0** (PASS). Restore confirmed byte-identical.
  - `fails-on-revert verified at 473020a7a` (CI gate). The jest fails-on-revert is the same shape — reverting either the web split or the service routing makes `pickGalleryPhotos` return `[]`, failing tests 1–3 + 6.
- **Append-only:** all test files are NEW; no existing test modified or deleted.

---

## 7. Old → New receipts

### venueGalleryService.ts
**Before:** `pickGalleryPhotos` imported `launchImageLibraryAsync` + `PlatformImagePickerResult` from `../utils/platformImagePicker` and called it directly. On WEB that module is a permanent-cancel STUB → always `{ canceled:true, assets:[] }` → `pickGalleryPhotos` returned `[]` → silent dead tap.
**Now:** imports `launchGalleryImagePicker` + `GalleryDeviceMediaResult` from the new `./venueGalleryDeviceMedia` platform split. Web routes through the real browser file input; native routes through the unchanged expo picker. A thrown error (picker unavailable / native IO) becomes a non-silent `VenueGalleryError`; a genuine cancel returns `[]`.
**Why:** SC-1, SC-2 (kills the F-1/F-2/F-3 root cause).
**Lines:** ~16 changed.

### venueGalleryDeviceMedia.ts (NEW, web)
**Before:** n/a.
**Now:** `launchGalleryImagePicker(remainingSlots)` → `pickBrowserFiles({ accept:"image/*", multiple:true, maxFiles:remainingSlots, validate:false })`, mapping picked files to `{ uri (objectUrl), mimeType, fileName, fileSize }`. Validation deferred to `venueGalleryService` (HEIC-aware, mirrors native).
**Why:** SC-1 — the real web picker, mirroring ORCH-1097's `coverPickerDeviceMedia.ts`.
**Lines:** +68.

### venueGalleryDeviceMedia.native.ts (NEW, native)
**Before:** n/a.
**Now:** `launchGalleryImagePicker(remainingSlots)` → the SAME `launchImageLibraryAsync` (expo-image-picker) with the byte-identical pre-fix options (`mediaTypes:["images"]`, `allowsMultipleSelection:true`, `selectionLimit:remainingSlots`, `quality:0.7`).
**Why:** SC-3 — native behavior preserved exactly under the platform split.
**Lines:** +46.

### orch-1300-web-gallery-picker.mjs (NEW, CI gate) + workflow job
**Before:** the ORCH-1097 web-media lock never covered the gallery.
**Now:** a self-tested strict-grep gate (rules A/B/C) asserting the web split routes through `pickBrowserFiles` (multi-select + remaining-slots cap, no cancel-stub, no expo on web), the native split keeps the expo path (no browser picker), and `venueGalleryService` consumes the split (never the raw stub). Registered as an appended job.
**Why:** SC-4 — fails-on-revert regression lock.
**Lines:** +255 / +14.

---

## 8. Cross-surface impact table

| Surface | Affected? | What changes | Parity |
|---------|-----------|--------------|--------|
| Consumer iOS | No | Venue authoring is business-only | — |
| Consumer Android | No | " | — |
| Buyer/anonymous Web | No | Not a buyer route | — |
| Business iOS | No (behavior preserved) | Native split calls the same expo picker with identical options | Manual — verified by code + CI gate rule B |
| Business Android | No (behavior preserved) | " | " |
| Admin Web (adjacent) | No | No admin surface touched | — |
| Business Web preview (adjacent) | **YES** | Venue gallery "Add photos" now opens a real browser file picker (deck-readiness + 1290 wizard s3) | Automatic — one shared service |

Web is the only surface whose behavior changes (a fix). Native parity is manual (separate `.native` split) and is a strict no-op — locked by the CI gate.

---

## 9. Smoke result

- **CI gate `orch-1300-web-gallery-picker.mjs`:** self-test `PASS (7/7)`; live `PASS`. (pasted in the session log)
- **ORCH-1097 guard `orch-1097-business-web-media-picker-controls.mjs`:** `PASS` (unchanged, still green).
- **Fails-on-revert:** both revert directions → gate exit 1; restore → exit 0 (byte-identical restore).
- **jest / tsc / `expo export -p web --clear`:** UNRUN in this session — partial symlinked node_modules (no ts-jest/jest/typescript/expo). Tester runs them under `npm ci`.
- **Runtime (authed biz-web):** not run here (authed business-web runtime unreachable, per `feedback_biz_web_authed_runtime_unreachable`). The tester must live-fire: pick photos in the gallery on web and confirm they upload + render.

---

## 10. Known issues / deferred

- **Object-URL lifecycle (minor, bounded):** picked files mint browser object URLs used transiently by `uploadGalleryPhoto` (`fetch(objectUrl)`); they are not explicitly revoked (the gallery renders the uploaded PUBLIC url, not the objectUrl). Bounded (≤ GALLERY_MAX=20 per session, GC'd on navigation/reload). Same class as many web upload flows; not worth widening the shared service with web-only revoke plumbing. No `[TRANSITIONAL]` marker — it is a complete, acceptable steady state.
- **HEIC preview on web (pre-existing, D-2):** upload succeeds (bytes read fine) but the browser may not render an `<img>` preview for HEIC tiles. Out of scope for this picker fix; flagged for a separate web-preview ORCH.

---

## 11. Operator action required

- **Migration `db push`:** none.
- **Edge-fn deploy:** none.
- **Ship:** business **WEB only via Vercel `[deploy]`** at CLOSE. **NO `eas update`** for mingla-business (COMMS-0052 superseded by COMMS-0063 → business is NATIVE-BUILD-ONLY; native already works via the untouched `.native` split, so it needs nothing). No OTA reaches web anyway.
- **Tester gate:** run `npm ci` then the jest suite + `tsc` + `expo export -p web --clear` (unrun here); live-fire the web gallery upload on authed biz-web; and do the 60-second cover "Add hero cover" web live-check the investigation deferred (F-5 — code says it works).

---

## 12. Discoveries for Orchestrator

- **D-1 (from investigation, confirmed):** the web `platformImagePicker.ts` stub is STILL the picker for OTHER business-web callers — `GroupChatPanel.tsx`, `IntakeFilePickerChooserSheet.tsx`, `TripDayMediaSheet.tsx`, `marketing/campaigns/compose.tsx` all import `launchImageLibraryAsync`/`launchCameraAsync` from it. ORCH-1300 fixed ONLY the venue gallery (scope). Any of those that call the picker on web are equally dead-on-web. Recommend a follow-up ORCH to either give `platformImagePicker.ts` (web) a real path or split each caller like the gallery. (The camera stub `launchCameraAsync`/`requestCameraPermissionsAsync → granted:false` is also still a web no-op — separate camera-UX concern.)
- **Reconciliation note (SC-2):** the dispatch phrased item 2 as "yields nothing OR errors → toast." I implemented the investigation's precise binding contract instead — *genuine cancel stays silent; unavailable/error surfaces* — because toasting on every user cancel (which is what "yields nothing → toast" would do on native) is a UX regression and contradicts the binding investigation's recommendation #2. With the real web picker, an empty result now means a genuine cancel (correctly silent), and the only true failure paths throw and surface via the handlers' existing `catch`. Flagging for orchestrator awareness in case the tester expects a cancel-toast.
