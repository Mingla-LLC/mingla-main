\set ON_ERROR_STOP on
BEGIN;

-- Issue #1529 T-4 — A POLICY SKIP MUST NOT RAISE A REFUND ALARM.
--
-- This is the money-path assertion. `complete_source_refund_notification_delivery`
-- maps a delivery outcome to a status, and then:
--
--   IF v_status IN ('ambiguous','failed_terminal') THEN
--     UPDATE public.source_refunds SET ops_status='needs_review', ...
--
-- `skipped` is deliberately NOT in that escalation set — so the SQL function was
-- always correct. What was broken lived one layer up: `notify-dispatch` had no
-- `skipped` branch, so a kill-switched send fell through to a 422
-- `terminal_unsent`, the drain recorded THAT, and the refund got flagged for
-- manual review. Once #1529 makes Nigerian rows genuinely say NG against a dark
-- `sms_live_enabled.ng`, every Nigerian refund text would have raised a false
-- ops alarm on live money.
--
-- This file pins the SQL half of that contract: 'skipped' leaves ops_status
-- alone, and 'terminal_unsent' still escalates. The edge half is pinned at
-- runtime by supabase/functions/notify-outbox-drain/issue1529.sourceCountry.test.ts.
--
-- THE NEGATIVE CONTROL IS NOT OPTIONAL. Without the terminal_unsent case this
-- test would pass just as happily against a function that escalated NOTHING,
-- which would hide real delivery breakage rather than prevent a false alarm.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1529-4000-8000-000000000050',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'refund-1529@example.test', now(), now()
);

INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-1529-4000-8000-000000000050',
        'refund-1529@example.test', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, created_at, updated_at
) VALUES (
  '00000000-1529-4000-8000-000000000051',
  '00000000-1529-4000-8000-000000000050',
  'Issue 1529 Refund Brand', 'issue-1529-refund-brand', 'USD', now(), now()
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '00000000-1529-4000-8000-000000000052',
  '00000000-1529-4000-8000-000000000051',
  'issue1529refund', 'Issue 1529 Refund Venue', 6.45, 3.47,
  'restaurant', 'verified'
);

-- Two refunds: the first call NULLs dispatch_claim_id, so a second call on the
-- same delivery row would return 'in_progress' and prove nothing. Independent
-- rows keep both outcomes observable.
INSERT INTO public.source_refunds (
  id, source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
  requested_by_type, reason, provider, currency, original_charge_cents,
  buyer_refund_requested_cents, buyer_refund_processed_cents, buyer_state,
  fee_reversal_required_cents, fee_reversal_processed_cents, fee_state,
  fee_leg_kind, financial_state, organizer_refund_liability_cents,
  platform_fee_absorption_cents, provider_payment_reference, idempotency_key,
  ops_status, attention_generation
) VALUES
  ('00000000-1529-4000-8000-000000000060',
   'venue_reservation',
   '00000000-1529-4000-8000-000000000070',
   '00000000-1529-4000-8000-000000000070',
   '00000000-1529-4000-8000-000000000051',
   '00000000-1529-4000-8000-000000000052',
   'venue_eligible_cancel', 'system', 'Issue 1529 skipped probe',
   'stripe', 'USD', 1000, 1000, 0, 'queued', 0, 0, 'not_required',
   'not_required', 'pending', 1000, 0,
   'pi_issue1529_skipped', 'issue-1529-refund-skipped', 'none', 1),
  ('00000000-1529-4000-8000-000000000061',
   'venue_reservation',
   '00000000-1529-4000-8000-000000000071',
   '00000000-1529-4000-8000-000000000071',
   '00000000-1529-4000-8000-000000000051',
   '00000000-1529-4000-8000-000000000052',
   'venue_eligible_cancel', 'system', 'Issue 1529 terminal probe',
   'stripe', 'USD', 1000, 1000, 0, 'queued', 0, 0, 'not_required',
   'not_required', 'pending', 1000, 0,
   'pi_issue1529_terminal', 'issue-1529-refund-terminal', 'none', 1);

