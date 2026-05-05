-- Add retry tracking to seeding_batches
-- Tracks how many times a failed batch has been retried.
-- retry_count starts at 0 (first attempt) and increments on each retry.

ALTER TABLE public.seeding_batches
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
