-- Migration: add_board_discussion_tables_to_realtime
-- Description: Adds board discussion and collaboration tables to the
--   supabase_realtime publication so postgres_changes events fire correctly.
--
--   These tables all have active listeners in realtimeService.subscribeToBoardSession()
--   but were never added to the publication, meaning postgres_changes events
--   for INSERT/UPDATE/DELETE on these tables silently never arrived.
--
--   Tables added:
--     1. board_messages             — main discussion chat in board sessions
--     2. board_card_messages        — per-card discussion threads
--     3. board_message_reactions    — emoji reactions on board messages
--     4. board_participant_presence — online/offline presence tracking
--     5. board_session_preferences  — per-user preference changes (triggers deck regen)
--     6. session_decks              — deck generation results (triggers refetch for all)

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.board_messages;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'board_messages already in supabase_realtime';
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.board_card_messages;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'board_card_messages already in supabase_realtime';
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.board_message_reactions;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'board_message_reactions already in supabase_realtime';
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.board_participant_presence;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'board_participant_presence already in supabase_realtime';
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.board_session_preferences;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'board_session_preferences already in supabase_realtime';
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.session_decks;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'session_decks already in supabase_realtime';
END $$;
