import { describe, expect, test } from "@jest/globals";

import type { MultiDateEntry, TicketStub } from "../../store/draftEventStore";
import {
  busiestDaySold,
  capacityHelper,
  coverageCaution,
  dayScopeHelper,
  deleteDateImpact,
  eventHasDayScope,
  formatDraftDayScopeLabel,
  priceHelper,
  soldByTicketAndDay,
  tapValidDay,
  ticketsOnAllDates,
  ticketsOnCurrentDays,
  ticketsWithoutDay,
} from "../ticketDayScope";

const entry = (id: string, date: string): MultiDateEntry => ({
  id,
  date,
  startTime: "18:00",
  endTime: "23:00",
  overrides: {
    title: null,
    description: null,
    venueName: null,
    address: null,
    onlineUrl: null,
  },
} as MultiDateEntry);

const days = [
  entry("fri", "2026-10-02"),
  entry("sat", "2026-10-03"),
  entry("sun", "2026-10-04"),
  entry("mon", "2026-10-05"),
];

const ticket = (id: string, validDayIds?: string[] | null): TicketStub => ({
  id,
  name: id,
  visibility: "public",
  validDayIds,
} as TicketStub);

describe("issue #3281 labels", () => {
  test("names one, two, a contiguous run and a gapped set", () => {
    const fri = formatDraftDayScopeLabel(days, ["fri"]);
    const sat = formatDraftDayScopeLabel(days, ["sat"]);
    const sun = formatDraftDayScopeLabel(days, ["sun"]);
    expect(formatDraftDayScopeLabel(days, ["sat", "fri"])).toBe(`${fri} + ${sat}`);
    expect(formatDraftDayScopeLabel(days, ["fri", "sat", "sun"])).toBe(
      `3 days · ${fri} – ${sun}`,
    );
    expect(formatDraftDayScopeLabel(days, ["fri", "sat", "mon"])).toBe(
      `3 of 4 days · from ${fri}`,
    );
  });

  test("All dates and an orphaned list have no label", () => {
    expect(formatDraftDayScopeLabel(days, null)).toBeNull();
    expect(formatDraftDayScopeLabel(days, [])).toBeNull();
    expect(formatDraftDayScopeLabel(days, ["gone"])).toBeNull();
  });
});

describe("issue #3281 picker rules", () => {
  test("the field exists only on multi-date events with two dates", () => {
    expect(eventHasDayScope("multi_date", days)).toBe(true);
    expect(eventHasDayScope("multi_date", days.slice(0, 1))).toBe(false);
    expect(eventHasDayScope("recurring", days)).toBe(false);
  });

  test("leaving All dates keeps every day with sales", () => {
    const tap = tapValidDay(days, null, "fri", { sat: 2 });
    expect(tap.next).toEqual(["fri", "sat"]);
    expect(tap.alert).toContain("Days with sales were kept");
  });

  test("a sold day cannot be removed", () => {
    const tap = tapValidDay(days, ["fri", "sat"], "sat", { sat: 12 });
    expect(tap.next).toEqual(["fri", "sat"]);
    expect(tap.alert).toContain("has 12 guests on this ticket");
  });

  test("unknown sales keep every selected day but still allow adding", () => {
    expect(tapValidDay(days, ["fri"], "fri", null).next).toEqual(["fri"]);
    expect(tapValidDay(days, ["fri"], "sat", null).next).toEqual(["fri", "sat"]);
  });

  test("All dates stays while sales are unknown", () => {
    const tap = tapValidDay(days, null, "fri", null);
    expect(tap.next).toBeNull();
    expect(tap.alert).toContain("Still checking sales");
  });

  test("removing the last day returns to All dates, never an empty list", () => {
    expect(tapValidDay(days, ["fri"], "fri", {}).next).toBeNull();
  });
});

describe("issue #3281 date deletion", () => {
  test("strips the date and leaves an emptied list empty, not All dates", () => {
    const next = ticketsWithoutDay(
      [ticket("only", ["sat"]), ticket("both", ["fri", "sat"]), ticket("all")],
      "sat",
    );
    expect(next[0].validDayIds).toEqual([]);
    expect(next[1].validDayIds).toEqual(["fri"]);
    expect(next[2].validDayIds).toBeUndefined();
  });

  test("the dialog names what will break", () => {
    const tickets = [ticket("Saturday GA", ["sat"]), ticket("Weekend", ["fri", "sat"])];
    expect(deleteDateImpact(tickets, "sat")).toBe(
      "Saturday GA is only valid on this date, so it will have no days left. You'll need to fix it before publishing. Weekend will keep its other days.",
    );
    expect(deleteDateImpact(tickets, "mon")).toBeNull();
  });
});

describe("issue #3281 date mode switches", () => {
  test("new date ids leave a list empty, never pointing at old dates", () => {
    const next = ticketsOnCurrentDays(
      [ticket("old", ["gone"]), ticket("kept", ["gone", "fri"]), ticket("all", null)],
      days,
    );
    expect(next.map((t) => t.validDayIds)).toEqual([[], ["fri"], null]);
  });

  test("leaving multi-date clears lists the picker could no longer fix", () => {
    const next = ticketsOnAllDates([ticket("sat", ["sat"]), ticket("all")]);
    expect(next[0].validDayIds).toBeNull();
    expect(next[1].validDayIds).toBeUndefined();
  });

  test("the floor is the busiest date", () => {
    expect(busiestDaySold({ fri: 8, sat: 3 })).toBe(8);
    expect(busiestDaySold({})).toBe(0);
  });
});

describe("issue #3281 coverage and sold counts", () => {
  test("warns about dates no public ticket covers", () => {
    expect(coverageCaution([ticket("all")], days)).toBeNull();
    expect(coverageCaution([ticket("a", ["fri", "sat", "sun"])], days)).toContain(
      "No ticket covers",
    );
    expect(coverageCaution([ticket("a", ["fri"])], days)).toContain("3 dates have no tickets");
  });

  test("a pass with no day counts on every date, as the server does", () => {
    const sold = soldByTicketAndDay(
      [{
        ticketDays: [
          { ticketTypeId: "t", eventDateIds: ["id-fri"], status: "valid" },
          { ticketTypeId: "t", eventDateIds: [], status: "used" },
          { ticketTypeId: "t", eventDateIds: ["id-fri"], status: "refunded" },
        ],
      }],
      { "id-fri": "fri", "id-sat": "sat" },
    );
    expect(sold).toEqual({ t: { fri: 2, sat: 1 } });
  });
});

describe("issue #3281 copy", () => {
  test("price arithmetic hides when the mode is unknown", () => {
    expect(priceHelper(3, undefined, "£60", "£180")).toBeNull();
    expect(priceHelper(3, "per_day", "£60", "£180")).toContain("pays £180");
    expect(priceHelper(1, "all_days", "£60", "£60")).toBe("Guests pay £60 for this day.");
  });

  test("capacity arithmetic hides when the mode is unknown", () => {
    expect(capacityHelper(null, days, 10, undefined)).toBeNull();
    expect(capacityHelper(null, days, 10, "all_days")).toContain("Each guest uses 1");
    expect(capacityHelper(["fri", "sat"], days, 10, undefined)).toContain("Up to 10 guests");
  });

  test("the field helper follows the list", () => {
    expect(dayScopeHelper(null, 3, false)).toContain("every date");
    expect(dayScopeHelper([], 3, false)).toContain("Pick at least one day");
    expect(dayScopeHelper(["fri"], 3, true)).toContain("Days with sales stay");
  });
});
