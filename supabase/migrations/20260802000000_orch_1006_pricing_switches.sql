-- ORCH-1006 [Universal all-in pricing engine] — pricing switches + take-rate config
-- ===================================================================
-- Implements BOTH the main SPEC (3 pass/absorb switches, venue tax basis,
-- lock-after-sale, pricing_breakdown) AND the take-rate amendment (configurable
-- Mingla platform fee: global default + per-brand override) as ONE coherent set,
-- because they share the `brands` table and the `pricing_breakdown` shape.
--
-- Collision-checked 2026-05-29: highest migration prefix across all active
-- worktrees + origin/main = 20260801000002; this uses 20260802000000 (strictly
-- greater). Companion view migration = 20260802000001.
--
-- Locked decisions honored:
--   #1 jurisdiction unresolvable -> flat brand-absorbed (engine, not schema)
--   #2 unregistered brand -> hide pass-tax (engine + UI; switch defaults false)
--   #4 existing events default to ALL-ABSORB (columns default false / NULL=inherit-false)
--   #5 switches lock after first sale (events.pricing_locked_at + RPC guard)
--   #6 absorb shows "you covered £X" (pricing_breakdown.absorbed jsonb)
--   #7 UK-first region-aware (brands.pricing_region CHECK ('GB'))
-- Take-rate amendment:
--   DEFAULT take-rate = 150 bps (1.50%) = today's current hardcoded rate
--   (operator-locked 2026-05-29). ZERO economic change at migration; operator
--   raises it later in the admin /pricing UI.
--
-- IMPLEMENT NOTE: the large installment-aware `biz_ticket_checkout_create_session`
-- RPC is NOT re-declared here (it returns a complex camelCase jsonb shape +
-- installment schedule). Instead a standalone resolver RPC
-- `resolve_event_pricing_inputs(p_event_id)` returns the ORCH-1006 inputs the
-- edge engine needs; the edge function calls it after the existing session RPC
-- (one extra single-row read — negligible on the hot path, zero clobber risk).
BEGIN;

-- ───────────────────────────────────────────────────────────────────
-- A.1 — Brand-level pass/absorb defaults + region/currency
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS default_pass_tax         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_pass_mingla_fee  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_pass_service_fee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pricing_region           text    NOT NULL DEFAULT 'GB',
  ADD COLUMN IF NOT EXISTS pricing_currency         text    NOT NULL DEFAULT 'GBP';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_pricing_region_allowlist') THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_pricing_region_allowlist CHECK (pricing_region IN ('GB'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_pricing_currency_allowlist') THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_pricing_currency_allowlist CHECK (pricing_currency IN ('GBP'));
  END IF;
END$$;

-- ───────────────────────────────────────────────────────────────────
-- Take-rate amendment A.3 — per-brand override (NULL = inherit global default)
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS take_rate_bps_override        integer,
  ADD COLUMN IF NOT EXISTS take_rate_override_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS take_rate_override_updated_by uuid REFERENCES auth.users(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_take_rate_override_bounds') THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_take_rate_override_bounds
      CHECK (take_rate_bps_override IS NULL OR take_rate_bps_override BETWEEN 0 AND 3000);
  END IF;
END$$;

-- A.7 NOTE — `brands.account_id` is the owning user's auth uid directly (proven
-- idiom `b.account_id = auth.uid()`). The trigger below guards the take-rate
-- override column from any non-admin, non-backend writer.
-- A.7 — the brand OWNER must NOT set their own negotiated take-rate (Seth sets it
-- via the admin RPC). brands UPDATE policies are column-blind, so guard the column
-- with a trigger: any UPDATE changing take_rate_bps_override is rejected unless the
-- admin RPC authorized it (session GUC) or the caller is the full-trust backend.
CREATE OR REPLACE FUNCTION public.guard_brand_take_rate_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.take_rate_bps_override IS DISTINCT FROM OLD.take_rate_bps_override THEN
    IF current_setting('app.admin_take_rate_write', true) <> 'on'
       AND current_user <> 'service_role' THEN
      RAISE EXCEPTION 'take_rate_override_not_self_serviceable'
        USING HINT = 'The Mingla take-rate is set by Mingla, not the brand.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_brand_take_rate_override ON public.brands;
CREATE TRIGGER trg_guard_brand_take_rate_override
  BEFORE UPDATE ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_brand_take_rate_override();

-- ───────────────────────────────────────────────────────────────────
-- A.2 — Per-offering override on events (NULL = inherit brand default)
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS pass_tax          boolean,
  ADD COLUMN IF NOT EXISTS pass_mingla_fee   boolean,
  ADD COLUMN IF NOT EXISTS pass_service_fee  boolean,
  ADD COLUMN IF NOT EXISTS pricing_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS venue_tax_address jsonb;

