-- Issue #4238 — Host Ads media-buyer upgrade.
--
-- Spec: https://github.com/Mingla-LLC/mingla-main/issues/4238#issuecomment-6612906506
--
-- What this adds:
--   1. ad_platform_country_availability — staff-editable "works here" per ad
--      app and country. A missing row means the app works there until staff
--      mark it otherwise (Seth's decision). Written only through
--      admin_set_ad_platform_country.
--   2. ad_ops_switch_events + admin_set_ad_reach_estimates — the per-app reach
--      switch (the existing ad_connections.extra.audience_estimate_certified
--      flag adProviderEstimate.ts reads), audited. Ships OFF.
--   3. host_ad_live_edits + host_ad_amend_live — a Host changes a live ad's
--      budget and end date once a day; Ads credit is set aside or given back
--      in the same transaction.
--   4. ad_finalize_campaign_settlement — the overspend check reads the amended
--      provider cap (a raised cap must not flag "attention required").
--
-- Static SQL only. Conflicts raise PT409, never 40001. New functions are
-- revoked from PUBLIC and anon. New tables have RLS on. No personal data.
-- Do NOT auto-apply — reviewed path post-merge.

BEGIN;

-- ── 1. Works here, per app and country ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_platform_country_availability (
  platform text NOT NULL CHECK (platform IN ('meta', 'tiktok', 'snapchat', 'google', 'reddit')),
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  status text NOT NULL CHECK (status IN ('works', 'not_available')),
  reason text NULL CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 200),
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, country_code)
);

COMMENT ON TABLE public.ad_platform_country_availability IS
  'Issue #4238: whether an ad app runs in a country on Mingla''s accounts. No row = works (until staff mark it). Host builder greys an app out with the reason; ad-plan create_version refuses an app that runs in none of the chosen countries.';

ALTER TABLE public.ad_platform_country_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_platform_country_availability_admin_read
  ON public.ad_platform_country_availability;
CREATE POLICY ad_platform_country_availability_admin_read
  ON public.ad_platform_country_availability
  FOR SELECT TO authenticated USING (public.is_admin_user());
REVOKE ALL ON public.ad_platform_country_availability FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.ad_platform_country_availability FROM authenticated;
GRANT SELECT ON public.ad_platform_country_availability TO authenticated;
GRANT ALL ON public.ad_platform_country_availability TO service_role;

-- Proven or documented today: TikTok has no United Kingdom market on Mingla's
-- advertiser (2026-07-15) and Reddit does not sell ads in Nigeria.
INSERT INTO public.ad_platform_country_availability (platform, country_code, status, reason)
VALUES
  ('tiktok', 'GB', 'not_available', 'TikTok can''t run ads in the United Kingdom on Mingla''s account yet.'),
  ('reddit', 'NG', 'not_available', 'Reddit doesn''t run ads in Nigeria.')
