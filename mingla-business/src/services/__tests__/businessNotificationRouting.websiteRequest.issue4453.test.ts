/* eslint-disable import/first */
/**
 * #4453 — "Ready for review" on a website change request sends
 * `business.website_request_ready` with the deep link
 * `mingla-business://brand/{brandId}/website?request={ticketId}`
 * (issue_4453_website_request_ready). The owner lands in the Website
 * workspace on that request.
 *
 * # Fails-on-revert
 * Drop the `?request=` handling in the `website` branch and the deep link
 * opens the bare workspace (first test RED). Drop the
 * `business.website_request_ready` case and a push without its deep link
 * falls to the account tab (second test RED).
 */
import { describe, expect, test } from "@jest/globals";

jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: null }) },
}));
jest.mock("../supabase", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { parseBusinessDeepLink, resolveBusinessNavTarget, type BusinessPushData } from "../businessNotificationRouting";
import { isBusinessNotificationType, resolveNotificationVisual, WEBSITE_REQUEST_READY_TYPE } from "../../constants/businessNotificationTemplates";

const BRAND = "3f6c1c1e-5a1b-4c1d-9e1f-1a2b3c4d5e6f";
const TICKET = "9b2d7a44-0c1e-4f6a-8d3b-5e6f7a8b9c0d";
const TARGET = `/brand/${BRAND}/website?request=${TICKET}`;

describe("#4453 website change request is ready", () => {
  test("the deep link keeps its request", () => {
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/website?request=${TICKET}`)).toBe(TARGET);
    expect(resolveBusinessNavTarget({
      type: "business.website_request_ready",
      deepLink: `mingla-business://brand/${BRAND}/website?request=${TICKET}`,
    })).toBe(TARGET);
  });

  test("the payload alone (no deep link) opens the same place", () => {
    // The outbox payload: { ticket_id, brand_id, ... } (snake case).
    expect(resolveBusinessNavTarget({ type: "business.website_request_ready", brand_id: BRAND, ticket_id: TICKET } as BusinessPushData)).toBe(TARGET);
    expect(resolveBusinessNavTarget({ type: "business.website_request_ready", brandId: BRAND, ticketId: TICKET } as BusinessPushData)).toBe(TARGET);
  });

  test("a request id that is not an id is never put in the address", () => {
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/website?request=../../account`)).toBe(`/brand/${BRAND}/website`);
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/website?request=`)).toBe(`/brand/${BRAND}/website`);
    expect(resolveBusinessNavTarget({ type: "business.website_request_ready", brand_id: BRAND, ticket_id: "x&mode=design" } as BusinessPushData))
      .toBe(`/brand/${BRAND}/website`);
    expect(resolveBusinessNavTarget({ type: "business.website_request_ready" })).toBe("/(tabs)/account");
  });

  // The link may arrive percent-encoded (a mail client, a share sheet, a
  // push relay). FAILS-ON-REVERT: drop the decode in `websiteRequestQuery`
  // and the encoded id opens the workspace without its request.
  test("a percent-encoded request id is decoded; a malformed one is dropped, never thrown", () => {
    const encoded = TICKET.replace(/-/g, "%2D");
    expect(encoded).not.toBe(TICKET);
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/website?request=${encoded}`)).toBe(TARGET);
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/website?request=${encoded.toLowerCase()}`)).toBe(TARGET);
    expect(resolveBusinessNavTarget({ type: "business.website_request_ready", brand_id: BRAND, ticket_id: encoded } as BusinessPushData)).toBe(TARGET);
    // Raw still works.
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/website?request=${TICKET}`)).toBe(TARGET);
    // Malformed escapes: no throw, no request.
    for (const bad of ["%", "%E0%A4%A", `${TICKET}%`, "%zz", "%2F..%2Faccount", `${TICKET}%26mode%3Ddesign`]) {
      expect(() => parseBusinessDeepLink(`mingla-business://brand/${BRAND}/website?request=${bad}`)).not.toThrow();
      expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/website?request=${bad}`)).toBe(`/brand/${BRAND}/website`);
      expect(resolveBusinessNavTarget({ type: "business.website_request_ready", brand_id: BRAND, ticket_id: bad } as BusinessPushData))
        .toBe(`/brand/${BRAND}/website`);
    }
  });

  test("the older Website links are unchanged", () => {
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/website`)).toBe(`/brand/${BRAND}/website`);
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/website/publish?x=1`)).toBe(`/brand/${BRAND}/website/publish`);
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/website/publish?request=${TICKET}`)).toBe(`/brand/${BRAND}/website/publish`);
  });

  test("in the bell it is a team message with good news; it has no settings toggle", () => {
    expect(WEBSITE_REQUEST_READY_TYPE).toBe("business.website_request_ready");
    expect(resolveNotificationVisual(WEBSITE_REQUEST_READY_TYPE)).toEqual({ family: "team", icon: "check", severity: "info" });
    // Transactional: never in the catalog that drives notification settings.
    expect(isBusinessNotificationType(WEBSITE_REQUEST_READY_TYPE)).toBe(false);
  });
});
