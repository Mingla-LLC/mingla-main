-- Issue #4271 follow-up — independent tester adversarial proof for
-- 20280429004271_issue_4271_tap_buyer_name.sql on the replayed PG17 schema.
-- A different angle from the implementor's happy path: it attacks the
-- positional INSERT lists, the replay chain (complete -> webhook -> sweep),
-- where else the name could leak, and the character-count boundary the edge
-- function (Array.from(...).length) and Postgres (char_length) must agree on.
--
-- Cases:
--   T1  Positional columns: the name lands ONLY in orders.buyer_name and
--       tickets.attendee_name. buyer_email / attendee_email stay NULL, the
--       phone stays in the phone columns, and the name appears in no other
--       column of the order, its tickets, the ledger row, the scan events or
--       the receipt outbox payload.
--   T2  Replay chain: the same PaymentIntent recorded three times (app
--       complete, Stripe webhook, unfinished sweep) makes one order, one
--       ledger row, one receipt, quantity tickets, and every replay says
--       replayed=true. A name changed on the intent after recording never
--       rewrites the sale.
--   T3  A named tap with no phone keeps the name and needs no receipt.
--   T4  Character count agrees with the edge (code points): 120 four-byte
--       emoji and 120 code points of ZWJ sequences are kept, 121 code points
--       are refused; a combining accent counts as its own character.
--   T5  The edge trims more than btrim: a name the edge would send after its
--       JS trim (interior tab/newline, NBSP inside) is always accepted by the
--       CHECK, so a valid edge name can never turn into a 500.
--
-- FAILS-ON-REVERT: with the 20280404004271 body (NULL in the buyer_name and
-- attendee_name slots) T1 fails; without the column every case fails.
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
  v_name constant text := 'Tq Positional Probe';
  v_result jsonb;
  v_replay jsonb;
  v_order public.orders%ROWTYPE;
  v_count integer;
  v_hits text;
  v_family constant text := U&'\+01F468\200D\+01F469\200D\+01F467'; -- 5 code points
  v_ok text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'owner.t4271@example.test');
  INSERT INTO public.creator_accounts (id, email, display_name)
  VALUES (v_owner, 'owner.t4271@example.test', 'Tess Owner');
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Door name tester', 'door-name-t-'||v_brand, 'USD', 'USD', 'stripe',
    now() - interval '1 day'
  );
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone, currency
  ) VALUES (
    v_event, v_brand, 'Door name tester night', 'door-name-t-'||v_event, 'event', 'live', 'public',
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

  INSERT INTO public.door_tap_intents (
    id, brand_id, event_id, event_date_id, client_request_id, lines, currency,
    subtotal_cents, fee_cents, total_cents, application_fee_cents,
    stripe_account_id, stripe_payment_intent_id, created_by, buyer_phone_e164,
    buyer_name
  ) VALUES (
    v_intent, v_brand, v_event, v_date, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_tier, 'quantity', 3, 'unitCents', 2000, 'name', 'Door entry')),
    'USD', 6000, 270, 6270, 270, 'acct_t4271', 'pi_t4271pos', v_owner,
    '+12025550188', v_name
  );

  -- T1. Positional columns: the name goes exactly where a cash sale's does.
  v_result := public.biz_door_tap_record('pi_t4271pos', 'ch_t4271pos', 6270, 'visa', '4242');
  SELECT * INTO v_order FROM public.orders WHERE id = (v_result->>'orderId')::uuid;
  IF v_order.buyer_name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'T1 orders.buyer_name must be the typed name, got %', v_order.buyer_name;
  END IF;
  IF v_order.buyer_email IS NOT NULL THEN
    RAISE EXCEPTION 'T1 the name (or anything) leaked into orders.buyer_email: %', v_order.buyer_email;
  END IF;
  IF v_order.buyer_phone IS DISTINCT FROM '+12025550188'
     OR v_order.buyer_phone_e164 IS DISTINCT FROM '+12025550188'
     OR v_order.buyer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'T1 order columns shifted: phone % e164 % user %',
      v_order.buyer_phone, v_order.buyer_phone_e164, v_order.buyer_user_id;
  END IF;
  SELECT string_agg(key, ',' ORDER BY key) INTO v_hits
    FROM public.orders o, jsonb_each_text(to_jsonb(o))
   WHERE o.id = v_order.id AND value LIKE '%Positional Probe%';
  IF v_hits IS DISTINCT FROM 'buyer_name' THEN
    RAISE EXCEPTION 'T1 the name must sit only in orders.buyer_name, found in %', v_hits;
  END IF;
  SELECT count(*) INTO v_count FROM public.tickets t
   WHERE t.order_id = v_order.id AND t.attendee_name = v_name
     AND t.attendee_email IS NULL AND t.attendee_phone = '+12025550188';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'T1 every ticket must carry the name in attendee_name only, got % of 3', v_count;
  END IF;
  SELECT string_agg(DISTINCT key, ',' ORDER BY key) INTO v_hits
    FROM public.tickets t, jsonb_each_text(to_jsonb(t))
   WHERE t.order_id = v_order.id AND value LIKE '%Positional Probe%';
  IF v_hits IS DISTINCT FROM 'attendee_name' THEN
    RAISE EXCEPTION 'T1 the name must sit only in tickets.attendee_name, found in %', v_hits;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.door_sales_ledger l
     WHERE l.order_id = v_order.id AND to_jsonb(l)::text LIKE '%Positional Probe%'
  ) OR EXISTS (
    SELECT 1 FROM public.scan_events s JOIN public.tickets t ON t.id = s.ticket_id
     WHERE t.order_id = v_order.id AND to_jsonb(s)::text LIKE '%Positional Probe%'
  ) OR EXISTS (
    SELECT 1 FROM public.notification_outbox n
     WHERE n.idempotency_key = 'buyer_door_receipt:' || v_order.id::text || ':sms'
       AND to_jsonb(n)::text LIKE '%Positional Probe%'
  ) THEN
    RAISE EXCEPTION 'T1 the name leaked into the ledger, scan events or receipt payload';
  END IF;

  -- T2. Replay chain: app complete (above) -> webhook -> sweep.
  UPDATE public.door_tap_intents SET buyer_name = 'Changed Later' WHERE id = v_intent;
  FOR i IN 1..2 LOOP
    v_replay := public.biz_door_tap_record('pi_t4271pos', 'ch_t4271pos', 6270, 'visa', '4242');
    IF NOT coalesce((v_replay->>'replayed')::boolean, false)
       OR (v_replay->>'orderId') IS DISTINCT FROM (v_result->>'orderId')
       OR jsonb_array_length(v_replay->'ticketIds') <> 3 THEN
      RAISE EXCEPTION 'T2 replay % must return the same order and 3 tickets, got %', i, v_replay;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.orders WHERE stripe_payment_intent_id = 'pi_t4271pos';
  IF v_count <> 1 THEN RAISE EXCEPTION 'T2 one order per PaymentIntent, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.door_sales_ledger WHERE order_id = v_order.id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'T2 one ledger row, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.tickets WHERE order_id = v_order.id;
  IF v_count <> 3 THEN RAISE EXCEPTION 'T2 three tickets, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.notification_outbox
   WHERE idempotency_key = 'buyer_door_receipt:' || v_order.id::text || ':sms';
  IF v_count <> 1 THEN RAISE EXCEPTION 'T2 one receipt, got %', v_count; END IF;
  IF (SELECT buyer_name FROM public.orders WHERE id = v_order.id) IS DISTINCT FROM v_name
     OR EXISTS (SELECT 1 FROM public.tickets WHERE order_id = v_order.id
                 AND attendee_name IS DISTINCT FROM v_name) THEN
    RAISE EXCEPTION 'T2 a replay rewrote the recorded name';
  END IF;

  -- T3. A named tap with no phone: the name is saved, no receipt is owed.
  INSERT INTO public.door_tap_intents (
    id, brand_id, event_id, event_date_id, client_request_id, lines, currency,
    subtotal_cents, fee_cents, total_cents, application_fee_cents,
    stripe_account_id, stripe_payment_intent_id, created_by, buyer_name
  ) VALUES (
    v_intent2, v_brand, v_event, NULL, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_tier, 'quantity', 1, 'unitCents', 2000, 'name', 'Door entry')),
    'USD', 2000, 90, 2090, 90, 'acct_t4271', 'pi_t4271nophone', v_owner,
    U&'Zo\00EB O\2019Brien'
  );
  v_result := public.biz_door_tap_record('pi_t4271nophone', NULL, 2090, NULL, NULL);
  SELECT * INTO v_order FROM public.orders WHERE id = (v_result->>'orderId')::uuid;
  IF v_order.buyer_name IS DISTINCT FROM U&'Zo\00EB O\2019Brien'
     OR v_order.buyer_phone_e164 IS NOT NULL
     OR v_order.notification_status <> 'not_required'
     OR coalesce((v_result->>'receiptQueued')::boolean, true) THEN
    RAISE EXCEPTION 'T3 a phoneless named tap: name %, phone %, notify %, result %',
      v_order.buyer_name, v_order.buyer_phone_e164, v_order.notification_status, v_result;
  END IF;

  -- T4. The CHECK counts code points, exactly like the edge's Array.from.
  FOREACH v_ok IN ARRAY ARRAY[
    repeat(U&'\+01F600', 120),               -- 120 four-byte emoji (480 bytes)
    repeat(v_family, 24),                    -- 24 x 5 = 120 code points
    repeat(U&'e\0301', 60)                   -- 60 x 2 = 120 (combining accent)
  ] LOOP
    UPDATE public.door_tap_intents SET buyer_name = v_ok WHERE id = v_intent2;
  END LOOP;
  FOREACH v_ok IN ARRAY ARRAY[
    repeat(U&'\+01F600', 121),
    repeat(v_family, 24) || 'x',
    repeat(U&'e\0301', 60) || U&'\0301'
  ] LOOP
    BEGIN
      UPDATE public.door_tap_intents SET buyer_name = v_ok WHERE id = v_intent2;
      RAISE EXCEPTION 'T4 a 121-code-point name (%) must be refused', char_length(v_ok);
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;

  -- T5. Anything the edge would send after JS trim() passes the CHECK.
  FOREACH v_ok IN ARRAY ARRAY[
    E'Ada\tLovelace', E'Ada\nLovelace', U&'Ada\00A0Lovelace', U&'\200BAda'
  ] LOOP
    UPDATE public.door_tap_intents SET buyer_name = v_ok WHERE id = v_intent2;
  END LOOP;
END;
$test$;

ROLLBACK;
