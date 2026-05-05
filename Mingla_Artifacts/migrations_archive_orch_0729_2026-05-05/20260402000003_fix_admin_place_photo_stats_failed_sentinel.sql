-- Fix photo stats so failed sentinels are counted as missing photos, not real photos.

CREATE OR REPLACE FUNCTION public.admin_place_photo_stats(
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_places BIGINT,
  with_photos BIGINT,
  without_photos BIGINT,
  photo_pct INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE pp.is_active) AS total_places,
    COUNT(*) FILTER (
      WHERE pp.is_active
        AND pp.stored_photo_urls IS NOT NULL
        AND array_length(pp.stored_photo_urls, 1) > 0
        AND pp.stored_photo_urls IS DISTINCT FROM ARRAY['__backfill_failed__']
    ) AS with_photos,
    COUNT(*) FILTER (
      WHERE pp.is_active
        AND (
          pp.stored_photo_urls IS NULL
          OR array_length(pp.stored_photo_urls, 1) IS NULL
          OR pp.stored_photo_urls = ARRAY['__backfill_failed__']
        )
    ) AS without_photos,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (
          WHERE pp.is_active
            AND pp.stored_photo_urls IS NOT NULL
            AND array_length(pp.stored_photo_urls, 1) > 0
            AND pp.stored_photo_urls IS DISTINCT FROM ARRAY['__backfill_failed__']
        ) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active)
      )::INTEGER
      ELSE 0
    END AS photo_pct
  FROM public.place_pool pp
  WHERE (p_country IS NULL OR pp.country = p_country)
    AND (p_city IS NULL OR pp.city = p_city);
END;
$$;
