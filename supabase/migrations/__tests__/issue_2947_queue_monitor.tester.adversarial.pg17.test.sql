-- #2879 / #2947 — queue monitor adversarial.
--
--   A-01  clean is unreachable while queueWindowsObserved = 0.
--   A-02  orphaned beats stalled and clean when any run recorded orphans.
--   A-03  observe does not count an in-flight (within grace) create→join orphan.
--   A-04  join after an in-window observation does not leave the verdict orphaned.
--   A-05  release-only recovery clears a prior stalled verdict via the latest run.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.i2947ma_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2947 queue monitor ADV FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.i2947ma_token(p_n integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $t$
  SELECT md5('i2947ma-device-' || p_n) || md5('i2947ma-device-pad-' || p_n)
$t$;

CREATE OR REPLACE FUNCTION pg_temp.i2947ma_reset_monitor()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  DELETE FROM public.ticket_queue_monitor_runs;
  UPDATE public.ticket_queue_monitor_events
     SET consumed_at = clock_timestamp()
   WHERE consumed_at IS NULL;
END
$f$;

-- ─── A-01: zero-window cannot be clean ─────────────────────────────────────
BEGIN;
DO $a01$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp.i2947ma_reset_monitor();
  PERFORM public.issue_2947_queue_monitor_observe();

  v := public.issue_2947_queue_verdict(72);
  PERFORM pg_temp.i2947ma_assert(v->>'verdict' = 'insufficient_evidence',
    'A-01a zero-window run is insufficient_evidence (got ' || (v->>'verdict') || ')');
  PERFORM pg_temp.i2947ma_assert((v->>'queueWindowsObserved')::int = 0,
    'A-01b event denominator stays 0');
END
$a01$;
ROLLBACK;

-- ─── A-02: orphaned dominates ──────────────────────────────────────────────
BEGIN;
DO $a02$
DECLARE
  v jsonb;
BEGIN
  DELETE FROM public.ticket_queue_monitor_runs;
  INSERT INTO public.ticket_queue_monitor_runs (
    checks_run, queue_windows_observed, joins_performed, admissions_performed,
    holds_released, waitlist_invites_sent, waiting_entries, orphan_infinity_count, duration_ms
  ) VALUES (1, 1, 0, 5, 0, 0, 0, 2, 1);

  v := public.issue_2947_queue_verdict(72);
  PERFORM pg_temp.i2947ma_assert(v->>'verdict' = 'orphaned',
    'A-02 orphaned beats clean when orphan_infinity_count > 0 (got ' || (v->>'verdict') || ')');
END
$a02$;
ROLLBACK;

-- ─── A-03: in-flight create is not an orphan ───────────────────────────────
BEGIN;
DO $a03$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tier uuid;
  v jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_user, 'i2947ma-a03-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (v_brand, v_user, 'Issue 2947 MA A03', 'issue-2947-ma-a03-' || v_brand,
            'stripe', 'US', 'USD', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme)
    VALUES (v_event, v_brand, 'Issue 2947 MA A03', 'issue-2947-ma-a03-' || v_event,
            'event', 'scheduled', 'public', 'UTC', 'USD', now(),
            jsonb_build_object('business_event', jsonb_build_object(
              'format', 'in_person', 'hideAddressUntilTicket', false,
              'settings', jsonb_build_object('privateGuestList', false))));
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '20 days', now() + interval '20 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, quantity_total, currency)
    VALUES (v_event, 'GA', 0, 10, 'USD') RETURNING id INTO v_tier;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM public.biz_ticket_checkout_create_session(
    v_event, NULL, 'Orphan', 'orphan@example.test', '+15550002947', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier, 'quantity', 1)),
    'i2947ma-a03:' || gen_random_uuid()::text, 'infinity'::timestamptz, 0, 'auto', NULL);

  DELETE FROM public.ticket_queue_monitor_runs;
  v := public.issue_2947_queue_monitor_observe();
  PERFORM pg_temp.i2947ma_assert(
    (v->>'orphanInfinityCount')::int = 0,
    'A-03a fresh infinity hold within grace is not counted as orphan');
END
$a03$;
ROLLBACK;

