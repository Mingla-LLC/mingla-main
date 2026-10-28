-- #4137 wave 3 — the blog's data model, RLS and public reads, executable PostgreSQL 17 proof.
--
-- Covers AC-DB1 through AC-DB13, including role-guarded staff workflow,
-- optimistic conflicts, readiness, frozen published versions and featuring.
-- Runs after the complete migration replay and rolls every fixture back.
-- Fails on revert: without the #4137 migrations the blog tables and RPCs do not exist.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
BEGIN
  IF position(
    'extensions.gen_random_bytes'
    IN pg_get_functiondef('public.issue_4137_blog_create_preview_token(uuid)'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION
      'security: preview token entropy source must use the schema-qualified extension function';
  END IF;
END
$test$;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

-- ── People ────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('41370000-0000-4000-a000-000000000001', 'issue4137-outsider@test.local', now()),
  ('41370000-0000-4000-a000-000000000002', 'issue4137-teammate@test.local', now()),
  ('41370000-0000-4000-a000-000000000003', 'issue4137-lead@test.local', now()),
  ('41370000-0000-4000-a000-000000000004', 'Issue4137-Admin@Test.local', now()),
  ('41370000-0000-4000-a000-000000000005', 'issue4137-disabled@test.local', now()),
  ('41370000-0000-4000-a000-000000000006', 'issue4137-revoked@test.local', now()),
  ('41370000-0000-4000-a000-000000000007', 'issue4137-host@test.local', now());

INSERT INTO public.admin_users (email, role, status, accepted_at) VALUES
  ('issue4137-admin@test.local', 'admin', 'active', now());
INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue4137-teammate@test.local', 'growth', 'active', now()),
  ('issue4137-lead@test.local', 'growth', 'active', now()),
  ('issue4137-disabled@test.local', 'growth', 'active', now()),
  ('issue4137-revoked@test.local', 'growth', 'revoked', now());
INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('41370000-0000-4000-a000-000000000002', true, false, 'staff'),
  ('41370000-0000-4000-a000-000000000003', true, false, 'lead'),
  ('41370000-0000-4000-a000-000000000005', false, false, 'lead'),
  ('41370000-0000-4000-a000-000000000006', true, false, 'lead');

-- ── Places and events (distinct strings so a leak is findable) ───────────
INSERT INTO public.place_pool (id, google_place_id, name, lat, lng, city, rating, review_count,
  primary_type_display_name, google_maps_uri, business_status, is_active, stored_photo_urls) VALUES
  ('41370000-0000-4000-b000-000000000001', 'ChIJissue4137OpenPlace', 'Issue 4137 Lakeside Park', 35.76, -78.71,
   'Raleigh', 4.7, 4940, 'Park', 'https://maps.google.com/?cid=4137', 'OPERATIONAL', true,
   ARRAY['https://example.supabase.co/storage/v1/object/public/place-photos/ChIJissue4137OpenPlace/0.jpg']),
  ('41370000-0000-4000-b000-000000000002', 'ChIJissue4137ClosedPlace', 'Issue 4137 Closed Bar', 35.77, -78.64,
   'Raleigh', 4.1, 120, 'Bar', 'https://maps.google.com/?cid=4138', 'CLOSED_PERMANENTLY', true, '{}');

INSERT INTO public.creator_accounts (id) VALUES ('41370000-0000-4000-a000-000000000007');
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('41370000-0000-4000-c000-000000000001', '41370000-0000-4000-a000-000000000007',
   'Sabor Latino Collective', 'sabor-latino-collective', 'USD', now(), now());
INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, city, party_types, rsvp_approval_mode, rsvp_discoverable, theme, location_text, created_at, updated_at) VALUES
  ('41370000-0000-4000-d000-000000000001', '41370000-0000-4000-c000-000000000001', '41370000-0000-4000-a000-000000000007',
   'event', 'Sabor Latino Bachata Thursdays', 'issue-4137-bachata', 'scheduled', 'public', 'USD',
   'America/New_York', 'Cary', '{}', 'auto', false, '{}', 'Sabor Latino Studio, 1 Main St', now(), now()),
  ('41370000-0000-4000-d000-000000000002', '41370000-0000-4000-c000-000000000001', '41370000-0000-4000-a000-000000000007',
   'event', 'Issue 4137 Private Supper', 'issue-4137-private', 'draft', 'draft', 'USD',
   'America/New_York', 'Raleigh', '{}', 'auto', false, '{}', 'Secret address', now(), now()),
  ('41370000-0000-4000-d000-000000000003', '41370000-0000-4000-c000-000000000001', '41370000-0000-4000-a000-000000000007',
   'event', 'Issue 4137 Past Social', 'issue-4137-past', 'scheduled', 'public', 'USD',
   'America/New_York', 'Durham', '{}', 'auto', false, '{}', 'Old hall', now(), now());
INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master) VALUES
  ('41370000-0000-4000-d000-000000000001', now() + interval '2 days', now() + interval '2 days 4 hours', 'America/New_York', true),
  ('41370000-0000-4000-d000-000000000001', now() + interval '9 days', now() + interval '9 days 4 hours', 'America/New_York', false),
  ('41370000-0000-4000-d000-000000000003', now() - interval '3 days', now() - interval '3 days' + interval '4 hours', 'America/New_York', true);

