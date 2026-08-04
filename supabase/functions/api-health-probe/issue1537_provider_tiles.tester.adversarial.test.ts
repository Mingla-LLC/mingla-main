// Issue #1537 (rework) — LAYER-C PROVIDER → TILE MAPPING.
//
// TESTER ADVERSARIAL SUITE. Hostile to, and independent of, the implementor's
// `issue1537_delivery_provider_tiles.test.ts` (T-1..T-6).
//
// ===========================================================================
// WHAT THIS ATTACKS THAT THE IMPLEMENTOR'S FILE DOES NOT
// ===========================================================================
// The implementor's suite proves the mapping is CORRECT for the four providers
// it knows about. This suite attacks what happens at the edges of that map,
// where the original P1 lived — a provider nobody thought about.
//
//   R-1  CONSERVATION. Every input row must be accounted for EXACTLY once,
//        across tallied + unmapped + null. The original bug was a row that fell
//        through the ladder and was counted nowhere; a per-provider assertion
//        cannot catch that class, because it only ever looks where it expects
//        to find something. A conservation invariant looks at what is MISSING.
//
//   R-2  PROTOTYPE KEYS. `notification_deliveries.provider` is `text` with NO
//        CHECK constraint (verified read-only against production), so it can
//        hold literally any string — including `constructor`, `__proto__` and
//        `toString`. Under a naive `map[provider]` lookup those resolve to
//        inherited Object members rather than undefined, and the tile loop
//        would iterate over a function. The implementation uses `Object.hasOwn`,
//        which is correct; this pins it, because the failure mode is silent and
//        the column is genuinely unconstrained.
//
//   R-3  CASE AND WHITESPACE. The map is exact-match. A ledger writer that ever
//        emitted `Termii` must surface as UNMAPPED (loud), never be silently
//        mapped or silently dropped.
//
//   R-4  KILL-SWITCH SKIPS ARE NOT PROVIDER HEALTH. Documents a real defect
//        found during this retest — see the block above R-4.
//
//   R-5  UNMAPPED REPORTING CONTRACT — distinct and sorted, as the interface
//        promises, with duplicates and reverse-ordered input.
//
//   R-6  THE MIGRATION DEPENDENCY IS EXACT. `termii` is the ONLY tile this
//        change adds that is not already a registered service, so migration
//        20270212001538 is the complete and only DB dependency. A future tile
//        added without a migration breaks this.
//
// Append-only: NEW file. No existing test file is modified.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  DELIVERY_FAIL_STATUSES,
  DELIVERY_PROVIDER_TILES,
  type DeliveryLedgerRow,
  deliveryProviderTiles,
  tallyDeliveryRows,
} from "./logic.ts";

/**
 * The `api_health_services.service_key` set as it exists in PRODUCTION TODAY —
 * read read-only from gqnoajqerqhnvulmnyvv on 2026-08-04, BEFORE migration
 * 20270212001538 is applied. 25 rows. `termii` is deliberately absent, because
 * that is the current state of the database.
 */
const REGISTERED_BEFORE_MIGRATION: ReadonlySet<string> = new Set([
  "appsflyer",
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
  "thumio",
  "ticketmaster",
  "twilio",
  "vercel",
]);

const row = (provider: string | null, status = "sent"): DeliveryLedgerRow => ({
  provider,
  status,
});

// ===========================================================================
// R-1 — CONSERVATION. Every row accounted for exactly once.
// This is the assertion shape that would have caught the original P1: it does
// not ask "is termii counted?", it asks "is anything UNACCOUNTED FOR?".
// ===========================================================================
Deno.test("#1537 R-1: every ledger row is accounted for exactly once (conservation)", () => {
  const rows: DeliveryLedgerRow[] = [
    row("termii"),
    row("termii", "failed"),
    row("twilio"),
    row("resend"),
    row("onesignal"),
    row(null), // inapp
    row(null),
    row("nexmo"), // unmapped
    row("nexmo"),
    row("sinch"), // unmapped
  ];

  const { tally, unmappedProviders, nullProviderRows } = tallyDeliveryRows(rows);

  // Vacuity guard FIRST: a tally that silently emptied would make every
  // count below trivially "consistent" at zero.
  assert(tally.size > 0, "VACUITY: the tally is empty — nothing was counted");

  let tallied = 0;
  for (const entry of tally.values()) tallied += entry.total;

  // Rows whose provider was unmapped — recomputed from the input, NOT from the
  // result, so the two are independent.
  const unmappedRowCount = rows.filter((r) => {
    const p = r.provider?.trim();
    return !!p && deliveryProviderTiles(p) === null;
  }).length;

  assertEquals(nullProviderRows, 2, "null-provider rows");
  assertEquals(unmappedRowCount, 3, "rows carrying an unmapped provider");
  assertEquals(tallied, 5, "rows that reached a tile");
  assertEquals(
    tallied + unmappedRowCount + nullProviderRows,
    rows.length,
    "CONSERVATION VIOLATED: a row was counted twice or vanished. This is the " +
      "exact class of the #1537 P1 — a provider that fell through the ladder " +
      "and was recorded nowhere.",
  );

  // And the unmapped ones must be REPORTED, not merely excluded.
  assertEquals(unmappedProviders, ["nexmo", "sinch"]);
  assertEquals(tally.get("termii")?.total, 2);
  assertEquals(tally.get("termii")?.failure, 1);
});

