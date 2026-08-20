-- Issue #1971 release-blocking compatibility proof.
-- tripsService.updateLiveTripFields sends the established LiveTripPatch shape
-- (title, description, theme, pricing_tiers, cover fields, settings) directly.
-- The canonical command must accept that shipping client contract or translate
-- it before validation; otherwise every published Business trip edit is dead.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '1971bbbb-0000-4000-8000-000000000001';
  v_brand constant uuid := '1971bbbb-0000-4000-8000-000000000002';
  v_create_operation constant uuid := '1971bbbb-0000-4000-8000-000000000003';
  v_edit_operation constant uuid := '1971bbbb-0000-4000-8000-000000000004';
  v_graph jsonb;
  v_event uuid;
  v_revision timestamptz;
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_owner,'authenticated','authenticated','issue1971-live@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_owner,'issue1971-live@example.invalid','Issue 1971 Live Owner');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_owner,'Issue 1971 Live Brand','issue-1971-live-brand','USD');
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_graph := public.biz_create_trip_draft(
    v_brand,'{"title":"Before edit"}'::jsonb,v_create_operation
  );
  v_event := (v_graph#>>'{event,id}')::uuid;
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES(v_event,now()+interval '7 days',now()+interval '7 days 2 hours','UTC',true);
  UPDATE public.events
  SET status='scheduled',visibility='public',updated_at=clock_timestamp()
  WHERE id=v_event
  RETURNING updated_at INTO v_revision;

  -- Exact top-level payload shape sent by updateLiveTripFields today.
  v_result := public.biz_update_trip_live_command(
    v_event,
    '{"title":"Changed by Business UI"}'::jsonb,
    'Changed the trip title.',
    v_revision,
    v_edit_operation
  );

  IF NOT COALESCE((v_result->>'ok')::boolean,false) THEN
    RAISE EXCEPTION
      'issue_1971_business_live_patch_compat: command rejected a valid Business patch: %',
      v_result;
  END IF;
  IF (SELECT title FROM public.events WHERE id=v_event)
       IS DISTINCT FROM 'Changed by Business UI' THEN
    RAISE EXCEPTION
      'issue_1971_business_live_patch_compat: valid title edit did not persist';
  END IF;
END;
$test$;

ROLLBACK;
