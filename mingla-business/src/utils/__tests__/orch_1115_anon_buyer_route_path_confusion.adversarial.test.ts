/**
 * ORCH-1115 [anon-buyer web funnel restored] — TESTER ADVERSARIAL (path-confusion).
 *
 * DIFFERENT ANGLE than the implementor's happy-path allowlist suite
 * (`orch_1115_anon_buyer_route_allowlist.test.ts`, which proves the 9 public
 * prefixes are exempted and a handful of lookalikes — `/checkouter`, `/exposed`
 * — are not). This suite attacks the SECURITY failure mode: can a crafted path
 * that is REALLY an authed-only route (or no route at all) wrongly MATCH the
 * public allowlist and thereby LEAK an authed surface to a logged-out guest, or
 * conversely bypass the matcher with encoding / traversal / empty-segment junk?
 *
 * The allowlist can only ever flip a redirect TRUE→FALSE, so the dangerous
 * direction is a FALSE-POSITIVE match: `isPublicBuyerRoute(x) === true` for an
 * `x` that should have stayed gated. Every assertion below pins that the matcher
 * does NOT over-match, and that the COMPOSED predicate
 * `shouldRedirectToSignInFromRoute` still returns `true` for a logged-out guest
 * on any such crafted path.
 *
 * Tester-owned, append-only, on-branch, in the closing diff. Fails-on-revert is
 * NOT this file's contract (the implementor's T-1 owns that); this file's job is
 * to prove the fix did not open a path-confusion hole. It must PASS on the fix.
 */

import { describe, expect, test } from "@jest/globals";

import {
  isPublicBuyerRoute,
  shouldRedirectToSignInFromRoute,
} from "../coldLoadAuthGates";

const loggedOutOnWeb = {
  isWeb: true,
  loading: false,
  hasUser: false,
  hasStoredWebSession: false,
};

/**
 * RUNTIME-PROVEN PRECONDITION (tester drive, 2026-06-11, headless Chromium
 * against the branch web export served SPA-fallback):
 *
 * Dot-segment traversal paths (`/e/../account`, `/checkout/../account`,
 * `/exp/../../brand/x`, `/e/%2e%2e/account`) are NORMALIZED BY THE BROWSER per
 * RFC-3986 / WHATWG-URL BEFORE the request is sent — so `/e/../account` arrives
 * at the SPA (and therefore at `usePathname()` / this gate) already collapsed to
 * `/account`. The proof: all five traversal forms were driven logged-out and
 * every one resolved to `/` showing the BusinessWelcomeScreen sign-in wall (NOT
 * a public page). The gate therefore NEVER receives the raw dotted form at
 * runtime; asserting `isPublicBuyerRoute("/e/../account")` is asserting an input
 * the production gate cannot see. (The textual matcher WOULD treat `/e/../x` as
 * an `/e/` subpath, but that is unreachable — and even if reached, the SPA
 * router, not this gate, resolves the segment to the authed screen which then
 * applies its own gate.) These cases are intentionally NOT in MUST_NOT_MATCH;
 * the runtime traversal proof lives in the TEST report, and the encoding suite
 * (ADV-3) pins the non-normalized encoded forms the gate CAN see.
 */

/**
 * Paths that are NOT legitimate public buyer routes AND that the gate genuinely
 * receives (no browser pre-normalization). A `true` from `isPublicBuyerRoute` on
 * ANY of these would be a security regression — an authed surface or junk would
 * be exempted from the sign-in redirect.
 */
const MUST_NOT_MATCH: [string, string][] = [
  // --- authed first-segment must never match, even with public-looking tails ---
  ["/account/e/x", "authed /account with a /e/ tail"],
  ["/account/checkout/x", "authed /account with a /checkout/ tail"],
  ["/brand/123/e/x", "authed /brand with /e/ tail"],
  ["/(tabs)/home/checkout/x", "authed tabs with /checkout/ tail"],
  ["/notifications/o/1", "authed /notifications with /o/ tail"],

  // --- segment-boundary confusion (extends the implementor's /checkouter case) ---
  ["/echo", "/e + cho — must not match /e/"],
  ["/blog", "/b + log — must not match /b/"],
  ["/orders", "/o + rders — must not match /o/"],
  ["/experience", "/exp... but the AUTHED experience route, not /exp/"],
  ["/experiences", "plural authed-ish — not /exp/"],
  ["/checkout-experiences", "trailing junk on /checkout-experience"],
  ["/bookings", "/booking + s — must not match /booking/"],
  ["/tickets", "/t + ickets — must not match /t/"],

  // --- empty-segment / double-slash junk ---
  ["//account", "protocol-relative-ish // then account"],
  ["//e/x", "leading double slash before a public-looking tail"],

  // --- whitespace / control padding around an authed route ---
  ["  /account  ", "whitespace-padded authed route"],
];

describe("ORCH-1115 ADV-1 (path-confusion) — crafted non-public paths must NOT match the allowlist", () => {
  test.each(MUST_NOT_MATCH)(
    "isPublicBuyerRoute(%j) === false  (%s)",
    (pathname) => {
      expect(isPublicBuyerRoute(pathname)).toBe(false);
    },
  );
});

describe("ORCH-1115 ADV-2 (composed guard) — a logged-out guest on any crafted non-public path STILL redirects", () => {
  test.each(MUST_NOT_MATCH)(
    "shouldRedirectToSignInFromRoute(%j) === true  (%s)",
    (pathname) => {
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(true);
    },
  );
});

describe("ORCH-1115 ADV-3 (encoding) — URL-encoded authed routes do not bypass the redirect", () => {
  // The gate matches on a literal pathname. An encoded path that does NOT
  // textually equal/prefix a public base must NOT match, so the guest is still
  // redirected. (Expo Router decodes before the gate sees it; we pin both the
  // raw-encoded and a hostile decoded-looking string.)
  const ENCODED: string[] = [
    "/%61ccount", // %61 = 'a' → "/account" only AFTER decode; raw must not match a public prefix
    "/account%2Fe", // encoded slash inside an authed route
    "/e%2F..%2Faccount", // encoded traversal — must not match /e/
    "/checkout%00/x", // null-byte injection attempt
  ];
  test.each(ENCODED)("isPublicBuyerRoute(%j) === false", (pathname) => {
    expect(isPublicBuyerRoute(pathname)).toBe(false);
  });
  test.each(ENCODED)(
    "shouldRedirectToSignInFromRoute(%j) === true",
    (pathname) => {
      expect(
        shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
      ).toBe(true);
    },
  );
});

describe("ORCH-1115 ADV-4 (positive control) — a genuine deep public subpath DOES match (proves the suite is not vacuously passing)", () => {
  test.each([
    "/e/brand/event",
    "/checkout/evt-1/payment",
    "/exp/lanternvine/raleigh-wine-and-dine-crawl",
    "/o/order-123",
    "/booking/order-123/cancel",
  ])("isPublicBuyerRoute(%j) === true", (pathname) => {
    expect(isPublicBuyerRoute(pathname)).toBe(true);
  });
});
