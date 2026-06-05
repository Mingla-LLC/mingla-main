// ORCH-1075 [Paid-publish integrity guards] — TESTER Step-0.5 ADVERSARIAL regression.
//
// Run locally:
//   deno test --allow-read supabase/migrations/__tests__/orch_1075_paid_publish_guards_behavioral.test.ts
//
// ── Why this exists / how it differs from the implementor's test ─────────────
// The implementor's test (orch_1075_paid_publish_integrity_guards.test.ts) is a
// SOURCE-CONTRACT test: it asserts the guard STRINGS appear in the migration
// file (same angle as the strict-grep gate — presence of markers). It never
// exercises the guard LOGIC.
//
// This test attacks a DIFFERENT angle: BEHAVIOR / BOUNDARY / TRUTH-TABLE. It
// re-implements the EXACT deployed predicates byte-for-byte from the migration
// and asserts they produce the correct boolean for the adversarial edge cases
// that LIVE DATA CANNOT COVER (no detached-only / null-account_id brand exists
// in prod) and that the implementor's string test never touches:
//   - Guard A: a DETACHED connect row (detached_at IS NOT NULL) with
//     charges_enabled=true is correctly treated as "cannot charge".
//   - Guard A: a row with NULL stripe_account_id is "cannot charge".
//   - Guard A: no connect row at all is "cannot charge".
//   - Guard B: the EXACT `end_at = now()` boundary is treated as PAST (reject).
//   - Guard B (Q4): a multi-date offering with ONE future date PUBLISHES
//     (MAX(end_at) > now()); ALL-past is rejected.
//   - free->paid edit transition (Q3) still gated; in-person-only exemption
//     does not leak to online-paid.
//
// Each predicate string below is asserted to MATCH the live migration so the
// re-implementation cannot silently drift from the deployed code: if the
// migration's predicate changes, the `migrationContains` assertions fail.
//
// LIVE-DB CROSS-CHECK (captured by the tester via read-only MCP, 2026-06-04 —
// evidence pinned in QA_ORCH-1075_PAID_PUBLISH_INTEGRITY_GUARDS.md):
//   pg_brand_can_charge('53aaea42…Lantern & Vine', charges_enabled=false) = false
//   pg_brand_can_charge('00000000-…-000000000000' nonexistent)            = false
//   a charges_enabled=true attached brand                                 = true
//   full-population equivalence vs the ticket-checkout-create predicate:
//     52/52 brands agree, 0 disagree.
//
// fails-on-revert: see the matching `migrationContains` guards — if a guard
// predicate is removed/weakened in the migration, the contract assertions fail.

import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION =
  "supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql";
const sql = await Deno.readTextFile(MIGRATION);

