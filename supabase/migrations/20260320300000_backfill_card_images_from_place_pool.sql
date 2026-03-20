-- Backfill card_pool.image_url from place_pool.stored_photo_urls
-- for cards that currently have Unsplash URLs or NULL image_url.
--
-- Safety: UPDATE only, no schema changes, no deletes.
-- Idempotent: running twice produces the same result.
-- Scope: Only touches cards where place_pool has real photos.

UPDATE public.card_pool cp
SET
  image_url = pp.stored_photo_urls[1],
  images   = pp.stored_photo_urls[1:5]
FROM public.place_pool pp
WHERE cp.place_pool_id = pp.id
  AND pp.stored_photo_urls IS NOT NULL
  AND array_length(pp.stored_photo_urls, 1) > 0
  AND (
    cp.image_url IS NULL
    OR cp.image_url LIKE '%unsplash.com%'
  );
