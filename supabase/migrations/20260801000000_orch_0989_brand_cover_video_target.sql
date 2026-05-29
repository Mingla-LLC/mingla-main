-- ORCH-0989 [Unified cover picker sheet] — brand-cover video target.
--
-- Generalizes the events-bound `event_cover_video_jobs` pipeline (ORCH-0770)
-- to ALSO accept a brand-scoped cover-video target (SPEC §8 Option A LOCKED).
-- A brand has no events-row, so `event_id` becomes nullable and a
-- `target_kind` discriminator gates which FK is populated.
--
-- Architecture B (COMMS-0010) is preserved: the Cloudinary eager string and
-- caps are unchanged; this migration touches only the job-table shape + RLS.
--
-- The brand video processed URL persists to brands.cover_media_url +
-- brands.cover_media_type='video' via event-cover-video-apply (and the
-- draft_auto path in the webhook is unreachable for brand jobs — brand jobs
-- always use published_manual apply semantics; SPEC §8.1).

-- 1) event_id becomes nullable (brand jobs have no events-row).
ALTER TABLE public.event_cover_video_jobs
  ALTER COLUMN event_id DROP NOT NULL;

-- 2) target_kind discriminator. Defaults to 'event' so every pre-existing
--    row (all events) keeps its meaning without a backfill.
ALTER TABLE public.event_cover_video_jobs
  ADD COLUMN IF NOT EXISTS target_kind text NOT NULL DEFAULT 'event'
    CHECK (target_kind IN ('event', 'brand'));

-- 3) Row-level coherence: an event job MUST have event_id; a brand job MUST
--    NOT (it is keyed on brand_id only, which is already NOT NULL).
ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_target_kind_event_id;
ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_target_kind_event_id
    CHECK (
      (target_kind = 'event' AND event_id IS NOT NULL)
      OR (target_kind = 'brand' AND event_id IS NULL)
    );

-- 4) The "one active job per event" unique index used a NOT NULL event_id.
--    With nullable event_id, NULLs are distinct in a unique index so brand
--    rows never collide there. Add a sibling unique index that enforces "one
--    active job per brand" for brand-target jobs (mirrors the event guard the
--    upload-intent supersede step relies on).
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_cover_video_jobs_one_active_per_brand_target
ON public.event_cover_video_jobs (brand_id)
WHERE target_kind = 'brand' AND status NOT IN ('failed', 'cancelled', 'applied');

CREATE INDEX IF NOT EXISTS idx_event_cover_video_jobs_brand_target_created
ON public.event_cover_video_jobs (brand_id, created_at DESC)
WHERE target_kind = 'brand';

-- 5) RLS: the existing SELECT policy (ORCH-0770) only admits event-target
--    rows (it joins public.events). Brand jobs have no events-row, so that
--    EXISTS branch can never be true for them. Replace the policy with a
--    UNION-OF-PREDICATES that keeps the event predicate byte-for-byte AND
--    adds a brand predicate gated by brand_admin rank. Writes remain
--    service-role only (no INSERT/UPDATE/DELETE policy exists — the edge
--    functions use the service role; that boundary is unchanged).
DROP POLICY IF EXISTS "Event managers can read event cover video jobs"
ON public.event_cover_video_jobs;

CREATE POLICY "Event managers can read event cover video jobs"
ON public.event_cover_video_jobs
FOR SELECT
TO authenticated
USING (
  -- Event-target rows: UNCHANGED event predicate (event_manager on the
  -- owning event's brand).
  (
    event_cover_video_jobs.target_kind = 'event'
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_cover_video_jobs.event_id
        AND e.brand_id = event_cover_video_jobs.brand_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank_for_caller(e.brand_id)
          >= public.biz_role_rank('event_manager'::text)
    )
  )
  -- Brand-target rows: brand_admin on the job's brand (no events-row exists).
  OR (
    event_cover_video_jobs.target_kind = 'brand'
    AND public.biz_brand_effective_rank_for_caller(event_cover_video_jobs.brand_id)
      >= public.biz_role_rank('brand_admin'::text)
  )
);

COMMENT ON COLUMN public.event_cover_video_jobs.target_kind IS
  'ORCH-0989: cover-video target discriminator. event => event_id set (events.cover_media_url); brand => event_id NULL, keyed on brand_id (brands.cover_media_url).';
