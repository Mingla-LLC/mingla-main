/**
 * #4490 P4-3 — the guest's private hire: reading the hire offer, the day
 * strip (free / on hold / taken per day), session chips named from the
 * offer, the places for a session (too small filtered with one line, held
 * and taken explained), the quote and "Nothing to pay yet … ₦3,762,500 holds
 * your date" (D P4-3), the request address round trip, and the booking state
 * card for all ten states — the pay amount always the server's own number.
 */
import {
  hireDayTiles,
  hireGuestRange,
  hirePayNowMinor,
  hireRequestPath,
  hireStateCard,
  hireSummaryLines,
  hireTrackerSteps,
  parseHireBooking,
  parseHireDayRows,
  parseHireOfferDetail,
  parseHirePlaces,
  parseHireQuote,
  parseHireRequestParams,
  placeListFor,
  placeUnavailableLine,
  requestPromise,
  sessionChipsFor,
  hireErrorCopy,
} from "@mingla/brand-rendering/venueOffers/hireModel";

// [TEST-MOD-APPROVED #4490] Spec 07-H extends the existing P4 guest fixtures
// with the fixed layout list, per-place capacity and immutable quote facts.
const OFFER = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "private_hire",
  name: "Private hire",
  summary: null,
  currencyCode: "NGN",
  minorUnitExponent: 2,
  vat: { mode: "added", ratePct: 7.5 },
  confirmationMode: "request",
  extras: [
    { id: "projector", name: "Projector", priceMinor: 2500000, per: "booking" },
    { id: "welcome-drink", name: "Welcome drink", priceMinor: 150000, per: "guest" },
  ],
  options: [{ id: "o1", name: "The Lounge Side · 60–150 guests", unit: "booking", guestMin: 60, guestMax: 150, priceMinor: 700000000 }],
  deposit: { kind: "percent", value: 5000, balanceDueDaysBefore: 14 },
  venue: { name: "Gameland QA", timezone: "Africa/Lagos" },
  hire: {
    charge: "hire_fee",
    bookingMode: "request",
    requestResponseHours: 48,
    damageDepositMinor: 0,
    extraGuestMinor: null,
    overtimeMinorPerHour: null,
    layouts: ["banquet"],
    spaces: [{ id: "l", name: "The Lounge Side", setting: "covered" }],
    combinations: [{ id: "wg", name: "Whole Green Area", spaceIds: ["n", "s"] }],
    rows: [
      { optionId: "o1", name: "x", unit: "booking", spaceId: "l", placeName: "The Lounge Side", capacity: 200, layoutCapacities: { banquet: 120 }, guestMin: 60, guestMax: 150, priceMinor: 700000000 },
      { optionId: "o2", name: "y", unit: "booking", combinationId: "gl", placeName: "Green Area + Lounge", capacity: 500, guestMin: 250, guestMax: 500, priceMinor: 1000000000 },
    ],
    sessions: [
      { label: "Full day", startTime: "10:00", endTime: "22:00", pastMidnight: false },
      { label: "Evening", startTime: "18:00", endTime: "23:00", pastMidnight: false },
    ],
  },
};

