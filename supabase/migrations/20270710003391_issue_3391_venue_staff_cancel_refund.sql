-- ===========================================================================
-- Issue #3391 — a guest is refunded when the VENUE cancels their paid booking.
-- ---------------------------------------------------------------------------
-- Before this migration a host could cancel a paid reservation from
-- Reservations and the booking became `cancelled_by_venue` with
-- `payment_status` still `paid`. No refund row was ever created; the #1221
-- control plane only knew the guest-cancels-in-time kind
-- (`venue_eligible_cancel`).
--
-- Seth's decisions (2026-09-15, recorded on #3391):
--   1. The guest is refunded IN FULL, Mingla's fee included. This matches event
--      cancellation and the guest-cancels-in-time rule, and deliberately
--      DIFFERS from #2168 (where Mingla retains its fee).
--   2. Automatic. Cancelling a paid booking refunds; the host has no choice.
-- Defaults applied on Seth's behalf and stated on the PR as confirmable:
--   a. A booking already marked `seated` is NOT auto-refunded.
--   b. Provider processing fees the provider keeps stay on the venue's side.
--      (Stripe direct charges already do this; see the PR for Paystack.)
--   c. The refund is excluded from, or recovered from, the venue's payout the
--      same way #1221 handles a guest refund. Nothing here changes the payout
--      ledger: the sweep's existing "no unreconciled source refund" and
--      "gross minus processed refunds" rules, and
--      issue_1221_post_organizer_refund_liability, are kind-agnostic. The SQL
--      suite proves both halves for this kind.
--
-- What this adds:
--   (1) refund kind `venue_staff_cancel`. A NEW kind, never a reuse: the table
--       carries UNIQUE (source_type, source_id, refund_kind), and a partial
--       unique index below makes "one full refund per venue booking" a
--       database fact across BOTH venue kinds.
--   (2) decision 1 as a CONSTRAINT, the way #2168 pinned its own decision.
--   (3) biz_venue_cancel_paid_reservation — manager-plus SECURITY DEFINER.
--       Cancels the booking and records the refund obligation, ledger legs and
--       requested event in ONE transaction, with the same lock order and the
--       same ledger allocations as pg_prepare_guest_venue_cancellation_refund.
--       A retry returns the same refund (idempotent replay).
--   (4) biz_reservation_transition delegates a paid venue cancel to (3), so a
--       Mingla Host build that has not taken the OTA still refunds the guest.
--   (5) a guard trigger: no other door (Ari's versioned transition, a direct
--       PostgREST write) can cancel a paid, unseated booking without the
--       refund row. It fails closed.
--   (6) issue_3391_claim_source_refund_operation — a single-refund lease so the
--       host's edge action and the */5 sweep never run one refund at once.
--   (7) the guest's cancellation notice carries the refund amount.
--
-- MONOTONIC VERSION 20270710003391: above every version already applied in
-- production when main was merged in (20270708003439_draft_autosave and
-- 20270709000000_unlisted_rsvp_invite_link). Renamed from 20270708003391,
-- which sorted below both; originally 20270706003391. DO NOT run
-- `supabase db push`; apply via the Management API after review. No data is
-- rewritten.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight. The partial unique index in (1b) must not meet a duplicate.
--    Only `venue_eligible_cancel` exists for venue bookings today and it is
--    already unique per session, so this can only fire on a corrupted table.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.source_refunds
     WHERE source_type = 'venue_reservation'
       AND refund_kind IN ('venue_eligible_cancel', 'venue_staff_cancel')
     GROUP BY source_type, source_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'issue_3391_duplicate_venue_cancel_refunds_require_review';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1a. The new kind. The list is #2168's, plus one.
-- ---------------------------------------------------------------------------
ALTER TABLE public.source_refunds
  DROP CONSTRAINT IF EXISTS source_refunds_refund_kind_check;
