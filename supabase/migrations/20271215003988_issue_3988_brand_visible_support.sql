-- #3988 — staff can open a support case for a brand without exposing internal
-- work notes. Every active brand member can read/reply to the shared case and
-- receives durable open/owner/progress notifications.
-- INVARIANT: {"id":"I-3988-BRAND-SUPPORT-AUDIENCE","rule":"Only tickets explicitly marked audience=brand are readable by active accepted members of their linked brand; internal staff threads remain private."}
-- INVARIANT: {"id":"I-3988-BRAND-SUPPORT-FANOUT","rule":"Creating or materially progressing a brand-visible support ticket enqueues one idempotent notification per active accepted brand member."}

BEGIN;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'requester',
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_audience_check;
ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_audience_check CHECK (audience IN ('requester', 'brand'));
ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_brand_audience_requires_brand;
ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_brand_audience_requires_brand CHECK (audience <> 'brand' OR brand_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_creator_request_key
  ON public.support_tickets(created_by, client_request_id)
  WHERE created_by IS NOT NULL AND client_request_id IS NOT NULL;

DROP POLICY IF EXISTS support_tickets_brand_member_read ON public.support_tickets;
CREATE POLICY support_tickets_brand_member_read ON public.support_tickets FOR SELECT TO authenticated
  USING (
    audience = 'brand'
    AND EXISTS (
      SELECT 1 FROM public.brand_team_members member
      WHERE member.brand_id = support_tickets.brand_id
        AND member.user_id = auth.uid()
        AND member.accepted_at IS NOT NULL
        AND member.removed_at IS NULL
    )
  );

DROP POLICY IF EXISTS conversations_brand_support_read ON public.conversations;
CREATE POLICY conversations_brand_support_read ON public.conversations FOR SELECT TO authenticated
  USING (
    linked_entity_type = 'support'
    AND EXISTS (
      SELECT 1
      FROM public.support_tickets ticket
      JOIN public.brand_team_members member ON member.brand_id = ticket.brand_id
      WHERE ticket.conversation_id = conversations.id
        AND ticket.audience = 'brand'
        AND member.user_id = auth.uid()
        AND member.accepted_at IS NOT NULL
        AND member.removed_at IS NULL
    )
  );

DROP POLICY IF EXISTS messages_brand_support_read ON public.messages;
CREATE POLICY messages_brand_support_read ON public.messages FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.support_tickets ticket
      JOIN public.brand_team_members member ON member.brand_id = ticket.brand_id
      WHERE ticket.conversation_id = messages.conversation_id
        AND ticket.audience = 'brand'
        AND member.user_id = auth.uid()
        AND member.accepted_at IS NOT NULL
        AND member.removed_at IS NULL
    )
  );

