\set ON_ERROR_STOP on

-- Independent tester proof for #1974. Run after the full PostgreSQL 17
-- migration chain. This attacks the immutable operation binding, rather than
-- the happy suite's exact replay: changing confirmed arguments on the same
-- operation must refuse before any second pricing mutation can occur.
BEGIN;

SELECT set_config('request.jwt.claim.sub','19740000-0000-4000-8000-000000000201',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

INSERT INTO auth.users(id) VALUES ('19740000-0000-4000-8000-000000000201');
INSERT INTO public.creator_accounts(id) VALUES ('19740000-0000-4000-8000-000000000201');
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,
  default_pass_tax,default_pass_mingla_fee,default_pass_service_fee
) VALUES (
  '19740000-0000-4000-8000-000000000210',
  '19740000-0000-4000-8000-000000000201',
  'Issue 1974 tester receipt',
  'issue-1974-tester-receipt',
  'EUR',false,false,false
);

INSERT INTO public.agent_pending_actions(
  id,user_id,tool_name,tool_args,status,source,related_brand_id,
  server_proposed_at,execution_attested_at
) VALUES (
  '19740000-0000-4000-8000-000000000220',
  '19740000-0000-4000-8000-000000000201',
  'set_brand_pricing_defaults',
  '{"brand_id":"19740000-0000-4000-8000-000000000210","mingla_fee":"pass_to_buyer"}'::jsonb,
  'executing','hub_experience',
  '19740000-0000-4000-8000-000000000210',now(),now()
);

SELECT public.ari_execute_ticket_pricing_operation(
  '19740000-0000-4000-8000-000000000220',
  'set_brand_pricing_defaults',
  '{"brand_id":"19740000-0000-4000-8000-000000000210","mingla_fee":"pass_to_buyer"}'::jsonb
);

DO $$
BEGIN
  BEGIN
    PERFORM public.ari_execute_ticket_pricing_operation(
      '19740000-0000-4000-8000-000000000220',
      'set_brand_pricing_defaults',
      '{"brand_id":"19740000-0000-4000-8000-000000000210","mingla_fee":"absorb_by_brand"}'::jsonb
    );
    RAISE EXCEPTION 'changed_confirmed_args_were_replayed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'operation_binding_mismatch' THEN RAISE; END IF;
  END;

  IF (SELECT default_pass_mingla_fee FROM public.brands
      WHERE id='19740000-0000-4000-8000-000000000210') IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.agent_operation_receipts
         WHERE operation_id='19740000-0000-4000-8000-000000000220') <> 1
  THEN
    RAISE EXCEPTION 'changed_args_affected_receipt_or_pricing_state';
  END IF;
END $$;

ROLLBACK;
