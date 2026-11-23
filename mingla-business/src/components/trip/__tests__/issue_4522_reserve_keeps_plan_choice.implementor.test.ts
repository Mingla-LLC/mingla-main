/**
 * issue #4522 — the "Pay over time" choice made on /t/{brand}/{trip} must reach
 * checkout when Reserve is pressed before any package quantity is picked.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

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
  test("the page's Reserve uses the resolver, not a bare collapse of the lines", () => {
    const src = readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "app", "t", "[brandSlug]", "[tripSlug].tsx"),
      "utf-8",
    );
    expect(src).toMatch(/resolveTripReserveChoice\(/);
    expect(src).not.toMatch(/handleTripReserve\(\s*collapseTripPlanChoice\(/);
  });
});
