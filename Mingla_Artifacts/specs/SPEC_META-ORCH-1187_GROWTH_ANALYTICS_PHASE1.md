# SPEC — META-ORCH-1187 [Growth Analytics Hub] — Phase 1

**Status:** IN SPEC (forensics INVESTIGATE+SPEC complete; ready for IMPLEMENT dispatch)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1187-[growth-analytics-hub]/` on branch `META-ORCH-1187-growth-analytics-hub`
**Author:** mingla-forensics
**Date:** 2026-06-21
**Classification:** missing-feature / architecture · **Severity:** S1-high

> This is a CONTRACT. The implementor builds exactly what is specified here, touches only the
> allowlisted files, and stops-and-amends before touching anything outside the allowlist. Illustrative
> snippets are ≤2-3 lines and are NOT the implementation.

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
- **Consent/cookie-banner gating.** No consent-management changes this phase (the marketing site has no
  cookie banner today). Flagged in Open Questions OQ-2 for legal sign-off; do not block Phase 1 on it.
- **Server-side / S2S PostHog capture from edge functions.** All Phase-1 capture is client-side.

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
| 1 | Consumer iOS (`app-mobile/` iOS) | YES (step 3) | None visible; events captured to PostHog | `app-mobile/app/_layout.tsx`, `app-mobile/app.config.ts`, `app-mobile/package.json`, `app-mobile/src/services/postHogService.ts` (new), conversion call sites | Manual (RN native path) |
| 2 | Consumer Android (`app-mobile/` Android) | YES (step 3) | None visible; events captured | same as #1 | Automatic w/ #1 (shared RN code) |
| 3 | Buyer/anonymous Web (`mingla-business` web: `/checkout/{eventId}`, `/e/...`, `/b/...`, `/t/...`, `/exp/...`) | YES (step 2) | None visible; PostHog JS + GA4 fire on web | `mingla-business/app/_layout.tsx`, `mingla-business/src/analytics/webAnalytics.web.ts` (new) + `.ts` no-op (new), `mingla-business/app.config.ts`, `mingla-business/package.json` | Manual (web-only `.web.ts` split) |
| 4 | Business iOS (`mingla-business` native iOS) | YES (step 3) | None visible; events captured | `mingla-business/app/_layout.tsx`, `mingla-business/app.config.ts`, `mingla-business/package.json`, `mingla-business/src/services/postHogService.ts` (new), conversion call sites | Manual (RN native path) |
| 5 | Business Android (`mingla-business` native Android) | YES (step 3) | None visible; events captured | same as #4 | Automatic w/ #4 |
| 6 | Marketing Web (`mingla-marketing/`, Next.js 15 app-router) | YES (step 1) | None visible; PostHog JS + GA4 fire | `mingla-marketing/app/layout.tsx`, `mingla-marketing/components/marketing/posthog-provider.tsx` (new), `mingla-marketing/app/instrumentation-client.ts` OR provider, `mingla-marketing/package.json`, `.env.example`, `vercel.json` (CSP) | Standalone (own app) |
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

**PostHog init config (marketing + buyer web identical config object):**
```ts
posthog.init(KEY, { api_host: 'https://us.i.posthog.com', person_profiles: 'identified_only',
                    capture_pageview: true, capture_pageleave: true })
```
- `api_host` MUST be `https://us.i.posthog.com` (US region — dispatch-locked).
- `person_profiles: 'identified_only'` keeps anonymous web visitors as events without minting a person
  profile until/unless identified — appropriate for an anon-heavy marketing/buyer surface.
- `capture_pageview` is left ON (PostHog autocaptures SPA route changes for client-side nav).

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
  - Either use `posthog-react-native`'s imperative client init (recommended — matches the existing
    imperative `mixpanelService.initialize()` style; avoids restructuring the provider tree), OR wrap with
    `<PostHogProvider client={...}>` at the root if autocapture of screens is desired. Baseline = imperative
    client init in the service singleton (least-risk, parity with Mixpanel).

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
- **I-PROPOSED-1187-WEB-ANALYTICS-WEB-ONLY:** `posthog-js` + the gtag loader are referenced ONLY from
  `*.web.ts(x)` files or behind `Platform.OS==='web'`; never from a native-resolved module. Test: grep gate
  asserts `posthog-js` imports appear only in `.web.` files (mingla-business) / Next client components
  (marketing).

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

---

## 8. Implementation order

1. **Marketing web (step 1):** add `posthog-js` + `@next/third-parties` deps → create
   `components/marketing/posthog-provider.tsx` → mount provider + `<GoogleAnalytics>` in
   `app/layout.tsx` → add the 2 capture call sites → update `.env.example` → set Vercel env →
   verify SC-1/SC-2 → land + deploy. **Ship this leg independently (urgency).**
2. **Buyer web (step 2):** add `posthog-js` dep to mingla-business → create
   `src/analytics/webAnalytics.web.ts` + `webAnalytics.ts` no-op → add the 3 `extra` keys to
   `app.config.ts` → call `initWebAnalytics()` web-guarded in `app/_layout.tsx` → hook the
   purchase/checkout/view call sites → set Vercel env → verify SC-3/SC-4 + native-isolation T-6.
3. **Native apps (step 3):** add `posthog-react-native` to both → create `src/services/postHogService.ts`
   in each → add `extra` keys to both `app.config.ts` → init at boot next to Mixpanel → bind identity at
   auth + reset on signout → hook conversion + behavior call sites → set EAS env → build dev → verify
   SC-5/SC-6/SC-7/SC-8.
4. **Dashboards (§4.D)** in PostHog UI; document in implementor report.
5. **Regression gates (§9)** added in the same PRs as the code they guard.

