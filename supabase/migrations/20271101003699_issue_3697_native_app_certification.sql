-- toward #3697 — explicit, audited native-app provider certification lane.
-- This migration creates no provider object and authorizes no spend by itself.

BEGIN;

INSERT INTO public.admin_config(key,value)
VALUES ('enable_native_app_campaign_certification','true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=excluded.value;

ALTER TABLE public.ad_app_acquisition_canaries
  ADD COLUMN IF NOT EXISTS plan_version_id uuid NULL
    REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS plan_hash text NULL,
  ADD COLUMN IF NOT EXISTS approval_scope_hash text NULL,
  ADD COLUMN IF NOT EXISTS approval_requested_by uuid NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS approved_by uuid NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS approval_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS local_campaign_id uuid NULL
    REFERENCES public.ad_campaigns(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS provider_objects_created_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS provider_stop_confirmed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS provider_effective_status text NULL,
  ADD COLUMN IF NOT EXISTS actual_spend_cents bigint NULL;

ALTER TABLE public.ad_app_acquisition_canaries
  DROP CONSTRAINT IF EXISTS ad_app_acquisition_canaries_status_check,
  DROP CONSTRAINT IF EXISTS ad_app_acquisition_canaries_check,
  DROP CONSTRAINT IF EXISTS ad_app_acquisition_canaries_check1,
  DROP CONSTRAINT IF EXISTS ad_app_acquisition_canaries_check2,
  DROP CONSTRAINT IF EXISTS ad_app_canary_plan_binding_check,
  DROP CONSTRAINT IF EXISTS ad_app_canary_approval_request_check,
  DROP CONSTRAINT IF EXISTS ad_app_canary_approval_check,
  DROP CONSTRAINT IF EXISTS ad_app_canary_provider_object_check,
  DROP CONSTRAINT IF EXISTS ad_app_canary_running_check,
  DROP CONSTRAINT IF EXISTS ad_app_canary_stopped_check,
  DROP CONSTRAINT IF EXISTS ad_app_canary_passed_evidence_check,
  DROP CONSTRAINT IF EXISTS ad_app_canary_effective_status_shape_check;

ALTER TABLE public.ad_app_acquisition_canaries
  ADD CONSTRAINT ad_app_acquisition_canaries_status_check CHECK (
    status IN (
      'not_started','approval_required','approved_to_prepare','paused_ready',
      'running','paused_pending_evidence','passed','failed','expired'
    )
  ),
  ADD CONSTRAINT ad_app_canary_plan_binding_check CHECK (
    (plan_version_id IS NULL AND plan_hash IS NULL AND approval_scope_hash IS NULL)
    OR (
      plan_version_id IS NOT NULL
      AND plan_hash ~ '^[0-9a-f]{64}$'
      AND approval_scope_hash ~ '^[0-9a-f]{64}$'
    )
  ),
  ADD CONSTRAINT ad_app_canary_approval_request_check CHECK (
    status IN ('not_started','expired')
    OR (
      approval_requested_by IS NOT NULL
      AND approval_requested_at IS NOT NULL
      AND plan_version_id IS NOT NULL
    )
  ),
  ADD CONSTRAINT ad_app_canary_approval_check CHECK (
    status NOT IN (
      'approved_to_prepare','paused_ready','running',
      'paused_pending_evidence','passed'
    )
    OR (
      founder_approval_reference IS NOT NULL
      AND approved_spend_ceiling_cents > 0
      AND approved_currency ~ '^[A-Z]{3}$'
      AND approved_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND approval_expires_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT ad_app_canary_provider_object_check CHECK (
    status NOT IN ('paused_ready','running','paused_pending_evidence','passed')
    OR (
      local_campaign_id IS NOT NULL
      AND safe_provider_campaign_id IS NOT NULL
      AND provider_objects_created_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT ad_app_canary_running_check CHECK (
    status <> 'running' OR started_at IS NOT NULL
  ),
  ADD CONSTRAINT ad_app_canary_stopped_check CHECK (
    status NOT IN ('paused_pending_evidence','passed')
    OR (
      completed_at IS NOT NULL
      AND provider_stop_confirmed_at IS NOT NULL
      AND actual_spend_cents IS NOT NULL
      AND actual_spend_cents >= 0
      AND actual_spend_cents <= approved_spend_ceiling_cents
    )
  ),
  ADD CONSTRAINT ad_app_canary_passed_evidence_check CHECK (
    status <> 'passed'
    OR (safe_evidence IS NOT NULL AND evidence_expires_at IS NOT NULL)
  ),
  ADD CONSTRAINT ad_app_canary_effective_status_shape_check CHECK (
    provider_effective_status IS NULL
    OR provider_effective_status ~ '^[A-Za-z0-9_ -]{1,80}$'
  );

CREATE TABLE IF NOT EXISTS public.ad_app_canary_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_key text NOT NULL,
  os text NOT NULL CHECK (os IN ('ios','android')),
  provider text NOT NULL CHECK (
    provider IN ('meta','tiktok','snapchat','google','reddit')
  ),
  action text NOT NULL CHECK (
    action IN (
      'approval_requested','approved','provider_prepared','provider_started',
      'provider_stopped','spend_exceeded','evidence_passed','evidence_failed',
      'expired'
    )
  ),
  actor uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 240),
  idempotency_key uuid NOT NULL UNIQUE,
  expected_canary_version bigint NOT NULL CHECK (expected_canary_version >= 1),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  previous_state jsonb NOT NULL CHECK (jsonb_typeof(previous_state)='object'),
  new_state jsonb NOT NULL CHECK (jsonb_typeof(new_state)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (app_key,os,provider)
    REFERENCES public.ad_app_acquisition_canaries(app_key,os,provider)
    ON DELETE RESTRICT
);

ALTER TABLE public.ad_app_canary_audit
  DROP CONSTRAINT IF EXISTS ad_app_canary_audit_action_check;
ALTER TABLE public.ad_app_canary_audit
  ADD CONSTRAINT ad_app_canary_audit_action_check CHECK (
    action IN (
      'approval_requested','approved','provider_prepared','provider_started',
      'provider_stopped','spend_exceeded','evidence_passed','evidence_failed',
      'expired'
    )
  );

CREATE INDEX IF NOT EXISTS ad_app_canary_audit_cell_created_idx
  ON public.ad_app_canary_audit(app_key,os,provider,created_at DESC);

CREATE OR REPLACE FUNCTION public.tg_ad_app_canary_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
  RAISE EXCEPTION 'ad_app_canary_audit_immutable';
END;
$function$;

DROP TRIGGER IF EXISTS trg_ad_app_canary_audit_immutable
  ON public.ad_app_canary_audit;
CREATE TRIGGER trg_ad_app_canary_audit_immutable
  BEFORE UPDATE OR DELETE ON public.ad_app_canary_audit
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_app_canary_audit_immutable();

ALTER TABLE public.ad_app_canary_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad app canary audit admin can read"
  ON public.ad_app_canary_audit;
CREATE POLICY "ad app canary audit admin can read"
  ON public.ad_app_canary_audit FOR SELECT TO authenticated
  USING (public.is_admin_user());
REVOKE ALL ON public.ad_app_canary_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ad_app_canary_audit TO authenticated;
GRANT ALL ON public.ad_app_canary_audit TO service_role;

-- Any provider binding change already resets the canary to not_started. This
-- trigger also removes every stale approval/object/evidence field atomically.
CREATE OR REPLACE FUNCTION public.tg_ad_app_canary_clear_authority()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
  IF NEW.status='not_started' AND OLD.status IS DISTINCT FROM 'not_started' THEN
    NEW.plan_version_id := NULL;
    NEW.plan_hash := NULL;
    NEW.approval_scope_hash := NULL;
    NEW.approval_requested_by := NULL;
    NEW.approval_requested_at := NULL;
    NEW.founder_approval_reference := NULL;
    NEW.approved_spend_ceiling_cents := NULL;
    NEW.approved_currency := NULL;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.approval_expires_at := NULL;
    NEW.local_campaign_id := NULL;
    NEW.provider_objects_created_at := NULL;
    NEW.started_at := NULL;
    NEW.completed_at := NULL;
    NEW.provider_stop_confirmed_at := NULL;
    NEW.provider_effective_status := NULL;
    NEW.actual_spend_cents := NULL;
    NEW.safe_provider_campaign_id := NULL;
    NEW.safe_evidence := NULL;
    NEW.evidence_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ad_app_canary_clear_authority
  ON public.ad_app_acquisition_canaries;
CREATE TRIGGER trg_ad_app_canary_clear_authority
  BEFORE UPDATE ON public.ad_app_acquisition_canaries
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_app_canary_clear_authority();

CREATE OR REPLACE FUNCTION public.can_prepare_native_app_canary(
  p_app_key text,
  p_os text,
  p_provider text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.ad_app_provider_bindings b
    JOIN public.ad_app_targets t
      ON t.app_key=b.app_key AND t.os=b.os AND t.active=true
    JOIN LATERAL (
      SELECT r.id,r.checked_at,r.stale_at
      FROM public.ad_app_readiness_runs r
      WHERE r.app_key=b.app_key AND r.os=b.os
      ORDER BY r.checked_at DESC,r.id DESC
      LIMIT 1
    ) latest ON true
    JOIN public.ad_app_readiness_results result
      ON result.run_id=latest.id AND result.provider=b.provider
    WHERE b.app_key=p_app_key AND b.os=p_os AND b.provider=p_provider
      AND b.active=true
      AND b.payer_connection_id IS NOT NULL
      AND b.provider_app_id IS NOT NULL
      AND b.provider_measurement_id IS NOT NULL
      AND (b.provider<>'snapchat' OR b.provider_app_icon_media_id IS NOT NULL)
      AND latest.checked_at>b.readiness_invalidated_at
      AND latest.stale_at>clock_timestamp()
      AND result.verdict='ready'
  );
$function$;

REVOKE ALL ON FUNCTION public.can_prepare_native_app_canary(text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_prepare_native_app_canary(text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.can_create_native_app_canary(
  p_app_key text,
  p_os text,
  p_provider text,
  p_plan_version_id uuid,
  p_plan_hash text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
  SELECT COALESCE((
    SELECT c.value='true'::jsonb
    FROM public.admin_config c
    WHERE c.key='enable_native_app_campaign_certification'
  ),false)
  AND public.can_prepare_native_app_canary(p_app_key,p_os,p_provider)
  AND EXISTS (
    SELECT 1
    FROM public.ad_app_acquisition_canaries canary
    JOIN public.ad_plan_versions v ON v.id=canary.plan_version_id
    JOIN public.ad_plans p ON p.id=v.plan_id
    JOIN public.ad_plan_provider_allocations a
      ON a.plan_version_id=v.id AND a.platform=canary.provider
    JOIN public.ad_plan_funding_holds h
      ON h.plan_version_id=v.id AND h.plan_hash=v.plan_hash
    JOIN public.ad_plan_confirmations confirm
      ON confirm.plan_version_id=v.id AND confirm.plan_hash=v.plan_hash
    WHERE canary.app_key=p_app_key
      AND canary.os=p_os
      AND canary.provider=p_provider
      AND canary.status='approved_to_prepare'
      AND canary.plan_version_id=p_plan_version_id
      AND canary.plan_hash=lower(p_plan_hash)
      AND canary.approval_expires_at>clock_timestamp()
      AND canary.approved_spend_ceiling_cents=a.host_budget_cents
      AND canary.approved_currency=a.host_currency
      AND v.plan_hash=canary.plan_hash
      AND v.canonical_plan->>'certification_mode'='true'
      AND jsonb_array_length(v.canonical_plan->'platforms')=1
      AND v.canonical_plan->'platforms'->>0=p_provider
      AND v.destination_snapshot->>'app_key'=p_app_key
      AND v.destination_snapshot->>'os'=p_os
      AND p.current_version_id=v.id
      AND p.owner_kind='mingla'
      AND p.brand_id IS NULL
      AND h.state='held'
      AND confirm.required_phrase=confirm.provided_phrase
      AND NOT EXISTS (
        SELECT 1 FROM public.ad_plan_targeting_snapshots target
        WHERE target.plan_version_id=v.id AND (
          target.verdict IN ('unavailable','check_required')
          OR (target.verdict='broader' AND target.broader_accepted IS NOT TRUE)
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.can_create_native_app_canary(text,text,text,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_native_app_canary(text,text,text,uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.can_run_native_app_canary(
  p_app_key text,
  p_os text,
  p_provider text,
  p_plan_version_id uuid,
  p_plan_hash text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
  SELECT COALESCE((
    SELECT c.value='true'::jsonb FROM public.admin_config c
    WHERE c.key='enable_native_app_campaign_certification'
  ),false)
  AND public.can_prepare_native_app_canary(p_app_key,p_os,p_provider)
  AND EXISTS (
    SELECT 1
    FROM public.ad_app_acquisition_canaries canary
    JOIN public.ad_campaigns campaign ON campaign.id=canary.local_campaign_id
    JOIN public.ad_plan_versions v ON v.id=canary.plan_version_id
    JOIN public.ad_plans p ON p.id=v.plan_id
    JOIN public.ad_plan_provider_allocations a
      ON a.plan_version_id=v.id AND a.platform=canary.provider
    JOIN public.ad_plan_funding_holds h
      ON h.plan_version_id=v.id AND h.plan_hash=v.plan_hash
    JOIN public.ad_plan_confirmations confirm
      ON confirm.plan_version_id=v.id AND confirm.plan_hash=v.plan_hash
    WHERE canary.app_key=p_app_key AND canary.os=p_os
      AND canary.provider=p_provider AND canary.status='paused_ready'
      AND canary.plan_version_id=p_plan_version_id
      AND canary.plan_hash=lower(p_plan_hash)
      AND canary.approval_expires_at>clock_timestamp()
      AND campaign.plan_version_id=canary.plan_version_id
      AND campaign.plan_hash=canary.plan_hash
      AND campaign.platform=canary.provider
      AND campaign.external_campaign_id=canary.safe_provider_campaign_id
      AND campaign.status='PAUSED'
      AND canary.approved_spend_ceiling_cents=a.host_budget_cents
      AND canary.approved_currency=a.host_currency
      AND v.plan_hash=canary.plan_hash
      AND v.canonical_plan->>'certification_mode'='true'
      AND p.current_version_id=v.id
      AND p.owner_kind='mingla' AND p.brand_id IS NULL
      AND h.state='held'
      AND confirm.required_phrase=confirm.provided_phrase
      AND NOT EXISTS (
        SELECT 1 FROM public.ad_plan_targeting_snapshots target
        WHERE target.plan_version_id=v.id AND (
          target.verdict IN ('unavailable','check_required')
          OR (target.verdict='broader' AND target.broader_accepted IS NOT TRUE)
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.can_run_native_app_canary(text,text,text,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_run_native_app_canary(text,text,text,uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.transition_ad_app_canary(p_change jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_action text := p_change->>'action';
  v_app text := p_change->>'app_key';
  v_os text := p_change->>'os';
  v_provider text := p_change->>'provider';
  v_actor uuid := (p_change->>'actor')::uuid;
  v_reason text := btrim(p_change->>'reason');
  v_expected bigint := (p_change->>'expected_canary_version')::bigint;
  v_key uuid := (p_change->>'idempotency_key')::uuid;
  v_fingerprint text;
  v_existing public.ad_app_canary_audit%ROWTYPE;
  v_row public.ad_app_acquisition_canaries%ROWTYPE;
  v_previous jsonb;
  v_next jsonb;
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_allocation public.ad_plan_provider_allocations%ROWTYPE;
  v_phrase text;
  v_reference text;
  v_campaign_id text;
  v_local_campaign uuid;
  v_effective text;
  v_spend bigint;
  v_evidence jsonb;
  v_target public.ad_app_targets%ROWTYPE;
  v_settlement public.ad_campaign_settlements%ROWTYPE;
  v_media_source text;
BEGIN
  IF jsonb_typeof(p_change)<>'object'
     OR (p_change - ARRAY[
       'action','app_key','os','provider','actor','reason',
       'expected_canary_version','idempotency_key','plan_version_id','plan_hash',
       'approval_reference','confirm_phrase','external_campaign_id',
       'local_campaign_id','provider_effective_status','actual_spend_cents',
       'safe_evidence'
     ])<>'{}'::jsonb
     OR v_action NOT IN (
       'request_approval','approve','provider_prepared','provider_started',
       'provider_stopped','spend_exceeded','evidence_passed',
       'evidence_failed','expire'
     )
     OR v_app NOT IN ('explorer','business')
     OR v_os NOT IN ('ios','android')
     OR v_provider NOT IN ('meta','tiktok','snapchat','google','reddit')
     OR length(v_reason) NOT BETWEEN 8 AND 240
     OR NOT EXISTS (
       SELECT 1 FROM auth.users u
       JOIN public.admin_users a ON lower(a.email)=lower(u.email)
       WHERE u.id=v_actor AND a.status='active' AND a.role IN ('owner','admin')
     ) THEN
    RAISE EXCEPTION 'invalid_app_canary_transition';
  END IF;

  SELECT * INTO v_row FROM public.ad_app_acquisition_canaries
  WHERE app_key=v_app AND os=v_os AND provider=v_provider FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'app_canary_not_found'; END IF;

  v_fingerprint := encode(extensions.digest(convert_to(
    (p_change-'idempotency_key')::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO v_existing FROM public.ad_app_canary_audit
  WHERE idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.actor=v_actor
       AND v_existing.app_key=v_app
       AND v_existing.os=v_os
       AND v_existing.provider=v_provider
       AND v_existing.expected_canary_version=v_expected
       AND v_existing.request_fingerprint=v_fingerprint THEN
      RETURN v_existing.new_state || jsonb_build_object('idempotent_replay',true);
    END IF;
    RAISE EXCEPTION 'idempotency_key_conflict';
  END IF;
  IF v_row.canary_version<>v_expected THEN
    RAISE EXCEPTION 'canary_version_conflict';
  END IF;
  v_previous := to_jsonb(v_row);

  IF v_action='request_approval' THEN
    SELECT * INTO v_version FROM public.ad_plan_versions
    WHERE id=(p_change->>'plan_version_id')::uuid
      AND plan_hash=lower(p_change->>'plan_hash');
    IF NOT FOUND THEN RAISE EXCEPTION 'canary_plan_version_mismatch'; END IF;
    SELECT * INTO v_plan FROM public.ad_plans WHERE id=v_version.plan_id;
    SELECT * INTO v_allocation FROM public.ad_plan_provider_allocations
    WHERE plan_version_id=v_version.id AND platform=v_provider;
    IF v_row.status NOT IN ('not_started','approval_required','expired','failed')
       OR v_plan.current_version_id<>v_version.id
       OR v_plan.owner_kind<>'mingla' OR v_plan.brand_id IS NOT NULL
       OR v_version.canonical_plan->>'certification_mode'<>'true'
       OR jsonb_array_length(v_version.canonical_plan->'platforms')<>1
       OR v_version.canonical_plan->'platforms'->>0<>v_provider
       OR v_version.destination_snapshot->>'app_key'<>v_app
       OR v_version.destination_snapshot->>'os'<>v_os
       OR v_allocation.id IS NULL
       OR NOT public.can_prepare_native_app_canary(v_app,v_os,v_provider)
       OR NOT EXISTS (
         SELECT 1 FROM public.ad_plan_funding_holds h
         WHERE h.plan_version_id=v_version.id
           AND h.plan_hash=v_version.plan_hash AND h.state='held'
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.ad_plan_confirmations c
         WHERE c.plan_version_id=v_version.id AND c.plan_hash=v_version.plan_hash
           AND c.required_phrase=c.provided_phrase
       )
       OR EXISTS (
         SELECT 1 FROM public.ad_plan_targeting_snapshots target
         WHERE target.plan_version_id=v_version.id AND (
           target.verdict IN ('unavailable','check_required')
           OR (target.verdict='broader' AND target.broader_accepted IS NOT TRUE)
         )
       ) THEN
      RAISE EXCEPTION 'canary_plan_not_approvable';
    END IF;
    v_phrase := 'APPROVE '||upper(v_provider)||' '||upper(v_app)||' '
      ||upper(v_os)||' '||v_allocation.host_currency||' '
      ||v_allocation.host_budget_cents::text;
    UPDATE public.ad_app_acquisition_canaries SET
      status='approval_required', plan_version_id=v_version.id,
      plan_hash=v_version.plan_hash,
      approval_scope_hash=encode(extensions.digest(convert_to(
        jsonb_build_object(
          'app_key',v_app,'os',v_os,'provider',v_provider,
          'plan_version_id',v_version.id,'plan_hash',v_version.plan_hash,
          'currency',v_allocation.host_currency,
          'spend_ceiling_cents',v_allocation.host_budget_cents
        )::text,'UTF8'),'sha256'),'hex'),
      approval_requested_by=v_actor, approval_requested_at=clock_timestamp(),
      founder_approval_reference=NULL,
      approved_spend_ceiling_cents=v_allocation.host_budget_cents,
      approved_currency=v_allocation.host_currency,
      approved_by=NULL, approved_at=NULL, approval_expires_at=NULL,
      local_campaign_id=NULL, provider_objects_created_at=NULL,
      started_at=NULL, completed_at=NULL, provider_stop_confirmed_at=NULL,
      provider_effective_status=NULL, actual_spend_cents=NULL,
      safe_provider_campaign_id=NULL, safe_evidence=NULL,
      evidence_expires_at=NULL, canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row)||jsonb_build_object('required_phrase',v_phrase);
  ELSIF v_action='approve' THEN
    IF v_row.status<>'approval_required'
       OR NOT EXISTS (
         SELECT 1 FROM auth.users u
         JOIN public.admin_users a ON lower(a.email)=lower(u.email)
         WHERE u.id=v_actor AND a.status='active' AND a.role='owner'
       ) THEN
      RAISE EXCEPTION 'canary_owner_approval_required';
    END IF;
    v_reference := btrim(p_change->>'approval_reference');
    v_phrase := 'APPROVE '||upper(v_provider)||' '||upper(v_app)||' '
      ||upper(v_os)||' '||v_row.approved_currency||' '
      ||v_row.approved_spend_ceiling_cents::text;
    IF length(v_reference) NOT BETWEEN 8 AND 240
       OR p_change->>'confirm_phrase'<>v_phrase
       OR NOT public.can_prepare_native_app_canary(v_app,v_os,v_provider) THEN
      RAISE EXCEPTION 'canary_approval_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status='approved_to_prepare', founder_approval_reference=v_reference,
      approved_by=v_actor, approved_at=clock_timestamp(),
      approval_expires_at=clock_timestamp()+interval '24 hours',
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row)||jsonb_build_object('required_phrase',v_phrase);
  ELSIF v_action='provider_prepared' THEN
    v_campaign_id := btrim(p_change->>'external_campaign_id');
    v_local_campaign := (p_change->>'local_campaign_id')::uuid;
    v_effective := btrim(coalesce(p_change->>'provider_effective_status','PAUSED'));
    IF v_row.status<>'approved_to_prepare'
       OR v_row.approval_expires_at<=clock_timestamp()
       OR v_campaign_id !~ '^[A-Za-z0-9._:@/-]{1,160}$'
       OR length(v_effective) NOT BETWEEN 1 AND 80
       OR NOT EXISTS (
         SELECT 1 FROM public.ad_campaigns c
         WHERE c.id=v_local_campaign AND c.plan_version_id=v_row.plan_version_id
           AND c.plan_hash=v_row.plan_hash AND c.platform=v_provider
           AND c.external_campaign_id=v_campaign_id AND c.status='PAUSED'
       ) THEN
      RAISE EXCEPTION 'canary_provider_prepare_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status='paused_ready', local_campaign_id=v_local_campaign,
      safe_provider_campaign_id=v_campaign_id,
      provider_objects_created_at=clock_timestamp(),
      provider_effective_status=v_effective,
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  ELSIF v_action='provider_started' THEN
    v_effective := btrim(p_change->>'provider_effective_status');
    IF v_row.status<>'paused_ready'
       OR v_row.approval_expires_at<=clock_timestamp()
       OR length(v_effective) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'canary_provider_start_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status='running', started_at=clock_timestamp(),
      provider_effective_status=v_effective,
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  ELSIF v_action='provider_stopped' THEN
    v_effective := btrim(p_change->>'provider_effective_status');
    v_spend := (p_change->>'actual_spend_cents')::bigint;
    IF v_row.status<>'running'
       OR length(v_effective) NOT BETWEEN 1 AND 80
       OR v_spend<0
       OR NOT EXISTS (
         SELECT 1 FROM public.ad_campaign_settlements settlement
         WHERE settlement.campaign_id=v_row.local_campaign_id
           AND settlement.state IN (
             'stop_requested','provider_stopped','awaiting_final_spend',
             'ready_to_settle','settled','attention_required'
           )
       ) THEN
      RAISE EXCEPTION 'canary_provider_stop_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status=CASE WHEN v_spend<=approved_spend_ceiling_cents
        THEN 'paused_pending_evidence' ELSE 'failed' END,
      completed_at=clock_timestamp(),
      provider_stop_confirmed_at=clock_timestamp(),
      provider_effective_status=v_effective, actual_spend_cents=v_spend,
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  ELSIF v_action='spend_exceeded' THEN
    SELECT * INTO v_settlement FROM public.ad_campaign_settlements
    WHERE campaign_id=v_row.local_campaign_id;
    SELECT * INTO v_allocation FROM public.ad_plan_provider_allocations
    WHERE plan_version_id=v_row.plan_version_id AND platform=v_provider;
    IF v_row.status<>'paused_pending_evidence'
       OR v_settlement.state<>'attention_required'
       OR v_settlement.final_provider_spend_cents IS NULL
       OR v_allocation.id IS NULL THEN
      RAISE EXCEPTION 'canary_spend_failure_invalid';
    END IF;
    v_spend := CASE
      WHEN v_allocation.host_currency=v_allocation.provider_currency
        THEN v_settlement.final_provider_spend_cents
      ELSE public.ad_fx_convert_frozen_minor(
        v_settlement.final_provider_spend_cents,
        v_allocation.provider_currency,
        v_allocation.host_currency,
        v_allocation.fx_snapshot_id
      )
    END;
    IF v_spend<=v_row.approved_spend_ceiling_cents THEN
      RAISE EXCEPTION 'canary_spend_failure_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status='failed', actual_spend_cents=v_spend,
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  ELSIF v_action IN ('evidence_passed','evidence_failed') THEN
    v_evidence := p_change->'safe_evidence';
    SELECT * INTO v_target FROM public.ad_app_targets
    WHERE app_key=v_app AND os=v_os AND active=true;
    SELECT * INTO v_settlement FROM public.ad_campaign_settlements
    WHERE campaign_id=v_row.local_campaign_id;
    v_media_source := CASE v_provider
      WHEN 'meta' THEN 'facebook_int'
      WHEN 'tiktok' THEN 'tiktokglobal_int'
      WHEN 'snapchat' THEN 'snapchat_int'
      WHEN 'google' THEN 'googleadwords_int'
      WHEN 'reddit' THEN 'reddit_int'
    END;
    IF v_row.status<>'paused_pending_evidence'
       OR NOT public.is_safe_ad_app_canary_evidence(v_evidence)
       OR (v_evidence->>'result')<>(CASE v_action
         WHEN 'evidence_passed' THEN 'passed' ELSE 'failed' END)
       OR v_evidence->>'store_identifier'<>v_target.store_identifier
       OR v_evidence->>'device_os'<>v_os
       OR v_evidence->>'media_source'<>v_media_source
       OR v_evidence->>'campaign_id'<>v_row.safe_provider_campaign_id
       OR v_settlement.state<>'settled'
       OR v_settlement.final_host_spend_cents IS NULL
       OR v_settlement.final_host_spend_cents>v_row.approved_spend_ceiling_cents
       OR (v_evidence->>'install_timestamp')::timestamptz<v_row.started_at
       OR (v_evidence->>'install_timestamp')::timestamptz>v_row.completed_at THEN
      RAISE EXCEPTION 'canary_evidence_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status=CASE v_action WHEN 'evidence_passed' THEN 'passed' ELSE 'failed' END,
      safe_evidence=v_evidence,
      actual_spend_cents=v_settlement.final_host_spend_cents,
      evidence_expires_at=clock_timestamp()+interval '30 days',
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  ELSE
    IF v_row.status IN ('running','passed') THEN
      RAISE EXCEPTION 'canary_expire_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status='expired', canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  END IF;

  INSERT INTO public.ad_app_canary_audit(
    app_key,os,provider,action,actor,reason,idempotency_key,
    expected_canary_version,request_fingerprint,previous_state,new_state
  ) VALUES(
    v_app,v_os,v_provider,CASE v_action
      WHEN 'request_approval' THEN 'approval_requested'
      WHEN 'approve' THEN 'approved'
      WHEN 'expire' THEN 'expired'
      ELSE v_action END,
    v_actor,v_reason,v_key,v_expected,v_fingerprint,v_previous,v_next
  );
  RETURN v_next||jsonb_build_object('idempotent_replay',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.transition_ad_app_canary(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_ad_app_canary(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ad_record_canary_provider_attempt(
  p_plan_version_id uuid,
  p_plan_hash text,
  p_platform text,
  p_idempotency_key text,
  p_state text,
  p_external_ids jsonb DEFAULT '{}'::jsonb,
  p_provider_response jsonb DEFAULT NULL,
  p_error_detail text DEFAULT NULL
)
RETURNS public.ad_provider_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_attempt public.ad_provider_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id=p_plan_version_id AND plan_hash=lower(p_plan_hash);
  IF NOT FOUND
     OR v_version.canonical_plan->>'certification_mode'<>'true'
     OR p_state NOT IN ('running','succeeded','failed_retryable','failed_terminal')
     OR p_external_ids IS NULL OR jsonb_typeof(p_external_ids)<>'object'
     OR (p_provider_response IS NOT NULL AND jsonb_typeof(p_provider_response)<>'object')
     OR NOT public.can_create_native_app_canary(
       v_version.destination_snapshot->>'app_key',
       v_version.destination_snapshot->>'os',
       p_platform,v_version.id,v_version.plan_hash
     ) THEN
    RAISE EXCEPTION 'ad_canary_provider_attempt_invalid';
  END IF;
  INSERT INTO public.ad_provider_attempts(
    plan_id,plan_version_id,plan_hash,platform,command,idempotency_key,
    state,external_ids,provider_response,error_detail,started_at,completed_at
  ) VALUES(
    v_version.plan_id,v_version.id,v_version.plan_hash,p_platform,
    'create_paused_objects',btrim(p_idempotency_key),p_state,p_external_ids,
    p_provider_response,p_error_detail,clock_timestamp(),
    CASE WHEN p_state='running' THEN NULL ELSE clock_timestamp() END
  ) ON CONFLICT(platform,idempotency_key) DO UPDATE SET
    state=excluded.state,
    external_ids=excluded.external_ids,
    provider_response=excluded.provider_response,
    error_detail=excluded.error_detail,
    started_at=coalesce(public.ad_provider_attempts.started_at,excluded.started_at),
    completed_at=excluded.completed_at
  WHERE public.ad_provider_attempts.plan_version_id=excluded.plan_version_id
    AND public.ad_provider_attempts.plan_hash=excluded.plan_hash
    AND public.ad_provider_attempts.command=excluded.command
  RETURNING * INTO v_attempt;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_provider_idempotency_binding_mismatch';
  END IF;
  RETURN v_attempt;
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_record_canary_provider_attempt(
  uuid,text,text,text,text,jsonb,jsonb,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_record_canary_provider_attempt(
  uuid,text,text,text,text,jsonb,jsonb,text
) TO service_role;

-- Mingla-owned plans use the selected ad-account currency, while their
-- campaign row deliberately keeps host_currency NULL. Certification plans
-- consume the separate canary authority instead of borrowing normal launch.
CREATE OR REPLACE FUNCTION public.ad_campaign_plan_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_allocation public.ad_plan_provider_allocations%ROWTYPE;
BEGIN
  IF NEW.plan_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id=NEW.plan_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_plan_version_not_found' USING ERRCODE='23503';
  END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id=v_version.plan_id;
  SELECT * INTO v_allocation FROM public.ad_plan_provider_allocations
  WHERE plan_version_id=v_version.id AND platform=NEW.platform;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_campaign_provider_allocation_missing'
      USING ERRCODE='22023';
  END IF;
  IF NEW.plan_hash IS DISTINCT FROM v_version.plan_hash
     OR NEW.connection_id IS DISTINCT FROM v_allocation.connection_id
     OR NEW.host_currency IS DISTINCT FROM (CASE
       WHEN v_plan.owner_kind='mingla' THEN NULL
       ELSE v_allocation.host_currency
     END)
     OR NEW.provider_currency IS DISTINCT FROM v_allocation.provider_currency
     OR NEW.host_budget_cents IS DISTINCT FROM v_allocation.host_budget_cents
     OR NEW.provider_budget_cents IS DISTINCT FROM v_allocation.provider_budget_cents
     OR NEW.fx_snapshot_id IS DISTINCT FROM v_allocation.fx_snapshot_id
     OR NEW.owner_kind IS DISTINCT FROM v_plan.owner_kind
     OR NEW.brand_id IS DISTINCT FROM v_plan.brand_id THEN
    RAISE EXCEPTION 'ad_campaign_plan_binding_mismatch' USING ERRCODE='22023';
  END IF;
  IF v_version.canonical_plan->>'certification_mode'='true' THEN
    IF NOT public.can_create_native_app_canary(
      v_version.destination_snapshot->>'app_key',
      v_version.destination_snapshot->>'os',
      NEW.platform,v_version.id,v_version.plan_hash
    ) THEN
      RAISE EXCEPTION 'ad_campaign_canary_authority_required'
        USING ERRCODE='55000';
    END IF;
  ELSE
    PERFORM public.ad_plan_assert_launchable(v_version.id,v_version.plan_hash);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_plan_confirmations c
    WHERE c.plan_version_id=v_version.id AND c.plan_hash=v_version.plan_hash
      AND c.provided_phrase=c.required_phrase
  ) THEN
    RAISE EXCEPTION 'ad_plan_confirmation_required' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$function$;

-- The shared campaign insert trigger records either a normal launchable create
-- or the separately-approved certification create, never one as the other.
CREATE OR REPLACE FUNCTION public.ad_campaign_record_plan_create_success()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_expected integer;
  v_created integer;
BEGIN
  IF NEW.plan_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id=NEW.plan_version_id AND plan_hash=NEW.plan_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_campaign_plan_binding_mismatch' USING ERRCODE='22023';
  END IF;
  IF v_version.canonical_plan->>'certification_mode'='true' THEN
    PERFORM public.ad_record_canary_provider_attempt(
      v_version.id,v_version.plan_hash,NEW.platform,
      v_version.plan_hash||':'||NEW.platform||':create','succeeded',
      jsonb_build_object('campaign_id',NEW.external_campaign_id),
      jsonb_build_object('status',NEW.status),NULL
    );
  ELSE
    PERFORM public.ad_record_provider_attempt(
      v_version.id,v_version.plan_hash,NEW.platform,'create_paused_objects',
      v_version.plan_hash||':'||NEW.platform||':create','succeeded',
      jsonb_build_object('campaign_id',NEW.external_campaign_id),
      jsonb_build_object('status',NEW.status),NULL
    );
  END IF;
  SELECT count(*) INTO v_expected FROM public.ad_plan_provider_allocations
  WHERE plan_version_id=v_version.id;
  SELECT count(DISTINCT platform) INTO v_created FROM public.ad_campaigns
  WHERE plan_version_id=v_version.id AND plan_hash=v_version.plan_hash;
  IF v_expected>0 AND v_created=v_expected THEN
    UPDATE public.ad_plans SET state='platform_review'
    WHERE id=v_version.plan_id AND state='creating_paused_objects';
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
