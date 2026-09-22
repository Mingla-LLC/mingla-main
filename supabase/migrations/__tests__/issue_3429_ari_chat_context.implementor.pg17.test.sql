-- Issue #3429 implementor PG17 proof: tenant isolation, one logical row,
-- pre-accept cancellation, attachment binding, title safety, and atomic
-- late-result suppression. The transaction leaves no fixture residue.

BEGIN;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000003421', 'authenticated', 'authenticated', 'owner3429@example.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000003422', 'authenticated', 'authenticated', 'other3429@example.invalid', now(), now());

INSERT INTO public.creator_accounts (id, email, display_name)
VALUES (
  '00000000-0000-4000-8000-000000003421',
  'owner3429@example.invalid',
  'Issue 3429 Owner'
);

INSERT INTO public.brands (id, account_id, name, slug)
VALUES (
  '00000000-0000-4000-8000-000000003423',
  '00000000-0000-4000-8000-000000003421',
  'Private Fixture Brand',
  'private-fixture-brand-3429'
);

INSERT INTO public.agent_attachments (
  id, user_id, brand_id, storage_path, original_filename, declared_mime,
  verified_mime, file_type, declared_size_bytes, verified_size_bytes, sha256,
  display_order, state, ready_at
) VALUES (
  '00000000-0000-4000-8000-000000003424',
  '00000000-0000-4000-8000-000000003421',
  '00000000-0000-4000-8000-000000003423',
  '00000000-0000-4000-8000-000000003421/00000000-0000-4000-8000-000000003423/00000000-0000-4000-8000-000000003424/source',
  'Seth-private-name-and-price.pdf',
  'application/pdf',
  'application/pdf',
  'pdf',
  128,
  128,
  repeat('a', 64),
  0,
  'ready',
  now()
);

CREATE TEMP TABLE issue_3429_claims (
  ordinal integer PRIMARY KEY,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  created boolean NOT NULL,
  title text NOT NULL
);

INSERT INTO issue_3429_claims
SELECT 1, claim.*
FROM public.claim_agent_chat_turn(
  '00000000-0000-4000-8000-000000003421',
  NULL,
  '00000000-0000-4000-8000-000000003423',
  '00000000-0000-4000-8000-000000003425',
  '{"text":"Please plan an event today for Seth at £9.99"}'::jsonb,
  ARRAY['00000000-0000-4000-8000-000000003424'::uuid],
  repeat('b', 64),
  repeat('c', 64),
  'tenant-v1',
  'test-model',
  now()
) claim;

INSERT INTO issue_3429_claims
SELECT 2, claim.*
FROM public.claim_agent_chat_turn(
  '00000000-0000-4000-8000-000000003421',
  (SELECT conversation_id FROM issue_3429_claims WHERE ordinal = 1),
  '00000000-0000-4000-8000-000000003423',
  '00000000-0000-4000-8000-000000003425',
  '{"text":"Please plan an event today for Seth at £9.99"}'::jsonb,
  ARRAY['00000000-0000-4000-8000-000000003424'::uuid],
  repeat('b', 64),
  repeat('c', 64),
  'tenant-v1',
  'test-model',
  now()
) claim;

DO $test$
DECLARE
  v_first issue_3429_claims%ROWTYPE;
  v_retry issue_3429_claims%ROWTYPE;
  v_stopped_before_acceptance boolean := false;
BEGIN
  SELECT * INTO STRICT v_first FROM issue_3429_claims WHERE ordinal = 1;
  SELECT * INTO STRICT v_retry FROM issue_3429_claims WHERE ordinal = 2;
  IF NOT v_first.created OR v_retry.created
    OR v_first.conversation_id <> v_retry.conversation_id
    OR v_first.message_id <> v_retry.message_id
    OR v_first.attempt_id <> v_retry.attempt_id
  THEN
    RAISE EXCEPTION 'issue_3429 logical turn forked on exact retry';
  END IF;
  IF v_first.title <> 'Plan an event with Ari today'
    OR v_first.title ~* '(seth|9\.99|private|\.pdf)'
  THEN
    RAISE EXCEPTION 'issue_3429 provisional title leaked user/file data: %', v_first.title;
  END IF;
  IF (SELECT count(*) FROM public.agent_messages WHERE client_turn_id = '00000000-0000-4000-8000-000000003425') <> 1 THEN
    RAISE EXCEPTION 'issue_3429 created more than one optimistic/canonical user row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.agent_attachments attachment
    WHERE attachment.id = '00000000-0000-4000-8000-000000003424'
      AND attachment.conversation_id = v_first.conversation_id
      AND attachment.message_id = v_first.message_id
      AND attachment.client_turn_id = '00000000-0000-4000-8000-000000003425'
      AND attachment.state = 'ready'
  ) THEN
    RAISE EXCEPTION 'issue_3429 attachment was not atomically bound to its turn';
  END IF;

  INSERT INTO public.agent_turn_claim_guards(user_id, client_turn_id, state)
  VALUES (
    '00000000-0000-4000-8000-000000003421',
    '00000000-0000-4000-8000-000000003426',
    'cancelled'
  );
  BEGIN
    PERFORM * FROM public.claim_agent_chat_turn(
      '00000000-0000-4000-8000-000000003421', NULL,
      '00000000-0000-4000-8000-000000003423',
      '00000000-0000-4000-8000-000000003426',
      '{"text":"must not persist"}'::jsonb, ARRAY[]::uuid[], repeat('d', 64),
      repeat('e', 64), 'tenant-v1', 'test-model', now()
    );
  EXCEPTION WHEN query_canceled THEN
    v_stopped_before_acceptance := true;
  END;
  IF NOT v_stopped_before_acceptance OR EXISTS (
    SELECT 1 FROM public.agent_turn_attempts
    WHERE client_turn_id = '00000000-0000-4000-8000-000000003426'
  ) THEN
    RAISE EXCEPTION 'issue_3429 pre-accept Stop did not prevent persistence';
  END IF;
