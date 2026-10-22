import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = readFileSync(
  join(__dirname, "..", "DiscountScopePicker.tsx"),
  "utf8",
);

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
    expect(source).toContain("disabled={!price.discountsAllowed}");
    expect(source).toContain("Discounts are off for this item");
    expect(source).toContain("targets.some((target) => target.orphanedAt)");
    expect(source).toContain("Deleted item — remove it before saving.");
  });
});
