-- #4453 Website workspace, team requests (build contract section G).
--
-- What this does
--   1. Support tickets gain the Host topic website_change (the table CHECK
--      and issue_4382_create_customer_ticket, re-issued from 20280613014382
--      with only that topic and its default subject added).
--   2. support_website_requests: the structured detail of one website change
--      request (what, where, why, what Ari could not do, the draft it was
--      asked against, a 24-hour due time, and when Mingla marked it ready).
--      Read by the requester, by brand members with website access (the
--      Sites content minimum, biz_brand_effective_rank >= 20) and by Support
--      staff. Rows are written only by the functions below.
--   3. issue_4453_create_website_request: files the ticket through the #4382
--      create path (ticket number, staff alerts, audit, thread), sets the
--      ticket's next update to the due time, then writes the detail row.
--      Idempotent on the client request id.
--   4. issue_4453_website_request_ready (Support staff only): posts the
--      "ready" reply through the #4382 send path (which moves the ticket to
--      Waiting), stamps ready_at / ready_by, and queues
--      business.website_request_ready (bell, push, email) to everyone who can
--      open the brand's website.
--   5. issue_3720_notification_denial_reason re-issued from 20280613014382
--      with the one new category added.
--
-- Static SQL only. No data is changed beyond the one notification category.

-- ── 1. The topic ───────────────────────────────────────────────────────────
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_topic_check;
ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_topic_check
    CHECK (
      topic IS NULL
      OR (requester_segment = 'business'
          AND topic IN ('payouts', 'tickets_checkin', 'events', 'venue', 'account', 'other', 'website_change'))
      OR (requester_segment = 'explorer'
          AND topic IN ('broken', 'bookings_payments', 'idea', 'confusing', 'account', 'other'))
    );

