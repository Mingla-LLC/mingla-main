-- Security: Scrub Google API keys from existing card_pool data.
-- RC-004: Old curated cards have Google Places API URLs with key=AIzaSy... baked in.
-- This migration replaces them with stored Supabase URLs from place_pool, or NULLs them out.

-- 1. Scrub image_url containing API keys
UPDATE public.card_pool
SET image_url = NULL
WHERE image_url LIKE '%key=AIzaSy%';

-- 2. Scrub images array containing API keys
UPDATE public.card_pool
SET images = '{}'
WHERE EXISTS (
  SELECT 1 FROM unnest(images) AS img
  WHERE img LIKE '%key=AIzaSy%'
);

-- 3. Scrub stops JSONB — replace stop imageUrl/imageUrls that contain API keys
--    with corresponding place_pool.stored_photo_urls, or null if none exist
UPDATE public.card_pool cp
SET stops = (
  SELECT jsonb_agg(
    CASE
      WHEN stop->>'imageUrl' LIKE '%key=AIzaSy%'
      THEN stop - 'imageUrl' - 'imageUrls' || jsonb_build_object(
        'imageUrl', COALESCE(
          (SELECT pp.stored_photo_urls[1]
           FROM public.place_pool pp
           WHERE pp.google_place_id = stop->>'placeId'),
          NULL
        ),
        'imageUrls', COALESCE(
          (SELECT to_jsonb(pp.stored_photo_urls)
           FROM public.place_pool pp
           WHERE pp.google_place_id = stop->>'placeId'),
          '[]'::jsonb
        )
      )
      ELSE stop
    END
  )
  FROM jsonb_array_elements(cp.stops) AS stop
)
WHERE cp.card_type = 'curated'
  AND cp.stops IS NOT NULL
  AND cp.stops::text LIKE '%key=AIzaSy%';

-- Also scrub any Unsplash URLs from image_url (leftover from stubs)
UPDATE public.card_pool
SET image_url = NULL
WHERE image_url LIKE '%images.unsplash.com%';

-- And from images array
UPDATE public.card_pool
SET images = '{}'
WHERE EXISTS (
  SELECT 1 FROM unnest(images) AS img
  WHERE img LIKE '%images.unsplash.com%'
);