DROP POLICY IF EXISTS messages_brand_support_insert ON public.messages;
CREATE POLICY messages_brand_support_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.support_tickets ticket
      JOIN public.brand_team_members member ON member.brand_id = ticket.brand_id
      WHERE ticket.conversation_id = messages.conversation_id
        AND ticket.audience = 'brand'
        AND member.user_id = auth.uid()
        AND member.accepted_at IS NOT NULL
        AND member.removed_at IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.issue_3988_create_brand_support_ticket(
  p_client_request_id uuid,
  p_subject text,
  p_details text,
  p_brand_id uuid,
  p_priority text,
  p_next_update_at timestamptz,
  p_next_update_note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_existing uuid;
  v_conversation uuid;
  v_ticket uuid;
  v_subject text := left(btrim(coalesce(p_subject, '')), 200);
  v_details text := left(btrim(coalesce(p_details, '')), 8000);
  v_note text := left(btrim(coalesce(p_next_update_note, '')), 500);
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'client_request_id_required' USING ERRCODE = '22023'; END IF;

  SELECT id INTO v_existing FROM public.support_tickets
  WHERE created_by = v_actor AND client_request_id = p_client_request_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF v_subject = '' OR v_details = '' THEN RAISE EXCEPTION 'subject_and_details_required' USING ERRCODE = '22023'; END IF;
  IF p_brand_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'brand_required' USING ERRCODE = '22023';
  END IF;
  IF p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN RAISE EXCEPTION 'invalid_priority' USING ERRCODE = '22023'; END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF v_note = '' THEN RAISE EXCEPTION 'next_update_note_required' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
  VALUES ('group', 'support', v_subject, v_actor)
  RETURNING id INTO v_conversation;

  INSERT INTO public.support_tickets(
    requester_user_id, requester_segment, subject, status, priority,
    assigned_staff_id, conversation_id, brand_id, first_response_at,
    next_update_at, next_update_note, audience, created_by, client_request_id
  ) VALUES (
    v_actor, 'business', v_subject, 'open', p_priority,
    v_actor, v_conversation, p_brand_id, now(),
    p_next_update_at, v_note, 'brand', v_actor, p_client_request_id
  ) RETURNING id INTO v_ticket;

  INSERT INTO public.conversation_participants(conversation_id, user_id)
  SELECT v_conversation, candidate.user_id
  FROM (
    SELECT v_actor AS user_id
    UNION
    SELECT member.user_id FROM public.brand_team_members member
    WHERE member.brand_id = p_brand_id
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
  ) candidate
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  INSERT INTO public.messages(
    conversation_id, sender_id, content, message_type,
    sender_display_name_snapshot, sender_role_snapshot
  ) VALUES (
    v_conversation, v_actor,
    v_details || E'\n\nNext update: ' || v_note || ' — by ' || to_char(p_next_update_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'),
    'text', 'Mingla Support', 'Mingla Support'
  );

  UPDATE public.conversations SET last_message_at = now(), updated_at = now()
  WHERE id = v_conversation;

  INSERT INTO public.notification_outbox(
    category_key, user_id, brand_id, country_code, payload, idempotency_key, status
  )
  SELECT 'business.support_new_ticket', member.user_id, p_brand_id, NULL,
    jsonb_build_object(
      'ticket_id', v_ticket, 'subject', v_subject, 'audience', 'brand',
      'update_kind', 'opened', 'deep_link', 'mingla-business://support/' || v_ticket::text
    ),
    'business.support_brand_opened:' || v_ticket::text || ':' || member.user_id::text,
    'pending'
  FROM public.brand_team_members member
  WHERE member.brand_id = p_brand_id
    AND member.accepted_at IS NOT NULL
    AND member.removed_at IS NULL
    AND member.user_id <> v_actor
  ON CONFLICT (idempotency_key) DO NOTHING;

  INSERT INTO public.support_audit_log(actor_user_id, action, ticket_id, metadata)
  VALUES (v_actor, 'brand_ticket_created', v_ticket, jsonb_build_object('brand_id', p_brand_id, 'audience', 'brand'));
  RETURN v_ticket;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3988_create_brand_support_ticket(uuid,text,text,uuid,text,timestamptz,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_create_brand_support_ticket(uuid,text,text,uuid,text,timestamptz,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3988_notify_brand_support_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_kind text;
  v_marker text;
BEGIN
  IF NEW.audience <> 'brand' OR NEW.brand_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.assigned_staff_id IS DISTINCT FROM OLD.assigned_staff_id THEN
    v_kind := 'owned'; v_marker := coalesce(NEW.assigned_staff_id::text, 'unassigned');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_kind := 'status'; v_marker := NEW.status;
  ELSIF NEW.next_update_at IS DISTINCT FROM OLD.next_update_at OR NEW.next_update_note IS DISTINCT FROM OLD.next_update_note THEN
    v_kind := 'next_update'; v_marker := coalesce(NEW.next_update_at::text, 'none');
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_outbox(
    category_key, user_id, brand_id, country_code, payload, idempotency_key, status
  )
  SELECT 'business.support_new_ticket', member.user_id, NEW.brand_id, NULL,
    jsonb_build_object(
      'ticket_id', NEW.id, 'subject', NEW.subject, 'audience', 'brand',
      'update_kind', v_kind, 'status', NEW.status,
      'deep_link', 'mingla-business://support/' || NEW.id::text
    ),
    'business.support_brand_progress:' || NEW.id::text || ':' || v_kind || ':' || md5(v_marker) || ':' || member.user_id::text,
    'pending'
  FROM public.brand_team_members member
  WHERE member.brand_id = NEW.brand_id
    AND member.accepted_at IS NOT NULL
    AND member.removed_at IS NULL
    AND member.user_id IS DISTINCT FROM auth.uid()
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_issue_3988_brand_support_progress ON public.support_tickets;
CREATE TRIGGER tg_issue_3988_brand_support_progress
  AFTER UPDATE OF assigned_staff_id, status, next_update_at, next_update_note ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.issue_3988_notify_brand_support_progress();

COMMIT;
