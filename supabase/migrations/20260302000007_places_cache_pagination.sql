-- Add next_page_token to google_places_cache for pagination support
ALTER TABLE public.google_places_cache
ADD COLUMN IF NOT EXISTS next_page_token TEXT DEFAULT NULL;

-- Add pages_fetched counter to track how many pages we've retrieved
ALTER TABLE public.google_places_cache
ADD COLUMN IF NOT EXISTS pages_fetched INTEGER NOT NULL DEFAULT 1;
