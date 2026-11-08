\set ON_ERROR_STOP on
-- #4318: independent tester attack on the /links data layer (PostgreSQL 17).
-- Different angles from the implementor proof:
--
-- D  direct table writes (insert, update, delete) by anon, by a signed-in
--    outsider and by Support staff themselves: only the RPCs may write.
-- P  what anon can read straight from the table: never created_by, never a
--    whole row, never an unpublished or expired strip.
-- B  blog strips: a draft, soft-deleted, scheduled or taken-down post is
--    refused at save and hidden from the reader; a hard-deleted post leaves a
--    strip the reader hides.
-- U  URL injection: javascript:, data:, bare and doubled schemes, spaces and
--    control characters are refused by the RPC and by the table itself.
-- T  titles: 61 characters, and titles made only of whitespace of any kind.
-- O  reorder: duplicates, a stranger, an empty or NULL list, a NULL element;
--    an outsider gets "forbidden" before any set check; an empty table accepts
--    the empty list.
-- C  concurrency: every writer takes the same ordering lock.
-- W  links_page_week(): the 7-day edge, an in-progress date, a time zone
--    fallback and local midnight, a recurring series whose master date is
--    cancelled, a soft-deleted brand, private/hidden/discover/draft/ended
--    listings, a sold-out date, and no column or private address beyond the
--    contract.
-- PL links_page_places(): closed, inactive, unservable, deleted and
--    photo-less places stay hidden; limit and radius are capped; bad
--    coordinates return nothing; no address or private column leaks.
-- Runs after the full migration replay; every fixture rolls back.
BEGIN;

CREATE FUNCTION pg_temp.t4318_act(p_user uuid) RETURNS void LANGUAGE sql AS $function$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true),
         set_config(
           'request.jwt.claims',
           CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END,
           true
         );
$function$;
GRANT EXECUTE ON FUNCTION pg_temp.t4318_act(uuid) TO anon, authenticated;

-- Expect a statement to fail with an SQLSTATE; returns the message.
CREATE FUNCTION pg_temp.t4318_expect(p_sql text, p_state text) RETURNS text LANGUAGE plpgsql AS $function$
DECLARE
  v_state text;
  v_message text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM p_state THEN
    RAISE EXCEPTION 'expected % from [%], got % (%)', p_state, p_sql, COALESCE(v_state, 'success'), v_message;
  END IF;
  RETURN v_message;
END;
$function$;
GRANT EXECUTE ON FUNCTION pg_temp.t4318_expect(text, text) TO anon, authenticated;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

-- ── People ────────────────────────────────────────────────────────────────
-- 1 outsider, 2 Support staff, 3 host, 4 disabled Support staff.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('4318a000-0000-4000-a000-000000000001', 't4318-outsider@test.local', now()),
  ('4318a000-0000-4000-a000-000000000002', 't4318-support@test.local', now()),
  ('4318a000-0000-4000-a000-000000000003', 't4318-host@test.local', now()),
  ('4318a000-0000-4000-a000-000000000004', 't4318-disabled@test.local', now());
INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('t4318-support@test.local', 'growth', 'active', now()),
  ('t4318-disabled@test.local', 'growth', 'active', now());
INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('4318a000-0000-4000-a000-000000000002', true, false, 'staff'),
  ('4318a000-0000-4000-a000-000000000004', false, false, 'staff');

-- ── Blog posts: public, draft, soft-deleted, scheduled, taken down ────────
INSERT INTO public.blog_posts (id, slug, category_slug, status, publish_at, first_published_at, created_by) VALUES
  ('4318a000-0000-4000-b000-000000000001', 't4318-public', 'going-out', 'draft', now() - interval '1 day', now() - interval '1 day', '4318a000-0000-4000-a000-000000000002'),
  ('4318a000-0000-4000-b000-000000000002', 't4318-draft', 'going-out', 'draft', NULL, NULL, '4318a000-0000-4000-a000-000000000002'),
  ('4318a000-0000-4000-b000-000000000003', 't4318-deleted', 'going-out', 'draft', now() - interval '1 day', now() - interval '1 day', '4318a000-0000-4000-a000-000000000002'),
  ('4318a000-0000-4000-b000-000000000004', 't4318-scheduled', 'going-out', 'draft', now() + interval '3 days', NULL, '4318a000-0000-4000-a000-000000000002'),
  ('4318a000-0000-4000-b000-000000000005', 't4318-taken-down', 'going-out', 'draft', now() - interval '3 days', now() - interval '3 days', '4318a000-0000-4000-a000-000000000002'),
  ('4318a000-0000-4000-b000-000000000006', 't4318-doomed', 'going-out', 'draft', now() - interval '1 day', now() - interval '1 day', '4318a000-0000-4000-a000-000000000002');
INSERT INTO public.blog_post_versions (id, post_id, kind, title, document, created_by)
SELECT ('4318a000-0000-4000-b100-00000000000' || n)::uuid, ('4318a000-0000-4000-b000-00000000000' || n)::uuid,
       'published', 'Tester post ' || n, '{"version":1,"blocks":[]}', '4318a000-0000-4000-a000-000000000002'
FROM generate_series(1, 6) AS n WHERE n <> 2;
UPDATE public.blog_posts SET status = 'published', published_version_id = ('4318a000-0000-4000-b100-00000000000' || right(id::text, 1))::uuid
  WHERE id IN ('4318a000-0000-4000-b000-000000000001', '4318a000-0000-4000-b000-000000000003',
               '4318a000-0000-4000-b000-000000000004', '4318a000-0000-4000-b000-000000000005',
               '4318a000-0000-4000-b000-000000000006');
UPDATE public.blog_posts SET deleted_at = now() WHERE id = '4318a000-0000-4000-b000-000000000003';
UPDATE public.blog_posts SET take_down_mode = 'at', take_down_at = now() - interval '1 hour' WHERE id = '4318a000-0000-4000-b000-000000000005';

