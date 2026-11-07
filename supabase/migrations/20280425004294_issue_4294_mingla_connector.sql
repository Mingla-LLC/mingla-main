-- Issue #4294 — the one Mingla connector.
--
-- Two things, in one migration:
--
--   1. Sign-in from the Claude apps (claude.ai, Desktop, mobile) and Claude
--      Code. A successful sign-in becomes a team-agent key of its own kind
--      (`claude_app` or `claude_code`) that lasts one hour, made by the one
--      key maker (team_agent_key_issue) and read by the one resolver
--      (team_agent_resolve). Every existing gateway, role and limit applies
--      unchanged. A sign-in key never replaces a personal key.
--
--   2. Company tools. An owner lists another MCP server (PostHog, AppsFlyer,
--      ...) in one table and sets its key from Mingla Admin. The key is kept
--      in Supabase Vault; the table holds only the Vault secret's id. Nothing
--      a client can call ever returns a key or any part of it. A tool of a
--      company server is offered to a person only when the row is on, their
--      role is allowed, the key is set, and the tool's exact name is listed.
--
-- Conventions as the #3802 wave 4 files: row security on with no policies,
-- no client privilege on any table, every function SECURITY DEFINER with an
-- empty search path, client functions refuse a request that came through an
-- agent. No new function name starts with team_agent_ (the #3802 self-check
-- lists those). No foreign key or trigger touches team_agent_keys,
-- team_agent_calls or team_agent_setup_codes.
--
-- Invariants (enforced by the self-check at the end and by
-- supabase/migrations/__tests__/issue_4294_mingla_connector.implementor.happy.pg17.test.sql):
--   I-4294-1 A sign-in token is a team-agent key: made only by
--            team_agent_key_issue, never replaces a personal key, expires.
--   I-4294-2 Company keys live only in Supabase Vault, are written only by
--            the owner-gated mingla_connector_set_key (and removed by
--            mingla_connector_clear_key), are read only by
--            mingla_connector_upstream_key for a running authorised call,
--            and never appear in any answer, log, audit row or admin read.
--   I-4294-3 Upstream tools are default-deny.
--   I-4294-5 Every proxied upstream request has exactly one call-log row.
--
-- Rollback (manual, owner-approved only):
--   SELECT cron.unschedule('mingla_connector_housekeeping');
--   DELETE FROM vault.secrets WHERE id IN (SELECT vault_secret_id FROM public.mingla_connector_upstreams WHERE vault_secret_id IS NOT NULL);
--   DROP FUNCTION the mingla_connector_* functions; DROP TABLE the mingla_connector_* tables;
--   restore team_agent_key_issue, team_agent_resolve, team_agent_keys_mine,
--   team_agent_keys_overview from 20270831003802 / 20270825003802;
--   UPDATE public.team_agent_keys SET revoked_at = now(), revoked_by = 'system', revoke_reason = 'owner'
--    WHERE kind <> 'personal' AND revoked_at IS NULL;
--   DROP INDEX public.team_agent_keys_one_active; recreate it on (owner_email, agent);
--   ALTER TABLE public.team_agent_keys DROP COLUMN expires_at, DROP COLUMN kind;

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Keys get a kind and, for sign-in keys, an end.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_agent_keys
  ADD COLUMN kind text NOT NULL DEFAULT 'personal',
  ADD COLUMN expires_at timestamptz;
ALTER TABLE public.team_agent_keys
  ADD CONSTRAINT team_agent_keys_kind_check CHECK (kind IN ('personal', 'claude_app', 'claude_code')),
  ADD CONSTRAINT team_agent_keys_expiry_check CHECK (kind = 'personal' OR expires_at IS NOT NULL);
-- One active key per person per agent per kind. Same name, so every check
-- that looks for it by name still finds it.
DROP INDEX public.team_agent_keys_one_active;
CREATE UNIQUE INDEX team_agent_keys_one_active
  ON public.team_agent_keys (owner_email, agent, kind) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Tables. Row security on, NO policies, no client privilege.
-- ---------------------------------------------------------------------------

-- The apps that may sign in. Changed only by migration.
CREATE TABLE public.mingla_connector_oauth_clients (
  client_id     text PRIMARY KEY,
  kind          text NOT NULL,
  label         text NOT NULL,
  redirect_uris text[] NOT NULL DEFAULT '{}',
  loopback      boolean NOT NULL DEFAULT false,
  enabled       boolean NOT NULL DEFAULT true,
  CONSTRAINT mingla_connector_oauth_clients_kind_check CHECK (kind IN ('claude_app', 'claude_code')),
  CONSTRAINT mingla_connector_oauth_clients_label_check CHECK (char_length(label) BETWEEN 1 AND 60),
  CONSTRAINT mingla_connector_oauth_clients_id_check CHECK (client_id ~ '^https://[a-z0-9.-]+/[A-Za-z0-9/_.-]{1,200}$')
);

-- One-time sign-in codes. Only a digest is kept.
CREATE TABLE public.mingla_connector_oauth_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash      text NOT NULL,
  owner_email    text NOT NULL,
  client_id      text NOT NULL REFERENCES public.mingla_connector_oauth_clients (client_id),
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  resource       text,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,
  voided_at      timestamptz,
  grant_id       uuid,
  CONSTRAINT mingla_connector_oauth_codes_hash_key UNIQUE (code_hash),
  CONSTRAINT mingla_connector_oauth_codes_hash_check CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mingla_connector_oauth_codes_owner_check CHECK (owner_email = lower(btrim(owner_email)) AND owner_email <> ''),
  CONSTRAINT mingla_connector_oauth_codes_challenge_check CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT mingla_connector_oauth_codes_redirect_check CHECK (char_length(redirect_uri) <= 200)
);
CREATE INDEX mingla_connector_oauth_codes_by_owner ON public.mingla_connector_oauth_codes (owner_email, created_at DESC);

-- A sign-in that was approved: one per app connection.
CREATE TABLE public.mingla_connector_oauth_grants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email        text NOT NULL,
  client_id          text NOT NULL REFERENCES public.mingla_connector_oauth_clients (client_id),
  kind               text NOT NULL,
  refresh_hash       text NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  current_key_id     uuid,                  -- no foreign key: team_agent_keys takes none
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_refreshed_at  timestamptz,
  last_used_at       timestamptz,           -- stamped by team_agent_resolve, at most once a minute
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoke_reason      text,
  revoked_by         text,
  CONSTRAINT mingla_connector_oauth_grants_refresh_key UNIQUE (refresh_hash),
  CONSTRAINT mingla_connector_oauth_grants_refresh_check CHECK (refresh_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mingla_connector_oauth_grants_kind_check CHECK (kind IN ('claude_app', 'claude_code')),
  CONSTRAINT mingla_connector_oauth_grants_owner_check CHECK (owner_email = lower(btrim(owner_email)) AND owner_email <> ''),
  CONSTRAINT mingla_connector_oauth_grants_reason_check CHECK (revoke_reason IS NULL OR
    revoke_reason IN ('self', 'owner', 'reuse', 'access_removed', 'expired', 'replaced')),
  CONSTRAINT mingla_connector_oauth_grants_revoked_set CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL))
);
CREATE INDEX mingla_connector_oauth_grants_by_owner ON public.mingla_connector_oauth_grants (owner_email, created_at DESC);
CREATE INDEX mingla_connector_oauth_grants_by_key ON public.mingla_connector_oauth_grants (current_key_id);

-- Refresh tokens already used once. A second use ends the grant.
CREATE TABLE public.mingla_connector_oauth_spent_refresh (
  hash     text PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES public.mingla_connector_oauth_grants (id) ON DELETE CASCADE,
  spent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mingla_connector_oauth_spent_refresh_hash_check CHECK (hash ~ '^[0-9a-f]{64}$')
);

-- Company tools. No key column: the key is in Vault, named by its id only.
CREATE TABLE public.mingla_connector_upstreams (
  slug            text PRIMARY KEY,
  label           text NOT NULL,
  mcp_url         text NOT NULL,
  vault_secret_id uuid,                     -- set only by mingla_connector_set_key / clear_key
  key_updated_at  timestamptz,
  key_updated_by  text,
  enabled         boolean NOT NULL DEFAULT false,
  allowed_roles   text[] NOT NULL DEFAULT '{}',
  tool_allowlist  text[] NOT NULL DEFAULT '{}',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by      text,
  CONSTRAINT mingla_connector_upstreams_slug_check CHECK (slug ~ '^[a-z][a-z0-9]{1,19}$'),
  CONSTRAINT mingla_connector_upstreams_label_check CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  CONSTRAINT mingla_connector_upstreams_roles_check CHECK (allowed_roles <@ ARRAY['owner', 'admin', 'partner', 'growth']::text[]),
  CONSTRAINT mingla_connector_upstreams_tools_check CHECK (cardinality(tool_allowlist) <= 200),
  CONSTRAINT mingla_connector_upstreams_notes_check CHECK (notes IS NULL OR char_length(notes) <= 500),
  CONSTRAINT mingla_connector_upstreams_key_set CHECK (
    (vault_secret_id IS NULL) OR (key_updated_at IS NOT NULL AND key_updated_by IS NOT NULL)),
  CONSTRAINT mingla_connector_upstreams_on_needs_key CHECK (NOT enabled OR vault_secret_id IS NOT NULL)
);

-- One row per proxied upstream request. Never an argument, a result, a
-- header or a key.
CREATE TABLE public.mingla_connector_calls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  key_id      uuid NOT NULL,
  actor_role  text NOT NULL,
  upstream    text NOT NULL,
  tool        text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  duration_ms integer,
  outcome     text NOT NULL DEFAULT 'running',
  http_status integer,
  CONSTRAINT mingla_connector_calls_upstream_check CHECK (upstream ~ '^[a-z][a-z0-9]{1,19}$' OR upstream = 'invalid'),
  CONSTRAINT mingla_connector_calls_tool_check CHECK (tool ~ '^[A-Za-z0-9_.-]{1,64}$' OR tool IN ('tools/list', 'invalid')),
  CONSTRAINT mingla_connector_calls_outcome_check CHECK (outcome ~ '^[a-z_]{1,60}$'),
  CONSTRAINT mingla_connector_calls_status_check CHECK (http_status IS NULL OR http_status BETWEEN 0 AND 999),
  CONSTRAINT mingla_connector_calls_ms_check CHECK (duration_ms IS NULL OR duration_ms >= 0)
);
CREATE INDEX mingla_connector_calls_by_owner ON public.mingla_connector_calls (owner_email, started_at DESC);
CREATE INDEX mingla_connector_calls_by_time ON public.mingla_connector_calls (started_at DESC);

