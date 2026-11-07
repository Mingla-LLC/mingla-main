-- Issue #4294 — implementor suite for company sign-in (PostgreSQL 17).
--
-- Proves, on the fully replayed schema:
--   S-1  the studio row is seeded off, owner only, sign-in kind, with its
--        display label, hidden words, generation tools and a cap of 40;
--        the key rows are kind 'key'
--   S-2  the owner-only functions refuse admin, growth and anon
--   S-3  begin: the row must be a sign-in row, the callback exact, the token
--        and issuer addresses on the tool's own site; a new start ends the
--        older one
--   S-4  a state works once, within its time, never after a new start
--   S-5  complete: tokens into Vault, the row says who and when; a second
--        complete, or one without a claim, does nothing
--   S-6  a sign-in row turns on only when connected; it takes no key
--   S-7  the proxy steps: call_begin names the kind, label and hidden words;
--        the access token is read only for a running allowed call; the key
--        reader never answers for a sign-in row
--   S-8  renewal is one at a time: a second lease, a stale generation, a
--        wrong lease all get PT409 and change nothing; the right lease
--        stores and moves the generation
--   S-9  a refused renewal: Reconnect needed, calls refused with
--        upstream_key_rejected, the tools leave the list; Reconnect clears it
--   S-10 the daily generation cap per person
--   S-11 Disconnect deletes the tokens and turns the row off
--   S-12 no answer, refusal, audit row or table row outside Vault holds any
--        8-character slice of a token
--   S-13 the migration's self-check passes again
--
-- One transaction, rolled back. Never run on production. Runs as the
-- image's admin role from the repository root (S-13 reads the migration).
-- MINGLA-INVARIANT: I-4294-9 | issue #4294 | A company sign-in's tokens live only in Supabase Vault, are written only by signin_complete, signin_refresh_store and signin_disconnect, are read only for a running allowed call, and never appear in a client answer, audit row or table column.
-- MINGLA-INVARIANT: I-4294-10 | issue #4294 | A company sign-in state works once, within ten minutes, for the row and owner that started it; a newer start ends it.
-- MINGLA-INVARIANT: I-4294-11 | issue #4294 | Company sign-in renewal is serialised per row: a second renewer, a stale generation or a store without the current lease raises PT409 and changes nothing.
-- MINGLA-INVARIANT: I-4294-12 | issue #4294 | A generation tool call over the person's daily cap is refused by call_begin before any request leaves Mingla.

\set ON_ERROR_STOP on
\set tsi_selfcheck `sed -n '/^DO \$c4294s\$/,/^\$c4294s\$;/p' supabase/migrations/20280428024294_issue_4294_company_signin.sql`

begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;

create temp table tsi_src (k text primary key, sql text) on commit drop;
insert into tsi_src values ('selfcheck', :'tsi_selfcheck');

create temp table tsi_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tsi_people (who, id, email) values
  ('owner',  '42949000-0000-4000-a000-000000000001', 'issue4294si-owner@test.local'),
  ('admin',  '42949000-0000-4000-a000-000000000002', 'issue4294si-admin@test.local'),
  ('growth', '42949000-0000-4000-a000-000000000003', 'issue4294si-growth@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tsi_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue4294si-owner@test.local', 'owner', 'active', now()),
  ('issue4294si-admin@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
values ('issue4294si-growth@test.local', 'growth', 'active', now());

create temp table tsi_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tsi_ids (k text primary key, v text) on commit drop;
create temp table tsi_seen (seq serial primary key, src text, body text) on commit drop;

create function pg_temp.tsi_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from tsi_people where who = p_who;
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
  insert into tsi_seen (src, body) values (p_who || ': ' || left(p_sql, 70), coalesce(v_out, ''));
  return v_out;
end;
$fn$;

create function pg_temp.tsi_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tsi_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 300), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tsi_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into tsi_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 300), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.tsi_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.tsi_id(p_k text) returns text
language sql as $fn$ select v from tsi_ids where k = p_k $fn$;

create function pg_temp.tsi_keep(p_k text, p_v text) returns void
language sql as $fn$
  insert into tsi_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;

-- Does a text hold any 8-character slice of a token?
create function pg_temp.tsi_leaks(p_text text, p_token text) returns boolean
language sql as $fn$
  select p_text is not null and p_token is not null and exists (
    select 1 from generate_series(1, char_length(p_token) - 7) i
     where strpos(p_text, substr(p_token, i, 8)) > 0)
$fn$;

-- A begin as the owner with the right callback and Magnific-shaped addresses.
create function pg_temp.tsi_begin(p_who text, p_slug text, p_state text) returns text
language sql as $fn$
  select pg_temp.tsi_as(p_who, format(
    'select public.mingla_connector_signin_begin(%L, %L, %L, %L, %L, %L, %L)::text',
    p_slug, pg_temp.tsi_digest(p_state), repeat('B', 60),
    'https://auth.magnific.com/realms/mcp',
    'https://auth.magnific.com/realms/mcp/protocol/openid-connect/token',
    'https://mcp.magnific.com',
    'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent/oauth/upstream-callback'))
