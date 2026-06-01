# QA RETEST - META-ORCH-1009 Sub-E Business-App Supply Feeder

Date: 2026-05-31
Tester: tester+codex
Mode: RETEST
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`

## Verdict

FAIL for simulator runtime retest.

Automated and source-level retest evidence is green, and the Business dev build was successfully launched in the iPhone 17 Pro Max simulator against this Sub-E worktree. The runtime could not reach the brand/venue cover flow because the current simulator dev build crashes while loading the bundle: `TurboModuleRegistry.getEnforcing(...): 'VideoTrim' could not be found`. This blocks the requested simulator test and also means the original `Maximum update depth exceeded` loop still cannot be verified until a fresh native Business dev build includes `react-native-video-trim`.

## Findings

| Severity | Finding | Evidence | Required action |
|---|---|---|---|
| P1 release blocker | Current simulator dev build cannot load Sub-E because the native `VideoTrim` module is missing from the binary. | Metro redbox: `TurboModuleRegistry.getEnforcing(...): 'VideoTrim' could not be found`; source points at `coverPickerVideoTrimEditor.ts:18`, call stack through `CoverPicker.tsx`, `CoverPickerSheet.tsx`, `BrandCreationFlow.tsx`, `BrandSwitcherSheet.tsx`, `account.tsx`. | Produce/install a fresh native Business dev build that includes `react-native-video-trim`, then rerun the simulator and physical-device hero-video smoke. |
| P1 verification blocker | Hero-video upload-ready loop remains unverified. | Simulator cannot reach the cover flow due to the `VideoTrim` native-module redbox; physical iPhone smoke also remains unrecorded. | After fresh native build, upload/trim a hero video and verify no repeated `Maximum update depth exceeded` logs after `video_cover_upload_ready`. |
| P4 note | Rework #3 code and regression coverage match the root-cause theory. | `CoverPicker.tsx` stores the last emitted processed URL before `emitChange`; `CoverPicker.videoReadyIdempotency.test.ts` locks this order. | Preserve the regression test in the final scoped commit. |

## Claim Verification

| Claim | Result | Evidence |
|---|---|---|
| CoverPicker emits the ready video patch at most once per processed URL. | Verified by source and regression test. | `CoverPicker.tsx` lines 198-310 add `lastEmittedProcessedVideoUrlRef`, skip duplicate processed URLs, and remember the URL before `setMediaDisplayError`, `emitChange`, and toast. |
| The fix is shared-owner correct, not brand-only. | Verified by source. | The guard is in shared `mingla-business/src/components/ui/CoverPicker.tsx`, before brand/event/trip consumers receive the emitted patch. |
| Regression coverage exists and would catch removal of the guard. | Verified. | `CoverPicker.videoReadyIdempotency.test.ts` asserts the ref, duplicate guard, remembered URL assignment, and ordering before `emitChange` and toast. |
| Focused automated suite passes. | Verified. | Jest focused suite passed: 7 suites, 16 tests. |
| Home + Hub deck-readiness fix routes do not restart `/venue/create?pool=1`. | Verified by source/tests. | `deckReadinessRoutes.ts` returns `/venue/deck-readiness?...`; `DeckReadinessCard.sub_e.test.ts` asserts Home has no `/venue/create?pool=1`. |
| The original iPhone runtime loop is gone. | Unverified. | Simulator is blocked by missing native `VideoTrim`; physical iPhone smoke is still required after a fresh native build. |

## Platform Matrix

| Surface | Result | Notes |
|---|---|---|
| Business iOS physical device | BLOCKED/UNVERIFIED | Required hard gate remains pending after a fresh native build. |
| Business iOS simulator | FAIL | App redboxes on bundle load because `VideoTrim` is missing from the installed native binary. |
| Business Android | N/A for rework #3 | Rework targets shared CoverPicker logic, but the observed blocker was iPhone-specific. Android should be included in broader Sub-E release QA, not this loop retest. |
| Business Web preview | N/A for rework #3 | Native video picker/runtime path is not the browser surface; web split is covered by existing `orch1001CoverPickerWebSplit` test. |
| Admin Web | N/A | Not touched. |
| Consumer iOS/Android | N/A | Not touched by rework #3. |
| Buyer/anonymous Web | N/A | Not touched. |
| Supabase edge/schema | N/A for rework #3 | No backend files changed in rework #3; broader Sub-E deploy gates carry forward from rework #2. |

## Commands Run

### Simulator Runtime Attempt

Metro:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx expo start --dev-client --host localhost --port 8082 --clear
```

