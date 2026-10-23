-- #3682 follower-count reads — independent tester adversarial contract proof.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t3682a_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION '#3682 adversarial FAIL: %', p_message;
  END IF;
END
$$;

-- Exercise both possible Supabase auth lifecycle keys. This suite runs as the
-- replay image's supabase_admin, and the transaction rollback leaves auth.users
-- unchanged for every later suite.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS banned_until timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

SET LOCAL session_replication_role = replica;

INSERT INTO auth.users(id, email, banned_until, deleted_at) VALUES
  ('3682a000-0000-4000-8000-000000000001', 'owner-a-3682@example.test', NULL, NULL),
  ('3682a000-0000-4000-8000-000000000002', 'stranger-a-3682@example.test', NULL, NULL),
  ('3682a000-0000-4000-8000-000000000011', 'valid-a-3682@example.test', NULL, NULL),
  ('3682a000-0000-4000-8000-000000000012', 'inactive-a-3682@example.test', NULL, NULL),
  ('3682a000-0000-4000-8000-000000000013', 'explorer-deleted-a-3682@example.test', NULL, NULL),
  ('3682a000-0000-4000-8000-000000000014', 'auth-deleted-a-3682@example.test', NULL, now()),
  ('3682a000-0000-4000-8000-000000000015', 'banned-a-3682@example.test', now() + interval '1 day', NULL),
  ('3682a000-0000-4000-8000-000000000016', 'expired-ban-a-3682@example.test', now() - interval '1 day', NULL),
  ('3682a000-0000-4000-8000-000000000017', 'pending-a-3682@example.test', NULL, NULL);

INSERT INTO public.profiles(id, email, active, explorer_deleted_at) VALUES
  ('3682a000-0000-4000-8000-000000000001', 'owner-a-3682@example.test', true, NULL),
  ('3682a000-0000-4000-8000-000000000002', 'stranger-a-3682@example.test', true, NULL),
  ('3682a000-0000-4000-8000-000000000011', 'valid-a-3682@example.test', true, NULL),
  ('3682a000-0000-4000-8000-000000000012', 'inactive-a-3682@example.test', false, NULL),
  ('3682a000-0000-4000-8000-000000000013', 'explorer-deleted-a-3682@example.test', true, now()),
  ('3682a000-0000-4000-8000-000000000014', 'auth-deleted-a-3682@example.test', true, NULL),
  ('3682a000-0000-4000-8000-000000000015', 'banned-a-3682@example.test', true, NULL),
  ('3682a000-0000-4000-8000-000000000016', 'expired-ban-a-3682@example.test', true, NULL),
  ('3682a000-0000-4000-8000-000000000017', 'pending-a-3682@example.test', true, NULL);

INSERT INTO public.creator_accounts(id, email) VALUES
  ('3682a000-0000-4000-8000-000000000001', 'owner-a-3682@example.test');

INSERT INTO public.brands(id, account_id, name, slug, deleted_at) VALUES
  ('3682a000-0000-4000-8000-000000000101', '3682a000-0000-4000-8000-000000000001',
   'Issue %_ 3682 Literal', 'issue-3682-literal', NULL),
  ('3682a000-0000-4000-8000-000000000102', '3682a000-0000-4000-8000-000000000001',
   'Issue 3682 Deleted', 'issue-3682-deleted', now());

INSERT INTO public.brand_follows(user_id, brand_id, source) VALUES
  ('3682a000-0000-4000-8000-000000000011', '3682a000-0000-4000-8000-000000000101', 'brand_page'),
  ('3682a000-0000-4000-8000-000000000012', '3682a000-0000-4000-8000-000000000101', 'brand_page'),
  ('3682a000-0000-4000-8000-000000000013', '3682a000-0000-4000-8000-000000000101', 'brand_page'),
  ('3682a000-0000-4000-8000-000000000014', '3682a000-0000-4000-8000-000000000101', 'brand_page'),
  ('3682a000-0000-4000-8000-000000000015', '3682a000-0000-4000-8000-000000000101', 'brand_page'),
  ('3682a000-0000-4000-8000-000000000016', '3682a000-0000-4000-8000-000000000101', 'brand_page');

UPDATE public.brand_follows
SET muted_until = 'infinity'
WHERE user_id = '3682a000-0000-4000-8000-000000000011'
  AND brand_id = '3682a000-0000-4000-8000-000000000101';

