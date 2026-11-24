import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

const ROOT = path.resolve(__dirname, "../../..");
const source = (relativePath: string): string =>
  fs.readFileSync(path.resolve(ROOT, relativePath), "utf8");

const count = (value: string, pattern: RegExp): number =>
  value.match(pattern)?.length ?? 0;

describe("Issue #1363 production rework — stale hierarchy context", () => {
  test.each([
    ["components/venue/VenueStep1Address.tsx", "savedContextRef", 3],
    ["components/experience/ExperienceStopCard.tsx", "savedContextRef", 3],
    ["components/brand/PartnerClientBrandCreationFlow.tsx", "savedContextRef", 4],
  ])("%s clears saved city/country on edit, X, and Clear", (file, ref, minimum) => {
    const body = source(`mingla-business/src/${file}`);
    const resets = count(
      body,
      new RegExp(
        `${ref}\\.current\\s*=\\s*\\{\\s*city:\\s*null,\\s*countryCode:\\s*null,?\\s*\\}`,
        "g",
      ),
    );
    expect(resets).toBeGreaterThanOrEqual(minimum as number);
  });

  test("event/RSVP clears its saved city on edit, X, and Clear", () => {
    const body = source(
      "mingla-business/src/components/event/CreatorStep3Where.tsx",
    );
    expect(count(body, /savedCityRef\.current\s*=\s*null/g)).toBeGreaterThanOrEqual(
      3,
    );
  });

  // #4522 slice 12 — the published trip edit renders the create builder's
  // TripCreatorStep1Basics for its address fields and mounts no AddressInput
  // of its own, so the TripCreatorStep1Basics rows cover it.
  // EditPublishedTripScreen.render.test.tsx case (d) proves the tapped label
  // and place id reach the live update.
  test("the published trip edit reuses the create basics for its address fields", () => {
    const editScreen = source("mingla-business/src/components/trip/EditPublishedTripScreen.tsx");
    expect(editScreen).toContain("<TripCreatorStep1Basics");
    expect(editScreen).not.toMatch(/<AddressInput\b/);
  });

  test.each([
    ["components/trip/TripCreatorStep1Basics.tsx", 3],
  ])("%s clears both trip field contexts", (file, minimum) => {
    const body = source(`mingla-business/src/${file}`);
    for (const ref of ["departureContextRef", "destinationContextRef"]) {
      const resets = count(
        body,
        new RegExp(
          `${ref}\\.current\\s*=\\s*\\{\\s*city:\\s*null,\\s*countryCode:\\s*null,?\\s*\\}`,
          "g",
        ),
      );
      expect(resets).toBeGreaterThanOrEqual(minimum as number);
    }
  });
});
