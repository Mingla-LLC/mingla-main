-- Issue #4490, spec 08 O4 fix round 3 (file number 610490): spec 08 §15
-- (Seth, 23 Nov: "Refund the excess").
--
-- When a paid table deposit is larger than the check it is credited on, the
-- check uses only what the bill needs and the EXCESS IS REFUNDED TO THE GUEST,
-- to the deposit's original payment, exactly once, when the check is finished
-- (paid by any method, the last share, or closed with "Close check").
--
-- - What the check applies was already min(deposit, the bill): total due is
--   floored at 0 and every reader of the credit (the funding of offer lines,
--   the service charge payments carry, the projection's creditUsedMinor) uses
--   LEAST(credit, subtotal + service charge), so it follows the bill as lines
--   are added or voided on an open check. Unchanged.
-- - New INTERNAL issue_4490_till_refund_deposit_excess(sale, actor), called
--   once by the one finalizer (issue_4490_till_finalize_paid) under the
--   check's row lock: excess = credit - LEAST(credit, subtotal + service
--   charge). It writes the refund on the SAME rail a cancelled booking's
--   deposit uses: a source_refunds row (source_type venue_reservation,
--   source_id = the deposit's checkout session, subject_id = the booking), the
--   same ledger allocations and requested event, the same provider and
--   original payment reference, picked up by the same source-refund runner and
--   sweep, the same buyer refund notice when it lands. New refund_kind
--   'venue_deposit_excess' (UNIQUE per checkout session by the existing
--   (source_type, source_id, refund_kind) key, idempotency key
--   'venue_deposit_excess:<check>'). No application fee is reversed on the
--   excess (the organiser refunds it from the deposit it received; Mingla's
--   fee on the deposit stands: listed for Seth). A payout of the deposit in
--   flight, or a deposit with no provider reference, never drops the refund:
--   the row is written for ops review (needs_attention) instead of queued.
-- - The refund guard (608490) lets exactly that row through (a
--   transaction-local marker for that booking, set only inside the new
--   function); every other refund of the booking stays refused while the
--   credit is live, and the cancel paths' own "already refunded" check sees
--   the excess row afterwards.
-- - The booking is completed when its check is finished (seated -> completed,
--   quiet, audited), so no cancel can reach it afterwards.
-- - A deposit with no completed checkout session (not paid through Mingla
--   checkout) cannot go back to its payment automatically: its excess is
--   recorded for ops (needs_attention, kind
--   checkout_provider_reference_unresolved, source_id = the booking), never
--   dropped and never blocking the check.
-- - The projection shows staff the deposit refund (depositRefundMinor).
--
-- Re-emits from the latest bodies (608490 guard and finalize; 608490/607490
-- seat; 609490 sale extras), patched in place where small,
-- precondition-counted. The live cancel/refund RPCs are NOT touched;
-- pg_venue_order_finalize_payment is NOT touched. No venue_id column (the
-- #2099 seal is unchanged). Static SQL. Local stack only until Seth approves
-- a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o4f3_patch(
  p_sig regprocedure,
  p_old text,
  p_new text,
  p_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O4 fix 3 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- The refund kind of a deposit's unused part.
ALTER TABLE public.source_refunds DROP CONSTRAINT source_refunds_refund_kind_check;
ALTER TABLE public.source_refunds ADD CONSTRAINT source_refunds_refund_kind_check CHECK (refund_kind = ANY (ARRAY[
  'venue_eligible_cancel'::text, 'rsvp_discretionary'::text, 'event_cancel'::text, 'stay_cancellation'::text,
  'venue_order_guest_cancel'::text, 'venue_order_venue_approved'::text, 'late_payment_no_value'::text,
  'checkout_provider_reference_unresolved'::text, 'venue_staff_cancel'::text, 'venue_till_refund'::text,
  'venue_deposit_excess'::text]));

-- ===========================================================================
-- The refund guard lets the excess refund (and only it) through.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_reservation_deposit_refund_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.reservations r WHERE r.id = NEW.subject_id FOR NO KEY UPDATE;
  -- #4490 08-O4 fix 3 (spec 08 §15): the unused part of a deposit used on a
  -- finished check, written by issue_4490_till_refund_deposit_excess only.
  IF current_setting('mingla.issue_4490_deposit_excess', true) = NEW.subject_id::text
     AND NEW.refund_kind IN ('venue_deposit_excess', 'checkout_provider_reference_unresolved') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_till_lines l
             WHERE l.reservation_id = NEW.subject_id AND l.kind = 'deposit_credit' AND l.state <> 'voided')
     OR EXISTS (SELECT 1 FROM public.reservations r
                WHERE r.id = NEW.subject_id AND r.deposit_applied_sale_id IS NOT NULL) THEN
    RAISE EXCEPTION 'reservation_deposit_used' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- ===========================================================================
-- The excess refund.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_till_refund_deposit_excess(p_sale_id uuid, p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_line public.venue_till_lines%ROWTYPE;
  v_r public.reservations%ROWTYPE;
  v_s public.reservation_checkout_sessions%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE;
  v_excess bigint;
  v_key text;
  v_provider text;
  v_reference text;
  v_release_status text;
  v_problem text;
  v_kind text;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale_id FOR UPDATE;
  SELECT * INTO v_line FROM public.venue_till_lines
  WHERE sale_id = p_sale_id AND kind = 'deposit_credit' AND state IN ('held', 'committed')
  ORDER BY created_at LIMIT 1;
  IF v_sale.id IS NULL OR v_line.id IS NULL THEN
    RETURN NULL;
  END IF;
  v_excess := v_sale.credit_minor - LEAST(v_sale.credit_minor, v_sale.subtotal_minor + v_sale.service_charge_minor);
  IF v_excess <= 0 THEN
    RETURN NULL;
  END IF;
  v_key := 'venue_deposit_excess:' || v_sale.id;
  SELECT * INTO v_refund FROM public.source_refunds WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN v_refund.id;
  END IF;
  SELECT * INTO v_s FROM public.reservation_checkout_sessions
  WHERE reservation_id = v_line.reservation_id AND status = 'completed'
  ORDER BY created_at DESC, id DESC LIMIT 1;
  IF NOT FOUND OR COALESCE(v_s.amount_cents, 0) <= 0 THEN
    -- Not paid through Mingla checkout: owed, recorded for ops, never dropped.
    SELECT * INTO v_r FROM public.reservations WHERE id = v_line.reservation_id FOR UPDATE;
    v_s := NULL;
    v_s.id := v_r.id;
    v_s.brand_id := v_r.brand_id;
    v_s.venue_id := v_r.venue_id;
    v_s.currency := COALESCE(v_r.fee_currency::text, v_sale.currency);
    v_s.amount_cents := GREATEST(COALESCE(v_r.fee_cents, 0), v_excess);
  ELSE
    -- The cancel paths' lock order: source lock, session, booking.
    PERFORM pg_advisory_xact_lock(hashtextextended('venue_reservation:' || v_s.id::text, 0));
    SELECT * INTO v_s FROM public.reservation_checkout_sessions WHERE id = v_s.id FOR UPDATE;
    SELECT * INTO v_r FROM public.reservations WHERE id = v_line.reservation_id FOR UPDATE;
  END IF;
  v_excess := LEAST(v_excess, v_s.amount_cents::bigint);
  -- Never twice: any other refund of this deposit is impossible while it is
  -- credited (the guard); finding one means something is wrong, so stop.
  IF EXISTS (SELECT 1 FROM public.source_refunds sr
             WHERE sr.source_type = 'venue_reservation' AND (sr.source_id = v_s.id OR sr.subject_id = v_r.id)) THEN
    RAISE EXCEPTION 'deposit_already_refunded' USING ERRCODE = 'P0001';
  END IF;
  v_provider := CASE
    WHEN NULLIF(btrim(COALESCE(v_s.stripe_payment_intent_id, '')), '') IS NOT NULL THEN 'stripe'
    WHEN NULLIF(btrim(COALESCE(v_s.paystack_reference, '')), '') IS NOT NULL THEN 'paystack'
  END;
  v_reference := COALESCE(
    NULLIF(btrim(COALESCE(v_s.stripe_payment_intent_id, '')), ''),
    NULLIF(btrim(COALESCE(v_s.paystack_reference, '')), ''));
  -- A payout of this deposit attached but not yet released: ops decide; the
  -- refund is owed and recorded, never queued into a double payment.
  SELECT rel.status INTO v_release_status
  FROM public.payout_release_items i
  JOIN public.brand_payout_releases rel ON rel.id = i.release_id
  WHERE i.source_type = 'venue_reservation' AND i.source_id = v_s.id
  LIMIT 1;
  v_problem := CASE WHEN v_provider IS NULL THEN 'payment_reference_missing'
                    WHEN FOUND AND v_release_status <> 'released' THEN 'payout_in_flight' END;
  v_kind := CASE WHEN v_provider IS NULL THEN 'checkout_provider_reference_unresolved' ELSE 'venue_deposit_excess' END;
  PERFORM set_config('mingla.issue_4490_deposit_excess', v_r.id::text, true);
  INSERT INTO public.source_refunds(
    source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
    requested_by_type, requested_by_user_id, reason, provider, currency,
    original_charge_cents, buyer_refund_requested_cents, original_application_fee_cents,
    fee_reversal_required_cents, fee_state, fee_leg_kind, financial_state,
    organizer_refund_liability_cents, platform_fee_absorption_cents,
    provider_payment_reference, provider_account_reference, idempotency_key,
    buyer_state, ops_status, last_error_code
  ) VALUES (
    'venue_reservation', v_s.id, v_r.id, v_s.brand_id, COALESCE(v_s.venue_id, v_r.venue_id), v_kind,
    'brand_staff', p_actor, 'Table deposit larger than the bill: the rest goes back to the guest',
    COALESCE(v_provider, (SELECT b.payment_provider FROM public.brands b WHERE b.id = v_s.brand_id), 'paystack'),
    upper(v_s.currency), v_s.amount_cents, v_excess, v_s.application_fee_amount_cents,
    0, 'not_required', 'not_required',
    CASE WHEN v_problem IS NULL THEN 'pending' ELSE 'needs_attention' END,
    v_excess, 0, v_reference, v_s.stripe_account_id, v_key,
    CASE WHEN v_problem IS NULL THEN 'queued' ELSE 'needs_attention' END,
    CASE WHEN v_problem IS NULL THEN 'none' ELSE 'needs_review' END,
    v_problem
  ) RETURNING * INTO v_refund;
  PERFORM set_config('mingla.issue_4490_deposit_excess', '', true);
  INSERT INTO public.source_refund_ledger_allocations(
    refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
  ) VALUES (
    v_refund.id, 'buyer_refund', v_refund.buyer_refund_requested_cents,
    v_refund.currency, v_refund.provider, 'prepared',
    'source-refund-allocation:buyer:' || v_refund.id);
  INSERT INTO public.source_refund_ledger_allocations(
    refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
  ) VALUES (
    v_refund.id, 'organizer_refund_liability', v_refund.organizer_refund_liability_cents,
    v_refund.currency, v_refund.provider, 'prepared',
    'source-refund-allocation:organizer:' || v_refund.id);
  INSERT INTO public.source_refund_events(
    refund_id, event_key, event_type, to_state, actor_type, safe_reason_code
  ) VALUES (
    v_refund.id, 'requested:' || v_refund.id, 'requested', v_refund.buyer_state,
    'brand_staff', 'venue_deposit_excess');
  INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, after)
  VALUES (p_actor, v_r.brand_id, 'venue_reservation.deposit_excess_refund', 'reservation', v_r.id::text,
    jsonb_build_object('till_sale_id', v_sale.id, 'deposit_cents', v_sale.credit_minor,
      'used_cents', v_sale.credit_minor - v_excess, 'refund_id', v_refund.id,
      'refund_amount_cents', v_excess, 'refund_state', v_refund.buyer_state));
  RETURN v_refund.id;
END;
$$;

-- ===========================================================================
-- The one finalizer: refund the unused deposit and complete the booking.
-- ===========================================================================
SELECT pg_temp.issue_4490_o4f3_patch(
  'public.issue_4490_till_finalize_paid(uuid,uuid,uuid)'::regprocedure,
  $old$  UPDATE public.venue_till_sales
  SET state = 'paid', business_date = v_day, paid_at = v_now, version = version + 1, updated_at = v_now
  WHERE id = v_sale.id;
END;$old$,
  $new$  -- #4490 08-O4 fix 3 (spec 08 §15): the check used only what the bill
  -- needs; the rest of the deposit goes back to the guest, once. The booking
  -- whose deposit was used is completed (no cancel can reach it now).
  PERFORM public.issue_4490_till_refund_deposit_excess(v_sale.id, v_actor);
  FOR v_line IN
    SELECT l.reservation_id FROM public.venue_till_lines l
    JOIN public.reservations r ON r.id = l.reservation_id AND r.status = 'seated'
    WHERE l.sale_id = v_sale.id AND l.kind = 'deposit_credit' AND l.state = 'committed'
  LOOP
    UPDATE public.reservations SET status = 'completed', updated_at = v_now WHERE id = v_line.reservation_id;
    INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, before, after)
    VALUES (v_actor, v_sale.brand_id, 'venue_reservation.transition', 'reservation', v_line.reservation_id::text,
      jsonb_build_object('status', 'seated'),
      jsonb_build_object('status', 'completed', 'reason', 'check paid at the Till', 'till_sale_id', v_sale.id));
  END LOOP;
  UPDATE public.venue_till_sales
  SET state = 'paid', business_date = v_day, paid_at = v_now, version = version + 1, updated_at = v_now
  WHERE id = v_sale.id;
END;$new$);

-- ===========================================================================
-- Staff see how much of the deposit went back.
-- ===========================================================================
SELECT pg_temp.issue_4490_o4f3_patch(
  'public.issue_4490_till_sale_extras(uuid)'::regprocedure,
  $old$'creditMinor', s.credit_minor,$old$,
  $new$'creditMinor', s.credit_minor,
    'depositRefundMinor', (SELECT sr.buyer_refund_requested_cents FROM public.source_refunds sr
                           WHERE sr.idempotency_key = 'venue_deposit_excess:' || s.id),$new$);

REVOKE ALL ON FUNCTION public.issue_4490_till_refund_deposit_excess(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_till_refund_deposit_excess(uuid, uuid) TO service_role;

COMMIT;
