-- #3429 adversarial PG17 proof: digest-bound recovery, service-only turn
-- authority, current-attempt CAS, and title provenance all fail closed.
BEGIN;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000003431', 'authenticated', 'authenticated', 'owner3429-adversarial@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000003432', 'authenticated', 'authenticated', 'other3429-adversarial@example.invalid', now(), now());
INSERT INTO public.creator_accounts (id, email, display_name)
VALUES ('00000000-0000-4000-8000-000000003431', 'owner3429-adversarial@example.invalid', '3429 adversarial owner');
INSERT INTO public.brands (id, account_id, name, slug)
VALUES ('00000000-0000-4000-8000-000000003433', '00000000-0000-4000-8000-000000003431', '3429 adversarial brand', '3429-adversarial-brand');

CREATE TEMP TABLE issue_3429_turns (
  ordinal integer PRIMARY KEY, conversation_id uuid NOT NULL, message_id uuid NOT NULL,
  attempt_id uuid NOT NULL, attempt_number integer NOT NULL, created boolean NOT NULL, title text NOT NULL
);
GRANT SELECT ON issue_3429_turns TO authenticated;

INSERT INTO issue_3429_turns
SELECT 1, claim.* FROM public.claim_agent_chat_turn(
  '00000000-0000-4000-8000-000000003431', NULL,
  '00000000-0000-4000-8000-000000003433',
  '00000000-0000-4000-8000-000000003434',
  '{"text":"Plan a safe event"}'::jsonb, ARRAY[]::uuid[], repeat('1', 64), repeat('2', 64),
  'tenant-v1', 'test-model', now()
) claim;
INSERT INTO issue_3429_turns
SELECT 2, claim.* FROM public.claim_agent_chat_turn(
  '00000000-0000-4000-8000-000000003431',
  (SELECT conversation_id FROM issue_3429_turns WHERE ordinal = 1),
  '00000000-0000-4000-8000-000000003433',
  '00000000-0000-4000-8000-000000003434',
  '{"text":"Plan a safe event"}'::jsonb, ARRAY[]::uuid[], repeat('1', 64), repeat('2', 64),
  'tenant-v1', 'test-model', now()
) claim;

DO $test$
DECLARE v_before integer; v_mismatch boolean := false;
BEGIN
  IF (SELECT created FROM issue_3429_turns WHERE ordinal = 1) IS NOT TRUE
    OR (SELECT created FROM issue_3429_turns WHERE ordinal = 2) IS NOT FALSE
    OR (SELECT count(DISTINCT attempt_id) FROM issue_3429_turns) <> 1
    OR (SELECT count(*) FROM public.agent_messages WHERE client_turn_id = '00000000-0000-4000-8000-000000003434') <> 1
  THEN RAISE EXCEPTION 'issue_3429 same id/digest did not recover one logical turn'; END IF;
  SELECT count(*) INTO v_before FROM public.agent_messages;
  BEGIN
    PERFORM * FROM public.claim_agent_chat_turn(
      '00000000-0000-4000-8000-000000003431', NULL,
      '00000000-0000-4000-8000-000000003433',
      '00000000-0000-4000-8000-000000003434',
      '{"text":"forged replacement"}'::jsonb, ARRAY[]::uuid[], repeat('f', 64), repeat('2', 64),
      'tenant-v1', 'test-model', now()
    );
  EXCEPTION WHEN unique_violation THEN v_mismatch := true;
  END;
  IF NOT v_mismatch OR (SELECT count(*) FROM public.agent_messages) <> v_before THEN
    RAISE EXCEPTION 'issue_3429 digest mismatch wrote or recovered authority';
  END IF;
