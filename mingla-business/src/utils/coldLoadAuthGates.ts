/**
 * coldLoadAuthGates — ORCH-1100 Wave 3.
 *
 * Pure, RN-import-free decision predicates for the cold-direct-load
 * auth-readiness flash fix. Extracted so they are unit-testable in the node
 * jest env and shared by the route gates (mirrors the Wave-1A
 * `shouldClearCurrentBrandId` discipline).
 *
 * The residual: on a COLD direct load (refresh / bookmark) of a deep authed
 * route the session is not yet warm, so the route's own gate renders the
 * signed-out / not-found branch before auth resolves. These predicates let the
 * gates show a LOADING state during the warming window WITHOUT trapping a
 * genuinely logged-out user on a spinner (they gate on "auth still resolving",
 * not merely "no user").
 */

/**
 * `/brand/{id}` — is the brand still RESOLVING (show a spinner) vs genuinely
 * not-found (show the not-found branch)?
 *
 * RESOLVING when there is a valid brand id, the brand row is not yet in hand,
 * AND either auth has not become ready yet OR the brand query has not settled
 * (still loading / not fetched). Once auth is ready and the query has fetched,
 * a still-null brand is a genuine not-found → returns false.
 *
 * A missing/empty id segment is an immediate not-found (never loading).
 */
export const isBrandRouteResolving = ({
  hasBrandId,
  brandIsNull,
  isAuthReady,
  queryIsFetched,
  queryIsLoading,
}: {
  hasBrandId: boolean;
  brandIsNull: boolean;
  isAuthReady: boolean;
  queryIsFetched: boolean;
  queryIsLoading: boolean;
}): boolean => {
  if (!hasBrandId) return false;
  if (!brandIsNull) return false;
  return !isAuthReady || !queryIsFetched || queryIsLoading;
};

/**
 * ROUTE-AGNOSTIC unauthenticated redirect — ORCH-1102.
 *
 * Replaces the ORCH-1092 `shouldShowSignedOutRecovery` route-list predicate.
 * Operator intent (ORCH-1102): a user who becomes unauthenticated on ANY web
 * route is routed back to the real sign-in screen — never a dead-end card,
 * never a blank screen, never an infinite spinner. There is NO route list:
 * every authed web route redirects to `/` (which renders BusinessWelcomeScreen)
 * once auth has RESOLVED and there is genuinely no user.
 *
 * Fires ONLY for a genuinely logged-out user: web, auth bootstrap finished
 * (`!loading`), no user, AND no stored web session. When a stored session
 * exists (the cold warming window) this returns false so the root shows a
 * LOADING state instead of a false-logged-out flash — the session warms a beat
 * later via a late SIGNED_IN / TOKEN_REFRESHED event and the route renders.
 *
 * `hasStoredWebSession` is false for real logged-out users, so they are
 * redirected immediately (no spinner trap). The decision is intentionally
 * decoupled from the pathname so no route can be "left hanging".
 */
export const shouldRedirectToSignIn = ({
  isWeb,
  loading,
  hasUser,
  hasStoredWebSession,
}: {
  isWeb: boolean;
  loading: boolean;
  hasUser: boolean;
  hasStoredWebSession: boolean;
}): boolean => isWeb && !loading && !hasUser && !hasStoredWebSession;

/**
 * SIGN-IN ROUTE IDENTITY — ORCH-1103 [Sign-out white screen / React #185].
 *
 * The unauthenticated redirect target is `/`, which renders BusinessWelcomeScreen
 * (the real sign-in screen). The root `_layout` governs EVERY route, INCLUDING
 * `/` itself. ORCH-1102 had the layout return `<Redirect href="/" />` whenever
 * `shouldRedirectToSignIn` / `isAuthResolutionExpired` fired — with NO check for
 * whether the current route was ALREADY `/`. On sign-out (or any unauthenticated
 * landing on `/`) the layout therefore redirected `/` → `/` on every render: the
 * `<Redirect>` re-triggers navigation, the layout re-renders, returns `<Redirect>`
 * again — an unbounded navigation/render loop. React aborts it with #185
 * ("Maximum update depth exceeded") and tears the tree down → empty `#root` =
 * WHITE SCREEN. The Stack (so `index.tsx` → BusinessWelcomeScreen) never mounts.
 *
 * This predicate identifies when the current pathname IS the sign-in route, so
 * the layout can render the normal Stack (letting `index.tsx` show the welcome
 * screen) INSTEAD of redirecting to the route it is already on. Expo Router
 * normalizes the root to `/` (and tolerates an empty string on first frame);
 * a trailing-slash variant is treated as the same route defensively.
 *
 * Pure + RN-import-free so it is unit-testable and fails-on-revert.
 */
export const SIGN_IN_ROUTE = "/";

