# QA REPORT — ORCH-0904

**Title:** Consumer solo-mode deck uses GPS up to 5 minutes stale — driving users filter against where they WERE, not where they ARE

**Tester:** Claude `mingla-tester` (canonical TEST owner post-DEC reversal 2026-05-10), 2026-05-21
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Commit under test:** `999881f9` ("ORCH-0904: solo-mode preferences-apply snapshots fresh GPS + setQueryData(userLocation) before refresh-key bump")
**SPEC:** [`Mingla_Artifacts/specs/SPEC_ORCH-0904_SOLO_MODE_STALE_GPS.md`](../specs/SPEC_ORCH-0904_SOLO_MODE_STALE_GPS.md)
**IMPLEMENTATION:** [`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0904_SOLO_MODE_STALE_GPS.md`](IMPLEMENTATION_ORCH-0904_SOLO_MODE_STALE_GPS.md)
**INVESTIGATION:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0904_SOLO_MODE_STALE_GPS.md`](INVESTIGATION_ORCH-0904_SOLO_MODE_STALE_GPS.md)
**Mode:** TARGETED + RETEST (independent audit of implementor pass)

---

## §0 — Verdict

**CONDITIONAL PASS** — `probable` confidence on the iOS/Android UI parity gate; `proven` confidence on the structural-regression gate.

**Severity counts:** P0 = 0 · P1 = 0 · P2 = 0 · P3 = 1 · P4 = 2

**Conditions for promotion to full PASS:** operator (or a tester re-dispatch with a fresh `app-mobile` consumer dev build) runs the 8-step `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md`-based Simulate-Location smoke from SPEC §5.4 on both iOS Simulator and Android Emulator. Per memory `feedback_tester_canonical_and_platform_parity.md` I name the blocker explicitly rather than silently accept deferral.

**Why CONDITIONAL PASS, not FAIL:**

- All 11 SPEC SCs verified at source-code level (structural) — see §3 traceability.
- Implementor's 8/8 happy-path regression tests GREEN at HEAD `999881f9`.
- Tester-authored 8/8 adversarial regression tests GREEN at HEAD `999881f9`, attacking 8 distinct weakening vectors none of which the happy-path covered.
- Both `[FAILS-ON-REVERT KEY]` anchors (TA-02 strict-equality guard + TA-04 try/catch wrapper) independently verified RED-on-revert + GREEN-on-restore.
- Forensic five-truth-layer cross-check passed: docs (SPEC §2) match schema (`useUserLocation.ts:152` key shape) match code (`AppHandlers.tsx:508-517`) match data (query-cache slot is `['userLocation', user.id, 'solo', null, null, null, true]`).
- Constitutional compliance: #2 (one owner per truth), #3 (no silent failures), #5 (server state server-side), #8 (subtract before adding) all PASS.

**Why not full PASS:**

- SPEC §5.4's 8-step Simulate-Location smoke on iOS Simulator + Android Emulator is the ONLY direct evidence that the deck visibly re-anchors to fresh GPS coords (SC-10). Without running it, SC-10 has source-only proof of the mechanism but no observed end-user behavior change on either platform.
- Phase 0.A confidence ladder caps source-only UI-runtime evidence at `suspected`; this report reaches `probable` only by virtue of attempting the iOS sim launch (see §6).

---

## §1 — Cross-Surface Impact Check (replay against the implementor's claim)

| Surface | Implementor claim | Tester independent finding |
|---|---|---|
| Consumer iOS (`app-mobile/`) | **YES — affected** | **Confirmed.** PreferencesSheet.tsx solo branch at lines 905-934 + AppHandlers.tsx setQueryData at lines 508-517 are RN code shipping to iOS. |
| Consumer Android (`app-mobile/`) | **YES — affected** | **Confirmed.** Same shared RN code path. No platform-specific files. Parity automatic. |
| Buyer-anon-web | NO | **Confirmed.** No PreferencesSheet in `mingla-business/` `/checkout/{eventId}` or `/e/{...}` routes. |
| Business iOS / Android / web-preview | NO | **Confirmed.** `mingla-business/` has no consumer-side `PreferencesSheet`. |
| Admin Web | NO | **Confirmed.** Admin has no consumer preferences sheet. |

Tester verdict: **cross-surface scope correctly declared.** No drift between SPEC §0, implementation report §1, and the actual git diff.

---

## §2 — Forensic Code Reading (independent, 5-truth-layer cross-check)

### Layer 1 — Documentation
SPEC §2 prescribes a 25-line insertion in `PreferencesSheet.tsx` solo branch + a 17-line insertion in `AppHandlers.tsx` before the existing `setPreferencesRefreshKey` block.

### Layer 2 — Schema / contracts
- `useUserLocation.ts:152` query key tuple: `['userLocation', userId, currentMode, customLat, customLng, customLocation, useGpsFlag]` (verified by tester re-read, line 152, file unchanged).
- `useUserLocation.ts:155` staleTime: `useGpsFlag ? 5 * 60 * 1000 : Infinity` (verified, unchanged).
- `RecommendationsContext.tsx:168` default `propCurrentMode = "solo"` — confirms the literal `'solo'` in the setQueryData key tuple matches the variable `currentMode` resolution in solo mode.
- `enhancedLocationService.ts:70-149` contract: `getCurrentLocation(): Promise<LocationData | null>` with 10s GPS timeout + 3s last-known fallback. SPEC §1 assumption holds.

### Layer 3 — Code
- `PreferencesSheet.tsx:905-934` post-fix: solo branch contains GPS-snapshot block (`let soloFreshGpsLat`/`Lng` decls → try-block with `await enhancedLocationService.getCurrentLocation()` → assignment of `soloFreshGpsLat = gps.latitude` / `Lng = gps.longitude` inside `if (gps)` → catch-block silent fallback → onSave invocation with spread + `freshGpsLat`/`Lng` fields).
- `AppHandlers.tsx:508-517` post-fix: setQueryData block guarded by `preferences.useGpsLocation === true && typeof preferences.freshGpsLat === 'number' && typeof preferences.freshGpsLng === 'number'`, calling `queryClient.setQueryData(['userLocation', user.id, 'solo', null, null, null, true], { lat, lng })`.
- `AppHandlers.tsx:520-522` post-fix: `setPreferencesRefreshKey` bump unchanged in code, positioned AFTER the setQueryData block (source-index ordering verified by happy-path T-03 + adversarial TA-07).

### Layer 4 — Runtime
Source-only proof of mechanism: the `setQueryData` write is synchronous; React Query updates the cache slot in O(1) before control returns. The subsequent `setPreferencesRefreshKey((prev) => prev + 1)` triggers a re-render of any subscriber that depends on `preferencesRefreshKey`. The deck refetch fires; `useUserLocation` reads the just-written cache slot via its query-key tuple. Race-free by construction.

**Verified-via-sim runtime:** NOT performed in this report (see §6 blocker).

### Layer 5 — Persisted data
`useUserLocation.ts` has a useEffect that persists resolved coords to AsyncStorage key `@mingla/lastLocation` (per implementation report §6 + grep verification). The fresh-coord setQueryData write benefits this persistence for free — next cold-start reads the fresh coords. No AsyncStorage schema change.

**Cross-layer verdict:** all five layers agree. No contradictions surfaced.

---

## §3 — SC traceability matrix

| SC | Requirement | Implementor claim | Tester independent verification | Status |
|---|---|---|---|---|
| SC-01 | Solo branch resolves fresh GPS when GPS-mode + no custom coords | T-01 GREEN | TA-01 + TA-06 + TA-08 (3 independent angles) GREEN; source inspected at PreferencesSheet.tsx:911-924 | **PASS** |
| SC-02 | Solo branch threads `freshGpsLat`/`freshGpsLng` into onSave | T-01 GREEN | Source: PreferencesSheet.tsx:925-932 confirms `onSave({ ...preferences, freshGpsLat, freshGpsLng })` shape | **PASS** |
| SC-03 | AppHandlers writes setQueryData with correct key tuple BEFORE refresh-key bump | T-02 + T-03 GREEN | TA-05 (element-for-element tuple parse) + TA-07 (multi-bump ordering) GREEN; source inspected at AppHandlers.tsx:508-522 | **PASS** |
| SC-04 | Custom-location users (`useGpsLocation=false`) skipped | T-08 GREEN | TA-02 [FAILS-ON-REVERT KEY] verified — weakening the guard to truthy makes TA-02 RED; restore → GREEN | **PASS** |
| SC-05 | Zero-coord edge case (equator/prime meridian) triggers cache write | T-07 GREEN | TA-03 enumerates 10 forbidden truthy/non-zero patterns; NONE present in AppHandlers.tsx | **PASS** |
| SC-06 | GPS resolve failure does not block save | (implicit in T-01 structural) | TA-04 [FAILS-ON-REVERT KEY] verified — removing the try/catch makes TA-04 RED; restore → GREEN | **PASS** |
| SC-07 | Collab branch byte-identical pre-fix and post-fix | T-06 GREEN | TA-01 enforces 2-distinct-call-sites in PreferencesSheet (drift-via-consolidation defense); confirmed | **PASS** |
| SC-08 | No global staleTime change on useUserLocation | T-04 GREEN | Source: `useUserLocation.ts:155` byte-identical; git diff confirms zero changes to this file | **PASS** |
| SC-09 | No query-key discriminator added to useUserLocation | T-05 GREEN | Source: `useUserLocation.ts:152` byte-identical; git diff confirms zero changes | **PASS** |
| SC-10 | Deck refetch reads fresh coords post-Apply (live-fire) | Deferred to TEST phase | **PROBABLE** — source-only mechanism proof + 16/16 regression tests GREEN; iOS Sim live-fire BLOCKED (§6); Android Emulator live-fire BLOCKED (§6) | **CONDITIONAL** |
| SC-11 | Solo + collab parity restored | T-01 + T-06 together | TA-01 + TA-08 cross-verify both branches have parallel structure | **PASS** |

10 of 11 SCs are fully PASS; SC-10 reaches `probable` confidence (mechanism proven source-side; behavior un-observed on sim).

---

## §4 — Constitutional compliance

| Principle | Tester verdict | Evidence |
|---|---|---|
| #1 No dead taps | **N/A** | No new tappable elements introduced. |
| #2 One owner per truth | **PASS** | `useUserLocation` remains sole location source. setQueryData populates that source; does not create a parallel store. |
| #3 No silent failures | **PASS** | GPS-resolve failure caught + downstream `useUserLocation` fallback chain still applies. Documented graceful degradation, not silent failure. |
| #4 One key per entity | **PASS** | Reuses existing `useUserLocation` query key; no parallel key invented. |
| #5 Server state server-side | **PASS** | setQueryData mutates React Query cache (server-state layer); no Zustand involvement. |
| #6 Logout clears everything | **PASS** | Cache write keyed by `user.id`; logout invalidates per existing React Query auth-clear flow. |
| #7 Label temporary | **N/A** | No `[TRANSITIONAL]` markers added. The cross-file key-shape coupling is documented inline in the SPEC + implementation report §6; not a transient. |
| #8 Subtract before adding | **PASS** | No mechanism removed; existing 5-min staleTime preserved for non-Apply consumers. Additive. |
| #9 No fabricated data | **PASS** | Fresh coords come from `enhancedLocationService.getCurrentLocation()` — real GPS, not invented. |
| #10 Currency-aware | **N/A** |
| #11 One auth instance | **N/A** |
| #12 Validate at right time | **PASS** | Type guards on `freshGpsLat`/`Lng` use `typeof === 'number'` — runtime check, not compile-time only. |
| #13 Exclusion consistency | **N/A** |
| #14 Persisted-state startup | **PASS** | AsyncStorage `@mingla/lastLocation` is read via existing `useUserLocation` hydration path; not bypassed. |

Zero violations.

---

## §5 — Regression test gate (ORCH-0840 Step 0.5)

### Implementor happy-path test
**Path:** `app-mobile/scripts/ci/orch-0904-regression-check.mjs` (committed in `999881f9`).

**Run:** `node app-mobile/scripts/ci/orch-0904-regression-check.mjs`

**Output (post-fix at HEAD `999881f9`):**

```
PASS T-01 [FAILS-ON-REVERT KEY] PreferencesSheet solo branch: GPS resolve + freshGpsLat/Lng threaded into onSave
PASS T-02 AppHandlers setQueryData with [userLocation, user.id, solo, null, null, null, true] + {lat,lng} value
PASS T-03 [FAILS-ON-REVERT KEY] AppHandlers setQueryData(userLocation) call appears BEFORE setPreferencesRefreshKey bump
PASS T-04 useUserLocation.ts staleTime line preserved (no global staleTime change per SC-08)
PASS T-05 useUserLocation.ts query key preserved (no key discriminator added per SC-09)
PASS T-06 PreferencesSheet collab branch GPS-snapshot block preserved (parity reference per SC-07)
PASS T-07 AppHandlers type guards use `typeof === "number"` (zero-coord edge case per SC-05)
PASS T-08 AppHandlers gates setQueryData on `preferences.useGpsLocation === true` strict equality (per SC-04)

