# IMPLEMENTATION — META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 (Native apps)

**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1187-[growth-analytics-hub]/`
**Branch:** `META-ORCH-1187-leg3-apps` (rebased onto current `origin/main` = `acce886ba`)
**Spec (binding):** `Mingla_Artifacts/specs/SPEC_META-ORCH-1187_GROWTH_ANALYTICS_PHASE1.md` §4.C / §4.F / §4.G / §4.H / §4.I, §8 step 3, §9 native.
**Status:** implemented and verified (source + typecheck + gates + jest; on-device replay/event verification rides the fresh native builds — see §Operator action).

---

## 1. Summary

Added `posthog-react-native` (PostHog) to BOTH native apps — consumer `app-mobile/` and business `mingla-business/` native — running ALONGSIDE the existing Mixpanel + AppsFlyer (parallel run; nothing removed). Each app gets a singleton `postHogService` (US host, masked native session replay, 20% replay sampling, opt-out-aware, graceful no-op when the key is missing) and a `<PostHogProvider>` at the root layout for autocapture + replay. Identity binds to the Supabase `user.id` at the existing auth sites and resets on signout. The 3 conversions (signup / purchase / offering-published) and the 5 consumer behavior events fire alongside their Mixpanel twins with identical event-name strings. Business iOS gains the App Tracking Transparency prompt it was missing (fired before AppsFlyer). Both apps get an in-app "Analytics" opt-out toggle wired to `posthog.optOut()/optIn()`. Two new native strict-grep gates + the DISC-B web-export exclusion on the three LEG-1 gates round it out. No web analytics, no Mixpanel/AppsFlyer removal, no edge/admin/marketing-analytics touch.

---

## 2. SPEC success-criteria coverage

| SC | Status | Evidence |
|----|--------|----------|
| SC-5-App (consumer signup / card_saved / purchase capture) | ✓ source+gate | `app/index.tsx` `signup_completed`; `SwipeableCards.tsx` 5 behavior events; `ConsumerEventDetailScreen.tsx` `purchase_completed`. Runtime device proof rides the consumer build. |
| SC-6-Business (signup / publish event-trip-experience / purchase) | ✓ source+gate | `AuthContext.tsx` `signup_completed`; `useBusinessEvents`/`useTrips`/`ExperienceCreatorWizard` `offering_published`; 3 `confirm.tsx` `purchase_completed`. Runtime proof on the business build. |
| SC-7 (identity = user.id; reset on signout) | ✓ | consumer `app/index.tsx` `identify`; business `AuthContext` identify (warm + SIGNED_IN) + `reset()` at both signout sites. |
| SC-8 (Mixpanel/AppsFlyer unchanged; no startup regression; no crash on missing env) | ✓ | DO-NOT-TOUCH services untouched (diff); jest "no-op on missing key" passes; init is `void` + try/catch, never throws. |
| SC-9 (no `phx_` in client; only `phc_` ships) | ✓ gate | `i-proposed-1187-no-phx-in-client` PASS; no key literal committed (env-sourced). |
| SC-12-Native (ATT prompt both apps; opt-out toggle suppresses capture) | ✓ source | business ATT added (plugin + prompt before AppsFlyer); consumer ATT reused; toggle → `optOut()/optIn()` (jest T-19 passes). Runtime ATT-popup proof on device. |
| SC-Security-Native (replay masks all inputs+images) | ✓ source+gate | `enableSessionReplay:true` + `maskAllTextInputs:true` + `maskAllImages:true` in both services; `replay-masks-pii` + `native-mounts-analytics` gates PASS. Recording inspection = tester T-17 on device. |
| SC-Security-Config (mask flags never false) | ✓ gate | `replay-masks-pii` PASS (0 false flags). |
| SC-13 (feature flag read resolves) | ✓ source | `postHogService.getFeatureFlag()` exposed (default-on-undefined, never throws). Runtime smoke = tester. |
| SC-16 (replay sampling configured) | ✓ | `PH_REPLAY_SAMPLE_RATE = 0.2` in both services. $0 billing cap = Seth action SA-1. |
| I-PROPOSED-1187-POSTHOG-HOST-US | ✓ gate | US host literal in both services; gate PASS. |
| COMMS-0028 static key read | ✓ new gate | `i-proposed-1187-posthog-key-static-read` PASS (extra read; no dynamic `process.env[...]`). |

SC-1..SC-4, SC-10/SC-11, SC-Security-Web, SC-14/SC-15 marketing/buyer-web rows are NOT in this leg's scope (Legs 1/2).

---

## 3. Files changed (per app)

**Consumer (`app-mobile/`):**
- `package.json` — +`posthog-react-native@^4.50.0`, +`posthog-react-native-session-replay@^1.6.0`.
- `app.config.ts` — +2 `extra` keys (`EXPO_PUBLIC_POSTHOG_KEY` null-default, `EXPO_PUBLIC_POSTHOG_HOST` US default).
- `eas.json` — `EXPO_PUBLIC_POSTHOG_HOST` env on development/preview/production.
- `src/services/postHogService.ts` (NEW) — singleton facade.
- `src/services/PostHogAnalyticsProvider.tsx` (NEW) — provider wrapper.
- `app/_layout.tsx` — mount `<PostHogAnalyticsProvider>` over the Stack.
- `app/index.tsx` — boot init + identify + `signup_completed`.
- `src/screens/Event/ConsumerEventDetailScreen.tsx` — `purchase_completed`.
- `src/components/SwipeableCards.tsx` — 5 behavior events.
- `src/store/appStore.ts` — `analyticsOptOut` + setter + persisted.
- `src/components/profile/AccountSettings.tsx` — Analytics toggle (Privacy section).
- `src/i18n/locales/en/settings.json` — `privacy.analytics` + `analytics_hint` (en fallback covers all locales).
- `src/services/__tests__/orch_1187_posthog_native_consumer.test.ts` (NEW) — regression.

**Business (`mingla-business/`):**
- `package.json` — +`posthog-react-native`, +`posthog-react-native-session-replay`, +`expo-tracking-transparency@~6.0.8`.
- `app.config.ts` — +2 `extra` keys (adjacent to supabase, NOT inside the Stripe/GIPHY IIFEs) + `expo-tracking-transparency` plugin (existing NSUserTracking copy).
- `eas.json` — `EXPO_PUBLIC_POSTHOG_HOST` env on all 5 profiles.
- `src/services/postHogService.ts` (NEW), `src/services/PostHogAnalyticsProvider.tsx` (NEW), `src/store/analyticsPrefsStore.ts` (NEW).
- `app/_layout.tsx` — boot init + ATT prompt before AppsFlyer + provider mount.
- `src/context/AuthContext.tsx` — identify (warm + SIGNED_IN) + `signup_completed` (first-time) + `reset()` (2 sites).
- `app/checkout/[eventId]/confirm.tsx`, `app/checkout-trip/[tripEventId]/confirm.tsx`, `app/checkout-experience/[experienceEventId]/confirm.tsx` — `purchase_completed`.
- `src/hooks/useBusinessEvents.ts`, `src/hooks/useTrips.ts`, `src/components/experience/ExperienceCreatorWizard.tsx` — `offering_published`.
- `app/account/notifications.tsx` — Analytics toggle (STOP-AND-AMEND host, see §4).
- `src/services/__tests__/postHogService.orch1187.test.ts` (NEW) — regression.

**Infra/tests (shared):**
- `.github/scripts/strict-grep/i-proposed-1187-posthog-key-static-read.mjs` (NEW), `i-proposed-1187-native-mounts-analytics.mjs` (NEW).
- `.github/scripts/strict-grep/i-proposed-1187-{posthog-host-us,no-phx-in-client,replay-masks-pii}.mjs` — DISC-B `web-build/` + `dist/` exclusion.
- `.github/workflows/strict-grep-mingla-business.yml` — registered the 2 new gates.

26 tracked files modified + 9 new files; +389/-14 in modified files (excludes package-lock + new files).

---

## 4. STOP-AND-AMEND — business Settings host (RESOLVED, reported)

The spec flagged a STOP-AND-AMEND: "business has NO general account-settings screen today (only AriSettingsScreen)." **That premise is outdated.** A real user-facing account-settings host EXISTS: `mingla-business/app/account/notifications.tsx`, reachable from the Settings hub on the `(tabs)/account` screen, already rendering toggle rows via a `SimpleToggleRow` + `GlassCard` pattern. I placed the "Analytics" opt-out there (the spec's allowlist explicitly permits "the nearest account/profile settings host"). I did NOT invent a new top-level route and did NOT use AriSettingsScreen (Ari-specific, wrong home). Flagging for the orchestrator/tester to confirm `app/account/notifications.tsx` is the intended host.

No other stop-and-amend triggers fired. No DO-NOT-TOUCH file was touched (mixpanel/appsflyer services, edge functions, admin, marketing analytics, Stripe/GIPHY IIFEs, CSP all untouched — verified by `git diff --name-only`).

---

## 5. Data-model changes

None. No migrations, no edge functions (this phase is client-only per spec).

---

## 6. Edge functions touched

None.

---

## 7. Regression tests + fails-on-revert

- **Consumer:** `app-mobile/src/services/__tests__/orch_1187_posthog_native_consumer.test.ts` — node:assert source-assertion (app-mobile has no jest/RTL runner; repo convention). 23 assertions PASS. Fails-on-revert: deleting `maskAllTextInputs: true` from `postHogService.ts` → `AssertionError: native replay must mask all text inputs`; restored → 23 PASS.
- **Business:** `mingla-business/src/services/__tests__/postHogService.orch1187.test.ts` — jest behavioral (mocks posthog-react-native/expo-constants/Platform). 3 tests PASS (no-op-on-missing-key T-10, masked-replay+US-host constructor, opt-out routing T-19). Fails-on-revert: deleting `maskAllTextInputs: true` → the masked-replay test FAILS; restored → 3 PASS.
- **Gate fails-on-revert:** removing `<PostHogAnalyticsProvider>` from a layout → `native-mounts-analytics` gate FAILS; restored → PASS.

`fails-on-revert verified at <COMMIT_HASH_PLACEHOLDER>` (real hash recorded post-commit below).

---

## 8. Old → New receipts (representative)

### postHogService.ts (both apps) — NEW
**Before:** no PostHog in either app. **Now:** singleton facade — US host, lazy-imported `posthog-react-native` (web-safe no-op), masked native replay (`maskAllTextInputs/Images: true`, 0.2 sample), `initialize/identify/capture/reset/optIn/optOut/getFeatureFlag`, graceful no-op on missing key, honors persisted opt-out at boot. **Why:** §4.C/§4.G/§4.H/§4.I.

### app/_layout.tsx (both) — provider mount
**Before:** Mixpanel/AppsFlyer only. **Now:** `<PostHogAnalyticsProvider>` wraps the route tree (autocapture + replay over the same client the call sites use). **Why:** §4.C / OQ-4.

### mingla-business/app/_layout.tsx — ATT
**Before:** AppsFlyer started with no ATT prompt (the gap). **Now:** iOS ATT prompt fires (deferred init) BEFORE AppsFlyer, plus PostHog init. **Why:** §4.F(a).

### AuthContext.tsx (business) — identity
**Before:** Mixpanel/AppsFlyer/RevenueCat/OneSignal identity. **Now:** + `postHogService.identify(user.id)` (warm + SIGNED_IN), `signup_completed` on first-time, `reset()` on both signout paths. **Why:** SC-7 / SC-6.

---

## 9. Cross-surface impact

| Surface | Affected | What changes |
|---------|----------|--------------|
| Consumer iOS | YES | PostHog autocapture/replay/events; ATT already wired; Settings Analytics toggle. Parity automatic with Android (shared RN code). |
| Consumer Android | YES | same (replay screenshot-based both OS). |
| Business iOS | YES | PostHog + NEW ATT prompt; Settings Analytics toggle on `account/notifications`. |
| Business Android | YES | PostHog (ATT is iOS-only no-op). Parity automatic. |
| Buyer/anon Web | NO | `postHogService` is native-only (lazy import + `Platform.OS==='web'` no-op); confirm.tsx capture is a no-op on web. Buyer-web is Leg 2. |
| Admin Web | NO | not touched (Phase 2). |
| Business Web preview | NO | postHogService no-ops on web. |

---

## 10. Known issues / deferred

- **Optional PostHog enrichment peers** (`react-native-device-info`, `react-native-localize`, business `@react-navigation/native`/`expo-device`/`expo-localization`) are NOT added. posthog-react-native@4.x requires every one via `try{require()}catch{}` — missing ones degrade gracefully (no crash; just less device enrichment). Only the SDK + `posthog-react-native-session-replay` (mandatory for masked replay) are added, to minimize native-build risk. Add later if Seth wants richer device props.
- **PostHog provider style:** chose `<PostHogProvider client={...} autocapture>` with the service owning the client, so autocapture + the imperative call-site captures share ONE instance (no double-client). The boot `initialize()` in index.tsx/_layout is idempotent with the provider's.
- **On-device verification** (SC-5/SC-12/SC-Security-Native recording inspection) requires the fresh native builds — see §11.

---

## 11. Operator action required

- **No migration. No edge deploy.** Pure client native code.
- **EAS env (REQUIRED to make PostHog live):** set `EXPO_PUBLIC_POSTHOG_KEY` = the **public `phc_*` project key** (project 479999) as an EAS env var / EAS Secret on BOTH apps, all release-bound profiles (development, preview, production for app-mobile; development, preview, production, production-apk for mingla-business). `EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com` is already committed in both `eas.json`. Do NOT put the key in eas.json (committed) — use EAS env/Secrets. The `phx_*` personal/MCP key must NEVER ship to a client.
- **Seth actions from the spec still apply:** SA-1 ($0 PostHog billing cap + no card on project 479999), SA-2 (enable session replay + surveys in project settings; create one smoke survey + experiment), SA-3 (confirm privacy policy mentions analytics cookies), SA-4 (ATT copy already present).
- **CRITICAL build coordination (COMMS-0047):** the consumer (`app-mobile`) OTA channel is FROZEN until a fresh native build lands, because (a) ORCH-1171 added `react-native-keyboard-controller` (native module, not in any shipped binary) and (b) THIS leg adds `posthog-react-native` + `posthog-react-native-session-replay` (native modules). **The single consumer build Seth cuts MUST include BOTH the PostHog native deps AND the ORCH-1171 keyboard module (+ the COMMS-0031 modular-headers plugin per DISC-1129-A) in one cut** — a build with one but not the other runtime-crashes on the missing module. Coordinate with the ORCH-1171 owner before cutting; build from MERGED `main`, not a worktree. Business app + both web surfaces are unaffected and verifiable immediately.

---

## 12. Discoveries for Orchestrator

1. **Leg 2 (buyer web) is NOT on main yet.** Dispatch said "Legs 1 & 2 already done," but only Leg 1 (marketing) is on origin/main — `mingla-business/src/analytics/` does not exist and `mingla-business/package.json` has no `posthog-js`. The existing gates already zero-violation-guard the buyer-web surface for when it lands. Out of my scope; flagging so Leg 2 is dispatched.
2. **The worktree's `origin/main` was stale at spawn** (`120806a83`); current origin/main is `acce886ba` (ORCH-1186 venue + ORCH-1188 PDF/calendar merged after spawn). I rebased onto current origin/main and resolved one workflow conflict (kept BOTH the new 1186 gate jobs and my 2 new 1187 gate steps). Clean closing diff confirmed.
3. **Spec STOP-AND-AMEND premise outdated** — see §4: a real business account-settings host exists (`app/account/notifications.tsx`).
4. **`account/notifications.tsx` already imports `@testing-library/react-native`-dependent tests fail in a fresh worktree** (baseline, pre-existing, ~800 unrelated tsc errors per app from missing `@mingla/payments-native` workspace symlink + missing RTL). My files typecheck clean; the baseline noise is not mine.
