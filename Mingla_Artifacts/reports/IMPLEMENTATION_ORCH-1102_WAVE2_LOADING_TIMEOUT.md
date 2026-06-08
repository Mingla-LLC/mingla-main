# IMPLEMENTATION — ORCH-1102 Wave 2 [bounded auth-resolution loading; never an infinite spinner]

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1102-[business-web-auth-routing-no-deadends]/`
**Branch:** `ORCH-1102-business-web-auth-routing-no-deadends`
**Commits (this wave):** `65f15afb9` (initial bounded timeout) + `0b54e804a` (remount/render-loop-immune refinement). Pre-wave HEAD = `3bf19131a`.
**Device owned:** Samsung `R58R54YV7JT` (sethogieva@gmail.com, "Leggo This")
**Status:** implemented & verified — timeout logic proven by 19-case regression suite (fails-on-revert) + on-device proof that the spinner the baseline traps the user on forever is now DISMISSED. The post-dismissal sign-in PIXELS cannot be captured on the local static build because of a PRE-EXISTING (baseline too) React #185 render loop in the offline static-export harness — root-caused below, orthogonal to this change, production-unaffected.
**Comms ledger:** read on entry. COMMS-0017 (Samsung reservation for ORCH-1016) is RESOLVED; device is free and explicitly assigned to ORCH-1102. No BLOCK-OPEN rows target this skill / ORCH-1102 / ALL. No new cross-ORCH discovery row written (the #185 finding is a same-ORCH environment note for the orchestrator, recorded below).

---

## What Wave 2 fixes

Wave 1 removed the dead-end card that, on the baseline, was MASKING the auth-resolution LOADING gate hanging. With the card gone, an unresolvable session would sit on an infinite spinner. Seth's hard rule: a user must NEVER be left hanging.

Wave 2 adds a **bounded wall-clock ceiling** on the loading gate. If auth has not resolved within the ceiling, the spinner is dismissed and the user is treated as logged-out → routed to the real sign-in screen (the correct non-hanging destination). The ceiling sits well above the normal warm path + the 3s ORCH-0887-A race + the 2.3s ORCH-1100 lock self-heal, so it is a true last-resort backstop that never pre-empts a real (slow) session and never causes a false logged-out flash.

**Timeout value:** `AUTH_RESOLUTION_HARD_CEILING_MS = 7000` (AuthContext) / `AUTH_RESOLUTION_CEILING_MS = 7000` (coldLoadAuthGates, the shared UI-gate constant). 7s > 3s race + 2.3s lock = 5.3s, with margin; ≤ 8s.

---

## Files changed — Old → New receipts

### `mingla-business/src/context/AuthContext.tsx`
**Before:** Bootstrap raced `getSession()` against a 3s `Promise.race` timeout (ORCH-0887-A). If even that branch did not run its `setLoading(false)` (StrictMode unmount-bail / microtask starvation under the GoTrue lock), `loading` stayed true forever.
**After:** Added `export const AUTH_RESOLUTION_HARD_CEILING_MS = 7000` and an INDEPENDENT web-only wall-clock `setTimeout` armed synchronously in the bootstrap effect (NOT a `Promise.race` arm living inside the locked auth subsystem, so the lock can't starve it). At the ceiling it force-`setLoading(false)` + sets `bootstrapTimedOutRef`, preserving any stored web session (a genuinely slow-but-valid session still warms via a late SIGNED_IN/TOKEN_REFRESHED). Cleared on unmount. The 3s race is preserved as the fast path.
**Why:** primary source-of-truth backstop so `loading` can never be permanently true on web.
**Lines:** ~+30.

### `mingla-business/src/utils/coldLoadAuthGates.ts`
**Before:** `shouldRedirectToSignIn` / `isWebAuthResolving` (Wave 1) — both require `!loading` to redirect, so a stuck `loading=true` kept the spinner.
**After:** Added `export const AUTH_RESOLUTION_CEILING_MS = 7000` + pure predicate `isAuthResolutionExpired({ isWeb, hasUser, stillResolving, elapsedMs, ceilingMs })` — true only on web, no user, still resolving, elapsed ≥ ceiling. Unit-testable, the fails-on-revert anchor.
**Why:** decouple the deadlock backstop from `!loading`; a present user or resolved state always wins.
**Lines:** ~+40.

### `mingla-business/app/_layout.tsx`
**Before:** Rendered `AuthResolvingScreen` (spinner) whenever `authResolving` was true — with no upper bound.
**After:** A REMOUNT- AND RENDER-LOOP-IMMUNE deadline: a MODULE-LEVEL monotonic timestamp `authResolveStartedAt` (stamped once while resolving with no user; cleared only when a real user appears) is read AT RENDER TIME via `isAuthResolutionExpired`, plus a 500ms wakeup interval for the quiet (no-render-loop) deadlock case. `authResolutionExpired` is checked BEFORE the spinner return → `<Redirect href="/">` (the real BusinessWelcomeScreen). The render-time read is essential: the offline static build spins a ~37-renders/sec loop that clears any per-mount timer before the ceiling; reading the persistent anchor at render time converges on the ceiling regardless.
**Why:** the UI gate must escape the spinner even under remount/render-loop churn.
**Lines:** ~+55.

### `mingla-business/app/index.tsx`
**Before:** Boot spinner gated solely on `loading` (`#fff9f5` background) — unbounded.
**After:** Same remount/render-loop-immune pattern with a module-level `bootLoadingStartedAt` anchor + `hasBootDeadlinePassed()` read at render time; spinner gated on `loading && !bootDeadlineExpired`, then falls through to `BusinessWelcomeScreen` for a no-user state.
**Why:** local guarantee that the home boot spinner can never be permanent.
**Lines:** ~+30.

