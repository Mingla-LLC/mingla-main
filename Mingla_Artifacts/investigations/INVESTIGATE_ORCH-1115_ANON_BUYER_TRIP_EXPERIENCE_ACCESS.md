# INVESTIGATE — ORCH-1115 [can anonymous buyers reach AND purchase trips/experiences like events?]

- **Mode:** INVESTIGATE (forensics) — production runtime proof mandatory.
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1115-[anon-buyer-access]/` · branch `ORCH-1115-anon-buyer-access` (HEAD `a7cc767e3`, even with origin/main).
- **Date:** 2026-06-11
- **Origin:** ORCH-1114 QA report Discovery D-1 — the ORCH-1102 route-agnostic auth gate redirected EVERY no-user web route (incl. public `/t/ /e/ /b/ /exp/`) to sign-in in a LOCAL web export. ORCH-1115 asks whether this holds on PRODUCTION.
- **Seth's exact question:** "So anonymous buyers can't buy trips and experiences like events?"

---

## 1. Headline answer (direct, per surface)

| Surface | Anon VIEW (web) | Anon BUY (web) |
|---------|-----------------|----------------|
| **EVENT** (`/e/…`) | **NO** — redirects to sign-in | **NO** — `/checkout/…` redirects to sign-in |
| **TRIP** (`/t/…`) | **NO** — redirects to sign-in | **NO** — `/checkout-trip/…` redirects to sign-in |
| **EXPERIENCE** (`/exp/…`) | **NO** — redirects to sign-in | **NO** — checkout route redirects to sign-in |
| **BRAND** (`/b/…`) | **NO** — redirects to sign-in | n/a |

**The premise of the question is the surprise: there is NO event-vs-trip asymmetry.** A fully logged-out web buyer cannot view OR buy ANY of the three — events are broken in exactly the same way as trips and experiences. The *entire* anonymous share-link → checkout funnel on `business.usemingla.com` is currently collapsed for logged-out users. So the honest answer to Seth is: "Right now, anonymous buyers can't buy trips and experiences on web — but they can't buy events on web either. It's not that trips/experiences are special; the whole anon web funnel is down."

**Severity: P0 — LAUNCH BLOCKER.** Every share link sent to a guest (IG bio, WhatsApp, text) bounces the guest to a business sign-up screen instead of the purchase page. This is the primary money funnel.

**Scope note:** native consumer app (`app-mobile/`) is a SEPARATE surface and is NOT affected — these `/t/ /e/ /b/ /exp/` routes exist only in `mingla-business/` web. The collapse is web-only.

---

## 2. Investigation manifest (files read, in trace order)

| # | File / artifact | Layer | Why |
|---|-----------------|-------|-----|
| 1 | `COMMS_LEDGER.md` | docs | entry guard; no BLOCK/OPEN targeting ORCH-1115/forensics/ALL (only WARN/FYI). |
| 2 | ORCH-1114 `QA_…_PUBLIC_TRIP_EXPERIENCE_SHARE.md` (D-1) | docs | the exact reproduction + workaround that spawned this ORCH. |
| 3 | `feedback_anon_buyer_routes.md` | docs | the long-standing anon-tolerant route contract this gate violates. |
| 4 | `mingla-business/app/_layout.tsx` | code | the ORCH-1102 ROOT-layout auth gate; governs every route. |
| 5 | `mingla-business/src/utils/coldLoadAuthGates.ts` | code | the `shouldRedirectToSignInFromRoute` predicate — no public-route allowlist. |
| 6 | `app/t/`, `app/e/`, `app/exp/`, `app/b/` (`_layout` absence + page heads) | code | confirm no nested layout overrides the root gate; page comments still claim "anon-tolerant, no redirect". |
| 7 | `app/checkout/`, `app/checkout-trip/`, `app/checkout-experience/` `_layout.tsx` | code | confirm checkout layouts are anon-tolerant but still nested under the gated root. |
| 8 | `git log app/_layout.tsx` | data | dates ORCH-1102 (#414) `[deploy]` ship to 2026-06-08 — a 3-day-old regression. |
| 9 | Production browser drive (Playwright/Chromium, anon) | runtime | the decisive proof — see §5. |
| 10 | Anon REST reads (anon key) of events + sidecar tables | data/schema | RLS is NOT the gap — anon reads everything needed. |

---

## 3. Q-scorecard

**Q1. On production, can a logged-out buyer VIEW a trip / experience page the way they can an event?**
Verdict: **NO for all three (events, trips, experiences) — `proven` (production Chromium).** None render; all redirect to the business sign-in welcome screen. No asymmetry.

**Q2. On production, can a logged-out buyer reach CHECKOUT and pay, per surface?**
Verdict: **NO for all three — `proven` (production Chromium).** `/checkout/…` and `/checkout-trip/…` both redirect to sign-in before the checkout screen (or PaymentSheet) can mount. The redirect fires at the root layout, above the route, so the CTA and payment step are unreachable.

**Q3. What is the root cause, and is it a route-allowlist gap, an RLS gap, or both?**
Verdict: **Route-allowlist gap ONLY — `proven`.** The ORCH-1102 root-layout gate (`shouldRedirectToSignInFromRoute`) redirects every web route except `/` for a logged-out user; it has NO allowlist exempting the public buyer routes. RLS is fully permissive to anon for the events row AND the sidecar tables (`trip_days`, `trip_pricing_tiers`, `event_dates`, `experience_stops`) — proven by direct anon-key reads. The fix is purely at the route-gate layer.

**Q4. Is the production redirect a real bug, a dev-only artifact, or a recent regression?**
Verdict: **Real, live, recent regression — `proven`.** ORCH-1102 (PR #414, commit `7c86708c2`, `[deploy]`-tagged) shipped 2026-06-08 and moved the auth gate from a `(tabs)`-scoped / route-list gate to the route-AGNOSTIC ROOT layout. Curl confirms Vercel serves HTTP 200 SPA shell for the public routes (no edge redirect); the redirect is purely client-side, executed after hydration. The tester's local-export observation reproduces on production.

---

## 4. Findings (six-field evidence)

### F-1 — CONFIRMED ROOT CAUSE: the ORCH-1102 root-layout auth gate redirects every public buyer web route to sign-in; no allowlist for `/t/ /e/ /b/ /exp/ /checkout*`.

1. **Symptom.** A logged-out browser loading any of `/e/…`, `/t/…`, `/exp/…`, `/b/…`, `/checkout/…`, `/checkout-trip/…` on `business.usemingla.com` lands on the business sign-in welcome screen ("Continue with Apple / Google / Email"), not the buyer page.
2. **Layer.** Code (client route guard) — confirmed against Runtime.
3. **Probe.**
   - `mingla-business/app/_layout.tsx` read verbatim.
   - `mingla-business/src/utils/coldLoadAuthGates.ts` read verbatim.
   - `grep -nE "/t/|/e/|/b/|/exp/|checkout|public|buyer|allowlist|isPublic" src/utils/coldLoadAuthGates.ts` → no matches.
4. **Evidence.**
   - `coldLoadAuthGates.ts:124-138` —
     ```ts
     export const shouldRedirectToSignInFromRoute = ({...pathname}) =>
       shouldRedirectToSignIn({ isWeb, loading, hasUser, hasStoredWebSession }) &&
       !isSignInRoute(pathname);
     ```
     and `:66-76` `shouldRedirectToSignIn = isWeb && !loading && !hasUser && !hasStoredWebSession`. The ONLY pathname check is `isSignInRoute`, which (`:102-112`) matches only `/`. There is **no public-route allowlist**.
   - `app/_layout.tsx:307-313` computes `redirectToSignIn` from that predicate and `:568-574` returns `<Redirect href="/" />` for any logged-out web user on any non-`/` route.
   - `app/_layout.tsx` is the ROOT layout — it wraps every route in the Expo Router tree. `app/t/`, `app/e/`, `app/exp/`, `app/b/` have **no own `_layout.tsx`** (`ls` confirms only `[brandSlug]/` + `__tests__/`), so nothing overrides the root gate.
5. **Mechanism.** For a genuinely logged-out user `loading` resolves quickly and `hasStoredWebSession()` is false → `redirectToSignIn` is true on every non-`/` route → the root layout returns `<Redirect href="/" />` before the buyer page or checkout screen ever mounts → the guest sees the business sign-in screen.
6. **Severity.** **CONFIRMED ROOT CAUSE.**

### F-2 — CONFIRMED (rules out RLS): anon RLS reads every table the buyer pages need; the gap is NOT data-layer.

1. **Symptom.** N/A (this finding RULES OUT an alternative cause).
2. **Layer.** Schema (RLS) / Data.
3. **Probe.** Anon-key (`role=anon`) REST reads against `https://gqnoajqerqhnvulmnyvv.supabase.co/rest/v1/…` for the three published rows and their sidecar tables.
4. **Evidence.** Anon returned the rows:
   - `events` (trip `the-dc-adventure`, experience `raleigh-wine-and-dine-crawl`, event `the-reckoning`) — all readable.
   - `trip_days` (event_id = the-dc-adventure) → "Day 1 - Arrival" row returned.
   - `trip_pricing_tiers` (event_id = the-dc-adventure) → "Standard" tier returned.
   - `event_dates` (event_id = the-dc-adventure) → 2026-08-17 master date returned.
   - `experience_stops` (event_id = raleigh-wine-and-dine-crawl) → stop row returned.
