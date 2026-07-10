# SPEC — ORCH-1322 [consumer-android-media-permission-latent]

**Date:** 2026-07-10
**Contract for:** mingla-implementor (then mingla-tester, then orchestrator CLOSE).
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1322_CONSUMER_ANDROID_MEDIA_PERMISSION.md` (read it first — findings F-1…F-6, site map §7).
**Precedent (binding template):** ORCH-1321 [android-media-permission-strip] — `reports/IMPLEMENTATION_ORCH-1321_ANDROID_MEDIA_PERMISSION_STRIP.md`, gate `.github/scripts/strict-grep/orch-1321-no-android-media-permissions.mjs`, `I-PROPOSED-1321-NO-ANDROID-MEDIA-PERMISSIONS`.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1322-[consumer-android-media-perms]/` on branch `ORCH-1322-consumer-android-media-perms` (rebased on `origin/main` = `dde139516`).
**Ships via:** next `app-mobile` **Android native build** (EAS AAB). **NO OTA** (a native manifest change cannot ship via `eas update`).

---

## 1. Executive summary

Apply the proven ORCH-1321 business fix to the **consumer** app so it never trips Google Play's **Photo and Video Permissions** policy. Three parts: (1) add `expo.android.blockedPermissions` to `app-mobile/app.json` for the full set `READ_MEDIA_IMAGES` + `READ_MEDIA_VIDEO` + `READ_EXTERNAL_STORAGE` + `WRITE_EXTERNAL_STORAGE` (force-strips the `expo-image-picker@17.0.11` library-injected `READ/WRITE_EXTERNAL_STORAGE` from the merged manifest via `tools:node="remove"`, and permanently locks `READ_MEDIA_*` absent); (2) create ONE shared gallery-permission wrapper that returns `{granted:true}` on Android (the Android Photo Picker needs no permission) and delegates to `ImagePicker.requestMediaLibraryPermissionsAsync()` on iOS, and route the **three** inline gallery gate sites through it so stripping the storage perms does not DEAD-TAP the pick on Android ≤12; (3) keep `version` 1.1.1 and let EAS remote `autoIncrement` assign the next Android `versionCode` (> 16) so the fresh build supersedes the live code-16 build on Play. Guard it with a strict-grep config gate + a routing gate (fails-on-revert) + DRAFT invariant `I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS`.

**Consumer differs from business (do not blindly copy):** consumer `app.json` never declared `READ_MEDIA_*` (business did), and consumer has **no** permission-wrapper abstraction (business had two) — the three gate sites call `ImagePicker` inline. So this SPEC **creates** the wrapper and routes the three sites, rather than editing existing wrappers.

---

## 2. Scope & non-goals

**In scope (and ONLY this):**
- `app-mobile/app.json` — add `expo.android.blockedPermissions` (full 4-set). Do NOT add anything to `expo.android.permissions`.
- New file `app-mobile/src/utils/mediaLibraryPermission.ts` — the shared gallery-permission wrapper with the Android short-circuit.
- Route the 3 gate sites (`BetaFeedbackModal.tsx`, `MessageInterface.tsx`, `cameraService.ts`) through the wrapper.
- Regression: strict-grep config gate + routing gate + npm script + workflow job + DRAFT invariant.

**Non-goals (explicitly OUT):**
- iOS media handling — untouched. `NSPhotoLibraryUsageDescription` (app.json:22) and all iOS strings stay. (The short-circuit is Android-only; iOS still requests the real permission.)
- Camera — untouched. `requestCameraPermissionsAsync` / `launchCameraAsync` stay on `CAMERA` (cameraService:32/:58/:138, BoardDiscussion:348).
- The **ungated** BoardDiscussion library pick (`BoardDiscussion.tsx:349`) — no gate = no dead-tap; leave as-is.
- Multi-select behaviour (`allowsMultipleSelection`) — a launch-time option, do not change.
- The `cameraService.pickFromLibrary`↔CAMERA coupling (Investigation D-1) — pre-existing UX bug, NOT this ORCH.
- No version-name bump beyond 1.1.1; no `android.versionCode` literal added.
- No `expo-image-picker` upgrade/downgrade; no config-plugin addition.

