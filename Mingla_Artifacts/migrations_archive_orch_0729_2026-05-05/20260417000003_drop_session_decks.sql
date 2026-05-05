-- ORCH-0446: session_decks was server-side deck cache for generate-session-deck.
-- Collab decks now use client-side React Query cache (same as solo).
-- All data is ephemeral (cached deck cards with TTL).

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.session_decks;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "session_decks_select" ON public.session_decks;
DROP POLICY IF EXISTS "session_decks_insert" ON public.session_decks;
DROP POLICY IF EXISTS "session_decks_update" ON public.session_decks;
DROP POLICY IF EXISTS "session_decks_delete" ON public.session_decks;

DROP TABLE IF EXISTS public.session_decks;