INSERT INTO public.brand_follow_email_pending(
  brand_id, email_normalized, kind, token_hash, user_id, expires_at
) VALUES (
  '3682a000-0000-4000-8000-000000000101', 'pending-a-3682@example.test', 'confirm',
  repeat('a', 64), '3682a000-0000-4000-8000-000000000017', now() + interval '1 day'
);

SET LOCAL session_replication_role = origin;

SELECT pg_temp.t3682a_assert(
  public.get_brand_follower_count('3682a000-0000-4000-8000-000000000101') = 2,
  'inactive, explorer-deleted, auth-deleted and currently banned accounts are excluded');
SELECT pg_temp.t3682a_assert(
  EXISTS (
    SELECT 1 FROM public.brand_follows
    WHERE user_id = '3682a000-0000-4000-8000-000000000011'
      AND muted_until = 'infinity'
  ),
  'the count includes a muted follower row');
SELECT pg_temp.t3682a_assert(
  public.get_brand_follower_count('3682a000-0000-4000-8000-000000000102') IS NULL,
  'soft-deleted brands are omitted');
SELECT pg_temp.t3682a_assert(
  public.get_brand_follower_count('3682a000-0000-4000-8000-000000000999') IS NULL,
  'unknown brands are unavailable rather than fabricated as zero');

UPDATE auth.users
SET banned_until = now() - interval '1 minute'
WHERE id = '3682a000-0000-4000-8000-000000000015';
SELECT pg_temp.t3682a_assert(
  public.get_brand_follower_count('3682a000-0000-4000-8000-000000000101') = 3,
  'an expired ban restores the same follower without a reconcile');
UPDATE auth.users
SET banned_until = now() + interval '1 day'
WHERE id = '3682a000-0000-4000-8000-000000000015';
SELECT pg_temp.t3682a_assert(
  public.get_brand_follower_count('3682a000-0000-4000-8000-000000000101') = 2,
  'a renewed current ban removes the follower again');

SELECT public.biz_auto_follow_brand(
  '3682a000-0000-4000-8000-000000000017',
  '3682a000-0000-4000-8000-000000000101',
  'web_email', NULL
);
SELECT pg_temp.t3682a_assert(
  public.get_brand_follower_count('3682a000-0000-4000-8000-000000000101') = 3,
  'a pending email row counts only after it attaches to a real follow');
UPDATE public.brand_follows
SET source = 'xyz'
WHERE user_id = '3682a000-0000-4000-8000-000000000017'
  AND brand_id = '3682a000-0000-4000-8000-000000000101';

DELETE FROM public.brand_follows
WHERE user_id = '3682a000-0000-4000-8000-000000000011'
  AND brand_id = '3682a000-0000-4000-8000-000000000101';
SELECT pg_temp.t3682a_assert(
  public.get_brand_follower_count('3682a000-0000-4000-8000-000000000101') = 2,
  'hard unfollow decrements immediately');

DO $$
BEGIN
  PERFORM public.get_brand_follower_counts(
    ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 101))
  );
  RAISE EXCEPTION 'expected 101-id batch rejection';
EXCEPTION WHEN sqlstate '22023' THEN NULL;
END
$$;

DO $$
BEGIN
  PERFORM public.get_brand_follower_counts(NULL::uuid[]);
  RAISE EXCEPTION 'expected null batch rejection';
EXCEPTION WHEN sqlstate '22023' THEN NULL;
END
$$;

DO $$
BEGIN
  PERFORM public.get_brand_follower_counts(ARRAY[]::uuid[]);
  RAISE EXCEPTION 'expected empty batch rejection';
EXCEPTION WHEN sqlstate '22023' THEN NULL;
END
$$;

SELECT pg_temp.t3682a_assert((
  SELECT count(*) = 1 AND min(follower_count) = 2
  FROM public.get_brand_follower_counts(ARRAY[
    '3682a000-0000-4000-8000-000000000101'::uuid,
    '3682a000-0000-4000-8000-000000000101'::uuid,
    '3682a000-0000-4000-8000-000000000102'::uuid
  ])
), 'batch de-duplicates ids and omits deleted brands');

SET LOCAL ROLE anon;
SELECT pg_temp.t3682a_assert(
  public.get_brand_follower_count('3682a000-0000-4000-8000-000000000101') = 2,
  'anonymous callers can read the aggregate scalar');