### `mingla-business/src/__tests__/orch1102Wave2LoadingTimeout.test.ts` — NEW
19-case regression suite (pure-predicate behaviour + source-text structural assertions per repo convention).

---

## Device evidence (Samsung R58R54YV7JT, Chrome 148, local static export served via `adb reverse :8099`, driven via CDP)

Test rig: `expo export -p web --clear` of THIS branch served from a throwaway Node static server emulating Vercel rewrites (`/auth/callback`→`callback.html`, missing `_expo/*.js`→real 404, navigable routes→`index.html`), reached over `adb reverse tcp:8099`. A Wave-1 baseline export served from the same server for A/B.

| # | Scenario | Result | Screenshot |
|---|---|---|---|
| Baseline (control) | `/account`, no session | INFINITE spinner — CDP DOM at 13s: `progressbar` present, `root` innerHTML 761 chars; never resolves | `SCREENSHOT_ORCH-1102_WAVE2_baseline_infinite_spinner.png` |
| 1 | Wave 2 build, `/account`, no session | At **3s**: spinner present (normal loading, no premature timeout). At **12s** (> 7s ceiling): spinner **DISMISSED** — CDP DOM `progressbar` ABSENT, `root` innerHTML 0. The infinite spinner is broken. | `SCREENSHOT_ORCH-1102_WAVE2_S1_account_timeout_spinner_dismissed.png` |
| 4 | OAuth cancel (`/auth/callback?error=access_denied`) | REAL pixels: "Sign-in needs another try / cancelled / Taking you back to sign in…" + tappable **"Back to sign in"** link + auto-redirect to `/`. Re-confirms the Wave 1 cancel fix. | `SCREENSHOT_ORCH-1102_WAVE2_S4_callback_cancel_back_to_signin.png` |
| Destination proof | prod `business.usemingla.com/` logged-out (READ-ONLY, no deploy) | The REAL `BusinessWelcomeScreen` renders: "List experiences, reach guests, and grow — simply." + Continue with Apple/Google/Email. This is exactly the screen the timeout routes unresolvable sessions to. Proves the destination is real and paints normally on Vercel. | `SCREENSHOT_ORCH-1102_WAVE2_real_signin_destination_prod.png` |

### Scenarios 1 (sign-in pixels), 2 (clear-session→sign-in), 3 (cold signed-in→real screen) — landing pixels blocked by a PRE-EXISTING environment loop

On the LOCAL static build, after the timeout dismisses the spinner, the destination renders BLANK rather than the sign-in screen. CDP root-caused this to **React error #185 ("Maximum update depth exceeded" — an infinite render loop)**, which tears the tree down to `root` innerHTML 0.

**Decisive control:** the Wave-1 BASELINE export throws the SAME #185 (and at the bare `/` route too), and it does so WITHOUT my changes. So #185 is a PRE-EXISTING artifact of the offline static-export harness (a ~37-renders/sec loop from the GoTrue web-lock thrash in a context with no Vercel/Metro), NOT introduced by Wave 2. It is the very thing that made the baseline spinner infinite. My timeout correctly escapes the spinner; the local harness simply cannot paint ANY destination (sign-in included) while the #185 loop runs.

**Production is unaffected:** prod `business.usemingla.com` rendered both the (old) gated card and the real `BusinessWelcomeScreen` normally (no spinner, no blank), proving the React app paints fine on Vercel. There, the timeout's `<Redirect href="/">` lands on the real sign-in screen. Capturing the post-fix on-device sign-in pixel for Scenarios 1/2/3 would require a Vercel preview deploy, which is FORBIDDEN by this ORCH's constraints. The combination of (baseline-infinite-spinner vs Wave-2-spinner-dismissed on-device) + (the real sign-in destination rendering on prod) + (the 19-case fails-on-revert suite) establishes correctness; the only uncaptured piece is the post-fix sign-in pixel, blocked solely by the documented pre-existing #185 loop.

**Sandbox-denied commands during device work:** `rm -rf /tmp/orch1102w2_webexport` (and a compound `rm -rf` + export) were denied; worked around by exporting to fresh directories (`_webexport2`/`_webexport3`/`_baseline`) instead of deleting. No impact on results.

---

## Regression Test