-- ── Strips written as the owner, for the read attacks ────────────────────
-- Other suites' rows are irrelevant: everything below filters on these ids.
INSERT INTO public.links_strips (id, shows_on, title, label, opens, url, blog_post_id, position, is_published, created_by) VALUES
  ('4318a000-0000-4000-9000-000000000001', (now() AT TIME ZONE 'utc')::date, 'T live', 'New', 'host', NULL, NULL, 1, true, '4318a000-0000-4000-a000-000000000002'),
  ('4318a000-0000-4000-9000-000000000002', (now() AT TIME ZONE 'utc')::date + 3, 'T unpublished', 'New', 'host', NULL, NULL, 2, false, '4318a000-0000-4000-a000-000000000002'),
  ('4318a000-0000-4000-9000-000000000003', (now() AT TIME ZONE 'utc')::date - 30, 'T long expired', 'New', 'explorer', NULL, NULL, 3, true, '4318a000-0000-4000-a000-000000000002'),
  ('4318a000-0000-4000-9000-000000000004', (now() AT TIME ZONE 'utc')::date + 1, 'T deleted post', 'Featured', 'blog', NULL, '4318a000-0000-4000-b000-000000000003', 4, true, NULL),
  ('4318a000-0000-4000-9000-000000000005', (now() AT TIME ZONE 'utc')::date + 1, 'T scheduled post', 'Featured', 'blog', NULL, '4318a000-0000-4000-b000-000000000004', 5, true, NULL),
  ('4318a000-0000-4000-9000-000000000006', (now() AT TIME ZONE 'utc')::date + 1, 'T taken-down post', 'Featured', 'blog', NULL, '4318a000-0000-4000-b000-000000000005', 6, true, NULL),
  ('4318a000-0000-4000-9000-000000000007', (now() AT TIME ZONE 'utc')::date + 1, 'T public post', 'Featured', 'blog', NULL, '4318a000-0000-4000-b000-000000000001', 7, true, NULL);

-- ═══ D: nobody writes the table directly ═════════════════════════════════
SET LOCAL ROLE anon;
SELECT pg_temp.t4318_expect(sql, '42501') FROM unnest(ARRAY[
  $$INSERT INTO public.links_strips (shows_on, title, label, opens, position) VALUES (current_date, 'x', 'New', 'host', 0)$$,
  $$UPDATE public.links_strips SET title = 'owned' WHERE id = '4318a000-0000-4000-9000-000000000001'$$,
  $$UPDATE public.links_strips SET is_published = true$$,
  $$DELETE FROM public.links_strips WHERE id = '4318a000-0000-4000-9000-000000000001'$$,
  $$TRUNCATE public.links_strips$$
]) AS probe(sql);
RESET ROLE;

-- The outsider and Support staff alike: the table has no write grant at all.
DO $test$
DECLARE
  v_person uuid;
  v_sql text;
BEGIN
  FOREACH v_person IN ARRAY ARRAY['4318a000-0000-4000-a000-000000000001'::uuid, '4318a000-0000-4000-a000-000000000002'::uuid] LOOP
    PERFORM pg_temp.t4318_act(v_person);
    SET LOCAL ROLE authenticated;
    FOREACH v_sql IN ARRAY ARRAY[
      $$INSERT INTO public.links_strips (shows_on, title, label, opens, position) VALUES (current_date, 'x', 'New', 'host', 0)$$,
      $$UPDATE public.links_strips SET position = -999 WHERE id = '4318a000-0000-4000-9000-000000000001'$$,
      $$UPDATE public.links_strips SET is_published = true WHERE id = '4318a000-0000-4000-9000-000000000002'$$,
      $$DELETE FROM public.links_strips WHERE id = '4318a000-0000-4000-9000-000000000001'$$
    ] LOOP
      PERFORM pg_temp.t4318_expect(v_sql, '42501');
    END LOOP;
    RESET ROLE;
  END LOOP;
  IF (SELECT position FROM public.links_strips WHERE id = '4318a000-0000-4000-9000-000000000001') <> 1
     OR (SELECT is_published FROM public.links_strips WHERE id = '4318a000-0000-4000-9000-000000000002') THEN
    RAISE EXCEPTION 'D: a direct write changed a strip';
  END IF;
END
$test$;

-- A disabled Support staff member is an outsider to every RPC.
SELECT pg_temp.t4318_act('4318a000-0000-4000-a000-000000000004');
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF pg_temp.t4318_expect('SELECT public.admin_links_strips_list()', '42501') <> 'links_forbidden'
     OR pg_temp.t4318_expect($$SELECT public.admin_links_strip_save(NULL, current_date, 'x', 'New', 'host', NULL, NULL)$$, '42501') <> 'links_forbidden'
     OR pg_temp.t4318_expect($$SELECT public.admin_links_strip_delete('4318a000-0000-4000-9000-000000000001')$$, '42501') <> 'links_forbidden' THEN
    RAISE EXCEPTION 'D: a disabled Support member got past the guard';
  END IF;
  -- Forbidden comes before the set check: an outsider learns nothing about
  -- how many strips exist from the reorder error.
  IF pg_temp.t4318_expect('SELECT public.admin_links_strips_reorder(ARRAY[]::uuid[])', '42501') <> 'links_forbidden'
     OR pg_temp.t4318_expect('SELECT public.admin_links_strips_reorder(NULL)', '42501') <> 'links_forbidden' THEN
    RAISE EXCEPTION 'D: reorder answered a non-member with a set error';
  END IF;
END
$test$;
RESET ROLE;

-- ═══ P: what anon reads straight from the table ══════════════════════════
SELECT pg_temp.t4318_act(NULL);
SET LOCAL ROLE anon;
DO $test$
DECLARE
  v_ids uuid[];
BEGIN
  PERFORM pg_temp.t4318_expect('SELECT created_by FROM public.links_strips', '42501');
  PERFORM pg_temp.t4318_expect('SELECT created_at, updated_at FROM public.links_strips', '42501');
  PERFORM pg_temp.t4318_expect('SELECT * FROM public.links_strips', '42501');

  SELECT array_agg(strip.id ORDER BY strip.id) INTO v_ids FROM public.links_strips strip
  WHERE strip.id::text LIKE '4318a000-%' AND strip.id IN (
    '4318a000-0000-4000-9000-000000000002', '4318a000-0000-4000-9000-000000000003');
  IF v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'P: anon read an unpublished or expired strip from the table: %', v_ids;
  END IF;
  -- A filter on is_published = false cannot widen the policy.
  IF EXISTS (SELECT 1 FROM public.links_strips strip WHERE NOT strip.is_published) THEN
    RAISE EXCEPTION 'P: anon saw an unpublished row';
  END IF;

  SELECT array_agg(strip.id ORDER BY strip.position) INTO v_ids FROM public.links_page_strips() strip
  WHERE strip.id::text LIKE '4318a000-%';
  IF v_ids IS DISTINCT FROM ARRAY['4318a000-0000-4000-9000-000000000001', '4318a000-0000-4000-9000-000000000007']::uuid[] THEN
    RAISE EXCEPTION 'P/B: public reader returned %, want only the live strip and the public-post strip', v_ids;
  END IF;
  IF (SELECT strip.blog_slug FROM public.links_page_strips() strip WHERE strip.id = '4318a000-0000-4000-9000-000000000007') <> 't4318-public' THEN
    RAISE EXCEPTION 'P/B: the public-post strip lost its slug';
  END IF;
  IF EXISTS (SELECT 1 FROM public.links_page_strips() strip WHERE strip.blog_slug IN ('t4318-deleted', 't4318-scheduled', 't4318-taken-down', 't4318-draft')) THEN
    RAISE EXCEPTION 'P/B: a non-public post slug reached the public reader';
  END IF;
