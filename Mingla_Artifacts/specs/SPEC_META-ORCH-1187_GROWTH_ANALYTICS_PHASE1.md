# SPEC — META-ORCH-1187 [Growth Analytics Hub] — Phase 1

**Status:** IN SPEC — **v2 amended 2026-06-21** (consent banner + power features + replay masking + cost
guard + apps-no-longer-deferred folded in; ready for IMPLEMENT dispatch)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1187-[growth-analytics-hub]/` on branch `META-ORCH-1187-growth-analytics-hub`
**Author:** mingla-forensics
**Date:** 2026-06-21
**Classification:** missing-feature / architecture · **Severity:** S1-high

> This is a CONTRACT. The implementor builds exactly what is specified here, touches only the
> allowlisted files, and stops-and-amends before touching anything outside the allowlist. Illustrative
> snippets are ≤2-3 lines and are NOT the implementation.

---

## VERSION HISTORY

- **v1 (2026-06-21, commit d3f475c37):** Original INVESTIGATE+SPEC. PostHog + GA4 across 6 surfaces,
  3-PR sequence, conversion events, dashboards, 3 I-PROPOSED invariants. Consent banner OUT (OQ-2),
  apps deferred-on-build, no session replay / power-features, no PII masking spec.
- **v2 (2026-06-21, THIS revision):** Folds in five Seth decisions of 2026-06-21:
  1. **Consent banner NOW, IN SCOPE** — custom Mingla-branded, on BOTH web surfaces, with a REAL
     gate (PostHog opt-out-by-default + GA4 Consent Mode v2 default-denied). Native = ATT + in-app
     Settings opt-out. (Was OQ-2, flagged out.) See new §4.E + §4.F.
  2. **ALL PostHog power features ON, free-tier-only** — autocapture, session replay, feature flags,
     experiments, surveys, error tracking. Paid features (group analytics, data warehouse beyond free)
     EXCLUDED. See new §4.G.
  3. **Session-replay PII masking MANDATORY (security gate)** — web + native, hard-mask payment/auth/
     PII. A replay capturing a card field = automatic FAIL. See new §4.H + §SC-Security.
  4. **Cost guard "stay free"** — $0 PostHog billing limit (Seth action) + autocapture/replay sampling.
     See new §4.I.
  5. **Apps no longer deferred** — fresh consumer native build cut now; consumer on-device verification
     rides that build; coordinate the ORCH-1171 native dep (COMMS-0047). 3-PR sequence unchanged.
- New invariants added v2: I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES, I-PROPOSED-1187-REPLAY-MASKS-PII,
  I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS (rename/clarify of the prior web-only invariant).

---

## 1. Executive summary

Mingla has product-analytics on the two **native apps** (Mixpanel + AppsFlyer, mature) but **ZERO
analytics on the website surfaces** — the marketing site (`usemingla.com`) and the buyer-web checkout/
public pages capture nothing. Every marketing visitor and every anonymous buyer-web session is invisible:
we cannot see acquisition, funnel drop-off, or web conversions, and we cannot link Google Ads.

Phase 1 establishes **PostHog as the single canonical product-analytics tool across ALL surfaces** and
**GA4 on the two web surfaces** (acquisition + free Google Ads link), in a strict sequence that stops the
website bleed first:

1. **Marketing web FIRST** (highest urgency — live site losing visitors): PostHog JS + GA4.
2. **Buyer web** (mingla-business web surface): PostHog JS + GA4, web-only, no native impact.
3. **posthog-react-native in BOTH apps** (consumer + business): one provider at boot, hooking the
   existing conversion call sites.

Phase 1 only **ADDS** PostHog alongside the existing Mixpanel/AppsFlyer. **Mixpanel is NOT removed this
phase.** BigQuery/Looker are Phase 2+ and out of scope.

---

## 2. Scope & non-goals

### In scope (Phase 1)
- Add PostHog browser SDK (`posthog-js`) to **marketing web** + a GA4 tag.
- Add PostHog browser SDK + GA4 tag to **buyer web** (the `mingla-business` Expo-web surface), web-only.
- Add `posthog-react-native` to **app-mobile** (consumer) and **mingla-business** (business) native, one
  provider mounted once at boot, identity bound at auth, hooking the existing conversion call sites.
- Define the first conversion events (the 3 conversions per surface) + a small set of first behavior
  events, and the first PostHog dashboards.
- A per-surface verification plan (events landing in PostHog project **479999** + GA4 realtime).
- A fails-on-revert regression-test contract per surface.
- **(v2) Custom Mingla-branded consent banner on BOTH web surfaces** (marketing + buyer web), with a
  REAL gate: PostHog + GA4 set NO cookies / load NO data until the visitor accepts. Accept / Reject
  (+ Manage). Links to the existing privacy policy. See §4.E. (Was OQ-2, now resolved IN.)
- **(v2) Native consent posture** (no cookie banner): respect iOS App Tracking Transparency (ATT) +
  an in-app **"Analytics"** opt-out toggle in each app's Settings + PostHog native opt-out API. See §4.F.
- **(v2) ALL PostHog free-tier power features ON** across all 6 surfaces — autocapture, session replay
  (web + native), feature flags, experiments (A/B), surveys, error tracking. Paid features EXCLUDED.
  See §4.G.
- **(v2) Mandatory session-replay PII masking** (security gate) — web + native; hard-mask payment/auth/
  PII fields. See §4.H + the §security success criteria.
- **(v2) "Stay free" cost-guard config** — $0 PostHog billing limit (Seth action) + autocapture/replay
  sampling to protect the free allowance. See §4.I.

### Non-goals (explicitly OUT of Phase 1 — do NOT do these)
- **Mixpanel removal.** Mixpanel + AppsFlyer stay wired and firing. PostHog is ADDED in parallel. Mixpanel
  retirement happens only AFTER PostHog is verified on both apps — a LATER phase, not here. Reason: a
  parallel run is the only safe way to validate PostHog covers the existing events before deleting the
  incumbent.
- **BigQuery / Looker.** The data-warehouse hub is Phase 2+. Do not stand up any export pipeline.
- **GA4 on the native apps.** Apps use PostHog, NOT GA4. GA4 is web-only (marketing + buyer web).
- **A second GA4 data stream for buyer web.** Phase 1 uses the SINGLE existing GA4 property
  (Measurement ID `G-Z4W3B9900S`, stream `usemingla.com`) on BOTH web surfaces. Whether buyer-web gets
  its own dedicated GA4 stream is a Phase-2 decision (see Open Questions OQ-1) — do not create a new stream.
- **Reverse-proxying the PostHog ingestion host.** Phase 1 sends directly to `https://us.i.posthog.com`.
  Ad-blocker mitigation via a same-origin proxy is a Phase-2 optimization (see OQ-3).
- **Server-side / S2S PostHog capture from edge functions.** All Phase-1 capture is client-side.
- **(v2) PostHog PAID features.** Explicitly EXCLUDED this phase (free-tier-only mandate): **Group
  analytics** (paid add-on, ~$0.000071/event), **Data warehouse beyond the free 1M-row tier** (no
  external-warehouse syncs/large imports), **paid platform add-ons** (Teams/Enterprise SSO, advanced
  permissions, CDP/destinations beyond free), and any feature that bills per-unit past the free
  allowance. Do NOT enable group analytics or stand up warehouse syncs. See §4.G for the explicit
  free-tier allowlist + per-feature limits.
- **(v2) A consent-management PLATFORM (CMP/OneTrust/Cookiebot/Osano).** Phase 1 ships a lightweight,
  Mingla-branded, first-party consent UI built from existing design tokens — NOT a third-party CMP and
  NOT a new design system. Integrating a full CMP is out of scope.
- **(v2) Native cookie banner.** A cookie/consent banner does NOT apply to the native apps; native uses
  ATT + an in-app Settings opt-out instead (§4.F). Do not add a web-style banner to either app.

### Assumptions
- PostHog project 479999, region US, ingestion host `https://us.i.posthog.com`, client key `phc_*`
  (safe in client bundles) already exist (per dispatch — values in the master keys doc).
- GA4 property exists: Measurement ID `G-Z4W3B9900S`, stream `usemingla.com`.
- The `phx_*` personal/MCP key is SERVER/MCP ONLY and MUST NOT appear in any committed source or client
  bundle.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | YES (step 3) | **(v2)** ATT prompt (existing) + an "Analytics" opt-out toggle in Settings; events captured to PostHog (incl. masked session replay) when not opted-out | `app-mobile/app/_layout.tsx`, `app-mobile/app.config.ts`, `app-mobile/package.json`, `app-mobile/src/services/postHogService.ts` (new), `app-mobile/src/store/appStore.ts` (opt-out flag), `app-mobile/src/components/profile/AccountSettings.tsx` (toggle row), conversion call sites | Manual (RN native path) |
