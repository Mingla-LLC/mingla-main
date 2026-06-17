/**
 * META-ORCH-1148 e2e-validation gap — fee-AMOUNT validity unit tests.
 *
 * GAP 1: the Settings module shipped the "Charge a reservation fee" toggle but
 * NO amount input, so `fee_amount_cents` stayed null and the engine treated the
 * fee as FREE — enabling it did nothing. The fix adds a currency-aware amount
 * input and the pure validity helpers tested here.
 *
 * Fails-on-revert anchor I-PROPOSED-1148-PAID-FEE-NEEDS-NONZERO-AMOUNT: a paid
 * fee may NOT read as ACTIVE with a null/0 amount, and is NOT saveable as active
 * without a positive amount. A revert of `paidFeeIsActive` (e.g. returning
 * `feeEnabled` alone) flips T-AMT-1 → FAIL.
 */

import {
  feeAmountValidForSave,
  paidFeeIsActive,
} from "../venueFeeGate";
import { minorFromMajor } from "../../../utils/currency";

describe("paidFeeIsActive", () => {
  it("T-AMT-1 — fee ON with null amount is NOT active (the gap bug)", () => {
    expect(paidFeeIsActive(true, null)).toBe(false);
  });

  it("T-AMT-2 — fee ON with 0 amount is NOT active", () => {
    expect(paidFeeIsActive(true, 0)).toBe(false);
  });

  it("fee ON with a positive amount IS active", () => {
    expect(paidFeeIsActive(true, 2500)).toBe(true);
  });

  it("fee OFF is never active regardless of amount", () => {
    expect(paidFeeIsActive(false, 2500)).toBe(false);
    expect(paidFeeIsActive(false, null)).toBe(false);
  });
});

describe("feeAmountValidForSave", () => {
  it("fee OFF is always saveable (amount irrelevant)", () => {
    expect(feeAmountValidForSave(false, null)).toBe(true);
    expect(feeAmountValidForSave(false, 0)).toBe(true);
  });

  it("T-AMT-3 — fee ON with null/0 amount is NOT a saveable active state", () => {
    expect(feeAmountValidForSave(true, null)).toBe(false);
    expect(feeAmountValidForSave(true, 0)).toBe(false);
  });

  it("fee ON with a positive amount is saveable", () => {
    expect(feeAmountValidForSave(true, 1)).toBe(true);
    expect(feeAmountValidForSave(true, 2500)).toBe(true);
  });
});

describe("minorFromMajor — currency-aware cents conversion (input → fee_amount_cents)", () => {
  it("converts major dollars/pounds to integer cents", () => {
    expect(minorFromMajor(25, "USD")).toBe(2500);
    expect(minorFromMajor(10.5, "GBP")).toBe(1050);
  });

  it("rounds to a whole integer (no fractional cents persisted)", () => {
    expect(minorFromMajor(9.999, "USD")).toBe(1000);
    expect(Number.isInteger(minorFromMajor(3.337, "EUR"))).toBe(true);
  });

  it("zero-decimal currencies (JPY) use a factor of 1", () => {
    expect(minorFromMajor(2500, "JPY")).toBe(2500);
  });

  it("blank / non-positive / non-finite input clamps to 0 (= no amount set)", () => {
    expect(minorFromMajor(0, "USD")).toBe(0);
    expect(minorFromMajor(-5, "USD")).toBe(0);
    expect(minorFromMajor(Number.NaN, "USD")).toBe(0);
  });

  it("end-to-end — a typed amount that converts to 0 cents is NOT an active paid fee", () => {
    const cents = minorFromMajor(0, "USD");
    expect(paidFeeIsActive(true, cents)).toBe(false);
    expect(feeAmountValidForSave(true, cents)).toBe(false);
  });
});
