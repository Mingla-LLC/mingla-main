/**
 * #4490 P3-2 — pure rules behind the Group package editor, one booking's
 * money and the door step for groups: no 50-guest cap (bounded by the day
 * limit), start times from first / last / every, payloads the P3 contract
 * expects (inclusions, extras, deposit, change rules), plain words for money
 * owed, changes and staff cancels, and the pass id inside a scanned code.
 */
import {
  changeRulesPayload,
  depositChoiceLabel,
  depositLine,
  extrasPayload,
  groupCap,
  inclusionsPayload,
  newInclusion,
  packageDraftFrom,
  packageOptionWrites,
  packageReadinessLine,
  packageStepIssue,
  paymentPayload,
  startPattern,
  startTimesFor,
  staffRoleFor,
  type PackageDraft,
} from "../features/offers/packageModel";
import { NEW_OFFER_CARDS, offerErrorCopy, priceColumn, whenColumn } from "../features/offers/offersModel";
import {
  balanceDueLine,
  changePreviewWords,
  changeWords,
  historyTitle,
  moneyRows,
  staffCancelWords,
  whenLine,
} from "../features/bookings/bookingModel";
import { needsGroupStep, passIdFromCode } from "../features/checkin/venueCheckInResult";
import { dayBalances, shiftDay } from "../features/today/todayModel";
import { mapOffer, mapPass, mapVenueBooking, mapVenueDay } from "../../../services/venueOffersService";
import type { CheckInPass, VenueCapacityPool, VenueDay } from "../../../types/venueOffers";

const POOL: VenueCapacityPool = {
  id: "p1",
  name: "Gameland day",
  dailyLimit: 400,
  keptForWalkIns: 100,
  spaceIds: null,
  archived: false,
  version: 1,
};

function draft(over: Partial<PackageDraft> = {}): PackageDraft {
  return { ...packageDraftFrom({ offer: null, pool: POOL }), name: "Squad", priceMinor: 1_000_000, guestMin: 10, guestMax: 60, ...over };
}

