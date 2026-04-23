-- ORCH-0640 ch10 — Drop all card_pool-related triggers + helper functions (DEC-037)
-- MUST run AFTER ch01 engagement_metrics triggers are live (fan_review + fan_visit
-- take over the counter role for place_reviews + user_visits).
-- Pre-condition: ch05 engagement fan triggers are live on place_reviews + user_visits.

BEGIN;

-- Triggers first (so PostgreSQL does not complain about orphan triggers when we drop functions)
DROP TRIGGER IF EXISTS trg_card_pool_review_stats ON public.place_reviews;
DROP TRIGGER IF EXISTS trg_card_pool_visit_count  ON public.user_visits;
-- trg_card_pool_impression_counters — table user_card_impressions doesn't exist in prod
-- (verified Phase-2 F-5 errata). ORCH-0640 rework v2.1: DROP TRIGGER IF EXISTS throws
-- 42P01 when the relation is missing — IF EXISTS only protects the trigger name, not
-- the parent table. Guard the whole statement with a table-existence check.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_card_impressions'
  ) THEN
    DROP TRIGGER IF EXISTS trg_card_pool_impression_counters ON public.user_card_impressions;
  END IF;
END $$;
-- trg_delete_curated_card_on_stop_loss auto-drops when card_pool_stops archives in ch12
-- trg_update_card_pool_updated_at auto-drops when card_pool archives in ch12

-- Helper functions (trigger-owned + orphaned services).
-- ORCH-0640 rework v2.1: CASCADE added. Migration comment at L14 assumed triggers on
-- card_pool_stops would auto-drop when that table archived (renamed to
-- _archive_card_pool_stops). That assumption was wrong — RENAME preserves triggers.
-- So trg_delete_curated_card_on_stop_loss still exists on _archive_card_pool_stops and
-- pins delete_curated_card_on_stop_loss(). Same risk applies to the other helpers.
-- CASCADE drops dependent triggers — all target tables are either already archived or
-- being demolished in this cutover, so dropping their triggers is the desired outcome.
DROP FUNCTION IF EXISTS public.update_card_pool_review_stats() CASCADE;
DROP FUNCTION IF EXISTS public.update_card_pool_visit_count() CASCADE;
DROP FUNCTION IF EXISTS public.update_card_pool_impression_counters() CASCADE;
DROP FUNCTION IF EXISTS public.delete_curated_card_on_stop_loss() CASCADE;
DROP FUNCTION IF EXISTS public.cascade_place_deactivation_to_curated_cards() CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_orphaned_curated_cards() CASCADE;
DROP FUNCTION IF EXISTS public.sync_place_to_cards() CASCADE;
DROP FUNCTION IF EXISTS public.propagate_place_city_country() CASCADE;

COMMIT;
