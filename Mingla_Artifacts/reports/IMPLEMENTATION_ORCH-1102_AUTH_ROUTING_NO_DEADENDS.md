# IMPLEMENTATION — ORCH-1102 [business-web auth routing, no dead-ends]

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1102-[business-web-auth-routing-no-deadends]/`
**Branch:** `ORCH-1102-business-web-auth-routing-no-deadends` (clean at origin/main, 0 behind)
**Device owned:** Samsung `R58R54YV7JT` (sethogieva@gmail.com, "Leggo This")
**Status:** implemented & verified (device-proven for the cancel path + artifact/test-proven for the rest; one live-render scenario blocked by an environment deadlock documented below)
**Comms ledger:** read on entry. No BLOCK-OPEN entries target this skill / ORCH-1102 / ALL. All ALL-targeted rows are historical WARN; none affect auth routing. No new cross-ORCH discovery to write.

---

## Operator intent (verbatim)

> "Remove all of it. If a user becomes unauthenticated, route them back to the sign-in screen. If a user cancels an authentication mid-process, route them back too. Users should not be left hanging — ever."

---

## Summary

- **Stubs removed?** YES — both route-stub mechanisms (`Orch1092SignedOutRecovery` dead-end card + its 5-route list, and the dormant `Orch1093MobileRouteRecovery` firewall + its empty block-list + UA sniff + resolver + type + outer pre-provider render sites) are deleted entirely.
- **Unauthenticated → sign-in?** YES, route-agnostic — any web route, once auth RESOLVES with no user, renders `<Redirect href="/" />` → the real `BusinessWelcomeScreen`. No card, no blank, no infinite spinner.
- **Cancel → sign-in?** YES — the static OAuth callback's error/empty-session path (used when the user cancels/denies in the provider sheet) now shows "Taking you back to sign in…" + a "Back to sign in" link + auto-redirect to `/`. The `BusinessWelcomeScreen` OTP mode gained a direct "Back to sign-in options" reset to idle. Google/Apple/email cancel paths already returned controls (preserved).
- **Cold-load loading preserved?** YES — the ORCH-1100 Wave 3 cold-load fix is preserved and generalized: while auth is resolving (bootstrap in flight OR a stored web session is warming) the root renders `AuthResolvingScreen` (spinner), route-agnostic, no false sign-in flash.
- **Device-proven?** PARTIAL — cancel→sign-in proven LIVE on the Samsung; the unauthenticated→sign-in/loading scenarios are blocked from live render on the local static build by an environment-specific GoTrue Web-Lock deadlock (root-caused below) and are instead proven via production live repro + shipped-bundle diff + the full predicate test suite.
- **Test evidence?** New ORCH-1102 regression suite (24 cases) + 4 updated stale suites; 64 passing; behavioral fails-on-revert proven at `e0b98615a`.

---

## Files changed — Old → New receipts

### `mingla-business/app/_layout.tsx`
**Before:** Imported `shouldShowSignedOutRecovery` (route-coupled). Declared `ORCH_1092_SIGNED_OUT_ROUTES` (5 routes), `ORCH_1100_BLOCKED_MOBILE_WEB_ROUTES` (empty firewall block-list), `Orch1093RouteStatus` type, `orch1093RouteStatus()` resolver, `isMobileWebRouteEntry()` UA sniff, `getCurrentWebPathname()`, `normalizeWebPathname()`, and two dead-end card components (`Orch1093MobileRouteRecovery`, `Orch1092SignedOutRecovery`) with an `orch1092Styles` StyleSheet. `RootLayoutInner` computed `shouldShowSignedOutRecovery` + `shouldShowMobileRouteRecovery` and deferred two card returns; the OUTER `RootLayout` ran two pre-provider card render sites keyed off the route lists.
**After:** Imports `shouldRedirectToSignIn` + `isWebAuthResolving` (route-agnostic). All route lists, the firewall machinery, the UA sniff, both card components, the pathname helpers, and the outer pre-provider checks are DELETED. `RootLayoutInner` computes `authResolving` + `redirectToSignIn` (no hooks) and defers two returns: `<AuthResolvingScreen />` (spinner) then `<Redirect href="/" />`. A minimal `AuthResolvingScreen` + `authRoutingStyles` replace the card UI. The OUTER `RootLayout` renders the provider tree directly. Removed now-unused imports (`Pressable`, `Text`, `usePathname`, the design-system token bundle → just `canvas`); added `ActivityIndicator` + `Redirect`.
**Why:** ORCH-1102 A/B/C — remove all stubs; route-agnostic unauthenticated→sign-in; preserve cold-load loading without coupling it to a route list.
**Lines changed:** ~−330 / +60 (net −270).

### `mingla-business/src/utils/coldLoadAuthGates.ts`
**Before:** Exported `shouldShowSignedOutRecovery({ isWeb, loading, hasUser, hasStoredWebSession, routeIsSignedOutGated })` — fired only for the 5 gated routes.
**After:** Replaced with two route-agnostic predicates: `shouldRedirectToSignIn({ isWeb, loading, hasUser, hasStoredWebSession })` (web + resolved + no user + no stored session → redirect) and `isWebAuthResolving({ … })` (web + no user + (loading OR stored-session-warming) → loading). `isBrandRouteResolving` + `isAccountAuthWarming` unchanged.
**Why:** ORCH-1102 B — decouple the loading-vs-signed-out decision from the route list; drop the signed-out-card branch.
**Lines changed:** ~−20 / +62.

### `mingla-business/public/auth/callback.html`
**Before:** The `run().catch(...)` error/empty-session path set "Sign-in needs another try" + "… Refresh, then sign in again." with NO action — a dead end.
**After:** Added a hidden `#action` block with a "Back to sign in" link (`href="/"`) and a `recoverToSignIn()` helper that reveals the link AND auto-redirects to `/` after 2.5s. Error copy changed to "… Taking you back to sign in…". Kept the asserted "Sign-in needs another try" title (append-only test) and `window.location.replace("/")` (success path) intact.
**Why:** ORCH-1102 D.3 — the static callback (the cancel/deny landing) must offer a path back to sign-in, not dead-end.
**Lines changed:** ~+22.

