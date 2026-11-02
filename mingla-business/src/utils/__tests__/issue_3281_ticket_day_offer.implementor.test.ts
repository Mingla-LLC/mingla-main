import { describe, expect, test } from "@jest/globals";

import { computeRunningTotal } from "@mingla/offering-rendering/eventBoxTotals";
import {
  dayLimitedLine,
  quantityPerDate,
  ticketCoversAnyDate,
} from "../../components/checkout/byDateQuantities";
import {
  dayChooserCaptions,
  removedTicketsNotice,
  ticketDayView,
} from "../ticketDayOffer";

const occurrences = ["fri", "sat", "sun"].map((id, index) => ({
  id,
  startAt: `2026-10-0${index + 2}T18:00:00Z`,
  endAt: `2026-10-0${index + 2}T23:00:00Z`,
  timezone: "UTC",
}));

describe("issue #3281 what a listed ticket means for chosen days", () => {
  test("an All dates ticket gets nothing, so its page is unchanged", () => {
    expect(ticketDayView(null, occurrences, ["fri"], true, "UTC")).toEqual({
      dayScopeLabel: null,
      offChosenDays: false,
    });
  });

  test("a ticket on every date reads as All dates to a guest", () => {
    const view = ticketDayView(["fri", "sat", "sun"], occurrences, ["fri"], true, "UTC");
    expect(view.dayScopeLabel).toBeNull();
    expect(view.lineDayCount).toBe(1);
  });

  test("no day chosen keeps every ticket on sale", () => {
    expect(ticketDayView(["fri"], occurrences, [], true, "UTC").offChosenDays).toBe(false);
  });

  test("a line pays only for the chosen dates it covers", () => {
    const view = ticketDayView(["fri", "sat"], occurrences, ["sat", "sun"], true, "UTC");
    expect(view.lineDayCount).toBe(1);
    expect(view.offChosenDays).toBe(false);
    expect(ticketDayView(["fri"], occurrences, ["sun"], true, "UTC").offChosenDays).toBe(true);
  });

  test("a one-price event has no per-line multiplier", () => {
    expect(ticketDayView(["fri"], occurrences, ["fri"], false, "UTC").lineDayCount).toBeUndefined();
  });
});

describe("issue #3281 running total", () => {
  const ticket = (id: string, lineDayCount?: number) => ({
    id,
    isFree: false,
    priceGbp: 10,
    lineDayCount,
  });

  test("a listed line uses its own days and All dates uses the event's", () => {
    expect(
      computeRunningTotal([ticket("listed", 1), ticket("all")], { listed: 2, all: 1 }, 3),
    ).toBe(50);
  });
});

describe("issue #3281 cart lines", () => {
  test("a ticket covering only some dates names them", () => {
    expect(dayLimitedLine(["fri"], 2, ["fri", "sat"], true)).toEqual({
      quantity: 2,
      byDate: { fri: 2 },
    });
    expect(dayLimitedLine(["fri", "sat"], 2, ["fri", "sat", "sun"], true)).toEqual({
      quantity: 4,
      byDate: { fri: 2, sat: 2 },
    });
  });

  test("full coverage, All dates and one-price passes stay uniform", () => {
    expect(dayLimitedLine(["fri", "sat"], 2, ["fri", "sat"], true)).toEqual({ quantity: 2 });
    expect(dayLimitedLine(null, 2, ["fri", "sat"], true)).toEqual({ quantity: 2 });
    expect(dayLimitedLine(["fri"], 2, ["fri", "sat"], false)).toEqual({ quantity: 2 });
  });

  test("the row shows the per-date count, not the total", () => {
    expect(quantityPerDate({ quantity: 4, byDate: { fri: 2, sat: 2 } })).toBe(2);
    expect(quantityPerDate({ quantity: 3 })).toBe(3);
  });

  test("a ticket off every chosen date is hidden from the cart", () => {
    expect(ticketCoversAnyDate(["fri"], ["sat"])).toBe(false);
    expect(ticketCoversAnyDate(["fri"], [])).toBe(true);
    expect(ticketCoversAnyDate(null, ["sat"])).toBe(true);
  });
});

describe("issue #3281 date picker captions", () => {
  const days = [{ id: "fri" }, { id: "sat" }, { id: "sun" }];
  const ticket = (ids: string[] | null, soldOut: string[] = []) => ({
    visibility: "public",
    validOccurrenceIds: ids,
    soldOutOccurrenceIds: soldOut,
  });

  test("an event with no listed ticket gets no captions", () => {
    expect(dayChooserCaptions([ticket(null)], days)).toEqual({});
  });

  test("names dates with no ticket and dates that are full", () => {
    expect(dayChooserCaptions([ticket(["fri", "sat"], ["sat"])], days)).toEqual({
      sat: "Sold out",
      sun: "No tickets",
    });
  });

  test("an All dates ticket keeps every date open", () => {
    expect(dayChooserCaptions([ticket(["fri"], ["fri"]), ticket(null)], days)).toEqual({});
  });

  test("a hidden ticket covers nothing", () => {
    expect(
      dayChooserCaptions([{ ...ticket(["fri"]), visibility: "hidden" }, ticket(["sat"])], days),
    ).toEqual({ fri: "No tickets", sun: "No tickets" });
  });
});

describe("issue #3281 removal notice", () => {
  test("names one, two and many", () => {
    const friday = { name: "Friday VIP", quantity: 2, dayLabel: "Fri 2 Oct" };
    const early = { name: "Early Bird", quantity: 1, dayLabel: "Fri 2 Oct" };
    expect(removedTicketsNotice([friday])).toBe("Removed 2 × Friday VIP — it's only for Fri 2 Oct.");
    expect(removedTicketsNotice([friday, early])).toBe(
      "Removed Friday VIP and Early Bird — they're only for Fri 2 Oct.",
    );
    expect(removedTicketsNotice([friday, early, friday])).toBe(
      "Removed 3 tickets — they're not on your days.",
    );
  });
});
