/**
 * #4490 P2-4 / P2-5 — pure rules behind Offers, the Entry editor, Day limits,
 * Today and the gate: named prices with no default, validation in plain
 * words, payload shapes the server contract expects, readiness and error
 * copy that never shows a raw code, and the gate total (VAT modes, busy-time
 * prices) in minor units.
 */
import {
  entryDraftFrom,
  entryStepIssue,
  emptyOptionDraft,
  gateEstimate,
  ladderForDraft,
  offerErrorCopy,
  optionIssues,
  optionPayload,
  optionSellableNow,
  presetForLadder,
  priceNow,
  readinessLine,
  refundSummary,
  schedulePayload,
  vatLine,
  venueClock,
  dayLimitIssue,
  overrideLine,
  type EntryDraft,
} from "../features/offers/offersModel";
import { dayHeadline, dayNumbers } from "../features/today/todayModel";
import { featureLine } from "../../../types/venueFeatures";
import type { VenuePriceOption, VenueDay } from "../../../types/venueOffers";

function option(over: Partial<VenuePriceOption> = {}): VenuePriceOption {
  return {
    id: "opt-1",
    name: "Walk-in",
    unit: "guest",
    guestMin: 1,
    guestMax: 10,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: null,
    endTime: null,
    eligibility: null,
    busyRules: [],
    sortOrder: 0,
    status: "active",
    version: 1,
    priceMinor: 500000,
    priceVersionId: "pv",
    ...over,
  };
}

function draft(over: Partial<EntryDraft> = {}): EntryDraft {
  const base = entryDraftFrom({ offer: null, pool: null, defaultOpen: "12:00", defaultClose: "00:00", defaultWeekdays: [0, 1, 2, 3, 4, 5, 6] });
  return { ...base, name: "Entry", dailyLimit: 400, keptForWalkIns: 100, options: [{ ...emptyOptionDraft("Walk-in"), priceMinor: 500000 }], ...over };
}

describe("price options", () => {
  it("never defaults a name, and a blank name is an error in plain words", () => {
    const fresh = emptyOptionDraft();
    expect(fresh.name).toBe("");
    // TEST-MOD-APPROVED #4490 (fix round 2, N58): a blank price name is not an error; it saves as "Entry" / "Guest".
    expect(optionIssues(fresh, 400).name).toBeNull();
    expect(optionIssues(fresh, 400).price).toBe("Enter a price, or switch this option to free");
  });

  it("a free option needs no price; more guests than the day limit is refused with the number", () => {
    const free = { ...emptyOptionDraft("Kids"), free: true, guestMax: 500 };
    expect(optionIssues(free, 400).price).toBeNull();
    expect(optionIssues(free, 400).guestMax).toBe("Can't be more than your 400 guests a day");
    // No 50-guest cap anywhere (spec 02 §4 hard rules).
    expect(optionIssues({ ...free, guestMax: 120 }, 400).guestMax).toBeNull();
  });

  it("builds the upsert payload the server expects (minor units, ID check, busy prices, hours only when limited)", () => {
    const p = optionPayload(
      {
        ...emptyOptionDraft("Student & NYSC"),
        id: "o-9",
        priceMinor: 400000,
        weekdays: [3, 0, 1, 2],
        idCheck: true,
        idLabel: " Student or NYSC ID ",
        busyRules: [{ key: "b", weekdays: [5, 4], from: "18:00", to: "23:00", amountMinor: 600000 }],
      },
      1,
    );
    expect(p).toEqual({
      optionId: "o-9",
      name: "Student & NYSC",
      unit: "guest",
      guestMin: 1,
      guestMax: 10,
      priceMinor: 400000,
      weekdays: [0, 1, 2, 3],
      eligibility: { label: "Student or NYSC ID", checkAtGate: true },
      busyRules: [{ weekdays: [4, 5], from: "18:00", to: "23:00", amount_minor: 600000 }],
      sortOrder: 1,
    });
    const limited = optionPayload({ ...emptyOptionDraft("Late"), priceMinor: 1, limitHours: true, startTime: "22:00", endTime: "02:00" }, 0);
    expect(limited.startTime).toBe("22:00");
    expect(limited.endTime).toBe("02:00");
    expect(limited.eligibility).toBeNull();
  });
});

