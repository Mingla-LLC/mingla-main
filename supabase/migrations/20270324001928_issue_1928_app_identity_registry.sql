-- Issue #1928 — canonical Explorer/Business advertising identity registry.
-- Public identity metadata is separate from the shared payer connection.

CREATE TABLE IF NOT EXISTS public.ad_advertising_apps (
  app_key text PRIMARY KEY CHECK (app_key IN ('explorer', 'business')),
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_app_provider_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_key text NOT NULL REFERENCES public.ad_advertising_apps(app_key) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('meta', 'tiktok')),
  payer_lane text NOT NULL DEFAULT 'consumer' CHECK (payer_lane IN ('consumer', 'business')),
  expected_username text NOT NULL CHECK (
    expected_username = lower(expected_username)
    AND expected_username = btrim(expected_username)
    AND expected_username <> ''
    AND expected_username NOT LIKE '@%'
  ),
  meta_page_id text NULL,
  meta_instagram_user_id text NULL,
  tiktok_identity_id text NULL,
  tiktok_identity_type text NULL CHECK (
    tiktok_identity_type IS NULL OR tiktok_identity_type IN ('TT_USER', 'BC_AUTH_TT')
  ),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_key, provider),
  CONSTRAINT ad_app_provider_identity_shape CHECK (
    (
      provider = 'meta'
      AND meta_page_id IS NOT NULL
      AND meta_instagram_user_id IS NOT NULL
      AND tiktok_identity_id IS NULL
      AND tiktok_identity_type IS NULL
    ) OR (
      provider = 'tiktok'
      AND meta_page_id IS NULL
      AND meta_instagram_user_id IS NULL
      AND tiktok_identity_id IS NOT NULL
      AND tiktok_identity_type IS NOT NULL
    )
  )
);

DROP TRIGGER IF EXISTS trg_ad_advertising_apps_updated_at ON public.ad_advertising_apps;
CREATE TRIGGER trg_ad_advertising_apps_updated_at
  BEFORE UPDATE ON public.ad_advertising_apps
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

DROP TRIGGER IF EXISTS trg_ad_app_provider_identities_updated_at ON public.ad_app_provider_identities;
CREATE TRIGGER trg_ad_app_provider_identities_updated_at
  BEFORE UPDATE ON public.ad_app_provider_identities
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

INSERT INTO public.ad_advertising_apps (app_key, display_name, active)
VALUES
  ('explorer', 'Mingla Explorer', true),
  ('business', 'Mingla Business', true)
ON CONFLICT (app_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  active = EXCLUDED.active,
  updated_at = now();

INSERT INTO public.ad_app_provider_identities (
  app_key, provider, payer_lane, expected_username,
  meta_page_id, meta_instagram_user_id,
  tiktok_identity_id, tiktok_identity_type, active
)
VALUES
  ('explorer', 'meta', 'consumer', 'usemingla', '797406353459597', '17841477287060530', NULL, NULL, true),
  ('business', 'meta', 'consumer', 'minglahost', '1223994124127087', '17841422359567322', NULL, NULL, true),
  ('explorer', 'tiktok', 'consumer', 'usemingla', NULL, NULL, 'b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5', 'TT_USER', true),
  ('business', 'tiktok', 'consumer', 'minglahost', NULL, NULL, '5ee9bdcb-7520-554d-8452-b32e2f9f43ea', 'BC_AUTH_TT', true)
ON CONFLICT (app_key, provider) DO UPDATE SET
  payer_lane = EXCLUDED.payer_lane,
  expected_username = EXCLUDED.expected_username,
  meta_page_id = EXCLUDED.meta_page_id,
  meta_instagram_user_id = EXCLUDED.meta_instagram_user_id,
  tiktok_identity_id = EXCLUDED.tiktok_identity_id,
  tiktok_identity_type = EXCLUDED.tiktok_identity_type,
  active = EXCLUDED.active,
  updated_at = now();

ALTER TABLE public.ad_advertising_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_app_provider_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_advertising_apps admin can read" ON public.ad_advertising_apps;
CREATE POLICY "ad_advertising_apps admin can read"
  ON public.ad_advertising_apps FOR SELECT TO authenticated
  USING (public.is_admin_user());

DROP POLICY IF EXISTS "ad_app_provider_identities admin can read" ON public.ad_app_provider_identities;
CREATE POLICY "ad_app_provider_identities admin can read"
  ON public.ad_app_provider_identities FOR SELECT TO authenticated
  USING (public.is_admin_user());

REVOKE ALL ON public.ad_advertising_apps FROM anon, authenticated;
REVOKE ALL ON public.ad_app_provider_identities FROM anon, authenticated;
GRANT SELECT ON public.ad_advertising_apps TO authenticated;
GRANT SELECT ON public.ad_app_provider_identities TO authenticated;
GRANT ALL ON public.ad_advertising_apps TO service_role;
GRANT ALL ON public.ad_app_provider_identities TO service_role;
