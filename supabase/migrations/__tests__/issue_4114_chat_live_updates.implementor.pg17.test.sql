\set ON_ERROR_STOP on

-- Issue #4114 simulator QA: reactions and view-once opens update live.
--
--   L-01  direct_message_reactions and message_media_views are in the
--         supabase_realtime publication (messages still is).
--   L-02  re-running the migration is a no-op (idempotent).
--
-- FAILS-ON-REVERT: drop 20271230074114_issue_4114_chat_live_updates.sql from
-- the chain and L-01 fails.
--
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.

BEGIN;

DO $l01$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'L-01: supabase_realtime publication missing from the replayed chain';
  END IF;
  FOREACH t IN ARRAY ARRAY['messages', 'direct_message_reactions', 'message_media_views'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      RAISE EXCEPTION 'L-01: public.% is not in supabase_realtime', t;
    END IF;
  END LOOP;
END $l01$;

\ir ../20271230074114_issue_4114_chat_live_updates.sql

DO $l02$
BEGIN
  IF (SELECT count(*) FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename IN ('direct_message_reactions', 'message_media_views')) <> 2 THEN
    RAISE EXCEPTION 'L-02: re-running the migration changed the publication';
  END IF;
END $l02$;

ROLLBACK;
