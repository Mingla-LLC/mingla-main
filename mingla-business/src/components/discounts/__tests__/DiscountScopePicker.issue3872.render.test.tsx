import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";
import "./DiscountScopePicker.issue3872.behavior.test";

const componentSource = readFileSync(
  join(__dirname, "..", "DiscountScopePicker.tsx"),
  "utf8",
);
const contractSource = readFileSync(
  join(__dirname, "..", "discountUiContract.ts"),
  "utf8",
);
const source = `${componentSource}\n${contractSource}`;

describe("DiscountScopePicker Host contract", () => {
  test("renders supported listing kinds but never RSVP", () => {
    for (const kind of [
      "event",
      "experience",
      "trip",
      "venue_order",
      "reservation_deposit",
    ]) {
      expect(source).toContain(`["${kind}",`);
    }
    expect(source).not.toMatch(/\["rsvp",/);
  });

  test("disables opted-out items and identifies deleted targets", () => {
    expect(componentSource).toContain(
      "disabled={!isDiscountPriceSelectable(price)}",
    );
    expect(source).toContain("Discounts are off for this item");
    expect(contractSource).toContain(
      "targets.some((target) => target.orphanedAt != null)",
    );
    expect(source).toContain("Deleted item — remove it before saving.");
  });
});
