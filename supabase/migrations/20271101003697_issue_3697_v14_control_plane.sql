-- Issue #3697 v1.4 — immutable ad-plan, review, funding and settlement control plane.
--
-- One server-owned aggregate is shared by Admin, Host and Ari. Every material
-- plan fact is frozen in an append-only version whose SHA-256 binds funding,
-- staff review, provider attempts and campaign rows. Host money is held in the
-- verified brand settlement currency; provider money remains in the provider
-- account currency and uses one frozen FX snapshot when they differ.
--
-- Do NOT auto-apply. Release only through the reviewed governed migration lane.

BEGIN;

-- Host Ads has an action-specific role contract. Reusing the payout/bank
-- predicate collapsed unrelated authority (planning, funding, launch, pause
-- and end) into one boolean and excluded marketing managers from read access.
-- Keep this service-role-only: edge functions authenticate the user and pass
-- the exact actor id; clients only mirror it for UX.
CREATE OR REPLACE FUNCTION public.ad_can_host_action(
  p_brand_id uuid,
  p_user_id uuid,
  p_action text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_permissions jsonb := '{}'::jsonb;
  v_is_owner boolean := false;
BEGIN
  IF p_brand_id IS NULL OR p_user_id IS NULL
     OR p_action NOT IN ('read','plan','fund','launch','pause','end') THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.account_id = p_user_id
      AND b.deleted_at IS NULL
  ) INTO v_is_owner;
  IF v_is_owner THEN RETURN true; END IF;

  SELECT m.role, coalesce(m.permissions_override, '{}'::jsonb)
    INTO v_role, v_permissions
  FROM public.brand_team_members m
  JOIN public.brands b ON b.id = m.brand_id
  WHERE m.brand_id = p_brand_id
    AND m.user_id = p_user_id
    AND m.removed_at IS NULL
    AND m.accepted_at IS NOT NULL
    AND b.deleted_at IS NULL
  ORDER BY public.biz_role_rank(m.role) DESC, m.id
  LIMIT 1;

  IF NOT FOUND THEN RETURN false; END IF;

  RETURN CASE p_action
    WHEN 'read' THEN
      v_role IN ('brand_admin','marketing_manager','finance_manager')
      OR v_permissions->'ads_view' = 'true'::jsonb
    WHEN 'plan' THEN
      v_role IN ('brand_admin','marketing_manager')
      OR v_permissions->'ads_plan' = 'true'::jsonb
    WHEN 'fund' THEN
      v_role = 'finance_manager'
      OR v_permissions->'ads_fund' = 'true'::jsonb
      OR v_permissions->'ads_spend' = 'true'::jsonb
    WHEN 'launch' THEN
      (v_role = 'marketing_manager'
        AND v_permissions->'ads_spend' = 'true'::jsonb)
      OR v_permissions->'ads_launch' = 'true'::jsonb
    WHEN 'pause' THEN
      (v_role = 'marketing_manager'
        AND v_permissions->'ads_spend' = 'true'::jsonb)
      OR v_permissions->'ads_pause' = 'true'::jsonb
    WHEN 'end' THEN false
    ELSE false
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_can_host_action(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_can_host_action(uuid,uuid,text)
  TO service_role;
COMMENT ON FUNCTION public.ad_can_host_action(uuid,uuid,text) IS
  'Issue #3697 v1.4: independent Host Ads read/plan/fund/launch/pause/end authority. Brand owner may do all; finance can fund; marketing can plan and launch/pause only with ads_spend; direct end remains owner-only.';

-- One extensible registry owns Mingla-controlled destinations. Marketing pages
-- are one family under usemingla.com; app targets point at the existing exact
-- iOS/Android app identities and inherit the established readiness authority.
CREATE TABLE public.ad_destination_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_family text NOT NULL CHECK (destination_family IN (
    'marketing_page', 'explorer_app', 'host_app'
  )),
  destination_key text NOT NULL CHECK (
    char_length(btrim(destination_key)) BETWEEN 1 AND 240
  ),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
  canonical_url text NOT NULL CHECK (canonical_url ~ '^https://[^?#]+$'),
  result_kind text NOT NULL CHECK (result_kind IN ('clicks', 'installs')),
  app_key text NULL REFERENCES public.ad_advertising_apps(app_key) ON DELETE RESTRICT,
  os text NULL CHECK (os IS NULL OR os IN ('ios', 'android')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'retired')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (destination_family, destination_key),
  CONSTRAINT ad_destination_registry_shape CHECK (
    (destination_family = 'marketing_page' AND app_key IS NULL AND os IS NULL
      AND canonical_url ~ '^https://usemingla\.com(/[^?#]*)?$')
    OR
    (destination_family = 'explorer_app' AND app_key = 'explorer' AND os IS NOT NULL)
    OR
    (destination_family = 'host_app' AND app_key = 'business' AND os IS NOT NULL)
  ),
  CONSTRAINT ad_destination_registry_app_key CHECK (
    (destination_family = 'marketing_page')
    OR destination_key = os
  )
);

INSERT INTO public.ad_destination_registry (
  id, destination_family, destination_key, title, canonical_url, result_kind,
  app_key, os, status
) VALUES
  -- Preserve the Wave 4 route ids: campaign-builder selections and evidence
  -- already treat these as durable destination identities.
  ('36970000-0004-4000-8000-000000000001','marketing_page','explorer','Mingla Explorer home','https://usemingla.com/','installs',NULL,NULL,'active'),
  ('36970000-0004-4000-8000-000000000002','marketing_page','host','Mingla Host home','https://usemingla.com/host','installs',NULL,NULL,'active'),
  ('36970000-0004-4000-8000-000000000003','marketing_page','download','Explorer app download','https://usemingla.com/download','installs',NULL,NULL,'active'),
  ('36970000-0004-4000-8000-000000000004','marketing_page','host-download','Host app download','https://usemingla.com/host/download','installs',NULL,NULL,'active'),
  ('36970000-0004-4000-8000-000000000005','marketing_page','tools','Free Host tools','https://usemingla.com/tools','clicks',NULL,NULL,'active'),
  ('36970000-0004-4000-8000-000000000006','marketing_page','tools-events','Event turnout tool','https://usemingla.com/tools/events','clicks',NULL,NULL,'active'),
  ('36970000-0004-4000-8000-000000000007','marketing_page','tools-venues','Venue grader tool','https://usemingla.com/tools/venues','clicks',NULL,NULL,'active'),
  ('36970000-0004-4000-8000-000000000008','marketing_page','tools-trips','Trip quote tool','https://usemingla.com/tools/trips','clicks',NULL,NULL,'active'),
  ('36970000-0004-4000-8000-000000000009','marketing_page','tools-pricing','Pricing audit tool','https://usemingla.com/tools/pricing','clicks',NULL,NULL,'active'),
  ('36970000-0014-4000-8000-000000000010','explorer_app','ios','Mingla Explorer for iPhone','https://go.usemingla.com/w36m','installs','explorer','ios','active'),
  ('36970000-0014-4000-8000-000000000011','explorer_app','android','Mingla Explorer for Android','https://go.usemingla.com/w36m','installs','explorer','android','active'),
  ('36970000-0014-4000-8000-000000000012','host_app','ios','Mingla Host for iPhone','https://biz.usemingla.com/ZSCW','installs','business','ios','active'),
  ('36970000-0014-4000-8000-000000000013','host_app','android','Mingla Host for Android','https://biz.usemingla.com/ZSCW','installs','business','android','active');

CREATE INDEX ad_destination_registry_active_idx
  ON public.ad_destination_registry(destination_family, status, title);

CREATE TRIGGER ad_destination_registry_updated_at
  BEFORE UPDATE ON public.ad_destination_registry
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

ALTER TABLE public.ad_destination_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ad destination registry admin read"
  ON public.ad_destination_registry FOR SELECT TO authenticated
  USING (public.is_admin_user());
REVOKE ALL ON public.ad_destination_registry FROM anon, authenticated;
GRANT SELECT ON public.ad_destination_registry TO authenticated;
GRANT ALL ON public.ad_destination_registry TO service_role;

-- Keep the established marketing page list RPC compatible while moving its
-- source of truth out of a hard-coded VALUES block.
CREATE OR REPLACE FUNCTION public.ad_marketing_route_rows()
RETURNS TABLE (
  id uuid,
  entity_slug text,
  path text,
  title text,
  result_kind text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT r.id,
    r.destination_key,
    CASE
      WHEN r.canonical_url = 'https://usemingla.com/' THEN '/'
      ELSE substring(r.canonical_url FROM char_length('https://usemingla.com') + 1)
    END,
    r.title,
    r.result_kind
  FROM public.ad_destination_registry r
  WHERE r.destination_family = 'marketing_page' AND r.status = 'active'
  ORDER BY r.title, r.destination_key;
$function$;
REVOKE EXECUTE ON FUNCTION public.ad_marketing_route_rows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_marketing_route_rows() TO authenticated, service_role;

CREATE TABLE public.ad_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_kind text NOT NULL CHECK (client_kind IN ('admin', 'host', 'ari')),
  owner_kind text NOT NULL CHECK (owner_kind IN ('mingla', 'host')),
  brand_id uuid NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  destination_family text NOT NULL CHECK (destination_family IN (
    'public_mingla_page', 'marketing_page', 'explorer_app', 'host_app'
  )),
  destination_key text NOT NULL CHECK (char_length(btrim(destination_key)) BETWEEN 1 AND 500),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN (
    'draft', 'validating', 'ready_for_funding', 'funding_pending',
    'funded_held', 'staff_review_required', 'staff_approved',
    'creating_paused_objects', 'platform_review', 'scheduled', 'live',
    'pause_requested', 'paused', 'stop_requested', 'settling', 'ended',
    'changes_requested', 'staff_rejected', 'platform_rejected',
    'partially_ready', 'partially_live', 'creation_failed_retryable',
    'creation_failed_terminal', 'payment_failed', 'expired',
    'cancelled_before_create', 'settlement_attention_required'
  )),
  current_version_id uuid NULL,
  review_required boolean NOT NULL DEFAULT false,
  review_reasons jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(review_reasons) = 'array'),
  created_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_plans_owner_brand_check CHECK (
    (owner_kind = 'host' AND brand_id IS NOT NULL)
    OR (owner_kind = 'mingla')
  )
);

CREATE TABLE public.ad_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.ad_plans(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  previous_version_id uuid NULL REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  canonical_plan jsonb NOT NULL CHECK (jsonb_typeof(canonical_plan) = 'object'),
  destination_snapshot jsonb NOT NULL CHECK (jsonb_typeof(destination_snapshot) = 'object'),
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  host_currency char(3) NOT NULL REFERENCES public.supported_brand_currencies(code),
  host_budget_cents bigint NOT NULL CHECK (host_budget_cents > 0),
  fee_cents bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  created_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version_number),
  UNIQUE (plan_id, plan_hash)
);

ALTER TABLE public.ad_plans
  ADD CONSTRAINT ad_plans_current_version_fk
  FOREIGN KEY (current_version_id)
  REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT;

CREATE TABLE public.ad_plan_provider_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_version_id uuid NOT NULL REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  platform text NOT NULL CHECK (platform IN ('meta', 'tiktok', 'snapchat', 'google', 'reddit')),
  connection_id uuid NOT NULL REFERENCES public.ad_connections(id) ON DELETE RESTRICT,
  host_currency char(3) NOT NULL REFERENCES public.supported_brand_currencies(code),
  host_budget_cents bigint NOT NULL CHECK (host_budget_cents > 0),
  host_delivery_budget_cents bigint NOT NULL CHECK (
    host_delivery_budget_cents > 0 AND host_delivery_budget_cents <= host_budget_cents
  ),
  provider_currency char(3) NOT NULL REFERENCES public.supported_brand_currencies(code),
  provider_budget_cents bigint NOT NULL CHECK (provider_budget_cents > 0),
  provider_delivery_budget_cents bigint NOT NULL CHECK (
    provider_delivery_budget_cents > 0
    AND provider_delivery_budget_cents <= provider_budget_cents
  ),
  fx_snapshot_id uuid NULL REFERENCES public.fx_rate_snapshots(id) ON DELETE RESTRICT,
  fx_expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_version_id, platform),
  CONSTRAINT ad_plan_provider_allocations_fx_check CHECK (
    (host_currency = provider_currency
      AND fx_snapshot_id IS NULL
      AND fx_expires_at IS NULL
      AND host_budget_cents = provider_budget_cents
      AND host_delivery_budget_cents = provider_delivery_budget_cents)
    OR
    (host_currency <> provider_currency
      AND fx_snapshot_id IS NOT NULL
      AND fx_expires_at IS NOT NULL)
  )
);

