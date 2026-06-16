-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1b — waitlist RPCs (notify/convert) + list indexes
-- ---------------------------------------------------------------------------
-- The waitlist add/edit happens via direct RLS-gated INSERT/UPDATE (the table
-- ships manager-plus-write RLS in 2.0). Two operations need server-side
-- ATOMICITY + audit and so are RPCs:
--
--   biz_waitlist_mark_notified — flip a waitlist row to status='notified',
--     stamp notified_at + expires_at (now + p_expire_minutes). The
--     "table's ready" SMS is sent by the send-venue-sms edge fn; this RPC only
--     records the notify state. Guarded + audited.
--
--   biz_waitlist_convert_to_reservation — ATOMICALLY create a reservations row
--     from a waitlist row + mark the waitlist row converted (status='converted',
--     converted_reservation_id = the new row). Both in ONE transaction so a
--     half-convert can never happen (I-PROPOSED-1148-WAITLIST-CONVERT-ATOMIC).
--
-- Plus the list-view indexes the Reservations module's Today/Upcoming/etc.
-- filters need (brand_id + status + reserved_for) and the source-badge read.
--
-- Manual operator bookings are FREE; the converted reservation carries no fee.
-- Additive-only; $function$ before GRANT. MONOTONIC 20261010000002.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- List-view indexes (Reservations module Today / Upcoming / Completed / ...).
-- The 2.0 reservations table already has (brand_id, reserved_for) and
-- (brand_id, status); add the combined (brand_id, status, reserved_for) for the
-- segmented views that filter on BOTH status-set AND order by time.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS reservations_brand_status_reserved_idx
  ON public.reservations (brand_id, status, reserved_for);

-- Waitlist FIFO already indexed in 2.0 (venue_waitlist_queue_idx). Add an index
-- for the "active queue" read (waiting + notified, by creation order).
CREATE INDEX IF NOT EXISTS venue_waitlist_active_idx
  ON public.venue_waitlist (brand_id, created_at)
  WHERE status IN ('waiting','notified');

-- ---------------------------------------------------------------------------
-- biz_waitlist_mark_notified — record the notify state (SMS sent separately).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_waitlist_mark_notified(
  p_waitlist_id uuid,
  p_expire_minutes int DEFAULT 15,
  p_notify_via text DEFAULT 'sms'
) RETURNS public.venue_waitlist
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.venue_waitlist;
  v_brand uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_row FROM public.venue_waitlist WHERE id = p_waitlist_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'waitlist_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_brand := v_row.brand_id;
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_row.status NOT IN ('waiting','notified') THEN
    RAISE EXCEPTION 'waitlist_not_active_%', v_row.status USING ERRCODE = '23514';
  END IF;
  IF p_notify_via NOT IN ('push','sms','none') THEN
    RAISE EXCEPTION 'invalid_notify_via_%', p_notify_via USING ERRCODE = '23514';
  END IF;

  UPDATE public.venue_waitlist
     SET status = 'notified',
         notify_via = p_notify_via,
         notified_at = now(),
         expires_at = now() + make_interval(mins => GREATEST(p_expire_minutes, 0)),
         updated_at = now()
   WHERE id = p_waitlist_id
   RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    v_uid, v_brand,
    'venue_waitlist.notified',
    'venue_waitlist', p_waitlist_id::text,
    jsonb_build_object('notify_via', p_notify_via, 'expires_at', v_row.expires_at)
  );

  RETURN v_row;
END;
$function$;

-- Operator-only (manager+); REVOKE the Supabase auto PUBLIC+anon grants.
REVOKE ALL ON FUNCTION public.biz_waitlist_mark_notified(uuid, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_waitlist_mark_notified(uuid, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_waitlist_mark_notified(uuid, int, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- biz_waitlist_convert_to_reservation — ATOMIC: create reservation + mark
-- the waitlist row converted, in one transaction.
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
