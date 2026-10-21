-- Issue #3645 — independent tester adversarial suite for the payout-run gate.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE issue_3645_adversarial_fx(k text PRIMARY KEY, v uuid NOT NULL);

DO $seed$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_owner constant uuid := '3645ad00-0000-4000-8000-000000000001';
  v_brand constant uuid := '3645ad00-0000-4000-8000-000000000002';
  v_event constant uuid := '3645ad00-0000-4000-8000-000000000003';
  v_date  constant uuid := '3645ad00-0000-4000-8000-000000000004';
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3645-adversarial@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 Adversarial', 'issue-3645-adversarial',
    'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01 00:00:00+00'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Issue 3645 Adversarial Event',
          'issue-3645-adversarial-event', 'live', 'USD');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
  VALUES (v_date, v_event, v_now + interval '30 days',
          v_now + interval '30 days 2 hours', 'UTC', true);
  INSERT INTO issue_3645_adversarial_fx VALUES
    ('owner', v_owner), ('brand', v_brand), ('event', v_event), ('date', v_date);
END
$seed$;

CREATE FUNCTION pg_temp.fx(p_key text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT v FROM issue_3645_adversarial_fx WHERE k = p_key
$$;

-- A1: direct attach against a released unit mints a new generation and never
-- mutates the old row. If the chosen row becomes non-pending before the item
-- insert/totals rewrite, the function must fail closed with release_not_pending.
DO $a1$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_source_a constant uuid := '3645ad00-0000-4000-8000-000000000101';
  v_source_b constant uuid := '3645ad00-0000-4000-8000-000000000102';
  v_release_a uuid;
  v_release_b uuid;
  v_before record;
BEGIN
  v_release_a := public.attach_payout_release(
    'order', v_source_a, pg_temp.fx('brand'), pg_temp.fx('event'), pg_temp.fx('date'),
    pg_temp.fx('date')::text, 'stripe', 'USD', v_now - interval '27 hours',
    v_now + interval '30 days 2 hours', 10000, 0, 0, 450, 0, 320
  );
  UPDATE public.brand_payout_releases
  SET status = 'released', released_at = v_now - interval '1 hour',
      organiser_cash_delivered_cents = net_release_cents
  WHERE id = v_release_a;
  SELECT gross_cents, net_release_cents,
         (SELECT count(*) FROM public.payout_release_items WHERE release_id = v_release_a) item_count
  INTO v_before FROM public.brand_payout_releases WHERE id = v_release_a;

  v_release_b := public.attach_payout_release(
    'order', v_source_b, pg_temp.fx('brand'), pg_temp.fx('event'), pg_temp.fx('date'),
    pg_temp.fx('date')::text, 'stripe', 'USD', v_now - interval '26 hours',
    v_now + interval '30 days 2 hours', 5000, 0, 0, 225, 0, 160
  );
  IF v_release_b = v_release_a
     OR (SELECT occurrence_key FROM public.brand_payout_releases WHERE id = v_release_b)
        <> pg_temp.fx('date')::text || '#1'
     OR (SELECT (gross_cents, net_release_cents) FROM public.brand_payout_releases
         WHERE id = v_release_a) IS DISTINCT FROM ROW(v_before.gross_cents, v_before.net_release_cents)
     OR (SELECT count(*) FROM public.payout_release_items WHERE release_id = v_release_a)
        <> v_before.item_count THEN
    RAISE EXCEPTION 'A1: direct attach mutated or reused the released row';
  END IF;
END
$a1$;

CREATE FUNCTION pg_temp.issue_3645_force_nonpending() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE public.brand_payout_releases
  SET status = 'released', released_at = now(),
      organiser_cash_delivered_cents = net_release_cents
  WHERE id = NEW.release_id;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER issue_3645_force_nonpending_before_item
BEFORE INSERT ON public.payout_release_items
FOR EACH ROW EXECUTE FUNCTION pg_temp.issue_3645_force_nonpending();

DO $a1_forced$
DECLARE
  v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM public.attach_payout_release(
      'order', '3645ad00-0000-4000-8000-000000000103',
      pg_temp.fx('brand'), pg_temp.fx('event'), pg_temp.fx('date'),
      'forced-unit', 'stripe', 'USD', timestamptz '2026-10-20 08:00:00+00',
      timestamptz '2026-11-20 14:00:00+00', 1000, 0, 0, 45, 0, 30
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'release_not_pending' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'A1: forced non-pending target did not raise release_not_pending';
  END IF;
END
$a1_forced$;

DROP TRIGGER issue_3645_force_nonpending_before_item ON public.payout_release_items;

-- A2: once money is released, a later event-date edit cannot create a
-- post_release_postponement debt.
DO $a2$
DECLARE
  v_release uuid;
BEGIN
  SELECT release_id INTO v_release
  FROM public.payout_release_items
  WHERE source_type = 'order'
    AND source_id = '3645ad00-0000-4000-8000-000000000101';
  UPDATE public.event_dates
  SET start_at = start_at + interval '30 days', end_at = end_at + interval '30 days'
  WHERE id = pg_temp.fx('date');
  IF public.sync_post_release_postponement_debts(timestamptz '2026-10-21 12:00:00+00') <> 0
     OR EXISTS (
       SELECT 1 FROM public.organiser_payout_debts
       WHERE origin_release_id = v_release AND kind = 'post_release_postponement'
     ) THEN
    RAISE EXCEPTION 'A2: event postponement opened a claw-back debt';
  END IF;
END
$a2$;

-- A3: cancellation still wins over the 24h clock.
DO $a3$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_event constant uuid := '3645ad00-0000-4000-8000-000000000201';
  v_date constant uuid := '3645ad00-0000-4000-8000-000000000202';
  v_order constant uuid := '3645ad00-0000-4000-8000-000000000203';
BEGIN
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, pg_temp.fx('brand'), 'Cancelled A3', 'issue-3645-a3', 'cancelled', 'USD');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
  VALUES (v_date, v_event, v_now + interval '30 days', v_now + interval '30 days 2 hours', 'UTC', true);
  INSERT INTO public.orders(
    id, event_id, event_date_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, buyer_phone_e164,
    stripe_application_fee_amount_cents, created_at
  ) VALUES (v_order, v_event, v_date, 1000, 'USD', 'paid', 'pi_3645_a3',
            'ch_3645_a3', 'online_checkout', '+12125550203', 45,
            v_now - interval '25 hours');
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', v_order, 30);
  PERFORM public.run_payout_release_dark_sweep(v_now);
  IF EXISTS (SELECT 1 FROM public.payout_release_items
             WHERE source_type = 'order' AND source_id = v_order) THEN
    RAISE EXCEPTION 'A3: cancelled event sale attached';
  END IF;
END
$a3$;

-- A4: the existing cutover guard remains absolute.
DO $a4$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_owner constant uuid := '3645ad00-0000-4000-8000-000000000301';
  v_brand constant uuid := '3645ad00-0000-4000-8000-000000000302';
  v_event constant uuid := '3645ad00-0000-4000-8000-000000000303';
  v_date constant uuid := '3645ad00-0000-4000-8000-000000000304';
  v_order constant uuid := '3645ad00-0000-4000-8000-000000000305';
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'issue-3645-a4@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (v_brand, v_owner, 'Issue 3645 No Cutover', 'issue-3645-no-cutover',
            'stripe', 'US', 'USD', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'No Cutover A4', 'issue-3645-a4', 'live', 'USD');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
  VALUES (v_date, v_event, v_now + interval '30 days', v_now + interval '30 days 2 hours', 'UTC', true);
  INSERT INTO public.orders(
    id, event_id, event_date_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, buyer_phone_e164,
    stripe_application_fee_amount_cents, created_at
  ) VALUES (v_order, v_event, v_date, 1000, 'USD', 'paid', 'pi_3645_a4',
            'ch_3645_a4', 'online_checkout', '+12125550305', 45,
            v_now - interval '25 hours');
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', v_order, 30);
  PERFORM public.run_payout_release_dark_sweep(v_now);
  IF EXISTS (SELECT 1 FROM public.payout_release_items
             WHERE source_type = 'order' AND source_id = v_order) THEN
    RAISE EXCEPTION 'A4: brand without payout cutover attached';
  END IF;
