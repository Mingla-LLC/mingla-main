-- #4423 Wave 4a: database hygiene that is safe inside a migration.
--
-- 1. Duplicate index (performance advisor): collaboration_sessions carries two
--    identical partial unique indexes on board_id (both from the baseline
--    squash). idx_collaboration_sessions_unique_board goes; the other,
--    idx_collaboration_sessions_board_id_unique, keeps the rule (one session
--    per board). Neither backs a constraint, and ON CONFLICT (board_id) infers
--    either by its columns.
-- 2. Foreign keys with no index on the hot tables (messages, conversations,
--    notifications, team_*, ops_work_*, orders and order_*): the 22 the
--    advisor lists there (read-only check of production on 13 Nov). Without
--    one, deleting or re-keying a parent row (an auth.users account, a ticket
--    type, a thread) scans the whole child table. Every child table is under
--    10 MB, so a plain CREATE INDEX (a brief lock) is safe here; nothing needs
--    CONCURRENTLY. The other ~730 unindexed foreign keys are on cold tables
--    and wait for the 14-day index-usage window (not before 27 Nov).
-- 3. cron_refresh_admin_place_pool_mv spills about 40 MB to temp files on
--    every refresh (7.6 s normal, 83 s under load). A function-level work_mem
--    applies to the statements inside it: 64 MB for this one job, twice an
--    hour. Its schedule (3,33) and CONCURRENTLY refresh are unchanged.
--
-- Not here, on purpose (Seth runs these by hand from
-- docs/runbooks/INCIDENT_DATABASE_DOWN.md, "Database hygiene"): ANALYZE after
-- the unclean restart, REINDEX CONCURRENTLY of the bloated profiles and
-- user_map_settings indexes, VACUUM FULL of photo_backfill_batches, and the
-- notifications (user_id) index drop after 27 Nov. None of them can run in a
-- migration transaction without locking production.
-- Measured and left alone: issue_1777_brand_reach_refresh p95 0.84 s and the
-- AI rescore sweep p95 16.4 s over 7 days (thresholds 10 s and 30 s), and the
-- cron.job_run_details purge already exists (issue_1647_cron_log_retention,
-- every 20 minutes, 14 days).
--
-- Rollback: DROP INDEX IF EXISTS each *_fk4423_idx index;
--   CREATE UNIQUE INDEX idx_collaboration_sessions_unique_board ON
--   public.collaboration_sessions (board_id) WHERE board_id IS NOT NULL;
--   ALTER FUNCTION public.cron_refresh_admin_place_pool_mv() RESET work_mem;
-- Locks: lock_timeout makes the file fail fast (55P03) rather than queue
-- readers behind a long one; on 55P03 re-run it a minute later (idempotent).

BEGIN;
SET LOCAL lock_timeout = '3s';

DROP INDEX IF EXISTS public.idx_collaboration_sessions_unique_board;

CREATE INDEX IF NOT EXISTS conversations_program_target_user_id_fk4423_idx ON public.conversations (program_target_user_id);
CREATE INDEX IF NOT EXISTS messages_marketing_campaign_id_fk4423_idx ON public.messages (marketing_campaign_id);
CREATE INDEX IF NOT EXISTS notifications_actor_id_fk4423_idx ON public.notifications (actor_id);
CREATE INDEX IF NOT EXISTS ops_work_cards_review_close_status_id_fk4423_idx ON public.ops_work_cards (review_close_status_id);
CREATE INDEX IF NOT EXISTS order_add_on_line_items_ticket_type_id_fk4423_idx ON public.order_add_on_line_items (ticket_type_id);
CREATE INDEX IF NOT EXISTS order_attributions_brand_id_fk4423_idx ON public.order_attributions (brand_id);
CREATE INDEX IF NOT EXISTS order_attributions_offer_id_fk4423_idx ON public.order_attributions (offer_id);
CREATE INDEX IF NOT EXISTS order_attributions_tracking_id_fk4423_idx ON public.order_attributions (tracking_id);
CREATE INDEX IF NOT EXISTS order_installment_refund_applications_installment_id_fk4423_idx ON public.order_installment_refund_applications (installment_id);
CREATE INDEX IF NOT EXISTS order_installments_cancelled_by_fk4423_idx ON public.order_installments (cancelled_by);
CREATE INDEX IF NOT EXISTS order_installments_in_flight_attempt_id_fk4423_idx ON public.order_installments (in_flight_attempt_id);
CREATE INDEX IF NOT EXISTS orders_cancelled_by_fk4423_idx ON public.orders (cancelled_by);
CREATE INDEX IF NOT EXISTS orders_created_by_scanner_id_fk4423_idx ON public.orders (created_by_scanner_id);
CREATE INDEX IF NOT EXISTS orders_purchased_by_user_id_fk4423_idx ON public.orders (purchased_by_user_id);
CREATE INDEX IF NOT EXISTS team_data_room_access_log_user_id_fk4423_idx ON public.team_data_room_access_log (user_id);
CREATE INDEX IF NOT EXISTS team_mentions_actor_user_id_fk4423_idx ON public.team_mentions (actor_user_id);
CREATE INDEX IF NOT EXISTS team_message_attachments_thread_id_fk4423_idx ON public.team_message_attachments (thread_id);
CREATE INDEX IF NOT EXISTS team_message_reactions_user_id_fk4423_idx ON public.team_message_reactions (user_id);
CREATE INDEX IF NOT EXISTS team_messages_reply_to_id_fk4423_idx ON public.team_messages (reply_to_id);
CREATE INDEX IF NOT EXISTS team_reads_user_id_fk4423_idx ON public.team_reads (user_id);
CREATE INDEX IF NOT EXISTS team_thread_members_added_by_fk4423_idx ON public.team_thread_members (added_by);
CREATE INDEX IF NOT EXISTS team_threads_created_by_fk4423_idx ON public.team_threads (created_by);

ALTER FUNCTION public.cron_refresh_admin_place_pool_mv() SET work_mem = '64MB';

COMMIT;
