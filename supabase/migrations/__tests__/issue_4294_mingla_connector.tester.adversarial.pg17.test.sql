-- Issue #4294 — tester adversarial suite for the one Mingla connector (PostgreSQL 17).
--
-- The implementor suite proves the happy path. This one assumes the database
-- is the last line of defence and attacks it the way a thief, a confused
-- client or a teammate without the right role would:
--   A-1  redirect and client abuse: every look-alike redirect the database
--        must refuse on its own (the edge check may be skipped)
--   A-2  PKCE downgrade and shape: padded, hex, standard-base64 and plain
--        challenges are refused at approve; a missing or case-changed
--        challenge never exchanges
--   A-3  stolen codes: another app, an expired code, a voided code, a code
--        replayed after the grant was refreshed (the whole chain dies)
--   A-4  kind confusion: a refresh token, a code or an access token used as
--        another kind of credential, or at the setup-code path
--   A-5  refresh and expiry: grant end, refresh end, expired token makes no
--        write, gateway refuses an expired token
--   A-6  people: the real remove-member path, re-adding does not revive a
--        token, a second account on the same address, an agent-originated
--        approve, a non-owner disconnect
--   A-7  personal keys survive everything; sign-in kinds do not replace
--        each other or a personal key
--   A-8  role escalation and changes mid-call: growth on an owner-only row;
--        a row turned off, a role removed, a tool unlisted, a key removed
--        or a minute passing between begin and the key read
--   A-9  allow-list bypass: case, spaces, zero-width, Cyrillic look-alike,
--        double prefix, leading underscore, oversized and odd slugs
--   A-10 key read-back: refusal messages carrying a marker, a Vault pointer
--        at another secret through every spelling, every client read, every
--        audit and call row; no client role reaches Vault or the reader
--   A-11 structure: set_key never builds SQL text; only the named functions
--        touch Vault; every internal function is closed to clients
--
-- One transaction, rolled back. Never run on production. Runs as the
-- image's admin role from the repository root.
-- {"invariant":"I-4294-1","issue":4294,"status":"ACTIVE","enforced_by":["supabase/migrations/__tests__/issue_4294_mingla_connector.tester.adversarial.pg17.test.sql"]}
-- {"invariant":"I-4294-2","issue":4294,"status":"ACTIVE","enforced_by":["supabase/migrations/__tests__/issue_4294_mingla_connector.tester.adversarial.pg17.test.sql"]}
-- {"invariant":"I-4294-3","issue":4294,"status":"ACTIVE","enforced_by":["supabase/migrations/__tests__/issue_4294_mingla_connector.tester.adversarial.pg17.test.sql"]}

\set ON_ERROR_STOP on

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

create temp table ta_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into ta_people (who, id, email) values
  ('owner',   '4294a000-0000-4000-a000-000000000001', 'issue4294t-owner@test.local'),
  ('admin',   '4294a000-0000-4000-a000-000000000002', 'issue4294t-admin@test.local'),
  ('growth',  '4294a000-0000-4000-a000-000000000003', 'issue4294t-growth@test.local'),
  ('leaver',  '4294a000-0000-4000-a000-000000000004', 'issue4294t-leaver@test.local'),
  ('twin',    '4294a000-0000-4000-a000-000000000005', 'issue4294t-twin@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from ta_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue4294t-owner@test.local', 'owner', 'active', now()),
  ('issue4294t-admin@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
select email, 'growth', 'active', now() from ta_people where who in ('growth', 'leaver', 'twin');

create temp table ta_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table ta_ids (k text primary key, v text) on commit drop;
create temp table ta_seen (seq serial primary key, src text, body text) on commit drop;

-- Run SQL as a person, anon, the service role, or a person whose request
-- came through an agent (a gateway row for this transaction exists).
create function pg_temp.ta_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
  v_person text := replace(p_who, 'agent:', '');
begin
  if v_person not in ('anon', 'service') then
    select id, email into strict v_id, v_email from ta_people where who = v_person;
    update public.team_agent_calls set xact_id = '3'::xid8 where xact_id <> '3'::xid8;
    if p_who like 'agent:%' then
      insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id)
      values (gen_random_uuid(), v_email, v_id, 'claude', 'get_started', pg_current_xact_id());
    end if;
  end if;
  begin
    if v_person = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.email', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif v_person = 'service' then
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
  insert into ta_seen (src, body) values (p_who || ': ' || left(p_sql, 60), coalesce(v_out, ''));
  return v_out;
end;
$fn$;

create function pg_temp.ta_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into ta_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 300), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.ta_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into ta_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 300), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.ta_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;
create function pg_temp.ta_id(p_k text) returns text
language sql as $fn$ select v from ta_ids where k = p_k $fn$;
create function pg_temp.ta_keep(p_k text, p_v text) returns void
language sql as $fn$ insert into ta_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $fn$;
create function pg_temp.ta_challenge(p_verifier text) returns text
language sql as $fn$
  select translate(rtrim(encode(sha256(convert_to(p_verifier, 'UTF8')), 'base64'), '='), '+/', '-_')
$fn$;

create function pg_temp.ta_approve_raw(p_who text, p_client text, p_redirect text, p_challenge text) returns text
language sql as $fn$
  select pg_temp.ta_as(p_who, format('select public.mingla_connector_oauth_approve(%L, %L, %L, %L)::text',
           p_client, p_redirect, p_challenge, null))
$fn$;

create function pg_temp.ta_approve(p_who text, p_client text, p_redirect text, p_verifier text, p_label text)
returns text
language plpgsql as $fn$
declare
  v text;
begin
  v := pg_temp.ta_approve_raw(p_who, p_client, p_redirect, pg_temp.ta_challenge(p_verifier));
  if v not like 'ERR:%' then
    perform pg_temp.ta_keep(p_label, v::jsonb ->> 'code');
  end if;
  return v;
end;
$fn$;

create function pg_temp.ta_exchange_raw(p_code_label text, p_client text, p_redirect text, p_challenge text)
returns text
language sql as $fn$
  select pg_temp.ta_as('service', format('select public.mingla_connector_oauth_exchange(%L, %L, %L, %L, %L)::text',
           pg_temp.ta_digest(pg_temp.ta_id(p_code_label)), p_client, p_redirect, p_challenge, null))
$fn$;

create function pg_temp.ta_exchange(p_code_label text, p_client text, p_redirect text, p_verifier text, p_label text)
returns text
language plpgsql as $fn$
declare
  v text;
begin
  v := pg_temp.ta_exchange_raw(p_code_label, p_client, p_redirect, pg_temp.ta_challenge(p_verifier));
  if v not like 'ERR:%' and v::jsonb ? 'access_token' then
    perform pg_temp.ta_keep(p_label || '.access', v::jsonb ->> 'access_token');
    perform pg_temp.ta_keep(p_label || '.refresh', v::jsonb ->> 'refresh_token');
  end if;
  return v;
end;
$fn$;

create function pg_temp.ta_refresh_hash(p_hash text, p_client text, p_new_label text) returns text
language plpgsql as $fn$
declare
  v text;
begin
  v := pg_temp.ta_as('service', format('select public.mingla_connector_oauth_refresh(%L, %L)::text', p_hash, p_client));
  if v not like 'ERR:%' and v::jsonb ? 'access_token' then
    perform pg_temp.ta_keep(p_new_label || '.access', v::jsonb ->> 'access_token');
    perform pg_temp.ta_keep(p_new_label || '.refresh', v::jsonb ->> 'refresh_token');
  end if;
  return v;
end;
$fn$;

create function pg_temp.ta_refresh(p_label text, p_client text, p_new_label text) returns text
language sql as $fn$
  select pg_temp.ta_refresh_hash(pg_temp.ta_digest(pg_temp.ta_id(p_label || '.refresh')), p_client, p_new_label)
$fn$;

create function pg_temp.ta_who_hash(p_hash text) returns text
language plpgsql as $fn$
declare
  v text;
