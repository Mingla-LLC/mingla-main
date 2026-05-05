-- ORCH-0678 — Two-Pass Bouncer schema + migration backfill + legacy RPC retirement.
--
-- Adds three columns to place_pool for pre-photo Bouncer verdict, mirroring the
-- existing is_servable / bouncer_reason / bouncer_validated_at shape.
--
-- I-PRE-PHOTO-BOUNCER-SOLE-WRITER: only run-pre-photo-bouncer writes these columns
-- (plus this migration's one-time backfill).
-- I-IS-SERVABLE-SINGLE-WRITER: unchanged — only run-bouncer writes is_servable.
-- I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO: backfill-place-photos eligibility now keys
-- off passes_pre_photo_check (set BEFORE photos exist), dissolving the deadlock
-- introduced by ORCH-0640 ch06.

ALTER TABLE place_pool
  ADD COLUMN passes_pre_photo_check BOOLEAN,
  ADD COLUMN pre_photo_bouncer_reason TEXT,
  ADD COLUMN pre_photo_bouncer_validated_at TIMESTAMPTZ;

COMMENT ON COLUMN place_pool.passes_pre_photo_check IS
  'ORCH-0678 — true if place clears all Bouncer rules EXCEPT B8 (stored photos). '
  'Set by run-pre-photo-bouncer. NULL = never pre-bounced. Photo backfill gates on this.';
COMMENT ON COLUMN place_pool.pre_photo_bouncer_reason IS
  'ORCH-0678 — semicolon-joined rejection reasons from pre-photo pass. NULL when passing.';
COMMENT ON COLUMN place_pool.pre_photo_bouncer_validated_at IS
  'ORCH-0678 — timestamp of last pre-photo Bouncer run for this row.';

-- Backfill: existing is_servable=true rows passed the FULL rule set (including B8),
-- which is a strict superset of pre-photo rules. They trivially pass pre-photo.
-- This preserves cross-city idempotency — operators don't need to re-pre-bounce
-- already-healthy cities (Raleigh, London, Washington, Brussels, Baltimore, Cary,
-- Durham, Fort Lauderdale).
UPDATE place_pool
   SET passes_pre_photo_check = true,
       pre_photo_bouncer_reason = NULL,
       pre_photo_bouncer_validated_at = bouncer_validated_at
 WHERE is_servable = true;

-- Index for photo-backfill queries that filter on passes_pre_photo_check + city_id.
-- Partial index keeps it small; only indexes rows that have actually passed.
CREATE INDEX IF NOT EXISTS idx_place_pool_pre_photo_passed
  ON place_pool (city_id, passes_pre_photo_check)
  WHERE passes_pre_photo_check = true;

-- Retire legacy backfill RPCs (HF-1 in ORCH-0678 investigation; only consumed by
-- the soon-to-be-deleted handleLegacy route in backfill-place-photos).
-- Constitutional #8 subtraction. Zero non-self consumers verified by repo grep.
DROP FUNCTION IF EXISTS get_places_needing_photos(integer);
DROP FUNCTION IF EXISTS count_places_needing_photos();
