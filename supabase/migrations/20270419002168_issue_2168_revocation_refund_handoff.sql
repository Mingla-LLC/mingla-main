-- #2168 — checkout revocation: the refund handoff, and the exit from the retry pool.
--
-- `checkout-sale-revocation` refuses `paid_provider_*` rows on purpose: paid
-- evidence is a refund obligation, never ordinary continuation suppression. Its
-- comment says the outbox row "remains visible until the durable
-- attention/source-refund row is reconciled." Nothing ever created that row.
-- Measured on production 2026-08-17: `source_refunds` held ZERO rows, and none
-- of the three queued revocations had one. So the refusal threw, the row became
-- `failed_retryable`, and `issue_1930_record_revocation_result` re-armed it with
-- backoff capped at one hour and NO attempt ceiling — an infinite loop over work
-- only a human can finish, with no human ever told it exists.
--
-- This migration builds the missing handoff. Binding decisions (issue #2168):
--   1. A human authorizes before money moves      -> buyer_state='needs_attention'
--   2. Mingla's queue, not the organiser's        -> ops_status='needs_review'
--   3. A NEW refund_kind, never a reuse           -> see below
--   4. 72-hour resolution deadline                -> issue_2168_escalate_overdue_*
--   5. Buyer receives the ORGANISER'S PORTION     -> Mingla RETAINS its fee
--
-- On (3): `source_refunds` carries UNIQUE (source_type, source_id, refund_kind)
-- and the existing late-payment path inserts ON CONFLICT ... DO UPDATE. One
-- session can legitimately produce BOTH a genuine `late_payment_no_value` refund
-- and one of these; reusing the kind would silently merge two distinct money
-- problems into one row and lose one of them. Reuse is unsafe independent of
-- policy.
--
-- On (5): this DIVERGES from `late_payment_no_value`, which sets
-- platform_fee_absorption_cents = fee and makes the buyer whole. Recorded
-- deliberately on the issue, raised before it was confirmed. Consequence, stated
-- rather than discovered: a buyer who paid and received nothing is left short by
-- the platform fee. Changing it is a new issue, not a correction of this one.

BEGIN;

-- (1) The new kind.
ALTER TABLE public.source_refunds
  DROP CONSTRAINT IF EXISTS source_refunds_refund_kind_check;
ALTER TABLE public.source_refunds
  ADD CONSTRAINT source_refunds_refund_kind_check CHECK (refund_kind = ANY (ARRAY[
    'venue_eligible_cancel','rsvp_discretionary','event_cancel','stay_cancellation',
    'venue_order_guest_cancel','venue_order_venue_approved','late_payment_no_value',
    'checkout_provider_reference_unresolved']));

-- Decision 5 is a CONSTRAINT, not a convention: this kind never absorbs the
-- platform fee. A future edit that quietly makes it whole-amount fails here.
ALTER TABLE public.source_refunds
  DROP CONSTRAINT IF EXISTS source_refunds_issue_2168_fee_retained;
ALTER TABLE public.source_refunds
  ADD CONSTRAINT source_refunds_issue_2168_fee_retained CHECK (
    refund_kind <> 'checkout_provider_reference_unresolved'
    OR (platform_fee_absorption_cents = 0
        AND fee_reversal_required_cents = 0
        AND fee_state = 'not_required'
        AND fee_leg_kind = 'not_required'));

-- `provider_payment_reference` is NOT NULL on `source_refunds`, because every
-- refund kind that existed before this one knows which provider payment it is
-- reversing. This kind is defined by NOT knowing that — "the reference is
-- missing" is the whole condition. The column is therefore made nullable and
-- immediately re-tightened for every OTHER kind, the same shape #2079 already
-- uses at `source_refunds_issue_2079_secondary_identity_shape`.
--
-- Deliberately NOT a sentinel string. A placeholder reference on a money row is
-- one careless join away from being treated as a real provider identity, and
-- sentinel poisoning is an established bug class in this repo. Absence is
-- recorded as absence; the operator's job is precisely to supply it.
ALTER TABLE public.source_refunds
  ALTER COLUMN provider_payment_reference DROP NOT NULL;
ALTER TABLE public.source_refunds
  DROP CONSTRAINT IF EXISTS source_refunds_issue_2168_reference_presence;
ALTER TABLE public.source_refunds
  ADD CONSTRAINT source_refunds_issue_2168_reference_presence CHECK (
    provider_payment_reference IS NOT NULL
    OR refund_kind = 'checkout_provider_reference_unresolved');

-- (2) The handoff. Returns the outcome the worker must then record.
--     'attention_created' -> money is owed; a human decides   -> paid_reversal_pending
--     'no_money'          -> nothing could have moved         -> paid_reversed
CREATE OR REPLACE FUNCTION public.issue_2168_handoff_revocation_attention(
  p_outbox_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
$fn$;

REVOKE ALL ON FUNCTION public.issue_2168_handoff_revocation_attention(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_2168_handoff_revocation_attention(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2168_handoff_revocation_attention(uuid) TO service_role;

-- (4) The 72-hour deadline. An unresolved item nobody is told about is the exact
--     failure this issue exists to prevent, so the deadline has to SPEAK.
CREATE OR REPLACE FUNCTION public.issue_2168_escalate_overdue_revocation_attention()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_n integer;
BEGIN
  UPDATE public.source_refunds
     SET ops_status = 'escalated', updated_at = now()
   WHERE refund_kind = 'checkout_provider_reference_unresolved'
     AND buyer_state = 'needs_attention'
     AND ops_status  = 'needs_review'
     AND requested_at < now() - interval '72 hours';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_2168_escalate_overdue_revocation_attention() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_2168_escalate_overdue_revocation_attention() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2168_escalate_overdue_revocation_attention() TO service_role;

COMMIT;
