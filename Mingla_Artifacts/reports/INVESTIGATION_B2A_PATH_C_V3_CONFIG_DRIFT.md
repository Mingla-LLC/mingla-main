# INVESTIGATION REPORT — B2a Path C V3 Config Drift Audit

**ORCH-ID:** B2A-PATH-C-V3-CONFIG-DRIFT
**Severity:** S1-high (blocks Phase 16; in-app onboarding cannot succeed even after the 4 prior hotfixes)
**Confidence:** **HIGH** — root causes proven via DNS + API + file-line evidence
**Author:** /mingla-forensics
**Date:** 2026-05-07

---

## 1. Layman summary

- **The "couldn't reach Stripe" failure is NOT a Stripe-side problem.** Stripe is healthy. The terminal smoke test passed 9/9 countries against the live sandbox. The platform `acct_1TTnt1PjlZyAYA40` has its `business_profile.url` correctly set to `https://usemingla.com`.
- **The bug is on Mingla's side: the in-app flow opens a browser to `https://business.mingla.com/connect-onboarding`, which doesn't exist as a DNS-resolvable host.** `business.mingla.com` returns NXDOMAIN. So the user's browser fails to load the Mingla-hosted Stripe Connect page — they see an error before Stripe is ever reached.
- **Three domains are entangled in this codebase:** `usemingla.com` (canonical, registered, has Google MX, used by consumer app per ORCH-0350), `mingla.com` (resolves to a third-party IP — operator says NOT owned), `business.mingla.com` (NXDOMAIN — never set up). The Mingla Business product references `business.mingla.com` 19+ times across components, services, edge fns, tests, and Universal Link manifests — none of which work.
- **A second compounding bug:** `connect-onboarding.tsx` reads `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` but Sub-C wired `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (no `_TEST` suffix). Even if the page is reached at the right URL, Stripe Connect won't initialize because the key isn't found.
- **The operator's perception that "mingla.com" appears as the platform URL is partially correct:** `_shared/stripe.ts:44` hardcodes `appInfo.url: "https://mingla.com"` which Stripe records and shows in Dashboard logs. But the user-facing onboarding URL Stripe shows is sourced from `business_profile.url`, which IS correctly `usemingla.com`. The operator may have been looking at the Stripe Dashboard's account page or a CLI log.

**Findings: 3 root causes, 3 contributing, 3 hidden, 3 observations**

---

## 2. Canonical domain establishment

| Domain | DNS resolution | Owned? | Purpose | Evidence |
|---|---|---|---|---|
| `usemingla.com` | ✅ resolves (104.236.85.229) + Google MX | **YES** | Canonical Mingla domain (consumer + business) | ORCH-0350 standardized legal URLs here; `app-mobile/src/constants/urls.ts:2-3` references `www.usemingla.com`; Stripe platform's `business_profile.email = seth@usemingla.com`; admin role row lists `seth@usemingla.com` |
| `mingla.com` | ✅ resolves (15.197.225.128) | **NO** (per operator: "Mingla.com is not even our domain") | Architectural intent only; appears in DEC-076/081/086 as a future workstream, never built | `host mingla.com` resolves to AWS/Squarespace IPs not associated with Mingla |
| `business.mingla.com` | ❌ NXDOMAIN | **NO** | Was supposed to be the Mingla Business Expo Web deployment per DEC-081 | `host business.mingla.com` returns NXDOMAIN |
| `business.usemingla.com` | ❌ NXDOMAIN | Unknown (subdomain not configured) | Hypothetical replacement for `business.mingla.com` | Not configured |
| `mingla.app` | (not tested) | Likely owned | Used in `ops@mingla.app`, `support@mingla.app`, demo seed emails | Reference in `stripe-webhook-health-check/index.ts:38`, `ErrorBoundary.tsx:49` |

**Canonical truth:** the only Mingla-owned, DNS-live, production-grade domain is **`usemingla.com`**. All references to `mingla.com`, `business.mingla.com`, or `mingla.app` (except possibly the last as an ops alias) are config drift.

---

## 3. Findings (classified)

### 🔴 R-1: `brand-stripe-onboard` returns an unreachable `onboarding_url` (PROVEN)

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/brand-stripe-onboard/index.ts:39-40` + `:362-367` |
| **Exact code** | `const ONBOARDING_PAGE_URL = Deno.env.get("MINGLA_BUSINESS_WEB_URL") ?? "https://business.mingla.com";` |
| **What it does** | Reads `MINGLA_BUSINESS_WEB_URL` env var; if unset (which it IS — verified absent from `supabase secrets list`), falls back to `https://business.mingla.com`. Then constructs `onboarding_url = ${ONBOARDING_PAGE_URL}/connect-onboarding?session=...&brand_id=...&return_to=...` |
| **What it should do** | Either (a) require `MINGLA_BUSINESS_WEB_URL` env var (no fallback), OR (b) fall back to a domain Mingla actually owns + has deployed the Expo Web export to (e.g., `https://business.usemingla.com` once DNS is configured + page is hosted there). |
| **Causal chain** | App calls `useStartBrandStripeOnboarding` → service → edge fn → fn returns `onboarding_url=https://business.mingla.com/...` → app's `expo-web-browser.openAuthSessionAsync(onboarding_url)` tries to load that URL → DNS NXDOMAIN → in-app browser shows "Couldn't connect" → app's mutation observes the error → toast "couldn't reach stripe" / "Edge Function returned a non-2xx status code" |
| **Verification step** | (1) `host business.mingla.com` returns NXDOMAIN (verified 2026-05-07). (2) `supabase secrets list \| grep MINGLA_BUSINESS_WEB_URL` returns nothing (verified 2026-05-07 — only STRIPE_* and other unrelated secrets present). (3) Sequence the code: line 40 fallback hits when env unset; line 363 builds the URL; line 392 returns it as `onboarding_url`. |

