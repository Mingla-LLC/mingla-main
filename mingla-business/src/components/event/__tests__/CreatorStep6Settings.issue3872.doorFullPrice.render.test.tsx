import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";
import "./CreatorStep6Settings.issue3872.doorFullPrice.behavior.test";

const source = readFileSync(
  join(__dirname, "..", "CreatorStep6Settings.tsx"),
  "utf8",
);

describe("CreatorStep6Settings door-price disclosure", () => {
  test("renders only while in-person payments are enabled", () => {
    expect(source).toContain(
      "doorFullPriceNotice(draft.inPersonPaymentsEnabled) !== null",
    );
    expect(source).toContain('testID="event-door-full-price-note"');
    expect(source).toContain(
      "{doorFullPriceNotice(draft.inPersonPaymentsEnabled)}",
    );
  });
});
