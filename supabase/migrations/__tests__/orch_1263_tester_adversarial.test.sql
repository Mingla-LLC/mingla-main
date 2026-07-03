-- ORCH-1263 [claim-adoption] — TESTER adversarial SQL suite (mingla-tester).
--
-- APPEND-ONLY new file. DIFFERENT angles than the implementor's T-D1/T-D2:
--   TA-1: EVERY non-verified claim_status value the CHECK allows
--         (pending_review / rejected-was-implementor's / suspended / revoked /
--         none) blocks as claim_state='pending' AND fail-closes the detail RPC
--         (needs-fixes rides pending_review + feedback rows — same value).
--   TA-2: ILIKE metacharacter injection — a bare '%' / '_' query must be
--         escaped as a LITERAL, never a match-all scrape.
--   TA-3: SEARCH RPC grants — anon/authenticated/PUBLIC all denied (the Leg A
--         D2/discovery-3 hardening; a direct authenticated grant would bypass
--         the edge 10/min bucket).
--   TA-4: detail RPC on a nonexistent uuid → zero rows (never an error leak).
--   TA-5: both fns SECURITY DEFINER with a PINNED search_path (proconfig).
--   TA-6: the detail RPC's OUTPUT columns (proargnames) never include the
--         forbidden set (rating/review_count/is_servable/raw_google_data/
--         ai_signal_scores).
--
-- Run (LOCAL prod-chain Postgres ONLY — container orch1263-pg):
--   docker exec -i orch1263-pg psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/migrations/__tests__/orch_1263_tester_adversarial.test.sql
-- One transaction, always ROLLS BACK — zero residue.
--
-- FAILS-ON-REVERT: re-create the pre-1263 12-column search RPC (20260809000000
-- shape) → TA-1's claim_state select errors; GRANT EXECUTE ... TO authenticated
-- on either fn → TA-3 fails.

\set ON_ERROR_STOP on
begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1263bbb-0000-4000-8000-000000000099', 'orch1263-tester@test.local')
on conflict (id) do nothing;

insert into public.creator_accounts (id) values
  ('a1263bbb-0000-4000-8000-000000000099')
on conflict (id) do nothing;

insert into public.brands (id, account_id, name, slug) values
  ('b1263bbb-0000-4000-8000-000000000099','a1263bbb-0000-4000-8000-000000000099','Orch1263 TesterBrand','orch1263tester')
on conflict (id) do nothing;

-- Five places, one per non-verified claim_status value + one clean control.
insert into public.place_pool
  (id, google_place_id, name, address, city, country, lat, lng, types, primary_type,
   rating, review_count, opening_hours, website, national_phone_number,
   price_tiers, price_level, generative_summary, editorial_summary,
   stored_photo_urls, is_active)
values
  ('e1263f01-0000-4000-8000-000000000001','gp-1263t-pr','Orch1263Adv PendingReview',null,null,null,35.1,-78.1,array['bar'],'bar',null,0,null,null,null,'{}',null,null,null,'{}',true),
  ('e1263f02-0000-4000-8000-000000000002','gp-1263t-su','Orch1263Adv Suspended',null,null,null,35.2,-78.2,array['bar'],'bar',null,0,null,null,null,'{}',null,null,null,'{}',true),
  ('e1263f03-0000-4000-8000-000000000003','gp-1263t-re','Orch1263Adv Revoked',null,null,null,35.3,-78.3,array['bar'],'bar',null,0,null,null,null,'{}',null,null,null,'{}',true),
  ('e1263f04-0000-4000-8000-000000000004','gp-1263t-no','Orch1263Adv NoneRow',null,null,null,35.4,-78.4,array['bar'],'bar',null,0,null,null,null,'{}',null,null,null,'{}',true),
  ('e1263f05-0000-4000-8000-000000000005','gp-1263t-cl','Orch1263Adv CleanControl',null,null,null,35.5,-78.5,array['bar'],'bar',null,0,null,null,null,'{}',null,null,null,'{}',true)
on conflict (id) do nothing;

insert into public.venue_listings
  (id, brand_id, place_pool_id, slug, name, lat, lng, venue_category, claim_status)
values
  ('f1263f01-0000-4000-8000-000000000001','b1263bbb-0000-4000-8000-000000000099','e1263f01-0000-4000-8000-000000000001','o1263tpr','Orch1263Adv PendingReview',35.1,-78.1,'restaurant','pending_review'),
  ('f1263f02-0000-4000-8000-000000000002','b1263bbb-0000-4000-8000-000000000099','e1263f02-0000-4000-8000-000000000002','o1263tsu','Orch1263Adv Suspended',35.2,-78.2,'restaurant','suspended'),
  ('f1263f03-0000-4000-8000-000000000003','b1263bbb-0000-4000-8000-000000000099','e1263f03-0000-4000-8000-000000000003','o1263tre','Orch1263Adv Revoked',35.3,-78.3,'restaurant','revoked'),
  ('f1263f04-0000-4000-8000-000000000004','b1263bbb-0000-4000-8000-000000000099','e1263f04-0000-4000-8000-000000000004','o1263tno','Orch1263Adv NoneRow',35.4,-78.4,'restaurant','none');

