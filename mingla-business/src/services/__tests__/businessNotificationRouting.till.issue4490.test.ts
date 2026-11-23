/* eslint-disable import/first */
/**
 * #4490 spec 08 O2 — Till card notices open the Till on its checks: from the
 * deep link (mingla-business://venue/{id}/till), and from the type alone when
 * a push arrives without one.
 */
import { describe, expect, test } from "@jest/globals";

jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: "brand-123" }) },
}));
jest.mock("../supabase", () => ({
  supabase: { from: jest.fn(() => ({ update: () => ({ eq: () => ({ then: (cb: () => void) => cb() }) }) })) },
}));
jest.mock("../mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { parseBusinessDeepLink, resolveBusinessNavTarget, type BusinessPushData } from "../businessNotificationRouting";

describe("Till card notices", () => {
  test("the deep link opens the Till's checks", () => {
    expect(parseBusinessDeepLink("mingla-business://venue/ven-1/till")).toBe("/venue/ven-1/till?checks=1");
  });
  test.each(["business.venue_till_paid_late", "business.venue_till_tap_paid_unseen", "business.venue_till_tap_not_completed"])(
    "%s without a deep link still opens the Till",
    (type) => {
      expect(resolveBusinessNavTarget({ type, data: {}, venueId: "ven-2" } as unknown as BusinessPushData)).toBe(
        "/venue/ven-2/till?checks=1",
      );
    },
  );
});
