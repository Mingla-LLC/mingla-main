-- Issue #871 — replace the peer roster with exact attendance entitlement.
BEGIN;

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
           (1 + r.plus_count)::integer AS party_size, r.created_at
      FROM public.event_rsvps r
     WHERE v_event.event_type = 'rsvp'
       AND r.event_id = v_event.id
       AND r.rsvp_status = 'going'
       AND r.approval_status = 'approved'
    UNION ALL
    SELECT o.id, o.buyer_user_id, COUNT(t.id)::integer, o.created_at
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
     GROUP BY o.id, o.buyer_user_id, o.created_at
  ), privacy_final AS (
    SELECT a.row_id, a.party_size, a.created_at,
           a.linked_user_id IS NOT NULL AS is_mingla_user,
           a.linked_user_id IS NOT NULL
             AND p.visibility_mode IN ('public', 'friends') AS is_named,
           CASE WHEN a.linked_user_id IS NOT NULL
                  AND p.visibility_mode IN ('public', 'friends') THEN p.id END AS profile_id,
           CASE WHEN a.linked_user_id IS NOT NULL
                  AND p.visibility_mode IN ('public', 'friends') THEN p.display_name END AS display_name,
           CASE WHEN a.linked_user_id IS NOT NULL
                  AND p.visibility_mode IN ('public', 'friends') THEN p.username END AS username,
           CASE WHEN a.linked_user_id IS NOT NULL
                  AND p.visibility_mode IN ('public', 'friends') THEN p.avatar_url END AS avatar_url,
           CASE WHEN a.linked_user_id IS NOT NULL
                  AND p.visibility_mode IN ('public', 'friends') THEN p.location END AS location
      FROM attendance a
      LEFT JOIN public.profiles p ON p.id = a.linked_user_id
     WHERE a.linked_user_id IS NULL OR (
       NOT public.is_blocked_by(a.linked_user_id, v_viewer)
       AND NOT public.is_blocked_by(v_viewer, a.linked_user_id)
     )
  ), page AS (
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
     ORDER BY
       CASE
         WHEN p.is_named AND NULLIF(btrim(p.avatar_url), '') IS NOT NULL THEN 0
         WHEN p.is_named THEN 1
         ELSE 2
       END,
       p.created_at ASC,
       p.row_id ASC
     LIMIT v_limit + 1 OFFSET v_offset
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
         COUNT(*)::integer
    INTO v_guests, v_fetched
    FROM page p;

  RETURN json_build_object(
    'eventId', v_event.id,
    'entityType', v_event.event_type,
    'returned', LEAST(v_fetched, v_limit),
    'hasMore', v_fetched > v_limit,
    'nextOffset', CASE WHEN v_fetched > v_limit THEN v_offset + v_limit ELSE NULL END,
    'guests', v_guests
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.peer_list_event_guests(uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_list_event_guests(uuid, integer, integer)
  TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