### `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx`
**Before:** In `otp-input` mode the only escapes were "Resend code" + "Wrong email? Edit" (→ email-input → "Back" → idle). No direct return to the sign-in buttons.
**After:** Added a direct "Back to sign-in options" link in `otp-input` mode wired to the existing `handleBackToIdle()` (resets `mode` to idle, clears email/otp, dismisses keyboard). The verify-error path already resets `mode` to `otp-input` (preserved).
**Why:** ORCH-1102 D.2/D.4 — a cancel mid-OTP returns to sign-in with controls usable; no permanent otp/verifying limbo.
**Lines changed:** ~+18.

### Tests (see Regression Test section for the new suite)
- `src/__tests__/orch1102AuthRoutingNoDeadEnds.test.ts` — **NEW** primary regression suite.
- `src/__tests__/orch1100ColdLoadAuthGates.test.ts` — `[TEST-MOD-APPROVED ORCH-1102]` rewrote the import + signed-out describe block to the new `shouldRedirectToSignIn`, and the `_layout` wiring test to the redirect/no-card assertions.
- `src/__tests__/orch1100FirewallHydration.test.ts` — `[TEST-MOD-APPROVED ORCH-1102]` rewrote TASK 1 to assert the firewall is GONE (block-list/resolver/UA-sniff/stub removed) instead of "block-list empty". TASK 2 (auth-lock/brand-hydration) untouched.
- `src/utils/__tests__/orch_1092_business_web_restoration_wave.test.ts` — `[TEST-MOD-APPROVED ORCH-1102]` rewrote the "bounded signed-out recovery fallback" test to assert the card/route-list/outer-stubs are GONE + the route-agnostic redirect is wired.
- `__tests__/orch1098Stage5EventCreateHooksOrder.test.ts` — `[TEST-MOD-APPROVED ORCH-1102]` retargeted the hooks-order invariant from the deleted cards to the new deferred returns (`<AuthResolvingScreen>` + `<Redirect href="/" />`) and updated the styles-block slice anchor.

