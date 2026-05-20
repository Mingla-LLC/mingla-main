/**
 * Ve6 — Hub experiences route category routing contract.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const ROUTE = join(__dirname, "..", "experiences.tsx");

describe("hub/experiences category router", () => {
  const source = readFileSync(ROUTE, "utf8");

  test("routes restaurant brands to menu parser and play to activities parser", () => {
    expect(source).toMatch(/venueCategory === "restaurant"/);
    expect(source).toMatch(/venueCategory === "play"/);
    expect(source).toMatch(/parseMode="menu"/);
    expect(source).toMatch(/parseMode="activities"/);
    expect(source).toMatch(/MenuSnapInput/);
    expect(source).toMatch(/ActivitiesSnapInput/);
    expect(source).toMatch(/canGenerateExperiencesFromActivities/);
  });

  test("does not block play venues with restaurant-only placeholder", () => {
    expect(source).not.toMatch(/Restaurant menu snap coming for your category/);
  });
});
