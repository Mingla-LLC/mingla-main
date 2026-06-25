# IMPLEMENTATION — ORCH-1228 Consumer Apple App Review Fixes (build 29 → 30)

App: "Mingla – Date Plans & City Gems" (consumer, iOS 1.1.0 build 29). Four
code fixes for the Apple rejection; Apple Pay (#4) is review-notes only and was
NOT touched. Branch: `orch-1228-consumer-apple-review-rejections`.

Typecheck (`npx tsc --noEmit`): no errors in any touched file (verified by
filtering). Lint: the three substantial-logic files
(permissionOrchestrator.ts, postHogService.ts, types/onboarding.ts) are
lint-clean; OnboardingFlow/useOnboardingResume/app-index emit only pre-existing
warnings/errors unrelated to this change.

---

## FIX 1 — Guideline 4: Sign in with Apple must not re-ask for name/email

**Root cause.** The onboarding `welcome` substep (Step 1) renders first/last name
`TextInput`s and its CTA is *disabled* until BOTH `firstName` and `lastName` are
non-empty (`OnboardingFlow.tsx` `getCtaConfig` → `case 'welcome'`). Apple
supplies the name via Authentication Services (first sign-in only) and may hide
the email behind private relay, so a SIWA user could be hard-blocked on a
mandatory name screen. No email-entry field exists in onboarding (verified —
the only `email` references read the OTP-granted email; the user is never asked
to type an email), so the name gate was the single offending surface.

**How "signed in with Apple" is detected.**
`src/hooks/useOnboardingResume.ts` (new block after the phone pre-fill, ~lines
99-119) reads the Supabase auth session and sets `base.isAppleSignIn`:
- `session.user.app_metadata.provider === 'apple'`, OR
- `session.user.app_metadata.providers` includes `'apple'`, OR
- any `session.user.identities[].provider === 'apple'` (robust: `identities`
  stays populated even if the SIWA session is later linked to other providers).
Wrapped in try/catch — a failed session read falls back to the standard
(blocking) gate and never stalls onboarding.

**Files changed.**
- `src/types/onboarding.ts` — added `isAppleSignIn: boolean` to `OnboardingData`.
- `src/hooks/useOnboardingResume.ts` — added `supabase` import; `isAppleSignIn:
  false` in `BASE_INITIAL_DATA`; the SIWA detection block; kept the existing
  name pre-fill (`profile.first_name` → `base.firstName/lastName`, populated by
  the SIWA path in `useAuthSimple.ts` lines 705-728).
- `src/components/OnboardingFlow.tsx` — `case 'welcome'` CTA now computes
  `const disabled = data.isAppleSignIn ? false : !nameReady;`. SIWA users can
  always proceed (name pre-filled when Apple provided it; left optional
  otherwise). Non-SIWA users keep the original required-name gate.

**Acceptance.** A SIWA user reaches the app with no mandatory name/email screen;
the Apple-provided name is pre-filled where present.

---

## FIX 2 — Guideline 5.1.1(iv): location pre-permission button wording

**Change.** The button rendered before `Location.requestForegroundPermissionsAsync()`
read "Enable Location"/"Enable location" (persuasive — banned). Set
`location.enable_location` and `location.cta_enable` to the neutral
locale-appropriate "Continue" value.

- English: `src/i18n/locales/en/onboarding.json` → both keys now `"Continue"`.
- All 29 locales updated via a targeted (2-line-per-file) replacement that reuses
  each locale's existing `common.continue` value (e.g. de "Weiter", fr
  "Continuer", ja "続ける", ar "متابعة", zh "继续", yo "Tẹsiwaju", ig "Gaa n'ihu",
  …). 29 files, 58 insertions / 58 deletions, JSON-validated.

**Acceptance.** The button shown immediately before the iOS location prompt reads
"Continue" (or the locale equivalent), never "Enable Location".

---

## FIX 3 — Guideline 2.1: ATT must fire reliably before tracking

**Root cause.** `requestTrackingPermissionsAsync()` fired ONLY inside
`requestPostTourPermissions()`, called only from `CoachMarkContext.tsx`
(`nextStep` past the final step, or `skipTour`). On the reviewer's iPad the
coach-mark tour never reached that point (the tour is gated on a `profiles`
`coach_mark_step` DB read; if it fails it jumps straight to `TOUR_COMPLETED`
without ever calling the post-tour permissions), so ATT never appeared.
Separately, **PostHog began tracking at app mount** — `postHogService.initialize()`
constructs the native client with `enableSessionReplay: true` + `autocapture`,
which transmits before any ATT decision.

**Fix — deterministic single-flight ATT gate, ATT before all tracking.**

`src/services/permissionOrchestrator.ts` (rewritten):
- `ensureAttRequested()` — single-flight (`_attRequestInFlight`) iOS ATT request;
  resolves the gate. Never double-prompts; on a previously-answered install iOS
  resolves immediately without re-showing the dialog. No-op on non-iOS.
