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

// ===========================================================================
// 2.1a (Booking Core — Tables + Availability + the Engine). Source-level
// regression over the NET-NEW 2.1a migrations:
//   20261006000000_orch_1148_availability_indexes.sql
//   20261006000001_orch_1148_available_slots_rpc.sql      (THE ENGINE)
//   20261006000002_orch_1148_booking_core_probes.sql
// Anchors: I-PROPOSED-1148-AVAILABILITY-ENGINE-SOLE-SLOT-SOURCE +
//          I-PROPOSED-1148-CAPACITY-RULE-ENFORCED-SERVER-SIDE.
// ===========================================================================

const ENGINE_RPC_FILE = "20261006000001_orch_1148_available_slots_rpc.sql";
const ENGINE_INDEX_FILE = "20261006000000_orch_1148_availability_indexes.sql";
const ENGINE_PROBE_FILE = "20261006000002_orch_1148_booking_core_probes.sql";

Deno.test("T-MIG-10 — 2.1a migration versions are monotonic above the 2.0/1150/1138 max", () => {
  // 2.0 = …03*; ORCH-1150 = …04*; ORCH-1138 = …05*; 2.1a bases at …06*.
  for (const f of [ENGINE_INDEX_FILE, ENGINE_RPC_FILE, ENGINE_PROBE_FILE]) {
    assertMatch(
      f,
      /^20261006000\d{3}_orch_1148/,
      `${f} must use the 20261006* base (strictly above 2.0/1150/1138)`,
    );
  }
  // Probe is the highest 2.1a prefix (runs last).
  const present = [...Deno.readDirSync(DIR)]
    .map((e) => e.name)
    .filter((n) => /^20261006000\d{3}_orch_1148/.test(n))
    .map((n) => n.slice(0, 14));
  assert(present.length >= 3, "the three 2.1a migrations must all exist");
  assert(
    Math.max(...present.map(Number)) === Number(ENGINE_PROBE_FILE.slice(0, 14)),
    "the 2.1a invariant-probe migration must be the highest (last) 2.1a prefix",
  );
});

Deno.test("T-MIG-11 — engine indexes are additive partial indexes on the live-status / active-rule paths", () => {
  const sql = read(ENGINE_INDEX_FILE);
  assertMatch(
    sql,
    /CREATE INDEX IF NOT EXISTS reservations_brand_table_reserved_idx[\s\S]*WHERE status IN \('requested', 'confirmed', 'seated'\)/,
    "the engine overlap index must be a partial index on the LIVE reservation statuses",
  );
  assertMatch(
    sql,
    /CREATE INDEX IF NOT EXISTS venue_capacity_rules_brand_kind_idx[\s\S]*WHERE is_active/,
    "the capacity-rule index must be partial on is_active",
  );
});

Deno.test("T-MIG-12 — the engine RPC honours the FROZEN CONTRACT signature + return shape", () => {
  const sql = read(ENGINE_RPC_FILE);
  assertMatch(
    sql,
    /CREATE OR REPLACE FUNCTION public\.pg_venue_available_slots\(\s*p_brand_id\s+uuid,\s*p_date\s+date,\s*p_party_size\s+int\s*\)/,
    "engine must take (p_brand_id uuid, p_date date, p_party_size int)",
  );
  for (const col of ["slot_start_utc", "slot_local_label", "remaining", "is_full"]) {
    assert(
      new RegExp(`\\b${col}\\b`).test(sql),
      `engine RETURNS TABLE must declare the frozen-contract column ${col}`,
    );
  }
  // SECURITY DEFINER + locked search_path.
  assertMatch(sql, /SECURITY DEFINER/, "engine must be SECURITY DEFINER");
  assertMatch(
    sql,
    /SET search_path = public, pg_temp/,
    "engine must lock search_path",
  );
});

Deno.test("T-MIG-13 — engine GRANTs EXECUTE to authenticated ONLY; NO anon grant (2.1a boundary)", () => {
  const sql = read(ENGINE_RPC_FILE).replace(/--.*$/gm, ""); // strip the 2.2-seam comment
  assertMatch(
    sql,
    /REVOKE ALL ON FUNCTION public\.pg_venue_available_slots\(uuid, date, int\) FROM PUBLIC/,
    "engine must REVOKE ALL FROM PUBLIC",
  );
  assertMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.pg_venue_available_slots\(uuid, date, int\) TO authenticated/,
    "engine must GRANT EXECUTE to authenticated",
  );
  assert(
    !/GRANT EXECUTE[\s\S]*TO anon/.test(sql),
    "engine must NOT grant EXECUTE to anon in 2.1a (the anon grant is the 2.2 consumer seam)",
  );
});

