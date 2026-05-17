-- ORCH-0852 [Buyer-web confirmation QR clipped + wallet passes inert + in-app-browser stuck after payment]
-- Add public.ticket_checkout_sessions to the supabase_realtime publication so
-- the buyer-web confirm page can subscribe to UPDATE events filtered by id
-- and receive a push the moment session.order_id transitions from NULL to a
-- finalized UUID (whether via the new ticket-checkout-confirm sync path or via
-- the existing Stripe webhook backup).
--
-- This enables I-CHECKOUT-OWN-CONFIRM-PATH's Realtime safety net: if the
-- buyer's synchronous confirm fails or returns pending, the buyer-web
-- confirm.tsx mounts useOrderRealtimeSubscription, which listens here and
-- transitions the screen to the full order render as soon as the row is
-- updated.
--
-- Idempotent: ALTER PUBLICATION ... ADD TABLE is a no-op if the table is
-- already in the publication. Guarded with a DO block + IF NOT EXISTS check
-- so re-running this migration on an environment that already added the
-- table (e.g., a future ORCH that adds it independently) is safe.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'ticket_checkout_sessions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_checkout_sessions';
  END IF;
END;
$$;
