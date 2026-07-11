-- ORCH-1334 [rsvp-guest-console-identity-gap] — read-time identity + provenance
-- resolution across the three RSVP read RPCs.
--
-- PROBLEM: an app RSVP stores the sentinel guest_name='Guest' (identity is meant
-- to be profile-inherited), but the READ RPCs return raw event_rsvps columns with
-- NO profiles join, so the host/admin/consumer surfaces show "Guest" for a person
-- whose identity is fully on file.
--
-- FIX (read-only, zero backfill — fixes every existing row at once): resolve
-- display_name / username / avatar_url from profiles at read time inside
-- guard-first SECURITY DEFINER functions, plus (host & admin only) email (always)
-- + phone (when present) + a source discriminator ('app' vs 'web').
--
-- The WRITE path is deliberately UNTOUCHED (submit_event_rsvp / public-submit-rsvp
-- stay as-is); the 'Guest' literal becomes harmless once reads resolve identity.
-- See SPEC_ORCH-1334_RSVP_GUEST_CONSOLE_IDENTITY.md.

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) host_list_rsvp_guests — DROP + CREATE as plpgsql SECURITY DEFINER (§4B).
--
-- ORCH-1334 — host guest identity resolves from profiles at READ time; DEFINER +
-- brand-rank event_manager guard is MANDATORY (a SECURITY INVOKER form silently
-- degraded to 'App guest'; a DEFINER WITHOUT the guard is an open per-event
-- guest-scraper). Do not remove the guard or widen the column whitelist. See
-- I-PROPOSED-1334-RSVP-HOST-LIST-DEFINER-GUARD.
--
-- Language + column-set + security-level all change → DROP-before-CREATE is
-- mandatory (RETURNS TABLE widen rule). The existing 12 columns keep their
-- byte-identical expressions and the ORDER BY CASE bucket (incl. the 'maybe'
-- bucket) is preserved byte-for-byte; 6 identity/provenance columns are APPENDED.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.host_list_rsvp_guests(uuid);
CREATE FUNCTION public.host_list_rsvp_guests(p_event_id uuid)
RETURNS TABLE (
  id uuid, event_id uuid, user_id uuid, guest_name text, guest_email text,
  guest_phone text, rsvp_status text, approval_status text, plus_count integer,
  waitlisted_at timestamptz, promoted_at timestamptz, created_at timestamptz,
  display_name text, username text, avatar_url text, email text, phone text,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- Guard-first (§4A): the same predicate the shipped write path
  -- (host_set_rsvp_status / host_bulk_approve_rsvps) and the event_rsvps_host_read
  -- RLS policy use — only an event_manager (or higher) on THIS event's brand may
  -- read its guest list. RAISE before any row is produced.
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id
      AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
            >= public.biz_role_rank('event_manager'::text)
  ) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  RETURN QUERY
  SELECT r.id, r.event_id, r.user_id, r.guest_name, r.guest_email, r.guest_phone,
         r.rsvp_status, r.approval_status, r.plus_count,
         r.waitlisted_at, r.promoted_at, r.created_at,
         -- Real name for app members; typed name for web guests; never fabricates
         -- (worst case = the honest 'Guest' literal).
         COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(r.guest_name, 'Guest'), r.guest_name)
                                                                    AS display_name,
         p.username                                                 AS username,
         p.avatar_url                                               AS avatar_url,
         -- App profile email (100% populated) OR web typed email; NULL if neither.
         COALESCE(NULLIF(btrim(p.email), ''), NULLIF(btrim(r.guest_email), ''))
                                                                    AS email,
         -- Phone: profile OR web-typed; NULL when absent — NEVER fabricated
         -- (Constitution #9 / SC-2).
         COALESCE(NULLIF(btrim(p.phone), ''), NULLIF(btrim(r.guest_phone), ''))
                                                                    AS phone,
         CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END  AS source
    FROM public.event_rsvps r
    -- Resolves ONLY the RSVP-er's own profile; rows are bounded to this event's
    -- RSVPs (whitelisted columns only → not a general profile scraper).
    LEFT JOIN public.profiles p ON p.id = r.user_id
   WHERE r.event_id = p_event_id
   ORDER BY
     CASE WHEN r.approval_status = 'pending' THEN 0
          WHEN r.rsvp_status = 'going' AND r.approval_status = 'approved' THEN 1
          WHEN r.rsvp_status = 'waitlisted' THEN 2
          WHEN r.rsvp_status = 'maybe' THEN 3
          ELSE 4 END,
     r.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.host_list_rsvp_guests(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- (b) admin_list_event_rsvps — CREATE OR REPLACE (jsonb return is schemaless to
--     the client → NO DROP). Existing is_admin_user() guard kept guard-first; a
--     profiles LEFT JOIN feeds 6 appended jsonb keys per row. Counts / total /
--     pagination / plus_guests unchanged (§4C).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_event_rsvps(
  p_event_id uuid,
  p_limit    int DEFAULT 25,
  p_offset   int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_total    bigint;
  v_rows     jsonb;
  v_counts   jsonb;
  v_capacity int;
  v_headcount bigint;
  v_limit    int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset   int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT count(*) INTO v_total FROM public.event_rsvps r WHERE r.event_id = p_event_id;
  SELECT rsvp_capacity INTO v_capacity FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(sum(1 + COALESCE(r.plus_count, 0))
                  FILTER (WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'), 0)
  INTO v_headcount
  FROM public.event_rsvps r WHERE r.event_id = p_event_id;

  SELECT jsonb_build_object(
    'going',               count(*) FILTER (WHERE r.rsvp_status = 'going'),
    'not_going',           count(*) FILTER (WHERE r.rsvp_status = 'not_going'),
    'waitlisted',          count(*) FILTER (WHERE r.rsvp_status = 'waitlisted'),
    'maybe',               count(*) FILTER (WHERE r.rsvp_status = 'maybe'),
    'pending',             count(*) FILTER (WHERE r.approval_status = 'pending'),
    'approved',            count(*) FILTER (WHERE r.approval_status = 'approved'),
    'denied',              count(*) FILTER (WHERE r.approval_status = 'denied'),
    'confirmed_attending', count(*) FILTER (WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'),
    'total_headcount',     v_headcount,
    'capacity',            v_capacity,
    'capacity_remaining',  CASE WHEN v_capacity IS NULL THEN NULL ELSE v_capacity - v_headcount END
  )
  INTO v_counts
  FROM public.event_rsvps r WHERE r.event_id = p_event_id;

  -- ORCH-1334: LEFT JOIN profiles in the ranked CTE to resolve app-member identity
  -- (whitelisted columns only) + a source discriminator. The 'Guest' sentinel
  -- resolves to the real profile name at read time.
  WITH ranked AS (
    SELECT r.*,
           p.display_name AS profile_display_name,
           p.username     AS profile_username,
           p.avatar_url   AS profile_avatar_url,
           p.email        AS profile_email,
           p.phone        AS profile_phone,
           row_number() OVER (ORDER BY r.created_at DESC, r.id) AS rn
    FROM public.event_rsvps r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE r.event_id = p_event_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'rsvp_id',         r.id,
      'guest_name',      r.guest_name,
      'guest_email',     r.guest_email,
      'guest_phone',     r.guest_phone,
      'user_id',         r.user_id,
      'rsvp_status',     r.rsvp_status,
      'approval_status', r.approval_status,
      'plus_count',      r.plus_count,
      'waitlisted_at',   r.waitlisted_at,
      'promoted_at',     r.promoted_at,
      'created_at',      r.created_at,
      -- ORCH-1334 appended identity/provenance keys (whitelisted profile columns).
      'display_name',    COALESCE(NULLIF(btrim(r.profile_display_name), ''), NULLIF(r.guest_name, 'Guest'), r.guest_name),
      'username',        r.profile_username,
      'avatar_url',      r.profile_avatar_url,
      'email',           COALESCE(NULLIF(btrim(r.profile_email), ''), NULLIF(btrim(r.guest_email), '')),
      'phone',           COALESCE(NULLIF(btrim(r.profile_phone), ''), NULLIF(btrim(r.guest_phone), '')),
      'source',          CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END,
      'plus_guests', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', g.name, 'email', g.email, 'phone', g.phone) ORDER BY g.created_at)
        FROM public.event_rsvp_guests g WHERE g.rsvp_id = r.id
      ), '[]'::jsonb)
    ) ORDER BY r.rn
  ), '[]'::jsonb)
  INTO v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0), 'counts', v_counts);