END
$test$;
RESET ROLE;

-- ═══ B: blog strips via the RPC ══════════════════════════════════════════
SELECT pg_temp.t4318_act('4318a000-0000-4000-a000-000000000002');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_post uuid;
  v_row public.links_strips;
BEGIN
  FOREACH v_post IN ARRAY ARRAY[
    '4318a000-0000-4000-b000-000000000002', '4318a000-0000-4000-b000-000000000003',
    '4318a000-0000-4000-b000-000000000004', '4318a000-0000-4000-b000-000000000005',
    '4318a000-0000-4000-b000-0000000000ff', NULL]::uuid[] LOOP
    IF pg_temp.t4318_expect(format(
         $$SELECT public.admin_links_strip_save(NULL, current_date, 'Read this', 'New', 'blog', NULL, %L)$$, v_post),
         'P0001') <> 'links_blog_post_invalid' THEN
      RAISE EXCEPTION 'B: a blog strip was saved on post %', v_post;
    END IF;
  END LOOP;

  -- Editing a strip so it points at a hidden post is refused too.
  IF pg_temp.t4318_expect(
       $$SELECT public.admin_links_strip_save('4318a000-0000-4000-9000-000000000007', current_date, 'Read this', 'New', 'blog', NULL, '4318a000-0000-4000-b000-000000000004')$$,
       'P0001') <> 'links_blog_post_invalid' THEN
    RAISE EXCEPTION 'B: a strip was re-pointed at a scheduled post';
  END IF;

  -- A real post: saved, then the post is hard-deleted below.
  v_row := public.admin_links_strip_save(NULL, (now() AT TIME ZONE 'utc')::date, 'Doomed post', 'New', 'blog',
                                         'usemingla.com/ignored', '4318a000-0000-4000-b000-000000000006');
  IF v_row.url IS NOT NULL OR v_row.blog_post_id <> '4318a000-0000-4000-b000-000000000006' THEN
    RAISE EXCEPTION 'B: a blog strip kept a URL or lost its post: %', to_jsonb(v_row);
  END IF;
  PERFORM set_config('t4318.doomed_strip', v_row.id::text, true);
END
$test$;
RESET ROLE;

DELETE FROM public.blog_posts WHERE id = '4318a000-0000-4000-b000-000000000006';

SET LOCAL ROLE anon;
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.links_page_strips() strip WHERE strip.id = current_setting('t4318.doomed_strip')::uuid) THEN
    RAISE EXCEPTION 'B: a strip whose post was deleted is still public';
  END IF;
END
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.admin_links_strips_list() strip WHERE strip.id = current_setting('t4318.doomed_strip')::uuid;
  IF v_row.id IS NULL OR v_row.blog_post_id IS NOT NULL OR v_row.blog_is_public IS NOT FALSE OR v_row.opens <> 'blog' THEN
    RAISE EXCEPTION 'B: staff list does not show the orphaned blog strip honestly: %', to_jsonb(v_row);
  END IF;
  -- Its siblings with hidden posts are listed for staff as not public.
  IF EXISTS (SELECT 1 FROM public.admin_links_strips_list() strip
             WHERE strip.id IN ('4318a000-0000-4000-9000-000000000004', '4318a000-0000-4000-9000-000000000005',
                                '4318a000-0000-4000-9000-000000000006') AND strip.blog_is_public) THEN
    RAISE EXCEPTION 'B: staff list calls a hidden post public';
  END IF;
END
$test$;
RESET ROLE;

-- ═══ U: URL injection ═════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_bad text;
  v_case record;
  v_row public.links_strips;
BEGIN
  FOREACH v_bad IN ARRAY ARRAY[
    'javascript:alert(1)', 'JavaScript:alert(document.cookie)', 'javascript://usemingla.com/%0Aalert(1)',
    'https://javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)',
    'mailto:a@usemingla.com', 'ftp://usemingla.com/x', '//evil.example.com/x', 'https://', 'http://', 'https:',
    'https:///evil.example.com', 'https://https://evil.example.com', 'usemingla', '.com', 'usemingla.com /x',
    'usemingla.com/a b', E'usemingla.com/x\nSet-Cookie:a=b', E'usemingla.com/\tx', 'user@evil.example.com',
    'usemingla.com@evil.example.com', 'usemingla.com\@evil.example.com', '   ', ''
  ] LOOP
    IF pg_temp.t4318_expect(format(
         $$SELECT public.admin_links_strip_save(NULL, current_date, 'Web', 'New', 'web', %L, NULL)$$, v_bad),
         'P0001') <> 'links_url_invalid' THEN
      RAISE EXCEPTION 'U: % was accepted', v_bad;
    END IF;
  END LOOP;

  FOR v_case IN SELECT * FROM (VALUES
    ('HTTPS://UseMingla.com/Host', 'UseMingla.com/Host'),
    ('  http://usemingla.com  ', 'usemingla.com'),
    ('usemingla.com/links?src=bio#top', 'usemingla.com/links?src=bio#top'),
    ('blog.usemingla.com/a-b_c/%20', 'blog.usemingla.com/a-b_c/%20')
  ) AS t(given, stored) LOOP
    v_row := public.admin_links_strip_save(NULL, (now() AT TIME ZONE 'utc')::date, 'Web', 'New', 'web', v_case.given, NULL);
    IF v_row.url IS DISTINCT FROM v_case.stored THEN
      RAISE EXCEPTION 'U: % stored as %, want %', v_case.given, v_row.url, v_case.stored;
    END IF;
  END LOOP;

  -- An app strip never stores a URL, whatever is sent.
  v_row := public.admin_links_strip_save(NULL, (now() AT TIME ZONE 'utc')::date, 'App', 'New', 'explorer', 'javascript:alert(1)', '4318a000-0000-4000-b000-000000000001');
  IF v_row.url IS NOT NULL OR v_row.blog_post_id IS NOT NULL THEN
    RAISE EXCEPTION 'U: an app strip kept a URL or post: %', to_jsonb(v_row);
  END IF;
END
$test$;
RESET ROLE;

-- The table itself refuses a scheme or script even from the owner.
DO $test$
DECLARE
  v_bad text;
BEGIN
  FOREACH v_bad IN ARRAY ARRAY['javascript:alert(1)', 'https://usemingla.com', 'usemingla.com/a b', 'data:text/html,x'] LOOP
    PERFORM pg_temp.t4318_expect(format(
      $$INSERT INTO public.links_strips (shows_on, title, label, opens, url, position) VALUES (current_date, 'x', 'New', 'web', %L, 0)$$, v_bad),
      '23514');
  END LOOP;
  -- A web strip with no URL, and an app strip with one, break the opens rule.
  PERFORM pg_temp.t4318_expect(
    $$INSERT INTO public.links_strips (shows_on, title, label, opens, url, position) VALUES (current_date, 'x', 'New', 'web', NULL, 0)$$, '23514');
  PERFORM pg_temp.t4318_expect(
    $$INSERT INTO public.links_strips (shows_on, title, label, opens, url, position) VALUES (current_date, 'x', 'New', 'host', 'usemingla.com', 0)$$, '23514');
