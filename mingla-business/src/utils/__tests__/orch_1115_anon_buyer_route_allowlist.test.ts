/**
 * ORCH-1115 [anon-buyer web funnel restored] regression.
 *
 * Root cause: ORCH-1102 moved the unauthenticated "no dead-end" sign-in redirect
 * to the ROOT layout (`mingla-business/app/_layout.tsx`), which wraps EVERY
 * route, with NO allowlist for the intentionally-public buyer routes. A
 * genuinely logged-out guest opening a share link (`/e/ /t/ /b/ /exp/`), a guest
 * checkout (`/checkout/ /checkout-trip/ /checkout-experience/`), or a
 * post-purchase receipt / emailed cancel link (`/o/ /booking/`) was bounced to
 * the business sign-in wall; the buyer page + checkout never rendered. RLS is
 * fully permissive to anon — this was purely a client route-gate bug.
 *
 * The fix adds `PUBLIC_BUYER_ROUTE_PREFIXES` (single source of truth) +
 * `isPublicBuyerRoute` (segment-safe prefix matcher) to coldLoadAuthGates.ts and
 * ANDs `!isPublicBuyerRoute(pathname)` into `shouldRedirectToSignInFromRoute`
 * (and into the native `nativeRedirectToSignIn` path in _layout.tsx). The clause
 * can ONLY suppress a redirect on a public route — it never causes a redirect
 * that did not already fire, so no authed-only route's behavior can change.
 *
 * FAILS ON REVERT: T-1 asserts `shouldRedirectToSignInFromRoute` returns `false`
 * for a logged-out user on every public prefix. Delete the
 * `&& !isPublicBuyerRoute(pathname)` clause (or the constant) → T-1 flips to
 * `true` and FAILS, while T-2 (authed route) stays `true` and PASSES — proving
 * the allowlist is what suppresses the redirect, not a blanket change.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PUBLIC_BUYER_ROUTE_PREFIXES,
  isPublicBuyerRoute,
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

// Every public prefix + a representative deep sub-path under each, exactly as a
// real share link / guest checkout would arrive.
const PUBLIC_ROUTE_SAMPLES: string[] = [
  "/e/travelbrand",
  "/e/travelbrand/summer-rooftop",
  "/t/travelbrand",
  "/t/travelbrand/the-dc-adventure",
  "/b/travelbrand",
  "/exp/travelbrand",
  "/exp/travelbrand/sunset-sail",
  "/checkout/abc123",
  "/checkout/abc123/payment",
  "/checkout/abc123/confirm",
  "/checkout-trip/trip-event-9",
  "/checkout-trip/trip-event-9/buyer",
  "/checkout-experience/exp-event-3",
  "/checkout-experience/exp-event-3/payment",
  "/o/order-77",
  "/booking/order-77/cancel",
];

// Representative authed-ONLY routes that MUST still redirect a logged-out guest.
const AUTHED_ONLY_ROUTE_SAMPLES: string[] = [
  "/account",
  "/(tabs)/home",
  "/(tabs)/account",
  "/brand/123",
  "/event/456",
  "/trip/789",
  "/experience/012",
  "/venue/345",
  "/partner/onboarding",
  "/ari",
  "/support",
  "/notifications",
  "/connect-partner-onboarding",
  "/accept-invite",
  "/stripe-onboarding-return",
];

describe("ORCH-1115 T-1 (happy) — logged-out guest on a PUBLIC buyer route is NOT redirected", () => {
  test.each(PUBLIC_ROUTE_SAMPLES)(
    "%s → shouldRedirectToSignInFromRoute === false",
    (pathname) => {
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(false);
    },
  );
});

describe("ORCH-1115 T-2 (guard) — logged-out guest on an AUTHED-only route STILL redirects", () => {
  test.each(AUTHED_ONLY_ROUTE_SAMPLES)(
    "%s → shouldRedirectToSignInFromRoute === true (allowlist did NOT over-widen)",
    (pathname) => {
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(true);
    },
  );
});

describe("ORCH-1115 T-3 (edge) — segment-safety: lookalike paths must NOT match", () => {
  test.each([
    "/checkouter",
    "/checkout-thing",
    "/exposed",
    "/booking-x",
    "/events",
    "/trips",
    "/branded",
    "/expo",
  ])("isPublicBuyerRoute(%p) === false", (pathname) => {
    expect(isPublicBuyerRoute(pathname)).toBe(false);
  });

  test("a lookalike authed route still redirects (composed with the predicate)", () => {
    expect(
      shouldRedirectToSignInFromRoute({
        ...loggedOutOnWeb,
        pathname: "/checkouter",
      }),
    ).toBe(true);
  });
});

describe("ORCH-1115 T-4 (edge) — trailing slash + bare prefix both match", () => {
  test.each([
    "/checkout",
    "/checkout/",
    "/t/",
    "/t",
    "/e/",
    "/e",
    "/b/",
    "/b",
    "/exp/",
    "/exp",
    "/checkout-trip/",
    "/checkout-experience/",
    "/o/",
    "/o",
    "/booking/",
    "/booking",
  ])("isPublicBuyerRoute(%p) === true", (pathname) => {
    expect(isPublicBuyerRoute(pathname)).toBe(true);
  });
});

describe("ORCH-1115 T-5 (edge) — null/empty/whitespace pathname is NOT a public route", () => {
  test.each([null, undefined, "", " ", "   "])(
    "isPublicBuyerRoute(%p) === false",
    (pathname) => {
      expect(isPublicBuyerRoute(pathname as string | null | undefined)).toBe(
        false,
      );
    },
  );
});

describe("ORCH-1115 T-6 (regression) — logged-IN user on a public route still renders", () => {
  test.each(PUBLIC_ROUTE_SAMPLES)(
    "%s with hasUser:true → no redirect (already false; pins it stays so)",
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

describe("ORCH-1115 T-7 (regression) — a warming session never redirects (public OR authed)", () => {
  const warming = {
    isWeb: true,
    loading: false,
    hasUser: false,
    hasStoredWebSession: true,
  };

  test("warming on a public route → no redirect", () => {
    expect(
      shouldRedirectToSignInFromRoute({
        ...warming,
        pathname: "/t/brand/slug",
      }),
    ).toBe(false);
  });

  test("warming on an authed route → no redirect (spinner branch owns this)", () => {
    expect(
      shouldRedirectToSignInFromRoute({ ...warming, pathname: "/account" }),
    ).toBe(false);
  });
});

describe("ORCH-1115 T-8 (regression) — ORCH-1103 '/' loop guard intact", () => {
  test("logged-out on '/' → no redirect (the self-redirect loop guard is preserved)", () => {
    expect(
      shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname: "/" }),
    ).toBe(false);
  });

  test("'/' is NOT in the public allowlist (it is the sign-in route)", () => {
    expect(isPublicBuyerRoute("/")).toBe(false);
  });
});

describe("ORCH-1115 T-9 (single source of truth) — exactly one allowlist; web + native both consult it", () => {
  test("PUBLIC_BUYER_ROUTE_PREFIXES contains exactly the 9 spec'd prefixes", () => {
    expect([...PUBLIC_BUYER_ROUTE_PREFIXES]).toEqual([
      "/e/",
      "/t/",
      "/b/",
      "/exp/",
      "/checkout/",
      "/checkout-trip/",
      "/checkout-experience/",
      "/o/",
      "/booking/",
    ]);
  });

  test("coldLoadAuthGates.ts defines the constant exactly once", () => {
    const src = businessFile("src/utils/coldLoadAuthGates.ts");
    const occurrences = (
      src.match(/export const PUBLIC_BUYER_ROUTE_PREFIXES/g) ?? []
    ).length;
    expect(occurrences).toBe(1);
  });

  test("the web predicate ANDs in the public-route exemption", () => {
    const src = businessFile("src/utils/coldLoadAuthGates.ts");
    expect(src).toContain("!isPublicBuyerRoute(pathname)");
  });

  test("the native redirect path in _layout.tsx also consults isPublicBuyerRoute", () => {
    const layout = businessFile("app/_layout.tsx");
    expect(layout).toContain("isPublicBuyerRoute");
    // The native path explicitly ANDs the exemption in.
    expect(layout).toContain("!isPublicBuyerRoute(pathname)");
  });
});
