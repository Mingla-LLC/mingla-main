-- ORCH-1188 FIX 3a [consumer calendar — booked occurrence date]
-- ===================================================================
-- The consumer calendar reads a business-event order's date from the EVENT's
-- `is_master` occurrence, which is the event's *primary* (often past) date — NOT
-- the occurrence the buyer actually booked. The booked occurrence id is captured
-- only inside `ticket_checkout_sessions.metadata->>'event_date_id'`; `orders` has
-- no column for it, so the calendar shows the wrong (often past → Archives) date.
--
-- This migration adds a nullable `orders.event_date_id` FK to `event_dates(id)`
-- so the booked occurrence can be persisted onto the order at finalize (see the
-- sibling 20261117000001 migration). ADDITIVE + nullable: every existing /
-- single-date / legacy order keeps `event_date_id = NULL` and the calendar
-- falls back to the master occurrence (unchanged behaviour). No backfill.
--
-- Collision-checked: highest migration prefix across active worktrees + main =
-- 20261116000000 (ORCH-1187 reconcile cron); this uses 20261117000000.
--
-- Idempotent / safe to re-run: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS + a guarded FK add.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS event_date_id uuid;

-- FK to the occurrence the buyer booked. ON DELETE SET NULL: deleting a stale
-- occurrence must NOT cascade-delete a paid order; the calendar simply falls
-- back to the master date.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_event_date_id_fkey'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_event_date_id_fkey
      FOREIGN KEY (event_date_id)
      REFERENCES public.event_dates(id)
      ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS orders_event_date_id_idx
  ON public.orders (event_date_id)
  WHERE event_date_id IS NOT NULL;

COMMENT ON COLUMN public.orders.event_date_id IS
  'ORCH-1188: the specific event occurrence the buyer booked (copied from ticket_checkout_sessions.metadata->>''event_date_id'' by biz_ticket_checkout_finalize). NULL for single-date events / legacy orders → consumer calendar falls back to the is_master occurrence.';

NOTIFY pgrst, 'reload schema';
