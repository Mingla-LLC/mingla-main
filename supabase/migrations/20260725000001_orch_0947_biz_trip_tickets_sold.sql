-- ORCH-0947 [Trip dashboard Spots tile counts tickets, not orders]
-- New SECURITY DEFINER helper that mirrors the canonical capacity-gate
-- query at supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:223-228.
-- Powers the trip dashboard's Spots KPI tile and "N travelers" subtitle so the
-- planner sees the same number the checkout RPC enforces.

CREATE OR REPLACE FUNCTION public.biz_trip_tickets_sold(
  p_event_id uuid
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_event   record;
  v_count   integer;
BEGIN
  -- 1. Auth gate
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  -- 2. Event lookup + type check
  SELECT id, brand_id, event_type, deleted_at
    INTO v_event
    FROM public.events
   WHERE id = p_event_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;

  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip'
      USING HINT = 'biz_trip_tickets_sold only handles event_type=trip rows.';
  END IF;

  -- 3. Ownership check. `viewer` is not a valid biz_role_rank in the baseline,
  -- so this uses the SPEC fallback: event_manager-or-higher.
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- 4. Canonical sold count: mirror the checkout RPC capacity gate exactly.
  --    Counts tickets that hold a real seat: 'valid' (active),
  --    'used' (already attended), 'transferred' (still occupies a spot,
  --    just owned by a new wallet).
  SELECT COUNT(*)::integer
    INTO v_count
    FROM public.tickets t
    JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
   WHERE tt.event_id = p_event_id
     AND t.status IN ('valid', 'used', 'transferred');

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.biz_trip_tickets_sold(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_trip_tickets_sold(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.biz_trip_tickets_sold(uuid) IS
  'ORCH-0947: returns count of tickets occupying a seat (status IN (valid,used,transferred)) for a trip''s ticket_types. Mirrors the canonical capacity gate. Used by the trip dashboard Spots tile.';