---

## Auth state-machine map (every cancel / unauth / error exit → where it now routes)

| Trigger | Surface | Resolution (post-ORCH-1102) |
|---|---|---|
| Auth still resolving (bootstrap in flight) | any web route | `AuthResolvingScreen` spinner |
| Auth resolved, stored web session warming | any web route | `AuthResolvingScreen` spinner (no false sign-in flash) |
| Auth resolved, NO user, no stored session (logout / token expiry / session loss / RLS 401) | any web route | `<Redirect href="/" />` → `BusinessWelcomeScreen` |
| Signed-in cold load | any authed web route | spinner → real screen (ORCH-1100 cold-load fix preserved) |
| OAuth provider cancel/deny (`?error=…`) | static `/auth/callback` | "Taking you back to sign in…" + "Back to sign in" link + auto-redirect to `/` |
| OAuth returns no session | static `/auth/callback` | same as above (no dead end) |
| OAuth success | static `/auth/callback` | persist session → `window.location.replace("/")` |
| Expo `/auth/callback` route after resolve (success or fail) | SPA | `<Redirect href="/" />` (unchanged) |
| Google/Apple sheet cancel | `BusinessWelcomeScreen` | `finally` clears in-progress flag; buttons usable (unchanged) |
| Email-input "Back" | `BusinessWelcomeScreen` | `mode → idle` (unchanged) |
| OTP verify error | `BusinessWelcomeScreen` | `mode → otp-input`, controls usable (unchanged) |
| OTP-input "Back to sign-in options" | `BusinessWelcomeScreen` | `mode → idle` (**NEW**) |
| Native (iOS/Android) | n/a | predicates return false; native flow untouched |

No exit leaves the user on a blank screen, a dead-end card, or an unbounded spinner.

---

## Device evidence (Samsung R58R54YV7JT)

Test rig: `expo export -p web --clear` of THIS branch served from a throwaway local Node static server (emulating Vercel rewrites: `/auth/callback` → `callback.html`, SPA fallback → `index.html`), reached via `adb reverse tcp:8099`. A baseline-main export was served on `:8100` for A/B comparison.

- **Cancel-auth → sign-in (Scenario D/E) — PROVEN LIVE.** `SCREENSHOT_ORCH-1102_cancel_callback_back_to_signin.png`: opening `/auth/callback?error=access_denied` shows "Sign-in needs another try / access_denied **Taking you back to sign in…**" + a tappable **"Back to sign in"** link. CDP poll 4s later confirmed the URL auto-redirected to `/` (the real app root). The old dead-end "Refresh, then sign in again." is gone.
- **The dead-end the fix removes — PROVEN on baseline (prod + local).** `SCREENSHOT_ORCH-1102_baseline_prod_deadend_card.png` (live `https://business.usemingla.com/account`) and `SCREENSHOT_ORCH-1102_baseline_local_deadend_card.png` (baseline export on `:8100/account`) both render the exact `Orch1092SignedOutRecovery` card ("MINGLA BUSINESS / Sign in to open Account settings. / This phone-browser route is ready… / Return to Home") that ORCH-1102 deletes.
- **Shipped-artifact diff (decisive).** In the THIS-branch web export bundle: **0** occurrences of the card strings ("Sign in to open" / "This phone-browser route is ready"), and **2** modules contain `shouldRedirectToSignIn` / `isWebAuthResolving`. In the baseline export bundle: **1** module still contains the card string. The fix is provably in the build.

### Live-render blocker for Scenarios 1/2/4 — root-caused, NOT faked

On the LOCAL static-server build, `/account` (and every authed route) hangs on `app/index.tsx`'s boot `<ActivityIndicator>` and never reaches the redirect. CDP console capture: repeated `@supabase/gotrue-js: Lock "lock:sb-…-auth-token" was not released within 2300ms … Forcefully acquiring the lock to recover.` — the ORCH-1100 `webResilientLock` (`navigator.locks`) deadlocks when the static export is served outside Vercel/Metro, so `loading` never flips to `false`. `SCREENSHOT_ORCH-1102_mybuild_loading_state.png` shows the spinner state.

