-- Issue #4294 — implementor suite for the one Mingla connector (PostgreSQL 17).
--
-- Proves, on the fully replayed schema:
--   M-1  keys have a kind; one active key per person per agent per kind; a
--        personal key has no end
--   M-2  approving a Claude app: who may, which app and redirect, PKCE
--        challenge shape, resource; the code is shown once, kept as a digest
--   M-3  code + challenge for tokens: a one-hour key of the app's kind that
--        works through the gateway's resolver; a wrong challenge burns the
--        code; a second use of a code ends the grant
--   M-4  refresh rotates: old key dead, new key works, a spent refresh
--        token used again ends the grant
--   M-5  a sign-in key stops at its end (no write), after Disconnect, and
--        after the person's access is removed; a personal key made before
--        sign-in keeps working through all of it
--   M-6  My agent lists personal keys only; Claude app connections list
--   M-7  company tools are owner only; a key or Vault field cannot be saved;
--        the address rules
--   M-8  a key is set into Vault and can never be read back by a client:
--        no answer, refusal, audit row, registry read or table row holds
--        any 8-character slice of it
--   M-9  the proxy steps: which tools a role sees, begin, the one key read,
--        finish; default deny; one call-log row per request; limits
--   M-10 the migration's self-check passes again
--   M-11 hardening: a host whose last label is a number is refused;
--        approve applies the one-account rule; the per-person limit
--        comes before a refused call is logged
--
-- Invariants proved here (declared in the migration header):
--   I-4294-1 (M-1, M-3, M-4, M-5), I-4294-2 (M-8), I-4294-3 (M-9),
--   I-4294-5 (M-9).
--
-- One transaction, rolled back. Never run on production. Runs as the
-- image's admin role from the repository root (M-10 reads the migration).
-- Also exercises I-4294-1 (declared in supabase/functions/team-agent/__tests__/oauth.issue4294.implementor.happy.test.ts).
-- MINGLA-INVARIANT: I-4294-2 | issue #4294 | Company keys live only in Supabase Vault, are written only by the owner-gated set and clear functions, are read only for a running authorised call, and never appear in any answer, log, audit row or admin read.
-- Also exercises I-4294-3 (declared in supabase/functions/team-agent/__tests__/proxy.issue4294.implementor.happy.test.ts).
-- Also exercises I-4294-5 (declared in supabase/functions/team-agent/__tests__/proxy.issue4294.implementor.happy.test.ts).

\set ON_ERROR_STOP on
\set t4294_selfcheck `sed -n '/^DO \$c4294\$/,/^\$c4294\$;/p' supabase/migrations/20280425004294_issue_4294_mingla_connector.sql`

begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  identity_data jsonb
);

create temp table t4294_src (k text primary key, sql text) on commit drop;
insert into t4294_src values ('selfcheck', :'t4294_selfcheck');

create temp table t4294_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t4294_people (who, id, email) values
  ('owner',   '42940000-0000-4000-a000-000000000001', 'issue4294-owner@test.local'),
  ('admin',   '42940000-0000-4000-a000-000000000002', 'issue4294-admin@test.local'),
  ('growth',  '42940000-0000-4000-a000-000000000003', 'issue4294-growth@test.local'),
  ('leaver',  '42940000-0000-4000-a000-000000000004', 'issue4294-leaver@test.local'),
  ('nobody',  '42940000-0000-4000-a000-000000000005', 'issue4294-nobody@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t4294_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue4294-owner@test.local', 'owner', 'active', now()),
  ('issue4294-admin@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
select email, 'growth', 'active', now() from t4294_people where who in ('growth', 'leaver');

create temp table t4294_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t4294_ids (k text primary key, v text) on commit drop;
-- Every answer a client or the edge was given, for the read-back sweep.
create temp table t4294_seen (seq serial primary key, src text, body text) on commit drop;

create function pg_temp.t4294_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from t4294_people where who = p_who;
    -- A browser session comes after any agent request has ended: request
    -- rows written so far look like rows of an earlier transaction.
    update public.team_agent_calls set xact_id = '3'::xid8 where xact_id <> '3'::xid8;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.email', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif p_who = 'service' then
      set local role service_role;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.email', '', true);
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
    perform set_config('request.jwt.claim.role', '', true);
    execute p_sql into v_out;
    reset role;
  exception when others then
    reset role;
    v_out := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  insert into t4294_seen (src, body) values (p_who || ': ' || left(p_sql, 60), coalesce(v_out, ''));
  return v_out;
end;
$fn$;

create function pg_temp.t4294_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t4294_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 300), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t4294_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t4294_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 300), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t4294_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.t4294_id(p_k text) returns text
language sql as $fn$ select v from t4294_ids where k = p_k $fn$;

create function pg_temp.t4294_keep(p_k text, p_v text) returns void
language sql as $fn$
  insert into t4294_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;

-- The PKCE challenge of a verifier, as the edge computes it.
create function pg_temp.t4294_challenge(p_verifier text) returns text
language sql as $fn$
  select translate(rtrim(encode(sha256(convert_to(p_verifier, 'UTF8')), 'base64'), '='), '+/', '-_')
$fn$;

-- Approve as a person; keeps the code under p_label.
create function pg_temp.t4294_approve(p_who text, p_client text, p_redirect text, p_verifier text, p_label text)
returns text
language plpgsql as $fn$
declare
  v text;
begin
  v := pg_temp.t4294_as(p_who, format('select public.mingla_connector_oauth_approve(%L, %L, %L, %L)::text',
         p_client, p_redirect, pg_temp.t4294_challenge(p_verifier), null));
  if v not like 'ERR:%' then
    perform pg_temp.t4294_keep(p_label, v::jsonb ->> 'code');
  end if;
  return v;
end;
$fn$;

-- The token exchange the edge makes; keeps the tokens under p_label.
create function pg_temp.t4294_exchange(p_code_label text, p_client text, p_redirect text, p_verifier text, p_label text)
returns text
language plpgsql as $fn$
declare
  v text;
begin
  v := pg_temp.t4294_as('service', format('select public.mingla_connector_oauth_exchange(%L, %L, %L, %L, %L)::text',
         pg_temp.t4294_digest(pg_temp.t4294_id(p_code_label)), p_client, p_redirect,
         pg_temp.t4294_challenge(p_verifier), null));
  if v not like 'ERR:%' and v::jsonb ? 'access_token' then
    perform pg_temp.t4294_keep(p_label || '.access', v::jsonb ->> 'access_token');
    perform pg_temp.t4294_keep(p_label || '.refresh', v::jsonb ->> 'refresh_token');
  end if;
  return v;
