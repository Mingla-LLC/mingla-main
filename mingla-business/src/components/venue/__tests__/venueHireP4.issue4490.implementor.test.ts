/**
 * #4490 P4-2 — the Host's private hire: the editor model (recommended
 * defaults, rows bounded by the space's capacity, payloads per charge, the
 * cancel ladders), Requests (state → tab for all ten states, pills, closed
 * words, every staff refusal in plain words, the conflict dialog words and the
 * edited-quote numbers from D P4-5: ₦6,800,000 + VAT ₦510,000 = ₦7,310,000,
 * deposit ₦3,655,000), the Calendar (week range, a combination blocked by a
 * part, a part inside a combined hire, setup/cleanup times, the hire cut,
 * venue-local times to instants), the service readers and the nav.
 */
import {
  HIRE_STEPS,
  emptyHireRow,
  hireDraftFrom,
  hireErrorCopy,
  hireLadder,
  hirePlaces,
  hirePresetFor,
  hireReadinessLine,
  hireStepIssue,
  layoutsPayload,
  placeKey,
  rowIssues,
  rowPayload,
  termsPayload,
  type HireDraft,
} from "../features/offers/hireModel";
import { extrasPayload } from "../features/offers/packageModel";
import {
  approveWords,
  closedWords,
  conflictWords,
  countFor,
  emptyWords,
  quotePreview,
  requestPill,
  staffErrorCopy,
  tabForState,
} from "../features/requests/requestsModel";
import {
  blockIssue,
  blocksFor,
  calendarRows,
  entryFill,
  rangeFor,
  rangeTitle,
  shiftAnchor,
  touchesDay,
  zonedIso,
} from "../features/calendar/calendarModel";
import { mapHireTerms, mapVenueCalendar, mapVenueRequest } from "../../../services/venueOffersService";
import type { VenueSpace, VenueSpaceCombination } from "../../../services/venueFeaturesService";
import type { VenueRequest } from "../../../types/venueOffers";
import { BUILT_FEATURES } from "../../../types/venueFeatures";
import { BUILT_MODULES } from "../venueModules";
import { BUILT_OFFER_KINDS } from "../../../types/venueOffers";
import { NEW_OFFER_CARDS } from "../features/offers/offersModel";

// [TEST-MOD-APPROVED #4490] Spec 07-H extends the existing P4 host fixtures
// and model proof with capacities for every guest-selectable layout.
const space = (id: string, name: string, standing: number, canBeHired = true): VenueSpace => ({
  id,
  venueId: "v",
  name,
  setting: "covered",
  capacityStanding: standing,
  capacitySeated: null,
  layouts: [],
  photos: [],
  planShape: null,
  sortOrder: 0,
  canBeHired,
  stepFree: null,
  amenities: [],
  version: 1,
});

const SPACES = [space("n", "Green Area North", 150), space("s", "Green Area South", 150), space("l", "The Lounge Side", 200)];
const COMBOS: VenueSpaceCombination[] = [{ id: "wg", venueId: "v", name: "Whole Green Area", spaceIds: ["n", "s"], version: 1 }];

