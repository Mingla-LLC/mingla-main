// Issue #1537 (rework) — LAYER-C PROVIDER → TILE MAPPING.
//
// IMPLEMENTOR HAPPY-PATH REGRESSION TEST for tester finding P1-1.
//
// WHY THIS EXISTS. `api-health-probe` is the ONLY live reader of
// `notification_deliveries.provider` in the repo. Its provider ladder had
// `onesignal` / `resend` / `twilio` arms and a bare `: []` fallback. When #1537
// made the ledger record `termii` for Nigerian SMS instead of a hardcoded
// `twilio`, those rows fell through to `[]` and the `for (const tile of tiles)`
// loop iterated ZERO times.
//
// The regression that created is the whole point: BEFORE #1537 Nigerian rows
// were mislabelled `twilio` and were still COUNTED; AFTER #1537 they are
// labelled honestly and counted NOWHERE. Nigerian SMS health went from
// wrong-but-visible to invisible, at exactly the moment Nigeria switches on.
//
// It shipped unnoticed because the mapping was structurally untestable —
// `index.ts` calls `serve()` unguarded at module scope, so nothing in that file
// can be imported. The ladder now lives in `logic.ts`, which is why this file
// can exist at all.
//
// WHAT THIS PINS:
//   T-1  a termii-ONLY fixture produces a NON-EMPTY tally on the termii tile
//        (the exact case that produced nothing before);
//   T-2  every provider the ledger can hold maps somewhere, with correct counts;
//   T-3  an unmapped provider is reported LOUDLY, not silently dropped —
//        `deliveryProviderTiles` returns null, never [];
//   T-4  null-provider rows (inapp) stay skipped and are NOT mislabelled as an
//        unmapped-provider gap;
//   T-5  termii is its own tile and does NOT contaminate the twilio tile;
//   T-6  every tile the map can emit is a real registered service_key — an
//        unregistered tile would fail the probe's whole batch insert (FK).
//
// TEST DISCIPLINE. The tester's P2-1 finding on my previous suite was that a
// test can pass while the thing it names is broken, because it asserted on a
// value another code path had already written. So T-1 here does not merely
// assert `tally.get("termii")?.total === 3`: an empty tally would make that
// `undefined === 3` and fail, but a tally that silently lost the tile would be
// indistinguishable from one that never had it. The VACUITY GUARD asserts
// `tally.size > 0` FIRST and separately, before any content assertion, so
// "counted nothing" fails as its own named error rather than as a confusing
// value mismatch. `assertVacuityGuardTrips` below then proves the guard itself
// is falsifiable by running it against a deliberately-empty tally.
//
// fails-on-revert: deleting the `termii: ["termii"]` arm from
// DELIVERY_PROVIDER_TILES sends termii back to the unmapped branch — T-1's
// vacuity guard fails, T-2/T-5 fail, and T-3's unmapped list gains "termii".
// Restoring the bare `: []` fallback (returning [] instead of null) fails T-3.
//
// Append-only: NEW file; no existing test modified.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  DELIVERY_PROVIDER_TILES,
  type DeliveryLedgerRow,
  deliveryProviderTiles,
  tallyDeliveryRows,
} from "./logic.ts";

// The service keys seeded in api_health_services. `termii` is added by
// migration 20270212001538; the rest by 20261120000000. Kept here so T-6 can
// prove no tile can be emitted for a key that does not exist — the probe
// inserts a tick's rows in ONE batch against an FK, so an unregistered tile
// fails EVERY row, not just its own.
const REGISTERED_SERVICE_KEYS = new Set([
  "stripe",
  "paystack",
  "gemini",
  "openai",
  "mapbox",
  "google_places",
  "ticketmaster",
  "serper",
  "pexels",
  "giphy",
  "onesignal_consumer",
  "onesignal_business",
  "resend",
  "twilio",
  "termii", // migration 20270212001538
  "cloudinary",
  "supabase",
  "vercel",
  "exchangerate",
  "thumio",
  "revenuecat",
  "posthog",
  "mixpanel",
  "sentry",
  "appsflyer",
  "ga4",
]);

/**
 * #1529's lesson, applied to a tally instead of a row list: assert the thing
 * counted SOMETHING before asserting what it counted. A tally that lost its
 * tile must fail with a named error, not as an incidental value mismatch.
 */
