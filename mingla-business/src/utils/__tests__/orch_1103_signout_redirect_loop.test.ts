/**
 * ORCH-1103 [business-web sign-out white screen / React #185] regression.
 *
 * Root cause: the root `_layout` redirected EVERY unauthenticated route to `/`,
 * including `/` ITSELF. A layout that governs `/` and also returns
 * `<Redirect href="/" />` while already on `/` re-triggers navigation on every
 * render → unbounded render/navigation loop → React #185 ("Maximum update depth
 * exceeded") → torn-down tree → empty `#root` → WHITE SCREEN on sign-out.
 *
 * The fix adds a route-identity guard so the unauthenticated redirect (and the
 * ceiling-expired redirect) NEVER targets the route it is already on. These
 * tests pin the loop-safe predicates. They FAIL on revert of the fix because
 * `shouldRedirectToSignInFromRoute` did not exist and the layout had no
 * already-at-sign-in guard.
 */

import { describe, expect, test } from "@jest/globals";

import {
  isSignInRoute,
  SIGN_IN_ROUTE,
  shouldRedirectToSignIn,
  shouldRedirectToSignInFromRoute,
} from "../coldLoadAuthGates";

describe("ORCH-1103 isSignInRoute — the redirect-target identity guard", () => {
  test("the sign-in route constant is the root path", () => {
    expect(SIGN_IN_ROUTE).toBe("/");
  });

  test.each(["/", "", " ", null, undefined, "//"])(
    "treats %p as the sign-in route (redirect to self must be suppressed)",
    (pathname) => {
      expect(isSignInRoute(pathname as string | null | undefined)).toBe(true);
    },
  );

  test.each(["/home", "/account", "/(tabs)/home", "/brand/123", "/hub/events"])(
    "treats %p as a NON sign-in route (redirect away is allowed)",
    (pathname) => {
      expect(isSignInRoute(pathname)).toBe(false);
    },
  );
});

describe("ORCH-1103 shouldRedirectToSignInFromRoute — loop-safe redirect", () => {
  const loggedOutOnDeepRoute = {
    isWeb: true,
    loading: false,
    hasUser: false,
    hasStoredWebSession: false,
  };

  test("THE BUG: logged-out user ALREADY on '/' does NOT redirect (no /→/ loop)", () => {
    // The pre-fix predicate would have fired here (the self-redirect loop).
    expect(
      shouldRedirectToSignInFromRoute({
        ...loggedOutOnDeepRoute,
        pathname: "/",
      }),
    ).toBe(false);

    // Sanity: the underlying ORCH-1102 decision DID want a redirect here — proving
    // the route guard is what suppresses the self-redirect, not a changed auth
    // decision. (If this assertion ever flips, the fix is masking a different
    // behavior change rather than guarding the route.)
    expect(shouldRedirectToSignIn(loggedOutOnDeepRoute)).toBe(true);
  });

  test("logged-out user on a deep route STILL redirects to sign-in", () => {
    expect(
      shouldRedirectToSignInFromRoute({
        ...loggedOutOnDeepRoute,
        pathname: "/account",
      }),
    ).toBe(true);
  });

  test("empty/first-frame pathname is treated as '/' → no redirect (no loop)", () => {
    expect(
      shouldRedirectToSignInFromRoute({ ...loggedOutOnDeepRoute, pathname: "" }),
    ).toBe(false);
    expect(
      shouldRedirectToSignInFromRoute({
        ...loggedOutOnDeepRoute,
        pathname: null,
      }),
    ).toBe(false);
  });

  test("a warming session (stored web session, no user) never redirects, on any route", () => {
    const warming = {
      isWeb: true,
      loading: false,
      hasUser: false,
      hasStoredWebSession: true,
    };
    expect(
      shouldRedirectToSignInFromRoute({ ...warming, pathname: "/account" }),
    ).toBe(false);
    expect(
      shouldRedirectToSignInFromRoute({ ...warming, pathname: "/" }),
    ).toBe(false);
  });

  test("native is never web → never redirects (no cross-platform regression)", () => {
    expect(
      shouldRedirectToSignInFromRoute({
        isWeb: false,
        loading: false,
        hasUser: false,
        hasStoredWebSession: false,
        pathname: "/account",
      }),
    ).toBe(false);
  });

  test("a signed-in user never redirects, even on a deep route", () => {
    expect(
      shouldRedirectToSignInFromRoute({
        isWeb: true,
        loading: false,
        hasUser: true,
        hasStoredWebSession: true,
        pathname: "/account",
      }),
    ).toBe(false);
  });

  test("BOUNDED: the redirect decision converges — calling it N times with the same '/' inputs is stable false (no accumulating update)", () => {
    // A proxy for "the layout does not enter an unbounded update loop": the pure
    // decision for a logged-out user sitting on '/' is invariant across renders.
    const results = Array.from({ length: 50 }, () =>
      shouldRedirectToSignInFromRoute({
        ...loggedOutOnDeepRoute,
        pathname: "/",
      }),
    );
    expect(results.every((r) => r === false)).toBe(true);
  });
});
