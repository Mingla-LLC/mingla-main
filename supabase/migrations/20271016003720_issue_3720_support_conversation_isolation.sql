-- #3720 Phase 0 / Slice D1 — keep support out of the consumer conversations list
-- at the RLS layer (bug 13 / #668).
--
-- Support tickets still reuse conversations/messages (I-PROPOSED-CHAT-SUBSTRATE-UNIFIED).
-- Today the requester is a real participant, so the base participant SELECT policies
-- return support rows; Explorer only hid them with a client .neq filter. Any alternate
-- from('conversations') read that forgot the filter leaked support into consumer lists.
--
-- Subtract-before-add: reshape the two hotfix participant SELECT policies to exclude
-- linked_entity_type='support'. Staff keep conversations_support_staff_read. Requesters
-- read tickets via support_tickets and messages via the existing participant messages
-- policies (SupportThreadCore never selects the conversations row).

DROP POLICY IF EXISTS "Users can view conversations they participate in" ON public.conversations;
CREATE POLICY "Users can view conversations they participate in"
  ON public.conversations
  FOR SELECT
  USING (
    (
      created_by = auth.uid()
      OR public.is_conversation_participant(conversations.id, auth.uid())
    )
    AND conversations.linked_entity_type IS DISTINCT FROM 'support'
  );

DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
CREATE POLICY "Users can view their conversations"
  ON public.conversations
  FOR SELECT
  USING (
    public.is_conversation_participant(conversations.id, auth.uid())
    AND conversations.linked_entity_type IS DISTINCT FROM 'support'
  );
