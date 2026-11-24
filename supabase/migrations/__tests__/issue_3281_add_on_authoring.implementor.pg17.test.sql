-- #3281 S3: one authoring path for add-ons on every offering (biz_offering_add_ons / _save).
-- MINGLA-INVARIANT: I-ADDON-ONE-AUTHORING-PATH | issue #3281 | The Host editor reads and saves an offering's whole add-on list through biz_offering_add_ons and biz_offering_add_ons_save, for event managers only, against the offering's revision, refusing a stale save with PT409 add_ons_changed_elsewhere.
-- MINGLA-INVARIANT: I-ADDON-SAVE-MINOR-UNITS | issue #3281 | biz_offering_add_ons_save accepts add-on prices only as whole minor units and refuses fractions.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '32813000-0000-4000-8300-000000000001';
  v_stranger uuid := '32813000-0000-4000-8300-000000000002';
  v_brand uuid := '32813000-0000-4000-8300-000000000003';
  v_event uuid := '32813000-0000-4000-8300-000000000004';
  v_other_event uuid := '32813000-0000-4000-8300-000000000005';
  v_trip uuid := '32813000-0000-4000-8300-000000000006';
  v_rsvp uuid := '32813000-0000-4000-8300-000000000007';
  v_free uuid := '32813000-0000-4000-8300-000000000011';
  v_paid uuid := '32813000-0000-4000-8300-000000000012';
  v_friday uuid := '32813000-0000-4000-8300-000000000013';
  v_foreign uuid := '32813000-0000-4000-8300-000000000014';
  v_package uuid := '32813000-0000-4000-8300-000000000015';
  v_order uuid := '32813000-0000-4000-8300-000000000021';
  v_payload jsonb;
  v_rev bigint;
  v_rev2 bigint;
  v_dinner uuid;
  v_tote uuid;
  v_raised text;
  v_state text;
  v_list jsonb;
  v_many jsonb := '[]'::jsonb;
  v_photo text;
  i integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'s3-owner@example.test'),(v_stranger,'s3-stranger@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'s3-owner@example.test'),(v_stranger,'s3-stranger@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'S3 brand','s3-brand','USD','stripe','US','US','USD');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES
    (v_event,v_brand,v_owner,'S3 event','s3-event','event','scheduled','public','UTC','USD'),
    (v_other_event,v_brand,v_owner,'S3 other','s3-other','event','scheduled','public','UTC','USD'),
    (v_trip,v_brand,v_owner,'S3 trip','s3-trip','trip','draft','public','UTC','USD'),
    (v_rsvp,v_brand,v_owner,'S3 rsvp','s3-rsvp','rsvp','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master,occurrence_key) VALUES
    (v_event,now()+interval '1 day',now()+interval '1 day 2 hours','UTC',true,'d1'),
    (v_event,now()+interval '2 days',now()+interval '2 days 2 hours','UTC',false,'d2'),
    (v_event,now()+interval '3 days',now()+interval '3 days 2 hours','UTC',false,'d3');
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,valid_occurrence_keys
  ) VALUES
    (v_free,v_event,'Free entry',0,'USD',true,100,false,1,10,true,false,NULL),
    (v_paid,v_event,'Paid entry',1000,'USD',false,100,false,1,10,true,false,NULL),
    (v_friday,v_event,'Friday only',1500,'USD',false,100,false,1,10,true,false,ARRAY['d1']),
    (v_foreign,v_other_event,'Elsewhere',1000,'USD',false,100,false,1,10,true,false,NULL),
    (v_package,v_trip,'Shared room',250000,'USD',false,8,false,1,4,true,false,NULL);

  -- ---- Who may read: event managers only. -----------------------------------
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons(v_event);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'authentication_required' THEN
    RAISE EXCEPTION 'anon read must be refused, got %', v_raised;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons(v_event);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; v_state := SQLSTATE; END;
  IF v_raised IS DISTINCT FROM 'add_ons_forbidden' OR v_state <> '42501' THEN
    RAISE EXCEPTION 'a stranger must not read the add-ons, got % %', v_raised, v_state;
  END IF;
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, '[]'::jsonb, 0);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_ons_forbidden' THEN
    RAISE EXCEPTION 'a stranger must not save add-ons, got %', v_raised;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_payload := public.biz_offering_add_ons(v_event);
  IF (v_payload->>'revision')::bigint <> 0 OR jsonb_array_length(v_payload->'addOns') <> 0
     OR jsonb_array_length(v_payload->'targets') <> 3
     OR jsonb_array_length(v_payload->'dates') <> 3
     OR (v_payload->>'multiLinkEnabled')::boolean OR (v_payload->>'freeParentEnabled')::boolean
     OR v_payload->>'currency' IS DISTINCT FROM 'USD' THEN
    RAISE EXCEPTION 'empty offering payload wrong: %', v_payload;
  END IF;

  -- ---- Create: one per ticket while multi-link is off. ------------------------
  v_list := jsonb_build_array(
    jsonb_build_object('name','Friday dinner','priceCents',2500,'isUnlimited',false,'quantityTotal',40,
      'maxPerTicket',2,'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_paid)),
      'validOccurrenceKeys',jsonb_build_array('d1','d2'),'showOnPublicPage',true),
    jsonb_build_object('name','Tote bag','priceCents',0,'isUnlimited',true,
      'maxPerTicket',1,'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_free)),
      'showOnPublicPage',false));
  v_payload := public.biz_offering_add_ons_save(v_event, v_list, 0);
  v_rev := (v_payload->>'revision')::bigint;
  IF v_rev <= 0 OR jsonb_array_length(v_payload->'addOns') <> 2 THEN
    RAISE EXCEPTION 'create must bump the revision and list both, got %', v_payload;
  END IF;
  SELECT id INTO v_dinner FROM public.ticket_add_ons WHERE event_id = v_event AND name = 'Friday dinner';
  SELECT id INTO v_tote FROM public.ticket_add_ons WHERE event_id = v_event AND name = 'Tote bag';
  IF (SELECT ticket_type_id FROM public.ticket_add_ons WHERE id = v_dinner) IS DISTINCT FROM v_paid
     OR (SELECT count(*) FROM public.ticket_add_on_links WHERE add_on_id = v_dinner) <> 1
     OR (SELECT price_cents FROM public.ticket_add_ons WHERE id = v_dinner) <> 2500
     OR (SELECT valid_occurrence_keys FROM public.ticket_add_ons WHERE id = v_dinner) IS DISTINCT FROM ARRAY['d1','d2']
     OR (SELECT show_on_public_page FROM public.ticket_add_ons WHERE id = v_tote)
     OR v_payload->'addOns'->0->'targets'->0->>'ticketTypeId' IS DISTINCT FROM v_paid::text THEN
    RAISE EXCEPTION 'created rows wrong: %', v_payload;
  END IF;

  -- ---- A stale save is refused with PT409, never 40001. -----------------------
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, v_list, 0);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; v_state := SQLSTATE; END;
  IF v_raised IS DISTINCT FROM 'add_ons_changed_elsewhere' OR v_state <> 'PT409' THEN
    RAISE EXCEPTION 'stale save must raise PT409 add_ons_changed_elsewhere, got % %', v_raised, v_state;
  END IF;
  -- The tier-JSON path (or any other writer) also moves the revision.
  UPDATE public.ticket_add_ons SET description = 'Three courses' WHERE id = v_dinner;
  v_rev2 := (public.biz_offering_add_ons(v_event)->>'revision')::bigint;
  IF v_rev2 <= v_rev THEN
    RAISE EXCEPTION 'a direct add-on write must bump the revision (% -> %)', v_rev, v_rev2;
  END IF;
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, v_list, v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; v_state := SQLSTATE; END;
  IF v_raised IS DISTINCT FROM 'add_ons_changed_elsewhere' OR v_state <> 'PT409' THEN
    RAISE EXCEPTION 'a save after another writer must be refused, got % %', v_raised, v_state;
  END IF;
  v_rev := v_rev2;

  -- ---- Rules, each with its code. ---------------------------------------------
  -- Two tickets while multi-link is off.
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('id',v_dinner,'name','Friday dinner','priceCents',2500,'isUnlimited',false,'quantityTotal',40,
      'maxPerTicket',2,'targets',jsonb_build_array(
        jsonb_build_object('kind','ticket_type','ticketTypeId',v_paid),
        jsonb_build_object('kind','ticket_type','ticketTypeId',v_friday)))), v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_on_multi_link_off' THEN
    RAISE EXCEPTION 'two tickets with multi-link off must be refused, got %', v_raised;
  END IF;
  -- No target.
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('name','Lonely','priceCents',100,'isUnlimited',true,'maxPerTicket',1,'targets','[]'::jsonb)), v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_on_target_required' THEN
    RAISE EXCEPTION 'no target must be refused, got %', v_raised;
  END IF;
  -- Another offering's ticket.
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('name','Stray','priceCents',100,'isUnlimited',true,'maxPerTicket',1,
      'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_foreign)))), v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_on_link_wrong_offering' THEN
    RAISE EXCEPTION 'a foreign ticket must be refused, got %', v_raised;
  END IF;
  -- The RSVP target on an event that is not an RSVP.
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('name','Stray','priceCents',0,'isUnlimited',true,'maxPerTicket',1,
      'targets',jsonb_build_array(jsonb_build_object('kind','rsvp')))), v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_on_link_wrong_offering' THEN
    RAISE EXCEPTION 'an rsvp target on an event must be refused, got %', v_raised;
  END IF;
  -- A paid add-on on a free ticket while free parents are off.
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('name','Paid drink','priceCents',800,'isUnlimited',true,'maxPerTicket',1,
      'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_free)))), v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'paid_extra_on_free_ticket' THEN
    RAISE EXCEPTION 'paid on free with the switch off must be refused, got %', v_raised;
  END IF;
  -- Dates the ticket does not admit.
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('name','Saturday brunch','priceCents',900,'isUnlimited',true,'maxPerTicket',1,
      'validOccurrenceKeys',jsonb_build_array('d1','d3'),
      'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_friday)))), v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_on_dates_outside_tickets' THEN
    RAISE EXCEPTION 'dates outside the ticket must be refused, got %', v_raised;
  END IF;
  -- Fractions of a minor unit (I-ADDON-SAVE-MINOR-UNITS).
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('name','Half cent','priceCents',12.5,'isUnlimited',true,'maxPerTicket',1,
      'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_paid)))), v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_ons_invalid' THEN
    RAISE EXCEPTION 'a fractional price must be refused, got %', v_raised;
  END IF;
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('name','String price','priceCents','1200','isUnlimited',true,'maxPerTicket',1,
      'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_paid)))), v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_ons_invalid' THEN
    RAISE EXCEPTION 'a text price must be refused, got %', v_raised;
  END IF;
  -- A photo outside this offering's folder.
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('name','Pic','priceCents',100,'isUnlimited',true,'maxPerTicket',1,
      'photoPath','add-ons/'||v_other_event||'/32813000-0000-4000-8300-0000000000aa.jpg',
      'photoThumbPath','add-ons/'||v_other_event||'/32813000-0000-4000-8300-0000000000aa_thumb.jpg',
      'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_paid)))), v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_on_photo_invalid' THEN
    RAISE EXCEPTION 'a foreign photo path must be refused, got %', v_raised;
  END IF;
  -- More than 40.
  FOR i IN 1..41 LOOP
    v_many := v_many || jsonb_build_array(jsonb_build_object('name','A'||i,'priceCents',100,'isUnlimited',true,
      'maxPerTicket',1,'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_paid))));
  END LOOP;
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, v_many, v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_ons_too_many' THEN
    RAISE EXCEPTION 'more than 40 add-ons must be refused, got %', v_raised;
  END IF;
  -- More than 20 on one ticket.
  v_many := '[]'::jsonb;
  FOR i IN 1..21 LOOP
    v_many := v_many || jsonb_build_array(jsonb_build_object('name','B'||i,'priceCents',100,'isUnlimited',true,
      'maxPerTicket',1,'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_paid))));
  END LOOP;
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, v_many, v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_ons_too_many_for_ticket' THEN
    RAISE EXCEPTION 'more than 20 on a ticket must be refused, got %', v_raised;
  END IF;
  IF (public.biz_offering_add_ons(v_event)->>'revision')::bigint <> v_rev THEN
    RAISE EXCEPTION 'a refused save must not move the revision';
  END IF;

  -- ---- Switches on: one add-on, two tickets, one stock; paid on free. ---------
  UPDATE public.add_on_rollout SET multi_link_enabled = true, free_parent_enabled = true;
  v_photo := 'add-ons/'||v_event||'/32813000-0000-4000-8300-0000000000bb.jpg';
  v_payload := public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('id',v_dinner,'name','Friday dinner','priceCents',2500,'isUnlimited',false,'quantityTotal',40,
      'maxPerTicket',2,'validOccurrenceKeys',jsonb_build_array('d1'),
      'photoPath',v_photo,'photoThumbPath',replace(v_photo,'.jpg','_thumb.jpg'),
      'targets',jsonb_build_array(
        jsonb_build_object('kind','ticket_type','ticketTypeId',v_paid),
        jsonb_build_object('kind','ticket_type','ticketTypeId',v_friday))),
    jsonb_build_object('name','Paid drink','priceCents',800,'isUnlimited',true,'maxPerTicket',1,
      'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_free)))), v_rev);
  v_rev := (v_payload->>'revision')::bigint;
  IF (SELECT count(*) FROM public.ticket_add_on_links WHERE add_on_id = v_dinner) <> 2
     OR (SELECT count(*) FROM public.ticket_add_ons WHERE event_id = v_event AND name = 'Friday dinner') <> 1
     OR (SELECT photo_thumb_path FROM public.ticket_add_ons WHERE id = v_dinner) <> replace(v_photo,'.jpg','_thumb.jpg')
     OR jsonb_array_length(v_payload->'addOns') <> 2 THEN
    RAISE EXCEPTION 'multi-link save wrong: %', v_payload;
  END IF;
  -- The tote was not listed: it stops selling, its row and link stay.
  IF (SELECT is_active FROM public.ticket_add_ons WHERE id = v_tote)
     OR NOT EXISTS (SELECT 1 FROM public.ticket_add_on_links WHERE add_on_id = v_tote) THEN
    RAISE EXCEPTION 'an unlisted add-on must stop selling and keep its row';
  END IF;

  -- ---- Sold: price locked, a sold date stays, unlinking a ticket is allowed. --
  INSERT INTO public.orders(id,event_id,total_cents,currency,payment_status,source)
    VALUES (v_order,v_event,3500,'USD','paid','legacy');
  INSERT INTO public.order_add_on_line_items(order_id,ticket_add_on_id,ticket_type_id,
    add_on_name_at_order,ticket_type_name_at_order,quantity,unit_price_cents,total_cents,day_scope_at_order)
    VALUES (v_order,v_dinner,v_paid,'Friday dinner','Paid entry',1,2500,2500,ARRAY['d1']);
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('id',v_dinner,'name','Friday dinner','priceCents',3000,'isUnlimited',false,'quantityTotal',40,
      'maxPerTicket',2,'validOccurrenceKeys',jsonb_build_array('d1'),
      'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_paid)))), v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'sold_extra_mutation_blocked' THEN
    RAISE EXCEPTION 'a sold add-on keeps its price, got %', v_raised;
  END IF;
  v_raised := NULL;
  BEGIN PERFORM public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('id',v_dinner,'name','Friday dinner','priceCents',2500,'isUnlimited',false,'quantityTotal',40,
      'maxPerTicket',2,'validOccurrenceKeys',jsonb_build_array('d2'),
      'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_paid)))), v_rev);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'extra_day_scope_drops_sold_day' THEN
    RAISE EXCEPTION 'a sold date stays, got %', v_raised;
  END IF;
  v_payload := public.biz_offering_add_ons_save(v_event, jsonb_build_array(
    jsonb_build_object('id',v_dinner,'name','Friday dinner','priceCents',2500,'isUnlimited',false,'quantityTotal',40,
      'maxPerTicket',2,'validOccurrenceKeys',jsonb_build_array('d1'),
      'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_paid)))), v_rev);
  IF (SELECT count(*) FROM public.ticket_add_on_links WHERE add_on_id = v_dinner) <> 1
     OR (v_payload->'addOns'->0->>'soldCount')::integer <> 1
     OR v_payload->'addOns'->0->'soldOccurrenceKeys' <> '["d1"]'::jsonb THEN
    RAISE EXCEPTION 'unlinking a ticket from a sold add-on must be allowed, got %', v_payload;
  END IF;

  -- ---- Trips and RSVPs use the same path. -------------------------------------
  v_payload := public.biz_offering_add_ons_save(v_trip, jsonb_build_array(
    jsonb_build_object('name','Airport transfer','priceCents',4000,'isUnlimited',false,'quantityTotal',8,
      'maxPerTicket',1,'targets',jsonb_build_array(jsonb_build_object('kind','ticket_type','ticketTypeId',v_package)))),
    (public.biz_offering_add_ons(v_trip)->>'revision')::bigint);
  IF v_payload->>'eventType' <> 'trip' OR jsonb_array_length(v_payload->'addOns') <> 1 THEN
    RAISE EXCEPTION 'trip save wrong: %', v_payload;
  END IF;
  v_payload := public.biz_offering_add_ons(v_rsvp);
  IF v_payload->'targets' <> '[{"kind":"rsvp"}]'::jsonb THEN
    RAISE EXCEPTION 'an RSVP offers itself as the only target, got %', v_payload->'targets';
  END IF;
  v_payload := public.biz_offering_add_ons_save(v_rsvp, jsonb_build_array(
    jsonb_build_object('name','Welcome drink','priceCents',0,'isUnlimited',false,'quantityTotal',50,
      'maxPerTicket',1,'targets',jsonb_build_array(jsonb_build_object('kind','rsvp')))), 0);
  IF v_payload->'addOns'->0->'targets' <> '[{"kind":"rsvp"}]'::jsonb
     OR (SELECT ticket_type_id FROM public.ticket_add_ons WHERE event_id = v_rsvp) IS NOT NULL THEN
    RAISE EXCEPTION 'rsvp save wrong: %', v_payload;
  END IF;
END;
$test$;

-- ---- Grants: the state table is closed; the RPCs are for signed-in hosts. ----
DO $grants$
BEGIN
  IF has_table_privilege('authenticated', 'public.offering_add_on_state', 'SELECT')
     OR has_table_privilege('anon', 'public.offering_add_on_state', 'SELECT') THEN
    RAISE EXCEPTION 'offering_add_on_state must not be readable by clients';
  END IF;
  IF has_function_privilege('anon', 'public.biz_offering_add_ons_save(uuid,jsonb,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.biz_offering_add_ons(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.biz_offering_add_ons_save(uuid,jsonb,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC grants wrong';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_3281_offering_add_ons_json(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3281_assert_add_on_author(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'internal helpers must not be callable by clients';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.biz_offering_add_ons_save(uuid,jsonb,bigint)'::regprocedure) IS NOT TRUE
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.biz_offering_add_ons_save(uuid,jsonb,bigint)'::regprocedure
                     AND proconfig @> ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION 'save must be SECURITY DEFINER with a pinned search_path';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname LIKE '%add-on photos') <> 3 THEN
    RAISE EXCEPTION 'the three add-on photo storage policies must exist';
  END IF;
END;
$grants$;

ROLLBACK;