END
$a4$;

-- A5: the boundary is inclusive at exactly one day, and not one second early.
DO $a5$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_exact constant uuid := '3645ad00-0000-4000-8000-000000000401';
  v_early constant uuid := '3645ad00-0000-4000-8000-000000000402';
BEGIN
  INSERT INTO public.orders(
    id, event_id, event_date_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, buyer_phone_e164,
    stripe_application_fee_amount_cents, created_at
  ) VALUES
    (v_exact, pg_temp.fx('event'), pg_temp.fx('date'), 1000, 'USD', 'paid',
     'pi_3645_a5_exact', 'ch_3645_a5_exact', 'online_checkout', '+12125550401',
     45, v_now - interval '1 day'),
    (v_early, pg_temp.fx('event'), pg_temp.fx('date'), 1000, 'USD', 'paid',
     'pi_3645_a5_early', 'ch_3645_a5_early', 'online_checkout', '+12125550402',
     45, v_now - interval '1 day' + interval '1 second');
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', v_exact, 30), ('order', v_early, 30);
  PERFORM public.run_payout_release_dark_sweep(v_now);
  IF NOT EXISTS (SELECT 1 FROM public.payout_release_items
                 WHERE source_type = 'order' AND source_id = v_exact)
     OR EXISTS (SELECT 1 FROM public.payout_release_items
                WHERE source_type = 'order' AND source_id = v_early) THEN
    RAISE EXCEPTION 'A5: 24h boundary was not exact';
  END IF;
