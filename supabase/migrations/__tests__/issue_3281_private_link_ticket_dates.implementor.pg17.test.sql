-- #3281 day-limited tickets: a private ticket link says which dates its ticket covers.
-- MINGLA-INVARIANT: I-3281-PRIVATE-LINK-CARRIES-TICKET-DATES | issue #3281 | A private ticket link's ticket carries the dates it covers (validOccurrenceIds by event_dates id, null for All dates), the same field every public reader carries.
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3827l_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #3827 links FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3827l_err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3827l_fixture(
  p_tag text,
  OUT o_event uuid, OUT o_free uuid, OUT o_paid uuid, OUT o_owner uuid, OUT o_brand uuid
) LANGUAGE plpgsql AS $$
BEGIN
  o_owner := gen_random_uuid(); o_brand := gen_random_uuid(); o_event := gen_random_uuid();
  INSERT INTO auth.users(id,email) VALUES (o_owner, 'i3827l-' || o_owner || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  INSERT INTO public.brands(id,account_id,name,slug,payment_provider)
    VALUES (o_brand,o_owner,'Link ' || p_tag,'i3827l-' || p_tag || '-' || o_brand,'stripe');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES (
    o_brand,'acct_i3827_' || replace(o_brand::text,'-',''),true,true,'GB','gbp'
  );
  INSERT INTO public.events(id,brand_id,title,slug,event_type,status,visibility,timezone,currency)
    VALUES (o_event,o_brand,'Link event ' || p_tag,'i3827l-' || p_tag || '-' || o_event,'event','draft','draft','UTC','GBP');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
    VALUES (o_event,now()-interval '1 hour',now()+interval '5 hours','UTC',true);
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,is_hidden)
    VALUES (o_event,'Guest list',0,'GBP',true,10,false,1,10,true,true,0,false)
    RETURNING id INTO o_free;
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,is_hidden)
    VALUES (o_event,'Secret paid',1000,'GBP',false,10,false,1,4,true,true,1,true)
    RETURNING id INTO o_paid;
  PERFORM set_config('mingla.publish_free_only','on',true);
  UPDATE public.events SET status='scheduled',visibility='public',published_at=now() WHERE id=o_event;
  PERFORM set_config('mingla.publish_free_only','',true);
END $$;

DO $dates$
DECLARE
  f record;
  v_fri uuid; v_sat uuid;
  v_hash text := repeat('d',64);
  v_tier jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827l_fixture('dates');
  PERFORM public.biz_ticket_link_create(f.o_owner,f.o_event,f.o_paid,NULL,'Press',5,1,'auto',NULL,
    gen_random_uuid(),decode('30112233445566778899aabbccddeeff','hex'),v_hash);

  -- An All dates ticket reads as every date.
  v_tier := public.pg_ticket_link_resolve(v_hash)->'tier';
  PERFORM pg_temp.i3827l_assert(v_tier ? 'validOccurrenceIds' AND v_tier->'validOccurrenceIds' = 'null'::jsonb,
    'an All dates private ticket carries null dates');
  PERFORM pg_temp.i3827l_assert(v_tier ? 'saleEndsAt' OR v_tier ? 'id',
    'the ticket keeps its other fields');

  -- Two dates; the ticket is listed for Friday only.
  UPDATE public.event_dates SET occurrence_key='fri' WHERE event_id=f.o_event;
  SELECT id INTO v_fri FROM public.event_dates WHERE event_id=f.o_event;
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master,occurrence_key)
    VALUES (f.o_event,now()+interval '1 day',now()+interval '1 day 5 hours','UTC',false,'sat')
    RETURNING id INTO v_sat;
  UPDATE public.ticket_types SET valid_occurrence_keys=ARRAY['fri'] WHERE id=f.o_paid;

  v_tier := public.pg_ticket_link_resolve(v_hash)->'tier';
  PERFORM pg_temp.i3827l_assert(v_tier->'validOccurrenceIds' = jsonb_build_array(v_fri),
    format('a Friday-only private ticket names Friday, got %s', v_tier->'validOccurrenceIds'));

  PERFORM pg_temp.i3827l_assert(NOT has_function_privilege('anon','public.issue_3281_ticket_dates_json(uuid)','EXECUTE'),
    'the dates helper stays server-only');
END;
$dates$;

ROLLBACK;
