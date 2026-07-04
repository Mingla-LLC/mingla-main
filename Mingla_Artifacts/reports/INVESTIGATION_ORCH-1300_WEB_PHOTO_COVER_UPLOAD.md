# INVESTIGATION — ORCH-1300 [venue photo + hero-cover upload buttons do nothing on business WEB]

Phase: INVESTIGATE · Skill: mingla-forensics · Date: 2026-07-04
Sourcing: **origin/main @ `12e86062`** (anchor HEAD `c3ed85521` is 93 commits behind; all SHIPPED code read via `git show origin/main:<path>`).
Reporter: Seth, live prod, business.usemingla.com (web), screenshot on the venue **deck-readiness** page while recovering a stuck venue ("The Cluster Fuck", place_pool `cd41f4e8`, brand `1ce63bf4`) via Hub → Edit.

---

## LAYMAN ANSWER (read this first)

The **"Add photos" (venue gallery) button is genuinely broken on the web app** — and it fails **silently**. On the phone app that button opens your photo library; on the website the code that's supposed to open a file chooser was never actually built for web — it's a placeholder that instantly reports "nothing picked." So you tap it, it flickers "Uploading…" for a frame, and then nothing happens and no error appears. This is broken **both** on the deck-readiness recovery page you were on **and** in the new venue-creation wizard's Photos step, because they share the same code.

The **"Add hero cover" button is a different story: in the code it IS wired to a working web file chooser** (it was fixed for web back in ORCH-1097, unlike the gallery). Tapping it opens the cover sheet, and inside that sheet the "Image" button opens a real browser file picker. So the cover path *should* work on web — the most likely reason it looked dead to you is that the gallery failure next to it made the whole panel feel broken, or the actual upload button is one tap deeper inside the sheet. I could not log in to authed business-web to run it live, so I'm flagging the cover as "should work, needs a 60-second live check," while the gallery break is proven from the code itself.

**Bottom line:** venue **gallery photo upload is dead on web** (silent) → real bug, real fix needed. Hero **cover upload is code-wired to work on web** → verify live before assuming it's broken.

---

## Investigation manifest (every file read from origin/main, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx` | The screen Seth was on. Wires both buttons. |
| 2 | `mingla-business/src/services/venueGalleryService.ts` | Gallery pick+upload path (`pickGalleryPhotos`/`uploadGalleryPhoto`). |
| 3 | `mingla-business/src/utils/platformImagePicker.ts` (web) + `.native.ts` | The picker the gallery calls. **Web variant is the stub.** |
| 4 | `mingla-business/src/services/brandAvatarFileReader.ts` (web) + `.native.ts` | Byte reader the gallery upload reuses. |
| 5 | `mingla-business/src/components/ui/CoverPickerSheet.tsx` | Sheet opened by "Add hero cover". |
| 6 | `mingla-business/src/components/ui/CoverPicker.tsx` | The cover picker; device image/video handlers. |
| 7 | `mingla-business/src/components/ui/coverPickerDeviceMedia.ts` (web) + `.native.ts` | Cover device picker. **Web variant is real (browser file input).** |
| 8 | `mingla-business/src/utils/browserFilePicker.ts` | Real `<input type=file>` implementation (used by cover, not gallery). |
| 9 | `mingla-business/src/components/ui/Sheet.web.tsx` | Confirms the cover sheet mounts on web. |
| 10 | `mingla-business/src/components/venue/VenuePhotosStep.tsx` (1290 wizard s3) | Shares the gallery service → same break. |
| 11 | `mingla-business/src/components/venue/VenueCoverStep.tsx` (1290 wizard s4) | Shares CoverPickerSheet → same cover behavior. |
| 12 | `mingla-business/scripts/ci/orch-1097-business-web-media-picker-controls.mjs` | The CI guard that whitelisted cover-for-web but NOT the gallery. |

---

## Q-scorecard

- **Q1 — Does "Add photos" (gallery) work on web?**
  Verdict: **NO — it is a silent dead no-op on web.** `probable` (static proof airtight; live-fire blocked by named blocker: authed biz-web runtime unreachable). See F-1, F-2, F-3.