ALTER TABLE public.source_refunds
  ADD CONSTRAINT source_refunds_refund_kind_check CHECK (refund_kind = ANY (ARRAY[
    'venue_eligible_cancel','rsvp_discretionary','event_cancel','stay_cancellation',
    'venue_order_guest_cancel','venue_order_venue_approved','late_payment_no_value',
    'checkout_provider_reference_unresolved','venue_staff_cancel']));

-- ---------------------------------------------------------------------------
-- 1b. One full refund per venue booking. A guest cancel and a venue cancel are
--     mutually exclusive in the state machine (both are terminal), but money
--     must not rely on that: two rows here would be two full refunds of one
--     charge.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS source_refunds_issue_3391_one_venue_cancel_refund
  ON public.source_refunds (source_type, source_id)
  WHERE source_type = 'venue_reservation'
    AND refund_kind IN ('venue_eligible_cancel', 'venue_staff_cancel');

-- ---------------------------------------------------------------------------
-- 2. Decision 1 is a constraint, not a convention. A later edit that refunds
--    only the organiser's portion (the #2168 rule) fails here.
-- ---------------------------------------------------------------------------
ALTER TABLE public.source_refunds
  DROP CONSTRAINT IF EXISTS source_refunds_issue_3391_venue_cancel_makes_whole;
ALTER TABLE public.source_refunds
  ADD CONSTRAINT source_refunds_issue_3391_venue_cancel_makes_whole CHECK (
    refund_kind <> 'venue_staff_cancel'
    OR (source_type = 'venue_reservation'
        AND requested_by_type = 'brand_staff'
        AND buyer_refund_requested_cents = original_charge_cents
        AND original_application_fee_cents IS NOT NULL
        AND fee_reversal_required_cents = original_application_fee_cents
        AND platform_fee_absorption_cents = original_application_fee_cents));

