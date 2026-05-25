-- ORCH-0957: track thumbnail backfill completion per place.
-- NULL = thumbs not yet generated. NON-NULL = thumbs present in storage.

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS thumbs_backfilled_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS place_pool_thumbs_backfill_pending_idx
  ON public.place_pool (id)
  WHERE thumbs_backfilled_at IS NULL
    AND stored_photo_urls IS NOT NULL
    AND array_length(stored_photo_urls, 1) > 0;

COMMENT ON COLUMN public.place_pool.thumbs_backfilled_at IS
  'ORCH-0957: when backfill-place-photo-thumbs generated 384x384 thumbs for this place. NULL = pending or NEW place whose ingest-time thumb generation did not fully complete.';