**Assumptions:** app-mobile stays on `expo-image-picker ~17.0.11` (verified installed). Expo SDK 54 → minSdk 24 (Android 7+), so the Android-≤12 dead-tap band is in range.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior | Files touched here | Parity |
|---|---------|----------|-----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile` iOS) | **No (unaffected)** | Gallery pick still requests the real photo-library permission (gated on `NSPhotoLibraryUsageDescription`). Behaviour identical to today. | none (short-circuit is Android-guarded) | manual — iOS path is the `else` branch of the shared wrapper |
| 2 | **Consumer Android (`app-mobile` Android)** | **YES (the target)** | Gallery pick opens the Android Photo Picker with **no permission prompt**; the AAB declares no `READ_MEDIA_*`/`READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE`; no gallery dead-tap on any supported Android version. | `app.json`, `mediaLibraryPermission.ts`, 3 gate sites | — |
| 3 | Buyer/anonymous Web | **No** | n/a — no media pick on buyer web; `app-mobile` web variant unaffected (short-circuit Android-only). | none | n/a |
| 4 | Business iOS | **No** | n/a — different app (`mingla-business/`); fixed separately by ORCH-1321. | none | n/a |
| 5 | Business Android | **No** | n/a — fixed by ORCH-1321 (shipped). | none | n/a |
| 6 | Admin Web | **No** | n/a — no picker. | none | n/a |
| 7 | Business Web preview | **No** | n/a. | none | n/a |

---

## 4. Layered specification

Only two layers are touched: **build-config (app.json)** and **client code (wrapper + 3 sites)**. No DB / edge / hook / realtime changes.

### 4.A — Build-config: `app-mobile/app.json`

Add a sibling key `blockedPermissions` inside `expo.android` (peer of the existing `permissions` array, lines 128-139). Leave `permissions` **exactly as-is** (do NOT add or remove any entry). Exact value:

```jsonc
"blockedPermissions": [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE"
]
```

- `blockedPermissions` emits `tools:node="remove"` on each entry in the merged manifest → the merger strips them from the final AAB manifest (proven mechanism in ORCH-1321 §3/§6).
- Do NOT touch `version` (stays `"1.1.1"`, app.json:5), `runtimeVersion` (stays `appVersion`, :225-227), `ios.infoPlist`, `plugins`, or `intentFilters`.
- Do NOT add an `android.versionCode` — `eas.json` `appVersionSource:"remote"` + production `autoIncrement:true` assigns the next code (> 16) remotely at build; a literal would conflict.

### 4.B — Client code: new shared wrapper

**New file:** `app-mobile/src/utils/mediaLibraryPermission.ts`

Contract (illustrative ≤3 lines — implementor writes the real, typed module):
```ts
// Android Photo Picker (expo-image-picker ≥16) needs NO permission → short-circuit granted.
// iOS still gates on NSPhotoLibraryUsageDescription → delegate to the real API.
if (Platform.OS === "android") return { granted: true, canAskAgain: true, status: "granted" };
return ImagePicker.requestMediaLibraryPermissionsAsync();
```

Requirements:
- Export a single async fn, name `requestGalleryPermission()` (return type: `Promise<ImagePicker.MediaLibraryPermissionResponse>` or a `{ granted: boolean }`-compatible shape the 3 call sites already destructure — see per-site notes; the sites read `.status` and/or `.granted`, so the Android branch MUST return **both** `granted:true` **and** `status:"granted"`).
- The Android `return` MUST occur **before** any call to `ImagePicker.requestMediaLibraryPermissionsAsync()` (so the underlying API is not invoked on Android — this is the fails-on-revert seam).
- `import { Platform } from "react-native"` and `import * as ImagePicker from "expo-image-picker"` at top.
- No side effects, no analytics, no navigation. Pure permission resolution.
- iOS branch: return the real `ImagePicker.requestMediaLibraryPermissionsAsync()` result verbatim (do NOT alter iOS behaviour).

### 4.C — Client code: route the 3 gate sites through the wrapper

Each site currently calls `ImagePicker.requestMediaLibraryPermissionsAsync()` inline. Replace **only that call** with `requestGalleryPermission()` from the new wrapper; keep the existing `status`/`granted` checks and downstream `launchImageLibraryAsync` calls **byte-identical** otherwise.

| Site | Exact change |
|------|--------------|
| `BetaFeedbackModal.tsx:288` | `const { status } = await requestGalleryPermission();` (was `await ImagePicker.requestMediaLibraryPermissionsAsync()`). Add `import { requestGalleryPermission } from "../utils/mediaLibraryPermission";`. Keep the `if (status !== 'granted') { setPermissionMessage(...); return; }` block + `launchImageLibraryAsync` (:295, multi-select) unchanged. |
| `MessageInterface.tsx:723` | `const { status } = await requestGalleryPermission();` (was the inline call at :722-723). Add the import (`../utils/mediaLibraryPermission`). Keep the `if (status !== "granted") { Alert.alert(...); return; }` + all three `launchImageLibraryAsync` (:739/:746/:755) unchanged. |
| `cameraService.ts:39` | `const { status: mediaStatus } = await requestGalleryPermission();` (was the inline call). Add `import { requestGalleryPermission } from "../utils/mediaLibraryPermission";`. Keep the WARN-only `if (mediaStatus !== 'granted') console.warn(...)` non-blocking behaviour unchanged. (`Platform` is already imported here — fine.) Do NOT alter `initialize()`'s CAMERA gate (:32-36) or the CAMERA coupling. |

After the change, `grep -rn "ImagePicker.requestMediaLibraryPermissionsAsync" app-mobile/src` (excluding `__tests__` and the wrapper file) MUST return **zero** hits — every media-library permission request routes through the wrapper. The wrapper file itself is the ONLY place that call may appear.

**Do NOT** route or modify `BoardDiscussion.tsx` (ungated pick — no permission call to replace) or any camera site.

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1** — `app-mobile/app.json` `expo.android.blockedPermissions` lists **all four**: `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`.
- **SC-2** — `app-mobile/app.json` `expo.android.permissions` still lists **none** of `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` / `READ_EXTERNAL_STORAGE` (unchanged from today; the CAMERA/location/calendar/audio set is preserved).
- **SC-3-Android (artifact)** — `npx expo prebuild --platform android --no-install` (run from `app-mobile/`) then grep the generated `android/app/src/main/AndroidManifest.xml`: all four blocked perms carry `tools:node="remove"`, and there is **NO active** (non-`remove`) `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` / `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE`. Then `rm -rf android` (it is gitignored; do not commit it).
- **SC-4** — `requestGalleryPermission()` returns `{ granted:true, status:"granted" }` on Android **without** calling `ImagePicker.requestMediaLibraryPermissionsAsync()`; on iOS it **does** call it and returns its result verbatim.
- **SC-5-Android** — every consumer gallery pick reaches `launchImageLibraryAsync` on Android with no dead-tap: BetaFeedbackModal screenshot pick, MessageInterface image/video/file attach, cameraService `pickFromLibrary` (profile avatar), BoardDiscussion library pick all proceed. (Verified by the routing gate + dead-tap audit; on-device pick folds into the go-live AAB per §10 OQ-2.)
- **SC-6** — no site calls `ImagePicker.requestMediaLibraryPermissionsAsync()` directly outside `mediaLibraryPermission.ts` (grep = 0).
- **SC-7-iOS** — iOS gallery pick behaviour unchanged: the real permission is still requested; `NSPhotoLibraryUsageDescription` intact.
- **SC-8** — camera unchanged: `requestCameraPermissionsAsync` / `launchCameraAsync` still gate on `CAMERA`; no camera site routed through the media wrapper.
- **SC-9** — `version` stays `1.1.1`; no `android.versionCode` literal added; `runtimeVersion.policy` stays `appVersion`.
- **SC-10** — CI regression present + wired + fails-on-revert: `orch-1322-no-android-media-permissions.mjs` (config) `--self-test` green + real run green; the routing guard green + fails-on-revert; job added to `strict-grep-mingla-business.yml`; `test:orch-1322` npm script added.
- **SC-11** — no new TypeScript errors introduced in `app-mobile` (baseline-neutral, measured against `origin/main`).

---

## 6. Invariants

**Establishes (DRAFT — flips ACTIVE at CLOSE; orchestrator owns the flip):**
- `I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS` — `app-mobile/app.json` `expo.android.permissions` must NOT list `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`/`READ_EXTERNAL_STORAGE`, and `expo.android.blockedPermissions` must list all four of `READ_MEDIA_IMAGES`+`READ_MEDIA_VIDEO`+`READ_EXTERNAL_STORAGE`+`WRITE_EXTERNAL_STORAGE`; **and** every consumer gallery-library permission request routes through `mediaLibraryPermission.ts`, which short-circuits `{granted:true}` on Android before calling `ImagePicker`. **Enforcement:** the two gates in §9. **Fails-on-revert:** re-adding a media/storage perm to `permissions`, dropping any `blockedPermissions` entry, removing the Android short-circuit, or reverting any of the 3 sites to a raw `ImagePicker.requestMediaLibraryPermissionsAsync()` call fails CI.

**Preserves (must not regress):**
- `I-IOS-CAMERA-PHOTO-PURPOSE-STRINGS-SPECIFIC` (I-1242) + ORCH-1230 consumer purpose-string invariants — no iOS infoPlist / calendar / camera string change. Verified: the diff touches no iOS strings.
- `I-PROPOSED-1321-NO-ANDROID-MEDIA-PERMISSIONS` (business, different file) — untouched; no namespace conflict (COMMS-0086: ORCH-1322 takes its own 1322 gate/invariant).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy) | app.json config | read `app-mobile/app.json` | `blockedPermissions` = full 4-set; `permissions` has no `READ_MEDIA_*`/`READ_EXTERNAL_STORAGE` | config (strict-grep) |
| T2 (revert) | drop a blocked entry | remove `READ_MEDIA_VIDEO` from `blockedPermissions` | gate exits 1 | config (self-test) |
| T3 (revert) | re-add a media perm | push `READ_MEDIA_IMAGES` into `permissions` | gate exits 1 | config (self-test) |
| T4 (artifact) | merged manifest | `expo prebuild --platform android --no-install` + grep | all 4 carry `tools:node="remove"`; no active media/storage perm | build |
| T5 (happy) | Android short-circuit | call `requestGalleryPermission()` with `Platform.OS='android'` (spy on `ImagePicker.requestMediaLibraryPermissionsAsync`) | returns `{granted:true,status:"granted"}`; spy NOT called | code (runtime/routing) |
| T6 (edge) | iOS delegation | `Platform.OS='ios'` | spy IS called; result returned verbatim | code (runtime) |
| T7 (revert) | remove short-circuit | delete the `Platform.OS==='android'` branch | T5 flips (spy called / dead-tap predicate fires) → gate/test fails | code (fails-on-revert) |
| T8 (routing) | no raw calls | `grep ImagePicker.requestMediaLibraryPermissionsAsync app-mobile/src` (excl wrapper + `__tests__`) | 0 hits; each of the 3 sites imports the wrapper | code (routing gate) |
| T9 (revert) | un-route a site | revert `MessageInterface.tsx` to the raw call | routing gate exits 1 | code (self-test) |
| T10 (adversarial — tester) | post-strip denied reality | drive the gate predicate with the underlying API mocked `granted:false` | flow still reaches `launchImageLibraryAsync` (no dead-tap) because the wrapper short-circuits on Android | code (tester adds) |

---

## 8. Implementation order

1. **`app-mobile/app.json`** — add `expo.android.blockedPermissions` (4-set) as a peer of `permissions`. (SC-1/SC-2/SC-9.)
2. **`app-mobile/src/utils/mediaLibraryPermission.ts`** — create the wrapper with the Android short-circuit (§4.B). (SC-4.)
3. **Route the 3 sites** — `BetaFeedbackModal.tsx:288`, `MessageInterface.tsx:723`, `cameraService.ts:39` → `requestGalleryPermission()` + imports (§4.C). (SC-5/SC-6.)
4. **Verify merged manifest** — `cd app-mobile && npx expo prebuild --platform android --no-install`, grep the manifest (SC-3), then `rm -rf android`. Paste the grep output into the IMPLEMENT report.
5. **Regression gates** (§9) — write `orch-1322-no-android-media-permissions.mjs` (config) + the routing guard; wire the workflow job(s) + `test:orch-1322` npm script; run `--self-test` on both. (SC-10.)
6. **Typecheck** — measure app-mobile `tsc` errors vs `origin/main`; prove baseline-neutral (SC-11).
7. **Fails-on-revert proofs** — capture T2/T3/T7/T9 output; anchor at the fix+test HEAD.
8. **IMPLEMENT report** — `reports/IMPLEMENTATION_ORCH-1322_CONSUMER_ANDROID_MEDIA_PERMISSION.md`.

---

## 9. Regression prevention (fails-on-revert contract)

**Gate A — config (patterned on ORCH-1321, scoped to consumer):** `.github/scripts/strict-grep/orch-1322-no-android-media-permissions.mjs`
- Copy the ORCH-1321 gate structure verbatim, changing `APP_JSON` to `app-mobile/app.json`. Keep `FORBIDDEN_IN_PERMISSIONS` = `[READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_EXTERNAL_STORAGE]` and `REQUIRED_IN_BLOCKED` = the full 4-set. Update all ORCH-1321 strings → ORCH-1322 and the invariant name.
- Include `--self-test` covering ≥5 cases (good passes; re-add `READ_MEDIA_IMAGES` to permissions fails; re-add `READ_EXTERNAL_STORAGE` fails; drop `READ_MEDIA_VIDEO` from blocked fails; delete `blockedPermissions` fails). Mirror the 1321 self-test exactly.

**Gate B — routing / short-circuit (consumer-specific, because consumer has no wrapper):** `.github/scripts/strict-grep/orch-1322-gallery-permission-wrapper-routed.mjs` (node `.mjs`, app-mobile's proven convention — see Investigation D-3/OQ-1)
- Assert (A) `app-mobile/src/utils/mediaLibraryPermission.ts` exists and contains a `Platform.OS === "android"` branch that returns `granted: true` **before** any `ImagePicker.requestMediaLibraryPermissionsAsync(` token (comment-stripped);
- Assert (B) each of `BetaFeedbackModal.tsx`, `MessageInterface.tsx`, `cameraService.ts` imports from `mediaLibraryPermission` and calls `requestGalleryPermission(`;
- Assert (C) NO file under `app-mobile/src` **except** `mediaLibraryPermission.ts` (and `__tests__`) contains `ImagePicker.requestMediaLibraryPermissionsAsync(` (comment-stripped);
- `--self-test`: good passes; removing the Android branch fails (A); un-routing a site fails (B); adding a raw call elsewhere fails (C). This is the fails-on-revert runtime-equivalent proof for the dead-tap risk.

**Wiring:** add TWO sibling jobs to `.github/workflows/strict-grep-mingla-business.yml` (which runs on `app-mobile/**`), each running `--self-test` then the real check, copying the lines 189-200 job shape. Add a `test:orch-1322` script to `app-mobile/package.json` mirroring business's `test:orch-1321` (chain both gates' self-test + real run; append the routing test). Add both gate filenames + the invariant to the workflow's registry-header comment block.

**Preferred stronger runtime proof (optional, if OQ-1 resolves):** if the implementor confirms a working app-mobile jest runner, additionally add `app-mobile/src/utils/__tests__/orch1322AndroidMediaPermissionSkip.test.ts` mirroring the business `orch1321AndroidMediaPermissionSkip.test.ts` (Android → wrapper returns granted, underlying API mock NOT called; iOS → called). This is a *bonus*; Gate B is the required, definitely-runnable guard.

**Tester adds (different angle):** an adversarial dead-tap guard (T10) that drives the gate predicate with the underlying permission mocked `granted:false` (the post-strip Android-≤12 reality) and proves the flow still **reaches `launchImageLibraryAsync`** because the wrapper short-circuits — i.e. NO dead tap; fails-on-revert when the short-circuit is removed. Plus, if feasible, an on-device/emulator Android 13+ pick confirming the Photo Picker opens with no prompt (else capped `suspected`, folding into the go-live AAB — the ORCH-1321 tester precedent).

---

## 10. Open questions

- **OQ-1 — app-mobile jest runner.** app-mobile has `src/**/__tests__/*.test.ts` but no jest key/dep and no discoverable root jest config (Investigation D-3). The **required** runtime-equivalent guard is therefore the node `.mjs` routing Gate B (definitely runs). If the implementor confirms a working jest runner, the bonus jest test is preferred. Implementor: state which mechanism you used and confirm it executes in CI.
- **OQ-2 — Android < 10 camera + `WRITE_EXTERNAL_STORAGE`.** `ImagePickerModule.kt:283-292` requests `WRITE_EXTERNAL_STORAGE` for the **camera** path on API < Q (Android < 10). Blocking it (per the business-parity 4-set) could, in theory, affect camera capture on Android 7-9. The business app shipped the identical 4-set block with camera sites and passed tester; real-world Android < 10 share is negligible. **Recommendation:** keep the 4-set for business parity + invariant symmetry; tester to accept-with-parity or spot-check on an Android ≤9 emulator. Do NOT drop `WRITE_EXTERNAL_STORAGE` from the block without a Seth decision (it would diverge from the proven precedent and the gate shape).
- **OQ-3 — live code-16 declared permissions.** Not re-pulled from the Play API this pass (Investigation F-2, capped `suspected`). Non-blocking — the fresh 1.1.1 build supersedes code 16 regardless. If Seth wants proof, pull `androidpublisher/v3` declared-permissions for code 16 (service acct at `~/.mingla-secrets/playstore-mingla.json`).

---

## 11. Downstream routing

- **Next = mingla-implementor** (this worktree). Build §4 in §8 order, prove §9 fails-on-revert, run the §8.4 prebuild manifest check, write `reports/IMPLEMENTATION_ORCH-1322_CONSUMER_ANDROID_MEDIA_PERMISSION.md`. Do NOT deploy / submit / merge / close.
- **Then = mingla-tester** — verify SC-1…SC-11, re-run the fails-on-revert proofs independently, add the T10 adversarial dead-tap guard, attempt the on-device Android Photo-Picker confirmation (or cap `suspected` + fold into go-live). Write `reports/TEST_ORCH-1322_*`.
- **Then = orchestrator CLOSE** — flip `I-PROPOSED-1322-*` ACTIVE, sync WORLD_MAP + INVARIANT_REGISTRY, one PR, `[deploy]`-free (native build). GO-LIVE = fresh EAS AAB (remote `autoIncrement` versionCode) → `eas submit` to internal → send to Google review. NO OTA.

---

## Scoped allowlist + DO-NOT-TOUCH

**Allowlist (implementor may change ONLY these):**
- `app-mobile/app.json` (add `blockedPermissions` only)
- `app-mobile/src/utils/mediaLibraryPermission.ts` (new)
- `app-mobile/src/components/BetaFeedbackModal.tsx` (route + import only)
- `app-mobile/src/components/MessageInterface.tsx` (route + import only)
- `app-mobile/src/services/cameraService.ts` (route + import only, line 39 region)
- `.github/scripts/strict-grep/orch-1322-no-android-media-permissions.mjs` (new)
- `.github/scripts/strict-grep/orch-1322-gallery-permission-wrapper-routed.mjs` (new)
- `.github/workflows/strict-grep-mingla-business.yml` (2 sibling jobs + registry-header lines)
- `app-mobile/package.json` (`test:orch-1322` script)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (add DRAFT `I-PROPOSED-1322-*`)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1322_*.md` (new)

**DO-NOT-TOUCH:** `app-mobile/app.json` `expo.android.permissions` array, `version`, `runtimeVersion`, `ios.infoPlist`, `plugins`, `intentFilters`; any camera site (`cameraService.ts:32/58/138`, `BoardDiscussion.tsx:348`); the ungated `BoardDiscussion.tsx:349` library pick; `cameraService.initialize()` CAMERA gate + coupling; multi-select options; `eas.json`; the ORCH-1321 gate/invariant/`mingla-business/`; any iOS behaviour. Anything outside the allowlist ⇒ **stop-and-amend** (SPEC amendment), never silently widen.