| 2 | Consumer Android (`app-mobile/` Android) | YES (step 3) | **(v2)** Analytics opt-out toggle in Settings (no ATT on Android); events + masked replay captured when not opted-out | same as #1 (no ATT) | Automatic w/ #1 (shared RN code) |
| 3 | Buyer/anonymous Web (`mingla-business` web: `/checkout/{eventId}`, `/e/...`, `/b/...`, `/t/...`, `/exp/...`) | YES (step 2) | **(v2)** Mingla-branded consent banner on first visit; PostHog JS + GA4 fire ONLY after Accept; masked session replay | `mingla-business/app/_layout.tsx`, `mingla-business/src/analytics/webAnalytics.web.ts` (new) + `.ts` no-op (new), `mingla-business/src/analytics/ConsentBanner.web.tsx` (new) + `.tsx` no-op (new), `mingla-business/app.config.ts`, `mingla-business/package.json` | Manual (web-only `.web.ts(x)` split) |
| 4 | Business iOS (`mingla-business` native iOS) | YES (step 3) | **(v2)** ATT prompt (NEW — wired this phase) + "Analytics" opt-out toggle in Settings; events + masked replay captured when not opted-out | `mingla-business/app/_layout.tsx`, `mingla-business/app.config.ts` (ATT plugin + NSUserTracking string), `mingla-business/package.json` (+`expo-tracking-transparency`), `mingla-business/src/services/postHogService.ts` (new), `mingla-business/src/store/*` (opt-out flag), Settings screen (new analytics toggle), conversion call sites | Manual (RN native path) |
| 5 | Business Android (`mingla-business` native Android) | YES (step 3) | **(v2)** Analytics opt-out toggle in Settings (no ATT); events + masked replay captured when not opted-out | same as #4 (no ATT) | Automatic w/ #4 |
| 6 | Marketing Web (`mingla-marketing/`, Next.js 15 app-router) | YES (step 1) | **(v2)** Mingla-branded consent banner on first visit; PostHog JS + GA4 fire ONLY after Accept | `mingla-marketing/app/layout.tsx`, `mingla-marketing/components/marketing/posthog-provider.tsx` (new), `mingla-marketing/components/marketing/consent-banner.tsx` (new), `mingla-marketing/package.json`, `.env.example` | Standalone (own app) |
| 7 | Admin Web (`mingla-admin/`, adjacent) | NO | — | — | Out of Phase-1 scope: admin is internal-only, no acquisition/conversion value; revisit Phase 2 |

