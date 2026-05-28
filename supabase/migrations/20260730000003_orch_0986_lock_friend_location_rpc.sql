-- ORCH-0986 P0 fix (QA P0-001): lock get_paired_friend_last_location to service_role only.
--
-- QA found the RPC was callable via PostgREST with the public anon key and returned
-- a paired friend's raw latitude/longitude — a privacy breach violating
-- I-0986-NO-COORD-LEAK / I-0986-FRIEND-GPS-ONLY. Root cause: the original migration
-- granted EXECUTE to `authenticated`, and the function is exposed on the REST RPC
-- surface. This RPC is ONLY ever called server-side by edge functions using the
-- service-role key (adminClient.rpc), so no client role should be able to call it.
--
-- Fix: revoke EXECUTE from every client-facing role; grant ONLY to service_role.
-- Edge functions continue to work (they use the service-role key). The consent gate
-- inside the function remains as defense-in-depth; the edge function passes the
-- authenticated caller's real id as p_viewer_id (resolved via auth.getUser()).

revoke all on function public.get_paired_friend_last_location(uuid, uuid) from public;
revoke all on function public.get_paired_friend_last_location(uuid, uuid) from anon;
revoke all on function public.get_paired_friend_last_location(uuid, uuid) from authenticated;
grant execute on function public.get_paired_friend_last_location(uuid, uuid) to service_role;