Deno.test("T-MIG-14 — engine enforces party_fit (min_party/max_party) + subtracts ONLY live reservations server-side", () => {
  const sql = read(ENGINE_RPC_FILE);
  assertMatch(
    sql,
    /p_party_size BETWEEN COALESCE\(t\.min_party, 1\) AND COALESCE\(t\.max_party, t\.capacity\)/,
    "engine must enforce the party_fit rule inside the eligible-tables filter",
  );
  // Whole-day blackout + reservable-only + the live-status overlap subtraction.
  assertMatch(
    sql,
    /applies_to = 'all'/,
    "engine must drop whole-day ('all') blackout dates",
  );
  assertMatch(
    sql,
    /reservation_policy = 'reservable'/,
    "engine must surface ONLY reservable tables (not walk_in_only/approval_required)",
  );
  assertMatch(
    sql,
    /status IN \('requested', 'confirmed', 'seated'\)/,
    "engine must subtract ONLY live reservations from capacity",
  );
});

// ===========================================================================
// 2.1a P3 DEFECT FIXES (engine v2). Source-level regression over the NET-NEW
// fix migrations found by the tester (TEST report §Defects):
//   20261008000000_orch_1148_availability_iana_timezone.sql   (P3-3 tz column)
//   20261008000001_orch_1148_available_slots_rpc_v2.sql       (the ENGINE v2)
//   20261008000002_orch_1148_booking_core_p3_probes.sql       (P3 probe)
// Anchors: I-PROPOSED-1148-ENGINE-HETEROGENEOUS-TURN (P3-1),
//          I-PROPOSED-1148-ENGINE-NO-OVER-SEAT (P3-2),
//          I-PROPOSED-1148-ENGINE-DST-IANA-TZ (P3-3).
// ===========================================================================

const ENGINE_V2_FILE = "20261008000001_orch_1148_available_slots_rpc_v2.sql";
const TZ_COLUMN_FILE = "20261008000000_orch_1148_availability_iana_timezone.sql";
const P3_PROBE_FILE = "20261008000002_orch_1148_booking_core_p3_probes.sql";

Deno.test("T-MIG-16 — engine v2 preserves the FROZEN signature + 4-col contract + grant boundary", () => {
  const sql = read(ENGINE_V2_FILE);
  assertMatch(
    sql,
    /CREATE OR REPLACE FUNCTION public\.pg_venue_available_slots\(\s*p_brand_id\s+uuid,\s*p_date\s+date,\s*p_party_size\s+int\s*\)/,
    "engine v2 must keep the frozen (uuid,date,int) signature",
  );
  for (const col of ["slot_start_utc", "slot_local_label", "remaining", "is_full"]) {
    assert(new RegExp(`\\b${col}\\b`).test(sql), `engine v2 must keep frozen column ${col}`);
  }
  assertMatch(sql, /SECURITY DEFINER/, "engine v2 must stay SECURITY DEFINER");
  assertMatch(sql, /SET search_path = public, pg_temp/, "engine v2 must lock search_path");
  const live = sql.replace(/--.*$/gm, "");
  assertMatch(
    live,
    /REVOKE EXECUTE ON FUNCTION public\.pg_venue_available_slots\(uuid, date, int\) FROM anon/,
    "engine v2 must keep the anon REVOKE",
  );
  assert(
    !/GRANT EXECUTE[\s\S]*TO anon/.test(live),
    "engine v2 must NOT grant EXECUTE to anon (still the 2.2 seam)",
  );
});

