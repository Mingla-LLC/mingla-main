/**
 * ORCH-1139 [Stripe setup redirects to business sign-in] — TESTER ADVERSARIAL
 * (segment-safety / boundary attack). Step-0.5 (b) per SPEC §10.
 *
 * DIFFERENT ANGLE than the implementor's happy-path suite
 * (`orch_1139_connect_seller_route_allowlist.test.ts`, which proves the 8 exempt
 * routes + their sub-paths are NOT redirected and a handful of private routes
 * STILL redirect). This suite attacks the SECURITY failure mode of the exemption
 * matcher: the dangerous direction is a FALSE-POSITIVE — a crafted path that is
 * NOT one of the 8 exempt routes (a near-miss lookalike, a traversal-prefixed
 * path, a case variant, trailing junk, or a query-string-smuggled path) wrongly
 * MATCHING `isSelfAuthenticatedExemptRoute` and thereby SUPPRESSING the sign-in
 * redirect on a route that should have stayed gated.
 *
 * The exemption can only ever flip a redirect TRUE→FALSE, so a false-positive
 * match means a genuinely-private/unknown route silently loses its sign-in gate.
 * Every assertion below pins that:
 *   (1) `isSelfAuthenticatedExemptRoute(x) === false` for the crafted path, and
 *   (2) the COMPOSED predicate `shouldRedirectToSignInFromRoute` STILL returns
 *       `true` for a logged-out web guest on that path.
 *
 * FAILS ON REVERT TO A LOOSE MATCHER: if the implementor had used a boundary-less
 * `pathname.includes(prefix)` or `pathname.startsWith(prefix)` (without the
 * `base + "/"` segment boundary), then `/connect-onboarding-evil`,
 * `/connect-onboardingX`, `/accept-brand-invitationX`, and
 * `/foo/connect-onboarding` (for `includes`) would wrongly match and these
 * assertions would FLIP and FAIL. The SEGMENT_BOUNDARY block below re-derives the
 * loose-matcher behavior inline and proves the production matcher diverges from
 * it on exactly the boundary cases — so a regression to `includes`/bare
 * `startsWith` reddens this suite.
 *
 * Tester-owned, append-only, on-branch, in the closing diff. It must PASS on the
 * fix.
 */

import { describe, expect, test } from "@jest/globals";

import {
  INVITE_ACCEPT_ROUTE_PREFIXES,
  SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES,
  isSelfAuthenticatedExemptRoute,
  shouldRedirectToSignInFromRoute,
} from "../coldLoadAuthGates";

const loggedOutOnWeb = {
  isWeb: true,
  loading: false,
  hasUser: false,
  hasStoredWebSession: false,
};

const ALL_EXEMPT_PREFIXES: readonly string[] = [
  ...SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES,
  ...INVITE_ACCEPT_ROUTE_PREFIXES,
];

/**
 * Crafted paths that are NOT exempt routes and MUST therefore (a) NOT match the
 * exemption matcher and (b) STILL redirect a logged-out guest to sign-in.
 *
 * These are the cases a loose `includes` / boundary-less `startsWith` would get
 * WRONG.
 */
const MUST_NOT_MATCH: string[] = [
  // --- near-miss SUFFIX (same start, extra chars past the segment boundary) ---
  "/connect-onboarding-evil", // SPEC SC-3 named case
  "/connect-onboardingX", // SPEC SC-3 named case
  "/connect-onboarding-return-attacker", // looks like onboarding-return but isn't
  "/connect-account-management-evil",
  "/connect-partner-onboarding-evil",
  "/connect-tax-registrations-evil",
  "/stripe-onboarding-return-fake", // SPEC SC-3 named case
  "/accept-brand-invitationX", // SPEC SC-3 named case
  "/accept-brand-invitation-evil",
  "/accept-scanner-invitationX",
  "/accept-scanner", // shorter lookalike — not a real route

  // --- TRAVERSAL / substring-in-the-middle (a loose `includes` would match) ---
  "/x/connect-onboarding", // SPEC SC-3 named case
  "/foo/connect-onboarding", // prefix-as-substring (SPEC mandate case)
  "/foo/accept-scanner-invitation",
  "/account/connect-onboarding", // private parent, exempt-looking tail
  "/brand/123/connect-onboarding", // deep private path containing the token
  "/notifications?next=/connect-onboarding", // smuggled in a query value
  "/some-connect-onboarding-page", // token embedded mid-segment

  // --- TRAILING JUNK that breaks the segment ---
  "/connect-onboardingfoo", // no separator at all
  "/accept-brand-invitationsuccess", // glued, no slash boundary

  // --- pure unknown / private (control) ---
  "/account",
  "/(tabs)/home",
  "/connect", // bare token, shorter than any prefix
  "/accept", // bare token, shorter than any prefix
];

