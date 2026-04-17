-- Enable REPLICA IDENTITY FULL on collaboration tables.
-- Required for Supabase Realtime DELETE/INSERT event filters to work.
-- Without FULL, events don't include column values in WAL,
-- so user-specific filters (e.g. `invited_user_id=eq.X`) silently
-- drop events and the client never learns about changes.

ALTER TABLE collaboration_sessions REPLICA IDENTITY FULL;
ALTER TABLE collaboration_invites REPLICA IDENTITY FULL;
ALTER TABLE session_participants REPLICA IDENTITY FULL;
