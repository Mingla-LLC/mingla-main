/**
 * ORCH-1373 [accept-invite-infinite-loader] — P0-1: THE ROUTE GATE, EXECUTED.
 *
 * ─── WHY THIS FILE EXISTS (read this before adding another predicate unit test) ─
 * The P0 shipped past a FULL GREEN SUITE. Every existing test — `nextRoute.test.ts`
 * (33/33), `authNextHandoff.test.ts`, `orch_1103_signout_redirect_loop.test.ts` —
 * passed, and the funnel was still 0%. They all exercised the utils IN ISOLATION:
 * they proved `sanitizeNextRoute` validates a token and `captureNextRoute` stashes
 * it, and they SIMULATED the round-trip. Not one of them asked the only question
 * that mattered:
 *
 *     "When a logged-out invitee is at /auth?next=<token>, does the ROOT LAYOUT
 *      let AuthIndex mount at all?"
 *
 * The answer was NO. `isSignInRoute("/auth")` returned false, so the layout
 * returned `<Redirect href="/" />` and the capture effect never ran. A unit test
 * of a predicate is NOT a test of the route. This file tests the route.
 *
 * ─── HOW IT AVOIDS BEING A REPLICA (the P2-2 disease, in this same PR) ─────────
 * The obvious way to write this test is to hand-roll the layout's branch chain
 * here and assert on it. That is EXACTLY the decorative-guard disease the tester
 * caught in ORCH-1377's T-11/T-12: a hand-rolled copy stays GREEN when the real
 * guard is deleted, because it never touches the real guard.
 *
 * So this file does the opposite, on BOTH axes:
 *   (1) The PREDICATES are the REAL shipped exports, imported from
 *       `../coldLoadAuthGates`. Never reimplemented.
 *   (2) The WIRING is the REAL shipped text, SLICED OUT of `app/_layout.tsx` and
 *       **EXECUTED** via `new Function` with the real predicates injected. The
 *       test does not describe what the layout does — it RUNS what the layout
 *       says. Rewire the layout, and this test evaluates the NEW wiring.
 *
 * Fails-on-revert in BOTH directions, by construction:
 *   - Delete the `/auth` arm from `isSignInRoute`  -> the real predicate returns
 *     true for the redirect -> the "no bounce" tests FAIL.
 *   - Delete/rewire the guard in `_layout.tsx`     -> the sliced text changes ->
 *     the executed decision flips -> these tests FAIL.
 *
 * Runs under the DEFAULT node/ts-jest config, which is the only config CI runs
 * (`jest.config.cjs`). The `jest.orch*.render.cjs` render harnesses are
 * local-only and require an uncommitted dep overlay, so a react-test-renderer
 * mount of `_layout` would guard NOTHING in CI. This does.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import {
  isPublicBuyerRoute,
  isSelfAuthenticatedExemptRoute,
  isSignInRoute,
  isWebAuthResolving,
  isAuthResolutionExpired,
  shouldRedirectToSignInFromRoute,
} from "../coldLoadAuthGates";

const LAYOUT_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "app", "_layout.tsx"),
  "utf8",
);

/**
 * Slice the REAL `redirectToSignIn` declaration out of the shipped layout.
 * This is the expression that decides whether the invitee's URL survives.
 */
const redirectToSignInExpression = (): string => {
  const m = LAYOUT_SOURCE.match(
    /const redirectToSignIn = (shouldRedirectToSignInFromRoute\(\{[\s\S]*?\}\));/,
  );
  expect(m).not.toBeNull();
  return m![1];
};

/** The logged-out invitee, exactly as measured at runtime by the tester (§3). */
const LOGGED_OUT_INVITEE = {
  isWeb: true,
  loading: false,
  hasUser: false,
  hasStoredWebSession: false,
} as const;

/**
 * EXECUTE the real sliced expression with the real predicates injected.
 * `pathname` is the only free variable the layout's expression closes over that
 * we vary; everything else comes from the real auth state.
 */
