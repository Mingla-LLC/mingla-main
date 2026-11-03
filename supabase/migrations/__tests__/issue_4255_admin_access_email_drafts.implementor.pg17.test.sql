-- Issue #4255 (Wave 1) — admin access, owner protection, shared email drafts
-- and blog writers. Implementor happy-path suite (PostgreSQL 17, after the
-- full migration replay). Transaction-contained: everything is rolled back.
--
-- MINGLA-INVARIANT: I-4255-OWNER-ROW-IS-IMMUTABLE | issue #4255 | No caller (admin, partner, service role, postgres) can delete, demote, deactivate, re-address or truncate the owner row, or promote anyone to owner.
-- MINGLA-INVARIANT: I-4255-PARTNER-IS-FULL-ADMIN | issue #4255 | A Founding partner lives in admin_users and passes is_admin_user(); admin_console stays held only by admin_users roles.
-- MINGLA-INVARIANT: I-4255-TEAM-MANAGE-NEVER-TOUCHES-OWNER-OR-SELF | issue #4255 | Owner, admin and partner manage the team; nobody changes the owner or themselves.
-- MINGLA-INVARIANT: I-4255-EMAIL-DRAFTS-TEAM-SHARED | issue #4255 | Every active teammate reads and creates email drafts; only the author or an admin/partner saves or deletes; a stale save is PT409; outsiders see nothing.
--
-- Runs as the image's admin role: the bare CI image ships auth.users without
-- email_confirmed_at, which is added here and rolled back.
--
-- Checks are recorded, then listed together by the verdict block.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table t4255_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t4255_people (who, id, email) values
  ('owner',    '42550000-0000-4000-8000-000000000001', 'issue4255-owner@test.local'),
  ('admin',    '42550000-0000-4000-8000-000000000002', 'issue4255-admin@test.local'),
  ('partner',  '42550000-0000-4000-8000-000000000003', 'issue4255-partner@test.local'),
  ('growth',   '42550000-0000-4000-8000-000000000004', 'issue4255-growth@test.local'),
  ('growth2',  '42550000-0000-4000-8000-000000000005', 'issue4255-growth2@test.local'),
  ('consumer', '42550000-0000-4000-8000-000000000006', 'issue4255-consumer@test.local'),
  ('target',   '42550000-0000-4000-8000-000000000007', 'issue4255-target@test.local');

insert into auth.users (id, email, email_confirmed_at)
select id, email, now() from t4255_people;

