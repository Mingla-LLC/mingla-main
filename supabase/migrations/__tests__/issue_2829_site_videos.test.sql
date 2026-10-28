-- #2829 W6 (AD-9) — brand_site_videos (pg17, BEGIN ... ROLLBACK). Apply every
-- migration through 20280119062829_issue_2829_site_videos.sql first, then run
-- with ON_ERROR_STOP=1. Every fixture rolls back. Neutral fixtures only.
--
-- Proves: only the service role can read or write it (RLS forced, no grants
-- to anon/authenticated); a row's brand must be its site's brand; the site,
-- brand and Bunny guid never change; statuses and shapes are checked; a
-- `ready` row carries a length and at least one rendition; one row per guid.

\set ON_ERROR_STOP on
BEGIN;

DO $w6$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand_a uuid := gen_random_uuid();
  v_brand_b uuid := gen_random_uuid();
  v_site_a uuid := gen_random_uuid();
  v_site_b uuid := gen_random_uuid();
  v_video uuid;
  v_failed boolean;
  v_guid text := 'aaaaaaaa-1111-4111-8111-111111111111';
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'w6-owner@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand_a, v_owner, 'W6 Brand A', 'w6-brand-a', 'USD'),
    (v_brand_b, v_owner, 'W6 Brand B', 'w6-brand-b', 'USD');
  INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES
    (v_site_a, v_brand_a, 'provisioning', v_owner),
    (v_site_b, v_brand_b, 'provisioning', v_owner);

  -- 1. Service role only.
  IF has_table_privilege('anon', 'public.brand_site_videos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.brand_site_videos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.brand_site_videos', 'INSERT')
     OR has_table_privilege('authenticated', 'public.brand_site_videos', 'UPDATE') THEN
    RAISE EXCEPTION 'brand_site_videos is reachable by anon or authenticated';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.brand_site_videos', 'INSERT') THEN
    RAISE EXCEPTION 'service role cannot write brand_site_videos';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.brand_site_videos'::regclass) THEN
    RAISE EXCEPTION 'brand_site_videos RLS is not forced';
  END IF;

  -- 2. A row binds to its own site's brand.
  INSERT INTO public.brand_site_videos(site_id, brand_id, provider_guid, status)
    VALUES (v_site_a, v_brand_a, v_guid, 'uploading') RETURNING id INTO v_video;
  v_failed := false;
  BEGIN
    INSERT INTO public.brand_site_videos(site_id, brand_id, provider_guid)
      VALUES (v_site_a, v_brand_b, 'bbbbbbbb-2222-4222-8222-222222222222');
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a video was stored under another brand''s site'; END IF;

  -- 3. Site, brand and guid never change.
  v_failed := false;
  BEGIN
    UPDATE public.brand_site_videos SET site_id = v_site_b, brand_id = v_brand_b WHERE id = v_video;
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a video moved to another site'; END IF;
  v_failed := false;
  BEGIN
    UPDATE public.brand_site_videos SET provider_guid = 'cccccccc-3333-4333-8333-333333333333' WHERE id = v_video;
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a video''s Bunny guid changed'; END IF;

  -- 4. One row per Bunny video; shapes are checked.
  v_failed := false;
  BEGIN
    INSERT INTO public.brand_site_videos(site_id, brand_id, provider_guid) VALUES (v_site_a, v_brand_a, v_guid);
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'two rows for one Bunny video'; END IF;
  BEGIN
    INSERT INTO public.brand_site_videos(site_id, brand_id, provider_guid) VALUES (v_site_a, v_brand_a, 'not-a-guid');
    RAISE EXCEPTION 'a malformed guid was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.brand_site_videos SET status = 'published' WHERE id = v_video;
    RAISE EXCEPTION 'an unknown status was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.brand_site_videos SET renditions = '{"url":"x"}'::jsonb WHERE id = v_video;
    RAISE EXCEPTION 'non-array renditions were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 5. Ready needs a length and a rendition.
  BEGIN
    UPDATE public.brand_site_videos SET status = 'ready' WHERE id = v_video;
    RAISE EXCEPTION 'a ready video without a length or rendition was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.brand_site_videos
     SET status = 'ready', duration_ms = 9000, width = 1280, height = 720,
         renditions = '[{"url":"https://vz-x.b-cdn.net/aaaaaaaa-1111-4111-8111-111111111111/play_720p.mp4","height":720}]'::jsonb
   WHERE id = v_video;
  IF (SELECT updated_at FROM public.brand_site_videos WHERE id = v_video) IS NULL THEN
    RAISE EXCEPTION 'updated_at not maintained';
  END IF;

  RAISE NOTICE 'ISSUE_2829_W6_SITE_VIDEOS_OK';
END;
$w6$;

ROLLBACK;
