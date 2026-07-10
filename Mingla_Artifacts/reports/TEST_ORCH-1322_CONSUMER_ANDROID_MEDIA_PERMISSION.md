# TEST — ORCH-1322 [consumer-android-media-permission-latent]

**Date:** 2026-07-10
**Skill:** mingla-tester (brutal production gatekeeper — independent verification)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1322-[consumer-android-media-perms]/` on branch `ORCH-1322-consumer-android-media-perms`
**Under test:** fix commit `f63c7143b`, report-hash commit `ea2cb7fe3`.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1322_CONSUMER_ANDROID_MEDIA_PERMISSION.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1322_CONSUMER_ANDROID_MEDIA_PERMISSION.md`
**Precedent (binding):** shipped+PASSED ORCH-1321 business fix (`TEST_ORCH-1321_ANDROID_MEDIA_PERMISSION_STRIP.md` — PASS, on-device capped `suspected`, folded into go-live AAB).
**Comms ledger:** read on entry. No BLOCK/OPEN entry targets mingla-tester or ORCH-1322. COMMS-0086 (WARN) confirms ORCH-1322 takes its own 1322 gate/invariant namespace (no collision with the shipped 1321 business gate) — factored in. COMMS-0090 (WARN, ALL) is unrelated (OneLink branded domains).

---

## 1. Verdict

**PASS** — 0 P0 · 0 P1 · 0 P2 · 1 P3 · 2 P4.

The consumer Android media-permission strip is fully proven at the config, artifact, routing, and runtime layers. I independently reproduced the prebuild merged-manifest proof (all 4 blocked perms carry `tools:node="remove"`; zero active `READ_MEDIA_*`/`*_EXTERNAL_STORAGE`; CAMERA/calendar/location/audio preserved), re-ran all three fails-on-revert proofs (config gate, routing gate, runtime test) by true line-deletion, and added my OWN adversarial dead-tap guard attacking a different angle (the underlying OS permission mocked **denied** — the real post-strip Android ≤12 reality — proving the pick still reaches `launchImageLibraryAsync`; fails-on-revert proven). iOS, camera, BoardDiscussion's ungated pick, `version` 1.1.1, and the absent `versionCode` are all untouched. The single unobserved element — the on-device Photo Picker opening with **no permission dialog** on a physical/emulated Android 13+ device — cannot be authentically observed on any current dev build (the `blockedPermissions` manifest strip only exists in a fresh native binary, i.e. the go-live AAB) and is therefore capped **`suspected`**, folding into the go-live Android build exactly as the ORCH-1321 precedent and this dispatch direct. It is structurally guaranteed by the artifact-proven clean manifest + the Android Photo Picker (needs no permission on any supported Android version). Recorded as **P3-1, accepted by dispatch** — not a defect.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Independent evidence |
|----|-----------|---------|----------------------|
| **SC-1** | `app.json` `blockedPermissions` lists all 4 | **PASS** | `app.json:140-145` (verified in worktree): `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`. Config gate real-run PASS. |
| **SC-2** | `permissions` lists none of the media/storage perms (unchanged) | **PASS** | `app.json:128-139` diff is add-only (`blockedPermissions` appended). `permissions` still = location/CAMERA/audio/calendar; no `READ_MEDIA_*`/`READ_EXTERNAL_STORAGE`. |
| **SC-3-Android** | Merged manifest: all 4 blocked carry `tools:node="remove"`, no active media/storage perm | **PASS (artifact-proven — independently reproduced)** | I ran `npx expo prebuild --platform android --no-install`; grep of generated `AndroidManifest.xml` below (§ Prebuild proof): remove-count = **4/4**; active media/storage = **NONE**; `rm -rf android` after. |
| **SC-4** | `requestGalleryPermission()` = `{granted:true,status:'granted'}` on Android WITHOUT calling ImagePicker; iOS delegates | **PASS (runtime — real wrapper executed)** | Implementor runtime test 2/2 (Android not-called / iOS called once) re-run green; my adversarial guard additionally executes the real wrapper and confirms Android short-circuits before the underlying (denied) API. Wrapper source `mediaLibraryPermission.ts:39-47`. |
| **SC-5-Android** | Every consumer gallery pick reaches `launchImageLibraryAsync`, no dead-tap | **PASS (source+routing+runtime)** · on-device `suspected` (folds to go-live, P3-1) | Traced all 3 routed sites: BetaFeedbackModal `:289 status→:295 launchImageLibraryAsync`; MessageInterface `:723 status→:739/:746/:755`; cameraService `:40` (WARN-only, non-blocking). My adversarial dead-tap guard proves the pick reaches the picker even when the OS denies. On-device confirmation folds into go-live AAB (spec SC-5 wording + OQ-2). |
| **SC-6** | No raw `ImagePicker.requestMediaLibraryPermissionsAsync()` outside the wrapper (grep=0) | **PASS** | Routing gate assertion C real-run PASS; repo scan under `app-mobile/src` (excl wrapper + `__tests__`) = 0 raw calls; the only occurrence is `mediaLibraryPermission.ts:47`. |
| **SC-7-iOS** | iOS gallery behaviour unchanged; `NSPhotoLibraryUsageDescription` intact | **PASS** | Wrapper iOS branch (`return ImagePicker.requestMediaLibraryPermissionsAsync()`) returns the real result verbatim; my T10b executes it and confirms iOS still gates on a real denial. `app.json` diff touches no `ios`/`infoPlist`/`NSPhoto*` line. |
| **SC-8** | Camera unchanged; no camera site routed through the media wrapper | **PASS** | `cameraService.ts:33` `requestCameraPermissionsAsync` untouched; `launchCameraAsync` `:59/:139` untouched; `BoardDiscussion.tsx:348` camera path untouched. Only the media-library check (`:40`) was routed. |
| **SC-9** | `version` stays 1.1.1; no `versionCode` literal; `runtimeVersion.policy` stays `appVersion` | **PASS** | `app.json:5` = `"1.1.1"` (unchanged); no `versionCode` key anywhere; `app.json:231-232` `runtimeVersion.policy` = `appVersion`. `eas.json` untouched. |
| **SC-10** | CI regression present + wired + fails-on-revert | **PASS** | Config gate `--self-test` 5/5 + real PASS; routing gate `--self-test` 7/7 + real PASS; runtime test 2/2; two workflow jobs present in `strict-grep-mingla-business.yml:204-229` (triggers on `app-mobile/**`); `test:orch-1322` script present. All three fails-on-revert re-run independently (§ Step 0.5). |
| **SC-11** | No new TS errors in `app-mobile` (baseline-neutral) | **PASS** | `npx tsc --noEmit`: zero error lines mention `mediaLibraryPermission` / `BetaFeedbackModal` / `MessageInterface` / `cameraService`. Wrapper return shape matches `ImagePicker.MediaLibraryPermissionResponse`. |

