-- #3720 Slice E — Phase 1 community schema happy path (PostgreSQL 17).
-- Transaction-contained; rolls back. Never run on production.
\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temporary table t3720e_results (
  name text primary key,
  ok boolean not null,
  detail text
);

create or replace function pg_temp.ok(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into t3720e_results(name, ok, detail) values (p_name, p_ok, p_detail)
  on conflict (name) do update set ok = excluded.ok, detail = excluded.detail;
end;
$$;

insert into auth.users (id, email, email_confirmed_at)
values
  ('a3720000-0000-4000-8000-000000000001', 'admin3720e@example.com', now()),
  ('b3720000-0000-4000-8000-000000000002', 'host3720e@example.com', now()),
  ('c3720000-0000-4000-8000-000000000003', 'mod3720e@example.com', now())
on conflict (id) do update set email = excluded.email, email_confirmed_at = now();

insert into public.profiles (id, username)
values
  ('a3720000-0000-4000-8000-000000000001', 'admin3720e'),
  ('b3720000-0000-4000-8000-000000000002', 'host3720e'),
  ('c3720000-0000-4000-8000-000000000003', 'mod3720e')
on conflict (id) do nothing;

insert into public.admin_users (email, role, status)
values ('admin3720e@example.com', 'admin', 'active')
on conflict (email) do update set role = 'admin', status = 'active';

insert into public.creator_accounts (id, created_at)
values ('a3720000-0000-4000-8000-000000000001', now())
on conflict (id) do nothing;

insert into public.brands (id, account_id, name, slug, created_at, updated_at)
values (
  'd3720000-0000-4000-8000-000000000010',
  'a3720000-0000-4000-8000-000000000001',
  'Issue 3720 Slice E',
  'issue3720slicee',
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.brand_team_members
  (brand_id, user_id, role, accepted_at, invited_at)
values (
  'd3720000-0000-4000-8000-000000000010',
  'b3720000-0000-4000-8000-000000000002',
  'brand_owner',
  now(),
  now()
)
on conflict do nothing;

select pg_temp.ok(
  'category_seeded',
  exists (
    select 1 from public.notification_categories
    where key = 'community_announcement' and is_transactional = true
      and 'email' = any(default_channels)
  )
);

insert into public.support_staff (user_id, enabled, available, role)
values ('c3720000-0000-4000-8000-000000000003', true, false, 'staff')
on conflict (user_id) do update set enabled = true, available = false;

select pg_temp.ok('online_false', public.support_is_online() = false);

update public.support_staff
   set available = true
 where user_id = 'c3720000-0000-4000-8000-000000000003';

select pg_temp.ok('online_true', public.support_is_online() = true);

select set_config('request.jwt.claim.sub', 'a3720000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_id uuid;
  v_n int;
begin
  if not public.is_admin_user() then
    perform pg_temp.ok('admin_jwt', false, 'is_admin_user false for fixture admin');
    return;
  end if;
  perform pg_temp.ok('admin_jwt', true);

  v_id := public.community_upsert_announcement(null, 'Hello hosts', 'Body for hosts');
  perform pg_temp.ok('upsert_id', v_id is not null);

  v_n := public.community_publish_announcement(v_id);
  perform pg_temp.ok('publish_enqueued', v_n >= 1, 'enqueued=' || v_n::text);
  perform pg_temp.ok(
    'outbox_row',
    exists (
      select 1 from public.notification_outbox o
      where o.idempotency_key =
        'community_announcement:' || v_id::text || ':b3720000-0000-4000-8000-000000000002'
        and o.category_key = 'community_announcement'
    )
  );

  v_n := public.community_publish_announcement(v_id);
  perform pg_temp.ok('publish_idempotent', v_n = 0);

  perform public.community_upsert_roadmap_card(
    null, 'Public title', 'Public body', 'SECRET note', 'now', 'published'
  );
  perform pg_temp.ok('roadmap_upsert', true);
end;
$$;

reset role;

select set_config('request.jwt.claim.sub', 'b3720000-0000-4000-8000-000000000002', true);
set local role authenticated;

do $$
declare
  v_ok boolean := false;
begin
  begin
    perform public.community_upsert_announcement(null, 'Nope', 'Nope');
  exception when others then
    v_ok := sqlstate = '42501' or sqlerrm ilike '%not_authorized%';
  end;
  perform pg_temp.ok('host_cannot_upsert', v_ok);

  perform pg_temp.ok(
    'host_sees_published',
    exists (
      select 1 from public.community_announcements a
      where a.status = 'published' and a.title = 'Hello hosts'
    )
  );

  perform pg_temp.ok(
    'roadmap_public_visible',
    exists (
      select 1 from public.community_roadmap_public r
      where r.public_title = 'Public title'
    )
  );

  perform public.community_set_email_pref(false);
  perform pg_temp.ok(
    'email_pref_off',
    exists (
      select 1 from public.notification_channel_prefs p
      where p.user_id = 'b3720000-0000-4000-8000-000000000002'
        and p.category_key = 'community_announcement'
        and p.channel = 'email'
        and p.enabled = false
    )
  );
end;
$$;

reset role;

select set_config('request.jwt.claim.sub', 'a3720000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  v_ok boolean := false;
begin
  begin
    perform public.community_set_staff(
      'c3720000-0000-4000-8000-000000000003', 'admin', true, 'Nope'
    );
  exception when others then
    v_ok := sqlstate = '22023' or sqlerrm ilike '%invalid_role%';
  end;
  perform pg_temp.ok('staff_rejects_admin_role', v_ok);

  perform public.community_set_staff(
    'c3720000-0000-4000-8000-000000000003', 'moderator', true, 'Mod'
  );
  perform pg_temp.ok(
    'staff_moderator_set',
    public.community_role('c3720000-0000-4000-8000-000000000003') = 'moderator'
  );
  perform pg_temp.ok(
    'admin_role_from_admin_users',
    public.community_role('a3720000-0000-4000-8000-000000000001') = 'admin'
  );
  perform pg_temp.ok(
    'only_admin_can_publish_area',
    public.community_can('publish_announcement', 'a3720000-0000-4000-8000-000000000001')
    and not public.community_can('publish_announcement', 'c3720000-0000-4000-8000-000000000003')
  );
end;
$$;

reset role;

do $verdict$
declare
  v_fail text;
  v_n int;
begin
  select count(*) into v_n from t3720e_results;
  if v_n < 12 then
    raise exception 'too few checks: %', v_n;
  end if;
  select string_agg(name || ': ' || coalesce(detail, 'fail'), E'\n' order by name)
    into v_fail
    from t3720e_results where not ok;
  if v_fail is not null then
    raise exception E'#3720 Slice E happy failures:\n%', v_fail;
  end if;
  raise notice '#3720 Slice E happy: % checks PASS', v_n;
end;
$verdict$;

rollback;
