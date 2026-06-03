# SPEC — ORCH-1028 [Onboarding launch-city gate + full responsive polish]

**Status:** SPEC complete. Part 1 IMPLEMENT is BLOCKED on ORCH-1027 `check-launch-city` deploy (§0.2 / HARD GUARD). Part 2 (responsive polish) is unblocked.
**Author:** mingla-forensics (SPEC mode), 2026-05-31.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1028-[onboarding-launch-city-gate]/` on branch `ORCH-1028-onboarding-launch-city-gate`.
**Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`). No web/business/admin surface touched.
**Upstream dependency (frozen contract):** ORCH-1027 `check-launch-city` edge function — full contract at `~/Desktop/mingla-orchs/ORCH-1027-[launch-cities-admin]/Mingla_Artifacts/specs/SPEC_ORCH-1027_LAUNCH_CITIES_ADMIN.md` §C. This SPEC consumes it; it does NOT redefine it.

---

## 0. Verified live-system realities (Phase 1 — do NOT re-investigate)

Every claim below is read from live source in this worktree on 2026-05-31. File:line citations are authoritative.

### 0.1 Onboarding is a 7-step / 17-substep state machine
`app-mobile/src/hooks/useOnboardingStateMachine.ts:11-19` — `STEP_SUBSTEPS`:
- Step 1: `language, welcome, phone, otp, gender_identity, details`
- Step 2: `value_prop, intents`
- **Step 3: `location`** ← the gate's host step
- Step 4: `celebration, categories, transport, travel_time`
- Step 5: `friends_and_pairing`
- Step 6: `collaborations`
- Step 7: `consent, getting_experiences`

All 17 render branches live in `OnboardingFlow.tsx` `renderContent()` (grep-confirmed: `if (subStep === '…')` at lines 1952, 1965, 2037, 2121, 2184, 2214, 2316, 2356, **2407 (location)**, 2556, 2567, 2630, 2659, 2755, 2819, 2844, 2853). The shell wrapper is `OnboardingShell` (`OnboardingFlow.tsx:2871`), the per-substep CTA is built by `getCtaConfig()` (`OnboardingFlow.tsx:1877-1944`).

### 0.2 The gate runs AFTER location capture, BEFORE auto-advance to Step 4
`captureLocation()` (`OnboardingFlow.tsx:1313-1419`) resolves GPS (`locationService.getCurrentLocation()`, 10s race), reverse-geocodes the city name (`throttledReverseGeocode`), then:
- sets `data` = `{ locationGranted:true, coordinates:{lat,lng}, cityName, useGpsLocation:true }` (lines 1341-1347),
- `setLocationStatus('granted')` (1349),
- success haptic (1351),
- **auto-advances after 1200ms**: `autoAdvanceRef.current = setTimeout(() => goNextRef.current(), 1200)` (line 1355).

The `inLaunchCity` decision MUST be inserted in this window — between a successful capture and the auto-advance — because that auto-advance (and the manual "tap to continue" in the `granted` render at `OnboardingFlow.tsx:2412-2431`) is the ONLY path off the location step. **The `check-launch-city` edge function is NOT present in this worktree** (`ls supabase/functions/ | grep launch` → empty) — confirmed: ORCH-1027 owns the deploy. Part-1 IMPLEMENT is blocked until it is live (HARD GUARD).

### 0.3 The main-deck location override fields (the ONE owner to write)
`app-mobile/src/types/preferences.ts:24-31` — the `preferences` table carries:
```ts
custom_location?: string | null;   // city name
custom_lat?: number | null;
custom_lng?: number | null;
use_gps_location: boolean;          // NOT NULL DEFAULT TRUE in DB
```
`useUserLocation.ts:140-143` reads exactly these four from the React-Query `['userPreferences', userId]` cache; `fetchLocationCore` (`useUserLocation.ts:50-103`) branches: `useGps = (useGpsFlag !== false)`. When `use_gps_location === false` it returns `{lat: custom_lat, lng: custom_lng}` (Priority 1, lines 53-58). **This is the exact override the main recommendations deck consumes** (`RecommendationsContext.tsx` reads `useUserLocation`). Writing `custom_lat/lng/location + use_gps_location:false` makes the deck resolve to the chosen city. **This is the ONLY truth we write** (Constitution rule 2: one owner per truth). The `discover_city_*` fields (`preferences.ts:47-51`) are a SEPARATE Discover-tab override and MUST NOT be touched (CityPickerSheet hard-guard, `CityPickerSheet.tsx:15-17`).

### 0.4 The write API
`PreferencesService.updateUserPreferences(userId, partial)` (`preferencesService.ts:65-81`) — `supabase.from("preferences").upsert({ profile_id: userId, ...partial, updated_at })`. **Throws on error** (line 78). This is the pattern `CityPickerSheet.tsx:217-223` uses for its 5 `discover_city_*` columns. The gate reuses this method with the `custom_*` keys instead.

### 0.5 captureLocation already stores coordinates we can reuse for the gate call
After a successful capture, `data.coordinates = {lat,lng}` (`OnboardingFlow.tsx:1344`) holds the device point. The gate call (`check-launch-city {lat,lng}`) uses these — no second GPS resolve needed. The reverse-geocoded `data.cityName` (1345, may be null) is NOT used for the gate decision (bbox math is server-side); it is only the user's real-city label for the reassurance copy.

### 0.6 Location-permission-denied path never reaches capture
`handleLocationRequest()` (`OnboardingFlow.tsx:1422-1453`): if `status !== 'granted'` and `!canAskAgain` → `setLocationStatus('settings')` (1437) and returns; if the request is denied → `setLocationStatus('settings')` (1445). `captureLocation()` is called ONLY on `granted` (1430, 1443). **Therefore: no GPS permission → no `{lat,lng}` → the gate cannot and does not run.** The user is parked on the `settings` render (`OnboardingFlow.tsx:2433-2474`) which already has "Open Settings" + "I've turned it on — retry" and NO skip — GPS is already mandatory in onboarding (`useOnboardingStateMachine.ts:67-70`: `'manual_location'` removed, "GPS is mandatory"). The gate inherits this: a user who never grants location never advances past Step 3, gate or no gate. (Edge case E-1.)

### 0.7 Onboarding only mounts for non-onboarded users (gate cannot re-fire)
`AppStateManager.tsx` gates `showOnboardingFlow` on `has_completed_onboarding`. `GettingExperiencesScreen` (Step 7b) writes `profiles.has_completed_onboarding = true` (`OnboardingFlow.tsx:266-273`) at the very end. Once true, `OnboardingFlow` never mounts again (sign-out resets it: `AppStateManager.tsx:372-373`). **The gate lives inside Step 3 of a flow that only runs pre-completion → it is structurally onboarding-time-only.** This satisfies the operator's locked decision (§1, DEC-1028-1): NO runtime re-gate exists because the host never remounts post-onboarding. (Edge case E-5.)