END
$test$;

-- ═══ T: titles ════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_bad text;
  v_row public.links_strips;
BEGIN
  FOREACH v_bad IN ARRAY ARRAY[
    repeat('a', 61), '  ' || repeat('a', 61) || '  ', '   ', '',
    -- Whitespace that is not a plain space: tab, newline, carriage return,
    -- no-break space, ideographic space. A strip with an invisible title is
    -- still a strip with no title.
    E'\t', E'\n\n', E' \r\n ', E'\u00a0', E'\u3000', E'\t\u00a0 '
  ] LOOP
    IF pg_temp.t4318_expect(format(
         $$SELECT public.admin_links_strip_save(NULL, current_date, %L, 'New', 'host', NULL, NULL)$$, v_bad),
         'P0001') <> 'links_title_invalid' THEN
      RAISE EXCEPTION 'T: title % was accepted', to_jsonb(v_bad);
    END IF;
  END LOOP;
  PERFORM pg_temp.t4318_expect($$SELECT public.admin_links_strip_save(NULL, current_date, NULL, 'New', 'host', NULL, NULL)$$, 'P0001');

  -- Exactly 60 characters, counted as characters not bytes, after trimming.
  v_row := public.admin_links_strip_save(NULL, (now() AT TIME ZONE 'utc')::date, '   ' || repeat('é', 60) || '   ', 'New', 'host', NULL, NULL);
  IF v_row.title <> repeat('é', 60) THEN
    RAISE EXCEPTION 'T: a 60-character title was not stored trimmed: %', v_row.title;
  END IF;
END
$test$;
RESET ROLE;

-- ═══ O: reorder ═══════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_all uuid[];
  v_bad uuid[];
  v_n int;
BEGIN
  SELECT array_agg(strip.id ORDER BY strip.position, strip.created_at, strip.id) INTO v_all FROM public.admin_links_strips_list() strip;
  v_n := cardinality(v_all);
  IF v_n < 3 THEN RAISE EXCEPTION 'O: fixture too small (%)', v_n; END IF;

  FOREACH v_bad SLICE 1 IN ARRAY ARRAY[
    -- same length, one id twice and one missing
    v_all[1:v_n - 1] || v_all[1],
    -- same length, a stranger in place of a real strip
    v_all[1:v_n - 1] || '4318a000-0000-4000-9000-0000000000ff'::uuid,
    -- a NULL in place of a real strip
    v_all[1:v_n - 1] || NULL::uuid
  ] LOOP
    IF pg_temp.t4318_expect(format('SELECT public.admin_links_strips_reorder(%L::uuid[])', v_bad), 'PT409') <> 'links_strips_stale' THEN
      RAISE EXCEPTION 'O: reorder accepted %', v_bad;
    END IF;
  END LOOP;
  PERFORM pg_temp.t4318_expect('SELECT public.admin_links_strips_reorder(ARRAY[]::uuid[])', 'PT409');
  PERFORM pg_temp.t4318_expect('SELECT public.admin_links_strips_reorder(NULL)', 'PT409');
  PERFORM pg_temp.t4318_expect(format('SELECT public.admin_links_strips_reorder(%L::uuid[])', v_all || v_all[1]), 'PT409');

  -- Nothing moved after all those refusals.
  IF (SELECT array_agg(strip.id ORDER BY strip.position, strip.created_at, strip.id) FROM public.admin_links_strips_list() strip) IS DISTINCT FROM v_all THEN
    RAISE EXCEPTION 'O: a refused reorder changed the order';
  END IF;

  -- The reverse order applies, with distinct 1-based positions.
  SELECT array_agg(id ORDER BY ord DESC) INTO v_bad FROM unnest(v_all) WITH ORDINALITY AS t(id, ord);
  PERFORM public.admin_links_strips_reorder(v_bad);
  IF (SELECT array_agg(strip.id ORDER BY strip.position) FROM public.admin_links_strips_list() strip) IS DISTINCT FROM v_bad
     OR (SELECT count(DISTINCT strip.position) FROM public.admin_links_strips_list() strip) <> v_n
     OR (SELECT min(strip.position) FROM public.admin_links_strips_list() strip) <> 1 THEN
    RAISE EXCEPTION 'O: the reversed order did not apply';
  END IF;

  -- A new strip goes above position 1, so the page and the list agree.
  PERFORM public.admin_links_strip_save(NULL, (now() AT TIME ZONE 'utc')::date, 'Newest', 'New', 'host', NULL, NULL);
  IF (SELECT strip.title FROM public.admin_links_strips_list() strip ORDER BY strip.position, strip.created_at, strip.id LIMIT 1) <> 'Newest' THEN
    RAISE EXCEPTION 'O: a strip saved after a reorder is not on top';
  END IF;
END
$test$;
RESET ROLE;

-- With no strips at all, the empty list is the exact current set.
DELETE FROM public.links_strips;
SET LOCAL ROLE authenticated;
SELECT public.admin_links_strips_reorder(ARRAY[]::uuid[]);
SELECT pg_temp.t4318_expect($$SELECT public.admin_links_strips_reorder(ARRAY['4318a000-0000-4000-9000-000000000001']::uuid[])$$, 'PT409');
DO $test$
DECLARE
  v_row public.links_strips;
BEGIN
  v_row := public.admin_links_strip_save(NULL, (now() AT TIME ZONE 'utc')::date, 'First ever', 'New', 'host', NULL, NULL);
  IF v_row.position <> 0 THEN RAISE EXCEPTION 'O: the first strip on an empty page got position %', v_row.position; END IF;
END
$test$;
RESET ROLE;

-- ═══ C: concurrent writers serialise on one lock ══════════════════════════
-- Two saves computing min(position) - 1 at once would both take the same
-- slot; a reorder racing a save would validate a set that is already stale.
-- Each writer must take the same transaction lock before reading the set.
DO $test$
DECLARE
  v_fn text;
  v_src text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_links_strip_save(uuid,date,text,text,text,text,uuid,date)',
    'public.admin_links_strip_delete(uuid)',
    'public.admin_links_strips_reorder(uuid[])'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn::regprocedure;
    IF position('pg_advisory_xact_lock(hashtext(''issue_4318_links_strips_order''))' IN v_src) = 0 THEN
      RAISE EXCEPTION 'C: % does not take the shared ordering lock', v_fn;
    END IF;
    -- The lock precedes the set read in reorder and the min() read in save.
    IF v_fn LIKE '%reorder%' AND position('pg_advisory_xact_lock' IN v_src) > position('cardinality(p_ids)' IN v_src) THEN
      RAISE EXCEPTION 'C: reorder reads the set before taking the lock';
    END IF;
    IF v_fn LIKE '%save%' AND position('pg_advisory_xact_lock' IN v_src) > position('min(existing.position)' IN v_src) THEN
      RAISE EXCEPTION 'C: save reads min(position) before taking the lock';
    END IF;
    IF (SELECT provolatile FROM pg_proc WHERE oid = v_fn::regprocedure) <> 'v' THEN
      RAISE EXCEPTION 'C: % is not VOLATILE', v_fn;
    END IF;
  END LOOP;
