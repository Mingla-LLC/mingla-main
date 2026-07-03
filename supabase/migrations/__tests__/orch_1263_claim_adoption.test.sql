-- ORCH-1263 [claim-adoption] Leg C — SQL contract suites T-D1 + T-D2.
--
--   Suite T-D1 (search facts + state) — biz_search_place_pool_for_claim:
--     * presence booleans (has_hours/has_phone/has_website/has_rating) and
--       photo_count computed correctly per row;
--     * claim_state = 'available' (no venue_listings row) / 'pending' (any
--       non-verified row, incl. rejected) / 'claimed' (verified row);
--     * output carries NO rating/review_count VALUE columns (proargnames probe).
--   Suite T-D2 (adoption-detail contract) — biz_get_place_adoption_detail:
--     * zero rows for claimed / pending / inactive places (fail-close);
--     * full single row for an available place (whitelist columns incl. the 23
--       facets, full uncapped stored_photo_urls);
--     * functiondef selects no rating / review_count / ai_* / bouncer columns;
--     * EXECUTE granted to service_role ONLY (anon/authenticated/PUBLIC denied);
--     * provolatile = 's' (STABLE — copy-on-start read, never a write;
--       I-PROPOSED-1263-CLAIM-ADOPTION-COPY-ON-START).
--
-- Run (LOCAL Supabase Postgres only — NEVER remote):
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/migrations/__tests__/orch_1263_claim_adoption.test.sql
-- Whole script runs in ONE transaction and ROLLS BACK — no residue.
--
-- FAILS-ON-REVERT:
--   * Revert the search RPC to the 20260809000000 12-column shape → T-D1's
--     has_* / claim_state selects error (column does not exist).
--   * Drop the NOT EXISTS(venue_listings) guard from the detail RPC → T-D2's
--     claimed/pending zero-row asserts fail.
--   * Widen the detail RPC with p.rating / p.review_count → the functiondef
--     probe fails (I-PROPOSED-1263-ADOPTION-PAYLOAD-WHITELISTED).
--   * GRANT the detail RPC to authenticated/anon → the privilege probe fails.

\set ON_ERROR_STOP on
begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1263aaa-0000-4000-8000-000000000001', 'orch1263-owner@test.local')
on conflict (id) do nothing;

