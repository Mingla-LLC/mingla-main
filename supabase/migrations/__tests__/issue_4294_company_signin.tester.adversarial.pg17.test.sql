-- Issue #4294 — tester adversarial suite for company sign-in (PostgreSQL 17).
--
-- Attacks the migration from angles the implementor suite does not take:
--   A-1  no client role reaches any server step, internal helper or table:
--        the owner, an authenticated non-owner and anon are all refused
--   A-2  a start is refused for a token or resource address that is plain
--        http, an IP, private, on another site, or a malformed digest/box
--   A-3  a state belongs to its row: another row's start does not end it,
--        another row's Disconnect does not end it, a claim answers its own
--        row; a claim older than five minutes cannot complete; Disconnect
--        during a sign-in ends it
--   A-4  a company sign-in belongs to its address: a connected row's
--        address cannot change, and changing an unconnected row's address
--        ends any sign-in under way
--   A-5  complete refuses whitespace tokens, cleans the account and clamps
--        the lifetime
--   A-6  renewal: an ended lease can be taken over; the old holder can then
--        neither store nor fail; refusals are PT409, never 40001
--   A-7  the generation cap: the UTC day boundary, cap 0, rows counted
--        separately, refused calls not counted, a refused call never reads
--        a token
--   A-8  key rows behave as before and the kind is locked while a key or a
--        sign-in is set
--   A-9  no client answer, audit row or call row holds a token slice or
--        the Vault id; deleting a sign-in row deletes its Vault secret
--
-- One transaction, rolled back. Never run on production. Runs as the
-- image's admin role from the repository root.
-- Declared in the implementor suites (I-4294-9..I-4294-12); this file attacks them.

\set ON_ERROR_STOP on

begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;

create temp table tsa_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tsa_people (who, id, email) values
  ('owner',  '42949100-0000-4000-a000-000000000001', 'issue4294ta-owner@test.local'),
  ('admin',  '42949100-0000-4000-a000-000000000002', 'issue4294ta-admin@test.local'),
  ('growth', '42949100-0000-4000-a000-000000000003', 'issue4294ta-growth@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tsa_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('issue4294ta-owner@test.local', 'owner', 'active', now()),
  ('issue4294ta-admin@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
values ('issue4294ta-growth@test.local', 'growth', 'active', now());

create temp table tsa_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tsa_ids (k text primary key, v text) on commit drop;
create temp table tsa_seen (seq serial primary key, src text, body text) on commit drop;

create function pg_temp.tsa_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who not in ('anon', 'service') then
    select id, email into strict v_id, v_email from tsa_people where who = p_who;
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
  insert into tsa_seen (src, body) values (p_who || ': ' || left(p_sql, 70), coalesce(v_out, ''));
  return v_out;
end;
$fn$;

create function pg_temp.tsa_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into tsa_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 300), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.tsa_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into tsa_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 300), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.tsa_digest(p text) returns text
language sql as $fn$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $fn$;

create function pg_temp.tsa_id(p_k text) returns text
language sql as $fn$ select v from tsa_ids where k = p_k $fn$;