### 0.8 Existing responsive infrastructure is present but UNUSED by onboarding
`app-mobile/src/utils/responsive.ts` exports `scale`/`s`, `verticalScale`/`vs`, `moderateScale`/`ms`, `moderateVerticalScale`/`mvs` (reference frame iPhone 14 = 390×844). `designSystem.ts:243-263` exports `responsiveSpacing` (`vs()`-scaled) and `responsiveTypography` (`ms()`-scaled). **The onboarding screens use the UNSCALED `spacing` + `typography` tokens** (e.g. `locHeadline` uses `typography.xxxl` = fixed `fontSize:32` at `OnboardingFlow.tsx:3553-3554`; `welcomeName` is a raw `fontSize:40` at line 2958; `nameGreeting` raw `fontSize:36` at line 2994). This is the root of the Part-2 small-screen overflow risk.

### 0.9 SCREEN_WIDTH/HEIGHT are captured once at module load (no rotation/fold update)
`OnboardingFlow.tsx:99` — `const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')` at module scope. Consumed by `INTENT_CARD_WIDTH` (line 102), the value_prop carousel page width (lines 2328-2338), the category grid tile width (line 3266), and `valuePropCenter.minHeight = SCREEN_HEIGHT * 0.55` (line 2945). A module-load capture does not react to rotation, Android foldables, or split-view. (Part-2 finding R-2.)

### 0.10 Comms ledger acks (read on entry)
- **COMMS-0003** (WARN, ALL — external-API docs cited at SPEC): `check-launch-city` is a FROZEN ORCH-1027 contract calling NO third-party API (ORCH-1027 §C.6). This SPEC introduces no new external-API param/payload. The only network call is `supabase.functions.invoke('check-launch-city', {body:{lat,lng}})` whose contract is documented in ORCH-1027 §C.2/C.3. Acked — N/A for new external-API docs.
- **COMMS-0004** (WARN, ALL — INTAKE scan for double-booked ORCH-IDs): N/A, this is a SPEC turn, not an INTAKE.
- **COMMS-0002** (WARN, ALL — strict-grep C7 blocks new `supabase/functions/` files): **N/A for ORCH-1028** — this ORCH adds NO migration and NO edge function (ORCH-1027 owns the only backend artifact). Part 1 is client-only; Part 2 is client-only. No backend allowlist entry needed.

No BLOCK rows target ORCH-1028, mingla-forensics, or ALL+OPEN. No new cross-ORCH discovery this turn.

---

## 1. Goal & operator-locked decisions

**Goal:** prevent a first-run user in a non-launch city from landing on an empty deck. After the existing GPS capture in onboarding Step 3, call `check-launch-city {lat,lng}`. If the device point is inside a live city, onboarding continues unchanged (frictionless). If not, show a reassuring "Mingla isn't in your city yet" screen, then a MANDATORY picker of live cities ("travel to one"). On pick, write that city's center into the main-deck override (`custom_lat/lng/location` + `use_gps_location:false`). That's it — no runtime re-gate. **Part 2** independently hardens every onboarding screen across the device-size matrix.

**Operator-locked decisions (2026-05-31):**
- **DEC-1028-1 (ONBOARDING-TIME ONLY).** The gate's sole purpose is the empty-first-deck prevention. There is NO runtime re-gate, NO stickiness enforcement, NO post-onboarding re-check. If a user later flips back to GPS in their non-launch city and gets an empty deck, that is ACCEPTED and OUT OF SCOPE. The gate writes the override once during onboarding; done. (Structurally guaranteed by §0.7.)
- **DEC-1028-2 (MANDATORY pick, no skip).** Out-of-city users MUST pick a live city to proceed. No "skip" / "continue anyway" affordance — their real city has no servable places (empty deck) so a skip would defeat the gate. (Mirrors the existing GPS-mandatory posture, §0.6.)
- **DEC-1028-3 (reuse the `custom_*` override; do NOT invent columns).** One owner per truth — the gate writes the SAME fields `useUserLocation` already reads (§0.3). No new preference column.
- **DEC-1028-4 (in-city = byte-unchanged flow).** When `inLaunchCity === true`, the location step behaves EXACTLY as today (capture → 1200ms auto-advance → Step 4). Zero added latency beyond the single edge round-trip, which overlaps the existing 1200ms window.

---

## 2. Scope & Non-Goals

### In scope
- **(P1-A)** A gate hook/helper that calls `check-launch-city {lat,lng}` after `captureLocation()` succeeds and resolves `inLaunchCity` + `liveCities`, with full error/empty handling.
- **(P1-B)** Two new onboarding UI states inside Step 3 (`location` substep): the **reassurance screen** and the **mandatory live-city picker**. Both rendered within the existing `OnboardingShell` + location-render block; no new substep is added to the state machine (§7 DEC-1028-5).
- **(P1-C)** The preferences write on pick (`custom_lat/lng/location` + `use_gps_location:false`) via `PreferencesService.updateUserPreferences`, then advance to Step 4.
- **(P1-D)** i18n copy for the new screens (`onboarding.json` `launch_gate` block) — experience-app voice, reassuring, NOT dating.
- **(P2)** Full cross-device responsive/visual audit + concrete fixes for ALL 17 onboarding substeps + `OnboardingShell` across the device matrix (iPhone SE 3 375pt-class … Pro Max 430pt; small + large Android incl. Android 15 edge-to-edge).
- Tests at real `app-mobile/**/__tests__/**` paths (Step 0.5 gate, §F).

### Non-goals (explicit)
- **The `check-launch-city` edge function / `seeding_cities` schema / admin tab** — owned by ORCH-1027. This SPEC consumes the frozen contract only.
- **Any runtime / post-onboarding re-gate, stickiness, or re-check** — explicitly rejected (DEC-1028-1).
- **Changing GPS-permission flow** (`settings`/`error` renders) — left intact; the gate only runs after a SUCCESSFUL capture (§0.6).
- **Discover-tab `discover_city_*` override** — untouched (§0.3).
- **The Discover `CityPickerSheet` component itself** — reused only as a WRITE-PATTERN precedent; the gate picker is a NEW, in-onboarding component (the gate picks from the FROZEN `liveCities` list, not free-text Google autocomplete — §B.2 DEC-1028-6).
- **Profile/IP-geo fallback when GPS is unavailable** — out of scope; no GPS = parked on the existing mandatory `settings` screen (§0.6, E-1).
- **A full visual redesign of any onboarding screen** — Part 2 is responsive-robustness + safe-area + scaling fixes, not a re-art-direction. Screens needing genuine design (the two NEW gate screens) route a `mingla-designer` pass (§B.0).

### Assumptions
- ORCH-1027's `check-launch-city` ships before ORCH-1028 Part-1 IMPLEMENT, returning the §C-frozen shape. If the contract changes, this SPEC's §B is revisited.
- At least 1 launch city is live before a real consumer onboards (else every user hits the empty-`liveCities` degraded path, E-3 — which is handled but is a launch-readiness flag, not a code bug).

