/**
 * #4490 07-E — Today's money: the server's two numbers parsed and labelled.
 *
 * Fails-on-revert: restoring the "Bought online" fall-through for a cancelled
 * gate sale fails the source case; deleting parseVenueDayMoney's shape check
 * makes the malformed case return numbers.
 */
jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } } }));

import { parseVenueDayMoney } from "../../../services/venueOffersService";
import { bookingSourceLabel, todayMoneyCopy, todayMoneyRows } from "../features/today/todayModel";
import type { VenueDayBooking } from "../../../types/venueOffers";

const serverMoney = {
  localDate: "2026-11-21",
  currencyCode: "NGN",
  otherCurrency: false,
  paidInMinor: 124000000,
  paidIn: { online: 82000000, atVenue: 30000000, members: 0, tableDeposits: 15000000, refunded: 3000000 },
  forTodayPaidMinor: 96000000,
  forToday: { online: 60000000, atVenue: 30000000, members: 0, tableDeposits: 9000000, refunded: 3000000 },
};

describe("#4490 07-E today's money", () => {
  it("parses the server's money day exactly", () => {
    const m = parseVenueDayMoney(serverMoney);
    expect(m).toEqual({
      currencyCode: "NGN",
      otherCurrency: false,
      paidInMinor: 124000000,
      paidIn: serverMoney.paidIn,
      forTodayPaidMinor: 96000000,
      forToday: serverMoney.forToday,
    });
  });

  it("N128: the server's currency and the other-currency flag are read", () => {
    expect(parseVenueDayMoney({ ...serverMoney, otherCurrency: true })?.otherCurrency).toBe(true);
    expect(parseVenueDayMoney({ ...serverMoney, currencyCode: undefined })?.currencyCode).toBeNull();
  });

  it("an absent or malformed money read is null (the tiles show -- and Retry)", () => {
    expect(parseVenueDayMoney(undefined)).toBeNull();
    expect(parseVenueDayMoney({ paidInMinor: 1 })).toBeNull();
    expect(parseVenueDayMoney({ ...serverMoney, paidInMinor: "x" })).toBeNull();
  });

  it("tile words for today and for another day", () => {
    expect(todayMoneyCopy("paidIn", true)).toEqual({ label: "Paid in today", sub: "Money received today, for any date" });
    expect(todayMoneyCopy("forToday", true)).toEqual({ label: "For today's bookings", sub: "Paid so far for bookings dated today" });
    expect(todayMoneyCopy("paidIn", false).label).toBe("Paid in that day");
    expect(todayMoneyCopy("forToday", false).label).toBe("For that day's bookings");
  });

  it("the detail sheet lists the parts in order, refunds as minus", () => {
    const rows = todayMoneyRows(serverMoney.paidIn);
    expect(rows.map((r) => r.label)).toEqual(["Online", "At the venue", "Members", "Table deposits", "Refunded"]);
    expect(rows.find((r) => r.key === "refunded")?.negative).toBe(true);
  });

  it("N137: For today's bookings lists no Members line (always 0 there)", () => {
    expect(todayMoneyRows(serverMoney.forToday, "forToday").map((r) => r.key)).toEqual(["online", "atVenue", "tableDeposits", "refunded"]);
    expect(todayMoneyRows(serverMoney.paidIn, "paidIn").map((r) => r.key)).toContain("members");
  });

  it("a cancelled gate sale reads Gate sale · cancelled, not Bought online", () => {
    const b = (over: Partial<VenueDayBooking>): VenueDayBooking => ({
      groupId: "g", reference: "VB-1", state: "confirmed", guestName: "Ada", guests: 1, totalMinor: 500000,
      currencyCode: "NGN", source: "walk_in", paymentCollection: "mingla", admittedCount: 0, createdAt: "1",
      ...over,
    } as VenueDayBooking);
    expect(bookingSourceLabel(b({ state: "cancelled" }))).toBe("Gate sale · cancelled");
    expect(bookingSourceLabel(b({}))).toBe("Gate sale");
    expect(bookingSourceLabel(b({ source: "guest" }))).toBe("Bought online");
    expect(bookingSourceLabel(b({ paymentCollection: "property" }))).toBe("Paid at the gate");
  });
});