This is an **environment artifact, orthogonal to this change**:
- It reproduces against the unchanged `app/index.tsx` / GoTrue lock (ORCH-1100 code, out of ORCH-1102 scope).
- Baseline only avoids it because its OUTER pre-provider card short-circuits BEFORE the provider tree mounts — i.e. the very dead-end this ORCH removes was masking the lock hang. Removing the outer card (correct) exposes the underlying ORCH-1100 lock behavior in this offline-ish static context.
- Production Vercel resolves auth normally (proven: prod `/account` rendered in ~3s), so the inner `<Redirect href="/" />` will fire there.

Live render of Scenarios 1/2/4 would require a Vercel preview deploy, which is FORBIDDEN by this ORCH's constraints (no merge/deploy/OTA). I did not fake it. The combination of (production live repro of the removed card) + (0-card / redirect-present shipped-bundle diff) + (the full predicate test suite with behavioral fails-on-revert) establishes correctness; the only unproven piece is the on-device pixel of the redirect landing, blocked solely by the documented lock deadlock.

**Command denied during device work:** one compound Bash call combining a screenshot read with `rm -rf web-build-orch1102` was sandbox-denied; re-run as separate commands (no impact on results).

---

## Verification matrix

| Spec criterion | How verified | Verdict |
|---|---|---|
| A. Remove both stub mechanisms entirely | grep: 0 live-code refs to `Orch1092*`/`Orch1093*`/route lists/resolver/UA-sniff in `_layout.tsx` (only comments + `not.toContain` tests); shipped bundle has 0 card strings | PASS |
| B. Preserve cold-load LOADING (route-agnostic) | `isWebAuthResolving` predicate + `AuthResolvingScreen`; tests assert loading in both `loading=true` and stored-session-warming states; ORCH-1100 Wave 3 brand/account predicates untouched | PASS |
| C. Unauthenticated → sign-in (global) | `shouldRedirectToSignIn` + `<Redirect href="/" />`; tests + mutual-exclusivity proof; baseline production renders the card the redirect replaces | PASS (live render blocked by env lock — see above) |
| D. Cancel auth → sign-in (never hang) | static callback recovery PROVEN LIVE on Samsung; OTP "Back to sign-in options" added; Google/Apple/email cancel paths preserved | PASS |
| E. Native byte-unchanged where web-specific | all new predicates gate on `isWeb`/`Platform.OS === "web"`; native AuthContext + BusinessWelcomeScreen sign-in flow untouched; the OTP back-link + callback changes are platform-neutral but only the static callback is web-only | PASS |
| web:export clean | `expo export -p web --clear` produced full route bundle (intake/listing/marketing/account/hub/…), not a degenerate "No routes found" | PASS |

---

## Regression Test

**New suite:** `mingla-business/src/__tests__/orch1102AuthRoutingNoDeadEnds.test.ts` (24 cases across 5 describe blocks: stubs-removed, redirect-on-logout, resolving-shows-loading incl. a state-space mutual-exclusivity proof, BusinessWelcomeScreen no-strand, static-callback recovery).

**Passing run:**
```
Test Suites: 8 passed, 8 total
Tests:       64 passed, 64 total   (orch1102* + 4 updated suites + BusinessWelcomeScreen + authCallbackStatic)
```

