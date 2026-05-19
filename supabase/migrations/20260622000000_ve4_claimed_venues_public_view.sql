-- Ve4 — Public venue page read model (GitHub issue #102)
-- Verified physical venues with structured listing fields, hours aggregate,
-- and place_pool photo fallback. Does not expose claim/audit internals.

BEGIN;

-- ---------------------------------------------------------------------------
-- Anon/authenticated can read verified physical brand rows (eventless OK).
-- Complements "Public can read brands with public events" (ORCH-0763D).
-- ---------------------------------------------------------------------------
CREATE POLICY "Public can read verified physical venues"
  ON public.brands
  FOR SELECT
  TO authenticated, anon
  USING (
    deleted_at IS NULL
    AND kind = 'physical'
    AND claim_status = 'verified'
  );

-- ---------------------------------------------------------------------------
-- Public hours for verified physical venues (buyer /b/{slug} page).
-- ---------------------------------------------------------------------------
CREATE POLICY "Public can read hours for verified physical venues"
  ON public.brand_hours
  FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_hours.brand_id
        AND b.deleted_at IS NULL
        AND b.kind = 'physical'
        AND b.claim_status = 'verified'
    )
  );

-- ---------------------------------------------------------------------------
-- place_pool photos only when linked from a verified physical brand.
-- ---------------------------------------------------------------------------
CREATE POLICY "Public can read place_pool for verified physical venues"
  ON public.place_pool
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.place_pool_id = place_pool.id
        AND b.deleted_at IS NULL
        AND b.kind = 'physical'
        AND b.claim_status = 'verified'
    )
  );

-- Column grants for venue listing fields (baseline anon grants omit Ve1 columns).
GRANT SELECT (
  kind,
  address,
  cover_hue,
  lat,
  lng,
  city,
  country_code,
  venue_category,
  place_pool_id,
  google_place_id,
  profile_photo_type
) ON public.brands TO anon;

GRANT SELECT (stored_photo_urls) ON public.place_pool TO anon;

-- ---------------------------------------------------------------------------
-- claimed_venues_public_view — verified physical venues only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.claimed_venues_public_view
  WITH (security_invoker = true) AS
SELECT
  b.id,
  b.name,
  b.slug,
  b.description,
  b.profile_photo_url,
  b.profile_photo_type,
  b.social_links,
  b.custom_links,
  b.default_currency,
  b.address,
  b.city,
  b.country_code,
  b.lat,
  b.lng,
  b.cover_hue,
  b.cover_media_url,
  b.cover_media_type,
  b.kind,
  b.venue_category,
  b.place_pool_id,
  b.google_place_id,
  b.created_at,
  b.updated_at,
  (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'weekday', bh.weekday,
          'open_time', to_char(bh.open_time, 'HH24:MI'),
          'close_time', to_char(bh.close_time, 'HH24:MI'),
          'is_closed', bh.is_closed
        )
        ORDER BY bh.weekday
      ),
      '[]'::jsonb
    )
    FROM public.brand_hours bh
    WHERE bh.brand_id = b.id
  ) AS hours,
  pp.stored_photo_urls AS pool_photo_urls
FROM public.brands b
LEFT JOIN public.place_pool pp ON pp.id = b.place_pool_id
WHERE b.deleted_at IS NULL
  AND b.kind = 'physical'
  AND b.claim_status = 'verified';

COMMENT ON VIEW public.claimed_venues_public_view IS
  'Ve4 — public read model for verified physical venues. Surfaces venues regardless of associated events (unlike brands_public_view). Excludes claim_status and audit fields.';

GRANT SELECT ON public.claimed_venues_public_view TO anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