-- ─── A-04: observe then join — no orphaned verdict ─────────────────────────
BEGIN;
DO $a04$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tier uuid;
  v_session uuid;
  v jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_user, 'i2947ma-a04-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (v_brand, v_user, 'Issue 2947 MA A04', 'issue-2947-ma-a04-' || v_brand,
            'stripe', 'US', 'USD', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme)
    VALUES (v_event, v_brand, 'Issue 2947 MA A04', 'issue-2947-ma-a04-' || v_event,
            'event', 'scheduled', 'public', 'UTC', 'USD', now(),
            jsonb_build_object('business_event', jsonb_build_object(
              'format', 'in_person', 'hideAddressUntilTicket', false,
              'settings', jsonb_build_object('privateGuestList', false))));
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '20 days', now() + interval '20 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, quantity_total, currency,
                                  sale_start_at)
    VALUES (v_event, 'GA', 0, 10, 'USD', now() + interval '2 days') RETURNING id INTO v_tier;

  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(v_tier);

  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_session := (public.biz_ticket_checkout_create_session(
    v_event, NULL, 'Span', 'span@example.test', '+15550002947', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier, 'quantity', 1)),
    'i2947ma-a04:' || gen_random_uuid()::text, 'infinity'::timestamptz, 0, 'auto', NULL)
    ->> 'checkoutSessionId')::uuid;

  DELETE FROM public.ticket_queue_monitor_runs;
  PERFORM public.issue_2947_queue_monitor_observe();
  PERFORM public.issue_2947_queue_join(v_session, pg_temp.i2947ma_token(1));
  PERFORM public.issue_2947_queue_monitor_observe();

  v := public.issue_2947_queue_verdict(72);
  PERFORM pg_temp.i2947ma_assert(v->>'verdict' <> 'orphaned',
    'A-04 create→observe→join does not leave verdict orphaned (got ' || (v->>'verdict') || ')');
END
$a04$;
ROLLBACK;

-- ─── A-05: release-only recovery clears stalled ────────────────────────────
BEGIN;
DO $a05$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tier uuid;
  v_session uuid;
  v jsonb;
  i integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_user, 'i2947ma-a05-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (v_brand, v_user, 'Issue 2947 MA A05', 'issue-2947-ma-a05-' || v_brand,
            'stripe', 'US', 'USD', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme)
    VALUES (v_event, v_brand, 'Issue 2947 MA A05', 'issue-2947-ma-a05-' || v_event,
            'event', 'scheduled', 'public', 'UTC', 'USD', now(),
            jsonb_build_object('business_event', jsonb_build_object(
              'format', 'in_person', 'hideAddressUntilTicket', false,
              'settings', jsonb_build_object('privateGuestList', false))));
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '20 days', now() + interval '20 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, quantity_total, currency)
    VALUES (v_event, 'GA', 0, 50, 'USD') RETURNING id INTO v_tier;

  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(v_tier);
  UPDATE public.ticket_queue_arming
     SET last_admitted_at = clock_timestamp() - interval '60 seconds',
         sale_opens_at = clock_timestamp() - interval '1 hour'
   WHERE ticket_type_id = v_tier;

  PERFORM pg_temp.i2947ma_reset_monitor();
  PERFORM set_config('request.jwt.claim.sub', '', true);
  FOR i IN 1..2 LOOP
    v_session := (public.biz_ticket_checkout_create_session(
      v_event, NULL, 'Rel', 'rel' || i || '@example.test', '+15550002947', false,
      jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier, 'quantity', 1)),
      'i2947ma-a05:' || gen_random_uuid()::text, 'infinity'::timestamptz, 0, 'auto', NULL)
      ->> 'checkoutSessionId')::uuid;
    PERFORM public.issue_2947_queue_join(v_session, pg_temp.i2947ma_token(i));
  END LOOP;

  PERFORM public.issue_2947_queue_monitor_observe();
  PERFORM pg_temp.i2947ma_assert(
    (public.issue_2947_queue_verdict(72)->>'verdict') = 'stalled',
    'A-05a eligible waiting with zero admissions is stalled');

  -- Release-only recovery: sessions no longer hold inventory; entries released.
  UPDATE public.ticket_queue_entries
     SET released_at = clock_timestamp()
   WHERE ticket_type_id = v_tier AND released_at IS NULL AND admitted_at IS NULL;
  UPDATE public.ticket_checkout_sessions s
     SET status = 'expired', expires_at = clock_timestamp() - interval '1 second'
   WHERE s.id IN (
     SELECT checkout_session_id FROM public.ticket_queue_entries WHERE ticket_type_id = v_tier
   );

  PERFORM public.issue_2947_queue_monitor_observe();
  v := public.issue_2947_queue_verdict(72);
  PERFORM pg_temp.i2947ma_assert(v->>'verdict' = 'clean',
    'A-05b release-only recovery clears stalled via the latest run (got '
      || (v->>'verdict') || ')');
  PERFORM pg_temp.i2947ma_assert((v->>'holdsReleased')::int >= 2,
    'A-05c release events were counted on the recovery run');
END
$a05$;
ROLLBACK;
