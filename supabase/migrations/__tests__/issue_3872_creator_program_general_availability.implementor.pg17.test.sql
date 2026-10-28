-- #3872 Creator Program general availability (PostgreSQL 17).
-- MINGLA-INVARIANT: I-PROPOSED-3872-11 | issue #3872 | Missing rollout state defaults to general availability for a nondeleted brand, pilots become generally available, and an explicit dark row remains authoritative.
-- Proves current-brand backfill, future/restored default-on gates, explicit-dark precedence,
-- audited flag ownership, Locals no-spend boundaries and replay idempotency.

\set ON_ERROR_STOP on

CREATE TEMP TABLE i3872_ga_fixture(
  owner_id uuid NOT NULL,
  current_brand_id uuid NOT NULL,
  pilot_brand_id uuid NOT NULL,
  dark_brand_id uuid NOT NULL,
  deleted_brand_id uuid NOT NULL,
  future_brand_id uuid NOT NULL,
  restored_brand_id uuid NOT NULL
) ON COMMIT PRESERVE ROWS;

CREATE TEMP TABLE i3872_ga_flags AS
SELECT flag_key, is_enabled
FROM public.feature_flags
WHERE flag_key IN (
  'discounts_enabled',
  'referrals_enabled',
  'creator_gigs_enabled',
  'creator_media_uploads_enabled',
  'mingla_locals_enabled'
);

CREATE TEMP TABLE i3872_ga_local_snapshot AS
SELECT count(*)::bigint AS row_count,
  md5(COALESCE(jsonb_agg(to_jsonb(program) ORDER BY program.city_id)::text, '[]')) AS digest
FROM public.local_city_programs program;

BEGIN;
INSERT INTO i3872_ga_fixture VALUES (
  '38720000-0000-4000-8000-000000000301',
  '38720000-0000-4000-8300-000000000301',
  '38720000-0000-4000-8300-000000000302',
  '38720000-0000-4000-8300-000000000303',
  '38720000-0000-4000-8300-000000000304',
  '38720000-0000-4000-8300-000000000305',
  '38720000-0000-4000-8300-000000000306'
);
INSERT INTO auth.users(id, email)
SELECT owner_id, 'creator-ga-3872@example.test' FROM i3872_ga_fixture;
INSERT INTO public.creator_accounts(id, email)
SELECT owner_id, 'creator-ga-3872@example.test' FROM i3872_ga_fixture;

-- Post-replay CI already has the GA trigger. Disable ordinary triggers while
-- constructing the exact pre-migration rollout states this test replays over.
SET LOCAL session_replication_role = replica;
INSERT INTO public.brands(id, account_id, name, slug)
SELECT current_brand_id, owner_id, 'Creator GA Current', 'creator-ga-current'
FROM i3872_ga_fixture
UNION ALL
SELECT pilot_brand_id, owner_id, 'Creator GA Pilot', 'creator-ga-pilot'
FROM i3872_ga_fixture
UNION ALL
SELECT dark_brand_id, owner_id, 'Creator GA Dark', 'creator-ga-dark'
FROM i3872_ga_fixture;
INSERT INTO public.brands(id, account_id, name, slug, deleted_at)
SELECT deleted_brand_id, owner_id, 'Creator GA Deleted', 'creator-ga-deleted', now()
FROM i3872_ga_fixture;
SET LOCAL session_replication_role = origin;

INSERT INTO public.program_brand_rollouts(brand_id, program, phase)
SELECT fixture.pilot_brand_id, program, 'pilot'
FROM i3872_ga_fixture fixture
CROSS JOIN unnest(ARRAY['discounts', 'referrals', 'creator_gigs']) AS program
UNION ALL
SELECT fixture.dark_brand_id, program, 'dark'
FROM i3872_ga_fixture fixture
CROSS JOIN unnest(ARRAY['discounts', 'referrals', 'creator_gigs']) AS program;
COMMIT;

\ir ../20280206003872_issue_3872_creator_program_general_availability.sql