const SQUAD_WIRE = {
  id: "o1",
  venueId: "v1",
  kind: "group_package",
  name: "Squad",
  summary: "3 hours of games",
  status: "live",
  version: 10,
  pool: { id: "p1" },
  options: [{ id: "opt1", name: "Squad", unit: "guest", guestMin: 10, guestMax: 60, priceMinor: 1_000_000, weekdays: [0, 1, 2, 3, 4, 5, 6], sortOrder: 0, version: 1 }],
  policy: {
    refundLadder: [
      { minMinutesBefore: 4320, refundBps: 10000 },
      { minMinutesBefore: 0, refundBps: 5000 },
    ],
    dateChangeRule: { feeBps: 0, maxChanges: 2, allowedUntilMinutesBefore: 1440, guestChangeUntilMinutesBefore: 2880 },
  },
  schedule: { mode: "sessions", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  inclusions: [
    { kind: "perk", label: "3 hours of games" },
    { kind: "staff", label: "A Games Master", staffRatio: 15 },
    { kind: "choice", label: "Rice for the group", options: ["Party jollof", "Coconut rice", "Native rice"] },
    { kind: "menu_item", label: "2 × Small chops", menuItemId: "00000000-0000-4000-8000-000000000001", qtyPer: "guest" },
  ],
  extras: [
    { id: "x1", name: "Cake table", priceMinor: 2_000_000, per: "booking" },
    { id: "x2", name: "Extra hour", priceMinor: 5_000_000, per: "booking" },
  ],
  deposit: { kind: "percent", value: 5000, balanceDueDaysBefore: 2 },
  payModes: ["deposit", "full"],
  startTimes: ["12:00", "14:00", "16:00", "18:00"],
  durationMinutes: 180,
  minNoticeMinutes: 4320,
  warnings: ["online_payments_off"],
  canCollectOnline: false,
  readiness: [],
};

describe("#4490 P3-2 group package editor", () => {
  it("offers Group package as a buildable kind", () => {
    expect(NEW_OFFER_CARDS.find((c) => c.key === "group_package")?.built).toBe(true);
  });

  it("takes 60 and a 120-guest package: no 50 cap, bounded by the day limit", () => {
    expect(packageStepIssue("price", draft({ guestMax: 60 }), POOL)).toBeNull();
    expect(packageStepIssue("price", draft({ guestMax: 120 }), POOL)).toBeNull();
    expect(packageStepIssue("price", draft({ guestMax: 401 }), POOL)).toMatch(/400/);
    expect(groupCap(null, draft({ dailyLimit: 150 }))).toBe(150);
  });

  it("asks for a price and a sane group size in plain words", () => {
    expect(packageStepIssue("price", draft({ priceMinor: null }), POOL)).toBe("Enter a price");
    expect(packageStepIssue("price", draft({ guestMin: 20, guestMax: 10 }), POOL)).toMatch(/smaller than the smallest/);
    expect(packageStepIssue("basics", draft({ name: "  " }), POOL)).toBe("Name this package");
  });

  it("builds start times from first, last and every (24 h chips, max 24)", () => {
    expect(startTimesFor("12:00", "18:00", 120)).toEqual(["12:00", "14:00", "16:00", "18:00"]);
    expect(startTimesFor("18:00", "12:00", 120)).toEqual([]);
    expect(startTimesFor("00:00", "23:59", 15)).toHaveLength(24);
    expect(startPattern(["16:00", "12:00", "14:00", "18:00"])).toEqual({ first: "12:00", last: "18:00", every: 120 });
  });

  it("reads a saved package back into the editor", () => {
    const d = packageDraftFrom({ offer: mapOffer(SQUAD_WIRE), pool: POOL });
    expect(d.charge).toBe("per_guest");
    expect([d.guestMin, d.guestMax, d.priceMinor]).toEqual([10, 60, 1_000_000]);
    expect(d.firstStart).toBe("12:00");
    expect(d.lastStart).toBe("18:00");
    expect(d.startEvery).toBe(120);
    expect(d.depositKind).toBe("percent");
    expect(d.depositPercent).toBe(50);
    expect(d.balanceDueDaysBefore).toBe(2);
    expect(d.guestChangeCutoffMinutes).toBe(2880);
    expect(d.maxChanges).toBe(2);
    const menu = d.inclusions.find((i) => i.kind === "menu_item");
    expect(menu?.label).toBe("Small chops");
    expect(menu?.menuQty).toBe(2);
    expect(d.extras.map((e) => e.id)).toEqual(["x1", "x2"]);
  });

  it("writes inclusions, extras, deposit and change rules the way the contract takes them", () => {
    const d = packageDraftFrom({ offer: mapOffer(SQUAD_WIRE), pool: POOL });
    const inc = inclusionsPayload(d);
    expect(inc[0]).toEqual({ kind: "perk", label: "3 hours of games" });
    expect(inc[1]).toEqual({ kind: "staff", label: "A Games Master", staffRatio: 15 });
    expect(inc[2]).toEqual({ kind: "choice", label: "Rice for the group", options: ["Party jollof", "Coconut rice", "Native rice"] });
    expect(inc[3]).toEqual({ kind: "menu_item", label: "2 × Small chops", menuItemId: "00000000-0000-4000-8000-000000000001", qtyPer: "guest" });
    expect(extrasPayload(d)[0]).toEqual({ id: "x1", name: "Cake table", priceMinor: 2_000_000, per: "booking" });
    expect(staffRoleFor(d)).toBe("Games Master");
    expect(paymentPayload(d)).toEqual({ depositKind: "percent", depositValue: 5000, balanceDueDaysBefore: 2 });
    expect(paymentPayload({ ...d, depositKind: "none" })).toEqual({ depositKind: "none" });
    expect(changeRulesPayload(d)).toEqual({ allowedUntilMinutesBefore: 1440, maxChanges: 2, feeBps: 0, guestChangeUntilMinutesBefore: 2880 });
  });

  it("a question needs 2 to 10 options; a menu line needs its item", () => {
    const choice = { ...newInclusion("choice"), label: "Rice", options: ["Jollof"] };
    expect(packageStepIssue("included", draft({ inclusions: [choice] }), POOL)).toBe("Give guests 2 to 10 options");
    const menu = { ...newInclusion("menu_item"), label: "Chops" };
    expect(packageStepIssue("included", draft({ inclusions: [menu] }), POOL)).toBe("Pick the menu item");
    expect(packageStepIssue("included", draft({ extras: [{ key: "e", id: null, name: "", priceMinor: 100, per: "booking" }] }), POOL)).toMatch(/Name this extra/);
  });

  it("price by group size writes one per-guest option per size and refuses overlaps", () => {
    const d = draft({
      charge: "by_size",
      tiers: [
        { key: "a", id: null, guestMin: 10, guestMax: 20, priceMinor: 1_000_000 },
        { key: "b", id: null, guestMin: 21, guestMax: 60, priceMinor: 900_000 },
      ],
    });
    expect(packageStepIssue("price", d, POOL)).toBeNull();
    const writes = packageOptionWrites(d, []);
    expect(writes.map((w) => [w.payload.name, w.payload.unit, w.payload.guestMin, w.payload.guestMax])).toEqual([
      ["10 to 20 guests", "guest", 10, 20],
      ["21 to 60 guests", "guest", 21, 60],
    ]);
    const overlap = { ...d, tiers: [d.tiers[0], { ...d.tiers[1], guestMin: 15 }] };
    expect(packageStepIssue("price", overlap, POOL)).toMatch(/inside the 10–20 range/);
  });

  it("one price for the group is charged per booking", () => {
    const w = packageOptionWrites(draft({ charge: "per_group" }), [])[0];
    expect(w.payload.unit).toBe("booking");
  });

  it("says the deposit and the pay choice in plain words", () => {
    expect(depositChoiceLabel(draft({ depositKind: "percent", depositPercent: 50 }), "NGN")).toBe("Half now");
    expect(depositChoiceLabel(draft({ depositKind: "percent", depositPercent: 30 }), "NGN")).toBe("30% now");
    expect(depositLine(draft({ depositKind: "percent", depositPercent: 50, balanceDueDaysBefore: 2 }), "NGN")).toBe(
      "50% deposit, the rest 2 days before",
    );
  });

  it("maps package readiness and refusals to plain words, never a code", () => {
    expect(packageReadinessLine("no_start_times")).toEqual({ text: "Set the start times.", step: "where" });
    expect(offerErrorCopy("inclusions_invalid")).not.toMatch(/inclusions_invalid/);
    expect(offerErrorCopy("offer_amount_over_balance")).toMatch(/more than they still owe/);
  });

  it("reads the package fields and the F4 warning from the offer projection", () => {
    const o = mapOffer(SQUAD_WIRE);
    expect(o.canCollectOnline).toBe(false);
    expect(o.warnings).toEqual(["online_payments_off"]);
    expect(o.payModes).toEqual(["deposit", "full"]);
    expect(priceColumn(o, "NGN")).toMatch(/a guest · 10–60 guests/);
    expect(whenColumn(o)).toMatch(/starts 12:00, 14:00, 16:00, 18:00 · 3 h/);
  });
});

const BOOKING_WIRE = {
  groupId: "g1",
  reference: "VB-1",
  state: "confirmed",
  version: 4,
  offerKind: "group_package",
  offer: { id: "o1", name: "Squad" },
  guest: { name: "Ada", email: "ada@example.com", phone: null },
  venue: { timezone: "Africa/Lagos", brandSlug: "b", slug: "v" },
  window: { windowId: "w1", localDate: "2026-11-28", startsAt: "2026-11-28T15:00:00+00:00", endsAt: "2026-11-28T18:00:00+00:00" },
  lines: [{ lineId: "l1", priceOptionId: "opt1", name: "Squad", guests: 12, bookedGuests: 12, state: "confirmed" }],
  currencyCode: "NGN",
  totalMinor: 15_050_000,
  totalDueMinor: 15_050_000,
  paidMinor: 7_525_000,
  paidOnlineMinor: 7_525_000,
  paidAtVenueMinor: 0,
  refundedMinor: 0,
  balanceDueMinor: 7_525_000,
  balanceDueAt: "2026-11-26T15:00:00+00:00",
  extras: [{ id: "x1", name: "Cake table", per: "booking", qty: 1, amountMinor: 2_000_000 }],
  answers: { "Rice for the group": "Party jollof" },
  changes: [],
  changeRules: { canMove: true, canChangeGuests: true, canAddExtras: true, changesUsed: 0, feeBps: 0 },
  payments: [],
  paidAtVenue: [],
  history: [{ type: "stay_reservation_confirmed", by: "service", at: "2026-11-19T02:56:12Z" }],
  canManageMoney: true,
  canChange: true,
  passes: [{ admits: 12, admittedCount: 0 }],
};

describe("#4490 P3-2 one booking's money", () => {
  const b = mapVenueBooking(BOOKING_WIRE);

  it("reads the booking and its money", () => {
    expect(b.balanceDueMinor).toBe(7_525_000);
    expect(b.answers).toEqual({ "Rice for the group": "Party jollof" });
    expect(b.admits).toBe(12);
    expect(b.timezone).toBe("Africa/Lagos");
    expect(whenLine(b)).toBe("Sat 28 Nov · 16:00 to 19:00");
  });

  it("shows total, paid online and still to pay, and when it's due or overdue", () => {
    const rows = moneyRows(b);
    expect(rows.map((r) => r.label)).toEqual(["Total", "Paid online", "Still to pay"]);
    expect(rows[2].value).toBe("₦75,250");
    expect(balanceDueLine(b, Date.parse("2026-11-20T00:00:00Z"))).toBe("₦75,250 due by Thu 26 Nov");
    expect(balanceDueLine(b, Date.parse("2026-11-27T00:00:00Z"))).toBe("₦75,250 overdue since Thu 26 Nov");
    expect(balanceDueLine({ ...b, balanceDueMinor: 0 }, 0)).toBeNull();
  });

  it("says what a change does before it applies", () => {
    const more = changePreviewWords({
      action: "change_guests",
      fromGuests: 12,
      toGuests: 14,
      fromDate: null,
      toDate: null,
      toStartsAt: null,
      priceDeltaMinor: 2_000_000,
      taxDeltaMinor: 150_000,
      feeMinor: 0,
      amountMinor: 2_150_000,
      totalDueBeforeMinor: 15_050_000,
      totalDueAfterMinor: 17_200_000,
      paidMinor: 7_525_000,
      refundMinor: 0,
      balanceAfterMinor: 9_675_000,
      currencyCode: "NGN",
      groupVersion: 5,
      replayed: false,
    });
    expect(more.title).toBe("₦21,500 more (₦20,000 + VAT ₦1,500)");
    expect(more.body).toMatch(/Still to pay after this: ₦96,750/);
    expect(changeWords({ changeId: "c", kind: "change_guests", fromGuests: 12, toGuests: 14, fromDate: null, toDate: null, extras: [], amountMinor: 2_150_000, feeMinor: 0, refundMinor: 0, by: "guest", createdAt: null }, "NGN")).toBe(
      "Guests 12 → 14, ₦21,500 more",
    );
  });

  it("tells staff what cancelling refunds, and that money taken at the venue stays", () => {
    expect(staffCancelWords({ paidMinor: 15_050_000, refundMinor: 15_050_000, keepMinor: 0, paidAtVenueMinor: 5_375_000, currency: "NGN" })).toMatch(
      /get all of it back\. The ₦53,750 taken at the venue isn't refunded here/,
    );
    expect(historyTitle("stay_offer_paid_at_venue", "staff")).toBe("Money taken at the venue (by the venue)");
  });
});

describe("#4490 P3-2 the door and the day", () => {
  const pass = (over: Partial<CheckInPass> = {}): CheckInPass => ({
    passId: "11111111-2222-4333-8444-555555555555",
    groupId: "g1",
    reference: "VB-1",
    holderName: "Ada",
    offerName: "Squad",
    offerKind: "group_package",
    admits: 14,
    admittedCount: 0,
    remaining: 14,
    validLocalDate: null,
    dayLabel: null,
    idCheckLabel: null,
    idCheckCount: 0,
    status: "valid",
    source: null,
    time: null,
    lastAdmittedAt: null,
    balanceDueMinor: 0,
    ...over,
  });

  it("finds the pass inside a scanned code", () => {
    expect(passIdFromCode("mingla:v1:vpass:11111111-2222-4333-8444-555555555555:sig:abc")).toBe("11111111-2222-4333-8444-555555555555");
    expect(passIdFromCode("VB-123")).toBeNull();
  });

  it("a group or money owed gets the step before anyone goes in", () => {
    expect(needsGroupStep(pass())).toBe(true);
    expect(needsGroupStep(pass({ offerKind: "entry", admits: 3 }))).toBe(false);
    expect(needsGroupStep(pass({ offerKind: "entry", admits: 1, balanceDueMinor: 500 }))).toBe(true);
    expect(needsGroupStep(pass({ status: "void", balanceDueMinor: 500 }))).toBe(false);
  });

  it("adds up balances to collect on a day and moves between days", () => {
    const day = {
      localDate: "2026-11-28",
      timezone: "Africa/Lagos",
      closed: false,
      pools: [],
      offers: [],
      checkIn: { passes: 0, expected: 0, admitted: 0 },
      // TEST-MOD-APPROVED #4490 07-E: the day carries the server's money (null here).
      money: null,
      bookings: [
        { groupId: "a", reference: "a", state: "confirmed", guestName: "A", guests: 12, totalMinor: 1, currencyCode: "NGN", source: null, paymentCollection: "mingla", admittedCount: 0, createdAt: "", balanceDueMinor: 7_525_000, balanceDueAt: "2026-11-26T15:00:00Z" },
        { groupId: "b", reference: "b", state: "confirmed", guestName: "B", guests: 2, totalMinor: 1, currencyCode: "NGN", source: null, paymentCollection: "mingla", admittedCount: 0, createdAt: "", balanceDueMinor: 0 },
      ],
    } as VenueDay;
    expect(dayBalances(day, Date.parse("2026-11-27T00:00:00Z"))).toEqual({ count: 1, owedMinor: 7_525_000, overdue: 1 });
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("#4490 P3-2 gate sales are already paid", () => {
  it("a cash or transfer gate sale never shows money to take (the server reports its total as owed)", () => {
    const day = mapVenueDay({
      localDate: "2026-11-19",
      bookings: [
        { groupId: "g", state: "confirmed", paymentCollection: "property", balanceDueMinor: 1_075_000 },
        { groupId: "h", state: "confirmed", paymentCollection: "mingla", balanceDueMinor: 2_150_000 },
      ],
    });
    expect(day.bookings.map((b) => b.balanceDueMinor)).toEqual([0, 2_150_000]);
    expect(mapPass({ passId: "p", source: "gate", balanceDueMinor: 1_075_000 }).balanceDueMinor).toBe(0);
    expect(mapPass({ passId: "p", source: "online", balanceDueMinor: 500 }).balanceDueMinor).toBe(500);
    expect(mapVenueBooking({ ...BOOKING_WIRE, paymentCollection: "property" }).balanceDueMinor).toBe(0);
  });
});