Note: buyer web (#3) and business-native web-preview render from the SAME `mingla-business` Expo app — the
`.web.ts` split + `Platform.OS==='web'` guard means the web analytics code never loads on native.

---

## 4. Layered specification — per surface

### 4.A — Marketing web (Next.js 15, app-router) — STEP 1, HIGHEST URGENCY

**Architecture confirmed (evidence):**
- App-router, NOT pages-router: `mingla-marketing/app/layout.tsx` is the root layout; homepage is the
  `(explorer)` route group (`mingla-marketing/app/(explorer)/page.tsx`).
- NO analytics today: `posthog`/`gtag`/`@next/third-parties` all absent from `package.json` and source
  (verified by grep — only `package-lock` `tostringtag` noise hits).
- Client-env convention is `NEXT_PUBLIC_*` read via `process.env.NEXT_PUBLIC_X` (evidence:
  `lib/beta-access-submit.ts:32-33`, `lib/unsubscribe-submit.ts:28-29`). `.env.example` exists.
- A `'use client'` component is already mounted in the root layout body
  (`components/marketing/content-protection.tsx`, imported at `app/layout.tsx:4`, rendered at L51) — the
  clean precedent for mounting a client analytics provider.
- `next.config.ts` sets CSP `frame-ancestors 'self'` (does NOT restrict script-src or connect-src, so no
  CSP edit is strictly required — but see CSP note below).

**Install approach:**
- **PostHog:** add `posthog-js` to `mingla-marketing/package.json` dependencies. Initialize in a
  `'use client'` provider component (`components/marketing/posthog-provider.tsx`) that calls
  `posthog.init(key, { api_host: 'https://us.i.posthog.com', ... })` inside a `useEffect`, and mount it in
  `app/layout.tsx` wrapping `{children}` (sibling/parent of `<ContentProtection/>`). Use the
  `instrumentation-client.ts` pattern only if preferred for earliest init; the provider-in-layout pattern
  is the baseline (matches the existing content-protection precedent).
- **GA4:** use **`@next/third-parties`** (`<GoogleAnalytics gaId="G-..." />` from
  `@next/third-parties/google`). This is the Next.js-canonical, App-Router-aware GA4 install (handles SPA
  route-change pageviews automatically). Add `@next/third-parties` to dependencies and mount
  `<GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID!} />` in `app/layout.tsx` body. Do NOT
  hand-roll a raw `<script>` gtag snippet — `@next/third-parties` is the standard and gives SPA pageviews.

**PostHog init config (marketing + buyer web identical config object) — v2 (consent-gated + power features):**
```ts
posthog.init(KEY, { api_host: 'https://us.i.posthog.com', person_profiles: 'identified_only',
                    capture_pageview: true, capture_pageleave: true,
                    opt_out_capturing_by_default: true,        // v2 CONSENT GATE — no cookies/capture until opt_in
                    autocapture: true, capture_exceptions: true, // v2 power features (autocapture + error tracking)
                    disable_session_recording: false,           // v2 session replay ON (masked — see §4.H)
                    session_recording: { maskAllInputs: true, maskTextSelector: '[data-ph-mask]',
                                         maskInputOptions: { password: true, email: true } } })
```
- `api_host` MUST be `https://us.i.posthog.com` (US region — dispatch-locked).
- `person_profiles: 'identified_only'` keeps anonymous web visitors as events without minting a person
  profile until/unless identified — appropriate for an anon-heavy marketing/buyer surface.
- `capture_pageview` is left ON (PostHog autocaptures SPA route changes for client-side nav).
- **(v2) `opt_out_capturing_by_default: true`** is the REAL consent gate: PostHog stores NOTHING in
  cookies / localStorage and captures NO events until `posthog.opt_in_capturing()` is called by the
  consent banner Accept handler (§4.E). This is verified by PostHog's documented behavior:
  "it never stores PostHog data in cookies or local/session storage until the user opts in." Reject =>
  call `posthog.opt_out_capturing()` (no-op since already opted out, but explicit for clarity + future).
- **(v2) session-replay masking** keys are MANDATORY here — see §4.H for the full hard-mask contract.
- The exact power-feature flags (autocapture, replay, flags, surveys, experiments, error tracking) are
  specified in §4.G; replay masking in §4.H; sampling in §4.I.

**Env vars (marketing):** set in `.env` (local), `.env.example` (committed, placeholder only), and
**Vercel project env** for the `mingla-marketing` project (Production + Preview):
- `NEXT_PUBLIC_POSTHOG_KEY` = the `phc_*` client key
- `NEXT_PUBLIC_POSTHOG_HOST` = `https://us.i.posthog.com`
- `NEXT_PUBLIC_GA4_MEASUREMENT_ID` = `G-Z4W3B9900S`
The provider must **no-op gracefully** when `NEXT_PUBLIC_POSTHOG_KEY` is missing (guard the `init`), so a
missing env never crashes the live site.

**CSP note:** `next.config.ts` `securityHeaders` only sets `frame-ancestors` (not a full CSP). PostHog
(`us.i.posthog.com`, `us-assets.i.posthog.com`) and GA (`www.googletagmanager.com`,
`*.google-analytics.com`) load fine under the current headers. **Do NOT tighten CSP into a script-src/
connect-src allowlist** in Phase 1 (out of scope, regression risk); if a future hardening adds a strict
CSP, it must allowlist those hosts. Document this in the provider file comment.

**Marketing conversion/behavior events (client-side `posthog.capture(...)`):**
- `marketing_cta_clicked` — fire on the primary "Get Beta Access" / app-store CTA taps. Call sites:
  `components/marketing/cta-banner.tsx`, `components/marketing/beta-access-modal.tsx` (submit success),
  `components/marketing/glass-nav.tsx` (nav CTA). Properties: `cta_id`, `location`.
- `beta_access_submitted` — fire on successful `beta-access-submit` POST (`lib/beta-access-submit.ts`
  success path). Property: `surface_role` (organiser/consumer if known).
- Pageviews are autocaptured (PostHog) + GA4 (via `@next/third-parties`); no manual pageview code.

### 4.B — Buyer web (`mingla-business` Expo-web surface) — STEP 2

**Architecture confirmed (evidence):**
- Build = **Expo Router + Expo Web (Metro web bundler)**, NOT Next/Vite. Evidence:
  `package.json` `"web": "expo start --web"`, `"web:export": "expo export -p web ..."`; `app.json`
  `web.output: "single"`; `vercel.json` build `npx expo export -p web && ...`.
- Root layout always mounted: `mingla-business/app/_layout.tsx` (provider tree:
  GestureHandlerRootView → SafeAreaProvider → ErrorBoundary → QueryClientProvider → AuthProvider →
  KeyboardRoot → RootLayoutInner). Web HTML doc: `mingla-business/app/+html.tsx`.
- `.web.tsx`/`.web.ts` file splits + `Platform.OS === 'web'` guards are the established native/web
  separation pattern (e.g. `src/services/mixpanelService.web.ts` is a pure no-op stub).
- Buyer-web public routes confirmed present: `app/checkout/[eventId]/index.tsx` (+ `buyer.tsx`,
  `payment.tsx`, `confirm.tsx`), `app/e/[brandSlug]/[eventSlug].tsx`, `app/b/[brandSlug]/index.tsx`,
  `app/t/[brandSlug]/[tripSlug].tsx`, `app/exp/[brandSlug]/[experienceSlug].tsx`, `app/o/[orderId].tsx`,
  plus trip/experience checkout-confirm routes. These are PUBLIC (exempt from the auth redirect via
  `isPublicBuyerRoute()`).

**Install approach (web-only, ZERO native impact):**
- Add `posthog-js` to `mingla-business/package.json`. (Native uses `posthog-react-native` from step 3 —
  the two never load together: `posthog-js` is referenced ONLY from a `.web.ts` module.)
- Create a **`.web.ts` + `.ts` no-op pair** mirroring `mixpanelService.web.ts`:
  - `src/analytics/webAnalytics.web.ts` — imports `posthog-js`, calls `posthog.init(...)` with the SAME
    config object as §4.A, loads the GA4 gtag snippet, and exposes `initWebAnalytics()`,
    `captureWeb(name, props)`, `identifyWeb(id, props)`.
  - `src/analytics/webAnalytics.ts` — pure no-op stub (every export a `noop`), so native bundles never
    pull `posthog-js`/gtag. (Metro resolves `.web.ts` on web, `.ts` on native — exact mechanism the
    mixpanel split already relies on.)
- Mount: call `initWebAnalytics()` once from `app/_layout.tsx` inside a `Platform.OS === 'web'`-guarded
  effect in the existing boot path (near the deferred-init block) — guarded so native is byte-unaffected.
- **GA4 on buyer web:** since this is Expo-web (not Next), `@next/third-parties` is unavailable. Load GA4
  via the standard gtag snippet INSIDE `webAnalytics.web.ts` (inject the `googletagmanager.com/gtag/js`
  script + `gtag('config', G-...)`), OR inject into `app/+html.tsx` `<head>` guarded so it only ships in
  the web export. Prefer the `webAnalytics.web.ts` programmatic inject (keeps GA + PostHog co-located,
  env-gated, and out of native). Use the SAME `G-Z4W3B9900S` Measurement ID (single shared stream — see
  Non-goals + OQ-1).

**Env vars (buyer web):** add to `mingla-business/app.config.ts` `extra` block (the canonical reachable-
on-web-and-native pattern — evidence: `app.config.ts:124+` + the GIPHY IIFE comment at L200-204 + the
COMMS-0028 lesson that ONLY `extra` survives Hermes; on web, `expo export` inlines `extra` too):
- `EXPO_PUBLIC_POSTHOG_KEY` (phc_*), `EXPO_PUBLIC_POSTHOG_HOST` (`https://us.i.posthog.com`),
  `EXPO_PUBLIC_GA4_MEASUREMENT_ID` (`G-Z4W3B9900S`).
- Read via `Constants.expoConfig?.extra?.EXPO_PUBLIC_POSTHOG_KEY ?? process.env.EXPO_PUBLIC_POSTHOG_KEY`
  (mirror `src/services/supabase.ts:9-19`). Set the underlying values in the Vercel `mingla-business`
  project env (Production + Preview) and local `.env`.

**Buyer-web conversion events (`captureWeb(...)` in `.web.ts`):**
- `web_purchase_completed` — at the ticket-checkout success site:
  `app/checkout/[eventId]/confirm.tsx` where `confirmResult.status === "paid"` → `recordResult({...})`
  (≈L251-265). Props: `order_id`, `total`, `currency`, `ticket_count`, `offering_type:'event'`.
  Mirror at `app/checkout-trip/[tripEventId]/confirm.tsx` (`offering_type:'trip'`) and
  `app/checkout-experience/[experienceEventId]/confirm.tsx` (`offering_type:'experience'`).
- `web_checkout_started` — at `app/checkout/[eventId]/index.tsx` mount (buyer lands on cart). Props:
  `event_id`, `offering_type`.
- `web_public_offering_viewed` — at each public page mount (`e/`, `t/`, `exp/`, `b/`). Props:
  `offering_type`, `brand_slug`, `slug`.
GA4 mirrors: also fire GA4 `purchase` (with `value`+`currency`) + `begin_checkout` at the same sites for
the Google Ads conversion link. (Signup/publish do NOT exist on buyer web — anon surface.)

### 4.C — Native apps (app-mobile consumer + mingla-business business) — STEP 3

**Architecture confirmed (evidence):**
- `posthog-react-native` is NOT a dependency in either app (verified — `package.json` grep clean).
- Existing analytics are mature: Mixpanel + AppsFlyer.
  - app-mobile: init in `app/index.tsx` (`mixpanelService.initialize()` ≈L301-307; `initializeAppsFlyer()`
    ≈L365-367), services at `src/services/mixpanelService.ts`, `src/services/appsFlyerService.ts`.
  - business: deferred init in `app/_layout.tsx:441-456` (`initializeAppsFlyer()`, `mixpanelService.initialize()`),
    identity bound in `src/context/AuthContext.tsx` (SIGNED_IN ≈L475-531).
- **NO shared analytics abstraction exists** in either app — each SDK is called directly at call sites.
  Phase 1 introduces a THIN shared wrapper so PostHog is added without per-call-site duplication.
- App boot / provider mount points:
  - app-mobile root: `app/_layout.tsx` (Sentry.wrap → GestureHandlerRootView → StripeNativeProvider →
    KeyboardRoot → PersistQueryClientProvider → Stack); app logic in `app/index.tsx` `AppContent` (L155+).
  - business root: `app/_layout.tsx` (provider tree above).

**Install approach:**
- Add `posthog-react-native` to BOTH `app-mobile/package.json` and `mingla-business/package.json`.
- Create `src/services/postHogService.ts` in EACH app — a singleton wrapper exposing
  `initialize()`, `identify(userId, props?)`, `capture(name, props?)`, `reset()`. It reads the key/host
  from `Constants.expoConfig?.extra?.EXPO_PUBLIC_POSTHOG_KEY` / `..._HOST` (mirror supabase.ts; never
  dynamic bracket access — COMMS-0028). It no-ops if the key is missing.
- Mount/init ONCE at boot ALONGSIDE the existing deferred Mixpanel init:
  - app-mobile: in `app/index.tsx` next to `mixpanelService.initialize()` (≈L304).
  - business: in `app/_layout.tsx` deferred-init block (≈L446).
  - **(v2 — OQ-4 resolved):** because autocapture + session replay are now REQUIRED (§4.G), wrap the app
    root with `<PostHogProvider client={...} autocapture options={{ enableSessionReplay: true,
    sessionReplayConfig: {/* masked — §4.H */} }}>` (replay + autocapture need the provider, not bare
    imperative init). Keep the `postHogService` singleton as the capture/identify/opt-out facade the call
    sites use; the provider supplies autocapture + replay. Mount the provider in each app's root
    `app/_layout.tsx` provider tree (alongside the existing providers), NOT a deep child.

**Env vars (native):** add `EXPO_PUBLIC_POSTHOG_KEY` + `EXPO_PUBLIC_POSTHOG_HOST` to the `extra` block in
BOTH `app-mobile/app.config.ts` and `mingla-business/app.config.ts`, sourced from
`process.env.EXPO_PUBLIC_POSTHOG_KEY ?? "<phc_ fallback>"`. Set the real values in **EAS** (eas.json env
per profile and/or EAS Secrets) so dev/preview/production builds inline them into `extra`. (GA4 is NOT
added to native.)

**Native conversion call sites to hook with `postHogService.capture(...)` (alongside existing calls):**

| Conversion | app-mobile (consumer) | mingla-business (business) |
|------------|------------------------|-----------------------------|
| Signup (account created, first-time) | `app/index.tsx` ≈L934-941 `trackSignupCompleted()` site (first-time gate `signupFiredRef`) | `src/context/AuthContext.tsx` ≈L512-521 (the first-time `af_complete_registration` / `trackLogin` block) |
| Purchase (ticket/booking success) | `src/screens/Event/ConsumerEventDetailScreen.tsx` ≈L431 `result.outcome === "succeeded"` | `app/checkout/[eventId]/confirm.tsx` ≈L251 `recordResult({...})` (+ trip/experience confirm twins) |
| Offering published (creator) | N/A — consumer has no publish flow (confirmed) | event: `src/hooks/useBusinessEvents.ts` `usePublishBusinessEventDraft` onSuccess ≈L196-204; trip: `src/hooks/useTrips.ts` `usePublishTrip` onSuccess; experience: `src/components/experience/ExperienceCreatorWizard.tsx` `biz_publish_experience` success |

**Identity binding:** call `postHogService.identify(user.id, {...})` at the SAME site Mixpanel identifies —
app-mobile cold-boot + signup path; business `AuthContext` SIGNED_IN (≈L485-489) + cold-boot (≈L378). Call
`postHogService.reset()` on signout alongside `mixpanelService.trackLogout()` / AppsFlyer clear
(business `AuthContext` ≈L548-550).

**First behavior events (consumer, low-effort — existing Mixpanel sites to mirror):**
`card_viewed` (`SwipeableCards.tsx` ≈L1186), `card_expanded` (≈L1765), `card_saved` (≈L1869),
`card_dismissed` (≈L1881), `deck_exhausted` (≈L2416). Add a `postHogService.capture(...)` next to each
existing Mixpanel call. Keep the event-name strings IDENTICAL across PostHog/Mixpanel so the eventual
Mixpanel retirement (later phase) is a 1:1 mapping.

### 4.D — First PostHog dashboards (project 479999)

Create (in the PostHog UI, documented in the implementor report, not code):
1. **Acquisition (web)** — pageviews, unique visitors, top referrers, UTM sources (marketing + buyer web).
2. **Web conversion funnel** — `web_public_offering_viewed` → `web_checkout_started` →
   `web_purchase_completed`.
3. **App activation funnel** — signup → first `card_saved` → first purchase (per app).
4. **Conversions overview** — the 3 conversions across all surfaces (signup, purchase, offering published).

---

### 4.E — (v2) Consent banner — BOTH web surfaces (marketing + buyer web)

**Decision (Seth 2026-06-21):** Ship a custom **Mingla-branded** consent banner NOW on both web
surfaces, with a REAL gate — PostHog and GA4 must NOT set cookies / load until the visitor accepts.
This is the resolution of the former OQ-2 (which had flagged consent OUT).

**Hard rule:** build the banner from Mingla's EXISTING design tokens/components — do NOT invent a new
design system, and do NOT pull in a third-party CMP.

**Privacy-policy link (LOCATED — cite, do not invent):**
- Marketing site privacy policy EXISTS at route **`/privacy-policy`** →
  `mingla-marketing/app/privacy-policy/page.tsx` (content from `@/lib/privacyContent`). Terms at
  `/terms-of-service`. Contact `privacy@usemingla.com`.
- ⚠️ **Footer href mismatch (Seth-action / implementor-note):** `mingla-marketing/components/marketing/
  footer.tsx` links to `/privacy` and `/terms` (lines ~35-36, 63-64) but the real routes are
  `/privacy-policy` and `/terms-of-service`. The consent banner MUST link to the REAL routes
  (`/privacy-policy`). Fixing the stale footer hrefs is a small adjacent correction — allowlisted in
  §allowlist but flagged so it is not silently widened.
- Buyer-web banner: link to the SAME public privacy URL `https://usemingla.com/privacy-policy` (buyer
  web has no own privacy page; the canonical policy lives on the marketing domain).

**Marketing consent UI (Next.js) — design contract:**
- NEW `'use client'` component `mingla-marketing/components/marketing/consent-banner.tsx`, mounted in
  `app/layout.tsx` next to `<ContentProtection/>` (line 51) — the established root client-overlay
  precedent.
- Visual tokens (cite — from `app/globals.css`): panel = `.glass-strong` (or `.glass-soft`) surface
  with `data-theme="light"` forced (the BetaAccessModal precedent, `beta-access-modal.tsx:319`); radius
  `--radius-2xl` (36px) / `--radius-lg`; Accept button = `<Button variant="primary">`
  (`components/ui/button.tsx`, warm `--color-warm #eb7825`); Reject = `<Button variant="ghost">` or
  `variant="secondary"`; "Manage" = `variant="glass"`; text via `--color-text-primary` /
  `--color-text-secondary`; border `--color-divider`. Animate with `framer-motion` AnimatePresence +
  `useMinglaReducedMotion()` (`lib/reduced-motion.ts`). Bottom-anchored sheet/banner, dismiss-blocking
  until a choice is made (no implicit consent).
- Buttons: **Accept all** / **Reject** / **Manage** (Manage may, for Phase 1, be a single combined
  analytics toggle — full granular categories are not required, but the structure must allow it).
- a11y: `role="dialog"` `aria-label="Cookie consent"`, focus moves into the banner, ≥44pt targets.

**Buyer-web consent UI (Expo-web) — design contract:**
- NEW `mingla-business/src/analytics/ConsentBanner.web.tsx` (web-only via the `.web.tsx` split) + a
  `ConsentBanner.tsx` no-op stub (returns `null`) so native never renders it. Mounted in
  `mingla-business/app/_layout.tsx` behind `Platform.OS === 'web'`.
- Build from mingla-business's existing RN primitives/theme tokens (mirror the app's button + surface
  styling); Accept/Reject/Manage; link to `https://usemingla.com/privacy-policy`.

