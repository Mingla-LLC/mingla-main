-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1b — D-1 fix: same-brand table_id validation
-- ---------------------------------------------------------------------------
-- The 2.1b lifecycle RPCs (biz_reservation_transition, biz_reservation_create)
-- and the waitlist convert (biz_waitlist_convert_to_reservation) accepted a
-- p_table_id with NO check that the target venue_tables row belongs to the SAME
-- brand as the reservation/caller. The reservations.table_id FK references
-- venue_tables GLOBALLY (not brand-scoped), so a Brand-A manager could stamp
-- Brand-B's table_id onto a Brand-A reservation → cross-tenant corruption of the
-- occupancy/table model the 2.1a availability engine reads. PROVEN LIVE by the
-- tester (TEST_META-ORCH-1148_SUBB_2_1B.md findings B + C4).
--
-- FIX: in every RPC that sets/updates reservations.table_id, when p_table_id IS
-- NOT NULL, validate EXISTS(venue_tables WHERE id = p_table_id AND brand_id =
-- <the reservation's brand>). RAISE 'table_brand_mismatch' (ERRCODE 23514,
-- check_violation) otherwise. NULL p_table_id (unassigned) stays allowed.
--
-- These are CREATE OR REPLACE re-emits of the EXACT 2.1b bodies with ONLY the
-- brand-scope guard added. SECURITY DEFINER + manager+ gate + audit + the
-- lifecycle matrix + atomicity are all preserved verbatim. The Supabase
-- auto-GRANT-to-PUBLIC/anon gotcha is re-handled (REVOKE PUBLIC + anon, GRANT
-- authenticated) for every re-emitted function. No money/checkout/engine file
-- touched. Manual operator bookings remain FREE.
--
-- I-PROPOSED-1148-RESERVATION-TABLE-SAME-BRAND: a table_id from a DIFFERENT brand
-- is REJECTED in create / transition / convert. A revert of any guard lets the
-- cross-brand injection succeed and FAILs the adversarial harness (findings B/C4).
--
-- Additive-only (CREATE OR REPLACE, no DROP needed — same identities/signatures).
-- $function$ closed BEFORE each GRANT. MONOTONIC VERSION 20261011000000 — strictly
-- greater than the current max prefix across anchor main (20261002000000) + every
-- sibling worktree (the 2.1b chain through 20261010000003). Apply via the Supabase
-- Management API after REVIEW. NOT applied to prod by the implementor.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- biz_reservation_transition — adds the same-brand table_id guard on (re)assign.
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
  v_policy text;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM public.reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_from := v_row.status;
  v_brand := v_row.brand_id;

  -- Brand-member gate (manager+). biz_brand_effective_rank_for_caller is
  -- SECURITY DEFINER and resolves the caller via auth.uid() — works inside this
  -- SECURITY DEFINER fn because the JWT is still on the request.
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Legal-transition enforcement (server-side; the heart of the invariant).
  IF NOT public.pg_reservation_transition_is_legal(v_from, p_to_status) THEN
    RAISE EXCEPTION 'illegal_transition_%_to_%', v_from, p_to_status
      USING ERRCODE = '23514';
  END IF;

  -- D-1: cross-brand table_id injection guard. A (re)assigned table MUST belong
  -- to the SAME brand as the reservation. NULL p_table_id (unassigned) is allowed.
  IF p_table_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.venue_tables
        WHERE id = p_table_id AND brand_id = v_brand
     ) THEN
    RAISE EXCEPTION 'table_brand_mismatch: table % does not belong to brand %',
      p_table_id, v_brand USING ERRCODE = '23514';
  END IF;

  -- no_show RECORDS the forfeit-policy DECISION (NO Stripe capture here — 2.2 seam).
  IF p_to_status = 'no_show' THEN
    SELECT no_show_fee_policy INTO v_policy
      FROM public.venue_reservation_settings WHERE brand_id = v_brand;
  END IF;

  UPDATE public.reservations
     SET status = p_to_status,
         -- table assignment is allowed on seat (or any non-cancel transition).
         table_id = COALESCE(p_table_id, table_id),
         -- preserve a free-form operator note in guest_notes-adjacent column;
         -- we DO NOT clobber guest_notes — the reason is appended as a tag-free
         -- audit detail only (kept in audit_log.after). No new column needed.
         updated_at = now()
   WHERE id = p_reservation_id
   RETURNING * INTO v_row;

  -- Audit (append-only; service-defined fn runs as definer = privileged).
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
-- biz_reservation_create — adds the same-brand table_id guard on initial assign.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_reservation_create(
  p_brand_id uuid,
  p_reserved_for timestamptz,
  p_party_size int,
  p_source text DEFAULT 'phone',
  p_guest_name text DEFAULT NULL,
  p_guest_phone_e164 text DEFAULT NULL,
  p_guest_email text DEFAULT NULL,
  p_table_id uuid DEFAULT NULL,
  p_occasion text DEFAULT NULL,
  p_guest_notes text DEFAULT NULL,
  p_tags text[] DEFAULT '{}'::text[],
  p_status text DEFAULT 'confirmed'
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- A manual booking starts in a non-terminal, sensible state only.
  IF p_status NOT IN ('requested','confirmed','seated') THEN
    RAISE EXCEPTION 'invalid_initial_status_%', p_status USING ERRCODE = '23514';
  END IF;
  IF p_source NOT IN ('mingla','phone','walk_in','website','instagram') THEN
    RAISE EXCEPTION 'invalid_source_%', p_source USING ERRCODE = '23514';
  END IF;

  -- D-1: cross-brand table_id injection guard. An assigned table MUST belong to
  -- the SAME brand as the reservation being created. NULL p_table_id is allowed.
  IF p_table_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.venue_tables
        WHERE id = p_table_id AND brand_id = p_brand_id
     ) THEN
    RAISE EXCEPTION 'table_brand_mismatch: table % does not belong to brand %',
      p_table_id, p_brand_id USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.reservations (
    brand_id, reserved_for, party_size, status, source, created_via,
    guest_name, guest_phone_e164, guest_email, table_id, occasion,
    guest_notes, tags
  ) VALUES (
    p_brand_id, p_reserved_for, p_party_size, p_status, p_source, 'operator',
    p_guest_name, p_guest_phone_e164, p_guest_email, p_table_id, p_occasion,
    p_guest_notes, COALESCE(p_tags, '{}'::text[])
  ) RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    v_uid, p_brand_id,
    'venue_reservation.create',
    'reservation', v_row.id::text,
    jsonb_build_object(
      'source', p_source, 'party_size', p_party_size,
      'reserved_for', p_reserved_for, 'status', p_status, 'created_via', 'operator'
    )
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_reservation_create(uuid, timestamptz, int, text, text, text, text, uuid, text, text, text[], text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_reservation_create(uuid, timestamptz, int, text, text, text, text, uuid, text, text, text[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_reservation_create(uuid, timestamptz, int, text, text, text, text, uuid, text, text, text[], text) TO authenticated;

-- ---------------------------------------------------------------------------
-- biz_waitlist_convert_to_reservation — adds the same-brand table_id guard on
-- the convert's table assignment (the converted reservation's brand = waitlist
-- brand). Atomicity (single txn: create reservation + mark waitlist converted)
-- preserved verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_waitlist_convert_to_reservation(
  p_waitlist_id uuid,
  p_reserved_for timestamptz,
  p_table_id uuid DEFAULT NULL
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_wait public.venue_waitlist;
  v_res public.reservations;
  v_brand uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_wait FROM public.venue_waitlist WHERE id = p_waitlist_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'waitlist_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_brand := v_wait.brand_id;
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_wait.status = 'converted' THEN
    RAISE EXCEPTION 'waitlist_already_converted' USING ERRCODE = '23505';
  END IF;
  IF v_wait.status NOT IN ('waiting','notified') THEN
    RAISE EXCEPTION 'waitlist_not_active_%', v_wait.status USING ERRCODE = '23514';
  END IF;

  -- D-1: cross-brand table_id injection guard. The assigned table MUST belong to
  -- the SAME brand as the waitlist row (= the converted reservation's brand).
  -- NULL p_table_id (no table assigned at convert) is allowed. This check runs
  -- BEFORE the INSERT so a mismatch aborts the whole convert atomically.
  IF p_table_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.venue_tables
        WHERE id = p_table_id AND brand_id = v_brand
     ) THEN
    RAISE EXCEPTION 'table_brand_mismatch: table % does not belong to brand %',
      p_table_id, v_brand USING ERRCODE = '23514';
  END IF;

  -- Create the reservation (FREE; created_via=operator; carries the waitlist
  -- guest identity + party + preferred-zone-as-occasion-less note).
  INSERT INTO public.reservations (
    brand_id, place_pool_id, table_id, reserved_for, party_size, status,
    source, created_via, guest_name, guest_phone_e164, guest_email,
    consumer_user_id
  ) VALUES (
    v_brand, v_wait.place_pool_id, p_table_id, p_reserved_for, v_wait.party_size,
    'confirmed', 'walk_in', 'operator',
    v_wait.guest_name, v_wait.guest_phone_e164, v_wait.guest_email,
    v_wait.consumer_user_id
  ) RETURNING * INTO v_res;

  -- Mark the waitlist row converted + link.
  UPDATE public.venue_waitlist
     SET status = 'converted',
         converted_reservation_id = v_res.id,
         updated_at = now()
   WHERE id = p_waitlist_id;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    v_uid, v_brand,
    'venue_waitlist.converted',
    'venue_waitlist', p_waitlist_id::text,
    jsonb_build_object('reservation_id', v_res.id, 'reserved_for', p_reserved_for)
  );

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_waitlist_convert_to_reservation(uuid, timestamptz, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_waitlist_convert_to_reservation(uuid, timestamptz, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_waitlist_convert_to_reservation(uuid, timestamptz, uuid) TO authenticated;

COMMIT;
