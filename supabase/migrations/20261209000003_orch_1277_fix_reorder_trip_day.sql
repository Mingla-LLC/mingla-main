-- ORCH-1277 [Admin Offerings console — WAVE-2 EDIT] — P1 FIX: admin_reorder_trip_day
-- sentinel was CONSTRAINT-UNSAFE.
--
-- Live repro 2026-07-03 (seeded trip_days ordinals 1,2,3): admin_reorder_trip_day(day1, 3)
-- → ERROR trip_days_ordinal_check. Root cause: the collision-free renumber parked the
-- target at a sentinel `v_min - 1` (= 0 for 1-based days), but trip_days enforces
-- CHECK (ordinal > 0) → every real trip-day reorder raised, fail-closed.
--
-- FIX: park the target ABOVE the live range at `v_max + 1` — guaranteed free (nothing is
-- higher than the current max) AND > 0 (satisfies the CHECK). The vacate-before-fill
-- shift ordering is UNCHANGED, so the renumber stays collision-free against the
-- NON-deferrable UNIQUE (event_id, ordinal). experience_stops has NO ordinal>0 floor, so
-- admin_reorder_experience_stop's `v_min - 1` sentinel is CORRECT and left untouched.
--
-- 20261209000000 is already applied to prod; this 000003 is the CREATE OR REPLACE
-- redeploy vehicle (monotonic; 000002/000003 free). Re-ships the least-privilege
-- REVOKE anon/PUBLIC + GRANT authenticated + DO $$ self-assert. Body is byte-identical to
-- the fixed 20261209000000 definition.
--
-- Enforces: I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT, I-PROPOSED-1271-ADMIN-WRITE-AUDITED.

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
    -- days violated that CHECK — ORCH-1277 P1.)
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
