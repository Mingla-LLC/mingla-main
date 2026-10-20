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
-- 3. Governed budget change. A plan version and its provider allocations are
--    immutable, and ad_campaign_plan_binding_guard keeps every campaign row
--    equal to them (unchanged here). A budget change is therefore an
--    append-only amendment bound to the exact plan version + hash
--    (ad_plan_budget_amendments). The campaign row carries the amended cap
--    and daily budget in separate columns that a guard keeps equal to the
--    latest amendment, so the 98% auto-pause enforces the new cap while the
--    frozen allocation stays the audit baseline. ad_plan_amend_budget refuses
--    a cap below spend-to-date and moves the provider-account hold to the new
--    cap (Mingla-owned plans only; nothing is charged).
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

-- ── 3. Governed budget change ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_plan_budget_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.ad_plans(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  campaign_id uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE RESTRICT,
  platform text NOT NULL CHECK (platform IN ('meta', 'tiktok', 'snapchat', 'google', 'reddit')),
  sequence integer NOT NULL CHECK (sequence > 0),
  provider_currency char(3) NOT NULL,
  previous_provider_budget_cents bigint NOT NULL CHECK (previous_provider_budget_cents > 0),
  new_provider_budget_cents bigint NOT NULL CHECK (new_provider_budget_cents > 0),
  previous_provider_delivery_budget_cents bigint NOT NULL CHECK (previous_provider_delivery_budget_cents > 0),
  new_provider_delivery_budget_cents bigint NOT NULL CHECK (
    new_provider_delivery_budget_cents > 0
    AND new_provider_delivery_budget_cents <= new_provider_budget_cents
  ),
  spend_to_date_cents bigint NOT NULL CHECK (spend_to_date_cents >= 0),
  previous_hold_cents bigint NOT NULL CHECK (previous_hold_cents > 0),
  new_hold_cents bigint NOT NULL CHECK (new_hold_cents > 0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  provider_evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_evidence) = 'object'),
  created_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, sequence),
  CONSTRAINT ad_plan_budget_amendment_cap_covers_spend CHECK (
    new_provider_budget_cents >= spend_to_date_cents
  )
);

CREATE INDEX IF NOT EXISTS ad_plan_budget_amendments_version_idx
  ON public.ad_plan_budget_amendments (plan_version_id);

COMMENT ON TABLE public.ad_plan_budget_amendments IS
  'Issue #3697: append-only budget amendments bound to an exact plan version + hash. The frozen allocation stays the baseline; the latest amendment per campaign is the enforced provider cap and daily budget.';

DROP TRIGGER IF EXISTS ad_plan_budget_amendments_immutable
  ON public.ad_plan_budget_amendments;
CREATE TRIGGER ad_plan_budget_amendments_immutable
  BEFORE UPDATE OR DELETE ON public.ad_plan_budget_amendments
  FOR EACH ROW EXECUTE FUNCTION public.ad_immutable_row_guard();

ALTER TABLE public.ad_plan_budget_amendments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_plan_budget_amendments_admin_read
  ON public.ad_plan_budget_amendments;
CREATE POLICY ad_plan_budget_amendments_admin_read
  ON public.ad_plan_budget_amendments
  FOR SELECT TO authenticated USING (public.is_admin_user());
REVOKE ALL ON public.ad_plan_budget_amendments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ad_plan_budget_amendments FROM authenticated;

ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS budget_amendment_id uuid NULL
    REFERENCES public.ad_plan_budget_amendments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS amended_provider_budget_cents bigint NULL
    CHECK (amended_provider_budget_cents IS NULL OR amended_provider_budget_cents > 0),
  ADD COLUMN IF NOT EXISTS amended_provider_delivery_budget_cents bigint NULL
    CHECK (amended_provider_delivery_budget_cents IS NULL OR amended_provider_delivery_budget_cents > 0);

COMMENT ON COLUMN public.ad_campaigns.amended_provider_budget_cents IS
  'Issue #3697: the enforced provider cap after a governed budget change. Always equal to the latest ad_plan_budget_amendments row for this campaign (guarded); NULL = the frozen allocation applies.';

-- The amended columns can only ever hold the latest amendment's values.
CREATE OR REPLACE FUNCTION public.ad_campaign_budget_amendment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_amendment public.ad_plan_budget_amendments%ROWTYPE;
BEGIN
  IF NEW.budget_amendment_id IS NULL THEN
    IF NEW.amended_provider_budget_cents IS NOT NULL
       OR NEW.amended_provider_delivery_budget_cents IS NOT NULL THEN
      RAISE EXCEPTION 'ad_campaign_budget_amendment_required' USING ERRCODE = '22023';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.budget_amendment_id IS NOT NULL THEN
      RAISE EXCEPTION 'ad_campaign_budget_amendment_immutable' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v_amendment FROM public.ad_plan_budget_amendments
  WHERE id = NEW.budget_amendment_id;
  IF NOT FOUND
     OR v_amendment.campaign_id <> NEW.id
     OR v_amendment.plan_version_id IS DISTINCT FROM NEW.plan_version_id
     OR v_amendment.plan_hash IS DISTINCT FROM NEW.plan_hash
     OR v_amendment.new_provider_budget_cents IS DISTINCT FROM NEW.amended_provider_budget_cents
     OR v_amendment.new_provider_delivery_budget_cents
          IS DISTINCT FROM NEW.amended_provider_delivery_budget_cents
     OR EXISTS (
       SELECT 1 FROM public.ad_plan_budget_amendments later
       WHERE later.campaign_id = NEW.id AND later.sequence > v_amendment.sequence
     ) THEN
    RAISE EXCEPTION 'ad_campaign_budget_amendment_mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ad_campaign_budget_amendment ON public.ad_campaigns;
