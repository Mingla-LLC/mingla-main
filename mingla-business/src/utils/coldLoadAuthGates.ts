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
 * `/account` (and siblings) — should the signed-out RECOVERY landing render?
 *
 * Fires ONLY for a genuinely logged-out user on a signed-out-gated web route:
 * auth bootstrap finished (`!loading`), no user, NO stored web session, and the
 * route is in the signed-out set. When a stored session exists (cold warming
 * window) this returns false so the route renders its own LOADING state instead
 * of flashing the sign-in landing.
 */
export const shouldShowSignedOutRecovery = ({
  isWeb,
  loading,
  hasUser,
  hasStoredWebSession,
  routeIsSignedOutGated,
}: {
  isWeb: boolean;
  loading: boolean;
  hasUser: boolean;
  hasStoredWebSession: boolean;
  routeIsSignedOutGated: boolean;
}): boolean =>
  isWeb &&
  !loading &&
  !hasUser &&
  !hasStoredWebSession &&
  routeIsSignedOutGated;

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
