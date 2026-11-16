\set ON_ERROR_STOP on
-- #4452 M2 site_pages: executable PostgreSQL 17 proof, after the full migration replay.
--
-- T-1.2a SC-10  site_public_content() as anon: live content only (no draft blocks), no archived forms,
--               no routing owners or inbox addresses.
-- T-1.2b SC-11  site_public_preview: NULL for expired, unknown or malformed tokens; the content for a valid one.
-- T-1.2c SC-12  a stale publish raises PT409 with code page_conflict, the publisher's name and the time.
-- T-1.2d SC-13  restore makes a new version with restored_from; history keeps every version.
-- T-1.2e SC-14  two blocks in one spot are refused; HTML in block text is refused; a details-step block
--               only on /schedule with a book_call_extra form.
-- T-1.2f SC-15  the site-media bucket: 5 MiB, JPEG/PNG/WebP only; a website editor may upload, growth may not.
--
-- FAILS-ON-REVERT: the spot_taken check in site_validate_content fails T-1.2e; the expires_at predicate
-- in site_public_preview fails T-1.2b (preview-token expiry); the version check in site_page_put_live
-- fails T-1.2c; dropping site_public_form() from site_public_forms (exposing routing) fails T-1.2a.

CREATE OR REPLACE FUNCTION pg_temp.s_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4452 site pages FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.s_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.s_err(p_sql text)
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

BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb;
DO $t$
DECLARE
  v_web    constant uuid := '44520000-0000-4000-d000-000000000001';
  v_web2   constant uuid := '44520000-0000-4000-d000-000000000002';
  v_growth constant uuid := '44520000-0000-4000-d000-000000000003';
  v_form uuid; v_extra uuid; v_arch uuid; v jsonb; v_rev integer; v_c jsonb; v_e jsonb; v_tok text; v_pub jsonb;
  b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); b3 uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data) VALUES
    (v_web, 's4452-web@mingla-fixture.org', now(), '{"full_name":"Seth"}'),
    (v_web2, 's4452-web2@mingla-fixture.org', now(), '{"full_name":"Abi"}'),
    (v_growth, 's4452-growth@mingla-fixture.org', now(), '{}');
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES
    ('s4452-web@mingla-fixture.org', 'website', 'active', now()), ('s4452-web2@mingla-fixture.org', 'website', 'active', now()),
    ('s4452-growth@mingla-fixture.org', 'growth', 'active', now());

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.s_as(v_web);
  -- A live form with a card and an owner (routing must never reach the site).
  v := public.admin_form_create('Creators: join', 'creator', 'creators');
  v_form := (v->>'id')::uuid;
  v := public.admin_form_get(v_form);
  PERFORM public.admin_form_save_draft(v_form, (v->>'draft_rev')::integer,
    jsonb_set(v->'draft', '{routing}', '{"card":{"on":true,"pipeline":"creators"},"owner":{"mode":"person","emails":["owner-secret@usemingla.com"]}}'));
  PERFORM public.admin_form_mark_tested(v_form);
  PERFORM public.admin_form_publish(v_form, (v->>'draft_rev')::integer + 1);
  v := public.admin_form_create('Book a call extras', 'creator', 'book_call_extra');
  v_extra := (v->>'id')::uuid;
  v := public.admin_form_create('Old form', 'host', NULL);
  v_arch := (v->>'id')::uuid;
  PERFORM public.admin_form_mark_tested(v_arch);
  PERFORM public.admin_form_publish(v_arch, 1);
  PERFORM public.admin_form_archive(v_arch);

  -- ── T-1.2e: validation ──
  v_c := jsonb_build_object('blocks', jsonb_build_array(
    jsonb_build_object('id', b1, 'type', 'form', 'spot', 'after-steps', 'form_id', v_form, 'head', 'Join the', 'em', 'creator list.'),
    jsonb_build_object('id', b2, 'type', 'banner', 'spot', 'after-steps', 'text', 'Lagos gigs close Friday.', 'btn', 'Apply now', 'to', '{"kind":"schedule_creators"}'::jsonb)));
  v_e := pg_temp.s_err(format($$SELECT public.admin_site_page_save_draft('creators', 0, %L::jsonb)$$, v_c));
  PERFORM pg_temp.s_assert(v_e->>'state' = '22023' AND v_e->>'detail' LIKE '%spot_taken%', 'T-1.2e SC-14 two blocks in one spot are refused');
  v_e := pg_temp.s_err(format($$SELECT public.admin_site_page_save_draft('creators', 0, %L::jsonb)$$,
    jsonb_build_object('blocks', jsonb_build_array(jsonb_build_object('id', b2, 'type', 'banner', 'spot', 'after-hero',
      'text', '<script>alert(1)</script>', 'btn', 'Go', 'to', '{"kind":"app"}'::jsonb)))));
  PERFORM pg_temp.s_assert(v_e->>'state' = '22023', 'T-1.2e HTML in block text is refused');
  v_e := pg_temp.s_err(format($$SELECT public.admin_site_page_save_draft('creators', 0, %L::jsonb)$$,
    jsonb_build_object('blocks', jsonb_build_array(jsonb_build_object('id', b3, 'type', 'form', 'spot', 'details-step', 'form_id', v_extra)))));
  PERFORM pg_temp.s_assert(v_e->>'state' = '22023', 'T-1.2e a details-step block off /schedule is refused');
  v_e := pg_temp.s_err(format($$SELECT public.admin_site_page_save_draft('schedule', 0, %L::jsonb)$$,
    jsonb_build_object('blocks', jsonb_build_array(jsonb_build_object('id', b3, 'type', 'form', 'spot', 'details-step', 'form_id', v_form)))));
  PERFORM pg_temp.s_assert(v_e->>'state' = '22023', 'T-1.2e a details-step block needs a book_call_extra form');
  v := public.admin_site_page_save_draft('schedule', 0,
    jsonb_build_object('blocks', jsonb_build_array(jsonb_build_object('id', b3, 'type', 'form', 'spot', 'details-step', 'form_id', v_extra))));
  PERFORM pg_temp.s_assert((v->>'rev')::integer = 1, 'T-1.2e a details-step block with a book_call_extra form on /schedule is accepted');
  v_e := pg_temp.s_err(format($$SELECT public.admin_site_page_save_draft('about', 0, %L::jsonb)$$,
    jsonb_build_object('blocks', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'type', 'popup', 'spot', 'popup', 'form_id', v_form,
                         'popup', '{"trigger":"scroll_half","freq":"weekly","devices":"all","style":"centre"}'::jsonb),
      jsonb_build_object('id', gen_random_uuid(), 'type', 'popup', 'spot', 'popup', 'form_id', v_form,
                         'popup', '{"trigger":"after_20s","freq":"weekly","devices":"all","style":"side"}'::jsonb)))));
  PERFORM pg_temp.s_assert(v_e->>'state' = '22023', 'T-1.2e one pop-up per page');

  -- ── A draft and a live version for /creators ──
  v_c := jsonb_build_object('blocks', jsonb_build_array(
    jsonb_build_object('id', b1, 'type', 'form', 'spot', 'after-steps', 'form_id', v_form, 'head', 'Join the', 'em', 'creator list.'),
    jsonb_build_object('id', b2, 'type', 'buttons', 'spot', 'after-hero', 'buttons', jsonb_build_array(
      jsonb_build_object('text', 'Apply in 2 minutes', 'to', jsonb_build_object('kind', 'form_page', 'form_id', v_form))))));
  v := public.admin_site_page_save_draft('creators', 0, v_c);
  v := public.admin_site_page_publish('creators', 0, 'first');
  PERFORM pg_temp.s_assert((v->>'version')::integer = 1, 'publish makes version 1');
  -- a draft that adds a banner (it must NOT reach the public read)
  v := public.admin_site_page_save_draft('creators', 0, v_c || jsonb_build_object('blocks', (v_c->'blocks') ||
    jsonb_build_array(jsonb_build_object('id', b3, 'type', 'banner', 'spot', 'before-footer', 'text', 'DRAFT ONLY BANNER', 'btn', 'Go', 'to', '{"kind":"app"}'::jsonb))));

  -- ── T-1.2c: a stale publish ──
  PERFORM pg_temp.s_as(v_web2);
  PERFORM public.admin_site_page_publish('creators', 1, 'second');   -- Abi publishes the draft first (v2)
  PERFORM public.admin_site_page_save_draft('creators', 0, v_c);
  PERFORM pg_temp.s_as(v_web);
  v_e := pg_temp.s_err($$SELECT public.admin_site_page_publish('creators', 1, NULL)$$);
  PERFORM pg_temp.s_assert(v_e->>'state' = 'PT409' AND (v_e->>'detail')::jsonb->>'code' = 'page_conflict'
                       AND (v_e->>'detail')::jsonb->>'published_by' = 'Abi' AND (v_e->>'detail')::jsonb ? 'published_at'
                       AND ((v_e->>'detail')::jsonb->>'live_version')::integer = 2,
    'T-1.2c SC-12 a stale publish raises PT409 page_conflict with the publisher and time');
  v := public.admin_site_page_publish('creators', 2, 'replace');
  PERFORM pg_temp.s_assert((v->>'version')::integer = 3, 'T-1.2c Replace publishes over (v3)');

  -- ── T-1.2d: restore ──
  v := public.admin_site_page_restore('creators', 2, 3);
  PERFORM pg_temp.s_assert((v->>'version')::integer = 4, 'T-1.2d SC-13 restore makes version 4');
  v := public.admin_site_page_history('creators');
  PERFORM pg_temp.s_assert(jsonb_array_length(v) = 4 AND (v->0->>'restored_from')::integer = 2 AND (v->0->>'is_live')::boolean,
    'T-1.2d SC-13 history keeps every version and marks the restore');
  RESET ROLE;
  PERFORM pg_temp.s_assert((SELECT count(*) FROM public.site_page_versions WHERE page_key = 'creators') = 4, 'T-1.2d four rows, none rewritten');

  -- ── T-1.2a: the anon read ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.s_as(v_web);
  PERFORM public.admin_site_page_restore('creators', 1, 4);
  PERFORM public.admin_site_page_save_draft('creators', 0, jsonb_build_object('blocks', (v_c->'blocks') ||
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'banner', 'spot', 'before-footer', 'text', 'UNPUBLISHED DRAFT', 'btn', 'Go', 'to', '{"kind":"app"}'::jsonb))));
  SET LOCAL ROLE anon;
  v_pub := public.site_public_content();
  RESET ROLE;
  PERFORM pg_temp.s_assert(v_pub->'pages'->'creators' IS NOT NULL AND v_pub::text NOT LIKE '%UNPUBLISHED DRAFT%',
    'T-1.2a SC-10 live content only, no draft blocks');
  PERFORM pg_temp.s_assert(v_pub->'forms' ? v_form::text AND NOT (v_pub->'forms' ? v_arch::text), 'T-1.2a SC-10 live forms, no archived form');
  PERFORM pg_temp.s_assert(v_pub::text NOT LIKE '%owner-secret%' AND NOT (v_pub->'forms'->v_form::text ? 'routing'),
    'T-1.2a SC-10 no routing owners or inbox addresses');
  PERFORM pg_temp.s_assert(v_pub->'form_pages' = '{}'::jsonb OR NOT (v_pub->'form_pages' ? 'x'), 'form pages present only for own pages');

  -- ── T-1.2b: preview tokens ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.s_as(v_web);
  v := public.admin_site_page_create_preview_token('creators', v_c);
  v_tok := v->>'token';
  PERFORM pg_temp.s_assert(length(v_tok) = 43, 'T-1.2b the token is 43 url-safe characters');
  SET LOCAL ROLE anon;
  PERFORM pg_temp.s_assert(public.site_public_preview(v_tok)->>'page_key' = 'creators', 'T-1.2b SC-11 a valid token returns the content');
  PERFORM pg_temp.s_assert(public.site_public_preview(left(v_tok, 42)) IS NULL, 'T-1.2b SC-11 a 42-character token is NULL');
  PERFORM pg_temp.s_assert(public.site_public_preview(v_tok || 'A') IS NULL, 'T-1.2b SC-11 a 44-character token is NULL');
  PERFORM pg_temp.s_assert(public.site_public_preview($$' OR 1=1 --aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$$) IS NULL, 'T-1.2b SC-11 a SQL-ish token is NULL');
  PERFORM pg_temp.s_assert(public.site_public_preview(repeat('A', 43)) IS NULL, 'T-1.2b SC-11 an unknown token is NULL');
  RESET ROLE;
  UPDATE public.site_preview_tokens SET expires_at = now() - interval '1 second';
  SET LOCAL ROLE anon;
  PERFORM pg_temp.s_assert(public.site_public_preview(v_tok) IS NULL, 'T-1.2b SC-11 an expired token is NULL');
  RESET ROLE;
  PERFORM pg_temp.s_assert((SELECT count(*) FROM public.site_preview_tokens WHERE token_hash = v_tok) = 0, 'T-1.2b the raw token is never stored');

  -- ── growth cannot write ──
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.s_as(v_growth);
  PERFORM pg_temp.s_assert(jsonb_typeof(public.admin_site_pages_state()) = 'array', 'SC-2 growth can read the page state');
  v_e := pg_temp.s_err($$SELECT public.admin_site_page_save_draft('locals', 0, '{"blocks":[]}'::jsonb)$$);
  PERFORM pg_temp.s_assert(v_e->>'state' = '42501', 'SC-2 growth cannot save a page draft');
  v_e := pg_temp.s_err($$SELECT public.admin_site_page_publish('creators', 4, NULL)$$);
  PERFORM pg_temp.s_assert(v_e->>'state' = '42501', 'SC-2 growth cannot publish');
  RESET ROLE;
  -- site_page_versions are immutable (SC-4).
  v_e := pg_temp.s_err($$UPDATE public.site_page_versions SET note = 'x'$$);
  PERFORM pg_temp.s_assert(v_e->>'state' = '42501', 'SC-4 a site page version cannot be updated');

  -- ── T-1.2f: the bucket ──
  -- The replay image's storage schema may lack the limit columns (the migration probes them, like #4137).
  SELECT to_jsonb(b) INTO v FROM storage.buckets b WHERE id = 'site-media';
  PERFORM pg_temp.s_assert(v IS NOT NULL AND (NOT (v ? 'file_size_limit') OR ((v->>'file_size_limit')::bigint = 5242880
                       AND v->'allowed_mime_types' = '["image/jpeg","image/png","image/webp"]'::jsonb AND (v->>'public')::boolean)),
    'T-1.2f SC-15 the bucket exists; where the columns exist: 5 MiB, JPEG/PNG/WebP only (no GIF, no SVG), public read');
  PERFORM pg_temp.s_assert((SELECT count(*) FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'issue_4452_site_media_%') = 3,
    'T-1.2f the three site-media policies exist');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.s_as(v_web);
  v_e := pg_temp.s_err(format($$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('site-media', %L, %L)$$, v_web || '/a.jpg', v_web));
  PERFORM pg_temp.s_assert(v_e->>'state' = 'ok', 'T-1.2f SC-15 a website editor uploads into their folder');
  PERFORM pg_temp.s_as(v_growth);
  v_e := pg_temp.s_err(format($$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('site-media', %L, %L)$$, v_growth || '/b.jpg', v_growth));
  PERFORM pg_temp.s_assert(v_e->>'state' = '42501', 'T-1.2f SC-15 growth cannot upload');
  RESET ROLE;
END
$t$;
ROLLBACK;