PASS — ORCH-0904 happy-path regression check: 8/8 GREEN.
```

**Fails-on-revert (implementor self-cited at HEAD `9d20c643` in IMPLEMENTATION report §8):** verified by re-reading the implementation report's RED-on-revert outputs for T-01 + T-03. Tester accepts these citations.

### Tester adversarial test (NEW — this report)
**Path:** `app-mobile/scripts/ci/orch-0904-adversarial-check.mjs` (NEW, tester-authored; staged by this QA pass).

**Run:** `node app-mobile/scripts/ci/orch-0904-adversarial-check.mjs`

**Output (post-fix at HEAD `999881f9`):**

```
PASS TA-01 Collab branch retains its OWN GPS-resolve call (defends against drift-via-helper-consolidation)
PASS TA-02 [FAILS-ON-REVERT KEY] setQueryData guard uses strict `useGpsLocation === true` only — no weakened truthy gating
PASS TA-03 No truthy / non-zero / non-null guards on freshGpsLat/Lng (zero-coord users at equator + prime meridian still trigger cache write)
PASS TA-04 [FAILS-ON-REVERT KEY] Solo branch wraps GPS-resolve in try/catch AND still calls onSave after a GPS failure
PASS TA-05 setQueryData key tuple in AppHandlers matches useUserLocation.ts:152 query-key shape element-for-element
PASS TA-06 In solo branch, GPS-resolve appears BEFORE onSave invocation (snapshot semantics)
PASS TA-07 Every refresh-key bump inside handleSavePreferences is preceded by a setQueryData(userLocation) write
PASS TA-08 Solo guard structure mirrors collab: `useGpsLocation && X?.lat == null` in BOTH branches