END
$test$;

-- ═══ W: links_page_week() ═════════════════════════════════════════════════
INSERT INTO public.creator_accounts (id) VALUES ('4318a000-0000-4000-a000-000000000003');
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('4318a000-0000-4000-c000-000000000001', '4318a000-0000-4000-a000-000000000003', 'T4318 Live', 't4318-live', 'USD', now(), now()),
  ('4318a000-0000-4000-c000-000000000002', '4318a000-0000-4000-a000-000000000003', 'T4318 Gone', 't4318-gone', 'USD', now(), now());

-- Events. Shown addresses unless named otherwise.
--  edge     dates at the 7-day boundary, in progress, and just ended
--  tz       date zone empty (falls back to the event zone), one at Auckland local midnight
--  series   recurring: master date cancelled, two live dates
--  private/hidden/discover/draftvis/ended  never listed
--  soldout  one capped tier, sold out
--  withheld address withheld: no place text, coarse point
--  gone     on the soft-deleted brand
INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, city, location_text, location_geo, party_types, rsvp_approval_mode, rsvp_discoverable, theme,
  created_at, updated_at)
SELECT ('4318a000-0000-4000-d000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       CASE WHEN slug = 'gone' THEN '4318a000-0000-4000-c000-000000000002' ELSE '4318a000-0000-4000-c000-000000000001' END::uuid,
       '4318a000-0000-4000-a000-000000000003', 'event', 'T4318 ' || slug, 't4318-' || slug, status, visibility, 'USD',
       'Africa/Lagos', 'Lagos',
       CASE WHEN slug IN ('edge', 'tz', 'series') THEN 'T4318 Open Hall' ELSE 'SECRET-4318-' || upper(slug) || ' 9 Hidden Rd' END, point(3.4219, 6.4281), '{}', 'auto', false,
       CASE WHEN slug = 'withheld' THEN '{}'::jsonb ELSE '{"business_event":{"hideAddressUntilTicket":false}}'::jsonb END,
       now(), now()
FROM (VALUES
  (1, 'edge', 'scheduled', 'public'), (2, 'tz', 'scheduled', 'public'), (3, 'series', 'live', 'public'),
  (4, 'private', 'scheduled', 'private'), (5, 'hidden', 'scheduled', 'hidden'), (6, 'discover', 'scheduled', 'discover'),
  (7, 'draftvis', 'scheduled', 'draft'), (8, 'ended', 'ended', 'public'), (9, 'soldout', 'scheduled', 'public'),
  (10, 'withheld', 'scheduled', 'public'), (11, 'gone', 'scheduled', 'public')
) AS t(n, slug, status, visibility);

INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master, cancelled_at) VALUES
  -- edge: in (starts one minute before the edge), out (starts on the edge),
  -- in (started an hour ago, still running), out (ended a minute ago)
  ('4318a000-0000-4000-e000-000000000101', '4318a000-0000-4000-d000-000000000001', now() + interval '7 days' - interval '1 minute', now() + interval '7 days 2 hours', 'Africa/Lagos', true, NULL),
  ('4318a000-0000-4000-e000-000000000102', '4318a000-0000-4000-d000-000000000001', now() + interval '7 days', now() + interval '7 days 2 hours', 'Africa/Lagos', false, NULL),
  ('4318a000-0000-4000-e000-000000000103', '4318a000-0000-4000-d000-000000000001', now() - interval '1 hour', now() + interval '1 hour', 'Africa/Lagos', false, NULL),
  ('4318a000-0000-4000-e000-000000000104', '4318a000-0000-4000-d000-000000000001', now() - interval '3 hours', now() - interval '1 minute', 'Africa/Lagos', false, NULL),
  -- tz: one with an empty zone, one at Auckland local midnight two days on
  ('4318a000-0000-4000-e000-000000000201', '4318a000-0000-4000-d000-000000000002', now() + interval '1 day', now() + interval '1 day 2 hours', '', true, NULL),
  ('4318a000-0000-4000-e000-000000000202', '4318a000-0000-4000-d000-000000000002',
     ((date_trunc('day', now() AT TIME ZONE 'Pacific/Auckland') + interval '2 days') AT TIME ZONE 'Pacific/Auckland'),
     ((date_trunc('day', now() AT TIME ZONE 'Pacific/Auckland') + interval '2 days 3 hours') AT TIME ZONE 'Pacific/Auckland'),
     'Pacific/Auckland', false, NULL),
  -- series: master cancelled, two live dates, and a third cancelled
  ('4318a000-0000-4000-e000-000000000301', '4318a000-0000-4000-d000-000000000003', now() + interval '1 day', now() + interval '1 day 2 hours', 'Africa/Lagos', true, now()),
  ('4318a000-0000-4000-e000-000000000302', '4318a000-0000-4000-d000-000000000003', now() + interval '2 days', now() + interval '2 days 2 hours', 'Africa/Lagos', false, NULL),
  ('4318a000-0000-4000-e000-000000000303', '4318a000-0000-4000-d000-000000000003', now() + interval '3 days', now() + interval '3 days 2 hours', 'Africa/Lagos', false, NULL),
  ('4318a000-0000-4000-e000-000000000304', '4318a000-0000-4000-d000-000000000003', now() + interval '4 days', now() + interval '4 days 2 hours', 'Africa/Lagos', false, now()),
  ('4318a000-0000-4000-e000-000000000401', '4318a000-0000-4000-d000-000000000004', now() + interval '2 days', now() + interval '2 days 2 hours', 'Africa/Lagos', true, NULL),
  ('4318a000-0000-4000-e000-000000000501', '4318a000-0000-4000-d000-000000000005', now() + interval '2 days', now() + interval '2 days 2 hours', 'Africa/Lagos', true, NULL),
  ('4318a000-0000-4000-e000-000000000601', '4318a000-0000-4000-d000-000000000006', now() + interval '2 days', now() + interval '2 days 2 hours', 'Africa/Lagos', true, NULL),
  ('4318a000-0000-4000-e000-000000000701', '4318a000-0000-4000-d000-000000000007', now() + interval '2 days', now() + interval '2 days 2 hours', 'Africa/Lagos', true, NULL),
  ('4318a000-0000-4000-e000-000000000801', '4318a000-0000-4000-d000-000000000008', now() + interval '2 days', now() + interval '2 days 2 hours', 'Africa/Lagos', true, NULL),
  ('4318a000-0000-4000-e000-000000000901', '4318a000-0000-4000-d000-000000000009', now() + interval '2 days', now() + interval '2 days 2 hours', 'Africa/Lagos', true, NULL),
  ('4318a000-0000-4000-e000-000000001001', '4318a000-0000-4000-d000-000000000010', now() + interval '2 days', now() + interval '2 days 2 hours', 'Africa/Lagos', true, NULL),
  ('4318a000-0000-4000-e000-000000001101', '4318a000-0000-4000-d000-000000000011', now() + interval '2 days', now() + interval '2 days 2 hours', 'Africa/Lagos', true, NULL);

