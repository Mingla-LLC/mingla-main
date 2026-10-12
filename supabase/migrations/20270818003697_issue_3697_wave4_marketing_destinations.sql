-- toward #3697 Wave 4 — Phase 2 marketing destinations (B1)
-- Static usemingla.com allowlist as page_type=marketing (sentinel brand_slug=mingla).
-- Do NOT auto-apply — Management API post-merge.

BEGIN;

-- ── Widen dest_page_type CHECKs (additive) ───────────────────────────────────
ALTER TABLE public.ad_campaigns
  DROP CONSTRAINT IF EXISTS ad_campaigns_dest_page_type_check;
ALTER TABLE public.ad_campaigns
  ADD CONSTRAINT ad_campaigns_dest_page_type_check CHECK (
    dest_page_type IN (
      'event', 'rsvp', 'trip', 'experience', 'brand', 'venue', 'reservation',
      'site', 'marketing'
    )
  );

ALTER TABLE public.ad_attribution_touches
  DROP CONSTRAINT IF EXISTS ad_attribution_touches_dest_page_type_check;
ALTER TABLE public.ad_attribution_touches
  ADD CONSTRAINT ad_attribution_touches_dest_page_type_check CHECK (
    dest_page_type IS NULL
    OR dest_page_type IN (
      'event', 'rsvp', 'trip', 'experience', 'brand', 'venue', 'reservation',
      'site', 'marketing'
    )
  );

-- Canonical marketing origin (mirrors MARKETING_WEB_ORIGIN / SITE_ORIGIN).
CREATE OR REPLACE FUNCTION public.ad_marketing_web_origin()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT 'https://usemingla.com'::text;
$function$;

REVOKE EXECUTE ON FUNCTION public.ad_marketing_web_origin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_marketing_web_origin() TO authenticated, service_role;

-- Allowlisted marketing landings (ids stable; match adDestination.ts MARKETING_ROUTES).
CREATE OR REPLACE FUNCTION public.ad_marketing_route_rows()
RETURNS TABLE (
  id uuid,
  entity_slug text,
  path text,
  title text,
  result_kind text
)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT * FROM (VALUES
    ('36970000-0004-4000-8000-000000000001'::uuid, 'explorer', '/', 'Mingla Explorer home', 'installs'),
    ('36970000-0004-4000-8000-000000000002'::uuid, 'host', '/host', 'Mingla Host home', 'installs'),
    ('36970000-0004-4000-8000-000000000003'::uuid, 'download', '/download', 'Explorer app download', 'installs'),
    ('36970000-0004-4000-8000-000000000004'::uuid, 'host-download', '/host/download', 'Host app download', 'installs'),
    ('36970000-0004-4000-8000-000000000005'::uuid, 'tools', '/tools', 'Free Host tools', 'clicks'),
    ('36970000-0004-4000-8000-000000000006'::uuid, 'tools-events', '/tools/events', 'Event turnout tool', 'clicks'),
    ('36970000-0004-4000-8000-000000000007'::uuid, 'tools-venues', '/tools/venues', 'Venue grader tool', 'clicks'),
    ('36970000-0004-4000-8000-000000000008'::uuid, 'tools-trips', '/tools/trips', 'Trip quote tool', 'clicks'),
    ('36970000-0004-4000-8000-000000000009'::uuid, 'tools-pricing', '/tools/pricing', 'Pricing audit tool', 'clicks')
  ) AS t(id, entity_slug, path, title, result_kind);
$function$;

REVOKE EXECUTE ON FUNCTION public.ad_marketing_route_rows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_marketing_route_rows() TO authenticated, service_role;

-- ── Resolve wrap: marketing short-circuit, else Wave 1 body ──────────────────
ALTER FUNCTION public.ad_destination_resolve(text, text, text)
  RENAME TO ad_destination_resolve_wave1;