-- ---------------------------------------------------------------------------
-- 3. The host's cancel.
--
--    Errors are stable literals the edge action maps to HTTP codes:
--      not_authenticated · reservation_not_found · not_authorized
--      not_a_paid_reservation   the booking has no completed paid checkout
--      already_refunded         a refund already exists for this charge
--      seated_no_auto_refund    default (a): a seated guest is not refunded
--      cancel_not_allowed       the status cannot move to cancelled_by_venue
--      payout_in_flight         the money is attached to a payout that has not
--                               been released yet; neither excluding nor
--                               recovering is proven for that window
--      application_fee_unrecorded / payment_reference_missing
--                               the charge cannot be refunded exactly
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_venue_cancel_paid_reservation(
  p_reservation_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand uuid;
  v_r public.reservations%ROWTYPE;
  v_s public.reservation_checkout_sessions%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE;
  v_from text;
  v_provider text;
  v_reference text;
  v_fee integer;
  v_release_status text;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT brand_id INTO v_brand FROM public.reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Refunding is a money act on the same floor a cancel already needs.
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- The charge: the same selection the consumer path uses.
  SELECT * INTO v_s FROM public.reservation_checkout_sessions
   WHERE reservation_id = p_reservation_id AND status = 'completed'
   ORDER BY created_at DESC, id DESC LIMIT 1;
  IF NOT FOUND OR COALESCE(v_s.amount_cents, 0) <= 0 THEN
    RAISE EXCEPTION 'not_a_paid_reservation' USING ERRCODE = 'P0001';
  END IF;

  -- Lock order is the guest path's: source lock, session, reservation. The
  -- payout sweep takes the same source lock before it attaches a booking.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('venue_reservation:' || v_s.id::text, 0)
  );
  SELECT * INTO v_s FROM public.reservation_checkout_sessions
   WHERE id = v_s.id FOR UPDATE;
  SELECT * INTO v_r FROM public.reservations
   WHERE id = p_reservation_id FOR UPDATE;
  v_from := v_r.status;

  -- Idempotent replay: a retry gets the refund it already created.
  SELECT * INTO v_refund FROM public.source_refunds
   WHERE source_type = 'venue_reservation' AND source_id = v_s.id
     AND refund_kind = 'venue_staff_cancel';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'cancelled', v_r.status = 'cancelled_by_venue',
      'replayed', true,
      'refund', public.issue_1221_source_refund_summary(v_refund));
  END IF;

  IF v_r.payment_status = 'refunded' OR EXISTS (
       SELECT 1 FROM public.source_refunds sr
        WHERE sr.source_type = 'venue_reservation'
          AND (sr.source_id = v_s.id OR sr.subject_id = v_r.id)) THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'P0001';
  END IF;
  IF v_r.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'not_a_paid_reservation' USING ERRCODE = 'P0001';
  END IF;
  IF v_from = 'seated' THEN
    RAISE EXCEPTION 'seated_no_auto_refund' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.pg_reservation_transition_is_legal(v_from, 'cancelled_by_venue') THEN
    RAISE EXCEPTION 'cancel_not_allowed' USING ERRCODE = '23514';
  END IF;

  -- Payout. Not attached: the sweep will skip it while the refund is open and
  -- never attach it once the refund is processed. Released: #1221's
  -- post-release liability recovers the organiser's portion. Attached but not
  -- released: refuse rather than guess.
  SELECT rel.status INTO v_release_status
    FROM public.payout_release_items i
    JOIN public.brand_payout_releases rel ON rel.id = i.release_id
   WHERE i.source_type = 'venue_reservation' AND i.source_id = v_s.id
   LIMIT 1;
  IF FOUND AND v_release_status <> 'released' THEN
    RAISE EXCEPTION 'payout_in_flight' USING ERRCODE = 'P0001';
  END IF;

  -- The provider is the charge's own, not whatever the brand uses today.
  v_provider := CASE
    WHEN NULLIF(btrim(COALESCE(v_s.stripe_payment_intent_id, '')), '') IS NOT NULL THEN 'stripe'
    WHEN NULLIF(btrim(COALESCE(v_s.paystack_reference, '')), '') IS NOT NULL THEN 'paystack'
  END;
  v_reference := COALESCE(
    NULLIF(btrim(COALESCE(v_s.stripe_payment_intent_id, '')), ''),
    NULLIF(btrim(COALESCE(v_s.paystack_reference, '')), ''));
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'payment_reference_missing' USING ERRCODE = 'P0001';
  END IF;
  v_fee := v_s.application_fee_amount_cents;
  IF v_fee IS NULL OR v_fee > v_s.amount_cents THEN
    RAISE EXCEPTION 'application_fee_unrecorded' USING ERRCODE = 'P0001';
  END IF;

  v_reason := left(btrim(COALESCE(p_reason, '')), 480);
  IF char_length(v_reason) < 3 THEN
    v_reason := 'Venue cancelled a paid reservation';
  END IF;

  -- The refund row BEFORE the status change, so the guard trigger and the
  -- guest's cancellation notice both see it.
  INSERT INTO public.source_refunds(
    source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
    requested_by_type, requested_by_user_id, reason, provider, currency,
    original_charge_cents, buyer_refund_requested_cents, original_application_fee_cents,
    fee_reversal_required_cents, fee_state, fee_leg_kind, financial_state,
    organizer_refund_liability_cents, platform_fee_absorption_cents,
    provider_payment_reference, provider_account_reference, idempotency_key
  ) VALUES (
    'venue_reservation', v_s.id, v_r.id, v_s.brand_id,
    COALESCE(v_s.venue_id, v_r.venue_id), 'venue_staff_cancel',
    'brand_staff', v_uid, v_reason, v_provider, upper(v_s.currency),
    v_s.amount_cents, v_s.amount_cents, v_fee,
    v_fee,
    CASE WHEN v_fee = 0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee = 0 THEN 'not_required'
         WHEN v_provider = 'stripe' THEN 'stripe_application_fee_refund'
         ELSE 'paystack_ledger_allocation' END,
    'pending',
    v_s.amount_cents - v_fee, v_fee,
    v_reference, v_s.stripe_account_id, 'venue_staff_cancel:' || v_s.id
  ) RETURNING * INTO v_refund;

  -- The same three ledger legs, with the same idempotency keys, as the guest path.
  INSERT INTO public.source_refund_ledger_allocations(
    refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
  ) VALUES (
    v_refund.id, 'buyer_refund', v_refund.buyer_refund_requested_cents,
    v_refund.currency, v_refund.provider, 'prepared',
    'source-refund-allocation:buyer:' || v_refund.id);
  IF v_refund.organizer_refund_liability_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
    ) VALUES (
      v_refund.id, 'organizer_refund_liability', v_refund.organizer_refund_liability_cents,
      v_refund.currency, v_refund.provider, 'prepared',
      'source-refund-allocation:organizer:' || v_refund.id);
  END IF;
  IF v_refund.platform_fee_absorption_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
    ) VALUES (
      v_refund.id, 'platform_application_fee_reversal', v_refund.platform_fee_absorption_cents,
      v_refund.currency, v_refund.provider, 'prepared',
      'source-refund-allocation:platform:' || v_refund.id);
  END IF;
  INSERT INTO public.source_refund_events(
    refund_id, event_key, event_type, to_state, actor_type, safe_reason_code
  ) VALUES (
    v_refund.id, 'requested:' || v_refund.id, 'requested', 'queued',
    'brand_staff', 'venue_staff_cancel');

  UPDATE public.reservations
     SET status = 'cancelled_by_venue', updated_at = now()
   WHERE id = v_r.id
   RETURNING * INTO v_r;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, before, after
  ) VALUES (
    v_uid, v_r.brand_id, 'venue_reservation.transition', 'reservation', v_r.id::text,
    jsonb_build_object('status', v_from),
    jsonb_build_object(
      'status', 'cancelled_by_venue',
      'reason', p_reason,
      'refund_id', v_refund.id,
      'refund_kind', 'venue_staff_cancel',
      'refund_amount_cents', v_refund.buyer_refund_requested_cents,
      'refund_currency', v_refund.currency));

  RETURN jsonb_build_object(
    'cancelled', true,
    'replayed', false,
    'refund', public.issue_1221_source_refund_summary(v_refund));
