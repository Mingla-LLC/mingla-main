-- MINGLA-INVARIANT: I-PROPOSED-2829-14 | issue #2829 | Website content actions are gated by Core (entitlement + live rank per action, from one list): rank 20 edits drafts, only brand admins and owners confirm a review is real or hide a past trip; every content change is audited without its words; a member's preview size is readable and writable by that member only.
-- #2829 W9r — the content-collections gate, audit, "Ask an admin" and the
-- per-user preview preference (pg17, BEGIN ... ROLLBACK).
-- Apply every migration through 20280119112829_issue_2829_site_collections.sql
-- first, then run with ON_ERROR_STOP=1. Every fixture rolls back. Neutral
-- fixtures only.

\set ON_ERROR_STOP on
BEGIN;

DO $w9r$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_finance uuid := gen_random_uuid();
  v_scanner uuid := gen_random_uuid();
  v_other_owner uuid := gen_random_uuid();
  v_mingla_admin uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_site uuid;
  v_other_site uuid;
  v_result jsonb;
  v_failed boolean;
  v_count integer;
  v_text text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'w9r-owner@2829.invalid'), (v_admin, 'w9r-admin@2829.invalid'),
    (v_marketing, 'w9r-marketing@2829.invalid'), (v_finance, 'w9r-finance@2829.invalid'),
    (v_scanner, 'w9r-scanner@2829.invalid'), (v_other_owner, 'w9r-other@2829.invalid'),
    (v_mingla_admin, 'w9r-mingla-admin@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES
    (v_owner, now(), now()), (v_other_owner, now(), now());
  INSERT INTO public.admin_users(email, role, status, accepted_at)
  VALUES ('w9r-mingla-admin@2829.invalid', 'admin', 'active', now());
  INSERT INTO public.brands(id, account_id, name, slug) VALUES
    (v_brand, v_owner, 'W9r Trips', 'w9r-trips'),
    (v_other, v_other_owner, 'W9r Other', 'w9r-other');
  UPDATE public.brands SET default_currency = 'USD' WHERE id IN (v_brand, v_other);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
    (v_brand, v_admin, 'brand_admin', now()),
    (v_brand, v_marketing, 'marketing_manager', now()),
    (v_brand, v_finance, 'finance_manager', now()),
    (v_brand, v_scanner, 'scanner', now());
  INSERT INTO public.profiles(id, display_name) VALUES (v_marketing, 'Ada')
  ON CONFLICT (id) DO UPDATE SET display_name = 'Ada';
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES ('sites_v1', 'https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com', 'sites.usemingla.com',
    v_mingla_admin, now(), v_mingla_admin, now());
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  PERFORM public.brand_site_admin_grant(v_brand, 'rollout', NULL);
  PERFORM public.brand_site_admin_grant(v_other, 'rollout', NULL);

  -- These are deliberately legacy sites from before setup plans existed.
  -- Constructing them directly preserves that compatibility contract while
  -- new public provisioning remains subject to #2830's completeness gate.
  INSERT INTO public.brand_sites(brand_id, created_by)
  VALUES (v_brand, v_owner) RETURNING id INTO v_site;
  INSERT INTO public.brand_sites(brand_id, created_by)
  VALUES (v_other, v_other_owner) RETURNING id INTO v_other_site;

  -- ── the plan never contradicts a site that predates it ──────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.brand_site_plan_status(v_brand);
  IF NOT (v_result->'parts'->4->>'done')::boolean OR NOT (v_result->'parts'->5->>'done')::boolean THEN
    RAISE EXCEPTION 'a site made before the plan still asks to approve and build: %', v_result;
  END IF;

  -- ── grants ──────────────────────────────────────────────────────────────
  IF has_function_privilege('authenticated', 'public.brand_site_content_record(uuid,uuid,text,text,text,jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_content_person_name(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.brand_site_content_authorize(uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.brand_site_request_admin(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a content internal is reachable by anon or authenticated';
  END IF;
  IF has_table_privilege('anon', 'public.business_user_ui_preferences', 'SELECT') THEN
    RAISE EXCEPTION 'anon can read UI preferences';
  END IF;

  -- ── one list of minimum ranks ───────────────────────────────────────────
  IF public.brand_site_content_min_rank('update') <> 20
    OR public.brand_site_content_min_rank('confirm_review') <> 50
    OR public.brand_site_content_min_rank('set_offering_visibility') <> 50
    OR public.brand_site_content_min_rank('drop_table') IS NOT NULL THEN
    RAISE EXCEPTION 'content minimum ranks drifted';
  END IF;

  -- ── the gate ────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_result := public.brand_site_content_authorize(v_site, 'update');
  IF (v_result->>'rank')::int <> 20 OR (v_result->>'brand_id')::uuid <> v_brand
    OR (v_result->>'user_id')::uuid <> v_marketing THEN
    RAISE EXCEPTION 'marketing could not edit a draft: %', v_result;
  END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_content_authorize(v_site, 'confirm_review');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager could confirm a review'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_content_authorize(v_site, 'set_offering_visibility');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager could hide a past trip'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_content_authorize(v_site, 'unknown_action');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an unknown action passed the gate'; END IF;
  -- Cross-tenant: a member of brand A gets nothing on brand B's site.
  v_failed := false;
  BEGIN PERFORM public.brand_site_content_authorize(v_other_site, 'list');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'another brand''s site content was reachable'; END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_scanner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_scanner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_content_authorize(v_site, 'list');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a scanner read website content'; END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_result := public.brand_site_content_authorize(v_site, 'confirm_review');
  IF (v_result->>'rank')::int < 50 THEN RAISE EXCEPTION 'a brand admin could not confirm'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.brand_site_content_authorize(v_site, 'set_offering_visibility');
  IF (v_result->>'rank')::int < 50 THEN RAISE EXCEPTION 'the owner could not hide a past trip'; END IF;

  -- A brand whose website access is revoked gets nothing.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  PERFORM public.brand_site_admin_revoke(v_other, 'rollout', NULL);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_other_owner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_content_authorize(v_other_site, 'list');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a revoked brand''s owner reached content'; END IF;

  -- ── audit: the change, never the words ─────────────────────────────────
  PERFORM public.brand_site_content_record(v_site, v_marketing, 'content.created',
    'destinations', '7', '{}'::jsonb);
  PERFORM public.brand_site_content_record(v_site, v_owner, 'content.review_confirmed',
    'testimonials', '9', jsonb_build_object('visible', false));
  SELECT count(*) INTO v_count FROM public.brand_site_audit_log
  WHERE site_id = v_site AND resource_kind = 'site_content'
    AND ((action = 'content.created' AND actor_user_id = v_marketing AND resource_id = 'destinations:7'
          AND metadata = '{"collection":"destinations","entry":"7"}'::jsonb)
      OR (action = 'content.review_confirmed' AND actor_user_id = v_owner AND resource_id = 'testimonials:9'));
  IF v_count <> 2 THEN RAISE EXCEPTION 'content changes were not audited: %', v_count; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_content_record(v_site, v_owner, 'content.updated', 'destinations', '7',
    jsonb_build_object('quote', 'the words'));
  EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an audit row carried free text'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_content_record(v_site, v_owner, 'plan.built', 'destinations', '7', '{}');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_validation_failed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a non-content action was recorded as content'; END IF;

  -- Who saved a newer version: the team name; nothing for a stranger
  -- (#2829 W11: Core answers NULL and the app words it, never "A teammate").
  IF public.brand_site_content_person_name(v_site, v_marketing) IS DISTINCT FROM 'Ada'
    OR public.brand_site_content_person_name(v_site, v_other_owner) IS NOT NULL THEN
    RAISE EXCEPTION 'conflict names leak or are wrong';
  END IF;

  -- ── "Ask an admin" ──────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_result := public.brand_site_request_admin(v_brand, 'confirm_review');
  IF (v_result->>'notified')::int <> 2 THEN RAISE EXCEPTION 'owner and admin were not both asked: %', v_result; END IF;
  SELECT payload->>'deep_link' INTO v_text FROM public.notification_outbox
  WHERE brand_id = v_brand AND category_key = 'business.site_admin_requested' AND user_id = v_owner;
  IF v_text <> 'mingla-business://brand/' || v_brand || '/website/reviews' THEN
    RAISE EXCEPTION 'ask-an-admin deep link wrong: %', v_text;
  END IF;
  v_result := public.brand_site_request_admin(v_brand, 'confirm_review');
  IF (v_result->>'notified')::int <> 0 OR NOT (v_result->>'already_asked')::boolean THEN
    RAISE EXCEPTION 'asking twice in a day notified again';
  END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_request_admin(v_brand, 'delete_everything');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_validation_failed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an unknown ask was sent'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_request_admin(v_brand, 'publish');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an owner asked an admin (they can do it themselves)'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_finance)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_finance::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_request_admin(v_brand, 'publish');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'finance (no website) sent an ask'; END IF;

  -- ── preview size: own rows only (#2829 W11: RPC-only, no table grant) ──
  IF has_table_privilege('authenticated', 'public.business_user_ui_preferences', 'SELECT')
    OR has_table_privilege('authenticated', 'public.business_user_ui_preferences', 'INSERT')
    OR has_table_privilege('authenticated', 'public.business_user_ui_preferences', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.business_user_ui_preferences', 'DELETE') THEN
    RAISE EXCEPTION 'members can touch the preferences table directly';
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.business_ui_preference_set('website.previewDevice', '{"device":"tablet","tablet":"landscape","phone":"portrait"}');
  v_failed := false;
  BEGIN PERFORM public.business_ui_preference_set('website.previewDevice', '{"device":"tv"}');
  EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an invalid preview size was stored'; END IF;
  v_failed := false;
  BEGIN PERFORM public.business_ui_preference_set('admin.everything', '{}');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'invalid_key'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an unknown preference key was stored'; END IF;
  v_failed := false;
  BEGIN PERFORM count(*) FROM public.business_user_ui_preferences;
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a member read the preferences table directly'; END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF public.business_ui_preference_get('website.previewDevice') IS NOT NULL THEN
    RAISE EXCEPTION 'a member read another member''s preview size';
  END IF;
  PERFORM public.business_ui_preference_set('website.previewDevice', '{"device":"phone"}');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_text := public.business_ui_preference_get('website.previewDevice')->>'device';
  IF v_text IS DISTINCT FROM 'tablet' THEN RAISE EXCEPTION 'the owner lost their preview size: %', v_text; END IF;
  EXECUTE 'RESET ROLE';

  -- ── "Last 30 days": counts only, brand members only ────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_result := public.brand_site_overview_counts(v_site);
  IF (v_result->>'visits_30d')::int <> 0 OR (v_result->>'enquiries_30d')::int <> 0
    OR (v_result->>'bookings_30d')::int <> 0 THEN
    RAISE EXCEPTION 'a new site has counts: %', v_result;
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_other_owner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_overview_counts(v_site);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'another brand read website counts'; END IF;

  RAISE NOTICE 'ISSUE_2829_W9R_SITE_COLLECTIONS_OK';
END;
$w9r$;

ROLLBACK;
