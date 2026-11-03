-- Issue #3355: the Ari flow engine switch is a feature flag, not a Supabase
-- secret. The secret budget is at its 90-name ceiling, so ARI_FLOW_ENGINE as
-- a production secret turned main red. Seeded off; switching it on is a
-- Work-card step (UPDATE ... SET is_enabled = true). Additive and idempotent.
BEGIN;

INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES('ari_flow_engine',false,'Ari step-by-step flow engine (#3355); edge functions read it, cached 15 s')
ON CONFLICT(flag_key) DO NOTHING;

COMMIT;