END;
$$;

-- Least-privilege lockdown re-asserted (idempotent; signature unchanged so the
-- CREATE OR REPLACE preserves existing grants — re-emit for clarity/safety).
REVOKE EXECUTE ON FUNCTION public.admin_list_event_rsvps(uuid,int,int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_event_rsvps(uuid,int,int) TO authenticated;

-- ---------------------------------------------------------------------------
-- (c) fetch_user_going_rsvps — CREATE OR REPLACE (RETURNS TABLE column set/order
--     UNCHANGED → no DROP). SELF-FACING: only the display_name EXPRESSION changes
--     (resolved from profiles on BOTH branches). NO email/phone/contact columns
--     added — I-PROPOSED-1334-RSVP-CONSUMER-SELF-IDENTITY-ONLY (§4D, C-CONSUMER).
--     Self-scoping WHERE clauses (r.user_id = p_user_id / g.matched_user_id =
--     p_user_id) preserved byte-identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_user_going_rsvps(p_user_id uuid)
RETURNS TABLE (
  rsvp_id         uuid,
  guest_id        uuid,
  role            text,           -- 'primary' | 'guest'
  qr_code         text,
  rsvp_status     text,
  approval_status text,
  plus_count      integer,
  display_name    text,
  invited_by      text,
  event_id        uuid,
  event_title     text,
  event_slug      text,
  cover_media_url text,
  timezone        text,
  location_text   text,
  is_online       boolean,
  online_url      text,
  brand_id        uuid,
  brand_slug      text,
  brand_name      text,
  master_start_at timestamptz,
  master_end_at   timestamptz,
  created_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $function$
  -- (a) primary rows — the user is the RSVP-er. ORCH-1334: display_name resolves
  -- from the RSVP-er's OWN profile (self-scoped by r.user_id = p_user_id).
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
    r.created_at
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

  -- (b) matched-guest rows — the user is a verified plus-one on a going RSVP.
  -- ORCH-1334: display_name resolves from the MATCHED user's OWN profile
  -- (self-scoped by g.matched_user_id = p_user_id).
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
    g.created_at
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
$function$;

GRANT EXECUTE ON FUNCTION public.fetch_user_going_rsvps(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
