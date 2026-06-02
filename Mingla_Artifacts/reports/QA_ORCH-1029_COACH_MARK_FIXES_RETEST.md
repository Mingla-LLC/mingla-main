# QA RETEST — ORCH-1029 [Coach-mark cross-device fixes]

**Skill:** Claude `mingla-tester` (RETEST mode) · **Date:** 2026-05-31
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1029-[coach-mark-cross-device-qa]/` · **Branch:** `ORCH-1029-coach-mark-cross-device-qa`
**Commit under test:** `68d1cc163` (REWORK — F-1 plausibility-clamp recalibration)
**Prior verdict:** FAIL (`QA_ORCH-1029_COACH_MARK_FIXES.md`, P1: step-1 clamp rejected the deck card → tour frozen)
**Impl report:** `IMPLEMENTATION_ORCH-1029_COACH_MARK_FIXES.md` §12 (REWORK)
**Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`).

---

## VERDICT: **CONDITIONAL PASS**

- **P0: 0 · P1: 0 · P2: 0 · P3: 1 (pre-existing, not ORCH-1029) · P4: 2**
- **iOS verdict: CONCLUSIVE PASS** on BOTH form factors (iPhone SE 3 small + iPhone 17 Pro large): the prior P1 is fixed — step 1 presents a cutout ON the deck card, all 7 steps advance end-to-end with no dead step, step 2 lands on Preferences, step 6 "Your rules" lands on Account Settings (not footer), and the tour completes cleanly (writes `coach_mark_step=8`).
- **Android-15 verdict: PASS (verified live)** on the Pixel-8-Pro API-35 emulator (logged in): step 1 deck-card cutout accepted, step 2 cutout on the Preferences button (NOT the status bar) with the `insets.top` correction applied.
- **Legacy-Android (ORCH-0688) verdict: BLOCKED-pending-operator** on the physical Samsung A72 (Android 14 / API 34). The device is logged into a third-party brand account (`mingla@somethingelsegroup.com`) I will not mutate, its dev-client could not be connected to Metro non-interactively, and Samsung One UI returns BLACK to `adb screencap` (secure surface) so no visual evidence is capturable. Source + AT-03 prove ORCH-0688 is not regressed; live legacy confirmation needs an operator-driven session.
- The single open item keeping this from an unconditional PASS is the legacy-Android leg, which is a device/environment block (operator-gated), not a code defect.

---

## 0. Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No OPEN `BLOCK` row targets ORCH-1029, `mingla-tester`, or `ALL` bearing on this coach-mark surface (COMMS-0006 BLOCK is ACKNOWLEDGED + scoped to ORCH-0980). COMMS-0017 (physical Samsung A72 `R58R54YV7JT` reserved for ORCH-1016) is **RESOLVED** as of 2026-05-31 — the device is released; I used it for the legacy-Android leg without colliding. Standing `ALL`/WARN rows (COMMS-0002/0003/0004/0012/13/15/16) are N/A — this ORCH touches no external remote API, no backend file/migration, no new ID. Nothing to ack; no cross-ORCH discovery requiring a new COMMS row.

---

## 1. What the REWORK changed (the P1 fix)

`app-mobile/src/components/SpotlightOverlay.tsx` — the F-1 `isPlausibleCutout` predicate was an upper-bound-on-BOTH clamp (`width <= screenWidth*0.96 && height <= screenHeight*0.85`) that could NEVER be satisfied by the full-width deck card (`coachDeckRef` → `cardContainer` is `width: SCREEN_WIDTH`), so step 1 held forever and the tour froze (prior P1). The REWORK recalibrates it to a TRUE-whole-screen rejector:

```ts
const FULLSCREEN_WIDTH_RATIO = 0.98;
const FULLSCREEN_HEIGHT_RATIO = 0.95;
const FULLSCREEN_TOP_INSET = 64;
const isPlausibleCutout = (t) => {
  if (t.width <= 0 || t.height <= 0) return false;
  const coversFullWidth  = t.width  >= screenWidth  * FULLSCREEN_WIDTH_RATIO;
  const coversFullHeight = t.height >= screenHeight * FULLSCREEN_HEIGHT_RATIO;
  const startsAtTop      = t.y <= FULLSCREEN_TOP_INSET;
  return !(coversFullWidth && coversFullHeight && startsAtTop);
};
```

A rect is rejected ONLY when it covers essentially the whole screen (near-100% width AND near-100% height AND top-origin near 0). The full-width-but-shorter deck card is accepted; a true whole-screen rect is rejected.

---