-- ── Media ────────────────────────────────────────────────────────────────
INSERT INTO public.blog_media (id, storage_path, mime_type, width, height, bytes, alt, source, source_ref, uploaded_by) VALUES
  ('41370000-0000-4000-e000-000000000001', '41370000-0000-4000-a000-000000000002/41370000-0000-4000-e000-000000000001.jpg',
   'image/jpeg', 2400, 1200, 420000, 'Lake at dusk', 'mingla_owned', 'SECRET-SHOOT-REF-1', '41370000-0000-4000-a000-000000000002'),
  ('41370000-0000-4000-e000-000000000002', '41370000-0000-4000-a000-000000000002/41370000-0000-4000-e000-000000000002.jpg',
   'image/jpeg', 1600, 1200, 300000, 'Gallery wall', 'licensed_stock', 'SECRET-LICENCE-REF-2', '41370000-0000-4000-a000-000000000002'),
  ('41370000-0000-4000-e000-000000000003', '41370000-0000-4000-a000-000000000002/41370000-0000-4000-e000-000000000003.jpg',
   'image/jpeg', 1600, 1200, 300000, 'Draft only', 'mingla_owned', 'SECRET-DRAFT-REF-3', '41370000-0000-4000-a000-000000000002');

-- ── Posts ────────────────────────────────────────────────────────────────
-- p1 public (with a draft in progress), p2 draft, p3 scheduled, p4 unpublished,
-- p5 taken down, p6 soft-deleted, p7 taken down when its event ended,
-- p8 public in another category, p9 public but hidden from More stories.
-- Every post starts as a draft: a published post needs its version, and a
-- version needs its post, exactly as the wave 4 publish RPC sequences it.
INSERT INTO public.blog_posts (id, slug, category_slug, status, publish_at, first_published_at, take_down_mode,
  take_down_at, take_down_event_id, topics, show_in_more_stories, review_note, created_by, deleted_at) VALUES
  ('41370000-0000-4000-f000-000000000001', 'a-slow-saturday', 'going-out', 'draft', now() - interval '2 days', now() - interval '2 days', 'never', NULL, NULL, '{raleigh,weekend}', true, 'SECRET REVIEW NOTE', '41370000-0000-4000-a000-000000000002', NULL),
  ('41370000-0000-4000-f000-000000000002', 'still-a-draft', 'going-out', 'draft', NULL, NULL, 'never', NULL, NULL, '{}', true, NULL, '41370000-0000-4000-a000-000000000002', NULL),
  ('41370000-0000-4000-f000-000000000003', 'coming-tomorrow', 'date-ideas', 'draft', now() + interval '1 day', NULL, 'never', NULL, NULL, '{}', true, NULL, '41370000-0000-4000-a000-000000000002', NULL),
  ('41370000-0000-4000-f000-000000000004', 'pulled-post', 'date-ideas', 'draft', now() - interval '5 days', now() - interval '5 days', 'never', NULL, NULL, '{}', true, NULL, '41370000-0000-4000-a000-000000000002', NULL),
  ('41370000-0000-4000-f000-000000000005', 'expired-post', 'host-playbook', 'draft', now() - interval '5 days', now() - interval '5 days', 'at', now() - interval '1 day', NULL, '{}', true, NULL, '41370000-0000-4000-a000-000000000002', NULL),
  ('41370000-0000-4000-f000-000000000006', 'deleted-post', 'host-playbook', 'draft', now() - interval '5 days', now() - interval '5 days', 'never', NULL, NULL, '{}', true, NULL, '41370000-0000-4000-a000-000000000002', now()),
  ('41370000-0000-4000-f000-000000000007', 'event-has-ended', 'going-out', 'draft', now() - interval '6 days', now() - interval '6 days', 'event_end',
   public.issue_4137_blog_event_take_down_at('41370000-0000-4000-d000-000000000003'), '41370000-0000-4000-d000-000000000003', '{}', true, NULL, '41370000-0000-4000-a000-000000000002', NULL),
  ('41370000-0000-4000-f000-000000000008', 'pricing-the-door', 'host-playbook', 'draft', now() - interval '1 day', now() - interval '1 day', 'never', NULL, NULL, '{weekend}', true, NULL, '41370000-0000-4000-a000-000000000002', NULL),
  ('41370000-0000-4000-f000-000000000009', 'quiet-post', 'going-out', 'draft', now() - interval '3 days', now() - interval '3 days', 'never', NULL, NULL, '{}', false, NULL, '41370000-0000-4000-a000-000000000002', NULL);

INSERT INTO public.blog_post_versions (id, post_id, kind, title, summary, cover_media_id, cover_alt, document, read_minutes, created_by) VALUES
  ('41370000-0000-4000-f100-000000000001', '41370000-0000-4000-f000-000000000001', 'published', 'A slow Saturday in three stops',
   'A lake, a gallery and a bar.', '41370000-0000-4000-e000-000000000001', 'The lake at dusk',
   '{"version":1,"blocks":[
      {"id":"para01","type":"paragraph","html":"Start at <a data-mingla-target=\"place:41370000-0000-4000-b000-000000000001\">the lake</a>."},
      {"id":"place1","type":"place","placeId":"41370000-0000-4000-b000-000000000001","style":"card"},
      {"id":"place2","type":"place","placeId":"41370000-0000-4000-b000-000000000002","style":"compact"},
      {"id":"image1","type":"image","mediaId":"41370000-0000-4000-e000-000000000002","alt":"Gallery wall"},
      {"id":"offer1","type":"offering","eventId":"41370000-0000-4000-d000-000000000001","displayTitle":"Bachata social, lesson included"},
      {"id":"offer2","type":"offering","eventId":"41370000-0000-4000-d000-000000000003","displayTitle":"A social that already happened"}
    ]}', 3, '41370000-0000-4000-a000-000000000002'),
  ('41370000-0000-4000-f100-000000000011', '41370000-0000-4000-f000-000000000001', 'draft', 'DRAFT TITLE NOT PUBLIC',
   'Draft summary', '41370000-0000-4000-e000-000000000003', 'Draft cover',
   '{"version":1,"blocks":[{"id":"offer9","type":"offering","eventId":"41370000-0000-4000-d000-000000000002","displayTitle":"Private"}]}', 1,
   '41370000-0000-4000-a000-000000000002'),
  ('41370000-0000-4000-f100-000000000002', '41370000-0000-4000-f000-000000000002', 'draft', 'Still a draft', '', NULL, '', '{"version":1,"blocks":[]}', 1, '41370000-0000-4000-a000-000000000002'),
  ('41370000-0000-4000-f100-000000000003', '41370000-0000-4000-f000-000000000003', 'published', 'Coming tomorrow', '', NULL, '', '{"version":1,"blocks":[]}', 1, '41370000-0000-4000-a000-000000000002'),
  ('41370000-0000-4000-f100-000000000004', '41370000-0000-4000-f000-000000000004', 'published', 'Pulled', '', NULL, '', '{"version":1,"blocks":[]}', 1, '41370000-0000-4000-a000-000000000002'),
  ('41370000-0000-4000-f100-000000000005', '41370000-0000-4000-f000-000000000005', 'published', 'Expired', '', NULL, '', '{"version":1,"blocks":[]}', 1, '41370000-0000-4000-a000-000000000002'),
  ('41370000-0000-4000-f100-000000000006', '41370000-0000-4000-f000-000000000006', 'published', 'Deleted', '', NULL, '', '{"version":1,"blocks":[]}', 1, '41370000-0000-4000-a000-000000000002'),
  ('41370000-0000-4000-f100-000000000007', '41370000-0000-4000-f000-000000000007', 'published', 'Event ended', '', NULL, '', '{"version":1,"blocks":[]}', 1, '41370000-0000-4000-a000-000000000002'),
  ('41370000-0000-4000-f100-000000000008', '41370000-0000-4000-f000-000000000008', 'published', 'Pricing the door', 'Early bird and door.', NULL, '', '{"version":1,"blocks":[]}', 4, '41370000-0000-4000-a000-000000000002'),
  ('41370000-0000-4000-f100-000000000009', '41370000-0000-4000-f000-000000000009', 'published', 'Quiet post', '', NULL, '', '{"version":1,"blocks":[]}', 2, '41370000-0000-4000-a000-000000000002');