/**
 * Paths that ARE the legitimate exempt routes in awkward-but-valid forms — these
 * MUST match (proving the matcher is not over-tightened to the point of rejecting
 * real arrivals).
 */
const MUST_MATCH: string[] = [
  "/connect-onboarding", // bare
  "/connect-onboarding/", // single trailing slash
  "/connect-onboarding/step2", // real sub-path
  "/accept-brand-invitation", // bare
  "/accept-brand-invitation/", // trailing slash
  "/accept-brand-invitation/success", // real sub-route
  "/accept-scanner-invitation/", // trailing slash
  "/stripe-onboarding-return", // @deprecated but live
];

describe("ORCH-1139 ADV-1 — near-miss SUFFIX lookalikes are NOT exempt and STILL redirect", () => {
  const suffixCases = MUST_NOT_MATCH.filter(
    (p) =>
      p.startsWith("/connect") ||
      p.startsWith("/stripe") ||
      p.startsWith("/accept"),
  );
  test.each(suffixCases)(
    "%s → isSelfAuthenticatedExemptRoute=false AND redirect=true",
    (pathname) => {
      expect(isSelfAuthenticatedExemptRoute(pathname)).toBe(false);
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(true);
    },
  );
});

describe("ORCH-1139 ADV-2 — traversal / substring-in-the-middle does NOT loosely match", () => {
  const traversal = [
    "/x/connect-onboarding",
    "/foo/connect-onboarding",
    "/foo/accept-scanner-invitation",
    "/account/connect-onboarding",
    "/brand/123/connect-onboarding",
    "/notifications?next=/connect-onboarding",
    "/some-connect-onboarding-page",
  ];
  test.each(traversal)(
    "%s → isSelfAuthenticatedExemptRoute=false AND redirect=true",
    (pathname) => {
      expect(isSelfAuthenticatedExemptRoute(pathname)).toBe(false);
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(true);
    },
  );
});

describe("ORCH-1139 ADV-3 — every MUST_NOT_MATCH path is rejected by the matcher", () => {
  test.each(MUST_NOT_MATCH)(
    "%s → isSelfAuthenticatedExemptRoute === false",
    (pathname) => {
      expect(isSelfAuthenticatedExemptRoute(pathname)).toBe(false);
    },
  );
});

describe("ORCH-1139 ADV-4 — case variants do NOT match (matcher is case-sensitive, real routes are lowercase)", () => {
  // Expo-router route paths are lowercase; an uppercased variant is NOT a real
  // route, so it must NOT be exempted (and must still redirect).
  const caseVariants = [
    "/Connect-Onboarding",
    "/CONNECT-ONBOARDING",
    "/Connect-Account-Management",
    "/Accept-Brand-Invitation",
    "/ACCEPT-SCANNER-INVITATION",
  ];
  test.each(caseVariants)(
    "%s → isSelfAuthenticatedExemptRoute=false AND redirect=true",
    (pathname) => {
      expect(isSelfAuthenticatedExemptRoute(pathname)).toBe(false);
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(true);
    },
  );
});