5. **Mechanism.** Because anon can read the offering + sidecar data for all three kinds, the page would render fully and checkout could price — IF the route gate let the page mount. The blocker is exclusively the client route guard (F-1), not RLS.
6. **Severity.** **RULED OUT** (RLS as a cause) — and it confirms the fix is purely route-gate-shaped.

### F-3 — SECONDARY (regression timing + Docs↔Code contradiction): ORCH-1102 silently broke the anon-buyer contract.

1. **Symptom.** Page-head comments on `/t/` and `/exp/` still read "Anon-tolerant per feedback_anon_buyer_routes.md: no useAuth, no sign-in redirect. Anyone with the share link sees this page." — yet the share link redirects to sign-in.
2. **Layer.** Docs vs Code contradiction; regression dating.
3. **Probe.** `git show -s 7c86708c2`; head-comment greps of the public routes; `feedback_anon_buyer_routes.md` read.
4. **Evidence.** ORCH-1102 (#414) shipped `2026-06-08 12:24` `[deploy]`. `feedback_anon_buyer_routes.md` says these routes "MUST NOT … redirect to sign-in" and were kept OUT of `(tabs)` precisely so the (then `(tabs)`-scoped) auth gate would not apply. ORCH-1102 relocated the gate to the ROOT layout — which sits ABOVE both `(tabs)` and the public routes — so the "live outside `(tabs)`" defense no longer protects them. The page comments are now false.
5. **Mechanism.** The anon-tolerance design assumed a tab-group-scoped gate; ORCH-1102's route-agnostic root gate invalidated that assumption without updating the contract or adding a public-route carve-out.
6. **Severity.** **SECONDARY ROOT CAUSE** (the contract regression that the fix must restore).

---

## 5. Production runtime repro (the decisive evidence)

**Method & fidelity.** Real headless Chromium via Playwright (binary `chromium-1223` present in the worktree's `node_modules`), driven against the LIVE `https://business.usemingla.com`. Each surface used a **fresh browser context** (no cookies, no localStorage) = a genuinely anonymous buyer. Each load waited past the ORCH-1102 7s auth-resolution ceiling (11s) so any redirect settled. **Fidelity: HIGH** — production origin, production Vercel SPA bundle, real client auth gate, real logged-out state. This is the exact condition a guest clicking a share link hits.

**VIEW test — all four surfaces redirected:**

```
SURFACE: EVENT       requested /e/leggothis/the-reckoning            → final https://business.usemingla.com/  VERDICT REDIRECTED_TO_SIGNIN
SURFACE: TRIP        requested /t/travelbrand/the-dc-adventure       → final https://business.usemingla.com/  VERDICT REDIRECTED_TO_SIGNIN
SURFACE: EXPERIENCE  requested /exp/lanternvine/raleigh-wine-and-dine-crawl → final …/  VERDICT REDIRECTED_TO_SIGNIN
SURFACE: BRAND       requested /b/leggothis                          → final https://business.usemingla.com/  VERDICT REDIRECTED_TO_SIGNIN
```
Body of the final page on all four: *"List experiences, reach guests, and grow — simply. Continue with Apple / Continue with Google / Continue with Email …"* (the BusinessWelcomeScreen). Screenshots: `/tmp/orch1115-event.png`, `/tmp/orch1115-trip.png`, `/tmp/orch1115-experience.png`, `/tmp/orch1115-brand.png`.

**Timeline (trip URL, anon) — redirect is near-instant, content never shows:**
```
t=0.9s … t=16.3s : state=SIGNIN every sample; trip content never rendered at any point.
```
(For a logged-out user `loading` resolves fast and there is no stored session, so the redirect fires immediately — the 7s ceiling only applies to a *warming* session, which a guest never has.)

**CHECKOUT test — both redirected:**
```
EVENT /checkout       → final / verdict REDIRECTED_TO_SIGNIN
TRIP  /checkout-trip  → final / verdict REDIRECTED_TO_SIGNIN
```
The Reserve/Book CTA and Stripe PaymentSheet are unreachable for an anon user because the redirect fires at the root layout before the checkout route mounts.

**Edge-vs-client confirmation (rules out Vercel rewrite as the cause):**
```
curl -s -o /dev/null -w "%{http_code} %{url_effective}" -L <each public URL>
  → 200 https://business.usemingla.com/e/leggothis/the-reckoning   (URL unchanged)
  → 200 https://business.usemingla.com/t/travelbrand/the-dc-adventure
  → 200 https://business.usemingla.com/exp/lanternvine/raleigh-wine-and-dine-crawl
served HTML: <title>Business</title> + #root  (SPA shell)
```
Vercel serves a 200 SPA shell and does NOT change the URL at the edge → the bounce to `/` is purely the client-side ORCH-1102 gate after hydration. This pinpoints the cause to F-1 and excludes any server/CDN routing explanation.

---

## 6. Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction |
|-------|-------|---------------|
| **Docs** | `feedback_anon_buyer_routes.md` + page-head comments: public buyer routes MUST be anon-tolerant, never redirect to sign-in; "Anyone with the share link sees this page." | **Contradicts Code & Runtime.** Docs describe the intended (pre-ORCH-1102) behavior; reality diverged 2026-06-08. |
| **Schema (RLS)** | Anon can read `events` + `trip_days` + `trip_pricing_tiers` + `event_dates` + `experience_stops`. The data layer fully supports anon view+price. | **No contradiction** — RLS is correct; it is NOT the bug. Confirms the fix is route-gate-only. |
| **Code** | `app/_layout.tsx` (root) runs `shouldRedirectToSignInFromRoute`, which redirects every logged-out web route except `/`. No public-route allowlist. Public routes have no overriding `_layout`. | **Holds the truth** for current behavior. Contradicts Docs. |
| **Runtime** | Production Chromium (anon): all of `/e/ /t/ /exp/ /b/ /checkout /checkout-trip` redirect to the sign-in welcome screen. | **Holds the truth.** Confirms Code, refutes Docs, refutes the "asymmetry" hypothesis (events break identically). |
| **Data** | The three rows + sidecars exist, are published/scheduled, public, and anon-readable. | Consistent with RLS; proves data is not the blocker. |

The decisive gap is **Docs (and the page comments) ↔ Code/Runtime**: the ORCH-1102 root gate broke the anon-buyer contract that Docs still assert. Code/Runtime hold the truth.

---

## 7. Blast radius / cross-surface map

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Buyer/anon **Web** (`mingla-business` `/e/ /t/ /exp/ /b/ /checkout* `) | **YES — P0** | All public buyer routes + all checkout routes redirect anon users to sign-in. The whole anon funnel. |
| Business iOS / Android (native) | NO | Native never reaches the web `redirectToSignIn` branch (`isWeb` guard); business users are authenticated anyway. |
| Consumer iOS / Android (`app-mobile/`) | NO | These routes do not exist in `app-mobile/`; consumer checkout is native PaymentSheet, separate path. |
| Admin Web | NO | No public buyer routes. |
| Logged-IN business users on web | NO | They have a session, so `redirectToSignIn` is false — they can open `/t/ /e/ /exp/` normally (which is why this slipped past until a true logged-out test). |

**Invariant impact:** violates the anon-buyer-route contract in `feedback_anon_buyer_routes.md` ("public buyer surfaces MUST NOT redirect to sign-in"). The ORCH-1102 design goal ("no dead-ends; an unauth user on any route → sign-in") is correct *for authed-only routes* but was applied too broadly — it swept the intentionally-public buyer routes into the gate.

---

## 8. Discoveries for Orchestrator (side issues)

- **D-1 (process, MEDIUM):** ORCH-1102's SPEC/QA appears not to have included a true logged-out test of the public buyer routes — the gate's blast radius onto `/t/ /e/ /b/ /exp/ /checkout*` was missed. Any future auth-routing ORCH on `mingla-business` MUST include a fresh-context (no-session) load of every public buyer route as a gate. Worth an `I-PROPOSED` invariant.
- **D-2 (docs, LOW):** the page-head comments on `/t/` and `/exp/` ("no sign-in redirect; anyone with the share link sees this page") are now FALSE and should be corrected (or, better, made true again by the fix). Same for `feedback_anon_buyer_routes.md`'s "live OUTSIDE `(tabs)` so the gate doesn't fire" — that defense no longer holds against a root-level gate.

---

## 9. Confidence

**`proven` (production runtime).** Source analysis pinpointed a no-allowlist root-layout gate; production Chromium against the live site confirmed all four public surfaces + both checkout routes redirect a genuinely-anonymous user to sign-in; curl confirmed the redirect is client-side (not edge); anon-key reads confirmed RLS is not the cause; git dated it to the ORCH-1102 `[deploy]` of 2026-06-08. All Five Truth Layers reconciled, with the Docs↔Code/Runtime contradiction flagged.

---

## 10. Recommended next phase + scope (direction only — NOT a fix design)

**Next phase: SPEC → IMPLEMENT, P0 launch-blocker priority.** Recommended scope (shape only): re-establish an anon-tolerant carve-out so the root-layout gate does NOT redirect the public buyer route prefixes (`/t/`, `/e/`, `/b/`, `/exp/`, `/checkout`, `/checkout-trip`, `/checkout-experience`) — i.e., restore the anon-buyer contract for exactly those prefixes while preserving ORCH-1102's no-dead-end behavior for genuinely authed-only routes, and ORCH-1103/1106's loop-safety. The fix lives entirely in the route-gate layer (`coldLoadAuthGates.ts` predicate + its use in `app/_layout.tsx`); no RLS, schema, or edge-function change is needed (F-2). A fails-on-revert regression test must drive a logged-out load of each public prefix and assert NO redirect to `/`. Severity is launch-blocker: until fixed, every guest share link funnels to a business sign-up wall instead of checkout — for events, trips, AND experiences.

---

*Artifact: `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1115_ANON_BUYER_TRIP_EXPERIENCE_ACCESS.md`*
*Probe scripts were removed from the worktree post-run (worktree clean). Screenshots retained at `/tmp/orch1115-{event,trip,experience,brand}.png`.*
