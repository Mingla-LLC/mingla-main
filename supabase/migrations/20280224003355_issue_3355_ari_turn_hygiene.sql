-- Issue #3355 P1 — Ari turn and confirm hygiene.
--
-- Additive only: new columns with defaults, a widened status CHECK, two
-- triggers on agent_pending_actions and three service-role functions. Every
-- time decision here uses the database clock (now()), never the edge clock.
--
--   * agent_turn_attempts.origin    — only owner turns count toward the daily cap.
--   * agent_turn_attempts.counted_at — DB-clock stamp for the rolling window
--                                       (accepted_at is edge-clock and moves on retry).
--   * agent_pending_actions statuses 'superseded' and 'failed_unknown'.
--   * agent_pending_actions.executing_started_at — the lease start for executing.
--   * Ari proposals live 30 minutes (Hub keeps the 5-minute column default).
--   * A new Ari proposal supersedes older pending ones in the same chat.
--   * agent_turn_rate_window(user, client_turn_id) — replay recognition,
--     bounded in-flight check and the rolling 24 h owner-turn count with a
--     correct reset time.
--   * agent_pending_action_claim_for_confirm — pending -> executing with the
--     expiry decided by now().
--   * agent_pending_action_reconcile_stale — executing rows past their lease.

-- ---------------------------------------------------------------------------
-- Turn attempts: origin + DB-clock window stamp
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_turn_attempts
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'owner';
ALTER TABLE public.agent_turn_attempts
  DROP CONSTRAINT IF EXISTS agent_turn_attempts_origin_check;
ALTER TABLE public.agent_turn_attempts
  ADD CONSTRAINT agent_turn_attempts_origin_check
  CHECK (origin IN ('owner', 'engine'));

-- Nullable on purpose: only turns from the last day need a stamp, and stamping
-- every historic row with the migration time would put a whole history inside
-- today's window.
ALTER TABLE public.agent_turn_attempts
  ADD COLUMN IF NOT EXISTS counted_at timestamptz;
UPDATE public.agent_turn_attempts
SET counted_at = accepted_at
WHERE counted_at IS NULL
  AND accepted_at > now() - interval '25 hours';
ALTER TABLE public.agent_turn_attempts
  ALTER COLUMN counted_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_agent_turn_attempts_owner_window
  ON public.agent_turn_attempts(user_id, counted_at DESC)
  WHERE origin = 'owner';

COMMENT ON COLUMN public.agent_turn_attempts.origin IS
  '#3355 P1: owner = a turn the owner sent; engine = a turn the server flow runner created. Only owner turns count toward the daily Ari cap.';
COMMENT ON COLUMN public.agent_turn_attempts.counted_at IS
  '#3355 P1: database-clock time the turn was first claimed. The rolling 24 h window reads this, never the edge clock.';

-- ---------------------------------------------------------------------------
-- Pending actions: statuses, lease start
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_pending_actions
  DROP CONSTRAINT IF EXISTS agent_pending_actions_status_check;
ALTER TABLE public.agent_pending_actions
  ADD CONSTRAINT agent_pending_actions_status_check
  CHECK (status IN (
    'pending', 'executing', 'executed', 'cancelled', 'expired', 'failed',
    'superseded', 'failed_unknown'
  ));

ALTER TABLE public.agent_pending_actions
  ADD COLUMN IF NOT EXISTS executing_started_at timestamptz;

COMMENT ON COLUMN public.agent_pending_actions.executing_started_at IS
  '#3355 P1: database-clock start of the executing lease. An executing row older than 2 minutes no longer blocks chat; it is reconciled on the next turn.';

-- Ari proposals: 30 minutes on the database clock. The column default stays
-- 5 minutes for Hub sources. A row that arrives with exactly the default
-- (now() is fixed for the transaction) is an Ari insert that did not choose
-- an expiry; an explicit expiry is kept as given.
CREATE OR REPLACE FUNCTION public.agent_pending_actions_ari_ttl()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.source = 'ari'
     AND NEW.status = 'pending'
     AND NEW.expires_at = now() + interval '5 minutes' THEN
    NEW.expires_at := now() + interval '30 minutes';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_pending_actions_ari_ttl
  ON public.agent_pending_actions;
CREATE TRIGGER agent_pending_actions_ari_ttl
  BEFORE INSERT ON public.agent_pending_actions
  FOR EACH ROW EXECUTE FUNCTION public.agent_pending_actions_ari_ttl();

