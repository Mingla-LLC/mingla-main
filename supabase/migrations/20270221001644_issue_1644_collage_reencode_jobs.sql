-- Issue #1644 — Stage 2: the collage re-encode. Job table + the narrow write path.
--
-- WHY
-- ---
-- `place-collages` holds 34,024 PNGs / 33.35 GiB. Re-encoding them to WebP q80 at
-- the same 768x768 reclaims ~30 GiB without deleting a single asset. That matters
-- because the Stage 0 guardrail refuses storage-writing backfills above 85 GiB and
-- we sit at 78.21 GiB — 92% of the ceiling, 6.79 GiB of room, against a measured
-- backfill rate of 29.3 GiB/week. The re-encode is the precondition for the next
-- city launch, not a tidy-up.
--
-- 34,024 objects will not complete in one run, and the delete of the superseded
-- PNGs is irreversible. So the whole migration is auditable, resumable and
-- reversible by construction:
--
--   pending -> claimed -> encoded -> verified -> committed -> deleted
--                                             \-> skipped
--                      \-> failed (retryable; returns to pending)
--
-- The row IS the manifest. The delete step reads `status='committed'` rows and
-- deletes ONLY those keys — never a prefix-wide delete of the bucket.
--
-- THE I-COLLAGE-SOLE-OWNER EXCEPTION (read this before changing anything here)
-- ---------------------------------------------------------------------------
-- `place_pool.photo_collage_url` is owned EXCLUSIVELY by the
-- `run-place-intelligence-trial` edge function (I-COLLAGE-SOLE-OWNER, ORCH-0712;
-- see the column COMMENT). This migration adds ONE narrow exception, and enforces
-- its narrowness in SQL rather than trusting the caller:
--
--   `issue_1644_collage_reencode_commit` may ONLY rewrite a URL from
--   `<place>/<fingerprint>.png` to `<place>/<fingerprint>.webp`.
--
-- Same place, same 12-hex content fingerprint, same bucket — only the container
-- format changes. It CANNOT point a place at a different place's collage, at a
-- different fingerprint, or at a bucket we did not name, because it verifies the
-- key rewrite and matches the stored URL by exact suffix before touching a row.
-- `photo_collage_fingerprint` is deliberately NOT written: it fingerprints the
-- SOURCE PHOTOS, not the collage bytes, so the pipeline's idempotency check
-- (`fingerprint matches AND url present -> cache hit`) keeps working untouched and
-- keeps returning the .webp.
--
-- HISTORY IS REWRITTEN IN THE SAME TRANSACTION, ON PURPOSE
-- -------------------------------------------------------
-- `place_intelligence_trial_runs.collage_url` holds 34,317 independent copies of
-- these same URLs, rendered as a thumbnail in the admin Trial Results view. If we
-- swapped only `place_pool` and then deleted the PNGs, every historical row would
-- render a broken image. The commit therefore repoints matching history rows in the
-- same transaction, under exactly the same suffix-match rule.
--
-- SECURITY: every function here is service_role-only. They are operational tools
-- over a one-time corpus migration; anon/authenticated have no business calling
-- them, so none of them needs an entry in
-- supabase/security/anon_executable_definer_allowlist.txt (ORCH-1392 gate).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The manifest table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.place_collage_reencode_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL,
  place_pool_id  uuid NOT NULL REFERENCES public.place_pool (id) ON DELETE CASCADE,

  -- Content-addressed keys inside the `place-collages` bucket.
  old_key        text NOT NULL,
  new_key        text NOT NULL,

  old_bytes      bigint NOT NULL,
  new_bytes      bigint,
  width          integer,
  height         integer,

  -- The defect audit: how many pixels of this object were transparent before we
  -- flattened it. This is what proves, per object, that we corrected the corpus
  -- rather than converting it as-is.
  transparent_pixels_before integer,

  status         text NOT NULL DEFAULT 'pending',
  attempts       integer NOT NULL DEFAULT 0,
  error          text,

  claimed_at     timestamptz,
  encoded_at     timestamptz,
  verified_at    timestamptz,
  committed_at   timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- One job per stored object, forever. This is what makes `plan` idempotent and
  -- makes a re-plan after an interrupted run a no-op instead of a duplicate pass.
  CONSTRAINT place_collage_reencode_jobs_old_key_key UNIQUE (old_key),

  CONSTRAINT place_collage_reencode_jobs_status_check CHECK (
    status IN ('pending','claimed','encoded','verified','committed','deleted','failed','skipped')
  ),
  CONSTRAINT place_collage_reencode_jobs_old_key_shape CHECK (old_key LIKE '%.png'),
  CONSTRAINT place_collage_reencode_jobs_new_key_shape CHECK (new_key LIKE '%.webp'),
  -- FORMAT-ONLY, enforced by the table itself: the new key must be the old key
  -- with its extension swapped and nothing else. A row that does not satisfy this
  -- cannot exist, so no code path can ever commit one.
  CONSTRAINT place_collage_reencode_jobs_format_only CHECK (
    new_key = left(old_key, length(old_key) - 4) || '.webp'
  ),
  CONSTRAINT place_collage_reencode_jobs_old_bytes_positive CHECK (old_bytes > 0)
);

