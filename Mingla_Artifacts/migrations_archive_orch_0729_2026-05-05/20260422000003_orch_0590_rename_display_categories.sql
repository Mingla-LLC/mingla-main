-- ORCH-0590 Slice 2 — Slice 1 retroactive rename, DB-side
-- Rewrites preferences.display_categories array entries 'Upscale & Fine Dining' → 'Fine Dining'.
-- Idempotent: running twice is safe (array_replace is a no-op when element absent).
--
-- This is the DB equivalent of the user-mandated "AsyncStorage migration" from the
-- Slice 2 dispatch. The forensics investigation (F-6) found user preferences are
-- persisted in the DB preferences table (display_categories TEXT[]), NOT in mobile
-- AsyncStorage. AsyncStorage only holds preferencesRefreshKey (integer). The DB is
-- the single owner of the category arrays (Constitutional #2).

UPDATE public.preferences
SET display_categories = array_replace(display_categories, 'Upscale & Fine Dining', 'Fine Dining'),
    updated_at = now()
WHERE 'Upscale & Fine Dining' = ANY(display_categories);

-- ROLLBACK:
-- UPDATE public.preferences
-- SET display_categories = array_replace(display_categories, 'Fine Dining', 'Upscale & Fine Dining'),
--     updated_at = now()
-- WHERE 'Fine Dining' = ANY(display_categories);