### 🔴 R-2: Publishable-key env var name mismatch — connect-onboarding page can't initialize Stripe Connect (PROVEN)

| Field | Value |
|---|---|
| **File + line** | `mingla-business/app/connect-onboarding.tsx:60-66` (consumer of the env var) and `mingla-business/app.config.ts:86-87` (producer of the env var) |
| **Exact code (consumer)** | `const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST;` (note `_TEST` suffix) |
| **Exact code (producer)** | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "pk_test_51TTnt1PjlZyAYA40..."` (no `_TEST` suffix) |
| **What it does** | At build time Expo bakes `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` into the bundle. At page render, the consumer reads `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` (different name) → returns `undefined` → triggers the "Stripe publishable key is not configured. Contact support@mingla.com." error path (line 64). |
| **What it should do** | One of (a) consumer reads `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (canonical name; matches Sub-C app.config.ts wiring), OR (b) producer writes `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` (matches consumer). Recommendation: consumer reads `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (drop `_TEST`); the test/live distinction is provided by the value itself (`pk_test_...` vs `pk_live_...`), not the var name. |
| **Causal chain** | Even when R-1 is fixed and `business.usemingla.com/connect-onboarding` (or wherever) loads, `connect-onboarding.tsx` evaluates `publishableKey === undefined` → `setInitError("Stripe publishable key is not configured.")` → page renders error card → user blocked from onboarding. |
| **Verification step** | grep result: only one consumer of `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` (connect-onboarding.tsx); only one producer of `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (app.config.ts). They don't match. |

### 🔴 R-3: iOS/Android Universal Links registered for unowned domains (PROVEN)

