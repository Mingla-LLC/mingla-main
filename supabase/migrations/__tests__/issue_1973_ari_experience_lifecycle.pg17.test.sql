\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users(id,email)
VALUES ('19730000-0000-4000-8000-000000000001','issue1973@example.com');

INSERT INTO public.creator_accounts(id,email,display_name)
VALUES (
  '19730000-0000-4000-8000-000000000001',
  'issue1973@example.com',
  'Issue 1973 tester'
);

INSERT INTO public.brands(
  id,account_id,name,slug,kind,has_physical_location
) VALUES (
  '19730000-0000-4000-8000-000000000002',
  '19730000-0000-4000-8000-000000000001',
  'Issue 1973 Venue',
  'issue-1973-venue',
  'physical',
  true
);

INSERT INTO public.agent_pending_actions(
  id,user_id,tool_name,tool_args,status,source,related_brand_id,
  server_proposed_at,execution_attested_at
) VALUES (
  '19730000-0000-4000-8000-000000000003',
  '19730000-0000-4000-8000-000000000001',
  'create_experience',
  '{"brand_id":"19730000-0000-4000-8000-000000000002","title":"Receipt-safe experience","narrative":"A canonical happy path","intent_tags":["date night"],"currency":"USD","is_free":true}',
  'executing',
  'hub_experience',
  '19730000-0000-4000-8000-000000000002',
  now(),
  now()
);

SELECT set_config(
  'request.jwt.claim.sub',
  '19730000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;

SELECT public.ari_execute_experience_operation(
  '19730000-0000-4000-8000-000000000003',
  'create_experience',
  '{"brand_id":"19730000-0000-4000-8000-000000000002","title":"Receipt-safe experience","narrative":"A canonical happy path","intent_tags":["date night"],"currency":"USD","is_free":true}'
);

-- The receipt owns replay, so the same immutable proposal creates one graph.
SELECT public.ari_execute_experience_operation(
  '19730000-0000-4000-8000-000000000003',
  'create_experience',
  '{"brand_id":"19730000-0000-4000-8000-000000000002","title":"Receipt-safe experience","narrative":"A canonical happy path","intent_tags":["date night"],"currency":"USD","is_free":true}'
);

RESET ROLE;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM public.events
    WHERE brand_id='19730000-0000-4000-8000-000000000002'
      AND event_type='experience'
      AND status='draft'
      AND visibility='draft'
  ) <> 1 THEN
    RAISE EXCEPTION '#1973 expected exactly one private experience draft';
  END IF;
  IF (
    SELECT count(*) FROM public.agent_operation_receipts
    WHERE operation_id='19730000-0000-4000-8000-000000000003'
  ) <> 1 THEN
    RAISE EXCEPTION '#1973 expected exactly one durable operation receipt';
  END IF;
END;
$$;

ROLLBACK;
