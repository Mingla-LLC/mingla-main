-- Issue #2136 [free-ticket checkout] — the free path can reach 'finalized'.
--
-- WHAT WAS BROKEN (runtime-proved on production, sessions
-- 5cbed701-…, 0a04a737-…, 7241d52e-…):
--
--   Since #1930 the finalize entrypoint `public.biz_ticket_checkout_finalize`
--   is an event-first wrapper that CAS-compares the session's snapshotted
--   `admission_epoch` against `event_checkout_admission_state.epoch` before it
--   delegates to `issue_1930_ticket_checkout_finalize_base`.
--
--   `ticket_checkout_sessions.admission_epoch` is written in exactly ONE place:
--   `issue_1930_claim_ticket_provider_attempt` (this file's sibling, #2101
--   line 1095). That claim is made only by the PAID arms of
--   `ticket-checkout-create` (stripe_checkout / stripe_native /
--   paystack_redirect). The FREE arm (`totalCents === 0`) has no provider, so
--   it never claims, so `admission_epoch` is ALWAYS NULL on a free session.
--
--   The wrapper's guard therefore fired on every free finalize:
--       ... OR v_session.admission_epoch IS NULL OR ...
--   and, because a free finalize carries no payment_intent and no charge, the
--   provider-evidence CASE resolved to NULL and it took the
--   `paid_provider_reference_missing` arm — marking the session
--   `status='failed'`, `reversal_state='paid_reversal_pending'`, opening a
--   revocation-outbox row, minting NO order and NO tickets, and returning
--   `{"outcome":"paid_reversal_pending"}`.
--
--   Production confirms the shape: 3 zero-total sessions, 0 with an admission
--   epoch, 0 with an order. Free checkout has never completed once.
--
-- WHAT THIS MIGRATION CHANGES
--
--   ONE additive branch, entered ONLY by a session that is simultaneously
--   zero-total AND carries no payment_intent AND no charge id. For that branch:
--
--     * the epoch CAS is not applied, because there is nothing to CAS against:
--       a free reservation has no provider round trip, so there is no window
--       between "admission observed" and "order minted" for the epoch to
--       protect. Current truth is instead read LIVE, under the same
--       event -> brand -> session FOR UPDATE locks the wrapper already holds,
--       which is strictly fresher than a snapshot taken earlier;
--
--     * a failed current-truth check returns `{"outcome":"unavailable"}`, NOT
--       `paid_reversal_pending`. `paid_reversal_pending` means "money reached a
--       provider and must be reversed". No money exists on this path, so
--       claiming a reversal is pending is a lie that also poisons
--       `checkout_sale_revocation_outbox` with an un-reversible subject.
--
--   Everything else in this function is copied VERBATIM from
--   20270414002101_issue_2101_named_buyer_checkout_access.sql: the event-first
--   lock order, the brand lock, the order_id idempotent replay, the attempt and
--   admission reads, the #2079 provider-evidence interpretation, the late
--   reversal, the base delegation and the merged return envelope.
--
-- PAID CHECKOUT IMPACT: NONE, and that is structural, not a promise.
--   Every paid caller supplies a provider reference:
--     - ticket-checkout-confirm/index.ts:483        p_stripe_payment_intent_id = paymentIntentId
--     - _shared/stripeWebhookRouter.ts:1496          "  = the PI from the event
--     - _shared/paystackWebhookRouter.ts:371         "  = the Paystack reference
--     - reconcile-stuck-checkouts/index.ts:330       "  = piId (guarded non-null above it)
--   so `COALESCE(p_stripe_payment_intent_id,'')=''` is false for all four and
--   the new branch is unreachable from any paid path. The only caller that
--   passes NULL for both is the free arm of ticket-checkout-create (index.ts:700),
--   and that arm only runs when the session's total_cents is 0.
--
-- I-PROPOSED-2136-FREE-FINALIZE-REACHABLE (DRAFT — flips ACTIVE on CLOSE):
--   A zero-total ticket checkout session that passes live current-truth MUST
--   reach `outcome='finalized'` with an order and its issued tickets. A
--   zero-total session that FAILS live current-truth MUST return
--   `outcome='unavailable'` and MUST NOT be recorded as a pending payment
--   reversal.

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(
  p_checkout_session_id uuid,p_stripe_payment_intent_id text,
  p_stripe_charge_id text,p_stripe_payment_method_type text,p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL,
  p_saved_payment_method_id text DEFAULT NULL,p_installment_plan_root boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_event public.events%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE;
  v_attempt public.ticket_checkout_provider_attempts%ROWTYPE; v_result jsonb; v_reversal jsonb;
  v_observed_provider text;
BEGIN
  SELECT e.* INTO v_event FROM public.ticket_checkout_sessions s
    JOIN public.events e ON e.id=s.event_id WHERE s.id=p_checkout_session_id FOR UPDATE OF e;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_checkout_session_id FOR UPDATE;
  IF v_session.order_id IS NOT NULL THEN RETURN jsonb_build_object('outcome','finalized','orderId',v_session.order_id); END IF;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE id=v_session.provider_attempt_id FOR UPDATE;
  SELECT * INTO v_admission FROM public.event_checkout_admission_state WHERE event_id=v_event.id FOR UPDATE;
  -- #2136 — the NO-VALUE arm. Zero total AND no provider reference of any kind.
  -- Structurally disjoint from every paid caller (all four supply a reference).
  IF COALESCE(v_session.total_cents,0)=0
     AND COALESCE(p_stripe_payment_intent_id,'')=''
     AND COALESCE(p_stripe_charge_id,'')='' THEN
    -- Live current truth under the locks already held. No epoch CAS: a free
    -- reservation has no provider window for an epoch to protect, and
    -- admission_epoch is never stamped on a session that never claimed an
    -- attempt. Failure here is 'unavailable' — there is no payment to reverse.
    IF public.issue_1930_event_sale_reason(v_event)<>'sellable'
       OR v_session.revoked_at IS NOT NULL
       OR NOT public.issue_1930_ticket_session_authorized(v_session.id,v_event.id) THEN
      RETURN jsonb_build_object('outcome','unavailable');
    END IF;
    v_result:=public.issue_1930_ticket_checkout_finalize_base(p_checkout_session_id,
      p_stripe_payment_intent_id,p_stripe_charge_id,p_stripe_payment_method_type,
      p_qr_token_pepper,p_stripe_customer_id_on_connected_account,
      p_saved_payment_method_id,p_installment_plan_root);
    RETURN jsonb_build_object('outcome','finalized')||COALESCE(v_result,'{}'::jsonb);
  END IF;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' OR v_session.revoked_at IS NOT NULL
     OR v_session.admission_epoch IS NULL OR v_admission.epoch<>v_session.admission_epoch
     OR NOT public.issue_1930_ticket_session_authorized(v_session.id,v_event.id) THEN
    v_observed_provider:=CASE
      WHEN v_attempt.id IS NOT NULL THEN v_attempt.provider
      WHEN COALESCE(p_stripe_payment_intent_id,'') ~ '^pi_[A-Za-z0-9]+$'
        AND COALESCE(p_stripe_charge_id,'') ~ '^ch_[A-Za-z0-9]+$' THEN 'stripe'
      WHEN COALESCE(p_stripe_payment_intent_id,'') !~ '^pi_[A-Za-z0-9]+$'
        AND COALESCE(p_stripe_payment_intent_id,'')<>''
        AND COALESCE(p_stripe_charge_id,'') ~ '^[0-9]+$' THEN 'paystack'
      ELSE NULL END;
    IF v_observed_provider IS NULL THEN
      UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',status='failed',
        failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=v_session.id;
      INSERT INTO public.checkout_sale_revocation_outbox(subject_type,subject_id,event_id,
        provider_attempt_id,target_epoch,reason,state,last_error_code)
      VALUES('ticket_checkout_session',v_session.id,v_session.event_id,v_attempt.id,
        COALESCE(v_attempt.claimed_epoch,v_session.admission_epoch,1),
        'paid_provider_reference_missing','provider_unknown','paid_provider_reference_missing')
      ON CONFLICT(subject_type,subject_id,target_epoch) DO UPDATE SET state='provider_unknown',
        last_error_code=EXCLUDED.last_error_code,updated_at=now();
      RETURN jsonb_build_object('outcome','paid_reversal_pending',
        'reversalReason','paid_provider_reference_missing');
    END IF;
    v_reversal:=public.issue_1930_mint_ticket_late_reversal(v_session.id,
      v_observed_provider,p_stripe_payment_intent_id,
      CASE WHEN v_observed_provider='paystack' THEN p_stripe_charge_id ELSE NULL END,
      CASE WHEN v_observed_provider='stripe' THEN p_stripe_charge_id ELSE NULL END);
    RETURN jsonb_build_object('outcome','paid_reversal_pending',
      'reversalReason',COALESCE(v_reversal->>'reason',v_reversal->>'outcome'));
  END IF;
  v_result:=public.issue_1930_ticket_checkout_finalize_base(p_checkout_session_id,
    p_stripe_payment_intent_id,p_stripe_charge_id,p_stripe_payment_method_type,
    p_qr_token_pepper,p_stripe_customer_id_on_connected_account,
    p_saved_payment_method_id,p_installment_plan_root);
  RETURN jsonb_build_object('outcome','finalized')||COALESCE(v_result,'{}'::jsonb);
END $function$;

REVOKE ALL ON FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean)
  TO service_role;