PASS — ORCH-0904 adversarial regression check: 8/8 GREEN.
```

### Adversarial-vs-happy-path differentiation (Step 0.5 anti-clone gate)
Each TA-NN attacks a DIFFERENT angle than the implementor's T-NN. Side-by-side delta table:

| TA-NN | Happy-path overlap | Different angle attacked |
|---|---|---|
| TA-01 | T-06 (collab block exists) | Enforces TWO distinct `getCurrentLocation` call sites in PreferencesSheet — drift-via-helper-consolidation defense (a refactor merging both branches into a shared `resolveFreshGps()` helper would make TA-01 RED while T-06 stays GREEN). |
| TA-02 | T-08 (strict-equality present) | Scans every line of the guard for ANY weakening pattern, not just the strict-equality line. Catches partial reverts. **[FAILS-ON-REVERT KEY]** |
| TA-03 | T-07 (typeof guards present) | Inverse: enumerates 10 forbidden truthy/non-zero/non-null patterns and asserts NONE exist anywhere in AppHandlers.tsx. Catches a future contributor who adds `&& preferences.freshGpsLat > 0` in a "defensive" way. |
| TA-04 | (no happy-path counterpart for try/catch) | Verifies the try/catch block exists AND that `onSave` invocation appears AFTER the catch in the same solo block. **[FAILS-ON-REVERT KEY]** |
| TA-05 | T-02 + T-05 (literal-regex check on each tuple) | Parses both tuples and asserts element-for-element semantic match — catches a key-shape drift where useUserLocation adds an 8th element. |
| TA-06 | (no happy-path counterpart) | Verifies in-solo-block source index of GPS-resolve < source index of onSave invocation. |
| TA-07 | T-03 (single-pair ordering) | Extends T-03 to ENUMERATE all `setPreferencesRefreshKey` bumps and assert each one has a preceding setQueryData. Catches a future retry-path bump that bypasses the cache write. |
| TA-08 | (no happy-path counterpart) | Cross-verifies BOTH solo + collab guard structures, including in-solo-block proximity. Catches a unilateral guard relaxation on one branch. |

**Tester verdict:** adversarial is NOT a renamed clone of happy-path. Each TA-NN attacks an inversely-shaped weakening vector. Step 0.5 anti-clone gate **PASS**.

### Fails-on-revert verification at HEAD `999881f9` (tester-performed)
Two `[FAILS-ON-REVERT KEY]` anchors in the adversarial. Both independently verified by this tester pass:

**TA-02 — strict-equality guard weakening:**
- **Revert applied:** edited `AppHandlers.tsx` line 509 from `preferences.useGpsLocation === true &&` → `preferences.useGpsLocation &&` (truthy gating).
- **Post-revert output:**
  ```
  FAIL TA-02 [FAILS-ON-REVERT KEY] setQueryData guard uses strict `useGpsLocation === true` only — no weakened truthy gating
       ↳ ... Offending lines: ["        preferences.useGpsLocation &&"]. Weakening this guard would let custom-location users get GPS coords written to their cache slot, breaking their saved address.
  FAIL — ORCH-0904 adversarial regression check: 7/8 GREEN, 1 RED.
  ```
- **Restore:** reverted line 509 back to `preferences.useGpsLocation === true &&`.
- **Post-restore:** 8/8 GREEN.

**TA-04 — try/catch removal:**
- **Revert applied:** removed the `try {` and `} catch {}` wrapping in `PreferencesSheet.tsx` solo branch around lines 914-923. GPS-resolve call now bare.
- **Post-revert output:**
  ```
  FAIL TA-04 [FAILS-ON-REVERT KEY] Solo branch wraps GPS-resolve in try/catch AND still calls onSave after a GPS failure
       ↳ ... hasTry=false, hasCatchAfterTry=false, onSaveStillRuns=false.
  FAIL — ORCH-0904 adversarial regression check: 7/8 GREEN, 1 RED.
  ```
- **Restore:** put the try/catch back.
- **Post-restore:** 8/8 GREEN.

Both anchors confirmed exercise the bug — adversarial gate is real, not vacuous.

### Append-only / TEST-MOD-APPROVED token
Both regression files are NEW (no pre-existing `orch-0904-*` files). No append-only token required.

### Both tests in closing diff
- Implementor's `orch-0904-regression-check.mjs` already shipped in commit `999881f9`.
- Tester's `orch-0904-adversarial-check.mjs` will be staged + committed by orchestrator CLOSE (this tester pass stages the file; orchestrator commits per pipeline split).

If orchestrator dispatches CLOSE-without-commit, advise opening a follow-up commit to land the adversarial file in the same `Seth`→`main` PR — both tests MUST appear in `git diff origin/main...HEAD --name-only` for the closing PR per ORCH-0840 Step 0.5 sub-rule 3.

---

## §6 — Live-fire sim gate (Phase 0.A)

### Attempt log

1. **iOS Simulator** (`xcrun simctl list devices booted`): iPhone 17 Pro (UDID `17091E60-C3B6-4167-980D-60C348E177F6`) is booted. Mingla bundle `com.mingla.app.v2` is installed.
2. **Launch attempt** (`xcrun simctl launch 17091E60-C3B6-4167-980D-60C348E177F6 com.mingla.app.v2`): launched PID 46537.
3. **Screenshot** captured at `Mingla_Artifacts/evidence/orch-0904/ios_sim_blocker_wrong_binary.png`. **Result:** the installed binary is the **`mingla-business`** app (BrandDeleteSheet.tsx, BrandStripeCountryPicker.tsx, account.tsx in the call stack), NOT the `app-mobile/` consumer app under test. The bundle ID `com.mingla.app.v2` is shared between the two apps' Expo configs (`app-mobile/app.json` AND `mingla-business/app.json`); whichever app was last built + installed claims that slot.
4. Additionally the business binary is crashing on `react-native-keyboard-controller` not linked — this is unrelated **ORCH-0892-B [SmartScrollView keyboard avoidance sweep]** WIP state from another active branch.
5. **Android Emulator:** `adb devices` empty. AVD `Pixel_8_Pro` exists but not booted. Cold boot + consumer-app APK install would be a separate multi-step path.

### Blocker classification

`probable` confidence (sim attempt was made, blocker is specifically named). Two stacked blockers prevent direct post-fix behavior verification on sim:

- **B1 (iOS):** consumer-app dev build is NOT the binary on the sim. To run post-fix behavior on iOS, operator (or a tester re-dispatch) must execute the rebuild from `app-mobile/` per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (three-step `xcodebuild` → manual `Pods-mingla-frameworks.sh` → `codesign --force --sign -` on every embedded framework + main binary + .app bundle). NOT `npx expo run:ios` per the codified runbook + memory `feedback_sim_test_drivers_maestro_default.md`.
- **B2 (Android):** Pixel_8_Pro AVD is shut down + EAS-built consumer-app APK install needed. `adb devices` empty.

### Tester unblock request (specific, actionable)

Per memory `feedback_tester_canonical_and_platform_parity.md`: "When blocked (missing simulator, auth state, deploy gap, credentials), tester MUST ask operator with specific actionable unblock request — NOT silently CONDITIONAL PASS."

**Specific ask:** Seth, please run the 8-step Simulate-Location smoke from SPEC §5.4 yourself on:
1. iOS Simulator (UDID `17091E60-C3B6-4167-980D-60C348E177F6`) with a fresh `app-mobile/` dev build per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md`.
2. Android Emulator (`Pixel_8_Pro` AVD) after `emulator @Pixel_8_Pro` boot + `eas build --platform android --profile development` install (or any equivalent post-fix consumer-app APK).

