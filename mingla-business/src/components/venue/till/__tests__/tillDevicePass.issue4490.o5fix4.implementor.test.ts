/**
 * #4490 spec 08 O5 fix 4 — the pure rules behind the device-pass fixes:
 * when the Till offers Pay and Save check, the web PIN pad's keys, how a late
 * payment is named (and its takenBy read from the server), the member sheet's
 * height with the PIN pad open, and the Team page's words for a staff member.
 *
 * Fails on revert: each helper is the one the screen calls (the render proof is
 * tillDevicePass.issue4490.o5fix4.render.test.tsx and teamOwnPin.issue4490.o5fix2).
 *
 * Run: cd mingla-business && npx jest --maxWorkers=2 tillDevicePass.issue4490.o5fix4.implementor
 */
import type { TillSale } from "../../../../services/venueTillService";
import { mapDaySummary } from "../../../../services/venueDayCloseService";
import { latePaymentTitle } from "../../close/dayCloseModel";
import { CLOSE_COPY } from "../../close/dayCloseCopy";
import { memberSheetSnap, teamEmptyCopy } from "../../../team/teamRowModel";
import { pinKeyAction } from "../pinModel";
import { checkSettled, payActionShown, saveCheckEnabled, type DraftLine } from "../tillModel";

const sale = (over: Partial<TillSale>): TillSale => ({
  state: "open", remainingMinor: 100, totalDueMinor: 100, paidMinor: 0, subtotalMinor: 100, serviceChargeMinor: 0,
  pendingPayment: false, creditMinor: 0, ...over,
} as unknown as TillSale);
const draft = [{ key: "k", menuItemId: "i", quantity: 1, modifierIds: [], notes: null } as unknown as DraftLine];

describe("Pay and Save check (item 6)", () => {
  test("a paid, refunded or voided check is settled; open and paying are not", () => {
    for (const state of ["paid", "refunded", "partially_refunded", "voided"] as const) expect(checkSettled(sale({ state }))).toBe(true);
    expect(checkSettled(sale({ state: "open" }))).toBe(false);
    expect(checkSettled(sale({ state: "paying" }))).toBe(false);
    expect(checkSettled(null)).toBe(false);
  });
  test("Pay shows while money is due or lines wait to be priced, never on a paid check or at 0 due", () => {
    expect(payActionShown(sale({}), [])).toBe(true);
    expect(payActionShown(sale({ state: "paid", remainingMinor: 0 }), [])).toBe(false);
    expect(payActionShown(sale({ remainingMinor: 0, totalDueMinor: 100, paidMinor: 100 }), [])).toBe(false);
    expect(payActionShown(null, draft)).toBe(true);
    expect(payActionShown(sale({ remainingMinor: 0 }), draft)).toBe(true);
    expect(payActionShown(sale({ state: "paid", remainingMinor: 0 }), draft)).toBe(false);
    // A deposit that covers the bill still closes the check from the same button.
    expect(payActionShown(sale({ remainingMinor: 0, totalDueMinor: 0, creditMinor: 500 }), [])).toBe(true);
  });
  test("Save check needs new lines, and never on a settled check", () => {
    expect(saveCheckEnabled(sale({}), [])).toBe(false);
    expect(saveCheckEnabled(null, [])).toBe(false);
    expect(saveCheckEnabled(null, draft)).toBe(true);
    expect(saveCheckEnabled(sale({}), draft)).toBe(true);
    expect(saveCheckEnabled(sale({ state: "paid", remainingMinor: 0 }), draft)).toBe(false);
  });
});

describe("web PIN keys (item 7)", () => {
  test("0-9, Backspace and Enter; nothing else, nothing with a modifier", () => {
    for (const d of "0123456789") expect(pinKeyAction(d)).toEqual({ kind: "digit", digit: d });
    expect(pinKeyAction("Backspace")).toEqual({ kind: "back" });
    expect(pinKeyAction("Enter")).toEqual({ kind: "submit" });
    for (const k of ["a", "Tab", "Escape", " ", "12", "Delete"]) expect(pinKeyAction(k)).toBeNull();
    expect(pinKeyAction("5", true)).toBeNull();
  });
});

describe("a late payment's name (item 4)", () => {
  test("the check's name first, else who took it, else a plain sentence (never 'Team member')", () => {
    const ada = { userId: "u", kind: "person" as const, name: "Ada" };
    expect(latePaymentTitle({ checkLabel: "S20", takenBy: ada })).toBe("S20");
    expect(latePaymentTitle({ checkLabel: null, takenBy: ada })).toBe("Taken by Ada");
    expect(latePaymentTitle({ checkLabel: "  ", takenBy: ada })).toBe("Taken by Ada");
    expect(latePaymentTitle({ checkLabel: null, takenBy: { userId: null, kind: "device", name: null } }))
      .toBe(`Taken by ${CLOSE_COPY.person.device}`);
    expect(latePaymentTitle({ checkLabel: null, takenBy: { userId: "u", kind: "person", name: null } })).toBe(CLOSE_COPY.latePaymentUntitled);
    expect(latePaymentTitle({ checkLabel: null, takenBy: null })).toBe(CLOSE_COPY.latePaymentUntitled);
  });
  test("the day summary reads takenBy from the server (and null from an older one)", () => {
    const s = mapDaySummary({ late: { payments: [
      { paymentId: "a", checkLabel: null, takenBy: { userId: "u", kind: "person", name: "Ada" } },
      { paymentId: "b", checkLabel: "S1" },
    ] } });
    expect(s.late.payments[0].takenBy).toEqual({ userId: "u", kind: "person", name: "Ada" });
    expect(s.late.payments[1].takenBy).toBeNull();
  });
});

describe("Team (items 2 and 8)", () => {
  test("the member sheet is half height, and the tallest sheet while the PIN pad is open", () => {
    expect(memberSheetSnap(false)).toBe("half");
    expect(memberSheetSnap(true)).toBeGreaterThanOrEqual(0.9);
  });
  test("solo words only for someone who can invite", () => {
    expect(teamEmptyCopy(true).title).toBe("You're working solo");
    expect(teamEmptyCopy(false).title).not.toContain("solo");
    expect(teamEmptyCopy(false).description).toContain("brand admin");
  });
});
