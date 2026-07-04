import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// [TEST-MOD-APPROVED ORCH-1102] The route-coupled `shouldShowSignedOutRecovery`
// predicate was REMOVED by ORCH-1102 (all route-stub gates retired; auth routing
// is now route-agnostic via `shouldRedirectToSignIn` + `isWebAuthResolving`).
// The signed-out-recovery describe block below is rewritten to exercise the new
// route-agnostic redirect predicate. The /brand and /account warming predicates
// are unchanged and their tests are preserved verbatim.
// [TEST-MOD-APPROVED ORCH-1292] Import extended with the new
// BRAND_RESOLVE_AUTH_CEILING_MS constant for the time-bound regression tests
// appended at the end of this file (Apple 2.1a infinite-spinner fix). Existing
// imports + tests are preserved verbatim.
import {
  BRAND_RESOLVE_AUTH_CEILING_MS,
  isAccountAuthWarming,
  isBrandRouteResolving,
  shouldRedirectToSignIn,
} from "../utils/coldLoadAuthGates";

// ORCH-1100 Wave 3 — cold-direct-load auth-readiness flash regression tests.
//
// THE RESIDUAL (Wave 2, device-proven): on a COLD direct load (refresh /
// bookmark, session not yet warm) of secondary authed routes, the screen
// briefly renders the SIGNED-OUT state instead of a loading state —
// `/account` shows the sign-in landing; `/brand/{ownId}` briefly shows
// "not found" — before settling into real content once the session warms.
//
// THE FIX: while auth/session is still resolving on a cold load, the route
// gate shows a LOADING state (spinner / "Loading…"), NOT the signed-out
// landing or "not found". The gate keys on "auth still resolving" (a stored
// web session exists but `user` hasn't been applied yet) — NOT merely on
// "no user" — so a genuinely logged-out user still sees the signed-out state.
//
// All three predicates are written to FAIL ON REVERT (see the IMPLEMENTATION
// report's fails-on-revert proof).

const REPO_ROOT = join(__dirname, "..", "..", "..");
const businessFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");

describe("ORCH-1100 Wave 3 — /brand/{id} cold-load shows LOADING not not-found", () => {
  test("RESOLVING while auth is not ready yet (the cold-load flash window)", () => {
    // The exact residual: brand id present, brand row null because the session
    // is still warming → must be treated as RESOLVING (spinner), not not-found.
    expect(
      isBrandRouteResolving({
        hasBrandId: true,
        brandIsNull: true,
        isAuthReady: false,
        queryIsFetched: false,
        queryIsLoading: true,
      }),
    ).toBe(true);
  });

  test("RESOLVING while the brand query has not fetched (auth ready, query mid-flight)", () => {
    expect(
      isBrandRouteResolving({
        hasBrandId: true,
        brandIsNull: true,
        isAuthReady: true,
        queryIsFetched: false,
        queryIsLoading: false,
      }),
    ).toBe(true);
  });

  test("NOT resolving once auth ready + query settled + still null → genuine not-found", () => {
    // This is the load-bearing assertion: a genuinely-missing brand must NOT be
    // trapped on a spinner. Revert (treating every null brand as loading) fails.
    expect(
      isBrandRouteResolving({
        hasBrandId: true,
        brandIsNull: true,
        isAuthReady: true,
        queryIsFetched: true,
        queryIsLoading: false,
      }),
    ).toBe(false);
  });

  test("NOT resolving once the brand row is in hand (populated)", () => {
    expect(
      isBrandRouteResolving({
        hasBrandId: true,
        brandIsNull: false,
        isAuthReady: false,
        queryIsFetched: false,
        queryIsLoading: true,
      }),
    ).toBe(false);
  });

  test("NOT resolving when there is no brand id segment (immediate not-found)", () => {
    expect(
      isBrandRouteResolving({
        hasBrandId: false,
        brandIsNull: true,
        isAuthReady: false,
        queryIsFetched: false,
        queryIsLoading: true,
      }),
    ).toBe(false);
  });
});

