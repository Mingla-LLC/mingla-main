-- Issue #4271 follow-up — implementor proof for
-- 20280429004271_issue_4271_tap_buyer_name.sql on the replayed PG17 schema:
-- the buyer name a host types for a Tap to Pay door sale is saved on the sale,
-- exactly where the cash door sale (biz_door_sale_record) saves it.
--
-- MINGLA-INVARIANT: I-4271-TAP-BUYER-NAME-SAVED | issue #4271 | a host-typed Tap to Pay buyer name stored on door_tap_intents.buyer_name lands on orders.buyer_name and every ticket's attendee_name, like a cash door sale's name; no name stays NULL.
--
-- Cases:
--   N1  An intent with a name records an order whose buyer_name is that name,
--       and every ticket's attendee_name too (same columns as a cash sale),
--       next to the phone on buyer_phone_e164 / attendee_phone.
--   N2  An intent without a name (old app builds) records buyer_name NULL and
--       attendee_name NULL, as before.
--   N3  The column keeps the cash sale's rule: an untrimmed, empty or
--       121-character name is refused by the CHECK; 120 characters (counted as
--       characters, not bytes) is kept.
--   N4  A replayed record returns the same order and leaves the name alone.
--   N5  biz_door_tap_record keeps its signature, SECURITY DEFINER, pinned
--       search_path, and is service-role only.
--
-- FAILS-ON-REVERT: with the 20280404004271 body (buyer_name NULL in the order
-- and ticket inserts) N1 fails; without the column every case fails.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_date uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_intent uuid := gen_random_uuid();
  v_intent2 uuid := gen_random_uuid();
  v_result jsonb;
  v_replay jsonb;
  v_row record;
  v_count integer;
  v_raised text;
  v_proc record;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'owner.n4271@example.test');
  INSERT INTO public.creator_accounts (id, email, display_name)
  VALUES (v_owner, 'owner.n4271@example.test', 'Nia Owner');
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Door name', 'door-name-'||v_brand, 'USD', 'USD', 'stripe',
    now() - interval '1 day'
  );
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone, currency
  ) VALUES (
    v_event, v_brand, 'Door name night', 'door-name-'||v_event, 'event', 'live', 'public',
    'UTC', 'USD'
  );
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master, occurrence_key)
  VALUES (v_date, v_event, now() - interval '1 hour', now() + interval '3 hours', 'UTC', true, 'one');
  INSERT INTO public.ticket_types (
    id, event_id, name, price_cents, currency, quantity_total, is_unlimited,
    available_online, available_in_person, is_disabled, is_hidden
  ) VALUES (
    v_tier, v_event, 'Door entry', 2000, 'USD', 10, false, false, true, false, false
  );

  -- N1. A named tap: the name lands on the order and both tickets.
  INSERT INTO public.door_tap_intents (
    id, brand_id, event_id, event_date_id, client_request_id, lines, currency,
    subtotal_cents, fee_cents, total_cents, application_fee_cents,
    stripe_account_id, stripe_payment_intent_id, created_by, buyer_phone_e164,
    buyer_name
  ) VALUES (
    v_intent, v_brand, v_event, v_date, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_tier, 'quantity', 2, 'unitCents', 2000, 'name', 'Door entry')),
    'USD', 4000, 180, 4180, 180, 'acct_n4271', 'pi_n4271named', v_owner,
    '+12025550123', 'Ada Lovelace'
  );
  v_result := public.biz_door_tap_record('pi_n4271named', 'ch_n4271named', 4180, 'visa', '4242');
  SELECT * INTO v_row FROM public.orders WHERE id = (v_result->>'orderId')::uuid;
  IF v_row.buyer_name IS DISTINCT FROM 'Ada Lovelace' THEN
    RAISE EXCEPTION 'N1 order buyer_name must be the typed name, got %', v_row.buyer_name;
  END IF;
  IF v_row.buyer_phone_e164 IS DISTINCT FROM '+12025550123'
     OR v_row.door_payment_method <> 'tap_to_pay' THEN
    RAISE EXCEPTION 'N1 order shape wrong: % %', v_row.buyer_phone_e164, v_row.door_payment_method;
  END IF;
  SELECT count(*) INTO v_count FROM public.tickets
   WHERE order_id = v_row.id AND attendee_name = 'Ada Lovelace'
     AND attendee_phone = '+12025550123';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'N1 every ticket must carry the name, got % of 2', v_count;
  END IF;

  -- N4. Replay: same order, the name untouched.
  v_replay := public.biz_door_tap_record('pi_n4271named', 'ch_n4271named', 4180, 'visa', '4242');
  IF NOT (v_replay->>'replayed')::boolean
     OR (v_replay->>'orderId') IS DISTINCT FROM (v_result->>'orderId') THEN
    RAISE EXCEPTION 'N4 replay must return the same order %', v_replay;
  END IF;
  IF (SELECT buyer_name FROM public.orders WHERE id = v_row.id) IS DISTINCT FROM 'Ada Lovelace' THEN
    RAISE EXCEPTION 'N4 replay changed the name';
  END IF;

  -- N2. A tap with no name (old app builds): nothing saved, as before.
  INSERT INTO public.door_tap_intents (
    id, brand_id, event_id, event_date_id, client_request_id, lines, currency,
    subtotal_cents, fee_cents, total_cents, application_fee_cents,
    stripe_account_id, stripe_payment_intent_id, created_by
  ) VALUES (
    v_intent2, v_brand, v_event, v_date, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_tier, 'quantity', 1, 'unitCents', 2000, 'name', 'Door entry')),
    'USD', 2000, 90, 2090, 90, 'acct_n4271', 'pi_n4271nameless', v_owner
  );
  v_result := public.biz_door_tap_record('pi_n4271nameless', 'ch_n4271nameless', 2090, 'visa', '4242');
  SELECT * INTO v_row FROM public.orders WHERE id = (v_result->>'orderId')::uuid;
  IF v_row.buyer_name IS NOT NULL THEN
    RAISE EXCEPTION 'N2 a nameless tap must save no name, got %', v_row.buyer_name;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE order_id = v_row.id AND attendee_name IS NOT NULL) THEN
    RAISE EXCEPTION 'N2 a nameless tap must leave attendee_name NULL';
  END IF;

  -- N3. The cash door sale's rule on the column.
  FOREACH v_raised IN ARRAY ARRAY[' Ada', 'Ada ', '', repeat('x', 121)] LOOP
    BEGIN
      UPDATE public.door_tap_intents SET buyer_name = v_raised WHERE id = v_intent2;
      RAISE EXCEPTION 'N3 buyer_name % (len %) must be refused', quote_literal(v_raised), char_length(v_raised);
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;
  UPDATE public.door_tap_intents SET buyer_name = repeat(U&'\00E9', 120) WHERE id = v_intent2;
  IF (SELECT char_length(buyer_name) FROM public.door_tap_intents WHERE id = v_intent2) <> 120 THEN
    RAISE EXCEPTION 'N3 a 120-character name must be kept';
  END IF;

  -- N5. Same signature and security as before.
  SELECT p.prosecdef, p.proconfig INTO v_proc
    FROM pg_proc p
   WHERE p.oid = 'public.biz_door_tap_record(text, text, integer, text, text)'::regprocedure;
  IF NOT v_proc.prosecdef
     OR NOT (v_proc.proconfig @> ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION 'N5 biz_door_tap_record must stay SECURITY DEFINER with a pinned search_path, got %', v_proc.proconfig;
  END IF;
  IF has_function_privilege('anon', 'public.biz_door_tap_record(text, text, integer, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.biz_door_tap_record(text, text, integer, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.biz_door_tap_record(text, text, integer, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'N5 biz_door_tap_record must be service-role only';
  END IF;
  SELECT count(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'biz_door_tap_record';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'N5 exactly one biz_door_tap_record overload, got %', v_count;
  END IF;
END;
$test$;

ROLLBACK;
