\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4063-COMP-CONTACT-INTENT | issue #4063 | New comp writers explicitly choose contact or name-only; legacy omitted fields preserve name-only behaviour and carry metadata.name_only=true.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i4063_comp_event(
  OUT o_event uuid, OUT o_ticket_type uuid, OUT o_owner uuid, OUT o_brand uuid
) RETURNS record
LANGUAGE plpgsql
AS $fixture$
BEGIN
  o_owner := gen_random_uuid();
  o_brand := gen_random_uuid();
  o_event := gen_random_uuid();
  INSERT INTO auth.users(id, email)
  VALUES (o_owner, 'i4063-comp-' || o_owner || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider
  ) VALUES (
    o_brand, o_owner, 'Issue 4063 comp writer',
    'issue-4063-comp-' || o_brand, 'stripe'
  );
  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, status, visibility, timezone
  ) VALUES (
    o_event, o_brand, 'Issue 4063 comp event',
    'issue-4063-comp-' || o_event, 'event', 'draft', 'draft', 'UTC'
  );
  INSERT INTO public.event_dates(
    event_id, start_at, end_at, timezone, is_master
  ) VALUES (
    o_event, now() + interval '1 hour', now() + interval '5 hours', 'UTC', true
  );
  INSERT INTO public.ticket_types(
    event_id, name, price_cents, is_free, quantity_total,
    min_purchase_qty, available_online, available_in_person, display_order
  ) VALUES (
    o_event, 'General admission', 0, true, 10, 1, true, true, 0
  ) RETURNING id INTO o_ticket_type;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events
     SET status = 'scheduled', visibility = 'public', published_at = now()
   WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
END;
$fixture$;

DO $test$
DECLARE
  v_actor uuid := '40630000-0000-4000-8000-000000002001';
  v_event uuid := '40630000-0000-4000-8000-000000002002';
  v_ticket_type uuid := '40630000-0000-4000-8000-000000002003';
  v_request uuid := '40630000-0000-4000-8000-000000002004';
  v_hint text;
  v_message text;
  v_failed boolean;
  v_definition text;
  v_fixture record;
  v_result jsonb;
  v_order uuid;
BEGIN
  -- An old Business client omitted nameOnly. No contact must keep reaching the
  -- established event gate rather than being rejected as invalid_guests.
  v_failed := false;
  BEGIN
    PERFORM public.biz_comp_issue(
      v_actor, v_event, v_ticket_type, NULL,
      '[{"index":0,"name":"Legacy name only","plusOnes":[]}]'::jsonb,
      NULL, v_request, repeat('p', 32)
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'event_not_open' THEN
      RAISE EXCEPTION 'old client compatibility failed with %', v_message;
    END IF;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'fake event unexpectedly passed';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.biz_comp_issue(
      v_actor, v_event, v_ticket_type, NULL,
      '[{"index":0,"name":"Needs contact","nameOnly":false,"plusOnes":[]}]'::jsonb,
      NULL, v_request, repeat('p', 32)
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
    IF v_message <> 'invalid_guests' OR v_hint <> 'contact_required' THEN
      RAISE EXCEPTION 'explicit contact requirement drifted: % / %',
        v_message, v_hint;
    END IF;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'explicit false without contact was accepted';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.biz_comp_issue(
      v_actor, v_event, v_ticket_type, NULL,
      '[{"index":0,"name":"Contradiction","nameOnly":true,"email":"guest@example.test","plusOnes":[]}]'::jsonb,
      NULL, v_request, repeat('p', 32)
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
    IF v_message <> 'invalid_guests'
       OR v_hint <> 'name_only_with_contact' THEN
      RAISE EXCEPTION 'name-only contradiction drifted: % / %',
        v_message, v_hint;
    END IF;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'nameOnly true with contact was accepted';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.biz_comp_issue(
      v_actor, v_event, v_ticket_type, NULL,
      '[{"index":0,"name":"Lead","nameOnly":false,"email":"lead@example.test","plusOnes":[{"name":"Plus one","nameOnly":false}]}]'::jsonb,
      NULL, v_request, repeat('p', 32)
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
    IF v_message <> 'invalid_guests' OR v_hint <> 'contact_required' THEN
      RAISE EXCEPTION 'plus-one contact requirement drifted: % / %',
        v_message, v_hint;
    END IF;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'named plus-one without contact was accepted';
  END IF;

  -- Execute the full writer with an old-client payload. The resulting order is
  -- still issued, and carries the explicit metadata used by downstream copy.
  SELECT * INTO v_fixture FROM pg_temp.i4063_comp_event();
  v_result := public.biz_comp_issue(
    v_fixture.o_owner,
    v_fixture.o_event,
    v_fixture.o_ticket_type,
    NULL,
    '[{"index":0,"name":"Legacy full path","plusOnes":[]}]'::jsonb,
    NULL,
    gen_random_uuid(),
    repeat('p', 32)
  );
  v_order := (v_result->'results'->0->>'orderId')::uuid;
  IF (v_result->>'addedCount')::integer <> 1
     OR v_order IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.orders
        WHERE id = v_order
          AND buyer_email IS NULL
          AND buyer_phone_e164 IS NULL
          AND metadata->>'name_only' = 'true'
     ) THEN
    RAISE EXCEPTION 'old-client name-only order was not preserved: %', v_result;
  END IF;

  SELECT pg_get_functiondef(
    'public.biz_comp_issue(uuid,uuid,uuid,uuid,jsonb,text,uuid,text)'::regprocedure
  ) INTO v_definition;
  IF position('''nameOnly'', v_name_only' IN v_definition) = 0
     OR position('jsonb_build_object(''name_only'', true)' IN v_definition) = 0
     OR position('p_metadata => CASE' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'name-only intent is not carried to order metadata';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.biz_comp_issue(uuid,uuid,uuid,uuid,jsonb,text,uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.biz_comp_issue(uuid,uuid,uuid,uuid,jsonb,text,uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'comp writer is executable outside service role';
  END IF;
END;
$test$;

ROLLBACK;
