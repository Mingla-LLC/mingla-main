\set ON_ERROR_STOP on

-- Tester-owned #1973 adversarial proof. This attacks the receipt boundary rather
-- than the implementor happy path: another caller and changed confirmed args
-- must both fail without creating any experience graph or durable receipt.
BEGIN;

INSERT INTO auth.users(id,email)
VALUES
  ('19730000-0000-4000-8000-000000000201','issue1973-owner@example.com'),
  ('19730000-0000-4000-8000-000000000202','issue1973-attacker@example.com');

INSERT INTO public.creator_accounts(id,email,display_name)
VALUES
  ('19730000-0000-4000-8000-000000000201','issue1973-owner@example.com','Issue 1973 owner'),
  ('19730000-0000-4000-8000-000000000202','issue1973-attacker@example.com','Issue 1973 attacker');

INSERT INTO public.brands(id,account_id,name,slug,kind,has_physical_location)
VALUES (
  '19730000-0000-4000-8000-000000000203',
  '19730000-0000-4000-8000-000000000201',
  'Issue 1973 Receipt Boundary',
  'issue-1973-receipt-boundary',
  'physical',
  true
);

INSERT INTO public.agent_pending_actions(
  id,user_id,tool_name,tool_args,status,source,related_brand_id,
  server_proposed_at,execution_attested_at
) VALUES (
  '19730000-0000-4000-8000-000000000204',
  '19730000-0000-4000-8000-000000000201',
  'create_experience',
  '{"brand_id":"19730000-0000-4000-8000-000000000203","title":"Immutable receipt title","narrative":"Receipt boundary adversarial proof","intent_tags":["date night"],"currency":"USD","is_free":true}',
  'executing',
  'hub_experience',
  '19730000-0000-4000-8000-000000000203',
  now(),
  now()
);

SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;

-- A different authenticated caller cannot consume the owner's operation id.
SELECT set_config(
  'request.jwt.claim.sub',
  '19730000-0000-4000-8000-000000000202',
  true
);
DO $$
BEGIN
  PERFORM public.ari_execute_experience_operation(
    '19730000-0000-4000-8000-000000000204',
    'create_experience',
    '{"brand_id":"19730000-0000-4000-8000-000000000203","title":"Immutable receipt title","narrative":"Receipt boundary adversarial proof","intent_tags":["date night"],"currency":"USD","is_free":true}'
  );
  RAISE EXCEPTION '#1973 tester expected cross-caller operation_not_found';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%operation_not_found%' THEN RAISE; END IF;
END;
$$;

-- The owner cannot change the immutable confirmed arguments at execution time.
SELECT set_config(
  'request.jwt.claim.sub',
  '19730000-0000-4000-8000-000000000201',
  true
);
DO $$
BEGIN
  PERFORM public.ari_execute_experience_operation(
    '19730000-0000-4000-8000-000000000204',
    'create_experience',
    '{"brand_id":"19730000-0000-4000-8000-000000000203","title":"Changed after confirmation","narrative":"Receipt boundary adversarial proof","intent_tags":["date night"],"currency":"USD","is_free":true}'
  );
  RAISE EXCEPTION '#1973 tester expected operation_binding_mismatch';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%operation_binding_mismatch%' THEN RAISE; END IF;
END;
$$;

RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.events
    WHERE brand_id='19730000-0000-4000-8000-000000000203'
  ) THEN
    RAISE EXCEPTION '#1973 tester rejected calls created an experience';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.agent_operation_receipts
    WHERE operation_id='19730000-0000-4000-8000-000000000204'
  ) THEN
    RAISE EXCEPTION '#1973 tester rejected calls created a receipt';
  END IF;
END;
$$;

-- Restoring the exact caller and exact immutable args creates one graph/receipt.
SELECT set_config(
  'request.jwt.claim.sub',
  '19730000-0000-4000-8000-000000000201',
  true
);
SET LOCAL ROLE authenticated;
SELECT public.ari_execute_experience_operation(
  '19730000-0000-4000-8000-000000000204',
  'create_experience',
  '{"brand_id":"19730000-0000-4000-8000-000000000203","title":"Immutable receipt title","narrative":"Receipt boundary adversarial proof","intent_tags":["date night"],"currency":"USD","is_free":true}'
);
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.events
      WHERE brand_id='19730000-0000-4000-8000-000000000203'
        AND event_type='experience') <> 1 THEN
    RAISE EXCEPTION '#1973 tester expected exactly one experience graph';
  END IF;
  IF (SELECT count(*) FROM public.agent_operation_receipts
      WHERE operation_id='19730000-0000-4000-8000-000000000204') <> 1 THEN
    RAISE EXCEPTION '#1973 tester expected exactly one operation receipt';
  END IF;
END;
$$;

ROLLBACK;
