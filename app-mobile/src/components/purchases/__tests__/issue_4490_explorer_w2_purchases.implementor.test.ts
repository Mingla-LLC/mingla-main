/**
 * #4490 Explorer W2 — venue bookings, plans and waitlist places in Purchases.
 * [TEST-MOD-APPROVED #4490] W2 fix round 2 (W2-N18): money rows now go
 * through the Purchases money text the list uses, so whole amounts read
 * "₦15,000.00" (was "₦15,000", which Hermes printed as "NGN 15,000"). Same
 * amounts, same rows; no assertion removed.
 * FAILS-ON-REVERT: drop the venue sources from buildPurchaseTimeline and W2-T1
 * fails; drop the venue_booking detail route from claimedEntryPath and W2-R1
 * fails; drop the three fetchers' throw and W2-F2 fails.
 */
// Jest globals, typed locally (app-mobile has no jest types in its tsconfig).
type RpcResult = { data: unknown; error: { message: string } | null };
interface W2Matchers {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeNull(): void;
  not: { toBeNull(): void };
  rejects: { toThrow(v: string): Promise<void> };
}
declare const describe: (name: string, body: () => void) => void;
declare const test: (name: string, body: () => void | Promise<void>) => void;
declare const expect: ((v: unknown) => W2Matchers) & { arrayContaining(v: unknown[]): unknown };
declare const jest: {
  mock(path: string, factory: () => unknown): void;
  fn(): { (fn: string): Promise<RpcResult>; mockImplementation(f: (fn: string) => Promise<RpcResult>): void };
};

const mockRpc = jest.fn();
jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: (fn: string) => mockRpc(fn) },
  reactivateExplorerForVerifiedSession: () => undefined,
}));
jest.mock("../../../lib/secureStoreSafe", () => ({ secureDeleteItem: () => undefined, secureGetItem: () => undefined, secureSetItem: () => undefined }));
jest.mock("@mingla/phone-input/phoneNumber", () => ({ formatPhoneNational: (v: string) => v }));
jest.mock("../../../constants/countries", () => ({ COUNTRIES: [] }));
jest.mock("../../../utils/zoneLabel", () => ({ formatStartsAtLabel: () => "" }));
jest.mock("../../../services/calendarService", () => ({ CalendarService: {} }));
jest.mock("../../../services/calendarOrderDays", () => ({ calendarDayWindowsForOrder: () => [] }));

import {
  memberCodeWords,
  memberDay,
  parseVenueBooking,
  parseVenueMember,
  parseVenueWaitlistPlaces,
  venueBookingDoorPass,
  venueBookingExtraRows,
  venueBookingMoneyRows,
  venueBookingPayAction,
  venueBookingPlaceLine,
  venueBookingProgress,
  venueBookingWhenLine,
  venueMemberCanRenew,
  venueMemberErrorCopy,
  venueMemberState,
  venueWaitlistState,
} from "../venuePurchaseModel";
import { buildPurchaseTimeline } from "../../../utils/purchaseTimeline";
import { purchaseKindLabel, purchaseStatusLabel } from "../../../utils/purchasePresentation";
import { claimedEntryPath } from "../missingTicketModel";
import { parseClaimedEntries } from "../../../services/attendanceClaimService";
import { executeDeepLink } from "../../../services/deepLinkService";
import {
  fetchMyMemberships,
  fetchMyVenueBookings,
  fetchMyWaitlistEntries,
} from "../../../services/purchasesService";
import { purchaseKeys } from "../../../hooks/queryKeys";

const GROUP = "cf310e01-87b1-4b5b-9fdd-9741f2444508";
const SUB = "37fd84db-4629-4ab4-833c-7ae16d475e1d";
const WAIT = "44943000-0000-4000-a000-0000000000e1";

