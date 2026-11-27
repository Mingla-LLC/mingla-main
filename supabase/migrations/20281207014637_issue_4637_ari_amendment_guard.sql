-- Issue #4637 Slice 1: amendment safety, durable failure replies and the
-- schema reserved for later batch-confirmation support. All timestamps and
-- stale-card decisions use the database clock.

BEGIN;

ALTER TABLE public.agent_pending_actions
  ADD COLUMN IF NOT EXISTS owner_amended_message_id uuid
    REFERENCES public.agent_messages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.agent_pending_actions.owner_amended_message_id IS
  '#4637: owner message that made this Ari proposal unsafe to confirm.';

ALTER TABLE public.agent_pending_actions
  ADD COLUMN IF NOT EXISTS batch_items jsonb;

CREATE OR REPLACE FUNCTION public.ari_batch_items_valid(p_items jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT p_items IS NULL OR (
    jsonb_typeof(p_items) = 'array'
    AND jsonb_array_length(p_items) BETWEEN 2 AND 20
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) item
      WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
         OR jsonb_typeof(item->'args') IS DISTINCT FROM 'object'
    )
  )
$function$;

REVOKE ALL ON FUNCTION public.ari_batch_items_valid(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_batch_items_valid(jsonb)
  TO service_role;

ALTER TABLE public.agent_pending_actions
  DROP CONSTRAINT IF EXISTS agent_pending_actions_batch_items_check;
ALTER TABLE public.agent_pending_actions
  ADD CONSTRAINT agent_pending_actions_batch_items_check
  CHECK (public.ari_batch_items_valid(batch_items));

COMMENT ON COLUMN public.agent_pending_actions.batch_items IS
  '#4637: optional 2-20 item payload for one shared batch tool; Slice 3 owns execution.';

-- A JSON key inside agent_messages.content is client-writeable. The bare-yes
-- exemption therefore lives in a service-only binding table, not in content.
CREATE TABLE IF NOT EXISTS public.ari_pending_affirmation_bindings(
  user_message_id uuid PRIMARY KEY
    REFERENCES public.agent_messages(id) ON DELETE CASCADE,
  pending_action_id uuid NOT NULL
    REFERENCES public.agent_pending_actions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL
    REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(user_message_id, pending_action_id, user_id, conversation_id)
);
ALTER TABLE public.ari_pending_affirmation_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_pending_affirmation_bindings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ari_pending_affirmation_bindings
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ari_pending_affirmation_bindings TO service_role;

-- MINGLA-INVARIANT: I-ARI-AFFIRMATION-SERVER-BOUND | issue #4637 | Only the service can bind an exact bare affirmation to an older pending Ari proposal.
CREATE OR REPLACE FUNCTION public.ari_bind_pending_affirmation(
  p_user_id uuid,
  p_conversation_id uuid,
  p_user_message_id uuid,
  p_pending_action_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_text text;
  v_owner_at timestamptz;
  v_pending public.agent_pending_actions%ROWTYPE;
BEGIN
  SELECT owner_message.content->>'text',
         MAX(COALESCE(owner_attempt.counted_at, owner_message.created_at))
    INTO v_text, v_owner_at
  FROM public.agent_messages owner_message
  LEFT JOIN public.agent_turn_attempts owner_attempt
    ON owner_attempt.user_message_id = owner_message.id
   AND owner_attempt.user_id = owner_message.user_id
  WHERE owner_message.id = p_user_message_id
    AND owner_message.user_id = p_user_id
    AND owner_message.conversation_id = p_conversation_id
    AND owner_message.role = 'user'
    AND (owner_attempt.id IS NULL OR owner_attempt.origin = 'owner')
  GROUP BY owner_message.content, owner_message.created_at;
  IF NOT FOUND OR lower(btrim(COALESCE(v_text, ''))) <> ALL (
    ARRAY['yes','yep','ok','confirm','go ahead','do it','sure','please do']
  ) THEN
    RETURN false;
  END IF;

  SELECT * INTO v_pending
  FROM public.agent_pending_actions pending
  WHERE pending.id = p_pending_action_id
    AND pending.user_id = p_user_id
    AND pending.conversation_id = p_conversation_id
    AND pending.source = 'ari'
  FOR UPDATE;
  IF NOT FOUND OR v_pending.status <> 'pending'
     OR v_owner_at <= COALESCE(v_pending.server_proposed_at, v_pending.created_at) THEN
    RETURN false;
  END IF;

  INSERT INTO public.ari_pending_affirmation_bindings(
    user_message_id, pending_action_id, user_id, conversation_id
  ) VALUES (
    p_user_message_id, p_pending_action_id, p_user_id, p_conversation_id
  ) ON CONFLICT (user_message_id) DO NOTHING;
  RETURN EXISTS (
    SELECT 1 FROM public.ari_pending_affirmation_bindings binding
    WHERE binding.user_message_id = p_user_message_id
      AND binding.pending_action_id = p_pending_action_id
      AND binding.user_id = p_user_id
      AND binding.conversation_id = p_conversation_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ari_bind_pending_affirmation(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_bind_pending_affirmation(
  uuid, uuid, uuid, uuid
) TO service_role;

-- MINGLA-INVARIANT: I-ARI-AMENDMENT-BLOCKS-STALE-CONFIRM | issue #4637 | A pending Ari proposal cannot be confirmed after a newer non-affirmation owner message.
CREATE OR REPLACE FUNCTION public.ari_supersede_pending_on_owner_turn(
  p_user_id uuid,
  p_conversation_id uuid,
  p_user_message_id uuid
)
RETURNS TABLE(id uuid, tool_name text, tool_args jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_at timestamptz;
BEGIN
  SELECT MAX(COALESCE(owner_attempt.counted_at, owner_message.created_at))
    INTO v_owner_at
    FROM public.agent_messages owner_message
    LEFT JOIN public.agent_turn_attempts owner_attempt
      ON owner_attempt.user_message_id = owner_message.id
     AND owner_attempt.user_id = owner_message.user_id
    WHERE owner_message.id = p_user_message_id
      AND owner_message.user_id = p_user_id
      AND owner_message.conversation_id = p_conversation_id
      AND owner_message.role = 'user'
      AND (owner_attempt.id IS NULL OR owner_attempt.origin = 'owner')
  ;
  IF v_owner_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'owner message authority denied';
  END IF;

  RETURN QUERY
  UPDATE public.agent_pending_actions pending
  SET status = 'superseded',
      failure_reason = 'OWNER_AMENDED',
      owner_amended_message_id = p_user_message_id
  WHERE pending.user_id = p_user_id
    AND pending.conversation_id = p_conversation_id
    AND pending.source = 'ari'
    AND pending.status = 'pending'
    AND v_owner_at > COALESCE(
      (
        SELECT MAX(COALESCE(origin_attempt.counted_at, origin_message.created_at))
        FROM public.agent_messages origin_message
        LEFT JOIN public.agent_turn_attempts origin_attempt
          ON origin_attempt.user_message_id = origin_message.id
         AND origin_attempt.user_id = origin_message.user_id
        WHERE origin_message.user_id = pending.user_id
          AND origin_message.conversation_id = pending.conversation_id
          AND origin_message.role = 'user'
          AND origin_message.client_turn_id = pending.origin_client_turn_id
      ),
      pending.server_proposed_at,
      pending.created_at
    )
  RETURNING pending.id, pending.tool_name, pending.tool_args;
END;
$function$;

REVOKE ALL ON FUNCTION public.ari_supersede_pending_on_owner_turn(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_supersede_pending_on_owner_turn(
  uuid, uuid, uuid
) TO service_role;

-- Latest previous body: 20280306003355_issue_3355_ari_turn_hygiene.sql.
CREATE OR REPLACE FUNCTION public.agent_pending_action_claim_for_confirm(
  p_pending_action_id uuid,
  p_user_id uuid,
  p_tool_args jsonb DEFAULT NULL,
  p_probe_only boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pending public.agent_pending_actions%ROWTYPE;
BEGIN
  SELECT * INTO v_pending
  FROM public.agent_pending_actions pending
  WHERE pending.id = p_pending_action_id
    AND pending.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_pending.status <> 'pending' THEN
    RETURN v_pending.status;
  END IF;
  -- Preserve the existing state-machine precedence: an approval that is
  -- already expired answers expired, regardless of later chat history.
  IF v_pending.expires_at <= now() THEN
    RETURN 'expired';
  END IF;
  IF v_pending.source = 'ari' AND EXISTS (
    SELECT 1
    FROM public.agent_messages owner_message
    LEFT JOIN public.agent_turn_attempts owner_attempt
      ON owner_attempt.user_message_id = owner_message.id
     AND owner_attempt.user_id = owner_message.user_id
    WHERE owner_message.user_id = p_user_id
      AND owner_message.conversation_id = v_pending.conversation_id
      AND owner_message.role = 'user'
      AND (owner_attempt.id IS NULL OR owner_attempt.origin = 'owner')
      AND COALESCE(owner_attempt.counted_at, owner_message.created_at) > COALESCE(
        (
          SELECT MAX(COALESCE(origin_attempt.counted_at, origin_message.created_at))
          FROM public.agent_messages origin_message
          LEFT JOIN public.agent_turn_attempts origin_attempt
            ON origin_attempt.user_message_id = origin_message.id
           AND origin_attempt.user_id = origin_message.user_id
          WHERE origin_message.user_id = v_pending.user_id
            AND origin_message.conversation_id = v_pending.conversation_id
            AND origin_message.role = 'user'
            AND origin_message.client_turn_id = v_pending.origin_client_turn_id
        ),
        v_pending.server_proposed_at,
        v_pending.created_at
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.ari_pending_affirmation_bindings binding
        WHERE binding.user_message_id = owner_message.id
          AND binding.pending_action_id = v_pending.id
          AND binding.user_id = p_user_id
      )
  ) THEN
    UPDATE public.agent_pending_actions pending
    SET status = 'superseded',
        failure_reason = 'OWNER_AMENDED',
        owner_amended_message_id = (
          SELECT owner_message.id
          FROM public.agent_messages owner_message
          LEFT JOIN public.agent_turn_attempts owner_attempt
            ON owner_attempt.user_message_id = owner_message.id
           AND owner_attempt.user_id = owner_message.user_id
          WHERE owner_message.user_id = p_user_id
            AND owner_message.conversation_id = v_pending.conversation_id
            AND owner_message.role = 'user'
            AND (owner_attempt.id IS NULL OR owner_attempt.origin = 'owner')
            AND COALESCE(owner_attempt.counted_at, owner_message.created_at) > COALESCE(
              (
                SELECT MAX(COALESCE(origin_attempt.counted_at, origin_message.created_at))
                FROM public.agent_messages origin_message
                LEFT JOIN public.agent_turn_attempts origin_attempt
                  ON origin_attempt.user_message_id = origin_message.id
                 AND origin_attempt.user_id = origin_message.user_id
                WHERE origin_message.user_id = v_pending.user_id
                  AND origin_message.conversation_id = v_pending.conversation_id
                  AND origin_message.role = 'user'
                  AND origin_message.client_turn_id = v_pending.origin_client_turn_id
              ),
              v_pending.server_proposed_at,
              v_pending.created_at
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.ari_pending_affirmation_bindings binding
              WHERE binding.user_message_id = owner_message.id
                AND binding.pending_action_id = v_pending.id
                AND binding.user_id = p_user_id
            )
          ORDER BY COALESCE(owner_attempt.counted_at, owner_message.created_at) DESC,
                   owner_message.id DESC
          LIMIT 1
        )
    WHERE pending.id = v_pending.id AND pending.status = 'pending';
    RETURN 'stale_amended';
  END IF;

  -- A preflight is read-only for a valid card, but it must still commit the
  -- stale-amendment terminal state before any confirm-side mutation can run.
  IF p_probe_only THEN
    RETURN 'pending';
  END IF;

  IF p_tool_args IS NULL OR jsonb_typeof(p_tool_args) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'confirmed args required';
  END IF;

  UPDATE public.agent_pending_actions pending
  SET status = 'executing',
      tool_args = p_tool_args,
      execution_attested_at = now(),
      executing_started_at = now()
  WHERE pending.id = p_pending_action_id
    AND pending.user_id = p_user_id
    AND pending.status = 'pending';

  -- The card refresh surface changes only after the stale-amendment backstop
  -- accepts this claim, and in the same transaction as pending -> executing.
  UPDATE public.agent_messages message
  SET tool_calls = jsonb_build_object(
    'tool_name', v_pending.tool_name,
    'args', p_tool_args,
    'pending_action_id', v_pending.id::text
  )
  WHERE message.user_id = p_user_id
    AND message.conversation_id = v_pending.conversation_id
    AND message.role = 'assistant'
    AND message.tool_calls @> jsonb_build_object(
      'pending_action_id', v_pending.id::text
    );
  RETURN 'claimed';
END;
$function$;

REVOKE ALL ON FUNCTION public.agent_pending_action_claim_for_confirm(
  uuid, uuid, jsonb, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pending_action_claim_for_confirm(
  uuid, uuid, jsonb, boolean
) TO service_role;

-- Edited create-event cards replace the pending row rather than execute it.
-- Claim, stale-amendment validation, old-card cancellation and replacement
-- insertion are one transaction, so a newer owner turn cannot race between
-- the confirm backstop and the replacement write.
DROP FUNCTION IF EXISTS public.replace_agent_pending_action_for_edit(
  uuid, uuid, uuid, jsonb
);
CREATE OR REPLACE FUNCTION public.replace_agent_pending_action_for_edit(
  p_pending_action_id uuid,
  p_user_id uuid,
  p_replacement_pending_action_id uuid,
  p_tool_args jsonb,
  p_prompt_version text,
  p_model_version text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_answer text;
  v_pending public.agent_pending_actions%ROWTYPE;
BEGIN
  IF p_replacement_pending_action_id = p_pending_action_id
     OR p_tool_args IS NULL
     OR jsonb_typeof(p_tool_args) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'valid replacement required';
  END IF;

  v_answer := public.agent_pending_action_claim_for_confirm(
    p_pending_action_id,
    p_user_id,
    NULL,
    true
  );
  IF v_answer <> 'pending' THEN
    RETURN v_answer;
  END IF;

  SELECT * INTO STRICT v_pending
  FROM public.agent_pending_actions pending
  WHERE pending.id = p_pending_action_id
    AND pending.user_id = p_user_id;

  PERFORM *
  FROM public.terminalize_agent_pending_action(
    p_pending_action_id,
    p_user_id,
    'pending',
    'cancelled',
    NULL,
    'EDITED_REPLACEMENT:' || p_replacement_pending_action_id::text,
    p_prompt_version,
    p_model_version,
    false
  );

  INSERT INTO public.agent_pending_actions(
    id, user_id, conversation_id, origin_client_turn_id, related_brand_id,
    source, tool_name, tool_args, status, server_proposed_at
  ) VALUES (
    p_replacement_pending_action_id, p_user_id, v_pending.conversation_id,
    v_pending.origin_client_turn_id, v_pending.related_brand_id,
    COALESCE(v_pending.source, 'ari'), v_pending.tool_name, p_tool_args,
    'pending', v_pending.server_proposed_at
  );
  -- Keep any service-bound bare affirmation attached to the proposal lineage.
  -- The replacement still requires a new confirmation, but the old exact
  -- affirmation must not be reclassified as an amendment on that later tap.
  UPDATE public.ari_pending_affirmation_bindings binding
  SET pending_action_id = p_replacement_pending_action_id
  WHERE binding.pending_action_id = p_pending_action_id
    AND binding.user_id = p_user_id;
  RETURN 'replaced';
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_agent_pending_action_for_edit(
  uuid, uuid, uuid, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_agent_pending_action_for_edit(
  uuid, uuid, uuid, jsonb, text, text
) TO service_role;

-- MINGLA-INVARIANT: I-ARI-NO-SILENT-TURN | issue #4637 | Every claimed owner attempt that fails commits one plain-words assistant reply.
CREATE OR REPLACE FUNCTION public.commit_agent_chat_failure_turn(
  p_attempt_id uuid,
  p_attempt_number integer,
  p_user_id uuid,
  p_conversation_id uuid,
  p_client_turn_id uuid,
  p_assistant_message_id uuid,
  p_content jsonb,
  p_error_code text,
  p_prompt_version text,
  p_model_version text,
  p_expected_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.agent_turn_attempts%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_expected_status NOT IN ('accepted', 'running') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected attempt status invalid';
  END IF;
  IF NULLIF(btrim(COALESCE(p_content->>'text', '')), '') IS NULL
     OR p_content#>>'{structured,failure,v}' IS DISTINCT FROM '1'
     OR NULLIF(p_content#>>'{structured,failure,class}', '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'valid failure reply required';
  END IF;

  SELECT * INTO v_attempt
  FROM public.agent_turn_attempts attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.user_id = p_user_id
    AND attempt.conversation_id = p_conversation_id
    AND attempt.client_turn_id = p_client_turn_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.attempt_number <> p_attempt_number
     OR v_attempt.status <> p_expected_status THEN
    RETURN false;
  END IF;
  -- Capture ordering only after the row lock. A waiter must sort after the
  -- work that held the lock, not at the time it began waiting.
  v_now := clock_timestamp();

  INSERT INTO public.agent_messages(
    id, conversation_id, user_id, role, content, client_turn_id,
    prompt_version, model_version, created_at
  ) VALUES (
    p_assistant_message_id, p_conversation_id, p_user_id, 'assistant',
    p_content, p_client_turn_id, p_prompt_version, p_model_version, v_now
  );

  UPDATE public.agent_turn_attempts
  SET status = 'failed',
      error_code = left(p_error_code, 80),
      terminal_at = v_now,
      updated_at = v_now
  WHERE id = p_attempt_id;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_agent_chat_failure_turn(
  uuid, integer, uuid, uuid, uuid, uuid, jsonb, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_agent_chat_failure_turn(
  uuid, integer, uuid, uuid, uuid, uuid, jsonb, text, text, text, text
) TO service_role;

-- Confirmation failures are one transaction: terminal receipt, tool row,
-- pending status and the owner-visible failure reply either all commit or all
-- roll back. Calling the existing terminalizer inside this function keeps its
-- receipt and CAS authority as the one source of truth.
DROP FUNCTION IF EXISTS public.commit_agent_pending_failure_reply(
  uuid, uuid, jsonb, text, text
);
CREATE OR REPLACE FUNCTION public.terminalize_agent_pending_failure(
  p_pending_action_id uuid,
  p_user_id uuid,
  p_expected_status text,
  p_failure_reason text,
  p_content jsonb,
  p_prompt_version text,
  p_model_version text
)
RETURNS TABLE(
  id uuid,
  status text,
  cas_won boolean,
  conversation_id uuid,
  failure_message_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_terminal record;
  v_message_id uuid;
BEGIN
  IF NULLIF(btrim(COALESCE(p_content->>'text', '')), '') IS NULL
     OR p_content#>>'{structured,failure,v}' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'valid failure reply required';
  END IF;

  SELECT * INTO STRICT v_terminal
  FROM public.terminalize_agent_pending_action(
    p_pending_action_id,
    p_user_id,
    p_expected_status,
    'failed',
    NULL,
    p_failure_reason,
    p_prompt_version,
    p_model_version,
    false
  );

  IF v_terminal.conversation_id IS NULL THEN
    RETURN QUERY SELECT v_terminal.id, v_terminal.status,
      v_terminal.cas_won, v_terminal.conversation_id, NULL::uuid;
    RETURN;
  END IF;

  SELECT message.id INTO v_message_id
  FROM public.agent_messages message
  WHERE message.user_id = p_user_id
    AND message.conversation_id = v_terminal.conversation_id
    AND message.role = 'assistant'
    AND message.content->>'failure_for_pending_action_id' =
      p_pending_action_id::text
  LIMIT 1;
  IF NOT FOUND THEN
    v_message_id := gen_random_uuid();
    INSERT INTO public.agent_messages(
      id, conversation_id, user_id, role, content, client_turn_id,
      prompt_version, model_version, created_at
    ) VALUES (
      v_message_id, v_terminal.conversation_id, p_user_id, 'assistant',
      p_content || jsonb_build_object(
        'failure_for_pending_action_id', p_pending_action_id::text
      ),
      NULL, p_prompt_version, p_model_version,
      clock_timestamp()
    );
  END IF;
  RETURN QUERY SELECT v_terminal.id, v_terminal.status,
    v_terminal.cas_won, v_terminal.conversation_id, v_message_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.terminalize_agent_pending_failure(
  uuid, uuid, text, text, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terminalize_agent_pending_failure(
  uuid, uuid, text, text, jsonb, text, text
) TO service_role;

-- MINGLA-INVARIANT: I-ARI-NO-CARD-WITHOUT-PROSE | issue #4637 | An assistant proposal or rendition cannot be stored without a sentence.
CREATE OR REPLACE FUNCTION public.ari_require_card_prose()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.role = 'assistant'
     AND NULLIF(btrim(COALESCE(NEW.content->>'text', '')), '') IS NULL
     AND (
       NEW.tool_calls IS NOT NULL
       OR NEW.content#>'{structured,rendition}' IS NOT NULL
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'assistant cards require prose';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_messages_require_card_prose
  ON public.agent_messages;
CREATE TRIGGER agent_messages_require_card_prose
  BEFORE INSERT OR UPDATE OF content, tool_calls, role
  ON public.agent_messages
  FOR EACH ROW EXECUTE FUNCTION public.ari_require_card_prose();

REVOKE ALL ON FUNCTION public.ari_require_card_prose()
  FROM PUBLIC, anon, authenticated;

COMMIT;
