-- ORCH-0597 — split brunch_lunch_casual chip into brunch + casual_food chips.
-- Rewrites user preference arrays: wherever users had the old bundled chip,
-- they now have BOTH new chips (Option A: preserve breadth).
--
-- Idempotent: array_remove + array_cat + DISTINCT unnest ensures no duplicates
-- if this migration is re-applied, and is safe if other clients have already
-- written the new slugs before this runs.
--
-- Impact baseline (MCP-measured at forensics time, 2026-04-21):
--   - 8 rows have 'brunch_lunch_casual' in categories
--   - 0 rows have 'Brunch, Lunch & Casual' in display_categories
--   - 0 rows already contain 'brunch' or 'casual_food'
--
-- See: outputs/SPEC_ORCH-0597_SPLIT_BRUNCH_CASUAL_CHIP.md §4.1

UPDATE public.preferences
SET
  categories = (
    SELECT ARRAY(SELECT DISTINCT e FROM unnest(
      array_cat(
        array_remove(COALESCE(categories, ARRAY[]::text[]), 'brunch_lunch_casual'),
        ARRAY['brunch', 'casual_food']::text[]
      )
    ) AS e)
  ),
  display_categories = (
    SELECT ARRAY(SELECT DISTINCT e FROM unnest(
      array_cat(
        array_remove(COALESCE(display_categories, ARRAY[]::text[]), 'Brunch, Lunch & Casual'),
        ARRAY['Brunch', 'Casual']::text[]
      )
    ) AS e)
  ),
  updated_at = now()
WHERE 'brunch_lunch_casual' = ANY(COALESCE(categories, ARRAY[]::text[]))
   OR 'Brunch, Lunch & Casual' = ANY(COALESCE(display_categories, ARRAY[]::text[]));

-- ROLLBACK (use BEFORE any post-migration users save new prefs; else destructive):
-- UPDATE public.preferences
-- SET
--   categories = (
--     SELECT ARRAY(SELECT DISTINCT e FROM unnest(
--       array_cat(
--         array_remove(array_remove(COALESCE(categories, ARRAY[]::text[]), 'brunch'), 'casual_food'),
--         ARRAY['brunch_lunch_casual']::text[]
--       )
--     ) AS e)
--   ),
--   display_categories = (
--     SELECT ARRAY(SELECT DISTINCT e FROM unnest(
--       array_cat(
--         array_remove(array_remove(COALESCE(display_categories, ARRAY[]::text[]), 'Brunch'), 'Casual'),
--         ARRAY['Brunch, Lunch & Casual']::text[]
--       )
--     ) AS e)
--   ),
--   updated_at = now()
-- WHERE 'brunch' = ANY(COALESCE(categories, ARRAY[]::text[]))
--    OR 'casual_food' = ANY(COALESCE(categories, ARRAY[]::text[]));
