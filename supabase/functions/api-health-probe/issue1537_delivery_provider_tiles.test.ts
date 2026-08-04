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
  "appsflyer",
  // #1537 P3-3(a): this list was first written FROM MEMORY and was wrong in two
  // ways — it carried `cloudinary`, which no longer exists (decommissioned in
  // the Bunny migration, META-ORCH-1270), and it omitted `bunny`, which
  // replaced it. T-6 still passed either way, which is precisely the hazard: a
  // stale snapshot inside the one test whose job is to prevent an FK violation
  // would have green-lit a `cloudinary` tile and let it abort every health
  // tick. Corrected against the 25 keys read read-only from production
  // (gqnoajqerqhnvulmnyvv, 2026-08-04), + `termii` from migration 20270212001538.
  "bunny",
  "exchangerate",
  "ga4",
  "gemini",
  "giphy",
  "google_places",
  "mapbox",
  "mixpanel",
  "onesignal_business",
  "onesignal_consumer",
  "openai",
  "paystack",
  "pexels",
  "posthog",
  "resend",
  "revenuecat",
  "sentry",
  "serper",
  "stripe",
  "supabase",
  "termii", // migration 20270212001538
  "thumio",
  "ticketmaster",
  "twilio",
  "vercel",
]);

/**
 * #1529's lesson, applied to a tally instead of a row list: assert the thing
 * counted SOMETHING before asserting what it counted. A tally that lost its
 * tile must fail with a named error, not as an incidental value mismatch.
 */
function assertTallyNotEmpty(
  tally: Map<string, { total: number; failure: number; skipped: number }>,
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
  assertEquals(termii.skipped, 0, "none of these were skips");
  assertEquals(termii.failure, 1, "only `failed` counts as a failure here");
});

// ---------------------------------------------------------------------------
// T-1b — THE GUARD ITSELF IS FALSIFIABLE.
// A vacuity guard that cannot fail is decoration. This proves it trips on the
// empty tally the pre-fix code actually produced.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-1b: the vacuity guard actually throws on an empty tally", () => {
  const empty = new Map<string, { total: number; failure: number; skipped: number }>();
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

  assertEquals(tally.get("resend"), { total: 9, failure: 0, skipped: 0 });
  assertEquals(tally.get("onesignal_consumer"), { total: 7, failure: 4, skipped: 0 });
  // #1537 P2-4 — this fixture is 5 `skipped` + 1 `delivered`. The five skips
  // performed no provider I/O, so exactly ONE attempt is counted; the skips are
  // preserved separately rather than inflating the health denominator.
  assertEquals(tally.get("twilio"), { total: 1, failure: 0, skipped: 5 });
  assertEquals(
    tally.get("termii"),
    { total: 2, failure: 1, skipped: 0 },
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
  assertEquals(tally.get("termii"), { total: 1, failure: 0, skipped: 0 });
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
  assertEquals(tally.get("termii"), { total: 1, failure: 0, skipped: 0 });
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
    { total: 1, failure: 0, skipped: 0 },
    "a Nigerian failure must NOT show up as Twilio ill-health",
  );
  assertEquals(tally.get("termii"), { total: 2, failure: 2, skipped: 0 });
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

// ---------------------------------------------------------------------------
// T-7 — A DELIBERATELY DARK MARKET MUST NOT READ AS "HEALTHY" (P2-4).
//
// This is the assertion that encodes the defect. `skipped` rows performed no
// provider I/O — the kill switch returns before the HTTP call — yet they used
// to raise a tile's `total` while never raising `failure`, making them
// arithmetically identical to successful deliveries. Six of them (exactly what
// a dark Nigeria produces) cleared the `total < 5` guard at a 0.0 failure rate
// and the tile reported HEALTHY while nothing whatsoever was being delivered.
//
// "Healthy" is a POSITIVE claim. Invisibility prompts "why is there no data?";
// "healthy" stops the question being asked at all. That makes this worse than
// the P1 it followed, and it is a Constitution rule 9 violation outright.
//
// The fix needs no new health state: excluding non-attempts puts a dark tile on
// total=0, which the handler's EXISTING `total < 5 ⇒ unknown` branch already
// reports honestly. `unknown` is exactly right — nothing was attempted, so
// nothing is known about the provider.
// ---------------------------------------------------------------------------