---

## 3. Prebuild merged-manifest proof (SC-3, independently reproduced)

Ran from `app-mobile/`: `npx expo prebuild --platform android --no-install` (exit 0), then grepped `android/app/src/main/AndroidManifest.xml`. Full `uses-permission` block:

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

- Count of the 4 media/storage perms carrying `tools:node="remove"` = **4/4**.
- Grep for active (non-`remove`) `READ_MEDIA_*` / `*_EXTERNAL_STORAGE` uses-permission = **NONE**.
- Active perms preserved: CAMERA, READ/WRITE_CALENDAR, ACCESS_COARSE/FINE_LOCATION, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, INTERNET, VIBRATE, AD_ID.
- `rm -rf android` after; `git status` clean (prebuild did NOT dirty `app.json`/`package.json`). **SC-3 PASS.** Matches the implementor's reported block byte-for-byte.

---

## 4. Findings

### P3-1 — On-device Android 13+ "no permission prompt" not observed (accepted by dispatch, `suspected`)
- **Evidence:** No Android device attached (`adb devices` empty). AVDs exist (`META_ORCH_0972_Pixel_7_API35`, `Pixel_8_Pro`) but the `blockedPermissions` manifest strip is a **native build-config** change — it materializes only in a fresh native binary. No pre-built AAB/dev-client carrying the new manifest exists; a current dev build would not reflect the strip and thus could not authentically demonstrate the shipped artifact's behavior.
- **Impact:** The single live claim "Photo Picker opens with NO permission dialog on Android 13+" is source+artifact-proven but not device-observed.
- **Why non-blocking:** structurally guaranteed by (a) the artifact-proven clean manifest (no active `READ_MEDIA_*`) and (b) `launchImageLibraryAsync` using the Android Photo Picker (expo-image-picker v16+), which needs no runtime permission on any supported Android version. The dead-tap risk (Android ≤12) is the actual behavioral concern and is runtime-proven by my adversarial guard.
- **Required action (go-live):** on the go-live AAB, install on an Android 13+ device, open a gallery pick (chat image attach or profile avatar); confirm NO permission dialog appears and the system Photo Picker opens and completes. Mirrors ORCH-1321 P3-1.
- **Retest:** fold into Seth's go-live AAB smoke test.

