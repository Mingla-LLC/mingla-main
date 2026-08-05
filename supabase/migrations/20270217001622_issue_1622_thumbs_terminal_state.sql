-- Issue #1622 — give the thumbnail backfill a SECOND EXIT from its work queue.
--
-- Today the only exit is `thumbs_backfilled_at IS NOT NULL`, and that is set
-- ONLY when every photo for a place succeeds (all-or-nothing, deliberate). A
-- place with even one permanently un-thumbable photo therefore NEVER leaves the
-- queue: it is re-claimed every ~10 minutes, forever. 77 places were pinned this
-- way against 40,031 completed — the job works; these are stuck.
--
-- Proof (one stuck place, 5 photos): photo 4's ORIGINAL returns 400 (the object
-- is gone) and photo 1's thumb will not generate. Neither can ever succeed, so
-- the other three re-run every round redoing finished work.
--
-- This adds a terminal state DISTINCT from success. Deliberately NOT reusing the
-- `__backfill_failed__` sentinel: that lives inside `stored_photo_urls`, which
-- the client renders as image URLs and the serving RPCs filter on — writing a
-- failure token into a rendered data field is the bug class this must not
-- recreate. Terminal state gets its own column.
--
-- SAFETY: three columns on place_pool (~88k rows). A NOT NULL column with a
-- non-volatile DEFAULT is a metadata-only change in PostgreSQL 11+ (no table
-- rewrite, no long ACCESS EXCLUSIVE hold).
--   https://www.postgresql.org/docs/current/ddl-alter.html#DDL-ALTER-ADDING-A-COLUMN

ALTER TABLE public.place_pool
  -- The terminal state. NULL = still eligible. Non-NULL = this place has a photo
  -- that can never be thumbed; stop reclaiming it. Clearing this column re-queues
  -- the place — a DELIBERATE admin action, never automatic.
  ADD COLUMN IF NOT EXISTS thumbs_failed_at timestamptz,
  -- Backstop for REPEATED TRANSIENT failure (timeout / 5xx / network). Permanent
  -- failures terminate immediately and never consume attempts.
  ADD COLUMN IF NOT EXISTS thumbs_attempts smallint NOT NULL DEFAULT 0,
  -- A terminal state must be DIAGNOSABLE. Without this, "stopped trying" is
  -- indistinguishable from "nobody looked" — the same blindness as a monitor
  -- that cannot report failure (#1620).
  ADD COLUMN IF NOT EXISTS thumbs_last_error text;

COMMENT ON COLUMN public.place_pool.thumbs_failed_at IS
  'Issue #1622 — terminal state for the thumbnail backfill. Non-NULL means at '
  'least one photo can NEVER be thumbed (dead original / undecodable image), so '
  'the place is excluded from the work queue. Distinct from thumbs_backfilled_at '
  '(success). Clear it to re-queue; that is a deliberate admin action.';

COMMENT ON COLUMN public.place_pool.thumbs_attempts IS
  'Issue #1622 — count of FULLY-DRAINED rounds that ended in failure for this '
  'place. Incremented ONLY when a round drained every photo job; a CPU-wall-guard '
  'interruption must NOT increment it, or a repeatedly-interrupted healthy place '
  'would be falsely marked terminal. Permanent failures bypass this counter.';

COMMENT ON COLUMN public.place_pool.thumbs_last_error IS
  'Issue #1622 — the failure that caused thumbs_failed_at, so a terminal state '
  'can be diagnosed rather than merely observed.';

-- The work queue reads: is_servable AND thumbs_backfilled_at IS NULL AND
-- thumbs_failed_at IS NULL. Partial index matching that predicate so the claim
-- stays cheap as terminal rows accumulate.
CREATE INDEX IF NOT EXISTS idx_place_pool_thumbs_pending
  ON public.place_pool (created_at)
  WHERE thumbs_backfilled_at IS NULL
    AND thumbs_failed_at IS NULL
    AND is_servable = true;