CREATE TABLE public.ad_plan_targeting_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_version_id uuid NOT NULL REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  platform text NOT NULL CHECK (platform IN ('meta', 'tiktok', 'snapchat', 'google', 'reddit')),
  audience_intent jsonb NOT NULL CHECK (jsonb_typeof(audience_intent) = 'object'),
  compiled_targeting jsonb NOT NULL CHECK (jsonb_typeof(compiled_targeting) = 'object'),
  verdict text NOT NULL CHECK (verdict IN ('exact', 'broader', 'unavailable', 'check_required')),
  widening_summary jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(widening_summary) = 'array'),
  checks_required jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(checks_required) = 'array'),
  broader_accepted boolean NOT NULL DEFAULT false,
  broader_accepted_by uuid NULL REFERENCES auth.users(id),
  broader_accepted_at timestamptz NULL,
  -- I-3697-NON-ADDITIVE-ESTIMATES: a targeting snapshot may hold one
  -- provider-native estimate only. A total/combined key is unrepresentable
  -- because audiences overlap across platforms and must never be summed.
  provider_estimate jsonb NULL CHECK (
    provider_estimate IS NULL OR (
      jsonb_typeof(provider_estimate) = 'object'
      AND provider_estimate->>'non_additive' IS NOT DISTINCT FROM 'true'
      AND coalesce(provider_estimate->>'state', '') IN (
        'available', 'certification_required', 'allowlist_required',
        'provider_error', 'response_unrecognized', 'targeting_unavailable'
      )
      AND coalesce(provider_estimate->>'quality', '') IN (
        'provider_estimate', 'unavailable'
      )
      AND provider_estimate->>'unit' IS NOT DISTINCT FROM 'potential_reach'
      AND coalesce(provider_estimate->>'source', '') <> ''
      AND coalesce(provider_estimate->>'detail', '') <> ''
      AND jsonb_typeof(provider_estimate->'assumptions')
        IS NOT DISTINCT FROM 'array'
      AND (
        (
          provider_estimate->>'state' = 'available'
          AND provider_estimate->>'quality' = 'provider_estimate'
          AND jsonb_typeof(provider_estimate->'lower_bound') = 'number'
          AND jsonb_typeof(provider_estimate->'upper_bound') = 'number'
        )
        OR (
          provider_estimate->>'state' <> 'available'
          AND provider_estimate->>'quality' = 'unavailable'
          AND provider_estimate->'lower_bound' IS NOT DISTINCT FROM 'null'::jsonb
          AND provider_estimate->'upper_bound' IS NOT DISTINCT FROM 'null'::jsonb
        )
      )
      AND NOT provider_estimate ?| ARRAY[
        'total', 'combined', 'cross_platform_total', 'combined_reach'
      ]
    )
  ),
  estimate_observed_at timestamptz NULL,
  evidence_observed_at timestamptz NOT NULL,
  compiler_version text NOT NULL CHECK (char_length(btrim(compiler_version)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_version_id, platform),
  CONSTRAINT ad_targeting_broader_acceptance_check CHECK (
    (verdict = 'broader' AND (
      (broader_accepted IS FALSE AND broader_accepted_by IS NULL AND broader_accepted_at IS NULL)
      OR
      (broader_accepted IS TRUE AND broader_accepted_by IS NOT NULL AND broader_accepted_at IS NOT NULL)
    ))
    OR
    (verdict <> 'broader' AND broader_accepted IS FALSE
      AND broader_accepted_by IS NULL AND broader_accepted_at IS NULL)
  ),
  CONSTRAINT ad_targeting_estimate_time_check CHECK (
    (provider_estimate IS NULL AND estimate_observed_at IS NULL)
    OR (provider_estimate IS NOT NULL AND estimate_observed_at IS NOT NULL)
  )
);

CREATE TABLE public.ad_plan_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.ad_plans(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  decision text NOT NULL CHECK (decision IN ('approved', 'changes_requested', 'rejected')),
  reason text NULL,
  decided_by uuid NOT NULL REFERENCES auth.users(id),
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ad_plan_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.ad_plans(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  required_phrase text NOT NULL,
  provided_phrase text NOT NULL,
  confirmed_by uuid NOT NULL REFERENCES auth.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_version_id, plan_hash)
);

ALTER TABLE public.ad_credit_wallets
  ADD COLUMN IF NOT EXISTS held_cents bigint NOT NULL DEFAULT 0
    CHECK (held_cents >= 0);

CREATE TABLE public.ad_plan_funding_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.ad_plans(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL UNIQUE REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  brand_id uuid NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  funding_source text NOT NULL CHECK (funding_source IN ('host_credit', 'mingla_provider_account')),
  currency char(3) NOT NULL REFERENCES public.supported_brand_currencies(code),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  ledger_id uuid NULL REFERENCES public.ad_credit_ledger(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('held', 'released', 'settled', 'voided')),
  held_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz NULL,
  settled_at timestamptz NULL,
  release_ledger_id uuid NULL REFERENCES public.ad_credit_ledger(id) ON DELETE RESTRICT,
  UNIQUE (plan_id, plan_hash),
  CONSTRAINT ad_plan_hold_source_check CHECK (
    (funding_source = 'host_credit' AND brand_id IS NOT NULL AND ledger_id IS NOT NULL)
    OR
    (funding_source = 'mingla_provider_account' AND brand_id IS NULL AND ledger_id IS NULL)
  )
);

CREATE TABLE public.ad_credit_hold_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id uuid NOT NULL REFERENCES public.ad_plan_funding_holds(id) ON DELETE RESTRICT,
  lot_id uuid NOT NULL REFERENCES public.ad_credit_lots(id) ON DELETE RESTRICT,
  credit_cents bigint NOT NULL CHECK (credit_cents > 0),
  pay_cents bigint NOT NULL CHECK (pay_cents >= credit_cents),
  fee_cents bigint NOT NULL CHECK (fee_cents = pay_cents - credit_cents),
  restored_credit_cents bigint NOT NULL DEFAULT 0 CHECK (restored_credit_cents >= 0),
  restored_pay_cents bigint NOT NULL DEFAULT 0 CHECK (restored_pay_cents >= 0),
  restored_fee_cents bigint NOT NULL DEFAULT 0 CHECK (restored_fee_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hold_id, lot_id),
  CONSTRAINT ad_hold_allocation_restore_check CHECK (
    restored_credit_cents <= credit_cents
    AND restored_pay_cents <= pay_cents
    AND restored_fee_cents <= fee_cents
    AND restored_fee_cents = restored_pay_cents - restored_credit_cents
  )
);

CREATE TABLE public.ad_provider_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.ad_plans(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  platform text NOT NULL CHECK (platform IN ('meta', 'tiktok', 'snapchat', 'google', 'reddit')),
  command text NOT NULL CHECK (command IN (
    'create_paused_objects', 'activate', 'pause', 'stop', 'fetch_final_spend'
  )),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 240),
  state text NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed_retryable', 'failed_terminal')),
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(external_ids) = 'object'),
  provider_response jsonb NULL CHECK (provider_response IS NULL OR jsonb_typeof(provider_response) = 'object'),
  error_detail text NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, idempotency_key)
);

ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS plan_version_id uuid NULL
    REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS plan_hash text NULL,
  ADD COLUMN IF NOT EXISTS host_budget_cents bigint NULL CHECK (host_budget_cents IS NULL OR host_budget_cents > 0),
  ADD COLUMN IF NOT EXISTS provider_budget_cents bigint NULL CHECK (provider_budget_cents IS NULL OR provider_budget_cents > 0),
  ADD COLUMN IF NOT EXISTS provider_delivery_budget_cents bigint NULL CHECK (
    provider_delivery_budget_cents IS NULL OR provider_delivery_budget_cents > 0
  ),
  ADD COLUMN IF NOT EXISTS fx_snapshot_id uuid NULL
    REFERENCES public.fx_rate_snapshots(id) ON DELETE RESTRICT;

