/* eslint-disable import/first */
/**
 * META-ORCH-1104 Phase 0 — support deep-link routing regression.
 *
 * Asserts the new `business.support_*` routing case:
 *   - mingla-business://support/{ticketId} parses to /support/{ticketId}
 *   - business.support_message / business.support_new_ticket resolve to
 *     /support/{ticketId} via data.ticketId (notify-support payload).
 *
 * # Fails-on-revert
 * Revert the support case in `businessNotificationRouting.ts` → the support
 * deep link falls through to null and the type falls to ACCOUNT_FALLBACK, so
 * the assertions below go RED.
 *
 * New sibling file (the META-ORCH-1074 test is append-only/immutable).
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

import {
  parseBusinessDeepLink,
  resolveBusinessNavTarget,
  type BusinessPushData,
} from "../businessNotificationRouting";

describe("META-ORCH-1104 support deep-link routing", () => {
  test("parseBusinessDeepLink maps support/{id} to /support/{id}", () => {
    expect(parseBusinessDeepLink("mingla-business://support/abc-123")).toBe(
      "/support/abc-123",
    );
  });

  test("parseBusinessDeepLink returns null for bare support (no ticket id)", () => {
    expect(parseBusinessDeepLink("mingla-business://support")).toBeNull();
  });

  test("business.support_message resolves to the thread via data.ticketId", () => {
    const data: BusinessPushData = {
      type: "business.support_message",
      ticketId: "tkt-9",
    };
    expect(resolveBusinessNavTarget(data)).toBe("/support/tkt-9");
  });

  test("business.support_new_ticket resolves to the thread via relatedId fallback", () => {
    const data: BusinessPushData = {
      type: "business.support_new_ticket",
      relatedId: "tkt-7",
    };
    expect(resolveBusinessNavTarget(data)).toBe("/support/tkt-7");
  });

  test("explicit deepLink wins when present", () => {
    const data: BusinessPushData = {
      type: "business.support_message",
      deepLink: "mingla-business://support/tkt-5",
      ticketId: "ignored",
    };
    expect(resolveBusinessNavTarget(data)).toBe("/support/tkt-5");
  });
});
