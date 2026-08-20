\set ON_ERROR_STOP on

-- Independent tester boundary proof for #1974. The binding SPEC requires one
-- ticket writer shared by Ari and Business. This test is deliberately red
-- while the published Business editor still reaches #1972's older writer and
-- can persist a graph that #1974's canonical command rejects.
BEGIN;

SELECT set_config('request.jwt.claim.sub','19740000-0000-4000-8000-000000000301',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

INSERT INTO auth.users(id) VALUES ('19740000-0000-4000-8000-000000000301');
INSERT INTO public.creator_accounts(id) VALUES ('19740000-0000-4000-8000-000000000301');
INSERT INTO public.brands(id,account_id,name,slug,default_currency)
VALUES (
  '19740000-0000-4000-8000-000000000310',
  '19740000-0000-4000-8000-000000000301',
  'Issue 1974 tester writer',
  'issue-1974-tester-writer',
  'EUR'
);
INSERT INTO public.events(
  id,brand_id,title,slug,event_type,status,currency,theme
) VALUES (
  '19740000-0000-4000-8000-000000000320',
  '19740000-0000-4000-8000-000000000310',
  'One writer probe',
  'issue-1974-one-writer-probe',
  'event','scheduled','EUR',
  '{"business_event":{"clientRevision":0,"settings":{}}}'::jsonb
);

-- This is the exact published Business editor owner. #1974 forbids an
-- unlimited tier with a waitlist, but the older owner accepts it.
SELECT public.business_update_live_event_atomic(
  '19740000-0000-4000-8000-000000000320',
  jsonb_build_object('core',jsonb_build_object('tickets',jsonb_build_array(
    jsonb_build_object(
      'id','19740000-0000-4000-8000-000000000330',
      'name','Invalid split-brain tier',
      'isFree',true,
      'isUnlimited',true,
      'priceGbp',NULL,
      'capacity',NULL,
      'visibility','public',
      'displayOrder',0,
      'approvalRequired',false,
      'passwordProtected',false,
      'waitlistEnabled',true,
      'minPurchaseQty',1,
      'maxPurchaseQty',NULL,
      'allowTransfers',true,
      'description',NULL,
      'saleStartAt',NULL,
      'saleEndAt',NULL,
      'availableAt','both'
    )
  ))),
  'Independent one writer proof',
  1
);

DO $$
DECLARE v_tiers jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'id',tt.id::text,
    'name',tt.name,
    'isFree',tt.is_free,
    'isUnlimited',tt.is_unlimited,
    'priceGbp',CASE WHEN tt.price_cents IS NULL THEN NULL ELSE tt.price_cents/100.0 END,
    'capacity',tt.quantity_total,
    'visibility',CASE WHEN tt.is_disabled THEN 'disabled' WHEN tt.is_hidden THEN 'hidden' ELSE 'public' END,
    'displayOrder',tt.display_order,
    'approvalRequired',tt.requires_approval,
    'passwordProtected',tt.password_protected,
    'passwordConfigured',tt.password_hash IS NOT NULL,
    'waitlistEnabled',tt.waitlist_enabled,
    'minPurchaseQty',tt.min_purchase_qty,
    'maxPurchaseQty',tt.max_purchase_qty,
    'allowTransfers',tt.allow_transfers,
    'description',tt.description,
    'saleStartAt',tt.sale_start_at,
    'saleEndAt',tt.sale_end_at,
    'availableAt',CASE WHEN tt.available_online AND tt.available_in_person THEN 'both'
      WHEN tt.available_in_person THEN 'door' ELSE 'online' END
  ) ORDER BY tt.display_order) INTO v_tiers
  FROM public.ticket_types tt
  WHERE tt.event_id='19740000-0000-4000-8000-000000000320'
    AND tt.deleted_at IS NULL;

  BEGIN
    PERFORM public.business_patch_event_ticket_tiers(
      '19740000-0000-4000-8000-000000000320',v_tiers,
      (SELECT updated_at FROM public.events
       WHERE id='19740000-0000-4000-8000-000000000320'),
      NULL,
      '19740000-0000-4000-8000-000000000340',
      'Canonical writer comparison'
    );
    RAISE EXCEPTION 'canonical_writer_accepted_invalid_ticket_graph';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'unlimited_ticket_waitlist_invalid' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'competing_business_writer_persisted_invalid_ticket_graph';
END $$;

ROLLBACK;