$fn$;

create function pg_temp.tsi_begin_call(p_key text, p_slug text, p_tool text) returns jsonb
language sql as $fn$
  select pg_temp.tsi_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::text',
           pg_temp.tsi_digest(p_key), p_slug, p_tool, 'issue4294si'))::jsonb
$fn$;

-- Personal keys for the people who make calls.
do $keys$
begin
  perform pg_temp.tsi_keep('growth.key', pg_temp.tsi_as('growth', 'select public.team_agent_key_create(''claude'')::text')::jsonb ->> 'key');
  perform pg_temp.tsi_keep('owner.key', pg_temp.tsi_as('owner', 'select public.team_agent_key_create(''claude'')::text')::jsonb ->> 'key');
  -- The tokens the tool's sign-in server hands out in this suite.
  perform pg_temp.tsi_keep('access1', 'AT1-' || md5('a1') || md5('a1b'));
  perform pg_temp.tsi_keep('refresh1', 'RT1-' || md5('r1') || md5('r1b'));
  perform pg_temp.tsi_keep('access2', 'AT2-' || md5('a2') || md5('a2b'));
  perform pg_temp.tsi_keep('refresh2', 'RT2-' || md5('r2') || md5('r2b'));
  perform pg_temp.tsi_keep('access3', 'AT3-' || md5('a3') || md5('a3b'));
  perform pg_temp.tsi_keep('refresh3', 'RT3-' || md5('r3') || md5('r3b'));
end;
$keys$;

-- ---------------------------------------------------------------------------
-- S-1 the seeded studio row.
-- ---------------------------------------------------------------------------
do $s1$
declare
  v jsonb;
begin
  v := (select r from jsonb_array_elements(pg_temp.tsi_as('owner', 'select public.mingla_connector_registry_list()::text')::jsonb -> 'rows') r
         where r ->> 'slug' = 'studio');
  perform pg_temp.tsi_check('S-1', 'studio: off, owner only, sign-in, not connected',
    (v ->> 'enabled') || ':' || (v -> 'allowed_roles')::text || ':' || (v ->> 'auth_kind') || ':' || (v -> 'signin' ->> 'connected'),
    'false:["owner"]:signin:false');
  perform pg_temp.tsi_check('S-1', 'studio: label, address, hidden words',
    (v ->> 'label') || '|' || (v ->> 'display_label') || '|' || (v ->> 'mcp_url') || '|' || (v -> 'hide_words')::text,
    'Mingla Studio|Mingla Studio|https://mcp.magnific.com|["Magnific", "Freepik"]');
  perform pg_temp.tsi_check('S-1', 'studio: 41 starter tools, no delete, share, clone or 3D tool',
    jsonb_array_length(v -> 'tool_allowlist')::text || ':' ||
      (select count(*)::text from jsonb_array_elements_text(v -> 'tool_allowlist') t where t ~ '(delete|share|invite|clone|3d|team)'),
    '41:0');
  perform pg_temp.tsi_check('S-1', 'studio: the 12 generation tools, every one allowed, cap 40',
    jsonb_array_length(v -> 'generation_tools')::text || ':' ||
      (select count(*)::text from jsonb_array_elements_text(v -> 'generation_tools') g
        where not (v -> 'tool_allowlist') ? g) || ':' || (v ->> 'daily_generation_cap'),
    '12:0:40');
  perform pg_temp.tsi_check('S-1', 'the key rows are key kind with no sign-in block',
    (select string_agg(slug || ':' || auth_kind, ',' order by slug) from public.mingla_connector_upstreams where slug <> 'studio'),
    'appsflyer:key,metaads:key,posthog:key,sentry:key');
  perform pg_temp.tsi_check('S-1', 'a key row''s Admin view has no sign-in block',
    (select (r -> 'signin')::text from jsonb_array_elements(pg_temp.tsi_as('owner', 'select public.mingla_connector_registry_list()::text')::jsonb -> 'rows') r
      where r ->> 'slug' = 'posthog'), 'null');
end;
$s1$;

-- ---------------------------------------------------------------------------
-- S-2 owner only.
-- ---------------------------------------------------------------------------
do $s2$
declare
  r record;
