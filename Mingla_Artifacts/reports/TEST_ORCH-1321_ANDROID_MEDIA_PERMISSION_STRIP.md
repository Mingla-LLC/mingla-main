# TEST — ORCH-1321 [android-media-permission-strip]

**Date:** 2026-07-07
**Tester:** mingla-tester (Claude)
**Worktree:** `~/Desktop/mingla-orchs/1321-[android-media-permission-strip]/` on branch `1321-android-media-permission-strip`
**Base:** rebased on `origin/main` = `07d9f0653` (verified: 3 commits ahead, 0 behind after `git fetch`)
**App:** Mingla **Business** only (`mingla-business/`). `app-mobile/` NOT in scope (investigation §6 latent-risk — separate decision for Seth).
**Contract:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1321_ANDROID_MEDIA_PERMISSION_POLICY.md`
**Implementor report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1321_ANDROID_MEDIA_PERMISSION_STRIP.md`

---

## 1. Verdict

**PASS** — 0 P0 · 0 P1 · 0 P2 · 1 P3 · 2 P4.

Build-config (Android manifest permission strip) + narrow permission-wrapper change. The
policy fix is **artifact-proven** at the merged-manifest level; the #1 correctness risk
(gallery dead-tap on Android) is **proven** by a full source dead-tap audit + jest gate
behavior + fails-on-revert; camera and iOS flows are **unchanged**; zero new type errors;
all gates green. The single unobserved element — the on-device Photo Picker opening with
no permission prompt — is a deterministic property of the stripped manifest + expo-image-picker
v17 and can only be authentically observed on the **go-live production AAB** (the exact artifact
Seth submits); the dispatch explicitly accepts this deferral. Device gallery-pick line is
therefore capped at **suspected**, folding into the go-live Android build.

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | `app.json` `android.permissions` no longer lists `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE` | **PASS** | diff `e19333ea0` removes both; only `CAMERA`/`INTERNET`/`RECORD_AUDIO` remain |
| SC-2 | `app.json` `android.blockedPermissions` = full 4-perm set | **PASS** | diff adds `READ_MEDIA_IMAGES`,`READ_MEDIA_VIDEO`,`READ_EXTERNAL_STORAGE`,`WRITE_EXTERNAL_STORAGE` |
| SC-3 | Merged Android manifest declares NO active media/storage permission | **PASS (artifact-proven)** | `expo prebuild` → manifest: all 4 carry `tools:node="remove"`; active perms = CAMERA/INTERNET/RECORD_AUDIO/VIBRATE/AD_ID/SYSTEM_ALERT_WINDOW |
| SC-4 | Every Android gallery-pick site reaches `launchImageLibraryAsync` (no dead-tap) | **PASS (source+jest)** · device suspected | dead-tap audit §7 (10 sites all via fixed wrappers / ungated); adversarial test 4/4 |
| SC-5 | No site calls raw `ImagePicker.requestMediaLibraryPermissionsAsync()` directly | **PASS** | grep: the only raw calls are inside the 2 fixed wrappers (now behind Android short-circuit) |
| SC-6 | Camera path UNCHANGED, still gates on CAMERA | **PASS** | `requestCameraPermissionsAsync` has no Android short-circuit; still calls the real API |
| SC-7 | iOS behavior unchanged (real permission still requested) | **PASS** | wrappers fall through to real API on iOS; NSPhotoLibraryUsageDescription intact in `app.json` |
| SC-8 | Version bumped 1.0.2 → 1.0.3 | **PASS** | diff `e19333ea0` |
| SC-9 | CI regression guard present + wired + fails-on-revert | **PASS** | `npm run test:orch-1321` self-test 5/5 + gate PASS + jest 4/4; adversarial 4/4 |
| SC-10 | No new type errors introduced | **PASS** | `tsc`: 756 total = baseline; touched files carry only the 2 pre-existing baseline errors |

---

## 3. Findings

**P0 / P1 / P2:** none.

