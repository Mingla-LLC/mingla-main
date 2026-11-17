\set ON_ERROR_STOP on
-- #4453 milestone 11 tester (adversarial): the re-issued rank and flag functions
-- in 20280803004453 must keep EVERY earlier action and flag, must not give the
-- Ari tool names an owner content rank, and the allowlist must stay service-only.
-- A different angle from the implementor suite (which spot-checks 3 old actions):
-- here the WHOLE earlier action list (20280723004453) is pinned, flags are
-- checked for cross-talk both ways, and the allowlist is attacked as a signed-in user.
-- BEGIN ... ROLLBACK: fixtures roll back.
--
-- A-1  every action in 20280723's list is still 20; the two review-only actions still 50.
-- A-2  the three owner Ari-page actions are 20; Ari's own tools and publish are NOT content actions.
-- A-3  rank function shape: IMMUTABLE, not SECURITY DEFINER, anon cannot run it.
-- A-4  flag cross-talk: a design-pass allowlist row or global flag does not switch on SITES_ARI_ADD_PAGE, and vice versa.
-- A-5  NULL flag or NULL brand never reads as on.
-- A-6  a signed-in user (authenticated) cannot read or write the allowlist, nor call the flag read.
--
-- FAILS-ON-REVERT: restore 20280723's brand_site_content_min_rank body -> A-2a;
-- drop any earlier action from the re-issued list -> A-1a.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.t_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 m11 tester FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- A-1
SELECT pg_temp.t_assert(bool_and(public.brand_site_content_min_rank(a) = 20),
  'A-1a every earlier content action keeps rank 20')
FROM unnest(ARRAY['list','get','create','update','reorder','set_visibility','delete',
  'categories','create_category','rename_category','reorder_categories',
  'delete_category','media_upload_grant','media_complete','media_status',
  'media_library','offerings','past_trips','font_search','font_previews','draft_changes','pages','set_menu','cover','set_cover',
  'work_log','design_checks','review_status','mark_reviewed']) AS a;
SELECT pg_temp.t_assert(public.brand_site_content_min_rank('confirm_review') = 50
    AND public.brand_site_content_min_rank('set_offering_visibility') = 50,
  'A-1b the admin-only review actions keep rank 50');

-- A-2
SELECT pg_temp.t_assert(public.brand_site_content_min_rank('ari_page_answer') = 20
    AND public.brand_site_content_min_rank('ari_page_accept') = 20
    AND public.brand_site_content_min_rank('ari_page_remove') = 20,
  'A-2a the owner Ari-page actions sit at the content minimum');
SELECT pg_temp.t_assert(bool_and(public.brand_site_content_min_rank(a) IS NULL),
  'A-2b Ari tools, publish and look-alike names are not owner content actions')
FROM unnest(ARRAY['propose_site_page','answer_site_page_question','publish','publish_site','ari_page_publish',
  'ARI_PAGE_ACCEPT',' ari_page_accept','ari_page_accept ','', NULL]) AS a;

-- A-3
SELECT pg_temp.t_assert(p.provolatile = 'i' AND NOT p.prosecdef
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE'),
  'A-3 rank function is IMMUTABLE, invoker rights, not callable by anon')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'brand_site_content_min_rank';

-- Fixtures
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-4000-8000-00000000c011', 'm11-tester@4453.invalid');
INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES ('00000000-0000-4000-8000-00000000c011', now(), now());
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('00000000-0000-4000-8000-0000000c1101', '00000000-0000-4000-8000-00000000c011', 'M11T Alpha', 'm11t-alpha', 'NGN'),
  ('00000000-0000-4000-8000-0000000c1102', '00000000-0000-4000-8000-00000000c011', 'M11T Beta', 'm11t-beta', 'NGN');

-- A-4
INSERT INTO public.brand_site_flag_brands (flag_key, brand_id) VALUES ('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000c1101');
SELECT pg_temp.t_assert(public.brand_site_flag_on('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000c1101')
    AND NOT public.brand_site_flag_on('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000c1101'),
  'A-4a a design-pass allowlist row still works and does not switch on add-a-page');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key IN ('SITES_ARI_DESIGN_PASS', 'SITES_STYLE_LIBRARY');
SELECT pg_temp.t_assert(NOT public.brand_site_flag_on('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000c1102')
    AND public.brand_site_flag_on('SITES_STYLE_LIBRARY', '00000000-0000-4000-8000-0000000c1102'),
  'A-4b the milestone 7 flags on globally leave add-a-page off');
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key IN ('SITES_ARI_DESIGN_PASS', 'SITES_STYLE_LIBRARY');
INSERT INTO public.brand_site_flag_brands (flag_key, brand_id) VALUES ('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000c1102');
SELECT pg_temp.t_assert(public.brand_site_flag_on('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000c1102')
    AND NOT public.brand_site_flag_on('SITES_ARI_DESIGN_PASS', '00000000-0000-4000-8000-0000000c1102')
    AND NOT public.brand_site_flag_on('SITES_STYLE_LIBRARY', '00000000-0000-4000-8000-0000000c1102'),
  'A-4c an add-a-page allowlist row switches on nothing else');

-- A-5
SELECT pg_temp.t_assert(public.brand_site_flag_on(NULL, '00000000-0000-4000-8000-0000000c1102') IS NOT TRUE
    AND public.brand_site_flag_on('SITES_ARI_ADD_PAGE', NULL) IS NOT TRUE
    AND public.brand_site_flag_on('sites_ari_add_page', '00000000-0000-4000-8000-0000000c1102') IS NOT TRUE,
  'A-5 NULL or wrong-case keys never read as on');

-- A-6
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  BEGIN
    INSERT INTO public.brand_site_flag_brands (flag_key, brand_id) VALUES ('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000c1101');
    RAISE EXCEPTION 'issue #4453 m11 tester FAIL: A-6a a signed-in user allowlisted a brand';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS  A-6a a signed-in user cannot allowlist a brand';
  END;
  BEGIN
    PERFORM 1 FROM public.brand_site_flag_brands;
    RAISE EXCEPTION 'issue #4453 m11 tester FAIL: A-6b a signed-in user read the allowlist';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS  A-6b a signed-in user cannot read the allowlist';
  END;
  BEGIN
    PERFORM public.brand_site_flag_on('SITES_ARI_ADD_PAGE', '00000000-0000-4000-8000-0000000c1101');
    RAISE EXCEPTION 'issue #4453 m11 tester FAIL: A-6c a signed-in user called the flag read';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS  A-6c a signed-in user cannot call the flag read';
  END;
END
$t$;
RESET ROLE;

ROLLBACK;
