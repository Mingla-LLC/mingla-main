-- Issue #3355 rework 9 (fix 3) — deleting a chat closes its open Ari flow run.
--
-- Local demo 2026-11-12: a host deleted a chat in the middle of an event
-- setup. ari_flow_runs.conversation_id is ON DELETE SET NULL, so the run
-- stayed `awaiting_owner` with no conversation: open, unreachable (resume
-- needs its own chat) and counted as a live setup until the 24 h idle rule.
--
--   * A BEFORE DELETE trigger on agent_conversations cancels every open run
--     (active, awaiting_*, blocked, parked) of the chat being deleted, and
--     marks it `conversation_deleted_at`, BEFORE the foreign key nulls the
--     link. Every delete path is covered: agent-conversation delete and
--     delete_all, an account deletion cascade, a service-role cleanup.
--     A closed run is left as it is. Re-deleting or re-running is a no-op.
--   * The expiry sweep (ari_flow_runs_expire_idle / _all, same signatures)
--     also closes, as `cancelled`, any still-open run marked
--     `conversation_deleted_at` (whatever its idle time), on top of the
--     unchanged 24 h idle rule.
--   * Data: an open chat-bound run (`one_per_subject`; every such run is
--     started inside a chat) whose chat is already gone is cancelled and
--     marked once. A brand-wide run with no chat (`one_per_brand`, which can
--     start outside a chat) is never touched by this rule.
--
-- Data hygiene, not behaviour behind the rollout switch: it applies to every
-- brand. Safe while origin/main's code is live (main never reads the new
-- column; cancelled is already a closed status for main's runner).
--
-- Static SQL only. Conflicts raise PT409, never 40001. Service-role only.
-- Invariant declared in
-- supabase/migrations/__tests__/issue_3355_flow_runs_close_on_chat_delete.implementor.pg17.test.sql.

BEGIN;

SET LOCAL lock_timeout = '10s';

ALTER TABLE public.ari_flow_runs
  ADD COLUMN IF NOT EXISTS conversation_deleted_at timestamptz NULL;

COMMENT ON COLUMN public.ari_flow_runs.conversation_deleted_at IS
  '#3355 rework 9: when the chat this run belonged to was deleted (the run was closed then).';

-- ── The chat delete closes its open runs, before the link is nulled ───────
CREATE OR REPLACE FUNCTION public.ari_flow_runs_close_for_deleted_chat()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.ari_flow_runs r
  SET status = 'cancelled',
      conversation_deleted_at = now(),
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      revision = r.revision + 1, updated_at = now()
  WHERE r.conversation_id = OLD.id
    AND r.status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked','parked');
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_runs_close_for_deleted_chat()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ari_flow_runs_close_on_chat_delete ON public.agent_conversations;
CREATE TRIGGER ari_flow_runs_close_on_chat_delete
  BEFORE DELETE ON public.agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.ari_flow_runs_close_for_deleted_chat();

-- ── Expire: one person's runs (same signature; + deleted-chat runs) ───────
CREATE OR REPLACE FUNCTION public.ari_flow_runs_expire_idle(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'flow_user_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ari_flow_runs r
  SET status = CASE WHEN r.conversation_deleted_at IS NOT NULL THEN 'cancelled' ELSE 'expired' END,
      lease_owner = NULL, lease_token = NULL,
      lease_expires_at = NULL, revision = r.revision + 1, updated_at = now()
  WHERE r.started_by = p_user_id
    AND r.status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked','parked')
    AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= now())
    AND (r.conversation_deleted_at IS NOT NULL
      OR public.ari_flow_run_last_activity(r) < now() - public.ari_flow_run_expire_after());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_runs_expire_idle(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_runs_expire_idle(uuid) TO service_role;

-- ── Expire: every run (same signature; + deleted-chat runs) ───────────────
CREATE OR REPLACE FUNCTION public.ari_flow_runs_expire_idle_all(
  p_limit integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'flow_sweep_limit_invalid' USING ERRCODE = '22023';
  END IF;
  WITH idle AS (
    SELECT r.id FROM public.ari_flow_runs r
     WHERE r.status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked','parked')
       AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= now())
       AND (r.conversation_deleted_at IS NOT NULL
         OR public.ari_flow_run_last_activity(r) < now() - public.ari_flow_run_expire_after())
     ORDER BY r.updated_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.ari_flow_runs r
  SET status = CASE WHEN r.conversation_deleted_at IS NOT NULL THEN 'cancelled' ELSE 'expired' END,
      lease_owner = NULL, lease_token = NULL,
      lease_expires_at = NULL, revision = r.revision + 1, updated_at = now()
  FROM idle
  WHERE r.id = idle.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_flow_runs_expire_idle_all(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_flow_runs_expire_idle_all(integer) TO service_role;

-- ── Data: chat-bound runs whose chat is already gone (idempotent) ─────────
UPDATE public.ari_flow_runs r
SET status = 'cancelled',
    conversation_deleted_at = COALESCE(r.conversation_deleted_at, now()),
    lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
    revision = r.revision + 1, updated_at = now()
WHERE r.conversation_id IS NULL
  AND r.concurrency = 'one_per_subject'
  AND r.status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked','parked');

COMMIT;