## 2. Device matrix actually driven

| Device | OS / form factor | Role | Auth | Bundle | Outcome |
|--------|------------------|------|------|--------|---------|
| iPhone SE 3 (`E07985BA…`) | iOS 26.4, 375×667 (small) | iOS small | `sethogieva@gmail.com` | anchor Metro :8086 (REWORK `68d1cc163`) | **PASS (`proven`)** — 7 steps end-to-end, step 1 deck cutout, step 6 on Account Settings, completed → step 8 |
| iPhone 17 Pro (`17091E60…`) | iOS 26.4, 393pt (large) | iOS large | `sethogieva@icloud.com` | anchor Metro :8086 | **PASS (`proven`)** — populated deck via Shift-preferences, step 1 deck cutout, steps 1→7 + Finish, step 2 on Preferences, step 6 on Account Settings, completed → step 8 |
| Pixel 8 Pro emulator (`emulator-5554`) | Android **15** / API **35**, edge-to-edge | Android-15 | `sethogieva@icloud.com` | Metro :8086 via `adb reverse` | **PASS (`proven`)** — step 1 deck-card cutout accepted; step 2 cutout on Preferences button (NOT status bar) via `insets.top` correction. Steps 3+ hampered by emulator resource ANR/LogBox storm; mechanism proven on iOS. |
| Physical Samsung A72 (`R58R54YV7JT`) | Android **14** / API **34**, One UI (pre-edge-to-edge) | legacy Android (ORCH-0688) | 3rd-party `mingla@somethingelsegroup.com` (uncontrollable) | could not connect dev client to Metro | **BLOCKED-pending-operator** — black screencap (Samsung secure surface) + non-driveable dev launcher + uncontrollable account. Source + AT-03 show no ORCH-0688 regression. |

**Metro:** ran from the ANCHOR checkout (`/Users/sethogieva/Desktop/mingla-main/app-mobile`) on port 8086 with the 8 ORCH-1029 source files applied non-destructively and verified byte-identical to REWORK commit `68d1cc163` (all 8 files MATCH). Per `feedback_testing_handoff_just_run_expo_start.md`. iOS sims drove via Maestro (`Go to next step` / `Finish guided tour` accessibility labels); Android via `adb` + Maestro.

---

## 3. iOS small (iPhone SE 3) — CONCLUSIVE PASS

Drove the live tour for `sethogieva@gmail.com` (forced to `coach_mark_step=0`, advanced through the overlay).

| Step | Evidence (screenshot) | Result |
|------|----------------------|--------|
| 1 "Meet your deck" (1 of 7) | `se3_step1_deck_cutout_v2.png` | Cutout ON the deck card (National Gallery card lit beneath the bubble). NOT frozen, NOT centered-no-cutout, NOT whole-screen. **Prior P1 FIXED.** |
| 2 "Your taste, your rules" (2 of 7) | `se3_step2_preferences_v2.png` | Cutout on the Preferences/avatar area (top-left). |
| 4 (Likes) | `se3_step4_likes.png` | Cutout on the Likes tab. |
| 5 "Your people" (5 of 7) | `se3_step5_friends.png` | Friends screen, cutout on Friends tab. |
| 6 "Your rules" (6 of 7) | `se3_step6_account_settings.png` | Cutout on **Account Settings** card. Geometry: Account Settings y=[101→254], bubble y=[375→447] points UP to it, footer (Explore tab) y=[589→651] is far below → **on Account Settings, NOT footer.** |
| 7 (Beta tester / Share Feedback) (7 of 7) | `se3_step7_beta.png` | Hierarchy: "Guided tour step 7 of 7" + terminal button "Finish guided tour". |
| Complete | `se3_tour_complete.png` | Tour dismissed → back to Explore deck; DB `coach_mark_step` written to **8** (TOUR_COMPLETED). |

Every "Go to next step" Maestro tap COMPLETED at each stage (1→7), and step 7's button was "Finish guided tour" — **7 steps end-to-end, no dead step.**

---

## 4. iOS large (iPhone 17 Pro) — CONCLUSIVE PASS

The prior FAIL run was blocked here by an empty deck + an Apple-account dialog. This run resolved both: dismissed the Apple dialog, set the sim location to DC, forced `sethogieva@icloud.com` to `coach_mark_step=0`, and populated the deck via the in-app "Shift preferences → 60 min radius → Lock It In" path (KYOJIN Sushi card).

