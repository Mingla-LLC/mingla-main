-- #3281 Extras, slice 3: organisers author extras in both wizards.
-- MINGLA-INVARIANT: I-3281-EXTRAS-AUTHORED-WITH-THEIR-TIER | issue #3281 | A tier's extras save, publish and edit with the tier; a payload without the key leaves them unchanged; an extra's dates stay inside its tier's dates.
-- MINGLA-INVARIANT: I-3281-SOLD-EXTRA-KEEPS-ITS-DEAL | issue #3281 | Once an extra has sold, its price is locked, its capacity can't go below what's sold on its busiest date, a sold date can't be removed, and removing it only stops future sales.
\set ON_ERROR_STOP on
BEGIN;

-- Validation: the database refuses what checkout couldn't sell.
DO $test$
DECLARE
  v_key text;
  v_extras jsonb;
  v_free boolean;
  v_raised text;
  v_ok jsonb := '{"id":"x_1","name":"Dinner","priceGbp":15,"capacity":40}'::jsonb;
BEGIN
  IF public.issue_3281_normalize_tier_extras(jsonb_build_array(v_ok), false)->0
     <> '{"id":"x_1","name":"Dinner","description":null,"priceGbp":15,"isUnlimited":false,
          "capacity":40,"maxPerTicket":1,"validDayIds":null}'::jsonb THEN
    RAISE EXCEPTION 'a valid extra must normalize to one shape';
  END IF;
  FOR v_key, v_extras, v_free IN VALUES
    ('invalid_ticket_extras', '{}'::jsonb, false),
    ('duplicate_ticket_extra_id', jsonb_build_array(v_ok, v_ok), false),
    ('ticket_extra_name_invalid', jsonb_build_array(v_ok||'{"name":" "}'), false),
    ('ticket_extra_price_invalid', jsonb_build_array(v_ok||'{"priceGbp":-1}'), false),
    ('ticket_extra_price_invalid', jsonb_build_array(v_ok||'{"priceGbp":1.005}'), false),
    ('paid_extra_on_free_ticket', jsonb_build_array(v_ok), true),
    ('ticket_extra_capacity_invalid', jsonb_build_array(v_ok||'{"isUnlimited":true}'), false),
    ('ticket_extra_capacity_required', jsonb_build_array(v_ok||'{"capacity":0}'), false),
    ('ticket_extra_max_invalid', jsonb_build_array(v_ok||'{"maxPerTicket":21}'), false),
    ('ticket_extra_day_scope_empty', jsonb_build_array(v_ok||'{"validDayIds":[]}'), false)
  LOOP
    v_raised := NULL;
    BEGIN
      PERFORM public.issue_3281_normalize_tier_extras(v_extras, v_free);
    EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
    IF v_raised IS DISTINCT FROM v_key THEN RAISE EXCEPTION 'expected %, got %', v_key, v_raised; END IF;
  END LOOP;
  -- A free extra on a free tier is fine.
  PERFORM public.issue_3281_normalize_tier_extras(jsonb_build_array(v_ok||'{"priceGbp":0}'), true);
END;
$test$;

