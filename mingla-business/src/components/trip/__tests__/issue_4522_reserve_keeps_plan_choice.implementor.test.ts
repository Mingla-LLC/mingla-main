/**
 * issue #4522 — the "Pay over time" choice made on /t/{brand}/{trip} must reach
 * checkout when Reserve is pressed before any package quantity is picked.
 *
 * Calls the REAL `resolveTripReserveChoice`, the function the page's Reserve
 * runs on its selected lines. That the page calls it (and forwards the same
 * lines) is pinned by tripCartInstallmentAware_orch_1180_regression.
 *
 * FAILS ON REVERT: collapse an empty selection to "full" again (the old
 * `collapseTripPlanChoice(lines)` alone), or ignore a package's own choice.
 */
import { describe, expect, test } from "@jest/globals";
import { resolveTripReserveChoice } from "../tripCartPlanChoice";

describe("issue #4522 — Reserve keeps the plan choice with no quantity picked", () => {
  test("no lines + cart-level installments -> installments", () => {
    expect(resolveTripReserveChoice([], "installments", {})).toBe("installments");
  });
  test("no lines + a package's own installments choice -> installments", () => {
    expect(resolveTripReserveChoice([], "full", { t1: "installments" })).toBe(
      "installments",
    );
  });
  test("no lines + nothing chosen -> full", () => {
    expect(resolveTripReserveChoice([], "full", { t1: "full" })).toBe("full");
  });
  test("with lines the lines win (full line beats stale cart choice)", () => {
    expect(
      resolveTripReserveChoice([{ paymentPlanChoice: "full" }], "installments", {}),
    ).toBe("full");
    expect(
      resolveTripReserveChoice([{ paymentPlanChoice: "installments" }], "full", {}),
    ).toBe("installments");
  });
});
