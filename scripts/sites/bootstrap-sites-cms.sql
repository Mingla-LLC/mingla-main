\set ON_ERROR_STOP on
\set QUIET on

-- #2893 activates #2830's checked-in Sites foundation without embedding any
-- project identifier, user identifier or credential in source. psql imports
-- sensitive values from the process environment; this file never prints them.
\getenv sites_cms_migrator_password SITES_CMS_MIGRATOR_PASSWORD
\getenv sites_cms_app_password SITES_CMS_APP_PASSWORD
\getenv sites_runtime_reader_subject SITES_RUNTIME_READER_SUBJECT

SELECT
  length(:'sites_cms_migrator_password') >= 32
  AND length(:'sites_cms_app_password') >= 32
  AND :'sites_cms_migrator_password' <> :'sites_cms_app_password'
  AS sites_passwords_valid
\gset
\if :sites_passwords_valid
\else
  \echo 'SITES_BOOTSTRAP_ERROR code=INVALID_ROLE_CREDENTIALS'
  SELECT 1 / 0;
\endif

SELECT
  :'sites_runtime_reader_subject' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AS sites_scope_valid
\gset
\if :sites_scope_valid
\else
  \echo 'SITES_BOOTSTRAP_ERROR code=INVALID_RUNTIME_SCOPE'
  SELECT 1 / 0;
\endif

BEGIN;

DO $bootstrap_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sites_cms_migrator') THEN
    CREATE ROLE sites_cms_migrator LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sites_cms_app') THEN
    CREATE ROLE sites_cms_app LOGIN;
  END IF;
END
$bootstrap_roles$;

ALTER ROLE sites_cms_migrator
  WITH LOGIN NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  PASSWORD :'sites_cms_migrator_password';
ALTER ROLE sites_cms_app
  WITH LOGIN NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  PASSWORD :'sites_cms_app_password';
ALTER ROLE sites_cms_migrator SET search_path = sites_cms, public;
ALTER ROLE sites_cms_app SET search_path = sites_cms, public;

-- Supabase's managed `postgres` role has CREATEROLE but is intentionally not a
-- true superuser. PostgreSQL therefore rejects even an explicit NOSUPERUSER
-- clause. New roles are non-superuser by default; prove that invariant after
-- applying every managed-platform-compatible hardening attribute.
DO $role_attribute_containment$
BEGIN
  IF (
    SELECT count(*) <> 2
      OR NOT bool_and(
        rolcanlogin
        AND NOT rolsuper
        AND NOT rolcreatedb
        AND NOT rolcreaterole
        AND NOT rolinherit
        AND NOT rolreplication
        AND NOT rolbypassrls
      )
    FROM pg_roles
    WHERE rolname IN ('sites_cms_migrator', 'sites_cms_app')
  ) THEN
    RAISE EXCEPTION 'SITES_BOOTSTRAP_ERROR code=ROLE_ATTRIBUTE_MISMATCH';
  END IF;
END
$role_attribute_containment$;

-- Ownership and ALTER DEFAULT PRIVILEGES require SET access to the target role.
-- Create a transaction-local grant from postgres, then remove that exact grant
-- before commit so only Supabase's non-inheritable admin edge remains.
GRANT sites_cms_migrator TO postgres WITH SET TRUE, INHERIT FALSE;
CREATE SCHEMA IF NOT EXISTS sites_cms AUTHORIZATION sites_cms_migrator;
ALTER SCHEMA sites_cms OWNER TO sites_cms_migrator;
SET LOCAL ROLE sites_cms_migrator;
REVOKE ALL ON SCHEMA sites_cms FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA sites_cms TO sites_cms_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sites_cms_migrator IN SCHEMA sites_cms
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE sites_cms_migrator IN SCHEMA sites_cms
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE sites_cms_migrator IN SCHEMA sites_cms
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE sites_cms_migrator IN SCHEMA sites_cms
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sites_cms_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sites_cms_migrator IN SCHEMA sites_cms
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO sites_cms_app;

-- Re-running after a deterministic Payload migration reconciles existing
-- objects as well as the future-object defaults above.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sites_cms TO sites_cms_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA sites_cms TO sites_cms_app;
REVOKE ALL ON ALL TABLES IN SCHEMA sites_cms FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sites_cms FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sites_cms FROM PUBLIC, anon, authenticated, service_role;
RESET ROLE;
REVOKE sites_cms_migrator FROM postgres GRANTED BY postgres;

