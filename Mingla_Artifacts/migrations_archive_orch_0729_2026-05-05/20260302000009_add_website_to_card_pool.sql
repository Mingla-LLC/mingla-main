-- Add website column to card_pool so the "Policies & Reservations" button
-- can display only when a venue has an actual website / reservation link
-- from the Google Places API.

ALTER TABLE public.card_pool
  ADD COLUMN IF NOT EXISTS website TEXT;

COMMENT ON COLUMN public.card_pool.website IS
  'Venue website or reservation URL from Google Places websiteUri field';
