-- ============================================================================
-- Drop voice review / audio recording infrastructure
-- ============================================================================
-- Reviews now collect only star ratings. Audio recording, transcription,
-- sentiment analysis, and theme extraction are removed entirely.
-- The place_reviews table keeps: rating, did_attend, feedback_text, place
-- data, and timestamps. Everything else is dropped.
-- ============================================================================

-- ── Drop audio/AI columns from place_reviews ──
ALTER TABLE public.place_reviews
  DROP COLUMN IF EXISTS audio_urls,
  DROP COLUMN IF EXISTS audio_durations_seconds,
  DROP COLUMN IF EXISTS transcription,
  DROP COLUMN IF EXISTS sentiment,
  DROP COLUMN IF EXISTS themes,
  DROP COLUMN IF EXISTS ai_summary,
  DROP COLUMN IF EXISTS processing_status,
  DROP COLUMN IF EXISTS processing_error,
  DROP COLUMN IF EXISTS processed_at;

-- ── Drop sentiment analytics columns from place_pool ──
ALTER TABLE public.place_pool
  DROP COLUMN IF EXISTS mingla_positive_count,
  DROP COLUMN IF EXISTS mingla_negative_count,
  DROP COLUMN IF EXISTS mingla_top_themes;

-- ── Drop processing_status index (column no longer exists) ──
DROP INDEX IF EXISTS idx_place_reviews_processing;
