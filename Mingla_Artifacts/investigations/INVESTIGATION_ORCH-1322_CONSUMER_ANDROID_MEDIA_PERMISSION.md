# INVESTIGATION — ORCH-1322 [consumer-android-media-permission-latent]

**Date:** 2026-07-10
**App:** Mingla **Consumer** (`app-mobile/`, `com.mingla.app.v2`) — Google Play (Android) surface only.
**iOS:** unaffected (keeps `NSPhotoLibraryUsageDescription`; no policy change).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1322-[consumer-android-media-perms]/` on branch `ORCH-1322-consumer-android-media-perms` (rebased on `origin/main` = `dde139516`).
**Precedent:** ORCH-1321 [android-media-permission-strip] (business app) — SHIPPED + CLOSED (PR #801 `e1109536b`), `I-PROPOSED-1321-NO-ANDROID-MEDIA-PERMISSIONS` ACTIVE. This investigation is the consumer-app equivalent.
**Class:** launch-hardening / platform-compliance (proactive — apply the proven business fix to consumer BEFORE its next Play submission, so it never trips the identical Photo & Video Permissions rejection).
**Status:** INVESTIGATE complete. Root cause characterised with file:line + library-source + config evidence. No fix implemented. SPEC follows (`specs/SPEC_ORCH-1322_CONSUMER_ANDROID_MEDIA_PERMISSION.md`).

---

## 1. Symptom summary (expected vs actual)

There is **no live rejection of the consumer app**. This is a *latent-exposure* investigation flagged by ORCH-1321 §6: Google rejected the **business** app (`com.sethogieva.minglabusiness`) under the **Photo and Video Permissions** policy for declaring `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` while only *picking* occasional media. The consumer app picks media the same way (chat attachments, profile avatar, beta-feedback screenshots, board photos) and is about to cut a **1.1.1 Android production build**.

- **Expected (compliant target):** the consumer AAB submitted to Play declares **no** `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` (and, per the business precedent, no `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE`); every gallery pick still reaches the Android Photo Picker (which needs no permission); camera stays on `CAMERA`; iOS keeps `NSPhotoLibraryUsageDescription`.
- **Actual (current state, pre-fix):** consumer `app-mobile/app.json` declares **no** media/storage permission explicitly (simpler than business) and has **no** `blockedPermissions`. The installed `expo-image-picker@17.0.11` library manifest injects `READ_EXTERNAL_STORAGE` + `WRITE_EXTERNAL_STORAGE` (but **not** `READ_MEDIA_*`) into every fresh merged manifest. The currently-live build (code 16 / 1.1.0) is at latent policy risk **if** it was built with a pre-16.0.0 picker that injected `READ_MEDIA_*` (SUSPECTED — see F-2). There is **no** permission-wrapper abstraction; three gallery gate sites call `ImagePicker.requestMediaLibraryPermissionsAsync()` inline, two of which **block the pick on denial** and would DEAD-TAP on Android ≤12 the moment `blockedPermissions` strips `READ/WRITE_EXTERNAL_STORAGE` (F-3).

---

## 2. Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` (COMMS-0086, COMMS-0087) | Entry protocol; COMMS-0086 (re: 1322) is the ORCH-1321 precedent + reusable fix pattern |
| 2 | `reports/INVESTIGATION_ORCH-1321_ANDROID_MEDIA_PERMISSION_POLICY.md` | The business root-cause + §6 consumer latent-risk flag |
| 3 | `reports/IMPLEMENTATION_ORCH-1321_ANDROID_MEDIA_PERMISSION_STRIP.md` | The proven 3-part business fix (app.json strip + wrapper short-circuit + version bump) |
| 4 | `reports/TEST_ORCH-1321_ANDROID_MEDIA_PERMISSION_STRIP.md` | The dead-tap audit method + adversarial-guard shape |
| 5 | `.github/scripts/strict-grep/orch-1321-no-android-media-permissions.mjs` | The exact gate rule to re-scope for consumer |
| 6 | `INVARIANT_REGISTRY.md` (I-1321 block) | Invariant shape to mirror as `I-PROPOSED-1322-*` |
| 7 | `app-mobile/app.json` | Current `expo.android.permissions` / `blockedPermissions` / `version` / `runtimeVersion` |
| 8 | `app-mobile/app.config.ts` | Confirms it spreads `...config` and only augments `plugins`/`extra` (android block governed by app.json) |
| 9 | `app-mobile/package.json` | `expo-image-picker ~17.0.11`; no jest key/dep; node `.mjs` `test:orch-*` convention |
| 10 | `node_modules/expo-image-picker/android/src/main/AndroidManifest.xml` | Library-injected permissions at v17.0.11 (the merged-manifest source) |
| 11 | `node_modules/expo-image-picker/CHANGELOG.md` (16.0.0) | Proof `READ_MEDIA_*` were removed from the library in 16.0.0 |
| 12 | `node_modules/expo-image-picker/plugin/build/withImagePicker.js` | Config-plugin behaviour (does NOT add `READ_MEDIA_*`; not in plugins array anyway) |
| 13 | `node_modules/expo-image-picker/android/.../ImagePickerModule.kt:254-296` | The native permission-request mechanism (which Android band actually dead-taps) |
| 14 | `app-mobile/src/services/cameraService.ts` | Gate site 3 (media check WARN-only; coupled to CAMERA) + camera launch sites |
| 15 | `app-mobile/src/components/BetaFeedbackModal.tsx:284-312` | Gate site 1 (BLOCKS on denial; multi-select) |
| 16 | `app-mobile/src/components/MessageInterface.tsx:716-760` | Gate site 2 (BLOCKS on denial; chat attach) |
| 17 | `app-mobile/src/components/BoardDiscussion.tsx:335-356` | Ungated gallery pick + camera launch |
| 18 | `app-mobile/eas.json` | `appVersionSource: remote` + production `autoIncrement` → versionCode handling |
| 19 | `.github/workflows/strict-grep-mingla-business.yml` | The catch-all mobile gate workflow (runs on `app-mobile/**`); wiring template |
| 20 | `app-mobile/plugins/withoutSystemAlertWindow.js` | Repo precedent for a prebuild manifest-mod plugin (context) |