export const isSignInRoute = (pathname: string | null | undefined): boolean => {
  if (pathname === null || pathname === undefined) return true;
  const trimmed = pathname.trim();
  if (trimmed === "") return true;
  // Strip a single trailing slash (but keep the root "/" itself).
  const normalized =
    trimmed.length > 1 && trimmed.endsWith("/")
      ? trimmed.slice(0, -1)
      : trimmed;
  return normalized === "" || normalized === SIGN_IN_ROUTE;
};

/**
 * REDIRECT-TO-SIGN-IN, loop-safe — ORCH-1103.
 *
 * Combines the ORCH-1102 `shouldRedirectToSignIn` decision with the
 * already-at-sign-in guard: only emit the `<Redirect href="/" />` when the user
 * genuinely needs to leave the CURRENT route to reach sign-in. When already on
 * `/`, return false so the layout renders the Stack (welcome screen) instead of
 * redirecting to itself — killing the #185 self-redirect loop. Native is never
 * web, so this is a no-op off-web (matches `shouldRedirectToSignIn`).
 */
export const shouldRedirectToSignInFromRoute = ({
  isWeb,
  loading,
  hasUser,
  hasStoredWebSession,
  pathname,
}: {
  isWeb: boolean;
  loading: boolean;
  hasUser: boolean;
  hasStoredWebSession: boolean;
  pathname: string | null | undefined;
}): boolean =>
  shouldRedirectToSignIn({ isWeb, loading, hasUser, hasStoredWebSession }) &&
  !isSignInRoute(pathname);

/**
 * The companion LOADING gate — ORCH-1102.
 *
 * True while auth is still RESOLVING on a web route: either the bootstrap is
 * in flight (`loading`), OR it finished but a stored web session exists while
 * `user` has not yet been applied (the cold warming window). In this state the
 * root shows a loading spinner — NOT a flash of sign-in, NOT a dead-end. This
 * is route-agnostic: any authed web route shows LOADING while resolving.
 *
 * False once a user is present (render the app) or once it is clear the user is
 * genuinely logged out (no stored session → `shouldRedirectToSignIn` fires).
 */
export const isWebAuthResolving = ({
  isWeb,
  loading,
  hasUser,
  hasStoredWebSession,
}: {
  isWeb: boolean;
  loading: boolean;
  hasUser: boolean;
  hasStoredWebSession: boolean;
}): boolean => {
  if (!isWeb) return false;
  if (hasUser) return false;
  if (loading) return true;
  // Bootstrap finished, no user, but a stored session is still warming.
  return hasStoredWebSession;
};

/**
 * BOUNDED-LOADING hard ceiling — ORCH-1102 Wave 2.
 *
 * Seth's hard rule: a user must NEVER be left hanging on an infinite spinner.
 * The ORCH-1100 web GoTrue lock can DEADLOCK (orphaned-lock thrash / microtask
 * starvation), and a deadlock can hold the loading gate true even though the
 * ORCH-0887-A 3s race + the AuthContext hard-ceiling normally release it. This
 * predicate is the LAST-RESORT backstop at the UI gate: once auth has been
 * resolving for longer than the ceiling, treat an unresolvable session as
 * logged-out and route to sign-in instead of spinning forever.
 *
 * `elapsedMs` is measured from first mount of the auth gate; `ceilingMs` is the
 * wall-clock budget (default well above the normal warm path + the 3s race +
 * the 2.3s lock self-heal so it never pre-empts a real, merely-slow session and
 * never causes a false logged-out flash). Fires ONLY while still resolving and
 * with no user — a present user always wins (render the app), and a resolved
 * (non-spinning) state never trips it.
 */
export const AUTH_RESOLUTION_CEILING_MS = 7000;

export const isAuthResolutionExpired = ({
  isWeb,
  hasUser,
  stillResolving,
  elapsedMs,
  ceilingMs = AUTH_RESOLUTION_CEILING_MS,
}: {
  isWeb: boolean;
  hasUser: boolean;
  stillResolving: boolean;
  elapsedMs: number;
  ceilingMs?: number;
}): boolean => {
  if (!isWeb) return false;
  if (hasUser) return false;
  if (!stillResolving) return false;
  return elapsedMs >= ceilingMs;
};

/**
 * `/account` brand-area — is auth still WARMING (show "Loading your brands…")?
 *
 * True when the brand-list status resolved to a transient signed-out shape on a
 * cold load BUT a stored web session exists (the session is restoring). Lets the
 * route show a loading card instead of a blank brand area during the window.
 */
export const isAccountAuthWarming = ({
  brandListStatus,
  hasStoredWebSession,
}: {
  brandListStatus: string;
  hasStoredWebSession: boolean;
}): boolean =>
  (brandListStatus === "signed_out" || brandListStatus === "query_disabled") &&
  hasStoredWebSession;