describe("P4-3 hire offer and days", () => {
  it("reads the hire offer and its guest range (no 50 cap)", () => {
    const o = parseHireOfferDetail(OFFER);
    expect(o).not.toBeNull();
    expect(o?.mode).toBe("request");
    expect(o?.extras).toEqual([
      { id: "projector", name: "Projector", priceMinor: 2500000, per: "booking" },
      { id: "welcome-drink", name: "Welcome drink", priceMinor: 150000, per: "guest" },
    ]);
    expect(hireGuestRange(o!)).toEqual({ min: 60, max: 500 });
    expect(o?.layouts).toEqual(["banquet"]);
    expect(o?.rows[0].layoutCapacities).toEqual({ banquet: 120 });
    expect(parseHireOfferDetail({ ...OFFER, kind: "entry" })).toBeNull();
  });

  it("makes one tile per day from the best session, and names sessions from the offer", () => {
    const rows = parseHireDayRows({
      days: [
        { local_date: "2026-12-12", window_id: "w1", starts_at: "2026-12-12T09:00:00Z", ends_at: "2026-12-12T21:00:00Z", status: "taken" },
        { local_date: "2026-12-12", window_id: "w2", starts_at: "2026-12-12T17:00:00Z", ends_at: "2026-12-12T22:00:00Z", status: "available" },
        { local_date: "2026-12-13", window_id: "w3", starts_at: "2026-12-13T09:00:00Z", ends_at: "2026-12-13T21:00:00Z", status: "held" },
        { local_date: "2026-12-14", window_id: "w4", starts_at: "x", ends_at: "y", status: "bogus" },
      ],
    });
    expect(rows).toHaveLength(3);
    const tiles = hireDayTiles(rows, "2026-12-12", 3);
    expect(tiles.map((t) => t.word)).toEqual(["Free", "On hold", ""]);
    const o = parseHireOfferDetail(OFFER)!;
    const chips = sessionChipsFor(rows, "2026-12-12", o.sessions, "Africa/Lagos");
    expect(chips.map((c) => [c.label, c.times, c.note])).toEqual([
      ["Full day", "10:00–22:00", "Taken"],
      ["Evening", "18:00–23:00", null],
    ]);
  });

  it("filters spaces too small for the group with one line, and explains held and taken ones", () => {
    const places = parseHirePlaces({
      options: [
        { price_option_id: "a", place_name: "Green Area North", guest_min: 50, guest_max: 100, unit: "booking", price_minor: 400000000, status: "too_small" },
        { price_option_id: "b", place_name: "The Lounge Side", guest_min: 60, guest_max: 150, unit: "booking", price_minor: 700000000, status: "available" },
        { price_option_id: "c", place_name: "Green Area + Lounge", guest_min: 250, guest_max: 500, unit: "booking", price_minor: 1000000000, status: "held", reason: "booking", blocked_by: "The Lounge Side" },
      ],
    });
    const view = placeListFor(places, 120);
    expect(view.shown.map((p) => p.priceOptionId)).toEqual(["b", "c"]);
    expect(view.hiddenLine).toBe("Green Area North is too small for 120, so it's not shown.");
    expect(placeUnavailableLine(places[2])).toBe("On hold: The Lounge Side is held that day");
    expect(placeUnavailableLine({ ...places[1], status: "too_big", guestMin: 250 })).toBe("For groups of at least 250");
  });
});

describe("P4-3 quote and request", () => {
  const quote = parseHireQuote({
    quoteId: "q1",
    currencyCode: "NGN",
    subtotalMinor: 700000000,
    taxMinor: 52500000,
    totalMinor: 752500000,
    vat: { mode: "added", ratePct: 7.5, amountMinor: 52500000 },
    lines: [],
    extras: [
      { id: "projector", name: "Projector", per: "booking", qty: 1, amountMinor: 2500000 },
      { id: "welcome-drink", name: "Welcome drink", per: "guest", qty: 120, amountMinor: 18000000 },
    ],
    mode: "request",
    hire: { placeName: "The Lounge Side", layout: "banquet", layoutCapacity: 120, guests: 120, hireMinor: 700000000, extrasMinor: 20500000, damageDepositMinor: 0, requestResponseHours: 48, payPlan: { payModes: ["deposit", "full"], depositMinor: 376250000, depositKind: "percent", depositValue: 5000 } },
  })!;

  it("says nothing is paid yet and what holds the date (the server's deposit)", () => {
    expect(hirePayNowMinor(quote)).toBe(376250000);
    expect([quote.layout, quote.layoutCapacity]).toEqual(["banquet", 120]);
    expect(requestPromise(quote, "Gameland QA", 2)).toBe(
      "Nothing to pay yet. Gameland QA replies within 48 hours. If they say yes, ₦3,762,500 holds your date.",
    );
    expect(hireSummaryLines(quote, 2).map((l) => `${l.label}=${l.value}`)).toEqual([
      "The Lounge Side · 120 guests=₦7,000,000",
      "Projector=₦25,000",
      "Welcome drink=₦180,000",
      "VAT 7.5%=₦525,000",
      "Total=₦7,525,000",
    ]);
  });

  it("carries the choice in the address and nothing personal", () => {
    const path = hireRequestPath({
      brandSlug: "harmattan-qa-local",
      venueSlug: "gamelandqa",
      offerId: OFFER.id,
      date: "2026-12-12",
      windowId: "22222222-2222-4222-8222-222222222222",
      guests: 120,
      priceOptionId: "33333333-3333-4333-8333-333333333333",
    });
    expect(path).toBe(
      `/b/harmattan-qa-local/v/gamelandqa/book/${OFFER.id}?k=hire&d=2026-12-12&w=22222222-2222-4222-8222-222222222222&g=120&o=33333333-3333-4333-8333-333333333333`,
    );
    const params = Object.fromEntries(new URL(`https://x${path}`).searchParams.entries());
    expect(parseHireRequestParams(params)).toEqual({
      date: "2026-12-12",
      windowId: "22222222-2222-4222-8222-222222222222",
      guests: 120,
      priceOptionId: "33333333-3333-4333-8333-333333333333",
    });
    expect(parseHireRequestParams({ ...params, k: "group" })).toBeNull();
    expect(hireErrorCopy("offer_space_taken")).not.toMatch(/_/);
    expect(hireErrorCopy("offer_group_too_big", { placeName: "The Main Hall", capacity: 120, layout: "banquet" })).toBe(
      "The Main Hall holds 120 seated for a banquet.",
    );
  });
});