-- Role attributes are not the whole privilege boundary: a pre-existing role
-- membership could silently restore capabilities that the ALTER ROLE above
-- removed. PostgreSQL 16+ automatically gives a non-superuser role creator an
-- ADMIN-only membership in each role it creates. Managed Supabase relies on
-- that edge so `postgres` can reconcile passwords on a later bootstrap. Allow
-- exactly those two non-inheritable, non-settable admin edges and nothing else.
DO $role_membership_containment$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    JOIN pg_roles member_role ON member_role.oid = membership.member
    JOIN pg_roles grantor_role ON grantor_role.oid = membership.grantor
    WHERE (
      granted_role.rolname IN ('sites_cms_migrator', 'sites_cms_app')
      OR member_role.rolname IN ('sites_cms_migrator', 'sites_cms_app')
    )
      AND NOT (
        granted_role.rolname IN ('sites_cms_migrator', 'sites_cms_app')
        AND member_role.rolname = current_user
        AND grantor_role.rolname = 'supabase_admin'
        AND membership.admin_option
        AND NOT membership.inherit_option
        AND NOT membership.set_option
      )
  ) THEN
    RAISE EXCEPTION 'SITES_BOOTSTRAP_ERROR code=ROLE_MEMBERSHIP_PRESENT';
  END IF;

  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    AND (
      SELECT count(*) <> 2
        OR NOT bool_and(
          member_role.rolname = current_user
          AND grantor_role.rolname = 'supabase_admin'
          AND membership.admin_option
          AND NOT membership.inherit_option
          AND NOT membership.set_option
        )
      FROM pg_auth_members membership
      JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles member_role ON member_role.oid = membership.member
      JOIN pg_roles grantor_role ON grantor_role.oid = membership.grantor
      WHERE granted_role.rolname IN ('sites_cms_migrator', 'sites_cms_app')
    ) THEN
    RAISE EXCEPTION 'SITES_BOOTSTRAP_ERROR code=ROLE_ADMIN_MEMBERSHIP_MISMATCH';
  END IF;
END
$role_membership_containment$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'sites-media-quarantine',
    'sites-media-quarantine',
    false,
    -- #2829 W6 (AD-9) — a site's file video may be up to 50 MiB (pictures
    -- keep their 20 MiB cap in the CMS gate). MP4 only.
    52428800,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4']::text[]
  ),
  (
    'sites-media-approved',
    'sites-media-approved',
    false,
    52428800,
    -- #2829 AD-3 — self-hosted Google font files live here under fonts/.
    -- #2829 W6 — approved file videos, master.mp4, live here too.
    -- #2829 W11 — TrueType font previews for the Business app, fonts/<sha256>.ttf;
    -- only Studio's signed links read them, never the runtime reader.
    ARRAY['image/webp', 'font/woff2', 'font/ttf', 'video/mp4']::text[]
  ),
  (
    'sites-publication-artifacts',
    'sites-publication-artifacts',
    false,
    20971520,
    -- #2829 — site exports ("Download everything") are zips under exports/.
    ARRAY['application/json', 'application/zip']::text[]
  ),
  (
    'sites-media-recovery',
    'sites-media-recovery',
    false,
    20971520,
    ARRAY['image/webp', 'application/json']::text[]
  )
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- The runtime user is provisioned through Supabase Auth outside this SQL. It
-- receives SELECT only through its exact JWT subject and exact object paths.
-- #2829 — the public runtime serves every entitled brand, so the path grammar
-- names ANY site id (a uuid segment). Which site a request may read is bound
-- per request in the runtime (the host Core resolved); this policy keeps the
-- reader to published artifacts and approved renditions only.
-- #2829 W2 — and to private PREVIEW artifacts (`preview-<32 hex>` in place of
-- the publication id), which the runtime preview route reads with this same
-- reader. Without it every preview was refused by storage (400) and the
-- preview page answered 404. The runtime still binds a preview to its own
-- host's site and its exact digest.
DROP POLICY IF EXISTS sites_runtime_reader_pilot_select ON storage.objects;
DROP POLICY IF EXISTS sites_runtime_reader_select ON storage.objects;
CREATE POLICY sites_runtime_reader_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  auth.uid() = :'sites_runtime_reader_subject'::uuid
  AND (
    (
      bucket_id = 'sites-publication-artifacts'
      AND name ~ '^publications/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/([0-9a-f-]{36}|preview-[0-9a-f]{32})/[0-9a-f]{64}\.json$'
    )
    OR
    (
      bucket_id = 'sites-media-approved'
      -- #2829 W6 — and an approved file video's master.mp4 (served with
      -- byte ranges, each 1 MiB chunk verified by the runtime).
      -- #2829 W7b — and a picture's extra renditions (c400, c768, w1600).
      AND name ~ '^approved/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}/[0-9a-f]{64}/((master|320|640|960|1440|1920|c400|c768|w1600)\.webp|master\.mp4)$'
    )
    OR
    (
      -- #2829 AD-3 — content-addressed font files (public open-source works,
      -- shared by every site); the runtime serves only digests the request
      -- host's own artifact lists.
      bucket_id = 'sites-media-approved'
      AND name ~ '^fonts/[0-9a-f]{64}\.woff2$'
    )
  )
);

