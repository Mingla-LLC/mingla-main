-- #4382 Support Desk redesign, Wave 1, part 2 of 3: attachments, the send
-- path, the create functions and customer notifications.
--
-- Attachments
--   support-attachments is a PRIVATE bucket. Images (png, jpeg, webp, heic)
--   up to 10 MB, voice notes (m4a) up to 15 MB and 5 minutes. A client first
--   registers an upload (issue_4382_register_support_attachment), which fixes
--   the path <ticket_id>/<uuid>.<ext>; storage then accepts exactly that
--   object from exactly that person. The row becomes part of a message when
--   the message is sent. Support staff read and write everything; a customer
--   reads non-internal files on tickets they can see and writes only to those
--   tickets. Nobody signed out can reach any of it.
--
-- Sending
--   issue_4382_post_support_message is the one writer of support messages
--   (support-send, Ari through support-send, and Told all end here). It
--   attaches files, applies the status rules (a customer reply reopens a
--   Waiting or Resolved ticket, a closed ticket refuses replies, "Send and
--   wait" sets Waiting with a next-update time) and enqueues the Explorer
--   reply push. Host reply pushes stay in notify-support.
--
-- Creating
--   issue_4382_create_customer_ticket (the person) and
--   issue_4382_create_staff_ticket (Support, any visibility) replace
--   issue_3988_create_brand_support_ticket and
--   issue_3720_create_internal_thread.
--
-- Notifications
--   New categories: business.support_status_changed,
--   business.support_product_update, explorer.support_reply,
--   explorer.support_status_changed, explorer.support_product_update. One
--   producer (issue_4382_enqueue_customer_alert) writes them. A status
--   trigger covers person and brand tickets of both apps.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Bucket.
-- ─────────────────────────────────────────────────────────────────────────
DO $bucket$
DECLARE
  has_public boolean;
  has_file_size_limit boolean;
  has_allowed_mime_types boolean;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE '#4382: storage schema unavailable; support-attachments bucket not created';
    RETURN;
  END IF;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='storage' AND table_name='buckets' AND column_name='public') INTO has_public;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='storage' AND table_name='buckets' AND column_name='file_size_limit') INTO has_file_size_limit;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='storage' AND table_name='buckets' AND column_name='allowed_mime_types') INTO has_allowed_mime_types;

  IF has_public AND has_file_size_limit AND has_allowed_mime_types THEN
    INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'support-attachments', 'support-attachments', false, 15728640,
      ARRAY['image/png','image/jpeg','image/webp','image/heic','audio/mp4','audio/x-m4a','audio/m4a']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets(id, name, public)
    VALUES ('support-attachments', 'support-attachments', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
  ELSE
    INSERT INTO storage.buckets(id, name)
    VALUES ('support-attachments', 'support-attachments')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$bucket$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. support_attachments.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.support_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Set once the ticket exists. Uploads made while the create form is still
  -- open carry draft_ticket_id (the id the ticket will get) instead.
  ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  draft_ticket_id uuid,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  storage_path text NOT NULL UNIQUE,
  kind text NOT NULL,
  mime text NOT NULL,
  bytes integer,
  width integer,
  height integer,
  duration_ms integer,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  purge_started_at timestamptz,
  import_source_bucket text,
  import_source_path text,
  import_copied_at timestamptz,
  CONSTRAINT support_attachments_one_ticket_ref
    CHECK ((ticket_id IS NULL) <> (draft_ticket_id IS NULL)),
  CONSTRAINT support_attachments_draft_unsent
    CHECK (draft_ticket_id IS NULL OR message_id IS NULL),
  CONSTRAINT support_attachments_kind_check
    CHECK (kind IN ('image', 'audio')),
  CONSTRAINT support_attachments_mime_check
    CHECK (
      (kind = 'image' AND mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/heic'))
      OR (kind = 'audio' AND mime IN ('audio/mp4', 'audio/x-m4a', 'audio/m4a'))
    ),
  CONSTRAINT support_attachments_bytes_check
    CHECK (
      (bytes IS NULL AND import_source_path IS NOT NULL)
      OR (bytes > 0 AND (
        (kind = 'image' AND bytes <= 10485760)
        OR (kind = 'audio' AND bytes <= 15728640)
      ))
    ),
  CONSTRAINT support_attachments_dimensions_check
    CHECK (
      (width IS NULL OR width BETWEEN 1 AND 20000)
      AND (height IS NULL OR height BETWEEN 1 AND 20000)
    ),
  CONSTRAINT support_attachments_duration_check
    CHECK (
      (kind = 'image' AND duration_ms IS NULL)
      OR (kind = 'audio' AND duration_ms BETWEEN 1 AND 300000)
    ),
  CONSTRAINT support_attachments_path_shape
    CHECK (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg|webp|heic|m4a)$'),
  CONSTRAINT support_attachments_import_pair
    CHECK ((import_source_bucket IS NULL) = (import_source_path IS NULL))
);

CREATE INDEX support_attachments_ticket_idx ON public.support_attachments (ticket_id, created_at);
CREATE INDEX support_attachments_message_idx ON public.support_attachments (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX support_attachments_unsent_idx ON public.support_attachments (created_at) WHERE message_id IS NULL;
CREATE INDEX support_attachments_draft_idx ON public.support_attachments (draft_ticket_id) WHERE draft_ticket_id IS NOT NULL;

-- At most 10 images per message (D5).
CREATE OR REPLACE FUNCTION public.issue_4382_support_attachment_image_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.message_id IS NOT NULL AND NEW.kind = 'image'
     AND (SELECT count(*) FROM public.support_attachments other
          WHERE other.message_id = NEW.message_id
            AND other.kind = 'image'
            AND other.id <> NEW.id) >= 10 THEN
    RAISE EXCEPTION 'too_many_images' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER issue_4382_support_attachment_image_cap
  BEFORE INSERT OR UPDATE OF message_id ON public.support_attachments
  FOR EACH ROW EXECUTE FUNCTION public.issue_4382_support_attachment_image_cap();

ALTER TABLE public.support_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_attachments TO authenticated;
GRANT ALL ON public.support_attachments TO service_role;

CREATE POLICY support_attachments_staff_read ON public.support_attachments
  FOR SELECT TO authenticated
  USING (public.issue_4382_is_staff(auth.uid()));
CREATE POLICY support_attachments_customer_read ON public.support_attachments
  FOR SELECT TO authenticated
  USING (
    NOT is_internal
    AND (
      (message_id IS NOT NULL AND ticket_id IS NOT NULL
        AND public.issue_4382_customer_can_view_ticket(ticket_id, auth.uid()))
      OR uploaded_by = auth.uid()
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.support_attachments;

-- The beta feedback files (part 1 kept the map). Paths are fixed now; the
-- support-beta-feedback-import edge function copies the objects and fills in
-- bytes and import_copied_at.
INSERT INTO public.support_attachments (
  ticket_id, message_id, storage_path, kind, mime, duration_ms, uploaded_by,
  is_internal, created_at, import_source_bucket, import_source_path
)
SELECT import.ticket_id, import.message_id,
       import.ticket_id::text || '/' || gen_random_uuid()::text || '.m4a',
       'audio', 'audio/mp4', LEAST(GREATEST(import.audio_duration_ms, 1), 300000),
       NULL, false, import.created_at, 'beta-feedback', import.audio_path
FROM public.issue_4382_beta_feedback_import import;

INSERT INTO public.support_attachments (
  ticket_id, message_id, storage_path, kind, mime, uploaded_by, is_internal,
  created_at, import_source_bucket, import_source_path
)
SELECT import.ticket_id, import.message_id,
       import.ticket_id::text || '/' || gen_random_uuid()::text || '.jpg',
       'image', 'image/jpeg', NULL, false, import.created_at, 'beta-feedback', shot.path
FROM public.issue_4382_beta_feedback_import import
CROSS JOIN LATERAL unnest(import.screenshot_paths) WITH ORDINALITY AS shot(path, n)
WHERE shot.n <= 10 AND btrim(COALESCE(shot.path, '')) <> '';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Storage policies. Read and write are decided by the attachment row.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4382_can_read_attachment_object(p_name text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.support_attachments a
    WHERE a.storage_path = p_name
      AND (
        public.issue_4382_is_staff(p_user_id)
        OR (
          NOT a.is_internal
          AND (
            (a.message_id IS NOT NULL AND a.ticket_id IS NOT NULL
              AND public.issue_4382_customer_can_view_ticket(a.ticket_id, p_user_id))
            OR a.uploaded_by = p_user_id
          )
        )
      )
  );
$$;

-- Only the registered uploader, only the registered path, only before it is
-- sent and only while it is not being purged.
CREATE OR REPLACE FUNCTION public.issue_4382_can_write_attachment_object(p_name text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.support_attachments a
    WHERE a.storage_path = p_name
      AND a.uploaded_by = p_user_id
      AND a.message_id IS NULL
      AND a.purge_started_at IS NULL
      AND a.import_source_path IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.issue_4382_can_read_attachment_object(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4382_can_write_attachment_object(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4382_can_read_attachment_object(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4382_can_write_attachment_object(text, uuid) TO authenticated, service_role;

DO $policies$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE '#4382: storage.objects unavailable; support-attachments policies not created';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS support_attachments_object_read ON storage.objects';
  EXECUTE $p$
    CREATE POLICY support_attachments_object_read ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'support-attachments'
        AND public.issue_4382_can_read_attachment_object(name, auth.uid())
      )
  $p$;

  EXECUTE 'DROP POLICY IF EXISTS support_attachments_object_insert ON storage.objects';
  EXECUTE $p$
    CREATE POLICY support_attachments_object_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'support-attachments'
        AND public.issue_4382_can_write_attachment_object(name, auth.uid())
      )
  $p$;
END
$policies$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Registering an upload.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4382_register_support_attachment(
  p_ticket_id uuid,
  p_kind text,
  p_mime text,
  p_bytes integer,
  p_width integer DEFAULT NULL,
  p_height integer DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_is_internal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ticket public.support_tickets%ROWTYPE;
  v_is_staff boolean;
  v_ext text;
  v_id uuid := gen_random_uuid();
  v_path text;
  v_draft boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'ticket_id_required' USING ERRCODE = '22023';
  END IF;
  v_is_staff := public.issue_4382_is_staff(v_actor);
  IF COALESCE(p_is_internal, false) AND NOT v_is_staff THEN
    RAISE EXCEPTION 'internal_attachment_staff_only' USING ERRCODE = '42501';
  END IF;

  v_ext := CASE p_mime
    WHEN 'image/png' THEN 'png'
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/webp' THEN 'webp'
    WHEN 'image/heic' THEN 'heic'
    WHEN 'audio/mp4' THEN 'm4a'
    WHEN 'audio/x-m4a' THEN 'm4a'
    WHEN 'audio/m4a' THEN 'm4a'
  END;
  IF v_ext IS NULL
     OR p_kind NOT IN ('image', 'audio')
     OR (p_kind = 'image' AND v_ext = 'm4a')
     OR (p_kind = 'audio' AND v_ext <> 'm4a') THEN
    RAISE EXCEPTION 'attachment_type_not_allowed' USING ERRCODE = '22023';
  END IF;
  IF p_bytes IS NULL OR p_bytes < 1
     OR (p_kind = 'image' AND p_bytes > 10485760)
     OR (p_kind = 'audio' AND p_bytes > 15728640) THEN
    RAISE EXCEPTION 'attachment_too_large' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'audio' AND (p_duration_ms IS NULL OR p_duration_ms < 1 OR p_duration_ms > 300000) THEN
    RAISE EXCEPTION 'voice_note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF FOUND THEN
    IF NOT (v_is_staff OR public.issue_4382_customer_can_view_ticket(v_ticket.id, v_actor)) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF v_ticket.status = 'closed' THEN
      RAISE EXCEPTION 'ticket_closed' USING ERRCODE = 'PT409';
    END IF;
    IF p_kind = 'audio' AND v_ticket.requester_segment <> 'explorer' THEN
      RAISE EXCEPTION 'voice_notes_explorer_only' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- A ticket still being written: the id is the create call's request id.
    v_draft := true;
    IF EXISTS (
      SELECT 1 FROM public.support_attachments a
      WHERE a.draft_ticket_id = p_ticket_id
        AND a.uploaded_by IS DISTINCT FROM v_actor
    ) THEN
      RAISE EXCEPTION 'draft_belongs_to_someone_else' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  IF (SELECT count(*) FROM public.support_attachments a
      WHERE a.uploaded_by = v_actor
        AND a.message_id IS NULL
        AND a.created_at > now() - interval '24 hours') >= 40 THEN
    RAISE EXCEPTION 'too_many_pending_uploads' USING ERRCODE = '22023';
  END IF;

  v_path := p_ticket_id::text || '/' || v_id::text || '.' || v_ext;
  INSERT INTO public.support_attachments (
    id, ticket_id, draft_ticket_id, storage_path, kind, mime, bytes, width,
    height, duration_ms, uploaded_by, is_internal
  ) VALUES (
    v_id,
    CASE WHEN v_draft THEN NULL ELSE p_ticket_id END,
    CASE WHEN v_draft THEN p_ticket_id ELSE NULL END,
    v_path, p_kind, p_mime, p_bytes, p_width, p_height,
    CASE WHEN p_kind = 'audio' THEN p_duration_ms ELSE NULL END,
    v_actor, COALESCE(p_is_internal, false)
  );

  RETURN jsonb_build_object(
    'attachment_id', v_id,
    'bucket', 'support-attachments',
    'storage_path', v_path,
    'ticket_id', p_ticket_id,
    'draft', v_draft
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_register_support_attachment(uuid, text, text, integer, integer, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4382_register_support_attachment(uuid, text, text, integer, integer, integer, integer, boolean) TO authenticated, service_role;

-- Attach registered uploads to a message. Every id must belong to this
-- ticket, be the sender's, be unsent and not be purging; anything else
-- refuses the whole send.
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
SET search_path = public, pg_temp
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
  IF (SELECT count(*) FROM public.support_attachments WHERE message_id = p_message_id AND kind = 'audio') > 1 THEN
    RAISE EXCEPTION 'one_voice_note_per_message' USING ERRCODE = '22023';
  END IF;
  RETURN v_done;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_attach_to_message(uuid, uuid, uuid[], uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4382_attach_to_message(uuid, uuid, uuid[], uuid, boolean) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Customer notifications.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.notification_categories(
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES
  ('business.support_status_changed', 'support', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true),
  ('business.support_product_update', 'support', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true),
  ('explorer.support_reply', 'Messages', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true),
  ('explorer.support_status_changed', 'Messages', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true),
  ('explorer.support_product_update', 'Messages', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = EXCLUDED.active;

-- Same body as 20271222004111 with the five #4382 categories added.
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
    'explorer.support_product_update'
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

-- The one producer of customer-facing support notifications. Recipients
-- follow visibility: person -> the requester; brand -> every active member;
-- internal -> nobody. The actor never notifies themselves.
CREATE OR REPLACE FUNCTION public.issue_4382_enqueue_customer_alert(
  p_ticket_id uuid,
  p_kind text,
  p_event_key text,
  p_extra jsonb DEFAULT '{}'::jsonb,
  p_exclude_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_category text;
  v_link text;
  v_count integer := 0;
BEGIN
  IF p_kind NOT IN ('reply', 'status_changed', 'product_update') THEN
    RAISE EXCEPTION 'invalid_alert_kind' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND OR v_ticket.visibility = 'internal' THEN
    RETURN 0;
  END IF;
  IF v_ticket.requester_segment = 'explorer' THEN
    v_category := 'explorer.support_' || p_kind;
    v_link := 'mingla://support/' || v_ticket.id::text;
  ELSE
    -- Host replies are delivered by notify-support (business.support_message).
    IF p_kind = 'reply' THEN RETURN 0; END IF;
    v_category := 'business.support_' || p_kind;
    v_link := 'mingla-business://support/' || v_ticket.id::text;
  END IF;

  WITH recipients AS (
    SELECT v_ticket.requester_user_id AS user_id
    WHERE v_ticket.visibility = 'person' AND v_ticket.requester_user_id IS NOT NULL
    UNION
    SELECT member.user_id
    FROM public.brand_team_members member
    WHERE v_ticket.visibility = 'brand'
      AND member.brand_id = v_ticket.brand_id
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
  ), inserted AS (
    INSERT INTO public.notification_outbox (
      category_key, user_id, brand_id, country_code, payload, idempotency_key, status
    )
    SELECT v_category, r.user_id,
           CASE WHEN v_ticket.visibility = 'brand' THEN v_ticket.brand_id END,
           NULL,
           COALESCE(p_extra, '{}'::jsonb) || jsonb_build_object(
             'ticket_id', v_ticket.id,
             'ticket_number', v_ticket.ticket_number,
             'subject', v_ticket.subject,
             'status', v_ticket.status,
             'push', true,
             'deep_link', v_link
           ),
           v_category || ':' || v_ticket.id::text || ':' || p_event_key || ':' || r.user_id::text,
           'pending'
    FROM recipients r
    WHERE r.user_id IS NOT NULL
      AND r.user_id IS DISTINCT FROM p_exclude_user_id
      AND r.user_id IS DISTINCT FROM auth.uid()
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_enqueue_customer_alert(uuid, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4382_enqueue_customer_alert(uuid, text, text, jsonb, uuid) TO service_role;

-- Status and next-update changes tell the customer. Set
-- mingla.support_quiet = 'on' for a change that already carries its own
-- message (a reply, "Send and wait", Told).
CREATE OR REPLACE FUNCTION public.issue_4382_customer_status_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text;
BEGIN
  IF COALESCE(current_setting('mingla.support_quiet', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF NEW.visibility = 'internal' THEN RETURN NULL; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_kind := 'status';
  ELSIF NEW.next_update_at IS DISTINCT FROM OLD.next_update_at AND NEW.next_update_at IS NOT NULL THEN
    v_kind := 'next_update';
  ELSE
    RETURN NULL;
  END IF;
  PERFORM public.issue_4382_enqueue_customer_alert(
    NEW.id,
    'status_changed',
    v_kind || ':' || NEW.status || ':' || txid_current()::text,
    jsonb_build_object(
      'update_kind', v_kind,
      'previous_status', OLD.status,
      'next_update_at', NEW.next_update_at
    ),
    NULL
  );
  RETURN NULL;
END;
$$;
CREATE TRIGGER issue_4382_customer_status_alert
  AFTER UPDATE OF status, next_update_at ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.issue_4382_customer_status_alert();

-- Internal tickets keep the staff alerts the old staff threads had.
CREATE OR REPLACE FUNCTION public.issue_4382_staff_ticket_payload(p_ticket public.support_tickets)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'ticket_id', p_ticket.id,
    'ticket_number', p_ticket.ticket_number,
    'subject', p_ticket.subject,
    'priority', p_ticket.priority,
    'deep_link', public.issue_3988_admin_link('support_ticket', p_ticket.id)
  );
$$;

CREATE OR REPLACE FUNCTION public.issue_4382_internal_ticket_assigned_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.visibility <> 'internal'
     OR NEW.assigned_staff_id IS NULL
     OR NEW.assigned_staff_id IS NOT DISTINCT FROM OLD.assigned_staff_id
     OR NEW.assigned_staff_id IS NOT DISTINCT FROM auth.uid() THEN
    RETURN NULL;
  END IF;
  PERFORM public.issue_3988_enqueue_alert(
    'admin.support_assigned',
    NEW.assigned_staff_id,
    'admin.support_assigned:' || NEW.id::text || ':' || NEW.assigned_staff_id::text
      || ':' || NEW.support_workflow_revision::text,
    public.issue_4382_staff_ticket_payload(NEW)
  );
  RETURN NULL;
END;
$$;
CREATE TRIGGER issue_4382_internal_ticket_assigned_alert
  AFTER UPDATE OF assigned_staff_id ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.issue_4382_internal_ticket_assigned_alert();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. The send path.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4382_post_support_message(
  p_ticket_id uuid,
  p_sender_id uuid,
  p_as_staff boolean,
  p_content text,
  p_attachment_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_is_internal boolean DEFAULT false,
  p_wait_until timestamptz DEFAULT NULL,
  p_wait_note text DEFAULT NULL,
  p_sender_display_name text DEFAULT NULL,
  p_allow_closed boolean DEFAULT false,
  p_customer_alert text DEFAULT 'reply'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_content text := btrim(COALESCE(p_content, ''));
  v_has_files boolean := COALESCE(cardinality(p_attachment_ids), 0) > 0;
  v_internal boolean := COALESCE(p_is_internal, false);
  v_message uuid;
  v_status text;
  v_reopened boolean := false;
  v_note text := left(btrim(COALESCE(p_wait_note, '')), 500);
BEGIN
  IF p_sender_id IS NULL OR p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'sender_and_ticket_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_as_staff THEN
    IF NOT public.issue_4382_is_staff(p_sender_id) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_internal OR p_wait_until IS NOT NULL THEN
      RAISE EXCEPTION 'staff_only' USING ERRCODE = '42501';
    END IF;
    IF NOT public.issue_4382_customer_can_view_ticket(v_ticket.id, p_sender_id) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_ticket.status = 'closed' AND NOT COALESCE(p_allow_closed, false) THEN
    RAISE EXCEPTION 'ticket_closed' USING ERRCODE = 'PT409';
  END IF;
  IF v_content = '' AND NOT v_has_files THEN
    RAISE EXCEPTION 'content_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_content) > 8000 THEN
    RAISE EXCEPTION 'content_too_long' USING ERRCODE = '22023';
  END IF;
  IF p_wait_until IS NOT NULL THEN
    IF v_internal THEN
      RAISE EXCEPTION 'wait_needs_a_customer_reply' USING ERRCODE = '22023';
    END IF;
    IF p_wait_until <= now() THEN
      RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
    END IF;
    IF v_note = '' THEN
      RAISE EXCEPTION 'next_update_note_required' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- A note on an internal ticket is the only kind of message it has.
  IF v_ticket.visibility = 'internal' THEN
    v_internal := true;
  END IF;

  INSERT INTO public.messages (
    conversation_id, sender_id, content, message_type, is_internal,
    sender_display_name_snapshot, sender_role_snapshot
  ) VALUES (
    v_ticket.conversation_id, p_sender_id, v_content, 'text', v_internal,
    NULLIF(left(btrim(COALESCE(p_sender_display_name, '')), 120), ''),
    CASE WHEN p_as_staff THEN 'Mingla Support' END
  )
  RETURNING id INTO v_message;

  PERFORM public.issue_4382_attach_to_message(
    v_ticket.id, v_message, p_attachment_ids, p_sender_id, v_internal
  );

  -- The message is the notification; the status change rides along quietly.
  PERFORM set_config('mingla.support_quiet', 'on', true);
  v_status := v_ticket.status;
  IF NOT v_internal THEN
    IF NOT p_as_staff AND v_ticket.status IN ('pending', 'resolved') THEN
      v_status := 'open';
      v_reopened := true;
    ELSIF p_as_staff AND p_wait_until IS NOT NULL THEN
      v_status := 'pending';
    ELSIF p_as_staff AND v_ticket.status = 'new' THEN
      v_status := 'open';
    END IF;

    UPDATE public.support_tickets
       SET status = v_status,
           resolved_at = CASE WHEN v_reopened THEN NULL ELSE resolved_at END,
           last_message_at = now(),
           last_sender_kind = CASE WHEN p_as_staff THEN 'staff' ELSE 'customer' END,
           first_response_at = CASE
             WHEN p_as_staff AND first_response_at IS NULL THEN now()
             ELSE first_response_at
           END,
           next_update_at = CASE WHEN p_wait_until IS NOT NULL THEN p_wait_until ELSE next_update_at END,
           next_update_note = CASE WHEN p_wait_until IS NOT NULL THEN v_note ELSE next_update_note END,
           support_workflow_revision = support_workflow_revision + 1
     WHERE id = v_ticket.id;
    -- The thread says why the ticket is open again (Admin, Host, Explorer).
    -- A system line: no sender, no alert, sorted just after the reply.
    IF v_reopened THEN
      INSERT INTO public.messages (conversation_id, sender_id, content, message_type, created_at)
      VALUES (v_ticket.conversation_id, NULL, 'Reopened automatically', 'system', clock_timestamp());
    END IF;
  END IF;
  PERFORM set_config('mingla.support_quiet', '', true);

  IF p_as_staff AND NOT v_internal THEN
    PERFORM public.issue_4382_enqueue_customer_alert(
      v_ticket.id,
      CASE WHEN p_customer_alert = 'product_update' THEN 'product_update' ELSE 'reply' END,
      'message:' || v_message::text,
      jsonb_build_object('message_id', v_message),
      p_sender_id
    );
  END IF;

  INSERT INTO public.support_audit_log(actor_user_id, action, ticket_id, metadata)
  VALUES (
    p_sender_id,
    CASE WHEN v_internal THEN 'internal_note'
         WHEN p_as_staff THEN 'staff_reply'
         ELSE 'requester_reply' END,
    v_ticket.id,
    jsonb_build_object(
      'message_id', v_message,
      'attachments', COALESCE(cardinality(p_attachment_ids), 0),
      'status_from', v_ticket.status,
      'status_to', v_status,
      'waiting', p_wait_until IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'message_id', v_message,
    'ticket_id', v_ticket.id,
    'is_internal', v_internal,
    'previous_status', v_ticket.status,
    'status', v_status,
    'reopened', v_reopened,
    'visibility', v_ticket.visibility,
    'requester_segment', v_ticket.requester_segment
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_post_support_message(uuid, uuid, boolean, text, uuid[], boolean, timestamptz, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4382_post_support_message(uuid, uuid, boolean, text, uuid[], boolean, timestamptz, text, text, boolean, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Creating tickets.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4382_clean_client_meta(p_meta jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
  v_out jsonb := '{}'::jsonb;
BEGIN
  IF p_meta IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF jsonb_typeof(p_meta) <> 'object' THEN
    RAISE EXCEPTION 'client_meta_invalid' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_meta) LOOP
    IF v_key NOT IN ('app_version', 'os', 'os_version', 'device_model', 'source_screen') THEN
      RAISE EXCEPTION 'client_meta_invalid' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_meta -> v_key) <> 'string' THEN
      RAISE EXCEPTION 'client_meta_invalid' USING ERRCODE = '22023';
    END IF;
    v_out := v_out || jsonb_build_object(v_key, left(btrim(p_meta ->> v_key), 120));
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_clean_client_meta(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4382_clean_client_meta(jsonb) TO authenticated, service_role;

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
        AND p_topic NOT IN ('payouts', 'tickets_checkin', 'events', 'venue', 'account', 'other'))
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

CREATE OR REPLACE FUNCTION public.issue_4382_create_staff_ticket(
  p_client_request_id uuid,
  p_visibility text,
  p_subject text,
  p_details text,
  p_requester_user_id uuid DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_segment text DEFAULT NULL,
  p_priority text DEFAULT 'normal',
  p_product_area text DEFAULT NULL,
  p_assigned_staff_id uuid DEFAULT NULL,
  p_next_update_at timestamptz DEFAULT NULL,
  p_next_update_note text DEFAULT NULL,
  p_first_message text DEFAULT NULL,
  p_attachment_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_existing public.support_tickets%ROWTYPE;
  v_subject text := left(btrim(COALESCE(p_subject, '')), 200);
  v_details text := left(btrim(COALESCE(p_details, '')), 8000);
  v_first text := btrim(COALESCE(p_first_message, ''));
  v_note text := left(btrim(COALESCE(p_next_update_note, '')), 500);
  v_segment text;
  v_assignee uuid := COALESCE(p_assigned_staff_id, auth.uid());
  v_conversation uuid;
  v_note_id uuid;
  v_message_id uuid;
  v_internal_ids uuid[];
  v_public_ids uuid[];
  v_user uuid;
  v_ticket public.support_tickets%ROWTYPE;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.support_tickets
  WHERE id = p_client_request_id
     OR (created_by = v_actor AND client_request_id = p_client_request_id)
  LIMIT 1;
  IF FOUND THEN
    IF v_existing.created_by = v_actor THEN RETURN v_existing.id; END IF;
    RAISE EXCEPTION 'request_id_taken' USING ERRCODE = 'PT409';
  END IF;

  IF p_visibility NOT IN ('internal', 'person', 'brand') THEN
    RAISE EXCEPTION 'invalid_visibility' USING ERRCODE = '22023';
  END IF;
  IF v_subject = '' OR v_details = '' THEN
    RAISE EXCEPTION 'subject_and_details_required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_priority, 'normal') NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'invalid_priority' USING ERRCODE = '22023';
  END IF;
  IF p_product_area IS NOT NULL AND char_length(btrim(p_product_area)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_product_area' USING ERRCODE = '22023';
  END IF;
  IF p_requester_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_requester_user_id) THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_brand_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_assigned_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.support_staff WHERE user_id = p_assigned_staff_id AND enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'assignee_not_support_staff' USING ERRCODE = '22023';
  END IF;

  IF p_visibility = 'person' AND p_requester_user_id IS NULL THEN
    RAISE EXCEPTION 'customer_required' USING ERRCODE = '22023';
  END IF;
  IF p_visibility = 'brand' AND p_brand_id IS NULL THEN
    RAISE EXCEPTION 'brand_required' USING ERRCODE = '22023';
  END IF;
  IF p_visibility IN ('person', 'brand') THEN
    IF v_first = '' THEN
      RAISE EXCEPTION 'first_message_required' USING ERRCODE = '22023';
    END IF;
    IF p_next_update_at IS NULL OR p_next_update_at <= now() THEN
      RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
    END IF;
    IF v_note = '' THEN
      RAISE EXCEPTION 'next_update_note_required' USING ERRCODE = '22023';
    END IF;
  ELSIF (p_next_update_at IS NULL) <> (v_note = '') THEN
    RAISE EXCEPTION 'next_update_pair_required' USING ERRCODE = '22023';
  END IF;

  v_segment := CASE
    WHEN p_visibility = 'brand' THEN 'business'
    WHEN p_segment IN ('business', 'explorer') THEN p_segment
    WHEN p_requester_user_id IS NOT NULL
      AND public.derive_user_segment(p_requester_user_id) = 'explorer' THEN 'explorer'
    ELSE 'business'
  END;

  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
  VALUES ('group', 'support', v_subject, v_actor)
  RETURNING id INTO v_conversation;

  INSERT INTO public.conversation_participants(conversation_id, user_id)
  SELECT v_conversation, candidate.user_id
  FROM (
    SELECT v_actor AS user_id WHERE p_visibility <> 'internal'
    UNION
    SELECT p_requester_user_id WHERE p_visibility = 'person'
    UNION
    SELECT member.user_id FROM public.brand_team_members member
    WHERE p_visibility = 'brand'
      AND member.brand_id = p_brand_id
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
  ) candidate
  WHERE candidate.user_id IS NOT NULL
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  -- Quiet: the first message (or nothing, for internal) is the news.
  PERFORM set_config('mingla.support_quiet', 'on', true);
  INSERT INTO public.support_tickets (
    id, requester_user_id, requester_segment, subject, status, priority,
    assigned_staff_id, conversation_id, brand_id, first_response_at,
    next_update_at, next_update_note, created_by, client_request_id, origin,
    visibility, product_area, last_sender_kind
  ) VALUES (
    p_client_request_id, p_requester_user_id, v_segment, v_subject,
    CASE WHEN p_visibility = 'internal' THEN 'open' ELSE 'pending' END,
    COALESCE(p_priority, 'normal'), v_assignee, v_conversation, p_brand_id,
    CASE WHEN p_visibility = 'internal' THEN NULL ELSE now() END,
    p_next_update_at, NULLIF(v_note, ''), v_actor, p_client_request_id, 'staff',
    p_visibility, NULLIF(btrim(COALESCE(p_product_area, '')), ''), 'staff'
  )
  RETURNING * INTO v_ticket;
  PERFORM set_config('mingla.support_quiet', '', true);

  -- Which uploads are internal is decided at upload time; on an internal
  -- ticket everything is.
  SELECT COALESCE(array_agg(a.id) FILTER (WHERE a.is_internal OR p_visibility = 'internal'), ARRAY[]::uuid[]),
         COALESCE(array_agg(a.id) FILTER (WHERE NOT a.is_internal AND p_visibility <> 'internal'), ARRAY[]::uuid[])
    INTO v_internal_ids, v_public_ids
    FROM public.support_attachments a
   WHERE a.id = ANY(COALESCE(p_attachment_ids, ARRAY[]::uuid[]))
     AND a.draft_ticket_id = p_client_request_id
     AND a.uploaded_by = v_actor;
  IF cardinality(v_internal_ids) + cardinality(v_public_ids)
     <> (SELECT count(DISTINCT id) FROM unnest(COALESCE(p_attachment_ids, ARRAY[]::uuid[])) id) THEN
    RAISE EXCEPTION 'attachment_not_available' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.messages (
    conversation_id, sender_id, content, message_type, is_internal,
    sender_display_name_snapshot, sender_role_snapshot
  ) VALUES (v_conversation, v_actor, v_details, 'text', true, 'Mingla Support', 'Mingla Support')
  RETURNING id INTO v_note_id;
  PERFORM public.issue_4382_attach_to_message(p_client_request_id, v_note_id, v_internal_ids, v_actor, true);

  IF p_visibility <> 'internal' THEN
    INSERT INTO public.messages (
      conversation_id, sender_id, content, message_type, is_internal,
      sender_display_name_snapshot, sender_role_snapshot
    ) VALUES (v_conversation, v_actor, v_first, 'text', false, 'Mingla Support', 'Mingla Support')
    RETURNING id INTO v_message_id;
    PERFORM public.issue_4382_attach_to_message(p_client_request_id, v_message_id, v_public_ids, v_actor, false);

    PERFORM public.issue_4382_enqueue_customer_alert(
      p_client_request_id, 'status_changed', 'opened',
      jsonb_build_object('update_kind', 'opened', 'message_id', v_message_id,
        'next_update_at', p_next_update_at),
      v_actor
    );
  ELSE
    FOR v_user IN
      SELECT r.user_id FROM public.issue_3988_support_roster() r
      WHERE r.user_id IS DISTINCT FROM v_actor
    LOOP
      PERFORM public.issue_3988_enqueue_alert(
        'admin.support_staff_ticket',
        v_user,
        'admin.support_staff_ticket:' || p_client_request_id::text || ':' || v_user::text,
        public.issue_4382_staff_ticket_payload(v_ticket)
      );
    END LOOP;
    IF v_assignee IS DISTINCT FROM v_actor THEN
      PERFORM public.issue_3988_enqueue_alert(
        'admin.support_assigned',
        v_assignee,
        'admin.support_assigned:' || p_client_request_id::text || ':' || v_assignee::text || ':1',
        public.issue_4382_staff_ticket_payload(v_ticket)
      );
    END IF;
  END IF;

  INSERT INTO public.support_audit_log(actor_user_id, action, ticket_id, metadata)
  VALUES (v_actor, 'ticket_created', p_client_request_id, jsonb_build_object(
    'origin', 'staff', 'visibility', p_visibility, 'segment', v_segment,
    'brand_id', p_brand_id, 'attachments', COALESCE(cardinality(p_attachment_ids), 0)
  ));
  RETURN p_client_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_create_staff_ticket(uuid, text, text, text, uuid, uuid, text, text, text, uuid, timestamptz, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4382_create_staff_ticket(uuid, text, text, text, uuid, uuid, text, text, text, uuid, timestamptz, text, text, uuid[]) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Unsent uploads: claimed by the daily clean-up, then deleted.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4382_claim_stale_support_attachments(p_limit integer DEFAULT 200)
RETURNS TABLE(attachment_id uuid, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT a.id
    FROM public.support_attachments a
    WHERE a.message_id IS NULL
      AND a.import_source_path IS NULL
      AND a.created_at < now() - interval '24 hours'
      AND (a.purge_started_at IS NULL OR a.purge_started_at < now() - interval '1 hour')
    ORDER BY a.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.support_attachments a
     SET purge_started_at = now()
    FROM picked
   WHERE a.id = picked.id
  RETURNING a.id, a.storage_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_4382_finish_stale_support_attachments(p_attachment_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.support_attachments a
   WHERE a.id = ANY(COALESCE(p_attachment_ids, ARRAY[]::uuid[]))
     AND a.message_id IS NULL
     AND a.purge_started_at IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- The beta feedback copy: the edge function reports each copied object.
CREATE OR REPLACE FUNCTION public.issue_4382_mark_attachment_imported(p_attachment_id uuid, p_bytes integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.support_attachments
     SET bytes = p_bytes, import_copied_at = now()
   WHERE id = p_attachment_id
     AND import_source_path IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_4382_claim_stale_support_attachments(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4382_finish_stale_support_attachments(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4382_mark_attachment_imported(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4382_claim_stale_support_attachments(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4382_finish_stale_support_attachments(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4382_mark_attachment_imported(uuid, integer) TO service_role;

DO $advisory$
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
      RAISE NOTICE '#4382 advisory: Vault secret supabase_url is missing; the support attachment clean-up cannot run until it exists.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
      RAISE NOTICE '#4382 advisory: Vault secret service_role_key is missing; the support attachment clean-up cannot authenticate until it exists.';
    END IF;
  END IF;
END
$advisory$;

DO $cron_replace$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_4382_support_attachment_cleanup') THEN
    PERFORM cron.unschedule('issue_4382_support_attachment_cleanup');
  END IF;
END
$cron_replace$;

SELECT cron.schedule(
  'issue_4382_support_attachment_cleanup',
  '41 3 * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'supabase_url' LIMIT 1
      ) || '/functions/v1/support-attachment-cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

COMMENT ON TABLE public.support_attachments IS
  '#4382: private support files. Paths <ticket_id>/<uuid>.<ext> in the support-attachments bucket. Unsent rows are removed after 24 hours.';

COMMIT;
