-- #3281 day-limited tickets: a ticket sells, counts and admits only on its own dates.
-- MINGLA-INVARIANT: I-3281-TICKET-DAY-LIST-AT-SALE-AND-MINT | issue #3281 | A ticket type's day list is read at sale and mint only; a pass admits what ticket_event_dates says, and changing a list never touches an issued pass. | enforced by supabase/migrations/20280228003281_issue_3281_day_limited_tickets.sql
-- MINGLA-INVARIANT: I-3281-LISTED-TICKET-CAPACITY-PER-DATE | issue #3281 | Capacity on a ticket with a day list is per date; an All dates ticket keeps one shared pool. | enforced by supabase/migrations/20280228003281_issue_3281_day_limited_tickets.sql
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '32818000-0000-4000-8400-000000000001';
  v_brand uuid := '32818000-0000-4000-8400-000000000002';
  v_event uuid := '32818000-0000-4000-8400-000000000003';
  v_all uuid := '32818000-0000-4000-8400-000000000004';
  v_friday uuid := '32818000-0000-4000-8400-000000000005';
  v_weekend uuid := '32818000-0000-4000-8400-000000000006';
  v_fri uuid := '32818000-0000-4000-8400-000000000011';
  v_sat uuid := '32818000-0000-4000-8400-000000000012';
  v_sun uuid := '32818000-0000-4000-8400-000000000013';
  v_days uuid[];
  v_multi jsonb;
  v_quote jsonb;
  v_scope text[];
  v_json jsonb;
  v_count integer;
  v_session uuid;
  v_created jsonb;
  v_raised text;
  v_ticket uuid;
