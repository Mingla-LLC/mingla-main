# IMPLEMENTATION — ORCH-1321 [android-media-permission-strip]

**Date:** 2026-07-07
**App:** Mingla **Business** only (`mingla-business/`). `app-mobile/` untouched.
**Branch:** `1321-android-media-permission-strip` (rebased onto `origin/main` = `07d9f0653`).
**Status:** IMPLEMENT complete. Not deployed / not submitted / not merged / not closed (per guards).

Fixes the Google Play rejection under the **Photo and Video Permissions** policy: the
Business app only *picks* files (avatar/cover/chat attachment) so it may not hold
`READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` — it must use the Android **Photo Picker**, which
needs no permission. Root cause was pre-proven in
`reports/INVESTIGATION_ORCH-1321_ANDROID_MEDIA_PERMISSION_POLICY.md`.

---

## 1. Commits (branch `1321-android-media-permission-strip`)

| Hash | Scope |
|------|-------|
| `e19333ea0` | FIX — `app.json` permission strip + `blockedPermissions` + version bump; two wrapper Android short-circuits |
| `847a76adc` | REGRESSION — strict-grep gate + workflow wiring + jest runtime proof + jest config + npm script + DRAFT invariant |
| `<report>`  | this report (final commit) |

**Fails-on-revert proof anchored at HEAD `847a76adc`** (fix + test both present).

---

## 2. Files changed

**Fix (commit `e19333ea0`):**
- `mingla-business/app.json`
  - `expo.android.permissions`: removed `READ_MEDIA_IMAGES` + `READ_EXTERNAL_STORAGE`; kept `CAMERA`, `INTERNET`, `RECORD_AUDIO`.
  - added `expo.android.blockedPermissions` = `["READ_MEDIA_IMAGES","READ_MEDIA_VIDEO","READ_EXTERNAL_STORAGE","WRITE_EXTERNAL_STORAGE"]` (emits `tools:node="remove"`).
  - `expo.version` `1.0.2` → `1.0.3` (versionCode untouched).
- `mingla-business/src/utils/platformImagePicker.native.ts` — `requestMediaLibraryPermissionsAsync`: `if (Platform.OS === "android") return { granted: true, canAskAgain: true, status: "granted" };` before the dynamic `ImagePicker` import; added `import { Platform } from "react-native"`. Camera wrappers + web `.ts` variant untouched.
- `mingla-business/src/components/ui/coverPickerDeviceMedia.native.ts` — `requestCoverMediaLibraryPermission`: same Android short-circuit (`return { granted: true }`); added `Platform` import.

**Regression (commit `847a76adc`):**
- `.github/scripts/strict-grep/orch-1321-no-android-media-permissions.mjs` (new gate; root resolved from `__dirname` so it runs from CI root and from `mingla-business/`).
- `.github/workflows/strict-grep-mingla-business.yml` (new job `orch-1321-no-android-media-permissions` + registry-header entry).
- `mingla-business/jest.orch1321.cfg.cjs` (new; `isolatedModules:true` — same pattern as `jest.orch1297.cfg.cjs`, to transpile past the pre-existing baseline type error in the imported wrapper).
- `mingla-business/src/utils/__tests__/orch1321AndroidMediaPermissionSkip.test.ts` (new runtime proof).
- `mingla-business/package.json` (`test:orch-1321` script).
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (DRAFT `I-PROPOSED-1321-NO-ANDROID-MEDIA-PERMISSIONS`).

---

## 3. Manifest grep-proof (Step 3)

`npx expo prebuild --platform android --no-install` → grep of the generated
`android/app/src/main/AndroidManifest.xml`:

```
4:  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" tools:node="remove"/>
5:  <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" tools:node="remove"/>
6:  <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" tools:node="remove"/>
10: <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" tools:node="remove"/>
```

All four carry `tools:node="remove"` — the manifest merger strips them from the final
merged manifest (the desired outcome). The only ACTIVE `uses-permission` entries are
`CAMERA`, `INTERNET`, `READ_MEDIA_* (remove)`, `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`,
`VIBRATE`, `WRITE_EXTERNAL_STORAGE (remove)`, `AD_ID` — **no active** READ_MEDIA / READ_EXTERNAL / WRITE_EXTERNAL.
`android/` was then `rm -rf`-ed; `git status` shows no `android/` residue (`/android` is gitignored).