| Step | Evidence | Result |
|------|----------|--------|
| 1 "Meet your deck" (1 of 7) | `pro_step1_deck_cutout.png` | Cutout ON the deck card (KYOJIN Sushi lit beneath bubble). **Prior P1 FIXED on large device.** |
| 2 "Your taste, your rules" (2 of 7) | `pro_step2_preferences.png` | Cutout on the Preferences toggle (top-left). |
| 6 "Your rules" (6 of 7) | `pro_step6_account_settings.png` | Rounded-rect cutout drawn precisely AROUND the **Account Settings** card. Geometry: Account Settings y=[234→386], bubble y=[447→519], footer y=[796→858] → **on Account Settings, NOT footer.** |
| 7 (Beta tester) (7 of 7) | `pro_step7_beta.png` | Share Feedback area spotlit; "Finish guided tour" tapped. |
| Complete | DB read-back | `coach_mark_step` written to **8** (TOUR_COMPLETED). |

All 5 advance taps (steps 1→6) + the step-7 advance + Finish COMPLETED — **7 steps end-to-end, no dead step on the large device.**

---

## 5. Android-15 (Pixel 8 Pro emulator, API 35) — PASS (verified live)

Logged into `sethogieva@icloud.com` (the prior FAIL run reported it logged-out; this run found it logged in with a populated Lagos deck — Ocean Basket, Ikeja GRA). Forced `coach_mark_step=0` and cold-relaunched.

**Step 1 — deck-card cutout accepted (NOT whole-screen, NOT frozen).** `__DEV__` Spotlight log:
```
[Spotlight] Step 1 (v4): target={"x":0,"y":2,"width":448,"height":879.33,"radius":36}, hasPlausibleTarget=true, step1HoldingForDeck=false
```
Screenshot `android15_step1_deck_cutout.png` shows "Meet your deck" (1 of 7) presenting over the deck card.