COMMENT ON TABLE public.place_collage_reencode_jobs IS
  'Issue #1644 Stage 2 — one row per stored place-collage PNG being re-encoded to WebP. '
  'The row IS the manifest: the delete step operates ONLY on rows with status=''committed'' '
  'and never on a bucket prefix. Auditable (old/new bytes per object), resumable (claim by '
  'status) and reversible (issue_1644_collage_reencode_rollback while the PNG still exists).';

COMMENT ON COLUMN public.place_collage_reencode_jobs.transparent_pixels_before IS
  'Pixels at alpha=0 in the STORED PNG before flattening. Non-zero here is the transparent-red '
  'fill bug fixed in imageCollage.ts on 2026-08-05; a 5-photo place in a 3x3 grid measures '
  '262144/589824 = 44.444%. Recorded per object so the corpus correction is auditable.';

CREATE INDEX IF NOT EXISTS place_collage_reencode_jobs_run_status_idx
  ON public.place_collage_reencode_jobs (run_id, status);

-- Partial index on the claim path: the worker only ever scans pending rows, and a
-- full-table scan over 34,024 rows on every claim is wasted work while users are
-- on the app.
CREATE INDEX IF NOT EXISTS place_collage_reencode_jobs_pending_idx
  ON public.place_collage_reencode_jobs (run_id, old_bytes DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS place_collage_reencode_jobs_place_idx
  ON public.place_collage_reencode_jobs (place_pool_id);

-- ── updated_at ──────────────────────────────────────────────────────────────
-- A plain (NOT security definer) trigger function: trigger functions are outside
-- the ORCH-1392 anon-definer gate, and this one needs no elevated rights.
CREATE OR REPLACE FUNCTION public.tg_issue_1644_collage_reencode_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS place_collage_reencode_jobs_touch ON public.place_collage_reencode_jobs;
CREATE TRIGGER place_collage_reencode_jobs_touch
  BEFORE UPDATE ON public.place_collage_reencode_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_1644_collage_reencode_touch();

-- ── RLS: service_role only ──────────────────────────────────────────────────
-- RLS is ENABLED (so the table needs no entry in scripts/audit/rls-allowlist.json)
-- and no grant is issued to anon/authenticated at all, so it never even appears in
-- their PostgREST schema.
ALTER TABLE public.place_collage_reencode_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_collage_reencode_jobs ON public.place_collage_reencode_jobs;
CREATE POLICY service_role_all_collage_reencode_jobs
  ON public.place_collage_reencode_jobs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON TABLE public.place_collage_reencode_jobs FROM PUBLIC;
REVOKE ALL ON TABLE public.place_collage_reencode_jobs FROM anon;
REVOKE ALL ON TABLE public.place_collage_reencode_jobs FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.place_collage_reencode_jobs TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PLAN — build the manifest from storage.objects
--
-- `storage.objects` is not exposed through PostgREST, so a SECURITY DEFINER
-- wrapper is the only route (same reasoning as the Stage 0 measurement RPC).
-- Building the manifest server-side also avoids shipping 34,024 rows over the
-- wire just to send most of them back.
--
-- Only plans objects the pool is ACTUALLY POINTING AT. An object whose place has
-- since been re-composed onto a different fingerprint is genuinely orphaned; it is
-- not our business to re-encode it and it must certainly not be deleted by a job
-- whose "replacement" nothing reads.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.issue_1644_collage_reencode_plan(
  p_run_id uuid,
  p_limit  integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_inserted integer;
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'issue_1644 plan: p_run_id is required (it is how a pilot is separated from the full run)';
  END IF;
  IF p_limit IS NOT NULL AND p_limit <= 0 THEN
    RAISE EXCEPTION 'issue_1644 plan: p_limit must be positive when supplied, got %', p_limit;
  END IF;

  INSERT INTO public.place_collage_reencode_jobs (run_id, place_pool_id, old_key, new_key, old_bytes)
  SELECT
    p_run_id,
    pp.id,
    o.name,
    left(o.name, length(o.name) - 4) || '.webp',
    (o.metadata ->> 'size')::bigint
  FROM storage.objects o
  JOIN public.place_pool pp
    ON pp.id::text = split_part(o.name, '/', 1)
  WHERE o.bucket_id = 'place-collages'
    AND o.name LIKE '%.png'
    AND (o.metadata ->> 'size')::bigint > 0
    AND pp.photo_collage_url IS NOT NULL
    -- Exact suffix match, not LIKE: the pool row must point at THIS object.
    AND right(pp.photo_collage_url, length('/place-collages/' || o.name)) = '/place-collages/' || o.name
    -- LIMIT applies to UNPLANNED objects, so a second `plan` after a partial pass
    -- adds the NEXT n rather than re-selecting the same n and inserting nothing.
    AND NOT EXISTS (
      SELECT 1 FROM public.place_collage_reencode_jobs j WHERE j.old_key = o.name
    )
  -- Biggest objects first: the saving is realised soonest and the pilot sample is
  -- the least favourable one, so the measured saving is a floor, not an average.
  ORDER BY (o.metadata ->> 'size')::bigint DESC
  LIMIT COALESCE(p_limit, 2147483647)
  ON CONFLICT (old_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_plan(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_plan(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_plan(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1644_collage_reencode_plan(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.issue_1644_collage_reencode_plan(uuid, integer) IS
  'Issue #1644 Stage 2 — populate the re-encode manifest from storage.objects for collages the '
  'pool actually points at. Idempotent (UNIQUE old_key + NOT EXISTS), largest-first. service_role only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CLAIM — hand out work atomically
--
-- FOR UPDATE SKIP LOCKED rather than read-then-conditional-update: two workers
-- (or a retried invocation) must never both claim the same object, because both
-- would upload and one would then commit against a job row the other already
-- advanced.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.issue_1644_collage_reencode_claim(
  p_run_id uuid,
  p_limit  integer
)
RETURNS SETOF public.place_collage_reencode_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 500 THEN
    RAISE EXCEPTION 'issue_1644 claim: p_limit must be between 1 and 500, got %', p_limit;
  END IF;

  RETURN QUERY
  UPDATE public.place_collage_reencode_jobs j
     SET status     = 'claimed',
         claimed_at = now(),
         attempts   = j.attempts + 1
   WHERE j.id IN (
     SELECT c.id
     FROM public.place_collage_reencode_jobs c
     WHERE c.run_id = p_run_id
       AND c.status = 'pending'
     ORDER BY c.old_bytes DESC
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
   )
  RETURNING j.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_claim(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_claim(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_claim(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1644_collage_reencode_claim(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.issue_1644_collage_reencode_claim(uuid, integer) IS
  'Issue #1644 Stage 2 — atomically claim up to p_limit pending re-encode jobs (FOR UPDATE '
  'SKIP LOCKED) so concurrent workers never double-process an object. service_role only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. COMMIT — the ONLY sanctioned write to place_pool.photo_collage_url outside
--    run-place-intelligence-trial, and the narrowest one we can express.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.issue_1644_collage_reencode_commit(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  j                public.place_collage_reencode_jobs;
  v_old_suffix     text;
  v_new_suffix     text;
  v_pool_url       text;
  v_pool_updated   integer := 0;
  v_history_updated integer := 0;
BEGIN
  SELECT * INTO j
  FROM public.place_collage_reencode_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_1644 commit: job % not found', p_job_id;
  END IF;

  -- Idempotent replay: a retried invocation must not error and must not double-write.
  IF j.status IN ('committed', 'deleted', 'skipped') THEN
    RETURN jsonb_build_object(
      'job_id', j.id, 'status', j.status, 'already', true,
      'pool_rows_updated', 0, 'history_rows_updated', 0
    );
  END IF;

  -- The replacement must have been PROVEN to exist and be fetchable first. The
  -- whole ordering contract of this stage is write -> verify -> commit -> delete;
  -- committing an unverified job would let the delete step remove a PNG whose
  -- replacement was never confirmed.
  IF j.status <> 'verified' THEN
    RAISE EXCEPTION
      'issue_1644 commit: job % is "%" — only a VERIFIED replacement may be committed', j.id, j.status;
  END IF;

  -- FORMAT-ONLY. Belt and braces over the table CHECK: this is the last gate
  -- before a production URL changes, and it costs nothing.
  IF j.new_key <> left(j.old_key, length(j.old_key) - 4) || '.webp' THEN
    RAISE EXCEPTION
      'issue_1644 commit: refusing a non-format-only rewrite % -> %', j.old_key, j.new_key;
  END IF;
  IF split_part(j.old_key, '/', 1) <> j.place_pool_id::text THEN
    RAISE EXCEPTION
      'issue_1644 commit: key % does not belong to place %', j.old_key, j.place_pool_id;
  END IF;

  v_old_suffix := '/place-collages/' || j.old_key;
  v_new_suffix := '/place-collages/' || j.new_key;

  SELECT pp.photo_collage_url INTO v_pool_url
  FROM public.place_pool pp
  WHERE pp.id = j.place_pool_id
  FOR UPDATE;

  IF NOT FOUND OR v_pool_url IS NULL THEN
    -- The place lost its collage entirely between plan and commit. Our WebP is not
    -- in use, so the PNG must NOT be deleted. Skip, loudly, in the manifest.
    UPDATE public.place_collage_reencode_jobs
       SET status = 'skipped',
           error  = 'place_pool.photo_collage_url is null at commit time — replacement is unused, PNG retained'
     WHERE id = j.id;
    RETURN jsonb_build_object('job_id', j.id, 'status', 'skipped', 'reason', 'pool_url_null');
  END IF;

  IF right(v_pool_url, length(v_new_suffix)) = v_new_suffix THEN
    -- Already swapped by an earlier partially-completed run. Fall through to the
    -- history rewrite so a half-finished commit still converges.
    v_pool_updated := 0;

  ELSIF right(v_pool_url, length(v_old_suffix)) = v_old_suffix THEN
    UPDATE public.place_pool
       SET photo_collage_url =
             left(v_pool_url, length(v_pool_url) - length(v_old_suffix)) || v_new_suffix
     WHERE id = j.place_pool_id;
    GET DIAGNOSTICS v_pool_updated = ROW_COUNT;

  ELSE
    -- The intelligence pipeline re-composed this place since we planned, so the
    -- pool now points at a DIFFERENT fingerprint. Our PNG is superseded and our
    -- WebP is unread. Skip — and never delete, because "superseded" is a
    -- conclusion about the pool, not about whether anything else still reads it.
    UPDATE public.place_collage_reencode_jobs
       SET status = 'skipped',
           error  = 'place_pool.photo_collage_url moved to a different object before commit — PNG retained'
     WHERE id = j.id;
    RETURN jsonb_build_object('job_id', j.id, 'status', 'skipped', 'reason', 'pool_url_moved');
  END IF;

  -- Repoint the historical trial rows that render this same object as a thumbnail
  -- in the admin Trial Results view. Without this, deleting the PNGs would break
  -- 34,317 historical thumbnails.
  UPDATE public.place_intelligence_trial_runs r
     SET collage_url =
           left(r.collage_url, length(r.collage_url) - length(v_old_suffix)) || v_new_suffix
   WHERE r.place_pool_id = j.place_pool_id
     AND r.collage_url IS NOT NULL
     AND right(r.collage_url, length(v_old_suffix)) = v_old_suffix;
  GET DIAGNOSTICS v_history_updated = ROW_COUNT;

  UPDATE public.place_collage_reencode_jobs
     SET status = 'committed',
         committed_at = now(),
         error = NULL
   WHERE id = j.id;

  RETURN jsonb_build_object(
    'job_id', j.id,
    'status', 'committed',
    'pool_rows_updated', v_pool_updated,
    'history_rows_updated', v_history_updated
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_commit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_commit(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_commit(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1644_collage_reencode_commit(uuid) TO service_role;

COMMENT ON FUNCTION public.issue_1644_collage_reencode_commit(uuid) IS
  'Issue #1644 Stage 2 — the ONLY sanctioned write to place_pool.photo_collage_url outside '
  'run-place-intelligence-trial (I-COLLAGE-SOLE-OWNER narrow exception). Rewrites the URL from '
  '<place>/<fingerprint>.png to <place>/<fingerprint>.webp and nothing else: same place, same '
  'fingerprint, same bucket, format only. Requires status=''verified''. Repoints matching '
  'place_intelligence_trial_runs.collage_url history in the same transaction so the admin '
  'thumbnails do not break when the PNGs are deleted. service_role only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ROLLBACK — undo a commit while the PNG still exists
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.issue_1644_collage_reencode_rollback(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  j                 public.place_collage_reencode_jobs;
  v_old_suffix      text;
  v_new_suffix      text;
  v_pool_url        text;
  v_pool_updated    integer := 0;
  v_history_updated integer := 0;
BEGIN
  SELECT * INTO j FROM public.place_collage_reencode_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_1644 rollback: job % not found', p_job_id;
  END IF;

  -- Once the PNG is gone there is nothing to roll back TO. Refusing here is the
  -- difference between an honest error and a URL pointing at a deleted object.
  IF j.status = 'deleted' THEN
    RAISE EXCEPTION
      'issue_1644 rollback: job % is DELETED — the .png no longer exists, so the URL cannot be restored. '
      'Recovery is a re-compose via run-place-intelligence-trial (compose_collage, force=true).', j.id;
  END IF;
  IF j.status <> 'committed' THEN
    RETURN jsonb_build_object('job_id', j.id, 'status', j.status, 'noop', true);
  END IF;

  v_old_suffix := '/place-collages/' || j.old_key;
  v_new_suffix := '/place-collages/' || j.new_key;

  SELECT pp.photo_collage_url INTO v_pool_url FROM public.place_pool pp WHERE pp.id = j.place_pool_id FOR UPDATE;

  IF v_pool_url IS NOT NULL AND right(v_pool_url, length(v_new_suffix)) = v_new_suffix THEN
    UPDATE public.place_pool
       SET photo_collage_url = left(v_pool_url, length(v_pool_url) - length(v_new_suffix)) || v_old_suffix
     WHERE id = j.place_pool_id;
    GET DIAGNOSTICS v_pool_updated = ROW_COUNT;
  END IF;

  UPDATE public.place_intelligence_trial_runs r
     SET collage_url = left(r.collage_url, length(r.collage_url) - length(v_new_suffix)) || v_old_suffix
   WHERE r.place_pool_id = j.place_pool_id
     AND r.collage_url IS NOT NULL
     AND right(r.collage_url, length(v_new_suffix)) = v_new_suffix;
  GET DIAGNOSTICS v_history_updated = ROW_COUNT;

  UPDATE public.place_collage_reencode_jobs
     SET status = 'verified', committed_at = NULL
   WHERE id = j.id;

  RETURN jsonb_build_object(
    'job_id', j.id, 'status', 'verified', 'rolled_back', true,
    'pool_rows_updated', v_pool_updated, 'history_rows_updated', v_history_updated
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_rollback(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_rollback(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_rollback(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1644_collage_reencode_rollback(uuid) TO service_role;

COMMENT ON FUNCTION public.issue_1644_collage_reencode_rollback(uuid) IS
  'Issue #1644 Stage 2 — restore a committed job''s .png URL on place_pool and on the trial-run '
  'history. Refuses once the PNG has been deleted, because there would be nothing to point at. '
  'service_role only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. STATS — one round trip for the operator-facing progress view
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.issue_1644_collage_reencode_stats(p_run_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'jobs',            COALESCE(count(*), 0),
    'old_bytes',       COALESCE(sum(old_bytes), 0),
    'new_bytes',       COALESCE(sum(new_bytes), 0),
    'reclaimable_bytes', COALESCE(sum(old_bytes) FILTER (WHERE status IN ('committed','deleted')), 0)
                       - COALESCE(sum(new_bytes) FILTER (WHERE status IN ('committed','deleted')), 0),
    'by_status',       COALESCE(
      (SELECT jsonb_object_agg(s.status, s.n)
       FROM (
         SELECT status, count(*) AS n
         FROM public.place_collage_reencode_jobs
         WHERE p_run_id IS NULL OR run_id = p_run_id
         GROUP BY status
       ) s), '{}'::jsonb)
  )
  FROM public.place_collage_reencode_jobs
  WHERE p_run_id IS NULL OR run_id = p_run_id;
$function$;

REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_stats(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_stats(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.issue_1644_collage_reencode_stats(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1644_collage_reencode_stats(uuid) TO service_role;

COMMENT ON FUNCTION public.issue_1644_collage_reencode_stats(uuid) IS
  'Issue #1644 Stage 2 — manifest roll-up (counts by status, bytes before/after, realised '
  'reclaim). service_role only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. THE BUCKET MUST ACCEPT image/webp — without this, every upload 400s
--
-- Found during Stage 2 pre-flight against production:
--
--   place-photos    allowed_mime_types = {image/jpeg, image/png, image/webp}
--   place-collages  allowed_mime_types = {image/png,  image/jpeg}          <-- no webp
--
-- Supabase Storage validates the upload's content-type against that list, so the
-- re-encode would have failed on its very first object with `invalid_mime_type`
-- — after the worker had already been pointed at 34,024 of them. `place-photos`
-- next door already carries the exact value we need, so this is bringing one
-- bucket in line with its sibling, not inventing a policy.
--
-- Guarded three ways:
--   * column-existence — the CI supabase/postgres image ships a MINIMAL
--     storage.buckets (id, name, owner, created_at, updated_at) with no
--     allowed_mime_types column at all, so this must be a no-op there.
--   * NULL means "allow everything"; adding a list would RESTRICT such a bucket,
--     so a NULL list is left alone.
--   * idempotent — re-running adds nothing and reorders nothing.
--
-- And then VERIFIED: if the column exists, the bucket exists, has a restrictive
-- list, and still does not admit image/webp after the update, this migration
-- FAILS. A migration that cannot do its job must not report success — otherwise
-- the failure resurfaces mid-run as an opaque 400 on object number one.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_has_column boolean;
  v_current text[];
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types'
  ) INTO v_has_column;

  IF NOT v_has_column THEN
    RAISE NOTICE '[#1644] storage.buckets has no allowed_mime_types column (minimal CI image) — skipping the webp allowance.';
    RETURN;
  END IF;

  EXECUTE $sql$
    UPDATE storage.buckets
       SET allowed_mime_types = allowed_mime_types || ARRAY['image/webp']
     WHERE id = 'place-collages'
       AND allowed_mime_types IS NOT NULL
       AND NOT ('image/webp' = ANY (allowed_mime_types))
  $sql$;

  EXECUTE $sql$
    SELECT allowed_mime_types FROM storage.buckets WHERE id = 'place-collages'
  $sql$ INTO v_current;

  IF v_current IS NOT NULL AND NOT ('image/webp' = ANY (v_current)) THEN
    RAISE EXCEPTION
      '[#1644] place-collages still does not allow image/webp (current: %). Every WebP upload would '
      'fail with invalid_mime_type. Add image/webp to the bucket''s allowed MIME types in the '
      'Supabase dashboard (Storage -> place-collages -> Settings) and re-run.', v_current;
  END IF;
END $$;

-- A fail-fast pre-flight for the worker. Reading storage.buckets needs a
-- SECURITY DEFINER wrapper for the same reason storage.objects did. Turning an
-- opaque mid-run 400 into a refusal at object zero is worth one tiny function.
CREATE OR REPLACE FUNCTION public.issue_1644_collage_bucket_accepts_webp()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_has_column boolean;
  v_types text[];
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types'
  ) INTO v_has_column;

  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'place-collages') INTO v_exists;
  IF NOT v_exists THEN
    RETURN jsonb_build_object('accepts_webp', false, 'reason', 'bucket_missing');
  END IF;

  IF NOT v_has_column THEN
    -- No policy column at all means no MIME restriction is enforceable.
    RETURN jsonb_build_object('accepts_webp', true, 'reason', 'no_mime_policy_column');
  END IF;

  EXECUTE $sql$ SELECT allowed_mime_types FROM storage.buckets WHERE id = 'place-collages' $sql$
    INTO v_types;

  -- NULL means unrestricted.
  RETURN jsonb_build_object(
    'accepts_webp', v_types IS NULL OR 'image/webp' = ANY (v_types),
    'allowed_mime_types', to_jsonb(v_types)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1644_collage_bucket_accepts_webp() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1644_collage_bucket_accepts_webp() FROM anon;
REVOKE ALL ON FUNCTION public.issue_1644_collage_bucket_accepts_webp() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1644_collage_bucket_accepts_webp() TO service_role;

COMMENT ON FUNCTION public.issue_1644_collage_bucket_accepts_webp() IS
  'Issue #1644 Stage 2 pre-flight — does the place-collages bucket admit image/webp uploads? '
  'Production shipped with allowed_mime_types = {image/png,image/jpeg}, which would have failed '
  'every WebP upload with invalid_mime_type. service_role only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Keep the column COMMENT truthful about its one exception
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.place_pool.photo_collage_url IS
  'ORCH-0712 — public URL of composed photo grid for this place (in place-collages bucket). '
  'Owned EXCLUSIVELY by run-place-intelligence-trial edge function compose_collage action. '
  'admin-seed-places, bouncer, signal scorer MUST NOT write this column. I-COLLAGE-SOLE-OWNER. '
  'ONE NARROW EXCEPTION (issue #1644 Stage 2): public.issue_1644_collage_reencode_commit() may '
  'rewrite this URL from <place>/<fingerprint>.png to <place>/<fingerprint>.webp — same place, '
  'same fingerprint, same bucket, container format only, enforced in SQL. It never writes '
  'photo_collage_fingerprint, so the pipeline''s idempotency check is unaffected.';
