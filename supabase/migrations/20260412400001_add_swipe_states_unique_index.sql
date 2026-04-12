-- ORCH-0415: Add unique index with the name boardCardService.ts expects.
--
-- The client code at boardCardService.ts:127 uses:
--   onConflict: 'board_user_swipe_states_session_experience_user_unique'
--
-- The existing auto-generated constraint has a different name:
--   board_user_swipe_states_session_id_user_id_experience_id_sa_key
-- AND includes saved_experience_id as a 4th column.
--
-- This creates the 3-column unique index the code actually references.

CREATE UNIQUE INDEX IF NOT EXISTS board_user_swipe_states_session_experience_user_unique
ON public.board_user_swipe_states (session_id, experience_id, user_id);
