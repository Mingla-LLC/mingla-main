-- #1977 independent tester guard: contribution refunds stay bound to the
-- caller-confirmed RSVP event. A valid contribution from another RSVP must not
-- be prepared, even when the same organiser owns both events.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('19772000-0000-4000-8000-000000000001','tester-1977@example.test');
INSERT INTO public.creator_accounts(id) VALUES
  ('19772000-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES(
  '19772000-0000-4000-8000-000000000010',
  '19772000-0000-4000-8000-000000000001',
  'Issue 1977 Tester Brand','issue-1977-tester-brand','USD',now(),now()
);

DO $binding$
DECLARE
  v_event_a uuid;
  v_event_b uuid;
  v_refund jsonb;
  v_replay jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub','19772000-0000-4000-8000-000000000001',true);

  v_event_a := (public.business_create_rsvp_draft_graph(
    '19772000-0000-4000-8000-000000000010',
    jsonb_build_object(
      'title','Tester RSVP A','timezone','America/New_York',
      'format','in_person','isRsvp',true,'tickets','[]'::jsonb
    ),'19772000-0000-4000-8000-000000000020'
  )#>>'{event,id}')::uuid;
  v_event_b := (public.business_create_rsvp_draft_graph(
    '19772000-0000-4000-8000-000000000010',
    jsonb_build_object(
      'title','Tester RSVP B','timezone','America/New_York',
      'format','in_person','isRsvp',true,'tickets','[]'::jsonb
    ),'19772000-0000-4000-8000-000000000021'
  )#>>'{event,id}')::uuid;

  INSERT INTO public.event_rsvps(
    id,event_id,guest_name,guest_email,guest_phone,
    rsvp_status,approval_status,plus_count,qr_code
  ) VALUES(
    '19772000-0000-4000-8000-000000000030',v_event_b,
    'Tester Guest','tester-guest@example.test','+15550197700',
    'going','approved',0,
    'mingla-rsvp:1977-tester'
  );
  INSERT INTO public.event_rsvp_contributions(
    id,event_id,rsvp_id,brand_id,guest_name,guest_email,provider,currency,
    amount_cents,buyer_total_cents,application_fee_amount_cents,
    pricing_breakdown,status,stripe_payment_intent_id,stripe_charge_id
  ) VALUES(
    '19772000-0000-4000-8000-000000000040',v_event_b,
    '19772000-0000-4000-8000-000000000030',
    '19772000-0000-4000-8000-000000000010',
    'Tester Guest','tester-money@example.test','stripe','USD',
    2500,2500,125,'{}','paid','pi_issue1977_tester','ch_issue1977_tester'
  );

  BEGIN
    PERFORM public.biz_prepare_rsvp_contribution_refund(
      v_event_a,'19772000-0000-4000-8000-000000000040',
      'discretionary','Wrong-event binding probe','issue-1977-wrong-event'
    );
    RAISE EXCEPTION 'T-1977-ADV-01 FAIL: wrong-event contribution was prepared';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not_authorized%' THEN RAISE; END IF;
  END;
  IF EXISTS(
    SELECT 1 FROM public.source_refunds
    WHERE source_type='rsvp_contribution'
      AND source_id='19772000-0000-4000-8000-000000000040'
  ) THEN
    RAISE EXCEPTION 'T-1977-ADV-02 FAIL: rejected binding left a refund effect';
  END IF;

  v_refund := public.biz_prepare_rsvp_contribution_refund(
    v_event_b,'19772000-0000-4000-8000-000000000040',
    'discretionary','Correct event-bound refund','issue-1977-correct-event'
  );
  v_replay := public.biz_prepare_rsvp_contribution_refund(
    v_event_b,'19772000-0000-4000-8000-000000000040',
    'discretionary','Correct event-bound refund','issue-1977-correct-event'
  );
  IF v_refund->>'refund_id' IS NULL
     OR v_replay->>'refund_id'<>v_refund->>'refund_id'
     OR (SELECT count(*) FROM public.source_refunds
         WHERE source_type='rsvp_contribution'
           AND source_id='19772000-0000-4000-8000-000000000040')<>1
     OR (SELECT event_id FROM public.source_refunds
         WHERE id=(v_refund->>'refund_id')::uuid)<>v_event_b THEN
    RAISE EXCEPTION 'T-1977-ADV-03 FAIL: correct binding/replay drifted: % / %',
      v_refund,v_replay;
  END IF;
END;
$binding$;

ROLLBACK;
