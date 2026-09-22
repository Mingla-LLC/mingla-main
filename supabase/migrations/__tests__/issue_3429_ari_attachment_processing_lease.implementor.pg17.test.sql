-- Issue #3429 REWORK-1 implementor PG17 proof: the attachment processing
-- lease is enforced by the schema, not only by Edge code.
--   1. `processing` requires both a token and a start time.
--   2. A row may be claimed at most twice (processing_attempts 0-2).
--   3. A terminal write conditional on the wrong token changes zero rows; the
--      right token wins exactly once.
-- The transaction leaves no fixture residue.

BEGIN;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000003441', 'authenticated', 'authenticated',
  'lease3429@example.invalid', now(), now()
);

INSERT INTO public.creator_accounts (id, email, display_name)
VALUES (
  '00000000-0000-4000-8000-000000003441',
  'lease3429@example.invalid',
  'Issue 3429 Lease Owner'
);

INSERT INTO public.brands (id, account_id, name, slug)
VALUES (
  '00000000-0000-4000-8000-000000003443',
  '00000000-0000-4000-8000-000000003441',
  'Lease Fixture Brand',
  'lease-fixture-brand-3429'
);

INSERT INTO public.agent_attachments (
  id, user_id, brand_id, storage_path, original_filename, declared_mime,
  file_type, declared_size_bytes, display_order, state
) VALUES (
  '00000000-0000-4000-8000-000000003444',
  '00000000-0000-4000-8000-000000003441',
  '00000000-0000-4000-8000-000000003443',
  '00000000-0000-4000-8000-000000003441/00000000-0000-4000-8000-000000003443/00000000-0000-4000-8000-000000003444/source',
  'menu.jpg',
  'image/jpeg',
  'image',
  1024,
  0,
  'prepared'
);

DO $test$
DECLARE
  v_rejected boolean;
  v_rows integer;
  v_state text;
BEGIN
  -- 1. processing without a token is refused.
  v_rejected := false;
  BEGIN
    UPDATE public.agent_attachments
    SET state = 'processing', processing_started_at = now()
    WHERE id = '00000000-0000-4000-8000-000000003444';
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'issue_3429 processing row accepted without a lease token';
  END IF;

  -- 1b. processing without a start time is refused.
  v_rejected := false;
  BEGIN
    UPDATE public.agent_attachments
    SET state = 'processing',
        processing_token = '00000000-0000-4000-8000-0000000034a1'
    WHERE id = '00000000-0000-4000-8000-000000003444';
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'issue_3429 processing row accepted without a lease start';
  END IF;

  -- 2. a third claim cannot be recorded.
  v_rejected := false;
  BEGIN
    UPDATE public.agent_attachments
    SET processing_attempts = 3
    WHERE id = '00000000-0000-4000-8000-000000003444';
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'issue_3429 attachment accepted a third processing claim';
  END IF;

  -- A legitimate claim with token and start time is accepted.
  UPDATE public.agent_attachments
  SET state = 'processing',
      processing_token = '00000000-0000-4000-8000-0000000034a1',
      processing_started_at = now(),
      processing_attempts = processing_attempts + 1
  WHERE id = '00000000-0000-4000-8000-000000003444'
    AND state IN ('prepared', 'failed')
    AND processing_attempts < 2;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_3429 legitimate processing claim was refused';
  END IF;

  -- 3. a terminal write with a stale token changes nothing.
  UPDATE public.agent_attachments
  SET state = 'failed', failure_code = 'CORRUPT_FILE', updated_at = now()
  WHERE id = '00000000-0000-4000-8000-000000003444'
    AND state = 'processing'
    AND processing_token = '00000000-0000-4000-8000-0000000034a2';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  SELECT state INTO STRICT v_state
  FROM public.agent_attachments
  WHERE id = '00000000-0000-4000-8000-000000003444';
  IF v_rows <> 0 OR v_state <> 'processing' THEN
    RAISE EXCEPTION 'issue_3429 stale lease token changed a terminal state';
  END IF;

  UPDATE public.agent_attachments
  SET state = 'failed', failure_code = 'PROCESSING_INTERRUPTED', updated_at = now()
  WHERE id = '00000000-0000-4000-8000-000000003444'
    AND state = 'processing'
    AND processing_token = '00000000-0000-4000-8000-0000000034a1';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_3429 current lease token could not write its terminal state';
  END IF;
END
$test$;

ROLLBACK;
