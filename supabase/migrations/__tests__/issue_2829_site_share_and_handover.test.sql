-- #2829 W10 — private share-preview links, client handover and site analytics,
-- Core side (pg17, BEGIN ... ROLLBACK).
--  - Studio's newest preview is recorded per site; only a preview object of
--    THAT site is accepted;
--  - share links: rank 50 creates (marketing manager and strangers cannot),
--    1..14 days, a digest only (never a token), at most 20 working links;
--    the runtime resolves a link only for its own site, only while it works,
--    and only once a preview exists; revoke (rank 50) and expiry end it;
--    viewing is counted; the tables are RPC-only;
--  - handover: when a member's access ends (removed, demoted below 20, or no
--    longer the account owner) their unused Studio sign-in codes are revoked,
--    their plan lock is released and the share links THEY made stop working,
--    with an audit row; a demotion that keeps editing rank changes nothing;
--  - analytics: the new visitor events and page addresses are accepted (and
--    nothing else); the owner's reader returns visits, top pages, book
--    clicks, enquiries, bookings and sources (rank 20), and the overview
--    counter answers from the same reader.
-- Apply every migration through 20280119142829_issue_2829_seo_analytics_share_handover.sql
-- first, then run with ON_ERROR_STOP=1. Every fixture rolls back. Neutral
-- fixtures only.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