BEGIN
  v_days := ARRAY[v_fri,v_sat];
  INSERT INTO auth.users(id,email) VALUES(v_owner,'day-list-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'day-list-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Day list brand','day-list-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_day_list',true,true,'US','usd');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
    is_multi_date,multi_date_pricing_mode
  ) VALUES(v_event,v_brand,v_owner,'Day list event','day-list-event',
    'event','scheduled','public','UTC','USD',true,'per_day');
  INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master) VALUES
    (v_fri,v_event,date_trunc('minute',now())+interval '1 day',now()+interval '1 day 2 hours','UTC',true),
    (v_sat,v_event,date_trunc('minute',now())+interval '2 days',now()+interval '2 days 2 hours','UTC',false),
    (v_sun,v_event,date_trunc('minute',now())+interval '3 days',now()+interval '3 days 2 hours','UTC',false);

  -- Keys follow the organiser's day ids and survive a repeat sync.
  SELECT jsonb_agg(jsonb_build_object(
      'id',CASE d.id WHEN v_fri THEN 'fri' WHEN v_sat THEN 'sat' ELSE 'sun' END,
      'date',to_char(d.start_at AT TIME ZONE 'UTC','YYYY-MM-DD'),
      'startTime',to_char(d.start_at AT TIME ZONE 'UTC','HH24:MI')))
    INTO v_multi FROM public.event_dates d WHERE d.event_id=v_event;
  PERFORM public.issue_3281_sync_occurrence_keys(v_event,v_multi);
  PERFORM public.issue_3281_sync_occurrence_keys(v_event,v_multi);
  IF (SELECT occurrence_key FROM public.event_dates WHERE id=v_sat) IS DISTINCT FROM 'sat' THEN
    RAISE EXCEPTION 'dates must take the organiser day id';
  END IF;

  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,valid_occurrence_keys
  ) VALUES
    (v_all,v_event,'All dates',1000,'USD',false,100,false,1,10,true,false,NULL),
    (v_friday,v_event,'Friday VIP',6000,'USD',false,2,false,1,10,true,false,ARRAY['fri']),
    (v_weekend,v_event,'Weekend',2000,'USD',false,1,false,1,10,true,false,ARRAY['fri','sat']);

  -- All dates tickets are untouched: quantity times every chosen date.
  v_quote := public.issue_3872_ticket_quote(v_event,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_all,'quantity',1)),
    v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550801',NULL,NULL,false);
  IF (v_quote->>'netSubtotalCents')::bigint <> 2000 THEN
    RAISE EXCEPTION 'all dates must keep the day multiplier, got %',v_quote;
  END IF;

  -- A uniform line would charge Saturday for a Friday ticket, so it is refused.
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3872_ticket_quote(v_event,
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_friday,'quantity',1)),
      v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550801',NULL,NULL,false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'ticket_not_valid_on_chosen_days' THEN
    RAISE EXCEPTION 'a uniform line past the list must be refused, got %',v_raised;
  END IF;

  -- No overlap at all is refused even with byDate.
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3872_ticket_quote(v_event,
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_friday,'quantity',1,'byDate',
        jsonb_build_object(v_sat::text,1))),
      ARRAY[v_sat],NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550801',NULL,NULL,false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'ticket_not_valid_on_chosen_days' THEN
    RAISE EXCEPTION 'a date off the list must be refused, got %',v_raised;
  END IF;

  -- byDate prices one Friday only, with Saturday also in the session.
  v_quote := public.issue_3872_ticket_quote(v_event,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_friday,'quantity',1,'byDate',
      jsonb_build_object(v_fri::text,1))),
    v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550801',NULL,NULL,false);
  IF (v_quote->>'netSubtotalCents')::bigint <> 6000 THEN
    RAISE EXCEPTION 'one Friday must cost one Friday, got %',v_quote;
  END IF;

  -- Capacity is per date: a Fri+Sat ticket with 1 place sells 1 on each date.
  IF public.issue_3281_days_in_scope(v_weekend,v_days) <> v_days THEN
    RAISE EXCEPTION 'both dates must be in scope';
  END IF;
  v_quote := public.issue_3872_ticket_quote(v_event,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_weekend,'quantity',1)),
    v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550801',NULL,NULL,false);
  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Buyer','buyer@example.test','+15555550801',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_weekend,'quantity',1)),
    'ticket_checkout:v2:'||v_event::text||':32818000-0000-4000-8400-000000000021',
    now()+interval '15 minutes',0,'full',v_days,NULL,NULL,NULL,NULL,v_quote->>'quoteDigest');
  v_session := COALESCE(v_created->>'sessionId',v_created->>'checkoutSessionId')::uuid;
  IF (SELECT quantity FROM public.ticket_checkout_session_items
       WHERE checkout_session_id=v_session) <> 2 THEN
    RAISE EXCEPTION 'one on two dates must hold two units';
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_ticket_checkout_create_session(
      v_event,NULL,'Second','second@example.test','+15555550802',false,
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_weekend,'quantity',1)),
      'ticket_checkout:v2:'||v_event::text||':32818000-0000-4000-8400-000000000022',
      now()+interval '15 minutes',0,'full',v_days,NULL,NULL,NULL,NULL,v_quote->>'quoteDigest');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS NULL OR position('ticket_capacity_exceeded' IN v_raised) = 0 THEN
    RAISE EXCEPTION 'a held date must be full, got %',v_raised;
  END IF;

  -- The held session keeps its dates on the list.
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3281_assert_scope_keeps_taken_days(v_weekend,ARRAY['fri']);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'tier_day_scope_drops_sold_day' THEN
    RAISE EXCEPTION 'a held date must stay on the list, got %',v_raised;
  END IF;
  -- Adding a date is always allowed.
  PERFORM public.issue_3281_assert_scope_keeps_taken_days(v_weekend,ARRAY['fri','sat','sun']);
  -- Sunday has nothing on it, so a list that loses only Sunday is fine.
  PERFORM public.issue_3281_assert_scope_keeps_taken_days(v_weekend,ARRAY['fri','sat']);

  -- Scope writers: absent key keeps the list, null clears, junk is refused.
  v_scope := public.issue_3281_resolve_tier_scope(v_event,'{"id":"x"}'::jsonb,ARRAY['fri']);
  IF v_scope IS DISTINCT FROM ARRAY['fri'] THEN RAISE EXCEPTION 'an absent key must keep the list'; END IF;
  v_scope := public.issue_3281_resolve_tier_scope(v_event,'{"validDayIds":null}'::jsonb,ARRAY['fri']);
  IF v_scope IS NOT NULL THEN RAISE EXCEPTION 'null must mean All dates'; END IF;
  BEGIN
    PERFORM public.issue_3281_resolve_tier_scope(v_event,'{"validDayIds":[]}'::jsonb,NULL);
    RAISE EXCEPTION 'no error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'tier_day_scope_empty' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.issue_3281_resolve_tier_scope(v_event,'{"validDayIds":["gone"]}'::jsonb,NULL);
    RAISE EXCEPTION 'no error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'tier_day_scope_unknown_day' THEN RAISE; END IF;
  END;
  IF public.issue_1974_normalize_ticket_tiers(
       '[{"id":"t_a","name":"A","isFree":true,"isUnlimited":true,"validDayIds":["fri"]}]'::jsonb
     )->0->'validDayIds' <> '["fri"]'::jsonb THEN
    RAISE EXCEPTION 'the normalizer must carry validDayIds';
  END IF;
  IF public.issue_1974_normalize_ticket_tiers(
       '[{"id":"t_a","name":"A","isFree":true,"isUnlimited":true}]'::jsonb
     )->0 ? 'validDayIds' THEN
    RAISE EXCEPTION 'the normalizer must not invent validDayIds';
  END IF;

  -- Publish input: a non multi-date event ignores a stored list.
  IF public.issue_3281_draft_ticket_scope('{"validDayIds":["fri"]}'::jsonb,'recurring',v_multi) IS NOT NULL THEN
    RAISE EXCEPTION 'only multi-date events are scoped';
  END IF;
  IF public.issue_3281_draft_ticket_scope('{"validDayIds":["fri"]}'::jsonb,'multi_date',v_multi)
     IS DISTINCT FROM ARRAY['fri'] THEN
    RAISE EXCEPTION 'a draft list must publish';
  END IF;
  BEGIN
    PERFORM public.issue_3281_draft_ticket_scope('{"validDayIds":["gone"]}'::jsonb,'multi_date',v_multi);
    RAISE EXCEPTION 'no error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'tier_day_scope_unknown_day' THEN RAISE; END IF;
  END;

  -- Public reader: only listed tickets gain keys, and a full date is flagged.
  v_json := public.issue_3872_ticket_sale_json(v_all);
  IF v_json ? 'validOccurrenceIds' THEN RAISE EXCEPTION 'All dates payload must not change'; END IF;
  v_json := public.issue_3872_ticket_sale_json(v_weekend);
  IF v_json->'validOccurrenceIds' <> to_jsonb(v_days)
     OR v_json->'soldOutOccurrenceIds' <> to_jsonb(v_days) THEN
    RAISE EXCEPTION 'reader must name the list and full dates, got %',v_json;
  END IF;
  SELECT r.remaining INTO v_count FROM public.pg_public_ticket_types_remaining(v_event) r
   WHERE r.ticket_type_id=v_friday;
  IF v_count IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Friday VIP must have 2 left, got %',v_count; END IF;

  -- Removing Sunday leaves the weekend ticket alone; removing Friday strips it,
  -- and a list that would empty is refused rather than widened.
  DELETE FROM public.ticket_checkout_session_items WHERE checkout_session_id=v_session;
  DELETE FROM public.event_dates WHERE id=v_sun;
  PERFORM public.issue_3281_strip_removed_days(v_event);
  IF (SELECT valid_occurrence_keys FROM public.ticket_types WHERE id=v_weekend)
     IS DISTINCT FROM ARRAY['fri','sat'] THEN
    RAISE EXCEPTION 'an unrelated removal must keep the list';
  END IF;
  UPDATE public.event_dates SET occurrence_key=NULL WHERE id=v_fri;
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3281_strip_removed_days(v_event);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'tier_day_scope_empty' THEN
    RAISE EXCEPTION 'an emptied list must be refused, got %',v_raised;
  END IF;
  UPDATE public.event_dates SET occurrence_key='fri' WHERE id=v_fri;

  -- All-days: one pass that admits Friday only, with Saturday also chosen.
  UPDATE public.events SET multi_date_pricing_mode='all_days' WHERE id=v_event;
  v_quote := public.issue_3872_ticket_quote(v_event,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_friday,'quantity',1)),
    v_days,NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550801',NULL,NULL,false);
  IF (v_quote->>'netSubtotalCents')::bigint <> 6000 THEN
    RAISE EXCEPTION 'an all-days line stays one price, got %',v_quote;
  END IF;
  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Buyer','buyer@example.test','+15555550801',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_friday,'quantity',1)),
    'ticket_checkout:v2:'||v_event::text||':32818000-0000-4000-8400-000000000023',
    now()+interval '15 minutes',0,'full',v_days,NULL,NULL,NULL,NULL,v_quote->>'quoteDigest');
  v_session := COALESCE(v_created->>'sessionId',v_created->>'checkoutSessionId')::uuid;
  PERFORM public.issue_1930_ticket_checkout_finalize_base(
    v_session,'pi_day_list','ch_day_list','card','by-date-test-pepper-0123456789abcdef0123456789'
  );
  SELECT count(*) INTO v_count FROM public.tickets WHERE ticket_type_id=v_friday;
  IF v_count <> 1 THEN RAISE EXCEPTION 'one pass expected, got %',v_count; END IF;
  SELECT count(*) INTO v_count
    FROM public.ticket_event_dates d JOIN public.tickets t ON t.id=d.ticket_id
   WHERE t.ticket_type_id=v_friday;
  IF v_count <> 1 THEN RAISE EXCEPTION 'the pass must admit Friday only, got %',v_count; END IF;
  SELECT t.id INTO v_ticket FROM public.tickets t WHERE t.ticket_type_id=v_friday;

  -- Any issuer is held to the list, and changing a list leaves a pass alone.
  v_raised := NULL;
  BEGIN
    INSERT INTO public.ticket_event_dates(ticket_id,event_date_id) VALUES(v_ticket,v_sat);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'ticket_not_valid_on_chosen_days' THEN
    RAISE EXCEPTION 'a pass day off the list must be refused, got %',v_raised;
  END IF;
  UPDATE public.ticket_types SET valid_occurrence_keys=ARRAY['fri','sat'] WHERE id=v_friday;
  SELECT count(*) INTO v_count FROM public.ticket_event_dates WHERE ticket_id=v_ticket;
  IF v_count <> 1 THEN RAISE EXCEPTION 'a wider list must not touch an issued pass'; END IF;

  v_raised := NULL;
  BEGIN
    UPDATE public.ticket_types SET valid_occurrence_keys='{}' WHERE id=v_friday;
  EXCEPTION WHEN check_violation THEN v_raised := 'refused'; END;
  IF v_raised IS NULL THEN RAISE EXCEPTION 'an empty list must never be stored'; END IF;
