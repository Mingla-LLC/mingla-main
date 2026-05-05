-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Add city_id to card_pool
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.card_pool
ADD COLUMN city_id UUID REFERENCES public.seeding_cities(id) ON DELETE SET NULL;

CREATE INDEX idx_card_pool_city_id ON public.card_pool (city_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. No schema change needed for category — it's already TEXT.
--    Normalization is a data change handled in migration 2 (backfill).
-- ═══════════════════════════════════════════════════════════════════════════════
