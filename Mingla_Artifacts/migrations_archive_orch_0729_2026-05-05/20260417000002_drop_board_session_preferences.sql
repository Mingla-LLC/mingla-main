-- ORCH-0446: board_session_preferences replaced by participant_prefs JSONB column
-- on collaboration_sessions. All data is ephemeral (session-scoped preferences).
-- No data migration needed — preferences are re-snapshotted from solo on next join.

-- Remove from Realtime publication first (ignore error if not in publication)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.board_session_preferences;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Drop RLS policies (use IF EXISTS to handle any naming variations)
DROP POLICY IF EXISTS "bsp_select" ON public.board_session_preferences;
DROP POLICY IF EXISTS "bsp_insert" ON public.board_session_preferences;
DROP POLICY IF EXISTS "bsp_update" ON public.board_session_preferences;
DROP POLICY IF EXISTS "bsp_delete" ON public.board_session_preferences;
DROP POLICY IF EXISTS "board_session_preferences_select" ON public.board_session_preferences;
DROP POLICY IF EXISTS "board_session_preferences_insert" ON public.board_session_preferences;
DROP POLICY IF EXISTS "board_session_preferences_update" ON public.board_session_preferences;
DROP POLICY IF EXISTS "board_session_preferences_delete" ON public.board_session_preferences;

-- Drop table
DROP TABLE IF EXISTS public.board_session_preferences;