Launch:

```bash
xcrun simctl launch 2C3312D9-EE52-4EBD-9704-15811D49A2EC com.sethogieva.minglabusiness
xcrun simctl openurl 2C3312D9-EE52-4EBD-9704-15811D49A2EC 'exp+mingla-business://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082'
```

Evidence:

```text
iOS Bundled 45968ms index.js (5051 modules)
ERROR  [Invariant Violation: TurboModuleRegistry.getEnforcing(...): 'VideoTrim' could not be found. Verify that a module by this name is registered in the native binary.]

Code: coverPickerVideoTrimEditor.ts
18 | import NativeVideoTrim, {

Call Stack
  <global> (src/components/ui/coverPickerVideoTrimEditor.ts:18)
  <global> (src/components/ui/CoverPicker.tsx:51)
  <global> (src/components/ui/CoverPickerSheet.tsx:34)
  <global> (src/components/brand/BrandCreationFlow.tsx:42)
  <global> (src/components/brand/BrandSwitcherSheet.tsx:18)
  <global> (app/(tabs)/account.tsx:22)
```

Dependency check:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && node -e "const p=require('./package.json'); console.log('react-native-video-trim dep:', (p.dependencies||{})['react-native-video-trim'] || (p.devDependencies||{})['react-native-video-trim'] || 'missing')"
```

Output:

```text
react-native-video-trim dep: ^8.1.0
```

Interpretation: the JS dependency is present, but the installed simulator binary is stale or was built without the native module. This is a native-build gate, not an OTA-verifiable state.

### Focused Jest Suite

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx jest src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts src/components/ui/__tests__/orch1001CoverPickerWebSplit.test.ts src/components/ui/__tests__/CoverPicker.videoSourceCeiling.test.ts src/components/ui/__tests__/CoverPicker.videoReadyIdempotency.test.ts src/components/home/__tests__/DeckReadinessCard.sub_e.test.ts src/utils/__tests__/deckReadinessRoutes.sub_e.test.ts app/venue/__tests__/create.ve2.test.ts --runInBand
```

Output:

```text
PASS src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts
PASS src/components/home/__tests__/DeckReadinessCard.sub_e.test.ts
PASS src/components/ui/__tests__/CoverPicker.videoSourceCeiling.test.ts
PASS src/components/ui/__tests__/orch1001CoverPickerWebSplit.test.ts
PASS src/utils/__tests__/deckReadinessRoutes.sub_e.test.ts
PASS src/components/ui/__tests__/CoverPicker.videoReadyIdempotency.test.ts
PASS app/venue/__tests__/create.ve2.test.ts

Test Suites: 7 passed, 7 total
Tests: 16 passed, 16 total
```

