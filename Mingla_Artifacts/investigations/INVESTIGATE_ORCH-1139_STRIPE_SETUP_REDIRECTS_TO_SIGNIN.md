# INVESTIGATE — ORCH-1139 [Stripe setup redirects to business sign-in]

- **Phase:** INVESTIGATE (read-only forensic root-cause)
- **Date:** 2026-06-15
- **Skill:** mingla-forensics + claude
- **Checkout:** anchor `/Users/sethogieva/Desktop/mingla-main`, branch `main` (READ-ONLY — no product-code edits)
- **Confidence:** `root cause probable` (full static trace across all five layers + git-pinned regression; the only unverified link is the live in-app WebBrowser localStorage emptiness, which is asserted by RN architecture but not device-reproduced this turn — see Confidence section)
- **Comms ledger:** read on entry. COMMS-0021 (WARN→ALL, Stripe seller-copy rename "Connect Stripe"→"Connect bank") factored — identifiers (`id:"connect_stripe"`) and the `/connect-*` route paths are unchanged by that rename, so it does not move the root cause. No new cross-ORCH discovery requiring a COMMS write.

---

## Symptom (Seth, verbatim)

> "Trying to set up stripe redirects me to the business app sign in. why? When did this regression happen and how can it be fixed? Also why did it happen so we can stop it from never happening again."

Logged-in business user taps "Set up payments" / "Connect bank". Instead of the Stripe Connect onboarding form, he lands on the business-app sign-in screen (`/` → BusinessWelcomeScreen).

**Expected:** the Stripe Connect Embedded onboarding page renders and the user completes bank setup.
**Actual:** the user is bounced to `/` (business sign-in).

---

## Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `mingla-business/src/utils/coldLoadAuthGates.ts` | The auth-gate predicates (the orchestrator's lead) |
| 2 | `mingla-business/app/_layout.tsx` (290-409) | Where the gate is consumed / mounted |
| 3 | `mingla-business/src/components/brand/BrandOnboardView.tsx` | The "Set up payments" CTA + how it opens Stripe |
| 4 | `mingla-business/src/utils/paidPublishGuards.ts` (95-108) | `brandStripeOnboardingRoute` — the route the CTAs push |
| 5 | `supabase/functions/brand-stripe-onboard/index.ts` (700-758) | What URL the onboarding actually opens |
| 6 | `mingla-business/app/connect-onboarding.web.tsx` | The gated web page |
| 7 | `mingla-business/src/components/stripe/connect-pages/ConnectOnboardingBody.web.tsx` | How that page authenticates (Stripe session vs Supabase user) |
| 8 | `mingla-business/__tests__/androidWebOnlyConnectRoutes.test.ts` | Existing connect-route invariant coverage (prevention gap) |
| 9 | git history of `coldLoadAuthGates.ts` + `_layout.tsx` + pre-1102 `ORCH_1092_SIGNED_OUT_ROUTES` | Regression pinpoint |

---

## How the user actually reaches Stripe setup (the trigger surface)

There are **two distinct surfaces** and the symptom lives in the native one:

**Surface A — Native business app (the symptom path):**
1. CTA "Set up payments" / "Connect bank" (e.g. `BrandOnboardView`, trip/experience wizards, `StripeBlockedCard`) → `router.push(brandStripeOnboardingRoute(brand.id))` = `router.push("/brand/{id}/payments/onboard")`.
   - `paidPublishGuards.ts:106-107`: `brandStripeOnboardingRoute = (brandId) => \`/brand/${brandId}/payments/onboard\``.
   - This native route mounts `BrandOnboardView`. It is a **native expo-router route — NOT gated, renders fine.**
2. Inside `BrandOnboardView.handleStart` (`BrandOnboardView.tsx:365-387`): calls `brand-stripe-onboard` edge fn → receives `onboarding_url` → **opens it in an in-app browser** via `WebBrowser.openAuthSessionAsync(result.onboarding_url, RETURN_DEEP_LINK)` (`:384-387`).
3. `brand-stripe-onboard/index.ts:723-726` builds that URL as:
   `${businessWebOrigin}/connect-onboarding?session=<stripe_client_secret>&brand_id=<id>&return_to=<deep_link>`.
4. The in-app browser loads the **mingla-business WEB bundle** at `/connect-onboarding`. The web bundle's **root `app/_layout.tsx` gate runs first** and redirects to `/` (sign-in) before the connect page can mount.

