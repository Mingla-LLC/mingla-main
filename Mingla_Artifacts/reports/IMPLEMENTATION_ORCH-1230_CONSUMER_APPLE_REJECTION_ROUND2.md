# IMPLEMENTATION — ORCH-1230 (consumer Apple rejection, round 2)

Branch: `orch-1230-consumer-apple-rejection-round2`
Worktree: `mingla-orchs/orch-1230-[consumer-apple-rejection-round2]/app-mobile`

Two CODE fixes for Apple's SECOND rejection of consumer build 30 (Mingla – Date Plans & City Gems, v1.1.0). Payment / subscription items are owned by the orchestrator (Review Notes + demo account) and were NOT touched.

---

## FIX A — Guideline 5.1.5: app fully functional with Location Services OFF / denied

### Root cause
The manual "choose your city" machinery (`manualLocationText`, `selectedLocation`, `handleManualLocation`, `handleSelectLocationSuggestion`, `handleClearLocationSelection`, plus a full set of `location*` autocomplete styles) existed in `OnboardingFlow.tsx` but was **never rendered** — orphaned. The only non-GPS escape was the launch-gate `check_failed` "Continue anyway" link, gated behind `launchCheckFailures >= 2`. A reviewer with Location Services fully OFF (or who denies permission) lands on the `settings` / `error` location card, which offered only "Open Settings" / "Try again" — a dead-end. → "not functional without Location Services."

### Changes (all in `app-mobile/src/components/OnboardingFlow.tsx`)
- **L934** — new state `const [manualLocationOpen, setManualLocationOpen] = useState(false)` — reveals the manual city picker inline on the location step.
- **L2747–2842** — new `renderManualLocationPanel()` helper: a fully-wired city search (TextInput → `geocodingService.autocomplete` via the existing debounced effect) → suggestion list (`handleSelectLocationSuggestion`) → selected-city card (`handleClearLocationSelection`) → "Use this city" button (`onPress={handleManualLocation}`, **L2826**). Reuses the pre-existing `location*` styles.
- **L2844–2857** — new `renderChooseCityLink()` helper: a "Type my city instead" secondary link that sets `manualLocationOpen = true`.
- **`settings` branch (L3014–3043)** — when `manualLocationOpen`, renders the manual panel; otherwise the Open-Settings / retry buttons **plus** `renderChooseCityLink()`. The manual path is now reachable on the FIRST encounter.
- **`error` branch (L3063–3088)** — same: manual panel when open, else Try-Again **plus** `renderChooseCityLink()`.
- **`idle` branch (L3108–3130)** — manual panel when open, else the GPS Continue button **plus** `renderChooseCityLink()` (manual path reachable BEFORE any GPS request).
- **L2945** — the launch-gate `check_failed` "Continue anyway" escape lowered from `launchCheckFailures >= 2` to `launchCheckFailures >= 1` (appears on the FIRST failure). State comment at **L913–916** updated to match.
- **`app-mobile/src/i18n/locales/en/onboarding.json` L118–122** — added `location.manual_title`, `manual_placeholder`, `manual_confirm`, `manual_change`, `manual_no_results`. (Other locales fall back to `en` via i18next default fallback.)

### Downstream trace — manual-city user reaches a FULLY functional app (no hard GPS requirement)
Confirmed by reading the runtime location path:
- **Onboarding write** — `handleManualLocation` (L1733) sets `data.coordinates = {lat,lng}` + `data.manualLocation` then `goNext()`. The final save `handleSavePreferences` (L1812) derives the four location columns via `resolveOnboardingLocationOverride` (`src/utils/onboardingLocationOverride.ts:49`) and upserts `custom_lat/custom_lng/custom_location` + `use_gps_location=false`, then pre-seeds the `['userPreferences', user.id]` React Query cache.
- **Runtime hook** — `useUserLocation` → `fetchLocationCore` (`src/hooks/useUserLocation.ts:29`). When `use_gps_location === false`: **Priority 1** returns the saved `custom_lat/custom_lng` directly with **no GPS call** (lines 55–58); GPS is structurally unreachable on this branch.
- **Deck** — `RecommendationsContext` enables the fetch on `!!userLocation` (non-null for a custom city) and has an explicit no-forever-spinner guard (`RecommendationsContext.tsx:1546`). `DiscoverScreen.tsx:1085`'s `getCurrentLocation()` is try/catch-wrapped and only *refines* the already-seeded custom coordinate — it never blocks paint or the events fetch.

→ A user who picks a city manually gets `use_gps_location=false` + saved coords; the app runs fully with zero live-GPS dependency and no dead-end. Happy path (permission granted → `captureLocation` → launch-gate) is byte-unchanged.

