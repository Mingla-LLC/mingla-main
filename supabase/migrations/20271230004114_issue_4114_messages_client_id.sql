-- Issue #4114 Wave 1: messages send once, show once, and never vanish.
--
-- A chat message can reach the sender's screen twice: once from the insert's
-- own response and once from the realtime INSERT echo. The app used to pair the
-- two by guessing (same sender + same text + under 5 seconds apart), which fails
-- on slow networks, on photos and when the phone clock is off.
--
-- This adds a client-made id to every new message. The phone mints it before
-- sending, keeps it on the optimistic bubble, and reuses it on every retry, so:
--   * the app merges the echo, the insert response and any refresh by one key;
--   * a retry after a lost response finds the row that already landed instead of
--     inserting a second copy (the unique index below refuses the duplicate).
--
-- Additive only: a nullable column (legacy rows and server-written rows such as
-- system banners, blasts and RPC inserts keep NULL) plus a partial unique index
-- that ignores NULLs. No policy, trigger or function changes: the existing
-- INSERT policies check the row the client sends, and every trigger on
-- public.messages (messages_attach_native_content_card_descriptor BEFORE INSERT,
-- update_conversation_on_message, reopen_hidden_conversation_on_human_message,
-- update_messages_updated_at) either ignores the new column or only fires after
-- a successful insert, so a refused duplicate has no side effects. The existing
-- messages_unique_blast_per_conversation index is untouched.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_id uuid NULL;

COMMENT ON COLUMN public.messages.client_id IS
  'Issue #4114: id minted by the sending app before the insert and reused on every retry. Unique per conversation when set; NULL for legacy and server-written rows.';

CREATE UNIQUE INDEX IF NOT EXISTS messages_unique_client_id_per_conversation
  ON public.messages (conversation_id, client_id)
  WHERE client_id IS NOT NULL;