UPDATE public.blog_posts post SET
  status = CASE right(post.id::text, 1) WHEN '2' THEN 'draft' WHEN '4' THEN 'unpublished' ELSE 'published' END,
  published_version_id = CASE WHEN right(post.id::text, 1) = '2' THEN NULL ELSE ('41370000-0000-4000-f100-00000000000' || right(post.id::text, 1))::uuid END,
  draft_version_id = CASE post.id
    WHEN '41370000-0000-4000-f000-000000000001' THEN '41370000-0000-4000-f100-000000000011'::uuid
    WHEN '41370000-0000-4000-f000-000000000002' THEN '41370000-0000-4000-f100-000000000002'::uuid
    ELSE NULL END
WHERE post.id::text LIKE '41370000-0000-4000-f000-%';

INSERT INTO public.blog_featured (slot, post_id, set_by)
VALUES ('blog_index', '41370000-0000-4000-f000-000000000008', '41370000-0000-4000-a000-000000000003');

INSERT INTO public.blog_preview_tokens (token_hash, post_id, version_id, created_by, expires_at) VALUES
  (encode(sha256(convert_to('issue4137PreviewTokenAAAAAAAAAAAAAAAAAAAAAA', 'UTF8')), 'hex'),
   '41370000-0000-4000-f000-000000000001', '41370000-0000-4000-f100-000000000011', '41370000-0000-4000-a000-000000000002', now() + interval '1 hour'),
  (encode(sha256(convert_to('issue4137ExpiredTokenBBBBBBBBBBBBBBBBBBBBBBB', 'UTF8')), 'hex'),
   '41370000-0000-4000-f000-000000000001', '41370000-0000-4000-f100-000000000011', '41370000-0000-4000-a000-000000000002', now() - interval '1 minute');

-- ── Structure and derived ids ────────────────────────────────────────────
DO $t$
DECLARE v record;
BEGIN
  SELECT media_ids, ref_place_ids, ref_event_ids INTO v FROM public.blog_post_versions WHERE id = '41370000-0000-4000-f100-000000000001';
  IF NOT (v.media_ids @> ARRAY['41370000-0000-4000-e000-000000000001','41370000-0000-4000-e000-000000000002']::uuid[] AND cardinality(v.media_ids) = 2) THEN
    RAISE EXCEPTION 'derive: media_ids %', v.media_ids; END IF;
  IF NOT (v.ref_place_ids @> ARRAY['41370000-0000-4000-b000-000000000001','41370000-0000-4000-b000-000000000002']::uuid[] AND cardinality(v.ref_place_ids) = 2) THEN
    RAISE EXCEPTION 'derive: ref_place_ids %', v.ref_place_ids; END IF;
  IF NOT (v.ref_event_ids @> ARRAY['41370000-0000-4000-d000-000000000001','41370000-0000-4000-d000-000000000003']::uuid[] AND cardinality(v.ref_event_ids) = 2) THEN
    RAISE EXCEPTION 'derive: ref_event_ids %', v.ref_event_ids; END IF;

  BEGIN
    INSERT INTO public.blog_post_versions (post_id, kind, title, document, created_by)
    VALUES ('41370000-0000-4000-f000-000000000002', 'draft', 'x', '{"version":1,"blocks":[{"id":"brand1","type":"brand"}]}', '41370000-0000-4000-a000-000000000002');
    RAISE EXCEPTION 'structure: an unknown block type was stored';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'blog_document_invalid' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.blog_post_versions (post_id, kind, title, document, created_by)
    VALUES ('41370000-0000-4000-f000-000000000002', 'draft', 'x', '{"version":1,"blocks":[{"id":"image1","type":"image","mediaId":"41370000-0000-4000-e000-000000000002","alt":" "}]}', '41370000-0000-4000-a000-000000000002');
    RAISE EXCEPTION 'structure: an image without alt was stored';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'blog_document_invalid' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.blog_posts SET published_version_id = NULL WHERE id = '41370000-0000-4000-f000-000000000008';
    RAISE EXCEPTION 'constraint: a published post lost its version';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.blog_posts (slug, category_slug, created_by) VALUES ('preview', 'going-out', '41370000-0000-4000-a000-000000000002');
    RAISE EXCEPTION 'constraint: a reserved slug was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.blog_posts (slug, category_slug, created_by) VALUES ('city-guides', 'city-guide', '41370000-0000-4000-a000-000000000002');
    RAISE EXCEPTION 'constraint: an unknown category was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END