begin
  v := pg_temp.ta_as('service', format('select public.team_agent_resolve(%L)::text', p_hash));
  if v like 'ERR:%' then return v; end if;
  return case when v::jsonb ->> 'auth' = 'ok' then 'ok/' || (v::jsonb ->> 'role') else 'invalid' end;
end;
$fn$;
create function pg_temp.ta_who(p_token text) returns text
language sql as $fn$ select pg_temp.ta_who_hash(pg_temp.ta_digest(p_token)) $fn$;

create function pg_temp.ta_leaks(p_text text, p_secret text) returns boolean
language sql as $fn$
  select exists (select 1 from generate_series(1, char_length(p_secret) - 7) i
                  where strpos(coalesce(p_text, ''), substr(p_secret, i, 8)) > 0)
$fn$;

create temp table ta_const (k text primary key, v text) on commit drop;
insert into ta_const values
  ('app', 'https://claude.ai/oauth/mcp-oauth-client-metadata'),
  ('app_redirect', 'https://claude.ai/api/mcp/auth_callback'),
  ('code', 'https://claude.ai/oauth/claude-code-client-metadata'),
  ('loop', 'http://127.0.0.1:49152/callback'),
  ('verifier', 'tester4294-verifier-ZYXWVUTSRQPONMLKJIHGFEDCBA-9876543210'),
  ('thief', 'tester4294-thief-verifier-ZYXWVUTSRQPONMLKJIHGFEDCBA-98765'),
  ('marker', 'TSTMRK4294-p8Hq2Zx5Lw0Vb7Nc3Kj6Fd9Ga1Sr4Ue'),
  ('marker2', 'TSTMRK4294Z-Yu61Ra3Qx9Mk2Pw8Ob6Ie5Hn4Tl0Cj');
create function pg_temp.ta_c(p text) returns text language sql as $fn$ select v from ta_const where k = p $fn$;

select pg_temp.ta_keep('growth.personal',
  pg_temp.ta_as('growth', 'select public.team_agent_key_create(''claude'')::text')::jsonb ->> 'key');
select pg_temp.ta_keep('owner.personal',
  pg_temp.ta_as('owner', 'select public.team_agent_key_create(''claude'')::text')::jsonb ->> 'key');

-- ---------------------------------------------------------------------------
-- A-1 redirect and client abuse, judged by the database alone.
-- ---------------------------------------------------------------------------
do $a1$
declare
  r record;
  v_codes_before bigint := (select count(*) from public.mingla_connector_oauth_codes);
