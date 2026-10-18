-- #2879 / #2947 — queue monitor with the EVENT denominator.
--
-- WHAT IS PROVED
--   C-01  Zero-event window ⇒ insufficient_evidence (never clean).
--   C-02  Queue waiting, observe without admit ⇒ stalled.
--   C-03  Join + admit_due ⇒ clean; write-driven joins/admissions counted.
--   C-04  admit_due calls observe (a run row appears after the driver).
--   C-05  Orphan assert raises when an infinity hold has no queue entry.
--
-- FAILS-ON-REVERT: drop the monitor ⇒ C-01/C-02/C-03 miss their functions;
-- remove the observe call from admit_due ⇒ C-04 fails.
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
     SET last_admitted_at = clock_timestamp() - interval '60 seconds'
   WHERE ticket_type_id = p_tier;
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.i2947m_reset_monitor()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  DELETE FROM public.ticket_queue_monitor_runs;
  UPDATE public.ticket_queue_monitor_watermark
     SET joins_seen = (SELECT joins_performed FROM public.ticket_queue_monitor_totals WHERE id = 1),
         admissions_seen = (SELECT admissions_performed FROM public.ticket_queue_monitor_totals WHERE id = 1),
         releases_seen = (SELECT holds_released FROM public.ticket_queue_monitor_totals WHERE id = 1),
         waitlist_invites_seen = (SELECT waitlist_invites_sent FROM public.ticket_queue_monitor_totals WHERE id = 1)
   WHERE id = 1;
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

  -- Observe WITHOUT calling admit — the alarm that catches a missing caller.
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

-- ─── C-05: orphan assert raises ────────────────────────────────────────────
BEGIN;
DO $c05$
DECLARE
  f record;
  v_s uuid;
  v_raised boolean := false;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947m_tier('c05', 10);
  v_s := pg_temp.i2947m_hold(f.o_event, f.o_tier);
  BEGIN
    PERFORM public.issue_2947_queue_assert_no_orphan_infinity();
  EXCEPTION WHEN OTHERS THEN
    v_raised := (SQLERRM = 'issue_2947_orphan_infinity_hold');
  END;
  PERFORM pg_temp.i2947m_assert(v_raised,
    'C-05 infinity hold without a queue entry makes the assert raise');
END
$c05$;
ROLLBACK;
