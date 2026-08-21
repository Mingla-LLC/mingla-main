-- Issue #1971 implementor happy path: the shared Business top-level patch
-- reaches the canonical live command without a client-only translation layer.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '1971aaaa-0000-4000-8000-000000000001';
  v_brand constant uuid := '1971aaaa-0000-4000-8000-000000000002';
  v_create_operation constant uuid := '1971aaaa-0000-4000-8000-000000000003';
  v_edit_operation constant uuid := '1971aaaa-0000-4000-8000-000000000004';
  v_graph jsonb;
  v_event uuid;
  v_revision timestamptz;
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_owner,'authenticated','authenticated','issue1971-happy@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_owner,'issue1971-happy@example.invalid','Issue 1971 Happy Owner');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_owner,'Issue 1971 Happy Brand','issue-1971-happy-brand','USD');
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_graph := public.biz_create_trip_draft(
    v_brand,'{"title":"Before happy edit"}'::jsonb,v_create_operation
  );
  v_event := (v_graph#>>'{event,id}')::uuid;
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES(v_event,now()+interval '10 days',now()+interval '10 days 2 hours','UTC',true);
  UPDATE public.events
  SET status='scheduled',visibility='public',updated_at=clock_timestamp()
  WHERE id=v_event
  RETURNING updated_at INTO v_revision;

  v_result := public.biz_update_trip_live_command(
    v_event,
    '{"title":"Business contract title","description":"Business contract description"}'::jsonb,
    'Updated the public trip summary.',
    v_revision,
    v_edit_operation
  );

  IF NOT COALESCE((v_result->>'ok')::boolean,false) THEN
    RAISE EXCEPTION
      'issue_1971_business_live_patch_happy: command returned %',v_result;
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.events
    WHERE id=v_event
      AND title='Business contract title'
      AND description='Business contract description'
  ) THEN
    RAISE EXCEPTION
      'issue_1971_business_live_patch_happy: shared payload did not round-trip';
  END IF;
END;
$test$;

ROLLBACK;
