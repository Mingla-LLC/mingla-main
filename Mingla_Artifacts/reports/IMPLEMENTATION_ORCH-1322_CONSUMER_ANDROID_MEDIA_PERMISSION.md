# IMPLEMENTATION — ORCH-1322 [consumer-android-media-permission-latent]

**Date:** 2026-07-10
**Skill:** mingla-implementor
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1322-[consumer-android-media-perms]/` on branch `ORCH-1322-consumer-android-media-perms` (rebased on `origin/main` = `db38fd730`).
**Spec (contract):** `Mingla_Artifacts/specs/SPEC_ORCH-1322_CONSUMER_ANDROID_MEDIA_PERMISSION.md`
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1322_CONSUMER_ANDROID_MEDIA_PERMISSION.md`
**Precedent mirrored:** shipped ORCH-1321 business fix.
**Status:** implemented and verified (config + routing + runtime-equivalent proofs all green; merged-manifest artifact-proven). Ships in the next `app-mobile` **Android native build** (EAS AAB) — **NO OTA**. iOS untouched.
**Comms ack:** COMMS-0086 (WARN, OPEN, `to` includes 1322) — the ORCH-1321 fix pattern this ORCH applies to consumer; factored in. COMMS-0087 (TS-pin) already RESOLVED on origin/main (picked up by the rebase).

---

## 1. Summary (plain English)

The consumer app (`app-mobile`) is about to cut a new Android build. Google Play's Photo & Video Permissions policy forbids an app that only *picks* occasional media from holding media/storage permissions. This applies the proven ORCH-1321 business fix to consumer: (1) block the four media/storage permissions in `app.json` so none survive in the built app, and (2) route every gallery "pick a photo/video" gate through one shared helper that skips the permission request on Android (the Android Photo Picker needs none) so the pick never dead-taps, while iOS keeps asking for photo-library permission exactly as before. Camera, iOS, and the ungated board pick are untouched; the app version stays 1.1.1.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | `app.json` `blockedPermissions` lists all 4 | ✓ PASS | app.json:140-145 (READ_MEDIA_IMAGES/VIDEO + READ/WRITE_EXTERNAL_STORAGE) |
| SC-2 | `app.json` `permissions` lists none of the media/storage perms (unchanged) | ✓ PASS | app.json:128-139 diff is add-only; CAMERA/location/calendar/audio set preserved |
| SC-3-Android | Merged manifest: all 4 blocked carry `tools:node="remove"`, no active media/storage perm | ✓ PASS | prebuild grep proof below (§ Prebuild manifest proof) |
| SC-4 | `requestGalleryPermission()` = `{granted:true,status:'granted'}` on Android WITHOUT calling ImagePicker; iOS delegates | ✓ PASS | runtime test 2/2 (T1 Android not-called; T2 iOS called-once) |
| SC-5-Android | Every consumer gallery pick reaches `launchImageLibraryAsync`, no dead-tap | ✓ PASS (source+routing) | 3 sites routed; downstream `launchImageLibraryAsync` byte-unchanged; on-device pick folds into go-live AAB (tester) |
| SC-6 | No raw `ImagePicker.requestMediaLibraryPermissionsAsync()` outside the wrapper (grep=0) | ✓ PASS | routing gate C + grep: only the wrapper (line 47) holds the real call |
| SC-7-iOS | iOS gallery behaviour unchanged; `NSPhotoLibraryUsageDescription` intact | ✓ PASS | app.json:22 untouched; wrapper iOS branch delegates verbatim |
| SC-8 | Camera unchanged; no camera site routed through the media wrapper | ✓ PASS | `requestCameraPermissionsAsync`/`launchCameraAsync` untouched (cameraService:32/58/138, BoardDiscussion) |
| SC-9 | `version` stays 1.1.1; no `versionCode` literal; `runtimeVersion.policy` stays `appVersion` | ✓ PASS | app.json:5 unchanged; app.json diff is blockedPermissions-only |
| SC-10 | CI regression present + wired + fails-on-revert | ✓ PASS | 2 gates (5/5 + 7/7 self-test) + runtime test + 2 workflow jobs + `test:orch-1322` script + fails-on-revert (§ Fails-on-revert) |
| SC-11 | No new TS errors in `app-mobile` (baseline-neutral) | ✓ PASS | `tsc --noEmit`: zero errors mention any touched file (pre-existing 876-error baseline unrelated) |

