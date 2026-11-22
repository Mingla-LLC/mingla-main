/**
 * #4490 spec 08 O1 (T20) — the guest's Till receipt page model, the receipt
 * buttons on the Till, and the receipt token kept on the device.
 */
import { tillReceiptView, receiptWhen, TILL_RECEIPT_PAGE_COPY } from "../tillReceiptModel";
import { receiptChannelsReady, receiptPhoneStartCountry } from "../../till/tillModel";
import { tillErrorCopy } from "../../till/tillCopy";
import { isTillReceiptToken } from "../../../../utils/tillReceiptTokens";

const RECEIPT = {
  receiptNo: 12,
  venueName: "Gameland QA",
  venueAddress: "1 Admiralty Way, Lagos",
  currency: "NGN",
  paidAt: "2026-11-22T20:40:00Z",
  timezone: "Africa/Lagos",
  checkLabel: "Tolu",
  lines: [
    { label: "Chapman", quantity: 2, amountMinor: 500000, modifiers: ["No ice"] },
    { label: "Walk-in", quantity: 1, amountMinor: 537500, modifiers: [] },
  ],
  subtotalMinor: 1037500,
  serviceChargeMinor: 50000,
  taxIncludedMinor: 37500,
  totalMinor: 1087500,
  paidBeforeMinor: 400000,
  payment: { method: "cash", amountMinor: 587500, tipMinor: 0, changeMinor: 912500, paidLate: false, reference: "A4CCF3B1" },
  refundedMinor: 0,
  footer: "Thank you.",
};

describe("08-O1 the guest's receipt page", () => {
  it("RP-1 rows: lines with choices, service, included tax, total, paid before, tender, change, what is left", () => {
    const v = tillReceiptView(RECEIPT);
    expect(v).not.toBeNull();
    if (v === null) return;
    expect(v.heading).toBe("Receipt from Gameland QA");
    expect(v.meta).toBe("Receipt 12 · Ref A4CCF3B1");
    expect(v.lines.map((l) => [l.label, l.detail])).toEqual([["2 × Chapman", "No ice"], ["Walk-in", null]]);
    expect(v.totals.map((t) => t.key)).toEqual(["subtotal", "service", "tax", "total"]);
    expect(v.payment.map((p) => p.key)).toEqual(["before", "paid", "change", "left"]);
    expect(v.payment.find((p) => p.key === "paid")?.label).toBe("Cash");
    expect(v.footer).toBe("Thank you.");
    expect(v.address).toBe("1 Admiralty Way, Lagos");
    expect(v.when).toBe("22 Nov 2026, 21:40");
  });

  it("RP-2 refunds show; a late payment never says what is left; an unreadable receipt is null", () => {
    const refunded = tillReceiptView({ ...RECEIPT, refundedMinor: 100000 });
    expect(refunded?.payment.map((p) => p.key)).toContain("refunded");
    const late = tillReceiptView({ ...RECEIPT, payment: { ...RECEIPT.payment, paidLate: true } });
    expect(late?.paidLate).toBe(true);
    expect(late?.payment.map((p) => p.key)).not.toContain("left");
    expect(tillReceiptView({ ...RECEIPT, currency: "" })).toBeNull();
    expect(tillReceiptView(null)).toBeNull();
    expect(receiptWhen("not a date", "Africa/Lagos")).toBeNull();
    expect(TILL_RECEIPT_PAGE_COPY.tabTitle).toBe("Your receipt · Mingla");
  });

  it("RP-3 only a derived receipt token is accepted on the device", () => {
    expect(isTillReceiptToken(`k1.${"a".repeat(43)}`)).toBe(true);
    expect(isTillReceiptToken("a".repeat(43))).toBe(false);
    expect(isTillReceiptToken("k1.short")).toBe(false);
    expect(isTillReceiptToken(null)).toBe(false);
  });
});

describe("08-O1 the receipt buttons on the Till", () => {
  it("RB-1 Text needs a valid mobile, Email a valid address, Both needs both", () => {
    expect(receiptChannelsReady({ phoneE164: "+2348031234567", phoneEmpty: false, email: "" })).toEqual({ text: true, email: false, both: false });
    expect(receiptChannelsReady({ phoneE164: null, phoneEmpty: false, email: "a@b.co" })).toEqual({ text: false, email: true, both: false });
    expect(receiptChannelsReady({ phoneE164: "+2348031234567", phoneEmpty: false, email: " a@b.co " })).toEqual({ text: true, email: true, both: true });
    expect(receiptChannelsReady({ phoneE164: null, phoneEmpty: true, email: "nope@" })).toEqual({ text: false, email: false, both: false });
  });

  it("RB-2 the phone picker starts in the check's currency country; refusals read in words", () => {
    expect(receiptPhoneStartCountry("NGN")).toBe("NG");
    expect(receiptPhoneStartCountry("gbp")).toBe("GB");
    expect(receiptPhoneStartCountry("XOF")).toBeNull();
    expect(tillErrorCopy("till_receipt_limit")).toBe("This receipt was sent three times, the most we send.");
    expect(tillErrorCopy("till_card_refunded_once")).toBe("This card payment was already refunded once. Pay the rest back in cash.");
    expect(tillErrorCopy("till_receipt_phone_invalid")).toBe("Check the mobile number, including the country.");
  });
});
