/**
 * #4490 Explorer W1 — the app keeps venue claim rows and routes them.
 * FAILS-ON-REVERT: drop venue_booking from CLAIM_KINDS and W1-A1 fails.
 */
// Jest globals, typed locally (app-mobile has no /jest in its tsconfig).
interface W1Matchers { toBe(v: unknown): void; toEqual(v: unknown): void; toBeNull(): void }
declare const describe: (name: string, body: () => void) => void;
declare const test: (name: string, body: () => void) => void;
declare const expect: ((v: unknown) => W1Matchers) & { arrayContaining(v: unknown[]): unknown };
declare const jest: { mock(path: string, factory: () => unknown): void; fn(): () => unknown };
jest.mock("../../lib/secureStoreSafe", () => ({ secureDeleteItem: () => undefined, secureGetItem: () => undefined, secureSetItem: () => undefined }));
jest.mock("@mingla/phone-input/phoneNumber", () => ({ formatPhoneNational: (v: string) => v }));
jest.mock("../../constants/countries", () => ({ COUNTRIES: [] }));
jest.mock("../../utils/zoneLabel", () => ({ formatStartsAtLabel: () => "" }));
jest.mock("../supabase", () => ({ supabase: {}, reactivateExplorerForVerifiedSession: () => undefined }));
import { parseClaimedEntries } from "../attendanceClaimService";
import { claimedEntryPath } from "../../components/purchases/missingTicketModel";
import { executeDeepLink, PURCHASE_DEEP_LINK_KINDS } from "../deepLinkService";

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

// [TEST-MOD-APPROVED #4490] Explorer W2 closes N157: the three venue kinds
// now open their own Purchases detail; Till receipts still open the list.
test("W1-A2 venue route kinds open their detail; Till receipts open the list (W2, N157)", () => {
  for (const k of ["venue_booking", "venue_membership", "venue_waitlist"]) {
    const [e] = parseClaimedEntries([row(k, k, "pass")]);
    expect(claimedEntryPath(e)).toBe(`/purchases/${k}/0a1b2c3d-4490-4000-8000-0000000000c1`);
  }
  const [till] = parseClaimedEntries([row("venue_till_sale", "venue_till_sale", "receipt")]);
  expect(claimedEntryPath(till)).toBe("/purchases");
});

test("W1-A3 push and return-page links may open the venue kinds", () => {
  expect(PURCHASE_DEEP_LINK_KINDS).toEqual(expect.arrayContaining(["venue_booking", "venue_membership", "venue_waitlist", "venue_till_sale"]));
});

// [TEST-MOD-APPROVED #4490] Explorer W2: venue_booking opens its detail now.
test("W1-A4 N157: a venue purchase link opens its detail (W2)", () => {
  const opened: string[] = [];
  const handlers = { openRouterPath: (p: string) => { opened.push(p); }, setCurrentPage: () => undefined };
  executeDeepLink({ kind: "purchase", purchaseKind: "venue_booking", purchaseId: "0a1b2c3d-4490-4000-8000-0000000000c1", door: false } as never, handlers as never);
  executeDeepLink({ kind: "purchase", purchaseKind: "order", purchaseId: "0a1b2c3d-4490-4000-8000-0000000000c1", door: false } as never, handlers as never);
  expect(opened).toEqual([
    "/purchases/venue_booking/0a1b2c3d-4490-4000-8000-0000000000c1",
    "/purchases/order/0a1b2c3d-4490-4000-8000-0000000000c1",
  ]);
});