-- Execute PostgreSQL's real regex engine against the exact policy grammar.
-- This catches over-escaping that a JavaScript or static-text approximation
-- cannot detect before the runtime reader is entrusted with a publication.
WITH path_patterns AS (
  SELECT
    '^publications/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/([0-9a-f-]{36}|preview-[0-9a-f]{32})/[0-9a-f]{64}\.json$' AS artifact_pattern,
    '^approved/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}/[0-9a-f]{64}/((master|320|640|960|1440|1920|c400|c768|w1600)\.webp|master\.mp4)$'
      AS media_pattern,
    '^fonts/[0-9a-f]{64}\.woff2$' AS font_pattern,
    repeat('a', 8) || '-' || repeat('a', 4) || '-4' || repeat('a', 3) ||
      '-8' || repeat('a', 3) || '-' || repeat('a', 12) AS site_a,
    repeat('b', 8) || '-' || repeat('b', 4) || '-4' || repeat('b', 3) ||
      '-8' || repeat('b', 3) || '-' || repeat('b', 12) AS site_b,
    repeat('1', 8) || '-' || repeat('1', 4) || '-4' || repeat('1', 3) ||
      '-8' || repeat('1', 3) || '-' || repeat('1', 12) AS publication_id,
    repeat('2', 8) || '-' || repeat('2', 4) || '-4' || repeat('2', 3) ||
      '-8' || repeat('2', 3) || '-' || repeat('2', 12) AS media_id
)
SELECT
  ('publications/' || site_a || '/' || publication_id || '/' || repeat('a', 64) || '.json') ~ artifact_pattern
  AND ('publications/' || site_b || '/' || publication_id || '/' || repeat('a', 64) || '.json') ~ artifact_pattern
  AND NOT ('publications/../' || publication_id || '/' || repeat('a', 64) || '.json') ~ artifact_pattern
  AND NOT ('publications/' || site_a || '/' || publication_id || '/' || repeat('a', 64) || '.jsonx') ~ artifact_pattern
  AND NOT ('exports/' || site_a || '/' || publication_id || '.zip') ~ artifact_pattern
  AND ('publications/' || site_a || '/preview-' || repeat('c', 32) || '/' || repeat('a', 64) || '.json') ~ artifact_pattern
  AND NOT ('publications/' || site_a || '/preview-' || repeat('c', 31) || '/' || repeat('a', 64) || '.json') ~ artifact_pattern
  AND NOT ('publications/' || site_a || '/preview-' || repeat('c', 32) || 'x/' || repeat('a', 64) || '.json') ~ artifact_pattern
  AND NOT ('publications/' || site_a || '/drafts-' || repeat('c', 32) || '/' || repeat('a', 64) || '.json') ~ artifact_pattern
  AND ('approved/' || site_a || '/' || media_id || '/' || repeat('b', 64) || '/320.webp') ~ media_pattern
  AND ('approved/' || site_a || '/' || media_id || '/' || repeat('b', 64) || '/c768.webp') ~ media_pattern
  AND NOT ('approved/' || site_a || '/' || media_id || '/' || repeat('b', 64) || '/c999.webp') ~ media_pattern
  AND NOT ('approved/' || site_a || '/' || media_id || '/' || repeat('b', 64) || '/original.webp') ~ media_pattern
  AND ('approved/' || site_a || '/' || media_id || '/' || repeat('b', 64) || '/master.mp4') ~ media_pattern
  AND NOT ('approved/' || site_a || '/' || media_id || '/' || repeat('b', 64) || '/320.mp4') ~ media_pattern
  AND NOT ('approved/' || site_a || '/' || media_id || '/' || repeat('b', 64) || '/master.mp4x') ~ media_pattern
  AND NOT ('approved/' || site_a || 'x/' || media_id || '/' || repeat('b', 64) || '/320.webp') ~ media_pattern
  AND NOT ('quarantine/' || site_a || '/probe.webp') ~ media_pattern
  AND NOT ('recovery/' || site_a || '/probe.json') ~ artifact_pattern
  AND ('fonts/' || repeat('d', 64) || '.woff2') ~ font_pattern
  AND NOT ('fonts/' || repeat('d', 63) || '.woff2') ~ font_pattern
  AND NOT ('fonts/../' || repeat('d', 64) || '.woff2') ~ font_pattern
  AND NOT ('fonts/' || site_a || '/' || repeat('d', 64) || '.woff2') ~ font_pattern
  AND NOT ('fonts/' || repeat('d', 64) || '.ttf') ~ font_pattern
  AS sites_runtime_reader_path_semantics_valid