**State storage (where consent is persisted):**
- **Marketing (Next.js):** `localStorage` key `mingla_consent_v1` = `"granted" | "denied"` (+ timestamp).
  PostHog ALSO tracks its own opt-in/out in its storage; `localStorage` is the banner's own source of
  truth for whether to re-show. On load: if key absent → show banner, keep PostHog opted-out +
  GA4 default-denied; if `"granted"` → `posthog.opt_in_capturing()` + GA4 `consent update granted`; if
  `"denied"` → stay denied.
- **Buyer web (Expo-web):** same `localStorage` key (`window.localStorage` is available in the web
  export). The `.web.tsx` banner reads/writes it; the `.web.ts` analytics module checks it before init.

**The REAL gate — exact mechanism per surface:**
- **PostHog (both web):** `posthog.init(..., { opt_out_capturing_by_default: true })` (§4.A). On Accept:
  `posthog.opt_in_capturing()`. On Reject: `posthog.opt_out_capturing()`. Documented guarantee: nothing
  is written to cookies/local/session storage and no events fire until opt-in.
- **GA4 Consent Mode v2 (both web):** BEFORE the GA4 tag loads any measurement, run
  `gtag('consent', 'default', { ad_storage:'denied', analytics_storage:'denied',
  ad_user_data:'denied', ad_personalization:'denied' })`. On Accept:
  `gtag('consent', 'update', { ...all 'granted' })`. On Reject: leave defaults denied (GA4 then runs in
  cookieless "consent mode" pinged-but-no-cookies state). The `default` command MUST execute before any
  `config`/`event` — on marketing this means the consent-default snippet runs ahead of
  `@next/third-parties` `<GoogleAnalytics>`; on buyer web it runs at the top of `webAnalytics.web.ts`
  before the gtag `config`.

**Marketing CSP note (revised):** PostHog + GA hosts still load under the current headers; no CSP edit
needed. (Unchanged from §4.A.)

### 4.F — (v2) Native consent posture (no cookie banner) — both apps

A cookie banner does NOT apply to native. Native consent = **(a) iOS ATT + (b) an in-app Settings
opt-out + (c) PostHog native opt-out API.**

**(a) iOS App Tracking Transparency (ATT):**
- **app-mobile (consumer):** ATT is ALREADY wired. `expo-tracking-transparency@~6.0.8` is a dep;
  `app.json` plugin (lines ~161-166) sets `userTrackingPermission`; the prompt fires via
  `src/services/permissionOrchestrator.ts:26-27` (`requestTrackingPermissionsAsync()`) after the coach
  tour, ahead of AppsFlyer `startAppsFlyer()`. PostHog init must respect the resolved ATT state: when
  ATT is denied, PostHog still captures product events but MUST NOT be used for cross-app ad tracking
  (PostHog does not use IDFA, so this is satisfied by default; no IDFA is passed to PostHog). No new ATT
  work needed in consumer — reuse the existing gate.