create function pg_temp.tsa_keep(p_k text, p_v text) returns void
language sql as $fn$
  insert into tsa_ids (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;

create function pg_temp.tsa_leaks(p_text text, p_token text) returns boolean
language sql as $fn$
  select p_text is not null and p_token is not null and exists (
    select 1 from generate_series(1, char_length(p_token) - 7) i
     where strpos(p_text, substr(p_token, i, 8)) > 0)
$fn$;

create function pg_temp.tsa_sj(p_sql text) returns jsonb
language plpgsql as $fn$
declare
  v text := pg_temp.tsa_as('service', p_sql);
begin
  if v like 'ERR:%' then
    return jsonb_build_object('refused', v);
  end if;
  return v::jsonb;
end;
$fn$;

-- A start with any addresses (defaults are Magnific-shaped and valid).
create function pg_temp.tsa_begin_with(p_who text, p_slug text, p_state text, p_issuer text, p_token text,
                                       p_resource text, p_box text default repeat('B', 60)) returns text
language sql as $fn$
  select pg_temp.tsa_as(p_who, format(
    'select public.mingla_connector_signin_begin(%L, %L, %L, %L, %L, %L, %L)::text',
    p_slug, pg_temp.tsa_digest(p_state), p_box, p_issuer, p_token, p_resource,
    'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent/oauth/upstream-callback'))
$fn$;

create function pg_temp.tsa_begin(p_slug text, p_state text) returns text
language sql as $fn$
  select pg_temp.tsa_begin_with('owner', p_slug, p_state, 'https://auth.magnific.com/realms/mcp',
    'https://auth.magnific.com/realms/mcp/protocol/openid-connect/token', 'https://mcp.magnific.com')
$fn$;

create function pg_temp.tsa_claim(p_state text) returns jsonb
language sql as $fn$
  select pg_temp.tsa_sj(format('select public.mingla_connector_signin_claim(%L)::text', pg_temp.tsa_digest(p_state)))
$fn$;

create function pg_temp.tsa_complete(p_state text, p_access text, p_refresh text, p_ttl integer, p_account text) returns jsonb
language sql as $fn$
  select pg_temp.tsa_sj(format('select public.mingla_connector_signin_complete(%L, %L, %L, %s, %L)::text',
    pg_temp.tsa_digest(p_state), p_access, p_refresh, coalesce(p_ttl::text, 'null'), p_account))
$fn$;

create function pg_temp.tsa_connect(p_slug text, p_state text, p_access text, p_refresh text) returns jsonb
language plpgsql as $fn$
begin
  perform pg_temp.tsa_begin(p_slug, p_state);
  perform pg_temp.tsa_claim(p_state);
  return pg_temp.tsa_complete(p_state, p_access, p_refresh, 300, 'ads@test.local');
end;
$fn$;

create function pg_temp.tsa_call(p_key text, p_slug text, p_tool text) returns jsonb
language sql as $fn$
  select pg_temp.tsa_as('service', format('select public.mingla_connector_call_begin(%L, %L, %L, %L)::text',
           pg_temp.tsa_digest(p_key), p_slug, p_tool, 'issue4294ta'))::jsonb
$fn$;

create function pg_temp.tsa_finish(p_call text, p_outcome text) returns void
language sql as $fn$
  select pg_temp.tsa_as('service', format('select public.mingla_connector_call_finish(%L, %L, %s, %s)::text',
           p_call, p_outcome, 200, 5))::void
$fn$;

do $keys$
begin
  perform pg_temp.tsa_keep('growth.key', pg_temp.tsa_as('growth', 'select public.team_agent_key_create(''claude'')::text')::jsonb ->> 'key');
  perform pg_temp.tsa_keep('owner.key', pg_temp.tsa_as('owner', 'select public.team_agent_key_create(''claude'')::text')::jsonb ->> 'key');
  perform pg_temp.tsa_keep('a1', 'TA1-' || md5('ta1') || md5('ta1b'));
  perform pg_temp.tsa_keep('r1', 'TR1-' || md5('tr1') || md5('tr1b'));
  perform pg_temp.tsa_keep('a2', 'TA2-' || md5('ta2') || md5('ta2b'));
  perform pg_temp.tsa_keep('r2', 'TR2-' || md5('tr2') || md5('tr2b'));
  perform pg_temp.tsa_keep('a3', 'TA3-' || md5('ta3') || md5('ta3b'));
  perform pg_temp.tsa_keep('r3', 'TR3-' || md5('tr3') || md5('tr3b'));
  perform pg_temp.tsa_keep('pk', 'phc_tester_' || md5('posthog-key'));
end;
$keys$;

-- A second sign-in row on the same site, open to growth, cap 2.
do $setup$
begin
  perform pg_temp.tsa_check('setup', 'a second sign-in row is added',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studiob","label":"Studio B","mcp_url":"https://mcp.magnific.com/b","auth_kind":"signin","allowed_roles":["owner","growth"],"tool_allowlist":["images_generate","stock_search","video_generate"],"generation_tools":["images_generate","video_generate"],"daily_generation_cap":2,"hide_words":["Magnific"]}''::jsonb)::jsonb ->> ''auth_kind''')::text,
    'signin');
  perform pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","allowed_roles":["owner","growth"],"daily_generation_cap":2}''::jsonb)::text');
end;
$setup$;

-- ---------------------------------------------------------------------------
-- A-1 no client role reaches a server step, a helper or a table.
-- ---------------------------------------------------------------------------
do $a1$
declare
  r record;
  w record;
begin
  for w in select * from (values ('owner'), ('admin'), ('growth'), ('anon')) x(who) loop
    for r in select * from (values
        ('select public.mingla_connector_signin_claim(''' || repeat('a', 64) || ''')::text'),
        ('select public.mingla_connector_signin_complete(''' || repeat('a', 64) || ''', ''' || repeat('x', 20) || ''', ''' || repeat('y', 20) || ''', 300, null)::text'),
        ('select public.mingla_connector_signin_credential(gen_random_uuid())::text'),
        ('select public.mingla_connector_signin_refresh_begin(gen_random_uuid(), 1)::text'),
        ('select public.mingla_connector_signin_refresh_store(gen_random_uuid(), gen_random_uuid(), ''' || repeat('x', 20) || ''', ''' || repeat('y', 20) || ''', 300)::text'),
        ('select public.mingla_connector_signin_refresh_fail(gen_random_uuid(), gen_random_uuid(), ''invalid_grant'')::text'),
        ('select public.mingla_connector_signin_call_row(gen_random_uuid())::text'),
        ('select public.mingla_connector_signin_limits()::text'),
        ('select public.mingla_connector_signin_same_site(''https://a.b.com'', ''https://c.b.com'')::text'),
        ('select public.mingla_connector_registry_row(''studio'')::text'),
        ('select count(*)::text from public.mingla_connector_signin_states'),
        ('select signin_vault_id::text from public.mingla_connector_upstreams limit 1'),
        ('update public.mingla_connector_upstreams set signin_reconnect_at = null returning slug'),
        ('insert into public.mingla_connector_signin_states (state_hash, slug, owner_email, verifier_box, issuer, token_url, resource, redirect_uri, expires_at) values (repeat(''a'',64), ''studio'', ''x'', repeat(''B'',60), ''i'', ''t'', ''r'', ''u'', now()) returning id::text')) x(q) loop
      perform pg_temp.tsa_like('A-1', w.who || ' is refused: ' || left(r.q, 60), pg_temp.tsa_as(w.who, r.q), 'ERR:42501:%');
    end loop;
  end loop;
  for w in select * from (values ('admin'), ('growth'), ('anon')) x(who) loop
    perform pg_temp.tsa_like('A-1', w.who || ' cannot read sign-in status',
      pg_temp.tsa_as(w.who, 'select public.mingla_connector_signin_status(''studio'')::text'), 'ERR:42501:%');
    perform pg_temp.tsa_like('A-1', w.who || ' cannot disconnect',
      pg_temp.tsa_as(w.who, 'select public.mingla_connector_signin_disconnect(''studio'')::text'), 'ERR:42501:%');
    perform pg_temp.tsa_like('A-1', w.who || ' cannot start',
      pg_temp.tsa_begin_with(w.who, 'studio', 'a1-' || w.who, 'https://auth.magnific.com', 'https://auth.magnific.com/token',
        'https://mcp.magnific.com'), 'ERR:42501:%');
    perform pg_temp.tsa_like('A-1', w.who || ' cannot change the generation cap',
      pg_temp.tsa_as(w.who, 'select public.mingla_connector_registry_save(''{"slug":"studio","daily_generation_cap":9999}''::jsonb)::text'),
      'ERR:42501:%');
  end loop;
  perform pg_temp.tsa_check('A-1', 'no start was recorded by any refused caller',
    (select count(*)::text from public.mingla_connector_signin_states), '0');
end;
$a1$;

-- ---------------------------------------------------------------------------
-- A-2 a start's addresses.
-- ---------------------------------------------------------------------------
do $a2$
declare
  r record;
  c_iss constant text := 'https://auth.magnific.com/realms/mcp';
  c_tok constant text := 'https://auth.magnific.com/realms/mcp/protocol/openid-connect/token';
  c_res constant text := 'https://mcp.magnific.com';
begin
  for r in select * from (values
      ('token over http', c_iss, 'http://auth.magnific.com/token', c_res),
      ('token at the metadata IP', c_iss, 'https://169.254.169.254/token', c_res),
      ('token on localhost', c_iss, 'https://localhost/token', c_res),
      ('token with a port', c_iss, 'https://auth.magnific.com:8443/token', c_res),
      ('token with a query', c_iss, c_tok || '?a=b', c_res),
      ('token on a look-alike site', c_iss, 'https://auth.magnific.com.evil-example.com/token', c_res),
      ('token on a site that ends like it', c_iss, 'https://evilmagnific.com/token', c_res),
      ('token on supabase', c_iss, 'https://gqnoajqerqhnvulmnyvv.supabase.co/token', c_res),
      ('issuer on another site', 'https://auth.evil-example.com', c_tok, c_res),
      ('issuer over http', 'http://auth.magnific.com', c_tok, c_res),
      ('resource on another site', c_iss, c_tok, 'https://mcp.evil-example.com'),
      ('resource over http', c_iss, c_tok, 'http://mcp.magnific.com')) x(label, iss, tok, res) loop
    perform pg_temp.tsa_like('A-2', 'refused: ' || r.label,
      pg_temp.tsa_begin_with('owner', 'studio', 'a2-' || r.label, r.iss, r.tok, r.res), 'ERR:22023:invalid_request:%');
  end loop;
  perform pg_temp.tsa_like('A-2', 'refused: an upper-case digest',
    pg_temp.tsa_as('owner', format('select public.mingla_connector_signin_begin(%L, %L, %L, %L, %L, %L, %L)::text',
      'studio', upper(pg_temp.tsa_digest('x')), repeat('B', 60), c_iss, c_tok, c_res,
      'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent/oauth/upstream-callback')), 'ERR:22023:invalid_request:%');
  perform pg_temp.tsa_like('A-2', 'refused: a short verifier box',
    pg_temp.tsa_begin_with('owner', 'studio', 'a2-box', c_iss, c_tok, c_res, repeat('B', 20)), 'ERR:22023:invalid_request:%');
  perform pg_temp.tsa_like('A-2', 'refused: a verifier box with other characters',
    pg_temp.tsa_begin_with('owner', 'studio', 'a2-box2', c_iss, c_tok, c_res, repeat('B', 50) || '+/='), 'ERR:22023:invalid_request:%');
  perform pg_temp.tsa_like('A-2', 'refused: an unknown row',
    pg_temp.tsa_begin_with('owner', 'nosuchrow', 'a2-none', c_iss, c_tok, c_res), 'ERR:P0002:%');
  perform pg_temp.tsa_check('A-2', 'none of them kept a state',
    (select count(*)::text from public.mingla_connector_signin_states), '0');
end;
$a2$;

-- ---------------------------------------------------------------------------
-- A-3 a state belongs to its row and its moment.
-- ---------------------------------------------------------------------------
do $a3$
declare
  v jsonb;
begin
  perform pg_temp.tsa_begin('studio', 'a3-studio');
  perform pg_temp.tsa_begin('studiob', 'a3-studiob');
  perform pg_temp.tsa_as('owner', 'select public.mingla_connector_signin_disconnect(''studiob'')::text');
  v := pg_temp.tsa_claim('a3-studio');
  perform pg_temp.tsa_check('A-3', 'another row''s start and Disconnect leave this row''s state alone; the claim names its own row',
    (v ->> 'ok') || ':' || (v ->> 'slug'), 'true:studio');
  perform pg_temp.tsa_check('A-3', 'Disconnect ended the other row''s state',
    pg_temp.tsa_claim('a3-studiob')::text, '{"ok": false}');

  -- A claim older than five minutes cannot complete.
  update public.mingla_connector_signin_states set used_at = clock_timestamp() - interval '6 minutes'
   where state_hash = pg_temp.tsa_digest('a3-studio');
  perform pg_temp.tsa_check('A-3', 'a stale claim cannot complete',
    pg_temp.tsa_complete('a3-studio', pg_temp.tsa_id('a1'), pg_temp.tsa_id('r1'), 300, null)::text,
    '{"ok": false, "reason": "state"}');

  -- Disconnect while a sign-in is between claim and complete ends it.
  perform pg_temp.tsa_begin('studio', 'a3-mid');
  perform pg_temp.tsa_claim('a3-mid');
  perform pg_temp.tsa_as('owner', 'select public.mingla_connector_signin_disconnect(''studio'')::text');
  perform pg_temp.tsa_check('A-3', 'Disconnect mid sign-in: the late complete stores nothing',
    pg_temp.tsa_complete('a3-mid', pg_temp.tsa_id('a1'), pg_temp.tsa_id('r1'), 300, null)::text,
    '{"ok": false, "reason": "state"}');
  perform pg_temp.tsa_check('A-3', 'and no Vault secret was made for it',
    (select count(*)::text from vault.secrets where name like 'mingla_connector_signin:%'), '0');

  -- A state the row was switched away from cannot be claimed.
  perform pg_temp.tsa_begin('studiob', 'a3-kind');
  perform pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studiob","auth_kind":"key"}''::jsonb)::text');
  perform pg_temp.tsa_check('A-3', 'a row switched to a key no longer honours its sign-in state',
    pg_temp.tsa_claim('a3-kind')::text, '{"ok": false}');
  perform pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studiob","auth_kind":"signin"}''::jsonb)::text');
end;
$a3$;

-- ---------------------------------------------------------------------------
-- A-4 a company sign-in belongs to its address (tester finding, fixed).
-- ---------------------------------------------------------------------------
do $a4$
declare
  v jsonb;
begin
  -- Unconnected: a new address ends any sign-in under way.
  perform pg_temp.tsa_begin('studiob', 'a4-pending');
  perform pg_temp.tsa_check('A-4', 'an unconnected row''s address can change',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studiob","mcp_url":"https://mcp.magnific.com/b2"}''::jsonb)::jsonb ->> ''mcp_url'''),
    'https://mcp.magnific.com/b2');
  perform pg_temp.tsa_check('A-4', 'a sign-in started for the old address can no longer be claimed',
    pg_temp.tsa_claim('a4-pending')::text, '{"ok": false}');

  -- Connected: the address is locked until Disconnect.
  v := pg_temp.tsa_connect('studiob', 'a4-conn', pg_temp.tsa_id('a1'), pg_temp.tsa_id('r1'));
  perform pg_temp.tsa_check('A-4', 'the second row connects', v ->> 'ok', 'true');
  perform pg_temp.tsa_like('A-4', 'a connected row''s address cannot move to another host',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studiob","mcp_url":"https://mcp.evil-example.com"}''::jsonb)::text'),
    'ERR:22023:signin_locked:%');
  perform pg_temp.tsa_check('A-4', 'the refused change kept the address and the sign-in',
    (select mcp_url || ':' || (signin_vault_id is not null)::text from public.mingla_connector_upstreams where slug = 'studiob'),
    'https://mcp.magnific.com/b2:true');
  perform pg_temp.tsa_check('A-4', 'other fields of a connected row still save',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studiob","label":"Studio B2"}''::jsonb)::jsonb ->> ''label'''),
    'Studio B2');
  perform pg_temp.tsa_check('A-4', 'the connected row turns on',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studiob","enabled":true}''::jsonb)::jsonb ->> ''enabled'''),
    'true');
end;
$a4$;

-- ---------------------------------------------------------------------------
-- A-5 complete's inputs.
-- ---------------------------------------------------------------------------
do $a5$
declare
  v jsonb;
begin
  perform pg_temp.tsa_begin('studio', 'a5-ws');
  perform pg_temp.tsa_claim('a5-ws');
  perform pg_temp.tsa_check('A-5', 'a token with a space is refused',
    pg_temp.tsa_complete('a5-ws', repeat('a', 10) || ' ' || repeat('b', 10), pg_temp.tsa_id('r1'), 300, null)::text,
    '{"ok": false, "reason": "tokens"}');
  perform pg_temp.tsa_check('A-5', 'a refresh token with a newline is refused',
    pg_temp.tsa_complete('a5-ws', pg_temp.tsa_id('a1'), repeat('r', 20) || E'\n', 300, null)::text,
    '{"ok": false, "reason": "tokens"}');
  perform pg_temp.tsa_check('A-5', 'a short access token is refused',
    pg_temp.tsa_complete('a5-ws', 'short', pg_temp.tsa_id('r1'), 300, null)::text,
    '{"ok": false, "reason": "tokens"}');
  v := pg_temp.tsa_complete('a5-ws', pg_temp.tsa_id('a1'), pg_temp.tsa_id('r1'), -5,
         '<script>alert(1)</script>' || E'\x01' || repeat('n', 200));
  perform pg_temp.tsa_check('A-5', 'the same claim still completes once the tokens are good',
    v ->> 'ok', 'true');
  perform pg_temp.tsa_check('A-5', 'the account loses angle brackets and control characters and is cut to 120',
    (v ->> 'account' !~ '[<>[:cntrl:]]')::text || ':' || char_length(v ->> 'account')::text, 'true:120');
  perform pg_temp.tsa_check('A-5', 'a negative lifetime is clamped to 30 seconds',
    (select (signin_expires_at between clock_timestamp() + interval '20 seconds' and clock_timestamp() + interval '40 seconds')::text
       from public.mingla_connector_upstreams where slug = 'studio'), 'true');
  perform pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","enabled":true}''::jsonb)::text');
end;
$a5$;

-- ---------------------------------------------------------------------------
-- A-6 renewal lease takeover; PT409 never 40001.
-- ---------------------------------------------------------------------------
do $a6$
declare
  v       jsonb;
  v_call  text;
  v_gen   integer;
  v_old   text;
  v_new   text;
begin
  v := pg_temp.tsa_call(pg_temp.tsa_id('growth.key'), 'studio', 'stock_search');
  v_call := v ->> 'call_id';
  perform pg_temp.tsa_check('A-6', 'growth may call the connected studio row', v ->> 'ok', 'true');
  v_gen := (pg_temp.tsa_sj(format('select public.mingla_connector_signin_credential(%L)::text', v_call)) ->> 'generation')::integer;
  v_old := pg_temp.tsa_sj(format('select public.mingla_connector_signin_refresh_begin(%L, %s)::text', v_call, v_gen)) ->> 'lease';
  perform pg_temp.tsa_check('A-6', 'the first renewer holds a lease', (v_old is not null)::text, 'true');
  -- The holder stalls past its lease.
  update public.mingla_connector_upstreams set signin_lease_until = clock_timestamp() - interval '1 second' where slug = 'studio';
  v_new := pg_temp.tsa_sj(format('select public.mingla_connector_signin_refresh_begin(%L, %s)::text', v_call, v_gen)) ->> 'lease';
  perform pg_temp.tsa_check('A-6', 'an ended lease can be taken over', (v_new is not null and v_new <> v_old)::text, 'true');
  perform pg_temp.tsa_like('A-6', 'the stalled holder cannot store',
    pg_temp.tsa_as('service', format('select public.mingla_connector_signin_refresh_store(%L, %L, %L, %L, %s)::text',
      v_call, v_old, pg_temp.tsa_id('a3'), pg_temp.tsa_id('r3'), 300)), 'ERR:PT409:%');
  perform pg_temp.tsa_like('A-6', 'the stalled holder cannot mark Reconnect needed',
    pg_temp.tsa_as('service', format('select public.mingla_connector_signin_refresh_fail(%L, %L, %L)::text', v_call, v_old, 'invalid_grant')),
    'ERR:PT409:%');
  perform pg_temp.tsa_check('A-6', 'so the row is still fine',
    (select (signin_reconnect_at is null)::text from public.mingla_connector_upstreams where slug = 'studio'), 'true');
  perform pg_temp.tsa_like('A-6', 'a store with no lease is PT409',
    pg_temp.tsa_as('service', format('select public.mingla_connector_signin_refresh_store(%L, null, %L, %L, %s)::text',
      v_call, pg_temp.tsa_id('a3'), pg_temp.tsa_id('r3'), 300)), 'ERR:PT409:%');
  perform pg_temp.tsa_like('A-6', 'an unknown reason is refused',
    pg_temp.tsa_as('service', format('select public.mingla_connector_signin_refresh_fail(%L, %L, %L)::text', v_call, v_new, 'other')),
    'ERR:22023:%');
  v := pg_temp.tsa_sj(format('select public.mingla_connector_signin_refresh_store(%L, %L, %L, %L, %s)::text',
         v_call, v_new, pg_temp.tsa_id('a2'), pg_temp.tsa_id('r2'), 999999));
  perform pg_temp.tsa_check('A-6', 'the new holder stores; the generation moves one step',
    (v ->> 'ok') || ':' || ((v ->> 'generation')::integer - v_gen)::text, 'true:1');
  perform pg_temp.tsa_check('A-6', 'a huge lifetime is clamped to a day',
    (select (signin_expires_at <= clock_timestamp() + interval '86401 seconds')::text from public.mingla_connector_upstreams where slug = 'studio'),
    'true');
  perform pg_temp.tsa_like('A-6', 'a renewer on a stale generation is PT409',
    pg_temp.tsa_as('service', format('select public.mingla_connector_signin_refresh_begin(%L, %s)::text', v_call, v_gen)), 'ERR:PT409:%');
  perform pg_temp.tsa_check('A-6', 'no refusal in this suite was a 40001',
    (select count(*)::text from tsa_seen where body like 'ERR:40001%'), '0');
  perform pg_temp.tsa_finish(v_call, 'ok');
  perform pg_temp.tsa_check('A-6', 'a renewal store for a finished call stores nothing',
    pg_temp.tsa_as('service', format('select public.mingla_connector_signin_refresh_store(%L, %L, %L, %L, %s)::text',
      v_call, v_new, pg_temp.tsa_id('a3'), pg_temp.tsa_id('r3'), 300)), '{"ok": false}');
end;
$a6$;

-- ---------------------------------------------------------------------------
-- A-7 the generation cap (I-4294-12).
-- ---------------------------------------------------------------------------
do $a7$
declare
  v      jsonb;
  v_day  timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  v_key  uuid;
  i      integer;
begin
  select key_id into v_key from public.mingla_connector_calls
   where owner_email = 'issue4294ta-growth@test.local' limit 1;
  -- Three generation calls just before midnight UTC yesterday, and a refused one today: none count.
  insert into public.mingla_connector_calls (owner_email, key_id, actor_role, upstream, tool, started_at, outcome, duration_ms)
  select 'issue4294ta-growth@test.local', v_key, 'growth', 'studio', 'video_generate', v_day - interval '1 second', 'ok', 5
    from generate_series(1, 3);
  insert into public.mingla_connector_calls (owner_email, key_id, actor_role, upstream, tool, started_at, outcome, duration_ms)
  values ('issue4294ta-growth@test.local', v_key, 'growth', 'studio', 'video_generate', v_day + interval '1 second', 'not_allowed', 0),
         ('issue4294ta-growth@test.local', v_key, 'growth', 'studio', 'video_generate', v_day + interval '2 seconds', 'generation_limit', 0);
  for i in 1..2 loop
    v := pg_temp.tsa_call(pg_temp.tsa_id('growth.key'), 'studio', 'video_generate');
    perform pg_temp.tsa_check('A-7', 'today''s generation call ' || i || ' of 2 is allowed (yesterday and refused calls do not count)',
      v ->> 'ok', 'true');
    perform pg_temp.tsa_finish(v ->> 'call_id', case when i = 1 then 'upstream_tool_error' else 'ok' end);
  end loop;
  v := pg_temp.tsa_call(pg_temp.tsa_id('growth.key'), 'studio', 'images_generate');
  perform pg_temp.tsa_check('A-7', 'the third is refused (a call the tool answered with an error still counts)',
    (v ->> 'ok') || ':' || (v ->> 'token'), 'false:generation_limit');
  perform pg_temp.tsa_check('A-7', 'a refused call cannot read the token',
    pg_temp.tsa_as('service', format('select public.mingla_connector_signin_credential(%L)::text', v ->> 'call_id')), '{"ok": false}');
  v := pg_temp.tsa_call(pg_temp.tsa_id('growth.key'), 'studio', 'stock_search');
  perform pg_temp.tsa_check('A-7', 'a non-generation tool is not counted or refused', v ->> 'ok', 'true');
  perform pg_temp.tsa_finish(v ->> 'call_id', 'ok');
  v := pg_temp.tsa_call(pg_temp.tsa_id('growth.key'), 'studiob', 'video_generate');
  perform pg_temp.tsa_check('A-7', 'another row is counted separately', v ->> 'ok', 'true');
  perform pg_temp.tsa_finish(v ->> 'call_id', 'ok');
  v := pg_temp.tsa_call(pg_temp.tsa_id('owner.key'), 'studio', 'video_generate');
  perform pg_temp.tsa_check('A-7', 'another person is counted separately', v ->> 'ok', 'true');
  perform pg_temp.tsa_finish(v ->> 'call_id', 'ok');
  -- Exactly at midnight UTC counts as today.
  update public.mingla_connector_calls set started_at = v_day
   where owner_email = 'issue4294ta-owner@test.local' and upstream = 'studio' and tool = 'video_generate';
  v := pg_temp.tsa_call(pg_temp.tsa_id('owner.key'), 'studio', 'video_generate');
  perform pg_temp.tsa_check('A-7', 'a call at exactly 00:00 UTC counts toward today', v ->> 'ok', 'true');
  perform pg_temp.tsa_finish(v ->> 'call_id', 'ok');
  v := pg_temp.tsa_call(pg_temp.tsa_id('owner.key'), 'studio', 'video_generate');
  perform pg_temp.tsa_check('A-7', 'so the owner''s third is refused', v ->> 'token', 'generation_limit');
  -- Cap 0 refuses the first call.
  perform pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studiob","daily_generation_cap":0}''::jsonb)::text');
  v := pg_temp.tsa_call(pg_temp.tsa_id('owner.key'), 'studiob', 'images_generate');
  perform pg_temp.tsa_check('A-7', 'cap 0 refuses every generation call', v ->> 'token', 'generation_limit');
  v := pg_temp.tsa_call(pg_temp.tsa_id('owner.key'), 'studiob', 'stock_search');
  perform pg_temp.tsa_check('A-7', 'cap 0 leaves other tools alone', v ->> 'ok', 'true');
  perform pg_temp.tsa_finish(v ->> 'call_id', 'ok');
  perform pg_temp.tsa_like('A-7', 'a negative cap is refused',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studiob","daily_generation_cap":-1}''::jsonb)::text'),
    'ERR:22023:invalid_daily_cap:%');
  perform pg_temp.tsa_like('A-7', 'a fractional cap is refused',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studiob","daily_generation_cap":2.5}''::jsonb)::text'),
    'ERR:22023:invalid_daily_cap:%');
  perform pg_temp.tsa_like('A-7', 'a cap as text is refused',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studiob","daily_generation_cap":"5"}''::jsonb)::text'),
    'ERR:22023:invalid_daily_cap:%');
end;
$a7$;

-- ---------------------------------------------------------------------------
-- A-8 key rows as before; the kind is locked while a key or sign-in is set.
-- ---------------------------------------------------------------------------
do $a8$
declare
  v      jsonb;
  v_call text;
begin
  perform pg_temp.tsa_check('A-8', 'a PostHog key is set as before',
    pg_temp.tsa_as('owner', format('select public.mingla_connector_set_key(%L, %L)::jsonb ->> ''key_set''', 'posthog', pg_temp.tsa_id('pk'))),
    'true');
  perform pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"posthog","enabled":true,"allowed_roles":["owner","growth"]}''::jsonb)::text');
  v := pg_temp.tsa_call(pg_temp.tsa_id('growth.key'), 'posthog', 'tools/list');
  v_call := v ->> 'call_id';
  perform pg_temp.tsa_check('A-8', 'a key row''s call is a key call with no hidden words',
    (v ->> 'ok') || ':' || (v ->> 'auth_kind') || ':' || (v -> 'hide_words')::text, 'true:key:[]');
  perform pg_temp.tsa_check('A-8', 'the key reader answers the key for it',
    ((pg_temp.tsa_sj(format('select public.mingla_connector_upstream_key(%L)::text', v_call)) ->> 'key') = pg_temp.tsa_id('pk'))::text,
    'true');
  perform pg_temp.tsa_check('A-8', 'the sign-in reader never answers for a key row',
    pg_temp.tsa_as('service', format('select public.mingla_connector_signin_credential(%L)::text', v_call)), '{"ok": false}');
  perform pg_temp.tsa_check('A-8', 'nor does renewal',
    pg_temp.tsa_as('service', format('select public.mingla_connector_signin_refresh_begin(%L, 0)::text', v_call)), '{"ok": false}');
  perform pg_temp.tsa_finish(v_call, 'ok');
  perform pg_temp.tsa_like('A-8', 'a key row with a key cannot switch to sign-in',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"posthog","auth_kind":"signin"}''::jsonb)::text'),
    'ERR:22023:kind_locked:%');
  perform pg_temp.tsa_like('A-8', 'a connected sign-in row cannot switch to a key',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","auth_kind":"key"}''::jsonb)::text'),
    'ERR:22023:kind_locked:%');
  perform pg_temp.tsa_like('A-8', 'a key row cannot start a sign-in', pg_temp.tsa_begin('posthog', 'a8-k'), 'ERR:22023:key_only:%');
  perform pg_temp.tsa_like('A-8', 'a key row cannot be disconnected as a sign-in',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_signin_disconnect(''posthog'')::text'), 'ERR:22023:key_only:%');
  perform pg_temp.tsa_like('A-8', 'no sign-in field can be written through save',
    pg_temp.tsa_as('owner', format('select public.mingla_connector_registry_save(%L::jsonb)::text',
      jsonb_build_object('slug', 'studio', 'signin_vault_id', gen_random_uuid()))), 'ERR:22023:invalid_field:%');
  perform pg_temp.tsa_like('A-8', 'nor the reconnect mark',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_save(''{"slug":"studio","signin_reconnect_at":null}''::jsonb)::text'),
    'ERR:22023:invalid_field:%');
  perform pg_temp.tsa_check('A-8', 'every key row is still kind key with no sign-in block',
    (select string_agg(r ->> 'slug' || ':' || (r ->> 'auth_kind') || ':' || coalesce(r -> 'signin', 'null'::jsonb)::text, ',' order by r ->> 'slug')
       from jsonb_array_elements(pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_list()::text')::jsonb -> 'rows') r
      where r ->> 'auth_kind' = 'key'),
    'appsflyer:key:null,metaads:key:null,posthog:key:null,sentry:key:null');
end;
$a8$;

-- ---------------------------------------------------------------------------
-- A-9 nothing a client or an audit row sees holds a token or the Vault id.
-- ---------------------------------------------------------------------------
do $a9$
declare
  v_all   text;
  v_vault text;
  t       text;
  v_n     integer;
begin
  select string_agg(signin_vault_id::text, ',') into v_vault from public.mingla_connector_upstreams where signin_vault_id is not null;
  v_all := coalesce(pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_list()::text'), '')
        || coalesce(pg_temp.tsa_as('owner', 'select public.mingla_connector_signin_status(''studio'')::text'), '')
        || coalesce(pg_temp.tsa_as('owner', 'select public.mingla_connector_signin_status(''studiob'')::text'), '')
        || coalesce(pg_temp.tsa_as('owner', 'select public.mingla_connector_calls_recent(100)::text'), '')
        || coalesce((select string_agg(metadata::text, '|') from public.admin_audit_log where action like 'connector.%'), '')
        || coalesce((select string_agg(row_to_json(c)::text, '|') from public.mingla_connector_calls c), '')
        || coalesce((select string_agg(row_to_json(s)::text, '|') from public.mingla_connector_signin_states s), '')
        || coalesce((select string_agg((row_to_json(u)::jsonb - 'signin_vault_id')::text, '|') from public.mingla_connector_upstreams u), '');
  foreach t in array array[pg_temp.tsa_id('a1'), pg_temp.tsa_id('r1'), pg_temp.tsa_id('a2'), pg_temp.tsa_id('r2')] loop
    perform pg_temp.tsa_check('A-9', 'no slice of ' || left(t, 4) || ' in any client answer, audit row or table row', pg_temp.tsa_leaks(v_all, t)::text, 'false');
  end loop;
  perform pg_temp.tsa_check('A-9', 'the Vault ids are in no client answer or audit row',
    (v_vault is not null and strpos(v_all, split_part(v_vault, ',', 1)) = 0)::text, 'true');
  perform pg_temp.tsa_check('A-9', 'the client answers carried rows (the check is not vacuous)', (length(v_all) > 500)::text, 'true');

  -- Deleting a connected sign-in row deletes its secret.
  select count(*) into v_n from vault.secrets where name like 'mingla_connector_signin:studiob:%';
  perform pg_temp.tsa_check('A-9', 'studiob holds one secret', v_n::text, '1');
  perform pg_temp.tsa_check('A-9', 'deleting a connected sign-in row works',
    pg_temp.tsa_as('owner', 'select public.mingla_connector_registry_delete(''studiob'')::jsonb ->> ''deleted'''), 'true');
  perform pg_temp.tsa_check('A-9', 'and its secret is gone',
    (select count(*)::text from vault.secrets where name like 'mingla_connector_signin:studiob:%'), '0');
end;
$a9$;

do $verdict$
declare
  v_total int;
  v_failed int;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from tsa_results;
  for r in select * from tsa_results where not ok order by seq loop
    raise warning 'ISSUE-4294 SIGNIN ADVERSARIAL FAILED % | % | %', r.test, r.label, r.detail;
  end loop;
  if v_failed > 0 or v_total < 120 then
    raise exception 'ISSUE-4294 SIGNIN ADVERSARIAL FAIL: % of % checks failed (at least 120 must run)', v_failed, v_total;
  end if;
  raise notice 'ISSUE-4294 SIGNIN ADVERSARIAL PASS: % checks across A-1..A-9, 0 failed', v_total;
end;
$verdict$;

rollback;