function assertTallyNotEmpty(
  tally: Map<string, { total: number; failure: number }>,
  label: string,
): void {
  assert(
    tally.size > 0,
    `VACUITY GUARD: ${label} produced an EMPTY tally — the rows were counted ` +
      `nowhere. This is the exact P1-1 failure: a provider that no arm maps ` +
      `falls out of the health tally entirely instead of surfacing.`,
  );
}

// ---------------------------------------------------------------------------
// T-1 — THE P1-1 REPRODUCTION. A termii-only ledger must produce a real tally.
// Before the fix this produced {} and Nigerian SMS health was invisible.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-1: a termii-ONLY ledger produces a NON-EMPTY tally on the termii tile", () => {
  const rows: DeliveryLedgerRow[] = [
    { provider: "termii", status: "delivered" },
    { provider: "termii", status: "sent" },
    { provider: "termii", status: "failed" },
  ];

  const { tally, unmappedProviders } = tallyDeliveryRows(rows);

  // Vacuity guard FIRST, and on its own: "counted nothing" must fail as itself.
  assertTallyNotEmpty(tally, "a termii-only ledger");

  assertEquals(
    unmappedProviders,
    [],
    "termii must be a MAPPED provider, not reported as a gap",
  );
  const termii = tally.get("termii");
  assert(termii !== undefined, "the termii tile must exist in the tally");
  assertEquals(termii.total, 3);
  assertEquals(termii.failure, 1, "only `failed` counts as a failure here");
});

// ---------------------------------------------------------------------------
// T-1b — THE GUARD ITSELF IS FALSIFIABLE.
// A vacuity guard that cannot fail is decoration. This proves it trips on the
// empty tally the pre-fix code actually produced.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-1b: the vacuity guard actually throws on an empty tally", () => {
  const empty = new Map<string, { total: number; failure: number }>();
  const err = assertThrows(
    () => assertTallyNotEmpty(empty, "a deliberately empty tally"),
    Error,
    "VACUITY GUARD",
  );
  assert(
    String(err).includes("counted nowhere"),
    "the guard must name the failure, not merely throw",
  );

  // And the pre-fix behaviour end-to-end: had `termii` stayed unmapped, the
  // termii-only fixture from T-1 would have produced exactly this empty tally.
  const asIfUnmapped = tallyDeliveryRows([
    { provider: "a_provider_nobody_mapped", status: "delivered" },
  ]);
  assertEquals(
    asIfUnmapped.tally.size,
    0,
    "an unmapped provider contributes nothing to the tally — which is why it " +
      "must be reported loudly instead",
  );
  assertThrows(() => assertTallyNotEmpty(asIfUnmapped.tally, "unmapped-only"));
});

// ---------------------------------------------------------------------------
// T-2 — every provider the ledger can actually hold is counted somewhere.
// Fixture mirrors the real production ledger shape (31 rows, verified by the
// tester) plus the termii rows that Nigeria going live will produce.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-2: every real ledger provider lands on a tile with correct counts", () => {
  const rows: DeliveryLedgerRow[] = [
    ...Array(9).fill({ provider: "resend", status: "sent" }),
    ...Array(4).fill({ provider: "onesignal", status: "failed" }),
    ...Array(3).fill({ provider: "onesignal", status: "sent" }),
    ...Array(5).fill({ provider: "twilio", status: "skipped" }),
    { provider: "twilio", status: "delivered" },
    { provider: "termii", status: "delivered" },
    { provider: "termii", status: "undelivered" },
  ];

  const { tally, unmappedProviders } = tallyDeliveryRows(rows);
  assertTallyNotEmpty(tally, "the full production-shaped ledger");
  assertEquals(unmappedProviders, []);

  assertEquals(tally.get("resend"), { total: 9, failure: 0 });
  assertEquals(tally.get("onesignal_consumer"), { total: 7, failure: 4 });
  assertEquals(tally.get("twilio"), { total: 6, failure: 0 });
  assertEquals(
    tally.get("termii"),
    { total: 2, failure: 1 },
    "`undelivered` counts as a failure; `delivered` does not",
  );
});