-- ───────────────────────────────────────────────────────────────────
-- A.3 — canonical pricing_breakdown on session + order (single money record)
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS pricing_breakdown jsonb;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pricing_breakdown jsonb;

-- ───────────────────────────────────────────────────────────────────
-- Take-rate amendment A.2 — platform_pricing_config singleton.
-- (No existing platform/app config table fit the singleton role — admin_config
-- is a key/value table; a typed singleton with a guardrail CHECK is cleaner here.)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_pricing_config (
  id                    boolean PRIMARY KEY DEFAULT true,
  default_take_rate_bps integer NOT NULL DEFAULT 150,   -- 1.50% = today's rate, operator-locked, zero economic change
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES auth.users(id),
  CONSTRAINT platform_pricing_config_singleton CHECK (id = true),
  CONSTRAINT platform_pricing_config_default_take_rate_bounds
    CHECK (default_take_rate_bps BETWEEN 0 AND 3000)
);

INSERT INTO public.platform_pricing_config (id, default_take_rate_bps)
  VALUES (true, 150)
  ON CONFLICT (id) DO NOTHING;

-- A.7 RLS — platform-internal: service_role only. No anon/consumer/business read.
ALTER TABLE public.platform_pricing_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_pricing_config_service_role_all ON public.platform_pricing_config;
CREATE POLICY platform_pricing_config_service_role_all
  ON public.platform_pricing_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────────