-- soldout: its only online tier is free, capped at 1, and taken.
INSERT INTO public.ticket_types (id, event_id, name, price_cents, available_online, is_unlimited, quantity_total, sold_count) VALUES
  ('4318a000-0000-4000-f000-000000000901', '4318a000-0000-4000-d000-000000000009', 'Door', 0, true, false, 1, 1);

-- Experiences and trips on the soft-deleted brand, otherwise eligible; and an
-- experience on the live brand whose stop has a private street address.
INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, experience_intents, published_at, destination_text, location_geo, rsvp_approval_mode, rsvp_discoverable,
  theme, created_at, updated_at) VALUES
  ('4318a000-0000-4000-d000-000000000101', '4318a000-0000-4000-c000-000000000002', '4318a000-0000-4000-a000-000000000003',
   'experience', 'T4318 gone walk', 't4318-gone-walk', 'scheduled', 'public', 'USD', 'Africa/Lagos', ARRAY['group-fun'], now(),
   NULL, NULL, 'auto', false, '{}', now(), now()),
  ('4318a000-0000-4000-d000-000000000102', '4318a000-0000-4000-c000-000000000001', '4318a000-0000-4000-a000-000000000003',
   'experience', 'T4318 live walk', 't4318-live-walk', 'scheduled', 'public', 'USD', 'Africa/Lagos', ARRAY['group-fun'], now(),
   NULL, NULL, 'auto', false, '{}', now(), now()),
  ('4318a000-0000-4000-d000-000000000201', '4318a000-0000-4000-c000-000000000002', '4318a000-0000-4000-a000-000000000003',
   'trip', 'T4318 gone trip', 't4318-gone-trip', 'scheduled', 'public', 'USD', 'Africa/Lagos', NULL, NULL,
   'Epe', point(3.98, 6.58), 'auto', false, '{}', now(), now());
INSERT INTO public.experience_stops (event_id, stop_order, place_name, address, lat, lng) VALUES
  ('4318a000-0000-4000-d000-000000000101', 0, 'Gone Garden', 'SECRET-4318-GONE-STOP', 6.43, 3.42),
  ('4318a000-0000-4000-d000-000000000102', 0, 'Freedom Park', 'SECRET-4318-STOP-ADDRESS', 6.45, 3.39);
INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master) VALUES
  ('4318a000-0000-4000-e000-000000010101', '4318a000-0000-4000-d000-000000000101', now() + interval '2 days', now() + interval '2 days 3 hours', 'Africa/Lagos', true),
  ('4318a000-0000-4000-e000-000000010201', '4318a000-0000-4000-d000-000000000102', now() + interval '2 days', now() + interval '2 days 3 hours', 'Africa/Lagos', true),
  ('4318a000-0000-4000-e000-000000020101', '4318a000-0000-4000-d000-000000000201', now() + interval '3 days', now() + interval '5 days', 'Africa/Lagos', true);
INSERT INTO public.ticket_types (id, event_id, name, price_cents, available_online, is_unlimited) VALUES
  ('4318a000-0000-4000-f000-000000010101', '4318a000-0000-4000-d000-000000000101', 'Walk', 0, true, true),
  ('4318a000-0000-4000-f000-000000010201', '4318a000-0000-4000-d000-000000000102', 'Walk', 0, true, true),
  ('4318a000-0000-4000-f000-000000020101', '4318a000-0000-4000-d000-000000000201', 'Seat', 0, true, true);
INSERT INTO public.trip_pricing_tiers (event_id, ticket_type_id, tier_name) VALUES
  ('4318a000-0000-4000-d000-000000000201', '4318a000-0000-4000-f000-000000020101', 'Standard');
-- Soft-delete the brand only now, past the #2063 guard (a deleted brand
-- cannot publish, and the guard refuses a brand with live offerings): the
-- reader must still hide a deleted brand whatever path left its rows behind.
SET LOCAL session_replication_role = replica;
UPDATE public.brands SET deleted_at = now() WHERE id = '4318a000-0000-4000-c000-000000000002';
SET LOCAL session_replication_role = origin;

SELECT pg_temp.t4318_act(NULL);
SET LOCAL ROLE anon;
DO $test$
DECLARE
  v_got text[];
  v_want text[] := ARRAY[
    't4318-edge@' || to_char(now() - interval '1 hour', 'YYYY-MM-DD HH24:MI:SS'),
    't4318-tz@' || to_char(now() + interval '1 day', 'YYYY-MM-DD HH24:MI:SS'),
    't4318-series@' || to_char(now() + interval '2 days', 'YYYY-MM-DD HH24:MI:SS'),
    't4318-withheld@' || to_char(now() + interval '2 days', 'YYYY-MM-DD HH24:MI:SS'),
    't4318-live-walk@' || to_char(now() + interval '2 days', 'YYYY-MM-DD HH24:MI:SS'),
    't4318-series@' || to_char(now() + interval '3 days', 'YYYY-MM-DD HH24:MI:SS'),
    't4318-edge@' || to_char(now() + interval '7 days' - interval '1 minute', 'YYYY-MM-DD HH24:MI:SS')];
  v_auckland timestamptz := (date_trunc('day', now() AT TIME ZONE 'Pacific/Auckland') + interval '2 days') AT TIME ZONE 'Pacific/Auckland';
  v_row record;
  v_blob text;
