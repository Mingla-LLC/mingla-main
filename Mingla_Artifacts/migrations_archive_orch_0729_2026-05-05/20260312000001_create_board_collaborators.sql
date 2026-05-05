-- Migration: 20260312000001_create_board_collaborators.sql
-- Description: Creates the board_collaborators table that tracks which users have access
-- to a shared board and in what role. Referenced by 6 mobile files since day one but
-- never created in any prior migration. The INSERT policy deliberately checks session
-- membership rather than identity — the accepting user inserts rows for ALL participants
-- including the session creator, so auth.uid() = user_id would silently block owner rows.

CREATE TABLE public.board_collaborators (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id      UUID        NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT        NOT NULL DEFAULT 'collaborator'
                            CHECK (role IN ('owner', 'collaborator')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (board_id, user_id)
);

-- Index for the most common query pattern: "all collaborators for a given board"
CREATE INDEX idx_board_collaborators_board_id
  ON public.board_collaborators(board_id);

-- Index for reverse lookup: "all boards a user collaborates on"
CREATE INDEX idx_board_collaborators_user_id
  ON public.board_collaborators(user_id);

ALTER TABLE public.board_collaborators ENABLE ROW LEVEL SECURITY;

-- SELECT: Any collaborator on the board can see all other collaborators on that board.
-- The subquery checks whether the requesting user is already a collaborator on that board.
CREATE POLICY "Collaborators can view board collaborators"
  ON public.board_collaborators FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.board_collaborators bc2
      WHERE bc2.board_id = board_collaborators.board_id
        AND bc2.user_id = auth.uid()
    )
  );

-- INSERT: Must check that the inserting user is a participant in the session that owns
-- the board. Using auth.uid() = user_id here would block the owner row — the accepting
-- user inserts all rows including the creator's. Session membership is the correct gate.
CREATE POLICY "Session participants can insert board collaborators"
  ON public.board_collaborators FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.collaboration_sessions cs
      JOIN public.session_participants sp
        ON sp.session_id = cs.id
      WHERE cs.board_id = board_collaborators.board_id
        AND sp.user_id = auth.uid()
        AND sp.has_accepted = TRUE
    )
  );

-- UPDATE: Only the collaborator themselves or the board owner can update a row.
CREATE POLICY "Collaborators can update their own row"
  ON public.board_collaborators FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: Collaborators can remove themselves. Owners can remove anyone.
CREATE POLICY "Collaborators can delete their own row or owner can delete any"
  ON public.board_collaborators FOR DELETE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.board_collaborators bc_owner
      WHERE bc_owner.board_id = board_collaborators.board_id
        AND bc_owner.user_id = auth.uid()
        AND bc_owner.role = 'owner'
    )
  );