So the user taps a native button, a system browser opens, and **that browser shows the business sign-in wall** — exactly "redirects me to the business app sign in."

**Surface B — Business web directly:** a logged-out (or fresh-session) visit to `https://business.…/connect-onboarding?...` hits the identical gate. Same redirect.

The in-app browser is a **fresh web context that does not carry the native Supabase session** (native session lives in SecureStore/AsyncStorage; the web gate reads `hasStoredSupabaseWebSession()` from web localStorage, which is empty in the freshly-opened WebBrowser). The gate therefore *correctly, by its own logic* sees "no user, no stored web session" — but it is gating a page that **never needed a Supabase session in the first place** (it authenticates against Stripe via the `session=` client_secret).

---

## Q-scorecard

**Q1 — Does a `/connect-*` pathname fall through the public-route allowlist and trigger the redirect to `/`?**
`coldLoadAuthGates.ts:135-145` — `PUBLIC_BUYER_ROUTE_PREFIXES` = `/e/ /t/ /b/ /exp/ /checkout/ /checkout-trip/ /checkout-experience/ /o/ /booking/`. No `/connect-*`, no `/brand/`, no `/stripe-onboarding-return`. `isPublicBuyerRoute("/connect-onboarding")` → `false`. `shouldRedirectToSignInFromRoute` (`:202-217`) then returns `true` for an unauthenticated web context on `/connect-onboarding`. **Verdict: YES — the connect routes are not exempt. `probable`.**

**Q2 — Is the connect page native (gate misfiring on a real session) or in-app-browser web (gate sees a genuinely sessionless context)?**
It is the **web bundle opened in an in-app browser** (`BrandOnboardView.tsx:384` `WebBrowser.openAuthSessionAsync` of the `${businessWebOrigin}/connect-onboarding` URL from `brand-stripe-onboard/index.ts:723`). The gate is NOT misfiring on a logged-in native session — the browser context legitimately has no Supabase web session. The bug is that the page is gated at all. **Verdict: in-app-browser web; the gate is over-broad, not mis-evaluating. `probable`.**

**Q3 — Does the connect page even need a Supabase session?**
No. `ConnectOnboardingBody.web.tsx:44-98` authenticates **only** via the `session` URL param (the Stripe AccountSession `client_secret`): `fetchClientSecret: async () => sessionClientSecret` (`:86`). It never calls `useAuth`, never reads a Supabase user. The page is self-authenticating against Stripe. **Verdict: NO — the page carries its own credential; the Supabase gate is inappropriate for it. `proven` (source-confirmed).**

**Q4 — When was this introduced?**
ORCH-1102 (commit `7c86708c2`, 2026-06-08) replaced the route-LIST gate with a route-AGNOSTIC gate. Pre-1102, `ORCH_1092_SIGNED_OUT_ROUTES` only gated `/hub/events /hub/trips /marketing /marketing/campaigns/compose /account` — `/connect-onboarding` was never in it, so it rendered. ORCH-1115 (commit `ca352fdc2`, 2026-06-11) added a buyer-only allowlist, fixing `/e/ /t/…` but **not** seller `/connect-*`. **Verdict: regression live for sellers since ORCH-1102 / 2026-06-08; ORCH-1115 partially fixed the same family but missed the seller routes. `proven` (git-pinned).**

**Q5 — Is this the same root-cause family as ORCH-1115?**
Yes — identical mechanism (a route that should be exempt from the route-agnostic Supabase gate is missing from `PUBLIC_BUYER_ROUTE_PREFIXES`). ORCH-1115 named the allowlist "PUBLIC **BUYER** ROUTE" and scoped it to anon buyers; it never considered the seller connect surface, which is *also* served by the web bundle in a sessionless in-app browser. **Verdict: same family, seller half left unfixed. `proven`.**

---

## Findings (six-field evidence)

### F-1 — `/connect-*` seller routes are absent from the only allowlist the route-agnostic gate consults — `CONFIRMED ROOT CAUSE`

1. **Symptom:** tapping "Set up payments" opens an in-app browser that shows the business sign-in screen instead of the Stripe onboarding form.
2. **Layer:** code (client route gate).
3. **Probe:**
   ```
   Read mingla-business/src/utils/coldLoadAuthGates.ts (135-217)
   Read mingla-business/app/_layout.tsx (305-351)
   ```