-- B.1 — effective take-rate resolution helper (COALESCE override, default)
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_effective_take_rate_bps(p_brand_id uuid)
RETURNS TABLE (effective_take_rate_bps integer, take_rate_source text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(b.take_rate_bps_override, c.default_take_rate_bps) AS effective_take_rate_bps,
    CASE WHEN b.take_rate_bps_override IS NOT NULL THEN 'brand_override'
         ELSE 'platform_default' END                            AS take_rate_source
  FROM public.platform_pricing_config c
  CROSS JOIN public.brands b
  WHERE b.id = p_brand_id
    AND c.id = true;
$$;

-- ───────────────────────────────────────────────────────────────────
-- C.3 / B.2 — standalone resolver the edge engine calls (NO clobber of the big
-- session RPC). Returns the resolved switches + venue address + region/currency +
-- effective take-rate + lock state for an event. One single-row read.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_event_pricing_inputs(p_event_id uuid)
RETURNS TABLE (
  pass_tax boolean,
  pass_mingla_fee boolean,
  pass_service_fee boolean,
  pricing_region text,
  pricing_currency text,
  venue_tax_address jsonb,
  pricing_locked boolean,
  effective_take_rate_bps integer,
  take_rate_source text,
  stripe_account_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(e.pass_tax,         b.default_pass_tax)         AS pass_tax,
    COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
    COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region                                         AS pricing_region,
    b.pricing_currency                                       AS pricing_currency,
    e.venue_tax_address                                      AS venue_tax_address,
    (e.pricing_locked_at IS NOT NULL)                        AS pricing_locked,
    r.effective_take_rate_bps                                AS effective_take_rate_bps,
    r.take_rate_source                                       AS take_rate_source,
    b.stripe_connect_id                                      AS stripe_account_id
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  CROSS JOIN LATERAL public.resolve_effective_take_rate_bps(b.id) r
  WHERE e.id = p_event_id;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_event_pricing_inputs(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_effective_take_rate_bps(uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────────
-- A.5 — stamp pricing_locked_at on first sale (mirrors ORCH-0877 "event has >=1
-- order" buyer-protection predicate). Trigger on orders insert: FIRST order locks.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_event_pricing_lock_on_first_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    UPDATE public.events
       SET pricing_locked_at = now()
     WHERE id = NEW.event_id
       AND pricing_locked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_event_pricing_lock ON public.orders;
CREATE TRIGGER trg_stamp_event_pricing_lock
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_event_pricing_lock_on_first_order();

-- ───────────────────────────────────────────────────────────────────
-- E.6 — owner-gated switch-mutation RPC. Rejects when locked (defense in depth)
-- and re-checks brand ownership (owner-direct predicate, [[rls-returning-owner-gap]]).
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.business_set_pricing_switches(
  p_event_id uuid,
  p_pass_tax boolean,
  p_pass_mingla_fee boolean,
  p_pass_service_fee boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand_id   uuid;
  v_is_owner   boolean;
  v_locked_at  timestamptz;
BEGIN
  SELECT e.brand_id, e.pricing_locked_at
    INTO v_brand_id, v_locked_at
    FROM public.events e
   WHERE e.id = p_event_id;

  IF v_brand_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- Owner-direct predicate: brands.account_id IS the owning user's id
  -- (proven idiom: `b.account_id = auth.uid()` — meta_orch_0972 authoring RPC).
  SELECT EXISTS (
    SELECT 1 FROM public.brands b
     WHERE b.id = v_brand_id AND b.account_id = auth.uid()
  ) INTO v_is_owner;

  IF NOT COALESCE(v_is_owner, false) THEN
    RAISE EXCEPTION 'not_brand_owner';
  END IF;

  IF v_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'pricing_switches_locked'
      USING HINT = 'Pricing locks once your first ticket sells.';
  END IF;

  UPDATE public.events
     SET pass_tax         = p_pass_tax,
         pass_mingla_fee  = p_pass_mingla_fee,
         pass_service_fee = p_pass_service_fee,
         updated_at       = now()
   WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.business_set_pricing_switches(uuid, boolean, boolean, boolean)
  TO authenticated, service_role;

-- E.2 — brand-level defaults writer (owner-gated; never locks).
CREATE OR REPLACE FUNCTION public.business_set_brand_pricing_defaults(
  p_brand_id uuid,
  p_default_pass_tax boolean,
  p_default_pass_mingla_fee boolean,
  p_default_pass_service_fee boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner boolean;
BEGIN
  -- Owner-direct predicate: brands.account_id IS the owning user's id.
  SELECT EXISTS (
    SELECT 1 FROM public.brands b
     WHERE b.id = p_brand_id AND b.account_id = auth.uid()
  ) INTO v_is_owner;

  IF NOT COALESCE(v_is_owner, false) THEN
    RAISE EXCEPTION 'not_brand_owner';
  END IF;

  UPDATE public.brands
     SET default_pass_tax         = p_default_pass_tax,
         default_pass_mingla_fee  = p_default_pass_mingla_fee,
         default_pass_service_fee = p_default_pass_service_fee,
         updated_at               = now()
   WHERE id = p_brand_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.business_set_brand_pricing_defaults(uuid, boolean, boolean, boolean)
  TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────
-- D — admin take-rate writers (admin-gated via is_admin_user(); audited).
-- These set the GUC the brands trigger checks so the override write is allowed.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_platform_take_rate(p_bps integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_bps IS NULL OR p_bps < 0 OR p_bps > 3000 THEN
    RAISE EXCEPTION 'take_rate_out_of_bounds';
  END IF;

  UPDATE public.platform_pricing_config
     SET default_take_rate_bps = p_bps,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE id = true;

  RETURN p_bps;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_platform_take_rate(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_brand_take_rate_override(p_brand_id uuid, p_bps integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_bps IS NULL OR p_bps < 0 OR p_bps > 3000 THEN
    RAISE EXCEPTION 'take_rate_out_of_bounds';
  END IF;

  PERFORM set_config('app.admin_take_rate_write', 'on', true);

  UPDATE public.brands
     SET take_rate_bps_override       = p_bps,
         take_rate_override_updated_at = now(),
         take_rate_override_updated_by = auth.uid(),
         updated_at                    = now()
   WHERE id = p_brand_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  RETURN p_bps;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_brand_take_rate_override(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_clear_brand_take_rate_override(p_brand_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  PERFORM set_config('app.admin_take_rate_write', 'on', true);

  UPDATE public.brands
     SET take_rate_bps_override       = NULL,
         take_rate_override_updated_at = now(),
         take_rate_override_updated_by = auth.uid(),
         updated_at                    = now()
   WHERE id = p_brand_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_clear_brand_take_rate_override(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_pricing_config()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default integer;
  v_default_updated_at timestamptz;
  v_default_updated_by uuid;
  v_overrides jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT default_take_rate_bps, updated_at, updated_by
    INTO v_default, v_default_updated_at, v_default_updated_by
    FROM public.platform_pricing_config WHERE id = true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'brand_id', b.id,
           'brand_name', b.name,
           'slug', b.slug,
           'take_rate_bps_override', b.take_rate_bps_override,
           'updated_at', b.take_rate_override_updated_at,
           'updated_by', b.take_rate_override_updated_by
         ) ORDER BY b.name), '[]'::jsonb)
    INTO v_overrides
    FROM public.brands b
   WHERE b.take_rate_bps_override IS NOT NULL;

  RETURN jsonb_build_object(
    'default_take_rate_bps', v_default,
    'default_updated_at', v_default_updated_at,
    'default_updated_by', v_default_updated_by,
    'overrides', v_overrides
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_pricing_config() TO authenticated, service_role;

COMMIT;