describe("P4-2 hire editor model", () => {
  it("has the seven steps the design names", () => {
    expect(HIRE_STEPS.map((s) => s.label)).toEqual(["Spaces", "Times", "Price", "Extras", "Deposit and terms", "How guests book", "Review"]);
  });

  it("starts a new hire on the recommended values (request first, 50%, 14 days, 3 h / 2 h, 48 h / 72 h)", () => {
    const d = hireDraftFrom(null);
    expect(d.mode).toBe("request");
    expect(d.depositOn).toBe(true);
    expect(d.depositPercent).toBe(50);
    expect(d.balanceDueDaysBefore).toBe(14);
    expect(d.setupMinutes).toBe(180);
    expect(d.cleanupMinutes).toBe(120);
    expect(d.requestResponseHours).toBe(48);
    expect(d.approvedPaymentMinutes).toBe(4320);
    expect(d.sessions.map((s) => s.label)).toEqual(["Full day"]);
    expect(d.damageDepositMinor).toBeNull();
    expect(d.extras).toEqual([]);
  });

  it("reads, validates and writes paid hire extras without changing their durable ids", () => {
    const saved = hireDraftFrom({
      extras: [
        { id: "projector", name: "Projector", priceMinor: 2500000, per: "booking" },
        { id: "welcome-drink", name: "Welcome drink", priceMinor: 150000, per: "guest" },
      ],
    } as never);
    expect(saved.extras.map(({ id, name, priceMinor, per }) => ({ id, name, priceMinor, per }))).toEqual([
      { id: "projector", name: "Projector", priceMinor: 2500000, per: "booking" },
      { id: "welcome-drink", name: "Welcome drink", priceMinor: 150000, per: "guest" },
    ]);
    expect(extrasPayload(saved)).toEqual([
      { id: "projector", name: "Projector", priceMinor: 2500000, per: "booking" },
      { id: "welcome-drink", name: "Welcome drink", priceMinor: 150000, per: "guest" },
    ]);
    expect(hireStepIssue("extras", { ...saved, extras: [{ ...saved.extras[0], name: "" }] }, [])).toBe(
      "An extra: Name this extra",
    );
  });

  it("lists spaces then combinations with their summed capacity, and marks unhirable ones", () => {
    const places = hirePlaces([...SPACES, space("m", "Marquee", 120, false)], COMBOS);
    expect(places.find((p) => p.id === "wg")?.capacity).toBe(300);
    expect(places.find((p) => p.id === "m")?.hirable).toBe(false);
  });

  it("sums a combination only when every part offers a layout and persists the guest choices", () => {
    const parts: VenueSpace[] = [
      { ...space("a", "Hall A", 100), capacitySeated: 60, layouts: [{ layout: "banquet", capacity: 55 }] },
      { ...space("b", "Hall B", 80), capacitySeated: null, layouts: [{ layout: "banquet", capacity: 45 }] },
    ];
    const places = hirePlaces(parts, [{ id: "whole", venueId: "v", name: "Whole Hall", spaceIds: ["a", "b"], version: 1 }]);
    const whole = places.find((place) => place.id === "whole");
    expect(whole?.layoutCapacities.banquet).toBe(100);
    expect(whole?.layoutCapacities.seated).toBeUndefined();
    const draft = { ...hireDraftFrom(null), combinationIds: ["whole"], layouts: ["banquet" as const] };
    expect(hireStepIssue("spaces", draft, places)).toBeNull();
    expect(layoutsPayload(draft)).toEqual({ layouts: ["banquet"] });
    expect(hireStepIssue("spaces", { ...draft, layouts: ["seated"] }, places)).toMatch(/every chosen layout/);
  });

  it("does not invent zero-capacity layouts when a stale combination is missing a part", () => {
    const parts: VenueSpace[] = [
      { ...space("a", "Hall A", 100), capacitySeated: 60, layouts: [{ layout: "banquet", capacity: 55 }] },
    ];
    const places = hirePlaces(parts, [{ id: "whole", venueId: "v", name: "Whole Hall", spaceIds: ["a", "missing"], version: 1 }]);
    const whole = places.find((place) => place.id === "whole");
    expect(whole?.hirable).toBe(false);
    expect(whole?.layoutCapacities).toEqual({});
  });

  it("refuses a row above its space's capacity with the space's name (no 50 cap)", () => {
    const places = hirePlaces(SPACES, COMBOS);
    const row = { ...emptyHireRow(placeKey("space", "n")), guestMin: 50, guestMax: 200, priceMinor: 400000000 };
    expect(rowIssues(row, places).guests).toBe("More than Green Area North holds (150)");
    const ok = { ...row, guestMax: 150 };
    expect(rowIssues(ok, places)).toEqual({ place: null, guests: null, price: null });
    const big = { ...emptyHireRow(placeKey("combination", "wg")), guestMin: 100, guestMax: 250, priceMinor: 700000000 };
    expect(rowIssues(big, places).guests).toBeNull();
  });

  it("writes one row per place: unit follows the charge, weekend rows carry their days", () => {
    const places = hirePlaces(SPACES, COMBOS);
    const draft: HireDraft = { ...hireDraftFrom(null), charge: "hire_fee", spaceIds: ["l"], combinationIds: ["wg"] };
    const row = { ...emptyHireRow(placeKey("space", "l")), guestMin: 60, guestMax: 150, priceMinor: 700000000, weekdays: [4, 5, 6] };
    const p = rowPayload(row, draft, places, 0);
    expect(p).toMatchObject({ spaceId: "l", unit: "booking", guestMin: 60, guestMax: 150, priceMinor: 700000000, weekdays: [4, 5, 6] });
    expect(String(p.name)).toContain("The Lounge Side · 60–150 guests");
    const perGuest = rowPayload({ ...row, weekdays: [] }, { ...draft, charge: "per_guest" }, places, 1);
    expect(perGuest).toMatchObject({ unit: "guest", weekdays: [0, 1, 2, 3, 4, 5, 6] });
    const combo = rowPayload({ ...row, place: placeKey("combination", "wg") }, draft, places, 2);
    expect(combo).toMatchObject({ combinationId: "wg" });
    expect(combo).not.toHaveProperty("spaceId");
  });

  it("sends the deposit, damage deposit, buffers and extras the step shows", () => {
    const d: HireDraft = { ...hireDraftFrom(null), damageDepositMinor: 50000000, extraGuestOn: true, extraGuestMinor: 800000, overtimeOn: false };
    expect(termsPayload(d)).toEqual({
      hireCharge: "hire_fee",
      depositKind: "percent",
      depositValue: 5000,
      balanceDueDaysBefore: 14,
      damageDepositMinor: 50000000,
      setupMinutes: 180,
      cleanupMinutes: 120,
      extraGuestMinor: 800000,
      overtimeMinorPerHour: null,
    });
    expect(termsPayload({ ...d, depositOn: false })).toMatchObject({ depositKind: "none" });
  });

  it("reads saved ladders back into the presets", () => {
    expect(hirePresetFor(hireLadder({ refundPreset: "standard", customLadder: [] }))).toBe("standard");
    expect(hirePresetFor([{ minMinutesBefore: 60, refundBps: 1000 }])).toBe("custom");
  });

  it("says what each step still needs", () => {
    const places = hirePlaces(SPACES, COMBOS);
    const d = hireDraftFrom(null);
    expect(hireStepIssue("spaces", d, places)).toBe("Pick at least one space");
    expect(hireStepIssue("price", { ...d, spaceIds: ["l"] }, places)).toBe("Add a price for at least one space");
    expect(hireStepIssue("times", { ...d, sessions: [{ ...d.sessions[0], startTime: "12:00", endTime: "12:00" }] }, places)).toBe(
      "A session can't start and end at the same time",
    );
    expect(hireStepIssue("terms", { ...d, depositPercent: 100 }, places)).toBe("A deposit is 1% to 99% of the total");
  });

  it("maps server refusals and readiness to plain words, never codes", () => {
    expect(hireErrorCopy("option_over_space_capacity", JSON.stringify({ capacity: 150, placeName: "Green Area North" }))).toBe(
      "More than Green Area North holds (150). Lower the largest group.",
    );
    expect(hireErrorCopy("hire_space_in_use")).toMatch(/Remove that row first/);
    expect(hireReadinessLine("no_spaces").step).toBe("spaces");
    expect(hireReadinessLine("guest_max_over_capacity").step).toBe("price");
  });

  it("makes private hire buildable everywhere the gates read it", () => {
    expect(BUILT_OFFER_KINDS.has("private_hire")).toBe(true);
    expect(BUILT_FEATURES.has("private_hire")).toBe(true);
    expect(BUILT_MODULES.has("requests")).toBe(true);
    expect(BUILT_MODULES.has("calendar")).toBe(true);
    expect(NEW_OFFER_CARDS.find((c) => c.key === "private_hire")?.built).toBe(true);
  });
});