DO $w10$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_agency uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_new_owner uuid := gen_random_uuid();
  v_mingla_admin uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_other_brand uuid := gen_random_uuid();
  v_site uuid;
  v_other_site uuid;
  v_publication uuid := gen_random_uuid();
  v_result jsonb;
  v_link uuid;
  v_agency_link uuid;
  v_failed boolean;
  v_count integer;
  v_key text;
  v_digest text := repeat('a', 64);
  v_user uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'w10-owner@2829.invalid'), (v_admin, 'w10-admin@2829.invalid'),
    (v_agency, 'w10-agency@2829.invalid'), (v_marketing, 'w10-marketing@2829.invalid'),
    (v_stranger, 'w10-stranger@2829.invalid'), (v_new_owner, 'w10-new-owner@2829.invalid'),
    (v_mingla_admin, 'w10-mingla-admin@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES
    (v_owner, now(), now()), (v_new_owner, now(), now()), (v_stranger, now(), now());
  INSERT INTO public.admin_users(email, role, status, accepted_at)
  VALUES ('w10-mingla-admin@2829.invalid', 'admin', 'active', now());
  INSERT INTO public.brands(id, account_id, name, slug) VALUES
    (v_brand, v_owner, 'W10 Client', 'w10-client'),
    (v_other_brand, v_stranger, 'W10 Other', 'w10-other');
  UPDATE public.brands SET default_currency = 'USD' WHERE id IN (v_brand, v_other_brand);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
    (v_brand, v_admin, 'brand_admin', now()),
    (v_brand, v_agency, 'brand_admin', now()),
    (v_brand, v_marketing, 'marketing_manager', now());
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
  PERFORM public.brand_site_admin_grant(v_other_brand, 'rollout', NULL);
  PERFORM pg_temp.issue_2830_complete_brand_setup(v_brand, v_owner);
  PERFORM pg_temp.issue_2830_complete_brand_setup(v_other_brand, v_stranger);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_site := (public.brand_site_provision(v_brand, gen_random_uuid(), repeat('3', 64))->>'site_id')::uuid;
  PERFORM public.brand_site_complete_provision(v_site,
    (SELECT operation_id FROM public.brand_site_operation_receipts
     WHERE site_id = v_site AND kind = 'provision'), gen_random_uuid()::text);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_stranger)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  v_other_site := (public.brand_site_provision(v_other_brand, gen_random_uuid(), repeat('4', 64))->>'site_id')::uuid;

  -- ── grants: RPC-only ─────────────────────────────────────────────────────
  IF has_table_privilege('authenticated', 'public.brand_site_preview_links', 'SELECT')
    OR has_table_privilege('anon', 'public.brand_site_preview_links', 'SELECT')
    OR has_table_privilege('authenticated', 'public.brand_site_preview_links', 'INSERT') THEN
    RAISE EXCEPTION 'brand_site_preview_links is reachable as a table';
  END IF;
  IF has_function_privilege('authenticated', 'public.brand_site_resolve_preview_link(uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.brand_site_resolve_preview_link(uuid,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_record_preview_artifact(uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.brand_site_create_preview_link(uuid,integer,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_end_member_access(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a service-only share function is callable by members or visitors';
  END IF;

  -- ── Studio's newest preview: only a preview object of THIS site ─────────
  v_key := 'publications/' || v_site || '/preview-' || repeat('c', 32) || '/' || repeat('d', 64) || '.json';
  FOREACH v_result IN ARRAY ARRAY[
    to_jsonb('publications/' || v_other_site || '/preview-' || repeat('c', 32) || '/' || repeat('d', 64) || '.json'),
    to_jsonb('publications/' || v_site || '/' || gen_random_uuid() || '/' || repeat('d', 64) || '.json'),
    to_jsonb('publications/' || v_site || '/preview-' || repeat('c', 32) || '/' || repeat('d', 64) || '.json/../x'),
    to_jsonb(''::text)
  ] LOOP
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_record_preview_artifact(v_site, v_result #>> '{}');
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'sites_validation_failed';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'a foreign or malformed preview key was recorded: %', v_result; END IF;
  END LOOP;
  v_failed := false;
  BEGIN
    UPDATE public.brand_sites SET latest_preview_artifact_key =
      'publications/' || v_other_site || '/preview-' || repeat('c', 32) || '/' || repeat('d', 64) || '.json',
      latest_preview_built_at = now() WHERE id = v_site;
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'the table accepted another site''s preview key'; END IF;

  -- ── share links: who may create, for how long ───────────────────────────
  FOREACH v_user IN ARRAY ARRAY[v_marketing, v_stranger] LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_create_preview_link(v_site, 7, v_digest);
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'sites_forbidden';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager or stranger made a share link'; END IF;
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_list_preview_links(v_site);
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'sites_forbidden';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager or stranger listed share links'; END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  FOREACH v_count IN ARRAY ARRAY[0, 15, -1] LOOP
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_create_preview_link(v_site, v_count, repeat('b', 64));
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'sites_validation_failed';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'a % day link was accepted', v_count; END IF;
  END LOOP;
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_create_preview_link(v_site, 7, 'not-a-digest');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'sites_validation_failed';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a non-digest token value was stored'; END IF;

  v_result := public.brand_site_create_preview_link(v_site, 7, v_digest);
  v_link := (v_result->>'id')::uuid;
  IF (v_result->>'preview_ready')::boolean THEN RAISE EXCEPTION 'preview_ready before any preview was built'; END IF;
  IF (v_result->>'expires_at')::timestamptz NOT BETWEEN now() + interval '7 days' - interval '1 minute' AND now() + interval '7 days' + interval '1 minute' THEN
    RAISE EXCEPTION 'a 7 day link expires at %', v_result->>'expires_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_site_audit_log WHERE action = 'share_link.created'
      AND resource_id = v_link::text AND actor_user_id = v_owner AND metadata = jsonb_build_object('ttl_days', 7)) THEN
    RAISE EXCEPTION 'creating a link was not audited';
  END IF;

  -- ── the runtime resolves a link only for its own site, once a preview exists
  IF public.brand_site_resolve_preview_link(v_site, v_digest) IS NOT NULL THEN
    RAISE EXCEPTION 'a link resolved before any preview existed';
  END IF;
  PERFORM public.brand_site_record_preview_artifact(v_site, v_key);
  v_result := public.brand_site_resolve_preview_link(v_site, v_digest);
  IF v_result->>'artifact_key' IS DISTINCT FROM v_key OR (v_result->>'link_id')::uuid <> v_link THEN
    RAISE EXCEPTION 'a live link did not resolve to the newest preview: %', v_result;
  END IF;
  -- even when the other site has a preview of its own
  PERFORM public.brand_site_record_preview_artifact(v_other_site,
    'publications/' || v_other_site || '/preview-' || repeat('c', 32) || '/' || repeat('d', 64) || '.json');
  IF public.brand_site_resolve_preview_link(v_other_site, v_digest) IS NOT NULL THEN
    RAISE EXCEPTION 'a link resolved on another site';
  END IF;
  IF public.brand_site_resolve_preview_link(v_site, repeat('f', 64)) IS NOT NULL
    OR public.brand_site_resolve_preview_link(v_site, 'x') IS NOT NULL THEN
    RAISE EXCEPTION 'an unknown token resolved';
  END IF;
  IF (SELECT view_count FROM public.brand_site_preview_links WHERE id = v_link) <> 1
    OR (SELECT last_viewed_at FROM public.brand_site_preview_links WHERE id = v_link) IS NULL THEN
    RAISE EXCEPTION 'viewing a link was not counted';
  END IF;
  -- a newer preview is what the same link shows next
  PERFORM public.brand_site_record_preview_artifact(v_site,
    'publications/' || v_site || '/preview-' || repeat('e', 32) || '/' || repeat('9', 64) || '.json');
  IF public.brand_site_resolve_preview_link(v_site, v_digest)->>'artifact_key' NOT LIKE '%preview-eeee%' THEN
    RAISE EXCEPTION 'the link did not follow the newest preview';
  END IF;

  -- listing never carries the token digest
  v_result := public.brand_site_list_preview_links(v_site);
  IF jsonb_array_length(v_result) <> 1 OR v_result::text LIKE '%' || v_digest || '%'
    OR v_result->0->>'state' <> 'active' THEN
    RAISE EXCEPTION 'link list wrong or leaks the digest: %', v_result;
  END IF;

  -- expiry ends a link
  UPDATE public.brand_site_preview_links SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = v_link;
  IF public.brand_site_resolve_preview_link(v_site, v_digest) IS NOT NULL THEN
    RAISE EXCEPTION 'an expired link still resolved';
  END IF;
  IF public.brand_site_list_preview_links(v_site)->0->>'state' <> 'expired' THEN
    RAISE EXCEPTION 'an expired link is not listed as expired';
  END IF;

  -- revoke (rank 50; a marketing manager cannot) ends a link
  v_link := (public.brand_site_create_preview_link(v_site, 1, repeat('1', 64))->>'id')::uuid;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_revoke_preview_link(v_link);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'sites_forbidden';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager revoked a link'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_stranger)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_revoke_preview_link(v_link);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'sites_forbidden';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'another brand''s owner revoked this brand''s link'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  IF public.brand_site_resolve_preview_link(v_site, repeat('1', 64)) IS NULL THEN
    RAISE EXCEPTION 'a fresh link did not resolve';
  END IF;
  PERFORM public.brand_site_revoke_preview_link(v_link);
  IF public.brand_site_resolve_preview_link(v_site, repeat('1', 64)) IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked link still resolved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_site_audit_log WHERE action = 'share_link.revoked' AND resource_id = v_link::text AND actor_user_id = v_admin) THEN
    RAISE EXCEPTION 'revoking was not audited';
  END IF;

  -- at most 20 working links per site
  FOR v_count IN 1..19 LOOP
    PERFORM public.brand_site_create_preview_link(v_site, 1, encode(extensions.digest('cap-' || v_count, 'sha256'), 'hex'));
  END LOOP;
  PERFORM public.brand_site_create_preview_link(v_site, 1, encode(extensions.digest('cap-20', 'sha256'), 'hex'));
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_create_preview_link(v_site, 1, encode(extensions.digest('cap-21', 'sha256'), 'hex'));
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'sites_invalid_state';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a 21st working link was made'; END IF;
  UPDATE public.brand_site_preview_links SET revoked_at = now(), revoke_reason = 'owner' WHERE site_id = v_site AND revoked_at IS NULL;

  -- ── handover: the agency's access ends when the client removes it ───────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_agency)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_agency::text, true);
  v_agency_link := (public.brand_site_create_preview_link(v_site, 14, repeat('2', 64))->>'id')::uuid;
  -- a 14-day link is exactly 14 days (one clock reading for both ends)
  IF (SELECT expires_at - created_at FROM public.brand_site_preview_links WHERE id = v_agency_link) <> interval '14 days' THEN
    RAISE EXCEPTION 'a 14-day link is not exactly 14 days';
  END IF;
  INSERT INTO public.brand_site_editor_exchanges(site_id, brand_id, user_id, code_digest, destination,
    role_snapshot, membership_revision, issued_at, expires_at)
  VALUES (v_site, v_brand, v_agency, repeat('7', 64), 'studio', 50, 'm1', now(), now() + interval '60 seconds'),
    (v_site, v_brand, v_admin, repeat('8', 64), 'studio', 50, 'm1', now(), now() + interval '60 seconds');
  INSERT INTO public.brand_site_plans(brand_id, lock_holder, lock_expires_at, started_at, started_by)
  VALUES (v_brand, v_agency, now() + interval '10 minutes', now(), v_agency)
  ON CONFLICT (brand_id) DO UPDATE SET lock_holder = EXCLUDED.lock_holder, lock_expires_at = EXCLUDED.lock_expires_at;

  -- demoted, but still able to edit (finance manager, rank 30): nothing ends
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  UPDATE public.brand_team_members SET role = 'finance_manager' WHERE brand_id = v_brand AND user_id = v_agency;
  IF (SELECT status FROM public.brand_site_editor_exchanges WHERE code_digest = repeat('7', 64)) <> 'issued'
    OR public.brand_site_resolve_preview_link(v_site, repeat('2', 64)) IS NULL
    OR (SELECT lock_holder FROM public.brand_site_plans WHERE brand_id = v_brand) IS DISTINCT FROM v_agency THEN
    RAISE EXCEPTION 'a demotion that keeps editing rank ended access';
  END IF;

  -- removed: codes revoked, lock released, the agency's links stop, audited
  UPDATE public.brand_team_members SET removed_at = now() WHERE brand_id = v_brand AND user_id = v_agency;
  IF (SELECT status FROM public.brand_site_editor_exchanges WHERE code_digest = repeat('7', 64)) <> 'revoked' THEN
    RAISE EXCEPTION 'the removed member''s Studio code was not revoked';
  END IF;
  IF (SELECT status FROM public.brand_site_editor_exchanges WHERE code_digest = repeat('8', 64)) <> 'issued' THEN
    RAISE EXCEPTION 'another member''s Studio code was revoked';
  END IF;
  IF (SELECT lock_holder FROM public.brand_site_plans WHERE brand_id = v_brand) IS NOT NULL THEN
    RAISE EXCEPTION 'the removed member still holds the plan lock';
  END IF;
  IF public.brand_site_resolve_preview_link(v_site, repeat('2', 64)) IS NOT NULL
    OR (SELECT revoke_reason FROM public.brand_site_preview_links WHERE id = v_agency_link) <> 'member_access_ended' THEN
    RAISE EXCEPTION 'the removed member''s share link still works';
  END IF;
  SELECT metadata INTO v_result FROM public.brand_site_audit_log
  WHERE action = 'member.access_ended' AND resource_id = v_agency::text AND site_id = v_site;
  IF v_result IS NULL OR v_result->>'reason_code' <> 'MEMBER_REMOVED'
    OR (v_result->>'exchanges_revoked')::int <> 1 OR (v_result->>'links_revoked')::int <> 1
    OR NOT (v_result->>'lock_released')::boolean THEN
    RAISE EXCEPTION 'handover not audited as it happened: %', v_result;
  END IF;
  IF (SELECT actor_user_id FROM public.brand_site_audit_log WHERE action = 'member.access_ended' AND resource_id = v_agency::text) <> v_owner THEN
    RAISE EXCEPTION 'the audit row does not name who ended the access';
  END IF;

  -- demoted below 20 (scanner) and a deleted membership row end access too
  INSERT INTO public.brand_site_editor_exchanges(site_id, brand_id, user_id, code_digest, destination,
    role_snapshot, membership_revision, issued_at, expires_at)
  VALUES (v_site, v_brand, v_marketing, repeat('6', 64), 'studio', 20, 'm1', now(), now() + interval '60 seconds');
  UPDATE public.brand_team_members SET role = 'scanner' WHERE brand_id = v_brand AND user_id = v_marketing;
  IF (SELECT status FROM public.brand_site_editor_exchanges WHERE code_digest = repeat('6', 64)) <> 'revoked'
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_audit_log WHERE action = 'member.access_ended'
      AND resource_id = v_marketing::text AND metadata->>'reason_code' = 'MEMBER_DEMOTED') THEN
    RAISE EXCEPTION 'demotion below the editing rank did not end access';
  END IF;
  INSERT INTO public.brand_site_editor_exchanges(site_id, brand_id, user_id, code_digest, destination,
    role_snapshot, membership_revision, issued_at, expires_at)
  VALUES (v_site, v_brand, v_admin, repeat('5', 64), 'studio', 50, 'm1', now(), now() + interval '60 seconds');
  -- (a hard delete is a service-side cleanup, made without a member session)
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  DELETE FROM public.brand_team_members WHERE brand_id = v_brand AND user_id = v_admin;
  IF (SELECT status FROM public.brand_site_editor_exchanges WHERE code_digest = repeat('5', 64)) <> 'revoked' THEN
    RAISE EXCEPTION 'deleting the membership did not end access';
  END IF;

  -- the client claims the brand: the previous account owner's access ends
  INSERT INTO public.brand_site_editor_exchanges(site_id, brand_id, user_id, code_digest, destination,
    role_snapshot, membership_revision, issued_at, expires_at)
  VALUES (v_site, v_brand, v_owner, repeat('4', 64), 'studio', 60, 'm1', now(), now() + interval '60 seconds');
  -- the existing owner-transfer path arms its own switch for the move
  PERFORM set_config('app.allow_brand_owner_transfer', 'on', true);
  DELETE FROM public.brand_team_members WHERE brand_id = v_brand AND user_id = v_owner;
  IF (SELECT status FROM public.brand_site_editor_exchanges WHERE code_digest = repeat('4', 64)) <> 'issued' THEN
    RAISE EXCEPTION 'the account owner lost access while still the owner';
  END IF;
  UPDATE public.brands SET account_id = v_new_owner WHERE id = v_brand;
  PERFORM set_config('app.allow_brand_owner_transfer', 'off', true);
  IF (SELECT status FROM public.brand_site_editor_exchanges WHERE code_digest = repeat('4', 64)) <> 'revoked'
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_audit_log WHERE action = 'member.access_ended'
      AND resource_id = v_owner::text AND metadata->>'reason_code' = 'OWNER_CHANGED') THEN
    RAISE EXCEPTION 'the previous owner kept access after the brand changed hands';
  END IF;
  IF public.biz_brand_effective_rank(v_brand, v_new_owner) <> 60 THEN
    RAISE EXCEPTION 'the new owner is not the owner';
  END IF;
  -- #2829 W11 (design contract: "The brand changes owner — the site, plan
  -- and versions move with the brand"): the new owner sees the same site
  -- (its status, with Core's owner capabilities) and the same plan.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_new_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_new_owner::text, true);
  v_result := public.brand_site_business_availability(v_brand);
  IF NOT (v_result->>'available')::boolean OR NOT (v_result->>'can_publish')::boolean THEN
    RAISE EXCEPTION 'the new owner cannot manage the site: %', v_result;
  END IF;
  v_result := public.brand_site_plan_get(v_brand);
  IF (v_result->'site'->>'id')::uuid IS DISTINCT FROM v_site THEN
    RAISE EXCEPTION 'the plan did not move with the brand: %', v_result->'site';
  END IF;

  -- ── analytics: new events and page addresses, nothing else ──────────────
  INSERT INTO public.brand_site_publications(id, site_id, operation_id, source_revision_id, source_digest, status, requested_by)
  VALUES (v_publication, v_site, gen_random_uuid(), 'r-1', repeat('5', 64), 'materializing', v_new_owner);
  INSERT INTO public.brand_site_analytics_events(event_id, site_id, brand_id, publication_id, event_name, occurred_at,
    referrer_class, consent_policy_version, page_path)
  SELECT gen_random_uuid(), v_site, v_brand, v_publication, row.name, now() - interval '1 day', row.ref, 'sites-v1', row.path
  FROM (VALUES
    ('site_view', 'search', NULL), ('site_view', 'search', NULL), ('site_view', 'direct', NULL),
    ('page_view', NULL, '/trips'), ('page_view', NULL, '/trips'), ('page_view', NULL, '/'),
    ('book_click', NULL, '/trips'), ('book_click', NULL, '/trips'),
    ('form_submit_contact', NULL, '/contact-us'), ('form_submit_newsletter', NULL, '/'),
    ('outbound_click', NULL, '/about-us'), ('offering_view', NULL, '/trips')
  ) AS row(name, ref, path);
  -- older than 30 days is not counted
  INSERT INTO public.brand_site_analytics_events(event_id, site_id, brand_id, publication_id, event_name, occurred_at,
    consent_policy_version, page_path)
  VALUES (gen_random_uuid(), v_site, v_brand, v_publication, 'page_view', now() - interval '40 days', 'sites-v1', '/old');
  FOREACH v_key IN ARRAY ARRAY['/trips?email=a@b.c', 'trips', '/<script>', '/' || repeat('a', 300)] LOOP
    v_failed := false;
    BEGIN
      INSERT INTO public.brand_site_analytics_events(event_id, site_id, brand_id, publication_id, event_name,
        consent_policy_version, page_path)
      VALUES (gen_random_uuid(), v_site, v_brand, v_publication, 'page_view', 'sites-v1', v_key);
    EXCEPTION WHEN check_violation THEN
      v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'page address % was stored', v_key; END IF;
  END LOOP;
  v_failed := false;
  BEGIN
    INSERT INTO public.brand_site_analytics_events(event_id, site_id, brand_id, publication_id, event_name, consent_policy_version)
    VALUES (gen_random_uuid(), v_site, v_brand, v_publication, 'scroll_depth', 'sites-v1');
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an unknown visitor event was stored'; END IF;
  IF NOT public.brand_site_json_keys_allowed('{"event_name":"page_view","page_path":"/x"}'::jsonb,
      ARRAY['event_name','page_path']) THEN
    RAISE EXCEPTION 'key check helper changed';
  END IF;
  IF position('''page_path''' IN pg_get_functiondef('public.brand_site_record_analytics_event(jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the event recorder does not accept a page address';
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_new_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_new_owner::text, true);
  v_result := public.brand_site_customer_analytics(v_site);
  IF (v_result->>'visits_30d')::int <> 3 OR (v_result->>'book_clicks_30d')::int <> 2
    OR (v_result->>'outbound_clicks_30d')::int <> 1 OR (v_result->>'form_submissions_30d')::int <> 2
    OR (v_result->>'page_views_30d')::int <> 3 THEN
    RAISE EXCEPTION 'analytics counts wrong: %', v_result;
  END IF;
  IF v_result->'top_pages' <> '[{"path": "/trips", "views": 2}, {"path": "/", "views": 1}]'::jsonb THEN
    RAISE EXCEPTION 'top pages wrong: %', v_result->'top_pages';
  END IF;
  IF v_result->'sources' <> '{"search": 2, "direct": 1}'::jsonb THEN
    RAISE EXCEPTION 'sources wrong: %', v_result->'sources';
  END IF;
  IF NOT (v_result ? 'enquiries_30d' AND v_result ? 'bookings_30d') THEN
    RAISE EXCEPTION 'enquiries or bookings missing';
  END IF;
  IF public.brand_site_overview_counts(v_site) - 'generated_at' <> v_result - 'generated_at' THEN
    RAISE EXCEPTION 'the overview counter disagrees with the analytics reader';
  END IF;
  FOREACH v_user IN ARRAY ARRAY[v_stranger, v_marketing] LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_customer_analytics(v_site);
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'sites_forbidden';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'someone outside the brand (or a scanner) read its analytics'; END IF;
  END LOOP;

  RAISE NOTICE 'ISSUE_2829_W10_SHARE_HANDOVER_ANALYTICS_OK';
END;
$w10$;

ROLLBACK;
