-- Issue #3429 — private Ari attachments, durable turn attempts/activity, and
-- privacy-safe conversation titles.
--
-- This is the only migration owned by #3429. It is intentionally additive and
-- MUST NOT be applied from an implementation worktree. The Edge functions are
-- deployed dark first; migration application is a separately-authorized step.

BEGIN;

-- ---------------------------------------------------------------------------
-- Private bucket. No storage.objects policy is created: authenticated users
-- receive short-lived, path-scoped tokens only after Edge authorization.
-- ---------------------------------------------------------------------------
DO $bucket$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'file_size_limit'
  ) THEN
    INSERT INTO storage.buckets (
      id, name, public, file_size_limit, allowed_mime_types
    ) VALUES (
      'ari-chat-attachments',
      'ari-chat-attachments',
      false,
      10485760,
      ARRAY[
        'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain', 'text/csv', 'application/csv'
      ]::text[]
    )
    ON CONFLICT (id) DO UPDATE
      SET public = false,
          file_size_limit = 10485760,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'public'
  ) THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('ari-chat-attachments', 'ari-chat-attachments', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
  ELSE
    INSERT INTO storage.buckets (id, name)
    VALUES ('ari-chat-attachments', 'ari-chat-attachments')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$bucket$;

-- ---------------------------------------------------------------------------
-- Title authority and safe deterministic taxonomy.
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS title_source text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS title_generation_version text,
  ADD COLUMN IF NOT EXISTS title_generated_at timestamptz;

ALTER TABLE public.agent_conversations
  DROP CONSTRAINT IF EXISTS agent_conversations_title_source_check;
ALTER TABLE public.agent_conversations
  ADD CONSTRAINT agent_conversations_title_source_check CHECK (
    title_source IN (
      'legacy', 'provisional', 'generated', 'manual', 'legacy_fallback'
    )
  );

ALTER TABLE public.agent_conversations
  DROP CONSTRAINT IF EXISTS agent_conversations_title_trimmed_length;
DO $title_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.agent_conversations
    WHERE title IS NOT NULL
      AND btrim(title) <> ''
      AND lower(btrim(title)) <> 'untitled conversation'
      AND (title <> btrim(title) OR char_length(title) > 60)
  ) THEN
    RAISE EXCEPTION
      'Issue #3429: meaningful legacy titles must be normalized explicitly before migration apply.';
  END IF;
END
$title_preflight$;
UPDATE public.agent_conversations
SET title = NULL
WHERE title IS NULL OR btrim(title) = ''
  OR lower(btrim(title)) = 'untitled conversation';
ALTER TABLE public.agent_conversations
  ADD CONSTRAINT agent_conversations_title_trimmed_length CHECK (
    title IS NULL OR (
      title = btrim(title)
      AND char_length(title) BETWEEN 1 AND 60
    )
  );

-- Clients may no longer write title/source independently. All title mutation
-- goes through agent-conversation, whose service client applies the rules.
REVOKE UPDATE ON TABLE public.agent_conversations FROM authenticated;
GRANT UPDATE (
  summary,
  summary_through_message_id,
  summary_updated_at,
  updated_at
) ON TABLE public.agent_conversations TO authenticated;

