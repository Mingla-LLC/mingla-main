\set ON_ERROR_STOP on
-- #4636 build 2: the website CMS storage, executable PostgreSQL 17 proof (happy path), after the replay.
-- MINGLA-INVARIANT: I-4636-ONE-BLOCK-REGISTRY | issue #4636 | the database validates block lists against site_block_registry(), a parity-tested copy of mingla-marketing/lib/site-blocks/registry.json.
-- MINGLA-INVARIANT: I-4636-NO-ADDRESS-COLLISION | issue #4636 | a staff-made page address never starts with a segment the coded site answers (site_reserved_segments(), parity-tested against the app routes).
--
-- H-1  the registry copy is present (version 1, 41 blocks) and the reserved list covers the coded routes.
-- H-2  a converted page (home) saves, publishes and restores a block list; the anon read returns one page
--      (site_public_page) and site_public_content() no longer carries block lists.
-- H-3  a staff-made page: create at /summer-socials, preview, publish, appears in the anon index, SEO fields,
--      delete = unpublish with a redirect to /, and its content stops being public.
-- H-4  the site-wide nav and footer ('site-settings') go through draft, publish and history.
-- H-5  the media library: library uploads, register (bytes from storage), list, use in a block, public media
--      map, usage meter, archive refused while live.
-- H-6  view-only staff read state and get a preview token of the LIVE content (F-4); editors preview drafts.
--
-- FAILS-ON-REVERT: dropping `sections` from site_validate_content's key list fails H-2 (unknown_key);
-- removing the status flip in site_page_put_live fails H-3 (index stays empty); the forms_can_view branch of
-- admin_site_page_create_preview_token fails H-6 (42501); site_media_map fails H-5 (empty media map).

CREATE OR REPLACE FUNCTION pg_temp.c_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4636 site cms FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.c_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END
$a$;

BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb;
DO $t$
DECLARE
  v_web    constant uuid := '46360000-0000-4000-c000-000000000001';
  v_growth constant uuid := '46360000-0000-4000-c000-000000000003';
  v_img    constant uuid := '46360000-0000-4000-c000-0000000000a1';
  v_vid    constant uuid := '46360000-0000-4000-c000-0000000000a2';
  v jsonb; v_rev integer; v_key text; v_june text; v_pub jsonb; v_tok text; v_sections jsonb; v_custom jsonb;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data) VALUES
    (v_web, 's4636-web@mingla-fixture.org', now(), '{"full_name":"Seth"}'),
    (v_growth, 's4636-growth@mingla-fixture.org', now(), '{}');
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES
    ('s4636-web@mingla-fixture.org', 'website', 'active', now()),
    ('s4636-growth@mingla-fixture.org', 'growth', 'active', now());

  -- ── H-1 ──
  PERFORM pg_temp.c_assert((public.site_block_registry()->>'registry_version')::integer = 1
                       AND jsonb_array_length(public.site_block_registry()->'blocks') = 41, 'H-1 the registry copy: version 1, 41 blocks');
  PERFORM pg_temp.c_assert(public.site_reserved_segments() @> ARRAY['host','blog','api','about','creators','site-preview','tools'],
    'H-1 the reserved list covers the coded routes');

  v_sections := jsonb_build_array(
    jsonb_build_object('type', 'answer', 'version', 1, 'content', jsonb_build_object('question', 'What is Mingla?', 'answer', 'A plans app.')),
    jsonb_build_object('type', 'marquee', 'version', 1, 'content', jsonb_build_object('words', jsonb_build_array('Dinner', 'Gigs', 'Walks'))),
    jsonb_build_object('type', 'paras', 'version', 1, 'colour', 'paper', 'hidden', true, 'id', 'why-1',
                       'content', jsonb_build_object('heading', 'Why *we exist.*', 'paragraphs', jsonb_build_array('Because plans matter.'))));

  -- ── H-2: a converted page ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.c_as(v_web);
  v := public.admin_site_page_save_draft('home', 0, jsonb_build_object('sections', v_sections));
  PERFORM pg_temp.c_assert((v->>'rev')::integer = 1, 'H-2 a block list saves as a draft (rev 1)');
  v := public.admin_site_page_save_draft('home', 1, jsonb_build_object('sections', v_sections || jsonb_build_array(
    jsonb_build_object('type', 'wideClip', 'version', 1, 'content', jsonb_build_object('media', 'v:amb-about')))));
  PERFORM pg_temp.c_assert((v->>'rev')::integer = 2, 'H-2 the next save bumps the rev');
  v := public.admin_site_pages_state();
  PERFORM pg_temp.c_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'page_key' = 'home' AND (x->'draft'->>'changes')::integer = 4),
    'H-2 the state counts four changed blocks against the empty live page');
  v := public.admin_site_page_publish('home', 0, 'first block list');
  PERFORM pg_temp.c_assert((v->>'version')::integer = 1, 'H-2 publish makes version 1');
  PERFORM public.admin_site_page_save_draft('home', 0, jsonb_build_object('sections', v_sections));
  v := public.admin_site_page_publish('home', 1, 'drop the clip');
  v := public.admin_site_page_restore('home', 1, 2);
  PERFORM pg_temp.c_assert((v->>'version')::integer = 3, 'H-2 restore makes version 3');
  v := public.admin_site_page_history('home');
  PERFORM pg_temp.c_assert(jsonb_array_length(v) = 3 AND v->0->'sections' = '["answer","marquee","paras","wideClip"]'::jsonb
                       AND (v->0->>'restored_from')::integer = 1, 'H-2 history lists each version''s block types');
  SET LOCAL ROLE anon;
  v_pub := public.site_public_page('home');
  PERFORM pg_temp.c_assert((v_pub->>'version')::integer = 3 AND jsonb_array_length(v_pub->'sections') = 4,
    'H-2 the anon page read returns the live block list');
  PERFORM pg_temp.c_assert(public.site_public_page('support') IS NULL, 'H-2 a page that is not converted has no block list');
  v := public.site_public_content();
  PERFORM pg_temp.c_assert(v->'pages' ? 'home' AND NOT (v->'pages'->'home' ? 'sections'),
    'H-2 site_public_content() keeps the #4452 parts and leaves block lists out');
  RESET ROLE;

  -- ── H-5 (first half): the media library ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.c_as(v_web);
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
    ('site-media', 'library/' || v_img || '.jpg', v_web, '{"size":"420000","mimetype":"image/jpeg"}'),
    ('site-media', 'library/' || v_img || '_thumb.jpg', v_web, '{"size":"21000","mimetype":"image/jpeg"}'),
    ('site-video', 'library/' || v_vid || '.mp4', v_web, '{"size":"9000000","mimetype":"video/mp4"}'),
    ('site-media', 'library/' || v_vid || '_poster.jpg', v_web, '{"size":"30000","mimetype":"image/jpeg"}');
  PERFORM pg_temp.c_assert(true, 'H-5 an editor uploads library images, thumbs, a clip and its poster');
  v := public.admin_site_media_register(v_img, 'image', 2400, 1600, NULL, 'Friends at a rooftop dinner');
  PERFORM pg_temp.c_assert(v->>'ref' = 'm:' || v_img AND (v->>'bytes')::bigint = 441000 AND v->>'kind' = 'image',
    'H-5 register reads the bytes from storage (image + thumb)');
  v := public.admin_site_media_register(v_img, 'image', 2400, 1600, NULL, 'Friends at a rooftop dinner');
  PERFORM pg_temp.c_assert(v->>'id' = v_img::text, 'H-5 a retried register returns the same item');
  v := public.admin_site_media_register(v_vid, 'video', 1920, 1080, 42.5, 'A night market in Lagos');
  PERFORM pg_temp.c_assert(v->>'kind' = 'video' AND (v->>'duration_seconds')::numeric = 42.5 AND v->>'bucket' = 'site-video',
    'H-5 a 42.5 s clip registers in site-video');
  v := public.admin_site_media_list(NULL, false, 50);
  PERFORM pg_temp.c_assert(jsonb_array_length(v) >= 2, 'H-5 the library lists both items');
  v := public.admin_site_media_usage();
  PERFORM pg_temp.c_assert(v->>'state' = 'ok' AND (v->>'limit_bytes')::bigint = 5368709120
                       AND (v->>'block_bytes')::bigint = 4831838208 AND (v->>'warn_bytes')::bigint = 3758096384,
    'H-5 the meter: 5 GB, warn at 70 %, block at 90 %');
  v := public.admin_site_media_update(v_img, 'Friends at dinner on a rooftop');
  PERFORM pg_temp.c_assert(v->>'alt' = 'Friends at dinner on a rooftop', 'H-5 alt text can be changed');

  -- ── H-3: a staff-made page ──
  v_custom := public.admin_site_page_create('/summer-socials', 'Summer socials', 'landing', jsonb_build_array(
    jsonb_build_object('type', 'wideClip', 'version', 1, 'content', jsonb_build_object('media', 'm:' || v_vid)),
    jsonb_build_object('type', 'answer', 'version', 1, 'content', jsonb_build_object('question', 'What is on?', 'answer', 'Rooftop dinners.'))));
  v_key := v_custom->>'page_key';
  PERFORM pg_temp.c_assert(v_key ~ '^p-[0-9a-f]{12}$' AND v_custom->>'status' = 'draft' AND (v_custom->>'draft_rev')::integer = 1,
    'H-3 a landing page is created at /summer-socials with a draft');
  v_june := (public.admin_site_page_create('/summer-socials/june', 'June', 'blank', NULL))->>'page_key';
  PERFORM pg_temp.c_assert(true, 'H-3 a two-segment address under an unreserved word is allowed');
  v := public.admin_site_page_create_preview_token(v_key, (public.admin_site_page_get(v_key))->'draft_content');
  v_tok := v->>'token';
  SET LOCAL ROLE anon;
  PERFORM pg_temp.c_assert(public.site_public_page(v_key) IS NULL, 'H-3 a draft page is not public');
  PERFORM pg_temp.c_assert(NOT (public.site_public_custom_index()::text LIKE '%summer-socials%'), 'H-3 nor in the index');
  v := public.site_public_preview(v_tok);
  PERFORM pg_temp.c_assert(v->'custom'->>'path' = '/summer-socials' AND v->'media' ? v_vid::text,
    'H-3 its preview carries the address and the library clip');
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.c_as(v_web);
  v := public.admin_site_page_update_meta(v_key, jsonb_build_object('seo_description', 'Rooftop dinners all summer.',
         'share_media_id', v_img, 'show_in_menu', true));
  PERFORM pg_temp.c_assert(v->>'seo_description' = 'Rooftop dinners all summer.' AND (v->>'show_in_menu')::boolean, 'H-3 SEO fields save');
  v := public.admin_site_page_update_meta(v_key, jsonb_build_object('path', '/summer-nights'));
  PERFORM pg_temp.c_assert(v->>'path' = '/summer-nights', 'H-3 the address can change before the first publish');
  PERFORM public.admin_site_page_update_meta(v_key, jsonb_build_object('path', '/summer-socials'));
  v := public.admin_site_page_publish(v_key, 0, 'launch');
  PERFORM pg_temp.c_assert((v->>'version')::integer = 1, 'H-3 the page publishes');
  SET LOCAL ROLE anon;
  v := public.site_public_custom_index();
  PERFORM pg_temp.c_assert(jsonb_array_length(v) = 1 AND v->0->>'path' = '/summer-socials' AND v->0->>'status' = 'live'
                       AND v->0->>'description' = 'Rooftop dinners all summer.' AND v->0->'share'->>'path' = 'library/' || v_img || '.jpg'
                       AND NOT (v->0->>'hide_from_search')::boolean,
    'H-3 the live page is in the index with its SEO fields and share image (the draft-only June page is not)');
  v_pub := public.site_public_page(v_key);
  PERFORM pg_temp.c_assert(jsonb_array_length(v_pub->'sections') = 2 AND v_pub->'media'->v_vid::text->>'path' = 'library/' || v_vid || '.mp4',
    'H-3 / H-5 the page read returns its blocks and the media map for its library clip');
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.c_as(v_web);
  v := public.admin_site_media_list(NULL, false, 50);
  PERFORM pg_temp.c_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'id' = v_vid::text AND (x->>'in_use')::boolean),
    'H-5 the clip shows as in use');
  v := public.admin_site_page_delete(v_key, '/');
  PERFORM pg_temp.c_assert(v->>'status' = 'unpublished' AND v->>'redirect_to' = '/', 'H-3 delete unpublishes with a redirect to Home');
  SET LOCAL ROLE anon;
  v := public.site_public_custom_index();
  PERFORM pg_temp.c_assert(v->0->>'status' = 'unpublished' AND v->0->>'redirect_to' = '/', 'H-3 the index now answers a redirect');
  PERFORM pg_temp.c_assert(public.site_public_page(v_key) IS NULL, 'H-3 the deleted page''s blocks are no longer public');
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.c_as(v_web);
  v := public.admin_site_page_restore(v_key, 1, 0);
  PERFORM pg_temp.c_assert((public.admin_site_page_get(v_key))->'custom'->>'status' = 'live', 'H-3 restoring a version brings it back live');
  v := public.admin_site_page_delete(v_june, '/');
  PERFORM pg_temp.c_assert((v->>'deleted')::boolean, 'H-3 a never-published page is removed outright');

  -- ── H-4: the site-wide nav and footer ──
  v := public.admin_site_page_save_draft('site-settings', 0, jsonb_build_object(
    'nav', jsonb_build_object('top', jsonb_build_array(jsonb_build_object('label', 'Going out', 'to', '/going-out'),
                                                       jsonb_build_object('label', 'Summer', 'to', '/summer-socials')),
                              'menu', jsonb_build_array(jsonb_build_object('title', 'Explore', 'links', jsonb_build_array(
                                        jsonb_build_object('label', 'Home', 'to', '/'))))),
    'footer', jsonb_build_object('columns', jsonb_build_array(jsonb_build_object('title', 'Company', 'links', jsonb_build_array(
                                   jsonb_build_object('label', 'Careers', 'to', 'https://career.usemingla.com'),
                                   jsonb_build_object('label', 'Email us', 'to', 'mailto:hello@usemingla.com')))),
                                 'tagline', 'Making real life easier to find.')));
  PERFORM pg_temp.c_assert((v->>'rev')::integer = 1, 'H-4 a nav and footer draft saves');
  v := public.admin_site_page_publish('site-settings', 0, 'menu');
  SET LOCAL ROLE anon;
  v := public.site_public_page('site-settings');
  PERFORM pg_temp.c_assert(v->'nav'->'top'->1->>'to' = '/summer-socials' AND v->'footer'->>'tagline' = 'Making real life easier to find.',
    'H-4 the published nav and footer are public');
  PERFORM pg_temp.c_assert(NOT (public.site_public_content()->'pages' ? 'site-settings'), 'H-4 settings stay out of the page map');
  RESET ROLE;

  -- ── H-6: view-only staff ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.c_as(v_web);
  PERFORM public.admin_site_page_save_draft('home', 0, jsonb_build_object('sections', jsonb_build_array(
    jsonb_build_object('type', 'answer', 'version', 1, 'content', jsonb_build_object('question', 'Unpublished?', 'answer', 'DRAFT ONLY WORDS')))));
  v := public.admin_site_page_create_preview_token('home', (public.admin_site_page_get('home'))->'draft_content');
  PERFORM pg_temp.c_assert(NOT (v->>'live_only')::boolean, 'H-6 an editor previews the draft');
  PERFORM pg_temp.c_as(v_growth);
  v := public.admin_site_pages_state();
  PERFORM pg_temp.c_assert(jsonb_typeof(v) = 'array', 'H-6 view-only staff read the page state');
  v := public.admin_site_page_get('home');
  PERFORM pg_temp.c_assert(v->'draft_content' = 'null'::jsonb AND NOT (v->>'can_edit')::boolean AND v->'live_content' ? 'sections',
    'H-6 view-only staff see the live page and no draft');
  v := public.admin_site_page_create_preview_token('home', jsonb_build_object('sections', jsonb_build_array(
    jsonb_build_object('type', 'answer', 'version', 1, 'content', jsonb_build_object('question', 'Sneaky?', 'answer', 'VIEWER WORDS')))));
  v_tok := v->>'token';
  PERFORM pg_temp.c_assert((v->>'live_only')::boolean AND length(v_tok) = 43, 'H-6 view-only staff get a live-only preview token');
  SET LOCAL ROLE anon;
  v := public.site_public_preview(v_tok);
  PERFORM pg_temp.c_assert(v->>'page_key' = 'home' AND (v->'content')::text NOT LIKE '%VIEWER WORDS%' AND (v->'content')::text NOT LIKE '%DRAFT ONLY%'
                       AND jsonb_array_length(v->'content'->'sections') = 4,
    'H-6 that token shows the live content, never what they sent or the draft');
  RESET ROLE;
END
$t$;
ROLLBACK;
