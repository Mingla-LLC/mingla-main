\set ON_ERROR_STOP on

-- Independent tester boundary proof for #1974. The binding SPEC requires one
-- ticket writer shared by Ari and Business. The published Business editor must
-- reject the same invalid graph and leave no partial ticket rows behind.
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

DO $$
BEGIN
  BEGIN
    PERFORM public.business_update_live_event_atomic(
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
    RAISE EXCEPTION 'competing_business_writer_persisted_invalid_ticket_graph';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'unlimited_ticket_waitlist_invalid' THEN RAISE; END IF;
  END;
  IF EXISTS (
    SELECT 1 FROM public.ticket_types
    WHERE event_id='19740000-0000-4000-8000-000000000320'
      AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'rejected_business_graph_wrote_ticket_rows'; END IF;
END $$;

ROLLBACK;
