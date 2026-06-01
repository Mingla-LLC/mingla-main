# IMPLEMENTATION — ORCH-1028 Part 1 [Onboarding launch-city gate]

**Author:** mingla-implementor (Claude). **Date:** 2026-05-31.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1028-[onboarding-launch-city-gate]/` on branch `ORCH-1028-onboarding-launch-city-gate`.
**Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`). No backend, no migration, no deploy.
**Inputs:** `Mingla_Artifacts/specs/SPEC_ORCH-1028_ONBOARDING_LAUNCH_CITY_GATE.md` (§A–§C/§F) + `Mingla_Artifacts/specs/DESIGN_ORCH-1028_LAUNCH_CITY_GATE.md` (pixel contract).
**Upstream (frozen, LIVE):** ORCH-1027 `check-launch-city` edge fn — `POST .../functions/v1/check-launch-city {lat,lng}` → 200 `{inLaunchCity, matchedCity|null, liveCities:[…]}`, `verify_jwt=false`. Smoke-verified live this session.

Part 2 (responsive sweep) was already committed on this branch (`5fe7e34b3`) — untouched here.

---

## Comms ledger (read on entry)

No BLOCK rows target ORCH-1028 / mingla-implementor / ALL+OPEN. Acked as N/A (already acked at SPEC §0.10):
- **COMMS-0003** (external-API docs at SPEC): `check-launch-city` is the FROZEN ORCH-1027 contract; no new external-API param/payload introduced. Only call is `supabase.functions.invoke('check-launch-city',{body:{lat,lng}})`.
- **COMMS-0002** (strict-grep C7 blocks new `supabase/functions/` files): N/A — ORCH-1028 adds NO migration and NO edge function. Client-only.
- **COMMS-0004** (INTAKE double-book scan): N/A — IMPLEMENT turn, not INTAKE.

No new cross-ORCH discovery this turn.

---

## What was built

A launch-city gate that runs after the existing GPS capture in onboarding Step 3. In-city = unchanged frictionless flow; out-of-city = reassurance screen → mandatory live-city picker → writes the main-deck location override; zero-live-cities and check-failed have proceed/retry escapes. Onboarding-time only (no runtime re-gate — structurally guaranteed by the host remount, §0.7).

### Files

| File | New/Mod | What |
|------|---------|------|
| `app-mobile/src/hooks/launchCityGateLogic.ts` | NEW | Dependency-free decision core: `resolveLaunchGate(body,error)` → 4-status union, `areCoordsValid`, `buildLaunchCityOverride` (the exact §C write key-set). Node-testable (no RN imports). |
| `app-mobile/src/hooks/useLaunchCityGate.ts` | NEW | `checkLaunchCity(lat,lng)` network wrapper: `supabase.functions.invoke` + 6s `withTimeout` + logging; delegates the decision to the logic core. NEVER throws. Re-exports the frozen ORCH-1027 §C.3 types. |
| `app-mobile/src/components/onboarding/LaunchCityPicker.tsx` | NEW | In-onboarding picker (pick-from-frozen-`liveCities` only, DEC-1028-6). Nearest-first sort (haversine from captured point), 52pt glass rows + reserved trailing slot (no reflow), conditional filter (>8 cities), empty-search state, a11y radiogroup, Android opaque-glass fallback (META-ORCH-1002). |
| `app-mobile/src/components/OnboardingFlow.tsx` | MOD | Gate wired into `captureLocation` (after capture, before auto-advance); `launchGate` UI state machine; 4 gate render branches inside the `location` block + `checking` overlay on the granted card; phase-aware shell CTA config; the §C override write + advance handlers; new gate styles. |
| `app-mobile/src/i18n/locales/en/onboarding.json` | MOD | `launch_gate` copy block (experience-app voice, no dating framing). |
| `app-mobile/src/hooks/__tests__/useLaunchCityGate.test.ts` | NEW | §F.1 happy-path test (4 cases). |
| `app-mobile/scripts/ci/orch-1028-launch-city-gate-check.mjs` | NEW | CI runner wrapping the Node test. |
| `app-mobile/package.json` | MOD | `test:orch-1028` script. |

---

## Old → New receipts