4. **Evidence:**
   - `coldLoadAuthGates.ts:135-145`:
     ```
     export const PUBLIC_BUYER_ROUTE_PREFIXES = [
       "/e/","/t/","/b/","/exp/","/checkout/","/checkout-trip/",
       "/checkout-experience/","/o/","/booking/",
     ] as const;   // ← no "/connect-…", no "/brand/", no "/stripe-onboarding-return"
     ```
   - `coldLoadAuthGates.ts:202-217` — `shouldRedirectToSignInFromRoute` returns `true` when web + resolved + no user + no stored web session + `!isSignInRoute(pathname)` + `!isPublicBuyerRoute(pathname)`. For `/connect-onboarding`, all clauses are true → redirect.
   - `_layout.tsx:317-323` consumes it: `const redirectToSignIn = shouldRedirectToSignInFromRoute({ isWeb, loading, hasUser: user !== null, hasStoredWebSession, pathname })` → the layout emits `<Redirect href="/" />`.
5. **Mechanism:** the in-app browser loads `/connect-onboarding` with no web Supabase session → the route-agnostic gate, finding the pathname is neither the sign-in route nor a public-BUYER route, redirects to `/` (sign-in) before the connect page mounts.
6. **Severity:** `CONFIRMED ROOT CAUSE`.

### F-2 — The gated page authenticates via the Stripe `session` client_secret, not a Supabase session — so the Supabase gate is categorically wrong for it — `SECONDARY ROOT CAUSE`

1. **Symptom:** the page would render correctly if reached; the gate is the only thing stopping it.
2. **Layer:** code (page contract).
3. **Probe:** `Read ConnectOnboardingBody.web.tsx (44-98)`; `grep "useAuth\|supabase" ConnectOnboardingBody.web.tsx` → none.
4. **Evidence:** `ConnectOnboardingBody.web.tsx:86` `fetchClientSecret: async () => sessionClientSecret;` — the page's only credential is the URL `session` param (`:44-54, :67`). No Supabase user read anywhere in the body.
5. **Mechanism:** the page is designed to be opened in a sessionless in-app browser carrying a Stripe `client_secret` — the very context the Supabase gate treats as "logged out". The gate enforces a session the page neither has nor needs.
6. **Severity:** `SECONDARY ROOT CAUSE` (it is *why* the fix is an exemption rather than a session-propagation; the page is correctly self-authenticating).

### F-3 — Regression introduced by ORCH-1102's allowlist→gate-everything inversion; ORCH-1115 fixed only the buyer half — `CONFIRMED (regression provenance)`

1. **Symptom:** worked before 2026-06-08; broken after.
2. **Layer:** code history.
3. **Probe:**
   ```
   git show -s --format="%h %ci %s" 7c86708c2 ca352fdc2
   git show 7c86708c2~1:mingla-business/app/_layout.tsx | sed -n '/ORCH_1092_SIGNED_OUT_ROUTES = new Set/,/]);/p'
   ```
4. **Evidence:**
   - `7c86708c2 2026-06-08 ORCH-1102 …business-web auth routing — remove stub gates, unauth/cancel → sign-in`.
   - pre-1102 set: `ORCH_1092_SIGNED_OUT_ROUTES = new Set(["/hub/events","/hub/trips","/marketing","/marketing/campaigns/compose","/account"])` — `/connect-onboarding` ABSENT ⇒ never gated ⇒ rendered.
   - `ca352fdc2 2026-06-11 ORCH-1115 …public buyer routes must not redirect to sign-in (P0)` — added buyer prefixes only.
5. **Mechanism:** ORCH-1102 inverted the model from "gate a named list of authed routes" to "gate EVERY route except a named public list". `/connect-*` silently flipped from exempt to gated. ORCH-1115's allowlist restored buyer routes but not seller connect routes.
6. **Severity:** `CONFIRMED ROOT CAUSE` (provenance) — same family as ORCH-1115.

### F-4 — Sibling seller/credential-bearing web routes share the defect (blast radius) — `SECONDARY ROOT CAUSE`

1. **Symptom:** any other web-served route reached in a sessionless in-app browser is also bounced.
2. **Layer:** code (route inventory).
3. **Probe:** `ls mingla-business/app/*.web.tsx app/*.tsx`; cross-check each against `PUBLIC_BUYER_ROUTE_PREFIXES`.
4. **Evidence:** web-served routes NOT in the allowlist and NOT the sign-in route:
   `/connect-onboarding`, `/connect-account-management`, `/connect-partner-onboarding`, `/connect-partner-account-management`, `/connect-tax-registrations`, `/stripe-onboarding-return` (legacy relay), plus `/accept-brand-invitation`, `/accept-scanner-invitation` (token-bearing invite-accept pages that a logged-out invitee can legitimately open). All carry their own credential (Stripe `session` / Stripe Account Link / invite token), none need a Supabase web session.