describe("entry steps", () => {
  it("names the first problem of each step", () => {
    expect(entryStepIssue("basics", draft({ name: " " }))).toBe("Name this offer");
    expect(entryStepIssue("prices", draft({ options: [] }))).toBe("Add a price option");
    // TEST-MOD-APPROVED #4490 (fix round 2, N58): an unnamed first price is called "Entry"; its missing price is the problem.
    expect(entryStepIssue("prices", draft({ options: [emptyOptionDraft()] }))).toBe("Fix Entry");
    expect(entryStepIssue("capacity", draft({ dailyLimit: 0 }))).toBe("Set how many guests a day");
    expect(entryStepIssue("capacity", draft({ keptForWalkIns: 500 }))).toBe("Kept for walk-ins is more than the day limit");
    expect(entryStepIssue("capacity", draft())).toBeNull();
    expect(entryStepIssue("rules", draft({ refundPreset: "custom", customLadder: [] }))).toBe("Add a refund rule, or pick No refunds");
  });

  it("timed sessions schedule as sessions; walk-in as the full day", () => {
    expect(schedulePayload(draft({ style: "timed_session", sessionMinutes: 90, sessionEveryMinutes: 60 }))).toEqual({
      mode: "sessions",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: "12:00",
      endTime: "00:00",
      sessionMinutes: 90,
      sessionEveryMinutes: 60,
    });
    expect(schedulePayload(draft()).mode).toBe("full_day");
  });

  it("refund presets round-trip and read in plain words", () => {
    const ladder = ladderForDraft({ refundPreset: "full_24h_half_after", customLadder: [] });
    expect(presetForLadder(ladder)).toBe("full_24h_half_after");
    expect(refundSummary(ladder)).toBe("Full refund up to 24 hours before, then 50% back until it starts");
    expect(refundSummary([])).toBe("No refunds");
    expect(presetForLadder([{ minMinutesBefore: 120, refundBps: 2500 }])).toBe("custom");
  });
});

describe("plain words, never codes", () => {
  const tokens = [
    "not_authorized", "offers_not_enabled", "offer_not_on_stay_venue", "stale_write", "offer_archived",
    "pool_kept_over_limit", "pool_limit_below_option_max", "option_name_required", "option_busy_rules_invalid",
    "offer_needs_one_option", "refund_ladder_invalid", "schedule_sessions_invalid", "offer_invalid_transition",
    "override_invalid", "booking_settings_invalid", "network", "something_new_from_the_server",
  ];
  it.each(tokens)("%s maps to a sentence without the token", (code) => {
    const text = offerErrorCopy(code);
    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toContain(code);
    expect(text).not.toMatch(/_/);
  });

  it("every not-ready reason says what to do and where", () => {
    expect(readinessLine("no_day_limit")).toEqual({ text: "Set how many guests can come a day.", step: "capacity" });
    expect(readinessLine("no_policy").step).toBe("rules");
    expect(readinessLine("no_price_option").step).toBe("prices");
    expect(readinessLine("feature_off").text).toContain("Settings");
    expect(offerErrorCopy("offer_not_ready", "no_schedule")).toBe("Not ready to publish yet. Set the days and times it's on sale.");
  });

  it("VAT lines follow the venue's mode and rate", () => {
    expect(vatLine("added", 750)).toBe("Prices + 7.5% VAT at checkout");
    expect(vatLine("included", 750)).toBe("Prices include 7.5% VAT");
    expect(vatLine("none", 750)).toBe("No VAT charged");
  });
});

describe("the gate", () => {
  const clockThu = { weekday: 3, time: "19:00" };
  const clockFri = { weekday: 4, time: "19:00" };
  const walkIn = option({ busyRules: [{ weekdays: [4, 5], from: "18:00", to: "23:00", amountMinor: 600000 }] });
  const student = option({ id: "opt-2", name: "Student", priceMinor: 400000, weekdays: [0, 1, 2, 3], eligibility: { label: "Student ID", checkAtGate: true } });

  it("sells only prices valid now; busy-time prices replace the base price", () => {
    expect(optionSellableNow(student, clockThu)).toBe(true);
    expect(optionSellableNow(student, clockFri)).toBe(false);
    expect(priceNow(walkIn, clockThu)).toBe(500000);
    expect(priceNow(walkIn, clockFri)).toBe(600000);
    expect(optionSellableNow(option({ startTime: "22:00", endTime: "02:00" }), { weekday: 3, time: "01:00" })).toBe(true);
  });

  it("totals in minor units for each VAT mode (2 walk-in + 1 student = ₦15,050 with VAT added)", () => {
    const counts = { "opt-1": 2, "opt-2": 1 };
    const added = gateEstimate({ options: [walkIn, student], counts, vatMode: "added", vatRateBps: 750, clock: clockThu });
    expect(added).toMatchObject({ subtotalMinor: 1400000, vatMinor: 105000, totalMinor: 1505000, guests: 3 });
    const included = gateEstimate({ options: [walkIn, student], counts, vatMode: "included", vatRateBps: 750, clock: clockThu });
    expect(included.totalMinor).toBe(1400000);
    expect(included.vatMinor).toBe(97674);
    const none = gateEstimate({ options: [walkIn], counts: { "opt-1": 1 }, vatMode: "none", vatRateBps: 750, clock: clockThu });
    expect(none).toMatchObject({ vatMinor: 0, totalMinor: 500000 });
  });

  it("reads the venue's own clock, not the phone's", () => {
    // 2026-11-19T23:30Z is Friday 00:30 in Lagos (UTC+1).
    expect(venueClock("Africa/Lagos", new Date("2026-11-19T23:30:00Z"))).toEqual({ weekday: 4, time: "00:30" });
  });
});

