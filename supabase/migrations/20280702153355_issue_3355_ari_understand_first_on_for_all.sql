-- Issue #3355 final fix (C-4): "Ari understands first" is ON for every brand
-- at launch (Seth, 2026-11-12).
--
-- The switch is the existing Ari rollout tables (service role only, from
-- 20280209003355): runtime version 'ari-understand-first-3355' in
-- public.ari_runtime_versions and one rollout row for it in
-- public.ari_rollouts. supabase/functions/_shared/ariRollout.ts reads rows
-- with status pilot / expanding / active / completed; a row with
-- audience.all = true (or active at 100 %) covers every brand.
--
-- Idempotent: the version upserts on its unique version_key, and the launch
-- rollout on a new unique key (runtime_version_id, rollout_key). Both use
-- ON CONFLICT DO NOTHING, so applying this file again never adds a second
-- row and never switches a paused rollout back on.
--
-- Kill switch (no deploy; takes effect within ~15 s, the switch's cache):
--   UPDATE public.ari_rollouts r SET status = 'paused', updated_at = now()
--   FROM public.ari_runtime_versions v
--   WHERE r.runtime_version_id = v.id
--     AND v.version_key = 'ari-understand-first-3355'
--     AND r.status IN ('pilot', 'expanding', 'active', 'completed');
--
-- Forward-only. Static SQL (no dynamic EXECUTE).

ALTER TABLE public.ari_rollouts
  ADD COLUMN IF NOT EXISTS rollout_key text
    CHECK (rollout_key IS NULL OR rollout_key ~ '^[a-z0-9][a-z0-9_-]{0,62}$');

COMMENT ON COLUMN public.ari_rollouts.rollout_key IS
  'Issue #3355: a stable name for a rollout seeded by a migration (unique per runtime version), so the seed is idempotent. NULL for rollouts made in the Improvement Lab.';

CREATE UNIQUE INDEX IF NOT EXISTS ari_rollouts_runtime_rollout_key
  ON public.ari_rollouts (runtime_version_id, rollout_key);

INSERT INTO public.ari_runtime_versions (
  version_key, kind, status, config, config_digest, activated_at
) VALUES (
  'ari-understand-first-3355',
  'combined',
  'active',
  '{"issue":3355,"switch":"understand-first"}'::jsonb,
  encode(sha256(convert_to('{"issue":3355,"switch":"understand-first"}', 'UTF8')), 'hex'),
  now()
)
ON CONFLICT (version_key) DO NOTHING;

INSERT INTO public.ari_rollouts (
  runtime_version_id, rollout_key, status, audience, rollout_percent,
  rollback_version_id, started_at
)
SELECT
  v.id,
  'launch-on-for-all',
  'active',
  '{"all": true}'::jsonb,
  100,
  (SELECT b.id FROM public.ari_runtime_versions b
    WHERE b.version_key = 'ari-legacy-baseline'),
  now()
FROM public.ari_runtime_versions v
WHERE v.version_key = 'ari-understand-first-3355'
ON CONFLICT (runtime_version_id, rollout_key) DO NOTHING;