END;
$function$;

COMMENT ON FUNCTION public.biz_venue_cancel_paid_reservation(uuid, text) IS
  'Issue #3391 — a manager-plus host cancels a PAID venue booking and the guest '
  'is refunded in full, Mingla fee included (venue_staff_cancel). Cancel, refund '
  'row, ledger legs and requested event commit together; a retry replays the '
  'same refund. Seated bookings and bookings in an unreleased payout refuse.';

REVOKE ALL ON FUNCTION public.biz_venue_cancel_paid_reservation(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_venue_cancel_paid_reservation(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_cancel_paid_reservation(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. biz_reservation_transition — restated from
--    20261130000002_orch_1255_ops_rekey.sql (the latest definition). The ONLY
--    change is the delegation block marked #3391: a legal venue cancel of a
--    paid, unseated booking goes through (3) so the guest is refunded, whatever
--    client made the call.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_reservation_transition(
  p_reservation_id uuid,
  p_to_status text,
  p_table_id uuid DEFAULT NULL,      -- optional table (re)assignment on seat
  p_reason text DEFAULT NULL          -- optional operator note (cancellation reason)
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_from text;
  v_brand uuid;
  v_venue uuid;
  v_policy text;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  -- #3391 delegation begin
  -- A paid venue cancel refunds. Read without a row lock: (3) takes the source
  -- lock first, then re-checks every condition under its own locks.
  IF p_to_status = 'cancelled_by_venue' THEN
    SELECT * INTO v_row FROM public.reservations WHERE id = p_reservation_id;
    IF FOUND
       AND v_row.payment_status = 'paid'
       AND v_row.status <> 'seated'
       AND public.pg_reservation_transition_is_legal(v_row.status, 'cancelled_by_venue')
       AND EXISTS (
         SELECT 1 FROM public.reservation_checkout_sessions s
          WHERE s.reservation_id = p_reservation_id
            AND s.status = 'completed' AND s.amount_cents > 0) THEN
      PERFORM public.biz_venue_cancel_paid_reservation(p_reservation_id, p_reason);
      SELECT * INTO v_row FROM public.reservations WHERE id = p_reservation_id;
      RETURN v_row;
    END IF;
  END IF;
  -- #3391 delegation end

  SELECT * INTO v_row FROM public.reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_from := v_row.status;
  v_brand := v_row.brand_id;
  v_venue := v_row.venue_id;

  -- Brand-member gate (manager+), unchanged — one team per brand (D-1).
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Legal-transition enforcement (server-side; the heart of the invariant).
  IF NOT public.pg_reservation_transition_is_legal(v_from, p_to_status) THEN
    RAISE EXCEPTION 'illegal_transition_%_to_%', v_from, p_to_status
      USING ERRCODE = '23514';
  END IF;

  -- D-1 guard, now VENUE-scoped: a (re)assigned table MUST belong to the SAME
  -- venue as the reservation. NULL p_table_id (unassigned) is allowed.
  IF p_table_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.venue_tables
        WHERE id = p_table_id AND venue_id = v_venue
     ) THEN
    RAISE EXCEPTION 'table_brand_mismatch: table % does not belong to venue %',
      p_table_id, v_venue USING ERRCODE = '23514';
  END IF;

  -- no_show RECORDS the forfeit-policy DECISION (NO Stripe capture here).
  -- Settings are PER VENUE now (M3 PK move).
  IF p_to_status = 'no_show' THEN
    SELECT no_show_fee_policy INTO v_policy
      FROM public.venue_reservation_settings WHERE venue_id = v_venue;
  END IF;

  UPDATE public.reservations
     SET status = p_to_status,
         table_id = COALESCE(p_table_id, table_id),
         updated_at = now()
   WHERE id = p_reservation_id
   RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, before, after
  ) VALUES (
    v_uid, v_brand,
    'venue_reservation.transition',
    'reservation', p_reservation_id::text,
    jsonb_build_object('status', v_from),
    jsonb_build_object(
      'status', p_to_status,
      'table_id', v_row.table_id,
      'reason', p_reason,
      'no_show_fee_policy', v_policy
    )
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_reservation_transition(uuid, text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_reservation_transition(uuid, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_reservation_transition(uuid, text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The guard. Every other door onto `cancelled_by_venue` — Ari's versioned
--    issue_1975_reservation_transition, or a manager-plus write straight
--    through the `reservations` FOR ALL policy — is refused for a paid,
--    unseated booking that has no venue_staff_cancel refund row. Fail closed:
--    an error the host can see beats a guest who silently loses their money.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3391_paid_venue_cancel_requires_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status = 'cancelled_by_venue'
     AND OLD.status IS DISTINCT FROM 'cancelled_by_venue'
     AND OLD.status IS DISTINCT FROM 'seated'
     AND OLD.payment_status = 'paid'
     AND EXISTS (
       SELECT 1 FROM public.reservation_checkout_sessions s
        WHERE s.reservation_id = NEW.id
          AND s.status = 'completed' AND s.amount_cents > 0)
     AND NOT EXISTS (
       SELECT 1 FROM public.source_refunds sr
        WHERE sr.source_type = 'venue_reservation'
          AND sr.subject_id = NEW.id
          AND sr.refund_kind = 'venue_staff_cancel') THEN
    RAISE EXCEPTION 'paid_venue_cancel_requires_refund'
      USING ERRCODE = 'P0001',
            HINT = 'Cancel a paid booking with biz_venue_cancel_paid_reservation so the guest is refunded.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3391_paid_venue_cancel_requires_refund() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3391_paid_venue_cancel_requires_refund() FROM anon, authenticated;

DROP TRIGGER IF EXISTS issue_3391_paid_venue_cancel_requires_refund ON public.reservations;
CREATE TRIGGER issue_3391_paid_venue_cancel_requires_refund
  BEFORE UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.issue_3391_paid_venue_cancel_requires_refund();

-- ---------------------------------------------------------------------------
-- 6. One refund, one runner. The host's edge action leases the refund it just
--    created before calling the provider; claim_source_refund_operations (the
--    sweep) already skips a leased row for ten minutes, and the recorder and
--    schedule_source_refund_retry both clear the lease. Stripe idempotency keys
--    and Paystack's reconcile-first create already prevent a double refund;
--    this removes the race rather than relying on the provider to absorb it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3391_claim_source_refund_operation(
  p_refund_id uuid,
  p_worker_id text,
  p_now timestamptz DEFAULT now()
) RETURNS SETOF public.source_refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF char_length(COALESCE(p_worker_id, '')) < 3 OR p_refund_id IS NULL THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  RETURN QUERY
  UPDATE public.source_refunds sr
     SET lease_owner = p_worker_id, leased_at = p_now, updated_at = p_now
   WHERE sr.id = p_refund_id
     AND sr.financial_state <> 'reconciled'
     AND (sr.lease_owner IS NULL OR sr.leased_at < p_now - interval '10 minutes')
     AND (sr.next_retry_at IS NULL OR sr.next_retry_at <= p_now)
  RETURNING sr.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3391_claim_source_refund_operation(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3391_claim_source_refund_operation(uuid, text, timestamptz)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 7. The guest's cancellation notice. Body restated from
--    20270211001529_issue_1529_notification_country_code.sql (the latest
--    definition). The ONLY change is the #3391 block: when the venue cancelled
--    and a venue_staff_cancel refund exists, the payload carries the refund
--    amount so the notice says the money is on its way. Processing vs
--    processed stays with the refund-state notices the runner already sends.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orch_1161_reservation_notify_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_category text;
  v_contact  text;
  v_idem     text;
  v_refund_cents integer;
  v_refund_currency text;
BEGIN
  -- ORCH-1195 — INSERT path: the fee/table reservation is born 'confirmed' (no
  -- requested→confirmed UPDATE ever fires), so the buyer confirmation email MUST be
  -- enqueued here. Anon guests (consumer_user_id NULL) still get the transactional
  -- email — can_send short-circuits on null user_id and the contact resolves to the
  -- guest email/phone, exactly as the UPDATE path does.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'confirmed' THEN
      v_contact := COALESCE(NEW.guest_phone_e164, NEW.guest_email);
      -- STABLE key (no timestamp): one confirmed email per reservation, and a
      -- later requested→confirmed UPDATE on the same row dedups to a no-op.
      v_idem := 'buyer_reservation_confirmed:' || NEW.id::text;

      INSERT INTO public.notification_outbox
        (category_key, user_id, contact, brand_id, payload, idempotency_key,
         country_code)
      VALUES (
        'buyer_reservation_confirmed',
        NEW.consumer_user_id,
        v_contact,
        NEW.brand_id,
        jsonb_build_object(
          'reservation_id',   NEW.id,
          'status',           NEW.status,
          'reserved_for',     NEW.reserved_for,
          'party_size',       NEW.party_size,
          'guest_name',       NEW.guest_name,
          'guest_phone_e164', NEW.guest_phone_e164,
          'guest_email',      NEW.guest_email
        ),
        v_idem,
        -- #1529 — recipient handset country. NULL when the reservation carries
        -- only an email; NULL never means US.
        public.mingla_e164_country(NEW.guest_phone_e164)
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  -- ── UPDATE path (UNCHANGED from ORCH-1161 §7.2) ──
  -- Only enqueue on a real change to status / table / time.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
     AND NEW.reserved_for IS NOT DISTINCT FROM OLD.reserved_for THEN
    RETURN NEW;
  END IF;

  -- Map the transition to a category.
  IF NEW.status IN ('cancelled_by_guest','cancelled_by_venue')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_category := 'buyer_reservation_cancelled';
  ELSIF NEW.status = 'confirmed' AND OLD.status = 'requested' THEN
    v_category := 'buyer_reservation_confirmed';
  ELSE
    v_category := 'buyer_reservation_changed';
  END IF;

  -- #3391 — the venue cancelled a paid booking: say the refund is on its way.
  IF v_category = 'buyer_reservation_cancelled'
     AND NEW.status = 'cancelled_by_venue' THEN
    SELECT sr.buyer_refund_requested_cents, sr.currency
      INTO v_refund_cents, v_refund_currency
      FROM public.source_refunds sr
     WHERE sr.source_type = 'venue_reservation'
       AND sr.subject_id = NEW.id
       AND sr.refund_kind = 'venue_staff_cancel'
     ORDER BY sr.requested_at DESC
     LIMIT 1;
  END IF;

  v_contact := COALESCE(NEW.guest_phone_e164, NEW.guest_email);

  -- For the requested→confirmed UPDATE use the SAME stable confirmed key so it
  -- dedups against the INSERT enqueue above; other transitions keep the per-instant
  -- key (a reservation can legitimately change/cancel more than once).
  IF v_category = 'buyer_reservation_confirmed' THEN
    v_idem := 'buyer_reservation_confirmed:' || NEW.id::text;
  ELSE
    v_idem := v_category || ':' || NEW.id::text || ':'
              || to_char(now(), 'YYYYMMDD"T"HH24MISSMS');
  END IF;

  INSERT INTO public.notification_outbox
    (category_key, user_id, contact, brand_id, payload, idempotency_key,
     country_code)
  VALUES (
    v_category,
    NEW.consumer_user_id,
    v_contact,
    NEW.brand_id,
    jsonb_build_object(
      'reservation_id', NEW.id,
      'status',         NEW.status,
      'reserved_for',   NEW.reserved_for,
      'party_size',     NEW.party_size,
      'guest_name',     NEW.guest_name,
      'guest_phone_e164', NEW.guest_phone_e164,
      'guest_email',    NEW.guest_email
    ) || CASE
      WHEN v_refund_cents IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object(
        'cancelled_by',        'venue',
        'refund_amount_cents', v_refund_cents,
        'refund_currency',     v_refund_currency
      )
    END,
    v_idem,
    -- #1529 — recipient handset country (see the INSERT branch above).
    public.mingla_e164_country(NEW.guest_phone_e164)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.orch_1161_reservation_notify_outbox() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.orch_1161_reservation_notify_outbox() FROM anon;

-- ---------------------------------------------------------------------------
-- Exit checks: the migration fails rather than half-ships.
-- ---------------------------------------------------------------------------
DO $exit$
BEGIN
  IF pg_get_constraintdef((
       SELECT oid FROM pg_constraint
        WHERE conrelid = 'public.source_refunds'::regclass
          AND conname = 'source_refunds_refund_kind_check'))
     NOT LIKE '%venue_staff_cancel%' THEN
    RAISE EXCEPTION 'issue_3391_refund_kind_not_widened';
  END IF;
  IF has_function_privilege('anon',
       'public.biz_venue_cancel_paid_reservation(uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_3391_claim_source_refund_operation(uuid, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3391_function_grants_too_wide';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.reservations'::regclass
       AND tgname = 'issue_3391_paid_venue_cancel_requires_refund'
       AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'issue_3391_guard_trigger_missing';
  END IF;
END
$exit$;

COMMIT;
