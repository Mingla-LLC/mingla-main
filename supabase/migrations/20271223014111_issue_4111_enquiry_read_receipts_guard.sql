-- #4111 tester fix — read receipts on enquiry messages.
--
-- Explorer marks a brand's enquiry replies as read by upserting its own
-- message_reads rows. The only message_reads write policy (pre-#4111) is
-- "user_id = auth.uid()": it never asks whether the writer can read the
-- message. Proven on the pg17 replay: any signed-in user holding an enquiry
-- message id could write a receipt for it. This adds a restrictive guard for
-- enquiry messages only: the writer must be someone who can read the enquiry
-- (issue_4111_enquiry_can_read). Receipts on every other kind of chat keep
-- their existing behaviour.
--
-- INVARIANT: {"id":"I-4111-ENQUIRY-READ-RECEIPT-READER-ONLY","rule":"A message_reads row for a message in a brand_enquiry conversation can only be written by a user who can read that enquiry."}

BEGIN;

-- SECURITY DEFINER: the policy must see the message even when the writer
-- cannot (otherwise an unreadable enquiry message looks like "not an enquiry").
CREATE OR REPLACE FUNCTION public.issue_4111_read_receipt_allowed(p_message_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = p_message_id AND c.linked_entity_type = 'brand_enquiry'
  ) OR EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id
      AND public.issue_4111_enquiry_can_read(m.conversation_id, p_user_id)
  );
$function$;
-- Granted to every client role so the policy never fails with a privilege
-- error (anon writes are still refused by the permissive policy).
REVOKE ALL ON FUNCTION public.issue_4111_read_receipt_allowed(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4111_read_receipt_allowed(uuid, uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS message_reads_brand_enquiry_reader_insert ON public.message_reads;
CREATE POLICY message_reads_brand_enquiry_reader_insert ON public.message_reads
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.issue_4111_read_receipt_allowed(message_id, auth.uid()));

DROP POLICY IF EXISTS message_reads_brand_enquiry_reader_update ON public.message_reads;
CREATE POLICY message_reads_brand_enquiry_reader_update ON public.message_reads
  AS RESTRICTIVE FOR UPDATE TO public
  USING (public.issue_4111_read_receipt_allowed(message_id, auth.uid()))
  WITH CHECK (public.issue_4111_read_receipt_allowed(message_id, auth.uid()));

COMMIT;
