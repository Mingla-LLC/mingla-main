-- #3281: a door sale cannot take a cancelled or ended date, and a pass write can.
-- MINGLA-INVARIANT: I-3281-DOOR-ACTIVE-DATE | issue #3281 | A door sale can only name a date that is neither cancelled nor ended. The check sits on the sale, never on pass writes, so a paid online checkout whose date is cancelled mid-payment still mints and reaches its reversal path.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_ok uuid := gen_random_uuid();
  v_gone uuid := gen_random_uuid();
  v_result jsonb;
  v_raised text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'door-date@example.test');
  INSERT INTO public.creator_accounts (id, email) VALUES (v_owner, 'door-date@example.test');
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Door date', 'door-date-'||v_brand, 'USD', 'USD', 'stripe',
    now() - interval '1 day'
  );
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone, currency, is_multi_date
  ) VALUES (
    v_event, v_brand, 'Door date', 'door-date-'||v_event, 'event', 'scheduled', 'public',
    'UTC', 'USD', true
  );
  INSERT INTO public.event_dates (
    id, event_id, start_at, end_at, timezone, is_master, occurrence_key, cancelled_at
  ) VALUES
    (v_ok, v_event, now() - interval '1 hour', now() + interval '2 hours', 'UTC', true, 'ok', NULL),
    (v_gone, v_event, now() + interval '1 day', now() + interval '2 days', 'UTC', false, 'gone', now());
  INSERT INTO public.ticket_types (
    id, event_id, name, price_cents, currency, quantity_total, is_unlimited,
    available_online, available_in_person, is_disabled, is_hidden, valid_occurrence_keys
  ) VALUES (
    v_tier, v_event, 'Listed', 1500, 'USD', 4, false, true, true, false, false, ARRAY['ok','gone']
  );
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  BEGIN
    PERFORM public.biz_door_sale_record(
      v_event, v_gone,
      jsonb_build_array(jsonb_build_object('ticket_type_id', v_tier, 'quantity', 1)),
      'cash', 'Door Buyer', '+12025554064', 'door-date-buyer@example.test',
      'Paid in cash', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'door_event_date_invalid' THEN
    RAISE EXCEPTION 'a cancelled date must be refused, got %', v_raised;
  END IF;

  v_result := public.biz_door_sale_record(
    v_event, v_ok,
    jsonb_build_array(jsonb_build_object('ticket_type_id', v_tier, 'quantity', 1)),
    'cash', 'Door Buyer', '+12025554064', 'door-date-buyer@example.test',
    'Paid in cash', gen_random_uuid());
  IF jsonb_array_length(v_result->'ticketIds') <> 1 THEN
    RAISE EXCEPTION 'an active date must sell, got %', v_result;
  END IF;

  -- A pass can still gain a listed date that was cancelled mid-payment.
  INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
    VALUES ((v_result->'ticketIds'->>0)::uuid, v_gone);
END;
$test$;

ROLLBACK;
