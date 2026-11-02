-- #3281: a listed ticket's new pass cannot take a cancelled or ended date.
-- MINGLA-INVARIANT: I-3281-LISTED-PASS-ACTIVE-DATE | issue #3281 | A pass on a ticket with a day list can only gain a listed date that is neither cancelled nor ended.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_ok uuid := gen_random_uuid();
  v_gone uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_pass uuid := gen_random_uuid();
  v_raised text;
BEGIN
  SET LOCAL session_replication_role=replica;
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'active date', 'active-date-'||v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'active date', 'active-date-'||v_event, 'event', 'scheduled', 'public', 'UTC');
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master, occurrence_key, cancelled_at) VALUES
    (v_ok, v_event, now()+interval '1 day', now()+interval '2 days', 'UTC', true, 'ok', NULL),
    (v_gone, v_event, now()+interval '3 days', now()+interval '4 days', 'UTC', false, 'gone', now());
  INSERT INTO public.ticket_types (id, event_id, name, price_cents, is_free, quantity_total, valid_occurrence_keys)
    VALUES (v_tier, v_event, 'Listed', 0, true, 10, ARRAY['ok','gone']);
  INSERT INTO public.orders (id, event_id, buyer_name, buyer_email, buyer_phone_e164)
    VALUES (v_order, v_event, 'B', 'b@example.test', '+15555550901');
  INSERT INTO public.tickets (id, event_id, order_id, ticket_type_id, status, qr_code)
    VALUES (v_pass, v_event, v_order, v_tier, 'valid', 'active-date-qr');
  SET LOCAL session_replication_role=DEFAULT;

  BEGIN
    INSERT INTO public.ticket_event_dates (ticket_id, event_date_id) VALUES (v_pass, v_gone);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'ticket_not_valid_on_chosen_days' THEN
    RAISE EXCEPTION 'a cancelled date must be refused, got %', v_raised;
  END IF;
  INSERT INTO public.ticket_event_dates (ticket_id, event_date_id) VALUES (v_pass, v_ok);
END;
$test$;

ROLLBACK;
