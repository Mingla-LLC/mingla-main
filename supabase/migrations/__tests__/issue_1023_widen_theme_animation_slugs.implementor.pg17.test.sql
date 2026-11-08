-- issue #1023 wave 2 — every theme-animation allow-list accepts all 29 slugs,
-- still accepts the original 9, and still refuses junk. Runs after the full
-- migration replay. Transactional: BEGIN … ROLLBACK.
--
--   T-1  the three table CHECKs list a new slug ('love_balloons') and an old one
--   T-2  brands.theme_animation stores a new slug ('aurora')
--   T-3  brands.theme_animation still refuses an unknown slug
--   T-4  the three RPC allow-lists (latest definitions) list every new slug
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_con text;
  v_def text;
BEGIN
  FOREACH v_con IN ARRAY ARRAY[
    'brands_theme_animation_whitelist_chk',
    'events_theme_animation_override_whitelist_chk',
    'venue_listings_theme_animation_override_whitelist_chk'
  ] LOOP
    SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = v_con;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'T-1 FAIL: constraint % is missing', v_con;
    END IF;
    IF position('love_balloons' IN v_def) = 0 OR position('shimmer_reveal' IN v_def) = 0 THEN
      RAISE EXCEPTION 'T-1 FAIL: % is not widened: %', v_con, v_def;
    END IF;
  END LOOP;
  RAISE NOTICE 'T-1 PASS';
END $$;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('00000000-1023-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'owner-1023@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1023-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, theme_animation)
VALUES ('00000000-1023-4000-8000-000000000011', '00000000-1023-4000-8000-000000000001',
        'Issue 1023 Brand', 'issue-1023-brand', 'USD', 'aurora');

DO $$
BEGIN
  IF (SELECT theme_animation FROM public.brands WHERE id = '00000000-1023-4000-8000-000000000011') <> 'aurora' THEN
    RAISE EXCEPTION 'T-2 FAIL: aurora was not stored';
  END IF;
  RAISE NOTICE 'T-2 PASS';
  BEGIN
    UPDATE public.brands SET theme_animation = 'not_a_motion'
    WHERE id = '00000000-1023-4000-8000-000000000011';
    RAISE EXCEPTION 'T-3 FAIL: an unknown slug was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'T-3 PASS';
  END;
END $$;

DO $$
DECLARE
  v_fn text;
  v_src text;
  v_slug text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'biz_create_venue_listing',
    'brand_context_completeness_internal',
    'ari_update_brand_context'
  ] LOOP
    SELECT string_agg(prosrc, E'\n') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn;
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'T-4 FAIL: % is missing', v_fn;
    END IF;
    FOREACH v_slug IN ARRAY ARRAY[
      'shimmer_reveal', 'streamers', 'party_shapes', 'bubbles', 'champagne',
      'disco_glints', 'bokeh', 'golden_dust', 'neon_pulse', 'autumn_leaves',
      'fireflies', 'rain', 'sun_rays', 'starry_sky', 'aurora', 'lanterns',
      'embers', 'music_notes', 'love_burst', 'rose_petals', 'love_balloons'
    ] LOOP
      IF position(quote_literal(v_slug) IN v_src) = 0 THEN
        RAISE EXCEPTION 'T-4 FAIL: % does not allow %', v_fn, v_slug;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'T-4 PASS';
END $$;

ROLLBACK;