// ---------------------------------------------------------------------------
// T-3 — THE LOUD FALLBACK. An unmapped provider must SURFACE, not vanish.
// This is the anti-recurrence assertion: the bare `: []` is the same
// silently-dropped-value shape as #1529's `?? "US"` and #1537's own hardcoded
// provider constant.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-3: an unmapped provider is reported loudly, and never returns []", () => {
  // null, not [] — [] is silently indistinguishable from "mapped to nothing".
  assertEquals(
    deliveryProviderTiles("some_future_provider"),
    null,
    "an unrecognised provider must return null so the caller MUST handle it",
  );
  assert(
    Array.isArray(deliveryProviderTiles("termii")),
    "a mapped provider still returns an array",
  );

  const { tally, unmappedProviders } = tallyDeliveryRows([
    { provider: "termii", status: "delivered" },
    { provider: "some_future_provider", status: "delivered" },
    { provider: "some_future_provider", status: "failed" },
    { provider: "another_unmapped", status: "sent" },
  ]);

  assertTallyNotEmpty(tally, "a mixed mapped/unmapped ledger");
  // The mapped provider is still counted — one unmapped provider must not
  // suppress the rest of the tally.
  assertEquals(tally.get("termii"), { total: 1, failure: 0 });
  // The unmapped ones are named, de-duplicated and sorted, so the handler's
  // structuredLog names exactly what it cannot see.
  assertEquals(unmappedProviders, ["another_unmapped", "some_future_provider"]);
});

// ---------------------------------------------------------------------------
// T-4 — a null provider is a LEGITIMATE absence (inapp rows), not a gap.
// Reporting it as unmapped would make the loud path cry wolf on every tick,
// which is how loud signals get ignored.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-4: null-provider rows are skipped without being reported as unmapped", () => {
  const { tally, unmappedProviders, nullProviderRows } = tallyDeliveryRows([
    { provider: null, status: "delivered" },
    { provider: "   ", status: "delivered" },
    { provider: "termii", status: "delivered" },
  ]);

  assertTallyNotEmpty(tally, "a ledger containing null-provider rows");
  assertEquals(tally.get("termii"), { total: 1, failure: 0 });
  assertEquals(
    unmappedProviders,
    [],
    "an inapp row has no provider by design — it is not an unmapped provider",
  );
  assertEquals(nullProviderRows, 2);
  assertEquals(tally.size, 1, "null-provider rows create no tile");
});

// ---------------------------------------------------------------------------
// T-5 — termii is its own tile. Folding it into `twilio` would recreate exactly
// the mislabelling #1537 removed, and a Termii outage would page for Twilio.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-5: termii does not contaminate the twilio tile", () => {
  const { tally } = tallyDeliveryRows([
    { provider: "termii", status: "failed" },
    { provider: "termii", status: "failed" },
    { provider: "twilio", status: "delivered" },
  ]);

  assertTallyNotEmpty(tally, "a mixed termii/twilio ledger");
  assertEquals(
    tally.get("twilio"),
    { total: 1, failure: 0 },
    "a Nigerian failure must NOT show up as Twilio ill-health",
  );
  assertEquals(tally.get("termii"), { total: 2, failure: 2 });
});

// ---------------------------------------------------------------------------
// T-6 — every emittable tile is a REGISTERED service_key.
// api_health_checks.service_key is FK-constrained and the probe inserts a
// tick's rows in ONE batch, so an unregistered tile does not lose its own row —
// it loses EVERY row for that tick, across every service and layer.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-6: every tile the map can emit is a registered api_health_services key", () => {
  const tiles = Object.values(DELIVERY_PROVIDER_TILES).flatMap((t) => [...t]);
  assert(
    tiles.length > 0,
    "VACUITY GUARD: no tiles to check — the map is empty and this test would " +
      "pass by examining nothing",
  );
  for (const tile of tiles) {
    assert(
      REGISTERED_SERVICE_KEYS.has(tile),
      `tile "${tile}" is not a registered api_health_services key. ` +
        `api_health_checks.service_key is FK-constrained and the probe inserts ` +
        `the whole tick in one batch, so this would fail EVERY check row.`,
    );
  }
  assert(
    tiles.includes("termii"),
    "the termii tile must be emittable — its absence is the P1-1 defect",
  );
});
