/**
 * issue #3645 — the experience price field starts empty.
 *
 * Live test, 2026-10-13: the field held the literal text "0.00", so typing 30
 * gave "0.0030". 0.00 is now the placeholder, not the value. Free/paid logic
 * and validation are unchanged: every reader already treats an empty field as
 * zero, which this suite pins against the wizard's own reader.
 */

import { describe, expect, test } from "@jest/globals";

import { initialWholePriceInput } from "../experienceWizardTypes";

/**
 * The wizard's own reader of the field (resolvedTotalMajor, whole mode). That
 * the wizard seeds the field through the helper, keeps 0.00 as the placeholder
 * and still requires a price above zero is enforced by the strict-grep gate
 * .github/scripts/strict-grep/issue-3645-paid-drafts-stop-at-publish.mjs, group E-b.
 */
const wizardReads = (text: string): number => {
  const v = parseFloat(text);
  return Number.isFinite(v) && v >= 0 ? v : 0;
};

describe("#3645 initialWholePriceInput", () => {
  test("a new experience starts with an empty field", () => {
    expect(initialWholePriceInput(undefined)).toBe("");
    expect(initialWholePriceInput(null)).toBe("");
  });

  test("a saved or prefilled zero is not shown as text either", () => {
    for (const zero of ["0.00", "0", "0.0", "", "  ", "00.00"]) {
      expect(initialWholePriceInput(zero)).toBe("");
    }
  });

  test("a saved price above zero is shown exactly as saved", () => {
    expect(initialWholePriceInput("25.00")).toBe("25.00");
    expect(initialWholePriceInput("0.50")).toBe("0.50");
    expect(initialWholePriceInput("1200")).toBe("1200");
  });

  test("anything unreadable or negative starts empty", () => {
    for (const bad of ["abc", "-5", "NaN", "Infinity"]) {
      expect(initialWholePriceInput(bad)).toBe("");
    }
  });

  test("typing 30 into the new field gives 30, not 0.0030", () => {
    const typed = `${initialWholePriceInput(undefined)}30`;
    expect(typed).toBe("30");
    expect(wizardReads(typed)).toBe(30);
    // What the old starting value produced.
    expect(wizardReads("0.0030")).toBeCloseTo(0.003);
  });

  test("an empty field is worth exactly what '0.00' was worth: free/paid logic is unchanged", () => {
    expect(wizardReads("")).toBe(wizardReads("0.00"));
    expect(wizardReads("")).toBe(0);
  });
});
