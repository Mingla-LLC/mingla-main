\set ON_ERROR_STOP on

-- #1974 behavioral proof. Run after the full migration chain on PostgreSQL 17.
BEGIN;

SELECT set_config('request.jwt.claim.sub','19740000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

INSERT INTO auth.users(id) VALUES ('19740000-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('19740000-0000-4000-8000-000000000001');

INSERT INTO public.brands(id,account_id,name,slug,default_currency)
VALUES (
  '19740000-0000-4000-8000-000000000010',
  '19740000-0000-4000-8000-000000000001',
  'Issue 1974',
  'issue-1974',
  'EUR'
);

INSERT INTO public.events(id,brand_id,title,slug,event_type,status,currency,theme)
VALUES
  (
    '19740000-0000-4000-8000-000000000020',
    '19740000-0000-4000-8000-000000000010',
    'Draft graph',
    'issue-1974-draft',
    'event',
    'draft',
    NULL,
    '{"business_draft":{"clientRevision":0,"tickets":[],"untouched":{"keep":true}}}'::jsonb
  ),
  (
    '19740000-0000-4000-8000-000000000021',
    '19740000-0000-4000-8000-000000000010',
    'Live graph',
    'issue-1974-live',
    'event',
    'scheduled',
    'EUR',
    '{}'::jsonb
  ),
  (
    '19740000-0000-4000-8000-000000000022',
    '19740000-0000-4000-8000-000000000010',
    'Trip graph',
    'issue-1974-trip',
    'trip',
    'draft',
    'EUR',
    '{}'::jsonb
  );

SELECT public.business_patch_event_ticket_tiers(
  '19740000-0000-4000-8000-000000000020',
  '[{"id":"draft-tier-a","name":"Free RSVP","isFree":true,"isUnlimited":false,"priceGbp":null,"capacity":40,"visibility":"public","displayOrder":0,"approvalRequired":false,"passwordProtected":false,"passwordConfigured":false,"waitlistEnabled":false,"minPurchaseQty":1,"maxPurchaseQty":null,"allowTransfers":true,"description":null,"saleStartAt":null,"saleEndAt":null,"availableAt":"both"}]'::jsonb,
  (SELECT updated_at FROM public.events WHERE id='19740000-0000-4000-8000-000000000020'),
  0,
  '19740000-0000-4000-8000-000000000030',
  NULL
);

DO $$
DECLARE v_event public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.events
  WHERE id='19740000-0000-4000-8000-000000000020';
  IF jsonb_array_length(v_event.theme->'business_draft'->'tickets') <> 1
     OR v_event.theme->'business_draft'->'tickets'->0->>'name' <> 'Free RSVP'
     OR (v_event.theme->'business_draft'->>'clientRevision')::integer <> 1
     OR v_event.theme->'business_draft'->'untouched'->>'keep' <> 'true'
  THEN RAISE EXCEPTION 'draft_ticket_readback_failed'; END IF;
  IF v_event.currency IS NOT NULL THEN RAISE EXCEPTION 'free_draft_fabricated_currency'; END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id=v_event.id) THEN
    RAISE EXCEPTION 'draft_created_live_projection';
  END IF;
END $$;

SELECT public.business_patch_pricing_switches(
  '19740000-0000-4000-8000-000000000020',
  '{"pass_mingla_fee":true}'::jsonb
);

DO $$
DECLARE v_event public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.events
  WHERE id='19740000-0000-4000-8000-000000000020';
  IF v_event.pass_tax IS NOT NULL OR v_event.pass_service_fee IS NOT NULL
     OR v_event.pass_mingla_fee IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'sparse_pricing_clobbered_omitted_key'; END IF;
END $$;

SELECT public.business_patch_event_ticket_tiers(
  '19740000-0000-4000-8000-000000000021',
  '[{"id":"19740000-0000-4000-8000-000000000031","name":"Live free","isFree":true,"isUnlimited":true,"priceGbp":null,"capacity":null,"visibility":"public","displayOrder":0,"approvalRequired":false,"passwordProtected":false,"passwordConfigured":false,"waitlistEnabled":false,"minPurchaseQty":1,"maxPurchaseQty":null,"allowTransfers":true,"description":null,"saleStartAt":null,"saleEndAt":null,"availableAt":"both"}]'::jsonb,
  (SELECT updated_at FROM public.events WHERE id='19740000-0000-4000-8000-000000000021'),
  NULL,
  '19740000-0000-4000-8000-000000000032',
  'Create the first live tier.'
);

INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,quantity_total,is_unlimited,is_free)
VALUES (
  '19740000-0000-4000-8000-000000000040',
  '19740000-0000-4000-8000-000000000022',
  'Trip ticket',
  0,
  NULL,
  NULL,
  true,
  true
);
INSERT INTO public.trip_pricing_tiers(id,event_id,ticket_type_id,tier_name)
VALUES (
  '19740000-0000-4000-8000-000000000041',
  '19740000-0000-4000-8000-000000000022',
  '19740000-0000-4000-8000-000000000040',
  'Trip price'
);

