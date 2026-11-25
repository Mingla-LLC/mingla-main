/**
 * #4490 spec 08 O4 fix 1 — the client side of the four fixes, as rules:
 * O4-T2 when the Till's primary action is "Close check" (display only; the
 * server decides), the words for a refused close and for a unit still in use
 * (O4-T4), the booking label for the part of a bill the deposit paid (O4-T3),
 * and the Host's words when a move of a seated booking is refused because its
 * deposit is on a bill (O4-T1).
 */
import type { TillSale } from "../../../../services/venueTillService";
import { TillError } from "../../../../services/venueTillService";
import { methodLabel } from "../../features/bookings/bookingModel";
import { transitionErrorMessage } from "../../reservationPaidCancelNote";
import { TILL_COPY, tillErrorCopy } from "../tillCopy";
import { coveredByCredit } from "../tillModel";

const SALE = {
  id: "s",
  venueId: "v",
  state: "open",
  checkLabel: null,
  spotId: null,
  spotLabel: null,
  serverUserId: "u",
  currency: "NGN",
  subtotalMinor: 1000000,
  serviceChargeMinor: 100000,
  totalDueMinor: 0,
  paidMinor: 0,
  remainingMinor: 0,
  overpaidMinor: 0,
  settledOutside: null,
  version: 3,
  businessDate: null,
  pendingPayment: false,
  lines: [],
  payments: [],
  creditMinor: 2000000,
  creditUsedMinor: 1100000,
} as TillSale;

describe("O4-T2 Close check is the primary action only when the deposit pays everything", () => {
  test("a bought check the deposit covers, nothing paid, nothing pending", () => {
    expect(coveredByCredit(SALE)).toBe(true);
  });
  test.each([
    ["money still due", { totalDueMinor: 600000, remainingMinor: 600000 }],
    ["no deposit", { creditMinor: 0, creditUsedMinor: 0 }],
    ["nothing bought", { subtotalMinor: 0, serviceChargeMinor: 0, creditUsedMinor: 0 }],
    ["a payment is pending", { pendingPayment: true }],
    ["already paid", { state: "paid" as const }],
    ["money already taken", { paidMinor: 100 }],
  ])("not when %s", (_why, change) => {
    expect(coveredByCredit({ ...SALE, ...change } as TillSale)).toBe(false);
    expect(coveredByCredit(null)).toBe(false);
  });
  test("its words", () => {
    expect(TILL_COPY.closeCheck).toBe("Close check");
    expect(TILL_COPY.checkClosed).toBe("Check closed. The deposit paid for it.");
    expect(tillErrorCopy("till_close_not_covered")).toBe(
      "Only a check the deposit fully pays can be closed. Take a payment instead.",
    );
  });
});

describe("O4-T4 a unit still in use says when it frees up", () => {
  test("the copy and the error detail", () => {
    expect(TILL_COPY.inUseUntil("Pool table 1", "14:00")).toBe("Pool table 1 is in use until 14:00.");
    const err = new TillError("offer_space_taken", null, null, {
      unitName: "Pool table 1",
      nextAt: null,
      freeAt: "2026-11-23T14:00:00+00:00",
    });
    expect([err.unitName, err.freeAt, err.nextAt]).toEqual(["Pool table 1", "2026-11-23T14:00:00+00:00", null]);
  });
});

describe("O4-T3 the part of a bill the table deposit paid reads as such on the booking", () => {
  test("methodLabel", () => {
    expect(methodLabel("table_deposit")).toBe("the table deposit on the bill");
    expect(methodLabel("cash")).toBe("cash");
  });
});

describe("O4-T1 a refused move of a seated booking whose deposit is on a bill", () => {
  test("has words; any other refusal keeps today's behaviour", () => {
    expect(transitionErrorMessage({ code: "P0001", message: "reservation_deposit_used" })).toBe(
      "This deposit was used on the bill at the venue.",
    );
    expect(transitionErrorMessage({ code: "P0001", message: "something_else" })).toBeNull();
    expect(transitionErrorMessage(null)).toBeNull();
  });
});