const request = (over: Partial<VenueRequest>): VenueRequest => ({
  groupId: "g1",
  reference: "VB-1",
  state: "request_pending",
  tab: "to_answer",
  version: 1,
  offerKind: "private_hire",
  offerName: "Private hire",
  guestName: "Chiamaka Okafor",
  guestEmail: "c@example.com",
  guestPhone: null,
  guests: 120,
  placeName: "The Lounge Side",
  layout: null,
  layoutCapacity: null,
  spaceIds: ["l"],
  sessionLabel: "Full day",
  localDate: "2026-12-12",
  startsAt: "2026-12-12T11:00:00Z",
  endsAt: "2026-12-12T23:00:00Z",
  setupFrom: null,
  cleanupUntil: null,
  requestedAt: "2026-11-19T07:00:00Z",
  replyBy: "2026-11-21T07:00:00Z",
  holdUntil: null,
  currencyCode: "NGN",
  totalDueMinor: 752500000,
  depositMinor: null,
  paidMinor: 0,
  balanceMinor: 752500000,
  balanceDueAt: null,
  occasion: "Company day",
  note: null,
  siteVisit: false,
  closedReason: null,
  declineReason: null,
  placeStatus: "free",
  queue: null,
  nextInLine: false,
  waitingBehind: 0,
  nextInLineGuest: null,
  ...over,
});

