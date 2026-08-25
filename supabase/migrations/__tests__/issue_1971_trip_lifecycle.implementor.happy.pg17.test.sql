\set ON_ERROR_STOP on

-- Issue #1971 — implementor happy-path proof for the canonical trip command
-- boundary. Run after the full migration chain on PostgreSQL 17.
--
-- Every assertion below is made at a SEAM A CALLER ACTUALLY USES:
--   * the six canonical RPCs, called exactly as tripsService.ts calls them;
--   * `ari_execute_trip_operation`, called exactly as agentDomainTools.ts calls
--     it, through a real confirmed `agent_pending_actions` row.
-- Proving the private helpers in isolation would stay green if a call site were
-- deleted, which is precisely the failure mode this file exists to catch.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '19710000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id) VALUES ('19710000-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('19710000-0000-4000-8000-000000000001');

INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES (
  '19710000-0000-4000-8000-000000000010',
  '19710000-0000-4000-8000-000000000001',
  'Issue 1971',
  'issue-1971',
  'GBP'
);

-- A real Ari conversation, so the confirmed pending actions in sections J and K
-- satisfy `agent_pending_actions_source_conversation_check` exactly as a live
-- confirmation does.
INSERT INTO public.agent_conversations(id, user_id, brand_id)
VALUES (
  '19710000-0000-4000-8000-0000000000c0',
  '19710000-0000-4000-8000-000000000001',
  '19710000-0000-4000-8000-000000000010'
);

-- ---------------------------------------------------------------------------
-- A. Atomic create. One call produces the event, the placeholder Standard
--    ticket and its joined pricing tier, and returns the whole graph.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t1971 AS
SELECT public.biz_create_trip_draft(
  '19710000-0000-4000-8000-000000000010',
  jsonb_build_object('title', 'Lagos December', 'timezone', 'Africa/Lagos'),
  '19710000-0000-4000-8000-0000000000a1'
) AS graph;