CREATE TABLE public.ad_campaign_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL UNIQUE REFERENCES public.ad_campaigns(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.ad_plans(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  hold_id uuid NULL REFERENCES public.ad_plan_funding_holds(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN (
    'stop_requested', 'provider_stopped', 'awaiting_final_spend',
    'ready_to_settle', 'settled', 'attention_required'
  )),
  provider_currency char(3) NOT NULL REFERENCES public.supported_brand_currencies(code),
  final_provider_spend_cents bigint NULL CHECK (final_provider_spend_cents IS NULL OR final_provider_spend_cents >= 0),
  host_currency char(3) NOT NULL REFERENCES public.supported_brand_currencies(code),
  final_host_spend_cents bigint NULL CHECK (final_host_spend_cents IS NULL OR final_host_spend_cents >= 0),
  released_host_cents bigint NULL CHECK (released_host_cents IS NULL OR released_host_cents >= 0),
  stop_requested_at timestamptz NOT NULL,
  provider_stopped_at timestamptz NULL,
  final_spend_observed_at timestamptz NULL,
  settle_after timestamptz NULL,
  settled_at timestamptz NULL,
  provider_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provider_evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ad_plans_brand_updated_idx ON public.ad_plans (brand_id, updated_at DESC);
CREATE INDEX ad_plan_versions_plan_created_idx ON public.ad_plan_versions (plan_id, version_number DESC);
CREATE INDEX ad_plan_provider_allocations_version_idx ON public.ad_plan_provider_allocations (plan_version_id, platform);
CREATE INDEX ad_plan_targeting_version_idx ON public.ad_plan_targeting_snapshots (plan_version_id, platform);
CREATE INDEX ad_plan_reviews_version_idx ON public.ad_plan_reviews (plan_version_id, decided_at DESC);
CREATE INDEX ad_plan_confirmations_version_idx ON public.ad_plan_confirmations (plan_version_id, confirmed_at DESC);
CREATE INDEX ad_provider_attempts_version_idx ON public.ad_provider_attempts (plan_version_id, platform, command);
CREATE INDEX ad_campaigns_plan_version_idx ON public.ad_campaigns (plan_version_id);
CREATE INDEX ad_settlements_state_idx ON public.ad_campaign_settlements (state, settle_after);

CREATE OR REPLACE FUNCTION public.ad_immutable_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'ad_immutable_record' USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER ad_plan_versions_immutable
  BEFORE UPDATE OR DELETE ON public.ad_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.ad_immutable_row_guard();
CREATE TRIGGER ad_plan_provider_allocations_immutable
  BEFORE UPDATE OR DELETE ON public.ad_plan_provider_allocations
  FOR EACH ROW EXECUTE FUNCTION public.ad_immutable_row_guard();
CREATE TRIGGER ad_plan_targeting_immutable
  BEFORE UPDATE OR DELETE ON public.ad_plan_targeting_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.ad_immutable_row_guard();
CREATE TRIGGER ad_plan_reviews_immutable
  BEFORE UPDATE OR DELETE ON public.ad_plan_reviews
  FOR EACH ROW EXECUTE FUNCTION public.ad_immutable_row_guard();
CREATE TRIGGER ad_plan_confirmations_immutable
  BEFORE UPDATE OR DELETE ON public.ad_plan_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.ad_immutable_row_guard();

CREATE OR REPLACE FUNCTION public.ad_plan_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER ad_plans_set_updated_at
  BEFORE UPDATE ON public.ad_plans
  FOR EACH ROW EXECUTE FUNCTION public.ad_plan_set_updated_at();
CREATE TRIGGER ad_provider_attempts_set_updated_at
  BEFORE UPDATE ON public.ad_provider_attempts
  FOR EACH ROW EXECUTE FUNCTION public.ad_plan_set_updated_at();
CREATE TRIGGER ad_campaign_settlements_set_updated_at
  BEFORE UPDATE ON public.ad_campaign_settlements
  FOR EACH ROW EXECUTE FUNCTION public.ad_plan_set_updated_at();

CREATE OR REPLACE FUNCTION public.ad_plan_state_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;
  IF (OLD.state, NEW.state) IN (
    ('draft','validating'), ('draft','cancelled_before_create'),
    ('validating','draft'), ('validating','ready_for_funding'),
    ('ready_for_funding','validating'), ('ready_for_funding','funding_pending'),
    ('ready_for_funding','funded_held'), ('ready_for_funding','staff_review_required'),
    ('funding_pending','ready_for_funding'), ('funding_pending','funded_held'),
    ('funding_pending','payment_failed'),
    ('funded_held','validating'), ('funded_held','staff_review_required'),
    ('funded_held','staff_approved'), ('funded_held','creating_paused_objects'),
    ('funded_held','cancelled_before_create'),
    ('staff_review_required','staff_approved'),
    ('staff_review_required','changes_requested'),
    ('staff_review_required','staff_rejected'),
    ('staff_review_required','cancelled_before_create'),
    ('staff_approved','validating'), ('staff_approved','creating_paused_objects'),
    ('staff_approved','changes_requested'), ('staff_approved','cancelled_before_create'),
    ('creating_paused_objects','platform_review'),
    ('creating_paused_objects','creation_failed_retryable'),
    ('creating_paused_objects','creation_failed_terminal'),
    ('creating_paused_objects','cancelled_before_create'),
    ('platform_review','scheduled'), ('platform_review','live'),
    ('platform_review','platform_rejected'), ('platform_review','partially_ready'),
    ('platform_review','partially_live'),
    ('scheduled','live'), ('scheduled','pause_requested'), ('scheduled','stop_requested'),
    ('live','pause_requested'), ('live','stop_requested'), ('live','partially_live'),
    ('pause_requested','paused'), ('pause_requested','live'),
    ('pause_requested','partially_live'),
    ('pause_requested','stop_requested'),
    ('paused','live'), ('paused','partially_live'), ('paused','stop_requested'),
    ('stop_requested','settling'), ('stop_requested','settlement_attention_required'),
    ('settling','ended'), ('settling','settlement_attention_required'),
    ('changes_requested','draft'), ('changes_requested','validating'),
    ('changes_requested','cancelled_before_create'),
    ('staff_rejected','draft'), ('staff_rejected','cancelled_before_create'),
    ('platform_rejected','draft'),
    ('partially_ready','creating_paused_objects'), ('partially_ready','stop_requested'),
    ('partially_live','live'), ('partially_live','pause_requested'),
    ('partially_live','stop_requested'),
    ('creation_failed_retryable','creating_paused_objects'),
    ('creation_failed_retryable','draft'), ('creation_failed_terminal','draft'),
    ('payment_failed','ready_for_funding'), ('expired','draft'),
    ('settlement_attention_required','settling')
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ad_plan_state_transition_invalid:%->%', OLD.state, NEW.state
    USING ERRCODE = '22023';
END;
$function$;

CREATE TRIGGER ad_plans_state_transition
  BEFORE UPDATE OF state ON public.ad_plans
  FOR EACH ROW EXECUTE FUNCTION public.ad_plan_state_transition_guard();

-- Settlement must reuse the exact quoted snapshot even when its quote TTL has
-- passed. This deliberately omits the live-expiry check used at plan creation;
-- it accepts only snapshots that were actually active/superseded.
CREATE OR REPLACE FUNCTION public.ad_fx_convert_frozen_minor(
  p_amount bigint,
  p_source char(3),
  p_target char(3),
  p_snapshot uuid
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_source_exp smallint;
  v_target_exp smallint;
  v_source_rate numeric(38,18);
  v_target_rate numeric(38,18);
  v_result numeric;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF p_source = p_target THEN RETURN p_amount; END IF;
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'fx_snapshot_required' USING ERRCODE = '22023';
  END IF;
  SELECT c.minor_unit_exponent, r.rate_per_base
  INTO v_source_exp, v_source_rate
  FROM public.supported_brand_currencies c
  JOIN public.fx_rates r ON r.currency_code = c.code
  JOIN public.fx_rate_snapshots s ON s.id = r.snapshot_id
  WHERE c.code = p_source AND c.active
    AND r.snapshot_id = p_snapshot AND s.status IN ('active','superseded');
  SELECT c.minor_unit_exponent, r.rate_per_base
  INTO v_target_exp, v_target_rate
  FROM public.supported_brand_currencies c
  JOIN public.fx_rates r ON r.currency_code = c.code
  WHERE c.code = p_target AND c.active AND r.snapshot_id = p_snapshot;
  IF v_source_exp IS NULL OR v_target_exp IS NULL
     OR v_source_rate IS NULL OR v_target_rate IS NULL THEN
    RAISE EXCEPTION 'fx_unavailable' USING ERRCODE = 'P0001';
  END IF;
  v_result := round(
    (p_amount::numeric / power(10::numeric, v_source_exp))
    * (v_target_rate / v_source_rate)
    * power(10::numeric, v_target_exp)
  );
  IF v_result > 9223372036854775807::numeric THEN
    RAISE EXCEPTION 'converted_amount_overflow' USING ERRCODE = '22003';
  END IF;
  RETURN v_result::bigint;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_plan_destination_resolve(
  p_destination_family text,
  p_destination_key text,
  p_platforms jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_family text := btrim(coalesce(p_destination_family, ''));
  v_key text := btrim(coalesce(p_destination_key, ''));
  v_registry public.ad_destination_registry%ROWTYPE;
  v_page_type text;
  v_brand_slug text;
  v_entity_slug text;
  v_public jsonb;
  v_provider text;
  v_provider_rows jsonb := '[]'::jsonb;
  v_ready boolean := true;
  v_store_identifier text;
  v_appsflyer_app_id text;
  v_store_url text;
BEGIN
  IF v_family NOT IN (
    'public_mingla_page', 'marketing_page', 'explorer_app', 'host_app'
  ) OR v_key = '' OR jsonb_typeof(coalesce(p_platforms, '[]'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object(
      'ok', false, 'ready', false, 'code', 'destination_descriptor_invalid'
    );
  END IF;

  IF v_family = 'public_mingla_page' THEN
    v_page_type := split_part(v_key, ':', 1);
    v_brand_slug := split_part(v_key, ':', 2);
    v_entity_slug := nullif(split_part(v_key, ':', 3), '');
    v_public := public.ad_destination_resolve(
      v_page_type, v_brand_slug, v_entity_slug
    );
    RETURN v_public || jsonb_build_object(
      'destination_family', v_family,
      'destination_key', v_key,
      'ready', coalesce((v_public->>'ok')::boolean, false),
      'objective', 'web_traffic',
      'measurement_event', coalesce(v_public->>'result_kind', 'clicks')
    );
  END IF;

  SELECT * INTO v_registry
  FROM public.ad_destination_registry r
  WHERE r.destination_family = v_family
    AND r.destination_key = v_key
    AND r.status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'ready', false, 'code', 'destination_not_registered',
      'destination_family', v_family, 'destination_key', v_key
    );
  END IF;

  IF v_registry.app_key IS NOT NULL THEN
    SELECT t.store_identifier, t.appsflyer_app_id, p.store_url
    INTO v_store_identifier, v_appsflyer_app_id, v_store_url
    FROM public.ad_app_targets t
    JOIN public.app_version_policies p
      ON p.app_id = t.app_key AND p.platform = t.os
    WHERE t.app_key = v_registry.app_key
      AND t.os = v_registry.os
      AND t.active IS TRUE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false, 'ready', false, 'code', 'app_target_not_registered',
        'destination_family', v_family, 'destination_key', v_key
      );
    END IF;
    IF jsonb_array_length(coalesce(p_platforms, '[]'::jsonb)) = 0 THEN
      v_ready := false;
    ELSE
      FOR v_provider IN
        SELECT value
        FROM jsonb_array_elements_text(p_platforms)
      LOOP
        IF v_provider NOT IN ('meta','tiktok','snapchat','google','reddit') THEN
          RETURN jsonb_build_object(
            'ok', false, 'ready', false, 'code', 'destination_platform_invalid'
          );
        END IF;
        v_provider_rows := v_provider_rows || jsonb_build_array(
          jsonb_build_object(
            'platform', v_provider,
            'ready', public.can_create_native_app_campaign(
              v_registry.app_key, v_registry.os, v_provider
            )
          )
        );
      END LOOP;
      SELECT bool_and(coalesce((value->>'ready')::boolean, false))
      INTO v_ready
      FROM jsonb_array_elements(v_provider_rows);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'ready', v_ready,
    'code', CASE WHEN v_ready THEN NULL ELSE 'app_acquisition_not_ready' END,
    'id', v_registry.id,
    'destination_family', v_registry.destination_family,
    'destination_key', v_registry.destination_key,
    'title', v_registry.title,
    'canonical_url', CASE
      WHEN v_registry.app_key IS NOT NULL THEN v_store_url
      ELSE v_registry.canonical_url
    END,
    'onelink_url', CASE
      WHEN v_registry.app_key IS NOT NULL THEN v_registry.canonical_url
      ELSE NULL
    END,
    'result_kind', v_registry.result_kind,
    'objective', CASE
      WHEN v_registry.app_key IS NOT NULL THEN 'app_install'
      ELSE 'web_traffic'
    END,
    'measurement_event', CASE
      WHEN v_registry.app_key IS NOT NULL THEN 'install'
      ELSE v_registry.result_kind
    END,
    'app_key', v_registry.app_key,
    'os', v_registry.os,
    'store_identifier', v_store_identifier,
    'appsflyer_app_id', v_appsflyer_app_id,
    'provider_readiness', v_provider_rows
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.ad_plan_destination_resolve(text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_plan_destination_resolve(text,text,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ad_plan_open(
  p_client_kind text,
  p_owner_kind text,
  p_brand_id uuid,
  p_destination_family text,
  p_destination_key text,
  p_risk_reasons jsonb DEFAULT '[]'::jsonb,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.ad_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_prior_host_campaigns bigint := 0;
  v_reasons jsonb := coalesce(p_risk_reasons, '[]'::jsonb);
  v_destination jsonb;
  v_plan public.ad_plans%ROWTYPE;
BEGIN
  IF p_client_kind NOT IN ('admin','host','ari')
     OR p_owner_kind NOT IN ('mingla','host') THEN
    RAISE EXCEPTION 'ad_plan_owner_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_reasons) <> 'array' THEN
    RAISE EXCEPTION 'ad_plan_risk_reasons_invalid' USING ERRCODE = '22023';
  END IF;
  v_destination := public.ad_plan_destination_resolve(
    p_destination_family, p_destination_key, '[]'::jsonb
  );
  IF coalesce((v_destination->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ad_plan_destination_invalid:%',
      coalesce(v_destination->>'code', 'destination_not_available')
      USING ERRCODE = '22023';
  END IF;
  IF p_owner_kind = 'host' THEN
    IF p_destination_family <> 'public_mingla_page'
       OR nullif(v_destination->>'brand_id','')::uuid IS DISTINCT FROM p_brand_id THEN
      RAISE EXCEPTION 'ad_plan_host_destination_mismatch' USING ERRCODE = '22023';
    END IF;
    PERFORM public.ad_require_brand_currency(p_brand_id);
    SELECT count(DISTINCT v.plan_id) INTO v_prior_host_campaigns
    FROM public.ad_campaigns c
    JOIN public.ad_plan_versions v ON v.id = c.plan_version_id
    WHERE c.owner_kind = 'host' AND c.brand_id = p_brand_id;
    IF v_prior_host_campaigns < 3 THEN
      v_reasons := v_reasons || jsonb_build_array('first_three_host_campaigns');
    END IF;
  END IF;
  INSERT INTO public.ad_plans (
    client_kind, owner_kind, brand_id, destination_family, destination_key,
    review_required, review_reasons, created_by
  ) VALUES (
    p_client_kind, p_owner_kind, p_brand_id, p_destination_family,
    btrim(p_destination_key), jsonb_array_length(v_reasons) > 0,
    v_reasons, p_actor_id
  ) RETURNING * INTO v_plan;
  RETURN v_plan;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_plan_create_version(
  p_plan_id uuid,
  p_canonical_plan jsonb,
  p_host_budget_cents bigint,
  p_host_currency text,
  p_provider_allocations jsonb,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.ad_plan_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_plan public.ad_plans%ROWTYPE;
  v_previous public.ad_plan_versions%ROWTYPE;
  v_version integer;
  v_host_currency text := upper(btrim(coalesce(p_host_currency, '')));
  v_allocation jsonb;
  v_connection public.ad_connections%ROWTYPE;
  v_platform text;
  v_connection_id uuid;
  v_host_allocation bigint;
  v_host_delivery bigint;
  v_provider_allocation bigint;
  v_provider_delivery bigint;
  v_provider_currency text;
  v_expected_provider bigint;
  v_expected_provider_delivery bigint;
  v_fx_snapshot_id uuid;
  v_fx_expires_at timestamptz;
  v_host_sum bigint := 0;
  v_normalized_allocations jsonb := '[]'::jsonb;
  v_canonical_plan jsonb;
  v_delivery_budgets jsonb;
  v_platforms jsonb;
  v_destination jsonb;
  v_media_rights jsonb;
  v_attested_at timestamptz;
  v_hash text;
  v_version_row public.ad_plan_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ad_plan_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_canonical_plan IS NULL OR jsonb_typeof(p_canonical_plan) <> 'object' THEN
    RAISE EXCEPTION 'ad_plan_payload_invalid' USING ERRCODE = '22023';
  END IF;
  -- #3697 v1.4: media rights are part of the immutable, server-bound plan.
  -- Validate again at the database authority so a service-role caller cannot
  -- bypass the ad-plan edge preflight or silently opt assets into house reuse.
  v_media_rights := p_canonical_plan->'media_rights';
  IF v_media_rights IS NULL
     OR jsonb_typeof(v_media_rights) <> 'object'
     OR v_media_rights->>'rights_confirmed' IS DISTINCT FROM 'true'
     OR coalesce(v_media_rights->>'rights_basis', '') NOT IN (
       'owned', 'licensed', 'authorized_by_brand'
     )
     OR jsonb_typeof(v_media_rights->'ai_generated') IS DISTINCT FROM 'boolean'
     OR v_media_rights->>'house_reuse_allowed' IS DISTINCT FROM 'false'
     OR p_actor_id IS NULL
     OR v_media_rights->>'attested_by' IS DISTINCT FROM p_actor_id::text THEN
    RAISE EXCEPTION 'ad_plan_media_rights_attestation_required'
      USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_attested_at := nullif(v_media_rights->>'attested_at', '')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ad_plan_media_rights_attestation_required'
      USING ERRCODE = '22023';
  END;
  IF v_attested_at IS NULL OR v_attested_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'ad_plan_media_rights_attestation_required'
      USING ERRCODE = '22023';
  END IF;
  IF p_host_budget_cents IS NULL OR p_host_budget_cents <= 0
     OR p_provider_allocations IS NULL
     OR jsonb_typeof(p_provider_allocations) <> 'array'
     OR jsonb_array_length(p_provider_allocations) = 0 THEN
    RAISE EXCEPTION 'ad_plan_budget_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_plan.owner_kind = 'host'
     AND public.ad_require_brand_currency(v_plan.brand_id) <> v_host_currency THEN
    RAISE EXCEPTION 'ad_plan_host_currency_mismatch' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ad_plan_funding_holds h
    WHERE h.plan_id = p_plan_id AND h.state = 'held'
  ) THEN
    RAISE EXCEPTION 'ad_plan_funding_must_be_released_before_edit' USING ERRCODE = '55000';
  END IF;
  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_provider_allocations)
  LOOP
    v_platform := lower(btrim(coalesce(v_allocation->>'platform','')));
    BEGIN
      v_connection_id := (v_allocation->>'connection_id')::uuid;
      v_host_allocation := (v_allocation->>'host_budget_cents')::bigint;
      v_host_delivery := (v_allocation->>'host_delivery_budget_cents')::bigint;
      v_provider_allocation := (v_allocation->>'provider_budget_cents')::bigint;
      v_provider_delivery := (v_allocation->>'provider_delivery_budget_cents')::bigint;
      v_fx_snapshot_id := nullif(v_allocation->>'fx_snapshot_id','')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ad_plan_provider_allocation_invalid' USING ERRCODE = '22023';
    END;
    SELECT * INTO v_connection FROM public.ad_connections c
    WHERE c.id = v_connection_id
      AND c.platform = v_platform
      AND c.connected IS TRUE AND c.status = 'connected'
      AND c.currency ~ '^[A-Za-z]{3}$';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ad_plan_provider_connection_unavailable:%', v_platform
        USING ERRCODE = '22023';
    END IF;
    v_provider_currency := upper(btrim(v_connection.currency));
    IF v_host_allocation IS NULL OR v_host_allocation <= 0
       OR v_host_delivery IS NULL OR v_host_delivery <= 0
       OR v_host_delivery > v_host_allocation
       OR v_provider_allocation IS NULL OR v_provider_allocation <= 0
       OR v_provider_delivery IS NULL OR v_provider_delivery <= 0
       OR v_provider_delivery > v_provider_allocation THEN
      RAISE EXCEPTION 'ad_plan_provider_allocation_invalid' USING ERRCODE = '22023';
    END IF;
    v_fx_expires_at := NULL;
    IF v_host_currency = v_provider_currency THEN
      IF v_fx_snapshot_id IS NOT NULL
         OR v_host_allocation <> v_provider_allocation
         OR v_host_delivery <> v_provider_delivery THEN
        RAISE EXCEPTION 'ad_plan_same_currency_amount_mismatch' USING ERRCODE = '22023';
      END IF;
    ELSE
      SELECT s.expires_at INTO v_fx_expires_at
      FROM public.fx_rate_snapshots s
      WHERE s.id = v_fx_snapshot_id
        AND s.status IN ('active','superseded') AND now() <= s.expires_at;
      IF v_fx_expires_at IS NULL THEN
        RAISE EXCEPTION 'ad_plan_fx_quote_unavailable' USING ERRCODE = 'P0001';
      END IF;
      v_expected_provider := public.fx_convert_minor(
        v_host_allocation, v_host_currency::char(3),
        v_provider_currency::char(3), v_fx_snapshot_id
      );
      IF v_expected_provider <> v_provider_allocation THEN
        RAISE EXCEPTION 'ad_plan_fx_amount_mismatch' USING ERRCODE = '22023';
      END IF;
      v_expected_provider_delivery := public.fx_convert_minor(
        v_host_delivery, v_host_currency::char(3),
        v_provider_currency::char(3), v_fx_snapshot_id
      );
      IF v_expected_provider_delivery <> v_provider_delivery THEN
        RAISE EXCEPTION 'ad_plan_fx_delivery_amount_mismatch' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_normalized_allocations) n
      WHERE n->>'platform' = v_platform
    ) THEN
      RAISE EXCEPTION 'ad_plan_provider_platform_duplicate:%', v_platform
        USING ERRCODE = '22023';
    END IF;
    v_host_sum := v_host_sum + v_host_allocation;
    v_normalized_allocations := v_normalized_allocations || jsonb_build_array(
      jsonb_build_object(
        'platform', v_platform, 'connection_id', v_connection_id,
        'host_currency', v_host_currency,
        'host_budget_cents', v_host_allocation,
        'host_delivery_budget_cents', v_host_delivery,
        'provider_currency', v_provider_currency,
        'provider_budget_cents', v_provider_allocation,
        'provider_delivery_budget_cents', v_provider_delivery,
        'fx_snapshot_id', v_fx_snapshot_id,
        'fx_expires_at', v_fx_expires_at
      )
    );
  END LOOP;
  IF v_host_sum <> p_host_budget_cents THEN
    RAISE EXCEPTION 'ad_plan_host_allocation_sum_mismatch' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_agg(value->>'platform' ORDER BY value->>'platform')
  INTO v_platforms
  FROM jsonb_array_elements(v_normalized_allocations);
  v_destination := public.ad_plan_destination_resolve(
    v_plan.destination_family, v_plan.destination_key, v_platforms
  );
  IF coalesce((v_destination->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ad_plan_destination_invalid:%',
      coalesce(v_destination->>'code', 'destination_not_available')
      USING ERRCODE = '22023';
  END IF;
  IF coalesce((v_destination->>'ready')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ad_plan_destination_not_ready:%',
      coalesce(v_destination->>'code', 'destination_not_ready')
      USING ERRCODE = '55000';
  END IF;
  IF v_plan.owner_kind = 'mingla' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_normalized_allocations) a
    WHERE a->>'provider_currency' <> v_host_currency
      OR (a->>'host_currency') <> (a->>'provider_currency')
      OR (a->>'host_budget_cents')::bigint <> (a->>'provider_budget_cents')::bigint
      OR nullif(a->>'fx_snapshot_id','') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ad_plan_admin_currency_split_required' USING ERRCODE = '22023';
  END IF;
  IF v_plan.current_version_id IS NOT NULL THEN
    SELECT * INTO v_previous FROM public.ad_plan_versions
    WHERE id = v_plan.current_version_id;
  END IF;
  SELECT coalesce(max(version_number), 0) + 1 INTO v_version
  FROM public.ad_plan_versions WHERE plan_id = p_plan_id;
  SELECT jsonb_object_agg(
    value->>'platform',
    jsonb_build_object(
      'host_currency', value->>'host_currency',
      'host_amount_cents', (value->>'host_delivery_budget_cents')::bigint,
      'provider_amount_cents', (value->>'provider_delivery_budget_cents')::bigint
    )
    ORDER BY value->>'platform'
  ) INTO v_delivery_budgets
  FROM jsonb_array_elements(v_normalized_allocations);
  -- Money inside the immutable plan is database-derived from the validated
  -- provider allocations. A service-role caller cannot smuggle a different
  -- delivery amount into canonical_plan and later bind a campaign to it.
  v_canonical_plan := jsonb_set(
    p_canonical_plan,
    '{delivery_budgets}',
    coalesce(v_delivery_budgets, '{}'::jsonb),
    true
  );
  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'plan', v_canonical_plan,
    'destination', v_destination,
    'host_budget_cents', p_host_budget_cents,
    'host_currency', v_host_currency,
    'provider_allocations', (
      SELECT jsonb_agg(value ORDER BY value->>'platform')
      FROM jsonb_array_elements(v_normalized_allocations)
    )
  )::text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.ad_plan_versions (
    plan_id, version_number, previous_version_id, canonical_plan,
    destination_snapshot, plan_hash,
    host_currency, host_budget_cents, created_by
  ) VALUES (
    p_plan_id, v_version, v_previous.id, v_canonical_plan,
    v_destination, v_hash,
    v_host_currency, p_host_budget_cents, p_actor_id
  ) RETURNING * INTO v_version_row;
  INSERT INTO public.ad_plan_provider_allocations (
    plan_version_id, platform, connection_id, host_currency,
    host_budget_cents, host_delivery_budget_cents,
    provider_currency, provider_budget_cents, provider_delivery_budget_cents,
    fx_snapshot_id, fx_expires_at
  )
  SELECT v_version_row.id, value->>'platform', (value->>'connection_id')::uuid,
    (value->>'host_currency')::char(3), (value->>'host_budget_cents')::bigint,
    (value->>'host_delivery_budget_cents')::bigint,
    (value->>'provider_currency')::char(3),
    (value->>'provider_budget_cents')::bigint,
    (value->>'provider_delivery_budget_cents')::bigint,
    nullif(value->>'fx_snapshot_id','')::uuid,
    nullif(value->>'fx_expires_at','')::timestamptz
  FROM jsonb_array_elements(v_normalized_allocations);
  UPDATE public.ad_plans
  SET current_version_id = v_version_row.id, state = 'validating'
  WHERE id = p_plan_id;
  RETURN v_version_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_plan_quote_for_brand(
  p_brand_id uuid,
  p_provider_connection_id uuid,
  p_host_budget_cents bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_host_currency text;
  v_provider_currency text;
  v_snapshot record;
  v_provider_budget bigint;
BEGIN
  IF p_host_budget_cents IS NULL OR p_host_budget_cents <= 0 THEN
    RAISE EXCEPTION 'ad_plan_budget_invalid' USING ERRCODE = '22023';
  END IF;
  v_host_currency := public.ad_require_brand_currency(p_brand_id);
  SELECT upper(btrim(c.currency)) INTO v_provider_currency
  FROM public.ad_connections c
  WHERE c.id = p_provider_connection_id
    AND c.connected IS TRUE AND c.status = 'connected'
    AND c.currency ~ '^[A-Za-z]{3}$';
  IF v_provider_currency IS NULL THEN
    RAISE EXCEPTION 'ad_plan_provider_currency_unresolved' USING ERRCODE = '22023';
  END IF;
  IF v_host_currency = v_provider_currency THEN
    RETURN jsonb_build_object(
      'host_currency', v_host_currency,
      'host_budget_cents', p_host_budget_cents,
      'provider_currency', v_provider_currency,
      'provider_budget_cents', p_host_budget_cents,
      'provider_connection_id', p_provider_connection_id,
      'fx_snapshot_id', NULL,
      'expires_at', NULL
    );
  END IF;
  SELECT * INTO v_snapshot FROM public.fx_latest_servable_snapshot(now());
  IF v_snapshot.snapshot_id IS NULL THEN
    RAISE EXCEPTION 'ad_plan_fx_quote_unavailable' USING ERRCODE = 'P0001';
  END IF;
  v_provider_budget := public.fx_convert_minor(
    p_host_budget_cents, v_host_currency::char(3),
    v_provider_currency::char(3), v_snapshot.snapshot_id
  );
  RETURN jsonb_build_object(
    'host_currency', v_host_currency,
    'host_budget_cents', p_host_budget_cents,
    'provider_currency', v_provider_currency,
    'provider_budget_cents', v_provider_budget,
    'provider_connection_id', p_provider_connection_id,
    'fx_snapshot_id', v_snapshot.snapshot_id,
    'expires_at', v_snapshot.expires_at,
    'freshness', v_snapshot.freshness
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_plan_mark_ready(
  p_plan_version_id uuid,
  p_plan_hash text
)
RETURNS public.ad_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_destination jsonb;
  v_platform_count integer;
  v_snapshot_count integer;
  v_allocation_count integer;
BEGIN
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  IF NOT FOUND THEN RAISE EXCEPTION 'ad_plan_version_hash_mismatch' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM public.ad_plans
  WHERE id = v_version.plan_id FOR UPDATE;
  IF v_plan.current_version_id <> v_version.id THEN
    RAISE EXCEPTION 'ad_plan_version_stale' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(v_version.canonical_plan->'platforms') <> 'array' THEN
    RAISE EXCEPTION 'ad_plan_platforms_required' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT p) INTO v_platform_count
  FROM jsonb_array_elements_text(v_version.canonical_plan->'platforms') p;
  SELECT count(*) INTO v_snapshot_count
  FROM public.ad_plan_targeting_snapshots t
  WHERE t.plan_version_id = v_version.id;
  SELECT count(*) INTO v_allocation_count
  FROM public.ad_plan_provider_allocations a
  WHERE a.plan_version_id = v_version.id;
  IF v_platform_count = 0 OR v_snapshot_count <> v_platform_count
     OR v_allocation_count <> v_platform_count THEN
    RAISE EXCEPTION 'ad_plan_targeting_incomplete' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ad_plan_targeting_snapshots t
    WHERE t.plan_version_id = v_version.id
      AND NOT (v_version.canonical_plan->'platforms' ? t.platform)
  ) OR EXISTS (
    SELECT 1 FROM public.ad_plan_provider_allocations a
    WHERE a.plan_version_id = v_version.id
      AND NOT (v_version.canonical_plan->'platforms' ? a.platform)
  ) THEN
    RAISE EXCEPTION 'ad_plan_platform_binding_mismatch' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ad_plan_targeting_snapshots t
    WHERE t.plan_version_id = v_version.id
      AND (
        t.verdict IN ('unavailable','check_required')
        OR (t.verdict = 'broader' AND t.broader_accepted IS NOT TRUE)
      )
  ) THEN
    RAISE EXCEPTION 'ad_plan_targeting_not_accepted' USING ERRCODE = '22023';
  END IF;
  v_destination := public.ad_plan_destination_resolve(
    v_plan.destination_family,
    v_plan.destination_key,
    v_version.canonical_plan->'platforms'
  );
  IF coalesce((v_destination->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ad_plan_destination_invalid:%',
      coalesce(v_destination->>'code', 'destination_not_available')
      USING ERRCODE = '22023';
  END IF;
  IF coalesce((v_destination->>'ready')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ad_plan_destination_not_ready:%',
      coalesce(v_destination->>'code', 'destination_not_ready')
      USING ERRCODE = '55000';
  END IF;
  UPDATE public.ad_plans SET state = 'ready_for_funding'
  WHERE id = v_plan.id RETURNING * INTO v_plan;
  RETURN v_plan;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_plan_hold_host_funds(
  p_plan_version_id uuid,
  p_plan_hash text,
  p_idempotency_key text,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.ad_plan_funding_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_wallet public.ad_credit_wallets%ROWTYPE;
  v_existing public.ad_plan_funding_holds%ROWTYPE;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
  v_lot public.ad_credit_lots%ROWTYPE;
  v_need bigint;
  v_take bigint;
  v_pay_take bigint;
  v_fee_take bigint;
  v_ledger public.ad_credit_ledger%ROWTYPE;
BEGIN
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  IF NOT FOUND THEN RAISE EXCEPTION 'ad_plan_version_hash_mismatch' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id FOR UPDATE;
  IF v_plan.current_version_id <> v_version.id OR v_plan.owner_kind <> 'host'
     OR v_plan.state <> 'ready_for_funding' THEN
    RAISE EXCEPTION 'ad_plan_not_fundable' USING ERRCODE = '55000';
  END IF;
  IF public.ad_require_brand_currency(v_plan.brand_id) <> v_version.host_currency::text THEN
    RAISE EXCEPTION 'ad_plan_host_currency_mismatch' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.ad_plan_funding_holds
  WHERE plan_version_id = v_version.id;
  IF FOUND THEN RETURN v_existing; END IF;
  SELECT * INTO v_wallet FROM public.ad_credit_wallets
  WHERE brand_id = v_plan.brand_id FOR UPDATE;
  IF NOT FOUND OR v_wallet.currency <> v_version.host_currency
     OR v_wallet.balance_cents < v_version.host_budget_cents THEN
    RAISE EXCEPTION 'ad_credit_insufficient' USING ERRCODE = 'P0001';
  END IF;
  v_need := v_version.host_budget_cents;
  v_hold.id := gen_random_uuid();
  UPDATE public.ad_credit_wallets
  SET balance_cents = balance_cents - v_version.host_budget_cents,
      held_cents = held_cents + v_version.host_budget_cents,
      updated_at = now()
  WHERE brand_id = v_plan.brand_id;
  INSERT INTO public.ad_credit_ledger (
    brand_id, entry_kind, amount_cents, fee_cents, balance_after_cents,
    currency, actor_id, idempotency_key, metadata
  ) VALUES (
    v_plan.brand_id, 'campaign_spend', -v_version.host_budget_cents, 0,
    v_wallet.balance_cents - v_version.host_budget_cents,
    v_version.host_currency, p_actor_id, btrim(p_idempotency_key),
    jsonb_build_object('plan_id', v_plan.id, 'plan_version_id', v_version.id,
      'plan_hash', v_version.plan_hash, 'hold_id', v_hold.id)
  ) RETURNING * INTO v_ledger;
  INSERT INTO public.ad_plan_funding_holds (
    id, plan_id, plan_version_id, plan_hash, brand_id, funding_source,
    currency, amount_cents, ledger_id, state
  ) VALUES (
    v_hold.id, v_plan.id, v_version.id, v_version.plan_hash, v_plan.brand_id,
    'host_credit', v_version.host_currency, v_version.host_budget_cents,
    v_ledger.id, 'held'
  ) RETURNING * INTO v_hold;
  FOR v_lot IN
    SELECT * FROM public.ad_credit_lots
    WHERE brand_id = v_plan.brand_id AND credit_remaining_cents > 0
    ORDER BY created_at, id FOR UPDATE
  LOOP
    EXIT WHEN v_need <= 0;
    v_take := least(v_lot.credit_remaining_cents, v_need);
    IF v_take = v_lot.credit_remaining_cents THEN
      v_pay_take := v_lot.pay_remaining_cents;
      v_fee_take := v_lot.fee_remaining_cents;
    ELSE
      v_fee_take := floor(v_lot.fee_remaining_cents::numeric * v_take
        / v_lot.credit_remaining_cents)::bigint;
      v_pay_take := v_take + v_fee_take;
    END IF;
    UPDATE public.ad_credit_lots
    SET credit_remaining_cents = credit_remaining_cents - v_take,
        pay_remaining_cents = pay_remaining_cents - v_pay_take,
        fee_remaining_cents = fee_remaining_cents - v_fee_take,
        updated_at = now()
    WHERE id = v_lot.id;
    INSERT INTO public.ad_credit_hold_allocations (
      hold_id, lot_id, credit_cents, pay_cents, fee_cents
    ) VALUES (v_hold.id, v_lot.id, v_take, v_pay_take, v_fee_take);
    v_need := v_need - v_take;
  END LOOP;
  IF v_need > 0 THEN
    RAISE EXCEPTION 'ad_credit_lot_balance_incoherent' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.ad_plans SET state = CASE WHEN review_required
    THEN 'staff_review_required' ELSE 'funded_held' END
  WHERE id = v_plan.id;
  RETURN v_hold;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_plan_mark_admin_funded(
  p_plan_version_id uuid,
  p_plan_hash text
)
RETURNS public.ad_plan_funding_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
BEGIN
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  IF NOT FOUND THEN RAISE EXCEPTION 'ad_plan_version_hash_mismatch' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id FOR UPDATE;
  IF v_plan.owner_kind <> 'mingla' OR v_plan.current_version_id <> v_version.id
     OR v_plan.state <> 'ready_for_funding' THEN
    RAISE EXCEPTION 'ad_plan_not_fundable' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ad_plan_funding_holds (
    plan_id, plan_version_id, plan_hash, funding_source, currency,
    amount_cents, state
  ) VALUES (
    v_plan.id, v_version.id, v_version.plan_hash, 'mingla_provider_account',
    v_version.host_currency, v_version.host_budget_cents, 'held'
  ) ON CONFLICT (plan_version_id) DO UPDATE SET plan_hash = EXCLUDED.plan_hash
  RETURNING * INTO v_hold;
  UPDATE public.ad_plans SET state = CASE WHEN review_required
    THEN 'staff_review_required' ELSE 'funded_held' END
  WHERE id = v_plan.id;
  RETURN v_hold;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_plan_release_funding_hold(
  p_plan_version_id uuid,
  p_plan_hash text,
  p_idempotency_key text,
  p_reason text,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.ad_plan_funding_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
  v_wallet public.ad_credit_wallets%ROWTYPE;
  v_allocation public.ad_credit_hold_allocations%ROWTYPE;
  v_release_ledger public.ad_credit_ledger%ROWTYPE;
BEGIN
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  IF NOT FOUND THEN RAISE EXCEPTION 'ad_plan_version_hash_mismatch' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id FOR UPDATE;
  SELECT * INTO v_hold FROM public.ad_plan_funding_holds
  WHERE plan_version_id = v_version.id FOR UPDATE;
  IF FOUND AND v_hold.state IN ('released','voided') THEN
    RETURN v_hold;
  END IF;
  IF NOT FOUND OR v_hold.state <> 'held' THEN
    RAISE EXCEPTION 'ad_plan_funding_not_held' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ad_provider_attempts a
    WHERE a.plan_version_id = v_version.id
      AND a.command = 'create_paused_objects'
      AND (a.state = 'succeeded' OR a.external_ids <> '{}'::jsonb)
  ) THEN
    RAISE EXCEPTION 'ad_plan_provider_objects_may_exist' USING ERRCODE = '55000';
  END IF;
  IF v_hold.funding_source = 'host_credit' THEN
    SELECT * INTO v_wallet FROM public.ad_credit_wallets
    WHERE brand_id = v_hold.brand_id FOR UPDATE;
    IF NOT FOUND OR v_wallet.held_cents < v_hold.amount_cents THEN
      RAISE EXCEPTION 'ad_plan_wallet_hold_incoherent' USING ERRCODE = 'P0001';
    END IF;
    FOR v_allocation IN
      SELECT * FROM public.ad_credit_hold_allocations
      WHERE hold_id = v_hold.id FOR UPDATE
    LOOP
      UPDATE public.ad_credit_lots
      SET credit_remaining_cents = credit_remaining_cents
            + (v_allocation.credit_cents - v_allocation.restored_credit_cents),
          pay_remaining_cents = pay_remaining_cents
            + (v_allocation.pay_cents - v_allocation.restored_pay_cents),
          fee_remaining_cents = fee_remaining_cents
            + (v_allocation.fee_cents - v_allocation.restored_fee_cents),
          updated_at = now()
      WHERE id = v_allocation.lot_id;
      UPDATE public.ad_credit_hold_allocations
      SET restored_credit_cents = credit_cents,
          restored_pay_cents = pay_cents,
          restored_fee_cents = fee_cents
      WHERE id = v_allocation.id;
    END LOOP;
    UPDATE public.ad_credit_wallets
    SET balance_cents = balance_cents + v_hold.amount_cents,
        held_cents = held_cents - v_hold.amount_cents,
        updated_at = now()
    WHERE brand_id = v_hold.brand_id;
    INSERT INTO public.ad_credit_ledger (
      brand_id, entry_kind, amount_cents, fee_cents, balance_after_cents,
      currency, actor_id, idempotency_key, metadata
    ) VALUES (
      v_hold.brand_id, 'unspend_return', v_hold.amount_cents, 0,
      v_wallet.balance_cents + v_hold.amount_cents, v_hold.currency,
      p_actor_id, btrim(p_idempotency_key), jsonb_build_object(
        'reason', coalesce(nullif(btrim(p_reason), ''), 'released_before_create'),
        'plan_id', v_plan.id,
        'plan_version_id', v_version.id, 'plan_hash', v_version.plan_hash,
        'hold_id', v_hold.id
      )
    ) RETURNING * INTO v_release_ledger;
  END IF;
  UPDATE public.ad_plan_funding_holds
  SET state = CASE WHEN funding_source = 'host_credit' THEN 'released' ELSE 'voided' END,
      released_at = now(), release_ledger_id = v_release_ledger.id
  WHERE id = v_hold.id RETURNING * INTO v_hold;
  RETURN v_hold;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_plan_cancel_before_create(
  p_plan_version_id uuid,
  p_plan_hash text,
  p_idempotency_key text,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.ad_plan_funding_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
BEGIN
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  IF NOT FOUND THEN RAISE EXCEPTION 'ad_plan_version_hash_mismatch' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id FOR UPDATE;
  v_hold := public.ad_plan_release_funding_hold(
    p_plan_version_id, p_plan_hash, p_idempotency_key,
    'cancelled_before_create', p_actor_id
  );
  UPDATE public.ad_plans SET state = 'cancelled_before_create' WHERE id = v_plan.id;
  RETURN v_hold;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_plan_record_review(
  p_plan_version_id uuid,
  p_plan_hash text,
  p_decision text,
  p_reason text,
  p_decided_by uuid
)
RETURNS public.ad_plan_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_review public.ad_plan_reviews%ROWTYPE;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
BEGIN
  IF p_decision NOT IN ('approved','changes_requested','rejected') OR p_decided_by IS NULL THEN
    RAISE EXCEPTION 'ad_plan_review_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  IF NOT FOUND THEN RAISE EXCEPTION 'ad_plan_version_hash_mismatch' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id FOR UPDATE;
  IF v_plan.current_version_id <> v_version.id OR v_plan.state <> 'staff_review_required' THEN
    RAISE EXCEPTION 'ad_plan_review_state_invalid' USING ERRCODE = '55000';
  END IF;
  IF v_version.created_by = p_decided_by THEN
    RAISE EXCEPTION 'ad_plan_reviewer_must_differ_from_author'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.ad_plan_reviews (
    plan_id, plan_version_id, plan_hash, decision, reason, decided_by
  ) VALUES (
    v_plan.id, v_version.id, v_version.plan_hash, p_decision,
    nullif(btrim(coalesce(p_reason,'')), ''), p_decided_by
  ) RETURNING * INTO v_review;
  IF p_decision <> 'approved' THEN
    v_hold := public.ad_plan_release_funding_hold(
      v_version.id, v_version.plan_hash,
      'review_release:' || v_version.plan_hash || ':' || p_decision,
      'staff_' || p_decision, p_decided_by
    );
  END IF;
  UPDATE public.ad_plans SET state = CASE p_decision
    WHEN 'approved' THEN 'staff_approved'
    WHEN 'changes_requested' THEN 'changes_requested'
    ELSE 'staff_rejected' END
  WHERE id = v_plan.id;
  RETURN v_review;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_plan_assert_launchable(
  p_plan_version_id uuid,
  p_plan_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
  v_destination jsonb;
BEGIN
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  IF NOT FOUND THEN RAISE EXCEPTION 'ad_plan_version_hash_mismatch' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id;
  IF v_plan.current_version_id <> v_version.id THEN
    RAISE EXCEPTION 'ad_plan_version_stale' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_hold FROM public.ad_plan_funding_holds
  WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash;
  IF NOT FOUND OR v_hold.state <> 'held' THEN
    RAISE EXCEPTION 'ad_plan_funding_not_held' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ad_plan_provider_allocations a
    WHERE a.plan_version_id = v_version.id
      AND a.fx_expires_at IS NOT NULL AND now() > a.fx_expires_at
  ) THEN
    RAISE EXCEPTION 'ad_plan_fx_quote_expired' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ad_plan_targeting_snapshots t
    WHERE t.plan_version_id = v_version.id AND (
      t.verdict IN ('unavailable','check_required')
      OR (t.verdict = 'broader' AND t.broader_accepted IS NOT TRUE)
    )
  ) THEN
    RAISE EXCEPTION 'ad_plan_targeting_not_accepted' USING ERRCODE = '55000';
  END IF;
  v_destination := public.ad_plan_destination_resolve(
    v_plan.destination_family,
    v_plan.destination_key,
    v_version.canonical_plan->'platforms'
  );
  IF coalesce((v_destination->>'ok')::boolean, false) IS NOT TRUE
     OR coalesce((v_destination->>'ready')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ad_plan_destination_not_ready:%',
      coalesce(v_destination->>'code', 'destination_not_ready')
      USING ERRCODE = '55000';
  END IF;
  IF v_plan.review_required AND NOT EXISTS (
    SELECT 1 FROM public.ad_plan_reviews r
    WHERE r.plan_version_id = v_version.id
      AND r.plan_hash = v_version.plan_hash
      AND r.decision = 'approved'
  ) THEN
    RAISE EXCEPTION 'ad_plan_staff_approval_required' USING ERRCODE = '55000';
  END IF;
  IF v_plan.state NOT IN (
    'funded_held','staff_approved','creating_paused_objects','platform_review',
    'scheduled','paused','partially_live','creation_failed_retryable'
  ) THEN
    RAISE EXCEPTION 'ad_plan_launch_state_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object(
    'plan_id', v_plan.id, 'plan_version_id', v_version.id,
    'plan_hash', v_version.plan_hash, 'host_currency', v_version.host_currency,
    'host_budget_cents', v_version.host_budget_cents,
    'provider_allocations', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'platform', a.platform, 'connection_id', a.connection_id,
        'host_currency', a.host_currency,
        'host_budget_cents', a.host_budget_cents,
        'host_delivery_budget_cents', a.host_delivery_budget_cents,
        'provider_currency', a.provider_currency,
        'provider_budget_cents', a.provider_budget_cents,
        'provider_delivery_budget_cents', a.provider_delivery_budget_cents,
        'fx_snapshot_id', a.fx_snapshot_id,
        'fx_expires_at', a.fx_expires_at
      ) ORDER BY a.platform), '[]'::jsonb)
      FROM public.ad_plan_provider_allocations a
      WHERE a.plan_version_id = v_version.id
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_campaign_plan_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_allocation public.ad_plan_provider_allocations%ROWTYPE;
BEGIN
  IF NEW.plan_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_version FROM public.ad_plan_versions WHERE id = NEW.plan_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ad_plan_version_not_found' USING ERRCODE = '23503'; END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id;
  SELECT * INTO v_allocation FROM public.ad_plan_provider_allocations
  WHERE plan_version_id = v_version.id AND platform = NEW.platform;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_campaign_provider_allocation_missing' USING ERRCODE = '22023';
  END IF;
  IF NEW.plan_hash IS DISTINCT FROM v_version.plan_hash
     OR NEW.connection_id IS DISTINCT FROM v_allocation.connection_id
     OR NEW.host_currency IS DISTINCT FROM v_allocation.host_currency
     OR NEW.provider_currency IS DISTINCT FROM v_allocation.provider_currency
     OR NEW.host_budget_cents IS DISTINCT FROM v_allocation.host_budget_cents
     OR NEW.provider_budget_cents IS DISTINCT FROM v_allocation.provider_budget_cents
     OR NEW.provider_delivery_budget_cents IS DISTINCT FROM v_allocation.provider_delivery_budget_cents
     OR NEW.fx_snapshot_id IS DISTINCT FROM v_allocation.fx_snapshot_id
     OR NEW.owner_kind IS DISTINCT FROM v_plan.owner_kind
     OR NEW.brand_id IS DISTINCT FROM v_plan.brand_id THEN
    RAISE EXCEPTION 'ad_campaign_plan_binding_mismatch' USING ERRCODE = '22023';
  END IF;
  PERFORM public.ad_plan_assert_launchable(v_version.id, v_version.plan_hash);
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_plan_confirmations c
    WHERE c.plan_version_id = v_version.id
      AND c.plan_hash = v_version.plan_hash
      AND c.provided_phrase = c.required_phrase
  ) THEN
    RAISE EXCEPTION 'ad_plan_confirmation_required' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER ad_campaign_plan_binding
  BEFORE INSERT OR UPDATE OF plan_version_id, plan_hash, host_currency,
    provider_currency, host_budget_cents, provider_budget_cents,
    provider_delivery_budget_cents, fx_snapshot_id,
    owner_kind, brand_id, connection_id
  ON public.ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.ad_campaign_plan_binding_guard();

CREATE OR REPLACE FUNCTION public.ad_plan_confirm_launch(
  p_plan_version_id uuid,
  p_plan_hash text,
  p_phrase text,
  p_confirmed_by uuid
)
RETURNS public.ad_plan_confirmations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_required text;
  v_confirmation public.ad_plan_confirmations%ROWTYPE;
BEGIN
  PERFORM public.ad_plan_assert_launchable(p_plan_version_id, p_plan_hash);
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id FOR UPDATE;
  v_required := coalesce(nullif(btrim(v_version.canonical_plan->>'confirmation_phrase'), ''), 'LAUNCH');
  IF p_confirmed_by IS NULL OR p_phrase IS DISTINCT FROM v_required THEN
    RAISE EXCEPTION 'ad_plan_confirmation_phrase_mismatch' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ad_plan_confirmations (
    plan_id, plan_version_id, plan_hash, required_phrase, provided_phrase,
    confirmed_by
  ) VALUES (
    v_plan.id, v_version.id, v_version.plan_hash, v_required, p_phrase,
    p_confirmed_by
  ) ON CONFLICT (plan_version_id, plan_hash) DO NOTHING
  RETURNING * INTO v_confirmation;
  IF NOT FOUND THEN
    SELECT * INTO v_confirmation FROM public.ad_plan_confirmations
    WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash;
  END IF;
  UPDATE public.ad_plans SET state = 'creating_paused_objects'
  WHERE id = v_plan.id
    AND state IN ('funded_held','staff_approved','creation_failed_retryable');
  RETURN v_confirmation;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_record_provider_attempt(
  p_plan_version_id uuid,
  p_plan_hash text,
  p_platform text,
  p_command text,
  p_idempotency_key text,
  p_state text,
  p_external_ids jsonb DEFAULT '{}'::jsonb,
  p_provider_response jsonb DEFAULT NULL,
  p_error_detail text DEFAULT NULL
)
RETURNS public.ad_provider_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_attempt public.ad_provider_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  IF NOT FOUND THEN RAISE EXCEPTION 'ad_plan_version_hash_mismatch' USING ERRCODE = '22023'; END IF;
  IF p_platform NOT IN ('meta','tiktok','snapchat','google','reddit')
     OR p_command NOT IN ('create_paused_objects','activate','pause','stop','fetch_final_spend')
     OR p_state NOT IN ('queued','running','succeeded','failed_retryable','failed_terminal')
     OR p_external_ids IS NULL OR jsonb_typeof(p_external_ids) <> 'object'
     OR (p_provider_response IS NOT NULL AND jsonb_typeof(p_provider_response) <> 'object') THEN
    RAISE EXCEPTION 'ad_provider_attempt_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_command IN ('create_paused_objects','activate') THEN
    PERFORM public.ad_plan_assert_launchable(v_version.id, v_version.plan_hash);
    IF NOT EXISTS (
      SELECT 1 FROM public.ad_plan_confirmations c
      WHERE c.plan_version_id = v_version.id AND c.plan_hash = v_version.plan_hash
        AND c.provided_phrase = c.required_phrase
    ) THEN
      RAISE EXCEPTION 'ad_plan_confirmation_required' USING ERRCODE = '55000';
    END IF;
  END IF;
  INSERT INTO public.ad_provider_attempts (
    plan_id, plan_version_id, plan_hash, platform, command, idempotency_key,
    state, external_ids, provider_response, error_detail,
    started_at, completed_at
  ) VALUES (
    v_version.plan_id, v_version.id, v_version.plan_hash, p_platform,
    p_command, btrim(p_idempotency_key), p_state, p_external_ids,
    p_provider_response, p_error_detail,
    CASE WHEN p_state IN ('running','succeeded','failed_retryable','failed_terminal') THEN now() ELSE NULL END,
    CASE WHEN p_state IN ('succeeded','failed_retryable','failed_terminal') THEN now() ELSE NULL END
  ) ON CONFLICT (platform, idempotency_key) DO UPDATE
  SET state = excluded.state,
      external_ids = excluded.external_ids,
      provider_response = excluded.provider_response,
      error_detail = excluded.error_detail,
      started_at = coalesce(public.ad_provider_attempts.started_at, excluded.started_at),
      completed_at = excluded.completed_at
  WHERE public.ad_provider_attempts.plan_version_id = excluded.plan_version_id
    AND public.ad_provider_attempts.plan_hash = excluded.plan_hash
    AND public.ad_provider_attempts.command = excluded.command
  RETURNING * INTO v_attempt;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_provider_idempotency_binding_mismatch' USING ERRCODE = '23505';
  END IF;
  RETURN v_attempt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_campaign_record_plan_create_success()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.ad_plan_versions%ROWTYPE;
  v_expected integer;
  v_created integer;
BEGIN
  IF NEW.plan_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = NEW.plan_version_id AND plan_hash = NEW.plan_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_campaign_plan_binding_mismatch' USING ERRCODE = '22023';
  END IF;
  PERFORM public.ad_record_provider_attempt(
    v_version.id, v_version.plan_hash, NEW.platform,
    'create_paused_objects', v_version.plan_hash || ':' || NEW.platform || ':create',
    'succeeded', jsonb_build_object('campaign_id', NEW.external_campaign_id),
    jsonb_build_object('status', NEW.status), NULL
  );
  SELECT count(*) INTO v_expected FROM public.ad_plan_provider_allocations
  WHERE plan_version_id = v_version.id;
  SELECT count(DISTINCT platform) INTO v_created FROM public.ad_campaigns
  WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash;
  IF v_expected > 0 AND v_created = v_expected THEN
    UPDATE public.ad_plans SET state = 'platform_review'
    WHERE id = v_version.plan_id AND state = 'creating_paused_objects';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER ad_campaign_record_plan_create_success
  AFTER INSERT ON public.ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.ad_campaign_record_plan_create_success();

CREATE OR REPLACE FUNCTION public.ad_request_campaign_stop(
  p_campaign_id uuid,
  p_requested_at timestamptz DEFAULT now()
)
RETURNS public.ad_campaign_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_campaign public.ad_campaigns%ROWTYPE;
  v_version public.ad_plan_versions%ROWTYPE;
  v_provider_allocation public.ad_plan_provider_allocations%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
  v_settlement public.ad_campaign_settlements%ROWTYPE;
BEGIN
  SELECT * INTO v_campaign FROM public.ad_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND OR v_campaign.plan_version_id IS NULL THEN
    RAISE EXCEPTION 'ad_campaign_plan_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_version FROM public.ad_plan_versions WHERE id = v_campaign.plan_version_id;
  SELECT * INTO v_provider_allocation FROM public.ad_plan_provider_allocations
  WHERE plan_version_id = v_version.id AND platform = v_campaign.platform;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_campaign_provider_allocation_missing' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id FOR UPDATE;
  SELECT * INTO v_hold FROM public.ad_plan_funding_holds WHERE plan_version_id = v_version.id;
  INSERT INTO public.ad_campaign_settlements (
    campaign_id, plan_id, plan_version_id, plan_hash, hold_id, state,
    provider_currency, host_currency, stop_requested_at
  ) VALUES (
    v_campaign.id, v_plan.id, v_version.id, v_version.plan_hash, v_hold.id,
    'stop_requested', v_provider_allocation.provider_currency,
    v_provider_allocation.host_currency,
    p_requested_at
  ) ON CONFLICT (campaign_id) DO UPDATE
    SET state = CASE WHEN public.ad_campaign_settlements.state = 'settled'
      THEN public.ad_campaign_settlements.state ELSE 'stop_requested' END,
        stop_requested_at = least(public.ad_campaign_settlements.stop_requested_at, excluded.stop_requested_at)
  RETURNING * INTO v_settlement;
  IF v_plan.state IN ('scheduled','live','paused','pause_requested','partially_live','partially_ready') THEN
    UPDATE public.ad_plans SET state = 'stop_requested' WHERE id = v_plan.id;
  END IF;
  RETURN v_settlement;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_confirm_campaign_stop(
  p_campaign_id uuid,
  p_final_provider_spend_cents bigint,
  p_provider_currency text,
  p_final_spend_observed_at timestamptz,
  p_provider_evidence jsonb DEFAULT '{}'::jsonb,
  p_finality_delay interval DEFAULT interval '24 hours'
)
RETURNS public.ad_campaign_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_settlement public.ad_campaign_settlements%ROWTYPE;
  v_plan_id uuid;
BEGIN
  SELECT * INTO v_settlement FROM public.ad_campaign_settlements
  WHERE campaign_id = p_campaign_id FOR UPDATE;
  IF NOT FOUND OR v_settlement.state NOT IN (
    'stop_requested','provider_stopped','awaiting_final_spend','ready_to_settle'
  ) THEN
    RAISE EXCEPTION 'ad_settlement_stop_not_requested' USING ERRCODE = '55000';
  END IF;
  IF upper(btrim(coalesce(p_provider_currency,''))) <> v_settlement.provider_currency::text
     OR p_final_provider_spend_cents IS NULL OR p_final_provider_spend_cents < 0
     OR p_final_spend_observed_at IS NULL
     OR p_provider_evidence IS NULL OR jsonb_typeof(p_provider_evidence) <> 'object'
     OR p_finality_delay < interval '0' THEN
    RAISE EXCEPTION 'ad_settlement_provider_evidence_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ad_campaign_settlements
  SET state = 'ready_to_settle', provider_stopped_at = now(),
      final_provider_spend_cents = p_final_provider_spend_cents,
      final_spend_observed_at = p_final_spend_observed_at,
      settle_after = p_final_spend_observed_at + p_finality_delay,
      provider_evidence = p_provider_evidence
  WHERE id = v_settlement.id RETURNING * INTO v_settlement;
  SELECT plan_id INTO v_plan_id FROM public.ad_plan_versions
  WHERE id = v_settlement.plan_version_id;
  UPDATE public.ad_plans SET state = 'settling'
  WHERE id = v_plan_id AND state = 'stop_requested';
  RETURN v_settlement;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_finalize_campaign_settlement(
  p_campaign_id uuid,
  p_idempotency_key text,
  p_now timestamptz DEFAULT now()
)
RETURNS public.ad_campaign_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_settlement public.ad_campaign_settlements%ROWTYPE;
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_provider_allocation public.ad_plan_provider_allocations%ROWTYPE;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
  v_wallet public.ad_credit_wallets%ROWTYPE;
  v_allocation public.ad_credit_hold_allocations%ROWTYPE;
  v_host_spend bigint;
  v_release bigint;
  v_need bigint;
  v_restore bigint;
  v_fee_restore bigint;
  v_pay_restore bigint;
  v_release_ledger public.ad_credit_ledger%ROWTYPE;
  v_expected_campaigns integer;
  v_bound_campaigns integer;
  v_ready_settlements integer;
  v_total_host_spend bigint;
BEGIN
  SELECT * INTO v_settlement FROM public.ad_campaign_settlements
  WHERE campaign_id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ad_settlement_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_settlement.state = 'settled' THEN RETURN v_settlement; END IF;
  IF v_settlement.state <> 'ready_to_settle'
     OR v_settlement.provider_stopped_at IS NULL
     OR v_settlement.final_spend_observed_at IS NULL
     OR v_settlement.settle_after IS NULL
     OR p_now < v_settlement.settle_after THEN
    RAISE EXCEPTION 'ad_settlement_not_final' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_version FROM public.ad_plan_versions WHERE id = v_settlement.plan_version_id;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id FOR UPDATE;
  SELECT a.* INTO v_provider_allocation
  FROM public.ad_plan_provider_allocations a
  JOIN public.ad_campaigns c
    ON c.plan_version_id = a.plan_version_id AND c.platform = a.platform
  WHERE c.id = v_settlement.campaign_id AND a.plan_version_id = v_version.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_campaign_provider_allocation_missing' USING ERRCODE = '22023';
  END IF;
  IF v_settlement.final_provider_spend_cents > v_provider_allocation.provider_budget_cents THEN
    UPDATE public.ad_campaign_settlements SET state = 'attention_required'
    WHERE id = v_settlement.id RETURNING * INTO v_settlement;
    UPDATE public.ad_plans SET state = 'settlement_attention_required' WHERE id = v_plan.id;
    RETURN v_settlement;
  END IF;
  IF v_provider_allocation.host_currency = v_provider_allocation.provider_currency THEN
    v_host_spend := v_settlement.final_provider_spend_cents;
  ELSE
    v_host_spend := public.ad_fx_convert_frozen_minor(
      v_settlement.final_provider_spend_cents,
      v_provider_allocation.provider_currency,
      v_provider_allocation.host_currency,
      v_provider_allocation.fx_snapshot_id
    );
  END IF;
  UPDATE public.ad_campaign_settlements
  SET final_host_spend_cents = v_host_spend
  WHERE id = v_settlement.id RETURNING * INTO v_settlement;

  SELECT count(*) INTO v_expected_campaigns
  FROM public.ad_plan_provider_allocations
  WHERE plan_version_id = v_version.id;
  SELECT count(*) INTO v_bound_campaigns
  FROM public.ad_campaigns
  WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash;
  SELECT count(*) INTO v_ready_settlements
  FROM public.ad_campaign_settlements s
  JOIN public.ad_campaigns c ON c.id = s.campaign_id
  WHERE s.plan_version_id = v_version.id
    AND s.plan_hash = v_version.plan_hash
    AND c.plan_version_id = v_version.id
    AND c.plan_hash = v_version.plan_hash
    AND s.state IN ('ready_to_settle','settled')
    AND s.final_host_spend_cents IS NOT NULL
    AND s.settle_after IS NOT NULL
    AND s.settle_after <= p_now;
  IF v_expected_campaigns = 0
     OR v_bound_campaigns <> v_expected_campaigns
     OR v_ready_settlements <> v_expected_campaigns THEN
    RETURN v_settlement;
  END IF;
  SELECT coalesce(sum(final_host_spend_cents), 0) INTO v_total_host_spend
  FROM public.ad_campaign_settlements
  WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash;
  IF v_plan.owner_kind = 'mingla' THEN
    UPDATE public.ad_campaign_settlements
    SET state = 'settled', released_host_cents = 0, settled_at = p_now
    WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash;
    UPDATE public.ad_plan_funding_holds SET state = 'settled', settled_at = p_now
    WHERE id = v_settlement.hold_id;
    UPDATE public.ad_plans SET state = 'ended' WHERE id = v_plan.id;
    UPDATE public.ad_campaigns SET status = 'ARCHIVED'
    WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash;
    SELECT * INTO v_settlement FROM public.ad_campaign_settlements
    WHERE campaign_id = p_campaign_id;
    RETURN v_settlement;
  END IF;
  SELECT * INTO v_hold FROM public.ad_plan_funding_holds
  WHERE id = v_settlement.hold_id FOR UPDATE;
  IF NOT FOUND OR v_hold.state <> 'held' OR v_total_host_spend > v_hold.amount_cents THEN
    UPDATE public.ad_campaign_settlements SET state = 'attention_required'
    WHERE id = v_settlement.id RETURNING * INTO v_settlement;
    UPDATE public.ad_plans SET state = 'settlement_attention_required' WHERE id = v_plan.id;
    RETURN v_settlement;
  END IF;
  v_release := v_hold.amount_cents - v_total_host_spend;
  v_need := v_release;
  FOR v_allocation IN
    SELECT * FROM public.ad_credit_hold_allocations
    WHERE hold_id = v_hold.id
    ORDER BY created_at DESC, id DESC FOR UPDATE
  LOOP
    EXIT WHEN v_need <= 0;
    v_restore := least(v_allocation.credit_cents - v_allocation.restored_credit_cents, v_need);
    IF v_restore <= 0 THEN CONTINUE; END IF;
    IF v_restore = v_allocation.credit_cents - v_allocation.restored_credit_cents THEN
      v_fee_restore := v_allocation.fee_cents - v_allocation.restored_fee_cents;
      v_pay_restore := v_allocation.pay_cents - v_allocation.restored_pay_cents;
    ELSE
      v_fee_restore := floor((v_allocation.fee_cents - v_allocation.restored_fee_cents)::numeric
        * v_restore / (v_allocation.credit_cents - v_allocation.restored_credit_cents))::bigint;
      v_pay_restore := v_restore + v_fee_restore;
    END IF;
    UPDATE public.ad_credit_lots
    SET credit_remaining_cents = credit_remaining_cents + v_restore,
        pay_remaining_cents = pay_remaining_cents + v_pay_restore,
        fee_remaining_cents = fee_remaining_cents + v_fee_restore,
        updated_at = now()
    WHERE id = v_allocation.lot_id;
    UPDATE public.ad_credit_hold_allocations
    SET restored_credit_cents = restored_credit_cents + v_restore,
        restored_pay_cents = restored_pay_cents + v_pay_restore,
        restored_fee_cents = restored_fee_cents + v_fee_restore
    WHERE id = v_allocation.id;
    v_need := v_need - v_restore;
  END LOOP;
  IF v_need > 0 THEN
    RAISE EXCEPTION 'ad_settlement_allocation_incoherent' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_wallet FROM public.ad_credit_wallets
  WHERE brand_id = v_hold.brand_id FOR UPDATE;
  IF NOT FOUND OR v_wallet.held_cents < v_hold.amount_cents THEN
    RAISE EXCEPTION 'ad_settlement_wallet_incoherent' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.ad_credit_wallets
  SET balance_cents = balance_cents + v_release,
      held_cents = held_cents - v_hold.amount_cents,
      updated_at = now()
  WHERE brand_id = v_hold.brand_id;
  IF v_release > 0 THEN
    INSERT INTO public.ad_credit_ledger (
      brand_id, entry_kind, amount_cents, fee_cents, balance_after_cents,
      currency, campaign_id, idempotency_key, metadata
    ) VALUES (
      v_hold.brand_id, 'unspend_return', v_release, 0,
      v_wallet.balance_cents + v_release, v_hold.currency, p_campaign_id,
      btrim(p_idempotency_key), jsonb_build_object(
        'plan_id', v_plan.id, 'plan_version_id', v_version.id,
        'plan_hash', v_version.plan_hash, 'hold_id', v_hold.id,
        'final_host_spend_cents', v_total_host_spend,
        'campaign_count', v_expected_campaigns
      )
    ) RETURNING * INTO v_release_ledger;
  END IF;
  UPDATE public.ad_plan_funding_holds
  SET state = 'settled', settled_at = p_now,
      release_ledger_id = v_release_ledger.id,
      released_at = CASE WHEN v_release > 0 THEN p_now ELSE NULL END
  WHERE id = v_hold.id;
  UPDATE public.ad_campaign_settlements
  SET state = 'settled',
      released_host_cents = CASE WHEN id = v_settlement.id THEN v_release ELSE 0 END,
      settled_at = p_now
  WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash;
  UPDATE public.ad_plans SET state = 'ended' WHERE id = v_plan.id;
  UPDATE public.ad_campaigns SET status = 'ARCHIVED'
  WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash;
  SELECT * INTO v_settlement FROM public.ad_campaign_settlements
  WHERE campaign_id = p_campaign_id;
  RETURN v_settlement;
END;
$function$;

ALTER TABLE public.ad_status_events
  DROP CONSTRAINT IF EXISTS ad_status_events_action_check;
ALTER TABLE public.ad_status_events
  ADD CONSTRAINT ad_status_events_action_check CHECK (action IN (
    'create','launch','pause','sync','create_failed','rollback',
    'stop_requested','stop_confirmed','settlement'
  ));

-- Read access follows the aggregate. All writes remain service-role functions.
ALTER TABLE public.ad_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_plan_provider_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_plan_targeting_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_plan_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_plan_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_plan_funding_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_credit_hold_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_provider_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_campaign_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY ad_plans_read ON public.ad_plans FOR SELECT TO authenticated USING (
  public.is_admin_user() OR (
    brand_id IS NOT NULL AND public.biz_is_brand_member_for_read_for_caller(brand_id)
  )
);
CREATE POLICY ad_plan_versions_read ON public.ad_plan_versions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.ad_plans p WHERE p.id = plan_id AND (
    public.is_admin_user() OR (p.brand_id IS NOT NULL AND public.biz_is_brand_member_for_read_for_caller(p.brand_id))
  ))
);
CREATE POLICY ad_plan_provider_allocations_read ON public.ad_plan_provider_allocations
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.ad_plan_versions v JOIN public.ad_plans p ON p.id = v.plan_id
    WHERE v.id = plan_version_id AND (public.is_admin_user() OR (
      p.brand_id IS NOT NULL AND public.biz_is_brand_member_for_read_for_caller(p.brand_id)
    )))
);
CREATE POLICY ad_plan_targeting_read ON public.ad_plan_targeting_snapshots FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.ad_plan_versions v JOIN public.ad_plans p ON p.id = v.plan_id
    WHERE v.id = plan_version_id AND (public.is_admin_user() OR (
      p.brand_id IS NOT NULL AND public.biz_is_brand_member_for_read_for_caller(p.brand_id)
    )))
);
CREATE POLICY ad_plan_reviews_read ON public.ad_plan_reviews FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.ad_plans p WHERE p.id = plan_id AND (
    public.is_admin_user() OR (p.brand_id IS NOT NULL AND public.biz_is_brand_member_for_read_for_caller(p.brand_id))
  ))
);
CREATE POLICY ad_plan_confirmations_read ON public.ad_plan_confirmations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.ad_plans p WHERE p.id = plan_id AND (
    public.is_admin_user() OR (p.brand_id IS NOT NULL AND public.biz_is_brand_member_for_read_for_caller(p.brand_id))
  ))
);
CREATE POLICY ad_plan_holds_read ON public.ad_plan_funding_holds FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.ad_plans p WHERE p.id = plan_id AND (
    public.is_admin_user() OR (p.brand_id IS NOT NULL AND public.biz_can_view_payments_for_brand_for_caller(p.brand_id))
  ))
);
CREATE POLICY ad_provider_attempts_read ON public.ad_provider_attempts FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.ad_plans p WHERE p.id = plan_id AND (
    public.is_admin_user() OR (p.brand_id IS NOT NULL AND public.biz_is_brand_member_for_read_for_caller(p.brand_id))
  ))
);
CREATE POLICY ad_settlements_read ON public.ad_campaign_settlements FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.ad_plans p WHERE p.id = plan_id AND (
    public.is_admin_user() OR (p.brand_id IS NOT NULL AND public.biz_can_view_payments_for_brand_for_caller(p.brand_id))
  ))
);