begin
  for r in select * from (values
      ('app', 'https://claude.ai/api/mcp/auth_callback?x=1'),
      ('app', 'https://claude.ai/api/mcp/auth_callback#x'),
      ('app', 'https://claude.ai/api/mcp/auth_callback/'),
      ('app', 'https://claude.ai/api/mcp/auth_callback/../x'),
      ('app', 'https://claude.ai/api/mcp/x/../auth_callback'),
      ('app', 'https://CLAUDE.AI/api/mcp/auth_callback'),
      ('app', 'HTTPS://claude.ai/api/mcp/auth_callback'),
      ('app', 'https://claude.ai:443/api/mcp/auth_callback'),
      ('app', 'https://claude.ai.evil.com/api/mcp/auth_callback'),
      ('app', 'https://claude.ai@evil.com/api/mcp/auth_callback'),
      ('app', 'https://evil.com/?https://claude.ai/api/mcp/auth_callback'),
      ('app', 'https://claude.ai%2F@evil.com/api/mcp/auth_callback'),
      ('app', 'https://claude.ai/api/mcp/auth%5Fcallback'),
      ('app', ' https://claude.ai/api/mcp/auth_callback'),
      ('app', 'https://claude.ai/api/mcp/auth_callback '),
      ('app', 'http://127.0.0.1:49152/callback'),
      ('code', 'https://claude.ai/api/mcp/auth_callback'),
      ('code', 'http://localhost.evil.com/callback'),
      ('code', 'http://localhost.evil.com:5000/callback'),
      ('code', 'http://127.0.0.1.evil.com:5000/callback'),
      ('code', 'http://localhost./callback'),
      ('code', 'http://localhost.:5000/callback'),
      ('code', 'http://127.0.0.1:0/callback'),
      ('code', 'http://127.0.0.1:1023/callback'),
      ('code', 'http://127.0.0.1:65536/callback'),
      ('code', 'http://127.0.0.1:099999/callback'),
      ('code', 'http://127.0.0.1:05000/callback'),
      ('code', 'http://[::1]:5000/callback'),
      ('code', 'http://127.0.0.1:5000/callback/'),
      ('code', 'http://127.0.0.1:5000/callback?x=1'),
      ('code', 'http://127.0.0.1:5000/callback#x'),
      ('code', 'http://127.0.0.1:5000/Callback'),
      ('code', 'http://127.0.0.1:5000/%63allback'),
      ('code', 'http://127.0.0.1:5000%2Fcallback'),
      ('code', 'HTTP://LOCALHOST:5000/callback'),
      ('code', 'http://LOCALHOST:5000/callback'),
      ('code', 'https://localhost:5000/callback'),
      ('code', 'http://user@localhost:5000/callback'),
      ('code', 'http://localhost:5000@evil.com/callback'),
      ('code', 'http://127.1:5000/callback'),
      ('code', 'http://0x7f.0.0.1:5000/callback'),
      ('code', 'http://localhost:5000'),
      ('code', 'http://localhost/callback'),
      ('evil', 'https://claude.ai/api/mcp/auth_callback'),
      ('upper', 'https://claude.ai/api/mcp/auth_callback'),
      ('slash', 'https://claude.ai/api/mcp/auth_callback')
    ) as t(client, redirect)
  loop
    perform pg_temp.ta_check('A-1', format('redirect %s for %s is refused by the database', r.redirect, r.client),
      pg_temp.ta_as('service', format('select public.mingla_connector_redirect_ok(%L, %L)::text',
        case r.client when 'app' then pg_temp.ta_c('app') when 'code' then pg_temp.ta_c('code')
                      when 'upper' then upper(pg_temp.ta_c('app')) when 'slash' then pg_temp.ta_c('app') || '/'
                      else 'https://evil.example/oauth/mcp-oauth-client-metadata' end, r.redirect)), 'false');
  end loop;
  -- And approve refuses the same, with nothing written.
  perform pg_temp.ta_like('A-1', 'approve refuses a look-alike host',
    pg_temp.ta_approve('growth', pg_temp.ta_c('app'), 'https://claude.ai.evil.com/api/mcp/auth_callback', pg_temp.ta_c('verifier'), 'x'),
    'ERR:22023:%');
  perform pg_temp.ta_like('A-1', 'approve refuses the claude.ai redirect for Claude Code',
    pg_temp.ta_approve('growth', pg_temp.ta_c('code'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'x'),
    'ERR:22023:%');
  perform pg_temp.ta_like('A-1', 'approve refuses a loopback redirect for the Claude app',
    pg_temp.ta_approve('growth', pg_temp.ta_c('app'), pg_temp.ta_c('loop'), pg_temp.ta_c('verifier'), 'x'),
    'ERR:22023:%');
  perform pg_temp.ta_like('A-1', 'approve refuses a null client',
    pg_temp.ta_approve('growth', null, pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'x'), 'ERR:22023:%');
  perform pg_temp.ta_check('A-1', 'no refused approve left a code behind',
    ((select count(*) from public.mingla_connector_oauth_codes) - v_codes_before)::text, '0');
  -- A client switched off by migration is refused even with its right redirect.
  update public.mingla_connector_oauth_clients set enabled = false where client_id = pg_temp.ta_c('code');
  perform pg_temp.ta_check('A-1', 'a switched-off client is refused',
    pg_temp.ta_as('service', format('select public.mingla_connector_redirect_ok(%L, %L)::text', pg_temp.ta_c('code'), pg_temp.ta_c('loop'))),
    'false');
  update public.mingla_connector_oauth_clients set enabled = true where client_id = pg_temp.ta_c('code');
  perform pg_temp.ta_check('A-1', 'the real loopback redirect is still accepted (control)',
    pg_temp.ta_as('service', format('select public.mingla_connector_redirect_ok(%L, %L)::text', pg_temp.ta_c('code'), pg_temp.ta_c('loop'))),
    'true');
end;
$a1$;

-- ---------------------------------------------------------------------------
-- A-2 PKCE downgrade and shape.
-- ---------------------------------------------------------------------------
do $a2$
declare
  v_good text := pg_temp.ta_challenge(pg_temp.ta_c('verifier'));
begin
  perform pg_temp.ta_like('A-2', 'a padded challenge (44 characters with =) is refused',
    pg_temp.ta_approve_raw('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), v_good || '='), 'ERR:22023:%');
  perform pg_temp.ta_like('A-2', 'a hex SHA-256 challenge (64 characters) is refused',
    pg_temp.ta_approve_raw('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'),
      upper(encode(sha256(convert_to(pg_temp.ta_c('verifier'), 'UTF8')), 'hex'))), 'ERR:22023:%');
  perform pg_temp.ta_like('A-2', 'a standard-base64 challenge (+ and /) is refused',
    pg_temp.ta_approve_raw('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), '+/' || substr(v_good, 3)), 'ERR:22023:%');
  perform pg_temp.ta_like('A-2', 'a plain verifier as challenge (longer than 43) is refused',
    pg_temp.ta_approve_raw('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier')), 'ERR:22023:%');
  perform pg_temp.ta_like('A-2', 'a missing challenge is refused',
    pg_temp.ta_approve_raw('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), null), 'ERR:22023:%');
  perform pg_temp.ta_like('A-2', 'an empty challenge is refused',
    pg_temp.ta_approve_raw('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), ''), 'ERR:22023:%');

  -- Exchange: a missing challenge, a case-flipped one, and the verifier itself (plain) never work.
  perform pg_temp.ta_approve('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'p1');
  perform pg_temp.ta_check('A-2', 'an exchange with no challenge is invalid_grant',
    pg_temp.ta_exchange_raw('p1', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), null), '{"error": "invalid_grant"}');
  perform pg_temp.ta_approve('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'p2');
  perform pg_temp.ta_check('A-2', 'an exchange with the challenge in another case is invalid_grant',
    pg_temp.ta_exchange_raw('p2', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'),
      translate(v_good, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')),
    '{"error": "invalid_grant"}');
  -- A plain-method client stored its 43-character verifier as the challenge; the
  -- edge always hashes the verifier, so the database never sees a match.
  perform pg_temp.ta_keep('p3', pg_temp.ta_approve_raw('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'),
    substr(pg_temp.ta_c('verifier'), 1, 43))::jsonb ->> 'code');
  perform pg_temp.ta_check('A-2', 'a plain-method code cannot be exchanged with the hash of its verifier',
    pg_temp.ta_exchange('p3', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), substr(pg_temp.ta_c('verifier'), 1, 43), 'x'),
    '{"error": "invalid_grant"}');
  perform pg_temp.ta_check('A-2', 'no grant came from any of these',
    (select count(*)::text from public.mingla_connector_oauth_grants where owner_email = 'issue4294t-growth@test.local'), '0');
end;
$a2$;

-- ---------------------------------------------------------------------------
-- A-3 stolen codes.
-- ---------------------------------------------------------------------------
do $a3$
declare
  v_grant uuid;
  i int;
begin
  -- Stolen by another app, presented with that app's own legitimate redirect.
  perform pg_temp.ta_approve('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 's1');
  perform pg_temp.ta_check('A-3', 'a Claude app code presented by Claude Code is invalid_grant',
    pg_temp.ta_exchange('s1', pg_temp.ta_c('code'), pg_temp.ta_c('loop'), pg_temp.ta_c('verifier'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.ta_check('A-3', 'and the stolen attempt burned it for everyone',
    pg_temp.ta_exchange('s1', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'x'), '{"error": "invalid_grant"}');
  -- Stolen with the right app but the thief's own verifier.
  perform pg_temp.ta_approve('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 's2');
  perform pg_temp.ta_check('A-3', 'a thief''s verifier is invalid_grant',
    pg_temp.ta_exchange('s2', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('thief'), 'x'), '{"error": "invalid_grant"}');
  -- Expired: five minutes and one second later.
  perform pg_temp.ta_approve('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 's3');
  update public.mingla_connector_oauth_codes set created_at = created_at - interval '301 seconds',
         expires_at = expires_at - interval '301 seconds'
   where code_hash = pg_temp.ta_digest(pg_temp.ta_id('s3'));
  perform pg_temp.ta_check('A-3', 'an expired code is invalid_grant',
    pg_temp.ta_exchange('s3', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.ta_check('A-3', 'the expired code was not marked used (nothing to revive)',
    (select (consumed_at is null)::text from public.mingla_connector_oauth_codes where code_hash = pg_temp.ta_digest(pg_temp.ta_id('s3'))),
    'true');
  -- Voided: the eleventh unused code ends the oldest.
  perform pg_temp.ta_approve('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'v0');
  for i in 1..10 loop
    perform pg_temp.ta_approve('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'v' || i);
  end loop;
  perform pg_temp.ta_check('A-3', 'at most ten unused codes stay live',
    (select count(*)::text from public.mingla_connector_oauth_codes
      where owner_email = 'issue4294t-growth@test.local' and consumed_at is null and voided_at is null and expires_at > clock_timestamp()),
    '10');
  perform pg_temp.ta_check('A-3', 'a voided code is invalid_grant',
    pg_temp.ta_exchange('v0', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'x'), '{"error": "invalid_grant"}');
  -- A code replayed AFTER its grant was refreshed: the whole chain dies.
  perform pg_temp.ta_check('A-3', 'a live code exchanges',
    pg_temp.ta_exchange('v10', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'c1')::jsonb ->> 'kind',
    'claude_app');
  perform pg_temp.ta_check('A-3', 'the key is the approver''s, not anyone else''s',
    (select owner_email from public.team_agent_keys where key_hash = pg_temp.ta_digest(pg_temp.ta_id('c1.access'))),
    'issue4294t-growth@test.local');
  perform pg_temp.ta_refresh('c1', pg_temp.ta_c('app'), 'c1b');
  perform pg_temp.ta_check('A-3', 'after a refresh the newest token works', pg_temp.ta_who(pg_temp.ta_id('c1b.access')), 'ok/growth');
  perform pg_temp.ta_check('A-3', 'replaying the original code is invalid_grant',
    pg_temp.ta_exchange('v10', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.ta_check('A-3', 'and it killed the refreshed token too', pg_temp.ta_who(pg_temp.ta_id('c1b.access')), 'invalid');
  perform pg_temp.ta_check('A-3', 'and the refreshed refresh token',
    pg_temp.ta_refresh('c1b', pg_temp.ta_c('app'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.ta_check('A-3', 'the personal key is untouched by all of it',
    pg_temp.ta_who(pg_temp.ta_id('growth.personal')), 'ok/growth');
end;
$a3$;

-- ---------------------------------------------------------------------------
-- A-4 kind confusion.
-- ---------------------------------------------------------------------------
do $a4$
declare
  v_grants_live bigint;
begin
  perform pg_temp.ta_approve('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'k1');
  perform pg_temp.ta_exchange('k1', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'kc');
  v_grants_live := (select count(*) from public.mingla_connector_oauth_grants where revoked_at is null);
  perform pg_temp.ta_check('A-4', 'a refresh token is not an access key', pg_temp.ta_who(pg_temp.ta_id('kc.refresh')), 'invalid');
  perform pg_temp.ta_check('A-4', 'a used code is not an access key', pg_temp.ta_who(pg_temp.ta_id('k1')), 'invalid');
  perform pg_temp.ta_check('A-4', 'an access token is not a refresh token',
    pg_temp.ta_refresh_hash(pg_temp.ta_digest(pg_temp.ta_id('kc.access')), pg_temp.ta_c('app'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.ta_check('A-4', 'a personal key is not a refresh token',
    pg_temp.ta_refresh_hash(pg_temp.ta_digest(pg_temp.ta_id('growth.personal')), pg_temp.ta_c('app'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.ta_check('A-4', 'an access token is not a code',
    pg_temp.ta_as('service', format('select public.mingla_connector_oauth_exchange(%L, %L, %L, %L, null)::text',
      pg_temp.ta_digest(pg_temp.ta_id('kc.access')), pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'),
      pg_temp.ta_challenge(pg_temp.ta_c('verifier')))), '{"error": "invalid_grant"}');
  perform pg_temp.ta_check('A-4', 'a refresh token is not a code',
    pg_temp.ta_as('service', format('select public.mingla_connector_oauth_exchange(%L, %L, %L, %L, null)::text',
      pg_temp.ta_digest(pg_temp.ta_id('kc.refresh')), pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'),
      pg_temp.ta_challenge(pg_temp.ta_c('verifier')))), '{"error": "invalid_grant"}');
  perform pg_temp.ta_like('A-4', 'an access token is not a setup code',
    pg_temp.ta_as('service', format('select public.team_agent_setup_redeem(%L, %L)::text',
      pg_temp.ta_digest(pg_temp.ta_id('kc.access')), 'tester')), '%invalid%');
  perform pg_temp.ta_like('A-4', 'a refresh token cannot make a personal key through the setup path',
    pg_temp.ta_as('service', format('select public.team_agent_key_issue(%L, %L, null, %L)::text',
      pg_temp.ta_digest(pg_temp.ta_id('kc.refresh')), 'claude', 'setup_code')), 'ERR:42501:%');
  perform pg_temp.ta_like('A-4', 'a sign-in key cannot be made for Codex',
    pg_temp.ta_as('service', format('select public.team_agent_key_issue(%L, %L, null, %L)::text',
      pg_temp.ta_digest(pg_temp.ta_id('kc.refresh')), 'codex', 'oauth')), 'ERR:42501:%');
  perform pg_temp.ta_check('A-4', 'none of the confusions ended a live grant',
    (select count(*) from public.mingla_connector_oauth_grants where revoked_at is null)::text, v_grants_live::text);
  perform pg_temp.ta_check('A-4', 'and the real token still works', pg_temp.ta_who(pg_temp.ta_id('kc.access')), 'ok/growth');
end;
$a4$;

-- ---------------------------------------------------------------------------
-- A-5 refresh and expiry edges.
-- ---------------------------------------------------------------------------
do $a5$
declare
  v_used timestamptz;
  v_key uuid;
begin
  -- The 90-day end of a grant kills a token inside its hour, and its refresh.
  perform pg_temp.ta_approve('admin', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'e1');
  perform pg_temp.ta_exchange('e1', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'ge');
  perform pg_temp.ta_check('A-5', 'a fresh admin sign-in works', pg_temp.ta_who(pg_temp.ta_id('ge.access')), 'ok/admin');
  update public.mingla_connector_oauth_grants set expires_at = clock_timestamp() - interval '1 second'
   where refresh_hash = pg_temp.ta_digest(pg_temp.ta_id('ge.refresh'));
  perform pg_temp.ta_check('A-5', 'a grant past 90 days ends its token at once', pg_temp.ta_who(pg_temp.ta_id('ge.access')), 'invalid');
  perform pg_temp.ta_check('A-5', 'and its refresh', pg_temp.ta_refresh('ge', pg_temp.ta_c('app'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.ta_check('A-5', 'which marks it expired',
    (select revoke_reason from public.mingla_connector_oauth_grants where refresh_hash = pg_temp.ta_digest(pg_temp.ta_id('ge.refresh'))),
    'expired');
  -- The 30-day end of a refresh token.
  perform pg_temp.ta_approve('admin', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'e2');
  perform pg_temp.ta_exchange('e2', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'gr');
  update public.mingla_connector_oauth_grants set refresh_expires_at = clock_timestamp() - interval '1 second'
   where refresh_hash = pg_temp.ta_digest(pg_temp.ta_id('gr.refresh'));
  perform pg_temp.ta_check('A-5', 'a refresh token past 30 days is refused',
    pg_temp.ta_refresh('gr', pg_temp.ta_c('app'), 'x'), '{"error": "invalid_grant"}');
  -- An expired token makes no write at all: not revoked, not stamped.
  perform pg_temp.ta_approve('admin', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'e3');
  perform pg_temp.ta_exchange('e3', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'gx');
  v_key := (select id from public.team_agent_keys where key_hash = pg_temp.ta_digest(pg_temp.ta_id('gx.access')));
  update public.team_agent_keys set expires_at = clock_timestamp() - interval '1 second', last_used_at = null where id = v_key;
  update public.mingla_connector_oauth_grants set last_used_at = null where current_key_id = v_key;
  perform pg_temp.ta_check('A-5', 'an expired token is refused', pg_temp.ta_who(pg_temp.ta_id('gx.access')), 'invalid');
  perform pg_temp.ta_check('A-5', 'the expired key row was not written',
    (select coalesce(revoked_at::text, 'none') || '/' || coalesce(last_used_at::text, 'none') from public.team_agent_keys where id = v_key),
    'none/none');
  perform pg_temp.ta_check('A-5', 'the grant was not stamped as used',
    (select coalesce(last_used_at::text, 'none') from public.mingla_connector_oauth_grants where current_key_id = v_key), 'none');
  perform pg_temp.ta_like('A-5', 'the gateway refuses the expired token',
    pg_temp.ta_as('service', format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
      pg_temp.ta_digest(pg_temp.ta_id('gx.access')), 'get_started', '{}', 'tester')), '%"auth": "invalid"%');
  perform pg_temp.ta_check('A-5', 'the company tool listing refuses it',
    pg_temp.ta_as('service', format('select public.mingla_connector_upstreams_for(%L)::text', pg_temp.ta_digest(pg_temp.ta_id('gx.access')))),
    '{"auth": "invalid"}');
  perform pg_temp.ta_check('A-5', 'a company tool call refuses it',
    pg_temp.ta_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::text',
      pg_temp.ta_digest(pg_temp.ta_id('gx.access')), 'posthog', 'tools/list', 'tester')), '{"auth": "invalid"}');
  -- A refresh with another client id leaves the grant alone (no denial of service by a stranger).
  perform pg_temp.ta_check('A-5', 'a refresh with the wrong client is refused',
    pg_temp.ta_refresh('gx', pg_temp.ta_c('code'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.ta_check('A-5', 'the owner of the grant can still refresh after that',
    pg_temp.ta_refresh('gx', pg_temp.ta_c('app'), 'gx2')::jsonb ->> 'kind', 'claude_app');
  perform pg_temp.ta_check('A-5', 'and the new token works', pg_temp.ta_who(pg_temp.ta_id('gx2.access')), 'ok/admin');
end;
$a5$;

-- ---------------------------------------------------------------------------
-- A-6 people.
-- ---------------------------------------------------------------------------
do $a6$
declare
  v_grant text;
begin
  -- Removed through the real Admin path, then re-added: the old token stays dead.
  perform pg_temp.ta_approve('leaver', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'l1');
  perform pg_temp.ta_exchange('l1', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'gl');
  perform pg_temp.ta_check('A-6', 'the leaver signed in', pg_temp.ta_who(pg_temp.ta_id('gl.access')), 'ok/growth');
  perform pg_temp.ta_like('A-6', 'the owner removes the leaver through Admin',
    pg_temp.ta_as('owner', 'select public.admin_team_set_member(''issue4294t-leaver@test.local'', ''growth'', ''revoked'')::text'),
    '%revoked%');
  perform pg_temp.ta_check('A-6', 'the token stops at the next request', pg_temp.ta_who(pg_temp.ta_id('gl.access')), 'invalid');
  perform pg_temp.ta_check('A-6', 'the refresh stops', pg_temp.ta_refresh('gl', pg_temp.ta_c('app'), 'x'), '{"error": "invalid_grant"}');
  perform pg_temp.ta_like('A-6', 'a removed person cannot approve a new sign-in',
    pg_temp.ta_approve('leaver', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'x'), 'ERR:42501:%');
  perform pg_temp.ta_as('owner', 'select public.admin_team_set_member(''issue4294t-leaver@test.local'', ''growth'', ''active'')::text');
  update public.admin_team_members set accepted_at = now() where email = 'issue4294t-leaver@test.local';
  perform pg_temp.ta_check('A-6', 'adding the person back does not revive the old token', pg_temp.ta_who(pg_temp.ta_id('gl.access')), 'invalid');
  perform pg_temp.ta_check('A-6', 'or the old refresh token', pg_temp.ta_refresh('gl', pg_temp.ta_c('app'), 'x'), '{"error": "invalid_grant"}');

  -- Two accounts on one address.
  insert into auth.users (id, email, email_confirmed_at)
  values ('4294a000-0000-4000-a000-0000000000f5', 'ISSUE4294T-TWIN@test.local', now());
  -- Approve may still hand out a code (it checks only the phone or social
  -- sign-in conflict); the exchange is where the one-account rule bites.
  perform pg_temp.ta_approve('twin', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 't1');
  perform pg_temp.ta_check('A-6', 'a person with two accounts on one address gets no token',
    pg_temp.ta_exchange('t1', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'gt'), '{"error": "invalid_grant"}');
  perform pg_temp.ta_check('A-6', 'and no live grant or sign-in key is left for them',
    (select count(*)::text from public.mingla_connector_oauth_grants where owner_email = 'issue4294t-twin@test.local' and revoked_at is null)
    || '/' ||
    (select count(*)::text from public.team_agent_keys where owner_email = 'issue4294t-twin@test.local' and revoked_at is null and kind <> 'personal'),
    '0/0');
  update auth.users set phone = '+15550004294' where lower(email) = 'issue4294t-twin@test.local';
  perform pg_temp.ta_like('A-6', 'a person whose account also signs in by phone cannot approve',
    pg_temp.ta_approve('twin', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'x'), 'ERR:42501:%');

  -- An agent-originated approve (a gateway row for this transaction).
  perform pg_temp.ta_like('A-6', 'an approve that came through an agent is refused',
    pg_temp.ta_approve('agent:growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'x'), 'ERR:42501:%');
  perform pg_temp.ta_like('A-6', 'an agent cannot set a company key even for an owner',
    pg_temp.ta_as('agent:owner', format('select public.mingla_connector_set_key(%L, %L)::text', 'posthog', pg_temp.ta_c('marker'))),
    'ERR:42501:%');
  perform pg_temp.ta_like('A-6', 'an agent cannot disconnect',
    pg_temp.ta_as('agent:owner', format('select public.mingla_connector_disconnect(%L)::text', gen_random_uuid())), 'ERR:42501:%');
  perform pg_temp.ta_like('A-6', 'an agent cannot save a company tool',
    pg_temp.ta_as('agent:owner', 'select public.mingla_connector_registry_save(''{"slug":"posthog","enabled":false}''::jsonb)::text'),
    'ERR:42501:%');

  -- A non-owner cannot end someone else's connection, by guessing or by knowing its id.
  perform pg_temp.ta_approve('growth', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'd1');
  perform pg_temp.ta_exchange('d1', pg_temp.ta_c('app'), pg_temp.ta_c('app_redirect'), pg_temp.ta_c('verifier'), 'gd');
  v_grant := (select id::text from public.mingla_connector_oauth_grants
               where refresh_hash = pg_temp.ta_digest(pg_temp.ta_id('gd.refresh')));
  perform pg_temp.ta_like('A-6', 'an admin cannot disconnect a growth connection',
    pg_temp.ta_as('admin', format('select public.mingla_connector_disconnect(%L)::text', v_grant)), 'ERR:P0002:%');
  perform pg_temp.ta_like('A-6', 'anon cannot disconnect',
    pg_temp.ta_as('anon', format('select public.mingla_connector_disconnect(%L)::text', v_grant)), 'ERR:42501:%');
  perform pg_temp.ta_check('A-6', 'the connection is still live', pg_temp.ta_who(pg_temp.ta_id('gd.access')), 'ok/growth');
  perform pg_temp.ta_check('A-6', 'an admin''s own list does not show it',
    (pg_temp.ta_as('admin', 'select public.mingla_connector_connections_mine()::text') like '%' || v_grant || '%')::text, 'false');
end;
$a6$;

-- ---------------------------------------------------------------------------
-- A-7 personal keys and kinds never replace each other.
-- ---------------------------------------------------------------------------
do $a7$
begin
  perform pg_temp.ta_approve('growth', pg_temp.ta_c('code'), pg_temp.ta_c('loop'), pg_temp.ta_c('verifier'), 'cc1');
  perform pg_temp.ta_exchange('cc1', pg_temp.ta_c('code'), pg_temp.ta_c('loop'), pg_temp.ta_c('verifier'), 'gcc');
  perform pg_temp.ta_check('A-7', 'Claude Code signed in', pg_temp.ta_who(pg_temp.ta_id('gcc.access')), 'ok/growth');
  perform pg_temp.ta_check('A-7', 'the Claude app connection is still live beside it', pg_temp.ta_who(pg_temp.ta_id('gd.access')), 'ok/growth');
  -- A brand new personal key from the page replaces only the personal key.
  perform pg_temp.ta_keep('growth.personal2',
    pg_temp.ta_as('growth', 'select public.team_agent_key_create(''claude'')::text')::jsonb ->> 'key');
  perform pg_temp.ta_check('A-7', 'the new personal key works', pg_temp.ta_who(pg_temp.ta_id('growth.personal2')), 'ok/growth');
  perform pg_temp.ta_check('A-7', 'the old personal key was replaced', pg_temp.ta_who(pg_temp.ta_id('growth.personal')), 'invalid');
  perform pg_temp.ta_check('A-7', 'the Claude app sign-in survived a new personal key', pg_temp.ta_who(pg_temp.ta_id('gd.access')), 'ok/growth');
  perform pg_temp.ta_check('A-7', 'the Claude Code sign-in survived a new personal key', pg_temp.ta_who(pg_temp.ta_id('gcc.access')), 'ok/growth');
  -- Revoking the personal key from My agent leaves sign-ins alone.
  perform pg_temp.ta_as('growth', format('select public.team_agent_key_revoke(%L)::text',
    (select id from public.team_agent_keys where key_hash = pg_temp.ta_digest(pg_temp.ta_id('growth.personal2')))));
  perform pg_temp.ta_check('A-7', 'after revoking the personal key the sign-in still works', pg_temp.ta_who(pg_temp.ta_id('gd.access')), 'ok/growth');
  -- Refresh Claude Code twice; the personal key of the owner never moves.
  perform pg_temp.ta_refresh('gcc', pg_temp.ta_c('code'), 'gcc2');
  perform pg_temp.ta_refresh('gcc2', pg_temp.ta_c('code'), 'gcc3');
  perform pg_temp.ta_check('A-7', 'two refreshes later only the newest Claude Code token works',
    pg_temp.ta_who(pg_temp.ta_id('gcc.access')) || ',' || pg_temp.ta_who(pg_temp.ta_id('gcc2.access')) || ',' || pg_temp.ta_who(pg_temp.ta_id('gcc3.access')),
    'invalid,invalid,ok/growth');
  perform pg_temp.ta_check('A-7', 'one active key per kind for this person',
    (select string_agg(kind || ':' || n, ',' order by kind) from (
       select kind, count(*) n from public.team_agent_keys
        where owner_email = 'issue4294t-growth@test.local' and revoked_at is null group by kind) x),
    'claude_app:1,claude_code:1');
  perform pg_temp.ta_check('A-7', 'the owner''s personal key never moved', pg_temp.ta_who(pg_temp.ta_id('owner.personal')), 'ok/owner');
  perform pg_temp.ta_check('A-7', 'My agent shows no sign-in key to its holder',
    (select count(*)::text from jsonb_array_elements(pg_temp.ta_as('growth', 'select public.team_agent_keys_mine()::text')::jsonb -> 'keys') k
      where (k ->> 'key_id')::uuid in (select id from public.team_agent_keys where kind <> 'personal')), '0');
end;
$a7$;

-- ---------------------------------------------------------------------------
-- A-8 role escalation and changes between begin and the key read.
-- ---------------------------------------------------------------------------
do $a8$
declare
  v jsonb;
  v_call text;
begin
  -- The seeded rows are off, owner only, nothing listed, no key: default deny.
  perform pg_temp.ta_check('A-8', 'the seeded company tools start closed',
    (select string_agg(slug || ':' || enabled || ':' || (vault_secret_id is null) || ':' || cardinality(tool_allowlist), ',' order by slug)
       from public.mingla_connector_upstreams),
    'appsflyer:false:true:0,metaads:false:true:0,posthog:false:true:0,sentry:false:true:0');
  -- An owner-only tool with a key and a listed tool.
  perform pg_temp.ta_as('owner', format('select public.mingla_connector_set_key(%L, %L)::text', 'posthog', pg_temp.ta_c('marker')));
  perform pg_temp.ta_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"posthog","enabled":true,"allowed_roles":["owner"],"tool_allowlist":["exec","read_things"]}''::jsonb)::text');
  v := pg_temp.ta_as('service', format('select public.mingla_connector_upstreams_for(%L)::text', pg_temp.ta_digest(pg_temp.ta_id('gd.access'))))::jsonb;
  perform pg_temp.ta_check('A-8', 'growth does not see an owner-only tool', (v -> 'upstreams')::text, '[]');
  v := pg_temp.ta_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::text',
         pg_temp.ta_digest(pg_temp.ta_id('gd.access')), 'posthog', 'exec', 'tester'))::jsonb;
  perform pg_temp.ta_check('A-8', 'growth calling an owner-only tool is not_allowed', v ->> 'token', 'not_allowed');
  perform pg_temp.ta_check('A-8', 'and its refused call cannot read the key',
    pg_temp.ta_as('service', format('select public.mingla_connector_upstream_key(%L)::text', v ->> 'call_id')), '{"ok": false}');
  perform pg_temp.ta_check('A-8', 'growth''s tools/list on an owner-only tool is not_allowed',
    pg_temp.ta_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''token''',
      pg_temp.ta_digest(pg_temp.ta_id('gd.access')), 'posthog', 'tools/list', 'tester')), 'not_allowed');
  perform pg_temp.ta_check('A-8', 'an admin is not an owner either',
    pg_temp.ta_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''token''',
      pg_temp.ta_digest(pg_temp.ta_id('gx2.access')), 'posthog', 'exec', 'tester')), 'not_allowed');

  -- The owner's own call, then the row changes before the key is read.
  v_call := pg_temp.ta_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''call_id''',
              pg_temp.ta_digest(pg_temp.ta_id('owner.personal')), 'posthog', 'exec', 'tester'));
  update public.mingla_connector_upstreams set enabled = false where slug = 'posthog';
  perform pg_temp.ta_check('A-8', 'a row turned off after begin hands out no key',
    pg_temp.ta_as('service', format('select public.mingla_connector_upstream_key(%L)::text', v_call)), '{"ok": false}');
  update public.mingla_connector_upstreams set enabled = true where slug = 'posthog';
  perform pg_temp.ta_check('A-8', 'turned back on, the same running call reads it (control)',
    pg_temp.ta_as('service', format('select (public.mingla_connector_upstream_key(%L)->>''ok'')', v_call)), 'true');
  update public.mingla_connector_upstreams set allowed_roles = '{admin}' where slug = 'posthog';
  perform pg_temp.ta_check('A-8', 'a role removed after begin hands out no key',
    pg_temp.ta_as('service', format('select public.mingla_connector_upstream_key(%L)::text', v_call)), '{"ok": false}');
  update public.mingla_connector_upstreams set allowed_roles = '{owner}', tool_allowlist = '{read_things}' where slug = 'posthog';
  perform pg_temp.ta_check('A-8', 'a tool unlisted after begin hands out no key',
    pg_temp.ta_as('service', format('select public.mingla_connector_upstream_key(%L)::text', v_call)), '{"ok": false}');
  update public.mingla_connector_upstreams set tool_allowlist = '{exec,read_things}' where slug = 'posthog';
  update public.mingla_connector_calls set started_at = clock_timestamp() - interval '61 seconds' where id = v_call::uuid;
  perform pg_temp.ta_check('A-8', 'a call older than a minute hands out no key',
    pg_temp.ta_as('service', format('select public.mingla_connector_upstream_key(%L)::text', v_call)), '{"ok": false}');
  v_call := pg_temp.ta_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''call_id''',
              pg_temp.ta_digest(pg_temp.ta_id('owner.personal')), 'posthog', 'exec', 'tester'));
  perform pg_temp.ta_as('owner', 'select public.mingla_connector_clear_key(''posthog'')::text');
  perform pg_temp.ta_check('A-8', 'a key removed after begin is gone',
    pg_temp.ta_as('service', format('select public.mingla_connector_upstream_key(%L)::text', v_call)), '{"ok": false}');
  perform pg_temp.ta_check('A-8', 'and the row is off',
    (select enabled::text from public.mingla_connector_upstreams where slug = 'posthog'), 'false');
  perform pg_temp.ta_check('A-8', 'a random call id reads nothing',
    pg_temp.ta_as('service', format('select public.mingla_connector_upstream_key(%L)::text', gen_random_uuid())), '{"ok": false}');
end;
$a8$;

-- ---------------------------------------------------------------------------
-- A-9 allow-list bypass by name tricks.
-- ---------------------------------------------------------------------------
do $a9$
declare
  r record;
  v jsonb;
begin
  perform pg_temp.ta_as('owner', format('select public.mingla_connector_set_key(%L, %L)::text', 'posthog', pg_temp.ta_c('marker')));
  perform pg_temp.ta_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"posthog","enabled":true,"allowed_roles":["owner"],"tool_allowlist":["exec"]}''::jsonb)::text');
  perform pg_temp.ta_check('A-9', 'the exact name is allowed (control)',
    pg_temp.ta_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::jsonb->>''ok''',
      pg_temp.ta_digest(pg_temp.ta_id('owner.personal')), 'posthog', 'exec', 'tester')), 'true');
  for r in select * from (values
      ('posthog', 'EXEC'), ('posthog', 'Exec'), ('posthog', 'exec '), ('posthog', ' exec'),
      ('posthog', E'exec\t'), ('posthog', E'exec\n'), ('posthog', 'exec' || chr(8203)), ('posthog', chr(1077) || 'xec'),
      ('posthog', 'ex' || chr(1077) || 'c'), ('posthog', '_exec'), ('posthog', 'exec_'), ('posthog', 'posthog__exec'),
      ('posthog', 'exec.'), ('posthog', '.exec'), ('posthog', '%'), ('posthog', '*'), ('posthog', 'ex%'),
      ('posthog', repeat('e', 65)), ('posthog', ''), ('posthog', null), ('posthog', 'tools/call'),
      ('PostHog', 'exec'), ('posthog ', 'exec'), ('posthog_', 'exec'), ('post_hog', 'exec'), ('', 'exec'),
      (null, 'exec'), ('p', 'exec'), ('posthog' || chr(8203), 'exec'), ('p' || chr(1086) || 'sthog', 'exec')
    ) as t(slug, tool)
  loop
    v := pg_temp.ta_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::text',
           pg_temp.ta_digest(pg_temp.ta_id('owner.personal')), r.slug, r.tool, 'tester'))::jsonb;
    perform pg_temp.ta_check('A-9', format('call %L / %L is not allowed', r.slug, r.tool), v ->> 'token', 'not_allowed');
    perform pg_temp.ta_check('A-9', format('call %L / %L reads no key', r.slug, r.tool),
      pg_temp.ta_as('service', format('select public.mingla_connector_upstream_key(%L)::text', v ->> 'call_id')), '{"ok": false}');
  end loop;
  perform pg_temp.ta_check('A-9', 'every refused name was logged under a safe name',
    (select count(*)::text from public.mingla_connector_calls
      where tool !~ '^[A-Za-z0-9_.-]{1,64}$' and tool not in ('tools/list', 'invalid')), '0');
  -- The allow-list itself refuses the same tricks.
  for r in select * from (values ('EXEC ' ), (chr(1077) || 'xec'), ('exec' || chr(8203)), ('ex*'), ('tools/list'),
                                 (repeat('e', 65)), (''), ('a b')) as t(tool)
  loop
    perform pg_temp.ta_like('A-9', format('the allow-list refuses %L', r.tool),
      pg_temp.ta_as('owner', format('select public.mingla_connector_registry_save(%L::jsonb)::text',
        jsonb_build_object('slug', 'posthog', 'tool_allowlist', jsonb_build_array(r.tool)))), 'ERR:22023:invalid_tools:%');
  end loop;
  perform pg_temp.ta_like('A-9', 'roles outside the four are refused',
    pg_temp.ta_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"posthog","allowed_roles":["Owner"]}''::jsonb)::text'),
    'ERR:22023:invalid_roles:%');
  perform pg_temp.ta_like('A-9', 'a role given as a non-string is refused',
    pg_temp.ta_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"posthog","allowed_roles":[{"r":"owner"}]}''::jsonb)::text'),
    'ERR:22023:invalid_roles:%');
  perform pg_temp.ta_like('A-9', '"enabled" as the string true is refused',
    pg_temp.ta_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"posthog","enabled":"true"}''::jsonb)::text'),
    'ERR:22023:invalid_enabled:%');
end;
$a9$;

-- ---------------------------------------------------------------------------
-- A-10 key read-back.
-- ---------------------------------------------------------------------------
do $a10$
declare
  v_svc uuid;
  v_before text;
  v_leak text;
  r record;
begin
  -- A secret the platform keeps for itself (as cron SQL does).
  v_svc := vault.create_secret('SVCROLE4294-do-not-leak-0123456789abcdef', 'service_role_key_tester4294', 'tester');
  v_before := (select coalesce(vault_secret_id::text, 'none') from public.mingla_connector_upstreams where slug = 'posthog');
  for r in select * from (values ('vault_secret_id'), ('Vault_Secret_Id'), ('VAULT_SECRET_ID'), ('vault_secret_id '),
                                 ('secret_id'), ('secret'), ('key'), ('api_key'), ('key_updated_by'), ('key_updated_at'),
                                 ('updated_by'), ('created_at')) as t(field)
  loop
    perform pg_temp.ta_like('A-10', format('registry_save refuses the field %L', r.field),
      pg_temp.ta_as('owner', format('select public.mingla_connector_registry_save(%L::jsonb)::text',
        jsonb_build_object('slug', 'posthog', r.field, v_svc))), 'ERR:22023:invalid_field:%');
  end loop;
  perform pg_temp.ta_check('A-10', 'no save pointed the row at another secret',
    (select coalesce(vault_secret_id::text, 'none') from public.mingla_connector_upstreams where slug = 'posthog'), v_before);
  perform pg_temp.ta_check('A-10', 'the platform secret is still pointed at by no company tool',
    (select count(*)::text from public.mingla_connector_upstreams where vault_secret_id = v_svc), '0');
  perform pg_temp.ta_check('A-10', 'a new tool cannot be made pointing at it either',
    left(pg_temp.ta_as('owner', format('select public.mingla_connector_registry_save(%L::jsonb)::text',
      jsonb_build_object('slug', 'evil', 'label', 'E', 'mcp_url', 'https://mcp.evil-tools.example/mcp', 'vault_secret_id', v_svc))), 30),
    'ERR:22023:invalid_field: A com');

  -- Refusals that carry the marker never repeat it.
  perform pg_temp.ta_like('A-10', 'an oversized key with the marker inside is refused',
    pg_temp.ta_as('owner', format('select public.mingla_connector_set_key(%L, %L)::text', 'posthog',
      repeat('x', 4090) || pg_temp.ta_c('marker2'))), 'ERR:22023:invalid_key:%');
  perform pg_temp.ta_like('A-10', 'a key with a control character is refused',
    pg_temp.ta_as('owner', format('select public.mingla_connector_set_key(%L, %L)::text', 'posthog', pg_temp.ta_c('marker2') || chr(7))),
    'ERR:22023:invalid_key:%');
  perform pg_temp.ta_like('A-10', 'a key for a tool that is not there is refused',
    pg_temp.ta_as('owner', format('select public.mingla_connector_set_key(%L, %L)::text', 'nosuchtool', pg_temp.ta_c('marker2'))),
    'ERR:P0002:%');
  perform pg_temp.ta_like('A-10', 'a key named as the slug is refused without echo',
    pg_temp.ta_as('owner', format('select public.mingla_connector_set_key(%L, %L)::text', pg_temp.ta_c('marker2'), pg_temp.ta_c('marker2'))),
    'ERR:P0002:%');
  perform pg_temp.ta_like('A-10', 'an admin setting a key is refused',
    pg_temp.ta_as('admin', format('select public.mingla_connector_set_key(%L, %L)::text', 'posthog', pg_temp.ta_c('marker2'))), 'ERR:42501:%');
  perform pg_temp.ta_like('A-10', 'anon setting a key is refused',
    pg_temp.ta_as('anon', format('select public.mingla_connector_set_key(%L, %L)::text', 'posthog', pg_temp.ta_c('marker2'))), 'ERR:42501:%');
  perform pg_temp.ta_check('A-10', 'no refused set_key wrote to Vault',
    (select count(*)::text from vault.decrypted_secrets where decrypted_secret like '%' || pg_temp.ta_c('marker2') || '%'), '0');

  -- Every client read, by every person, after a key is set.
  perform pg_temp.ta_as('owner', format('select public.mingla_connector_set_key(%L, %L)::text', 'sentry', pg_temp.ta_c('marker2')));
  perform pg_temp.ta_as('owner', 'select public.mingla_connector_registry_list()::text');
  perform pg_temp.ta_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"sentry","notes":"tester"}''::jsonb)::text');
  perform pg_temp.ta_as('owner', 'select public.mingla_connector_calls_recent(100)::text');
  perform pg_temp.ta_as('owner', 'select public.mingla_connector_connections_mine()::text');
  perform pg_temp.ta_as('owner', 'select public.team_agent_keys_overview()::text');
  perform pg_temp.ta_as('owner', 'select public.team_agent_keys_mine()::text');
  perform pg_temp.ta_as('growth', 'select public.mingla_connector_registry_list()::text');
  perform pg_temp.ta_as('admin', 'select public.mingla_connector_calls_recent(100)::text');
  perform pg_temp.ta_as('owner', 'select public.mingla_connector_set_key(''sentry'', null)::text');
  perform pg_temp.ta_as('owner', 'select public.mingla_connector_clear_key(''sentry'')::text');
  select string_agg(s.src, ' | ') into v_leak from ta_seen s
   where pg_temp.ta_leaks(s.body, pg_temp.ta_c('marker')) or pg_temp.ta_leaks(s.body, pg_temp.ta_c('marker2'))
      or pg_temp.ta_leaks(s.body, 'SVCROLE4294-do-not-leak-0123456789abcdef');
  -- The service role reading the key for a running allowed call is the one sanctioned read.
  select string_agg(s.src, ' | ') into v_leak from ta_seen s
   where (pg_temp.ta_leaks(s.body, pg_temp.ta_c('marker')) or pg_temp.ta_leaks(s.body, pg_temp.ta_c('marker2'))
          or pg_temp.ta_leaks(s.body, 'SVCROLE4294-do-not-leak-0123456789abcdef'))
     and s.src not like 'service: select (public.mingla_connector_upstream_key(%';
  perform pg_temp.ta_check('A-10', 'no answer or refusal to anyone but the reader holds an 8-character slice of a key',
    coalesce(v_leak, 'none'), 'none');
  perform pg_temp.ta_check('A-10', 'no audit row holds a slice of a key',
    (select count(*)::text from public.admin_audit_log a
      where pg_temp.ta_leaks(row_to_json(a)::text, pg_temp.ta_c('marker')) or pg_temp.ta_leaks(row_to_json(a)::text, pg_temp.ta_c('marker2'))),
    '0');
  perform pg_temp.ta_check('A-10', 'no call-log row holds a slice of a key',
    (select count(*)::text from public.mingla_connector_calls c
      where pg_temp.ta_leaks(row_to_json(c)::text, pg_temp.ta_c('marker')) or pg_temp.ta_leaks(row_to_json(c)::text, pg_temp.ta_c('marker2'))),
    '0');
  perform pg_temp.ta_check('A-10', 'no agent call row holds a slice of a key',
    (select count(*)::text from public.team_agent_calls c
      where pg_temp.ta_leaks(row_to_json(c)::text, pg_temp.ta_c('marker')) or pg_temp.ta_leaks(row_to_json(c)::text, pg_temp.ta_c('marker2'))),
    '0');
  perform pg_temp.ta_check('A-10', 'no grant, code or spent row holds a token in the clear',
    (select (count(*) filter (where row_to_json(g)::text ~ 'mgl[aor]_'))::text from public.mingla_connector_oauth_grants g), '0');
  perform pg_temp.ta_check('A-10', 'Remove key deleted the Vault secret for sentry',
    (select count(*)::text from vault.secrets where name like 'mingla_connector:sentry:%'), '0');

  -- No client role reaches Vault, the tables, or the reader.
  for r in select * from (values ('anon'), ('owner'), ('growth')) as t(who) loop
    perform pg_temp.ta_like('A-10', r.who || ' cannot read vault.decrypted_secrets',
      pg_temp.ta_as(r.who, 'select count(*)::text from vault.decrypted_secrets'), 'ERR:42501:%');
    perform pg_temp.ta_like('A-10', r.who || ' cannot read vault.secrets',
      pg_temp.ta_as(r.who, 'select count(*)::text from vault.secrets'), 'ERR:42501:%');
    perform pg_temp.ta_like('A-10', r.who || ' cannot create a Vault secret',
      pg_temp.ta_as(r.who, 'select vault.create_secret(''x'', ''y'', ''z'')::text'), 'ERR:42501:%');
    perform pg_temp.ta_like('A-10', r.who || ' cannot call the key reader',
      pg_temp.ta_as(r.who, format('select public.mingla_connector_upstream_key(%L)::text', gen_random_uuid())), 'ERR:42501:%');
    perform pg_temp.ta_like('A-10', r.who || ' cannot read the company tools table',
      pg_temp.ta_as(r.who, 'select count(*)::text from public.mingla_connector_upstreams'), 'ERR:42501:%');
    perform pg_temp.ta_like('A-10', r.who || ' cannot read grants',
      pg_temp.ta_as(r.who, 'select count(*)::text from public.mingla_connector_oauth_grants'), 'ERR:42501:%');
    perform pg_temp.ta_like('A-10', r.who || ' cannot write the call log',
      pg_temp.ta_as(r.who, 'insert into public.mingla_connector_calls (owner_email, key_id, actor_role, upstream, tool) values (''a'', gen_random_uuid(), ''owner'', ''posthog'', ''exec'') returning ''x'''),
      'ERR:42501:%');
  end loop;
  perform pg_temp.ta_check('A-10', 'the platform secret is untouched',
    (select decrypted_secret from vault.decrypted_secrets where id = v_svc), 'SVCROLE4294-do-not-leak-0123456789abcdef');
end;
$a10$;

-- ---------------------------------------------------------------------------
-- A-11 structure.
-- ---------------------------------------------------------------------------
do $a11$
declare
  r record;
begin
  perform pg_temp.ta_check('A-11', 'set_key never builds SQL text (no EXECUTE, no format)',
    (pg_get_functiondef('public.mingla_connector_set_key(text,text)'::regprocedure) ~* '(\mexecute\M|format\s*\()')::text, 'false');
  perform pg_temp.ta_check('A-11', 'only set_key writes a Vault secret',
    (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        and (p.proname like 'mingla_connector_%' or p.proname like 'team_agent_%')
        and pg_get_functiondef(p.oid) ~* 'vault\.(create_secret|update_secret)'), 'mingla_connector_set_key');
  perform pg_temp.ta_check('A-11', 'only clear_key deletes a Vault secret',
    (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        and (p.proname like 'mingla_connector_%' or p.proname like 'team_agent_%')
        and pg_get_functiondef(p.oid) ~* 'delete\s+from\s+vault\.'), 'mingla_connector_clear_key');
  perform pg_temp.ta_check('A-11', 'only the reader reads decrypted secrets among connector functions',
    (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname like 'mingla_connector_%'
        and pg_get_functiondef(p.oid) ~* 'vault\.decrypted_secrets'), 'mingla_connector_upstream_key');
  for r in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'mingla_connector_%'
              and p.proname not in ('mingla_connector_oauth_approve', 'mingla_connector_connections_mine', 'mingla_connector_disconnect',
                                    'mingla_connector_registry_list', 'mingla_connector_registry_save', 'mingla_connector_set_key',
                                    'mingla_connector_clear_key', 'mingla_connector_registry_delete', 'mingla_connector_calls_recent')
  loop
    perform pg_temp.ta_check('A-11', format('%s(%s) is closed to anon and authenticated', r.proname, r.args),
      (has_function_privilege('anon', r.oid, 'EXECUTE') or has_function_privilege('authenticated', r.oid, 'EXECUTE'))::text, 'false');
  end loop;
  perform pg_temp.ta_check('A-11', 'the key maker and resolver stay closed to clients',
    (has_function_privilege('authenticated', 'public.team_agent_key_issue(text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.team_agent_resolve(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.team_agent_key_issue(text,text,text,text)', 'EXECUTE'))::text, 'false');
  perform pg_temp.ta_check('A-11', 'every connector function is SECURITY DEFINER with an empty search path or is a pure SQL helper',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname like 'mingla_connector_%'
        and not coalesce('search_path=""' = any (p.proconfig), false)), '0');
  perform pg_temp.ta_check('A-11', 'no connector table grants anything to a client role',
    (select count(*)::text from information_schema.role_table_grants
      where table_schema = 'public' and table_name like 'mingla_connector_%' and grantee in ('anon', 'authenticated', 'PUBLIC')), '0');
  perform pg_temp.ta_check('A-11', 'no connector table has a policy',
    (select count(*)::text from pg_policies where schemaname = 'public' and tablename like 'mingla_connector_%'), '0');
end;
$a11$;

do $verdict$
declare
  v_total int;
  v_failed int;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from ta_results;
  for r in select * from ta_results where not ok order by seq loop
    raise warning 'ISSUE-4294 TESTER FAILED % | % | %', r.test, r.label, r.detail;
  end loop;
  if v_failed > 0 or v_total < 200 then
    raise exception 'ISSUE-4294 TESTER FAIL: % of % checks failed (at least 200 must run)', v_failed, v_total;
  end if;
  raise notice 'ISSUE-4294 TESTER PASS: % checks across A-1..A-11, 0 failed', v_total;
end;
$verdict$;

rollback;
