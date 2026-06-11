# IMPLEMENTATION — ORCH-1115 [anon-buyer web funnel restored — public buyer routes must not redirect logged-out users to sign-in]

- **Mode:** IMPLEMENT (mingla-implementor). Executes the binding SPEC verbatim.
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1115-[anon-buyer-access]/` · branch `ORCH-1115-anon-buyer-access` (HEAD even with `origin/main` at start; rebase was a no-op — branch up to date).
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1115_ANON_BUYER_WEB_FUNNEL.md`
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1115_ANON_BUYER_TRIP_EXPERIENCE_ACCESS.md`
- **Date:** 2026-06-11
- **Fix commit:** `551f1749ec9a88f8b477b3e61caedb5864d1dd14`
- **Status:** implemented and verified (source/unit layer). Runtime web drive (T-A1/T-A2) is the tester's gate per SPEC §11.

---

## 1. Summary (plain English)

ORCH-1102 moved the logged-out "send them to sign-in" redirect to the root layout that wraps **every** page, with no carve-out for the intentionally-public buyer pages. So a logged-out person opening a share link (`/e/ /t/ /b/ /exp/`), a guest checkout (`/checkout* /checkout-trip/ /checkout-experience/`), or a post-purchase receipt / emailed cancel link (`/o/ /booking/`) got bounced to the business sign-in wall instead of seeing the page.

This change adds a single source-of-truth allowlist (`PUBLIC_BUYER_ROUTE_PREFIXES`) plus a segment-safe matcher (`isPublicBuyerRoute`) to `coldLoadAuthGates.ts`, and ANDs `!isPublicBuyerRoute(pathname)` into **both** the web redirect decision (`shouldRedirectToSignInFromRoute`) and the native redirect path (`nativeRedirectToSignIn` in `app/_layout.tsx`). The new clause can only ever turn a redirect **OFF** on a public route — it never creates a redirect that did not already fire, so every authed-only route still bounces a logged-out user exactly as before. Frontend route-gate layer only; no RLS / schema / edge / Vercel change.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1-Web | Public share pages (`/e/ /t/ /b/ /exp/`) render for logged-out guest; URL stays the route | ✓ predicate-verified (unit) | T-1 in test, fix `551f1749`. Runtime render = tester T-A1. |
| SC-2-Web | Guest checkout (`/checkout/ /checkout-trip/ /checkout-experience/`) reachable logged-out | ✓ predicate-verified (unit) | T-1 (incl. `/checkout/abc/payment`, `/checkout-trip/.../buyer`), `551f1749`. Runtime = tester T-A1. |
| SC-3-Web | Receipt `/o/` + cancel `/booking/` render logged-out (OQ-1 INCLUDED per orchestrator) | ✓ predicate-verified (unit) | T-1 (`/o/order-77`, `/booking/order-77/cancel`), `551f1749`. |
| SC-4-Web | Authed-only route (`/account`, `/(tabs)/…`, `/brand/…`, +12 more) STILL redirects logged-out | ✓ verified (unit) | T-2 (15 authed routes → `true`), `551f1749`. |
| SC-5-Web | Logged-IN user on a public route still renders (unchanged) | ✓ verified (unit) | T-6, `551f1749`. |
| SC-6-Web | No hydration flash — warming session shows spinner, not flash-redirect (Constitution #14) | ✓ verified (unit) + code-preserved | T-7; `authResolving` spinner branch + ceiling untouched (diff shows no edit to those branches). |
| SC-7 | `shouldRedirectToSignInFromRoute` false on every public prefix, true on authed; `isPublicBuyerRoute` segment-safe (`/checkouter` ≠ `/checkout/`) | ✓ verified (unit) | T-1/T-2/T-3/T-4/T-5, `551f1749`. |
| SC-8 | Single source of truth — one exported constant; web + native both consult `isPublicBuyerRoute`; no second hardcoded list | ✓ verified (unit + structural grep) | T-9 (constant defined exactly once; `_layout.tsx` references `isPublicBuyerRoute`), `551f1749`. |

All criteria with a runtime dimension (SC-1/2/3 render) are unit-proven at the predicate layer here; the SPEC routes the fresh-context browser render proof (T-A1/T-A2) to the tester (§11). Source-only is labelled "predicate-verified", not "render-proven", per the cap-at-suspected rule for runtime-routing.

---

## 3. Files changed (diff vs `origin/main`, 5 files, +378 / −13)

| File | Δ | Nature |
|------|---|--------|
| `mingla-business/src/utils/coldLoadAuthGates.ts` | +93/−2 | NEW `PUBLIC_BUYER_ROUTE_PREFIXES` constant + `isPublicBuyerRoute` helper + JSDoc; AND-clause into `shouldRedirectToSignInFromRoute` + its JSDoc. |
| `mingla-business/app/_layout.tsx` | +23/−2 | import `isPublicBuyerRoute`; AND it into `nativeRedirectToSignIn`; ORCH-1102 comment block notes the ORCH-1115 allowlist. No web call-site edit (already passes `pathname`). |
| `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | +8/−1 | head-comment correction ONLY (Discovery D-2). |
| `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` | +8/−2 | head-comment correction ONLY (Discovery D-2). |
| `mingla-business/src/utils/__tests__/orch_1115_anon_buyer_route_allowlist.test.ts` | +256 (new) | T-1..T-9 regression suite. |

