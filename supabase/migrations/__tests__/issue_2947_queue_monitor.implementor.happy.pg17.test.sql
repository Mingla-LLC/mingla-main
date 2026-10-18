-- MINGLA-INVARIANT: I-PROPOSED-2947-MONITORS-CARRY-THE-EVENT-DENOMINATOR | issue #2947 | Every queue monitor records checks_run and queue_windows_observed and never returns clean when the event denominator is zero.
-- #2879 / #2947 — queue monitor with the EVENT denominator.
--
-- WHAT IS PROVED
--   C-01  Zero-event window ⇒ insufficient_evidence (never clean).
--   C-02  Queue waiting, observe without admit ⇒ stalled.
--   C-03  Join + admit_due ⇒ clean; write-driven joins/admissions counted.
--   C-04  admit_due calls observe (a run row appears after the driver).
--   C-05  Orphan assert raises for a persistent (past grace) infinity orphan.
--   C-06  Fresh stalled after a prior clean when waiting remains and admit stops.
--   C-07  admit_due does not admit before sale_opens_at; pre-sale waiting is not stalled.
--   C-08  Saturated live-hold ceiling with waiting buyers is not stalled.
--   C-09  Unconsumed lower-id events are still claimed after a higher id was acked.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.i2947m_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2947 queue monitor FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.i2947m_tier(p_tag text, p_total integer,
                                              OUT o_event uuid, OUT o_tier uuid)
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
BEGIN
  o_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'i2947m-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (v_brand, v_user, 'Issue 2947 M ' || p_tag, 'issue-2947-m-' || p_tag || '-' || v_brand,
            'stripe', 'US', 'USD', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme)
    VALUES (o_event, v_brand, 'Issue 2947 M ' || p_tag, 'issue-2947-m-' || p_tag || '-' || o_event,
            'event', 'scheduled', 'public', 'UTC', 'USD', now(),
            jsonb_build_object('business_event', jsonb_build_object(
              'format', 'in_person', 'hideAddressUntilTicket', false,
              'settings', jsonb_build_object('privateGuestList', false))));
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '20 days', now() + interval '20 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, quantity_total, currency)
    VALUES (o_event, 'GA', 0, p_total, 'USD') RETURNING id INTO o_tier;
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.i2947m_hold(p_event uuid, p_tier uuid)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v := public.biz_ticket_checkout_create_session(
    p_event, NULL, 'Mon Guest', 'mon@example.test', '+15550002947', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', p_tier, 'quantity', 1)),
    'i2947m:' || gen_random_uuid()::text, 'infinity'::timestamptz, 0, 'auto', NULL);
  RETURN (v ->> 'checkoutSessionId')::uuid;
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.i2947m_token(p_n integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $t$
  SELECT md5('i2947m-device-' || p_n) || md5('i2947m-device-pad-' || p_n)
$t$;

CREATE OR REPLACE FUNCTION pg_temp.i2947m_arm(p_tier uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(p_tier);
  UPDATE public.ticket_queue_arming
     SET last_admitted_at = clock_timestamp() - interval '60 seconds',
         sale_opens_at = clock_timestamp() - interval '1 hour'
   WHERE ticket_type_id = p_tier;
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.i2947m_reset_monitor()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  DELETE FROM public.ticket_queue_monitor_runs;
  UPDATE public.ticket_queue_monitor_events
     SET consumed_at = clock_timestamp()
   WHERE consumed_at IS NULL;
END
$f$;

-- ─── C-01: zero-event ⇒ insufficient_evidence ──────────────────────────────
BEGIN;
DO $c01$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp.i2947m_reset_monitor();
  PERFORM public.issue_2947_queue_monitor_observe();
  v := public.issue_2947_queue_verdict(72);
  PERFORM pg_temp.i2947m_assert(v->>'verdict' = 'insufficient_evidence',
    'C-01a zero-event window is insufficient_evidence (got ' || (v->>'verdict') || ')');
  PERFORM pg_temp.i2947m_assert((v->>'queueWindowsObserved')::int = 0,
    'C-01b event denominator is 0');
  PERFORM pg_temp.i2947m_assert(v->>'verdict' <> 'clean',
    'C-01c never clean while events_observed is 0');
END
$c01$;
ROLLBACK;

-- ─── C-02: waiting queue, no admit ⇒ stalled ───────────────────────────────
BEGIN;
DO $c02$
DECLARE
  f record;
  v_s uuid;
  v jsonb;
  i integer;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947m_tier('c02', 50);
  PERFORM pg_temp.i2947m_arm(f.o_tier);
  PERFORM pg_temp.i2947m_reset_monitor();

  FOR i IN 1..3 LOOP
    v_s := pg_temp.i2947m_hold(f.o_event, f.o_tier);
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.i2947m_token(i));
  END LOOP;

  PERFORM public.issue_2947_queue_monitor_observe();
  v := public.issue_2947_queue_verdict(72);
  PERFORM pg_temp.i2947m_assert(v->>'verdict' = 'stalled',
    'C-02a waiting queue with zero admissions is stalled (got ' || (v->>'verdict') || ')');
  PERFORM pg_temp.i2947m_assert((v->>'queueWindowsObserved')::int >= 1,
    'C-02b event denominator is positive');
  PERFORM pg_temp.i2947m_assert((v->>'admissionsPerformed')::int = 0,
    'C-02c admissions performed is 0');
  PERFORM pg_temp.i2947m_assert((v->>'joinsPerformed')::int = 3,
    'C-02d write-driven join counter recorded 3');
END
$c02$;
ROLLBACK;

-- ─── C-03: admit_due ⇒ clean ───────────────────────────────────────────────
BEGIN;
DO $c03$
DECLARE
  f record;
  v_s uuid;
  v jsonb;
  v_n integer;
  i integer;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947m_tier('c03', 50);
  PERFORM pg_temp.i2947m_arm(f.o_tier);
  PERFORM pg_temp.i2947m_reset_monitor();

  FOR i IN 1..4 LOOP
    v_s := pg_temp.i2947m_hold(f.o_event, f.o_tier);
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.i2947m_token(i));
  END LOOP;

  v_n := public.issue_2947_queue_admit_due();
  PERFORM pg_temp.i2947m_assert(v_n = 4, 'C-03a driver admits all 4');

  v := public.issue_2947_queue_verdict(72);
  PERFORM pg_temp.i2947m_assert(v->>'verdict' = 'clean',
    'C-03b after admissions the verdict is clean (got ' || (v->>'verdict') || ')');
  PERFORM pg_temp.i2947m_assert((v->>'admissionsPerformed')::int = 4,
    'C-03c write-driven admissions recorded 4');
  PERFORM pg_temp.i2947m_assert((v->>'queueWindowsObserved')::int >= 1,
    'C-03d event denominator is positive');