describe("P4-3 booking state card", () => {
  const raw = (over: Record<string, unknown>, hire: Record<string, unknown> = {}): Record<string, unknown> => ({
    totalMinor: 731000000,
    totalDueMinor: 731000000,
    balanceDueMinor: 731000000,
    depositMinor: 365500000,
    requestDeadline: "2026-11-21T07:00:00Z",
    hire: { placeName: "The Lounge Side", layout: "banquet", layoutCapacity: 120, guests: 120, replyWithinHours: 48, ...hire },
    ...over,
  });
  const card = (state: string, over: Record<string, unknown> = {}, hire: Record<string, unknown> = {}, amountDueNowMinor = 0, holdUntil: string | null = null) =>
    hireStateCard({
      state,
      venueName: "Gameland QA",
      hire: parseHireBooking(raw(over, hire))!,
      amountDueNowMinor,
      holdUntil,
      localDate: "2026-12-12",
      timeZone: "Africa/Lagos",
      currencyCode: "NGN",
      exponent: 2,
      now: Date.parse("2026-11-20T12:00:00Z"),
    });

  it("renders every one of the ten states in plain words", () => {
    expect(card("request_pending").title).toBe("Request sent");
    expect(card("declined", {}, { declineReason: "We have a wedding that day" }).body).toBe("“We have a wedding that day” Nothing was charged.");
    expect(card("request_expired").title).toBe("This request timed out");
    expect(card("request_expired", {}, { closedReason: "withdrawn" }).title).toBe("You withdrew this request");
    const pay = card("approved_payment_required", {}, {}, 365500000, "2026-11-22T12:00:00Z");
    expect(pay.title).toBe("Gameland QA said yes");
    expect(pay.payMinor).toBe(365500000);
    expect(pay.body).toContain("Pay ₦3,655,000 to make Sat 12 Dec yours");
    expect(card("approved_payment_required", {}, {}, 365500000, "2026-11-19T12:00:00Z").kind).toBe("hold_ran_out");
    expect(card("instant_payment_pending", {}, {}, 365500000, "2026-11-20T12:30:00Z").kind).toBe("pay_deposit");
    expect(card("finalizing").title).toBe("Confirming your payment");
    const confirmed = card("confirmed", { balanceDueMinor: 365500000 });
    expect(confirmed.title).toBe("It's yours");
    expect(confirmed.payMinor).toBe(365500000);
    expect(card("partially_cancelled").kind).toBe("partly_cancelled");
    expect(card("cancelled").title).toBe("Booking cancelled");
    expect(card("reconciliation_required").title).toBe("We're checking your payment");
  });

  it("walks the tracker: sent → yes → deposit → rest → day", () => {
    const h = parseHireBooking(raw({ balanceDueMinor: 365500000 }))!;
    expect([h.layout, h.layoutCapacity]).toEqual(["banquet", 120]);
    expect(hireTrackerSteps("request_pending", "Gameland QA", h).find((s) => s.current)?.label).toBe("Gameland QA says yes");
    expect(hireTrackerSteps("confirmed", "Gameland QA", h).find((s) => s.current)?.label).toBe("You pay the rest");
    expect(parseHireBooking({ hire: null })).toBeNull();
  });

  it("keeps the chosen extras on the booking snapshot", () => {
    const h = parseHireBooking(
      raw(
        {
          extras: [
            { id: "projector", name: "Projector", per: "booking", qty: 1, amountMinor: 2500000 },
            { id: "welcome-drink", name: "Welcome drink", per: "guest", qty: 120, amountMinor: 18000000 },
          ],
        },
        { extrasMinor: 20500000 },
      ),
    )!;
    expect(h.extras).toEqual([
      { id: "projector", name: "Projector", per: "booking", qty: 1, amountMinor: 2500000 },
      { id: "welcome-drink", name: "Welcome drink", per: "guest", qty: 120, amountMinor: 18000000 },
    ]);
  });
});
