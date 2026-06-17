-- ORCH-1156: CI-green cleanup of META-ORCH-1148 Venue Suite debt.
-- Pairs the Venue realtime subscriptions with the supabase_realtime publication.
-- mingla-business/src/hooks/useVenueReservations.ts subscribes postgres_changes on
-- public.reservations, and useVenueWaitlist.ts subscribes on public.venue_waitlist,
-- but neither table was a member of the supabase_realtime publication -> those
-- subscriptions were silently no-op AND the I-PROPOSED-BV strict-grep gate
-- (orch-0854-tickets-realtime-publication-paired.mjs) failed for every PR.
-- This migration adds both tables to the publication, idempotently (ALTER
-- PUBLICATION ... ADD TABLE errors if the table is already a member, so each
-- is guarded by a pg_publication_tables membership check).

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reservations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'venue_waitlist'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.venue_waitlist;
  END IF;
END $$;

COMMIT;