DO $policy_skip$
DECLARE
  v_event_skipped     bigint;
  v_event_terminal    bigint;
  v_outbox_skipped    uuid := '00000000-1529-4000-8000-000000000080';
  v_outbox_terminal   uuid := '00000000-1529-4000-8000-000000000081';
  v_delivery_skipped  uuid := '00000000-1529-4000-8000-000000000090';
  v_delivery_terminal uuid := '00000000-1529-4000-8000-000000000091';
  v_claim_skipped     uuid := '00000000-1529-4000-8000-0000000000a0';
  v_claim_terminal    uuid := '00000000-1529-4000-8000-0000000000a1';
  v_now               timestamptz := now();
  v_result            jsonb;
  v_status            text;
  v_outbox_status     text;
  v_ops               text;
  v_error_code        text;
BEGIN
  INSERT INTO public.source_refund_events (
    refund_id, leg_type, event_key, event_type, to_state, actor_type
  ) VALUES (
    '00000000-1529-4000-8000-000000000060', 'buyer_refund',
    'issue-1529-event-skipped', 'needs_attention', 'needs_attention', 'system'
  ) RETURNING id INTO v_event_skipped;

  INSERT INTO public.source_refund_events (
    refund_id, leg_type, event_key, event_type, to_state, actor_type
  ) VALUES (
    '00000000-1529-4000-8000-000000000061', 'buyer_refund',
    'issue-1529-event-terminal', 'needs_attention', 'needs_attention', 'system'
  ) RETURNING id INTO v_event_terminal;

  -- notification_outbox_source_shape: a source_refund_% category REQUIRES
  -- contract_version=9, a channel, attention_generation>0, an event id, and
  -- contact IS NULL. That last one is #1221's privacy design and is exactly
  -- why this pool derives its country at the drain instead of at enqueue.
  INSERT INTO public.notification_outbox (
    id, category_key, user_id, contact, brand_id, payload, idempotency_key,
    status, channel, contract_version, attention_generation,
    source_refund_event_id
  ) VALUES
    (v_outbox_skipped, 'source_refund_buyer_state', NULL, NULL,
     '00000000-1529-4000-8000-000000000051', '{}'::jsonb,
     'issue-1529-outbox-skipped', 'processing', 'inapp', 9, 1,
     v_event_skipped),
    (v_outbox_terminal, 'source_refund_buyer_state', NULL, NULL,
     '00000000-1529-4000-8000-000000000051', '{}'::jsonb,
     'issue-1529-outbox-terminal', 'processing', 'inapp', 9, 1,
     v_event_terminal);

  -- channel='inapp' keeps recipient_key_id/fingerprint NULL (their CHECK is
  -- channel-conditional). status='dispatching' requires all three claim cols.
  INSERT INTO public.source_refund_notification_deliveries (
    id, refund_id, source_refund_event_id, outbox_id, attention_generation,
    audience, channel, recipient_revision, payload_fingerprint,
    serializer_version, idempotency_key, status,
    dispatch_claim_id, dispatch_claimed_at, claim_expires_at, attempts
  ) VALUES
    (v_delivery_skipped, '00000000-1529-4000-8000-000000000060',
     v_event_skipped, v_outbox_skipped, 1, 'buyer', 'inapp', 0,
     repeat('a', 64), 9, 'issue-1529-delivery-skipped', 'dispatching',
     v_claim_skipped, v_now, v_now + interval '120 seconds', 1),
    (v_delivery_terminal, '00000000-1529-4000-8000-000000000061',
     v_event_terminal, v_outbox_terminal, 1, 'buyer', 'inapp', 0,
     repeat('b', 64), 9, 'issue-1529-delivery-terminal', 'dispatching',
     v_claim_terminal, v_now, v_now + interval '120 seconds', 1);

  -- =====================================================================
  -- CASE 1 — a deliberate policy skip.
  -- =====================================================================
  v_result := public.complete_source_refund_notification_delivery(
    v_delivery_skipped, v_claim_skipped, 'skipped', NULL,
    'delivery_skipped', v_now
  );

  -- VACUITY GUARD, and it is a real hazard here: a mismatched claim id makes
  -- the function return {'outcome':'in_progress'} and change NOTHING, which
  -- would sail past every assertion below. Check the return value FIRST.
  IF v_result->>'outcome' IS DISTINCT FROM 'skipped' THEN
    RAISE EXCEPTION
      'issue_1529_t4_skipped_call_did_not_take_effect_%', v_result;
  END IF;

  SELECT status INTO v_status
  FROM public.source_refund_notification_deliveries
  WHERE id = v_delivery_skipped;
  SELECT status INTO v_outbox_status
  FROM public.notification_outbox WHERE id = v_outbox_skipped;
  SELECT ops_status INTO v_ops
  FROM public.source_refunds
  WHERE id = '00000000-1529-4000-8000-000000000060';

  IF v_status IS DISTINCT FROM 'skipped' THEN
    RAISE EXCEPTION 'issue_1529_t4_delivery_status_expected_skipped_got_%',
      COALESCE(v_status, '<NULL>');
  END IF;
  IF v_outbox_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'issue_1529_t4_outbox_status_expected_failed_got_%',
      COALESCE(v_outbox_status, '<NULL>');
  END IF;
  -- THE POINT OF THE WHOLE FILE.
  IF v_ops IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION
      'issue_1529_t4_policy_skip_escalated_the_refund_to_%__false_ops_alarm',
      COALESCE(v_ops, '<NULL>');
  END IF;

  -- =====================================================================
  -- CASE 2 — NEGATIVE CONTROL: a genuine terminal failure MUST still escalate.
  -- Without this, Case 1 would also pass against a function that escalated
  -- nothing at all, and we would have replaced a false alarm with silence.
  -- =====================================================================
  v_result := public.complete_source_refund_notification_delivery(
    v_delivery_terminal, v_claim_terminal, 'terminal_unsent', NULL,
    'delivery_unavailable', v_now
  );

  IF v_result->>'outcome' IS DISTINCT FROM 'failed_terminal' THEN
    RAISE EXCEPTION
      'issue_1529_t4_terminal_call_did_not_take_effect_%', v_result;
  END IF;

  SELECT status INTO v_status
  FROM public.source_refund_notification_deliveries
  WHERE id = v_delivery_terminal;
  SELECT ops_status, last_error_code INTO v_ops, v_error_code
  FROM public.source_refunds
  WHERE id = '00000000-1529-4000-8000-000000000061';

  IF v_status IS DISTINCT FROM 'failed_terminal' THEN
    RAISE EXCEPTION
      'issue_1529_t4_terminal_delivery_status_expected_failed_terminal_got_%',
      COALESCE(v_status, '<NULL>');
  END IF;
  IF v_ops IS DISTINCT FROM 'needs_review' THEN
    RAISE EXCEPTION
      'issue_1529_t4_real_failure_did_NOT_escalate_ops_status_got_%__test_is_measuring_nothing',
      COALESCE(v_ops, '<NULL>');
  END IF;
  IF v_error_code IS DISTINCT FROM 'attention_delivery_unavailable' THEN
    RAISE EXCEPTION
      'issue_1529_t4_terminal_error_code_expected_attention_delivery_unavailable_got_%',
      COALESCE(v_error_code, '<NULL>');
  END IF;

  -- The two refunds must genuinely differ. If both ended in the same state the
  -- test proves nothing about the distinction it exists to protect.
  IF (SELECT ops_status FROM public.source_refunds
      WHERE id = '00000000-1529-4000-8000-000000000060')
     = (SELECT ops_status FROM public.source_refunds
        WHERE id = '00000000-1529-4000-8000-000000000061') THEN
    RAISE EXCEPTION
      'issue_1529_t4_skip_and_failure_produced_the_same_ops_status';
  END IF;
END;
$policy_skip$;

ROLLBACK;