insert into public.creator_accounts (id) values
  ('a1263aaa-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.brands (id, account_id, name, slug) values
  ('b1263aaa-0000-4000-8000-000000000001','a1263aaa-0000-4000-8000-000000000001','Orch1263 Brand','orch1263brand')
on conflict (id) do nothing;

-- Four places sharing a searchable name prefix:
--   P-AVAIL   available, RICH (hours/phone/website/rating/7 photos, facets)
--   P-PEND    pending   (venue row claim_status='rejected' — still blocks)
--   P-CLAIM   claimed   (venue row claim_status='verified')
--   P-INACT   available-shaped but is_active=false
insert into public.place_pool
  (id, google_place_id, name, address, city, country, lat, lng, types, primary_type,
   rating, review_count, opening_hours, website, national_phone_number,
   price_tiers, price_level, generative_summary, editorial_summary,
   stored_photo_urls, serves_dinner, serves_cocktails, outdoor_seating, reservable,
   is_active)
values
  ('e1263aaa-0000-4000-8000-000000000001','gp-orch1263-avail','Orch1263 Lantern Avail','1 Vine St','Raleigh','US',35.78,-78.64,
   array['bar','restaurant'],'wine_bar',
   4.6, 321, '{"periods":[{"open":{"day":5,"hour":22,"minute":0},"close":{"day":6,"hour":2,"minute":0}}]}'::jsonb,
   'https://lantern.example','(919) 555-0101',
   array['comfy','bougie'],'PRICE_LEVEL_EXPENSIVE','A moody wine bar.','Editors love it.',
   array['https://cdn/p1.jpg','https://cdn/p2.jpg','https://cdn/p3.jpg','https://cdn/p4.jpg','https://cdn/p5.jpg','https://cdn/p6.jpg','https://cdn/p7.jpg'],
   true, true, true, true,
   true),
  ('e1263bbb-0000-4000-8000-000000000002','gp-orch1263-pend','Orch1263 Lantern Pending',null,null,null,35.79,-78.65,
   array['bar'],'bar',
   null, 0, null, null, null,
   '{}','PRICE_LEVEL_MODERATE', null, null,
   '{}', null, null, null, null,
   true),
  ('e1263ccc-0000-4000-8000-000000000003','gp-orch1263-claim','Orch1263 Lantern Claimed',null,null,null,35.80,-78.66,
   array['bar'],'bar',
   null, 0, null, null, null,
   '{}', null, null, null,
   '{}', null, null, null, null,
   true),
  ('e1263ddd-0000-4000-8000-000000000004','gp-orch1263-inact','Orch1263 Lantern Inactive',null,null,null,35.81,-78.67,
   array['bar'],'bar',
   null, 0, null, null, null,
   '{}', null, null, null,
   '{}', null, null, null, null,
   false)
on conflict (id) do nothing;

insert into public.venue_listings
  (id, brand_id, place_pool_id, slug, name, lat, lng, venue_category, claim_status)
values
  ('f1263bbb-0000-4000-8000-000000000002','b1263aaa-0000-4000-8000-000000000001',
   'e1263bbb-0000-4000-8000-000000000002','orch1263pend','Orch1263 Lantern Pending',35.79,-78.65,'restaurant','rejected'),
  ('f1263ccc-0000-4000-8000-000000000003','b1263aaa-0000-4000-8000-000000000001',
   'e1263ccc-0000-4000-8000-000000000003','orch1263claim','Orch1263 Lantern Claimed',35.80,-78.66,'restaurant','verified');

-- ═════════════════════════════════════════════════════════════════════════
-- Suite T-D1 — search RPC facts + claim_state
-- ═════════════════════════════════════════════════════════════════════════
do $td1$
declare
  r record;
  n int;
begin
  -- T-D1a: rich available place — every fact true, full photo count, available.
  select * into strict r
  from public.biz_search_place_pool_for_claim('Orch1263 Lantern Avail', null);
  if not (r.has_hours and r.has_phone and r.has_website and r.has_rating) then
    raise exception 'T-D1a FAIL: presence booleans wrong: hours=% phone=% website=% rating=%',
      r.has_hours, r.has_phone, r.has_website, r.has_rating;
  end if;
  if r.photo_count <> 7 then
    raise exception 'T-D1a FAIL: photo_count expected 7 (FULL count, not capped 6), got %', r.photo_count;
  end if;
  if r.claim_state <> 'available' then
    raise exception 'T-D1a FAIL: claim_state expected available, got %', r.claim_state;
  end if;

  -- T-D1b: sparse place with a REJECTED venue row — facts false, state pending
  -- (any surviving venue_listings row blocks re-claim via venue_listings_place_uniq).
  select * into strict r
  from public.biz_search_place_pool_for_claim('Orch1263 Lantern Pending', null);
  if r.has_hours or r.has_phone or r.has_website or r.has_rating then
    raise exception 'T-D1b FAIL: sparse place reported facts it does not have';
  end if;
  if r.photo_count <> 0 then
    raise exception 'T-D1b FAIL: photo_count expected 0, got %', r.photo_count;
  end if;
  if r.claim_state <> 'pending' then
    raise exception 'T-D1b FAIL: claim_state expected pending (rejected row still blocks), got %', r.claim_state;
  end if;

  -- T-D1c: verified venue row → claimed.
  select * into strict r
  from public.biz_search_place_pool_for_claim('Orch1263 Lantern Claimed', null);
  if r.claim_state <> 'claimed' then
    raise exception 'T-D1c FAIL: claim_state expected claimed, got %', r.claim_state;
  end if;

  -- T-D1d: inactive place never surfaces (existing WHERE preserved verbatim).
  select count(*) into n
  from public.biz_search_place_pool_for_claim('Orch1263 Lantern Inactive', null);
  if n <> 0 then
    raise exception 'T-D1d FAIL: inactive place surfaced in claim search';
  end if;

  -- T-D1e: no rating/review_count VALUE columns in the output contract.
  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.biz_search_place_pool_for_claim(text,int)'::regprocedure
      and (p.proargnames && array['rating','review_count'])
  ) then
    raise exception 'T-D1e FAIL: search RPC exposes a rating/review_count VALUE column (Ve2 ban)';
  end if;

  raise notice 'T-D1 PASS (a–e)';
end
$td1$;

