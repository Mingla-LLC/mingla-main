-- Issue #4294 — company sign-in for company tools that refuse a key.
--
-- Some company MCP servers (Magnific first; Meta's and Sentry's own MCP the
-- same way) accept only an OAuth sign-in, never a stored key. This migration
-- lets an owner sign in once, as the company, from Company tools in Mingla
-- Admin. The sign-in (an access token and a refresh token) is kept in
-- Supabase Vault exactly like a key: the table holds only the Vault id, no
-- client can read it, and the edge function reads it only for a call the
-- database has just allowed.
--
--   * A company tool row is now one of two kinds: 'key' (as before, nothing
--     changes) or 'signin' (new).
--   * mingla_connector_signin_states: one row per Connect press. Single use,
--     ten minutes. It holds a digest of the state, never the state, and the
--     PKCE verifier sealed with a key only the state can open.
--   * Owner only (Mingla Admin): signin_begin, signin_status,
--     signin_disconnect. Server only (team-agent): signin_claim,
--     signin_complete, signin_credential, signin_refresh_begin,
--     signin_refresh_store, signin_refresh_fail.
--   * Renewal is one at a time per row: refresh_begin takes a short lease
--     under the row lock and refresh_store writes only with that lease. A
--     clash raises PT409 (never 40001), and the edge retries once.
--   * Each row has a display label and words to hide; the proxy rewrites
--     those words in tool names shown to Claude and in result text.
--   * A per-person daily cap on generation calls, counted in call_begin for
--     the tools on the row's generation list (default 40 a day).
--   * The 'studio' row (Mingla Studio, Magnific's hosted MCP) is seeded OFF,
--     owner only, not connected.
--
-- Conventions as 20280425004294: static SQL only, row security on with no
-- policies, no client privilege on any table, every function SECURITY
-- DEFINER with an empty search path, client functions refuse a request that
-- came through an agent (mingla_connector_actor). No new function name
-- starts with team_agent_. No foreign key or trigger touches a team_agent_
-- table.
--
-- Invariants (declared beside their enforcing tests):
--   I-4294-9  A company sign-in's tokens live only in Supabase Vault, are
--             written only by signin_complete, signin_refresh_store and
--             signin_disconnect, are read only by signin_credential and
--             signin_refresh_begin for a running allowed call, and never
--             appear in any client answer, audit row or table column.
--   I-4294-10 A sign-in state works once, within ten minutes, for the row
--             and owner that started it.
--   I-4294-11 Renewal is serialised per row: a second renewer, or a store
--             without the current lease, gets PT409 and changes nothing.
--   I-4294-12 A generation tool call over the person's daily cap is refused
--             before any request leaves Mingla.
--
-- Rollback (manual, owner-approved only):
--   DELETE FROM vault.secrets WHERE id IN (SELECT signin_vault_id FROM public.mingla_connector_upstreams WHERE signin_vault_id IS NOT NULL);
--   DELETE FROM public.mingla_connector_upstreams WHERE auth_kind = 'signin';
--   DROP the mingla_connector_signin_* functions and mingla_connector_signin_states;
--   restore registry_row, registry_save, set_key, registry_delete, upstreams_for,
--   call_begin and housekeeping from 20280425004294;
--   ALTER TABLE public.mingla_connector_upstreams DROP the columns added in section 1
--   and re-add mingla_connector_upstreams_on_needs_key as CHECK (NOT enabled OR vault_secret_id IS NOT NULL).

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Company tool rows: kind, label, hidden words, generation cap, sign-in.
-- ---------------------------------------------------------------------------
ALTER TABLE public.mingla_connector_upstreams
  ADD COLUMN auth_kind            text NOT NULL DEFAULT 'key',
  ADD COLUMN display_label        text,
  ADD COLUMN hide_words           text[] NOT NULL DEFAULT '{}',
  ADD COLUMN generation_tools     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN daily_generation_cap integer NOT NULL DEFAULT 40,
  ADD COLUMN signin_vault_id      uuid,          -- set only by signin_complete / signin_disconnect
  ADD COLUMN signin_issuer        text,
  ADD COLUMN signin_token_url     text,
  ADD COLUMN signin_resource      text,
  ADD COLUMN signin_account       text,
  ADD COLUMN signin_connected_at  timestamptz,
  ADD COLUMN signin_connected_by  text,
  ADD COLUMN signin_expires_at    timestamptz,   -- when the access token ends; not a secret
  ADD COLUMN signin_generation    integer NOT NULL DEFAULT 0,
  ADD COLUMN signin_lease_id      uuid,
  ADD COLUMN signin_lease_until   timestamptz,
  ADD COLUMN signin_reconnect_at  timestamptz;   -- renewal was refused: Reconnect needed

ALTER TABLE public.mingla_connector_upstreams
  DROP CONSTRAINT mingla_connector_upstreams_on_needs_key;
ALTER TABLE public.mingla_connector_upstreams
  ADD CONSTRAINT mingla_connector_upstreams_auth_kind_check CHECK (auth_kind IN ('key', 'signin')),
  ADD CONSTRAINT mingla_connector_upstreams_on_needs_key CHECK (
    NOT enabled
    OR (auth_kind = 'key' AND vault_secret_id IS NOT NULL)
    OR (auth_kind = 'signin' AND signin_vault_id IS NOT NULL)),
  ADD CONSTRAINT mingla_connector_upstreams_key_kind_check CHECK (auth_kind = 'key' OR vault_secret_id IS NULL),
  ADD CONSTRAINT mingla_connector_upstreams_signin_kind_check CHECK (auth_kind = 'signin' OR signin_vault_id IS NULL),
  ADD CONSTRAINT mingla_connector_upstreams_signin_set CHECK (
    signin_vault_id IS NULL OR (signin_connected_at IS NOT NULL AND signin_connected_by IS NOT NULL
                                AND signin_token_url IS NOT NULL AND signin_expires_at IS NOT NULL)),
  ADD CONSTRAINT mingla_connector_upstreams_display_label_check CHECK (
    display_label IS NULL OR char_length(btrim(display_label)) BETWEEN 1 AND 60),
  ADD CONSTRAINT mingla_connector_upstreams_hide_words_check CHECK (cardinality(hide_words) <= 20),
  ADD CONSTRAINT mingla_connector_upstreams_generation_tools_check CHECK (cardinality(generation_tools) <= 200),
  ADD CONSTRAINT mingla_connector_upstreams_cap_check CHECK (daily_generation_cap BETWEEN 0 AND 10000),
  ADD CONSTRAINT mingla_connector_upstreams_account_check CHECK (
    signin_account IS NULL OR char_length(signin_account) BETWEEN 1 AND 120),
  ADD CONSTRAINT mingla_connector_upstreams_lease_set CHECK (
    (signin_lease_id IS NULL) = (signin_lease_until IS NULL));

-- One row per Connect press. Holds a digest of the state, never the state.
CREATE TABLE public.mingla_connector_signin_states (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash   text NOT NULL,
  slug         text NOT NULL REFERENCES public.mingla_connector_upstreams (slug) ON DELETE CASCADE,
  owner_email  text NOT NULL,
  verifier_box text NOT NULL,                  -- the PKCE verifier sealed with a key derived from the state
  issuer       text NOT NULL,
  token_url    text NOT NULL,
  resource     text NOT NULL,
  redirect_uri text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  completed_at timestamptz,
  voided_at    timestamptz,
  CONSTRAINT mingla_connector_signin_states_hash_key UNIQUE (state_hash),
  CONSTRAINT mingla_connector_signin_states_hash_check CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mingla_connector_signin_states_box_check CHECK (verifier_box ~ '^[A-Za-z0-9_-]+$' AND char_length(verifier_box) BETWEEN 40 AND 400),
  CONSTRAINT mingla_connector_signin_states_owner_check CHECK (owner_email = lower(btrim(owner_email)) AND owner_email <> ''),
  CONSTRAINT mingla_connector_signin_states_done_check CHECK (completed_at IS NULL OR used_at IS NOT NULL)
);
CREATE INDEX mingla_connector_signin_states_by_slug ON public.mingla_connector_signin_states (slug, created_at DESC);

ALTER TABLE public.mingla_connector_signin_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mingla_connector_signin_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mingla_connector_signin_states TO service_role;
COMMENT ON TABLE public.mingla_connector_signin_states IS
  'Issue #4294. One row per company sign-in start. Single use, ten minutes. Holds a digest of the state and a sealed PKCE verifier, never a token. No client reads or writes.';
COMMENT ON COLUMN public.mingla_connector_upstreams.signin_vault_id IS
  'Issue #4294. The Vault secret holding the company sign-in (access and refresh token). Never returned to a client.';

-- Mingla Studio: Magnific''s hosted MCP, by company sign-in. OFF, owner only,
-- not connected. The allow-list is the plan''s starter list (no delete, no
-- sharing, no voice cloning, no team admin, no library edits, no Spaces, no 3D).
INSERT INTO public.mingla_connector_upstreams
  (slug, label, mcp_url, enabled, allowed_roles, tool_allowlist, notes, auth_kind, display_label, hide_words,
   generation_tools, daily_generation_cap)
VALUES
  ('studio', 'Mingla Studio', 'https://mcp.magnific.com', false, ARRAY['owner'],
   ARRAY['account_balance', 'audio_music_generate', 'audio_sfx_generate', 'audio_tts', 'audio_voices_list',
         'brand_kit_get', 'brand_kit_list', 'creation_status', 'creations_deliver', 'creations_get',
         'creations_list', 'creations_register_download', 'creations_search', 'creations_wait', 'folders_list',
         'images_crop', 'images_generate', 'images_remove_background', 'images_resize', 'images_upscale',
         'projects_move', 'simulate_cost', 'stock_download', 'stock_get', 'stock_search', 'video_analyze',
         'video_audio_mix', 'video_concatenate', 'video_cut', 'video_extend', 'video_extract_frames',
         'video_finalize_draft', 'video_generate', 'video_metadata', 'video_models_list', 'video_music',
         'video_plan', 'video_soundfx', 'video_speed', 'video_upscale', 'video_zoom'],
   'Company sign-in (no key). Press Connect and sign in with the company Magnific account. Generation tools count toward each person''s daily limit.',
   'signin', 'Mingla Studio', ARRAY['Magnific', 'Freepik'],
   ARRAY['audio_music_generate', 'audio_sfx_generate', 'audio_tts', 'images_generate', 'images_remove_background',
         'images_upscale', 'video_extend', 'video_finalize_draft', 'video_generate', 'video_music', 'video_soundfx',
         'video_upscale'],
   40);

-- ---------------------------------------------------------------------------
-- 2. Internal definitions (service_role only).
-- ---------------------------------------------------------------------------

-- The ONE place company sign-in's own constants live. The client id is the
-- client metadata document Mingla Admin serves; the redirect is team-agent's
-- callback.
CREATE FUNCTION public.mingla_connector_signin_limits() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT $j${
    "client_id": "https://admin.usemingla.com/oauth/mingla-connector-client.json",
    "redirect_uri": "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent/oauth/upstream-callback",
    "state_minutes": 10,
    "claim_minutes": 5,
    "lease_seconds": 30,
    "min_expires_seconds": 30,
    "max_expires_seconds": 86400
  }$j$::jsonb
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_limits() TO service_role;
COMMENT ON FUNCTION public.mingla_connector_signin_limits() IS
  'Issue #4294. Internal: the one definition of company sign-in''s client id, callback and lifetimes.';

-- The company tool row a running, allowed call may use a sign-in for, or
-- NULL. Same window and rules as mingla_connector_upstream_key.
CREATE FUNCTION public.mingla_connector_signin_call_row(p_call_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT u.slug
    FROM public.mingla_connector_calls c
    JOIN public.mingla_connector_upstreams u ON u.slug = c.upstream
   WHERE c.id = p_call_id AND c.outcome = 'running'
     AND c.started_at > clock_timestamp() - make_interval(secs => (public.mingla_connector_limits()->>'key_read_seconds')::integer)
     AND u.enabled AND u.auth_kind = 'signin' AND u.signin_vault_id IS NOT NULL AND u.signin_reconnect_at IS NULL
     AND c.actor_role = ANY (u.allowed_roles)
     AND (c.tool = 'tools/list' OR c.tool = ANY (u.tool_allowlist))
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_call_row(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_call_row(uuid) TO service_role;

-- Are two https hosts under the same last two labels (auth.example.com and
-- mcp.example.com)? Used so a sign-in's token address stays with the tool.
CREATE FUNCTION public.mingla_connector_signin_same_site(p_a text, p_b text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT substring(p_a FROM '^https://(?:[^/:]+\.)?([a-z0-9-]+\.[a-z0-9-]+)(?::443)?(?:/|$)') IS NOT NULL
     AND substring(p_a FROM '^https://(?:[^/:]+\.)?([a-z0-9-]+\.[a-z0-9-]+)(?::443)?(?:/|$)')
       = substring(p_b FROM '^https://(?:[^/:]+\.)?([a-z0-9-]+\.[a-z0-9-]+)(?::443)?(?:/|$)')
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_same_site(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_same_site(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Company tools (owner only), now with both kinds.
-- ---------------------------------------------------------------------------

-- One row as Admin sees it. Never a key, a token or a Vault id.
CREATE OR REPLACE FUNCTION public.mingla_connector_registry_row(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('slug', u.slug, 'label', u.label, 'mcp_url', u.mcp_url, 'enabled', u.enabled,
           'allowed_roles', to_jsonb(u.allowed_roles), 'tool_allowlist', to_jsonb(u.tool_allowlist),
           'notes', u.notes, 'key_set', u.vault_secret_id IS NOT NULL,
           'key_updated_at', u.key_updated_at,
           'key_updated_by', CASE WHEN u.key_updated_by IS NULL THEN NULL ELSE public.crm_display_name(u.key_updated_by) END,
           'updated_at', u.updated_at,
           'updated_by', CASE WHEN u.updated_by IS NULL THEN NULL ELSE public.crm_display_name(u.updated_by) END,
           'auth_kind', u.auth_kind,
           'display_label', u.display_label,
           'hide_words', to_jsonb(u.hide_words),
           'generation_tools', to_jsonb(u.generation_tools),
           'daily_generation_cap', u.daily_generation_cap,
           'signin', CASE WHEN u.auth_kind <> 'signin' THEN NULL ELSE jsonb_build_object(
             'connected', u.signin_vault_id IS NOT NULL,
             'reconnect_needed', u.signin_vault_id IS NOT NULL AND u.signin_reconnect_at IS NOT NULL,
             'account', u.signin_account,
             'connected_at', u.signin_connected_at,
             'connected_by', CASE WHEN u.signin_connected_by IS NULL THEN NULL
                                  ELSE public.crm_display_name(u.signin_connected_by) END,
             'reconnect_since', u.signin_reconnect_at) END)
    FROM public.mingla_connector_upstreams u WHERE u.slug = p_slug
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_registry_row(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_registry_row(text) TO service_role;

-- Add a company tool or change one. Fields: slug, label, mcp_url, enabled,
-- allowed_roles, tool_allowlist, notes, auth_kind, display_label,
-- hide_words, generation_tools, daily_generation_cap. Any other field is
-- refused (a key is set only with mingla_connector_set_key; a sign-in only
-- through Connect). Audited.
CREATE OR REPLACE FUNCTION public.mingla_connector_registry_save(p_row jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c_fields constant text[] := ARRAY['slug', 'label', 'mcp_url', 'enabled', 'allowed_roles', 'tool_allowlist', 'notes',
                                    'auth_kind', 'display_label', 'hide_words', 'generation_tools',
                                    'daily_generation_cap'];
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
  v_kind    text;
  v_display text;
  v_hide    text[];
  v_gen     text[];
  v_cap     integer;
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
    RAISE EXCEPTION 'invalid_field: A company tool has only these fields: slug, label, address, on or off, roles, tools, notes, kind, display name, hidden words, generation tools and daily limit. Set a key with Set key, or sign in with Connect.'
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

  -- The kind: key (default) or company sign-in. It changes only while the
  -- row holds neither a key nor a sign-in.
  v_kind := CASE WHEN r ? 'auth_kind' THEN r->>'auth_kind' ELSE COALESCE(old.auth_kind, 'key') END;
  IF v_kind IS NULL OR v_kind NOT IN ('key', 'signin') THEN
    RAISE EXCEPTION 'invalid_kind: A company tool uses a key or a company sign-in.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_new AND v_kind IS DISTINCT FROM old.auth_kind
     AND (old.vault_secret_id IS NOT NULL OR old.signin_vault_id IS NOT NULL) THEN
    RAISE EXCEPTION 'kind_locked: Remove the key or disconnect the sign-in before changing how this tool signs in.' USING ERRCODE = '22023';
  END IF;
  v_display := CASE WHEN r ? 'display_label' THEN NULLIF(btrim(r->>'display_label'), '') ELSE old.display_label END;
  IF v_display IS NOT NULL AND char_length(v_display) > 60 THEN
    RAISE EXCEPTION 'invalid_display_label: A display name is at most 60 characters.' USING ERRCODE = '22023';
  END IF;
  IF r ? 'hide_words' THEN
    IF jsonb_typeof(r->'hide_words') <> 'array' OR jsonb_array_length(r->'hide_words') > 20
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'hide_words') e
                   WHERE jsonb_typeof(e) <> 'string'
                      OR btrim(e #>> '{}') !~ '^[A-Za-z0-9](?:[A-Za-z0-9 .&''-]{0,38}[A-Za-z0-9])?$') THEN
      RAISE EXCEPTION 'invalid_hide_words: Each hidden word is 1 to 40 letters, digits, spaces, dots, dashes or apostrophes, at most 20 words.' USING ERRCODE = '22023';
    END IF;
    v_hide := ARRAY(SELECT DISTINCT btrim(e) FROM jsonb_array_elements_text(r->'hide_words') e ORDER BY 1);
  ELSE
    v_hide := COALESCE(old.hide_words, '{}');
  END IF;
  IF r ? 'generation_tools' THEN
    IF jsonb_typeof(r->'generation_tools') <> 'array' OR jsonb_array_length(r->'generation_tools') > 200
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'generation_tools') e
                   WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[A-Za-z0-9_.-]{1,64}$') THEN
      RAISE EXCEPTION 'invalid_generation_tools: Each generation tool name is 1 to 64 letters, digits, dots, dashes or underscores, at most 200 tools.' USING ERRCODE = '22023';
    END IF;
    v_gen := ARRAY(SELECT DISTINCT e FROM jsonb_array_elements_text(r->'generation_tools') e ORDER BY e);
  ELSE
    v_gen := COALESCE(old.generation_tools, '{}');
  END IF;
  IF r ? 'daily_generation_cap' THEN
    IF jsonb_typeof(r->'daily_generation_cap') <> 'number'
       OR (r->>'daily_generation_cap') !~ '^[0-9]{1,5}$'
       OR (r->>'daily_generation_cap')::integer > 10000 THEN
      RAISE EXCEPTION 'invalid_daily_cap: The daily limit is a whole number from 0 to 10000.' USING ERRCODE = '22023';
    END IF;
    v_cap := (r->>'daily_generation_cap')::integer;
  ELSE
    v_cap := COALESCE(old.daily_generation_cap, 40);
  END IF;

  -- A company sign-in belongs to the address it was made for: its tokens are
  -- for that tool and renew at that tool's sign-in server. A new address
  -- needs Disconnect first, and ends any sign-in still under way.
  IF NOT v_new AND old.mcp_url IS DISTINCT FROM v_url AND old.auth_kind = 'signin' THEN
    IF old.signin_vault_id IS NOT NULL THEN
      RAISE EXCEPTION 'signin_locked: Disconnect the company sign-in before changing this tool''s address.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.mingla_connector_signin_states
       SET voided_at = clock_timestamp()
     WHERE slug = v_slug AND completed_at IS NULL AND voided_at IS NULL;
  END IF;

  -- A new address for a tool that has a key or a sign-in: it is turned off,
  -- so an owner turns it on again on purpose.
  IF NOT v_new AND old.mcp_url IS DISTINCT FROM v_url
     AND (old.vault_secret_id IS NOT NULL OR old.signin_vault_id IS NOT NULL) THEN
    v_enabled := false;
  END IF;
  IF v_enabled AND v_kind = 'key' AND (v_new OR old.vault_secret_id IS NULL) THEN
    RAISE EXCEPTION 'no_key: Set a key before turning this tool on.' USING ERRCODE = '22023';
  END IF;
  IF v_enabled AND v_kind = 'signin' AND (v_new OR old.signin_vault_id IS NULL) THEN
    RAISE EXCEPTION 'not_connected: Connect the company account before turning this tool on.' USING ERRCODE = '22023';
  END IF;

  IF v_new THEN
    INSERT INTO public.mingla_connector_upstreams (slug, label, mcp_url, enabled, allowed_roles, tool_allowlist, notes,
                                                   updated_by, auth_kind, display_label, hide_words, generation_tools,
                                                   daily_generation_cap)
    VALUES (v_slug, v_label, v_url, v_enabled, v_roles, v_tools, v_notes, v_email, v_kind, v_display, v_hide, v_gen,
            v_cap);
    v_changed := ARRAY['created'];
  ELSE
    IF old.label IS DISTINCT FROM v_label THEN v_changed := array_append(v_changed, 'label'); END IF;
    IF old.mcp_url IS DISTINCT FROM v_url THEN v_changed := array_append(v_changed, 'mcp_url'); END IF;
    IF old.enabled IS DISTINCT FROM v_enabled THEN v_changed := array_append(v_changed, 'enabled'); END IF;
    IF old.allowed_roles IS DISTINCT FROM v_roles THEN v_changed := array_append(v_changed, 'allowed_roles'); END IF;
    IF old.tool_allowlist IS DISTINCT FROM v_tools THEN v_changed := array_append(v_changed, 'tool_allowlist'); END IF;
    IF old.notes IS DISTINCT FROM v_notes THEN v_changed := array_append(v_changed, 'notes'); END IF;
    IF old.auth_kind IS DISTINCT FROM v_kind THEN v_changed := array_append(v_changed, 'auth_kind'); END IF;
    IF old.display_label IS DISTINCT FROM v_display THEN v_changed := array_append(v_changed, 'display_label'); END IF;
    IF old.hide_words IS DISTINCT FROM v_hide THEN v_changed := array_append(v_changed, 'hide_words'); END IF;
    IF old.generation_tools IS DISTINCT FROM v_gen THEN v_changed := array_append(v_changed, 'generation_tools'); END IF;
    IF old.daily_generation_cap IS DISTINCT FROM v_cap THEN v_changed := array_append(v_changed, 'daily_generation_cap'); END IF;
    UPDATE public.mingla_connector_upstreams
       SET label = v_label, mcp_url = v_url, enabled = v_enabled, allowed_roles = v_roles,
           tool_allowlist = v_tools, notes = v_notes, auth_kind = v_kind, display_label = v_display,
           hide_words = v_hide, generation_tools = v_gen, daily_generation_cap = v_cap,
           updated_at = clock_timestamp(), updated_by = v_email
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
  'Issue #4294. Owner only: add or change a company tool (key or company sign-in). Refuses any key, token or Vault field. Audited with old and new host.';

-- Set or replace a company tool's key. As before; a sign-in tool has no key.
CREATE OR REPLACE FUNCTION public.mingla_connector_set_key(p_slug text, p_key text) RETURNS jsonb
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
  IF u.auth_kind <> 'key' THEN
    RAISE EXCEPTION 'signin_only: This company tool uses a company sign-in, not a key. Press Connect.' USING ERRCODE = '22023';
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
  'Issue #4294. Owner only: set or replace a key-kind company tool''s key, kept in Supabase Vault. Returns only that a key is set and when. Never returns, logs or repeats the key.';

-- Remove a company tool. Its key or its sign-in goes with it.
CREATE OR REPLACE FUNCTION public.mingla_connector_registry_delete(p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_kind  text;
BEGIN
  v_email := public.mingla_connector_actor(true);
  SELECT u.auth_kind INTO v_kind FROM public.mingla_connector_upstreams u WHERE u.slug = p_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That company tool is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  IF v_kind = 'signin' THEN
    PERFORM public.mingla_connector_signin_disconnect(p_slug);
  ELSE
    PERFORM public.mingla_connector_clear_key(p_slug);
  END IF;
  DELETE FROM public.mingla_connector_upstreams u WHERE u.slug = p_slug;
  PERFORM public.crm_audit(v_email, 'connector.registry_delete', 'mingla_connector_upstream', p_slug,
    jsonb_build_object('slug', p_slug));
  RETURN jsonb_build_object('slug', p_slug, 'deleted', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Company sign-in: owner side (Mingla Admin, through team-agent).
-- ---------------------------------------------------------------------------

-- Disconnect: the Vault secret is deleted, the row is turned off, waiting
-- starts end. Audited. Defined first: registry_delete calls it.
CREATE FUNCTION public.mingla_connector_signin_disconnect(p_slug text) RETURNS jsonb
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
  IF u.auth_kind <> 'signin' THEN
    RAISE EXCEPTION 'key_only: This company tool uses a key. Use Remove key.' USING ERRCODE = '22023';
  END IF;
  IF u.signin_vault_id IS NOT NULL THEN
    DELETE FROM vault.secrets s WHERE s.id = u.signin_vault_id;
  END IF;
  UPDATE public.mingla_connector_upstreams
     SET signin_vault_id = NULL, enabled = false, signin_account = NULL, signin_connected_at = NULL,
         signin_connected_by = NULL, signin_expires_at = NULL, signin_issuer = NULL, signin_token_url = NULL,
         signin_resource = NULL, signin_lease_id = NULL, signin_lease_until = NULL, signin_reconnect_at = NULL,
         signin_generation = u.signin_generation + 1, updated_at = v_now, updated_by = v_email
   WHERE slug = u.slug;
  UPDATE public.mingla_connector_signin_states
     SET voided_at = v_now
   WHERE slug = u.slug AND completed_at IS NULL AND voided_at IS NULL;
  PERFORM public.crm_audit(v_email, 'connector.signin_disconnect', 'mingla_connector_upstream', u.slug,
    jsonb_build_object('slug', u.slug, 'was_connected', u.signin_vault_id IS NOT NULL));
  RETURN jsonb_build_object('slug', u.slug, 'connected', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_disconnect(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_disconnect(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_signin_disconnect(text) IS
  'Issue #4294. Owner only: end a company sign-in. Deletes its tokens from Supabase Vault and turns the tool off. Audited.';

REVOKE EXECUTE ON FUNCTION public.mingla_connector_registry_delete(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_registry_delete(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_registry_delete(text) IS
  'Issue #4294. Owner only: remove a company tool and delete its key or its sign-in from Supabase Vault.';

-- What the Connect button needs: the row's kind and address, and its sign-in
-- state. team-agent calls this first, as the owner, so only an owner can
-- start a sign-in. Never a token.
CREATE FUNCTION public.mingla_connector_signin_status(p_slug text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  u public.mingla_connector_upstreams;
BEGIN
  PERFORM public.mingla_connector_actor(true);
  SELECT * INTO u FROM public.mingla_connector_upstreams x WHERE x.slug = p_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That company tool is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('slug', u.slug, 'auth_kind', u.auth_kind, 'mcp_url', u.mcp_url,
                            'label', COALESCE(u.display_label, u.label),
                            'signin', public.mingla_connector_registry_row(u.slug)->'signin');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_status(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_signin_status(text) IS
  'Issue #4294. Owner only: a company tool''s kind, address and sign-in state (connected, account, when, by whom, reconnect needed). Never a token.';

-- Start a company sign-in. team-agent has found the tool's sign-in server and
-- made the state and the PKCE verifier; this checks the owner, the row and
-- the addresses again, and keeps a digest of the state with the sealed
-- verifier. Earlier starts for the row end. Audited.
CREATE FUNCTION public.mingla_connector_signin_begin(p_slug text, p_state_hash text, p_verifier_box text,
                                                     p_issuer text, p_token_url text, p_resource text,
                                                     p_redirect_uri text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c_bad constant text := 'invalid_request: This sign-in could not start. Try Connect again.';
  v_lim   jsonb := public.mingla_connector_signin_limits();
  v_email text;
  u       public.mingla_connector_upstreams;
  v_now   timestamptz := clock_timestamp();
  v_ends  timestamptz;
BEGIN
  v_email := public.mingla_connector_actor(true);
  SELECT * INTO u FROM public.mingla_connector_upstreams x WHERE x.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That company tool is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  IF u.auth_kind <> 'signin' THEN
    RAISE EXCEPTION 'key_only: This company tool uses a key. Use Set key.' USING ERRCODE = '22023';
  END IF;
  IF p_state_hash IS NULL OR p_state_hash !~ '^[0-9a-f]{64}$'
     OR p_verifier_box IS NULL OR p_verifier_box !~ '^[A-Za-z0-9_-]+$' OR char_length(p_verifier_box) NOT BETWEEN 40 AND 400
     OR p_redirect_uri IS DISTINCT FROM v_lim->>'redirect_uri'
     OR p_issuer IS NULL OR p_issuer !~ '^https://[a-z0-9.-]+(?::443)?(?:/[A-Za-z0-9._~/-]{0,200})?$'
     OR NOT public.mingla_connector_url_ok(p_token_url)
     OR NOT public.mingla_connector_signin_same_site(p_token_url, u.mcp_url)
     OR NOT public.mingla_connector_signin_same_site(p_issuer, u.mcp_url)
     OR NOT public.mingla_connector_url_ok(p_resource)
     OR NOT public.mingla_connector_signin_same_site(p_resource, u.mcp_url) THEN
    RAISE EXCEPTION '%', c_bad USING ERRCODE = '22023';
  END IF;

  UPDATE public.mingla_connector_signin_states
     SET voided_at = v_now
   WHERE slug = u.slug AND used_at IS NULL AND voided_at IS NULL;
  v_ends := v_now + make_interval(mins => (v_lim->>'state_minutes')::integer);
  INSERT INTO public.mingla_connector_signin_states (state_hash, slug, owner_email, verifier_box, issuer, token_url,
                                                     resource, redirect_uri, created_at, expires_at)
  VALUES (p_state_hash, u.slug, v_email, p_verifier_box, p_issuer, p_token_url, p_resource, p_redirect_uri, v_now,
          v_ends);
  PERFORM public.crm_audit(v_email, 'connector.signin_begin', 'mingla_connector_upstream', u.slug,
    jsonb_build_object('slug', u.slug, 'issuer_host', substring(p_issuer FROM '^https://([^/:]+)')));
  RETURN jsonb_build_object('ok', true, 'expires_at', v_ends, 'client_id', v_lim->>'client_id');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_begin(text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_begin(text, text, text, text, text, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.mingla_connector_signin_begin(text, text, text, text, text, text, text) IS
  'Issue #4294. Owner only: record the start of a company sign-in (a digest of the state and the sealed PKCE verifier). Single use, ten minutes. Audited.';

-- ---------------------------------------------------------------------------
-- 5. Company sign-in: server side (team-agent only).
-- ---------------------------------------------------------------------------

-- The callback's first step: the state, once. A used, ended, voided or
-- unknown state answers {"ok":false}.
CREATE FUNCTION public.mingla_connector_signin_claim(p_state_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  s       public.mingla_connector_signin_states;
  u       public.mingla_connector_upstreams;
  v_now   timestamptz := clock_timestamp();
BEGIN
  IF p_state_hash IS NULL OR p_state_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN '{"ok":false}'::jsonb;
  END IF;
  UPDATE public.mingla_connector_signin_states x
     SET used_at = v_now
   WHERE x.state_hash = p_state_hash AND x.used_at IS NULL AND x.voided_at IS NULL AND x.expires_at > v_now
  RETURNING * INTO s;
  IF NOT FOUND THEN
    RETURN '{"ok":false}'::jsonb;
  END IF;
  SELECT * INTO u FROM public.mingla_connector_upstreams x WHERE x.slug = s.slug;
  IF NOT FOUND OR u.auth_kind <> 'signin' THEN
    RETURN '{"ok":false}'::jsonb;
  END IF;
  RETURN jsonb_build_object('ok', true, 'slug', s.slug, 'label', COALESCE(u.display_label, u.label),
                            'verifier_box', s.verifier_box, 'issuer', s.issuer, 'token_url', s.token_url,
                            'resource', s.resource, 'redirect_uri', s.redirect_uri,
                            'client_id', public.mingla_connector_signin_limits()->>'client_id');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_claim(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_claim(text) TO service_role;

-- The callback's last step: the tokens go into Supabase Vault and the row
-- says who connected it and when. Only for a state claimed in the last five
-- minutes and not completed. Never answers a token. Audited.
CREATE FUNCTION public.mingla_connector_signin_complete(p_state_hash text, p_access text, p_refresh text,
                                                        p_expires_in integer, p_account text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_lim     jsonb := public.mingla_connector_signin_limits();
  s         public.mingla_connector_signin_states;
  u         public.mingla_connector_upstreams;
  v_now     timestamptz := clock_timestamp();
  v_bundle  text;
  v_id      uuid;
  v_ttl     integer;
  v_account text;
BEGIN
  SELECT * INTO s FROM public.mingla_connector_signin_states x
   WHERE x.state_hash = p_state_hash AND x.used_at IS NOT NULL AND x.completed_at IS NULL AND x.voided_at IS NULL
     AND x.used_at > v_now - make_interval(mins => (v_lim->>'claim_minutes')::integer)
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN '{"ok":false,"reason":"state"}'::jsonb;
  END IF;
  IF p_access IS NULL OR char_length(p_access) NOT BETWEEN 16 AND 8192 OR p_access ~ '[[:cntrl:][:space:]]'
     OR p_refresh IS NULL OR char_length(p_refresh) NOT BETWEEN 16 AND 8192 OR p_refresh ~ '[[:cntrl:][:space:]]' THEN
    RETURN '{"ok":false,"reason":"tokens"}'::jsonb;
  END IF;
  SELECT * INTO u FROM public.mingla_connector_upstreams x WHERE x.slug = s.slug FOR UPDATE;
  IF NOT FOUND OR u.auth_kind <> 'signin' THEN
    RETURN '{"ok":false,"reason":"state"}'::jsonb;
  END IF;
  v_ttl := LEAST(GREATEST(COALESCE(p_expires_in, 300), (v_lim->>'min_expires_seconds')::integer),
                 (v_lim->>'max_expires_seconds')::integer);
  v_account := NULLIF(left(btrim(regexp_replace(COALESCE(p_account, ''), '[[:cntrl:]<>]', '', 'g')), 120), '');
  v_bundle := jsonb_build_object('access_token', p_access, 'refresh_token', p_refresh)::text;

  IF u.signin_vault_id IS NOT NULL AND EXISTS (SELECT 1 FROM vault.secrets x WHERE x.id = u.signin_vault_id) THEN
    PERFORM vault.update_secret(u.signin_vault_id, v_bundle);
    v_id := u.signin_vault_id;
  ELSE
    v_id := vault.create_secret(v_bundle, 'mingla_connector_signin:' || u.slug || ':' || gen_random_uuid()::text,
                                'issue 4294 company sign-in');
  END IF;
  UPDATE public.mingla_connector_upstreams
     SET signin_vault_id = v_id, signin_issuer = s.issuer, signin_token_url = s.token_url,
         signin_resource = s.resource, signin_account = v_account, signin_connected_at = v_now,
         signin_connected_by = s.owner_email, signin_expires_at = v_now + make_interval(secs => v_ttl),
         signin_generation = u.signin_generation + 1, signin_lease_id = NULL, signin_lease_until = NULL,
         signin_reconnect_at = NULL, updated_at = v_now, updated_by = s.owner_email
   WHERE slug = u.slug;
  UPDATE public.mingla_connector_signin_states SET completed_at = v_now WHERE id = s.id;
  PERFORM public.crm_audit(s.owner_email, 'connector.signin_connected', 'mingla_connector_upstream', u.slug,
    jsonb_build_object('slug', u.slug, 'reconnect', u.signin_vault_id IS NOT NULL));
  RETURN jsonb_build_object('ok', true, 'slug', u.slug, 'label', COALESCE(u.display_label, u.label),
                            'account', v_account);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_complete(text, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_complete(text, text, text, integer, text) TO service_role;
COMMENT ON FUNCTION public.mingla_connector_signin_complete(text, text, text, integer, text) IS
  'Issue #4294. Internal: store a company sign-in''s tokens in Supabase Vault for a state claimed in the last five minutes. Never returns a token. Not client-executable.';

-- The access token for a call that call_begin allowed and that is running
-- now. Never the refresh token.
CREATE FUNCTION public.mingla_connector_signin_credential(p_call_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_slug   text;
  v_bundle text;
  u        public.mingla_connector_upstreams;
BEGIN
  v_slug := public.mingla_connector_signin_call_row(p_call_id);
  IF v_slug IS NULL THEN
    RETURN '{"ok":false}'::jsonb;
  END IF;
  SELECT * INTO u FROM public.mingla_connector_upstreams x WHERE x.slug = v_slug;
  SELECT d.decrypted_secret INTO v_bundle FROM vault.decrypted_secrets d WHERE d.id = u.signin_vault_id;
  IF v_bundle IS NULL OR (v_bundle::jsonb->>'access_token') IS NULL THEN
    RETURN '{"ok":false}'::jsonb;
  END IF;
  RETURN jsonb_build_object('ok', true, 'access_token', v_bundle::jsonb->>'access_token',
                            'expires_at', u.signin_expires_at, 'generation', u.signin_generation);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_credential(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_credential(uuid) TO service_role;
COMMENT ON FUNCTION public.mingla_connector_signin_credential(uuid) IS
  'Issue #4294. Internal: a company sign-in''s access token, for a call that is running now and was allowed by mingla_connector_call_begin. Not client-executable.';

-- Renewal, step 1: take the row's renewal lease. One renewer at a time per
-- row: a lease still held, or a generation that has moved on (someone else
-- renewed), raises PT409 and changes nothing.
CREATE FUNCTION public.mingla_connector_signin_refresh_begin(p_call_id uuid, p_generation integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_slug   text;
  v_bundle text;
  u        public.mingla_connector_upstreams;
  v_lease  uuid := gen_random_uuid();
  v_now    timestamptz := clock_timestamp();
BEGIN
  v_slug := public.mingla_connector_signin_call_row(p_call_id);
  IF v_slug IS NULL THEN
    RETURN '{"ok":false}'::jsonb;
  END IF;
  SELECT * INTO u FROM public.mingla_connector_upstreams x WHERE x.slug = v_slug FOR UPDATE;
  IF u.signin_generation IS DISTINCT FROM p_generation THEN
    RAISE EXCEPTION 'renewed: This company sign-in was just renewed. Read it again.' USING ERRCODE = 'PT409';
  END IF;
  IF u.signin_lease_until IS NOT NULL AND u.signin_lease_until > v_now THEN
    RAISE EXCEPTION 'renewing: This company sign-in is being renewed. Try again in a moment.' USING ERRCODE = 'PT409';
  END IF;
  SELECT d.decrypted_secret INTO v_bundle FROM vault.decrypted_secrets d WHERE d.id = u.signin_vault_id;
  IF v_bundle IS NULL OR (v_bundle::jsonb->>'refresh_token') IS NULL THEN
    RETURN '{"ok":false}'::jsonb;
  END IF;
  UPDATE public.mingla_connector_upstreams
     SET signin_lease_id = v_lease,
         signin_lease_until = v_now + make_interval(secs => (public.mingla_connector_signin_limits()->>'lease_seconds')::integer)
   WHERE slug = u.slug;
  RETURN jsonb_build_object('ok', true, 'lease', v_lease, 'refresh_token', v_bundle::jsonb->>'refresh_token',
                            'token_url', u.signin_token_url, 'resource', u.signin_resource,
                            'client_id', public.mingla_connector_signin_limits()->>'client_id');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_refresh_begin(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_refresh_begin(uuid, integer) TO service_role;
COMMENT ON FUNCTION public.mingla_connector_signin_refresh_begin(uuid, integer) IS
  'Issue #4294. Internal: take the one renewal lease of a company sign-in for a running allowed call. A held lease or a moved generation raises PT409. Not client-executable.';

-- Renewal, step 2: store the renewed tokens. Only with the current lease,
-- under the row lock; anything else raises PT409 and changes nothing.
CREATE FUNCTION public.mingla_connector_signin_refresh_store(p_call_id uuid, p_lease uuid, p_access text,
                                                             p_refresh text, p_expires_in integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_lim  jsonb := public.mingla_connector_signin_limits();
  v_slug text;
  u      public.mingla_connector_upstreams;
  v_now  timestamptz := clock_timestamp();
  v_ttl  integer;
BEGIN
  v_slug := public.mingla_connector_signin_call_row(p_call_id);
  IF v_slug IS NULL THEN
    RETURN '{"ok":false}'::jsonb;
  END IF;
  SELECT * INTO u FROM public.mingla_connector_upstreams x WHERE x.slug = v_slug FOR UPDATE;
  IF p_lease IS NULL OR u.signin_lease_id IS DISTINCT FROM p_lease OR u.signin_lease_until <= v_now THEN
    RAISE EXCEPTION 'lease_lost: Another renewal of this company sign-in got there first.' USING ERRCODE = 'PT409';
  END IF;
  IF p_access IS NULL OR char_length(p_access) NOT BETWEEN 16 AND 8192 OR p_access ~ '[[:cntrl:][:space:]]'
     OR p_refresh IS NULL OR char_length(p_refresh) NOT BETWEEN 16 AND 8192 OR p_refresh ~ '[[:cntrl:][:space:]]' THEN
    UPDATE public.mingla_connector_upstreams SET signin_lease_id = NULL, signin_lease_until = NULL WHERE slug = u.slug;
    RETURN '{"ok":false}'::jsonb;
  END IF;
  v_ttl := LEAST(GREATEST(COALESCE(p_expires_in, 300), (v_lim->>'min_expires_seconds')::integer),
                 (v_lim->>'max_expires_seconds')::integer);
  PERFORM vault.update_secret(u.signin_vault_id,
                              jsonb_build_object('access_token', p_access, 'refresh_token', p_refresh)::text);
  UPDATE public.mingla_connector_upstreams
     SET signin_expires_at = v_now + make_interval(secs => v_ttl), signin_generation = u.signin_generation + 1,
         signin_lease_id = NULL, signin_lease_until = NULL
   WHERE slug = u.slug;
  RETURN jsonb_build_object('ok', true, 'expires_at', v_now + make_interval(secs => v_ttl),
                            'generation', u.signin_generation + 1);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_refresh_store(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_refresh_store(uuid, uuid, text, text, integer) TO service_role;
COMMENT ON FUNCTION public.mingla_connector_signin_refresh_store(uuid, uuid, text, text, integer) IS
  'Issue #4294. Internal: store renewed company sign-in tokens in Supabase Vault, only with the current renewal lease (else PT409). Not client-executable.';

-- Renewal did not work. 'invalid_grant': the sign-in is no longer accepted,
-- the row shows Reconnect needed and calls are refused with the key-refused
-- words; audited. 'unavailable': the lease is let go, nothing else changes.
CREATE FUNCTION public.mingla_connector_signin_refresh_fail(p_call_id uuid, p_lease uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_slug text;
  u      public.mingla_connector_upstreams;
  v_now  timestamptz := clock_timestamp();
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('invalid_grant', 'unavailable') THEN
    RAISE EXCEPTION 'invalid_reason: invalid_grant or unavailable.' USING ERRCODE = '22023';
  END IF;
  v_slug := public.mingla_connector_signin_call_row(p_call_id);
  IF v_slug IS NULL THEN
    RETURN '{"ok":false}'::jsonb;
  END IF;
  SELECT * INTO u FROM public.mingla_connector_upstreams x WHERE x.slug = v_slug FOR UPDATE;
  IF p_lease IS NULL OR u.signin_lease_id IS DISTINCT FROM p_lease THEN
    RAISE EXCEPTION 'lease_lost: Another renewal of this company sign-in got there first.' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.mingla_connector_upstreams
     SET signin_lease_id = NULL, signin_lease_until = NULL,
         signin_reconnect_at = CASE WHEN p_reason = 'invalid_grant' THEN v_now ELSE signin_reconnect_at END
   WHERE slug = u.slug;
  IF p_reason = 'invalid_grant' THEN
    PERFORM public.crm_audit('system', 'connector.signin_reconnect_needed', 'mingla_connector_upstream', u.slug,
      jsonb_build_object('slug', u.slug));
  END IF;
  RETURN jsonb_build_object('ok', true, 'reconnect_needed', p_reason = 'invalid_grant');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_signin_refresh_fail(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_signin_refresh_fail(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The proxy's steps learn about sign-in rows, hidden words and the cap.
-- ---------------------------------------------------------------------------

-- Which company tools this key's person may see right now. A sign-in row
-- counts when it is connected and does not need a reconnect.
CREATE OR REPLACE FUNCTION public.mingla_connector_upstreams_for(p_key_hash text) RETURNS jsonb
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
    SELECT jsonb_agg(jsonb_build_object('slug', u.slug, 'label', COALESCE(u.display_label, u.label),
             'tool_allowlist', to_jsonb(u.tool_allowlist), 'hide_words', to_jsonb(u.hide_words),
             'version', md5(u.updated_at::text || '|' || COALESCE(u.key_updated_at::text, '') || '|'
                            || COALESCE(u.signin_connected_at::text, ''))) ORDER BY u.slug)
      FROM public.mingla_connector_upstreams u
     WHERE u.enabled AND v_role = ANY (u.allowed_roles) AND cardinality(u.tool_allowlist) > 0
       AND ((u.auth_kind = 'key' AND u.vault_secret_id IS NOT NULL)
            OR (u.auth_kind = 'signin' AND u.signin_vault_id IS NOT NULL AND u.signin_reconnect_at IS NULL))),
    '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_upstreams_for(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_upstreams_for(text) TO service_role;

-- Before any request to a company tool: who is asking, may they, under the
-- limits, and the call-log row. New: a sign-in row needing a reconnect is
-- refused with upstream_key_rejected; a generation tool over the person's
-- daily cap is refused with generation_limit; the answer names the kind,
-- the display label and the words to hide.
CREATE OR REPLACE FUNCTION public.mingla_connector_call_begin(p_key_hash text, p_slug text, p_tool text, p_client text) RETURNS jsonb
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
  v_day    timestamptz := date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
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
  IF NOT FOUND OR NOT u.enabled
     OR (u.auth_kind = 'key' AND u.vault_secret_id IS NULL)
     OR (u.auth_kind = 'signin' AND u.signin_vault_id IS NULL)
     OR NOT COALESCE(v_role = ANY (u.allowed_roles), false)
     OR NOT COALESCE(public.admin_team_can('crm'), false)
     OR v_tool = 'invalid'
     OR (v_tool <> 'tools/list' AND NOT (v_tool = ANY (u.tool_allowlist))) THEN
    v_token := 'not_allowed';
  ELSIF u.auth_kind = 'signin' AND u.signin_reconnect_at IS NOT NULL THEN
    v_token := 'upstream_key_rejected';
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

  -- The daily generation cap (I-4294-12): only for an otherwise allowed
  -- call to a tool on the row's generation list. Calls refused before any
  -- request do not count.
  IF v_token IS NULL AND v_tool = ANY (u.generation_tools) THEN
    SELECT count(*) INTO v_n FROM public.mingla_connector_calls c
     WHERE c.owner_email = v_email AND c.upstream = v_slug AND c.started_at >= v_day
       AND c.tool = ANY (u.generation_tools)
       AND c.outcome NOT IN ('not_allowed', 'rate_limited', 'generation_limit', 'upstream_key_rejected');
    IF v_n >= u.daily_generation_cap THEN
      v_token := 'generation_limit';
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
                            'version', md5(u.updated_at::text || '|' || COALESCE(u.key_updated_at::text, '') || '|'
                                           || COALESCE(u.signin_connected_at::text, '')),
                            'auth_kind', u.auth_kind, 'label', COALESCE(u.display_label, u.label),
                            'hide_words', to_jsonb(u.hide_words));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_call_begin(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_call_begin(text, text, text, text) TO service_role;

-- Daily clean-up, now also ended sign-in starts.
CREATE OR REPLACE FUNCTION public.mingla_connector_housekeeping() RETURNS integer
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
  DELETE FROM public.mingla_connector_signin_states s WHERE s.created_at < clock_timestamp() - interval '1 day';
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mingla_connector_housekeeping() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_connector_housekeeping() TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Self-check for every mingla_connector_ function and table. Supersedes
--    the one in 20280425004294 (the suites re-run this block).
-- ---------------------------------------------------------------------------
DO $c4294s$
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
    'public.mingla_connector_calls_recent(integer)',
    'public.mingla_connector_signin_status(text)',
    'public.mingla_connector_signin_begin(text,text,text,text,text,text,text)',
    'public.mingla_connector_signin_disconnect(text)'
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
    'public.mingla_connector_housekeeping()',
    'public.mingla_connector_signin_limits()',
    'public.mingla_connector_signin_call_row(uuid)',
    'public.mingla_connector_signin_same_site(text,text)',
    'public.mingla_connector_signin_claim(text)',
    'public.mingla_connector_signin_complete(text,text,text,integer,text)',
    'public.mingla_connector_signin_credential(uuid)',
    'public.mingla_connector_signin_refresh_begin(uuid,integer)',
    'public.mingla_connector_signin_refresh_store(uuid,uuid,text,text,integer)',
    'public.mingla_connector_signin_refresh_fail(uuid,uuid,text)'
  ];
  c_tables text[] := ARRAY['public.mingla_connector_oauth_clients', 'public.mingla_connector_oauth_codes',
                           'public.mingla_connector_oauth_grants', 'public.mingla_connector_oauth_spent_refresh',
                           'public.mingla_connector_upstreams', 'public.mingla_connector_calls',
                           'public.mingla_connector_signin_states'];
  v_fn   text;
  v_tbl  text;
  v_role text;
  v_priv text;
  v_n    integer;
  v_list text;
BEGIN
  FOREACH v_fn IN ARRAY c_client || c_internal LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4294 self-check: anon can call %', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
               WHERE p.oid = v_fn::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'issue 4294 self-check: PUBLIC can call %', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4294 self-check: service_role cannot call %', v_fn;
    END IF;
    IF NOT COALESCE((SELECT 'search_path=""' = ANY (p.proconfig) FROM pg_catalog.pg_proc p
                      WHERE p.oid = v_fn::regprocedure), false) THEN
      RAISE EXCEPTION 'issue 4294 self-check: % does not pin an empty search path', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY c_client LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4294 self-check: authenticated cannot call %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY c_internal LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4294 self-check: authenticated can call the internal %', v_fn;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'mingla\_connector\_%'
    AND NOT (p.oid = ANY (SELECT x::regprocedure::oid FROM unnest(c_client || c_internal) AS x));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue 4294 self-check: % mingla_connector_ function(s) are not in the checked list', v_n;
  END IF;

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

  -- I-4294-2 / I-4294-9: no column that could hold a key or a token; no
  -- client role reaches Vault.
  IF EXISTS (SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema = 'public'
                AND c.table_name IN ('mingla_connector_upstreams', 'mingla_connector_signin_states')
                AND c.column_name ~* '(^|_)(key|secret|token|password|api_key|verifier|refresh|access)$') THEN
    RAISE EXCEPTION 'issue 4294 self-check: a company tools table has a column that could hold a key or a token';
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
  SELECT COALESCE(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_list
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'mingla\_connector\_%'
    AND p.prosrc ~* '(vault\.(create_secret|update_secret)|delete\s+from\s+vault\.)';
  IF v_list IS DISTINCT FROM 'mingla_connector_clear_key,mingla_connector_set_key,mingla_connector_signin_complete,mingla_connector_signin_disconnect,mingla_connector_signin_refresh_store' THEN
    RAISE EXCEPTION 'issue 4294 self-check: the functions that write Vault are [%]', v_list;
  END IF;
  SELECT COALESCE(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_list
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'mingla\_connector\_%' AND p.prosrc ~* 'decrypted_secrets';
  IF v_list IS DISTINCT FROM 'mingla_connector_signin_credential,mingla_connector_signin_refresh_begin,mingla_connector_upstream_key' THEN
    RAISE EXCEPTION 'issue 4294 self-check: the functions that read a decrypted key or token are [%]', v_list;
  END IF;
  -- No statement is built from text, nothing reaches outside the database.
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p
  WHERE p.oid = ANY (SELECT x::regprocedure::oid FROM unnest(c_client || c_internal) AS x)
    AND (p.prosrc ~* '\mexecute\M' OR p.prosrc ~* 'format\s*\(' OR p.prosrc ~* 'net\.http|http_post|http_get|pg_net|dblink');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue 4294 self-check: % function(s) build a statement from text or reach outside the database', v_n;
  END IF;
  -- A renewal clash is PT409, never a serialization failure.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'mingla\_connector\_signin\_%' AND p.prosrc ~ '40001') THEN
    RAISE EXCEPTION 'issue 4294 self-check: a sign-in function raises 40001';
  END IF;
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'mingla\_connector\_%'
    AND p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(only\s+)?(public\.)?team_agent_(keys|calls|setup_codes)\M';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue 4294 self-check: a mingla_connector_ function writes a team_agent_ table';
  END IF;
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = 'public.team_agent_keys'::regclass AND c.relname = 'team_agent_keys_one_active'
    AND i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL AND i.indnatts = 3;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'issue 4294 self-check: the one-active-key index is missing or not per kind';
  END IF;
  IF (SELECT count(*) FROM public.mingla_connector_oauth_clients) <> 2 THEN
    RAISE EXCEPTION 'issue 4294 self-check: expected exactly the two Claude apps';
  END IF;
  -- Company sign-in rows: the studio row is seeded and off, and no sign-in
  -- row holds a key.
  IF NOT EXISTS (SELECT 1 FROM public.mingla_connector_upstreams u WHERE u.slug = 'studio' AND u.auth_kind = 'signin') THEN
    RAISE EXCEPTION 'issue 4294 self-check: the studio row is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mingla_connector_upstreams u
              WHERE u.auth_kind = 'signin' AND u.vault_secret_id IS NOT NULL) THEN
    RAISE EXCEPTION 'issue 4294 self-check: a sign-in company tool holds a key';
  END IF;
END;
$c4294s$;

-- The migration leaves every company tool off.
DO $off4294$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mingla_connector_upstreams WHERE enabled AND slug = 'studio') THEN
    RAISE EXCEPTION 'issue 4294 self-check: the studio row is on after the migration';
  END IF;
END;
$off4294$;

COMMIT;