---

## 4. Wrapper audit (Step 2)

`grep -rn "requestMediaLibraryPermissionsAsync\|requestCoverMediaLibraryPermission" mingla-business/src | grep -v node_modules`
confirms the **two `.native.ts` wrappers are the only media-library permission path**. All 8
gallery consumers import from a wrapper (never the raw `ImagePicker` API):

| Consumer | Imports from |
|---|---|
| `ActivitiesSnapInput.native.tsx` | `../../utils/platformImagePicker` |
| `MenuSnapInput.native.tsx` | `../../utils/platformImagePicker` |
| `ExperienceStopPhotoSheet.tsx` | `../../utils/platformImagePicker` |
| `GroupChatPanel.tsx` | `../../utils/platformImagePicker` |
| `BrandAvatarPickerSheet.tsx` | `../../utils/platformImagePicker` |
| `IntakeFilePickerChooserSheet.tsx` | `../../../utils/platformImagePicker` |
| `TripDayMediaSheet.tsx` | `../../utils/platformImagePicker` |
| `CoverPicker.tsx` | `./coverPickerDeviceMedia` |

`grep` for raw `ImagePicker.requestMediaLibraryPermissionsAsync` / `import("expo-image-picker")`
found **zero** call sites outside the two wrappers. The web `.ts` variants
(`platformImagePicker.ts`, `coverPickerDeviceMedia.ts`) do NOT call the permission API (they
return static/browser values) — left untouched per instructions. **No additional short-circuit
sites were required.**

---

## 5. Gates (Step 5)

- **Typecheck** (`npx tsc --noEmit`, the repo's configured `typecheck` = `tsc`): the Business
  app carries **756 baseline errors on `origin/main`** (measured via `git stash -u` on the clean
  tree). **With my changes: also 756** → **zero new type errors added**. The only errors in files
  I touched are the 2 pre-existing `platformImagePicker.native.ts` errors in
  `launchImageLibraryAsync`/`launchCameraAsync` (functions I did not modify; `ImagePickerResult`'s
  canceled `assets:null` vs the non-null return type — a baseline mismatch, exactly why the
  dedicated `isolatedModules` jest config is used).
- **Jest — ORCH-1321 gate + runtime** (`npm run test:orch-1321`): strict-grep self-test PASS
  (5/5) + live PASS; jest **4/4 pass**.
- **Jest — related existing picker suites** (`orch1001CoverPickerWebSplit`,
  `orch_1097_browser_picker_component_contracts`): **10/10 pass, 2 suites** — no regression.

---

## 6. Fails-on-revert (Step 4b)

Temporarily removed the `if (Platform.OS === 'android') return { granted:true }` short-circuit
from **both** wrappers → `npx jest --config jest.orch1321.cfg.cjs orch1321AndroidMediaPermissionSkip`
reported **2 failed, 2 passed** (both Android "was-not-called" assertions fired: the wrappers fell
through and called the mocked `ImagePicker.requestMediaLibraryPermissionsAsync` once). Restored the
short-circuits → **4/4 pass**. Proof anchored at HEAD **`847a76adc`**.

The strict-grep gate's own `--self-test` proves fails-on-revert for the config half (re-adding any
media/storage permission to `permissions`, or dropping any `blockedPermissions` entry, exits 1).

---

## 7. Deviations / notes

- **Dedicated jest config** (`jest.orch1321.cfg.cjs`, `isolatedModules:true`) was required because
  the wrapper `platformImagePicker.native.ts` carries a PRE-EXISTING (origin/main) baseline `tsc`
  type error out of ORCH-1321 scope; this mirrors the repo's established `jest.orch1297.cfg.cjs`
  pattern. No scope creep — the wrapper's `launch*` type mismatch was left as-is.
- **Consumer app (`app-mobile/`) NOT touched** — the investigation §6 flags it as latent-risk and
  a separate scope decision for Seth; this ORCH is business-only.
- Not deployed / submitted / merged / closed (hard guards). GO-LIVE remains: fresh AAB via EAS
  (autoIncrement versionCode) + `eas submit` to internal + send to Google review.
