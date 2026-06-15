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
 * PUBLIC-BUYER-ROUTE ALLOWLIST — ORCH-1115 [anon-buyer web funnel restored].
 *
 * THE P0 SYMPTOM: ORCH-1102 moved the unauthenticated "no dead-end" sign-in
 * redirect from a route-list / `(tabs)`-scoped gate to the ROOT layout, which
 * wraps EVERY route — with no allowlist for the intentionally-public buyer
 * routes. A genuinely logged-out guest opening a share link (`/e/ /t/ /b/
 * /exp/`), a guest checkout (`/checkout/ /checkout-trip/ /checkout-experience/`),
 * or a post-purchase receipt / emailed cancel link (`/o/ /booking/`) was bounced
 * to the business sign-in wall; the buyer page + checkout never rendered. RLS is
 * fully permissive to anon — this is purely a client route-gate bug.
 *
 * THIS CONSTANT is the SINGLE SOURCE OF TRUTH for the anon-tolerant public buyer
 * routes (`feedback_anon_buyer_routes.md`). Any NEW public buyer route MUST be
 * added HERE (and to `orch_1115_anon_buyer_route_allowlist.test.ts`) and ONLY
 * here — do not duplicate the prefix list anywhere else. Carries
 * I-PROPOSED-1115-PUBLIC-BUYER-ROUTE-ALLOWLIST.
 *
 * Each entry is matched as a path-SEGMENT prefix by `isPublicBuyerRoute` (so
 * `/checkout/x` matches but `/checkouter` does NOT).
 */
export const PUBLIC_BUYER_ROUTE_PREFIXES = [
  "/e/", // /e/[brandSlug]/[eventSlug] — public event page (share link)
  "/t/", // /t/[brandSlug]/[tripSlug] — public trip page (share link)
  "/b/", // /b/[brandSlug] — public brand page (share link)
  "/exp/", // /exp/[brandSlug]/[experienceSlug] — public experience page (share link)
  "/checkout/", // /checkout/[eventId]/… — event guest checkout
  "/checkout-trip/", // /checkout-trip/[tripEventId]/… — trip guest checkout
  "/checkout-experience/", // /checkout-experience/[experienceEventId]/… — experience guest checkout
  "/o/", // /o/[orderId] — buyer order receipt (post-purchase, anon-tolerant per I-21)
  "/booking/", // /booking/[orderId]/cancel — buyer cancel-from-email (anon-buyer-tolerant)
] as const;

/**
 * Is the current pathname an anon-tolerant PUBLIC BUYER route — ORCH-1115?
 *
 * Pure, RN-import-free (same discipline as the rest of the file so it is
 * node-jest-unit-testable and fails-on-revert). Used to EXEMPT a public buyer
 * route from the root-layout unauthenticated redirect (the exemption can only
 * ever turn a redirect OFF on a public route — never ON).
 *
 * Matching (segment-safe prefix match on the pathname only — no query string):
 * - null / undefined / empty / whitespace-only → false (a missing pathname is
 *   NOT a public route; it falls through to the existing `isSignInRoute`
 *   behavior, which treats empty as `/`).
 * - Trim; strip a single trailing slash for `length > 1` (mirrors
 *   `isSignInRoute` normalization) so `/checkout/` and `/checkout` both behave.
 * - For each prefix `P`, let `base = P` without its trailing slash (e.g.
 *   `/checkout`). Match iff `normalized === base` OR
 *   `normalized.startsWith(base + "/")`. The `+ "/"` keeps it SEGMENT-SAFE:
 *   `/checkouter` does NOT match `/checkout/`.
 */
export const isPublicBuyerRoute = (
  pathname: string | null | undefined,
): boolean => {
  if (pathname === null || pathname === undefined) return false;
  const trimmed = pathname.trim();
  if (trimmed === "") return false;
  // Strip a single trailing slash (but never the root "/" itself).
  const normalized =
    trimmed.length > 1 && trimmed.endsWith("/")
      ? trimmed.slice(0, -1)
      : trimmed;
  return PUBLIC_BUYER_ROUTE_PREFIXES.some((prefix) => {
    const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return normalized === base || normalized.startsWith(`${base}/`);
  });
};

/**
 * SELF-AUTHENTICATING STRIPE-CONNECT SELLER ROUTES — ORCH-1139.
 *
 * Exempt from the ORCH-1102 route-agnostic sign-in redirect. These are NOT
 * anon-public buyer routes (do NOT add them to PUBLIC_BUYER_ROUTE_PREFIXES).
 * They are served by the WEB bundle and opened by the native "Set up payments"
 * CTA in a SESSIONLESS in-app browser (WebBrowser.openAuthSessionAsync), so they
 * carry NO Supabase web session and the route-agnostic gate would bounce them
 * to `/` (business sign-in) before the page can mount.
 *
 * CONSTITUTIONAL CAVEAT: this exemption is valid ONLY because each page carries
 * its OWN out-of-band credential in the URL — the Stripe AccountSession
 * client_secret (`?session=…`), minted by the auth-checked `brand-stripe-onboard`
 * edge function — and authenticates itself against Stripe (ConnectOnboardingBody
 * never reads a Supabase user). The exemption does NOT make seller account data
 * public: the page renders nothing without a valid Stripe client_secret. NEVER
 * add a route here that would instead read account data from an implicit Supabase
 * session — that would be a real data exposure. (See ORCH-1139 F-2 / Q3.)
 *
 * Written WITHOUT a trailing slash; the matcher (`isSelfAuthenticatedExemptRoute`)
 * normalizes each prefix to its no-trailing-slash `base` and matches segment-safe
 * (`normalized === base || normalized.startsWith(base + "/")`), so the bare route
 * (`/connect-onboarding`) AND any sub-path (`/connect-onboarding/foo`) match while
 * a lookalike (`/connect-onboarding-evil`) does NOT.
 */