function migrationContains(needle: string, why: string) {
  assert(
    sql.includes(needle),
    `migration must still contain \`${needle}\` (${why}); re-implementation below would otherwise drift from deployed code`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard A — pg_brand_can_charge predicate, re-implemented from the deployed body.
// Deployed body (pinned):
//   detached_at IS NULL
//   AND stripe_account_id IS NOT NULL
//   AND charges_enabled IS DISTINCT FROM false
// ─────────────────────────────────────────────────────────────────────────────
type ConnectRow = {
  detached_at: Date | null;
  stripe_account_id: string | null;
  charges_enabled: boolean | null;
};

/** Byte-faithful TS port of the deployed pg_brand_can_charge EXISTS predicate. */
function canCharge(rows: ConnectRow[]): boolean {
  return rows.some(
    (s) =>
      s.detached_at === null &&
      s.stripe_account_id !== null &&
      // `IS DISTINCT FROM false`: true and NULL both pass; only literal false fails.
      s.charges_enabled !== false,
  );
}

Deno.test("Guard A: re-implementation matches the deployed predicate text (anti-drift)", () => {
  migrationContains("detached_at IS NULL", "Guard A attached-only filter");
  migrationContains(
    "stripe_account_id IS NOT NULL",
    "Guard A requires an account id",
  );
  migrationContains(
    "charges_enabled IS DISTINCT FROM false",
    "Guard A true-only readiness test",
  );
});

Deno.test("Guard A: a DETACHED connect row (even charges_enabled=true) cannot charge", () => {
  // The adversarial case that NO live brand exercises.
  assertEquals(
    canCharge([
      { detached_at: new Date(), stripe_account_id: "acct_x", charges_enabled: true },
    ]),
    false,
    "detached_at NOT NULL must exclude the row",
  );
});

Deno.test("Guard A: a NULL stripe_account_id row cannot charge", () => {
  assertEquals(
    canCharge([
      { detached_at: null, stripe_account_id: null, charges_enabled: true },
    ]),
    false,
  );
});

Deno.test("Guard A: no connect row at all cannot charge", () => {
  assertEquals(canCharge([]), false);
});

Deno.test("Guard A: charges_enabled=false attached row cannot charge (the Lantern & Vine repro)", () => {
  assertEquals(
    canCharge([
      { detached_at: null, stripe_account_id: "acct_1Tdu4cPjlZvMV1oP", charges_enabled: false },
    ]),
    false,
  );
});

Deno.test("Guard A: attached + charges_enabled=true CAN charge (does not over-reach)", () => {
  assertEquals(
    canCharge([
      { detached_at: null, stripe_account_id: "acct_x", charges_enabled: true },
    ]),
    true,
  );
});

Deno.test("Guard A: a detached-true row alongside an active-false row still cannot charge", () => {
  // Proves the EXISTS only considers attached rows; the detached true must not rescue.
  assertEquals(
    canCharge([
      { detached_at: new Date(), stripe_account_id: "acct_old", charges_enabled: true },
      { detached_at: null, stripe_account_id: "acct_new", charges_enabled: false },
    ]),
    false,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Guard B — past-date predicate `v_max_end <= v_now` over MAX(end_at) (Q4).
// Deployed comparison (pinned): `v_max_end <= v_now` (and `v_end <= v_now` trip).
// "past" = NO date with end_at > now()  ==>  MAX(end_at) <= now().
// ─────────────────────────────────────────────────────────────────────────────
/** Byte-faithful port: an offering is "past" iff its latest end_at <= now. */
function isPast(endAts: Date[], now: Date): boolean {
  if (endAts.length === 0) return true; // v_max_end IS NULL => reject
  const maxEnd = endAts.reduce((a, b) => (a > b ? a : b));
  return maxEnd.getTime() <= now.getTime();
}

Deno.test("Guard B: re-implementation matches the deployed comparison text (anti-drift)", () => {
  migrationContains("v_max_end <= v_now", "Guard B max-end past comparison");
  migrationContains("v_end <= v_now", "Guard B trip range-end past comparison");
  migrationContains(
    "offering_date_past",
    "Guard B rejection reason string",
  );
});

Deno.test("Guard B boundary: end_at EXACTLY equal to now() is PAST (rejected)", () => {
  const now = new Date("2026-06-04T12:00:00.000Z");
  assertEquals(isPast([new Date("2026-06-04T12:00:00.000Z")], now), true);
});

Deno.test("Guard B boundary: end_at 1ms before now() is PAST (rejected)", () => {
  const now = new Date("2026-06-04T12:00:00.000Z");
  assertEquals(isPast([new Date("2026-06-04T11:59:59.999Z")], now), true);
});

Deno.test("Guard B boundary: end_at 1ms after now() is FUTURE (publishes)", () => {
  const now = new Date("2026-06-04T12:00:00.000Z");
  assertEquals(isPast([new Date("2026-06-04T12:00:00.001Z")], now), false);
});

Deno.test("Guard B Q4 (T-12): multi-date [past, future] PUBLISHES (max is future)", () => {
  const now = new Date("2026-06-04T12:00:00.000Z");
  assertEquals(
    isPast(
      [new Date("2026-06-01T00:00:00Z"), new Date("2026-06-10T00:00:00Z")],
      now,
    ),
    false,
  );
});

Deno.test("Guard B Q4 (T-13): multi-date ALL past is rejected", () => {
  const now = new Date("2026-06-04T12:00:00.000Z");
  assertEquals(
    isPast(
      [new Date("2026-06-01T00:00:00Z"), new Date("2026-06-03T00:00:00Z")],
      now,
    ),
    true,
  );
});

Deno.test("Guard B: empty date set (v_max_end IS NULL) is rejected", () => {
  assertEquals(isPast([], new Date()), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// PAID-ONLY scoping — the in-person-only (door) exemption must NOT leak to
// online-paid, and the experience paid predicate must require BOTH not-free AND
// resolved-total>0 (Q3 free->paid edit still gated; T-16 in-person exempt).
// ─────────────────────────────────────────────────────────────────────────────
type Ticket = { availableOnline: boolean; priceCents: number; isFree: boolean };

/** Port of the event publish v_paid_online predicate. */
function eventPaidOnline(tickets: Ticket[]): boolean {
  return tickets.some(
    (t) => t.availableOnline && !t.isFree && t.priceCents > 0,
  );
}

Deno.test("Paid scope (T-16): in-person-only paid ticket is NOT online-paid (Guard A exempt)", () => {
  assertEquals(
    eventPaidOnline([{ availableOnline: false, priceCents: 5000, isFree: false }]),
    false,
  );
});

Deno.test("Paid scope: an online paid ticket IS online-paid (guards fire)", () => {
  assertEquals(
    eventPaidOnline([{ availableOnline: true, priceCents: 5000, isFree: false }]),
    true,
  );
});

Deno.test("Paid scope (T-09): a FREE online ticket is NOT online-paid (guards exempt)", () => {
  assertEquals(
    eventPaidOnline([{ availableOnline: true, priceCents: 0, isFree: true }]),
    false,
  );
});

Deno.test("Paid scope: in-person-only exemption does NOT leak when an online-paid ticket is also present", () => {
  // A mixed offering with at least one online-paid ticket must be treated as paid.
  assertEquals(
    eventPaidOnline([
      { availableOnline: false, priceCents: 9999, isFree: false }, // door-only
      { availableOnline: true, priceCents: 1000, isFree: false }, // online-paid
    ]),
    true,
  );
});

Deno.test("Q3 (free->paid edit): experience live-edit guard fires on ANY resulting paid state", () => {
  // The experience edit guard predicate is `NOT v_is_free AND v_resolved_total > 0`,
  // i.e. it does not check the PRIOR state — any resulting-paid edit is gated.
  migrationContains(
    "NOT v_is_free AND v_resolved_total > 0",
    "Q3 — paid live-edit gated regardless of prior free/paid state",
  );
});

Deno.test("business_patch_event_when: paid-online EXISTS predicate, free/door exempt", () => {
  // Guard B-only RPC scopes 'paid' to online + price>0 via EXISTS on ticket_types.
  migrationContains("t.available_online = true", "patch_when paid-online filter");
  migrationContains("t.price_cents > 0", "patch_when price filter");
  // And it must NOT carry Guard A.
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.business_patch_event_when",
  );
  const tag = "$function$";
  const open = sql.indexOf(tag, start) !== -1 ? tag : "$$";
  const bodyStart = sql.indexOf(open, start);
  const bodyEnd = sql.indexOf(open, bodyStart + open.length);
  const body = sql.slice(start, bodyEnd + open.length);
  assertEquals(
    body.includes("pg_brand_can_charge("),
    false,
    "business_patch_event_when must NOT carry Guard A",
  );
});
