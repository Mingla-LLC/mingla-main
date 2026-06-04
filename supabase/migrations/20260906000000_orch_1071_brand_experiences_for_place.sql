-- ORCH-1071 [venue-card brand experiences section]
-- ---------------------------------------------------------------------------
-- Surfaces the experiences authored by the VERIFIED brand that has claimed a
-- given place_pool venue, so the consumer expanded venue card can render them
-- as compact rows beneath the stars/miles/price block and above weather.
--
-- This mirrors pg_public_experiences_by_brand(text) field-for-field (so the
-- mobile mapper is identical), but resolves the brand via the claimed
-- place_pool linkage instead of a brand slug, and ADDS cover_media_type for
-- the shared EventCoverMedia renderer (video/gif covers, ORCH-1069 path).
--
-- Anon-safe: SECURITY DEFINER, only returns PUBLIC + PUBLISHED experiences of a
-- VERIFIED brand. No brands-table exposure to the caller.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pg_brand_experiences_for_place(p_place_pool_id uuid)
RETURNS TABLE(
  experience_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  experience_slug text,
  title text,
  description text,
  cover_media_url text,
  cover_media_type text,
  theme jsonb,
  venue_text text,
  next_occurrence_at timestamp with time zone,
  price_from_cents bigint,
  currency text,
  is_free boolean,
  published_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    e.id AS experience_id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    e.slug AS experience_slug,
    e.title,
    e.description,
    e.cover_media_url,
    e.cover_media_type::text AS cover_media_type,
    e.theme,
    (e.theme->'experience_meta'->>'venue_text')::text AS venue_text,
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz AS next_occurrence_at,
    (
      SELECT min(tt.price_cents)
      FROM public.ticket_types tt
      WHERE tt.event_id = e.id
        AND tt.deleted_at IS NULL
        AND tt.is_hidden IS NOT TRUE
        AND tt.is_disabled IS NOT TRUE
    ) AS price_from_cents,
    e.currency::text AS currency,
    (
      SELECT NOT EXISTS (
        SELECT 1
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.price_cents > 0
      )
    ) AS is_free,
    e.published_at
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  WHERE b.place_pool_id = p_place_pool_id
    AND b.claim_status = 'verified'
    AND b.deleted_at IS NULL
    AND e.event_type = 'experience'
    AND e.visibility = 'public'
    AND e.published_at IS NOT NULL
    AND e.deleted_at IS NULL
  ORDER BY
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz ASC NULLS LAST,
    e.published_at DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.pg_brand_experiences_for_place(uuid) TO anon, authenticated, service_role;
