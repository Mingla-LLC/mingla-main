/*
 * #4453 — Studio accepts UTC for offerings, routes and settings, but a venue
 * clock (hours_location) still needs a real city.
 */
import { describe, expect, it } from "vitest";
import { safeCityTimeZone, safeTimeZone } from "./validation";

describe("#4453 Studio timezone validators", () => {
  it("safeTimeZone accepts UTC, GMT and a city, and refuses legacy aliases", () => {
    for (const zone of ["UTC", "GMT", "Europe/Paris", "", null]) expect(safeTimeZone(zone)).toBe(true);
    for (const zone of ["EST", "utc", "GMT+1", "Mars/Olympus_Mons"]) expect(safeTimeZone(zone)).not.toBe(true);
  });
  it("safeCityTimeZone refuses bare UTC but takes a city", () => {
    expect(safeCityTimeZone("UTC")).not.toBe(true);
    expect(safeCityTimeZone("Africa/Lagos")).toBe(true);
    expect(safeCityTimeZone("")).toBe(true);
  });
});
