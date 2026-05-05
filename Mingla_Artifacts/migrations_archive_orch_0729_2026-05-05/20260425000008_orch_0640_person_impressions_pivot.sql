-- ORCH-0640 ch04 — person_card_impressions schema pivot (DEC-037 cascade)
-- Table has 0 rows (verified via live probe 2026-04-22). Pivot is schema-only.
-- FK swings from card_pool.id → place_pool.id. Indexes rebuilt.

BEGIN;

-- Drop old FK (card_pool is being dropped in ch12; table has 0 rows anyway)
ALTER TABLE public.person_card_impressions
  DROP CONSTRAINT IF EXISTS person_card_impressions_card_pool_id_fkey;

-- Replace card_pool_id column with place_pool_id
ALTER TABLE public.person_card_impressions
  DROP COLUMN card_pool_id;

ALTER TABLE public.person_card_impressions
  ADD COLUMN place_pool_id UUID NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE;

-- Drop old indexes referencing the old column
DROP INDEX IF EXISTS public.uq_person_card_impression;
DROP INDEX IF EXISTS public.idx_person_card_impressions_person_card;
DROP INDEX IF EXISTS public.idx_person_card_impressions_paired_card;
DROP INDEX IF EXISTS public.idx_person_card_impressions_paired_user;

-- Rebuild indexes with place_pool_id
CREATE UNIQUE INDEX uq_person_place_impression
  ON public.person_card_impressions (user_id, person_id, place_pool_id);

CREATE INDEX idx_person_place_impressions_person_place
  ON public.person_card_impressions (user_id, person_id, place_pool_id);

CREATE UNIQUE INDEX idx_person_place_impressions_paired_user
  ON public.person_card_impressions (user_id, paired_user_id, place_pool_id)
  WHERE paired_user_id IS NOT NULL;

-- RLS policies unchanged (user_id-based, same semantics).
-- Table name kept as person_card_impressions (callers already use it; rename adds no value).

COMMENT ON COLUMN public.person_card_impressions.place_pool_id IS
  'ORCH-0640: swapped from card_pool_id. Pool-only per DEC-037.';

COMMIT;