---

## 3. Q-scorecard

**Q1 — Does consumer `app-mobile/app.json` explicitly declare any media/storage permission, and does it have `blockedPermissions`?**
`Verdict:` **No media/storage permission declared; no `blockedPermissions`.** `expo.android.permissions` (app.json:128-139) = location (fine/coarse, prefixed + unprefixed), `CAMERA`, `RECORD_AUDIO`, `READ_CALENDAR`, `WRITE_CALENDAR`, `MODIFY_AUDIO_SETTINGS`. No `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`/`READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE`. No `blockedPermissions` key anywhere. Confidence: **proven** (source).

**Q2 — Does the merged Android manifest still inject `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` at the installed picker version?**
`Verdict:` **No, for a fresh build at 17.0.11** — the library removed them in 16.0.0 and the config plugin is not applied. BUT the library **does** still inject `READ_EXTERNAL_STORAGE` + `WRITE_EXTERNAL_STORAGE`. The `READ_MEDIA_*` claim is **proven-absent by source-chain** (library manifest + no plugin + no app.json declaration); a full `expo prebuild` merged-manifest confirmation is **deferred** to the implementor/tester (I did not run prebuild — see §6). Confidence: **proven (source-chain)** for absence of `READ_MEDIA_*` at build time; merged-manifest artifact proof deferred. See F-1.

**Q3 — Is the currently-live consumer build (code 16 / 1.1.0) carrying library-injected `READ_MEDIA_*`?**
`Verdict:` **SUSPECTED** — only if code 16 was built with a pre-16.0.0 picker. Cannot be proven without the Play API declared-permissions for code 16 or that exact AAB. Non-critical: code 16 is superseded by the fresh 1.1.1 build regardless. Confidence: **suspected** (source-only; not a reproducer-bound UI bug). See F-2.

