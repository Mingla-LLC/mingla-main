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
-- 2. A file is attached only once it is really in the bucket. A registered
--    attachment row whose object was never uploaded used to attach, leaving
--    a message with a broken file. issue_4382_attach_to_message now requires
--    the support-attachments object at storage_path and refuses with PT409
--    'attachment_not_uploaded' otherwise (after the ownership checks, which
--    still refuse with 22023 'attachment_not_available').

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

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Attach only uploaded files.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4382_attach_to_message(
  p_ticket_id uuid,
  p_message_id uuid,
  p_attachment_ids uuid[],
  p_sender_id uuid,
  p_is_internal boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_wanted integer;
  v_done integer;
BEGIN
  SELECT count(DISTINCT id) INTO v_wanted FROM unnest(COALESCE(p_attachment_ids, ARRAY[]::uuid[])) id;
  IF v_wanted = 0 THEN RETURN 0; END IF;
  IF v_wanted > 11 THEN
    RAISE EXCEPTION 'too_many_attachments' USING ERRCODE = '22023';
  END IF;

  -- Draft uploads join the ticket the moment it exists.
  UPDATE public.support_attachments a
     SET ticket_id = p_ticket_id, draft_ticket_id = NULL
   WHERE a.id = ANY(p_attachment_ids)
     AND a.draft_ticket_id = p_ticket_id
     AND a.uploaded_by = p_sender_id;

  UPDATE public.support_attachments a
     SET message_id = p_message_id,
         is_internal = a.is_internal OR p_is_internal
   WHERE a.id = ANY(p_attachment_ids)
     AND a.ticket_id = p_ticket_id
     AND a.uploaded_by = p_sender_id
     AND a.message_id IS NULL
     AND a.purge_started_at IS NULL
     AND (p_is_internal OR NOT a.is_internal);
  GET DIAGNOSTICS v_done = ROW_COUNT;
  IF v_done <> v_wanted THEN
    RAISE EXCEPTION 'attachment_not_available' USING ERRCODE = '22023';
  END IF;
  -- The object must be in the bucket at the registered path. Raising here
  -- rolls the attach back with the whole send.
  IF EXISTS (
    SELECT 1 FROM public.support_attachments a
     WHERE a.id = ANY(p_attachment_ids)
       AND NOT EXISTS (
         SELECT 1 FROM storage.objects o
          WHERE o.bucket_id = 'support-attachments' AND o.name = a.storage_path
       )
  ) THEN
    RAISE EXCEPTION 'attachment_not_uploaded' USING ERRCODE = 'PT409',
      HINT = 'Upload the file to its storage_path before sending it.';
  END IF;
  IF (SELECT count(*) FROM public.support_attachments WHERE message_id = p_message_id AND kind = 'audio') > 1 THEN
    RAISE EXCEPTION 'one_voice_note_per_message' USING ERRCODE = '22023';
  END IF;
  RETURN v_done;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_attach_to_message(uuid, uuid, uuid[], uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4382_attach_to_message(uuid, uuid, uuid[], uuid, boolean) TO service_role;

COMMIT;
