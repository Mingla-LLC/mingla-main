-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.2a — guest reservation writer + cancel RPCs ⭐
-- ---------------------------------------------------------------------------
-- The atomic GUEST/CONSUMER reservation write path (SPEC §4.A.3 + §4.A.5). The
-- existing operator RPCs (biz_reservation_create / biz_reservation_transition)
-- HARD-GATE on biz_brand_effective_rank_for_caller >= event_manager, so a guest
-- (anon) or a normal consumer (no brand role) CANNOT call them. 2.2 needs a
-- distinct, guarded guest writer:
--
--   pg_create_guest_reservation — SECURITY DEFINER, service_role ONLY. The
--     venue-reservation-create edge fn (service-role) is the only caller. It:
--       1. asserts the venue is reservable (else venue_not_reservable);
--       2. RE-VALIDATES the slot against pg_venue_available_slots at WRITE time
--          (anti-double-book) — the requested instant must match a returned
--          slot whose is_full=false; uses a per-(brand,slot) advisory lock so
--          two racers for the last seat serialize and the second recomputes
--          remaining=0 → slot_unavailable;
--       3. ENFORCES capacity rules server-side — party_fit (covered by the
--          re-validation, since the engine only returns slots a table can seat)
--          + deposit_threshold (a deposit-required party MUST carry a paid fee;
--          a free write for such a party → deposit_required);
--       4. INSERTs the reservations row with the supplied identity/fee fields;
--       5. writes an audit_log row;
--       6. RETURNs the row.
--
--   pg_cancel_guest_reservation — SECURITY DEFINER, service_role ONLY. The web
--     cancel-from-link (token-gated) + the edge cancel seam. Honors
--     cancel_cutoff_hours; transitions to cancelled_by_guest; flags
--     refund_eligible (deposit paid + refundable + before cutoff). Does NOT
--     execute the refund — the edge fn reuses refund-order (fee model = charge
--     upfront, refund-before-cutoff / forfeit-after).
--
--   pg_cancel_my_reservation — SECURITY DEFINER, authenticated. The signed-in
--     consumer cancels their OWN reservation (consumer_user_id = auth.uid()).
--     Same cutoff/refund-eligibility logic; returns the row + refund_eligible.
--
-- INVARIANTS (DRAFT — orchestrator flips ACTIVE on CLOSE):
--   I-PROPOSED-1148-RESERVATION-WRITE-REVALIDATES-SLOT — the guest writer
--     rejects any reserved_for that is not a currently-available engine slot
--     (no fabricated availability, no double-book).
--   I-PROPOSED-1148-GUEST-FEE-VIA-SHARED-ALL-IN-ENGINE — a deposit/fee
--     reservation is only created with payment_status='paid' (the edge fn rode
--     the shared all-in engine + ticket-checkout-create money path); the guest
--     writer REJECTS a free write when a deposit threshold applies.
--
-- The auto-grant gotcha: Supabase's public-schema default privileges auto-GRANT
-- EXECUTE to PUBLIC + anon on every new function. These guest writers are
-- service-role-only (or authenticated for the consumer-own cancel), so REVOKE
-- PUBLIC + anon (+ authenticated where service-role-only) explicitly.
--
-- Additive-only; $function$ closed BEFORE each GRANT block; new identities (no
-- DROP needed). MONOTONIC VERSION 20261012000003. Apply via the Management API.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- pg_create_guest_reservation — the atomic guest/consumer writer (service-role).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_create_guest_reservation(
  p_brand_id uuid,
  p_reserved_for timestamptz,
  p_party_size int,
  p_source text,                 -- 'mingla' (app) | 'website' (anon web)
  p_created_via text,            -- 'consumer' (signed-in) | 'guest' (anon)
  p_consumer_user_id uuid,       -- set when created_via='consumer'; else NULL
  p_guest_name text,
  p_guest_phone_e164 text,
  p_guest_email text,
  p_fee_cents int,               -- NULL/0 for free; >0 for a paid fee/deposit
  p_fee_currency char(3),
  p_payment_intent_id text,
  p_payment_status text,         -- 'none' (free) | 'paid' (fee charged upfront)
  p_guest_cancel_token text,     -- web cancel-link token (NULL for app)
  p_occasion text DEFAULT NULL,
  p_guest_notes text DEFAULT NULL,
  p_status text DEFAULT 'confirmed'
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_enabled boolean;
  v_place_pool_id uuid;
  v_tz text;
  v_slot_date date;
  v_slot_ok boolean;
  v_deposit_required boolean := false;
  v_lock_key bigint;
BEGIN
  -- Validate the discriminators up front (the edge fn validates buyer fields).
  IF p_brand_id IS NULL OR p_reserved_for IS NULL OR p_party_size IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF p_party_size < 1 OR p_party_size > 100 THEN
    RAISE EXCEPTION 'invalid_party_size' USING ERRCODE = '23514';
  END IF;
  IF p_source NOT IN ('mingla', 'website') THEN
    RAISE EXCEPTION 'invalid_source_%', p_source USING ERRCODE = '23514';
  END IF;
  IF p_created_via NOT IN ('consumer', 'guest') THEN
    RAISE EXCEPTION 'invalid_created_via_%', p_created_via USING ERRCODE = '23514';
  END IF;
  IF p_status NOT IN ('requested', 'confirmed') THEN
    RAISE EXCEPTION 'invalid_initial_status_%', p_status USING ERRCODE = '23514';
  END IF;
  IF p_payment_status NOT IN ('none', 'paid') THEN
    RAISE EXCEPTION 'invalid_payment_status_%', p_payment_status USING ERRCODE = '23514';
  END IF;

  -- (1) The venue must be reservable + have an availability config.
  SELECT reservations_enabled, place_pool_id
    INTO v_enabled, v_place_pool_id
  FROM public.venue_reservation_settings
  WHERE brand_id = p_brand_id;
  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;
  SELECT iana_timezone INTO v_tz
  FROM public.venue_availability_config
  WHERE brand_id = p_brand_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;
  v_tz := NULLIF(btrim(COALESCE(v_tz, '')), '');
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  -- ANTI-DOUBLE-BOOK: a transaction-level advisory lock keyed on
  -- (brand_id, reserved_for) serializes two racers for the last seat of the
  -- same slot. The second waiter blocks until the first commits, then its
  -- engine re-read below sees remaining=0 → slot_unavailable. The lock is
  -- released automatically at txn end. hashtextextended gives a stable bigint
  -- from the brand+instant key.
  v_lock_key := hashtextextended(p_brand_id::text || '|' || p_reserved_for::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- (2) RE-VALIDATE the slot against the engine AT WRITE TIME. The requested
  -- instant must be a returned, non-full slot for this party on the venue-local
  -- date. The engine's `remaining` is computed live from reservations, so under
  -- the advisory lock the second racer recomputes after the first commits and
  -- sees is_full → rejected. This also covers party_fit (the engine only emits
  -- slots a reservable table can seat for this party) — capacity enforcement is
  -- in the DB, not just the UI. I-PROPOSED-1148-RESERVATION-WRITE-REVALIDATES-SLOT.
  v_slot_date := (p_reserved_for AT TIME ZONE v_tz)::date;
  SELECT EXISTS (
    SELECT 1
    FROM public.pg_venue_available_slots(p_brand_id, v_slot_date, p_party_size) s
    WHERE s.slot_start_utc = p_reserved_for
      AND s.is_full = false
      AND s.remaining > 0
  ) INTO v_slot_ok;
  IF NOT v_slot_ok THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- (3) deposit_threshold capacity rule (server-side). If an active
  -- deposit_threshold rule's min_party_for_fee <= party_size, the reservation
  -- MUST carry a paid fee. A free write for a deposit-required party is
  -- REJECTED → deposit_required. I-PROPOSED-1148-GUEST-FEE-VIA-SHARED-ALL-IN-ENGINE.
  SELECT EXISTS (
    SELECT 1
    FROM public.venue_capacity_rules cr
    WHERE cr.brand_id = p_brand_id
      AND cr.is_active
      AND cr.kind = 'deposit_threshold'
      AND COALESCE((cr.params->>'min_party_for_fee')::int, 1) <= p_party_size
  ) INTO v_deposit_required;
  IF v_deposit_required
     AND (p_payment_status <> 'paid' OR COALESCE(p_fee_cents, 0) <= 0) THEN
    RAISE EXCEPTION 'deposit_required' USING ERRCODE = 'P0001';
  END IF;

  -- (4) INSERT the reservation row (place_pool resolved from settings).
  INSERT INTO public.reservations (
    brand_id, place_pool_id, reserved_for, party_size, status, source,
    created_via, guest_name, guest_phone_e164, guest_email, consumer_user_id,
    occasion, guest_notes, fee_cents, fee_currency, payment_intent_id,
    payment_status, guest_cancel_token
  ) VALUES (
    p_brand_id, v_place_pool_id, p_reserved_for, p_party_size, p_status, p_source,
    p_created_via, p_guest_name, p_guest_phone_e164, p_guest_email,
    p_consumer_user_id, p_occasion, p_guest_notes,
    NULLIF(COALESCE(p_fee_cents, 0), 0), p_fee_currency, p_payment_intent_id,
    p_payment_status, p_guest_cancel_token
  ) RETURNING * INTO v_row;

  -- (5) Audit (append-only; runs as definer = privileged). user_id is NULL for
  -- anon guests; the consumer's auth uid is on consumer_user_id (the row), not
  -- here, because this fn runs under service-role (auth.uid() is NULL).
  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    p_consumer_user_id, p_brand_id,
    'venue_reservation.guest_create',
    'reservation', v_row.id,
    jsonb_build_object(
      'source', p_source, 'created_via', p_created_via,
      'party_size', p_party_size, 'reserved_for', p_reserved_for,
      'fee_cents', NULLIF(COALESCE(p_fee_cents, 0), 0),
      'payment_status', p_payment_status, 'status', p_status
    )
  );

  RETURN v_row;
END;
$function$;

-- service_role ONLY (the edge fn). REVOKE PUBLIC + anon + authenticated so a
-- client cannot forge a free reservation on a fee venue (the boundary that
-- I-PROPOSED-1148-GUEST-FEE-VIA-SHARED-ALL-IN-ENGINE rests on).
REVOKE ALL ON FUNCTION public.pg_create_guest_reservation(uuid, timestamptz, int, text, text, uuid, text, text, text, int, char, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_create_guest_reservation(uuid, timestamptz, int, text, text, uuid, text, text, text, int, char, text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pg_create_guest_reservation(uuid, timestamptz, int, text, text, uuid, text, text, text, int, char, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pg_create_guest_reservation(uuid, timestamptz, int, text, text, uuid, text, text, text, int, char, text, text, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Shared cutoff/refund-eligibility helper (pure-ish; reads settings). Returns
-- whether a cancel is BEFORE the cancellation cutoff for a given reservation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_reservation_before_cancel_cutoff(
  p_reserved_for timestamptz,
  p_cancel_cutoff_hours int
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  -- before cutoff iff now() is earlier than (reserved_for - cutoff_hours).
  SELECT now() < (p_reserved_for - make_interval(hours => COALESCE(p_cancel_cutoff_hours, 0)));
$function$;
REVOKE ALL ON FUNCTION public.pg_reservation_before_cancel_cutoff(timestamptz, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_reservation_before_cancel_cutoff(timestamptz, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_reservation_before_cancel_cutoff(timestamptz, int) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pg_cancel_guest_reservation — web cancel-from-link (token-gated, service-role).
-- Returns the row + refund_eligible (does NOT execute the refund; the edge fn
-- reuses refund-order when refund_eligible is true).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_cancel_guest_reservation(
  p_reservation_id uuid,
  p_guest_cancel_token text
) RETURNS TABLE (reservation public.reservations, refund_eligible boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_cutoff int;
  v_refundable boolean;
  v_before_cutoff boolean;
  v_refund_eligible boolean := false;
BEGIN
  IF p_reservation_id IS NULL OR p_guest_cancel_token IS NULL
     OR btrim(p_guest_cancel_token) = '' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.reservations
  WHERE id = p_reservation_id
    AND guest_cancel_token = p_guest_cancel_token
  FOR UPDATE;
  IF NOT FOUND THEN
    -- wrong token or unknown id → indistinguishable (no oracle).
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Only a non-terminal reservation can be cancelled by the guest.
  IF NOT public.pg_reservation_transition_is_legal(v_row.status, 'cancelled_by_guest') THEN
    RAISE EXCEPTION 'cancel_not_allowed_from_%', v_row.status USING ERRCODE = '23514';
  END IF;

  SELECT cancel_cutoff_hours, fee_refundable INTO v_cutoff, v_refundable
  FROM public.venue_reservation_settings WHERE brand_id = v_row.brand_id;
  v_before_cutoff := public.pg_reservation_before_cancel_cutoff(v_row.reserved_for, COALESCE(v_cutoff, 0));
  -- refund eligible = a paid deposit + refundable policy + cancel BEFORE cutoff.
  v_refund_eligible := (v_row.payment_status = 'paid'
                        AND COALESCE(v_refundable, false)
                        AND v_before_cutoff);

  UPDATE public.reservations
     SET status = 'cancelled_by_guest', updated_at = now()
   WHERE id = p_reservation_id
   RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, before, after
  ) VALUES (
    v_row.consumer_user_id, v_row.brand_id,
    'venue_reservation.guest_cancel',
    'reservation', p_reservation_id,
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object('status', 'cancelled_by_guest',
                       'before_cutoff', v_before_cutoff,
                       'refund_eligible', v_refund_eligible)
  );

  reservation := v_row;
  refund_eligible := v_refund_eligible;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.pg_cancel_guest_reservation(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_cancel_guest_reservation(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pg_cancel_guest_reservation(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pg_cancel_guest_reservation(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- pg_cancel_my_reservation — the signed-in consumer cancels their OWN row
-- (consumer_user_id = auth.uid()). authenticated-callable. Returns the row +
-- refund_eligible (flags only; the edge fn executes the refund via refund-order).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_cancel_my_reservation(
  p_reservation_id uuid
) RETURNS TABLE (reservation public.reservations, refund_eligible boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_uid uuid := auth.uid();
  v_cutoff int;
  v_refundable boolean;
  v_before_cutoff boolean;
  v_refund_eligible boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM public.reservations
  WHERE id = p_reservation_id AND consumer_user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.pg_reservation_transition_is_legal(v_row.status, 'cancelled_by_guest') THEN
    RAISE EXCEPTION 'cancel_not_allowed_from_%', v_row.status USING ERRCODE = '23514';
  END IF;

  SELECT cancel_cutoff_hours, fee_refundable INTO v_cutoff, v_refundable
  FROM public.venue_reservation_settings WHERE brand_id = v_row.brand_id;
  v_before_cutoff := public.pg_reservation_before_cancel_cutoff(v_row.reserved_for, COALESCE(v_cutoff, 0));
  v_refund_eligible := (v_row.payment_status = 'paid'
                        AND COALESCE(v_refundable, false)
                        AND v_before_cutoff);

  UPDATE public.reservations
     SET status = 'cancelled_by_guest', updated_at = now()
   WHERE id = p_reservation_id
   RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, before, after
  ) VALUES (
    v_uid, v_row.brand_id,
    'venue_reservation.consumer_cancel',
    'reservation', p_reservation_id,
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object('status', 'cancelled_by_guest',
                       'before_cutoff', v_before_cutoff,
                       'refund_eligible', v_refund_eligible)
  );

  reservation := v_row;
  refund_eligible := v_refund_eligible;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.pg_cancel_my_reservation(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_cancel_my_reservation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_cancel_my_reservation(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- resolve_brand_pricing_inputs — the BRAND-scoped pricing resolver for the
-- reservation FEE path (SPEC §4.B). reservations are brand-scoped, so the
-- event-scoped resolve_event_pricing_inputs cannot serve them. This mirrors it
-- BRAND-side: the reservation pass_*_override on venue_reservation_settings
-- takes PRECEDENCE over the brand defaults (else NULL → inherit brand default),
-- + the brand region/currency/take-rate/charge-readiness/provider. SECURITY
-- DEFINER, service-role-only (the edge fn). No buyer tax form — tax stays
-- venue-sourced server-side via the brand's region behavior.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_brand_pricing_inputs(p_brand_id uuid)
RETURNS TABLE (
  pass_tax boolean,
  pass_mingla_fee boolean,
  pass_service_fee boolean,
  pricing_region text,
  pricing_currency text,
  effective_take_rate_bps integer,
  take_rate_source text,
  stripe_account_id text,
  stripe_charges_enabled boolean,
  payment_provider text,
  payment_country text,
  paystack_subaccount_code text,
  vat_rate_bps integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- reservation override (settings) wins; else brand default.
    COALESCE(s.pass_tax_override,  b.default_pass_tax)         AS pass_tax,
    COALESCE(s.pass_fee_override,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
    COALESCE(s.pass_fee_override,  b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region                                          AS pricing_region,
    b.pricing_currency                                        AS pricing_currency,
    r.effective_take_rate_bps                                 AS effective_take_rate_bps,
    r.take_rate_source                                        AS take_rate_source,
    b.stripe_connect_id                                       AS stripe_account_id,
    b.stripe_charges_enabled                                  AS stripe_charges_enabled,
    b.payment_provider                                        AS payment_provider,
    b.payment_country                                         AS payment_country,
    b.paystack_subaccount_code                                AS paystack_subaccount_code,
    v.vat_rate_bps                                            AS vat_rate_bps
  FROM public.brands b
  LEFT JOIN public.venue_reservation_settings s ON s.brand_id = b.id
  CROSS JOIN LATERAL public.resolve_effective_take_rate_bps(b.id) r
  LEFT JOIN public.country_vat_config v ON v.country = b.payment_country
  WHERE b.id = p_brand_id;
$$;
REVOKE ALL ON FUNCTION public.resolve_brand_pricing_inputs(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_brand_pricing_inputs(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_brand_pricing_inputs(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_brand_pricing_inputs(uuid) TO service_role;

COMMIT;
