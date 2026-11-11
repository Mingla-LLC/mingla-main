-- #4382 Support Desk redesign: tester findings on the support write paths.
--
-- 1. Support messages go through one server path. A requester (or brand
--    member, or any signed-in participant) could POST /rest/v1/messages into a
--    support conversation, even on a closed ticket, and skip the closed
--    refusal, reopen-on-reply, last_sender_kind and the alerts. Every support
--    message is now written by the SECURITY DEFINER functions
--    (issue_4382_post_support_message and the create / Told / next-update
--    functions, which run as the table owner) or by the service role
--    (support-send, Ari). A RESTRICTIVE policy refuses every direct insert by
--    anon or authenticated into a conversation linked to support.
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. No direct inserts into support conversations.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4382_is_support_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_conversation_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = p_conversation_id AND c.linked_entity_type = 'support'
    )
    OR EXISTS (
      SELECT 1 FROM public.support_tickets t WHERE t.conversation_id = p_conversation_id
    )
  );
$$;
REVOKE ALL ON FUNCTION public.issue_4382_is_support_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4382_is_support_conversation(uuid) TO authenticated, service_role;

-- The brand-member insert policy only served direct inserts; support-send
-- replaced it in Wave 1.
DROP POLICY IF EXISTS messages_brand_support_insert ON public.messages;

DROP POLICY IF EXISTS messages_support_server_path_only ON public.messages;
CREATE POLICY messages_support_server_path_only ON public.messages
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (NOT public.issue_4382_is_support_conversation(conversation_id));

COMMIT;