begin
  for r in select * from (values ('admin'), ('growth')) x(who) loop
    perform pg_temp.tsi_like('S-2', r.who || ' cannot read sign-in status',
      pg_temp.tsi_as(r.who, 'select public.mingla_connector_signin_status(''studio'')::text'), 'ERR:42501:%');
    perform pg_temp.tsi_like('S-2', r.who || ' cannot start a sign-in', pg_temp.tsi_begin(r.who, 'studio', 'x' || r.who), 'ERR:42501:%');
    perform pg_temp.tsi_like('S-2', r.who || ' cannot disconnect',
      pg_temp.tsi_as(r.who, 'select public.mingla_connector_signin_disconnect(''studio'')::text'), 'ERR:42501:%');
  end loop;
  perform pg_temp.tsi_like('S-2', 'anon cannot start a sign-in', pg_temp.tsi_begin('anon', 'studio', 'xanon'), 'ERR:42501:%');
  for r in select * from (values
      ('select public.mingla_connector_signin_claim(''' || repeat('a', 64) || ''')::text'),
      ('select public.mingla_connector_signin_credential(gen_random_uuid())::text'),
      ('select public.mingla_connector_signin_refresh_begin(gen_random_uuid(), 1)::text'),
      ('select public.mingla_connector_signin_complete(''' || repeat('a', 64) || ''', ''x'', ''y'', 1, ''z'')::text')) x(q) loop
    perform pg_temp.tsi_like('S-2', 'the owner cannot call a server step: ' || left(r.q, 50), pg_temp.tsi_as('owner', r.q), 'ERR:42501:%');
  end loop;
  perform pg_temp.tsi_check('S-2', 'the owner reads the status: kind, address, not connected',
    (select (v ->> 'auth_kind') || ':' || (v ->> 'mcp_url') || ':' || (v -> 'signin' ->> 'connected')
       from (select pg_temp.tsi_as('owner', 'select public.mingla_connector_signin_status(''studio'')::text')::jsonb v) x),
    'signin:https://mcp.magnific.com:false');
end;
$s2$;

-- ---------------------------------------------------------------------------
-- S-3 begin's checks; S-4 a state works once.
-- ---------------------------------------------------------------------------
do $s3$
declare
  v text;
begin
  perform pg_temp.tsi_like('S-3', 'a key row cannot start a sign-in', pg_temp.tsi_begin('owner', 'posthog', 'k1'), 'ERR:22023:key_only:%');
  perform pg_temp.tsi_like('S-3', 'another callback is refused',
    pg_temp.tsi_as('owner', format('select public.mingla_connector_signin_begin(%L, %L, %L, %L, %L, %L, %L)::text',
      'studio', pg_temp.tsi_digest('s-bad1'), repeat('B', 60), 'https://auth.magnific.com/realms/mcp',
      'https://auth.magnific.com/realms/mcp/protocol/openid-connect/token', 'https://mcp.magnific.com',
      'https://evil.example/callback')), 'ERR:22023:invalid_request:%');
  perform pg_temp.tsi_like('S-3', 'a token address on another site is refused',
    pg_temp.tsi_as('owner', format('select public.mingla_connector_signin_begin(%L, %L, %L, %L, %L, %L, %L)::text',
      'studio', pg_temp.tsi_digest('s-bad2'), repeat('B', 60), 'https://auth.magnific.com/realms/mcp',
      'https://tokens.evil-site.example/token', 'https://mcp.magnific.com',
      'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent/oauth/upstream-callback')), 'ERR:22023:invalid_request:%');
  perform pg_temp.tsi_check('S-3', 'no state was kept for a refused start',
    (select count(*)::text from public.mingla_connector_signin_states), '0');

  v := pg_temp.tsi_begin('owner', 'studio', 'state-one');
  perform pg_temp.tsi_check('S-3', 'the owner starts a sign-in and gets the client id',
    (v::jsonb ->> 'ok') || ':' || (v::jsonb ->> 'client_id'),
    'true:https://admin.usemingla.com/oauth/mingla-connector-client.json');
  perform pg_temp.tsi_check('S-3', 'only a digest of the state is kept',
    (select (state_hash = pg_temp.tsi_digest('state-one'))::text || ':' || (owner_email) from public.mingla_connector_signin_states),
    'true:issue4294si-owner@test.local');
  perform pg_temp.tsi_like('S-3', 'the start is audited without the state',
    (select metadata::text from public.admin_audit_log where action = 'connector.signin_begin' order by created_at desc limit 1),
    '%auth.magnific.com%');
  -- A newer start ends the older one (I-4294-10).
  perform pg_temp.tsi_begin('owner', 'studio', 'state-two');
  perform pg_temp.tsi_check('S-4', 'a state ended by a newer start cannot be claimed',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_claim(%L)::text', pg_temp.tsi_digest('state-one'))),
    '{"ok": false}');
  v := pg_temp.tsi_as('service', format('select public.mingla_connector_signin_claim(%L)::text', pg_temp.tsi_digest('state-two')));
  perform pg_temp.tsi_check('S-4', 'the current state is claimed once with what the exchange needs',
    (v::jsonb ->> 'ok') || ':' || (v::jsonb ->> 'slug') || ':' || (v::jsonb ->> 'verifier_box') || ':' || (v::jsonb ->> 'token_url'),
    'true:studio:' || repeat('B', 60) || ':https://auth.magnific.com/realms/mcp/protocol/openid-connect/token');
  perform pg_temp.tsi_check('S-4', 'a second claim of the same state gets nothing',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_claim(%L)::text', pg_temp.tsi_digest('state-two'))),
    '{"ok": false}');
  perform pg_temp.tsi_check('S-4', 'an unknown state gets nothing',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_claim(%L)::text', pg_temp.tsi_digest('never'))),
    '{"ok": false}');
  -- An expired state.
  perform pg_temp.tsi_begin('owner', 'studio', 'state-old');
  update public.mingla_connector_signin_states set expires_at = clock_timestamp() - interval '1 second'
   where state_hash = pg_temp.tsi_digest('state-old');
  perform pg_temp.tsi_check('S-4', 'a state past its ten minutes cannot be claimed',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_claim(%L)::text', pg_temp.tsi_digest('state-old'))),
    '{"ok": false}');
  perform pg_temp.tsi_check('S-4', 'complete without a claim does nothing',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_complete(%L, %L, %L, %L, %L)::text',
      pg_temp.tsi_digest('state-old'), pg_temp.tsi_id('access1'), pg_temp.tsi_id('refresh1'), 300, 'x')),
    '{"ok": false, "reason": "state"}');
end;
$s3$;

-- ---------------------------------------------------------------------------
-- S-5 complete; S-6 on and off; key refused for a sign-in row.
-- ---------------------------------------------------------------------------
do $s5$
declare
  v text;
  v_vault uuid;
begin
  perform pg_temp.tsi_like('S-6', 'a sign-in row cannot be turned on before Connect',
    pg_temp.tsi_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","enabled":true}''::jsonb)::text'),
    'ERR:22023:not_connected:%');
  perform pg_temp.tsi_like('S-6', 'a sign-in row takes no key',
    pg_temp.tsi_as('owner', 'select public.mingla_connector_set_key(''studio'', ''some-long-key-value'')::text'),
    'ERR:22023:signin_only:%');

  v := pg_temp.tsi_as('service', format('select public.mingla_connector_signin_complete(%L, %L, %L, %L, %L)::text',
         pg_temp.tsi_digest('state-two'), pg_temp.tsi_id('access1'), pg_temp.tsi_id('refresh1'), 300, 'ads@mingla.test'));
  perform pg_temp.tsi_check('S-5', 'complete stores the sign-in and answers no token',
    v, '{"ok": true, "slug": "studio", "label": "Mingla Studio", "account": "ads@mingla.test"}');
  perform pg_temp.tsi_check('S-5', 'a second complete of the same state does nothing',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_complete(%L, %L, %L, %L, %L)::text',
      pg_temp.tsi_digest('state-two'), pg_temp.tsi_id('access2'), pg_temp.tsi_id('refresh2'), 300, 'evil')),
    '{"ok": false, "reason": "state"}');
  v_vault := (select signin_vault_id from public.mingla_connector_upstreams where slug = 'studio');
  perform pg_temp.tsi_check('S-5', 'the tokens are in Vault as one secret',
    (select (d.decrypted_secret::jsonb ->> 'access_token') = pg_temp.tsi_id('access1')
         and (d.decrypted_secret::jsonb ->> 'refresh_token') = pg_temp.tsi_id('refresh1')
       from vault.decrypted_secrets d where d.id = v_vault)::text, 'true');
  v := pg_temp.tsi_as('owner', 'select public.mingla_connector_signin_status(''studio'')::text');
  perform pg_temp.tsi_check('S-5', 'Admin sees connected, the account and who',
    (v::jsonb -> 'signin' ->> 'connected') || ':' || (v::jsonb -> 'signin' ->> 'account') || ':' ||
      ((v::jsonb -> 'signin' ->> 'connected_by') is not null)::text || ':' || (v::jsonb -> 'signin' ->> 'reconnect_needed'),
    'true:ads@mingla.test:true:false');
  perform pg_temp.tsi_check('S-5', 'the row stays off after Connect',
    (select enabled::text from public.mingla_connector_upstreams where slug = 'studio'), 'false');

  -- On for growth and owner.
  v := pg_temp.tsi_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","enabled":true,"allowed_roles":["owner","growth"]}''::jsonb)::text');
  perform pg_temp.tsi_check('S-6', 'once connected the owner turns it on', v::jsonb ->> 'enabled', 'true');
  perform pg_temp.tsi_like('S-6', 'the kind cannot change while connected',
    pg_temp.tsi_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","auth_kind":"key"}''::jsonb)::text'),
    'ERR:22023:kind_locked:%');
  perform pg_temp.tsi_like('S-6', 'a hidden word with a bracket is refused',
    pg_temp.tsi_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","hide_words":["Mag(nific"]}''::jsonb)::text'),
    'ERR:22023:invalid_hide_words:%');
  perform pg_temp.tsi_like('S-6', 'a cap above 10000 is refused',
    pg_temp.tsi_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","daily_generation_cap":10001}''::jsonb)::text'),
    'ERR:22023:invalid_daily_cap:%');
  perform pg_temp.tsi_like('S-6', 'a token field is refused',
    pg_temp.tsi_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","signin_vault_id":null}''::jsonb)::text'),
    'ERR:22023:invalid_field:%');
  perform pg_temp.tsi_check('S-6', 'the table rule: a key row that is on needs a key',
    (select count(*)::text from pg_constraint where conname = 'mingla_connector_upstreams_on_needs_key'
       and pg_get_constraintdef(oid) like '%auth_kind = ''signin''::text%signin_vault_id IS NOT NULL%'), '1');
end;
$s5$;

-- ---------------------------------------------------------------------------
-- S-7 the proxy steps; S-8 renewal one at a time.
-- ---------------------------------------------------------------------------
do $s7$
declare
  v       jsonb;
  v_call  text;
  v_lease text;
  v_gen   integer;
  v_lease2 text;
begin
  v := pg_temp.tsi_as('service', format('select public.mingla_connector_upstreams_for(%L)::text',
         pg_temp.tsi_digest(pg_temp.tsi_id('growth.key'))))::jsonb;
  perform pg_temp.tsi_check('S-7', 'growth sees studio with its label and hidden words',
    (select (u ->> 'slug') || '|' || (u ->> 'label') || '|' || (u -> 'hide_words')::text from jsonb_array_elements(v -> 'upstreams') u),
    'studio|Mingla Studio|["Magnific", "Freepik"]');

  v := pg_temp.tsi_begin_call(pg_temp.tsi_id('growth.key'), 'studio', 'stock_search');
  v_call := v ->> 'call_id';
  perform pg_temp.tsi_check('S-7', 'call_begin names the kind, the label and the hidden words',
    (v ->> 'ok') || '|' || (v ->> 'auth_kind') || '|' || (v ->> 'label') || '|' || (v -> 'hide_words')::text || '|' || (v ->> 'mcp_url'),
    'true|signin|Mingla Studio|["Magnific", "Freepik"]|https://mcp.magnific.com');
  perform pg_temp.tsi_check('S-7', 'the key reader never answers for a sign-in row',
    pg_temp.tsi_as('service', format('select public.mingla_connector_upstream_key(%L)::text', v_call)), '{"ok": false}');
  v := pg_temp.tsi_as('service', format('select public.mingla_connector_signin_credential(%L)::text', v_call))::jsonb;
  v_gen := (v ->> 'generation')::integer;
  perform pg_temp.tsi_check('S-7', 'the running call reads the access token, never the refresh token',
    (v ->> 'ok') || ':' || ((v ->> 'access_token') = pg_temp.tsi_id('access1'))::text || ':' || (v ? 'refresh_token')::text,
    'true:true:false');
  perform pg_temp.tsi_check('S-7', 'a call that is not running reads nothing',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_credential(%L)::text', gen_random_uuid())), '{"ok": false}');

  -- S-8 (I-4294-11).
  v := pg_temp.tsi_as('service', format('select public.mingla_connector_signin_refresh_begin(%L, %s)::text', v_call, v_gen))::jsonb;
  v_lease := v ->> 'lease';
  perform pg_temp.tsi_check('S-8', 'the first renewer gets the lease, the refresh token and the token address',
    (v ->> 'ok') || ':' || ((v ->> 'refresh_token') = pg_temp.tsi_id('refresh1'))::text || ':' || (v ->> 'token_url') || ':' || (v ->> 'client_id'),
    'true:true:https://auth.magnific.com/realms/mcp/protocol/openid-connect/token:https://admin.usemingla.com/oauth/mingla-connector-client.json');
  perform pg_temp.tsi_like('S-8', 'a second renewer while the lease is held gets PT409',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_refresh_begin(%L, %s)::text', v_call, v_gen)),
    'ERR:PT409:renewing:%');
  perform pg_temp.tsi_like('S-8', 'a store with another lease gets PT409',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_refresh_store(%L, %L, %L, %L, %s)::text',
      v_call, gen_random_uuid(), pg_temp.tsi_id('access3'), pg_temp.tsi_id('refresh3'), 300)), 'ERR:PT409:lease_lost:%');
  perform pg_temp.tsi_check('S-8', 'that refused store changed nothing',
    (select (d.decrypted_secret::jsonb ->> 'access_token') = pg_temp.tsi_id('access1')
       from vault.decrypted_secrets d join public.mingla_connector_upstreams u on u.signin_vault_id = d.id where u.slug = 'studio')::text,
    'true');
  v := pg_temp.tsi_as('service', format('select public.mingla_connector_signin_refresh_store(%L, %L, %L, %L, %s)::text',
         v_call, v_lease, pg_temp.tsi_id('access2'), pg_temp.tsi_id('refresh2'), 300))::jsonb;
  perform pg_temp.tsi_check('S-8', 'the lease holder stores and the generation moves on',
    (v ->> 'ok') || ':' || ((v ->> 'generation')::integer = v_gen + 1)::text, 'true:true');
  perform pg_temp.tsi_like('S-8', 'the same lease cannot store twice',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_refresh_store(%L, %L, %L, %L, %s)::text',
      v_call, v_lease, pg_temp.tsi_id('access3'), pg_temp.tsi_id('refresh3'), 300)), 'ERR:PT409:lease_lost:%');
  perform pg_temp.tsi_like('S-8', 'a renewer holding the old generation gets PT409 and reads again',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_refresh_begin(%L, %s)::text', v_call, v_gen)),
    'ERR:PT409:renewed:%');
  v := pg_temp.tsi_as('service', format('select public.mingla_connector_signin_credential(%L)::text', v_call))::jsonb;
  perform pg_temp.tsi_check('S-8', 'reading again gives the renewed access token',
    ((v ->> 'access_token') = pg_temp.tsi_id('access2'))::text || ':' || ((v ->> 'generation')::integer = v_gen + 1)::text, 'true:true');
  perform pg_temp.tsi_check('S-8', 'the lease is let go after the store',
    (select (signin_lease_id is null)::text from public.mingla_connector_upstreams where slug = 'studio'), 'true');
  perform pg_temp.tsi_check('S-8', 'PT409 everywhere, never 40001',
    (select count(*)::text from pg_proc where proname like 'mingla\_connector\_signin\_%' and prosrc ~ '40001'), '0');
  perform pg_temp.tsi_as('service', format('select public.mingla_connector_call_finish(%L, %L, %L, %L)::text', v_call, 'ok', 200, 5));
  perform pg_temp.tsi_check('S-8', 'a finished call cannot renew',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_refresh_begin(%L, %s)::text', v_call, v_gen + 1)),
    '{"ok": false}');

  -- An unavailable renewal lets the lease go and changes nothing else.
  v := pg_temp.tsi_begin_call(pg_temp.tsi_id('growth.key'), 'studio', 'stock_get');
  v_call := v ->> 'call_id';
  v_lease2 := pg_temp.tsi_as('service', format('select public.mingla_connector_signin_refresh_begin(%L, %s)::text', v_call, v_gen + 1))::jsonb ->> 'lease';
  perform pg_temp.tsi_check('S-8', 'an unavailable renewal lets the lease go',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_refresh_fail(%L, %L, %L)::text', v_call, v_lease2, 'unavailable')),
    '{"ok": true, "reconnect_needed": false}');
  perform pg_temp.tsi_check('S-8', 'and the row still works',
    (select (signin_lease_id is null and signin_reconnect_at is null)::text from public.mingla_connector_upstreams where slug = 'studio'), 'true');
  perform pg_temp.tsi_as('service', format('select public.mingla_connector_call_finish(%L, %L, %L, %L)::text', v_call, 'ok', 200, 5));
  perform pg_temp.tsi_keep('gen', (v_gen + 1)::text);
end;
$s7$;

-- ---------------------------------------------------------------------------
-- S-9 a refused renewal and Reconnect.
-- ---------------------------------------------------------------------------
do $s9$
declare
  v      jsonb;
  v_call text;
  v_lease text;
begin
  v := pg_temp.tsi_begin_call(pg_temp.tsi_id('growth.key'), 'studio', 'stock_search');
  v_call := v ->> 'call_id';
  v_lease := pg_temp.tsi_as('service', format('select public.mingla_connector_signin_refresh_begin(%L, %s)::text',
               v_call, pg_temp.tsi_id('gen')))::jsonb ->> 'lease';
  perform pg_temp.tsi_check('S-9', 'invalid_grant marks Reconnect needed',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_refresh_fail(%L, %L, %L)::text', v_call, v_lease, 'invalid_grant')),
    '{"ok": true, "reconnect_needed": true}');
  perform pg_temp.tsi_as('service', format('select public.mingla_connector_call_finish(%L, %L, %L, %L)::text', v_call, 'upstream_key_rejected', 401, 5));
  perform pg_temp.tsi_check('S-9', 'calls are refused with the key-refused token',
    pg_temp.tsi_begin_call(pg_temp.tsi_id('growth.key'), 'studio', 'stock_search') ->> 'token', 'upstream_key_rejected');
  perform pg_temp.tsi_check('S-9', 'the tools leave the list',
    (pg_temp.tsi_as('service', format('select public.mingla_connector_upstreams_for(%L)::text',
       pg_temp.tsi_digest(pg_temp.tsi_id('growth.key'))))::jsonb -> 'upstreams')::text, '[]');
  perform pg_temp.tsi_check('S-9', 'Admin sees Reconnect needed',
    pg_temp.tsi_as('owner', 'select public.mingla_connector_signin_status(''studio'')::text')::jsonb -> 'signin' ->> 'reconnect_needed', 'true');
  perform pg_temp.tsi_check('S-9', 'it is audited as the system',
    (select admin_email from public.admin_audit_log where action = 'connector.signin_reconnect_needed' order by created_at desc limit 1),
    'system');

  -- Reconnect.
  perform pg_temp.tsi_begin('owner', 'studio', 'state-three');
  perform pg_temp.tsi_as('service', format('select public.mingla_connector_signin_claim(%L)::text', pg_temp.tsi_digest('state-three')));
  v := pg_temp.tsi_as('service', format('select public.mingla_connector_signin_complete(%L, %L, %L, %L, %L)::text',
         pg_temp.tsi_digest('state-three'), pg_temp.tsi_id('access3'), pg_temp.tsi_id('refresh3'), 300, 'ads@mingla.test'))::jsonb;
  perform pg_temp.tsi_check('S-9', 'Reconnect clears Reconnect needed and keeps the row on',
    (v ->> 'ok') || ':' || (select (signin_reconnect_at is null)::text || ':' || enabled::text
                              from public.mingla_connector_upstreams where slug = 'studio'), 'true:true:true');
  perform pg_temp.tsi_check('S-9', 'Reconnect reuses the one Vault secret',
    (select count(*)::text from vault.secrets where name like 'mingla_connector_signin:studio:%'), '1');
end;
$s9$;

-- ---------------------------------------------------------------------------
-- S-10 the daily generation cap (I-4294-12).
-- ---------------------------------------------------------------------------
do $s10$
declare
  v jsonb;
  i integer;
begin
  perform pg_temp.tsi_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","daily_generation_cap":2}''::jsonb)::text');
  for i in 1..2 loop
    v := pg_temp.tsi_begin_call(pg_temp.tsi_id('growth.key'), 'studio', 'video_generate');
    perform pg_temp.tsi_check('S-10', 'generation call ' || i || ' of 2 is allowed', v ->> 'ok', 'true');
    perform pg_temp.tsi_as('service', format('select public.mingla_connector_call_finish(%L, %L, %L, %L)::text', v ->> 'call_id', 'ok', 200, 5));
  end loop;
  v := pg_temp.tsi_begin_call(pg_temp.tsi_id('growth.key'), 'studio', 'images_generate');
  perform pg_temp.tsi_check('S-10', 'a third generation call is refused with generation_limit',
    (v ->> 'ok') || ':' || (v ->> 'token'), 'false:generation_limit');
  perform pg_temp.tsi_check('S-10', 'and it never reached a token read',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_credential(%L)::text', v ->> 'call_id')), '{"ok": false}');
  v := pg_temp.tsi_begin_call(pg_temp.tsi_id('growth.key'), 'studio', 'stock_search');
  perform pg_temp.tsi_check('S-10', 'a tool that is not a generation tool still works', v ->> 'ok', 'true');
  perform pg_temp.tsi_as('service', format('select public.mingla_connector_call_finish(%L, %L, %L, %L)::text', v ->> 'call_id', 'ok', 200, 5));
  v := pg_temp.tsi_begin_call(pg_temp.tsi_id('owner.key'), 'studio', 'video_generate');
  perform pg_temp.tsi_check('S-10', 'the cap is per person: the owner still has theirs', v ->> 'ok', 'true');
  perform pg_temp.tsi_as('service', format('select public.mingla_connector_call_finish(%L, %L, %L, %L)::text', v ->> 'call_id', 'ok', 200, 5));
  perform pg_temp.tsi_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","daily_generation_cap":3}''::jsonb)::text');
  perform pg_temp.tsi_check('S-10', 'a refused call does not use up the cap: raising it to 3 allows one more',
    pg_temp.tsi_begin_call(pg_temp.tsi_id('growth.key'), 'studio', 'video_generate') ->> 'ok', 'true');
end;
$s10$;

-- ---------------------------------------------------------------------------
-- S-11 Disconnect.
-- ---------------------------------------------------------------------------
do $s11$
declare
  v_vault uuid := (select signin_vault_id from public.mingla_connector_upstreams where slug = 'studio');
  v jsonb;
begin
  perform pg_temp.tsi_begin('owner', 'studio', 'state-pending');
  perform pg_temp.tsi_check('S-11', 'Disconnect answers not connected',
    pg_temp.tsi_as('owner', 'select public.mingla_connector_signin_disconnect(''studio'')::text'),
    '{"slug": "studio", "connected": false}');
  perform pg_temp.tsi_check('S-11', 'the Vault secret is gone and the row is off',
    (select count(*)::text from vault.secrets where id = v_vault) || ':' ||
      (select enabled::text || ':' || (signin_vault_id is null)::text from public.mingla_connector_upstreams where slug = 'studio'),
    '0:false:true');
  perform pg_temp.tsi_check('S-11', 'a start waiting at Disconnect cannot be claimed',
    pg_temp.tsi_as('service', format('select public.mingla_connector_signin_claim(%L)::text', pg_temp.tsi_digest('state-pending'))),
    '{"ok": false}');
  v := pg_temp.tsi_begin_call(pg_temp.tsi_id('growth.key'), 'studio', 'stock_search');
  perform pg_temp.tsi_check('S-11', 'calls stop at once', v ->> 'token', 'not_allowed');
  perform pg_temp.tsi_like('S-11', 'Disconnect is audited',
    (select metadata::text from public.admin_audit_log where action = 'connector.signin_disconnect' order by created_at desc limit 1),
    '%"was_connected": true%');
  perform pg_temp.tsi_like('S-11', 'a key row cannot be disconnected as a sign-in',
    pg_temp.tsi_as('owner', 'select public.mingla_connector_signin_disconnect(''posthog'')::text'), 'ERR:22023:key_only:%');
end;
$s11$;

-- ---------------------------------------------------------------------------
-- S-12 no token outside Vault (I-4294-9).
-- ---------------------------------------------------------------------------
do $s12$
declare
  v_leak text;
  t text;
begin
  for t in select v from tsi_ids where k in ('access1', 'access2', 'access3', 'refresh1', 'refresh2', 'refresh3') loop
    select string_agg(s.src, ' | ') into v_leak from tsi_seen s
     where pg_temp.tsi_leaks(s.body, t)
       and s.src not like 'service: select public.mingla_connector_signin_credential(%'
       and s.src not like 'service: select public.mingla_connector_signin_refresh_begin(%'
       and s.src not like 'service: select public.mingla_connector_signin_refresh_store(%'
       and s.src not like 'service: select public.mingla_connector_signin_complete(%';
    perform pg_temp.tsi_check('S-12', 'no answer outside the server steps holds a slice of a token', coalesce(v_leak, 'none'), 'none');
  end loop;
  perform pg_temp.tsi_check('S-12', 'no answer from complete or store holds a token',
    (select count(*)::text from tsi_seen s, tsi_ids i
      where i.k in ('access1', 'access2', 'access3', 'refresh1', 'refresh2', 'refresh3')
        and (s.src like 'service: select public.mingla_connector_signin_complete(%'
             or s.src like 'service: select public.mingla_connector_signin_refresh_store(%')
        and pg_temp.tsi_leaks(s.body, i.v)), '0');
  perform pg_temp.tsi_check('S-12', 'no audit row holds a slice of a token',
    (select count(*)::text from public.admin_audit_log a, tsi_ids i
      where i.k in ('access1', 'access2', 'access3', 'refresh1', 'refresh2', 'refresh3')
        and pg_temp.tsi_leaks(row_to_json(a)::text, i.v)), '0');
  perform pg_temp.tsi_check('S-12', 'no company tools row or start holds a slice of a token',
    (select count(*)::text from tsi_ids i
      where i.k in ('access1', 'access2', 'access3', 'refresh1', 'refresh2', 'refresh3')
        and (exists (select 1 from public.mingla_connector_upstreams u where pg_temp.tsi_leaks(row_to_json(u)::text, i.v))
             or exists (select 1 from public.mingla_connector_signin_states s where pg_temp.tsi_leaks(row_to_json(s)::text, i.v)))),
    '0');
  perform pg_temp.tsi_check('S-12', 'the Admin list holds no token, Vault id or lease',
    (pg_temp.tsi_as('owner', 'select public.mingla_connector_registry_list()::text') ~ '(signin_vault_id|lease|refresh_token|access_token)')::text,
    'false');
end;
$s12$;

-- ---------------------------------------------------------------------------
-- S-13 the migration's self-check passes again.
-- ---------------------------------------------------------------------------
do $s13$
declare
  v_sql text;
  v_got text;
begin
  select sql into v_sql from tsi_src where k = 'selfcheck';
  perform pg_temp.tsi_check('S-13', 'the self-check block was read from the migration', (length(v_sql) > 1000)::text, 'true');
  begin
    execute v_sql;
    v_got := 'passed';
  exception when others then
    v_got := sqlerrm;
  end;
  perform pg_temp.tsi_check('S-13', 'the self-check passes on this database', v_got, 'passed');
end;
$s13$;

do $verdict$
declare
  v_total int;
  v_failed int;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from tsi_results;
  for r in select * from tsi_results where not ok order by seq loop
    raise warning 'ISSUE-4294 SIGNIN FAILED % | % | %', r.test, r.label, r.detail;
  end loop;
  if v_failed > 0 or v_total < 75 then
    raise exception 'ISSUE-4294 SIGNIN FAIL: % of % checks failed (at least 75 must run)', v_failed, v_total;
  end if;
  raise notice 'ISSUE-4294 SIGNIN PASS: % checks across S-1..S-13, 0 failed', v_total;
end;
$verdict$;

rollback;