### Earlier Dev Server Attempt

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx expo start --dev-client --host lan --port 8082 --clear
```

Observed:

```text
Metro waiting on exp+mingla-business://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082
Web is waiting on http://localhost:8082
Using development build
```

LAN IP for phone testing:

```text
172.20.9.90
```

## Regression Coverage Assessment

The regression coverage is acceptable for source-level protection and should be committed with the fix. It does not replace physical runtime proof because the original failure involved React Native dev-build behavior, native video upload state, and parent callback churn visible after an actual upload-ready event.

Fail-on-revert proof was not run because tester mode does not modify product code and should not revert the implementation. Source inspection shows the test would fail on the pre-rework state because `lastEmittedProcessedVideoUrlRef` and the duplicate processed-URL guard were absent.

## Deploy / Migration Readiness

Rework #3 introduced no new migration or edge-function changes. Do not deploy or apply anything for this rework alone.

For the broader Sub-E close, carry forward these orchestrator-owned gates from rework #2:

- Apply pending Sub-E migration only after the linked migration-drift check is safe.
- Deploy the Sub-E edge functions from merged source, per COMMS-0015.
- Preserve the strict-grep backend allowlist updates already present in the broader Sub-E diff.

## Required Retest Gate

1. Produce/install a fresh native Mingla Business dev build that includes `react-native-video-trim`.
2. Restart Metro from `mingla-business` on port `8082`.
3. Open the Business dev build in the iOS simulator and confirm the bundle loads without the `VideoTrim` redbox.
4. Enter the Sub-E brand/venue cover flow.
5. Upload and trim a hero video through CoverPicker.
6. Wait for upload processing to complete.
7. PASS condition: exactly one `Video cover updated.` toast, processed video remains selected, app stays responsive, and Metro has no repeated `Maximum update depth exceeded` stack from `CoverPicker.tsx`.
8. FAIL condition: missing native module, repeated update-depth stack, or app freeze after `video_cover_upload_ready`.

## Orchestrator Runtime Continuation - 2026-05-31

### Verdict

CONDITIONAL PASS for the stale-native blocker; still BLOCKED on authenticated runtime smoke.

The previous simulator failure is no longer reproducing after Rework 4 and a fresh iOS simulator dev-client rebuild. The app now loads the Sub-E JS bundle to the Mingla Business login screen without the import-time `VideoTrim` TurboModule redbox. The remaining test gate is not native linkage; it is access to an authenticated Business account in the simulator so the cover-video flow can be driven end to end.

### New Evidence

| Gate | Result | Evidence |
|---|---|---|
| Rework 4 source regression | PASS | `npx jest CoverPicker.dedicatedTrimmer orch1001CoverPickerWebSplit --runInBand` passed 2 suites / 9 tests. |
| Fresh native iOS simulator build | PASS | `xcodebuild -workspace minglabusiness.xcworkspace -scheme minglabusiness -configuration Debug -destination "platform=iOS Simulator,id=2C3312D9-EE52-4EBD-9704-15811D49A2EC" build` returned `** BUILD SUCCEEDED **`; Xcode graph included `VideoTrim`. |
| Fresh simulator install/launch | PASS | Installed `/Users/sethogieva/Library/Developer/Xcode/DerivedData/minglabusiness-ghoeylalbzpueufictcvspjbubjx/Build/Products/Debug-iphonesimulator/minglabusiness.app` and launched `com.sethogieva.minglabusiness`. |
| Metro bundle from Sub-E worktree | PASS | `npx expo start --dev-client --host localhost --port 8082 --clear` bundled `index.js`; runtime logs show auth bootstrap and env warnings only, not `VideoTrim` redbox. |
| Expo developer-menu onboarding | CLEARED | Set simulator defaults `EXDevMenuIsOnboardingFinished=true` and `EXDevMenuShowsAtLaunch=false`; relaunch reached the app instead of the dev-menu sheet. |
| App visible | PASS | Screenshot `/tmp/meta-orch-1009-sube-login.png` shows the Mingla Business login screen with Apple, Google, and Email sign-in buttons. |
| Authenticated hero-video smoke | BLOCKED | Simulator is unauthenticated: Metro logs `bootstrap-no-session` and `INITIAL_SESSION hasSession=false`; no reusable dev credentials were found in scoped repo/artifact search. |

### Commands Added

```bash
cd "/Users/sethogieva/Desktop/mingla-main/mingla-business/ios" && xcodebuild \
  -workspace minglabusiness.xcworkspace \
  -scheme minglabusiness \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=2C3312D9-EE52-4EBD-9704-15811D49A2EC" \
  build
