-- ORCH-1216 [Explorer "Get the app" → lead-capture form gated to TestFlight]
--
-- New lead-capture table for the EXPLORER (consumer) marketing site's "Get the
-- app" form. Near-exact mirror of ORCH-1045's beta_access_leads, re-pointed to
-- the consumer surface, PLUS a `platform` column so Android demand is measurable
-- even though TestFlight install is iOS-only (Seth decision 3).
--
-- Anon visitors submit leads ONLY via the public `explorer-app-lead-submit` edge
-- function, which writes with the SERVICE ROLE (bypasses RLS). There is
-- intentionally NO anon/authenticated table policy:
--   - anon SELECT/INSERT/UPDATE/DELETE → DENIED (no policy = deny under RLS;
--     https://supabase.com/docs/guides/database/postgres/row-level-security ).
--   - the service-role edge fn is the ONLY write path (defense in depth;
--     service_role bypasses RLS: https://supabase.com/docs/guides/api/api-keys ).
--   - admin reads go through the SECURITY DEFINER `admin_explorer_app_leads_list()`
--     RPC (gated EXECUTE → authenticated only), mirroring `admin_beta_leads_list()`
--     (ORCH-1045) — NOT a direct table SELECT. (No admin tab in THIS ORCH — NG-6.)
--
-- WARNING for a future RLS edit: do NOT add an anon SELECT policy here
-- (I-PROPOSED-1216-ANON-NO-SELECT, SC-7). The marketing site is unauthenticated;
-- lead rows must never be readable by the public anon key.

-- 1. Table.
create table if not exists public.explorer_app_leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null check (char_length(name) between 1 and 80),
  email         text not null check (char_length(email) between 3 and 254),
  city          text not null check (char_length(city) between 1 and 80),
  interest      text not null
                  check (interest in ('places','events','trips','experiences','all')),
  platform      text not null default 'other'
                  check (platform in ('ios','other')),
  consent       boolean not null default false,
  source        text not null default 'explorer_marketing'
                  check (source in ('explorer_marketing','explorer_marketing_nav')),
  user_agent    text,                              -- truncated <=512 at write
  referer       text,                              -- truncated <=512 at write
  ip_hash       text                               -- salted hash, never raw IP
);

comment on table public.explorer_app_leads is
  'ORCH-1216: explorer marketing "Get the app" leads. Written only by the '
  'service-role explorer-app-lead-submit edge fn. anon SELECT is DENIED by RLS '
  '(no policy = deny). Admin reads via admin_explorer_app_leads_list() RPC. '
  'platform records the client-detected device (ios|other) so Android demand is '
  'measurable. Do NOT add an anon SELECT policy (I-PROPOSED-1216-ANON-NO-SELECT).';

-- Case-insensitive idempotency on email (one lead per email) — structural
-- guarantee of email-once even if the edge-fn check is bypassed.
create unique index if not exists explorer_app_leads_email_lower_uidx
  on public.explorer_app_leads (lower(email));

-- Admin list ordering + throttle lookups.
create index if not exists explorer_app_leads_created_at_idx
  on public.explorer_app_leads (created_at desc);
create index if not exists explorer_app_leads_ip_hash_recent_idx
  on public.explorer_app_leads (ip_hash, created_at desc);

-- 2. RLS — enabled with NO permissive policies for anon/authenticated.
--    Deny-by-default for the public API. The edge fn writes via service role
--    (bypasses RLS). Admin reads via the SECURITY DEFINER RPC below.
alter table public.explorer_app_leads enable row level security;

-- 3. Admin list RPC — mirrors admin_beta_leads_list() (ORCH-1045). SECURITY
--    DEFINER bypasses RLS for the read; EXECUTE is gated to authenticated only
--    (anon revoked). Seeds the read path for a FUTURE admin tab (out of scope
--    this ORCH — NG-6). Returns the human-facing columns newest-first.
create or replace function public.admin_explorer_app_leads_list()
  returns table(
    id           uuid,
    created_at   timestamptz,
    name         text,
    email        text,
    city         text,
    interest     text,
    platform     text,
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
    bal.name,
    bal.email,
    bal.city,
    bal.interest,
    bal.platform,
    bal.source,
    bal.user_agent,
    bal.referer
  from public.explorer_app_leads bal
  order by bal.created_at desc;
$$;

-- Admin-only execution. SECURITY DEFINER bypasses RLS for the read, so we gate EXECUTE.
revoke all on function public.admin_explorer_app_leads_list() from public;
revoke all on function public.admin_explorer_app_leads_list() from anon;
grant execute on function public.admin_explorer_app_leads_list() to authenticated;