The exact 8 steps are encoded as numbered smoke bullets in §9 below.

### Why this is `probable` not `proven`

Phase 0.A ladder:
- `proven` requires live-fire repro performed + fix verified on the same sim/emu — **NOT** achievable in this session due to B1 + B2.
- `probable` requires sim attempt + blocker named + Case-B step for unblock — **achieved.**
- `suspected` is the ceiling for source-only reasoning — **exceeded** (regression suites + adversarial fails-on-revert add observational evidence beyond pure reading).

CONDITIONAL PASS is the maximum verdict gate Phase 0.A allows at `probable` confidence, conditional on operator-accepted deferral. The structural regression coverage (16/16 GREEN tests across 8 distinct vectors) is uncommonly strong evidence for a structural bug class like this.

---

## §7 — Parity check (solo + collab + iOS + Android)

| Axis | Pre-fix | Post-fix | Verified by |
|---|---|---|---|
| Solo vs collab | Asymmetric — collab snapshotted fresh GPS at Apply; solo did NOT | Symmetric — both branches snapshot fresh GPS when `useGpsLocation && X?.lat == null` | TA-01 (2 distinct call sites) + TA-08 (both guards present) + TA-06 (solo sequencing) |
| iOS vs Android | Bug present on both | Fix present on both (shared RN code) | Source — single code path in `app-mobile/src/components/` ships to both. Sim live-fire BLOCKED per §6. |
| GPS-mode vs custom-location | N/A | GPS-mode users benefit; custom-location users untouched | TA-02 [FAILS-ON-REVERT KEY] strict-equality guard + T-08 |

