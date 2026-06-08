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
