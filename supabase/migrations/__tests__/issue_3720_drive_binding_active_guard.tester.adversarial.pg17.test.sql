-- #3720 Wave 3 release repair — deleted Brand bindings are terminal.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('37200000-0000-4000-b600-000000000041','wave3-guard-owner@test.local');

INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('37200000-0000-4000-b600-000000000041','wave3-guard-owner@test.local','Wave 3 Guard Owner','wave3_guard_owner','business');

INSERT INTO public.creator_accounts(id,email,display_name,business_name)
VALUES('37200000-0000-4000-b600-000000000041','wave3-guard-owner@test.local','Wave 3 Guard Owner','Wave 3 Guard Host');

INSERT INTO public.brands(id,account_id,name,slug,deleted_at) VALUES
  ('37200000-0000-4000-b700-000000000041','37200000-0000-4000-b600-000000000041','Wave 3 Active Guard','wave3-active-guard',NULL),
  ('37200000-0000-4000-b700-000000000042','37200000-0000-4000-b600-000000000041','Wave 3 Deleted Guard','wave3-deleted-guard',now());

SELECT public.issue_3720_ensure_official_brand_group(id)
FROM public.brands
WHERE id IN (
  '37200000-0000-4000-b700-000000000041',
  '37200000-0000-4000-b700-000000000042'
);

UPDATE public.brand_group_drive_bindings binding
SET state='failed',attempt_count=0,updated_at=now()-interval '10 minutes'
WHERE binding.brand_id='37200000-0000-4000-b700-000000000042';

DO $proof$
DECLARE v_claim jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SET LOCAL ROLE service_role;
  SELECT public.issue_3720_claim_drive_binding() INTO v_claim;
  RESET ROLE;

  IF (v_claim->>'brand_id')::uuid<>'37200000-0000-4000-b700-000000000041'::uuid THEN
    RAISE EXCEPTION 'active_binding_not_claimed_first:%',v_claim;
  END IF;

  UPDATE public.brand_group_drive_bindings
  SET state='ready',lease_expires_at=NULL
  WHERE brand_id='37200000-0000-4000-b700-000000000041';

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SET LOCAL ROLE service_role;
  SELECT public.issue_3720_claim_drive_binding() INTO v_claim;
  RESET ROLE;

  IF v_claim IS NOT NULL THEN
    RAISE EXCEPTION 'deleted_binding_was_claimed:%',v_claim;
  END IF;
  IF (SELECT state FROM public.brand_group_drive_bindings WHERE brand_id='37200000-0000-4000-b700-000000000042')<>'failed' THEN
    RAISE EXCEPTION 'deleted_binding_not_terminal';
  END IF;
  IF has_function_privilege('anon','public.issue_3720_claim_drive_binding()','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3720_claim_drive_binding()','EXECUTE') THEN
    RAISE EXCEPTION 'claim_rpc_exposed';
  END IF;
END;
$proof$;

ROLLBACK;
