-- ORCH-0640 ch12 — Archive card_pool + drop legacy tables (DEC-037, DEC-049, DEC-050)
-- card_pool + card_pool_stops rename to _archive_* for 7-day retention.
-- Legacy 2025-era saves/experiences/saved_experiences tables DROPPED (DS-6).
-- Backup tables dropped outright (0 live readers).
-- Final _archive_* DROP scheduled +7 days in migration 20260502000001.
--
-- Pre-conditions:
--   • ORCH-0634 shipped (card_pool inert)
--   • ch10 trigger drops complete (no triggers writing to card_pool)
--   • ch11 RPC drops complete (no RPC reads card_pool)
--   • Admin + mobile deploys complete (no code reads these tables)

BEGIN;

-- Archive card_pool family for 7-day rollback window
ALTER TABLE public.card_pool RENAME TO _archive_card_pool;
ALTER TABLE public.card_pool_stops RENAME TO _archive_card_pool_stops;

-- Legacy 2025-era parallel architecture (DS-6, DEC-050) — 573 saves + 1088 experiences accepted as disposable (DEC-049)
DROP TABLE IF EXISTS public.saves CASCADE;
DROP TABLE IF EXISTS public.experiences CASCADE;
-- ORCH-0640 rework v2.1: CASCADE added. At apply time, saved_experiences had 4
-- lingering FK dependencies (scheduled_activities.saved_experience_id,
-- board_cards.saved_experience_id, board_saved_cards.saved_experience_id,
-- board_user_swipe_states.saved_experience_id). CASCADE drops the FK constraints
-- on those tables — the referenced column stays (nullable uuid) and becomes
-- orphan data per DEC-049 (family/friends data loss acceptable). Schema-level
-- cleanup of the now-dead columns is deferred to a post-soak micro-migration.
DROP TABLE IF EXISTS public.saved_experiences CASCADE;

-- Stale backup tables (DS-7)
DROP TABLE IF EXISTS public._backup_user_interactions;
DROP TABLE IF EXISTS public.card_pool_categories_backup_0434;

COMMENT ON TABLE public._archive_card_pool IS
  'ORCH-0640: archived from card_pool at cutover. 7-day retention per DEC-049.
   Scheduled for DROP in migration 20260502000001.';
COMMENT ON TABLE public._archive_card_pool_stops IS
  'ORCH-0640: archived from card_pool_stops at cutover. 7-day retention per DEC-049.
   Scheduled for DROP in migration 20260502000001.';

COMMIT;