END;
$test$;

-- A listed ticket cannot issue a pass with no day row, which would admit any day.
DO $test$
DECLARE
  v_raised text;
BEGIN
  v_raised := pg_get_triggerdef((SELECT oid FROM pg_trigger WHERE tgname='issue_3281_pass_has_day'));
  IF position('DEFERRABLE INITIALLY DEFERRED' IN v_raised) = 0 THEN
    RAISE EXCEPTION 'the pass-has-day guard must run at commit, got %',v_raised;
  END IF;
END;
$test$;

-- The real save paths: publish, ticket edits, date edits, back to draft.
DO $test$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_d1 text := to_char(now()+interval '10 days','YYYY-MM-DD');
  v_d2 text := to_char(now()+interval '11 days','YYYY-MM-DD');
  v_d3 text := to_char(now()+interval '12 days','YYYY-MM-DD');
  v_multi jsonb;
  v_tier uuid;
  v_all uuid;
  v_tiers jsonb;
  v_raised text;
  v_payload jsonb;
  v_saturday uuid;
  v_quote jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'day list', 'day-list-'||v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'day list draft', 'day-list-'||v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_multi := jsonb_build_array(
    jsonb_build_object('id','md_fri','date',v_d1,'startTime','18:00','endTime','23:00'),
    jsonb_build_object('id','md_sat','date',v_d2,'startTime','14:00','endTime','23:00'),
    jsonb_build_object('id','md_sun','date',v_d3,'startTime','14:00','endTime','21:00'));

  PERFORM public.business_publish_event_draft(v_event, jsonb_build_object(
    'title','Day list weekend','timezone','UTC','is_online',true,
    'is_multi_date',true,
    'online_url','https://zoom.us/j/123456789',
    'theme',jsonb_build_object('business_draft',jsonb_build_object(
      'format','online','requestedVisibility','public',
      'partyTypes',jsonb_build_array('festival'),
      'vibeTags',jsonb_build_array('exclusive','vibrant','artsy'),
      'whenMode','multi_date','multiDates',v_multi,
      'tickets',jsonb_build_array(
        jsonb_build_object('name','Friday VIP','isFree',true,'price',0,'capacity',50,
          'validDayIds',jsonb_build_array('md_fri')),
        jsonb_build_object('name','Weekend','isFree',true,'price',0,'capacity',100,
          'validDayIds',jsonb_build_array('md_sat','md_sun')),
        jsonb_build_object('name','All dates','isFree',true,'price',0,'capacity',600))
    ))
  ), NULL);

  IF (SELECT count(*) FROM public.event_dates WHERE event_id=v_event AND occurrence_key IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'publish must key every date';
  END IF;
  SELECT id INTO v_tier FROM public.ticket_types WHERE event_id=v_event AND name='Weekend';
  SELECT id INTO v_all FROM public.ticket_types WHERE event_id=v_event AND name='All dates';
  IF (SELECT valid_occurrence_keys FROM public.ticket_types WHERE id=v_all) IS NOT NULL THEN
    RAISE EXCEPTION 'no list must publish All dates';
  END IF;
  IF (SELECT valid_occurrence_keys FROM public.ticket_types WHERE event_id=v_event AND name='Friday VIP')
     IS DISTINCT FROM ARRAY['md_fri'] THEN
    RAISE EXCEPTION 'publish must store the list';
  END IF;

  -- A live edit from a caller that predates lists leaves the list alone.
  SELECT jsonb_agg(jsonb_build_object(
      'id',tt.id,'name',tt.name,'isFree',true,'isUnlimited',false,'capacity',tt.quantity_total,
      'visibility','public','displayOrder',tt.display_order,'availableAt','both'))
    INTO v_tiers FROM public.ticket_types tt WHERE tt.event_id=v_event AND tt.deleted_at IS NULL;
  PERFORM public.business_patch_event_ticket_tiers(v_event,v_tiers,NULL,NULL,gen_random_uuid(),'Edit with no day list key');
  IF (SELECT valid_occurrence_keys FROM public.ticket_types WHERE id=v_tier)
     IS DISTINCT FROM ARRAY['md_sat','md_sun'] THEN
    RAISE EXCEPTION 'an edit with no key must not widen the ticket';
  END IF;

  -- One guest holds a place on Saturday.
  SELECT d.id INTO v_saturday FROM public.event_dates d
   WHERE d.event_id=v_event AND d.occurrence_key='md_sat';
  v_quote := public.issue_3872_ticket_quote(v_event,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_tier,'quantity',1)),
    ARRAY[v_saturday],NULL,NULL,NULL,'full',NULL,'buyer@example.test','+15555550801',NULL,NULL,false);
  PERFORM public.biz_ticket_checkout_create_session(
    v_event,NULL,'Buyer','buyer@example.test','+15555550801',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_tier,'quantity',1)),
    'ticket_checkout:v2:'||v_event::text||':'||gen_random_uuid()::text,
    now()+interval '15 minutes',0,'full',ARRAY[v_saturday],NULL,NULL,NULL,NULL,v_quote->>'quoteDigest');

  -- Saturday is taken, so it cannot leave the list. Sunday can.
  SELECT jsonb_agg(CASE WHEN x->>'id'=v_tier::text
      THEN x||jsonb_build_object('validDayIds',jsonb_build_array('md_sun')) ELSE x END)
    INTO v_tiers FROM jsonb_array_elements(v_tiers) x;
  v_raised := NULL;
  BEGIN
    PERFORM public.business_patch_event_ticket_tiers(v_event,v_tiers,NULL,NULL,gen_random_uuid(),'Drop a sold date here');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'tier_day_scope_drops_sold_day' THEN
    RAISE EXCEPTION 'a sold date must stay, got %',v_raised;
  END IF;
  SELECT jsonb_agg(CASE WHEN x->>'id'=v_tier::text
      THEN x||jsonb_build_object('validDayIds',jsonb_build_array('md_sat')) ELSE x END)
    INTO v_tiers FROM jsonb_array_elements(v_tiers) x;
  PERFORM public.business_patch_event_ticket_tiers(v_event,v_tiers,NULL,NULL,gen_random_uuid(),'Drop an unsold date');
  IF (SELECT valid_occurrence_keys FROM public.ticket_types WHERE id=v_tier)
     IS DISTINCT FROM ARRAY['md_sat'] THEN
    RAISE EXCEPTION 'an unsold date must leave the list';
  END IF;

  -- Moving a time keeps the key. Removing a date leaves no stale list entry.
  PERFORM public.business_patch_event_when(v_event, jsonb_build_object(
    'whenMode','multi_date','timezone','UTC','multiDates',jsonb_build_array(
      v_multi->0, jsonb_build_object('id','md_sat','date',v_d2,'startTime','14:00','endTime','22:00'))
  ),'Remove the Sunday date from this event',NULL);
  IF (SELECT count(*) FROM public.event_dates WHERE event_id=v_event) <> 2 THEN
    RAISE EXCEPTION 'Sunday must be gone';
  END IF;

  -- A list that a removal would empty is refused, never widened.
  v_raised := NULL;
  BEGIN
    PERFORM public.business_patch_event_when(v_event, jsonb_build_object(
      'whenMode','multi_date','timezone','UTC','multiDates',jsonb_build_array(
        v_multi->1, jsonb_build_object('id','md_new','date',v_d3,'startTime','14:00','endTime','22:00'))
    ),'Swap Friday for a new date please',NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'tier_day_scope_empty' THEN
    RAISE EXCEPTION 'an emptied list must be refused, got %',v_raised;
  END IF;

  -- Back to draft keeps day ids and lists, so a republish finds them.
  v_payload := public.business_event_draft_payload_from_graph(v_event);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_payload#>'{theme,business_draft,multiDates}') e WHERE e->>'id'='md_fri')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_payload#>'{theme,business_draft,tickets}') t
                     WHERE t->'validDayIds' = '["md_sat"]'::jsonb) THEN
    RAISE EXCEPTION 'the draft must keep ids and lists';
  END IF;
END;
$test$;

ROLLBACK;
