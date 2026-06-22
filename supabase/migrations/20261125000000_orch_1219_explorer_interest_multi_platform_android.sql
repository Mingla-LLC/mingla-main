-- ORCH-1219 [Explorer form: interest multi-select + Android platform + branded
--             download-link email] — backend half.
--
-- Three idempotent changes to public.explorer_app_leads (ORCH-1216):
--   1. interest: text (single) → text[] (multi). The table is EMPTY in prod, so
--      we `using array[interest]` for any stray row, then drop the scalar CHECK
--      and add an ARRAY CHECK: every element ∈ the 5-value enum AND ≥1 element.
--   2. platform: widen the CHECK from in('ios','other') to in('ios','android','other')
--      so desktop ('other') and Android are distinct (Fix C — platform-accurate
--      success copy + measurable Android demand).
--   3. admin_explorer_app_leads_list(): return interest as text[] (column type
--      changed under it, so the SECURITY DEFINER RPC must be re-created).
--
-- Guard-safe / re-runnable: each step is wrapped in a DO block that no-ops when
-- the target shape is already present (so a partial prior apply is harmless).
--
-- WARNING (RLS): do NOT add an anon SELECT policy here
-- (I-PROPOSED-1216-ANON-NO-SELECT). The marketing site is unauthenticated; lead
-- rows must never be readable by the public anon key. This migration touches
-- columns + the admin RPC only — it does not alter RLS.

-- 1. interest: text → text[] (+ swap the scalar CHECK for an array CHECK).
do $$
declare
  col_type text;
begin
  select data_type
    into col_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'explorer_app_leads'
     and column_name  = 'interest';

  if col_type is null then
    raise notice 'ORCH-1219: explorer_app_leads.interest not found — skipping (table missing?).';
    return;
  end if;

  -- Drop the ORCH-1216 scalar interest CHECK (named-or-anon: find it by
  -- definition) BEFORE the type change, else `ALTER COLUMN … TYPE text[]` aborts
  -- with "operator does not exist: text[] = text".
  --
  -- IMPORTANT: Postgres normalizes the scalar `interest IN ('places',…)` CHECK to
  -- `(interest = ANY (ARRAY['places',…]))` in pg_get_constraintdef — so an
  -- "exclude `= any`" filter wrongly EXCLUDES the very scalar constraint it must
  -- drop (the P1 deploy-blocker). Instead, identify the scalar CHECK as the one
  -- that references `interest` but does NOT use the array operators of the NEW
  -- array CHECK (`<@` containment / `cardinality` / `array_length`). Loop + drop
  -- ALL such scalar CHECKs (defensive; idempotent — a re-run finds none left).
  declare
    scalar_con text;
  begin
    for scalar_con in
      select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
       where nsp.nspname = 'public'
         and rel.relname = 'explorer_app_leads'
         and con.contype = 'c'
         and pg_get_constraintdef(con.oid) ilike '%interest%'
         -- exclude the NEW array CHECK (and any array-shaped CHECK): the scalar
         -- one uses none of these array operators/functions.
         and pg_get_constraintdef(con.oid) not ilike '%<@%'
         and pg_get_constraintdef(con.oid) not ilike '%cardinality%'
         and pg_get_constraintdef(con.oid) not ilike '%array_length%'
    loop
      execute format(
        'alter table public.explorer_app_leads drop constraint %I',
        scalar_con
      );
    end loop;
  end;

  -- Convert the column to text[] only if it is not already an array.
  if col_type <> 'ARRAY' then
    execute $convert$
      alter table public.explorer_app_leads
        alter column interest type text[]
        using case
          when interest is null then array[]::text[]
          else array[interest]
        end
    $convert$;
  end if;
end $$;

-- Array CHECK: every element ∈ enum AND at least one element. Added separately
-- (idempotent — drop-if-exists then add) so re-runs converge.
alter table public.explorer_app_leads
  drop constraint if exists explorer_app_leads_interest_arr_chk;
alter table public.explorer_app_leads
  add constraint explorer_app_leads_interest_arr_chk
  check (
    -- cardinality() returns 0 (not NULL) for an empty array '{}', so an empty
    -- interest array is REJECTED at the DB layer (array_length(.,1) returns NULL
    -- for '{}' → the CHECK would PASS an empty array — the P2 hole). Defense in
    -- depth: the edge fn already rejects empty interest.
    cardinality(interest) >= 1
    and interest <@ array['places','events','trips','experiences','all']::text[]
  );

-- 2. platform: widen the CHECK to add 'android'. Find + drop the ORCH-1216
--    scalar platform CHECK, then re-add the 3-value form.
do $$
declare
  plat_con text;
begin
  select con.conname
    into plat_con
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'explorer_app_leads'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%platform%'
   limit 1;
  if plat_con is not null then
    execute format(
      'alter table public.explorer_app_leads drop constraint %I',
      plat_con
    );
  end if;
end $$;

alter table public.explorer_app_leads
  drop constraint if exists explorer_app_leads_platform_chk;
alter table public.explorer_app_leads
  add constraint explorer_app_leads_platform_chk
  check (platform in ('ios','android','other'));

comment on column public.explorer_app_leads.platform is
  'ORCH-1219: client-detected device — ios | android | other (other = desktop / '
  'non-mobile). Drives the platform-accurate success copy + measures Android demand.';

comment on column public.explorer_app_leads.interest is
  'ORCH-1219: multi-select interest(s) — text[] of {places,events,trips,'
  'experiences,all}; ≥1 element (CHECK explorer_app_leads_interest_arr_chk).';

-- 3. admin_explorer_app_leads_list() — return interest as text[] now that the
--    column type changed under it. SECURITY DEFINER + authenticated-only EXECUTE
--    (unchanged posture from ORCH-1216).
drop function if exists public.admin_explorer_app_leads_list();
create function public.admin_explorer_app_leads_list()
  returns table(
    id           uuid,
    created_at   timestamptz,
    name         text,
    email        text,
    city         text,
    interest     text[],
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

revoke all on function public.admin_explorer_app_leads_list() from public;
revoke all on function public.admin_explorer_app_leads_list() from anon;
grant execute on function public.admin_explorer_app_leads_list() to authenticated;
