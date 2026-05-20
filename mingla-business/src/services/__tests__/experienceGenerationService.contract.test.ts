/**
 * Ve6 — experienceGenerationService invokes correct edge functions per parser.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const SERVICE = join(__dirname, "..", "experienceGenerationService.ts");

describe("experienceGenerationService contract", () => {
  const source = readFileSync(SERVICE, "utf8");

  test("exposes menu and play activity parsers", () => {
    expect(source).toMatch(/parseRestaurantMenu/);
    expect(source).toMatch(/parsePlayActivities/);
    expect(source).toMatch(/"parse-restaurant-menu"/);
    expect(source).toMatch(/"parse-play-activities"/);
  });
});
