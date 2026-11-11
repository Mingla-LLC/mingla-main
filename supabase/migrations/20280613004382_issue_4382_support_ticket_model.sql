-- #4382 Support Desk redesign, Wave 1, part 1 of 3: one ticket model.
--
-- What this does
--   1. support_tickets gains origin (customer|staff), visibility
--      (internal|person|brand), ticket_number (S-1001 onwards), topic,
--      product_area, client_meta (never a location), imported_from and
--      imported_source_id, and last_sender_kind.
--   2. visibility replaces audience. Every policy and function that read
--      audience is rewritten here. audience stays only as a read-only
--      generated column so Host app builds already in people's hands keep
--      reading their list until the Wave 4 update reaches them.
--   3. requester_user_id is always the customer. It becomes nullable (staff
--      internal tickets, the anonymous beta feedback rows) and staff-created
--      rows that named the staff member as requester are corrected.
--   4. messages gains is_internal. Restrictive policies keep internal notes
--      away from everyone who is not Support staff.
--   5. The 8 support_internal_threads rows move into support_tickets as
--      internal tickets; their details become the first internal note and
--      their Product links are re-pointed. The table, its functions, its
--      triggers and its realtime entry are removed.
--   6. The beta_feedback rows become open, unassigned Explorer tickets marked
--      imported_from = 'beta_feedback'. Latitude and longitude are not
--      carried over. The table itself stays until the storage copy is
--      verified (see scripts/deferred-migrations).
--
-- No notification is sent by anything in this file: the move-across inserts
-- run before any new trigger exists, and the only support_tickets trigger
-- that existed fires on UPDATE, which the move-across never does.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. New ticket columns.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.support_tickets
  ADD COLUMN origin text NOT NULL DEFAULT 'customer',
  ADD COLUMN visibility text NOT NULL DEFAULT 'person',
  ADD COLUMN ticket_number bigint,
  ADD COLUMN topic text,
  ADD COLUMN product_area text,
  ADD COLUMN client_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN imported_from text,
  ADD COLUMN imported_source_id uuid,
  ADD COLUMN last_sender_kind text;

-- Backfill visibility from audience (requester -> person, brand -> brand).
UPDATE public.support_tickets
   SET visibility = CASE WHEN audience = 'brand' THEN 'brand' ELSE 'person' END;

-- A staff-created ticket is one with created_by set (only the staff create
-- path ever set it).
UPDATE public.support_tickets
   SET origin = 'staff'
 WHERE created_by IS NOT NULL;

-- requester_user_id is always the customer.
ALTER TABLE public.support_tickets ALTER COLUMN requester_user_id DROP NOT NULL;
UPDATE public.support_tickets
   SET requester_user_id = NULL
 WHERE origin = 'staff'
   AND requester_user_id IS NOT DISTINCT FROM created_by;

-- Ticket numbers, oldest first.
CREATE SEQUENCE public.support_ticket_number_seq START WITH 1001 MINVALUE 1001;
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
  FROM public.support_tickets
)
UPDATE public.support_tickets t
   SET ticket_number = 1000 + ordered.n
  FROM ordered
 WHERE ordered.id = t.id;
SELECT setval(
  'public.support_ticket_number_seq',
  GREATEST(1001, COALESCE((SELECT max(ticket_number) FROM public.support_tickets), 1000) + 1),
  false
);
ALTER TABLE public.support_tickets
  ALTER COLUMN ticket_number SET DEFAULT nextval('public.support_ticket_number_seq'),
  ALTER COLUMN ticket_number SET NOT NULL,
  ADD CONSTRAINT support_tickets_ticket_number_key UNIQUE (ticket_number);
ALTER SEQUENCE public.support_ticket_number_seq OWNED BY public.support_tickets.ticket_number;