DO $$
DECLARE g jsonb; v_event uuid;
BEGIN
  SELECT graph INTO g FROM t1971;
  IF g IS NULL THEN RAISE EXCEPTION 'A-01 create returned no graph'; END IF;
  v_event := (g#>>'{event,id}')::uuid;

  IF (g#>>'{event,status}') <> 'draft' THEN RAISE EXCEPTION 'A-02 created trip is not a draft'; END IF;
  IF (g#>>'{event,event_type}') <> 'trip' THEN RAISE EXCEPTION 'A-03 created row is not a trip'; END IF;
  IF (g#>>'{event,title}') <> 'Lagos December' THEN RAISE EXCEPTION 'A-04 seed title was dropped'; END IF;
  IF (g#>>'{event,timezone}') <> 'Africa/Lagos' THEN RAISE EXCEPTION 'A-05 seed timezone was dropped'; END IF;
  -- The brand's currency is derived server-side and never invented.
  IF (g#>>'{event,currency}') <> 'GBP' THEN RAISE EXCEPTION 'A-06 brand currency was not derived, got %', g#>>'{event,currency}'; END IF;
  IF jsonb_array_length(g->'tiers') <> 1 THEN RAISE EXCEPTION 'A-07 placeholder tier missing (%)', jsonb_array_length(g->'tiers'); END IF;
  IF (g#>>'{tiers,0,ticket_type,name}') <> 'Standard' THEN RAISE EXCEPTION 'A-08 placeholder ticket missing'; END IF;
  IF (g->>'revision') IS NULL THEN RAISE EXCEPTION 'A-09 graph carries no revision'; END IF;

  -- The placeholder ticket and its tier are the SAME row the manual wizard
  -- creates; an Ari draft must satisfy the same publish prerequisites.
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_pricing_tiers t
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.event_id = v_event AND tt.event_id = v_event
  ) THEN RAISE EXCEPTION 'A-10 ticket/tier join was not created'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- B. Mixed-group draft patch round-trips, and a mid-sequence failure rolls back
--    EVERY group (atomicity, not per-group best effort).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
  v_rev timestamptz;
  g jsonb;
BEGIN
  SELECT (graph#>>'{event,id}')::uuid, (graph->>'revision')::timestamptz
    INTO v_event, v_rev FROM t1971;

  g := public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object(
      'event', jsonb_build_object(
        'description', 'Seven nights',
        'destination_text', 'Lagos, Nigeria',
        'departure_text', 'London, UK'),
      'days', jsonb_build_array(
        jsonb_build_object('ordinal', 1, 'title', 'Arrival', 'media', jsonb_build_array(
          jsonb_build_object('url', 'https://cdn.example/1.jpg', 'type', 'image'))),
        jsonb_build_object('ordinal', 2, 'title', 'Lekki')),
      'inclusions', jsonb_build_array(
        jsonb_build_object('kind', 'included', 'item', 'Airport transfer', 'ordinal', 0),
        jsonb_build_object('kind', 'excluded', 'item', 'Flights', 'ordinal', 0)),
      'settings', jsonb_build_object('bookings_closed', false, 'pass_tax', true)),
    v_rev,
    '19710000-0000-4000-8000-0000000000a2');

  IF jsonb_array_length(g->'days') <> 2 THEN RAISE EXCEPTION 'B-01 days did not round-trip'; END IF;
  IF (g#>>'{days,0,media,0,url}') <> 'https://cdn.example/1.jpg' THEN
    RAISE EXCEPTION 'B-02 ORCH-1119 per-day media was dropped';
  END IF;
  IF jsonb_array_length(g->'inclusions') <> 2 THEN RAISE EXCEPTION 'B-03 inclusions did not round-trip'; END IF;
  IF (g#>>'{event,description}') <> 'Seven nights' THEN RAISE EXCEPTION 'B-04 basics did not round-trip'; END IF;
  IF (g#>>'{event,pass_tax}') <> 'true' THEN RAISE EXCEPTION 'B-05 settings did not round-trip'; END IF;

  -- Destination/departure are theme-authored so the existing
  -- `tg_events_sync_departure_from_theme` trigger and the publish owner derive
  -- the columns instead of fighting a direct column write.
  IF (g#>>'{event,theme,business_trip,destinationLocationText}') <> 'Lagos, Nigeria' THEN
    RAISE EXCEPTION 'B-06 destination was not authored into the theme';
  END IF;
  IF (g#>>'{event,departure_text}') <> 'London, UK' THEN
    RAISE EXCEPTION 'B-07 departure column was not derived from the theme, got %',
      g#>>'{event,departure_text}';
  END IF;

  -- The CAS contract: the returned revision IS `events.updated_at`, so the next
  -- command can compare-and-swap against it. Note the revision cannot be proven
  -- to ADVANCE inside a single transaction: `trg_events_updated_at` runs
  -- `update_updated_at_column()` (`NEW.updated_at = now()`), and `now()` is the
  -- transaction timestamp, so every write in one transaction stamps the same
  -- value. Across transactions — which is how every real caller writes — it
  -- advances. Section C proves the half that matters either way: a stale
  -- revision is refused with zero writes.
  IF (g->>'revision')::timestamptz
       IS DISTINCT FROM (SELECT updated_at FROM public.events WHERE id = v_event) THEN
    RAISE EXCEPTION 'B-08 returned revision is not the stored events.updated_at';
  END IF;
END $$;

DO $$
DECLARE
  v_event uuid;
  v_rev timestamptz;
  v_days int;
BEGIN
  SELECT id, updated_at INTO v_event, v_rev FROM public.events
   WHERE brand_id = '19710000-0000-4000-8000-000000000010' AND event_type = 'trip';
  SELECT count(*) INTO v_days FROM public.trip_days WHERE event_id = v_event;

  BEGIN
    -- Valid days group + invalid inclusions group in ONE patch.
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object(
        'days', jsonb_build_array(jsonb_build_object('ordinal', 1, 'title', 'Only day')),
        'inclusions', jsonb_build_array(jsonb_build_object('kind', 'maybe', 'item', 'x', 'ordinal', 0))),
      v_rev,
      '19710000-0000-4000-8000-0000000000a3');
    RAISE EXCEPTION 'B-09 an invalid group was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;

  IF (SELECT count(*) FROM public.trip_days WHERE event_id = v_event) <> v_days THEN
    RAISE EXCEPTION 'B-10 a mixed-group failure did not roll back the valid group';
  END IF;
  IF EXISTS (SELECT 1 FROM public.biz_trip_command_receipts
              WHERE operation_id = '19710000-0000-4000-8000-0000000000a3') THEN
    RAISE EXCEPTION 'B-11 a rejected command left a receipt';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- C. Compare-and-swap. A stale expected revision is a typed, ZERO-WRITE reject.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_rev timestamptz; v_title text;
BEGIN
  SELECT id, updated_at, title INTO v_event, v_rev, v_title
    FROM public.events WHERE brand_id = '19710000-0000-4000-8000-000000000010' AND event_type = 'trip';
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('event', jsonb_build_object('title', 'Overwritten')),
      v_rev - interval '1 microsecond',
      '19710000-0000-4000-8000-0000000000a4');
    RAISE EXCEPTION 'C-01 a stale revision was accepted';
  EXCEPTION WHEN sqlstate '40001' THEN NULL;
  END;
  IF (SELECT title FROM public.events WHERE id = v_event) <> v_title THEN
    RAISE EXCEPTION 'C-02 a stale-revision reject still wrote';
  END IF;

  -- An unknown patch key is likewise typed and zero-write.
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event, jsonb_build_object('sneaky', 1), v_rev,
      '19710000-0000-4000-8000-0000000000a5');
    RAISE EXCEPTION 'C-03 an unknown patch key was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- D. Deposit / instalment bounds are enforced at the AUTHORING boundary, so a
--    graph the checkout path cannot honour can never be stored.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_rev timestamptz; v_ticket uuid; g jsonb;
BEGIN
  SELECT id, updated_at INTO v_event, v_rev FROM public.events
   WHERE brand_id = '19710000-0000-4000-8000-000000000010' AND event_type = 'trip';
  SELECT ticket_type_id INTO v_ticket FROM public.trip_pricing_tiers WHERE event_id = v_event LIMIT 1;

  -- 101% deposit.
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_ticket,
        'tier_metadata', jsonb_build_object('installments', jsonb_build_object(
          'deposit_pct', 101,
          'installments', jsonb_build_array(jsonb_build_object(
            'ordinal', 1, 'pct', 50, 'days_after_booking', 30))))))),
      v_rev, '19710000-0000-4000-8000-0000000000b1');
    RAISE EXCEPTION 'D-01 a 101%% deposit was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- Negative instalment percentage.
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_ticket,
        'tier_metadata', jsonb_build_object('installments', jsonb_build_object(
          'deposit_pct', 150,
          'installments', jsonb_build_array(jsonb_build_object(
            'ordinal', 1, 'pct', -50, 'days_after_booking', 30))))))),
      v_rev, '19710000-0000-4000-8000-0000000000b2');
    RAISE EXCEPTION 'D-02 a negative instalment percentage was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- A schedule that does not total 100.
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_ticket,
        'tier_metadata', jsonb_build_object('installments', jsonb_build_object(
          'deposit_pct', 30,
          'installments', jsonb_build_array(jsonb_build_object(
            'ordinal', 1, 'pct', 30, 'days_after_booking', 30))))))),
      v_rev, '19710000-0000-4000-8000-0000000000b3');
    RAISE EXCEPTION 'D-03 a schedule that does not total 100 was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  IF (SELECT tier_metadata FROM public.trip_pricing_tiers WHERE event_id = v_event LIMIT 1)
       <> '{}'::jsonb THEN
    RAISE EXCEPTION 'D-04 a rejected tier patch still wrote metadata';
  END IF;

  -- A valid 30/70 schedule persists exactly.
  g := public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_ticket,
      'tier_name', 'Standard',
      'capacity', 12,
      'tier_metadata', jsonb_build_object('installments', jsonb_build_object(
        'deposit_pct', 30,
        'installments', jsonb_build_array(jsonb_build_object(
          'ordinal', 1, 'pct', 70, 'days_after_booking', 30))))))),
    v_rev, '19710000-0000-4000-8000-0000000000b4');

  IF (g#>>'{tiers,0,tier_metadata,installments,deposit_pct}') <> '30' THEN
    RAISE EXCEPTION 'D-05 a valid 30/70 schedule did not persist, got %',
      g#>>'{tiers,0,tier_metadata,installments,deposit_pct}';
  END IF;
  IF (g#>>'{tiers,0,ticket_type,quantity_total}') <> '12' THEN
    RAISE EXCEPTION 'D-06 tier capacity did not persist';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- E. Exactly-once. Same operation id + same arguments replays the recorded
--    result; the SAME operation id with a different expected revision is an
--    idempotency conflict rather than a silent replay.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid; v_rev timestamptz; v_first jsonb; v_replay jsonb; v_before int; v_after int;
BEGIN
  SELECT id, updated_at INTO v_event, v_rev FROM public.events
   WHERE brand_id = '19710000-0000-4000-8000-000000000010' AND event_type = 'trip';

  v_first := public.biz_apply_trip_draft_graph(
    v_event, jsonb_build_object('event', jsonb_build_object('title', 'Replay probe')),
    v_rev, '19710000-0000-4000-8000-0000000000c1');

  SELECT count(*) INTO v_before FROM public.biz_trip_command_receipts;
  v_replay := public.biz_apply_trip_draft_graph(
    v_event, jsonb_build_object('event', jsonb_build_object('title', 'Replay probe')),
    v_rev, '19710000-0000-4000-8000-0000000000c1');
  SELECT count(*) INTO v_after FROM public.biz_trip_command_receipts;

  IF v_replay IS DISTINCT FROM v_first THEN RAISE EXCEPTION 'E-01 replay returned a different result'; END IF;
  IF v_after <> v_before THEN RAISE EXCEPTION 'E-02 replay created a second receipt'; END IF;

  -- `expected_updated_at` is part of the receipt argument hash. Without it, the
  -- same operation id with a materially different expected revision would
  -- return the earlier result instead of failing closed.
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event, jsonb_build_object('event', jsonb_build_object('title', 'Replay probe')),
      v_rev + interval '1 microsecond', '19710000-0000-4000-8000-0000000000c1');
    RAISE EXCEPTION 'E-03 a changed expected revision replayed instead of conflicting';
  EXCEPTION WHEN sqlstate '23505' THEN NULL;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- F. Publish loads the PERSISTED graph. A caller can no longer hand the publish
--    owner an empty payload, and the whole existing validation set still runs.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_rev timestamptz; v_result jsonb; v_status text;
BEGIN
  SELECT id, updated_at INTO v_event, v_rev FROM public.events
   WHERE brand_id = '19710000-0000-4000-8000-000000000010' AND event_type = 'trip';

  -- No dates yet: the existing publish authority must still refuse.
  BEGIN
    v_result := public.biz_publish_trip_command(v_event, v_rev, '19710000-0000-4000-8000-0000000000d1');
    IF COALESCE((v_result->>'ok')::boolean, true) THEN
      RAISE EXCEPTION 'F-01 an undated trip published';
    END IF;
  EXCEPTION WHEN sqlstate '22023' OR sqlstate 'P0001' THEN NULL;
  END;

  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'F-02 a refused publish still moved status to %', v_status; END IF;

  -- Give it a master date, then publish for real.
  SELECT id, updated_at INTO v_event, v_rev FROM public.events WHERE id = v_event;
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event_dates', jsonb_build_array(jsonb_build_object(
      'start_at', (now() + interval '60 days')::text,
      'end_at', (now() + interval '67 days')::text,
      'is_master', true))),
    v_rev, '19710000-0000-4000-8000-0000000000d2');

  SELECT updated_at INTO v_rev FROM public.events WHERE id = v_event;
  v_result := public.biz_publish_trip_command(v_event, v_rev, '19710000-0000-4000-8000-0000000000d3');

  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'F-03 publish did not promote the trip, status=% result=%', v_status, v_result;
  END IF;
  IF v_result->'graph' IS NULL THEN RAISE EXCEPTION 'F-04 publish returned no graph'; END IF;
  -- The persisted destination survives publish, which is what proves the
  -- payload came from stored state and not from a caller-supplied blob.
  IF (v_result#>>'{graph,event,destination_text}') <> 'Lagos, Nigeria' THEN
    RAISE EXCEPTION 'F-05 publish did not carry the persisted destination, got %',
      v_result#>>'{graph,event,destination_text}';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- G. The established shared Business `LiveTripPatch` vocabulary must survive
--    the canonical live command byte for byte. Independent QA found the
--    grouped-only allowlist made published trip editing DEAD on web, iOS and
--    Android at once; this is the guard for that exact payload.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_rev timestamptz; v_result jsonb;
BEGIN
  SELECT id, updated_at INTO v_event, v_rev FROM public.events
   WHERE brand_id = '19710000-0000-4000-8000-000000000010' AND event_type = 'trip';

  v_result := public.biz_update_trip_live_command(
    v_event,
    -- EXACTLY what mingla-business/src/services/tripsService.ts sends.
    jsonb_build_object('title', 'Lagos December (revised)', 'description', 'Now eight nights'),
    'Organiser corrected the published title and length',
    v_rev,
    '19710000-0000-4000-8000-0000000000e1');

  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'G-01 shared payload did not round-trip: %', v_result;
  END IF;
  IF (SELECT title FROM public.events WHERE id = v_event) <> 'Lagos December (revised)' THEN
    RAISE EXCEPTION 'G-02 the shared top-level title never reached the live updater';
  END IF;
  IF v_result->'graph' IS NULL THEN RAISE EXCEPTION 'G-03 live command returned no graph'; END IF;

  -- A live edit still requires a bounded audit reason.
  SELECT updated_at INTO v_rev FROM public.events WHERE id = v_event;
  BEGIN
    PERFORM public.biz_update_trip_live_command(
      v_event, jsonb_build_object('title', 'No reason'), 'short', v_rev,
      '19710000-0000-4000-8000-0000000000e2');
    RAISE EXCEPTION 'G-04 a live edit was accepted without a bounded reason';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- Invalid instalment metadata on the SHARED top-level vocabulary is rejected
  -- before anything is delegated.
  SELECT updated_at INTO v_rev FROM public.events WHERE id = v_event;
  BEGIN
    PERFORM public.biz_update_trip_live_command(
      v_event,
      jsonb_build_object('pricing_tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', (SELECT ticket_type_id FROM public.trip_pricing_tiers WHERE event_id = v_event LIMIT 1),
        'tier_metadata', jsonb_build_object('installments', jsonb_build_object(
          'deposit_pct', 101,
          'installments', jsonb_build_array(jsonb_build_object('ordinal', 1, 'pct', 50, 'days_after_booking', 10))))))),
      'Organiser attempted an out of range deposit', v_rev,
      '19710000-0000-4000-8000-0000000000e3');
    RAISE EXCEPTION 'G-05 out-of-range live instalment metadata was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- H. Aggregate money read: finance-gated, and free of buyer PII.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_snapshot jsonb; v_key text;