**Q4 — Which gallery-pick sites exist and which would DEAD-TAP if the storage permissions are stripped?**
`Verdict:` **4 pick files / 6 `launchImageLibraryAsync` calls; 3 permission-gate sites; 2 of them block-on-denial → DEAD-TAP on Android ≤12 after the strip.** There is **no** permission-wrapper abstraction (unlike business's 2 wrappers). Confidence: **proven** (source). See F-3 + §7 site table.

**Q5 — Which Android version band actually dead-taps, and why?**
`Verdict:` **Android ≤12 (API < 33), not Android 13+.** `ImagePickerModule.kt:254-262` returns an **empty** permission array on TIRAMISU+ (API 33+) → `requestMediaLibraryPermissionsAsync()` resolves **granted** regardless of manifest; on API < 33 it requests `WRITE_EXTERNAL_STORAGE` + `READ_EXTERNAL_STORAGE`, which `blockedPermissions` would strip → **denied → dead-tap** at the two blocking gates. (This refines ORCH-1321 §4's "Android 13+" wording; the fix — an all-Android short-circuit — is correct either way.) Confidence: **proven** (library source). See F-3.

**Q6 — Are multi-select and camera unaffected?**
`Verdict:` **Yes.** Multi-select options (`allowsMultipleSelection: true` at BetaFeedbackModal:297; `false` at MessageInterface) are launch-time options untouched by a permission-gate change. Camera stays on `CAMERA`: `cameraService.ts:32` `requestCameraPermissionsAsync`, `:58`/`:138` + `BoardDiscussion.tsx:348` `launchCameraAsync` are not media-library gates. iOS `NSPhotoLibraryUsageDescription` (app.json:22) is untouched. Confidence: **proven** (source). See F-4.

**Q7 — What version / versionCode must the next production build carry to supersede code 16 on Play?**
`Verdict:` **version 1.1.1 (keep — already ahead of live 1.1.0); Android versionCode auto-incremented by EAS to the next value > 16.** `eas.json` has `cli.appVersionSource: "remote"` + `build.production.autoIncrement: true` → the versionCode is stored/incremented **remotely by EAS**; there is **no** `android.versionCode` literal in app.json and none must be added. No marketing-version bump is required for supersession (versionCode handles it). Confidence: **proven** (eas.json) for the mechanism; the exact live code (16) is cited from the ORCH-1321 Play API pull (2026-07-07) and is non-critical to the outcome. See F-5.

**Q8 — Where do consumer strict-grep gates run in CI, so the new gate is wired correctly?**
`Verdict:` **`.github/workflows/strict-grep-mingla-business.yml`** — despite the name it triggers on `app-mobile/**` (lines 7-8, 21-22) and already hosts consumer gates (`orch-1230-consumer-*`) and the business `orch-1321` gate (job at lines 189-200). The new `orch-1322-*` gate is added as a sibling job there. Confidence: **proven** (workflow source). See F-6.

---

## 4. Findings

### F-1 — Fresh consumer build at picker 17.0.11 does NOT inject `READ_MEDIA_*`; it DOES inject `READ_EXTERNAL_STORAGE` + `WRITE_EXTERNAL_STORAGE`. (answers Q2) — **SECONDARY ROOT CAUSE**
- **Symptom:** the compliance target is "no `READ_MEDIA_*` in the AAB"; the current build already meets it at source level for a fresh build, but two legacy storage permissions still merge in.
- **Layer:** schema/build-config (Android manifest merge).
- **Probe:** `cat node_modules/expo-image-picker/android/src/main/AndroidManifest.xml`; `grep '16.0.0' node_modules/expo-image-picker/CHANGELOG.md`; `grep -i permission node_modules/expo-image-picker/plugin/build/withImagePicker.js`; confirm `expo-image-picker` NOT in `app.json` `plugins`.
- **Evidence (verbatim):** library manifest declares exactly:
  ```
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
  ```
  (no `READ_MEDIA_*`). CHANGELOG 16.0.0: `Remove READ_MEDIA_IMAGES and READ_MEDIA_VIDEO permissions.` The config plugin `withAndroidImagePickerPermissions` only *blocks* perms when the developer passes `cameraPermission:false`/`microphonePermission:false`; it never *adds* `READ_MEDIA_*`; and `expo-image-picker` is absent from `app.json` `plugins` (lines 144-211) so the plugin does not run — only the library manifest merges via autolinking.
- **Mechanism:** at 17.0.11 a fresh merged manifest carries `READ_EXTERNAL_STORAGE` + `WRITE_EXTERNAL_STORAGE` (active, no `tools:node="remove"`), plus `CAMERA` (also in app.json). `READ_MEDIA_*` are absent. `blockedPermissions` for the full 4-set force-strips the two storage perms and permanently locks `READ_MEDIA_*` absent even if a future dep bump re-introduces them.
- **Severity:** SECONDARY ROOT CAUSE (the storage-permission residue is real and strip-worthy; `READ_MEDIA_*` on a fresh build is not the live offender it was for business — the difference that makes this "latent," not "active").

### F-2 — The currently-live consumer build (code 16 / 1.1.0) MAY carry library-injected `READ_MEDIA_*`. (answers Q3) — **SUSPECTED CONTRIBUTOR**
- **Symptom:** a Google policy sweep of the live listing could flag `READ_MEDIA_*` on code 16.
- **Layer:** data (the published AAB's declared permissions) — not inspectable from source.
- **Probe:** would require Google Play Developer API `androidpublisher/v3` declared-permissions for code 16, or teardown of the code-16 AAB. NOT run this pass (read-only investigation; the number is non-load-bearing).
- **Evidence:** ORCH-1321 §6 states consumer "currently-live production build is code 16 (1.1.0)" and flags it as latent-risk; the exact picker version code 16 was built with is unknown here.
- **Mechanism:** if code 16 predates picker 16.0.0, its AAB carries library-injected `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` → same non-compliance as business code 6. Either way, a fresh 1.1.1 build supersedes it.
- **Severity:** SUSPECTED CONTRIBUTOR (motivates the proactive fix; not provable from source; resolved by the fresh build regardless).

### F-3 — No permission-wrapper abstraction; 2 of 3 gate sites BLOCK on denial → DEAD-TAP on Android ≤12 once storage perms are stripped. (answers Q4, Q5) — **CONFIRMED ROOT CAUSE (of the fix's #1 correctness risk)**
- **Symptom:** if `blockedPermissions` strips `READ/WRITE_EXTERNAL_STORAGE` without a code change, the two blocking gallery gates return early ("permission denied") on Android ≤12 and never open the picker — a dead tap.
- **Layer:** code (React Native component/service).
- **Probe:** `grep -rn "requestMediaLibraryPermissionsAsync\|launchImageLibraryAsync\|from ['\"]expo-image-picker" app-mobile/src`; read each gate; read `ImagePickerModule.kt:254-296`.
- **Evidence (verbatim):**
  - `BetaFeedbackModal.tsx:288-292` — `const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (status !== 'granted') { setPermissionMessage(...); return; }` **← BLOCKS** (then `launchImageLibraryAsync` :295, `allowsMultipleSelection:true`).
  - `MessageInterface.tsx:722-730` — `const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (status !== "granted") { Alert.alert(...); return; }` **← BLOCKS** (then `launchImageLibraryAsync` :739/:746/:755).
  - `cameraService.ts:39-43` — media check is **WARN-only, non-blocking** (`console.warn('Media library permission not granted')`), so `pickFromLibrary` (:98) proceeds; but `initialize()` (:27-51) blocks on **CAMERA** (:34) — a pre-existing coupling, not this policy's dead-tap (see Discovery D-1).
  - `ImagePickerModule.kt:254-262` — `getMediaLibraryPermissions`: `if (SDK_INT >= TIRAMISU) emptyArray() else listOfNotNull(WRITE_EXTERNAL_STORAGE, READ_EXTERNAL_STORAGE.takeIf{!writeOnly})`. So on API 33+ the request is empty → **granted**; on API < 33 it requests the two storage perms.
  - No shared permission hook/util exists: `grep -rln "usePermission\|PermissionsAndroid\|ensureMediaPermission" app-mobile/src` returns only the three files above (they define nothing shared).
- **Mechanism:** post-strip, on Android ≤12 the two blocking gates request `READ/WRITE_EXTERNAL_STORAGE` which are no longer in the manifest → OS returns denied → `status !== 'granted'` → early `return` → dead tap. On Android 13+ the request is empty → granted → no dead tap (short-circuit is a harmless no-op there). The fix must therefore short-circuit the media-library permission to `{granted:true}` on **all Android** (the Photo Picker needs no permission on any supported version) before the pick — exactly the business pattern — and, because consumer has no wrapper, this requires a **new shared wrapper** that all 3 sites route through.
- **Severity:** CONFIRMED ROOT CAUSE of the correctness risk the config strip introduces (this is the trap ORCH-1321 called out; here it is Android-≤12-scoped and un-abstracted).

### F-4 — Multi-select, camera, and iOS are unaffected. (answers Q6) — **RULED OUT (as regressions)**
- **Layer:** code + config.
- **Evidence:** `allowsMultipleSelection` is a `launchImageLibraryAsync` option (BetaFeedbackModal:297 `true`; MessageInterface:743/750/758 `false`) — untouched by a permission-gate change. Camera gates are separate (`requestCameraPermissionsAsync` cameraService:32; `launchCameraAsync` cameraService:58/:138, BoardDiscussion:348) and stay on `CAMERA`. iOS `NSPhotoLibraryUsageDescription` (app.json:22) + camera/mic strings untouched; the short-circuit is `Platform.OS==='android'`-guarded so iOS still calls the real API.
- **Severity:** RULED OUT — these must NOT change; the SPEC lists them DO-NOT-TOUCH.

### F-5 — Version 1.1.1 stays; Android versionCode auto-increments remotely (> 16). (answers Q7) — **CONFIRMED (target)**
- **Layer:** build-config.
- **Evidence:** `app.json:5` `"version": "1.1.1"`; `app.json:225-227` `runtimeVersion.policy: appVersion`; `eas.json` `cli.appVersionSource: "remote"` + `build.production.autoIncrement: true`; no `android.versionCode` literal anywhere. Live Android prod = code 16 / 1.1.0 (ORCH-1321 §6 Play API pull).
- **Mechanism:** EAS assigns the next versionCode remotely at build (> 16 guaranteed). The marketing `version` 1.1.1 is already ahead of live 1.1.0; a native permission/manifest change ships in a **native** build (NO OTA — COMMS-0063 family: OTA cannot change the manifest anyway). Keeping runtimeVersion `1.1.1` is fine (native manifest is not JS/OTA-served).
- **Severity:** CONFIRMED — the SPEC pins "keep 1.1.1; do NOT add a versionCode literal; rely on EAS remote autoIncrement."

### F-6 — Consumer strict-grep gates run in `strict-grep-mingla-business.yml`. (answers Q8) — **CONFIRMED (wiring)**
- **Layer:** CI.
- **Evidence:** workflow `on.pull_request.paths` + `on.push.paths` include `app-mobile/**` and `.github/scripts/strict-grep/**` (lines 6-16, 20-31); the ORCH-1321 gate job is at lines 189-200 (`node .github/scripts/strict-grep/orch-1321-no-android-media-permissions.mjs --self-test` then without `--self-test`); consumer gates `orch-1230-consumer-*` also live here. app-mobile has **no** jest key/dep and its dominant runtime-guard convention is node `.mjs` checks under `app-mobile/scripts/ci/` wired as `test:orch-*` npm scripts (see Open Question OQ-1).
- **Severity:** CONFIRMED — the SPEC wires the new gate as a sibling job here + a `test:orch-1322` npm script mirroring business's `test:orch-1321`.

---

## 5. Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction? |
|-------|-------|----------------|
| **Docs** | ORCH-1321 §6 + COMMS-0086 say consumer is latent-risk; apply the same fix proactively. Play policy: pickers must use the Photo Picker, no `READ_MEDIA_*`. | none — this investigation executes that directive. |
| **Schema (manifest merge)** | app.json declares NO media/storage perms; picker 17.0.11 injects `READ_EXTERNAL_STORAGE`+`WRITE_EXTERNAL_STORAGE` (not `READ_MEDIA_*`). | **Contradiction vs the business mental model:** business's `READ_MEDIA_*` came from *app.json*; consumer's exposure is *library storage residue* + a *latent* live-build `READ_MEDIA_*` (F-2), not an app.json declaration. Truth: the library manifest. |
| **Code** | 3 inline gate sites, 2 block-on-denial; no wrapper. | **Contradiction vs business:** business had 2 clean wrappers; consumer is un-abstracted → the fix must *create* the wrapper (F-3). |
| **Runtime (native)** | `ImagePickerModule.kt`: empty request on API 33+ (granted), storage request on API <33. | **Contradiction vs ORCH-1321 §4 wording** ("dead-tap on Android 13+"): the real dead-tap band post-strip is **≤12**. The all-Android short-circuit fixes both; only the stated band was imprecise. Truth: the Kotlin source. |
| **Data** | Live Android = code 16 / 1.1.0 (per 1321 Play pull). code-16 declared permissions not re-inspected this pass. | none blocking — F-2 capped `suspected`; versionCode auto-increment makes the exact number non-load-bearing. |

---

## 6. Repro evidence

This is a **build-config / native-manifest / CI** investigation — **exempt from the live-fire simulator directive** (Prime Directive 7 exemptions: build-config / CI). No UI reproducer was described. Evidence is source-level and authoritative for the config/library layers:
- Library manifest + CHANGELOG read verbatim (F-1) — proves `READ_MEDIA_*` absence + storage-perm presence at 17.0.11.
- Native `ImagePickerModule.kt` read verbatim (F-3/Q5) — proves the Android-version dead-tap band.
- All gate sites read verbatim (F-3) — proves the block-on-denial dead-tap and the absence of a wrapper.

**Deferred (honest cap):** I did **not** run `expo prebuild --platform android` to produce the fully-merged `AndroidManifest.xml` (the worktree `node_modules` is symlinked to the shared anchor; a prebuild write is avoidable at INVESTIGATE and belongs in IMPLEMENT/TEST per the ORCH-1321 precedent, where the implementor ran it). Therefore the merged-manifest `READ_MEDIA_*`-absent + `tools:node="remove"`-on-the-4-set claim is **proven-by-source-chain, artifact-proof PENDING** — the SPEC makes running `expo prebuild` and grepping the merged manifest a mandatory IMPLEMENT verification step (mirroring ORCH-1321 §3/§6).

---

## 7. Gallery-pick site map (blast radius within consumer)

| # | Site (file:line) | Media-lib gate | Blocks on denial? | Dead-tap after strip? | Action for fix |
|---|------------------|----------------|-------------------|-----------------------|----------------|
| 1 | `BetaFeedbackModal.tsx:288` → `launchImageLibraryAsync :295` (multi-select) | `requestMediaLibraryPermissionsAsync()` inline | **YES** (`status!=='granted'`→return) | **YES (≤12)** | route through new wrapper |
| 2 | `MessageInterface.tsx:723` → `launchImageLibraryAsync :739/:746/:755` (chat img/video/file) | `requestMediaLibraryPermissionsAsync()` inline | **YES** (`status!=="granted"`→return) | **YES (≤12)** | route through new wrapper |
| 3 | `cameraService.ts:39` → `pickFromLibrary launchImageLibraryAsync :98` (profile avatar via ProfilePage:320, MobileFeaturesProvider:125) | `requestMediaLibraryPermissionsAsync()` inline | **No** (WARN-only) | No (but spurious request) | route through new wrapper (cleanliness + kills spurious ≤12 request) |
| 4 | `BoardDiscussion.tsx:349` `launchImageLibraryAsync` (library branch) | **none** (ungated) | n/a | No (Photo Picker needs none) | leave as-is (no gate = no dead-tap) |
| — | Camera: `cameraService.ts:32/:58/:138`, `BoardDiscussion.tsx:348` | `requestCameraPermissionsAsync` / `launchCameraAsync` | — | — | **DO NOT TOUCH** (stays on `CAMERA`) |

`grep` confirms the **only** files importing `expo-image-picker` are these 4; there is **no** `expo-media-library` dependency and **no** `ImagePicker` usage under `app-mobile/app/` (expo-router screens). So the complete consumer gallery surface is 4 files / 3 gates.

---

## 8. Invariant impact

- **Establishes (DRAFT):** `I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS` — mirror of `I-PROPOSED-1321-*` scoped to `app-mobile/app.json` (no `READ_MEDIA_*`/`READ_EXTERNAL_STORAGE` in `permissions`; full 4-set in `blockedPermissions`) + the gallery-gate Android short-circuit routing. Flips ACTIVE at CLOSE (orchestrator owns the flip).
- **Preserves:** `I-IOS-CAMERA-PHOTO-PURPOSE-STRINGS-SPECIFIC` (I-1242) and the ORCH-1230 consumer purpose-string invariants — the fix does not touch iOS infoPlist or calendar/camera strings.
- **No conflict** with `I-PROPOSED-1321-*` (business-scoped, different file) — the bare ORCH-1321 gate/invariant namespace is business-only; ORCH-1322 takes its own 1322 gate/invariant per the shipped-first-keeps-the-number rule (COMMS-0086).

## 9. Discoveries for Orchestrator (not fixed here)

- **D-1 — `cameraService.pickFromLibrary` is coupled to CAMERA permission.** `initialize()` (cameraService.ts:34) returns `false` if `requestCameraPermissionsAsync()` is not granted, and `pickFromLibrary` bails on `!initialized` — so choosing a **library** photo (profile avatar) requires **camera** permission today. Pre-existing, out of ORCH-1322 scope (a UX bug, not the media-permission policy). Flag for a future cleanup ORCH.
- **D-2 — Deprecated `MediaTypeOptions` in use.** `BoardDiscussion.tsx:348-349` uses `ImagePicker.MediaTypeOptions.Images` (deprecated in picker 16.0.0). Cosmetic/tech-debt; not in scope.
- **D-3 — app-mobile has no discoverable jest runner** (no jest key/dep, no root jest config), yet `src/**/__tests__/*.test.ts` files exist. The runtime-proof mechanism must be grounded in app-mobile's node `.mjs` `scripts/ci/` convention (OQ-1). Flag for a testing-infra audit.
- **D-4 — `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` may interact with camera on Android < 10.** `ImagePickerModule.kt:283-292` requests `WRITE_EXTERNAL_STORAGE` for the **camera** path on API < Q (Android < 10). Blocking `WRITE_EXTERNAL_STORAGE` (per the business 4-set) could, in theory, affect camera capture on Android 7-9. The business app shipped the identical 4-set block with camera sites and passed; real-world Android < 10 share is negligible. Surfaced as OQ-2 for the tester to accept-with-parity or validate on-device.

## 10. Confidence

- **F-1 (storage-residue / no `READ_MEDIA_*` at 17.0.11):** **proven (source-chain)**; merged-manifest artifact proof deferred to IMPLEMENT.
- **F-2 (live code-16 `READ_MEDIA_*`):** **suspected** (source-only; needs Play API/AAB; non-critical).
- **F-3 (dead-tap risk + band + no wrapper):** **proven** (library source + all gate sites read verbatim).
- **F-4/F-5/F-6 (camera/iOS/multi-select unaffected; version target; CI wiring):** **proven** (source/config).

Overall: the exposure is **REAL but latent** — the fix is the *proven business precedent applied proactively*, whose primary technical value for the fresh build is (a) stripping the library-injected storage perms, (b) permanently locking `READ_MEDIA_*` absent (regression guard), and (c) preventing the Android-≤12 gallery dead-tap the strip introduces.

## 11. Recommended next phase + scope

**Next: SPEC (this pass) → IMPLEMENT → TEST → CLOSE.** Scope = mirror ORCH-1321 for `app-mobile`, nothing wider:
1. `app-mobile/app.json`: add `expo.android.blockedPermissions` = the full 4-set; leave `permissions` clean (no add).
2. Create ONE shared gallery-permission wrapper in `app-mobile/src/` that returns `{granted:true}` on Android and delegates to `ImagePicker.requestMediaLibraryPermissionsAsync()` on iOS; route the 3 gate sites (BetaFeedbackModal, MessageInterface, cameraService) through it. Leave the ungated BoardDiscussion pick and all camera/iOS paths untouched.
3. Keep version 1.1.1; do NOT add a versionCode literal (EAS remote autoIncrement).
4. Regression: strict-grep gate `orch-1322-no-android-media-permissions.mjs` (config, patterned on 1321) + a routing/short-circuit guard grounded in app-mobile's node `.mjs` convention; DRAFT invariant `I-PROPOSED-1322-*`. Merged-manifest `expo prebuild` verification as an IMPLEMENT step.

**Do NOT** touch iOS media handling, camera gates, multi-select options, the ungated BoardDiscussion pick, or the `cameraService`↔CAMERA coupling (D-1).
