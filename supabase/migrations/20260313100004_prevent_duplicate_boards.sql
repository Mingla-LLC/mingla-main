-- Migration: prevent_duplicate_boards
-- Description: Add a partial unique index on collaboration_sessions.board_id
-- to prevent concurrent accepts from creating duplicate boards (Defect D4).

-- Partial unique index: only one non-null board_id per session
-- (multiple sessions CAN share null board_id, which is fine — that's the pending state)
CREATE UNIQUE INDEX IF NOT EXISTS idx_collaboration_sessions_board_id_unique
  ON public.collaboration_sessions (board_id)
  WHERE board_id IS NOT NULL;

-- Comment explaining the constraint
COMMENT ON INDEX idx_collaboration_sessions_board_id_unique IS
  'Prevents duplicate board creation during concurrent session accepts. '
  'Only one session can reference a given board_id. The partial WHERE clause '
  'allows multiple sessions to have NULL board_id (pending state).';