/** The local stack's booking projection for VB-CF310E01 (a day pass on a Stay venue). */
const booking = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  groupId: GROUP,
  reference: "VB-CF310E0187B14B5B9FDD",
  state: "confirmed",
  version: 3,
  offerKind: "entry",
  currencyCode: "NGN",
  totalMinor: 1500000,
  paidMinor: 1500000,
  refundedMinor: 0,
  balanceDueMinor: 0,
  amountDueNowMinor: 0,
  paidAtVenueMinor: 0,
  paymentCollection: "mingla",
  createdAt: "2026-11-21T14:21:19.367762+00:00",
  guest: { name: "Guest J Tester", email: "guest4490j@example.com", phone: null },
  venue: {
    id: "22e1d45d-a284-4424-aa39-09858e1c940c",
    name: "Harbour Palms Resort",
    slug: "harbourpalmsresort",
    brandSlug: "harmattan-club-local",
    brandName: "Harmattan Club (local)",
    timezone: "Africa/Lagos",
  },
  offer: { id: "d1a81c9a-22cb-4efa-81a7-cf9fc194c306", kind: "entry", name: "Pool day pass", entryStyle: "day_pass" },
  window: { localDate: "2026-11-22", startsAt: "2026-11-22T09:00:00+00:00", endsAt: "2026-11-22T17:00:00+00:00" },
  lines: [{ name: "Adult", unit: "guest", state: "confirmed", guests: 1, priceOptionId: "e1f77ee5-d9b3-40ae-a202-bffbca247cfc", totalMinor: 1500000, unitPriceMinor: 1500000 }],
  passes: [
    {
      passId: "63253af0-6e28-4bde-8419-e65ef43a456b",
      status: "valid",
      admits: 1,
      admittedCount: 0,
      validLocalDate: "2026-11-22",
      qrPayload: "v1.pass.qr",
      daysAllowed: 1,
      daysUsed: 0,
      validUntilLocalDate: null,
    },
  ],
  extras: [],
  changeRules: { canChangeGuests: false },
  policy: { text: "No refunds.", refundLadder: [] },
  ...over,
});

const member = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  subscriptionId: SUB,
  status: "active",
  plan: { name: "Round 3 yearly desk", interval: "year" },
  venue: { id: "44900000-0000-4000-8000-0000000000d1", name: "Gameland QA", brandSlug: "harmattan-qa-local", brandName: "Harmattan QA (local)", timezone: "Africa/Lagos" },
  memberCode: "X8XYUY",
  activeUntil: "2027-11-20T23:00:00+00:00",
  renewsOn: "2027-11-20T23:00:00+00:00",
  startedAt: "2026-11-21T12:04:19.483423+00:00",
  createdAt: "2026-11-21T12:03:25.193079+00:00",
  assignedSpace: { id: "1d1abf51-0f16-4a15-a431-39c4b3e40811", name: "Green Area North" },
  canLeave: true,
  canPause: true,
  version: 4,
  ...over,
});

const NOW = new Date("2026-11-21T12:00:00Z");