ALTER TABLE public.mingla_connector_oauth_clients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mingla_connector_oauth_codes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mingla_connector_oauth_grants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mingla_connector_oauth_spent_refresh  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mingla_connector_upstreams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mingla_connector_calls                ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mingla_connector_oauth_clients       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mingla_connector_oauth_codes         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mingla_connector_oauth_grants        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mingla_connector_oauth_spent_refresh FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mingla_connector_upstreams           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mingla_connector_calls               FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mingla_connector_oauth_clients       TO service_role;
GRANT ALL ON public.mingla_connector_oauth_codes         TO service_role;
GRANT ALL ON public.mingla_connector_oauth_grants        TO service_role;
GRANT ALL ON public.mingla_connector_oauth_spent_refresh TO service_role;
GRANT ALL ON public.mingla_connector_upstreams           TO service_role;
GRANT ALL ON public.mingla_connector_calls               TO service_role;
COMMENT ON TABLE public.mingla_connector_oauth_clients IS
  'Issue #4294. The apps that may sign in to the Mingla connector, pinned. Changed only by migration.';
COMMENT ON TABLE public.mingla_connector_oauth_codes IS
  'Issue #4294. One-time sign-in codes. Holds a digest, never a code. No client reads or writes.';
COMMENT ON TABLE public.mingla_connector_oauth_grants IS
  'Issue #4294. Approved app sign-ins. Holds a digest of the current refresh token, never a token. No client reads or writes.';
COMMENT ON TABLE public.mingla_connector_oauth_spent_refresh IS
  'Issue #4294. Digests of refresh tokens already used; a second use ends the grant.';
COMMENT ON TABLE public.mingla_connector_upstreams IS
  'Issue #4294. Company tools behind the Mingla connector. No key column: a key lives in Supabase Vault and is never returned to a client.';
COMMENT ON TABLE public.mingla_connector_calls IS
  'Issue #4294. One row per proxied upstream request: person, upstream, tool, time, outcome. Never an argument, a result or a key. Rows older than 90 days are removed daily.';

-- The two Claude client documents (verified 2026-11-07).
INSERT INTO public.mingla_connector_oauth_clients (client_id, kind, label, redirect_uris, loopback) VALUES
  ('https://claude.ai/oauth/mcp-oauth-client-metadata', 'claude_app', 'Claude',
   ARRAY['https://claude.ai/api/mcp/auth_callback'], false),
  ('https://claude.ai/oauth/claude-code-client-metadata', 'claude_code', 'Claude Code', '{}', true);

-- Company tools known today (decisions D-1 to D-3): seeded OFF, owner only,
-- no tools listed and no key. An owner sets the key, the roles and the tools
-- in Mingla Admin. TikTok Ads and OneSignal are not seeded.
INSERT INTO public.mingla_connector_upstreams (slug, label, mcp_url, enabled, allowed_roles, tool_allowlist, notes) VALUES
  ('posthog',   'PostHog',   'https://mcp.posthog.com/mcp',          false, ARRAY['owner'], '{}',
   'Personal API key as the key. Its exec tool can do anything the key can: give the key read-only scopes.'),
  ('appsflyer', 'AppsFlyer', 'https://mcp.appsflyer.com/auth/mcp',   false, ARRAY['owner'], '{}',
   'MCP token from the AppsFlyer Security Center as the key.'),
  ('metaads',   'Meta Ads',  'https://mcp.facebook.com/ads',         false, ARRAY['owner'], '{}',
   'A system-user token with only the scopes needed. Check one read call after setting the key.'),
  ('sentry',    'Sentry',    'https://mcp.sentry.dev/mcp',           false, ARRAY['owner'], '{}',
   'Not yet known to accept a stored key. Check one read call after setting the key.');

-- ---------------------------------------------------------------------------
-- 3. Internal definitions (service_role only).
-- ---------------------------------------------------------------------------

-- The ONE place the connector's lifetimes and limits live (decision D-4:
-- access 1 hour, refresh 30 days rotating, sign in again after 90 days).
CREATE FUNCTION public.mingla_connector_limits() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT $j${
    "resource": "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent",
    "code_minutes": 5,
    "codes_per_person": 10,
    "access_minutes": 60,
    "refresh_days": 30,
    "grant_days": 90,
    "calls_per_minute": 30,
    "calls_per_day": 2000,
    "key_read_seconds": 60,
    "call_log_days": 90
  }$j$::jsonb
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_limits() TO service_role;
COMMENT ON FUNCTION public.mingla_connector_limits() IS
  'Issue #4294. Internal: the one definition of the connector''s token lifetimes and limits.';

