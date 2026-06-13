# IMPLEMENTATION — ORCH-1119C · HEIC → JPEG client-side conversion (trip-day media)

**Date:** 2026-06-12
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]/` · branch `ORCH-1119-trip-day-media-gallery`
**Commit:** `2183cc1bc6e98de3529b8eac7ceb867250dcda11`
**Status:** implemented and verified (jest + typecheck of changed files + fails-on-revert). Device verification (real HEIC photo upload) pending the orchestrator's EAS dev build.

---

## 1. Summary

iPhones shoot HEIC by default. The trip-day media gallery's native "Choose from library" picker returned `mimeType:"image/heic"` / `fileName:"IMG_xxxx.heic"`, and `tripDayMediaService.resolveTripDayMediaContentType` hard-rejects any explicit-but-unsupported MIME → `BrandCoverError` "Choose a JPEG, PNG, WebP, GIF, MP4, MOV, or WebM." → `uploadedCount:0` → nothing rendered. HEIC also doesn't render on Android or the public web trip page.

Fix: a new client-side helper converts HEIC/HEIF → JPEG on-device **before** upload, wired into the native picker branch of `TripDayMediaSheet`. jpeg/png/webp/GIF/video all pass through unchanged. The upload service's allowlist/RLS were left untouched (it already accepts `image/jpeg`). The 6 temporary `[ORCH-1119-DIAG]` console.logs were removed.

---

## 2. SPEC / dispatch success-criteria coverage

This was a dispatch-driven fix (no separate SPEC_ORCH-1119C file; the contract is the dispatch). Criteria mapped:

| # | Criterion | Verified how | Status | Hash |
|---|-----------|--------------|--------|------|
| SC-1 | Add `expo-image-manipulator` the SDK-correct way (native module recorded in package.json + lockfile) | `npx expo install`; grep package.json/lockfile; `~14.0.8` resolves | ✓ | 2183cc1bc |
| SC-2 | HEIC/HEIF → JPEG before upload, trip-day native branch ONLY | unit test (convert by mime + by extension w/ null mime); wired in `pickFromLibrary` native branch (`Platform.OS !== "web"`) | ✓ | 2183cc1bc |
| SC-3 | jpeg/png/webp pass through unchanged | unit test passthrough cases (no `manipulateAsync` call) | ✓ | 2183cc1bc |
| SC-4 | GIF passes through unchanged (animation preserved) | unit test: gif → `manipulateAsync` NOT called, returns same object | ✓ | 2183cc1bc |
| SC-5 | Videos pass through unchanged (.mov/quicktime/mp4/webm) | unit test: video → not converted | ✓ | 2183cc1bc |
| SC-6 | Web picker path unaffected | normalize gated to `Platform.OS !== "web"` in the loop; web branch builds `assets` separately and skips normalize | ✓ | 2183cc1bc |
| SC-7 | Remove the 6 `[ORCH-1119-DIAG]` logs (zero remain) | `grep -rn ORCH-1119-DIAG mingla-business/src` → 0 | ✓ | 2183cc1bc |
| SC-8 | `tripDayMediaService` allowlist/RLS untouched | file not in diff | ✓ | 2183cc1bc |
| SC-9 | Trips-only; no experiences/events/cover-pipeline/`packages/event-rendering` touched | diff = 5 files, all trip-scoped | ✓ | 2183cc1bc |
| SC-10 | Unit test w/ fails-on-revert; jest gates; typecheck clean | below | ✓ | 2183cc1bc |

---

## 3. Files changed (5)

| File | Δ | Note |
|------|---|------|
| `mingla-business/package.json` | +1 | `"expo-image-manipulator": "~14.0.8"` |
| `mingla-business/package-lock.json` | +~15 | lockfile entry (real `npm install` via `npx expo install`) |
| `mingla-business/src/utils/normalizeTripDayImage.ts` | +112 (new) | the conversion helper |
| `mingla-business/src/components/trip/TripDayMediaSheet.tsx` | +18 / −9 | wire normalize into native loop; remove 6 DIAG logs |
| `mingla-business/src/utils/__tests__/normalizeTripDayImage.test.ts` | +210 (new) | 16-case unit test |

---

## 4. Dependency added

- **`expo-image-manipulator@14.0.8`** (pinned `~14.0.8`), installed via `npx expo install expo-image-manipulator` (SDK-54-correct). **NATIVE MODULE** — ships `android/`, `ios/`, `local-maven-repo/` in node_modules. Matches the existing `app-mobile` pin (`~14.0.8`), so the version is already proven in the monorepo. Uses the still-exported legacy `manipulateAsync` + `SaveFormat.JPEG` API (same call style app-mobile's `cameraService.ts` uses).

---

## 5. Conversion logic + hook point

**Helper** `src/utils/normalizeTripDayImage.ts`:
- `isHeicAsset(asset)` → true when `mimeType === image/heic|image/heif` (trimmed/lowercased) OR the URI/fileName ends `.heic`/`.heif` (case-insensitive, query/hash-stripped).
- `normalizeTripDayImage(asset)`:
  - NOT heic → return the asset object **unchanged** (jpeg/png/webp/GIF/video/unknown). GIF and video are never converted.
  - heic/heif → `ImageManipulator.manipulateAsync(uri, [], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG })`; returns `{ ...asset, uri: result.uri, mimeType: "image/jpeg", fileName: <name>.jpg, fileSize: null, width/height from result }`. `fileSize` is nulled so the upload service re-measures the real JPEG bytes against the 25 MB cap.

**Hook point** `TripDayMediaSheet.pickFromLibrary`, inside the per-asset upload loop, native branch only:
```ts
const normalized =
  Platform.OS === "web"
    ? asset
    : await normalizeTripDayImage({ uri, mimeType, fileName, fileSize, width, height });