describe("day limits", () => {
  it("validates the date and the kept-for-walk-ins bound", () => {
    const base = { poolId: "p", localDate: "2026-11-27", closed: false, dailyLimit: 250, keptForWalkIns: 50 };
    expect(dayLimitIssue(base, "2026-11-19")).toBeNull();
    expect(dayLimitIssue({ ...base, localDate: "" }, "2026-11-19")).toBe("Pick a date.");
    expect(dayLimitIssue({ ...base, localDate: "2026-11-01" }, "2026-11-19")).toBe("Pick today or a later date.");
    expect(dayLimitIssue({ ...base, keptForWalkIns: 300 }, "2026-11-19")).toBe("Kept for walk-ins can't be more than the day's limit.");
    expect(dayLimitIssue({ ...base, closed: true, keptForWalkIns: 300 }, "2026-11-19")).toBeNull();
  });

  it("says what a date's limit is", () => {
    const pool = { id: "p", name: "Day", dailyLimit: 400, keptForWalkIns: 100, spaceIds: null, archived: false, version: 1 };
    expect(overrideLine({ poolId: "p", localDate: "2026-11-27", dailyLimit: 250, keptForWalkIns: 50, closed: false, version: 1 }, pool)).toBe(
      "250 guests · 50 kept for walk-ins",
    );
    expect(overrideLine({ poolId: "p", localDate: "2026-11-27", dailyLimit: null, keptForWalkIns: null, closed: true, version: 1 }, pool)).toBe(
      "No entry that day",
    );
  });
});

describe("the venue's day and the hub card", () => {
  const day: VenueDay = {
    localDate: "2026-11-19",
    timezone: "Africa/Lagos",
    closed: false,
    pools: [{ poolId: "p", name: "Day", dailyLimit: 400, keptForWalkIns: 100, used: 5, soldOnline: 3, soldAtGate: 2, onlineLeft: 297, walkInLeft: 98, gateLeft: 98, closed: false, hasOverride: false }],
    offers: [{ offerId: "o", name: "Entry", kind: "entry", entryStyle: "walk_in", status: "live", poolId: "p", sold: 5, held: 1 }],
    checkIn: { passes: 2, expected: 5, admitted: 2 },
    bookings: [
      { groupId: "a", reference: "VB-A", state: "confirmed", guestName: "A", guests: 3, totalMinor: 1505000, currencyCode: "NGN", source: "mingla", paymentCollection: "mingla", admittedCount: 0, createdAt: "1" },
      { groupId: "b", reference: "VB-B", state: "confirmed", guestName: "B", guests: 2, totalMinor: 1075000, currencyCode: "NGN", source: "gate", paymentCollection: "property", admittedCount: 2, createdAt: "2" },
      { groupId: "c", reference: "VB-C", state: "instant_payment_pending", guestName: "C", guests: 1, totalMinor: 537500, currencyCode: "NGN", source: "mingla", paymentCollection: "mingla", admittedCount: 0, createdAt: "3" },
    ],
    // TEST-MOD-APPROVED #4490 07-E: the day carries the server's money (null here).
    money: null,
  };

  it("counts in, to arrive, walk-ins, paying and money the same way everywhere", () => {
    expect(dayNumbers(day)).toMatchObject({
      inNow: 2,
      toArrive: 3,
      dailyLimit: 400,
      walkInLeft: 98,
      waiting: 1,
      currencyCode: "NGN",
    });
    // TEST-MOD-APPROVED #4490 07-E: the client no longer sums booking values as
    // money ("Taken today" deleted); the server's money day replaces it.
    expect(dayNumbers(day)).not.toHaveProperty("takenMinor");
    expect(dayNumbers(day)).not.toHaveProperty("takenAtGateMinor");
    expect(dayHeadline(day)).toBe("Thu 19 Nov 2026 · 2 of 400 in");
    expect(dayHeadline({ ...day, closed: true })).toBe("Thu 19 Nov 2026 · closed today");
  });

  it("E2: the hub card names the venue's switched-on features, not one switch", () => {
    // TEST-MOD-APPROVED #4490 P4 — group packages and private hire are built now, so they are named.
    expect(featureLine(new Set(["entry", "menu", "events_here", "stays", "group_packages"]))).toBe("Entry · Group packages · Menu · Events here");
    // TEST-MOD-APPROVED #4490 P5-2 — by the hour is built now, so it is named; memberships (P6) still aren't.
    // TEST-MOD-APPROVED #4490 P6-2 — memberships are built now, so they are named too.
    expect(featureLine(new Set(["entry", "menu", "stays", "by_the_hour", "memberships"]))).toBe("Entry · By the hour · Menu · Memberships");
    expect(featureLine(new Set(["table_reservations", "waitlist"]))).toBe("Table reservations · Waitlist");
    expect(featureLine(new Set())).toBeNull();
  });
});
