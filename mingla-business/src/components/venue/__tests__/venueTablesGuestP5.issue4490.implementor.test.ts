/**
 * #4490 P5-3 — guest tables and by the hour, as pure data: the party cap
 * (no more 12), big-party requests, the word on each table of the seat map,
 * the hold and minimum-spend lines shown before paying, the waitlist page
 * states and refusals in plain words, the pending table payment kept on this
 * device (never stranded after the payment page), and the by-the-hour day
 * line, prices, conflicts and checkout address.
 */
import {
  ABSOLUTE_PARTY_MAX,
  dayWords,
  defaultNotifyRange,
  isBigParty,
  optionTitle,
  partyDetail,
  partyRange,
  pickMoneyLines,
  tableA11y,
  tableGuestErrorCopy,
  tableWord,
  waitlistStateCopy,
  windowChoices,
} from "../offers/tablePickModel";
import {
  dayLineCells,
  hourCheckoutPath,
  hourConflictLine,
  hourGuestErrorCopy,
  hourPrice,
  parseHourCheckoutParams,
  parseHourFacts,
  releaseLine,
} from "../offers/hourGuestModel";
import { isPendingFresh, parsePending, PENDING_TTL_MS } from "../offers/tablePendingReturn";
import { mapGuestTableRow, mapGuestWaitlistEntry, type GuestTableOption } from "../../../services/venueTableGuestService";

const naira = (minor: number): string => `N${(minor / 100).toLocaleString("en-GB")}`;

function option(over: Partial<GuestTableOption> = {}): GuestTableOption {
  return {
    kind: "table",
    tableIds: ["t3"],
    names: ["B3"],
    spaceId: "s1",
    spaceName: "Dining room",
    capacity: 4,
    shape: "round",
    planX: 300,
    planY: 200,
    planW: 100,
    planH: 100,
    rotation: 0,
    status: "free",
    minSpendMinor: 0,
    holdPerGuestMinor: 500000,
    holdMinor: 2000000,
    ...over,
  };
}

describe("party size (C §9 test 6)", () => {
  it("uses the venue's own cap, not 12", () => {
    const range = partyRange({ partyMax: 40, largePartyRequest: false });
    expect(range.max).toBe(40);
    expect(partyDetail(range)).toBe("Up to 40");
    expect(isBigParty(41, range)).toBe(false);
  });
  it("above the cap, a venue that takes big parties gets a request (up to 100)", () => {
    const range = partyRange({ partyMax: 8, largePartyRequest: true });
    expect(range.max).toBe(ABSOLUTE_PARTY_MAX);
    expect(isBigParty(8, range)).toBe(false);
    expect(isBigParty(9, range)).toBe(true);
    expect(partyDetail(range)).toBe("Up to 8 online · bigger groups ask");
  });
  it("keeps today's 12 when the venue sends no tables block", () => {
    expect(partyRange(null).max).toBe(12);
  });
});