- **mingla-business (business):** ATT is a GAP — `app.json` has the `NSUserTrackingUsageDescription`
  string (line ~19) but `expo-tracking-transparency` is NOT a dep and NO prompt is wired. v2 ADDS the
  dep + the `expo-tracking-transparency` plugin (mirror the consumer `app.json` plugin block) + fires
  `requestTrackingPermissionsAsync()` once at the existing deferred-init moment in `app/_layout.tsx`
  (the `InteractionManager.runAfterInteractions` block, ~L441-456) BEFORE `startAppsFlyer()`. Use the
  existing business NSUserTracking copy (already present).

**(b) In-app "Analytics" opt-out toggle (both apps):**
- **app-mobile:** add a toggle row to `src/components/profile/AccountSettings.tsx` Privacy section
  (after the existing toggles ~L807-831), using the existing `Toggle`/`SettingsRow` pattern
  (`src/components/profile/Toggle.tsx`, `SettingsRow.tsx`). Label "Analytics", hint "Help improve
  Mingla by sharing anonymous usage data. You can turn this off any time."
- **mingla-business:** the business app has NO general account-settings screen today (only
  `src/screens/ari/AriSettingsScreen.tsx`, Ari-specific). Add a small "Privacy" section to that screen
  (or the nearest account/profile settings surface) with the same toggle, matching its `Section`/
  `FieldRow` pattern. **Implementor stop-and-amend trigger:** if no suitable user-facing settings host
  exists in business beyond Ari settings, STOP and request a SPEC amendment naming the exact host (do
  NOT invent a new top-level settings route unilaterally).

**(c) Storage + gate:**
- Persist the opt-out as a boolean in the app's Zustand persisted store (consumer:
  `src/store/appStore.ts` — `analyticsOptOut: boolean` + `setAnalyticsOptOut`, persisted via the
  existing debounced-AsyncStorage middleware; business: its equivalent Zustand store).
- `postHogService` (§4.C) reads the flag: on opt-out call `posthog.optOut()` (posthog-react-native);
  on opt-in `posthog.optIn()`. Default = opted-IN for product analytics (anonymous, no IDFA), which is
  consistent with the existing Mixpanel/AppsFlyer posture; the toggle lets the user opt OUT. (No
  pre-consent web-style hard gate on native — ATT covers the ad-tracking consent obligation; the toggle
  covers product-analytics choice.)

### 4.G — (v2) PostHog power features — ON, strictly free-tier, all 6 surfaces

Enable EVERY free-tier PostHog product. EXCLUDE anything that bills past the free allowance.

| Feature | Enable how | FREE monthly limit | Surfaces |
|---------|-----------|--------------------|----------|
| **Autocapture** | `autocapture: true` (web, default ON); posthog-react-native autocapture via `<PostHogProvider autocapture>` OR `captureScreenViews`/`captureTouches` opts | counts toward **Product analytics: 1M events/mo** | all 6 |
| **Session replay** | web: `disable_session_recording: false` + `session_recording` (§4.H); native: `enableSessionReplay: true` + `sessionReplayConfig` (§4.H). **Must be enabled in PostHog project settings too.** | **5K recordings/mo** | all 6 (native replay = §4.H caveat) |
| **Feature flags** | `posthog.isFeatureEnabled(key)` / `posthog.getFeatureFlag(key)` (web + native; bootstrap a no-op first flag to prove wiring) | **1M flag requests/mo** | all 6 |
| **Experiments (A/B)** | built on feature flags — `posthog.getFeatureFlag()` variant read; create one smoke experiment in UI | billed with flags (no separate limit) | all 6 |
| **Surveys** | enable in PostHog UI + the SDK survey hooks (web auto-renders; native via `posthog-react-native` survey API) | **1500 responses/mo** | all 6 |
| **Error tracking** | web: `capture_exceptions: true`; native: posthog-react-native exception autocapture (and/or manual `captureException`) | **100K exceptions/mo** | all 6 |

**EXPLICITLY EXCLUDED (NOT free — do NOT enable):**
- **Group analytics** — paid add-on (~$0.000071/event). Do not call `posthog.group(...)`.
- **Data warehouse beyond the free 1M-row tier** — no external-source syncs / large imports.
- **Paid platform add-ons** (Teams/Enterprise SSO, advanced permissions, paid CDP destinations).

**Native session replay caveat (call out deliberately):** `posthog-react-native` session replay
("native replay") is NEWER than web replay, is `false` by default, AND must be turned on in BOTH the SDK
(`enableSessionReplay: true`) and the PostHog project settings. It is screenshot-based on RN. Configure
it DELIBERATELY with masking ON from the first build (§4.H) — never ship native replay unmasked.

### 4.H — (v2) Session-replay PII masking — MANDATORY security gate (web + native)

**Security requirement (Seth 2026-06-21):** session replay MUST mask all input fields by default and
HARD-mask all payment/checkout/auth fields and any PII (emails, names, card entry, Stripe/Payment
elements). **A replay that captures a card field or auth credential = AUTOMATIC FAIL.**

**Web (posthog-js) masking contract:**
```ts
session_recording: {
  maskAllInputs: true,                                  // default true — KEEP true, never override to false
  maskInputOptions: { password: true, email: true },   // belt-and-suspenders on sensitive input types
  maskTextSelector: '[data-ph-mask]',                   // any element tagged data-ph-mask is text-masked
}
```
- **HARD-mask rule:** wrap every payment / card-entry / checkout-amount / auth (email/password/OTP) /
  PII (name/phone/address) element with the class **`ph-no-capture`** (PostHog replaces it with a
  same-size block — strongest guarantee) OR `data-ph-mask` for text masking. Stripe `<PaymentElement>` /
  card iframes: PostHog cannot see inside a cross-origin Stripe iframe (iframe contents are not in the
  DOM PostHog records), but the CONTAINER and any same-origin amount/email fields around it MUST carry
  `ph-no-capture`. Apply on buyer web: the checkout cart/amount, buyer email field, payment container
  (`app/checkout/*`), and any PII on public pages.
- `maskAllInputs: true` is the global default and MUST remain true — the strict-grep gate forbids
  `maskAllInputs: false` anywhere.

**Native (posthog-react-native) masking contract:**
```ts
sessionReplayConfig: {
  maskAllTextInputs: true,   // default true — KEEP true
  maskAllImages: true,       // default true — KEEP true
  // captureLog / captureNetworkTelemetry default true; sampleRate per §4.I
}
```
- `maskAllTextInputs` + `maskAllImages` are both `true` by default — the contract is to KEEP them true
  (never set false). Additionally, the **payment / card-entry screens** (native Stripe PaymentSheet is
  a native modal outside the RN view tree — not captured by RN screenshot replay, which is good) and any
  RN view rendering PII must be explicitly excluded with `ph-no-capture` (the RN sensitive-view tag).
- Strict-grep gate forbids `maskAllTextInputs: false` / `maskAllImages: false`.

**§Security gate test (mandatory, fails-closed):** see §SC-Security + T-13/T-14/T-15. The tester MUST
inspect an actual recording (web + native) of a checkout/auth flow and confirm input + card + email
fields render as masked blocks. A recording showing ANY readable card/email/password = FAIL.

### 4.I — (v2) Cost guard — "stay free" config

**Seth action (cannot be done in code — document + hand off):** in PostHog project 479999 billing,
**set the billing limit to $0 on every product AND remove/omit the card on file.** With a $0 limit and
no card, overage DROPS data instead of charging — the project can never incur a bill. Document this as a
Seth action (§10 + Seth-actions handoff).

**In-code volume protection (autocapture + replay are the two volume risks):**
- **Session replay sampling:** set `session_recording: { sampleRate: 0.2 }` (web) / `sampleRate: 0.2`
  (native) as a STARTING point (record ~20% of sessions) to protect the **5K recordings/mo** free cap.
  Implementor sets a single shared constant; Seth can raise/lower in PostHog UI later without a deploy
  (PostHog supports server-side sampling override). Document the chosen rate in the implementor report.
- **Autocapture:** keep `autocapture: true` but DO NOT add high-frequency manual events in hot loops
  (e.g. per-scroll, per-frame). The behavior events in §4.C are discrete and safe. If web autocapture
  volume risks the **1M events/mo** cap, narrow with `autocapture: { dom_event_allowlist: ['click','submit'] }`
  (do NOT capture `change`/`input` floods).
