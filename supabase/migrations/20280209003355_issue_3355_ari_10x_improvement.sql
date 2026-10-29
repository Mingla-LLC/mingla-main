-- Issue #3355 — Ari 10x + Training & Improvement control plane.
--
-- This migration is deliberately disabled by default. It adds the durable
-- primitives needed by the local-first implementation without changing the
-- behaviour of the currently shipped Ari until the governed flags are enabled.
--
-- Invariants enforced here:
-- I-3355-ARI-TRAINING-SURVIVES-CHAT-DELETE | A user-visible chat deletion
-- removes the live conversation and severs every source identity/link while a
-- separately sanitised training turn and quality case remain available to the
-- admin improvement system.
-- I-3355-ARI-QUALITY-ADMIN-ONLY | Training turns, quality cases, evaluations,
-- versions and rollout controls have no direct authenticated-table access;
-- reads and writes are guard-first admin RPCs or service-role runtime writes.
-- I-3355-ARI-PLAN-CAS | Per-brand onboarding plans advance only through an
-- expected-revision compare-and-swap and remain tenant scoped.

BEGIN;

INSERT INTO public.feature_flags(flag_key, is_enabled, description)
VALUES
  ('ari_agent_loop_v2', false, '#3355 bounded multi-step Ari loop and continuation'),
  ('ari_browser_research_v1', false, '#3355 allowlisted browser and research tools'),
  ('ari_improvement_lab_v1', false, '#3355 Ari training and improvement control plane')
ON CONFLICT (flag_key) DO NOTHING;

-- #3355 expands the already-private Ari context bucket to voice notes and
-- short videos. The same 10 MB per-file and 25 MB per-turn limits remain; no
-- public policy is added and Edge verifies the container signature before the
-- bytes cross the model boundary.
DO $ari_media_bucket$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'allowed_mime_types'
  ) THEN
    UPDATE storage.buckets
    SET allowed_mime_types = ARRAY[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'text/csv', 'application/csv',
      'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/webm',
      'video/mp4', 'video/quicktime', 'video/webm'
    ]::text[]
    WHERE id = 'ari-chat-attachments';
  END IF;
END
$ari_media_bucket$;

-- The original attachment table constrains `file_type` separately from the
-- storage bucket. Expanding only `allowed_mime_types` makes the picker promise
-- voice/video support while every prepare insert fails. Keep both authorities
-- in lockstep so a supported media file can enter the private lifecycle.
ALTER TABLE public.agent_attachments
  DROP CONSTRAINT IF EXISTS agent_attachments_file_type_check;
ALTER TABLE public.agent_attachments
  ADD CONSTRAINT agent_attachments_file_type_check CHECK (
    file_type IN ('image', 'pdf', 'docx', 'text', 'csv', 'audio', 'video')
  );

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS auto_turns_since_user integer NOT NULL DEFAULT 0
    CHECK (auto_turns_since_user BETWEEN 0 AND 8),
  ADD COLUMN IF NOT EXISTS continuation_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS continuation_pending_action_id uuid;

ALTER TABLE public.agent_activity_events
  DROP CONSTRAINT IF EXISTS agent_activity_events_event_type_check;
ALTER TABLE public.agent_activity_events
  ADD CONSTRAINT agent_activity_events_event_type_check CHECK (
    event_type IN (
      'accepted', 'attachments_processing_started', 'model_started',
      'planning_started', 'research_started', 'verification_started',
      'workspace_read_started', 'approved_action_started',
      'automated_retry_started', 'finalizing_started', 'response_ready',
      'reconciliation_started', 'reconciliation_finished', 'stopped', 'failed'
    )
  );

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
    'planning_started', 'research_started', 'verification_started',
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

CREATE TABLE IF NOT EXISTS public.ari_onboarding_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'self_serve'
    CHECK (mode IN ('self_serve', 'operator_client')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  current_step text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(state) = 'object'),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ari_onboarding_plans_active_brand
  ON public.ari_onboarding_plans(user_id, brand_id)
  WHERE brand_id IS NOT NULL AND status IN ('active', 'paused');
CREATE UNIQUE INDEX IF NOT EXISTS ari_onboarding_plans_active_unbound
  ON public.ari_onboarding_plans(user_id)
  WHERE brand_id IS NULL AND status IN ('active', 'paused');
CREATE INDEX IF NOT EXISTS ari_onboarding_plans_user_updated
  ON public.ari_onboarding_plans(user_id, updated_at DESC);

ALTER TABLE public.ari_onboarding_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_onboarding_plans FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ari_onboarding_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ari_onboarding_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ari_onboarding_plans TO service_role;
DROP POLICY IF EXISTS ari_onboarding_plans_owner_read ON public.ari_onboarding_plans;
CREATE POLICY ari_onboarding_plans_owner_read
  ON public.ari_onboarding_plans FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.ari_agent_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  idempotency_key uuid NOT NULL,
  goal_summary text NOT NULL CHECK (char_length(btrim(goal_summary)) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'paused', 'awaiting_approval', 'completed', 'failed', 'cancelled'
  )),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checkpoint) = 'object'),
  completed_step_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  pending_step_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  last_error_code text,
  budget jsonb NOT NULL DEFAULT '{"max_steps":24,"max_browser_reads":12,"max_retries":3,"max_wall_minutes":30}'::jsonb
    CHECK (jsonb_typeof(budget) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  lease_owner uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ari_agent_jobs_user_status
  ON public.ari_agent_jobs(user_id, status, updated_at DESC);
ALTER TABLE public.ari_agent_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_agent_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ari_agent_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ari_agent_jobs TO service_role;

CREATE TABLE IF NOT EXISTS public.ari_memory_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('preference', 'correction', 'business_fact', 'workflow')),
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 1200),
  evidence_message_id uuid REFERENCES public.agent_messages(id) ON DELETE SET NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ari_memory_notes_scope
  ON public.ari_memory_notes(user_id, brand_id, active, updated_at DESC);
ALTER TABLE public.ari_memory_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_memory_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ari_memory_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ari_memory_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ari_memory_notes TO service_role;
DROP POLICY IF EXISTS ari_memory_notes_owner_read ON public.ari_memory_notes;
CREATE POLICY ari_memory_notes_owner_read
  ON public.ari_memory_notes FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.ari_message_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  assistant_message_id uuid NOT NULL REFERENCES public.agent_messages(id) ON DELETE CASCADE,
  sentiment text NOT NULL CHECK (sentiment IN ('positive', 'negative')),
  reason_code text CHECK (reason_code IS NULL OR reason_code IN (
    'inaccurate', 'missed_request', 'hard_to_use', 'unsafe', 'other'
  )),
  sanitized_comment text NOT NULL DEFAULT '' CHECK (char_length(sanitized_comment) <= 1200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, assistant_message_id)
);
CREATE INDEX IF NOT EXISTS ari_message_feedback_conversation
  ON public.ari_message_feedback(conversation_id, updated_at DESC);
ALTER TABLE public.ari_message_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_message_feedback FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ari_message_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ari_message_feedback TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ari_message_feedback TO service_role;
DROP POLICY IF EXISTS ari_message_feedback_owner_read ON public.ari_message_feedback;
CREATE POLICY ari_message_feedback_owner_read
  ON public.ari_message_feedback FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- The independent improvement archive. `sanitized_*` is the only transcript
-- material stored here; raw messages remain in agent_messages and disappear
-- with the user's conversation. Source links exist only while the chat exists.
CREATE TABLE IF NOT EXISTS public.ari_training_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable, pseudonymous grouping for the training archive. This deliberately
  -- has no foreign key: deleting the user's conversation severs every
  -- reversible source link while keeping sanitized turns grouped for review.
  archive_conversation_key uuid NOT NULL,
  source_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  source_user_message_id uuid REFERENCES public.agent_messages(id) ON DELETE SET NULL,
  source_assistant_message_id uuid REFERENCES public.agent_messages(id) ON DELETE SET NULL,
  sanitized_user_text text NOT NULL DEFAULT '',
  sanitized_assistant_text text NOT NULL DEFAULT '',
  sanitized_tool_trace jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(sanitized_tool_trace) = 'array'),
  prompt_version text,
  model_version text,
  capability_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  signal_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  estimated_cost_micros bigint CHECK (estimated_cost_micros IS NULL OR estimated_cost_micros >= 0),
  source_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Keep repeated local migration runs forward-compatible while this initiative
-- is still unshipped and the schema is being exercised across full replays.
ALTER TABLE public.ari_training_turns
  ADD COLUMN IF NOT EXISTS archive_conversation_key uuid;
UPDATE public.ari_training_turns
SET archive_conversation_key = COALESCE(source_conversation_id, id)
WHERE archive_conversation_key IS NULL;
ALTER TABLE public.ari_training_turns
  ALTER COLUMN archive_conversation_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS ari_training_turns_created
  ON public.ari_training_turns(created_at DESC);