-- Is this the exact redirect the app is allowed? Claude: one exact string.
-- Claude Code: http://localhost or http://127.0.0.1, a port 1024-65535, path
-- exactly /callback, nothing else.
CREATE FUNCTION public.mingla_connector_redirect_ok(p_client_id text, p_redirect_uri text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c public.mingla_connector_oauth_clients;
  m text[];
BEGIN
  IF p_client_id IS NULL OR p_redirect_uri IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO c FROM public.mingla_connector_oauth_clients x WHERE x.client_id = p_client_id AND x.enabled;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF NOT c.loopback THEN
    RETURN p_redirect_uri = ANY (c.redirect_uris);
  END IF;
  m := regexp_match(p_redirect_uri, '^http://(localhost|127\.0\.0\.1):([1-9][0-9]{3,4})/callback$');
  RETURN m IS NOT NULL AND m[2]::integer BETWEEN 1024 AND 65535;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_redirect_ok(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_redirect_ok(text, text) TO service_role;

-- The resource a request names, made canonical: absent, or exactly the
-- connector's address (one trailing slash tolerated). NULL means refused.
CREATE FUNCTION public.mingla_connector_resource(p_resource text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_resource IS NULL OR p_resource = '' THEN public.mingla_connector_limits()->>'resource'
    WHEN p_resource = public.mingla_connector_limits()->>'resource'
      OR p_resource = (public.mingla_connector_limits()->>'resource') || '/'
      THEN public.mingla_connector_limits()->>'resource'
    ELSE NULL
  END
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_resource(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_resource(text) TO service_role;

-- An upstream address an owner may save: https, a public DNS name in lower
-- case, port absent or 443, a short plain path, no query, no fragment, no
-- user part, no address literal, nothing internal to Mingla or the platform.
CREATE FUNCTION public.mingla_connector_url_ok(p_url text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  m    text[];
  host text;
BEGIN
  IF p_url IS NULL OR char_length(p_url) > 300 THEN
    RETURN false;
  END IF;
  m := regexp_match(p_url, '^https://([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(:443)?(/[A-Za-z0-9._~/-]{0,200})?$');
  IF m IS NULL THEN
    RETURN false;
  END IF;
  host := m[1];
  -- A host whose last label is a number (decimal, or hex written 0x...) is
  -- read by browsers and fetch as an IPv4 address (0x7f.1 is 127.0.0.1), so
  -- it is an address literal too.
  IF host ~ '^[0-9.]+$'
     OR host ~ '(^|\.)(0x[0-9a-f]*|[0-9]+)$'
     OR host ~ '(^|\.)(localhost|local|internal|localdomain)$'
     OR host ~ '(^|\.)supabase\.(co|in)$'
     OR host ~ '(^|\.)usemingla\.com$'
     OR host ~ '(^|\.)vercel\.app$' THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_url_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_url_ok(text) TO service_role;

-- 32 random bytes as 43 URL-safe characters.
CREATE FUNCTION public.mingla_connector_random43() RETURNS text
LANGUAGE sql VOLATILE SET search_path = ''
AS $$
  SELECT translate(rtrim(translate(encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'),
                                   E'\n', ''), '='), '+/', '-_')
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_random43() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_random43() TO service_role;

-- Who is acting, for the owner-only and member functions below. Refuses a
-- request that came through an agent.
CREATE FUNCTION public.mingla_connector_actor(p_owner_only boolean) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v record;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'forbidden: An agent cannot do this. Open Mingla Admin.' USING ERRCODE = '42501';
  END IF;
  IF p_owner_only AND NOT COALESCE(public.admin_team_role() = 'owner', false) THEN
    RAISE EXCEPTION 'forbidden: Only an owner can manage company tools.' USING ERRCODE = '42501';
  END IF;
  RETURN v.actor_email;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_actor(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_actor(boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The one key maker and the one resolver learn about sign-in keys.
-- ---------------------------------------------------------------------------

-- Same signature and grants. New: p_how = 'oauth', where p_code_hash is the
-- digest of a live grant's current refresh token; the key gets the grant's
-- kind and lasts one hour. The replace step turns off only an active key of
-- the same kind, so a sign-in key never turns off a personal key. 'page' and
-- 'setup_code' are as before (kind personal, no end).
CREATE OR REPLACE FUNCTION public.team_agent_key_issue(p_code_hash text, p_agent text, p_time_zone text, p_how text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v         record;
  s         public.team_agent_setup_codes;
  g         public.mingla_connector_oauth_grants;
  v_holder  text;
  v_kind    text := 'personal';
  v_expires timestamptz;
  v_key     text;
  v_id      uuid;
  v_prefix  text;
  v_n       integer;
  v_now     timestamptz := clock_timestamp();
BEGIN
  IF p_agent IS NULL OR p_agent NOT IN ('claude', 'codex') THEN
    RAISE EXCEPTION 'invalid_agent: Choose Claude or Codex.' USING ERRCODE = '22023';
  END IF;
  IF p_how = 'page' AND p_code_hash IS NULL THEN
    SELECT * INTO v FROM public.crm_ctx();
    IF v.via IS NOT NULL THEN
      RAISE EXCEPTION 'forbidden: An agent cannot manage keys. Open My agent in Mingla Admin.' USING ERRCODE = '42501';
    END IF;
    v_holder := v.actor_email;
  ELSIF p_how = 'setup_code' AND p_code_hash IS NOT NULL THEN
    SELECT * INTO s FROM public.team_agent_setup_codes c
     WHERE c.code_hash = p_code_hash AND c.consumed_at IS NOT NULL AND c.consumed_key_id IS NULL
       AND c.voided_at IS NULL AND c.agent = p_agent;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'forbidden: That setup code cannot make a key.' USING ERRCODE = '42501';
    END IF;
    v_holder := s.owner_email;
  ELSIF p_how = 'oauth' AND p_code_hash IS NOT NULL AND p_agent = 'claude' THEN
    SELECT * INTO g FROM public.mingla_connector_oauth_grants x
     WHERE x.refresh_hash = p_code_hash AND x.revoked_at IS NULL AND x.expires_at > v_now;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'forbidden: That sign-in cannot make a key.' USING ERRCODE = '42501';
    END IF;
    v_holder := g.owner_email;
    v_kind := g.kind;
    v_expires := LEAST(g.expires_at,
                       v_now + make_interval(mins => (public.mingla_connector_limits()->>'access_minutes')::integer));
  ELSE
    RAISE EXCEPTION 'forbidden: A key is made from My agent or from a setup code.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_key:' || v_holder, 0));

  UPDATE public.team_agent_keys
     SET revoked_at = v_now, revoked_by = v_holder, revoke_reason = 'replaced'
   WHERE owner_email = v_holder AND agent = p_agent AND kind = v_kind AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  v_key := 'mgla_' || CASE p_agent WHEN 'claude' THEN 'c' ELSE 'x' END || '_'
           || translate(rtrim(translate(encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'),
                                        E'\n', ''), '='), '+/', '-_');
  v_prefix := left(v_key, 14);

  INSERT INTO public.team_agent_keys (owner_email, agent, key_prefix, key_hash, created_at, time_zone, kind, expires_at)
  VALUES (v_holder, p_agent, v_prefix, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), v_now, p_time_zone,
          v_kind, v_expires)
  RETURNING id INTO v_id;

  PERFORM public.crm_audit(v_holder, 'agent.key_create', 'team_agent_key', v_id::text,
    jsonb_build_object('agent', p_agent, 'key_prefix', v_prefix, 'replaced', v_n > 0, 'how', p_how, 'kind', v_kind));

  RETURN jsonb_build_object('key', v_key, 'key_id', v_id, 'agent', p_agent, 'key_prefix', v_prefix,
                            'created_at', v_now, 'replaced', v_n > 0, 'time_zone', p_time_zone,
                            'kind', v_kind, 'expires_at', v_expires);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.team_agent_key_issue(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_agent_key_issue(text, text, text, text) TO service_role;
COMMENT ON FUNCTION public.team_agent_key_issue(text, text, text, text) IS
  'Issue #3802, #4294. Internal: the one place a key is made: from the page, from a setup code, or from an app sign-in (kind claude_app or claude_code, one hour). A key replaces only an active key of the same kind. Not client-executable.';

-- Same signature and answer. New: a sign-in key past its end is refused
-- with no write, and is refused unless a live grant names it as its current
-- key (Disconnect, a refresh, the end of the grant all end it at once).
CREATE OR REPLACE FUNCTION public.team_agent_resolve(p_key_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c_invalid constant jsonb := '{"auth":"invalid"}'::jsonb;
  k        public.team_agent_keys;
  v_who    jsonb;
  v_reason text;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN c_invalid;
  END IF;
  -- By the whole digest only, never by a part of it.
  SELECT * INTO k FROM public.team_agent_keys t WHERE t.key_hash = p_key_hash;
  IF NOT FOUND OR k.revoked_at IS NOT NULL THEN
    RETURN c_invalid;
  END IF;
  -- A sign-in key: within its hour, and still the current key of a live grant.
  IF k.kind <> 'personal' THEN
    IF k.expires_at IS NULL OR k.expires_at <= clock_timestamp() THEN
      RETURN c_invalid;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.mingla_connector_oauth_grants g
                    WHERE g.current_key_id = k.id AND g.owner_email = k.owner_email
                      AND g.revoked_at IS NULL AND g.expires_at > clock_timestamp()) THEN
      RETURN c_invalid;
    END IF;
  END IF;

  v_who := public.team_agent_person(p_key_hash);
  IF v_who->>'ok' IS DISTINCT FROM 'true' THEN
    v_reason := COALESCE(v_who->>'reason', 'access_removed');
  ELSIF COALESCE(k.last_used_at, k.created_at)
          < now() - make_interval(days => (public.team_agent_limits()->>'idle_days')::integer) THEN
    v_reason := 'idle';
  END IF;

  IF v_reason IS NOT NULL THEN
    -- One order everywhere: the person's lock, then their keys and codes.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_key:' || k.owner_email, 0));
    UPDATE public.team_agent_keys
       SET revoked_at = now(), revoked_by = 'system', revoke_reason = v_reason
     WHERE id = k.id AND revoked_at IS NULL;
    -- A person who can no longer act has no setup code waiting either.
    IF v_reason <> 'idle' THEN
      UPDATE public.team_agent_setup_codes
         SET voided_at = now()
       WHERE owner_email = k.owner_email AND consumed_at IS NULL AND voided_at IS NULL;
    END IF;
    -- Nobody is acting for the rest of this transaction.
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
    PERFORM set_config('request.jwt.claim.email', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN c_invalid;
  END IF;

  -- When an app connection was last used, for My agent (at most once a minute).
  IF k.kind <> 'personal' THEN
    UPDATE public.mingla_connector_oauth_grants
       SET last_used_at = now()
     WHERE current_key_id = k.id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');
  END IF;

  RETURN jsonb_build_object('auth', 'ok', 'key_id', k.id, 'owner_email', k.owner_email,
                            'uid', (v_who->>'uid')::uuid, 'agent', k.agent, 'role', v_who->>'role',
                            'time_zone', k.time_zone);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.team_agent_resolve(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_agent_resolve(text) TO service_role;

-- The caller's keys: personal keys only (an app sign-in is listed under
-- "Claude app" by mingla_connector_connections_mine). Otherwise unchanged.
CREATE OR REPLACE FUNCTION public.team_agent_keys_mine() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v       record;
  v_day   timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_rows  jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'forbidden: An agent cannot manage keys. Open My agent in Mingla Admin.' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key_id', x.id, 'agent', x.agent, 'key_prefix', x.key_prefix, 'created_at', x.created_at,
           'last_used_at', x.last_used_at, 'last_used_client', x.last_used_client,
           'revoked_at', x.revoked_at, 'revoke_reason', x.revoke_reason, 'time_zone', x.time_zone,
           'revoked_by_me', x.revoked_by IS NOT DISTINCT FROM v.actor_email,
           'calls_today', (SELECT count(*) FROM public.team_agent_calls c
                            WHERE c.key_id = x.id AND c.started_at >= v_day
                              AND c.tool NOT LIKE 'mcp:%' AND c.outcome <> 'limited'))
         ORDER BY (x.revoked_at IS NULL) DESC, x.created_at DESC, x.id), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT t.* FROM public.team_agent_keys t
         WHERE t.owner_email = v.actor_email AND t.kind = 'personal' AND t.revoked_at IS NULL
        UNION ALL
        (SELECT t.* FROM public.team_agent_keys t
          WHERE t.owner_email = v.actor_email AND t.kind = 'personal' AND t.revoked_at IS NOT NULL
          ORDER BY t.revoked_at DESC, t.id
          LIMIT 5)) x;
  RETURN jsonb_build_object('keys', v_rows, 'idle_days', public.team_agent_limits()->'idle_days',
    'setup', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'agent', c.agent, 'created_at', c.created_at, 'expires_at', c.expires_at,
               'state', CASE WHEN c.consumed_at IS NOT NULL AND c.consumed_key_id IS NOT NULL THEN 'used'
                             WHEN c.consumed_at IS NOT NULL OR c.voided_at IS NOT NULL THEN 'ended'
                             WHEN c.expires_at <= clock_timestamp() THEN 'expired'
                             ELSE 'waiting' END,
               'used_at', CASE WHEN c.consumed_key_id IS NOT NULL THEN c.consumed_at END,
               'key_id', c.consumed_key_id)
                       ORDER BY c.created_at DESC, c.id)
      FROM public.team_agent_setup_codes c
      WHERE c.owner_email = v.actor_email
        AND c.created_at > clock_timestamp() - interval '30 minutes'), '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.team_agent_keys_mine() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_agent_keys_mine() TO authenticated, service_role;

-- Owner only: one row per person per agent. Personal keys only.
CREATE OR REPLACE FUNCTION public.team_agent_keys_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v      record;
  v_day  timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_rows jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'forbidden: An agent cannot manage keys. Open My agent in Mingla Admin.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(public.admin_team_role() = 'owner', false) THEN
    RAISE EXCEPTION 'forbidden: Only the owner can see who has an agent connected.' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'email', d.email, 'display_name', public.crm_display_name(d.email), 'role', d.role,
           'status', d.status, 'agent', a.agent,
           'connected', k.id IS NOT NULL,
           'key_id', k.id, 'key_prefix', k.key_prefix, 'created_at', k.created_at,
           'last_used_at', k.last_used_at, 'last_used_client', k.last_used_client,
           'calls_today', (SELECT count(*) FROM public.team_agent_calls c
                            WHERE c.key_id = k.id AND c.started_at >= v_day
                              AND c.tool NOT LIKE 'mcp:%' AND c.outcome <> 'limited'))
         ORDER BY (d.role = 'owner') DESC, d.email, a.agent), '[]'::jsonb)
    INTO v_rows
  FROM public.admin_team_directory() d
  CROSS JOIN unnest(ARRAY['claude', 'codex']) AS a(agent)
  LEFT JOIN public.team_agent_keys k
         ON k.owner_email = d.email AND k.agent = a.agent AND k.kind = 'personal' AND k.revoked_at IS NULL;
  RETURN jsonb_build_object('people', v_rows);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.team_agent_keys_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_agent_keys_overview() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Sign-in.
-- ---------------------------------------------------------------------------