**P3-1 (device runtime not observed — accepted by dispatch).** The on-device gallery pick
(Photo Picker opens with no permission prompt, pick completes) was not driven: no Android
emulator/device is attached and no business build is installed; building a business dev APK
from this worktree (EAS cloud or local Gradle+AVD) is not cheaply feasible, and a dev build
would not be the submission artifact anyway. Per the dispatch, this folds into the go-live
production Android build (the same AAB Seth submits). Evidence substituting for runtime: the
merged-manifest artifact proof (§6) + the dead-tap source audit (§7) + jest gate behavior.
*Impact:* the final "no permission prompt" UX is proven only at artifact + logic level.
*Retest:* confirm on the first internal-track AAB — pick a brand avatar / event cover on an
Android 13+ device; the system Photo Picker must open with NO permission dialog and complete.

**P4-1 (praise).** Clean minimal fix: the Android short-circuit lives in the two shared
wrappers, so all 10 downstream consumers are covered without touching a single call site —
the correct "subtract before adding" shape. Belt-and-suspenders `blockedPermissions` also
force-strips the historical library-injected `READ_MEDIA_VIDEO`/`WRITE_EXTERNAL_STORAGE`.

**P4-2 (praise).** The strict-grep gate ships with a `--self-test` covering 5 revert cases
(re-add each perm to `permissions`, drop each from `blockedPermissions`), and the jest config
mirrors the established per-ORCH `isolatedModules` pattern to transpile past the pre-existing
baseline type error — no scope creep into the unrelated `launch*` type mismatch.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out state at HEAD **`04a68dc6b`** (fix + implementor test both present). Deleted the
`if (Platform.OS === 'android') return {granted:true}` short-circuit from **both** wrappers
(`platformImagePicker.native.ts`, `coverPickerDeviceMedia.native.ts`) and ran the implementor's
`orch1321AndroidMediaPermissionSkip` suite:

```
✕ platformImagePicker.native — Android returns granted WITHOUT calling ImagePicker
✓ platformImagePicker.native — iOS DOES call ImagePicker...
✕ coverPickerDeviceMedia.native — Android returns granted WITHOUT calling ImagePicker
✓ coverPickerDeviceMedia.native — iOS DOES call ImagePicker...
  expect(mockRequestMediaLibraryPermissionsAsync).not.toHaveBeenCalled()
  Expected number of calls: 0 / Received number of calls: 1   (lines 60, 75)
Tests: 2 failed, 2 passed, 4 total
```

Restored both short-circuits (wrappers byte-identical, `git diff` clean) → **4/4 pass**.
The implementor's fails-on-revert claim (anchored `847a76adc`) is **independently reproduced**.

---

## 5. Adversarial test added (different angle)

**Path:** `mingla-business/src/components/ui/__tests__/orch1321AndroidGalleryNoDeadTap.test.ts`

**Angle (distinct from the two existing tests):**
- The implementor's unit mocks the permission as `granted:true` and only asserts the wrapper
  "was not called" — it never drives the downstream launcher, so it **cannot catch a dead tap**.
- The strict-grep gate asserts app.json config integrity only.
- **This test** simulates the POST-STRIP Android reality — the underlying
  `ImagePicker.requestMediaLibraryPermissionsAsync` mocked to `granted:FALSE` (as it would
  resolve on Android 13+ with the permission stripped) — then drives the ACTUAL consumer gate
  predicate (`if (!permission.granted) bail; else launch`) end-to-end through the **real
  wrappers** and asserts the flow still **reaches `launchImageLibraryAsync`** (the Photo Picker) —
  i.e. NO DEAD TAP — precisely because the wrapper short-circuits on Android. It also pins iOS
  parity (denied still blocks; granted proceeds; the real permission is still requested).

