-- ORCH-0415: Change experience_id from UUID to TEXT in board_user_swipe_states.
--
-- The client sends Google Place IDs (e.g., "ChIJx4EH...") for single cards,
-- which are not valid UUIDs. The UUID type caused "invalid input syntax" errors
-- on every collab swipe for single cards.
--
-- Table was empty (0 rows) at time of migration — no data to convert.

-- Drop FK, unique constraints, and indexes that reference the old UUID type
ALTER TABLE public.board_user_swipe_states
  DROP CONSTRAINT IF EXISTS board_user_swipe_states_experience_id_fkey;
ALTER TABLE public.board_user_swipe_states
  DROP CONSTRAINT IF EXISTS board_user_swipe_states_session_id_user_id_experience_id_sa_key;
DROP INDEX IF EXISTS board_user_swipe_states_session_experience_user_unique;
DROP INDEX IF EXISTS idx_board_user_swipe_states_experience;

-- Change column type
ALTER TABLE public.board_user_swipe_states
  ALTER COLUMN experience_id TYPE TEXT USING experience_id::TEXT;

-- Recreate indexes with TEXT type
CREATE UNIQUE INDEX board_user_swipe_states_session_experience_user_unique
ON public.board_user_swipe_states (session_id, experience_id, user_id);

CREATE INDEX idx_board_user_swipe_states_experience
ON public.board_user_swipe_states (experience_id) WHERE experience_id IS NOT NULL;