- Note the risk explicitly in code comments: autocapture + replay are the allowance-burners; sampling +
  event discipline protect the free tier.

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1-Marketing:** Loading `usemingla.com` (prod) sends a `$pageview` to PostHog project 479999 AND a
  GA4 hit visible in GA4 Realtime for stream `usemingla.com`.
- **SC-2-Marketing:** Clicking the primary CTA fires `marketing_cta_clicked`; a successful beta-access
  submit fires `beta_access_submitted` — both visible in PostHog Live Events.
- **SC-3-BuyerWeb:** Loading a public offering page (`/e/...`) on the web build sends a PostHog `$pageview`
  + `web_public_offering_viewed` + a GA4 hit; native iOS/Android are byte-unaffected (no `posthog-js`/gtag
  in the native bundle).
- **SC-4-BuyerWeb:** Completing a web ticket checkout fires PostHog `web_purchase_completed` AND GA4
  `purchase` (with value+currency) at the confirm site.
- **SC-5-App-iOS / SC-5-App-Android (consumer):** A signup, a card_saved, and a ticket purchase each fire
  the matching `posthog.capture` event visible in PostHog Live Events from the device/sim.
- **SC-6-Business-iOS / SC-6-Business-Android:** A signup, an offering publish (event/trip/experience), and
  a ticket purchase each fire the matching PostHog event.
- **SC-7-Identity:** After signin, PostHog events on every surface carry the bound `distinct_id` =
  Supabase `user.id`; after signout (native) `reset()` is called.
- **SC-8-NoRegression:** Mixpanel + AppsFlyer continue firing unchanged on both apps (parallel run intact);
  no native startup regression; no crash when any analytics env var is absent (graceful no-op).
- **SC-9-SecretHygiene:** No `phx_*` key appears in any committed file or any client bundle; only `phc_*`
  and `G-Z4W3B9900S` (both public-by-design) ship to clients.

**(v2) Consent gating:**
- **SC-10-Consent-Marketing:** On a FRESH `usemingla.com` visit (cleared storage), the consent banner
  shows AND no PostHog cookie/localStorage entry exists AND no GA4 measurement cookie is set AND no
  `$pageview` reaches PostHog — UNTIL Accept is clicked. After Accept: PostHog opt-in fires, a
  `$pageview` lands, GA4 consent updates to granted, cookies appear. After Reject (fresh session):
  cookies stay absent, no events captured.
- **SC-11-Consent-BuyerWeb:** Same as SC-10 on a buyer-web public page (`/e/...`): no capture / no
  cookies until Accept; banner links to `https://usemingla.com/privacy-policy`.
- **SC-12-Consent-Native:** (iOS) the ATT prompt appears at the documented moment in BOTH apps; toggling
  the Settings "Analytics" opt-out OFF calls `posthog.optOut()` and subsequent events do NOT reach
  PostHog; toggling ON resumes capture. (business app: ATT prompt is newly present.)

**(v2) §SC-Security — session-replay PII masking (HARD gate; a fail here blocks the phase):**
- **SC-Security-Web:** In an actual web session recording of a buyer-web checkout + an auth/email entry,
  ALL input fields, the card/payment container, buyer email, and amount fields render as MASKED blocks —
  no readable PII or card data in the replay. A readable card/email/password = FAIL.
- **SC-Security-Native:** In an actual native (RN screenshot) recording of a checkout + a PII-entry
  screen in EACH app, all text inputs + images are masked; no readable PII. A readable field = FAIL.
- **SC-Security-Config:** `maskAllInputs`/`maskAllTextInputs`/`maskAllImages` are never set false anywhere
  (strict-grep gate green).

**(v2) Power-feature smoke:**
- **SC-13-Flags:** A feature flag read (`getFeatureFlag`/`isFeatureEnabled`) resolves on at least one web
  surface and one native app without error (flag evaluated, default returned when undefined).
- **SC-14-Surveys:** A test survey created in PostHog UI renders on web and is dismissable (or its API
  hook resolves on native) — proves the survey channel is wired.
- **SC-15-Errors:** A deliberately thrown test error is captured to PostHog error tracking on one web
  surface and one native app.

**(v2) Cost guard:**
- **SC-16-CostGuard:** Session replay sampling is configured (`sampleRate` present, ≤ the documented
  starting rate) on web + native; Seth has confirmed the PostHog $0 billing limit + no-card (Seth
  action, verified out-of-band — see §10).

---

## 6. Invariants

**Preserved:**
- **COMMS-0028 (env reachability):** native key reads MUST go through `Constants.expoConfig.extra` or
  STATIC `process.env.EXPO_PUBLIC_X` — never dynamic `process.env[name]` bracket access. Verified by the
  reachability test (§9) + a strict-grep gate forbidding dynamic reads of the PostHog key.
- **Native/web separation invariant:** web-only analytics (`posthog-js`, gtag) load ONLY via `.web.ts`
  modules / `Platform.OS==='web'` guards; the native bundle never imports them. Mirror of the existing
  `mixpanelService.web.ts` contract.
- Existing Mixpanel/AppsFlyer init + identity + cleanup invariants (I-SENTRY-SINGLE-INIT pattern sibling)
  are untouched.

**New (proposed, DRAFT — orchestrator flips ACTIVE at CLOSE):**
- **I-PROPOSED-1187-POSTHOG-HOST-US:** every PostHog init (web + native, all 4 apps) MUST use
  `api_host`/host = `https://us.i.posthog.com`. Test: grep gate asserts the US host literal at every init
  site and forbids any `eu.i.posthog.com` / `app.posthog.com` host.
- **I-PROPOSED-1187-NO-PHX-IN-CLIENT:** the `phx_*` personal/MCP key MUST NOT appear in any client app
  source (`app-mobile/`, `mingla-business/`, `mingla-marketing/`). Test: grep gate fails on any `phx_`
  literal in those trees.
- **I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS:** (rename/clarify of the prior WEB-ANALYTICS-WEB-ONLY)
  `posthog-js` + the gtag loader + the web ConsentBanner are referenced ONLY from `*.web.ts(x)` files or
  behind `Platform.OS==='web'`; never from a native-resolved module. Test: grep gate asserts `posthog-js`
  imports + `ConsentBanner.web` appear only in `.web.` files (mingla-business) / Next client components
  (marketing), and that the `.tsx`/`.ts` native stubs are no-ops.
- **(v2) I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES:** on BOTH web surfaces, PostHog MUST init with
  `opt_out_capturing_by_default: true` AND GA4 MUST emit `gtag('consent','default', {...all denied})`
  before any GA `config`/measurement call — i.e. no analytics cookies/capture before explicit Accept.
  Test: a grep/unit gate asserts the `opt_out_capturing_by_default: true` literal at both web init sites
  and the GA4 consent-default-denied call ordered before the GA config; FAILS if either is removed or
  flipped to capture-by-default.
- **(v2) I-PROPOSED-1187-REPLAY-MASKS-PII:** session replay MUST keep masking ON everywhere —
  `maskAllInputs` (web) and `maskAllTextInputs` + `maskAllImages` (native) are NEVER `false`; payment/
  auth/PII elements carry `ph-no-capture`/`data-ph-mask`. Test: strict-grep gate FAILS on any
  `maskAllInputs: false` / `maskAllTextInputs: false` / `maskAllImages: false` / `disable_session_recording`
  toggled in a way that defeats masking, in any client tree; plus the §SC-Security recording inspection.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | Marketing pageview (happy) | Load prod homepage | `$pageview` in PostHog 479999 + GA4 realtime hit | runtime/web |
