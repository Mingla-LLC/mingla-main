# QA — ORCH-1362 [onboarding-location]

**Verdict: CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 1 (SC-6 runtime unproven — credential-walled) · P3: 0 · P4: 2
**Regression gate:** SATISFIED — implementor happy-path (fails-on-revert reproduced) + tester adversarial (different angle, on-branch, in-diff, fails-on-revert) both present.
**Confidence:** source mechanism `proven-in-source` (airtight); app-boots-clean `proven` (runtime); onboarding-panel SC-6 `probable` (live-fire ATTEMPTED, blocked by an Apple/Google credential wall — NOT source-only).

Branch `1362-onboarding-location` @ `1a27a8c71` (tester commit) on top of impl `f32b231a6`. Rebased on `origin/main` (0 behind). Client-only, OTA-able; no edge deploy, no migration.

> **CONDITIONAL, not PASS, because** SC-6 (the dispatch's make-or-break) demands runtime proof and could not be runtime-proven: the onboarding location panel sits behind a social-auth credential wall (see §7). The code is correct at every layer I could inspect and the exact worktree bundle boots + runs the whole app on iOS with no crash — but the specific panel needs a physical-device HITL smoke (or Seth-supplied auth) before CLOSE. **Do not route to CLOSE until that smoke passes or Seth explicitly accepts the deferral.**

---

## 1. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1-iOS | "lekki" → multi-row list, Lekki Lagos #1, POIs absent | **BLOCKED (probable)** | Routes through DEPLOYED `suggest_places` (ORCH-1365, live-proven). Panel unreachable at runtime — auth wall (§7). Source: correct engine wired. |
| SC-1-Android | same | **BLOCKED (probable)** | Same wall; Android emulator not booted (would hit the identical auth wall). |
| SC-2 | "lekki nigeria" → Lekki Lagos #1 (trailing-country strip) | **BLOCKED (probable)** | Inherited from `suggest_places` (no new code); runtime panel unreachable. |
| SC-3 | Preferences/CityPicker byte-identical (default gorhom) | **PASS (source, high)** | 0 source diff on both hosts; they pass no `inBottomSheet` → default `true` → gorhom still injected. Companion T-3 + tester A-1b + the still-green ORCH-1365 suite (8/8). |
| SC-4 | No proximity threaded | **PASS (source)** | No `proximity` prop on the onboarding field; T-7 + tester A-4 assert absence. |
| SC-5-iOS/Android | Pick writes `data.coordinates` + `data.manualLocation`; confirm advances | **BLOCKED (probable)** | `handlePickLocationDetails` maps `PlaceDetails.location`→`selectedLocation.location`; unchanged `handleManualLocation` reads it (verified in source, T-4/T-5, tester A-3 join). Runtime advance credential-walled. |
| SC-6-iOS | No gorhom crash on the plain screen; card list scrolls | **BLOCKED (probable) — MAKE-OR-BREAK** | Source-airtight: with `inBottomSheet={false}` the wrapper passes `undefined` → shared field falls back to `RNTextInput`/`RNScrollView` (packages/location-input/src/MapboxAddressInput.tsx:177,493); NO other gorhom node exists in wrapper or shared field (tester A-1/A-1b). App boots + runs the worktree bundle with no crash. **Panel itself not rendered — auth wall.** |
| SC-6-Android | same | **BLOCKED (probable)** | Same; emulator not booted (auth wall is platform-independent). |
| SC-7 | Restore prior `manualLocation` chip | **PASS (source)** | `selectedLocation` + `initialData.manualLocation` restore unchanged (OnboardingFlow.tsx:928-933). |
| SC-8 | No paywall (pre-account) | **PASS (source)** | No I-1315 paywall imported/added to this field. |

**Nested-scroll caveat (the one thing source cannot fully close):** SC-6 also asserts the card list SCROLLS inside the onboarding shell's plain `ScrollView` (nested RN ScrollView). The no-crash half is source-airtight; the nested-scroll behavior is the residual runtime risk that the HITL smoke must confirm.

---

## 2. Findings

### P2-1 — SC-6 not runtime-proven (credential-walled), the dispatch's make-or-break
- **Evidence:** The onboarding no-GPS panel is reachable only after social auth. `src/components/signIn/WelcomeScreen.tsx` offers ONLY Continue-with-Apple / Continue-with-Google (no phone-first, no dev bypass). Sign in with Apple → native "Apple Account — Enter the password for sethogieva@icloud.com" prompt (`evidence/ORCH-1362/ios_auth_wall_apple_password_blocker.png`). The phone-OTP bypass (+12015550199) is an in-onboarding substep reached only AFTER social auth creates the account.
- **Impact:** Cannot render the `inBottomSheet={false}` panel on-device in a non-interactive session; cannot supply Seth's Apple/Google credentials. The no-crash MECHANISM is airtight in source and the exact bundle boots clean, but the panel render + nested-scroll are unproven.
- **Required fix (verification, not code):** Physical-device HITL smoke by Seth (steps in §7) OR Seth's explicit acceptance of the deferral, before CLOSE.
- **Retest:** Drive the real onboarding to the location step, tap "type your city", confirm the field renders (no red-box gorhom "used outside BottomSheet"), type "lekki", confirm a multi-row list scrolls with Lekki Lagos #1, pick it, confirm advance.

### P4-1 (praise) — clean subtract-before-add
Net −139 lines; the entire hand-rolled debounce/dropdown/17-styles removed and replaced by the shared engine. Dead state/effect/handler/import all excised. Constitution rule 8 exemplary.

### P4-2 (Discovery, dev-only, NOT ORCH-1362) — PostHog LogBox in dev
`postHogService.ts:173` throws a dev LogBox "You must pass your PostHog project's api key. The client will be disabled." — the PostHog key is absent in the dev env. Non-fatal, unrelated to this ORCH. Filed as a Discovery for the orchestrator.

---

## 3. Constitution 14-rule matrix (vs the diff)

| # | Rule | Result |
|---|------|--------|
| 1 | No dead taps | PASS — `onPick`/`onClear`/confirm all wired to handlers. |
| 2 | One owner per truth | PASS — `selectedLocation` single owner; shared field owns suggestion state. |
| 3 | No silent failures | PASS — shared field owns offline/no-results copy; mapper doesn't swallow. |
| 4 | One query key per entity | N/A — no query keys touched. |
| 5 | Server state server-side | N/A — no Zustand server state. |
| 6 | Logout clears everything | N/A (not touched; incidentally exercised logout OK at runtime). |
| 7 | `[TRANSITIONAL]` labelled | N/A — none introduced. |
| 8 | Subtract before adding | PASS — net −139; dead code removed. |
| 9 | No fabricated data | PASS — real `suggest_places` rows; no fakes. |
| 10 | Currency-aware | PASS — `handleManualLocation` locale-detect path preserved. |
| 11 | One auth instance | N/A. |
| 12 | Validate at right time | N/A. |
| 13 | Exclusion consistency | N/A. |
| 14 | Persisted-state startup | PASS — `manualLocationText`/`selectedLocation` restore preserved. |

No violations → no auto-P0.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Reproduced on HEAD (`1a27a8c71`) by true line-deletion of the fix lines `inBottomSheet={false}` + `searchMode="places"` (OnboardingFlow.tsx:2799-2800):
- Result: **T-1 FAILED + T-6 FAILED** (5 passed / 2 failed). Exact failing assertion: `to contain: "searchMode="places"": onboarding must be on the places engine`.
- Restored via `git checkout -- OnboardingFlow.tsx` → **7 passed / 0 failed**.
Matches the implementor's claim in IMPLEMENTATION_ORCH-1362 §6.

---

## 5. Tester adversarial test added

- **Path:** `app-mobile/src/components/__tests__/orch-1362-onboarding-location-adversarial.test.tsx` (NEW, append-only, Deno source-structure).
- **Angle (different from the implementor's happy-path suite):**
  - **A-1** the CONSUMER link of the no-crash chain — the shared field falls back `TextInputComponent ?? RNTextInput` / `ScrollComponent ?? RNScrollView` AND imports no `@gorhom/bottom-sheet` itself (so `inBottomSheet={false}` can never mount a gorhom node). The implementor tests only the wrapper (producer) side.
  - **A-1b** wrapper renders only `<SharedMapboxAddressInput>`, no gorhom node of its own.
  - **A-2** `displayName` precedence is **city-FIRST** (`details.city || details.formattedAddress`) — order-sensitive; a flip to `formattedAddress||city` passes the implementor's presence-only T-4 yet shows a POI address. **fails-on-revert.**
  - **A-3** producer↔consumer coordinate **key-path join** — mapper writes `selectedLocation.location.{lat,lng}`; unchanged confirm reads the SAME path. **fails-on-revert.**
  - **A-4** onboarding host imports no `@gorhom/bottom-sheet` and wraps the field in no `<BottomSheet*>` node.
- **fails-on-revert verified at `1a27a8c71`:** reverting `handlePickLocationDetails` to the pre-1362 `setSelectedLocation(suggestion)` → **A-2 + A-3 FAIL (3 passed / 2 failed)**; restored → **5/5 green**.
- **Committed + CI-registered:** in the ORCH-1362 Deno job `DENO_TEST_FILES` + both push/PR paths filters.
- **Closing diff contains BOTH** the implementor happy-path (`orch-1362-onboarding-location-places.test.tsx`) AND this adversarial file — confirmed in `git diff origin/main...HEAD --name-only`.

**Full Deno battery:** 7 (places) + 5 (adversarial) + 8 (ORCH-1365) = **20 passed / 0 failed**. Append-only gate: **3 passed / 0 failed** (both ORCH-1362 files ADDED; ORCH-1365 1-line mod carries `[TEST-MOD-APPROVED ORCH-1362]` in HEAD commit body). tsc clean on the 2 touched source files.

---

## 6. Device / parity matrix

| Surface | Ships here | Result | Note |
|---------|-----------|--------|------|
| Consumer iOS (`app-mobile`) | YES | **PARTIAL** | Worktree bundle boots + runs whole app, no crash (Explore/Profile/SignOut/WelcomeScreen). SC-6 panel credential-walled → probable. |
| Consumer Android (`app-mobile`) | YES | **BLOCKED** | Emulator not booted; auth wall is platform-independent (same blocker). Capped. |
| Buyer/anon Web | NO | N/A | No onboarding/location autocomplete. |
| Business iOS/Android | NO | N/A | `suggest`/`buildSuggestUrl` path never imported here (INV-3/ORCH-1079). |
| Admin Web | NO | N/A | No location search. |
| Business Web preview | NO | N/A | No location search. |

**Physical-iPhone HITL:** NOT yet performed — this is a sub-agent (final message = report); HITL steps emitted in §7 for Seth/orchestrator to run.

**Live edge-fn state:** `suggest_places` on `mapbox-geocode` already deployed by ORCH-1365 (`verify_jwt=true`); this ORCH deploys nothing. Correct.

---

## 7. HITL smoke (physical iPhone) — the ONE thing needed to clear SC-6

1. Open Mingla (consumer) on a device with a Mingla account signed in. Go to Profile → Sign Out (fresh onboarding), OR use a device where you can complete Apple/Google sign-in for a new account.
2. Progress onboarding to the **location** step. Turn Location Services OFF for Mingla (or tap the "type your city / enter manually" link) to reveal the "Choose your city" panel.
3. **Confirm the field RENDERS with no red-box** "BottomSheetScrollView/BottomSheetTextInput cannot be used outside a BottomSheet" (SC-6 no-crash).
4. Type **"lekki"** → confirm a **multi-row** list with **Lekki, Lagos, Nigeria at #1**, POIs absent (SC-1). Clear, type **"lekki nigeria"** → same #1 (SC-2). **Scroll the card list** — it must scroll inside the plain screen (SC-6 scroll).
5. Pick Lekki Lagos → chip shows **"Lekki"** (city, not a full address) → tap confirm → onboarding **advances** (SC-5).

Report the result; if all pass → PASS → CLOSE. If the red-box appears or the list doesn't scroll → FAIL → REWORK.

---

## 8. Discoveries for Orchestrator

- **Worktree native-bundling hazard (reusable):** `app-mobile/node_modules` in the per-ORCH worktree was a SYMLINK to the anchor → Metro realpath-escape (`Unable to resolve ./mingla-main/app-mobile/node_modules/expo-router/entry`) on BOTH web and dev-client. Fixed by replacing the symlink with a real rsync copy of the anchor node_modules (gitignored; version-parity with the installed native binary). This matches the documented "OTA/export from worktree needs a real node_modules" memory. The worktree is now left with a real `node_modules` (a gitignored build artifact — does not affect the branch/PR/CLOSE).
- **PostHog dev LogBox** (P4-2) — dev-env only, unrelated to ORCH-1362.
- **`[TEST-MOD-APPROVED ORCH-1362]` token** now lives in HEAD (`1a27a8c71`) so the append-only gate is green at PR time. If the orchestrator squashes/re-commits at CLOSE, ensure the token survives in the final HEAD commit body.

---

## 9. Accepted conditions (CONDITIONAL PASS)

**Not yet accepted.** The single open condition is the SC-6 runtime smoke (§7). Route to Seth for either the HITL result or explicit deferral acceptance (as a follow-up `ORCH-#### [label]`), NOT directly to CLOSE.