---

## 2.5 Cross-Surface Impact (MANDATORY)

| # | Surface | Covered? | Behaviour / files / parity |
|---|---------|----------|----------------------------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | **YES** | Gate runs in onboarding Step 3; reassurance + picker screens render; override written. Part-2 fixes apply. Files: `OnboardingFlow.tsx`, new `useLaunchCityGate.ts` hook, new `LaunchCityGate` render block + `LaunchCityPicker` component, `onboarding.json`, `OnboardingShell.tsx` (safe-area), the 17 substep style blocks. |
| 2 | **Consumer Android** (`app-mobile/` Android) | **YES** | Same code path (shared RN) → gate parity is AUTOMATIC. Part-2 has Android-SPECIFIC requirements (edge-to-edge insets, `softwareKeyboardLayoutMode:"resize"` already set in `app.json:39-41`) → manual per-platform success criteria (SC-P2-A-*). |
| 3 | Buyer/anonymous Web (`mingla-business/`) | NO | No onboarding flow on buyer-anon web; nothing to render. |
| 4 | Business iOS (`mingla-business/`) | NO | Separate app + separate onboarding (Stripe Connect); launch-city gate is a consumer concept. |
| 5 | Business Android (`mingla-business/`) | NO | Same as #4. |
| 6 | Admin Web (`mingla-admin/`) — adjacent | NO | ORCH-1027 owns the admin Launch-Cities tab; nothing here. |
| 7 | Business Web preview — adjacent | NO | Not a consumer surface. |

Gate parity across #1/#2 is automatic (one RN code path). Part-2 responsive parity is MANUAL where platform behavior diverges (safe-area/edge-to-edge/keyboard) → those carry per-platform SCs.

---

## A. Part 1 — Gate logic layer (the edge-fn call + decision)

### A.1 New hook: `useLaunchCityGate`
**New file:** `app-mobile/src/hooks/useLaunchCityGate.ts`