-- Signed-in team member approves an app. Checks the request again (this is
-- the authority; the edge check is only the first look) and makes a code
-- that works once, within five minutes, for this app, this redirect and
-- this PKCE challenge. The code is in this answer once and is never stored.
CREATE FUNCTION public.mingla_connector_oauth_approve(p_client_id text, p_redirect_uri text, p_code_challenge text,
                                                      p_resource text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c_bad constant text := 'invalid_request: This sign-in link is not valid. Start again from Claude.';
  v_lim      jsonb := public.mingla_connector_limits();
  v_email    text;
  v_role     text;
  v_resource text;
  v_code     text;
  v_now      timestamptz := clock_timestamp();
  v_ends     timestamptz;
BEGIN
  v_email := public.mingla_connector_actor(false);
  v_role := public.admin_team_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden: Your account cannot connect Claude. Ask an owner.' USING ERRCODE = '42501';
  END IF;
  IF v_role <> 'owner' AND public.admin_team_invite_address_verdict(v_email) = 'conflict' THEN
    RAISE EXCEPTION 'forbidden: Your account cannot connect Claude. Ask an owner.' USING ERRCODE = '42501';
  END IF;
  -- The one-account rule of team_agent_person, up front: exactly one
  -- confirmed account with this address, and it is the one signed in, not
  -- deleted or banned. The exchange checks it again through the new key.
  IF NOT EXISTS (
       SELECT 1 FROM auth.users u
        WHERE u.id = auth.uid()
          AND lower(btrim(u.email)) = v_email AND u.email_confirmed_at IS NOT NULL
          AND (to_jsonb(u) ->> 'deleted_at') IS NULL
          AND NOT COALESCE((to_jsonb(u) ->> 'banned_until')::timestamptz > now(), false))
     OR (SELECT count(*) FROM auth.users u
          WHERE lower(btrim(u.email)) = v_email AND u.email_confirmed_at IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'forbidden: Your account cannot connect Claude. Ask an owner.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.mingla_connector_redirect_ok(p_client_id, p_redirect_uri) THEN
    RAISE EXCEPTION '%', c_bad USING ERRCODE = '22023';
  END IF;
  IF p_code_challenge IS NULL OR p_code_challenge !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION '%', c_bad USING ERRCODE = '22023';
  END IF;
  v_resource := public.mingla_connector_resource(p_resource);
  IF v_resource IS NULL THEN
    RAISE EXCEPTION '%', c_bad USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_key:' || v_email, 0));
  -- At most this many unused codes per person: older ones end.
  UPDATE public.mingla_connector_oauth_codes c
     SET voided_at = v_now
   WHERE c.id IN (SELECT x.id FROM public.mingla_connector_oauth_codes x
                   WHERE x.owner_email = v_email AND x.consumed_at IS NULL AND x.voided_at IS NULL
                     AND x.expires_at > v_now
                   ORDER BY x.created_at DESC, x.id
                   OFFSET (v_lim->>'codes_per_person')::integer - 1);

  v_code := 'mglo_' || public.mingla_connector_random43();
  v_ends := v_now + make_interval(mins => (v_lim->>'code_minutes')::integer);
  INSERT INTO public.mingla_connector_oauth_codes (code_hash, owner_email, client_id, redirect_uri, code_challenge,
                                                   resource, created_at, expires_at)
  VALUES (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_email, p_client_id, p_redirect_uri, p_code_challenge,
          v_resource, v_now, v_ends);

  PERFORM public.crm_audit(v_email, 'connector.approve', 'mingla_connector_client', p_client_id,
    jsonb_build_object('client_id', p_client_id));
  RETURN jsonb_build_object('code', v_code, 'expires_at', v_ends);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_oauth_approve(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_oauth_approve(text, text, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_oauth_approve(text, text, text, text) IS
  'Issue #4294. A signed-in team member approves a Claude app. Returns a one-time code once; only its digest is kept. Refused when reached through an agent.';

-- Issue a sign-in key for a grant whose refresh digest is p_refresh_hash and
-- check the person may act. Internal step of exchange and refresh.
CREATE FUNCTION public.mingla_connector_oauth_mint(p_grant_id uuid, p_refresh_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c_invalid constant jsonb := '{"error":"invalid_grant"}'::jsonb;
  v_made jsonb;
  v_res  jsonb;
  v_ok   boolean;
BEGIN
  v_made := public.team_agent_key_issue(p_refresh_hash, 'claude', NULL, 'oauth');
  UPDATE public.mingla_connector_oauth_grants
     SET current_key_id = (v_made->>'key_id')::uuid
   WHERE id = p_grant_id;
  v_res := public.team_agent_resolve(encode(sha256(convert_to(v_made->>'key', 'UTF8')), 'hex'));
  v_ok := v_res->>'auth' = 'ok' AND COALESCE(public.admin_team_can('crm'), false);
  -- Nobody is acting for the rest of this transaction.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.email', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF NOT v_ok THEN
    UPDATE public.mingla_connector_oauth_grants
       SET revoked_at = clock_timestamp(), revoke_reason = 'access_removed', revoked_by = 'system'
     WHERE id = p_grant_id AND revoked_at IS NULL;
    RETURN c_invalid;
  END IF;
  RETURN jsonb_build_object('access_token', v_made->>'key', 'key_id', v_made->>'key_id',
    'expires_in', GREATEST(1, floor(extract(epoch FROM ((v_made->>'expires_at')::timestamptz - clock_timestamp())))::integer));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_oauth_mint(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_oauth_mint(uuid, text) TO service_role;

-- Code + verifier for tokens. Internal: the edge hands over the code's
-- digest and the challenge it computed from the verifier. Every refusal is
-- one answer. A code is used up by its first use, whatever happens next;
-- a second use of a used code ends the grant it made.
CREATE FUNCTION public.mingla_connector_oauth_exchange(p_code_hash text, p_client_id text, p_redirect_uri text,
                                                       p_challenge text, p_resource text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c_invalid constant jsonb := '{"error":"invalid_grant"}'::jsonb;
  v_lim     jsonb := public.mingla_connector_limits();
  c         public.mingla_connector_oauth_codes;
  v_holder  text;
  v_kind    text;
  v_refresh text;
  v_hash    text;
  v_grant   uuid;
  v_now     timestamptz := clock_timestamp();
  v_out     jsonb;
BEGIN
  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN c_invalid;
  END IF;
  SELECT x.owner_email INTO v_holder FROM public.mingla_connector_oauth_codes x WHERE x.code_hash = p_code_hash;
  IF NOT FOUND THEN
    RETURN c_invalid;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_key:' || v_holder, 0));
  UPDATE public.mingla_connector_oauth_codes
     SET consumed_at = v_now
   WHERE code_hash = p_code_hash AND consumed_at IS NULL AND voided_at IS NULL AND expires_at > v_now
  RETURNING * INTO c;
  IF NOT FOUND THEN
    -- A code used twice: the grant it made ends.
    UPDATE public.mingla_connector_oauth_grants g
       SET revoked_at = v_now, revoke_reason = 'reuse', revoked_by = 'system'
      FROM public.mingla_connector_oauth_codes x
     WHERE x.code_hash = p_code_hash AND x.consumed_at IS NOT NULL AND g.id = x.grant_id AND g.revoked_at IS NULL;
    RETURN c_invalid;
  END IF;

  IF p_client_id IS DISTINCT FROM c.client_id OR p_redirect_uri IS DISTINCT FROM c.redirect_uri
     OR p_challenge IS NULL OR p_challenge !~ '^[A-Za-z0-9_-]{43}$' OR p_challenge IS DISTINCT FROM c.code_challenge
     OR (p_resource IS NOT NULL AND p_resource <> '' AND public.mingla_connector_resource(p_resource) IS DISTINCT FROM c.resource)
     OR NOT public.mingla_connector_redirect_ok(c.client_id, c.redirect_uri) THEN
    RETURN c_invalid;
  END IF;

  SELECT k.kind INTO v_kind FROM public.mingla_connector_oauth_clients k WHERE k.client_id = c.client_id;
  -- One connection per app kind per person: an older one ends.
  UPDATE public.mingla_connector_oauth_grants
     SET revoked_at = v_now, revoke_reason = 'replaced', revoked_by = v_holder
   WHERE owner_email = v_holder AND kind = v_kind AND revoked_at IS NULL;

  v_refresh := 'mglr_' || public.mingla_connector_random43();
  v_hash := encode(sha256(convert_to(v_refresh, 'UTF8')), 'hex');
  INSERT INTO public.mingla_connector_oauth_grants (owner_email, client_id, kind, refresh_hash, refresh_expires_at,
                                                    created_at, expires_at)
  VALUES (v_holder, c.client_id, v_kind, v_hash,
          LEAST(v_now + make_interval(days => (v_lim->>'refresh_days')::integer),
                v_now + make_interval(days => (v_lim->>'grant_days')::integer)),
          v_now, v_now + make_interval(days => (v_lim->>'grant_days')::integer))
  RETURNING id INTO v_grant;
  UPDATE public.mingla_connector_oauth_codes SET grant_id = v_grant WHERE id = c.id;

  v_out := public.mingla_connector_oauth_mint(v_grant, v_hash);
  IF v_out ? 'error' THEN
    RETURN c_invalid;
  END IF;
  RETURN jsonb_build_object('access_token', v_out->>'access_token', 'refresh_token', v_refresh,
                            'expires_in', (v_out->>'expires_in')::integer, 'kind', v_kind);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_oauth_exchange(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_oauth_exchange(text, text, text, text, text) TO service_role;
COMMENT ON FUNCTION public.mingla_connector_oauth_exchange(text, text, text, text, text) IS
  'Issue #4294. Internal: exchange a one-time code (by digest) and its PKCE challenge for a one-hour key and a refresh token. Every refusal is the same answer. Not client-executable.';

-- Refresh token for new tokens. The refresh token rotates: the old one is
-- remembered as spent, and a second use of it ends the grant.
CREATE FUNCTION public.mingla_connector_oauth_refresh(p_refresh_hash text, p_client_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c_invalid constant jsonb := '{"error":"invalid_grant"}'::jsonb;
  v_lim     jsonb := public.mingla_connector_limits();
  g         public.mingla_connector_oauth_grants;
  v_holder  text;
  v_refresh text;
  v_hash    text;
  v_now     timestamptz := clock_timestamp();
  v_out     jsonb;
BEGIN
  IF p_refresh_hash IS NULL OR p_refresh_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN c_invalid;
  END IF;
  SELECT x.owner_email INTO v_holder FROM public.mingla_connector_oauth_grants x WHERE x.refresh_hash = p_refresh_hash;
  IF NOT FOUND THEN
    SELECT x.owner_email INTO v_holder
      FROM public.mingla_connector_oauth_spent_refresh s
      JOIN public.mingla_connector_oauth_grants x ON x.id = s.grant_id
     WHERE s.hash = p_refresh_hash;
  END IF;
  IF v_holder IS NULL THEN
    RETURN c_invalid;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_key:' || v_holder, 0));

  SELECT * INTO g FROM public.mingla_connector_oauth_grants x WHERE x.refresh_hash = p_refresh_hash FOR UPDATE;
  IF NOT FOUND THEN
    -- A refresh token used a second time: the grant ends.
    UPDATE public.mingla_connector_oauth_grants x
       SET revoked_at = v_now, revoke_reason = 'reuse', revoked_by = 'system'
      FROM public.mingla_connector_oauth_spent_refresh s
     WHERE s.hash = p_refresh_hash AND x.id = s.grant_id AND x.revoked_at IS NULL;
    RETURN c_invalid;
  END IF;
  IF g.revoked_at IS NOT NULL OR g.client_id IS DISTINCT FROM p_client_id THEN
    RETURN c_invalid;
  END IF;
  IF g.expires_at <= v_now OR g.refresh_expires_at <= v_now THEN
    UPDATE public.mingla_connector_oauth_grants
       SET revoked_at = v_now, revoke_reason = 'expired', revoked_by = 'system'
     WHERE id = g.id;
    RETURN c_invalid;
  END IF;

  v_refresh := 'mglr_' || public.mingla_connector_random43();
  v_hash := encode(sha256(convert_to(v_refresh, 'UTF8')), 'hex');
  INSERT INTO public.mingla_connector_oauth_spent_refresh (hash, grant_id, spent_at) VALUES (g.refresh_hash, g.id, v_now);
  UPDATE public.mingla_connector_oauth_grants
     SET refresh_hash = v_hash,
         refresh_expires_at = LEAST(v_now + make_interval(days => (v_lim->>'refresh_days')::integer), g.expires_at),
         last_refreshed_at = v_now
   WHERE id = g.id;

  v_out := public.mingla_connector_oauth_mint(g.id, v_hash);
  IF v_out ? 'error' THEN
    RETURN c_invalid;
  END IF;
  RETURN jsonb_build_object('access_token', v_out->>'access_token', 'refresh_token', v_refresh,
                            'expires_in', (v_out->>'expires_in')::integer, 'kind', g.kind);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_oauth_refresh(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_oauth_refresh(text, text) TO service_role;
COMMENT ON FUNCTION public.mingla_connector_oauth_refresh(text, text) IS
  'Issue #4294. Internal: rotate a refresh token (by digest) into a new one-hour key and a new refresh token. A second use of a spent refresh token ends the grant. Not client-executable.';

-- The caller's own app connections. Never a token or a digest.
CREATE FUNCTION public.mingla_connector_connections_mine() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email text;
BEGIN
  v_email := public.mingla_connector_actor(false);
  RETURN jsonb_build_object('connections', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'grant_id', g.id, 'kind', g.kind, 'label', c.label, 'created_at', g.created_at,
             'last_used_at', g.last_used_at)
           ORDER BY g.created_at DESC, g.id)
      FROM public.mingla_connector_oauth_grants g
      JOIN public.mingla_connector_oauth_clients c ON c.client_id = g.client_id
     WHERE g.owner_email = v_email AND g.revoked_at IS NULL AND g.expires_at > clock_timestamp()), '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_connections_mine() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_connections_mine() TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_connections_mine() IS
  'Issue #4294. The caller''s live Claude app connections: app, connected on, last used. Never a token.';

-- End an app connection: your own, or anyone's for an owner. Its key stops
-- working at the next request.
CREATE FUNCTION public.mingla_connector_disconnect(p_grant_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email  text;
  v_owner  boolean;
  g        public.mingla_connector_oauth_grants;
  v_reason text;
BEGIN
  v_email := public.mingla_connector_actor(false);
  v_owner := COALESCE(public.admin_team_role() = 'owner', false);
  SELECT * INTO g FROM public.mingla_connector_oauth_grants x WHERE x.id = p_grant_id;
  IF NOT FOUND OR (g.owner_email <> v_email AND NOT v_owner) THEN
    RAISE EXCEPTION 'not_found: That connection is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_key:' || g.owner_email, 0));
  IF g.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('grant_id', g.id, 'changed', false);
  END IF;
  v_reason := CASE WHEN g.owner_email = v_email THEN 'self' ELSE 'owner' END;
  UPDATE public.mingla_connector_oauth_grants
     SET revoked_at = clock_timestamp(), revoke_reason = v_reason, revoked_by = v_email
   WHERE id = g.id AND revoked_at IS NULL;
  PERFORM public.crm_audit(v_email, 'connector.disconnect', 'mingla_connector_grant', g.id::text,
    jsonb_build_object('kind', g.kind, 'grant_owner', g.owner_email, 'reason', v_reason));
  RETURN jsonb_build_object('grant_id', g.id, 'changed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_disconnect(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_disconnect(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_disconnect(uuid) IS
  'Issue #4294. End a Claude app connection: the caller''s own, or anyone''s for an owner. Audited.';

-- ---------------------------------------------------------------------------
-- 6. Company tools (owner only).
-- ---------------------------------------------------------------------------

-- One row as Admin sees it. key_set is a yes or no: never a key, never the
-- Vault id.
CREATE FUNCTION public.mingla_connector_registry_row(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('slug', u.slug, 'label', u.label, 'mcp_url', u.mcp_url, 'enabled', u.enabled,
           'allowed_roles', to_jsonb(u.allowed_roles), 'tool_allowlist', to_jsonb(u.tool_allowlist),
           'notes', u.notes, 'key_set', u.vault_secret_id IS NOT NULL,
           'key_updated_at', u.key_updated_at,
           'key_updated_by', CASE WHEN u.key_updated_by IS NULL THEN NULL ELSE public.crm_display_name(u.key_updated_by) END,
           'updated_at', u.updated_at,
           'updated_by', CASE WHEN u.updated_by IS NULL THEN NULL ELSE public.crm_display_name(u.updated_by) END)
    FROM public.mingla_connector_upstreams u WHERE u.slug = p_slug
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_registry_row(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_registry_row(text) TO service_role;

CREATE FUNCTION public.mingla_connector_registry_list() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.mingla_connector_actor(true);
  RETURN jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(public.mingla_connector_registry_row(u.slug) ORDER BY u.label, u.slug)
      FROM public.mingla_connector_upstreams u), '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_registry_list() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_registry_list() TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_registry_list() IS
  'Issue #4294. Owner only: the company tools, with whether a key is set. Never a key or any part of one.';

-- Add a company tool or change one. Fields: slug, label, mcp_url, enabled,
-- allowed_roles, tool_allowlist, notes. Any other field is refused (a key
-- is set only with mingla_connector_set_key). Audited.
CREATE FUNCTION public.mingla_connector_registry_save(p_row jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c_fields constant text[] := ARRAY['slug', 'label', 'mcp_url', 'enabled', 'allowed_roles', 'tool_allowlist', 'notes'];
  v_email   text;
  r         jsonb := p_row;
  old       public.mingla_connector_upstreams;
  v_slug    text;
  v_label   text;
  v_url     text;
  v_enabled boolean;
  v_roles   text[];
  v_tools   text[];
  v_notes   text;
  v_changed text[] := '{}';
  v_new     boolean;
  v_bad     text;
BEGIN
  v_email := public.mingla_connector_actor(true);
  IF r IS NULL OR jsonb_typeof(r) <> 'object' THEN
    RAISE EXCEPTION 'invalid_row: Send the company tool as one object.' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad FROM jsonb_object_keys(r) k WHERE NOT (k = ANY (c_fields));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_field: A company tool has only these fields: slug, label, address, on or off, roles, tools and notes. Set a key with Set key.'
      USING ERRCODE = '22023';
  END IF;
  v_slug := r->>'slug';
  IF v_slug IS NULL OR v_slug !~ '^[a-z][a-z0-9]{1,19}$' THEN
    RAISE EXCEPTION 'invalid_slug: A short name is 2 to 20 lower-case letters and digits, starting with a letter.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO old FROM public.mingla_connector_upstreams u WHERE u.slug = v_slug FOR UPDATE;
  v_new := NOT FOUND;

  v_label := CASE WHEN r ? 'label' THEN btrim(r->>'label') ELSE old.label END;
  IF v_label IS NULL OR char_length(v_label) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'invalid_label: A name is 1 to 60 characters.' USING ERRCODE = '22023';
  END IF;
  v_url := CASE WHEN r ? 'mcp_url' THEN btrim(r->>'mcp_url') ELSE old.mcp_url END;
  IF NOT public.mingla_connector_url_ok(v_url) THEN
    RAISE EXCEPTION 'invalid_url: The address must be a public https address with no query, user name or port other than 443.' USING ERRCODE = '22023';
  END IF;
  IF r ? 'enabled' AND jsonb_typeof(r->'enabled') <> 'boolean' THEN
    RAISE EXCEPTION 'invalid_enabled: On or off is true or false.' USING ERRCODE = '22023';
  END IF;
  v_enabled := CASE WHEN r ? 'enabled' THEN (r->>'enabled')::boolean ELSE COALESCE(old.enabled, false) END;
  IF r ? 'allowed_roles' THEN
    IF jsonb_typeof(r->'allowed_roles') <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'allowed_roles') e
                   WHERE jsonb_typeof(e) <> 'string' OR NOT (e #>> '{}' = ANY (ARRAY['owner', 'admin', 'partner', 'growth']))) THEN
      RAISE EXCEPTION 'invalid_roles: Roles are owner, admin, partner and growth.' USING ERRCODE = '22023';
    END IF;
    v_roles := ARRAY(SELECT DISTINCT e FROM jsonb_array_elements_text(r->'allowed_roles') e ORDER BY e);
  ELSE
    v_roles := COALESCE(old.allowed_roles, '{}');
  END IF;
  IF r ? 'tool_allowlist' THEN
    IF jsonb_typeof(r->'tool_allowlist') <> 'array' OR jsonb_array_length(r->'tool_allowlist') > 200
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'tool_allowlist') e
                   WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[A-Za-z0-9_.-]{1,64}$') THEN
      RAISE EXCEPTION 'invalid_tools: Each tool name is 1 to 64 letters, digits, dots, dashes or underscores, at most 200 tools.' USING ERRCODE = '22023';
    END IF;
    v_tools := ARRAY(SELECT DISTINCT e FROM jsonb_array_elements_text(r->'tool_allowlist') e ORDER BY e);
  ELSE
    v_tools := COALESCE(old.tool_allowlist, '{}');
  END IF;
  v_notes := CASE WHEN r ? 'notes' THEN NULLIF(btrim(r->>'notes'), '') ELSE old.notes END;
  IF v_notes IS NOT NULL AND char_length(v_notes) > 500 THEN
    RAISE EXCEPTION 'invalid_notes: Notes are at most 500 characters.' USING ERRCODE = '22023';
  END IF;

  -- A new address for a tool that has a key: it is turned off, so an owner
  -- turns it on again on purpose.
  IF NOT v_new AND old.mcp_url IS DISTINCT FROM v_url AND old.vault_secret_id IS NOT NULL THEN
    v_enabled := false;
  END IF;
  IF v_enabled AND (v_new OR old.vault_secret_id IS NULL) THEN
    RAISE EXCEPTION 'no_key: Set a key before turning this tool on.' USING ERRCODE = '22023';
  END IF;

  IF v_new THEN
    INSERT INTO public.mingla_connector_upstreams (slug, label, mcp_url, enabled, allowed_roles, tool_allowlist, notes,
                                                   updated_by)
    VALUES (v_slug, v_label, v_url, v_enabled, v_roles, v_tools, v_notes, v_email);
    v_changed := ARRAY['created'];
  ELSE
    IF old.label IS DISTINCT FROM v_label THEN v_changed := array_append(v_changed, 'label'); END IF;
    IF old.mcp_url IS DISTINCT FROM v_url THEN v_changed := array_append(v_changed, 'mcp_url'); END IF;
    IF old.enabled IS DISTINCT FROM v_enabled THEN v_changed := array_append(v_changed, 'enabled'); END IF;
    IF old.allowed_roles IS DISTINCT FROM v_roles THEN v_changed := array_append(v_changed, 'allowed_roles'); END IF;
    IF old.tool_allowlist IS DISTINCT FROM v_tools THEN v_changed := array_append(v_changed, 'tool_allowlist'); END IF;
    IF old.notes IS DISTINCT FROM v_notes THEN v_changed := array_append(v_changed, 'notes'); END IF;
    UPDATE public.mingla_connector_upstreams
       SET label = v_label, mcp_url = v_url, enabled = v_enabled, allowed_roles = v_roles,
           tool_allowlist = v_tools, notes = v_notes, updated_at = clock_timestamp(), updated_by = v_email
     WHERE slug = v_slug;
  END IF;

  PERFORM public.crm_audit(v_email, 'connector.registry_save', 'mingla_connector_upstream', v_slug,
    jsonb_build_object('changed', to_jsonb(v_changed),
                       'old_host', CASE WHEN v_new THEN NULL ELSE substring(old.mcp_url FROM '^https://([^/:]+)') END,
                       'new_host', substring(v_url FROM '^https://([^/:]+)')));
  RETURN public.mingla_connector_registry_row(v_slug);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_registry_save(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_registry_save(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_registry_save(jsonb) IS
  'Issue #4294. Owner only: add or change a company tool. Refuses any key or Vault field. Audited with old and new host.';

-- Set or replace a company tool's key. The key goes into Supabase Vault and
-- is never returned, logged or repeated, not even in a refusal.
CREATE FUNCTION public.mingla_connector_set_key(p_slug text, p_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email text;
  u       public.mingla_connector_upstreams;
  v_id    uuid;
  v_now   timestamptz := clock_timestamp();
BEGIN
  v_email := public.mingla_connector_actor(true);
  IF p_key IS NULL OR char_length(p_key) < 8 OR char_length(p_key) > 4096 OR p_key ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_key: That key cannot be used. Paste the whole key, between 8 and 4096 characters, on one line.'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO u FROM public.mingla_connector_upstreams x WHERE x.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That company tool is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  IF u.vault_secret_id IS NOT NULL AND EXISTS (SELECT 1 FROM vault.secrets s WHERE s.id = u.vault_secret_id) THEN
    PERFORM vault.update_secret(u.vault_secret_id, p_key);
    v_id := u.vault_secret_id;
  ELSE
    v_id := vault.create_secret(p_key, 'mingla_connector:' || u.slug || ':' || gen_random_uuid()::text,
                                'issue 4294 upstream key');
  END IF;
  UPDATE public.mingla_connector_upstreams
     SET vault_secret_id = v_id, key_updated_at = v_now, key_updated_by = v_email,
         updated_at = v_now, updated_by = v_email
   WHERE slug = u.slug;
  PERFORM public.crm_audit(v_email, 'connector.key_set', 'mingla_connector_upstream', u.slug,
    jsonb_build_object('slug', u.slug, 'action', 'key_set'));
  RETURN jsonb_build_object('key_set', true, 'key_updated_at', v_now);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_set_key(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_set_key(text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_set_key(text, text) IS
  'Issue #4294. Owner only: set or replace a company tool''s key, kept in Supabase Vault. Returns only that a key is set and when. Never returns, logs or repeats the key.';

-- Remove a company tool's key: the Vault secret is deleted and the tool is
-- turned off.
CREATE FUNCTION public.mingla_connector_clear_key(p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email text;
  u       public.mingla_connector_upstreams;
  v_now   timestamptz := clock_timestamp();
BEGIN
  v_email := public.mingla_connector_actor(true);
  SELECT * INTO u FROM public.mingla_connector_upstreams x WHERE x.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That company tool is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  IF u.vault_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets s WHERE s.id = u.vault_secret_id;
  END IF;
  UPDATE public.mingla_connector_upstreams
     SET vault_secret_id = NULL, enabled = false, key_updated_at = v_now, key_updated_by = v_email,
         updated_at = v_now, updated_by = v_email
   WHERE slug = u.slug;
  PERFORM public.crm_audit(v_email, 'connector.key_clear', 'mingla_connector_upstream', u.slug,
    jsonb_build_object('slug', u.slug, 'action', 'key_clear'));
  RETURN jsonb_build_object('key_set', false, 'key_updated_at', v_now);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_clear_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_clear_key(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_clear_key(text) IS
  'Issue #4294. Owner only: delete a company tool''s key from Supabase Vault and turn the tool off.';

-- Remove a company tool. Its key goes with it.
CREATE FUNCTION public.mingla_connector_registry_delete(p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email text;
BEGIN
  v_email := public.mingla_connector_actor(true);
  IF NOT EXISTS (SELECT 1 FROM public.mingla_connector_upstreams u WHERE u.slug = p_slug) THEN
    RAISE EXCEPTION 'not_found: That company tool is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.mingla_connector_clear_key(p_slug);
  DELETE FROM public.mingla_connector_upstreams u WHERE u.slug = p_slug;
  PERFORM public.crm_audit(v_email, 'connector.registry_delete', 'mingla_connector_upstream', p_slug,
    jsonb_build_object('slug', p_slug));
  RETURN jsonb_build_object('slug', p_slug, 'deleted', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_registry_delete(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_registry_delete(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_registry_delete(text) IS
  'Issue #4294. Owner only: remove a company tool and delete its key from Supabase Vault.';

-- The latest proxied calls, newest first. Never an argument or a result.
CREATE FUNCTION public.mingla_connector_calls_recent(p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  PERFORM public.mingla_connector_actor(true);
  RETURN jsonb_build_object('calls', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', x.id, 'who', public.crm_display_name(x.owner_email),
             'upstream', x.upstream, 'tool', x.tool, 'started_at', x.started_at, 'duration_ms', x.duration_ms,
             'outcome', x.outcome, 'http_status', x.http_status) ORDER BY x.started_at DESC, x.id)
      FROM (SELECT * FROM public.mingla_connector_calls c ORDER BY c.started_at DESC, c.id LIMIT v_limit) x), '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_calls_recent(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_calls_recent(integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_calls_recent(integer) IS
  'Issue #4294. Owner only: the latest company tool calls (who, tool, when, outcome). Never an argument, a result or a key.';

-- ---------------------------------------------------------------------------
-- 7. The proxy's own steps (service_role only).
-- ---------------------------------------------------------------------------

-- Which company tools this key's person may see right now.
CREATE FUNCTION public.mingla_connector_upstreams_for(p_key_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_res  jsonb;
  v_role text;
BEGIN
  v_res := public.team_agent_resolve(p_key_hash);
  IF v_res->>'auth' IS DISTINCT FROM 'ok' THEN
    RETURN '{"auth":"invalid"}'::jsonb;
  END IF;
  v_role := v_res->>'role';
  IF NOT COALESCE(public.admin_team_can('crm'), false) THEN
    RETURN jsonb_build_object('ok', true, 'role', v_role, 'upstreams', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('ok', true, 'role', v_role, 'upstreams', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('slug', u.slug, 'label', u.label, 'tool_allowlist', to_jsonb(u.tool_allowlist),
             'version', md5(u.updated_at::text || '|' || COALESCE(u.key_updated_at::text, ''))) ORDER BY u.slug)
      FROM public.mingla_connector_upstreams u
     WHERE u.enabled AND u.vault_secret_id IS NOT NULL AND v_role = ANY (u.allowed_roles)
       AND cardinality(u.tool_allowlist) > 0), '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_upstreams_for(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_upstreams_for(text) TO service_role;

-- Before any request to a company tool: who is asking, may they, under the
-- limits, and the call-log row. A refused call gets its row here, finished.
CREATE FUNCTION public.mingla_connector_call_begin(p_key_hash text, p_slug text, p_tool text, p_client text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_lim    jsonb := public.mingla_connector_limits();
  v_res    jsonb;
  v_role   text;
  v_email  text;
  u        public.mingla_connector_upstreams;
  v_slug   text;
  v_tool   text;
  v_token  text;
  v_n      integer;
  v_id     uuid;
  v_now    timestamptz := clock_timestamp();
BEGIN
  v_res := public.team_agent_resolve(p_key_hash);
  IF v_res->>'auth' IS DISTINCT FROM 'ok' THEN
    RETURN '{"auth":"invalid"}'::jsonb;
  END IF;
  v_role := v_res->>'role';
  v_email := v_res->>'owner_email';
  v_slug := CASE WHEN p_slug ~ '^[a-z][a-z0-9]{1,19}$' THEN p_slug ELSE 'invalid' END;
  v_tool := CASE WHEN p_tool ~ '^[A-Za-z0-9_.-]{1,64}$' OR p_tool = 'tools/list' THEN p_tool ELSE 'invalid' END;

  SELECT * INTO u FROM public.mingla_connector_upstreams x WHERE x.slug = v_slug;
  IF NOT FOUND OR NOT u.enabled OR u.vault_secret_id IS NULL OR NOT COALESCE(v_role = ANY (u.allowed_roles), false)
     OR NOT COALESCE(public.admin_team_can('crm'), false)
     OR v_tool = 'invalid'
     OR (v_tool <> 'tools/list' AND NOT (v_tool = ANY (u.tool_allowlist))) THEN
    v_token := 'not_allowed';
  END IF;

  -- The person's count and their row are one step. The limit counts every
  -- call, refused or not, and is checked before anything is written: a call
  -- over the limit is rate_limited whatever else is wrong with it.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mingla_connector_calls:' || v_email, 0));
  SELECT count(*) INTO v_n FROM public.mingla_connector_calls c
   WHERE c.owner_email = v_email AND c.started_at > v_now - interval '1 minute' AND c.outcome <> 'rate_limited';
  IF v_n >= (v_lim->>'calls_per_minute')::integer THEN
    v_token := 'rate_limited';
  ELSE
    SELECT count(*) INTO v_n FROM public.mingla_connector_calls c
     WHERE c.owner_email = v_email AND c.started_at > v_now - interval '1 day' AND c.outcome <> 'rate_limited';
    IF v_n >= (v_lim->>'calls_per_day')::integer THEN
      v_token := 'rate_limited';
    END IF;
  END IF;

  -- Over the limit, one rate_limited row a minute records it; the rest are
  -- answered without a row, so refused calls cannot grow the log.
  IF v_token = 'rate_limited' AND EXISTS (
       SELECT 1 FROM public.mingla_connector_calls c
        WHERE c.owner_email = v_email AND c.started_at > v_now - interval '1 minute' AND c.outcome = 'rate_limited') THEN
    RETURN jsonb_build_object('ok', false, 'token', v_token);
  END IF;

  INSERT INTO public.mingla_connector_calls (owner_email, key_id, actor_role, upstream, tool, started_at, outcome,
                                             duration_ms)
  VALUES (v_email, (v_res->>'key_id')::uuid, v_role, v_slug, v_tool, v_now, COALESCE(v_token, 'running'),
          CASE WHEN v_token IS NULL THEN NULL ELSE 0 END)
  RETURNING id INTO v_id;

  IF v_token IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'token', v_token, 'call_id', v_id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'call_id', v_id, 'mcp_url', u.mcp_url,
                            'version', md5(u.updated_at::text || '|' || COALESCE(u.key_updated_at::text, '')));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_call_begin(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_call_begin(text, text, text, text) TO service_role;

-- After the request: how it ended. Only a running row changes.
CREATE FUNCTION public.mingla_connector_call_finish(p_call_id uuid, p_outcome text, p_http_status integer, p_ms integer)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.mingla_connector_calls
     SET outcome = CASE WHEN p_outcome ~ '^[a-z_]{1,60}$' AND p_outcome <> 'running' THEN p_outcome ELSE 'server_error' END,
         http_status = CASE WHEN p_http_status BETWEEN 0 AND 999 THEN p_http_status END,
         duration_ms = GREATEST(COALESCE(p_ms, 0), 0)
   WHERE id = p_call_id AND outcome = 'running';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('finished', v_n = 1);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_call_finish(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_call_finish(uuid, text, integer, integer) TO service_role;

-- The only reader of a company key: for a call that call_begin allowed, is
-- still running, began within the last minute, on a row that is still on
-- and still allows that person's role.
CREATE FUNCTION public.mingla_connector_upstream_key(p_call_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT d.decrypted_secret INTO v_secret
    FROM public.mingla_connector_calls c
    JOIN public.mingla_connector_upstreams u ON u.slug = c.upstream
    JOIN vault.decrypted_secrets d ON d.id = u.vault_secret_id
   WHERE c.id = p_call_id AND c.outcome = 'running'
     AND c.started_at > clock_timestamp() - make_interval(secs => (public.mingla_connector_limits()->>'key_read_seconds')::integer)
     AND u.enabled AND u.vault_secret_id IS NOT NULL AND c.actor_role = ANY (u.allowed_roles)
     AND (c.tool = 'tools/list' OR c.tool = ANY (u.tool_allowlist));
  IF v_secret IS NULL THEN
    RETURN '{"ok":false}'::jsonb;
  END IF;
  RETURN jsonb_build_object('ok', true, 'key', v_secret);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_upstream_key(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_upstream_key(uuid) TO service_role;
COMMENT ON FUNCTION public.mingla_connector_upstream_key(uuid) IS
  'Issue #4294. Internal: the only reader of a company key, for a call that is running now and was allowed by mingla_connector_call_begin. Not client-executable.';

-- Daily clean-up.
CREATE FUNCTION public.mingla_connector_housekeeping() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.mingla_connector_calls c
   WHERE c.started_at < clock_timestamp() - make_interval(days => (public.mingla_connector_limits()->>'call_log_days')::integer);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.mingla_connector_oauth_codes c WHERE c.created_at < clock_timestamp() - interval '7 days';
  DELETE FROM public.mingla_connector_oauth_grants g
   WHERE (g.revoked_at IS NOT NULL AND g.revoked_at < clock_timestamp() - interval '120 days')
      OR g.expires_at < clock_timestamp() - interval '120 days';
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_housekeeping() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_housekeeping() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'mingla_connector_housekeeping',
    '29 3 * * *',
    $cron$SELECT public.mingla_connector_housekeeping()$cron$
  );
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Feature Guide: staff-my-agent updated, staff-company-tools added.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE issue_4294_guide ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset($guide4294$[
  {
    "capability_key": "staff-my-agent",
    "is_new": false,
    "title": "My agent: connect your own Claude or Codex",
    "outcome_summary": "Team members connect their own Claude (in the browser, the desktop app, on a phone or Claude Code) or Codex agent to Mingla. The agent works under the person's name and role: it can read and update their host and creator pipelines, log what happened, work the content calendar, write outreach drafts for review, and plan, start, do and close cards in Work with proof after reading the shared agent activity. Each chat can have its own name, so the team sees which chat did what. It never sends messages, spends money or publishes. Search words: my agent, AI agent, Claude, Codex, connect agent, agent key, MCP, work board, Mingla connector, sign in.",
    "how_to": "1. In Mingla Admin, open System > My agent.\n2. Step 1, \"Copy your setup message\": choose your computer (\"macOS or Linux\" or \"Windows\") and copy the setup message for Claude or Codex. It works once, for 10 minutes.\n3. Step 2, \"Paste it into your agent\": paste it into Claude Code or Codex on your own computer and let it run the one command it contains.\n4. Step 3, \"Restart your agent, then just ask\": reopen the agent and ask \"What is on my plate in Mingla?\". If it fails, open \"Not working?\".\n5. Advanced lets you create a key by hand; it is shown once and hidden after 10 minutes.\n6. The page also lists \"What it can do now\", \"Work and calendar\", \"Not yet\", \"Guardrails\", suggested routines and \"What my agent did\". Try \"Do my cards for today.\" or the routine \"Log this chat's work\", which has the agent open a card in Work, post each step and close it with proof.\n7. Give each chat a short name the first time it uses a work tool, for example chat \"Hosts sweep\". Claims and Agent activity then show that name, and two chats on one key never write over each other. Use Disconnect to turn an agent off. Owners also see \"Agents on the team\" and can disconnect anyone's agent.\n8. Claude in the browser, the desktop app or on a phone: once the Mingla connector is added to your Claude organisation, choose it in Claude and press Connect. Mingla Admin opens and asks you to approve; press Approve and you are back in Claude. The \"Claude app\" card on My agent lists each connection with when it was last used, and Disconnect ends it.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner. One active key per person for each agent (one for Claude, one for Codex), and one Claude app connection per person for each app. The agent sees only what the person's role sees, cannot delete, manage keys or manage the team, never sends an email, DM or WhatsApp, may log only a cold first message, and cannot contact or unmark records set to Do not contact or Warm intro only. It must claim a record before changing it: a record another agent has claimed is refused until that claim is released or ends 30 minutes after its last update. Cards are not claimed: an agent that starts a card stays marked as working on it, and another agent cannot change that card until it has had no update for 24 hours. It cannot close a work card without proof, mark a message sent, approve spend, publish, override a giveaway or ads block, or remove a card. Undoing a move, adding beta leads to Hosts and setting targets are not available to the agent yet. A Claude app sign-in renews itself and asks you to sign in again after 90 days; it ends at once when you disconnect or lose access. A key unused for a set number of days (90 by default) is turned off. Windows setup is untested.",
    "support_wording": "Mingla team members can connect their own Claude or Codex agent to help with pipeline and operations work. The agent acts under their own name and permissions, and it never sends messages, spends money or publishes for them.",
    "who_can_use": ["Owner", "Admin", "Sales and marketing", "Founding partner"],
    "surfaces": ["Mingla Admin (admin.usemingla.com)", "Claude Code or Codex on the person's own computer", "Claude in the browser, the desktop app or on a phone"]
  },
  {
    "capability_key": "staff-company-tools",
    "is_new": true,
    "title": "Company tools in the Mingla connector",
    "outcome_summary": "The owner adds company tools such as PostHog, AppsFlyer or Meta Ads to the Mingla connector, sets each tool's key once, and chooses which roles may use it and exactly which of its tools are offered. Teammates then use those tools from Claude through the Mingla connector, under their own name, without ever seeing a key. Search words: company tools, connector, MCP, PostHog, AppsFlyer, Meta Ads, Sentry, API key, Vault.",
    "how_to": "1. In Mingla Admin, open System > Company tools (owner only).\n2. Press \"Add company tool\" and enter a short name, a label and the tool's MCP address.\n3. Press \"Set key\", paste the tool's key and save. The key is stored encrypted and is never shown again; the row then says \"Key set, last updated\" with the date and who set it. Use \"Replace key\" to change it and \"Remove key\" to delete it.\n4. Choose the roles that may use the tool and list the exact tool names to offer, one per line. Nothing is offered until it is listed.\n5. Turn the tool on. Teammates see its tools in Claude, named like posthog__exec.\n6. The last 20 calls are listed under the table: who, which tool, when and how it ended.",
    "limitations": "Owner only. A key can be set or replaced but never read back, not even in part. A tool can be turned on only after its key is set, and changing its address turns it off again. Only tools listed by their exact name are offered, and only to the chosen roles; a tool the company server adds later stays hidden until listed. Each person can make 30 company tool calls a minute and 2000 a day. A key's own permissions are the real limit for tools that can do many things (PostHog's exec, for example), so give each key read-only access where possible. Calls are kept for 90 days without their questions or answers.",
    "support_wording": "Mingla's team can use some company analytics and ads tools from Claude through the Mingla connector. Keys are held by Mingla and teammates never see them.",
    "who_can_use": ["Owner"],
    "surfaces": ["Mingla Admin (admin.usemingla.com)", "Claude through the Mingla connector"]
  }
]$guide4294$::jsonb) AS g(capability_key text, title text, outcome_summary text, how_to text, limitations text,
                           support_wording text, who_can_use jsonb, surfaces jsonb, is_new boolean);

-- staff-my-agent as it stood in production on 7 Nov 2026 (read read-only
-- before this was written). A newer edit is never written over.
DO $preflight4294$
BEGIN
  IF (SELECT count(*) FROM issue_4294_guide) <> 2 THEN
    RAISE EXCEPTION 'issue4294_guide_payload_shape';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = 'staff-my-agent') THEN
    RAISE EXCEPTION 'issue4294_guide_missing_capability: staff-my-agent';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = 'staff-company-tools') THEN
    RAISE EXCEPTION 'issue4294_guide_new_entry_exists: staff-company-tools';
  END IF;
  IF (SELECT md5(concat_ws('|', c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording,
                           array_to_json(c.who_can_use)::text, array_to_json(c.surfaces)::text))
        FROM public.product_capabilities c WHERE c.capability_key = 'staff-my-agent')
     <> '9066811d8ac0da2bb09451afcf1b5b59' THEN
    RAISE EXCEPTION 'issue4294_guide_entry_changed_since_read: staff-my-agent';
  END IF;
END;
$preflight4294$;

WITH saved AS (
  UPDATE public.product_capabilities c
     SET title = g.title,
         outcome_summary = g.outcome_summary,
         how_to = g.how_to,
         limitations = g.limitations,
         support_wording = g.support_wording,
         who_can_use = ARRAY(SELECT jsonb_array_elements_text(g.who_can_use)),
         surfaces = ARRAY(SELECT jsonb_array_elements_text(g.surfaces)),
         revision = c.revision + 1,
         updated_at = now()
    FROM issue_4294_guide g
   WHERE c.capability_key = g.capability_key AND NOT g.is_new
  RETURNING c.id, c.revision, c.claimed_status
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', saved.id,
       jsonb_build_object('source', 'issue_4294_mingla_connector', 'issue', 4294,
                          'revision', saved.revision, 'claimed_status', saved.claimed_status, 'status_corrected', false)
  FROM saved;

WITH added AS (
  INSERT INTO public.product_capabilities(
    capability_key, title, outcome_summary, who_can_use, surfaces, how_to,
    limitations, support_wording, claimed_status, required_evidence_kinds, verification_due_at
  )
  SELECT g.capability_key, g.title, g.outcome_summary,
         ARRAY(SELECT jsonb_array_elements_text(g.who_can_use)),
         ARRAY(SELECT jsonb_array_elements_text(g.surfaces)),
         g.how_to, g.limitations, g.support_wording, 'planned',
         ARRAY['source', 'test', 'release_record', 'live_check'], NULL
    FROM issue_4294_guide g
   WHERE g.is_new
  RETURNING id, revision, claimed_status
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', added.id,
       jsonb_build_object('source', 'issue_4294_mingla_connector', 'issue', 4294,
                          'revision', added.revision, 'claimed_status', added.claimed_status, 'status_corrected', false)
  FROM added;

-- ---------------------------------------------------------------------------
-- 9. Self-check. The apply stops here if anything above is not as stated.
-- ---------------------------------------------------------------------------
DO $c4294$
DECLARE
  c_client text[] := ARRAY[
    'public.mingla_connector_oauth_approve(text,text,text,text)',
    'public.mingla_connector_connections_mine()',
    'public.mingla_connector_disconnect(uuid)',
    'public.mingla_connector_registry_list()',
    'public.mingla_connector_registry_save(jsonb)',
    'public.mingla_connector_registry_delete(text)',
    'public.mingla_connector_set_key(text,text)',
    'public.mingla_connector_clear_key(text)',
    'public.mingla_connector_calls_recent(integer)'
  ];
  c_internal text[] := ARRAY[
    'public.mingla_connector_limits()',
    'public.mingla_connector_redirect_ok(text,text)',
    'public.mingla_connector_resource(text)',
    'public.mingla_connector_url_ok(text)',
    'public.mingla_connector_random43()',
    'public.mingla_connector_actor(boolean)',
    'public.mingla_connector_oauth_mint(uuid,text)',
    'public.mingla_connector_oauth_exchange(text,text,text,text,text)',
    'public.mingla_connector_oauth_refresh(text,text)',
    'public.mingla_connector_registry_row(text)',
    'public.mingla_connector_upstreams_for(text)',
    'public.mingla_connector_call_begin(text,text,text,text)',
    'public.mingla_connector_call_finish(uuid,text,integer,integer)',
    'public.mingla_connector_upstream_key(uuid)',
    'public.mingla_connector_housekeeping()'
  ];
  c_tables text[] := ARRAY['public.mingla_connector_oauth_clients', 'public.mingla_connector_oauth_codes',
                           'public.mingla_connector_oauth_grants', 'public.mingla_connector_oauth_spent_refresh',
                           'public.mingla_connector_upstreams', 'public.mingla_connector_calls'];
  v_fn   text;
  v_tbl  text;
  v_role text;
  v_priv text;
  v_n    integer;
  v_list text;
BEGIN
  -- Functions: nothing for PUBLIC or anon; the signed-in role holds exactly
  -- the client ones; the server role holds all; empty search path.
  FOREACH v_fn IN ARRAY c_client || c_internal LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4294 self-check: anon can execute %', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
               WHERE p.oid = v_fn::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'issue 4294 self-check: PUBLIC can execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4294 self-check: service_role cannot execute %', v_fn;
    END IF;
    IF NOT COALESCE((SELECT 'search_path=""' = ANY (p.proconfig) FROM pg_catalog.pg_proc p
                      WHERE p.oid = v_fn::regprocedure), false) THEN
      RAISE EXCEPTION 'issue 4294 self-check: % does not pin an empty search path', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY c_client LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4294 self-check: authenticated cannot execute %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY c_internal LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4294 self-check: authenticated can execute the internal %', v_fn;
    END IF;
  END LOOP;
  -- No mingla_connector_ function that is not named above.
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'mingla\_connector\_%'
    AND NOT (p.oid = ANY (SELECT x::regprocedure::oid FROM unnest(c_client || c_internal) AS x));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue 4294 self-check: % mingla_connector_ function(s) are not in the checked list', v_n;
  END IF;

  -- Tables: nothing for anon or authenticated, row security on, no policy.
  FOREACH v_tbl IN ARRAY c_tables LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        IF has_table_privilege(v_role, v_tbl, v_priv) THEN
          RAISE EXCEPTION 'issue 4294 self-check: % holds % on %', v_role, v_priv, v_tbl;
        END IF;
      END LOOP;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
                WHERE c.oid = v_tbl::regclass AND a.grantee = 0) THEN
      RAISE EXCEPTION 'issue 4294 self-check: PUBLIC holds a privilege on %', v_tbl;
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_tbl::regclass) THEN
      RAISE EXCEPTION 'issue 4294 self-check: row security is off on %', v_tbl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_tbl::regclass) THEN
      RAISE EXCEPTION 'issue 4294 self-check: a policy exists on %', v_tbl;
    END IF;
  END LOOP;

  -- I-4294-2: the registry has no key column; no client role reaches Vault.
  IF EXISTS (SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema = 'public' AND c.table_name = 'mingla_connector_upstreams'
                AND c.column_name ~* '(^|_)(key|secret|token|password|api_key)$') THEN
    RAISE EXCEPTION 'issue 4294 self-check: the company tools table has a column that could hold a key';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'vault' AND c.relkind IN ('r', 'v', 'm')
                  AND (has_table_privilege(v_role, c.oid, 'SELECT') OR has_table_privilege(v_role, c.oid, 'INSERT')
                       OR has_table_privilege(v_role, c.oid, 'UPDATE') OR has_table_privilege(v_role, c.oid, 'DELETE'))) THEN
      RAISE EXCEPTION 'issue 4294 self-check: % holds a privilege on a vault table', v_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'vault' AND has_function_privilege(v_role, p.oid, 'EXECUTE')
                  AND has_schema_privilege(v_role, 'vault', 'USAGE')) THEN
      RAISE EXCEPTION 'issue 4294 self-check: % can call a vault function', v_role;
    END IF;
  END LOOP;
  -- Who writes Vault, and who reads a decrypted key, among public functions.
  SELECT COALESCE(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_list
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'mingla\_connector\_%'
    AND p.prosrc ~* '(vault\.(create_secret|update_secret)|delete\s+from\s+vault\.)';
  IF v_list IS DISTINCT FROM 'mingla_connector_clear_key,mingla_connector_set_key' THEN
    RAISE EXCEPTION 'issue 4294 self-check: the functions that write Vault are [%]', v_list;
  END IF;
  SELECT COALESCE(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_list
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'mingla\_connector\_%' AND p.prosrc ~* 'decrypted_secrets';
  IF v_list IS DISTINCT FROM 'mingla_connector_upstream_key' THEN
    RAISE EXCEPTION 'issue 4294 self-check: the functions that read a decrypted key are [%]', v_list;
  END IF;
  -- set_key never builds a statement from text (a key must never reach a log).
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p
  WHERE p.oid = ANY (SELECT x::regprocedure::oid FROM unnest(c_client || c_internal) AS x)
    AND (p.prosrc ~* '\mexecute\M' OR p.prosrc ~* 'format\s*\(' OR p.prosrc ~* 'net\.http|http_post|http_get|pg_net|dblink');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue 4294 self-check: % function(s) build a statement from text or reach outside the database', v_n;
  END IF;
  -- Only the one key maker writes keys; no new function writes a key row.
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'mingla\_connector\_%'
    AND p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(only\s+)?(public\.)?team_agent_(keys|calls|setup_codes)\M';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue 4294 self-check: a mingla_connector_ function writes a team_agent_ table';
  END IF;
  -- One active key per person per agent per kind, by a valid index.
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = 'public.team_agent_keys'::regclass AND c.relname = 'team_agent_keys_one_active'
    AND i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL AND i.indnatts = 3;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'issue 4294 self-check: the one-active-key index is missing or not per kind';
  END IF;
  -- Seeded apps; no company tool is on.
  IF (SELECT count(*) FROM public.mingla_connector_oauth_clients) <> 2 THEN
    RAISE EXCEPTION 'issue 4294 self-check: expected exactly the two Claude apps';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mingla_connector_upstreams WHERE enabled) THEN
    RAISE EXCEPTION 'issue 4294 self-check: a company tool is on after the migration';
  END IF;
END;
$c4294$;

COMMIT;
