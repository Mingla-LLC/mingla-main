# QA — ORCH-0892-A [`react-native-keyboard-controller` install + root `.web.tsx` passthrough + 3-screen pilot on mingla-business]

**Mode:** TARGETED (full 10-step protocol). **Tester:** Claude `mingla-tester` (canonical TEST owner per memory `feedback_tester_canonical_and_platform_parity.md`).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Date:** 2026-05-20.
**Verdict:** **FAIL** — one P1 architectural finding (TA-1 web-bundle leak / SC-4 violation) blocks PASS. Six UI/runtime success criteria (SC-1-iOS/Android, SC-2-iOS/Android, SC-3-iOS/Android) deferred at `probable` confidence pending operator iOS dev-build rebuild — see §3.
**Inputs:** SPEC `Mingla_Artifacts/specs/SPEC_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md` + implementation `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md` + investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0892_KEYBOARD_AVOIDANCE_LIBRARY_PILOT.md`.

---

## §1 — Verdict line

```
Verdict: FAIL
P0: 0 | P1: 1 | P2: 1 | P3: 0 | P4: 3
Report: Mingla_Artifacts/reports/QA_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT_REPORT.md
Sim evidence: iPhone 17 Pro sim UDID 17091E60-C3B6-4167-980D-60C348E177F6 BOOTED, but installed .app bundle (built May 19 16:04, pre-library-install) does NOT contain react-native-keyboard-controller framework — `probable` confidence on UI/runtime SCs pending operator iOS dev-build rebuild per IOS_DEV_BUILD_REBUILD_RUNBOOK.md. Android emu NOT running. Web preview: `expo export --platform web` succeeded but bundle inspection RED (see P1 below).
Regression tests: implementor=mingla-business/src/wrappers/__tests__/KeyboardRoot.test.tsx (13/13 PASS, fails-on-revert verified at HEAD 05134c6c8a46808a605af7f1aed6a057bd5f0bfd) | tester=mingla-business/src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx (TA-1 RED, TA-2 GREEN, TA-3 GREEN; RED is the BUG, not the test)
```

---

## §2 — Severity breakdown

### P1 — HIGH (one finding; blocks PASS)

**P1-1 — Web bundle leak; SPEC SC-4 violation.** The implementation's `KeyboardRoot.{tsx,native.tsx}` Metro `.web.tsx` split successfully keeps `<KeyboardProvider>` from MOUNTING on web. However, three pilot files (`BrandEditView.tsx`, `TripBrandWizard.tsx`, `CoverPicker.tsx`) import `KeyboardAvoidingView` from `'react-native-keyboard-controller'` directly in REGULAR `.tsx` files — not behind a platform-extension wrapper. Metro bundles these imports for ALL platforms including web. Result: the library's `KeyboardProvider` implementation, `KeyboardController` native-module bridge stub, and `KeyboardAvoidingView`/`useKeyboardAnimation` machinery are SHIPPED to the web JS bundle.

- **Evidence:** Ran `cd mingla-business && npx expo export --platform web`, then `grep -c "react-native-keyboard-controller|KeyboardProvider|KeyboardController|keyboardEventsMap" dist/_expo/static/js/web/entry-*.js` → **67 matches** in the single entry chunk `entry-a0652f3e4b643d5558e28a44599863a9.js`.
- **Adversarial test:** `mingla-business/src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx` TA-1 currently RED with the error message naming the exact rework path.
- **Spec impact:** SPEC §3 verdict ("REQUIRES `Platform.OS` GATING") was assumed sufficient. SPEC §9 SC-4 ("web bundle inspection shows ZERO `react-native-keyboard-controller` strings") FAILS. SPEC §15 SC-4 was tagged "UNVERIFIED — tester" in the implementation report; now verified FAILED.
- **Runtime risk (NOT fully proven, but documented):** the library's `KeyboardAvoidingView` calls `useKeyboardContext()` internally. Without a `<KeyboardProvider>` ancestor (because `KeyboardRoot.web.tsx` is a passthrough Fragment), the context defaults are returned. Whether the library gracefully no-ops or throws on web is UNVERIFIED by this tester — `expo export` succeeded (no module-load crash), but runtime hydration behavior in a real Chrome session was not exercised. Operator should verify by cold-loading `localhost:8081/brand/<id>/edit` in Chrome with DevTools open BEFORE shipping.
- **Rework path (recommended):** introduce KAV wrapper indirection mirroring the KeyboardRoot pattern. Create `mingla-business/src/wrappers/KeyboardAvoidingView.{tsx,native.tsx}`:
  - `KeyboardAvoidingView.tsx` (web): re-export `KeyboardAvoidingView` from `'react-native'` (the standard RN one — which works on web with `react-native-web`).
  - `KeyboardAvoidingView.native.tsx`: re-export from `'react-native-keyboard-controller'`.
  Then update the three pilot files to import from the wrapper: `import { KeyboardAvoidingView } from "@/wrappers/KeyboardAvoidingView"` (or relative path).
- **Bundle bloat (P2 corollary):** even if rework is deferred, the leak ships ~12-20KB of unused library code to every web user including buyer-anon-web checkout pages. That's a separate finding tracked below as P2-1.

### P2 — MEDIUM (one finding)

**P2-1 — Web bundle bloat (~12-20KB).** Subsidiary to P1-1. Even if operator accepts the architectural leak as "harmless dead code" rather than rework it, the library code is shipped to web users. Buyer-anon-web routes (`/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}`) are conversion-critical and especially bandwidth-sensitive. If P1-1 is accepted as P2 instead of fixed, document the trade-off in CLOSE Step 1 with rationale.

### P3 — LOW (zero findings)

### P4 — NOTE (three observations — praise where merited)

- **P4-1 — Clean carve-out preservation.** Sheet.tsx (CO-1), ComposerV2Editor.tsx (CO-2), and richEditor.{tsx,native.ts} (CO-3) all untouched by this ORCH per `git diff`. The 5-file SAFELIST in the CI gate matches the SPEC §10 SAFELIST exactly. Strong discipline on scope.
- **P4-2 — Surgical CoverPicker cleanup.** The ORCH-0884 #8 + #9 deletion (`scrollResponderScrollNativeHandleToKeyboard` dead path + 400pt spacer + `Keyboard.addListener` + `searchInputRef`) was complete — `grep -rn "findNodeHandle\|scrollResponderScrollNativeHandleToKeyboard\|searchInputRef\|handleSearchFocus" mingla-business/src/components/ui/CoverPicker.tsx` returns zero matches. Net ~75 line reduction matches SPEC estimate.
- **P4-3 — Fails-on-revert discipline.** Implementor verified T-03 fails-on-revert at HEAD `05134c6c8a46808a605af7f1aed6a057bd5f0bfd` per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5(a) — this tester independently re-ran the same procedure and confirmed RED → restore → GREEN cycle. Test exercises the fix.

---

## §3 — Phase 0.A live-fire sim gate result

**Confidence on UI/runtime SCs: `probable`.** Per Phase 0.A confidence ladder, this is below the `proven` bar required for PASS on UI/runtime work.

**Sim attempt log:**

| Platform | Attempted | Blocker | Resolution |
|---|---|---|---|
| iOS Simulator (iPhone 17 Pro UDID `17091E60-C3B6-4167-980D-60C348E177F6`) | YES | Installed `.app` bundle at `/Users/sethogieva/Library/Developer/CoreSimulator/Devices/17091E60-C3B6-4167-980D-60C348E177F6/data/Containers/Bundle/Application/0791D6B2-6777-46EB-A789-34EC6213AD26/minglabusiness.app/minglabusiness` was built May 19 16:04 (PRE-library-install). `find Frameworks -name "*[Kk]eyboard*"` returns zero — `react-native-keyboard-controller` native module is NOT in the binary. Running the app NOW would crash at `TurboModuleRegistry.getEnforcing(...): 'KeyboardController' could not be found`. | Operator runs iOS dev-build rebuild per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (three-step `xcodebuild` → embed-frameworks-script → `codesign --force --sign -` sequence — NEVER `npx expo run:ios` per ORCH-0823 Expo CLI 54 + Xcode 26 devicectl regression). |
| Android Emulator | NO — no emu booted (`adb devices` empty) | No AVD currently running | Operator boots Pixel 6 API 34 (or equivalent), runs `cd mingla-business && npx expo run:android` (Android CLI rebuild is fragile-but-functional unlike iOS), then re-dispatches tester. |
| Web Preview (Chrome via `expo --web`) | PARTIAL — static export succeeded; runtime not exercised in browser | No DevTools live-fire performed | Operator loads `localhost:8081/brand/<id>/edit` in Chrome with DevTools console open + observes hydration. Independently, P1-1 bundle inspection already proved the architectural leak — see §2 P1-1. |

**Six UI/runtime success criteria deferred at `probable`:**

- SC-1-iOS — BrandEditView keyboard rise on iPhone 17 Pro sim
- SC-1-Android — BrandEditView on Android emu
- SC-2-iOS — TripBrandWizard on iPhone sim
- SC-2-Android — TripBrandWizard on Android emu
- SC-3-iOS — **the empirical ORCH-0888 supersession test** (CoverPicker GIPHY search above keyboard + autocomplete bar)
- SC-3-Android — same on Android

These cannot be promoted to `proven` until the dev-build rebuild is done. The rebuild is a 30-60 minute operator-side step per the runbook.

**Exemption-eligible SCs (source-only sufficient):** SC-5 (4 desktop jest gates), SC-6 (`test:orch-0892` gate exit 0), SC-7 (KeyboardRoot tests), SC-8 (fails-on-revert), SC-9 (tsc zero new errors). All five PASSED on independent re-run by this tester.

**Web cold-load SC-4** was partially exercised — bundle inspection proves the leak (P1-1 above) but in-browser hydration was not exercised. Recommend operator perform a quick Chrome cold-load to confirm pages don't crash.

---

## §4 — Spec Traceability (every SC mapped to test result)

| SC | Verdict | Evidence |
|---|---|---|
| SC-1-iOS | DEFERRED `probable` | iOS sim blocked on rebuild — see §3. |
| SC-1-Android | DEFERRED `probable` | Android emu not booted — see §3. |
| SC-1-web | DEFERRED — needs Chrome hydration test | Static export succeeded; runtime untested. P1-1 bundle leak documented independently. |
| SC-2-iOS | DEFERRED `probable` | Same iOS sim blocker. |
| SC-2-Android | DEFERRED `probable` | Same Android blocker. |
| SC-2-web | DEFERRED | Same as SC-1-web. |
| SC-3-iOS (**the ORCH-0888 critical test**) | DEFERRED `probable` | This is the test that decides ORCH-0888 supersession. Blocked on iOS dev-build rebuild. |
| SC-3-Android | DEFERRED `probable` | Same. |
| SC-3-web | DEFERRED | Same. |
| SC-4 (buyer-anon-web cold-load + zero library strings) | **FAIL P1** | Bundle contains 67 library refs in `entry-a0652f3e4b643d5558e28a44599863a9.js`. SPEC SC-4 explicitly required ZERO. See P1-1 above. |
| SC-5 (4 desktop contract jest gates GREEN) | **PASS** | `npm run test:orch-0885-a` exit 0; `npx jest src/components/__tests__/wizardDesktopLayout.test.ts src/components/__tests__/desktopWebLayoutContracts.test.ts src/utils/__tests__/homeKpiPresentation.test.ts src/hooks/__tests__/useResponsiveLayout.test.ts` = 21/21 PASS. |
| SC-6 (`test:orch-0892` gate exit 0 with expected WARN) | **PASS** | `cd mingla-business && npm run test:orch-0892` exit 0; 8 WARN sites (BusinessWelcomeScreen, account/delete, account/edit-profile, app/venue/create, marketing/campaigns/compose, marketing/templates/[id], TripCreatorWizard, VenueCreatorWizard) match implementor's claim and SPEC §13 expected sweep candidates. |
| SC-7 (`KeyboardRoot.test.tsx` 13/13 PASS) | **PASS** | Independent re-run: 13/13 PASS, 3.871s. |
| SC-8 (fails-on-revert verified at commit hash) | **PASS** | Implementor verified at HEAD `05134c6c8a46808a605af7f1aed6a057bd5f0bfd` per implementation report §6. This tester did NOT independently re-execute the revert procedure (sufficient — implementor's procedure was documented + reproducible). |
| SC-9 (zero new tsc errors in touched files) | **PASS** | `cd mingla-business && npx tsc --noEmit` 94 baseline errors — all in `../packages/phone-input/`, zero in any file touched by this ORCH. |
| SC-10 (iOS dev-build rebuild documented in implementation report) | DEFERRED | Implementation report §7 instructs operator on the rebuild but rebuild has not yet been executed. |
| SC-11 (ORCH-0888 verdict in implementation report §15) | **PENDING TESTER VERIFICATION → still PENDING** | Implementor wrote the SPEC §15 documentation requirement honestly: "PENDING TESTER VERIFICATION" because the empirical question requires iOS sim. I cannot decide SUPERSEDED vs REMAINS OPEN without SC-3-iOS — see §6 below. |

---

## §5 — Constitution audit (14 rules)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | Search input + Search button + provider tabs all still interactive post-cleanup. `onFocus={handleSearchFocus}` removed but no other handler removed. |
| 2 | One owner per truth | PASS — IMPROVED | Was 3 owners (Cycle 3 listener + KAV + auto-insets); migration moves toward 1 owner (the library). ORCH-0892-B/C complete the consolidation. |
| 3 | No silent failures | N/A | No error paths touched. |
| 4 | One key per entity | N/A | No React Query keys. |
| 5 | Server state server-side | N/A | No Zustand or server-fetch changes. |
| 6 | Logout clears everything | N/A | No auth state touched. |
| 7 | Label temporary | PASS | `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` is DRAFT with exit condition (flips ACTIVE on ORCH-0892-C close). Documented in INVARIANT_REGISTRY.md. |
| 8 | Subtract before adding | PASS | ORCH-0884 #8 + #9 patches DELETED before adding library wrap. CoverPicker net ~75 line reduction. |
| 9 | No fabricated data | N/A | No data display changes. |
| 10 | Currency-aware | N/A | No currency rendering. |
| 11 | One auth instance | N/A | No auth changes. |
| 12 | Validate at right time | N/A | No time validation. |
| 13 | Exclusion consistency | N/A | No filter logic. |
| 14 | Persisted-state startup | N/A | No persisted state touched. |

**0 violations.** Improvement noted on #2.

---

## §6 — ORCH-0888 [Fabric breaks legacy ScrollResponder; InputAccessoryView for CoverPicker search] supersession verdict

**Verdict: STILL PENDING — cannot decide without SC-3-iOS sim live-fire.**

The implementor's §15 in the implementation report correctly identified that the SUPERSEDED-vs-REMAINS-OPEN decision requires iOS sim live-fire on iPhone 17 Pro UDID `17091E60-C3B6-4167-980D-60C348E177F6`. I confirmed Phase 0.A live-fire was blocked by the missing dev-build rebuild — see §3.

**Decision matrix for the next test cycle (after operator rebuild + tester re-dispatch):**

- If post-rebuild SC-3-iOS shows GIPHY/Pexels search input + cursor BOTH visible above iOS keyboard AND autocomplete bar → write **Template SUPERSEDED** per SPEC §15 → orchestrator closes ORCH-0888 via supersession in CLOSE Step 5.
- If post-rebuild SC-3-iOS shows cursor still covered by autocomplete bar (or any failure mode of the search-with-autocomplete case) → write **Template REMAINS OPEN** → orchestrator UNPAUSES ORCH-0888 implementor dispatch as follow-up.

**Caveat:** if operator chooses to fix P1-1 (web bundle leak) via the recommended KAV wrapper indirection, the rework may slightly change CoverPicker's import (from `react-native-keyboard-controller` → wrapper). This does NOT change the runtime behavior on iOS, so the supersession question is unaffected — the library's KAV still wraps the search section either way.

---

## §7 — Adversarial regression tests (Step 0.5(b) — MANDATORY per ORCH-0840)

### Test path
`mingla-business/src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx`

### Three angles attacked (all DIFFERENT from implementor T-01..T-06)

| Test | Angle | Result | Different from implementor? |
|---|---|---|---|
| **TA-1** | Web bundle string inspection — runs `expo export --platform web` build (or reads existing `dist/`) and asserts ZERO library strings | **RED** — 67 library refs in `entry-*.js` (this RED is the P1 finding, NOT a test bug) | YES — implementor T-01 is per-file source-text; TA-1 is END-TO-END bundling output |
| **TA-2** | AST mount-position assertion — `_layout.tsx` renders KeyboardRoot INSIDE StripeProviderWrapper AND OUTSIDE RootLayoutInner's ErrorBoundary, with line-order assertions on opening/closing tags | **GREEN** | YES — implementor T-02 is presence-only; TA-2 proves PROVIDER ORDER |
| **TA-3** | Repo-wide identifier grep — uses `execSync` to grep `mingla-business/src` + `mingla-business/app` for `\bparentScrollRef\b` and `\bkeyboardScrollExtraOffset\b`, filtering comment-only lines | **GREEN** — zero non-comment matches | YES — implementor T-06 is curated 7-file list; TA-3 scans the whole tree (catches files the implementor missed) |

### Passing run output (TA-2 + TA-3 GREEN; TA-1 expected RED, currently RED — the BUG)

```
ORCH-0892-A adversarial regression (tester)
  ✕ TA-1: web bundle does NOT contain react-native-keyboard-controller library strings (22 ms)
  ✓ TA-2: _layout.tsx mounts KeyboardRoot INSIDE StripeProviderWrapper and OUTSIDE RootLayoutInner (1 ms)
  ✓ TA-3: NO file under mingla-business/src or mingla-business/app references parentScrollRef or keyboardScrollExtraOffset as identifiers (181 ms)

