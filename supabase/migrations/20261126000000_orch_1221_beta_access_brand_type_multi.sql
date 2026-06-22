-- ORCH-1221 [Organiser beta form: brand-type multi-select] — backend half.
--
-- Two idempotent changes to public.beta_access_leads (ORCH-1045):
--   1. brand_type: text (single, NOT NULL CHECK in('restaurant',…)) → text[]
--      (multi). The table has 1 REAL lead in prod — preserve it via
--      `using array[brand_type]` for the scalar→array conversion. Then drop the
--      scalar CHECK and add an ARRAY CHECK: every element ∈ the 7-value enum AND
--      ≥1 element (cardinality >= 1).
--   2. admin_beta_leads_list(): return brand_type as text[] (column type changed
--      under it, so the SECURITY DEFINER RPC must be re-created).
--
-- Guard-safe / re-runnable: each step is wrapped in a DO block / drop-if-exists
-- that no-ops when the target shape is already present (so a partial prior apply
-- is harmless).
--
-- WARNING (RLS): do NOT add an anon SELECT policy here (I-1045-ANON-NO-SELECT).
-- The marketing site is unauthenticated; lead rows must never be readable by the
-- public anon key. This migration touches the column + the admin RPC only — it
-- does not alter RLS.

-- 1. brand_type: text → text[] (+ swap the scalar CHECK for an array CHECK).
do $$
declare
  col_type text;
begin
  select data_type
    into col_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'beta_access_leads'
     and column_name  = 'brand_type';

  if col_type is null then
    raise notice 'ORCH-1221: beta_access_leads.brand_type not found — skipping (table missing?).';
    return;
  end if;

  -- Drop the ORCH-1045 scalar brand_type CHECK (named-or-anon: find it by
  -- definition) BEFORE the type change, else `ALTER COLUMN … TYPE text[]` aborts
  -- with "operator does not exist: text[] = text".
  --
  -- IMPORTANT: Postgres normalizes the scalar `brand_type IN ('restaurant',…)`
  -- CHECK to `(brand_type = ANY (ARRAY['restaurant',…]))` in
  -- pg_get_constraintdef — so an "exclude `= any`" filter wrongly EXCLUDES the
  -- very scalar constraint it must drop. Instead, identify the scalar CHECK as
  -- the one that references `brand_type` but does NOT use the array
  -- operators/functions of the NEW array CHECK (`<@` containment / `cardinality`
  -- / `array_length`). Loop + drop ALL such scalar CHECKs (defensive;
  -- idempotent — a re-run finds none left).
  declare
    scalar_con text;
  begin
    for scalar_con in
      select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
       where nsp.nspname = 'public'
         and rel.relname = 'beta_access_leads'
         and con.contype = 'c'
         and pg_get_constraintdef(con.oid) ilike '%brand_type%'
         -- exclude the NEW array CHECK (and any array-shaped CHECK): the scalar
         -- one uses none of these array operators/functions.
         and pg_get_constraintdef(con.oid) not ilike '%<@%'
         and pg_get_constraintdef(con.oid) not ilike '%cardinality%'
         and pg_get_constraintdef(con.oid) not ilike '%array_length%'
    loop
      execute format(
        'alter table public.beta_access_leads drop constraint %I',
        scalar_con
      );
    end loop;
  end;

  -- Convert the column to text[] only if it is not already an array. The 1 real
  -- prod lead's scalar value becomes a 1-element array via `array[brand_type]`.
  -- brand_type is NOT NULL (ORCH-1045), but guard NULL defensively anyway.
  if col_type <> 'ARRAY' then
    execute $convert$
      alter table public.beta_access_leads
        alter column brand_type type text[]
        using case
          when brand_type is null then array[]::text[]
          else array[brand_type]
        end
    $convert$;
  end if;
end $$;

-- Array CHECK: every element ∈ the 7-value enum AND at least one element. Added
-- separately (idempotent — drop-if-exists then add) so re-runs converge.
alter table public.beta_access_leads
  drop constraint if exists beta_access_leads_brand_type_arr_chk;
alter table public.beta_access_leads
  add constraint beta_access_leads_brand_type_arr_chk
  check (
    -- cardinality() returns 0 (not NULL) for an empty array '{}', so an empty
    -- brand_type array is REJECTED at the DB layer (array_length(.,1) returns
    -- NULL for '{}' → the CHECK would PASS an empty array — the hole). Defense
    -- in depth: the edge fn already rejects an empty/absent brand_type array.
    cardinality(brand_type) >= 1
    and brand_type <@ array[
      'restaurant','cafe_bar','club_nightlife','event_organiser',
      'experience_tour','venue_space','other'
    ]::text[]
  );

comment on column public.beta_access_leads.brand_type is
  'ORCH-1221: multi-select business type(s) — text[] of {restaurant,cafe_bar,'
  'club_nightlife,event_organiser,experience_tour,venue_space,other}; ≥1 element '
  '(CHECK beta_access_leads_brand_type_arr_chk).';

-- 2. admin_beta_leads_list() — return brand_type as text[] now that the column
--    type changed under it. SECURITY DEFINER + authenticated-only EXECUTE
--    (unchanged posture from ORCH-1045).
drop function if exists public.admin_beta_leads_list();
create function public.admin_beta_leads_list()
  returns table(
    id           uuid,
    created_at   timestamptz,
    brand_type   text[],
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

revoke all on function public.admin_beta_leads_list() from public;
revoke all on function public.admin_beta_leads_list() from anon;
grant execute on function public.admin_beta_leads_list() to authenticated;