---

## §8 — Discoveries for orchestrator

| ID | Severity | Discovery | Recommended action |
|---|---|---|---|
| D-QA-1 | **P3** | `RecommendationsContext.tsx` defaults `propCurrentMode` to `"solo"` (line 168). The literal `'solo'` in `AppHandlers.tsx:514` setQueryData tuple is correct ONLY for solo Apply. If a future ORCH adds a collab-Apply path that also threads `freshGpsLat`/`Lng` (e.g. widening ORCH-0904 to address D-4 from the investigation), the literal `'solo'` will write to the wrong cache slot for collab users. Either: (a) replace literal with a `currentMode` runtime value, or (b) explicitly document the solo-only contract above the setQueryData call. | Register as a follow-up ORCH if D-4 ever gets widened. Otherwise informational. |
| D-QA-2 | **P4** | `app-mobile/src/components/AppHandlers.tsx:419` types the `preferences` parameter as `any`. The `freshGpsLat`/`Lng` fields therefore pass through without TypeScript visibility. Pre-existing pattern, not introduced by ORCH-0904; flagged for future tightening. | Informational. P4 cleanup whenever the `AppHandlers` types get the strict-mode pass. |
| D-QA-3 | **P4** | Both `app-mobile/app.json` and `mingla-business/app.json` claim `com.mingla.app.v2` as bundle ID. On a single iOS simulator, whichever app was last installed claims the slot, making it ambiguous which binary you're actually testing. This stomped tester's sim-launch attempt for ORCH-0904. Pre-existing config collision unrelated to this ORCH; relevant context for any future tester. | Surface to orchestrator. Could register as a separate ORCH-#### [Bundle-ID collision between consumer-app and mingla-business simulators]. Out of scope here. |