-- One live Ari proposal per chat: a new pending proposal supersedes older
-- pending ones in the same conversation. Nothing else changes on them.
CREATE OR REPLACE FUNCTION public.agent_pending_actions_supersede_older()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.source = 'ari' AND NEW.status = 'pending'
     AND NEW.conversation_id IS NOT NULL THEN
    UPDATE public.agent_pending_actions older
    SET status = 'superseded',
        failure_reason = 'SUPERSEDED'
    WHERE older.conversation_id = NEW.conversation_id
      AND older.user_id = NEW.user_id
      AND older.source = 'ari'
      AND older.status = 'pending'
      AND older.id <> NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.agent_pending_actions_supersede_older()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agent_pending_actions_supersede_older
  ON public.agent_pending_actions;
CREATE TRIGGER agent_pending_actions_supersede_older
  AFTER INSERT ON public.agent_pending_actions
  FOR EACH ROW EXECUTE FUNCTION public.agent_pending_actions_supersede_older();

-- ---------------------------------------------------------------------------
-- Rate window (DB clock)
-- ---------------------------------------------------------------------------
-- MINGLA-INVARIANT: I-ARI-RATE-LIMIT-POST-CLAIM | issue #3355 | A client_turn_id that is already claimed is never rate-limited, only owner turns count, an executing row older than 2 minutes never blocks, and the reset time is when the oldest counted turn leaves the 24 h window (enforced by supabase/migrations/__tests__/issue_3355_ari_turn_hygiene.implementor.pg17.test.sql).
CREATE OR REPLACE FUNCTION public.agent_turn_rate_window(
  p_user_id uuid,
  p_client_turn_id uuid DEFAULT NULL
)
RETURNS TABLE(
  allowed boolean,
  reason text,
  replay boolean,
  turn_count integer,
  turn_limit integer,
  reset_at timestamptz,
  retry_after_seconds integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit constant integer := 200;
  v_count integer;
  v_reset timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'user required';
  END IF;

  -- Recognition first: a turn that was already claimed is a replay and always
  -- answers with its stored result, whatever the cap says.
  IF p_client_turn_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.agent_turn_attempts attempt
    WHERE attempt.user_id = p_user_id
      AND attempt.client_turn_id = p_client_turn_id
  ) THEN
    RETURN QUERY SELECT true, NULL::text, true, NULL::integer, v_limit,
      NULL::timestamptz, NULL::integer;
    RETURN;
  END IF;

  -- In-flight: only a confirmation inside its 2-minute lease blocks.
  IF EXISTS (
    SELECT 1 FROM public.agent_pending_actions pending
    WHERE pending.user_id = p_user_id
      AND pending.status = 'executing'
      AND COALESCE(
        pending.executing_started_at,
        pending.execution_attested_at,
        pending.created_at
      ) > now() - interval '2 minutes'
  ) THEN
    RETURN QUERY SELECT false, 'rate_limited_inflight'::text, false,
      NULL::integer, v_limit, now() + interval '5 seconds', 5;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.agent_turn_attempts attempt
  WHERE attempt.user_id = p_user_id
    AND attempt.origin = 'owner'
    AND attempt.counted_at > now() - interval '24 hours';

  IF v_count < v_limit THEN
    RETURN QUERY SELECT true, NULL::text, false, v_count, v_limit,
      NULL::timestamptz, NULL::integer;
    RETURN;
  END IF;

  -- The window frees a slot when the (count - limit + 1)-th oldest counted
  -- turn turns 24 hours old. With count = limit that is the oldest one.
  SELECT attempt.counted_at + interval '24 hours' INTO v_reset
  FROM public.agent_turn_attempts attempt
  WHERE attempt.user_id = p_user_id
    AND attempt.origin = 'owner'
    AND attempt.counted_at > now() - interval '24 hours'
  ORDER BY attempt.counted_at ASC
  OFFSET (v_count - v_limit)
  LIMIT 1;

  RETURN QUERY SELECT false, 'rate_limited_daily'::text, false, v_count,
    v_limit, v_reset,
    GREATEST(1, ceil(extract(epoch FROM (v_reset - now())))::integer);
END;
$function$;

