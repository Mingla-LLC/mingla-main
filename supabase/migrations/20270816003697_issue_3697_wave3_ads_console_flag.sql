-- toward #3697 Wave 3 — Admin Ads console feature flag (admin_config).
-- Default ON so existing Growth access is unchanged; ops can flip off via
-- admin_get_feature_flags / Settings admin_config if needed.
-- Apply via Management API with this file's ledger row (do not hand-apply).

INSERT INTO public.admin_config(key, value)
VALUES ('enable_ads_console', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