```

```bash
APP=$(find "$HOME/Library/Developer/Xcode/DerivedData" -name "minglabusiness.app" -type d -path "*Debug-iphonesimulator*" -print0 2>/dev/null | xargs -0 ls -td | head -1)
xcrun simctl terminate 2C3312D9-EE52-4EBD-9704-15811D49A2EC com.sethogieva.minglabusiness 2>/dev/null || true
xcrun simctl uninstall 2C3312D9-EE52-4EBD-9704-15811D49A2EC com.sethogieva.minglabusiness 2>/dev/null || true
xcrun simctl install 2C3312D9-EE52-4EBD-9704-15811D49A2EC "$APP"
xcrun simctl launch 2C3312D9-EE52-4EBD-9704-15811D49A2EC com.sethogieva.minglabusiness
```

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx expo start --dev-client --host localhost --port 8082 --clear
```

```bash
xcrun simctl spawn 2C3312D9-EE52-4EBD-9704-15811D49A2EC defaults write com.sethogieva.minglabusiness EXDevMenuIsOnboardingFinished -bool YES
xcrun simctl spawn 2C3312D9-EE52-4EBD-9704-15811D49A2EC defaults write com.sethogieva.minglabusiness EXDevMenuShowsAtLaunch -bool NO
xcrun simctl openurl 2C3312D9-EE52-4EBD-9704-15811D49A2EC 'exp+mingla-business://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082'
```

### Updated Next Gate

1. Keep Metro running from the Sub-E worktree on `localhost:8082`.
2. Sign into the Mingla Business simulator session.
3. Continue the Sub-E cover-video runtime gate from the authenticated Home/Hub surface.
4. PASS condition remains exactly one `Video cover updated.` toast, retained selected video, responsive app, and no repeated `Maximum update depth exceeded` stack.

## Orchestrator Authenticated Runtime Continuation - 2026-05-31

### Verdict

PASS for the Rework 3/4 CoverPicker runtime failure class.

The authenticated Mingla Business simulator run no longer reproduces either failure that blocked the prior retest: the stale native `VideoTrim` TurboModule redbox is gone, and the hero-video upload path did not enter a repeated `Maximum update depth exceeded` loop after the upload-ready event. A fresh native simulator build, hydrated Sub-E dependencies, and Metro bundle from the Sub-E worktree were used for this proof.

This is not a full PASS for the entire META-ORCH-1009 Sub-E venue-authoring journey. It verifies the shared CoverPicker brand/venue hero-video path that caused the concrete runtime blocker; the full new-venue address, Google-match, Tier 1/Tier 2, and deck-readiness path still remains a broader workflow gate if Sub-E close requires end-to-end venue creation.

### New Evidence

| Gate | Result | Evidence |
|---|---|---|
| Authenticated simulator session | PASS | User signed into the already-installed fresh dev client; screenshot `/tmp/meta-orch-1009-sube-signedin-start.png` shows the Business Home screen for `Fine Dining Raleigh`. |
| Dependency hydration | PASS | `npm install` in the Sub-E worktree repaired a bad `node_modules` non-directory state; `expo-linking@8.0.12`, `expo-router@6.0.23`, and `@react-native-async-storage/async-storage@2.2.0` were installed, clearing the transient `Unable to resolve "expo-linking"` Metro error. |
| Clean Sub-E bundle after hydration | PASS | Restarted Metro from the Sub-E worktree on port `8082`; bundle completed with `index.js (5051 modules)` and no `VideoTrim` redbox. |
| Shared CoverPicker sheet opens | PASS | Navigated to brand edit for current brand `15f2541e-3226-4e72-b9f4-3186e639ea90` (`Fine Dining Raleigh`), tapped Brand Cover -> `Change cover`; screenshot `/tmp/meta-orch-1009-cover-sheet.png`. |
| Video media picker path | PASS | Generated a 4-second `/tmp/mingla-cover-test.mp4`, added it to the simulator camera roll, tapped `Upload video`, granted full photo-library access, and saw the test video in the native picker; screenshot `/tmp/meta-orch-1009-photo-picker.png`. |
| Native VideoTrim editor | PASS | Selecting the 4-second test video opened the native trim editor and showed `Use clip`; screenshot `/tmp/meta-orch-1009-after-video-select.png`. |
| Upload-ready event | PASS | After `Use clip` -> `Proceed`, Metro logged `upload-intent-ready` for Cloudinary job `5e388716-bfc1-402e-810f-48058e128388` followed by `video_cover_upload_ready`. |
| Preview retained / app responsive | PASS | Cover sheet returned with the selected color-bars video preview retained and buttons still interactive; screenshot `/tmp/meta-orch-1009-video-ready.png`. |
| Regression symptom check | PASS | No repeated `Maximum update depth exceeded` stack appeared in Metro during the authenticated video path, and no `VideoTrim` missing-module redbox appeared. |

