-- ORCH-1155 [public-brand-page] — add cover_media_type to pg_public_experiences_by_brand
-- =============================================================================
-- The brand-page Experiences tab cards could render an experience's IMAGE cover
-- but not its VIDEO/GIF cover, because pg_public_experiences_by_brand returned
-- cover_media_url WITHOUT cover_media_type (the experiences-by-brand RPC predates
-- the cover-type plumbing events/trips/upcoming already carry). The sibling
-- pg_brand_experiences_for_place already returns e.cover_media_type::text — this
-- brings the brand-page RPC to parity so the redesigned ExperienceMiniCard can
-- pass the real media type to EventCoverMedia (which already plays video/gif).
--
-- Re-emitted from the LIVE PROD body (pg_get_functiondef via MCP read-only,
-- 2026-06-17) so no sibling change already live on prod is clobbered. The ONLY
-- change vs the live body is the one added column + its SELECT expression.
--
-- DROP-before-widen: the RETURNS TABLE shape is WIDENING (one new OUT column);
-- a bare CREATE OR REPLACE that changes the OUT columns errors, so DROP first.
-- events.cover_media_type is `text` (CHECK IN ('image','video','gif') OR NULL),
-- additive + NULL-safe (older clients ignore the column).
-- SECURITY DEFINER + anon GRANT preserved (anon-safe brand page, no RLS change).

DROP FUNCTION IF EXISTS public.pg_public_experiences_by_brand(text);

CREATE OR REPLACE FUNCTION public.pg_public_experiences_by_brand(p_brand_slug text)
 RETURNS TABLE(experience_id uuid, brand_id uuid, brand_slug text, brand_name text, experience_slug text, title text, description text, cover_media_url text, cover_media_type text, theme jsonb, venue_text text, next_occurrence_at timestamp with time zone, price_from_cents bigint, currency text, is_free boolean, published_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
    e.cover_media_type::text AS cover_media_type,   -- NEW (sibling pattern, proven)
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
  WHERE b.slug = p_brand_slug
    AND b.deleted_at IS NULL
    AND e.event_type = 'experience'
    AND e.visibility = 'public'
    AND e.published_at IS NOT NULL
    AND e.deleted_at IS NULL
    -- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: paid-only Stripe-readiness gate (mirror of checkout 409 + ORCH-1075 publish guard). FREE + in-person-only-paid exempt. Buyer-facing only — owners read events directly.
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.ticket_types tt
         WHERE tt.event_id = e.id
           AND tt.available_online = true
           AND tt.deleted_at IS NULL
           AND tt.price_cents > 0
      )
      OR public.pg_brand_can_charge(e.brand_id)
    )
  ORDER BY
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz ASC NULLS LAST,
    e.published_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.pg_public_experiences_by_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_experiences_by_brand(text) TO anon, authenticated;
