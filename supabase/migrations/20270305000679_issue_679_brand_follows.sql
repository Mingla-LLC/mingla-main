-- issue #679 v1 — brand_follows: consumer-owned follow rows. Owner-only RLS on
-- every verb; NO brand-side read, NO count exposure, NO update path (no mutable
-- columns). Hard delete on unfollow (mirrors saved_card; churn history lives in
-- PostHog, not the table). Ring-2 contract (#876): following must never hand a
-- brand your identity or contact data — enforced structurally by policy absence.
create table if not exists public.brand_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  source text not null default 'brand_page',
  created_at timestamptz not null default now(),
  constraint brand_follows_user_brand_key unique (user_id, brand_id)
);

create index if not exists idx_brand_follows_brand_id
  on public.brand_follows (brand_id);

alter table public.brand_follows enable row level security;

drop policy if exists bf_owner_insert on public.brand_follows;
create policy bf_owner_insert on public.brand_follows
  for insert with check (auth.uid() = user_id);

drop policy if exists bf_owner_select on public.brand_follows;
create policy bf_owner_select on public.brand_follows
  for select using (auth.uid() = user_id);

drop policy if exists bf_owner_delete on public.brand_follows;
create policy bf_owner_delete on public.brand_follows
  for delete using (auth.uid() = user_id);

revoke all on table public.brand_follows from anon;
grant select, insert, delete on table public.brand_follows to authenticated;
