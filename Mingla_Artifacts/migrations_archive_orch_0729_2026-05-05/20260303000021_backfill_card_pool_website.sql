-- Migration: backfill_card_pool_website
-- Description: Populates card_pool.website from the linked place_pool record
-- for all cards where the website was NULL (pre-migration or skipped by
-- ignoreDuplicates upsert). The card_pool.website column was added in
-- migration 20260302000009 but existing rows were never backfilled.

UPDATE public.card_pool c
SET website = p.website
FROM public.place_pool p
WHERE c.place_pool_id = p.id
  AND c.website IS NULL
  AND p.website IS NOT NULL;