end;
$fn$;

create function pg_temp.t4294_refresh(p_label text, p_client text, p_new_label text) returns text
language plpgsql as $fn$
declare
  v text;
begin
  v := pg_temp.t4294_as('service', format('select public.mingla_connector_oauth_refresh(%L, %L)::text',
         pg_temp.t4294_digest(pg_temp.t4294_id(p_label || '.refresh')), p_client));
  if v not like 'ERR:%' and v::jsonb ? 'access_token' then
    perform pg_temp.t4294_keep(p_new_label || '.access', v::jsonb ->> 'access_token');
    perform pg_temp.t4294_keep(p_new_label || '.refresh', v::jsonb ->> 'refresh_token');
  end if;
  return v;
end;
$fn$;

-- What the resolver says about a token: "ok/<role>" or "invalid".
create function pg_temp.t4294_who(p_token text) returns text
language plpgsql as $fn$
declare
  v text;
begin
  v := pg_temp.t4294_as('service', format('select public.team_agent_resolve(%L)::text', pg_temp.t4294_digest(p_token)));
  if v like 'ERR:%' then return v; end if;
  return case when v::jsonb ->> 'auth' = 'ok' then 'ok/' || (v::jsonb ->> 'role') else 'invalid' end;
end;
$fn$;

-- Any 8-character slice of p_secret inside p_text?
create function pg_temp.t4294_leaks(p_text text, p_secret text) returns boolean
language sql as $fn$
  select exists (select 1 from generate_series(1, char_length(p_secret) - 7) i
                  where strpos(coalesce(p_text, ''), substr(p_secret, i, 8)) > 0)
$fn$;

\set app_client 'https://claude.ai/oauth/mcp-oauth-client-metadata'
\set app_redirect 'https://claude.ai/api/mcp/auth_callback'
\set code_client 'https://claude.ai/oauth/claude-code-client-metadata'
create temp table t4294_const (k text primary key, v text) on commit drop;
insert into t4294_const values ('app', :'app_client'), ('app_redirect', :'app_redirect'), ('code', :'code_client'),
  ('verifier', 'issue4294-verifier-0123456789-abcdefghijklmnopqrstuvwxyz'),
  ('verifier2', 'issue4294-other-verifier-0123456789-ABCDEFGHIJKLMNOPQRSTUV'),
  ('marker', 'MRK4294-zq8Wv1Lp0Xc7Nb3Mf6Hs2Jd9Kg5Tr4Ye'),
  ('marker2', 'MRK4294B-uu71Qa3Zx9Pl2Ow8Ie6Ry5Tk4Mj0Hg');
create function pg_temp.t4294_c(p text) returns text language sql as $fn$ select v from t4294_const where k = p $fn$;

-- A personal key made before any sign-in.
select pg_temp.t4294_keep('growth.personal',
  pg_temp.t4294_as('growth', 'select public.team_agent_key_create(''claude'')::text')::jsonb ->> 'key');