-- #1972 receipt integration: each #1974 write commits its result beside the
-- mutation and replays without a second effect.
DO $$
DECLARE
  v_args jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_operation uuid;
BEGIN
  v_operation := '19740000-0000-4000-8000-000000000050';
  v_args := jsonb_build_object(
    'event_id','19740000-0000-4000-8000-000000000020',
    'name','Receipt free',
    'is_free',true,
    'is_unlimited',true
  );
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,
    related_event_id,server_proposed_at,execution_attested_at
  ) VALUES(
    v_operation,'19740000-0000-4000-8000-000000000001',
    'upsert_ticket_tier',v_args,'executing','hub_experience',
    '19740000-0000-4000-8000-000000000010',
    '19740000-0000-4000-8000-000000000020',now(),now()
  );
  v_first := public.ari_execute_ticket_pricing_operation(
    v_operation,'upsert_ticket_tier',v_args
  );
  v_replay := public.ari_execute_ticket_pricing_operation(
    v_operation,'upsert_ticket_tier',v_args
  );
  IF v_first IS DISTINCT FROM v_replay
     OR (SELECT count(*) FROM public.agent_operation_receipts
         WHERE operation_id=v_operation) <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(
           (SELECT theme#>'{business_draft,tickets}' FROM public.events
            WHERE id='19740000-0000-4000-8000-000000000020')
         ) tier WHERE tier->>'id'=v_operation::text) <> 1
  THEN RAISE EXCEPTION 'ticket_receipt_replay_failed'; END IF;

  v_operation := '19740000-0000-4000-8000-000000000051';
  v_args := jsonb_build_object(
    'event_id','19740000-0000-4000-8000-000000000020',
    'service_fee','pass_to_buyer'
  );
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,
    related_event_id,server_proposed_at,execution_attested_at
  ) VALUES(
    v_operation,'19740000-0000-4000-8000-000000000001',
    'set_pricing_switches',v_args,'executing','hub_experience',
    '19740000-0000-4000-8000-000000000010',
    '19740000-0000-4000-8000-000000000020',now(),now()
  );
  v_first := public.ari_execute_ticket_pricing_operation(
    v_operation,'set_pricing_switches',v_args
  );
  v_replay := public.ari_execute_ticket_pricing_operation(
    v_operation,'set_pricing_switches',v_args
  );
  IF v_first IS DISTINCT FROM v_replay
     OR (SELECT count(*) FROM public.agent_operation_receipts
         WHERE operation_id=v_operation) <> 1
     OR (SELECT pass_service_fee FROM public.events
         WHERE id='19740000-0000-4000-8000-000000000020') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'event_pricing_receipt_replay_failed'; END IF;

  v_operation := '19740000-0000-4000-8000-000000000052';
  v_args := jsonb_build_object(
    'brand_id','19740000-0000-4000-8000-000000000010',
    'mingla_fee','absorb_by_brand'
  );
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_operation,'19740000-0000-4000-8000-000000000001',
    'set_brand_pricing_defaults',v_args,'executing','hub_experience',
    '19740000-0000-4000-8000-000000000010',now(),now()
  );
  v_first := public.ari_execute_ticket_pricing_operation(
    v_operation,'set_brand_pricing_defaults',v_args
  );
  v_replay := public.ari_execute_ticket_pricing_operation(
    v_operation,'set_brand_pricing_defaults',v_args
  );
  IF v_first IS DISTINCT FROM v_replay
     OR (SELECT count(*) FROM public.agent_operation_receipts
         WHERE operation_id=v_operation) <> 1
     OR (SELECT default_pass_mingla_fee FROM public.brands
         WHERE id='19740000-0000-4000-8000-000000000010') IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'brand_pricing_receipt_replay_failed'; END IF;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM public.business_patch_event_ticket_tiers(
      '19740000-0000-4000-8000-000000000021',
      '[{"id":"19740000-0000-4000-8000-000000000041","name":"Wrong graph","isFree":true,"isUnlimited":true,"priceGbp":null,"capacity":null,"visibility":"public","displayOrder":0,"approvalRequired":false,"passwordProtected":false,"passwordConfigured":false,"waitlistEnabled":false,"minPurchaseQty":1,"maxPurchaseQty":null,"allowTransfers":true,"description":null,"saleStartAt":null,"saleEndAt":null,"availableAt":"both"}]'::jsonb,
      (SELECT updated_at FROM public.events WHERE id='19740000-0000-4000-8000-000000000021'),
      NULL,
      '19740000-0000-4000-8000-000000000042',
      'Attempt a wrong graph tier.'
    );
    RAISE EXCEPTION 'trip_tier_id_was_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ticket_lifecycle_mismatch' THEN RAISE; END IF;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','19740000-0000-4000-8000-000000000099',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.business_patch_pricing_switches(
      '19740000-0000-4000-8000-000000000020',
      '{"pass_tax":false}'::jsonb
    );
    RAISE EXCEPTION 'outsider_pricing_write_was_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'insufficient_finance_permission' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