CREATE INDEX IF NOT EXISTS ari_training_turns_archive_thread
  ON public.ari_training_turns(archive_conversation_key, created_at);
CREATE INDEX IF NOT EXISTS ari_training_turns_signals
  ON public.ari_training_turns USING gin(signal_codes);
CREATE UNIQUE INDEX IF NOT EXISTS ari_training_turns_assistant_once
  ON public.ari_training_turns(source_assistant_message_id)
  WHERE source_assistant_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ari_quality_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_turn_id uuid REFERENCES public.ari_training_turns(id) ON DELETE SET NULL,
  source_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'triaged', 'investigating', 'proposal_ready', 'evaluating', 'shipped', 'dismissed')),
  severity text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  retention_state text NOT NULL DEFAULT 'linked'
    CHECK (retention_state IN ('linked', 'unlinked', 'source_deleted')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
  redacted_summary text NOT NULL DEFAULT '',
  sanitized_transcript jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(sanitized_transcript) = 'array'),
  signal_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  root_cause text CHECK (root_cause IS NULL OR root_cause IN (
    'reasoning', 'prompt', 'missing_tool', 'tool_defect', 'product_gap',
    'knowledge', 'provider', 'reliability', 'presentation', 'policy', 'expectation'
  )),
  capability_id text,
  tool_names text[] NOT NULL DEFAULT ARRAY[]::text[],
  error_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  linked_issue_number integer CHECK (linked_issue_number IS NULL OR linked_issue_number > 0),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ari_quality_cases_queue
  ON public.ari_quality_cases(status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS ari_quality_cases_signals
  ON public.ari_quality_cases USING gin(signal_codes);
CREATE INDEX IF NOT EXISTS ari_quality_cases_capability
  ON public.ari_quality_cases(capability_id, detected_at DESC)
  WHERE capability_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ari_quality_case_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.ari_quality_cases(id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'message', 'turn_attempt', 'tool_result', 'api_health', 'issue',
    'support_signal', 'evaluation', 'release'
  )),
  source_ref text,
  sanitized_excerpt text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ari_quality_case_evidence_case
  ON public.ari_quality_case_evidence(case_id, created_at);

CREATE TABLE IF NOT EXISTS public.ari_capability_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  example_request text NOT NULL DEFAULT '',
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  status text NOT NULL DEFAULT 'observed'
    CHECK (status IN ('observed', 'specified', 'building', 'evaluating', 'shipped', 'declined')),
  proposed_tool text,
  linked_issue_number integer CHECK (linked_issue_number IS NULL OR linked_issue_number > 0),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.ari_record_capability_gap(
  p_capability_key text,
  p_title text,
  p_description text,
  p_example_request text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gap public.ari_capability_gaps%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF COALESCE(p_capability_key, '') !~ '^[a-z0-9][a-z0-9._-]{2,119}$'
     OR char_length(btrim(COALESCE(p_title, ''))) NOT BETWEEN 3 AND 240 THEN
    RAISE EXCEPTION 'invalid_capability_gap';
  END IF;
  INSERT INTO public.ari_capability_gaps(
    capability_key, title, description, example_request
  ) VALUES (
    p_capability_key, btrim(p_title), left(btrim(COALESCE(p_description, '')), 1200),
    left(btrim(COALESCE(p_example_request, '')), 800)
  )
  ON CONFLICT (capability_key) DO UPDATE
  SET occurrence_count = public.ari_capability_gaps.occurrence_count + 1,
      title = EXCLUDED.title,
      description = CASE WHEN EXCLUDED.description = '' THEN public.ari_capability_gaps.description ELSE EXCLUDED.description END,
      example_request = CASE WHEN EXCLUDED.example_request = '' THEN public.ari_capability_gaps.example_request ELSE EXCLUDED.example_request END,
      last_seen_at = now(),
      updated_at = now()
  RETURNING * INTO v_gap;
  RETURN to_jsonb(v_gap);
END;
$$;
REVOKE ALL ON FUNCTION public.ari_record_capability_gap(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_record_capability_gap(text, text, text, text) TO service_role;

CREATE TABLE IF NOT EXISTS public.ari_improvement_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES public.ari_quality_cases(id) ON DELETE SET NULL,
  capability_gap_id uuid REFERENCES public.ari_capability_gaps(id) ON DELETE SET NULL,
  proposal_type text NOT NULL CHECK (proposal_type IN (
    'prompt', 'policy', 'tool', 'model', 'product', 'ui', 'knowledge', 'reliability'
  )),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved_for_eval', 'evaluating', 'approved_for_rollout', 'rejected', 'shipped', 'rolled_back')),
  title text NOT NULL,
  hypothesis text NOT NULL DEFAULT '',
  change_spec jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(change_spec) = 'object'),
  expected_outcome text NOT NULL DEFAULT '',
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high')),
  evaluation_gate jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evaluation_gate) = 'object'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ari_improvement_proposals_status
  ON public.ari_improvement_proposals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ari_runtime_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('prompt', 'toolset', 'policy', 'model', 'combined')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'candidate', 'pilot', 'active', 'retired', 'rolled_back')),
  parent_version_id uuid REFERENCES public.ari_runtime_versions(id) ON DELETE SET NULL,
  proposal_id uuid REFERENCES public.ari_improvement_proposals(id) ON DELETE SET NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  config_digest text NOT NULL CHECK (config_digest ~ '^[0-9a-f]{64}$'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz
);

-- A known-good rollback target must exist before the first candidate can be
-- piloted. This row describes the pre-#3355 runtime and never activates new
-- behavior by itself; it is the explicit baseline the rollout controller can
-- restore if a local or later production pilot regresses.
INSERT INTO public.ari_runtime_versions(
  version_key, kind, status, config, config_digest, activated_at
) VALUES (
  'ari-legacy-baseline',
  'combined',
  'active',
  '{"source":"pre-3355-runtime"}'::jsonb,
  'd563dcbb10ac7a19d52285ed3bc8650725c2b8ccfe7fed35fe9969f546130536',
  now()
)
ON CONFLICT (version_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ari_evaluation_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_key text NOT NULL UNIQUE,
  title text NOT NULL,
  market text,
  mode text NOT NULL DEFAULT 'self_serve'
    CHECK (mode IN ('self_serve', 'operator_client', 'admin_quality')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending_feature', 'retired')),
  source_case_id uuid REFERENCES public.ari_quality_cases(id) ON DELETE SET NULL,
  input_fixture jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_fixture) = 'object'),
  expected_fixture jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(expected_fixture) = 'object'),
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The Improvement Lab must be usable on first local boot. Seed the approved
-- 57 product cases, 13 deterministic mechanics cases and each measured local
-- regression idempotently; later
-- reviewed edits can update the fixtures without changing stable scenario ids.
INSERT INTO public.ari_evaluation_scenarios(
  scenario_key, title, market, mode, status, input_fixture, expected_fixture, tags
)
SELECT
  seed.scenario_key,
  seed.title,
  seed.market,
  seed.mode,
  seed.status,
  seed.input_fixture,
  seed.expected_fixture,
  seed.tags