END;
$test$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000003431', true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_rpc_denied boolean := false; v_assistant_denied boolean := false; v_tool_denied boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM public.claim_agent_chat_turn(
      '00000000-0000-4000-8000-000000003431', NULL,
      '00000000-0000-4000-8000-000000003433',
      '00000000-0000-4000-8000-000000003435',
      '{"text":"forged"}'::jsonb, ARRAY[]::uuid[], repeat('3', 64), repeat('4', 64),
      'tenant-v1', 'test-model', now()
    );
  EXCEPTION WHEN insufficient_privilege THEN v_rpc_denied := true;
  END;
  BEGIN
    INSERT INTO public.agent_messages(conversation_id, user_id, role, content)
    VALUES ((SELECT conversation_id FROM issue_3429_turns WHERE ordinal = 1), '00000000-0000-4000-8000-000000003431', 'assistant', '{"text":"forged"}');
  EXCEPTION WHEN insufficient_privilege THEN v_assistant_denied := true;
  END;
  BEGIN
    INSERT INTO public.agent_messages(conversation_id, user_id, role, content)
    VALUES ((SELECT conversation_id FROM issue_3429_turns WHERE ordinal = 1), '00000000-0000-4000-8000-000000003431', 'tool', '{"text":""}');
  EXCEPTION WHEN insufficient_privilege THEN v_tool_denied := true;
  END;
  IF NOT v_rpc_denied OR NOT v_assistant_denied OR NOT v_tool_denied THEN
    RAISE EXCEPTION 'issue_3429 authenticated client bypassed service turn authority';
  END IF;
END;
$test$;

RESET ROLE;
-- The fixture table is transaction-local to the PostgreSQL harness role; the
-- preceding authenticated probe already proves service-only RPC denial.
UPDATE public.agent_turn_attempts SET status = 'running', started_at = now(), updated_at = now()
WHERE id = (SELECT attempt_id FROM issue_3429_turns WHERE ordinal = 1);

DO $test$
DECLARE v_turn issue_3429_turns%ROWTYPE; v_state jsonb; v_revision bigint; v_committed boolean;
BEGIN
  SELECT * INTO STRICT v_turn FROM issue_3429_turns WHERE ordinal = 1;
  SELECT task_state, task_state_revision INTO v_state, v_revision FROM public.agent_conversations WHERE id = v_turn.conversation_id;
  v_committed := public.commit_agent_chat_assistant_turn(
    v_turn.attempt_id, v_turn.attempt_number, '00000000-0000-4000-8000-000000003431', v_turn.conversation_id,
    v_revision + 1, v_state, 'stale must fail', '00000000-0000-4000-8000-000000003436', '{"text":"late"}', NULL,
    '00000000-0000-4000-8000-000000003434', 'tenant-v1', 'test-model', now());
  IF v_committed THEN RAISE EXCEPTION 'issue_3429 stale revision committed'; END IF;
  v_committed := public.commit_agent_chat_assistant_turn(
    v_turn.attempt_id, v_turn.attempt_number, '00000000-0000-4000-8000-000000003431', v_turn.conversation_id,
    v_revision, v_state, 'safe summary', '00000000-0000-4000-8000-000000003437', '{"text":"one response"}', NULL,
    '00000000-0000-4000-8000-000000003434', 'tenant-v1', 'test-model', now());
  IF NOT v_committed THEN RAISE EXCEPTION 'issue_3429 live current attempt did not commit'; END IF;
  v_committed := public.commit_agent_chat_assistant_turn(
    v_turn.attempt_id, v_turn.attempt_number, '00000000-0000-4000-8000-000000003431', v_turn.conversation_id,
    v_revision + 1, v_state, 'duplicate', '00000000-0000-4000-8000-000000003438', '{"text":"duplicate"}', NULL,
    '00000000-0000-4000-8000-000000003434', 'tenant-v1', 'test-model', now());
  IF v_committed OR (SELECT count(*) FROM public.agent_messages WHERE conversation_id = v_turn.conversation_id AND role = 'assistant') <> 1 THEN
    RAISE EXCEPTION 'issue_3429 assistant commit was not exactly once';
  END IF;
END;
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000003431', true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_title_denied boolean := false;
BEGIN
  UPDATE public.agent_conversations SET summary = 'owner summary allowed'
  WHERE id = (SELECT conversation_id FROM issue_3429_turns WHERE ordinal = 1);
  BEGIN
    UPDATE public.agent_conversations SET title = 'forged title'
    WHERE id = (SELECT conversation_id FROM issue_3429_turns WHERE ordinal = 1);
  EXCEPTION WHEN insufficient_privilege THEN v_title_denied := true;
  END;
  IF NOT v_title_denied OR NOT EXISTS (
    SELECT 1 FROM public.agent_conversations WHERE id = (SELECT conversation_id FROM issue_3429_turns WHERE ordinal = 1)
      AND summary = 'owner summary allowed'
  ) THEN RAISE EXCEPTION 'issue_3429 title provenance or summary ownership regressed'; END IF;
END;
$test$;
RESET ROLE;
ROLLBACK;
