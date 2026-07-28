-- ===========================================================================
-- issue #1020 — Events disappear from city browsing when the venue's town label
-- isn't exactly the browsed city.
--
-- FIX DIRECTION (b): geo-radius OR-fallback on the venue pin (events.location_geo).
-- Widens the single city predicate in pg_discover_business_events from bare
-- string equality to:  city = ANY(p_cities) OR ST_DWithin(pin, center, radius).
-- Threads the browsed center/radius (already carried on the request) from the
-- edge fn into the RPC. Sub-municipality venues (e.g. "Zaventem" pin inside the
-- "Brussels" metro radius) now surface in the deck; also rescues NULL-city rows
-- that still carry a venue pin. Zero stored-data mutation, zero per-market upkeep.
--
-- SPEC: issue #1020 "SPEC — geo-radius OR-fallback on the venue pin (fix
-- direction (b))". Function body copied VERBATIM from
-- 20261004000000_orch_1150_rsvp_events.sql lines 1204-1363, changing ONLY (i) the
-- signature (append p_center_lng / p_center_lat / p_radius_km) and (ii) the one
-- city predicate. Every other line is byte-identical.
--
-- OVERLOAD HAZARD GUARD (SPEC §3b): CREATE OR REPLACE only replaces when the arg
-- signature matches. Appending params would mint a SECOND overload and leave the
-- old 8-arg function live, so named calls supplying only the original args would
-- throw "function ... is not unique". DROP the exact old 8-arg signature FIRST.
--
-- Additive + idempotent: DROP IF EXISTS (old sig) -> CREATE OR REPLACE (new sig)
-- -> GRANT (new 11-arg) -> CREATE INDEX IF NOT EXISTS. No UPDATE/ALTER TABLE.
-- Apply via operator `supabase db push --linked` (NOT MCP apply_migration).
-- ===========================================================================

BEGIN;

-- SPEC §3b — drop the EXACT old 8-arg signature before widening (overload guard).
DROP FUNCTION IF EXISTS public.pg_discover_business_events(
  text[], timestamptz, timestamptz, text[], text[], text[], integer, integer
);

