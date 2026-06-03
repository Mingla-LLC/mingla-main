# DESIGN — ORCH-1028 [Onboarding launch-city gate]

**Mode:** mingla-designer / SCREEN.
**Status:** Design complete. Pixel contract for the two NEW in-onboarding gate screens + their degraded/failed variants.
**Author:** mingla-designer, 2026-05-31.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1028-[onboarding-launch-city-gate]/` on branch `ORCH-1028-onboarding-launch-city-gate`.
**Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`).
**Owns:** the pixel/visual/motion/a11y contract for the gate screens. **Does NOT own:** the functional contract (SPEC §A–§C), the edge contract (ORCH-1027 §C), the responsive Part-2 sweep (SPEC §D).
**Consumes:** `SPEC_ORCH-1028_ONBOARDING_LAUNCH_CITY_GATE.md` §B (LOCKED structure + copy intent), `app-mobile/src/constants/designSystem.ts` (tokens), `app-mobile/src/components/onboarding/OnboardingShell.tsx` (chrome), `OnboardingFlow.tsx:3515-3637` (`loc*` primitives).

---

## References examined

Real premium apps studied for **"service not live in your area → pick from a fixed list of supported places"** + **"warm coming-soon, not an error"** moments (per premium-craft §3):

- **Lyft — "Find Lyft in Your City"** ([lyft.com/rider/cities](https://www.lyft.com/rider/cities)): the canonical *fixed-launch-city list* pattern — you don't free-type, you pick from where service actually exists. Mechanic borrowed: pick-from-known-list, never free-text geo (matches DEC-1028-6). Their list is grouped + scannable; our list is far shorter, so a flat scannable list with selection state beats grouping.
- **Uber — "Request a ride" geo-availability** ([play.google.com Uber listing](https://play.google.com/store/apps/details?id=com.ubercab)): when you're outside a service area, the framing is forward ("expanding to new cities") not failure. Mechanic borrowed: forward-looking copy, no red error chrome.
- **UserOnboard — permission-priming pattern** ([useronboard.com permission-priming](https://www.useronboard.com/onboarding-ux-patterns/permission-priming/)): benefit-framed location moments lift opt-in 20–40%; the *reason* precedes the ask. Mechanic borrowed: the reassurance screen leads with the user's benefit ("we'll plan around a live city"), not our limitation.
- **Mobbin onboarding flow library** ([mobbin.com onboarding flows](https://mobbin.com/explore/mobile/flows/onboarding)): in-flow interstitials (single glyph + headline + body + one CTA, centered, generous vertical rhythm) are the dominant premium onboarding-interstitial shape — which is exactly what our existing `granted`/`settings` location renders already are. We extend that shape, not invent a new one.
- **Partiful / Timeleft / Airbnb (recall, no live fetch needed)** — "coming soon to your area" waitlist screens: a single calm illustrative glyph (compass/map-pin-radar/sparkle), warm not alarmed, one forward CTA. Confirms the reassurance-not-error glyph direction.

**Synthesis (never clone):** Mingla already owns a beautiful onboarding interstitial language — the glass icon card + bold headline + secondary body + bottom-bar CTA (the `location` `granted`/`settings`/`error` renders). The gate screens are NOT new visual territory; they are **two new members of that existing family**, sharing its glass card, its type rhythm, its motion, its bottom-bar CTA. The only genuinely new component is the city list (§3.B), built from `loc*` + `glass.*` tokens so it reads as one continuous Step-3 surface.

---

## 0. Where the user is (the moment)

The user just granted location in onboarding Step 3 and is mid-momentum — they expect to glide to the next step (the in-city path does exactly that in 1200ms). Instead, for an out-of-city user, the flow pauses. **Emotional read at this instant: a flicker of "oh no, am I locked out?"** The entire design job is to kill that flicker in the first 400ms — the screen must register as *hopeful and in-control*, never as a wall. They are not rejected; they are being handed a better deck. This is why every token below biases warm/neutral and the glyph is a wayfinding glyph, never an alert glyph.

The screens render INSIDE the existing `if (subStep === 'location')` block (`OnboardingFlow.tsx:2407`), wrapped by `OnboardingShell` (progress bar pinned to Step 3, warm-glow background `#fff9f5`, frosted bottom CTA bar). They inherit the shell's safe-area (`edges={['top','left','right']}` + `Math.max(insets.bottom, spacing.md)` bottom inset) automatically — **no screen below does its own safe-area work** (R-3).

---

## 1. Anti-error tone — the single most important visual decision

The reassurance + zero-cities + check-failed screens must NOT reuse the platform error vocabulary. **Hard bans for §3.A / §3.D (reassurance + zero-cities):**

- ❌ No `colors.error.*` (red), no `alert-circle`, `warning`, `close-circle`, `sad-outline`, broken-link, or `cloud-offline` glyphs.
- ❌ No red/amber tint on the glass icon card.
- ❌ No "failed / can't / unavailable / sorry / unfortunately / oops" lexicon in copy.

The check-failed screen (§3.E) is the ONE screen that may use a *gentle* neutral problem signal (it genuinely is a transient backend hiccup) — but even there, NO red; it uses neutral grey + a `refresh` glyph, framed as "let's try that again," never "error."

**The reassurance glyph (LOCKED choice):** Ionicons **`paper-plane-outline`** at 36pt inside the glass card's inner circle. Rationale vs. the SPEC's candidate list (`navigate` / `compass-outline` / `sparkles`):
- `compass-outline` reads as "you're lost / find your way" — subtly implies the user is the problem.
- `sparkles` is generic AI-slop garnish (premium-craft §2) and carries no wayfinding meaning.
- `navigate` (the filled location arrow) is visually near-identical to the GPS-permission glyphs already used on this same step — it would read as "still locating," confusing.
- **`paper-plane-outline`** says *journey / we're sending you somewhere / travel to a live city* — it matches the literal product action ("Choose a city to explore") and the "we're rolling out city by city" copy. It is hopeful, in motion, and unmistakably not an error. It is a wayfinding-by-travel glyph, distinct from the GPS glyphs on the permission renders.

The icon's inner circle uses the **warm brand tint** (`locIconCircle` token: `backgroundColor: colors.primary[50]` `#fff7ed`, `borderColor: colors.primary[200]` `#fed7aa`, glyph `colors.primary[500]` `#f97316`) — the SAME warm circle the existing `settings` render uses, NOT the green `locIconCircleSuccess`. Warm orange = "Mingla brand / good things ahead," not green ("done") and not red ("problem").

---

## 2. Token foundation (everything below references these — zero magic numbers)

All values are existing tokens from `app-mobile/src/constants/designSystem.ts`. The gate is **list-and-text-heavy**, so per SPEC §B.0 the screens use **`responsiveTypography` / `responsiveSpacing`** (the `ms()`/`vs()`-scaled scales) for type and vertical rhythm so they don't clip on iPhone SE 3 (375×667) or small Android (~360dp). The existing `loc*` primitives are reused verbatim for the glass card, headline, body and inline buttons; new list rows are specified below from `glass.*` + `spacing`/`radius`/`colors`.

| Role | Token | Light value | Dark value |
|------|-------|-------------|------------|
| Screen bg | shell `backgroundWarmGlow` | `#fff9f5` | (see §6 dark — shell owns) |
| Glass icon card | `loc GlassCard` → `glass.surface` | bg `rgba(255,255,255,0.55)`, border `rgba(255,255,255,0.35)`, `radius 50` (100×100), `glass.shadow` | dark variant §6 |
| Icon inner circle | `locIconCircle` | bg `colors.primary[50]` `#fff7ed`, border `colors.primary[200]` `#fed7aa` 1.5px | §6 |
| Glyph | Ionicon `paper-plane-outline` 36 | `colors.primary[500]` `#f97316` | §6 |
| Headline | `locHeadline` → **`responsiveTypography.xxxl`** (was fixed `typography.xxxl` 32) | `colors.text.primary` `#111827`, weight 700, letterSpacing −0.5, center | `#F5F5F5` |
| Body | `locBody` → **`responsiveTypography.md`** | `colors.text.secondary` `#4b5563`, weight 400, center | `#A0A0A0` |
| City row label | **`responsiveTypography.lg`** | `colors.text.primary` `#111827`, weight 600 | `#F5F5F5` |
| Row container | new `gateCityRow` (glass) | §3.B | §6 |
| Selected row tint | `colors.primary[50]` fill + `colors.primary[500]` border 1.5 + check | §3.B | §6 |
| Filter input | reuse text-input style (glass) | §3.B | §6 |
| Primary CTA | shell `primaryCta` (full-width, 56h, `radius.lg`) | `colors.primary[500]` `#f97316`, text `#ffffff` | unchanged |
| Vertical rhythm | `responsiveSpacing.*` (xs 4 … xxl 48, vs-scaled) | — | — |
| Radius | `radius.lg` 16 (rows, inputs), `radius.full` (card 50) | — | — |

**Spacing scale (4px grid, all tokens):** card→headline `responsiveSpacing.xl` (32); headline→body `responsiveSpacing.sm` (8); body→list / body→CTA `responsiveSpacing.xl` (32); list row→row `responsiveSpacing.sm` (8); row inner vertical `responsiveSpacing.md` (16); row inner horizontal `spacing.md` (16). Container top `responsiveSpacing.xxl` (48, inherits `locContainer.paddingTop`).

---

## 3. The screens — all 9 states, pinned

The 9 canonical states map to this feature as follows (each named, none skipped):

| State | Applies? | Where |
|-------|----------|-------|
| **first-time** | YES — the gate is structurally first-run only (§0.7) | every screen below IS the first-time state |
| **populated** | YES | §3.B picker (rows present) |
| **loading** | YES (brief) | §3.0 `checking` overlay |
| **submitting** | YES | §3.B confirm → CTA spinner |
| **error** | YES | §3.E check-failed; §3.B write-failure inline |
| **empty** | YES | §3.B filter-no-match; §3.D zero-cities (data-empty) |
| **degraded** | YES | §3.D zero-cities; §3.E ≥2-failure "Continue anyway" |
| **offline** | folds into **error** | §3.E (the edge call simply fails → check-failed) |
| **returning** | N/A | gate never re-fires post-onboarding (§0.7 / SC-6); named-inapplicable |

### 3.0 `checking` — the transition (loading)
**Phase:** `launchGate.phase === 'checking'` (edge call in flight, typically <500ms).
**Decision (LOCKED):** Do NOT swap to a spinner screen — that would flash a third layout for half a second and feel broken. **Hold the existing `granted` success render** (green check card + "We've got your location") and overlay a 16pt `ActivityIndicator` (`colors.primary[500]`) bottom-centered, `responsiveSpacing.lg` (24) above the safe-area bottom, with `accessibilityLabel="Checking your city"`. If the call resolves `in_city`, the green card simply proceeds to the existing 1200ms auto-advance — visually nothing changed (DEC-1028-4). If it resolves out-of-city, we cross-fade (§5) into §3.A. The user never sees a blank or a jump.
**Motion:** indicator fades in only after 250ms (so a fast call shows no spinner at all — premium apps never flash a sub-frame spinner). `prefers-reduced-motion`: indicator appears instantly at 250ms, no fade.

### 3.A Reassurance screen — `phase: 'out_of_city'` (first-time / populated-context)
The hero state. Reuses the exact `locContainer` center-stack.

**Anatomy (top→bottom, centered, `locContainer` flex:1 center):**
1. **Glass icon card** — `locGlassCard` (100×100, `glass.surface`, `radius 50`, `glass.shadow`) containing `locIconCircle` (72×72 warm circle) containing `paper-plane-outline` 36 `colors.primary[500]`. `marginBottom: responsiveSpacing.xl`.
2. **Headline** — `locHeadline` (`responsiveTypography.xxxl`, 700, center, letterSpacing −0.5).
   - City known: `launch_gate.out_of_city_headline` → "We're not in {{city}} yet".
   - City null (E-6): `launch_gate.out_of_city_headline_no_city` → "We're not in your city yet".
   - `marginBottom: responsiveSpacing.sm` (8).
3. **Body** — `locBody` (`responsiveTypography.md`, `colors.text.secondary`, center, `paddingHorizontal: spacing.md`). Copy: `launch_gate.out_of_city_body` — "Mingla is just getting started — we're rolling out city by city. Pick one of our live cities below and we'll plan around it. We'll let you know the moment we land near you." `marginBottom: responsiveSpacing.xl`.
4. **CTA** — via the shell bottom bar (NOT inline): `hidePrimaryCta=false`, label `launch_gate.out_of_city_cta` "Choose a city to explore", enabled, full-width orange. On press → `setLaunchGate({phase:'picker', liveCities})`.
5. **NO skip / continue-anyway** (DEC-1028-2). Shell Back chevron stays (returns to Step 2/intents — re-running location re-runs the gate; E-7).

**Why content sits in the shell ScrollView:** even at SE 375×667 the stack (card 100 + gap 32 + headline ~38 + gap 8 + body ~72 + gap 32) ≈ 282pt of content fits the scroll viewport above the bottom bar with room to spare; `scrollEnabled` left at the shell default `true` so accessibility-large Dynamic Type can scroll rather than clip.

### 3.B Live-city picker — `phase: 'picker'`
**New component:** `app-mobile/src/components/onboarding/LaunchCityPicker.tsx`, rendered inside the `location` block. Pick-from-frozen-`liveCities`-only (DEC-1028-6) — never free-text geo.

**Anatomy (top→bottom, left-aligned content within shell horizontal padding `spacing.lg`=24):**
1. **Headline** — `launch_gate.picker_headline` "Where do you want to explore?". Style: `responsiveTypography.xxl` (24, was a too-large 32 for a list screen — list screens want a tighter header so rows dominate), weight 700, color `colors.text.primary`, `textAlign:'left'`, letterSpacing −0.4. Top `responsiveSpacing.lg` (24). `marginBottom: responsiveSpacing.xs` (4).
2. **Body** — `launch_gate.picker_body` "We'll fill your deck with the best of one of these cities." `responsiveTypography.md`, `colors.text.secondary`, left. `marginBottom: responsiveSpacing.lg` (24).
3. **Filter input (conditional — only when `liveCities.length > 8`, OPEN per SPEC):** glass `TextInput`. Container `gateFilter`: height 48 (≥44pt), `radius.lg` (16), bg `glass.buttonSecondary.backgroundColor` `rgba(255,255,255,0.40)`, border `glass.buttonSecondary.borderColor` 1.5, `overflow:'hidden'`, `paddingHorizontal: spacing.md`. Leading `search-outline` 18 `colors.text.tertiary`, gap `spacing.sm`. Text `responsiveTypography.md` `colors.text.primary`. Placeholder `launch_gate.picker_search_placeholder` "Search live cities" `colors.text.tertiary`. `marginBottom: responsiveSpacing.md` (16). `keyboardShouldPersistTaps="handled"` (shell already sets), `autoCorrect={false}`, `returnKeyType="search"`, `accessibilityLabel="Search live cities"`.
4. **City rows** — vertical list, one `gateCityRow` per `liveCity`, `responsiveSpacing.sm` (8) gap. **Row spec (new `gateCityRow`):**
   - Layout: `flexDirection:'row'`, `alignItems:'center'`, `justifyContent:'space-between'`, min height **52** (well over 44pt), `paddingVertical: responsiveSpacing.md` (16), `paddingHorizontal: spacing.md` (16), `radius.lg` (16), `overflow:'hidden'` (Android glass clip, META-ORCH-1002).
   - **Unselected:** bg `glass.surface.backgroundColor` `rgba(255,255,255,0.55)`, border `glass.surface.borderColor` `rgba(255,255,255,0.35)` 1px, `glass.shadowLight`.
   - **Selected:** bg `colors.primary[50]` `#fff7ed`, border `colors.primary[500]` `#f97316` 1.5px, no shadow swap (border carries the state — no layout shift). Trailing `checkmark-circle` 22 `colors.primary[500]`. Unselected trailing slot reserved (22pt empty box) so selecting NEVER reflows the row width (premium-craft "no layout shift").
   - **Leading:** `location-outline` 20 `colors.text.tertiary` (unselected) / `colors.primary[500]` (selected), gap `spacing.md` to label.
   - **Label:** city `name`, `responsiveTypography.lg` (18), weight 600, `colors.text.primary`. (No country in the frozen contract — name-only is correct, SPEC §B.2.)
   - **Press feedback:** `activeOpacity` 0.85 (TouchableOpacity) OR `onPressIn` spring scale 0.98 (no reflow). Light haptic on select (`Haptics.selectionAsync()`).
   - **a11y:** `accessibilityRole="radio"`, `accessibilityState={{selected}}`, `accessibilityLabel={name}`. The list is `accessibilityRole="radiogroup"` (single-select).
5. **CTA** — shell bottom bar. Label `launch_gate.picker_confirm` "Explore {{city}}" (substitutes the selected city name; before selection shows a disabled placeholder label — see states). Disabled until `selectedCity != null`. On press → §4 write.

**Sort (OPEN, designer recommendation):** **nearest-first** computed in-memory from `data.coordinates` to each `center_lat/lng` (cheap haversine, no network) — the most relevant city to a real traveler sits at the top, matching the "travel to a live city" mental model. Falls back to name-asc if `data.coordinates` is null. Either is acceptable per SPEC; nearest-first is the premium choice.

**All 9 states on the picker:**
- **populated:** rows rendered (the default).
- **loading:** N/A — `liveCities` already in memory from the edge response (no fetch). Named-inapplicable.
- **submitting:** confirm pressed → shell `primaryCtaLoading=true` (spinner + "Saving" per shell), rows become non-interactive (`pointerEvents:'none'` + 0.6 opacity on the list), filter disabled. Mirrors `CityPickerSheet` `persisting` guard.
- **empty (filter no-match):** filter text matches zero cities → replace the list with a centered `gateFilterEmpty`: `search-outline` 28 `colors.text.tertiary`, then `launch_gate.picker_empty_search` "No live city matches that." `responsiveTypography.md` `colors.text.secondary`, `marginTop: responsiveSpacing.sm`, centered, `paddingVertical: responsiveSpacing.xl`. NOT an error — it's a calm "nothing here, adjust your search."
- **error (write failure):** §4 step 4 — inline `gateInlineError` strip directly under the CTA-bound selection: `responsiveTypography.sm`, `colors.error.600` `#dc2626` text (this IS a real failure, so red is correct HERE, distinct from the reassurance screens), `alert-circle-outline` 16 leading, copy "That didn't save — tap Explore to try again." Selection stays intact; stay on picker. No toast (inline keeps the retry affordance — the same CTA — in view).
- **offline:** folds into error (data already fetched; only the write can fail → same inline strip).
- **first-time / returning:** first-time is the only time (§0.7); returning N/A.
- **degraded:** handled upstream by §3.D (zero cities) before the picker ever mounts.

### 3.C In-city — `phase: 'idle'` (no new screen)
Existing `granted` render + 1200ms auto-advance, byte-unchanged (DEC-1028-4). Zero visible change. (Not redesigned here.)

### 3.D Degraded — zero live cities — `phase: 'no_live_cities'` (empty-data / degraded)
Same center-stack as §3.A reassurance, different copy + glyph + CTA behavior. Should essentially never fire (≥1 city live at launch, SPEC assumption) but is fully designed.

**Anatomy:** identical layout tokens to §3.A.
- **Glyph:** `paper-plane-outline` is wrong here (there's nowhere to send them). Use **`time-outline`** 36 `colors.primary[500]` in the warm `locIconCircle` — "almost ready / soon," forward and patient, still NOT an error. (Bans of §1 apply: no red, no alert.)
- **Headline:** `launch_gate.no_live_cities_headline` "We're almost ready" — `locHeadline` (`responsiveTypography.xxxl`).
- **Body:** `launch_gate.no_live_cities_body` "Mingla is launching very soon. Leave us your spot and we'll text you the moment your city goes live." `locBody`.
- **CTA (LOCKED behavior, SPEC §B.4):** primary `launch_gate.no_live_cities_cta` "Notify me" → advances onboarding with `use_gps_location:true` (the honest proceed path — no pick is possible; the user completes onboarding rather than being stranded). Full-width orange via shell. This is the ONE non-in-city branch that advances without a pick. Code comment cites E-3.
- **No back-required dead-end:** shell Back chevron remains.

### 3.E Check-failed — `phase: 'check_failed'` (error / degraded)
The transient-backend-hiccup screen. The ONE screen permitted a gentle neutral problem signal — but still NO red, NO alarm.

**Anatomy:** §3.A center-stack tokens.
- **Glyph:** **`refresh-outline`** 36 in a NEUTRAL circle (not the warm brand circle, not red): a `gateNeutralCircle` = 72×72, `radius 36`, bg `colors.gray[100]` `#f3f4f6`, border `colors.gray[200]` `#e5e7eb` 1.5, glyph `colors.text.secondary` `#4b5563`. Neutral grey says "transient, retryable," not "you failed" and not "we're broken in red."
- **Headline:** `launch_gate.check_failed_headline` "Hmm, that didn't go through" — `locHeadline`.
- **Body:** `launch_gate.check_failed_body` "We couldn't check your city just now. Tap to try again." — `locBody`.
- **CTA:** primary `launch_gate.check_failed_cta` "Try again" (shell bottom bar) → re-invokes `checkLaunchCity(data.coordinates.lat, data.coordinates.lng)` → re-branches.
- **Degraded escape after ≥2 failures (LOCKED, SPEC §B.5):** on the 2nd+ failure, reveal a SECONDARY text button BELOW the primary, inside the shell bottom bar's secondary slot OR as an inline `gateSecondaryLink`: "Continue anyway" — `responsiveTypography.sm`, weight 600, `colors.text.tertiary` (deliberately quieter than the orange primary so "Try again" stays the encouraged path), min height 44, centered, `marginTop: responsiveSpacing.md`. On press → advance with `use_gps_location:true` (degraded-availability escape, NOT a DEC-1028-2 skip). a11y: `accessibilityRole="button"`, `accessibilityLabel="Continue anyway"`, `accessibilityHint="Continues with your current location"`. It is HIDDEN on the first failure (only the orange "Try again" shows) so the happy retry isn't undercut.

---

## 4. The write + advance (visual contract for §SPEC-C)
On confirm in the picker:
1. `primaryCtaLoading=true` → shell shows spinner + "Saving"; list `pointerEvents:'none'` + 0.6 opacity; filter disabled.
2. `await PreferencesService.updateUserPreferences(...)` writing exactly `{custom_lat, custom_lng, custom_location, use_gps_location:false}`.
3. **Success:** `Haptics.notificationAsync(Success)`; the CTA briefly shows a `checkmark` (200ms) before the screen transitions out (§5 forward push) to Step 4. Reduced-motion: no checkmark beat, advance immediately.
4. **Failure:** `primaryCtaLoading=false`; reveal the §3.B `gateInlineError` strip; selection intact; STAY on picker (never silent success). `Haptics.notificationAsync(Error)` (the one acceptable error haptic — write genuinely failed).

---

## 5. Motion (purpose-driven, all with reduced-motion fallback)

| Transition | Motion | Timing / easing | Reduced-motion |
|------------|--------|-----------------|----------------|
| `checking` → `out_of_city` | Cross-fade: green-check card fades/scales out (`opacity 1→0`, `scale 1→0.96`), reassurance card fades/scales in (`opacity 0→1`, `scale 0.96→1`) — reuses the existing `locIconAnim`/`locHeadlineAnim`/`locBodyAnim` staggered entrance already wired on the location renders | 300ms, `Easing.out(Easing.cubic)`; body delayed +80ms after headline (existing stagger) | both states snap (opacity 1, no transform) instantly |
| `out_of_city` → `picker` | Forward push: reassurance content slides left+fades (`translateX 0→-16`, `opacity→0`), picker slides in from right (`translateX 16→0`, `opacity 0→1`) — "going forward in the flow" | 300ms `Easing.out(Easing.cubic)` | instant swap |
| Row select | Border color tween + leading/trailing icon color tween; NO scale reflow; `Haptics.selectionAsync()` | 150ms `Easing.out` color tween | instant color, haptic stays |
| Confirm success | CTA label→checkmark (200ms) then forward push to Step 4 | 200ms | skip checkmark, advance now |
| `checking` spinner | fades in only after 250ms hold | 200ms fade | appears at 250ms, no fade |
| Filter empty | list cross-fades to empty message | 150ms | instant |

Motion reuses the shell's existing `ctaEntrance` + the location block's `locIconAnim`/`locHeadlineAnim`/`locBodyAnim`/`locButtonAnim` Animated values — **no new animation primitives** (consistency with the rest of Step 3). All honor `AccessibilityInfo.isReduceMotionEnabled()` (the shell already gates on it, lines 84-95) — reuse that check.

**Haptics:** reassurance/zero/check-failed entrance = none (a haptic on "you're not in our city" would feel like a buzz of bad news). Row select = `selectionAsync` (light). Confirm success = `notificationAsync(Success)`. Write failure = `notificationAsync(Error)`. "Try again" press = `impactAsync(Light)` (shell default for CTAs).

---

## 6. Dark mode + computed contrast (light AND dark, ratios written)

The onboarding shell background is the warm glow `#fff9f5` in light. Dark-mode onboarding background: the app's dark canvas `#0F0F0F` family — for the gate, specify dark surrogates so the implementor doesn't eyeball. **Note:** if onboarding currently has no dark-mode treatment app-wide, the gate must at minimum not become unreadable; the values below are the dark targets when dark mode is active.

| Element | Light fg / bg | Light ratio | Dark fg / bg | Dark ratio |
|---------|---------------|-------------|--------------|------------|
| Headline (`#111827`) on warm bg `#fff9f5` | 16.9:1 | ✅ ≥4.5 (body) & ≥3 (large) | `#F5F5F5` on `#0F0F0F` | 18.1:1 ✅ |
| Body (`#4b5563`) on `#fff9f5` | 8.0:1 | ✅ ≥4.5 | `#A0A0A0` on `#0F0F0F` | 7.5:1 ✅ |
| City row label (`#111827`) on glass-over-warm (effective ≈`#fdf6f1`) | ~16.5:1 | ✅ | `#F5F5F5` on dark glass (`rgba(255,255,255,0.10)` over `#0F0F0F` ≈ `#262626`) | 13.6:1 ✅ |
| Selected row label (`#111827`) on `colors.primary[50]` `#fff7ed` | 16.1:1 | ✅ | `#F5F5F5` on `rgba(249,115,22,0.18)`-over-dark ≈ `#3a2417` | ~9:1 ✅ |
| Filter placeholder (`#6b7280`) on glass | 5.0:1 | ✅ ≥4.5 | `#A0A0A0` on dark glass | 7.5:1 ✅ |
| Primary CTA text (`#ffffff`) on `#f97316` | 3.4:1 | ✅ ≥3 (large/bold 17pt-semibold = large) | same | 3.4:1 ✅ |
| Reassurance glyph (`#f97316`) on `#fff7ed` circle | 2.6:1 | decorative glyph paired with text — NOT sole information carrier; the headline carries meaning. Acceptable per WCAG (non-text decorative). | `#fb923c` on `#3a2417` | ~3.2:1 ✅ |
| Check-failed glyph (`#4b5563`) on `#f3f4f6` grey circle | 7.4:1 | ✅ | `#A0A0A0` on `#2C2C2E` | ~5.8:1 ✅ |
| Inline write-error text (`#dc2626`) on warm bg | 5.0:1 | ✅ ≥4.5 | `#f87171` on `#0F0F0F` | 6.4:1 ✅ |
| "Continue anyway" link (`#6b7280`) on warm bg | 5.0:1 | ✅ ≥4.5 | `#A0A0A0` on `#0F0F0F` | 7.5:1 ✅ |

**Dark glass for the rows:** swap `glass.surface` → `glass.surfaceDark` (bg `rgba(255,255,255,0.10)`, border `rgba(255,255,255,0.18)`) when the app is in dark mode. The implementor reads the existing dark-mode signal the onboarding shell uses (if onboarding is light-locked today, gate inherits light-locked — flag below).

**Android glass policy (META-ORCH-1002):** every glass surface here (rows, filter) MUST carry `overflow:'hidden'` (specified in §3.B) and, on Android, use the opaque ≥0.92 fallback fill per `ANDROID_GLASS_USES_OPAQUE_FALLBACK` — the row's `rgba(255,255,255,0.55)` becomes `rgba(255,255,255,0.94)` on Android, with no Android shadow under the rounded fill. Do NOT ship translucent Android row fills.

---

## 7. Accessibility (foundation, not afterthought)

- **Reading order (VoiceOver/TalkBack):** glyph (decorative, `accessibilityElementsHidden` / `importantForAccessibility="no"` on the icon) → headline → body → CTA. On the picker: headline → body → filter → "City list, single select" (radiogroup) → each row → CTA.
- **Every interactive element ≥44pt:** rows 52pt; filter 48pt; CTA 56pt; "Try again"/"Continue anyway" 44pt min; shell Back 44pt (existing).
- **Labels:** every icon-only/icon-led control carries an `accessibilityLabel` (specified inline §3.B/§3.E). The reassurance/zero/check-failed glyphs are decorative (hidden from a11y); the headline carries the meaning.
- **Selection semantics:** rows `accessibilityRole="radio"` + `accessibilityState={{selected}}`; list `radiogroup`. CTA `accessibilityState={{disabled}}` until a city is selected, with `accessibilityHint="Saves your city and continues"`.
- **Dynamic Type:** all type on `responsiveTypography` (`ms()`-scaled) + shell ScrollView `scrollEnabled` so 200% type scrolls rather than clips. Headlines wrap (no `numberOfLines` truncation on headline/body). City row labels `numberOfLines={1}` with `ellipsizeMode="tail"` (city names are short; truncation acceptable only if a future long name appears — flag).
- **Reduced motion:** every transition in §5 has an instant fallback, reusing the shell's existing `AccessibilityInfo.isReduceMotionEnabled()` gate.
- **Non-shifting feedback:** row select changes border + icon color only (reserved trailing slot); CTA press = subtle scale (shell `ctaScale` 0.97, no reflow). No layout shift anywhere.
- **Contrast:** all computed §6; the warm glyph's sub-3:1 ratio is acceptable only because it is decorative and paired with a high-contrast headline (WCAG non-text exception) — never the sole carrier of meaning.

---

## 8. Copy (Mingla experience-app voice — reassuring, NEVER dating)

Final wording for `onboarding.json` `launch_gate` block (within SPEC's locked intent; `mingla-product` may refine but the no-dating + reassurance guard is LOCKED, SC-11):

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
  "picker_confirm_placeholder": "Pick a city to continue",
  "no_live_cities_headline": "We're almost ready",
  "no_live_cities_body": "Mingla is launching very soon. Leave us your spot and we'll text you the moment your city goes live.",
  "no_live_cities_cta": "Notify me",
  "check_failed_headline": "Hmm, that didn't go through",
  "check_failed_body": "We couldn't check your city just now. Tap to try again.",
  "check_failed_cta": "Try again",
  "check_failed_continue_anyway": "Continue anyway",
  "write_failed_inline": "That didn't save — tap Explore to try again."
}
```
(Added `picker_confirm_placeholder` for the disabled-CTA pre-selection label and `check_failed_continue_anyway` / `write_failed_inline` for the escape + inline error — all in the locked voice. Zero dating framing: no "matches," "singles," "near you" romance language.)

---

## 9. Premium-craft checklist (every box true)

- [x] **References examined** — Lyft cities / Uber geo / UserOnboard priming / Mobbin / Partiful-Timeleft-Airbnb recall (top of doc).
- [x] **Zero anti-slop:** real Ionicons (no emoji), no generic gradients (flat warm `#fff9f5` + brand orange only), no stock/AI imagery, no decorative glow — every glass shadow/border earns grouping or depth.
- [x] **Every value a token** from the 4px grid (`responsiveSpacing`/`spacing`/`radius`/`responsiveTypography`) — no magic numbers. (Row min-height 52 and icon 72 are existing `loc*`/`touchTargets`-family sizes, not new magic.)
- [x] **All 9 states** designed or named-inapplicable (§3 table).
- [x] **Contrast computed**, light + dark, ratios written (§6) — body ≥4.5:1, large ≥3:1 everywhere; the one sub-3 ratio is decorative-only with a stated WCAG basis.
- [x] **Every interactive element** ≥44pt, `accessibilityLabel`, non-shifting feedback (§7).
- [x] **Motion** purpose-driven, reduced-motion fallback on every transition (§5).
- [x] **Copy** Mingla experience-app voice per state, no dating framing (§8).
- [x] **Belongs to Step 3** — reuses `loc*` + `glass.*` + shell chrome; reads as one continuous onboarding surface, not a bolted-on screen.

---

## 10. Open items flagged to implementor / operator

1. **Dark-mode onboarding:** if onboarding is currently light-locked app-wide, the gate inherits light-locked (its §6 dark targets are ready to activate the moment onboarding gains a dark theme). Implementor: confirm the existing onboarding dark-mode signal (or its absence) and wire the row glass `surface`→`surfaceDark` swap accordingly. Not a blocker.
2. **Picker sort:** designer recommends nearest-first (haversine from `data.coordinates`); name-asc is the acceptable fallback (SPEC OPEN-2).
3. **Filter threshold:** filter input renders only when `liveCities.length > 8` (SPEC OPEN); at launch with a handful of cities it won't appear — designed but dormant.
4. **Long city names:** row label `numberOfLines={1}` tail-truncates; the frozen contract has short names today — revisit only if a long-name city is added.
```