BEGIN;
INSERT INTO public.brands(id, account_id, name, slug)
SELECT future_brand_id, owner_id, 'Creator GA Future', 'creator-ga-future'
FROM i3872_ga_fixture;
INSERT INTO public.brands(id, account_id, name, slug, deleted_at)
SELECT restored_brand_id, owner_id, 'Creator GA Restored', 'creator-ga-restored', now()
FROM i3872_ga_fixture;
UPDATE public.brands brand
SET deleted_at = NULL
FROM i3872_ga_fixture fixture
WHERE brand.id = fixture.restored_brand_id;

UPDATE public.brands brand
SET deleted_at = clock_timestamp()
FROM i3872_ga_fixture fixture
WHERE brand.id = fixture.dark_brand_id;
UPDATE public.brands brand
SET deleted_at = NULL
FROM i3872_ga_fixture fixture
WHERE brand.id = fixture.dark_brand_id;
COMMIT;

DO $behavior$
DECLARE
  v_count integer;
  v_before record;
  v_after record;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.program_brand_rollouts rollout
  JOIN i3872_ga_fixture fixture ON rollout.brand_id IN (
    fixture.current_brand_id,
    fixture.pilot_brand_id
  )
  WHERE rollout.program IN ('discounts', 'referrals', 'creator_gigs')
    AND rollout.phase = 'ga';
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'expected six current-brand GA rollout rows, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.program_brand_rollouts rollout
  JOIN i3872_ga_fixture fixture ON rollout.brand_id = fixture.dark_brand_id
  WHERE rollout.phase = 'dark';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'explicit dark holds were overwritten: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.program_brand_rollouts rollout
  JOIN i3872_ga_fixture fixture ON rollout.brand_id = fixture.deleted_brand_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'deleted brand received % rollout rows', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM i3872_ga_flags before_state
  JOIN public.feature_flags after_state USING (flag_key)
  WHERE before_state.is_enabled IS DISTINCT FROM after_state.is_enabled;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'migration bypassed audited feature-flag authority';
  END IF;

  SELECT * INTO v_before FROM i3872_ga_local_snapshot;
  SELECT count(*)::bigint AS row_count,
    md5(COALESCE(jsonb_agg(to_jsonb(program) ORDER BY program.city_id)::text, '[]')) AS digest
  INTO v_after
  FROM public.local_city_programs program;
  IF v_before.row_count IS DISTINCT FROM v_after.row_count
    OR v_before.digest IS DISTINCT FROM v_after.digest THEN
    RAISE EXCEPTION 'migration changed Local city seats, budgets or open state';
  END IF;
END;
$behavior$;

-- Simulate the result of Admin's audited flag actions. The database gates must
-- open for GA brands, remain closed for explicit dark holds, and leave Local
-- city programs untouched.
BEGIN;
UPDATE public.feature_flags
SET is_enabled = true
WHERE flag_key IN (
  'discounts_enabled',
  'referrals_enabled',
  'creator_gigs_enabled',
  'creator_media_uploads_enabled',
  'mingla_locals_enabled'
);
COMMIT;

DO $activated$
DECLARE v_brand_id uuid;
DECLARE v_dark_brand_id uuid;
BEGIN
  SELECT current_brand_id, dark_brand_id
  INTO v_brand_id, v_dark_brand_id
  FROM i3872_ga_fixture;

  IF NOT public.issue_3872_discounts_on(v_brand_id)
    OR NOT public.issue_3872_referrals_on(v_brand_id)
    OR NOT public.issue_3872_creator_gigs_on(v_brand_id) THEN
    RAISE EXCEPTION 'GA brand gates did not open after audited flags turn on';
  END IF;

  IF public.issue_3872_discounts_on(v_dark_brand_id)
    OR public.issue_3872_referrals_on(v_dark_brand_id)
    OR public.issue_3872_creator_gigs_on(v_dark_brand_id) THEN
    RAISE EXCEPTION 'explicit dark hold opened after global flags turn on';
  END IF;

  SELECT future_brand_id INTO v_brand_id FROM i3872_ga_fixture;
  IF NOT public.issue_3872_discounts_on(v_brand_id)
    OR NOT public.issue_3872_referrals_on(v_brand_id)
    OR NOT public.issue_3872_creator_gigs_on(v_brand_id) THEN
    RAISE EXCEPTION 'future brand did not default to GA without rollout rows';
  END IF;

  SELECT restored_brand_id INTO v_brand_id FROM i3872_ga_fixture;
  IF NOT public.issue_3872_discounts_on(v_brand_id)
    OR NOT public.issue_3872_referrals_on(v_brand_id)
    OR NOT public.issue_3872_creator_gigs_on(v_brand_id) THEN
    RAISE EXCEPTION 'restored brand did not default to GA without rollout rows';
  END IF;

  SELECT deleted_brand_id INTO v_brand_id FROM i3872_ga_fixture;
  IF public.issue_3872_discounts_on(v_brand_id)
    OR public.issue_3872_referrals_on(v_brand_id)
    OR public.issue_3872_creator_gigs_on(v_brand_id) THEN
    RAISE EXCEPTION 'deleted brand inherited the default GA state';
  END IF;
