-- #4334 rollback capture (tester R3-4 / N-8). Run READ-ONLY against production
-- BEFORE 20280521004334_issue_4334_google_places.sql is applied:
--
--   psql "$PROD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f scripts/issue-4334/capture-rollback.sql > rollback-4334.sql
--
-- Run the printed file as the objects' owner (postgres), the same role that
-- applies migrations, so grantors match the captured ACLs.
-- It prints rollback-4334.sql: one transaction that puts every object the
-- migration re-emits back to the CAPTURED (pre-apply) state. Before running that
-- file, run `scripts/issue-4334/repin-to-google.ts --restore <applied.json>`
-- (step a: it needs places_repin_restore, which the rollback drops) and put the
-- edge functions back on the pre-#4334 bundle. Rehearsed end to end on a local
-- replay: after the rollback every captured function body, ACL and comment, the
-- view, the chat-plan columns, the cron job and the api-health rows equal the
-- pre-apply database (recorded on #4334).
--
-- What the printed script does, in order:
--   d  unschedule places-coordinate-refresh-daily; delete the four Google
--      api-health tiles; restore the captured `mapbox` and `google_places` rows
--      (the old vendor's check history is deleted by the migration and is not
--      restorable — export it before apply if it is wanted).
--   e  drop the six tg_4334_* triggers.
--   b  rename chat_plans / chat_plan_place_options provider_place_id → mapbox_id
--      and both constraints back; drop chat_plan_place_identity_key (its third
--      argument was renamed, which CREATE OR REPLACE cannot undo) before the
--      captured 4261 bodies are re-created.
--   c  drop every overload the migration added (the 23-/10-argument venue RPCs),
--      re-create every captured function from its captured body (A-2, A-1, N-1
--      and the chat-plan functions), and restate each one's captured ACL and
--      comment. business_public_events_view: DROP VIEW + CREATE from the
--      captured body with its captured options, ACL and comment (CREATE OR
--      REPLACE cannot drop the appended column).
--   f  drop the places_* functions the migration added (inert after d and e).
-- Secret: the pre-#4334 edge bundle a rollback puts back reads MAPBOX_ACCESS_TOKEN,
-- so that secret stays set (and declared in supabase/secrets.manifest.json, with
-- this file as its reader) until the rollback window closes. The unset, the
-- manifest row and this note go together in the PR that records the unset; the
-- deploy readiness preflight requires the live set to equal the manifest.
-- Kept on purpose: the added columns, indexes and CHECKs (inert), the looser
-- 1024-character place-id cap, and the #2489 carrier rows (append-only data).
SET search_path = '';
WITH names(n) AS (
  VALUES ('admin_review_venue_details_change'), ('biz_create_venue_listing'),
         ('biz_submit_venue_details_change_request'), ('biz_update_venue_identity_in_review'),
         ('business_create_event_draft'), ('business_patch_event_taxonomy_with_place'),
         ('business_publish_event_draft'), ('business_publish_rsvp_draft'),
         ('business_update_event_draft'), ('business_update_live_event_atomic'),
         ('business_update_rsvp_graph'), ('chat_plan_parse_where'),
         ('chat_plan_place_identity_key'), ('chat_plan_seed_original_place'),
         ('chat_plans_for_conversation'), ('pg_direct_event_checkout_bundle'),
         ('pg_public_event_by_slug'), ('pg_public_rsvp_by_slug'), ('plan_add_place'),
         ('plan_create'), ('plan_lock'),
         -- names the migration creates fresh; captured only if they already exist
         ('places_checked_place_id'), ('places_is_google_place_id'), ('places_json_number'),
         ('places_json_timestamptz'), ('places_refresh_alert_summary'),
         ('places_refresh_chat_plan_in_scope'), ('places_refresh_due_pins'),
         ('places_refresh_event_in_scope'), ('places_refresh_expire_past'),
         ('places_refresh_pins'), ('places_refresh_record'), ('places_repin_apply'),
         ('places_repin_candidates'), ('places_repin_precision'), ('places_repin_restore'),
         ('places_trip_patch'), ('tg_4334_chat_plans_place_stamp'),
         ('tg_4334_events_place_stamp'), ('tg_4334_experience_stops_place_stamp'),
         ('tg_4334_lat_lng_place_stamp'), ('tg_4334_preferences_place_stamp')
),
fns AS (
  SELECT p.oid, p.proname, p.oid::regprocedure::text AS sig, p.proacl,
         pg_catalog.pg_get_userbyid(p.proowner) AS owner,
         pg_catalog.pg_get_functiondef(p.oid) AS def,
         pg_catalog.obj_description(p.oid, 'pg_proc') AS cmt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = 'public'
    JOIN names ON names.n = p.proname
),
acl_sql AS (
  SELECT f.sig,
         'REVOKE ALL ON FUNCTION ' || f.sig || ' FROM PUBLIC, anon, authenticated, service_role;' || E'\n' ||
         COALESCE((
           SELECT string_agg('GRANT EXECUTE ON FUNCTION ' || f.sig || ' TO ' ||
                    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(r.rolname) END || ';', E'\n'
                    ORDER BY a.grantee)
             FROM pg_catalog.aclexplode(COALESCE(f.proacl, pg_catalog.acldefault('f', (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = f.oid)))) a
             LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
            WHERE a.privilege_type = 'EXECUTE'
              AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role'))
         ), '') AS acl
    FROM fns f
),
view_src AS (
  SELECT c.oid, pg_catalog.pg_get_viewdef(c.oid, true) AS def, c.reloptions, c.relacl,
         pg_catalog.pg_get_userbyid(c.relowner) AS owner,
         pg_catalog.obj_description(c.oid, 'pg_class') AS cmt
    FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.business_public_events_view'::regclass
),
health AS (
  SELECT string_agg(pg_catalog.format(
           'INSERT INTO public.api_health_services (service_key, display_name, category, sort_order, monitoring_class, depletion_signal) VALUES (%L, %L, %L, %s, %L, %L::jsonb) ON CONFLICT (service_key) DO UPDATE SET display_name = EXCLUDED.display_name, category = EXCLUDED.category, sort_order = EXCLUDED.sort_order, monitoring_class = EXCLUDED.monitoring_class, depletion_signal = EXCLUDED.depletion_signal;',
           s.service_key, s.display_name, s.category, s.sort_order, s.monitoring_class, s.depletion_signal::text), E'\n' ORDER BY s.service_key) AS sql
    FROM public.api_health_services s
   WHERE s.service_key IN ('mapbox', 'google_places')
)
SELECT concat_ws(E'\n',
  '-- #4334 rollback, generated ' || now()::text || ' from the pre-apply database.',
  '\set ON_ERROR_STOP on',
  'BEGIN;',
  'SET LOCAL search_path = public, extensions, pg_temp;',
  '-- d. cron + api-health',
  'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''places-coordinate-refresh-daily'';',
  'DELETE FROM public.api_health_alert_state WHERE service_key IN (''google_place_details'', ''google_geocoding'', ''google_static_maps'', ''google_place_refresh'');',
  'DELETE FROM public.api_health_checks WHERE service_key IN (''google_place_details'', ''google_geocoding'', ''google_static_maps'', ''google_place_refresh'');',
  'DELETE FROM public.api_health_services WHERE service_key IN (''google_place_details'', ''google_geocoding'', ''google_static_maps'', ''google_place_refresh'');',
  (SELECT sql FROM health),
  'INSERT INTO public.api_health_alert_state (service_key) VALUES (''mapbox'') ON CONFLICT (service_key) DO NOTHING;',
  '-- e. stamp triggers',
  'DROP TRIGGER IF EXISTS tg_4334_events_place_stamp ON public.events;',
  'DROP TRIGGER IF EXISTS tg_4334_experience_stops_place_stamp ON public.experience_stops;',
  'DROP TRIGGER IF EXISTS tg_4334_venue_listings_place_stamp ON public.venue_listings;',
  'DROP TRIGGER IF EXISTS tg_4334_brands_place_stamp ON public.brands;',
  'DROP TRIGGER IF EXISTS tg_4334_preferences_place_stamp ON public.preferences;',
  'DROP TRIGGER IF EXISTS tg_4334_chat_plans_place_stamp ON public.chat_plans;',
  '-- b. chat plans',
  'ALTER TABLE public.chat_plans RENAME COLUMN provider_place_id TO mapbox_id;',
  'ALTER TABLE public.chat_plans RENAME CONSTRAINT chat_plans_provider_place_id_length TO chat_plans_mapbox_id_length;',
  'ALTER TABLE public.chat_plan_place_options RENAME COLUMN provider_place_id TO mapbox_id;',
  'ALTER TABLE public.chat_plan_place_options RENAME CONSTRAINT chat_plan_place_options_provider_place_id_length TO chat_plan_place_options_mapbox_id_length;',
  'DROP FUNCTION IF EXISTS public.chat_plan_place_identity_key(text, uuid, text, text, text, text);',
  '-- c. overloads the migration added (not in the captured set)',
  'DO $drop$ DECLARE r record; BEGIN FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = ''public'' WHERE p.proname = ANY (ARRAY[' ||
    (SELECT string_agg(pg_catalog.quote_literal(n), ', ') FROM names) ||
    ']) AND p.oid::regprocedure::text <> ALL (ARRAY[' ||
    COALESCE((SELECT string_agg(pg_catalog.quote_literal(sig), ', ') FROM fns), '''''') ||
    ']::text[]) LOOP EXECUTE ''DROP FUNCTION '' || r.sig::text; END LOOP; END $drop$;',
  '-- c. captured function bodies, ACLs and comments',
  (SELECT string_agg(f.def || ';' || E'\n' ||
           'ALTER FUNCTION ' || f.sig || ' OWNER TO ' || pg_catalog.quote_ident(f.owner) || ';' || E'\n' || a.acl ||
           CASE WHEN f.cmt IS NULL THEN '' ELSE E'\n' || 'COMMENT ON FUNCTION ' || f.sig || ' IS ' || pg_catalog.quote_literal(f.cmt) || ';' END,
           E'\n' ORDER BY f.proname, f.sig)
     FROM fns f JOIN acl_sql a USING (sig)),
  '-- c. business_public_events_view',
  'DROP VIEW public.business_public_events_view;',
  (SELECT 'CREATE VIEW public.business_public_events_view' ||
          CASE WHEN v.reloptions IS NULL THEN '' ELSE ' WITH (' || array_to_string(v.reloptions, ', ') || ')' END ||
          ' AS' || E'\n' || v.def || E'\n' ||
          'ALTER VIEW public.business_public_events_view OWNER TO ' || pg_catalog.quote_ident(v.owner) || ';' || E'\n' ||
          'REVOKE ALL ON TABLE public.business_public_events_view FROM PUBLIC, anon, authenticated, service_role;' || E'\n' ||
          COALESCE((SELECT string_agg('GRANT ' || x.privs || ' ON TABLE public.business_public_events_view TO ' || x.who || ';', E'\n' ORDER BY x.pos)
                      FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(r.rolname) END AS who,
                                   string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type) AS privs,
                                   min(a.ord) AS pos
                              FROM pg_catalog.aclexplode(v.relacl) WITH ORDINALITY a(grantor, grantee, privilege_type, is_grantable, ord)
                              LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
                             WHERE a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role')
                             GROUP BY 1) x), '') ||
          CASE WHEN v.cmt IS NULL THEN '' ELSE E'\n' || 'COMMENT ON VIEW public.business_public_events_view IS ' || pg_catalog.quote_literal(v.cmt) || ';' END
     FROM view_src v),
  '-- f. the functions the migration added',
  'DO $dropnew$ DECLARE r record; BEGIN FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = ''public'' WHERE p.proname = ANY (ARRAY[' ||
    (SELECT string_agg(pg_catalog.quote_literal(n), ', ') FROM names WHERE n NOT IN (SELECT proname FROM fns)) ||
    ']) LOOP EXECUTE ''DROP FUNCTION '' || r.sig::text; END LOOP; END $dropnew$;',
  'NOTIFY pgrst, ''reload schema'';',
  'COMMIT;'
);
