-- #1615 — immutable, opaque public-card snapshots. Public clients never read
-- place_pool or saved_card directly; the shared-card Edge Function is the sole
-- served boundary and uses the service role after validation.
create table if not exists public.shared_card_snapshots (
  share_id text primary key default encode(gen_random_bytes(18), 'hex'),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  snapshot_version smallint not null default 1 check (snapshot_version = 1),
  kind text not null check (kind in ('place', 'curated')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  cover_url text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  stops jsonb not null default '[]'::jsonb check (jsonb_typeof(stops) = 'array'),
  source_ids jsonb not null default '{}'::jsonb check (jsonb_typeof(source_ids) = 'object'),
  attribution jsonb not null default '{}'::jsonb check (jsonb_typeof(attribution) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  revoked_at timestamptz,
  check (cover_url is null or cover_url ~ '^https://'),
  check (kind = 'curated' or jsonb_array_length(stops) = 0)
);

alter table public.shared_card_snapshots enable row level security;
alter table public.shared_card_snapshots force row level security;
revoke all on public.shared_card_snapshots from anon, authenticated;
grant all on public.shared_card_snapshots to service_role;

create index if not exists shared_card_snapshots_owner_created_idx
  on public.shared_card_snapshots (owner_profile_id, created_at desc);
create index if not exists shared_card_snapshots_expiry_idx
  on public.shared_card_snapshots (expires_at) where revoked_at is null;

create table if not exists public.shared_card_rate_limits (
  actor_hash text not null,
  action text not null check (action in ('create', 'read')),
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (actor_hash, action, window_start)
);
alter table public.shared_card_rate_limits enable row level security;
alter table public.shared_card_rate_limits force row level security;
revoke all on public.shared_card_rate_limits from anon, authenticated;
grant all on public.shared_card_rate_limits to service_role;

create or replace function public.consume_shared_card_rate_limit(
  p_actor_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_actor_hash !~ '^[a-f0-9]{64}$' or p_action not in ('create', 'read')
     or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.shared_card_rate_limits(actor_hash, action, window_start, request_count)
  values (p_actor_hash, p_action, v_window, 1)
  on conflict (actor_hash, action, window_start) do update
    set request_count = public.shared_card_rate_limits.request_count + 1
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke all on function public.consume_shared_card_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_shared_card_rate_limit(text,text,integer,integer) to service_role;

comment on table public.shared_card_snapshots is
  '#1615 versioned public share snapshots; service-role served boundary only, never broad place_pool exposure.';
