-- Normalize empty-string google_place_id to NULL
-- These leak in from poolCardToApiCard when cards have no Google place ID
UPDATE public.card_pool
SET google_place_id = NULL
WHERE google_place_id = '';

-- Also clean place_pool if it has the same issue
UPDATE public.place_pool
SET google_place_id = NULL
WHERE google_place_id = '';