### P4-1 — `WRITE_EXTERNAL_STORAGE` block vs Android <10 camera capture (accept-with-parity)
- **Evidence:** OQ-2. `expo-image-picker`'s `ImagePickerModule` requests `WRITE_EXTERNAL_STORAGE` for the camera path on API <29. The 4-set block includes it. cameraService's `launchCameraAsync` captures to an app-scoped temp URI (does not write to the shared MediaStore by default), so the capture-to-app flow does not depend on `WRITE_EXTERNAL_STORAGE`.
- **Impact:** none expected; real-world Android <10 share is negligible.
- **Why non-blocking:** business (ORCH-1321) shipped the identical 4-set block WITH camera sites and passed both tester and Google review. Spec OQ-2 explicitly chose the 4-set for business parity + invariant symmetry and forbids dropping `WRITE_EXTERNAL_STORAGE` without a Seth decision. Accept-with-parity.

### P4-2 — Clean, faithful mirror of the proven precedent (praise)
- The wrapper, the two gates, the runtime test, and the invariant are a disciplined mirror of the shipped ORCH-1321 pattern. The routing gate's ordering assertion (Android `granted:true` must precede the ImagePicker call) is a precise runtime-equivalent for the dead-tap seam. Good work worth replicating.

---

## 5. Step 0.5 — Independent re-run of the implementor's fails-on-revert proofs

Performed by TRUE line-deletion in the worktree, then `git checkout --` restore. Wrapper unchanged since fix `f63c7143b` (HEAD `ea2cb7fe3`).

| Guard | Revert applied | Result (exit) | Exact failing assertion | Restore |
|-------|----------------|---------------|-------------------------|---------|
| Config gate (`orch-1322-no-android-media-permissions.mjs`) | deleted `READ_MEDIA_VIDEO` from `app.json` `blockedPermissions` | **FAIL exit 1** | "expo.android.blockedPermissions must list android.permission.READ_MEDIA_VIDEO so it is force-stripped…" | re-checkout → **PASS exit 0** |
| Routing gate (`orch-1322-gallery-permission-wrapper-routed.mjs`) | deleted the wrapper's `if (Platform.OS === 'android') { return {granted:true…} }` block | **FAIL exit 1** | "wrapper: missing the `Platform.OS === 'android'` short-circuit branch." | re-checkout → **PASS exit 0** |
| Runtime test (`orch1322MediaLibraryPermission.test.mjs`) | (same short-circuit deletion) | **FAIL exit 1** | "T1 (android short-circuit): ImagePicker.requestMediaLibraryPermissionsAsync MUST NOT be called on Android" | re-checkout → **PASS exit 0** |

Baseline (fix present) confirmed PASS before each revert. All three independently reproduce the implementor's claim. Verified against wrapper/app.json state at HEAD `ea2cb7fe3` (== fix `f63c7143b`, unchanged).

---

## 6. Adversarial test added (tester — different angle)