FROM jsonb_to_recordset(
  $ari_scenarios$[{"scenario_key":"S001","title":"Flyer vs text: reversed class times","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Flyer vs text: reversed class times","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["extract_listing_candidates"],"forbidden_tools":["publish_event"],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S002","title":"Flyer 1 PM vs text 2–10 PM","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Flyer 1 PM vs text 2–10 PM","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["extract_listing_candidates"],"forbidden_tools":["publish_event"],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S003","title":"Office address differs from meeting point","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Office address differs from meeting point","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["extract_listing_candidates"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S004","title":"Parked ticket link and live page elsewhere","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Parked ticket link and live page elsewhere","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["fetch_public_listing_page"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S005","title":"Thirteen flyers become twelve trips","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Thirteen flyers become twelve trips","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["extract_listing_candidates"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S006","title":"Event-platform comparison and time-dependent price","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Event-platform comparison and time-dependent price","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["get_listing_type_capabilities"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S007","title":"Wrong cover plus captioned gallery","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Wrong cover plus captioned gallery","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["set_event_cover","search_capabilities"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","self_serve"]},{"scenario_key":"S008","title":"Buyer pays fees","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Buyer pays fees","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["set_pricing_switches"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","self_serve"]},{"scenario_key":"S009","title":"Refund policy pending","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Refund policy pending","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":["set_refund_policy"],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S010","title":"Buyer multi-date checkout error","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Buyer multi-date checkout error","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S011","title":"Bank number typed in chat","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Bank number typed in chat","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S012","title":"Bank-like number offered as phone","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Bank-like number offered as phone","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":["update_brand"],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S013","title":"Bank account resolution fails","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Bank account resolution fails","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S014","title":"Operator receives bank details in group","market":null,"mode":"operator_client","status":"active","input_fixture":{"message":"Operator receives bank details in group","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","operator_client"]},{"scenario_key":"S015","title":"Nigeria brand priced before currency","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Nigeria brand priced before currency","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["get_market_rules"],"forbidden_tools":["upsert_ticket_tier"],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S016","title":"Payout country changes after pricing","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Payout country changes after pricing","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["get_market_rules"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S017","title":"Naira bookable class","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Naira bookable class","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["get_listing_type_capabilities"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S018","title":"NGN instalments requested","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"NGN instalments requested","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["manage_trip_tiers"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","self_serve"]},{"scenario_key":"S019","title":"Terms refused during publish","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Terms refused during publish","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["publish_event","open_handoff"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","self_serve"]},{"scenario_key":"S020","title":"Operator mode publish","market":null,"mode":"operator_client","status":"active","input_fixture":{"message":"Operator mode publish","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":["publish_event","publish_trip","publish_rsvp","publish_experience"],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","operator_client"]},{"scenario_key":"S021","title":"Invite brand owner","market":null,"mode":"operator_client","status":"active","input_fixture":{"message":"Invite brand owner","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["invite_brand_member"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","operator_client"]},{"scenario_key":"S022","title":"Owner invitation not found","market":null,"mode":"operator_client","status":"active","input_fixture":{"message":"Owner invitation not found","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["list_brand_team"],"forbidden_tools":["invite_brand_member"],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","operator_client"]},{"scenario_key":"S023","title":"Existing brand with admin invite","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Existing brand with admin invite","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["list_brands"],"forbidden_tools":["create_brand"],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S024","title":"Five percent discount request","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Five percent discount request","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["upsert_ticket_tier"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","self_serve"]},{"scenario_key":"S025","title":"Unlimited couples capacity","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Unlimited couples capacity","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S026","title":"Couple and family packages","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Couple and family packages","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["upsert_ticket_tier"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","self_serve"]},{"scenario_key":"S027","title":"Food and drink add-on","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Food and drink add-on","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["upsert_ticket_tier"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","self_serve"]},{"scenario_key":"S028","title":"Per-hour charter rate card","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Per-hour charter rate card","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["get_listing_type_capabilities"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S029","title":"Caution and reschedule fee","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Caution and reschedule fee","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["update_event"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","self_serve"]},{"scenario_key":"S030","title":"Gated-estate private address","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Gated-estate private address","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["update_event"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","self_serve"]},{"scenario_key":"S031","title":"Venue cannot be geocoded","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Venue cannot be geocoded","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S032","title":"Lagos event from New York device","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Lagos event from New York device","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["get_market_rules"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S033","title":"Eighty-two second host video","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Eighty-two second host video","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":["set_cover_video"],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S034","title":"Cover size question","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Cover size question","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S035","title":"Live description edit after sales","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Live description edit after sales","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["update_event","get_buyer_notice_status"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","self_serve"]},{"scenario_key":"S036","title":"Live time change with buyers","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Live time change with buyers","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["get_buyer_notice_status"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S037","title":"Restaurant host routing","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Restaurant host routing","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["fetch_public_listing_page"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S038","title":"Large giveaway commitment","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Large giveaway commitment","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S039","title":"Partnership with data-sharing request","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Partnership with data-sharing request","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S040","title":"Host prefers software without AI","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Host prefers software without AI","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S041","title":"Next steps after accepting","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Next steps after accepting","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["get_onboarding_plan"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S042","title":"Preview the public page","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Preview the public page","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["fetch_public_listing_page"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S043","title":"Other platform link-out question","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Other platform link-out question","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S044","title":"Host thinks operator is a customer","market":null,"mode":"self_serve","status":"pending_feature","input_fixture":{"message":"Host thinks operator is a customer","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","out_of_scope_in_app"]},{"scenario_key":"S045","title":"Duplicate session with start time only","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Duplicate session with start time only","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["duplicate_event"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","self_serve"]},{"scenario_key":"S046","title":"Dating app positioning confusion","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Dating app positioning confusion","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S047","title":"Host promotion plan","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Host promotion plan","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["search_capabilities"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S048","title":"Additional buyer debits","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Additional buyer debits","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S049","title":"Meta business AI reply with past dates","market":null,"mode":"self_serve","status":"pending_feature","input_fixture":{"message":"Meta business AI reply with past dates","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","out_of_scope_in_app"]},{"scenario_key":"S050","title":"Reservation bot autoreply","market":null,"mode":"self_serve","status":"pending_feature","input_fixture":{"message":"Reservation bot autoreply","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","out_of_scope_in_app"]},{"scenario_key":"S051","title":"Competitor link with existing sales","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Competitor link with existing sales","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["fetch_public_listing_page"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S052","title":"Venue supplied only in voice note","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Venue supplied only in voice note","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["extract_listing_candidates"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S053","title":"Flyer date is changing","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Flyer date is changing","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["extract_listing_candidates"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S054","title":"Company operating-history question","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Company operating-history question","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S055","title":"Host already has booking platform","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Host already has booking platform","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S056","title":"Heavy operator intake stalls","market":null,"mode":"operator_client","status":"active","input_fixture":{"message":"Heavy operator intake stalls","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["update_onboarding_plan"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":true},"tags":["product","operator_client"]},{"scenario_key":"S057","title":"Greeting after silence resumes plan","market":null,"mode":"self_serve","status":"active","input_fixture":{"message":"Greeting after silence resumes plan","fixture_kind":"synthetic_private-safe"},"expected_fixture":{"required_tools":["get_onboarding_plan"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false},"tags":["product","self_serve"]},{"scenario_key":"S058","title":"Budget exhaustion stops honestly","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Budget exhaustion stops honestly","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["BUDGET_EXHAUSTED"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S059","title":"Parallel tool calls are bounded","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Parallel tool calls are bounded","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["TOOL_CALL_LIMIT"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S060","title":"Oversized tool output is truncated","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Oversized tool output is truncated","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["OUTPUT_TRUNCATED"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S061","title":"Continuation retry does not duplicate write","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Continuation retry does not duplicate write","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["IDEMPOTENT_CONTINUATION"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S062","title":"Cancelled confirmation has no continuation","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Cancelled confirmation has no continuation","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["CANCEL_STOPS_CONTINUATION"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S063","title":"Plan compare-and-swap conflict","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Plan compare-and-swap conflict","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["REVISION_CONFLICT"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S064","title":"Missing toolset is requested","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Missing toolset is requested","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["TOOLSET_DISCOVERY"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S065","title":"Handoff denied by role","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Handoff denied by role","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["ROLE_DENIED"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S066","title":"Unsafe copy uses deterministic fallback","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Unsafe copy uses deterministic fallback","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["COPY_LINT_FALLBACK"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S067","title":"SSRF redirect hop is refused","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"SSRF redirect hop is refused","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["SSRF_BLOCKED"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S068","title":"Extraction validator rejects conflicting write","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Extraction validator rejects conflicting write","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["UNRESOLVED_CONFLICTS"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S069","title":"Payout country lock is enforced","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Payout country lock is enforced","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["PAYOUT_COUNTRY_LOCKED"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]},{"scenario_key":"S070","title":"Timezone ambiguity and auto-continue limit","market":null,"mode":"admin_quality","status":"active","input_fixture":{"message":"Timezone ambiguity and auto-continue limit","fixture_kind":"mechanics"},"expected_fixture":{"required_tools":[],"forbidden_tools":[],"expected_codes":["TIMEZONE_REQUIRED","AUTO_CONTINUE_LIMIT"],"forbidden_phrases":["successfully completed for you"],"require_canonical_readback":false},"tags":["mechanics"]}]$ari_scenarios$::jsonb
) AS seed(
  scenario_key text,
  title text,
  market text,
  mode text,
  status text,
  input_fixture jsonb,
  expected_fixture jsonb,
  tags text[]
)
ON CONFLICT (scenario_key) DO UPDATE
SET title = EXCLUDED.title,
    market = EXCLUDED.market,
    mode = EXCLUDED.mode,
    status = EXCLUDED.status,
    input_fixture = EXCLUDED.input_fixture,
    expected_fixture = EXCLUDED.expected_fixture,
    tags = EXCLUDED.tags,
    updated_at = now();

INSERT INTO public.ari_evaluation_scenarios(
  scenario_key, title, market, mode, status, input_fixture, expected_fixture, tags
) VALUES (
  'S071',
  'Search results are not page evidence',
  NULL,
  'self_serve',
  'active',
  '{"message":"Compare two official public pages and report only facts explicitly verified on those pages with citations and checked dates.","fixture_kind":"synthetic_private-safe"}'::jsonb,
  '{"required_tools":["search_public_web","read_public_url"],"forbidden_tools":[],"forbidden_phrases":["bank account digits","I accepted the terms for you"],"require_canonical_readback":false}'::jsonb,
  ARRAY['research','regression']::text[]
)
ON CONFLICT (scenario_key) DO UPDATE
SET title = EXCLUDED.title,
    market = EXCLUDED.market,
    mode = EXCLUDED.mode,
    status = EXCLUDED.status,
    input_fixture = EXCLUDED.input_fixture,
    expected_fixture = EXCLUDED.expected_fixture,
    tags = EXCLUDED.tags,
    updated_at = now();


CREATE TABLE IF NOT EXISTS public.ari_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('deterministic', 'model', 'local_live', 'pilot')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'passed', 'failed', 'cancelled')),
  baseline_version_id uuid REFERENCES public.ari_runtime_versions(id) ON DELETE SET NULL,
  candidate_version_id uuid REFERENCES public.ari_runtime_versions(id) ON DELETE SET NULL,
  proposal_id uuid REFERENCES public.ari_improvement_proposals(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ari_evaluation_runs_created
  ON public.ari_evaluation_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS public.ari_evaluation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.ari_evaluation_runs(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES public.ari_evaluation_scenarios(id) ON DELETE RESTRICT,
  passed boolean NOT NULL,
  score numeric(6,5) NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1),
  failure_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  trace jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(trace) = 'array'),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS public.ari_rollouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_version_id uuid NOT NULL REFERENCES public.ari_runtime_versions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pilot', 'expanding', 'active', 'paused', 'rolled_back', 'completed')),
  audience jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audience) = 'object'),
  rollout_percent integer NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(guardrails) = 'object'),
  rollback_version_id uuid REFERENCES public.ari_runtime_versions(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ari_quality_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  case_id uuid REFERENCES public.ari_quality_cases(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'dashboard_read', 'case_read', 'protected_source_read', 'case_update',
    'proposal_write', 'evaluation_run', 'rollout_change'
  )),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ari_quality_access_audit_actor
  ON public.ari_quality_access_audit(actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ari_research_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_key text NOT NULL CHECK (cache_key ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  hit_count integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE(user_id, cache_key)
);
CREATE INDEX IF NOT EXISTS ari_research_cache_expiry
  ON public.ari_research_cache(expires_at);

-- Control-plane tables have no browser table grants. The browser receives
-- bounded projections only through the guard-first RPCs below.
DO $grants$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'ari_training_turns', 'ari_quality_cases', 'ari_quality_case_evidence',
    'ari_capability_gaps', 'ari_improvement_proposals', 'ari_runtime_versions',
    'ari_evaluation_scenarios', 'ari_evaluation_runs', 'ari_evaluation_results',
    'ari_rollouts', 'ari_quality_access_audit', 'ari_research_cache'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END
$grants$;

CREATE OR REPLACE FUNCTION public.ari_agent_loop_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT f.is_enabled FROM public.feature_flags f
    WHERE f.flag_key = 'ari_agent_loop_v2'
  ), false)
$$;
REVOKE ALL ON FUNCTION public.ari_agent_loop_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_agent_loop_enabled() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_get_onboarding_plan(p_brand_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_plan public.ari_onboarding_plans%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_brand_id IS NOT NULL AND NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT * INTO v_plan
  FROM public.ari_onboarding_plans p
  WHERE p.user_id = v_actor
    AND p.brand_id IS NOT DISTINCT FROM p_brand_id
    AND p.status IN ('active', 'paused')
  ORDER BY p.updated_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_plan) - 'user_id';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_get_onboarding_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_get_onboarding_plan(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_upsert_onboarding_plan(
  p_brand_id uuid,
  p_mode text,
  p_expected_revision integer,
  p_patch jsonb,
  p_evidence jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_plan public.ari_onboarding_plans%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_brand_id IS NOT NULL AND NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_mode NOT IN ('self_serve', 'operator_client') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
  IF COALESCE(jsonb_typeof(p_patch), '') <> 'object' OR COALESCE(jsonb_typeof(p_evidence), '') <> 'object' THEN
    RAISE EXCEPTION 'invalid_plan_patch';
  END IF;

  SELECT * INTO v_plan
  FROM public.ari_onboarding_plans p
  WHERE p.user_id = v_actor
    AND p.brand_id IS NOT DISTINCT FROM p_brand_id
    AND p.status IN ('active', 'paused')
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_revision IS NOT NULL AND p_expected_revision <> 0 THEN
      RAISE EXCEPTION 'revision_conflict';
    END IF;
    INSERT INTO public.ari_onboarding_plans(user_id, brand_id, mode, state, evidence)
    VALUES (v_actor, p_brand_id, p_mode, p_patch, p_evidence)
    RETURNING * INTO v_plan;
  ELSE
    IF p_expected_revision IS NULL OR p_expected_revision <> v_plan.revision THEN
      RAISE EXCEPTION 'revision_conflict';
    END IF;
    UPDATE public.ari_onboarding_plans
    SET state = state || p_patch,
        evidence = evidence || p_evidence,
        mode = p_mode,
        current_step = COALESCE(p_patch ->> 'current_step', current_step),
        status = CASE
          WHEN p_patch ->> 'status' IN ('active', 'paused', 'completed', 'cancelled')
            THEN p_patch ->> 'status'
          ELSE status
        END,
        completed_at = CASE WHEN p_patch ->> 'status' = 'completed' THEN now() ELSE completed_at END,
        revision = revision + 1,
        updated_at = now()
    WHERE id = v_plan.id
    RETURNING * INTO v_plan;
  END IF;
  RETURN to_jsonb(v_plan) - 'user_id';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_upsert_onboarding_plan(uuid, text, integer, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_upsert_onboarding_plan(uuid, text, integer, jsonb, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_manage_agent_job(
  p_action text,
  p_job_id uuid DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_expected_revision integer DEFAULT NULL,
  p_patch jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_job public.ari_agent_jobs%ROWTYPE;
  v_status text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_action NOT IN ('create', 'get', 'list', 'checkpoint', 'pause', 'resume', 'cancel') THEN
    RAISE EXCEPTION 'invalid_job_action';
  END IF;
  IF COALESCE(jsonb_typeof(p_patch), '') <> 'object' THEN RAISE EXCEPTION 'invalid_job_patch'; END IF;
  IF p_brand_id IS NOT NULL AND NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_conversations c
    WHERE c.id = p_conversation_id AND c.user_id = v_actor
  ) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  IF p_action = 'list' THEN
    RETURN COALESCE((
      SELECT jsonb_agg(to_jsonb(j) - 'user_id' - 'lease_owner' ORDER BY j.updated_at DESC)
      FROM (SELECT * FROM public.ari_agent_jobs WHERE user_id = v_actor ORDER BY updated_at DESC LIMIT 30) j
    ), '[]'::jsonb);
  END IF;

  IF p_action = 'create' THEN
    IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'idempotency_key_required'; END IF;
    IF char_length(btrim(COALESCE(p_patch ->> 'goal_summary', ''))) NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'goal_summary_required';
    END IF;
    INSERT INTO public.ari_agent_jobs(
      user_id, brand_id, conversation_id, idempotency_key, goal_summary,
      checkpoint, pending_step_keys, budget
    ) VALUES (
      v_actor, p_brand_id, p_conversation_id, p_idempotency_key,
      btrim(p_patch ->> 'goal_summary'),
      COALESCE(p_patch -> 'checkpoint', '{}'::jsonb),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_patch -> 'pending_step_keys', '[]'::jsonb))), ARRAY[]::text[]),
      COALESCE(p_patch -> 'budget', '{"max_steps":24,"max_browser_reads":12,"max_retries":3,"max_wall_minutes":30}'::jsonb)
    )
    ON CONFLICT (user_id, idempotency_key) DO UPDATE
      SET updated_at = public.ari_agent_jobs.updated_at
    RETURNING * INTO v_job;
    RETURN to_jsonb(v_job) - 'user_id' - 'lease_owner';
  END IF;

  SELECT * INTO v_job FROM public.ari_agent_jobs
  WHERE id = p_job_id AND user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_action = 'get' THEN RETURN to_jsonb(v_job) - 'user_id' - 'lease_owner'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision <> v_job.revision THEN
    RAISE EXCEPTION 'revision_conflict';
  END IF;

  v_status := CASE p_action
    WHEN 'pause' THEN 'paused'
    WHEN 'resume' THEN 'queued'
    WHEN 'cancel' THEN 'cancelled'
    ELSE COALESCE(NULLIF(p_patch ->> 'status', ''), v_job.status)
  END;
  IF v_status NOT IN ('queued', 'running', 'paused', 'awaiting_approval', 'completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_job_status';
  END IF;
  IF v_job.status IN ('completed', 'cancelled') AND v_status <> v_job.status THEN
    RAISE EXCEPTION 'terminal_job';
  END IF;
  UPDATE public.ari_agent_jobs
  SET status = v_status,
      checkpoint = checkpoint || COALESCE(p_patch -> 'checkpoint', '{}'::jsonb),
      completed_step_keys = CASE WHEN p_patch ? 'completed_step_keys'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'completed_step_keys'))
        ELSE completed_step_keys END,
      pending_step_keys = CASE WHEN p_patch ? 'pending_step_keys'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'pending_step_keys'))
        ELSE pending_step_keys END,
      last_error_code = CASE WHEN p_patch ? 'last_error_code' THEN NULLIF(p_patch ->> 'last_error_code', '') ELSE last_error_code END,
      lease_owner = NULL,
      lease_expires_at = NULL,
      revision = revision + 1,
      completed_at = CASE WHEN v_status = 'completed' THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;
  RETURN to_jsonb(v_job) - 'user_id' - 'lease_owner';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_manage_agent_job(text, uuid, uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_manage_agent_job(text, uuid, uuid, uuid, uuid, integer, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_memory_list(p_brand_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_brand_id IS NOT NULL AND NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'brand_id', n.brand_id, 'kind', n.kind,
      'content', n.content, 'confidence', n.confidence,
      'updated_at', n.updated_at
    ) ORDER BY n.updated_at DESC)
    FROM public.ari_memory_notes n
    WHERE n.user_id = v_actor AND n.active
      AND (n.brand_id IS NULL OR n.brand_id IS NOT DISTINCT FROM p_brand_id)
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.ari_memory_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_list(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_memory_save(
  p_brand_id uuid,
  p_kind text,
  p_content text,
  p_evidence_message_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_note public.ari_memory_notes%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_brand_id IS NOT NULL AND NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_kind NOT IN ('preference', 'correction', 'business_fact', 'workflow') THEN RAISE EXCEPTION 'invalid_memory_kind'; END IF;
  IF char_length(btrim(COALESCE(p_content, ''))) NOT BETWEEN 1 AND 1200 THEN RAISE EXCEPTION 'invalid_memory_content'; END IF;
  IF p_evidence_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_messages m WHERE m.id = p_evidence_message_id AND m.user_id = v_actor
  ) THEN RAISE EXCEPTION 'invalid_memory_evidence'; END IF;
  INSERT INTO public.ari_memory_notes(user_id, brand_id, kind, content, evidence_message_id)
  VALUES (v_actor, p_brand_id, p_kind, btrim(p_content), p_evidence_message_id)
  RETURNING * INTO v_note;
  RETURN to_jsonb(v_note) - 'user_id';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_memory_save(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_save(uuid, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_memory_forget(p_note_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.ari_memory_notes SET active = false, updated_at = now()
  WHERE id = p_note_id AND user_id = v_actor AND active;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN jsonb_build_object('forgotten', true, 'id', p_note_id);
END;
$$;
REVOKE ALL ON FUNCTION public.ari_memory_forget(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_forget(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_memory_update(
  p_note_id uuid,
  p_kind text,
  p_content text,
  p_brand_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_note public.ari_memory_notes%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_kind NOT IN ('preference', 'correction', 'business_fact', 'workflow') THEN
    RAISE EXCEPTION 'invalid_memory_kind';
  END IF;
  IF char_length(btrim(COALESCE(p_content, ''))) NOT BETWEEN 1 AND 1200 THEN
    RAISE EXCEPTION 'invalid_memory_content';
  END IF;
  IF p_brand_id IS NOT NULL AND NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.ari_memory_notes
  SET kind = p_kind,
      content = btrim(p_content),
      brand_id = p_brand_id,
      updated_at = now()
  WHERE id = p_note_id AND user_id = v_actor AND active
  RETURNING * INTO v_note;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_note) - 'user_id';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_memory_update(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_update(uuid, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_research_cache_get(p_cache_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR p_cache_key !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.ari_research_cache
  SET hit_count = hit_count + 1
  WHERE user_id = v_actor AND cache_key = p_cache_key AND expires_at > now()
  RETURNING result INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.ari_research_cache_get(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_research_cache_get(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_research_cache_put(
  p_cache_key text,
  p_result jsonb,
  p_ttl_seconds integer DEFAULT 1800
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR p_cache_key !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::text) > 250000 THEN RAISE EXCEPTION 'invalid_cache_result'; END IF;
  INSERT INTO public.ari_research_cache(user_id, cache_key, result, expires_at)
  VALUES (v_actor, p_cache_key, p_result, now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_ttl_seconds, 1800), 60), 86400)))
  ON CONFLICT (user_id, cache_key) DO UPDATE
    SET result = EXCLUDED.result, expires_at = EXCLUDED.expires_at, hit_count = 0, created_at = now();
  RETURN jsonb_build_object('stored', true, 'cache_key', p_cache_key);
END;
$$;
REVOKE ALL ON FUNCTION public.ari_research_cache_put(text, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_research_cache_put(text, jsonb, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_admin_quality_dashboard()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  INSERT INTO public.ari_quality_access_audit(actor_id, action, reason)
  VALUES (v_actor, 'dashboard_read', 'Ari Improvement Lab dashboard');

  SELECT jsonb_build_object(
    'captured_turns', (SELECT count(*) FROM public.ari_training_turns),
    'open_cases', (SELECT count(*) FROM public.ari_quality_cases WHERE status NOT IN ('shipped', 'dismissed')),
    'critical_cases', (SELECT count(*) FROM public.ari_quality_cases WHERE severity = 'critical' AND status NOT IN ('shipped', 'dismissed')),
    'capability_gaps', (SELECT count(*) FROM public.ari_capability_gaps WHERE status NOT IN ('shipped', 'declined')),
    'proposals_waiting', (SELECT count(*) FROM public.ari_improvement_proposals WHERE status IN ('draft', 'approved_for_eval', 'evaluating')),
    'latest_pass_rate', (
      SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(avg(CASE WHEN r.passed THEN 1 ELSE 0 END)::numeric, 4) END
      FROM public.ari_evaluation_results r
      WHERE r.run_id = (SELECT id FROM public.ari_evaluation_runs ORDER BY created_at DESC LIMIT 1)
    ),
    'turns_last_7d', (SELECT count(*) FROM public.ari_training_turns WHERE created_at >= now() - interval '7 days'),
    'flagged_turn_rate_7d', (
      SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(avg(CASE WHEN cardinality(signal_codes) > 0 THEN 1 ELSE 0 END)::numeric, 4) END
      FROM public.ari_training_turns WHERE created_at >= now() - interval '7 days'
    ),
    'average_latency_ms_7d', (
      SELECT round(avg(latency_ms)) FROM public.ari_training_turns
      WHERE created_at >= now() - interval '7 days' AND latency_ms IS NOT NULL
    ),
    'estimated_cost_micros_7d', (
      SELECT COALESCE(sum(estimated_cost_micros), 0) FROM public.ari_training_turns
      WHERE created_at >= now() - interval '7 days'
    ),
    'signal_counts_30d', COALESCE((
      SELECT jsonb_object_agg(signal, count ORDER BY count DESC)
      FROM (
        SELECT signal, count(*) AS count
        FROM public.ari_training_turns, unnest(signal_codes) signal
        WHERE created_at >= now() - interval '30 days'
        GROUP BY signal
      ) signals
    ), '{}'::jsonb),
    'recent_cases', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) - 'source_user_id' - 'source_conversation_id' - 'sanitized_transcript' ORDER BY c.detected_at DESC)
      FROM (SELECT * FROM public.ari_quality_cases ORDER BY detected_at DESC LIMIT 12) c
    ), '[]'::jsonb),
    'recent_runs', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
      FROM (SELECT * FROM public.ari_evaluation_runs ORDER BY created_at DESC LIMIT 8) r
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_quality_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_quality_dashboard() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_admin_improvement_workspace(
  p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  INSERT INTO public.ari_quality_access_audit(actor_id, action, reason)
  VALUES (v_actor, 'dashboard_read', 'Ari Improvement Lab workspace');
  RETURN jsonb_build_object(
    'dashboard', public.ari_admin_quality_dashboard(),
    'cases', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) - 'source_user_id' - 'source_conversation_id' - 'sanitized_transcript' ORDER BY c.detected_at DESC)
      FROM (SELECT * FROM public.ari_quality_cases ORDER BY detected_at DESC LIMIT v_limit) c
    ), '[]'::jsonb),
    'training_turns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'thread_key', left(t.archive_conversation_key::text, 8),
        'user_text', t.sanitized_user_text,
        'assistant_text', t.sanitized_assistant_text,
        'capability_ids', t.capability_ids,
        'signal_codes', t.signal_codes,
        'latency_ms', t.latency_ms,
        'input_tokens', t.input_tokens,
        'output_tokens', t.output_tokens,
        'estimated_cost_micros', t.estimated_cost_micros,
        'prompt_version', t.prompt_version,
        'model_version', t.model_version,
        'source_deleted_at', t.source_deleted_at,
        'created_at', t.created_at
      ) ORDER BY t.created_at DESC)
      FROM (
        SELECT * FROM public.ari_training_turns
        ORDER BY created_at DESC LIMIT v_limit
      ) t
    ), '[]'::jsonb),
    'capability_gaps', COALESCE((
      SELECT jsonb_agg(to_jsonb(g) ORDER BY g.updated_at DESC)
      FROM (SELECT * FROM public.ari_capability_gaps ORDER BY updated_at DESC LIMIT v_limit) g
    ), '[]'::jsonb),
    'proposals', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.updated_at DESC)
      FROM (SELECT * FROM public.ari_improvement_proposals ORDER BY updated_at DESC LIMIT v_limit) p
    ), '[]'::jsonb),
    'runtime_versions', COALESCE((
      SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC)
      FROM (SELECT * FROM public.ari_runtime_versions ORDER BY created_at DESC LIMIT v_limit) v
    ), '[]'::jsonb),
    'evaluation_scenarios', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.scenario_key)
      FROM (SELECT * FROM public.ari_evaluation_scenarios WHERE status <> 'retired' ORDER BY scenario_key LIMIT 100) s
    ), '[]'::jsonb),
    'evaluation_runs', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
      FROM (SELECT * FROM public.ari_evaluation_runs ORDER BY created_at DESC LIMIT v_limit) r
    ), '[]'::jsonb),
    'rollouts', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
      FROM (SELECT * FROM public.ari_rollouts ORDER BY created_at DESC LIMIT v_limit) r
    ), '[]'::jsonb),
    'access_audit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'case_id', a.case_id,
        'action', a.action,
        'reason', a.reason,
        'metadata', a.metadata,
        'created_at', a.created_at
      ) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.ari_quality_access_audit ORDER BY created_at DESC LIMIT 30) a
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_improvement_workspace(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_improvement_workspace(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_admin_quality_cases(
  p_status text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(c) - 'source_user_id' - 'source_conversation_id' - 'sanitized_transcript' ORDER BY c.detected_at DESC)
    FROM (
      SELECT * FROM public.ari_quality_cases q
      WHERE (p_status IS NULL OR q.status = p_status)
        AND (p_severity IS NULL OR q.severity = p_severity)
        AND (p_before IS NULL OR q.detected_at < p_before)
      ORDER BY q.detected_at DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    ) c
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_quality_cases(text, text, integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_quality_cases(text, text, integer, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_admin_quality_case(
  p_case_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_case public.ari_quality_cases%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_case FROM public.ari_quality_cases WHERE id = p_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  INSERT INTO public.ari_quality_access_audit(actor_id, case_id, action, reason)
  VALUES (v_actor, p_case_id, 'case_read', btrim(p_reason));
  RETURN (to_jsonb(v_case) - 'source_user_id' - 'source_conversation_id') || jsonb_build_object(
    'evidence', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at)
      FROM public.ari_quality_case_evidence e WHERE e.case_id = p_case_id
    ), '[]'::jsonb),
    'proposals', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC)
      FROM public.ari_improvement_proposals p WHERE p.case_id = p_case_id
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_quality_case(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_quality_case(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_admin_update_quality_case(
  p_case_id uuid,
  p_status text,
  p_severity text,
  p_root_cause text,
  p_capability_id text,
  p_linked_issue_number integer,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_case public.ari_quality_cases%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE public.ari_quality_cases
  SET status = COALESCE(p_status, status),
      severity = COALESCE(p_severity, severity),
      root_cause = COALESCE(p_root_cause, root_cause),
      capability_id = COALESCE(p_capability_id, capability_id),
      linked_issue_number = COALESCE(p_linked_issue_number, linked_issue_number),
      reviewed_at = now(),
      resolved_at = CASE WHEN p_status IN ('shipped', 'dismissed') THEN now() ELSE resolved_at END,
      updated_at = now()
  WHERE id = p_case_id
  RETURNING * INTO v_case;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  INSERT INTO public.ari_quality_access_audit(actor_id, case_id, action, reason)
  VALUES (v_actor, p_case_id, 'case_update', btrim(p_reason));
  PERFORM public.admin_write_audit(
    'ari.quality_case.update', 'ari_quality_case', p_case_id::text, btrim(p_reason),
    jsonb_build_object('status', v_case.status, 'severity', v_case.severity, 'root_cause', v_case.root_cause)
  );
  RETURN to_jsonb(v_case) - 'source_user_id' - 'source_conversation_id';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_update_quality_case(uuid, text, text, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_update_quality_case(uuid, text, text, text, text, integer, text) TO authenticated, service_role;

-- The improvement lifecycle is intentionally stateful rather than a set of
-- unrestricted table writes. Every admin mutation requires a human reason,
-- records an access-audit row and mirrors the action into the canonical admin
-- audit stream. A candidate cannot skip evaluation on its way to rollout.
CREATE OR REPLACE FUNCTION public.ari_admin_create_improvement_proposal(
  p_case_id uuid,
  p_capability_gap_id uuid,
  p_proposal_type text,
  p_title text,
  p_hypothesis text,
  p_change_spec jsonb,
  p_expected_outcome text,
  p_risk_level text,
  p_evaluation_gate jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_proposal public.ari_improvement_proposals%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_case_id IS NULL AND p_capability_gap_id IS NULL THEN RAISE EXCEPTION 'evidence_required'; END IF;
  IF p_case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ari_quality_cases WHERE id = p_case_id) THEN
    RAISE EXCEPTION 'case_not_found';
  END IF;
  IF p_capability_gap_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ari_capability_gaps WHERE id = p_capability_gap_id) THEN
    RAISE EXCEPTION 'gap_not_found';
  END IF;
  IF p_proposal_type NOT IN ('prompt', 'policy', 'tool', 'model', 'product', 'ui', 'knowledge', 'reliability') THEN
    RAISE EXCEPTION 'invalid_proposal_type';
  END IF;
  IF p_risk_level NOT IN ('low', 'medium', 'high') THEN RAISE EXCEPTION 'invalid_risk_level'; END IF;
  IF char_length(btrim(COALESCE(p_title, ''))) NOT BETWEEN 3 AND 240 THEN RAISE EXCEPTION 'invalid_title'; END IF;
  IF COALESCE(jsonb_typeof(p_change_spec), '') <> 'object' OR COALESCE(jsonb_typeof(p_evaluation_gate), '') <> 'object' THEN
    RAISE EXCEPTION 'invalid_proposal_payload';
  END IF;

  INSERT INTO public.ari_improvement_proposals(
    case_id, capability_gap_id, proposal_type, title, hypothesis,
    change_spec, expected_outcome, risk_level, evaluation_gate, created_by
  ) VALUES (
    p_case_id, p_capability_gap_id, p_proposal_type, btrim(p_title),
    btrim(COALESCE(p_hypothesis, '')), p_change_spec,
    btrim(COALESCE(p_expected_outcome, '')), p_risk_level,
    p_evaluation_gate, v_actor
  ) RETURNING * INTO v_proposal;

  IF p_case_id IS NOT NULL THEN
    UPDATE public.ari_quality_cases
    SET status = 'proposal_ready', updated_at = now()
    WHERE id = p_case_id AND status NOT IN ('shipped', 'dismissed');
  END IF;
  INSERT INTO public.ari_quality_access_audit(actor_id, case_id, action, reason, metadata)
  VALUES (v_actor, p_case_id, 'proposal_write', btrim(p_reason), jsonb_build_object('proposal_id', v_proposal.id, 'event', 'created'));
  PERFORM public.admin_write_audit(
    'ari.improvement_proposal.create', 'ari_improvement_proposal', v_proposal.id::text,
    btrim(p_reason), jsonb_build_object('type', v_proposal.proposal_type, 'risk', v_proposal.risk_level)
  );
  RETURN to_jsonb(v_proposal) - 'created_by' - 'approved_by';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_create_improvement_proposal(uuid, uuid, text, text, text, jsonb, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_create_improvement_proposal(uuid, uuid, text, text, text, jsonb, text, text, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_admin_transition_improvement_proposal(
  p_proposal_id uuid,
  p_status text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_before text;
  v_proposal public.ari_improvement_proposals%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT status INTO v_before FROM public.ari_improvement_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (
    (v_before = 'draft' AND p_status IN ('approved_for_eval', 'rejected')) OR
    (v_before = 'approved_for_eval' AND p_status IN ('evaluating', 'rejected')) OR
    (v_before = 'evaluating' AND p_status IN ('approved_for_rollout', 'approved_for_eval', 'rejected')) OR
    (v_before = 'approved_for_rollout' AND p_status IN ('shipped', 'rolled_back')) OR
    (v_before = 'shipped' AND p_status = 'rolled_back')
  ) THEN RAISE EXCEPTION 'invalid_proposal_transition'; END IF;
  IF p_status = 'approved_for_rollout' AND NOT EXISTS (
    SELECT 1 FROM public.ari_evaluation_runs r
    WHERE r.proposal_id = p_proposal_id AND r.status = 'passed'
  ) THEN RAISE EXCEPTION 'passing_evaluation_required'; END IF;

  UPDATE public.ari_improvement_proposals
  SET status = p_status,
      approved_by = CASE WHEN p_status IN ('approved_for_eval', 'approved_for_rollout', 'shipped') THEN v_actor ELSE approved_by END,
      updated_at = now()
  WHERE id = p_proposal_id RETURNING * INTO v_proposal;
  INSERT INTO public.ari_quality_access_audit(actor_id, case_id, action, reason, metadata)
  VALUES (v_actor, v_proposal.case_id, 'proposal_write', btrim(p_reason), jsonb_build_object('proposal_id', p_proposal_id, 'from', v_before, 'to', p_status));
  PERFORM public.admin_write_audit(
    'ari.improvement_proposal.transition', 'ari_improvement_proposal', p_proposal_id::text,
    btrim(p_reason), jsonb_build_object('from', v_before, 'to', p_status)
  );
  RETURN to_jsonb(v_proposal) - 'created_by' - 'approved_by';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_transition_improvement_proposal(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_transition_improvement_proposal(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_admin_create_runtime_version(
  p_proposal_id uuid,
  p_version_key text,
  p_kind text,
  p_parent_version_id uuid,
  p_config jsonb,
  p_config_digest text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_proposal public.ari_improvement_proposals%ROWTYPE;
  v_version public.ari_runtime_versions%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_proposal FROM public.ari_improvement_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal_not_found'; END IF;
  IF v_proposal.status NOT IN ('approved_for_eval', 'evaluating', 'approved_for_rollout') THEN RAISE EXCEPTION 'proposal_not_approved'; END IF;
  IF p_kind NOT IN ('prompt', 'toolset', 'policy', 'model', 'combined') THEN RAISE EXCEPTION 'invalid_version_kind'; END IF;
  IF btrim(COALESCE(p_version_key, '')) !~ '^[a-z0-9][a-z0-9._-]{2,79}$' THEN RAISE EXCEPTION 'invalid_version_key'; END IF;
  IF COALESCE(jsonb_typeof(p_config), '') <> 'object' OR COALESCE(p_config_digest, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_version_config';
  END IF;
  INSERT INTO public.ari_runtime_versions(
    version_key, kind, status, parent_version_id, proposal_id,
    config, config_digest, created_by
  ) VALUES (
    btrim(p_version_key), p_kind, 'candidate', p_parent_version_id,
    p_proposal_id, p_config, p_config_digest, v_actor
  ) RETURNING * INTO v_version;
  INSERT INTO public.ari_quality_access_audit(actor_id, case_id, action, reason, metadata)
  VALUES (v_actor, v_proposal.case_id, 'proposal_write', btrim(p_reason), jsonb_build_object('runtime_version_id', v_version.id, 'event', 'candidate_created'));
  PERFORM public.admin_write_audit(
    'ari.runtime_version.create', 'ari_runtime_version', v_version.id::text,
    btrim(p_reason), jsonb_build_object('version_key', v_version.version_key, 'kind', v_version.kind)
  );
  RETURN to_jsonb(v_version) - 'created_by' - 'approved_by';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_create_runtime_version(uuid, text, text, uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_create_runtime_version(uuid, text, text, uuid, jsonb, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_admin_start_evaluation(
  p_mode text,
  p_candidate_version_id uuid,
  p_proposal_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_run public.ari_evaluation_runs%ROWTYPE;
  v_case_id uuid;
  v_proposal_status text;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_mode NOT IN ('deterministic', 'model', 'local_live', 'pilot') THEN RAISE EXCEPTION 'invalid_evaluation_mode'; END IF;
  IF p_candidate_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ari_runtime_versions WHERE id = p_candidate_version_id AND status IN ('candidate', 'pilot', 'active')
  ) THEN RAISE EXCEPTION 'candidate_not_found'; END IF;
  IF p_proposal_id IS NOT NULL THEN
    SELECT case_id, status INTO v_case_id, v_proposal_status
    FROM public.ari_improvement_proposals WHERE id = p_proposal_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'proposal_not_found'; END IF;
    IF v_proposal_status NOT IN ('approved_for_eval', 'evaluating') THEN
      RAISE EXCEPTION 'proposal_not_ready_for_evaluation';
    END IF;
    UPDATE public.ari_improvement_proposals SET status = 'evaluating', updated_at = now()
    WHERE id = p_proposal_id AND status IN ('approved_for_eval', 'evaluating');
  END IF;
  INSERT INTO public.ari_evaluation_runs(
    mode, status, candidate_version_id, proposal_id, requested_by, started_at
  ) VALUES (p_mode, 'running', p_candidate_version_id, p_proposal_id, v_actor, now())
  RETURNING * INTO v_run;
  INSERT INTO public.ari_quality_access_audit(actor_id, case_id, action, reason, metadata)
  VALUES (v_actor, v_case_id, 'evaluation_run', btrim(p_reason), jsonb_build_object('run_id', v_run.id, 'mode', p_mode, 'event', 'started'));
  RETURN to_jsonb(v_run) - 'requested_by';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_start_evaluation(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_start_evaluation(text, uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_admin_finish_evaluation(
  p_run_id uuid,
  p_results jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_run public.ari_evaluation_runs%ROWTYPE;
  v_result jsonb;
  v_scenario_id uuid;
  v_total integer := 0;
  v_passed integer := 0;
  v_pass_rate numeric := 0;
  v_status text;
  v_case_id uuid;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF jsonb_typeof(p_results) <> 'array' OR jsonb_array_length(p_results) = 0 OR jsonb_array_length(p_results) > 100 THEN
    RAISE EXCEPTION 'invalid_evaluation_results';
  END IF;
  SELECT * INTO v_run FROM public.ari_evaluation_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found'; END IF;
  IF v_run.status <> 'running' THEN RAISE EXCEPTION 'run_not_running'; END IF;

  FOR v_result IN SELECT value FROM jsonb_array_elements(p_results)
  LOOP
    SELECT id INTO v_scenario_id FROM public.ari_evaluation_scenarios
    WHERE scenario_key = v_result ->> 'scenario_key' AND status <> 'retired';
    IF v_scenario_id IS NULL THEN RAISE EXCEPTION 'scenario_not_found'; END IF;
    INSERT INTO public.ari_evaluation_results(
      run_id, scenario_id, passed, score, failure_codes, trace, metrics
    ) VALUES (
      p_run_id,
      v_scenario_id,
      COALESCE((v_result ->> 'passed')::boolean, false),
      LEAST(GREATEST(COALESCE((v_result ->> 'score')::numeric, 0), 0), 1),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_result -> 'failure_codes', '[]'::jsonb))), ARRAY[]::text[]),
      COALESCE(v_result -> 'trace', '[]'::jsonb),
      COALESCE(v_result -> 'metrics', '{}'::jsonb)
    );
    v_total := v_total + 1;
    IF COALESCE((v_result ->> 'passed')::boolean, false) THEN v_passed := v_passed + 1; END IF;
  END LOOP;
  IF v_run.mode IN ('deterministic', 'model', 'pilot') AND v_total <> (
    SELECT count(*) FROM public.ari_evaluation_scenarios WHERE status = 'active'
  ) THEN
    RAISE EXCEPTION 'incomplete_evaluation_suite';
  END IF;
  v_pass_rate := v_passed::numeric / v_total;
  v_status := CASE WHEN v_passed = v_total THEN 'passed' ELSE 'failed' END;
  UPDATE public.ari_evaluation_runs
  SET status = v_status,
      summary = jsonb_build_object('total', v_total, 'passed', v_passed, 'failed', v_total - v_passed, 'pass_rate', v_pass_rate),
      completed_at = now()
  WHERE id = p_run_id RETURNING * INTO v_run;
  IF v_run.proposal_id IS NOT NULL THEN
    SELECT case_id INTO v_case_id FROM public.ari_improvement_proposals WHERE id = v_run.proposal_id;
    UPDATE public.ari_improvement_proposals
    SET status = CASE WHEN v_status = 'passed' THEN 'evaluating' ELSE 'approved_for_eval' END,
        updated_at = now()
    WHERE id = v_run.proposal_id AND status = 'evaluating';
  END IF;
  INSERT INTO public.ari_quality_access_audit(actor_id, case_id, action, reason, metadata)
  VALUES (v_actor, v_case_id, 'evaluation_run', btrim(p_reason), jsonb_build_object('run_id', p_run_id, 'event', 'finished', 'status', v_status, 'pass_rate', v_pass_rate));
  PERFORM public.admin_write_audit(
    'ari.evaluation.finish', 'ari_evaluation_run', p_run_id::text,
    btrim(p_reason), jsonb_build_object('status', v_status, 'total', v_total, 'passed', v_passed)
  );
  RETURN to_jsonb(v_run) - 'requested_by';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_finish_evaluation(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_finish_evaluation(uuid, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_admin_cancel_evaluation(
  p_run_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_run public.ari_evaluation_runs%ROWTYPE;
  v_case_id uuid;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_run FROM public.ari_evaluation_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found'; END IF;
  IF v_run.status <> 'running' THEN RAISE EXCEPTION 'run_not_running'; END IF;
  UPDATE public.ari_evaluation_runs
  SET status = 'cancelled',
      summary = jsonb_build_object('cancelled_reason', btrim(p_reason)),
      completed_at = now()
  WHERE id = p_run_id
  RETURNING * INTO v_run;
  IF v_run.proposal_id IS NOT NULL THEN
    SELECT case_id INTO v_case_id FROM public.ari_improvement_proposals WHERE id = v_run.proposal_id;
    UPDATE public.ari_improvement_proposals
    SET status = 'approved_for_eval', updated_at = now()
    WHERE id = v_run.proposal_id AND status = 'evaluating';
  END IF;
  INSERT INTO public.ari_quality_access_audit(actor_id, case_id, action, reason, metadata)
  VALUES (v_actor, v_case_id, 'evaluation_run', btrim(p_reason), jsonb_build_object('run_id', p_run_id, 'event', 'cancelled'));
  PERFORM public.admin_write_audit(
    'ari.evaluation.cancel', 'ari_evaluation_run', p_run_id::text,
    btrim(p_reason), '{}'::jsonb
  );
  RETURN to_jsonb(v_run) - 'requested_by';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_cancel_evaluation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_cancel_evaluation(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ari_admin_control_rollout(
  p_action text,
  p_rollout_id uuid,
  p_runtime_version_id uuid,
  p_rollout_percent integer,
  p_audience jsonb,
  p_guardrails jsonb,
  p_rollback_version_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_rollout public.ari_rollouts%ROWTYPE;
  v_before text;
  v_percent integer := LEAST(GREATEST(COALESCE(p_rollout_percent, 0), 0), 100);
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_action = 'create_pilot' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ari_runtime_versions v
      JOIN public.ari_improvement_proposals p ON p.id = v.proposal_id
      WHERE v.id = p_runtime_version_id AND v.status = 'candidate' AND p.status = 'approved_for_rollout'
    ) THEN RAISE EXCEPTION 'approved_candidate_required'; END IF;
    IF p_rollback_version_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.ari_runtime_versions WHERE id = p_rollback_version_id AND status IN ('active', 'pilot')
    ) THEN RAISE EXCEPTION 'rollback_version_required'; END IF;
    IF COALESCE(jsonb_typeof(p_audience), '') <> 'object' OR COALESCE(jsonb_typeof(p_guardrails), '') <> 'object' THEN
      RAISE EXCEPTION 'invalid_rollout_config';
    END IF;
    INSERT INTO public.ari_rollouts(
      runtime_version_id, status, audience, rollout_percent, guardrails,
      rollback_version_id, created_by, approved_by, started_at
    ) VALUES (
      p_runtime_version_id, 'pilot', p_audience, LEAST(GREATEST(v_percent, 1), 10),
      p_guardrails, p_rollback_version_id, v_actor, v_actor, now()
    ) RETURNING * INTO v_rollout;
    UPDATE public.ari_runtime_versions SET status = 'pilot', approved_by = v_actor, activated_at = now()
    WHERE id = p_runtime_version_id;
  ELSE
    SELECT * INTO v_rollout FROM public.ari_rollouts WHERE id = p_rollout_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'rollout_not_found'; END IF;
    v_before := v_rollout.status;
    IF p_action = 'expand' THEN
      IF v_rollout.status NOT IN ('pilot', 'expanding') OR v_percent <= v_rollout.rollout_percent THEN RAISE EXCEPTION 'invalid_rollout_expansion'; END IF;
      UPDATE public.ari_rollouts SET status = CASE WHEN v_percent = 100 THEN 'active' ELSE 'expanding' END,
        rollout_percent = v_percent, approved_by = v_actor, updated_at = now() WHERE id = v_rollout.id RETURNING * INTO v_rollout;
      IF v_percent = 100 THEN
        UPDATE public.ari_runtime_versions SET status = 'active', approved_by = v_actor, activated_at = COALESCE(activated_at, now()) WHERE id = v_rollout.runtime_version_id;
      END IF;
    ELSIF p_action = 'pause' THEN
      IF v_rollout.status NOT IN ('pilot', 'expanding', 'active') THEN RAISE EXCEPTION 'invalid_rollout_pause'; END IF;
      UPDATE public.ari_rollouts SET status = 'paused', updated_at = now() WHERE id = v_rollout.id RETURNING * INTO v_rollout;
    ELSIF p_action = 'resume' THEN
      IF v_rollout.status <> 'paused' THEN RAISE EXCEPTION 'invalid_rollout_resume'; END IF;
      UPDATE public.ari_rollouts SET status = CASE WHEN rollout_percent = 100 THEN 'active' WHEN rollout_percent <= 10 THEN 'pilot' ELSE 'expanding' END,
        approved_by = v_actor, updated_at = now() WHERE id = v_rollout.id RETURNING * INTO v_rollout;
    ELSIF p_action = 'rollback' THEN
      IF v_rollout.status NOT IN ('pilot', 'expanding', 'active', 'paused') THEN RAISE EXCEPTION 'invalid_rollout_rollback'; END IF;
      UPDATE public.ari_rollouts SET status = 'rolled_back', rollout_percent = 0, approved_by = v_actor,
        completed_at = now(), updated_at = now() WHERE id = v_rollout.id RETURNING * INTO v_rollout;
      UPDATE public.ari_runtime_versions SET status = 'rolled_back', retired_at = now() WHERE id = v_rollout.runtime_version_id;
      UPDATE public.ari_runtime_versions SET status = 'active', activated_at = COALESCE(activated_at, now()) WHERE id = v_rollout.rollback_version_id;
      UPDATE public.ari_improvement_proposals SET status = 'rolled_back', updated_at = now()
      WHERE id = (SELECT proposal_id FROM public.ari_runtime_versions WHERE id = v_rollout.runtime_version_id);
    ELSIF p_action = 'complete' THEN
      IF v_rollout.status <> 'active' OR v_rollout.rollout_percent <> 100 THEN RAISE EXCEPTION 'active_rollout_required'; END IF;
      UPDATE public.ari_rollouts SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_rollout.id RETURNING * INTO v_rollout;
      UPDATE public.ari_improvement_proposals SET status = 'shipped', updated_at = now()
      WHERE id = (SELECT proposal_id FROM public.ari_runtime_versions WHERE id = v_rollout.runtime_version_id);
    ELSE RAISE EXCEPTION 'invalid_rollout_action'; END IF;
  END IF;
  INSERT INTO public.ari_quality_access_audit(actor_id, action, reason, metadata)
  VALUES (v_actor, 'rollout_change', btrim(p_reason), jsonb_build_object('rollout_id', v_rollout.id, 'action', p_action, 'from', v_before, 'to', v_rollout.status, 'percent', v_rollout.rollout_percent));
  PERFORM public.admin_write_audit(
    'ari.rollout.' || p_action, 'ari_rollout', v_rollout.id::text,
    btrim(p_reason), jsonb_build_object('status', v_rollout.status, 'percent', v_rollout.rollout_percent)
  );
  RETURN to_jsonb(v_rollout) - 'created_by' - 'approved_by';
END;
$$;
REVOKE ALL ON FUNCTION public.ari_admin_control_rollout(text, uuid, uuid, integer, jsonb, jsonb, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_admin_control_rollout(text, uuid, uuid, integer, jsonb, jsonb, uuid, text) TO authenticated, service_role;

-- A user deleting the live conversation must never cascade the independently
-- sanitised training asset. Instead, sever all reversible source references.
CREATE OR REPLACE FUNCTION public.ari_unlink_training_on_conversation_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.ari_training_turns
  SET source_user_id = NULL,
      source_conversation_id = NULL,
      source_user_message_id = NULL,
      source_assistant_message_id = NULL,
      source_deleted_at = now()
  WHERE source_conversation_id = OLD.id;

  UPDATE public.ari_quality_cases
  SET source_user_id = NULL,
      source_conversation_id = NULL,
      retention_state = 'source_deleted',
      updated_at = now()
  WHERE source_conversation_id = OLD.id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.ari_unlink_training_on_conversation_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_unlink_training_on_conversation_delete() TO service_role;

DROP TRIGGER IF EXISTS ari_unlink_training_before_conversation_delete ON public.agent_conversations;
CREATE TRIGGER ari_unlink_training_before_conversation_delete
BEFORE DELETE ON public.agent_conversations
FOR EACH ROW EXECUTE FUNCTION public.ari_unlink_training_on_conversation_delete();

COMMIT;
