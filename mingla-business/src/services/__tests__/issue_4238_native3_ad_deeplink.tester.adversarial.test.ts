/* eslint-disable import/first */
// Issue #4238 — independent tester, final native pass 3 (at e21f7835e0).
//
// The Android walk proved a business.ad_ended notice opens its ad. These cases
// attack the same routing from angles the W6b/W6c implementor suites skip:
// 1. a plan segment carrying a query, a fragment-like tail or extra segments
//    still opens that plan, and nothing after it leaks into the route;
// 2. a traversal or non-UUID plan never becomes a route segment (Promote);
// 3. a brand id that is not a UUID (including one smuggling "&by=") never
//    rides along as &brand=;
// 4. an ad notice with an unparseable https deep link falls back to its
//    snake_case plan_id, and a non-string planId falls back to Promote.

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: null }) },
}));
jest.mock("../supabase", () => ({ supabase: { from: jest.fn() } }));

import { parseBusinessDeepLink, resolveBusinessNavTarget } from "../businessNotificationRouting";

const BRAND = "4238f1a0-0000-4000-8000-000000000001";
const PLAN = "4238f1a0-0000-4000-8000-100000000006";
const PROMOTE = "/(tabs)/marketing/ads";
const AD = `/(tabs)/marketing/ads/${PLAN}?by=plan&brand=${BRAND}`;

describe("#4238 native 3: an ad deep link opens exactly that ad or Promote", () => {
  test("a query on the plan segment is dropped, not carried into the route", () => {
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/ads/${PLAN}?utm=push&by=campaign`)).toBe(AD);
  });

  test("extra segments after the plan are ignored", () => {
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/ads/${PLAN}/end`)).toBe(AD);
  });

  test("an upper-case plan id still opens the ad", () => {
    const upper = PLAN.toUpperCase();
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/ads/${upper}`)).toBe(
      `/(tabs)/marketing/ads/${upper}?by=plan&brand=${BRAND}`,
    );
  });

  test("a traversal or a near-UUID plan opens Promote, never a route segment", () => {
    for (const plan of ["..", "..%2F..%2Faccount", `${PLAN}x`, PLAN.slice(0, 35), "00000000-0000-0000-0000-000000000000"]) {
      expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/ads/${plan}`)).toBe(PROMOTE);
    }
  });

  test("a brand id that is not a UUID never rides along as &brand=", () => {
    expect(parseBusinessDeepLink(`mingla-business://brand/x&by=campaign/ads/${PLAN}`)).toBe(
      `/(tabs)/marketing/ads/${PLAN}?by=plan`,
    );
  });
});

describe("#4238 native 3: an ad notice without a usable deep link", () => {
  test("an https deep link falls back to the snake_case plan_id", () => {
    expect(
      resolveBusinessNavTarget({
        type: "business.ad_ended",
        deepLink: "https://host.usemingla.com/ads",
        plan_id: PLAN,
        brand_id: BRAND,
      } as never),
    ).toBe(AD);
  });

  test("a non-string plan id opens Promote", () => {
    expect(resolveBusinessNavTarget({ type: "business.ad_paused", planId: 42 } as never)).toBe(PROMOTE);
  });
});
