-- ORCH-0415 completion: Change board_saved_cards.experience_id from UUID to TEXT.
--
-- The mutual-like trigger (check_mutual_like) compares experience_id between
-- board_user_swipe_states (already TEXT) and board_saved_cards (was UUID).
-- This caused "operator does not exist: uuid = text" on every collab right-swipe.
--
-- Also affects BoardCardService.checkForMatch() which queries board_saved_cards
-- with .eq('experience_id', experienceId) where experienceId is a Google Place ID string.
--
-- 6 rows exist at time of migration, all with experience_id = NULL — safe to alter.

ALTER TABLE public.board_saved_cards
  DROP CONSTRAINT IF EXISTS board_saved_cards_experience_id_fkey;

ALTER TABLE public.board_saved_cards
  ALTER COLUMN experience_id TYPE TEXT USING experience_id::TEXT;