REVOKE ALL ON FUNCTION public.agent_turn_rate_window(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_turn_rate_window(uuid, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Confirm claim (DB clock)
-- ---------------------------------------------------------------------------
-- MINGLA-INVARIANT: I-ARI-DB-CLOCK-TTL | issue #3355 | Whether an Ari approval has expired is decided by the database clock inside agent_pending_action_claim_for_confirm, never by the edge clock (enforced by supabase/migrations/__tests__/issue_3355_ari_turn_hygiene.implementor.pg17.test.sql).
--
-- Answers one of:
--   'pending'      probe only: still pending and inside its expiry
--   'claimed'      flipped pending -> executing (args, attestation, lease)
--   'expired'      pending but past expires_at; nothing changed
--   'executing'    already executing (the caller may replay a receipt)
--   'not_found'    no such row for this user
--   any other terminal status as stored ('executed', 'cancelled', ...)
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
  IF v_pending.expires_at <= now() THEN
    RETURN 'expired';
  END IF;
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
  RETURN 'claimed';
END;
$function$;

REVOKE ALL ON FUNCTION public.agent_pending_action_claim_for_confirm(
  uuid, uuid, jsonb, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pending_action_claim_for_confirm(
  uuid, uuid, jsonb, boolean
) TO service_role;

-- ---------------------------------------------------------------------------
-- Stuck executing rows
-- ---------------------------------------------------------------------------
-- An executing row past its 2-minute lease:
--   * with an operation receipt -> executed (the write committed; the receipt
--     is the result), with the same terminal receipt + tool row a normal
--     confirm writes;
--   * without one, and older than 10 minutes (longer than any edge worker can
--     still be running) -> failed_unknown, with one plain owner line.
-- Rows in between stay executing (they no longer block chat).
CREATE OR REPLACE FUNCTION public.agent_pending_action_reconcile_stale(
  p_user_id uuid
)
RETURNS TABLE(
  pending_action_id uuid,
  conversation_id uuid,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row record;
  v_receipt public.agent_operation_receipts%ROWTYPE;
BEGIN
  FOR v_row IN
    SELECT pending.*
    FROM public.agent_pending_actions pending
    WHERE pending.user_id = p_user_id
      AND pending.status = 'executing'
      AND COALESCE(
        pending.executing_started_at,
        pending.execution_attested_at,
        pending.created_at
      ) <= now() - interval '2 minutes'
    ORDER BY pending.created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO v_receipt
    FROM public.agent_operation_receipts receipt
    WHERE receipt.operation_id = v_row.id
      AND receipt.user_id = p_user_id;
    IF FOUND THEN
      UPDATE public.agent_pending_actions pending
      SET status = 'executed', executed_at = now(),
          executed_result = v_receipt.result
      WHERE pending.id = v_row.id AND pending.status = 'executing';
      INSERT INTO public.agent_pending_action_terminal_receipts(
        pending_action_id, user_id, tool_name, outcome, result,
        failure_reason, prompt_version, model_version
      ) VALUES (
        v_row.id, p_user_id, v_row.tool_name, 'executed', v_receipt.result,
        NULL, 'stale-reconcile-v1', 'none'
      ) ON CONFLICT DO NOTHING;
      IF v_row.conversation_id IS NOT NULL THEN
        INSERT INTO public.agent_messages(
          conversation_id, user_id, role, content, tool_results,
          prompt_version, model_version
        ) VALUES (
          v_row.conversation_id, p_user_id, 'tool', jsonb_build_object('text', ''),
          jsonb_strip_nulls(jsonb_build_object(
            'tool_name', v_row.tool_name,
            'pending_action_id', v_row.id,
            'outcome', 'executed',
            'result', v_receipt.result
          )),
          'stale-reconcile-v1', 'none'
        );
      END IF;
      RETURN QUERY SELECT v_row.id, v_row.conversation_id, 'executed'::text;
    ELSIF COALESCE(
      v_row.executing_started_at, v_row.execution_attested_at, v_row.created_at
    ) <= now() - interval '10 minutes' THEN
      UPDATE public.agent_pending_actions pending
      SET status = 'failed_unknown', failure_reason = 'RESULT_UNKNOWN'
      WHERE pending.id = v_row.id AND pending.status = 'executing';
      IF v_row.conversation_id IS NOT NULL THEN
        INSERT INTO public.agent_messages(
          conversation_id, user_id, role, content,
          prompt_version, model_version
        ) VALUES (
          v_row.conversation_id, p_user_id, 'assistant',
          jsonb_build_object(
            'text',
            'I couldn''t confirm that change saved, so I''m not showing it as done. Ask me to check it and I''ll look it up.'
          ),
          'stale-reconcile-v1', 'none'
        );
      END IF;
      RETURN QUERY SELECT v_row.id, v_row.conversation_id, 'failed_unknown'::text;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.agent_pending_action_reconcile_stale(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pending_action_reconcile_stale(uuid)
  TO service_role;