BEGIN
  -- The Auckland-midnight date may land anywhere in the week; slot it in.
  SELECT array_agg(item ORDER BY at, item) INTO v_want FROM (
    SELECT item, to_timestamp(split_part(item, '@', 2), 'YYYY-MM-DD HH24:MI:SS') AS at FROM unnest(v_want) AS item
    UNION ALL
    SELECT 't4318-tz@' || to_char(v_auckland, 'YYYY-MM-DD HH24:MI:SS'), v_auckland
    WHERE v_auckland < now() + interval '7 days'
  ) slotted;

  SELECT array_agg(week.item_slug || '@' || to_char(week.starts_at, 'YYYY-MM-DD HH24:MI:SS') ORDER BY week.starts_at, week.item_slug)
    INTO v_got
  FROM public.links_page_week() week
  WHERE week.item_slug LIKE 't4318-%';
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'W: rows %, want %', v_got, v_want;
  END IF;

  -- The soft-deleted brand lists nothing of any kind.
  IF EXISTS (SELECT 1 FROM public.links_page_week() week WHERE week.brand_slug = 't4318-gone') THEN
    RAISE EXCEPTION 'W: a soft-deleted brand is listed';
  END IF;

  -- Time zones: an empty date zone falls back to the event zone; the
  -- Auckland date starts at local midnight in its own zone.
  SELECT * INTO v_row FROM public.links_page_week() week WHERE week.item_slug = 't4318-tz' AND week.starts_at = now() + interval '1 day';
  IF v_row.tz IS DISTINCT FROM 'Africa/Lagos' THEN
    RAISE EXCEPTION 'W: empty date zone gave %', v_row.tz;
  END IF;
  IF v_auckland < now() + interval '7 days' THEN
    SELECT * INTO v_row FROM public.links_page_week() week WHERE week.item_slug = 't4318-tz' AND week.starts_at = v_auckland;
    IF v_row.tz IS DISTINCT FROM 'Pacific/Auckland' OR (v_row.starts_at AT TIME ZONE v_row.tz)::time <> '00:00' THEN
      RAISE EXCEPTION 'W: local-midnight date wrong: %', to_jsonb(v_row);
    END IF;
  END IF;

  -- Nothing private leaves: no hidden street address anywhere in any row,
  -- and the withheld event gives no place text and a one-decimal point.
  SELECT string_agg(to_jsonb(week)::text, ' ') INTO v_blob FROM public.links_page_week() week;
  IF v_blob LIKE '%SECRET-4318-%' THEN
    RAISE EXCEPTION 'W: a private address leaked: %', substring(v_blob FROM position('SECRET-4318-' IN v_blob) FOR 60);
  END IF;
  SELECT * INTO v_row FROM public.links_page_week() week WHERE week.item_slug = 't4318-withheld';
  IF v_row.place_label IS NOT NULL OR v_row.lat <> 6.4 OR v_row.lng <> 3.4 THEN
    RAISE EXCEPTION 'W: withheld event leaked its place: %', to_jsonb(v_row);
  END IF;
  SELECT * INTO v_row FROM public.links_page_week() week WHERE week.item_slug = 't4318-live-walk';
  IF v_row.place_label IS DISTINCT FROM 'Freedom Park' THEN
    RAISE EXCEPTION 'W: experience place wrong: %', to_jsonb(v_row);
  END IF;
END
$test$;
RESET ROLE;

-- The result shape is exactly the contract, nothing more.
DO $test$
BEGIN
  IF pg_get_function_result('public.links_page_week()'::regprocedure) <>
     'TABLE(kind text, title text, place_label text, starts_at timestamp with time zone, ends_at timestamp with time zone, tz text, lat double precision, lng double precision, cover_url text, brand_slug text, item_slug text)' THEN
    RAISE EXCEPTION 'W: links_page_week result drifted: %', pg_get_function_result('public.links_page_week()'::regprocedure);
  END IF;
  IF pg_get_function_result('public.links_page_strips()'::regprocedure) <>
     'TABLE(id uuid, shows_on date, shows_until date, title text, label text, opens text, url text, blog_slug text, "position" integer)' THEN
    RAISE EXCEPTION 'P: links_page_strips result drifted: %', pg_get_function_result('public.links_page_strips()'::regprocedure);
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.links_page_week()'::regprocedure)
     OR (SELECT proconfig FROM pg_proc WHERE oid = 'public.links_page_week()'::regprocedure) IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION 'W: links_page_week must be SECURITY DEFINER with an empty search_path';
  END IF;
END
$test$;

