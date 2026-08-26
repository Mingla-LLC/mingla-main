import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePayoutReleaseSweep } from "../index.ts";

const migrationPath =
  "supabase/migrations/20270110000001_issue_1171_dark_payout_ledger.sql";
const handlerPath = "supabase/functions/payout-release-sweep/index.ts";
const enginePath = "supabase/functions/payout-release-sweep/engine.ts";

const migration = await Deno.readTextFile(migrationPath);
const handler = await Deno.readTextFile(handlerPath);
const engine = await Deno.readTextFile(enginePath);

// [TEST-MOD-APPROVED #2591] — parameterise the database, and make the parameter
// not reaching this process DETECTABLE rather than silent.
//
// #2591 gives every contract suite its own database, copied from the migrated
// template with CREATE DATABASE ... TEMPLATE. These tests reach PostgreSQL by
// `docker exec ... psql`, and the database was baked into the argv array as the
// literal "postgres". It now comes from ISSUE_1171_POSTGRES_DATABASE, mirroring
// the file's own existing ISSUE_1171_POSTGRES_CONTAINER pattern, and defaulting
// to "postgres" so every existing invocation is unchanged.
//
// That default is the whole risk of the change: a consolidated job that forgets
// to set the variable runs these suites against the migrated TEMPLATE, every
// assertion still passes, and the isolation the design rests on is gone with no
// signal at all. `isolationGuardSql` below removes the silence. It asks the
// cluster whether per-suite databases exist and refuses to run in the template
// when they do — self-configuring, with no new switch to forget to turn on:
//
//   legacy cluster (no suite_* databases) -> passes exactly as today;
//   consolidated cluster, variable set    -> running in suite_1171, passes;
//   consolidated cluster, variable unset  -> RED, naming the database.
//
// Clause A alone is not enough, and the second clause is the point of this guard.
// A database can carry the RIGHT NAME and the WRONG CONTENTS: `suite_1174` built
// from `template0` instead of from the migrated template passes every name check
// ever written while holding zero tables, zero policies and zero triggers. That
// is not hypothetical -- it is the shape a `pg_dump` restore produced in this repo
// while tables and columns matched and 643 RLS policies had collapsed to 2, exit
// code 0 throughout. So clause B asserts the SECURITY POSTURE of the specific
// tables this suite is about to mutate: they exist, ROW LEVEL SECURITY is on, and
// the objects that enforce append-only and per-brand isolation are present.
// Counting tables and columns is explicitly insufficient; that is the check that
// passed the disaster.
const isolationGuardSql = String.raw`
DO $issue_2591_isolation$
DECLARE
  v_suite_databases integer;
  v_broken text;
BEGIN
  -- Clause A — PLACEMENT. If this cluster has per-suite contract databases at
  -- all, then the #2591 design is in force and this session must be inside one
  -- of them. Self-configuring: a legacy cluster has none, so this is inert there
  -- and the file behaves exactly as it did before #2591.
  SELECT count(*) INTO v_suite_databases
  FROM pg_database
  WHERE datname LIKE 'suite\_%';

  IF v_suite_databases > 0 AND current_database() NOT LIKE 'suite\_%' THEN
    RAISE EXCEPTION
      '#2591 SUITE ISOLATION FAIL: % per-suite contract databases exist in this cluster, but this suite is executing in "%" — the migrated template every suite was copied from. ISSUE_1171_POSTGRES_DATABASE did not reach this process.',
      v_suite_databases, current_database();
  END IF;

  -- Clause B — FIDELITY. The right name is not the right database.
  SELECT string_agg(probe.what, '; ' ORDER BY probe.what) INTO v_broken
  FROM (
    SELECT 'public.brand_payout_releases is missing' AS what
     WHERE to_regclass('public.brand_payout_releases') IS NULL
    UNION ALL
    SELECT 'public.organiser_payout_debts is missing'
     WHERE to_regclass('public.organiser_payout_debts') IS NULL
    UNION ALL
    SELECT 'public.brand_payout_releases has ROW LEVEL SECURITY disabled'
     WHERE NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c
       WHERE c.oid = to_regclass('public.brand_payout_releases')), false)
    UNION ALL
    SELECT 'public.organiser_payout_debts has ROW LEVEL SECURITY disabled'
     WHERE NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c
       WHERE c.oid = to_regclass('public.organiser_payout_debts')), false)
    UNION ALL
    SELECT 'public.brand_payout_releases carries no RLS policy'
     WHERE NOT EXISTS (SELECT 1 FROM pg_policy p
       WHERE p.polrelid = to_regclass('public.brand_payout_releases'))
    UNION ALL
    SELECT 'public.organiser_payout_debts carries no RLS policy'
     WHERE NOT EXISTS (SELECT 1 FROM pg_policy p
       WHERE p.polrelid = to_regclass('public.organiser_payout_debts'))
  ) AS probe;

  IF v_broken IS NOT NULL THEN
    RAISE EXCEPTION
      '#2591 SUITE FIDELITY FAIL: database "%" is not a faithful copy of the migrated template — %. Tables and columns matching is NOT sufficient evidence: a pg_dump restore passed that check with 643 RLS policies collapsed to 2.',
      current_database(), v_broken;
  END IF;
END
$issue_2591_isolation$;
`;