### Runtime Log Excerpt

```text
INFO [eventCoverVideoProcessingService] upload-intent-request {"applyMode":"published_manual","brandId":"15f2541e-3226-4e72-b9f4-3186e639ea90","eventId":undefined,"requestId":"mptxrqnh-x9ngc68o","sourceBytes":348674,"sourceDurationMs":4000,"sourceFileName":"mingla-cover-test.mp4","sourceMimeType":"video/mp4","trimEndMs":4000,"trimStartMs":0}
INFO [eventCoverVideoProcessingService] upload-intent-ready {"jobId":"5e388716-bfc1-402e-810f-48058e128388","provider":"cloudinary","requestId":"mptxrqnh-x9ngc68o"}
WARN [eventCoverVideoProcessingService] video_cover_upload_ready {"applyMode":"published_manual","eventId":"","jobId":"5e388716-bfc1-402e-810f-48058e128388","phase":"status","timestamp":"2026-05-31T15:30:20.217Z"}
```

### Updated Next Gate

1. Treat the CoverPicker rework gate as runtime-passed.
2. If the Sub-E close requires the entire Sarah new-venue path, run a separate authenticated workflow gate through create venue -> address/Google match -> Tier 1/Tier 2 -> deck-readiness status.
3. Do not reopen the CoverPicker native-module/update-loop blocker unless the same symptoms reproduce on a fresh native build with hydrated dependencies.

## Independent Tester Verdict - 2026-05-31

### Verdict

CONDITIONAL PASS for authenticated runtime status.

The specific runtime blocker under retest is verified fixed enough to stop looping on CoverPicker rework: the fresh Business dev client loads the Sub-E bundle with an authenticated session, the native VideoTrim editor was proven open by simulator screenshot, the upload-ready log exists for the test video, the selected preview was retained, and the focused regression suite passes. I do not upgrade the whole Sub-E close gate to PASS because the full Sarah create-new venue path through Google/address, Tier 1, Tier 2, and deck-readiness was not completed in this retest and remains a separate workflow gate for the original Sub-E promise.

### Findings

| Severity | Finding | Evidence | Required action |
|---|---|---|---|
| P2 residual gate | Full new-venue workflow remains unverified for close. | SPEC success target is Sarah creates/claims a venue, finishes Tier 1 + Tier 2, and enters the deck pipeline as a shape-complete `place_pool` row; this retest only verifies the authenticated shared CoverPicker brand-video path and Home runtime load. | Orchestrator must either accept this as a scoped CoverPicker runtime pass or dispatch a separate end-to-end venue workflow gate before closing all of Sub-E. |
| P4 note | CoverPicker runtime blocker is no longer active on the fresh native simulator build. | Metro rebundled from the Sub-E worktree with `INITIAL_SESSION hasSession=true`; no `VideoTrim` redbox or maximum-update-depth stack appeared during this independent rebundle check. Current screenshot `/tmp/meta-orch-1009-tester-current.png` shows the signed-in Business Home surface still responsive. | Preserve the fresh-native-build requirement for future video-trim QA. |

