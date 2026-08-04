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
//        across all FOUR buckets: attempts + non-attempts + unmapped + null.
//        The original bug was a row that fell through the ladder and was
//        counted nowhere; a per-provider assertion cannot catch that class,
//        because it only ever looks where it expects to find something. A
//        conservation invariant looks at what is MISSING. The fourth bucket
//        was added by the P2-4 fix — see the note on the fixture.
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
//   R-4  KILL-SWITCH SKIPS ARE NOT PROVIDER HEALTH. A dark market must report
//        `unknown` with its skips PRESERVED — excluding non-attempts from the
//        health maths is correct, but dropping them would recreate P1-1's
//        invisibility one layer up. [TEST-MOD-APPROVED #1537]: inverted when
//        P2-4 was fixed, as this file's original R-4 comment required.
//   R-4b THE INVERSE ERROR — skips must not DILUTE a real outage below the
//        alert threshold, and excluding them must not manufacture a false
//        alarm either. Attacks the exact 0.25 boundary in both directions.
//   R-4c `queued` is in NEITHER status set, so it scores as a successful
//        attempt — the P2-4 shape in a new status (tester finding P2-5).
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
  DELIVERY_NON_ATTEMPT_STATUSES,
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
  // [TEST-MOD-APPROVED #1537] P2-4 EXTENDED THIS FIXTURE, deliberately.
  // The fix split every mapped row into a FOURTH bucket: attempts (`total`) vs
  // non-attempts (`skipped`). This fixture previously contained no `skipped` or
  // `suppressed` rows, so the conservation equation below still balanced —
  // while silently no longer covering the new bucket at all. A conservation
  // check that avoids the case it cannot account for is exactly the kind of
  // hollowed-out test this suite exists to prevent, so both non-attempt
  // statuses are now represented and carried through the equation.
  const rows: DeliveryLedgerRow[] = [
    row("termii"),
    row("termii", "failed"),
    row("termii", "skipped"), // kill switch — no provider I/O
    row("twilio", "suppressed"), // can_send denial — no provider I/O
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
  let skippedTotal = 0;
  for (const entry of tally.values()) {
    tallied += entry.total;
    skippedTotal += entry.skipped;
  }

  // Rows whose provider was unmapped — recomputed from the input, NOT from the
  // result, so the two are independent.
  const unmappedRowCount = rows.filter((r) => {
    const p = r.provider?.trim();
    return !!p && deliveryProviderTiles(p) === null;
  }).length;

  assertEquals(nullProviderRows, 2, "null-provider rows");
  assertEquals(unmappedRowCount, 3, "rows carrying an unmapped provider");
  assertEquals(tallied, 5, "rows that reached a provider (attempts)");
  assertEquals(skippedTotal, 2, "rows that never reached a provider");
  assertEquals(
    tallied + skippedTotal + unmappedRowCount + nullProviderRows,
    rows.length,
    "CONSERVATION VIOLATED: a row was counted twice or vanished. This is the " +
      "exact class of the #1537 P1 — a provider that fell through the ladder " +
      "and was recorded nowhere — and of P2-4, where a non-attempt had to be " +
      "moved out of `total` WITHOUT being discarded.",
  );

  // And the unmapped ones must be REPORTED, not merely excluded.
  assertEquals(unmappedProviders, ["nexmo", "sinch"]);
  assertEquals(tally.get("termii")?.total, 2);
  assertEquals(tally.get("termii")?.failure, 1);
  assertEquals(
    tally.get("termii")?.skipped,
    1,
    "the skip must be PRESERVED on its tile, not dropped — dropping it would " +
      "recreate P1-1's invisibility one layer up",
  );
  assertEquals(tally.get("twilio")?.total, 1);
  assertEquals(tally.get("twilio")?.skipped, 1);
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
Deno.test("#1537 R-4: a dark market reports `unknown` with its skips preserved, never `healthy`", () => {
  // Exactly the rows a dark Nigeria produces today.
  const darkNigeria = Array.from(
    { length: 6 },
    () => row("termii", "skipped"),
  );
  const { tally } = tallyDeliveryRows(darkNigeria);

  // The tile must still EXIST. Excluding non-attempts from the health maths is
  // correct; making the market disappear from the probe is not — that would be
  // P1-1's invisibility returning one layer up, and it is the specific way a
  // fix for this finding could go wrong.
  const t = tally.get("termii");
  assert(
    t,
    "VACUITY: no termii tile at all — the skips were DROPPED rather than " +
      "excluded from the health maths. That recreates the invisibility P1-1 " +
      "fixed: 'nothing to send' becomes indistinguishable from 'not sending'.",
  );

  assertEquals(
    t!.total,
    0,
    "a skip performed no provider I/O, so it is not an attempt",
  );
  assertEquals(t!.failure, 0);
  assertEquals(
    t!.skipped,
    6,
    "and all six are PRESERVED, so the operator can still see that sends were " +
      "requested and held back",
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
    "unknown",
    "P2-4 FIXED: six kill-switch skips with zero deliveries must read " +
      "`unknown` — nothing was attempted, so nothing is known. `healthy` was " +
      "a positive false claim about a market that was entirely dark.",
  );

  // Both status sets are deliberately narrow — pin them so any widening is a
  // conscious act rather than a silent reclassification.
  assertEquals([...DELIVERY_FAIL_STATUSES].sort(), ["failed", "undelivered"]);
  assertEquals(
    [...DELIVERY_NON_ATTEMPT_STATUSES].sort(),
    ["skipped", "suppressed"],
  );
  // The two sets must never overlap, or a row would be both an attempt-failure
  // and a non-attempt.
  for (const s of DELIVERY_NON_ATTEMPT_STATUSES) {
    assert(!DELIVERY_FAIL_STATUSES.has(s), `${s} cannot be both`);
  }
});

// ===========================================================================
// R-4b — THE INVERSE ERROR: skips must not DILUTE a real outage.
//
// The dangerous half, and the one nothing was testing before this round. Under
// the old denominator a genuine outage could hide behind its own skips: the
// skips inflated `total`, which DEFLATED the failure rate below the alert
// threshold. This attacks the exact boundary rather than a comfortable case.
// ===========================================================================
Deno.test("#1537 R-4b: skips cannot dilute a real outage below the alert threshold", () => {
  const rows: DeliveryLedgerRow[] = [
    ...Array.from({ length: 20 }, () => row("termii", "skipped")),
    ...Array.from({ length: 6 }, () => row("termii", "failed")),
    row("termii", "delivered"),
  ];
  const t = tallyDeliveryRows(rows).tally.get("termii");
  assert(t, "VACUITY: no termii tile");

  assertEquals(t!.total, 7, "only the 6 failures + 1 delivery were attempts");
  assertEquals(t!.failure, 6);
  assertEquals(t!.skipped, 20, "the skips are still visible");

  const rate = t!.failure / t!.total;
  const status = t!.total < 5
    ? "unknown"
    : rate > 0.5
    ? "down"
    : rate >= 0.25
    ? "degraded"
    : "healthy";
  assertEquals(status, "down", "6 of 7 real attempts failed — this is an outage");

  // The old arithmetic, computed explicitly, so the regression this prevents is
  // visible in the test rather than asserted in prose. 6/27 = 0.222…, which
  // sits UNDER the 0.25 degraded threshold — a total outage reading `healthy`.
  const oldTotal = 27;
  const oldRate = 6 / oldTotal;
  assert(
    oldRate < 0.25,
    `the pre-fix denominator scored ${oldRate.toFixed(3)}, under the 0.25 ` +
      `degraded threshold — 6 of 7 real sends failing read as HEALTHY`,
  );
  assert(
    rate > oldRate,
    "excluding non-attempts must RAISE the observed failure rate, not lower it",
  );

  // And the mirror: excluding skips must not manufacture a false alarm either.
  // A genuinely healthy provider that also has skips must still read healthy.
  const healthy = tallyDeliveryRows([
    ...Array.from({ length: 20 }, () => row("twilio", "skipped")),
    ...Array.from({ length: 10 }, () => row("twilio", "delivered")),
  ]).tally.get("twilio");
  assert(healthy, "VACUITY: no twilio tile");
  assertEquals(healthy!.total, 10);
  assertEquals(healthy!.failure, 0);
  assertEquals(healthy!.skipped, 20);
  assert(
    healthy!.failure / healthy!.total < 0.25,
    "a real healthy signal must survive the change — this is not a one-way ratchet",
  );
});

// ===========================================================================
// R-4c — `queued` IS COUNTED AS A SUCCESSFUL ATTEMPT. (Tester finding P2-5.)
//
// `queued` is in NEITHER status set, so it falls to the attempt branch and
// raises `total` while being structurally incapable of raising `failure` — the
// same shape as the P2-4 defect, in a status nobody classified.
//
// It is a REAL path, not theoretical: `insertGuestDelivery` writes the guest
// claim row as `queued` BEFORE the provider call, precisely so a crash leaves a
// durable record, and `updateGuestDelivery` reconciles it afterwards. Any
// dispatch that dies in between — function timeout, hung provider socket —
// leaves a permanently `queued` row that this tally scores as a success.
//
// Pinned as CURRENT BEHAVIOUR so it cannot drift silently. Update deliberately
// when `queued` is classified.
// ===========================================================================
Deno.test("#1537 R-4c: a stale `queued` claim row scores as a success (DEFECT, pinned)", () => {
  const t = tallyDeliveryRows(
    Array.from({ length: 6 }, () => row("termii", "queued")),
  ).tally.get("termii");
  assert(t, "VACUITY: no termii tile");

  assertEquals(
    t!.total,
    6,
    "DEFECT PINNED (P2-5): `queued` is in neither DELIVERY_FAIL_STATUSES nor " +
      "DELIVERY_NON_ATTEMPT_STATUSES, so it counts as a completed attempt",
  );
  assertEquals(
    t!.failure,
    0,
    "and can never be a failure — so a row stuck mid-dispatch reads as a " +
      "silent success, which is the P2-4 shape in a new status",
  );
  assertEquals(t!.skipped, 0);

  // Consequence under the handler's thresholds: six stranded claim rows report
  // a HEALTHY provider that has confirmed nothing.
  const rate = t!.failure / t!.total;
  const status = t!.total < 5
    ? "unknown"
    : rate > 0.5
    ? "down"
    : rate >= 0.25
    ? "degraded"
    : "healthy";
  assertEquals(
    status,
    "healthy",
    "six unreconciled claim rows read as a healthy provider — see P2-5",
  );

  assert(
    !DELIVERY_FAIL_STATUSES.has("queued") &&
      !DELIVERY_NON_ATTEMPT_STATUSES.has("queued"),
    "when `queued` is classified, this test must be updated deliberately",
  );
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
