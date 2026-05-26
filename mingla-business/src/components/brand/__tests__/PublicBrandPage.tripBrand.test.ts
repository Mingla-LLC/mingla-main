/**
 * ORCH-0963 → META-ORCH-0972 Sub-C public brand page contract.
 *
 * The old ORCH-0963 test intentionally locked a brand-kind branch. Sub-C
 * replaces that with data-driven tabs: trips render when trip rows exist, not
 * when a brand type says they should.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("META-ORCH-0972 — PublicBrandPage trip rendering is data-driven", () => {
  const pageSrc = readFileSync(
    join(__dirname, "..", "PublicBrandPage.tsx"),
    "utf8",
  );

  test("T-03a visibleTabs includes trips from trip data only", () => {
    expect(pageSrc).toMatch(/const\s+visibleTabs\s*=\s*useMemo<PublicTab\[\]>/);
    expect(pageSrc).toContain('tabs.push("trips")');
    expect(pageSrc).toMatch(/upcomingTrips\.length\s*>\s*0\s*\|\|\s*pastTrips\.length\s*>\s*0/);
    expect(pageSrc).not.toContain("isTrip" + "Brand");
    expect(pageSrc).not.toContain("brand" + ".kind");
  });

  test("T-03b TripsTab renders upcoming and past TripMiniCard rows", () => {
    expect(pageSrc).toMatch(/const\s+TripsTab[\s\S]*?trips\.map\(\(t\)\s*=>/);
    expect(pageSrc).toMatch(/pastTrips\.map\(\(t\)\s*=>[\s\S]*?<TripMiniCard[^>]*past/);
  });

  test("T-03c trip routing still uses tripPublicPath", () => {
    expect(pageSrc).toMatch(
      /handleTripCardPress[\s\S]*?tripPublicPath\(\s*\{\s*brandSlug:\s*trip\.brandSlug\s*,\s*tripSlug:\s*trip\.slug/,
    );
  });

  test("T-03d trip prop remains threaded into PublicBrandPage", () => {
    expect(pageSrc).toMatch(
      /interface\s+PublicBrandPageProps\s*\{[\s\S]*?trips:\s*PublicTripCard\[\]/,
    );
  });
});