| Field | Value |
|---|---|
| **File + line** | `mingla-business/app.json:26-29` (iOS associatedDomains) + `:48-58` (Android intentFilters) |
| **Exact code (iOS)** | `"associatedDomains": ["applinks:business.mingla.com", "applinks:mingla.com"]` |
| **Exact code (Android)** | `intentFilters: [{ "action":"VIEW","autoVerify":true,"data":[{"scheme":"https","host":"business.mingla.com"},{"scheme":"https","host":"mingla.com",...}]}]` |
| **What it does** | Tells iOS/Android to enable Universal Links for `business.mingla.com` and `mingla.com`. Both require a `apple-app-site-association` (iOS) and `assetlinks.json` (Android) hosted at those domains. Neither domain hosts those files (mingla.com isn't ours; business.mingla.com is NXDOMAIN). iOS/Android auto-verify will silently fail; the app won't be invoked when a user taps a `https://business.mingla.com/...` link. |
| **What it should do** | After R-1 is resolved, replace with the actual deployment domain (`business.usemingla.com` or `usemingla.com/business/...`) and host the AASA + assetlinks.json files there. |
| **Causal chain** | Stripe's embedded onboarding flow may redirect back via Universal Link in some configurations. With Universal Links broken, the redirect falls back to opening the URL in the browser instead of returning to the app. Compounds R-1 — even if domain were resolvable, the back-to-app flow would silently break. |
| **Verification step** | (1) `host business.mingla.com` → NXDOMAIN. (2) `mingla.com` resolves to non-Mingla AWS/Squarespace IPs; Mingla can't add an AASA file there. (3) Cross-reference DEC-081/086 — operator owns the `mingla.com` workstream separately and "may stand up an SSR public site whenever they choose"; until then, no AASA file. |

### 🟠 C-1: `appInfo.url: "https://mingla.com"` in shared Stripe client

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/_shared/stripe.ts:42-45` |
| **Exact code** | `appInfo: { name: "Mingla", version: "1.0.0", url: "https://mingla.com" }` |
| **Effect** | Stripe SDK attaches this as the `Stripe-Account-Tag` / app-info header to every API call. Visible in Stripe Dashboard request logs. Does NOT control the user-facing `business_profile.url` (which is correct). |
| **What it should be** | `url: "https://usemingla.com"` (matches the Stripe platform `business_profile.url`). |

### 🟠 C-2: Edge fn `return_url` validation rejects usemingla.com

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/brand-stripe-onboard/index.ts:68-74` |
| **Exact code** | `function isValidReturnUrl(s: unknown): s is string { return typeof s === "string" && (s.startsWith("mingla-business://") \|\| s.startsWith("https://business.mingla.com/")); }` |
| **Effect** | If a future caller passes `https://business.usemingla.com/return` or `https://usemingla.com/business/return`, this validation rejects it as `400 validation_error`. Tightly coupled to the same wrong domain. |
| **What it should be** | Read the canonical web URL from env (same `MINGLA_BUSINESS_WEB_URL` as R-1), accept return URLs that start with the deep-link scheme OR with the canonical web URL prefix. |

### 🟠 C-3: Hardcoded contact strings + dead URLs in user-facing copy

| Where | Value | Issue |
|---|---|---|
| `mingla-business/src/components/brand/BrandOnboardView.tsx:84` | `SUPPORT_EMAIL = "support@mingla.com"` | `mingla.com` not owned → email never received |
| `mingla-business/app/connect-onboarding.tsx:64` | `"Contact support@mingla.com"` | Same |
| `mingla-business/src/components/onboarding/MinglaToSAcceptanceGate.tsx:71` | `"Full Terms of Service will be available at mingla.com/business/terms before live launch."` | Dead URL |
| `mingla-business/src/components/ui/ErrorBoundary.tsx:49` | `support@mingla.app` | Different domain from rest of app — drift; `mingla.app` may be owned but inconsistent |

### 🟡 H-1: `app.json` scheme drift vs `app.config.ts` override

| Field | Value |
|---|---|
| **File + line** | `app.json:8` says `"scheme": "minglabusiness"` (no hyphen); `app.config.ts:38` overrides to `"mingla-business"` (with hyphen) |
| **Risk** | Dynamic `app.config.ts` wins at Expo runtime, so the actual registered scheme is `mingla-business`. App deep links use `mingla-business://onboarding-complete` and work. BUT a maintainer reading `app.json` sees the wrong scheme — pattern violation. If app.config.ts is ever removed or refactored, app.json's stale value silently becomes authoritative. |
| **Fix direction** | Delete the `scheme` field from `app.json` (rely on app.config.ts only) OR sync both to `mingla-business`. |

### 🟡 H-2: 19+ public-share URL references to `business.mingla.com`

Files affected (each will silently produce dead links until domain works):
- `mingla-business/app/(tabs)/events.tsx:84` — `https://business.mingla.com/e/${event.brandSlug}/${event.eventSlug}`
- `mingla-business/app/event/[id]/index.tsx:99` — same shape
- `mingla-business/src/components/brand/PublicBrandPage.tsx:86,91` — share URL + OG image
- `mingla-business/src/components/event/PublicEventPage.tsx:170,174` — OG image + share URL
- `mingla-business/src/components/event/CreatorStep7Preview.tsx:182` — preview "Tickets will go live at mingla.com/e/..."
- `mingla-business/src/components/brand/BrandEditView.tsx:396` — slug prefix shows `mingla.com/`
- `mingla-business/src/utils/__tests__/onboardReactivation.test.ts:20,44,51` — test fixtures embed `business.mingla.com`

These are out of strict B2 scope but indicate broader product-side drift. Out of B2 V3 scope for fix, BUT relevant context for understanding why the onboarding URL was pointed at `business.mingla.com` (matched the broader pattern).

### 🟡 H-3: ToS placeholder body references unreachable URL

`MinglaToSAcceptanceGate.tsx:71` — placeholder body says ToS will live at `mingla.com/business/terms`. Already marked `[TRANSITIONAL]` per Sub-C IMPL report; legal sign-off swap will replace placeholder copy with real URLs. Tracked.

### 🔵 O-1: Stripe platform `business_profile.url` is correctly `https://usemingla.com`

```
GET /v1/account → business_profile.url = "https://usemingla.com" ✅
                business_profile.email = "seth@usemingla.com" ✅
                settings.dashboard.display_name = "MINGLA LLC sandbox"
```

The "Mingla Business wants to use ___ to sign in" string Stripe shows users derives from `business_profile.url`. With it correctly set to `usemingla.com`, the embedded onboarding should NOT show "mingla.com". Operator's reported observation may have been a paraphrase, an in-app debug log echoing `appInfo.url`, or a different surface (e.g., Stripe Express dashboard during status-resolve flow that uses different copy).

### 🔵 O-2: Consumer app (app-mobile) is consistent on `usemingla.com`

Per ORCH-0350 close: legal URLs centralized in `app-mobile/src/constants/urls.ts`. Share strings in 8 locale JSON files and `CollaborationSessions.tsx` all use `usemingla.com`. The drift is contained to the `mingla-business` codebase + edge fns, not consumer.

### 🔵 O-3: 4 different email/domain conventions across the codebase

- `support@mingla.com` — bad (mingla.com not owned)
- `support@mingla.app` — possibly owned (used in ErrorBoundary)
- `noreply@usemingla.com` — correct (admin-send-email canonical)
- `ops@mingla.app` — used in webhook health check
- Demo seed users at `*@mingla.app` — historical seed data

This is config drift that predates V3. Tracked as O-3 for orchestrator follow-up; not in V3 scope to fix.

---

## 4. Five-layer cross-check

| Layer | Truth |
|---|---|
| **Docs** | DEC-076/081/086 architecturally commit to `business.mingla.com` for Mingla Business product. POSITIONING_AND_GTM_STRATEGY.md, BUSINESS_PRD.md, BUSINESS_PROJECT_PLAN.md all reference `mingla.com/...` URLs. ORCH-0350 standardized consumer legal URLs to `usemingla.com`. |
| **Schema** | No DB schema references domains. Audit_log + notifications + brands + brand_team_members agnostic. |
| **Code** | Mingla Business: `business.mingla.com` referenced 19+ times. Consumer app-mobile: `usemingla.com` consistently. Edge fns: `_shared/stripe.ts` says `mingla.com`; `brand-stripe-onboard` defaults to `business.mingla.com`; `admin-send-email` says `usemingla.com`. **Code is internally inconsistent.** |
| **Runtime** | DNS reality: `usemingla.com` resolves + has Google MX. `business.mingla.com` is NXDOMAIN. `mingla.com` resolves to non-Mingla IPs (operator says not owned). `business.usemingla.com` is NXDOMAIN. Stripe platform `business_profile.url=usemingla.com`. |
| **Data** | Operator's email per DB and Stripe: `seth@usemingla.com`. Admin row in `admin_users`: `seth@usemingla.com`. **Data agrees with `usemingla.com` as canonical.** |

**Contradiction:** docs commit to `business.mingla.com`, code references `business.mingla.com`, but DNS + Stripe + data all say `usemingla.com`. **The architectural intent (mingla.com workstream per DEC-081) was never executed; the operator owns `usemingla.com` instead.**

---

## 5. Smoking gun

The "couldn't reach stripe" error chain has TWO equal-weight roots, in order of which fires first:

1. **R-1 fires first.** `brand-stripe-onboard` returns `onboarding_url = https://business.mingla.com/connect-onboarding?...`. App's `expo-web-browser.openAuthSessionAsync(...)` opens that URL. Browser DNS-resolves `business.mingla.com` → NXDOMAIN. Browser shows "Couldn't connect to server" or similar OS-level page. App may detect no callback and surface a generic error.

2. **R-2 would fire next, IF R-1 were resolved.** Even with the page reachable, `connect-onboarding.tsx` reads the wrong env var name → triggers "Stripe publishable key is not configured" → page renders the error card → user is still blocked.

Both must be fixed for the in-app onboarding to work.

The operator's verbatim observation "Mingla Business wants to use mingla.com to sign in" is **partially explained by C-1** (`appInfo.url: https://mingla.com` shows up in some Stripe surfaces), but the user-facing onboarding modal sources its display URL from `business_profile.url` which IS correct (`usemingla.com`). The operator may have been looking at the Express-dashboard-login URL (`handleResolveBanner` in `BrandPaymentsView.tsx:181` deep-links to `https://connect.stripe.com/express_login` which shows the platform's identity differently). Worth operator-side re-verification of where exactly the "mingla.com" string was seen.

