-- #4111 Wave A — Customer enquiries + brand-page newsletter: schema and access.
--
-- A guest (signed-out web visitor, Explorer user, or a Mingla Sites contact
-- form) can message a brand. Each enquiry is its own conversation
-- (linked_entity_type 'brand_enquiry'). The brand team reads and replies; the
-- guest reads their own thread (Explorer: as a participant, web: through a
-- hashed access token handled by an edge function).
--
-- PRIVACY RULE (Seth D8): Mingla staff cannot read an enquiry unless it was
-- reported and the report is still open. Scanner-only team members never see
-- enquiries. Unlike Brand groups, no staff path exists in the access function.
--
-- Writes are RPC / edge only: direct INSERT/UPDATE/DELETE on enquiry tables and
-- on enquiry messages/conversations is refused for every client role.
--
-- INVARIANT: {"id":"I-4111-ENQUIRY-STAFF-BLIND","rule":"issue_4111_enquiry_can_read grants Mingla staff/admin access only while reported_at is set and the report is not dismissed; team access excludes role scanner."}
-- INVARIANT: {"id":"I-4111-ENQUIRY-RPC-ONLY","rule":"No client role can insert, update or delete brand_enquiries rows or messages in brand_enquiry conversations directly."}

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Conversations learn the 'brand_enquiry' kind.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_linked_entity_type_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_linked_entity_type_check
  CHECK (linked_entity_type IN ('direct','session','trip','event','support','brand','brand_enquiry'));

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_linked_entity_coherent;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_linked_entity_coherent CHECK (
  (linked_entity_type = 'direct'  AND session_id IS NULL     AND event_id IS NULL     AND brand_id IS NULL) OR
  (linked_entity_type = 'session' AND session_id IS NOT NULL AND event_id IS NULL     AND brand_id IS NULL) OR
  (linked_entity_type = 'trip'    AND event_id   IS NOT NULL AND session_id IS NULL   AND brand_id IS NULL) OR
  (linked_entity_type = 'event'   AND event_id   IS NOT NULL AND session_id IS NULL   AND brand_id IS NULL) OR
  (linked_entity_type = 'support' AND session_id IS NULL     AND event_id IS NULL     AND brand_id IS NULL) OR
  (linked_entity_type = 'brand'   AND brand_id   IS NOT NULL AND session_id IS NULL   AND event_id IS NULL) OR
  (linked_entity_type = 'brand_enquiry' AND brand_id IS NOT NULL AND session_id IS NULL AND event_id IS NULL)
);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Messages: who wrote it, from the enquiry's point of view. NULL = legacy.
--    A web guest's message has sender_id NULL and the guest's name in
--    sender_display_name_snapshot. 'brand_enquiry_card' is the one system card
--    posted into the brand's own Brand group when a new enquiry arrives.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sender_kind text;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_sender_kind_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_sender_kind_check
  CHECK (sender_kind IS NULL OR sender_kind IN ('guest','brand','system'));

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type::text IN ('text','image','video','file','card','system','brand_enquiry_card'));

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Brands: the "Let guests message us" switch.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS enquiries_enabled boolean NOT NULL DEFAULT true;