-- Drafts: a save without the key keeps the tier's extras.
DO $test$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tier jsonb := '{"id":"draft-a","name":"A","isFree":true,"isUnlimited":true}'::jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug) VALUES (v_brand, v_user, 'x draft', 'x-draft-'||v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, theme)
    VALUES (v_event, v_brand, 'x draft', 'x-draft-'||v_event, 'event', 'draft', 'draft', 'UTC',
      jsonb_build_object('business_draft',jsonb_build_object('clientRevision',0,'tickets','[]'::jsonb)));
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM public.business_patch_event_ticket_tiers(v_event,
    jsonb_build_array(v_tier||'{"extras":[{"id":"x_1","name":"Tote","priceGbp":0,"capacity":10}]}'::jsonb),
    NULL,0,gen_random_uuid(),NULL);
  IF (SELECT theme#>>'{business_draft,tickets,0,extras,0,name}' FROM public.events WHERE id=v_event)
     IS DISTINCT FROM 'Tote' THEN
    RAISE EXCEPTION 'a draft must store the extras';
  END IF;
  PERFORM public.business_patch_event_ticket_tiers(v_event,jsonb_build_array(v_tier),NULL,1,gen_random_uuid(),NULL);
  PERFORM public.business_update_event_draft(v_event,jsonb_build_object(
    'title','x draft','visibility','draft','timezone','UTC',
    'theme',jsonb_build_object('business_draft',jsonb_build_object(
      'requestedVisibility','public','tickets',jsonb_build_array(v_tier)))),2);
  IF (SELECT theme#>>'{business_draft,tickets,0,extras,0,name}' FROM public.events WHERE id=v_event)
     IS DISTINCT FROM 'Tote' THEN
    RAISE EXCEPTION 'a save without the key must keep the extras';
  END IF;
END;
$test$;

-- Publish, live edits under the sold locks, date removal and back to draft.
DO $test$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_d1 text := to_char(now()+interval '10 days','YYYY-MM-DD');
  v_d2 text := to_char(now()+interval '11 days','YYYY-MM-DD');
  v_multi jsonb;
  v_vip uuid;
  v_all uuid;
  v_dinner uuid;
  v_order uuid := gen_random_uuid();
  v_tiers jsonb;
  v_result jsonb;
  v_raised text;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug) VALUES (v_brand, v_user, 'x live', 'x-live-'||v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'x live', 'x-live-'||v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_multi := jsonb_build_array(
    jsonb_build_object('id','md_fri','date',v_d1,'startTime','18:00','endTime','23:00'),
    jsonb_build_object('id','md_sat','date',v_d2,'startTime','14:00','endTime','23:00'));

  -- An extra's dates must sit inside its tier's dates.
  v_raised := NULL;
  BEGIN
    PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
      'title','Extras weekend','timezone','UTC','is_online',true,'is_multi_date',true,
      'online_url','https://zoom.us/j/123456789',
      'theme',jsonb_build_object('business_draft',jsonb_build_object(
        'format','online','requestedVisibility','public','partyTypes',jsonb_build_array('festival'),
        'vibeTags',jsonb_build_array('exclusive','vibrant','artsy'),
        'whenMode','multi_date','multiDates',v_multi,
        'tickets',jsonb_build_array(jsonb_build_object('name','Friday VIP','isFree',true,'price',0,
          'capacity',50,'validDayIds',jsonb_build_array('md_fri'),
          'extras',jsonb_build_array(jsonb_build_object('id','x_1','name','Brunch','priceGbp',0,
            'capacity',5,'validDayIds',jsonb_build_array('md_sat')))))))), NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'extra_day_scope_outside_ticket' THEN
    RAISE EXCEPTION 'an extra past its tier''s dates must be refused, got %',v_raised;
  END IF;

  PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
    'title','Extras weekend','timezone','UTC','is_online',true,'is_multi_date',true,
    'online_url','https://zoom.us/j/123456789',
    'theme',jsonb_build_object('business_draft',jsonb_build_object(
      'format','online','requestedVisibility','public','partyTypes',jsonb_build_array('festival'),
      'vibeTags',jsonb_build_array('exclusive','vibrant','artsy'),
      'whenMode','multi_date','multiDates',v_multi,
      'tickets',jsonb_build_array(
        jsonb_build_object('name','Friday VIP','isFree',true,'price',0,'capacity',50,
          'validDayIds',jsonb_build_array('md_fri'),
          'extras',jsonb_build_array(jsonb_build_object('id','x_1','name','Dinner','priceGbp',0,'capacity',40))),
        jsonb_build_object('name','All dates','isFree',true,'price',0,'capacity',600,
          'extras',jsonb_build_array(
            jsonb_build_object('id','x_2','name','Shuttle','priceGbp',0,'isUnlimited',true,
              'validDayIds',jsonb_build_array('md_fri','md_sat')),
            jsonb_build_object('id','x_3','name','Saturday brunch','priceGbp',0,'capacity',20,
              'validDayIds',jsonb_build_array('md_sat','md_deleted'))))))
    )), NULL);
  SELECT id INTO v_vip FROM public.ticket_types WHERE event_id=v_event AND name='Friday VIP';
  SELECT id INTO v_all FROM public.ticket_types WHERE event_id=v_event AND name='All dates';
  SELECT id INTO v_dinner FROM public.ticket_add_ons WHERE ticket_type_id=v_vip;
  IF (SELECT count(*) FROM public.ticket_add_ons WHERE ticket_type_id=v_all) <> 2
     OR (SELECT valid_occurrence_keys FROM public.ticket_add_ons WHERE ticket_type_id=v_all AND name='Shuttle')
        IS DISTINCT FROM ARRAY['md_fri','md_sat']
     OR (SELECT quantity_total FROM public.ticket_add_ons WHERE id=v_dinner) <> 40
     OR (SELECT valid_occurrence_keys FROM public.ticket_add_ons WHERE ticket_type_id=v_all AND name='Saturday brunch')
        IS DISTINCT FROM ARRAY['md_sat'] THEN
    RAISE EXCEPTION 'publish must create each tier''s extras, without a deleted draft date';
  END IF;

  -- The Host reads a live event's extras by tier; a stranger reads nothing.
  IF jsonb_array_length(public.business_event_ticket_extras(v_event)->v_all::text) <> 2 THEN
    RAISE EXCEPTION 'an event manager must read the extras';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  IF public.business_event_ticket_extras(v_event) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'a stranger must read no extras';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  IF position('issue_3281_tier_extras_json' IN pg_get_functiondef(
       'public.business_update_live_event_atomic'::regproc)) = 0 THEN
    RAISE EXCEPTION 'the live save must return each tier''s extras';
  END IF;

  -- The live payload carries the extras with their row ids.
  v_tiers := (SELECT jsonb_agg(t) FROM jsonb_array_elements(
    public.business_event_draft_payload_from_graph(v_event)#>'{theme,business_draft,tickets}') t);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_tiers) t, jsonb_array_elements(t->'extras') x
                  WHERE x->>'id' = v_dinner::text AND NOT (x ? 'soldCount')) THEN
    RAISE EXCEPTION 'the edit payload must carry the extras, with no sales metadata';
  END IF;

  -- A live edit without the key leaves extras alone; with it, adds a new one.
  SELECT jsonb_agg(jsonb_build_object(
      'id',tt.id,'name',tt.name,'isFree',true,'isUnlimited',false,'capacity',tt.quantity_total,
      'visibility','public','displayOrder',tt.display_order,'availableAt','both'))
    INTO v_tiers FROM public.ticket_types tt WHERE tt.event_id=v_event AND tt.deleted_at IS NULL;
  PERFORM public.business_patch_event_ticket_tiers(v_event,v_tiers,NULL,NULL,gen_random_uuid(),'Edit without any extras key');
  IF (SELECT count(*) FROM public.ticket_add_ons WHERE ticket_type_id=v_all AND is_active) <> 2 THEN
    RAISE EXCEPTION 'an edit without the key must keep the extras';
  END IF;
  SELECT jsonb_agg(CASE WHEN x->>'id'=v_vip::text THEN x||jsonb_build_object('extras',jsonb_build_array(
      jsonb_build_object('id',v_dinner,'name','Dinner','priceGbp',0,'capacity',40),
      jsonb_build_object('id','x_new','name','Wristband','priceGbp',0,'capacity',3))) ELSE x END)
    INTO v_tiers FROM jsonb_array_elements(v_tiers) x;
  v_result := public.business_patch_event_ticket_tiers(v_event,v_tiers,NULL,NULL,gen_random_uuid(),'Add a wristband extra');
  IF (SELECT count(*) FROM public.ticket_add_ons WHERE ticket_type_id=v_vip AND is_active) <> 2
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'tiers') t, jsonb_array_elements(t->'extras') x
                     WHERE x->>'name'='Wristband' AND x->>'id' <> 'x_new') THEN
    RAISE EXCEPTION 'a live edit must add the new extra and return its id';
  END IF;

  -- One dinner sells on Friday, so its deal is locked.
  INSERT INTO public.orders(id,event_id,total_cents,currency,payment_status,source)
    VALUES (v_order,v_event,0,'USD','paid','legacy');
  INSERT INTO public.order_add_on_line_items(order_id,ticket_add_on_id,ticket_type_id,
      add_on_name_at_order,ticket_type_name_at_order,day_scope_at_order,quantity,unit_price_cents,total_cents)
    VALUES (v_order,v_dinner,v_vip,'Dinner','Friday VIP',ARRAY['md_fri'],1,0,0);
  v_raised := NULL;
  BEGIN
    PERFORM public.business_patch_event_ticket_tiers(v_event,
      (SELECT jsonb_agg(CASE WHEN x->>'id'=v_vip::text THEN x||jsonb_build_object('extras',jsonb_build_array(
         jsonb_build_object('id',v_dinner,'name','Dinner','priceGbp',0,'capacity',0,'isUnlimited',false))) ELSE x END)
         FROM jsonb_array_elements(v_tiers) x),
      NULL,NULL,gen_random_uuid(),'Shrink the dinner below sales');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'ticket_extra_capacity_required' THEN
    RAISE EXCEPTION 'capacity zero is never valid, got %',v_raised;
  END IF;
  UPDATE public.ticket_add_ons SET quantity_total=1 WHERE id=v_dinner;
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3281_sync_live_tier_extras(v_vip,v_event,
      jsonb_build_array(jsonb_build_object('id',v_dinner,'name','Dinner','priceGbp',0,'capacity',1)),
      false,ARRAY['md_fri']);
    PERFORM public.issue_3281_sync_live_tier_extras(v_vip,v_event,
      jsonb_build_array(jsonb_build_object('id',v_dinner,'name','Dinner','priceGbp',5,'capacity',1)),
      false,ARRAY['md_fri']);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'sold_extra_mutation_blocked' THEN
    RAISE EXCEPTION 'a sold extra''s price must be locked, got %',v_raised;
  END IF;
  -- A second dinner sells, so capacity can't drop below two.
  UPDATE public.ticket_add_ons SET quantity_total=2 WHERE id=v_dinner;
  UPDATE public.order_add_on_line_items SET quantity=2,unit_price_cents=0,total_cents=0
   WHERE ticket_add_on_id=v_dinner;
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3281_sync_live_tier_extras(v_vip,v_event,
      jsonb_build_array(jsonb_build_object('id',v_dinner,'name','Dinner','priceGbp',0,'capacity',1)),
      false,ARRAY['md_fri']);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'sold_extra_mutation_blocked' THEN
    RAISE EXCEPTION 'capacity below sales must be refused, got %',v_raised;
  END IF;
  -- A shuttle sold on Saturday keeps Saturday on its list.
  INSERT INTO public.order_add_on_line_items(order_id,ticket_add_on_id,ticket_type_id,
      add_on_name_at_order,ticket_type_name_at_order,day_scope_at_order,quantity,unit_price_cents,total_cents)
    SELECT v_order,a.id,v_all,'Shuttle','All dates',ARRAY['md_sat'],1,0,0
      FROM public.ticket_add_ons a WHERE a.ticket_type_id=v_all AND a.name='Shuttle';
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3281_sync_live_tier_extras(v_all,v_event,
      (SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'priceGbp',0,
          'isUnlimited',a.is_unlimited,'capacity',a.quantity_total,
          'validDayIds',CASE WHEN a.name='Shuttle' THEN '["md_fri"]'::jsonb ELSE to_jsonb(a.valid_occurrence_keys) END))
         FROM public.ticket_add_ons a WHERE a.ticket_type_id=v_all),
      true,NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'extra_day_scope_drops_sold_day' THEN
    RAISE EXCEPTION 'a sold date must stay on the extra, got %',v_raised;
  END IF;
  -- One shuttle per date, sold on both dates: the floor follows the new mode.
  INSERT INTO public.order_add_on_line_items(order_id,ticket_add_on_id,ticket_type_id,
      add_on_name_at_order,ticket_type_name_at_order,day_scope_at_order,quantity,unit_price_cents,total_cents)
    SELECT v_order,a.id,v_all,'Shuttle','All dates',ARRAY['md_fri'],1,0,0
      FROM public.ticket_add_ons a WHERE a.ticket_type_id=v_all AND a.name='Shuttle';
  UPDATE public.ticket_add_ons SET is_unlimited=false,quantity_total=1
   WHERE ticket_type_id=v_all AND name='Shuttle';
  IF (SELECT (x->>'capacityFloor')::integer FROM jsonb_array_elements(public.issue_3281_tier_extras_json(v_all)) x
       WHERE x->>'name'='Shuttle') <> 1
     OR (SELECT (x->>'soldCount')::integer FROM jsonb_array_elements(public.issue_3281_tier_extras_json(v_all)) x
          WHERE x->>'name'='Shuttle') <> 2
     OR (SELECT x->'soldDayIds' FROM jsonb_array_elements(public.issue_3281_tier_extras_json(v_all)) x
          WHERE x->>'name'='Shuttle') <> '["md_fri","md_sat"]'::jsonb THEN
    RAISE EXCEPTION 'a dated extra''s floor is its busiest date, its sales the total, its sold dates listed';
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3281_sync_live_tier_extras(v_all,v_event,
      (SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'priceGbp',0,
          'isUnlimited',a.is_unlimited,'capacity',a.quantity_total,
          'validDayIds',CASE WHEN a.name='Shuttle' THEN 'null'::jsonb ELSE to_jsonb(a.valid_occurrence_keys) END))
         FROM public.ticket_add_ons a WHERE a.ticket_type_id=v_all),
      true,NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'sold_extra_mutation_blocked' THEN
    RAISE EXCEPTION 'one shared count must cover every date''s sales, got %',v_raised;
  END IF;
  -- An all-dates extra sold on Saturday can't narrow to Friday.
  UPDATE public.ticket_add_ons SET valid_occurrence_keys=NULL,quantity_total=2
   WHERE ticket_type_id=v_all AND name='Shuttle';
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3281_sync_live_tier_extras(v_all,v_event,
      (SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'priceGbp',0,
          'isUnlimited',a.is_unlimited,'capacity',a.quantity_total,
          'validDayIds',CASE WHEN a.name='Shuttle' THEN '["md_fri"]'::jsonb ELSE to_jsonb(a.valid_occurrence_keys) END))
         FROM public.ticket_add_ons a WHERE a.ticket_type_id=v_all),
      true,NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'extra_day_scope_drops_sold_day' THEN
    RAISE EXCEPTION 'an all-dates extra must keep a date it sold on, got %',v_raised;
  END IF;
  UPDATE public.ticket_add_ons SET valid_occurrence_keys=ARRAY['md_fri','md_sat'],is_unlimited=true,quantity_total=NULL
   WHERE ticket_type_id=v_all AND name='Shuttle';

  -- A tier edited without its extras must still fit them.
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3281_assert_kept_extras_fit_tier(v_all,true,ARRAY['md_fri']);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'extra_day_scope_outside_ticket' THEN
    RAISE EXCEPTION 'a narrowed tier must not orphan a kept extra, got %',v_raised;
  END IF;
  UPDATE public.ticket_add_ons SET price_cents=500 WHERE ticket_type_id=v_all AND name='Shuttle';
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3281_assert_kept_extras_fit_tier(v_all,true,NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'paid_extra_on_free_ticket' THEN
    RAISE EXCEPTION 'a free tier must not keep a paid extra, got %',v_raised;
  END IF;
  UPDATE public.ticket_add_ons SET price_cents=0 WHERE ticket_type_id=v_all AND name='Shuttle';
  IF position('issue_3281_assert_kept_extras_fit_tier' IN pg_get_functiondef(
       'public.business_patch_event_ticket_tiers'::regproc)) = 0 THEN
    RAISE EXCEPTION 'an edit without extras must check the kept ones';
  END IF;
  UPDATE public.ticket_add_ons SET valid_occurrence_keys=ARRAY['md_fri'] WHERE id=v_dinner;
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3281_sync_live_tier_extras(v_all,v_event,
      jsonb_build_array(jsonb_build_object('id',v_dinner,'name','Dinner','priceGbp',0,'capacity',1)),
      true,NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'ticket_extra_mismatch' THEN
    RAISE EXCEPTION 'an extra can''t move to another tier, got %',v_raised;
  END IF;

  -- Removing a sold extra stops its sales and keeps the row.
  PERFORM public.issue_3281_sync_live_tier_extras(v_vip,v_event,'[]'::jsonb,true,ARRAY['md_fri']);
  IF (SELECT is_active FROM public.ticket_add_ons WHERE id=v_dinner)
     OR NOT EXISTS (SELECT 1 FROM public.order_add_on_line_items WHERE ticket_add_on_id=v_dinner) THEN
    RAISE EXCEPTION 'a removed sold extra must stop selling and keep its orders';
  END IF;

  -- Removing Saturday trims the shuttle and refuses to widen the brunch.
  -- The sold order would block any date change, so it goes first.
  DELETE FROM public.order_add_on_line_items WHERE order_id=v_order;
  DELETE FROM public.orders WHERE id=v_order;
  v_raised := NULL;
  BEGIN
    PERFORM public.business_patch_event_when(v_event, jsonb_build_object(
      'whenMode','multi_date','timezone','UTC','multiDates',jsonb_build_array(v_multi->0)),
      'Remove Saturday from this event',NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'extra_day_scope_empty' THEN
    RAISE EXCEPTION 'an extra that loses its only date must block the change, got %',v_raised;
  END IF;
  UPDATE public.ticket_add_ons SET is_active=false WHERE ticket_type_id=v_all AND name='Saturday brunch';
  PERFORM public.business_patch_event_when(v_event, jsonb_build_object(
    'whenMode','multi_date','timezone','UTC','multiDates',jsonb_build_array(v_multi->0)),
    'Remove Saturday from this event',NULL);
  IF (SELECT valid_occurrence_keys FROM public.ticket_add_ons WHERE ticket_type_id=v_all AND name='Shuttle')
     IS DISTINCT FROM ARRAY['md_fri'] THEN
    RAISE EXCEPTION 'a removed date must leave the extra''s list';
  END IF;

  -- The helpers stay server-only.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN (
       'issue_3281_add_on_sold','issue_3281_normalize_tier_extras','issue_3281_assert_extra_days_in_tier',
       'issue_3281_publish_tier_extras','issue_3281_sync_live_tier_extras','issue_3281_tier_extras_json')
       AND (has_function_privilege('anon',p.oid,'EXECUTE')
         OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'extras authoring helpers must be closed to clients';
  END IF;
END;
$test$;

ROLLBACK;
