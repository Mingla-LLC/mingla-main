-- INVARIANT issue-4630-brand-chat-activity-own-rows-only: issue_4630_my_brand_chat_activity and issue_4630_my_brand_chat_summary answer only about auth.uid()'s own bookings in brand Guest chats it is a non-team member of (plus the brand's public upcoming offerings); a team member, a non-member and anon get nothing; they write nothing.
--
-- #4630 Explorer brand chat polish. The Chats list ranked an empty brand chat
-- by the day the chat row was created (every brand's chat was created when
-- #4475 was applied), and the phone could not do better: the booking times
-- live in tables guests cannot read (issue_4459_rsvp_server_approvals is
-- revoked from authenticated). These read-only functions give the Explorer
-- app the caller's own times and the "Next up" banner data.
--
-- Additive only. No existing function is redefined (no issue_4459_*,
-- issue_4420_*, list_connection_conversation_access or pg_public_brand_upcoming
-- change) and no grant or policy on an existing table changes. Static SQL, no
-- data change.
--
--   issue_4630_brand_bookings(brand, user)  private helper (no client grant):
--       the user's bookings with a brand and each booking's window.
--   issue_4630_my_brand_chat_activity()     the Chats list: per brand Guest
--       chat I am a guest of, my last booking time, the last message I can see
--       and my next booking (title, start).
--   issue_4630_my_brand_chat_summary(conv)  the chat's banner: my upcoming
--       bookings, whether I have past ones, and the brand's next offerings.
--
-- Window rule (spec 4.9): an order uses its booked start (experience), else its
-- own event date, else the event's next not-ended date, else its master date;
-- an RSVP uses the next not-ended date, else the master. Ended means
-- COALESCE(end, start) < now().

-- ── 1. Private helper: my bookings with a brand ────────────────────────────
CREATE FUNCTION public.issue_4630_brand_bookings(p_brand_id uuid, p_user_id uuid)
RETURNS TABLE(kind text, booking_id uuid, event_id uuid, event_slug text, offering_type text,
              title text, cover_media_url text, starts_at timestamptz, ends_at timestamptz,
              timezone text, ticket_count integer)
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
  WITH my_orders AS (
    SELECT o.id, o.event_id, o.booked_start_at, o.event_date_id
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
     WHERE p_brand_id IS NOT NULL AND p_user_id IS NOT NULL
       AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
       AND o.payment_status IN ('paid', 'partial_refund')
       AND (o.buyer_user_id = p_user_id OR EXISTS (
             SELECT 1 FROM public.pending_trip_chat_claims pc
              WHERE pc.order_id = o.id AND pc.claimed_by_user_id = p_user_id
                AND pc.claimed_at IS NOT NULL))
  ),
  my_rsvps AS (
    SELECT r.id, r.event_id
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
     WHERE p_brand_id IS NOT NULL AND p_user_id IS NOT NULL
       AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
       AND EXISTS (SELECT 1 FROM public.issue_4459_rsvp_server_approvals sa WHERE sa.rsvp_id = r.id)
       AND (r.user_id = p_user_id OR EXISTS (
             SELECT 1 FROM public.event_rsvp_guests g
              WHERE g.rsvp_id = r.id AND g.matched_user_id = p_user_id AND g.claimed_at IS NOT NULL))
  ),
  windows AS (
    SELECT 'order'::text AS kind, o.id AS booking_id, o.event_id,
      CASE WHEN o.booked_start_at IS NOT NULL THEN o.booked_start_at
           WHEN od.start_at IS NOT NULL THEN od.start_at
           ELSE COALESCE(nd.start_at, md.start_at) END AS starts_at,
      CASE WHEN o.booked_start_at IS NOT NULL
             THEN o.booked_start_at + COALESCE(md.end_at - md.start_at, interval '0')
           WHEN od.start_at IS NOT NULL THEN od.end_at
           ELSE COALESCE(nd.end_at, md.end_at) END AS ends_at,
      COALESCE(od.timezone, nd.timezone, md.timezone) AS timezone,
      (SELECT count(*)::integer FROM public.tickets t
        WHERE t.order_id = o.id AND t.status = 'valid') AS ticket_count
      FROM my_orders o
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.end_at, d.timezone FROM public.event_dates d
         WHERE d.id = o.event_date_id AND d.event_id = o.event_id
      ) od ON true
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.end_at, d.timezone FROM public.event_dates d
         WHERE d.event_id = o.event_id AND COALESCE(d.end_at, d.start_at) >= now()
         ORDER BY d.start_at ASC LIMIT 1
      ) nd ON true
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.end_at, d.timezone FROM public.event_dates d
         WHERE d.event_id = o.event_id
         ORDER BY d.is_master DESC, d.start_at DESC LIMIT 1
      ) md ON true
    UNION ALL
    SELECT 'rsvp'::text, r.id, r.event_id,
      COALESCE(nd.start_at, md.start_at),
      COALESCE(nd.end_at, md.end_at),
      COALESCE(nd.timezone, md.timezone),
      1
      FROM my_rsvps r
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.end_at, d.timezone FROM public.event_dates d
         WHERE d.event_id = r.event_id AND COALESCE(d.end_at, d.start_at) >= now()
         ORDER BY d.start_at ASC LIMIT 1
      ) nd ON true
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.end_at, d.timezone FROM public.event_dates d
         WHERE d.event_id = r.event_id
         ORDER BY d.is_master DESC, d.start_at DESC LIMIT 1
      ) md ON true
  )
  SELECT w.kind, w.booking_id, w.event_id, e.slug, e.event_type, e.title, e.cover_media_url,
         w.starts_at, w.ends_at, COALESCE(w.timezone, e.timezone), w.ticket_count
    FROM windows w
    JOIN public.events e ON e.id = w.event_id;
