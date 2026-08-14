\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '1972ffff-0000-4000-8000-000000000001';
  v_brand constant uuid := '1972ffff-0000-4000-8000-000000000002';
  v_date_draft uuid;
  v_date_copy uuid;
  v_past_first uuid;
  v_waitlisted uuid;
  v_ticket_type constant uuid := '1972ffff-0000-4000-8000-000000000003';
  v_payload jsonb;
  v_graph jsonb;
  v_result jsonb;
  v_failures text[] := ARRAY[]::text[];
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_user,'authenticated','authenticated','issue1972-tester@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_user,'issue1972-tester@example.invalid','Issue 1972 Tester');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_user,'Issue 1972 Tester Events','issue-1972-tester-events','USD');
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_payload := jsonb_build_object(
    'title','Preserve my typed date',
    'timezone','America/New_York',
    'currency','USD',
    'theme',jsonb_build_object('business_draft',jsonb_build_object(
      'requestedVisibility','public',
      'whenMode','single',
      'when',jsonb_build_object(
        'date','2028-09-23','doorsOpen','19:30','endsAt','22:00',
        'timezone','America/New_York'),
      'multiDates',NULL,
      'recurrenceRule',NULL,
      'tickets','[]'::jsonb,
      'clientRevision',3)));
  v_result := public.business_create_event_draft(v_brand,v_payload);
  v_date_draft := (v_result#>>'{event,id}')::uuid;

  v_graph := public.business_event_draft_payload_from_graph(v_date_draft);
  IF v_graph#>>'{theme,business_draft,when,date}' IS DISTINCT FROM '2028-09-23' THEN
    v_failures := array_append(v_failures,
      'draft graph reconstruction erased the typed date before publish');
  END IF;

  v_result := public.business_duplicate_event_as_draft(v_date_draft);
  v_date_copy := (v_result#>>'{event,id}')::uuid;
  IF (SELECT theme#>>'{business_draft,when,date}' FROM public.events WHERE id=v_date_copy)
       IS DISTINCT FROM '2028-09-23' THEN
    v_failures := array_append(v_failures,'duplicate erased the source draft date');
  END IF;

  v_result := public.business_create_event_draft(v_brand,
    jsonb_build_object('title','Past first occurrence','timezone','UTC','currency','USD',
      'theme',jsonb_build_object('business_draft',jsonb_build_object(
        'requestedVisibility','public'))));
  v_past_first := (v_result#>>'{event,id}')::uuid;
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES
    (v_past_first,now()-interval '2 days',now()-interval '47 hours','UTC',true),
    (v_past_first,now()+interval '2 days',now()+interval '49 hours','UTC',false);
  UPDATE public.events SET status='scheduled',is_multi_date=true,
    theme=theme||jsonb_build_object('business_event',jsonb_build_object(
      'requestedVisibility','public'))
  WHERE id=v_past_first;
  BEGIN
    PERFORM public.business_unpublish_event_to_draft(v_past_first);
    v_failures := array_append(v_failures,
      'unpublish accepted a multi-date event whose first occurrence already passed');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_result := public.business_create_event_draft(v_brand,
    jsonb_build_object('title','Waitlisted future event','timezone','UTC','currency','USD',
      'theme',jsonb_build_object('business_draft',jsonb_build_object(
        'requestedVisibility','public'))));
  v_waitlisted := (v_result#>>'{event,id}')::uuid;
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES(v_waitlisted,now()+interval '7 days',now()+interval '7 days 2 hours','UTC',true);
  UPDATE public.events SET status='scheduled',
    theme=theme||jsonb_build_object('business_event',jsonb_build_object(
      'requestedVisibility','public'))
  WHERE id=v_waitlisted;
  INSERT INTO public.ticket_types(id,event_id,name,currency,is_free,is_unlimited,waitlist_enabled)
  VALUES(v_ticket_type,v_waitlisted,'Waitlist tier','USD',true,true,true);
  INSERT INTO public.waitlist_entries(event_id,ticket_type_id,email,status)
  VALUES(v_waitlisted,v_ticket_type,'waiting@example.invalid','waiting');
  BEGIN
    PERFORM public.business_unpublish_event_to_draft(v_waitlisted);
    v_failures := array_append(v_failures,
      'unpublish accepted an event with an active buyer waitlist dependency');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF cardinality(v_failures) > 0 THEN
    RAISE EXCEPTION '#1972 tester adversarial failures: %',array_to_string(v_failures,'; ');
  END IF;
END;
$test$;

ROLLBACK;
