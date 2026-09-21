-- A paid ticket held only because our own evidence was incomplete completes
-- the sale instead of being refunded.
--
-- WHAT WAS WRONG: when a Stripe or Paystack payment succeeded but the first
-- signal we saw lacked a piece of evidence (no charge id, no Paystack
-- transaction id, the provider attempt not yet persisted), the checkout was
-- closed and an automatic "no value" refund was opened. When complete evidence
-- arrived seconds later — from the buyer's confirm call, a webhook retry or the
-- reconcile sweep — that evidence only moved the refund into the queue. The
-- buyer had paid, the money was ours to hold, and they still got no ticket.
--
-- NOW: release_ticket_checkout_evidence_hold() runs BEFORE the ordinary
-- verify/finalize path, with the provider's own figures. It lifts the hold
-- only when ALL of these hold under the canonical locks (event, brand,
-- session, attempt, admission, refunds, revocation outbox):
--   * the session is held (failed + paid_reversal_pending, no order, not
--     revoked) and every revocation row for it names a missing-evidence reason;
--   * no refund for it has started: no attempt, event, notice or webhook
--     match, nothing processed, no live worker lease;
--   * the evidence is complete and matches the provider attempt, the session
--     and the held refund exactly (provider, account, payment, charge or
--     transaction id);
--   * the provider's amount and currency equal the session's;
--   * the sale is still open for this buyer: the event is sellable, the
--     admission epoch is unchanged, and the same authorization finalize uses
--     (access, ticket availability, capacity, chosen days) still passes.
-- It then RETIRES the never-started refund rows in place — `financial_state`
-- becomes 'reconciled' with an appended `ops_resolved` event, never a DELETE,
-- because #1221's money ledger is append-only — returns the session to
-- processing_payment, marks the revocation rows sale_completed and answers
-- `released`. The caller's ordinary verify + finalize then issues the tickets
-- through the one existing finalize owner.
--
-- Everything else keeps the refund:
--   * sold out / no longer purchasable -> `refund_kept` + the held refund is
--     tagged buyer_notice_code='sale_unavailable' so the buyer is told why;
--   * account, payment, charge or amount/currency conflict -> `refund_kept`;
--   * a refund worker already holds or started the refund -> `refund_kept`.
--
-- The #2168 handoff no longer opens a second "reference unresolved" refund for
-- a session whose paid evidence already has an owner (a late refund, an order,
-- or a completed sale).

BEGIN;

ALTER TABLE public.checkout_sale_revocation_outbox
  DROP CONSTRAINT IF EXISTS checkout_sale_revocation_outbox_state_check;
ALTER TABLE public.checkout_sale_revocation_outbox
  ADD CONSTRAINT checkout_sale_revocation_outbox_state_check CHECK (state = ANY (ARRAY[
    'queued','leased','provider_unknown','neutralized','paid_reversal_pending',
    'paid_reversed','failed_retryable','failed_terminal','sale_completed']));

ALTER TABLE public.source_refunds
  ADD COLUMN IF NOT EXISTS buyer_notice_code text;
ALTER TABLE public.source_refunds
  DROP CONSTRAINT IF EXISTS source_refunds_buyer_notice_code_check;
ALTER TABLE public.source_refunds
  ADD CONSTRAINT source_refunds_buyer_notice_code_check CHECK (
    buyer_notice_code IS NULL OR buyer_notice_code = 'sale_unavailable');