-- Retire audience: drop every policy that reads it, then the column.
DROP POLICY IF EXISTS support_tickets_brand_member_read ON public.support_tickets;
DROP POLICY IF EXISTS conversations_brand_support_read ON public.conversations;
DROP POLICY IF EXISTS messages_brand_support_read ON public.messages;
DROP POLICY IF EXISTS messages_brand_support_insert ON public.messages;
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_brand_audience_requires_brand;
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_audience_check;

-- Functions that read audience go before the column does.
DROP TRIGGER IF EXISTS tg_issue_3988_brand_support_progress ON public.support_tickets;
DROP FUNCTION IF EXISTS public.issue_3988_notify_brand_support_progress();
DROP FUNCTION IF EXISTS public.issue_3988_create_brand_support_ticket(uuid, text, text, uuid, text, timestamptz, text);

ALTER TABLE public.support_tickets DROP COLUMN audience;
-- [TRANSITIONAL] read-only mirror of visibility for Host app builds released
-- before #4382 Wave 4. Nothing writes or decides on it. Exit: drop once the
-- Wave 4 Host app update is the minimum supported version.
ALTER TABLE public.support_tickets
  ADD COLUMN audience text GENERATED ALWAYS AS (
    CASE WHEN visibility = 'brand' THEN 'brand' ELSE 'requester' END
  ) STORED;

ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_origin_check
    CHECK (origin IN ('customer', 'staff')),
  ADD CONSTRAINT support_tickets_visibility_check
    CHECK (visibility IN ('internal', 'person', 'brand')),
  ADD CONSTRAINT support_tickets_customer_visibility
    CHECK (origin = 'staff' OR visibility IN ('person', 'brand')),
  ADD CONSTRAINT support_tickets_brand_visibility_requires_brand
    CHECK (visibility <> 'brand' OR brand_id IS NOT NULL),
  ADD CONSTRAINT support_tickets_person_requires_requester
    CHECK (visibility <> 'person' OR requester_user_id IS NOT NULL OR imported_from = 'beta_feedback'),
  ADD CONSTRAINT support_tickets_topic_check
    CHECK (
      topic IS NULL
      OR (requester_segment = 'business'
          AND topic IN ('payouts', 'tickets_checkin', 'events', 'venue', 'account', 'other'))
      OR (requester_segment = 'explorer'
          AND topic IN ('broken', 'bookings_payments', 'idea', 'confusing', 'account', 'other'))
    ),
  ADD CONSTRAINT support_tickets_product_area_check
    CHECK (product_area IS NULL OR char_length(btrim(product_area)) BETWEEN 1 AND 120),
  -- client_meta carries app and device facts only. Any other key, a
  -- location included, is refused.
  ADD CONSTRAINT support_tickets_client_meta_shape
    CHECK (
      jsonb_typeof(client_meta) = 'object'
      AND (client_meta - ARRAY['app_version', 'os', 'os_version', 'device_model', 'source_screen']) = '{}'::jsonb
    ),
  ADD CONSTRAINT support_tickets_imported_from_check
    CHECK (imported_from IS NULL OR imported_from IN ('beta_feedback', 'internal_thread')),
  ADD CONSTRAINT support_tickets_imported_pair
    CHECK ((imported_from IS NULL) = (imported_source_id IS NULL)),
  ADD CONSTRAINT support_tickets_last_sender_kind_check
    CHECK (last_sender_kind IS NULL OR last_sender_kind IN ('customer', 'staff'));

CREATE UNIQUE INDEX support_tickets_imported_source_key
  ON public.support_tickets (imported_from, imported_source_id)
  WHERE imported_from IS NOT NULL;
CREATE INDEX support_tickets_visibility_status_idx
  ON public.support_tickets (visibility, status, last_message_at DESC);
CREATE INDEX support_tickets_requester_recent_idx
  ON public.support_tickets (requester_user_id, last_message_at DESC)
  WHERE requester_user_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Who can see a ticket.
