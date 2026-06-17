-- ===========================================================================
-- ORCH-1150 R2 · D-10 — add a third RSVP status 'maybe'.
--
-- A Maybe is an OPTIONAL attendee: auto-approved, CAP-NEUTRAL, on the notify
-- list, never occupying a seat. It mirrors not_going's cap-neutrality but stays
-- on the guest list (so the host can plan + we can keep the guest posted).
--
-- ORCH-1150: do NOT add 'maybe' to ANY capacity / waitlist-drain / "N going"
-- headcount predicate — those intentionally count only
-- (rsvp_status='going' AND approval_status='approved'). 'maybe' being excluded
-- from those is exactly what makes it cap-neutral (I-PROPOSED-1150-MAYBE-NOT-IN-CAP).
--
-- Additive + idempotent. The base RSVP schema is migration
-- 20261004000000_orch_1150_rsvp_events.sql. Prefix 20261012000000 is strictly
-- greater than the current head 20261011000001.
--
-- DO NOT APPLY from the implementor — the orchestrator applies via MCP /
-- Management API (dev history is drift-corrupted).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Widen the rsvp_status CHECK to allow 'maybe' (DROP-before-ADD).
--     The base constraint is the inline auto-named event_rsvps_rsvp_status_check
--     from 20261004000000:60-61.
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_rsvps
  DROP CONSTRAINT IF EXISTS event_rsvps_rsvp_status_check;
ALTER TABLE public.event_rsvps
  ADD CONSTRAINT event_rsvps_rsvp_status_check
  CHECK (rsvp_status IN ('going', 'not_going', 'waitlisted', 'maybe'));

-- ---------------------------------------------------------------------------
-- (b) Widen the guest self-update RLS WITH CHECK to allow setting 'maybe'.
--     Mirrors the base policy from 20261004000000:174-181 + adds 'maybe'.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS event_rsvps_guest_update_own ON public.event_rsvps;
CREATE POLICY event_rsvps_guest_update_own ON public.event_rsvps
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND rsvp_status IN ('going', 'not_going', 'maybe')
  );