END
$c03$;
ROLLBACK;

-- ─── C-04: admit_due writes a monitor run ──────────────────────────────────
BEGIN;
DO $c04$
DECLARE
  v_before bigint;
  v_after bigint;
BEGIN
  PERFORM pg_temp.i2947m_reset_monitor();
  SELECT count(*) INTO v_before FROM public.ticket_queue_monitor_runs;
  PERFORM public.issue_2947_queue_admit_due();
  SELECT count(*) INTO v_after FROM public.ticket_queue_monitor_runs;
  PERFORM pg_temp.i2947m_assert(v_after = v_before + 1,
    'C-04 admit_due appends exactly one monitor run on the quiet path');
END
$c04$;
ROLLBACK;

-- ─── C-05: orphan assert raises past grace ─────────────────────────────────
BEGIN;
DO $c05$
DECLARE
  f record;
  v_s uuid;
  v_raised boolean := false;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947m_tier('c05', 10);
  v_s := pg_temp.i2947m_hold(f.o_event, f.o_tier);
  UPDATE public.ticket_checkout_sessions
     SET created_at = clock_timestamp() - interval '5 minutes'
   WHERE id = v_s;
  BEGIN
    PERFORM public.issue_2947_queue_assert_no_orphan_infinity();
  EXCEPTION WHEN OTHERS THEN
    v_raised := (SQLERRM = 'issue_2947_orphan_infinity_hold');
  END;
  PERFORM pg_temp.i2947m_assert(v_raised,
    'C-05 persistent infinity hold without a queue entry makes the assert raise');
END
$c05$;
ROLLBACK;

-- ─── C-06: prior clean then stopped driver ⇒ stalled ───────────────────────
BEGIN;
DO $c06$
DECLARE
  f record;
  v_s uuid;
  v jsonb;
  i integer;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947m_tier('c06', 50);
  PERFORM pg_temp.i2947m_arm(f.o_tier);
  PERFORM pg_temp.i2947m_reset_monitor();

  FOR i IN 1..2 LOOP
    v_s := pg_temp.i2947m_hold(f.o_event, f.o_tier);
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.i2947m_token(i));
  END LOOP;
  PERFORM pg_temp.i2947m_assert(public.issue_2947_queue_admit_due() = 2, 'C-06a first admit succeeds');
  PERFORM pg_temp.i2947m_assert(
    (public.issue_2947_queue_verdict(72)->>'verdict') = 'clean', 'C-06b initially clean');

  -- New waiting buyers; observe WITHOUT admit (stopped driver).
  FOR i IN 3..4 LOOP
    v_s := pg_temp.i2947m_hold(f.o_event, f.o_tier);
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.i2947m_token(i));
  END LOOP;
  PERFORM public.issue_2947_queue_monitor_observe();
  v := public.issue_2947_queue_verdict(72);
  PERFORM pg_temp.i2947m_assert(v->>'verdict' = 'stalled',
    'C-06c freshest waiting window with zero admissions is stalled (got ' || (v->>'verdict') || ')');
