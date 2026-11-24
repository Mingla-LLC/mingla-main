// MINGLA-INVARIANT: I-4238-NO-BUYER-PIXEL-ON-HOST-ROUTES | issue #4238 | no PageView, ViewContent or buyer conversion pixel boots or fires on a host.usemingla.com route that is not a public buyer shopping page.
/**
 * #4238 W2-4 (D14). The host dashboard booted the buyer pixels and sent
 * about 300 PageViews a day into buyer audiences. isAdPixelRoute is the one
 * predicate the web analytics layer asks before booting or firing.
 */
import {
  isAdPixelRoute,
  PUBLIC_BUYER_ROUTE_PREFIXES,
} from "../coldLoadAuthGates";

describe("#4238 W2-4 isAdPixelRoute", () => {
  test.each([
    "/e/a/b",
    "/t/brand/trip",
    "/b/brand",
    "/b/brand/v/venue",
    "/exp/brand/experience",
    "/checkout/x",
    "/checkout/x/confirm",
    "/checkout-trip/x",
    "/checkout-experience/x",
    "/reserve/brand/confirm",
    "/o/1",
    "/attendance/claim/",
    "/e/a/b/",
  ])("%s is a buyer pixel route", (path) => {
    expect(isAdPixelRoute(path)).toBe(true);
  });

  test.each([
    "/",
    "",
    "/events",
    "/account",
    "/team",
    "/auth",
    "/auth/callback",
    "/brand/1/team",
    "/pay/t",
    "/refund/r1/attention",
    "/booking/o1/cancel",
    "/m/token",
    "/checkouter",
    "/order/1",
  ])("%s is not a buyer pixel route", (path) => {
    expect(isAdPixelRoute(path)).toBe(false);
  });

  test("null and undefined are not pixel routes", () => {
    expect(isAdPixelRoute(null)).toBe(false);
    expect(isAdPixelRoute(undefined)).toBe(false);
  });

  test("the pixel list is the public buyer list minus the account-service pages (and #4514's form links)", () => {
    const pixel = PUBLIC_BUYER_ROUTE_PREFIXES.filter((prefix) =>
      isAdPixelRoute(`${prefix}x`),
    );
    const excluded = PUBLIC_BUYER_ROUTE_PREFIXES.filter(
      (prefix) => !pixel.includes(prefix),
    );
    // TEST-MOD-APPROVED #4490: /visit/ (a token-opened booking page) is not a shopping page either.
    // TEST-MOD-APPROVED #4490 (Explorer W1): /paid/ (the app payment return) is not a shopping page.
    // TEST-MOD-APPROVED #4490 (spec 08 O1): /receipt/ (a token-opened Till receipt) is not a shopping page.
    expect([...excluded].sort()).toEqual(["/booking/", "/form/", "/m/", "/paid/", "/pay/", "/receipt/", "/refund/", "/stay/pay/", "/visit/"]);
  });
});
