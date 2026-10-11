-- toward #3697 Wave 1 — Destination truth (#3700 + A4)
-- One RPC for advertisable pages with availability computed in SQL so Admin,
-- Ari (later), and the server create/launch gate agree.
-- Do NOT auto-apply — Management API post-merge.

BEGIN;

-- ── Widen dest_page_type CHECKs (additive page types) ───────────────────────
ALTER TABLE public.ad_campaigns
  DROP CONSTRAINT IF EXISTS ad_campaigns_dest_page_type_check;
ALTER TABLE public.ad_campaigns
  ADD CONSTRAINT ad_campaigns_dest_page_type_check CHECK (
    dest_page_type IN (
      'event', 'rsvp', 'trip', 'experience', 'brand', 'venue', 'reservation', 'site'
    )
  );

ALTER TABLE public.ad_attribution_touches
  DROP CONSTRAINT IF EXISTS ad_attribution_touches_dest_page_type_check;
ALTER TABLE public.ad_attribution_touches
  ADD CONSTRAINT ad_attribution_touches_dest_page_type_check CHECK (
    dest_page_type IS NULL
    OR dest_page_type IN (
      'event', 'rsvp', 'trip', 'experience', 'brand', 'venue', 'reservation', 'site'
    )
  );

-- ── Search escape (ilike metacharacters) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ad_escape_ilike(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $function$
  SELECT replace(replace(replace(coalesce(p_raw, ''), '\', '\\'), '%', '\%'), '_', '\_');
$function$;

REVOKE EXECUTE ON FUNCTION public.ad_escape_ilike(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_escape_ilike(text) TO authenticated, service_role;

-- ── Canonical public-web origin for ads (matches businessWebOrigin.ts) ──────
CREATE OR REPLACE FUNCTION public.ad_public_web_origin()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT 'https://host.usemingla.com'::text;
$function$;

REVOKE EXECUTE ON FUNCTION public.ad_public_web_origin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_public_web_origin() TO authenticated, service_role;


-- ── Live Sites advertisable view (GR-52 + list/create gate) ─────────────────
CREATE OR REPLACE VIEW public.ad_public_site_destinations_view AS
SELECT
  site.id,
  site.brand_id,
  b.slug AS brand_slug,
  b.name AS brand_name,
  host.hostname
FROM public.brand_sites site
JOIN public.brands b ON b.id = site.brand_id
JOIN public.brand_site_hosts host
  ON host.site_id = site.id
 AND host.is_primary IS TRUE
 AND host.status = 'active'
JOIN public.brand_site_publications pub
  ON pub.id = site.active_publication_id
WHERE b.deleted_at IS NULL
  AND site.status = 'published'
  AND coalesce(pub.public_reachable, false) IS TRUE;

ALTER VIEW public.ad_public_site_destinations_view SET (security_invoker = false);
REVOKE ALL ON public.ad_public_site_destinations_view FROM PUBLIC, anon;
GRANT SELECT ON public.ad_public_site_destinations_view TO authenticated, service_role;

-- ── Resolve one destination (server gate + shared availability) ─────────────
-- Returns jsonb:
--   ok=true  → selectable or warning (availability in {available,soon,almost_sold_out,no_count})
--   ok=false → not advertisable (availability_reason set; code for AdDestinationError)
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
  v_origin text := public.ad_public_web_origin();
  v_brand_slug text := lower(btrim(coalesce(p_brand_slug, '')));
  v_entity text := lower(btrim(coalesce(p_entity_slug, '')));
  v_row record;
  v_avail text;
  v_reason text;
  v_url text;
  v_result_kind text;
  v_starts timestamptz;
  v_hours numeric;
BEGIN
  IF p_page_type IS NULL OR p_page_type NOT IN (
    'event', 'rsvp', 'trip', 'experience', 'brand', 'venue', 'reservation', 'site'
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'destination_page_type_invalid',
      'page_type', p_page_type,
      'availability', 'draft',
      'availability_reason', 'admin.dest.draft'
    );
  END IF;

  IF v_brand_slug = '' OR length(v_brand_slug) > 160
     OR v_brand_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'destination_brand_slug_invalid',
      'page_type', p_page_type,
      'availability', 'draft',
      'availability_reason', 'admin.dest.draft'
    );
  END IF;

  -- Dated offering types on public.events via business_public_events_view.
  IF p_page_type IN ('event', 'rsvp', 'trip', 'experience') THEN
    IF v_entity = '' OR length(v_entity) > 200
       OR v_entity !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_entity_slug_invalid',
      'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;

    SELECT
      v.id,
      v.brand_id,
      v.brand_slug,
      v.slug,
      v.title,
      v.brand_name,
      v.status,
      v.visibility,
      v.event_type,
      v.master_start_at,
      v.city,
      v.cover_media_url,
      v.rsvp_discoverable
    INTO v_row
    FROM public.business_public_events_view v
    WHERE v.brand_slug = v_brand_slug
      AND v.slug = v_entity
      AND v.event_type = CASE p_page_type
        WHEN 'event' THEN 'event'
        WHEN 'rsvp' THEN 'rsvp'
        WHEN 'trip' THEN 'trip'
        WHEN 'experience' THEN 'experience'
      END
    LIMIT 1;

    IF NOT FOUND THEN
      -- Distinguish private/draft via raw events when possible.
      IF EXISTS (
        SELECT 1
        FROM public.events e
        JOIN public.brands b ON b.id = e.brand_id
        WHERE b.slug = v_brand_slug
          AND e.slug = v_entity
          AND e.deleted_at IS NULL
          AND b.deleted_at IS NULL
          AND e.event_type = CASE p_page_type
            WHEN 'event' THEN 'event'
            WHEN 'rsvp' THEN 'rsvp'
            WHEN 'trip' THEN 'trip'
            WHEN 'experience' THEN 'experience'
          END
          AND e.visibility <> 'public'
      ) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'code', 'destination_not_public',
      'page_type', p_page_type,
          'availability', 'private',
          'availability_reason', 'admin.dest.private'
        );
      END IF;
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
      'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;

    IF p_page_type = 'rsvp' AND coalesce(v_row.rsvp_discoverable, false) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
      'page_type', p_page_type,
        'availability', 'private',
        'availability_reason', 'admin.dest.private'
      );
    END IF;

    IF v_row.status IN ('ended', 'cancelled') THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
      'page_type', p_page_type,
        'availability', 'ended',
        'availability_reason', 'admin.dest.ended',
        'starts_at', v_row.master_start_at
      );
    END IF;

    IF v_row.status NOT IN ('scheduled', 'live') THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
      'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;

    v_starts := v_row.master_start_at;
    IF v_starts IS NOT NULL AND v_starts <= now() THEN
      -- A4-4: past start is rejected server-side even if the client sends it.
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
      'page_type', p_page_type,
        'availability', 'ended',
        'availability_reason', 'admin.dest.ended',
        'starts_at', v_starts
      );
    END IF;

    v_avail := 'available';
    v_reason := NULL;
    IF v_starts IS NOT NULL THEN
      v_hours := extract(epoch FROM (v_starts - now())) / 3600.0;
      IF v_hours < 48 THEN
        v_avail := 'soon';
        v_reason := 'admin.dest.soon';
      END IF;
    END IF;

    v_url := CASE p_page_type
      WHEN 'trip' THEN v_origin || '/t/' || v_brand_slug || '/' || v_entity
      WHEN 'experience' THEN v_origin || '/exp/' || v_brand_slug || '/' || v_entity
      ELSE v_origin || '/e/' || v_brand_slug || '/' || v_entity
    END;
    v_result_kind := CASE
      WHEN p_page_type = 'rsvp' THEN 'signups'
      ELSE 'tickets'
    END;

    RETURN jsonb_build_object(
      'ok', true,
      'page_type', p_page_type,
      'id', v_row.id,
      'brand_id', v_row.brand_id,
      'brand_slug', v_brand_slug,
      'entity_slug', v_entity,
      'event_id', v_row.id,
      'venue_id', NULL,
      'title', v_row.title,
      'brand_name', v_row.brand_name,
      'starts_at', v_starts,
      'city', v_row.city,
      'cover_url', v_row.cover_media_url,
      'canonical_url', v_url,
      'availability', v_avail,
      'availability_reason', v_reason,
      'result_kind', v_result_kind
    );
  END IF;

  IF p_page_type = 'brand' THEN
    IF v_entity <> '' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_entity_slug_forbidden',
      'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    SELECT b.id, b.slug, b.name, b.profile_photo_url
    INTO v_row
    FROM public.business_public_brands_view b
    WHERE b.slug = v_brand_slug
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
      'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'page_type', 'brand',
      'id', v_row.id,
      'brand_id', v_row.id,
      'brand_slug', v_brand_slug,
      'entity_slug', NULL,
      'event_id', NULL,
      'venue_id', NULL,
      'title', v_row.name,
      'starts_at', NULL,
      'city', NULL,
      'cover_url', v_row.profile_photo_url,
      'canonical_url', v_origin || '/b/' || v_brand_slug,
      'availability', 'available',
      'availability_reason', NULL,
      'result_kind', 'clicks'
    );
  END IF;

  IF p_page_type = 'venue' THEN
    IF v_entity = '' OR length(v_entity) > 200
       OR v_entity !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_entity_slug_invalid',
      'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    SELECT s.id, s.brand_id, s.brand_slug, s.slug, s.title, s.brand_name,
           s.city, s.cover_media_url
    INTO v_row
    FROM public.ad_public_stay_destinations_view s
    WHERE s.brand_slug = v_brand_slug
      AND s.slug = v_entity
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
      'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'page_type', 'venue',
      'id', v_row.id,
      'brand_id', v_row.brand_id,
      'brand_slug', v_brand_slug,
      'entity_slug', v_entity,
      'event_id', NULL,
      'venue_id', v_row.id,
      'title', v_row.title,
      'brand_name', v_row.brand_name,
      'starts_at', NULL,
      'city', v_row.city,
      'cover_url', v_row.cover_media_url,
      'canonical_url', v_origin || '/b/' || v_brand_slug || '/v/' || v_entity,
      'availability', 'available',
      'availability_reason', NULL,
      'result_kind', 'bookings'
    );
  END IF;

  IF p_page_type = 'reservation' THEN
    -- Public reservation form lives on the venue page (/b/{brand}/v/{venue});
    -- /reserve/{brandId} is payment-cancel only. Venue-scoped + reservations_enabled.
    IF v_entity = '' OR length(v_entity) > 200
       OR v_entity !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_entity_slug_invalid',
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft',
        'page_type', 'reservation'
      );
    END IF;
    SELECT
      s.id,
      s.brand_id,
      s.brand_slug,
      s.slug,
      s.title,
      s.brand_name,
      s.city,
      s.cover_media_url
    INTO v_row
    FROM public.ad_public_stay_destinations_view s
    WHERE s.brand_slug = v_brand_slug
      AND s.slug = v_entity
      AND EXISTS (
        SELECT 1
        FROM public.venue_reservation_settings vrs
        WHERE vrs.venue_id = s.id
          AND vrs.reservations_enabled IS TRUE
      )
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft',
        'page_type', 'reservation',
        'brand_slug', v_brand_slug,
        'entity_slug', v_entity
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'page_type', 'reservation',
      'id', v_row.id,
      'brand_id', v_row.brand_id,
      'brand_slug', v_brand_slug,
      'entity_slug', v_entity,
      'event_id', NULL,
      'venue_id', v_row.id,
      'title', v_row.title,
      'brand_name', v_row.brand_name,
      'starts_at', NULL,
      'city', v_row.city,
      'cover_url', v_row.cover_media_url,
      'canonical_url', v_origin || '/b/' || v_brand_slug || '/v/' || v_entity,
      'availability', 'available',
      'availability_reason', NULL,
      'result_kind', 'signups'
    );
  END IF;

  IF p_page_type = 'site' THEN
    IF v_entity <> '' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_entity_slug_forbidden',
      'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    SELECT
      site.id,
      site.brand_id,
      b.slug AS brand_slug,
      b.name AS title,
      host.hostname,
      site.status AS site_status,
      pub.public_reachable
    INTO v_row
    FROM public.brand_sites site
    JOIN public.brands b ON b.id = site.brand_id
    LEFT JOIN public.brand_site_hosts host
      ON host.site_id = site.id
     AND host.is_primary IS TRUE
     AND host.status = 'active'
    LEFT JOIN public.brand_site_publications pub
      ON pub.id = site.active_publication_id
    WHERE b.slug = v_brand_slug
      AND b.deleted_at IS NULL
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
      'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    IF v_row.hostname IS NULL
       OR v_row.site_status <> 'published'
       OR coalesce(v_row.public_reachable, false) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
        'availability', 'not_live',
        'availability_reason', 'admin.dest.notLive',
        'page_type', 'site',
        'id', v_row.id,
        'brand_id', v_row.brand_id,
        'brand_slug', v_brand_slug,
        'canonical_url', CASE
          WHEN v_row.hostname IS NOT NULL THEN 'https://' || v_row.hostname
          ELSE NULL
        END
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'page_type', 'site',
      'id', v_row.id,
      'brand_id', v_row.brand_id,
      'brand_slug', v_brand_slug,
      'entity_slug', NULL,
      'event_id', NULL,
      'venue_id', NULL,
      'title', v_row.title,
      'brand_name', v_row.title,
      'starts_at', NULL,
      'city', NULL,
      'cover_url', NULL,
      'canonical_url', 'https://' || v_row.hostname,
      'availability', 'available',
      'availability_reason', NULL,
      'result_kind', 'tickets'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'code', 'destination_page_type_invalid',
      'page_type', p_page_type,
    'availability', 'draft',
    'availability_reason', 'admin.dest.draft'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ad_destination_resolve(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_destination_resolve(text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ad_destination_resolve(text, text, text) IS
  '#3697 Wave 1: shared availability + resolve for Ads destinations (Admin/Ari/server gate).';

-- ── List RPC ────────────────────────────────────────────────────────────────
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
      'event', 'rsvp', 'trip', 'experience', 'brand', 'venue', 'reservation', 'site'
    ];
  ELSE
    v_types := p_types;
  END IF;

  IF v_q IS NOT NULL THEN
    v_like := '%' || public.ad_escape_ilike(v_q) || '%';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    -- Events / RSVP / trips / experiences
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
  '#3697 Wave 1 A4: unified advertisable page list; availability from ad_destination_resolve.';

COMMIT;
