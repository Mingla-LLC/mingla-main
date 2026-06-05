/* eslint-disable import/first */
/**
 * META-ORCH-1074 Sub-B — happy-path regression for the business push
 * deep-link routing map (`resolveBusinessNavTarget` + `parseBusinessDeepLink`
 * + `processBusinessNotification`).
 *
 * Asserts each of the 11 v1 types (plus the stripe.* set) resolves its
 * `mingla-business://…` deep_link / type to the correct expo-router path, and
 * that a tap while authenticated marks the row read + navigates, while a tap
 * while unauthenticated stashes the target instead of navigating.
 *
 * # Fails-on-revert
 * Revert `businessNotificationRouting.ts` (delete it) → module resolution
 * error → every case RED. Break the routing switch (e.g. point payments at
 * `/event/...`) → the per-type assertions go RED.
 *
 * Append-only post-merge per `.github/workflows/tests-append-only.yml`.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// Stub the current-brand store so id-less targets (payments) resolve.
let mockBrandId: string | null = "brand-123";
jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: {
    getState: () => ({ currentBrandId: mockBrandId }),
  },
}));

// Capture the fire-and-forget mark-clicked UPDATE chain.
const updateEq = jest.fn(() => ({ then: (cb: () => void) => cb() }));
const updateFn = jest.fn(() => ({ eq: updateEq }));
jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(() => ({ update: updateFn })),
  },
}));

const trackFn = jest.fn();
jest.mock("../mixpanelService", () => ({
  mixpanelService: { track: trackFn },
}));

// expo-router is only used as a type in the SUT; stub to satisfy the import.
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import {
  parseBusinessDeepLink,
  resolveBusinessNavTarget,
  processBusinessNotification,
  type BusinessPushData,
} from "../businessNotificationRouting";

beforeEach(() => {
  mockBrandId = "brand-123";
  updateFn.mockClear();
  updateEq.mockClear();
  trackFn.mockClear();
});

describe("parseBusinessDeepLink", () => {
  test("event → /event/{id}", () => {
    expect(parseBusinessDeepLink("mingla-business://event/evt-1")).toBe(
      "/event/evt-1",
    );
  });
  test("payments → current brand payments", () => {
    expect(parseBusinessDeepLink("mingla-business://payments")).toBe(
      "/brand/brand-123/payments",
    );
  });
  test("payments with no brand → account fallback", () => {
    mockBrandId = null;
    expect(parseBusinessDeepLink("mingla-business://payments")).toBe(
      "/(tabs)/account",
    );
  });
  test("brand listing + team", () => {
    expect(
      parseBusinessDeepLink("mingla-business://brand/b-9/listing"),
    ).toBe("/brand/b-9/listing");
    expect(parseBusinessDeepLink("mingla-business://brand/b-9/team")).toBe(
      "/brand/b-9/team",
    );
  });
  test("non-mingla scheme → null", () => {
    expect(parseBusinessDeepLink("https://example.com")).toBeNull();
  });

  // ORCH-1082 Gap 15 + 17b — happy-path FAILS-on-revert cases. Reverting the
  // `payments` sub-branch makes brand/{id}/payments/onboard fall through to
  // `/brand/{id}` (RED); reverting the `partner` head case makes
  // partner/earnings return null (RED).
  describe("ORCH-1082 residual routing", () => {
    test("Gap 15: brand payments/onboard → onboarding screen", () => {
      expect(
        parseBusinessDeepLink("mingla-business://brand/B/payments/onboard"),
      ).toBe("/brand/B/payments/onboard");
    });
    test("Gap 15: brand payments (bare) → payments hub", () => {
      expect(parseBusinessDeepLink("mingla-business://brand/B/payments")).toBe(
        "/brand/B/payments",
      );
    });
    test("Gap 17b: partner/earnings → /partner/earnings", () => {
      expect(parseBusinessDeepLink("mingla-business://partner/earnings")).toBe(
        "/partner/earnings",
      );
    });
    test("Gap 17b: unknown partner sub → null", () => {
      expect(parseBusinessDeepLink("mingla-business://partner/bogus")).toBeNull();
    });
    // Regression guards: pre-existing brand cases unchanged by the new branches.
    test("regression: brand team/listing + bare brand unchanged", () => {
      expect(parseBusinessDeepLink("mingla-business://brand/B/team")).toBe(
        "/brand/B/team",
      );
      expect(parseBusinessDeepLink("mingla-business://brand/B/listing")).toBe(
        "/brand/B/listing",
      );
      expect(parseBusinessDeepLink("mingla-business://brand/B")).toBe("/brand/B");
    });
    test("regression: missing brandId → null", () => {
      expect(parseBusinessDeepLink("mingla-business://brand")).toBeNull();
    });
    test("regression: unknown head → null", () => {
      expect(parseBusinessDeepLink("mingla-business://account/foo")).toBeNull();
    });
  });
});

describe("resolveBusinessNavTarget — per type", () => {
  const cases: ReadonlyArray<[BusinessPushData, string]> = [
    [
      { type: "business.order_paid", deepLink: "mingla-business://event/e1" },
      "/event/e1",
    ],
    [
      { type: "business.event_sold_out", deepLink: "mingla-business://event/e2" },
      "/event/e2",
    ],
    [
      { type: "business.low_inventory", deepLink: "mingla-business://event/e3" },
      "/event/e3",
    ],
    [
      {
        type: "business.refund_processed",
        deepLink: "mingla-business://event/e4",
      },
      "/event/e4",
    ],
    [
      { type: "business.dispute_opened", deepLink: "mingla-business://payments" },
      "/brand/brand-123/payments",
    ],
    [
      {
        type: "business.dispute_action_needed",
        deepLink: "mingla-business://payments",
      },
      "/brand/brand-123/payments",
    ],
    [
      { type: "business.payout_paid", deepLink: "mingla-business://payments" },
      "/brand/brand-123/payments",
    ],
    [
      {
        type: "business.account_status_changed",
        deepLink: "mingla-business://payments",
      },
      "/brand/brand-123/payments",
    ],
    [
      { type: "business.new_review", deepLink: "mingla-business://event/e5" },
      "/event/e5",
    ],
    [
      {
        type: "business.claim_decision",
        deepLink: "mingla-business://brand/b-7/listing",
      },
      "/brand/b-7/listing",
    ],
    [
      {
        type: "business.team_member_joined",
        deepLink: "mingla-business://brand/b-7/team",
      },
      "/brand/b-7/team",
    ],
    // stripe.* compliance type → payments
    [{ type: "stripe.payout_failed" }, "/brand/brand-123/payments"],
  ];

  test.each(cases)("%o → %s", (data, expected) => {
    expect(resolveBusinessNavTarget(data)).toBe(expected);
  });

  test("type fallback when deepLink absent (order_paid uses eventId)", () => {
    expect(
      resolveBusinessNavTarget({ type: "business.order_paid", eventId: "e9" }),
    ).toBe("/event/e9");
  });

  test("unknown type → account fallback", () => {
    expect(resolveBusinessNavTarget({ type: "totally.unknown" })).toBe(
      "/(tabs)/account",
    );
  });
});

describe("processBusinessNotification", () => {
  test("authenticated → marks row read + navigates", () => {
    const push = jest.fn();
    const stashDeferred = jest.fn();
    processBusinessNotification(
      {
        type: "business.payout_paid",
        notificationId: "n-1",
        deepLink: "mingla-business://payments",
      },
      { router: { push }, isAuthenticated: true, stashDeferred },
    );
    expect(updateFn).toHaveBeenCalledTimes(1); // read_at + push_clicked UPDATE
    expect(updateEq).toHaveBeenCalledWith("id", "n-1");
    expect(push).toHaveBeenCalledWith("/brand/brand-123/payments");
    expect(stashDeferred).not.toHaveBeenCalled();
  });

  test("unauthenticated → stashes target, does not navigate", () => {
    const push = jest.fn();
    const stashDeferred = jest.fn();
    processBusinessNotification(
      {
        type: "business.claim_decision",
        deepLink: "mingla-business://brand/b-2/listing",
      },
      { router: { push }, isAuthenticated: false, stashDeferred },
    );
    expect(push).not.toHaveBeenCalled();
    expect(stashDeferred).toHaveBeenCalledWith("/brand/b-2/listing");
    expect(updateFn).not.toHaveBeenCalled();
  });
});