### Independent Evidence

| Claim | Tester result | Evidence |
|---|---|---|
| Stale native `VideoTrim` import crash is fixed at bundle load. | Verified. | Source has no top-level value import from `react-native-video-trim`; `coverPickerVideoTrimEditor.ts` lazy-requires it inside `loadNativeVideoTrim`. Independent Metro rebundle completed: `iOS Bundled 200751ms index.js (5051 modules)` with no `VideoTrim` redbox. |
| Missing native module degrades at trim invocation, not module import. | Verified by regression coverage. | `CoverPicker.dedicatedTrimmer.test.ts` mocks `react-native-video-trim` to throw and confirms importing `coverPickerVideoTrimEditor` succeeds while `trimVideoWithDedicatedEditor()` rejects with the updated-native-build message. |
| Upload-ready update loop is guarded. | Verified by source and regression coverage. | `CoverPicker.tsx` stores `lastEmittedProcessedVideoUrlRef.current = videoUpload.processedUrl` before `emitChange()` and toast; `CoverPicker.videoReadyIdempotency.test.ts` locks that order. |
| Focused regression suite is green in the worktree. | Verified. | `npx jest src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts src/components/ui/__tests__/orch1001CoverPickerWebSplit.test.ts src/components/ui/__tests__/CoverPicker.videoSourceCeiling.test.ts src/components/ui/__tests__/CoverPicker.videoReadyIdempotency.test.ts src/components/home/__tests__/DeckReadinessCard.sub_e.test.ts src/utils/__tests__/deckReadinessRoutes.sub_e.test.ts app/venue/__tests__/create.ve2.test.ts --runInBand` passed 7 suites / 18 tests. |
| Authenticated app runtime remains reachable after the prior video test. | Verified. | Independent simulator screenshot `/tmp/meta-orch-1009-tester-current.png` shows signed-in Home for `Fine Dining Raleigh`; Metro logged `INITIAL_SESSION hasSession=true`, then background utility bundles only. |
| Full Sub-E Sarah flow is ready to close. | Not verified. | Implementation report still lists full Tier 2 UI, generated-bio confirmation, vibe/facet UI, real Gemini Tier 2, and first-session CoverPickerSheet architecture as remaining or manual gates; this retest did not execute create-new venue -> Tier 1 -> Tier 2 -> deck readiness. |

### Commands Run

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx jest src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts src/components/ui/__tests__/orch1001CoverPickerWebSplit.test.ts src/components/ui/__tests__/CoverPicker.videoSourceCeiling.test.ts src/components/ui/__tests__/CoverPicker.videoReadyIdempotency.test.ts src/components/home/__tests__/DeckReadinessCard.sub_e.test.ts src/utils/__tests__/deckReadinessRoutes.sub_e.test.ts app/venue/__tests__/create.ve2.test.ts --runInBand
```

Output:

```text
Test Suites: 7 passed, 7 total
Tests:       18 passed, 18 total
Time:        43.966 s
```

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx expo start --dev-client --host localhost --port 8082 --clear
xcrun simctl launch 2C3312D9-EE52-4EBD-9704-15811D49A2EC com.sethogieva.minglabusiness
xcrun simctl openurl 2C3312D9-EE52-4EBD-9704-15811D49A2EC 'exp+mingla-business://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082'
xcrun simctl io 2C3312D9-EE52-4EBD-9704-15811D49A2EC screenshot /tmp/meta-orch-1009-tester-current.png
```

Runtime excerpt:

```text
iOS Bundled 200751ms index.js (5051 modules)
INFO  [auth] auth-event {"event": "INITIAL_SESSION", "hasSession": true, "hasUser": true}
```

### Platform Matrix Update

