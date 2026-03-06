-- Migration: Phase 3 — Scoring and AI Copy fields on card_pool

-- 1. Add scoring fields to card_pool
ALTER TABLE public.card_pool
  ADD COLUMN IF NOT EXISTS match_score REAL,
  ADD COLUMN IF NOT EXISTS one_liner TEXT,
  ADD COLUMN IF NOT EXISTS tip TEXT,
  ADD COLUMN IF NOT EXISTS scoring_factors JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS copy_generated_at TIMESTAMPTZ;

-- 2. Index for enrichment backfill (cards needing copy)
CREATE INDEX IF NOT EXISTS idx_card_pool_needs_copy
  ON public.card_pool(created_at DESC)
  WHERE one_liner IS NULL AND description IS NOT NULL;

-- 3. Index for enrichment backfill (cards needing description)
CREATE INDEX IF NOT EXISTS idx_card_pool_needs_description
  ON public.card_pool(created_at DESC)
  WHERE description IS NULL;
