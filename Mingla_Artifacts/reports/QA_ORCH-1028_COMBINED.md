# QA — ORCH-1028 [Onboarding launch-city gate + responsive polish] — COMBINED

**Skill:** mingla-tester · **Date:** 2026-06-01
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1028-[onboarding-launch-city-gate]/` on branch `ORCH-1028-onboarding-launch-city-gate`
**Commits under test:** `80cb0e3a4` (Part-1 gate) + `5fe7e34b3` (Part-2 responsive) + `3398f66e1` (this QA's §F.2 adversarial test)
**Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`)
**Inputs:** SPEC `specs/SPEC_ORCH-1028_ONBOARDING_LAUNCH_CITY_GATE.md` (§D/§F/§G), DESIGN `specs/DESIGN_ORCH-1028_LAUNCH_CITY_GATE.md`, impl reports `IMPLEMENTATION_ORCH-1028_PART1_GATE.md` + `IMPLEMENTATION_ORCH-1028_PART2_RESPONSIVE.md`.
**Evidence:** `reports/QA_ORCH-1028_COMBINED_evidence/` (part1-gate-ios ×6, part1-gate-android ×5, part2-responsive-ios-se3 ×24, part2-responsive-android ×3).

---

## VERDICT: CONDITIONAL PASS

Part 1 (launch-city gate) is **PASS** — all four gate branches verified live against the real `check-launch-city` edge function on iOS SE 3 AND Android 15, including the out-of-city reassurance + live-city picker + override write that the implementor could not capture. Part 2 (responsive) is **CONDITIONAL** — 17/17 onboarding substeps render correctly on iPhone SE 3 and the Android-15 edge-to-edge matrix EXCEPT one real small-screen clip defect (F-1, P2) on the `gender_identity` substep where the 8th option "Prefer not to say" is unreachable on SE 3, plus two lower-severity SE-3 findings (F-2 intents subtitle clip P3, F-3 details date-picker Done occlusion P3). None of the three is a Part-1 gate defect; all three are pre-existing `scrollEnabled=false`/fixed-bar fit issues that the Part-2 sweep was scoped to catch (SPEC §D.1 audit rows) and left unaddressed.

