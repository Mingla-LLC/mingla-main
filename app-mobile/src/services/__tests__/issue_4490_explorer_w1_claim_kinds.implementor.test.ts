/**
 * #4490 Explorer W1 — the app keeps venue claim rows and routes them.
 * FAILS-ON-REVERT: drop venue_booking from CLAIM_KINDS and W1-A1 fails.
 */
import { expect, jest, test } from "@jest/globals";
jest.mock("../../lib/secureStoreSafe", () => ({ secureDeleteItem: jest.fn(), secureGetItem: jest.fn(), secureSetItem: jest.fn() }));
jest.mock("@mingla/phone-input/phoneNumber", () => ({ formatPhoneNational: (v: string) => v }));
jest.mock("../../constants/countries", () => ({ COUNTRIES: [] }));
jest.mock("../../utils/zoneLabel", () => ({ formatStartsAtLabel: () => "" }));
jest.mock("../supabase", () => ({ supabase: {}, reactivateExplorerForVerifiedSession: jest.fn() }));
import { parseClaimedEntries } from "../attendanceClaimService";
import { claimedEntryPath } from "../../components/purchases/missingTicketModel";
import { PURCHASE_DEEP_LINK_KINDS } from "../deepLinkService";

const row = (kind: string, routeKind: string, noun: string) => ({
  kind, id: "g1", routeKind, routeId: "0a1b2c3d-4490-4000-8000-0000000000c1", offeringType: "venue", noun,
  title: "Gameland Lagos", orderLabel: null, startsAt: null, timezone: "Africa/Lagos", venueLine: null,
  quantity: 2, source: "booking", sentByFirstName: null, chatJoined: null, conversationId: null,
});

test("W1-A1 venue claim rows are kept with nouns the app already knows", () => {
  const out = parseClaimedEntries([
    row("venue_booking", "venue_booking", "pass"),
    row("venue_membership", "venue_membership", "pass"),
    row("venue_waitlist", "venue_waitlist", "booking"),
    row("venue_till_sale", "venue_till_sale", "receipt"),
  ]);
  expect(out.map((e) => e.kind)).toEqual(["venue_booking", "venue_membership", "venue_waitlist", "venue_till_sale"]);
});

test("W1-A2 each venue route kind opens its Purchases detail", () => {
  for (const k of ["venue_booking", "venue_membership", "venue_waitlist", "venue_till_sale"]) {
    const [e] = parseClaimedEntries([row(k, k, "pass")]);
    expect(claimedEntryPath(e)).toBe(`/purchases/${k}/0a1b2c3d-4490-4000-8000-0000000000c1`);
  }
});

test("W1-A3 push and return-page links may open the venue kinds", () => {
  expect(PURCHASE_DEEP_LINK_KINDS).toEqual(expect.arrayContaining(["venue_booking", "venue_membership", "venue_waitlist", "venue_till_sale"]));
});
