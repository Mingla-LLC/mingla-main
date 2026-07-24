import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  "supabase/migrations/20270110000001_issue_1171_dark_payout_ledger.sql",
);
const config = await Deno.readTextFile("supabase/config.toml");

Deno.test("#1171 schema is append-only, rail-neutral, and fee-normalized", () => {
  for (
    const table of [
      "brand_payout_releases",
      "payout_release_items",
      "payout_transfer_legs",
      "payout_ledger_adjustments",
      "organiser_payout_debts",
      "payout_debt_applications",
      "payout_debt_events",
    ]
  ) {
    assertStringIncludes(sql, `CREATE TABLE public.${table}`);
    assertStringIncludes(
      sql,
      `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
    );
  }
  assertStringIncludes(sql, "UNIQUE (source_type, source_id)");
  assertStringIncludes(sql, "payout_release_items_append_only");
  assertStringIncludes(sql, "provider_fee_cents integer NOT NULL");
  assertStringIncludes(sql, "payout_source_fee_snapshots_append_only");
  assertStringIncludes(sql, "event_key uuid GENERATED ALWAYS AS");
  assertStringIncludes(sql, "source_finalized_at timestamptz NOT NULL");
  assertStringIncludes(sql, "CREATE TABLE public.payout_transfer_legs");
  assertStringIncludes(sql, "estimated_fee_cents");
  assertStringIncludes(sql, "stamp_duty_cents");
  assertStringIncludes(sql, "fee_schedule_version");
});

Deno.test("#1171 RPCs enforce persisted live occurrences, refresh, conversion and recovered-only recredit", () => {
  assertStringIncludes(sql, "public.resolve_payout_live_occurrence");
  assertStringIncludes(sql, "public.resolve_payout_live_anchor");
  assertStringIncludes(sql, "ed.end_at>=p_finalized_at");
  assertStringIncludes(sql, "occ.event_date_id");
  assertStringIncludes(sql, "public.refresh_pending_payout_release_truth");
  assertStringIncludes(sql, "pg_advisory_xact_lock");
  assertStringIncludes(sql, "'blocked_over_cap'");
  assertStringIncludes(sql, "'fee_unreconciled'");
  assertStringIncludes(sql, "'blocked_anchor'");
  assertStringIncludes(sql, "p_finalized_at <= v_cutover");
  assertStringIncludes(sql, "cancelled_event_never_releases");
  assertStringIncludes(sql, "FOR UPDATE SKIP LOCKED");
  assertStringIncludes(sql, "kind <> 'post_release_postponement'");
  assertStringIncludes(sql, "v_app.amount_cents-v_app.converted_cents");
  assertStringIncludes(sql, "'future_value_released'");
  assertStringIncludes(sql, "released_at=p_now");
  assertStringIncludes(sql, "v_debt.principal_cents-v_debt.recovered_cents");
  assertStringIncludes(sql, "public.convert_postponement_debt_to_permanent");
  assertStringIncludes(sql, "debt_id=v_temp.id AND released_at IS NULL");
  assertStringIncludes(sql, "'cancellation_converted'");
  assertStringIncludes(sql, "'postpone:'||v_release.id");
  assertStringIncludes(sql, "r.created_at>b.payout_hold_cutover_at");
  assertStringIncludes(
    sql,
    "CASE WHEN b.payment_provider='paystack' THEN o.stripe_payment_intent_id",
  );
  assertStringIncludes(sql, "'dark',true");
  assertStringIncludes(sql, "'executed',0");
  assertStringIncludes(sql, "FROM anon,authenticated");
});

Deno.test("#1171 cron and gateway contract are explicit and service-role sourced", () => {
  const blocks = [
    ...config.matchAll(
      /\[functions\.payout-release-sweep\][\s\S]*?(?=\n\[|$)/g,
    ),
  ];
  assertEquals(blocks.length, 1);
  assertStringIncludes(blocks[0][0], "verify_jwt = false");
  assertStringIncludes(sql, "issue_1171_payout_release_dark_sweep");
  assertStringIncludes(sql, "'*/30 * * * *'");
  assertStringIncludes(sql, "vault.decrypted_secrets");
  assertStringIncludes(sql, "'Authorization','Bearer ' ||");
  assert(!/\b(payouts|transfers)\.create\s*\(/.test(sql));
});

const behaviorSql = String.raw`
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id) VALUES ('11710000-0000-0000-0000-000000000001');
INSERT INTO public.creator_accounts(id)
VALUES ('11710000-0000-0000-0000-000000000001');
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,payout_hold_cutover_at
) VALUES (
  '11710000-0000-0000-0000-000000000010',
  '11710000-0000-0000-0000-000000000001',
  'Issue 1171 SQL Test','issue-1171-sql-test','USD','2026-07-01T00:00:00Z'
);
INSERT INTO public.events(id,brand_id,title,slug,status,currency)
VALUES
  ('11710000-0000-0000-0000-000000000101',
   '11710000-0000-0000-0000-000000000010','Event A','issue-1171-a','scheduled','USD'),
  ('11710000-0000-0000-0000-000000000102',
   '11710000-0000-0000-0000-000000000010','Event B','issue-1171-b','scheduled','USD');
INSERT INTO public.event_dates(id,event_id,start_at,end_at,is_master)
VALUES
  ('11710000-0000-0000-0000-000000000201',
   '11710000-0000-0000-0000-000000000101','2026-07-04T18:00:00Z','2026-07-04T20:00:00Z',true),
  ('11710000-0000-0000-0000-000000000202',
   '11710000-0000-0000-0000-000000000102','2026-07-04T18:00:00Z','2026-07-04T20:00:00Z',true);
SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  v_occurrence_a uuid;
  v_occurrence_b uuid;
  v_release_a uuid;
  v_release_b uuid;
  v_missing uuid;
  v_target uuid;
  v_origin uuid;
  v_conversion_origin uuid;
  v_debt uuid;
  v_permanent uuid;
  v_permanent_apply uuid;
  v_reopen_origin uuid;
  v_reopen_debt uuid;
  v_reopen_a uuid;
  v_reopen_b uuid;
  v_reopen_permanent uuid;
  v_failed boolean;
BEGIN
  SELECT event_date_id INTO v_occurrence_a
  FROM public.resolve_payout_live_occurrence(
    '11710000-0000-0000-0000-000000000101',NULL,'2026-07-02T00:00:00Z'
  );
  SELECT event_date_id INTO v_occurrence_b
  FROM public.resolve_payout_live_occurrence(
    '11710000-0000-0000-0000-000000000102',NULL,'2026-07-02T00:00:00Z'
  );
  IF v_occurrence_a=v_occurrence_b OR
     v_occurrence_a<>'11710000-0000-0000-0000-000000000201' OR
     v_occurrence_b<>'11710000-0000-0000-0000-000000000202' THEN
    RAISE EXCEPTION 'fallback occurrence identity was not event-scoped';
  END IF;

  v_release_a:=public.attach_payout_release(
    'order','11710000-0000-0000-0000-000000000301',
    '11710000-0000-0000-0000-000000000010',
    '11710000-0000-0000-0000-000000000101',v_occurrence_a,v_occurrence_a::text,
    'stripe','usd','2026-07-02T00:00:00Z','2026-07-04T20:00:00Z',
    1000,0,0,100,0,30
  );
  v_release_b:=public.attach_payout_release(
    'order','11710000-0000-0000-0000-000000000302',
    '11710000-0000-0000-0000-000000000010',
    '11710000-0000-0000-0000-000000000102',v_occurrence_b,v_occurrence_b::text,
    'stripe','usd','2026-07-02T00:00:00Z','2026-07-04T20:00:00Z',
    1000,0,0,100,0,30
  );
  IF v_release_a=v_release_b OR
     (SELECT count(*) FROM public.brand_payout_releases
      WHERE id IN (v_release_a,v_release_b))<>2 THEN
    RAISE EXCEPTION 'same-time events collided into one release';
  END IF;

  v_failed:=false;
  BEGIN
    PERFORM public.attach_payout_release(
      'order','11710000-0000-0000-0000-000000000303',
      '11710000-0000-0000-0000-000000000010',
      '11710000-0000-0000-0000-000000000101',v_occurrence_a,'cutover-equal',
      'stripe','usd','2026-07-01T00:00:00Z','2026-07-04T20:00:00Z',
      1000,0,0,0,0,0
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_failed:=true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'cutover equality was admitted'; END IF;

  UPDATE public.brand_payout_releases SET status='blocked_over_cap'
  WHERE id=v_release_a;
  UPDATE public.brand_payout_releases SET status='fee_unreconciled'
  WHERE id=v_release_b;
  INSERT INTO public.brand_payout_releases(
    brand_id,event_id,event_date_id,occurrence_key,surface,provider,currency,
    anchor_end_at,releasable_at,gross_cents,net_release_cents,status
  ) VALUES(
    '11710000-0000-0000-0000-000000000010',
    '11710000-0000-0000-0000-000000000102',NULL,'missing-occurrence',
    'rsvp_contribution','stripe','usd','2026-07-04T20:00:00Z',
    '2026-07-07T20:00:00Z',100,100,'fee_unreconciled'
  ) RETURNING id INTO v_missing;
  UPDATE public.event_dates SET end_at='2026-07-10T20:00:00Z'
  WHERE id=v_occurrence_a;
  UPDATE public.event_dates SET end_at='2026-07-06T20:00:00Z'
  WHERE id=v_occurrence_b;
  PERFORM public.refresh_pending_payout_release_truth('2026-07-05T00:00:00Z');
  IF (SELECT anchor_end_at FROM public.brand_payout_releases WHERE id=v_release_a)
       <>'2026-07-10T20:00:00Z' OR
     (SELECT anchor_end_at FROM public.brand_payout_releases WHERE id=v_release_b)
       <>'2026-07-06T20:00:00Z' OR
     (SELECT status FROM public.brand_payout_releases WHERE id=v_missing)
       <>'blocked_anchor' THEN
    RAISE EXCEPTION 'retryable releases did not refresh or fail closed';
  END IF;
  UPDATE public.events SET status='cancelled'
  WHERE id='11710000-0000-0000-0000-000000000101';
  PERFORM public.refresh_pending_payout_release_truth('2026-07-05T00:00:01Z');
  IF (SELECT status FROM public.brand_payout_releases WHERE id=v_release_a)
       <>'cancelled_event' THEN
    RAISE EXCEPTION 'pending release did not refresh cancellation truth';
  END IF;

  UPDATE public.brand_payout_releases
  SET status='released',released_at='2026-07-10T00:00:00Z',
      organiser_cash_delivered_cents=1000
  WHERE id=v_release_b;
  INSERT INTO public.event_dates(event_id,start_at,end_at)
  VALUES(
    '11710000-0000-0000-0000-000000000102',
    '2027-07-04T18:00:00Z','2027-07-04T20:00:00Z'
  );
  IF public.sync_post_release_postponement_debts('2026-07-10T00:00:00Z')<>0 THEN
    RAISE EXCEPTION 'recurrence top-up created false postponement debt';
  END IF;
  UPDATE public.event_dates SET end_at='2026-07-12T00:00:00Z'
  WHERE id=v_occurrence_b;
  IF public.sync_post_release_postponement_debts('2026-07-10T00:00:00Z')<>1 THEN
    RAISE EXCEPTION 'first forward edit did not open postponement debt';
  END IF;
  SELECT id INTO v_debt FROM public.organiser_payout_debts
  WHERE origin_release_id=v_release_b AND kind='post_release_postponement';
  UPDATE public.event_dates SET end_at='2026-07-14T00:00:00Z'
  WHERE id=v_occurrence_b;
  PERFORM public.sync_post_release_postponement_debts('2026-07-10T00:00:01Z');
  IF (SELECT count(*) FROM public.organiser_payout_debts
      WHERE origin_release_id=v_release_b
        AND kind='post_release_postponement')<>1 OR
     (SELECT maturity_at FROM public.organiser_payout_debts WHERE id=v_debt)
       <>'2026-07-17T00:00:00Z' THEN
    RAISE EXCEPTION 'second forward edit duplicated debt or kept stale anchor';
  END IF;
  UPDATE public.event_dates SET end_at='2026-07-06T20:00:00Z'
  WHERE id=v_occurrence_b;
  PERFORM public.sync_post_release_postponement_debts('2026-07-10T00:00:02Z');
  PERFORM public.mature_postponement_debts('2026-07-10T00:00:02Z');
  IF (SELECT (principal_cents,recovered_cents,status)
      FROM public.organiser_payout_debts WHERE id=v_debt)
       IS DISTINCT FROM ROW(1000,0,'closed'::text) THEN
    RAISE EXCEPTION 'backward edit left stale temporary withholding';
  END IF;
  UPDATE public.event_dates SET end_at='2026-07-20T00:00:00Z'
  WHERE id=v_occurrence_b;
  PERFORM public.sync_post_release_postponement_debts('2026-07-10T00:00:03Z');
  IF (SELECT (id,principal_cents,recovered_cents,status)
      FROM public.organiser_payout_debts WHERE id=v_debt)
       IS DISTINCT FROM ROW(v_debt,1000,0,'open'::text) OR
     (SELECT count(*) FROM public.organiser_payout_debts
      WHERE origin_release_id=v_release_b
        AND kind='post_release_postponement')<>1 THEN
    RAISE EXCEPTION 'legitimate re-postponement did not reopen same clean debt';
  END IF;
  PERFORM public.mature_postponement_debts('2026-07-23T00:00:00Z');

  INSERT INTO public.payout_source_fee_snapshots(
    source_type,source_id,provider_fee_cents
  ) VALUES('order','11710000-0000-0000-0000-000000000301',30);
  v_failed:=false;
  BEGIN
    UPDATE public.payout_source_fee_snapshots SET provider_fee_cents=31
    WHERE source_id='11710000-0000-0000-0000-000000000301';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_failed:=true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'fee snapshot was mutable'; END IF;

  INSERT INTO public.brand_payout_releases(
    brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,
    gross_cents,net_release_cents,status,organiser_cash_delivered_cents,released_at
  ) VALUES(
    '11710000-0000-0000-0000-000000000010','maturity-origin',
    'venue_reservation','stripe','usd','2026-06-20T00:00:00Z',
    '2026-06-23T00:00:00Z',1000,1000,'released',1000,'2026-06-23T00:00:00Z'
  ) RETURNING id INTO v_origin;
  INSERT INTO public.brand_payout_releases(
    brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,
    gross_cents,net_release_cents,status
  ) VALUES(
    '11710000-0000-0000-0000-000000000010','debt-target',
    'venue_reservation','stripe','usd','2026-06-28T00:00:00Z',
    '2026-07-01T00:00:00Z',600,600,'pending'
  ) RETURNING id INTO v_target;
  v_debt:=public.open_post_release_postponement_debt(
    v_origin,'2026-07-02T00:00:00Z'
  );
  IF public.apply_open_payout_debts(v_target,'2026-07-03T00:00:00Z')<>600 THEN
    RAISE EXCEPTION 'temporary debt did not reserve future value';
  END IF;
  IF public.mature_postponement_debts('2026-07-05T00:00:00Z')<>1 THEN
    RAISE EXCEPTION 'maturity did not process exactly one debt';
  END IF;
  IF (SELECT amount_cents FROM public.payout_ledger_adjustments
      WHERE idempotency_key LIKE 'postpone-recredit:%')<>600 OR
     NOT EXISTS(
       SELECT 1 FROM public.payout_debt_applications
       WHERE debt_id=v_debt AND released_at='2026-07-05T00:00:00Z'
     ) OR
     NOT EXISTS(
       SELECT 1 FROM public.payout_debt_events
       WHERE debt_id=v_debt AND event_kind='future_value_released'
     ) THEN
    RAISE EXCEPTION 'maturity did not recredit and release applications';
  END IF;

  INSERT INTO public.brand_payout_releases(
    brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,
    gross_cents,net_release_cents,status,organiser_cash_delivered_cents,released_at
  ) VALUES(
    '11710000-0000-0000-0000-000000000010','conversion-origin',
    'venue_reservation','stripe','usd','2026-06-20T00:00:00Z',
    '2026-06-23T00:00:00Z',1000,1000,'released',1000,'2026-06-23T00:00:00Z'
  ) RETURNING id INTO v_conversion_origin;
  v_debt:=public.open_post_release_postponement_debt(
    v_conversion_origin,'2026-07-10T00:00:00Z'
  );
  UPDATE public.brand_payout_releases SET status='pending',net_release_cents=400
  WHERE id=v_target;
  PERFORM public.apply_open_payout_debts(v_target,'2026-07-11T00:00:00Z');
  v_permanent:=public.convert_postponement_debt_to_permanent(
    v_conversion_origin,'post_release_refund',400,'2026-07-11T00:00:01Z'
  );
  IF (SELECT (principal_cents,recovered_cents,status)
      FROM public.organiser_payout_debts WHERE id=v_debt)
       IS DISTINCT FROM ROW(600,0,'open'::text) OR
     (SELECT (principal_cents,recovered_cents,status)
      FROM public.organiser_payout_debts WHERE id=v_permanent)
       IS DISTINCT FROM ROW(400,400,'closed'::text) OR
     NOT EXISTS(
       SELECT 1 FROM public.payout_debt_applications
       WHERE debt_id=v_debt AND converted_cents=400
     ) OR
     NOT EXISTS(
       SELECT 1 FROM public.payout_debt_events
       WHERE debt_id=v_debt AND event_kind='cancellation_converted'
     ) OR
     NOT EXISTS(
       SELECT 1 FROM public.payout_debt_events
       WHERE debt_id=v_permanent AND event_kind='cleared'
     ) THEN
    RAISE EXCEPTION 'temporary-to-permanent debt conversion was not atomic';
  END IF;
  INSERT INTO public.organiser_payout_debts(
    brand_id,currency,origin_release_id,kind,principal_cents,idempotency_key
  ) VALUES(
    '11710000-0000-0000-0000-000000000010','usd',v_conversion_origin,
    'post_release_dispute',400,'permanent-apply-close'
  ) RETURNING id INTO v_permanent_apply;
  UPDATE public.brand_payout_releases
  SET status='pending',net_release_cents=400
  WHERE id=v_target;
  PERFORM public.apply_open_payout_debts(v_target,'2026-07-11T00:00:02Z');
  IF (SELECT status FROM public.organiser_payout_debts
      WHERE id=v_permanent_apply)<>'closed' OR
     NOT EXISTS(
       SELECT 1 FROM public.payout_debt_events
       WHERE debt_id=v_permanent_apply AND event_kind='cleared'
     ) THEN
    RAISE EXCEPTION 'fully recovered permanent debt remained open';
  END IF;

  INSERT INTO public.brand_payout_releases(
    brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,
    gross_cents,net_release_cents,status,organiser_cash_delivered_cents,released_at
  ) VALUES(
    '11710000-0000-0000-0000-000000000010','reopen-origin',
    'venue_reservation','stripe','usd','2026-07-20T00:00:00Z',
    '2026-07-23T00:00:00Z',600,600,'released',600,'2026-07-23T00:00:00Z'
  ) RETURNING id INTO v_reopen_origin;
  INSERT INTO public.brand_payout_releases(
    brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,
    gross_cents,net_release_cents,status
  ) VALUES(
    '11710000-0000-0000-0000-000000000010','reopen-reserve-a',
    'venue_reservation','stripe','usd','2026-07-28T00:00:00Z',
    '2026-07-31T00:00:00Z',600,600,'pending'
  ) RETURNING id INTO v_reopen_a;
  INSERT INTO public.brand_payout_releases(
    brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,
    gross_cents,net_release_cents,status
  ) VALUES(
    '11710000-0000-0000-0000-000000000010','reopen-reserve-b',
    'venue_reservation','stripe','usd','2026-08-07T00:00:00Z',
    '2026-08-10T00:00:00Z',600,600,'pending'
  ) RETURNING id INTO v_reopen_b;

  v_reopen_debt:=public.open_post_release_postponement_debt(
    v_reopen_origin,'2026-08-02T00:00:00Z'
  );
  IF public.apply_open_payout_debts(
       v_reopen_a,'2026-08-03T00:00:00Z'
     )<>600 THEN
    RAISE EXCEPTION 'lifecycle A did not reserve';
  END IF;
  PERFORM public.mature_postponement_debts('2026-08-05T00:00:00Z');
  IF NOT EXISTS(
       SELECT 1 FROM public.payout_debt_applications
       WHERE debt_id=v_reopen_debt AND release_id=v_reopen_a
         AND released_at='2026-08-05T00:00:00Z' AND converted_cents=0
     ) OR
     NOT EXISTS(
       SELECT 1 FROM public.payout_ledger_adjustments
       WHERE release_id=v_reopen_a AND kind='maturity_recredit'
         AND amount_cents=600
     ) THEN
    RAISE EXCEPTION 'lifecycle A did not preserve released historical truth';
  END IF;

  IF public.open_post_release_postponement_debt(
       v_reopen_origin,'2026-08-10T00:00:00Z'
     )<>v_reopen_debt OR
     public.apply_open_payout_debts(
       v_reopen_b,'2026-08-11T00:00:00Z'
     )<>600 THEN
    RAISE EXCEPTION 'lifecycle B did not reopen and reserve on the same debt';
  END IF;
  v_reopen_permanent:=public.convert_postponement_debt_to_permanent(
    v_reopen_origin,'post_release_cancellation',600,'2026-08-11T00:00:01Z'
  );
  IF NOT EXISTS(
       SELECT 1 FROM public.payout_debt_applications
       WHERE debt_id=v_reopen_debt AND release_id=v_reopen_a
         AND released_at IS NOT NULL AND converted_cents=0
     ) OR
     NOT EXISTS(
       SELECT 1 FROM public.payout_debt_applications
       WHERE debt_id=v_reopen_debt AND release_id=v_reopen_b
         AND released_at IS NULL AND converted_cents=600
     ) OR
     NOT EXISTS(
       SELECT 1 FROM public.payout_debt_applications
       WHERE debt_id=v_reopen_permanent AND release_id=v_reopen_b
         AND amount_cents=600
     ) OR
     EXISTS(
       SELECT 1 FROM public.payout_debt_applications
       WHERE debt_id=v_reopen_permanent AND release_id=v_reopen_a
     ) THEN
    RAISE EXCEPTION 'conversion consumed historical A instead of current B';
  END IF;
  PERFORM public.mature_postponement_debts('2026-08-13T00:00:00Z');
  IF EXISTS(
       SELECT 1 FROM public.payout_ledger_adjustments
       WHERE release_id=v_reopen_b AND kind='maturity_recredit'
     ) THEN
    RAISE EXCEPTION 'converted lifecycle B escaped as a later recredit';
  END IF;
END
$test$;
ROLLBACK;
`;

if (Deno.env.get("ISSUE_1171_SQL_BEHAVIOR") === "1") {
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
        "postgres",
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

  Deno.test("#1171 executable PostgreSQL behavior contract", async () => {
    const container = Deno.env.get("ISSUE_1171_POSTGRES_CONTAINER") ??
      "issue1171-pg-20260724";
    const result = await runDockerSql(container, behaviorSql);
    assertEquals(
      result.code,
      0,
      new TextDecoder().decode(result.stderr),
    );
  });

  Deno.test("#1171 concurrent cross-key duplicate attach leaves one release", async () => {
    const container = Deno.env.get("ISSUE_1171_POSTGRES_CONTAINER") ??
      "issue1171-pg-20260724";
    const cleanup = String.raw`
SET session_replication_role=replica;
DELETE FROM public.payout_release_items
WHERE source_id='11710000-0000-0000-0000-000000000901';
DELETE FROM public.brand_payout_releases
WHERE brand_id='11710000-0000-0000-0000-000000000910';
DELETE FROM public.event_dates
WHERE event_id='11710000-0000-0000-0000-000000000911';
DELETE FROM public.events
WHERE id='11710000-0000-0000-0000-000000000911';
DELETE FROM public.brands
WHERE id='11710000-0000-0000-0000-000000000910';
DELETE FROM public.creator_accounts
WHERE id='11710000-0000-0000-0000-000000000900';
DELETE FROM auth.users
WHERE id='11710000-0000-0000-0000-000000000900';
SET session_replication_role=origin;
`;
    const setup = cleanup + String.raw`
SET session_replication_role=replica;
INSERT INTO auth.users(id)
VALUES('11710000-0000-0000-0000-000000000900');
INSERT INTO public.creator_accounts(id)
VALUES('11710000-0000-0000-0000-000000000900');
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,payout_hold_cutover_at
) VALUES(
  '11710000-0000-0000-0000-000000000910',
  '11710000-0000-0000-0000-000000000900',
  'Issue 1171 Race','issue-1171-race','USD','2026-07-01T00:00:00Z'
);
INSERT INTO public.events(id,brand_id,title,slug,status,currency)
VALUES(
  '11710000-0000-0000-0000-000000000911',
  '11710000-0000-0000-0000-000000000910',
  'Race Event','issue-1171-race-event','scheduled','USD'
);
INSERT INTO public.event_dates(id,event_id,start_at,end_at,is_master)
VALUES(
  '11710000-0000-0000-0000-000000000912',
  '11710000-0000-0000-0000-000000000911',
  '2026-07-04T18:00:00Z','2026-07-04T20:00:00Z',true
);
SET session_replication_role=origin;
`;
    const first = String.raw`
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended(
  'order:11710000-0000-0000-0000-000000000901',1171
));
SELECT public.attach_payout_release(
  'order','11710000-0000-0000-0000-000000000901',
  '11710000-0000-0000-0000-000000000910',
  '11710000-0000-0000-0000-000000000911',
  '11710000-0000-0000-0000-000000000912','race-key-a',
  'stripe','usd','2026-07-02T00:00:00Z','2026-07-04T20:00:00Z',
  1000,0,0,0,0,30
);
SELECT pg_sleep(1);
COMMIT;
`;
    const second = String.raw`
SELECT public.attach_payout_release(
  'order','11710000-0000-0000-0000-000000000901',
  '11710000-0000-0000-0000-000000000910',
  '11710000-0000-0000-0000-000000000911',
  '11710000-0000-0000-0000-000000000912','race-key-b',
  'stripe','usd','2026-07-02T00:00:00Z','2026-07-04T20:00:00Z',
  1000,0,0,0,0,30
);
`;
    const setupResult = await runDockerSql(container, setup);
    assertEquals(
      setupResult.code,
      0,
      new TextDecoder().decode(setupResult.stderr),
    );
    try {
      const firstCommand = await spawnDockerSql(container, first);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const secondCommand = await spawnDockerSql(container, second);
      const [firstResult, secondResult] = await Promise.all([
        firstCommand.output(),
        secondCommand.output(),
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
      const idPattern =
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
      const firstId = new TextDecoder().decode(firstResult.stdout).match(
        idPattern,
      )?.[0];
      const secondId = new TextDecoder().decode(secondResult.stdout).match(
        idPattern,
      )?.[0];
      assert(firstId);
      assertEquals(secondId, firstId);
      const proof = await runDockerSql(
        container,
        String.raw`
SELECT
  (SELECT count(*) FROM public.brand_payout_releases
   WHERE brand_id='11710000-0000-0000-0000-000000000910'),
  (SELECT count(*) FROM public.payout_release_items i
   JOIN public.brand_payout_releases r ON r.id=i.release_id
   WHERE r.brand_id='11710000-0000-0000-0000-000000000910'),
  (SELECT count(*) FROM public.brand_payout_releases r
   WHERE r.brand_id='11710000-0000-0000-0000-000000000910'
     AND NOT EXISTS(
       SELECT 1 FROM public.payout_release_items i WHERE i.release_id=r.id
     ));
`,
      );
      assertEquals(proof.code, 0, new TextDecoder().decode(proof.stderr));
      assertEquals(new TextDecoder().decode(proof.stdout).trim(), "1|1|0");
    } finally {
      await runDockerSql(container, cleanup);
    }
  });
}