Note (COMMS-0047): a consumer-app **OTA is currently BLOCKED** (ORCH-1171 native keyboard dep + no fresh
consumer native build). The native posthog dep ALSO requires a fresh native build to run on device anyway,
so the consumer leg's on-device verification rides the next consumer native build — coordinate with the
ORCH-1171 owner. Business-app + both web surfaces are unaffected and verifiable immediately.

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
  `postHogService.initialize()` no-ops when the key is absent. Each gate must FAIL on revert of the fix and
  PASS on restore — wire it into the relevant strict-grep workflow.
- Every guard carries a protective comment naming META-ORCH-1187 + the "why" (US-region lock / secret
  hygiene / native-isolation / env-reachability).

---

## 10. Open questions (need a decision; do NOT guess)

- **OQ-1 (GA4 stream):** Phase 1 reuses the single `G-Z4W3B9900S` (`usemingla.com`) stream on BOTH web
  surfaces. Buyer web is a different host (mingla-business Vercel domain). Decision needed in Phase 2:
  give buyer web its OWN GA4 data stream vs keep one stream with a `surface` dimension. Default Phase-1
  behavior: ONE stream. (Dispatch explicitly defers stream-timing — confirmed.)
- **OQ-2 (consent/cookie banner):** the marketing site has no cookie/consent banner. PostHog + GA4 set
  cookies. Legal sign-off needed on whether a consent banner / `posthog.opt_out` default is required
  (esp. EU visitors). Phase 1 proceeds without one per dispatch scope; flag to Seth for legal.
- **OQ-3 (ad-blocker proxy):** direct-to-`us.i.posthog.com` ingestion is blockable by ad-blockers,
  understating web numbers. A same-origin reverse-proxy (Next rewrite / Vercel) recovers them — deferred to
  Phase 2.
- **OQ-4 (PostHog provider style on native):** imperative client init (baseline, parity with Mixpanel) vs
  `<PostHogProvider>` autocapture wrapper. Baseline chosen here; confirm if autocapture/session-replay is
  wanted (session replay has cost/privacy implications — likely a later decision).

---

## 11. Downstream routing

NEXT = **mingla-implementor**. Build in this worktree
(`~/Desktop/mingla-orchs/META-ORCH-1187-[growth-analytics-hub]/` on branch
`META-ORCH-1187-growth-analytics-hub`) STRICTLY in the §8 sequence (marketing → buyer web → native), one
PR per leg (marketing ships first, independently, for urgency). Honor the allowlist + DO-NOT-TOUCH below;
stop-and-amend before touching anything outside it. THEN → **mingla-tester** for per-surface verification
against §5 SC + §7 tests + the §9 fails-on-revert gates. THEN → **mingla-orchestrator** CLOSE (flip the 3
I-PROPOSED-1187-* invariants ACTIVE, World Map close banner, Mixpanel-retirement follow-on registration).

---

## Scoped allowlist (implementor MAY change)

**Marketing:**
- `mingla-marketing/package.json`
- `mingla-marketing/app/layout.tsx`
- `mingla-marketing/components/marketing/posthog-provider.tsx` (NEW)
- `mingla-marketing/components/marketing/cta-banner.tsx`, `beta-access-modal.tsx`, `glass-nav.tsx` (add capture calls only)
- `mingla-marketing/lib/beta-access-submit.ts` (add capture on success only)
- `mingla-marketing/.env.example`

**Buyer web (mingla-business web-only):**
- `mingla-business/package.json`
- `mingla-business/src/analytics/webAnalytics.web.ts` (NEW), `mingla-business/src/analytics/webAnalytics.ts` (NEW no-op)
- `mingla-business/app/_layout.tsx` (web-guarded init + capture wiring)
- `mingla-business/app.config.ts` (add 3 `extra` keys)
- `mingla-business/app/checkout/[eventId]/confirm.tsx`, `app/checkout/[eventId]/index.tsx`,
  `app/checkout-trip/[tripEventId]/confirm.tsx`, `app/checkout-experience/[experienceEventId]/confirm.tsx`,
  `app/e/[brandSlug]/[eventSlug].tsx`, `app/t/[brandSlug]/[tripSlug].tsx`,
  `app/exp/[brandSlug]/[experienceSlug].tsx`, `app/b/[brandSlug]/index.tsx` (add capture calls only)

**Native (both apps):**
- `app-mobile/package.json`, `mingla-business/package.json`
- `app-mobile/src/services/postHogService.ts` (NEW), `mingla-business/src/services/postHogService.ts` (NEW)
- `app-mobile/app.config.ts`, `mingla-business/app.config.ts` (add 2 `extra` keys each)
- `app-mobile/app/index.tsx` (init + signup + behavior captures), `mingla-business/app/_layout.tsx` (init)
- `mingla-business/src/context/AuthContext.tsx` (identify/reset + signup capture)
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`,
  `mingla-business/app/checkout/[eventId]/confirm.tsx` (+ trip/experience twins) (purchase captures)
- `mingla-business/src/hooks/useBusinessEvents.ts`, `mingla-business/src/hooks/useTrips.ts`,
  `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` (publish captures)
- `app-mobile/src/components/SwipeableCards.tsx` (behavior captures)
- `app-mobile/eas.json`, `mingla-business/eas.json` (env per profile)

**Infra/tests:**
- `mingla-marketing/vercel.json` (ONLY if a CSP allowlist is later required — default: do not touch)
- `.github/scripts/strict-grep/*` (NEW gates for the 3 I-PROPOSED-1187-* invariants)
- New test files for §9; per-app `__tests__/` analytics tests.

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
