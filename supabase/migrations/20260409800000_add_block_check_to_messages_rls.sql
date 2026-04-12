-- ORCH-0356/0357: Add block check to messages INSERT policy.
-- Prevents sending messages to conversations where a block exists between participants.
-- Defense-in-depth: UI and service layer also enforce, but RLS is the last line.

-- Drop the existing INSERT policy
DROP POLICY IF EXISTS "Users can send messages to conversations they participate in" ON public.messages;

-- Recreate with block check
CREATE POLICY "Users can send messages to conversations they participate in"
  ON public.messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id
      AND cp.user_id = auth.uid()
    )
    -- Block check: prevent messaging blocked users (either direction)
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users bu
      WHERE (
        bu.blocker_id = auth.uid()
        AND bu.blocked_id IN (
          SELECT cp2.user_id FROM public.conversation_participants cp2
          WHERE cp2.conversation_id = messages.conversation_id
          AND cp2.user_id != auth.uid()
        )
      )
      OR (
        bu.blocked_id = auth.uid()
        AND bu.blocker_id IN (
          SELECT cp3.user_id FROM public.conversation_participants cp3
          WHERE cp3.conversation_id = messages.conversation_id
          AND cp3.user_id != auth.uid()
        )
      )
    )
  );
