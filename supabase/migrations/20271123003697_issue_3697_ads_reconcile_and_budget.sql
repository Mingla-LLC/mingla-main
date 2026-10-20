-- Issue #3697 — Admin Ads: clear dead plans after a provider check, and
-- change a live plan's budget through one governed, audited path.
--
-- 1. Dead-plan reconcile. A create that failed after the provider made
--    objects records their IDs and leaves the plan in
--    creation_failed_terminal. Nothing may release its funding hold while
--    provider objects might exist, so the hold stayed "held" for ever.
--    Production 2026-10-20: plan 534424c7 recorded Meta campaign
--    52609719519827, which no longer exists, and its $120 hold was held.
--    ad_plan_reconcile_clear accepts provider evidence (from ad-plan
--    `reconcile_provider_objects`), recomputes every recorded ID itself, and
--    only when each one is named absent: releases the hold, closes the plan
--    (cancelled_before_create) and writes a reconcile_cleared audit row.
--
-- 2. ad_status_events_action_check gains the reconcile and budget actions,
--    as the same union (widen only).
--
-- Additive and idempotent: new table/columns/functions only; no existing
-- row, constraint meaning or guard is weakened.

BEGIN;

-- ── 2. Audit actions (union; widen only) ────────────────────────────────────
ALTER TABLE public.ad_status_events
  DROP CONSTRAINT IF EXISTS ad_status_events_action_check;
