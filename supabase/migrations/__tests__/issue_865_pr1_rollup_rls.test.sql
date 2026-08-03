-- ISSUE-865 PR1 WP-3/WP-4 — SQL contract suite for the rollup layer + brand RLS
-- (migration 20270115000865_issue_865_rollup_rls_reservation_attribution.sql).
--
-- Covers:
--   T-1 (schema)   — the two new columns exist (ad_attribution_touches.brand_id,
--                    reservation_checkout_sessions.attribution_click_id).
--   T-2 (RPCs)     — both rollup functions exist and are SECURITY DEFINER (they
--                    bypass RLS, so they MUST self-authorize — the security anchor:
--                    drop prosecdef and this fails; drop the internal auth check and
--                    T-4 fails).
--   T-3 (RLS)      — the brand-scoped SELECT policies exist on ad_conversions +
--                    ad_attribution_touches (the deferred WP-E policy), ALONGSIDE
--                    the retained admin-read policies.
--   T-4 (authz +   — called with no admin/no membership (postgres, auth.uid() NULL),
--        shape)      brand_conversion_rollup returns authorized:false and NEVER
--                    another brand's data, with the full stable key set (shape).
--   T-5 (authz +   — ad_campaign_conversion_rollup(NULL) is admin-only → authorized
--        shape)      false for a non-admin, with its stable key set incl. the honest
--                    spend_cents:null (no in-DB spend source — no fabricated ROAS).
--
-- Run (LOCAL Postgres only — NEVER remote), after applying ALL migrations in
-- ls|sort order (mirrors .github/workflows/supabase-migrations-and-stripe-deno.yml).
-- Whole script runs in ONE transaction and ROLLS BACK — no residue.

\set ON_ERROR_STOP on
begin;

-- ── T-1 · new columns exist ───────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ad_attribution_touches' and column_name = 'brand_id'
  ) then
    raise exception 'T-1 FAIL: ad_attribution_touches.brand_id missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reservation_checkout_sessions' and column_name = 'attribution_click_id'
  ) then
    raise exception 'T-1 FAIL: reservation_checkout_sessions.attribution_click_id missing';
  end if;
end $$;

-- ── T-2 · both rollup RPCs exist + are SECURITY DEFINER ───────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'brand_conversion_rollup' and p.prosecdef
  ) then
    raise exception 'T-2 FAIL: brand_conversion_rollup missing or not SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ad_campaign_conversion_rollup' and p.prosecdef
  ) then
    raise exception 'T-2 FAIL: ad_campaign_conversion_rollup missing or not SECURITY DEFINER';
  end if;
end $$;

-- ── T-2b · anon must NOT hold EXECUTE (ORCH-1392 SECURITY DEFINER anon gate) ───
-- Supabase default-privileges grant EXECUTE to anon on new public functions; the
-- migration REVOKEs it. authenticated MUST retain EXECUTE (the app calls it).
do $$
begin
  if has_function_privilege('anon', 'public.brand_conversion_rollup(uuid)', 'EXECUTE') then
    raise exception 'T-2b FAIL: anon can EXECUTE brand_conversion_rollup (SECURITY DEFINER anon leak)';
  end if;
  if has_function_privilege('anon', 'public.ad_campaign_conversion_rollup(uuid)', 'EXECUTE') then
    raise exception 'T-2b FAIL: anon can EXECUTE ad_campaign_conversion_rollup (SECURITY DEFINER anon leak)';
  end if;
  if not has_function_privilege('authenticated', 'public.brand_conversion_rollup(uuid)', 'EXECUTE') then
    raise exception 'T-2b FAIL: authenticated cannot EXECUTE brand_conversion_rollup';
  end if;
  if not has_function_privilege('authenticated', 'public.ad_campaign_conversion_rollup(uuid)', 'EXECUTE') then
    raise exception 'T-2b FAIL: authenticated cannot EXECUTE ad_campaign_conversion_rollup';
  end if;
end $$;

-- ── T-3 · brand-scoped SELECT RLS policies exist (alongside admin-read) ───────
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ad_conversions'
      and policyname = 'ad_conversions brand member can read'
  ) then
    raise exception 'T-3 FAIL: brand-scoped SELECT policy missing on ad_conversions';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ad_attribution_touches'
      and policyname = 'ad_attribution_touches brand member can read'
  ) then
    raise exception 'T-3 FAIL: brand-scoped SELECT policy missing on ad_attribution_touches';
  end if;
  -- the admin-read policy from 20270105000865 must STILL exist (additive, not replaced).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ad_conversions'
      and policyname = 'ad_conversions admin can read'
  ) then
    raise exception 'T-3 FAIL: admin-read policy was dropped from ad_conversions (must be additive)';
  end if;
end $$;

-- ── T-4 · brand_conversion_rollup — unauthorized returns authorized:false + shape ─
do $$
declare
  v jsonb;
begin
  -- No admin, no brand membership (auth.uid() is NULL as postgres) → the function
  -- MUST refuse to leak and return the honest-empty payload.
  v := public.brand_conversion_rollup(gen_random_uuid());
  if (v->>'authorized')::boolean is distinct from false then
    raise exception 'T-4 FAIL: unauthorized caller was not refused (authorized != false): %', v;
  end if;
  if (v->>'customers_driven_30d')::bigint <> 0
     or (v->>'customers_driven_lifetime')::bigint <> 0 then
    raise exception 'T-4 FAIL: unauthorized caller leaked non-zero counts: %', v;
  end if;
  -- stable key set (the tile relies on this shape).
  if not (v ? 'customers_driven_30d' and v ? 'customers_driven_lifetime'
          and v ? 'value_cents_30d' and v ? 'value_cents_lifetime'
          and v ? 'by_platform' and v ? 'top_campaign' and v ? 'send_health') then
    raise exception 'T-4 FAIL: brand rollup shape missing keys: %', v;
  end if;
  -- NULL brand → NULL (no crash).
  if public.brand_conversion_rollup(NULL) is not null then
    raise exception 'T-4 FAIL: brand_conversion_rollup(NULL) should be NULL';
  end if;
end $$;

-- ── T-5 · ad_campaign_conversion_rollup — admin-only NULL, shape + honest spend ─
do $$
declare
  v jsonb;
begin
  -- p_campaign_id NULL is an admin-only console read → non-admin gets refused.
  v := public.ad_campaign_conversion_rollup(NULL);
  if (v->>'authorized')::boolean is distinct from false then
    raise exception 'T-5 FAIL: all-campaigns rollup not admin-gated: %', v;
  end if;
  -- stable key set incl. the honest spend_cents:null (no fabricated ROAS).
  if not (v ? 'conversions' and v ? 'value_cents' and v ? 'spend_cents'
          and v ? 'by_platform' and v ? 'send_health') then
    raise exception 'T-5 FAIL: campaign rollup shape missing keys: %', v;
  end if;
  if v->'spend_cents' is not null and jsonb_typeof(v->'spend_cents') <> 'null' then
    raise exception 'T-5 FAIL: spend_cents must be null (no in-DB spend source; no fabricated ROAS): %', v;
  end if;
end $$;

rollback;