describe("P4-2 requests", () => {
  it("puts all ten booking states in the four tabs", () => {
    expect(tabForState("request_pending")).toBe("to_answer");
    for (const s of ["approved_payment_required", "finalizing", "instant_payment_pending"]) expect(tabForState(s)).toBe("waiting_for_deposit");
    for (const s of ["confirmed", "partially_cancelled"]) expect(tabForState(s)).toBe("confirmed");
    for (const s of ["declined", "request_expired", "cancelled", "reconciliation_required"]) expect(tabForState(s)).toBe("closed");
    expect(countFor("closed", { toAnswer: 1, waitingForDeposit: 1, confirmed: 1, closed: 3, moneyDue: 0 })).toBe(3);
  });

  it("shows the reply clock, the hold clock and next in line", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    expect(requestPill(request({}), now)).toEqual({ label: "Reply in 19h", variant: "warn" });
    expect(requestPill(request({ state: "approved_payment_required", tab: "waiting_for_deposit", holdUntil: "2026-11-22T12:00:00Z" }), now).label).toBe("2d left to pay");
    expect(
      requestPill(request({ queue: { position: 1, blockedByGroupId: "g0", blockedByReference: "VB-0", blockedByGuestName: "Ngozi Eze", blockedByHoldUntil: null, queuedAt: null, releasedAt: null } }), now).label,
    ).toBe("Next in line");
    expect(requestPill(request({ state: "request_expired", tab: "closed", closedReason: "withdrawn" }), now).label).toBe("Withdrawn");
  });

  it("explains closed requests and what the guest was told", () => {
    expect(closedWords(request({ state: "declined", closedReason: "declined", declineReason: "We have a wedding that day" }), 48).body).toContain(
      "“We have a wedding that day”",
    );
    expect(closedWords(request({ state: "request_expired", closedReason: "expired" }), 48).title).toBe("Nobody replied within 48 hours");
    expect(closedWords(request({ state: "reconciliation_required", closedReason: "needs_checking" }), 48).title).toBe("Needs checking");
    expect(emptyWords("to_answer", 48).body).toContain("48 hours");
  });

  it("works out the edited quote from the server's numbers (D P4-5)", () => {
    const p = quotePreview({
      totalDueMinor: 752500000,
      hireMinor: 700000000,
      newHireMinor: 680000000,
      taxMinor: 52500000,
      vatMode: "added",
      vatRateBps: 750,
      damageDepositMinor: 0,
      deposit: { kind: "percent", value: 5000 },
    });
    expect(p).toEqual({ totalMinor: 731000000, vatMinor: 51000000, depositMinor: 365500000 });
    const words = approveWords({ guestName: "Chiamaka Okafor", placeName: "The Lounge Side", localDate: "2026-12-12", totalMinor: p.totalMinor, depositMinor: p.depositMinor, currency: "NGN", payWithinMinutes: 4320 });
    expect(words.title).toBe("Send Chiamaka a quote for ₦7,310,000?");
    expect(words.body).toContain("held for Chiamaka for 72 hours");
    expect(words.body).toContain("pays ₦3,655,000 to lock");
  });

  it("turns the double-booking refusal into a dialog, never a raw code", () => {
    const w = conflictWords({
      code: "offer_space_taken",
      placeName: "Green Area + Lounge",
      localDate: "2026-12-12",
      guestName: "Kemi Ajayi",
      blocker: { guestName: "Ngozi Eze", holdUntil: "2026-11-20T17:00:00Z" },
      capacity: null,
      timezone: "Africa/Lagos",
    });
    expect(w.title).toBe("Green Area + Lounge is on hold that day");
    expect(w.body).toContain("Ngozi Eze has it for");
    expect(w.body).toContain("would book it twice");
    const cap = conflictWords({ code: "offer_capacity_conflict", placeName: "x", localDate: "2026-12-19", guestName: "D", blocker: null, capacity: { sold: 60, limitAfterHire: 50 }, timezone: "Africa/Lagos" });
    expect(cap.body).toContain("60 already have entry that day; the hire would leave room for 50");
    for (const code of [
      "offer_space_taken",
      "offer_capacity_conflict",
      "offer_queue_not_needed",
      "offer_hold_expired",
      "offer_hold_not_extendable",
      "offer_invalid_transition",
      "offer_window_unavailable",
      "offer_payment_already_pending",
      "quote_edit_invalid",
      "decline_reason_required",
      "extend_hours_invalid",
      "block_spaces_invalid",
      "block_range_invalid",
      "block_not_found",
      "stale_write",
      "not_authorized",
      "staff_action_failed",
    ]) {
      expect(staffErrorCopy(code)).not.toMatch(/_/);
    }
  });
});

