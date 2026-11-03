-- #4251 — Explorer Purchases and Calendar draw the striped "COVER" placeholder
-- for every RSVP because fetch_user_going_rsvps returns cover_media_url but not
-- cover_media_type, and the cover renderer needs the type to choose image,
-- video or gif.
--
-- This redefines fetch_user_going_rsvps with ONE new column, cover_media_type
-- (events.cover_media_type, text, CHECK IN ('image','video','gif') OR NULL),
-- appended LAST so every existing column keeps its name and position. The body
-- is the ORCH-1392 definition (20270104000000) verbatim: same self-scope gate,
-- same two-branch UNION ALL, same SECURITY DEFINER, STABLE and search_path.
--
-- A RETURNS TABLE change cannot go through CREATE OR REPLACE, so the function
-- is dropped and re-created inside one transaction and its ORCH-1392 grants are
-- restated exactly (anon and PUBLIC revoked; authenticated and service_role).
--
-- Callers checked: app-mobile calendarService.fetchUserGoingRsvps (reads by
-- name), mingla-business rsvpOwnReplyService (reads by name), and
-- public.brand_enquiry_my_plans (plpgsql, selects named columns from the
-- function, so the extra column is ignored and plpgsql bodies do not block the
-- DROP). No column is removed or renamed.
--
-- Static SQL only. No table DDL, no RLS change, no data change.

BEGIN;

DROP FUNCTION IF EXISTS public.fetch_user_going_rsvps(uuid);

CREATE FUNCTION public.fetch_user_going_rsvps(p_user_id uuid)
RETURNS TABLE(rsvp_id uuid, guest_id uuid, role text, qr_code text, rsvp_status text, approval_status text, plus_count integer, display_name text, invited_by text, event_id uuid, event_title text, event_slug text, cover_media_url text, timezone text, location_text text, is_online boolean, online_url text, brand_id uuid, brand_slug text, brand_name text, master_start_at timestamp with time zone, master_end_at timestamp with time zone, created_at timestamp with time zone, cover_media_type text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- ORCH-1392: self-scope gate. anon is revoked at the grant layer; an
  -- authenticated caller may only read their OWN rows. service_role
  -- (auth.uid() IS NULL) is the trusted edge-function path and bypasses.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id          AS rsvp_id,
    NULL::uuid    AS guest_id,
    'primary'     AS role,
    r.qr_code,
    r.rsvp_status,
    r.approval_status,
    r.plus_count,
    COALESCE(NULLIF(btrim(pr.display_name), ''), NULLIF(r.guest_name, 'Guest'), r.guest_name) AS display_name,
    NULL::text    AS invited_by,
    e.id          AS event_id,
    e.title       AS event_title,
    e.slug        AS event_slug,
    e.cover_media_url,
    e.timezone,
    e.location_text,
    e.is_online,
    e.online_url,
    b.id          AS brand_id,
    b.slug        AS brand_slug,
    b.name        AS brand_name,
    ed.start_at   AS master_start_at,
    ed.end_at     AS master_end_at,
    r.created_at,
    e.cover_media_type
  FROM public.event_rsvps r
  JOIN public.events e ON e.id = r.event_id
  JOIN public.brands b ON b.id = e.brand_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  LEFT JOIN public.profiles pr ON pr.id = r.user_id
  WHERE r.user_id = p_user_id
    AND r.rsvp_status = 'going'
    AND r.approval_status IN ('approved', 'pending')
    AND e.deleted_at IS NULL

  UNION ALL

  SELECT
    r.id          AS rsvp_id,
    g.id          AS guest_id,
    'guest'       AS role,
    g.qr_code,
    r.rsvp_status,
    r.approval_status,
    r.plus_count,
    COALESCE(NULLIF(btrim(pg.display_name), ''), g.name) AS display_name,
    r.guest_name  AS invited_by,
    e.id          AS event_id,
    e.title       AS event_title,
    e.slug        AS event_slug,
    e.cover_media_url,
    e.timezone,
    e.location_text,
    e.is_online,
    e.online_url,
    b.id          AS brand_id,
    b.slug        AS brand_slug,
    b.name        AS brand_name,
    ed.start_at   AS master_start_at,
    ed.end_at     AS master_end_at,
    g.created_at,
    e.cover_media_type
  FROM public.event_rsvp_guests g
  JOIN public.event_rsvps r ON r.id = g.rsvp_id
  JOIN public.events e ON e.id = r.event_id
  JOIN public.brands b ON b.id = e.brand_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  LEFT JOIN public.profiles pg ON pg.id = g.matched_user_id
  WHERE g.matched_user_id = p_user_id
    AND r.rsvp_status = 'going'
    AND r.approval_status IN ('approved', 'pending')
    AND e.deleted_at IS NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fetch_user_going_rsvps(p_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_user_going_rsvps(p_user_id uuid) TO authenticated, service_role;

COMMIT;