**Result:** 4/4 PASS on the fix.
**Fails-on-revert:** deleting the short-circuit from both wrappers → **2 failed, 2 passed**
(the two Android assertions flip from `reached_picker` to `blocked` — the exact dead tap);
iOS assertions stay green. Restored → 4/4. **Fails-on-revert verified at fix HEAD `04a68dc6b`**
(committed with my test at the tester-test commit on branch `1321-android-media-permission-strip`).

Both the implementor's happy-path test and this adversarial test appear in
`git diff origin/main...HEAD --name-only` for the closing PR (on-branch, in-diff, append-only —
no existing test modified).

---

## 6. Manifest proof (the whole point)

`cd mingla-business && npx expo prebuild --platform android --no-install` then
`grep -nE "READ_MEDIA|READ_EXTERNAL|WRITE_EXTERNAL|uses-permission" android/app/src/main/AndroidManifest.xml`:

```
2:  <uses-permission android:name="android.permission.CAMERA"/>
3:  <uses-permission android:name="android.permission.INTERNET"/>
4:  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" tools:node="remove"/>
5:  <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" tools:node="remove"/>
6:  <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" tools:node="remove"/>
7:  <uses-permission android:name="android.permission.RECORD_AUDIO"/>
8:  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
9:  <uses-permission android:name="android.permission.VIBRATE"/>
10: <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" tools:node="remove"/>
11: <uses-permission android:name="com.google.android.gms.permission.AD_ID"/>
```

All four blocked perms carry `tools:node="remove"` → the manifest merger strips them from the
FINAL merged manifest. **ACTIVE (non-removed) uses-permission = CAMERA, INTERNET, RECORD_AUDIO,
SYSTEM_ALERT_WINDOW, VIBRATE, AD_ID** — **NO active READ_MEDIA_IMAGES / READ_MEDIA_VIDEO /
READ_EXTERNAL_STORAGE / WRITE_EXTERNAL_STORAGE**. This is exactly what clears Google's Photo &
Video Permissions policy. `android/` was then `rm -rf`-ed; `git check-ignore android` confirms
it is gitignored; `git status` shows only my new test file untracked — no manifest/prebuild
residue.

---

## 7. Dead-tap audit (the #1 correctness risk)

Every Android gallery-pick call site enumerated from
`grep -rn "requestMediaLibraryPermissionsAsync\|requestCoverMediaLibraryPermission\|MediaLibrary\|ImagePicker\|launchImageLibraryAsync" mingla-business/src`:

