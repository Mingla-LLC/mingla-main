/**
 * #4490 Explorer W2 fix round 2 — what the second simulator pass saw (W2-N9,
 * N11, N16..N24) and the welcome screen's silent send failure.
 *
 * FAILS-ON-REVERT: drop withKnownCurrencySymbol from purchaseMoneyText and
 * F2-M1 fails ("NGN 10,750.00"); drop the venue "Today" split and F2-G1 fails;
 * drop whenText / venueMemberListDate and F2-P1 fails; drop the waitlist day
 * check and F2-W1 fails; drop venueDetailMissingCopy's own nouns and F2-N1
 * fails; drop the "clear" branch's clearPendingClaimIntent and F2-S1 fails.
 */
// Jest globals, typed locally (app-mobile has no jest types in its tsconfig).
interface F2Matchers {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeNull(): void;
  toContain(v: unknown): void;
  toMatch(v: RegExp): void;
  not: { toBe(v: unknown): void; toContain(v: unknown): void; toMatch(v: RegExp): void };
}
declare const describe: (name: string, body: () => void) => void;
declare const test: (name: string, body: () => void | Promise<void>) => void;
declare const expect: (v: unknown) => F2Matchers;
declare const jest: { mock(path: string, factory: () => unknown): void };
declare const require: (id: string) => { readFileSync(p: string, enc: string): string };
declare const __dirname: string;

jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: async () => ({ data: [], error: null }) },
  reactivateExplorerForVerifiedSession: () => undefined,
}));
jest.mock("../../../lib/secureStoreSafe", () => ({ secureDeleteItem: () => undefined, secureGetItem: () => undefined, secureSetItem: () => undefined }));
jest.mock("@mingla/phone-input/phoneNumber", () => ({ formatPhoneNational: (v: string) => v }));
jest.mock("../../../constants/countries", () => ({ COUNTRIES: [] }));
jest.mock("../../../utils/zoneLabel", () => ({ formatStartsAtLabel: () => "" }));

import {
  parseVenueBooking,
  parseVenueMember,
  venueBookingMoneyRows,
  venueDetailMissingCopy,
  venueGuestChangeLabel,
  venueMemberListDate,
  venueMemberListLine,
} from "../venuePurchaseModel";
import { claimLinkLandedTitleKey } from "../missingTicketModel";
import { buildPurchaseTimeline, type PurchaseSources } from "../../../utils/purchaseTimeline";
import { purchaseMoneyText, purchaseRefundText } from "../../../utils/purchaseMoney";
import { withKnownCurrencySymbol } from "../../../utils/programFormat";
import { attendanceClaimAuthAction } from "../../../utils/attendanceClaimDeepLink";

const fs = require("fs");
const read = (rel: string): string => fs.readFileSync(`${__dirname}/${rel}`, "utf8");

const LAGOS = "Africa/Lagos";
// 22 Nov 2026, 07:00 in Lagos (06:00Z).
const NOW = new Date("2026-11-22T06:00:00Z");
const empty: PurchaseSources = { orders: [], rsvps: [], reservations: [], venueOrders: [] };

const booking = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  groupId: "188b99bb-e743-4f52-a515-a8f98f1c286d",
  reference: "VB-188B99BB",
  state: "confirmed",
  version: 2,
  offerKind: "entry",
  currencyCode: "NGN",
  totalMinor: 1075000,
  paidMinor: 1075000,
  refundedMinor: 0,
  balanceDueMinor: 0,
  amountDueNowMinor: 0,
  paidAtVenueMinor: 0,
  createdAt: "2026-11-20T10:00:00+00:00",
  venue: { id: "v1", name: "Gameland QA", slug: "gameland", brandSlug: "harmattan-qa-local", brandName: "Harmattan QA (local)", timezone: LAGOS },
  offer: { id: "o1", kind: "entry", name: "Entry" },
  window: { localDate: "2026-11-22", startsAt: "2026-11-22T11:00:00+00:00", endsAt: "2026-11-22T23:00:00+00:00" },
  lines: [{ name: "Walk-in", unit: "guest", state: "confirmed", guests: 2, totalMinor: 1075000, unitPriceMinor: 537500 }],
  passes: [{ passId: "p1", status: "valid", admits: 2, admittedCount: 0, validLocalDate: "2026-11-22", qrPayload: "v1.qr" }],
  extras: [],
  changeRules: { canChangeGuests: true },
  ...over,
});

const bookingSource = (id: string, startAt: string): PurchaseSources => ({
  ...empty,
  venueBookings: [{ id, title: "Gameland QA", brandName: null, venueLine: "Entry", startAt, endAt: null, timezone: LAGOS, state: "confirmed", guests: 2, totalMinor: 1075000, refundedMinor: 0, currency: "NGN", raw: {} }],
});
const orderSource = (id: string, startAt: string): PurchaseSources => ({
  ...empty,
  orders: [{ id, eventId: "e1", eventTitle: "Afrobeats night", eventType: "event", brandName: "Host", coverMediaUrl: null, startAt, endAt: null, timezone: LAGOS, venueLine: null, paymentStatus: "paid", ticketCount: 2, validTicketCount: 2, source: null, currency: "NGN", buyerTotalCents: 1075000, refundedAmountCents: 0, raw: {} }],
});

