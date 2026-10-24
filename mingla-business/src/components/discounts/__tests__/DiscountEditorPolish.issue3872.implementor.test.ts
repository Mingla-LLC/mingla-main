// MINGLA-INVARIANT: I-3872-HOST-EDITOR-USABLE | issue #3872 | The Host discount editor uses visible date/time pickers, clear choice cards, and a buyer-readable monetary preview rather than raw ISO or JSON fields.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import { isoFromLocalDateTime, localDateTimeValue } from "../discountDateTime";

const source = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("issue #3872 Host discount editor polish", () => {
  test("round-trips browser-local date-time values and supports an optional end", () => {
    const original = "2026-10-23T13:45:00.000Z";
    expect(isoFromLocalDateTime(localDateTimeValue(original))).toBe(original);
    expect(localDateTimeValue(null)).toBe("");
    expect(isoFromLocalDateTime("")).toBeNull();
    expect(isoFromLocalDateTime("not-a-date")).toBeNull();
  });

  test("uses real date pickers in one row and removes raw ISO and JSON output", () => {
    const editor = source("src/components/discounts/DiscountEditSheet.tsx");

    expect(editor).toContain('type="datetime-local"');
    expect(editor).toContain("styles.dateRow");
    expect(editor).toContain('label="Starts at"');
    expect(editor).toContain('label="Ends at"');
    expect(editor).not.toContain("Starts at (ISO date/time)");
    expect(editor).not.toContain("JSON.stringify(row)");
    expect(editor).toContain("Buyer pays");
    expect(editor).toContain("Saves");
  });

  test("uses descriptive radio cards and a structured scope picker", () => {
    const editor = source("src/components/discounts/DiscountEditSheet.tsx");
    const scope = source("src/components/discounts/DiscountScopePicker.tsx");

    expect(editor).toContain("DISCOUNT_KIND_DESCRIPTIONS");
    expect(editor).toContain("styles.kindCards");
    expect(editor).toContain('accessibilityRole="radiogroup"');
    expect(scope).toContain("Entire brand");
    expect(scope).toContain("Offering types");
    expect(scope).toContain("Specific items");
    expect(scope).toContain("styles.chipWrap");
    expect(scope).toContain("styles.itemGrid");
  });

  test("threads the real brand currency into scope prices and preview money", () => {
    const route = source("app/brand/[id]/discounts.tsx");
    const list = source("src/components/discounts/DiscountListView.tsx");
    const editor = source("src/components/discounts/DiscountEditSheet.tsx");

    expect(route).toContain(
      "brand?.pricingCurrency ?? brand?.defaultCurrency ?? null",
    );
    expect(list).toContain("currencyCode={currencyCode}");
    expect(editor).toContain("formatCurrency(minor, previewCurrency, true)");
  });
});