| # | Site (file:line) | Permission gate | Wrapper | Reaches picker on Android? | Verdict |
|---|------------------|-----------------|---------|----------------------------|---------|
| 1 | `CoverPicker.tsx:413` (ensureMediaPermission → pickImageOrGifCover :440) | `requestCoverMediaLibraryPermission()` | `coverPickerDeviceMedia.native` **(FIXED)** | yes → `launchCoverImagePicker` :446 → `launchImageLibraryAsync` | **PASS** |
| 2 | `CoverPicker.tsx:572` (pickVideoCover, via ensureMediaPermission) | `requestCoverMediaLibraryPermission()` | `coverPickerDeviceMedia.native` **(FIXED)** | yes → `launchCoverVideoPicker` :577 → `launchImageLibraryAsync(videos)` | **PASS** |
| 3 | `BrandAvatarPickerSheet.tsx:104` | `requestMediaLibraryPermissionsAsync()` | `platformImagePicker.native` **(FIXED)** | yes → `launchImageLibraryAsync` :137 | **PASS** |
| 4 | `IntakeFilePickerChooserSheet.tsx:129` | `requestMediaLibraryPermissionsAsync()` | `platformImagePicker.native` **(FIXED)** | yes → `launchImageLibraryAsync` :136 | **PASS** |
| 5 | `GroupChatPanel.tsx:78` | `requestMediaLibraryPermissionsAsync()` (`status!=='granted' && !granted`) | `platformImagePicker.native` **(FIXED)** | yes → `launchImageLibraryAsync` :86 | **PASS** |
| 6 | `TripDayMediaSheet.tsx:329` | `requestMediaLibraryPermissionsAsync()` | `platformImagePicker.native` **(FIXED)** | yes → `launchImageLibraryAsync` :334 | **PASS** |
| 7 | `ExperienceStopPhotoSheet.tsx:320` | `requestMediaLibraryPermissionsAsync()` | `platformImagePicker.native` **(FIXED)** | yes → `launchImageLibraryAsync` :325 | **PASS** |
| 8 | `MenuSnapInput.native.tsx:102` | `requestMediaLibraryPermissionsAsync()` | `platformImagePicker.native` **(FIXED)** | yes → `launchImageLibraryAsync` :107 | **PASS** |
| 9 | `ActivitiesSnapInput.native.tsx:102` | `requestMediaLibraryPermissionsAsync()` | `platformImagePicker.native` **(FIXED)** | yes → `launchImageLibraryAsync` :107 | **PASS** |
| 10 | `venueGalleryService.ts:100` → `venueGalleryDeviceMedia.native.ts:32` | **NO permission gate** | `platformImagePicker.native` (direct `launchImageLibraryAsync`) | yes (ungated; Photo Picker needs none) | **PASS** (no gate = no dead-tap) |
| — | Camera: `IntakeFilePickerChooserSheet:96`, `ActivitiesSnapInput:84`, `MenuSnapInput:84` | `requestCameraPermissionsAsync()` | `platformImagePicker.native` **(UNCHANGED)** | gates on CAMERA (correct) | **PASS** (unchanged) |
| — | `usePermissionWithFallback.ts` hook | defined, **ZERO usages** | n/a | n/a | **N/A** (dead code — not wired to any pick) |

**Every gate predicate is `if (!granted) bail; else launch`** — none inverts logic or branches
on `canAskAgain` to force a settings dialog, so an always-`granted` result on Android simply
proceeds. **Raw `ImagePicker.requestMediaLibraryPermissionsAsync()` call sites outside the two
wrappers: ZERO.** No consumer imports `expo-image-picker` directly (pre-existing guard tests
`metaOrch1059SubAFixes`, `orch_1092_business_web_restoration_wave` already assert this). iOS: both
wrappers fall through to the real API (`Platform.OS === "android"` guard only), so
NSPhotoLibraryUsageDescription flow is intact.

---

## 8. Gates + typecheck

| Check | Result |
|-------|--------|
| `npm run test:orch-1321` (wired gate) | strict-grep self-test **5/5 PASS** + gate PASS + jest **4/4 PASS** |
| Implementor jest (`orch1321AndroidMediaPermissionSkip`) | **4/4 PASS** |
| Related picker suites (`orch1001CoverPickerWebSplit`, `orch_1097_browser_picker_component_contracts`) | **10/10 PASS, 2 suites** |
| Tester adversarial (`orch1321AndroidGalleryNoDeadTap`) | **4/4 PASS** (fails-on-revert: 2 failed on revert) |
| Business typecheck (`tsc --noEmit`) | **756 errors = 756 baseline → 0 NEW**. Touched-file errors: only the 2 pre-existing baseline `platformImagePicker.native.ts` errors (lines 43/50, in `launch*` funcs the fix did not touch). `coverPickerDeviceMedia.native.ts` + new test file: 0 errors. |

---

## 9. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | **PASS** | §7 audit — all 10 gallery sites reach the picker on Android; camera/iOS unchanged |
| 2 | One owner per truth | **PASS** | permission decision centralized in the 2 shared wrappers |
| 3 | No silent failures | **PASS** | iOS still surfaces `permission_denied`; Android proceeds honestly (Photo Picker) |
| 4 | One query key per entity | **N/A** | no data-fetch change |
| 5 | Server state server-side | **N/A** | no Zustand/server-state change |
| 6 | Logout clears everything | **N/A** | no auth/session change |
| 7 | `[TRANSITIONAL]` labelled | **N/A** | no transitional code |
| 8 | Subtract before adding | **PASS** | permission removed + wrapper short-circuit; no new call sites, no new deps |
| 9 | No fabricated data | **PASS** | `granted:true` on Android is TRUE (Photo Picker genuinely needs no permission), not fabricated |
| 10 | Currency-aware | **N/A** | no money surface |
| 11 | One auth instance | **N/A** | untouched |
| 12 | Validate at the right time | **PASS** | permission checked at pick time; Android correctly skips a no-op check |
| 13 | Exclusion consistency | **N/A** | none |
| 14 | Persisted-state startup gate | **N/A** | none |

