-- ============================================================================
-- ORCH-0906 amendment to ORCH-0909:
-- Collab positional deck supports mixed single + curated card rows.
-- ============================================================================
--
-- The ORCH-0909 migration at 20260701000000 is already live on the linked
-- Supabase remote. This amendment is intentionally a new monotonic migration.
-- Operator owns `supabase db push --linked`; do not apply via MCP.
-- ============================================================================

ALTER TABLE public.session_deck_cards
  ALTER COLUMN card_id DROP NOT NULL;

ALTER TABLE public.session_deck_cards
  ADD COLUMN IF NOT EXISTS card_type text NOT NULL DEFAULT 'single'
    CHECK (card_type IN ('single', 'curated'));

ALTER TABLE public.session_deck_cards
  ADD COLUMN IF NOT EXISTS curated_payload jsonb NULL;

ALTER TABLE public.session_deck_cards
  DROP CONSTRAINT IF EXISTS sdc_exactly_one_payload;
ALTER TABLE public.session_deck_cards
  ADD CONSTRAINT sdc_exactly_one_payload CHECK (
    (card_type = 'single' AND card_id IS NOT NULL AND curated_payload IS NULL)
    OR
    (card_type = 'curated' AND card_id IS NULL AND curated_payload IS NOT NULL)
  );

ALTER TABLE public.session_deck_cards
  ADD COLUMN IF NOT EXISTS pill_label text NULL;

ALTER TABLE public.session_deck_cards
  ADD COLUMN IF NOT EXISTS degraded_from text NULL;

COMMENT ON COLUMN public.session_deck_cards.card_type IS
  'ORCH-0906: one of {single, curated}. Single rows hydrate from place_pool via card_id. Curated rows store the full hydrated curated card jsonb because curated experiences are not persisted entities.';

COMMENT ON COLUMN public.session_deck_cards.curated_payload IS
  'ORCH-0906: the full curated card object returned by generate-curated-experiences. Schema matches CuratedExperienceCard wire shape. Read-only after insert.';

COMMENT ON COLUMN public.session_deck_cards.pill_label IS
  'ORCH-0906: the pill that drove this position. For single rows = category chip. For curated rows = intent pill. Used for analytics and rotation debugging; not load-bearing.';

COMMENT ON COLUMN public.session_deck_cards.degraded_from IS
  'ORCH-0906 D7 graceful-degrade marker. NULL on normal rows. When one type exhausts and the surviving type fills the position, this stores the exhausted pill slug.';

CREATE TABLE IF NOT EXISTS public.session_curated_cache (
  session_id uuid NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  experience_type text NOT NULL CHECK (experience_type IN (
    'adventurous', 'first-date', 'romantic', 'group-fun', 'picnic-dates', 'take-a-stroll'
  )),
  batch_index int NOT NULL DEFAULT 0 CHECK (batch_index >= 0),
  cards jsonb NOT NULL,
  served_card_ids text[] NOT NULL DEFAULT '{}',
  generated_at_version int NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, experience_type, batch_index)
);

ALTER TABLE public.session_curated_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scc_service_only ON public.session_curated_cache;
CREATE POLICY scc_service_only ON public.session_curated_cache
  FOR ALL
  USING (auth.role() = 'service_role' OR current_user = 'postgres')
  WITH CHECK (auth.role() = 'service_role' OR current_user = 'postgres');

CREATE INDEX IF NOT EXISTS idx_scc_session_intent
  ON public.session_curated_cache (session_id, experience_type, batch_index DESC);

COMMENT ON TABLE public.session_curated_cache IS
  'ORCH-0906: per-session per-intent batch cache. Batches are generated once and drawn from across multiple intent positions. Lifecycle follows collaboration_sessions via ON DELETE CASCADE.';

NOTIFY pgrst, 'reload schema';
