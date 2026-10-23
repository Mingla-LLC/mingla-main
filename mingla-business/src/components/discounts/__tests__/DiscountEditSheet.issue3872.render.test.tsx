import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";
import "./DiscountEditSheet.issue3872.behavior.test";

const componentSource = readFileSync(
  join(__dirname, "..", "DiscountEditSheet.tsx"),
  "utf8",
);
const contractSource = readFileSync(
  join(__dirname, "..", "discountUiContract.ts"),
  "utf8",
);
const source = `${componentSource}\n${contractSource}`;

describe("DiscountEditSheet Host contract", () => {
  test("renders every Host-controlled discount choice and its validation", () => {
    for (const copy of [
      "Code",
      "Automatic",
      "Sale price",
      "Name (shown on receipts)",
      "Percent off",
      "Amount off",
      "Can combine with",
      "Nothing else",
      "Automatic discounts",
      "Any eligible discount",
      "Starts at (ISO date/time)",
      "Ends at (optional)",
      "Weekly schedule",
      "Total uses",
      "Per buyer",
      "End after N sold",
      "Minimum spend",
      "Preview",
    ])
      expect(source).toContain(copy);
    expect(source).toContain("/^[A-Z0-9]{4,16}$/");
    expect(source).toMatch(/\(draft\.valueBps \?\? 0\)\s*<=\s*10000/);
  });

  test("keeps automatic and sale-price creation behind rank 30", () => {
    expect(componentSource).toContain("canCreateDiscountKind(rank, kind)");
    expect(contractSource).toMatch(/kind === "code" \|\| rank >= 30/);
    expect(source).toContain(
      "You can create codes. Ask an owner, admin or finance manager",
    );
  });
});