-- Eligible team = accepted, not removed, not scanner-only.
CREATE OR REPLACE FUNCTION public.issue_4111_is_enquiry_team_member(
  p_brand_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_brand_id IS NOT NULL AND p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.brand_team_members member
    WHERE member.brand_id = p_brand_id
      AND member.user_id = p_user_id
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
      AND member.role <> 'scanner'
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_is_enquiry_team_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4111_is_enquiry_team_member(uuid, uuid) TO authenticated, service_role;

-- A brand can take enquiries when the switch is on, the brand is live and at
-- least one eligible team member exists to read them.
CREATE OR REPLACE FUNCTION public.issue_4111_brand_takes_enquiries(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.deleted_at IS NULL
      AND b.enquiries_enabled IS TRUE
      AND EXISTS (
        SELECT 1 FROM public.brand_team_members member
        WHERE member.brand_id = b.id
          AND member.accepted_at IS NOT NULL
          AND member.removed_at IS NULL
          AND member.role <> 'scanner'
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_brand_takes_enquiries(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4111_brand_takes_enquiries(uuid) TO anon, authenticated, service_role;

-- Public brand view: append the switch and the computed availability. Columns
-- are appended at the end so CREATE OR REPLACE keeps every existing reader.
CREATE OR REPLACE VIEW public.business_public_brands_view AS
 SELECT b.id,
    b.slug,
    b.name,
    b.description,
    b.profile_photo_url,
    b.contact_email,
    b.contact_phone,
    b.social_links,
    b.custom_links,
    b.display_attendee_count,
    b.claim_status,
    b.address,
    b.cover_hue,
    b.cover_media_url,
    b.cover_media_type,
    b.profile_photo_type,
    b.theme_color,
    b.theme_font,
    b.theme_animation,
    b.created_at,
    b.updated_at,
    b.enquiries_enabled,
    public.issue_4111_brand_takes_enquiries(b.id) AS enquiries_available
   FROM public.brands b
  WHERE b.deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. brand_enquiries — one row per enquiry thread.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL UNIQUE REFERENCES public.conversations(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('web','explorer','site')),
  origin text NULL CHECK (origin IS NULL OR char_length(origin) BETWEEN 1 AND 200),
  entry text NOT NULL CHECK (entry IN ('brand_page','offering','calendar','cancel_page','site')),
  context_kind text NOT NULL DEFAULT 'none'
    CHECK (context_kind IN ('order','rsvp','reservation','stay','venue_order','offering','venue','none')),
  context_id uuid NULL,
  offering_kind text NULL CHECK (offering_kind IS NULL OR char_length(offering_kind) BETWEEN 1 AND 40),
  reason text NOT NULL CHECK (reason ~ '^[a-z_]{2,40}$'),
  topic_label text NOT NULL CHECK (char_length(btrim(topic_label)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','waiting','replied','resolved')),
  guest_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  guest_name text NOT NULL CHECK (char_length(btrim(guest_name)) BETWEEN 1 AND 80),
  guest_email text NOT NULL CHECK (
    guest_email = lower(btrim(guest_email))
    AND char_length(guest_email) BETWEEN 3 AND 254
    AND guest_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  ),
  guest_email_confirmed_at timestamptz NULL,
  guest_phone_e164 text NULL CHECK (guest_phone_e164 IS NULL OR guest_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  ok_to_call boolean NOT NULL DEFAULT false,
  disclosure_text text NULL CHECK (disclosure_text IS NULL OR char_length(disclosure_text) <= 2000),
  disclosure_version text NULL CHECK (disclosure_version IS NULL OR char_length(disclosure_version) <= 80),
  ip_hash text NULL CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  spam_flag boolean NOT NULL DEFAULT false,
  moderation_categories text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_guest_at timestamptz NOT NULL DEFAULT now(),
  last_brand_at timestamptz NULL,
  resolved_at timestamptz NULL,
  resolved_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  nudged_at timestamptz NULL,
  guest_emailed_at timestamptz NULL,
  reported_at timestamptz NULL,
  reported_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_side text NULL CHECK (reporter_side IS NULL OR reporter_side IN ('brand','guest')),
  report_reason text NULL CHECK (report_reason IS NULL OR char_length(report_reason) BETWEEN 1 AND 500),
  report_dismissed_at timestamptz NULL,
  report_dismissed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT brand_enquiries_site_origin CHECK (source <> 'site' OR origin IS NOT NULL),
  CONSTRAINT brand_enquiries_site_entry CHECK (entry <> 'site' OR source = 'site'),
  CONSTRAINT brand_enquiries_context_shape CHECK ((context_kind = 'none') = (context_id IS NULL)),
  CONSTRAINT brand_enquiries_call_needs_phone CHECK (NOT ok_to_call OR guest_phone_e164 IS NOT NULL),
  CONSTRAINT brand_enquiries_resolved_shape CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  CONSTRAINT brand_enquiries_report_shape CHECK (
    (reported_at IS NULL AND report_reason IS NULL AND reporter_side IS NULL AND report_dismissed_at IS NULL)
    OR (reported_at IS NOT NULL AND report_reason IS NOT NULL AND reporter_side IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS brand_enquiries_brand_status_idx
  ON public.brand_enquiries(brand_id, status, last_guest_at DESC);
CREATE INDEX IF NOT EXISTS brand_enquiries_guest_user_idx
  ON public.brand_enquiries(guest_user_id, last_guest_at DESC) WHERE guest_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS brand_enquiries_unclaimed_email_idx
  ON public.brand_enquiries(guest_email) WHERE guest_user_id IS NULL;
CREATE INDEX IF NOT EXISTS brand_enquiries_reported_idx
  ON public.brand_enquiries(reported_at DESC) WHERE reported_at IS NOT NULL AND report_dismissed_at IS NULL;

COMMENT ON TABLE public.brand_enquiries IS
  '#4111: one customer enquiry thread per row. Readable by eligible (non-scanner) brand team, the signed-in guest, and Mingla staff only while an open report exists. Never a marketing list.';

-- Guest web access tokens. The raw 32-byte token only ever lives in an email
-- link; the database keeps its SHA-256. Several live tokens per enquiry are
-- allowed so each reply email can carry a fresh link without breaking the
-- link in an earlier email. Expiry rolls forward on use.
CREATE TABLE IF NOT EXISTS public.brand_enquiry_access_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  enquiry_id uuid NOT NULL REFERENCES public.brand_enquiries(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS brand_enquiry_access_tokens_enquiry_idx
  ON public.brand_enquiry_access_tokens(enquiry_id, expires_at DESC);

-- Blocks. brand_id NULL = blocked everywhere (Admin "Block everywhere").
CREATE TABLE IF NOT EXISTS public.brand_enquiry_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  email_hash text NULL CHECK (email_hash IS NULL OR email_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_hash text NULL CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  source_enquiry_id uuid NULL REFERENCES public.brand_enquiries(id) ON DELETE SET NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_enquiry_blocks_one_key CHECK (
    num_nonnulls(email_hash, user_id, ip_hash) = 1
  ),
  CONSTRAINT brand_enquiry_blocks_unique UNIQUE NULLS NOT DISTINCT (brand_id, email_hash, user_id, ip_hash)
);

-- Signed-out subscribe (double opt-in). Service role only.
CREATE TABLE IF NOT EXISTS public.brand_subscribe_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('web','site')),
  origin text NULL CHECK (origin IS NULL OR char_length(origin) BETWEEN 1 AND 200),
  email text NOT NULL CHECK (
    email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254
    AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  ),
  phone_e164 text NULL CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  wants_sms boolean NOT NULL DEFAULT false,
  email_token_hash text NOT NULL UNIQUE CHECK (email_token_hash ~ '^[0-9a-f]{64}$'),
  sms_token_hash text NULL UNIQUE CHECK (sms_token_hash IS NULL OR sms_token_hash ~ '^[0-9a-f]{64}$'),
  sms_sent_at timestamptz NULL,
  disclosure_text text NOT NULL CHECK (char_length(disclosure_text) BETWEEN 1 AND 2000),
  disclosure_version text NOT NULL CHECK (char_length(disclosure_version) BETWEEN 1 AND 80),
  sms_disclosure_text text NULL CHECK (sms_disclosure_text IS NULL OR char_length(sms_disclosure_text) <= 2000),
  ip_hash text NULL CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  email_confirmed_at timestamptz NULL,
  sms_confirmed_at timestamptz NULL,
  outcome text NULL CHECK (outcome IS NULL OR outcome IN ('followed','subscribed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_subscribe_pending_sms_shape CHECK (
    NOT wants_sms OR phone_e164 IS NOT NULL
  ),
  CONSTRAINT brand_subscribe_pending_site_origin CHECK (source <> 'site' OR origin IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS brand_subscribe_pending_brand_email_idx
  ON public.brand_subscribe_pending(brand_id, email, created_at DESC);
CREATE INDEX IF NOT EXISTS brand_subscribe_pending_sms_month_idx
  ON public.brand_subscribe_pending(brand_id, sms_sent_at) WHERE sms_sent_at IS NOT NULL;

-- Contact-book provenance for newsletter subscribers (D2).
DO $provenance$
DECLARE
  v_target record;
  v_def text;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      ('public.brand_person_source_links', 'brand_person_source_links_source_kind_check'),
      ('public.brand_person_contact_method_sources', 'brand_person_contact_method_sources_provenance_kind_check')
    ) AS t(table_name, constraint_name)
  LOOP
    SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
    WHERE conrelid = v_target.table_name::regclass AND conname = v_target.constraint_name;
    IF v_def IS NULL OR v_def !~ '\]\)\)\)$' THEN
      RAISE EXCEPTION 'issue_4111_unexpected_constraint_shape:%', v_target.constraint_name;
    END IF;
    IF v_def NOT LIKE '%''newsletter''%' THEN
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', v_target.table_name, v_target.constraint_name);
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', v_target.table_name, v_target.constraint_name,
        regexp_replace(v_def, '\]\)\)\)$', ', ''newsletter''::text])))'));
    END IF;
  END LOOP;
END;
$provenance$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Access. One function decides who may read an enquiry conversation.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4111_is_mingla_staff(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_user_id IS NOT NULL AND (
    public.is_support_staff(p_user_id)
    OR EXISTS (
      SELECT 1
      FROM auth.users identity
      JOIN public.admin_users admin_user ON lower(admin_user.email) = lower(identity.email)
      WHERE identity.id = p_user_id AND admin_user.status = 'active'
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_is_mingla_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4111_is_mingla_staff(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4111_enquiry_row_readable(
  p_enquiry public.brand_enquiries,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_user_id IS NOT NULL AND (
    public.issue_4111_is_enquiry_team_member(p_enquiry.brand_id, p_user_id)
    OR p_enquiry.guest_user_id = p_user_id
    OR (
      p_enquiry.reported_at IS NOT NULL
      AND p_enquiry.report_dismissed_at IS NULL
      AND public.issue_4111_is_mingla_staff(p_user_id)
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_enquiry_row_readable(public.brand_enquiries, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4111_enquiry_row_readable(public.brand_enquiries, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4111_enquiry_can_read(
  p_conversation_id uuid,
  p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.brand_enquiries e
    JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    WHERE e.conversation_id = p_conversation_id
      AND public.issue_4111_enquiry_row_readable(e, p_user_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_enquiry_can_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4111_enquiry_can_read(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.brand_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_enquiry_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_enquiry_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_subscribe_pending ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.brand_enquiries, public.brand_enquiry_access_tokens,
  public.brand_enquiry_blocks, public.brand_subscribe_pending
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.brand_enquiries, public.brand_enquiry_access_tokens,
  public.brand_enquiry_blocks, public.brand_subscribe_pending TO service_role;

-- Clients read enquiries (never ip_hash) through RLS; every write is an RPC.
GRANT SELECT (
  id, brand_id, conversation_id, source, origin, entry, context_kind, context_id,
  offering_kind, reason, topic_label, status, guest_user_id, guest_name, guest_email,
  guest_email_confirmed_at, guest_phone_e164, ok_to_call, spam_flag, created_at,
  updated_at, last_guest_at, last_brand_at, resolved_at, resolved_by, reported_at,
  reporter_side, report_reason, report_dismissed_at
) ON public.brand_enquiries TO authenticated;

DROP POLICY IF EXISTS brand_enquiries_read ON public.brand_enquiries;
CREATE POLICY brand_enquiries_read ON public.brand_enquiries
  FOR SELECT TO authenticated
  USING (public.issue_4111_enquiry_row_readable(brand_enquiries, auth.uid()));

DROP POLICY IF EXISTS conversations_brand_enquiry_read ON public.conversations;
CREATE POLICY conversations_brand_enquiry_read ON public.conversations
  FOR SELECT TO authenticated
  USING (linked_entity_type = 'brand_enquiry' AND public.issue_4111_enquiry_can_read(id, auth.uid()));

-- A participant-based legacy policy would let a creator see their own row;
-- enquiry conversations are only ever created by the RPCs.
DROP POLICY IF EXISTS conversations_brand_enquiry_rpc_only ON public.conversations;
CREATE POLICY conversations_brand_enquiry_rpc_only ON public.conversations
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (linked_entity_type IS DISTINCT FROM 'brand_enquiry');

DROP POLICY IF EXISTS messages_brand_enquiry_read ON public.messages;
CREATE POLICY messages_brand_enquiry_read ON public.messages
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.issue_4111_enquiry_can_read(conversation_id, auth.uid()));

-- The legacy "participants may read" policies also apply to the Explorer
-- guest (a participant) — that is intended. These restrictive policies stop
-- every client write path (participant insert, own-message update/delete).
DROP POLICY IF EXISTS messages_brand_enquiry_rpc_only_insert ON public.messages;
CREATE POLICY messages_brand_enquiry_rpc_only_insert ON public.messages
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND c.linked_entity_type = 'brand_enquiry'
  ));
DROP POLICY IF EXISTS messages_brand_enquiry_rpc_only_update ON public.messages;
CREATE POLICY messages_brand_enquiry_rpc_only_update ON public.messages
  AS RESTRICTIVE FOR UPDATE TO public
  USING (NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND c.linked_entity_type = 'brand_enquiry'
  ));
DROP POLICY IF EXISTS messages_brand_enquiry_rpc_only_delete ON public.messages;
CREATE POLICY messages_brand_enquiry_rpc_only_delete ON public.messages
  AS RESTRICTIVE FOR DELETE TO public
  USING (NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND c.linked_entity_type = 'brand_enquiry'
  ));

DROP POLICY IF EXISTS conversation_participants_brand_enquiry_rpc_only ON public.conversation_participants;
CREATE POLICY conversation_participants_brand_enquiry_rpc_only ON public.conversation_participants
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_participants.conversation_id AND c.linked_entity_type = 'brand_enquiry'
  ));

-- Host badges and the Explorer chat list converge without polling.
DO $realtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'brand_enquiries'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.brand_enquiries;
  END IF;
END;
$realtime$;

COMMIT;
