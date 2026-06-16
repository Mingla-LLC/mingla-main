// META-ORCH-1148 sub-ORCH 2.0 — venue-suite migration regression.
// Run:
//   deno test --allow-read supabase/migrations/__tests__/orch_1148_venue_suite_migration.test.ts
//
// Source-level migration regression (no live SQL harness in the worktree). Pins
// the 2.0 schema + RLS contract that would FAIL if a migration is reverted or
// weakened. Anchors:
//   I-PROPOSED-1148-RESERVATIONS-RLS-BRAND-SCOPED (every venue_* + reservations
//   table RLS-enabled with member-read + manager-plus-write; no anon/consumer
//   direct write in 2.0).

import { assert, assertMatch } from "jsr:@std/assert@1";

const DIR = "supabase/migrations";

const read = (file: string): string =>
  Deno.readTextFileSync(`${DIR}/${file}`);

const VENUE_TABLES: ReadonlyArray<{ file: string; table: string }> = [
  { file: "20261003000000_orch_1148_venue_tables.sql", table: "venue_tables" },
  {
    file: "20261003000001_orch_1148_venue_capacity_rules.sql",
    table: "venue_capacity_rules",
  },
  {
    file: "20261003000002_orch_1148_venue_availability_config.sql",
    table: "venue_availability_config",
  },
  {
    file: "20261003000003_orch_1148_venue_blackouts.sql",
    table: "venue_blackouts",
  },
  {
    file: "20261003000004_orch_1148_venue_reservation_settings.sql",
    table: "venue_reservation_settings",
  },
  { file: "20261003000005_orch_1148_reservations.sql", table: "reservations" },
  {
    file: "20261003000006_orch_1148_venue_waitlist.sql",
    table: "venue_waitlist",
  },
];

