-- ===========================================================================
-- Issue #3391 — a venue cancelling a paid booking refunds the guest in full.
--
-- Every group CALLS the functions; nothing here decides "it works" by reading
-- source text. One transaction, rolled back at the end.
--
--   A  Stripe: a manager cancels, and the exact refund, ledger legs, event,
--      audit row and guest notice commit together.
--   B  a retry replays the same refund — no second row, leg or event.
--   C  authority: unauthenticated and below-manager callers change nothing.
--   D  Paystack: the same obligation on the Paystack rail, in naira.
--   E  default (a): a seated guest is not auto-refunded.
--   F  a Host build without the OTA (biz_reservation_transition) still refunds.
--   G  every other door is refused: Ari's versioned transition and a direct
--      manager write through RLS. A free booking still cancels.
--   H  one full refund per booking: no venue refund after a guest refund, and
--      the index refuses a second venue-kind row.
--   I  decision 1 is a constraint: an organiser-portion-only row is refused.
--   J  payout, not yet attached: the sweep never attaches the refunded booking
--      (a control booking does attach, so the sweep is really running).
--   K  payout, already released: the organiser's portion becomes a
--      post-release debt.
--   L  payout attached but not released: the cancel refuses.
--   M  the single-refund lease.
--   N  not refundable exactly: a free booking and an unrecorded fee.
--   R  fails on revert: without the guard and the delegation, the old
--      transition cancels a paid booking with no refund at all.
-- ===========================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t3391_fx (k text PRIMARY KEY, v uuid);

DO $seed$
DECLARE
  v_owner   uuid := '00000000-3391-4000-8000-000000000001';
  v_mgr     uuid := '00000000-3391-4000-8000-000000000002';
  v_fin     uuid := '00000000-3391-4000-8000-000000000003';
  v_brand   uuid := '00000000-3391-4000-8000-000000000010';
  v_venue   uuid := '00000000-3391-4000-8000-000000000011';
  v_ngbrand uuid := '00000000-3391-4000-8000-000000000020';
  v_ngvenue uuid := '00000000-3391-4000-8000-000000000021';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'owner-3391@example.test', now(), now()),
    (v_mgr, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'manager-3391@example.test', now(), now()),
    (v_fin, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'finance-3391@example.test', now(), now());
  INSERT INTO public.creator_accounts (id, created_at)
  VALUES (v_owner, now()), (v_mgr, now()), (v_fin, now());

  INSERT INTO public.brands (id, account_id, name, slug, default_currency,
                             payment_provider, payout_hold_cutover_at, created_at, updated_at)
  VALUES
    (v_brand, v_owner, 'Issue 3391 Bistro', 'issue3391bistro', 'USD',
     'stripe', now() - interval '365 days', now(), now()),
    (v_ngbrand, v_owner, 'Issue 3391 Lagos', 'issue3391lagos', 'NGN',
     'paystack', now() - interval '365 days', now(), now());

  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng,
                                     venue_category, claim_status)
  VALUES
    (v_venue, v_brand, 'bistro3391', 'The Bistro', 40.71, -74.00,
     'restaurant', 'verified'),
    (v_ngvenue, v_ngbrand, 'lagos3391', 'The Lagos Room', 6.45, 3.39,
     'restaurant', 'verified');

  UPDATE public.brand_team_members
     SET role = 'brand_owner', accepted_at = coalesce(accepted_at, now())
   WHERE brand_id IN (v_brand, v_ngbrand) AND user_id = v_owner AND removed_at IS NULL;
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  SELECT b, v_owner, 'brand_owner', now(), now()
    FROM unnest(ARRAY[v_brand, v_ngbrand]) b
   WHERE NOT EXISTS (
     SELECT 1 FROM public.brand_team_members m
      WHERE m.brand_id = b AND m.user_id = v_owner AND m.removed_at IS NULL);
  -- A REAL rank-40 event_manager (the manager-plus floor) on both brands, and
  -- a rank-30 finance_manager who must be refused.
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_mgr, 'event_manager', now(), now()),
         (v_ngbrand, v_mgr, 'event_manager', now(), now()),
         (v_brand, v_fin, 'finance_manager', now(), now());

  INSERT INTO t3391_fx VALUES
    ('owner', v_owner), ('manager', v_mgr), ('finance', v_fin),
    ('brand', v_brand), ('venue', v_venue),
    ('ngbrand', v_ngbrand), ('ngvenue', v_ngvenue);
END $seed$;