---

## 6. Blast radius

| Surface | Impact |
|---|---|
| Mingla Business onboarding | **Completely broken** (in-app flow can't reach Stripe). |
| Mingla Business public share URLs (events, brands) | Already broken (NXDOMAIN). Out of B2 scope but related. |
| iOS Universal Links from `business.mingla.com` / `mingla.com` | Silently broken — auto-verify fails; back-to-app handoff falls back to browser. |
| Consumer app | Unaffected (consistent on `usemingla.com`). |
| Stripe platform configuration | Correct (`business_profile.url = usemingla.com`). |
| Email deliverability | `support@mingla.com` mail bounces (mingla.com not owned). `noreply@usemingla.com` works. |
| Stripe API calls | Working (no domain in API path; only `appInfo.url` cosmetic — C-1). |

---

## 7. Invariant violations

- **Constitution #2 (One owner per truth):** the canonical Mingla Business web domain is referenced as 3 different domains across the codebase (`mingla.com`, `business.mingla.com`, `usemingla.com`). No single source-of-truth constant.
- **Constitution #13 (Exclusion consistency):** `app.json` scheme `minglabusiness` vs `app.config.ts` scheme `mingla-business` (H-1). Same concept, two values.
- **No formal invariant exists for "platform web URL discipline".** Recommended: NEW invariant `I-PROPOSED-Y: PLATFORM_WEB_URL_FROM_ENV_ONLY` — every cross-domain URL in `mingla-business/` + edge fns reads from a single env var (`EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL` mobile, `MINGLA_BUSINESS_WEB_URL` server) with no hardcoded fallbacks. CI gate scans for hardcoded `business.mingla.com` / `mingla.com` strings.

---

## 8. Fix strategy (direction only — implementor follows in next dispatch)

**Operator-side (must happen first; cannot be code-fixed):**

1. **Decide canonical Mingla Business web URL.** Two options:
   - (a) `business.usemingla.com` — requires creating a DNS A/CNAME record for the `business` subdomain pointing at the Expo Web hosting provider (likely EAS Hosting, Netlify, Vercel, or wherever the operator is deploying the Expo Web export).
   - (b) `usemingla.com/business/...` — same root domain, paths-prefixed routing. Requires the existing `usemingla.com` host to route `/business/*` to the mingla-business Expo Web export.
2. **Deploy the Expo Web export to that domain.** `mingla-business/dist/connect-onboarding.html` already builds; it just needs hosting at the canonical URL.
3. **Set `MINGLA_BUSINESS_WEB_URL`** Supabase secret to that URL. Operator command: `supabase secrets set MINGLA_BUSINESS_WEB_URL=https://business.usemingla.com` (or chosen URL).
4. **(Optional but recommended)** Update Stripe platform's `business_profile.url` if it diverges from the chosen URL. Currently correct at `usemingla.com`.

**Code-side fixes (one implementor dispatch):**

1. **R-2 fix:** `connect-onboarding.tsx:61` change `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` → `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
2. **R-3 fix:** `app.json` lines 26-29 + 48-58 — replace `business.mingla.com` and `mingla.com` with the canonical URL's host. Host AASA + assetlinks.json files at the canonical URL.
3. **C-1 fix:** `_shared/stripe.ts:44` — change `appInfo.url: "https://mingla.com"` → read from env or hardcode `https://usemingla.com`.
4. **C-2 fix:** `brand-stripe-onboard/index.ts:68-74` — `isValidReturnUrl` should read from env, not hardcode `business.mingla.com`.
5. **C-3 fix:** `BrandOnboardView.tsx:84`, `connect-onboarding.tsx:64` — change `support@mingla.com` → `support@usemingla.com` (or whatever's owned). `MinglaToSAcceptanceGate.tsx:71` — replace `mingla.com/business/terms` with the canonical ToS URL. `ErrorBoundary.tsx:49` — align with chosen canonical email convention.
6. **H-1 fix:** delete `scheme` field from `app.json` (rely on `app.config.ts` only).
7. **NEW invariant + strict-grep gate** `I-PROPOSED-Y: PLATFORM_WEB_URL_FROM_ENV_ONLY` — code-side guard against future drift.

**Out of B2 V3 scope (track as separate ORCH):**

- H-2: 19+ public-share URLs in `mingla-business/components/...` (events.tsx, PublicBrandPage, etc.) — replace `business.mingla.com` with the canonical URL system-wide.
- H-3: ToS placeholder URL update — pending legal sign-off (Phase 18 CLOSE work).
- O-3: email convention drift — separate cleanup ORCH.

---

## 9. Regression prevention

- **Single source of truth:** `mingla-business/src/constants/platformUrl.ts` (new file) reads `process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL` and exports `MINGLA_BUSINESS_WEB_URL`. All consumers read this constant.
- **Edge fn parity:** `_shared/platformUrl.ts` reads `Deno.env.get("MINGLA_BUSINESS_WEB_URL")`. All consumers read this.
- **Strict-grep gate I-PROPOSED-Y:** scans `mingla-business/src/`, `mingla-business/app/`, `supabase/functions/` for hardcoded `business.mingla.com` / `mingla.com` / hardcoded https URLs that look like web URLs. Exempts the constants file. Allowlist tag for justified exceptions.
- **Build-time validation:** `app.config.ts` should verify `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL` is set in production builds; throw if absent.

---

## 10. Discoveries for orchestrator

1. **DEC-081/086 implicitly assumed `mingla.com` would be registered.** It wasn't; operator owns `usemingla.com`. The decision log doesn't acknowledge this divergence. Recommend a new DECISION_LOG entry post-fix: "DEC-XXX — Mingla Business web canonical URL is `business.usemingla.com` (or chosen variant); supersedes `business.mingla.com` references in DEC-076/081/086."
2. **`_shared/stripe.ts:44` was committed in B2a Phase 0** (per RAK runbook line 166 also referencing `https://mingla.com`). The drift is older than V3.
3. **Three SPEC files have `mingla.com` references** — `outputs/SPEC_B2_PATH_C_V3.md` is gitignored (in outputs/) so unverified, but per ORCH SPEC base may need refresh; `BUSINESS_PRD.md` line 179 + `BUSINESS_PROJECT_PLAN.md` lines 297, 316-318 — out of B2 scope to fix but worth tracking.
4. **The CI smoke workflow + Deno tests workflow** (`stripe-connect-smoke.yml`, `supabase-migrations-and-stripe-deno.yml`) don't depend on the web URL — they bypass the Mingla-hosted page entirely. So CI was passing while in-app was broken; no defense from automated testing.
5. **Operator may want to register `business.usemingla.com` as the canonical** if they don't intend to migrate the consumer app off `usemingla.com`. Alternatively, the path-prefix variant (`usemingla.com/business`) avoids subdomain DNS work but constrains routing on the marketing site.
6. **iOS app build cache** — if the operator already built the iOS app with `app.json`'s broken associatedDomains, those Universal Links are baked in. A new `eas build` is needed once `app.json` is fixed. **OTA update is NOT sufficient** for Universal Links changes — that's a native config.

---

## 11. Confidence level

**HIGH** for all root causes (R-1, R-2, R-3) and contributing factors (C-1, C-2, C-3).

- R-1: DNS verified (NXDOMAIN), Supabase secret list verified (env var absent), code path traced to file:line.
- R-2: grep confirms exactly two references (one consumer, one producer); names don't match.
- R-3: DNS + cross-platform manifest registration verified via app.json read.
- C-1, C-2, C-3, H-1: all verified by direct file inspection.

Remaining uncertainty: O-3 (email domain convention) is observation-only, not investigated for ownership of `mingla.app`. Out of B2 scope.

**Smoking-gun confidence:** HIGH that R-1 is the immediate cause of the operator's current "couldn't reach Stripe" failure. Verifying via Phase-16 in-app retest with `MINGLA_BUSINESS_WEB_URL` set to a valid URL (even a placeholder like `httpbin.org`) would confirm the chain — the browser would load that URL instead of failing DNS.

---

## 12. Recommended fix sequence

1. **Operator decides canonical Mingla Business web URL** (5 min decision; write to artifact)
2. **Operator sets up DNS + hosting** for that URL (~30-60 min — depends on hosting provider and DNS propagation)
3. **Operator deploys `mingla-business/dist/` Expo Web export** to that URL (~10 min)
4. **Operator sets `MINGLA_BUSINESS_WEB_URL`** Supabase secret (~30 sec)
5. **Implementor dispatch:** code fixes for R-2, R-3, C-1, C-2, C-3, H-1 + introduce `MINGLA_BUSINESS_WEB_URL` env var consumption pattern + new invariant `I-PROPOSED-Y` + strict-grep gate (~2-3 hr)
6. **Re-deploy 8 stripe edge fns** with the C-1 + C-2 fixes baked in (~5 min)
7. **EAS build (NOT just OTA)** for iOS — Universal Links are native config; OTA can't update them (~1 hr)
8. **Phase 16 in-app smoke retest** — onboard a sandbox brand from the Mingla Business app, verify embedded onboarding loads + completes + returns to app via deep link (~30 min)
9. **Operator-side cleanup ORCH for H-2** (the 19+ public-share URLs) — separate cycle, post-V3 CLOSE
10. **Operator-side legal swap for H-3** (ToS copy) — pre-go-live, separate workstream

Steps 1-4 are blocking; without them, no code fix can succeed. Steps 5-7 are the implementor pass. Step 8 is the verification gate before we're truly past Phase 16.

---

**End of investigation.**

Companion spec to follow when orchestrator approves: `outputs/SPEC_B2A_PATH_C_V3_CONFIG_DRIFT_FIX.md` — implementor-ready contract covering steps 5-6 above.
