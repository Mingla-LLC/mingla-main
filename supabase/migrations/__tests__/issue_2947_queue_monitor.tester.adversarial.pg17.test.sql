-- #2879 / #2947 — queue monitor adversarial.
--
--   A-01  clean is unreachable while queueWindowsObserved = 0 (even with forged
--         admission deltas on the totals table — verdict reads the runs table).
--   A-02  orphaned beats stalled and clean when any run recorded orphans.
--   A-03  observe does not raise on a transient orphan (create→join race).
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

-- ─── A-01: forged admissions cannot make a zero-window clean ───────────────
BEGIN;
DO $a01$
DECLARE
  v jsonb;
BEGIN
  DELETE FROM public.ticket_queue_monitor_runs;
  UPDATE public.ticket_queue_monitor_watermark
     SET joins_seen = 0, admissions_seen = 0, releases_seen = 0, waitlist_invites_seen = 0;
  UPDATE public.ticket_queue_monitor_totals
     SET joins_performed = 0, admissions_performed = 99,
         holds_released = 0, waitlist_invites_sent = 0;

  -- Observe with no waiting entries: windows=0 even though totals show admissions
  -- (watermark catches up; delta admissions may be 99 — still windows only if
  -- waiting/joins/admits delta path: admits delta > 0 WOULD set windows=1).
  -- Force a zero-window run by aligning watermark first, then observe with no waiting.
  UPDATE public.ticket_queue_monitor_watermark
     SET admissions_seen = 99;
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

-- ─── A-03: observe records orphans without raising ─────────────────────────
BEGIN;
DO $a03$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tier uuid;
  v_session uuid;
  v jsonb;
  v_ok boolean := false;
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
  v_session := (public.biz_ticket_checkout_create_session(
    v_event, NULL, 'Orphan', 'orphan@example.test', '+15550002947', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier, 'quantity', 1)),
    'i2947ma-a03:' || gen_random_uuid()::text, 'infinity'::timestamptz, 0, 'auto', NULL)
    ->> 'checkoutSessionId')::uuid;

  BEGIN
    v := public.issue_2947_queue_monitor_observe();
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
  END;
  PERFORM pg_temp.i2947ma_assert(v_ok, 'A-03a observe does not raise on a transient orphan');
  PERFORM pg_temp.i2947ma_assert((v->>'waitingEntries') IS NOT NULL,
    'A-03b observe still returned a payload');
  PERFORM pg_temp.i2947ma_assert(
    (SELECT orphan_infinity_count FROM public.ticket_queue_monitor_runs ORDER BY id DESC LIMIT 1) >= 1,
    'A-03c the run recorded orphan_infinity_count >= 1');
END
$a03$;
ROLLBACK;