FROM path_patterns
\gset
\if :sites_runtime_reader_path_semantics_valid
\else
  \echo 'SITES_BOOTSTRAP_ERROR code=RUNTIME_READER_PATH_SEMANTICS_INVALID'
  SELECT 1 / 0;
\endif

-- A second policy for authenticated/PUBLIC would compose with OR and silently
-- widen this identity. A new project must have no competing user-facing policy.
DO $policy_containment$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname <> 'sites_runtime_reader_select'
      AND (
        roles && ARRAY['public', 'anon', 'authenticated']::name[]
        OR roles IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'SITES_BOOTSTRAP_ERROR code=COMPETING_STORAGE_POLICY';
  END IF;
END
$policy_containment$;

-- Data API schemas are held in PostgREST role/database settings. Fail closed
-- if any such setting names sites_cms; never rewrite a provider setting here.
DO $data_api_containment$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_db_role_setting setting
    CROSS JOIN LATERAL unnest(setting.setconfig) AS config(value)
    CROSS JOIN LATERAL regexp_split_to_table(
      split_part(config.value, '=', 2),
      ','
    ) AS exposed(schema_name)
    WHERE split_part(config.value, '=', 1) IN (
      'pgrst.db_schemas',
      'pgrst.db_extra_search_path'
    )
      AND lower(btrim(exposed.schema_name)) = 'sites_cms'
  ) THEN
    RAISE EXCEPTION 'SITES_BOOTSTRAP_ERROR code=DATA_API_EXPOSURE';
  END IF;
  IF has_schema_privilege('anon', 'sites_cms', 'USAGE')
    OR has_schema_privilege('authenticated', 'sites_cms', 'USAGE')
    OR has_schema_privilege('service_role', 'sites_cms', 'USAGE') THEN
    RAISE EXCEPTION 'SITES_BOOTSTRAP_ERROR code=PUBLIC_SCHEMA_GRANT';
  END IF;
END
$data_api_containment$;

COMMIT;

SELECT
  (SELECT count(*) FROM storage.buckets) = 4
  AND count(*) = 4
  AND bool_and(public = false)
  -- #2829 W6 — the two media buckets take 50 MiB (file video); the others 20 MiB.
  AND bool_and(file_size_limit = CASE WHEN id IN ('sites-media-quarantine', 'sites-media-approved') THEN 52428800 ELSE 20971520 END)
  AS sites_bucket_contract_valid
FROM storage.buckets
WHERE id IN (
  'sites-media-quarantine',
  'sites-media-approved',
  'sites-publication-artifacts',
  'sites-media-recovery'
)
\gset
\if :sites_bucket_contract_valid
\else
  \echo 'SITES_BOOTSTRAP_ERROR code=BUCKET_CONTRACT_MISMATCH'
  SELECT 1 / 0;
\endif

\echo 'SITES_BOOTSTRAP_OK roles=2 private_buckets=4 runtime_reader=exact_site data_api=excluded'