describe("#4490 W2 venue purchase model", () => {
  test("W2-M1 a booking shows the venue's own day and 24-hour time, guests, the pass and server money", () => {
    const b = parseVenueBooking(booking());
    expect(b).not.toBeNull();
    if (b === null) return;
    expect(venueBookingWhenLine(b)).toBe("Sun 22 Nov · 10:00 to 18:00");
    expect(venueBookingDoorPass(b)).toEqual({ passId: "63253af0-6e28-4bde-8419-e65ef43a456b", qrPayload: "v1.pass.qr" });
    expect(venueBookingMoneyRows(b)).toEqual([
      { label: "Total", value: "₦15,000.00" },
      { label: "Paid", value: "₦15,000.00" },
    ]);
    expect(venueBookingProgress(b)).toBeNull();
  });

  test("W2-M2 multi-day pass progress, hire extras, layout and a balance due", () => {
    const b = parseVenueBooking(
      booking({
        offerKind: "private_hire",
        passes: [{ passId: "p1", status: "valid", admits: 4, qrPayload: "q", daysAllowed: 10, daysUsed: 3, validUntilLocalDate: "2027-01-16" }],
        hire: { placeName: "The Lounge Side", layout: "banquet", sessionLabel: "Full day", bookedFrom: "2026-12-20T11:00:00+00:00", bookedTo: "2026-12-20T23:00:00+00:00", guests: 120, damageDepositMinor: 50000000 },
        extras: [{ name: "R2 guest kit", qty: 120, amountMinor: 12000000 }],
        balanceDueMinor: 7000000,
        balanceDueAt: "2026-11-26T15:00:00+00:00",
        paidAtVenueMinor: 100000,
      }),
    );
    if (b === null) throw new Error("parse");
    expect(venueBookingProgress(b)).toBe("Day 3 of 10 · valid until Sat 16 Jan");
    expect(venueBookingPlaceLine(b)).toBe("The Lounge Side · Banquet · Full day");
    expect(venueBookingExtraRows(b)).toEqual([
      { label: "R2 guest kit × 120", value: "₦120,000.00" },
      { label: "Damage deposit (refundable)", value: "₦500,000.00" },
    ]);
    expect(venueBookingMoneyRows(b)).toEqual(
      expect.arrayContaining([
        { label: "Paid at the venue", value: "₦1,000.00" },
        { label: "Left to pay by Thu 26 Nov", value: "₦70,000.00" },
      ]),
    );
  });

  // TEST-MOD-APPROVED #4490 (06-W4): the W2 pointer to the booking page is
  // retired; Purchases now pays in the app ("Pay the rest", "Pay to hold your
  // date") with the server's amounts.
  test("W2-M2b the pay action covers a balance and an approved hire's deposit (W4)", () => {
    const balance = parseVenueBooking(booking({ balanceDueMinor: 7000000, balanceDueAt: "2026-11-26T15:00:00+00:00" }));
    const approved = parseVenueBooking(booking({
      state: "approved_payment_required",
      amountDueNowMinor: 376250000,
      balanceDueMinor: 0,
      payModes: [{ mode: "deposit", amountMinor: 112875000 }, { mode: "full", amountMinor: 376250000 }],
    }));
    const paid = parseVenueBooking(booking());
    const atVenue = parseVenueBooking(booking({ balanceDueMinor: 7000000, paymentCollection: "venue" }));
    if (balance === null || approved === null || paid === null || atVenue === null) throw new Error("parse");
    expect(venueBookingPayAction(balance)).toEqual({ label: "Pay the rest", amountMinor: 7000000, payOptions: [] });
    expect(venueBookingPayAction(approved)).toEqual({
      label: "Pay to hold your date",
      amountMinor: 112875000,
      payOptions: [{ mode: "deposit", amountMinor: 112875000 }, { mode: "full", amountMinor: 376250000 }],
    });
    expect(venueBookingPayAction(atVenue)).toBeNull();
    expect(venueBookingMoneyRows(approved)).toEqual(
      expect.arrayContaining([{ label: "Pay to hold your date", value: "₦3,762,500.00" }]),
    );
    expect(venueBookingPayAction(paid)).toBeNull();
  });

  test("W2-M3 no door pass for a booking that is not confirmed or has no QR", () => {
    const held = parseVenueBooking(booking({ state: "request_pending" }));
    const noQr = parseVenueBooking(booking({ passes: [{ passId: "p", status: "valid", admits: 1, qrPayload: null }] }));
    expect(held !== null && venueBookingDoorPass(held)).toBeNull();
    expect(noQr !== null && venueBookingDoorPass(noQr)).toBeNull();
  });

  test("W2-M4 a yearly plan reads 'Paid until … 2027', the short member code and the desk", () => {
    const m = parseVenueMember(member());
    if (m === null) throw new Error("parse");
    expect(venueMemberState(m)).toEqual({ label: "Active", title: "You're a member", line: "Paid until Sun 21 Nov 2027." });
    expect(memberCodeWords(m.memberCode)).toBe("X8X YUY");
    expect(m.assignedSpace).toBe("Green Area North");
    expect(memberDay(m.renewsOn, m)).toBe("Sun 21 Nov 2027");
    expect(venueMemberCanRenew(m)).toBe(false);
  });

  test("W2-M5 by-request plans: requested, approved (pay now) and declined", () => {
    const requested = parseVenueMember(member({ status: "requested" }));
    const approved = parseVenueMember(member({ status: "pending", plan: { name: "Desk", interval: "month" } }));
    const declined = parseVenueMember(member({ status: "declined" }));
    if (requested === null || approved === null || declined === null) throw new Error("parse");
    expect(venueMemberState(requested).title).toBe("Request sent");
    expect(venueMemberCanRenew(requested)).toBe(false);
    expect(venueMemberState(approved).title).toBe("Pay your first month to start");
    expect(venueMemberCanRenew(approved)).toBe(true);
    expect(venueMemberState(declined).label).toBe("Declined");
  });

  test("W2-M6 waitlist words and unknown codes never show raw", () => {
    const [place] = parseVenueWaitlistPlaces([
      { id: WAIT, venueName: "Gameland W2", partySize: 3, desiredFrom: "19:00", desiredTo: "21:00", status: "waiting", timezone: "Africa/Lagos", startsAt: "2026-11-23T18:00:00+00:00" },
    ]);
    expect(venueWaitlistState(place)).toEqual({
      label: "Waiting",
      title: "You're on the waitlist",
      line: "We'll tell you as soon as a table for 3 opens between 19:00 and 21:00.",
    });
    expect(venueMemberErrorCopy("pg_raw_code_xyz")).toBe("Something went wrong. Try again.");
  });
});

