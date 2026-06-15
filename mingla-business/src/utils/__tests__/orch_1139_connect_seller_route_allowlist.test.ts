/**
 * ORCH-1139 [Stripe setup redirects to business sign-in] — implementor happy-path.
 *
 * Root cause: ORCH-1102's route-agnostic root-layout sign-in redirect bounces
 * EVERY web route without a Supabase web session to `/`. Its only escape hatch
 * was `PUBLIC_BUYER_ROUTE_PREFIXES` (ORCH-1115), scoped to anon BUYER routes —
 * never extended to the self-authenticating Stripe-Connect SELLER routes (opened
 * by the native "Set up payments" CTA in a SESSIONLESS in-app browser) or the
 * invite-accept routes. So a logged-in seller tapping "Connect bank" landed on
 * the business sign-in wall instead of the Stripe onboarding form.
 *
 * The fix adds two distinct exemption sets —
 * `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` (6 connect routes) and
 * `INVITE_ACCEPT_ROUTE_PREFIXES` (2 invite routes) — plus the segment-safe
 * matcher `isSelfAuthenticatedExemptRoute`, ANDed into
 * `shouldRedirectToSignInFromRoute` (web) and `nativeRedirectToSignIn`
 * (_layout.tsx native). Each class authenticates via an out-of-band URL
 * credential (Stripe client_secret / invite token), NOT a Supabase session, so
 * the exemption exposes no account data.
 *
 * FAILS ON REVERT: delete the `&& !isSelfAuthenticatedExemptRoute(pathname)`
 * clause from `shouldRedirectToSignInFromRoute` → T-A1/A2/A3 flip to `true` and
 * FAIL, while T-A4 (private routes) stays `true` and PASSES — proving the new
 * allowlist (not a blanket change) is what suppresses the redirect. Restore →
 * all PASS.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  INVITE_ACCEPT_ROUTE_PREFIXES,
  SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES,
  isSelfAuthenticatedExemptRoute,
  shouldRedirectToSignInFromRoute,
} from "../coldLoadAuthGates";

// __dirname = mingla-business/src/utils/__tests__ → up 3 = mingla-business.
const BUSINESS_ROOT = join(__dirname, "..", "..", "..");
const businessFile = (relativePath: string): string =>
  readFileSync(join(BUSINESS_ROOT, relativePath), "utf8");

const loggedOutOnWeb = {
  isWeb: true,
  loading: false,
  hasUser: false,
  hasStoredWebSession: false,
};

// Every exempt route (bare), exactly as the native in-app browser / direct
// browser visit would arrive.
const EXEMPT_BARE_ROUTES: string[] = [
  "/connect-onboarding",
  "/connect-account-management",
  "/connect-partner-onboarding",
  "/connect-partner-account-management",
  "/connect-tax-registrations",
  "/stripe-onboarding-return",
  "/accept-brand-invitation",
  "/accept-scanner-invitation",
];

// A representative sub-path under each exempt route (Stripe / Expo may append a
// segment); all must remain exempt via the segment-safe `base + "/"` clause.
const EXEMPT_SUBPATH_ROUTES: string[] = [
  "/connect-onboarding/step2",
  "/connect-account-management/edit",
  "/connect-partner-onboarding/return",
  "/connect-partner-account-management/edit",
  "/connect-tax-registrations/settings",
  "/stripe-onboarding-return/done",
  "/accept-brand-invitation/success", // the real sub-route
  "/accept-scanner-invitation/done",
];

// Private routes that MUST still redirect a logged-out user (the allowlist did
// not over-widen).
const STILL_PRIVATE_ROUTES: string[] = [
  "/account",
  "/(tabs)/home",
  "/brand/123",
  "/notifications",
];

describe("ORCH-1139 T-A1 (happy) — logged-out on each exempt CONNECT/INVITE route (bare) is NOT redirected", () => {
  test.each(EXEMPT_BARE_ROUTES)(
    "%s → shouldRedirectToSignInFromRoute === false",
    (pathname) => {
      expect(isSelfAuthenticatedExemptRoute(pathname)).toBe(true);
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(false);
    },
  );
});

describe("ORCH-1139 T-A2 (happy) — logged-out on an exempt route + sub-path is NOT redirected", () => {
  test.each(EXEMPT_SUBPATH_ROUTES)(
    "%s → shouldRedirectToSignInFromRoute === false",
    (pathname) => {
      expect(isSelfAuthenticatedExemptRoute(pathname)).toBe(true);
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(false);
    },
  );
});

describe("ORCH-1139 T-A3 (happy) — each invite-accept route resolves exempt", () => {
  test.each([
    "/accept-brand-invitation",
    "/accept-brand-invitation/success",
    "/accept-scanner-invitation",
  ])("%s → isSelfAuthenticatedExemptRoute === true", (pathname) => {
    expect(isSelfAuthenticatedExemptRoute(pathname)).toBe(true);
    expect(
      shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
    ).toBe(false);
  });
});

describe("ORCH-1139 T-A4 (guard) — logged-out on a still-PRIVATE route STILL redirects", () => {
  test.each(STILL_PRIVATE_ROUTES)(
    "%s → shouldRedirectToSignInFromRoute === true (allowlist did NOT over-widen)",
    (pathname) => {
      expect(isSelfAuthenticatedExemptRoute(pathname)).toBe(false);
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(true);
    },
  );
});

describe("ORCH-1139 T-A5 (regression) — logged-IN on an exempt route also does not redirect", () => {
  test.each(EXEMPT_BARE_ROUTES)(
    "%s with hasUser:true → no redirect",
    (pathname) => {
      expect(
        shouldRedirectToSignInFromRoute({
          isWeb: true,
          loading: false,
          hasUser: true,
          hasStoredWebSession: true,
          pathname,
        }),
      ).toBe(false);
    },
  );
});

describe("ORCH-1139 T-A6 (regression) — a warming session on an exempt route never redirects", () => {
  const warming = {
    isWeb: true,
    loading: false,
    hasUser: false,
    hasStoredWebSession: true,
  };
  test.each(EXEMPT_BARE_ROUTES)("%s warming → no redirect", (pathname) => {
    expect(
      shouldRedirectToSignInFromRoute({ ...warming, pathname }),
    ).toBe(false);
  });
});

describe("ORCH-1139 T-A7 (single source of truth) — constants defined once; web + native consult the matcher", () => {
  test("SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES contains exactly the 6 spec'd prefixes", () => {
    expect([...SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES]).toEqual([
      "/connect-onboarding",
      "/connect-account-management",
      "/connect-partner-onboarding",
      "/connect-partner-account-management",
      "/connect-tax-registrations",
      "/stripe-onboarding-return",
    ]);
  });

  test("INVITE_ACCEPT_ROUTE_PREFIXES contains exactly the 2 spec'd prefixes", () => {
    expect([...INVITE_ACCEPT_ROUTE_PREFIXES]).toEqual([
      "/accept-brand-invitation",
      "/accept-scanner-invitation",
    ]);
  });

  test("coldLoadAuthGates.ts defines each constant exactly once", () => {
    const src = businessFile("src/utils/coldLoadAuthGates.ts");
    expect(
      (
        src.match(
          /export const SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES/g,
        ) ?? []
      ).length,
    ).toBe(1);
    expect(
      (src.match(/export const INVITE_ACCEPT_ROUTE_PREFIXES/g) ?? []).length,
    ).toBe(1);
    expect(
      (src.match(/export const isSelfAuthenticatedExemptRoute/g) ?? []).length,
    ).toBe(1);
  });

  test("the web predicate ANDs in the self-authenticated exemption", () => {
    const src = businessFile("src/utils/coldLoadAuthGates.ts");
    expect(src).toContain("!isSelfAuthenticatedExemptRoute(pathname)");
  });

  test("the native redirect path in _layout.tsx also consults isSelfAuthenticatedExemptRoute", () => {
    const layout = businessFile("app/_layout.tsx");
    expect(layout).toContain("isSelfAuthenticatedExemptRoute");
    expect(layout).toContain("!isSelfAuthenticatedExemptRoute(pathname)");
  });
});