| Surface | Result | Notes |
|---|---|---|
| Business iOS simulator | PASS for CoverPicker runtime gate | Fresh native dev client + Sub-E Metro bundle load authenticated, screenshots prove native trim/editor and retained preview from the prior signed-in run, and independent rebundle shows no redbox/loop. |
| Business iOS physical device | CONDITIONAL / manual | Seth previously reported the phone looked good, but this tester pass did not capture a fresh physical-device log/video. Not required to clear the simulator runtime blocker, still useful before public rollout. |
| Business Android | N/A for this runtime blocker | The reproduced blocker and native rebuild were iOS simulator focused; broader Sub-E release QA should still include Android for venue authoring. |
| Business Web | N/A for native VideoTrim | Web has a platform stub and is covered by the web split test; full Sub-E business-web parity remains broader release QA. |

### Close Guidance

Use this as a PASS for the Rework 3/4 CoverPicker runtime failure class and a CONDITIONAL PASS for authenticated runtime status. Do not close all of META-ORCH-1009 Sub-E as fully verified unless orchestrator explicitly scopes close to this runtime rework or runs the separate Sarah end-to-end venue gate.

## Orchestrator Full Sarah Flow Attempt - 2026-05-31

### Verdict

FAIL for the full Sarah create-new venue workflow gate.

The flow now gets past the first-session name gate and category picker, but it blocks on Step 1 of the venue wizard because the live `places-autocomplete` edge function returns Google upstream `403` for a normal Raleigh address. The UI silently collapses autocomplete failures to no suggestions, and the wizard still requires a Google-derived `lat`/`lng` before Step 1 can advance.

This does not reopen the CoverPicker/VideoTrim bug. It is a separate full-flow blocker for the original Sub-E promise that Sarah can create a new venue in one first session.

### Evidence

| Gate | Result | Evidence |
|---|---|---|
| Create-new venue name | PASS | Deep-linked to `/venue/create`, entered `Codex Wine Bar QA 531`, and continued without selecting a pool match. Screenshot: `/tmp/meta-orch-1009-name-after.png`. |
| Category picker | PASS | Selected a venue category and reached the 7-step wizard. Screenshot: `/tmp/meta-orch-1009-wizard-address3.png`. |
| Address autocomplete | FAIL | Entered `301 S Blount St Raleigh`; no suggestions rendered. Screenshot: `/tmp/meta-orch-1009-address-results.png`. |
| Edge-function proof | FAIL | Direct authenticated call to `https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/places-autocomplete` with body `{"action":"autocomplete","query":"301 S Blount St Raleigh"}` returned `HTTP/2 403` and `{"error":"google_places_403","suggestions":[]}`. |
| User-visible fallback | FAIL | `AddressAutocompleteInput` treats autocomplete failures as empty dropdown; `venueStepError(0)` still requires `lat` and `lng`, so typed address alone cannot satisfy Step 1. |

### Root Cause

`supabase/functions/places-autocomplete/index.ts` calls the Google Places API (New) v1 endpoint `https://places.googleapis.com/v1/places:autocomplete`. The live function has a Google API key present, but Google rejects the upstream autocomplete call with 403. This usually means the API key is restricted away from that API or the required Places API (New) product is not enabled for the key/project.

### Required Rework

1. Fix `places-autocomplete` so a valid business address can produce suggestions in the deployed environment. The likely durable code-side fix is a server-side fallback from the Places API (New) v1 endpoint to the legacy Places Autocomplete + Details endpoints, because existing Mingla Google-place ingestion likely uses the older API family.
2. Add edge-function tests that mock a v1 `403` and prove the fallback still returns suggestions/details.
3. Improve the client failure state so Sarah sees a useful inline address-service message instead of an empty field when the proxy fails.
4. Retest the full Sarah path after deploying the fixed function: name -> category -> address suggestion pick -> seven-step wizard -> Tier 1 creation -> deck-readiness setup -> Tier 2 AI/confirm or explicit AI-provider manual gate.