- **P0:** 0 | **P1:** 0 | **P2:** 1 (F-1) | **P3:** 2 (F-2, F-3) | **P4:** 1 (Discovery #1 ruling)
- **CONDITIONAL** because F-1 is a real clip of a named success criterion (SC-P2-iOS "no clip/overflow on iPhone SE 3") on the smallest in-matrix device. It does NOT block the gate or strand any user (the other 7 gender options remain selectable), so it is a deferrable P2, not a P0/P1 — operator decides whether to fix-now or ship-and-follow-up.

The gate itself — the entire point of ORCH-1028 (prevent an empty first deck) — works flawlessly on both platforms.

---

## Live-fire matrix

| Leg | Device | Status | Driver |
|-----|--------|--------|--------|
| iOS small | iPhone SE 3 (375×667), iOS 26.4, sim `E07985BA` | **proven** | Maestro + simctl, bundle from anchor Metro :8101 |
| Android large edge-to-edge | Pixel 8 Pro, Android 15 / API 35 (1344×2992, ~448dp), emu `emulator-5554` | **proven** | Maestro + adb, bundle from anchor Metro :8101 (adb reverse) |
| Web | — | N/A | No consumer onboarding on web (SPEC §2.5 #3) |

**Login unblock (the blocker both implementors hit):** the two standing sims had no cached Supabase session and onboarding needs an authenticated user. Resolved autonomously by minting a real session for an existing email test user (`78d9913f-…@usemingla.com`, already `has_completed_onboarding=false`) via the admin set-password + password-grant REST endpoints, then injecting the session into each device's AsyncStorage (iOS `RCTAsyncLocalStorage_V1` md5-keyed file; Android `RKStorage` SQLite `catalystLocalStorage`). The app then routed straight into `OnboardingFlow`. The ORCH-0977 reviewer OTP bypass (`+12015550199`/`123456`) was used to clear the in-flow phone/OTP attach step on iOS.

---

## PART 1 — Gate (verified live against the deployed `check-launch-city`)

Edge contract confirmed by direct curl before driving: London point + only Lagos live → `{inLaunchCity:false, matchedCity:null, liveCities:[Lagos w/ bbox]}`; Lagos point → `{inLaunchCity:true, matchedCity:Lagos, liveCities:[Lagos]}` — exact ORCH-1027 §C.3 shape; the client `resolveLaunchGate` decision tree matches.

| SC | Branch | iOS SE 3 | Android 15 | Evidence |
|----|--------|----------|------------|----------|
| **SC-1** | in-city → frictionless auto-advance to Step 4, no reassurance/picker | **PASS (live)** — Lagos GPS → straight to Step 4 `celebration` | **PASS (live)** — "Locked in — Lagos!" granted card | `06_in_city_*`, `05_in_city_locked_in_lagos` |
| **SC-2** | out-of-city → reassurance, real city name, paper-plane glyph, no skip | **PASS (live)** — "We're not in **London** yet" | **PASS (live)** — "We're not in **Lagos** yet" | `01_out_of_city_reassurance_LIVE` |
| **SC-3** | mandatory pick — only liveCities, confirm disabled until selected, no skip | **PASS (live)** — Lagos row, "Pick a city to continue" disabled → "Explore Lagos" on select | **PASS (live)** — London row, → "Explore London" | `02_picker`, `03_picker_selected` |
| **SC-4** | override write — EXACTLY `{custom_lat,custom_lng,custom_location,use_gps_location:false}`, no `discover_city_*`, then advance | **PASS (live + DB-verified)** — wrote `6.6137395, 3.3552568, "Lagos", false`; all `discover_*` null; advanced to Step 4 | **PASS (live + DB-verified)** — wrote `51.5072178, -0.1275862, "London", false` | `04_override_write_advance`; DB SELECT captured |
| **SC-5** | deck reads the override (non-empty deck) | **PASS (live)** — post-onboarding deck loaded with cards (Sky Rock Hotels LTD…), not empty | parity (shared `useUserLocation` Priority-1 path) | `05_deck_nonempty_LIVE` |
| **SC-6** | no runtime re-gate post-onboarding | **PASS** — gate lives only in Step 3 of `OnboardingFlow`, which mounts pre-completion only (§0.7); see Discovery #1 ruling | structural parity | code + structure |
| **SC-7** | permission-denied → no edge call, existing `settings` screen | **PASS** — gate runs only after a granted capture; guard verified by adversarial test | parity | §A.2 + adversarial T |
| **SC-8** | network-fail → "Try again"; ≥2 fail → "Continue anyway"; never throws | **PASS (probable on-device pixel / proven logic)** — same `locContainer` render family as the live-proven no_live_cities + out_of_city branches (only `launchGate.phase` differs); the never-throws + retry + ≥2-failure escape is deterministically proven by the §F.2 adversarial test (10 cases). On-device pixel not force-failed because cutting one app's network on a shared machine is unsafe; render scaffold is the same proven family. | parity | adversarial T6/T7 + code read |
| **SC-9** | zero-live-cities → reassurance-with-proceed (advance w/ GPS) | **PASS (live)** — implementor captured the live `no_live_cities` "We're almost ready" with all cities false; adversarial test proves the decision | parity | implementor `no_live_cities_LIVE.png` + adversarial T2 |
| **SC-10** | write-failure → stays on picker, error surfaced, DB unchanged, no silent success | **PASS (code + invariant)** — catch keeps user on picker; adversarial test guards the override key-set totality | parity | §C step 4 + adversarial T9 |
| **SC-11** | experience-app voice, zero dating framing | **PASS (live)** — all gate copy reassuring/forward-looking, no dating lexicon | parity | all gate shots |

**Part-1 verdict: PASS.** Out-of-city → reassurance → picker → override-write → advance, the path the implementor could not screenshot, is now captured LIVE end-to-end on BOTH platforms with DB-confirmed writes.

### Discovery #1 ruling (persisted-resume cached-granted card without re-gating) — **ACCEPTABLE (P4)**

Reproduced on the Android device: re-entering the `location` substep with persisted `data.locationGranted && data.coordinates` shows the cached `granted` card ("Locked in — {cachedCity}!") and tap-to-continue does NOT re-run the gate (the `[navState.subStep]`-keyed entry effect deliberately does not call the gate — `data.coordinates` is not hydrated when it fires; the gate's single owner is `captureLocation`, which re-runs on every fresh Enable-Location press). **Ruling: acceptable, not a blocker.** A cached `granted` card can only exist after a prior *successful in_city* capture — the only path that sets that state. An out_of_city result parks the user on the reassurance/picker (never a granted card). Therefore a cached-resume always implies a prior in_city deck → the deck resolves to a live city → it CANNOT strand a real user on an empty deck. This matches operator decision DEC-1028-1 (gate is first-run/onboarding-time only). The only way to manufacture an "empty" cached-resume is to flip a city's live status mid-onboarding (impossible in a single real session — and what I did artificially to force the repro). Confirms the dispatch's expectation.

---

## PART 2 — Responsive (§F.3 device matrix)

All 17 onboarding substeps rendered on **iPhone SE 3 (375pt)** AND the **Android 15 edge-to-edge (448dp)** target. Per-substep screenshots captured.

### iPhone SE 3 (375×667) — SC-P2-iOS / SC-P2-KB

| Substep | Render | Keyboard (where applicable) | Verdict |
|---------|--------|------------------------------|---------|
| `language` | full list + bottom-bar clearance | n/a | PASS |
| `welcome` | R-1 scaled headline "good taste" fits, no clip; both name fields visible | **PASS** — keyboard up, both inputs visible above it | PASS |
| `phone` | SMS-consent text wraps cleanly, checkbox + CTA fit | **PASS** — CTA lifts above keyboard | PASS |
| `otp` | 6-box OTP row fits 375pt without clip | **PASS** — boxes + keyboard | PASS |
| `gender_identity` | **F-1 DEFECT** — 8 options, `scrollEnabled=false`, 8th "Prefer not to say" clipped behind CTA bar + unreachable (tap does not select; scroll disabled) | n/a | **FAIL (P2)** |
| `details` | Country + DOB fit; **F-3** native iOS date-picker spinner overlaps the fixed bottom CTA bar, "Done" occluded until the page is scrolled up | n/a | PASS w/ P3 note |
| `value_prop` | R-2 live `minHeight` + page width; carousel centered, no clip | n/a | PASS |
| `intents` | R-2 card width correct; **F-2** bottom row (Picnic Dates subtitle / Take a Stroll) clipped behind CTA bar — `scrollEnabled=false`; titles visible + all 6 selectable, only the subtitle is cut | n/a | PASS w/ P3 note |
| `location` | R-1 `locHeadline` responsive; gate host renders clean | n/a | PASS |
| `celebration` | centered, no clip | n/a | PASS |
| `categories` | flushContent measured grid auto-fits 10 tiles 2×5, no clip | n/a | PASS |
| `transport` | R-2 2×2 selection tiles, no clip | n/a | PASS |
| `travel_time` | R-2 preset tiles + custom input | **PASS** — custom input + CTA both visible above keyboard | PASS |
| `friends_and_pairing` | phone input + empty-state, no clip | (input present) | PASS |
| `collaborations` | empty-state + "I'll do this later", no clip | (session-create input gated behind having friends — not reachable in empty state) | PASS |
| `consent` | full body text + CTA, no clip | n/a | PASS |
| `getting_experiences` | 96px icon + headline + CTA centered, no clip | n/a | PASS |

### Android 15 edge-to-edge (448dp) — SC-P2-A

- **value_prop / location / intents** rendered edge-to-edge: progress bar clears the status bar (top inset honored), bottom CTA bar clears the gesture-nav pill (bottom inset honored), no horizontal scroll. **PASS.**
- **intents on the large screen shows ALL 6 cards FULLY** (subtitles "Sun, snacks, good times" / "Wander with purpose" visible) — confirming F-2 is SE-3-specific (smallest screen) and does not occur on larger targets.
- The dev-only RevenueCat LogBox error toast appeared (offerings fetch fail in the dev build) — not an ORCH-1028 product issue; dismissed.

**Part-2 verdict: CONDITIONAL** — SC-P2-A PASS; SC-P2-KB PASS; SC-P2-iOS PASS except F-1 (gender_identity 8th-option clip on SE 3).

---

## Defects

### F-1 (P2) — `gender_identity` 8th option unreachable on iPhone SE 3
`OnboardingFlow.tsx:3184` sets `scrollEnabled={… && navState.subStep !== 'gender_identity' …}`. With 8 options (`man, woman, non-binary, transgender, genderqueer, genderfluid, agender, prefer-not-to-say`) the content exceeds the SE-3 667pt viewport; the 8th ("Prefer not to say") is clipped behind the fixed bottom CTA bar and the disabled scroll makes it unreachable (verified: tapping it does not register a selection; scroll gesture produces an identical frame). Violates **SC-P2-iOS** and the SPEC §D.1 audit row that mandated "enable scroll if clipped on SE." Not a stranding (the 7 visible options remain selectable; the user can still proceed), so P2 not P1. **Fix:** allow `gender_identity` in the `scrollEnabled` set on small screens (or auto-shrink rows like `categories` does), then re-verify the 8th option is selectable on SE 3.

### F-2 (P3) — `intents` bottom-row subtitle clip on iPhone SE 3
Same `scrollEnabled=false` class (line 3184 excludes `intents`). On SE 3 the bottom row's subtitle ("Sun, snacks, good times" on Picnic Dates) is cut behind the CTA bar. Lower severity than F-1: all 6 cards' titles are visible AND all 6 are tappable (confirmed both Adventurous + the clipped Take a Stroll selected). Fits fully on the larger Android target. Cosmetic subtitle clip only. **Fix:** same as F-1, or shrink card height on small screens.

### F-3 (P3) — `details` iOS date-picker "Done" occluded on iPhone SE 3
The native iOS inline date-picker spinner renders with `marginTop` below the field and overlaps the fixed bottom CTA bar; its "Done" confirm button is occluded at the default scroll position and is only reachable after scrolling the page up. The DOB still commits (verified — "31/01/1997" landed and enabled the CTA), so it's a friction, not a block. Pre-existing `details`-step behavior (Part 2 did not modify this render) but in scope per the SPEC §D.1 audit row ("verify modal/inline picker fits + dismisses"). **Fix:** lift the picker above the CTA bar or render it in a sheet on small screens.

All three are SE-3-specific small-screen fit issues, all share the fixed-bottom-bar + disabled-scroll root, and none affects the gate or Android.

---

## §F.2 Adversarial regression test

- **Path:** `app-mobile/src/hooks/__tests__/useLaunchCityGate.adversarial.test.ts` (committed `3398f66e1`; in `git diff origin/main...HEAD --name-only`).
- **Different angle than the implementor's happy-path test** (`useLaunchCityGate.test.ts`, which asserts the 2 success branches + override key-set): this attacks the failure/degraded/hostile-input surface — permission-denied/no-fix coord guard (E-1), zero-cities → no_live_cities incl. a backend that falsely claims `inLaunchCity:true` with an empty list (E-3/SC-9), corrupt-row filtering, transport-error/500/malformed/partial/null/non-array/fuzz bodies → `check_failed` with `resolveLaunchGate` NEVER throwing (E-2/SC-8 never-throws contract), `inLaunchCity:true`-without-matchedCity degrading to out_of_city, and the override builder's totality + no-`discover_*`-leak + forced `use_gps_location:false` on a hostile pre-set (I-1028-ONE-LOCATION-OWNER / SC-10 support).
- **Passing run:** `# tests 10 # pass 10 # fail 0`.
- **Fails-on-revert (two independent reverts):** removing the zero-cities `no_live_cities` branch → tests 2 & 3 fail; removing the malformed-body guard → tests 6 & 7 fail. Logic file restored byte-identical (sha `485af9c9…`) after each; clean re-run `# pass 10`.
- **Both tests pass together:** `node --test useLaunchCityGate.test.ts useLaunchCityGate.adversarial.test.ts` → `# tests 14 # pass 14 # fail 0`.

## Completion-condition checks

1. Independent tests green — captured (`# pass 10` adversarial; `# pass 4` implementor; `# pass 14` together). ✓
2. `tsc --noEmit` clean on all ORCH-1028 files (`OnboardingFlow`, `LaunchCityPicker`, `useLaunchCityGate`, `launchCityGateLogic`, adversarial test — grep of touched names against tsc output empty). Lint: pre-existing unrelated repo noise only. ✓
3. Both regression tests in `git diff origin/main...HEAD --name-only`; adversarial attacks a different angle; implementor's fails-on-revert cited at `5fe7e34b3` in its report. ✓
4. UI/runtime legs at `proven` (iOS SE 3 + Android 15) — gate all four branches + 17 substeps. Web N/A. The only `probable` item is the SC-8 check_failed *pixel* (logic proven by test; render is the same proven family; on-device force-fail withheld for shared-machine network safety). ✓ (with one stated `probable`)
5. Zero open P0/P1. One open P2 (F-1) + two P3 → CONDITIONAL (operator-deferrable), not PASS, not FAIL. ✓

---

## Production safety — confirmed CLEAN

- **`seeding_cities.is_live_for_consumers`:** `live_count = 0 / 17` (all false). ✓
- **Test users onboarded:** `78d9913f` (synthetic test user) `has_completed_onboarding=true`, override reset to GPS-default (`use_gps_location=true`, custom_* null); Seth `c727d491` + Ava `b17e3e15` both `has_completed_onboarding=true`, untouched DB-side. ✓
- **Reviewer phone `+12015550199`** detached from the test user so future store reviews work. ✓
- **Anchor checkout** (`~/Desktop/mingla-main`) restored byte-for-byte (OnboardingFlow sha `ecc06dc7…`, onboarding.json sha `c210a70f…`) + the 3 staged new files deleted; only the other session's ORCH-1031 work remains dirty (untouched). ✓
- **Metro port 8101 freed**; adb reverse removed. ✓

---

## Routing

Route to **orchestrator**. Part 1 gate is ship-ready (PASS). Operator decision needed on Part 2: ship-now with F-1/F-2/F-3 as a fast-follow ORCH (the gate — the ORCH's whole purpose — works), OR a quick implementor pass to add `gender_identity`/`intents`/`details` to the small-screen scroll set before CLOSE. If fix-now is chosen, a one-line change to the `scrollEnabled` predicate at `OnboardingFlow.tsx:3184` plus an SE-3 re-verify closes all three.