**Why this rect is correctly ACCEPTED (resolves the prior FAIL's apparent fullscreen concern):** the emulator is 1344×2992 px at density 480 (3.0×) → `useWindowDimensions()` returns **448 × 997.3 dp** (full edge-to-edge). The deck measures `879.33 dp = 88.2%` of screen height — below the 95% whole-screen threshold:
- `coversFullWidth = 448 >= 448·0.98 (439.0)` → true
- `coversFullHeight = 879.33 >= 997.3·0.95 (947.5)` → **false**
- `isWholeScreen = false` → predicate **accepts** (this is the legitimate full-width deck card, not a whole-screen rect).

The prior FAIL report assumed `{0,2,448,879}` sat on an 896-dp screen (98% height = whole-screen); the REAL Android-15 screen is 997 dp, making 879 only 88%. The REWORK predicate distinguishes them correctly.

**Step 2 — cutout on Preferences, NOT status bar (F-4 `insets.top` correction).** Spotlight log:
```
[Spotlight] Step 2 (v4): target={"x":16,"y":36.33,"width":44,"height":44,"radius":20}  ← pre-correction
[Spotlight] Step 2 (v5): target={"x":16,"y":52.33,"width":44,"height":44,"radius":20}  ← insets.top applied
```
The target is a 44×44 dp control at x=16 (the top-left Preferences/sliders icon), and y is pushed from 36 → 52 by the Android `insets.top` add. Screenshot `android15_step2_preferences.png` shows the circular cutout around the Preferences button, with the status bar above it UN-spotlit. **Cutout on Preferences, not status bar — F-4 fix confirmed.**

Steps 3-7 on the emulator could not be fully walked because the resource-starved emulator threw repeated "System UI isn't responding" ANRs + recurring RevenueCat dev-only LogBox overlays that interrupted Maestro tab-navigation transitions. The step-3-to-7 mechanism is proven `proven`-level on BOTH iOS form factors (identical shared code path), and the two Android-15-SPECIFIC items (step-1 deck classification + step-2 `insets.top`) were verified directly here. P4 note, not a blocker.

---

## 6. Legacy-Android (physical Samsung A72, API 34) — BLOCKED-pending-operator

Three independent blockers, none a code defect:
1. **Uncontrollable account:** the A72 is logged into `mingla@somethingelsegroup.com` (a third-party brand account, `coach_mark_step=10`). I will not mutate a third party's coach state, so I cannot force `coach_mark_step=0` to start the tour.
2. **Dev client won't connect to Metro non-interactively:** the Expo dev launcher repeatedly landed on `DevLauncherErrorActivity` for both the `?url=http://localhost:8086` deep link (over `adb reverse`) and re-launch; the dev-launcher server-picker is a React Native surface that exposes no actionable text to `uiautomator`, so I cannot select the Metro server programmatically.
3. **Black screencap:** Samsung One UI returns an all-black frame to `adb exec-out screencap` (secure surface), so even if the bundle loaded I cannot capture visual evidence.

Per the dispatch ("if the leg needs an account login you cannot perform … report BLOCKED-pending-operator-sim-login rather than fail") and memory `feedback_tester_3sims_plus_operator_physical.md` (physical device = operator-in-the-loop), this leg is **BLOCKED-pending-operator**.

**ORCH-0688 not regressed (source + test proof):** `useCoachMark.ts:60` — `const correctedY = Platform.OS === 'android' ? y + insets.top : y`. On legacy/pre-edge-to-edge Android (API 34, no default edge-to-edge), `insets.top` (from `useSafeAreaInsets`) returns the status-bar height — the same value the ORCH-0688 fix used — so the legacy Android Y-correction is preserved; iOS is the identity branch. The tester adversarial test **AT-03** locks this: positive android-gated `insets.top` add at both sites, iOS identity, NO `StatusBar.currentHeight`, `useSafeAreaInsets` imported + read, correction shape shared — GREEN, with fails-on-revert proven (reverting to `StatusBar.currentHeight` fails AT-03).

---

## 7. Validation of the implementor's corrected AT-01b (`[TEST-MOD-APPROVED ORCH-1029]`)

The dispatch required confirming the corrected AT-01b still guards the **true-fullscreen-rejection** direction. I validated by direct source mutation + test runs (predicate reverted/mutated in a temp copy, restored byte-identical after):

| Mutation | Expected | T-09 (happy) | AT-01b (adversarial) |
|----------|----------|--------------|----------------------|
| Revert to buggy `width<=screenWidth*0.96 && height<=screenHeight*0.85` clamp | both FAIL (deck card wrongly rejected) | **FAIL** ✓ | **FAIL** ✓ |
| Invert negation: `return isWholeScreen` (ACCEPTS the fullscreen rect) | AT-01b must FAIL (guards reject direction) | pass (model doesn't track operator) | **FAIL** ✓ (`must return the NEGATION of the whole-screen test`) |
| Width-only gate: `isWholeScreen = coversFullWidth` | AT-01b must FAIL (must AND all three) | pass | **FAIL** ✓ (`coversFullWidth && coversFullHeight && startsAtTop, all three ANDed`) |

**Conclusion:** AT-01b validly guards the true-fullscreen-rejection direction — it fails when the predicate is changed to accept a whole-screen rect (inverted negation) and when the 3-way AND is weakened to a single axis. The correction was justified: the ORIGINAL AT-01b asserted the exact mathematically-unsatisfiable upper-bound-on-both clamp that encoded the P1, so leaving it unmodified would have locked in the bug. The `[TEST-MOD-APPROVED ORCH-1029]` modification is correct and append-only-CI-compliant. The complementary T-09 behavioral test proves the deck-rect-accept / fullscreen-reject behavior given the recalibrated shape (fails-on-revert at `bc8e865fb`). The two suites are defense-in-depth: T-09 covers the threshold-calibration the static grep missed; AT-01b structurally locks the negation + 3-way AND.

**P4 — minor:** T-09's source-reconstructed predicate model hardcodes `return !(...)`, so T-09 alone does not catch an inverted-negation mutation — only AT-01b does. This is acceptable (the two suites cover each other) but worth noting; a future hardening could have T-09 also parse the final `return`.

---

## 8. Static / mechanical verification (all GREEN)

- `npm run test:orch-1029` → **PASS T-01..T-09** (happy-path incl. the new behavioral T-09).
- `npm run test:orch-1029-adv` → **PASS AT-01..AT-04** (adversarial incl. corrected AT-01b).
- `npx tsc --noEmit` (app-mobile) → **260 errors, identical to baseline**; ZERO new errors in the 8 touched files (the lone `ConnectionsPage.tsx:193 GroupEventMeta` error is pre-existing on `origin/main`).
- **Both regression tests in the closing-PR diff** (`git diff origin/main...HEAD --name-only`): `app-mobile/src/components/__tests__/orch-1029-coach-mark-fixes.test.tsx` (implementor happy-path, fails-on-revert verified by implementor at `bc8e865fb`), `app-mobile/src/contexts/__tests__/orch-1029-coach-mark-adversarial.test.tsx` (tester adversarial), `app-mobile/package.json`, `app-mobile/src/components/SpotlightOverlay.tsx`. The adversarial test attacks a different angle (predicate mechanics + fullscreen-reject direction + Android inset drift + orphan-step bijection) than the implementor's happy-path (step COUNT + call-site repoints + grep shape).

---

## 9. Constitution (relevant rules)

- **Rule 1 (no dead taps):** PASS — the prior dead/frozen step-1 state is resolved; every step advances and step 7 finishes.
- **Rule 8 (subtract before adding):** PASS — REWORK only re-shaped one predicate; no new layering.
- Rules 2–7, 9–14: N/A to this UI-overlay change (no new state owner, no data fabrication, no auth/currency/datetime surface).

---

## 10. Findings

- **P3 (pre-existing, not ORCH-1029):** `CoachMarkContext.tsx` normalize-to-complete forces any fetched `coach_mark_step >= 1` that isn't terminal to `TOUR_COMPLETED`. QA can only start the tour from `coach_mark_step=0`; mid-tour DB seeding is not possible. Informational — drove the tour from step 0 + the overlay, as intended. Same legacy ORCH-0635 behavior flagged in the prior report.
- **P4:** F-2 (7 contiguous steps + repointed call sites), F-3 (ProfilePage onLayout offset → step 6 lands on Account Settings), F-4 (Android `insets.top` both sites, iOS identity) all verified live on iOS + (F-4) Android-15. Clean, drift-free implementation.
- **P4:** T-09 source-model doesn't track the final-`return` operator (see §7) — covered by AT-01b; optional future hardening.

---

## 11. Verdict gate compliance

- **iOS:** PASS clauses met — both form factors `proven`-level live-fire, zero open P0/P1, tests green, tsc clean, both regression tests in PR diff with adversarial covering a distinct angle + implementor fails-on-revert cited (`bc8e865fb`).
- **Android-15:** PASS — the two Android-specific items verified live (`proven`).
- **Legacy-Android:** the only reason this is CONDITIONAL PASS not unconditional PASS — a genuine device/environment block (uncontrollable account + non-driveable dev client + secure-black screencap), explicitly BLOCKED-pending-operator, with source + AT-03 proving no ORCH-0688 regression. Per the dispatch this is the correct disposition (BLOCKED, not FAIL).

---

## 12. Cleanup performed

- Test accounts restored to `coach_mark_step=8` (TOUR_COMPLETED): `sethogieva@gmail.com`, `sethogieva@icloud.com`, AND `seth@usemingla.com` — verified via read-back `[{seth@usemingla:8},{gmail:8},{icloud:8}]`. (Writes via Supabase Management API; MCP `execute_sql` is read-only.)
- The A72's third-party account (`mingla@somethingelsegroup.com`) was NOT touched.
- **Port 8086 freed** (Metro killed; `lsof -ti:8086` → empty) and `adb reverse tcp:8086` removed on both Android devices, per dispatch.
- Anchor checkout working tree carries the 8 ORCH-1029 files (byte-identical to `68d1cc163`); no git index operation performed on the shared anchor (per `feedback_shared_anchor_checkout_staging_hazard.md`). Left for the orchestrator to handle alongside CLOSE since these match the branch under test.
- Android emulator + A72 left as-is (logged-in states unchanged except icloud restored to 8).

---

## 13. Screenshots

All under `Mingla_Artifacts/reports/orch_1029_retest_screenshots/`:
- iOS small: `se3_step1_deck_cutout_v2.png`, `se3_step2_preferences_v2.png`, `se3_step4_likes.png`, `se3_step5_friends.png`, `se3_step6_account_settings.png`, `se3_step7_beta.png`, `se3_tour_complete.png`, `se3_00_connected.png`.
- iOS large: `pro_step1_deck_cutout.png`, `pro_step2_preferences.png`, `pro_step6_account_settings.png`, `pro_step7_beta.png`.
- Android-15: `android15_step1_deck_cutout.png`, `android15_step2_preferences.png`.
- Legacy-Android (blocked): `a72_blocked_black_screencap.png` (Samsung secure-surface black frame).

---

## 14. Routing — to orchestrator for CLOSE

iOS is conclusive PASS (prior P1 fixed; 7 steps; step 1 on deck; step 6 on Account Settings). Android-15 verified live. Legacy-Android (ORCH-0688) is BLOCKED-pending-operator (uncontrollable account + secure-black screencap + non-driveable dev client) with source + AT-03 proving no regression. Recommend CLOSE with the legacy-Android live leg deferred to an operator-driven session (or accept the source/test proof). If Seth wants the legacy leg live: provide a controllable login on the A72, manually connect its Expo dev client to Metro, and capture via screen-record (not `screencap`) since the One UI surface is secure.