END
$a5$;

-- A6: none of the three live function bodies may retain the old 3-day rule.
DO $a6$
DECLARE
  v_name text;
  v_def text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'run_payout_release_dark_sweep',
    'run_stay_payout_release_dark_sweep',
    'issue_1389_attach_stay_payout_release'
  ] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name
    ORDER BY p.oid DESC LIMIT 1;
    IF v_def IS NULL OR position('interval ''3 days''' IN v_def) > 0 THEN
      RAISE EXCEPTION 'A6: % still contains the old 3-day interval', v_name;
    END IF;
  END LOOP;
END
$a6$;

ROLLBACK;

-- A7 is intentionally outside the transaction above: loopback sessions must
-- see committed fixtures. Connection A mints #1 and settles it while holding
-- the base-unit advisory lock; connection B overlaps, waits, then mints #2.
\getenv issue3645_pw PGPASSWORD
CREATE SCHEMA issue_3645_a7;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA issue_3645_a7;
SELECT n.nspname AS issue3645_dblink_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'dblink' \gset
SET search_path = public, :"issue3645_dblink_schema";

CREATE TABLE issue_3645_a7.fx AS
SELECT
  '3645a700-0000-4000-8000-000000000001'::uuid owner_id,
  '3645a700-0000-4000-8000-000000000002'::uuid brand_id,
  '3645a700-0000-4000-8000-000000000003'::uuid event_id,
  '3645a700-0000-4000-8000-000000000004'::uuid date_id,
  '3645a700-0000-4000-8000-000000000005'::uuid base_source_id,
  '3645a700-0000-4000-8000-000000000006'::uuid source_a,
  '3645a700-0000-4000-8000-000000000007'::uuid source_b,
  format('host=127.0.0.1 port=%s dbname=%I user=%I password=%s',
         current_setting('port'), current_database(), current_user, :'issue3645_pw') conn;

INSERT INTO auth.users(id) SELECT owner_id FROM issue_3645_a7.fx;
INSERT INTO public.creator_accounts(id, email)
SELECT owner_id, 'issue-3645-a7@example.test' FROM issue_3645_a7.fx;
INSERT INTO public.brands(
  id, account_id, name, slug, payment_provider, pricing_region,
  pricing_currency, default_currency, payout_hold_cutover_at
)
SELECT brand_id, owner_id, 'Issue 3645 A7', 'issue-3645-a7',
       'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01 00:00:00+00'
FROM issue_3645_a7.fx;
INSERT INTO public.events(id, brand_id, title, slug, status, currency)
SELECT event_id, brand_id, 'Issue 3645 A7 Event', 'issue-3645-a7-event', 'live', 'USD'
FROM issue_3645_a7.fx;
INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
SELECT date_id, event_id, now() + interval '30 days', now() + interval '30 days 2 hours',
       'UTC', true FROM issue_3645_a7.fx;

DO $a7_base$
DECLARE v record; v_release uuid;
BEGIN
  SELECT * INTO v FROM issue_3645_a7.fx;
  v_release := public.attach_payout_release(
    'order', v.base_source_id, v.brand_id, v.event_id, v.date_id,
    v.date_id::text, 'stripe', 'USD', now() - interval '30 hours',
    now() + interval '30 days', 1000, 0, 0, 45, 0, 30
  );
  UPDATE public.brand_payout_releases
  SET status = 'released', released_at = now(),
      organiser_cash_delivered_cents = net_release_cents
  WHERE id = v_release;
END
$a7_base$;

