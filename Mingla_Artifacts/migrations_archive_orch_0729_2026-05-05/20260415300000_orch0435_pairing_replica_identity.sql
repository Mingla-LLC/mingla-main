-- ORCH-0435: Enable REPLICA IDENTITY FULL on pairing tables
-- Required for Supabase Realtime server-side filters to work on INSERT events.
-- Without FULL, INSERT events don't include column values in WAL, so filters like
-- `user_a_id=eq.${userId}` silently drop the event. UPDATE events work with DEFAULT
-- because Postgres includes old row values, but INSERT does not.
--
-- This fixes: sender doesn't see pairing updates in realtime when receiver accepts.

ALTER TABLE pairings REPLICA IDENTITY FULL;
ALTER TABLE pair_requests REPLICA IDENTITY FULL;
ALTER TABLE pending_pair_invites REPLICA IDENTITY FULL;