-- Same body as 20280613014382 with website_change added to the Host topics
-- and to the default subjects.
CREATE OR REPLACE FUNCTION public.issue_4382_create_customer_ticket(
  p_client_request_id uuid,
  p_app text,
  p_topic text,
  p_subject text,
  p_message text,
  p_attachment_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_client_meta jsonb DEFAULT '{}'::jsonb,
  p_brand_id uuid DEFAULT NULL,
  p_visibility text DEFAULT 'person'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_existing public.support_tickets%ROWTYPE;
  v_segment text;
  v_visibility text := COALESCE(p_visibility, 'person');
  v_message text := btrim(COALESCE(p_message, ''));
  v_subject text := left(btrim(COALESCE(p_subject, '')), 200);
  v_meta jsonb;
  v_conversation uuid;
  v_message_id uuid;
  v_has_files boolean := COALESCE(cardinality(p_attachment_ids), 0) > 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.support_tickets WHERE id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.requester_user_id = v_actor AND v_existing.origin = 'customer' THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'request_id_taken' USING ERRCODE = 'PT409';
  END IF;

  IF p_app NOT IN ('host', 'explorer') THEN
    RAISE EXCEPTION 'invalid_app' USING ERRCODE = '22023';
  END IF;
  v_segment := CASE WHEN p_app = 'host' THEN 'business' ELSE 'explorer' END;
  IF (v_segment = 'business'
        AND p_topic NOT IN ('payouts', 'tickets_checkin', 'events', 'venue', 'account', 'other', 'website_change'))
     OR (v_segment = 'explorer'
        AND p_topic NOT IN ('broken', 'bookings_payments', 'idea', 'confusing', 'account', 'other'))
     OR p_topic IS NULL THEN
    RAISE EXCEPTION 'invalid_topic' USING ERRCODE = '22023';
  END IF;
  IF v_visibility NOT IN ('person', 'brand') THEN
    RAISE EXCEPTION 'invalid_visibility' USING ERRCODE = '22023';
  END IF;
  IF p_brand_id IS NOT NULL THEN
    IF v_segment <> 'business' THEN
      RAISE EXCEPTION 'brand_is_host_only' USING ERRCODE = '22023';
    END IF;
    IF NOT public.issue_4382_is_brand_member(p_brand_id, v_actor) THEN
      RAISE EXCEPTION 'not_brand_member' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_visibility = 'brand' AND p_brand_id IS NULL THEN
    RAISE EXCEPTION 'brand_required' USING ERRCODE = '22023';
  END IF;
  IF v_message = '' AND NOT v_has_files THEN
    RAISE EXCEPTION 'message_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_message) > 8000 THEN
    RAISE EXCEPTION 'content_too_long' USING ERRCODE = '22023';
  END IF;
  v_meta := public.issue_4382_clean_client_meta(p_client_meta);

  IF v_subject = '' THEN
    v_subject := left(NULLIF(btrim(split_part(v_message, E'\n', 1)), ''), 80);
  END IF;
  IF v_subject IS NULL OR v_subject = '' THEN
    v_subject := CASE p_topic
      WHEN 'payouts' THEN 'Payouts'
      WHEN 'tickets_checkin' THEN 'Tickets and check-in'
      WHEN 'events' THEN 'Events'
      WHEN 'venue' THEN 'Venue'
      WHEN 'website_change' THEN 'Website change'
      WHEN 'broken' THEN 'Something is broken'
      WHEN 'bookings_payments' THEN 'Bookings and payments'
      WHEN 'idea' THEN 'An idea'
      WHEN 'confusing' THEN 'Something is confusing'
      WHEN 'account' THEN 'Account'
      ELSE 'Help request'
    END;
  END IF;

  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
  VALUES ('group', 'support', v_subject, v_actor)
  RETURNING id INTO v_conversation;
  INSERT INTO public.conversation_participants(conversation_id, user_id)
  VALUES (v_conversation, v_actor);

  INSERT INTO public.support_tickets (
    id, requester_user_id, requester_segment, subject, status, priority,
    conversation_id, brand_id, origin, visibility, topic, client_meta,
    client_request_id, last_sender_kind
  ) VALUES (
    p_client_request_id, v_actor, v_segment, v_subject, 'new', 'normal',
    v_conversation, p_brand_id, 'customer', v_visibility, p_topic, v_meta,
    p_client_request_id, 'customer'
  );

  INSERT INTO public.messages (conversation_id, sender_id, content, message_type, is_internal)
  VALUES (v_conversation, v_actor, v_message, 'text', false)
  RETURNING id INTO v_message_id;
  PERFORM public.issue_4382_attach_to_message(
    p_client_request_id, v_message_id, p_attachment_ids, v_actor, false
  );

  -- Support staff hear about every new request (bell, push, email).
  INSERT INTO public.notification_outbox (
    category_key, user_id, brand_id, country_code, payload, idempotency_key, status
  )
  SELECT 'business.support_new_ticket', s.user_id, p_brand_id, NULL,
         jsonb_build_object(
           'ticket_id', p_client_request_id,
           'subject', v_subject,
           'deep_link', 'mingla-business://support/' || p_client_request_id::text
         ),
         'business.support_new_ticket:' || p_client_request_id::text || ':' || s.user_id::text,
         'pending'
  FROM public.support_staff s
  WHERE s.enabled = true
    AND public.is_support_staff(s.user_id)
    AND s.user_id <> v_actor
  ON CONFLICT (idempotency_key) DO NOTHING;

  INSERT INTO public.support_audit_log(actor_user_id, action, ticket_id, metadata)
  VALUES (v_actor, 'ticket_created', p_client_request_id, jsonb_build_object(
    'origin', 'customer', 'visibility', v_visibility, 'segment', v_segment,
    'topic', p_topic, 'attachments', COALESCE(cardinality(p_attachment_ids), 0)
  ));
  RETURN p_client_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_create_customer_ticket(uuid, text, text, text, text, uuid[], jsonb, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4382_create_customer_ticket(uuid, text, text, text, text, uuid[], jsonb, uuid, text) TO authenticated, service_role;

-- ── 2. The request detail ──────────────────────────────────────────────────
CREATE TABLE public.support_website_requests (
  ticket_id uuid PRIMARY KEY REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.brand_sites(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  page_path text,
  section_id text,
  section_label text,
  what text NOT NULL,
  why text,
  missing_capability text,
  draft_digest text,
  due_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  ready_at timestamptz,
  ready_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ready_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_website_requests_what_ck
    CHECK (char_length(btrim(what)) BETWEEN 1 AND 2000),
  CONSTRAINT support_website_requests_why_ck
    CHECK (why IS NULL OR char_length(why) BETWEEN 1 AND 2000),
  CONSTRAINT support_website_requests_missing_ck
    CHECK (missing_capability IS NULL OR char_length(missing_capability) BETWEEN 1 AND 1000),
  CONSTRAINT support_website_requests_page_path_ck
    CHECK (page_path IS NULL OR (char_length(page_path) BETWEEN 1 AND 300 AND page_path ~ '^/[^[:space:][:cntrl:]]*$')),
  CONSTRAINT support_website_requests_section_id_ck
    CHECK (section_id IS NULL OR section_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  CONSTRAINT support_website_requests_section_label_ck
    CHECK (section_label IS NULL OR char_length(section_label) BETWEEN 1 AND 120),
  CONSTRAINT support_website_requests_section_needs_page_ck
    CHECK (section_id IS NULL OR page_path IS NOT NULL),
  CONSTRAINT support_website_requests_draft_digest_ck
    CHECK (draft_digest IS NULL OR draft_digest ~ '^[A-Za-z0-9:._-]{1,128}$'),
  CONSTRAINT support_website_requests_ready_note_ck
    CHECK (ready_note IS NULL OR char_length(ready_note) BETWEEN 1 AND 1000),
  CONSTRAINT support_website_requests_ready_pair_ck
    CHECK (ready_at IS NOT NULL OR (ready_by IS NULL AND ready_note IS NULL))
);
CREATE INDEX support_website_requests_brand_idx
  ON public.support_website_requests (brand_id, created_at DESC);
CREATE INDEX support_website_requests_open_due_idx
  ON public.support_website_requests (due_at)
  WHERE ready_at IS NULL;

COMMENT ON TABLE public.support_website_requests IS
  '#4453: one website change request an owner sent to the Mingla team. The ticket (support_tickets, topic website_change) carries the thread, number and status; this row carries what was asked and the 24-hour clock. Written only by issue_4453_create_website_request and issue_4453_website_request_ready.';
COMMENT ON COLUMN public.support_website_requests.draft_digest IS
  '#4453: the draft version the owner was looking at when they asked.';

-- Who may open a brand's website: the Sites content minimum (the same rank
-- brand_site_content_authorize asks for a read). Answers for the caller only.
CREATE OR REPLACE FUNCTION public.issue_4453_has_website_access(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_brand_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND public.biz_brand_effective_rank(p_brand_id, (SELECT auth.uid()))
        >= public.brand_site_content_min_rank('list');
$$;
REVOKE ALL ON FUNCTION public.issue_4453_has_website_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4453_has_website_access(uuid) TO authenticated, service_role;

ALTER TABLE public.support_website_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_website_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_website_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.support_website_requests TO authenticated;
-- Staff may move the clock or fix the note. ready_at / ready_by change only
-- through issue_4453_website_request_ready, so the owner is always told.
GRANT UPDATE (due_at, ready_note) ON TABLE public.support_website_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_website_requests TO service_role;

CREATE POLICY support_website_requests_requester_read ON public.support_website_requests
  FOR SELECT TO authenticated
  USING (requested_by = (SELECT auth.uid()));
CREATE POLICY support_website_requests_brand_read ON public.support_website_requests
  FOR SELECT TO authenticated
  USING (public.issue_4453_has_website_access(brand_id));
CREATE POLICY support_website_requests_staff_read ON public.support_website_requests
  FOR SELECT TO authenticated
  USING ((SELECT public.is_support_staff(auth.uid())) OR (SELECT public.is_admin_user()));
CREATE POLICY support_website_requests_staff_update ON public.support_website_requests
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_support_staff(auth.uid())) OR (SELECT public.is_admin_user()))
  WITH CHECK ((SELECT public.is_support_staff(auth.uid())) OR (SELECT public.is_admin_user()));
-- No INSERT or DELETE policy: rows come only from the definer functions.

-- ── 3. Send a request ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4453_create_website_request(
  p_client_request_id uuid,
  p_brand_id uuid,
  p_site_id uuid,
  p_what text,
  p_where jsonb,
  p_why text,
  p_missing_capability text,
  p_draft_digest text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_what text := btrim(COALESCE(p_what, ''));
  v_why text := NULLIF(btrim(COALESCE(p_why, '')), '');
  v_missing text := NULLIF(btrim(COALESCE(p_missing_capability, '')), '');
  v_digest text := NULLIF(btrim(COALESCE(p_draft_digest, '')), '');
  v_where jsonb := COALESCE(p_where, '{}'::jsonb);
  v_page text;
  v_section_id text;
  v_section_label text;
  v_existing public.support_tickets%ROWTYPE;
  v_due timestamptz;
  v_number bigint;
  v_subject text;
  v_message text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_brand_id IS NULL OR p_site_id IS NULL THEN
    RAISE EXCEPTION 'brand_and_site_required' USING ERRCODE = '22023';
  END IF;

  -- What was asked.
  IF v_what = '' THEN
    RAISE EXCEPTION 'what_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_what) > 2000 THEN
    RAISE EXCEPTION 'what_too_long' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(v_why, '')) > 2000 THEN
    RAISE EXCEPTION 'why_too_long' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(v_missing, '')) > 1000 THEN
    RAISE EXCEPTION 'missing_capability_too_long' USING ERRCODE = '22023';
  END IF;
  IF v_digest IS NOT NULL AND v_digest !~ '^[A-Za-z0-9:._-]{1,128}$' THEN
    RAISE EXCEPTION 'draft_digest_invalid' USING ERRCODE = '22023';
  END IF;

  -- Where on the website. Only the three known keys, each plain text.
  IF jsonb_typeof(v_where) <> 'object'
     OR (v_where - ARRAY['page_path', 'section_id', 'section_label']) <> '{}'::jsonb
     OR EXISTS (
       SELECT 1 FROM jsonb_each(v_where) item
       WHERE jsonb_typeof(item.value) NOT IN ('string', 'null')
     ) THEN
    RAISE EXCEPTION 'where_invalid' USING ERRCODE = '22023';
  END IF;
  v_page := NULLIF(btrim(COALESCE(v_where ->> 'page_path', '')), '');
  v_section_id := NULLIF(btrim(COALESCE(v_where ->> 'section_id', '')), '');
  v_section_label := NULLIF(btrim(regexp_replace(COALESCE(v_where ->> 'section_label', ''), '[[:space:][:cntrl:]]+', ' ', 'g')), '');
  IF v_page IS NOT NULL
     AND (char_length(v_page) > 300 OR v_page !~ '^/[^[:space:][:cntrl:]]*$') THEN
    RAISE EXCEPTION 'page_path_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_section_id IS NOT NULL AND v_section_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN
    RAISE EXCEPTION 'section_id_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_section_id IS NOT NULL AND v_page IS NULL THEN
    RAISE EXCEPTION 'section_needs_page' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(v_section_label, '')) > 120 THEN
    RAISE EXCEPTION 'section_label_too_long' USING ERRCODE = '22023';
  END IF;

  -- The caller can open this brand's website, and the site is that brand's.
  IF NOT public.issue_4453_has_website_access(p_brand_id)
     OR NOT public.brand_site_entitled(p_brand_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.brand_sites site
       WHERE site.id = p_site_id AND site.brand_id = p_brand_id
     ) THEN
    RAISE EXCEPTION 'website_access_required' USING ERRCODE = '42501';
  END IF;

  -- Sending the same request again returns the request already filed.
  SELECT * INTO v_existing FROM public.support_tickets WHERE id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.requester_user_id = v_actor
       AND v_existing.origin = 'customer'
       AND v_existing.topic = 'website_change'
       AND EXISTS (
         SELECT 1 FROM public.support_website_requests request
         WHERE request.ticket_id = v_existing.id AND request.brand_id = p_brand_id
       ) THEN
      RETURN jsonb_build_object(
        'ticket_id', v_existing.id,
        'ticket_number', v_existing.ticket_number,
        'replayed', true
      );
    END IF;
    RAISE EXCEPTION 'request_id_taken' USING ERRCODE = 'PT409';
  END IF;

  v_subject := 'Website change: ' || left(btrim(regexp_replace(v_what, '[[:space:][:cntrl:]]+', ' ', 'g')), 120);
  v_message := 'What I want: ' || v_what
    || CASE WHEN v_page IS NULL THEN '' ELSE
         E'\n\nWhere: ' || v_page
           || CASE WHEN v_section_label IS NULL THEN '' ELSE ' · ' || v_section_label END
       END
    || CASE WHEN v_why IS NULL THEN '' ELSE E'\n\nWhy: ' || v_why END
    || CASE WHEN v_missing IS NULL THEN '' ELSE E'\n\nWhat Ari could not do: ' || v_missing END;

  -- The ticket: number, thread, staff alerts and audit all come from the
  -- one #4382 create path.
  PERFORM public.issue_4382_create_customer_ticket(
    p_client_request_id, 'host', 'website_change', v_subject, v_message,
    ARRAY[]::uuid[], jsonb_build_object('source_screen', 'Website'),
    p_brand_id, 'brand'
  );

  -- The 24-hour clock is the ticket's promised next update, so the desk's
  -- Overdue view and the overdue sweep cover it. Quiet: the owner just
  -- pressed Send and needs no "update time set" alert.
  v_due := now() + interval '24 hours';
  PERFORM set_config('mingla.support_quiet', 'on', true);
  UPDATE public.support_tickets
     SET next_update_at = v_due,
         next_update_note = 'Website change request: ready for review within 24 hours.'
   WHERE id = p_client_request_id
  RETURNING ticket_number INTO v_number;
  PERFORM set_config('mingla.support_quiet', '', true);

  INSERT INTO public.support_website_requests (
    ticket_id, brand_id, site_id, requested_by, page_path, section_id,
    section_label, what, why, missing_capability, draft_digest, due_at
  ) VALUES (
    p_client_request_id, p_brand_id, p_site_id, v_actor, v_page, v_section_id,
    v_section_label, v_what, v_why, v_missing, v_digest, v_due
  );

  INSERT INTO public.support_audit_log(actor_user_id, action, ticket_id, metadata)
  VALUES (v_actor, 'website_request_created', p_client_request_id, jsonb_build_object(
    'brand_id', p_brand_id, 'site_id', p_site_id, 'page_path', v_page,
    'section_id', v_section_id, 'due_at', v_due
  ));

  RETURN jsonb_build_object(
    'ticket_id', p_client_request_id,
    'ticket_number', v_number,
    'replayed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4453_create_website_request(uuid, uuid, uuid, text, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4453_create_website_request(uuid, uuid, uuid, text, jsonb, text, text, text) TO authenticated, service_role;

-- ── 4. "Ready for review" ──────────────────────────────────────────────────
INSERT INTO public.notification_categories(
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES
  ('business.website_request_ready', 'support', true, 'normal',
    ARRAY['inapp', 'push', 'email']::text[], 'reach_once', true)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = EXCLUDED.active;

CREATE OR REPLACE FUNCTION public.issue_4453_website_request_ready(
  p_ticket_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_request public.support_website_requests%ROWTYPE;
  v_ticket public.support_tickets%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_staff_name text;
  v_link text;
  v_notified integer := 0;
BEGIN
  -- Support staff (or a Mingla admin) only.
  PERFORM public.issue_3720_support_operator_required();
  IF p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'ticket_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(v_note, '')) > 1000 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_request FROM public.support_website_requests
     WHERE ticket_id = p_ticket_id FOR UPDATE;
  END IF;
  IF v_ticket.id IS NULL OR v_request.ticket_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Pressing it twice tells the owner once.
  IF v_request.ready_at IS NOT NULL AND v_ticket.status = 'pending' THEN
    RETURN jsonb_build_object(
      'ticket_id', v_ticket.id, 'status', v_ticket.status,
      'ready_at', v_request.ready_at, 'notified', 0, 'replayed', true
    );
  END IF;
  -- Waiting is reached from new or open only; a finished request is
  -- reopened first.
  IF v_ticket.status NOT IN ('new', 'open', 'pending') THEN
    RAISE EXCEPTION 'illegal_transition' USING ERRCODE = 'PT409';
  END IF;

  SELECT NULLIF(btrim(staff.display_name), '') INTO v_staff_name
    FROM public.support_staff staff WHERE staff.user_id = v_actor;

  -- The reply and the move to Waiting go through the #4382 send path
  -- ("Send and wait"): it writes the thread message, the status, the first
  -- response time and the staff_reply audit row. The promised next update
  -- moves a week out so a request waiting on its owner is not "overdue".
  PERFORM public.issue_4382_post_support_message(
    v_ticket.id, v_actor, true,
    'Your website change is ready for you to review.'
      || CASE WHEN v_note IS NULL THEN '' ELSE E'\n\n' || v_note END,
    ARRAY[]::uuid[], false,
    v_now + interval '7 days',
    'Ready for the owner to review.',
    v_staff_name, false, 'reply'
  );

  UPDATE public.support_website_requests
     SET ready_at = v_now, ready_by = v_actor, ready_note = v_note
   WHERE ticket_id = v_ticket.id;

  v_link := 'mingla-business://brand/' || v_request.brand_id::text
    || '/website?request=' || v_ticket.id::text;

  -- Everyone who can open this brand's website hears: the bell, a push and
  -- an email. Never the staff member who pressed the button.
  WITH candidates AS (
    SELECT v_request.requested_by AS user_id
    UNION
    SELECT brand.account_id FROM public.brands brand WHERE brand.id = v_request.brand_id
    UNION
    SELECT member.user_id
    FROM public.brand_team_members member
    WHERE member.brand_id = v_request.brand_id
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
  ), inserted AS (
    INSERT INTO public.notification_outbox (
      category_key, user_id, brand_id, country_code, payload, idempotency_key, status
    )
    SELECT 'business.website_request_ready', candidate.user_id, v_request.brand_id, NULL,
           jsonb_build_object(
             'ticket_id', v_ticket.id,
             'ticket_number', v_ticket.ticket_number,
             'brand_id', v_request.brand_id,
             'site_id', v_request.site_id,
             'subject', v_ticket.subject,
             'what', left(v_request.what, 140),
             'page_path', v_request.page_path,
             'section_label', v_request.section_label,
             'note', left(v_note, 300),
             'push', true,
             'deep_link', v_link
           ),
           'business.website_request_ready:' || v_ticket.id::text || ':'
             || floor(extract(epoch FROM v_now) * 1000)::bigint::text || ':' || candidate.user_id::text,
           'pending'
    FROM candidates candidate
    WHERE candidate.user_id IS NOT NULL
      AND candidate.user_id IS DISTINCT FROM v_actor
      AND public.biz_brand_effective_rank(v_request.brand_id, candidate.user_id)
          >= public.brand_site_content_min_rank('list')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_notified FROM inserted;

  INSERT INTO public.support_audit_log(actor_user_id, action, ticket_id, metadata)
  VALUES (v_actor, 'website_request_ready', v_ticket.id, jsonb_build_object(
    'brand_id', v_request.brand_id, 'status_from', v_ticket.status,
    'notified', v_notified, 'has_note', v_note IS NOT NULL
  ));

  RETURN jsonb_build_object(
    'ticket_id', v_ticket.id, 'status', 'pending',
    'ready_at', v_now, 'notified', v_notified, 'replayed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4453_website_request_ready(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4453_website_request_ready(uuid, text) TO authenticated, service_role;

-- ── 5. The new category is a known one ─────────────────────────────────────
-- Same body as 20280613014382 with business.website_request_ready added.
CREATE OR REPLACE FUNCTION public.issue_3720_notification_denial_reason(
  p_user_id uuid,
  p_category_key text,
  p_channel text,
  p_contact text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat public.notification_categories%ROWTYPE;
  v_suppression_reason text;
BEGIN
  IF p_category_key NOT IN (
    'business.community_announcement',
    'business.community_roadmap_updated',
    'business.support_new_ticket',
    'business.brand_group_message',
    'admin.team_mention',
    'business.support_ticket_reply',
    'admin.support_staff_ticket',
    'admin.support_assigned',
    'admin.support_overdue',
    'admin.product_signal_new',
    'admin.product_signal_assigned',
    'admin.product_signal_progress',
    'business.brand_enquiry_new',
    'business.brand_enquiry_message',
    'business.brand_enquiry_nudge',
    'explorer.brand_enquiry_reply',
    'business.support_status_changed',
    'business.support_product_update',
    'explorer.support_reply',
    'explorer.support_status_changed',
    'explorer.support_product_update',
    'business.website_request_ready'
  ) THEN
    RETURN 'policy_denied';
  END IF;

  SELECT * INTO v_cat
  FROM public.notification_categories
  WHERE key = p_category_key;
  IF NOT FOUND OR v_cat.active IS NOT TRUE THEN RETURN 'category_inactive'; END IF;
  IF NOT (p_channel = ANY(v_cat.default_channels)) THEN RETURN 'channel_inactive'; END IF;

  IF p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notification_channel_prefs pref
    WHERE pref.user_id = p_user_id
      AND pref.category_key = p_category_key
      AND pref.channel = p_channel
      AND pref.enabled = false
  ) THEN
    RETURN 'preference_off';
  END IF;

  IF p_channel IN ('email', 'sms') THEN
    SELECT suppression.reason INTO v_suppression_reason
    FROM public.channel_suppressions suppression
    WHERE suppression.channel = p_channel
      AND suppression.scope IN (
        CASE WHEN v_cat.is_transactional THEN 'transactional' ELSE 'marketing' END,
        'all'
      )
      AND (
        (p_user_id IS NOT NULL AND suppression.user_id = p_user_id)
        OR (p_contact IS NOT NULL AND lower(suppression.contact) = lower(p_contact))
      )
    ORDER BY CASE suppression.reason
      WHEN 'complaint' THEN 1
      WHEN 'bounce' THEN 2
      ELSE 3
    END, suppression.created_at DESC
    LIMIT 1;

    IF v_suppression_reason = 'complaint' THEN RETURN 'complaint'; END IF;
    IF v_suppression_reason = 'bounce' THEN RETURN 'hard_bounce'; END IF;
    IF v_suppression_reason IS NOT NULL THEN RETURN 'legal_suppression'; END IF;
  END IF;

  RETURN 'policy_denied';
END;
$$;
