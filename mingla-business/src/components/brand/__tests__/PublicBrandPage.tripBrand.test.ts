/**
 * ORCH-0963 [Public brand page business-case optimization] T-03 happy-path.
 *
 * Source-grep contract test (existing PublicBrandPage tests use this style;
 * see PublicBrandPage.ve4.test.ts). Verifies kind-branched rendering:
 *   - isTripBrand constant is computed from brand.kind === 'trip_planner'
 *   - Tab labels switch when isTripBrand is true
 *   - UpcomingTripsTab + PastTripsTab dispatch only on trip-brand path
 *   - TripMiniCard primitive exists and is invoked in the trip-brand tab body
 *
 * Fails-on-revert: removing `const isTripBrand = brand.kind === "trip_planner"`
 * or the dispatch switch causes the contract assertions to FAIL.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("ORCH-0963 T-03 — PublicBrandPage kind-branched rendering (trip-brand)", () => {
  const pageSrc = readFileSync(
    join(__dirname, "..", "PublicBrandPage.tsx"),
    "utf8",
  );

  test("T-03a isTripBrand const derives from brand.kind === 'trip_planner'", () => {
    expect(pageSrc).toMatch(
      /const\s+isTripBrand\s*=\s*brand\.kind\s*===\s*"trip_planner"/,
    );
  });

  test("T-03b primaryTabLabel switches: 'Trips' (trip-brand) | 'Upcoming' (event-brand)", () => {
    expect(pageSrc).toMatch(
      /primaryTabLabel\s*=\s*isTripBrand\s*\?\s*"Trips"\s*:\s*"Upcoming"/,
    );
  });

  test("T-03c pastTabLabel switches: 'Past Trips' | 'Past'", () => {
    expect(pageSrc).toMatch(
      /pastTabLabel\s*=\s*isTripBrand\s*\?\s*"Past Trips"\s*:\s*"Past"/,
    );
  });

  test("T-03d tab body dispatches via isTripBrand inside the activeTab switch", () => {
    // Inside the activeTab === 'primary' branch, isTripBrand chooses
    // UpcomingTripsTab vs UpcomingEventsTab.
    expect(pageSrc).toMatch(
      /activeTab\s*===\s*"primary"\s*\?\s*\(\s*isTripBrand\s*\?\s*\(\s*<UpcomingTripsTab/,
    );
    // Inside activeTab === 'past', same isTripBrand choice.
    expect(pageSrc).toMatch(
      /activeTab\s*===\s*"past"\s*\?\s*\(\s*isTripBrand\s*\?\s*\(\s*<PastTripsTab/,
    );
  });

  test("T-03e UpcomingTripsTab renders TripMiniCard per trip row", () => {
    expect(pageSrc).toMatch(
      /UpcomingTripsTab[\s\S]*?trips\.map\(\(t\)\s*=>\s*\(\s*<TripMiniCard\s+key=\{t\.id\}/,
    );
  });

  test("T-03f PastTripsTab renders TripMiniCard with past flag + slice(0, PAST_TRIP_CAP)", () => {
    expect(pageSrc).toMatch(
      /PastTripsTab[\s\S]*?<TripMiniCard\s+key=\{t\.id\}[^>]*?past/,
    );
    expect(pageSrc).toMatch(/\.slice\(0,\s*PAST_TRIP_CAP\)/);
  });

  test("T-03g handleTripCardPress routes to tripPublicPath", () => {
    expect(pageSrc).toMatch(
      /handleTripCardPress[\s\S]*?tripPublicPath\(\s*\{\s*brandSlug:\s*trip\.brandSlug\s*,\s*tripSlug:\s*trip\.slug/,
    );
  });

  test("T-03h trip prop added to PublicBrandPageProps and threaded through", () => {
    expect(pageSrc).toMatch(
      /interface\s+PublicBrandPageProps\s*\{[\s\S]*?trips:\s*PublicTripCard\[\]/,
    );
  });
});