// [TEST-MOD-APPROVED ORCH-1102] Rewritten for the route-agnostic redirect
// predicate (`shouldRedirectToSignIn`) that replaced the route-coupled
// `shouldShowSignedOutRecovery`. The behavioral contract is the same — only a
// GENUINELY logged-out user is sent to sign-in; a warming session is NOT — but
// there is no longer a `routeIsSignedOutGated` route list (any web route
// redirects, so no route can be "left hanging").
describe("ORCH-1102 — redirect-to-sign-in only for real logged-out users (route-agnostic)", () => {
  test("does NOT redirect during the cold warming window (stored session exists)", () => {
    // Bootstrap timed out (loading=false), user null because the stored session
    // restores a beat later. A stored web session exists → must NOT redirect
    // (the root shows LOADING). Revert (no stored-session clause) fails.
    expect(
      shouldRedirectToSignIn({
        isWeb: true,
        loading: false,
        hasUser: false,
        hasStoredWebSession: true,
      }),
    ).toBe(false);
  });

  test("DOES redirect for a genuinely logged-out user (no stored session) — on ANY route", () => {
    // Real logged-out users go straight to the sign-in screen, not a dead-end.
    expect(
      shouldRedirectToSignIn({
        isWeb: true,
        loading: false,
        hasUser: false,
        hasStoredWebSession: false,
      }),
    ).toBe(true);
  });

  test("does NOT redirect while still loading (auth bootstrap in flight)", () => {
    expect(
      shouldRedirectToSignIn({
        isWeb: true,
        loading: true,
        hasUser: false,
        hasStoredWebSession: false,
      }),
    ).toBe(false);
  });

  test("does NOT redirect when a user is present", () => {
    expect(
      shouldRedirectToSignIn({
        isWeb: true,
        loading: false,
        hasUser: true,
        hasStoredWebSession: false,
      }),
    ).toBe(false);
  });

  test("does NOT run on native (no web localStorage / redirect concept)", () => {
    expect(
      shouldRedirectToSignIn({
        isWeb: false,
        loading: false,
        hasUser: false,
        hasStoredWebSession: false,
      }),
    ).toBe(false);
  });
});

describe("ORCH-1100 Wave 3 — /account brand area shows LOADING (not blank) while warming", () => {
  test("WARMING when status resolved to signed_out but a stored session exists", () => {
    expect(
      isAccountAuthWarming({
        brandListStatus: "signed_out",
        hasStoredWebSession: true,
      }),
    ).toBe(true);
  });

  test("WARMING when status resolved to query_disabled but a stored session exists", () => {
    expect(
      isAccountAuthWarming({
        brandListStatus: "query_disabled",
        hasStoredWebSession: true,
      }),
    ).toBe(true);
  });

  test("NOT warming when there is no stored session (genuinely signed out)", () => {
    expect(
      isAccountAuthWarming({
        brandListStatus: "signed_out",
        hasStoredWebSession: false,
      }),
    ).toBe(false);
  });

  test("NOT warming for a real loaded status (ready)", () => {
    expect(
      isAccountAuthWarming({
        brandListStatus: "ready",
        hasStoredWebSession: true,
      }),
    ).toBe(false);
  });
});

describe("ORCH-1100 Wave 3 — route wiring (the fix is actually mounted)", () => {
  // [TEST-MOD-APPROVED ORCH-1102] _layout.tsx no longer renders a signed-out
  // recovery CARD; it now redirects to the real sign-in screen via the
  // route-agnostic predicates. Assert the new wiring instead.
  test("app/_layout.tsx routes unauthenticated users via the route-agnostic predicates", () => {
    const layout = businessFile("app/_layout.tsx");
    expect(layout).toContain("shouldRedirectToSignIn");
    expect(layout).toContain("isWebAuthResolving");
    expect(layout).toContain('<Redirect href="/" />');
    // The dead-end card components and route lists are GONE.
    expect(layout).not.toContain("Orch1092SignedOutRecovery");
    expect(layout).not.toContain("ORCH_1092_SIGNED_OUT_ROUTES");
  });

  test("app/brand/[id]/index.tsx passes isResolving to BrandProfileView", () => {
    const route = businessFile("app/brand/[id]/index.tsx");
    expect(route).toContain("isBrandRouteResolving");
    expect(route).toContain("isResolving={isBrandResolving}");
  });

  test("BrandProfileView renders a loading branch before the not-found branch", () => {
    const view = businessFile("src/components/brand/BrandProfileView.tsx");
    expect(view).toContain("brand === null && isResolving");
    expect(view).toContain("brand-profile-loading");
  });

  test("(tabs)/account.tsx renders Loading while auth is warming", () => {
    const account = businessFile("app/(tabs)/account.tsx");
    expect(account).toContain("isAccountAuthWarming");
    expect(account).toContain("isAuthWarming");
  });
});

