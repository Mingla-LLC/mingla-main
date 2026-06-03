-- ORCH-1045 [Business "Get Beta Access" lead-capture]
--
-- New lead-capture table for the organiser marketing site's "Get Beta Access"
-- 3-step form. Anon visitors submit leads ONLY via the public
-- `beta-access-lead-submit` edge function, which writes with the SERVICE ROLE
-- (bypasses RLS). There is intentionally NO anon/authenticated table policy:
--   - anon SELECT/INSERT/UPDATE/DELETE → DENIED (no policy = deny under RLS;
--     https://supabase.com/docs/guides/database/postgres/row-level-security ).
--   - the service-role edge fn is the ONLY write path (defense in depth).
--   - admin reads go through the SECURITY DEFINER `admin_beta_leads_list()` RPC
--     (gated EXECUTE → authenticated only), mirroring the ORCH-1027
--     admin_launch_city_list() precedent — NOT a direct table SELECT.
--
-- WARNING for a future RLS edit: do NOT add an anon SELECT policy here
-- (I-1045-ANON-NO-SELECT, SC-7). The marketing site is unauthenticated; lead
-- rows must never be readable by the public anon key.

-- 1. Table.
create table if not exists public.beta_access_leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  brand_type    text not null
                  check (brand_type in (
                    'restaurant','cafe_bar','club_nightlife','event_organiser',
                    'experience_tour','venue_space','other')),
  brand_name    text not null check (char_length(brand_name) between 1 and 120),
  contact_name  text not null check (char_length(contact_name) between 1 and 80),
  city          text not null check (char_length(city) between 1 and 80),
  email         text not null check (char_length(email) between 3 and 254),
  phone         text,                              -- nullable, forward-compat (NG-5)
  consent       boolean not null default false,
  source        text not null default 'organiser_marketing'
                  check (source in ('organiser_marketing','organiser_marketing_nav',
                                    'organiser_marketing_hero')),
  user_agent    text,                              -- truncated <=512 at write
  referer       text,                              -- truncated <=512 at write
  ip_hash       text                               -- salted hash, never raw IP (§3.3.5)
);

comment on table public.beta_access_leads is
  'ORCH-1045: organiser marketing "Get Beta Access" leads. Written only by the '
  'service-role beta-access-lead-submit edge fn. anon SELECT is DENIED by RLS '
  '(no policy = deny). Admin reads via admin_beta_leads_list() RPC.';

-- Case-insensitive idempotency on email (one lead per email).
-- Structural guarantee of I-1045-LEAD-EMAIL-UNIQUE — a resubmit cannot create a
-- duplicate even if the edge-fn check is bypassed.
create unique index if not exists beta_access_leads_email_lower_uidx
  on public.beta_access_leads (lower(email));

-- Admin list ordering + throttle lookups.
create index if not exists beta_access_leads_created_at_idx
  on public.beta_access_leads (created_at desc);
create index if not exists beta_access_leads_ip_hash_recent_idx
  on public.beta_access_leads (ip_hash, created_at desc);

-- 2. RLS — enabled with NO permissive policies for anon/authenticated.
--    Deny-by-default for the public API. The edge fn writes via service role
--    (bypasses RLS). Admin reads via the SECURITY DEFINER RPC below.
alter table public.beta_access_leads enable row level security;

-- 3. Admin list RPC — mirrors admin_launch_city_list() (ORCH-1027). SECURITY
--    DEFINER bypasses RLS for the read; EXECUTE is gated to authenticated only
--    (anon revoked), and the admin app gates the authenticated session itself
--    (ALLOWED_ADMIN_EMAILS at login). Returns the human-facing columns the
--    Beta Leads tab renders, newest-first.
create or replace function public.admin_beta_leads_list()
  returns table(
    id           uuid,
    created_at   timestamptz,
    brand_type   text,
    brand_name   text,
    contact_name text,
    city         text,
    email        text,
    source       text,
    user_agent   text,
    referer      text
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  select
    bal.id,
    bal.created_at,
    bal.brand_type,
    bal.brand_name,
    bal.contact_name,
    bal.city,
    bal.email,
    bal.source,
    bal.user_agent,
    bal.referer
  from public.beta_access_leads bal
  order by bal.created_at desc;
$$;

-- Admin-only execution. SECURITY DEFINER bypasses RLS for the read, so we gate EXECUTE.
revoke all on function public.admin_beta_leads_list() from public;
revoke all on function public.admin_beta_leads_list() from anon;
grant execute on function public.admin_beta_leads_list() to authenticated;