describe("#4490 W2 Purchases list", () => {
  test("W2-T1 the three kinds land in Purchases with the right tab", () => {
    const live = parseVenueBooking(booking());
    const gone = parseVenueBooking(booking({ groupId: "a1b2c3d4-0000-4000-8000-000000000001", state: "cancelled" }));
    const m = parseVenueMember(member());
    if (live === null || gone === null || m === null) throw new Error("parse");
    const timeline = buildPurchaseTimeline(
      {
        orders: [],
        rsvps: [],
        reservations: [],
        venueOrders: [],
        venueBookings: [live, gone].map((b) => ({
          id: b.groupId, title: b.venue.name, brandName: b.venue.brandName, venueLine: b.offer.name,
          startAt: b.window?.startsAt ?? null, endAt: b.window?.endsAt ?? null, timezone: "Africa/Lagos",
          state: b.state, guests: 1, totalMinor: b.totalMinor, refundedMinor: 0, currency: "NGN", raw: b,
        })),
        venueMemberships: [{ id: SUB, title: m.planName, brandName: null, venueLine: m.venue.name, startAt: m.startedAt, endAt: m.activeUntil, timezone: "Africa/Lagos", status: "active", raw: m }],
        venueWaitlist: [
          { id: WAIT, title: "Gameland W2", venueLine: null, startAt: "2026-11-23T18:00:00+00:00", createdAt: null, timezone: "Africa/Lagos", status: "waiting", partySize: 3, raw: {} },
          { id: "w-old", title: "Gameland W2", venueLine: null, startAt: "2026-11-25T18:00:00+00:00", createdAt: null, timezone: "Africa/Lagos", status: "expired", partySize: 2, raw: {} },
        ],
      },
      NOW,
    );
    const upcoming = timeline.upcoming.flatMap((g) => g.items.map((i) => `${i.kind}:${i.id}`));
    const past = timeline.past.flatMap((g) => g.items.map((i) => `${i.kind}:${i.id}`));
    expect(upcoming).toEqual(expect.arrayContaining([`venue_booking:${GROUP}`, `venue_membership:${SUB}`, `venue_waitlist:${WAIT}`]));
    expect(past).toEqual(expect.arrayContaining(["venue_booking:a1b2c3d4-0000-4000-8000-000000000001", "venue_waitlist:w-old"]));
    expect(purchaseKindLabel("venue_booking")).toBe("Pass");
    expect(purchaseKindLabel("venue_membership")).toBe("Plan");
    expect(purchaseKindLabel("venue_waitlist")).toBe("Waitlist");
    expect(purchaseStatusLabel("approved_payment_required")).toBe("Pay to hold your date");
  });

  test("W2-F1 the fetchers read the three RPCs and map them", async () => {
    mockRpc.mockImplementation(async (fn: string) => ({
      data: fn === "issue_4490_my_offer_bookings" ? [booking(), { junk: true }]
        : fn === "issue_4490_my_memberships" ? [member()]
        : [{ id: WAIT, venueName: "Gameland W2", partySize: 3, status: "waiting", timezone: "Africa/Lagos", startsAt: "2026-11-23T18:00:00+00:00" }],
      error: null,
    }));
    const [b] = await fetchMyVenueBookings();
    expect(b.id).toBe(GROUP);
    expect(b.title).toBe("Harbour Palms Resort");
    expect(b.venueLine).toBe("Pool day pass");
    expect((await fetchMyVenueBookings()).length).toBe(1);
    expect((await fetchMyMemberships())[0].title).toBe("Round 3 yearly desk");
    expect((await fetchMyWaitlistEntries())[0].partySize).toBe(3);
  });

  test("W2-F2 a failed source throws (its rows show an error line and Retry, never a blank list)", async () => {
    mockRpc.mockImplementation(async () => ({ data: null, error: { message: "boom" } }));
    await expect(fetchMyVenueBookings()).rejects.toThrow("issue_4490_my_offer_bookings failed");
    await expect(fetchMyMemberships()).rejects.toThrow("issue_4490_my_memberships failed");
    await expect(fetchMyWaitlistEntries()).rejects.toThrow("issue_4490_my_waitlist_entries failed");
  });

  test("W2-K1 the live read key sits under the purchases prefix (logout and refresh clear it)", () => {
    expect(purchaseKeys.venueLive("u1", "venue_booking", GROUP).slice(0, 1)).toEqual(["purchases"]);
  });
});