CREATE OR REPLACE FUNCTION public.agent_safe_provisional_title(
  p_text text,
  p_attachment_types text[] DEFAULT ARRAY[]::text[]
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_text text := lower(COALESCE(p_text, ''));
  v_count integer := COALESCE(cardinality(p_attachment_types), 0);
  v_title text;
BEGIN
  -- Fixed allowlisted output only: no user names, filenames, contact data,
  -- brand names, prices, or arbitrary text can enter conversation history.
  IF btrim(v_text) = '' THEN
    IF v_count = 1 AND COALESCE(p_attachment_types[1], '') = 'image' THEN
      RETURN 'Review attached image';
    ELSIF v_count = 1 THEN
      RETURN 'Review attached document';
    ELSIF v_count > 1 THEN
      RETURN format('Review %s attached files', LEAST(v_count, 5));
    END IF;
    RETURN 'Plan with Ari';
  END IF;

  v_title := CASE
    WHEN v_text ~ '\m(create|plan|schedule|launch)\M.*\m(event|party|show|class|experience|trip)\M'
      THEN 'Plan an event with Ari'
    WHEN v_text ~ '\m(event|events|ticket|tickets|guest|guests|rsvp)\M'
      THEN 'Review event operations'
    WHEN v_text ~ '\m(website|site|web page|landing page)\M'
      THEN 'Update the business website'
    WHEN v_text ~ '\m(marketing|campaign|promotion|promote|social)\M'
      THEN 'Plan a marketing campaign'
    WHEN v_text ~ '\m(payment|payout|refund|revenue|sales|order)\M'
      THEN 'Review business payments'
    WHEN v_text ~ '\m(team|member|staff|people|role)\M'
      THEN 'Manage the business team'
    WHEN v_text ~ '\m(brand|profile|business details|business profile)\M'
      THEN 'Update the business profile'
    WHEN v_text ~ '\m(analytics|performance|results|insights|report)\M'
      THEN 'Review business performance'
    WHEN v_text ~ '\m(restaurant|venue|reservation|table|menu)\M'
      THEN 'Manage venue operations'
    WHEN v_text ~ '\m(stay|room|booking|availability)\M'
      THEN 'Manage stay operations'
    ELSE 'Plan with Ari'
  END;

  IF v_text ~ '\mtoday\M' THEN
    v_title := left(v_title || ' today', 48);
  ELSIF v_text ~ '\mthis week\M' THEN
    v_title := left(v_title || ' this week', 48);
  END IF;
  RETURN v_title;
END;
$function$;

REVOKE ALL ON FUNCTION public.agent_safe_provisional_title(text, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_safe_provisional_title(text, text[])
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Durable private attachment, logical turn, event, and cleanup authority.
-- ---------------------------------------------------------------------------
CREATE TABLE public.agent_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.agent_messages(id) ON DELETE CASCADE,
  client_turn_id uuid,
  storage_path text NOT NULL,
  derived_storage_path text,
  original_filename text NOT NULL,
  declared_mime text NOT NULL,
  verified_mime text,
  file_type text NOT NULL CHECK (file_type IN ('image', 'pdf', 'docx', 'text', 'csv')),
  declared_size_bytes bigint NOT NULL CHECK (declared_size_bytes BETWEEN 1 AND 10485760),
  verified_size_bytes bigint CHECK (verified_size_bytes BETWEEN 1 AND 10485760),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  derived_size_bytes bigint CHECK (derived_size_bytes IS NULL OR derived_size_bytes BETWEEN 1 AND 20971520),
  derived_sha256 text CHECK (derived_sha256 IS NULL OR derived_sha256 ~ '^[0-9a-f]{64}$'),
  display_order smallint NOT NULL CHECK (display_order BETWEEN 0 AND 4),
  state text NOT NULL DEFAULT 'prepared' CHECK (
    state IN ('prepared', 'uploaded', 'processing', 'ready', 'failed', 'discarded')
  ),
  failure_code text,
  processing_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(processing_metadata) = 'object'
  ),
  -- REWORK-1 processing lease: one finalize owns a row at a time, every
  -- terminal write is conditional on this token, and a row may be claimed at
  -- most twice before it is terminally refused.
  processing_token uuid,
  processing_started_at timestamptz,
  processing_attempts smallint NOT NULL DEFAULT 0 CHECK (processing_attempts BETWEEN 0 AND 2),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  discarded_at timestamptz,
  CONSTRAINT agent_attachments_storage_path_opaque CHECK (
    storage_path = user_id::text || '/' || brand_id::text || '/' || id::text || '/source'
  ),
  CONSTRAINT agent_attachments_processing_lease CHECK (
    state <> 'processing' OR (processing_token IS NOT NULL AND processing_started_at IS NOT NULL)
  ),
  CONSTRAINT agent_attachments_derived_path_opaque CHECK (
    derived_storage_path IS NULL OR
    derived_storage_path = user_id::text || '/' || brand_id::text || '/' || id::text || '/derived'
  ),
  CONSTRAINT agent_attachments_binding_all_or_none CHECK (
    (conversation_id IS NULL AND message_id IS NULL AND client_turn_id IS NULL)
    OR
    (conversation_id IS NOT NULL AND message_id IS NOT NULL AND client_turn_id IS NOT NULL AND state = 'ready')
  ),
  CONSTRAINT agent_attachments_ready_verified CHECK (
    state <> 'ready' OR (
      verified_mime IS NOT NULL AND verified_size_bytes IS NOT NULL
      AND sha256 IS NOT NULL AND ready_at IS NOT NULL
      AND (
        (derived_storage_path IS NULL AND derived_size_bytes IS NULL AND derived_sha256 IS NULL)
        OR
        (derived_storage_path IS NOT NULL AND derived_size_bytes IS NOT NULL AND derived_sha256 IS NOT NULL)
      )
    )
  )
);

