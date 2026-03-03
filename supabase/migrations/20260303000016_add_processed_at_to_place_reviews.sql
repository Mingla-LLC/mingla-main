-- Add processed_at column to place_reviews
-- Required by process-voice-review edge function to record when processing completed
-- Missing from original voice_reviews migration (20260303000015)

ALTER TABLE public.place_reviews
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