- `whenAttResolved()` — a promise that resolves once ATT has been requested (iOS)
  or immediately (non-iOS, gate opened at module init). Tracking SDKs await this.
- `requestPostTourPermissions()` now routes ATT through `ensureAttRequested()`
  (so the post-tour path and the new home-screen path share the single-flight
  guard — no double prompt), then `startAppsFlyer()`, then push.

`app/index.tsx` (new deterministic trigger, after `needsOnboarding` is defined):
a one-time effect (`attFiredRef`) fires `ensureAttRequested()` the FIRST time the
user reaches the main app UI — `isAuthenticated && !isLoadingAuth && user?.id &&
!showOnboardingFlow && !needsOnboarding` — a path that ALWAYS runs regardless of
the coach-mark tour. After ATT resolves it calls `startAppsFlyer()` (idempotent;
AppsFlyer is `manualStart: true`, so it never transmits before this).

`src/services/postHogService.ts` — `initialize()` now, on iOS, `await import`s
`whenAttResolved()` and awaits it BEFORE constructing the PostHog client, so
session-replay/autocapture never transmit before ATT. Web stays a no-op (early
return); non-iOS resolves immediately. `identify()`/`capture()` already guard on
`isReady()`, so the auth-time PostHog calls during onboarding are no-ops until
the client exists (i.e. until ATT has resolved).

**Proof ATT is before tracking.**
- AppsFlyer: SDK init is `manualStart: true`; `startAppsFlyer()` is now called
  ONLY inside the ATT-gated `.then()` of `ensureAttRequested()` (home-screen
  effect) and inside `requestPostTourPermissions()` (also after
  `ensureAttRequested()`). No other caller of `startAppsFlyer()` exists.
- PostHog: client construction (which starts replay/autocapture) is behind
  `await whenAttResolved()` on iOS. All `capture`/`identify` call sites no-op
  until the client exists. The cold-start `app_opened` capture is chained off
  `initialize()`, so it too waits for ATT on iOS.
- Single-fire: `attFiredRef` + the `_attRequestInFlight` single-flight guard +
  iOS's own one-time dialog ⇒ no double prompt.

**Acceptance.** Fresh install → the ATT system prompt appears the first time the
main app UI is reached, before AppsFlyer/PostHog tracking starts, independent of
whether the coach-mark tour is shown or skipped; never double-prompts.

---

## FIX 5 — Guideline 5.1.1(ii): calendar purpose string

`app-mobile/app.json` → `expo.ios.infoPlist.NSCalendarsUsageDescription` rewritten
to name a concrete example and the trigger:
> "Mingla adds events you book or RSVP to — like a dinner reservation or a
> ticketed show — to your device calendar so you get a reminder before they
> start. Calendar access is only used when you choose to add an event."

**Acceptance.** Names concrete examples (reservation, ticketed show) and the
user-initiated trigger ("when you choose to add an event").

---

## Apple Pay (#4) — NOT touched

Apple Pay is integrated (`src/payments/nativeCheckoutFlow.ts`,
`src/hooks/useReserveTable.ts`, `app/_layout.tsx`). Handled via App Review Notes
by Seth/orchestrator. No payment code changed.

---

## Regression gate — fail-on-revert proof

`.github/scripts/strict-grep/orch-1228-consumer-apple-review-fixes.mjs` (new),
wired as job `orch-1228-consumer-apple-review-fixes` in
`.github/workflows/strict-grep-mingla-business.yml` (runs `--self-test` then the
live gate; this workflow already covers `app-mobile/**`). Asserts:
- FIX 2: en `location.enable_location`/`cta_enable` are NOT "Enable Location"/
  "Enable location".
- FIX 5: `NSCalendarsUsageDescription` matches `/reservation|ticketed show|like a/`.
- FIX 3: `permissionOrchestrator` exports `ensureAttRequested` + `whenAttResolved`
  and still calls `requestTrackingPermissionsAsync`; `app/index.tsx` calls
  `ensureAttRequested()`; `postHogService` awaits `whenAttResolved()`.
- FIX 1: `useOnboardingResume` sets `isAppleSignIn` and detects `'apple'`;
  `OnboardingFlow` reads `isAppleSignIn` and the welcome CTA is non-blocking via
  `data.isAppleSignIn ? false : ...`.

`--self-test` PASSES (all PASS-on-fix + FAIL-on-revert cases). Live gate PASSES
on the fixed tree. Proven FAIL-on-revert against the REAL files (each reverted,
gate failed with exit 1, then restored — gate PASSES again):
- FIX 2 revert ("Enable Location") → FAIL (2 findings).
- FIX 1 revert (`const disabled = !nameReady;`) → FAIL (2 findings).
- FIX 3 revert (remove `ensureAttRequested(` from app/index) → FAIL (1 finding).