describe("the seat map", () => {
  it("says each table's state in a word", () => {
    expect(tableWord(option(), false)).toBe("Seats 4");
    expect(tableWord(option(), true)).toBe("Yours");
    expect(tableWord(option({ status: "taken" }), false)).toBe("Taken");
    expect(tableWord(option({ status: "not_fit" }), false)).toBe("Wrong size");
    expect(tableA11y(option({ minSpendMinor: 8000000 }), false, naira)).toBe("B3, seats 4, free, spend at least N80,000, N5,000 a guest to hold it");
  });
  it("shows the hold and minimum spend before paying (D P5-4: N20,000 comes off the bill)", () => {
    const lines = pickMoneyLines(option(), 4, naira);
    expect(lines.hold).toBe("N5,000 a guest holds it and comes off your bill.");
    expect(lines.holdTotal).toBe("N20,000 to hold it for 4");
    const booth = pickMoneyLines(option({ names: ["Amber booth"], minSpendMinor: 8000000, holdPerGuestMinor: 2000000, holdMinor: 8000000 }), 4, naira);
    expect(booth.minSpend).toMatch(/^Spend at least N80,000/);
    expect(booth.holdTotal).toBe("N80,000 to hold it for 4");
    expect(pickMoneyLines(option({ holdPerGuestMinor: null, holdMinor: null }), 4, naira)).toEqual({ hold: null, minSpend: null, holdTotal: null });
  });
  it("calls a flat or minimum-spend-share charge an amount to hold this table", () => {
    const flat = option({ holdPerGuestMinor: null, holdMinor: 2500000 });
    expect(tableA11y(flat, false, naira)).toContain("N25,000 to hold this table");
    expect(pickMoneyLines(flat, 4, naira)).toEqual({
      hold: "Comes off your bill.",
      holdTotal: "N25,000 to hold this table",
      minSpend: null,
    });
  });
  it("names a joined pair", () => {
    expect(optionTitle(option({ kind: "join", names: ["B1", "B2"], capacity: 8 }))).toBe("B1 + B2 · joined, seats 8");
  });
  it("maps the server rows", () => {
    const row = mapGuestTableRow({ option_kind: "join", table_ids: ["a", "b"], names: ["B1", "B2"], capacity: 8, status: "free", min_spend_minor: 0, hold_minor_per_guest: null, hold_minor: null });
    expect(row?.kind).toBe("join");
    expect(row?.planX).toBeNull();
    expect(mapGuestTableRow({ table_ids: [] })).toBeNull();
  });
});

describe("waitlist", () => {
  const entry = mapGuestWaitlistEntry({
    waitlistId: "w1",
    status: "waiting",
    position: 2,
    partySize: 4,
    desiredDate: "2026-11-21",
    desiredFrom: "19:00:00",
    desiredTo: "21:00:00",
    quotedWaitMinutes: null,
    venue: { id: "v", name: "Guest QA Grill", slug: "grill", brandSlug: "qa", timezone: "Africa/Lagos" },
  });
  it("reads each state in words", () => {
    expect(entry).not.toBeNull();
    if (entry === null) return;
    expect(waitlistStateCopy(entry, (i) => i.slice(11, 16))).toEqual({
      title: "You're number 2",
      body: "We'll tell you as soon as a table for 4 opens between 19:00 and 21:00.",
    });
    expect(waitlistStateCopy({ ...entry, status: "notified", offeredSlotAt: "2026-11-21T20:30:00Z" }, (i) => i.slice(11, 16)).title).toBe("A table is ready");
    expect(waitlistStateCopy({ ...entry, status: "left" }, (i) => i).title).toBe("You left the waitlist");
  });
  it("maps every refusal to plain words", () => {
    for (const code of ["waitlist_already_joined", "waitlist_not_found", "waitlist_closed", "waitlist_guest_invalid", "rate_limited", "table_taken", "table_not_fit"]) {
      const words = tableGuestErrorCopy(code);
      expect(words).not.toBeNull();
      expect(words).not.toContain("_");
    }
    expect(tableGuestErrorCopy("unknown_code")).toBeNull();
  });
  it("offers notify-me ranges from the day's times", () => {
    expect(windowChoices(["19:30", "19:00", "7:00 PM"])).toEqual(["07:00", "19:00", "19:30"]);
  });
});

describe("the table payment is never stranded", () => {
  it("keeps a fresh pending booking and drops an old or broken one", () => {
    const now = 1_000_000_000;
    const p = parsePending(JSON.stringify({ reservationDraftId: "d", buyerStatusToken: "b", venueId: "v", summary: "B3 · 4 guests", savedAt: now }));
    expect(p?.summary).toBe("B3 · 4 guests");
    expect(p !== null && isPendingFresh(p, now + 60_000)).toBe(true);
    expect(p !== null && isPendingFresh(p, now + PENDING_TTL_MS + 1)).toBe(false);
    expect(parsePending("{not json")).toBeNull();
    expect(parsePending(JSON.stringify({ venueId: "v" }))).toBeNull();
  });
});