| T-2 | Marketing CTA (happy) | Click Get-Beta-Access | `marketing_cta_clicked` in Live Events | runtime/web |
| T-3 | Marketing missing key (error) | Build with `NEXT_PUBLIC_POSTHOG_KEY` unset | Site renders, no crash, init no-ops | code/web |
| T-4 | Buyer-web offering view (happy) | Load `/e/{brand}/{event}` web | `$pageview` + `web_public_offering_viewed` + GA4 hit | runtime/web |
| T-5 | Buyer-web purchase (happy) | Complete web ticket checkout | `web_purchase_completed` + GA4 `purchase` w/ value | runtime/web |
| T-6 | Native bundle isolation (edge) | `expo export -p ios` for mingla-business | bundle contains NO `posthog-js`/`gtag` string | build/native |
| T-7 | Consumer signup (happy) | New account on sim | PostHog signup event w/ distinct_id=user.id | runtime/native |
| T-8 | Business publish (happy) | Publish an event on sim | PostHog offering-published event | runtime/native |
| T-9 | Purchase parity (happy) | Ticket buy on consumer sim | PostHog purchase + Mixpanel purchase BOTH fire | runtime/native |
| T-10 | Missing native key (error) | Build w/o `EXPO_PUBLIC_POSTHOG_KEY` | init no-ops, no crash, app boots | code/native |
| T-11 | US host (invariant) | grep all init sites | only `us.i.posthog.com`; zero eu/app hosts | code/all |
| T-12 | No phx in client (security) | grep client trees | zero `phx_` literals | security/all |
| T-13 | Consent gate, no-accept (security) | Fresh marketing visit, do NOT click | no PostHog/GA cookie, no `$pageview` in PostHog | runtime/web |
| T-14 | Consent accept (happy) | Click Accept | `posthog.opt_in` fires, `$pageview` lands, GA consent→granted, cookies set | runtime/web |
| T-15 | Consent reject (edge) | Click Reject | no cookies, no events; banner does not re-nag in same session | runtime/web |
| T-16 | Replay masking web (SECURITY) | Record web checkout + email entry, view replay | card/email/inputs masked blocks; FAIL if readable | runtime/web |
| T-17 | Replay masking native (SECURITY) | Record native checkout/PII screen, view replay | text inputs + images masked; FAIL if readable | runtime/native |
| T-18 | Mask config invariant (security) | grep client trees | zero `maskAllInputs:false`/`maskAllTextInputs:false`/`maskAllImages:false` | code/all |
| T-19 | Native opt-out toggle (happy) | Toggle Analytics OFF in Settings | `posthog.optOut()` called, subsequent events suppressed; ON resumes | runtime/native |
| T-20 | Feature flag read (happy) | `getFeatureFlag('test')` web + native | resolves without error, default when undefined | runtime/all |
| T-21 | Error capture (happy) | throw a test error | exception lands in PostHog error tracking | runtime/all |

---

## 8. Implementation order

1. **Marketing web (step 1):** add `posthog-js` + `@next/third-parties` deps → create
   `components/marketing/posthog-provider.tsx` with `opt_out_capturing_by_default: true` + power-feature
   + masked-replay config (§4.A/§4.G/§4.H) → create `components/marketing/consent-banner.tsx` (§4.E)
   wired to opt-in/opt-out + GA4 consent default-denied/update → fix the footer privacy/terms hrefs →
   mount provider + banner + `<GoogleAnalytics>` in `app/layout.tsx` → add the 2 capture call sites →
   update `.env.example` → set Vercel env → verify SC-1/SC-2/SC-10/SC-13-15/SC-Security-Web → land +
   deploy. **Ship this leg independently (urgency).**
2. **Buyer web (step 2):** add `posthog-js` dep to mingla-business → create
   `src/analytics/webAnalytics.web.ts` (consent-gated init + power features + masked replay + GA4
   consent mode) + `webAnalytics.ts` no-op → create `src/analytics/ConsentBanner.web.tsx` + `.tsx`
   no-op (§4.E) → add the 3 `extra` keys to `app.config.ts` → call `initWebAnalytics()` + mount the
   banner web-guarded in `app/_layout.tsx` → hook the purchase/checkout/view call sites + tag
   payment/PII elements `ph-no-capture` → set Vercel env → verify SC-3/SC-4/SC-11/SC-Security-Web +
   native-isolation T-6.
3. **Native apps (step 3):** add `posthog-react-native` to both → create `src/services/postHogService.ts`
   in each (init with masked `sessionReplayConfig` + `sampleRate`, power features, opt-in/opt-out wired
   to the store flag) → add `extra` keys to both `app.config.ts` → ADD `expo-tracking-transparency` +
   ATT plugin/prompt to mingla-business (§4.F); reuse the existing consumer ATT gate → add the
   `analyticsOptOut` flag to each Zustand store + the Settings "Analytics" toggle row → init at boot
   next to Mixpanel → bind identity at auth + reset on signout → hook conversion + behavior call sites +
   tag PII views `ph-no-capture` → set EAS env → build dev → verify
   SC-5/SC-6/SC-7/SC-8/SC-12/SC-Security-Native (+ T-19 native opt-out toggle).
4. **Dashboards (§4.D)** + surveys/experiments setup in PostHog UI; document in implementor report.
5. **Regression gates (§9)** added in the same PRs as the code they guard.

**(v2) Apps no longer deferred + ORCH-1171 native-dep coordination (COMMS-0047):** Seth is cutting a
FRESH consumer native build now, so both apps are FULLY in Phase 1. Consumer on-device verification
(SC-5/SC-12/SC-Security-Native on app-mobile) rides that fresh consumer build, which is cut from
**MERGED main** (deploy/build-from-merged-main discipline, not a stale worktree). **HARD coordination
constraint:** the consumer build that ships PostHog MUST ALSO include the in-flight ORCH-1171 native
change (`react-native-keyboard-controller@^1.18.5` + `KeyboardRoot.native.tsx` + the COMMS-0031
modular-headers plugin per DISC-1129-A). Per COMMS-0047 the consumer dev channel is FROZEN until a fresh
native build lands; do NOT cut a build that includes PostHog but DROPS the ORCH-1171 keyboard dep (or
vice-versa) — both native deps must be present in the single cut build, or the app runtime-crashes on the
missing module. Coordinate the build with the ORCH-1171 owner before cutting. Business-app + both web
surfaces are unaffected and verifiable immediately.

---

## 9. Regression prevention — fails-on-revert contract

- **Marketing:** a unit/lint test (`mingla-marketing`) asserting `app/layout.tsx` mounts the PostHog
  provider AND `<GoogleAnalytics>`, and that the provider init uses `https://us.i.posthog.com`. MUST FAIL
  if the provider mount or US host is reverted; PASS when restored.
- **Buyer web:** a test asserting `webAnalytics.web.ts` calls `posthog.init` with the US host and that
  `webAnalytics.ts` (native) is a pure no-op (no `posthog-js` import). Plus a build-string test (T-6) that
  greps a native `expo export` bundle to confirm `posthog-js`/`gtag` are ABSENT. MUST FAIL if web analytics
  leaks into native.
- **Native:** a strict-grep gate (`.github/scripts/strict-grep/`) enforcing I-PROPOSED-1187-POSTHOG-HOST-US
  (US host at every init), I-PROPOSED-1187-NO-PHX-IN-CLIENT (no `phx_` in client trees), and the COMMS-0028
  static-read rule for the PostHog key (forbid dynamic `process.env[<var>]`). Plus a jest test that
  `postHogService.initialize()` no-ops when the key is absent, and a jest test that toggling the
  `analyticsOptOut` store flag calls `posthog.optOut()`/`optIn()`. Each gate must FAIL on revert and PASS
  on restore.
- **(v2) Consent gate (both web):** a unit/grep gate asserting `opt_out_capturing_by_default: true` at
  both web PostHog init sites AND the GA4 `consent default` (all-denied) call ordered before the GA
  `config` (I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES). MUST FAIL if either is removed or flipped to
  capture-by-default. Plus a runtime/Playwright-style check (or tester manual per T-13) that a fresh
  no-accept visit sets no analytics cookies.
- **(v2) Replay masking (web + native, SECURITY):** a strict-grep gate
  (I-PROPOSED-1187-REPLAY-MASKS-PII) that FAILS on any `maskAllInputs: false` / `maskAllTextInputs: false`
  / `maskAllImages: false` literal in any client tree. This is the structural fails-on-revert safeguard
  for the §SC-Security gate (the recording inspection T-16/T-17 is the runtime proof). MUST FAIL if a
  developer disables masking; PASS when masking is on.
- Every guard carries a protective comment naming META-ORCH-1187 + the "why" (US-region lock / secret
  hygiene / native-isolation / env-reachability / consent-gate-before-cookies / replay-masks-PII).

---

## 10. Open questions (need a decision; do NOT guess)

- **OQ-1 (GA4 stream):** Phase 1 reuses the single `G-Z4W3B9900S` (`usemingla.com`) stream on BOTH web
  surfaces. Buyer web is a different host (mingla-business Vercel domain). Decision needed in Phase 2:
  give buyer web its OWN GA4 data stream vs keep one stream with a `surface` dimension. Default Phase-1
  behavior: ONE stream. (Dispatch explicitly defers stream-timing — confirmed.)
- **OQ-2 (consent/cookie banner): RESOLVED 2026-06-21 → IN SCOPE.** Seth decided to ship a custom
  Mingla-branded consent banner NOW on both web surfaces with a real opt-out-by-default + GA4 Consent
  Mode v2 gate. Specified in §4.E. No longer an open question.