/** The handler's own threshold arithmetic (index.ts), mirrored for assertion. */
function tileStatus(t: { total: number; failure: number }): string {
  const failRate = t.total > 0 ? t.failure / t.total : 0;
  if (t.total < 5) return "unknown";
  if (failRate > 0.5) return "down";
  if (failRate >= 0.25) return "degraded";
  return "healthy";
}

Deno.test("#1537 T-7: a dark market reports `unknown`, never `healthy`", () => {
  // Exactly the rows a dark Nigeria produces: every send kill-switched.
  const darkNigeria = Array.from({ length: 6 }, () => ({
    provider: "termii",
    status: "skipped",
  }));

  const { tally } = tallyDeliveryRows(darkNigeria);
  assertTallyNotEmpty(tally, "a dark-Nigeria ledger");

  const t = tally.get("termii");
  assert(t !== undefined, "the tile must still exist — a dark market is not an absence");
  assertEquals(t.total, 0, "no attempt reached a provider, so nothing is counted");
  assertEquals(t.failure, 0);
  assertEquals(
    t.skipped,
    6,
    "the skips are PRESERVED, not discarded — the operator must still see that " +
      "six sends were requested and held back",
  );
  assertEquals(
    tileStatus(t),
    "unknown",
    "SIX kill-switch skips with zero deliveries must NOT read as `healthy` — " +
      "that is a positive false claim about a market that is entirely dark",
  );

  // The failure is specifically at 6 rows: 6 >= 5 cleared the volume guard, so
  // before the fix this was `healthy` rather than being shielded by `total < 5`.
  assert(darkNigeria.length >= 5, "fixture must clear the total<5 volume guard");

  // `suppressed` shares the property — a can_send denial also never reached a
  // provider — so it must behave identically.
  const suppressedOnly = tallyDeliveryRows(
    Array.from({ length: 6 }, () => ({ provider: "twilio", status: "suppressed" })),
  );
  const s = suppressedOnly.tally.get("twilio");
  assert(s !== undefined, "a suppressed-only tile must still exist");
  assertEquals(s.total, 0);
  assertEquals(s.skipped, 6);
  assertEquals(tileStatus(s), "unknown", "policy suppression is not health either");
});

// ---------------------------------------------------------------------------
// T-8 — REAL DELIVERIES STILL DRIVE HEALTH. The control for T-7: excluding
// non-attempts must not make a genuinely failing provider look fine, nor a
// genuinely healthy one look unknown.
// ---------------------------------------------------------------------------
Deno.test("#1537 T-8: skips do not mask a real outage, nor suppress a real healthy signal", () => {
  // A provider that is live and failing, while also skipping some sends.
  const failing = tallyDeliveryRows([
    ...Array.from({ length: 20 }, () => ({ provider: "termii", status: "skipped" })),
    ...Array.from({ length: 6 }, () => ({ provider: "termii", status: "failed" })),
    { provider: "termii", status: "delivered" },
  ]);
  const f = failing.tally.get("termii");
  assert(f !== undefined);
  assertEquals(f.total, 7, "only the 7 real attempts count");
  assertEquals(f.failure, 6);
  assertEquals(f.skipped, 20);
  assertEquals(
    tileStatus(f),
    "down",
    "20 skips must NOT dilute a 6/7 failure rate into looking healthy — " +
      "which is exactly what counting them in the denominator did (26 rows, " +
      "6 failures = 0.23, just under the 0.25 degraded threshold)",
  );

  // And a genuinely healthy provider still reads healthy.
  const healthy = tallyDeliveryRows(
    Array.from({ length: 10 }, () => ({ provider: "twilio", status: "delivered" })),
  );
  const h = healthy.tally.get("twilio");
  assert(h !== undefined);
  assertEquals(tileStatus(h), "healthy", "real successful deliveries still read healthy");
  assertEquals(h.skipped, 0);
});