---

## 3. Files changed

| File | Type | Δ | What |
|------|------|---|------|
| `app-mobile/app.json` | mod | +6 | add `expo.android.blockedPermissions` (4-set), peer of `permissions` |
| `app-mobile/src/utils/mediaLibraryPermission.ts` | **new** | +49 | shared wrapper `requestGalleryPermission()` — Android short-circuit `{granted:true}`, iOS delegates |
| `app-mobile/src/components/BetaFeedbackModal.tsx` | mod | +1/-1 | import wrapper; route `:289` gate through it (block-on-denial site) |
| `app-mobile/src/components/MessageInterface.tsx` | mod | +1/-2 | import wrapper; route `:723` gate (block-on-denial chat attach) |
| `app-mobile/src/services/cameraService.ts` | mod | +1/-1 | import wrapper; route `:40` media check (WARN-only, behaviour preserved) |
| `.github/scripts/strict-grep/orch-1322-no-android-media-permissions.mjs` | **new** | +192 | config gate (A: no perm; B: blocked 4-set) + `--self-test` 5/5 |
| `.github/scripts/strict-grep/orch-1322-gallery-permission-wrapper-routed.mjs` | **new** | +289 | routing gate (short-circuit order + 3 sites routed + no raw call) + `--self-test` 7/7 |
| `.github/workflows/strict-grep-mingla-business.yml` | mod | +26 | 2 sibling jobs + 2 registry-header lines |
| `app-mobile/package.json` | mod | +1 | `test:orch-1322` script (chains both gates' self-test+real + runtime test) |
| `app-mobile/src/utils/__tests__/orch1322MediaLibraryPermission.test.mjs` | **new** | +99 | happy-path RUNTIME test (executes the real wrapper; Android not-called / iOS called) |
| `app-mobile/src/utils/__tests__/orch1322-wrapper-runtime-loader.mjs` | **new** | +42 | module loader stubbing `react-native`/`expo-image-picker` for the runtime test |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | mod | +11 | DRAFT `I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS` |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1322_*.md` | **new** | this file |
| `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1322_*.md` | **new** | investigation (carried in from spawn) |
| `Mingla_Artifacts/specs/SPEC_ORCH-1322_*.md` | **new** | spec (carried in from spawn) |

**Nothing else staged.** No `android/` prebuild output (gitignored + `rm -rf`'d). No `version`/`versionCode`/`eas.json` change.

---

## 4. Prebuild manifest proof (SC-3, T4)

`cd app-mobile && npx expo prebuild --platform android --no-install` → grep the generated `android/app/src/main/AndroidManifest.xml`, then `rm -rf android`. **app.json/package.json were NOT dirtied by prebuild** (verified: `git diff app.json` shows only the blockedPermissions addition; package.json "no changes").

Full `uses-permission` block from the merged manifest:

```
android.permission.ACCESS_COARSE_LOCATION
android.permission.ACCESS_FINE_LOCATION
android.permission.CAMERA
android.permission.INTERNET
android.permission.MODIFY_AUDIO_SETTINGS
android.permission.READ_CALENDAR
android.permission.READ_EXTERNAL_STORAGE   tools:node="remove"
android.permission.READ_MEDIA_IMAGES       tools:node="remove"
android.permission.READ_MEDIA_VIDEO        tools:node="remove"
android.permission.RECORD_AUDIO
android.permission.VIBRATE
android.permission.WRITE_CALENDAR
android.permission.WRITE_EXTERNAL_STORAGE  tools:node="remove"
com.google.android.gms.permission.AD_ID
```

- **All 4 blocked perms carry `tools:node="remove"`** (count of remove-lines among the 4 = **4/4**).
- **Zero active (non-remove) `READ_MEDIA_*` / `*_EXTERNAL_STORAGE`** survive (the "active media/storage" grep matched nothing).
- Active perms preserved: CAMERA, calendar, location, audio, internet, vibrate, AD_ID. **SC-3 PASS.**

---

## 5. Old → New receipts

### app-mobile/app.json
- **Before:** `expo.android` had `permissions` (location/CAMERA/audio/calendar) and **no** `blockedPermissions`; the `expo-image-picker@17.0.11` library manifest merged `READ_EXTERNAL_STORAGE` + `WRITE_EXTERNAL_STORAGE` into every fresh AAB.
- **Now:** adds `blockedPermissions` = the full media/storage 4-set → `tools:node="remove"` strips the library residue and permanently locks `READ_MEDIA_*` absent.
- **Why:** SC-1/SC-2/SC-3; Google Play Photo & Video Permissions policy.
- **Lines:** +6.

### app-mobile/src/utils/mediaLibraryPermission.ts (new)
- **Before:** did not exist; 3 gate sites called `ImagePicker.requestMediaLibraryPermissionsAsync()` inline.
- **Now:** `requestGalleryPermission()` returns `{granted:true, status:GRANTED}` on Android **before** any ImagePicker call; on iOS returns `ImagePicker.requestMediaLibraryPermissionsAsync()` verbatim. Typed `Promise<ImagePicker.MediaLibraryPermissionResponse>`.
- **Why:** SC-4/SC-5/SC-6; without the Android short-circuit, the app.json strip would dead-tap the two block-on-denial gates on Android ≤12.
- **Lines:** +49.

### BetaFeedbackModal.tsx / MessageInterface.tsx / cameraService.ts
- **Before:** each `const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();`.
- **Now:** each `... = await requestGalleryPermission();` + a wrapper import. Every surrounding `status !== 'granted'` check and downstream `launchImageLibraryAsync` call is byte-identical. cameraService's media check stays WARN-only/non-blocking; its CAMERA gate (`:32-36`) and coupling are untouched.
- **Why:** SC-5/SC-6/SC-8.
- **Lines:** +1/-1, +1/-2, +1/-1.

---

## 6. Regression tests added (SC-10)

**Two CI gates (append-only, both self-tested + real-run green, both wired as workflow jobs):**

| Gate file | Job name | Self-test | Real run |
|-----------|----------|-----------|----------|
| `.github/scripts/strict-grep/orch-1322-no-android-media-permissions.mjs` (config) | `orch-1322-no-android-media-permissions` | **5/5 PASS** | PASS |
| `.github/scripts/strict-grep/orch-1322-gallery-permission-wrapper-routed.mjs` (routing) | `orch-1322-gallery-permission-wrapper-routed` | **7/7 PASS** | PASS |

Both jobs added to `.github/workflows/strict-grep-mingla-business.yml` (triggers on `app-mobile/**` + `.github/scripts/strict-grep/**`), mirroring the orch-1321 job block (self-test step + live step). Workflow YAML validated (328 jobs, both 1322 jobs present). Registry-header comment lines added for both.

**Happy-path RUNTIME test (append-only):** `app-mobile/src/utils/__tests__/orch1322MediaLibraryPermission.test.mjs` (+ loader `orch1322-wrapper-runtime-loader.mjs`) — **executes the real wrapper** with `react-native`/`expo-image-picker` stubbed via `module.register`. **2/2 PASS**: T1 Android returns granted with the ImagePicker mock NOT called; T2 iOS calls it once. Runs under plain node (no jest). Chained by `npm run test:orch-1322`.

### Fails-on-revert (proven by true LINE DELETION, then restore)

| Guard | Reverted the fix by | Result | Restored |
|-------|--------------------|--------|----------|
| Config gate A | deleting `READ_MEDIA_VIDEO` from `app.json` `blockedPermissions` | **FAIL exit 1** ("must list …READ_MEDIA_VIDEO") | re-added → PASS |
| Routing gate B | deleting the wrapper's `if (Platform.OS==='android'){…}` short-circuit | **FAIL exit 1** ("missing the `Platform.OS === 'android'` short-circuit") | re-added → PASS |
| Runtime test | (same short-circuit deletion) | **FAIL exit 1** (T1: "ImagePicker … MUST NOT be called on Android"; `1 !== 0`) | re-added → PASS |

Both gate `--self-test`s additionally prove fails-on-revert programmatically (un-routing a site, re-adding a raw call, dropping a blocked entry, deleting `blockedPermissions`).

**fails-on-revert verified at commit `__COMMIT_HASH__`** (branch `ORCH-1322-consumer-android-media-perms`).

---

## 7. Cross-surface impact

| # | Surface | Affected | Parity |
|---|---------|----------|--------|
| 1 | Consumer iOS | No (else-branch of the shared wrapper delegates to the real API) | manual (one wrapper, iOS branch) |
| 2 | **Consumer Android** | **YES (target)** — Photo Picker opens with no prompt; AAB declares no media/storage perm; no dead-tap | — |
| 3 | Buyer/anonymous Web | No — no media pick; short-circuit Android-only | n/a |
| 4 | Business iOS | No — different app (`mingla-business/`) | n/a |
| 5 | Business Android | No — fixed by shipped ORCH-1321 | n/a |
| 6 | Admin Web (adjacent) | No | n/a |
| 7 | Business Web preview (adjacent) | No | n/a |

Parity is manual across exactly one path (the single shared wrapper); no >1-surface manual parity concern.

---

## 8. OQ resolutions

- **OQ-1 (app-mobile jest runner):** **RESOLVED — app-mobile has no jest** (no jest key/dep). The **required** runtime-equivalent guard is the node `.mjs` routing gate B (definitely runs in CI as job `orch-1322-gallery-permission-wrapper-routed` and via `npm run test:orch-1322`). Additionally, a genuine **runtime** proof runs without jest: `orch1322MediaLibraryPermission.test.mjs` executes the real wrapper source (node type-stripping, Node 22) with `react-native`/`expo-image-picker` stubbed by a `module.register` loader, asserting the Android not-called / iOS called contract. No bonus jest test added (would be un-runnable in this package). Both mechanisms execute in CI.
- **OQ-2 (WRITE_EXTERNAL_STORAGE):** **kept blocked** for business parity + invariant symmetry (the 4-set matches the shipped ORCH-1321 block). Not dropped. The theoretical Android <10 camera-capture `WRITE_EXTERNAL_STORAGE` interaction is left for the tester to accept-with-parity / spot-check (Investigation D-4); real-world Android <10 share is negligible and business shipped the identical block with camera sites and passed.
- **OQ-3 (live code-16 declared perms):** not re-pulled this pass (non-blocking; the fresh 1.1.1 build supersedes code 16 regardless).

---

## 9. Gates run (self-verify)

- `npm run test:orch-1322` → all green: config 5/5 + PASS, routing 7/7 + PASS, runtime 2/2.
- `npx expo prebuild --platform android --no-install` + manifest grep → SC-3 PASS; `rm -rf android`.
- `npx tsc --noEmit` (app-mobile) → **0 errors** in any touched file (pre-existing 876-error repo baseline is unrelated and unchanged).
- Workflow YAML parse OK (ruby/psych): 328 jobs, both 1322 jobs registered.
- `git status` → only the scoped files; no `android/`, no `version`/`eas.json` change.

## 10. Invariants

- **Establishes (DRAFT):** `I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS` (registered DRAFT in `INVARIANT_REGISTRY.md`; flips ACTIVE at CLOSE — orchestrator owns the flip).
- **Preserves:** `I-IOS-CAMERA-PHOTO-PURPOSE-STRINGS-SPECIFIC` (I-1242) + ORCH-1230 consumer purpose strings — no iOS infoPlist/calendar/camera string touched. `I-PROPOSED-1321-*` (business, different file) — untouched; no namespace conflict (COMMS-0086).

## 11. Known issues / deferred

- On-device Android Photo-Picker "opens with no prompt" confirmation folds into Seth's go-live AAB (tester attempts an emulator/device check, else caps `suspected` — ORCH-1321 precedent). SC-5 is source+routing+runtime-proven here.
- No `[TRANSITIONAL]` code introduced.

## 12. Operator action required

- **None for the implementor phase.** No migration, no edge function, no deploy. Route to **mingla-tester** (verify SC-1…SC-11, add the T10 adversarial dead-tap guard, attempt on-device Photo-Picker confirmation), then **orchestrator CLOSE**.
- **GO-LIVE (later, native-build-bound — NO OTA):** fresh EAS Android AAB (remote `autoIncrement` versionCode > 16) → `eas submit` internal → Google review.

## 13. Discoveries for Orchestrator

- Re-confirms Investigation D-1 (`cameraService.pickFromLibrary` coupled to CAMERA permission via `initialize()`), D-2 (deprecated `MediaTypeOptions` in BoardDiscussion), D-3 (app-mobile has no jest runner — this ORCH used a node `module.register` runtime test as the no-jest runtime proof; a testing-infra audit could standardize it), D-4 (Android <10 camera `WRITE_EXTERNAL_STORAGE` — OQ-2). All out of ORCH-1322 scope; none blocking.