describe("P4-2 calendar", () => {
  const cal = mapVenueCalendar({
    timezone: "Africa/Lagos",
    from: "2026-12-07",
    to: "2026-12-13",
    spaces: [
      { id: "n", name: "Green Area North", capacity: 150 },
      { id: "s", name: "Green Area South", capacity: 150 },
      { id: "l", name: "The Lounge Side", capacity: 200 },
    ],
    combinations: [
      { id: "wg", name: "Whole Green Area", spaceIds: ["n", "s"] },
      { id: "gl", name: "Green Area + Lounge", spaceIds: ["n", "s", "l"] },
    ],
    claims: [
      {
        claimId: "c1",
        spaceId: "l",
        source: "booking",
        state: "held",
        kind: "hold",
        bookedFrom: "2026-12-12T17:00:00Z",
        bookedTo: "2026-12-12T22:00:00Z",
        claimFrom: "2026-12-12T14:00:00Z",
        claimTo: "2026-12-12T23:00:00Z",
        holdUntil: "2026-11-22T10:00:00Z",
        groupId: "g1",
        guestName: "Ngozi Eze",
        sessionLabel: "Evening",
        guests: 120,
      },
      {
        claimId: "c2",
        spaceId: "n",
        source: "booking",
        state: "committed",
        kind: "hire",
        viaCombinationId: "wg",
        viaCombinationName: "Whole Green Area",
        claimFrom: "2026-12-13T08:00:00Z",
        claimTo: "2026-12-13T23:00:00Z",
        groupId: "g2",
        guestName: "Folake Adeyemi",
      },
      {
        claimId: "c3",
        spaceId: "s",
        source: "booking",
        state: "committed",
        kind: "hire",
        viaCombinationId: "wg",
        viaCombinationName: "Whole Green Area",
        claimFrom: "2026-12-13T08:00:00Z",
        claimTo: "2026-12-13T23:00:00Z",
        groupId: "g2",
        guestName: "Folake Adeyemi",
      },
    ],
    combinationBlocks: [
      { combinationId: "gl", claimId: "c1", blockedBy: "The Lounge Side", from: "2026-12-12T14:00:00Z", to: "2026-12-12T23:00:00Z", state: "held" },
    ],
    requests: [],
    days: [
      { localDate: "2026-12-12", closed: false, pools: [{ poolId: "p", name: "Day", dailyLimit: 400, limitEffective: 200, hireCut: 200, venueHired: false, sold: 0, closed: false }], groups: [] },
    ],
    events: [],
  });
  const rows = calendarRows(cal);

  it("runs weeks Monday to Sunday and titles them", () => {
    expect(rangeFor("week", "2026-12-12")).toEqual({ from: "2026-12-07", to: "2026-12-13" });
    expect(rangeFor("month", "2026-12-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(rangeTitle("week", "2026-12-07", "2026-12-13")).toBe("7 – 13 Dec");
    expect(shiftAnchor("month", "2026-12-31", 1)).toBe("2027-01-01");
  });

  it("shows a hold with its setup and cleanup, and a combination blocked by its part", () => {
    const lounge = rows.find((r) => r.id === "l");
    const loungeBlocks = blocksFor(cal, lounge!, "2026-12-12");
    expect(loungeBlocks).toHaveLength(1);
    expect(loungeBlocks[0].tone).toBe("hold");
    expect(loungeBlocks[0].label).toContain("On hold");
    expect(loungeBlocks[0].label).toContain("setup and cleanup 15:00–00:00");
    // The block ends at 00:00 (exclusive): it does not touch the next day.
    expect(blocksFor(cal, lounge!, "2026-12-13")).toHaveLength(0);
    const whole = rows.find((r) => r.id === "gl");
    expect(blocksFor(cal, whole!, "2026-12-12").map((b) => b.title)).toEqual(["Blocked by The Lounge Side"]);
  });

  it("draws a combined hire once on its combination and as 'inside' on each part", () => {
    const wg = rows.find((r) => r.id === "wg");
    expect(blocksFor(cal, wg!, "2026-12-13").map((b) => b.tone)).toEqual(["hire"]);
    const north = rows.find((r) => r.id === "n");
    expect(blocksFor(cal, north!, "2026-12-13")[0].title).toBe("Inside Whole Green Area");
  });

  it("says when a hire lowers the day's entry limit", () => {
    expect(entryFill(cal.days[0])).toEqual({ line: "0 sold · limit 200 (was 400)", pct: 0, cut: true });
  });

  it("turns a venue-local time into the instant the server stores", () => {
    expect(zonedIso("2026-12-13", "14:00", "Africa/Lagos")).toBe("2026-12-13T13:00:00.000Z");
    expect(touchesDay("2026-12-12T23:30:00Z", "2026-12-13T01:00:00Z", "2026-12-13", "Africa/Lagos")).toBe(true);
    expect(blockIssue({ target: "s:l", fromDate: "2026-12-01", fromTime: "09:00", toDate: "2027-01-05", toTime: "09:00", reason: "" }, "Africa/Lagos")).toBe(
      "A block can last 31 days at most",
    );
    expect(blockIssue({ target: "s:l", fromDate: "2026-12-01", fromTime: "18:00", toDate: "2026-12-01", toTime: "09:00", reason: "" }, "Africa/Lagos")).toBe(
      "The block must end after it starts",
    );
  });
});

describe("P4-2 service readers", () => {
  it("reads a request row and the hire part of an offer defensively", () => {
    const r = mapVenueRequest({ groupId: "g", tab: "nonsense", closedReason: "weird", placeStatus: "held", queue: { position: 2, blockedByGuestName: "Ngozi" }, guests: "120", layout: "banquet", layoutCapacity: 120 });
    expect(r.tab).toBe("closed");
    expect(r.closedReason).toBeNull();
    expect(r.placeStatus).toBe("held");
    expect(r.queue?.position).toBe(2);
    expect(r.guests).toBe(120);
    expect([r.layout, r.layoutCapacity]).toEqual(["banquet", 120]);
    const h = mapHireTerms({ charge: "min_spend", bookingMode: "instant", layouts: ["banquet"], rows: [{ optionId: "o", unit: "guest", weekdays: [5, 6, 9], layoutCapacities: { banquet: 120 } }] });
    expect(h.charge).toBe("min_spend");
    expect(h.bookingMode).toBe("instant");
    expect(h.rows[0].weekdays).toEqual([5, 6]);
    expect(h.layouts).toEqual(["banquet"]);
    expect(h.rows[0].layoutCapacities).toEqual({ banquet: 120 });
    expect(h.requestResponseHours).toBe(48);
  });
});
