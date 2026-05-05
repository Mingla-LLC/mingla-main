-- Migration: fix_board_votes_unique_constraint
-- Description: Replace partial unique index with full UNIQUE constraint so ON CONFLICT works.

DROP INDEX IF EXISTS public.board_votes_session_saved_card_user_unique;

ALTER TABLE public.board_votes
  ADD CONSTRAINT board_votes_session_saved_card_user_unique
  UNIQUE (session_id, saved_card_id, user_id);
