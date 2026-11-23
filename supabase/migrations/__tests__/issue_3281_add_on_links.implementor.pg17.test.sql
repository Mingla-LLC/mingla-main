-- #3281 Add-ons on every offering, slice S1: links, owner, switches.
-- MINGLA-INVARIANT: I-ADDON-LINK-SOLE-TRUTH | issue #3281 | Which tickets an add-on comes with is read only from ticket_add_on_links; no function re-emitted by S1 reads ticket_add_ons.ticket_type_id, and every add-on written through the old single-ticket path gets its owner and one matching link.
-- MINGLA-INVARIANT: I-ADDON-BUYER-SEES-LINKED-ONLY | issue #3281 | A buyer is offered and can buy an add-on only with a ticket it is linked to; a missing link refuses the add-on with extra_not_available, whatever ticket_type_id says.
-- MINGLA-INVARIANT: I-ADDON-SHARED-STOCK | issue #3281 | Stock is one count per add-on, per date when dated, shared by every ticket it is linked to, including several lines of one cart.
-- MINGLA-INVARIANT: I-ADDON-SWITCH-OFF-IDENTICAL | issue #3281 | With every add_on_rollout switch off (the default), an add-on appears once per cart and quotes, holds and orders exactly as before S1; the switches are readable only by service_role and an unknown switch is refused.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '32812000-0000-4000-8a00-000000000001';
  v_brand uuid := '32812000-0000-4000-8a00-000000000002';
  v_event uuid := '32812000-0000-4000-8a00-000000000003';
  v_a uuid := '32812000-0000-4000-8a00-000000000004';
  v_b uuid := '32812000-0000-4000-8a00-000000000005';
  v_c uuid := '32812000-0000-4000-8a00-000000000006';
  v_other_event uuid := '32812000-0000-4000-8a00-000000000007';
  v_other_ticket uuid := '32812000-0000-4000-8a00-000000000008';
  v_rsvp_event uuid := '32812000-0000-4000-8a00-000000000009';
  v_fri uuid := '32812000-0000-4000-8a00-000000000011';
  v_sat uuid := '32812000-0000-4000-8a00-000000000012';
  v_shared uuid := '32812000-0000-4000-8a00-000000000021';
  v_legacy uuid := '32812000-0000-4000-8a00-000000000022';
  v_unlinked uuid := '32812000-0000-4000-8a00-000000000023';
  v_rsvp_add_on uuid := '32812000-0000-4000-8a00-000000000024';
  v_attempt uuid := '32812000-0000-4000-8a00-000000000031';
  v_photo uuid := '32812000-0000-4000-8a00-000000000041';
  v_days uuid[];
  v_lines jsonb;
  v_quote jsonb;
  v_created jsonb;
  v_session uuid;
  v_order uuid;
  v_raised text;
  v_state text;
  v_fn text;
  v_def text;
  v_new uuid;
  v_role text;