CREATE OR REPLACE FUNCTION public.release_ticket_checkout_evidence_hold(
  p_checkout_session_id uuid,
  p_provider text,
  p_payment_reference text,
  p_paystack_transaction_id text,
  p_stripe_charge_id text,
  p_observed_account_reference text,
  p_amount_cents bigint,
  p_currency text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp' AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_session public.ticket_checkout_sessions%ROWTYPE;
  v_attempt public.ticket_checkout_provider_attempts%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE;
  v_refund_ids uuid[] := ARRAY[]::uuid[];
  v_refund_snapshot jsonb := '[]'::jsonb;
  v_evidence_reasons text[] := ARRAY['paid_provider_charge_missing',
    'paid_provider_transaction_id_invalid','paid_provider_attempt_missing',
    'paid_provider_reference_missing'];
  v_outbox_count integer; v_outbox_evidence_only boolean;
  v_paystack_id numeric(16,0);
  v_sale_open boolean := false;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_provider NOT IN ('stripe','paystack')
     OR COALESCE(p_payment_reference,'')=''
     OR p_amount_cents IS NULL OR p_amount_cents<0
     OR COALESCE(p_currency,'') !~ '^[A-Za-z]{3}$' THEN
    RAISE EXCEPTION 'invalid_provider_evidence';
  END IF;

  -- Canonical lock order, identical to biz_ticket_checkout_finalize.
  SELECT e.* INTO v_event FROM public.ticket_checkout_sessions s
    JOIN public.events e ON e.id=s.event_id
    WHERE s.id=p_checkout_session_id FOR UPDATE OF e;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','not_held');
  END IF;
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_checkout_session_id FOR UPDATE;
  IF v_session.order_id IS NOT NULL
     OR v_session.status<>'failed'
     OR v_session.reversal_state<>'paid_reversal_pending'
     OR v_session.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome','not_held');
  END IF;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE id=v_session.provider_attempt_id AND checkout_session_id=v_session.id
    FOR UPDATE;
  SELECT * INTO v_admission FROM public.event_checkout_admission_state
    WHERE event_id=v_event.id FOR UPDATE;

  -- 1. The hold must exist ONLY because evidence was missing. A late payment
  --    after a genuine sale closure has no such revocation row.
  SELECT count(*), COALESCE(bool_and(o.reason=ANY(v_evidence_reasons)),false)
    INTO v_outbox_count, v_outbox_evidence_only
    FROM public.checkout_sale_revocation_outbox o
    WHERE o.subject_type='ticket_checkout_session' AND o.subject_id=v_session.id;
  PERFORM 1 FROM public.checkout_sale_revocation_outbox o
    WHERE o.subject_type='ticket_checkout_session' AND o.subject_id=v_session.id
    FOR UPDATE;
  IF v_outbox_count=0 OR NOT v_outbox_evidence_only THEN
    RETURN jsonb_build_object('outcome','not_held');
  END IF;

  -- 2. Complete evidence that matches the provider attempt exactly.
  IF v_attempt.id IS NULL THEN
    RETURN jsonb_build_object('outcome','refund_kept','reason','identity_unverified');
  END IF;
  IF v_attempt.provider<>p_provider THEN
    RETURN jsonb_build_object('outcome','refund_kept','reason','identity_conflict');
  END IF;
  IF p_provider='stripe' THEN
    IF p_paystack_transaction_id IS NOT NULL
       OR p_payment_reference !~ '^pi_[A-Za-z0-9]+$'
       OR v_session.stripe_account_id IS DISTINCT FROM p_observed_account_reference
       OR (v_attempt.flow='stripe_native'
         AND v_attempt.provider_object_id IS DISTINCT FROM p_payment_reference)
       OR (v_attempt.flow='stripe_checkout'
         AND (v_attempt.provider_checkout_id IS DISTINCT FROM v_session.stripe_checkout_session_id
           OR v_session.stripe_payment_intent_id IS DISTINCT FROM p_payment_reference))
       OR v_attempt.flow NOT IN ('stripe_native','stripe_checkout') THEN
      RETURN jsonb_build_object('outcome','refund_kept','reason','identity_conflict');
    END IF;
    IF COALESCE(p_stripe_charge_id,'') !~ '^ch_[A-Za-z0-9]+$' THEN
      RETURN jsonb_build_object('outcome','refund_kept','reason','identity_unverified');
    END IF;
  ELSE
    IF p_stripe_charge_id IS NOT NULL
       OR v_attempt.flow<>'paystack_redirect'
       OR v_attempt.provider_reference IS DISTINCT FROM p_payment_reference THEN
      RETURN jsonb_build_object('outcome','refund_kept','reason','identity_conflict');
    END IF;
    IF COALESCE(p_paystack_transaction_id,'') !~ '^[0-9]{1,16}$' THEN
      RETURN jsonb_build_object('outcome','refund_kept','reason','identity_unverified');
    END IF;
    v_paystack_id:=p_paystack_transaction_id::numeric;
    IF v_paystack_id<1 OR v_paystack_id>9007199254740991 THEN
      RETURN jsonb_build_object('outcome','refund_kept','reason','identity_unverified');
    END IF;
  END IF;

  -- 3. The provider's own amount and currency.
  IF p_amount_cents<>v_session.total_cents
     OR upper(p_currency)<>upper(trim(v_session.currency)) THEN
    RETURN jsonb_build_object('outcome','refund_kept','reason','amount_mismatch');
  END IF;

  -- 4. Every refund for this session is untouched and agrees with the evidence.
  FOR v_refund IN
    SELECT * FROM public.source_refunds
    WHERE source_type='ticket_checkout_session' AND source_id=v_session.id
    ORDER BY id FOR UPDATE
  LOOP
    IF v_refund.refund_kind NOT IN ('late_payment_no_value','checkout_provider_reference_unresolved')
       OR v_refund.buyer_state NOT IN ('needs_attention','queued')
       OR v_refund.financial_state NOT IN ('needs_attention','pending')
       OR v_refund.fee_state NOT IN ('not_required','queued','needs_attention')
       OR v_refund.buyer_refund_processed_cents<>0
       OR v_refund.fee_reversal_processed_cents<>0
       OR v_refund.active_buyer_attempt_no<>0
       OR v_refund.active_fee_attempt_no<>0
       OR v_refund.provider_refund_id IS NOT NULL
       OR v_refund.stripe_application_fee_refund_id IS NOT NULL
       OR v_refund.attention_submission_claim_id IS NOT NULL
       OR (v_refund.lease_owner IS NOT NULL
         AND v_refund.leased_at>=now()-interval '10 minutes')
       OR EXISTS(SELECT 1 FROM public.source_refund_attempts a WHERE a.refund_id=v_refund.id)
       OR EXISTS(SELECT 1 FROM public.source_refund_events e WHERE e.refund_id=v_refund.id)
       OR EXISTS(SELECT 1 FROM public.source_refund_notification_deliveries d
         WHERE d.refund_id=v_refund.id)
       OR EXISTS(SELECT 1 FROM public.payment_webhook_events w
         WHERE w.matched_source_refund_id=v_refund.id)
       OR EXISTS(SELECT 1 FROM public.stay_refunds sr WHERE sr.source_refund_id=v_refund.id)
       OR EXISTS(SELECT 1 FROM public.source_refund_ledger_allocations l
         WHERE l.refund_id=v_refund.id AND (l.state<>'prepared'
           OR l.payout_release_id IS NOT NULL OR l.payout_ledger_adjustment_id IS NOT NULL)) THEN
      RETURN jsonb_build_object('outcome','refund_kept','reason','refund_in_progress');
    END IF;
    IF v_refund.refund_kind='late_payment_no_value' AND (
         v_refund.provider<>p_provider
         OR v_refund.provider_payment_reference IS DISTINCT FROM p_payment_reference
         OR v_refund.provider_account_reference IS DISTINCT FROM v_session.stripe_account_id
         OR (v_refund.stripe_charge_id IS NOT NULL
           AND v_refund.stripe_charge_id IS DISTINCT FROM p_stripe_charge_id)
         OR (v_refund.paystack_transaction_id IS NOT NULL
           AND v_refund.paystack_transaction_id IS DISTINCT FROM v_paystack_id)
         OR (v_refund.last_error_code IS NOT NULL
           AND NOT (v_refund.last_error_code=ANY(v_evidence_reasons)))) THEN
      RETURN jsonb_build_object('outcome','refund_kept','reason','identity_conflict');
    END IF;
    v_refund_ids:=v_refund_ids||v_refund.id;
    v_refund_snapshot:=v_refund_snapshot||jsonb_build_array(jsonb_build_object(
      'refundId',v_refund.id,'refundKind',v_refund.refund_kind,
      'buyerState',v_refund.buyer_state,'amountCents',v_refund.buyer_refund_requested_cents,
      'currency',v_refund.currency,'lastErrorCode',v_refund.last_error_code));
  END LOOP;

  -- 5. The sale is still open for this buyer. The authorization owner reads
  --    the session's own status, so the check runs with the session restored
  --    inside a subtransaction that is undone when the sale is not open.
  BEGIN
    UPDATE public.ticket_checkout_sessions SET status='processing_payment'
      WHERE id=v_session.id;
    IF public.issue_1930_event_sale_reason(v_event)<>'sellable'
       OR v_session.admission_epoch IS NULL
       OR v_admission.epoch<>v_session.admission_epoch
       OR NOT public.issue_1930_ticket_session_authorized(v_session.id,v_event.id) THEN
      RAISE EXCEPTION 'evidence_hold_sale_unavailable';
    END IF;
    v_sale_open:=true;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'evidence_hold_sale_unavailable' THEN RAISE; END IF;
    v_sale_open:=false;
  END;
  IF NOT v_sale_open THEN
    -- MONEY RULE (Seth, 2026-09-21): on a ticket checkout refunded because the
    -- sale could not be completed, Mingla KEEPS its platform fee — the buyer is
    -- refunded their payment minus our fee, and Mingla does not absorb it. This
    -- matches his 2026-09-20 ruling on refunds caused by our own bug, and is
    -- the OPPOSITE of #3391, where a venue cancelling a paid booking makes the
    -- guest whole and Mingla absorbs the fee; that stays as it is.
    --
    -- This branch only tags the reason the buyer is shown. The refund's money
    -- was already decided by whichever creator opened it — both of them on main
    -- in 20270411002079: buyer_refund_requested_cents = total_cents and
    -- platform_fee_absorption_cents = the application fee, i.e. today the fee
    -- is ABSORBED, not kept. That does not match the rule above, and this issue
    -- deliberately does not change it: the maths is inherited, not introduced
    -- here, and a money rule does not get smuggled in through a notice tag. The
    -- #2079 SQL suite pins the inherited figures so the next edit to them has
    -- to be deliberate; changing them is its own issue.
    UPDATE public.source_refunds SET buyer_notice_code='sale_unavailable',updated_at=now()
      WHERE id=ANY(v_refund_ids) AND refund_kind='late_payment_no_value';
    RETURN jsonb_build_object('outcome','refund_kept','reason','sale_unavailable');
  END IF;

  -- 6. Release: the refunds never started, so nothing is owed back.
  --
  -- The obligation is RETIRED IN PLACE, never deleted. #1221 makes the money
  -- ledger append-only: issue_1221_enforce_allocation_monotonic() rejects every
  -- DELETE on source_refund_ledger_allocations and allows only
  -- prepared -> posted, and source_refund_ledger_allocations.refund_id is
  -- ON DELETE RESTRICT, so the source_refunds row cannot go either. Both
  -- creators of a ticket late refund (issue_2079_capture_ticket_paid_identity_
  -- attention and issue_1930_mint_ticket_late_reversal) write the three
  -- prepared allocations at creation, so EVERY hold this function can see has
  -- them. An append-only ledger is the invariant; the release is what bends.
  --
  -- So: append the compensating record #1221 already has a vocabulary for
  -- (`ops_resolved`), then move the refund to `financial_state='reconciled'`.
  -- That is the exact predicate claim_source_refund_operations uses to decide
  -- what is still open (`WHERE financial_state <> 'reconciled'`), and the exact
  -- predicate every payout arm uses to decide what still blocks a release, so
  -- one honest value makes the obligation terminal for both. The prepared
  -- allocations stay exactly as they are: prepared, never posted, which is what
  -- actually happened.
  INSERT INTO public.audit_log(user_id,brand_id,event_id,action,target_type,target_id,before,after)
  VALUES(NULL,v_session.brand_id,v_session.event_id,'ticket_checkout.evidence_hold_released',
    'ticket_checkout_session',v_session.id::text,
    jsonb_build_object('status',v_session.status,'reversalState',v_session.reversal_state,
      'attemptState',v_attempt.state,'refunds',v_refund_snapshot),
    jsonb_build_object('status','processing_payment','reversalState','none',
      'provider',p_provider,'paymentReference',p_payment_reference,
      'amountCents',p_amount_cents,'currency',upper(p_currency),
      'refundsRetired',COALESCE(array_length(v_refund_ids,1),0)));
  INSERT INTO public.source_refund_events(refund_id,event_key,event_type,from_state,to_state,
    amount_observed_cents,safe_reason_code,actor_type,safe_payload)
  SELECT r.id,'evidence-hold-released:'||r.id,'ops_resolved',r.financial_state,'reconciled',
    0,'sale_completed_no_refund_due','system',
    jsonb_build_object('checkoutSessionId',v_session.id,'provider',p_provider)
  FROM public.source_refunds r WHERE r.id=ANY(v_refund_ids)
  ON CONFLICT(event_key) DO NOTHING;
  UPDATE public.source_refunds SET
    financial_state='reconciled',
    ops_status='resolved',
    ops_note='Sale completed after a missing-evidence hold; no refund is owed.',
    last_error_code='sale_completed_no_refund_due',
    last_error_public=NULL,
    lease_owner=NULL,leased_at=NULL,next_retry_at=NULL,
    attention_completed_at=COALESCE(attention_completed_at,now()),
    attention_expires_at=NULL,
    updated_at=now()
  WHERE id=ANY(v_refund_ids);
  -- The session must RE-HOLD its inventory for the finalize window. A held
  -- session only counts toward issue_2491_derived_held() while
  -- `expires_at > now()`, and a hold that reached this function expired long
  -- ago, so without this the release hands back a session holding nothing and
  -- the last seat can be sold out from under a buyer who has already paid.
  -- The window is the session's OWN original hold, re-granted — not a new
  -- number. If that window is somehow empty the hold simply is not extended and
  -- the reopen path below is what catches it.
  UPDATE public.ticket_checkout_sessions SET status='processing_payment',
    reversal_state='none',failed_at=NULL,
    expires_at=now()+GREATEST(v_session.expires_at-v_session.created_at,interval '0'),
    updated_at=now()
    WHERE id=v_session.id;
  UPDATE public.ticket_checkout_provider_attempts SET state='ready',updated_at=now()
    WHERE id=v_attempt.id AND state IN ('provider_unknown','paid_reversal_pending');
  UPDATE public.checkout_sale_revocation_outbox SET state='sale_completed',
    lease_owner=NULL,leased_at=NULL,next_retry_at=NULL,last_error_code=NULL,updated_at=now()
    WHERE subject_type='ticket_checkout_session' AND subject_id=v_session.id;
  -- `refundsReleased` counts the obligations retired by this call. Nothing is
  -- deleted, so a replay finds the session no longer held and answers
  -- `not_held` without touching them again.
  RETURN jsonb_build_object('outcome','released',
    'refundsReleased',COALESCE(array_length(v_refund_ids,1),0));
END $$;

REVOKE ALL ON FUNCTION public.release_ticket_checkout_evidence_hold(
  uuid,text,text,text,text,text,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ticket_checkout_evidence_hold(
  uuid,text,text,text,text,text,bigint,text) TO service_role;


-- #2079 REOPEN — copied verbatim from the merged
-- 20270411002079_issue_2079_paystack_late_refund_identity.sql definition, with
-- exactly ONE added branch (marked below). Nothing else in the body changes.
-- A retired evidence-hold obligation is re-opened when the sale it was retired
-- for does not actually complete, so a failed finalize after a release can
-- never leave paid money with no owner.
CREATE OR REPLACE FUNCTION public.issue_1930_mint_ticket_late_reversal(
  p_checkout_session_id uuid,p_provider text,p_payment_reference text,
  p_paystack_transaction_id text,p_stripe_charge_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_attempt public.ticket_checkout_provider_attempts%ROWTYPE;
  v_existing public.source_refunds%ROWTYPE; v_refund_id uuid; v_fee integer;
  v_paystack_id numeric(16,0); v_reason text; v_can_promote boolean:=false;
BEGIN
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_checkout_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.order_id IS NOT NULL THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE id=v_session.provider_attempt_id AND checkout_session_id=v_session.id FOR UPDATE;
  IF NOT FOUND THEN v_reason:='paid_provider_attempt_missing';
  ELSIF v_attempt.provider<>p_provider THEN v_reason:='paid_provider_conflict';
  ELSIF COALESCE(p_payment_reference,'')='' THEN v_reason:='paid_provider_reference_missing';
  ELSIF p_provider='paystack' AND (v_attempt.flow<>'paystack_redirect'
      OR v_attempt.provider_reference IS DISTINCT FROM p_payment_reference) THEN
    v_reason:='paid_provider_reference_conflict';
  ELSIF p_provider='paystack' AND COALESCE(p_paystack_transaction_id,'') !~ '^[0-9]+$' THEN
    v_reason:='paid_provider_transaction_id_invalid';
  ELSIF p_provider='stripe' AND COALESCE(p_payment_reference,'') !~ '^pi_[A-Za-z0-9]+$' THEN
    v_reason:='paid_provider_reference_conflict';
  ELSIF p_provider='stripe' AND COALESCE(p_stripe_charge_id,'') !~ '^ch_[A-Za-z0-9]+$' THEN
    v_reason:='paid_provider_charge_missing';
  ELSIF p_provider='stripe' AND v_attempt.flow='stripe_native'
      AND v_attempt.provider_object_id IS DISTINCT FROM p_payment_reference THEN
    v_reason:='paid_provider_reference_conflict';
  ELSIF p_provider='stripe' AND v_attempt.flow='stripe_checkout'
      AND (v_attempt.provider_checkout_id IS DISTINCT FROM v_session.stripe_checkout_session_id
        OR v_session.stripe_payment_intent_id IS DISTINCT FROM p_payment_reference) THEN
    v_reason:='paid_provider_checkout_conflict';
  ELSIF p_provider='stripe' AND v_attempt.flow NOT IN ('stripe_native','stripe_checkout') THEN
    v_reason:='paid_provider_conflict';
  END IF;
  IF p_provider='paystack' AND v_reason IS NULL THEN
    v_paystack_id:=p_paystack_transaction_id::numeric;
    IF v_paystack_id<1 OR v_paystack_id>9007199254740991 THEN v_reason:='paid_provider_transaction_id_invalid'; END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    IF COALESCE(p_payment_reference,'')='' THEN
      UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',status='failed',
        failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=v_session.id;
      IF v_attempt.id IS NOT NULL THEN UPDATE public.ticket_checkout_provider_attempts
        SET state='provider_unknown',updated_at=now() WHERE id=v_attempt.id; END IF;
      INSERT INTO public.checkout_sale_revocation_outbox(subject_type,subject_id,event_id,provider_attempt_id,
        target_epoch,reason,state,last_error_code)
      VALUES('ticket_checkout_session',v_session.id,v_session.event_id,v_attempt.id,
        COALESCE(v_attempt.claimed_epoch,v_session.admission_epoch,1),v_reason,'provider_unknown',v_reason)
      ON CONFLICT(subject_type,subject_id,target_epoch) DO UPDATE SET state='provider_unknown',
        last_error_code=EXCLUDED.last_error_code,updated_at=now();
      RETURN jsonb_build_object('outcome','paid_reversal_pending','reason',v_reason);
    END IF;
    RETURN public.issue_2079_capture_ticket_paid_identity_attention(v_session.id,p_provider,
      p_payment_reference,p_paystack_transaction_id,p_stripe_charge_id,v_session.stripe_account_id,v_reason);
  END IF;
  SELECT * INTO v_existing FROM public.source_refunds
  WHERE source_type='ticket_checkout_session' AND source_id=v_session.id
    AND refund_kind='late_payment_no_value' FOR UPDATE;
  IF FOUND THEN
    -- A RETIRED obligation must never be swallowed. release_ticket_checkout_
    -- evidence_hold() retires the refund before the caller's finalize runs; if
    -- that finalize then fails (the last seat went, the ticket type was
    -- switched off, the event closed) the sale lands back here and the buyer is
    -- owed their money again. Without this branch the identity-match return
    -- below would answer 'existing'/'attention', change nothing, and leave a
    -- paid buyer with no ticket and a refund that no longer exists — silently
    -- and permanently, because every worker skips financial_state='reconciled'.
    -- Re-open it instead. A retired row has processed nothing, so there is
    -- nothing to unwind; its prepared allocations are still prepared.
    IF v_existing.financial_state='reconciled'
       AND v_existing.last_error_code='sale_completed_no_refund_due'
       AND v_existing.buyer_refund_processed_cents=0
       AND v_existing.fee_reversal_processed_cents=0
       AND v_existing.provider_refund_id IS NULL
       AND v_existing.provider=p_provider
       AND v_existing.provider_payment_reference=p_payment_reference
       AND v_existing.paystack_transaction_id IS NOT DISTINCT FROM v_paystack_id
       AND v_existing.stripe_charge_id IS NOT DISTINCT FROM p_stripe_charge_id
       AND v_existing.provider_account_reference IS NOT DISTINCT FROM v_session.stripe_account_id THEN
      INSERT INTO public.source_refund_events(refund_id,event_key,event_type,from_state,to_state,
        amount_observed_cents,safe_reason_code,actor_type,safe_payload)
      VALUES(v_existing.id,'evidence-hold-reopened:'||v_existing.id||':'||
        gen_random_uuid(),'requested','reconciled','queued',
        0,'sale_not_completed_after_release','system',
        jsonb_build_object('checkoutSessionId',v_session.id,'provider',p_provider))
      ON CONFLICT(event_key) DO NOTHING;
      UPDATE public.source_refunds SET buyer_state='queued',financial_state='pending',
        ops_status='none',ops_note=NULL,last_error_code=NULL,last_error_public=NULL,
        lease_owner=NULL,leased_at=NULL,next_retry_at=NULL,updated_at=now()
      WHERE id=v_existing.id;
      -- The session must be HARD-FAILED, exactly as the fresh-create path below
      -- does it. The release had put it back in flight with a live expires_at;
      -- leaving it there means reconcile-stuck-checkouts can still pick it up
      -- (its batch is status IN processing_payment/awaiting_web_redirect/
      -- requires_payment/pending_free) and finalize it into a real ticket once
      -- the organiser re-enables the sale, while this refund also pays —
      -- the buyer keeps the ticket AND the money. Nothing in the codebase
      -- cancels a refund on mint, and the revocation outbox cannot save it
      -- either, because issue_1930_claim_revocations claims only queued /
      -- failed_retryable / provider_unknown. Failing the session also returns
      -- the seat. `order_id IS NULL` keeps a sale that DID complete untouched.
      UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',
        status='failed',failed_at=COALESCE(failed_at,now()),updated_at=now()
      WHERE id=v_session.id AND order_id IS NULL;
      UPDATE public.ticket_checkout_provider_attempts SET state='paid_reversal_pending',updated_at=now()
      WHERE id=v_session.provider_attempt_id AND state<>'paid_reversed';
      UPDATE public.checkout_sale_revocation_outbox SET state='paid_reversal_pending',
        lease_owner=NULL,leased_at=NULL,next_retry_at=NULL,last_error_code=NULL,updated_at=now()
      WHERE subject_type='ticket_checkout_session' AND subject_id=v_session.id;
      RETURN jsonb_build_object('outcome','reopened','refundId',v_existing.id);
    END IF;
    IF v_existing.provider=p_provider
       AND v_existing.provider_payment_reference=p_payment_reference
       AND v_existing.paystack_transaction_id IS NOT DISTINCT FROM v_paystack_id
       AND v_existing.stripe_charge_id IS NOT DISTINCT FROM p_stripe_charge_id
       AND v_existing.provider_account_reference IS NOT DISTINCT FROM v_session.stripe_account_id THEN
      RETURN jsonb_build_object('outcome',CASE WHEN v_existing.buyer_state='needs_attention'
        THEN 'attention' ELSE 'existing' END,'refundId',v_existing.id);
    END IF;
    v_can_promote:=v_existing.buyer_state='needs_attention'
      AND v_existing.financial_state='needs_attention'
      AND v_existing.provider=p_provider
      AND v_existing.provider_payment_reference=p_payment_reference
      AND v_existing.provider_account_reference IS NOT DISTINCT FROM v_session.stripe_account_id
      AND (
        (p_provider='paystack' AND v_existing.paystack_transaction_id IS NULL
          AND v_existing.stripe_charge_id IS NULL AND v_paystack_id IS NOT NULL
          AND v_existing.last_error_code='paid_provider_transaction_id_invalid')
        OR
        (p_provider='stripe' AND v_existing.stripe_charge_id IS NULL
          AND v_existing.paystack_transaction_id IS NULL AND p_stripe_charge_id IS NOT NULL
          AND v_existing.last_error_code='paid_provider_charge_missing')
      );
    IF v_can_promote THEN
      UPDATE public.source_refunds SET paystack_transaction_id=v_paystack_id,
        stripe_charge_id=p_stripe_charge_id,buyer_state='queued',financial_state='pending',
        ops_status='none',last_error_code=NULL,last_error_public=NULL,ops_note=NULL,
        lease_owner=NULL,leased_at=NULL,next_retry_at=NULL,updated_at=now() WHERE id=v_existing.id;
      UPDATE public.ticket_checkout_provider_attempts SET state='paid_reversal_pending',updated_at=now()
      WHERE id=v_session.provider_attempt_id AND state<>'paid_reversed';
      UPDATE public.checkout_sale_revocation_outbox SET state='paid_reversal_pending',
        lease_owner=NULL,leased_at=NULL,next_retry_at=NULL,last_error_code=NULL,updated_at=now()
      WHERE subject_type='ticket_checkout_session' AND subject_id=v_session.id;
      RETURN jsonb_build_object('outcome','promoted','refundId',v_existing.id);
    END IF;
    UPDATE public.source_refunds SET buyer_state='needs_attention',financial_state='needs_attention',
      ops_status='needs_review',last_error_code='paid_provider_evidence_conflict',
      last_error_public='Paid provider identity requires review before refund.',
      ops_note='Provider-authenticated paid evidence is held for identity review.',
      lease_owner=NULL,leased_at=NULL,next_retry_at=NULL,updated_at=now()
    WHERE id=v_existing.id;
    RETURN jsonb_build_object('outcome','conflict','refundId',v_existing.id);
  END IF;
  v_fee:=LEAST(v_session.total_cents,COALESCE(v_session.application_fee_amount_cents,0));
  INSERT INTO public.source_refunds(source_type,source_id,subject_id,brand_id,event_id,refund_kind,
    requested_by_type,reason,provider,currency,original_charge_cents,buyer_refund_requested_cents,
    original_application_fee_cents,fee_reversal_required_cents,fee_state,fee_leg_kind,financial_state,
    organizer_refund_liability_cents,platform_fee_absorption_cents,provider_payment_reference,
    provider_account_reference,paystack_transaction_id,stripe_charge_id,idempotency_key)
  VALUES('ticket_checkout_session',v_session.id,v_session.id,v_session.brand_id,v_session.event_id,
    'late_payment_no_value','system','Late payment after sale closure',p_provider,upper(v_session.currency),
    v_session.total_cents,v_session.total_cents,v_fee,v_fee,
    CASE WHEN v_fee=0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee=0 THEN 'not_required' WHEN p_provider='stripe'
      THEN 'stripe_application_fee_refund' ELSE 'paystack_ledger_allocation' END,
    'pending',v_session.total_cents-v_fee,v_fee,p_payment_reference,v_session.stripe_account_id,
    v_paystack_id,p_stripe_charge_id,'late-payment-no-value:'||v_session.id)
  RETURNING id INTO v_refund_id;
  INSERT INTO public.source_refund_ledger_allocations(refund_id,allocation_type,amount_cents,currency,
    provider,state,idempotency_key)
  SELECT v_refund_id,x.kind,x.amount,upper(v_session.currency),p_provider,'prepared',
    'source-refund-allocation:'||x.key||':'||v_refund_id
  FROM (VALUES('buyer_refund',v_session.total_cents,'buyer'),
    ('organizer_refund_liability',v_session.total_cents-v_fee,'organizer'),
    ('platform_application_fee_reversal',v_fee,'platform')) x(kind,amount,key)
  WHERE x.amount>0 ON CONFLICT(idempotency_key) DO NOTHING;
  UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',status='failed',
    failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=v_session.id AND order_id IS NULL;
  UPDATE public.ticket_checkout_provider_attempts SET state='paid_reversal_pending',updated_at=now()
    WHERE id=v_session.provider_attempt_id AND state<>'paid_reversed';
  RETURN jsonb_build_object('outcome','queued','refundId',v_refund_id);
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_mint_ticket_late_reversal(uuid,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_mint_ticket_late_reversal(uuid,text,text,text,text)
  TO service_role;

-- #2168: a paid-evidence revocation row whose money already has an owner does
-- not open a second, operator-only refund.
CREATE OR REPLACE FUNCTION public.issue_2168_handoff_revocation_attention(p_outbox_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row     public.checkout_sale_revocation_outbox%ROWTYPE;
  v_session public.ticket_checkout_sessions%ROWTYPE;
  v_buyer   bigint;
  v_fee     bigint;
BEGIN
  SELECT * INTO v_row FROM public.checkout_sale_revocation_outbox
   WHERE id = p_outbox_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'revocation_outbox_missing'; END IF;
  IF v_row.subject_type <> 'ticket_checkout_session' THEN
    RAISE EXCEPTION 'revocation_subject_unsupported';
  END IF;
  IF v_row.reason NOT LIKE 'paid_provider_%' THEN
    RAISE EXCEPTION 'revocation_reason_not_paid_provider';
  END IF;

  SELECT * INTO v_session FROM public.ticket_checkout_sessions
   WHERE id = v_row.subject_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'revocation_session_missing'; END IF;

  -- The paid evidence already has an owner: the sale completed, an order
  -- exists, or a late-payment refund carries the provider reference. A second,
  -- operator-only refund row would only duplicate it.
  IF v_row.state = 'sale_completed'
     OR v_session.order_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.source_refunds r
       WHERE r.source_type = 'ticket_checkout_session'
         AND r.source_id = v_session.id
         AND r.refund_kind = 'late_payment_no_value') THEN
    RETURN 'already_owned';
  END IF;

  v_fee   := LEAST(COALESCE(v_session.total_cents,0),
                   COALESCE(v_session.application_fee_amount_cents,0));
  v_buyer := COALESCE(v_session.total_cents,0) - v_fee;

  -- A free ticket, or a charge that is entirely platform fee, cannot owe the
  -- buyer anything. `source_refunds` forbids a zero-value refund by CHECK
  -- (buyer_refund_requested_cents > 0), and that is correct — there is no money
  -- to reconcile, so there is nothing for a human to decide.
  IF v_buyer <= 0 THEN
    RETURN 'no_money';
  END IF;

  INSERT INTO public.source_refunds(
    source_type, source_id, subject_id, brand_id, event_id, refund_kind,
    requested_by_type, reason, provider, currency,
    original_charge_cents, buyer_refund_requested_cents,
    original_application_fee_cents, fee_reversal_required_cents,
    fee_state, fee_leg_kind, financial_state, buyer_state, ops_status,
    organizer_refund_liability_cents, platform_fee_absorption_cents,
    provider_account_reference, idempotency_key)
  VALUES(
    'ticket_checkout_session', v_session.id, v_session.id, v_session.brand_id,
    v_session.event_id, 'checkout_provider_reference_unresolved',
    'system',
    'Checkout recorded paid evidence with no resolvable provider reference; '
      || 'awaiting operator identification before any money moves',
    CASE WHEN v_session.stripe_account_id IS NOT NULL THEN 'stripe' ELSE 'paystack' END,
    upper(v_session.currency),
    v_session.total_cents, v_buyer,
    v_fee, 0,
    'not_required', 'not_required', 'needs_attention', 'needs_attention', 'needs_review',
    v_buyer, 0,
    v_session.stripe_account_id,
    'issue-2168-reference-unresolved:' || v_session.id)
  ON CONFLICT (source_type, source_id, refund_kind) DO NOTHING;

  RETURN 'attention_created';
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_2168_handoff_revocation_attention(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_2168_handoff_revocation_attention(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2168_handoff_revocation_attention(uuid) TO service_role;

COMMIT;