do $ta$
declare
  r record;
  n int;
  cfg text[];
begin
  -- ── TA-1: every surviving non-verified row blocks as 'pending' + detail 0 ──
  for r in
    select p.id as place_id, p.name
    from public.place_pool p
    where p.name in ('Orch1263Adv PendingReview','Orch1263Adv Suspended',
                     'Orch1263Adv Revoked','Orch1263Adv NoneRow')
  loop
    declare s text; d int;
    begin
      select claim_state into strict s
      from public.biz_search_place_pool_for_claim(r.name, null)
      where id = r.place_id;
      if s <> 'pending' then
        raise exception 'TA-1 FAIL: % expected claim_state pending, got %', r.name, s;
      end if;
      select count(*) into d from public.biz_get_place_adoption_detail(r.place_id);
      if d <> 0 then
        raise exception 'TA-1 FAIL: % detail returned % rows (must fail-close)', r.name, d;
      end if;
    end;
  end loop;

  -- Clean control still available + detail serves one row.
  select claim_state into strict r
  from public.biz_search_place_pool_for_claim('Orch1263Adv CleanControl', null)
  where id = 'e1263f05-0000-4000-8000-000000000005';
  select count(*) into n
  from public.biz_get_place_adoption_detail('e1263f05-0000-4000-8000-000000000005');
  if n <> 1 then
    raise exception 'TA-1 FAIL: clean control detail expected 1 row, got %', n;
  end if;

  -- ── TA-2: ILIKE metacharacters are LITERAL, never match-all ───────────────
  select count(*) into n from public.biz_search_place_pool_for_claim('%', null)
  where name like 'Orch1263Adv%';
  if n <> 0 then
    raise exception 'TA-2 FAIL: bare %% query matched % fixture rows (scrape hole)', n;
  end if;
  select count(*) into n from public.biz_search_place_pool_for_claim('_', null)
  where name like 'Orch1263Adv%';
  if n <> 0 then
    raise exception 'TA-2 FAIL: bare _ query matched % fixture rows', n;
  end if;

  -- ── TA-3: search RPC grants — service_role only ───────────────────────────
  if has_function_privilege('anon', 'public.biz_search_place_pool_for_claim(text,int)', 'EXECUTE') then
    raise exception 'TA-3 FAIL: anon can EXECUTE the search RPC directly';
  end if;
  if has_function_privilege('authenticated', 'public.biz_search_place_pool_for_claim(text,int)', 'EXECUTE') then
    raise exception 'TA-3 FAIL: authenticated can EXECUTE the search RPC (edge rate-limit bypass)';
  end if;
  if not has_function_privilege('service_role', 'public.biz_search_place_pool_for_claim(text,int)', 'EXECUTE') then
    raise exception 'TA-3 FAIL: service_role lost EXECUTE on the search RPC';
  end if;

  -- ── TA-4: nonexistent uuid → zero rows, no error ──────────────────────────
  select count(*) into n
  from public.biz_get_place_adoption_detail('00000000-0000-4000-8000-00000000dead');
  if n <> 0 then
    raise exception 'TA-4 FAIL: nonexistent place returned % rows', n;
  end if;

  -- ── TA-5: SECURITY DEFINER + pinned search_path on BOTH fns ───────────────
  for r in
    select p.oid::regprocedure::text as fn, p.prosecdef, p.proconfig
    from pg_proc p
    where p.oid in ('public.biz_search_place_pool_for_claim(text,int)'::regprocedure,
                    'public.biz_get_place_adoption_detail(uuid)'::regprocedure)
  loop
    if not r.prosecdef then
      raise exception 'TA-5 FAIL: % is not SECURITY DEFINER', r.fn;
    end if;
    cfg := r.proconfig;
    if cfg is null or not exists (
      select 1 from unnest(cfg) c where c like 'search_path=%'
    ) then
      raise exception 'TA-5 FAIL: % has no pinned search_path', r.fn;
    end if;
  end loop;

  -- ── TA-6: detail OUTPUT columns never include the forbidden set ───────────
  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.biz_get_place_adoption_detail(uuid)'::regprocedure
      and (p.proargnames && array['rating','review_count','is_servable',
                                  'raw_google_data','ai_signal_scores',
                                  'bouncer_reason','photo_analysis'])
  ) then
    raise exception 'TA-6 FAIL: detail RPC output contract carries a forbidden column';
  end if;

  raise notice 'TESTER-ADVERSARIAL PASS (TA-1..TA-6)';
end
$ta$;

rollback;