// ===========================================================================
// R-2 — PROTOTYPE KEYS. `provider` is unconstrained text in production.
// ===========================================================================
Deno.test("#1537 R-2: inherited Object keys resolve to null, not to a prototype member", () => {
  const hostile = [
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "prototype",
  ];
  let checked = 0;
  for (const key of hostile) {
    const tiles = deliveryProviderTiles(key);
    assertEquals(
      tiles,
      null,
      `"${key}" must be reported as unmapped, not resolved off the prototype`,
    );
    checked += 1;
  }
  assertEquals(checked, hostile.length, "every hostile key must be exercised");

  // End to end: they must be REPORTED as unmapped, and must not corrupt the
  // tally or throw. A naive `map[provider]` lookup would iterate a function
  // here and produce garbage tiles.
  const { tally, unmappedProviders, nullProviderRows } = tallyDeliveryRows(
    hostile.map((k) => row(k)),
  );
  assertEquals(tally.size, 0, "no tile may be created from a prototype key");
  assertEquals(nullProviderRows, 0);
  assertEquals(unmappedProviders, [...hostile].sort());
});

// ===========================================================================
// R-3 — CASE AND WHITESPACE.
// ===========================================================================
Deno.test("#1537 R-3: casing drift surfaces as UNMAPPED, never silently mapped or dropped", () => {
  const { tally, unmappedProviders } = tallyDeliveryRows([
    row("Termii"),
    row("TERMII"),
    row("Twilio"),
  ]);
  assertEquals(
    tally.size,
    0,
    "exact-match is the contract — a cased variant must not reach a tile",
  );
  assertEquals(
    unmappedProviders,
    ["TERMII", "Termii", "Twilio"],
    "and it must be REPORTED, so casing drift is visible instead of silent",
  );

  // Whitespace is trimmed, so a padded provider still maps correctly...
  const padded = tallyDeliveryRows([row("  termii  ")]);
  assertEquals(padded.tally.get("termii")?.total, 1);
  assertEquals(padded.unmappedProviders, []);

  // ...but a blank/whitespace-only provider is an ABSENCE, not an unmapped
  // provider. Reporting "" as an unmapped provider would be a false alarm.
  const blank = tallyDeliveryRows([row(""), row("   "), row(null)]);
  assertEquals(blank.nullProviderRows, 3);
  assertEquals(blank.unmappedProviders, [], "blank is absence, not a gap");
  assertEquals(blank.tally.size, 0);
});