describe("#4490 W2 links land on the detail (N157 closed)", () => {
  const row = (k: string, noun: string) => ({
    kind: k, id: "g1", routeKind: k, routeId: GROUP, offeringType: "venue", noun,
    title: "Gameland", orderLabel: null, startsAt: null, timezone: "Africa/Lagos", venueLine: null,
    quantity: 2, source: "booking", sentByFirstName: null, chatJoined: null, conversationId: null,
  });

  test("W2-R1 claim rows open the booking, plan and place detail", () => {
    for (const k of ["venue_booking", "venue_membership", "venue_waitlist"]) {
      const [entry] = parseClaimedEntries([row(k, k === "venue_waitlist" ? "booking" : "pass")]);
      expect(claimedEntryPath(entry)).toBe(`/purchases/${k}/${GROUP}`);
    }
  });

  test("W2-R2 push links open the detail; a Till receipt still opens the list", () => {
    const opened: string[] = [];
    const handlers = { openRouterPath: (p: string) => { opened.push(p); }, setCurrentPage: () => undefined };
    for (const k of ["venue_booking", "venue_membership", "venue_waitlist", "venue_till_sale"]) {
      executeDeepLink({ kind: "purchase", purchaseKind: k, purchaseId: GROUP, door: false } as never, handlers as never);
    }
    expect(opened).toEqual([
      `/purchases/venue_booking/${GROUP}`,
      `/purchases/venue_membership/${GROUP}`,
      `/purchases/venue_waitlist/${GROUP}`,
      "/purchases",
    ]);
  });
});