Diff vs `origin/main` is EXACTLY these 5 files — no out-of-scope residue. All committed in `551f1749` on branch `ORCH-1115-anon-buyer-access`.

---

## 4. Data-model changes applied

**NONE.** No migration, no table/column/constraint/index/RLS change. SPEC §2 + F-2 proved anon RLS already reads every offering + sidecar table. `supabase/` untouched.

---

## 5. Edge functions touched

**NONE.** No edge function or `_shared/` change. No `verify_jwt` value altered. (This ORCH is a pure client route-gate fix.)

---

## 6. Regression tests added

- **Path:** `mingla-business/src/utils/__tests__/orch_1115_anon_buyer_route_allowlist.test.ts`
- **Count:** 85 test cases across T-1..T-9 (16 public-route samples × happy, 15 authed-route guards, segment-safety, trailing-slash, null/empty, logged-in, warming, `/` loop guard, single-source structural).
- **Result with fix present:** `Test Suites: 1 passed, 1 total · Tests: 85 passed, 85 total`.

### Fails-on-revert proof (true line deletion, NOT comment-out)

Deleted the `&& !isPublicBuyerRoute(pathname)` line from `shouldRedirectToSignInFromRoute` in `coldLoadAuthGates.ts` and re-ran:

```
FAIL src/utils/__tests__/orch_1115_anon_buyer_route_allowlist.test.ts
  ORCH-1115 T-1 (happy) — logged-out guest on a PUBLIC buyer route is NOT redirected
    ✕ /e/travelbrand → shouldRedirectToSignInFromRoute === false
    ✕ /t/travelbrand/the-dc-adventure → ...
    ✕ /checkout/abc123/payment → ...
    ✕ /o/order-77 → ...
    ✕ /booking/order-77/cancel → ...   (all 16 public samples flip true → FAIL)
  ORCH-1115 T-2 (guard)
    ✕ the web predicate ANDs in the public-route exemption (structural grep)
  ORCH-1115 T-2 (guard) — AUTHED-only route STILL redirects
    ✓ /account → true   (all 15 authed routes STAY passing)
Tests:       17 failed, 68 passed, 85 total
```

T-1 (public) FAILS, T-2 behavioral (authed) STAYS PASSING — exactly as SPEC §9 predicts, proving the allowlist is what suppresses the redirect, not a blanket behavior change. Fix restored; re-ran → `85 passed, 85 total`.