SELECT pg_temp.t3682a_assert((
  SELECT count(*) = 1
    AND bool_and(to_jsonb(r) ? 'brand_id')
    AND bool_and(to_jsonb(r) ? 'follower_count')
    AND bool_and(NOT (to_jsonb(r) ? 'user_id'))
  FROM public.get_brand_follower_counts(ARRAY[
    '3682a000-0000-4000-8000-000000000101'::uuid
  ]) r
), 'anonymous aggregate rows never expose user identity');

DO $$
BEGIN
  PERFORM count(*) FROM public.brand_follows;
  RAISE EXCEPTION 'expected anonymous table read denial';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$$;

DO $$
BEGIN
  PERFORM * FROM public.issue_3682_countable_followers(
    ARRAY['3682a000-0000-4000-8000-000000000101'::uuid]
  );
  RAISE EXCEPTION 'expected helper denial';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$$;

DO $$
BEGIN
  PERFORM public.biz_brand_follower_summary_v1(
    '3682a000-0000-4000-8000-000000000101'
  );
  RAISE EXCEPTION 'expected anonymous summary denial';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '3682a000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"3682a000-0000-4000-8000-000000000002","role":"authenticated","email":"stranger-a-3682@example.test"}', true);

DO $$
BEGIN
  PERFORM public.biz_brand_follower_summary_v1(
    '3682a000-0000-4000-8000-000000000101'
  );
  RAISE EXCEPTION 'expected stranger summary denial';
EXCEPTION WHEN sqlstate '42501' THEN NULL;
END
$$;

DO $$
BEGIN
  PERFORM * FROM public.admin_brand_follower_stats(
    ARRAY['3682a000-0000-4000-8000-000000000101'::uuid]
  );
  RAISE EXCEPTION 'expected non-admin stats denial';
EXCEPTION WHEN sqlstate '42501' THEN NULL;
END
$$;

DO $$
BEGIN
  PERFORM public.admin_list_brands_by_followers(
    NULL, NULL, NULL, NULL, false, 0, 10
  );
  RAISE EXCEPTION 'expected non-admin sorter denial';
EXCEPTION WHEN sqlstate '42501' THEN NULL;
END
$$;

RESET ROLE;
INSERT INTO public.admin_users(email, role, status, accepted_at)
VALUES ('owner-a-3682@example.test', 'owner', 'active', now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '3682a000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"3682a000-0000-4000-8000-000000000001","role":"authenticated","email":"owner-a-3682@example.test"}', true);

DO $$
DECLARE
  v jsonb;
BEGIN
  v := public.biz_brand_follower_summary_v1(
    '3682a000-0000-4000-8000-000000000101'
  );
  PERFORM pg_temp.t3682a_assert((v ->> 'total')::int = 2,
    'owner summary sees the two current eligible followers');
  PERFORM pg_temp.t3682a_assert((v #>> '{sourcesThisWeek,other}')::int = 1,
    'an arbitrary source is classified as other');
  PERFORM pg_temp.t3682a_assert(
    (v #>> '{sourcesThisWeek,brandPage}')::int
      + (v #>> '{sourcesThisWeek,other}')::int
      = (v ->> 'newThisWeek')::int,
    'weekly source buckets still sum to the weekly total');
END
$$;

DO $$
BEGIN
  PERFORM public.biz_brand_follower_summary_v1(
    '3682a000-0000-4000-8000-000000000102'
  );
  RAISE EXCEPTION 'expected deleted-brand summary denial';
EXCEPTION WHEN sqlstate '42501' THEN NULL;
END
$$;

DO $$
DECLARE
  v jsonb;
BEGIN
  v := public.admin_list_brands_by_followers('%_', NULL, NULL, NULL, false, 0, 10);
  PERFORM pg_temp.t3682a_assert((v ->> 'total')::int = 1,
    'admin search treats percent and underscore as literals');
  PERFORM pg_temp.t3682a_assert(v -> 'rows' -> 0 ->> 'brandId'
    = '3682a000-0000-4000-8000-000000000101',
    'literal-pattern search returns the intended brand');
END
$$;

RESET ROLE;

DELETE FROM public.profiles
WHERE id = '3682a000-0000-4000-8000-000000000017';
SELECT pg_temp.t3682a_assert(
  public.get_brand_follower_count('3682a000-0000-4000-8000-000000000101') = 1,
  'hard-deleting a profile cascades its follow row away');

ROLLBACK;
