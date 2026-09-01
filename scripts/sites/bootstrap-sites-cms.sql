\set ON_ERROR_STOP on
\set QUIET on

-- #2893 activates #2830's checked-in Sites foundation without embedding any
-- project identifier, user identifier or credential in source. psql imports
-- sensitive values from the process environment; this file never prints them.
\getenv sites_cms_migrator_password SITES_CMS_MIGRATOR_PASSWORD
\getenv sites_cms_app_password SITES_CMS_APP_PASSWORD
\getenv sites_runtime_reader_subject SITES_RUNTIME_READER_SUBJECT
\getenv sites_pilot_site_id SITES_PILOT_SITE_ID

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
  AND :'sites_pilot_site_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
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
    20971520,
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'sites-media-approved',
    'sites-media-approved',
    false,
    20971520,
    ARRAY['image/webp']::text[]
  ),
  (
    'sites-publication-artifacts',
    'sites-publication-artifacts',
    false,
    20971520,
    ARRAY['application/json']::text[]
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
-- receives SELECT only through its exact JWT subject and exact pilot paths.
DROP POLICY IF EXISTS sites_runtime_reader_pilot_select ON storage.objects;
CREATE POLICY sites_runtime_reader_pilot_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  auth.uid() = :'sites_runtime_reader_subject'::uuid
  AND (
    (
      bucket_id = 'sites-publication-artifacts'
      AND name ~ (
        '^publications/' || :'sites_pilot_site_id' ||
        '/[0-9a-f-]{36}/[0-9a-f]{64}\\.json$'
      )
    )
    OR
    (
      bucket_id = 'sites-media-approved'
      AND name ~ (
        '^approved/' || :'sites_pilot_site_id' ||
        '/[0-9a-f-]{36}/[0-9a-f]{64}/(master|320|640|960|1440|1920)\\.webp$'
      )
    )
  )
);

-- A second policy for authenticated/PUBLIC would compose with OR and silently
-- widen this identity. A new project must have no competing user-facing policy.
DO $policy_containment$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname <> 'sites_runtime_reader_pilot_select'
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
  AND bool_and(file_size_limit = 20971520)
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
