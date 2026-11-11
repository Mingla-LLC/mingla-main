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
-- 3. The pre-#4382 create_support_ticket(text, uuid) stays for installed Host
--    builds, but a brand_id the caller does not belong to is dropped (the
--    ticket becomes personal) instead of being filed against that brand.

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

-- ─────────────────────────────────────────────────────────────────────────
-- 3. The old create keeps only the caller's own brand.
-- ─────────────────────────────────────────────────────────────────────────
-- Same body as 20271120003988_issue_3988_operational_permissions.sql except
-- the brand check.
CREATE OR REPLACE FUNCTION public.create_support_ticket(p_subject text, p_brand_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conv uuid;
  v_ticket uuid;
  v_seg text;
  v_subject text := left(btrim(COALESCE(p_subject, '')), 200);
  v_brand uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_subject = '' THEN
    RAISE EXCEPTION 'subject_required' USING ERRCODE = 'P0001';
  END IF;

  -- #4382: a brand is kept only when the caller belongs to it (an active
  -- team member, or the account that owns it). Installed Host builds pass
  -- their current brand, so a member keeps it; anyone else gets a personal
  -- ticket instead of an error, and never one filed against a stranger's brand.
  IF p_brand_id IS NOT NULL AND (
    public.issue_4382_is_brand_member(p_brand_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id AND b.account_id = auth.uid())
  ) THEN
    v_brand := p_brand_id;
  END IF;

  v_seg := public.derive_user_segment(auth.uid());
  IF v_seg = 'admin' THEN v_seg := 'business'; END IF;
  IF v_seg NOT IN ('business', 'explorer') THEN v_seg := 'business'; END IF;

  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
  VALUES ('group', 'support', v_subject, auth.uid())
  RETURNING id INTO v_conv;

  INSERT INTO public.conversation_participants(conversation_id, user_id)
  VALUES (v_conv, auth.uid());

  INSERT INTO public.support_tickets(
    requester_user_id, requester_segment, subject, conversation_id, brand_id
  ) VALUES (
    auth.uid(), v_seg, v_subject, v_conv, v_brand
  ) RETURNING id INTO v_ticket;

  -- Support-ticket alerts are bell + push + email only. Country remains NULL
  -- because no SMS channel is eligible for this category.
  INSERT INTO public.notification_outbox (
    category_key, user_id, brand_id, country_code, payload,
    idempotency_key, status
  )
  SELECT
    'business.support_new_ticket',
    s.user_id,
    v_brand,
    NULL,
    jsonb_build_object(
      'ticket_id', v_ticket,
      'subject', v_subject,
      'deep_link', 'mingla-business://support/' || v_ticket::text
    ),
    'business.support_new_ticket:' || v_ticket::text || ':' || s.user_id::text,
    'pending'
  FROM public.support_staff s
  JOIN auth.users u ON u.id = s.user_id
  WHERE s.enabled = true
    AND public.is_support_staff(s.user_id)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_ticket;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_support_ticket(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, uuid) TO authenticated, service_role;

COMMIT;