-- ─────────────────────────────────────────────────────────────────────────
-- Staff: enabled Support staff on the Mingla team, or an active admin. Works
-- for any user id (the service-role send path has no auth.uid()).
CREATE OR REPLACE FUNCTION public.issue_4382_is_staff(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id IS NOT NULL AND (
    public.is_support_staff(p_user_id)
    OR EXISTS (
      SELECT 1
      FROM auth.users identity
      JOIN public.admin_users admin_row ON admin_row.email = identity.email
      WHERE identity.id = p_user_id
        AND admin_row.status = 'active'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.issue_4382_is_brand_member(p_brand_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_brand_id IS NOT NULL AND p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.brand_team_members member
    WHERE member.brand_id = p_brand_id
      AND member.user_id = p_user_id
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
  );
$$;

-- A customer sees a ticket when it is not internal and either they asked it
-- or it is shared with a brand they are an active member of.
CREATE OR REPLACE FUNCTION public.issue_4382_customer_can_view_ticket(p_ticket_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.support_tickets ticket
    WHERE ticket.id = p_ticket_id
      AND ticket.visibility <> 'internal'
      AND (
        ticket.requester_user_id = p_user_id
        OR (ticket.visibility = 'brand'
            AND public.issue_4382_is_brand_member(ticket.brand_id, p_user_id))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.issue_4382_customer_can_view_conversation(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.support_tickets ticket
    WHERE ticket.conversation_id = p_conversation_id
      AND public.issue_4382_customer_can_view_ticket(ticket.id, p_user_id)
  );
$$;

REVOKE ALL ON FUNCTION public.issue_4382_is_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4382_is_brand_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4382_customer_can_view_ticket(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4382_customer_can_view_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4382_is_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4382_is_brand_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4382_customer_can_view_ticket(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4382_customer_can_view_conversation(uuid, uuid) TO authenticated, service_role;

-- Ticket rows. A requester never reads an internal ticket, even one that
-- names them.
DROP POLICY IF EXISTS support_tickets_requester_read ON public.support_tickets;
CREATE POLICY support_tickets_requester_read ON public.support_tickets
  FOR SELECT
  USING (
    (requester_user_id = auth.uid() AND visibility <> 'internal')
    OR public.is_support_staff(auth.uid())
    OR public.is_admin_user()
  );
CREATE POLICY support_tickets_brand_member_read ON public.support_tickets
  FOR SELECT TO authenticated
  USING (
    visibility = 'brand'
    AND public.issue_4382_is_brand_member(brand_id, auth.uid())
  );

-- Tickets are created only through the create functions.
DROP POLICY IF EXISTS support_tickets_requester_insert ON public.support_tickets;
REVOKE INSERT, DELETE, TRUNCATE ON public.support_tickets FROM anon, authenticated;

CREATE POLICY conversations_brand_support_read ON public.conversations
  FOR SELECT TO authenticated
  USING (
    linked_entity_type = 'support'
    AND EXISTS (
      SELECT 1 FROM public.support_tickets ticket
      WHERE ticket.conversation_id = conversations.id
        AND ticket.visibility = 'brand'
        AND public.issue_4382_is_brand_member(ticket.brand_id, auth.uid())
    )
  );
CREATE POLICY messages_brand_support_read ON public.messages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.support_tickets ticket
      WHERE ticket.conversation_id = messages.conversation_id
        AND ticket.visibility = 'brand'
        AND public.issue_4382_is_brand_member(ticket.brand_id, auth.uid())
    )
  );
CREATE POLICY messages_brand_support_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_tickets ticket
      WHERE ticket.conversation_id = messages.conversation_id
        AND ticket.visibility = 'brand'
        AND public.issue_4382_is_brand_member(ticket.brand_id, auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Internal notes.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.messages ADD COLUMN is_internal boolean NOT NULL DEFAULT false;

-- Restrictive: AND-ed with every permissive policy, so no participant, brand
-- or requester policy can ever surface an internal note.
CREATE POLICY messages_support_internal_read_guard ON public.messages
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT is_internal
    OR (SELECT public.is_support_staff(auth.uid()))
    OR (SELECT public.is_admin_user())
  );
CREATE POLICY messages_support_internal_insert_guard ON public.messages
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    NOT is_internal
    OR (
      ((SELECT public.is_support_staff(auth.uid())) OR (SELECT public.is_admin_user()))
      AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = messages.conversation_id AND c.linked_entity_type = 'support'
      )
    )
  );
CREATE POLICY messages_support_internal_update_guard ON public.messages
  AS RESTRICTIVE
  FOR UPDATE
  USING (
    NOT is_internal
    OR (SELECT public.is_support_staff(auth.uid()))
    OR (SELECT public.is_admin_user())
  )
  WITH CHECK (
    NOT is_internal
    OR (SELECT public.is_support_staff(auth.uid()))
    OR (SELECT public.is_admin_user())
  );

CREATE INDEX messages_support_internal_idx
  ON public.messages (conversation_id)
  WHERE is_internal;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Staff threads move into support_tickets.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE issue_4382_thread_map ON COMMIT DROP AS
SELECT thread.id AS thread_id,
       gen_random_uuid() AS ticket_id,
       gen_random_uuid() AS conversation_id
FROM public.support_internal_threads thread;

INSERT INTO public.conversations (id, type, linked_entity_type, name, created_by, created_at, updated_at, last_message_at)
SELECT map.conversation_id, 'group', 'support', left(btrim(thread.subject), 200), thread.created_by,
       thread.created_at, thread.updated_at, thread.updated_at
FROM public.support_internal_threads thread
JOIN issue_4382_thread_map map ON map.thread_id = thread.id;

INSERT INTO public.support_tickets (
  id, requester_user_id, requester_segment, subject, status, priority,
  assigned_staff_id, conversation_id, brand_id, created_at, resolved_at,
  last_message_at, next_update_at, next_update_note, support_workflow_revision,
  created_by, client_request_id, origin, visibility, imported_from,
  imported_source_id, last_sender_kind
)
SELECT map.ticket_id, thread.linked_user_id, 'business', thread.subject, thread.status,
       thread.priority, thread.assigned_staff_id, map.conversation_id, thread.brand_id,
       thread.created_at, thread.resolved_at, thread.updated_at, thread.next_update_at,
       thread.next_update_note, thread.revision, thread.created_by, thread.client_request_id,
       'staff', 'internal', 'internal_thread', thread.id, 'staff'
FROM public.support_internal_threads thread
JOIN issue_4382_thread_map map ON map.thread_id = thread.id
ORDER BY thread.created_at, thread.id;

-- The details (and any brand group context) become the first internal note.
INSERT INTO public.messages (
  conversation_id, sender_id, content, message_type, is_internal,
  sender_display_name_snapshot, sender_role_snapshot, created_at
)
SELECT map.conversation_id, thread.created_by,
       thread.details
         || CASE WHEN thread.brand_group_context IS NULL THEN ''
                 ELSE E'\n\nBrand group: ' || thread.brand_group_context END,
       'text', true, 'Mingla Support', 'Mingla Support', thread.created_at
FROM public.support_internal_threads thread
JOIN issue_4382_thread_map map ON map.thread_id = thread.id;

-- Product links point at the new tickets.
ALTER TABLE public.support_product_signal_sources
  DROP CONSTRAINT support_product_signal_sources_source_kind_check;
UPDATE public.support_product_signal_sources source
   SET source_kind = 'support_ticket',
       source_id = map.ticket_id
  FROM issue_4382_thread_map map
 WHERE source.source_kind = 'internal_thread'
   AND source.source_id = map.thread_id;
ALTER TABLE public.support_product_signal_sources
  ADD CONSTRAINT support_product_signal_sources_source_kind_check
    CHECK (source_kind IN ('support_ticket', 'brand_group_message', 'community_idea'));

-- Remove the staff-thread table and everything that only served it.
DROP FUNCTION IF EXISTS public.issue_3720_create_internal_thread(uuid, text, text, text, uuid, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.issue_3720_update_internal_thread(uuid, integer, text, text);
DROP FUNCTION IF EXISTS public.issue_3988_reassign_internal_thread(uuid, integer, uuid);
DROP TRIGGER IF EXISTS issue_3988_staff_ticket_assigned_alert ON public.support_internal_threads;
DROP TRIGGER IF EXISTS issue_3988_staff_ticket_created_alert ON public.support_internal_threads;
DROP FUNCTION IF EXISTS public.issue_3988_staff_ticket_assigned_alert();
DROP FUNCTION IF EXISTS public.issue_3988_staff_ticket_created_alert();
DROP FUNCTION IF EXISTS public.issue_3988_staff_ticket_payload(public.support_internal_threads);
ALTER PUBLICATION supabase_realtime DROP TABLE public.support_internal_threads;
DROP TABLE public.support_internal_threads;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Beta feedback moves in (D1, D7). Open, unassigned, nobody messaged.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE issue_4382_feedback_map ON COMMIT DROP AS
SELECT feedback.id AS feedback_id,
       gen_random_uuid() AS ticket_id,
       gen_random_uuid() AS conversation_id,
       gen_random_uuid() AS message_id
FROM public.beta_feedback feedback;

INSERT INTO public.conversations (id, type, linked_entity_type, name, created_by, created_at, updated_at, last_message_at)
SELECT map.conversation_id, 'group', 'support',
       'Beta feedback: ' || CASE feedback.category
         WHEN 'bug' THEN 'Something is broken'
         WHEN 'feature_request' THEN 'An idea'
         WHEN 'ux_issue' THEN 'Something is confusing'
         ELSE 'Other' END,
       feedback.user_id, feedback.created_at, feedback.created_at, feedback.created_at
FROM public.beta_feedback feedback
JOIN issue_4382_feedback_map map ON map.feedback_id = feedback.id;

INSERT INTO public.conversation_participants (conversation_id, user_id)
SELECT map.conversation_id, feedback.user_id
FROM public.beta_feedback feedback
JOIN issue_4382_feedback_map map ON map.feedback_id = feedback.id
WHERE feedback.user_id IS NOT NULL
ON CONFLICT (conversation_id, user_id) DO NOTHING;

INSERT INTO public.support_tickets (
  id, requester_user_id, requester_segment, subject, status, priority,
  assigned_staff_id, conversation_id, brand_id, created_at, last_message_at,
  origin, visibility, topic, client_meta, imported_from, imported_source_id,
  last_sender_kind
)
SELECT map.ticket_id, feedback.user_id, 'explorer',
       'Beta feedback: ' || CASE feedback.category
         WHEN 'bug' THEN 'Something is broken'
         WHEN 'feature_request' THEN 'An idea'
         WHEN 'ux_issue' THEN 'Something is confusing'
         ELSE 'Other' END,
       'open', 'normal', NULL, map.conversation_id, NULL,
       feedback.created_at, feedback.created_at, 'customer', 'person',
       CASE feedback.category
         WHEN 'bug' THEN 'broken'
         WHEN 'feature_request' THEN 'idea'
         WHEN 'ux_issue' THEN 'confusing'
         ELSE 'other' END,
       jsonb_strip_nulls(jsonb_build_object(
         'app_version', feedback.app_version,
         'os', feedback.device_os,
         'os_version', feedback.device_os_version,
         'device_model', feedback.device_model,
         'source_screen', feedback.screen_before
       )),
       'beta_feedback', feedback.id, 'customer'
FROM public.beta_feedback feedback
JOIN issue_4382_feedback_map map ON map.feedback_id = feedback.id
ORDER BY feedback.created_at, feedback.id;

INSERT INTO public.messages (
  id, conversation_id, sender_id, content, message_type, is_internal,
  sender_display_name_snapshot, created_at
)
SELECT map.message_id, map.conversation_id, feedback.user_id,
       'Voice note from beta feedback', 'text', false,
       NULLIF(btrim(COALESCE(feedback.user_display_name, '')), ''),
       feedback.created_at
FROM public.beta_feedback feedback
JOIN issue_4382_feedback_map map ON map.feedback_id = feedback.id;

-- The attachment rows for these messages are written by part 2, which owns
-- support_attachments. The map is kept in a real (private) table for it.
CREATE TABLE public.issue_4382_beta_feedback_import (
  feedback_id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  audio_path text NOT NULL,
  audio_duration_ms integer NOT NULL,
  screenshot_paths text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.issue_4382_beta_feedback_import ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.issue_4382_beta_feedback_import FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.issue_4382_beta_feedback_import TO service_role;

INSERT INTO public.issue_4382_beta_feedback_import (
  feedback_id, ticket_id, message_id, audio_path, audio_duration_ms, screenshot_paths
)
SELECT feedback.id, map.ticket_id, map.message_id, feedback.audio_path,
       feedback.audio_duration_ms, COALESCE(feedback.screenshot_paths, ARRAY[]::text[])
FROM public.beta_feedback feedback
JOIN issue_4382_feedback_map map ON map.feedback_id = feedback.id;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Functions that read the staff-thread table now read support_tickets.
-- ─────────────────────────────────────────────────────────────────────────
-- Next-update promise: tickets only (staff threads are tickets now).
CREATE OR REPLACE FUNCTION public.issue_3720_set_next_update(
  p_source_kind text,
  p_source_id uuid,
  p_expected_revision integer,
  p_next_update_at timestamptz,
  p_next_update_note text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_revision integer;
  v_conversation uuid;
  v_visibility text;
  v_before jsonb;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_source_kind IS DISTINCT FROM 'support_ticket' THEN
    RAISE EXCEPTION 'invalid_source_kind' USING ERRCODE = '22023';
  END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_next_update_note, '')) = '' THEN
    RAISE EXCEPTION 'next_update_note_required' USING ERRCODE = '22023';
  END IF;

  SELECT conversation_id, visibility,
         jsonb_build_object('next_update_at', next_update_at, 'revision', support_workflow_revision)
    INTO v_conversation, v_visibility, v_before
    FROM public.support_tickets
   WHERE id = p_source_id;

  UPDATE public.support_tickets
     SET next_update_at = p_next_update_at,
         next_update_note = left(btrim(p_next_update_note), 500),
         last_message_at = CASE WHEN visibility = 'internal' THEN last_message_at ELSE now() END,
         support_workflow_revision = support_workflow_revision + 1
   WHERE id = p_source_id
     AND support_workflow_revision = p_expected_revision
  RETURNING support_workflow_revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_conversation IS NULL THEN
      RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  -- The customer sees the promise in the thread; an internal ticket keeps it
  -- as an internal note.
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, is_internal)
  VALUES (
    v_conversation,
    NULL,
    'Mingla will update you by ' || to_char(p_next_update_at AT TIME ZONE 'UTC', 'FMDay, FMMonth DD at HH12:MI AM') || ' UTC. ' || left(btrim(p_next_update_note), 500),
    'system',
    v_visibility = 'internal'
  );

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'next_update_set', 'support_ticket', p_source_id, v_before,
    jsonb_build_object('next_update_at', p_next_update_at, 'revision', v_revision)
  );

  RETURN v_revision;
END;
$$;

-- People behind a Product source: a ticket counts as one reporter; a
-- Community idea counts its author and every voter (D4).
CREATE OR REPLACE FUNCTION public.issue_4382_source_reporter_count(p_source_kind text, p_source_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_source_kind = 'community_idea' THEN GREATEST(1, (
      SELECT count(DISTINCT people.user_id)::integer
      FROM (
        SELECT post.author_user_id AS user_id
        FROM public.community_posts post
        WHERE post.id = p_source_id
        UNION
        SELECT vote.user_id
        FROM public.community_post_votes vote
        WHERE vote.post_id = p_source_id
      ) people
    ))
    ELSE 1
  END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_source_reporter_count(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4382_source_reporter_count(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4382_assert_product_source(p_source_kind text, p_source_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_source_kind NOT IN ('support_ticket', 'community_idea') THEN
    RAISE EXCEPTION 'invalid_source_kind' USING ERRCODE = '22023';
  END IF;
  IF p_source_kind = 'support_ticket'
     AND NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = p_source_id) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_source_kind = 'community_idea'
     AND NOT EXISTS (
       SELECT 1 FROM public.community_posts
       WHERE id = p_source_id AND kind = 'idea' AND review_state = 'published'
     ) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_assert_product_source(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4382_assert_product_source(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_create_product_signal(
  p_client_request_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_signal_kind text,
  p_title text,
  p_problem_statement text,
  p_product_area text,
  p_user_journey text,
  p_impact_summary text,
  p_affected_people integer,
  p_priority text,
  p_next_update_at timestamptz,
  p_next_step text,
  p_customer_reply_draft text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_existing uuid;
  v_id uuid;
BEGIN
  PERFORM public.issue_3720_support_operator_required();

  SELECT id INTO v_existing
    FROM public.support_product_signals
   WHERE created_by = v_actor AND client_request_id = p_client_request_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  PERFORM public.issue_4382_assert_product_source(p_source_kind, p_source_id);
  IF EXISTS (
    SELECT 1 FROM public.support_product_signal_sources
     WHERE source_kind = p_source_kind AND source_id = p_source_id
  ) THEN
    RAISE EXCEPTION 'source_already_linked' USING ERRCODE = '23505';
  END IF;
  IF p_signal_kind NOT IN ('question', 'account', 'bug', 'feature', 'trust_safety')
     OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'invalid_classification' USING ERRCODE = '22023';
  END IF;
  IF p_affected_people IS NULL OR p_affected_people < 1 THEN
    RAISE EXCEPTION 'affected_people_required' USING ERRCODE = '22023';
  END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_title, '')) = ''
     OR btrim(coalesce(p_problem_statement, '')) = ''
     OR btrim(coalesce(p_product_area, '')) = ''
     OR btrim(coalesce(p_user_journey, '')) = ''
     OR btrim(coalesce(p_impact_summary, '')) = ''
     OR btrim(coalesce(p_next_step, '')) = ''
     OR btrim(coalesce(p_customer_reply_draft, '')) = '' THEN
    RAISE EXCEPTION 'signal_fields_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.support_product_signals(
    client_request_id, signal_kind, title, problem_statement, product_area,
    user_journey, impact_summary, affected_people, priority, owner_user_id,
    next_update_at, next_step, customer_reply_draft, created_by
  ) VALUES (
    p_client_request_id, p_signal_kind, left(btrim(p_title), 200),
    left(btrim(p_problem_statement), 8000), left(btrim(p_product_area), 120),
    left(btrim(p_user_journey), 1000), left(btrim(p_impact_summary), 1000),
    GREATEST(p_affected_people, public.issue_4382_source_reporter_count(p_source_kind, p_source_id)),
    p_priority, v_actor, p_next_update_at,
    left(btrim(p_next_step), 1000), left(btrim(p_customer_reply_draft), 4000), v_actor
  )
  RETURNING id INTO v_id;

  INSERT INTO public.support_product_signal_sources(signal_id, source_kind, source_id, linked_by)
  VALUES (v_id, p_source_kind, p_source_id, v_actor);

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_created', 'product_signal', v_id,
    jsonb_build_object(
      'signal_kind', p_signal_kind,
      'priority', p_priority,
      'source_kind', p_source_kind,
      'next_update_at', p_next_update_at
    )
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_link_product_signal_source(
  p_signal_id uuid,
  p_expected_revision integer,
  p_source_kind text,
  p_source_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  PERFORM public.issue_4382_assert_product_source(p_source_kind, p_source_id);

  UPDATE public.support_product_signals
     SET affected_people = affected_people
           + public.issue_4382_source_reporter_count(p_source_kind, p_source_id),
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_signal_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.support_product_signals WHERE id = p_signal_id) THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  -- A unique violation (the source already feeds another item) aborts the
  -- whole call, so the counter and the link stay together.
  INSERT INTO public.support_product_signal_sources(signal_id, source_kind, source_id, linked_by)
  VALUES (p_signal_id, p_source_kind, p_source_id, v_actor);

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_source_linked', 'product_signal', p_signal_id,
    jsonb_build_object(
      'source_kind', p_source_kind,
      'source_id', p_source_id,
      'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$$;

-- The overdue sweep covers every open ticket with a next-update promise
-- (customer tickets included, not only staff threads) and open Product items.
CREATE OR REPLACE FUNCTION public.issue_3988_support_overdue_sweep(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item record;
  v_lead uuid;
  v_owner_sent integer := 0;
  v_lead_sent integer := 0;
  v_due text;
  v_payload jsonb;
BEGIN
  FOR v_item IN
    SELECT 'support_ticket'::text AS kind, t.id, t.subject AS title, t.priority,
           t.next_update_at, COALESCE(t.assigned_staff_id, t.created_by) AS owner_id
    FROM public.support_tickets t
    WHERE t.status NOT IN ('resolved', 'closed')
      AND t.next_update_at IS NOT NULL
      AND t.next_update_at <= p_now
    UNION ALL
    SELECT 'product_signal'::text, s.id, s.title, s.priority,
           s.next_update_at, COALESCE(s.owner_user_id, s.created_by)
    FROM public.support_product_signals s
    WHERE s.state NOT IN ('released', 'closed', 'shipped', 'told', 'wont_do')
      AND s.next_update_at <= p_now
    ORDER BY 5, 2
  LOOP
    v_due := to_char(v_item.next_update_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS');
    v_payload := jsonb_build_object(
      'kind', v_item.kind,
      'item_id', v_item.id,
      'title', v_item.title,
      'priority', v_item.priority,
      'due_at', v_item.next_update_at,
      'deep_link', public.issue_3988_admin_link(v_item.kind, v_item.id)
    );

    IF public.issue_3988_enqueue_alert(
      'admin.support_overdue',
      v_item.owner_id,
      'admin.support_overdue:' || v_item.kind || ':' || v_item.id::text || ':' || v_due
        || ':owner:' || COALESCE(v_item.owner_id::text, 'none'),
      v_payload || jsonb_build_object('audience', 'owner')
    ) THEN
      v_owner_sent := v_owner_sent + 1;
    END IF;

    IF v_item.next_update_at <= p_now - interval '24 hours' THEN
      FOR v_lead IN
        SELECT lead_id FROM public.issue_3988_support_leads() lead_id
        WHERE lead_id IS DISTINCT FROM v_item.owner_id
      LOOP
        IF public.issue_3988_enqueue_alert(
          'admin.support_overdue',
          v_lead,
          'admin.support_overdue:' || v_item.kind || ':' || v_item.id::text || ':' || v_due
            || ':lead:' || v_lead::text,
          v_payload || jsonb_build_object('audience', 'lead')
        ) THEN
          v_lead_sent := v_lead_sent + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('owner_alerts', v_owner_sent, 'lead_alerts', v_lead_sent);
END;
$$;

COMMENT ON COLUMN public.support_tickets.origin IS
  '#4382: customer (asked by the person) or staff (opened by Mingla).';
COMMENT ON COLUMN public.support_tickets.visibility IS
  '#4382: internal (staff only), person (the requester), brand (every active member of brand_id).';
COMMENT ON COLUMN public.support_tickets.client_meta IS
  '#4382: app_version, os, os_version, device_model, source_screen. Never a location.';
COMMENT ON COLUMN public.messages.is_internal IS
  '#4382: a Support internal note. Readable by Support staff only; sends no notification.';

COMMIT;