### `useLaunchCityGate.ts` + `launchCityGateLogic.ts` (NEW)
**Before:** no launch-city concept in app-mobile.
**Now:** `checkLaunchCity(lat,lng)` resolves a `LaunchGateResult` discriminated union — `in_city` / `out_of_city` / `no_live_cities` / `check_failed`. Validates coords (no network on bad input), 6s timeout, malformed-body guard, never throws. The (body,error)→result decision lives in `launchCityGateLogic.ts` (RN-free) so it is directly unit-testable. Types mirror ORCH-1027 §C.3 exactly.
**Why:** SPEC §A.1 (locked union, never-throws, 6s cap, contract-typed).
**Lines:** ~75 (hook) + ~115 (logic).

### `OnboardingFlow.tsx` — `captureLocation` gate insertion
**Before:** after a successful GPS capture, set `granted` + success haptic + `persistStep(4)` + a 1200ms `setTimeout(goNext)` auto-advance. Locale detection followed.
**Now:** after `granted`/haptic/`persistStep`, set `launchGate:'checking'`, `await checkLaunchCity(lat,lng)`, then branch: `in_city` → schedule the 1200ms auto-advance (byte-identical to before, DEC-1028-4); `out_of_city`/`no_live_cities`/`check_failed` → set the phase, NO auto-advance (the user must act). Locale detection still runs unchanged (independent of the gate, §A.3).
**Why:** SPEC §A.2 (gate runs only on a successful capture; in-city unchanged; non-in-city schedules nothing).
**Lines:** ~14.

### `OnboardingFlow.tsx` — `location` render block (4 new branches + checking overlay)
**Before:** `location` rendered `granted` / `settings` / `error` / idle by `locationStatus`.
**Now:** BEFORE those, gated by `launchGate.phase`: reassurance (`out_of_city`, paper-plane glyph, warm circle), `<LaunchCityPicker>` (`picker`, + inline write-error strip), degraded (`no_live_cities`, time-outline glyph, "Notify me"), check-failed (`check_failed`, neutral-grey refresh glyph, "Continue anyway" only after ≥2 failures). The `granted` card now shows a `checking` indicator + disables tap-to-advance while the gate is in flight (DESIGN §3.0).
**Why:** SPEC §B / DESIGN §3.
**Lines:** ~110.

### `OnboardingFlow.tsx` — gate handlers + CTA config
**Before:** `location` CTA was a single `hide:true` config.
**Now:** phase-aware: `out_of_city`→"Choose a city to explore"→picker; `picker`→"Explore {city}" (disabled until selected, loading on write); `no_live_cities`→"Notify me"→proceed-with-GPS; `check_failed`→"Try again"→re-check. Handlers: `handleLaunchGateRetry`, `handleLaunchGateProceedWithGps`, `handleLaunchGateConfirmCity` (the §C write). On confirm: `PreferencesService.updateUserPreferences(userId, {custom_lat,custom_lng,custom_location,use_gps_location:false})` → invalidate `['userPreferences',userId]` + `['userLocation',userId]` → advance. On write failure: stay on picker, surface inline error, selection intact (no silent success).
**Why:** SPEC §C, I-1028-ONE-LOCATION-OWNER, I-1028-NO-SILENT-SUCCESS.
**Lines:** ~90.

### `onboarding.json` — `launch_gate` block (MOD)
**Before:** only `location.*` keys.
**Now:** 19 `launch_gate.*` keys (reassurance / picker / no-live-cities / check-failed / continue-anyway / write-failed-inline / checking) — experience-app voice, zero dating framing.
**Why:** SPEC §B.1 / DESIGN §8 / SC-11.

---

## Spec traceability