BEGIN
  SELECT id INTO v_event FROM public.events
   WHERE brand_id = '19710000-0000-4000-8000-000000000010' AND event_type = 'trip';
  v_snapshot := public.biz_get_trip_order_money_snapshot(v_event);

  IF v_snapshot->>'event_id' IS NULL THEN RAISE EXCEPTION 'H-01 snapshot has no event'; END IF;
  IF v_snapshot->>'currency' <> 'GBP' THEN RAISE EXCEPTION 'H-02 snapshot lost the event currency'; END IF;
  IF (v_snapshot->>'order_count')::int <> 0 THEN RAISE EXCEPTION 'H-03 unexpected orders'; END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'buyer_email', 'buyer_name', 'buyer_phone', 'buyer_phone_e164', 'buyer_user_id',
    'intake_form_data', 'stripe_payment_intent_id', 'stripe_customer_id_on_connected_account'
  ] LOOP
    IF v_snapshot::text ILIKE '%' || v_key || '%' THEN
      RAISE EXCEPTION 'H-04 aggregate money read leaked %', v_key;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- I. Soft delete + the order/delete serialization trigger.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid; v_rev timestamptz; v_result jsonb; v_order uuid := gen_random_uuid();
BEGIN
  SELECT id, updated_at INTO v_event, v_rev FROM public.events
   WHERE brand_id = '19710000-0000-4000-8000-000000000010' AND event_type = 'trip';

  -- A confirmed order on ANY rail blocks deletion. `biz_trip_has_web_purchases`
  -- would not have seen this one — it is a door sale, not a card payment.
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_method,
                            payment_status, is_door_sale, source)
  VALUES (v_order, v_event, 5000, 'GBP', 'cash', 'paid', true, 'door_sale');

  v_result := public.biz_soft_delete_trip(v_event, v_rev, '19710000-0000-4000-8000-0000000000f1');
  IF COALESCE((v_result->>'deleted')::boolean, false) THEN
    RAISE EXCEPTION 'I-01 a trip with a confirmed door order was deleted';
  END IF;
  IF v_result->>'reason' <> 'has_confirmed_orders' THEN
    RAISE EXCEPTION 'I-02 wrong rejection reason: %', v_result->>'reason';
  END IF;
  IF (SELECT deleted_at FROM public.events WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'I-03 a rejected delete still wrote deleted_at';
  END IF;

  -- Cancel it and the delete succeeds.
  UPDATE public.orders SET payment_status = 'cancelled' WHERE id = v_order;
  SELECT updated_at INTO v_rev FROM public.events WHERE id = v_event;
  v_result := public.biz_soft_delete_trip(v_event, v_rev, '19710000-0000-4000-8000-0000000000f2');
  IF NOT COALESCE((v_result->>'deleted')::boolean, false) THEN
    RAISE EXCEPTION 'I-04 delete refused with no confirmed orders: %', v_result;
  END IF;
  IF (SELECT deleted_at FROM public.events WHERE id = v_event) IS NULL THEN
    RAISE EXCEPTION 'I-05 delete reported success but wrote nothing';
  END IF;

  -- The other direction of the same race: a deleted trip cannot take a new
  -- confirmed order.
  BEGIN
    INSERT INTO public.orders(id, event_id, total_cents, currency, payment_method,
                              payment_status, source)
    VALUES (gen_random_uuid(), v_event, 1000, 'GBP', 'card_reader', 'paid', 'door_sale');
    RAISE EXCEPTION 'I-06 a deleted trip accepted a new confirmed order';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'trip_deleted_order_forbidden' THEN RAISE; END IF;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- J. The Ari EXECUTOR SEAM. This is deliberately not a helper-level assertion:
--    it goes through `ari_execute_trip_operation` and a real confirmed
--    pending action, so deleting the call site cannot leave this green.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_brand uuid := '19710000-0000-4000-8000-000000000010';
  v_op uuid := '19710000-0000-4000-8000-000000000f01';
  v_args jsonb;
  v_result jsonb;
  v_event uuid;
  v_replay jsonb;
BEGIN
  v_args := jsonb_build_object('brand_id', v_brand::text, 'title', 'Ari created trip');

  INSERT INTO public.agent_pending_actions(
    id, user_id, conversation_id, tool_name, tool_args, status,
    server_proposed_at, execution_attested_at)
  VALUES (v_op, '19710000-0000-4000-8000-000000000001',
          '19710000-0000-4000-8000-0000000000c0', 'create_trip', v_args,
          'executing', now(), now());

  v_result := public.ari_execute_trip_operation(v_op, 'create_trip', v_args);
  v_event := (v_result#>>'{event,id}')::uuid;
  IF v_event IS NULL THEN RAISE EXCEPTION 'J-01 the Ari executor returned no trip'; END IF;
  IF (v_result#>>'{event,event_type}') <> 'trip' THEN RAISE EXCEPTION 'J-02 the Ari executor made a non-trip'; END IF;

  -- Both receipts commit with the mutation: #1972's generic recovery receipt
  -- and the trip-domain receipt.
  IF NOT EXISTS (SELECT 1 FROM public.agent_operation_receipts WHERE operation_id = v_op) THEN
    RAISE EXCEPTION 'J-03 no #1972 recovery receipt was written';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.biz_trip_command_receipts WHERE operation_id = v_op) THEN
    RAISE EXCEPTION 'J-04 no trip-domain receipt was written';
  END IF;

  v_replay := public.ari_execute_trip_operation(v_op, 'create_trip', v_args);
  IF v_replay IS DISTINCT FROM v_result THEN RAISE EXCEPTION 'J-05 the Ari executor did not replay exactly'; END IF;
  IF (SELECT count(*) FROM public.events
       WHERE brand_id = v_brand AND event_type = 'trip' AND title = 'Ari created trip') <> 1 THEN
    RAISE EXCEPTION 'J-06 the Ari executor created a second trip on replay';
  END IF;

  -- A tool name outside the trip domain is refused by the executor itself.
  BEGIN
    PERFORM public.ari_execute_trip_operation(
      '19710000-0000-4000-8000-000000000f02', 'delete_brand', '{}'::jsonb);
    RAISE EXCEPTION 'J-07 the Ari trip executor accepted a foreign tool';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'unsupported_trip_operation' THEN RAISE; END IF;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- K. The Ari graph tools reach the SAME canonical command as the manual path.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid; v_rev timestamptz; v_op uuid := '19710000-0000-4000-8000-000000000f10';
  v_args jsonb; v_result jsonb;
BEGIN
  SELECT id, updated_at INTO v_event, v_rev FROM public.events
   WHERE title = 'Ari created trip' AND event_type = 'trip';

  v_args := jsonb_build_object(
    'event_id', v_event::text,
    'expected_updated_at', v_rev::text,
    'items', jsonb_build_array(
      jsonb_build_object('ordinal', 1, 'title', 'Day one'),
      jsonb_build_object('ordinal', 2, 'title', 'Day two'),
      jsonb_build_object('ordinal', 3, 'title', 'Day three')));

  INSERT INTO public.agent_pending_actions(
    id, user_id, conversation_id, tool_name, tool_args, status,
    server_proposed_at, execution_attested_at)
  VALUES (v_op, '19710000-0000-4000-8000-000000000001',
          '19710000-0000-4000-8000-0000000000c0', 'manage_trip_days', v_args,
          'executing', now(), now());

  v_result := public.ari_execute_trip_operation(v_op, 'manage_trip_days', v_args);
  IF jsonb_array_length(v_result->'days') <> 3 THEN
    RAISE EXCEPTION 'K-01 manage_trip_days did not replace the itinerary, got %',
      jsonb_array_length(v_result->'days');
  END IF;
  -- The manual reader sees the Ari write, because there is one owner.
  IF (SELECT count(*) FROM public.trip_days WHERE event_id = v_event) <> 3 THEN
    RAISE EXCEPTION 'K-02 the manual read path does not see the Ari write';
  END IF;
END $$;

ROLLBACK;

\echo 'issue_1971_trip_lifecycle.implementor.happy.pg17: PASS'
