-- Issue #3355 final fix (C-4) — the rollout switch is ON for every brand at
-- launch, idempotently (enforced by
-- 20280628153355_issue_3355_ari_understand_first_on_for_all.sql).
--
--   P1  after the replay there is exactly one runtime version
--       'ari-understand-first-3355' and one launch rollout for it: active,
--       audience.all = true, rollout_percent 100;
--   P2  applying the migration twice more is clean and adds no row;
--   P3  the switch (the rows ariRollout.ts reads) is on for any brand;
--   P4  the kill switch (status 'paused') turns it off for every brand, and
--       re-applying the migration does not switch it back on;
--   P5  the unique key refuses a second launch rollout for the version.
-- Reverting 20280628153355 fails P1 (no rows: off for everyone).

\set ON_ERROR_STOP on
BEGIN;

-- What supabase/functions/_shared/ariRollout.ts decides for one brand
-- (ariRolloutCovers): a live row whose audience is everyone, an active or
-- completed row at 100 %, a listed brand, or the brand's bucket.
CREATE OR REPLACE FUNCTION pg_temp.uf_switch_on(p_brand uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ari_rollouts r
    JOIN public.ari_runtime_versions v ON v.id = r.runtime_version_id
    WHERE v.version_key = 'ari-understand-first-3355'
      AND r.status IN ('pilot', 'expanding', 'active', 'completed')
      AND (
        (r.audience->>'all') = 'true'
        OR (r.status IN ('active', 'completed') AND r.rollout_percent >= 100)
        OR (r.audience->'brand_ids') ? p_brand::text
      )
  );
$$;

-- ── P1 seeded once ────────────────────────────────────────────────────────
DO $p1$
DECLARE
  v_versions integer;
  v_rollouts integer;
  v_row public.ari_rollouts%ROWTYPE;
BEGIN
  SELECT count(*) INTO v_versions FROM public.ari_runtime_versions
  WHERE version_key = 'ari-understand-first-3355';
  IF v_versions <> 1 THEN
    RAISE EXCEPTION 'P1: expected 1 runtime version, got %', v_versions;
  END IF;
  SELECT count(*) INTO v_rollouts FROM public.ari_rollouts r
  JOIN public.ari_runtime_versions v ON v.id = r.runtime_version_id
  WHERE v.version_key = 'ari-understand-first-3355';
  IF v_rollouts <> 1 THEN
    RAISE EXCEPTION 'P1: expected 1 rollout, got %', v_rollouts;
  END IF;
  SELECT r.* INTO v_row FROM public.ari_rollouts r
  JOIN public.ari_runtime_versions v ON v.id = r.runtime_version_id
  WHERE v.version_key = 'ari-understand-first-3355';
  IF v_row.status <> 'active' OR v_row.rollout_percent <> 100
     OR (v_row.audience->>'all') IS DISTINCT FROM 'true'
     OR v_row.rollout_key IS DISTINCT FROM 'launch-on-for-all'
     OR v_row.rollback_version_id IS DISTINCT FROM (
       SELECT id FROM public.ari_runtime_versions
       WHERE version_key = 'ari-legacy-baseline') THEN
    RAISE EXCEPTION 'P1: launch rollout row is wrong: %', to_jsonb(v_row);
  END IF;
END
$p1$;

-- ── P2 applies twice more, cleanly ────────────────────────────────────────
\ir ../20280628153355_issue_3355_ari_understand_first_on_for_all.sql
\ir ../20280628153355_issue_3355_ari_understand_first_on_for_all.sql

DO $p2$
BEGIN
  IF (SELECT count(*) FROM public.ari_runtime_versions
      WHERE version_key = 'ari-understand-first-3355') <> 1
     OR (SELECT count(*) FROM public.ari_rollouts r
         JOIN public.ari_runtime_versions v ON v.id = r.runtime_version_id
         WHERE v.version_key = 'ari-understand-first-3355') <> 1 THEN
    RAISE EXCEPTION 'P2: re-applying the migration added a row';
  END IF;
END
$p2$;

-- ── P3 on for any brand ───────────────────────────────────────────────────
DO $p3$
BEGIN
  IF NOT pg_temp.uf_switch_on('33550000-0f00-4000-8000-0000000000a1')
     OR NOT pg_temp.uf_switch_on(gen_random_uuid()) THEN
    RAISE EXCEPTION 'P3: the switch is not on for every brand';
  END IF;
END
$p3$;

-- ── P4 the kill switch, and a re-apply never undoes it ────────────────────
UPDATE public.ari_rollouts r SET status = 'paused', updated_at = now()
FROM public.ari_runtime_versions v
WHERE r.runtime_version_id = v.id
  AND v.version_key = 'ari-understand-first-3355'
  AND r.status IN ('pilot', 'expanding', 'active', 'completed');

DO $p4a$
BEGIN
  IF pg_temp.uf_switch_on('33550000-0f00-4000-8000-0000000000a1')
     OR pg_temp.uf_switch_on(gen_random_uuid()) THEN
    RAISE EXCEPTION 'P4: paused did not switch it off';
  END IF;
END
$p4a$;

\ir ../20280628153355_issue_3355_ari_understand_first_on_for_all.sql

DO $p4b$
BEGIN
  IF pg_temp.uf_switch_on(gen_random_uuid()) THEN
    RAISE EXCEPTION 'P4: re-applying the migration switched a paused rollout back on';
  END IF;
  IF (SELECT r.status FROM public.ari_rollouts r
      JOIN public.ari_runtime_versions v ON v.id = r.runtime_version_id
      WHERE v.version_key = 'ari-understand-first-3355') <> 'paused' THEN
    RAISE EXCEPTION 'P4: the rollout is no longer paused';
  END IF;
END
$p4b$;

-- Back on (the documented "on again" statement).
UPDATE public.ari_rollouts r SET status = 'active', updated_at = now()
FROM public.ari_runtime_versions v
WHERE r.runtime_version_id = v.id
  AND v.version_key = 'ari-understand-first-3355'
  AND r.status = 'paused';

DO $p4c$
BEGIN
  IF NOT pg_temp.uf_switch_on(gen_random_uuid()) THEN
    RAISE EXCEPTION 'P4: on again did not switch it on';
  END IF;
END
$p4c$;

-- ── P5 one launch rollout per version ─────────────────────────────────────
DO $p5$
BEGIN
  BEGIN
    INSERT INTO public.ari_rollouts (runtime_version_id, rollout_key, status, audience, rollout_percent)
    SELECT id, 'launch-on-for-all', 'active', '{"all": true}'::jsonb, 100
    FROM public.ari_runtime_versions WHERE version_key = 'ari-understand-first-3355';
    RAISE EXCEPTION 'P5: a second launch rollout was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$p5$;

ROLLBACK;
