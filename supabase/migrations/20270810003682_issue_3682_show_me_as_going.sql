-- #3682 Wave 2.8 — Who's going privacy (design contract surface J).
-- Per-event "Show me as going" defaults OFF. Friends always see friends'
-- names; everyone else sees only opted-in names, with anonymous seats
-- counted (party/ticket unit) as "M keep it private" inside goingCount.

BEGIN;

ALTER TABLE public.event_rsvps
  ADD COLUMN IF NOT EXISTS show_me_as_going boolean NOT NULL DEFAULT false;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS show_me_as_going boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_rsvps.show_me_as_going IS
  '#3682 — guest opted to show their name on Who''s going for this RSVP. Default off.';
COMMENT ON COLUMN public.orders.show_me_as_going IS
  '#3682 — buyer opted to show their name on Who''s going for this paid order. Default off.';

-- Owner-only write guard: host/staff table UPDATE policies must not flip consent.
CREATE OR REPLACE FUNCTION public.tg_show_me_as_going_owner_only()
RETURNS trigger
LANGUAGE plpgsql
AS $g$
BEGIN
  IF OLD.show_me_as_going IS NOT DISTINCT FROM NEW.show_me_as_going THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'orders'
     AND auth.uid() IS NOT NULL
     AND auth.uid() = NEW.buyer_user_id THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'event_rsvps'
     AND auth.uid() IS NOT NULL
     AND auth.uid() = NEW.user_id THEN
    RETURN NEW;
  END IF;
  -- Migrations / CI seeds: privileged role, no JWT.
  IF auth.uid() IS NULL AND current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'show_me_as_going_owner_only' USING ERRCODE = '42501';
END;
$g$;

DROP TRIGGER IF EXISTS trg_orders_show_me_as_going_owner_only ON public.orders;
CREATE TRIGGER trg_orders_show_me_as_going_owner_only
  BEFORE UPDATE OF show_me_as_going ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_show_me_as_going_owner_only();

DROP TRIGGER IF EXISTS trg_event_rsvps_show_me_as_going_owner_only ON public.event_rsvps;
CREATE TRIGGER trg_event_rsvps_show_me_as_going_owner_only
  BEFORE UPDATE OF show_me_as_going ON public.event_rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_show_me_as_going_owner_only();

-- Multi-order / claim: inherit any prior opt-in for the same buyer+event.
CREATE OR REPLACE FUNCTION public.tg_orders_show_me_as_going_propagate()
RETURNS trigger
LANGUAGE plpgsql
AS $p$
DECLARE
  v_opted boolean;
BEGIN
  IF NEW.buyer_user_id IS NULL OR NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.buyer_user_id IS NOT DISTINCT FROM NEW.buyer_user_id
     AND OLD.show_me_as_going IS NOT DISTINCT FROM NEW.show_me_as_going THEN
    RETURN NEW;
  END IF;
  SELECT bool_or(o.show_me_as_going) INTO v_opted
    FROM public.orders o
   WHERE o.event_id = NEW.event_id
     AND o.buyer_user_id = NEW.buyer_user_id
     AND (TG_OP = 'INSERT' OR o.id IS DISTINCT FROM NEW.id);
  IF COALESCE(v_opted, false) THEN
    NEW.show_me_as_going := true;
  END IF;
  RETURN NEW;
END;
$p$;

DROP TRIGGER IF EXISTS trg_orders_show_me_as_going_propagate ON public.orders;
CREATE TRIGGER trg_orders_show_me_as_going_propagate
  BEFORE INSERT OR UPDATE OF buyer_user_id ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_orders_show_me_as_going_propagate();

