-- ORCH-0634 — curated_teaser_cache table
--
-- Curated cards are no longer persisted (I-NO-CURATED-PERSISTENCE, DEC-052).
-- Each curated request assembles fresh from place_pool + place_scores. To keep
-- OpenAI cost flat per-unique-stop-combination, we cache ONLY the GPT-generated
-- teaser keyed by (experience_type, sorted stop place_pool_ids).
--
-- LOCKED KEY FORMULA (ORCH-0634/0640 contract):
--   cache_key = sha256(experience_type + ':' + sorted_stop_place_pool_ids.join(','))
--   - UTF-8 lowercase experience_type (e.g. 'romantic', 'first-date')
--   - Single ASCII ':' delimiter
--   - Stop place_pool_ids sorted ASCENDING by canonical UUID string form
--   - Joined by single ASCII ',' with no whitespace
--   - sha256 digest, lowercase hex (64 chars)
--
-- ORCH-0640 will reuse this exact formula as engagement_metrics.container_key.
-- DO NOT change the formula post-cutover — backfill required if changed.
--
-- Idempotent. Run via `supabase db push`.

CREATE TABLE IF NOT EXISTS public.curated_teaser_cache (
  cache_key TEXT PRIMARY KEY,
  experience_type TEXT NOT NULL,
  stop_place_pool_ids UUID[] NOT NULL,
  one_liner TEXT NOT NULL,
  tip TEXT,
  shopping_list TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_served_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  serve_count INT NOT NULL DEFAULT 0,

  CONSTRAINT curated_teaser_cache_key_len CHECK (length(cache_key) = 64),
  CONSTRAINT curated_teaser_cache_stops_nonempty CHECK (array_length(stop_place_pool_ids, 1) > 0)
);

CREATE INDEX IF NOT EXISTS idx_curated_teaser_last_served
  ON public.curated_teaser_cache (last_served_at);

CREATE INDEX IF NOT EXISTS idx_curated_teaser_experience_type
  ON public.curated_teaser_cache (experience_type);

ALTER TABLE public.curated_teaser_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_curated_teaser_cache ON public.curated_teaser_cache;
CREATE POLICY service_role_all_curated_teaser_cache
  ON public.curated_teaser_cache
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.curated_teaser_cache IS
  'ORCH-0634: GPT teaser cache for curated cards. Keyed by sha256(experience_type + '':'' + sorted_stop_place_pool_ids.join('','')). Stop combo fingerprint — same combination returns cached teaser without re-calling GPT. Reused by ORCH-0640 engagement_metrics.container_key.';

COMMENT ON COLUMN public.curated_teaser_cache.cache_key IS
  'sha256 hex digest of: lower(experience_type) + '':'' + sorted(stop_place_pool_ids).join(''''). IMMUTABLE formula post-cutover (ORCH-0640 contract).';