insert into public.admin_users (email, role, status, accepted_at) values
  ('issue4255-owner@test.local',   'owner',   'active', now()),
  ('issue4255-admin@test.local',   'admin',   'active', now()),
  ('issue4255-partner@test.local', 'partner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('issue4255-growth@test.local',  'growth', 'active', now()),
  ('issue4255-growth2@test.local', 'growth', 'active', now()),
  ('issue4255-target@test.local',  'growth', 'active', now());
insert into public.email_templates (name, subject, body) values
  ('issue4255 template', 'Hello', 'Body');

create temp table t4255_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t4255_ids (k text primary key, v text) on commit drop;
grant all on t4255_ids to authenticated, service_role;

-- One statement as a caller; its single text result, or ERR:<sqlstate>:<message>.
create function pg_temp.t4255_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare
  v_id uuid;
  v_email text;
  v_out text;
begin
  if p_who not in ('anon', 'postgres', 'service_role') then
    select id, email into strict v_id, v_email from t4255_people where who = p_who;
  end if;
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif p_who = 'service_role' then
      set local role service_role;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    elsif p_who <> 'postgres' then
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

create function pg_temp.t4255_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t4255_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(p_got, '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.t4255_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t4255_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(p_got, '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.t4255_owner_row() returns text
language sql as $fn$
  select role || '/' || status || '/' || email from public.admin_users where email = 'issue4255-owner@test.local'
$fn$;

-- ---------------------------------------------------------------------------
-- O — the owner row is immutable for every caller.
-- ---------------------------------------------------------------------------
do $o$
declare who text;
begin
  foreach who in array array['admin', 'partner'] loop
    perform pg_temp.t4255_like('O-1', who || ' cannot demote the owner',
      pg_temp.t4255_as(who, $q$select public.admin_team_set_member('issue4255-owner@test.local','admin','active')::text$q$),
      'ERR:42501:cannot_change_owner%');
    perform pg_temp.t4255_like('O-1', who || ' cannot remove the owner',
      pg_temp.t4255_as(who, $q$select public.admin_team_set_member('issue4255-owner@test.local','admin','revoked')::text$q$),
      'ERR:42501:cannot_change_owner%');
    perform pg_temp.t4255_like('O-1', who || ' cannot re-invite the owner as partner',
      pg_temp.t4255_as(who, $q$select public.admin_team_set_member('issue4255-owner@test.local','partner','invited')::text$q$),
      'ERR:42501:cannot_change_owner%');
    perform pg_temp.t4255_like('O-1', who || ' cannot write admin_users directly',
      pg_temp.t4255_as(who, $q$update public.admin_users set role = 'admin' where email = 'issue4255-owner@test.local' returning 'x'$q$),
      'ERR:42501:%');
  end loop;

  foreach who in array array['service_role', 'postgres'] loop
    perform pg_temp.t4255_like('O-2', who || ': delete owner refused',
      pg_temp.t4255_as(who, $q$delete from public.admin_users where email = 'issue4255-owner@test.local' returning 'x'$q$),
      'ERR:42501:cannot_change_owner%');
    perform pg_temp.t4255_like('O-2', who || ': demote owner refused',
      pg_temp.t4255_as(who, $q$update public.admin_users set role = 'admin' where email = 'issue4255-owner@test.local' returning 'x'$q$),
      'ERR:42501:cannot_change_owner%');
    perform pg_temp.t4255_like('O-2', who || ': deactivate owner refused',
      pg_temp.t4255_as(who, $q$update public.admin_users set status = 'revoked' where email = 'issue4255-owner@test.local' returning 'x'$q$),
      'ERR:42501:cannot_change_owner%');
    perform pg_temp.t4255_like('O-2', who || ': re-address owner refused',
      pg_temp.t4255_as(who, $q$update public.admin_users set email = 'someone-else@test.local' where email = 'issue4255-owner@test.local' returning 'x'$q$),
      'ERR:42501:cannot_change_owner%');
    perform pg_temp.t4255_like('O-2', who || ': promote to owner refused',
      pg_temp.t4255_as(who, $q$update public.admin_users set role = 'owner' where email = 'issue4255-admin@test.local' returning 'x'$q$),
      'ERR:42501:cannot_change_owner%');
    perform pg_temp.t4255_like('O-2', who || ': truncate refused',
      pg_temp.t4255_as(who, $q$truncate public.admin_users cascade$q$),
      'ERR:%');
  end loop;

  perform pg_temp.t4255_check('O-3', 'owner row unchanged after every attempt',
    pg_temp.t4255_owner_row(), 'owner/active/issue4255-owner@test.local');
  perform pg_temp.t4255_check('O-3', 'non-owner columns of the owner row can still change',
    pg_temp.t4255_as('postgres', $q$update public.admin_users set invited_by = 'note' where email = 'issue4255-owner@test.local' returning role$q$),
    'owner');
end;
$o$;

-- ---------------------------------------------------------------------------
-- P — a Founding partner is a full admin and keeps the label.
-- ---------------------------------------------------------------------------
do $p$
begin
  perform pg_temp.t4255_check('P-1', 'partner passes is_admin_user()',
    pg_temp.t4255_as('partner', $q$select public.is_admin_user()::text$q$), 'true');
  perform pg_temp.t4255_check('P-1', 'partner role label is kept',
    pg_temp.t4255_as('partner', $q$select public.admin_team_role()$q$), 'partner');
  perform pg_temp.t4255_check('P-1', 'partner holds admin_console',
    pg_temp.t4255_as('partner', $q$select public.admin_team_can('admin_console')::text$q$), 'true');
  perform pg_temp.t4255_check('P-1', 'partner areas equal admin areas',
    pg_temp.t4255_as('partner', $q$select (public.admin_team_my_access()->'areas')::text$q$),
    pg_temp.t4255_as('admin', $q$select (public.admin_team_my_access()->'areas')::text$q$));
  perform pg_temp.t4255_check('P-1', 'partner areas',
    pg_temp.t4255_as('partner', $q$select (public.admin_team_my_access()->'areas')::text$q$),
    '["admin_console", "team_manage", "crm", "beta_leads", "email_drafts"]');
  perform pg_temp.t4255_check('P-2', 'growth stays out of admin',
    pg_temp.t4255_as('growth', $q$select public.is_admin_user()::text || '/' || public.admin_team_can('admin_console')::text || '/' || public.admin_team_can('team_manage')::text$q$),
    'false/false/false');
  perform pg_temp.t4255_check('P-2', 'growth areas',
    pg_temp.t4255_as('growth', $q$select (public.admin_team_my_access()->'areas')::text$q$),
    '["role_home", "crm", "beta_leads", "email_drafts"]');
  perform pg_temp.t4255_like('P-3', 'a live partner row cannot enter admin_team_members',
    pg_temp.t4255_as('postgres', $q$insert into public.admin_team_members (email, role, status) values ('issue4255-legacy@test.local','partner','active') returning 'x'$q$),
    'ERR:23514:%admin_team_members_partner_moved%');
  perform pg_temp.t4255_check('P-4', 'directory labels the partner',
    pg_temp.t4255_as('postgres', $q$select role from public.admin_team_directory() where email = 'issue4255-partner@test.local'$q$),
    'partner');
  perform pg_temp.t4255_check('P-4', 'Data room audit open to the partner',
    pg_temp.t4255_as('partner', $q$select (public.issue_3720_team_my_permissions()->'permissions'->>'data_room_audit')$q$),
    'true');
end;
$p$;

-- ---------------------------------------------------------------------------
-- T — admins and partners manage the team; never the owner, never themselves.
-- ---------------------------------------------------------------------------
do $t$
begin
  perform pg_temp.t4255_like('T-1', 'admin lists the team',
    pg_temp.t4255_as('admin', $q$select count(*)::text from public.admin_team_list()$q$), '%');
  perform pg_temp.t4255_check('T-1', 'partner lists the team without error',
    pg_temp.t4255_as('partner', $q$select (count(*) > 0)::text from public.admin_team_list()$q$), 'true');
  perform pg_temp.t4255_like('T-1', 'growth cannot list the team',
    pg_temp.t4255_as('growth', $q$select count(*)::text from public.admin_team_list()$q$), 'ERR:42501:forbidden%');

  perform pg_temp.t4255_check('T-2', 'partner promotes a growth teammate to partner',
    pg_temp.t4255_as('partner', $q$select (public.admin_team_set_member('issue4255-target@test.local','partner','active')->>'changed')$q$), 'true');
  perform pg_temp.t4255_check('T-2', 'target now holds a partner seat in admin_users',
    pg_temp.t4255_as('postgres', $q$select role || '/' || status from public.admin_users where email = 'issue4255-target@test.local'$q$), 'partner/active');
  perform pg_temp.t4255_check('T-2', 'target team row revoked',
    pg_temp.t4255_as('postgres', $q$select status from public.admin_team_members where email = 'issue4255-target@test.local'$q$), 'revoked');
  perform pg_temp.t4255_check('T-2', 'admin changes the partner to admin',
    pg_temp.t4255_as('admin', $q$select (public.admin_team_set_member('issue4255-target@test.local','admin','active')->>'role')$q$), 'admin');
  perform pg_temp.t4255_check('T-2', 'admin removes the teammate',
    pg_temp.t4255_as('admin', $q$select (public.admin_team_set_member('issue4255-target@test.local','admin','revoked')->>'status')$q$), 'revoked');
  perform pg_temp.t4255_check('T-2', 'admin invites a new growth teammate',
    pg_temp.t4255_as('admin', $q$select (public.admin_team_set_member('issue4255-new@test.local','growth','invited')->>'status')$q$), 'invited');
  perform pg_temp.t4255_check('T-2', 'partner may remove an admin',
    pg_temp.t4255_as('partner', $q$select (public.admin_team_set_member('issue4255-new@test.local','growth','revoked')->>'changed')$q$), 'true');

  perform pg_temp.t4255_like('T-3', 'admin cannot change themselves',
    pg_temp.t4255_as('admin', $q$select public.admin_team_set_member('issue4255-admin@test.local','growth','active')::text$q$), 'ERR:42501:cannot_change_self%');
  perform pg_temp.t4255_like('T-3', 'partner cannot remove themselves',
    pg_temp.t4255_as('partner', $q$select public.admin_team_set_member('issue4255-partner@test.local','partner','revoked')::text$q$), 'ERR:42501:cannot_change_self%');
  perform pg_temp.t4255_like('T-3', 'growth cannot manage the team',
    pg_temp.t4255_as('growth', $q$select public.admin_team_set_member('issue4255-growth2@test.local','admin','active')::text$q$), 'ERR:42501:forbidden%');
  perform pg_temp.t4255_like('T-3', 'owner can never be assigned',
    pg_temp.t4255_as('admin', $q$select public.admin_team_set_member('issue4255-growth2@test.local','owner','active')::text$q$), 'ERR:22023:invalid_role%');
  perform pg_temp.t4255_check('T-4', 'Team invite capability for admin',
    pg_temp.t4255_as('admin', $q$select ('team.invite' = any(public.issue_3988_capabilities()))::text$q$), 'true');
  perform pg_temp.t4255_check('T-4', 'Team invite capability for partner',
    pg_temp.t4255_as('partner', $q$select ('team.invite' = any(public.issue_3988_capabilities()))::text$q$), 'true');
end;
$t$;

-- ---------------------------------------------------------------------------
-- B — any active teammate writes blogs; publishing is unchanged.
-- ---------------------------------------------------------------------------
do $b$
begin
  perform pg_temp.t4255_check('B-1', 'growth may write a blog, not publish',
    pg_temp.t4255_as('growth', $q$select public.issue_4137_blog_my_permissions()::text$q$),
    '{"can_write": true, "can_publish": false}');
  perform pg_temp.t4255_check('B-1', 'partner may write and publish',
    pg_temp.t4255_as('partner', $q$select public.issue_4137_blog_my_permissions()::text$q$),
    '{"can_write": true, "can_publish": true}');
  perform pg_temp.t4255_check('B-1', 'outsider may do neither',
    pg_temp.t4255_as('consumer', $q$select public.issue_4137_blog_my_permissions()::text$q$),
    '{"can_write": false, "can_publish": false}');
  perform pg_temp.t4255_check('B-2', 'growth has the Blog tab area',
    pg_temp.t4255_as('growth', $q$select ('blog' = any(public.admin_team_my_operational_areas()))::text$q$), 'true');
  perform pg_temp.t4255_check('B-2', 'outsider has no Blog tab area',
    pg_temp.t4255_as('consumer', $q$select ('blog' = any(public.admin_team_my_operational_areas()))::text$q$), 'false');
  perform pg_temp.t4255_check('B-3', 'growth creates and saves a blog draft',
    pg_temp.t4255_as('growth', $q$select (public.issue_4137_blog_save_draft(
        (public.issue_4137_blog_create_post('Issue 4255 post', 'product-news')->>'id')::uuid, 1,
        jsonb_build_object('summary', 'Saved by a growth teammate'))->>'revision')$q$), '2');
  perform pg_temp.t4255_like('B-3', 'outsider cannot create a blog draft',
    pg_temp.t4255_as('consumer', $q$select public.issue_4137_blog_create_post('Nope', 'product-news')::text$q$), 'ERR:42501:blog_forbidden%');
end;
$b$;

-- ---------------------------------------------------------------------------
-- E — shared email drafts.
-- ---------------------------------------------------------------------------
do $e$
declare v_id text; v_rev text; v_out text;
begin
  v_out := pg_temp.t4255_as('growth',
    $q$select public.admin_email_draft_save(null, 'Launch note', '[{"id":"b1","type":"rich_text","html":"<p>Hi</p>"}]'::jsonb, '{"audienceMode":"segment","filters":{"userType":"host"}}'::jsonb, 'draft', null)::text$q$);
  v_id := v_out::jsonb->>'id';
  perform pg_temp.t4255_check('E-1', 'growth creates a draft as its author',
    v_out::jsonb->>'author_email', 'issue4255-growth@test.local');
  perform pg_temp.t4255_check('E-1', 'a new draft starts at revision 1', v_out::jsonb->>'revision', '1');
  insert into t4255_ids values ('draft', v_id);

  perform pg_temp.t4255_check('E-2', 'another growth teammate reads it',
    pg_temp.t4255_as('growth2', format($q$select subject || '/' || author_email from public.admin_email_drafts where id = %L$q$, v_id)),
    'Launch note/issue4255-growth@test.local');
  perform pg_temp.t4255_check('E-2', 'a partner reads it',
    pg_temp.t4255_as('partner', format($q$select subject from public.admin_email_drafts where id = %L$q$, v_id)), 'Launch note');
  perform pg_temp.t4255_check('E-2', 'an outsider sees no drafts',
    pg_temp.t4255_as('consumer', $q$select count(*)::text from public.admin_email_drafts$q$), '0');
  perform pg_temp.t4255_like('E-2', 'anon cannot read drafts',
    pg_temp.t4255_as('anon', $q$select count(*)::text from public.admin_email_drafts$q$), 'ERR:42501:%');

  perform pg_temp.t4255_like('E-3', 'growth2 cannot save someone else''s draft',
    pg_temp.t4255_as('growth2', format($q$select public.admin_email_draft_save(%L, 'Hijack', '[]'::jsonb, '{}'::jsonb, 'draft', 1)::text$q$, v_id)),
    'ERR:42501:forbidden%');
  perform pg_temp.t4255_check('E-3', 'growth2 cannot update it directly either',
    pg_temp.t4255_as('growth2', format($q$with u as (update public.admin_email_drafts set subject = 'Hijack' where id = %L returning 1) select count(*)::text from u$q$, v_id)), '0');
  perform pg_temp.t4255_like('E-3', 'growth2 cannot delete it',
    pg_temp.t4255_as('growth2', format($q$select public.admin_email_draft_delete(%L)::text$q$, v_id)), 'ERR:42501:forbidden%');

  v_out := pg_temp.t4255_as('admin', format($q$select public.admin_email_draft_save(%L, 'Launch note v2', '[]'::jsonb, '{}'::jsonb, 'ready_for_review', 1)::text$q$, v_id));
  perform pg_temp.t4255_check('E-4', 'an admin saves the draft',
    (v_out::jsonb->>'revision') || '/' || (v_out::jsonb->>'last_editor_email') || '/' || (v_out::jsonb->>'author_email') || '/' || (v_out::jsonb->>'status'),
    '2/issue4255-admin@test.local/issue4255-growth@test.local/ready_for_review');
  perform pg_temp.t4255_like('E-4', 'a stale save is PT409',
    pg_temp.t4255_as('growth', format($q$select public.admin_email_draft_save(%L, 'Old copy', '[]'::jsonb, '{}'::jsonb, 'draft', 1)::text$q$, v_id)),
    'ERR:PT409:draft_changed%');
  perform pg_temp.t4255_check('E-4', 'the author saves at the current revision',
    pg_temp.t4255_as('growth', format($q$select (public.admin_email_draft_save(%L, 'Launch note v3', '[]'::jsonb, '{}'::jsonb, 'draft', 2)->>'revision')$q$, v_id)), '3');
  perform pg_temp.t4255_check('E-4', 'author cannot be rewritten by a direct update',
    pg_temp.t4255_as('growth', format($q$update public.admin_email_drafts set author_email = 'x@test.local', author_id = '42550000-0000-4000-8000-000000000005' where id = %L returning author_email$q$, v_id)),
    'issue4255-growth@test.local');
  perform pg_temp.t4255_like('E-5', 'invalid status refused',
    pg_temp.t4255_as('growth', $q$select public.admin_email_draft_save(null, 's', '[]'::jsonb, '{}'::jsonb, 'sent', null)::text$q$), 'ERR:22023:invalid_status%');
  perform pg_temp.t4255_like('E-5', 'outsider cannot create a draft',
    pg_temp.t4255_as('consumer', $q$select public.admin_email_draft_save(null, 's', '[]'::jsonb, '{}'::jsonb, 'draft', null)::text$q$), 'ERR:42501:forbidden%');
  perform pg_temp.t4255_like('E-5', 'outsider cannot insert directly',
    pg_temp.t4255_as('consumer', $q$insert into public.admin_email_drafts (author_id, author_email) values ('42550000-0000-4000-8000-000000000006','c@test.local') returning 'x'$q$), 'ERR:42501:%');
  perform pg_temp.t4255_check('E-6', 'the author deletes the draft',
    pg_temp.t4255_as('growth', format($q$select (public.admin_email_draft_delete(%L)->>'deleted')$q$, v_id)), 'true');

  perform pg_temp.t4255_check('E-7', 'growth reads templates',
    pg_temp.t4255_as('growth', $q$select count(*)::text from public.email_templates where name = 'issue4255 template'$q$), '1');
  perform pg_temp.t4255_check('E-7', 'outsider reads no templates',
    pg_temp.t4255_as('consumer', $q$select count(*)::text from public.email_templates$q$), '0');
  perform pg_temp.t4255_check('E-7', 'growth cannot write templates',
    pg_temp.t4255_as('growth', $q$with u as (update public.email_templates set subject = 'x' where name = 'issue4255 template' returning 1) select count(*)::text from u$q$), '0');
end;
$e$;

-- ---------------------------------------------------------------------------
-- Verdict.
-- ---------------------------------------------------------------------------
do $verdict$
declare
  v_total int;
  v_failed int;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from t4255_results;
  if v_total < 70 then
    raise exception 'ISSUE-4255 FAIL: only % checks ran', v_total;
  end if;
  if v_failed > 0 then
    for r in select * from t4255_results where not ok order by seq loop
      raise warning 'ISSUE-4255 FAILED % | % | %', r.test, r.label, r.detail;
    end loop;
    raise exception 'ISSUE-4255 FAIL: % of % checks failed', v_failed, v_total;
  end if;
  raise notice 'ISSUE-4255 PASS: % checks, 0 failed', v_total;
end;
$verdict$;

rollback;
