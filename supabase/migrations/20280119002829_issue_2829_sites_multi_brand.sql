BEGIN;
SET LOCAL lock_timeout = '10s';

-- #2829 — Mingla Sites for more than one brand.
--
-- Section 1 (wave W0): the service configuration row learns which environment
-- it belongs to. Production keeps today's origin and host-suffix rules
-- exactly; the loopback origins and `sites.localhost` suffix a developer's
-- local stack needs are accepted ONLY on a row whose environment is 'local'.
-- No migration ever writes a 'local' row: only the local seed script
-- (scripts/sites/local/seed-local.mjs) does, against a local database.
-- `host.docker.internal` is the Docker host gateway: Core edge functions run
-- inside Docker locally and reach Studio on the host through it (amendment
-- A2.3). It is a local-only name, so production rows refuse it as well.
-- Forward-only; the existing production row becomes 'production' by default
-- and already satisfies the production rules.

ALTER TABLE public.brand_site_service_config
  ADD COLUMN environment text NOT NULL DEFAULT 'production'
    CONSTRAINT brand_site_service_config_environment_ck
    CHECK (environment IN ('production', 'local'));

ALTER TABLE public.brand_site_service_config
  DROP CONSTRAINT brand_site_service_config_cms_origin_ck,
  DROP CONSTRAINT brand_site_service_config_runtime_origin_ck,
  DROP CONSTRAINT brand_site_service_config_public_host_suffix_check;

ALTER TABLE public.brand_site_service_config
  ADD CONSTRAINT brand_site_service_config_cms_origin_ck CHECK (
    CASE environment
      WHEN 'production' THEN
        cms_origin ~ '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?$'
        AND cms_origin !~ '(localhost|127\.0\.0\.1|host\.docker\.internal|@|\*|\?|#)'
      WHEN 'local' THEN
        cms_origin ~ '^http://(127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]{2,5}$'
      ELSE false
    END
  ),
  ADD CONSTRAINT brand_site_service_config_runtime_origin_ck CHECK (
    CASE environment
      WHEN 'production' THEN
        public_runtime_origin ~ '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?$'
        AND public_runtime_origin !~ '(localhost|127\.0\.0\.1|host\.docker\.internal|@|\*|\?|#)'
      WHEN 'local' THEN
        public_runtime_origin ~ '^http://(127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]{2,5}$'
      ELSE false
    END
  ),
  ADD CONSTRAINT brand_site_service_config_public_host_suffix_ck CHECK (
    CASE environment
      WHEN 'production' THEN public_host_suffix = 'sites.usemingla.com'
      WHEN 'local' THEN public_host_suffix = 'sites.localhost'
      ELSE false
    END
  );

-- The environment is fixed when the row is created. Flipping a production row
-- to 'local' would be the one-statement way to admit loopback origins, so it
-- is refused outright (recreate the row on a local database instead).
CREATE OR REPLACE FUNCTION public.brand_site_service_config_environment_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.environment IS DISTINCT FROM OLD.environment THEN
    RAISE EXCEPTION 'brand_site_environment_immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_service_config_environment_immutable()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER brand_site_service_config_environment_immutable
BEFORE UPDATE OF environment ON public.brand_site_service_config
FOR EACH ROW EXECUTE FUNCTION public.brand_site_service_config_environment_immutable();

COMMENT ON COLUMN public.brand_site_service_config.environment IS
  '#2829 production|local. Insert-only. Loopback origins and the sites.localhost suffix are accepted only on a local row; migrations never write one.';

COMMIT;
