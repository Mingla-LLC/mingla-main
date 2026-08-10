-- ===========================================================================
-- Issue #1790 — SPEC #1788 P-6 / P-66.
-- Adds the order family's realtime-subscribed tables to `supabase_realtime`.
--
-- Phase 3's Orders queue subscribes `postgres_changes` on `public.venue_orders`
-- (filtered on venue_id, a NON-PK column, per the ORCH-0931 PK-filter
-- silent-drop rule). A subscription on an UNPUBLISHED table is silently no-op —
-- that exact failure has already shipped twice (ORCH-0816 orders, ORCH-0854
-- tickets), which is why `orch-0854-tickets-realtime-publication-paired.mjs`
-- exists and why `BASELINE_PUBLICATION_TABLES` gains the same names in THIS PR.
--
-- `venue_order_sessions` is published too: Phase 3b's tab view watches the tab
-- lifecycle, and adding it now costs one idempotent DO block rather than a
-- second migration + a second allowlist edit later.
--
-- Idempotent: `ALTER PUBLICATION ... ADD TABLE` ERRORS when the table is already
-- a member, so each add is guarded by a pg_publication_tables membership check
-- (the 20261013000001_orch_1156_venue_realtime_publication.sql:14-34 idiom).
-- ===========================================================================

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'venue_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.venue_orders;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'venue_order_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.venue_order_sessions;
  END IF;
END $$;

COMMIT;
