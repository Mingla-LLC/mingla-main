-- Voice Reviews Migration
-- Date: 2026-03-03
-- Creates: place_reviews table, voice-reviews storage bucket
-- Modifies: calendar_entries (adds feedback tracking columns)

-- ============================================================
-- 1. PLACE REVIEWS — Full review data for current analytics
--    and future social features
-- ============================================================

CREATE TABLE IF NOT EXISTS public.place_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calendar_entry_id UUID REFERENCES public.calendar_entries(id) ON DELETE SET NULL,

  -- Place identification
  place_pool_id UUID REFERENCES public.place_pool(id) ON DELETE SET NULL,
  google_place_id TEXT,
  card_id TEXT,

  -- Display data
  place_name TEXT NOT NULL,
  place_address TEXT,
  place_category TEXT,

  -- Review core
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  did_attend BOOLEAN NOT NULL DEFAULT true,

  -- Voice data (stored for future social features)
  audio_urls TEXT[] NOT NULL DEFAULT '{}',
  audio_durations_seconds INTEGER[] NOT NULL DEFAULT '{}',
  transcription TEXT,

  -- AI-processed sentiment and themes
  sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'mixed', 'neutral')),
  themes TEXT[] NOT NULL DEFAULT '{}',
  ai_summary TEXT,

  -- Optional text fallback (legacy compat + offline fallback)
  feedback_text TEXT,

  -- Processing lifecycle
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  processing_error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_place_reviews_user
  ON public.place_reviews (user_id, created_at DESC);

CREATE INDEX idx_place_reviews_place_pool
  ON public.place_reviews (place_pool_id)
  WHERE place_pool_id IS NOT NULL;

CREATE INDEX idx_place_reviews_google_place
  ON public.place_reviews (google_place_id)
  WHERE google_place_id IS NOT NULL;

CREATE INDEX idx_place_reviews_processing
  ON public.place_reviews (processing_status)
  WHERE processing_status IN ('pending', 'processing');

-- RLS
ALTER TABLE public.place_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_reviews"
  ON public.place_reviews FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_reviews"
  ON public.place_reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_update_own_reviews"
  ON public.place_reviews FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "service_role_all_reviews"
  ON public.place_reviews FOR ALL
  USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE TRIGGER update_place_reviews_updated_at
  BEFORE UPDATE ON public.place_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. CALENDAR ENTRIES — Add feedback tracking columns
-- ============================================================

ALTER TABLE public.calendar_entries
  ADD COLUMN IF NOT EXISTS feedback_status TEXT DEFAULT NULL
    CHECK (feedback_status IS NULL OR feedback_status IN ('pending', 'completed', 'skipped', 'rescheduled')),
  ADD COLUMN IF NOT EXISTS review_id UUID REFERENCES public.place_reviews(id) ON DELETE SET NULL;

-- Index for finding entries that need feedback prompts
CREATE INDEX IF NOT EXISTS idx_calendar_entries_feedback
  ON public.calendar_entries (user_id, feedback_status)
  WHERE feedback_status IS NOT NULL OR feedback_status IS NULL;

-- ============================================================
-- 3. STORAGE BUCKET — voice-reviews (private, per-user folders)
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-reviews', 'voice-reviews', false)
ON CONFLICT (id) DO NOTHING;

-- Users can upload to their own folder (path prefix = user_id)
CREATE POLICY "users_upload_own_voice_reviews"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'voice-reviews'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can read their own voice reviews
CREATE POLICY "users_read_own_voice_reviews"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'voice-reviews'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Service role can access all voice reviews (for edge function processing)
CREATE POLICY "service_role_all_voice_reviews"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'voice-reviews'
    AND (SELECT auth.role()) = 'service_role'
  );