BEGIN
  v_days := ARRAY[v_fri, v_sat];

  -- ── Schema, RLS and grants ──────────────────────────────────────────────
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ticket_add_ons' AND column_name='event_id') <> 'NO'
     OR (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ticket_add_ons' AND column_name='ticket_type_id') <> 'YES'
     OR (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ticket_add_ons' AND column_name='show_on_public_page') <> 'true' THEN
    RAISE EXCEPTION 'ticket_add_ons must be owned by the offering, with a nullable ticket and public by default';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.ticket_add_on_links'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.add_on_rollout'::regclass) THEN
    RAISE EXCEPTION 'the links and switch tables must have RLS on';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(v_role,'public.ticket_add_on_links','SELECT')
       OR has_table_privilege(v_role,'public.ticket_add_on_links','INSERT')
       OR has_table_privilege(v_role,'public.ticket_add_on_links','UPDATE')
       OR has_table_privilege(v_role,'public.ticket_add_on_links','DELETE')
       OR has_table_privilege(v_role,'public.add_on_rollout','SELECT')
       OR has_table_privilege(v_role,'public.add_on_rollout','UPDATE')
       OR has_function_privilege(v_role,'public.issue_3281_add_on_switch(text)','EXECUTE')
       OR has_function_privilege(v_role,'public.tg_3281_add_on_legacy_ticket_bridge()','EXECUTE') THEN
      RAISE EXCEPTION '% must not reach the links or the switches', v_role;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role','public.ticket_add_on_links','SELECT')
     OR NOT has_table_privilege('service_role','public.add_on_rollout','UPDATE') THEN
    RAISE EXCEPTION 'service_role reads links and writes switches';
  END IF;
  -- Negative case as the role itself, not only the catalog.
  v_state := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM count(*) FROM public.ticket_add_on_links;
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'denied'; END;
  EXECUTE 'RESET ROLE';
  IF v_state IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'authenticated must not read links'; END IF;
  v_state := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM count(*) FROM public.add_on_rollout;
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'denied'; END;
  EXECUTE 'RESET ROLE';
  IF v_state IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon must not read the switches'; END IF;

  -- ── The switch row: one row, every switch off ───────────────────────────
  IF (SELECT count(*) FROM public.add_on_rollout) <> 1
     OR EXISTS (SELECT 1 FROM public.add_on_rollout
                 WHERE multi_link_enabled OR free_parent_enabled OR plan_enabled OR rsvp_enabled)
     OR public.issue_3281_add_on_switch('multi_link_enabled')
     OR public.issue_3281_add_on_switch('free_parent_enabled')
     OR public.issue_3281_add_on_switch('plan_enabled')
     OR public.issue_3281_add_on_switch('rsvp_enabled') THEN
    RAISE EXCEPTION 'every add-on switch must start off';
  END IF;
  v_raised := NULL;
  BEGIN PERFORM public.issue_3281_add_on_switch('everything_enabled');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'add_on_switch_unknown' THEN
    RAISE EXCEPTION 'an unknown switch must be refused, got %', v_raised;
  END IF;
  v_state := NULL;
  BEGIN INSERT INTO public.add_on_rollout(id) VALUES (false);
  EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'the switch table holds one row only'; END IF;

  -- ── Fixture: one offering, three paid tickets, two dates ────────────────
  INSERT INTO auth.users(id,email) VALUES(v_owner,'addon-links@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'addon-links@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Add-on links','addon-links-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_addon_links',true,true,'US','usd');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
    is_multi_date,multi_date_pricing_mode
  ) VALUES
    (v_event,v_brand,v_owner,'Add-on links','addon-links-event',
     'event','scheduled','public','UTC','USD',true,'per_day'),
    (v_other_event,v_brand,v_owner,'Other offering','addon-links-other',
     'event','scheduled','public','UTC','USD',true,'per_day');
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone)
    VALUES (v_rsvp_event,v_brand,v_owner,'RSVP offering','addon-links-rsvp','rsvp','scheduled','public','UTC');
  INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master,occurrence_key) VALUES
    (v_fri,v_event,date_trunc('minute',now())+interval '1 day',now()+interval '1 day 2 hours','UTC',true,'fri'),
    (v_sat,v_event,date_trunc('minute',now())+interval '2 days',now()+interval '2 days 2 hours','UTC',false,'sat');
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person
  ) VALUES
    (v_a,v_event,'Ticket A',1000,'USD',false,100,false,1,10,true,false),
    (v_b,v_event,'Ticket B',1000,'USD',false,100,false,1,10,true,false),
    (v_c,v_event,'Ticket C',1000,'USD',false,100,false,1,10,true,false),
    (v_other_ticket,v_other_event,'Elsewhere',1000,'USD',false,100,false,1,10,true,false);

  -- ── The old single-ticket write path gets an owner and one link ─────────
  INSERT INTO public.ticket_add_ons(id,ticket_type_id,name,price_cents,quantity_total,is_unlimited,max_per_ticket)
    VALUES (v_legacy,v_a,'Tote bag',700,NULL,true,1),
           (v_unlinked,v_a,'Ghost',300,NULL,true,1);
  IF (SELECT event_id FROM public.ticket_add_ons WHERE id=v_legacy) IS DISTINCT FROM v_event
     OR (SELECT count(*) FROM public.ticket_add_on_links
          WHERE add_on_id=v_legacy AND target_kind='ticket_type' AND ticket_type_id=v_a
            AND event_id=v_event) <> 1
     OR (SELECT count(*) FROM public.ticket_add_on_links WHERE add_on_id=v_legacy) <> 1 THEN
    RAISE EXCEPTION 'a single-ticket insert must get its owner and exactly one link';
  END IF;
  -- Losslessness across every add-on that names a ticket.
  IF EXISTS (
    SELECT 1 FROM public.ticket_add_ons a
     WHERE a.ticket_type_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.ticket_add_on_links l
        WHERE l.add_on_id=a.id AND l.ticket_type_id=a.ticket_type_id AND l.event_id=a.event_id)
  ) THEN
    RAISE EXCEPTION 'every add-on with a ticket must have that ticket link';
  END IF;
  -- The owner never moves, and a ticket from another offering is refused.
  FOR v_raised, v_lines IN VALUES
    ('owner', NULL::jsonb), ('ticket', NULL::jsonb)
  LOOP
    v_state := NULL;
    BEGIN
      IF v_raised = 'owner' THEN
        UPDATE public.ticket_add_ons SET event_id=v_other_event WHERE id=v_legacy;
      ELSE
        INSERT INTO public.ticket_add_ons(event_id,ticket_type_id,name,price_cents,quantity_total,is_unlimited)
          VALUES (v_event,v_other_ticket,'Mismatch',0,NULL,true);
      END IF;
    EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
    IF v_state IS DISTINCT FROM 'add_on_link_wrong_offering' THEN
      RAISE EXCEPTION 'a moved % must be refused, got %', v_raised, v_state;
    END IF;
  END LOOP;

  -- ── Link guard ──────────────────────────────────────────────────────────
  INSERT INTO public.ticket_add_ons(id,event_id,name,price_cents,quantity_total,is_unlimited,max_per_ticket)
    VALUES (v_shared,v_event,'Friday dinner',500,1,false,1);
  IF EXISTS (SELECT 1 FROM public.ticket_add_on_links WHERE add_on_id=v_shared) THEN
    RAISE EXCEPTION 'an add-on with no ticket gets no link by itself';
  END IF;
  INSERT INTO public.ticket_add_on_links(add_on_id,event_id,target_kind,ticket_type_id)
    VALUES (v_shared,v_event,'ticket_type',v_a),(v_shared,v_event,'ticket_type',v_b);
  INSERT INTO public.ticket_add_ons(id,event_id,name,price_cents,quantity_total,is_unlimited)
    VALUES (v_rsvp_add_on,v_rsvp_event,'Welcome drink',0,NULL,true);
  FOR v_raised, v_lines IN VALUES
    ('add_on_link_wrong_offering', jsonb_build_object('event',v_other_event,'kind','ticket_type','ticket',v_other_ticket)),
    ('add_on_link_wrong_offering', jsonb_build_object('event',v_event,'kind','ticket_type','ticket',v_other_ticket)),
    ('add_on_link_wrong_offering', jsonb_build_object('event',v_event,'kind','rsvp')),
    ('23505', jsonb_build_object('event',v_event,'kind','ticket_type','ticket',v_a)),
    ('add_on_link_wrong_offering', jsonb_build_object('event',v_event,'kind','ticket_type')),
    ('23514', jsonb_build_object('event',v_event,'kind','plan','ticket',v_c)),
    -- An RSVP link names no ticket (target shape CHECK, past the guard).
    ('23514', jsonb_build_object('add_on',v_rsvp_add_on,'event',v_rsvp_event,'kind','rsvp','ticket',v_a))
  LOOP
    v_state := NULL;
    BEGIN
      INSERT INTO public.ticket_add_on_links(add_on_id,event_id,target_kind,ticket_type_id)
        VALUES (COALESCE((v_lines->>'add_on')::uuid,v_shared),(v_lines->>'event')::uuid,
          v_lines->>'kind',(v_lines->>'ticket')::uuid);
    EXCEPTION WHEN OTHERS THEN
      v_state := CASE WHEN SQLSTATE IN ('23505','23514') THEN SQLSTATE ELSE SQLERRM END;
    END;
    IF v_state IS DISTINCT FROM v_raised THEN
      RAISE EXCEPTION 'link % must be refused with %, got %', v_lines, v_raised, v_state;
    END IF;
  END LOOP;
  -- An RSVP offering takes one RSVP link per add-on.
  INSERT INTO public.ticket_add_on_links(add_on_id,event_id,target_kind) VALUES (v_rsvp_add_on,v_rsvp_event,'rsvp');
  v_state := NULL;
  BEGIN
    INSERT INTO public.ticket_add_on_links(add_on_id,event_id,target_kind) VALUES (v_rsvp_add_on,v_rsvp_event,'rsvp');
  EXCEPTION WHEN unique_violation THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'an add-on takes the RSVP once'; END IF;

  -- ── Photo paths live under the owner's folder, in pairs ─────────────────
  UPDATE public.ticket_add_ons
     SET photo_path='add-ons/'||v_event||'/'||v_photo||'.jpg',
         photo_thumb_path='add-ons/'||v_event||'/'||v_photo||'_thumb.jpg'
   WHERE id=v_legacy;
  FOR v_raised IN VALUES
    ('add-ons/'||v_other_event||'/'||v_photo||'.jpg|add-ons/'||v_other_event||'/'||v_photo||'_thumb.jpg'),
    ('add-ons/'||v_event||'/'||v_photo||'.png|add-ons/'||v_event||'/'||v_photo||'_thumb.jpg'),
    ('add-ons/'||v_event||'/'||v_photo||'.jpg|'),
    ('https://x.test/render/image/a.jpg|add-ons/'||v_event||'/'||v_photo||'_thumb.jpg')
  LOOP
    v_state := NULL;
    BEGIN
      UPDATE public.ticket_add_ons
         SET photo_path=NULLIF(split_part(v_raised,'|',1),''),
             photo_thumb_path=NULLIF(split_part(v_raised,'|',2),'')
       WHERE id=v_legacy;
    EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
    IF v_state IS NULL THEN RAISE EXCEPTION 'photo paths % must be refused', v_raised; END IF;
  END LOOP;

  -- ── A buyer can buy an add-on only with a linked ticket ─────────────────
  v_quote := public.issue_3872_ticket_quote(v_event,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_b,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_shared,'quantity',1)))),
    v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550911',NULL,NULL,false);
  IF (v_quote->>'extrasTotalCents')::integer <> 500
     OR (v_quote->>'netSubtotalCents')::integer <> 2500
     OR v_quote->'extras'->0->>'ticketTypeId' <> v_b::text
     OR v_quote->'extras'->0->>'ticketName' <> 'Ticket B' THEN
    RAISE EXCEPTION 'an add-on linked to B must sell with B, got %', v_quote;
  END IF;
  FOR v_raised, v_lines IN VALUES
    ('extra_not_available', jsonb_build_array(jsonb_build_object('ticketTypeId',v_c,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_shared,'quantity',1))))),
    -- ticket_type_id still says A, but the link is gone: the link wins.
    ('extra_not_available', jsonb_build_array(jsonb_build_object('ticketTypeId',v_a,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_unlinked,'quantity',1))))),
    ('extra_not_available', jsonb_build_array(jsonb_build_object('ticketTypeId',v_a,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_rsvp_add_on,'quantity',1)))))
  LOOP
    IF v_lines->0->'addOns'->0->>'addOnId' = v_unlinked::text THEN
      DELETE FROM public.ticket_add_on_links WHERE add_on_id=v_unlinked;
    END IF;
    v_state := NULL;
    BEGIN
      PERFORM public.issue_3872_ticket_quote(v_event,v_lines,
        v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550911',NULL,NULL,false);
    EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
    IF v_state IS DISTINCT FROM v_raised THEN
      RAISE EXCEPTION 'cart % must be refused with %, got %', v_lines, v_raised, v_state;
    END IF;
  END LOOP;
  -- Public readers list it under each linked ticket, and only those.
  IF jsonb_array_length(public.issue_3281_public_ticket_extras(v_a)) <> 2
     OR jsonb_array_length(public.issue_3281_public_ticket_extras(v_b)) <> 1
     OR public.issue_3281_public_ticket_extras(v_b)->0->>'id' <> v_shared::text
     OR public.issue_3281_public_ticket_extras(v_c) <> '[]'::jsonb
     OR (SELECT count(*) FROM jsonb_array_elements(public.issue_3281_public_ticket_extras(v_a)) x
          WHERE x->>'id' = v_shared::text AND (x->>'remaining')::integer = 1) <> 1
     OR jsonb_array_length(public.issue_3281_tier_extras_json(v_b)) <> 1
     OR public.issue_3281_tier_extras_json(v_c) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'public and host readers must follow the links';
  END IF;
  IF public.issue_3281_attach_public_extras(json_build_object('tickets',
       json_build_array(json_build_object('id',v_c,'name','Ticket C'))))::text
     <> json_build_object('tickets', json_build_array(json_build_object('id',v_c,'name','Ticket C')))::text THEN
    RAISE EXCEPTION 'a payload with no linked add-on must come back byte for byte';
  END IF;

  -- ── Switch off: one add-on, once per cart, as before ────────────────────
  v_lines := jsonb_build_array(
    jsonb_build_object('ticketTypeId',v_a,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_shared,'quantity',1))),
    jsonb_build_object('ticketTypeId',v_b,'quantity',1,
      'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_shared,'quantity',1))));
  v_state := NULL;
  BEGIN
    PERFORM public.issue_3872_ticket_quote(v_event,v_lines,
      v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550911',NULL,NULL,false);
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  IF v_state IS DISTINCT FROM 'extras_invalid' THEN
    RAISE EXCEPTION 'with the switch off an add-on is refused twice in a cart, got %', v_state;
  END IF;

  -- ── Switch on: once per ticket, one shared stock ────────────────────────
  UPDATE public.add_on_rollout SET multi_link_enabled=true, updated_at=now(), updated_by='pg17-test';
  v_state := NULL;
  BEGIN
    PERFORM public.issue_3872_ticket_quote(v_event,v_lines,
      v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550911',NULL,NULL,false);
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  IF v_state IS DISTINCT FROM 'extra_capacity_exceeded' THEN
    RAISE EXCEPTION 'two lines must share one place of stock, got %', v_state;
  END IF;
  UPDATE public.ticket_add_ons SET quantity_total=2 WHERE id=v_shared;
  v_quote := public.issue_3872_ticket_quote(v_event,v_lines,
    v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550911',NULL,NULL,false);
  IF (v_quote->>'extrasTotalCents')::integer <> 1000 OR jsonb_array_length(v_quote->'extras') <> 2 THEN
    RAISE EXCEPTION 'the add-on must price once per ticket, got %', v_quote;
  END IF;
  -- The session holds one row per parent ticket, and the order records both.
  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Buyer','buyer@example.test','+15555550911',false,v_lines,
    'ticket_checkout:v2:'||v_event::text||':'||v_attempt::text,
    now()+interval '15 minutes',0,'full',v_days,NULL,NULL,NULL,NULL,v_quote->>'quoteDigest');
  v_session := (v_created->>'checkoutSessionId')::uuid;
  IF (SELECT count(*) FROM public.ticket_checkout_session_add_on_items
       WHERE checkout_session_id=v_session AND ticket_add_on_id=v_shared
         AND parent_kind='ticket_type' AND plan_choice IS NULL) <> 2
     OR public.issue_3281_add_on_taken(v_shared,NULL,NULL) <> 2 THEN
    RAISE EXCEPTION 'the session must hold the add-on once per ticket, got %', v_created;
  END IF;
  -- Shared stock is gone for a third buyer on either ticket.
  v_state := NULL;
  BEGIN
    PERFORM public.issue_3872_ticket_quote(v_event,
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_b,'quantity',1,
        'addOns',jsonb_build_array(jsonb_build_object('addOnId',v_shared,'quantity',1)))),
      v_days,NULL,NULL,NULL,'full',NULL,'third@example.test','+15555550912',NULL,NULL,false);
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  IF v_state IS DISTINCT FROM 'extra_capacity_exceeded' THEN
    RAISE EXCEPTION 'held stock must be shared across links, got %', v_state;
  END IF;
  PERFORM public.issue_1930_ticket_checkout_finalize_base(
    v_session,'pi_addon_links','ch_addon_links','card','addon-links-pepper-0123456789abcdef0123456789');
  SELECT order_id INTO v_order FROM public.ticket_checkout_sessions WHERE id=v_session;
  IF (SELECT count(*) FROM public.order_add_on_line_items
       WHERE order_id=v_order AND ticket_add_on_id=v_shared AND parent_kind='ticket_type'
         AND plan_choice IS NULL AND ticket_type_id IN (v_a,v_b)) <> 2
     OR (SELECT total_cents FROM public.orders WHERE id=v_order) <> 5000 THEN
    RAISE EXCEPTION 'the order must record the add-on once per ticket';
  END IF;
  UPDATE public.add_on_rollout SET multi_link_enabled=false, updated_at=now(), updated_by='pg17-test';

  -- ── Order lines: bought-with parent and plan choice shapes ──────────────
  INSERT INTO public.order_add_on_line_items(
    order_id,ticket_add_on_id,ticket_type_id,parent_kind,add_on_name_at_order,
    ticket_type_name_at_order,quantity,unit_price_cents,total_cents
  ) VALUES (v_order,v_rsvp_add_on,NULL,'rsvp','Welcome drink','RSVP',1,0,0);
  FOR v_raised, v_lines IN VALUES
    ('rsvp with a ticket', jsonb_build_object('kind','rsvp','ticket',v_a,'plan',NULL)),
    ('ticket without one', jsonb_build_object('kind','ticket_type','plan',NULL)),
    ('unknown parent', jsonb_build_object('kind','plan','plan',NULL)),
    ('unknown choice', jsonb_build_object('kind','ticket_type','ticket',v_a,'plan','later'))
  LOOP
    v_state := NULL;
    BEGIN
      INSERT INTO public.order_add_on_line_items(
        order_id,ticket_add_on_id,ticket_type_id,parent_kind,plan_choice,add_on_name_at_order,
        ticket_type_name_at_order,quantity,unit_price_cents,total_cents
      ) VALUES (v_order,v_shared,(v_lines->>'ticket')::uuid,v_lines->>'kind',v_lines->>'plan',
        'Friday dinner','Ticket A',1,500,500);
    EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
    IF v_state IS NULL THEN RAISE EXCEPTION 'order line (%) must be refused', v_raised; END IF;
  END LOOP;

  -- ── Live tier edit writes the owner and a link, and reads the links ─────
  PERFORM public.issue_3281_sync_live_tier_extras(v_c, v_event,
    jsonb_build_array(jsonb_build_object('id','draft-scarf','name','Scarf','priceGbp',2,
      'isUnlimited',true,'maxPerTicket',1)), false, NULL);
  SELECT a.id INTO v_new FROM public.ticket_add_ons a WHERE a.name='Scarf' AND a.event_id=v_event;
  IF v_new IS NULL
     OR (SELECT count(*) FROM public.ticket_add_on_links WHERE add_on_id=v_new AND ticket_type_id=v_c) <> 1 THEN
    RAISE EXCEPTION 'a new live extra must be owned by the offering and linked to its tier';
  END IF;
  v_state := NULL;
  BEGIN
    PERFORM public.issue_3281_sync_live_tier_extras(v_a, v_event,
      jsonb_build_array(jsonb_build_object('id',v_new::text,'name','Scarf','priceGbp',2,
        'isUnlimited',true,'maxPerTicket',1)), false, NULL);
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  IF v_state IS DISTINCT FROM 'ticket_extra_mismatch' THEN
    RAISE EXCEPTION 'an extra not linked to the tier must be refused, got %', v_state;
  END IF;
  -- Leaving C's extras empty stops C's extra and nothing linked elsewhere.
  PERFORM public.issue_3281_sync_live_tier_extras(v_c, v_event, '[]'::jsonb, false, NULL);
  IF (SELECT is_active FROM public.ticket_add_ons WHERE id=v_new)
     OR NOT (SELECT is_active FROM public.ticket_add_ons WHERE id=v_shared) THEN
    RAISE EXCEPTION 'an empty tier list must stop only that tier''s extras';
  END IF;
  -- A kept paid extra on a tier made free is refused through the link.
  v_state := NULL;
  BEGIN PERFORM public.issue_3281_assert_kept_extras_fit_tier(v_b, true, NULL);
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  IF v_state IS DISTINCT FROM 'paid_extra_on_free_ticket' THEN
    RAISE EXCEPTION 'a linked paid extra on a free tier must be refused, got %', v_state;
  END IF;

  -- ── Re-emitted bodies read links, never ticket_add_ons.ticket_type_id ───
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_3281_price_extras(uuid,jsonb,uuid[],boolean)',
    -- #3281 S2 (20281202123281): issue_3281_public_ticket_extras delegates to
    -- the one owner of the public item, which is the body that reads links.
    'public.issue_3281_public_add_on_items(uuid,uuid)',
    'public.issue_3281_attach_public_extras(json)',
    'public.issue_3281_sync_live_tier_extras(uuid,uuid,jsonb,boolean,text[])',
    'public.issue_3281_assert_kept_extras_fit_tier(uuid,boolean,text[])',
    'public.issue_3281_tier_extras_json(uuid,boolean)',
    'public.business_event_ticket_extras(uuid)'
  ] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position('a.ticket_type_id' IN v_def) > 0 OR position('v_add_on.ticket_type_id' IN v_def) > 0
       OR position('v_existing.ticket_type_id' IN v_def) > 0
       OR position('ticket_add_on_links' IN v_def) = 0 THEN
      RAISE EXCEPTION '% must read the links only', v_fn;
    END IF;
  END LOOP;
  IF position('issue_3281_public_add_on_items' IN pg_get_functiondef('public.issue_3281_public_ticket_extras(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue_3281_public_ticket_extras must read through issue_3281_public_add_on_items';
  END IF;
  IF position('SECURITY DEFINER' IN pg_get_functiondef('public.issue_3281_add_on_switch(text)'::regprocedure)) = 0
     OR has_function_privilege('authenticated','public.issue_3281_price_extras(uuid,jsonb,uuid[],boolean)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.business_event_ticket_extras(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.business_event_ticket_extras(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 're-emits must keep their grants';
  END IF;
END;
$test$;

ROLLBACK;