// ===========================================================================
// R-4 — KILL-SWITCH SKIPS ARE COUNTED AS NON-FAILURES.
//
// DOCUMENTS A DEFECT FOUND IN THIS RETEST (tester finding P2-4).
//
// `DELIVERY_FAIL_STATUSES` is {failed, undelivered}, and `entry.total`
// increments for EVERY mapped row regardless of status. A `skipped` row —
// which is what EVERY Nigerian send produces while `sms_live_enabled.ng` is
// off — therefore raises `total` while leaving `failure` at zero.
//
// Consequence, using the handler's own thresholds (index.ts: total<5 =>
// unknown, failRate>0.5 => down, >=0.25 => degraded, else healthy): once five
// kill-switch skips land in a 24h window, the termii tile reports HEALTHY
// while Nigeria is entirely dark and not one message has been delivered.
// "Healthy" is a positive assertion, which makes this worse than the
// invisibility the P1 fixed.
//
// The semantic is PRE-EXISTING (it applied to twilio/resend skips before this
// change; production holds 3 sms and 2 email `skipped/no_contact` rows). The
// rework elevates its impact by creating a tile whose DOMINANT input, today,
// is kill-switch skips.
//
// This test pins CURRENT behaviour so it cannot change silently. When the
// defect is fixed — skips should not count toward a provider's health in
// either direction — this test must be updated deliberately.
// ===========================================================================
Deno.test("#1537 R-4: kill-switch skips inflate the tile total at zero failures (DEFECT, pinned)", () => {
  // Exactly the rows a dark Nigeria produces today.
  const darkNigeria = Array.from(
    { length: 6 },
    () => row("termii", "skipped"),
  );
  const { tally } = tallyDeliveryRows(darkNigeria);

  const t = tally.get("termii");
  assert(t, "VACUITY: no termii tile was produced");
  assertEquals(t!.total, 6, "skips are counted toward the total");
  assertEquals(
    t!.failure,
    0,
    "and never toward failure — because `skipped` is not in DELIVERY_FAIL_STATUSES",
  );

  // Reproduce the handler's own threshold arithmetic to show the consequence.
  const failRate = t!.total > 0 ? t!.failure / t!.total : 0;
  const status = t!.total < 5
    ? "unknown"
    : failRate > 0.5
    ? "down"
    : failRate >= 0.25
    ? "degraded"
    : "healthy";
  assertEquals(
    status,
    "healthy",
    "DEFECT PINNED (P2-4): six kill-switch skips — zero messages delivered — " +
      "read as a HEALTHY Termii tile. A skip is not evidence of provider " +
      "health in either direction and should not count toward the total.",
  );

  // The status set is deliberately narrow — pin it so a widening is deliberate.
  assertEquals([...DELIVERY_FAIL_STATUSES].sort(), ["failed", "undelivered"]);
  assert(!DELIVERY_FAIL_STATUSES.has("skipped"));
  assert(!DELIVERY_FAIL_STATUSES.has("suppressed"));
});

// ===========================================================================
// R-5 — THE UNMAPPED REPORTING CONTRACT: distinct and sorted.
// ===========================================================================
Deno.test("#1537 R-5: unmappedProviders is distinct and sorted, however the rows arrive", () => {
  const { unmappedProviders } = tallyDeliveryRows([
    row("zzz"),
    row("aaa"),
    row("zzz"),
    row("mmm"),
    row("aaa"),
    row("aaa"),
  ]);
  assertEquals(
    unmappedProviders,
    ["aaa", "mmm", "zzz"],
    "duplicates collapsed, order normalised — the warn log must be stable",
  );
  // A stable, deduped list is what makes the warn log diffable across ticks;
  // an unstable one would make a recurring gap look like a new one each cycle.
  assertEquals(new Set(unmappedProviders).size, unmappedProviders.length);
});

// ===========================================================================
// R-6 — THE MIGRATION DEPENDENCY IS EXACTLY ONE KEY.
// The FK on api_health_checks.service_key means every emittable tile must be a
// registered service. This pins that `termii` is the ONLY tile this change adds
// that production does not already have — so migration 20270212001538 is the
// complete DB dependency, and a future tile added without one breaks this.
// ===========================================================================
Deno.test("#1537 R-6: termii is the ONLY tile requiring migration 20270212001538", () => {
  const tiles = [
    ...new Set(Object.values(DELIVERY_PROVIDER_TILES).flatMap((t) => [...t])),
  ];
  assert(
    tiles.length > 0,
    "VACUITY GUARD: the tile map is empty and this test would examine nothing",
  );

  const needingMigration = tiles
    .filter((t) => !REGISTERED_BEFORE_MIGRATION.has(t))
    .sort();

  assertEquals(
    needingMigration,
    ["termii"],
    "exactly one tile must be new to the database. If this list grows, a tile " +
      "was added without registering it in api_health_services — and because " +
      "api_health_checks.service_key is FK-constrained and the probe inserts " +
      "the whole tick in ONE batch, that would abort EVERY check row, not " +
      "just its own. Verified against real Postgres: a 4-row batch containing " +
      "an unregistered key persisted 0 rows with SQLSTATE 23503.",
  );

  // And the pre-existing tiles must genuinely already be registered, or the
  // assertion above would be passing for the wrong reason.
  for (const t of ["twilio", "resend", "onesignal_consumer"]) {
    assert(
      REGISTERED_BEFORE_MIGRATION.has(t),
      `${t} must already be a registered service`,
    );
    assert(tiles.includes(t), `${t} must still be emittable`);
  }
});
