/**
 * #4334 F-7 — the published-trip editor READS coordinate precision from a real
 * pick (#1629) instead of hardcoding "approximate" (matrix R-PREC-3).
 * Fails-on-revert: restore `departureCoordinatePrecision: "approximate",` or
 * `destinationCoordinatePrecision: "approximate",` inside onPick → red.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";
import { precisionFromPlaceDetails } from "@mingla/location-input";

const src = fs.readFileSync(path.resolve(__dirname, "../EditPublishedTripScreen.tsx"), "utf8");

/** Every `onPick={(place, ...) => { ... }}` body in the screen. */
function onPickBodies(): string[] {
  const bodies: string[] = [];
  let at = src.indexOf("onPick={(place");
  while (at !== -1) {
    const end = src.indexOf("}}", at);
    bodies.push(src.slice(at, end));
    at = src.indexOf("onPick={(place", end);
  }
  return bodies;
}

describe("#4334 F-7 — published trip editor precision", () => {
  test("both pickers read the precision from the pick", () => {
    const bodies = onPickBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain("departureCoordinatePrecision: precisionFromPlaceDetails(place)");
    expect(bodies[1]).toContain("destinationCoordinatePrecision: precisionFromPlaceDetails(place)");
    for (const body of bodies) expect(body).not.toContain('CoordinatePrecision: "approximate"');
  });

  test("a street address pick saves exact, an area saves approximate", () => {
    expect(precisionFromPlaceDetails({ featureType: "address" })).toBe("exact");
    expect(precisionFromPlaceDetails({ featureType: "poi" })).toBe("exact");
    expect(precisionFromPlaceDetails({ featureType: "place" })).toBe("approximate");
  });
});
