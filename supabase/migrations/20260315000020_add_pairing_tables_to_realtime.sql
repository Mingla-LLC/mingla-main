-- Migration: add_pairing_tables_to_realtime
-- Description: Adds pair_requests, pairings, and pending_pair_invites to the
-- supabase_realtime publication so that postgres_changes subscriptions
-- actually receive events.
-- Without this, every .on('postgres_changes', { table: 'pair_requests' })
-- in the mobile app silently receives zero events — the subscription
-- connects without error, but Supabase never emits change payloads for
-- tables outside the publication.
--
-- This is the pairing-table equivalent of migration
-- 20260312400002_add_collaboration_tables_to_realtime.sql.

-- Use DO blocks with exception handling so the migration is idempotent.
-- ALTER PUBLICATION ... ADD TABLE throws duplicate_object if the table
-- is already a member.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pair_requests;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'pair_requests already in supabase_realtime';
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pairings;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'pairings already in supabase_realtime';
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_pair_invites;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'pending_pair_invites already in supabase_realtime';
END;
$$;
