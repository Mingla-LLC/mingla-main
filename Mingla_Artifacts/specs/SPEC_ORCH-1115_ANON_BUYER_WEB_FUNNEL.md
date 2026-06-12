# SPEC — ORCH-1115 [anon-buyer web funnel restored — public buyer routes must not redirect logged-out users to sign-in]

- **Mode:** SPEC (forensics). Binding contract for the implementor.
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1115-[anon-buyer-access]/` · branch `ORCH-1115-anon-buyer-access` (HEAD even with `origin/main`).
- **Date:** 2026-06-11
- **Source investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1115_ANON_BUYER_TRIP_EXPERIENCE_ACCESS.md` (`proven`, production Chromium).
- **Priority:** P0 — LAUNCH BLOCKER. The entire anonymous share-link → checkout funnel on `business.usemingla.com` bounces guests to a business sign-in wall.
- **Comms ledger:** read on entry; no `BLOCK`/`OPEN` row targets ORCH-1115, forensics, or `ALL`. No new cross-ORCH discovery written this turn.

---

## 1. Executive summary

ORCH-1102 (shipped 2026-06-08, PR #414) moved the unauthenticated "no dead-end" sign-in redirect from a route-list / `(tabs)`-scoped gate to the **root layout** (`mingla-business/app/_layout.tsx`), which wraps EVERY route. The redirect decision (`shouldRedirectToSignInFromRoute` in `coldLoadAuthGates.ts`) has **no allowlist** for the intentionally-public buyer routes. Result, proven on production with a fresh logged-out browser: `/e/…`, `/t/…`, `/b/…`, `/exp/…`, `/checkout/…`, `/checkout-trip/…`, `/checkout-experience/…` all redirect a guest to the business welcome/sign-in screen; the buyer page and checkout never render. RLS is fully permissive to anon (proven) — this is **purely a client route-gate bug**.

This SPEC restores the anon-buyer contract (`feedback_anon_buyer_routes.md`) by adding a **single-source-of-truth public-buyer-route allowlist** to `coldLoadAuthGates.ts` and ANDing it into the redirect predicate, so a logged-out user on a public buyer route is NOT redirected and the page renders — while EVERY authed-only route still redirects (ORCH-1102 preserved) and the `/` self-redirect loop guard (ORCH-1103) and the deadlock ceiling (ORCH-1106) remain intact. **Frontend-only, route-gate layer only. No RLS / schema / edge-function change.**

---

## 2. Scope & non-goals

### In scope
1. Add an exported, single-source-of-truth public-buyer-route prefix list + matcher helper to `mingla-business/src/utils/coldLoadAuthGates.ts`.
2. Modify the existing `shouldRedirectToSignInFromRoute` predicate so it returns `false` (no redirect) when the current pathname matches a public-buyer prefix — for the WEB redirect path only.
3. Apply the same allowlist exemption to the **native** unauthenticated redirect computed inline in `app/_layout.tsx` (`nativeRedirectToSignIn`) so the helper is the one place public-route exemption is decided (defensive — native does not serve these routes today, but the exemption must not be web-only-duplicated logic; see §4 Component layer).
4. Add a fails-on-revert regression test extending the existing `coldLoadAuthGates` unit-test pattern.
5. Correct the now-false page-head comments on the public routes that assert "no sign-in redirect" (Discovery D-2), to point at the restored guarantee (documentation-only edit, no behavior change).

### Out of scope (explicit non-goals)
- **NO RLS / schema / migration / edge-function change.** Investigation F-2 proved anon RLS already reads every offering + sidecar table; the data layer is correct. DO NOT touch it.
- **NO widening the gate for authed-only routes.** The allowlist is PUBLIC-BUYER-ONLY. `/(tabs)/*` (home/hub), `/account*`, `/brand/*`, `/event/*`, `/trip/*`, `/experience/*`, `/venue/*`, `/partner/*`, `/ari*`, `/support*`, `/notifications`, `/connect-*`, `/accept-*`, `/stripe-onboarding-return` MUST continue to redirect a logged-out user. (See §2-table below.)
- **NO change to the `/` self-redirect loop guard (ORCH-1103) or the auth-resolution ceiling / deadlock backstop (ORCH-1102 Wave 2 / ORCH-1106).** Those branches are preserved verbatim; the allowlist composes BEFORE them in the predicate, not around them.
- **NO change to `/auth*` (OAuth callback) gating in this ORCH.** `/auth/callback` is the sign-in completion flow, not a buyer route. The investigation did not scope it. (Flagged as Open Question OQ-2 — do not silently include it.)
- **NO native-app code path change in behavior** beyond routing the public-route exemption through the shared helper (`app-mobile/` untouched; business native does not serve these routes).
- **NO Vercel / `vercel.json` / OG / `.well-known` change.** Those assets (`/og/*`, `/.well-known/*`, `/auth/callback.html`, `/stripe-onboarding-return.html`) are served by Vercel statically/serverless and **never route through the client SPA gate** — they are already exempt at the edge (verified in `vercel.json`). No allowlist entry is needed for them; adding one would be dead code.

### Assumptions
- Expo Router `usePathname()` returns a leading-slash, decoded pathname WITHOUT query string (e.g. `/t/travelbrand/the-dc-adventure`, `/checkout/abc123`). The matcher operates on this shape (prefix match on the pathname only). `cleanUrls: true` + `trailingSlash: false` in `vercel.json` means no trailing slash in production; the matcher tolerates a single trailing slash defensively anyway (mirrors `isSignInRoute`).
- A genuinely logged-out guest has no stored web session → `loading` resolves fast, `authResolving` is false, and the redirect branch is the one that fires today. The allowlist must short-circuit that branch.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | **NOT covered** | n/a — these routes do not exist in `app-mobile/`; consumer checkout is native PaymentSheet. | none | — |
| 2 | Consumer Android (`app-mobile/` Android) | **NOT covered** | same reason as #1. | none | — |
| 3 | **Buyer / anonymous Web** (`mingla-business/` `/e/ /t/ /b/ /exp/ /checkout* /o/ /booking/*`) | **YES — P0** | A logged-out browser on any public buyer route renders the page (and can proceed through checkout); the URL does NOT become the sign-in route. | `src/utils/coldLoadAuthGates.ts`, `app/_layout.tsx`, public-route head comments, new test file | automatic (shared gate) |
| 4 | Business iOS | **NOT covered (no behavior change)** | Business native never reaches the web redirect branch (`isWeb` guard); the native redirect helper change is a no-op (these routes are not served on native). | `app/_layout.tsx` (helper routing only) | automatic (shared helper) |
| 5 | Business Android | **NOT covered (no behavior change)** | same as #4. | (shared) | automatic |
| 6 | Admin Web (`mingla-admin/`, adjacent) | **NOT covered** | no public buyer routes; separate app. | none | — |
| 7 | Business Web preview (adjacent) | **YES (same bundle)** | identical to #3 — same `mingla-business` web bundle. | (shared) | automatic |

**HARD GATE:** the ONLY surface with a user-visible behavior change is **Buyer/anonymous Web (#3)**. Native business apps (#4/#5) get a no-op refactor of WHERE the public-route exemption is decided, with zero behavior change (proven by the native test in §7).

---

## 4. Layered specification

This change touches exactly TWO code layers: a pure predicate utility, and the root layout that consumes it. No DB, edge, service, hook, or realtime layer is involved.

### 4.1 Utility layer — `mingla-business/src/utils/coldLoadAuthGates.ts`

**4.1.1 NEW exported constant — `PUBLIC_BUYER_ROUTE_PREFIXES`.**

A single, exported, readonly array of pathname prefixes that are anon-tolerant public buyer routes. This is the **single source of truth** (Dispatch requirement #3). Future public routes are added here and ONLY here.

The prefix set (each is matched as a path-segment prefix — see 4.1.2):

| Prefix | Route | Why public |
|--------|-------|-----------|
| `/e/` | `/e/[brandSlug]/[eventSlug]` public event page | share link |
| `/t/` | `/t/[brandSlug]/[tripSlug]` public trip page | share link |
| `/b/` | `/b/[brandSlug]` public brand page | share link |
| `/exp/` | `/exp/[brandSlug]/[experienceSlug]` public experience page | share link |
| `/checkout/` | `/checkout/[eventId]/…` event checkout | guest purchase |
| `/checkout-trip/` | `/checkout-trip/[tripEventId]/…` trip checkout | guest purchase |
| `/checkout-experience/` | `/checkout-experience/[experienceEventId]/…` experience checkout | guest purchase |
| `/o/` | `/o/[orderId]` buyer order receipt (post-purchase) | shareable receipt; explicitly anon-tolerant per its own head comment + I-21 |
| `/booking/` | `/booking/[orderId]/cancel` buyer cancel-from-email | anon-buyer-tolerant per `feedback_anon_buyer_routes.md` |

> **Why `/o/` and `/booking/` are included** (reconciliation requirement, Dispatch #1): both are part of the SAME anon-buyer-route class the investigation identified — their own source head comments declare them "ANON-TOLERANT … MUST NOT call useAuth or redirect to sign-in" (`/o/[orderId].tsx` per I-21) and "Anon-buyer-tolerant per feedback_anon_buyer_routes.md. NO useAuth, NO sign-in redirect" (`/booking/[orderId]/cancel.tsx`). They are ALSO swept into the ORCH-1102 root gate today and would redirect a logged-out buyer arriving at a receipt or an emailed cancel link weeks post-purchase. Including them is completing the identified contract class, not widening scope. **This decision is surfaced for ratification in OQ-1; if the orchestrator rules them out, drop only those two rows — the matcher and everything else stay.**

**4.1.2 NEW exported helper — `isPublicBuyerRoute(pathname: string | null | undefined): boolean`.**

Pure, RN-import-free (same discipline as the rest of the file so it is node-jest-unit-testable and fails-on-revert).

Matching logic (prefix match on pathname, segment-safe):
- `null` / `undefined` / empty / whitespace-only → `false` (a missing pathname is NOT a public route; it falls through to the existing `isSignInRoute`-driven behavior, which treats empty as `/`).
- Trim; strip a single trailing slash for `length > 1` (mirror `isSignInRoute` normalization) so `/checkout/` and `/checkout` both behave; do not strip the root `/`.
- Return `true` iff the normalized pathname **equals a prefix with the trailing slash removed** (e.g. `/checkout`) OR **starts with the full prefix** (e.g. `/checkout/abc`). This MUST be segment-safe: `/checkout/x` matches `/checkout/` but a hypothetical `/checkouter` MUST NOT match (guard by requiring the char after the prefix-minus-slash to be `/` or end-of-string). Equivalent phrasing: for each prefix `P` (e.g. `/checkout/`), let `base = P` without its trailing slash (`/checkout`); match when `normalized === base` OR `normalized.startsWith(base + "/")`.
- This makes the matcher robust to the `[brandSlug]/[slug]` and `[eventId]/buyer|payment|confirm` sub-paths under each checkout route.

> Illustrative shape only (≤3 lines, NOT an implementation):
> ```ts
> export const PUBLIC_BUYER_ROUTE_PREFIXES = ["/e/","/t/","/b/","/exp/","/checkout/","/checkout-trip/","/checkout-experience/","/o/","/booking/"] as const;
> // isPublicBuyerRoute: normalize pathname, then for each prefix P with base=P.slice(0,-1): return normalized===base || normalized.startsWith(base + "/")
> ```

**4.1.3 MODIFY `shouldRedirectToSignInFromRoute`.**

Add the public-route exemption as an ADDITIONAL AND-clause, composed BEFORE the existing decision so the existing ORCH-1102 + ORCH-1103 logic is untouched:

`shouldRedirectToSignInFromRoute = shouldRedirectToSignIn({...}) && !isSignInRoute(pathname) && !isPublicBuyerRoute(pathname)`

- The new clause ONLY ever flips a `true` to `false` (suppresses a redirect on a public route). It can NEVER cause a redirect that did not already fire. This bounds the blast radius: no authed-only route's behavior can change.
- `isSignInRoute` and `shouldRedirectToSignIn` are NOT modified.
- Update the JSDoc above the function to name ORCH-1115 and the allowlist (cite `PUBLIC_BUYER_ROUTE_PREFIXES`).

**Error contract:** pure function, total over its inputs, returns `boolean`, never throws. No change to the `isWeb`/`loading`/`hasUser`/`hasStoredWebSession`/`pathname` parameter shape (additive logic only — preserves all existing callers and tests).

### 4.2 Layout layer — `mingla-business/app/_layout.tsx`

**4.2.1 WEB redirect path — `redirectToSignIn` (line ~307–313).** No change required at the call site: it already calls `shouldRedirectToSignInFromRoute({ ..., pathname })`, which now returns `false` on public routes. The deferred `if (redirectToSignIn) return <Redirect href="/" />` (line ~568) therefore no longer fires for a logged-out guest on a public buyer route → the Stack mounts and the page renders. **VERIFY at IMPLEMENT** the call site still passes `pathname` (it does today, line ~312).

**4.2.2 NATIVE redirect path — `nativeRedirectToSignIn` (line ~329–330).** Today this is computed inline as `!isWeb && !loading && user === null && !isSignInRoute(pathname)`. To keep the public-route exemption in ONE place (Dispatch #3 single-source-of-truth) and to harden against a future native public-route, AND-in the same helper: `… && !isSignInRoute(pathname) && !isPublicBuyerRoute(pathname)`. This is a **no-op today** (business native serves none of these routes) — the native test in §7 pins that no native authed route's redirect changes. Import `isPublicBuyerRoute` alongside the existing `coldLoadAuthGates` imports (line ~76–82).

**4.2.3 Preserve verbatim:** `authResolving` spinner branch (line ~565), `authResolutionExpired` ceiling redirect (line ~557), the module-level deadline anchor (ORCH-1102 Wave 2), and the `atSignInRoute` guards. The allowlist composes inside the predicate, ABOVE these branches; none of them are edited.

**4.2.4 States (all enumerated):**
- **Logged-out + public route** (guest, no session, on `/t/…` etc.): `redirectToSignIn=false`, `authResolving=false` → falls through to `<Stack>` → page renders. ✅ (the fix)
- **Logged-out + authed route** (guest on `/account`): `redirectToSignIn=true` (allowlist miss) → `<Redirect href="/" />`. ✅ (ORCH-1102 preserved)
- **Logged-in + public route** (business owner opens own `/t/…`): `redirectToSignIn=false` (no-user check already false) → renders. ✅ (no change)
- **Logged-in + authed route**: unchanged. ✅
- **Cold-load hydration race** (stored web session warming, no user yet, on a public OR authed route): `authResolving=true` → `<AuthResolvingScreen/>` spinner; the allowlist does NOT pre-empt the spinner (the spinner branch is checked independently of `redirectToSignIn`). A warming session NEVER flash-redirects before hydration completes — Constitution #14 honored, identical to today. On a public route, once warming resolves to "no user", the allowlist then suppresses the redirect and the page renders. ✅
- **On `/`** (root): `isSignInRoute('/')=true` → no redirect (ORCH-1103 loop guard), renders BusinessWelcomeScreen. The allowlist does not list `/` and does not interfere. ✅

### 4.3 Documentation layer — public-route head comments (Discovery D-2)

Correct the now-false head comments that assert "no sign-in redirect" on:
- `app/t/[brandSlug]/[tripSlug].tsx`
- `app/exp/[brandSlug]/[experienceSlug].tsx`

Change the wording to reflect that anon-tolerance is now guaranteed by the root-layout allowlist (`PUBLIC_BUYER_ROUTE_PREFIXES` in `coldLoadAuthGates.ts`), not merely by living outside `(tabs)`. Documentation-only; no behavior change. (`/e/` and `/b/` head comments do not currently make the false claim and may be left as-is, or optionally annotated.) **Do NOT edit any other line in these route files.**

---

## 5. Success criteria (numbered, observable, testable)

All criteria are **Web-only** (the only surface with a behavior change); native parity is "no-op", verified separately.

- **SC-1-Web (render public, logged out).** A genuinely logged-out browser (no cookies, no localStorage) loading each of `/e/{brandSlug}/{eventSlug}`, `/t/{brandSlug}/{tripSlug}`, `/b/{brandSlug}`, `/exp/{brandSlug}/{experienceSlug}` on `business.usemingla.com` renders the buyer page content (not the BusinessWelcomeScreen), and the final URL is the requested route — NOT `/`.
- **SC-2-Web (reach checkout, logged out).** A logged-out browser loading `/checkout/{eventId}`, `/checkout-trip/{tripEventId}`, `/checkout-experience/{experienceEventId}` renders the checkout screen (does not redirect to `/`); the Reserve/Book CTA and the buyer→payment chain are reachable.
- **SC-3-Web (receipt + cancel, logged out).** A logged-out browser loading `/o/{orderId}` and `/booking/{orderId}/cancel?token=…` renders (subject to OQ-1 ratification).
- **SC-4-Web (authed route STILL redirects).** A logged-out browser loading a representative authed-only route (e.g. `/account`, `/(tabs)/…`, `/brand/{id}`) STILL redirects to `/` and shows the business sign-in welcome screen. The allowlist did NOT over-widen.
- **SC-5-Web (logged-in unchanged).** A logged-IN business user opening any public buyer route renders it (unchanged from today).
- **SC-6-Web (no hydration flash).** On a warming/cold-load of a public route with a stored session, the user sees the loading spinner (not a flash-redirect to `/`) until auth resolves, then the page renders. No flash-redirect before `_hasHydrated`-equivalent resolution (Constitution #14).
- **SC-7 (predicate unit truth).** `shouldRedirectToSignInFromRoute` returns `false` for a logged-out user on every prefix in `PUBLIC_BUYER_ROUTE_PREFIXES` (and representative sub-paths), and `true` for a logged-out user on a representative authed route; `isPublicBuyerRoute` is segment-safe (`/checkouter` does NOT match `/checkout/`).
- **SC-8 (single source of truth).** The allowlist exists as exactly ONE exported constant; the web predicate and the native redirect both consult it (grep finds no second hardcoded prefix list).

---

## 6. Invariants

| Invariant | Preserve / Establish | How | Verified by |
|-----------|---------------------|-----|-------------|
| Anon-buyer-route contract (`feedback_anon_buyer_routes.md`) | **RESTORE** | Public buyer routes no longer redirect anon users to sign-in. | SC-1/2/3-Web, §7 happy-path + adversarial |
| ORCH-1102 no-dead-end redirect | **PRESERVE** | The redirect still fires for every authed-only route (allowlist only suppresses public prefixes; the existing AND-clauses are unchanged). | SC-4-Web, §7 T-2/T-7 |
| ORCH-1103 `/`→`/` loop guard (React #185) | **PRESERVE** | `isSignInRoute` AND-clause untouched; the new clause composes alongside it; `/` is not in the allowlist. | existing `orch_1103_signout_redirect_loop.test.ts` must still pass; §7 T-8 |
| ORCH-1102 Wave 2 / ORCH-1106 ceiling + deadlock backstop | **PRESERVE** | `authResolutionExpired`, the module-level anchor, and `authResolving` branches are not edited. | manual code-diff review; existing `orch1100ColdLoadAuthGates.test.ts` passes |
| Constitution #14 (hydration gate before redirect) | **PRESERVE** | The `authResolving` spinner branch still runs before any redirect; the allowlist never pre-empts the spinner. | SC-6-Web |
| Constitution #1 (no dead taps / share link reaches a live page) | **RESTORE** | Share links now reach the live buyer page instead of a sign-in wall. | SC-1/2-Web adversarial drive |
| **NEW — I-PROPOSED-1115-PUBLIC-BUYER-ROUTE-ALLOWLIST (DRAFT)** | **ESTABLISH** | The root-layout unauthenticated redirect MUST exempt every prefix in `PUBLIC_BUYER_ROUTE_PREFIXES`; the list is the single source of truth and any new public buyer route MUST be added to it (and to the regression test). Flips ACTIVE on CLOSE (orchestrator owns the flip). | §7 fails-on-revert test |

---

## 7. Test cases

Unit tests extend the existing `coldLoadAuthGates` jest pattern (node env, pure predicate); the adversarial web test is a fresh-context Playwright drive (tester-owned, different angle).

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (happy) | logged-out on each public prefix | `{isWeb:true,loading:false,hasUser:false,hasStoredWebSession:false, pathname}` for each of the 9 prefixes + a representative sub-path (e.g. `/checkout/abc/payment`, `/t/brand/slug`) | `shouldRedirectToSignInFromRoute === false` for all | unit |
| T-2 (error/guard) | logged-out on authed route | same inputs, `pathname: "/account"`, `/(tabs)/home`, `/brand/123` | `shouldRedirectToSignInFromRoute === true` | unit |
| T-3 (edge) | segment-safety | `isPublicBuyerRoute("/checkouter")`, `"/exposed"`, `"/booking-x"` | `false` (must not match `/checkout/`, `/exp/`, `/booking/`) | unit |
| T-4 (edge) | trailing slash + bare | `isPublicBuyerRoute("/checkout")`, `"/checkout/")`, `"/t/")` | `true` | unit |
| T-5 (edge) | null/empty pathname | `isPublicBuyerRoute(null \| undefined \| "" \| " ")` | `false` | unit |
| T-6 (regression) | logged-IN on public route still renders | `hasUser:true`, public pathname | `false` (already false via no-user clause; pins it stays so) | unit |
| T-7 (regression) | warming session never redirects | `hasUser:false, hasStoredWebSession:true`, public + authed pathname | `false` for both (spinner branch owns this; predicate stays false) | unit |
| T-8 (regression) | `/` loop guard intact | `pathname:"/"`, logged out | `false` (ORCH-1103) — re-asserted | unit |
| T-9 (single-source) | one allowlist | grep | exactly one `PUBLIC_BUYER_ROUTE_PREFIXES` definition; native + web both reference `isPublicBuyerRoute` | structural |
| T-A1 (adversarial — TESTER) | fresh-context production-shaped browser load | Playwright, NO cookies/localStorage, load `/t/…`, `/e/…`, `/exp/…` (and `/checkout-trip/…`), wait past auth ceiling | page content renders; final URL == requested route, NOT the sign-in route; NOT BusinessWelcomeScreen body | runtime/web |
| T-A2 (adversarial — TESTER) | fresh-context load of an authed route | Playwright, no session, load `/account` | redirects to `/`, BusinessWelcomeScreen shown (proves no over-widening at runtime) | runtime/web |

> T-A1/T-A2 are the **tester's** different-angle proof: source unit truth (T-1..T-9) is capped at "suspected" for a runtime-routing bug; the fresh-context browser drive is the "proven" gate (matches the investigation's production repro method). They MUST be run against the merged build per the edge-deploy/bundle-refresh hazards.

---

## 8. Implementation order

1. **`src/utils/coldLoadAuthGates.ts`** — add `PUBLIC_BUYER_ROUTE_PREFIXES` constant + `isPublicBuyerRoute` helper (pure, RN-import-free, JSDoc'd); AND `!isPublicBuyerRoute(pathname)` into `shouldRedirectToSignInFromRoute`; update its JSDoc to cite ORCH-1115.
2. **`src/utils/__tests__/orch_1115_anon_buyer_route_allowlist.test.ts`** — NEW test file (T-1..T-9). Confirm it FAILS when the AND-clause is reverted and PASSES when restored (§9).
3. **`app/_layout.tsx`** — import `isPublicBuyerRoute`; AND it into `nativeRedirectToSignIn` (§4.2.2); verify the web call site already passes `pathname` (no edit expected there). Update the ORCH-1102 comment block to note the ORCH-1115 allowlist.
4. **`app/t/[brandSlug]/[tripSlug].tsx` + `app/exp/[brandSlug]/[experienceSlug].tsx`** — correct the false "no sign-in redirect" head comments (doc-only).
5. Run gates: `npm test` (the new file + existing `orch_1103_*` + `orch1100ColdLoadAuthGates` + `brandStripeStatusAuthGate` must all pass), typecheck, lint, any `orch-strict-grep` gate. Then hand to tester for T-A1/T-A2.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the public-route exemption lives in a single exported constant + pure helper, consumed by the redirect predicate. Reverting the `&& !isPublicBuyerRoute(pathname)` clause (or deleting the constant) re-breaks the funnel.
- **The fails-on-revert test:** `orch_1115_anon_buyer_route_allowlist.test.ts` → **T-1** asserts `shouldRedirectToSignInFromRoute` returns `false` for a logged-out user on every public prefix, and **T-2** asserts it returns `true` on a representative authed route. If the AND-clause is removed, T-1 flips to `true` and FAILS; T-2 stays `true` and PASSES — so the pair proves the allowlist is what suppresses the redirect (not a blanket behavior change). If the constant is deleted, the test file fails to compile/import — also a fail-on-revert.
- **Protective comment:** above the AND-clause and the constant, a comment naming ORCH-1115, the P0 symptom (anon share link → sign-in wall), and the rule "any new public buyer route is added HERE and to the regression test" (carries I-PROPOSED-1115).
- **Process safeguard (Discovery D-1):** the tester MUST include a fresh-context (no-session) load of every public buyer prefix as a runtime gate (T-A1) — the exact blast-radius check ORCH-1102's QA missed.

---

## 10. Open questions

- **OQ-1 (scope ratification — `/o/` + `/booking/`):** the investigation's named prefix list was `/t /e /b /exp /checkout /checkout-trip /checkout-experience`. This SPEC ALSO allowlists `/o/` (buyer receipt) and `/booking/` (cancel-from-email) because their own source declares them anon-tolerant (I-21) and they are part of the same funnel — a guest who buys then opens the receipt/cancel link would otherwise hit the same wall. **If the orchestrator/Seth wants the allowlist strictly limited to the 7 named prefixes, drop the `/o/` and `/booking/` rows only; everything else is unaffected.** Default recommendation: INCLUDE them (completes the contract).
- **OQ-2 (`/auth*`):** `/auth/callback` (OAuth completion) is gated by the same root predicate. The investigation did not scope it and it is NOT a buyer route, so it is OUT of this SPEC. If logged-out OAuth callback is observed to mis-redirect, that is a SEPARATE ORCH. Flagged so it is not silently swept in.
- **OQ-3 (`isPublicBuyerRoute` vs `usePathname` shape):** confirmed assumption that `usePathname()` yields a query-stringless, leading-slash pathname. If a future Expo Router upgrade changes this, the matcher's normalization is the single place to adjust. No action now.

---

## 11. Downstream routing

- **Next = mingla-implementor (business-web side).** Build per §4/§8 inside the worktree `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1115-[anon-buyer-access]/` on branch `ORCH-1115-anon-buyer-access`. Touch ONLY the allowlisted files (§ below). Run the gates (§8.5) and prove T-1 fails-on-revert before reporting.
- **Then = mingla-tester.** Run T-A1/T-A2 — a fresh-context Playwright drive of `/t/ /e/ /exp/ /checkout-trip/` (render + URL-not-sign-in) AND a fresh-context `/account` load (must still redirect), against the MERGED build. Source-only is capped at "suspected"; the runtime drive is the PASS gate.
- **Then = mingla-orchestrator CLOSE.** Flip I-PROPOSED-1115 ACTIVE; correct/retire the stale `feedback_anon_buyer_routes.md` "lives outside (tabs)" defense note (D-2); deploy is web-only (Vercel) — no OTA, no edge, no migration.

---

## Scoped allowlist (implementor MAY change ONLY these)

1. `mingla-business/src/utils/coldLoadAuthGates.ts` — add constant + helper + AND-clause + JSDoc.
2. `mingla-business/src/utils/__tests__/orch_1115_anon_buyer_route_allowlist.test.ts` — NEW.
3. `mingla-business/app/_layout.tsx` — import + AND-in `nativeRedirectToSignIn`; comment update. (No web call-site edit expected.)
4. `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` — head-comment correction ONLY.
5. `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` — head-comment correction ONLY.

## DO-NOT-TOUCH (stop-and-amend before editing)

- Any RLS policy, migration, edge function, or `supabase/` file (F-2 proved unnecessary).
- `shouldRedirectToSignIn`, `isSignInRoute`, `isWebAuthResolving`, `isAuthResolutionExpired`, the module-level deadline anchor in `_layout.tsx` — preserve verbatim (only COMPOSE alongside them).
- `vercel.json`, `public/.well-known/*`, `/og/*`, `/auth/*`, `public/auth/callback.html`, `stripe-onboarding-return*` — edge-served / out of scope.
- The buyer page bodies / checkout screens / hooks / services — the page render is already correct once the gate lets it mount (F-2).
- `app-mobile/` — entirely.
- The shared anchor checkout (`~/Desktop/mingla-main`).

Anything outside the allowlist requires a `SPEC_AMENDMENT_ORCH-1115_*` (or in-file amendment) before the implementor touches it.

---

*Artifact: `Mingla_Artifacts/specs/SPEC_ORCH-1115_ANON_BUYER_WEB_FUNNEL.md`*