$t$;

-- ── AC-DB11: four categories, no city columns ────────────────────────────
DO $t$
BEGIN
  IF (SELECT array_agg(slug ORDER BY sort_order) FROM public.blog_categories)
       IS DISTINCT FROM ARRAY['going-out','date-ideas','host-playbook','product-news'] THEN
    RAISE EXCEPTION 'AC-DB11: categories are %', (SELECT array_agg(slug) FROM public.blog_categories);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'blog\_%'
             AND column_name IN ('city', 'city_slug')) THEN
    RAISE EXCEPTION 'AC-DB11: a blog table carries a city column';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'blog\_%' AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'RLS: a blog table has row security off';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'blog\_%') <> 9 THEN
    RAISE EXCEPTION 'RLS: expected 9 blog tables';
  END IF;
END
$t$;

-- ── AC-DB13: the #3988 functions are not blog functions ──────────────────
DO $t$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('is_support_staff', 'issue_3988_capabilities', 'admin_team_my_operational_areas')
             AND (prosrc ILIKE '%blog%' OR NOT prosecdef)) THEN
    RAISE EXCEPTION 'AC-DB13: a #3988 function was changed by the blog';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname IN ('is_support_staff', 'issue_3988_capabilities', 'admin_team_my_operational_areas')) <> 3 THEN
    RAISE EXCEPTION 'AC-DB13: a #3988 function is missing';
  END IF;
END
$t$;

-- ── Writer and publisher predicates (AC-DB4, predicate half) ─────────────
DO $t$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('41370000-0000-4000-a000-000000000001'::uuid, false, false, 'outsider'),
    ('41370000-0000-4000-a000-000000000002'::uuid, true, false, 'teammate'),
    ('41370000-0000-4000-a000-000000000003'::uuid, true, true, 'lead'),
    ('41370000-0000-4000-a000-000000000004'::uuid, true, true, 'admin (email casing differs)'),
    ('41370000-0000-4000-a000-000000000005'::uuid, false, false, 'disabled lead'),
    ('41370000-0000-4000-a000-000000000006'::uuid, false, false, 'lead who left the team')
  ) AS t(id, can_write, can_publish, who) LOOP
    IF public.issue_4137_blog_can_write(r.id) IS DISTINCT FROM r.can_write THEN
      RAISE EXCEPTION 'AC-DB4: % can_write = %', r.who, public.issue_4137_blog_can_write(r.id); END IF;
    IF public.issue_4137_blog_can_publish(r.id) IS DISTINCT FROM r.can_publish THEN
      RAISE EXCEPTION 'AC-DB4: % can_publish = %', r.who, public.issue_4137_blog_can_publish(r.id); END IF;
  END LOOP;
  IF public.issue_4137_blog_can_write(NULL) OR public.issue_4137_blog_can_publish(NULL) THEN
    RAISE EXCEPTION 'AC-DB4: nobody can write'; END IF;
END
$t$;

-- ── AC-DB1: anon sees only public posts and their published versions ────
SET LOCAL ROLE anon;
DO $t$
BEGIN
  IF (SELECT array_agg(slug ORDER BY slug) FROM public.blog_posts)
       IS DISTINCT FROM ARRAY['a-slow-saturday', 'pricing-the-door', 'quiet-post'] THEN
    RAISE EXCEPTION 'AC-DB1: anon sees posts %', (SELECT array_agg(slug ORDER BY slug) FROM public.blog_posts);
  END IF;
  IF (SELECT array_agg(title ORDER BY title) FROM public.blog_post_versions)
       IS DISTINCT FROM ARRAY['A slow Saturday in three stops', 'Pricing the door', 'Quiet post'] THEN
    RAISE EXCEPTION 'AC-DB1: anon sees versions %', (SELECT array_agg(title) FROM public.blog_post_versions);
  END IF;
  IF EXISTS (SELECT 1 FROM public.blog_post_versions WHERE id = '41370000-0000-4000-f100-000000000011') THEN
    RAISE EXCEPTION 'AC-DB1: a public post''s draft version leaked'; END IF;
  IF (SELECT array_agg(id ORDER BY id) FROM public.blog_media)
       IS DISTINCT FROM ARRAY['41370000-0000-4000-e000-000000000001', '41370000-0000-4000-e000-000000000002']::uuid[] THEN
    RAISE EXCEPTION 'AC-DB1: anon sees media %', (SELECT array_agg(id) FROM public.blog_media);
  END IF;
  IF (SELECT count(*) FROM public.blog_featured) <> 1 THEN RAISE EXCEPTION 'featured slot hidden from anon'; END IF;
  IF (SELECT count(*) FROM public.blog_categories) <> 4 OR (SELECT count(*) FROM public.blog_authors) <> 1 THEN
    RAISE EXCEPTION 'categories and authors are public'; END IF;
END
$t$;

-- ── AC-DB2: workflow and licence columns are not anon's ──────────────────
DO $t$
DECLARE probe text;
BEGIN
  FOREACH probe IN ARRAY ARRAY[
    'SELECT review_note FROM public.blog_posts', 'SELECT created_by FROM public.blog_posts',
    'SELECT draft_version_id FROM public.blog_posts', 'SELECT revision FROM public.blog_posts',
    'SELECT source_ref FROM public.blog_media', 'SELECT source FROM public.blog_media',
    'SELECT created_by FROM public.blog_post_versions', 'SELECT set_by FROM public.blog_featured',
    'SELECT * FROM public.blog_preview_tokens', 'SELECT * FROM public.blog_post_audit',
    'SELECT * FROM public.blog_post_link_checks', 'SELECT * FROM public.blog_posts'
  ] LOOP
    BEGIN
      EXECUTE probe;
      RAISE EXCEPTION 'AC-DB2: anon ran %', probe;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END
