-- ORCH-1123 [Hub multi-select draft delete] — batch draft-discard RPC.
-- Replicates business_discard_event_draft's guards PER ROW, event_type-agnostic
-- (works for event/trip/experience — all rows in public.events). SKIP-and-report:
-- the batch never aborts on a bad row; returns a per-row outcome so the client
-- can surface "Deleted N, M couldn't be deleted" (no silent failure).
-- Source single-row RPC: 20260515000006_orch_0763d_draft_discard_rpc.sql
--
-- Migration version note: SPEC §2.1 specified 20260927000000, but a sibling
-- worktree (ORCH-1123-[booking-gate-rls]) already claimed that prefix. Bumped
-- to 20260928000002 to stay strictly monotonic across all worktrees + anchor
-- + the linked remote head (latest local/anchor = 20260926000000).

CREATE OR REPLACE FUNCTION public.business_discard_offering_drafts(
  p_event_ids uuid[]
) RETURNS TABLE (
  event_id uuid,
  outcome  text   -- 'deleted' | 'skipped_not_draft' | 'skipped_not_found' | 'forbidden'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_id      uuid;
  v_event   public.events%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Empty / null input → empty result set (no error).
  IF p_event_ids IS NULL OR array_length(p_event_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- De-duplicate ids defensively; iterate each.
  FOR v_id IN SELECT DISTINCT unnest(p_event_ids)
  LOOP
    -- Lock the row (NOWAIT-free: a brand's own drafts are not hot rows).
    SELECT * INTO v_event FROM public.events WHERE id = v_id FOR UPDATE;

    IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
      event_id := v_id; outcome := 'skipped_not_found'; RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_event.status <> 'draft' THEN
      event_id := v_id; outcome := 'skipped_not_draft'; RETURN NEXT;
      CONTINUE;
    END IF;

    -- Per-row rank gate on THAT row's brand — event_manager+ (mirrors single RPC).
    IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
         < public.biz_role_rank('event_manager'::text) THEN
      event_id := v_id; outcome := 'forbidden'; RETURN NEXT;
      CONTINUE;
    END IF;

    -- Brand must exist + not be deleted (mirrors single RPC).
    PERFORM 1 FROM public.brands
      WHERE id = v_event.brand_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      event_id := v_id; outcome := 'forbidden'; RETURN NEXT;
      CONTINUE;
    END IF;

    -- Soft-delete. The status='draft' + deleted_at IS NULL guard makes a
    -- second call a no-op (idempotent) — it would fall through to NOT FOUND
    -- on re-run because deleted_at is then set.
    UPDATE public.events
      SET deleted_at = now(), updated_at = now()
      WHERE id = v_id AND status = 'draft' AND deleted_at IS NULL;

    IF FOUND THEN
      event_id := v_id; outcome := 'deleted'; RETURN NEXT;
    ELSE
      -- Lost a race (concurrently deleted/published between SELECT and UPDATE).
      event_id := v_id; outcome := 'skipped_not_found'; RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.business_discard_offering_drafts(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_discard_offering_drafts(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.business_discard_offering_drafts(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.business_discard_offering_drafts(uuid[]) IS
  'ORCH-1123: batch server-authoritative soft-delete for business offering drafts (event/trip/experience), SKIP-and-report per row, restricted to event_manager rank or above.';
