import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = readFileSync(
  join(__dirname, "..", "CreatorStep6Settings.tsx"),
  "utf8",
);

describe("CreatorStep6Settings door-price disclosure", () => {
  test("renders only while in-person payments are enabled", () => {
    expect(source).toMatch(
      /draft\.inPersonPaymentsEnabled \? \(\s*<Text[^>]+testID="event-door-full-price-note"/,
    );
    expect(source).toContain("Door sales are always full price.");
  });
});