CREATE OR REPLACE FUNCTION pg_temp.fx(p_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM t3391_fx WHERE k = p_k $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
END $$;

/** A paid booking and its completed checkout, the way the finalize path mints
 *  them (reservations.fee_cents = the session's amount). */
CREATE OR REPLACE FUNCTION pg_temp.paid_booking(
  p_key text,
  p_provider text DEFAULT 'stripe',
  p_status text DEFAULT 'confirmed',
  p_reserved_for timestamptz DEFAULT now() + interval '72 hours',
  p_amount integer DEFAULT 5000,
  p_fee integer DEFAULT 500,
  p_payment_status text DEFAULT 'paid'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_ng boolean := p_provider = 'paystack';
  v_brand uuid := CASE WHEN v_ng THEN pg_temp.fx('ngbrand') ELSE pg_temp.fx('brand') END;
  v_venue uuid := CASE WHEN v_ng THEN pg_temp.fx('ngvenue') ELSE pg_temp.fx('venue') END;
  v_ccy text := CASE WHEN v_ng THEN 'NGN' ELSE 'USD' END;
  v_res uuid; v_ses uuid;
BEGIN
  INSERT INTO public.reservations
    (brand_id, venue_id, reserved_for, party_size, status, payment_status,
     source, created_via, guest_name, guest_email, guest_phone_e164,
     fee_cents, fee_currency, payment_intent_id)
  VALUES (v_brand, v_venue, p_reserved_for, 2, p_status, p_payment_status,
          'website', 'guest', 'Guest ' || p_key, p_key || '-3391@example.test',
          CASE WHEN v_ng THEN '+2348030003391' ELSE '+12015553391' END,
          CASE WHEN p_amount > 0 THEN p_amount END,
          CASE WHEN p_amount > 0 THEN v_ccy END,
          CASE WHEN p_amount > 0 THEN 'pay_3391_' || p_key END)
  RETURNING id INTO v_res;
  IF p_amount > 0 THEN
    INSERT INTO public.reservation_checkout_sessions
      (brand_id, venue_id, reservation_id, reserved_for, party_size,
       buyer_name, buyer_email, buyer_phone_e164, amount_cents, currency,
       created_via, status, application_fee_amount_cents,
       stripe_payment_intent_id, stripe_account_id, paystack_reference)
    VALUES (v_brand, v_venue, v_res, p_reserved_for, 2,
            'Guest ' || p_key, p_key || '-3391@example.test',
            CASE WHEN v_ng THEN '+2348030003391' ELSE '+12015553391' END,
            p_amount, v_ccy, 'web', 'completed', p_fee,
            CASE WHEN v_ng THEN NULL ELSE 'pi_3391_' || p_key END,
            CASE WHEN v_ng THEN NULL ELSE 'acct_3391' END,
            CASE WHEN v_ng THEN 'mingla_resv_3391_' || p_key END)
    RETURNING id INTO v_ses;
    INSERT INTO t3391_fx VALUES ('ses_' || p_key, v_ses);
  END IF;
  INSERT INTO t3391_fx VALUES ('res_' || p_key, v_res);
  RETURN v_res;
END $$;

/** 'SQLSTATE:MESSAGE' for whatever the host cancel lands on, or '<ok>'. */
CREATE OR REPLACE FUNCTION pg_temp.landing_cancel(p_res uuid)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.biz_venue_cancel_paid_reservation(p_res, 'Kitchen fire');
  RETURN '<ok>';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.refund_of(p_res uuid)
RETURNS public.source_refunds LANGUAGE sql STABLE AS $$
  SELECT * FROM public.source_refunds
   WHERE source_type = 'venue_reservation' AND subject_id = p_res
     AND refund_kind = 'venue_staff_cancel'
$$;

/** Drive both provider legs to processed the way the runner records them. */
CREATE OR REPLACE FUNCTION pg_temp.process_refund(p_refund uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v public.source_refunds%ROWTYPE; v_attempt jsonb;
BEGIN
  SELECT * INTO STRICT v FROM public.source_refunds WHERE id = p_refund;
  v_attempt := public.ensure_source_refund_attempt(v.id, 'buyer_refund');
  PERFORM public.record_source_refund_provider_event(
    v.id, 'buyer_refund', (v_attempt->>'attempt_no')::int,
    't3391-buyer:' || v.id, 'worker_reconciliation', 'w3391-buyer:' || v.id,
    'processed', v.buyer_refund_requested_cents, 're_3391_' || left(v.id::text, 8),
    'stripe_verified_refund');
  IF v.fee_reversal_required_cents > 0 THEN
    IF v.provider = 'stripe' THEN
      PERFORM public.set_source_refund_stripe_fee_identity(
        v.id, 'fee_3391' || replace(left(v.id::text, 8), '-', ''),
        v.provider_account_reference, v.original_application_fee_cents);
    END IF;
    v_attempt := public.ensure_source_refund_attempt(v.id, 'application_fee_reversal');
    PERFORM public.record_source_refund_provider_event(
      v.id, 'application_fee_reversal', (v_attempt->>'attempt_no')::int,
      't3391-fee:' || v.id, 'worker_reconciliation', 'w3391-fee:' || v.id,
      'processed', v.fee_reversal_required_cents, 'fr_3391_' || left(v.id::text, 8),
      'stripe_verified_application_fee_refund');
  END IF;
END $$;

-- ===========================================================================
-- A — Stripe. The manager cancels; everything the guest is owed commits.
-- ===========================================================================
DO $group_a$
DECLARE
  v_res uuid := pg_temp.paid_booking('a');
  v_result jsonb;
  v_r public.reservations%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE;
  v_legs jsonb;
  v_payload jsonb;
BEGIN
  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  v_result := public.biz_venue_cancel_paid_reservation(v_res, 'Kitchen fire');

  IF (v_result->>'cancelled') IS DISTINCT FROM 'true'
     OR (v_result->>'replayed') IS DISTINCT FROM 'false'
     OR (v_result->'refund'->>'refund_kind') IS DISTINCT FROM 'venue_staff_cancel'
     OR (v_result->'refund'->>'amount_cents') IS DISTINCT FROM '5000'
     OR (v_result->'refund'->>'currency') IS DISTINCT FROM 'USD'
     OR (v_result->'refund'->>'buyer_state') IS DISTINCT FROM 'queued' THEN
    RAISE EXCEPTION 'A-01 unexpected result: %', v_result;
  END IF;

  SELECT * INTO v_r FROM public.reservations WHERE id = v_res;
  IF v_r.status <> 'cancelled_by_venue' OR v_r.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'A-02 reservation is %/% (expected cancelled_by_venue/paid until the provider confirms)',
      v_r.status, v_r.payment_status;
  END IF;

  v_refund := pg_temp.refund_of(v_res);
  IF v_refund.id IS NULL THEN
    RAISE EXCEPTION 'A-03 no venue_staff_cancel refund row';
  END IF;
  -- Decision 1: the full charge, Mingla's fee included.
  IF v_refund.source_id <> pg_temp.fx('ses_a')
     OR v_refund.original_charge_cents <> 5000
     OR v_refund.buyer_refund_requested_cents <> 5000
     OR v_refund.original_application_fee_cents <> 500
     OR v_refund.fee_reversal_required_cents <> 500
     OR v_refund.organizer_refund_liability_cents <> 4500
     OR v_refund.platform_fee_absorption_cents <> 500
     OR v_refund.provider <> 'stripe'
     OR v_refund.provider_payment_reference <> 'pi_3391_a'
     OR v_refund.provider_account_reference <> 'acct_3391'
     OR v_refund.fee_state <> 'queued'
     OR v_refund.fee_leg_kind <> 'stripe_application_fee_refund'
     OR v_refund.financial_state <> 'pending'
     OR v_refund.requested_by_type <> 'brand_staff'
     OR v_refund.requested_by_user_id <> pg_temp.fx('manager')
     OR v_refund.idempotency_key <> 'venue_staff_cancel:' || pg_temp.fx('ses_a')
     OR v_refund.reason <> 'Kitchen fire' THEN
    RAISE EXCEPTION 'A-04 refund row drifted: %', row_to_json(v_refund);
  END IF;

  -- The guest path's three legs, with its idempotency keys.
  SELECT jsonb_object_agg(allocation_type, jsonb_build_object(
           'amount', amount_cents, 'state', state, 'key', idempotency_key))
    INTO v_legs
    FROM public.source_refund_ledger_allocations WHERE refund_id = v_refund.id;
  IF v_legs IS DISTINCT FROM jsonb_build_object(
       'buyer_refund', jsonb_build_object('amount', 5000, 'state', 'prepared',
         'key', 'source-refund-allocation:buyer:' || v_refund.id),
       'organizer_refund_liability', jsonb_build_object('amount', 4500, 'state', 'prepared',
         'key', 'source-refund-allocation:organizer:' || v_refund.id),
       'platform_application_fee_reversal', jsonb_build_object('amount', 500, 'state', 'prepared',
         'key', 'source-refund-allocation:platform:' || v_refund.id)) THEN
    RAISE EXCEPTION 'A-05 ledger legs drifted: %', v_legs;
  END IF;

  IF (SELECT count(*) FROM public.source_refund_events
       WHERE refund_id = v_refund.id AND event_type = 'requested'
         AND actor_type = 'brand_staff' AND safe_reason_code = 'venue_staff_cancel') <> 1 THEN
    RAISE EXCEPTION 'A-06 expected exactly one brand_staff requested event';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
     WHERE target_id = v_res::text AND action = 'venue_reservation.transition'
       AND user_id = pg_temp.fx('manager')
       AND after->>'refund_id' = v_refund.id::text
       AND after->>'status' = 'cancelled_by_venue') THEN
    RAISE EXCEPTION 'A-07 no audit row names the refund';
  END IF;

  -- The guest's cancellation notice carries the refund.
  SELECT payload INTO v_payload FROM public.notification_outbox
   WHERE category_key = 'buyer_reservation_cancelled'
     AND payload->>'reservation_id' = v_res::text;
  IF v_payload IS NULL
     OR v_payload->>'cancelled_by' IS DISTINCT FROM 'venue'
     OR v_payload->>'refund_amount_cents' IS DISTINCT FROM '5000'
     OR v_payload->>'refund_currency' IS DISTINCT FROM 'USD' THEN
    RAISE EXCEPTION 'A-08 guest notice does not carry the refund: %', v_payload;
  END IF;
END $group_a$;

-- ===========================================================================
-- B — a retry replays. Same refund, nothing duplicated.
-- ===========================================================================
DO $group_b$
DECLARE
  v_res uuid := pg_temp.fx('res_a');
  v_first uuid := (pg_temp.refund_of(pg_temp.fx('res_a'))).id;
  v_result jsonb;
BEGIN
  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  v_result := public.biz_venue_cancel_paid_reservation(v_res, 'Tapped twice');
  IF (v_result->>'replayed') IS DISTINCT FROM 'true'
     OR (v_result->>'cancelled') IS DISTINCT FROM 'true'
     OR (v_result->'refund'->>'refund_id') IS DISTINCT FROM v_first::text THEN
    RAISE EXCEPTION 'B-01 retry did not replay the same refund: %', v_result;
  END IF;
  IF (SELECT count(*) FROM public.source_refunds WHERE subject_id = v_res) <> 1
     OR (SELECT count(*) FROM public.source_refund_ledger_allocations WHERE refund_id = v_first) <> 3
     OR (SELECT count(*) FROM public.source_refund_events WHERE refund_id = v_first) <> 1 THEN
    RAISE EXCEPTION 'B-02 a retry wrote a second refund, leg or event';
  END IF;
END $group_b$;

-- ===========================================================================
-- C — authority. Nothing moves for a caller who may not cancel.
-- ===========================================================================
DO $group_c$
DECLARE
  v_res uuid := pg_temp.paid_booking('c');
  v_landing text;
BEGIN
  PERFORM pg_temp.act_as(NULL);
  v_landing := pg_temp.landing_cancel(v_res);
  IF v_landing NOT LIKE '28000:not_authenticated%' THEN
    RAISE EXCEPTION 'C-01 unauthenticated caller landed on %', v_landing;
  END IF;

  PERFORM pg_temp.act_as(pg_temp.fx('finance'));
  IF public.biz_brand_effective_rank_for_caller(pg_temp.fx('brand'))
       >= public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'C-02 VACUITY: the finance fixture is not below the manager floor';
  END IF;
  v_landing := pg_temp.landing_cancel(v_res);
  IF v_landing NOT LIKE '42501:not_authorized%' THEN
    RAISE EXCEPTION 'C-03 a below-manager member landed on %', v_landing;
  END IF;

  PERFORM pg_temp.act_as(gen_random_uuid());
  v_landing := pg_temp.landing_cancel(v_res);
  IF v_landing NOT LIKE '42501:not_authorized%' THEN
    RAISE EXCEPTION 'C-04 a stranger landed on %', v_landing;
  END IF;

  IF (SELECT status FROM public.reservations WHERE id = v_res) <> 'confirmed'
     OR EXISTS (SELECT 1 FROM public.source_refunds WHERE subject_id = v_res) THEN
    RAISE EXCEPTION 'C-05 a refused caller changed the booking or minted a refund';
  END IF;
END $group_c$;

-- ===========================================================================
-- D — Paystack, in naira.
-- ===========================================================================
DO $group_d$
DECLARE
  v_res uuid := pg_temp.paid_booking('d', 'paystack', 'confirmed',
                                     now() + interval '72 hours', 2500000, 250000);
  v_refund public.source_refunds%ROWTYPE;
BEGIN
  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  PERFORM public.biz_venue_cancel_paid_reservation(v_res, NULL);
  v_refund := pg_temp.refund_of(v_res);
  IF v_refund.id IS NULL
     OR v_refund.provider <> 'paystack'
     OR v_refund.currency <> 'NGN'
     OR v_refund.buyer_refund_requested_cents <> 2500000
     OR v_refund.fee_reversal_required_cents <> 250000
     OR v_refund.organizer_refund_liability_cents <> 2250000
     OR v_refund.fee_leg_kind <> 'paystack_ledger_allocation'
     OR v_refund.provider_payment_reference <> 'mingla_resv_3391_d'
     OR v_refund.provider_account_reference IS NOT NULL
     OR v_refund.reason <> 'Venue cancelled a paid reservation' THEN
    RAISE EXCEPTION 'D-01 Paystack refund drifted: %', row_to_json(v_refund);
  END IF;
  IF (SELECT count(*) FROM public.source_refund_ledger_allocations
       WHERE refund_id = v_refund.id AND provider = 'paystack') <> 3 THEN
    RAISE EXCEPTION 'D-02 Paystack refund is missing ledger legs';
  END IF;
END $group_d$;

-- ===========================================================================
-- E — default (a): a seated guest is not auto-refunded.
-- ===========================================================================
DO $group_e$
DECLARE
  v_res uuid := pg_temp.paid_booking('e', 'stripe', 'seated');
  v_landing text;
  v_row public.reservations%ROWTYPE;
BEGIN
  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  v_landing := pg_temp.landing_cancel(v_res);
  IF v_landing NOT LIKE 'P0001:seated_no_auto_refund%' THEN
    RAISE EXCEPTION 'E-01 seated booking landed on %', v_landing;
  END IF;
  -- The ordinary transition still cancels it, with no refund and no refusal.
  v_row := public.biz_reservation_transition(v_res, 'cancelled_by_venue', NULL, 'Walked out');
  IF v_row.status <> 'cancelled_by_venue'
     OR EXISTS (SELECT 1 FROM public.source_refunds WHERE subject_id = v_res) THEN
    RAISE EXCEPTION 'E-02 seated cancel minted a refund or did not cancel';
  END IF;
END $group_e$;

-- ===========================================================================
-- F — a Host build without the OTA still refunds the guest.
-- ===========================================================================
DO $group_f$
DECLARE
  v_res uuid := pg_temp.paid_booking('f');
  v_row public.reservations%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE;
BEGIN
  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  v_row := public.biz_reservation_transition(v_res, 'cancelled_by_venue', NULL, 'Old build');
  v_refund := pg_temp.refund_of(v_res);
  IF v_row.status <> 'cancelled_by_venue' OR v_refund.id IS NULL
     OR v_refund.buyer_refund_requested_cents <> 5000
     OR v_refund.reason <> 'Old build' THEN
    RAISE EXCEPTION 'F-01 the legacy transition did not refund: status % refund %',
      v_row.status, row_to_json(v_refund);
  END IF;
  -- Other transitions are untouched by the delegation.
  v_res := pg_temp.paid_booking('f2');
  v_row := public.biz_reservation_transition(v_res, 'seated', NULL, NULL);
  IF v_row.status <> 'seated' OR EXISTS (SELECT 1 FROM public.source_refunds WHERE subject_id = v_res) THEN
    RAISE EXCEPTION 'F-02 seating a paid booking changed money';
  END IF;
END $group_f$;

-- ===========================================================================
-- G — every other door fails closed.
-- ===========================================================================
DO $group_g$
DECLARE
  v_paid uuid := pg_temp.paid_booking('g');
  v_ari uuid := pg_temp.paid_booking('g_ari');
  v_free uuid := pg_temp.paid_booking('g_free', 'stripe', 'confirmed',
                                      now() + interval '72 hours', 0, 0, 'none');
  v_version bigint;
  v_err text;
  v_status text;
BEGIN
  PERFORM pg_temp.act_as(pg_temp.fx('manager'));

  -- (1) A manager write straight through the reservations FOR ALL policy.
  v_err := NULL;
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.reservations SET status = 'cancelled_by_venue' WHERE id = v_paid;
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ':' || SQLERRM; END;
  RESET ROLE;
  IF v_err IS NULL OR v_err NOT LIKE 'P0001:paid_venue_cancel_requires_refund%' THEN
    RAISE EXCEPTION 'G-01 a direct write cancelled a paid booking (%)', COALESCE(v_err, 'no error');
  END IF;

  -- (2) Ari's versioned transition.
  SELECT version INTO v_version FROM public.reservations WHERE id = v_ari;
  v_err := NULL;
  BEGIN
    PERFORM public.issue_1975_reservation_transition(v_ari, 'cancelled_by_venue', v_version, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ':' || SQLERRM; END;
  IF v_err IS NULL OR v_err NOT LIKE 'P0001:paid_venue_cancel_requires_refund%' THEN
    RAISE EXCEPTION 'G-02 Ari cancelled a paid booking without a refund (%)', COALESCE(v_err, 'no error');
  END IF;

  IF (SELECT status FROM public.reservations WHERE id = v_paid) <> 'confirmed'
     OR (SELECT status FROM public.reservations WHERE id = v_ari) <> 'confirmed' THEN
    RAISE EXCEPTION 'G-03 a refused door still changed the status';
  END IF;

  -- (3) The guard is about money: a free booking cancels through every door.
  SET LOCAL ROLE authenticated;
  UPDATE public.reservations SET status = 'cancelled_by_venue' WHERE id = v_free;
  RESET ROLE;
  SELECT status INTO v_status FROM public.reservations WHERE id = v_free;
  IF v_status <> 'cancelled_by_venue' THEN
    RAISE EXCEPTION 'G-04 the guard blocked a free booking (status %)', v_status;
  END IF;
END $group_g$;

-- ===========================================================================
-- H — one full refund per booking.
-- ===========================================================================
DO $group_h$
DECLARE
  v_res uuid := pg_temp.paid_booking('h');
  v_landing text;
  v_err text;
  v_guest_refund public.source_refunds%ROWTYPE;
BEGIN
  -- The guest cancels in time first (#1221's own refund).
  UPDATE public.reservation_checkout_sessions
     SET guest_cancel_token_hash = 'v1:' || encode(extensions.digest('tok-3391-h', 'sha256'), 'hex')
   WHERE id = pg_temp.fx('ses_h');
  INSERT INTO public.venue_reservation_settings
    (brand_id, venue_id, reservations_enabled, fee_enabled, fee_refundable, cancel_cutoff_hours)
  VALUES (pg_temp.fx('brand'), pg_temp.fx('venue'), true, true, true, 24)
  ON CONFLICT (venue_id) DO UPDATE SET fee_refundable = true, cancel_cutoff_hours = 24;
  PERFORM public.pg_prepare_guest_venue_cancellation_refund(v_res, 'tok-3391-h');
  SELECT * INTO v_guest_refund FROM public.source_refunds
   WHERE subject_id = v_res AND refund_kind = 'venue_eligible_cancel';
  IF v_guest_refund.id IS NULL THEN
    RAISE EXCEPTION 'H-01 VACUITY: the guest refund fixture did not mint';
  END IF;

  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  v_landing := pg_temp.landing_cancel(v_res);
  IF v_landing NOT LIKE 'P0001:already_refunded%' THEN
    RAISE EXCEPTION 'H-02 a venue refund after a guest refund landed on %', v_landing;
  END IF;

  -- The index, independent of every function: a second venue-kind row on the
  -- same charge is refused outright.
  v_err := NULL;
  BEGIN
    INSERT INTO public.source_refunds(
      source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
      requested_by_type, reason, provider, currency, original_charge_cents,
      buyer_refund_requested_cents, original_application_fee_cents,
      fee_reversal_required_cents, fee_state, fee_leg_kind, financial_state,
      organizer_refund_liability_cents, platform_fee_absorption_cents,
      provider_payment_reference, provider_account_reference, idempotency_key)
    VALUES (
      'venue_reservation', pg_temp.fx('ses_h'), v_res, pg_temp.fx('brand'), pg_temp.fx('venue'),
      'venue_staff_cancel', 'brand_staff', 'Second refund attempt', 'stripe', 'USD',
      5000, 5000, 500, 500, 'queued', 'stripe_application_fee_refund', 'pending',
      4500, 500, 'pi_3391_h', 'acct_3391', 'venue_staff_cancel:h-duplicate');
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  IF v_err IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'H-03 a second full refund row on one charge was accepted (sqlstate %)',
      COALESCE(v_err, 'none');
  END IF;
END $group_h$;

-- ===========================================================================
-- I — decision 1 is a constraint.
-- ===========================================================================
DO $group_i$
DECLARE
  v_res uuid := pg_temp.paid_booking('i');
  v_err text;
BEGIN
  BEGIN
    -- The #2168 shape: organiser's portion only, Mingla keeps its fee.
    INSERT INTO public.source_refunds(
      source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
      requested_by_type, reason, provider, currency, original_charge_cents,
      buyer_refund_requested_cents, original_application_fee_cents,
      fee_reversal_required_cents, fee_state, fee_leg_kind, financial_state,
      organizer_refund_liability_cents, platform_fee_absorption_cents,
      provider_payment_reference, provider_account_reference, idempotency_key)
    VALUES (
      'venue_reservation', pg_temp.fx('ses_i'), v_res, pg_temp.fx('brand'), pg_temp.fx('venue'),
      'venue_staff_cancel', 'brand_staff', 'Organiser portion only', 'stripe', 'USD',
      5000, 4500, 500, 0, 'not_required', 'not_required', 'pending',
      4500, 0, 'pi_3391_i', 'acct_3391', 'venue_staff_cancel:i-partial');
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ':' || SQLERRM; END;
  IF v_err IS NULL OR v_err NOT LIKE '23514:%issue_3391_venue_cancel_makes_whole%' THEN
    RAISE EXCEPTION 'I-01 an organiser-portion venue refund was accepted (%)', COALESCE(v_err, 'no error');
  END IF;
END $group_i$;

-- ===========================================================================
-- J — payout, not yet attached. The refunded booking never enters a release.
-- ===========================================================================
DO $group_j$
DECLARE
  v_control uuid := pg_temp.paid_booking('j_control', 'stripe', 'completed', now() - interval '5 days');
  v_res uuid := pg_temp.paid_booking('j', 'stripe', 'confirmed', now() - interval '5 days');
  v_refund public.source_refunds%ROWTYPE;
BEGIN
  INSERT INTO public.payout_source_fee_snapshots (source_type, source_id, provider_fee_cents)
  VALUES ('venue_reservation', pg_temp.fx('ses_j_control'), 175),
         ('venue_reservation', pg_temp.fx('ses_j'), 175);

  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  PERFORM public.biz_venue_cancel_paid_reservation(v_res, 'Closed for a private event');
  v_refund := pg_temp.refund_of(v_res);

  -- (1) While the refund is open the sweep skips the booking…
  PERFORM public.run_payout_release_dark_sweep(now());
  IF NOT EXISTS (SELECT 1 FROM public.payout_release_items
                  WHERE source_type = 'venue_reservation' AND source_id = pg_temp.fx('ses_j_control')) THEN
    RAISE EXCEPTION 'J-01 VACUITY: the sweep did not attach the un-cancelled control booking';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payout_release_items
              WHERE source_type = 'venue_reservation' AND source_id = pg_temp.fx('ses_j')) THEN
    RAISE EXCEPTION 'J-02 a booking with an open venue refund entered a payout release';
  END IF;

  -- (2) …and once both provider legs are processed it has nothing left to pay.
  PERFORM pg_temp.process_refund(v_refund.id);
  SELECT * INTO v_refund FROM public.source_refunds WHERE id = v_refund.id;
  IF v_refund.financial_state <> 'reconciled'
     OR (SELECT payment_status FROM public.reservations WHERE id = v_res) <> 'refunded' THEN
    RAISE EXCEPTION 'J-03 processed refund did not reconcile (financial %, payment %)',
      v_refund.financial_state, (SELECT payment_status FROM public.reservations WHERE id = v_res);
  END IF;
  PERFORM public.run_payout_release_dark_sweep(now());
  IF EXISTS (SELECT 1 FROM public.payout_release_items
              WHERE source_type = 'venue_reservation' AND source_id = pg_temp.fx('ses_j')) THEN
    RAISE EXCEPTION 'J-04 a fully refunded venue-cancelled booking was paid out to the venue';
  END IF;
  IF EXISTS (SELECT 1 FROM public.source_refund_ledger_allocations
              WHERE refund_id = v_refund.id AND state <> 'posted') THEN
    RAISE EXCEPTION 'J-05 a ledger leg stayed prepared after processing';
  END IF;
END $group_j$;

-- ===========================================================================
-- K — payout already released. The organiser's portion becomes a debt.
-- ===========================================================================
DO $group_k$
DECLARE
  v_res uuid := pg_temp.paid_booking('k', 'stripe', 'confirmed', now() - interval '5 days');
  v_release public.brand_payout_releases%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE;
  v_adjustment public.payout_ledger_adjustments%ROWTYPE;
  v_debt public.organiser_payout_debts%ROWTYPE;
BEGIN
  INSERT INTO public.payout_source_fee_snapshots (source_type, source_id, provider_fee_cents)
  VALUES ('venue_reservation', pg_temp.fx('ses_k'), 175);
  PERFORM public.run_payout_release_dark_sweep(now());
  SELECT r.* INTO v_release
    FROM public.payout_release_items i
    JOIN public.brand_payout_releases r ON r.id = i.release_id
   WHERE i.source_type = 'venue_reservation' AND i.source_id = pg_temp.fx('ses_k');
  IF v_release.id IS NULL THEN
    RAISE EXCEPTION 'K-01 VACUITY: the booking was not attached';
  END IF;
  UPDATE public.brand_payout_releases
     SET status = 'released', released_at = now(),
         organiser_cash_delivered_cents = net_release_cents
   WHERE id = v_release.id
   RETURNING * INTO v_release;

  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  PERFORM public.biz_venue_cancel_paid_reservation(v_res, 'Flooded');
  v_refund := pg_temp.refund_of(v_res);
  IF v_refund.id IS NULL THEN
    RAISE EXCEPTION 'K-02 a booking in a released payout could not be cancelled with a refund';
  END IF;
  PERFORM pg_temp.process_refund(v_refund.id);

  SELECT * INTO v_adjustment FROM public.payout_ledger_adjustments
   WHERE idempotency_key = 'source-refund-liability:' || v_refund.id;
  IF v_adjustment.id IS NULL
     OR v_adjustment.release_id <> v_release.id
     OR v_adjustment.kind <> 'post_release_refund'
     OR v_adjustment.amount_cents <> least(4500, v_release.organiser_cash_delivered_cents) THEN
    RAISE EXCEPTION 'K-03 no post-release recovery of the organiser portion: % (cash delivered %)',
      row_to_json(v_adjustment), v_release.organiser_cash_delivered_cents;
  END IF;
  SELECT * INTO v_debt FROM public.organiser_payout_debts
   WHERE origin_release_id = v_release.id AND kind = 'post_release_refund';
  IF v_debt.id IS NULL OR v_debt.principal_cents <> v_adjustment.amount_cents
     OR v_debt.status <> 'open' THEN
    RAISE EXCEPTION 'K-04 the venue owes nothing after a released payout was refunded: %', row_to_json(v_debt);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.source_refund_ledger_allocations
                  WHERE refund_id = v_refund.id AND allocation_type = 'organizer_refund_liability'
                    AND state = 'posted' AND payout_ledger_adjustment_id = v_adjustment.id) THEN
    RAISE EXCEPTION 'K-05 the organiser leg does not point at the recovery';
  END IF;
END $group_k$;

-- ===========================================================================
-- L — attached but not released. Refuse rather than guess.
-- ===========================================================================
DO $group_l$
DECLARE
  v_res uuid := pg_temp.paid_booking('l', 'stripe', 'confirmed', now() - interval '5 days');
  v_landing text;
BEGIN
  INSERT INTO public.payout_source_fee_snapshots (source_type, source_id, provider_fee_cents)
  VALUES ('venue_reservation', pg_temp.fx('ses_l'), 175);
  PERFORM public.run_payout_release_dark_sweep(now());
  IF NOT EXISTS (SELECT 1 FROM public.payout_release_items i
                   JOIN public.brand_payout_releases r ON r.id = i.release_id
                  WHERE i.source_id = pg_temp.fx('ses_l') AND r.status = 'pending') THEN
    RAISE EXCEPTION 'L-01 VACUITY: the booking is not in a pending release';
  END IF;
  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  v_landing := pg_temp.landing_cancel(v_res);
  IF v_landing NOT LIKE 'P0001:payout_in_flight%' THEN
    RAISE EXCEPTION 'L-02 a booking in an unreleased payout landed on %', v_landing;
  END IF;
  IF (SELECT status FROM public.reservations WHERE id = v_res) <> 'confirmed'
     OR EXISTS (SELECT 1 FROM public.source_refunds WHERE subject_id = v_res) THEN
    RAISE EXCEPTION 'L-03 a refused in-flight cancel changed state';
  END IF;
END $group_l$;

-- ===========================================================================
-- M — the single-refund lease.
-- ===========================================================================
DO $group_m$
DECLARE
  v_res uuid := pg_temp.paid_booking('m');
  v_refund uuid;
  v_first integer;
  v_second integer;
  v_after integer;
BEGIN
  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  PERFORM public.biz_venue_cancel_paid_reservation(v_res, NULL);
  v_refund := (pg_temp.refund_of(v_res)).id;

  SELECT count(*) INTO v_first
    FROM public.issue_3391_claim_source_refund_operation(v_refund, 'host-cancel:one', now());
  SELECT count(*) INTO v_second
    FROM public.issue_3391_claim_source_refund_operation(v_refund, 'host-cancel:two', now());
  IF v_first <> 1 OR v_second <> 0 THEN
    RAISE EXCEPTION 'M-01 lease claimed % then % (expected 1 then 0)', v_first, v_second;
  END IF;
  -- The sweep honours the same lease.
  IF EXISTS (SELECT 1 FROM public.claim_source_refund_operations('sweep:3391', 25, now()) c
              WHERE c.id = v_refund) THEN
    RAISE EXCEPTION 'M-02 the sweep claimed a refund the host action holds';
  END IF;
  -- A stale lease is reclaimable.
  SELECT count(*) INTO v_after
    FROM public.issue_3391_claim_source_refund_operation(v_refund, 'host-cancel:late', now() + interval '11 minutes');
  IF v_after <> 1 THEN
    RAISE EXCEPTION 'M-03 a stale lease was not reclaimable';
  END IF;
  IF has_function_privilege('authenticated',
       'public.issue_3391_claim_source_refund_operation(uuid, text, timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.biz_venue_cancel_paid_reservation(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.biz_venue_cancel_paid_reservation(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M-04 function grants drifted';
  END IF;
END $group_m$;

-- ===========================================================================
-- N — refuse what cannot be refunded exactly.
-- ===========================================================================
DO $group_n$
DECLARE
  v_free uuid := pg_temp.paid_booking('n_free', 'stripe', 'confirmed',
                                      now() + interval '72 hours', 0, 0, 'none');
  v_nofee uuid := pg_temp.paid_booking('n_nofee');
  v_landing text;
BEGIN
  UPDATE public.reservation_checkout_sessions SET application_fee_amount_cents = NULL
   WHERE id = pg_temp.fx('ses_n_nofee');
  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  v_landing := pg_temp.landing_cancel(v_free);
  IF v_landing NOT LIKE 'P0001:not_a_paid_reservation%' THEN
    RAISE EXCEPTION 'N-01 a free booking landed on %', v_landing;
  END IF;
  v_landing := pg_temp.landing_cancel(v_nofee);
  IF v_landing NOT LIKE 'P0001:application_fee_unrecorded%' THEN
    RAISE EXCEPTION 'N-02 an unrecorded fee landed on %', v_landing;
  END IF;
  IF (SELECT status FROM public.reservations WHERE id = v_nofee) <> 'confirmed' THEN
    RAISE EXCEPTION 'N-03 a refused cancel changed the booking';
  END IF;
END $group_n$;

-- ===========================================================================
-- R — fails on revert. Remove the guard and the delegation (derived from the
--     LIVE definition) and the old transition cancels a paid booking with no
--     refund — the #3391 bug, reproduced. Then roll back and prove it again.
-- ===========================================================================
SAVEPOINT issue_3391_revert;
DO $group_r_revert$
DECLARE
  v_def text;
  v_reverted text;
  v_res uuid := pg_temp.paid_booking('r');
  v_row public.reservations%ROWTYPE;
BEGIN
  v_def := pg_get_functiondef('public.biz_reservation_transition(uuid,text,uuid,text)'::regprocedure);
  v_reverted := regexp_replace(v_def, '-- #3391 delegation begin.*-- #3391 delegation end', '', 's');
  IF v_reverted = v_def THEN
    RAISE EXCEPTION 'R-01 VACUITY: the delegation markers were not found';
  END IF;
  EXECUTE v_reverted;
  DROP TRIGGER issue_3391_paid_venue_cancel_requires_refund ON public.reservations;

  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  v_row := public.biz_reservation_transition(v_res, 'cancelled_by_venue', NULL, NULL);
  IF v_row.status <> 'cancelled_by_venue' OR v_row.payment_status <> 'paid'
     OR EXISTS (SELECT 1 FROM public.source_refunds WHERE subject_id = v_res) THEN
    RAISE EXCEPTION 'R-02 the reverted database did not reproduce the no-refund cancel';
  END IF;
END $group_r_revert$;
ROLLBACK TO SAVEPOINT issue_3391_revert;

DO $group_r_restored$
DECLARE
  v_res uuid := pg_temp.paid_booking('r_restored');
  v_row public.reservations%ROWTYPE;
BEGIN
  PERFORM pg_temp.act_as(pg_temp.fx('manager'));
  v_row := public.biz_reservation_transition(v_res, 'cancelled_by_venue', NULL, NULL);
  IF v_row.status <> 'cancelled_by_venue' OR (pg_temp.refund_of(v_res)).id IS NULL THEN
    RAISE EXCEPTION 'R-03 the restored database did not refund';
  END IF;
END $group_r_restored$;

ROLLBACK;