REVOKE ALL ON public.ad_plans, public.ad_plan_versions,
  public.ad_plan_provider_allocations,
  public.ad_plan_targeting_snapshots, public.ad_plan_reviews,
  public.ad_plan_confirmations,
  public.ad_plan_funding_holds, public.ad_credit_hold_allocations,
  public.ad_provider_attempts, public.ad_campaign_settlements
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ad_plans, public.ad_plan_versions,
  public.ad_plan_provider_allocations,
  public.ad_plan_targeting_snapshots, public.ad_plan_reviews,
  public.ad_plan_confirmations,
  public.ad_plan_funding_holds, public.ad_provider_attempts,
  public.ad_campaign_settlements TO authenticated, service_role;
GRANT SELECT ON public.ad_credit_hold_allocations TO service_role;
GRANT ALL ON public.ad_plans, public.ad_plan_versions,
  public.ad_plan_provider_allocations,
  public.ad_plan_targeting_snapshots, public.ad_plan_reviews,
  public.ad_plan_confirmations,
  public.ad_plan_funding_holds, public.ad_credit_hold_allocations,
  public.ad_provider_attempts, public.ad_campaign_settlements TO service_role;

REVOKE ALL ON FUNCTION public.ad_immutable_row_guard(),
  public.ad_plan_set_updated_at(), public.ad_plan_state_transition_guard(),
  public.ad_campaign_plan_binding_guard(),
  public.ad_campaign_record_plan_create_success() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_fx_convert_frozen_minor(bigint,character,character,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_plan_open(text,text,uuid,text,text,jsonb,uuid),
  public.ad_plan_create_version(uuid,jsonb,bigint,text,jsonb,uuid),
  public.ad_plan_quote_for_brand(uuid,uuid,bigint),
  public.ad_plan_mark_ready(uuid,text), public.ad_plan_hold_host_funds(uuid,text,text,uuid),
  public.ad_plan_mark_admin_funded(uuid,text),
  public.ad_plan_release_funding_hold(uuid,text,text,text,uuid),
  public.ad_plan_cancel_before_create(uuid,text,text,uuid),
  public.ad_plan_record_review(uuid,text,text,text,uuid),
  public.ad_plan_assert_launchable(uuid,text),
  public.ad_plan_confirm_launch(uuid,text,text,uuid),
  public.ad_record_provider_attempt(uuid,text,text,text,text,text,jsonb,jsonb,text),
  public.ad_request_campaign_stop(uuid,timestamptz),
  public.ad_confirm_campaign_stop(uuid,bigint,text,timestamptz,jsonb,interval),
  public.ad_finalize_campaign_settlement(uuid,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_plan_open(text,text,uuid,text,text,jsonb,uuid),
  public.ad_plan_create_version(uuid,jsonb,bigint,text,jsonb,uuid),
  public.ad_plan_quote_for_brand(uuid,uuid,bigint),
  public.ad_plan_mark_ready(uuid,text), public.ad_plan_hold_host_funds(uuid,text,text,uuid),
  public.ad_plan_mark_admin_funded(uuid,text),
  public.ad_plan_cancel_before_create(uuid,text,text,uuid),
  public.ad_plan_record_review(uuid,text,text,text,uuid),
  public.ad_plan_assert_launchable(uuid,text),
  public.ad_plan_confirm_launch(uuid,text,text,uuid),
  public.ad_record_provider_attempt(uuid,text,text,text,text,text,jsonb,jsonb,text),
  public.ad_request_campaign_stop(uuid,timestamptz),
  public.ad_confirm_campaign_stop(uuid,bigint,text,timestamptz,jsonb,interval),
  public.ad_finalize_campaign_settlement(uuid,text,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_fx_convert_frozen_minor(bigint,character,character,uuid)
  TO service_role;

-- The currency migration captured the legacy before-image before these
-- provider-budget columns existed. Refresh only the after-image now that the
-- immutable provider allocation is available; never relabel Host minor units
-- as provider money.
WITH post_snapshot AS (
  SELECT
    a.brand_id,
    public.ad_currency_reconciliation_snapshot(a.brand_id) AS detail
  FROM public.ad_currency_migration_audit a
)
UPDATE public.ad_currency_migration_audit a
SET post_wallet_currency = s.detail->>'wallet_currency',
    post_wallet_balance_cents =
      (s.detail->>'wallet_balance_cents')::bigint,
    post_ledger_balance_cents =
      (s.detail->>'ledger_balance_cents')::bigint,
    post_ledger_terminal_balance_cents =
      (s.detail->>'ledger_terminal_balance_cents')::bigint,
    post_ledger_reconciles =
      (s.detail->>'ledger_reconciles')::boolean,
    post_provider_liability_by_currency =
      s.detail->'provider_liability_by_currency',
    post_provider_liability_campaigns =
      s.detail->'provider_liability_campaigns'
FROM post_snapshot s
WHERE s.brand_id = a.brand_id;

COMMENT ON TABLE public.ad_plans IS
  'Issue #3697 v1.4 stable ad aggregate shared by Admin, Host and Ari. current_version_id is the only executable version.';
COMMENT ON TABLE public.ad_plan_versions IS
  'Append-only canonical plan versions. The SHA-256 binds targeting, money, review, confirmation and provider objects.';
COMMENT ON TABLE public.ad_plan_provider_allocations IS
  'Append-only per-platform provider connection, provider currency, allocated budget and frozen FX quote bound into the plan SHA-256.';
COMMENT ON TABLE public.ad_campaign_settlements IS
  'Provider-confirmed stop and final-spend gate. No unused Host credit is released before ready_to_settle.';

COMMIT;