CREATE UNIQUE INDEX uq_agent_attachments_storage_path
  ON public.agent_attachments(storage_path);
CREATE UNIQUE INDEX uq_agent_attachments_bound_order
  ON public.agent_attachments(message_id, display_order)
  WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX uq_agent_attachments_ready_digest_per_turn
  ON public.agent_attachments(user_id, client_turn_id, sha256)
  WHERE client_turn_id IS NOT NULL AND sha256 IS NOT NULL;
CREATE INDEX idx_agent_attachments_owner_conversation
  ON public.agent_attachments(user_id, conversation_id, created_at);
CREATE INDEX idx_agent_attachments_abandoned
  ON public.agent_attachments(expires_at, state)
  WHERE state IN ('prepared', 'uploaded', 'processing');

CREATE TABLE public.agent_turn_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  user_message_id uuid NOT NULL REFERENCES public.agent_messages(id) ON DELETE CASCADE,
  client_turn_id uuid NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  status text NOT NULL DEFAULT 'accepted' CHECK (
    status IN (
      'accepted', 'running', 'cancelling', 'stopped', 'completed', 'failed',
      'reconciliation_required'
    )
  ),
  error_code text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  terminal_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, client_turn_id)
);

CREATE INDEX idx_agent_turn_attempts_conversation_updated
  ON public.agent_turn_attempts(conversation_id, updated_at DESC);
CREATE INDEX idx_agent_turn_attempts_active
  ON public.agent_turn_attempts(status, updated_at)
  WHERE status IN ('accepted', 'running', 'cancelling', 'reconciliation_required');

-- A short-lived claim guard closes the only gap before a durable attempt row
-- exists. Stop sending can win this row first, or wait for an in-flight claim
-- and then stop the attempt that the claim committed.
CREATE TABLE public.agent_turn_claim_guards (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_turn_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('claiming', 'cancelled')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, client_turn_id)
);

CREATE INDEX idx_agent_turn_claim_guards_expiry
  ON public.agent_turn_claim_guards(expires_at);

CREATE TABLE public.agent_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.agent_turn_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  client_turn_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  sequence integer NOT NULL CHECK (sequence >= 1),
  event_type text NOT NULL CHECK (
    event_type IN (
      'accepted', 'attachments_processing_started', 'model_started',
      'workspace_read_started', 'approved_action_started',
      'automated_retry_started', 'finalizing_started', 'response_ready',
      'reconciliation_started', 'reconciliation_finished', 'stopped', 'failed'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  UNIQUE(attempt_id, attempt_number, sequence)
);

CREATE INDEX idx_agent_activity_events_owner_conversation
  ON public.agent_activity_events(user_id, conversation_id, created_at);
CREATE INDEX idx_agent_activity_events_expiry
  ON public.agent_activity_events(expires_at);

CREATE TABLE public.agent_attachment_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 25),
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error_digest text CHECK (
    last_error_digest IS NULL OR last_error_digest ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(storage_path)
);

CREATE INDEX idx_agent_attachment_cleanup_jobs_ready
  ON public.agent_attachment_cleanup_jobs(run_after, created_at)
  WHERE completed_at IS NULL;