Deno.test("T-MIG-1 — all 7 tables are created additively (IF NOT EXISTS)", () => {
  for (const { file, table } of VENUE_TABLES) {
    const sql = read(file);
    assertMatch(
      sql,
      new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`),
      `${table} must be created with CREATE TABLE IF NOT EXISTS`,
    );
  }
});

Deno.test("T-MIG-2 — RLS ENABLED + member-read + manager-plus-write on every table (I-...RLS-BRAND-SCOPED)", () => {
  for (const { file, table } of VENUE_TABLES) {
    const sql = read(file);
    assertMatch(
      sql,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
      `${table} must ENABLE ROW LEVEL SECURITY`,
    );
    // member-read gate
    assertMatch(
      sql,
      /biz_is_brand_member_for_read_for_caller\(brand_id\)/,
      `${table} read policy must use biz_is_brand_member_for_read_for_caller`,
    );
    // manager-plus write gate
    assertMatch(
      sql,
      /biz_brand_effective_rank_for_caller\(brand_id\)\s*>=\s*public\.biz_role_rank\('event_manager'\)/,
      `${table} write policy must gate on manager-plus rank`,
    );
    // read policy present
    assertMatch(
      sql,
      new RegExp(`CREATE POLICY "${table} brand member can read"`),
      `${table} must define the member-read policy`,
    );
    // write policy present
    assertMatch(
      sql,
      new RegExp(`CREATE POLICY "${table} manager plus can write"`),
      `${table} must define the manager-plus write policy`,
    );
    // DROP POLICY guard before CREATE (idempotent / additive re-run safe)
    assertMatch(
      sql,
      new RegExp(`DROP POLICY IF EXISTS "${table} brand member can read"`),
      `${table} must guard the read policy with DROP POLICY IF EXISTS`,
    );
  }
});

Deno.test("T-MIG-3 — NO anon read + NO public/anon write on any table (no consumer direct write in 2.0)", () => {
  for (const { file, table } of VENUE_TABLES) {
    // Strip SQL line comments so descriptive 2.2-seam notes never trip the
    // check; only LIVE SQL is asserted.
    const sql = read(file).replace(/--.*$/gm, "");
    assert(
      !/\bTO anon\b/.test(sql),
      `${table}: must NOT grant anything TO anon in 2.0`,
    );
    assert(
      !/FOR SELECT TO authenticated\s+USING \(true\)/.test(sql),
      `${table}: must NOT have an unconditional public read policy`,
    );
    // The consumer self-read POLICY (consumer_user_id = auth.uid()) is a 2.2
    // seam — it must not appear as a LIVE policy in 2.0 (the descriptive comment
    // is stripped above).
    assert(
      !/CREATE POLICY[\s\S]*consumer_user_id\s*=\s*auth\.uid\(\)/.test(sql),
      `${table}: the consumer self-read policy is a 2.2 seam — must not appear in 2.0`,
    );
  }
});

Deno.test("T-MIG-4 — every table has an updated_at trigger + brand_id (common shape)", () => {
  for (const { file, table } of VENUE_TABLES) {
    const sql = read(file);
    assertMatch(
      sql,
      new RegExp(`CREATE TRIGGER ${table}_set_updated_at`),
      `${table} must have an updated_at trigger`,
    );
    assertMatch(
      sql,
      /brand_id uuid (NOT NULL REFERENCES public\.brands\(id\)|PRIMARY KEY REFERENCES public\.brands\(id\))/,
      `${table} must FK brand_id → public.brands(id)`,
    );
  }
});

Deno.test("T-MIG-5 — reservations.status carries the full 8-state lifecycle CHECK (D2)", () => {
  const sql = read("20261003000005_orch_1148_reservations.sql");
  for (
    const state of [
      "requested",
      "confirmed",
      "seated",
      "completed",
      "no_show",
      "cancelled_by_guest",
      "cancelled_by_venue",
      "waitlisted",
    ]
  ) {
    assert(
      new RegExp(`'${state}'`).test(sql),
      `reservations.status CHECK must include '${state}'`,
    );
  }
  // event_date_id is a nullable forward seam with NO FK (D1).
  assertMatch(
    sql,
    /event_date_id uuid NULL,/,
    "reservations.event_date_id must be a nullable NO-FK seam (D1)",
  );
  assert(
    !/event_date_id uuid[^,]*REFERENCES/.test(sql),
    "reservations.event_date_id must NOT FK-enforce a slot model in 2.0 (D1)",
  );
});

Deno.test("T-MIG-6 — venue_reservation_settings: brand_id PK + reservations_enabled default false", () => {
  const sql = read("20261003000004_orch_1148_venue_reservation_settings.sql");
  assertMatch(
    sql,
    /brand_id uuid PRIMARY KEY REFERENCES public\.brands\(id\)/,
    "venue_reservation_settings must use brand_id as the PRIMARY KEY (one row per brand)",
  );
  assertMatch(
    sql,
    /reservations_enabled boolean NOT NULL DEFAULT false/,
    "reservations_enabled must default false (the LOCKED single toggle, OFF by default)",
  );
});

Deno.test("T-MIG-7 — venue_waitlist does NOT overload waitlist_entries", () => {
  const sql = read("20261003000006_orch_1148_venue_waitlist.sql");
  assert(
    !/\bwaitlist_entries\b(?![^\n]*--)/.test(
      sql.replace(/--.*$/gm, ""),
    ),
    "venue_waitlist migration must NOT reference/alter public.waitlist_entries in live SQL",
  );
  assertMatch(
    sql,
    /CREATE TABLE IF NOT EXISTS public\.venue_waitlist\b/,
    "venue_waitlist must be its own NEW table",
  );
});

Deno.test("T-MIG-8 — version prefixes are monotonic 20261003000000..07 and probe runs last", () => {
  const expected = [
    "20261003000000",
    "20261003000001",
    "20261003000002",
    "20261003000003",
    "20261003000004",
    "20261003000005",
    "20261003000006",
    "20261003000007",
  ];
  const present = [...Deno.readDirSync(DIR)]
    .map((e) => e.name)
    .filter((n) => /^20261003000\d{3}_orch_1148/.test(n))
    .map((n) => n.slice(0, 14))
    .sort();
  for (const v of expected) {
    assert(present.includes(v), `migration prefix ${v} must exist`);
  }
  // probe is the highest prefix.
  assert(
    Math.max(...present.map(Number)) === Number("20261003000007"),
    "the invariant-probe migration (…07) must be the last (highest) prefix",
  );
});

Deno.test("T-MIG-9 — probe asserts tables exist + RLS + 8-state lifecycle (fails-on-revert anchor)", () => {
  const sql = read("20261003000007_orch_1148_invariant_probes.sql");
  assertMatch(sql, /relrowsecurity = true/, "probe must assert RLS enabled");
  assertMatch(
    sql,
    /reservations_enabled/,
    "probe must assert the toggle column",
  );
  assertMatch(
    sql,
    /cancelled_by_venue/,
    "probe must assert the full lifecycle enum",
  );
  // read-only: no INSERT/UPDATE/DELETE in the probe.
  const body = sql.replace(/--.*$/gm, "");
  assert(
    !/\bINSERT\s+INTO\b/i.test(body) && !/\bUPDATE\s+public\./i.test(body),
    "the invariant probe must be read-only (no writes)",
  );
  // P3 fix (regression guard): the CHECK-constraint selection MUST disambiguate
  // the `status` lifecycle CHECK from `payment_status` (both constraintdefs
  // contain the substring "status"). An ambiguous `ILIKE '%status%'` could
  // non-deterministically return the payment_status CHECK and falsely RAISE,
  // aborting the apply. Assert the selection is anchored on a lifecycle-only
  // value that can NEVER appear in payment_status's ('none','paid','refunded')
  // CHECK, and that the bare ambiguous predicate is gone. Fails on revert.
  const bodyNoComments = body;
  assertMatch(
    bodyNoComments,
    /pg_get_constraintdef\(con\.oid\)\s+ILIKE\s+'%''requested''%'/i,
    "probe must anchor the status-CHECK selection on the lifecycle-only value 'requested' (disambiguates payment_status)",
  );
  assert(
    !/pg_get_constraintdef\(con\.oid\)\s+ILIKE\s+'%status%'/i.test(
      bodyNoComments,
    ),
    "probe must NOT select the status CHECK with the ambiguous ILIKE '%status%' (matches payment_status too)",
  );
  assertMatch(
    bodyNoComments,
    /\bLIMIT\s+1\b/i,
    "probe must LIMIT 1 the status-CHECK selection defensively",
  );
});
