-- ORCH-0640 ch16 — Final archive table drops (+7 days post-cutover per DEC-049)
-- This migration file is committed at cutover time but SHOULD NOT be applied until
-- 7 days of post-cutover soak has passed with no rollback signal.
--
-- Pre-conditions:
--   • Cutover migrations (20260425000001..000014) all applied successfully
--   • 7-day soak window complete with no rollback
--   • No reports of missing data from admin or mobile
--   • CI grep gates green for 7 consecutive days

BEGIN;

DROP TABLE IF EXISTS public._archive_card_pool CASCADE;
DROP TABLE IF EXISTS public._archive_card_pool_stops CASCADE;

COMMIT;
