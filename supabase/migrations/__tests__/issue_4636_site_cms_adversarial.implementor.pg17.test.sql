\set ON_ERROR_STOP on
-- #4636 build 2: the website CMS storage, executable PostgreSQL 17 proof (adversarial), after the replay.
-- A distinct angle from the happy file: every write a non-editor, a stranger or a malformed payload might try.
--
-- A-1  non-editors (view-only staff, anon) cannot write: save, publish, create, update, delete, register, archive.
-- A-2  invalid blocks are refused by the database even when sent straight to the RPC: unknown type, <script>,
--      a colour the section has no style for (sand, night on marquee), a newer block version, 41 blocks, an
--      unknown library id, a javascript: link, an unknown field, two heroes, a form that does not exist.
-- A-3  block lists only on converted and staff-made pages; settings refuse unsafe links and unknown keys.
-- A-4  address collisions: reserved words (/host, /blog/x, /api, /site-preview), a taken address, uppercase,
--      three segments, dots; the address is locked once published.
-- A-5  a stale draft rev and a stale publish raise PT409; versions stay append-only.
-- A-6  the storage allowance: at 90 % of 5 GB every upload into the site buckets is refused (RESTRICTIVE
--      policy), the meter says blocked; a clip over 60 s and an unuploaded file do not register.
-- A-7  a view-only preview never carries a draft; a draft-only staff-made page never leaks to anon reads.
--
-- FAILS-ON-REVERT: removing the colour check in site_block_errors fails A-2 (sand accepted); removing
-- issue_4636_site_media_quota fails A-6; removing the reserved-segment test in site_custom_path_error fails A-4.