5. **Mechanism:** the same over-broad gate bounces every one of these the moment the visitor lacks a web Supabase session.
6. **Severity:** `SECONDARY ROOT CAUSE` — the fix must cover the whole seller/credential-bearing set, not just `/connect-onboarding`, or the symptom recurs on the next surface.

### F-5 — RULED OUT: the gate is NOT misfiring on a present logged-in session

`shouldRedirectToSignIn` (`:66-76`) only fires `&& !hasUser && !hasStoredWebSession`. In the native app's own (non-browser) context a logged-in user has `hasUser === true`, so native screens are not bounced. The redirect happens specifically in the *in-app-browser web context*, which is genuinely sessionless. The gate logic is internally correct; the defect is its **scope** (no seller-route exemption) and applying it to a **self-authenticating page**. `RULED OUT` (gate-mis-evaluation hypothesis).

---

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction? |
|-------|-------|----------------|
| **Docs** | `connect-onboarding.web.tsx:12` documents the route as `business.mingla.com/connect-onboarding?session=…` — a session-param-authenticated embedded page, expected to load standalone. | Docs say "loads standalone with a Stripe session"; the gate says "must have a Supabase session". **CONTRADICTION → docs/page contract hold the truth; the gate is wrong.** |
| **Schema/RLS** | n/a — pure client route gate; `brand-stripe-onboard` already enforces auth server-side at link creation. RLS is not the gate here. | No. |
| **Code** | `PUBLIC_BUYER_ROUTE_PREFIXES` lacks seller connect routes; `shouldRedirectToSignInFromRoute` returns `true` for `/connect-onboarding`. | This is the bug. |
| **Runtime** | In-app browser opens `/connect-onboarding` with empty web localStorage → `hasStoredWebSession=false`, `hasUser=false` → `<Redirect href="/" />`. (Asserted from RN/WebBrowser architecture; not device-reproduced this turn.) | Matches the symptom. |
| **Data** | No stored Supabase web session exists in the freshly-opened in-app browser; the only credential present is the Stripe `client_secret` in the URL. | Confirms the gate sees "logged out" while the *page* is fully credentialed. |

---

## Repro evidence

**Not device-reproduced this turn** (read-only static + git investigation). The trace is fully closed in source across all five layers and git-pinned. The single un-instrumented link — that the in-app `WebBrowser` context carries no web localStorage Supabase session — is asserted from React Native architecture (native session storage ≠ in-app-browser web localStorage) and from the gate's own design comments (`coldLoadAuthGates.ts:56-64` "no stored web session"). Live confirmation (open Set-up-payments on a device, observe the in-app browser show the sign-in screen; or load `/connect-onboarding?...` in a logged-out web browser) is recommended as a tester gate but is not required to establish the mechanism. Confidence therefore caps at `probable`.

---

## Blast radius / cross-surface map

- **Business iOS (native CTA → in-app browser):** BROKEN — the symptom surface. IN SCOPE.
- **Business Android (native CTA → in-app browser):** BROKEN (same code path). IN SCOPE.
- **Business Web (direct, sessionless or fresh):** BROKEN for the same routes. IN SCOPE.
- **All `/connect-*` seller + partner + tax routes, `/stripe-onboarding-return`:** BROKEN (F-4). IN SCOPE.
- **`/accept-brand-invitation`, `/accept-scanner-invitation`:** likely BROKEN for a logged-out invitee (token-bearing, web-served, not allowlisted). FLAGGED — see Discoveries; scope decision for the SPEC.
- **Consumer iOS/Android (`app-mobile`):** NOT AFFECTED — different app, different gate; Stripe payouts there are unrelated. OUT OF SCOPE.
- **Buyer public routes (`/e/ /t/ …`):** already fixed by ORCH-1115. OUT OF SCOPE.

---

## Invariant impact

