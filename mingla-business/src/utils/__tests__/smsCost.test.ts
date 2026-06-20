/**
 * META-ORCH-1161 Sub-B — SMS segment + cost estimate util tests.
 *
 * Fails-on-revert: change the UCS-2 branch in computeSegments to always use the
 * GSM-7 thresholds → the emoji (UCS-2) segment assertion FAILS.
 */

import {
  bodyWithFooter,
  computeSegments,
  estimateSmsCost,
  isGsm7,
} from "../smsCost";

describe("smsCost", () => {
  it("classifies plain ASCII as GSM-7", () => {
    expect(isGsm7("Hello there! See you at 8pm.")).toBe(true);
  });

  it("classifies emoji / non-GSM-7 as UCS-2", () => {
    expect(isGsm7("Party time 🎉")).toBe(false);
  });

  it("appends the STOP footer once", () => {
    const out = bodyWithFooter("Come to our show");
    expect(out).toContain("Reply STOP to opt out.");
    // Idempotent — does not double-append.
    expect(bodyWithFooter(out)).toBe(out);
  });

  it("computes 1 segment for a short GSM-7 body", () => {
    expect(computeSegments("Hi")).toBe(1);
  });

  it("computes more segments for long GSM-7 bodies (160/153)", () => {
    const long = "a".repeat(170); // > 160 → concatenated at 153/seg
    expect(computeSegments(long)).toBe(2);
  });

  it("computes UCS-2 segments at the 70-char threshold", () => {
    // An emoji forces UCS-2; 70 chars is the single-segment cap, 71 → 2.
    const sixtyNine = "x".repeat(69) + "🎉"; // 71 code units (emoji = 2)
    expect(isGsm7(sixtyNine)).toBe(false);
    expect(computeSegments(sixtyNine)).toBe(2);
  });

  it("estimates total segments + cost across the reachable audience", () => {
    const est = estimateSmsCost("Sale today!", 100);
    // Body + footer is short GSM-7 → 1 segment per recipient.
    expect(est.encoding).toBe("GSM-7");
    expect(est.segmentsPerRecipient).toBe(1);
    expect(est.totalSegments).toBe(100);
    // Default 1c/segment → 100c estimated.
    expect(est.estimatedCostMinor).toBe(100);
  });

  it("returns zero cost when reach is zero (no fabricated numbers)", () => {
    const est = estimateSmsCost("Hello", 0);
    expect(est.totalSegments).toBe(0);
    expect(est.estimatedCostMinor).toBe(0);
  });
});