### Acceptance
With Location Services OFF or permission denied, the manual "Type my city instead" link is visible on the FIRST location-step encounter (idle/settings/error), the picker advances into a fully working app, and the launch-gate escape appears on the first failure. No forced "go to Settings", no dead-end.

---

## FIX B — Guideline 5.1.1(ii): calendar purpose strings (iOS-17 keys)

### Root cause
iOS 17 split the calendar permission; the reviewer's iPhone 17 reads `NSCalendarsFullAccessUsageDescription` / `NSCalendarsWriteOnlyAccessUsageDescription`, not the deprecated `NSCalendarsUsageDescription`. Those iOS-17 keys were MISSING from `app.json`, and the `expo-calendar` plugin was a **bare string** (`"expo-calendar"`) → at prebuild it injected a GENERIC default ("Allow Mingla to access your calendar") for the new keys — exactly what Apple screenshotted.

### Changes (`app-mobile/app.json`)
- **`ios.infoPlist`** — set all five calendar/reminder keys directly with concrete, example-bearing text (each contains "dinner reservation … ticketed show" + the user-initiated trigger "This is only used when you tap Add to Calendar"):
  - `NSCalendarsUsageDescription` (rewritten)
  - `NSCalendarsFullAccessUsageDescription` (NEW, iOS-17)
  - `NSCalendarsWriteOnlyAccessUsageDescription` (NEW, iOS-17)
  - `NSRemindersUsageDescription` (rewritten)
  - `NSRemindersFullAccessUsageDescription` (NEW, iOS-17)
- **`expo.plugins`** — replaced bare `"expo-calendar"` with `["expo-calendar", { "calendarPermission": "…reservation…ticketed show…tap Add to Calendar", "remindersPermission": "…reservation…ticketed show…tap Add to Calendar" }]`.

`app.config.ts` spreads `...config` and only appends plugins/extra — it does NOT override `ios.infoPlist` or the expo-calendar plugin, so the app.json values flow through unchanged.

### Verification — resolved prebuild config
`npx expo config --type prebuild --json` resolves ALL FIVE keys with the concrete text; every one matched `example=True trigger=True generic=False`. No generic/default string remains anywhere. Explicit infoPlist keys + the configured plugin are belt-and-suspenders: even if plugin behavior changed, the direct infoPlist keys win.

### Calendar/reminder keys now carrying concrete example text
`NSCalendarsUsageDescription`, `NSCalendarsFullAccessUsageDescription`, `NSCalendarsWriteOnlyAccessUsageDescription`, `NSRemindersUsageDescription`, `NSRemindersFullAccessUsageDescription` (infoPlist) + `calendarPermission` and `remindersPermission` (expo-calendar plugin).

---

## CI regression guard

`.github/scripts/strict-grep/orch-1230-consumer-apple-rejection-round2.mjs` (new), wired into `.github/workflows/strict-grep-mingla-business.yml` as job `orch-1230-consumer-apple-rejection-round2` (mirrors the `orch-1228-*` wiring) + a header registry comment.

- **Half A** asserts: the location escape is NOT gated `launchCheckFailures >= 2` (and IS shown on `>= 1`); `manualLocationOpen` exists; `renderManualLocationPanel` is defined AND invoked (≥2 occurrences); `onPress={handleManualLocation}` is present in the render (manual pick advances — not orphaned).
- **Half B** asserts: the expo-calendar plugin is NOT a bare string and IS the configured `[ "expo-calendar", {calendarPermission, remindersPermission} ]` form with `/reservation|ticketed show/`; every calendar/reminder infoPlist key (old + iOS-17) exists and matches `/reservation|ticketed show/`.

### Fails-on-revert proof (run against the REAL files)
- `--self-test`: **PASS** (all PASS-on-fix + FAIL-on-revert fixtures).
- Live run on current tree: **PASS** (exit 0).
- Half A revert — re-gate `>= 1` → `>= 2` in OnboardingFlow.tsx: gate **FAILED** (exit 1), restored → PASS.
- Half B revert — expo-calendar back to bare string in app.json: gate **FAILED** (exit 1), restored → PASS.

## Gates
- `npx tsc --noEmit`: **zero errors in OnboardingFlow.tsx** (the only source file changed). Pre-existing baseline noise (Deno `__tests__` stubs, `packages/phone-input` module-resolution) is unrelated and unchanged.
- Append-only test gate: respected — no existing test file modified; only a new strict-grep script added.
- `app.json` + `en/onboarding.json`: valid JSON; workflow YAML structurally valid (job present, 2-space indented).