**fails-on-revert verified at `551f1749ec9a88f8b477b3e61caedb5864d1dd14`.**

### Existing-suite non-regression

`orch_1103_signout_redirect_loop.test.ts` + `orch1100ColdLoadAuthGates.test.ts` re-run alongside the new file: `Test Suites: 3 passed · Tests: 122 passed`. ORCH-1102/1103/1106 contracts intact.

---

## 7. Old → New receipts

### `mingla-business/src/utils/coldLoadAuthGates.ts`
- **Before:** `shouldRedirectToSignInFromRoute = shouldRedirectToSignIn({...}) && !isSignInRoute(pathname)`. No concept of a public buyer route; every non-`/` web route redirected a logged-out user.
- **Now:** adds `PUBLIC_BUYER_ROUTE_PREFIXES` (9 prefixes, single source of truth) + `isPublicBuyerRoute` (pure, RN-import-free, segment-safe via `base + "/"` boundary). Predicate is now `… && !isSignInRoute(pathname) && !isPublicBuyerRoute(pathname)` — public routes are exempted.
- **Why:** SC-1/2/3/7/8; restores `feedback_anon_buyer_routes.md` contract. The new clause only flips `true`→`false` on a public route (SC-4 preserved).
- **Lines:** +91 / −2.

### `mingla-business/app/_layout.tsx`
- **Before:** `nativeRedirectToSignIn = !isWeb && !loading && user === null && !isSignInRoute(pathname)`. Web path already calls `shouldRedirectToSignInFromRoute({...pathname})` (no edit needed there).
- **Now:** imports `isPublicBuyerRoute`; `nativeRedirectToSignIn` also ANDs `&& !isPublicBuyerRoute(pathname)` so the exemption lives in ONE shared helper (SC-8). The web call site is unchanged — `shouldRedirectToSignInFromRoute` now returns `false` on public routes so the deferred `<Redirect href="/" />` no longer fires for a guest there. ORCH-1102 comment block annotated with the ORCH-1115 exception.
- **Why:** SC-1/2/3 (web render via existing call site) + SC-8 (single source of truth, native consults it too). NO-OP on native today (business native serves none of these routes) — pinned by T-9/T-2.
- **Lines:** +21 / −2. `authResolving` spinner branch, `authResolutionExpired` ceiling, module-level deadline anchor, `atSignInRoute` guards — all UNEDITED (Constitution #14 + ORCH-1106 preserved).

### `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` + `app/exp/[brandSlug]/[experienceSlug].tsx`
- **Before:** head comment claimed "no useAuth, no sign-in redirect … anyone with the share link sees this page" + "Lives OUTSIDE app/(tabs)/" as the defense — which became FALSE once ORCH-1102 moved the redirect to the root layout (Discovery D-2).
- **Now:** comment states the no-sign-in-redirect guarantee is enforced at the root layout by `PUBLIC_BUYER_ROUTE_PREFIXES` (ORCH-1115), and that living outside `(tabs)` is no longer sufficient on its own.
- **Why:** SPEC §4.3 (doc-only; zero behavior change). The `orch-strict-grep-allow safearea-on-fullscreen-routes` comment + all code preserved verbatim.
- **Lines:** +8/−1 (trip), +8/−2 (exp). Doc-only.

---

## 8. Cross-surface impact

| # | Surface | Affected | User-visible change | Parity |
|---|---------|----------|---------------------|--------|
| 1 | Consumer iOS | NO | routes don't exist in `app-mobile/` | — |
| 2 | Consumer Android | NO | same | — |
| 3 | **Buyer / anonymous Web** | **YES (P0)** | logged-out guest on a public buyer route renders the page; URL stays the route, not `/` | automatic (shared gate) |
| 4 | Business iOS | NO (no-op refactor) | native redirect helper now consults `isPublicBuyerRoute`; no native public route exists → zero behavior change (T-2/T-9 pin it) | automatic (shared helper) |
| 5 | Business Android | NO (no-op refactor) | same as #4 | automatic |
| 6 | Admin Web | NO | separate app, no public buyer routes | — |
| 7 | Business Web preview | YES (same bundle) | identical to #3 | automatic |

Only surface with a user-visible behavior change: **Buyer/anonymous Web (#3)**.

---

## 9. Smoke / gate result

- **Jest (touched + related):** `3 passed, 122 passed` (`orch_1115_*`, `orch_1103_signout_redirect_loop`, `orch1100ColdLoadAuthGates`).
- **Jest (new file alone):** `85 passed, 85 total`.
- **Fails-on-revert:** verified by true line deletion → `17 failed`; restored → `85 passed`. At `551f1749`.
- **tsc --noEmit:** ZERO errors in any of the 5 touched files. Remaining tsc errors all pre-existing and unrelated (`packages/phone-input/*`, `app/checkout/[eventId]/buyer.tsx`, `app/checkout-trip/.../buyer.tsx` — none in my branch diff vs origin/main).
- **strict-grep gates run:** `orch-1105-layout-no-self-redirect.mjs` PASS (loop guard intact), `orch-1105-no-route-stub-gates.mjs` PASS, `i-proposed-tr2-safearea-on-fullscreen-routes.mjs` exit 0 (my two route files NOT flagged; pre-existing `support/[ticketId].tsx` etc. violations are unrelated). `i-proposed-n-transitional-exit-condition` N/A (no `[TRANSITIONAL]` added).
- **Runtime web drive (T-A1/T-A2):** NOT run here — owned by the tester per SPEC §11 (fresh-context Playwright load of `/t/ /e/ /exp/ /checkout-trip/` render + URL-not-sign-in, and `/account` must-still-redirect, against the MERGED build).

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- Runtime render proof (the page actually mounts content for a logged-out browser) is deferred to the tester per SPEC §11 — the predicate truth is proven here; source-only render is capped at "suspected" for a runtime-routing bug, so I do not claim render-proven.
- OQ-2 (`/auth*`) and OQ-3 (`usePathname` shape) are out of scope per SPEC §10; not touched.

---

## 11. Operator action required

- **Migration `db push`:** NONE (no migration).
- **Edge-fn deploy:** NONE (no edge function touched).
- **Deploy:** web-only (Vercel) on merge — no OTA, no edge, no migration, per SPEC §11.
- **Next phase:** route to mingla-tester for T-A1/T-A2 (fresh-context Playwright drive against the merged build), then orchestrator CLOSE (flip I-PROPOSED-1115 ACTIVE; retire the stale `feedback_anon_buyer_routes.md` "lives outside (tabs)" defense note per D-2).

---

## 12. Discoveries for Orchestrator

- **D-pre-existing-1 (tsc):** `mingla-business` has pre-existing strict-mode tsc errors unrelated to this ORCH — implicit-`any` parameters in `app/checkout/[eventId]/buyer.tsx`, `app/checkout-trip/[tripEventId]/buyer.tsx`, and missing-`react`-module errors in `packages/phone-input/*`. Not in my lane (my branch diff vs origin/main is exactly the 5 SPEC files). Flag for a typecheck-hygiene ORCH if desired.
- **D-pre-existing-2 (strict-grep TR2):** `i-proposed-tr2-safearea-on-fullscreen-routes.mjs` reports 12 pre-existing safearea violations (e.g. `app/support/[ticketId].tsx`) — none mine, gate exits 0. Flag if the orchestrator wants the soft-warnings cleaned.
- **Comms ledger:** read on entry; no OPEN BLOCK row targets ORCH-1115 / implementor / ALL. The OPEN rows are WARN-level backend/external-API entries addressed to other ORCHs — N/A to this frontend route-gate change (acked as factored per dispatch). No new cross-ORCH discovery written this turn.

---

*Artifact: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1115_ANON_BUYER_WEB_FUNNEL.md`*
