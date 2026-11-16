/**
 * issue #4420 D-V1 — the venue answer bar reads as the shared fact rows.
 *
 *   F-1 a restaurant reads open state, where, spend, booking, in that order,
 *       each with its one action (Hours, Map, Reserve);
 *   F-2 a Stay reads price, check-in, where; the qualifier stays on the price
 *       row and "per night" joins the number (no "a night … per night");
 *   F-3 the quoted total takes the price row's place;
 *   F-4 an unknown clock claims nothing (no "Open"/"Closed now");
 *   F-5 nothing known ⇒ no rows, never blank ones; no map ⇒ no Map action.
 *
 * Fails-on-revert: reordering the rows, dropping an action, re-deriving the
 * price instead of restating the cell, or inventing an open-now claim fails.
 */
import {
  buildVenueAnswerBar,
  venueAddressLines,
  venueFacts,
} from "../../../../../packages/brand-rendering/venueFirstScreen";
import { venueCategoryProfile } from "../../../../../packages/brand-rendering/venueCategoryProfile";
import { resolveVenueStayRate } from "../../../../../packages/brand-rendering/venueStayRate";

const restaurant = venueCategoryProfile("restaurant");
const stay = venueCategoryProfile("stay");

const restaurantCells = (openState: Parameters<typeof buildVenueAnswerBar>[0]["openState"]) =>
  buildVenueAnswerBar({
    profile: restaurant,
    discoveryPrice: {
      minMinor: 4500,
      maxMinor: 7000,
      currencyCode: "USD",
      minorUnitExponent: 2,
    },
    stay: null,
    todayHours: { openTime: "12:00", closeTime: "23:00", isClosed: false },
    openState,
    stayRate: null,
    stayQuote: null,
    canBook: true,
  });

const place = venueAddressLines({ address: "24 Bond St, NoHo, New York", city: "New York" });

describe("issue #4420 — venue fact rows", () => {
  test("F-1 a restaurant: open state, where, spend, booking, one action each", () => {
    const facts = venueFacts({
      cells: restaurantCells({
        status: "open",
        closesAt: "23:00",
        opensAt: null,
        opensWeekday: null,
      } as never),
      profile: restaurant,
      place,
      todayHoursLine: "Thu · 12:00–23:00",
      hasHoursCard: true,
      hasMap: true,
      roomTypeCount: null,
    });
    expect(facts.map((f) => f.key)).toEqual(["time", "where", "price", "booking"]);
    expect(facts.map((f) => f.action)).toEqual(["hours", "map", null, "reserve"]);
    expect(facts[0]).toMatchObject({ value: "Open · until 23:00", detail: "Thu · 12:00–23:00" });
    expect(facts[1]).toMatchObject({ value: "24 Bond St", detail: "NoHo, New York" });
    expect(facts[2]?.value.startsWith("Typically ")).toBe(true);
    expect(facts[2]?.detail).toBe("a head");
    expect(facts[3]?.value).toBe("Tables through Mingla");
  });

  test("F-2 a Stay: price first, the qualifier on the same row, no doubled night", () => {
    const rate = resolveVenueStayRate([
      { price: { amountMinor: "27500", currencyCode: "USD", pricingUnit: "room_night" }, fees: [] },
    ]);
    const cells = buildVenueAnswerBar({
      profile: stay,
      discoveryPrice: null,
      stay: { checkInTime: "15:00:00", checkOutTime: "11:00:00" },
      todayHours: null,
      openState: null,
      stayRate: rate,
      stayQuote: null,
      canBook: true,
    });
    const facts = venueFacts({
      cells,
      profile: stay,
      place,
      todayHoursLine: null,
      hasHoursCard: false,
      hasMap: true,
      roomTypeCount: 2,
    });
    expect(facts.map((f) => f.key)).toEqual(["price", "time", "where"]);
    expect(facts[0]).toMatchObject({
      value: "From $275 a night",
      detail: "Before taxes and fees · 2 room types",
    });
    expect(facts[1]).toMatchObject({
      value: "Check-in from 15:00",
      detail: "Check-out by 11:00",
      action: null,
    });
  });

  test("F-3 the quoted total takes the price row", () => {
    const cells = buildVenueAnswerBar({
      profile: stay,
      discoveryPrice: null,
      stay: { checkInTime: "15:00:00", checkOutTime: "11:00:00" },
      todayHours: null,
      openState: null,
      stayRate: null,
      stayQuote: { totalMinor: "82600", currencyCode: "USD" } as never,
      canBook: true,
    });
    const price = venueFacts({
      cells,
      profile: stay,
      place,
      todayHoursLine: null,
      hasHoursCard: false,
      hasMap: false,
      roomTypeCount: 2,
    }).find((f) => f.key === "price");
    expect(price?.value).toBe("$826");
    expect(price?.detail).toBe("Total · taxes and fees included");
  });

  test("F-4 an unknown clock claims nothing", () => {
    const facts = venueFacts({
      cells: restaurantCells(null),
      profile: restaurant,
      place,
      todayHoursLine: null,
      hasHoursCard: true,
      hasMap: true,
      roomTypeCount: null,
    });
    const time = facts.find((f) => f.key === "time");
    expect(time?.value).toBe("Today · 12:00");
    expect(time?.value).not.toMatch(/^(Open|Closed now)/);
  });

  test("F-5 nothing known ⇒ no rows; no map ⇒ no Map action", () => {
    expect(
      venueFacts({
        cells: [],
        profile: restaurant,
        place: { street: null, area: null },
        todayHoursLine: null,
        hasHoursCard: false,
        hasMap: false,
        roomTypeCount: null,
      }),
    ).toEqual([]);
    const where = venueFacts({
      cells: [],
      profile: restaurant,
      place: venueAddressLines({ address: null, city: "Lagos" }),
      todayHoursLine: null,
      hasHoursCard: false,
      hasMap: false,
      roomTypeCount: null,
    });
    expect(where).toEqual([
      { key: "where", icon: "pin", value: "Lagos", detail: null, action: null },
    ]);
  });
});