END
$c06$;
ROLLBACK;

-- ─── C-07: no admission before sale_opens_at ───────────────────────────────
BEGIN;
DO $c07$
DECLARE
  f record;
  v_s uuid;
  i integer;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947m_tier('c07', 50);
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(f.o_tier);
  UPDATE public.ticket_queue_arming
     SET sale_opens_at = clock_timestamp() + interval '2 days',
         last_admitted_at = clock_timestamp() - interval '60 seconds'
   WHERE ticket_type_id = f.o_tier;

  FOR i IN 1..3 LOOP
    v_s := pg_temp.i2947m_hold(f.o_event, f.o_tier);
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.i2947m_token(i));
  END LOOP;

  PERFORM pg_temp.i2947m_reset_monitor();
  PERFORM pg_temp.i2947m_assert(public.issue_2947_queue_admit_due() = 0,
    'C-07a driver admits nothing before sale_opens_at');
  PERFORM pg_temp.i2947m_assert(
    (SELECT count(*) FROM public.ticket_queue_entries
      WHERE ticket_type_id = f.o_tier AND admitted_at IS NULL AND released_at IS NULL) = 3,
    'C-07b all three remain waiting at infinity');
  PERFORM pg_temp.i2947m_assert(
    (public.issue_2947_queue_verdict(72)->>'verdict') = 'clean',
    'C-07c intentional pre-sale waiting is clean, not stalled (got '
      || (public.issue_2947_queue_verdict(72)->>'verdict') || ')');

  UPDATE public.ticket_queue_arming
     SET sale_opens_at = clock_timestamp() - interval '1 second',
         last_admitted_at = clock_timestamp() - interval '60 seconds'
   WHERE ticket_type_id = f.o_tier;
  PERFORM pg_temp.i2947m_assert(public.issue_2947_queue_admit_due() = 3,
    'C-07d after sale opens the driver admits the cohort');
END
$c07$;
ROLLBACK;

-- ─── C-08: saturated live-hold ceiling is not stalled ──────────────────────
BEGIN;
DO $c08$
DECLARE
  f record;
  v_s uuid;
  v jsonb;
  i integer;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947m_tier('c08', 50);
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(f.o_tier);
  UPDATE public.ticket_queue_arming
     SET last_admitted_at = clock_timestamp() - interval '60 seconds',
         sale_opens_at = clock_timestamp() - interval '1 hour',
         max_concurrent_live_holds = 1
   WHERE ticket_type_id = f.o_tier;
  PERFORM pg_temp.i2947m_reset_monitor();

  v_s := pg_temp.i2947m_hold(f.o_event, f.o_tier);
  PERFORM public.issue_2947_queue_join(v_s, pg_temp.i2947m_token(1));
  PERFORM pg_temp.i2947m_assert(public.issue_2947_queue_admit_due() = 1, 'C-08a first admit fills ceiling');

  FOR i IN 2..3 LOOP
    v_s := pg_temp.i2947m_hold(f.o_event, f.o_tier);
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.i2947m_token(i));
  END LOOP;
  PERFORM public.issue_2947_queue_monitor_observe();
  v := public.issue_2947_queue_verdict(72);
  PERFORM pg_temp.i2947m_assert(v->>'verdict' = 'clean',
    'C-08b saturated ceiling with waiting buyers is clean, not stalled (got '
      || (v->>'verdict') || ')');
END
$c08$;
ROLLBACK;

-- ─── C-09: later-visible lower id is still acknowledged ────────────────────
BEGIN;
DO $c09$
DECLARE
  v_low bigint;
  v_high bigint;
  v jsonb;
BEGIN
  PERFORM pg_temp.i2947m_reset_monitor();
  INSERT INTO public.ticket_queue_monitor_events (kind)
    VALUES ('join') RETURNING id INTO v_low;
  INSERT INTO public.ticket_queue_monitor_events (kind)
    VALUES ('admission') RETURNING id INTO v_high;
  -- Simulate the old max(id) race: higher id was acked while lower stayed open.
  UPDATE public.ticket_queue_monitor_events
     SET consumed_at = clock_timestamp()
   WHERE id = v_high;

  v := public.issue_2947_queue_monitor_observe();
  PERFORM pg_temp.i2947m_assert((v->>'joinsPerformed')::int = 1,
    'C-09a observe still claims the unconsumed lower-id join');
  PERFORM pg_temp.i2947m_assert((v->>'admissionsPerformed')::int = 0,
    'C-09b already-acked higher id is not double-counted');
  PERFORM pg_temp.i2947m_assert(
    (SELECT consumed_at IS NOT NULL FROM public.ticket_queue_monitor_events WHERE id = v_low),
    'C-09c lower id is acknowledged after observe');
END
$c09$;
ROLLBACK;