ALTER TABLE public.ad_status_events
  ADD CONSTRAINT ad_status_events_action_check CHECK (action IN (
    -- campaign lifecycle (#862, #3697 v1.4)
    'create','launch','pause','sync','create_failed','rollback',
    'stop_requested','stop_confirmed','settlement',
    -- provider-native video preparation (#1184, admin-ad-creative-prepare)
    'prepare_begin','prepare_begin_failed','prepare_ref_saved','prepare_check',
    'prepare_ready','prepare_failed','prepare_timeout',
    -- provider previews (#1184, admin-ad-preview)
    'preview_request','preview_ready','preview_failed',
    -- dead-plan reconcile (#3697, ad-plan reconcile_provider_objects)
    'reconcile_check','reconcile_deleted','reconcile_cleared',
    -- governed budget change (#3697, admin-ad-campaign-action change_budget)
    'budget_change'
  ));

COMMENT ON CONSTRAINT ad_status_events_action_check ON public.ad_status_events IS
  'Issue #3697: union of every audited ad action. Widen only; a writer whose action is missing here fails its audit write. Guarded by supabase/functions/_shared/__tests__/issue_3697_ad_status_events_actions.test.ts.';

-- ── 1. Dead-plan reconcile ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ad_plan_reconcile_clear(
  p_plan_version_id uuid,
  p_plan_hash text,
  p_evidence jsonb,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
  v_missing text;
  v_platform text;
BEGIN
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_plan_version_hash_mismatch' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id FOR UPDATE;
  IF v_plan.owner_kind <> 'mingla'
     OR v_plan.current_version_id IS DISTINCT FROM v_version.id
     OR v_plan.state <> 'creation_failed_terminal' THEN
    RAISE EXCEPTION 'ad_plan_reconcile_state_invalid' USING ERRCODE = '55000';
  END IF;
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'array' THEN
    RAISE EXCEPTION 'ad_plan_reconcile_evidence_invalid' USING ERRCODE = '22023';
  END IF;
  -- A campaign row means Mingla operates the object: End plan settles it.
  IF EXISTS (
    SELECT 1 FROM public.ad_campaigns c WHERE c.plan_version_id = v_version.id
  ) THEN
    RAISE EXCEPTION 'ad_plan_campaign_rows_exist' USING ERRCODE = '55000';
  END IF;
  -- Any object the provider still has (or could not be checked) blocks clear.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_evidence) e
    WHERE jsonb_typeof(e) <> 'object'
       OR coalesce(e->>'verdict', '') <> 'absent'
       OR nullif(btrim(coalesce(e->>'external_id', '')), '') IS NULL
       OR nullif(btrim(coalesce(e->>'platform', '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'ad_plan_reconcile_object_not_absent' USING ERRCODE = '55000';
  END IF;
  -- Every ID the plan recorded must be named absent. The set is recomputed
  -- here from the attempts and create_failed rows, never taken from the
  -- caller: unknown keys count too, so a new ID shape fails closed.
  WITH recorded AS (
    SELECT a.platform, kv.value #>> '{}' AS external_id
    FROM public.ad_provider_attempts a,
         LATERAL jsonb_each(a.external_ids) kv
    WHERE a.plan_version_id = v_version.id
      AND a.command = 'create_paused_objects'
      AND jsonb_typeof(kv.value) IN ('string', 'number')
    UNION
    SELECT e.platform, kv.value #>> '{}'
    FROM public.ad_status_events e,
         LATERAL jsonb_each(e.external_ids - 'plan_version_id' - 'plan_hash') kv
    WHERE e.campaign_id IS NULL
      AND e.action = 'create_failed'
      AND e.external_ids->>'plan_version_id' = v_version.id::text
      AND e.external_ids->>'plan_hash' = v_version.plan_hash
      AND jsonb_typeof(kv.value) IN ('string', 'number')
    UNION
    SELECT e.platform, e.provider_response->>'creative_residue_id'
    FROM public.ad_status_events e
    WHERE e.campaign_id IS NULL
      AND e.action IN ('create_failed', 'rollback')
      AND e.external_ids->>'plan_version_id' = v_version.id::text
      AND e.external_ids->>'plan_hash' = v_version.plan_hash
      AND jsonb_typeof(e.provider_response->'creative_residue_id') IN ('string', 'number')
  )
  SELECT r.platform || ':' || r.external_id INTO v_missing
  FROM recorded r
  WHERE nullif(btrim(coalesce(r.external_id, '')), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_evidence) e
      WHERE e->>'platform' = r.platform
        AND e->>'external_id' = btrim(r.external_id)
        AND e->>'verdict' = 'absent'
    )
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ad_plan_reconcile_evidence_incomplete:%', v_missing
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_hold FROM public.ad_plan_funding_holds
  WHERE plan_version_id = v_version.id FOR UPDATE;
  IF FOUND THEN
    IF v_hold.funding_source <> 'mingla_provider_account' THEN
      RAISE EXCEPTION 'ad_plan_reconcile_host_credit_unsupported' USING ERRCODE = '55000';
    END IF;
    IF v_hold.state = 'held' THEN
      UPDATE public.ad_plan_funding_holds
      SET state = 'released',
          released_at = now(),
          released_by = p_actor_id,
          release_reason = 'provider_reconciled_absent'
      WHERE id = v_hold.id
      RETURNING * INTO v_hold;
    ELSIF v_hold.state NOT IN ('released', 'voided') THEN
      RAISE EXCEPTION 'ad_plan_funding_not_releasable' USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.ad_plans SET state = 'cancelled_before_create'
  WHERE id = v_plan.id RETURNING * INTO v_plan;

  SELECT a.platform INTO v_platform FROM public.ad_plan_provider_allocations a
  WHERE a.plan_version_id = v_version.id ORDER BY a.platform LIMIT 1;
  INSERT INTO public.ad_status_events (
    campaign_id, platform, entity, action, actor, from_status, to_status,
    external_ids, provider_response
  ) VALUES (
    NULL, v_platform, 'campaign', 'reconcile_cleared', p_actor_id,
    'creation_failed_terminal', 'cancelled_before_create',
    jsonb_build_object(
      'plan_id', v_plan.id,
      'plan_version_id', v_version.id,
      'plan_hash', v_version.plan_hash
    ),
    jsonb_build_object(
      'plan_name', v_version.canonical_plan->>'name',
      'platforms', (
        SELECT coalesce(jsonb_agg(a.platform ORDER BY a.platform), '[]'::jsonb)
        FROM public.ad_plan_provider_allocations a
        WHERE a.plan_version_id = v_version.id
      ),
      'hold_id', v_hold.id,
      'hold_state', v_hold.state,
      'hold_currency', v_hold.currency,
      'hold_amount_cents', v_hold.amount_cents,
      'evidence', p_evidence
    )
  );

  RETURN jsonb_build_object(
    'plan', to_jsonb(v_plan),
    'funding_hold', CASE WHEN v_hold.id IS NULL THEN NULL ELSE to_jsonb(v_hold) END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_plan_reconcile_clear(uuid, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_plan_reconcile_clear(uuid, text, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION public.ad_plan_reconcile_clear(uuid, text, jsonb, uuid) IS
  'Issue #3697: closes a creation_failed_terminal Mingla plan and releases its provider-account hold only when provider evidence names every recorded object absent.';

-- Self-verify inside the transaction.
DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conname = 'ad_status_events_action_check'
    AND c.conrelid = 'public.ad_status_events'::regclass;
  IF position('''reconcile_cleared''' IN v_def) = 0
     OR position('''budget_change''' IN v_def) = 0
     OR position('''prepare_begin''' IN v_def) = 0
     OR position('''settlement''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue3697: ad_status_events_action_check is not the full union: %', v_def;
  END IF;
  IF to_regprocedure('public.ad_plan_reconcile_clear(uuid,text,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue3697: ad_plan_reconcile_clear missing';
  END IF;
END;
$verify$;

COMMIT;