- **Q2 — Does "Add hero cover" work on web?**
  Verdict: **In code, YES — it opens a sheet whose device "Image" button uses a real browser file picker.** `suspected`-working; needs a live check. See F-4, F-5, F-6.
- **Q3 — Is the gallery break web-specific (vs broken everywhere)?**
  Verdict: **Web-specific.** Native resolves `platformImagePicker.native.ts` (real expo-image-picker); web resolves the stub `.ts`. See F-2.
- **Q4 — When the gallery pick fails on web, is there any user feedback?**
  Verdict: **NO feedback at all — fully silent.** Violates Constitution #1 (no dead taps) + #3 (no silent failures). See F-3.
- **Q5 — Does this also affect the META-ORCH-1290 wizard (Photos s3 / Cover s4)?**
  Verdict: **Photos (s3) YES — same stub. Cover (s4) NO — same working browser picker.** See F-7.
- **Q6 — What is the root cause of the asymmetry (cover works, gallery doesn't)?**
  Verdict: **The gallery was built on the ORCH-1092 permanent-cancel stub and never upgraded to the ORCH-1097 browser picker; the CI guard's in-scope-web list never covered it.** See F-8.
- **Q7 — Video cover on web?**
  Verdict: **Desktop web works (real browser video picker); phone web shows an honest "use desktop or the app" toast.** See F-6.

---

## Findings

### F-1 — "Add photos" calls the gallery pick service, which on web returns empty and the handler bails silently — CONFIRMED ROOT CAUSE
- **Symptom:** Tap "Add photos" on web → button flips to "Uploading…" for one frame → returns to "Add photos" → nothing added, no error.
- **Layer:** code (component + service).
- **Probe:** `git show origin/main:mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx`
- **Evidence:**
  - Button (VenueDeckReadinessSetup.tsx:557-571): `onPress={() => void handleAddPhotos()}`.
  - Handler (VenueDeckReadinessSetup.tsx:337-367):
    ```
    setGalleryBusy(true);
    ...
    const picked = await pickGalleryPhotos(remaining);
    if (picked.length === 0) return;      // ← line 347: silent bail, no setMessage
    ...
    } finally { setGalleryBusy(false); }
    ```
  - `pickGalleryPhotos` (venueGalleryService.ts:~93-118): calls `launchImageLibraryAsync(...)` from `../utils/platformImagePicker`; `if (result.canceled) return [];`.
- **Mechanism:** On web, `launchImageLibraryAsync` returns `{ canceled: true, assets: [] }` (F-2) → `pickGalleryPhotos` returns `[]` → `picked.length === 0` → `handleAddPhotos` returns with no message → nothing uploads, no feedback.
- **Severity:** `CONFIRMED ROOT CAUSE`.

### F-2 — The web `platformImagePicker` is a permanent-cancel STUB (no file input) — CONFIRMED ROOT CAUSE
- **Symptom:** The gallery picker never opens on web.
- **Layer:** code (platform-split module).
- **Probe:** `git ls-tree -r origin/main | grep platformImagePicker` → only `platformImagePicker.ts` (web/default) + `platformImagePicker.native.ts`. `git show origin/main:.../platformImagePicker.ts`.
- **Evidence** (`platformImagePicker.ts`, web/default variant):
  ```
  export const launchImageLibraryAsync = async (
    _options: Record<string, unknown>,
  ): Promise<PlatformImagePickerResult> => ({ canceled: true, assets: [] });
  ```
  `requestMediaLibraryPermissionsAsync` likewise hardcodes `{ granted: false }`. The `.native.ts` variant does `const ImagePicker = await import("expo-image-picker"); return ImagePicker.launchImageLibraryAsync(options);`.
- **Mechanism:** Expo/Metro web resolution excludes `.native.*` and picks `platformImagePicker.ts` (the stub) for web bundles. The stub unconditionally reports "cancelled, no assets," so no OS/browser picker ever opens and no file is ever returned on web.
- **Severity:** `CONFIRMED ROOT CAUSE`.

### F-3 — On web the failure is fully SILENT (no toast/error) — CONFIRMED (Constitution #1 + #3 violation)
- **Symptom:** No error, no toast, no "not supported here" message.
- **Layer:** code (component).
- **Probe:** read `handleAddPhotos` control flow.
- **Evidence:** VenueDeckReadinessSetup.tsx:347 `if (picked.length === 0) return;` — treats the web stub's forced-cancel identically to a genuine user cancel, so it deliberately shows nothing. `setMessage` is only called on upload errors or the max-count guard, neither of which is reached.
- **Mechanism:** The stub's "canceled" is indistinguishable from a real cancel, so the no-feedback branch fires. The user sees a dead tap.
- **Severity:** `CONFIRMED ROOT CAUSE` (silent-failure aspect). Violates Constitution #1 (no dead taps) and #3 (no silent failures).

### F-4 — "Add hero cover" opens `CoverPickerSheet`, which mounts on web — RULED OUT (not the break)
- **Symptom:** Tapping the button.
- **Layer:** code (component + web sheet).
- **Probe:** read VenueDeckReadinessSetup.tsx + Sheet.web.tsx.
- **Evidence:** VenueDeckReadinessSetup.tsx:506-512 `onPress={() => setCoverVisible(true)}` (pure state, no gate); the sheet is rendered at :794-805 `<CoverPickerSheet visible={coverVisible} ... target={{ kind: "venue", brandId, venueId }} />`. `Sheet.web.tsx` gates only on `mounted`: `if (!mounted) return null;` then renders `<Modal>`, and `mounted` is seeded from and driven by `visible`. So the sheet opens on web.
- **Mechanism:** No web-disabled guard on the cover button or the sheet mount → the tap is NOT dead.
- **Severity:** `RULED OUT` (as a dead-tap cause).

### F-5 — The cover device-image path uses a REAL browser file picker on web — CONFIRMED WORKING (code)
- **Symptom:** Inside the cover sheet, the "Image"/"Replace" button.
- **Layer:** code (component + web device-media split).
- **Probe:** read CoverPicker.tsx + coverPickerDeviceMedia.ts + browserFilePicker.ts.
- **Evidence:**
  - CoverPicker imports `launchCoverImagePicker`/`launchCoverVideoPicker` from `./coverPickerDeviceMedia` (CoverPicker.tsx:50-54).
  - `pickImageOrGifCover` (CoverPicker.tsx:423-535) → `const result = await launchCoverImagePicker(); if (result.canceled || result.assets.length === 0) return;` then `uploadBrandCover(...)` for the venue target.
  - The "Image" button (LibraryTab, CoverPicker.tsx:1171-1181) has `onPress={onPickImage}` and is disabled only by `uploading || disabled` — **not** web-gated.
  - `coverPickerDeviceMedia.ts` (web) `launchCoverImagePicker` → `pickBrowserFiles({ accept: "image/jpeg,image/png,image/webp,image/gif", maxFiles: 1 })`.
  - `browserFilePicker.ts` `pickBrowserFiles` creates `input.type = "file"`, `input.click()`, resolves picked `File`s with `objectUrl` — a genuine browser picker.
  - Permission on web: `requestCoverMediaLibraryPermission` → `{ granted: typeof document !== "undefined" }` = granted on web (no false block).
- **Mechanism:** The cover was made web-safe by ORCH-1097 (F-8). The device image upload is fully wired end-to-end on web for the venue target.
- **Severity:** `RULED OUT` as a break; **CONFIRMED WORKING in code** (runtime unverified — see confidence).

### F-6 — Cover VIDEO on web: works on desktop, honestly-gated on phone web — CONFIRMED
- **Layer:** code.
- **Evidence:** `pickVideoCover` (CoverPicker.tsx:551-556): `if (isPhoneWeb) { onShowToast("Video cover uploads are available on desktop or in the app for now."); return; }` where `isPhoneWeb = Platform.OS==='web' && window.innerWidth < 768`. On desktop web it proceeds to `launchCoverVideoPicker` → `pickBrowserFiles({ accept: "video/mp4,video/quicktime,video/*" })`; web has no native trimmer so it uploads the raw clip (`isNative ? trim : null`, CoverPicker.tsx:571-577). "Video" button disabled only when `uploading || disabled || isPhoneWeb` (:1189).
- **Mechanism:** Desktop-web video cover upload is functional; phone-web is intentionally deferred with a toast (not a silent dead tap).
- **Severity:** `RULED OUT` as a break (video cover behaves correctly / honestly on web).

### F-7 — The 1290 wizard shares BOTH paths: Photos (s3) is ALSO broken; Cover (s4) is NOT — CONFIRMED
- **Layer:** code (wizard step components).
- **Evidence:**
  - `VenuePhotosStep.tsx` (wizard s3) imports the same `pickGalleryPhotos`/`uploadGalleryPhoto` (:26-28) and its `handleAdd` has the identical silent bail: `const picked = await pickGalleryPhotos(remaining); if (picked.length === 0) return;` (:95-96). → **same web break as F-1.**
  - `VenueCoverStep.tsx` (wizard s4) opens the same `CoverPickerSheet` (:26, :102 `onPress={() => setPickerVisible(true)}`, :202 `<CoverPickerSheet .../>`). → **same working web cover path as F-5.**
- **Mechanism:** Both surfaces consume the same two services, so the web gallery break and the web cover functionality are shared.
- **Severity:** `CONFIRMED` — web venue **gallery** upload is broken across BOTH the deck-readiness recovery page and the 1290 wizard; web **cover** upload is code-wired on both.

### F-8 — Root cause of the asymmetry: gallery built on the ORCH-1092 stub, never given the ORCH-1097 browser picker, and never added to the web CI guard — CONFIRMED ROOT CAUSE
- **Layer:** code + process/history.
- **Probe:** `git log origin/main --oneline -- <path>` for both web variants; read the ORCH-1097 CI guard.
- **Evidence:**
  - `platformImagePicker.ts` (stub) created by **`80f7a3d0d [deploy] ORCH-1092 business web restoration wave`**.
  - `coverPickerDeviceMedia.ts` (real web picker) last built by **`02d728b40 [deploy] ORCH-1097 business web media picker controls`**.
  - `orch-1097-business-web-media-picker-controls.mjs` `IN_SCOPE_WEB_FILES` lists `CoverPicker.tsx`, `coverPickerDeviceMedia.ts`, `BrandAvatarPickerSheet.tsx`, `app/account/edit-profile.tsx`, `ExperienceStopPhotoSheet.tsx`, `ActivitiesSnapInput.tsx`, `MenuSnapInput.tsx` — **`venueGalleryService.ts` and `platformImagePicker.ts` are absent.**
  - `venueGalleryService.ts` header attributes it to META-ORCH-1009 Sub-E (built after 1097) and it imports `launchImageLibraryAsync` from `platformImagePicker` (the stub), not `browserFilePicker`.
- **Mechanism:** ORCH-1097 made the cover picker web-safe and locked it with a CI guard, but the later Sub-E venue gallery reused the leftover ORCH-1092 stub `platformImagePicker` and was never included in the guard's in-scope-web list, so no reviewer/CI ever caught that the gallery has no real web picker.
- **Severity:** `CONFIRMED ROOT CAUSE`.

---

## Five-Truth-Layer reconciliation

| Layer | Gallery ("Add photos") | Cover ("Add hero cover") |
|-------|------------------------|--------------------------|
| **Docs** | venueGalleryService header: "Opens the photo library with MULTI-SELECT — `expo-image-picker`" (native-only framing; web unaddressed). | ORCH-1097 SPEC/guard: cover is web-safe via `browserFilePicker`. |
| **Schema** | N/A (storage `brand_covers/{brandId}/gallery/...`). | N/A. |
| **Code** | Web = stub `{canceled:true}`; silent bail. | Web = real `<input type=file>`; sheet mounts. |
| **Runtime** | Not run (authed biz-web unreachable — named blocker). Static behavior deterministic. | Not run. Code path complete. |
| **Data** | No upload occurs → no `sync_gallery` write on web. | Would write `venue_listings.cover_media_*` via `syncHeroMedia`. |

**Contradiction flagged:** Docs/native truth (gallery "opens the photo library") disagrees with web Code truth (permanent-cancel stub). Code holds truth on web → the gallery is a web dead tap.

---

## Repro evidence

- **Live-fire NOT performed.** Named, known blocker: **authed business-web runtime is unreachable to this environment** (memory `feedback_biz_web_authed_runtime_unreachable_cap_claims`) — the deck-readiness page requires an authenticated brand/venue session. Per Prime Directive 7 + Failure Honesty this caps confidence at `probable` for the gallery and `suspected` for the cover.
- **Static proof is deterministic and airtight for the gallery:** the web bundle resolves an unconditional `{ canceled: true, assets: [] }` stub; there is no runtime branch that could make it succeed.

---

## Blast radius / cross-surface map

- **Business Web (deck-readiness recovery page)** — gallery BROKEN; cover code-wired. IN SCOPE.
- **Business Web (1290 wizard: VenuePhotosStep s3 / VenueCoverStep s4)** — Photos BROKEN; Cover code-wired. IN SCOPE (shared services).
- **Business iOS / Android (native)** — gallery + cover WORK (`.native.ts` variants use expo-image-picker). OUT OF SCOPE (not broken).
- **Consumer iOS / Android** — N/A (venue authoring is business-only). OUT OF SCOPE.
- **Anon/Buyer web, Admin web** — N/A. OUT OF SCOPE.
- **Adjacent (same stub) note:** any OTHER business-web feature that imports `launchImageLibraryAsync` from `platformImagePicker` is equally dead on web. `git grep` shows `venueGalleryService.ts` as the primary consumer; grep the stub before fixing to catch siblings.

## Invariant impact (flagged, not resolved)

- **Constitution #1 (no dead taps)** — violated by the web gallery button.
- **Constitution #3 (no silent failures)** — violated (no toast on the web no-op).
- **I (ORCH-1097 web-media-picker guard)** — the guard did not cover `venueGalleryService.ts`/`platformImagePicker.ts`; extending it is the natural regression lock (SPEC to decide).

## Discoveries for Orchestrator (side issues)

- **D-1:** `platformImagePicker.ts` web stub also hardcodes `requestMediaLibraryPermissionsAsync → { granted: false }` and `launchCameraAsync → canceled`. Any web caller of these is silently non-functional. Worth a repo-wide grep during the fix.
- **D-2:** HEIC on web — `venueGalleryService` accepts `image/heic|heif` and the web byte-reader (`brandAvatarFileReader.ts` → `fetch(objectUrl).arrayBuffer()`) will read HEIC bytes fine, but browsers won't render an HEIC `<img>` preview; `EventCoverMedia` gallery tiles may show broken previews for HEIC even after a successful upload. Flag for the SPEC's web-preview handling (not a blocker for upload).

## Confidence

- **Gallery broken on web: `probable`** (static bundle-resolution proof is deterministic and complete; the only unmet step is authed-biz-web live-fire, blocked by a named/known environment limit).
- **Cover works on web: `suspected`** (full code path traced and wired to a real browser picker + web sheet; not runtime-confirmed). Do NOT assume the cover is broken without a 60-second live check.

## Recommended next phase + scope (direction only — NOT a fix)

1. **SPEC a web implementation for the venue gallery picker**, mirroring exactly what ORCH-1097 did for the cover: give `platformImagePicker` a real web path (or route `venueGalleryService.pickGalleryPhotos` through `pickBrowserFiles`) using `<input type=file multiple accept="image/*">`, multi-select capped at remaining slots, returning `objectUrl` uris that the existing web `readBrandAvatarFileBytes` (`fetch().arrayBuffer()`) already handles. Minimal, additive, web-only.
2. **Add a non-silent fallback contract** so a genuine cancel stays silent but a not-supported/unavailable path surfaces a toast — closing the Constitution #1/#3 violation regardless.
3. **Extend the ORCH-1097 web-media CI guard** to include `venueGalleryService.ts` (+ `platformImagePicker.ts`) so a stubbed web picker can never ship again (fails-on-revert regression lock).
4. **Live-fire verify the cover on authed biz-web** (tester) to confirm F-5 before closing — if it truly is dead, re-open with runtime evidence; the code says it should work.
5. Cross-surface note: business web ships via **Vercel** (`[deploy]` tag), native via native build (no `eas update` reaches web) — the fix lands on web independently of any OTA.

Recommended handoff: **mingla-forensics (SPEC)** to author `SPEC_ORCH-1300_WEB_PHOTO_COVER_UPLOAD.md`, then implementor, then tester (with the authed-biz-web cover live-fire as a gate).