-- ---------------------------------------------------------------------------
-- (c) Widen submit_event_rsvp to accept + resolve 'maybe'.
--     Latest CREATE OR REPLACE wins. Two precise deltas vs the base
--     (20261004000000:858-980):
--       - validation now allows 'maybe' (else still rsvp_status_invalid),
--       - a 'maybe' attendance branch BEFORE the capacity math: cap-neutral
--         (like not_going) but AUTO-APPROVED so it never sits in the host's
--         pending queue (a Maybe is non-binding + never fills a seat).
--     Everything else (clamp, UPSERT, waitlisted_at) is byte-identical; maybe
--     never sets waitlisted_at (it is not waitlisted).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_event_rsvp(
  p_event_id   uuid,
  p_user_id    uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_rsvp_status text,
  p_plus_count  integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event       public.events%ROWTYPE;
  v_plus        integer;
  v_confirmed   integer;
  v_status      text;
  v_approval    text;
  v_name        text;
  v_existing_id uuid;
BEGIN
  -- 1. Load + gate the event (FOR UPDATE serializes concurrent submits).
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND
     OR v_event.event_type <> 'rsvp'
     OR v_event.status NOT IN ('scheduled', 'live')
     OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'rsvp_not_open';
  END IF;

  -- ORCH-1150 R2 D-10: 'maybe' joins the accepted set; anything else is invalid.
  IF p_rsvp_status NOT IN ('going', 'not_going', 'maybe') THEN
    RAISE EXCEPTION 'rsvp_status_invalid';
  END IF;

  -- 2. Contact gate for link guests (anon — no user_id).
  v_name := NULLIF(btrim(COALESCE(p_guest_name, '')), '');
  IF p_user_id IS NULL THEN
    IF v_name IS NULL
       OR NULLIF(btrim(COALESCE(p_guest_email, '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN
      RAISE EXCEPTION 'rsvp_contact_required';
    END IF;
  END IF;
  IF v_name IS NULL THEN
    v_name := COALESCE(NULLIF(btrim(p_guest_email), ''), 'Guest');
  END IF;

  -- 3. Clamp plus_count.
  v_plus := GREATEST(COALESCE(p_plus_count, 0), 0);
  IF v_event.rsvp_allow_plus_ones THEN
    v_plus := LEAST(v_plus, v_event.rsvp_plus_ones_max);
  ELSE
    v_plus := 0;
  END IF;

  -- 4. Resolve approval + attendance.
  v_approval := CASE WHEN v_event.rsvp_approval_mode = 'manual' THEN 'pending' ELSE 'approved' END;

  IF p_rsvp_status = 'not_going' THEN
    v_status := 'not_going';
  ELSIF p_rsvp_status = 'maybe' THEN
    -- ORCH-1150 R2 D-10: a Maybe is non-binding + never occupies a seat, so it
    -- is ALWAYS auto-approved (never host-pending) and never consumes capacity.
    v_status := 'maybe';
    v_approval := 'approved';
  ELSIF v_event.rsvp_capacity IS NULL THEN
    v_status := 'going';
  ELSE
    SELECT COALESCE(SUM(1 + r.plus_count), 0) INTO v_confirmed
      FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
       AND (p_user_id IS NULL OR r.user_id IS DISTINCT FROM p_user_id);
    IF (v_confirmed + 1 + v_plus) > v_event.rsvp_capacity THEN
      IF v_event.rsvp_approval_mode = 'manual' THEN
        -- pending doesn't occupy the cap; host's approve is capacity-gated.
        v_status := 'going';
      ELSIF v_event.rsvp_waitlist_enabled THEN
        v_status := 'waitlisted';
        v_approval := 'approved';
      ELSE
        RAISE EXCEPTION 'rsvp_full';
      END IF;
    ELSE
      v_status := 'going';
    END IF;
  END IF;

  -- 5. UPSERT the row.
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.event_rsvps
     WHERE event_id = p_event_id AND user_id = p_user_id;
  ELSIF NULLIF(btrim(COALESCE(p_guest_email, '')), '') IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.event_rsvps
     WHERE event_id = p_event_id AND lower(guest_email) = lower(btrim(p_guest_email));
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.event_rsvps
       SET rsvp_status = v_status,
           approval_status = v_approval,
           plus_count = v_plus,
           guest_name = v_name,
           guest_email = COALESCE(NULLIF(btrim(p_guest_email), ''), guest_email),
           guest_phone = COALESCE(NULLIF(btrim(p_guest_phone), ''), guest_phone),
           waitlisted_at = CASE WHEN v_status = 'waitlisted' THEN COALESCE(waitlisted_at, now()) ELSE NULL END
     WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.event_rsvps
      (event_id, user_id, guest_name, guest_email, guest_phone,
       rsvp_status, approval_status, plus_count, waitlisted_at)
    VALUES
      (p_event_id, p_user_id, v_name,
       NULLIF(btrim(p_guest_email), ''), NULLIF(btrim(p_guest_phone), ''),
       v_status, v_approval, v_plus,
       CASE WHEN v_status = 'waitlisted' THEN now() ELSE NULL END)
    RETURNING id INTO v_existing_id;
  END IF;

  RETURN jsonb_build_object(
    'rsvpId', v_existing_id,
    'status', v_status,
    'approvalStatus', v_approval,
    'capacityFull', (v_status = 'waitlisted')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_event_rsvp(uuid, uuid, text, text, text, text, integer) TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- (d) Re-create host_list_rsvp_guests with a 'maybe' bucket in the order CASE
--     so maybe rows group predictably (between waitlisted and the else tail).
--     RETURNS TABLE → DROP-before is mandatory (migration-baseline rule).
--     Body is byte-identical to the base (20261004000000:1166-1191) except the
--     added maybe ORDER bucket. No capacity predicate changes here.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.host_list_rsvp_guests(uuid);
CREATE FUNCTION public.host_list_rsvp_guests(p_event_id uuid)
RETURNS TABLE (
  id uuid, event_id uuid, user_id uuid, guest_name text, guest_email text,
  guest_phone text, rsvp_status text, approval_status text, plus_count integer,
  waitlisted_at timestamptz, promoted_at timestamptz, created_at timestamptz
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT r.id, r.event_id, r.user_id, r.guest_name, r.guest_email, r.guest_phone,
         r.rsvp_status, r.approval_status, r.plus_count,
         r.waitlisted_at, r.promoted_at, r.created_at
    FROM public.event_rsvps r
   WHERE r.event_id = p_event_id
   ORDER BY
     CASE WHEN r.approval_status = 'pending' THEN 0
          WHEN r.rsvp_status = 'going' AND r.approval_status = 'approved' THEN 1
          WHEN r.rsvp_status = 'waitlisted' THEN 2
          WHEN r.rsvp_status = 'maybe' THEN 3
          ELSE 4 END,
     r.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.host_list_rsvp_guests(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