ALTER TABLE public.agent_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_turn_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_turn_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_turn_claim_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_turn_claim_guards FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_activity_events FORCE ROW LEVEL SECURITY;

DO $publication$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agent_activity_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_activity_events;
  END IF;
END
$publication$;
ALTER TABLE public.agent_attachment_cleanup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_attachment_cleanup_jobs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_attachments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agent_turn_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agent_turn_claim_guards FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agent_activity_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agent_attachment_cleanup_jobs FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.agent_attachments TO authenticated;
GRANT SELECT ON TABLE public.agent_turn_attempts TO authenticated;
GRANT SELECT ON TABLE public.agent_activity_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_attachments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_turn_attempts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_turn_claim_guards TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_activity_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_attachment_cleanup_jobs TO service_role;

CREATE POLICY agent_attachments_owner_select
  ON public.agent_attachments FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY agent_turn_attempts_owner_select
  ON public.agent_turn_attempts FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY agent_activity_events_owner_select
  ON public.agent_activity_events FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- Append-only activity writer. Event sequence is serialized on the attempt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.append_agent_activity_event(
  p_attempt_id uuid,
  p_user_id uuid,
  p_attempt_number integer,
  p_event_type text,
  p_now timestamptz DEFAULT now()
)
RETURNS public.agent_activity_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.agent_turn_attempts%ROWTYPE;
  v_sequence integer;
  v_event public.agent_activity_events%ROWTYPE;
