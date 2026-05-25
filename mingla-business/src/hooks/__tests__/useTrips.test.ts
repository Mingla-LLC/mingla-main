/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] — useTrips structural contract test.
 *
 * Source-grep style (mirrors ORCH-0855 Tr1 pattern at
 * BrandSwitcherSheet.personaFork.test.ts). Validates:
 *   - tripKeys factory exports + builds correctly partitioned keys
 *   - All 6 mutation hooks exported (createTripDraft + updateBasics +
 *     upsertDays + upsertInclusions + updatePricing + publishTrip + softDelete)
 *   - publishTrip mutation calls business_publish_trip_draft (NOT event RPC)
 *
 * Why source-grep instead of import-and-call: useTrips → tripsService →
 * supabase pulls in expo-constants + react-native which don't load cleanly
 * under jest's node testEnvironment (mirrors Tr1 limitation).
 *
 * Fails-on-revert: if tripKeys factory partitioning is lost or the publish
 * mutation is rewired to the event RPC, these assertions fail.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const useTripsSource = readFileSync(
  join(__dirname, "..", "useTrips.ts"),
  "utf-8",
);
const tripsServiceSource = readFileSync(
  join(__dirname, "..", "..", "services", "tripsService.ts"),
  "utf-8",
);

describe("ORCH-0859 — useTrips structural contract", () => {
  test("tripKeys factory exported with all 6 partitions", () => {
    expect(useTripsSource).toMatch(/export const tripKeys = \{/);
    expect(useTripsSource).toMatch(/all: \["trips"\]/);
    expect(useTripsSource).toMatch(/lists:/);
    expect(useTripsSource).toMatch(/listByBrand:/);
    expect(useTripsSource).toMatch(/details:/);
    expect(useTripsSource).toMatch(/detail:/);
    expect(useTripsSource).toMatch(/soldCountsByTier:/);
    expect(useTripsSource).toMatch(/publicBySlug:/);
  });

  test("All 6 mutation hooks exported", () => {
    expect(useTripsSource).toMatch(/export const useCreateTripDraft/);
    expect(useTripsSource).toMatch(/export const useUpdateTripBasics/);
    expect(useTripsSource).toMatch(/export const useUpsertTripDays/);
    expect(useTripsSource).toMatch(/export const useUpsertTripInclusions/);
    expect(useTripsSource).toMatch(/export const useUpdateTripPricing/);
    expect(useTripsSource).toMatch(/export const usePublishTrip/);
    expect(useTripsSource).toMatch(/export const useSoftDeleteTrip/);
  });

  test("Query hooks exported (useTripsByBrand + useTrip)", () => {
    expect(useTripsSource).toMatch(/export const useTripsByBrand/);
    expect(useTripsSource).toMatch(/export const useTrip\b/);
  });

  test("tripsService.publishTrip calls business_publish_trip_draft RPC (NOT event RPC)", () => {
    expect(tripsServiceSource).toMatch(
      /supabase\.rpc\(\s*"business_publish_trip_draft"/,
    );
    expect(tripsServiceSource).not.toMatch(
      /supabase\.rpc\(\s*"business_publish_event_draft"/,
    );
  });

  test("tripsService.createTripDraft inserts event_type='trip'", () => {
    expect(tripsServiceSource).toMatch(/event_type:\s*"trip"/);
  });

  test("tripKeys are immutable readonly literal tuples (cache discipline)", () => {
    // The `as const` suffix locks the tuple types so React Query gets
    // stable identity across re-renders.
    expect(useTripsSource).toMatch(/\["trips"\] as const/);
  });
});
