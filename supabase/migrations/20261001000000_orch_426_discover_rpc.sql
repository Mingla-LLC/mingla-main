-- ===========================================================================
-- ORCH-426 G1 — pg_discover_business_events: single-round-trip discover read
-- ===========================================================================
-- Replaces PostgREST nested embed (events + brands + event_dates + ticket_types)
-- with one SECURITY DEFINER RPC. Includes ORCH-1076 paid-supply gate inline.

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_discover_business_events(
  p_cities text[],
  p_lower_bound timestamptz,
  p_upper_start timestamptz DEFAULT NULL,
  p_party_types text[] DEFAULT NULL,
  p_vibe_tags text[] DEFAULT NULL,
  p_music_genres text[] DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20
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
      AND e.event_type = 'event'
      AND e.status = ANY (ARRAY['scheduled', 'live'])
      AND e.city = ANY (p_cities)
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

GRANT EXECUTE ON FUNCTION public.pg_discover_business_events(
  text[], timestamptz, timestamptz, text[], text[], text[], integer, integer
) TO service_role;

COMMENT ON FUNCTION public.pg_discover_business_events IS
  'ORCH-426 G1: optimized discover business-event feed (single round-trip, inline paid-supply gate).';

-- Cross-isolate single-flight: only one builder per cache key at a time.
CREATE TABLE IF NOT EXISTS public.discover_merged_build_locks (
  cache_key text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION public.pg_try_discover_cache_build_lock(
  p_cache_key text,
  p_ttl_seconds integer DEFAULT 45
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  DELETE FROM public.discover_merged_build_locks
  WHERE expires_at < pg_catalog.now();

  INSERT INTO public.discover_merged_build_locks (cache_key, expires_at)
  VALUES (
    p_cache_key,
    pg_catalog.now() + make_interval(secs => p_ttl_seconds)
  )
  ON CONFLICT (cache_key) DO NOTHING;

  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pg_release_discover_cache_build_lock(
  p_cache_key text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  DELETE FROM public.discover_merged_build_locks WHERE cache_key = p_cache_key;
$function$;

GRANT EXECUTE ON FUNCTION public.pg_try_discover_cache_build_lock(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pg_release_discover_cache_build_lock(text) TO service_role;

ALTER TABLE public.discover_merged_build_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access discover build locks"
  ON public.discover_merged_build_locks;
CREATE POLICY "Service role full access discover build locks"
  ON public.discover_merged_build_locks FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.discover_merged_build_locks TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'pg_discover_business_events'
  ) THEN
    RAISE EXCEPTION 'ORCH-426: pg_discover_business_events missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'pg_try_discover_cache_build_lock'
  ) THEN
    RAISE EXCEPTION 'ORCH-426: pg_try_discover_cache_build_lock missing';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
