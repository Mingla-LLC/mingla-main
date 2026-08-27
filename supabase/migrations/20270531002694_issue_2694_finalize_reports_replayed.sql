BEGIN;
-- ===========================================================================
-- issue #2694 — SAY WHETHER THIS FINALIZE MINTED ANYTHING, OR JUST FOUND IT.
--
-- Today the edge cannot tell "I completed this order now" from "this order was
-- already complete when I looked". Both arms answer `outcome='finalized'`. The
-- only difference is that the replay arm omits `tickets` — an ABSENT KEY, which
-- is far too fragile to hang a disclosure decision on.
--
-- WHY THAT MATTERS RIGHT NOW. On a concurrent duplicate the session RPC's
-- in-flight arm returns the session with a stale `pending_free` status, so the
-- #2150 possession branch in the edge is skipped — deliberately; that path is
-- documented as needing no token. The edge's pre-finalize gate then decides the
-- outcome BY TIMING:
--
--   * gate runs BEFORE the winner commits -> it passes -> this function's
--     already-finalized arm returns the order -> the edge reads the tickets and
--     renders their QR images -> the caller receives another buyer's pass with
--     NO POSSESSION PROOF WHATSOEVER.
--   * gate runs after -> 409, and the guest is told the sale is gone, which is
--     false.
--
-- A coin flip between disclosing a stranger's ticket and lying to the person who
-- owns it. Two production rows carry the fingerprint of that window being hit —
-- an `updated_at` earlier than the row's own `completed_at`, which only a second
-- create can produce — with gaps of 27ms and 52ms, one of them today.
--
-- THE OBVIOUS FIX WAS THE DANGEROUS ONE. Deleting the pre-gate — which is what
-- was first proposed, on the grounds that this function already handles replays
-- correctly — removes the coin and makes disclosure DETERMINISTIC. Nothing else
-- stands behind it: no JWT is required, no code is sent to the buyer's phone or
-- email, and the targeting key is accepted verbatim from the caller.
--
-- So the gate stays until the edge can tell the two arms apart and demand
-- possession on the replay. This migration only supplies the fact it needs:
-- `replayed` — true when the order already existed, false when this call made
-- it. Same outcomes, same shapes, one added boolean. The edge change that
-- consumes it lands in the same PR.
--
-- Everything else here is the INSTALLED definition, captured with
-- `pg_get_functiondef` and re-emitted verbatim — not the migration file, which
-- can and does drift from what is actually running.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(p_checkout_session_id uuid, p_stripe_payment_intent_id text, p_stripe_charge_id text, p_stripe_payment_method_type text, p_qr_token_pepper text, p_stripe_customer_id_on_connected_account text DEFAULT NULL::text, p_saved_payment_method_id text DEFAULT NULL::text, p_installment_plan_root boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
  IF v_session.order_id IS NOT NULL THEN RETURN jsonb_build_object('outcome','finalized','replayed',true,'orderId',v_session.order_id); END IF;
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
    RETURN jsonb_build_object('outcome','finalized','replayed',false)||COALESCE(v_result,'{}'::jsonb);
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
  RETURN jsonb_build_object('outcome','finalized','replayed',false)||COALESCE(v_result,'{}'::jsonb);
END $function$;

DO $probe$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='biz_ticket_checkout_finalize';

  -- The already-finalized arm must SAY it replayed. Without this the edge is
  -- back to inferring replay from an absent `tickets` key.
  IF position('''replayed'',true' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2694: the already-finalized arm does not report replayed=true';
  END IF;

  -- BOTH fresh-mint arms must say replayed=false. One unstamped arm and a real
  -- mint reads as a replay, which would make the edge demand possession from
  -- the very buyer who just paid.
  IF (length(v_def) - length(replace(v_def, '''replayed'',false', ''))) / length('''replayed'',false') <> 2 THEN
    RAISE EXCEPTION 'issue #2694: expected exactly 2 fresh-mint arms stamped replayed=false';
  END IF;

  -- The early return must still sit ABOVE the sale-truth gate, or an already
  -- finalized order starts answering `unavailable` again — the #2136 contract.
  IF position('order_id IS NOT NULL' IN v_def) >
     position('issue_1930_event_sale_reason' IN v_def) THEN
    RAISE EXCEPTION 'issue #2694: the idempotent replay no longer precedes the sale-truth gate';
  END IF;

  -- And the paid guard must be untouched.
  IF position('paid_reversal_pending' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2694: the paid reversal arm was lost';
  END IF;
END $probe$;

COMMIT;
