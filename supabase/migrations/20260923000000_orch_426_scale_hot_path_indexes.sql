-- ===========================================================================
-- ORCH-426 (#426 PR4) — Hot-path indexes for 100k load-profile critical paths
-- ===========================================================================
--
-- Evidence: code-path analysis (not yet staging EXPLAIN — run
-- scripts/db/explain-hot-queries.sql on staging and attach output to #426).
--
-- Paths covered:
--   ticket-checkout-create — count future event_dates per event
--   ticket-checkout-status — list tickets for order (ordered)
--   agent-chat             — 24h user-message rate limit count
--
-- PostgreSQL CREATE INDEX:
--   https://www.postgresql.org/docs/current/sql-createindex.html
--
BEGIN;

-- ticket-checkout-create: .eq("event_id", …).gt("end_at", now) count/lookup
CREATE INDEX IF NOT EXISTS idx_event_dates_event_id_end_at
  ON public.event_dates (event_id, end_at);

-- ticket-checkout-status: tickets by order_id ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_tickets_order_id_created_at
  ON public.tickets (order_id, created_at ASC);

-- agent-chat rate limit: user_id + role=user + created_at window
CREATE INDEX IF NOT EXISTS idx_agent_messages_user_role_created
  ON public.agent_messages (user_id, created_at DESC)
  WHERE role = 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_event_dates_event_id_end_at'
  ) THEN
    RAISE EXCEPTION 'ORCH-426 self-verify: idx_event_dates_event_id_end_at missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_tickets_order_id_created_at'
  ) THEN
    RAISE EXCEPTION 'ORCH-426 self-verify: idx_tickets_order_id_created_at missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_agent_messages_user_role_created'
  ) THEN
    RAISE EXCEPTION 'ORCH-426 self-verify: idx_agent_messages_user_role_created missing';
  END IF;
END $$;

COMMIT;
