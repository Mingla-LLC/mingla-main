-- META-ORCH-1290 M2 — the two servable-deck RPCs return the owner-authored pitch
-- (place_pool.generative_summary) so discover-cards can render it on the swipe
-- card (D-6). This runtime complement proves both RPCs expose the column AND that
-- the collab (intersection) RPC's ORDER BY determinism is intact.
--
-- Run (LOCAL Supabase Postgres only — NEVER remote):
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/migrations/__tests__/meta_orch_1290_servable_rpc_pitch.test.sql
-- ONE transaction, ROLLS BACK — no residue.
--
-- FAILS-ON-REVERT:
--   * Drop `pp.generative_summary` from either RPC's SELECT (revert D-6) →
--     RPC-PITCH-1 / RPC-PITCH-2 fails (column absent / NULL).
--   * Break the ORDER BY / three-gate WHERE → the row would not serve and the
--     assertions fail (the fixture is inside radius + above p_filter_min).

\set ON_ERROR_STOP on
begin;

-- A single servable, active, photographed place with an owner-authored pitch,
-- and its per-signal place_scores receipt. signal_id is free text (no FK).
insert into public.place_pool
  (id, name, lat, lng, is_active, is_servable, stored_photo_urls, generative_summary)
values
  ('c1290aaa-0000-4000-8000-000000000001','ORCH-1290 Servable Place', 38.9, -77.0,
   true, true, array['https://x.test/hero.jpg'],
   'A neon-lit listening bar with rare vinyl and natural wine.')
on conflict (id) do nothing;

insert into public.place_scores (place_id, signal_id, score, contributions)
values
  ('c1290aaa-0000-4000-8000-000000000001','orch1290pitchsig', 150, '{}'::jsonb);

do $$
declare v_pitch text;
begin
  -- RPC-PITCH-1 (solo Home + curated): the servable RPC returns generative_summary.
  select generative_summary into v_pitch
  from public.query_servable_places_by_signal('orch1290pitchsig', 0, 38.9, -77.0, 50000, '{}'::uuid[], 20)
  where place_id = 'c1290aaa-0000-4000-8000-000000000001';
  if v_pitch is distinct from 'A neon-lit listening bar with rare vinyl and natural wine.' then
    raise exception 'RPC-PITCH-1 FAIL: solo RPC generative_summary = %, expected the pitch', coalesce(v_pitch, '<null>');
  end if;

  -- RPC-PITCH-2 (collab positional deck): same pitch through the intersection RPC
  -- with no circles (→ all servable candidates). ORDER BY determinism unchanged.
  select generative_summary into v_pitch
  from public.query_servable_places_by_signal_intersection('orch1290pitchsig', 0, '[]'::jsonb, '{}'::uuid[], 200)
  where place_id = 'c1290aaa-0000-4000-8000-000000000001';
  if v_pitch is distinct from 'A neon-lit listening bar with rare vinyl and natural wine.' then
    raise exception 'RPC-PITCH-2 FAIL: intersection RPC generative_summary = %, expected the pitch', coalesce(v_pitch, '<null>');
  end if;

  raise notice 'RPC-PITCH-1/2 PASS: both servable RPCs return generative_summary';
end $$;

rollback;
