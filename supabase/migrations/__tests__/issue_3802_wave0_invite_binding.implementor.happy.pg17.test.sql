-- Issue #3802 (Wave 0) — implementor suite for one-time team invitations
-- (PostgreSQL 17).
--
-- Proves, on the fully replayed schema:
--   B-1  an invited person who has not opened their invitation stays invited
--   B-2  open, then activate: active, invitation gone, one audit row, idempotent
--   B-3  an invitation opened for one account cannot be used by another
--   B-4  an invitation opens once; expired, unknown and mismatched ones do not
--   B-5  an opened invitation must be finished within 24 hours
--   B-6  remove, role change, undo and re-send each end the previous invitation
--   B-7  inviting someone who already has access is refused and changes nothing
--   B-8  only the owner issues or lists invitations; only the service role
--        looks one up or opens it
--   B-9  an opened invitation activates only the role it was sent for
--   B-10 one full-admin row per address, however it is spelled
--   B-11 two sessions writing one person into both tables queue up (real
--        second and third sessions)
--   B-12 privilege matrix for the fourteen team functions and the table
--   B-13 the writer set, the trigger set and the reader set are pinned by name
--   B-16 the previous self-activation function still returns quietly for
--        someone with nothing to activate
--
-- B-14 and B-15 (the migration refuses to apply on a wrong grant or on
-- duplicate addresses) are shown in the implementation record on the issue;
-- they need a fresh database per attempt and are not run here.
--
-- Parts B-1..B-10, B-12, B-13, B-16 are transaction-contained and rolled
-- back. B-11 has to COMMIT its two rows (other sessions must see them); they
-- carry their own address and are removed at the end. Never run on production.
--
-- Runs as the image's admin role, like the two team-roles suites: the bare CI
-- image ships an auth.users without email_confirmed_at, and B-11 needs
-- CREATE EXTENSION and session_replication_role.
--
-- "Opening the link" is simulated by calling admin_team_redeem_invite as the
-- service role, which is what the accept function does.
--
-- Checks are RECORDED and reported together.

\set ON_ERROR_STOP on
\getenv t3802b_pw PGPASSWORD

-- ===========================================================================
-- PART 1 — one transaction, rolled back.
-- ===========================================================================
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table t3802b_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3802b_people (who, id, email) values
  ('owner',     '38020000-0000-4000-b000-000000000001', 'issue3802b-owner@test.local'),
  ('admin',     '38020000-0000-4000-b000-000000000002', 'issue3802b-admin@test.local'),
  ('consumer',  '38020000-0000-4000-b000-000000000003', 'issue3802b-consumer@test.local'),
  ('g',         '38020000-0000-4000-b000-000000000004', 'issue3802b-g@test.local'),
  ('a',         '38020000-0000-4000-b000-000000000005', 'issue3802b-a@test.local'),
  ('p',         '38020000-0000-4000-b000-000000000006', 'issue3802b-p@test.local'),
  ('la',        '38020000-0000-4000-b000-000000000007', 'issue3802b-la@test.local'),
  ('twin',      '38020000-0000-4000-b000-000000000008', 'issue3802b-twin@test.local'),
  ('twinv',     '38020000-0000-4000-b000-000000000009', 'Issue3802B-Twin@Test.Local'),
  ('twina',     '38020000-0000-4000-b000-00000000000a', 'issue3802b-twina@test.local'),
  ('twinav',    '38020000-0000-4000-b000-00000000000b', 'Issue3802B-TwinA@Test.Local'),
  ('r1',        '38020000-0000-4000-b000-00000000000c', 'issue3802b-r1@test.local'),
  ('r2',        '38020000-0000-4000-b000-00000000000d', 'issue3802b-r2@test.local'),
  ('r3',        '38020000-0000-4000-b000-00000000000e', 'issue3802b-r3@test.local'),
  ('late',      '38020000-0000-4000-b000-00000000000f', 'issue3802b-late@test.local'),
  ('latea',     '38020000-0000-4000-b000-000000000010', 'issue3802b-latea@test.local'),
  ('x',         '38020000-0000-4000-b000-000000000011', 'issue3802b-x@test.local'),
  ('swap',      '38020000-0000-4000-b000-000000000012', 'issue3802b-swap@test.local');

insert into auth.users (id, email, email_confirmed_at)
select id, email, now() from t3802b_people;

insert into public.admin_users (email, role, status, accepted_at) values
  ('issue3802b-owner@test.local', 'owner', 'active', now()),
  ('issue3802b-admin@test.local', 'admin', 'active', now());

create temp table t3802b_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

-- Run one statement as a caller; return its single text result, or
-- 'ERR:<sqlstate>:<message>'. A raised statement leaves nothing behind.
create function pg_temp.t3802b_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who not in ('anon', 'postgres', 'service') then
    select id, email into strict v_id, v_email from t3802b_people where who = p_who;
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
    elsif p_who = 'postgres' then
      set local role postgres;
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;