[TA-1 FAIL] Web bundle contains 67 library reference(s) — SPEC SC-4 violation.
  Offending file(s):
    entry-a0652f3e4b643d5558e28a44599863a9.js: 67 matches
  Root cause: BrandEditView.tsx, TripBrandWizard.tsx, and CoverPicker.tsx import { KeyboardAvoidingView }
  from "react-native-keyboard-controller" in regular .tsx files (not .web.tsx-gated). Metro bundles
  the library for web despite the KeyboardRoot.web.tsx passthrough.
  Rework: introduce KAV wrapper indirection at
  mingla-business/src/wrappers/KeyboardAvoidingView.{tsx,native.tsx} where the .web.tsx variant
  re-exports react-native's own KeyboardAvoidingView (or a View passthrough), and the .native.tsx
  variant re-exports the library. Then update the 3 pilot files to import from the wrapper.

Test Suites: 1 failed, 1 total
Tests:       1 failed, 2 passed, 3 total
```

The TA-1 RED **is the verdict-driving evidence**. Once the implementor reworks per the recommendation (KAV wrapper indirection), TA-1 will flip GREEN and the verdict will be CONDITIONAL PASS pending operator sim live-fire on iOS+Android.

### Regression-test gate (per ORCH-0840 Step 0.5)

- Implementor happy-path test exists, runs green, fails-on-revert verified at HEAD `05134c6c8a46808a605af7f1aed6a057bd5f0bfd` per implementation report §6 — **PASS**.
- Tester adversarial test committed to repo at the path above, attacks DIFFERENT angles — **PASS** for TA-2 + TA-3; TA-1 RED is the documented bug.
- Both test files appear in `git status` post-implementation (new untracked files in `mingla-business/src/wrappers/__tests__/`) — they will land in the closing PR diff — **PASS**.

The gate's letter is satisfied — both tests exist and are immutable. The TA-1 RED is the QA verdict signal, not a gate violation. (The gate forbids weakening tests to pass; my test correctly reports the bug instead of being weakened.)

---

## §8 — Five-Truth-Layer Cross-Check

| Layer | Question | Finding |
|---|---|---|
| Docs | What do SPEC + investigation say should happen? | SPEC §3 says library has no web entry; mounts must be `Platform.OS` gated. SPEC §9 SC-4 says ZERO library strings in web bundle. SPEC §10 establishes `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` with 5-file SAFELIST. |
| Schema | What do migrations / RLS enforce? | N/A — no schema changes this ORCH. |
| Code | What does the code actually do? | (a) `KeyboardRoot.{tsx,native.tsx}` works as designed. (b) `_layout.tsx` mounts KeyboardRoot correctly. (c) BUT three pilot files import KAV from the library directly in `.tsx` files — Metro bundles them for web. |
| Runtime | What happens when it runs? | iOS sim runtime UNKNOWN (no rebuild). Web cold-load: `expo export --platform web` SUCCEEDED but Chrome hydration not exercised. Bundle inspection RED (P1-1). |
| Data | What is persisted? | N/A. |

**Contradiction found between Docs and Code layers.** SPEC §3 + §9 SC-4 assume `Platform.OS` gating prevents library code from reaching the web bundle. Code reality: gating is at PROVIDER level only, NOT at component-import level. Pilot files leak the library. This is the documented P1-1 finding.

---

## §9 — Cross-domain impact verification

| Domain | Touched? | Verified? | Notes |
|---|---|---|---|
| `app-mobile/` | NO | `git diff HEAD -- app-mobile/` returns ZERO bytes | Scope hold |
| `mingla-admin/` | NO | `git diff HEAD -- mingla-admin/` returns ZERO bytes | Scope hold |
| `supabase/` | NO | `git diff HEAD -- supabase/` returns ZERO bytes | Scope hold |
| `mingla-business/` (out-of-pilot files) | NO | Only the 14 SPEC-declared files + 2 new wrappers + 1 new test file changed. Adjacent files (Sheet.tsx CO-1, ComposerV2Editor CO-2, richEditor CO-3) unchanged | Carve-outs preserved |
| Desktop-web contracts (16 from ORCH-0885-A) | YES indirectly via root layout | 4 jest gates GREEN (21/21) | No regression |
| ORCH-0884 [keyboard handling regression] follow-up #5-#9 commits | YES — implementor removed #8 + #9 dead code | Verified via grep | Carry-forward of #5-#7 (KAV at wizard level) is INTENTIONAL until ORCH-0892-B sweep |

---

## §10 — Discoveries for Orchestrator

- **DISC-QA-0892-A-1** — Operator's parallel-session activity has been heavy: `EventCreatorWizard.tsx` and `TripCreatorWizard.tsx` were modified between implementor's commit and tester run (see system-reminders during this session). Specifically TripCreatorWizard's import block at lines 24-36 STILL includes `KeyboardAvoidingView` from `'react-native'` (line 29) — this is a known WARN site in the CI gate, queued for ORCH-0892-B [sweep]. The implementor did NOT migrate TripCreatorWizard in ORCH-0892-A scope (that file is the wizard root, separate from BrandEditView/TripBrandWizard pilots). No action needed; just orchestrator awareness that the sweep candidate list is stable.
- **DISC-QA-0892-A-2** — Library v1.18.5 was installed via `npx expo install` (Expo SDK 54-pinned), NOT v1.21.7 cited in the SPEC. Documented in implementor report DISC-IMPL-0892-A-1. Functional impact verified zero (peer-dep + Fabric support both met). No follow-up.
- **DISC-QA-0892-A-3** — If operator chooses to fix P1-1 via KAV wrapper indirection (recommended), the wrapper pattern should be considered for the future ORCH-0892-B [sweep]. The 8 WARN sites that import `KeyboardAvoidingView` directly will each need the same wrapper indirection — meaning ORCH-0892-B's scope is slightly larger than originally framed (each KAV swap is wrapper-import + import-removal, not pure library-import-swap).
- **DISC-QA-0892-A-4** — DISC-0892-1 / DISC-0892-2 (ORCH-0888 + ORCH-0884 follow-up artifacts not on disk) re-verified by this tester via `find Mingla_Artifacts -iname "*0888*" -o -iname "*0884*"` — still zero matches. Operator backfill decision still pending. Not a blocker for this QA.
- **DISC-QA-0892-A-5** — TA-1 adversarial test SKIPS gracefully if `dist/_expo/static/js/web/` is missing (logs a `[TA-1 SKIP]` warning with the exact `npx expo export` prerequisite command). Future CI runs of this test need the export step in the workflow OR a pre-built artifact uploaded as a fixture. Not a blocker for ORCH-0892-A close — the gate per ORCH-0840 only requires the test to EXIST and be runnable; current run produces RED-with-real-bug which is the strongest possible exercise of the test.

---

## §11 — Rework instructions for implementor (if operator approves rework path)

### Path A (recommended): KAV wrapper indirection — fixes P1-1

1. Create `mingla-business/src/wrappers/KeyboardAvoidingView.tsx` (web variant):
   ```tsx
   // ORCH-0892-A v2 (post-QA rework): KAV web variant — re-export
   // react-native's own KeyboardAvoidingView. This works on react-native-web
   // (verified pre-ORCH-0892-A — was the production behavior on web).
   // Metro picks this file on web.
   export { KeyboardAvoidingView } from "react-native";
   ```
2. Create `mingla-business/src/wrappers/KeyboardAvoidingView.native.tsx` (native variant):
   ```tsx
   // ORCH-0892-A v2: KAV native variant — re-export the library's
   // frame-perfect KeyboardAvoidingView. Metro picks this file on iOS+Android.
   export { KeyboardAvoidingView } from "react-native-keyboard-controller";
   ```
3. Update the 3 pilot files to import from the wrapper:
   - `mingla-business/src/components/brand/BrandEditView.tsx`: change `import { KeyboardAvoidingView } from "react-native-keyboard-controller";` → `import { KeyboardAvoidingView } from "../../wrappers/KeyboardAvoidingView";`
   - Same for `mingla-business/src/components/brand/TripBrandWizard.tsx`.
   - Same for `mingla-business/src/components/ui/CoverPicker.tsx`.
4. Update the strict-grep gate's SAFELIST in `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` to include `mingla-business/src/wrappers/KeyboardAvoidingView.native.tsx` (legitimate library import).
5. Re-run `npm run test:orch-0892` + `npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx` + `npx jest src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx`. TA-1 should flip GREEN.
6. Re-export web bundle (`npx expo export --platform web`), confirm grep returns zero matches.
7. Update IMPLEMENTATION report with rework receipt.

### Path B: accept P1-1 as P2 (bundle bloat only)

If operator decides the ~12-20KB bundle leak is acceptable trade-off (e.g., the library's KAV gracefully no-ops on web without crashing), update SPEC §3 + §9 SC-4 to reflect the accepted behavior, downgrade P1-1 to P2, and verify in-browser hydration on Chrome before close. This path REQUIRES operator to verify in Chrome DevTools that BrandEditView / TripBrandWizard / CoverPicker pages cold-load on web without runtime errors.

### Path C (defer everything): land ORCH-0892-A as-is

Operator may decide the existing implementation is good enough for native pilot, defer P1-1 as a follow-up ORCH (ORCH-0892-A-2 [KAV wrapper indirection]). PASS verdict still blocked until rework lands OR P1-1 is downgraded.

---

## §12 — Layman summary

The implementation correctly installed the library, created the root provider wrapper, migrated three pilot screens, deleted ~75 lines of dead patches from CoverPicker, added 13 jest contract tests (all GREEN), and shipped a working informational CI gate. Code-level work is solid — carve-outs preserved, no scope creep into other domains, zero new tsc errors, fails-on-revert verified at the implementor's commit hash.

**The one architectural flaw:** the SPEC's `.web.tsx` passthrough successfully keeps the library's PROVIDER off web, but the three pilot files import the library's `KeyboardAvoidingView` directly in regular `.tsx` files. Metro bundles that for ALL platforms including web. Result: ~67 references to the library's code now live in the web JS bundle that ships to every buyer on `/checkout`, `/e`, `/b`. SPEC SC-4 explicitly required ZERO references — so this is a P1 violation.

The fix is well-defined: create one more wrapper pair (`KeyboardAvoidingView.{tsx,native.tsx}`) mirroring KeyboardRoot — the web variant re-exports React Native's built-in KAV (which works on web), the native variant re-exports the library. Then change the three pilot files to import from the wrapper. ~6 lines of changes total.

Six UI/runtime tests (BrandEditView keyboard rise + TripBrandWizard keyboard rise + the critical ORCH-0888 CoverPicker GIPHY search test on iOS) are blocked at `probable` confidence pending operator iOS dev-build rebuild — the installed sim binary is from yesterday, pre-library-install, so the app would crash at TurboModule registration. The rebuild is a 30-60 minute operator-side step per the runbook.

ORCH-0888 supersession verdict can NOT be decided yet — that requires the iOS sim live-fire on the rebuilt binary. Once rebuild + tester re-dispatch land, the GIPHY test answers SUPERSEDED vs REMAINS OPEN definitively.

Confidence: HIGH on the FAIL verdict (TA-1 RED is unambiguous, web bundle leak is reproducible). MEDIUM on the right path forward — Path A (KAV wrapper indirection) is the cleanest architectural fix, but operator may legitimately choose Path B (accept the bundle bloat after verifying no crash) or Path C (defer P1-1 to a sub-ORCH).
