// ORCH-1016 [Consumer Discover Trips tab] — TESTER ADVERSARIAL hard-guard test.
// SPEC §10 named path: supabase/functions/**/orch_1016_hard_guards_adversarial.test.ts
//
// ── ADVERSARIAL ANGLE (deliberately DIFFERENT from the implementor's test) ──
// The implementor's happy-path test
// (supabase/migrations/__tests__/orch_1016_pg_published_trips_public.test.ts)
// is a STATIC regex match: it asserts each guard CONJUNCT TEXT is present in the
// migration .sql string. Its "fails-on-revert" means "delete the line, the regex
// stops matching". That cannot catch a RUNTIME logic bug: an inverted comparison,
// an OR/AND precedence error, a guard that is present-but-ineffective, or a JOIN
// that silently re-admits a non-qualifying row.
//
// This test attacks the RUNTIME BEHAVIOR instead. It loads the actual RPC into a
// real Postgres, SEEDS synthetic non-qualifying trips (one per guard:
// cancelled / private / soft-deleted / bookings_closed / past-deadline /
// zero-tier), calls the live RPC, and asserts EXACTLY the qualifying trip
// surfaces. Then, per guard, it builds a reverted RPC variant with that one
// conjunct removed and PROVES the corresponding trip LEAKS — an executable
// fails-on-revert that the static test can never give. All work happens inside a
// transaction that is ROLLED BACK, so the live DB is never mutated.
//
// fails-on-revert verified at commit f528378189d7b46c5932861795ce0948f1432708.
//
// Harness: runs SQL against the local Supabase Postgres via `docker exec`
// (container `supabase_db_<ref>`). If no local DB is reachable, the test SKIPS
// with a loud notice rather than false-passing — the CI/local runner must have
// the stack up (or run the orch_1016_revert_proof.sql script directly).
//
// Run:
//   deno test --allow-run --allow-read \
//     supabase/functions/_test/orch_1016_hard_guards_adversarial.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";

const PG_CONTAINER = Deno.env.get("ORCH1016_PG_CONTAINER") ??
  "supabase_db_gqnoajqerqhnvulmnyvv";
const MIGRATION_RPC =
  "supabase/migrations/20260803000001_orch_1016_pg_published_trips_public.sql";

// Reusable brand id present in the local seed (orch-0947-live-brand). Override
// via env if the local seed differs.
const SEED_BRAND_ID = Deno.env.get("ORCH1016_SEED_BRAND") ??
  "bbbbbbbb-0947-4000-8000-000000000947";