const spawnDockerSql = async (container: string, statement: string) => {
  const command = new Deno.Command("docker", {
    args: [
      "exec",
      "-i",
      container,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-U",
      "postgres",
      "-d",
      // [TEST-MOD-APPROVED #2591] per-suite database; default preserves every
      // existing invocation. The silent-fallback guard is `isolationGuardSql`.
      Deno.env.get("ISSUE_1171_POSTGRES_DATABASE") ?? "postgres",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = command.stdin.getWriter();
  await writer.write(new TextEncoder().encode(statement));
  await writer.close();
  return command;
};

const runDockerSql = async (container: string, statement: string) => {
  const command = await spawnDockerSql(container, statement);
  return await command.output();
};

Deno.test("adversarial bearer variants cannot construct a client and the accepted path remains DARK", async () => {
  let clientCreations = 0;
  const rpcNames: string[] = [];
  const deps = {
    env: (key: string) =>
      key === "SUPABASE_URL"
        ? "https://example.test"
        : key === "SUPABASE_SERVICE_ROLE_KEY"
        ? "service-secret"
        : undefined,
    createAdmin: (() => {
      clientCreations++;
      return {
        rpc: (name: string) => {
          rpcNames.push(name);
          if (name === "claim_payout_release_alerts") {
            return Promise.resolve({ data: [], error: null });
          }
          return Promise.resolve({
            data: name === "list_missing_payout_source_fees"
              ? []
              : { dark: true, executed: 0 },
            error: null,
          });
        },
        from: () => {
          throw new Error("DARK test has no fee candidate write");
        },
      };
    }) as never,
    resolveProviderFee: () => {
      throw new Error("DARK test has no provider read candidate");
    },
  };

  for (
    const authorization of [
      "",
      "service-secret",
      "bearer service-secret",
      "Bearer  service-secret",
      "Bearer service-secret,forged",
      "Basic service-secret",
      "Bearer forged.jwt.token",
      "prefix-Bearer service-secret",
    ]
  ) {
    const response = await handlePayoutReleaseSweep(
      new Request("https://example.test/functions/v1/payout-release-sweep", {
        method: "POST",
        headers: authorization ? { authorization } : {},
      }),
      deps,
    );
    assertEquals(response.status, 401, authorization);
  }
  assertEquals(clientCreations, 0);

  const getResponse = await handlePayoutReleaseSweep(
    new Request("https://example.test/functions/v1/payout-release-sweep", {
      method: "GET",
      headers: { authorization: "Bearer service-secret" },
    }),
    deps,
  );
  assertEquals(getResponse.status, 405);
  assertEquals(clientCreations, 0);

  const accepted = await handlePayoutReleaseSweep(
    new Request("https://example.test/functions/v1/payout-release-sweep", {
      method: "POST",
      headers: { authorization: "Bearer service-secret" },
    }),
    deps,
  );
  assertEquals(accepted.status, 200);
  assertEquals(await accepted.json(), {
    ok: true,
    dark: true,
    capturedFees: 0,
    alertDelivery: {
      claimed: 0,
      providerAccepted: 0,
      retryPending: 0,
      manualReview: 0,
    },
    result: { dark: true, executed: 0 },
  });
  assertEquals(clientCreations, 1);
  assertEquals(rpcNames, [
    "list_missing_payout_source_fees",
    "run_payout_release_dark_sweep",
    "claim_payout_release_alerts",
  ]);

  const darkScope = `${migration}\n${handler}\n${engine}`;
  for (
    const forbidden of [
      /\bpayouts\.create\s*\(/,
      /\btransfers\.create\s*\(/,
      /\bpaystackInitiateTransfer\s*\(/,
      /\bsetManualPayoutSchedule\s*\(/,
      /\bsource_transaction\b/,
    ]
  ) {
    assert(
      !forbidden.test(darkScope),
      `provider execute shape found: ${forbidden}`,
    );
  }
  assertStringIncludes(migration, "'executed',0");
});

const stateMachineSql = String.raw`
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id) VALUES
  ('1171ad00-0000-0000-0000-000000000001'),
  ('1171ad00-0000-0000-0000-000000000002');
INSERT INTO public.creator_accounts(id) VALUES
  ('1171ad00-0000-0000-0000-000000000001'),
  ('1171ad00-0000-0000-0000-000000000002');
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,payout_hold_cutover_at
) VALUES
  ('1171ad00-0000-0000-0000-000000000011',
   '1171ad00-0000-0000-0000-000000000001',
   'Adversarial A','issue-1171-adversarial-a','USD','2026-07-01T00:00:00Z'),
  ('1171ad00-0000-0000-0000-000000000012',
   '1171ad00-0000-0000-0000-000000000002',
   'Adversarial B','issue-1171-adversarial-b','USD','2026-07-01T00:00:00Z');
INSERT INTO public.events(id,brand_id,title,slug,status,currency) VALUES
  ('1171ad00-0000-0000-0000-000000000101',
   '1171ad00-0000-0000-0000-000000000011',
   'Boundary Event','issue-1171-adversarial-boundary','scheduled','USD'),
  ('1171ad00-0000-0000-0000-000000000102',
   '1171ad00-0000-0000-0000-000000000011',
   'Never Ending Event','issue-1171-adversarial-never','scheduled','USD');
INSERT INTO public.event_dates(id,event_id,start_at,end_at,is_master) VALUES
  ('1171ad00-0000-0000-0000-000000000201',
   '1171ad00-0000-0000-0000-000000000101',
   '2026-07-04T18:00:00Z','2026-07-04T20:00:00Z',true),
  ('1171ad00-0000-0000-0000-000000000202',
   '1171ad00-0000-0000-0000-000000000102',
   '2026-07-04T18:00:00Z','2026-07-04T20:00:00Z',true),
  ('1171ad00-0000-0000-0000-000000000203',
   '1171ad00-0000-0000-0000-000000000102',
   '2027-07-04T18:00:00Z','2027-07-04T20:00:00Z',false);
SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  v_failed boolean;
  v_boundary uuid;
  v_no_future_origin uuid;
  v_no_future_debt uuid;
  v_partial_origin uuid;
  v_partial_debt uuid;
  v_partial_target uuid;
  v_wrong_brand uuid;
  v_wrong_currency uuid;
  v_convert_origin uuid;
  v_convert_debt uuid;
  v_convert_target uuid;
  v_permanent uuid;
  v_repeat_origin uuid;
  v_repeat_debt uuid;
BEGIN
  -- Exactly-before and equal are excluded; exactly-after is admitted.
  FOR v_boundary IN
    SELECT source_id FROM (VALUES
      ('1171ad00-0000-0000-0000-000000000301'::uuid),
      ('1171ad00-0000-0000-0000-000000000302'::uuid)
    ) q(source_id)
  LOOP
    v_failed:=false;
    BEGIN
      PERFORM public.attach_payout_release(
        'order',v_boundary,
        '1171ad00-0000-0000-0000-000000000011',
        '1171ad00-0000-0000-0000-000000000101',
        '1171ad00-0000-0000-0000-000000000201',
        '1171ad00-0000-0000-0000-000000000201',
        'stripe','usd',
        CASE WHEN v_boundary='1171ad00-0000-0000-0000-000000000301'
          THEN '2026-06-30T23:59:59Z'::timestamptz
          ELSE '2026-07-01T00:00:00Z'::timestamptz END,
        '2026-07-04T20:00:00Z',1000,0,0,0,0,0
      );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN v_failed:=true;
    END;
    IF NOT v_failed THEN
      RAISE EXCEPTION 'cutover before/equal source was admitted';
    END IF;
  END LOOP;
  v_boundary:=public.attach_payout_release(
    'order','1171ad00-0000-0000-0000-000000000303',
    '1171ad00-0000-0000-0000-000000000011',
    '1171ad00-0000-0000-0000-000000000101',
    '1171ad00-0000-0000-0000-000000000201',
    '1171ad00-0000-0000-0000-000000000201',
    'stripe','usd','2026-07-01T00:00:01Z',
    '2026-07-04T20:00:00Z',1000,0,0,0,0,0
  );
  IF v_boundary IS NULL THEN RAISE EXCEPTION 'cutover +1 second was excluded'; END IF;

  -- A debt with no future release closes without an external debit or recredit.
  INSERT INTO public.brand_payout_releases(
    brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,
    gross_cents,net_release_cents,status,organiser_cash_delivered_cents,released_at
  ) VALUES(
    '1171ad00-0000-0000-0000-000000000011','no-future-origin',
    'venue_reservation','stripe','usd','2026-07-01T00:00:00Z',
    '2026-07-04T00:00:00Z',1000,1000,'released',1000,'2026-07-04T00:00:00Z'
  ) RETURNING id INTO v_no_future_origin;
  v_no_future_debt:=public.open_post_release_postponement_debt(
    v_no_future_origin,'2026-07-10T00:00:00Z'
  );
  PERFORM public.mature_postponement_debts('2026-07-13T00:00:00Z');
  IF (SELECT (status,recovered_cents) FROM public.organiser_payout_debts
      WHERE id=v_no_future_debt)
       IS DISTINCT FROM ROW('closed'::text,0) OR
     EXISTS(SELECT 1 FROM public.payout_ledger_adjustments
       WHERE release_id=v_no_future_origin AND kind='maturity_recredit') THEN
    RAISE EXCEPTION 'no-future-release debt did not close without recredit';
  END IF;

  -- Same-brand/same-currency only; partial recovery recredits only the 600 held.
  INSERT INTO public.brand_payout_releases(
    brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,
    gross_cents,net_release_cents,status,organiser_cash_delivered_cents,released_at
  ) VALUES(
    '1171ad00-0000-0000-0000-000000000011','partial-origin',
    'venue_reservation','stripe','usd','2026-07-01T00:00:00Z',
    '2026-07-04T00:00:00Z',1000,1000,'released',1000,'2026-07-04T00:00:00Z'
  ) RETURNING id INTO v_partial_origin;
  v_partial_debt:=public.open_post_release_postponement_debt(
    v_partial_origin,'2026-07-20T00:00:00Z'
  );
  INSERT INTO public.brand_payout_releases(
    brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,
    gross_cents,net_release_cents,status
  ) VALUES
    ('1171ad00-0000-0000-0000-000000000012','wrong-brand',
     'venue_reservation','stripe','usd','2026-07-10T00:00:00Z',
     '2026-07-13T00:00:00Z',600,600,'pending'),
    ('1171ad00-0000-0000-0000-000000000011','wrong-currency',
     'venue_reservation','paystack','ngn','2026-07-10T00:00:00Z',
     '2026-07-13T00:00:00Z',600,600,'pending'),
    ('1171ad00-0000-0000-0000-000000000011','partial-target',
     'venue_reservation','stripe','usd','2026-07-10T00:00:00Z',
     '2026-07-13T00:00:00Z',600,600,'pending');
  SELECT id INTO v_wrong_brand FROM public.brand_payout_releases
    WHERE occurrence_key='wrong-brand';
  SELECT id INTO v_wrong_currency FROM public.brand_payout_releases
    WHERE occurrence_key='wrong-currency';
  SELECT id INTO v_partial_target FROM public.brand_payout_releases
    WHERE occurrence_key='partial-target';
  IF public.apply_open_payout_debts(v_wrong_brand,'2026-07-14T00:00:00Z')<>0 OR
     public.apply_open_payout_debts(v_wrong_currency,'2026-07-14T00:00:00Z')<>0 OR
     public.apply_open_payout_debts(v_partial_target,'2026-07-14T00:00:00Z')<>600 THEN
    RAISE EXCEPTION 'cross-brand/currency isolation or partial withholding failed';
  END IF;
  PERFORM public.mature_postponement_debts('2026-07-23T00:00:00Z');
  IF (SELECT amount_cents FROM public.payout_ledger_adjustments
      WHERE release_id=v_partial_target AND kind='maturity_recredit')<>600 OR
     (SELECT amount_cents FROM public.payout_ledger_adjustments
      WHERE release_id=v_partial_origin AND kind='debt_writeoff')<>400 THEN
    RAISE EXCEPTION 'partial recovery did not recredit only held value';
  END IF;

  -- Cancellation converts held cash once; only the unconverted remainder recredits.
  INSERT INTO public.brand_payout_releases(
    brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,
    gross_cents,net_release_cents,status,organiser_cash_delivered_cents,released_at
  ) VALUES(
    '1171ad00-0000-0000-0000-000000000011','convert-origin',
    'venue_reservation','stripe','usd','2026-07-01T00:00:00Z',
    '2026-07-04T00:00:00Z',1000,1000,'released',1000,'2026-07-04T00:00:00Z'
  ) RETURNING id INTO v_convert_origin;
  INSERT INTO public.brand_payout_releases(
    brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,
    gross_cents,net_release_cents,status
  ) VALUES(
    '1171ad00-0000-0000-0000-000000000011','convert-target',
    'venue_reservation','stripe','usd','2026-07-12T00:00:00Z',
    '2026-07-15T00:00:00Z',700,700,'pending'
  ) RETURNING id INTO v_convert_target;
  v_convert_debt:=public.open_post_release_postponement_debt(
    v_convert_origin,'2026-07-30T00:00:00Z'
  );
  PERFORM public.apply_open_payout_debts(v_convert_target,'2026-07-16T00:00:00Z');
  v_permanent:=public.convert_postponement_debt_to_permanent(
    v_convert_origin,'post_release_cancellation',400,'2026-07-16T00:00:01Z'
  );
  PERFORM public.mature_postponement_debts('2026-08-02T00:00:00Z');
  PERFORM public.mature_postponement_debts('2026-08-03T00:00:00Z');
  IF (SELECT (principal_cents,recovered_cents,status)
      FROM public.organiser_payout_debts WHERE id=v_permanent)
       IS DISTINCT FROM ROW(400,400,'closed'::text) OR
     (SELECT amount_cents FROM public.payout_ledger_adjustments
      WHERE release_id=v_convert_target AND kind='maturity_recredit')<>300 OR
     (SELECT count(*) FROM public.payout_ledger_adjustments
      WHERE release_id=v_convert_target AND kind='maturity_recredit')<>1 OR
     (SELECT converted_cents FROM public.payout_debt_applications
      WHERE debt_id=v_convert_debt AND release_id=v_convert_target)<>400 THEN
    RAISE EXCEPTION 'cancellation conversion double-withheld or double-recredited';
  END IF;

  -- A rolling future occurrence never changes the released occurrence identity.
  INSERT INTO public.brand_payout_releases(
    brand_id,event_id,event_date_id,occurrence_key,surface,provider,currency,
    anchor_end_at,releasable_at,gross_cents,net_release_cents,status,
    organiser_cash_delivered_cents,released_at
  ) VALUES(
    '1171ad00-0000-0000-0000-000000000011',
    '1171ad00-0000-0000-0000-000000000102',
    '1171ad00-0000-0000-0000-000000000202',
    '1171ad00-0000-0000-0000-000000000202',
    'order','stripe','usd','2026-07-04T20:00:00Z',
    '2026-07-07T20:00:00Z',500,500,'released',500,'2026-07-08T00:00:00Z'
  ) RETURNING id INTO v_repeat_origin;
  IF public.sync_post_release_postponement_debts('2026-07-08T00:00:00Z')<>0 THEN
    RAISE EXCEPTION 'never-ending recurrence top-up created a debt';
  END IF;
  UPDATE public.event_dates SET end_at='2026-07-12T20:00:00Z'
    WHERE id='1171ad00-0000-0000-0000-000000000202';
  PERFORM public.sync_post_release_postponement_debts('2026-07-08T00:00:01Z');
  SELECT id INTO v_repeat_debt FROM public.organiser_payout_debts
    WHERE origin_release_id=v_repeat_origin AND kind='post_release_postponement';
  UPDATE public.event_dates SET end_at='2026-07-14T20:00:00Z'
    WHERE id='1171ad00-0000-0000-0000-000000000202';
  PERFORM public.sync_post_release_postponement_debts('2026-07-08T00:00:02Z');
  UPDATE public.event_dates SET end_at='2026-07-04T20:00:00Z'
    WHERE id='1171ad00-0000-0000-0000-000000000202';
  PERFORM public.sync_post_release_postponement_debts('2026-07-08T00:00:03Z');
  PERFORM public.mature_postponement_debts('2026-07-08T00:00:03Z');
  IF (SELECT count(*) FROM public.organiser_payout_debts
      WHERE origin_release_id=v_repeat_origin
        AND kind='post_release_postponement')<>1 OR
     (SELECT status FROM public.organiser_payout_debts WHERE id=v_repeat_debt)<>'closed' THEN
    RAISE EXCEPTION 'repeated forward/backward anchor moves left stale debt';
  END IF;
END
$test$;
ROLLBACK;
`;

if (Deno.env.get("ISSUE_1171_SQL_BEHAVIOR") === "1") {
  const container = Deno.env.get("ISSUE_1171_POSTGRES_CONTAINER") ??
    "issue1171-tester-pg-20260724";

  // [TEST-MOD-APPROVED #2591] The guard runs FIRST, through the same
  // runDockerSql the contract tests use, so it certifies the exact connection
  // they are about to assert against — not a separately-configured one.
  Deno.test("#2591 the #1171 adversarial suite is not running in the migrated template", async () => {
    const result = await runDockerSql(container, isolationGuardSql);
    assertEquals(
      result.code,
      0,
      new TextDecoder().decode(result.stderr),
    );
  });

  Deno.test("adversarial PostgreSQL state-machine boundaries remain isolated and value-conserving", async () => {
    const result = await runDockerSql(container, stateMachineSql);
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  });

  const concurrencyCleanup = String.raw`
SET session_replication_role=replica;
DELETE FROM public.payout_debt_events WHERE debt_id IN (
  SELECT id FROM public.organiser_payout_debts
  WHERE origin_release_id IN (
    SELECT id FROM public.brand_payout_releases
    WHERE brand_id='1171ac00-0000-0000-0000-000000000011'
  )
);
DELETE FROM public.payout_debt_applications WHERE debt_id IN (
  SELECT id FROM public.organiser_payout_debts
  WHERE origin_release_id IN (
    SELECT id FROM public.brand_payout_releases
    WHERE brand_id='1171ac00-0000-0000-0000-000000000011'
  )
);
DELETE FROM public.organiser_payout_debts WHERE origin_release_id IN (
  SELECT id FROM public.brand_payout_releases
  WHERE brand_id='1171ac00-0000-0000-0000-000000000011'
);
DELETE FROM public.payout_release_items WHERE release_id IN (
  SELECT id FROM public.brand_payout_releases
  WHERE brand_id='1171ac00-0000-0000-0000-000000000011'
);
DELETE FROM public.brand_payout_releases
WHERE brand_id='1171ac00-0000-0000-0000-000000000011';
DELETE FROM public.event_dates
WHERE event_id='1171ac00-0000-0000-0000-000000000101';
DELETE FROM public.events
WHERE id='1171ac00-0000-0000-0000-000000000101';
DELETE FROM public.brands
WHERE id='1171ac00-0000-0000-0000-000000000011';
DELETE FROM public.creator_accounts
WHERE id='1171ac00-0000-0000-0000-000000000001';
DELETE FROM auth.users
WHERE id='1171ac00-0000-0000-0000-000000000001';
SET session_replication_role=origin;
`;
  const concurrencySetup = concurrencyCleanup + String.raw`
SET session_replication_role=replica;
INSERT INTO auth.users(id)
VALUES('1171ac00-0000-0000-0000-000000000001');
INSERT INTO public.creator_accounts(id)
VALUES('1171ac00-0000-0000-0000-000000000001');
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,payout_hold_cutover_at
) VALUES(
  '1171ac00-0000-0000-0000-000000000011',
  '1171ac00-0000-0000-0000-000000000001',
  'Adversarial Concurrency','issue-1171-adversarial-concurrency',
  'USD','2026-07-01T00:00:00Z'
);
INSERT INTO public.events(id,brand_id,title,slug,status,currency)
VALUES(
  '1171ac00-0000-0000-0000-000000000101',
  '1171ac00-0000-0000-0000-000000000011',
  'Concurrency Event','issue-1171-concurrency-event','scheduled','USD'
);
INSERT INTO public.event_dates(id,event_id,start_at,end_at,is_master)
VALUES(
  '1171ac00-0000-0000-0000-000000000201',
  '1171ac00-0000-0000-0000-000000000101',
  '2026-07-12T18:00:00Z','2026-07-12T20:00:00Z',true
);
INSERT INTO public.brand_payout_releases(
  id,brand_id,event_id,event_date_id,occurrence_key,surface,provider,currency,
  anchor_end_at,releasable_at,gross_cents,net_release_cents,status,
  organiser_cash_delivered_cents,released_at
) VALUES(
  '1171ac00-0000-0000-0000-000000000301',
  '1171ac00-0000-0000-0000-000000000011',
  '1171ac00-0000-0000-0000-000000000101',
  '1171ac00-0000-0000-0000-000000000201',
  '1171ac00-0000-0000-0000-000000000201',
  'order','stripe','usd','2026-07-04T20:00:00Z','2026-07-07T20:00:00Z',
  500,500,'released',500,'2026-07-08T00:00:00Z'
),(
  '1171ac00-0000-0000-0000-000000000302',
  '1171ac00-0000-0000-0000-000000000011',
  NULL,NULL,'race-target','venue_reservation','stripe','usd',
  '2026-07-10T00:00:00Z','2026-07-13T00:00:00Z',
  500,500,'pending',0,NULL
);
SET session_replication_role=origin;
`;

  Deno.test("postponement and sweep concurrency serializes before future value can escape", async () => {
    const setup = await runDockerSql(container, concurrencySetup);
    assertEquals(setup.code, 0, new TextDecoder().decode(setup.stderr));
    try {
      const first = await spawnDockerSql(
        container,
        String.raw`
BEGIN;
SELECT public.sync_post_release_postponement_debts('2026-07-09T00:00:00Z');
SELECT pg_sleep(1);
COMMIT;
`,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      const second = await spawnDockerSql(
        container,
        String.raw`
BEGIN;
SELECT public.sync_post_release_postponement_debts('2026-07-09T00:00:01Z');
SELECT public.apply_open_payout_debts(
  '1171ac00-0000-0000-0000-000000000302','2026-07-09T00:00:01Z'
);
COMMIT;
`,
      );
      const [firstResult, secondResult] = await Promise.all([
        first.output(),
        second.output(),
      ]);
      assertEquals(
        firstResult.code,
        0,
        new TextDecoder().decode(firstResult.stderr),
      );
      assertEquals(
        secondResult.code,
        0,
        new TextDecoder().decode(secondResult.stderr),
      );
      const proof = await runDockerSql(
        container,
        String.raw`
SELECT
  (SELECT count(*) FROM public.organiser_payout_debts
   WHERE origin_release_id='1171ac00-0000-0000-0000-000000000301'),
  (SELECT count(*) FROM public.payout_debt_applications
   WHERE release_id='1171ac00-0000-0000-0000-000000000302'),
  (SELECT net_release_cents FROM public.brand_payout_releases
   WHERE id='1171ac00-0000-0000-0000-000000000302');
`,
      );
      assertEquals(proof.code, 0, new TextDecoder().decode(proof.stderr));
      assertEquals(new TextDecoder().decode(proof.stdout).trim(), "1|1|0");
    } finally {
      await runDockerSql(container, concurrencyCleanup);
    }
  });

  Deno.test("three concurrent duplicate attaches converge without an empty release", async () => {
    const setup = await runDockerSql(container, concurrencySetup);
    assertEquals(setup.code, 0, new TextDecoder().decode(setup.stderr));
    const sourceId = "1171ac00-0000-0000-0000-000000000901";
    const attach = (key: string, hold = false) =>
      String.raw`
BEGIN;
${
        hold
          ? `SELECT pg_advisory_xact_lock(hashtextextended('order:${sourceId}',1171));`
          : ""
      }
SELECT public.attach_payout_release(
  'order','${sourceId}',
  '1171ac00-0000-0000-0000-000000000011',
  '1171ac00-0000-0000-0000-000000000101',
  '1171ac00-0000-0000-0000-000000000201','${key}',
  'stripe','usd','2026-07-02T00:00:00Z','2026-07-12T20:00:00Z',
  900,0,0,0,0,30
);
${hold ? "SELECT pg_sleep(1);" : ""}
COMMIT;
`;
    try {
      const first = await spawnDockerSql(
        container,
        attach("three-way-a", true),
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      const second = await spawnDockerSql(container, attach("three-way-b"));
      const third = await spawnDockerSql(container, attach("three-way-c"));
      const results = await Promise.all([
        first.output(),
        second.output(),
        third.output(),
      ]);
      for (const result of results) {
        assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      }
      const ids = results.map((result) =>
        new TextDecoder().decode(result.stdout).match(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
        )?.[0]
      );
      assert(ids[0]);
      assertEquals(new Set(ids).size, 1);
      const proof = await runDockerSql(
        container,
        String.raw`
SELECT
  (SELECT count(*) FROM public.payout_release_items
   WHERE source_type='order' AND source_id='${sourceId}'),
  (SELECT count(*) FROM public.brand_payout_releases r
   WHERE r.brand_id='1171ac00-0000-0000-0000-000000000011'
     AND r.id IN (
       SELECT release_id FROM public.payout_release_items
       WHERE source_type='order' AND source_id='${sourceId}'
     )),
  (SELECT count(*) FROM public.brand_payout_releases r
   WHERE r.brand_id='1171ac00-0000-0000-0000-000000000011'
     AND NOT EXISTS(
       SELECT 1 FROM public.payout_release_items i WHERE i.release_id=r.id
     )
     AND r.id NOT IN (
       '1171ac00-0000-0000-0000-000000000301',
       '1171ac00-0000-0000-0000-000000000302'
     ));
`,
      );
      assertEquals(proof.code, 0, new TextDecoder().decode(proof.stderr));
      assertEquals(new TextDecoder().decode(proof.stdout).trim(), "1|1|0");
    } finally {
      await runDockerSql(container, concurrencyCleanup);
    }
  });
}