END;
$activated$;

\ir ../20280206003872_issue_3872_creator_program_general_availability.sql

DO $idempotent$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.program_brand_rollouts rollout
  JOIN i3872_ga_fixture fixture ON rollout.brand_id IN (
    fixture.current_brand_id,
    fixture.pilot_brand_id,
    fixture.dark_brand_id,
    fixture.deleted_brand_id,
    fixture.future_brand_id,
    fixture.restored_brand_id
  );
  IF v_count <> 15 THEN
    RAISE EXCEPTION 'migration replay changed rollout cardinality: %', v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.program_brand_rollouts rollout
    JOIN i3872_ga_fixture fixture ON rollout.brand_id = fixture.dark_brand_id
    WHERE rollout.phase <> 'dark'
  ) THEN
    RAISE EXCEPTION 'migration replay overwrote an explicit dark hold';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.feature_flags
  WHERE flag_key IN (
    'discounts_enabled',
    'referrals_enabled',
    'creator_gigs_enabled',
    'creator_media_uploads_enabled',
    'mingla_locals_enabled'
  ) AND is_enabled;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'migration replay changed audited feature flags: % on', v_count;
  END IF;
END;
$idempotent$;

BEGIN;
UPDATE public.feature_flags flag
SET is_enabled = snapshot.is_enabled
FROM i3872_ga_flags snapshot
WHERE flag.flag_key = snapshot.flag_key;
DELETE FROM public.program_brand_rollouts rollout
USING i3872_ga_fixture fixture
WHERE rollout.brand_id IN (
  fixture.current_brand_id,
  fixture.pilot_brand_id,
  fixture.dark_brand_id,
  fixture.deleted_brand_id,
  fixture.future_brand_id,
  fixture.restored_brand_id
);
DELETE FROM public.brand_site_audit_log audit
USING i3872_ga_fixture fixture
WHERE audit.brand_id IN (
  fixture.current_brand_id,
  fixture.pilot_brand_id,
  fixture.dark_brand_id,
  fixture.deleted_brand_id,
  fixture.future_brand_id,
  fixture.restored_brand_id
);
DELETE FROM public.brand_site_entitlements entitlement
USING i3872_ga_fixture fixture
WHERE entitlement.brand_id IN (
  fixture.current_brand_id,
  fixture.pilot_brand_id,
  fixture.dark_brand_id,
  fixture.deleted_brand_id,
  fixture.future_brand_id,
  fixture.restored_brand_id
);
DELETE FROM public.brands brand
USING i3872_ga_fixture fixture
WHERE brand.id IN (
  fixture.current_brand_id,
  fixture.pilot_brand_id,
  fixture.dark_brand_id,
  fixture.deleted_brand_id,
  fixture.future_brand_id,
  fixture.restored_brand_id
);
DELETE FROM public.creator_accounts account
USING i3872_ga_fixture fixture
WHERE account.id = fixture.owner_id;
DELETE FROM auth.users user_row
USING i3872_ga_fixture fixture
WHERE user_row.id = fixture.owner_id;
COMMIT;

DROP TABLE i3872_ga_local_snapshot;
DROP TABLE i3872_ga_flags;
DROP TABLE i3872_ga_fixture;
