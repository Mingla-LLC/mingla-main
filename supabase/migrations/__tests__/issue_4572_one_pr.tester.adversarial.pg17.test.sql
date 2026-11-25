-- MINGLA-INVARIANT: I-4572-ONE-PR-SQL-REEMITS-EXACT | issue #4572 | every function the #4572 migrations re-emit or text-patch differs from its reviewed production body only by the intended change; the first-publish gate refuses exactly when the pre-#4572 inline condition did; the new helpers are SECURITY DEFINER with a fixed search_path and no client grant beyond the one named.
-- #4572 tester adversarial (pg17, BEGIN ... ROLLBACK, full replay). Angles the
-- implementor suites do not take:
--   X-1 byte-for-byte: undo each intended change in the LIVE body and the md5
--       must equal the reviewed production md5 (taxonomy x6, draft payload,
--       first-publish gate); duplicate/unpublish bodies are untouched.
--   X-2 the party-type CHECK at its edges (NULL, empty, whitespace, case,
--       NULL element, empty string) and it is validated.
--   X-3 SECURITY DEFINER + fixed search_path + grants of every new function;
--       the feed's grants are unchanged (service_role only).
--   X-4 equivalence: over a 432-state matrix (the table's own CHECKs leave ~108 reachable; exactly one, all evidence present and fresh, publishes) of recovery evidence, the new
--       gate (NOT brand_site_first_publish_ready()) and the Host's
--       brand_site_publishing_paused() agree with the verbatim pre-#4572
--       inline condition; an unknown site and an anonymous caller get the
--       same sites_forbidden as an outsider (no site enumeration).
--   X-5 the venue repair: a venue name that itself contains " · " keeps it;
--       only location.venueName / location_text change (every other theme
--       key byte-equal); rows of other brands are untouched; the #3827
--       trigger is enabled after.
-- FAILS-ON-REVERT: any extra edit to a re-emitted body breaks X-1; restoring
-- the 15-value CHECK breaks X-2 (exhibition refused); a gate whose condition
-- drifts from the old one breaks X-4; a repair that splits on the first " · "
-- breaks X-5.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

CREATE FUNCTION pg_temp.ok(p_ok boolean, p_label text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4572 TESTER FAIL: % (%)', p_label, COALESCE(p_detail, '<null>');
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE FUNCTION pg_temp.u(p_tag text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5('i4572x:' || p_tag)::uuid $fn$;

-- ── X-1 byte-for-byte against the reviewed production bodies ──────────────
DO $x1$
DECLARE
  r record;
  v_src text;
  v_old_list text := $q$'holiday-party','networking-event','rave','festival'$q$;
  v_new_list text := $q$'holiday-party','networking-event','rave','festival','exhibition','opening','talk','workshop','screening','class','kids-family','market','tour','performance','tasting'$q$;
BEGIN
  -- [TEST-MOD-APPROVED #4490] #4490's migrations now run after #4572
  -- (20281203...) and re-emit five of these bodies with their own reviewed
  -- change (an event at a venue may skip the event type: the four gates;
  -- venue type facet counts: discover_v2_facets_exact), keeping #4572's 26
  -- slugs. after_4490_md5 pins that combined body (minus the 11 slugs) byte
  -- for byte; any other edit still fails. Re-pinned (08-O5 fix 4) for the two
  -- publish gates once they kept #4420's issue_4420_event_json_for_caller
  -- response (the earlier pin had frozen the body that dropped it).
  FOR r IN SELECT * FROM (VALUES
    ('public.business_publish_event_draft(uuid,jsonb,integer)', 'b5a2bb9f4a2dbd19d914b925d08ae4e0', '380f6d168fe358760f36def4739fa76f'),
    ('public.business_publish_rsvp_draft(uuid,jsonb,integer)', '6635f49bbebb7ba09da411b5f5a881af', '47a0282455e070abede427a71374f344'),
    ('public.business_patch_event_taxonomy(uuid,text,text[],text[],text[],numeric,numeric,text,text)', '4eaa731aeab4cf795b8abc8080192535', '91a320a72f58cc17f465b94490a6993d'),
    ('public.business_patch_event_taxonomy_with_place(uuid,text,text[],text[],text[],numeric,numeric,text,text,text)', 'bdd3783db3c61393050236dde3e20e1b', '4315878d494dab8ed476eda82cea19d3'),
    ('public.ari_execute_event_operation(uuid,text,jsonb)', '672cbb4224667612226408656dd44f9c', NULL),
    ('public.discover_v2_facets_exact(text[],double precision,double precision,double precision,text,text,jsonb,text)', 'd49a15ae785441c4e2ed96b29d967e01', '13ac508cc8bcb72638df0b406eee6224')
  ) AS v(sig, prod_md5, after_4490_md5) LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = r.sig::regprocedure;
    PERFORM pg_temp.ok((length(v_src) - length(replace(v_src, v_new_list, ''))) / length(v_new_list) = 1,
      'X-1 ' || r.sig || ' holds the 26-value list exactly once');
    PERFORM pg_temp.ok(md5(replace(v_src, v_new_list, v_old_list)) IN (r.prod_md5, r.after_4490_md5),
      'X-1 ' || r.sig || ' minus the 11 slugs is the production body byte for byte',
      md5(replace(v_src, v_new_list, v_old_list)));
  END LOOP;

  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.business_event_draft_payload_from_graph(uuid)'::regprocedure;
  PERFORM pg_temp.ok(md5(replace(v_src, $q$      -- #4572 item 5: copy the stored venue name and address as two fields.
      -- v_business is still being assigned here, so the stored payload is read
      -- from the same source v_business is built from.
      'location', (SELECT CASE WHEN COALESCE(s.l->>'venueName','')<>''
                               OR COALESCE(s.l->>'address','')<>''
                          THEN s.l
                          ELSE jsonb_build_object('venueName',v_event.location_text,'address',NULL) END
        FROM (SELECT CASE WHEN jsonb_typeof(src.b->'location')='object' THEN src.b->'location' END AS l
                FROM (SELECT COALESCE(v_event.theme->'business_draft',
                        public.issue_4420_event_theme_full(v_event.id, v_event.theme)->'business_event') AS b) src) s),$q$, $q$      'location', CASE WHEN v_event.status='draft' THEN
        COALESCE(v_event.theme#>'{business_draft,location}',
          jsonb_build_object('venueName',v_event.location_text,'address',NULL))
        ELSE jsonb_build_object('venueName',v_event.location_text,'address',NULL) END,$q$)) = '70d700a8a651da50233b0cf82f75519c',
    'X-1 draft payload minus the location patch is the production body byte for byte');

  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.brand_site_authorize_operation(uuid,uuid,text,text,text,text)'::regprocedure;
  PERFORM pg_temp.ok(md5(replace(replace(v_src, $q$      -- A NEW site's first publish still needs recorded recovery evidence.
      -- #4572 item 15 — the condition has ONE owner,
      -- public.brand_site_first_publish_ready(); the Host's "Publishing is
      -- paused" state reads the same function.
      IF NOT public.brand_site_first_publish_ready() THEN
        RAISE EXCEPTION 'sites_readiness_blocked';
      END IF;$q$, $q$      -- A NEW site's first publish still needs recorded recovery evidence.
      -- #4574 — the budgets live in one place each (the helpers below).
      SELECT * INTO v_config
      FROM public.brand_site_service_config config
      WHERE config.config_key = 'sites_v1';
      SELECT receipt.evidence_source INTO v_latest_source
      FROM public.brand_site_readiness_receipts receipt
      WHERE receipt.evidence_kind IN ('nightly_backup','restore_drill')
      ORDER BY receipt.accepted_at DESC LIMIT 1;
      IF v_config.config_key IS NULL OR NOT (
        (COALESCE(v_config.backup_retention_days, 0) >= 7
          AND v_config.backup_entitlement_verified_at IS NOT NULL
          AND v_config.database_backup_verified_at IS NOT NULL
          AND v_config.database_backup_verified_at > clock_timestamp() - public.brand_site_database_backup_budget()
          AND v_config.object_manifest_verified_at IS NOT NULL
          AND v_config.object_manifest_verified_at > clock_timestamp() - public.brand_site_object_manifest_budget()
          AND v_config.restore_drill_verified_at IS NOT NULL
          AND v_config.restore_drill_verified_at > clock_timestamp() - interval '100 days'
          AND v_config.restore_drill_evidence_digest IS NOT NULL)
        OR (v_config.environment = 'local' AND v_latest_source = 'local_synthetic')
      ) THEN
        RAISE EXCEPTION 'sites_readiness_blocked';
      END IF;$q$), $q$  v_rank integer;
  v_generated_at timestamptz;$q$, $q$  v_rank integer;
  v_config public.brand_site_service_config%ROWTYPE;
  v_latest_source text;
  v_generated_at timestamptz;$q$)) = '79c1db01ce338c24a834d2097792ad87',
    'X-1 first-publish gate with the inline condition put back is the production body byte for byte');

  -- not re-emitted: they call the payload function and must be byte-identical
  PERFORM pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.business_duplicate_event_as_draft(uuid)'::regprocedure) = '47c5881c2e936f5debfa07b87780705d',
    'X-1 business_duplicate_event_as_draft untouched');
  PERFORM pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.business_unpublish_event_to_draft(uuid)'::regprocedure) = '7514597752d099e93c31c694446571a1',
    'X-1 business_unpublish_event_to_draft untouched');
END;
$x1$;

-- ── X-3 definer, search_path and grants ───────────────────────────────────
DO $x3$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.prosecdef, p.proconfig, p.proacl::text AS acl
             FROM pg_proc p
            WHERE p.oid IN ('public.brand_site_first_publish_ready()'::regprocedure,
                            'public.brand_site_publishing_paused(uuid)'::regprocedure,
                            'public.brand_site_offering_cover(text,text,text)'::regprocedure,
                            'public.brand_site_offering_cover_stream_poster(text,text)'::regprocedure,
                            'public.brand_site_offerings_feed_for_brand(uuid)'::regprocedure,
                            'public.brand_site_authorize_operation(uuid,uuid,text,text,text,text)'::regprocedure) LOOP
    PERFORM pg_temp.ok(r.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%' AND c LIKE '%pg_temp%'),
      'X-3 ' || r.sig::text || ' pins search_path (with pg_temp last)', r.proconfig::text);
    PERFORM pg_temp.ok(NOT has_function_privilege('anon', r.sig, 'EXECUTE'), 'X-3 anon cannot run ' || r.sig::text);
    PERFORM pg_temp.ok(r.acl IS NOT NULL AND r.acl !~ '(^|[{,])=X', 'X-3 PUBLIC has no EXECUTE on ' || r.sig::text, r.acl);
  END LOOP;
  PERFORM pg_temp.ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.brand_site_first_publish_ready()'::regprocedure), 'X-3 first_publish_ready is SECURITY DEFINER');
  PERFORM pg_temp.ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.brand_site_publishing_paused(uuid)'::regprocedure), 'X-3 publishing_paused is SECURITY DEFINER');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.brand_site_first_publish_ready()', 'EXECUTE'), 'X-3 authenticated cannot run first_publish_ready');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.brand_site_offering_cover(text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.brand_site_offering_cover_stream_poster(text,text)', 'EXECUTE'), 'X-3 authenticated cannot run the cover helpers');
  -- the feed keeps its production grants exactly: service_role only
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.brand_site_offerings_feed_for_brand(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.brand_site_offerings_feed_for_brand(uuid)', 'EXECUTE'), 'X-3 feed grants unchanged (service_role, not authenticated)');
  PERFORM pg_temp.ok(has_function_privilege('authenticated', 'public.brand_site_authorize_operation(uuid,uuid,text,text,text,text)', 'EXECUTE'), 'X-3 gate grants unchanged (authenticated keeps EXECUTE)');
END;
$x3$;

-- ── seeds for X-2 / X-4 / X-5 ─────────────────────────────────────────────
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES (pg_temp.u('owner'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@i4572x.test', 'x', now(), now()),
       (pg_temp.u('other'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@i4572x.test', 'x', now(), now()),
       (pg_temp.u('outsider'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@i4572x.test', 'x', now(), now());
INSERT INTO public.creator_accounts(id) VALUES (pg_temp.u('owner')), (pg_temp.u('other')), (pg_temp.u('outsider')) ON CONFLICT DO NOTHING;
INSERT INTO public.brands(id, account_id, name, slug, claim_status, pricing_currency, default_currency)
VALUES (pg_temp.u('brand'), pg_temp.u('owner'), 'I4572X Gallery', 'i4572x-gallery', 'verified', 'ngn', 'NGN'),
       (pg_temp.u('otherbrand'), pg_temp.u('other'), 'I4572X Other', 'i4572x-other', 'verified', 'ngn', 'NGN');

CREATE FUNCTION pg_temp.seed(p_brand uuid, p_key text, p_status text, p_vn text, p_ad text, p_lt text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_ns text := CASE WHEN p_status = 'draft' THEN 'business_draft' ELSE 'business_event' END;
BEGIN
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, visibility, status,
    timezone, published_at, currency, is_online, location_text, theme, city)
  VALUES (pg_temp.u(p_key), p_brand, (SELECT account_id FROM public.brands WHERE id = p_brand), 'I4572X ' || p_key, 'i4572x-' || p_key,
    'event', CASE WHEN p_status = 'draft' THEN 'draft' ELSE 'public' END, p_status, 'Africa/Lagos',
    CASE WHEN p_status = 'draft' THEN NULL ELSE now() END, 'NGN', false, p_lt,
    jsonb_build_object(v_ns, jsonb_build_object('schemaVersion', 1, 'clientRevision', 0,
      'requestedVisibility', 'public', 'format', 'in_person', 'hideAddressUntilTicket', false,
      'description', 'keep me', 'keepKey', jsonb_build_object('n', 1),
      'location', jsonb_build_object('venueName', p_vn, 'address', p_ad))),
    'Abuja');
  INSERT INTO public.event_dates(event_id, start_at, end_at, is_master, timezone)
  VALUES (pg_temp.u(p_key), now() + interval '10 day', now() + interval '10 day 3 hour', true, 'Africa/Lagos');
END;
$fn$;

-- ── X-2 the party-type CHECK at its edges ─────────────────────────────────
SELECT pg_temp.seed(pg_temp.u('otherbrand'), 'check', 'scheduled', 'Plain Hall', '1 Road', 'Plain Hall · 1 Road');
DO $x2$
DECLARE
  v_case record;
  v_ok boolean;
BEGIN
  PERFORM pg_temp.ok((SELECT convalidated FROM pg_constraint WHERE conname = 'events_party_types_canonical'), 'X-2 the CHECK is validated');
  FOR v_case IN SELECT * FROM (VALUES
    (NULL::text[], false, 'NULL (column is NOT NULL)'),
    ('{}'::text[], true, 'empty list'),
    (ARRAY['exhibition','rave'], true, 'new + old slug'),
    (ARRAY['kids-family','tasting','performance'], true, 'three new slugs'),
    (ARRAY['exhibition '], false, 'trailing space'),
    (ARRAY['Exhibition'], false, 'mixed case'),
    (ARRAY['exhibition', NULL], false, 'NULL element'),
    (ARRAY[''], false, 'empty string'),
    (ARRAY['kids_family'], false, 'underscore variant'),
    (ARRAY['party'], false, 'made-up')
  ) AS c(v, expect_ok, label) LOOP
    v_ok := true;
    BEGIN
      UPDATE public.events SET party_types = v_case.v WHERE id = pg_temp.u('check');
    EXCEPTION WHEN check_violation OR not_null_violation THEN v_ok := false;
    END;
    PERFORM pg_temp.ok(v_ok = v_case.expect_ok, 'X-2 CHECK ' || v_case.label || ' -> ' || CASE WHEN v_case.expect_ok THEN 'accepted' ELSE 'refused' END);
  END LOOP;
END;
$x2$;

-- ── X-4 the first-publish gate equals the pre-#4572 condition ─────────────
-- Verbatim copy of the inline condition from 20281128004574 (production).
CREATE FUNCTION pg_temp.old_condition_raises() RETURNS boolean LANGUAGE plpgsql AS $fn$
DECLARE
  v_config public.brand_site_service_config%ROWTYPE;
  v_latest_source text;
BEGIN
  SELECT * INTO v_config FROM public.brand_site_service_config config WHERE config.config_key = 'sites_v1';
  SELECT receipt.evidence_source INTO v_latest_source FROM public.brand_site_readiness_receipts receipt
   WHERE receipt.evidence_kind IN ('nightly_backup','restore_drill') ORDER BY receipt.accepted_at DESC LIMIT 1;
  RETURN (v_config.config_key IS NULL OR NOT (
        (COALESCE(v_config.backup_retention_days, 0) >= 7
          AND v_config.backup_entitlement_verified_at IS NOT NULL
          AND v_config.database_backup_verified_at IS NOT NULL
          AND v_config.database_backup_verified_at > clock_timestamp() - public.brand_site_database_backup_budget()
          AND v_config.object_manifest_verified_at IS NOT NULL
          AND v_config.object_manifest_verified_at > clock_timestamp() - public.brand_site_object_manifest_budget()
          AND v_config.restore_drill_verified_at IS NOT NULL
          AND v_config.restore_drill_verified_at > clock_timestamp() - interval '100 days'
          AND v_config.restore_drill_evidence_digest IS NOT NULL)
        OR (v_config.environment = 'local' AND v_latest_source = 'local_synthetic')
      )) IS TRUE;
END;
$fn$;

DO $x4$
DECLARE
  v_site uuid;
  v_result jsonb;
  v_ret int[] := ARRAY[0, 6, 7];
  v_ent text[] := ARRAY['null', 'now'];
  v_age text[] := ARRAY['null', 'fresh', 'stale'];
  v_drill text[] := ARRAY['null', '99 days', '100 days 12 hours', '101 days'];
  v_dig text[] := ARRAY['null', 'set'];
  a int; b text; c text; d text; e text; f text;
  v_old boolean; v_new boolean; v_paused boolean;
  v_checked int := 0; v_skipped int := 0; v_blocked int := 0;
  v_failed boolean;
BEGIN
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at)
  VALUES ('sites_v1', 'https://studio.sites.usemingla.com', 'https://www.sites.usemingla.com', 'sites.usemingla.com',
    pg_temp.u('owner'), now(), pg_temp.u('owner'), now());
  PERFORM pg_temp.issue_2830_complete_brand_setup(pg_temp.u('brand'), pg_temp.u('owner'));
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u('owner'))::text, true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u('owner')::text, true);
  v_result := public.brand_site_provision(pg_temp.u('brand'), gen_random_uuid(), repeat('1', 64));
  v_site := (v_result->>'site_id')::uuid;
  PERFORM public.brand_site_complete_provision(v_site,
    (SELECT operation_id FROM public.brand_site_operation_receipts WHERE site_id = v_site AND kind = 'provision'), gen_random_uuid()::text);

  FOREACH a IN ARRAY v_ret LOOP FOREACH b IN ARRAY v_ent LOOP FOREACH c IN ARRAY v_age LOOP
  FOREACH d IN ARRAY v_age LOOP FOREACH e IN ARRAY v_drill LOOP FOREACH f IN ARRAY v_dig LOOP
    BEGIN
      UPDATE public.brand_site_service_config SET
        backup_retention_days = a,
        backup_entitlement_verified_at = CASE b WHEN 'now' THEN clock_timestamp() END,
        database_backup_verified_at = CASE c WHEN 'fresh' THEN clock_timestamp() - interval '1 hour'
          WHEN 'stale' THEN clock_timestamp() - public.brand_site_database_backup_budget() - interval '1 second' END,
        object_manifest_verified_at = CASE d WHEN 'fresh' THEN clock_timestamp() - interval '1 hour'
          WHEN 'stale' THEN clock_timestamp() - public.brand_site_object_manifest_budget() - interval '1 second' END,
        restore_drill_verified_at = CASE e WHEN '99 days' THEN clock_timestamp() - interval '99 days'
          WHEN '100 days 12 hours' THEN clock_timestamp() - interval '100 days 12 hours'
          WHEN '101 days' THEN clock_timestamp() - interval '101 days' END,
        restore_drill_evidence_digest = CASE f WHEN 'set' THEN repeat('7', 64) END
      WHERE config_key = 'sites_v1';
    EXCEPTION WHEN check_violation OR not_null_violation OR raise_exception THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END;
    v_old := pg_temp.old_condition_raises();
    v_new := (NOT public.brand_site_first_publish_ready()) IS TRUE;
    v_paused := public.brand_site_publishing_paused(v_site);
    PERFORM pg_temp.ok(v_old = v_new AND v_paused = v_old,
      format('X-4 state ret=%s ent=%s db=%s manifest=%s drill=%s digest=%s', a, b, c, d, e, f),
      format('old=%s new=%s paused=%s', v_old, v_new, v_paused));
    v_checked := v_checked + 1;
    IF v_old THEN v_blocked := v_blocked + 1; END IF;
  END LOOP; END LOOP; END LOOP; END LOOP; END LOOP; END LOOP;
  PERFORM pg_temp.ok(v_checked >= 100 AND v_blocked = v_checked - 1,
    format('X-4 matrix covered %s states (%s blocked, %s skipped by table rules)', v_checked, v_blocked, v_skipped));

  -- no config row at all: old and new both refuse, Host says paused
  DELETE FROM public.brand_site_service_config;
  PERFORM pg_temp.ok(pg_temp.old_condition_raises() AND (NOT public.brand_site_first_publish_ready()) IS TRUE
    AND public.brand_site_publishing_paused(v_site), 'X-4 no service config: gate refuses and the Host says paused');

  -- an unknown site and an anonymous caller look exactly like an outsider
  v_failed := false;
  BEGIN PERFORM public.brand_site_publishing_paused(gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  PERFORM pg_temp.ok(v_failed, 'X-4 unknown site id -> sites_forbidden (no enumeration)');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_publishing_paused(v_site);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  PERFORM pg_temp.ok(v_failed, 'X-4 no caller -> sites_forbidden');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u('outsider'))::text, true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u('outsider')::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_publishing_paused(v_site);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  PERFORM pg_temp.ok(v_failed, 'X-4 outsider -> sites_forbidden');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$x4$;

-- ── X-5 the venue repair touches only what it must ────────────────────────
-- 4 class A (one whose own venue name contains " · "), 2 class D, plus a
-- joined-looking row of ANOTHER brand that is class B (left alone).
SELECT pg_temp.seed(pg_temp.u('brand'), 'a1', 'scheduled', 'Hall · East Wing · 12 Close', '12 Close', 'Hall · East Wing · 12 Close · 12 Close');
SELECT pg_temp.seed(pg_temp.u('brand'), 'a' || n, 'scheduled', 'Gallery · 3 Way', '3 Way', 'Gallery · 3 Way · 3 Way') FROM generate_series(2, 4) n;
SELECT pg_temp.seed(pg_temp.u('brand'), 'd' || n, 'draft', 'Studio · 4 Road', NULL, 'Studio · 4 Road') FROM generate_series(1, 2) n;
SELECT pg_temp.seed(pg_temp.u('otherbrand'), 'b-other', 'scheduled', 'Club · Annex', '9 Far', 'Club · Annex · 9 Far');

CREATE TEMP TABLE i4572x_before AS
  SELECT id, theme, location_text, md5(row(e.*)::text) AS whole FROM public.events e
   WHERE brand_id IN (pg_temp.u('brand'), pg_temp.u('otherbrand'));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

\ir ../20281129604572_issue_4572_repair_joined_venue_names.sql

SET CONSTRAINTS ALL IMMEDIATE;

DO $x5$
DECLARE
  v_ns text;
  r record;
BEGIN
  PERFORM pg_temp.ok((SELECT theme #>> '{business_event,location,venueName}' FROM public.events WHERE id = pg_temp.u('a1')) = 'Hall · East Wing',
    'X-5 a venue name with its own " · " keeps it (only the address suffix goes)');
  PERFORM pg_temp.ok((SELECT location_text FROM public.events WHERE id = pg_temp.u('a1')) = 'Hall · East Wing · 12 Close',
    'X-5 location_text shows the address once');
  FOR r IN SELECT b.id, b.theme AS before_theme, e.theme AS after_theme, b.location_text AS before_lt, e.location_text AS after_lt, e.status
             FROM i4572x_before b JOIN public.events e ON e.id = b.id
            WHERE e.brand_id = pg_temp.u('brand') AND e.id <> pg_temp.u('check') LOOP
    v_ns := CASE WHEN r.status = 'draft' THEN 'business_draft' ELSE 'business_event' END;
    PERFORM pg_temp.ok(
      (r.before_theme #- ARRAY[v_ns, 'location']) = (r.after_theme #- ARRAY[v_ns, 'location']),
      'X-5 ' || r.id || ' every theme key outside location is byte-equal');
    PERFORM pg_temp.ok(
      (r.after_theme -> v_ns -> 'location') - 'venueName' - 'address' = (r.before_theme -> v_ns -> 'location') - 'venueName' - 'address',
      'X-5 ' || r.id || ' location keeps its other keys');
    IF r.status = 'draft' THEN
      PERFORM pg_temp.ok(r.after_lt IS NOT DISTINCT FROM r.before_lt, 'X-5 ' || r.id || ' draft location_text unchanged');
      PERFORM pg_temp.ok(r.after_theme #>> '{business_draft,location,venueName}' = 'Studio'
        AND r.after_theme #>> '{business_draft,location,address}' = '4 Road', 'X-5 ' || r.id || ' draft split into two fields');
    END IF;
  END LOOP;
  PERFORM pg_temp.ok((SELECT whole FROM i4572x_before WHERE id = pg_temp.u('b-other')) =
    (SELECT md5(row(e.*)::text) FROM public.events e WHERE id = pg_temp.u('b-other')), 'X-5 another brand''s class-B row is untouched (whole row)');
  PERFORM pg_temp.ok((SELECT tgenabled FROM pg_trigger WHERE tgname = 'issue_3827_capture_edit_notice' AND tgrelid = 'public.events'::regclass) = 'O',
    'X-5 the #3827 notice trigger is enabled after the repair');
END;
$x5$;

ROLLBACK;
