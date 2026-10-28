/* eslint-disable import/first */
/**
 * #2829 W9r — "Ask an admin" from the Website section sends
 * `business.site_admin_requested` with the deep link
 * `mingla-business://brand/{brandId}/website/{section}`. Before this, the
 * `brand` head ignored the `website` sub and opened the bare brand hub, so the
 * admin asked to publish had to find the Website section themselves.
 *
 * # Fails-on-revert
 * Remove the `sub === "website"` branch → the deep-link assertions land on
 * `/brand/b-1` and go RED. Remove the `business.site_admin_requested` case →
 * the payload-only assertions fall to the account tab and go RED.
 */
import { describe, expect, test } from "@jest/globals";

jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: null }) },
}));
jest.mock("../supabase", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { parseBusinessDeepLink, resolveBusinessNavTarget } from "../businessNotificationRouting";

describe("#2829 W9r Website deep links", () => {
  test("each asked-about section opens that section", () => {
    for (const section of ["publish", "reviews", "addresses", "settings", "plan"]) {
      expect(parseBusinessDeepLink(`mingla-business://brand/b-1/website/${section}`)).toBe(`/brand/b-1/website/${section}`);
    }
  });

  test("a bare or unknown section opens the Website overview, never something else", () => {
    expect(parseBusinessDeepLink("mingla-business://brand/b-1/website")).toBe("/brand/b-1/website");
    expect(parseBusinessDeepLink("mingla-business://brand/b-1/website/../../account")).toBe("/brand/b-1/website");
    expect(parseBusinessDeepLink("mingla-business://brand/b-1/website/publish?x=1")).toBe("/brand/b-1/website/publish");
  });

  test("the request type routes there with the deep link, and without it", () => {
    expect(resolveBusinessNavTarget({ type: "business.site_admin_requested", deepLink: "mingla-business://brand/b-1/website/publish" }))
      .toBe("/brand/b-1/website/publish");
    expect(resolveBusinessNavTarget({ type: "business.site_admin_requested", brandId: "b-1", section: "reviews" }))
      .toBe("/brand/b-1/website/reviews");
    expect(resolveBusinessNavTarget({ type: "business.site_admin_requested", brandId: "b-1" })).toBe("/brand/b-1/website");
  });

  test("the weekly plan reminder opens the exact unfinished-plan surface", () => {
    expect(resolveBusinessNavTarget({
      type: "business.site_plan_reminder",
      deepLink: "mingla-business://brand/b-1/website/plan",
    })).toBe("/brand/b-1/website/plan");
    expect(resolveBusinessNavTarget({
      type: "business.site_plan_reminder",
      brandId: "b-1",
      section: "plan",
    })).toBe("/brand/b-1/website/plan");
  });
});
