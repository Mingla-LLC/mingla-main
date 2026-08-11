/* eslint-disable import/first */
/**
 * Issue #1791 (#1767 Phase 3, SPEC #1788 P-54) — the `venue` deep-link head.
 *
 * WHAT WAS BROKEN BEFORE THIS PHASE, and why this file is not decoration:
 * `parseBusinessDeepLink` handled `event | payments | brand | partner |
 * support | (tabs)` and nothing else, so `mingla-business://venue/{id}/orders`
 * returned null and `resolveBusinessNavTarget` fell all the way through to
 * ACCOUNT_FALLBACK. An "order arrived" push would have dumped a chef on the
 * settings screen while a guest sat at a table waiting for food they had
 * already paid for.
 *
 * # Fails-on-revert
 * Remove the `case "venue"` branch → the first three assertions go RED (null,
 * then the account fallback). Remove the two `business.venue_order_*` cases
 * from NAV_TARGETS → the payload-only assertions go RED. Drop `?module=orders`
 * from either → the "lands on the QUEUE, not the venue page" assertions go RED,
 * which is the difference between one tap and a hunt.
 *
 * New sibling file (the META-ORCH-1074 and META-ORCH-1104 tests are immutable).
 */
import { describe, expect, test } from "@jest/globals";

jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: "brand-123" }) },
}));
jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      update: () => ({ eq: () => ({ then: (cb: () => void) => cb() }) }),
    })),
  },
}));
jest.mock("../mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import {
  parseBusinessDeepLink,
  resolveBusinessNavTarget,
  type BusinessPushData,
} from "../businessNotificationRouting";

describe("issue #1791 — the venue deep-link head", () => {
  test("T-DL1 — venue/{id}/orders lands on the ORDERS module, not the venue page", () => {
    expect(parseBusinessDeepLink("mingla-business://venue/ven-1/orders")).toBe(
      "/venue/ven-1?module=orders",
    );
  });

  test("T-DL2 — a bare venue link still lands on that venue", () => {
    expect(parseBusinessDeepLink("mingla-business://venue/ven-1")).toBe(
      "/venue/ven-1",
    );
  });

  test("T-DL3 — a venue link with no id is null, never a wrong venue", () => {
    expect(parseBusinessDeepLink("mingla-business://venue")).toBeNull();
    expect(parseBusinessDeepLink("mingla-business://venue/")).toBeNull();
  });

  test("T-DL4 — an unknown sub-path degrades to the venue page, not the account tab", () => {
    // A future push type we have not written yet must still reach the venue.
    expect(parseBusinessDeepLink("mingla-business://venue/ven-1/kitchen")).toBe(
      "/venue/ven-1",
    );
  });

  test("T-DL5 — the deep link wins when present (branch 1 of the resolver)", () => {
    const data: BusinessPushData = {
      type: "business.venue_order_placed",
      deepLink: "mingla-business://venue/ven-9/orders",
      venueId: "ven-1",
    };
    expect(resolveBusinessNavTarget(data)).toBe("/venue/ven-9?module=orders");
  });

  test("T-DL6 — a push WITHOUT a deep link still reaches the queue", () => {
    // The NAV_TARGETS fallback. A stripped payload or an older sender must not
    // strand a staff member on the account tab at 2am.
    expect(
      resolveBusinessNavTarget({
        type: "business.venue_order_placed",
        venueId: "ven-1",
      }),
    ).toBe("/venue/ven-1?module=orders");
    expect(
      resolveBusinessNavTarget({
        type: "business.venue_order_unacknowledged",
        relatedId: "ven-2",
      }),
    ).toBe("/venue/ven-2?module=orders");
  });

  test("T-DL7 — with no venue id at all we say so honestly (account fallback)", () => {
    // We do NOT guess a venue. Landing somebody on the wrong venue's queue
    // during service is worse than landing them on their account.
    expect(
      resolveBusinessNavTarget({ type: "business.venue_order_placed" }),
    ).toBe("/(tabs)/account");
  });

  test("T-DL8 — the pre-existing heads are untouched", () => {
    expect(parseBusinessDeepLink("mingla-business://event/ev-1")).toBe("/event/ev-1");
    expect(parseBusinessDeepLink("mingla-business://support/tk-1")).toBe("/support/tk-1");
    expect(parseBusinessDeepLink("mingla-business://brand/br-1/team")).toBe(
      "/brand/br-1/team",
    );
    expect(parseBusinessDeepLink("mingla-business://nonsense/x")).toBeNull();
  });
});