Deno.test("T-MIG-17 — P3-1 heterogeneous turn + P3-2 capacity clamp + P3-3 IANA tz are in engine v2 (fails-on-revert)", () => {
  const sql = read(ENGINE_V2_FILE);
  // P3-1: per-row turn for the EXISTING reservation (r.party_size), shared helper.
  assertMatch(
    sql,
    /pg_venue_turn_minutes_for_party\(v_cfg\.turn_times, r\.party_size\)/,
    "P3-1: the overlap window must use each reservation OWN party-size turn",
  );
  assertMatch(
    sql,
    /CREATE OR REPLACE FUNCTION public\.pg_venue_turn_minutes_for_party\(/,
    "P3-1: the shared per-party turn helper must be defined",
  );
  // P3-2: clamp effective max party to capacity; un-clamped predicate gone.
  assertMatch(
    sql,
    /LEAST\(COALESCE\(t\.max_party, t\.capacity\), t\.capacity\)/,
    "P3-2: party_fit must clamp the effective max party to capacity",
  );
  assert(
    !/p_party_size BETWEEN COALESCE\(t\.min_party, 1\) AND COALESCE\(t\.max_party, t\.capacity\)\s*$/m
      .test(sql),
    "P3-2: the un-clamped party_fit predicate must be gone from engine v2",
  );
  // P3-3: convert via IANA tz; the static offset is gone from the engine BODY
  // (the header docstring may still name it when describing the old behavior, so
  // strip SQL line comments before asserting the live SQL is clean).
  assertMatch(sql, /AT TIME ZONE v_tz/, "P3-3: engine v2 must convert via the IANA timezone");
  const liveSql = sql.replace(/--.*$/gm, "");
  assert(
    !/utc_offset_minutes/.test(liveSql),
    "P3-3: engine v2 body must NOT reference the static utc_offset_minutes",
  );
});

Deno.test("T-MIG-18 — the IANA tz column migration adds a validated NOT NULL column + write-time guard", () => {
  const sql = read(TZ_COLUMN_FILE);
  assertMatch(
    sql,
    /ADD COLUMN IF NOT EXISTS iana_timezone text NOT NULL DEFAULT 'UTC'/,
    "P3-3 migration must add iana_timezone NOT NULL DEFAULT 'UTC' additively",
  );
  assertMatch(
    sql,
    /CREATE TRIGGER venue_availability_config_validate_tz/,
    "P3-3 migration must install the write-time IANA validation trigger",
  );
  assertMatch(
    sql,
    /pg_timezone_names/,
    "P3-3 validation must check against pg_timezone_names (the authoritative IANA set)",
  );
});

Deno.test("T-MIG-19 — the P3 probe asserts all three fixes (fails-on-revert at the DB layer)", () => {
  const sql = read(P3_PROBE_FILE);
  const body = sql.replace(/--.*$/gm, "");
  assert(
    !/\bINSERT\s+INTO\b/i.test(body) && !/\bUPDATE\s+public\./i.test(body),
    "the P3 probe must be read-only",
  );
  assertMatch(sql, /r\.party_size/, "P3 probe must assert the P3-1 per-row turn");
  assertMatch(
    sql,
    /LEAST\(COALESCE\(t\.max_party, t\.capacity\), t\.capacity\)/,
    "P3 probe must assert the P3-2 capacity clamp",
  );
  assertMatch(sql, /AT TIME ZONE v_tz/, "P3 probe must assert the P3-3 IANA conversion");
  assertMatch(
    sql,
    /iana_timezone/,
    "P3 probe must assert the iana_timezone column",
  );
});

Deno.test("T-MIG-20 — the P3 fix migration versions are monotonic above all prior (2.1a + 1138/1150)", () => {
  for (const f of [TZ_COLUMN_FILE, ENGINE_V2_FILE, P3_PROBE_FILE]) {
    assertMatch(f, /^20261008000\d{3}_orch_1148/, `${f} must use the 20261008* base`);
  }
  const present = [...Deno.readDirSync(DIR)]
    .map((e) => e.name)
    .filter((n) => /^20261008000\d{3}_orch_1148/.test(n))
    .map((n) => n.slice(0, 14));
  assert(present.length >= 3, "the three P3 fix migrations must exist");
  assert(
    Math.max(...present.map(Number)) === Number(P3_PROBE_FILE.slice(0, 14)),
    "the P3 probe migration must be the highest (last) prefix",
  );
});

Deno.test("T-MIG-15 — the 2.1a probe asserts the engine contract, the grant boundary, and the indexes (fails-on-revert)", () => {
  const sql = read(ENGINE_PROBE_FILE);
  // read-only: no writes.
  const body = sql.replace(/--.*$/gm, "");
  assert(
    !/\bINSERT\s+INTO\b/i.test(body) && !/\bUPDATE\s+public\./i.test(body),
    "the 2.1a probe must be read-only (no writes)",
  );
  assertMatch(
    sql,
    /p_brand_id uuid, p_date date, p_party_size integer/,
    "probe must assert the exact engine identity arguments",
  );
  assertMatch(
    sql,
    /must NOT GRANT EXECUTE to anon\/PUBLIC in 2\.1a/,
    "probe must assert the no-anon-grant 2.1a boundary",
  );
  assertMatch(
    sql,
    /reservations_brand_table_reserved_idx/,
    "probe must assert the engine overlap index exists",
  );
  assertMatch(
    sql,
    /must enforce party_fit/,
    "probe must assert party_fit is enforced server-side",
  );
});
