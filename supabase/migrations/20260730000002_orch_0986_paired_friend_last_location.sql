-- ORCH-0986 [Paired-profile redesign]
-- Friend-GPS-only recommendation center. Read-only SECURITY DEFINER RPC.
-- Supabase SECURITY DEFINER guidance: pin search_path to prevent object hijack.

create or replace function public.get_paired_friend_last_location(
  p_viewer_id uuid,
  p_friend_id uuid
)
returns table (
  latitude double precision,
  longitude double precision,
  captured_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_viewer_id is null or p_friend_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.pairings p
    where (p.user_a_id = p_viewer_id and p.user_b_id = p_friend_id)
       or (p.user_a_id = p_friend_id and p.user_b_id = p_viewer_id)
  ) then
    return;
  end if;

  return query
  select
    ulh.latitude,
    ulh.longitude,
    ulh.created_at as captured_at
  from public.user_location_history ulh
  where ulh.user_id = p_friend_id
  order by ulh.created_at desc
  limit 1;
end;
$$;

revoke all on function public.get_paired_friend_last_location(uuid, uuid) from public;
grant execute on function public.get_paired_friend_last_location(uuid, uuid) to authenticated;

comment on function public.get_paired_friend_last_location(uuid, uuid)
is 'ORCH-0986: returns latest physical GPS for an actively paired friend only; coordinates stay server-side in edge functions.';
