-- Issue #1971 independent tester proof: a replay key is actor-bound.
-- Two event managers on the same brand must not be able to share one operation
-- id, even when command, brand and canonical arguments are byte-identical.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '1971aaaa-0000-4000-8000-000000000001';
  v_manager constant uuid := '1971aaaa-0000-4000-8000-000000000002';
  v_brand constant uuid := '1971aaaa-0000-4000-8000-000000000003';
  v_operation constant uuid := '1971aaaa-0000-4000-8000-000000000004';
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email) VALUES
    (v_owner,'authenticated','authenticated','issue1971-owner@example.invalid'),
    (v_manager,'authenticated','authenticated','issue1971-manager@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name) VALUES
    (v_owner,'issue1971-owner@example.invalid','Issue 1971 Owner'),
    (v_manager,'issue1971-manager@example.invalid','Issue 1971 Manager');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_owner,'Issue 1971 Receipt Brand','issue-1971-receipt-brand','USD');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
  VALUES(v_brand,v_manager,'event_manager',clock_timestamp());

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  v_result := public.biz_create_trip_draft(
    v_brand,'{"title":"Owner trip"}'::jsonb,v_operation
  );
  IF v_result#>>'{event,id}' IS NULL THEN
    RAISE EXCEPTION 'issue_1971_trip_receipt_actor: first create lacked event';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_manager::text,true);
  BEGIN
    PERFORM public.biz_create_trip_draft(
      v_brand,'{"title":"Owner trip"}'::jsonb,v_operation
    );
    RAISE EXCEPTION
      'issue_1971_trip_receipt_actor: cross-actor replay was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      IF SQLERRM <> 'idempotency_conflict' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM public.events e
      WHERE e.brand_id=v_brand AND e.event_type='trip') <> 1 THEN
    RAISE EXCEPTION
      'issue_1971_trip_receipt_actor: replay changed the trip count';
  END IF;
END;
$test$;

ROLLBACK;