| SC | Status | Evidence |
|----|--------|----------|
| SC-1 in-city frictionless | PASS | captureLocation `in_city` → 1200ms auto-advance preserved; live: granted "Locked in — London!" card (shot 11/15). |
| SC-2 out-of-city reassurance | PASS (code) | `out_of_city` render with `_no_city` fallback (E-6); same gate branch as the live-verified `no_live_cities`. Unit T-02. |
| SC-3 mandatory pick | PASS (code) | Picker = `liveCities` only; confirm disabled until selected; no skip affordance. DESIGN §3.B. |
| SC-4 override written | PASS | `buildLaunchCityOverride` asserts EXACTLY `{custom_lat,custom_lng,custom_location,use_gps_location:false}`, no `discover_city_*` — unit T-03 + fails-on-revert. |
| SC-5 deck reads override | PASS (code) | Writes the same four fields `useUserLocation` Priority-1 reads (§0.3). |
| SC-6 no runtime re-gate | PASS | Gate lives only in Step 3 of `OnboardingFlow`, which only mounts pre-completion (§0.7). No runtime hook. |
| SC-7 permission-denied | PASS | Gate runs only on a granted capture (§0.6); denied → existing `settings` screen, no edge call. |
| SC-8 network-fail | PASS (code) | `check_failed` → "Try again"; ≥2 failures → "Continue anyway" (GPS); gate never throws (unit: malformed/reject/timeout → check_failed). |
| SC-9 zero-live-cities | **PASS (LIVE)** | `no_live_cities` rendered live end-to-end on device (shot 07) with all 17 cities false. |
| SC-10 write-failure safety | PASS (code) | Catch → stay on picker, inline error, selection intact, no advance. |
| SC-11 voice | PASS | All `launch_gate` copy reassuring/experience-app; no dating lexicon. |
| SC-12 tests | PASS | §F.1 at `src/hooks/__tests__/useLaunchCityGate.test.ts`, 4/4 green, fails-on-revert verified. |

---

## Live-fire evidence (iPhone 17 Pro, iOS 26.4, sim `17091E60`; bundled from anchor Metro 8101)

Real GPS (sim set to London 51.5072,-0.1276) + real `check-launch-city` calls.

- **`no_live_cities` (LIVE, screenshot `/tmp/orch1028-shots/07_perm.png`):** with all 17 cities `is_live_for_consumers=false`, a real GPS capture fired the gate; edge returned `{liveCities:[]}`; the degraded screen rendered pixel-correct — `time-outline` glyph in the warm circle, "We're almost ready", "Mingla is launching very soon…", "Notify me" CTA, Back chevron. No red, no error chrome.
- **`in_city` granted passthrough (LIVE, `11_outofcity.png`/`15_recheck.png`):** existing "Locked in — London!" green-check card + "Tap to continue" — unchanged frictionless path.
- **Edge `out_of_city` contract (LIVE curl):** flipped Lagos live → `check-launch-city {51.5072,-0.1276}` returned `{inLaunchCity:false, matchedCity:null, liveCities:[Lagos…]}` (HTTP 200) — the exact `out_of_city` input; then set Lagos back to false.

**Not captured on-device — `out_of_city` reassurance + picker + write screenshots.** Blocker: both standing sims lost their cached Supabase session during the foreground-close/relaunch cycles, and a clean reinstall cleared the keychain. Re-authentication requires phone+OTP, which cannot be completed autonomously (no SMS access). The `out_of_city` reassurance render is the SAME `captureLocation` gate branch as the live-verified `no_live_cities` (differs only by `launchGate.phase`), and the picker selection + the override write key-set are unit-tested with fails-on-revert. Recommend the tester (who can drive a fresh OTP login) capture the out_of_city + picker + write screenshots in the adversarial pass (§F.2/§F.3).

**Production left safe:** all 17 `seeding_cities.is_live_for_consumers=false` (verified `live_count=0/17`); test users `c727d491` (Seth) + `b17e3e15` (Ava) `has_completed_onboarding=true` (restored); Ava's preferences untouched (DC override intact). Anchor checkout restored to its pre-staging state (the other session's ORCH-1031 dirty files intact; zero trace of my files).

---

## Regression test

- **Path:** `app-mobile/src/hooks/__tests__/useLaunchCityGate.test.ts` (+ CI runner `scripts/ci/orch-1028-launch-city-gate-check.mjs`, `npm run test:orch-1028`).
- **Runner:** `node --experimental-strip-types --test` (this app has no jest; the repo CI convention is node `.mjs` runners). 4 cases: in-city→frictionless, out-of-city→must-pick, override-write-key-set (exact four keys, no `discover_city_*`), coord guard.
- **Passing run:** `# pass 4 # fail 0`.
- **fails-on-revert verified at `5fe7e34b3`:** reverting the `in_city` branch + adding a `discover_city_id` key → `# pass 2 # fail 2` (the in_city + write-keyset assertions fail); restoring → `# pass 4 # fail 0`.