-- ═════════════════════════════════════════════════════════════════════════
-- Suite T-D2 — adoption-detail RPC contract
-- ═════════════════════════════════════════════════════════════════════════
do $td2$
declare
  r record;
  n int;
  def text;
begin
  -- T-D2a: claimed → zero rows.
  select count(*) into n from public.biz_get_place_adoption_detail('e1263ccc-0000-4000-8000-000000000003');
  if n <> 0 then raise exception 'T-D2a FAIL: claimed place returned % rows', n; end if;

  -- T-D2b: pending (rejected venue row) → zero rows.
  select count(*) into n from public.biz_get_place_adoption_detail('e1263bbb-0000-4000-8000-000000000002');
  if n <> 0 then raise exception 'T-D2b FAIL: pending place returned % rows', n; end if;

  -- T-D2c: inactive → zero rows.
  select count(*) into n from public.biz_get_place_adoption_detail('e1263ddd-0000-4000-8000-000000000004');
  if n <> 0 then raise exception 'T-D2c FAIL: inactive place returned % rows', n; end if;

  -- T-D2d: available → exactly one full row, values intact, gallery UNCAPPED.
  select * into strict r from public.biz_get_place_adoption_detail('e1263aaa-0000-4000-8000-000000000001');
  if r.national_phone_number <> '(919) 555-0101' then
    raise exception 'T-D2d FAIL: phone wrong: %', r.national_phone_number;
  end if;
  if r.website <> 'https://lantern.example' then
    raise exception 'T-D2d FAIL: website wrong: %', r.website;
  end if;
  if coalesce(array_length(r.stored_photo_urls, 1), 0) <> 7 then
    raise exception 'T-D2d FAIL: stored_photo_urls expected FULL 7, got %',
      coalesce(array_length(r.stored_photo_urls, 1), 0);
  end if;
  if r.price_tiers <> array['comfy','bougie'] or r.price_level <> 'PRICE_LEVEL_EXPENSIVE' then
    raise exception 'T-D2d FAIL: price payload wrong';
  end if;
  if r.generative_summary <> 'A moody wine bar.' or r.editorial_summary <> 'Editors love it.' then
    raise exception 'T-D2d FAIL: summaries wrong';
  end if;
  if not (r.serves_dinner and r.serves_cocktails and r.outdoor_seating and r.reservable) then
    raise exception 'T-D2d FAIL: facet columns wrong';
  end if;
  if r.opening_hours is null then
    raise exception 'T-D2d FAIL: opening_hours missing';
  end if;

  -- T-D2e: functiondef whitelist — no rating / review_count / ai_* / bouncer /
  -- raw_google_data / is_servable selects anywhere in the body.
  def := pg_get_functiondef('public.biz_get_place_adoption_detail(uuid)'::regprocedure);
  if def ~* 'p\.rating' or def ~* 'p\.review_count' or def ~* 'ai_signal'
     or def ~* 'bouncer' or def ~* 'raw_google_data' or def ~* 'is_servable'
     or def ~* 'photo_analysis' or def ~* 'photo_aesthetic' then
    raise exception 'T-D2e FAIL: detail RPC selects a forbidden column';
  end if;

  -- T-D2f: grants — service_role ONLY.
  if not has_function_privilege('service_role', 'public.biz_get_place_adoption_detail(uuid)', 'EXECUTE') then
    raise exception 'T-D2f FAIL: service_role lost EXECUTE';
  end if;
  if has_function_privilege('anon', 'public.biz_get_place_adoption_detail(uuid)', 'EXECUTE') then
    raise exception 'T-D2f FAIL: anon can EXECUTE the detail RPC';
  end if;
  if has_function_privilege('authenticated', 'public.biz_get_place_adoption_detail(uuid)', 'EXECUTE') then
    raise exception 'T-D2f FAIL: authenticated can EXECUTE the detail RPC directly';
  end if;

  -- T-D2g: STABLE (provolatile = 's') — copy-on-start is a pure read.
  if (select provolatile from pg_proc
      where oid = 'public.biz_get_place_adoption_detail(uuid)'::regprocedure) <> 's' then
    raise exception 'T-D2g FAIL: detail RPC is not STABLE';
  end if;

  raise notice 'T-D2 PASS (a–g)';
end
$td2$;

rollback;