$t$;

-- ── AC-DB3 (anon): no writes anywhere ────────────────────────────────────
DO $t$
DECLARE probe text;
BEGIN
  FOREACH probe IN ARRAY ARRAY[
    'INSERT INTO public.blog_categories (slug, label, description, sort_order) VALUES (''city-guides'', ''City'', repeat(''x'', 60), 9)',
    'UPDATE public.blog_categories SET label = ''x''', 'DELETE FROM public.blog_categories',
    'INSERT INTO public.blog_authors (display_name) VALUES (''x'')', 'UPDATE public.blog_authors SET display_name = ''x''',
    'INSERT INTO public.blog_posts (slug, category_slug, created_by) VALUES (''hack-post'', ''going-out'', gen_random_uuid())',
    'UPDATE public.blog_posts SET slug = ''hacked''', 'DELETE FROM public.blog_posts',
    'UPDATE public.blog_post_versions SET title = ''hacked''', 'DELETE FROM public.blog_post_versions',
    'UPDATE public.blog_media SET alt = ''x''', 'DELETE FROM public.blog_media',
    'UPDATE public.blog_featured SET post_id = post_id', 'DELETE FROM public.blog_featured',
    'DELETE FROM public.blog_preview_tokens', 'DELETE FROM public.blog_post_audit', 'DELETE FROM public.blog_post_link_checks'
  ] LOOP
    BEGIN
      EXECUTE probe;
      RAISE EXCEPTION 'AC-DB3: anon ran %', probe;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END
$t$;

-- ── Public RPCs as anon ──────────────────────────────────────────────────
DO $t$
DECLARE
  v_index jsonb;
  v_post jsonb;
  v_embeds jsonb;
  v_slug text;
