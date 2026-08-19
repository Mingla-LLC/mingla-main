\set ON_ERROR_STOP on
BEGIN;

-- Independent round-five attack: a closed requestedVisibility enum is not
-- sufficient if an authenticated direct table writer can pair valid private
-- intent with a contradictory public live value during the publish transition.
DO $test$
DECLARE
  v_user constant uuid := '1972bbbb-0000-4000-8000-000000000001';
  v_brand constant uuid := '1972bbbb-0000-4000-8000-000000000002';
  v_event_id uuid;
  v_payload jsonb;
  v_before jsonb;
  v_after jsonb;
  v_error text;
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_user,'authenticated','authenticated','issue1972-round5-tester@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_user,'issue1972-round5-tester@example.invalid','Issue 1972 Round 5 Tester');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_user,'Issue 1972 Round 5 Tester Events','issue-1972-round5-tester-events','USD');
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_payload:=jsonb_build_object(
    'title','Private intent must stay private',
    'timezone','UTC',
    'currency','USD',
    'theme',jsonb_build_object('business_draft',jsonb_build_object(
      'requestedVisibility','private',
      'clientRevision',0
    ))
  );
  v_event_id:=((public.business_create_event_draft(v_brand,v_payload))#>>'{event,id}')::uuid;
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES(v_event_id,'2028-12-01T18:00:00Z','2028-12-01T20:00:00Z','UTC',true);
  SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE id=v_event_id;

  BEGIN
    UPDATE public.events SET
      status='scheduled',
      visibility='public',
      theme=(theme-'business_draft')||jsonb_build_object(
        'business_event',theme->'business_draft'
      )
    WHERE id=v_event_id;
    RAISE EXCEPTION 'contradictory_private_to_public_transition_was_accepted';
  EXCEPTION WHEN OTHERS THEN
    v_error:=SQLERRM;
    IF v_error='contradictory_private_to_public_transition_was_accepted' THEN
      RAISE;
    END IF;
    IF v_error<>'event_visibility_invalid' THEN
      RAISE EXCEPTION 'contradictory_transition_wrong_error:%',v_error;
    END IF;
  END;

  SELECT to_jsonb(e) INTO v_after FROM public.events e WHERE id=v_event_id;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'rejected_contradictory_transition_changed_event_graph';
  END IF;
END;
$test$;

ROLLBACK;
