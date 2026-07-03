-- ORCH-1277 [Admin Offerings console — WAVE-2 EDIT] — offering/event/trip/experience/RSVP
-- write RPCs (#1–13). Parent META-ORCH-1237; predecessor ORCH-1273 (READ, shipped).
--
-- Every RPC copies the ORCH-1271 GOLDEN write-RPC template (20261204000003 §GOLDEN)
-- VERBATIM in shape: guard-first is_admin_user() (FIRST executable statement) →
-- reason gate (HIGH only; audit-only reorders skip it) → to_jsonb before-capture →
-- not_found → whitelisted/validated mutation (+ explicit updated_at=now() — trip_days
-- and experience_stops carry NO auto updated_at trigger [verified live 2026-07-03], so
-- the RPC sets it) → admin_write_audit(before/after) → least-privilege
-- REVOKE EXECUTE FROM anon,PUBLIC; GRANT TO authenticated → DO $$ self-assert.
--
-- $$ (not $fn$) is the body delimiter to match the shipped precedent + the append-only
-- registry gate parsers (i-admin-write-audited / i-admin-gate-first-statement /
-- i-offerings-writes-audited slice the first $$ pair). The actor is bound SERVER-SIDE
-- inside admin_write_audit (auth.uid() in the SECURITY DEFINER context = the calling
-- admin) — p_actor_* is NEVER passed here.
--
-- Admin twins are is_admin_user()-gated — INDEPENDENT of the brand-team
-- biz_update_live_* organiser path (biz_brand_effective_rank gate); those are NOT
-- touched. NO brands.kind is read or written (META-ORCH-0972). Cancel issues NO
-- refund (money movement = ORCH-1274). The reorder RPCs (#7,#10) use a loop-based,
-- provably collision-free renumber for the NON-deferrable UNIQUE(event_id, ordinal) /
-- UNIQUE(event_id, stop_order): move the target to a sentinel BELOW the live range
-- (min-1, guaranteed free), shift the block ONE ROW AT A TIME in the vacate-before-fill
-- order, then place the target — each single-row UPDATE lands in a known-free slot, so
-- the per-row immediate unique check never trips.
--
-- Trigger side-effects RELIED ON, not re-implemented (SPEC §5): denying a going/approved
-- RSVP fires trg_rsvp_drain_on_status (waitlist auto-drain); raising rsvp_capacity fires
-- trg_rsvp_drain_on_cap_raise. Documented; NOT extended.
--
-- Enforces: I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC,
--           I-PROPOSED-1277-HIGH-RISK-REASON-REQUIRED,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT,
--           I-PROPOSED-1271-ADMIN-WRITE-AUDITED, I-PROPOSED-1271-ADMIN-SINGLE-GATE.

--------------------------------------------------------------------------------
-- #1 — admin_set_offering_visibility (HIGH). events.visibility.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_offering_visibility(
  p_event_id  uuid,
  p_visibility text,
  p_reason    text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_visibility NOT IN ('public', 'discover', 'private', 'hidden', 'draft') THEN
    RAISE EXCEPTION 'invalid_visibility';
  END IF;
  SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE e.id = p_event_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.events SET visibility = p_visibility, updated_at = now()
   WHERE id = p_event_id RETURNING to_jsonb(events) INTO v_after;
  PERFORM public.admin_write_audit('offering.set_visibility', 'offering', p_event_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_offering_visibility(uuid, text, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_offering_visibility(uuid, text, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_offering_visibility(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_set_offering_visibility still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_offering_visibility(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_set_offering_visibility (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #2 — admin_cancel_offering (HIGH, destructive). events.status → 'cancelled'.
-- NO refund (money movement = ORCH-1274 Money console).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cancel_offering(
  p_event_id uuid,
  p_reason   text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE e.id = p_event_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF (v_before->>'status') = 'cancelled' THEN RAISE EXCEPTION 'already_cancelled'; END IF;
  UPDATE public.events SET status = 'cancelled', updated_at = now()
   WHERE id = p_event_id RETURNING to_jsonb(events) INTO v_after;
  PERFORM public.admin_write_audit('offering.cancel', 'offering', p_event_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_offering(uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_cancel_offering(uuid, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_cancel_offering(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_cancel_offering still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_cancel_offering(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_cancel_offering (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #3 — admin_set_offering_bookings_closed (HIGH). events.bookings_closed +
-- bookings_closed_at. Idempotent.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_offering_bookings_closed(
  p_event_id uuid,
  p_closed   boolean,
  p_reason   text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE e.id = p_event_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.events
     SET bookings_closed = p_closed,
         bookings_closed_at = CASE WHEN p_closed THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_event_id RETURNING to_jsonb(events) INTO v_after;
  PERFORM public.admin_write_audit('offering.bookings_closed', 'offering', p_event_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_offering_bookings_closed(uuid, boolean, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_offering_bookings_closed(uuid, boolean, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_offering_bookings_closed(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_set_offering_bookings_closed still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_offering_bookings_closed(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_set_offering_bookings_closed (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #4 — admin_set_offering_deleted (HIGH, destructive on delete). events.deleted_at.
-- before-capture reads WITHOUT a deleted_at filter (so restore also captures state).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_offering_deleted(
  p_event_id uuid,
  p_deleted  boolean,
  p_reason   text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb; v_action text;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE e.id = p_event_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.events
     SET deleted_at = CASE WHEN p_deleted THEN now() ELSE NULL END, updated_at = now()
   WHERE id = p_event_id RETURNING to_jsonb(events) INTO v_after;
  v_action := CASE WHEN p_deleted THEN 'offering.soft_delete' ELSE 'offering.restore' END;
  PERFORM public.admin_write_audit(v_action, 'offering', p_event_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_offering_deleted(uuid, boolean, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_offering_deleted(uuid, boolean, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_offering_deleted(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_set_offering_deleted still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_offering_deleted(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_set_offering_deleted (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #5 — admin_set_ticket_price (HIGH). ticket_types.price_cents. Currency UNCHANGED
-- (trg_enforce_event_ticket_currency-safe). Trip pricing-tier fix reuses this on the
-- tier's linked ticket_type_id.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_ticket_price(
  p_ticket_type_id uuid,
  p_price_cents    integer,
  p_reason         text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_price_cents IS NULL OR p_price_cents < 0 THEN RAISE EXCEPTION 'invalid_price'; END IF;
  SELECT to_jsonb(t) INTO v_before FROM public.ticket_types t WHERE t.id = p_ticket_type_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.ticket_types SET price_cents = p_price_cents, updated_at = now()
   WHERE id = p_ticket_type_id RETURNING to_jsonb(ticket_types) INTO v_after;
  PERFORM public.admin_write_audit('ticket.set_price', 'ticket', p_ticket_type_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_ticket_price(uuid, integer, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_ticket_price(uuid, integer, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_ticket_price(uuid,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_set_ticket_price still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_ticket_price(uuid,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_set_ticket_price (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #6 — admin_update_trip_day (HIGH). Whitelisted patch {title,narrative,date}.
-- trip_days has NO auto updated_at trigger → set updated_at=now() explicitly.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_trip_day(
  p_trip_day_id uuid,
  p_patch       jsonb,
  p_reason      text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT ((p_patch ? 'title') OR (p_patch ? 'narrative') OR (p_patch ? 'date')) THEN
    RAISE EXCEPTION 'no_editable_fields';
  END IF;
  -- title is NOT NULL — reject clearing it to null/empty.
  IF (p_patch ? 'title') AND btrim(COALESCE(p_patch->>'title', '')) = '' THEN
    RAISE EXCEPTION 'invalid_title';
  END IF;
  SELECT to_jsonb(t) INTO v_before FROM public.trip_days t WHERE t.id = p_trip_day_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.trip_days SET
    title     = CASE WHEN p_patch ? 'title'     THEN p_patch->>'title'                      ELSE title END,
    narrative = CASE WHEN p_patch ? 'narrative' THEN p_patch->>'narrative'                  ELSE narrative END,
    -- date is nullable: an empty string clears it (NULLIF → NULL); a value casts to date.
    date      = CASE WHEN p_patch ? 'date'      THEN NULLIF(p_patch->>'date', '')::date     ELSE date END,
    updated_at = now()
   WHERE id = p_trip_day_id RETURNING to_jsonb(trip_days) INTO v_after;
  PERFORM public.admin_write_audit('trip_day.update', 'trip_day', p_trip_day_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_update_trip_day(uuid, jsonb, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_trip_day(uuid, jsonb, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_update_trip_day(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_update_trip_day still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_update_trip_day(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_update_trip_day (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #7 — admin_reorder_trip_day (AUDIT-ONLY). trip_days.ordinal within the event.
-- Loop-based collision-free renumber for the NON-deferrable UNIQUE(event_id, ordinal).
-- Reason NOT required (audit-only) → admin_write_audit(..., p_require_reason => false).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reorder_trip_day(
  p_trip_day_id uuid,
  p_new_ordinal integer,
  p_reason      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_before jsonb; v_after jsonb;
  v_event_id uuid; v_old integer; v_target integer;
  v_min integer; v_max integer; v_sentinel integer;
  r RECORD;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  SELECT to_jsonb(t) INTO v_before FROM public.trip_days t WHERE t.id = p_trip_day_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  v_event_id := (v_before->>'event_id')::uuid;
  v_old := (v_before->>'ordinal')::integer;
  SELECT min(ordinal), max(ordinal) INTO v_min, v_max FROM public.trip_days WHERE event_id = v_event_id;
  v_target := GREATEST(v_min, LEAST(p_new_ordinal, v_max));  -- clamp to [min,max]
  IF v_target = v_old THEN
    v_after := v_before;  -- no move needed (idempotent); still audited below.
  ELSE
    -- Park the target ABOVE the live range (v_max + 1): guaranteed free AND > 0, so it
    -- never trips trip_days CHECK (ordinal > 0). (A v_min - 1 sentinel = 0 for 1-based
    -- days violated that CHECK — ORCH-1277 P1, fixed here + in 20261209000003.)
    v_sentinel := v_max + 1;
    UPDATE public.trip_days SET ordinal = v_sentinel, updated_at = now() WHERE id = p_trip_day_id;
    IF v_target > v_old THEN
      -- shift the block (v_old, v_target] DOWN by 1, ascending so each slot vacates first.
      FOR r IN SELECT id, ordinal FROM public.trip_days
               WHERE event_id = v_event_id AND ordinal > v_old AND ordinal <= v_target
               ORDER BY ordinal ASC LOOP
        UPDATE public.trip_days SET ordinal = r.ordinal - 1, updated_at = now() WHERE id = r.id;
      END LOOP;
    ELSE
      -- shift the block [v_target, v_old) UP by 1, descending so each slot vacates first.
      FOR r IN SELECT id, ordinal FROM public.trip_days
               WHERE event_id = v_event_id AND ordinal >= v_target AND ordinal < v_old
               ORDER BY ordinal DESC LOOP
        UPDATE public.trip_days SET ordinal = r.ordinal + 1, updated_at = now() WHERE id = r.id;
      END LOOP;
    END IF;
    UPDATE public.trip_days SET ordinal = v_target, updated_at = now()
     WHERE id = p_trip_day_id RETURNING to_jsonb(trip_days) INTO v_after;
  END IF;
  PERFORM public.admin_write_audit('trip_day.reorder', 'trip_day', p_trip_day_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after), false);  -- AUDIT-ONLY: reason optional
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_reorder_trip_day(uuid, integer, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_reorder_trip_day(uuid, integer, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_reorder_trip_day(uuid,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_reorder_trip_day still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_reorder_trip_day(uuid,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_reorder_trip_day (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #8 — admin_update_experience_stop (HIGH). Whitelisted patch
-- {ai_description,place_name,address,start_time}. ai_description/place_name/address are
-- NOT NULL → must stay non-empty. experience_stops has NO auto updated_at trigger.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_experience_stop(
  p_stop_id uuid,
  p_patch   jsonb,
  p_reason  text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT ((p_patch ? 'ai_description') OR (p_patch ? 'place_name') OR (p_patch ? 'address') OR (p_patch ? 'start_time')) THEN
    RAISE EXCEPTION 'no_editable_fields';
  END IF;
  IF (p_patch ? 'ai_description') AND btrim(COALESCE(p_patch->>'ai_description', '')) = '' THEN
    RAISE EXCEPTION 'ai_description_empty';
  END IF;
  IF (p_patch ? 'place_name') AND btrim(COALESCE(p_patch->>'place_name', '')) = '' THEN
    RAISE EXCEPTION 'invalid_place_name';
  END IF;
  IF (p_patch ? 'address') AND btrim(COALESCE(p_patch->>'address', '')) = '' THEN
    RAISE EXCEPTION 'invalid_address';
  END IF;
  SELECT to_jsonb(s) INTO v_before FROM public.experience_stops s WHERE s.id = p_stop_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.experience_stops SET
    ai_description = CASE WHEN p_patch ? 'ai_description' THEN p_patch->>'ai_description' ELSE ai_description END,
    place_name     = CASE WHEN p_patch ? 'place_name'     THEN p_patch->>'place_name'     ELSE place_name END,
    address        = CASE WHEN p_patch ? 'address'        THEN p_patch->>'address'        ELSE address END,
    -- start_time is nullable time: empty string clears it (NULLIF → NULL); else casts.
    start_time     = CASE WHEN p_patch ? 'start_time'     THEN NULLIF(p_patch->>'start_time', '')::time ELSE start_time END,
    updated_at = now()
   WHERE id = p_stop_id RETURNING to_jsonb(experience_stops) INTO v_after;
  PERFORM public.admin_write_audit('experience_stop.update', 'experience_stop', p_stop_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_update_experience_stop(uuid, jsonb, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_experience_stop(uuid, jsonb, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_update_experience_stop(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_update_experience_stop still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_update_experience_stop(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_update_experience_stop (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #9 — admin_delete_experience_stop (HIGH, destructive). experience_stops has NO
-- deleted_at column → hard DELETE. Audit carries {before} only.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_experience_stop(
  p_stop_id uuid,
  p_reason  text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(s) INTO v_before FROM public.experience_stops s WHERE s.id = p_stop_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  DELETE FROM public.experience_stops WHERE id = p_stop_id;
  PERFORM public.admin_write_audit('experience_stop.remove', 'experience_stop', p_stop_id::text, p_reason,
    jsonb_build_object('before', v_before));
  RETURN v_before;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_experience_stop(uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_delete_experience_stop(uuid, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_delete_experience_stop(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_delete_experience_stop still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_delete_experience_stop(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_delete_experience_stop (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #10 — admin_reorder_experience_stop (AUDIT-ONLY). experience_stops.stop_order.
-- Same loop-based collision-free renumber (NON-deferrable UNIQUE(event_id, stop_order)).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reorder_experience_stop(
  p_stop_id   uuid,
  p_new_order integer,
  p_reason    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_before jsonb; v_after jsonb;
  v_event_id uuid; v_old integer; v_target integer;
  v_min integer; v_max integer; v_sentinel integer;
  r RECORD;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  SELECT to_jsonb(s) INTO v_before FROM public.experience_stops s WHERE s.id = p_stop_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  v_event_id := (v_before->>'event_id')::uuid;
  v_old := (v_before->>'stop_order')::integer;
  SELECT min(stop_order), max(stop_order) INTO v_min, v_max FROM public.experience_stops WHERE event_id = v_event_id;
  v_target := GREATEST(v_min, LEAST(p_new_order, v_max));  -- clamp to [min,max]
  IF v_target = v_old THEN
    v_after := v_before;  -- no move needed (idempotent); still audited below.
  ELSE
    v_sentinel := v_min - 1;  -- strictly below every live stop_order → guaranteed free
    UPDATE public.experience_stops SET stop_order = v_sentinel, updated_at = now() WHERE id = p_stop_id;
    IF v_target > v_old THEN
      FOR r IN SELECT id, stop_order FROM public.experience_stops
               WHERE event_id = v_event_id AND stop_order > v_old AND stop_order <= v_target
               ORDER BY stop_order ASC LOOP
        UPDATE public.experience_stops SET stop_order = r.stop_order - 1, updated_at = now() WHERE id = r.id;
      END LOOP;
    ELSE
      FOR r IN SELECT id, stop_order FROM public.experience_stops
               WHERE event_id = v_event_id AND stop_order >= v_target AND stop_order < v_old
               ORDER BY stop_order DESC LOOP
        UPDATE public.experience_stops SET stop_order = r.stop_order + 1, updated_at = now() WHERE id = r.id;
      END LOOP;
    END IF;
    UPDATE public.experience_stops SET stop_order = v_target, updated_at = now()
     WHERE id = p_stop_id RETURNING to_jsonb(experience_stops) INTO v_after;
  END IF;
  PERFORM public.admin_write_audit('experience_stop.reorder', 'experience_stop', p_stop_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after), false);  -- AUDIT-ONLY: reason optional
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_reorder_experience_stop(uuid, integer, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_reorder_experience_stop(uuid, integer, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_reorder_experience_stop(uuid,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_reorder_experience_stop still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_reorder_experience_stop(uuid,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_reorder_experience_stop (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #11 — admin_set_rsvp_approval. event_rsvps.approval_status. Reason required IFF
-- denying (HIGH); approve/pending is AUDIT-ONLY (optional reason, still audited).
-- Denying a going/approved guest fires trg_rsvp_drain_on_status (waitlist auto-drain) —
-- documented side-effect, NOT re-implemented (SPEC §5).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_rsvp_approval(
  p_rsvp_id         uuid,
  p_approval_status text,
  p_reason          text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb; v_action text; v_deny boolean;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_approval_status NOT IN ('pending', 'approved', 'denied') THEN
    RAISE EXCEPTION 'invalid_approval_status';
  END IF;
  v_deny := (p_approval_status = 'denied');
  -- HIGH only when denying: a deny MUST carry a reason (server gate, modal-independent).
  IF v_deny AND (p_reason IS NULL OR btrim(p_reason) = '') THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(r) INTO v_before FROM public.event_rsvps r WHERE r.id = p_rsvp_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.event_rsvps SET approval_status = p_approval_status, updated_at = now()
   WHERE id = p_rsvp_id RETURNING to_jsonb(event_rsvps) INTO v_after;
  v_action := CASE WHEN v_deny THEN 'rsvp.deny' ELSE 'rsvp.approve' END;
  PERFORM public.admin_write_audit(v_action, 'rsvp', p_rsvp_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after), v_deny);  -- require_reason only on deny
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_rsvp_approval(uuid, text, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_rsvp_approval(uuid, text, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_rsvp_approval(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_set_rsvp_approval still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_rsvp_approval(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_set_rsvp_approval (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #12 — admin_remove_rsvp_guest (HIGH, destructive). Hard DELETE of the event_rsvps
-- row; the FK event_rsvp_guests.rsvp_id → event_rsvps(id) ON DELETE CASCADE removes
-- the plus-guests [verified live]. Audit carries {before} (rsvp + child guests).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_remove_rsvp_guest(
  p_rsvp_id uuid,
  p_reason  text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_guests jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(r) INTO v_before FROM public.event_rsvps r WHERE r.id = p_rsvp_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT jsonb_agg(to_jsonb(g)) INTO v_guests FROM public.event_rsvp_guests g WHERE g.rsvp_id = p_rsvp_id;
  DELETE FROM public.event_rsvps WHERE id = p_rsvp_id;  -- cascades event_rsvp_guests
  PERFORM public.admin_write_audit('rsvp.remove', 'rsvp', p_rsvp_id::text, p_reason,
    jsonb_build_object('before', v_before, 'guests', COALESCE(v_guests, '[]'::jsonb)));
  RETURN v_before;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_remove_rsvp_guest(uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_remove_rsvp_guest(uuid, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_remove_rsvp_guest(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_remove_rsvp_guest still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_remove_rsvp_guest(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_remove_rsvp_guest (admin UI would break)';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- #13 — admin_set_rsvp_capacity (HIGH). events.rsvp_capacity (NULL = uncapped) +
-- rsvp_waitlist_enabled. Raising capacity fires trg_rsvp_drain_on_cap_raise
-- (waitlist auto-drain) — documented side-effect, NOT re-implemented (SPEC §5).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_rsvp_capacity(
  p_event_id         uuid,
  p_rsvp_capacity    integer,
  p_waitlist_enabled boolean,
  p_reason           text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_rsvp_capacity IS NOT NULL AND p_rsvp_capacity < 0 THEN RAISE EXCEPTION 'invalid_capacity'; END IF;
  IF p_waitlist_enabled IS NULL THEN RAISE EXCEPTION 'invalid_waitlist'; END IF;
  SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE e.id = p_event_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.events
     SET rsvp_capacity = p_rsvp_capacity, rsvp_waitlist_enabled = p_waitlist_enabled, updated_at = now()
   WHERE id = p_event_id RETURNING to_jsonb(events) INTO v_after;
  PERFORM public.admin_write_audit('rsvp.set_capacity', 'offering', p_event_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_rsvp_capacity(uuid, integer, boolean, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_rsvp_capacity(uuid, integer, boolean, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_set_rsvp_capacity(uuid,integer,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: admin_set_rsvp_capacity still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_rsvp_capacity(uuid,integer,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1277: authenticated lost EXECUTE on admin_set_rsvp_capacity (admin UI would break)';
  END IF;
END $$;
