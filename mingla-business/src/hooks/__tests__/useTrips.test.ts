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

  test("tripsService.publishTrip calls the canonical trip publish command (NOT event RPC)", () => {
    // [TEST-MOD-APPROVED #1719] Pin the new atomic poster wrapper instead of
    // the retired direct entry point; the event/trip separation is unchanged.
    // [TEST-MOD-APPROVED #1971] ONE assertion is invalidated: publish is now
    // `biz_publish_trip_command`, which loads the PERSISTED graph and delegates
    // to `issue_1719_publish_trip_with_poster` inside the same transaction. The
    // event/trip separation this test exists for is unchanged, and the negative
    // assertion against the event RPC is retained verbatim.
    expect(tripsServiceSource).toMatch(
      /supabase\.rpc\(\s*"biz_publish_trip_command"/,
    );
    expect(tripsServiceSource).not.toMatch(
      /supabase\.rpc\(\s*"business_publish_event_draft"/,
    );
  });

  test("tripsService.createTripDraft creates a trip through the canonical command", () => {
    // [TEST-MOD-APPROVED #1971] ONE assertion is invalidated: the client no
    // longer writes `event_type: "trip"` on an events insert, because it no
    // longer inserts. `biz_create_trip_draft` is trip-typed by construction, so
    // the rule is re-pinned where it now lives — and the client is additionally
    // pinned as having NO events insert at all, which the old regex could not
    // see.
    expect(tripsServiceSource).toMatch(
      /supabase\.rpc\(\s*"biz_create_trip_draft"/,
    );
    expect(tripsServiceSource).not.toMatch(
      /\.from\("events"\)\s*\n?\s*\.insert\(/,
    );
    const migration = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20270509001971_issue_1971_ari_trip_lifecycle.sql",
      ),
      "utf8",
    );
    const start = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.biz_create_trip_draft(",
    );
    expect(start).toBeGreaterThan(-1);
    expect(migration.slice(start, migration.indexOf("$fn$;", start))).toMatch(
      /'trip',\s*\n\s*'draft',/,
    );
  });

  test("tripKeys are immutable readonly literal tuples (cache discipline)", () => {
    // The `as const` suffix locks the tuple types so React Query gets
    // stable identity across re-renders.
    expect(useTripsSource).toMatch(/\["trips"\] as const/);
  });
});
