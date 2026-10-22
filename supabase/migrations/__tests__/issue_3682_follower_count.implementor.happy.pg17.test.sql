-- #3682 follower-count reads — implementor happy-path contract proof.
-- MINGLA-INVARIANT: I-3682-FOLLOWER-COUNT-PRIVACY | issue #3682 | Public callers may read only aggregate follower counts; scanner-or-higher brand members may read the versioned summary, and admin callers may read sortable aggregate rows. No function returns follower identity.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t3682_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION '#3682 happy FAIL: %', p_message;
  END IF;
END
$$;

SET LOCAL session_replication_role = replica;

INSERT INTO auth.users(id, email) VALUES
  ('36820000-0000-4000-8000-000000000001', 'owner-3682@example.test'),
  ('36820000-0000-4000-8000-000000000002', 'scanner-3682@example.test'),
  ('36820000-0000-4000-8000-000000000011', 'follow-1-3682@example.test'),
  ('36820000-0000-4000-8000-000000000012', 'follow-2-3682@example.test'),
  ('36820000-0000-4000-8000-000000000013', 'follow-3-3682@example.test');

INSERT INTO public.profiles(id, email, active) VALUES
  ('36820000-0000-4000-8000-000000000001', 'owner-3682@example.test', true),
  ('36820000-0000-4000-8000-000000000002', 'scanner-3682@example.test', true),
  ('36820000-0000-4000-8000-000000000011', 'follow-1-3682@example.test', true),
  ('36820000-0000-4000-8000-000000000012', 'follow-2-3682@example.test', true),
  ('36820000-0000-4000-8000-000000000013', 'follow-3-3682@example.test', true);

INSERT INTO public.creator_accounts(id, email) VALUES
  ('36820000-0000-4000-8000-000000000001', 'owner-3682@example.test');

INSERT INTO public.brands(id, account_id, name, slug) VALUES
  ('36820000-0000-4000-8000-000000000101', '36820000-0000-4000-8000-000000000001',
   'Issue 3682 Crowd', 'issue-3682-crowd'),
  ('36820000-0000-4000-8000-000000000102', '36820000-0000-4000-8000-000000000001',
   'Issue 3682 Empty', 'issue-3682-empty');

INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
  ('36820000-0000-4000-8000-000000000101', '36820000-0000-4000-8000-000000000002',
   'scanner', now());

INSERT INTO public.brand_follows(user_id, brand_id, source, created_at, muted_until) VALUES
  ('36820000-0000-4000-8000-000000000011', '36820000-0000-4000-8000-000000000101',
   'purchase', now() - interval '1 day', NULL),
  ('36820000-0000-4000-8000-000000000012', '36820000-0000-4000-8000-000000000101',
   'brand_page', now() - interval '2 days', 'infinity'),
  ('36820000-0000-4000-8000-000000000013', '36820000-0000-4000-8000-000000000101',
   'web_email', now() - interval '3 days', NULL);

SET LOCAL session_replication_role = origin;

SELECT pg_temp.t3682_assert(
  public.get_brand_follower_count('36820000-0000-4000-8000-000000000101') = 3,
  'single public count is exact');
SELECT pg_temp.t3682_assert(
  public.get_brand_follower_count('36820000-0000-4000-8000-000000000102') = 0,
  'single public count returns zero for an empty live brand');
SELECT pg_temp.t3682_assert((
  SELECT jsonb_object_agg(brand_id::text, follower_count)
  FROM public.get_brand_follower_counts(ARRAY[
    '36820000-0000-4000-8000-000000000101'::uuid,
    '36820000-0000-4000-8000-000000000102'::uuid
  ])
) = jsonb_build_object(
  '36820000-0000-4000-8000-000000000101', 3,
  '36820000-0000-4000-8000-000000000102', 0
), 'batch public count returns crowd and zero rows');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '36820000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"36820000-0000-4000-8000-000000000002","role":"authenticated"}', true);

DO $$
DECLARE
  v jsonb;
BEGIN
  v := public.biz_brand_follower_summary_v1('36820000-0000-4000-8000-000000000101');
  PERFORM pg_temp.t3682_assert(v ->> 'schemaVersion' = '1', 'summary is schema v1');
  PERFORM pg_temp.t3682_assert((v ->> 'total')::int = 3, 'summary total is exact');
  PERFORM pg_temp.t3682_assert((v ->> 'newThisWeek')::int = 3, 'summary weekly delta is exact');
  PERFORM pg_temp.t3682_assert((v #>> '{sourcesThisWeek,checkout}')::int = 1,
    'purchase source maps to checkout');
  PERFORM pg_temp.t3682_assert((v #>> '{sourcesThisWeek,brandPage}')::int = 2,
    'brand-page plus web-email sources map to brandPage');
  PERFORM pg_temp.t3682_assert((v #>> '{sourcesThisWeek,emailInvite}')::int = 0,
    'no invite rows are present');
  PERFORM pg_temp.t3682_assert((v #>> '{sourcesThisWeek,other}')::int = 0,
    'no source is lost into other');
  PERFORM pg_temp.t3682_assert(jsonb_array_length(v -> 'trend') = 7,
    'summary trend always has seven points');
  PERFORM pg_temp.t3682_assert((v -> 'trend' ->> 6)::int = 3,
    'summary trend ends at the exact total');
END
$$;

RESET ROLE;
INSERT INTO public.admin_users(email, role, status, accepted_at)
VALUES ('owner-3682@example.test', 'owner', 'active', now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '36820000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"36820000-0000-4000-8000-000000000001","role":"authenticated","email":"owner-3682@example.test"}', true);

SELECT pg_temp.t3682_assert((
  SELECT jsonb_agg(jsonb_build_array(brand_id, follower_count, new_this_week) ORDER BY brand_id)
  FROM public.admin_brand_follower_stats(ARRAY[
    '36820000-0000-4000-8000-000000000101'::uuid,
    '36820000-0000-4000-8000-000000000102'::uuid
  ])
) = jsonb_build_array(
  jsonb_build_array('36820000-0000-4000-8000-000000000101'::uuid, 3, 3),
  jsonb_build_array('36820000-0000-4000-8000-000000000102'::uuid, 0, 0)
), 'admin aggregate rows include exact totals and weekly deltas');

DO $$
DECLARE
  v jsonb;
BEGIN
  v := public.admin_list_brands_by_followers(NULL, NULL, 'live', NULL, false, 0, 100);
  PERFORM pg_temp.t3682_assert((v ->> 'total')::int >= 2, 'admin sorter returns a total');
  PERFORM pg_temp.t3682_assert(v -> 'rows' -> 0 ->> 'brandId'
    = '36820000-0000-4000-8000-000000000101',
    'admin descending sort puts the three-follower brand first');
END
$$;

RESET ROLE;
ROLLBACK;
