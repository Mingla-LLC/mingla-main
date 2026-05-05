-- Migration: add_collaboration_tables_to_realtime
-- Description: Adds collaboration_invites, collaboration_sessions, and
-- session_participants to the supabase_realtime publication so that
-- postgres_changes subscriptions actually receive events.
-- Without this, every .on('postgres_changes', { table: 'collaboration_invites' })
-- in the mobile app silently receives zero events.

-- Use DO block with exception handling so the migration is idempotent.
-- ALTER PUBLICATION ... ADD TABLE throws if the table is already a member.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.collaboration_invites;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'collaboration_invites already in supabase_realtime';
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.collaboration_sessions;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'collaboration_sessions already in supabase_realtime';
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.session_participants;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'session_participants already in supabase_realtime';
END;
$$;
