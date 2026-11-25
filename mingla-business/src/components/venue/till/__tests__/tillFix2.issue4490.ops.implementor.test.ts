/**
 * #4490 spec 08 O1 fix round 2.
 *
 * O1-B1 — every refusal the Till can receive has its own words. The table is
 * checked against the codes the venue-till edge function can actually send
 * (its TILL_SAFE_CODES list and every literal `{ code: "…" }` it answers), so
 * a new server code with no words, or two codes quietly sharing a line,
 * fails here. "Changed on another device" belongs to the version conflict
 * alone. A typed amount above what is left is refused in words and is never
 * swapped for the balance.
 *
 * O1-B2 — the overpaid banner never asks for money already given back.
 *
 * TEST-MOD-APPROVED #4490 (08-O3 fix 1, O3-T7): the source-text reads of this suite moved, word for word, into
 * .github/scripts/strict-grep/issue-4490-host-wiring.mjs (I-PROPOSED-1047-NO-SOLE-SOURCE-PIN: "for a genuine
 * structural rule, an additive strict-grep gate", as #4490 W3 fix 1 did); every behavioural test stays here.
 * (The edge's codes each having a row in TILL_ERROR_COPY is pin `till-error-codes-have-words` there.)
 */

import { mapTillSale } from "../../../../services/venueTillService";
import { TILL_ERROR_COPY, TILL_SHARED_COPY, tillAmountError, tillErrorCopy, type TillErrorCode } from "../tillCopy";
import { overpaidToRefund } from "../tillModel";

const CHANGED = "That check was changed on another device. We've refreshed it.";

describe("#4490 O1 fix 2 — every Till refusal has its own words (O1-B1)", () => {
  it("the table holds the overpay, version and not-orderable rows (sanity)", () => {
    const codes = Object.keys(TILL_ERROR_COPY);
    expect(codes).toEqual(expect.arrayContaining(["till_amount_over_due", "till_check_changed", "till_item_not_orderable"]));
    expect(codes.length).toBeGreaterThan(50);
  });

  it.each(Object.keys(TILL_ERROR_COPY))("%s has its own row in the table (no fallback words)", (code) => {
    expect(Object.prototype.hasOwnProperty.call(TILL_ERROR_COPY, code)).toBe(true);
    expect(tillErrorCopy(code)).not.toMatch(/_/);
  });

  it("only the version conflict says the check changed on another device", () => {
    const saying = (Object.keys(TILL_ERROR_COPY) as TillErrorCode[]).filter((c) => TILL_ERROR_COPY[c] === CHANGED);
    expect(saying).toEqual(["till_check_changed"]);
  });

  it("no two codes share words unless they are declared synonyms", () => {
    const groupOf = new Map<string, number>();
    TILL_SHARED_COPY.forEach((group, i) => group.forEach((c) => groupOf.set(c, i)));
    const byCopy = new Map<string, string[]>();
    for (const code of Object.keys(TILL_ERROR_COPY) as TillErrorCode[]) {
      const list = byCopy.get(TILL_ERROR_COPY[code]) ?? [];
      list.push(code);
      byCopy.set(TILL_ERROR_COPY[code], list);
    }
    for (const [copy, list] of byCopy) {
      if (list.length < 2) continue;
      const groups = new Set(list.map((c) => groupOf.get(c) ?? `solo:${c}`));
      expect({ copy, codes: list, oneDeclaredGroup: groups.size === 1 && typeof [...groups][0] === "number" }).toEqual({
        copy,
        codes: list,
        oneDeclaredGroup: true,
      });
    }
  });

  it.each([
    ["till_amount_over_due", "That's more than they still owe. Lower the amount."],
    ["till_nothing_to_pay", "There's nothing left to pay on this check."],
    ["till_check_closed", "This check is closed, so nothing changed. Open Checks to find it."],
    ["till_line_not_paid", "This line isn't paid yet, so there's nothing to refund. Void it instead."],
    ["till_refund_line_invalid", "Only an entry or package can be refunded on its own. Refund food and drink from the payment."],
    ["till_payment_in_progress", "A guest is paying right now. Try again in a few minutes."],
    ["till_line_paid", "This item is paid. Refund it instead of voiding it."],
    ["till_refund_method_unavailable", "This payment can't be refunded that way."],
    ["till_payment_not_refundable", "This payment has nothing left to refund."],
    ["till_check_changed", CHANGED],
  ])("%s → %s", (code, copy) => expect(tillErrorCopy(code)).toBe(copy));

  it("an unknown code is still plain words", () => {
    expect(tillErrorCopy("weird_code")).toBe("That didn't go through. Try again.");
    expect(tillErrorCopy("weird_code", "Suya")).toBe("Suya: that didn't go through. Try again.");
  });
});

describe("#4490 O1 fix 2 — the pay sheet never changes a typed amount (O1-B1)", () => {
  it("refuses an amount above what is left with the overpay words, and zero with its own", () => {
    expect(tillAmountError(700000, 590000)).toBe("That's more than they still owe. Lower the amount.");
    expect(tillAmountError(0, 590000)).toBe("Enter an amount above zero.");
    expect(tillAmountError(590000, 590000)).toBeNull();
    expect(tillAmountError(100000, 590000)).toBeNull();
    expect(tillAmountError(null, 590000)).toBeNull();
  });
});

describe("#4490 O1 fix 2 — the overpaid banner clears once the extra is refunded (O1-B2)", () => {
  const base = {
    id: "s1",
    venueId: "v1",
    currency: "NGN",
    totalDueMinor: 0,
    paidMinor: 0,
    remainingMinor: 0,
    version: 9,
    lines: [],
  };
  const pay = (state: string, refundedMinor: number) => ({
    id: "p1",
    method: "own_machine",
    state,
    amountMinor: 400000,
    tipMinor: 0,
    refundedMinor,
  });

  it("asks to refund the extra while it is still on the payment", () => {
    expect(overpaidToRefund(mapTillSale({ ...base, state: "paid", overpaidMinor: 400000, payments: [pay("paid", 0)] }))).toBe(400000);
  });

  it("shows nothing once that money is refunded, even if a stale read still carries the old figure", () => {
    expect(
      overpaidToRefund(mapTillSale({ ...base, state: "refunded", overpaidMinor: 400000, payments: [pay("refunded", 400000)] })),
    ).toBe(0);
  });

  it("shows only what is left after a part refund", () => {
    expect(
      overpaidToRefund(
        mapTillSale({ ...base, state: "partially_refunded", overpaidMinor: 400000, payments: [pay("partially_refunded", 150000)] }),
      ),
    ).toBe(250000);
  });

  it("an open check never shows the banner", () => {
    expect(overpaidToRefund(mapTillSale({ ...base, state: "open", overpaidMinor: 400000, payments: [pay("paid", 0)] }))).toBe(0);
  });
});