**Suite:** `mingla-business/src/__tests__/orch1102Wave2LoadingTimeout.test.ts` — 19 cases:
- pure-predicate: never-resolving session past ceiling → EXPIRED → sign-in (the dispatch's "mock a never-resolving getSession → assert sign-in, not perpetual loading"); not-expired before the ceiling (no false flash); present-user always wins; resolved state never trips; native never trips; ceiling > 5.3s and ≤ 8s; Wave-1 gates unchanged.
- AuthContext source: exports the hard ceiling in band; arms an independent web-only `setTimeout` that `setLoading(false)`; clears on unmount; 3s race preserved.
- `_layout` source: imports the predicate; remount/render-loop-immune module anchor + render-time read + wakeup interval; `authResolutionExpired` checked BEFORE the spinner.
- `index` source: shared anchor + render-time read; spinner gated on `loading && !bootDeadlineExpired`.

**Passing run:** `Tests: 19 passed, 19 total`.

**Fails-on-revert:**
- At `3bf19131a` (pre-Wave2 HEAD): reverting `coldLoadAuthGates.ts` makes the suite **fail to compile** (`no exported member 'AUTH_RESOLUTION_CEILING_MS' / 'isAuthResolutionExpired'`).
- Behavioral: reverting `_layout.tsx` + `index.tsx` to baseline makes 5 source-structural cases RED (render-time anchor / before-spinner check absent). Restored → 19 green.

**Adjacent regression sweep:** `orch1102* + orch1100* + AuthContext* + orch1098Stage5* + orch_1092*` = **137 passed, 137 total** (no Wave-1 or auth-timeout regressions). The wider `jest` run has 74 pre-existing failing suites (trips/checkout/brand/cover-media) that fail identically on baseline `3bf19131a` — unrelated to this change (worktree/environment), not introduced here.

---

## Type / lint / web:export

- `tsc --noEmit`: 260 errors total = baseline 260 (all pre-existing phone-input package etc.). **0 in any touched file.**
- `eslint` on touched files: **0 errors** (pre-existing unused-disable warnings only).
- `expo export -p web --clear`: **clean** — full route bundle (account/index/team/trips/StripeConnectPages/…), not a degenerate "No routes found". The `auth-resolution-deadline` marker is present in the shipped bundle.

---

## Cross-surface impact

| Surface | Affected? | What changes |
|---|---|---|
| Business Web (preview/prod) | YES | the auth-resolution loading gate is now bounded — an unresolvable session lands on the real sign-in screen instead of an infinite spinner |
| Business iOS / Android | NO behavior change | all backstops gate on `Platform.OS === "web"`; native bootstrap resolves and the splash covers boot — native session behaviour byte-unchanged |
| Buyer/anon Web, Consumer iOS/Android, Admin Web | NO | different app / anon routes don't gate on business session |

Parity is automatic (shared `_layout.tsx` + shared `coldLoadAuthGates` predicate + AuthContext).

---

## Invariant preservation

- ORCH-1098 Stage 5 React #300 hooks-order: PRESERVED — all hooks still run unconditionally; the new render-time anchor reads are side-effect-free module calls (no hooks), and the auth-routing returns remain DEFERRED to after every hook.
- ORCH-1100 web GoTrue self-healing lock: PRESERVED — Wave 2 is a BACKSTOP for when even the lock can't resolve; it does not touch `webResilientLock`.
- ORCH-0887-A 3s bootstrap race: PRESERVED (fast path; the 7s ceiling is additive).
- ORCH-1102 Wave 1 route-agnostic redirect + cancel recovery: PRESERVED (137-test sweep green).
- Stripe / schema / copy-of-record: NOT TOUCHED.

---

## Discoveries for Orchestrator

- **PRE-EXISTING React #185 infinite render loop in the offline static-export harness.** The mingla-business web bundle, when served as a plain static export OUTSIDE Vercel/Metro, hits React error #185 (Maximum update depth exceeded) at boot — even at `/` — on the Wave-1 baseline (i.e., independent of ORCH-1102). It manifests as a ~37-renders/sec loop driven by the ORCH-1100 GoTrue web-lock thrash and tears the tree down to a blank root. Production Vercel is unaffected (auth resolves normally; the app paints). This is the real mechanism behind the prior agent's "deadlock" and the inability to capture local landing pixels. Worth registering as a separate investigation (it only bites offline/static QA harnesses, not users), and it argues for ORCH-1100's lock to be made resilient to a no-Vercel context. Out of ORCH-1102 Wave 2 scope.

---

## Constraints honored

No Stripe/schema/copy-of-record changes. Web-specifics web-gated (native unchanged). Committed on branch `ORCH-1102-business-web-auth-routing-no-deadends` (`65f15afb9`, `0b54e804a`). NOT merged/deployed/OTA'd. adb forwards/reverses removed, stayon off, static server stopped; Samsung left connected as-is. Orchestrator-owned `MASTER_BUG_LIST.md` / `WORLD_MAP.md` (pre-existing unmerged `UU` state in the worktree) left untouched and excluded from all commits.

**Working tree:** `~/Desktop/mingla-orchs/ORCH-1102-[business-web-auth-routing-no-deadends]/ on branch ORCH-1102-business-web-auth-routing-no-deadends`.
