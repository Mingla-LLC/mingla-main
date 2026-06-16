-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1b — reservation LIFECYCLE RPCs (guarded + audited)
-- ---------------------------------------------------------------------------
-- The 2.0 `reservations` table shipped the 8-state CHECK; 2.1b ships ONLY the
-- transitions. Lifecycle changes flow through a SINGLE guarded transition RPC
-- (`biz_reservation_transition`) plus a manual-create RPC (`biz_reservation_create`).
-- Both are SECURITY DEFINER, gate on brand-member rank >= event_manager via the
-- caller's auth context (biz_brand_effective_rank_for_caller reads auth.uid()),
-- and write an audit_log row. This is the SERVER-SIDE enforcement of legal
-- transitions — the UI is convenience only.
--
-- I-PROPOSED-1148-RESERVATION-LIFECYCLE-TRANSITIONS-GUARDED-SERVER-SIDE: illegal
-- transitions are REJECTED in the database (RAISE EXCEPTION), not just hidden in
-- the client. A revert that allows e.g. seating a cancelled reservation fails the
-- transition-guard test.
--
-- Money: manual operator bookings are FREE (fee_cents stays NULL/0). A no_show
-- RECORDS the forfeit-policy DECISION (copies venue_reservation_settings.no_show_fee_policy
-- onto the row's payment context) but performs NO Stripe capture — the actual
-- charge/capture is 2.2's seam. NO checkout/charge path is touched here.
--
-- Additive-only; $function$ closed BEFORE each GRANT. MONOTONIC 20261010000001.
-- DROP FUNCTION not needed (new identities). Apply via Management API after REVIEW.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Legal-transition matrix (pure, IMMUTABLE) — the single source of truth.
--   requested  -> confirmed | cancelled_by_venue | cancelled_by_guest
--   confirmed  -> seated | no_show | completed | cancelled_by_venue | cancelled_by_guest
--   seated     -> completed | no_show | cancelled_by_venue
--   waitlisted -> confirmed | cancelled_by_venue | cancelled_by_guest
--   completed / no_show / cancelled_by_guest / cancelled_by_venue -> (terminal)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_reservation_transition_is_legal(
  p_from text,
  p_to text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE p_from
    WHEN 'requested'  THEN p_to IN ('confirmed','cancelled_by_venue','cancelled_by_guest')
    WHEN 'confirmed'  THEN p_to IN ('seated','no_show','completed','cancelled_by_venue','cancelled_by_guest')
    WHEN 'seated'     THEN p_to IN ('completed','no_show','cancelled_by_venue')
    WHEN 'waitlisted' THEN p_to IN ('confirmed','cancelled_by_venue','cancelled_by_guest')
    ELSE false  -- completed / no_show / cancelled_* are terminal
  END;
$function$;

-- Supabase's public-schema default privileges auto-GRANT EXECUTE to PUBLIC (and
-- anon) on every new function. These RPCs are operator-only (manager+), so REVOKE
-- both PUBLIC and anon explicitly — the gate is enforced inside the fn, but the
-- least-privilege ACL is the belt (mirrors the 2.1a engine).
REVOKE ALL ON FUNCTION public.pg_reservation_transition_is_legal(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_reservation_transition_is_legal(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_reservation_transition_is_legal(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- biz_reservation_transition — the SINGLE guarded lifecycle mutator.
-- Confirm / seat / no_show / complete / cancel all route through here.
-- Returns the updated reservation row (so the client refreshes optimistically).
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
-- biz_reservation_create — manual operator create (phone/walk-in/etc.).
-- FREE (no fee). created_via='operator'. status defaults 'confirmed' (a manual
-- booking is already confirmed) unless the caller passes a starting status.
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

COMMIT;
