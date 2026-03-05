-- Deduplicate existing card_pool entries (keep highest popularity_score)
DELETE FROM public.card_pool a
USING public.card_pool b
WHERE a.id < b.id
  AND a.google_place_id = b.google_place_id
  AND a.card_type = 'single'
  AND b.card_type = 'single';

-- Add UNIQUE constraint for single cards (curated cards can share places)
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_pool_unique_single
  ON public.card_pool (google_place_id)
  WHERE card_type = 'single' AND google_place_id IS NOT NULL;