- **OQ-3 (ad-blocker proxy):** direct-to-`us.i.posthog.com` ingestion is blockable by ad-blockers,
  understating web numbers. A same-origin reverse-proxy (Next rewrite / Vercel) recovers them — deferred to
  Phase 2.
- **OQ-4 (PostHog provider style on native): RESOLVED 2026-06-21.** Autocapture + session replay ARE
  wanted (decision #2). Native therefore needs `<PostHogProvider>` with autocapture + `enableSessionReplay`
  (replay/autocapture require the provider wrapper, not bare imperative init) — OR the imperative client
  plus the screenshot-replay integration; implementor chooses the posthog-react-native-supported path that
  enables masked replay + autocapture. The cost/privacy concerns are addressed by §4.H (masking) + §4.I
  (sampling + $0 billing cap), not deferred.

### Seth actions (cannot be done in code — Seth must perform)
- **SA-1 ($0 billing cap):** In PostHog project 479999 → Billing, set the billing limit to **$0** on
  every product and ensure **no card is on file**. With $0 + no card, overage DROPS data instead of
  charging — the project can never bill. (§4.I, SC-16.)
- **SA-2 (project-settings toggles):** In PostHog project settings, ENABLE session replay and surveys
  (these require a project-level enable in addition to the SDK flags), and create one smoke survey +
  one smoke experiment so SC-14/SC-13 can be verified.
- **SA-3 (privacy policy):** No new privacy page is required — the policy EXISTS at
  `https://usemingla.com/privacy-policy`. Seth only needs to confirm the existing policy text mentions
  PostHog/GA analytics + cookies (a content review on `mingla-marketing/lib/privacyContent`), since the
  banner now links to it. If it does not mention analytics cookies, update the policy copy.
- **SA-4 (ATT copy):** business app NSUserTrackingUsageDescription already exists ("Mingla Business uses
  your advertising identifier to measure the performance of our ads and help us reach more organizers
  like you."); consumer copy already exists. No new copy required unless Seth wants to revise. (Flagged
  so it is not assumed missing.)

---

## 11. Downstream routing

NEXT = **mingla-implementor**. Build in this worktree
(`~/Desktop/mingla-orchs/META-ORCH-1187-[growth-analytics-hub]/` on branch
`META-ORCH-1187-growth-analytics-hub`) STRICTLY in the §8 sequence (marketing → buyer web → native), one
PR per leg (marketing ships first, independently, for urgency). Honor the allowlist + DO-NOT-TOUCH below;
stop-and-amend before touching anything outside it. THEN → **mingla-tester** for per-surface verification
against §5 SC (incl. the §SC-Security replay-masking HARD gate) + §7 tests + the §9 fails-on-revert
gates. THEN → **mingla-orchestrator** CLOSE (flip the **5** I-PROPOSED-1187-* invariants ACTIVE —
POSTHOG-HOST-US, NO-PHX-IN-CLIENT, ANALYTICS-WEB-ONLY-VIA-WEB-TS, CONSENT-GATE-BEFORE-COOKIES,
REPLAY-MASKS-PII — World Map close banner, Mixpanel-retirement follow-on registration). The consumer
on-device leg is gated on the fresh ORCH-1171-coordinated native build (§8 note); CLOSE may proceed for
the immediately-verifiable surfaces (both web + business app) with the consumer on-device verification
tracked as a follow-on tied to the build cut.

---

## Scoped allowlist (implementor MAY change)

**Marketing:**
- `mingla-marketing/package.json`
- `mingla-marketing/app/layout.tsx`
- `mingla-marketing/components/marketing/posthog-provider.tsx` (NEW)
- `mingla-marketing/components/marketing/consent-banner.tsx` (NEW — v2)
- `mingla-marketing/components/marketing/footer.tsx` (v2 — fix stale `/privacy`→`/privacy-policy`,
  `/terms`→`/terms-of-service` hrefs ONLY; no other footer changes)
- `mingla-marketing/components/marketing/cta-banner.tsx`, `beta-access-modal.tsx`, `glass-nav.tsx` (add capture calls only)
- `mingla-marketing/lib/beta-access-submit.ts` (add capture on success only)
- `mingla-marketing/.env.example`

**Buyer web (mingla-business web-only):**
- `mingla-business/package.json`
- `mingla-business/src/analytics/webAnalytics.web.ts` (NEW), `mingla-business/src/analytics/webAnalytics.ts` (NEW no-op)
- `mingla-business/src/analytics/ConsentBanner.web.tsx` (NEW — v2), `mingla-business/src/analytics/ConsentBanner.tsx` (NEW no-op — v2)
- `mingla-business/app/_layout.tsx` (web-guarded init + banner mount + capture wiring)
- `mingla-business/app.config.ts` (add 3 `extra` keys)
- `mingla-business/app/checkout/[eventId]/confirm.tsx`, `app/checkout/[eventId]/index.tsx`,
  `app/checkout-trip/[tripEventId]/confirm.tsx`, `app/checkout-experience/[experienceEventId]/confirm.tsx`,
  `app/e/[brandSlug]/[eventSlug].tsx`, `app/t/[brandSlug]/[tripSlug].tsx`,
  `app/exp/[brandSlug]/[experienceSlug].tsx`, `app/b/[brandSlug]/index.tsx` (add capture calls + v2:
  tag payment/checkout/PII elements with `ph-no-capture`/`data-ph-mask` for replay masking)

**Native (both apps):**
- `app-mobile/package.json`, `mingla-business/package.json` (mingla-business v2: + `expo-tracking-transparency`)
- `app-mobile/src/services/postHogService.ts` (NEW), `mingla-business/src/services/postHogService.ts` (NEW)
- `app-mobile/app.config.ts`, `mingla-business/app.config.ts` (add 2 `extra` keys each; mingla-business
  v2: + `expo-tracking-transparency` plugin block mirroring consumer)
- `app-mobile/app/index.tsx` (init + signup + behavior captures), `mingla-business/app/_layout.tsx`
  (init + v2: ATT prompt before AppsFlyer start)
- `mingla-business/src/context/AuthContext.tsx` (identify/reset + signup capture)
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`,
  `mingla-business/app/checkout/[eventId]/confirm.tsx` (+ trip/experience twins) (purchase captures)
- `mingla-business/src/hooks/useBusinessEvents.ts`, `mingla-business/src/hooks/useTrips.ts`,
  `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` (publish captures)
- `app-mobile/src/components/SwipeableCards.tsx` (behavior captures)
- `app-mobile/eas.json`, `mingla-business/eas.json` (env per profile)
- **(v2) Opt-out toggle + storage:**
  - `app-mobile/src/store/appStore.ts` (add `analyticsOptOut` + setter, persisted)
  - `app-mobile/src/components/profile/AccountSettings.tsx` (add "Analytics" toggle row in Privacy section)
  - `mingla-business/src/store/*` (the business Zustand store — add `analyticsOptOut` + setter)
  - `mingla-business/src/screens/ari/AriSettingsScreen.tsx` OR the nearest account/profile settings host
    (add "Analytics" opt-out row; STOP-AND-AMEND if no suitable user-facing host exists — do NOT invent a
    new top-level settings route)
- **(v2) ATT (consumer reuse, no edit needed):** `app-mobile/src/services/permissionOrchestrator.ts` is
  the EXISTING ATT gate — consumer needs no change; postHogService just respects resolved state.

**Infra/tests:**
- `mingla-marketing/vercel.json` (ONLY if a CSP allowlist is later required — default: do not touch)
- `.github/scripts/strict-grep/*` (NEW gates for the **5** I-PROPOSED-1187-* invariants — incl. v2
  CONSENT-GATE-BEFORE-COOKIES + REPLAY-MASKS-PII)
- New test files for §9; per-app `__tests__/` analytics tests (incl. consent-gate unit test + the
  mask-config gate + the native opt-out-toggle jest test).

## DO-NOT-TOUCH

- `mingla-business/src/services/mixpanelService.ts` + `.web.ts`, `appsFlyerService.ts` + `.web.ts`, and the
  app-mobile equivalents — Mixpanel/AppsFlyer stay AS-IS (parallel run; no removal this phase).
- Any edge function / `supabase/functions/*` (no server-side capture this phase).
- `mingla-business/app.config.ts` Stripe/GIPHY IIFE blocks (add new `extra` keys ADJACENT; do not modify
  existing blocks).
- `mingla-admin/*` (Phase-2 surface).
- `next.config.ts` `securityHeaders` (do not tighten CSP this phase).
- Any BigQuery/Looker/warehouse work (Phase 2+).
- The `phx_*` key — never commit it anywhere.