describe("ORCH-1139 ADV-5 — query-string smuggling cannot turn a private route exempt", () => {
  // A query string is part of the pathname string the gate could receive; an
  // attacker appending ?session=/connect-onboarding to a private route must NOT
  // flip it exempt. (The matcher does not strip query strings, but it also
  // anchors on the path PREFIX — so the leading private segment governs.)
  const smuggled = [
    "/account?redirect=/connect-onboarding",
    "/notifications?x=/accept-brand-invitation",
    "/?next=/connect-onboarding",
    "/brand/123?from=/stripe-onboarding-return",
  ];
  test.each(smuggled)(
    "%s → isSelfAuthenticatedExemptRoute=false AND redirect=true",
    (pathname) => {
      expect(isSelfAuthenticatedExemptRoute(pathname)).toBe(false);
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(true);
    },
  );

  // A LEGITIMATE exempt route WITH a trailing query string should still be
  // exempt only if the bare path is exempt; the matcher matches the literal
  // string, so "/connect-onboarding?session=abc" is one segment "/connect-
  // onboarding?session=abc" which does NOT equal the base and does NOT start with
  // base + "/". This is acceptable: at runtime usePathname() returns the path
  // WITHOUT the query, so the gate sees "/connect-onboarding". We assert the
  // documented behavior so a future refactor that changes query handling is
  // caught.
  test("query-bearing exempt path string (no path separator) is matched literally, not loosely", () => {
    // "/connect-onboarding?session=abc": "?" is not "/", so this is NOT a
    // sub-path of "/connect-onboarding" and must NOT match (boundary-safe).
    expect(
      isSelfAuthenticatedExemptRoute("/connect-onboarding?session=abc"),
    ).toBe(false);
  });
});

describe("ORCH-1139 ADV-6 — null/empty/whitespace inputs never match (no crash, no exemption)", () => {
  test.each([null, undefined, "", "   ", "\t", "\n"])(
    "%p → isSelfAuthenticatedExemptRoute === false",
    (pathname) => {
      expect(
        isSelfAuthenticatedExemptRoute(pathname as unknown as string),
      ).toBe(false);
    },
  );
});

describe("ORCH-1139 ADV-7 — legitimate exempt routes (bare / trailing-slash / sub-path) DO match", () => {
  test.each(MUST_MATCH)(
    "%s → isSelfAuthenticatedExemptRoute=true AND redirect=false",
    (pathname) => {
      expect(isSelfAuthenticatedExemptRoute(pathname)).toBe(true);
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(false);
    },
  );
});

describe("ORCH-1139 ADV-8 — the production matcher DIVERGES from a loose includes/startsWith on the boundary cases (regression sentinel)", () => {
  // Re-derive what a LOOSE matcher would do, then prove the production matcher
  // disagrees on at least the boundary cases. If someone reverts the production
  // matcher to a loose form, these expectations flip and FAIL.

  const looseIncludes = (pathname: string): boolean =>
    ALL_EXEMPT_PREFIXES.some((p) => pathname.includes(p));

  const looseStartsWith = (pathname: string): boolean =>
    ALL_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));

  test("a loose `includes` WOULD wrongly match traversal/suffix cases that the production matcher rejects", () => {
    // These are exactly the cases a boundary-less includes-matcher leaks.
    const leakedByIncludes = [
      "/x/connect-onboarding",
      "/foo/connect-onboarding",
      "/account/connect-onboarding",
      "/connect-onboarding-evil", // includes "/connect-onboarding"
      "/accept-brand-invitationX", // includes "/accept-brand-invitation"
    ];
    for (const p of leakedByIncludes) {
      // The loose matcher leaks (true)...
      expect(looseIncludes(p)).toBe(true);
      // ...but the PRODUCTION matcher must NOT.
      expect(isSelfAuthenticatedExemptRoute(p)).toBe(false);
    }
  });

  test("a loose `startsWith` WOULD wrongly match suffix lookalikes that the production matcher rejects", () => {
    const leakedByStartsWith = [
      "/connect-onboarding-evil",
      "/connect-onboardingX",
      "/connect-onboardingfoo",
      "/accept-brand-invitationX",
      "/accept-brand-invitationsuccess",
    ];
    for (const p of leakedByStartsWith) {
      expect(looseStartsWith(p)).toBe(true);
      expect(isSelfAuthenticatedExemptRoute(p)).toBe(false);
    }
  });

  test("on the LEGITIMATE bare + sub-path cases all three matchers agree (true) — proving divergence is only on the dangerous boundary", () => {
    const legit = [
      "/connect-onboarding",
      "/connect-onboarding/step2",
      "/accept-brand-invitation/success",
    ];
    for (const p of legit) {
      expect(looseIncludes(p)).toBe(true);
      expect(looseStartsWith(p)).toBe(true);
      expect(isSelfAuthenticatedExemptRoute(p)).toBe(true);
    }
  });
});
