-- #1977 implementor happy path: one canonical draft + shared #1972 receipt.
-- Run after the complete PostgreSQL 17 migration chain.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('19771000-0000-4000-8000-000000000001','owner-1977-receipt@example.test'),
  ('19771000-0000-4000-8000-000000000002','outsider-1977-receipt@example.test');
INSERT INTO public.creator_accounts(id) VALUES
  ('19771000-0000-4000-8000-000000000001'),
  ('19771000-0000-4000-8000-000000000002');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('19771000-0000-4000-8000-000000000010',
  '19771000-0000-4000-8000-000000000001','Receipt RSVP Brand',
  'receipt-rsvp-brand','USD',now(),now());
INSERT INTO public.agent_conversations(id,user_id,brand_id,title)
VALUES('19771000-0000-4000-8000-000000000015',
  '19771000-0000-4000-8000-000000000001',
  '19771000-0000-4000-8000-000000000010','RSVP receipt proof');

DO $shared_receipt$
DECLARE
  v_operation uuid:='19771000-0000-4000-8000-000000000020';
  v_args jsonb:=jsonb_build_object(
    'brand_id','19771000-0000-4000-8000-000000000010',
    'title','Receipt-bound RSVP','timezone','America/New_York',
    'format','in_person','date','2030-09-14','doors_open','19:30',
    'capacity',50,'contribution_enabled',false);
  v_first jsonb; v_replay jsonb; v_event uuid; v_before integer;
BEGIN
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_operation,'19771000-0000-4000-8000-000000000001',
    '19771000-0000-4000-8000-000000000015',
    'create_rsvp',v_args,'executing',now(),now());
  PERFORM set_config(
    'request.jwt.claim.sub','19771000-0000-4000-8000-000000000001',true);
  v_first:=public.ari_execute_rsvp_operation(v_operation,'create_rsvp',v_args);
  v_event:=(v_first#>>'{event,id}')::uuid;
  IF v_first#>>'{event,event_type}'<>'rsvp'
     OR v_first#>>'{event,status}'<>'draft'
     OR v_first#>>'{event,visibility}'<>'draft'
     OR EXISTS(SELECT 1 FROM public.event_dates WHERE event_id=v_event)
     OR EXISTS(SELECT 1 FROM public.ticket_types WHERE event_id=v_event AND deleted_at IS NULL)
     OR (SELECT count(*) FROM public.agent_operation_receipts
          WHERE operation_id=v_operation)<>1 THEN
    RAISE EXCEPTION 'I-1977-01 FAIL: canonical draft/shared receipt incomplete: %',v_first;
  END IF;

  v_replay:=public.ari_execute_rsvp_operation(v_operation,'create_rsvp',v_args);
  IF v_replay#>>'{event,id}'<>v_event::text
     OR (SELECT count(*) FROM public.events
          WHERE brand_id='19771000-0000-4000-8000-000000000010')<>1
     OR (SELECT count(*) FROM public.agent_operation_receipts
          WHERE operation_id=v_operation)<>1 THEN
    RAISE EXCEPTION 'I-1977-02 FAIL: exact replay duplicated an effect: %',v_replay;
  END IF;

  v_before:=(SELECT count(*) FROM public.events);
  BEGIN
    PERFORM public.ari_execute_rsvp_operation(
      v_operation,'create_rsvp',v_args||jsonb_build_object('capacity',51));
    RAISE EXCEPTION 'I-1977-03 FAIL: changed args reused an operation id';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%operation_binding_mismatch%'
       AND SQLERRM NOT LIKE '%idempotency_conflict%' THEN RAISE;END IF;
  END;
  IF (SELECT count(*) FROM public.events)<>v_before THEN
    RAISE EXCEPTION 'I-1977-03 FAIL: conflict wrote a second event';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub','19771000-0000-4000-8000-000000000002',true);
  BEGIN
    PERFORM public.ari_execute_rsvp_operation(v_operation,'create_rsvp',v_args);
    RAISE EXCEPTION 'I-1977-04 FAIL: another actor replayed the receipt';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%operation_not_found%' THEN RAISE;END IF;
  END;
END;
$shared_receipt$;

ROLLBACK;