describe("#4490 W2 fix 2: money (W2-N18)", () => {
  test("F2-M1 the list and the detail read one amount the same way, with the symbol", () => {
    expect(purchaseMoneyText(1075000, "NGN")).toBe("₦10,750.00");
    const b = parseVenueBooking(booking());
    if (b === null) throw new Error("parse");
    const total = venueBookingMoneyRows(b).find((r) => r.label === "Total");
    expect(total?.value).toBe(purchaseMoneyText(b.totalMinor, b.currencyCode));
    expect(purchaseRefundText({ refundedAmountCents: 500, currency: "NGN" })).toBe("₦5.00 refunded");
  });

  test("F2-M2 Hermes' printed code becomes the symbol; text that has a symbol is untouched", () => {
    expect(withKnownCurrencySymbol("NGN 2,687.50 back to you. New total NGN 8,062.50.", "NGN"))
      .toBe("₦2,687.50 back to you. New total ₦8,062.50.");
    expect(withKnownCurrencySymbol("NGN 10,750", "NGN")).toBe("₦10,750");
    expect(purchaseMoneyText(2450, "GBP")).toBe("£24.50");
    expect(withKnownCurrencySymbol("US$5.00", "USD")).toBe("US$5.00");
    expect(withKnownCurrencySymbol("XYZ 5.00", "XYZ")).toBe("XYZ 5.00");
  });
});

describe("#4490 W2 fix 2: list placement and words", () => {
  test("F2-G1 a noon venue booking today is under Today; an evening one under Tonight; an event keeps Tonight", () => {
    const noon = buildPurchaseTimeline(bookingSource("noon", "2026-11-22T11:00:00Z"), NOW);
    expect(noon.upcoming[0]?.key).toBe("today");
    expect(noon.upcoming[0]?.title).toBe("Today");
    const evening = buildPurchaseTimeline(bookingSource("eve", "2026-11-22T18:00:00Z"), NOW);
    expect(evening.upcoming[0]?.title).toBe("Tonight");
    // 16:59 and 17:00 Lagos are the boundary.
    expect(buildPurchaseTimeline(bookingSource("b1", "2026-11-22T15:59:00Z"), NOW).upcoming[0]?.title).toBe("Today");
    expect(buildPurchaseTimeline(bookingSource("b2", "2026-11-22T16:00:00Z"), NOW).upcoming[0]?.title).toBe("Tonight");
    // Events are unchanged: anything later today stays "Tonight".
    expect(buildPurchaseTimeline(orderSource("o1", "2026-11-22T11:00:00Z"), NOW).upcoming[0]?.title).toBe("Tonight");
  });

  test("F2-P1 a live plan is placed and dated by what comes next, with its own line", () => {
    const m = parseVenueMember({
      subscriptionId: "a4afd602-0000-4000-8000-000000000001",
      status: "active",
      plan: { name: "Round 3 yearly desk", interval: "year" },
      venue: { id: "v1", name: "Gameland QA", timezone: LAGOS },
      activeUntil: "2027-11-20T23:27:00+00:00",
      renewsOn: "2027-11-20T23:27:00+00:00",
      startedAt: "2026-11-20T23:27:00+00:00",
      createdAt: "2026-11-20T23:20:00+00:00",
    });
    if (m === null) throw new Error("parse");
    expect(venueMemberListDate(m)).toBe("2027-11-20T23:27:00+00:00");
    expect(venueMemberListLine(m)).toBe("Paid until Sun 21 Nov 2027");
    const t = buildPurchaseTimeline({
      ...empty,
      venueMemberships: [{ id: m.subscriptionId, title: m.planName, brandName: null, venueLine: "Gameland QA", startAt: venueMemberListDate(m), endAt: m.activeUntil, timezone: LAGOS, status: m.status, whenText: venueMemberListLine(m), raw: m }],
    }, NOW);
    const item = t.upcoming[0]?.items[0];
    expect(item?.whenText).toBe("Paid until Sun 21 Nov 2027");
    expect(item?.startsAt).toBe("2027-11-20T23:27:00.000Z");
    const ended = parseVenueMember({ subscriptionId: "x", status: "cancelled", plan: { name: "Hot desk" }, venue: { name: "Gameland QA", timezone: LAGOS }, endedAt: "2026-10-01T10:00:00Z", startedAt: "2026-09-01T10:00:00Z" });
    if (ended === null) throw new Error("parse");
    expect(venueMemberListDate(ended)).toBe("2026-10-01T10:00:00Z");
    expect(venueMemberListLine(ended)).toBe("Your membership has ended");
  });

  test("F2-W1 an open waitlist place whose day has passed is under Past", () => {
    const t = buildPurchaseTimeline({
      ...empty,
      venueWaitlist: [
        { id: "old", title: "Guest QA Grill", venueLine: null, startAt: "2026-11-21T18:00:00Z", createdAt: null, timezone: LAGOS, status: "waiting", partySize: 2, raw: {} },
        { id: "today", title: "Guest QA Grill", venueLine: null, startAt: "2026-11-22T18:00:00Z", createdAt: null, timezone: LAGOS, status: "waiting", partySize: 2, raw: {} },
      ],
    }, NOW);
    expect(t.past.flatMap((g) => g.items.map((i) => i.id))).toEqual(["old"]);
    expect(t.upcoming.flatMap((g) => g.items.map((i) => i.id))).toEqual(["today"]);
  });
});