Carried-forward from investigation §10 / implementation §11 (D-1, D-2, D-3, D-4): unchanged — informational + P3 follow-ups, no new severity.

---

## §9 — Smoke-test for operator (the iOS/Android live-fire gate)

Pre-requisite (Step 0):
- Branch `Seth` at commit `999881f9` or later checked out.
- Both regression suites GREEN: `node app-mobile/scripts/ci/orch-0904-regression-check.mjs && node app-mobile/scripts/ci/orch-0904-adversarial-check.mjs` (tester verified, both 8/8).

The 8-step Simulate-Location smoke (run on BOTH iOS Sim + Android Emu):

1. **Rebuild the consumer-app iOS dev build** per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (three-step `xcodebuild` → `Pods-frameworks.sh` env-var invocation → `codesign --force --sign -` chain). Install on `17091E60-C3B6-4167-980D-60C348E177F6`. Boot Metro from `app-mobile/`. **Do NOT use `npx expo run:ios`** — Expo CLI v54 + Xcode 26 devicectl regression misroutes simulator UDIDs to physical-device code-signing.
2. Sign in as a real Mingla account with `use_gps_location=true` already set. If onboarding is needed, complete it and verify the preferences sheet shows "Use my location" as ON.
3. In Xcode: Debug → Simulate Location → Custom Location… → enter `(6.5244, 3.3792)` (Lagos). The sim's GPS now reports Lagos.
4. In Mingla, open the preferences sheet. Tap Apply. Wait for the deck to refetch. **Note the first 3-4 card titles** (Lagos-area venues). Take a screenshot named `ios_pre_lagos_<timestamp>.png` into `Mingla_Artifacts/evidence/orch-0904/`.
5. Within 5 minutes, WITHOUT reloading the app, switch Xcode → Debug → Simulate Location → Custom Location… to `(6.6, 3.5)` (~30 km away in the same metro area). The sim's GPS now reports the new point.
6. Open the preferences sheet again. Make NO preference changes. Tap Apply. Wait for refetch. **Compare the new card titles** to the Lagos-anchored set.
7. **Expected post-fix:** cards re-anchor to the (6.6, 3.5) point — different venue set, shorter Distance values to the new location. Take screenshot `ios_post_offset_<timestamp>.png`.
8. **Repeat on Android Emulator** (`emulator @Pixel_8_Pro`, install consumer-app APK, Extended Controls → Location → set custom coords for steps 3 + 5, screenshot `android_pre_*.png` + `android_post_*.png`).

