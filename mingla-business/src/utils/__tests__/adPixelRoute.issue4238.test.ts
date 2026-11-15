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

  test("the pixel list is the public buyer list minus the four account-service pages", () => {
    const pixel = PUBLIC_BUYER_ROUTE_PREFIXES.filter((prefix) =>
      isAdPixelRoute(`${prefix}x`),
    );
    const excluded = PUBLIC_BUYER_ROUTE_PREFIXES.filter(
      (prefix) => !pixel.includes(prefix),
    );
    expect([...excluded].sort()).toEqual(["/booking/", "/m/", "/pay/", "/refund/"]);
  });
});