CREATE OR REPLACE FUNCTION pg_temp.a_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4636 site cms adversarial FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.a_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.a_err(p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $a$
DECLARE v_state text; v_msg text; v_detail text;
BEGIN
  EXECUTE p_sql;
  RETURN jsonb_build_object('state', 'ok');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
  RETURN jsonb_build_object('state', v_state, 'message', v_msg, 'detail', v_detail);
END
$a$;
-- Saving one block on 'home' as the current user: the error (or ok).
CREATE OR REPLACE FUNCTION pg_temp.a_block(p_block jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $a$
BEGIN
  RETURN pg_temp.a_err(format($$SELECT public.admin_site_page_save_draft('about', 0, %L::jsonb)$$,
                              jsonb_build_object('sections', jsonb_build_array(p_block))));
END
$a$;

BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb;
DO $t$
DECLARE
  v_web    constant uuid := '46360000-0000-4000-a000-000000000001';
  v_web2   constant uuid := '46360000-0000-4000-a000-000000000002';
  v_growth constant uuid := '46360000-0000-4000-a000-000000000003';
  v_big    constant uuid := '46360000-0000-4000-a000-0000000000b1';
  v_ok     jsonb := jsonb_build_object('type', 'answer', 'version', 1, 'content', jsonb_build_object('question', 'Q?', 'answer', 'A.'));
  v jsonb; v_e jsonb; v_key text; v_tok text;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data) VALUES
    (v_web, 'a4636-web@mingla-fixture.org', now(), '{"full_name":"Seth"}'),
    (v_web2, 'a4636-web2@mingla-fixture.org', now(), '{"full_name":"Abi"}'),
    (v_growth, 'a4636-growth@mingla-fixture.org', now(), '{}');
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES
    ('a4636-web@mingla-fixture.org', 'website', 'active', now()), ('a4636-web2@mingla-fixture.org', 'website', 'active', now()),
    ('a4636-growth@mingla-fixture.org', 'growth', 'active', now());

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.a_as(v_web);
  v := public.admin_site_page_create('/rooftops', 'Rooftops', 'story', jsonb_build_array(v_ok));
  v_key := v->>'page_key';

  -- ── A-1: non-editors cannot write ──
  PERFORM pg_temp.a_as(v_growth);
  v_e := pg_temp.a_err($$SELECT public.admin_site_page_save_draft('home', 0, '{"sections":[]}'::jsonb)$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-1 view-only staff cannot save a block list');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_publish(%L, 0, NULL)$$, v_key));
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-1 nor publish');
  v_e := pg_temp.a_err($$SELECT public.admin_site_page_create('/my-page', 'Mine', 'blank', NULL)$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-1 nor create a page');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_update_meta(%L, '{"name":"x"}'::jsonb)$$, v_key));
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-1 nor change its settings');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_delete(%L, '/')$$, v_key));
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-1 nor delete it');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_media_register(%L, 'image', 10, 10, NULL, 'x')$$, gen_random_uuid()));
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-1 nor register media');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_media_archive(%L)$$, gen_random_uuid()));
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-1 nor archive media');
  v_e := pg_temp.a_err(format($$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('site-media', %L, %L)$$,
                              'library/' || gen_random_uuid() || '.jpg', v_growth));
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-1 nor upload into the library');
  v_e := pg_temp.a_err($$SELECT count(*) FROM public.site_custom_pages$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-1 the tables are closed to direct reads (RPCs only)');
  RESET ROLE;
  -- anon holds no EXECUTE on any admin RPC (checked as a privilege: calling one as anon is a plain 42501).
  PERFORM pg_temp.a_assert(NOT has_function_privilege('anon', p.oid, 'EXECUTE'), 'A-1 anon cannot call ' || p.proname)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (p.proname LIKE 'admin\_site\_%' OR p.proname IN ('site_media_usage_bytes', 'site_media_map',
          'site_custom_path_error', 'site_sections_errors', 'site_block_errors'));
  PERFORM pg_temp.a_assert(has_function_privilege('anon', 'public.site_public_page(text)', 'EXECUTE')
                       AND has_function_privilege('anon', 'public.site_public_custom_index()', 'EXECUTE'), 'A-1 anon reads only the two public reads');
  PERFORM pg_temp.a_assert(NOT has_table_privilege('anon', 'public.site_media', 'SELECT')
                       AND NOT has_table_privilege('authenticated', 'public.site_custom_pages', 'INSERT'), 'A-1 no direct table access');

  -- ── A-2: invalid blocks, straight to the RPC ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.a_as(v_web);
  v_e := pg_temp.a_block(v_ok);
  PERFORM pg_temp.a_assert(v_e->>'state' = 'ok', 'A-2 control: a valid block saves');
  PERFORM public.admin_site_page_discard_draft('about');
  v_e := pg_temp.a_block('{"type":"carousel3d","version":1,"content":{}}');
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'message' = 'invalid_content' AND v_e->>'detail' LIKE '%unknown block%',
    'A-2 an unknown block type is refused');
  v_e := pg_temp.a_block(jsonb_set(v_ok, '{content,answer}', '"<script>alert(1)</script>"'));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%contains < or >%', 'A-2 HTML in a text field is refused');
  v_e := pg_temp.a_block(v_ok || '{"colour":"sand"}');
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%block.colour%', 'A-2 a colour the section has no style for (sand) is refused');
  v_e := pg_temp.a_block('{"type":"marquee","version":1,"colour":"night","content":{"words":["a","b","c"]}}');
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%block.colour%', 'A-2 night on a paper-only block is refused');
  v_e := pg_temp.a_block(jsonb_set(v_ok, '{version}', '2'));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%newer than this site knows%', 'A-2 a newer block version is refused');
  v_e := pg_temp.a_block(jsonb_set(v_ok, '{content,answer}', to_jsonb(repeat('x', 601))));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%longer than 600%', 'A-2 an over-limit field is refused');
  v_e := pg_temp.a_block(jsonb_set(v_ok, '{content,extra}', '"x"'));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%unknown field%', 'A-2 an unknown field is refused');
  v_e := pg_temp.a_block(jsonb_build_object('type', 'wideClip', 'version', 1, 'content', jsonb_build_object('media', 'm:' || gen_random_uuid())));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%not in the media library%', 'A-2 an unknown library id is refused');
  v_e := pg_temp.a_block('{"type":"wideClip","version":1,"content":{"media":"https://evil.example/x.mp4"}}');
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%not a media reference%', 'A-2 a raw URL is not a media reference');
  v_e := pg_temp.a_block('{"type":"stillStuck","version":1,"content":{"heading":"Stuck?","lead":"Ask.","primary":{"label":"Go","to":"javascript:alert(1)"},"secondary":{"label":"Go","to":"/help"}}}');
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%not an internal path%', 'A-2 a javascript: link is refused');
  v_e := pg_temp.a_block('{"type":"form","version":1,"content":{"formId":"46360000-0000-4000-a000-00000000ffff"}}');
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%bad_form%', 'A-2 a form block needs a real form');
  v_e := pg_temp.a_err($$SELECT public.admin_site_page_save_draft('about', 0, jsonb_build_object('sections',
    jsonb_build_array('{"type":"heroWords","version":1,"content":{"title":"A","lead":"B","primary":{"to":"app:explorer"}}}'::jsonb,
                      '{"type":"heroWords","version":1,"content":{"title":"A","lead":"B","primary":{"to":"app:explorer"}}}'::jsonb)))$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%over_page_limit%', 'A-2 two of a one-per-page block are refused');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_save_draft('about', 0, %L::jsonb)$$,
    jsonb_build_object('sections', (SELECT jsonb_agg(v_ok) FROM generate_series(1, 41)))));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%too_many_blocks%', 'A-2 41 blocks are refused');
  v_e := pg_temp.a_block(v_ok || '{"hidden":"yes"}');
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023', 'A-2 hidden must be true or false');

  -- ── A-3: where block lists and settings may go ──
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_save_draft('support', 0, %L::jsonb)$$, jsonb_build_object('sections', jsonb_build_array(v_ok))));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%sections_not_editable%', 'A-3 a page that is not converted takes no block list');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_save_draft('p-000000000000', 0, %L::jsonb)$$, jsonb_build_object('sections', jsonb_build_array(v_ok))));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%unknown_page%', 'A-3 nor a made-up staff page key');
  v_e := pg_temp.a_err($$SELECT public.admin_site_page_save_draft('site-settings', 0,
    '{"nav":{"top":[{"label":"Hi","to":"javascript:alert(1)"}],"menu":[{"title":"X","links":[{"label":"Y","to":"/"}]}]}}'::jsonb)$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%bad_settings%', 'A-3 a nav link to javascript: is refused');
  v_e := pg_temp.a_err($$SELECT public.admin_site_page_save_draft('site-settings', 0, '{"sections":[]}'::jsonb)$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%unknown_key%', 'A-3 settings take only nav and footer');
  v_e := pg_temp.a_err($$SELECT public.admin_site_page_save_draft('site-settings', 0,
    '{"footer":{"columns":[{"title":"<b>X</b>","links":[{"label":"Y","to":"/"}]}]}}'::jsonb)$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023', 'A-3 markup in a footer title is refused');

  -- ── A-4: addresses ──
  FOR v IN SELECT to_jsonb(x) FROM unnest(ARRAY['/host', '/blog/x', '/api', '/site-preview', '/creators/new', '/careers']) x LOOP
    v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_create(%L, 'X', 'blank', NULL)$$, v #>> '{}'));
    PERFORM pg_temp.a_assert(v_e->>'state' = 'PT409' AND v_e->>'message' = 'path_reserved', format('A-4 %s is reserved', v #>> '{}'));
  END LOOP;
  v_e := pg_temp.a_err($$SELECT public.admin_site_page_create('/rooftops', 'Again', 'blank', NULL)$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = 'PT409' AND v_e->>'message' = 'path_taken', 'A-4 a taken address is refused');
  FOR v IN SELECT to_jsonb(x) FROM unnest(ARRAY['/Summer', '/a/b/c', '/../etc', '/x..y', 'summer', '/', '/a_b', '/-a', '/a-', '/a--b']) x LOOP
    v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_create(%L, 'X', 'blank', NULL)$$, v #>> '{}'));
    PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'message' = 'bad_path', format('A-4 %s is not an address', v #>> '{}'));
  END LOOP;
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_update_meta(%L, '{"path":"/host"}'::jsonb)$$, v_key));
  PERFORM pg_temp.a_assert(v_e->>'state' = 'PT409' AND v_e->>'message' = 'path_reserved', 'A-4 renaming into a reserved address is refused');
  PERFORM public.admin_site_page_publish(v_key, 0, NULL);
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_update_meta(%L, '{"path":"/rooftops-2"}'::jsonb)$$, v_key));
  PERFORM pg_temp.a_assert(v_e->>'state' = 'PT409' AND v_e->>'message' = 'path_locked', 'A-4 a published address is locked');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_delete(%L, '/rooftops')$$, v_key));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'message' = 'redirect_to_self', 'A-4 a page cannot redirect to itself');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_delete(%L, 'https://evil.example')$$, v_key));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'message' = 'bad_redirect', 'A-4 a redirect stays on the site');
  v_e := pg_temp.a_err($$SELECT public.admin_site_page_delete('home', '/')$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = 'P0002', 'A-4 a coded page cannot be deleted');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_update_meta(%L, '{"status":"live"}'::jsonb)$$, v_key));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023', 'A-4 status is not a settable field');

  -- ── A-5: conflicts and append-only versions ──
  PERFORM public.admin_site_page_save_draft('home', 0, jsonb_build_object('sections', jsonb_build_array(v_ok)));
  PERFORM pg_temp.a_as(v_web2);
  PERFORM public.admin_site_page_save_draft('home', 1, jsonb_build_object('sections', jsonb_build_array(v_ok, v_ok)));
  PERFORM pg_temp.a_as(v_web);
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_page_save_draft('home', 1, %L::jsonb)$$, jsonb_build_object('sections', '[]'::jsonb)));
  PERFORM pg_temp.a_assert(v_e->>'state' = 'PT409' AND v_e->>'message' = 'page_draft_conflict', 'A-5 a stale draft rev is a PT409 clash, nothing overwritten');
  PERFORM pg_temp.a_assert(jsonb_array_length((public.admin_site_page_get('home'))->'draft_content'->'sections') = 2, 'A-5 Abi''s draft survives');
  PERFORM pg_temp.a_as(v_web2);
  PERFORM public.admin_site_page_publish('home', 0, 'Abi first');
  PERFORM public.admin_site_page_save_draft('home', 0, jsonb_build_object('sections', jsonb_build_array(v_ok)));
  PERFORM pg_temp.a_as(v_web);
  v_e := pg_temp.a_err($$SELECT public.admin_site_page_publish('home', 0, NULL)$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = 'PT409' AND (v_e->>'detail')::jsonb->>'code' = 'page_conflict'
                       AND (v_e->>'detail')::jsonb->>'published_by' = 'Abi', 'A-5 a stale publish is a PT409 page_conflict');
  RESET ROLE;
  v_e := pg_temp.a_err($$UPDATE public.site_page_versions SET content = '{"sections":[]}' WHERE page_key = 'home'$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-5 a published block list cannot be rewritten');
  v_e := pg_temp.a_err($$DELETE FROM public.site_page_versions WHERE page_key = 'home'$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-5 nor deleted');

  -- ── A-6: the allowance ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.a_as(v_web);
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_media_register(%L, 'image', 10, 10, NULL, 'Never uploaded')$$, gen_random_uuid()));
  PERFORM pg_temp.a_assert(v_e->>'state' = 'P0002' AND v_e->>'message' = 'media_not_uploaded', 'A-6 a file that is not in storage does not register');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_media_register(%L, 'video', 10, 10, 61, 'Long clip')$$, gen_random_uuid()));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'message' = 'video_too_long', 'A-6 a clip over 60 seconds is refused');
  v_e := pg_temp.a_err(format($$SELECT public.admin_site_media_register(%L, 'image', 10, 10, NULL, '<img>')$$, gen_random_uuid()));
  PERFORM pg_temp.a_assert(v_e->>'state' = '22023' AND v_e->>'message' = 'bad_alt', 'A-6 alt text is plain words');
  v_e := pg_temp.a_err(format($$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('site-video', %L, %L)$$,
                              'library/' || gen_random_uuid() || '.mov', v_web));
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-6 only library/<id>.mp4 goes into site-video');
  v_e := pg_temp.a_err(format($$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('site-media', %L, %L)$$,
                              'library/' || gen_random_uuid() || '.jpg', v_web));
  PERFORM pg_temp.a_assert(v_e->>'state' = 'ok', 'A-6 control: below 90 % the same upload goes through');
  RESET ROLE;
  -- Somebody's 4.9 GB already sits in the site buckets (service role, outside the policies).
  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES ('site-video', 'library/' || v_big || '.mp4', v_web, '{"size":"4900000000"}');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.a_as(v_web);
  PERFORM pg_temp.a_assert((public.admin_site_media_usage())->>'state' = 'blocked', 'A-6 the meter says blocked at 90 %');
  v_e := pg_temp.a_err(format($$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('site-media', %L, %L)$$,
                              'library/' || gen_random_uuid() || '.jpg', v_web));
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-6 a library upload is refused by the database at 90 %');
  v_e := pg_temp.a_err(format($$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('site-media', %L, %L)$$,
                              v_web || '/form-photo.jpg', v_web));
  PERFORM pg_temp.a_assert(v_e->>'state' = '42501', 'A-6 so is the #4452 form photo folder');
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.a_as(v_web);

  -- ── A-7: nothing unpublished leaks ──
  PERFORM public.admin_site_page_save_draft('about', 0, jsonb_build_object('sections', jsonb_build_array(
    jsonb_build_object('type', 'answer', 'version', 1, 'content', jsonb_build_object('question', 'Q?', 'answer', 'SECRET DRAFT')))));
  v := public.admin_site_page_create('/secret-launch', 'Secret launch', 'blank', jsonb_build_array(
    jsonb_build_object('type', 'answer', 'version', 1, 'content', jsonb_build_object('question', 'Q?', 'answer', 'UNANNOUNCED'))));
  PERFORM pg_temp.a_as(v_growth);
  v := public.admin_site_page_create_preview_token('about', NULL);
  v_tok := v->>'token';
  v := public.admin_site_page_create_preview_token(v_key, NULL);
  RESET ROLE;
  SET LOCAL ROLE anon;
  PERFORM pg_temp.a_assert(public.site_public_preview(v_tok)::text NOT LIKE '%SECRET DRAFT%', 'A-7 a view-only token never carries the draft');
  PERFORM pg_temp.a_assert(public.site_public_page('about') IS NULL, 'A-7 an unpublished block list is not public');
  PERFORM pg_temp.a_assert(public.site_public_custom_index()::text NOT LIKE '%secret-launch%'
                       AND public.site_public_content()::text NOT LIKE '%UNANNOUNCED%', 'A-7 a draft-only page is in no anon read');
  v_e := pg_temp.a_err($$SELECT public.site_public_page('p-zzzz')$$);
  PERFORM pg_temp.a_assert(v_e->>'state' = 'ok' AND public.site_public_page('p-zzzz') IS NULL, 'A-7 a malformed key reads as nothing');
  RESET ROLE;
END
$t$;
ROLLBACK;