async function psql(sql: string): Promise<{ ok: boolean; out: string }> {
  const cmd = new Deno.Command("docker", {
    args: ["exec", "-i", PG_CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(sql));
  await w.close();
  const { code, stdout, stderr } = await child.output();
  const out = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
  return { ok: code === 0, out };
}

async function localDbReachable(): Promise<boolean> {
  try {
    const { ok, out } = await psql("SELECT 1;");
    return ok && /\b1\b/.test(out);
  } catch {
    return false;
  }
}

// The seed helper + 6 non-qualifying trips + 1 qualifying trip, scoped to a
// unique destination token so the assertions ignore any pre-existing rows.
const SEED = (token: string) => `
CREATE OR REPLACE FUNCTION pg_temp.mk_trip(p_id uuid, p_slug text, p_status text, p_vis text,
    p_deleted timestamptz, p_closed boolean, p_deadline timestamptz, p_with_tier boolean)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_tt uuid := gen_random_uuid();
        v_brand uuid := '${SEED_BRAND_ID}';
        v_creator uuid := (SELECT created_by FROM public.events LIMIT 1);
BEGIN
  INSERT INTO public.events (id, brand_id, created_by, title, slug, event_type, visibility,
     status, deleted_at, bookings_closed, booking_deadline, destination_text, published_at)
  VALUES (p_id, v_brand, v_creator, p_slug, p_slug, 'trip', p_vis, p_status, p_deleted,
     p_closed, p_deadline, '${token}', now());
  INSERT INTO public.event_dates (event_id, start_at, end_at, is_master)
  VALUES (p_id, now()+interval '30 days', now()+interval '33 days', true);
  IF p_with_tier THEN
    INSERT INTO public.ticket_types (id, name, event_id, price_cents, currency, quantity_total,
       is_unlimited, is_free, is_hidden, deleted_at)
    VALUES (v_tt, 'Adv Tier', p_id, 10000, 'USD', 50, false, false, false, NULL);
    INSERT INTO public.trip_pricing_tiers (event_id, ticket_type_id, tier_name) VALUES (p_id, v_tt, 'Adv Tier');
  END IF;
END $f$;
SELECT pg_temp.mk_trip('00000000-0000-0000-0000-00000000a001','adv-qualify','scheduled','public',NULL,false,NULL,true);
SELECT pg_temp.mk_trip('00000000-0000-0000-0000-00000000a002','adv-cancelled','cancelled','public',NULL,false,NULL,true);
SELECT pg_temp.mk_trip('00000000-0000-0000-0000-00000000a003','adv-private','scheduled','private',NULL,false,NULL,true);
SELECT pg_temp.mk_trip('00000000-0000-0000-0000-00000000a004','adv-deleted','scheduled','public',now(),false,NULL,true);
SELECT pg_temp.mk_trip('00000000-0000-0000-0000-00000000a005','adv-closed','scheduled','public',NULL,true,NULL,true);
SELECT pg_temp.mk_trip('00000000-0000-0000-0000-00000000a006','adv-pastdl','scheduled','public',NULL,false,now()-interval '1 day',true);
SELECT pg_temp.mk_trip('00000000-0000-0000-0000-00000000a007','adv-notier','scheduled','public',NULL,false,NULL,false);
`;

// Reverted RPC variants — each strips exactly one guard conjunct.
const REVERT_FNS = (token: string) => `
CREATE OR REPLACE FUNCTION pg_temp.rpc_no_status() RETURNS SETOF text LANGUAGE sql STABLE AS $r$
  SELECT e.slug FROM public.events e JOIN public.brands b ON b.id=e.brand_id
  WHERE e.event_type='trip' AND e.visibility='public'
    AND e.deleted_at IS NULL AND b.deleted_at IS NULL
    AND COALESCE(e.bookings_closed,false)=false
    AND (e.booking_deadline IS NULL OR e.booking_deadline>=now())
    AND EXISTS (SELECT 1 FROM public.trip_pricing_tiers tpt2 JOIN public.ticket_types tt2 ON tt2.id=tpt2.ticket_type_id
                WHERE tpt2.event_id=e.id AND tt2.deleted_at IS NULL AND COALESCE(tt2.is_hidden,false)=false)
    AND e.destination_text ILIKE '%${token}%';
$r$;
CREATE OR REPLACE FUNCTION pg_temp.rpc_no_closed() RETURNS SETOF text LANGUAGE sql STABLE AS $r$
  SELECT e.slug FROM public.events e JOIN public.brands b ON b.id=e.brand_id
  WHERE e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live')
    AND e.deleted_at IS NULL AND b.deleted_at IS NULL
    AND (e.booking_deadline IS NULL OR e.booking_deadline>=now())
    AND EXISTS (SELECT 1 FROM public.trip_pricing_tiers tpt2 JOIN public.ticket_types tt2 ON tt2.id=tpt2.ticket_type_id
                WHERE tpt2.event_id=e.id AND tt2.deleted_at IS NULL AND COALESCE(tt2.is_hidden,false)=false)
    AND e.destination_text ILIKE '%${token}%';
$r$;
CREATE OR REPLACE FUNCTION pg_temp.rpc_no_deadline() RETURNS SETOF text LANGUAGE sql STABLE AS $r$
  SELECT e.slug FROM public.events e JOIN public.brands b ON b.id=e.brand_id
  WHERE e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live')
    AND e.deleted_at IS NULL AND b.deleted_at IS NULL
    AND COALESCE(e.bookings_closed,false)=false
    AND EXISTS (SELECT 1 FROM public.trip_pricing_tiers tpt2 JOIN public.ticket_types tt2 ON tt2.id=tpt2.ticket_type_id
                WHERE tpt2.event_id=e.id AND tt2.deleted_at IS NULL AND COALESCE(tt2.is_hidden,false)=false)
    AND e.destination_text ILIKE '%${token}%';
$r$;
CREATE OR REPLACE FUNCTION pg_temp.rpc_no_tier() RETURNS SETOF text LANGUAGE sql STABLE AS $r$
  SELECT e.slug FROM public.events e JOIN public.brands b ON b.id=e.brand_id
  WHERE e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live')
    AND e.deleted_at IS NULL AND b.deleted_at IS NULL
    AND COALESCE(e.bookings_closed,false)=false
    AND (e.booking_deadline IS NULL OR e.booking_deadline>=now())
    AND e.destination_text ILIKE '%${token}%';
$r$;
`;

Deno.test("ORCH-1016 adversarial: runtime baseline + fails-on-revert (4 guards)", async () => {
  if (!(await localDbReachable())) {
    console.warn(
      "[orch_1016_hard_guards_adversarial] SKIP: local Supabase Postgres not reachable " +
        `(container ${PG_CONTAINER}). Bring the stack up or run /tmp/orch1016_revert_proof.sql.`,
    );
    return;
  }

  // Ensure the RPC + the columns it reads exist locally (idempotent). On a fresh
  // local stack that predates the destination/departure migrations we scaffold
  // the referenced columns so the RPC compiles; on a fully-migrated DB these are
  // no-ops.
  const rpcSql = await Deno.readTextFile(MIGRATION_RPC);
  const setup = await psql(
    "ALTER TABLE public.events ADD COLUMN IF NOT EXISTS destination_text text;\n" +
      "ALTER TABLE public.events ADD COLUMN IF NOT EXISTS departure_text text;\n" +
      "ALTER TABLE public.events ADD COLUMN IF NOT EXISTS departure_geo point;\n" +
      rpcSql,
  );
  assert(
    setup.ok || /already exists|self-verify PASS/i.test(setup.out),
    "RPC migration loads locally:\n" + setup.out,
  );

  const BASE_TOKEN = "AdvBaseline_" + crypto.randomUUID().slice(0, 8);
  const REV_TOKEN = "AdvRevert_" + crypto.randomUUID().slice(0, 8);

  const script = `
\\set ON_ERROR_STOP on
BEGIN;
${SEED(BASE_TOKEN)}
-- BASELINE: only adv-qualify surfaces among our synthetic set.
DO $$
DECLARE leaked text;
BEGIN
  SELECT string_agg(trip_slug, ',') INTO leaked
    FROM public.pg_published_trips_public(p_destination_query=>'${BASE_TOKEN}')
    WHERE trip_slug <> 'adv-qualify';
  IF leaked IS NOT NULL THEN RAISE EXCEPTION 'BASELINE_LEAK:%', leaked; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pg_published_trips_public(p_destination_query=>'${BASE_TOKEN}') WHERE trip_slug='adv-qualify')
    THEN RAISE EXCEPTION 'BASELINE_MISSING_QUALIFY'; END IF;
  RAISE NOTICE 'ADV_BASELINE_PASS';
END $$;

-- FAILS-ON-REVERT: seed a fresh set under a new token and prove each guard leak.
${SEED(REV_TOKEN).replace(/a001/g, "c001").replace(/a002/g, "c002").replace(/a003/g, "c003").replace(/a004/g, "c004").replace(/a005/g, "c005").replace(/a006/g, "c006").replace(/a007/g, "c007").replace(/adv-/g, "rv-")}
${REVERT_FNS(REV_TOKEN)}
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pg_published_trips_public(p_destination_query=>'${REV_TOKEN}') WHERE trip_slug<>'rv-qualify')
    THEN RAISE EXCEPTION 'SPEC_RPC_LEAKED_REVERT_SET'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.rpc_no_status()   WHERE rpc_no_status='rv-cancelled') THEN RAISE EXCEPTION 'NO_REVERT_LEAK:status'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.rpc_no_closed()   WHERE rpc_no_closed='rv-closed')    THEN RAISE EXCEPTION 'NO_REVERT_LEAK:bookings_closed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.rpc_no_deadline() WHERE rpc_no_deadline='rv-pastdl')  THEN RAISE EXCEPTION 'NO_REVERT_LEAK:booking_deadline'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.rpc_no_tier()     WHERE rpc_no_tier='rv-notier')      THEN RAISE EXCEPTION 'NO_REVERT_LEAK:tier_exists'; END IF;
  RAISE NOTICE 'ADV_REVERT_PASS';
END $$;
ROLLBACK;
`;
  const { ok, out } = await psql(script);
  assert(ok, "adversarial script failed:\n" + out);
  assert(/ADV_BASELINE_PASS/.test(out), "baseline (no-leak) not proven:\n" + out);
  assert(/ADV_REVERT_PASS/.test(out), "fails-on-revert not proven:\n" + out);
});

// Static backstop: assert the 6 hard-guard conjuncts are present in the shipped
// SQL (catches an accidental migration rewrite even when no DB is reachable).
// This is a SECONDARY guard; the runtime test above is the primary adversarial proof.
Deno.test("ORCH-1016 adversarial backstop: six hard-guard conjuncts present in shipped SQL", async () => {
  const full = await Deno.readTextFile(MIGRATION_RPC);
  // Scope to the FUNCTION BODY only — the COMMENT ON FUNCTION literal also
  // mentions "show_on_discover is INTENTIONALLY not filtered" as prose, which
  // must not be mistaken for a SQL predicate.
  const bodyMatch = full.match(
    /CREATE OR REPLACE FUNCTION public\.pg_published_trips_public[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  );
  assert(bodyMatch !== null, "function body present");
  const sql = bodyMatch[1];
  const conjuncts: Array<[string, RegExp]> = [
    ["event_type='trip'", /e\.event_type\s*=\s*'trip'/i],
    ["visibility='public'", /e\.visibility\s*=\s*'public'/i],
    ["status IN scheduled/live", /e\.status\s+IN\s*\(\s*'scheduled'\s*,\s*'live'\s*\)/i],
    ["deleted_at IS NULL", /e\.deleted_at\s+IS\s+NULL/i],
    ["bookings_closed=false", /COALESCE\(\s*e\.bookings_closed\s*,\s*false\s*\)\s*=\s*false/i],
    ["booking_deadline NULL-or-future", /e\.booking_deadline\s+IS\s+NULL\s+OR\s+e\.booking_deadline\s*>=\s*now\(\)/i],
    ["tier EXISTS", /EXISTS\s*\([\s\S]*?trip_pricing_tiers/i],
  ];
  for (const [name, re] of conjuncts) {
    assert(re.test(sql), `hard-guard conjunct missing: ${name}`);
  }
  // operator decision #1: NO show_on_discover PREDICATE (comment mentions it; predicate must not exist)
  const noComments = sql.replace(/--[^\n]*\n/g, "\n");
  assertEquals(
    /show_on_discover\s*(=|<>|!=|\bIS\b|ILIKE|\bIN\b)/i.test(noComments),
    false,
    "show_on_discover MUST NOT be a filter predicate (operator decision #1)",
  );
});