- **I-PROPOSED-1115-PUBLIC-BUYER-ROUTE-ALLOWLIST** (`coldLoadAuthGates.ts:130`): its name and intent are *buyer*-scoped. The seller-connect exemption is a DIFFERENT class (a session-param-authenticated seller page), so folding `/connect-*` into a constant named "PUBLIC BUYER ROUTE" would be a semantic mismatch and risks a future reviewer pruning it. FLAGGED for the SPEC to decide: extend that constant vs. introduce a sibling `SELF_AUTHENTICATED_CONNECT_ROUTE_PREFIXES`.
- **Constitutional caveat (do NOT pre-decide here):** a blanket public exemption on `/connect-*` is acceptable *only because* each connect page is self-authenticating against Stripe via the `session` client_secret (F-2) and the link itself is minted by an auth-checked edge function. The exemption must be paired with that page-level credential, never granted to a page that would then read sensitive account data from an implicit Supabase session. The SPEC must state this explicitly so the exemption can't be copied onto a non-self-authenticating route later.

---

## Discoveries for Orchestrator (side issues — not in this symptom's direct line)

1. **D-1:** `/accept-brand-invitation` + `/accept-scanner-invitation` are web-served, token-bearing, and NOT allowlisted — a logged-out invitee opening an emailed invite link is likely bounced to sign-in (same family). Recommend the orchestrator decide whether ORCH-1139 absorbs these or spawns a sibling. Not expanded here (no scope creep).
2. **D-2:** `/stripe-onboarding-return` (legacy relay, `@deprecated` per ORCH-0954) self-redirects on mount but is gated *before* its effect runs — if any legacy hosted-onboarding return path is still live in TEST, the return bounce would also hit sign-in. Low priority (deprecated path).
3. **D-3 (prevention gap):** `androidWebOnlyConnectRoutes.test.ts` already enumerates the connect routes for a *different* invariant (no web SDK in native bundle). There is currently **no test asserting that every top-level `app/` route is either allowlisted or intentionally gated** — which is exactly why both ORCH-1115 (buyer) and ORCH-1139 (seller) slipped through. See Prevention.

---

## ROOT CAUSE (one sentence)

ORCH-1102 (commit `7c86708c2`, 2026-06-08) replaced the business-web auth gate's named *authed-route list* with a *route-agnostic redirect-everything-to-sign-in* gate whose only escape hatch is `PUBLIC_BUYER_ROUTE_PREFIXES`; the self-authenticating Stripe-Connect seller pages (`/connect-onboarding` et al.), which native "Set up payments" opens in a sessionless in-app browser via `WebBrowser.openAuthSessionAsync`, are absent from that buyer-only allowlist, so the gate redirects them to `/` (business sign-in) before the connect page — which needs only its Stripe `session` client_secret, never a Supabase session — can mount; ORCH-1115 (commit `ca352fdc2`, 2026-06-11) fixed the identical defect for buyer routes but never extended the allowlist to the seller connect surface.

---

## Recommended fix (direction only — narrowest correct)

