-- ============================================================================
-- Fix: messages.sender_id CASCADE → SET NULL
-- ============================================================================
-- Without this, auth.admin.deleteUser() CASCADE hard-deletes all messages
-- the user sent, destroying conversation history for other participants.
-- SET NULL preserves the message row (already soft-deleted by edge function)
-- with sender_id = NULL (anonymous).
-- ============================================================================

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
ALTER TABLE public.messages
  ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- Fix: conversations.created_by CASCADE → SET NULL
-- ============================================================================
-- Without this, deleting the conversation creator CASCADE-deletes the
-- conversation row, which CASCADE-deletes ALL messages in it (via
-- messages.conversation_id → conversations CASCADE). This destroys
-- the OTHER user's messages too. SET NULL preserves the conversation.
-- ============================================================================

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_created_by_fkey;
ALTER TABLE public.conversations
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- Fix: boards.created_by CASCADE → SET NULL
-- ============================================================================
-- Without this, deleting the board creator CASCADE-deletes the board
-- and ALL its data (board_messages, board_cards, board_votes, etc.).
-- Every other participant loses everything. SET NULL preserves the board.
-- The edge function transfers session ownership, and the board survives
-- with created_by = NULL (ownership tracked via session + collaborators).
-- ============================================================================

ALTER TABLE public.boards
  DROP CONSTRAINT IF EXISTS boards_created_by_fkey;
ALTER TABLE public.boards
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.boards
  ADD CONSTRAINT boards_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- Fix: board_cards.added_by CASCADE → SET NULL
-- ============================================================================
-- Without this, deleting the user who added a card to a shared board
-- CASCADE-deletes the card for all other participants.
-- ============================================================================

ALTER TABLE public.board_cards
  DROP CONSTRAINT IF EXISTS board_cards_added_by_fkey;
ALTER TABLE public.board_cards
  ALTER COLUMN added_by DROP NOT NULL;
ALTER TABLE public.board_cards
  ADD CONSTRAINT board_cards_added_by_fkey
  FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- Fix: board_messages.user_id CASCADE → SET NULL
-- ============================================================================
-- Board messages are visible to all session participants. CASCADE would
-- destroy the deleted user's messages from board discussions. SET NULL
-- preserves them anonymized (greyed out in UI).
-- Same for board_card_messages (card thread messages).
-- ============================================================================

ALTER TABLE public.board_messages
  DROP CONSTRAINT IF EXISTS board_messages_user_id_fkey;
ALTER TABLE public.board_messages
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.board_messages
  ADD CONSTRAINT board_messages_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.board_card_messages
  DROP CONSTRAINT IF EXISTS board_card_messages_user_id_fkey;
ALTER TABLE public.board_card_messages
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.board_card_messages
  ADD CONSTRAINT board_card_messages_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- Fix: place_reviews.user_id CASCADE → SET NULL
-- ============================================================================
-- Preserves star ratings on user deletion. review_count_local and
-- avg_rating_local on card_pool stay accurate. The edge function scrubs
-- audio/text PII before deletion; the rating and place data survive.
-- ============================================================================

ALTER TABLE public.place_reviews
  DROP CONSTRAINT IF EXISTS place_reviews_user_id_fkey;
ALTER TABLE public.place_reviews
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.place_reviews
  ADD CONSTRAINT place_reviews_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- Fix: board_threads.user_id CASCADE → SET NULL
-- ============================================================================
-- board_threads.parent_id self-references with CASCADE. If a user's thread
-- is cascade-deleted, all child threads (other users' replies) cascade too.
-- SET NULL preserves the thread anonymized.
-- ============================================================================

ALTER TABLE public.board_threads
  DROP CONSTRAINT IF EXISTS board_threads_user_id_fkey;
ALTER TABLE public.board_threads
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.board_threads
  ADD CONSTRAINT board_threads_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- Fix: pending_invites.inviter_id CASCADE → SET NULL
-- ============================================================================
-- The edge function cancels invites by inviter_id (audit trail). But CASCADE
-- would hard-delete them in Step 4. SET NULL preserves the cancelled rows.
-- Same for pending_session_invites.
-- ============================================================================

ALTER TABLE public.pending_invites
  DROP CONSTRAINT IF EXISTS pending_invites_inviter_id_fkey;
ALTER TABLE public.pending_invites
  ALTER COLUMN inviter_id DROP NOT NULL;
ALTER TABLE public.pending_invites
  ADD CONSTRAINT pending_invites_inviter_id_fkey
  FOREIGN KEY (inviter_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.pending_session_invites
  DROP CONSTRAINT IF EXISTS pending_session_invites_inviter_id_fkey;
ALTER TABLE public.pending_session_invites
  ALTER COLUMN inviter_id DROP NOT NULL;
ALTER TABLE public.pending_session_invites
  ADD CONSTRAINT pending_session_invites_inviter_id_fkey
  FOREIGN KEY (inviter_id) REFERENCES auth.users(id) ON DELETE SET NULL;