ON CONFLICT (platform, country_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_set_ad_platform_country(
  p_platform text,
  p_country_code text,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS public.ad_platform_country_availability
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.ad_platform_country_availability%ROWTYPE;
  v_country text := upper(btrim(coalesce(p_country_code, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('meta', 'tiktok', 'snapchat', 'google', 'reddit') THEN
    RAISE EXCEPTION 'platform_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'country_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('works', 'not_available', 'not_checked') THEN
    RAISE EXCEPTION 'status_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'not_available' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  -- "Not checked yet" removes the row: unknown means it works for Hosts.
  IF p_status = 'not_checked' THEN
    DELETE FROM public.ad_platform_country_availability
    WHERE platform = p_platform AND country_code = v_country
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  INSERT INTO public.ad_platform_country_availability (
    platform, country_code, status, reason, updated_by, updated_at
  ) VALUES (
    p_platform, v_country, p_status, left(v_reason, 200), auth.uid(), now()
  )
  ON CONFLICT (platform, country_code) DO UPDATE
  SET status = EXCLUDED.status,
      reason = EXCLUDED.reason,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_ad_platform_country(text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_ad_platform_country(text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_ad_platform_country(text, text, text, text) IS
  'Issue #4238: staff mark whether an ad app runs in a country (works / not_available with a reason / not_checked = delete). Admins only (42501 otherwise).';

-- ── 2. Per-app reach switch ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_ops_switch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  switch text NOT NULL CHECK (switch IN ('reach_estimates')),
  platform text NOT NULL CHECK (platform IN ('meta', 'tiktok', 'snapchat', 'google', 'reddit')),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  actor_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ad_ops_switch_events IS
  'Issue #4238: append-only audit of staff ad switches (per-app reach estimates).';

DROP TRIGGER IF EXISTS ad_ops_switch_events_immutable ON public.ad_ops_switch_events;
CREATE TRIGGER ad_ops_switch_events_immutable
  BEFORE UPDATE OR DELETE ON public.ad_ops_switch_events
  FOR EACH ROW EXECUTE FUNCTION public.ad_immutable_row_guard();

ALTER TABLE public.ad_ops_switch_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_ops_switch_events_admin_read ON public.ad_ops_switch_events;
CREATE POLICY ad_ops_switch_events_admin_read ON public.ad_ops_switch_events
  FOR SELECT TO authenticated USING (public.is_admin_user());
REVOKE ALL ON public.ad_ops_switch_events FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.ad_ops_switch_events FROM authenticated;
GRANT SELECT ON public.ad_ops_switch_events TO authenticated;
GRANT ALL ON public.ad_ops_switch_events TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_ad_reach_estimates(
  p_platform text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('meta', 'tiktok', 'snapchat', 'reddit') THEN
    -- Google's reach planner needs allowlisting first; it has no switch.
    RAISE EXCEPTION 'platform_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled_required' USING ERRCODE = '22023';
  END IF;
  -- Host ads run on the consumer lane (#4238 D1, HOST_AD_LANE).
  UPDATE public.ad_connections
  SET extra = coalesce(extra, '{}'::jsonb)
        || jsonb_build_object('audience_estimate_certified', p_enabled)
  WHERE platform = p_platform AND lane = 'consumer';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.ad_ops_switch_events (switch, platform, value, actor_id)
  VALUES ('reach_estimates', p_platform,
    jsonb_build_object('enabled', p_enabled, 'rows', v_count), auth.uid());
  RETURN jsonb_build_object('platform', p_platform, 'enabled', p_enabled, 'rows', v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_ad_reach_estimates(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_ad_reach_estimates(text, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_ad_reach_estimates(text, boolean) IS
  'Issue #4238: staff switch Host reach estimates on or off per ad app (the read-only provider reach call). Admins only (42501 otherwise). Audited in ad_ops_switch_events.';

-- ── 3. Host live edits: budget and end date, once a day ─────────────────────
CREATE TABLE IF NOT EXISTS public.host_ad_live_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.ad_plans(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL REFERENCES public.ad_plan_versions(id) ON DELETE RESTRICT,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL UNIQUE
    CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  previous_host_budget_cents bigint NOT NULL CHECK (previous_host_budget_cents > 0),
  new_host_budget_cents bigint NOT NULL CHECK (new_host_budget_cents > 0),
  previous_ends_at timestamptz NULL,
  new_ends_at timestamptz NULL,
  hold_delta_cents bigint NOT NULL,
  host_spend_cents bigint NOT NULL CHECK (host_spend_cents >= 0),
  ledger_id uuid NULL REFERENCES public.ad_credit_ledger(id) ON DELETE RESTRICT,
  actor_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT host_ad_live_edit_budget_covers_spend
    CHECK (new_host_budget_cents >= host_spend_cents)
);

CREATE INDEX IF NOT EXISTS host_ad_live_edits_plan_idx
  ON public.host_ad_live_edits (plan_id, created_at DESC);

COMMENT ON TABLE public.host_ad_live_edits IS
  'Issue #4238: append-only record of a Host changing a live ad''s budget and/or end date (once a day). The hold, lots and ledger move in the same transaction (host_ad_amend_live).';

DROP TRIGGER IF EXISTS host_ad_live_edits_immutable ON public.host_ad_live_edits;
CREATE TRIGGER host_ad_live_edits_immutable
  BEFORE UPDATE OR DELETE ON public.host_ad_live_edits
  FOR EACH ROW EXECUTE FUNCTION public.ad_immutable_row_guard();

ALTER TABLE public.host_ad_live_edits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS host_ad_live_edits_admin_read ON public.host_ad_live_edits;
CREATE POLICY host_ad_live_edits_admin_read ON public.host_ad_live_edits
  FOR SELECT TO authenticated USING (public.is_admin_user());
REVOKE ALL ON public.host_ad_live_edits FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.host_ad_live_edits FROM authenticated;
GRANT SELECT ON public.host_ad_live_edits TO authenticated;
GRANT ALL ON public.host_ad_live_edits TO service_role;

-- p_changes: [{campaign_id, new_provider_budget_cents,
--              new_provider_delivery_budget_cents}] covering every campaign
-- of the plan, or [] when only the end date moves. The edge function works
-- the provider amounts out with each campaign's frozen exchange rate and has
-- already pushed the daily budgets (and end time) to the apps that take them.
CREATE OR REPLACE FUNCTION public.host_ad_amend_live(
  p_plan_version_id uuid,
  p_plan_hash text,
  p_new_host_budget_cents bigint,
  p_new_ends_at timestamptz,
  p_changes jsonb,
  p_actor_id uuid,
  p_idempotency_key text,
  p_provider_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS public.host_ad_live_edits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing public.host_ad_live_edits%ROWTYPE;
  v_edit public.host_ad_live_edits%ROWTYPE;
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
  v_wallet public.ad_credit_wallets%ROWTYPE;
  v_lot public.ad_credit_lots%ROWTYPE;
  v_allocation public.ad_credit_hold_allocations%ROWTYPE;
  v_campaign public.ad_campaigns%ROWTYPE;
  v_amendment public.ad_plan_budget_amendments%ROWTYPE;
  v_ledger public.ad_credit_ledger%ROWTYPE;
  v_change jsonb;
  v_destination jsonb;
  v_last_bookable timestamptz;
  v_previous_ends timestamptz;
  v_spend_host bigint := 0;
  v_spend_provider bigint;
  v_new_budget bigint;
  v_delta bigint;
  v_need bigint;
  v_take bigint;
  v_pay_take bigint;
  v_fee_take bigint;
  v_restore bigint;
  v_fee_restore bigint;
  v_pay_restore bigint;
  v_new_cap bigint;
  v_new_daily bigint;
  v_prev_cap bigint;
  v_prev_daily bigint;
  v_count integer;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
BEGIN
  IF char_length(v_key) < 8 OR char_length(v_key) > 200 THEN
    RAISE EXCEPTION 'host_ad_live_edit_key_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.host_ad_live_edits WHERE idempotency_key = v_key;
  IF FOUND THEN RETURN v_existing; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'host_ad_live_edit_changes_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_provider_evidence IS NULL OR jsonb_typeof(p_provider_evidence) <> 'object' THEN
    RAISE EXCEPTION 'host_ad_live_edit_evidence_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_new_host_budget_cents IS NULL AND p_new_ends_at IS NULL THEN
    RAISE EXCEPTION 'host_ad_live_edit_empty' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_version FROM public.ad_plan_versions
  WHERE id = p_plan_version_id AND plan_hash = lower(p_plan_hash);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_plan_version_hash_mismatch' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_plan FROM public.ad_plans WHERE id = v_version.plan_id FOR UPDATE;
  IF v_plan.owner_kind <> 'host'
     OR v_plan.current_version_id IS DISTINCT FROM v_version.id
     OR v_plan.state NOT IN (
       'platform_review', 'scheduled', 'live', 'pause_requested', 'paused',
       'partially_ready', 'partially_live'
     ) THEN
    RAISE EXCEPTION 'host_ad_live_edit_state_invalid' USING ERRCODE = '55000';
  END IF;
  -- Seth's decision: once a day, so the apps' learning isn't reset all the time.
  IF EXISTS (
    SELECT 1 FROM public.host_ad_live_edits e
    WHERE e.plan_id = v_plan.id AND e.created_at > now() - interval '24 hours'
  ) THEN
    RAISE EXCEPTION 'host_ad_live_edit_once_a_day' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_hold FROM public.ad_plan_funding_holds
  WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash
  FOR UPDATE;
  IF NOT FOUND OR v_hold.state <> 'held' OR v_hold.funding_source <> 'host_credit' THEN
    RAISE EXCEPTION 'host_ad_live_edit_funding_not_held' USING ERRCODE = '55000';
  END IF;

  -- The end date: in the future, and never after the last bookable moment.
  SELECT max(c.ends_at) INTO v_previous_ends FROM public.ad_campaigns c
  WHERE c.plan_version_id = v_version.id AND c.plan_hash = v_version.plan_hash;
  IF p_new_ends_at IS NOT NULL THEN
    IF p_new_ends_at <= now() THEN
      RAISE EXCEPTION 'host_ad_live_edit_end_in_past' USING ERRCODE = '22023';
    END IF;
    v_destination := public.ad_plan_destination_resolve(
      v_plan.destination_family,
      v_plan.destination_key,
      (SELECT coalesce(jsonb_agg(a.platform ORDER BY a.platform), '[]'::jsonb)
       FROM public.ad_plan_provider_allocations a
       WHERE a.plan_version_id = v_version.id)
    );
    v_last_bookable := nullif(v_destination->>'last_bookable_at', '')::timestamptz;
    IF v_last_bookable IS NOT NULL AND p_new_ends_at > v_last_bookable THEN
      RAISE EXCEPTION 'host_ad_live_edit_end_after_last_bookable' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  -- Spend so far, in the brand's money, at each campaign's frozen rate.
  FOR v_campaign IN
    SELECT * FROM public.ad_campaigns c
    WHERE c.plan_version_id = v_version.id AND c.plan_hash = v_version.plan_hash
    ORDER BY c.id FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.ad_spend_daily s
      WHERE s.campaign_id = v_campaign.id
        AND upper(btrim(coalesce(s.currency, ''))) <> v_campaign.provider_currency
    ) THEN
      RAISE EXCEPTION 'ad_budget_spend_currency_mismatch' USING ERRCODE = '55000';
    END IF;
    SELECT coalesce(sum(s.spend_cents), 0) INTO v_spend_provider
    FROM public.ad_spend_daily s WHERE s.campaign_id = v_campaign.id;
    v_spend_host := v_spend_host + CASE
      WHEN v_campaign.provider_currency = v_hold.currency::text THEN v_spend_provider
      ELSE public.ad_fx_convert_frozen_minor(
        v_spend_provider, v_campaign.provider_currency::char(3),
        v_hold.currency, v_campaign.fx_snapshot_id)
    END;
  END LOOP;

  v_new_budget := coalesce(p_new_host_budget_cents, v_hold.amount_cents);
  IF v_new_budget <= 0 THEN
    RAISE EXCEPTION 'host_ad_live_edit_amount_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_new_budget < v_spend_host THEN
    RAISE EXCEPTION 'host_ad_live_edit_below_spend' USING ERRCODE = 'PT409';
  END IF;
  v_delta := v_new_budget - v_hold.amount_cents;

  IF v_delta <> 0 AND jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'host_ad_live_edit_changes_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_wallet FROM public.ad_credit_wallets
  WHERE brand_id = v_hold.brand_id FOR UPDATE;
  IF NOT FOUND OR v_wallet.currency <> v_hold.currency
     OR v_wallet.held_cents < v_hold.amount_cents THEN
    RAISE EXCEPTION 'ad_plan_wallet_hold_incoherent' USING ERRCODE = 'P0001';
  END IF;

  IF v_delta > 0 THEN
    -- Raise: set the extra money aside from Ads credit now, oldest credit first.
    IF v_wallet.balance_cents < v_delta THEN
      RAISE EXCEPTION 'ad_credit_insufficient' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.ad_credit_wallets
    SET balance_cents = balance_cents - v_delta,
        held_cents = held_cents + v_delta,
        updated_at = now()
    WHERE brand_id = v_hold.brand_id;
    INSERT INTO public.ad_credit_ledger (
      brand_id, entry_kind, amount_cents, fee_cents, balance_after_cents,
      currency, actor_id, idempotency_key, metadata
    ) VALUES (
      v_hold.brand_id, 'campaign_spend', -v_delta, 0,
      v_wallet.balance_cents - v_delta, v_hold.currency, p_actor_id,
      'host_live_' || v_key, jsonb_build_object(
        'reason', 'live_budget_raise', 'plan_id', v_plan.id,
        'plan_version_id', v_version.id, 'plan_hash', v_version.plan_hash,
        'hold_id', v_hold.id)
    ) RETURNING * INTO v_ledger;
    v_need := v_delta;
    FOR v_lot IN
      SELECT * FROM public.ad_credit_lots
      WHERE brand_id = v_hold.brand_id AND credit_remaining_cents > 0
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
      ) VALUES (v_hold.id, v_lot.id, v_take, v_pay_take, v_fee_take)
      ON CONFLICT (hold_id, lot_id) DO UPDATE
      SET credit_cents = public.ad_credit_hold_allocations.credit_cents + EXCLUDED.credit_cents,
          pay_cents = public.ad_credit_hold_allocations.pay_cents + EXCLUDED.pay_cents,
          fee_cents = public.ad_credit_hold_allocations.fee_cents + EXCLUDED.fee_cents;
      v_need := v_need - v_take;
    END LOOP;
    IF v_need > 0 THEN
      RAISE EXCEPTION 'ad_credit_lot_balance_incoherent' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_delta < 0 THEN
    -- Lower: give the difference back to Ads credit now, newest first (the
    -- same order settlement restores in).
    v_need := -v_delta;
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
      RAISE EXCEPTION 'ad_credit_lot_balance_incoherent' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.ad_credit_wallets
    SET balance_cents = balance_cents - v_delta,
        held_cents = held_cents + v_delta,
        updated_at = now()
    WHERE brand_id = v_hold.brand_id;
    INSERT INTO public.ad_credit_ledger (
      brand_id, entry_kind, amount_cents, fee_cents, balance_after_cents,
      currency, actor_id, idempotency_key, metadata
    ) VALUES (
      v_hold.brand_id, 'unspend_return', -v_delta, 0,
      v_wallet.balance_cents - v_delta, v_hold.currency, p_actor_id,
      'host_live_' || v_key, jsonb_build_object(
        'reason', 'live_budget_lower', 'plan_id', v_plan.id,
        'plan_version_id', v_version.id, 'plan_hash', v_version.plan_hash,
        'hold_id', v_hold.id)
    ) RETURNING * INTO v_ledger;
  END IF;
  IF v_delta <> 0 THEN
    UPDATE public.ad_plan_funding_holds SET amount_cents = v_new_budget
    WHERE id = v_hold.id;
  END IF;

  -- The new caps and daily amounts, per campaign, as governed amendments.
  IF jsonb_array_length(p_changes) > 0 THEN
    IF (SELECT count(*) FROM public.ad_campaigns c
        WHERE c.plan_version_id = v_version.id AND c.plan_hash = v_version.plan_hash)
       <> jsonb_array_length(p_changes)
       OR (SELECT count(DISTINCT e->>'campaign_id') FROM jsonb_array_elements(p_changes) e)
       <> jsonb_array_length(p_changes) THEN
      RAISE EXCEPTION 'ad_budget_changes_must_cover_every_campaign' USING ERRCODE = '22023';
    END IF;
    FOR v_change IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
      SELECT * INTO v_campaign FROM public.ad_campaigns
      WHERE id = (v_change->>'campaign_id')::uuid FOR UPDATE;
      IF NOT FOUND OR v_campaign.plan_version_id IS DISTINCT FROM v_version.id
         OR v_campaign.plan_hash IS DISTINCT FROM v_version.plan_hash THEN
        RAISE EXCEPTION 'ad_budget_campaign_plan_mismatch' USING ERRCODE = '22023';
      END IF;
      v_new_cap := (v_change->>'new_provider_budget_cents')::bigint;
      v_new_daily := (v_change->>'new_provider_delivery_budget_cents')::bigint;
      IF v_new_cap IS NULL OR v_new_cap <= 0 OR v_new_daily IS NULL
         OR v_new_daily <= 0 OR v_new_daily > v_new_cap THEN
        RAISE EXCEPTION 'ad_budget_amount_invalid' USING ERRCODE = '22023';
      END IF;
      SELECT coalesce(sum(s.spend_cents), 0) INTO v_spend_provider
      FROM public.ad_spend_daily s WHERE s.campaign_id = v_campaign.id;
      IF v_new_cap < v_spend_provider THEN
        RAISE EXCEPTION 'ad_budget_cap_below_spend:%:%', v_new_cap, v_spend_provider
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
        v_prev_cap, v_new_cap, v_prev_daily, v_new_daily, v_spend_provider,
        v_hold.amount_cents, v_new_budget, 'Host changed the live budget',
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
        jsonb_build_object('plan_version_id', v_version.id, 'plan_hash', v_version.plan_hash),
        jsonb_build_object('host_live_edit', true, 'new_cap', v_new_cap,
          'new_daily', v_new_daily, 'new_host_budget_cents', v_new_budget)
      );
    END LOOP;
  END IF;

  -- Mingla's spend sync stops every app at this end (and pushes where it can).
  IF p_new_ends_at IS NOT NULL THEN
    UPDATE public.ad_campaigns SET ends_at = p_new_ends_at
    WHERE plan_version_id = v_version.id AND plan_hash = v_version.plan_hash;
  END IF;

  INSERT INTO public.host_ad_live_edits (
    plan_id, plan_version_id, plan_hash, idempotency_key,
    previous_host_budget_cents, new_host_budget_cents, previous_ends_at,
    new_ends_at, hold_delta_cents, host_spend_cents, ledger_id, actor_id
  ) VALUES (
    v_plan.id, v_version.id, v_version.plan_hash, v_key,
    v_hold.amount_cents, v_new_budget, v_previous_ends,
    coalesce(p_new_ends_at, v_previous_ends), v_delta, v_spend_host,
    v_ledger.id, p_actor_id
  ) RETURNING * INTO v_edit;
  RETURN v_edit;
END;
$function$;

REVOKE ALL ON FUNCTION public.host_ad_amend_live(uuid, text, bigint, timestamptz, jsonb, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.host_ad_amend_live(uuid, text, bigint, timestamptz, jsonb, uuid, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.host_ad_amend_live(uuid, text, bigint, timestamptz, jsonb, uuid, text, jsonb) IS
  'Issue #4238: a Host changes a live ad''s total budget and/or end date, once a day (PT409 otherwise). The end is capped at the last bookable moment (PT409). A raise takes the extra from Ads credit now; a lower gives it back; both with ledger rows, in one transaction. Idempotent on the key.';

-- ── 4. Settlement reads the amended cap ──────────────────────────────────────
-- Body copied verbatim from 20271101003697 (its latest definition) with one
-- change: the overspend check uses the amended provider cap when one exists.
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
  -- #4238 I-4238-SETTLE-AMENDED-CAP: a governed budget change (Admin or a
  -- Host live edit) raised or lowered the cap; settle against that cap.
  IF v_settlement.final_provider_spend_cents > coalesce(
       (SELECT c.amended_provider_budget_cents FROM public.ad_campaigns c
        WHERE c.id = v_settlement.campaign_id),
       v_provider_allocation.provider_budget_cents) THEN
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

COMMIT;