Verdict promotion: if BOTH iOS and Android show post-fix re-anchoring, CONDITIONAL PASS → PASS and CLOSE protocol fires.

If EITHER platform fails to re-anchor: regression. Revert PR, mark FAIL, re-dispatch to implementor.

---

## §10 — Next-step routing

Per Phase 0.A verdict ladder:
- **CONDITIONAL PASS with `probable` confidence** is the maximum without operator's live-fire smoke.
- Operator runs §9's 8-step smoke; on successful verification, the orchestrator promotes to PASS and runs the standard CLOSE protocol (Step 0.5 regression gate already satisfied by this report).
- On smoke failure: orchestrator re-dispatches to implementor with the failure mode named.

EAS OTA publish (`cd app-mobile && eas update --branch production --platform ios,android --message "..."`) MUST wait for full PASS — do not OTA on CONDITIONAL.

---

## §11 — Files this report assesses

- `app-mobile/src/components/PreferencesSheet.tsx` — modified at commit `999881f9` (solo branch GPS-snapshot block, lines 905-934)
- `app-mobile/src/components/AppHandlers.tsx` — modified at commit `999881f9` (setQueryData block + comment, lines 498-517)
- `app-mobile/src/hooks/useUserLocation.ts` — UNCHANGED (verified via `git diff 999881f9^..999881f9` empty)
- `app-mobile/scripts/ci/orch-0904-regression-check.mjs` — NEW at commit `999881f9` (implementor happy-path)
- `app-mobile/scripts/ci/orch-0904-adversarial-check.mjs` — NEW in THIS QA pass (tester adversarial)
- `app-mobile/package.json` — modified at commit `999881f9` (`test:orch-0904` script entry)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0904_SOLO_MODE_STALE_GPS.md` — reviewed and audited
- `Mingla_Artifacts/specs/SPEC_ORCH-0904_SOLO_MODE_STALE_GPS.md` — used as binding contract for SC traceability

---

**End of QA report.**