create function pg_temp.t3802b_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3802b_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(p_got, '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t3802b_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3802b_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(p_got, '<null>'), p_pattern));
end;
$fn$;

-- One field of a JSON result; a non-JSON value (a captured error) is returned
-- as it is, so a refusal is recorded as a failed check, not a crash.
create function pg_temp.t3802b_field(p text, p_key text) returns text
language plpgsql as $fn$
begin
  return p::jsonb ->> p_key;
exception when others then
  return p;
end;
$fn$;

-- The stored form of a made-up link secret.
create function pg_temp.t3802b_h(p text) returns text
language sql immutable as $fn$
  select encode(sha256(convert_to('issue3802b:' || p, 'UTF8')), 'hex')
$fn$;

-- Both membership tables, row for row.
create function pg_temp.t3802b_team() returns text
language sql as $fn$
  select coalesce((select jsonb_agg(to_jsonb(a) order by a.email) from public.admin_users a), '[]'::jsonb)::text
      || coalesce((select jsonb_agg(to_jsonb(m) order by m.email) from public.admin_team_members m), '[]'::jsonb)::text
$fn$;

create function pg_temp.t3802b_invites() returns text
language sql as $fn$
  select coalesce((select jsonb_agg(to_jsonb(i) order by i.email) from public.admin_team_invites i), '[]'::jsonb)::text
$fn$;

create function pg_temp.t3802b_audit() returns int
language sql as $fn$
  select count(*)::int from public.admin_audit_log where target_type = 'team_member'
$fn$;

-- The owner sends an invitation; returns the function's result as text.
create function pg_temp.t3802b_issue(p_who text, p_role text, p_secret text) returns text
language sql as $fn$
  select pg_temp.t3802b_as('owner', format(
    $q$select public.admin_team_issue_invite(%L, %L, %L)::text$q$,
    'issue3802b-' || p_who || '@test.local', p_role, pg_temp.t3802b_h(p_secret)))
$fn$;

-- The accept function opens an invitation for one account.
create function pg_temp.t3802b_open(p_secret text, p_who text) returns text
language sql as $fn$
  select pg_temp.t3802b_as('service', format(
    $q$select public.admin_team_redeem_invite(%L, %L)->>'state'$q$,
    pg_temp.t3802b_h(p_secret), (select id from t3802b_people where who = p_who)))
$fn$;

create function pg_temp.t3802b_peek(p_secret text) returns text
language sql as $fn$
  select pg_temp.t3802b_as('service', format(
    $q$select public.admin_team_invite_peek(%L)->>'state'$q$, pg_temp.t3802b_h(p_secret)))
$fn$;

create function pg_temp.t3802b_state(p_who text) returns text
language sql as $fn$
  select coalesce(pg_temp.t3802b_as('owner', format(
    $q$select state from public.admin_team_invite_states() where email = %L$q$,
    'issue3802b-' || p_who || '@test.local')), 'none')
$fn$;

-- ---------------------------------------------------------------------------
-- Setup through the product path: the owner sends five invitations.
-- ---------------------------------------------------------------------------
do $setup$
declare
  r text;
  v_audit int := pg_temp.t3802b_audit();
begin
  r := pg_temp.t3802b_issue('g', 'growth', 'g1');
  perform pg_temp.t3802b_check('B-2', 'issue returns the writer result plus an expiry',
    (r::jsonb - 'expires_at')::text,
    '{"role": "growth", "email": "issue3802b-g@test.local", "status": "invited", "changed": true, "previous": null}');
  perform pg_temp.t3802b_check('B-2', 'expiry is seven days out',
    ((r::jsonb ->> 'expires_at')::timestamptz = now() + interval '7 days')::text, 'true');
  perform pg_temp.t3802b_check('B-12', 'issue result carries no secret or hash',
    (r::jsonb ?| array['token', 'token_hash', 'hash', 'link', 'secret'])::text, 'false');
  perform pg_temp.t3802b_check('B-2', 'owner invites an admin',
    pg_temp.t3802b_field(pg_temp.t3802b_issue('a', 'admin', 'a1'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-2', 'owner invites a partner',
    pg_temp.t3802b_field(pg_temp.t3802b_issue('p', 'partner', 'p1'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-2', 'owner invites a second admin',
    pg_temp.t3802b_field(pg_temp.t3802b_issue('la', 'admin', 'la1'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-2', 'four invitations wrote four invite audit rows',
    (select count(*)::text from public.admin_audit_log
      where target_type = 'team_member' and action = 'team.invite'
        and admin_email = 'issue3802b-owner@test.local'), '4');
  perform pg_temp.t3802b_check('B-2', 'and nothing else', (pg_temp.t3802b_audit() - v_audit)::text, '4');
  perform pg_temp.t3802b_check('B-12', 'only a 64-character hex hash is stored',
    (select bool_and(token_hash ~ '^[0-9a-f]{64}$')::text || '/' || count(*)::text from public.admin_team_invites), 'true/4');
  perform pg_temp.t3802b_check('B-2', 'the stored invitation names the owner and the role',
    (select role || '/' || issued_by || '/' || (redeemed_at is null)::text || '/' || (redeemed_user_id is null)::text
       from public.admin_team_invites where email = 'issue3802b-a@test.local'),
    'admin/issue3802b-owner@test.local/true/true');
  perform pg_temp.t3802b_check('B-2', 'owner sees four pending invitations',
    pg_temp.t3802b_as('owner', $q$select string_agg(state, ',') from public.admin_team_invite_states()$q$),
    'pending,pending,pending,pending');
end;
$setup$;

-- ---------------------------------------------------------------------------
-- B-1 — invited, link not opened: nothing activates.
-- ---------------------------------------------------------------------------
-- An account created only now, for an address that was already invited.
insert into auth.users (id, email, email_confirmed_at)
  values ('38020000-0000-4000-b000-000000000020', 'issue3802b-fresh@test.local', now());
insert into t3802b_people values ('fresh', '38020000-0000-4000-b000-000000000020', 'issue3802b-fresh@test.local');

do $b1$
declare
  v_team text;
  v_inv text;
  v_audit int;
  v_who text;
begin
  -- The fresh account is invited while it does not exist yet in the list above.
  perform pg_temp.t3802b_check('B-1', 'owner invites the address of a brand-new account',
    pg_temp.t3802b_field(pg_temp.t3802b_issue('fresh', 'growth', 'f1'), 'changed'), 'true');

  v_team := pg_temp.t3802b_team();
  v_inv := pg_temp.t3802b_invites();
  v_audit := pg_temp.t3802b_audit();

  foreach v_who in array array['g', 'a', 'p', 'la', 'fresh'] loop
    perform pg_temp.t3802b_check('B-1', v_who || ': activation without opening the link leaves them invited',
      pg_temp.t3802b_as(v_who, $q$select public.admin_team_activate_self()->>'status'$q$), 'invited');
    perform pg_temp.t3802b_check('B-1', v_who || ': the previous activation function changes nothing either',
      coalesce(pg_temp.t3802b_as(v_who, $q$select public.activate_invited_admin()::text$q$), ''), '');
    perform pg_temp.t3802b_check('B-1', v_who || ': no role',
      coalesce(pg_temp.t3802b_as(v_who, $q$select public.admin_team_role()$q$), '<none>'), '<none>');
    perform pg_temp.t3802b_check('B-1', v_who || ': not a full admin',
      pg_temp.t3802b_as(v_who, $q$select public.is_admin_user()::text$q$), 'false');
  end loop;

  perform pg_temp.t3802b_check('B-1', 'both membership tables are unchanged', (pg_temp.t3802b_team() = v_team)::text, 'true');
  perform pg_temp.t3802b_check('B-1', 'the invitations are unchanged', (pg_temp.t3802b_invites() = v_inv)::text, 'true');
  perform pg_temp.t3802b_check('B-1', 'no audit row was written', pg_temp.t3802b_audit()::text, v_audit::text);
end;
$b1$;

-- ---------------------------------------------------------------------------
-- B-2 — open, then activate.
-- ---------------------------------------------------------------------------
do $b2$
declare
  v_audit int := pg_temp.t3802b_audit();
  v_team text;
  r text;
begin
  -- Sales and marketing, through the new function.
  perform pg_temp.t3802b_check('B-2', 'lookup before opening', pg_temp.t3802b_peek('g1'), 'pending');
  perform pg_temp.t3802b_check('B-2', 'lookup names the account for the address',
    pg_temp.t3802b_as('service', format($q$select public.admin_team_invite_peek(%L)::text$q$, pg_temp.t3802b_h('g1')))::jsonb::text,
    '{"role": "growth", "email": "issue3802b-g@test.local", "state": "pending", "user_id": "38020000-0000-4000-b000-000000000004"}');
  perform pg_temp.t3802b_check('B-2', 'opening the link', pg_temp.t3802b_open('g1', 'g'), 'redeemed');
  perform pg_temp.t3802b_check('B-2', 'owner sees it as opened', pg_temp.t3802b_state('g'), 'opened');
  perform pg_temp.t3802b_check('B-2', 'still invited until they finish',
    pg_temp.t3802b_as('g', $q$select public.admin_team_my_access()->>'status'$q$), 'invited');
  r := pg_temp.t3802b_as('g', $q$select public.admin_team_activate_self()::text$q$);
  perform pg_temp.t3802b_check('B-2', 'growth activates', r::jsonb::text,
    '{"role": "growth", "areas": ["role_home"], "email": "issue3802b-g@test.local", "status": "active"}');
  perform pg_temp.t3802b_check('B-2', 'the invitation is gone', pg_temp.t3802b_state('g'), 'none');
  perform pg_temp.t3802b_check('B-2', 'the used link no longer exists', pg_temp.t3802b_peek('g1'), 'invalid');
  perform pg_temp.t3802b_check('B-2', 'one audit row, in their own name',
    (select count(*)::text from public.admin_audit_log
      where target_type = 'team_member' and action = 'team.activate'
        and admin_email = 'issue3802b-g@test.local' and target_id = 'issue3802b-g@test.local'), '1');
  perform pg_temp.t3802b_check('B-2', 'and only that one', (pg_temp.t3802b_audit() - v_audit)::text, '1');
  v_team := pg_temp.t3802b_team();
  perform pg_temp.t3802b_check('B-2', 'a second call returns the same access',
    pg_temp.t3802b_as('g', $q$select public.admin_team_activate_self()::text$q$)::jsonb::text, r::jsonb::text);
  perform pg_temp.t3802b_check('B-2', 'a second call changes nothing', (pg_temp.t3802b_team() = v_team)::text, 'true');
  perform pg_temp.t3802b_check('B-2', 'a second call writes no audit row', (pg_temp.t3802b_audit() - v_audit)::text, '1');

  -- Admin, through the new function.
  perform pg_temp.t3802b_check('B-2', 'admin opens their link', pg_temp.t3802b_open('a1', 'a'), 'redeemed');
  perform pg_temp.t3802b_check('B-2', 'admin activates',
    pg_temp.t3802b_as('a', $q$select public.admin_team_activate_self()->>'status'$q$), 'active');
  perform pg_temp.t3802b_check('B-2', 'and is a full admin',
    pg_temp.t3802b_as('a', $q$select public.admin_team_role() || '/' || public.is_admin_user()::text$q$), 'admin/true');
  perform pg_temp.t3802b_check('B-2', 'the admin invitation is gone', pg_temp.t3802b_state('a'), 'none');

  -- Partner.
  perform pg_temp.t3802b_check('B-2', 'partner opens their link', pg_temp.t3802b_open('p1', 'p'), 'redeemed');
  perform pg_temp.t3802b_check('B-2', 'partner activates',
    pg_temp.t3802b_as('p', $q$select public.admin_team_activate_self()->>'status'$q$), 'active');
  perform pg_temp.t3802b_check('B-2', 'and is a partner, not a full admin',
    pg_temp.t3802b_as('p', $q$select public.admin_team_role() || '/' || public.is_admin_user()::text$q$), 'partner/false');

  -- Admin, through the previous function (what the previous client calls).
  perform pg_temp.t3802b_check('B-2', 'second admin opens their link', pg_temp.t3802b_open('la1', 'la'), 'redeemed');
  perform pg_temp.t3802b_check('B-2', 'previous activation function runs for them',
    coalesce(pg_temp.t3802b_as('la', $q$select public.activate_invited_admin()::text$q$), ''), '');
  perform pg_temp.t3802b_check('B-2', '...and they are now an admin',
    pg_temp.t3802b_as('la', $q$select public.admin_team_role() || '/' || public.is_admin_user()::text$q$), 'admin/true');
  perform pg_temp.t3802b_check('B-2', '...and their invitation is gone', pg_temp.t3802b_state('la'), 'none');
  perform pg_temp.t3802b_check('B-2', 'four activations in total wrote three audit rows (the previous function writes none)',
    (pg_temp.t3802b_audit() - v_audit)::text, '3');
end;
$b2$;

-- ---------------------------------------------------------------------------
-- B-3 — the invitation belongs to the account it was opened for.
-- ---------------------------------------------------------------------------
do $b3$
declare
  v_team text;
  v_audit int;
begin
  perform pg_temp.t3802b_check('B-3', 'owner invites twin', pg_temp.t3802b_field(pg_temp.t3802b_issue('twin', 'growth', 't1'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-3', 'owner invites twina', pg_temp.t3802b_field(pg_temp.t3802b_issue('twina', 'admin', 'ta1'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-3', 'twin opens their link', pg_temp.t3802b_open('t1', 'twin'), 'redeemed');
  perform pg_temp.t3802b_check('B-3', 'twina opens their link', pg_temp.t3802b_open('ta1', 'twina'), 'redeemed');

  v_team := pg_temp.t3802b_team();
  v_audit := pg_temp.t3802b_audit();
  -- A second account carrying the same address in another spelling.
  perform pg_temp.t3802b_check('B-3', 'another account with the same address cannot activate (team role)',
    pg_temp.t3802b_as('twinv', $q$select public.admin_team_activate_self()->>'status'$q$), 'invited');
  perform pg_temp.t3802b_check('B-3', 'another account with the same address cannot activate (admin)',
    pg_temp.t3802b_as('twinav', $q$select public.admin_team_activate_self()->>'status'$q$), 'invited');
  perform pg_temp.t3802b_check('B-3', 'nor through the previous function',
    coalesce(pg_temp.t3802b_as('twinav', $q$select public.activate_invited_admin()::text$q$), ''), '');
  perform pg_temp.t3802b_check('B-3', 'the other account is not a full admin',
    pg_temp.t3802b_as('twinav', $q$select public.is_admin_user()::text$q$), 'false');
  perform pg_temp.t3802b_check('B-3', 'nothing changed', (pg_temp.t3802b_team() = v_team)::text, 'true');
  perform pg_temp.t3802b_check('B-3', 'no audit row', pg_temp.t3802b_audit()::text, v_audit::text);
  perform pg_temp.t3802b_check('B-3', 'the invitations are still open for the right accounts',
    pg_temp.t3802b_state('twin') || '/' || pg_temp.t3802b_state('twina'), 'opened/opened');

  -- Control: the accounts the links were opened for do activate.
  perform pg_temp.t3802b_check('B-3', 'control: the right account activates (team role)',
    pg_temp.t3802b_as('twin', $q$select public.admin_team_activate_self()->>'status'$q$), 'active');
  perform pg_temp.t3802b_check('B-3', 'control: the right account activates (admin, previous function)',
    coalesce(pg_temp.t3802b_as('twina', $q$select public.activate_invited_admin()::text$q$), '')
      || '/' || pg_temp.t3802b_as('twina', $q$select public.is_admin_user()::text$q$), '/true');
end;
$b3$;

-- ---------------------------------------------------------------------------
-- B-4 — once, in time, known, and for the right address.
-- ---------------------------------------------------------------------------
do $b4$
declare
  v_inv text;
begin
  perform pg_temp.t3802b_check('B-4', 'owner invites r1', pg_temp.t3802b_field(pg_temp.t3802b_issue('r1', 'growth', 'r1'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-4', 'owner invites r2', pg_temp.t3802b_field(pg_temp.t3802b_issue('r2', 'partner', 'r2'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-4', 'owner invites r3', pg_temp.t3802b_field(pg_temp.t3802b_issue('r3', 'admin', 'r3'), 'changed'), 'true');

  perform pg_temp.t3802b_check('B-4', 'first open', pg_temp.t3802b_open('r1', 'r1'), 'redeemed');
  perform pg_temp.t3802b_check('B-4', 'second open', pg_temp.t3802b_open('r1', 'r1'), 'used');
  perform pg_temp.t3802b_check('B-4', 'lookup after opening', pg_temp.t3802b_peek('r1'), 'used');
  perform pg_temp.t3802b_check('B-4', 'a used link cannot be moved to another account',
    pg_temp.t3802b_open('r1', 'consumer'), 'used');
  perform pg_temp.t3802b_check('B-4', 'the first opening stands',
    (select redeemed_user_id::text from public.admin_team_invites where email = 'issue3802b-r1@test.local'),
    '38020000-0000-4000-b000-00000000000c');

  update public.admin_team_invites set expires_at = now() - interval '1 minute' where email = 'issue3802b-r2@test.local';
  perform pg_temp.t3802b_check('B-4', 'open after expiry', pg_temp.t3802b_open('r2', 'r2'), 'expired');
  perform pg_temp.t3802b_check('B-4', 'lookup after expiry', pg_temp.t3802b_peek('r2'), 'expired');
  perform pg_temp.t3802b_check('B-4', 'owner sees it as expired', pg_temp.t3802b_state('r2'), 'expired');
  perform pg_temp.t3802b_check('B-4', 'an expired invitation was not opened',
    (select (redeemed_at is null)::text from public.admin_team_invites where email = 'issue3802b-r2@test.local'), 'true');

  perform pg_temp.t3802b_check('B-4', 'open with an unknown link', pg_temp.t3802b_open('never-issued', 'r3'), 'invalid');
  perform pg_temp.t3802b_check('B-4', 'lookup of an unknown link', pg_temp.t3802b_peek('never-issued'), 'invalid');
  perform pg_temp.t3802b_check('B-4', 'lookup of nothing',
    pg_temp.t3802b_as('service', $q$select public.admin_team_invite_peek(null)->>'state'$q$), 'invalid');

  v_inv := pg_temp.t3802b_invites();
  perform pg_temp.t3802b_check('B-4', 'open for an account with a different address', pg_temp.t3802b_open('r3', 'consumer'), 'invalid');
  perform pg_temp.t3802b_check('B-4', 'open for no account',
    pg_temp.t3802b_as('service', format($q$select public.admin_team_redeem_invite(%L, null)->>'state'$q$, pg_temp.t3802b_h('r3'))), 'invalid');
  perform pg_temp.t3802b_check('B-4', 'open for an account that does not exist',
    pg_temp.t3802b_as('service', format($q$select public.admin_team_redeem_invite(%L, '38020000-0000-4000-b000-0000000000ff')->>'state'$q$, pg_temp.t3802b_h('r3'))), 'invalid');
  perform pg_temp.t3802b_check('B-4', 'a refused open uses nothing up', (pg_temp.t3802b_invites() = v_inv)::text, 'true');
  perform pg_temp.t3802b_check('B-4', 'the link still opens for the right account', pg_temp.t3802b_open('r3', 'r3'), 'redeemed');
end;
$b4$;

-- ---------------------------------------------------------------------------
-- B-5 — 24 hours to finish after opening.
-- ---------------------------------------------------------------------------
do $b5$
declare
  v_team text;
  v_audit int;
begin
  perform pg_temp.t3802b_check('B-5', 'owner invites late', pg_temp.t3802b_field(pg_temp.t3802b_issue('late', 'growth', 'l1'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-5', 'owner invites latea', pg_temp.t3802b_field(pg_temp.t3802b_issue('latea', 'admin', 'la-late'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-5', 'late opens', pg_temp.t3802b_open('l1', 'late'), 'redeemed');
  perform pg_temp.t3802b_check('B-5', 'latea opens', pg_temp.t3802b_open('la-late', 'latea'), 'redeemed');
  update public.admin_team_invites set redeemed_at = now() - interval '25 hours'
   where email in ('issue3802b-late@test.local', 'issue3802b-latea@test.local');

  v_team := pg_temp.t3802b_team();
  v_audit := pg_temp.t3802b_audit();
  perform pg_temp.t3802b_check('B-5', 'opened 25 hours ago: still invited (team role)',
    pg_temp.t3802b_as('late', $q$select public.admin_team_activate_self()->>'status'$q$), 'invited');
  perform pg_temp.t3802b_check('B-5', 'opened 25 hours ago: still invited (admin)',
    pg_temp.t3802b_as('latea', $q$select public.admin_team_activate_self()->>'status'$q$), 'invited');
  perform pg_temp.t3802b_check('B-5', 'opened 25 hours ago: previous function changes nothing',
    coalesce(pg_temp.t3802b_as('latea', $q$select public.activate_invited_admin()::text$q$), '')
      || '/' || pg_temp.t3802b_as('latea', $q$select public.is_admin_user()::text$q$), '/false');
  perform pg_temp.t3802b_check('B-5', 'nothing changed', (pg_temp.t3802b_team() = v_team)::text, 'true');
  perform pg_temp.t3802b_check('B-5', 'no audit row', pg_temp.t3802b_audit()::text, v_audit::text);
  perform pg_temp.t3802b_check('B-5', 'owner sees both as expired',
    pg_temp.t3802b_state('late') || '/' || pg_temp.t3802b_state('latea'), 'expired/expired');
  perform pg_temp.t3802b_check('B-5', 'and the link cannot be opened again', pg_temp.t3802b_open('l1', 'late'), 'used');

  -- Control: inside the window it works.
  update public.admin_team_invites set redeemed_at = now() - interval '23 hours'
   where email = 'issue3802b-late@test.local';
  perform pg_temp.t3802b_check('B-5', 'control: opened 23 hours ago activates',
    pg_temp.t3802b_as('late', $q$select public.admin_team_activate_self()->>'status'$q$), 'active');
end;
$b5$;

-- ---------------------------------------------------------------------------
-- B-6 — every membership change ends the previous invitation.
-- ---------------------------------------------------------------------------
do $b6$
declare
  r text;
  v_audit int;
begin
  -- Remove.
  perform pg_temp.t3802b_check('B-6', 'owner invites x', pg_temp.t3802b_field(pg_temp.t3802b_issue('x', 'growth', 'x1'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-6', 'x1 is pending', pg_temp.t3802b_peek('x1'), 'pending');
  perform pg_temp.t3802b_check('B-6', 'owner removes x',
    pg_temp.t3802b_as('owner', $q$select public.admin_team_set_member('issue3802b-x@test.local', 'growth', 'revoked')->>'changed'$q$), 'true');
  perform pg_temp.t3802b_check('B-6', 'after removal the link is dead', pg_temp.t3802b_peek('x1'), 'invalid');
  perform pg_temp.t3802b_check('B-6', 'after removal the link cannot be opened', pg_temp.t3802b_open('x1', 'x'), 'invalid');

  -- Undo of the removal: invited again, but with no link until one is sent.
  perform pg_temp.t3802b_check('B-6', 'owner undoes the removal',
    pg_temp.t3802b_as('owner', $q$select public.admin_team_set_member('issue3802b-x@test.local', 'growth', 'invited')->>'changed'$q$), 'true');
  perform pg_temp.t3802b_check('B-6', 'after the undo the old link is still dead', pg_temp.t3802b_peek('x1'), 'invalid');
  perform pg_temp.t3802b_check('B-6', 'after the undo there is no invitation', pg_temp.t3802b_state('x'), 'none');
  perform pg_temp.t3802b_check('B-6', 'after the undo they cannot activate',
    pg_temp.t3802b_as('x', $q$select public.admin_team_activate_self()->>'status'$q$), 'invited');

  -- Send again: same role, still invited = a re-send.
  v_audit := pg_temp.t3802b_audit();
  r := pg_temp.t3802b_issue('x', 'growth', 'x2');
  perform pg_temp.t3802b_check('B-6', 'sending to someone already invited is a re-send', pg_temp.t3802b_field(r, 'changed'), 'false');
  perform pg_temp.t3802b_check('B-6', 'a re-send writes one audit row of its own',
    (select count(*)::text from public.admin_audit_log
      where target_type = 'team_member' and action = 'team.invite_resend'
        and admin_email = 'issue3802b-owner@test.local' and target_id = 'issue3802b-x@test.local'), '1');
  perform pg_temp.t3802b_check('B-6', 'and no other', (pg_temp.t3802b_audit() - v_audit)::text, '1');
  perform pg_temp.t3802b_check('B-6', 'x2 is pending', pg_temp.t3802b_peek('x2'), 'pending');

  -- Role change.
  perform pg_temp.t3802b_check('B-6', 'owner changes the invited role',
    pg_temp.t3802b_as('owner', $q$select public.admin_team_set_member('issue3802b-x@test.local', 'partner', 'invited')->>'changed'$q$), 'true');
  perform pg_temp.t3802b_check('B-6', 'after a role change the link is dead', pg_temp.t3802b_peek('x2'), 'invalid');
  perform pg_temp.t3802b_check('B-6', 'after a role change there is no invitation', pg_temp.t3802b_state('x'), 'none');

  -- Re-send replaces.
  perform pg_temp.t3802b_check('B-6', 'owner sends x3', pg_temp.t3802b_field(pg_temp.t3802b_issue('x', 'partner', 'x3'), 'changed'), 'false');
  perform pg_temp.t3802b_check('B-6', 'x3 is opened', pg_temp.t3802b_open('x3', 'x'), 'redeemed');
  perform pg_temp.t3802b_check('B-6', 'owner sends x4', pg_temp.t3802b_field(pg_temp.t3802b_issue('x', 'partner', 'x4'), 'changed'), 'false');
  perform pg_temp.t3802b_check('B-6', 'after a re-send the old link is dead', pg_temp.t3802b_peek('x3'), 'invalid');
  perform pg_temp.t3802b_check('B-6', 'after a re-send only the new link is pending', pg_temp.t3802b_peek('x4'), 'pending');
  perform pg_temp.t3802b_check('B-6', 'a re-send clears the earlier opening',
    (select (redeemed_at is null)::text || '/' || (redeemed_user_id is null)::text
       from public.admin_team_invites where email = 'issue3802b-x@test.local'), 'true/true');
  perform pg_temp.t3802b_check('B-6', 'an opening of the replaced link no longer activates',
    pg_temp.t3802b_as('x', $q$select public.admin_team_activate_self()->>'status'$q$), 'invited');
  perform pg_temp.t3802b_check('B-6', 'one invitation row per person',
    (select count(*)::text from public.admin_team_invites where email = 'issue3802b-x@test.local'), '1');

  -- Role change across the two tables (partner -> admin) while invited.
  perform pg_temp.t3802b_check('B-6', 'owner sends an admin invitation instead',
    pg_temp.t3802b_field(pg_temp.t3802b_issue('x', 'admin', 'x5'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-6', 'the partner link is dead', pg_temp.t3802b_peek('x4'), 'invalid');
  perform pg_temp.t3802b_check('B-6', 'the admin link is pending with the new role',
    pg_temp.t3802b_as('service', format($q$select (public.admin_team_invite_peek(%L)->>'state') || '/' || (public.admin_team_invite_peek(%L)->>'role')$q$,
      pg_temp.t3802b_h('x5'), pg_temp.t3802b_h('x5'))), 'pending/admin');
end;
$b6$;

-- ---------------------------------------------------------------------------
-- B-7 — inviting someone who already has access.
-- ---------------------------------------------------------------------------
do $b7$
declare
  v_team text := pg_temp.t3802b_team();
  v_inv text := pg_temp.t3802b_invites();
  v_audit int := pg_temp.t3802b_audit();
begin
  perform pg_temp.t3802b_check('B-7', 'inviting an active team member in the same role is refused',
    pg_temp.t3802b_issue('g', 'growth', 'again1'), 'ERR:23505:already_active');
  perform pg_temp.t3802b_check('B-7', 'inviting an active team member in another role is refused',
    pg_temp.t3802b_issue('g', 'admin', 'again2'), 'ERR:23505:already_active');
  perform pg_temp.t3802b_check('B-7', 'inviting an active admin is refused',
    pg_temp.t3802b_issue('admin', 'partner', 'again3'), 'ERR:23505:already_active');
  perform pg_temp.t3802b_check('B-7', 'their rows and acceptance times are unchanged', (pg_temp.t3802b_team() = v_team)::text, 'true');
  perform pg_temp.t3802b_check('B-7', 'no invitation was created', (pg_temp.t3802b_invites() = v_inv)::text, 'true');
  perform pg_temp.t3802b_check('B-7', 'no audit row', pg_temp.t3802b_audit()::text, v_audit::text);
  perform pg_temp.t3802b_check('B-7', 'they still have their access',
    pg_temp.t3802b_as('g', $q$select public.admin_team_role()$q$) || '/' || pg_temp.t3802b_as('admin', $q$select public.admin_team_role()$q$),
    'growth/admin');
end;
$b7$;

-- ---------------------------------------------------------------------------
-- B-8 — who may call what.
-- ---------------------------------------------------------------------------
do $b8$
declare
  v_team text := pg_temp.t3802b_team();
  v_inv text := pg_temp.t3802b_invites();
  v_audit int := pg_temp.t3802b_audit();
  v_who text;
  v_bad text;
begin
  -- admin and g are active; twinv is invited-by-address only; consumer has nothing.
  foreach v_who in array array['admin', 'g', 'p', 'twinv', 'consumer'] loop
    perform pg_temp.t3802b_check('B-8', v_who || ': sending an invitation is refused',
      pg_temp.t3802b_as(v_who, format($q$select public.admin_team_issue_invite('issue3802b-someone@test.local', 'growth', %L)::text$q$, pg_temp.t3802b_h('nope'))),
      'ERR:42501:forbidden');
    perform pg_temp.t3802b_check('B-8', v_who || ': listing invitations is refused',
      pg_temp.t3802b_as(v_who, $q$select count(*)::text from public.admin_team_invite_states()$q$), 'ERR:42501:forbidden');
  end loop;
  perform pg_temp.t3802b_like('B-8', 'anon: sending an invitation is refused',
    pg_temp.t3802b_as('anon', format($q$select public.admin_team_issue_invite('issue3802b-someone@test.local', 'growth', %L)::text$q$, pg_temp.t3802b_h('nope'))),
    'ERR:42501:%');
  perform pg_temp.t3802b_like('B-8', 'anon: listing invitations is refused',
    pg_temp.t3802b_as('anon', $q$select count(*)::text from public.admin_team_invite_states()$q$), 'ERR:42501:%');

  -- Looking an invitation up or opening it: the service role only. The owner
  -- included: nothing a browser session can call returns or accepts a hash.
  foreach v_who in array array['anon', 'consumer', 'g', 'admin', 'owner'] loop
    perform pg_temp.t3802b_like('B-8', v_who || ': invitation lookup is refused',
      pg_temp.t3802b_as(v_who, format($q$select public.admin_team_invite_peek(%L)::text$q$, pg_temp.t3802b_h('x5'))), 'ERR:42501:%');
    perform pg_temp.t3802b_like('B-8', v_who || ': opening an invitation is refused',
      pg_temp.t3802b_as(v_who, format($q$select public.admin_team_redeem_invite(%L, '38020000-0000-4000-b000-000000000011')::text$q$, pg_temp.t3802b_h('x5'))), 'ERR:42501:%');
    perform pg_temp.t3802b_like('B-8', v_who || ': reading the invitations table is refused',
      pg_temp.t3802b_as(v_who, $q$select count(*)::text from public.admin_team_invites$q$), 'ERR:42501:%');
    perform pg_temp.t3802b_like('B-8', v_who || ': writing the invitations table is refused',
      pg_temp.t3802b_as(v_who, $q$with x as (update public.admin_team_invites set redeemed_at = now(), redeemed_user_id = '38020000-0000-4000-b000-000000000011' returning 1) select count(*)::text from x$q$), 'ERR:42501:%');
    perform pg_temp.t3802b_like('B-8', v_who || ': deleting from the invitations table is refused',
      pg_temp.t3802b_as(v_who, $q$with x as (delete from public.admin_team_invites returning 1) select count(*)::text from x$q$), 'ERR:42501:%');
  end loop;

  -- The owner's own request is validated.
  foreach v_bad in array array['abc', repeat('g', 64), upper(pg_temp.t3802b_h('u')), pg_temp.t3802b_h('u') || '0', ''] loop
    perform pg_temp.t3802b_check('B-8', 'owner: a malformed hash is refused [' || length(v_bad) || ']',
      pg_temp.t3802b_as('owner', format($q$select public.admin_team_issue_invite('issue3802b-someone@test.local', 'growth', %L)::text$q$, v_bad)),
      'ERR:22023:invalid_token');
  end loop;
  perform pg_temp.t3802b_check('B-8', 'owner: a missing hash is refused',
    pg_temp.t3802b_as('owner', $q$select public.admin_team_issue_invite('issue3802b-someone@test.local', 'growth', null)::text$q$),
    'ERR:22023:invalid_token');
  perform pg_temp.t3802b_check('B-8', 'owner: cannot invite themself',
    pg_temp.t3802b_as('owner', format($q$select public.admin_team_issue_invite('issue3802b-owner@test.local', 'admin', %L)::text$q$, pg_temp.t3802b_h('self'))),
    'ERR:42501:cannot_change_self');
  perform pg_temp.t3802b_check('B-8', 'owner: the owner role can never be sent',
    pg_temp.t3802b_as('owner', format($q$select public.admin_team_issue_invite('issue3802b-someone@test.local', 'owner', %L)::text$q$, pg_temp.t3802b_h('own'))),
    'ERR:22023:invalid_role');
  perform pg_temp.t3802b_check('B-8', 'owner: a malformed address is refused',
    pg_temp.t3802b_as('owner', format($q$select public.admin_team_issue_invite('not-an-email', 'growth', %L)::text$q$, pg_temp.t3802b_h('bad'))),
    'ERR:22023:invalid_email');
  perform pg_temp.t3802b_check('B-8', 'owner: one hash cannot serve two people',
    pg_temp.t3802b_as('owner', format($q$select public.admin_team_issue_invite('issue3802b-someone@test.local', 'growth', %L)::text$q$, pg_temp.t3802b_h('x5'))),
    'ERR:23505:duplicate key value violates unique constraint "admin_team_invites_hash_key"');

  perform pg_temp.t3802b_check('B-8', 'no refusal changed a membership', (pg_temp.t3802b_team() = v_team)::text, 'true');
  perform pg_temp.t3802b_check('B-8', 'no refusal changed an invitation', (pg_temp.t3802b_invites() = v_inv)::text, 'true');
  perform pg_temp.t3802b_check('B-8', 'no refusal wrote an audit row', pg_temp.t3802b_audit()::text, v_audit::text);
end;
$b8$;

-- ---------------------------------------------------------------------------
-- B-9 — an invitation activates only the role it was sent for.
-- ---------------------------------------------------------------------------
do $b9$
declare
  v_audit int;
begin
  perform pg_temp.t3802b_check('B-9', 'owner invites swap as growth', pg_temp.t3802b_field(pg_temp.t3802b_issue('swap', 'growth', 's1'), 'changed'), 'true');
  perform pg_temp.t3802b_check('B-9', 'swap opens', pg_temp.t3802b_open('s1', 'swap'), 'redeemed');
  -- The stored role is rewritten behind the invitation's back.
  update public.admin_team_members set role = 'partner' where email = 'issue3802b-swap@test.local';
  v_audit := pg_temp.t3802b_audit();
  perform pg_temp.t3802b_check('B-9', 'the invitation does not activate a different role',
    pg_temp.t3802b_as('swap', $q$select (public.admin_team_activate_self()->>'role') || '/' || (public.admin_team_my_access()->>'status')$q$),
    'partner/invited');
  perform pg_temp.t3802b_check('B-9', 'their row is still invited',
    (select role || '/' || status || '/' || (accepted_at is null)::text
       from public.admin_team_members where email = 'issue3802b-swap@test.local'), 'partner/invited/true');
  perform pg_temp.t3802b_check('B-9', 'no audit row', pg_temp.t3802b_audit()::text, v_audit::text);
  perform pg_temp.t3802b_check('B-9', 'a team invitation never opens the full-admin table',
    coalesce(pg_temp.t3802b_as('swap', $q$select public.activate_invited_admin()::text$q$), '')
      || '/' || pg_temp.t3802b_as('swap', $q$select public.is_admin_user()::text$q$), '/false');
end;
$b9$;

-- ---------------------------------------------------------------------------
-- B-10 — one row per address, however it is spelled, for every writer.
-- ---------------------------------------------------------------------------
do $b10$
begin
  perform pg_temp.t3802b_check('B-10', 'first spelling is stored',
    pg_temp.t3802b_as('postgres', $q$with x as (insert into public.admin_users (email, role, status) values ('Dup3802B@Test.Local', 'admin', 'revoked') returning 1) select count(*)::text from x$q$), '1');
  perform pg_temp.t3802b_check('B-10', 'the same address padded and in lower case is refused',
    pg_temp.t3802b_as('postgres', $q$with x as (insert into public.admin_users (email, role, status) values (' dup3802b@test.local ', 'admin', 'revoked') returning 1) select count(*)::text from x$q$),
    'ERR:23505:duplicate key value violates unique constraint "admin_users_email_normalised_key"');
  perform pg_temp.t3802b_check('B-10', 'the same address in upper case is refused',
    pg_temp.t3802b_as('postgres', $q$with x as (insert into public.admin_users (email, role, status) values ('DUP3802B@TEST.LOCAL', 'admin', 'invited') returning 1) select count(*)::text from x$q$),
    'ERR:23505:duplicate key value violates unique constraint "admin_users_email_normalised_key"');
  perform pg_temp.t3802b_check('B-10', 'a row cannot be re-addressed onto another row',
    pg_temp.t3802b_as('postgres', $q$with x as (update public.admin_users set email = 'dup3802b@test.local ' where email = 'issue3802b-admin@test.local' returning 1) select count(*)::text from x$q$),
    'ERR:23505:duplicate key value violates unique constraint "admin_users_email_normalised_key"');
  perform pg_temp.t3802b_check('B-10', 'the service role is refused as well',
    pg_temp.t3802b_as('service', $q$with x as (insert into public.admin_users (email, role, status) values ('dup3802b@test.local', 'admin', 'revoked') returning 1) select count(*)::text from x$q$),
    'ERR:23505:duplicate key value violates unique constraint "admin_users_email_normalised_key"');
  perform pg_temp.t3802b_check('B-10', 'one row for that address',
    (select count(*)::text from public.admin_users where lower(btrim(email)) = 'dup3802b@test.local'), '1');
  perform pg_temp.t3802b_check('B-10', 'both indexes are unique and valid',
    (select string_agg(c.relname || ':' || x.indisunique::text || ':' || x.indisvalid::text, ',' order by c.relname)
       from pg_index x join pg_class c on c.oid = x.indexrelid
      where c.relname in ('admin_users_email_normalised_key', 'admin_team_members_email_normalised_key')),
    'admin_team_members_email_normalised_key:true:true,admin_users_email_normalised_key:true:true');
  perform pg_temp.t3802b_check('B-10', 'no address appears twice in either table',
    (select count(*)::text from (select lower(btrim(email)) from public.admin_users group by 1 having count(*) > 1) d)
      || '/' || (select count(*)::text from (select lower(btrim(email)) from public.admin_team_members group by 1 having count(*) > 1) d),
    '0/0');
end;
$b10$;

-- ---------------------------------------------------------------------------
-- B-12 — privilege matrix.
-- ---------------------------------------------------------------------------
do $b12$
declare
  f record;
  v_role text;
  v_priv text;
  v_guard text;
begin
  for f in
    select * from (values
      ('public.admin_team_role()',                         true,  true),
      ('public.admin_team_role_areas(text)',               true,  false),
      ('public.admin_team_can(text)',                      true,  false),
      ('public.admin_team_my_access()',                    true,  true),
      ('public.admin_team_activate_self()',                true,  true),
      ('public.admin_team_list()',                         true,  true),
      ('public.admin_team_set_member(text,text,text)',     true,  true),
      ('public.admin_team_issue_invite(text,text,text)',   true,  true),
      ('public.admin_team_invite_states()',                true,  true),
      ('public.activate_invited_admin()',                  true,  true),
      ('public.admin_team_caller_email()',                 false, true),
      ('public.admin_team_guard_exclusive()',              false, false),
      ('public.admin_team_invite_peek(text)',              false, true),
      ('public.admin_team_redeem_invite(text,uuid)',       false, true)
    ) as v(sig, signed_in, definer)
  loop
    perform pg_temp.t3802b_check('B-12', f.sig || ' anonymous execute',
      has_function_privilege('anon', f.sig, 'EXECUTE')::text, 'false');
    perform pg_temp.t3802b_check('B-12', f.sig || ' is not executable by everyone',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = f.sig::regprocedure and a.grantee = 0), '0');
    perform pg_temp.t3802b_check('B-12', f.sig || ' has an explicit grant list',
      (select (p.proacl is not null)::text from pg_proc p where p.oid = f.sig::regprocedure), 'true');
    perform pg_temp.t3802b_check('B-12', f.sig || ' signed-in execute',
      has_function_privilege('authenticated', f.sig, 'EXECUTE')::text, f.signed_in::text);
    perform pg_temp.t3802b_check('B-12', f.sig || ' grantees',
      (select string_agg(g.rolname, ',' order by g.rolname)
         from pg_proc p, aclexplode(p.proacl) a join pg_roles g on g.oid = a.grantee
        where p.oid = f.sig::regprocedure and a.grantee <> p.proowner),
      case when f.signed_in then 'authenticated,service_role' else 'service_role' end);
    perform pg_temp.t3802b_check('B-12', f.sig || ' resolves names against nothing',
      (select p.proconfig::text from pg_proc p where p.oid = f.sig::regprocedure), '{"search_path=\"\""}');
    perform pg_temp.t3802b_check('B-12', f.sig || ' runs as expected',
      (select p.prosecdef::text from pg_proc p where p.oid = f.sig::regprocedure), f.definer::text);
  end loop;

  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      perform pg_temp.t3802b_check('B-12', v_role || ' ' || v_priv || ' on admin_team_invites',
        has_table_privilege(v_role, 'public.admin_team_invites', v_priv)::text, 'false');
    end loop;
  end loop;
  perform pg_temp.t3802b_check('B-12', 'invitations table: grantees other than its owner',
    (select string_agg(distinct g.rolname, ',' order by g.rolname)
       from pg_class c, aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee
      where c.oid = 'public.admin_team_invites'::regclass and a.grantee <> c.relowner), 'service_role');
  perform pg_temp.t3802b_check('B-12', 'invitations table: nothing granted to everyone',
    (select count(*)::text from pg_class c, aclexplode(c.relacl) a
      where c.oid = 'public.admin_team_invites'::regclass and a.grantee = 0), '0');
  perform pg_temp.t3802b_check('B-12', 'invitations table: no column-level grant',
    (select count(*)::text from pg_attribute
      where attrelid = 'public.admin_team_invites'::regclass and attacl is not null), '0');
  perform pg_temp.t3802b_check('B-12', 'invitations table: row security is on',
    (select relrowsecurity::text from pg_class where oid = 'public.admin_team_invites'::regclass), 'true');
  perform pg_temp.t3802b_check('B-12', 'invitations table: no policy',
    (select count(*)::text from pg_policy where polrelid = 'public.admin_team_invites'::regclass), '0');
  perform pg_temp.t3802b_check('B-12', 'invitations table: not published to subscribers',
    (select count(*)::text from pg_publication_tables
      where schemaname = 'public' and tablename = 'admin_team_invites'), '0');
  perform pg_temp.t3802b_check('B-12', 'no function a signed-in caller may run returns an invitation hash',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~* 'admin_team_invites'
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and pg_get_function_result(p.oid) ~* 'hash'), '0');
  -- Asked as the migration role, the way the guard is run in CI.
  set local role postgres;
  select count(*)::text into v_guard from public.audit_overbroad_table_grants() where not is_baselined;
  reset role;
  perform pg_temp.t3802b_check('B-12', 'grant guard reports nothing new', v_guard, '0');
end;
$b12$;

-- ---------------------------------------------------------------------------
-- B-13 — writers, triggers and readers are pinned by name. A new one must be
-- added here deliberately.
-- ---------------------------------------------------------------------------
do $b13$
begin
  perform pg_temp.t3802b_check('B-13', 'functions in any schema that write a membership table',
    (select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prokind in ('f', 'p') and n.nspname !~ '^pg_temp'
        and p.prosrc ~* '(insert\s+into|update|delete\s+from|merge\s+into|truncate(\s+table)?)\s+(only\s+)?(public\.)?"?(admin_users|admin_team_members)\M'),
    'public.activate_invited_admin,public.admin_team_activate_self,public.admin_team_set_member');
  perform pg_temp.t3802b_check('B-13', 'functions in any schema that mention the team table at all',
    (select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prokind in ('f', 'p') and n.nspname !~ '^pg_temp' and p.prosrc ~* 'admin_team_members'),
    'public.admin_team_activate_self,public.admin_team_guard_exclusive,public.admin_team_list,public.admin_team_my_access,public.admin_team_role,public.admin_team_set_member');
  perform pg_temp.t3802b_check('B-13', 'triggers on the two membership tables',
    (select string_agg(t.tgrelid::regclass::text || '.' || t.tgname || '/' || t.tgenabled::text, ',' order by t.tgname)
       from pg_trigger t
      where t.tgrelid in ('public.admin_users'::regclass, 'public.admin_team_members'::regclass)
        and not t.tgisinternal),
    'admin_team_members.admin_team_members_guard_exclusive/O,admin_users.admin_users_guard_exclusive/O');
  perform pg_temp.t3802b_check('B-13', 'functions in any schema that write the invitations table',
    (select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prokind in ('f', 'p') and n.nspname !~ '^pg_temp'
        and p.prosrc ~* '(insert\s+into|update|delete\s+from|merge\s+into|truncate(\s+table)?)\s+(only\s+)?(public\.)?"?admin_team_invites\M'),
    'public.activate_invited_admin,public.admin_team_activate_self,public.admin_team_issue_invite,public.admin_team_redeem_invite,public.admin_team_set_member');
  perform pg_temp.t3802b_check('B-13', 'no trigger on the invitations table',
    (select count(*)::text from pg_trigger t
      where t.tgrelid = 'public.admin_team_invites'::regclass and not t.tgisinternal), '0');
  perform pg_temp.t3802b_check('B-13', 'no policy anywhere reads the team functions or tables',
    (select count(*)::text from pg_policies
      where coalesce(qual, '') || coalesce(with_check, '') ~* 'admin_team_'), '0');
  perform pg_temp.t3802b_check('B-13', 'both activation functions require an opened invitation',
    (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~ 'redeemed_user_id\s*=\s*auth\.uid\(\)'),
    'activate_invited_admin,admin_team_activate_self');
end;
$b13$;

-- ---------------------------------------------------------------------------
-- B-16 — the previous client keeps signing the owner in.
-- ---------------------------------------------------------------------------
do $b16$
declare
  v_team text := pg_temp.t3802b_team();
  v_inv text := pg_temp.t3802b_invites();
  v_audit int := pg_temp.t3802b_audit();
begin
  perform pg_temp.t3802b_check('B-16', 'previous activation function returns quietly for the owner',
    coalesce(pg_temp.t3802b_as('owner', $q$select public.activate_invited_admin()::text$q$), ''), '');
  perform pg_temp.t3802b_check('B-16', '...and for an active admin',
    coalesce(pg_temp.t3802b_as('admin', $q$select public.activate_invited_admin()::text$q$), ''), '');
  perform pg_temp.t3802b_check('B-16', '...and for an ordinary account',
    coalesce(pg_temp.t3802b_as('consumer', $q$select public.activate_invited_admin()::text$q$), ''), '');
  perform pg_temp.t3802b_check('B-16', 'the new activation function returns the owner their access',
    pg_temp.t3802b_as('owner', $q$select public.admin_team_activate_self()->>'role'$q$), 'owner');
  perform pg_temp.t3802b_like('B-16', 'anon can no longer call the previous function',
    pg_temp.t3802b_as('anon', $q$select public.activate_invited_admin()::text$q$), 'ERR:42501:%');
  perform pg_temp.t3802b_check('B-16', 'nothing changed', (pg_temp.t3802b_team() = v_team)::text, 'true');
  perform pg_temp.t3802b_check('B-16', 'no invitation changed', (pg_temp.t3802b_invites() = v_inv)::text, 'true');
  perform pg_temp.t3802b_check('B-16', 'no audit row', pg_temp.t3802b_audit()::text, v_audit::text);
  perform pg_temp.t3802b_check('B-16', 'the admin list the previous client reads still names the owner',
    pg_temp.t3802b_as('owner', $q$select count(*)::text from public.get_admin_emails() where email = 'issue3802b-owner@test.local'$q$), '1');
  perform pg_temp.t3802b_check('B-16', 'the owner is still the owner',
    pg_temp.t3802b_as('owner', $q$select public.admin_team_role() || '/' || public.is_admin_user()::text$q$), 'owner/true');
end;
$b16$;

-- ---------------------------------------------------------------------------
-- Verdict for part 1.
-- ---------------------------------------------------------------------------
do $verdict$
declare
  v_total int;
  v_failed int;
  v_tests text;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from t3802b_results;
  if v_total < 342 then
    raise exception 'ISSUE-3802 INVITES FAIL: only % checks ran; the suite did not execute fully', v_total;
  end if;
  if v_failed > 0 then
    for r in select * from t3802b_results where not ok order by seq limit 60 loop
      raise warning 'ISSUE-3802 INVITES FAILED % | % | %', r.test, r.label, r.detail;
    end loop;
    select string_agg(distinct test, ', ' order by test) into v_tests from t3802b_results where not ok;
    raise exception 'ISSUE-3802 INVITES FAIL: % of % checks failed in: %', v_failed, v_total, v_tests;
  end if;
  raise notice 'ISSUE-3802 INVITES PASS (part 1): % checks across B-1..B-10, B-12, B-13, B-16, 0 failed', v_total;
end;
$verdict$;

rollback;

-- ===========================================================================
-- PART 2 — B-11, real concurrency. Two rows are committed and removed.
-- ===========================================================================
create schema t3802b_race;
select count(*) = 0 as t3802b_made_dblink from pg_extension where extname = 'dblink' \gset
create extension if not exists dblink with schema t3802b_race;
select n.nspname as t3802b_dblink_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
 where e.extname = 'dblink' \gset
set search_path = public, :"t3802b_dblink_schema";
select set_config('t3802b.conn',
  format('host=127.0.0.1 port=%s dbname=%s user=%s password=%s',
         current_setting('port'), current_database(), current_user, :'t3802b_pw'), false) is not null as conn_ready;

create table t3802b_race.results (seq serial primary key, label text, ok boolean, detail text);

-- Leftovers from an interrupted earlier run. Triggers off.
begin;
set local session_replication_role = replica;
delete from public.admin_team_members where email like 'issue3802b-race-%';
delete from public.admin_users where lower(btrim(email)) like 'issue3802b-race-%';
commit;

do $race$
declare
  c_conn constant text := current_setting('t3802b.conn');
  v_c text;
  v_pid int;
  v_waited boolean;
  v_err text;
  v_live text;
  i int;
  v_case record;
begin
  for v_case in
    select * from (values
      -- label, first writer's statement (held open), second writer's statement
      ('B-11a',
       $q$insert into public.admin_team_members (email, role, status) values ('issue3802b-race-a@test.local', 'growth', 'active')$q$,
       $q$insert into public.admin_users (email, role, status) values ('Issue3802B-Race-A@Test.Local', 'admin', 'invited')$q$,
       'issue3802b-race-a@test.local', 'team:growth:active'),
      ('B-11b',
       $q$insert into public.admin_users (email, role, status) values (' issue3802b-race-b@test.local', 'admin', 'active')$q$,
       $q$insert into public.admin_team_members (email, role, status) values ('issue3802b-race-b@test.local', 'partner', 'invited')$q$,
       'issue3802b-race-b@test.local', 'full:admin:active')
    ) as v(label, sql1, sql2, email, want_live)
  loop
    begin
      foreach v_c in array array['t3802b_c1', 't3802b_c2'] loop
        perform dblink_connect(v_c, c_conn);
        perform dblink_exec(v_c, 'begin');
        perform dblink_exec(v_c, 'set local role postgres');
      end loop;

      -- Session 1 writes one table and does NOT commit.
      perform dblink_exec('t3802b_c1', v_case.sql1);

      -- Session 2 writes the other table for the same person meanwhile.
      select x into v_pid from dblink('t3802b_c2', 'select pg_backend_pid()') as t(x int);
      perform dblink_send_query('t3802b_c2', v_case.sql2);
      v_waited := false;
      for i in 1..200 loop
        select exists (select 1 from pg_locks l where l.pid = v_pid and not l.granted) into v_waited;
        exit when v_waited or dblink_is_busy('t3802b_c2') = 0;
        perform pg_sleep(0.05);
      end loop;
      insert into t3802b_race.results (label, ok, detail)
      values (v_case.label || ' the second writer waits for the first', v_waited, 'waited=' || v_waited::text);

      perform dblink_exec('t3802b_c1', 'commit');
      perform * from dblink_get_result('t3802b_c2', false) as t(x text);
      v_err := coalesce(dblink_error_message('t3802b_c2'), '');
      perform * from dblink_get_result('t3802b_c2', false) as t(x text);
      perform dblink_exec('t3802b_c2', 'rollback');

      insert into t3802b_race.results (label, ok, detail)
      values (v_case.label || ' the second writer is refused once the first commits',
              v_err like '%team_membership_conflict%', v_err);

      select coalesce(string_agg(s, ',' order by s), 'none') into v_live from (
        select 'full:' || role || ':' || status as s from public.admin_users
         where lower(btrim(email)) = v_case.email and status <> 'revoked'
        union all
        select 'team:' || role || ':' || status from public.admin_team_members
         where email = v_case.email and status <> 'revoked') q;
      insert into t3802b_race.results (label, ok, detail)
      values (v_case.label || ' exactly one live membership afterwards', v_live = v_case.want_live, v_live);
    exception when others then
      insert into t3802b_race.results (label, ok, detail)
      values (v_case.label || ' ran without an unexpected error', false, sqlstate || ': ' || sqlerrm);
    end;
    foreach v_c in array array['t3802b_c1', 't3802b_c2'] loop
      if v_c = any (coalesce(dblink_get_connections(), '{}')) then
        perform dblink_disconnect(v_c);
      end if;
    end loop;
  end loop;
end;
$race$;

select count(*) as t3802b_race_total,
       count(*) filter (where not ok) as t3802b_race_failed,
       coalesce(string_agg(label || ' [' || coalesce(detail, '') || ']', '; ' order by seq) filter (where not ok), 'none') as t3802b_race_failures
  from t3802b_race.results \gset

-- Remove the committed rows, whatever the verdict.
begin;
set local session_replication_role = replica;
delete from public.admin_team_members where email like 'issue3802b-race-%';
delete from public.admin_users where lower(btrim(email)) like 'issue3802b-race-%';
commit;
reset search_path;
\if :t3802b_made_dblink
drop extension if exists dblink;
\endif
drop schema t3802b_race cascade;

select (:t3802b_race_total < 6 or :t3802b_race_failed > 0) as t3802b_race_bad \gset
\if :t3802b_race_bad
  \echo 'ISSUE-3802 INVITES FAILED (part 2):' :t3802b_race_failures
  do $$ begin raise exception 'ISSUE-3802 INVITES FAIL: concurrency checks failed or did not run'; end $$;
\endif
\echo 'ISSUE-3802 INVITES PASS (part 2):' :t3802b_race_total 'concurrency checks, 0 failed'