export const SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES = [
  "/connect-onboarding", // app/connect-onboarding.web.tsx — Stripe Connect onboarding
  "/connect-account-management", // app/connect-account-management.web.tsx
  "/connect-partner-onboarding", // app/connect-partner-onboarding.web.tsx
  "/connect-partner-account-management", // app/connect-partner-account-management.web.tsx
  "/connect-tax-registrations", // app/connect-tax-registrations/index.web.tsx
  "/stripe-onboarding-return", // app/stripe-onboarding-return.tsx — hosted-onboarding HTTPS relay
] as const;

/**
 * INVITE-ACCEPT ROUTES — ORCH-1139 (D-1, Seth-folded-in 2026-06-15).
 *
 * Exempt from the sign-in redirect for the SAME reason as the connect routes:
 * a logged-OUT invitee opening an emailed invite link must reach the accept
 * page, not the sign-in wall. CONSTITUTIONAL CAVEAT: valid ONLY because each
 * page carries its OWN out-of-band credential — the invite TOKEN in the URL —
 * and performs its own authorization against that token. The exemption does NOT
 * make any brand/scanner data public; the page resolves nothing without a valid
 * invite token. Kept DISTINCT from the connect set and the buyer set so a
 * reviewer can reason about each class independently.
 *
 * `/accept-brand-invitation` also covers `/accept-brand-invitation/success`
 * (app/accept-brand-invitation/success.tsx) via the matcher's `base + "/"` clause.
 */
export const INVITE_ACCEPT_ROUTE_PREFIXES = [
  "/accept-brand-invitation", // app/accept-brand-invitation.tsx (+ /success sub-route)
  "/accept-scanner-invitation", // app/accept-scanner-invitation.tsx
] as const;

/**
 * Is the current pathname a SELF-AUTHENTICATING exempt route — ORCH-1139?
 *
 * Pure, RN-import-free (same discipline as `isPublicBuyerRoute`). Returns true
 * for any Stripe-Connect seller route OR invite-accept route — both classes
 * authenticate via an out-of-band credential in the URL (Stripe client_secret /
 * invite token), NOT via a Supabase web session, so the route-agnostic sign-in
 * redirect must NOT bounce them. Used to EXEMPT these routes from the redirect
 * (the exemption can only ever turn a redirect OFF — never ON).
 *
 * Matching is IDENTICAL to `isPublicBuyerRoute` (segment-safe prefix match on the
 * pathname only — no query string):
 * - null / undefined / empty / whitespace-only → false.
 * - Trim; strip a single trailing slash for `length > 1`.
 * - For each prefix `P`, let `base = P` without any trailing slash. Match iff
 *   `normalized === base` OR `normalized.startsWith(base + "/")` — the `+ "/"`
 *   keeps it SEGMENT-SAFE (`/connect-onboarding-evil` does NOT match).
 */
export const isSelfAuthenticatedExemptRoute = (
  pathname: string | null | undefined,
): boolean => {
  if (pathname === null || pathname === undefined) return false;
  const trimmed = pathname.trim();
  if (trimmed === "") return false;
  // Strip a single trailing slash (but never the root "/" itself).
  const normalized =
    trimmed.length > 1 && trimmed.endsWith("/")
      ? trimmed.slice(0, -1)
      : trimmed;
  return [
    ...SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES,
    ...INVITE_ACCEPT_ROUTE_PREFIXES,
  ].some((prefix) => {
    const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return normalized === base || normalized.startsWith(`${base}/`);
  });
};

/**
 * REDIRECT-TO-SIGN-IN, loop-safe + public-buyer-aware — ORCH-1103 + ORCH-1115.
 *
 * Combines the ORCH-1102 `shouldRedirectToSignIn` decision with the
 * already-at-sign-in guard (ORCH-1103): only emit the `<Redirect href="/" />`
 * when the user genuinely needs to leave the CURRENT route to reach sign-in.
 * When already on `/`, return false so the layout renders the Stack (welcome
 * screen) instead of redirecting to itself — killing the #185 self-redirect
 * loop. Native is never web, so this is a no-op off-web (matches
 * `shouldRedirectToSignIn`).
 *
 * ORCH-1115: ALSO returns false when the pathname is a PUBLIC BUYER route
 * (`isPublicBuyerRoute` / `PUBLIC_BUYER_ROUTE_PREFIXES`), so a logged-out guest
 * on a share-link / guest-checkout / receipt route is NOT bounced to the sign-in
 * wall. This clause composes BEFORE the existing ORCH-1102 + ORCH-1103 logic and
 * can ONLY flip a `true` to `false` (suppress a redirect on a public route) — it
 * NEVER causes a redirect that did not already fire, so no authed-only route's
 * behavior can change.
 *
 * ORCH-1139: ALSO returns false when the pathname is a SELF-AUTHENTICATING
 * exempt route (`isSelfAuthenticatedExemptRoute` — Stripe-Connect seller routes
 * `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` + invite-accept routes
 * `INVITE_ACCEPT_ROUTE_PREFIXES`). Same "can only suppress, never cause"
 * reasoning as the ORCH-1115 clause: these pages authenticate via an out-of-band
 * URL credential (Stripe client_secret / invite token), not a Supabase web
 * session, so the route-agnostic redirect must not bounce them to sign-in.
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
  !isSignInRoute(pathname) &&
  !isPublicBuyerRoute(pathname) &&
  !isSelfAuthenticatedExemptRoute(pathname);

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
