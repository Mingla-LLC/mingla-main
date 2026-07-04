-- ORCH-1277 [Admin Offerings console — WAVE-2 EDIT] — venue reservation-stack write
-- RPCs (#14–16). Parent META-ORCH-1237; predecessor ORCH-1273 (READ, shipped).
--
-- Same ORCH-1271 GOLDEN write-RPC template as 20261209000000: guard-first
-- is_admin_user() → reason gate (all three are HIGH) → whitelisted/validated mutation
-- (+ explicit updated_at=now()) → admin_write_audit(before/after) → least-privilege
-- REVOKE anon/PUBLIC + GRANT authenticated → DO $$ self-assert. $$ body delimiter to
-- match the registry gate parsers. NO venue-listing field edit here (name/address/
-- hours/category/contact = follow-on ORCH, SPEC non-goal / Open Q6).
--
-- Overriding a reservation status fires orch_1161_reservation_notify_trg (AFTER UPDATE)
-- → a guest notification is queued (the modal copy warns "the guest is notified");
-- documented side-effect, NOT re-implemented (SPEC §5).
--
-- Verified live 2026-07-03: venue_reservation_settings PK = venue_id (NOT id);
-- no_show_fee_policy CHECK ∈ ('forfeit','none'); venue_capacity_rules.zone CHECK ∈
-- ('indoor','outdoor','private_room','bar','patio'); reservations.status CHECK is the
-- 8-value set below.
--
-- Enforces: I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC,
--           I-PROPOSED-1277-HIGH-RISK-REASON-REQUIRED,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT,
--           I-PROPOSED-1271-ADMIN-WRITE-AUDITED, I-PROPOSED-1271-ADMIN-SINGLE-GATE.

--------------------------------------------------------------------------------
-- #14 — admin_update_venue_reservation_settings (HIGH). PK = venue_id. Whitelist
-- {reservations_enabled,fee_amount_cents,fee_currency,cancel_cutoff_hours,
-- no_show_fee_policy}. NOT-NULL columns are only overwritten by a validly-typed value.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_venue_reservation_settings(
  p_venue_id uuid,
  p_patch    jsonb,
  p_reason   text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT ((p_patch ? 'reservations_enabled') OR (p_patch ? 'fee_amount_cents') OR (p_patch ? 'fee_currency')
          OR (p_patch ? 'cancel_cutoff_hours') OR (p_patch ? 'no_show_fee_policy')) THEN
    RAISE EXCEPTION 'no_editable_fields';
  END IF;
  IF (p_patch ? 'no_show_fee_policy') AND (p_patch->>'no_show_fee_policy') NOT IN ('forfeit', 'none') THEN
    RAISE EXCEPTION 'invalid_no_show_policy';
  END IF;
  IF (p_patch ? 'fee_amount_cents') AND NULLIF(p_patch->>'fee_amount_cents', '') IS NOT NULL
     AND (p_patch->>'fee_amount_cents')::int < 0 THEN
    RAISE EXCEPTION 'invalid_fee';
  END IF;
  IF (p_patch ? 'cancel_cutoff_hours') AND NULLIF(p_patch->>'cancel_cutoff_hours', '') IS NOT NULL
     AND (p_patch->>'cancel_cutoff_hours')::int < 0 THEN
    RAISE EXCEPTION 'invalid_cutoff';
  END IF;
  SELECT to_jsonb(s) INTO v_before FROM public.venue_reservation_settings s WHERE s.venue_id = p_venue_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.venue_reservation_settings SET
    -- NOT NULL boolean: only a genuine boolean overwrites it.
    reservations_enabled = CASE WHEN (p_patch ? 'reservations_enabled')
                                  AND jsonb_typeof(p_patch->'reservations_enabled') = 'boolean'
                                THEN (p_patch->>'reservations_enabled')::boolean ELSE reservations_enabled END,
    -- nullable int: empty string clears to NULL.
    fee_amount_cents     = CASE WHEN p_patch ? 'fee_amount_cents'
                                THEN NULLIF(p_patch->>'fee_amount_cents', '')::int ELSE fee_amount_cents END,
    -- nullable char: empty string clears to NULL.
    fee_currency         = CASE WHEN p_patch ? 'fee_currency'
                                THEN NULLIF(p_patch->>'fee_currency', '') ELSE fee_currency END,
    -- NOT NULL int: only a present, non-empty value overwrites it.
    cancel_cutoff_hours  = CASE WHEN (p_patch ? 'cancel_cutoff_hours') AND NULLIF(p_patch->>'cancel_cutoff_hours', '') IS NOT NULL
                                THEN (p_patch->>'cancel_cutoff_hours')::int ELSE cancel_cutoff_hours END,
    -- NOT NULL text (CHECK forfeit|none, validated above).
    no_show_fee_policy   = CASE WHEN p_patch ? 'no_show_fee_policy'
                                THEN p_patch->>'no_show_fee_policy' ELSE no_show_fee_policy END,
    updated_at = now()
   WHERE venue_id = p_venue_id RETURNING to_jsonb(venue_reservation_settings) INTO v_after;
  PERFORM public.admin_write_audit('venue_reservation_settings.update', 'venue_reservation_settings', p_venue_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_update_venue_reservation_settings(uuid, jsonb, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_venue_reservation_settings(uuid, jsonb, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_update_venue_reservation_settings(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_update_venue_reservation_settings still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_update_venue_reservation_settings(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_update_venue_reservation_settings (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #15 — admin_update_venue_capacity_rule (HIGH). Whitelist {params,is_active,zone}.
-- kind is IMMUTABLE in 1277. zone validated against the enum when present.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_venue_capacity_rule(
  p_rule_id uuid,
  p_patch   jsonb,
  p_reason  text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT ((p_patch ? 'params') OR (p_patch ? 'is_active') OR (p_patch ? 'zone')) THEN
    RAISE EXCEPTION 'no_editable_fields';
  END IF;
  IF (p_patch ? 'zone') AND NULLIF(p_patch->>'zone', '') IS NOT NULL
     AND (p_patch->>'zone') NOT IN ('indoor', 'outdoor', 'private_room', 'bar', 'patio') THEN
    RAISE EXCEPTION 'invalid_zone';
  END IF;
  SELECT to_jsonb(c) INTO v_before FROM public.venue_capacity_rules c WHERE c.id = p_rule_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.venue_capacity_rules SET
    -- NOT NULL jsonb: only an object/array overwrites it.
    params    = CASE WHEN (p_patch ? 'params') AND jsonb_typeof(p_patch->'params') IN ('object', 'array')
                     THEN p_patch->'params' ELSE params END,
    -- NOT NULL boolean.
    is_active = CASE WHEN (p_patch ? 'is_active') AND jsonb_typeof(p_patch->'is_active') = 'boolean'
                     THEN (p_patch->>'is_active')::boolean ELSE is_active END,
    -- nullable text: empty string clears to NULL.
    zone      = CASE WHEN p_patch ? 'zone' THEN NULLIF(p_patch->>'zone', '') ELSE zone END,
    updated_at = now()
   WHERE id = p_rule_id RETURNING to_jsonb(venue_capacity_rules) INTO v_after;
  PERFORM public.admin_write_audit('venue_capacity_rule.update', 'venue_capacity_rule', p_rule_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_update_venue_capacity_rule(uuid, jsonb, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_venue_capacity_rule(uuid, jsonb, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_update_venue_capacity_rule(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_update_venue_capacity_rule still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_update_venue_capacity_rule(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_update_venue_capacity_rule (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #16 — admin_set_reservation_status (HIGH). reservations.status (8-value enum). The
-- admin override permits ANY enum value (support escape hatch, no transition graph —
-- SPEC Open Q5). Fires orch_1161_reservation_notify_trg → guest notification queued.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_reservation_status(
  p_reservation_id uuid,
  p_status         text,
  p_reason         text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_status NOT IN ('requested', 'confirmed', 'seated', 'completed', 'no_show',
                      'cancelled_by_guest', 'cancelled_by_venue', 'waitlisted') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  SELECT to_jsonb(r) INTO v_before FROM public.reservations r WHERE r.id = p_reservation_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.reservations SET status = p_status, updated_at = now()
   WHERE id = p_reservation_id RETURNING to_jsonb(reservations) INTO v_after;
  PERFORM public.admin_write_audit('reservation.set_status', 'reservation', p_reservation_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_reservation_status(uuid, text, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_reservation_status(uuid, text, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_reservation_status(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_set_reservation_status still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_reservation_status(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_set_reservation_status (admin UI would break)';
  END IF;
END $$;
