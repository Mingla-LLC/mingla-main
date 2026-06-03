-- ORCH-1058B: widen messages.message_type CHECK to allow 'system'
--
-- The collab dead-end banner (rpc_post_collab_dead_end_banner) inserts a row
-- with sender_id = NULL and message_type = 'system'. The original CHECK only
-- permitted ('text','image','video','file','card'), so the insert failed with
-- messages_message_type_check violated ("Couldn't notify the group").
--
-- This migration drops and re-adds the constraint with 'system' included.
-- Already applied to the remote project (version recorded); this file folds it
-- onto main for source parity.

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK ((message_type)::text = ANY (ARRAY['text','image','video','file','card','system']::text[]));
