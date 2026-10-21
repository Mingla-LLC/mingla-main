-- issue #3827 — orders link to their private ticket link (production hotfix record).
--
-- 20271128013827 added orders.ticket_link_id without a foreign key and said the
-- private-links piece would add it; 20271209003827 created ticket_type_links but
-- never did. The Host app's Orders and Guests screens embed
-- `ticket_type_links ( label )` from orders, and PostgREST refuses an embed with
-- no relationship (HTTP 400), so every Orders and Guests screen failed.
--
-- ALREADY APPLIED IN PRODUCTION on 2026-10-21 (0 orders carried a
-- ticket_link_id at the time) and stamped as version 20271210003827. This file
-- is the source record. It is idempotent: where the constraint already exists,
-- as in production, it changes nothing. orders_ticket_link_idx (20271128013827)
-- already indexes the column for the ON DELETE SET NULL path.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass
       AND conname = 'orders_ticket_link_id_fkey'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_ticket_link_id_fkey
      FOREIGN KEY (ticket_link_id)
      REFERENCES public.ticket_type_links(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