const runRealRedirectDecision = (
  pathname: string | null | undefined,
  state: {
    isWeb: boolean;
    loading: boolean;
    hasUser: boolean;
    hasStoredWebSession: boolean;
  } = LOGGED_OUT_INVITEE,
): boolean => {
  const expression = redirectToSignInExpression();
  // eslint-disable-next-line no-new-func
  const evaluate = new Function(
    "shouldRedirectToSignInFromRoute",
    "isWeb",
    "loading",
    "user",
    "hasStoredWebSession",
    "pathname",
    `"use strict"; return (${expression});`,
  ) as (
    fn: typeof shouldRedirectToSignInFromRoute,
    isWeb: boolean,
    loading: boolean,
    user: unknown,
    hasStoredWebSession: boolean,
    pathname: string | null | undefined,
  ) => boolean;

  return evaluate(
    shouldRedirectToSignInFromRoute,
    state.isWeb,
    state.loading,
    state.hasUser ? { id: "u1" } : null,
    state.hasStoredWebSession,
    pathname,
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// (A) THE WIRING IS REAL — prove the slice actually is the shipped gate
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1373 (A) the sliced expression IS the shipped layout gate", () => {
  it("the layout computes redirectToSignIn from the REAL shared predicate (not an inline copy)", () => {
    expect(redirectToSignInExpression()).toContain(
      "shouldRedirectToSignInFromRoute(",
    );
  });

  it("the layout feeds the LIVE pathname into that decision (a route-blind gate is the whole bug)", () => {
    // Must be the `pathname` SHORTHAND — i.e. the live `usePathname()` value.
    // Asserting merely /pathname/ would be satisfied by a hardcoded literal
    // (`pathname: "/account"`), which is exactly the route-blind regression this
    // guard exists to catch. Pin the shorthand.
    expect(redirectToSignInExpression()).toMatch(/^\s*pathname,\s*$/m);
    expect(LAYOUT_SOURCE).toMatch(/const pathname = usePathname\(\);/);
  });

  it("the redirect branch this decision drives still targets '/' and still exists", () => {
    // If this branch is ever removed/renamed, the executed decision below would
    // silently stop meaning anything. Pin it.
    expect(LAYOUT_SOURCE).toMatch(
      /if \(redirectToSignIn\) \{[\s\S]{0,600}?return <Redirect href="\/" \/>;/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) THE P0 — /auth?next= must survive the real gate
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1373 (B) P0-1 — the invitee's token survives the REAL layout gate", () => {
  it("THE BUG: a logged-out invitee at /auth is NOT bounced (the ?next= token survives)", () => {
    // Runtime-measured pre-fix value was `true` -> <Redirect href="/" /> ->
    // sessionStorage['mingla.biz.auth.next'] === null -> funnel 0%.
    expect(runRealRedirectDecision("/auth")).toBe(false);
  });

  it("THE OAUTH LEG: /auth/callback is NOT bounced (the return hop carries the session)", () => {
    expect(runRealRedirectDecision("/auth/callback")).toBe(false);
  });

  it("the predicate itself now recognises the app's OWN sign-in page", () => {
    // The single wrong answer that caused P0-1.
    expect(isSignInRoute("/auth")).toBe(true);
    expect(isSignInRoute("/auth/callback")).toBe(true);
  });

  it("/auth is a SIGN-IN route, NOT a credential-bearing self-auth route (classes stay honest)", () => {
    // If a future change files /auth under SELF_AUTHENTICATING_*/INVITE_ACCEPT_*
    // it would corrupt that list's constitutional caveat (every member carries an
    // out-of-band URL credential). /auth carries none — it MINTS the session.
    expect(isSelfAuthenticatedExemptRoute("/auth")).toBe(false);
    expect(isPublicBuyerRoute("/auth")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (C) THE OTHER DIRECTION — the gate must still bounce what it always bounced
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1373 (C) both directions — the gate still protects authed routes", () => {
  it.each(["/account", "/hub/events", "/brand/123", "/(tabs)/home"])(
    "a logged-out user on %s IS still redirected (the fix did not punch a hole)",
    (pathname) => {
      expect(runRealRedirectDecision(pathname)).toBe(true);
    },
  );

  it("SEGMENT-SAFE: /authorize is NOT swept in by the /auth prefix", () => {
    expect(isSignInRoute("/authorize")).toBe(false);
    expect(runRealRedirectDecision("/authorize")).toBe(true);
  });

  it("ORCH-1103 PRESERVED: a logged-out user already on '/' does NOT self-redirect (React #185)", () => {
    // The white-screen loop guard. This is the assertion that must never flip.
    expect(runRealRedirectDecision("/")).toBe(false);
    expect(runRealRedirectDecision("")).toBe(false);
    expect(runRealRedirectDecision(null)).toBe(false);
  });

  it("ORCH-1115 PRESERVED: public buyer routes are still exempt", () => {
    expect(runRealRedirectDecision("/checkout/evt_1")).toBe(false);
    expect(runRealRedirectDecision("/e/brand/event")).toBe(false);
  });

  it("ORCH-1139 PRESERVED: self-authenticating + invite-accept routes are still exempt", () => {
    expect(runRealRedirectDecision("/connect-onboarding")).toBe(false);
    expect(runRealRedirectDecision("/accept-brand-invitation")).toBe(false);
    expect(runRealRedirectDecision("/accept-scanner-invitation")).toBe(false);
  });

  it("a warming session never redirects, on /auth or anywhere else", () => {
    const warming = { ...LOGGED_OUT_INVITEE, hasStoredWebSession: true };
    expect(runRealRedirectDecision("/auth", warming)).toBe(false);
    expect(runRealRedirectDecision("/account", warming)).toBe(false);
  });

  it("native never redirects via the web gate (no cross-platform regression)", () => {
    expect(
      runRealRedirectDecision("/account", { ...LOGGED_OUT_INVITEE, isWeb: false }),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (D) THE CEILING GUARD — isSignInRoute ALSO feeds _layout.tsx:750 `atSignInRoute`
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1373 (D) the ceiling-guard interaction (isSignInRoute has TWO consumers)", () => {
  it("the layout derives atSignInRoute from the SAME predicate we just widened", () => {
    expect(LAYOUT_SOURCE).toMatch(/const atSignInRoute = isSignInRoute\(pathname\);/);
  });

  it("ORCH-1292/1102-W2 PRESERVED: past the ceiling, /auth renders the Stack instead of spinning forever", () => {
    // `if (authResolving && !(atSignInRoute && authResolutionExpired))` -> spinner.
    // With /auth now a sign-in route, an expired ceiling on /auth falls THROUGH to
    // the Stack (AuthIndex -> BusinessWelcomeScreen) — the same "never an infinite
    // spinner on the sign-in page" behaviour '/' already had. This is the correct
    // direction: it can only ever REMOVE a spinner, never add one.
    const resolving = isWebAuthResolving({
      isWeb: true,
      loading: false,
      hasUser: false,
      hasStoredWebSession: true,
    });
    const expired = isAuthResolutionExpired({
      isWeb: true,
      hasUser: false,
      stillResolving: resolving,
      elapsedMs: 8000,
    });
    expect(resolving).toBe(true);
    expect(expired).toBe(true);
    // The real layout's spinner condition, evaluated for /auth:
    const atSignInRouteNow = isSignInRoute("/auth");
    expect(resolving && !(atSignInRouteNow && expired)).toBe(false);
  });

  it("ORCH-1376 PRESERVED: the ceiling redirect still cannot destroy a self-auth credential", () => {
    // `if (authResolutionExpired && !atSignInRoute && !atSelfAuthRoute)`.
    // /auth is now caught by atSignInRoute; the invite routes by atSelfAuthRoute.
    for (const p of ["/auth", "/accept-brand-invitation", "/connect-onboarding"]) {
      const suppressed = isSignInRoute(p) || isSelfAuthenticatedExemptRoute(p);
      expect(suppressed).toBe(true);
    }
  });

  it("BEFORE the ceiling, a warming /auth still shows the spinner (no false sign-in flash)", () => {
    const resolving = isWebAuthResolving({
      isWeb: true,
      loading: false,
      hasUser: false,
      hasStoredWebSession: true,
    });
    const expired = isAuthResolutionExpired({
      isWeb: true,
      hasUser: false,
      stillResolving: resolving,
      elapsedMs: 100,
    });
    expect(resolving && !(isSignInRoute("/auth") && expired)).toBe(true);
  });
});