BEGIN
  -- Index: the featured slot wins, the rest newest first, never repeating it.
  v_index := public.blog_public_index();
  IF v_index #>> '{featured,slug}' <> 'pricing-the-door' THEN RAISE EXCEPTION 'index featured %', v_index -> 'featured'; END IF;
  IF (SELECT array_agg(card ->> 'slug' ORDER BY ord) FROM jsonb_array_elements(v_index -> 'posts') WITH ORDINALITY AS c(card, ord))
       IS DISTINCT FROM ARRAY['a-slow-saturday', 'quiet-post'] THEN RAISE EXCEPTION 'index posts %', v_index -> 'posts'; END IF;
  IF (v_index ->> 'total')::int <> 2 THEN RAISE EXCEPTION 'index total %', v_index ->> 'total'; END IF;
  IF jsonb_array_length(v_index -> 'categories') <> 4 THEN RAISE EXCEPTION 'index categories'; END IF;
  IF v_index #> '{posts,0,cover}' <> jsonb_build_object('path', '41370000-0000-4000-a000-000000000002/41370000-0000-4000-e000-000000000001.jpg',
       'width', 2400, 'height', 1200, 'alt', 'The lake at dusk') THEN RAISE EXCEPTION 'card cover %', v_index #> '{posts,0,cover}'; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_index #> '{posts,0}') k)
       IS DISTINCT FROM ARRAY['author','category','cover','publish_at','read_minutes','slug','summary','title'] THEN
    RAISE EXCEPTION 'card keys %', (SELECT array_agg(k) FROM jsonb_object_keys(v_index #> '{posts,0}') k); END IF;

  -- Category page: no featured card; only that category.
  v_index := public.blog_public_index('host-playbook');
  IF v_index -> 'featured' <> 'null'::jsonb OR (v_index ->> 'total')::int <> 1
     OR v_index #>> '{posts,0,slug}' <> 'pricing-the-door' THEN RAISE EXCEPTION 'category index %', v_index; END IF;
  IF (public.blog_public_index(NULL, 1, 1) -> 'posts') -> 0 ->> 'slug' <> 'quiet-post' THEN RAISE EXCEPTION 'paging'; END IF;
  BEGIN
    PERFORM public.blog_public_index('city-guide');
    RAISE EXCEPTION 'unknown category accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'blog_category_unknown' THEN RAISE; END IF;
  END;

  -- Post: the published version, never the draft in progress (AC-DB7 read half).
  v_post := public.blog_public_post('A-Slow-Saturday');
  IF v_post ->> 'title' <> 'A slow Saturday in three stops' OR v_post::text LIKE '%DRAFT TITLE%' THEN
    RAISE EXCEPTION 'post payload %', v_post; END IF;
  IF v_post::text LIKE '%SECRET%' THEN RAISE EXCEPTION 'post leaks an admin-only string'; END IF;
  IF jsonb_typeof(v_post #> '{published_version,document,blocks}') <> 'array'
     OR v_post #>> '{published_version,media,41370000-0000-4000-e000-000000000002,width}' <> '1600' THEN
    RAISE EXCEPTION 'post version payload %', v_post -> 'published_version'; END IF;
  -- More stories: other public posts that allow it, same category first.
  IF (SELECT array_agg(card ->> 'slug' ORDER BY ord) FROM jsonb_array_elements(v_post -> 'more_stories') WITH ORDINALITY AS c(card, ord))
       IS DISTINCT FROM ARRAY['pricing-the-door'] THEN RAISE EXCEPTION 'more stories %', v_post -> 'more_stories'; END IF;
  FOREACH v_slug IN ARRAY ARRAY['still-a-draft', 'coming-tomorrow', 'pulled-post', 'expired-post', 'deleted-post',
                                'event-has-ended', 'nope'] LOOP
    IF public.blog_public_post(v_slug) IS NOT NULL THEN RAISE EXCEPTION 'AC-DB1: % resolved publicly', v_slug; END IF;
    IF public.blog_public_post_embeds(v_slug) <> '{}'::jsonb THEN RAISE EXCEPTION 'AC-DB8: embeds for %', v_slug; END IF;
  END LOOP;

  -- AC-DB8: embeds hold only the published version's ids, allow-listed keys.
  v_embeds := public.blog_public_post_embeds('a-slow-saturday');
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_embeds -> 'places') k)
       IS DISTINCT FROM ARRAY['41370000-0000-4000-b000-000000000001', '41370000-0000-4000-b000-000000000002'] THEN
    RAISE EXCEPTION 'AC-DB8: place ids %', v_embeds -> 'places'; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_embeds -> 'offerings') k)
       IS DISTINCT FROM ARRAY['41370000-0000-4000-d000-000000000001', '41370000-0000-4000-d000-000000000003'] THEN
    RAISE EXCEPTION 'AC-DB8: offering ids % (a draft-only event must not appear)', v_embeds -> 'offerings'; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_embeds #> '{places,41370000-0000-4000-b000-000000000001}') k)
       IS DISTINCT FROM ARRAY['city','google_maps_uri','google_place_id','name','open','primary_type_display_name','rating','review_count','stored_photo_url'] THEN
    RAISE EXCEPTION 'AC-DB8: place keys'; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_embeds #> '{offerings,41370000-0000-4000-d000-000000000001}') k)
       IS DISTINCT FROM ARRAY['city','event_type','is_public','next_end_at','next_start_at','passed','status','timezone'] THEN
    RAISE EXCEPTION 'AC-DB8: offering keys'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_path_query(v_embeds, 'strict $.**') node,
                LATERAL (SELECT jsonb_object_keys(node) AS k WHERE jsonb_typeof(node) = 'object') keys
             WHERE keys.k ~ '^(brand|cover_media|title$|description$|location_text$|organiser_contact$|online_url$)') THEN
    RAISE EXCEPTION 'AC-DB8: a host field key appeared'; END IF;
  IF v_embeds::text ~* '(Sabor Latino|sabor-latino|Bachata Thursdays|Studio, 1 Main|Private Supper|Secret address)' THEN
    RAISE EXCEPTION 'AC-DB8: host-written text leaked: %', v_embeds; END IF;
  IF (v_embeds #>> '{places,41370000-0000-4000-b000-000000000001,open}')::boolean IS NOT TRUE
     OR (v_embeds #>> '{places,41370000-0000-4000-b000-000000000002,open}')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'place open flags %', v_embeds -> 'places'; END IF;
  IF (v_embeds #>> '{offerings,41370000-0000-4000-d000-000000000001,passed}')::boolean IS NOT FALSE
     OR (v_embeds #>> '{offerings,41370000-0000-4000-d000-000000000001,is_public}')::boolean IS NOT TRUE
     OR v_embeds #>> '{offerings,41370000-0000-4000-d000-000000000001,city}' <> 'Cary'
     OR (v_embeds #>> '{offerings,41370000-0000-4000-d000-000000000003,passed}')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'offering facts %', v_embeds -> 'offerings'; END IF;

  -- Sitemap: one row per public post.
  IF (SELECT array_agg(slug ORDER BY slug) FROM public.blog_public_sitemap())
       IS DISTINCT FROM ARRAY['a-slow-saturday', 'pricing-the-door', 'quiet-post'] THEN RAISE EXCEPTION 'sitemap'; END IF;

  -- Preview: a valid token shows the draft version; a wrong or expired one shows nothing.
  v_post := public.blog_public_preview('issue4137PreviewTokenAAAAAAAAAAAAAAAAAAAAAA');
  IF v_post ->> 'title' <> 'DRAFT TITLE NOT PUBLIC' OR (v_post ->> 'preview')::boolean IS NOT TRUE
     OR NOT (v_post #> '{embeds,offerings}' ? '41370000-0000-4000-d000-000000000002')
     OR (v_post #>> '{embeds,offerings,41370000-0000-4000-d000-000000000002,is_public}')::boolean IS NOT FALSE
     OR v_post #>> '{embeds,offerings,41370000-0000-4000-d000-000000000002,city}' IS NOT NULL THEN
    RAISE EXCEPTION 'AC-P13 preview %', v_post; END IF;
  IF public.blog_public_preview('issue4137ExpiredTokenBBBBBBBBBBBBBBBBBBBBBBB') IS NOT NULL
     OR public.blog_public_preview('issue4137PreviewTokenAAAAAAAAAAAAAAAAAAAAAB') IS NOT NULL
     OR public.blog_public_preview('short') IS NOT NULL THEN RAISE EXCEPTION 'AC-P13: a bad token resolved'; END IF;

  -- The internal embeds reader is not anon's. Check the ACL directly: this
  -- local PostgreSQL build segfaults while reporting a denied SECURITY DEFINER
  -- call after SET ROLE, instead of returning insufficient_privilege.
  IF has_function_privilege(current_user, 'public.issue_4137_blog_embeds_for_version(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can call the internal embeds reader';
  END IF;
END
$t$;
RESET ROLE;

-- ── AC-DB10 (visibility half): event_end take-down ───────────────────────
DO $t$
BEGIN
  IF (SELECT take_down_at FROM public.blog_posts WHERE id = '41370000-0000-4000-f000-000000000007')
       IS DISTINCT FROM (SELECT max(end_at) FROM public.event_dates WHERE event_id = '41370000-0000-4000-d000-000000000003') THEN
    RAISE EXCEPTION 'AC-DB10: take_down_at is not the event''s last end'; END IF;
  -- Point the take-down at a future event end: the post is public until then.
  UPDATE public.blog_posts SET take_down_event_id = '41370000-0000-4000-d000-000000000001',
    take_down_at = public.issue_4137_blog_event_take_down_at('41370000-0000-4000-d000-000000000001')
  WHERE id = '41370000-0000-4000-f000-000000000007';
END
$t$;
SET LOCAL ROLE anon;
DO $t$
BEGIN
  IF public.blog_public_post('event-has-ended') IS NULL THEN RAISE EXCEPTION 'AC-DB10: post hidden before its event ends'; END IF;
END
$t$;
RESET ROLE;

-- ── Writers: every row, still no writes (AC-DB3 authenticated half) ─────
SELECT set_config('request.jwt.claim.sub', '41370000-0000-4000-a000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE probe text;
BEGIN
  IF (SELECT count(*) FROM public.blog_posts) <> 9 THEN RAISE EXCEPTION 'writer sees % posts', (SELECT count(*) FROM public.blog_posts); END IF;
  IF (SELECT count(*) FROM public.blog_post_versions) <> 10 THEN RAISE EXCEPTION 'writer versions'; END IF;
  IF (SELECT count(*) FROM public.blog_media) <> 3 THEN RAISE EXCEPTION 'writer media'; END IF;
  -- The public RPCs stay public for a writer.
  IF public.blog_public_post('still-a-draft') IS NOT NULL THEN RAISE EXCEPTION 'writer: draft resolved publicly'; END IF;
  IF (public.blog_public_index() ->> 'total')::int <> 3 THEN RAISE EXCEPTION 'writer: index widened'; END IF; -- 2 + event-has-ended, public again
  FOREACH probe IN ARRAY ARRAY[
    'SELECT review_note FROM public.blog_posts', 'SELECT source_ref FROM public.blog_media',
    'INSERT INTO public.blog_posts (slug, category_slug, created_by) VALUES (''writer-post'', ''going-out'', auth.uid())',
    'UPDATE public.blog_posts SET status = ''published''', 'DELETE FROM public.blog_posts',
    'INSERT INTO public.blog_post_versions (post_id, kind, title, created_by) VALUES (''41370000-0000-4000-f000-000000000002'', ''draft'', ''x'', auth.uid())',
    'UPDATE public.blog_post_versions SET title = ''x''',
    'INSERT INTO public.blog_media (storage_path, mime_type, width, height, bytes, source, source_ref, uploaded_by) VALUES (''x'', ''image/jpeg'', 1, 1, 1, ''mingla_owned'', ''x'', auth.uid())',
    'INSERT INTO public.blog_featured (slot, post_id, set_by) VALUES (''blog_index'', ''41370000-0000-4000-f000-000000000001'', auth.uid())',
    'DELETE FROM public.blog_featured', 'SELECT * FROM public.blog_preview_tokens'
  ] LOOP
    BEGIN
      EXECUTE probe;
      RAISE EXCEPTION 'AC-DB3: writer ran %', probe;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END
$t$;
RESET ROLE;

-- A signed-in person who is not staff sees only what anon sees.
SELECT set_config('request.jwt.claim.sub', '41370000-0000-4000-a000-000000000001', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  IF (SELECT count(*) FROM public.blog_posts) <> 4 THEN -- 3 public + event-has-ended (now public)
    RAISE EXCEPTION 'outsider sees % posts', (SELECT count(*) FROM public.blog_posts); END IF;
  IF (SELECT count(*) FROM public.blog_post_link_checks) <> 0 OR (SELECT count(*) FROM public.blog_post_audit) <> 0 THEN
    RAISE EXCEPTION 'outsider reads staff tables'; END IF;
END
$t$;
RESET ROLE;

-- ── AC-DB12: storage folder and delete policies ──────────────────────────
DO $t$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'blog-media') THEN RAISE EXCEPTION 'AC-DB12: no blog-media bucket'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'issue_4137_blog_media_%') <> 3 THEN
    RAISE EXCEPTION 'AC-DB12: expected three blog-media policies'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
             AND policyname LIKE 'issue_4137_blog_media_%' AND cmd = 'UPDATE') THEN
    RAISE EXCEPTION 'AC-DB12: an update policy exists'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'issue_4137_blog_media_publisher_delete'
      AND cmd = 'DELETE' AND roles = ARRAY['authenticated']::name[]
      AND qual LIKE '%issue_4137_blog_can_publish()%'
  ) THEN RAISE EXCEPTION 'AC-DB12: publisher-only delete policy is missing'; END IF;
END
$t$;
SELECT set_config('request.jwt.claim.sub', '41370000-0000-4000-a000-000000000002', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('blog-media', '41370000-0000-4000-a000-000000000002/41370000-0000-4000-e000-000000000009.jpg', auth.uid());
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('blog-media', '41370000-0000-4000-a000-000000000003/41370000-0000-4000-e000-000000000010.jpg', auth.uid());
    RAISE EXCEPTION 'AC-DB12: a teammate uploaded into another user''s folder';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$t$;
RESET ROLE;
-- #4114 forbids all direct SQL deletion from storage.objects. The Storage API
-- performs deletion and is fenced by the publisher-only RLS policy proved above.
SET LOCAL ROLE anon;
DO $t$
BEGIN
  INSERT INTO storage.objects (bucket_id, name) VALUES ('blog-media', 'anon/x.jpg');
  RAISE EXCEPTION 'AC-DB12: anon uploaded a blog image';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$t$;
RESET ROLE;

-- ── Wave 4 workflow: writer save/review; publisher publish/feature ───────
SELECT set_config('request.jwt.claim.sub', '41370000-0000-4000-a000-000000000002', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  v := public.issue_4137_blog_my_permissions();
  IF (v ->> 'can_write')::boolean IS NOT TRUE OR (v ->> 'can_publish')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'AC-DB4: writer permissions %', v;
  END IF;
  v := public.issue_4137_blog_update_media(
    '41370000-0000-4000-e000-000000000003','Draft image corrected','mingla_owned','UPDATED-SHOOT-REF-3');
  IF v ->> 'alt' <> 'Draft image corrected' OR v ->> 'source_ref' <> 'UPDATED-SHOOT-REF-3' THEN
    RAISE EXCEPTION 'media update %',v;
  END IF;
  BEGIN
    PERFORM public.issue_4137_blog_delete_media('41370000-0000-4000-e000-000000000003');
    RAISE EXCEPTION 'writer deleted media';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'blog_forbidden' THEN RAISE; END IF;
  END;
  v := public.issue_4137_blog_create_post('Workflow ready post', 'product-news');
  IF (v ->> 'revision')::int <> 1 OR v ->> 'slug' <> 'workflow-ready-post' THEN
    RAISE EXCEPTION 'create_post %', v;
  END IF;
  v := public.issue_4137_blog_save_draft(
    (v ->> 'id')::uuid,
    1,
    jsonb_build_object(
      'summary', 'A complete workflow fixture.',
      'cover_media_id', '41370000-0000-4000-e000-000000000001',
      'cover_alt', 'Lake at dusk',
      'seo_title', 'Workflow ready post',
      'seo_description', 'A complete workflow fixture.',
      'document', '{"version":1,"blocks":[{"id":"para41","type":"paragraph","html":"Ready to publish."}]}'::jsonb
    )
  );
  IF (v ->> 'revision')::int <> 2 THEN RAISE EXCEPTION 'save_draft %', v; END IF;
  BEGIN
    PERFORM public.issue_4137_blog_publish((v ->> 'id')::uuid, 2, now(), false);
    RAISE EXCEPTION 'AC-DB4: writer published';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'blog_forbidden' THEN RAISE; END IF;
  END;
  v := public.issue_4137_blog_submit_for_review((v ->> 'id')::uuid, 2);
  IF v ->> 'status' <> 'in_review' OR (v ->> 'revision')::int <> 3 THEN RAISE EXCEPTION 'submit %', v; END IF;
END
$t$;
RESET ROLE;

-- The link checker is the only service-role writer of receipts.
INSERT INTO public.blog_post_link_checks(post_id, version_id, ok, results, checked_by)
SELECT post.id, post.draft_version_id, true, '[]'::jsonb, '41370000-0000-4000-a000-000000000003'
FROM public.blog_posts post WHERE post.slug='workflow-ready-post';

SELECT set_config('request.jwt.claim.sub', '41370000-0000-4000-a000-000000000003', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; v_post uuid; v_public jsonb;
BEGIN
  v := public.issue_4137_blog_my_permissions();
  IF (v ->> 'can_publish')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'AC-DB4: lead permissions %',v; END IF;
  BEGIN
    PERFORM public.issue_4137_blog_delete_media('41370000-0000-4000-e000-000000000001');
    RAISE EXCEPTION 'in-use media deleted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'blog_media_in_use' THEN RAISE; END IF;
  END;
  SELECT id INTO v_post FROM public.blog_posts WHERE slug='workflow-ready-post';
  v := public.issue_4137_blog_publish(v_post,3,now(),true);
  IF v #>> '{post,status}' <> 'published' OR (v #>> '{post,revision}')::int<>4 THEN RAISE EXCEPTION 'publish %',v; END IF;
  IF public.issue_4137_blog_featured_now() ->> 'post_id' <> v_post::text THEN RAISE EXCEPTION 'AC-DB9: feature missing'; END IF;
  v_public := public.blog_public_post('workflow-ready-post');
  IF v_public ->> 'title' <> 'Workflow ready post' THEN RAISE EXCEPTION 'AC-DB7: public payload %',v_public; END IF;
END
$t$;
RESET ROLE;

-- Editing after publish changes only the draft; stale writes are PT409 and atomic.
SELECT set_config('request.jwt.claim.sub', '41370000-0000-4000-a000-000000000002', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_post uuid; v jsonb; v_before jsonb;
BEGIN
  SELECT id INTO v_post FROM public.blog_posts WHERE slug='workflow-ready-post';
  v_before:=public.blog_public_post('workflow-ready-post');
  v:=public.issue_4137_blog_save_draft(v_post,4,jsonb_build_object('title','Changed draft only'));
  IF (v ->> 'revision')::int<>5 OR public.blog_public_post('workflow-ready-post')->>'title'<>'Workflow ready post' THEN
    RAISE EXCEPTION 'AC-DB7: draft changed live post';
  END IF;
  BEGIN
    PERFORM public.issue_4137_blog_save_draft(v_post,4,jsonb_build_object('title','Stale overwrite'));
    RAISE EXCEPTION 'AC-DB5: stale save succeeded';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  IF public.issue_4137_blog_get_post(v_post) #>> '{draft,title}'<>'Changed draft only' THEN
    RAISE EXCEPTION 'AC-DB5: stale write mutated the draft';
  END IF;
  IF jsonb_array_length(public.issue_4137_blog_list_posts(NULL,'Workflow',50,0)->'posts')<>1 THEN RAISE EXCEPTION 'list_posts search'; END IF;
  IF public.issue_4137_blog_get_post(v_post) #>> '{draft,title}'<>'Changed draft only' THEN RAISE EXCEPTION 'get_post'; END IF;
END
$t$;
RESET ROLE;

-- A not-ready post reports stable readiness ids and cannot publish.
SELECT set_config('request.jwt.claim.sub', '41370000-0000-4000-a000-000000000003', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_post uuid; v_detail text;
BEGIN
  SELECT id INTO v_post FROM public.blog_posts WHERE slug='still-a-draft';
  BEGIN
    PERFORM public.issue_4137_blog_publish(v_post,1,now(),false);
    RAISE EXCEPTION 'AC-DB6: incomplete post published';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_detail=PG_EXCEPTION_DETAIL;
    IF SQLERRM<>'blog_not_ready' OR v_detail::jsonb ?& ARRAY['cover_present','cover_size','links_live'] IS NOT TRUE THEN
      RAISE EXCEPTION 'AC-DB6: readiness % / %',SQLERRM,v_detail;
    END IF;
  END;
END
$t$;
RESET ROLE;

SELECT 'PASS #4137 blog data model: public reads published-only, no table writes, allow-listed embeds, predicates, storage folders' AS result;
ROLLBACK;