const media = await uploadTripDayMedia(brandId, eventId, { ...normalized });
```
Web assets (already validated by `validateBrowserFile`) bypass normalize. A conversion throw is caught by the existing per-item `try/catch` → friendly toast, partial-success preserved (Constitution #3).

---

## 6. DIAG logs removed

All 6 `[ORCH-1119-DIAG]` console.log lines deleted from `TripDayMediaSheet.tsx` (pickFromLibrary TAP, media permission, picker result, per-asset, upload OK, upload THREW, batch done, CAUGHT — the 6 the orchestrator added). **`grep -rn "ORCH-1119-DIAG" mingla-business/src` → 0 matches.** CLOSE-protocol clean.

---

## 7. Regression test + fails-on-revert

- **Path:** `mingla-business/src/utils/__tests__/normalizeTripDayImage.test.ts` (append-only, marked `[TEST-MOD-APPROVED ORCH-1119]` in the commit body).
- **16 tests, all pass.** Covers: HEIC by mime → converts (`manipulateAsync` called with `[], {compress:0.9, JPEG}`, returns jpeg uri + `image/jpeg` + `.jpg` name); HEIF by mime; HEIC by extension w/ null mime; HEIC by fileName-only; jpeg/png/webp passthrough (no manipulate); **GIF passthrough (manipulate NOT called)**; video (.mov quicktime, .mp4) passthrough; `isHeicAsset` detection matrix.
- **Fails-on-revert: verified at `2183cc1bc`.** Method = true LINE DELETION of the conversion body (replaced the `isHeicAsset` short-circuit + `manipulateAsync` call + JPEG return with a bare `return asset;`). Re-run → **4 conversion tests FAILED** (`Expected number of calls: 1, Received: 0`). Fix restored → 16/16 PASS again.

```
PASS src/utils/__tests__/normalizeTripDayImage.test.ts
Tests: 16 passed, 16 total
```

**Existing ORCH-1119 suites — no regression:** `npx jest orch1119 normalizeTripDayImage --runInBand` → **5 suites, 47 tests, all PASS** (persistence, multiselect rework, visible-failure, the tester's adversarial coerce-boundary suite, + the new helper test).

---

## 8. Old → New receipts

### `src/utils/normalizeTripDayImage.ts` (NEW)
- **Before:** did not exist.
- **Now:** exports `isHeicAsset` + `normalizeTripDayImage`; converts HEIC/HEIF→JPEG, passes everything else through.
- **Why:** SC-2/3/4/5 — the only client-side conversion point.
- **Lines:** +112.

### `src/components/trip/TripDayMediaSheet.tsx`
- **Before:** native picker handed each raw asset straight to `uploadTripDayMedia`; 6 DIAG console.logs throughout `pickFromLibrary`.
- **Now:** imports `normalizeTripDayImage`; each native asset is normalized (HEIC→JPEG) before upload; web assets bypass it; all DIAG logs removed.
- **Why:** SC-2/6/7.
- **Lines:** +18 / −9.

### `package.json` / `package-lock.json`
- **Before:** no `expo-image-manipulator`.
- **Now:** `~14.0.8` recorded + installed.
- **Why:** SC-1.

---

## 9. Cross-surface impact

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Consumer iOS | No | trips authored in business app; consumer only renders the resulting public URL (already JPEG) |
| Consumer Android | No | same |
| Buyer/anonymous Web (public trip page) | Indirectly POSITIVE | day media is now JPEG → renders (HEIC never rendered here) |
| Business iOS | **Yes** | HEIC photos now convert + upload; native build required |
| Business Android | **Yes** (parity automatic — shared RN code) | HEIC rare on Android but the same path handles it |
| Admin Web (adjacent) | No | not in scope |
| Business Web preview (adjacent) | No | web picker branch bypasses normalize |

Parity iOS↔Android is **automatic** (one shared `TripDayMediaSheet` + helper).

---

## 10. Smoke result

- Jest: helper test 16/16 PASS; fails-on-revert proven by line deletion; ORCH-1119 suite 47/47 PASS.
- Typecheck (`npx tsc --noEmit`): **my 3 touched/added files are clean** (`normalizeTripDayImage.ts`, `TripDayMediaSheet.tsx`, the test — zero errors). The only `tsc` errors are pre-existing baseline noise in `packages/phone-input/*` and `eventCoverVideoProcessingService.ts` — untouched by this change (empty `git diff origin/main` on those files), an environment/types-version artifact, NOT a regression.
- Module resolution: `expo-image-manipulator@14.0.8` present in real node_modules with `build/` + native `android/`/`ios/`; ts-jest imports + mocks it cleanly.
- **NOT yet device-verified** with a real iPhone HEIC photo — that needs the orchestrator's EAS dev build (this is a native module; see §12).

---

## 11. Known issues / deferred

- **No `[TRANSITIONAL]` markers introduced.**
- Worktree was **not rebased onto origin/main** (it's 11 behind). Deliberate: the orchestrator pre-prepped this worktree with a real `npm ci` + a running Metro dev server on port 8091; a rebase risked disturbing that. Verified none of the 11 upstream commits touch any file in this fix (`git diff HEAD...origin/main` over the target files = empty), so building on this base is safe. The orchestrator can rebase/merge at its discretion.
- The broad-glob `npx jest trip` run surfaces ~146 pre-existing cross-file ts-jest failures (e.g. `eventCoverVideoProcessingService.ts:808` expo-video-thumbnails API drift). These are baseline, untouched by this change, and out of scope.

---

## 12. Operator action required

- **NATIVE BUILD REQUIRED — NOT OTA-able.** `expo-image-manipulator` is a native module (ships `android/` + `ios/`). It must be compiled into a new dev/prod build via `eas build`; an `eas update` (OTA) will NOT pick it up and the conversion will throw `NativeModule null` at runtime. Per `project_ota_deferred_until_new_build.md` this ORCH now requires a real build (the rest of ORCH-1119 was OTA-only; 1119C flips that).
- **No migrations, no edge-function deploys** in this ORCH.
- Device verification: after the dev build, on a physical iPhone, add a HEIC photo to a trip day → it should upload + render (and render on Android + the public web trip page).

---

## 13. Discoveries for Orchestrator

- **COMMS-0029 (WARN, to ORCH-1119/ALL) factored:** it concerns the `biz_update_live_trip` migration being prod-applied-but-unmerged and at risk of clobber by ORCH-1120. **My change touches ZERO migrations and ZERO RPCs** — it is purely client-side (helper + sheet + dep), so it has no bearing on the migration-clobber risk. I could not append my implementor-side ack to the ledger because the shared anchor `~/Desktop/mingla-main` has pre-existing unstaged changes (not mine — `package.json`/lockfile + other sessions' artifacts) and the hard rule forbids me editing/resetting the anchor working tree. Please record the implementor ack and keep the standing ASK live: **merge the 1119 migrations to origin/main before ORCH-1120 applies its migration**, else day-media dies on prod.
- **expo-image-manipulator legacy API:** v14 still exports `manipulateAsync` + `SaveFormat` (deprecated in favor of the new `ImageManipulator.manipulate()` context API). Used the legacy form per the dispatch and to match app-mobile's existing usage. A future ORCH could migrate both call sites to the new API, but not needed now.
- **Pre-existing typecheck baseline noise** (`packages/phone-input/*` missing react types; `eventCoverVideoProcessingService.ts` expo-video-thumbnails arg-count drift) — unrelated, worth a cleanup ORCH.
