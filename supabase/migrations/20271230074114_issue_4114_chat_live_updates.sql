-- Issue #4114 (simulator QA): reactions and view-once opens update live.
--
-- 1. direct_message_reactions joins the realtime publication, so a reaction
--    added or removed by the other person shows in the open chat without a
--    refetch (INSERT carries the row, RLS limits it to chats you are in;
--    DELETE carries the row id, which the app matches against its own rows).
-- 2. message_media_views joins the realtime publication, so the sender's
--    view-once bubble turns "Opened" the moment the recipient opens it (RLS:
--    the sender reads every open of their own message, a recipient only
--    their own).
--
-- Additive and idempotent: each table is added only when the publication
-- exists and does not already carry it. No data is changed.

DO $realtime$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'direct_message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_message_reactions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_media_views'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_media_views;
  END IF;
END;
$realtime$;