CREATE TRIGGER ad_campaign_budget_amendment
  BEFORE INSERT OR UPDATE OF budget_amendment_id, amended_provider_budget_cents,
    amended_provider_delivery_budget_cents
  ON public.ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.ad_campaign_budget_amendment_guard();

-- p_changes: [{campaign_id, new_provider_budget_cents,
--              new_provider_delivery_budget_cents}] covering every campaign
-- of the plan. p_provider_evidence: what each provider confirmed.
CREATE OR REPLACE FUNCTION public.ad_plan_amend_budget(
  p_plan_version_id uuid,
  p_plan_hash text,
  p_changes jsonb,
  p_reason text,
  p_actor_id uuid,
  p_provider_evidence jsonb DEFAULT '{}'::jsonb
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
  v_campaign public.ad_campaigns%ROWTYPE;
  v_amendment public.ad_plan_budget_amendments%ROWTYPE;
  v_change jsonb;
  v_new_cap bigint;
  v_new_daily bigint;
  v_prev_cap bigint;
  v_prev_daily bigint;
  v_spend bigint;
  v_new_hold bigint;
  v_count integer;
  v_results jsonb := '[]'::jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF v_reason = '' THEN
    RAISE EXCEPTION 'ad_budget_reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array'
     OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'ad_budget_changes_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_provider_evidence IS NULL OR jsonb_typeof(p_provider_evidence) <> 'object' THEN
    RAISE EXCEPTION 'ad_budget_evidence_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_plan_version_hash_mismatch' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id FOR UPDATE;
  IF v_plan.owner_kind <> 'mingla' THEN
    RAISE EXCEPTION 'ad_budget_host_plans_not_supported' USING ERRCODE = '55000';
  END IF;
  IF v_plan.current_version_id IS DISTINCT FROM v_version.id
     OR v_plan.state NOT IN (
       'platform_review', 'scheduled', 'live', 'pause_requested', 'paused',
       'partially_ready', 'partially_live'
     ) THEN
    RAISE EXCEPTION 'ad_budget_plan_state_invalid' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_hold FROM public.ad_plan_funding_holds
  WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash
  FOR UPDATE;
  IF NOT FOUND OR v_hold.state <> 'held'
     OR v_hold.funding_source <> 'mingla_provider_account' THEN
    RAISE EXCEPTION 'ad_budget_funding_not_held' USING ERRCODE = '55000';
  END IF;
  -- Every campaign of the plan is listed exactly once.
  IF (SELECT count(*) FROM public.ad_campaigns c
      WHERE c.plan_version_id = v_version.id AND c.plan_hash = v_version.plan_hash)
     <> jsonb_array_length(p_changes)
     OR (SELECT count(DISTINCT e->>'campaign_id') FROM jsonb_array_elements(p_changes) e)
     <> jsonb_array_length(p_changes) THEN
    RAISE EXCEPTION 'ad_budget_changes_must_cover_every_campaign' USING ERRCODE = '22023';
  END IF;
  SELECT sum((e->>'new_provider_budget_cents')::bigint) INTO v_new_hold
  FROM jsonb_array_elements(p_changes) e;
  IF v_new_hold IS NULL OR v_new_hold <= 0 THEN
    RAISE EXCEPTION 'ad_budget_amount_invalid' USING ERRCODE = '22023';
  END IF;

  FOR v_change IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
    SELECT * INTO v_campaign FROM public.ad_campaigns
    WHERE id = (v_change->>'campaign_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_campaign.plan_version_id IS DISTINCT FROM v_version.id
       OR v_campaign.plan_hash IS DISTINCT FROM v_version.plan_hash THEN
      RAISE EXCEPTION 'ad_budget_campaign_plan_mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_campaign.fx_snapshot_id IS NOT NULL
       OR v_campaign.provider_currency IS DISTINCT FROM v_hold.currency::text THEN
      RAISE EXCEPTION 'ad_budget_fx_not_supported' USING ERRCODE = '55000';
    END IF;
    IF v_campaign.lifetime_budget_cents IS NOT NULL THEN
      RAISE EXCEPTION 'ad_budget_lifetime_not_supported' USING ERRCODE = '55000';
    END IF;
    v_new_cap := (v_change->>'new_provider_budget_cents')::bigint;
    v_new_daily := (v_change->>'new_provider_delivery_budget_cents')::bigint;
    IF v_new_cap IS NULL OR v_new_cap <= 0 OR v_new_daily IS NULL
       OR v_new_daily <= 0 OR v_new_daily > v_new_cap THEN
      RAISE EXCEPTION 'ad_budget_amount_invalid' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.ad_spend_daily s
      WHERE s.campaign_id = v_campaign.id
        AND upper(btrim(coalesce(s.currency, ''))) <> v_campaign.provider_currency
    ) THEN
      RAISE EXCEPTION 'ad_budget_spend_currency_mismatch' USING ERRCODE = '55000';
    END IF;
    SELECT coalesce(sum(s.spend_cents), 0) INTO v_spend
    FROM public.ad_spend_daily s WHERE s.campaign_id = v_campaign.id;
    IF v_new_cap < v_spend THEN
      RAISE EXCEPTION 'ad_budget_cap_below_spend:%:%', v_new_cap, v_spend
        USING ERRCODE = '22023';
    END IF;
    v_prev_cap := coalesce(v_campaign.amended_provider_budget_cents, v_campaign.provider_budget_cents);
    v_prev_daily := coalesce(
      v_campaign.amended_provider_delivery_budget_cents,
      v_campaign.provider_delivery_budget_cents
    );
    IF v_prev_cap IS NULL OR v_prev_daily IS NULL THEN
      RAISE EXCEPTION 'ad_budget_provider_money_unresolved' USING ERRCODE = '55000';
    END IF;
    SELECT count(*) INTO v_count FROM public.ad_plan_budget_amendments a
    WHERE a.campaign_id = v_campaign.id;
    INSERT INTO public.ad_plan_budget_amendments (
      plan_id, plan_version_id, plan_hash, campaign_id, platform, sequence,
      provider_currency, previous_provider_budget_cents, new_provider_budget_cents,
      previous_provider_delivery_budget_cents, new_provider_delivery_budget_cents,
      spend_to_date_cents, previous_hold_cents, new_hold_cents, reason,
      provider_evidence, created_by
    ) VALUES (
      v_plan.id, v_version.id, v_version.plan_hash, v_campaign.id,
      v_campaign.platform, v_count + 1, v_campaign.provider_currency,
      v_prev_cap, v_new_cap, v_prev_daily, v_new_daily, v_spend,
      v_hold.amount_cents, v_new_hold, left(v_reason, 1000),
      coalesce(p_provider_evidence->v_campaign.id::text, '{}'::jsonb), p_actor_id
    ) RETURNING * INTO v_amendment;
    UPDATE public.ad_campaigns
    SET budget_amendment_id = v_amendment.id,
        amended_provider_budget_cents = v_new_cap,
        amended_provider_delivery_budget_cents = v_new_daily,
        cap_cents = v_new_cap,
        daily_budget_cents = CASE
          WHEN daily_budget_cents IS NULL THEN NULL ELSE v_new_daily END
    WHERE id = v_campaign.id;
    INSERT INTO public.ad_status_events (
      campaign_id, platform, entity, action, actor, from_status, to_status,
      external_ids, provider_response
    ) VALUES (
      v_campaign.id, v_campaign.platform, 'campaign', 'budget_change', p_actor_id,
      v_campaign.status, v_campaign.status,
      jsonb_build_object(
        'external_campaign_id', v_campaign.external_campaign_id,
        'plan_version_id', v_version.id,
        'plan_hash', v_version.plan_hash,
        'budget_amendment_id', v_amendment.id
      ),
      jsonb_build_object(
        'reason', left(v_reason, 1000),
        'provider_currency', v_campaign.provider_currency,
        'previous_cap_cents', v_prev_cap,
        'new_cap_cents', v_new_cap,
        'previous_daily_cents', v_prev_daily,
        'new_daily_cents', v_new_daily,
        'spend_to_date_cents', v_spend,
        'provider', coalesce(p_provider_evidence->v_campaign.id::text, '{}'::jsonb)
      )
    );
    v_results := v_results || jsonb_build_array(to_jsonb(v_amendment));
  END LOOP;

  -- The provider-account hold follows the plan's new cap (no money moves).
  UPDATE public.ad_plan_funding_holds SET amount_cents = v_new_hold
  WHERE id = v_hold.id RETURNING * INTO v_hold;

  RETURN jsonb_build_object(
    'amendments', (
      v_results
    ),
    'funding_hold', to_jsonb(v_hold)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_plan_amend_budget(uuid, text, jsonb, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_plan_amend_budget(uuid, text, jsonb, text, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.ad_plan_amend_budget(uuid, text, jsonb, text, uuid, jsonb) IS
  'Issue #3697: records an append-only budget amendment for every campaign of a Mingla plan, refuses a cap below spend-to-date, and moves the provider-account hold to the new cap.';

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
  IF to_regprocedure('public.ad_plan_amend_budget(uuid,text,jsonb,text,uuid,jsonb)') IS NULL
     OR to_regclass('public.ad_plan_budget_amendments') IS NULL THEN
    RAISE EXCEPTION 'issue3697: budget amendment objects missing';
  END IF;
END;
$verify$;

COMMIT;