-- ---------------------------------------------------------------------------
-- M-1 keys have a kind.
-- ---------------------------------------------------------------------------
do $m1$
begin
  perform pg_temp.t4294_check('M-1', 'a key made from the page is personal with no end',
    (select kind || '/' || coalesce(expires_at::text, 'none') from public.team_agent_keys
      where key_hash = pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal'))), 'personal/none');
  perform pg_temp.t4294_check('M-1', 'the personal key works', pg_temp.t4294_who(pg_temp.t4294_id('growth.personal')), 'ok/growth');
  perform pg_temp.t4294_check('M-1', 'the one-active index is per kind',
    (select pg_get_indexdef(i.indexrelid) from pg_index i join pg_class c on c.oid = i.indexrelid
      where c.relname = 'team_agent_keys_one_active'),
    'CREATE UNIQUE INDEX team_agent_keys_one_active ON public.team_agent_keys USING btree (owner_email, agent, kind) WHERE (revoked_at IS NULL)');
  perform pg_temp.t4294_like('M-1', 'a sign-in kind needs an end',
    pg_temp.t4294_as('service', $q$insert into public.team_agent_keys (owner_email, agent, key_prefix, key_hash, kind)
       values ('issue4294-growth@test.local', 'claude', 'mgla_c_abcdefg', repeat('a', 64), 'claude_app') returning 'x'$q$),
    'ERR:23514:%');
end;
$m1$;

-- ---------------------------------------------------------------------------
-- M-2 approving.
-- ---------------------------------------------------------------------------
do $m2$
declare
  v text;
begin
  v := pg_temp.t4294_approve('growth', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'code1');
  perform pg_temp.t4294_like('M-2', 'a team member approves Claude and gets a one-time code', v::jsonb ->> 'code', 'mglo\_%');
  perform pg_temp.t4294_check('M-2', 'the code is kept as a digest only',
    (select count(*)::text from public.mingla_connector_oauth_codes
      where code_hash = pg_temp.t4294_digest(pg_temp.t4294_id('code1')) and owner_email = 'issue4294-growth@test.local'), '1');
  perform pg_temp.t4294_check('M-2', 'no code is stored readable',
    (select count(*)::text from public.mingla_connector_oauth_codes c where row_to_json(c)::text like '%mglo\_%'), '0');
  perform pg_temp.t4294_like('M-2', 'Claude Code with a loopback redirect is approved',
    pg_temp.t4294_approve('growth', pg_temp.t4294_c('code'), 'http://127.0.0.1:53682/callback', pg_temp.t4294_c('verifier'), 'codecc'),
    '{"code": "mglo_%');
  perform pg_temp.t4294_like('M-2', 'anon cannot approve',
    pg_temp.t4294_approve('anon', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'x'), 'ERR:42501:%');
  perform pg_temp.t4294_like('M-2', 'a signed-in person with no team role cannot approve',
    pg_temp.t4294_approve('nobody', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'x'), 'ERR:42501:%');
  perform pg_temp.t4294_like('M-2', 'an unknown app is refused',
    pg_temp.t4294_approve('growth', 'https://evil.example/client', pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'x'),
    'ERR:22023:invalid_request:%');
  perform pg_temp.t4294_like('M-2', 'another redirect for Claude is refused',
    pg_temp.t4294_approve('growth', pg_temp.t4294_c('app'), 'https://claude.ai/api/mcp/auth_callback/x', pg_temp.t4294_c('verifier'), 'x'),
    'ERR:22023:%');
  perform pg_temp.t4294_like('M-2', 'a loopback port under 1024 is refused',
    pg_temp.t4294_approve('growth', pg_temp.t4294_c('code'), 'http://localhost:80/callback', pg_temp.t4294_c('verifier'), 'x'),
    'ERR:22023:%');
  perform pg_temp.t4294_like('M-2', 'a challenge of the wrong shape is refused',
    pg_temp.t4294_as('growth', format('select public.mingla_connector_oauth_approve(%L, %L, %L, null)::text',
      pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), 'short')), 'ERR:22023:%');
  perform pg_temp.t4294_like('M-2', 'another resource is refused',
    pg_temp.t4294_as('growth', format('select public.mingla_connector_oauth_approve(%L, %L, %L, %L)::text',
      pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_challenge(pg_temp.t4294_c('verifier')),
      'https://evil.example/mcp')), 'ERR:22023:%');
  perform pg_temp.t4294_like('M-2', 'the connector address as resource is accepted',
    pg_temp.t4294_as('growth', format('select public.mingla_connector_oauth_approve(%L, %L, %L, %L)::text',
      pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_challenge(pg_temp.t4294_c('verifier')),
      'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent')), '{"code": "mglo_%');
  perform pg_temp.t4294_like('M-2', 'the exchange is not client-callable',
    pg_temp.t4294_as('growth', 'select public.mingla_connector_oauth_exchange(''a'',''b'',''c'',''d'',null)::text'), 'ERR:42501:%');
end;
$m2$;

-- ---------------------------------------------------------------------------
-- M-3 exchange.
-- ---------------------------------------------------------------------------
do $m3$
declare
  v text;
begin
  -- A wrong verifier: refused, and the code is used up.
  perform pg_temp.t4294_approve('growth', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'code_bad');
  perform pg_temp.t4294_check('M-3', 'a wrong verifier is invalid_grant',
    pg_temp.t4294_exchange('code_bad', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier2'), 'x'),
    '{"error": "invalid_grant"}');
  perform pg_temp.t4294_check('M-3', 'after a wrong verifier the right one no longer works',
    pg_temp.t4294_exchange('code_bad', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'x'),
    '{"error": "invalid_grant"}');
  perform pg_temp.t4294_check('M-3', 'another client id is invalid_grant',
    pg_temp.t4294_exchange('codecc', pg_temp.t4294_c('app'), 'http://127.0.0.1:53682/callback', pg_temp.t4294_c('verifier'), 'x'),
    '{"error": "invalid_grant"}');

  v := pg_temp.t4294_exchange('code1', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'g1');
  perform pg_temp.t4294_check('M-3', 'the access token is a team-agent key',
    (pg_temp.t4294_id('g1.access') ~ '^mgla_c_[A-Za-z0-9_-]{43}$')::text, 'true');
  perform pg_temp.t4294_check('M-3', 'the refresh token has its own prefix',
    (pg_temp.t4294_id('g1.refresh') ~ '^mglr_[A-Za-z0-9_-]{43}$')::text, 'true');
  perform pg_temp.t4294_check('M-3', 'it lasts about an hour',
    ((v::jsonb ->> 'expires_in')::int between 3590 and 3600)::text, 'true');
  perform pg_temp.t4294_check('M-3', 'the key is of the app''s kind and ends',
    (select kind || '/' || (expires_at between now() + interval '59 minutes' and now() + interval '61 minutes')::text
       from public.team_agent_keys where key_hash = pg_temp.t4294_digest(pg_temp.t4294_id('g1.access'))), 'claude_app/true');
  perform pg_temp.t4294_check('M-3', 'the sign-in token maps to the person''s role', pg_temp.t4294_who(pg_temp.t4294_id('g1.access')), 'ok/growth');
  perform pg_temp.t4294_check('M-3', 'the personal key made before is still on', pg_temp.t4294_who(pg_temp.t4294_id('growth.personal')), 'ok/growth');
  perform pg_temp.t4294_check('M-3', 'the gateway answers the sign-in token as the person',
    pg_temp.t4294_as('service', format('select (public.team_agent_call(%L, %L, %L::jsonb, %L)->''me''->>''role'')',
      pg_temp.t4294_digest(pg_temp.t4294_id('g1.access')), 'get_started', '{}', 'issue4294')), 'growth');
  perform pg_temp.t4294_check('M-3', 'using the token stamps when the connection was last used',
    (select (last_used_at is not null)::text from public.mingla_connector_oauth_grants
      where current_key_id = (select id from public.team_agent_keys where key_hash = pg_temp.t4294_digest(pg_temp.t4294_id('g1.access')))),
    'true');
  perform pg_temp.t4294_check('M-3', 'no token is stored readable',
    (select count(*)::text from public.mingla_connector_oauth_grants g where row_to_json(g)::text ~ 'mgl[ar]_'), '0');

  -- The same code a second time ends the grant it made.
  perform pg_temp.t4294_check('M-3', 'a code works once',
    pg_temp.t4294_exchange('code1', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'x'),
    '{"error": "invalid_grant"}');
  perform pg_temp.t4294_check('M-3', 'its second use ended the grant',
    (select revoke_reason from public.mingla_connector_oauth_grants g
       join public.mingla_connector_oauth_codes c on c.grant_id = g.id
      where c.code_hash = pg_temp.t4294_digest(pg_temp.t4294_id('code1'))), 'reuse');
  perform pg_temp.t4294_check('M-3', 'and its token stopped working', pg_temp.t4294_who(pg_temp.t4294_id('g1.access')), 'invalid');
  perform pg_temp.t4294_check('M-3', 'the personal key is untouched', pg_temp.t4294_who(pg_temp.t4294_id('growth.personal')), 'ok/growth');
end;
$m3$;

-- ---------------------------------------------------------------------------
-- M-4 refresh.
-- ---------------------------------------------------------------------------
do $m4$
begin
  perform pg_temp.t4294_approve('growth', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'code2');
  perform pg_temp.t4294_exchange('code2', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'g2');
  perform pg_temp.t4294_check('M-4', 'a fresh grant works', pg_temp.t4294_who(pg_temp.t4294_id('g2.access')), 'ok/growth');
  perform pg_temp.t4294_like('M-4', 'a refresh gives new tokens',
    pg_temp.t4294_refresh('g2', pg_temp.t4294_c('app'), 'g2b'), '{"kind": "claude_app", "expires_in": %');
  perform pg_temp.t4294_check('M-4', 'the refresh token rotated',
    (pg_temp.t4294_id('g2.refresh') <> pg_temp.t4294_id('g2b.refresh'))::text, 'true');
  perform pg_temp.t4294_check('M-4', 'the old access token is dead', pg_temp.t4294_who(pg_temp.t4294_id('g2.access')), 'invalid');
  perform pg_temp.t4294_check('M-4', 'the new access token works', pg_temp.t4294_who(pg_temp.t4294_id('g2b.access')), 'ok/growth');
  perform pg_temp.t4294_check('M-4', 'the personal key still works', pg_temp.t4294_who(pg_temp.t4294_id('growth.personal')), 'ok/growth');
  perform pg_temp.t4294_check('M-4', 'a refresh for another client is refused',
    pg_temp.t4294_refresh('g2b', pg_temp.t4294_c('code'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.t4294_check('M-4', 'the spent refresh token used again is refused',
    pg_temp.t4294_refresh('g2', pg_temp.t4294_c('app'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.t4294_check('M-4', 'that reuse ended the grant',
    (select revoke_reason from public.mingla_connector_oauth_grants
      where current_key_id = (select id from public.team_agent_keys where key_hash = pg_temp.t4294_digest(pg_temp.t4294_id('g2b.access')))),
    'reuse');
  perform pg_temp.t4294_check('M-4', 'so the newest token is dead too', pg_temp.t4294_who(pg_temp.t4294_id('g2b.access')), 'invalid');
  perform pg_temp.t4294_check('M-4', 'and the newest refresh token is refused',
    pg_temp.t4294_refresh('g2b', pg_temp.t4294_c('app'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.t4294_check('M-4', 'the personal key is still on after all of it',
    pg_temp.t4294_who(pg_temp.t4294_id('growth.personal')), 'ok/growth');
end;
$m4$;

-- ---------------------------------------------------------------------------
-- M-5 an end, Disconnect, access removed.
-- ---------------------------------------------------------------------------
do $m5$
declare
  v_grant text;
begin
  perform pg_temp.t4294_approve('growth', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'code3');
  perform pg_temp.t4294_exchange('code3', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'g3');
  perform pg_temp.t4294_check('M-5', 'works before its end', pg_temp.t4294_who(pg_temp.t4294_id('g3.access')), 'ok/growth');
  update public.team_agent_keys set expires_at = now() - interval '1 second', created_at = now() - interval '2 hours'
   where key_hash = pg_temp.t4294_digest(pg_temp.t4294_id('g3.access'));
  perform pg_temp.t4294_check('M-5', 'refused after its end', pg_temp.t4294_who(pg_temp.t4294_id('g3.access')), 'invalid');
  perform pg_temp.t4294_check('M-5', 'refused with no write (the key row is not turned off)',
    (select coalesce(revoke_reason, 'none') from public.team_agent_keys where key_hash = pg_temp.t4294_digest(pg_temp.t4294_id('g3.access'))),
    'none');
  perform pg_temp.t4294_like('M-5', 'a refresh after the end still works',
    pg_temp.t4294_refresh('g3', pg_temp.t4294_c('app'), 'g3b'), '{"kind": "claude_app"%');

  -- Connections list, then Disconnect.
  v_grant := pg_temp.t4294_as('growth', 'select public.mingla_connector_connections_mine()::text')::jsonb #>> '{connections,0,grant_id}';
  perform pg_temp.t4294_check('M-5', 'Claude app connections lists one connection',
    jsonb_array_length(pg_temp.t4294_as('growth', 'select public.mingla_connector_connections_mine()::text')::jsonb -> 'connections')::text, '1');
  perform pg_temp.t4294_like('M-5', 'an admin cannot disconnect another person''s connection',
    pg_temp.t4294_as('admin', format('select public.mingla_connector_disconnect(%L)::text', v_grant)), 'ERR:P0002:%');
  perform pg_temp.t4294_check('M-5', 'a person disconnects their own',
    pg_temp.t4294_as('growth', format('select public.mingla_connector_disconnect(%L)::text', v_grant))::jsonb ->> 'changed', 'true');
  perform pg_temp.t4294_check('M-5', 'the token stops at once', pg_temp.t4294_who(pg_temp.t4294_id('g3b.access')), 'invalid');
  perform pg_temp.t4294_check('M-5', 'the refresh token stops too',
    pg_temp.t4294_refresh('g3b', pg_temp.t4294_c('app'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.t4294_check('M-5', 'Disconnect was audited',
    (select count(*)::text from public.admin_audit_log a where a.action = 'connector.disconnect' and a.target_id = v_grant), '1');
  perform pg_temp.t4294_check('M-5', 'the personal key is still on', pg_temp.t4294_who(pg_temp.t4294_id('growth.personal')), 'ok/growth');

  -- An owner may end anyone's.
  perform pg_temp.t4294_approve('growth', pg_temp.t4294_c('code'), 'http://localhost:4000/callback', pg_temp.t4294_c('verifier'), 'code4');
  perform pg_temp.t4294_exchange('code4', pg_temp.t4294_c('code'), 'http://localhost:4000/callback', pg_temp.t4294_c('verifier'), 'g4');
  perform pg_temp.t4294_check('M-5', 'Claude Code sign-in works', pg_temp.t4294_who(pg_temp.t4294_id('g4.access')), 'ok/growth');
  perform pg_temp.t4294_check('M-5', 'its key is claude_code',
    (select kind from public.team_agent_keys where key_hash = pg_temp.t4294_digest(pg_temp.t4294_id('g4.access'))), 'claude_code');
  v_grant := (select g.id::text from public.mingla_connector_oauth_grants g
               where g.owner_email = 'issue4294-growth@test.local' and g.kind = 'claude_code' and g.revoked_at is null);
  perform pg_temp.t4294_check('M-5', 'an owner disconnects someone else''s',
    pg_temp.t4294_as('owner', format('select public.mingla_connector_disconnect(%L)::text', v_grant))::jsonb ->> 'changed', 'true');
  perform pg_temp.t4294_check('M-5', 'reason owner',
    (select revoke_reason from public.mingla_connector_oauth_grants where id = v_grant::uuid), 'owner');

  -- Access removed: the next request and the next refresh both stop.
  perform pg_temp.t4294_approve('leaver', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'code5');
  perform pg_temp.t4294_exchange('code5', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'g5');
  perform pg_temp.t4294_check('M-5', 'the leaver signed in', pg_temp.t4294_who(pg_temp.t4294_id('g5.access')), 'ok/growth');
  update public.admin_team_members set status = 'revoked' where email = 'issue4294-leaver@test.local';
  perform pg_temp.t4294_check('M-5', 'after removal the token is refused', pg_temp.t4294_who(pg_temp.t4294_id('g5.access')), 'invalid');
  perform pg_temp.t4294_check('M-5', 'after removal the refresh is refused',
    pg_temp.t4294_refresh('g5', pg_temp.t4294_c('app'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.t4294_check('M-5', 'and the grant ended for access removed',
    (select revoke_reason from public.mingla_connector_oauth_grants where owner_email = 'issue4294-leaver@test.local'), 'access_removed');
end;
$m5$;

-- ---------------------------------------------------------------------------
-- M-6 My agent lists personal keys only.
-- ---------------------------------------------------------------------------
do $m6$
declare
  v jsonb;
begin
  v := pg_temp.t4294_as('growth', 'select public.team_agent_keys_mine()::text')::jsonb;
  perform pg_temp.t4294_check('M-6', 'My agent lists only personal keys',
    (select count(*)::text from jsonb_array_elements(v -> 'keys') k
      where (k ->> 'key_id')::uuid in (select id from public.team_agent_keys where kind <> 'personal')), '0');
  perform pg_temp.t4294_check('M-6', 'and still the personal one',
    (select count(*)::text from jsonb_array_elements(v -> 'keys') k where k ->> 'revoked_at' is null), '1');
  v := pg_temp.t4294_as('owner', 'select public.team_agent_keys_overview()::text')::jsonb;
  perform pg_temp.t4294_check('M-6', 'the owner overview shows the personal key for growth',
    (select (p ->> 'key_id') from jsonb_array_elements(v -> 'people') p
      where p ->> 'email' = 'issue4294-growth@test.local' and p ->> 'agent' = 'claude'),
    (select id::text from public.team_agent_keys where key_hash = pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal'))));
end;
$m6$;

-- ---------------------------------------------------------------------------
-- M-7 company tools: owner only, no key fields, address rules.
-- ---------------------------------------------------------------------------
do $m7$
declare
  v text;
begin
  perform pg_temp.t4294_like('M-7', 'growth cannot list company tools',
    pg_temp.t4294_as('growth', 'select public.mingla_connector_registry_list()::text'), 'ERR:42501:%');
  perform pg_temp.t4294_like('M-7', 'an admin cannot list company tools',
    pg_temp.t4294_as('admin', 'select public.mingla_connector_registry_list()::text'), 'ERR:42501:%');
  v := pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_list()::text');
  perform pg_temp.t4294_check('M-7', 'the owner sees the four seeded tools, all off, no key',
    (select string_agg((r ->> 'slug') || ':' || (r ->> 'enabled') || ':' || (r ->> 'key_set') || ':' || (r -> 'allowed_roles')::text, ',' order by r ->> 'slug')
       from jsonb_array_elements(v::jsonb -> 'rows') r),
    'appsflyer:false:false:["owner"],metaads:false:false:["owner"],posthog:false:false:["owner"],sentry:false:false:["owner"]');
  perform pg_temp.t4294_check('M-7', 'a registry row never names a Vault id', (v like '%vault%')::text, 'false');
  perform pg_temp.t4294_like('M-7', 'a Vault id cannot be saved',
    pg_temp.t4294_as('owner', format('select public.mingla_connector_registry_save(%L::jsonb)::text',
      json_build_object('slug', 'posthog', 'vault_secret_id', gen_random_uuid()))), 'ERR:22023:invalid_field:%');
  perform pg_temp.t4294_like('M-7', 'a key cannot be saved through the row',
    pg_temp.t4294_as('owner', format('select public.mingla_connector_registry_save(%L::jsonb)::text',
      json_build_object('slug', 'posthog', 'key', 'abcdefgh12345678'))), 'ERR:22023:invalid_field:%');
  perform pg_temp.t4294_like('M-7', 'an http address is refused',
    pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"tst","label":"T","mcp_url":"http://mcp.example.com/mcp"}''::jsonb)::text'),
    'ERR:22023:invalid_url:%');
  perform pg_temp.t4294_like('M-7', 'an address with a user part is refused',
    pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"tst","label":"T","mcp_url":"https://a@mcp.example.com/mcp"}''::jsonb)::text'),
    'ERR:22023:invalid_url:%');
  perform pg_temp.t4294_like('M-7', 'an address literal is refused',
    pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"tst","label":"T","mcp_url":"https://169.254.169.254/x"}''::jsonb)::text'),
    'ERR:22023:invalid_url:%');
  perform pg_temp.t4294_like('M-7', 'a platform address is refused',
    pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"tst","label":"T","mcp_url":"https://x.supabase.co/functions/v1/a"}''::jsonb)::text'),
    'ERR:22023:invalid_url:%');
  perform pg_temp.t4294_like('M-7', 'a query string is refused',
    pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"tst","label":"T","mcp_url":"https://mcp.example.com/mcp?x=1"}''::jsonb)::text'),
    'ERR:22023:invalid_url:%');
  perform pg_temp.t4294_like('M-7', 'growth cannot add one',
    pg_temp.t4294_as('growth', 'select public.mingla_connector_registry_save(''{"slug":"tst","label":"T","mcp_url":"https://mcp.example.com/mcp"}''::jsonb)::text'),
    'ERR:42501:%');
  perform pg_temp.t4294_check('M-7', 'the owner adds a test tool',
    pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"tst","label":"Test tool","mcp_url":"https://mcp.example.com/mcp"}''::jsonb)::text')::jsonb ->> 'key_set',
    'false');
  perform pg_temp.t4294_like('M-7', 'a tool cannot be turned on before its key is set',
    pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"tst","enabled":true}''::jsonb)::text'),
    'ERR:22023:no_key:%');
  perform pg_temp.t4294_check('M-7', 'saving is audited with the host',
    (select a.metadata ->> 'new_host' from public.admin_audit_log a
      where a.action = 'connector.registry_save' and a.target_id = 'tst' order by a.created_at desc limit 1), 'mcp.example.com');
end;
$m7$;

-- ---------------------------------------------------------------------------
-- M-8 a key goes into Vault and never comes back out to a client.
-- ---------------------------------------------------------------------------
do $m8$
declare
  v       text;
  v_id    uuid;
  v_leak  text;
begin
  perform pg_temp.t4294_like('M-8', 'an admin cannot set a key',
    pg_temp.t4294_as('admin', format('select public.mingla_connector_set_key(%L, %L)::text', 'tst', pg_temp.t4294_c('marker'))), 'ERR:42501:%');
  perform pg_temp.t4294_like('M-8', 'growth cannot set a key',
    pg_temp.t4294_as('growth', format('select public.mingla_connector_set_key(%L, %L)::text', 'tst', pg_temp.t4294_c('marker'))), 'ERR:42501:%');
  perform pg_temp.t4294_like('M-8', 'an oversized key is refused with a fixed message',
    pg_temp.t4294_as('owner', format('select public.mingla_connector_set_key(%L, %L)::text', 'tst', repeat(pg_temp.t4294_c('marker'), 120))),
    'ERR:22023:invalid_key: That key cannot be used.%');
  perform pg_temp.t4294_like('M-8', 'a key with a line break is refused',
    pg_temp.t4294_as('owner', format('select public.mingla_connector_set_key(%L, %L)::text', 'tst', pg_temp.t4294_c('marker') || E'\n')),
    'ERR:22023:invalid_key:%');
  v := pg_temp.t4294_as('owner', format('select public.mingla_connector_set_key(%L, %L)::text', 'tst', pg_temp.t4294_c('marker')));
  perform pg_temp.t4294_check('M-8', 'set_key answers only that a key is set and when',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v::jsonb) k), 'key_set,key_updated_at');
  v_id := (select vault_secret_id from public.mingla_connector_upstreams where slug = 'tst');
  perform pg_temp.t4294_check('M-8', 'the key is in Vault under the row''s secret',
    (select decrypted_secret from vault.decrypted_secrets where id = v_id), pg_temp.t4294_c('marker'));
  perform pg_temp.t4294_check('M-8', 'the Vault secret is named for this tool',
    (select name like 'mingla_connector:tst:%' from vault.secrets where id = v_id)::text, 'true');
  perform pg_temp.t4294_like('M-8', 'the registry says Key set',
    pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_list()::text'), '%"key_set": true%');
  perform pg_temp.t4294_like('M-8', 'anon cannot read Vault',
    pg_temp.t4294_as('anon', 'select decrypted_secret from vault.decrypted_secrets limit 1'), 'ERR:42501:%');
  perform pg_temp.t4294_like('M-8', 'a signed-in owner cannot read Vault',
    pg_temp.t4294_as('owner', 'select decrypted_secret from vault.decrypted_secrets limit 1'), 'ERR:42501:%');
  perform pg_temp.t4294_like('M-8', 'a signed-in owner cannot read the table',
    pg_temp.t4294_as('owner', 'select count(*)::text from public.mingla_connector_upstreams'), 'ERR:42501:%');
  perform pg_temp.t4294_like('M-8', 'a signed-in owner cannot call the key reader',
    pg_temp.t4294_as('owner', format('select public.mingla_connector_upstream_key(%L)::text', gen_random_uuid())), 'ERR:42501:%');

  -- Replace it.
  v := pg_temp.t4294_as('owner', format('select public.mingla_connector_set_key(%L, %L)::text', 'tst', pg_temp.t4294_c('marker2')));
  perform pg_temp.t4294_check('M-8', 'replacing keeps the same Vault secret',
    (select vault_secret_id from public.mingla_connector_upstreams where slug = 'tst')::text, v_id::text);
  perform pg_temp.t4294_check('M-8', 'and holds the new value',
    (select decrypted_secret from vault.decrypted_secrets where id = v_id), pg_temp.t4294_c('marker2'));
  perform pg_temp.t4294_check('M-8', 'every key change was audited without the key',
    (select count(*)::text from public.admin_audit_log a where a.action = 'connector.key_set' and a.target_id = 'tst'), '2');

  -- The read-back sweep: every answer given so far, every audit row, every
  -- row of every connector table.
  select string_agg(s.src, ' | ') into v_leak from t4294_seen s
   where pg_temp.t4294_leaks(s.body, pg_temp.t4294_c('marker')) or pg_temp.t4294_leaks(s.body, pg_temp.t4294_c('marker2'));
  perform pg_temp.t4294_check('M-8', 'no answer or refusal holds any 8-character slice of a key', coalesce(v_leak, 'none'), 'none');
  perform pg_temp.t4294_check('M-8', 'no audit row holds a slice of a key',
    (select count(*)::text from public.admin_audit_log a
      where pg_temp.t4294_leaks(row_to_json(a)::text, pg_temp.t4294_c('marker'))
         or pg_temp.t4294_leaks(row_to_json(a)::text, pg_temp.t4294_c('marker2'))), '0');
  perform pg_temp.t4294_check('M-8', 'no company tools row holds a slice of a key',
    (select count(*)::text from public.mingla_connector_upstreams u
      where pg_temp.t4294_leaks(row_to_json(u)::text, pg_temp.t4294_c('marker'))
         or pg_temp.t4294_leaks(row_to_json(u)::text, pg_temp.t4294_c('marker2'))), '0');
  perform pg_temp.t4294_check('M-8', 'the vault table stores no readable key',
    (select count(*)::text from vault.secrets s where pg_temp.t4294_leaks(s.secret, pg_temp.t4294_c('marker2'))), '0');
end;
$m8$;

-- ---------------------------------------------------------------------------
-- M-9 the proxy steps.
-- ---------------------------------------------------------------------------
do $m9$
declare
  v       jsonb;
  v_call  text;
  v_n0    integer;
  i       integer;
begin
  -- On, for growth, one listed tool.
  perform pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"tst","enabled":true,"allowed_roles":["growth"],"tool_allowlist":["read_things"]}''::jsonb)::text');
  v := pg_temp.t4294_as('service', format('select public.mingla_connector_upstreams_for(%L)::text',
         pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal'))))::jsonb;
  perform pg_temp.t4294_check('M-9', 'growth sees the tool and its list',
    (select string_agg((u ->> 'slug') || ':' || (u -> 'tool_allowlist')::text, ',') from jsonb_array_elements(v -> 'upstreams') u),
    'tst:["read_things"]');
  perform pg_temp.t4294_check('M-9', 'the listing holds no key and no address',
    (v::text ~ '(MRK4294|mcp\.example)')::text, 'false');
  -- An admin key: role not allowed.
  perform pg_temp.t4294_keep('admin.personal',
    pg_temp.t4294_as('admin', 'select public.team_agent_key_create(''claude'')::text')::jsonb ->> 'key');
  v := pg_temp.t4294_as('service', format('select public.mingla_connector_upstreams_for(%L)::text',
         pg_temp.t4294_digest(pg_temp.t4294_id('admin.personal'))))::jsonb;
  perform pg_temp.t4294_check('M-9', 'an admin sees nothing when only growth is allowed', (v -> 'upstreams')::text, '[]');
  perform pg_temp.t4294_check('M-9', 'an unusable key gets the one refusal',
    pg_temp.t4294_as('service', format('select public.mingla_connector_upstreams_for(%L)::text', repeat('0', 64))), '{"auth": "invalid"}');

  v_n0 := (select count(*) from public.mingla_connector_calls);
  v := pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::text',
         pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal')), 'tst', 'read_things', 'issue4294'))::jsonb;
  v_call := v ->> 'call_id';
  perform pg_temp.t4294_check('M-9', 'a listed tool begins', (v ->> 'ok') || ':' || (v ->> 'mcp_url'), 'true:https://mcp.example.com/mcp');
  perform pg_temp.t4294_check('M-9', 'its call-log row is running',
    (select owner_email || '/' || upstream || '/' || tool || '/' || outcome from public.mingla_connector_calls where id = v_call::uuid),
    'issue4294-growth@test.local/tst/read_things/running');
  perform pg_temp.t4294_check('M-9', 'the running call may read the key once begun',
    pg_temp.t4294_as('service', format('select public.mingla_connector_upstream_key(%L)::jsonb->>''key''', v_call)), pg_temp.t4294_c('marker2'));
  perform pg_temp.t4294_check('M-9', 'finish records the outcome',
    pg_temp.t4294_as('service', format('select public.mingla_connector_call_finish(%L, %L, %L, %L)::text', v_call, 'ok', 200, 42)),
    '{"finished": true}');
  perform pg_temp.t4294_check('M-9', 'a finished call cannot read the key',
    pg_temp.t4294_as('service', format('select public.mingla_connector_upstream_key(%L)::text', v_call)), '{"ok": false}');
  perform pg_temp.t4294_check('M-9', 'finishing twice changes nothing',
    pg_temp.t4294_as('service', format('select public.mingla_connector_call_finish(%L, %L, %L, %L)::text', v_call, 'upstream_unavailable', 500, 1)),
    '{"finished": false}');
  perform pg_temp.t4294_check('M-9', 'the row says ok, 200, 42 ms',
    (select outcome || '/' || http_status || '/' || duration_ms from public.mingla_connector_calls where id = v_call::uuid), 'ok/200/42');

  -- Default deny.
  perform pg_temp.t4294_check('M-9', 'an unlisted tool is not_allowed',
    pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''token''',
      pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal')), 'tst', 'delete_things', 'x')), 'not_allowed');
  perform pg_temp.t4294_check('M-9', 'a name that differs only in case is not_allowed',
    pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''token''',
      pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal')), 'tst', 'READ_THINGS', 'x')), 'not_allowed');
  perform pg_temp.t4294_check('M-9', 'a role not allowed is not_allowed',
    pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''token''',
      pg_temp.t4294_digest(pg_temp.t4294_id('admin.personal')), 'tst', 'read_things', 'x')), 'not_allowed');
  perform pg_temp.t4294_check('M-9', 'an unknown tool server is not_allowed',
    pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''token''',
      pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal')), 'nosuch', 'read_things', 'x')), 'not_allowed');
  perform pg_temp.t4294_check('M-9', 'a seeded tool that is off is not_allowed',
    pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''token''',
      pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal')), 'posthog', 'exec', 'x')), 'not_allowed');
  perform pg_temp.t4294_check('M-9', 'every request so far has exactly one call-log row',
    ((select count(*) from public.mingla_connector_calls) - v_n0)::text, '6');
  perform pg_temp.t4294_check('M-9', 'the refused ones are logged not_allowed',
    (select count(*)::text from public.mingla_connector_calls where outcome = 'not_allowed'), '5');

  -- Adding a tool to the list exposes it, with no code change; removing hides it.
  perform pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"tst","tool_allowlist":["read_things","more_things"]}''::jsonb)::text');
  perform pg_temp.t4294_check('M-9', 'a newly listed tool begins',
    pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''ok''',
      pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal')), 'tst', 'more_things', 'x')), 'true');
  perform pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"tst","tool_allowlist":["read_things"]}''::jsonb)::text');
  perform pg_temp.t4294_check('M-9', 'a tool taken off the list is refused again',
    pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''token''',
      pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal')), 'tst', 'more_things', 'x')), 'not_allowed');

  -- A sign-in token reaches company tools as the person.
  perform pg_temp.t4294_approve('growth', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'code6');
  perform pg_temp.t4294_exchange('code6', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'g6');
  perform pg_temp.t4294_check('M-9', 'a sign-in token begins a listed tool',
    pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''ok''',
      pg_temp.t4294_digest(pg_temp.t4294_id('g6.access')), 'tst', 'read_things', 'x')), 'true');

  -- The limit: 30 a minute.
  for i in 1..40 loop
    perform pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::text',
      pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal')), 'tst', 'read_things', 'x'));
  end loop;
  perform pg_temp.t4294_check('M-9', 'after 30 calls in a minute the next is rate_limited',
    pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''token''',
      pg_temp.t4294_digest(pg_temp.t4294_id('growth.personal')), 'tst', 'read_things', 'x')), 'rate_limited');

  -- A new address turns the tool off; Remove key deletes the Vault secret.
  perform pg_temp.t4294_check('M-9', 'a new address turns a keyed tool off',
    pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"tst","mcp_url":"https://mcp2.example.com/mcp"}''::jsonb)::text')::jsonb ->> 'enabled',
    'false');
  perform pg_temp.t4294_check('M-9', 'Remove key answers key_set false',
    pg_temp.t4294_as('owner', 'select public.mingla_connector_clear_key(''tst'')::jsonb->>''key_set'''), 'false');
  perform pg_temp.t4294_check('M-9', 'and the Vault secret is gone',
    (select count(*)::text from vault.secrets where name like 'mingla_connector:tst:%'), '0');
  perform pg_temp.t4294_check('M-9', 'Remove tool deletes the row',
    pg_temp.t4294_as('owner', 'select public.mingla_connector_registry_delete(''tst'')::jsonb->>''deleted'''), 'true');
  perform pg_temp.t4294_like('M-9', 'growth cannot see recent calls',
    pg_temp.t4294_as('growth', 'select public.mingla_connector_calls_recent(20)::text'), 'ERR:42501:%');
  perform pg_temp.t4294_check('M-9', 'the owner sees at most 20 recent calls',
    jsonb_array_length(pg_temp.t4294_as('owner', 'select public.mingla_connector_calls_recent(20)::text')::jsonb -> 'calls')::text, '20');
end;
$m9$;

-- ---------------------------------------------------------------------------
-- M-11 hardening: numeric-host addresses, the one-account rule at approve,
-- the limit before a refused call is logged.
-- ---------------------------------------------------------------------------
do $m11$
declare
  r record;
  v text;
  v_key text := pg_temp.t4294_digest(pg_temp.t4294_id('admin.personal'));
begin
  -- A host whose last label is a number is an address however it is written.
  for r in select * from (values ('0x7f.0.0.1'), ('0x7f.1'), ('1.0x2'), ('a.0x'), ('a.0xff'), ('tools.example.10'),
                                 ('0177.0.0.1')) as t(host)
  loop
    perform pg_temp.t4294_check('M-11', format('%s is not a saveable host', r.host),
      public.mingla_connector_url_ok('https://' || r.host || '/mcp')::text, 'false');
    perform pg_temp.t4294_like('M-11', format('the owner cannot save %s', r.host),
      pg_temp.t4294_as('owner', format('select public.mingla_connector_registry_save(%L::jsonb)::text',
        json_build_object('slug', 'hex', 'label', 'H', 'mcp_url', 'https://' || r.host || '/mcp'))), 'ERR:22023:invalid_url:%');
  end loop;
  for r in select * from (values ('0x7f.example.com'), ('123.example.com'), ('mcp.example.com')) as t(host)
  loop
    perform pg_temp.t4294_check('M-11', format('%s is still a name', r.host),
      public.mingla_connector_url_ok('https://' || r.host || '/mcp')::text, 'true');
  end loop;

  -- Two confirmed accounts on one address: approve says no up front.
  insert into t4294_people (who, id, email) values ('pair', '42940000-0000-4000-a000-0000000000a1', 'issue4294-pair@test.local');
  insert into auth.users (id, email, email_confirmed_at) values ('42940000-0000-4000-a000-0000000000a1', 'issue4294-pair@test.local', now());
  insert into public.admin_team_members (email, role, status, accepted_at) values ('issue4294-pair@test.local', 'growth', 'active', now());
  perform pg_temp.t4294_like('M-11', 'with one account the person approves',
    pg_temp.t4294_approve('pair', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'pair1'),
    '{"code": "mglo_%');
  insert into auth.users (id, email, email_confirmed_at) values ('42940000-0000-4000-a000-0000000000a2', ' Issue4294-Pair@test.local', now());
  perform pg_temp.t4294_like('M-11', 'with a second confirmed account on the address approve is refused',
    pg_temp.t4294_approve('pair', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'pair2'),
    'ERR:42501:%');
  perform pg_temp.t4294_check('M-11', 'and the code made before still exchanges for nothing',
    pg_temp.t4294_exchange('pair1', pg_temp.t4294_c('app'), pg_temp.t4294_c('app_redirect'), pg_temp.t4294_c('verifier'), 'gpair'),
    '{"error": "invalid_grant"}');

  -- The limit comes before a refused call is logged.
  update public.mingla_connector_calls set started_at = started_at - interval '2 days' where owner_email = 'issue4294-admin@test.local';
  for i in 1..30 loop
    perform pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::text',
      v_key, 'nope', 'not_a_tool', 'x'));
  end loop;
  perform pg_temp.t4294_check('M-11', '30 refused calls in a minute are 30 rows',
    (select count(*)::text from public.mingla_connector_calls
      where owner_email = 'issue4294-admin@test.local' and started_at > clock_timestamp() - interval '1 minute'), '30');
  v := pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::text',
    v_key, 'nope', 'not_a_tool', 'x'));
  perform pg_temp.t4294_check('M-11', 'the next refused call is rate_limited', v::jsonb ->> 'token', 'rate_limited');
  for i in 1..50 loop
    perform pg_temp.t4294_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::text',
      v_key, 'nope', 'not_a_tool', 'x'));
  end loop;
  perform pg_temp.t4294_check('M-11', 'fifty more add no rows past one rate_limited row',
    (select count(*) filter (where outcome = 'not_allowed')::text || '/' || count(*) filter (where outcome = 'rate_limited')::text
       from public.mingla_connector_calls
      where owner_email = 'issue4294-admin@test.local' and started_at > clock_timestamp() - interval '1 minute'), '30/1');
