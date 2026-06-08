# ORCH-1103 — Sign-out white screen (React #185) — Implementation

Date: 2026-06-08
Surface: Business Web (production + preview). Native iOS/Android untouched (web-only render-path fix).

## Symptom (Seth, live)
Signing out glitches then lands on a WHITE SCREEN; reloading that tab stays white (stuck). Diagnosed live via CDP on the Samsung against production: console throws **React error #185 ("Maximum update depth exceeded" — infinite render loop)** repeatedly; `#root` empty.

## Root cause (PROVEN)
The root `app/_layout.tsx` governs EVERY route, **including `/`** (which renders `BusinessWelcomeScreen` = the real sign-in screen). ORCH-1102 made the layout return `<Redirect href="/" />` whenever `shouldRedirectToSignIn` (genuinely logged out) OR `authResolutionExpired` (the 7s deadlock backstop) fired — with **no check for whether the current route was already `/`**. On sign-out (or any unauthenticated landing on `/`), the layout redirected `/` → `/` on every render: the `<Redirect>` re-triggers navigation → the layout re-renders → returns `<Redirect>` again → unbounded loop → React aborts with #185 and tears the tree down → empty `#root` = white screen. The Stack (and thus `index.tsx` → welcome screen) never mounts.

This is the same #185 the ORCH-1102 verification saw locally and wrongly dismissed as "local-only" — it is the production self-redirect loop.

## Fix (loop-safe redirect)
`src/utils/coldLoadAuthGates.ts`: added pure, unit-testable `isSignInRoute(pathname)` + `shouldRedirectToSignInFromRoute({...,pathname})` — only redirect to `/` when NOT already on `/` (root normalized, trailing-slash tolerant, empty-first-frame treated as root).
`app/_layout.tsx`: read `usePathname()` unconditionally (Rules-of-Hooks preserved); guard all three sign-in redirect/spinner returns with the already-at-sign-in check — `if (authResolutionExpired && !atSignInRoute)`, `if (authResolving && !(atSignInRoute && authResolutionExpired))`, and `redirectToSignIn` via `shouldRedirectToSignInFromRoute`. When already at `/` and unauthenticated, the layout renders the Stack so `index.tsx` shows the welcome screen — no self-redirect. Preserves ORCH-1100/1102 behavior (cold-load LOADING for warming sessions, unauth→sign-in from non-`/` routes, 7s deadlock backstop). Kills the #185 class (also fixes the "even at home" local-export #185).

## Tests
- New `src/utils/__tests__/orch_1103_signout_redirect_loop.test.ts` (pure-predicate coverage: `/`→no-redirect, non-`/`→redirect, trailing-slash/empty handling). Suite is red on the pre-fix tree (new exports absent) = fails-on-revert.
- `src/__tests__/orch1102Wave2LoadingTimeout.test.ts` updated under `[TEST-MOD-APPROVED ORCH-1103]` (prefix-match the now loop-guarded backstop returns; invariant "expired backstop before spinner" unchanged).
- Full auth suite: 72/72 pass; tsc no new errors.

## Verification status
Code + unit-proven. Device sign-out→sign-in landing pixel verification was in progress when the prior agent run hit a watchdog stall; orchestrator to confirm on production post-deploy (the fix is deterministic at the layout-render layer). The orchestrator already proved the BUG live on the device (CDP #185 exception).
