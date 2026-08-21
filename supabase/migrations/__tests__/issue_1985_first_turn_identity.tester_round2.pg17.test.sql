-- Issue #1985 independent tester proof: a retried first turn keeps one durable
-- identity for its caller. A changed retry body must neither fork a second
-- conversation nor replace the original user message, while another caller may
-- independently use the same client-generated turn id.

BEGIN;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  (
    '00000000-0000-4000-8000-000000001991',
    'authenticated',
    'authenticated',
    'issue1985-retry-owner@example.invalid',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000001992',
    'authenticated',
    'authenticated',
    'issue1985-retry-other@example.invalid',
    now(),
    now()
  );

CREATE TEMP TABLE issue_1985_first_turn_claims (
  caller uuid NOT NULL,
  attempt integer NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  created boolean NOT NULL
);
GRANT INSERT, SELECT ON issue_1985_first_turn_claims TO authenticated;

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000001991',
  true
);
SET LOCAL ROLE authenticated;

INSERT INTO issue_1985_first_turn_claims
SELECT
  '00000000-0000-4000-8000-000000001991'::uuid,
  1,
  claim.conversation_id,
  claim.message_id,
  claim.created
FROM public.claim_agent_first_turn(
  NULL,
  '00000000-0000-4000-8000-000000001993'::uuid,
  '{"text":"original first turn"}'::jsonb,
  'tenant-v1',
  'test-model'
) claim;

INSERT INTO issue_1985_first_turn_claims
SELECT
  '00000000-0000-4000-8000-000000001991'::uuid,
  2,
  claim.conversation_id,
  claim.message_id,
  claim.created
FROM public.claim_agent_first_turn(
  NULL,
  '00000000-0000-4000-8000-000000001993'::uuid,
  '{"text":"changed retry must not replace original"}'::jsonb,
  'tenant-v1',
  'test-model'
) claim;

RESET ROLE;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000001992',
  true
);
SET LOCAL ROLE authenticated;

INSERT INTO issue_1985_first_turn_claims
SELECT
  '00000000-0000-4000-8000-000000001992'::uuid,
  1,
  claim.conversation_id,
  claim.message_id,
  claim.created
FROM public.claim_agent_first_turn(
  NULL,
  '00000000-0000-4000-8000-000000001993'::uuid,
  '{"text":"independent caller"}'::jsonb,
  'tenant-v1',
  'test-model'
) claim;

RESET ROLE;

DO $$
DECLARE
  v_owner_first issue_1985_first_turn_claims%ROWTYPE;
  v_owner_retry issue_1985_first_turn_claims%ROWTYPE;
  v_other_first issue_1985_first_turn_claims%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_owner_first
  FROM issue_1985_first_turn_claims
  WHERE caller = '00000000-0000-4000-8000-000000001991'::uuid
    AND attempt = 1;

  SELECT * INTO STRICT v_owner_retry
  FROM issue_1985_first_turn_claims
  WHERE caller = '00000000-0000-4000-8000-000000001991'::uuid
    AND attempt = 2;

  SELECT * INTO STRICT v_other_first
  FROM issue_1985_first_turn_claims
  WHERE caller = '00000000-0000-4000-8000-000000001992'::uuid
    AND attempt = 1;

  IF v_owner_first.created IS DISTINCT FROM true
     OR v_owner_retry.created IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'issue_1985_first_turn_identity: retry was not reported as the existing claim';
  END IF;

  IF v_owner_first.conversation_id IS DISTINCT FROM v_owner_retry.conversation_id
     OR v_owner_first.message_id IS DISTINCT FROM v_owner_retry.message_id THEN
    RAISE EXCEPTION
      'issue_1985_first_turn_identity: retry forked conversation or message identity';
  END IF;

  IF v_other_first.created IS DISTINCT FROM true
     OR v_other_first.conversation_id = v_owner_first.conversation_id
     OR v_other_first.message_id = v_owner_first.message_id THEN
    RAISE EXCEPTION
      'issue_1985_first_turn_identity: client turn identity escaped caller scope';
  END IF;

  IF (
    SELECT count(*)
    FROM public.agent_conversations
    WHERE user_id = '00000000-0000-4000-8000-000000001991'::uuid
  ) <> 1 THEN
    RAISE EXCEPTION
      'issue_1985_first_turn_identity: retry left an orphan or duplicate conversation';
  END IF;

  IF (
    SELECT count(*)
    FROM public.agent_messages
    WHERE user_id = '00000000-0000-4000-8000-000000001991'::uuid
      AND role = 'user'
      AND client_turn_id = '00000000-0000-4000-8000-000000001993'::uuid
  ) <> 1 THEN
    RAISE EXCEPTION
      'issue_1985_first_turn_identity: retry persisted duplicate user messages';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_messages
    WHERE id = v_owner_first.message_id
      AND content = '{"text":"original first turn"}'::jsonb
  ) THEN
    RAISE EXCEPTION
      'issue_1985_first_turn_identity: retry replaced the canonical first-turn payload';
  END IF;
END;
$$;

ROLLBACK;