CREATE OR REPLACE FUNCTION public.pg_discover_business_events(
  p_cities text[],
  p_lower_bound timestamptz,
  p_upper_start timestamptz DEFAULT NULL,
  p_party_types text[] DEFAULT NULL,
  p_vibe_tags text[] DEFAULT NULL,
  p_music_genres text[] DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20,
  p_center_lng double precision DEFAULT NULL,   -- issue #1020 geo-radius fallback
  p_center_lat double precision DEFAULT NULL,   -- issue #1020 geo-radius fallback
  p_radius_km double precision DEFAULT NULL     -- issue #1020 geo-radius fallback
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH base AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug,
      e.location_text,
      e.location_geo,
      e.online_url,
      e.is_online,
      e.cover_media_url,
      e.cover_media_type,
      e.theme,
      e.timezone,
      e.currency,
      e.city,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.event_type,
      b.slug AS brand_slug,
      b.name AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      ed.start_at AS master_start_at,
      ed.end_at AS master_end_at,
      ed.timezone AS master_timezone,
      (
        SELECT MIN(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.price_cents IS NOT NULL
      ) AS price_min_cents,
      (
        SELECT MAX(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.price_cents IS NOT NULL
      ) AS price_max_cents,
      EXISTS (
        SELECT 1
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.available_online IS TRUE
          AND tt.price_cents > 0
      ) AS has_paid_online,
      (
        SELECT public.compute_all_in_cents(
          MIN(tt.price_cents),
          COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
          COALESCE(e.pass_service_fee, b.default_pass_service_fee),
          (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
        )
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.price_cents > 0
          AND tt.deleted_at IS NULL
      ) AS display_price_cents,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    INNER JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    INNER JOIN public.event_dates ed
      ON ed.event_id = e.id
     AND ed.is_master IS TRUE
     AND ed.end_at >= p_lower_bound
    WHERE e.deleted_at IS NULL
      AND e.visibility = 'public'
      -- ORCH-1150: admit opted-in RSVP rows alongside ticketed events.
      AND ( e.event_type = 'event'
         OR (e.event_type = 'rsvp' AND e.rsvp_discoverable = true) )
      AND e.status = ANY (ARRAY['scheduled', 'live'])
      -- issue #1020: geo-radius OR-fallback on the venue pin. A sub-municipality
      -- venue (city label != browsed city) still surfaces when its pin sits inside
      -- the browsed metro radius; also rescues NULL-city rows that carry a pin.
      -- Every PostGIS symbol AND both type names are public.-qualified because
      -- this function runs under SET search_path = '' (bare ST_*/geometry/geography
      -- would throw does-not-exist). ST_DWithin on geography takes metres.
      AND (
            e.city = ANY (p_cities)
         OR (
              p_center_lng IS NOT NULL
              AND p_center_lat IS NOT NULL
              AND p_radius_km  IS NOT NULL
              AND e.location_geo IS NOT NULL
              AND public.ST_DWithin(
                    public.ST_SetSRID(e.location_geo::public.geometry, 4326)::public.geography,
                    public.ST_SetSRID(public.ST_MakePoint(p_center_lng, p_center_lat), 4326)::public.geography,
                    p_radius_km * 1000
                  )
            )
      )
      AND (p_upper_start IS NULL OR ed.start_at <= p_upper_start)
      AND (p_party_types IS NULL OR cardinality(p_party_types) = 0 OR e.party_types && p_party_types)
      AND (p_vibe_tags IS NULL OR cardinality(p_vibe_tags) = 0 OR e.vibe_tags && p_vibe_tags)
      AND (p_music_genres IS NULL OR cardinality(p_music_genres) = 0 OR e.music_genres && p_music_genres)
  ),
  gated AS (
    SELECT *
    FROM base
    WHERE NOT (has_paid_online AND NOT public.pg_brand_can_charge(brand_id))
  ),
  ranked AS (
    SELECT
      g.*,
      COUNT(*) OVER () AS total_count
    FROM gated g
    ORDER BY master_start_at ASC NULLS LAST
    OFFSET GREATEST(p_offset, 0)
    LIMIT GREATEST(p_limit, 0)
  )
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT total_count FROM ranked LIMIT 1), 0),
    'rows', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'brand_id', r.brand_id,
            'title', r.title,
            'description', r.description,
            'slug', r.slug,
            'location_text', r.location_text,
            'location_geo', r.location_geo,
            'online_url', r.online_url,
            'is_online', r.is_online,
            'cover_media_url', r.cover_media_url,
            'cover_media_type', r.cover_media_type,
            'theme', r.theme,
            'timezone', r.timezone,
            'currency', r.currency,
            'city', r.city,
            'party_types', r.party_types,
            'vibe_tags', r.vibe_tags,
            'music_genres', r.music_genres,
            'event_type', r.event_type,
            'brand_slug', r.brand_slug,
            'brand_name', r.brand_name,
            'brand_profile_photo_url', r.brand_profile_photo_url,
            'master_start_at', r.master_start_at,
            'master_end_at', r.master_end_at,
            'master_timezone', r.master_timezone,
            'price_min_cents', r.price_min_cents,
            'price_max_cents', r.price_max_cents,
            'display_price_cents', r.display_price_cents,
            'pricing_currency', r.pricing_currency
          )
          ORDER BY r.master_start_at ASC NULLS LAST
        )
        FROM ranked r
      ),
      '[]'::jsonb
    )
  );
$function$;

-- SPEC §3b — re-GRANT with the NEW 11-arg type list.
GRANT EXECUTE ON FUNCTION public.pg_discover_business_events(
  text[], timestamptz, timestamptz, text[], text[], text[], integer, integer,
  double precision, double precision, double precision
) TO service_role;

-- SPEC §3e — additive, non-blocking partial GiST index for the geo branch of the
-- OR predicate (the existing city partial index can't serve it). Idempotent.
CREATE INDEX IF NOT EXISTS idx_events_location_geo_discover
  ON public.events USING gist ((location_geo::public.geometry))
  WHERE location_geo IS NOT NULL AND deleted_at IS NULL
    AND visibility = 'public' AND status IN ('scheduled', 'live');

COMMIT;