BEGIN
  IF p_event_type NOT IN (
    'accepted', 'attachments_processing_started', 'model_started',
    'workspace_read_started', 'approved_action_started',
    'automated_retry_started', 'finalizing_started', 'response_ready',
    'reconciliation_started', 'reconciliation_finished', 'stopped', 'failed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported activity event';
  END IF;

  SELECT * INTO v_attempt
  FROM public.agent_turn_attempts
  WHERE id = p_attempt_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.attempt_number <> p_attempt_number THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'attempt authority denied';
  END IF;

  SELECT COALESCE(max(event.sequence), 0) + 1 INTO v_sequence
  FROM public.agent_activity_events event
  WHERE event.attempt_id = p_attempt_id
    AND event.attempt_number = p_attempt_number;

  INSERT INTO public.agent_activity_events(
    attempt_id, user_id, conversation_id, client_turn_id,
    attempt_number, sequence, event_type, created_at, expires_at
  ) VALUES (
    v_attempt.id, v_attempt.user_id, v_attempt.conversation_id,
    v_attempt.client_turn_id, p_attempt_number, v_sequence, p_event_type,
    p_now, p_now + interval '7 days'
  ) RETURNING * INTO v_event;
  RETURN v_event;
END;
$function$;

REVOKE ALL ON FUNCTION public.append_agent_activity_event(
  uuid, uuid, integer, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_agent_activity_event(
  uuid, uuid, integer, text, timestamptz
) TO service_role;

-- ---------------------------------------------------------------------------
-- Atomic logical-turn claim. Same client_turn_id can only recover the exact
-- request/manifest. Files are bound only once and only while Ready.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_agent_chat_turn(
  p_user_id uuid,
  p_conversation_id uuid,
  p_brand_id uuid,
  p_client_turn_id uuid,
  p_content jsonb,
  p_attachment_ids uuid[],
  p_request_digest text,
  p_manifest_digest text,
  p_prompt_version text,
  p_model_version text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  conversation_id uuid,
  message_id uuid,
  attempt_id uuid,
  attempt_number integer,
  created boolean,
  title text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_conversation public.agent_conversations%ROWTYPE;
  v_message_id uuid;
  v_attempt public.agent_turn_attempts%ROWTYPE;
  v_ids uuid[] := COALESCE(p_attachment_ids, ARRAY[]::uuid[]);
  v_count integer := COALESCE(cardinality(p_attachment_ids), 0);
  v_ready_count integer;
  v_bound_count integer;
  v_total_bytes bigint;
  v_types text[];
  v_title text;
  v_claim_state text;
BEGIN
  IF p_user_id IS NULL OR p_client_turn_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'user and client turn required';
  END IF;
  IF p_request_digest !~ '^[0-9a-f]{64}$' OR p_manifest_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'canonical digests required';
  END IF;
  IF v_count > 5 OR v_count <> COALESCE((SELECT count(DISTINCT id) FROM unnest(v_ids) id), 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'attachment manifest invalid';
  END IF;
  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.brands brand
    WHERE brand.id = p_brand_id
      AND brand.deleted_at IS NULL
      AND (
        brand.account_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM public.brand_team_members member
          WHERE member.brand_id = brand.id
            AND member.user_id = p_user_id
            AND member.accepted_at IS NOT NULL
            AND member.removed_at IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'brand access denied';
  END IF;

  SELECT * INTO v_attempt
  FROM public.agent_turn_attempts turn_attempt
  WHERE turn_attempt.user_id = p_user_id
    AND turn_attempt.client_turn_id = p_client_turn_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_digest <> p_request_digest
      OR v_attempt.manifest_digest <> p_manifest_digest
      OR v_attempt.brand_id IS DISTINCT FROM p_brand_id
      OR (p_conversation_id IS NOT NULL AND v_attempt.conversation_id <> p_conversation_id)
    THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'client turn payload mismatch';
    END IF;
    SELECT convo.title INTO v_title
    FROM public.agent_conversations convo WHERE convo.id = v_attempt.conversation_id;
    RETURN QUERY SELECT v_attempt.conversation_id, v_attempt.user_message_id,
      v_attempt.id, v_attempt.attempt_number, false, v_title;
    RETURN;
  END IF;

  INSERT INTO public.agent_turn_claim_guards(
    user_id, client_turn_id, state, expires_at, created_at, updated_at
  ) VALUES (
    p_user_id, p_client_turn_id, 'claiming', p_now + interval '24 hours', p_now, p_now
  ) ON CONFLICT (user_id, client_turn_id) DO NOTHING;

  SELECT claim_guard.state INTO v_claim_state
  FROM public.agent_turn_claim_guards claim_guard
  WHERE claim_guard.user_id = p_user_id
    AND claim_guard.client_turn_id = p_client_turn_id
  FOR UPDATE;
  IF v_claim_state = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = '57014', MESSAGE = 'turn stopped before acceptance';
  END IF;

  IF p_conversation_id IS NULL THEN
    SELECT public.agent_safe_provisional_title(
      COALESCE(p_content->>'text', ''),
      ARRAY(
        SELECT attachment.file_type
        FROM public.agent_attachments attachment
        WHERE attachment.id = ANY(v_ids)
        ORDER BY array_position(v_ids, attachment.id)
      )
    ) INTO v_title;
    INSERT INTO public.agent_conversations(
      user_id, brand_id, title, title_source, title_generation_version,
      title_generated_at, created_at, updated_at
    ) VALUES (
      p_user_id, p_brand_id, v_title, 'provisional', 'safe-taxonomy-v1',
      p_now, p_now, p_now
    ) RETURNING * INTO v_conversation;
  ELSE
    SELECT * INTO v_conversation
    FROM public.agent_conversations convo
    WHERE convo.id = p_conversation_id AND convo.user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND OR v_conversation.brand_id IS DISTINCT FROM p_brand_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'conversation scope denied';
    END IF;
    v_title := v_conversation.title;
  END IF;

  IF v_count > 0 THEN
    SELECT count(*), COALESCE(sum(attachment.verified_size_bytes), 0),
      array_agg(attachment.file_type ORDER BY array_position(v_ids, attachment.id))
    INTO v_ready_count, v_total_bytes, v_types
    FROM public.agent_attachments attachment
    WHERE attachment.id = ANY(v_ids)
      AND attachment.user_id = p_user_id
      AND attachment.brand_id = p_brand_id
      AND attachment.state = 'ready'
      AND attachment.conversation_id IS NULL
      AND attachment.message_id IS NULL
      AND attachment.client_turn_id IS NULL
      AND attachment.verified_size_bytes BETWEEN 1 AND 10485760;
    IF v_ready_count <> v_count OR v_total_bytes > 26214400 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'attachments are not ready or exceed limits';
    END IF;
  END IF;

  v_message_id := gen_random_uuid();
  INSERT INTO public.agent_messages(
    id, conversation_id, user_id, role, content, client_turn_id,
    prompt_version, model_version, created_at
  ) VALUES (
    v_message_id, v_conversation.id, p_user_id, 'user',
    p_content || jsonb_build_object('attachment_ids', to_jsonb(v_ids)),
    p_client_turn_id, p_prompt_version, p_model_version, p_now
  );

  IF v_count > 0 THEN
    UPDATE public.agent_attachments attachment
    SET conversation_id = v_conversation.id,
        message_id = v_message_id,
        client_turn_id = p_client_turn_id,
        display_order = array_position(v_ids, attachment.id) - 1,
        expires_at = p_now + interval '30 days',
        updated_at = p_now
    WHERE attachment.id = ANY(v_ids)
      AND attachment.user_id = p_user_id
      AND attachment.brand_id = p_brand_id
      AND attachment.state = 'ready'
      AND attachment.conversation_id IS NULL
      AND attachment.message_id IS NULL
      AND attachment.client_turn_id IS NULL;
    GET DIAGNOSTICS v_bound_count = ROW_COUNT;
    IF v_bound_count <> v_count THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'attachment bind lost';
    END IF;
  END IF;

  INSERT INTO public.agent_turn_attempts(
    user_id, brand_id, conversation_id, user_message_id, client_turn_id,
    request_digest, manifest_digest, attempt_number, status,
    accepted_at, updated_at
  ) VALUES (
    p_user_id, p_brand_id, v_conversation.id, v_message_id, p_client_turn_id,
    p_request_digest, p_manifest_digest, 1, 'accepted', p_now, p_now
  ) RETURNING * INTO v_attempt;

  PERFORM public.append_agent_activity_event(
    v_attempt.id, p_user_id, v_attempt.attempt_number, 'accepted', p_now
  );

  RETURN QUERY SELECT v_conversation.id, v_message_id, v_attempt.id,
    v_attempt.attempt_number, true, v_conversation.title;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_agent_chat_turn(
  uuid, uuid, uuid, uuid, jsonb, uuid[], text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agent_chat_turn(
  uuid, uuid, uuid, uuid, jsonb, uuid[], text, text, text, text, timestamptz
) TO service_role;

-- Current-attempt-only assistant/task commit. The row lock makes cancellation,
-- retry supersession, task-state CAS, assistant insert, and completion one
-- transaction, so a stopped attempt cannot publish a late result.
CREATE OR REPLACE FUNCTION public.commit_agent_chat_assistant_turn(
  p_attempt_id uuid,
  p_attempt_number integer,
  p_user_id uuid,
  p_conversation_id uuid,
  p_expected_revision bigint,
  p_task_state jsonb,
  p_summary text,
  p_assistant_message_id uuid,
  p_content jsonb,
  p_tool_calls jsonb,
  p_client_turn_id uuid,
  p_prompt_version text,
  p_model_version text,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.agent_turn_attempts%ROWTYPE;
  v_updated integer;
BEGIN
  SELECT * INTO v_attempt
  FROM public.agent_turn_attempts turn_attempt
  WHERE turn_attempt.id = p_attempt_id
    AND turn_attempt.user_id = p_user_id
    AND turn_attempt.conversation_id = p_conversation_id
    AND turn_attempt.client_turn_id = p_client_turn_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.attempt_number <> p_attempt_number
    OR v_attempt.status <> 'running'
  THEN
    RETURN false;
  END IF;

  UPDATE public.agent_conversations
  SET task_state = p_task_state,
      task_state_revision = p_expected_revision + 1,
      task_state_updated_at = p_now,
      updated_at = p_now,
      summary = p_summary,
      summary_through_message_id = p_assistant_message_id,
      summary_updated_at = p_now,
      title_source = CASE WHEN title_source = 'provisional' THEN 'generated' ELSE title_source END,
      title_generation_version = CASE WHEN title_source = 'provisional' THEN 'safe-taxonomy-v1' ELSE title_generation_version END,
      title_generated_at = CASE WHEN title_source = 'provisional' THEN p_now ELSE title_generated_at END
  WHERE id = p_conversation_id
    AND user_id = p_user_id
    AND task_state_revision = p_expected_revision;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RETURN false; END IF;

  INSERT INTO public.agent_messages(
    id, conversation_id, user_id, role, content, tool_calls,
    client_turn_id, prompt_version, model_version, created_at
  ) VALUES (
    p_assistant_message_id, p_conversation_id, p_user_id, 'assistant',
    p_content, p_tool_calls, p_client_turn_id, p_prompt_version,
    p_model_version, p_now
  );

  UPDATE public.agent_turn_attempts
  SET status = 'completed', terminal_at = p_now, updated_at = p_now
  WHERE id = p_attempt_id;
  PERFORM public.append_agent_activity_event(
    p_attempt_id, p_user_id, p_attempt_number, 'response_ready', p_now
  );
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_agent_chat_assistant_turn(
  uuid, integer, uuid, uuid, bigint, jsonb, text, uuid, jsonb, jsonb,
  uuid, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_agent_chat_assistant_turn(
  uuid, integer, uuid, uuid, bigint, jsonb, text, uuid, jsonb, jsonb,
  uuid, text, text, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.append_agent_chat_tool_result(
  p_attempt_id uuid,
  p_attempt_number integer,
  p_user_id uuid,
  p_conversation_id uuid,
  p_client_turn_id uuid,
  p_tool_results jsonb,
  p_prompt_version text,
  p_model_version text,
  p_now timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.agent_turn_attempts%ROWTYPE;
  v_message_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO v_attempt
  FROM public.agent_turn_attempts turn_attempt
  WHERE turn_attempt.id = p_attempt_id
    AND turn_attempt.user_id = p_user_id
    AND turn_attempt.conversation_id = p_conversation_id
    AND turn_attempt.client_turn_id = p_client_turn_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.attempt_number <> p_attempt_number
    OR v_attempt.status <> 'running'
  THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.agent_messages(
    id, conversation_id, user_id, role, content, tool_results,
    client_turn_id, prompt_version, model_version, created_at
  ) VALUES (
    v_message_id, p_conversation_id, p_user_id, 'tool', '{"text":""}'::jsonb,
    p_tool_results, p_client_turn_id, p_prompt_version, p_model_version, p_now
  );
  RETURN v_message_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.append_agent_chat_tool_result(
  uuid, integer, uuid, uuid, uuid, jsonb, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_agent_chat_tool_result(
  uuid, integer, uuid, uuid, uuid, jsonb, text, text, timestamptz
) TO service_role;

-- Queue both original and derived objects before attachment metadata disappears.
CREATE OR REPLACE FUNCTION public.queue_agent_attachment_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.agent_attachment_cleanup_jobs(storage_path)
  VALUES (OLD.storage_path)
  ON CONFLICT (storage_path) DO UPDATE
    SET completed_at = NULL, run_after = now(), updated_at = now();
  IF OLD.derived_storage_path IS NOT NULL THEN
    INSERT INTO public.agent_attachment_cleanup_jobs(storage_path)
    VALUES (OLD.derived_storage_path)
    ON CONFLICT (storage_path) DO UPDATE
      SET completed_at = NULL, run_after = now(), updated_at = now();
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.queue_agent_attachment_cleanup()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_agent_attachment_cleanup()
  TO service_role;

CREATE TRIGGER queue_agent_attachment_cleanup_before_delete
BEFORE DELETE ON public.agent_attachments
FOR EACH ROW EXECUTE FUNCTION public.queue_agent_attachment_cleanup();

-- ---------------------------------------------------------------------------
-- Privacy-safe backfill. Earliest user text is classified into fixed output;
-- filenames and assistant/provider content are never inputs.
-- ---------------------------------------------------------------------------
WITH repairable AS (
  SELECT conversation.id,
    (
      SELECT COALESCE(message.content->>'text', '')
      FROM public.agent_messages message
      WHERE message.conversation_id = conversation.id AND message.role = 'user'
      ORDER BY message.created_at, message.id
      LIMIT 1
    ) AS first_text,
    (
      SELECT array_agg(attachment.file_type ORDER BY attachment.display_order)
      FROM public.agent_attachments attachment
      WHERE attachment.conversation_id = conversation.id
    ) AS attachment_types,
    EXISTS (
      SELECT 1 FROM public.agent_messages message
      WHERE message.conversation_id = conversation.id AND message.role = 'user'
    ) AS has_user_turn
  FROM public.agent_conversations conversation
  WHERE conversation.title IS NULL
    OR btrim(conversation.title) = ''
    OR lower(btrim(conversation.title)) = 'untitled conversation'
)
UPDATE public.agent_conversations conversation
SET title = CASE WHEN repairable.has_user_turn
      THEN public.agent_safe_provisional_title(
        repairable.first_text, COALESCE(repairable.attachment_types, ARRAY[]::text[])
      )
      ELSE 'Conversation' END,
    title_source = CASE WHEN repairable.has_user_turn
      THEN 'provisional' ELSE 'legacy_fallback' END,
    title_generation_version = 'safe-taxonomy-v1',
    title_generated_at = now()
FROM repairable
WHERE conversation.id = repairable.id;

-- ---------------------------------------------------------------------------
-- Cleanup cron advisories and hourly worker trigger.
--
-- Issue #3429 REWORK-1 (orchestrator decision #issuecomment-5712808665): a
-- migration may ADVISE, but never RAISE, on missing Vault secrets or the
-- pg_net extension. Dozens of CI lanes replay the full migration chain on a
-- Vault-less database; an exception here would turn every one of them red.
-- Fail-closed enforcement lives in the release runbook step "apply #3429
-- migration": a read-only pre-apply check that both Vault secrets and both
-- extensions exist, and a post-apply check that the cleanup job is scheduled.
-- House precedent: ORCH-0788, ORCH-0815-B, #1397.
-- ---------------------------------------------------------------------------
DO $advisory$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Issue #3429 advisory: pg_cron extension is not installed; the attachment cleanup job cannot run until it is.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Issue #3429 advisory: pg_net extension is not installed; the attachment cleanup job cannot call its worker until it is.';
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'Issue #3429 advisory: Vault decrypted_secrets is unavailable; the attachment cleanup job cannot authenticate until it is.';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
      RAISE NOTICE 'Issue #3429 advisory: Vault secret supabase_url is missing; the attachment cleanup job cannot reach its worker until it exists.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
      RAISE NOTICE 'Issue #3429 advisory: Vault secret service_role_key is missing; the attachment cleanup job cannot authenticate until it exists.';
    END IF;
  END IF;
END
$advisory$;

DO $cron_replace$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'issue_3429_ari_attachment_cleanup'
  ) THEN
    PERFORM cron.unschedule('issue_3429_ari_attachment_cleanup');
  END IF;
END
$cron_replace$;

SELECT cron.schedule(
  'issue_3429_ari_attachment_cleanup',
  '17 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'supabase_url' LIMIT 1
      ) || '/functions/v1/agent-attachment-cleanup',
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

COMMENT ON TABLE public.agent_attachments IS
  'Issue #3429: private, tenant-bound Ari attachment lifecycle. Client access is SELECT-only; mutations are Edge-authorized.';
COMMENT ON TABLE public.agent_turn_attempts IS
  'Issue #3429: one durable logical Ari turn per user/client_turn_id with monotonic retry/cancellation authority.';
COMMENT ON TABLE public.agent_activity_events IS
  'Issue #3429: append-only, non-sensitive activity facts that alone authorize named Ari activity UI states.';
COMMENT ON TABLE public.agent_attachment_cleanup_jobs IS
  'Issue #3429: service-only opaque private-object deletion queue; filenames are prohibited.';

COMMIT;