---

## 10. Device / parity matrix

| Surface | Ships here? | Result | Notes |
|---------|-------------|--------|-------|
| Business Android | YES (the target) | **PASS (artifact+logic)** · device **suspected** | manifest strip artifact-proven (§6); dead-tap audit clean (§7); on-device pick folds into go-live AAB (P3-1) |
| Business iOS | YES | **PASS (source)** | wrappers unchanged on iOS; NSPhotoLibraryUsageDescription intact; camera unchanged |
| Business Web preview | adjacent | **N/A** | `.web`/`.ts` variants untouched; web uses `pickBrowserFiles` / stub (no permission API) |
| Consumer iOS/Android | no | **SKIP** | `app-mobile/` out of scope (investigation §6 latent-risk — separate Seth decision) |
| Buyer/anon Web | no | **SKIP** | not touched |
| Admin Web | no | **SKIP** | not touched |
| Physical iPhone (HITL) | not required | **SKIP** | iOS path is source-only unchanged; no iOS behavior change to drive |

No emulator/device was attached (`adb devices` empty; business app not installed) and a fresh
business dev build is not cheaply feasible from this worktree — device runtime capped at
suspected per dispatch (P3-1).

---

## 11. Discoveries for Orchestrator (not fixed here)

1. **`SYSTEM_ALERT_WINDOW` is an active auto-injected permission** in the merged manifest
   (library-injected, not from `app.json`; pre-existing, unchanged by ORCH-1321). It is OUT of
   scope for the Photo & Video Permissions policy but is itself a sensitive permission that some
   Play policy passes scrutinize. Informational — pre-existing, present on the currently-live
   build code 6 (which was rejected ONLY for READ_MEDIA), so not a new risk. Flag if a future
   "draw over other apps" rejection appears.
2. **Consumer app (`app-mobile/`) latent risk** — investigation §6: consumer also calls
   `ImagePicker.requestMediaLibraryPermissionsAsync()` and its live build may carry
   library-injected `READ_MEDIA_*`. Recommend applying the same strip proactively (Seth's scope
   call). Not this ORCH.
3. **Go-live is a native rebuild** — no `eas update` (COMMS-0063/0052: business OTA bricks
   launch). The fix reaches users only via a fresh AAB (EAS `autoIncrement` versionCode) →
   `eas submit` to internal → send to Google review. Verify the P3-1 runtime on that build.

---

## 12. Comms ledger

Read on entry. No active entry is `severity: BLOCK` or addressed to `mingla-tester` / ORCH-1321
specifically; all active rows are `to: ALL`, WARN/FYI (historical ID-collision + business-OTA-
native-only notices). COMMS-0063/0052 (business OTA = native build only) is consistent with this
ORCH's go-live plan and reflected in Discovery §11.3. No new cross-ORCH discovery to write.

---

## Regression-gate status
- Implementor happy-path: `orch1321AndroidMediaPermissionSkip` — **fails-on-revert reproduced (Step 0.5) at `04a68dc6b`** (2 failed / 2 passed on revert; 4/4 restored).
- Tester adversarial: `mingla-business/src/components/ui/__tests__/orch1321AndroidGalleryNoDeadTap.test.ts` — different angle (dead-tap flow-proceeds), on-branch, in-diff, **fails-on-revert verified at `04a68dc6b`**.
