/**
 * ORCH-0950 expanded adversarial scaffold.
 *
 * Tester owns final runtime/mock assertions, but this source-contract scaffold
 * pins the reader direction: dashboard-facing TripBusinessTrip fields must be
 * sourced from canonical ticket_types/event_dates/events.destination_text
 * values, not residual theme.business_trip JSONB.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const tripsServiceSource = readFileSync(
  join(__dirname, "..", "tripsService.ts"),
  "utf-8",
);
const tripDashboardSource = readFileSync(
  join(__dirname, "..", "..", "..", "app", "trip", "[id]", "index.tsx"),
  "utf-8",
);

describe("ORCH-0950 expanded — dashboard reader canonical source scaffold", () => {
  test("readBusinessTrip accepts canonical date/destination inputs", () => {
    expect(tripsServiceSource).toMatch(/canonicalStartAt:\s*string \| null/);
    expect(tripsServiceSource).toMatch(/canonicalEndAt:\s*string \| null/);
    expect(tripsServiceSource).toMatch(/canonicalDestination:\s*string \| null/);
  });

  test("readBusinessTrip returns canonical values over business_trip JSONB residue", () => {
    expect(tripsServiceSource).toMatch(/startAt:\s*canonicalStartAt/);
    expect(tripsServiceSource).toMatch(/endAt:\s*canonicalEndAt/);
    expect(tripsServiceSource).toMatch(
      /destinationLocationText:\s*canonicalDestination/,
    );
    expect(tripsServiceSource).toMatch(/capacity:\s*ticketCapacity/);
  });

  test("getTrip fetches the master event_dates row for dashboard detail", () => {
    expect(tripsServiceSource).toMatch(/\.from\("event_dates"\)/);
    expect(tripsServiceSource).toMatch(/\.eq\("is_master", true\)/);
    expect(tripsServiceSource).toMatch(/masterDate\?\.start_at/);
    expect(tripsServiceSource).toMatch(/masterDate\?\.end_at/);
  });

  test("per-tier sold counts read from the canonical RPC", () => {
    expect(tripsServiceSource).toMatch(/readTripSoldCountsByTier/);
    expect(tripsServiceSource).toMatch(
      /supabase\.rpc\("biz_trip_tickets_sold_by_tier"/,
    );
  });

  test("visible dashboard uses the ORCH-0950 display helpers", () => {
    expect(tripDashboardSource).toMatch(/formatTripHeroSubline/);
    expect(tripDashboardSource).toMatch(/formatTripSpotsLabel/);
    expect(tripDashboardSource).toMatch(/resolveTripTierSoldCount/);
    expect(tripDashboardSource).toMatch(/tripDashboardBundleProofTestID/);
    expect(tripDashboardSource).toMatch(
      /orch-0950-trip-dashboard-spots-value/,
    );
  });
});