-- Setter: authenticated guest flips their own attendance row.
CREATE OR REPLACE FUNCTION public.biz_set_show_me_as_going(
  p_event_id uuid,
  p_show boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_viewer uuid := auth.uid();
  v_event record;
  v_updated integer := 0;
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;
  IF p_event_id IS NULL OR p_show IS NULL THEN
    RAISE EXCEPTION 'invalid_show_me_as_going' USING ERRCODE = '22023';
  END IF;

  SELECT e.id, e.event_type, e.status
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status IN ('scheduled', 'live')
     AND e.event_type IN ('rsvp', 'event', 'trip', 'experience');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_available' USING ERRCODE = 'P0002';
  END IF;

  IF v_event.event_type = 'rsvp' THEN
    UPDATE public.event_rsvps r
       SET show_me_as_going = p_show
     WHERE r.event_id = v_event.id
       AND r.user_id = v_viewer
       AND r.rsvp_status = 'going'
       AND r.approval_status = 'approved';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSE
    UPDATE public.orders o
       SET show_me_as_going = p_show
     WHERE o.event_id = v_event.id
       AND o.buyer_user_id = v_viewer
       AND o.payment_status IN ('paid', 'partial_refund')
       AND EXISTS (
         SELECT 1
           FROM public.tickets t
          WHERE t.order_id = o.id
            AND t.approval_status IN ('auto', 'approved')
            AND (
              (v_event.status = 'scheduled' AND t.status = 'valid')
              OR (v_event.status = 'live' AND t.status IN ('valid', 'used'))
            )
       );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'attendance_required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'eventId', v_event.id,
    'showMeAsGoing', p_show
  );
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_set_show_me_as_going(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_set_show_me_as_going(uuid, boolean)
  TO authenticated;

DROP FUNCTION IF EXISTS public.peer_list_event_guests(uuid, integer, integer);

CREATE FUNCTION public.peer_list_event_guests(
  p_event_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_event record;
  v_limit integer;
  v_offset integer;
  v_guests json := '[]'::json;
  v_fetched integer := 0;
  v_private_others integer := 0;
  v_viewer_show boolean := NULL;
BEGIN
  -- Guard 1: authentication, before any attendance read.
  IF v_viewer IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  -- Guard 2: only a public, current offering owned by a live brand.
  SELECT e.id, e.event_type, e.status, e.theme INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.visibility = 'public'
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status IN ('scheduled', 'live')
     AND e.event_type IN ('rsvp', 'event', 'trip', 'experience');
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_available'; END IF;

  -- Guard 3: host privacy remains absolute, even for an attendee.
  IF COALESCE(
    (v_event.theme #>> '{business_event,settings,privateGuestList}')::boolean,
    false
  ) THEN RAISE EXCEPTION 'guest_list_private'; END IF;

  -- Guard 4: exact primary attendance. Email, phone, plus-one and transferred
  -- ticket identity are deliberately insufficient.
  IF v_event.event_type = 'rsvp' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.event_rsvps r
       WHERE r.event_id = v_event.id
         AND r.user_id = v_viewer
         AND r.rsvp_status = 'going'
         AND r.approval_status = 'approved'
    ) THEN RAISE EXCEPTION 'attendance_required'; END IF;
  ELSIF v_event.event_type IN ('event', 'trip', 'experience') THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.orders o
        JOIN public.tickets t ON t.order_id = o.id
       WHERE o.event_id = v_event.id
         AND o.buyer_user_id = v_viewer
         AND o.payment_status IN ('paid', 'partial_refund')
         AND t.approval_status IN ('auto', 'approved')
         AND (
           (v_event.status = 'scheduled' AND t.status = 'valid') OR
           (v_event.status = 'live' AND t.status IN ('valid', 'used'))
         )
    ) THEN RAISE EXCEPTION 'attendance_required'; END IF;
  ELSE
    RAISE EXCEPTION 'event_not_available';
  END IF;

  -- Clamp only after every disclosure guard.
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  WITH attendance AS (
    SELECT r.id AS row_id, r.user_id AS linked_user_id,
           (1 + r.plus_count)::integer AS party_size, r.created_at,
           r.show_me_as_going
      FROM public.event_rsvps r
     WHERE v_event.event_type = 'rsvp'
       AND r.event_id = v_event.id
       AND r.rsvp_status = 'going'
       AND r.approval_status = 'approved'
    UNION ALL
    SELECT o.id, o.buyer_user_id, COUNT(t.id)::integer, o.created_at,
           o.show_me_as_going
      FROM public.orders o
      JOIN public.tickets t ON t.order_id = o.id
     WHERE v_event.event_type IN ('event', 'trip', 'experience')
       AND o.event_id = v_event.id
       AND o.payment_status IN ('paid', 'partial_refund')
       AND t.approval_status IN ('auto', 'approved')
       AND (
         (v_event.status = 'scheduled' AND t.status = 'valid') OR
         (v_event.status = 'live' AND t.status IN ('valid', 'used'))
       )
     GROUP BY o.id, o.buyer_user_id, o.created_at, o.show_me_as_going
  ), user_opted AS (
    -- Per-user opt-in across every paid/RSVP attendance row for this event.
    SELECT a.linked_user_id, bool_or(a.show_me_as_going) AS opted
      FROM attendance a
     WHERE a.linked_user_id IS NOT NULL
     GROUP BY a.linked_user_id
  ), privacy_final AS (
    SELECT a.row_id, a.party_size, a.created_at,
           a.linked_user_id IS NOT NULL AS is_mingla_user,
           -- #3682 J: named when self, accepted friend, or user-level opt-in.
           a.linked_user_id IS NOT NULL AND (
             a.linked_user_id = v_viewer
             OR EXISTS (
               SELECT 1 FROM public.friends f
                WHERE f.status = 'accepted'
                  AND f.deleted_at IS NULL
                  AND (
                    (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                    OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                  )
             )
             OR COALESCE(uo.opted, false)
           ) AS is_named,
           CASE WHEN a.linked_user_id IS NOT NULL AND (
                  a.linked_user_id = v_viewer
                  OR EXISTS (
                    SELECT 1 FROM public.friends f
                     WHERE f.status = 'accepted'
                       AND f.deleted_at IS NULL
                       AND (
                         (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                         OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                       )
                  )
                  OR COALESCE(uo.opted, false)
                ) THEN p.id END AS profile_id,
           CASE WHEN a.linked_user_id IS NOT NULL AND (
                  a.linked_user_id = v_viewer
                  OR EXISTS (
                    SELECT 1 FROM public.friends f
                     WHERE f.status = 'accepted'
                       AND f.deleted_at IS NULL
                       AND (
                         (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                         OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                       )
                  )
                  OR COALESCE(uo.opted, false)
                ) THEN p.display_name END AS display_name,
           CASE WHEN a.linked_user_id IS NOT NULL AND (
                  a.linked_user_id = v_viewer
                  OR EXISTS (
                    SELECT 1 FROM public.friends f
                     WHERE f.status = 'accepted'
                       AND f.deleted_at IS NULL
                       AND (
                         (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                         OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                       )
                  )
                  OR COALESCE(uo.opted, false)
                ) THEN p.username END AS username,
           CASE WHEN a.linked_user_id IS NOT NULL AND (
                  a.linked_user_id = v_viewer
                  OR EXISTS (
                    SELECT 1 FROM public.friends f
                     WHERE f.status = 'accepted'
                       AND f.deleted_at IS NULL
                       AND (
                         (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                         OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                       )
                  )
                  OR COALESCE(uo.opted, false)
                ) THEN p.avatar_url END AS avatar_url,
           CASE WHEN a.linked_user_id IS NOT NULL AND (
                  a.linked_user_id = v_viewer
                  OR EXISTS (
                    SELECT 1 FROM public.friends f
                     WHERE f.status = 'accepted'
                       AND f.deleted_at IS NULL
                       AND (
                         (f.user_id = v_viewer AND f.friend_user_id = a.linked_user_id)
                         OR (f.friend_user_id = v_viewer AND f.user_id = a.linked_user_id)
                       )
                  )
                  OR COALESCE(uo.opted, false)
                ) THEN p.location END AS location
      FROM attendance a
      LEFT JOIN user_opted uo ON uo.linked_user_id = a.linked_user_id
      LEFT JOIN public.profiles p ON p.id = a.linked_user_id
     WHERE a.linked_user_id IS NULL OR (
       NOT public.is_blocked_by(a.linked_user_id, v_viewer)
       AND NOT public.is_blocked_by(v_viewer, a.linked_user_id)
     )
  ), ranked AS (
    SELECT p.*,
           row_number() OVER (
             ORDER BY
               CASE
                 WHEN p.is_named AND NULLIF(btrim(p.avatar_url), '') IS NOT NULL THEN 0
                 WHEN p.is_named THEN 1
                 ELSE 2
               END,
               p.created_at ASC,
               p.row_id ASC
           ) AS rn
      FROM privacy_final p
  ), page AS (
    SELECT r.*
      FROM ranked r
     WHERE r.rn > v_offset
       AND r.rn <= v_offset + v_limit + 1
  ), aggregates AS (
    SELECT
      -- Same unit as goingCount (party size / ticket count), so the sheet can
      -- say "N going · M keep it private" without mixing row counts into seats.
      (SELECT COALESCE(SUM(pf.party_size), 0)::integer
         FROM privacy_final pf WHERE NOT pf.is_named) AS private_others,
      (
        SELECT bool_or(a.show_me_as_going)
          FROM attendance a
         WHERE a.linked_user_id = v_viewer
      ) AS viewer_show,
      (SELECT COUNT(*)::integer FROM page) AS fetched
  )
  SELECT COALESCE(json_agg(json_build_object(
           'profileId', p.profile_id,
           'displayName', p.display_name,
           'username', p.username,
           'avatarUrl', p.avatar_url,
           'location', p.location,
           'isMinglaUser', p.is_mingla_user,
           'isAnonymous', NOT p.is_named,
           'partySize', p.party_size
         ) ORDER BY p.rn) FILTER (WHERE p.rn <= v_offset + v_limit), '[]'::json),
         ag.fetched,
         ag.private_others,
         ag.viewer_show
    INTO v_guests, v_fetched, v_private_others, v_viewer_show
    FROM aggregates ag
    LEFT JOIN page p ON true
   GROUP BY ag.fetched, ag.private_others, ag.viewer_show;

  RETURN json_build_object(
    'eventId', v_event.id,
    'entityType', v_event.event_type,
    'returned', LEAST(v_fetched, v_limit),
    'hasMore', v_fetched > v_limit,
    'nextOffset', CASE WHEN v_fetched > v_limit THEN v_offset + v_limit ELSE NULL END,
    'guests', COALESCE(v_guests, '[]'::json),
    'privateOthersCount', COALESCE(v_private_others, 0),
    'viewerShowMeAsGoing', v_viewer_show
  );
END;
$function$;

COMMENT ON FUNCTION public.peer_list_event_guests(uuid, integer, integer) IS
  '#871 entitled roster + #3682 Show me as going. Authed attendees only. '
  'Named rows: self, accepted friends, or show_me_as_going. Others anonymous; '
  'privateOthersCount (party/ticket seats) feeds "M keep it private".';

REVOKE ALL ON FUNCTION public.peer_list_event_guests(uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_list_event_guests(uuid, integer, integer)
  TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
