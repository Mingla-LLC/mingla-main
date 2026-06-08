import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isWebAuthResolving,
  shouldRedirectToSignIn,
} from "../utils/coldLoadAuthGates";

/**
 * ORCH-1102 — business-web auth routing with NO dead-ends.
 *
 * Operator intent (Seth): "Remove all of it. If a user becomes unauthenticated,
 * route them back to the sign-in screen. If a user cancels an authentication
 * mid-process, route them back too. Users should not be left hanging — ever."
 *
 * This suite is the primary regression gate. Every assertion is written to FAIL
 * ON REVERT (proven in the IMPLEMENTATION report's fails-on-revert section):
 *
 *   (a) the Orch1092 / Orch1093 route-stub components + route lists are GONE
 *   (b) resolved + no user (no stored session) → redirect to sign-in (not a card)
 *   (c) a warming session (resolving) → LOADING (cold-load fix preserved)
 *   (d) BusinessWelcomeScreen's OTP mode has a direct "Back to sign-in options"
 *       (a cancel resets the state machine to idle — never a permanent limbo)
 *   (e) the static OAuth callback recovers to the sign-in screen on error
 *       (no dead end)
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const businessFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");

describe("ORCH-1102 — (a) all route-stub gates are removed from _layout.tsx", () => {
  const layout = stripComments(businessFile("app/_layout.tsx"));

  test("the signed-out recovery CARD component + its route list are gone", () => {
    expect(layout).not.toContain("Orch1092SignedOutRecovery");
    expect(layout).not.toContain("ORCH_1092_SIGNED_OUT_ROUTES");
    expect(layout).not.toContain("Sign in to open");
    expect(layout).not.toContain("Return to Home");
  });

  test("the mobile-web firewall stub + block-list + UA sniff are gone", () => {
    expect(layout).not.toContain("Orch1093MobileRouteRecovery");
    expect(layout).not.toContain("ORCH_1100_BLOCKED_MOBILE_WEB_ROUTES");
    expect(layout).not.toContain("isMobileWebRouteEntry");
    expect(layout).not.toContain("orch1093RouteStatus");
  });

  test("the outer pre-provider recovery branches are gone", () => {
    expect(layout).not.toContain("shouldShowOuterOrch1092Recovery");
    expect(layout).not.toContain("shouldShowOuterOrch1093Recovery");
    expect(layout).not.toContain('window.location.assign("/home")');
  });
});

describe("ORCH-1102 — (b) resolved + no user redirects to the real sign-in screen", () => {
  const layout = stripComments(businessFile("app/_layout.tsx"));

  test("_layout redirects to '/' (the real BusinessWelcomeScreen), not a card", () => {
    expect(layout).toContain("shouldRedirectToSignIn");
    expect(layout).toContain('<Redirect href="/" />');
  });

  test("shouldRedirectToSignIn fires for a genuinely logged-out web user", () => {
    // The load-bearing assertion: resolved (loading=false), no user, no stored
    // session → redirect TRUE. Revert (the old route-gated predicate) returns
    // false for a route outside the 5-route list, which fails this.
    expect(
      shouldRedirectToSignIn({
        isWeb: true,
        loading: false,
        hasUser: false,
        hasStoredWebSession: false,
      }),
    ).toBe(true);
  });

  test("does NOT redirect a signed-in user or during the warming window", () => {
    expect(
      shouldRedirectToSignIn({
        isWeb: true,
        loading: false,
        hasUser: true,
        hasStoredWebSession: false,
      }),
    ).toBe(false);
    expect(
      shouldRedirectToSignIn({
        isWeb: true,
        loading: false,
        hasUser: false,
        hasStoredWebSession: true,
      }),
    ).toBe(false);
  });

  test("never redirects on native (native keeps its own working flow)", () => {
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

describe("ORCH-1102 — (c) resolving shows LOADING (cold-load fix preserved)", () => {
  const layout = stripComments(businessFile("app/_layout.tsx"));

  test("_layout renders a loading screen while auth is resolving", () => {
    expect(layout).toContain("isWebAuthResolving");
    expect(layout).toContain("AuthResolvingScreen");
    expect(layout).toContain("ActivityIndicator");
  });

  test("RESOLVING while the bootstrap is in flight (loading=true)", () => {
    expect(
      isWebAuthResolving({
        isWeb: true,
        loading: true,
        hasUser: false,
        hasStoredWebSession: false,
      }),
    ).toBe(true);
  });

  test("RESOLVING in the warming window (loading=false, stored session restoring)", () => {
    // The exact cold-load residual: bootstrap timed out but the stored session
    // restores a beat later. Must show LOADING, NOT a flash of sign-in. Revert
    // (treating this as logged-out) would redirect and fail this.
    expect(
      isWebAuthResolving({
        isWeb: true,
        loading: false,
        hasUser: false,
        hasStoredWebSession: true,
      }),
    ).toBe(true);
  });

  test("NOT resolving once a user is present (render the app)", () => {
    expect(
      isWebAuthResolving({
        isWeb: true,
        loading: false,
        hasUser: true,
        hasStoredWebSession: true,
      }),
    ).toBe(false);
  });

  test("NOT resolving when genuinely logged out (no stored session) — redirect instead", () => {
    expect(
      isWebAuthResolving({
        isWeb: true,
        loading: false,
        hasUser: false,
        hasStoredWebSession: false,
      }),
    ).toBe(false);
  });

  test("resolving and redirect are mutually exclusive for every web state", () => {
    // No state may both show LOADING and redirect — that would be a flicker/hang.
    for (const loading of [true, false]) {
      for (const hasUser of [true, false]) {
        for (const hasStoredWebSession of [true, false]) {
          const args = { isWeb: true, loading, hasUser, hasStoredWebSession };
          expect(
            isWebAuthResolving(args) && shouldRedirectToSignIn(args),
          ).toBe(false);
        }
      }
    }
  });
});

describe("ORCH-1102 — (d) BusinessWelcomeScreen never strands a cancelling user", () => {
  const screen = businessFile("src/components/auth/BusinessWelcomeScreen.tsx");

  test("the OTP mode exposes a direct 'Back to sign-in options' that resets to idle", () => {
    // Revert (no direct back in otp-input) leaves the otp → edit → email → back
    // detour as the only escape; this asserts the one-tap reset exists.
    expect(screen).toContain("Back to sign-in options");
    // handleBackToIdle is the reset that returns mode to idle.
    expect(screen).toContain("handleBackToIdle");
    expect(screen).toMatch(/setMode\("idle"\)/);
  });

  test("a failed OTP verify returns the user to the otp-input mode (not a limbo)", () => {
    // On verify error the screen resets mode back to "otp-input" with controls
    // usable — never stuck on the verifying spinner.
    expect(screen).toMatch(/setMode\("otp-input"\)/);
  });
});

describe("ORCH-1102 — (e) the static OAuth callback recovers to sign-in on error", () => {
  const callback = businessFile("public/auth/callback.html");

  test("the error path reveals a Back-to-sign-in link AND auto-redirects to '/'", () => {
    expect(callback).toContain("recoverToSignIn");
    expect(callback).toContain('Back to sign in');
    expect(callback).toContain('window.location.replace("/")');
    // No longer a dead end telling the user to refresh with no action.
    expect(callback).not.toContain("Refresh, then sign in again.");
  });
});