CREATE OR REPLACE FUNCTION public.ad_destination_resolve(
  p_page_type text,
  p_brand_slug text,
  p_entity_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_origin text := public.ad_marketing_web_origin();
  v_brand text := lower(btrim(coalesce(p_brand_slug, '')));
  v_entity text := lower(btrim(coalesce(p_entity_slug, '')));
  v_route record;
  v_url text;
BEGIN
  IF p_page_type = 'marketing' THEN
    IF v_brand <> '' AND v_brand <> 'mingla' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_brand_slug_invalid',
        'page_type', 'marketing',
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    IF v_entity = '' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_entity_slug_required',
        'page_type', 'marketing',
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    SELECT r.* INTO v_route
    FROM public.ad_marketing_route_rows() r
    WHERE r.entity_slug = v_entity
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
        'page_type', 'marketing',
        'brand_slug', 'mingla',
        'entity_slug', v_entity,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    v_url := CASE
      WHEN v_route.path = '/' THEN v_origin || '/'
      ELSE v_origin || v_route.path
    END;
    RETURN jsonb_build_object(
      'ok', true,
      'page_type', 'marketing',
      'id', v_route.id,
      'brand_id', NULL,
      'brand_slug', 'mingla',
      'entity_slug', v_route.entity_slug,
      'event_id', NULL,
      'venue_id', NULL,
      'title', v_route.title,
      'brand_name', 'Mingla',
      'starts_at', NULL,
      'city', NULL,
      'cover_url', NULL,
      'canonical_url', v_url,
      'availability', 'available',
      'availability_reason', NULL,
      'result_kind', v_route.result_kind
    );
  END IF;

  RETURN public.ad_destination_resolve_wave1(p_page_type, p_brand_slug, p_entity_slug);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ad_destination_resolve(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_destination_resolve(text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ad_destination_resolve(text, text, text) IS
  '#3697 Wave 4: wrap — marketing allowlist + Wave 1 resolve.';

REVOKE EXECUTE ON FUNCTION public.ad_destination_resolve_wave1(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_destination_resolve_wave1(text, text, text)
  TO service_role;

-- ── List: Wave 1 body + marketing allowlist rows ─────────────────────────────
CREATE OR REPLACE FUNCTION public.ad_advertisable_pages(
  p_query text DEFAULT NULL,
  p_types text[] DEFAULT NULL,
  p_include_unavailable boolean DEFAULT false,
  p_brand_id uuid DEFAULT NULL,
  p_page integer DEFAULT 0
)
RETURNS TABLE (
  page_type text,
  id uuid,
  brand_slug text,
  entity_slug text,
  title text,
  brand_name text,
  starts_at timestamptz,
  city text,
  cover_url text,
  canonical_url text,
  availability text,
  availability_reason text,
  result_kind text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_page integer := greatest(coalesce(p_page, 0), 0);
  v_page_size integer := 24;
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_like text;
  v_types text[];
  v_is_admin boolean := public.is_admin_user();
  v_brand_member boolean := false;
BEGIN
  IF p_brand_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.brand_team_members m
      WHERE m.brand_id = p_brand_id
        AND m.user_id = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.removed_at IS NULL
    ) INTO v_brand_member;
  END IF;

  IF NOT v_is_admin AND NOT (p_brand_id IS NOT NULL AND v_brand_member) THEN
    RAISE EXCEPTION 'ad_advertisable_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_types IS NULL OR cardinality(p_types) = 0 THEN
    v_types := ARRAY[
      'event', 'rsvp', 'trip', 'experience', 'brand', 'venue', 'reservation',
      'site', 'marketing'
    ];
  ELSE
    v_types := p_types;
  END IF;

  IF v_q IS NOT NULL THEN
    v_like := '%' || public.ad_escape_ilike(v_q) || '%';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      CASE e.event_type
        WHEN 'event' THEN 'event'
        WHEN 'rsvp' THEN 'rsvp'
        WHEN 'trip' THEN 'trip'
        WHEN 'experience' THEN 'experience'
      END AS page_type,
      e.id,
      e.brand_slug,
      e.slug AS entity_slug,
      e.title,
      e.brand_name,
      e.master_start_at AS starts_at,
      e.city,
      e.cover_media_url AS cover_url,
      e.brand_id
    FROM public.business_public_events_view e
    WHERE e.event_type = ANY (ARRAY['event', 'rsvp', 'trip', 'experience'])
      AND (p_brand_id IS NULL OR e.brand_id = p_brand_id)
      AND (
        e.event_type <> 'rsvp'
        OR coalesce(e.rsvp_discoverable, false) IS TRUE
        OR p_include_unavailable
      )
      AND (
        v_like IS NULL
        OR e.title ILIKE v_like ESCAPE '\'
        OR e.brand_name ILIKE v_like ESCAPE '\'
        OR e.slug ILIKE v_like ESCAPE '\'
        OR coalesce(e.city, '') ILIKE v_like ESCAPE '\'
        OR e.brand_slug ILIKE v_like ESCAPE '\'
      )

    UNION ALL

    SELECT
      'brand',
      b.id,
      b.slug,
      NULL::text,
      b.name,
      b.name,
      NULL::timestamptz,
      NULL::text,
      b.profile_photo_url,
      b.id
    FROM public.business_public_brands_view b
    WHERE (p_brand_id IS NULL OR b.id = p_brand_id)
      AND (
        v_like IS NULL
        OR b.name ILIKE v_like ESCAPE '\'
        OR b.slug ILIKE v_like ESCAPE '\'
      )

    UNION ALL

    SELECT
      'venue',
      s.id,
      s.brand_slug,
      s.slug,
      s.title,
      s.brand_name,
      NULL::timestamptz,
      s.city,
      s.cover_media_url,
      s.brand_id
    FROM public.ad_public_stay_destinations_view s
    WHERE (p_brand_id IS NULL OR s.brand_id = p_brand_id)
      AND (
        v_like IS NULL
        OR s.title ILIKE v_like ESCAPE '\'
        OR s.brand_name ILIKE v_like ESCAPE '\'
        OR s.slug ILIKE v_like ESCAPE '\'
        OR coalesce(s.city, '') ILIKE v_like ESCAPE '\'
        OR s.brand_slug ILIKE v_like ESCAPE '\'
      )

    UNION ALL

    SELECT
      'reservation',
      s.id,
      s.brand_slug,
      s.slug,
      s.title,
      s.brand_name,
      NULL::timestamptz,
      s.city,
      s.cover_media_url,
      s.brand_id
    FROM public.ad_public_stay_destinations_view s
    WHERE (p_brand_id IS NULL OR s.brand_id = p_brand_id)
      AND EXISTS (
        SELECT 1 FROM public.venue_reservation_settings vrs
        WHERE vrs.venue_id = s.id AND vrs.reservations_enabled IS TRUE
      )
      AND (
        v_like IS NULL
        OR s.title ILIKE v_like ESCAPE '\'
        OR s.brand_name ILIKE v_like ESCAPE '\'
        OR s.slug ILIKE v_like ESCAPE '\'
        OR coalesce(s.city, '') ILIKE v_like ESCAPE '\'
        OR s.brand_slug ILIKE v_like ESCAPE '\'
      )

    UNION ALL

    SELECT
      'site',
      site.id,
      site.brand_slug,
      NULL::text,
      site.brand_name,
      site.brand_name,
      NULL::timestamptz,
      NULL::text,
      NULL::text,
      site.brand_id
    FROM public.ad_public_site_destinations_view site
    WHERE (p_brand_id IS NULL OR site.brand_id = p_brand_id)
      AND (
        v_like IS NULL
        OR site.brand_name ILIKE v_like ESCAPE '\'
        OR site.brand_slug ILIKE v_like ESCAPE '\'
      )

    UNION ALL

    -- toward #3697 Wave 4 — Mingla marketing pages (admin / unscoped lists only)
    SELECT
      'marketing',
      r.id,
      'mingla',
      r.entity_slug,
      r.title,
      'Mingla',
      NULL::timestamptz,
      NULL::text,
      NULL::text,
      NULL::uuid
    FROM public.ad_marketing_route_rows() r
    WHERE p_brand_id IS NULL
      AND (
        v_like IS NULL
        OR r.title ILIKE v_like ESCAPE '\'
        OR r.entity_slug ILIKE v_like ESCAPE '\'
        OR r.path ILIKE v_like ESCAPE '\'
      )
  ),
  resolved AS (
    SELECT
      c.page_type AS candidate_page_type,
      c.id AS candidate_id,
      c.brand_slug AS candidate_brand_slug,
      c.entity_slug AS candidate_entity_slug,
      c.title AS candidate_title,
      c.brand_name AS candidate_brand_name,
      c.starts_at AS candidate_starts_at,
      c.city AS candidate_city,
      c.cover_url AS candidate_cover_url,
      (public.ad_destination_resolve(
        c.page_type,
        c.brand_slug,
        c.entity_slug
      )) AS j
    FROM candidates c
    WHERE c.page_type = ANY (v_types)
  ),
  filtered AS (
    SELECT
      coalesce(nullif(r.j ->> 'page_type', ''), r.candidate_page_type) AS page_type,
      coalesce((nullif(r.j ->> 'id', ''))::uuid, r.candidate_id) AS id,
      coalesce(nullif(r.j ->> 'brand_slug', ''), r.candidate_brand_slug) AS brand_slug,
      coalesce(nullif(r.j ->> 'entity_slug', ''), r.candidate_entity_slug) AS entity_slug,
      coalesce(nullif(r.j ->> 'title', ''), r.candidate_title) AS title,
      coalesce(nullif(r.j ->> 'brand_name', ''), r.candidate_brand_name) AS brand_name,
      coalesce((nullif(r.j ->> 'starts_at', ''))::timestamptz, r.candidate_starts_at) AS starts_at,
      coalesce(nullif(r.j ->> 'city', ''), r.candidate_city) AS city,
      coalesce(nullif(r.j ->> 'cover_url', ''), r.candidate_cover_url) AS cover_url,
      nullif(r.j ->> 'canonical_url', '') AS canonical_url,
      coalesce(nullif(r.j ->> 'availability', ''), 'draft') AS availability,
      nullif(r.j ->> 'availability_reason', '') AS availability_reason,
      nullif(r.j ->> 'result_kind', '') AS result_kind,
      coalesce((r.j ->> 'ok')::boolean, false) AS ok
    FROM resolved r
    WHERE p_include_unavailable
       OR coalesce((r.j ->> 'ok')::boolean, false) IS TRUE
  ),
  counted AS (
    SELECT count(*)::bigint AS n FROM filtered
  )
  SELECT
    f.page_type,
    f.id,
    f.brand_slug,
    f.entity_slug,
    f.title,
    f.brand_name,
    f.starts_at,
    f.city,
    f.cover_url,
    f.canonical_url,
    f.availability,
    f.availability_reason,
    f.result_kind,
    c.n AS total_count
  FROM filtered f
  CROSS JOIN counted c
  ORDER BY
    CASE WHEN f.ok THEN 0 ELSE 1 END,
    f.starts_at NULLS LAST,
    f.title ASC
  LIMIT v_page_size
  OFFSET v_page * v_page_size;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ad_advertisable_pages(text, text[], boolean, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_advertisable_pages(text, text[], boolean, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ad_advertisable_pages(text, text[], boolean, uuid, integer) IS
  '#3697 Wave 4 B1: unified advertisable page list + marketing allowlist.';

COMMIT;
