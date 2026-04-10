-- ORCH-0343: Fix admin_place_photo_stats to exclude __backfill_failed__ sentinel
-- Places with stored_photo_urls = ['__backfill_failed__'] were counted as "with photos"
-- because array_length > 0. They should be counted as "without photos" since the
-- download actually failed.

CREATE OR REPLACE FUNCTION public.admin_place_photo_stats(p_city_id UUID)
RETURNS TABLE (
  total_places BIGINT,
  with_photos BIGINT,
  without_photos BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    COUNT(*) AS total_places,
    COUNT(*) FILTER (
      WHERE pp.stored_photo_urls IS NOT NULL
        AND array_length(pp.stored_photo_urls, 1) > 0
        AND pp.stored_photo_urls != ARRAY['__backfill_failed__']::text[]
    ) AS with_photos,
    COUNT(*) FILTER (
      WHERE pp.stored_photo_urls IS NULL
        OR array_length(pp.stored_photo_urls, 1) IS NULL
        OR pp.stored_photo_urls = ARRAY['__backfill_failed__']::text[]
    ) AS without_photos
  FROM place_pool pp
  WHERE pp.city_id = p_city_id
    AND pp.is_active
    AND pp.ai_approved = true;
END;
$$;