COMMENT ON FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean) IS
  'issue #2136 — the #1930/#2079/#2101 event-first finalize wrapper, plus the no-value arm. '
  'A zero-total session with no payment_intent and no charge id is checked against LIVE current '
  'truth under the event -> brand -> session locks (no admission-epoch CAS: a free reservation '
  'never claims a provider attempt, so it has no epoch to snapshot and no provider window for an '
  'epoch to protect) and returns outcome=unavailable on failure rather than paid_reversal_pending, '
  'because there is no payment to reverse. Every paid caller supplies a provider reference, so the '
  'no-value arm is unreachable from the paid path. service_role only.';

DO $$
DECLARE v_src text; v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM pg_proc
    WHERE proname='biz_ticket_checkout_finalize' AND pronargs=8;
  IF v_count<>1 THEN
    RAISE EXCEPTION 'issue #2136 self-verify: expected exactly 1 biz_ticket_checkout_finalize(8-param) overload, found %', v_count;
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc
    WHERE proname='biz_ticket_checkout_finalize' AND pronargs=8;
  IF position('#2136' in v_src)=0 THEN
    RAISE EXCEPTION 'issue #2136 self-verify: the no-value arm is absent from the deployed finalize body';
  END IF;
  -- The paid guard must still be present and unchanged in shape.
  IF position('v_session.admission_epoch IS NULL' in v_src)=0
     OR position('paid_provider_reference_missing' in v_src)=0 THEN
    RAISE EXCEPTION 'issue #2136 self-verify: the paid current-truth guard was altered';
  END IF;
END $$;