END;
$test$;

-- A stopped current attempt cannot publish an assistant row later.
UPDATE public.agent_turn_attempts
SET status = 'running', started_at = now(), updated_at = now()
WHERE id = (SELECT attempt_id FROM issue_3429_claims WHERE ordinal = 1);
UPDATE public.agent_turn_attempts
SET status = 'stopped', terminal_at = now(), updated_at = now()
WHERE id = (SELECT attempt_id FROM issue_3429_claims WHERE ordinal = 1);

DO $test$
DECLARE
  v_committed boolean;
  v_claim issue_3429_claims%ROWTYPE;
  v_state jsonb;
  v_revision bigint;
BEGIN
  SELECT * INTO STRICT v_claim FROM issue_3429_claims WHERE ordinal = 1;
  SELECT task_state, task_state_revision INTO v_state, v_revision
  FROM public.agent_conversations WHERE id = v_claim.conversation_id;
  v_committed := public.commit_agent_chat_assistant_turn(
    v_claim.attempt_id, v_claim.attempt_number,
    '00000000-0000-4000-8000-000000003421', v_claim.conversation_id,
    v_revision, v_state, 'must not commit',
    '00000000-0000-4000-8000-000000003427', '{"text":"late"}'::jsonb,
    NULL, '00000000-0000-4000-8000-000000003425',
    'tenant-v1', 'test-model', now()
  );
  IF v_committed OR EXISTS (
    SELECT 1 FROM public.agent_messages
    WHERE id = '00000000-0000-4000-8000-000000003427'
  ) THEN
    RAISE EXCEPTION 'issue_3429 stopped attempt published a late result';
  END IF;
END;
$test$;

-- A live current attempt commits exactly once and advances the safe title from
-- provisional to generated only after the assistant row is durable.
INSERT INTO issue_3429_claims
SELECT 3, claim.*
FROM public.claim_agent_chat_turn(
  '00000000-0000-4000-8000-000000003421',
  (SELECT conversation_id FROM issue_3429_claims WHERE ordinal = 1),
  '00000000-0000-4000-8000-000000003423',
  '00000000-0000-4000-8000-000000003428',
  '{"text":"Continue safely"}'::jsonb,
  ARRAY[]::uuid[], repeat('f', 64), repeat('0', 64),
  'tenant-v1', 'test-model', now()
) claim;

UPDATE public.agent_turn_attempts
SET status = 'running', started_at = now(), updated_at = now()
WHERE id = (SELECT attempt_id FROM issue_3429_claims WHERE ordinal = 3);

DO $test$
DECLARE
  v_committed boolean;
  v_claim issue_3429_claims%ROWTYPE;
  v_state jsonb;
  v_revision bigint;
BEGIN
  SELECT * INTO STRICT v_claim FROM issue_3429_claims WHERE ordinal = 3;
  SELECT task_state, task_state_revision INTO v_state, v_revision
  FROM public.agent_conversations WHERE id = v_claim.conversation_id;
  v_committed := public.commit_agent_chat_assistant_turn(
    v_claim.attempt_id, v_claim.attempt_number,
    '00000000-0000-4000-8000-000000003421', v_claim.conversation_id,
    v_revision, v_state, 'Safe summary',
    '00000000-0000-4000-8000-000000003429', '{"text":"Complete"}'::jsonb,
    NULL, '00000000-0000-4000-8000-000000003428',
    'tenant-v1', 'test-model', now()
  );
  IF NOT v_committed
    OR (SELECT title_source FROM public.agent_conversations WHERE id = v_claim.conversation_id) <> 'generated'
    OR (SELECT status FROM public.agent_turn_attempts WHERE id = v_claim.attempt_id) <> 'completed'
    OR NOT EXISTS (
      SELECT 1 FROM public.agent_activity_events
      WHERE attempt_id = v_claim.attempt_id AND event_type = 'response_ready'
    )
    OR (SELECT count(*) FROM public.agent_messages WHERE id = '00000000-0000-4000-8000-000000003429') <> 1
  THEN
    RAISE EXCEPTION 'issue_3429 current attempt did not atomically commit response/title/event';
  END IF;
END;
$test$;

-- Owner rows are readable but never directly mutable; another tenant sees none.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000003421', true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_update_denied boolean := false;
BEGIN
  IF (SELECT count(*) FROM public.agent_attachments) <> 1
    OR (SELECT count(*) FROM public.agent_turn_attempts) <> 2
    OR (SELECT count(*) FROM public.agent_activity_events) <> 3
  THEN
    RAISE EXCEPTION 'issue_3429 owner cannot read own authority rows';
  END IF;
  BEGIN
    UPDATE public.agent_attachments SET state = 'failed';
  EXCEPTION WHEN insufficient_privilege THEN
    v_update_denied := true;
  END;
  IF NOT v_update_denied THEN
    RAISE EXCEPTION 'issue_3429 authenticated client mutated attachment authority';
  END IF;
END;
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000003422', true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.agent_attachments)
    OR EXISTS (SELECT 1 FROM public.agent_turn_attempts)
    OR EXISTS (SELECT 1 FROM public.agent_activity_events)
  THEN
    RAISE EXCEPTION 'issue_3429 tenant isolation failed';
  END IF;
END;
$test$;
RESET ROLE;

ROLLBACK;