$function$;

-- Server-side only: it takes a user id, so no client may call it.
REVOKE ALL ON FUNCTION public.issue_4630_brand_bookings(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4630_brand_bookings(uuid, uuid) TO service_role;

-- ── 2. The Chats list: my activity per brand Guest chat ────────────────────
CREATE FUNCTION public.issue_4630_my_brand_chat_activity()
RETURNS TABLE(conversation_id uuid, brand_id uuid, my_last_booking_at timestamptz,
              last_visible_message_at timestamptz, next_booking_title text,
              next_booking_starts_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT c.id, c.brand_id,
    GREATEST(
      (SELECT max(o.created_at) FROM public.orders o JOIN public.events e ON e.id = o.event_id
        WHERE e.brand_id = c.brand_id AND e.deleted_at IS NULL
          AND o.buyer_user_id = auth.uid()
          AND o.payment_status IN ('paid', 'partial_refund')),
      (SELECT max(sa.approved_at) FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
         JOIN public.issue_4459_rsvp_server_approvals sa ON sa.rsvp_id = r.id
        WHERE e.brand_id = c.brand_id AND e.deleted_at IS NULL
          AND r.user_id = auth.uid()
          AND r.rsvp_status = 'going' AND r.approval_status = 'approved'),
      (SELECT max(g.created_at) FROM public.event_rsvp_guests g
         JOIN public.event_rsvps r ON r.id = g.rsvp_id
         JOIN public.issue_4459_rsvp_server_approvals sa ON sa.rsvp_id = r.id
         JOIN public.events e ON e.id = r.event_id
        WHERE e.brand_id = c.brand_id AND e.deleted_at IS NULL
          AND g.matched_user_id = auth.uid() AND g.claimed_at IS NOT NULL
          AND r.rsvp_status = 'going' AND r.approval_status = 'approved'),
      (SELECT max(pc.claimed_at) FROM public.pending_trip_chat_claims pc
         JOIN public.orders o ON o.id = pc.order_id
         JOIN public.events e ON e.id = pc.event_id
        WHERE e.brand_id = c.brand_id AND e.deleted_at IS NULL
          AND pc.claimed_by_user_id = auth.uid() AND pc.claimed_at IS NOT NULL
          AND o.payment_status IN ('paid', 'partial_refund'))
    ),
    (SELECT max(m.created_at) FROM public.messages m
      WHERE m.conversation_id = c.id
        AND m.deleted_at IS NULL
        AND m.message_type IS DISTINCT FROM 'system'
        AND m.created_at >= COALESCE(me.history_visible_from, '-infinity'::timestamptz)),
    nb.title,
    nb.starts_at
    FROM public.conversations c
    JOIN public.brands b ON b.id = c.brand_id AND b.deleted_at IS NULL
    JOIN public.conversation_participants me
      ON me.conversation_id = c.id AND me.user_id = auth.uid()
    LEFT JOIN LATERAL (
      SELECT bk.title, bk.starts_at
        FROM public.issue_4630_brand_bookings(c.brand_id, auth.uid()) bk
       WHERE bk.starts_at IS NOT NULL
         AND COALESCE(bk.ends_at, bk.starts_at) >= now()
       ORDER BY bk.starts_at ASC, bk.booking_id ASC
       LIMIT 1
    ) nb ON true
   WHERE auth.uid() IS NOT NULL
     AND c.linked_entity_type = 'brand_guests' AND c.is_enabled IS TRUE
     AND NOT public.issue_4459_is_brand_team(c.brand_id, auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.issue_4630_my_brand_chat_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4630_my_brand_chat_activity() TO authenticated;

-- ── 3. The banner: my bookings and the brand's next offerings ──────────────
CREATE FUNCTION public.issue_4630_my_brand_chat_summary(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  WITH chat AS (
    SELECT c.id, c.brand_id, b.slug AS brand_slug, b.name AS brand_name
      FROM public.conversations c
      JOIN public.brands b ON b.id = c.brand_id AND b.deleted_at IS NULL
      JOIN public.conversation_participants me
        ON me.conversation_id = c.id AND me.user_id = auth.uid()
     WHERE auth.uid() IS NOT NULL
       AND c.id = p_conversation_id
       AND c.linked_entity_type = 'brand_guests' AND c.is_enabled IS TRUE
       AND NOT public.issue_4459_is_brand_team(c.brand_id, auth.uid())
  ),
  bookings AS (
    SELECT bk.* FROM chat
      CROSS JOIN LATERAL public.issue_4630_brand_bookings(chat.brand_id, auth.uid()) bk
  ),
  upcoming AS (
    SELECT bk.* FROM bookings bk
     WHERE bk.starts_at IS NOT NULL AND COALESCE(bk.ends_at, bk.starts_at) >= now()
     ORDER BY bk.starts_at ASC, bk.booking_id ASC
     LIMIT 10
  ),
  brand_next AS (
    SELECT u.offering_id, u.offering_type, u.offering_slug, u.title, u.cover_media_url, u.starts_at
      FROM chat
      CROSS JOIN LATERAL public.pg_public_brand_upcoming(chat.brand_slug, now(), 4) u
     WHERE chat.brand_slug IS NOT NULL
     ORDER BY u.starts_at ASC
     LIMIT 4
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM chat) THEN jsonb_build_object('member', false)
  ELSE jsonb_build_object(
    'member', true,
    'brandSlug', (SELECT brand_slug FROM chat),
    'brandName', (SELECT brand_name FROM chat),
    'myBookings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', u.kind, 'id', u.booking_id, 'eventId', u.event_id, 'eventSlug', u.event_slug,
        'offeringType', u.offering_type, 'title', u.title, 'coverMediaUrl', u.cover_media_url,
        'startsAt', u.starts_at, 'endsAt', u.ends_at, 'timezone', u.timezone,
        'ticketCount', u.ticket_count
      ) ORDER BY u.starts_at ASC, u.booking_id ASC) FROM upcoming u), '[]'::jsonb),
    'hasPastBookings', EXISTS (
      SELECT 1 FROM bookings bk
       WHERE bk.starts_at IS NOT NULL AND COALESCE(bk.ends_at, bk.starts_at) < now()),
    'brandUpcoming', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'offeringId', n.offering_id, 'offeringType', n.offering_type, 'offeringSlug', n.offering_slug,
        'title', n.title, 'coverMediaUrl', n.cover_media_url, 'startsAt', n.starts_at
      ) ORDER BY n.starts_at ASC) FROM brand_next n), '[]'::jsonb)
  ) END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4630_my_brand_chat_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4630_my_brand_chat_summary(uuid) TO authenticated;

-- ── 4. Self-check (as #4420): definer, pinned search_path, stable, grants ──
DO $self_check$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn, p.prosecdef, p.proconfig, p.provolatile
      FROM pg_catalog.pg_proc p
     WHERE p.oid IN ('public.issue_4630_my_brand_chat_activity()'::regprocedure,
                     'public.issue_4630_my_brand_chat_summary(uuid)'::regprocedure)
  LOOP
    IF NOT r.prosecdef OR NOT (r.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) OR r.provolatile <> 's' THEN
      RAISE EXCEPTION 'issue 4630 self-check: % is not a pinned, stable definer read', r.fn;
    END IF;
    IF has_function_privilege('anon', r.fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4630 self-check: % has the wrong grants', r.fn;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.issue_4630_brand_bookings(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4630_brand_bookings(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 4630 self-check: issue_4630_brand_bookings must stay server-side';
  END IF;
  IF (SELECT provolatile FROM pg_catalog.pg_proc
       WHERE oid = 'public.issue_4630_brand_bookings(uuid, uuid)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'issue 4630 self-check: issue_4630_brand_bookings is not stable';
  END IF;
END
$self_check$;