**Purpose:** encapsulate the `check-launch-city` call + the resolved decision, so `OnboardingFlow` stays declarative. Pure async helper exposed via a hook (no React Query needed — it's a one-shot pre-auth call).

**Contract (LOCKED):**
```ts
import { supabase } from '../services/supabase'
import { logger } from '../utils/logger'

// Mirrors ORCH-1027 §C.3 FROZEN response. Do NOT widen without re-coordinating with ORCH-1027.
export interface LaunchCity {
  id: string
  name: string
  center_lat: number
  center_lng: number
}
export interface LaunchCityWithBbox extends LaunchCity {
  bbox_sw_lat: number; bbox_sw_lng: number; bbox_ne_lat: number; bbox_ne_lng: number
}
export interface CheckLaunchCityResponse {
  inLaunchCity: boolean
  matchedCity: LaunchCity | null
  liveCities: LaunchCityWithBbox[]
}

// Discriminated result the gate UI branches on.
export type LaunchGateResult =
  | { status: 'in_city'; matchedCity: LaunchCity; liveCities: LaunchCityWithBbox[] }
  | { status: 'out_of_city'; liveCities: LaunchCityWithBbox[] }        // >=1 live city to pick
  | { status: 'no_live_cities' }                                       // liveCities == []
  | { status: 'check_failed' }                                         // network/500/timeout/malformed

export async function checkLaunchCity(lat: number, lng: number): Promise<LaunchGateResult>
```

**Behavior (LOCKED):**
1. Validate inputs are finite numbers in range before calling (defensive; the captured GPS point always is). If not finite → return `{status:'check_failed'}` without a network call.
2. `await supabase.functions.invoke('check-launch-city', { body: { lat, lng } })` wrapped in a **6s timeout** (`withTimeout` util, `OnboardingFlow.tsx:45` already imports it) — the location step already budgets a 10s GPS race + 1200ms; a 6s edge cap keeps the worst case bounded.
3. On `error` (Supabase transport error), non-2xx, thrown, timeout, or a body missing the `inLaunchCity` boolean / `liveCities` array → `{status:'check_failed'}` (log via `logger.onboarding`, never throw to the caller).
4. On valid body:
   - `inLaunchCity === true && matchedCity` → `{status:'in_city', matchedCity, liveCities}`.
   - `inLaunchCity === false && liveCities.length > 0` → `{status:'out_of_city', liveCities}`.
   - `liveCities.length === 0` (regardless of `inLaunchCity`) → `{status:'no_live_cities'}`.
5. NEVER throws. The location step must always get a terminal result so it can decide whether to advance or branch.

**🔒 LOCKED:** the `LaunchGateResult` discriminated union, the 4 terminal statuses, never-throws contract, 6s timeout cap, response typed to ORCH-1027 §C.3 exactly. **🎨 OPEN:** internal timeout implementation (`withTimeout` vs `Promise.race`); whether to add a single silent retry on `check_failed` before resolving (allowed, ≤1 retry, must still cap at 6s total).

### A.2 Wiring into `captureLocation` (`OnboardingFlow.tsx:1313-1419`)
The decision is invoked **after** the successful-capture `setData(...)` (line 1347) and **before** the auto-advance `setTimeout` (line 1355). New gate-status component state drives the render branch:

```ts
type LaunchGateUiState =
  | { phase: 'idle' }            // gate not yet run / in-city (transparent passthrough)
  | { phase: 'checking' }        // edge call in flight
  | { phase: 'out_of_city'; liveCities: LaunchCityWithBbox[] }
  | { phase: 'picker'; liveCities: LaunchCityWithBbox[] }   // user tapped "Choose a city"
  | { phase: 'no_live_cities' }
  | { phase: 'check_failed' }
const [launchGate, setLaunchGate] = useState<LaunchGateUiState>({ phase: 'idle' })
```

**Sequence inside `captureLocation`, replacing lines 1349-1355 region (LOCKED order):**
1. `setLocationStatus('granted')` and the success haptic stay.
2. **Do NOT immediately set the 1200ms auto-advance.** Instead `setLaunchGate({ phase:'checking' })` and `const result = await checkLaunchCity(loc.latitude, loc.longitude)`.
3. Branch on `result.status`:
   - `'in_city'` → behave EXACTLY as today: `setLaunchGate({phase:'idle'})`, keep `useGpsLocation:true` in `data`, run `persistStep(4)` + the locale-detection block (lines 1357-1408 unchanged), then `autoAdvanceRef.current = setTimeout(()=>goNextRef.current(), 1200)`. (DEC-1028-4 — frictionless.)
   - `'out_of_city'` → `setLaunchGate({phase:'out_of_city', liveCities})`. NO auto-advance is scheduled. The reassurance screen takes over (§B.1). The locale-detection block still runs in the background (harmless; locale ≠ deck location).
   - `'no_live_cities'` → `setLaunchGate({phase:'no_live_cities'})` (degraded screen §B.4). NO auto-advance.
   - `'check_failed'` → `setLaunchGate({phase:'check_failed'})` (retry screen §B.5). NO auto-advance.

**🔒 LOCKED:** the gate runs only on a SUCCESSFUL capture; `in_city` is byte-identical to the current flow (auto-advance + locale + persist preserved); no auto-advance is scheduled for any non-`in_city` branch (the user must act). **🎨 OPEN:** whether the `checking` phase shows a tiny inline spinner over the existing `granted` card or just holds the `granted` card an extra beat (the edge call typically resolves <500ms; either is acceptable as long as it never strands).

### A.3 Locale detection is independent of the gate
The currency/measurement locale write (`OnboardingFlow.tsx:1357-1408`) keys off the reverse-geocoded REAL-city country, not the chosen launch city. It runs regardless of gate branch and is correct as-is — a user's currency follows their real country even when their deck travels to a launch city. (Observation O-1; no change.)

---

## B. Part 1 — Gate UI (rendered inside the `location` substep)

All gate screens render INSIDE the existing `if (subStep === 'location')` block (`OnboardingFlow.tsx:2407`), gated by `launchGate.phase`, BEFORE the existing `locationStatus`-driven renders. They reuse `OnboardingShell` chrome (progress bar stays on Step 3; `hidePrimaryCta` toggled per screen).

### B.0 Designer gate (MANDATORY before shipping the 2 NEW screens)
The reassurance screen (§B.1) and the live-city picker (§B.2) are NEW visible surfaces with no existing design. Per the granularity protocol, their granular visual contract (exact tokens, all 9 states, spacing, typography, motion, light/dark contrast ratios, premium-craft, no-AI-slop bans, References-examined) is produced by `mingla-designer` in a DESIGN pass THIS spec requires and references: **`Mingla_Artifacts/specs/DESIGN_ORCH-1028_LAUNCH_CITY_GATE.md`**. This SPEC owns the functional contract + IA + copy + UX acceptance bar below; the designer owns the pixel contract. The implementor MUST NOT ship pixels the designer hasn't pinned. The designer reuses the onboarding glass tokens (`designSystem.ts:265+ glass`), `responsiveTypography`/`responsiveSpacing` (mandatory here — these are small-text-heavy list screens), and the existing `locContainer`/`locGlassCard`/`locGlassButton` primitives so the gate visually belongs to Step 3.

### B.1 Reassurance screen — `phase: 'out_of_city'`
**Intent:** cool, assuring, experience-app voice. The user just granted location and learned Mingla isn't live where they are — do NOT make them feel rejected. Reframe to "you can still explore a live city."

**Layout (LOCKED structure, designer pins pixels):**
- Glass icon card (reuse `locGlassCard` 100×100) with a warm, non-alarming glyph (e.g. `navigate` / `compass-outline` / `sparkles` — designer picks; NOT an error/alert icon, this is not a failure).
- Headline (`launch_gate.out_of_city_headline`).
- Body (`launch_gate.out_of_city_body`) — names the real city when `data.cityName` is non-null, falls back to a city-agnostic line when null (§0.5 — `cityName` can be null after a geocode failure; the copy MUST handle both, NEVER render "your area"/"null").
- Primary CTA via `OnboardingShell` bottom bar: `launch_gate.out_of_city_cta` ("Choose a city to explore") → `setLaunchGate({phase:'picker', liveCities})`. `hidePrimaryCta = false`, enabled.
- NO secondary "skip"/"continue anyway" (DEC-1028-2). The shell's existing Back chevron stays (it returns to Step 2/intents — acceptable; re-running location re-runs the gate).

**Copy (LOCKED — experience-app voice, reassuring, NOT dating; final wording is OPEN to `mingla-product`/designer within this intent):**
```json
"launch_gate": {
  "out_of_city_headline": "We're not in {{city}} yet",
  "out_of_city_headline_no_city": "We're not in your city yet",
  "out_of_city_body": "Mingla is just getting started — we're rolling out city by city. Pick one of our live cities below and we'll plan around it. We'll let you know the moment we land near you.",
  "out_of_city_cta": "Choose a city to explore",
  "picker_headline": "Where do you want to explore?",
  "picker_body": "We'll fill your deck with the best of one of these cities.",
  "picker_search_placeholder": "Search live cities",
  "picker_empty_search": "No live city matches that.",
  "picker_confirm": "Explore {{city}}",
  "no_live_cities_headline": "We're almost ready",
  "no_live_cities_body": "Mingla is launching very soon. Leave us your spot and we'll text you the moment your city goes live.",
  "no_live_cities_cta": "Notify me",
  "check_failed_headline": "Hmm, that didn't go through",
  "check_failed_body": "We couldn't check your city just now. Tap to try again.",
  "check_failed_cta": "Try again"
}
```

### B.2 Live-city picker — `phase: 'picker'`
**New component:** `app-mobile/src/components/onboarding/LaunchCityPicker.tsx` (in-onboarding; NOT the Discover `CityPickerSheet`).

**DEC-1028-6 (pick from the frozen list, NOT free-text autocomplete):** the picker renders ONLY `liveCities` from the edge response. The user is "traveling to" a known launch city — free-text Google autocomplete would let them pick a non-live city and re-land on an empty deck. The list is small (live-city count) and may include an inline filter `TextInput` that filters the in-memory `liveCities` by name (no network) when the list grows past ~8.

**Layout (LOCKED):**
- Headline (`launch_gate.picker_headline`) + body (`launch_gate.picker_body`).
- A vertical list of live-city rows: each row shows the city name (and country if the contract later adds it — currently `liveCities` carries `{id,name,center_lat,center_lng,bbox_*}`, no country; name-only is correct). Row = 44pt min touch target, selected state highlights.
- Optional in-memory filter input (OPEN; required only if `liveCities.length > 8`).
- Selecting a row sets a local `selectedCity`. The shell primary CTA becomes `launch_gate.picker_confirm` ("Explore {city}"), disabled until a row is selected; on press → the write + advance (§C).
- **All 9 states:** loading (N/A — list is already in memory from the edge response), populated (the rows), empty-search (filter yields nothing → `launch_gate.picker_empty_search`), submitting (write in flight → CTA spinner via shell `primaryCtaLoading`), error (write failed → inline toast/row, stay on picker — §C error path), first-time = the only time, returning N/A, offline N/A (data already fetched), degraded = covered by `no_live_cities` upstream.

**🔒 LOCKED:** pick from `liveCities` only (no free-text geo); mandatory selection before confirm; 44pt rows; write-then-advance only on confirm. **🎨 OPEN:** list vs. radio-cards vs. searchable list presentation; whether to sort by name or distance-from-user (both acceptable; if distance, compute from `data.coordinates` to each `center_lat/lng` in memory).

### B.3 In-city — `phase: 'idle'` (no new screen)
When `in_city`, `launchGate.phase` stays `'idle'` and the EXISTING `granted` render (`OnboardingFlow.tsx:2412-2431`) shows exactly as today, with the 1200ms auto-advance. Zero visible change. (DEC-1028-4.)

### B.4 Degraded — `phase: 'no_live_cities'`
Reassurance variant when the edge returns zero live cities (E-3). Same glass-card layout as §B.1 with `no_live_cities_*` copy. CTA options (LOCKED behavior, OPEN treatment):
- Primary `no_live_cities_cta` ("Notify me") MAY route to the existing waitlist path if one is trivially reachable, OR simply advance onboarding (the user still completes onboarding; their deck will be empty but that's the accepted launch-readiness state — this should essentially never happen in production because ≥1 city is live before launch, §2 assumption).
- **Decision (LOCKED for IMPLEMENT):** to avoid stranding the user, `no_live_cities` MUST offer a way to PROCEED (advance to Step 4) — the gate's job is to prevent a *surprise* empty deck, and here there is genuinely nowhere to send them. Proceeding with `use_gps_location:true` (their real city) is the honest behavior. This is the ONE non-`in_city` branch that may advance without a city pick, because no pick is possible. Flag in code with a comment citing E-3.

### B.5 Check-failed — `phase: 'check_failed'`
Edge call failed/timed out (E-2). Glass-card layout with `check_failed_*` copy + a single primary CTA "Try again" that re-invokes `checkLaunchCity(data.coordinates.lat, data.coordinates.lng)` and re-branches. **Fallback after repeated failure (LOCKED):** if the check keeps failing, the user must not be permanently stuck on Step 3. After the user has tapped "Try again" and it fails again (≥2 total failures), surface a secondary "Continue anyway" that advances with `use_gps_location:true` (real GPS) — accepting a possibly-empty deck is better than a hard dead-end when our own backend is down. (This is a degraded-availability escape, NOT a skip of DEC-1028-2 — it only appears when the gate cannot run at all.)

### B.6 Voice guard (LOCKED)
All copy is experience-app voice — reassuring, forward-looking, NEVER dating-app framing. No "matches near you", no "singles", no romance language. (Memory: Mingla is an experience app, not a dating app.) `mingla-product` MAY refine wording within the locked intent; the structure + the no-dating guard are LOCKED.

---

## C. Part 1 — Preferences write on pick (the override)

When the user confirms a city in the picker (§B.2 CTA):

```ts
// LOCKED write — the ONE owner the main deck reads (§0.3/§0.4).
await PreferencesService.updateUserPreferences(userId, {
  custom_lat: city.center_lat,
  custom_lng: city.center_lng,
  custom_location: city.name,
  use_gps_location: false,
})
```

**Sequence (LOCKED):**
1. Set shell `primaryCtaLoading=true` (CTA spinner; row taps disabled — mirror `CityPickerSheet` `persisting` guard).
2. `await PreferencesService.updateUserPreferences(...)` (throws on failure — §0.4).
3. **On success:** success haptic; invalidate the location query so the deck picks up the override on first mount — `queryClient.invalidateQueries({ queryKey: ['userPreferences', userId] })` AND `['userLocation', userId]` (the `queryClient` is already in scope, `OnboardingFlow.tsx:675`). Update the local `data` to reflect the override (`useGpsLocation:false`, `coordinates:{lat:center_lat,lng:center_lng}`, `cityName:city.name`) so any downstream onboarding read is consistent. Then advance: clear any pending `autoAdvanceRef`, `goNextRef.current()` → Step 4.
4. **On failure (write throws):** catch, set `primaryCtaLoading=false`, surface an inline error (`launch_gate` retry copy or a toast) and STAY on the picker with the selection intact — NEVER silently appear to succeed (Constitution rule 3). The user retries the same city. DB unchanged.

**🔒 LOCKED:** write exactly the 4 `custom_*`/`use_gps_location` keys (no `discover_city_*`, no new column); invalidate both location query keys; advance only after a confirmed successful write; failure stays on picker with a surfaced error. **🎨 OPEN:** inline-error vs. toast presentation; whether to also write `data.cityName` into `profiles` (not required — the deck reads `preferences`).

**Anonymous-user note:** `userId` is `user?.id`. By Step 3 the user is OTP-verified and authenticated (Step 1 `otp` precedes Step 3) — `userId` is present. If, defensively, `userId` is somehow null, skip the DB write but still advance with the chosen city held in `data` (the deck's anonymous path uses GPS; this is an unreachable edge but must not crash). (Edge case E-4.)

---

## D. Part 2 — Responsive / visual polish (per-screen audit + fixes)

**Method (LOCKED):** the implementor MUST live-fire each screen on the device matrix below and fix every overflow/clip/safe-area/keyboard defect found. The fixes are constraint-level (scaling tokens, safe-area, scroll-enablement, keyboard avoidance) — NOT re-art-direction. Where a screen's content genuinely cannot fit small screens even after scaling, it becomes scroll-enabled rather than clipped.

**Device matrix (LOCKED — verify each):**
- iPhone SE (3rd gen) — 375×667pt, smallest current iOS, no notch, no Dynamic Island.
- iPhone 14/15 — 390×844pt (the design reference).
- iPhone 15/16 Pro Max — 430×932pt, Dynamic Island.
- Small Android — ~360dp width (e.g. Pixel 4a class).
- Large Android — ~412dp width, **Android 15 edge-to-edge** (`app.json:39` `edgeToEdgeEnabled:true`) — system bars draw under content; insets MUST be honored.

### D.0 Cross-cutting fixes (apply once, benefit all screens)
- **R-1 (scaling tokens) [LOCKED]:** migrate onboarding text/spacing that is sized for the 390pt reference to the existing `responsiveTypography` / `responsiveSpacing` (`designSystem.ts:243-263`) so it shrinks gently on SE/small-Android and grows on Pro Max. Concretely: the location-step `locHeadline` (`typography.xxxl` fixed 32 → `responsiveTypography.xxxl` `ms(32)`); raw `fontSize:40` `welcomeName` (line 2958) and `fontSize:36` `nameGreeting` (line 2994) → `ms(40)`/`ms(36)`; `valuePropCenter.minHeight: SCREEN_HEIGHT*0.55` (line 2945) reviewed for SE. Do NOT blanket-replace every token — only those proven to overflow/clip on SE/small-Android in live-fire (avoid churn). This is the single highest-leverage Part-2 fix.
- **R-2 (live Dimensions) [LOCKED]:** replace the module-load `Dimensions.get('window')` capture (`OnboardingFlow.tsx:99`) consumption with `useWindowDimensions()` inside the component for any value that drives layout width/height (`INTENT_CARD_WIDTH`, value_prop carousel page width lines 2328-2338, category tile width line 3266, `valuePropCenter.minHeight`). A stale module-scope capture is wrong on rotation/fold/split-view (§0.9). Keep the module constant only where it's a one-time decorative constant.
- **R-3 (safe-area / edge-to-edge) [LOCKED]:** `OnboardingShell` already wraps `SafeAreaView edges={['top','left','right']}` + applies `insets.bottom` to the bottom bar (`OnboardingShell.tsx:271,304`). Audit confirms top/left/right/bottom are covered. **Android edge-to-edge specific:** verify the progress bar (top) clears the status bar and the bottom CTA bar clears the gesture nav bar on Android 15 — the `Math.max(insets.bottom, spacing.md)` (line 304) handles the nav bar; confirm on a real large-Android target. The two NEW gate screens render inside the shell → inherit safe-area automatically (no separate safe-area work).
- **R-4 (keyboard avoidance) [LOCKED]:** keyboard-bearing screens are `welcome` (name inputs), `phone`, `otp`, `details` (no text input — date picker), and the NEW `picker` filter input (if present). The shell uses `KeyboardAwareView` (`OnboardingShell.tsx:272`) with `disableKeyboardAvoidance` toggled per substep (line 2882). Audit: `welcome` currently has `disableKeyboardAvoidance` (line 2882) AND a deferred-focus crash workaround (`OnboardingFlow.tsx:767-779`) — verify the name fields stay visible above the keyboard on SE (smallest screen, least vertical room). The `picker` filter input MUST keep its row list scrollable with the keyboard open (`keyboardShouldPersistTaps:"handled"` — shell already sets this at line 297).

### D.1 Per-substep audit table (LOCKED checklist; implementor fills the live-fire result per device)
For EACH substep, verify on all 5 devices: (a) no vertical overflow/clip of headline/body/CTA, (b) no horizontal scroll, (c) safe-area respected top+bottom, (d) touch targets ≥44pt, (e) keyboard (where applicable) doesn't cover the active input or the CTA.

| Substep | Render @ | Known risk (from source) | Fix class |
|---------|----------|--------------------------|-----------|
| `language` | 1952 | `LanguageSelectionStep` — long scroll list; verify scroll + bottom-bar clearance | constraint — confirm scroll |
| `welcome` | 1965 | raw `fontSize:40/36` (R-1); `disableKeyboardAvoidance` + deferred focus on SE (R-4); `scrollEnabled=false` (line 2883) → name fields can't scroll above keyboard on SE | **R-1 + R-4 — likely needs scroll-on-SE or keyboard lift** |
| `phone` | 2037 | `PhoneInput` + consent checkbox + CTA; SMS consent text wraps — verify it + CTA fit SE | constraint + R-1 |
| `otp` | 2121 | `OTPInput` 6-box row — verify boxes fit 375pt width without clipping; keyboard | R-2 (width) + R-4 |
| `gender_identity` | 2184 | `scrollEnabled=false` (line 2883) + 8 gender options — verify all 8 fit SE without clip | **constraint — enable scroll if clipped on SE** |
| `details` | 2214 | birthday picker (native `DateTimePicker`) — verify modal/inline picker fits + dismisses; iOS vs Android picker differ | per-platform constraint |
| `value_prop` | 2316 | carousel page width = `SCREEN_WIDTH-48` module capture (R-2); `valuePropCenter.minHeight: SCREEN_HEIGHT*0.55` may overflow SE | **R-2 + R-1** |
| `intents` | 2356 | `INTENT_CARD_WIDTH` from module `SCREEN_WIDTH` (R-2); `scrollEnabled=false` (2883) + 6 cards — verify fit SE | **R-2 + constraint** |
| **`location`** | 2407 | `locHeadline` fixed 32 (R-1); centered `flex:1` + `paddingTop:xxl` stack (card 100 + icon 72 + headline + body + 56 button + privacy row) overflows SE; the NEW gate screens add a picker LIST that MUST scroll | **R-1 + scroll-enable for the picker; this is the ORCH's host screen — highest priority** |
| `celebration` | 2556 | `flex:1` center, icon 64 + 2 texts — low risk; confirm | constraint |
| `categories` | 2567 | `flushContent` + measured grid height (`categoryGridHeight`, line 794) + tile width from module `SCREEN_WIDTH` (R-2); 11 categories 6×2 must fit at-a-glance — the existing measure logic must hold on SE | **R-2 + verify measure on SE** |
| `transport` | 2630 | 4 transport options — low risk; confirm fit | constraint |
| `travel_time` | 2659 | presets + custom input — verify custom-time input + keyboard | R-4 |
| `friends_and_pairing` | 2755 | `OnboardingFriendsAndPairingStep` — list/scroll; verify | constraint |
| `collaborations` | 2819 | `OnboardingCollaborationStep` + `disableKeyboardAvoidance` (2882) — verify session-create input + keyboard | R-4 |
| `consent` | 2844 | `OnboardingConsentStep` — verify scroll + CTA | constraint |
| `getting_experiences` | 2853 | full-screen takeover (`hideBottomBar`, `getExpStyles` uses fixed `spacing`) — verify the 96px icon + progress + messages center on SE without clip | R-1 (review) |

### D.2 Designer-pass routing (which screens need a designer vs. pure constraint fix) [LOCKED]
- **Need a `mingla-designer` pass (genuine new/visual design):** the TWO NEW gate screens (reassurance §B.1 + picker §B.2 + the degraded/failed variants §B.4/§B.5) — captured by the §B.0 designer gate (`DESIGN_ORCH-1028_LAUNCH_CITY_GATE.md`).
- **Pure responsive-constraint fixes (no designer needed — implementor applies R-1..R-4):** `language, phone, otp, gender_identity, details, celebration, transport, travel_time, friends_and_pairing, collaborations, consent, getting_experiences`.
- **Borderline — constraint-first, designer only if a layout can't be made to fit by scaling/scroll alone:** `welcome` (raw 40/36 + keyboard on SE), `value_prop` (minHeight overflow), `intents` (6-card fit), `categories` (11-tile at-a-glance fit), and the existing `location` non-gate renders. The implementor attempts R-1..R-4 first; escalates to designer ONLY for a screen that still overflows after scaling (flag it explicitly in the IMPLEMENT report).

---

## E. Edge cases (each defined, LOCKED)

| ID | Condition | Defined behavior |
|----|-----------|------------------|
| **E-1** | Location permission DENIED (no lat/lng) | Gate never runs (§0.6). User parked on existing mandatory `settings` render (Open Settings / retry, no skip). GPS already mandatory in onboarding — unchanged. |
| **E-2** | `check-launch-city` network failure / 500 / timeout / malformed body | `checkLaunchCity` returns `{status:'check_failed'}` → §B.5 "Try again" screen. After ≥2 failures, a "Continue anyway" escape advances with `use_gps_location:true` (degraded-availability, NOT a DEC-1028-2 skip). |
| **E-3** | Zero live cities returned (`liveCities:[]`) | `{status:'no_live_cities'}` → §B.4 reassurance with a PROCEED path (advance with `use_gps_location:true`) because no pick is possible. Should not occur in production (≥1 live city assumed at launch); flag as launch-readiness, not a code bug. |
| **E-4** | `userId` null at pick time (defensive; unreachable — user is OTP-authed by Step 3) | Skip the DB write, hold the chosen city in `data`, advance without crash (§C). |
| **E-5** | User already onboarded | Gate cannot re-fire — `OnboardingFlow` only mounts pre-completion (§0.7); structurally onboarding-time-only (DEC-1028-1). No runtime re-gate code exists by design. |
| **E-6** | `data.cityName` null (geocode failed but GPS succeeded) | Reassurance copy uses the `_no_city` fallback line; NEVER renders "your area"/"null" (§B.1, mirrors existing `cityName:null` discipline at `OnboardingFlow.tsx:1345`). |
| **E-7** | User backs out of the gate (shell Back chevron) on the reassurance/picker screen | Returns to Step 2/intents (state machine §0.1); re-entering `location` re-runs capture → re-runs the gate. No stuck state. The override is only written on an explicit pick. |

---

## F. Step 0.5 regression gate — tests (HARD GUARD, real paths)

Both tests at real `app-mobile/**/__tests__/**` paths (confirmed test dirs exist: `src/hooks/__tests__`, `src/components/__tests__`, `OnboardingFlow.tsx:45` already imports `withTimeout`).

### F.1 Implementor happy-path test (REQUIRED)
**Path:** `app-mobile/src/hooks/__tests__/useLaunchCityGate.test.ts`
- **In-city → frictionless:** mock `supabase.functions.invoke('check-launch-city')` → `{inLaunchCity:true, matchedCity:{id,name,center_lat,center_lng}, liveCities:[…]}`; assert `checkLaunchCity(lat,lng)` resolves `{status:'in_city', matchedCity, liveCities}`.
- **Out-of-city → must-pick:** mock → `{inLaunchCity:false, matchedCity:null, liveCities:[oneCity]}`; assert `{status:'out_of_city', liveCities}`.
- **Override write on pick:** a `app-mobile/src/components/__tests__/onboardingLaunchGate.test.tsx` (or a focused unit on the pick handler) that mocks `PreferencesService.updateUserPreferences` and asserts it is called with EXACTLY `{custom_lat, custom_lng, custom_location, use_gps_location:false}` (the matched city's center + name) and NO `discover_city_*` keys, then that the flow advances (mock `goNext`/`queryClient.invalidateQueries` called with both `['userPreferences',userId]` and `['userLocation',userId]`).

### F.2 Tester adversarial test (REQUIRED)
**Path:** `app-mobile/src/hooks/__tests__/useLaunchCityGate.adversarial.test.ts` (+ component-level assertions where needed)
- **Permission-denied:** assert `captureLocation` is never reached without a granted permission (or, at the hook level, that the gate is never invoked without finite coords) → no `check-launch-city` call (E-1).
- **Zero-live-cities:** mock → `{inLaunchCity:false, matchedCity:null, liveCities:[]}` → assert `{status:'no_live_cities'}` and the proceed path advances with `use_gps_location:true` (E-3).
- **Network-fail / 500 / timeout / malformed:** mock invoke to (a) reject, (b) return `{error}`, (c) resolve a body missing `liveCities` → each asserts `{status:'check_failed'}` and that the hook NEVER throws (A.1 never-throws contract) (E-2).
- **No silent success on write failure:** mock `updateUserPreferences` to throw → assert the flow does NOT advance and surfaces an error / stays on picker (C step 4, Constitution rule 3).

### F.3 Part-2 responsive evidence (REQUIRED for PASS)
Per the Prime Directive (live-fire), the tester runs the `location` substep + the 2 NEW gate screens + every Part-2-touched substep on the device matrix (§D, minimum: iPhone SE 3 + one large Android edge-to-edge) and captures screenshot evidence of no clip/overflow/safe-area violation. Source-only verdicts cap at `suspected` and are NOT a PASS for this UI ORCH.

---

## G. Success Criteria (numbered, observable, testable)

- **SC-1 (in-city frictionless):** GPS point inside a live city → location step auto-advances to Step 4 exactly as today; no reassurance/picker shown; `use_gps_location` stays true. (DEC-1028-4.)
- **SC-2 (out-of-city → reassurance):** point outside all live cities (≥1 live city) → reassurance screen renders with experience-app copy, the real city name when known and the `_no_city` fallback when null; no auto-advance; no skip affordance.
- **SC-3 (mandatory pick):** from reassurance → picker shows only `liveCities`; the confirm CTA is disabled until a city is selected; there is no "skip"/"continue anyway" on the picker. (DEC-1028-2.)
- **SC-4 (override written):** confirming a city writes EXACTLY `{custom_lat:center_lat, custom_lng:center_lng, custom_location:name, use_gps_location:false}` to `preferences`; no `discover_city_*` written; both location query keys invalidated; flow advances to Step 4. Verify: pick a city, then `SELECT custom_lat,custom_lng,custom_location,use_gps_location FROM preferences WHERE profile_id=…`.
- **SC-5 (deck reads the override):** after onboarding completes via the gate, the main deck resolves to the chosen city (via `useUserLocation` Priority-1 custom-coords path, §0.3) — not the user's real GPS city.
- **SC-6 (no runtime re-gate):** no code path re-checks launch-city after onboarding; flipping back to GPS post-onboarding does NOT re-trigger the gate (structurally — `OnboardingFlow` doesn't remount). (DEC-1028-1 / E-5.)
- **SC-7 (permission-denied):** denying location never calls `check-launch-city`; user stays on the existing mandatory `settings` screen. (E-1.)
- **SC-8 (network-fail):** edge failure → "Try again" screen; ≥2 failures → "Continue anyway" degraded escape advancing with GPS; never a hard dead-end; gate never throws. (E-2.)
- **SC-9 (zero-live-cities):** empty `liveCities` → reassurance-with-proceed; user can complete onboarding; not stranded. (E-3.)
- **SC-10 (write-failure safety):** a failed override write keeps the user on the picker with a surfaced error, selection intact, DB unchanged — never a silent success. (Constitution rule 3.)
- **SC-11 (voice):** all gate copy is experience-app voice, reassuring, with zero dating-app framing.
- **SC-P2-iOS (responsive iOS):** all 17 substeps + 2 gate screens render with no clip/overflow/horizontal-scroll on iPhone SE 3 (375pt) AND iPhone 15 Pro Max (Dynamic Island); CTAs reachable, touch targets ≥44pt.
- **SC-P2-A (responsive Android edge-to-edge):** same on small Android (~360dp) AND large Android 15 edge-to-edge — progress bar clears the status bar, bottom CTA clears the gesture nav bar (insets honored).
- **SC-P2-KB (keyboard):** on `welcome`/`phone`/`otp`/`travel_time`/`collaborations` and the picker filter, the keyboard never covers the active input or the primary CTA on SE.
- **SC-12 (tests):** F.1 + F.2 exist at the real `__tests__` paths and pass; F.3 live-fire evidence captured.

---

## H. Invariants

| ID | Invariant | Preserved by | Verified by |
|----|-----------|--------------|-------------|
| I-1028-ONE-LOCATION-OWNER (NEW) | The gate writes ONLY `custom_lat/lng/location` + `use_gps_location` — the same fields `useUserLocation` reads; never `discover_city_*`, never a new column. | §C write list. | SC-4 / code read. |
| I-1028-ONBOARDING-ONLY (NEW) | The gate runs only inside onboarding Step 3; no post-onboarding re-check/stickiness exists. | Host-remount structure §0.7; no runtime hook added. | SC-6 / E-5. |
| I-1028-GATE-AFTER-CAPTURE (NEW) | The gate runs ONLY after a successful GPS capture; permission-denied never invokes it. | §A.2 placement (after `setData`, on `granted` only). | SC-7 / E-1. |
| I-1028-CONTRACT-CONSUMED (NEW) | The client types match ORCH-1027 §C.3 exactly; no contract widening without ORCH-1027 coordination. | §A.1 typed to the frozen shape. | Code read vs. ORCH-1027 §C.3. |
| I-1028-NEVER-STRANDED (NEW) | The user can always reach Step 4: in-city auto-advances, out-of-city picks, no-cities/check-fail have proceed/retry escapes. | §B.4/§B.5 escapes + §A.2 branches. | SC-8 / SC-9. |
| I-1028-NO-SILENT-SUCCESS (Constitution 3) | A failed override write never appears to succeed. | §C step 4 catch + stay-on-picker. | SC-10. |
| I-LOCATION-INVALIDATE-ON-LOCATION-ONLY (existing, ORCH-0485) | Location query invalidates only on location-field change. | §C invalidates `userPreferences`+`userLocation` after a real location write (a legitimate location change). | Code read. |
| I-DATING-FRAMING-FORBIDDEN (memory) | No dating-app voice in gate copy. | §B.6 voice guard. | SC-11. |

---

## I. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | In-city | invoke→`inLaunchCity:true` | `{status:'in_city'}`; flow auto-advances; `use_gps_location` true | Hook + Component |
| T-02 | Out-of-city | invoke→`false`, `liveCities:[c]` | `{status:'out_of_city'}`; reassurance→picker shown | Hook + Component |
| T-03 | Pick writes override | confirm city `c` | `updateUserPreferences({custom_lat,custom_lng,custom_location,use_gps_location:false})`; no `discover_city_*`; advance | Service + Component |
| T-04 | Deck reads override | post-pick `useUserLocation` | resolves `c.center_lat/lng` via custom path | Hook |
| T-05 | Permission denied | status≠granted | no `check-launch-city` call; `settings` screen | Component |
| T-06 | Network fail | invoke rejects | `{status:'check_failed'}`; no throw; "Try again" | Hook + Component |
| T-07 | Timeout | invoke hangs >6s | `{status:'check_failed'}`; no throw | Hook |
| T-08 | Malformed body | invoke→`{}` (no `liveCities`) | `{status:'check_failed'}`; no throw | Hook |
| T-09 | Zero live cities | invoke→`liveCities:[]` | `{status:'no_live_cities'}`; proceed path advances w/ GPS | Hook + Component |
| T-10 | Write failure | `updateUserPreferences` throws | stays on picker; error surfaced; DB unchanged; no advance | Service + Component |
| T-11 | ≥2 check failures | fail twice | "Continue anyway" escape advances w/ GPS | Component |
| T-12 | cityName null | geocode failed | reassurance uses `_no_city` copy; no "null"/"your area" | Component |
| T-13 | No re-gate | complete onboarding via gate, remount app | gate does not re-fire | Integration/structural |
| T-14 | Responsive SE | render every substep @375×667 | no clip/overflow/h-scroll; CTA reachable | UI live-fire |
| T-15 | Responsive Android E2E | render @large Android 15 | insets honored; bars cleared | UI live-fire |
| T-16 | Keyboard SE | focus name/phone/otp/filter @SE | input + CTA visible above keyboard | UI live-fire |

---

## J. Implementation order

1. **(BLOCKED on ORCH-1027 deploy)** `useLaunchCityGate.ts` hook (§A.1) + its happy/adversarial tests (§F.1/§F.2).
2. Wire the gate into `captureLocation` (§A.2) — gate-status state + branch.
3. `mingla-designer` pass → `DESIGN_ORCH-1028_LAUNCH_CITY_GATE.md` (§B.0) for the 2 new screens.
4. Reassurance + degraded + check-failed renders (§B.1/§B.4/§B.5) inside the `location` block.
5. `LaunchCityPicker.tsx` (§B.2) + the override write + advance (§C).
6. `onboarding.json` `launch_gate` copy (§B.1), `mingla-product` voice refinement within the locked intent.
7. **(UNBLOCKED — can start immediately, parallel to 1-6)** Part-2 responsive sweep §D: R-1..R-4 cross-cutting fixes, then the per-substep audit table §D.1 on the device matrix, then escalate borderline screens to designer per §D.2.
8. Tests green (§F) + live-fire evidence (§F.3).

No `db push`, no edge deploy in this ORCH (no backend artifact). The only backend dependency — `check-launch-city` — is deployed by ORCH-1027 at its CLOSE.

---

## K. Regression prevention

- **Class:** "second location override owner drifts from the deck reader." Safeguard: I-1028-ONE-LOCATION-OWNER + T-03 asserting the exact write key-set (and the ABSENCE of `discover_city_*`) — a future dev cannot add a competing field without failing the test.
- **Class:** "a runtime re-gate sneaks in." Safeguard: I-1028-ONBOARDING-ONLY + the §0.7 structural note + SC-6 — the gate lives only in the onboarding host.
- **Class:** "edge contract drift breaks the client." Safeguard: §A.1 typed to ORCH-1027 §C.3 + a comment naming ORCH-1027 as the contract owner; if ORCH-1027 changes the shape, the type mismatch surfaces at build.
- **Class:** "small-screen overflow re-creeps as new onboarding copy is added." Safeguard: the §D matrix + the live-fire requirement (SC-P2-*) in the tester gate, and migrating to `responsiveTypography`/`responsiveSpacing` so future copy scales by default.
- **Protective comments:** the `useLaunchCityGate` header cites ORCH-1027 §C.3; the `captureLocation` gate insertion cites DEC-1028-1/4; the override write cites I-1028-ONE-LOCATION-OWNER.

---

## L. Open questions for operator (none blocking)

1. **`no_live_cities` proceed vs. waitlist (E-3):** SPEC defaults to a PROCEED path (advance with GPS) so the user is never stranded; if a waitlist capture is preferred, wire the existing waitlist path into the `no_live_cities` CTA. Should essentially never fire in production.
2. **Picker sort:** name-asc (default) vs. nearest-first (compute from the captured point). Either acceptable; OPEN.
3. **Final gate copy:** `mingla-product` may refine the `launch_gate` wording within the locked reassuring/experience-app intent.

None block SPEC delivery. Part-1 IMPLEMENT remains gated on ORCH-1027's `check-launch-city` deploy; Part-2 can start now.
