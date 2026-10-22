import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = readFileSync(
  join(__dirname, "..", "BrandProfileView.tsx"),
  "utf8",
);

describe("BrandProfileView discounts entry", () => {
  test("stays absent below rank 20, on access failure, and when the flag is off", () => {
    expect(source).toContain("currentRank < 20 || onDiscounts === undefined");
    expect(source).toContain("fetchDiscountAccess(brand.id)");
    expect(source).toContain(
      ".catch(() => { if (active) setDiscountsEnabled(false); })",
    );
    expect(source).toContain("discountsEnabled && onDiscounts !== undefined");
  });

  test("renders the exact Host operations row when access is on", () => {
    expect(source).toContain('label: "Discounts"');
    expect(source).toContain(
      'sub: "Codes, automatic discounts and sale prices"',
    );
    expect(source).toContain("onDiscounts(brand.id)");
  });
});