describe("#4490 W2 fix 2: detail words", () => {
  test("F2-N1 not yours / not real says so with the right noun; only a failed read blames the connection", () => {
    expect(venueDetailMissingCopy("venue_booking", "not_found")).toEqual({ title: "This pass isn't on your account.", body: null, retry: false });
    expect(venueDetailMissingCopy("venue_membership", "not_found").title).toBe("This plan isn't on your account.");
    expect(venueDetailMissingCopy("venue_waitlist", "not_found").title).toBe("This waitlist place isn't on your account.");
    expect(venueDetailMissingCopy("venue_booking", "load_failed")).toEqual({ title: "We couldn't load your pass.", body: "Check your connection and try again.", retry: true });
    const route = read("../../../../app/purchases/[kind]/[id].tsx");
    expect(route).toContain('venueDetailMissingCopy(kind, purchase.isError ? "load_failed" : "not_found")');
  });

  test("F2-C1 the change button is singular for one guest", () => {
    expect(venueGuestChangeLabel(1)).toBe("Change to 1 guest");
    expect(venueGuestChangeLabel(3)).toBe("Change to 3 guests");
  });

  test("F2-D1 the door view says Pass on a venue pass, Message names the venue, the stepper speaks words", () => {
    const detail = read("../VenuePurchaseDetail.tsx");
    expect(detail.split('unit="pass"').length - 1).toBe(2);
    expect(detail.split("displayName:").length - 1).toBe(3);
    expect(detail).toContain("accessibilityLabel={VENUE_GUEST_STEPPER_LABELS.fewer}");
    const en = JSON.parse(read("../../../i18n/locales/en/purchases.json")) as { door: Record<string, string>; card: Record<string, string> };
    expect(en.door.passLine).toBe("{{ticketType}} · Pass {{index}} of {{total}}");
    expect(en.door.ticketLine).toBe("{{ticketType}} · Ticket {{index}} of {{total}}");
    expect(en.card.todayAt).toBe("Today · {{time}}");
    const button = read("../../brandEnquiry/CalendarPlanMessageButton.tsx");
    expect(button).toContain("{ brand: target.displayName ?? target.brandName }");
    expect(button).toContain("name: target.displayName ?? identity.data.name");
  });

  test("F2-L1 the claim sheet asks about the noun the server sent", () => {
    expect(claimLinkLandedTitleKey("pass")).toBe("missing.landed.titleNoun.pass");
    expect(claimLinkLandedTitleKey("booking")).toBe("missing.landed.titleNoun.booking");
    expect(claimLinkLandedTitleKey("ticket")).toBe("missing.landed.title");
    expect(claimLinkLandedTitleKey(null)).toBe("missing.landed.title");
  });
});

describe("#4490 W2 fix 2: sign-out and the welcome screen", () => {
  test("F2-S1 signing out forgets the saved claim link; signing in (claim-first) does not", () => {
    expect(attendanceClaimAuthAction("u-a", null, false, false)).toBe("clear");
    expect(attendanceClaimAuthAction(null, "u-b", false, false)).not.toBe("clear");
    expect(attendanceClaimAuthAction(undefined, null, false, false)).not.toBe("clear");
    const index = read("../../../../app/index.tsx");
    const branch = index.slice(index.indexOf('if (authAction === "clear") {'), index.indexOf('} else if (authAction === "resume") {'));
    expect(branch).toContain("void clearPendingClaimIntent().then(");
    expect(branch).toContain("setTicketClaim(null);");
  });

  test("F2-E1 a failed purchase-email code send shows its error under the button", () => {
    const welcome = read("../../signIn/WelcomeScreen.tsx");
    const sendStep = welcome.slice(welcome.indexOf("claimEmailChallengeId === null ? ("), welcome.indexOf('testID="welcome-claim-email-panel"'));
    expect(sendStep).toContain('testID="welcome-claim-email-send-error"');
    expect(sendStep).toContain("{emailError}");
  });
});