CREATE FUNCTION issue_3645_a7.attach_settle_and_hold() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, issue_3645_a7 AS $fn$
DECLARE v issue_3645_a7.fx%ROWTYPE; v_release uuid; v_key text;
BEGIN
  SELECT * INTO v FROM issue_3645_a7.fx;
  v_release := public.attach_payout_release(
    'order', v.source_a, v.brand_id, v.event_id, v.date_id,
    v.date_id::text, 'stripe', 'USD', now() - interval '29 hours',
    now() + interval '30 days', 1100, 0, 0, 50, 0, 31
  );
  UPDATE public.brand_payout_releases
  SET status = 'released', released_at = now(),
      organiser_cash_delivered_cents = net_release_cents
  WHERE id = v_release;
  SELECT occurrence_key INTO v_key FROM public.brand_payout_releases WHERE id = v_release;
  PERFORM pg_sleep(1);
  RETURN v_key;
END
$fn$;

DO $a7$
DECLARE
  v issue_3645_a7.fx%ROWTYPE;
  v_a text;
  v_b text;
BEGIN
  SELECT * INTO v FROM issue_3645_a7.fx;
  PERFORM dblink_connect('issue3645_a', v.conn);
  PERFORM dblink_connect('issue3645_b', v.conn);
  PERFORM dblink_send_query('issue3645_a',
    'SELECT issue_3645_a7.attach_settle_and_hold()');
  PERFORM pg_sleep(0.15);
  PERFORM dblink_send_query('issue3645_b', format(
    'WITH attached AS (SELECT public.attach_payout_release('
    '''order'', %L, %L, %L, %L, %L, ''stripe'', ''USD'', now()-interval ''28 hours'', '
    'now()+interval ''30 days'', 1200, 0, 0, 54, 0, 32) id) '
    'SELECT r.occurrence_key FROM public.brand_payout_releases r JOIN attached a ON a.id=r.id',
    v.source_b, v.brand_id, v.event_id, v.date_id, v.date_id::text
  ));
  IF dblink_is_busy('issue3645_b') <> 1 THEN
    RAISE EXCEPTION 'A7: second attach did not wait on the base-unit lock';
  END IF;
  -- Drain both asynchronous results so any remote error fails this suite, then
  -- inspect the committed authoritative rows rather than libpq's result shape.
  PERFORM * FROM dblink_get_result('issue3645_a') AS t(occurrence_key text);
  PERFORM * FROM dblink_get_result('issue3645_b') AS t(occurrence_key text);
  PERFORM dblink_disconnect('issue3645_a');
  PERFORM dblink_disconnect('issue3645_b');
  SELECT release_row.occurrence_key INTO v_a
  FROM public.payout_release_items item
  JOIN public.brand_payout_releases release_row ON release_row.id = item.release_id
  WHERE item.source_type = 'order' AND item.source_id = v.source_a;
  SELECT release_row.occurrence_key INTO v_b
  FROM public.payout_release_items item
  JOIN public.brand_payout_releases release_row ON release_row.id = item.release_id
  WHERE item.source_type = 'order' AND item.source_id = v.source_b;
  IF ARRAY[v_a, v_b] <> ARRAY[v.date_id::text || '#1', v.date_id::text || '#2']
     OR (SELECT count(*) FROM public.brand_payout_releases
         WHERE brand_id = v.brand_id AND occurrence_key IN (
           v.date_id::text || '#1', v.date_id::text || '#2'
         )) <> 2 THEN
    RAISE EXCEPTION 'A7: concurrent generation keys were % and %', v_a, v_b;
  END IF;
END
$a7$;

BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.payout_release_items item USING issue_3645_a7.fx v
WHERE item.source_id IN (v.base_source_id, v.source_a, v.source_b);
DELETE FROM public.brand_payout_releases release_row USING issue_3645_a7.fx v
WHERE release_row.brand_id = v.brand_id;
DELETE FROM public.event_dates event_date USING issue_3645_a7.fx v
WHERE event_date.id = v.date_id;
DELETE FROM public.events event_row USING issue_3645_a7.fx v
WHERE event_row.id = v.event_id;
DELETE FROM public.brand_team_members member USING issue_3645_a7.fx v
WHERE member.brand_id = v.brand_id;
DELETE FROM public.brands brand USING issue_3645_a7.fx v WHERE brand.id = v.brand_id;
DELETE FROM public.creator_accounts account USING issue_3645_a7.fx v
WHERE account.id = v.owner_id;
DELETE FROM auth.users user_row USING issue_3645_a7.fx v WHERE user_row.id = v.owner_id;
COMMIT;
RESET search_path;
DROP SCHEMA issue_3645_a7 CASCADE;

\echo 'issue_3645_payout_gate_24h.tester.adversarial.pg17: PASS'