- **Files (append-only, NEW):**
  - `app-mobile/src/utils/__tests__/orch1322DeadTapGuard.test.mjs` — the guard (spec T10).
  - `app-mobile/src/utils/__tests__/orch1322-deadtap-loader.mjs` — its own module loader stubbing `react-native` + `expo-image-picker`, where the underlying permission resolves **`{granted:false, status:'denied'}`** (does NOT reuse the implementor's granted:true loader).
- **Angle (distinct from the implementor's happy-path test):** the implementor's runtime test mocks the underlying API as `granted:true`, so it can only prove "ImagePicker not called" — it can NEVER surface a dead-tap. My guard mocks the underlying OS permission as **denied** (the real post-strip Android ≤12 reality once storage perms are blocked) and drives the EXACT gate-site predicate the 3 sites use (`if (status !== 'granted') return; // dead-tap`), then asserts the flow **still reaches `launchImageLibraryAsync`** on Android because the wrapper short-circuits BEFORE the denying OS call — the precise dead-tap that stripping the permissions alone (without the wrapper) would cause. T10b (iOS contrast) proves iOS still honors a real denial (dead-taps), confirming the no-dead-tap guarantee is specifically the Android short-circuit, not a blanket bypass.
- **Result on fix:** **PASS** (T10a Android reaches picker despite OS denial — no dead-tap; T10b iOS dead-taps on real denial).
- **Fails-on-revert:** deleting the wrapper's Android short-circuit → on Android the wrapper falls through to the denied OS mock → `status='denied'` → gate early-returns → picker never reached. Test **FAILS exit 1** ("T10a … the denying OS permission API MUST NOT be called on Android"; the `reachedPicker===true` assertion also flips). Restored wrapper → **PASS**.
- **fails-on-revert verified at commit `f63c7143b`** (wrapper state; unchanged through HEAD `ea2cb7fe3`); test committed on branch `ORCH-1322-consumer-android-media-perms`.
- **In closing diff:** both the implementor's happy-path test (`orch1322MediaLibraryPermission.test.mjs`) AND my adversarial test appear in `git diff origin/main...HEAD --name-only`. Regression gate satisfied.

---

## 7. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | **PASS** | The whole point: the wrapper short-circuit prevents the post-strip Android ≤12 dead-tap; my adversarial guard proves the pick reaches `launchImageLibraryAsync` under OS denial. |
| 2 | One owner per truth | **PASS** | ONE shared wrapper `mediaLibraryPermission.ts` is the single owner of gallery-permission resolution; all 3 sites route through it. |
| 3 | No silent failures | **PASS** | No catch swallowing; gate sites keep their existing user-facing denial messaging (BetaFeedbackModal `setPermissionMessage`, MessageInterface `Alert.alert`); cameraService media check stays WARN-only by design (unchanged). |
| 4 | One query key per entity | **N/A** | No React Query change. |
| 5 | Server state stays server-side | **N/A** | No Zustand/server-state change. |
| 6 | Logout clears everything | **N/A** | No auth/session change. |
| 7 | Label `[TRANSITIONAL]` + exit | **N/A** | No transitional code introduced. |
| 8 | Subtract before adding | **PASS** | Strips permissions (subtract) via `blockedPermissions`; adds only the minimal wrapper needed to avoid the dead-tap. |
| 9 | No fabricated data | **N/A** | No data surfaces. |
| 10 | Currency-aware | **N/A** | No pricing. |
| 11 | One auth instance | **N/A** | No auth. |
| 12 | Validate at the right time | **PASS** | Permission resolved at pick time, per platform; iOS still gates at the real moment. |
| 13 | Exclusion consistency | **PASS** | The Android short-circuit is applied uniformly at the single wrapper; no per-site divergence. |
| 14 | Persisted-state startup gate | **N/A** | No persisted state. |

No violations. No automatic-P0 trigger fired.

---

## 8. Device / parity matrix

| Surface | Ships here? | Verdict | Evidence |
|---------|-------------|---------|----------|
| Consumer iOS (`app-mobile`) | Yes (else-branch) | **PASS** | Wrapper iOS branch delegates to the real API verbatim; T10b executes it; no iOS string/behavior change. |
| **Consumer Android (`app-mobile`)** | **Yes (target)** | **PASS (config+artifact+routing+runtime)** · on-device `suspected` → go-live (P3-1) | Prebuild manifest proof; routing gate; runtime test; adversarial dead-tap guard. |
| Buyer/anonymous Web | No | **N/A (skip)** | No media pick on buyer web; short-circuit is Android-only. |
| Business iOS | No | **N/A (skip)** | Different app (`mingla-business/`); handled by shipped ORCH-1321. |
| Business Android | No | **N/A (skip)** | Fixed by shipped ORCH-1321; separate file/gate/invariant (COMMS-0086). |
| Admin Web (adjacent) | No | **N/A (skip)** | No picker. |
| Business Web preview (adjacent) | No | **N/A (skip)** | No touch. |

Physical-iPhone HITL: not required — iOS path is unchanged (the else-branch delegates to the real API); no iOS-observable change to drive. Edge-fn live-deploy: N/A (no backend touch).

---

## 9. Discoveries for Orchestrator (not fixed here)

- **D-1 (re-confirmed):** `cameraService.pickFromLibrary` is coupled to CAMERA permission via `initialize()` (a pre-existing UX quirk — a library pick shouldn't need CAMERA). Out of ORCH-1322 scope; a separate ORCH if Seth wants it cleaned.
- **D-2:** `BoardDiscussion.tsx:348-349` uses deprecated `ImagePicker.MediaTypeOptions.Images`. Pre-existing; not this ORCH.
- **D-3:** `app-mobile` has no jest runner; this ORCH (and my adversarial test) use `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON` + a `module.register` loader executing the real `.ts` source. Works, but a testing-infra ORCH could standardize a runner.
- **D-4 (optional CI wiring):** my adversarial guard (`orch1322DeadTapGuard.test.mjs`) is committed and in-diff but NOT wired into `package.json`/a workflow job (dispatch = "commit ONLY your new adversarial test + the report"). The orchestrator may, at CLOSE, append it to the `test:orch-1322` chain if standing CI coverage of the dead-tap seam is wanted. The required guards (config + routing + runtime) already run in CI.

---

## 10. Accepted conditions

- **P3-1 (on-device Android 13+ "no prompt" not observed):** accepted by this dispatch — the dispatch explicitly authorizes capping the on-device claim `suspected` and folding it into the go-live AAB verification per the ORCH-1321 precedent ("do NOT fabricate a device pass"). Mirrors ORCH-1321 P3-1 (that ORCH shipped + passed Google review). Not a defect; a go-live verification step.

**Verdict: PASS (0 P0 · 0 P1 · 0 P2 · 1 P3 accepted-by-dispatch · 2 P4). Routes to orchestrator CLOSE.**