The narrowest correct fix is **(a) extend the route-gate allowlist** to exempt the self-authenticating Stripe-Connect seller routes (`/connect-onboarding`, `/connect-account-management`, `/connect-partner-onboarding`, `/connect-partner-account-management`, `/connect-tax-registrations`, and the `/stripe-onboarding-return` relay) from the root-layout sign-in redirect — NOT (b) propagate the business session into the in-app-browser web context (unnecessary and higher-risk: the pages don't need it, F-2/Q3).

**Mandatory constitutional caveat for the SPEC:** the exemption is sound ONLY because each connect page authenticates via its Stripe `session` client_secret minted by an auth-checked edge function; the SPEC must (1) keep the exemption distinct from the buyer allowlist (separate constant or a clearly-renamed combined one) so reviewers don't mistake it for "anon-buyer", and (2) carry a protective comment that this exemption may only ever apply to pages that carry their own out-of-band credential — never to a page that would then read account data from an implicit Supabase session.

Routing of the CTA itself (native `/brand/{id}/payments/onboard` push → WebBrowser open of the web `/connect-onboarding`) is correct and must NOT change.

---

## Prevention (invariant proposal — DRAFT, orchestrator owns the flip)

**Structural gap:** the gate model is "deny by default, allow a hand-maintained list", but there is no test forcing that list to stay complete. Two separate ORCHs (1115 buyer, 1139 seller) shipped with routes silently falling into "redirect to sign-in" because nothing asserts the closure.

**I-PROPOSED-1139-ROUTE-GATE-CLOSURE (DRAFT):** a strict-grep / static test that enumerates EVERY top-level route file under `mingla-business/app/` (`*.tsx` / `*.web.tsx`, excluding `_layout`, `+html`, `+not-found`, `__styleguide`) and asserts each pathname is in exactly one of two explicit sets — `GATED_AUTHED_ROUTES` or `EXEMPT_PUBLIC_OR_SELF_AUTH_ROUTES` (the union of the buyer allowlist + the new connect/self-auth allowlist) — failing the build if any route is in neither. The test must FAIL when the connect-route exemption is reverted and PASS when restored (fails-on-revert). This converts "a new route silently inherits redirect-to-sign-in" from a latent P0 into a CI failure at the moment the route is added.

---

## Recommended next phase + scope

**Next phase: SPEC** (this skill, SPEC mode, or a fresh dispatch). Scope = fix (a) extend the gate allowlist to the self-authenticating connect/seller routes per the constitutional caveat + add the I-PROPOSED-1139 route-gate-closure test. Decide D-1 (invite-accept routes) explicitly: either absorb (they are the same family) or carve out to a sibling ORCH. DO-NOT-TOUCH: the CTA routing, `brand-stripe-onboard` edge fn, the connect page bodies, and the buyer allowlist semantics.

---

## Evidence appendix (commands + key results)

```
# Gate predicates + allowlist
Read mingla-business/src/utils/coldLoadAuthGates.ts
  → :135-145 PUBLIC_BUYER_ROUTE_PREFIXES = [/e/ /t/ /b/ /exp/ /checkout/ /checkout-trip/
     /checkout-experience/ /o/ /booking/]   (no /connect-*, no /brand/)
  → :202-217 shouldRedirectToSignInFromRoute = shouldRedirectToSignIn && !isSignInRoute && !isPublicBuyerRoute

# Gate consumer (root layout)
grep -rn "shouldRedirectToSignInFromRoute|isPublicBuyerRoute" mingla-business/app
  → app/_layout.tsx:317  shouldRedirectToSignInFromRoute({... pathname})
  → app/_layout.tsx:351  nativeRedirectToSignIn = ... && !isPublicBuyerRoute(pathname)

# CTA → route
grep -rn "brandStripeOnboardingRoute" mingla-business/src
  → paidPublishGuards.ts:106  => `/brand/${brandId}/payments/onboard`
  → ExperienceCreatorWizard / TripCreatorWizard / EditPublishedTripScreen: router.push(brandStripeOnboardingRoute(...))

# Native onboard view opens the WEB connect URL in an in-app browser
Read BrandOnboardView.tsx
  → :384-387  WebBrowser.openAuthSessionAsync(result.onboarding_url, RETURN_DEEP_LINK)

# Edge fn builds the gated URL
grep -n "onboarding_url|connect-onboarding|return_to" supabase/functions/brand-stripe-onboard/index.ts
  → :723  const onboardingUrl = `${businessWebOrigin}/connect-onboarding?session=...&brand_id=...&return_to=...`

# Connect page is self-authenticating (Stripe session, not Supabase user)
grep -n "session|client_secret|useAuth|supabase" ConnectOnboardingBody.web.tsx
  → :86  fetchClientSecret: async () => sessionClientSecret    (no useAuth / no supabase user read)

# Regression pinpoint
git log --oneline --follow -- mingla-business/src/utils/coldLoadAuthGates.ts
  → ca352fdc2 ORCH-1115 (2026-06-11) | 763ac41fa ORCH-1103 | 7c86708c2 ORCH-1102 (2026-06-08) | 01a8c8d0d ORCH-1100
git show -s --format="%h %ci %s" 7c86708c2 ca352fdc2
  → 7c86708c2 2026-06-08 ORCH-1102 business-web auth routing (route-agnostic gate)
  → ca352fdc2 2026-06-11 ORCH-1115 public buyer routes must not redirect (P0)
git show 7c86708c2~1:mingla-business/app/_layout.tsx | sed -n '/ORCH_1092_SIGNED_OUT_ROUTES/,/]);/p'
  → pre-1102 gate list = ["/hub/events","/hub/trips","/marketing","/marketing/campaigns/compose","/account"]  (NO /connect-onboarding → was exempt)

# Route inventory + prevention-gap test
ls mingla-business/app/*.web.tsx app/*.tsx
  → connect-onboarding(.web), connect-account-management(.web), connect-partner-onboarding(.web),
    connect-partner-account-management(.web), connect-tax-registrations/, stripe-onboarding-return,
    accept-brand-invitation, accept-scanner-invitation, index, notifications
Read __tests__/androidWebOnlyConnectRoutes.test.ts
  → enumerates connect routes for the web-SDK-quarantine invariant ONLY; no route-gate-closure assertion
```