-- ═══ PL: links_page_places, adversarial ══════════════════════════════════
-- Centre (-40.0, 120.0), open ocean. Every place that must stay hidden gets
-- a huge review count, so a leak would sort to the top and be seen.
RESET ROLE;
INSERT INTO public.place_pool (id, google_place_id, name, address, lat, lng, city, review_count,
  primary_type_display_name, business_status, is_active, is_servable, stored_photo_urls, thumbs_backfilled_at) VALUES
  -- Eight good places within 40 km.
  ('4318a000-0000-4000-8000-000000000001', 't4318-g1', 'T good 1', 'HIDDEN-ADDR g1', -40.01, 120.0, 'Oceania Test', 10, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318g1/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000002', 't4318-g2', 'T good 2', 'HIDDEN-ADDR g2', -40.02, 120.0, 'Oceania Test', 20, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318g2/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000003', 't4318-g3', 'T good 3', 'HIDDEN-ADDR g3', -40.03, 120.0, 'Oceania Test', 30, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318g3/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000004', 't4318-g4', 'T good 4', 'HIDDEN-ADDR g4', -40.04, 120.0, 'Oceania Test', 40, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318g4/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000005', 't4318-g5', 'T good 5', 'HIDDEN-ADDR g5', -40.05, 120.0, 'Oceania Test', 50, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318g5/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000006', 't4318-g6', 'T good 6', 'HIDDEN-ADDR g6', -40.06, 120.0, 'Oceania Test', 60, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318g6/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000007', 't4318-g7', 'T good 7', 'HIDDEN-ADDR g7', -40.07, 120.0, 'Oceania Test', 70, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318g7/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000008', 't4318-g8', 'T good 8', 'HIDDEN-ADDR g8', -40.08, 120.0, 'Oceania Test', 80, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318g8/0.jpg'], now()),
  -- Good in every way but 150 km out: beyond the 100 km cap.
  ('4318a000-0000-4000-8000-000000000009', 't4318-far', 'T LEAK far', 'HIDDEN-ADDR far', -41.35, 120.0, 'Oceania Test', 999999, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318far/0.jpg'], now()),
  -- Closed or not public.
  ('4318a000-0000-4000-8000-000000000011', 't4318-closed-t', 'T LEAK closed temporarily', 'HIDDEN-ADDR c1', -40.01, 120.01, 'Oceania Test', 999999, 'Cafe', 'CLOSED_TEMPORARILY', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318c1/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000012', 't4318-closed-p', 'T LEAK closed permanently', 'HIDDEN-ADDR c2', -40.01, 120.01, 'Oceania Test', 999999, 'Cafe', 'CLOSED_PERMANENTLY', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318c2/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000013', 't4318-nostatus', 'T LEAK no status', 'HIDDEN-ADDR c3', -40.01, 120.01, 'Oceania Test', 999999, 'Cafe', NULL, true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318c3/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000014', 't4318-inactive', 'T LEAK inactive', 'HIDDEN-ADDR c4', -40.01, 120.01, 'Oceania Test', 999999, 'Cafe', 'OPERATIONAL', false, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318c4/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000015', 't4318-unservable', 'T LEAK not servable', 'HIDDEN-ADDR c5', -40.01, 120.01, 'Oceania Test', 999999, 'Cafe', 'OPERATIONAL', true, false, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318c5/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000016', 't4318-deleted', 'T LEAK deleted', 'HIDDEN-ADDR c6', -40.01, 120.01, 'Oceania Test', 999999, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318c6/0.jpg'], now()),
  -- No usable photo.
  ('4318a000-0000-4000-8000-000000000021', 't4318-nophoto', 'T LEAK no photo', 'HIDDEN-ADDR n1', -40.01, 120.02, 'Oceania Test', 999999, 'Cafe', 'OPERATIONAL', true, true, NULL, now()),
  ('4318a000-0000-4000-8000-000000000022', 't4318-emptyphoto', 'T LEAK empty photo', 'HIDDEN-ADDR n2', -40.01, 120.02, 'Oceania Test', 999999, 'Cafe', 'OPERATIONAL', true, true, '{}', now()),
  ('4318a000-0000-4000-8000-000000000023', 't4318-failedphoto', 'T LEAK failed photo', 'HIDDEN-ADDR n3', -40.01, 120.02, 'Oceania Test', 999999, 'Cafe', 'OPERATIONAL', true, true, ARRAY['__backfill_failed__'], now()),
  ('4318a000-0000-4000-8000-000000000024', 't4318-google', 'T LEAK google photo', 'HIDDEN-ADDR n4', -40.01, 120.02, 'Oceania Test', 999999, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://lh3.googleusercontent.com/places/abc=s800'], now()),
  ('4318a000-0000-4000-8000-000000000025', 't4318-nothumb', 'T LEAK no thumb yet', 'HIDDEN-ADDR n5', -40.01, 120.02, 'Oceania Test', 999999, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJt4318n5/0.jpg'], NULL),
  ('4318a000-0000-4000-8000-000000000026', 't4318-rootphoto', 'T LEAK bucket-root photo', 'HIDDEN-ADDR n6', -40.01, 120.02, 'Oceania Test', 999999, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/0.jpg'], now()),
  ('4318a000-0000-4000-8000-000000000027', 't4318-render', 'T LEAK render URL', 'HIDDEN-ADDR n7', -40.01, 120.02, 'Oceania Test', 999999, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/render/image/public/place-photos/ChIJt4318n7/0.jpg?width=400'], now());
UPDATE public.place_pool SET deleted_at = now() WHERE id = '4318a000-0000-4000-8000-000000000016';

SET LOCAL ROLE anon;
DO $test$
DECLARE
  v_names text[];
  v_text text;
  v_probe record;
BEGIN
  -- Limit beyond the cap gives 6, never more; the hidden places never appear.
  SELECT array_agg(place.name ORDER BY place.name) INTO v_names FROM public.links_page_places(-40.0, 120.0, 60, 50) place;
  IF v_names IS DISTINCT FROM ARRAY['T good 3', 'T good 4', 'T good 5', 'T good 6', 'T good 7', 'T good 8'] THEN
    RAISE EXCEPTION 'PL: limit 50 not capped at 6 or a hidden place leaked: %', v_names;
  END IF;
  IF (SELECT count(*) FROM public.links_page_places(-40.0, 120.0, 60, 2147483647)) <> 6 THEN
    RAISE EXCEPTION 'PL: max-int limit not capped';
  END IF;
  -- NULL limit and NULL radius fall back to the defaults (3 within 60 km).
  IF (SELECT count(*) FROM public.links_page_places(-40.0, 120.0, NULL, NULL)) <> 3 THEN
    RAISE EXCEPTION 'PL: NULL radius/limit did not fall back to defaults';
  END IF;
  -- Zero or negative limits never return more than one row.
  IF (SELECT count(*) FROM public.links_page_places(-40.0, 120.0, 60, -5)) > 1 THEN
    RAISE EXCEPTION 'PL: a negative limit returned many rows';
  END IF;
  -- Radius beyond the cap: the place 150 km out stays out.
  IF EXISTS (SELECT 1 FROM public.links_page_places(-40.0, 120.0, 100000, 6) place WHERE place.name LIKE 'T LEAK%') THEN
    RAISE EXCEPTION 'PL: radius not capped at 100 km';
  END IF;
  -- Nothing hidden appears at any reach or limit.
  IF EXISTS (SELECT 1 FROM public.links_page_places(-40.01, 120.01, 100, 6) place WHERE place.name LIKE 'T LEAK%') THEN
    RAISE EXCEPTION 'PL: a closed, non-public or photo-less place leaked';
  END IF;

  -- Null, NaN, infinite and out-of-range coordinates return nothing, never an error.
  FOR v_probe IN SELECT * FROM (VALUES
    (NULL::double precision, 120.0::double precision), (-40.0, NULL), (NULL, NULL),
    ('NaN', 120.0), (-40.0, 'NaN'), ('Infinity', 120.0), (-40.0, '-Infinity'),
    (91.0, 120.0), (-40.0, 181.0)
  ) AS c(lat, lng) LOOP
    IF (SELECT count(*) FROM public.links_page_places(v_probe.lat, v_probe.lng)) <> 0 THEN
      RAISE EXCEPTION 'PL: coordinates % returned places', to_jsonb(v_probe);
    END IF;
  END LOOP;

  -- No address, Google id, review count or private column, ever.
  SELECT string_agg(to_jsonb(place)::text, ' ') INTO v_text FROM public.links_page_places(-40.0, 120.0, 100, 6) place;
  IF v_text LIKE '%HIDDEN-ADDR%' OR v_text LIKE '%t4318-%' OR v_text LIKE '%review%' OR v_text LIKE '%render/image%' THEN
    RAISE EXCEPTION 'PL: a private value leaked: %', v_text;
  END IF;
  IF v_text NOT LIKE '%"photo_path": "ChIJt4318g8/0_thumb.jpg"%' THEN
    RAISE EXCEPTION 'PL: photo_path is not the bucket-relative thumb: %', v_text;
  END IF;
END
$test$;
RESET ROLE;

DO $test$
BEGIN
  IF pg_get_function_result('public.links_page_places(double precision,double precision,integer,integer)'::regprocedure) <>
     'TABLE(place_id text, name text, category text, area_label text, lat double precision, lng double precision, photo_path text)' THEN
    RAISE EXCEPTION 'PL: links_page_places result drifted';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.links_page_places(double precision,double precision,integer,integer)'::regprocedure)
     OR (SELECT proconfig FROM pg_proc WHERE oid = 'public.links_page_places(double precision,double precision,integer,integer)'::regprocedure)
        IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION 'PL: links_page_places must be SECURITY DEFINER with an empty search_path';
  END IF;
END
$test$;

ROLLBACK;