end;
$m11$;

-- ---------------------------------------------------------------------------
-- M-10 the migration's self-check passes again.
-- ---------------------------------------------------------------------------
do $m10$
declare
  v_sql text;
  v_got text;
begin
  select sql into v_sql from t4294_src where k = 'selfcheck';
  perform pg_temp.t4294_check('M-10', 'the self-check block was read from the migration', (length(v_sql) > 1000)::text, 'true');
  begin
    execute v_sql;
    v_got := 'passed';
  exception when others then
    v_got := sqlerrm;
  end;
  perform pg_temp.t4294_check('M-10', 'the self-check passes on this database', v_got, 'passed');
end;
$m10$;

do $verdict$
declare
  v_total int;
  v_failed int;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from t4294_results;
  for r in select * from t4294_results where not ok order by seq loop
    raise warning 'ISSUE-4294 CONNECTOR FAILED % | % | %', r.test, r.label, r.detail;
  end loop;
  if v_failed > 0 or v_total < 90 then
    raise exception 'ISSUE-4294 CONNECTOR FAIL: % of % checks failed (at least 90 must run)', v_failed, v_total;
  end if;
  raise notice 'ISSUE-4294 CONNECTOR PASS: % checks across M-1..M-11, 0 failed', v_total;
end;
$verdict$;

rollback;
