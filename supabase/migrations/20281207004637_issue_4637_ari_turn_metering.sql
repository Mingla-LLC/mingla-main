-- Issue #4637 slice 0 — real Ari turn metering, terminal-attempt history and
-- database-clock activity/message ordering. Additive; no production rows are
-- backfilled and no host data policy is widened.

BEGIN;

ALTER TABLE public.ari_training_turns
  ADD COLUMN IF NOT EXISTS cached_input_tokens integer,
  ADD COLUMN IF NOT EXISTS thinking_tokens integer,
  ADD COLUMN IF NOT EXISTS model_calls smallint,
  ADD COLUMN IF NOT EXISTS route_tier text,
  ADD COLUMN IF NOT EXISTS stream_mode text,
  ADD COLUMN IF NOT EXISTS runtime_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS phase_ms jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS first_progress_ms integer,
  ADD COLUMN IF NOT EXISTS first_text_ms integer,
  ADD COLUMN IF NOT EXISTS complete_ms integer,
  ADD COLUMN IF NOT EXISTS pricing_version text,
  ADD COLUMN IF NOT EXISTS attempt_status text,
  ADD COLUMN IF NOT EXISTS answer_ready_ms integer,
  ADD COLUMN IF NOT EXISTS first_word_shown_ms integer,
  ADD COLUMN IF NOT EXISTS pace_tier text,
  ADD COLUMN IF NOT EXISTS held_ms integer NOT NULL DEFAULT 0;

ALTER TABLE public.ari_training_turns
  DROP CONSTRAINT IF EXISTS ari_training_turns_cached_input_nonnegative,
  DROP CONSTRAINT IF EXISTS ari_training_turns_thinking_nonnegative,
  DROP CONSTRAINT IF EXISTS ari_training_turns_model_calls_nonnegative,
  DROP CONSTRAINT IF EXISTS ari_training_turns_route_tier_check,
  DROP CONSTRAINT IF EXISTS ari_training_turns_stream_mode_check,
  DROP CONSTRAINT IF EXISTS ari_training_turns_phase_ms_object,
  DROP CONSTRAINT IF EXISTS ari_training_turns_first_progress_nonnegative,
  DROP CONSTRAINT IF EXISTS ari_training_turns_first_text_nonnegative,
  DROP CONSTRAINT IF EXISTS ari_training_turns_complete_nonnegative,
  DROP CONSTRAINT IF EXISTS ari_training_turns_attempt_status_check,
  DROP CONSTRAINT IF EXISTS ari_training_turns_answer_ready_nonnegative,
  DROP CONSTRAINT IF EXISTS ari_training_turns_first_word_shown_nonnegative,
  DROP CONSTRAINT IF EXISTS ari_training_turns_held_nonnegative;

