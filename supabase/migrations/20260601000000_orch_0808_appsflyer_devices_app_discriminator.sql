-- ORCH-0808 — AppsFlyer integration for Mingla Business.
--
-- 1. Adds `app` discriminator to `appsflyer_devices` so consumer + business
--    installs for the same Supabase user_id coexist without colliding on the
--    unique constraint.
-- 2. Adds `brand_appsflyer_milestones` for idempotent S2S "first ticket sold"
--    and "first payout received" event firing from the Stripe webhook router.
--
-- See: Mingla_Artifacts/specs/SPEC_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md §3.1 + §3.2

BEGIN;

-- ============================================================================
-- Part 1 — appsflyer_devices.app discriminator
-- ============================================================================

ALTER TABLE public.appsflyer_devices
  ADD COLUMN IF NOT EXISTS app text NOT NULL DEFAULT 'consumer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appsflyer_devices_app_check'
  ) THEN
    ALTER TABLE public.appsflyer_devices
      ADD CONSTRAINT appsflyer_devices_app_check
      CHECK (app IN ('consumer', 'business'));
  END IF;
END $$;

ALTER TABLE public.appsflyer_devices
  DROP CONSTRAINT IF EXISTS appsflyer_devices_user_id_appsflyer_uid_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appsflyer_devices_user_id_app_appsflyer_uid_key'
  ) THEN
    ALTER TABLE public.appsflyer_devices
      ADD CONSTRAINT appsflyer_devices_user_id_app_appsflyer_uid_key
      UNIQUE (user_id, app, appsflyer_uid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_appsflyer_devices_user_id_app
  ON public.appsflyer_devices (user_id, app);

-- RLS policies stay as-is — they already filter on auth.uid() = user_id.

-- ============================================================================
-- Part 2 — brand_appsflyer_milestones
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.brand_appsflyer_milestones (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  first_ticket_sold_at timestamptz,
  first_payout_at timestamptz,
  first_activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.brand_appsflyer_milestones ENABLE ROW LEVEL SECURITY;

-- service_role only — no client-side access. Webhook router runs as service_role.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_appsflyer_milestones'
      AND policyname = 'brand_appsflyer_milestones_service_role_all'
  ) THEN
    CREATE POLICY brand_appsflyer_milestones_service_role_all
      ON public.brand_appsflyer_milestones
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON TABLE public.brand_appsflyer_milestones TO service_role;

-- ============================================================================
-- Part 3 — self-verify probe (Const #3 — surface drift, never silent)
-- ============================================================================

DO $$
DECLARE
  bad_app_count integer;
BEGIN
  SELECT count(*) INTO bad_app_count
  FROM public.appsflyer_devices
  WHERE app NOT IN ('consumer', 'business');
  IF bad_app_count > 0 THEN
    RAISE EXCEPTION
      'ORCH-0808 migration verify: % appsflyer_devices rows have invalid app value',
      bad_app_count;
  END IF;
END $$;

COMMIT;
