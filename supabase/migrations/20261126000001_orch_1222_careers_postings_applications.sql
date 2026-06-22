-- META-ORCH-1222 [Careers site at career.usemingla.com] — Migration A.
-- Schema + RLS + private storage bucket + admin RPCs for the careers system.
--
-- SECURITY SPINE (SPEC §4.A.3 + ADDENDUM D-1):
--   * job_postings  — anon may SELECT ONLY status='open'. NO public write policy.
--     Admin writes go through is_admin_user()-gated SECURITY DEFINER RPCs
--     (admin_careers_upsert_posting / admin_careers_set_posting_status), NEVER a
--     broad authenticated RLS write policy (ADDENDUM D-1 regression guard).
--   * job_applications — deny-by-default (NO permissive policy at all). anon
--     cannot SELECT (PII) and cannot INSERT (inserts go ONLY through the
--     careers-apply edge fn via the service role, which bypasses RLS). Admin
--     reads via the is_admin_user()-gated admin_job_applications_list RPC.
--   * career-cvs bucket — PRIVATE (public=false), 5 MB cap, PDF/DOC/DOCX only,
--     NO anon/authenticated storage.objects policy (writes + reads = service
--     role only, mirroring ticket-pdfs ORCH-0842).
--
-- Admin gate verified against live admin RPCs: public.is_admin_user() is the
-- canonical gate (defined in 20260505000000_baseline_squash_orch_0729.sql:5420 —
-- checks the calling user's email against active rows in admin_users). NOT
-- is_admin_email() (no such function exists). All careers admin RPCs use it.
--
-- Idempotent: create table if not exists, on conflict do nothing.

-- ─── 1. job_postings ─────────────────────────────────────────────────────────
create table if not exists public.job_postings (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 1 and 80),
  title           text not null check (char_length(title) between 1 and 120),
  department      text not null check (char_length(department) between 1 and 80),
  location        text not null check (char_length(location) between 1 and 120),
  employment_type text not null default 'full_time'
                    check (employment_type in ('full_time','part_time','contract','internship')),
  salary_min      integer check (salary_min is null or salary_min >= 0),
  salary_max      integer check (salary_max is null or salary_max >= 0),
  salary_currency text not null default 'NGN' check (char_length(salary_currency) between 3 and 3),
  salary_period   text not null default 'month' check (salary_period in ('hour','day','week','month','year')),
  salary_display  text not null check (char_length(salary_display) between 1 and 120),
  summary         text not null check (char_length(summary) between 1 and 400),
  body            text not null,                       -- markdown JD body
  status          text not null default 'draft' check (status in ('draft','open','closed')),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists job_postings_status_sort_idx
  on public.job_postings (status, sort_order asc, created_at desc);

-- ─── 2. job_applications ─────────────────────────────────────────────────────
create table if not exists public.job_applications (
  id               uuid primary key default gen_random_uuid(),
  job_posting_id   uuid not null references public.job_postings (id) on delete restrict,
  full_name        text not null check (char_length(full_name) between 1 and 80),
  email            text not null check (char_length(email) between 3 and 254),
  whatsapp_phone   text not null check (char_length(whatsapp_phone) between 7 and 24),
  preferred_salary text not null check (char_length(preferred_salary) between 1 and 60),
  cv_path          text not null,                       -- storage object path in career-cvs (private)
  portfolio_url    text not null check (char_length(portfolio_url) between 4 and 2048),
  status           text not null default 'new'
                     check (status in ('new','reviewing','shortlisted','rejected','hired')),
  user_agent       text,                                -- truncated <=512 at write
  referer          text,                                -- truncated <=512 at write
  ip_hash          text,                                -- salted SHA-256; never raw IP
  created_at       timestamptz not null default now()
);

create index if not exists job_applications_posting_created_idx
  on public.job_applications (job_posting_id, created_at desc);
create index if not exists job_applications_status_idx
  on public.job_applications (status, created_at desc);
create index if not exists job_applications_ip_hash_recent_idx
  on public.job_applications (ip_hash, created_at desc);   -- soft-throttle window

comment on table public.job_applications is
  'Careers applications (META-ORCH-1222). Deny-by-default RLS (no anon/authenticated policy). '
  'Inserts only via the careers-apply edge fn (service role). Reads only via the '
  'is_admin_user()-gated admin_job_applications_list() RPC. CV in private career-cvs bucket.';

-- ─── 3. RLS — the security spine ─────────────────────────────────────────────
alter table public.job_postings     enable row level security;
alter table public.job_applications enable row level security;

-- job_postings: anon (and authenticated) may SELECT ONLY status='open'. No write
-- policy (admin writes go through is_admin_user()-gated SECURITY DEFINER RPCs).
drop policy if exists "job_postings_public_read_open" on public.job_postings;
create policy "job_postings_public_read_open"
  on public.job_postings for select
  to anon, authenticated
  using (status = 'open');

-- job_applications: NO permissive policy at all → deny-by-default for anon AND
-- authenticated. (anon cannot SELECT/INSERT; admin reads via the SD RPC below.)

-- ─── 4. Admin-read RPC (mirrors admin_explorer_app_leads_list) ───────────────
-- DROP first so a RETURNS-TABLE shape change re-creates cleanly.
drop function if exists public.admin_job_applications_list(text, uuid);
create function public.admin_job_applications_list(
  p_status text default null,
  p_job_posting_id uuid default null
)
  returns table(
    id               uuid,
    job_posting_id   uuid,
    full_name        text,
    email            text,
    whatsapp_phone   text,
    preferred_salary text,
    cv_path          text,
    portfolio_url    text,
    status           text,
    user_agent       text,
    referer          text,
    created_at       timestamptz,
    job_slug         text,
    job_title        text
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  select
    ja.id,
    ja.job_posting_id,
    ja.full_name,
    ja.email,
    ja.whatsapp_phone,
    ja.preferred_salary,
    ja.cv_path,
    ja.portfolio_url,
    ja.status,
    ja.user_agent,
    ja.referer,
    ja.created_at,
    jp.slug  as job_slug,
    jp.title as job_title
  from public.job_applications ja
  join public.job_postings jp on jp.id = ja.job_posting_id
  where public.is_admin_user()          -- SAME admin gate the live admin RPCs use
    and (p_status is null or ja.status = p_status)
    and (p_job_posting_id is null or ja.job_posting_id = p_job_posting_id)
  order by ja.created_at desc;
$$;
revoke all on function public.admin_job_applications_list(text, uuid) from public, anon;
grant execute on function public.admin_job_applications_list(text, uuid) to authenticated;

-- ─── 5. Admin status-update RPC ──────────────────────────────────────────────
drop function if exists public.admin_set_job_application_status(uuid, text);
create function public.admin_set_job_application_status(
  p_application_id uuid,
  p_status text
)
  returns public.job_applications
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_row public.job_applications;
begin
  if not public.is_admin_user() then
    raise exception 'forbidden';
  end if;
  if p_status not in ('new','reviewing','shortlisted','rejected','hired') then
    raise exception 'invalid_status';
  end if;
  update public.job_applications
    set status = p_status
    where id = p_application_id
    returning * into strict v_row;
  return v_row;
end;
$$;
revoke all on function public.admin_set_job_application_status(uuid, text) from public, anon;
grant execute on function public.admin_set_job_application_status(uuid, text) to authenticated;

-- ─── 6. Admin posting-list RPC (ALL statuses, for the admin Roles tab) ───────
-- The PUBLIC path still reads only status='open' via the RLS select policy
-- above; admin needs every status (draft/open/closed) for the management list.
-- ADDENDUM D-1: returns full row so the admin edit form pre-fills every field.
drop function if exists public.admin_careers_list_postings();
create function public.admin_careers_list_postings()
  returns setof public.job_postings
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  select jp.*
  from public.job_postings jp
  where public.is_admin_user()
  order by jp.sort_order asc, jp.created_at desc;
$$;
revoke all on function public.admin_careers_list_postings() from public, anon;
grant execute on function public.admin_careers_list_postings() to authenticated;

-- ─── 7. Admin posting upsert RPC (ADDENDUM D-1 — full CRUD in v1) ────────────
-- Insert OR update a posting by id (null id = insert). is_admin_user()-gated.
-- Enforces slug uniqueness with a clean 'slug_taken' error. On insert, status
-- defaults to 'draft' unless provided. NO broad RLS write policy is opened —
-- this gated RPC is the ONLY admin write path (D-1 regression guard).
drop function if exists public.admin_careers_upsert_posting(
  uuid, text, text, text, text, text, integer, integer, text, text, text, text, text, text, integer
);
create function public.admin_careers_upsert_posting(
  p_id              uuid    default null,
  p_slug            text    default null,
  p_title           text    default null,
  p_department      text    default null,
  p_location        text    default null,
  p_employment_type text    default 'full_time',
  p_salary_min      integer default null,
  p_salary_max      integer default null,
  p_salary_currency text    default 'NGN',
  p_salary_period   text    default 'month',
  p_salary_display  text    default null,
  p_summary         text    default null,
  p_body            text    default null,
  p_status          text    default 'draft',
  p_sort_order      integer default 0
)
  returns public.job_postings
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_row public.job_postings;
begin
  if not public.is_admin_user() then
    raise exception 'forbidden';
  end if;
  if p_status is not null and p_status not in ('draft','open','closed') then
    raise exception 'invalid_status';
  end if;
  if p_employment_type is not null
     and p_employment_type not in ('full_time','part_time','contract','internship') then
    raise exception 'invalid_employment_type';
  end if;

  -- Pre-check slug uniqueness against OTHER rows for a clean error (the unique
  -- constraint is the real fence; this surfaces a friendly message).
  if exists (
    select 1 from public.job_postings
    where slug = p_slug and (p_id is null or id <> p_id)
  ) then
    raise exception 'slug_taken';
  end if;

  if p_id is null then
    insert into public.job_postings (
      slug, title, department, location, employment_type,
      salary_min, salary_max, salary_currency, salary_period, salary_display,
      summary, body, status, sort_order
    ) values (
      p_slug, p_title, p_department, p_location, coalesce(p_employment_type, 'full_time'),
      p_salary_min, p_salary_max, coalesce(p_salary_currency, 'NGN'),
      coalesce(p_salary_period, 'month'), p_salary_display,
      p_summary, p_body, coalesce(p_status, 'draft'), coalesce(p_sort_order, 0)
    )
    returning * into v_row;
  else
    update public.job_postings set
      slug            = coalesce(p_slug, slug),
      title           = coalesce(p_title, title),
      department      = coalesce(p_department, department),
      location        = coalesce(p_location, location),
      employment_type = coalesce(p_employment_type, employment_type),
      salary_min      = p_salary_min,
      salary_max      = p_salary_max,
      salary_currency = coalesce(p_salary_currency, salary_currency),
      salary_period   = coalesce(p_salary_period, salary_period),
      salary_display  = coalesce(p_salary_display, salary_display),
      summary         = coalesce(p_summary, summary),
      body            = coalesce(p_body, body),
      status          = coalesce(p_status, status),
      sort_order      = coalesce(p_sort_order, sort_order),
      updated_at      = now()
    where id = p_id
    returning * into strict v_row;
  end if;

  return v_row;
end;
$$;
revoke all on function public.admin_careers_upsert_posting(
  uuid, text, text, text, text, text, integer, integer, text, text, text, text, text, text, integer
) from public, anon;
grant execute on function public.admin_careers_upsert_posting(
  uuid, text, text, text, text, text, integer, integer, text, text, text, text, text, text, integer
) to authenticated;

-- ─── 8. Admin posting status-toggle RPC (ADDENDUM D-1 — open/close/draft) ────
drop function if exists public.admin_careers_set_posting_status(uuid, text);
create function public.admin_careers_set_posting_status(
  p_id uuid,
  p_status text
)
  returns public.job_postings
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_row public.job_postings;
begin
  if not public.is_admin_user() then
    raise exception 'forbidden';
  end if;
  if p_status not in ('draft','open','closed') then
    raise exception 'invalid_status';
  end if;
  update public.job_postings
    set status = p_status, updated_at = now()
    where id = p_id
    returning * into strict v_row;
  return v_row;
end;
$$;
revoke all on function public.admin_careers_set_posting_status(uuid, text) from public, anon;
grant execute on function public.admin_careers_set_posting_status(uuid, text) to authenticated;

-- ─── 9. Private career-cvs storage bucket (mirrors ticket-pdfs ORCH-0842) ────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'career-cvs', 'career-cvs', false,
  5242880,                                                 -- 5 MB
  array['application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']  -- PDF, DOC, DOCX
)
on conflict (id) do nothing;
-- NO storage.objects client-role policies for career-cvs: writes via service
-- role (careers-apply edge fn); reads via service-role-issued signed download
-- URLs (careers-cv-signed-url admin edge fn). Service role bypasses RLS →
-- anon/authenticated have zero access (private bucket sealed).
