-- Migration: trigger_propagate_website
-- Description: When place_pool.website is updated from NULL to a non-NULL value,
-- automatically propagate it to all linked card_pool rows that still have NULL website.
-- This ensures that ANY path that updates place_pool (refresh-place-pool, backfill, manual)
-- automatically fixes card_pool without requiring explicit code in every caller.

CREATE OR REPLACE FUNCTION propagate_place_website()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when website changed from NULL to a value
  IF OLD.website IS NULL AND NEW.website IS NOT NULL THEN
    UPDATE public.card_pool
    SET website = NEW.website
    WHERE place_pool_id = NEW.id
      AND website IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_propagate_place_website ON public.place_pool;

CREATE TRIGGER trg_propagate_place_website
  AFTER UPDATE OF website ON public.place_pool
  FOR EACH ROW
  EXECUTE FUNCTION propagate_place_website();