**Fails-on-revert verified at `e0b98615ab735f74c5d618e5118fdad706719ecc`** (the pre-fix HEAD):
1. Stashing all 4 source files and running `orch1102AuthRoutingNoDeadEnds` → suite fails to compile (`coldLoadAuthGates` has no `isWebAuthResolving` / `shouldRedirectToSignIn`).
2. Behavioral proof: reverting `_layout.tsx` to baseline (with a temporary compile shim for the removed export) ran the suite — the pure-predicate tests PASS, while the source-grep tests RED on exactly the right assertions:
   - `the signed-out recovery CARD component + its route list are gone` ✕ (baseline still contains `Orch1092SignedOutRecovery` / `ORCH_1092_SIGNED_OUT_ROUTES`)
   - `the mobile-web firewall stub + block-list + UA sniff are gone` ✕
   - `_layout redirects to '/' (the real BusinessWelcomeScreen), not a card` ✕
   - `_layout renders a loading screen while auth is resolving` ✕
   All shims removed and the fix restored afterward (verified `shouldRedirectToSignIn` present ×3 in `_layout.tsx`, ×2 in `coldLoadAuthGates.ts`).

**Append-only compliance:** the 4 pre-existing suites that asserted the now-removed stubs are modified under `[TEST-MOD-APPROVED ORCH-1102]` (cited in each file + the closing commit body per `.github/workflows/tests-append-only.yml`).

---

## Type / lint

- `tsc --noEmit`: baseline = 260 pre-existing errors; THIS branch = 260 (the one new error — a stale import of the removed export — was fixed when updating the test). **Zero new type errors.** `_layout.tsx` + `coldLoadAuthGates.ts` are clean.
- `eslint` on touched files: **0 errors.** `_layout.tsx` warnings dropped 7 → 5 (removed two unused directives by deleting code); the BusinessWelcomeScreen animation-effect warning is pre-existing and untouched.

---

## Cross-surface impact

| Surface | Affected? | What changes |
|---|---|---|
| Buyer/anon Web | NO | auth routing lives in `(tabs)`-adjacent root; anon buyer routes don't gate on business session |
| Business Web (preview) | YES | dead-end cards removed; unauth → sign-in; cancel → sign-in; cold-load loading preserved |
| Business iOS / Android | NO behavior change | predicates gate on `isWeb`; native sign-in flow + AuthContext unchanged (the OTP "Back to sign-in options" link is platform-neutral and additive — improves native too without regressing it) |
| Consumer iOS / Android | NO | different app (`app-mobile/`) |
| Admin Web | NO | different app |

Parity is automatic (shared predicate + shared `_layout.tsx`); the only web-only artifact is the static `public/auth/callback.html`.

---

## Constitutional compliance (diff scan)

All 14 PASS or N/A. Notably: #3 no-silent-failures (callback `catch` surfaces a status + recovery; every state handled), #4 every-state-handled (loading / redirect / app all explicit; no blank, no dead-end, no unbounded spinner on web), #6 (signOut clearing untouched). No `any`, no `@ts-ignore`, no `catch(){}`.

---

## Invariant preservation

- ORCH-1098 Stage 5 React #300 hooks-order invariant: PRESERVED — the new auth-routing returns remain DEFERRED to after every hook (test re-targeted to the new returns).
- ORCH-1100 Wave 3 cold-load fix: PRESERVED + generalized (route-agnostic loading; brand/account warming predicates untouched).
- ORCH-1100 Wave 1A firewall retirement: COMPLETED (the dormant firewall machinery is now fully removed, not just emptied).
- `feedback_stripe_*` / schema / copy-of-record: NOT TOUCHED.

---

## Discoveries for Orchestrator

- **ORCH-1100 GoTrue `webResilientLock` deadlocks a static export served outside Vercel/Metro** (`navigator.locks` never releases → `loading` never resolves → boot spinner forever). Baseline masked this on the 5 gated routes via the outer pre-provider card (now removed). Production Vercel is unaffected. Not a regression from ORCH-1102, but worth a follow-up: the 3s `AUTH_BOOTSTRAP_TIMEOUT` should arguably also bound the lock so a stuck lock can't hold `loading=true` past the timeout. Flagging for registration; out of ORCH-1102 scope.

---

## Constraints honored

No Stripe/schema/copy-of-record changes. Web-specifics web-gated (static callback). Committed on branch `ORCH-1102-business-web-auth-routing-no-deadends`. NOT merged/deployed/OTA'd. adb torn down; Chrome flags file removed; Samsung left as-is. Temp build dirs + helper scripts deleted.