CREATE OR REPLACE FUNCTION public.ari_phase_ms_is_valid(p_phase_ms jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT jsonb_typeof(p_phase_ms) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(p_phase_ms) AS phase(key, value)
      WHERE CASE
        WHEN jsonb_typeof(phase.value) = 'number' THEN
          (phase.value #>> '{}')::numeric < 0
          OR trunc((phase.value #>> '{}')::numeric) <>
            (phase.value #>> '{}')::numeric
        ELSE true
      END
    );
$function$;

REVOKE ALL ON FUNCTION public.ari_phase_ms_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ari_phase_ms_is_valid(jsonb)
  TO service_role;

ALTER TABLE public.ari_training_turns
  ADD CONSTRAINT ari_training_turns_cached_input_nonnegative
    CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  ADD CONSTRAINT ari_training_turns_thinking_nonnegative
    CHECK (thinking_tokens IS NULL OR thinking_tokens >= 0),
  ADD CONSTRAINT ari_training_turns_model_calls_nonnegative
    CHECK (model_calls IS NULL OR model_calls >= 0),
  ADD CONSTRAINT ari_training_turns_route_tier_check
    CHECK (route_tier IS NULL OR route_tier IN ('quick', 'considered', 'deep')),
  ADD CONSTRAINT ari_training_turns_stream_mode_check
    CHECK (stream_mode IS NULL OR stream_mode IN ('streamed', 'buffered', 'none')),
  ADD CONSTRAINT ari_training_turns_phase_ms_object
    CHECK (public.ari_phase_ms_is_valid(phase_ms)),
  ADD CONSTRAINT ari_training_turns_first_progress_nonnegative
    CHECK (first_progress_ms IS NULL OR first_progress_ms >= 0),
  ADD CONSTRAINT ari_training_turns_first_text_nonnegative
    CHECK (first_text_ms IS NULL OR first_text_ms >= 0),
  ADD CONSTRAINT ari_training_turns_complete_nonnegative
    CHECK (complete_ms IS NULL OR complete_ms >= 0),
  ADD CONSTRAINT ari_training_turns_attempt_status_check
    CHECK (attempt_status IS NULL OR attempt_status IN (
      'completed', 'failed', 'stopped', 'reconciliation_required'
    )),
  ADD CONSTRAINT ari_training_turns_answer_ready_nonnegative
    CHECK (answer_ready_ms IS NULL OR answer_ready_ms >= 0),
  ADD CONSTRAINT ari_training_turns_first_word_shown_nonnegative
    CHECK (first_word_shown_ms IS NULL OR first_word_shown_ms >= 0),
  ADD CONSTRAINT ari_training_turns_held_nonnegative
    CHECK (held_ms >= 0);

-- A protected action may continue the same owner turn in a later edge
-- request. Keep the originating client turn on the pending action so every
-- card in a continuation chain is attributed to the exact training row,
-- never whichever owner message happens to be latest at confirmation time.
ALTER TABLE public.agent_pending_actions
  ADD COLUMN IF NOT EXISTS origin_client_turn_id uuid;

COMMENT ON COLUMN public.agent_pending_actions.origin_client_turn_id IS
  '#4637: exact owner-turn lineage for post-approval model metering; chained Ari proposals inherit this value.';

CREATE TABLE IF NOT EXISTS public.ari_pending_action_metering_ledger (
  pending_action_id uuid PRIMARY KEY
    REFERENCES public.agent_pending_actions(id) ON DELETE CASCADE,
  training_turn_id uuid NOT NULL
    REFERENCES public.ari_training_turns(id) ON DELETE CASCADE,
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  cached_input_tokens integer NOT NULL CHECK (cached_input_tokens >= 0),
  thinking_tokens integer NOT NULL CHECK (thinking_tokens >= 0),
  model_calls smallint NOT NULL CHECK (model_calls > 0),
  phase_ms jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (public.ari_phase_ms_is_valid(phase_ms)),
  pricing_version text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.ari_pending_action_metering_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_pending_action_metering_ledger FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ari_pending_action_metering_ledger
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.ari_pending_action_metering_ledger
  TO service_role;

-- I-ARI-TURN-METERED: add one post-approval delta to its originating owner
-- turn. The ledger and aggregate update share this transaction, making a
-- confirm retry or concurrent replay an idempotent no-op. A missing historic
-- source row returns false; the already verified write is never rolled back.
CREATE OR REPLACE FUNCTION public.add_ari_pending_action_turn_metering(
  p_pending_action_id uuid,
  p_user_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_input_tokens integer,
  p_thinking_tokens integer,
  p_model_calls smallint,
  p_phase_ms jsonb,
  p_pricing_version text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_training_turn_id uuid;
  v_inserted integer;
  v_phase_ms jsonb;
  v_phase_name text;
  v_phase_value integer;
BEGIN
  IF p_pending_action_id IS NULL OR p_user_id IS NULL
     OR p_input_tokens < 0 OR p_output_tokens < 0
     OR p_cached_input_tokens < 0 OR p_thinking_tokens < 0
     OR p_model_calls <= 0
     OR p_phase_ms IS NULL
     OR NOT public.ari_phase_ms_is_valid(p_phase_ms)
     OR NULLIF(btrim(p_pricing_version), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid Ari metering delta';
  END IF;

  -- New proposals carry an exact lineage key. It is propagated unchanged to
  -- every chained proposal created by agent-confirm-action.
  SELECT training.id INTO v_training_turn_id
  FROM public.agent_pending_actions pending
  JOIN public.agent_messages owner_message
    ON owner_message.user_id = pending.user_id
   AND owner_message.conversation_id = pending.conversation_id
   AND owner_message.role = 'user'
   AND owner_message.client_turn_id = pending.origin_client_turn_id
  JOIN public.ari_training_turns training
    ON training.source_user_message_id = owner_message.id
  WHERE pending.id = p_pending_action_id
    AND pending.user_id = p_user_id
  ORDER BY owner_message.created_at DESC
  LIMIT 1
  FOR UPDATE OF training;

  -- Compatibility for a first-generation proposal created before the lineage
  -- column shipped. This uses the exact proposal message containing the
  -- pending id; it deliberately does not guess for old chained cards.
  IF NOT FOUND THEN
    SELECT training.id INTO v_training_turn_id
    FROM public.agent_pending_actions pending
    JOIN public.agent_messages proposal
      ON proposal.user_id = pending.user_id
     AND proposal.conversation_id = pending.conversation_id
     AND proposal.role = 'assistant'
     AND proposal.tool_calls @>
       jsonb_build_object('pending_action_id', pending.id::text)
    JOIN public.ari_training_turns training
      ON training.source_assistant_message_id = proposal.id
    WHERE pending.id = p_pending_action_id
      AND pending.user_id = p_user_id
    ORDER BY proposal.created_at DESC
    LIMIT 1
    FOR UPDATE OF training;
  END IF;

  IF v_training_turn_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.ari_pending_action_metering_ledger(
    pending_action_id, training_turn_id, input_tokens, output_tokens,
    cached_input_tokens, thinking_tokens, model_calls, phase_ms,
    pricing_version
  ) VALUES (
    p_pending_action_id, v_training_turn_id, p_input_tokens, p_output_tokens,
    p_cached_input_tokens, p_thinking_tokens, p_model_calls, p_phase_ms,
    p_pricing_version
  ) ON CONFLICT (pending_action_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN
    RETURN false;
  END IF;

  SELECT phase_ms INTO v_phase_ms
  FROM public.ari_training_turns
  WHERE id = v_training_turn_id;
  FOR v_phase_name, v_phase_value IN
    SELECT phase.key, (phase.value #>> '{}')::integer
    FROM jsonb_each(p_phase_ms) AS phase(key, value)
  LOOP
    v_phase_ms := jsonb_set(
      v_phase_ms,
      ARRAY[v_phase_name],
      to_jsonb(
        COALESCE((v_phase_ms ->> v_phase_name)::integer, 0) + v_phase_value
      ),
      true
    );
  END LOOP;

  UPDATE public.ari_training_turns training
  SET input_tokens = COALESCE(training.input_tokens, 0) + p_input_tokens,
      output_tokens = COALESCE(training.output_tokens, 0) + p_output_tokens,
      cached_input_tokens = COALESCE(training.cached_input_tokens, 0)
        + p_cached_input_tokens,
      thinking_tokens = COALESCE(training.thinking_tokens, 0)
        + p_thinking_tokens,
      model_calls = COALESCE(training.model_calls, 0) + p_model_calls,
      -- Recompute once from aggregate token totals. Adding separately-ceiled
      -- snapshots can overstate spend by one micro-dollar per continuation.
      estimated_cost_micros = ceil((
        (COALESCE(training.input_tokens, 0) + p_input_tokens)::numeric * 3
        + (
          COALESCE(training.output_tokens, 0) + p_output_tokens
          + COALESCE(training.thinking_tokens, 0) + p_thinking_tokens
        )::numeric * 15
      ) / 4)::bigint,
      phase_ms = v_phase_ms,
      pricing_version = p_pricing_version
  WHERE training.id = v_training_turn_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_ari_pending_action_turn_metering(
  uuid, uuid, integer, integer, integer, integer, smallint, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_ari_pending_action_turn_metering(
  uuid, uuid, integer, integer, integer, integer, smallint, jsonb, text
) TO service_role;

CREATE TABLE IF NOT EXISTS public.agent_turn_attempt_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.agent_turn_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  client_turn_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  origin text NOT NULL CHECK (origin IN ('owner', 'engine')),
  status text NOT NULL CHECK (status IN (
    'stopped', 'completed', 'failed', 'reconciliation_required'
  )),
  error_code text,
  accepted_at timestamptz NOT NULL,
  started_at timestamptz,
  terminal_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(attempt_id, attempt_number, status)
);

CREATE INDEX IF NOT EXISTS agent_turn_attempt_history_conversation
  ON public.agent_turn_attempt_history(conversation_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS agent_turn_attempt_history_owner_terminal
  ON public.agent_turn_attempt_history(user_id, recorded_at DESC)
  WHERE origin = 'owner';

ALTER TABLE public.agent_turn_attempt_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_turn_attempt_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_turn_attempt_history
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.agent_turn_attempt_history
  TO service_role;

CREATE OR REPLACE FUNCTION public.agent_turn_attempt_record_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IN ('stopped', 'completed', 'failed', 'reconciliation_required')
     AND (OLD.status IS DISTINCT FROM NEW.status
          OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number) THEN
    INSERT INTO public.agent_turn_attempt_history(
      attempt_id, user_id, conversation_id, client_turn_id, attempt_number,
      origin, status, error_code, accepted_at, started_at, terminal_at
    ) VALUES (
      NEW.id, NEW.user_id, NEW.conversation_id, NEW.client_turn_id,
      NEW.attempt_number, NEW.origin, NEW.status, NEW.error_code,
      NEW.accepted_at, NEW.started_at, NEW.terminal_at
    ) ON CONFLICT (attempt_id, attempt_number, status) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.agent_turn_attempt_record_terminal()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_turn_attempt_record_terminal()
  TO service_role;

DROP TRIGGER IF EXISTS agent_turn_attempt_record_terminal
  ON public.agent_turn_attempts;
CREATE TRIGGER agent_turn_attempt_record_terminal
  AFTER UPDATE ON public.agent_turn_attempts
  FOR EACH ROW EXECUTE FUNCTION public.agent_turn_attempt_record_terminal();

-- Latest body: 20281119014453_issue_4453_workspace_content_ranks.sql.
-- p_now remains in the public signature for compatibility; ordering uses the
-- database wall clock so an early caller timestamp cannot move a later event
-- before an earlier sequence.
CREATE OR REPLACE FUNCTION public.append_agent_activity_event(
  p_attempt_id uuid,
  p_user_id uuid,
  p_attempt_number integer,
  p_event_type text,
  p_now timestamptz DEFAULT now(),
  p_detail jsonb DEFAULT NULL
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
  v_created_at timestamptz;
BEGIN
  IF p_event_type NOT IN (
    'accepted', 'attachments_processing_started', 'model_started',
    'planning_started', 'research_started', 'verification_started',
    'workspace_read_started', 'approved_action_started',
    'automated_retry_started', 'finalizing_started', 'response_ready',
    'reconciliation_started', 'reconciliation_finished', 'stopped', 'failed',
    'site_step_started', 'site_step_done', 'site_step_failed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported activity event';
  END IF;
  IF p_detail IS NOT NULL AND (
    jsonb_typeof(p_detail) <> 'object' OR octet_length(p_detail::text) > 2048
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'activity detail must be a small object';
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

  -- The attempt lock serializes sequence assignment. Read the wall clock only
  -- after acquiring that lock, otherwise a blocked caller can receive a later
  -- sequence with an earlier timestamp.
  v_created_at := clock_timestamp();

  INSERT INTO public.agent_activity_events(
    attempt_id, user_id, conversation_id, client_turn_id,
    attempt_number, sequence, event_type, created_at, expires_at, detail
  ) VALUES (
    v_attempt.id, v_attempt.user_id, v_attempt.conversation_id,
    v_attempt.client_turn_id, p_attempt_number, v_sequence, p_event_type,
    v_created_at, v_created_at + interval '7 days', p_detail
  ) RETURNING * INTO v_event;
  RETURN v_event;
END;
$function$;

-- Latest body: 20270712003429_issue_3429_ari_chat_context.sql.
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
    p_model_version, clock_timestamp()
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

-- Latest body: 20270506001985_issue_1985_ari_conversation_task_state.sql.
CREATE OR REPLACE FUNCTION public.commit_agent_task_assistant_turn(
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
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'user_id required';
  END IF;

  UPDATE public.agent_conversations
  SET task_state = p_task_state,
      task_state_revision = p_expected_revision + 1,
      task_state_updated_at = p_now,
      updated_at = p_now,
      summary = p_summary,
      summary_through_message_id = p_assistant_message_id,
      summary_updated_at = p_now
  WHERE id = p_conversation_id
    AND user_id = p_user_id
    AND task_state_revision = p_expected_revision;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.agent_messages(
    id, conversation_id, user_id, role, content, tool_calls,
    client_turn_id, prompt_version, model_version, created_at
  ) VALUES (
    p_assistant_message_id, p_conversation_id, p_user_id, 'assistant',
    p_content, p_tool_calls, p_client_turn_id, p_prompt_version,
    p_model_version, clock_timestamp()
  );
  RETURN true;
END;
$function$;

COMMIT;