The tester writes the adversarial test (§F.2) separately.

---

## Invariant verification

| Invariant | Preserved | How |
|-----------|-----------|-----|
| I-1028-ONE-LOCATION-OWNER | Y | `buildLaunchCityOverride` writes exactly the 4 `custom_*`/`use_gps_location` keys; unit T-03 asserts the key-set + absence of `discover_city_*`. |
| I-1028-ONBOARDING-ONLY | Y | Gate only in Step 3 of `OnboardingFlow` (mounts pre-completion only, §0.7). No runtime hook added. |
| I-1028-GATE-AFTER-CAPTURE | Y | Gate invoked inside `captureLocation` after `setData`, only on a granted capture. |
| I-1028-CONTRACT-CONSUMED | Y | Types mirror ORCH-1027 §C.3; header cites the contract owner. |
| I-1028-NEVER-STRANDED | Y | in_city auto-advances; out_of_city picks; no_live_cities/check_failed proceed/retry escapes. |
| I-1028-NO-SILENT-SUCCESS | Y | Write-failure catch keeps the user on the picker with a surfaced error; no advance. |
| I-LOCATION-INVALIDATE-ON-LOCATION-ONLY | Y | Invalidates the two location keys only after a real location write (a city pick). |
| I-DATING-FRAMING-FORBIDDEN | Y | All `launch_gate` copy is experience-app voice; no dating lexicon. |

---

## Cross-surface impact

- **Consumer iOS + Consumer Android:** YES — one shared RN code path → gate parity automatic. Android glass surfaces (picker rows + filter) use the opaque ≥0.92 fallback + `overflow:'hidden'` + no Android shadow (META-ORCH-1002).
- Buyer-anon Web / Business iOS / Business Android / Admin / Business Web preview: NO — no consumer onboarding flow on those surfaces.

---

## Verification matrix

- `tsc --noEmit`: clean on all touched files (`useLaunchCityGate.ts`, `launchCityGateLogic.ts`, `LaunchCityPicker.tsx`, `OnboardingFlow.tsx`, the test). Pre-existing repo-baseline tsc noise (BoardDiscussion, ConnectionsPage, TripCard, Deno test files, packages/phone-input symlink) is unrelated and untouched.
- `eslint` on the 3 new code files: clean (exit 0). `OnboardingFlow.tsx` has only pre-existing unescaped-entity errors at lines 464/480/496 (far from my edits) + pre-existing exhaustive-deps warnings.
- META-ORCH-1002 Android-glass CI checks: my files do not appear in the 6 pre-existing FAILs (IncomingPairRequestCard / PairingInfoCard).
- Unit test: 4/4 PASS + fails-on-revert.
- Live edge contract: HTTP 200 + correct shape (no_live_cities live, out_of_city via curl).

---

## Discoveries for orchestrator

1. **Re-entry / persisted-resume on the location step (latent, low-severity).** When onboarding resumes mid-flow with `data.locationGranted` persisted true, the location step shows the cached `granted` "Tap to continue" card without re-running the gate (the `[navState.subStep]`-keyed entry effect cannot re-run the gate because `data.coordinates` is not hydrated when it fires — the same hydration race the original location-status effect comment warns about). On a genuine first-run the gate runs on every fresh Enable-Location press, so the empty-deck-prevention goal holds; this only affects a same-session back-out-then-resume, and the gate is onboarding-time-only by design (DEC-1028-1). I deliberately did NOT add a racy parallel gate call to the entry effect (tried it; it stomped captureLocation's gate state on device). If the operator wants the re-entry path also gated, the clean fix is to re-invoke `captureLocation` itself (single owner) once `data` has hydrated — flag for a follow-up if desired. Not a launch blocker.
2. **App has no jest** — the regression test uses `node --experimental-strip-types --test` via a `scripts/ci/*.mjs` runner (the repo's existing CI convention). Worth standardizing if more behavioral hook tests land.

---

## Transition items

None.