describe("by the hour (D P5-9: Boardroom 2 hours = N24,000 before VAT)", () => {
  const day = {
    opensAt: "2026-11-26T07:00:00.000Z",
    closesAt: "2026-11-26T11:00:00.000Z",
    stepMinutes: 60,
    minMinutes: 60,
    starts: [
      { startsAt: "2026-11-26T07:00:00.000Z", maxMinutes: 120, places: 1 },
      { startsAt: "2026-11-26T08:00:00.000Z", maxMinutes: 60, places: 1 },
      { startsAt: "2026-11-26T10:00:00.000Z", maxMinutes: 60, places: 1 },
    ],
  };
  it("draws the day line: free, taken, yours", () => {
    // Pin "now" to the day before, so the real clock never turns these hours into "closed".
    const cells = dayLineCells(day, "Africa/Lagos", { startsAt: "2026-11-26T07:00:00.000Z", minutes: 120 }, Date.parse("2026-11-25T12:00:00.000Z"));
    expect(cells.map((c) => c.state)).toEqual(["mine", "mine", "taken", "free"]);
    expect(cells[0]?.label).toBe("08:00");
    // Today, hours already gone read as closed, not taken.
    const today = dayLineCells(day, "Africa/Lagos", null, Date.parse("2026-11-26T08:30:00.000Z"));
    expect(today.map((c) => c.state)).toEqual(["closed", "closed", "taken", "free"]);
  });
  it("words a waitlist place that is ready on a later day, and starts the notify range at the full time", () => {
    expect(dayWords("2026-11-24")).toBe("Tue 24 Nov");
    expect(defaultNotifyRange(["12:00", "12:30", "19:00", "19:30", "20:00", "20:30", "21:00"], ["19:30"])).toEqual({ from: "19:30", to: "21:00" });
  });
  it("prices by the minute and names a conflict", () => {
    expect(hourPrice(1200000, 120)).toBe(2400000);
    expect(hourPrice(1200000, 30)).toBe(600000);
    expect(hourConflictLine(day, "2026-11-26T08:00:00.000Z", 120, "Africa/Lagos")).toBe("Taken from 10:00. Shorter, or another start.");
    expect(hourConflictLine(day, "2026-11-26T07:00:00.000Z", 120, "Africa/Lagos")).toBeNull();
    expect(hourGuestErrorCopy("offer_space_taken")).toMatch(/Someone just booked/);
  });
  it("round-trips the checkout address (no token, nothing personal)", () => {
    const path = hourCheckoutPath({ brandSlug: "qa", venueSlug: "kora", offerId: "o1", date: "2026-11-26", startsAt: "2026-11-26T13:00:00.000Z", minutes: 120, guests: 2 });
    expect(path).toMatch(/^\/b\/qa\/v\/kora\/book\/o1\?k=hour&/);
    const query = Object.fromEntries(new URLSearchParams(path.split("?")[1] ?? ""));
    expect(parseHourCheckoutParams(query)).toEqual({ date: "2026-11-26", startsAt: "2026-11-26T13:00:00.000Z", minutes: 120, guests: 2 });
    expect(parseHourCheckoutParams({ ...query, m: "5" })).toBeNull();
    expect(parseHourCheckoutParams({ ...query, k: "hire" })).toBeNull();
  });
  it("reads the pass facts and the release line", () => {
    const facts = parseHourFacts({ hour: { placeName: "Boardroom", bookedFrom: "a", bookedTo: "b", minutes: 120, noShowReleaseMinutes: 15, released: false } });
    expect(facts?.placeName).toBe("Boardroom");
    expect(releaseLine(15)).toBe("Check in within 15 minutes of your start or it's released.");
    expect(parseHourFacts({})).toBeNull();
  });
});