// ORCH-1292 (Apple 2.1a) — the `!isAuthReady` warm-window term is now
// TIME-BOUNDED so a brand read that has already settled to null can never spin
// forever when auth never becomes ready (Apple's throttled review network).
// These append-only tests FAIL ON REVERT of the time-bound (reverting drops the
// ceiling → the settled-null + stuck-auth case stays `true` forever again).
describe("ORCH-1292 — brand-resolve auth-warm window is time-bounded (no infinite spinner)", () => {
  test("still RESOLVING within the ceiling: settled-null + auth-not-ready + elapsed < ceiling", () => {
    expect(
      isBrandRouteResolving({
        hasBrandId: true,
        brandIsNull: true,
        isAuthReady: false,
        queryIsFetched: true,
        queryIsLoading: false,
        elapsedMs: BRAND_RESOLVE_AUTH_CEILING_MS - 1,
      }),
    ).toBe(true);
  });

  test("NOT resolving past the ceiling: settled-null + auth-STUCK-not-ready + elapsed >= ceiling → not-found (the fix)", () => {
    // The load-bearing assertion: on Apple's network `isAuthReady` can stay
    // false forever; once the read has settled to null and the ceiling has
    // passed, degrade to not-found instead of a permanent spinner.
    expect(
      isBrandRouteResolving({
        hasBrandId: true,
        brandIsNull: true,
        isAuthReady: false,
        queryIsFetched: true,
        queryIsLoading: false,
        elapsedMs: BRAND_RESOLVE_AUTH_CEILING_MS,
      }),
    ).toBe(false);
  });

  test("an in-flight read is ALWAYS resolving regardless of elapsed (never a premature not-found)", () => {
    expect(
      isBrandRouteResolving({
        hasBrandId: true,
        brandIsNull: true,
        isAuthReady: false,
        queryIsFetched: false,
        queryIsLoading: true,
        elapsedMs: BRAND_RESOLVE_AUTH_CEILING_MS * 10,
      }),
    ).toBe(true);
  });

  test("default elapsedMs preserves the pre-1292 behavior (backward-compatible)", () => {
    // No elapsedMs passed → treated as 0 (< ceiling) → identical to the original
    // sticky term, so every existing call site keeps its exact prior behavior.
    expect(
      isBrandRouteResolving({
        hasBrandId: true,
        brandIsNull: true,
        isAuthReady: false,
        queryIsFetched: true,
        queryIsLoading: false,
      }),
    ).toBe(true);
  });

  test("app/brand/[id]/index.tsx feeds a live elapsedMs so the bound actually fires", () => {
    const route = businessFile("app/brand/[id]/index.tsx");
    expect(route).toContain("elapsedMs: Date.now() - mountedAtRef.current");
    expect(route).toContain("BRAND_RESOLVE_AUTH_CEILING_MS");
  });
});

// ORCH-1292 (Apple 5.1.1v) — DIRECT account-deletion entry in the Settings hub.
describe("ORCH-1292 — account deletion is directly findable in the Settings hub", () => {
  test("(tabs)/account.tsx has a Delete account row routing to /account/delete", () => {
    const account = businessFile("app/(tabs)/account.tsx");
    expect(account).toContain('label="Delete account"');
    expect(account).toContain('router.push("/account/delete" as never)');
  });
});
