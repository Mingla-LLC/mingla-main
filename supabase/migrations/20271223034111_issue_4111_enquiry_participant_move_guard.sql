-- #4111 tester fix — nobody can move a participant row INTO an enquiry.
--
-- The pre-#4111 policy "Users can update their own participation" checks only
-- user_id = auth.uid(); it lets a signed-in user change the conversation_id of
-- their own conversation_participants row. Proven on the pg17 replay: a user
-- who knows an enquiry's conversation id (an Explorer guest's own thread, or a
-- team member who was later removed or made scanner-only) could re-point any of
-- their participant rows at that enquiry and then read every message through
-- the legacy participant read policies — bypassing D8 and the scanner rule.
--
-- This restrictive guard covers enquiry conversations only: a participant row
-- may sit in (or be moved into) an enquiry conversation only by someone who can
-- read that enquiry. The Explorer guest can still update their own row in
-- place (last_read_at, notifications_muted). The type check is SECURITY
-- DEFINER because the writer may not be able to see the target conversation.
--
-- INVARIANT: {"id":"I-4111-ENQUIRY-PARTICIPANT-NO-MOVE-IN","rule":"A conversation_participants row can only be updated into a brand_enquiry conversation by a user who can read that enquiry."}

BEGIN;

-- One SECURITY DEFINER predicate for signed-in roles (the policy applies TO
-- authenticated; anon has no participant rows of its own to move): the row is
-- not in an enquiry conversation, or the user can read that enquiry.
CREATE OR REPLACE FUNCTION public.issue_4111_participant_row_allowed(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id AND c.linked_entity_type = 'brand_enquiry'
  ) OR public.issue_4111_enquiry_can_read(p_conversation_id, p_user_id);
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_participant_row_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4111_participant_row_allowed(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS conversation_participants_brand_enquiry_update_guard ON public.conversation_participants;
CREATE POLICY conversation_participants_brand_enquiry_update_guard ON public.conversation_participants
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.issue_4111_participant_row_allowed(conversation_id, auth.uid()))
  WITH CHECK (public.issue_4111_participant_row_allowed(conversation_id, auth.uid()));

COMMIT;
